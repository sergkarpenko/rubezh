// п20.2 (ADR-0165, ADR-0166): укриття цілі з боку стрільця, фланг, низькі перешкоди.
// Гейти байт-у-байт: бій без опції `cover` і мапа без поля `low` — як до п20.2.
import { describe, expect, it } from 'vitest';
import {
  COVER_MULT,
  HIT_CHANCE_CAP,
  HIT_CHANCE_FLOOR,
  RIFLE,
  calculateHitChance,
  coverOf,
  createGame,
  endTurn,
  hasLineOfSight,
  hasTerrainLine,
  isImpassable,
  makeUnit,
  moveUnit,
  mulberry32,
  preciseShot,
  resolveAttack,
  setOverwatch,
  shotCover,
  throwGrenade,
  type GameMap,
  type GameState,
  type RNG,
  type Unit,
  type Vec2,
} from './combat';
import { makeEnemy } from './enemies';
import { computeVisibleCells, findPath, makeTestMap, reachableCells } from './map';
import { ALIEN_SPAWN, LOW_FAR, LOW_NEAR_WALL, SQUAD_SPAWN, connectedMap, createMission } from './mission';
import { TURRET_SPAWN, createAssault, createGateMission } from './assault';
import { campaignTick } from './campaign';
import { createGeoGame, type GeoState } from './geo';
import { readySoldiers } from './squad';
import { createParty } from './save';

const k = (p: Vec2): string => p.x + ',' + p.y;
const mapOf = (walls: Vec2[], low: Vec2[] = [], w = 12, h = 12): GameMap => ({
  width: w,
  height: h,
  blocked: new Set(walls.map(k)),
  low: new Set(low.map(k)),
});
const T: Vec2 = { x: 5, y: 5 }; // ціль у тестах кута

describe('coverOf: сусід цілі з боку стрільця (кут ≤ 45°, цілочисельно)', () => {
  // стіна прямо на лінії ще й закриває вогонь — тоді стріляти нема як; повне укриття важить для ліній повз кут стіни
  it('стіна між ціллю і стрільцем — повне, низька перешкода — пів, нічого — фланг', () => {
    const east = { x: 10, y: 5 };
    expect(coverOf(mapOf([{ x: 6, y: 5 }]), T, east)).toBe('full');
    expect(coverOf(mapOf([], [{ x: 6, y: 5 }]), T, east)).toBe('half');
    expect(coverOf(mapOf([]), T, east)).toBe('none');
    // стіна з протилежного боку і збоку (90°) — не з боку стрільця
    expect(coverOf(mapOf([{ x: 4, y: 5 }]), T, east)).toBe('none');
    expect(coverOf(mapOf([{ x: 5, y: 4 }]), T, east)).toBe('none');
  });

  it('межа 45° включно: діагональний сусід при стрільці рівно на осі; за 45° — ні', () => {
    // b = (5, 0), a = (1, 1): кут рівно 45° — враховується (2·dot² = |a|²·|b|² = 50)
    expect(coverOf(mapOf([{ x: 6, y: 6 }]), T, { x: 10, y: 5 })).toBe('full');
    // b = (5, 1), a = (1, −1): dot 4, 2·16 = 32 < 2·26 = 52 — понад 45°
    expect(coverOf(mapOf([{ x: 6, y: 4 }]), T, { x: 10, y: 6 })).toBe('none');
    // той самий сусід при b = (5, 1) з боку a = (1, 1): dot 6, 72 ≥ 52 — враховується
    expect(coverOf(mapOf([{ x: 6, y: 6 }]), T, { x: 10, y: 6 })).toBe('full');
    // стрілець по діагоналі (b = (4, 4)): ортогональні сусіди (1, 0) і (0, 1) — рівно 45°
    expect(coverOf(mapOf([], [{ x: 6, y: 5 }]), T, { x: 9, y: 9 })).toBe('half');
    expect(coverOf(mapOf([], [{ x: 5, y: 6 }]), T, { x: 9, y: 9 })).toBe('half');
  });

  it('з кількох сусідів — найсильніше укриття', () => {
    const m = mapOf([{ x: 6, y: 6 }], [{ x: 6, y: 5 }]);
    expect(coverOf(m, T, { x: 10, y: 5 })).toBe('full');
    expect(
      coverOf(
        mapOf(
          [],
          [
            { x: 6, y: 5 },
            { x: 6, y: 4 },
          ]
        ),
        T,
        { x: 10, y: 5 }
      )
    ).toBe('half');
  });

  it('рішення власника п20.2 «Б»: стрілець впритул (і по діагоналі) — завжди фланг', () => {
    const m = mapOf([
      { x: 6, y: 4 },
      { x: 6, y: 6 },
      { x: 4, y: 4 },
    ]);
    expect(coverOf(m, T, { x: 6, y: 5 })).toBe('none'); // діагональні стіни біля цілі — у конусі, але впритул
    expect(coverOf(m, T, { x: 4, y: 5 })).toBe('none');
    expect(coverOf(mapOf([{ x: 6, y: 5 }]), T, { x: 6, y: 6 })).toBe('none'); // діагональний сусід
    // на відстані 2 те саме розташування вже дає укриття
    expect(coverOf(m, T, { x: 7, y: 5 })).toBe('full');
  });

  it('за межами мапи сусіда немає — фланг; юніти укриття не дають', () => {
    expect(coverOf(mapOf([], [], 6, 6), { x: 5, y: 5 }, { x: 5, y: 0 })).toBe('none');
    const s = createGame({
      map: mapOf([]),
      units: [mk('p', 'player', { x: 10, y: 5 }), mk('a', 'alien', T), mk('b', 'alien', { x: 6, y: 5 })],
      cover: true,
    });
    expect(shotCover(s, s.units[0], s.units[1])).toBe('none');
  });
});

