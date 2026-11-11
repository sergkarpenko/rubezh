// src/battle.property.test.ts
// Т.15 (ADR-0085): property-тести бою. Звичайний тест перевіряє один приклад,
// property-тест — твердження, що має виконуватись на будь-якому бойовищі і за
// будь-якої послідовності дій; бойовища й дії генерує fast-check. Сід фіксований
// (ADR-0003): той самий код дає той самий результат на кожному запуску. Якщо
// твердження порушено, fast-check стискає приклад до найкоротшого і друкує його.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  createGame,
  endTurn,
  evacuate,
  hasLineOfSight,
  isBlocked,
  isInside,
  makeUnit,
  moveUnit,
  mulberry32,
  resolveAttack,
  setOverwatch,
  throwGrenade,
  unitAt,
  useMedkit,
  type GameState,
  type ShotMode,
  type StatefulRng,
  type Unit,
  type Vec2,
} from './core/combat';
import { computeVisibleCells, findPath } from './core/map';
import { aiStep } from './core/ai';
import { botTurn } from './core/ai-bot';

const RUN = { seed: 20261111, numRuns: 150 };
const key = (p: Vec2): string => p.x + ',' + p.y;
const DIRS: Vec2[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

// --- Генератори ---

// Бойовище: поле 5×5…9×9, стіни, 4–6 юнітів почергово двох сторін, у кожного
// аптечка і граната; зона евакуації — стартові клітинки оперативників.
const arenaArb = fc.record({
  w: fc.integer({ min: 5, max: 9 }),
  h: fc.integer({ min: 5, max: 9 }),
  walls: fc.array(fc.nat(80), { maxLength: 24 }),
  spots: fc.array(fc.nat(80), { minLength: 4, maxLength: 6 }),
  seed: fc.nat(),
});
type Arena = typeof arenaArb extends fc.Arbitrary<infer T> ? T : never;

function build(a: Arena): GameState {
  const n = a.w * a.h;
  const at = (c: number): Vec2 => ({ x: c % a.w, y: Math.floor(c / a.w) });
  const taken = new Set<number>();
  const units = a.spots.map((spot, i) => {
    let c = spot % n;
    while (taken.has(c)) c = (c + 1) % n;
    taken.add(c);
    const side = i % 2 === 0 ? 'player' : 'alien';
    return makeUnit({ id: side[0] + i, side, pos: at(c), hp: 10 - (i % 3) });
  });
  const blocked = new Set(
    a.walls
      .map((c) => c % n)
      .filter((c) => !taken.has(c))
      .map((c) => key(at(c)))
  );
  return createGame({
    map: { width: a.w, height: a.h, blocked },
    units,
    rng: mulberry32(a.seed),
    items: Object.fromEntries(units.map((u) => [u.id, { medkit: true, grenade: true }])),
    evacZone: units.filter((u) => u.side === 'player').map((u) => u.pos),
  });
}

// Дія: тип і «сирі» числа; яке з них потрібне — вирішує тип. Малий індекс бере
// живого юніта сторони, що ходить (ціль — живого ворога), більший — будь-якого,
// тож серед дій є й недозволені: чужий хід, мертвий, вогонь по своїх, поза полем.
const actArb = fc.record({
  t: fc.constantFrom('step', 'go', 'shoot', 'watch', 'grenade', 'heal', 'evac', 'end', 'bot'),
  u: fc.nat(5),
  v: fc.nat(5),
  x: fc.integer({ min: -1, max: 9 }),
  y: fc.integer({ min: -1, max: 9 }),
  m: fc.constantFrom<ShotMode>('auto', 'snap', 'aimed'),
});
type Act = typeof actArb extends fc.Arbitrary<infer T> ? T : never;

// --- Оракули ---

// Довжина найкоротшого шляху пошуком у ширину — незалежна від A* перевірка.
function bfs(s: GameState, start: Vec2, goal: Vec2, known: (u: Unit) => boolean = () => true): number | null {
  const free = (p: Vec2): boolean => {
    const u = unitAt(s, p);
    return isInside(s.map, p) && !isBlocked(s.map, p) && !(u !== undefined && known(u));
  };
  if (key(start) === key(goal)) return 0;
  if (!free(goal)) return null;
  const dist = new Map([[key(start), 0]]);
  const queue = [start];
  for (let p = queue.shift(); p !== undefined; p = queue.shift()) {
    for (const d of DIRS) {
      const n = { x: p.x + d.x, y: p.y + d.y };
      if (dist.has(key(n)) || !free(n)) continue;
      dist.set(key(n), dist.get(key(p))! + 1);
      if (key(n) === key(goal)) return dist.get(key(n))!;
      queue.push(n);
    }
  }
  return null;
}

const all = (s: GameState): Unit[] => [...s.units, ...(s.evacuated ?? [])];
const snap = (s: GameState): string =>
  JSON.stringify([s.units, s.evacuated, s.turn, s.activeSide, s.items, s.log, (s.rng as StatefulRng).state]);

// Що в стані бою порушено (порожній список — усе гаразд).
function broken(s: GameState, ids: string): string[] {
  const bad: string[] = [];
  const cells = new Set<string>();
  for (const u of s.units) {
    if (!isInside(s.map, u.pos) || isBlocked(s.map, u.pos)) bad.push(u.id + ': поза полем або в стіні');
    if (u.hp < 0 || u.hp > u.maxHp || u.alive !== u.hp > 0) bad.push(u.id + ': hp ' + u.hp + ', alive ' + u.alive);
    if (u.ap < 0 || u.ap > u.maxAp) bad.push(u.id + ': ap ' + u.ap);
    if (u.alive && cells.has(key(u.pos))) bad.push('двоє живих у клітинці ' + key(u.pos));
    if (u.alive) cells.add(key(u.pos));
  }
  if ((s.evacuated ?? []).some((u) => u.side !== 'player' || !u.alive)) bad.push('евакуйовано не живого оперативника');
  const sideOf = new Map(all(s).map((u) => [u.id, u.side]));
  if ([...sideOf.keys()].sort().join() !== ids) bad.push('склад юнітів змінився: ' + [...sideOf.keys()].join());
  const deaths = s.log.filter((e) => e.type === 'death');
  const dead = all(s).filter((u) => !u.alive);
  if (deaths.length !== dead.length || new Set(deaths.map((e) => e.unitId)).size !== dead.length)
    bad.push('журнал смертей не збігається з полем');
  for (const side of ['player', 'alien']) {
    const kills = all(s).reduce((sum, u) => sum + (u.side === side ? u.kills : 0), 0);
    const scored = deaths.filter((e) => sideOf.get(e.killerId) === side && sideOf.get(e.unitId) !== side).length;
    if (kills !== scored) bad.push('лічильник убивств ' + side + ': ' + kills + ', у журналі ' + scored);
  }
  return bad;
}

// Виконати дію. «go» і «bot» відмовляти не мають права: шлях від findPath у межах
// AP рух приймає завжди, боти не роблять недозволених ходів. Решта дій або
// виконується, або відмовляє, нічого не змінивши — ні стан, ні позицію rng.
function act(s: GameState, a: Act, check: boolean): void {
  const pick = (first: Unit[], i: number): Unit => (i < first.length ? first[i] : s.units[i % s.units.length]);
  const u = pick(
    s.units.filter((x) => x.alive && x.side === s.activeSide),
    a.u
  );
  const v = pick(
    s.units.filter((x) => x.alive && x.side !== u.side),
    a.v
  );
  const cell = { x: a.x, y: a.y };
  if (a.t === 'bot') {
    if (s.activeSide === 'alien') aiStep(s);
    else botTurn(s);
    return;
  }
  if (a.t === 'go') {
    if (!u.alive || u.side !== s.activeSide) return;
    const goal = { x: (a.x + s.map.width) % s.map.width, y: (a.y + s.map.height) % s.map.height };
    const path = findPath(s, u.pos, goal);
    if (check) expect(path?.length ?? null, 'A* проти пошуку в ширину').toBe(bfs(s, u.pos, goal));
    if (path) moveUnit(s, u.id, path.slice(0, u.ap));
    return;
  }
  const before = check ? snap(s) : '';
  try {
    if (a.t === 'step') moveUnit(s, u.id, [{ x: u.pos.x + DIRS[a.v % 4].x, y: u.pos.y + DIRS[a.v % 4].y }]);
    else if (a.t === 'shoot') resolveAttack(s, u.id, v.id, a.m);
    else if (a.t === 'watch') setOverwatch(s, u.id);
    else if (a.t === 'grenade') throwGrenade(s, u.id, cell);
    else if (a.t === 'heal') useMedkit(s, u.id, a.v % 2 === 0 ? u.id : v.id);
    else if (a.t === 'evac') evacuate(s, u.id);
    else endTurn(s);
  } catch (e) {
    if ((e as Error).constructor !== Error) throw e; // TypeError тощо — дефект, а не відмова
    if (check) expect(snap(s), 'відмова змінила стан: ' + a.t).toBe(before);
  }
}

function play(arena: Arena, acts: Act[], check: boolean): GameState {
  const s = build(arena);
  const ids = all(s)
    .map((u) => u.id)
    .sort()
    .join();
  for (const a of acts) {
    act(s, a, check);
    if (check) expect(broken(s, ids), 'після дії ' + JSON.stringify(a)).toEqual([]);
  }
  return s;
}

describe('property: бій на випадковому бойовищі', () => {
  it('жодна послідовність дій не ламає стан бою; відмова нічого не змінює; та сама послідовність дає той самий бій', () => {
    fc.assert(
      fc.property(arenaArb, fc.array(actArb, { maxLength: 60, size: 'max' }), (arena, acts) => {
        const first = play(arena, acts, true);
        expect(snap(play(arena, acts, false))).toBe(snap(first)); // детермінізм, ADR-0003
      }),
      RUN
    );
  });

  it('findPath: шлях складається з дозволених кроків, веде до цілі і найкоротший; невидимий юніт його не змінює (ADR-0081)', () => {
    fc.assert(
      fc.property(arenaArb, fc.nat(80), (arena, goalCell) => {
        const s = build(arena);
        const start = s.units[0].pos;
        const goal = { x: goalCell % arena.w, y: Math.floor(goalCell / arena.w) % arena.h };
        const seen = computeVisibleCells(s, start);
        const known = (u: Unit): boolean => seen.has(key(u.pos));
        const path = findPath(s, start, goal, 2000, seen);
        expect(path?.length ?? null).toBe(bfs(s, start, goal, known));
        let prev = start;
        for (const step of path ?? []) {
          expect(Math.abs(step.x - prev.x) + Math.abs(step.y - prev.y)).toBe(1);
          expect(isInside(s.map, step) && !isBlocked(s.map, step)).toBe(true);
          prev = step;
        }
        if (path && path.length > 0) expect(prev).toEqual(goal);
        // без невидимих юнітів на полі шлях той самий: планувальник про них не знає
        const cleared = { ...s, units: s.units.filter(known) };
        expect(findPath(cleared, start, goal)).toEqual(path);
      }),
      RUN
    );
  });

  it('туман: спостерігач бачить свою клітинку; прибрана стіна огляду не зменшує', () => {
    fc.assert(
      fc.property(arenaArb, fc.nat(80), (arena, n) => {
        const s = build(arena);
        const from = s.units[0].pos;
        const seen = computeVisibleCells(s, from);
        expect(seen.has(key(from))).toBe(true);
        const walls = [...s.map.blocked];
        const opened = { ...s, map: { ...s.map, blocked: new Set(walls.filter((_, i) => i !== n % (walls.length || 1))) } };
        const wider = computeVisibleCells(opened, from);
        expect([...seen].filter((c) => !wider.has(c))).toEqual([]);
      }),
      RUN
    );
  });

  // Знахідка Т.15: property «лінія вогню однакова в обидва боки» не виконується —
  // растеризація лінії залежить від напрямку. Тест фіксує чинну поведінку найменшим
  // прикладом від fast-check; чи має лінія бути симетричною — рішення власника.
  it('лінія вогню залежить від напрямку: демон стріляє в оперативника, той у відповідь — ні', () => {
    const s = build({ w: 5, h: 5, walls: [1], spots: [2, 5], seed: 0 }); // стіна (1,0), p0 у (2,0), a1 у (0,1)
    expect(hasLineOfSight(s, s.units[1].pos, s.units[0].pos)).toBe(true);
    expect(hasLineOfSight(s, s.units[0].pos, s.units[1].pos)).toBe(false);
    expect(() => resolveAttack(s, 'p0', 'a1', 'snap')).toThrow('Немає лінії вогню');
    endTurn(s);
    expect(resolveAttack(s, 'a1', 'p0', 'snap').shots).toHaveLength(1);
  });
});
