// src/battle.property.test.ts
// Т.15 (ADR-0085): property-тести бою. Звичайний тест перевіряє один приклад,
// property-тест — твердження, що має виконуватись на будь-якому бойовищі і за
// будь-якої послідовності дій; бойовища й дії генерує fast-check. Сід фіксований
// (ADR-0003): той самий код дає той самий результат на кожному запуску. Якщо
// твердження порушено, fast-check стискає приклад до найкоротшого і друкує його.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { WEAPONS, WEAPON_IDS } from './core/weapons';
import { ENEMY_ORDER, makeEnemy } from './core/enemies';
import {
  createGame,
  DASH_AP_BONUS,
  STIM_AP_BONUS,
  endTurn,
  evacuate,
  fieldAid,
  hasLineOfSight,
  seenEnemies,
  sightBlockers,
  isImpassable,
  isInside,
  makeUnit,
  moveUnit,
  mulberry32,
  preciseShot,
  resolveAttack,
  setOverwatch,
  throwGrenade,
  unitAt,
  useDash,
  useStim,
  useMedkit,
  weaponHasMode,
  distance,
  PRECISE_DAMAGE_MULT,
  type BattleRole,
  type GameState,
  type ShotMode,
  type StatefulRng,
  type Unit,
  type Vec2,
} from './core/combat';
import { computeVisibleCells, findPath, sideVisibleCells } from './core/map';
import { aiStep } from './core/ai';
import { botTurn } from './core/ai-bot';

const RUN = { seed: 20261111, numRuns: 150 };
const ROLES: BattleRole[] = ['medic', 'sniper', 'assault'];
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
// п16.3: оперативники мають ролі по черзі — медик, снайпер, штурмовик.
const arenaArb = fc.record({
  w: fc.integer({ min: 5, max: 9 }),
  h: fc.integer({ min: 5, max: 9 }),
  walls: fc.array(fc.nat(80), { maxLength: 24 }),
  spots: fc.array(fc.nat(80), { minLength: 4, maxLength: 6 }),
  seed: fc.nat(),
  // п20.2 (ADR-0166): низькі перешкоди — клітинки поза юнітами і стінами; укриття — у половині арен (сід парний)
  low: fc.array(fc.nat(80), { maxLength: 8 }),
});
type Arena = typeof arenaArb extends fc.Arbitrary<infer T> ? T : never;
// п17.2: стартові позиції юнітів бою (ключ — масив юнітів з build) — відтворення позицій за журналом
const start = new WeakMap<object, Map<string, Vec2>>();
const startOf = new WeakMap<GameState, Map<string, Vec2>>();

function build(a: Arena): GameState {
  const n = a.w * a.h;
  const at = (c: number): Vec2 => ({ x: c % a.w, y: Math.floor(c / a.w) });
  const taken = new Set<number>();
  let first = 0;
  const units = a.spots.map((spot, i) => {
    // п16.3: другий оперативник — часто поруч із першим (медиком), щоб
    // «Польова допомога» сусідові траплялась у згенерованих боях
    let c = i === 2 && spot % 2 === 0 ? (first + 1) % n : spot % n;
    while (taken.has(c)) c = (c + 1) % n;
    taken.add(c);
    if (i === 0) first = c;
    const side = i % 2 === 0 ? 'player' : 'alien';
    // п20.4 (ADR-0168): зброя оперативника з «Кузні» — за номером клітинки (spot < 11 — «Гарт»: приклади лишаються)
    const weapon = WEAPONS[spot < 11 ? 'rifle' : WEAPON_IDS[spot % WEAPON_IDS.length]];
    if (side === 'player') return makeUnit({ id: side[0] + i, side, pos: at(c), hp: 10 - (i % 3), weapon });
    // п17.2 (ADR-0149): вороги всіх чотирьох типів — тип з номера клітинки (spot < 7 — демон: приклади Т.18 лишаються з демоном)
    const e = makeEnemy(ENEMY_ORDER[Math.floor(spot / 7) % ENEMY_ORDER.length], side[0] + i, 0, at(c));
    e.hp = e.maxHp - (i % 3);
    return e;
  });
  start.set(units, new Map(units.map((u) => [u.id, { ...u.pos }])));
  const blocked = new Set(
    a.walls
      .map((c) => c % n)
      .filter((c) => !taken.has(c))
      .map((c) => key(at(c)))
  );
  const low = new Set(
    a.low
      .map((c) => c % n)
      .filter((c) => !taken.has(c))
      .map((c) => key(at(c)))
      .filter((k) => !blocked.has(k))
  );
  const state = createGame({
    map: { width: a.w, height: a.h, blocked, low },
    cover: a.seed % 2 === 0,
    units,
    rng: mulberry32(a.seed),
    // п18.6 (кандидат 185 а): «Пробивний заряд» у кожного — подія charge і шкода без броні в генераторі
    // п22.5 (ADR-0187): «Стимулятор» у кожного, «Щит» — у кожного другого (поглинуте влучання — шкода 0)
    items: Object.fromEntries(units.map((u, i) => [u.id, { medkit: true, grenade: true, charge: true, stim: true, shield: i % 2 === 0 }])),
    evacZone: units.filter((u) => u.side === 'player').map((u) => u.pos),
    roles: Object.fromEntries(units.filter((u) => u.side === 'player').map((u, i) => [u.id, { role: ROLES[i % 3], used: false }])),
  });
  startOf.set(state, start.get(units)!);
  return state;
}