function mk(id: string, side: 'player' | 'alien', pos: Vec2, extra: Partial<Unit> = {}): Unit {
  return makeUnit({ id, side, pos, ...extra });
}
const seq = (...xs: number[]): RNG => {
  let i = 0;
  return () => xs[Math.min(i++, xs.length - 1)];
};

describe('шанс: точність × режим × укриття (EARS 1)', () => {
  it('прицільний новобранця 69 %: пів 52 %, повне 35 %, фланг 83 % (ADR-0165 п. 1)', () => {
    const u = mk('p', 'player', T);
    expect(calculateHitChance(u, 'aimed')).toBeCloseTo(0.69, 10);
    expect(Math.round(calculateHitChance(u, 'aimed', 'half') * 100)).toBe(52);
    expect(Math.round(calculateHitChance(u, 'aimed', 'full') * 100)).toBe(35);
    expect(Math.round(calculateHitChance(u, 'aimed', 'none') * 100)).toBe(83);
    expect(COVER_MULT).toEqual({ none: 1.2, half: 0.75, full: 0.5 });
  });

  it('межі 0,02–0,95 діють після укриття', () => {
    expect(calculateHitChance(mk('p', 'player', T, { firingAccuracy: 0.9 }), 'aimed', 'none')).toBe(HIT_CHANCE_CAP);
    expect(calculateHitChance(mk('p', 'player', T, { firingAccuracy: 0.03 }), 'auto', 'full')).toBe(HIT_CHANCE_FLOOR);
  });

  it('без укриття — той самий вираз, що до п20.2 (байт-у-байт)', () => {
    for (const acc of [0.03, 0.4, 0.6, 0.63, 0.75, 0.9]) {
      const u = mk('p', 'player', T, { firingAccuracy: acc });
      for (const mode of ['auto', 'snap', 'aimed'] as const) {
        const mod = RIFLE.modes[mode].accuracyMod;
        expect(calculateHitChance(u, mode)).toBe(Math.min(HIT_CHANCE_CAP, Math.max(HIT_CHANCE_FLOOR, acc * mod)));
      }
    }
  });
});