// Дія: тип і «сирі» числа; яке з них потрібне — вирішує тип. Малий індекс бере
// живого юніта сторони, що ходить (ціль — живого ворога), більший — будь-якого,
// тож серед дій є й недозволені: чужий хід, мертвий, вогонь по своїх, поза полем.
const actArb = fc.record({
  t: fc.constantFrom('step', 'go', 'shoot', 'watch', 'grenade', 'heal', 'evac', 'end', 'bot', 'dash', 'precise', 'aid', 'stim'),
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
    return isInside(s.map, p) && !isImpassable(s.map, p) && !(u !== undefined && known(u));
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
  JSON.stringify([s.units, s.evacuated, s.turn, s.activeSide, s.items, s.roles, s.log, (s.rng as StatefulRng).state]);

// Що в стані бою порушено (порожній список — усе гаразд).
function broken(s: GameState, ids: string): string[] {
  const bad: string[] = [];
  const cells = new Set<string>();
  for (const u of s.units) {
    if (!isInside(s.map, u.pos) || isImpassable(s.map, u.pos)) bad.push(u.id + ': поза полем, у стіні чи низькій перешкоді'); // п20.2
    if (u.hp < 0 || u.hp > u.maxHp || u.alive !== u.hp > 0) bad.push(u.id + ': hp ' + u.hp + ', alive ' + u.alive);
    // п16.3: «Ривок» дає AP понад максимум — лише штурмовикові і лише в хід ривка
    // (подія dash цього юніта після початку останнього ходу його сторони: AP відновлює
    // лише endTurn на початку свого ходу, тож у хід демонів надлишок лишається)
    const lastTurn = s.log.reduce((last, e, i) => (e.type === 'turn' && e.side === u.side ? i : last), -1);
    // загиблий після ривка зберігає AP, з якими загинув
    const dashed = s.log.some((e, i) => (i > lastTurn || !u.alive) && e.type === 'dash' && e.unitId === u.id);
    // п22.5: «Стимулятор» — так само, у свій хід
    const stimmed = s.log.some((e, i) => (i > lastTurn || !u.alive) && e.type === 'stim' && e.unitId === u.id);
    if (u.ap < 0 || u.ap > u.maxAp + (dashed ? DASH_AP_BONUS : 0) + (stimmed ? STIM_AP_BONUS : 0)) bad.push(u.id + ': ap ' + u.ap);
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
  // п16.3: дія ролі — раз за бій: прапорець «використано» ⇔ рівно одна подія ролі юніта
  for (const [id, r] of Object.entries(s.roles ?? {})) {
    const n = s.log.filter(
      (e) => ((e.type === 'dash' || e.type === 'field_aid') && e.unitId === id) || (e.type === 'precise_shot' && e.shooterId === id)
    ).length;
    if (n !== (r.used ? 1 : 0)) bad.push(id + ': дія ролі ' + n + ' разів, used ' + r.used);
  }
  // п17.2 (ADR-0149, «Наслідки»): позиції — відтворенням журналу від старту; кожен постріл —
  // режимом своєї зброї і в межах її дальності (гончак — не далі 1 клітинки); влучання — не
  // менше 1 шкоди і в межах [max(1, ⌊мін × m⌋ − броня), max(1, ⌊макс × m⌋ − броня)], де m — множник
  // «Точного пострілу», якщо перед подією стоїть precise_shot того самого стрільця (аудит PR #507)
  const pos = new Map(startOf.get(s) ?? []);
  const byId = new Map(all(s).map((u) => [u.id, u]));
  // п18.6 (кандидат 185 а, ADR-0154): заряд — не більше однієї події charge на юніта, лише по цілі з бронею,
  // подія ⇔ заряд витрачено; постріли тієї самої атаки після charge (рівно черга режиму першого пострілу,
  // смерть цілі обриває) — без броні; наступна атака впритул за нею — вже з бронею
  let pierce: { shooterId: string; targetId: string; left?: number } | null = null;
  for (const u of all(s)) {
    const n = s.log.filter((e) => e.type === 'charge' && e.shooterId === u.id).length;
    if (n > 1 || (n === 1) !== (s.items?.[u.id]?.charge === false))
      bad.push(u.id + ': подій charge ' + n + ', заряд ' + s.items?.[u.id]?.charge);
  }
  // п22.5 (ADR-0187): «Стимулятор» і «Щит» — не більше однієї події на юніта; подія — витратник витрачено;
  // «Стимулятор» (є в кожного) витрачено — лише з подією («Щит» у непарних немає зі старту)
  for (const u of all(s)) {
    for (const k of ['stim', 'shield'] as const) {
      const n = s.log.filter((e) => e.type === k && e.unitId === u.id).length;
      if (n > 1 || (n === 1 && s.items?.[u.id]?.[k] !== false) || (n === 0 && s.items?.[u.id]?.[k] === false && k === 'stim'))
        bad.push(u.id + ': подій ' + k + ' ' + n + ', предмет ' + s.items?.[u.id]?.[k]);
    }
  }
  for (const [i, e] of s.log.entries()) {
    if (e.type === 'move') pos.set(e.unitId, e.to);
    if (e.type === 'charge') {
      if (!((byId.get(e.targetId)!.armor ?? 0) > 0)) bad.push(e.shooterId + ': заряд по цілі без броні');
      pierce = { shooterId: e.shooterId, targetId: e.targetId };
      continue;
    }
    if (e.type !== 'shot' && e.type !== 'death' && e.type !== 'shield') pierce = null;
    if (e.type !== 'shot') continue;
    const sh = byId.get(e.shooterId)!;
    const tg = byId.get(e.targetId)!;
    if (!weaponHasMode(sh.weapon, e.mode)) bad.push(sh.id + ': режим ' + e.mode + ' не зброї «' + sh.weapon.name + '»');
    if (distance(pos.get(sh.id)!, pos.get(tg.id)!) > sh.weapon.range) bad.push(sh.id + ': постріл далі дальності ' + sh.weapon.range);
    if (pierce !== null && pierce.left === undefined) pierce.left = sh.weapon.modes[e.mode].shots;
    const pierced = pierce !== null && pierce.shooterId === sh.id && pierce.targetId === tg.id && (pierce.left ?? 0) > 0;
    if (pierce !== null) pierce.left = (pierce.left ?? 0) - 1;
    if (!e.hit) continue;
    // precise_shot стоїть перед shot; при вбивстві між ними — death; п18.6: між ними може бути charge
    // п22.5: між ними — і «Щит» цілі (тоді шкода 0)
    let j = i - 1;
    let shielded = false;
    while (s.log[j]?.type === 'death' || s.log[j]?.type === 'charge' || s.log[j]?.type === 'shield') {
      const x = s.log[j];
      if (x.type === 'shield' && x.unitId === tg.id) shielded = true;
      j--;
    }
    const prev = s.log[j];
    if (shielded) {
      if (e.damage !== 0) bad.push(tg.id + ': щит, а шкода ' + e.damage);
      continue;
    }
    const m = prev !== undefined && prev.type === 'precise_shot' && prev.shooterId === sh.id ? PRECISE_DAMAGE_MULT : 1;
    const armor = pierced ? 0 : (tg.armor ?? 0);
    const lo = Math.max(1, Math.floor(sh.weapon.damage[0] * m) - armor);
    const hi = Math.max(1, Math.floor(sh.weapon.damage[1] * m) - armor);
    if (e.damage < lo || e.damage > hi) bad.push(tg.id + ': шкода ' + e.damage + ' поза ' + lo + '–' + hi + ' (броня ' + armor + ')');
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
    else botTurn(s, undefined, a.v % 2 === 1); // п18.6 (ADR-0158): непарне v — бот тримає позицію в дозорі
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
    else if (a.t === 'dash') useDash(s, u.id);
    else if (a.t === 'stim')
      useStim(s, u.id); // п22.5
    else if (a.t === 'precise') preciseShot(s, u.id, v.id);
    else if (a.t === 'aid')
      fieldAid(
        s,
        u.id,
        pick(
          s.units.filter((x) => x.alive && x.side === u.side),
          a.v
        ).id
      );
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
        const seen = computeVisibleCells(s, start, s.units[0].side);
        const known = (u: Unit): boolean => seen.has(key(u.pos));
        const path = findPath(s, start, goal, 2000, seen);
        expect(path?.length ?? null).toBe(bfs(s, start, goal, known));
        let prev = start;
        for (const step of path ?? []) {
          expect(Math.abs(step.x - prev.x) + Math.abs(step.y - prev.y)).toBe(1);
          expect(isInside(s.map, step) && !isImpassable(s.map, step)).toBe(true);
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

  it('туман: спостерігач бачить свою клітинку; прибрана стіна огляду не зменшує; лінія вогню однакова в обидва боки', () => {
    fc.assert(
      fc.property(arenaArb, fc.nat(80), (arena, n) => {
        const s = build(arena);
        const from = s.units[0].pos;
        const seen = computeVisibleCells(s, from, s.units[0].side);
        expect(seen.has(key(from))).toBe(true);
        // п17.4: монотонність за рельєфом — лише з глядачем на полі: прибрана стіна може відкрити
        // ворога, а він закриває клітинки за собою (ADR-0151)
        const walls = [...s.map.blocked];
        const alone = { ...s, units: [s.units[0]] };
        const opened = { ...alone, map: { ...s.map, blocked: new Set(walls.filter((_, i) => i !== n % (walls.length || 1))) } };
        const wider = computeVisibleCells(opened, from, s.units[0].side);
        const base = computeVisibleCells(alone, from, s.units[0].side);
        expect([...base].filter((c) => !wider.has(c))).toEqual([]);
        // п20.2 (ADR-0165 п. 3): низькі перешкоди огляду не закривають — без них видно те саме
        expect(computeVisibleCells({ ...alone, map: { ...s.map, low: undefined } }, from, s.units[0].side)).toEqual(base);
        // Т.18 (ADR-0087): хто бачить клітинку, того з неї видно — для кожної пари клітинок поля
        const cells: Vec2[] = [];
        for (let x = 0; x < s.map.width; x++) for (let y = 0; y < s.map.height; y++) cells.push({ x, y });
        const oneWay = cells.flatMap((a) =>
          cells.filter((b) => hasLineOfSight(s, a, b, 'player') !== hasLineOfSight(s, b, a, 'player')).map((b) => key(a) + '→' + key(b))
        );
        expect(oneWay).toEqual([]);
        for (const c of cells) expect(computeVisibleCells(s, c, s.units[0].side).has(key(from))).toBe(seen.has(key(c)));
      }),
      RUN
    );
  });

  // п17.4 (ADR-0151): туман сторони не залежить від юнітів, яких вона не бачить (ADR-0081), а кожен
  // видимий їй ворог закриває огляд усім її юнітам; невидимих стороні юнітів прибирають по одному.
  it('туман із блокуванням: невидимий стороні юніт не змінює її туману; видимий ворог — закривач', () => {
    fc.assert(
      fc.property(arenaArb, (arena) => {
        const s = build(arena);
        for (const side of ['player', 'alien'] as const) {
          const vis = [...sideVisibleCells(s, side)].sort();
          const seen = seenEnemies(s, side).map((u) => u.id);
          const blockers = sightBlockers(s, side);
          for (const u of s.units) if (u.alive && (u.side === side || seen.includes(u.id))) expect(blockers.has(key(u.pos))).toBe(true);
          for (const e of seenEnemies(s, side)) expect(vis).toContain(key(e.pos));
          for (const e of s.units) {
            if (!e.alive || e.side === side || seen.includes(e.id)) continue;
            expect(blockers.has(key(e.pos))).toBe(false);
            const without = { ...s, units: s.units.filter((u) => u !== e) };
            expect([...sideVisibleCells(without, side)].sort()).toEqual(vis);
            expect(seenEnemies(without, side).map((u) => u.id)).toEqual(seen);
          }
        }
      }),
      RUN
    );
  });

  // Т.18 (ADR-0087): найменший приклад знахідки Т.15. Лінія (2,0)→(0,1) проходить
  // через стіну (1,0), лінія (0,1)→(2,0) — повз неї. Лінія вогню чиста, якщо чиста
  // хоч в один бік, тож стріляють обидва.
  it('лінія вогню чиста, якщо чиста хоч в один бік: оперативник і демон стріляють одне в одного', () => {
    const s = build({ w: 5, h: 5, walls: [1], spots: [2, 5], seed: 0, low: [] }); // стіна (1,0), p0 у (2,0), a1 у (0,1)
    expect(hasLineOfSight(s, s.units[1].pos, s.units[0].pos, 'alien')).toBe(true);
    expect(hasLineOfSight(s, s.units[0].pos, s.units[1].pos, 'player')).toBe(true);
    expect(resolveAttack(s, 'p0', 'a1', 'snap').shots).toHaveLength(1);
    endTurn(s);
    expect(resolveAttack(s, 'a1', 'p0', 'snap').shots).toHaveLength(1);
  });
});