// Стрілець (10,5), ціль (5,5), стіна на діагоналі (6,6) — у конусі рівно 45°, лінію вогню не закриває
// (стіна прямо між ними закрила б і лінію): прицільний 69 % → 35 %. Кидок 0,5 — влучання без укриття, промах з ним.
function duel(cover: boolean | undefined, low: Vec2[] = [], walls: Vec2[] = [{ x: 6, y: 6 }], rng: RNG = seq(0.5, 0)): GameState {
  return createGame({
    map: mapOf(walls, low),
    units: [mk('p', 'player', { x: 10, y: 5 }), mk('a', 'alien', T, { hp: 50, maxHp: 50 })],
    rng,
    cover,
  });
}

describe('постріл, дозор і «Точний постріл» з укриттям; бої без опції — як до п20.2', () => {
  it('опція cover: повне укриття — промах на кидку 0,5; без опції — влучання', () => {
    expect(resolveAttack(duel(true), 'p', 'a', 'aimed').shots[0].hit).toBe(false);
    expect(resolveAttack(duel(undefined), 'p', 'a', 'aimed').shots[0].hit).toBe(true);
    expect(resolveAttack(duel(false), 'p', 'a', 'aimed').shots[0].hit).toBe(true);
    // пів-укриття (52 %) кидок 0,5 ще влучає, 0,53 — ні
    expect(resolveAttack(duel(true, [{ x: 6, y: 5 }], [], seq(0.5, 0)), 'p', 'a', 'aimed').shots[0].hit).toBe(true);
    expect(resolveAttack(duel(true, [{ x: 6, y: 5 }], [], seq(0.53, 0)), 'p', 'a', 'aimed').shots[0].hit).toBe(false);
    // фланг (83 %): кидок 0,8 влучає з опцією і мимо без неї
    expect(resolveAttack(duel(true, [], [], seq(0.8, 0)), 'p', 'a', 'aimed').shots[0].hit).toBe(true);
    expect(resolveAttack(duel(undefined, [], [], seq(0.8, 0)), 'p', 'a', 'aimed').shots[0].hit).toBe(false);
  });

  it('бій без опції: стан без поля cover і журнал байт-у-байт із тим самим боєм на мапі без low', () => {
    const a = duel(undefined, [{ x: 9, y: 9 }], [{ x: 6, y: 6 }], mulberry32(7));
    expect('cover' in a).toBe(false);
    const b = createGame({
      map: { width: 12, height: 12, blocked: new Set(['6,6']) },
      units: [mk('p', 'player', { x: 10, y: 5 }), mk('a', 'alien', T, { hp: 50, maxHp: 50 })],
      rng: mulberry32(7),
    });
    for (const g of [a, b]) {
      resolveAttack(g, 'p', 'a', 'auto');
      resolveAttack(g, 'p', 'a', 'snap');
    }
    expect(JSON.stringify(a.log)).toBe(JSON.stringify(b.log));
  });

  it('дозор: снеп × 0,7 × укриття (0,6 × 0,8 × 0,7 = 33,6 % → повне 16,8 %)', () => {
    const run = (cover: boolean | undefined): boolean => {
      // дозорець (10,5) дивиться на ворога, що йде (5,4) → (5,5) зі стіною на діагоналі (6,6)
      const s = createGame({
        map: mapOf([{ x: 6, y: 6 }]),
        units: [mk('p', 'player', { x: 10, y: 5 }), mk('a', 'alien', { x: 5, y: 4 }, { hp: 50, maxHp: 50 })],
        rng: seq(0.2, 0),
        cover,
      });
      setOverwatch(s, 'p');
      endTurn(s);
      moveUnit(s, 'a', [T]);
      const shot = s.log.find((e) => e.type === 'shot');
      return shot !== undefined && shot.type === 'shot' && shot.hit;
    };
    expect(run(undefined)).toBe(true);
    expect(run(true)).toBe(false);
  });

  it('«Точний постріл» бере укриття цілі', () => {
    const s = createGame({
      map: mapOf([{ x: 6, y: 6 }]),
      units: [mk('p', 'player', { x: 10, y: 5 }), mk('a', 'alien', T, { hp: 50, maxHp: 50 })],
      rng: seq(0.5, 0),
      cover: true,
      roles: { p: { role: 'sniper', used: false } },
    });
    expect(preciseShot(s, 'p', 'a').shots[0].hit).toBe(false);
  });

  it('«Кігті» (зброя з дальністю 1) — без укриття і без флангу: шанс як до п20.2', () => {
    const hound = makeEnemy('hound', 'h', 0, { x: 6, y: 5 });
    expect(hound.weapon.range).toBe(1);
    const s = createGame({ map: mapOf([{ x: 5, y: 4 }]), units: [mk('p', 'player', T), hound], cover: true, startingSide: 'alien' });
    expect(shotCover(s, hound, s.units[0])).toBeUndefined();
    const rifleman = mk('q', 'alien', { x: 9, y: 5 });
    expect(shotCover({ ...s, units: [...s.units, rifleman] }, rifleman, s.units[0])).toBe('none');
  });

  it('граната укриття не зважає і низька перешкода її лінії не закриває', () => {
    const run = (cover: boolean | undefined) => {
      const s = createGame({
        map: mapOf([{ x: 6, y: 6 }], [{ x: 7, y: 5 }]),
        units: [mk('p', 'player', { x: 9, y: 5 }), mk('a', 'alien', T, { hp: 50, maxHp: 50 })],
        rng: seq(0.4),
        items: { p: { medkit: false, grenade: true } },
        cover,
      });
      expect(hasTerrainLine(s, { x: 9, y: 5 }, T)).toBe(true);
      return throwGrenade(s, 'p', T).damage;
    };
    expect(run(true)).toBe(run(undefined));
  });
});

describe('низькі перешкоди: не проходяться, огляд і вогонь не закривають (EARS 3)', () => {
  const lowWall: Vec2[] = [
    { x: 3, y: 0 },
    { x: 3, y: 1 },
    { x: 3, y: 2 },
  ];
  const state = (): GameState =>
    createGame({ map: mapOf([], lowWall, 6, 3), units: [mk('p', 'player', { x: 1, y: 1 }), mk('a', 'alien', { x: 5, y: 1 })] });

  it('крок у низьку перешкоду — помилка; шлях і зона руху її обходять', () => {
    const s = state();
    expect(isImpassable(s.map, { x: 3, y: 1 })).toBe(true);
    expect(() =>
      moveUnit(s, 'p', [
        { x: 2, y: 1 },
        { x: 3, y: 1 },
      ])
    ).toThrow('Крок у перешкоду');
    expect(s.units[0].pos).toEqual({ x: 2, y: 1 }); // пройдений крок лишається
    expect(findPath(state(), { x: 1, y: 1 }, { x: 4, y: 1 })).toBeNull(); // ряд перешкод — суцільний
    expect(reachableCells(state(), { x: 1, y: 1 }, 10).has('3,1')).toBe(false);
    const open = createGame({ map: mapOf([], [{ x: 3, y: 1 }], 6, 3), units: [mk('p', 'player', { x: 1, y: 1 })] });
    expect(findPath(open, { x: 1, y: 1 }, { x: 4, y: 1 })).toHaveLength(5); // обхід
  });

  it('огляд і лінія вогню крізь низьку перешкоду чисті; постріл через неї дозволено', () => {
    const s = state();
    expect(hasLineOfSight(s, { x: 1, y: 1 }, { x: 5, y: 1 }, 'player')).toBe(true);
    expect(computeVisibleCells(s, { x: 1, y: 1 }, 'player').has('5,1')).toBe(true);
    expect(resolveAttack(s, 'p', 'a', 'snap').shots).toHaveLength(1);
  });
});

function geoWith(): GeoState {
  const g = createGeoGame({ seed: 9, spawnChance: 0 });
  g.probes.push({
    id: 'u1',
    kind: 'розвідник',
    pos: { ...g.base },
    target: { ...g.base },
    detected: true,
    status: 'приземлився',
    landedTicksLeft: 8,
  });
  return g;
}

// BFS по прохідних клітинках (стіни і низькі перешкоди — ні).
function reach(map: GameMap, from: Vec2): Set<string> {
  const seen = new Set([k(from)]);
  const q = [from];
  for (let p = q.shift(); p !== undefined; p = q.shift())
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const n = { x: p.x + dx, y: p.y + dy };
      if (n.x < 0 || n.y < 0 || n.x >= map.width || n.y >= map.height || seen.has(k(n)) || isImpassable(map, n)) continue;
      seen.add(k(n));
      q.push(n);
    }
  return seen;
}

describe('мапа місії: низькі перешкоди ≈ 5 %, біля стін частіше, зв’язність (ADR-0166)', () => {
  it('≈ 5 % клітинок на 300 сідах, частка біля стін — більша; стіни ті самі, що в makeTestMap', () => {
    let low = 0;
    let near = 0;
    let cells = 0;
    for (let s = 1; s <= 300; s++) {
      const m = connectedMap(s * 7919);
      cells += m.width * m.height;
      for (const c of m.low ?? []) {
        low += 1;
        const [x, y] = c.split(',').map(Number);
        let n = false;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && m.blocked.has(x + dx + ',' + (y + dy))) n = true;
        if (n) near += 1;
        expect(m.blocked.has(c)).toBe(false);
      }
    }
    expect(low / cells).toBeGreaterThan(0.04);
    expect(low / cells).toBeLessThan(0.06);
    expect(near / low).toBeGreaterThan(0.5); // біля стін ≈ половина клітинок, а перешкод там ≈ 60 %
    expect(LOW_NEAR_WALL).toBeGreaterThan(LOW_FAR);
  });

  it('стіни — байт-у-байт як до п20.2: перша зв’язна мапа makeTestMap; детермінізм', () => {
    for (let s = 1; s <= 40; s++) {
      const m = connectedMap(s * 131);
      let i = 0;
      // перша зв'язна мапа без низьких перешкод — та, що лишає connectedMap
      for (; i < 50; i++) if (reach(makeTestMap(s * 131 + i), SQUAD_SPAWN[0]).has(k(ALIEN_SPAWN[0]))) break;
      expect([...m.blocked]).toEqual([...makeTestMap(s * 131 + i).blocked]);
      expect([...(connectedMap(s * 131).low ?? [])]).toEqual([...(m.low ?? [])]);
    }
  });

  it('зони висадки, НЛО і турелей чисті; висадка і зона ворогів досяжні', () => {
    for (let s = 1; s <= 200; s++) {
      const m = connectedMap(s * 977);
      for (const c of [
        { x: 2, y: 2 },
        { x: 17, y: 2 },
      ])
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) expect(m.low?.has(c.x + dx + ',' + (c.y + dy))).toBe(false);
      for (const t of TURRET_SPAWN) expect(m.low?.has(k(t))).toBe(false);
      const r = reach(m, SQUAD_SPAWN[0]);
      for (const c of [...SQUAD_SPAWN, ...ALIEN_SPAWN]) expect(r.has(k(c))).toBe(true);
    }
  });

  it('усі три бої місій — з опцією cover і низькими перешкодами (посадка, штурм, фінал)', () => {
    const m = createMission(geoWith(), 'u1');
    expect(m.state.cover).toBe(true);
    expect(m.state.map.low?.size ?? 0).toBeGreaterThan(0);

    const p = createParty(42);
    p.campaign.threat = 60;
    p.campaign.threatCursor = p.geo.log.length;
    campaignTick({ geo: p.geo, roster: p.roster, econ: p.econ }, p.campaign);
    const a = createAssault(p, { squad: readySoldiers(p.roster).slice(0, 3) });
    expect(a.state.cover).toBe(true);
    expect(a.state.map.low).toBeDefined();

    const q = createParty(43);
    q.research.completed.push('gate-key');
    const g = createGateMission(q, { squad: readySoldiers(q.roster).slice(0, 3) });
    expect(g.state.cover).toBe(true);
    const r = reach(g.state.map, SQUAD_SPAWN[0]);
    for (const e of g.state.units.filter((u) => u.side === 'alien')) expect(r.has(k(e.pos))).toBe(true);
  });
});
