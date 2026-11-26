// src/core/enemies.test.ts
// п17.2 (ADR-0149 п. 2–3, 8–12): типи ворогів, броня, режими зброї, склад місії за добою;
// п18.3 (ADR-0153 п. 14): склад — за загрозою кампанії (kindsForThreat, пороги 8 / 17 / 27).

import { describe, expect, it } from 'vitest';
import {
  ALIEN_CUTTER,
  RIFLE,
  createGame,
  makeUnit,
  mulberry32,
  preciseShot,
  resolveAttack,
  setOverwatch,
  moveUnit,
  endTurn,
  throwGrenade,
  weaponHasMode,
  type GameMap,
  type GameState,
  type RNG,
  type Unit,
} from './combat';
import { bestShootMode } from './ai-utils';
import {
  ENEMY_KINDS,
  ENEMY_MIX_SALT,
  ENEMY_ORDER,
  EYE_BEAM,
  GOLEM_CANNON,
  HOUND_CLAWS,
  enemyKind,
  enemyMix,
  kindsForThreat,
  makeEnemies,
  makeEnemy,
} from './enemies';
import { createGeoGame, type GeoState } from './geo';
import { ALIEN_SPAWN, createMission, missionSeed } from './mission';

const openMap = (w = 12, h = 12): GameMap => ({ width: w, height: h, blocked: new Set() });

// RNG з чергою значень: кидок влучності, потім кидок шкоди
function seq(...xs: number[]): RNG {
  let i = 0;
  return () => xs[i++ % xs.length];
}

function duel(shooter: Unit, target: Unit, rng: RNG, side: 'player' | 'alien' = 'player'): GameState {
  return createGame({ map: openMap(), units: [shooter, target], rng, startingSide: side });
}

describe('п17.2: довідник типів (ADR-0149 п. 2)', () => {
  it('числа типів — таблиця ADR-0149 п. 2', () => {
    expect(ENEMY_KINDS.demon).toMatchObject({
      name: 'Демон',
      hp: 10,
      ap: 10,
      accuracy: [0.5, 0.45, 0.4],
      weapon: ALIEN_CUTTER,
      armor: 0,
      fromThreat: 0,
    });
    expect(ENEMY_KINDS.hound).toMatchObject({ name: 'Гончак', hp: 7, ap: 14, accuracy: [0.85], armor: 0, fromThreat: 8 });
    expect(ENEMY_KINDS.golem).toMatchObject({ name: 'Голем', hp: 16, ap: 8, accuracy: [0.4], armor: 2, fromThreat: 17 });
    expect(ENEMY_KINDS.eye).toMatchObject({ name: 'Око', hp: 8, ap: 10, accuracy: [0.65], armor: 0, fromThreat: 27 });
    expect(HOUND_CLAWS).toMatchObject({ name: 'Кігті', damage: [3, 6], range: 1, only: ['snap'] });
    expect(HOUND_CLAWS.modes.snap).toEqual({ apCost: 3, accuracyMod: 1, shots: 1 });
    expect(GOLEM_CANNON).toMatchObject({ name: 'Гармата', damage: [3, 6], range: 8 });
    expect(GOLEM_CANNON.only).toBeUndefined();
    expect(EYE_BEAM).toMatchObject({ name: 'Промінь', damage: [3, 7], range: 16, only: ['aimed'] });
  });

  it('зброя з only — профілі недоступних режимів дорівнюють дозволеному', () => {
    expect(HOUND_CLAWS.modes.auto).toEqual(HOUND_CLAWS.modes.snap);
    expect(HOUND_CLAWS.modes.aimed).toEqual(HOUND_CLAWS.modes.snap);
    expect(EYE_BEAM.modes.snap).toEqual(ALIEN_CUTTER.modes.aimed);
    expect(EYE_BEAM.modes.auto).toEqual(ALIEN_CUTTER.modes.aimed);
    expect(weaponHasMode(RIFLE, 'auto')).toBe(true);
    expect(weaponHasMode(HOUND_CLAWS, 'snap')).toBe(true);
    expect(weaponHasMode(HOUND_CLAWS, 'aimed')).toBe(false);
    expect(weaponHasMode(EYE_BEAM, 'aimed')).toBe(true);
    expect(weaponHasMode(EYE_BEAM, 'snap')).toBe(false);
  });

  it('демон — без полів kind і armor; нові типи — з ними і своїми HP/AP', () => {
    const d = makeEnemy('demon', 'a1', 0, { x: 1, y: 1 });
    expect('kind' in d).toBe(false);
    expect('armor' in d).toBe(false);
    expect(d).toEqual(
      makeUnit({ id: 'a1', side: 'alien', name: 'Демон 1', pos: { x: 1, y: 1 }, firingAccuracy: 0.5, weapon: ALIEN_CUTTER })
    );
    expect(enemyKind(d)).toBe('demon');
    const h = makeEnemy('hound', 'a2', 0, { x: 2, y: 1 });
    expect(h).toMatchObject({
      name: 'Гончак 1',
      kind: 'hound',
      hp: 7,
      maxHp: 7,
      ap: 14,
      maxAp: 14,
      firingAccuracy: 0.85,
      weapon: HOUND_CLAWS,
    });
    expect('armor' in h).toBe(false);
    const g = makeEnemy('golem', 'a3', 0, { x: 3, y: 1 });
    expect(g).toMatchObject({ name: 'Голем 1', kind: 'golem', hp: 16, ap: 8, armor: 2, firingAccuracy: 0.4 });
    const e = makeEnemy('eye', 'a4', 1, { x: 4, y: 1 });
    expect(e).toMatchObject({ name: 'Око 2', kind: 'eye', hp: 8, ap: 10, firingAccuracy: 0.65 });
    expect(enemyKind(e)).toBe('eye');
  });

  it('makeEnemies: id за порядком, ім’я і точність — за порядком серед свого типу', () => {
    const us = makeEnemies(['demon', 'hound', 'demon', 'hound'], [...ALIEN_SPAWN, { x: 15, y: 2 }]);
    expect(us.map((u) => u.id)).toEqual(['a1', 'a2', 'a3', 'a4']);
    expect(us.map((u) => u.name)).toEqual(['Демон 1', 'Гончак 1', 'Демон 2', 'Гончак 2']);
    expect(us.map((u) => u.firingAccuracy)).toEqual([0.5, 0.85, 0.45, 0.85]);
    expect(us[3].pos).toEqual({ x: 15, y: 2 });
  });
});

describe('п18.3: склад місії за загрозою (ADR-0153 п. 14, ADR-0149 п. 8, 12; EARS 5)', () => {
  it('доступні типи: загроза < 8 — демон, з 8 — гончак, з 17 — голем, з 27 — око', () => {
    expect(ENEMY_ORDER.map((k) => ENEMY_KINDS[k].fromThreat)).toEqual([0, 8, 17, 27]);
    expect(kindsForThreat(0)).toEqual(['demon']);
    expect(kindsForThreat(7)).toEqual(['demon']);
    expect(kindsForThreat(8)).toEqual(['demon', 'hound']);
    expect(kindsForThreat(16)).toEqual(['demon', 'hound']);
    expect(kindsForThreat(17)).toEqual(['demon', 'hound', 'golem']);
    expect(kindsForThreat(26)).toEqual(['demon', 'hound', 'golem']);
    expect(kindsForThreat(27)).toEqual([...ENEMY_ORDER]);
    expect(kindsForThreat(100)).toEqual([...ENEMY_ORDER]);
  });

  it('лише демони — без витягання чисел; n ≤ 0 — порожньо', () => {
    for (let t = 0; t < 8; t++) expect(enemyMix(kindsForThreat(t), 3, 123)).toEqual(['demon', 'demon', 'demon']);
    expect(enemyMix(ENEMY_ORDER, 0, 1)).toEqual([]);
    expect(enemyMix(ENEMY_ORDER, 1, 1)).toEqual(['demon']);
  });

  it('перший — демон; решта — з доступних; голем ≤ 1; детерміновано від сіду', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 400; seed++) {
      for (const threat of [8, 17, 27, 60]) {
        const avail = kindsForThreat(threat);
        const mix = enemyMix(avail, 3, seed);
        expect(mix).toEqual(enemyMix(avail, 3, seed));
        expect(mix[0]).toBe('demon');
        expect(mix.every((k) => avail.includes(k))).toBe(true);
        expect(mix.filter((k) => k === 'golem').length).toBeLessThanOrEqual(1);
        seen.add(threat + ':' + mix.slice(1).join(','));
      }
    }
    // усі доступні типи справді трапляються (і повторний вибір голема перевибирається)
    for (const k of ['demon', 'hound']) expect(seen.has('8:' + k + ',' + k)).toBe(true);
    expect(seen.has('17:golem,hound') || seen.has('17:hound,golem')).toBe(true);
    expect(seen.has('17:golem,golem')).toBe(false);
    expect([...seen].some((s) => s.startsWith('27:') && s.includes('eye'))).toBe(true);
  });

  it('склад — окремий генератор mulberry32(seed ^ ENEMY_MIX_SALT)', () => {
    const r = mulberry32((77 ^ ENEMY_MIX_SALT) >>> 0);
    const avail = kindsForThreat(8);
    expect(enemyMix(avail, 3, 77)).toEqual(['demon', avail[Math.floor(r() * 2)], avail[Math.floor(r() * 2)]]);
  });
});

// Геопартія з приземленим НЛО на заданій добі (спавн вимкнено)
function geoOnDay(day: number, kind: 'розвідник' | 'збирач' = 'збирач'): GeoState {
  const g = createGeoGame({ seed: 9, spawnChance: 0 });
  g.minute = (day - 1) * 1440 + 600;
  g.ufos.push({ id: 'u1', kind, pos: { ...g.base }, target: { ...g.base }, detected: true, status: 'приземлився', landedTicksLeft: 8 });
  return g;
}

describe('п18.3: createMission за загрозою (EARS 5)', () => {
  it('загроза < 8 (і без поля threat): лише демони, як до фази 17 (поля, імена, точність) — доба не важить', () => {
    for (const m of [
      createMission(geoOnDay(5), 'u1'),
      createMission(geoOnDay(25), 'u1'),
      createMission(geoOnDay(25), 'u1', { threat: 7 }),
    ]) {
      const aliens = m.state.units.filter((u) => u.side === 'alien');
      expect(aliens.map((u) => u.name)).toEqual(['Демон 1', 'Демон 2', 'Демон 3']);
      expect(aliens.map((u) => u.firingAccuracy)).toEqual([0.5, 0.45, 0.4]);
      expect(aliens.every((u) => !('kind' in u) && !('armor' in u) && u.weapon === ALIEN_CUTTER)).toBe(true);
      expect(m.briefing.aliens).toBe(3);
    }
  });

  it('загроза 8+: склад — enemyMix(kindsForThreat(загроза), n, сід місії), бойовий RNG — як без складу', () => {
    for (const threat of [8, 17, 27, 60]) {
      const g = geoOnDay(3);
      const m = createMission(g, 'u1', { threat });
      const kinds = m.state.units.filter((u) => u.side === 'alien').map((u) => enemyKind(u));
      expect(kinds).toEqual(enemyMix(kindsForThreat(threat), 3, missionSeed(g, 'u1')));
      // бойовий RNG не зсунуто: перше число — як у mulberry32(сід місії)
      expect(m.state.rng()).toBe(mulberry32(missionSeed(g, 'u1'))());
    }
  });

  it('на загрозі 8+ трапляються нові типи; ім’я — «<назва> <N>»', () => {
    const names = new Set<string>();
    for (let d = 1; d <= 25; d++) {
      for (const u of createMission(geoOnDay(d), 'u1', { threat: 30 }).state.units) if (u.side === 'alien') names.add(u.name);
    }
    expect(names.has('Гончак 1')).toBe(true);
    expect([...names].some((n) => n.startsWith('Голем'))).toBe(true);
    expect(names.has('Голем 2')).toBe(false);
  });
});

describe('п17.2: броня голема (ADR-0149 п. 5, 11; EARS 4)', () => {
  const soldier = (): Unit => makeUnit({ id: 's1', side: 'player', pos: { x: 1, y: 1 }, firingAccuracy: 0.9, weapon: RIFLE });

  it('влучання — на 2 менше; подія і число — після броні', () => {
    const g = makeEnemy('golem', 'a1', 0, { x: 4, y: 1 });
    // кидок 0 — влучання; кидок шкоди 0,99 → 6 (RIFLE 3–6)
    const st = duel(soldier(), g, seq(0, 0.99));
    const r = resolveAttack(st, 's1', 'a1', 'snap');
    expect(r.shots).toEqual([{ hit: true, damage: 4 }]);
    expect(g.hp).toBe(12);
    expect(st.log.at(-1)).toEqual({ type: 'shot', shooterId: 's1', targetId: 'a1', mode: 'snap', hit: true, damage: 4 });
  });

  it('шкода після броні — не менше 1', () => {
    const g = makeEnemy('golem', 'a1', 0, { x: 4, y: 1 });
    const weak = makeUnit({ id: 's1', side: 'player', pos: { x: 1, y: 1 }, firingAccuracy: 0.9, weapon: { ...RIFLE, damage: [1, 2] } });
    const st = duel(weak, g, seq(0, 0));
    expect(resolveAttack(st, 's1', 'a1', 'snap').shots[0]).toEqual({ hit: true, damage: 1 });
    expect(g.hp).toBe(15);
  });

  it('«Точний постріл»: множник — до броні (6 × 1,5 = 9 → 7)', () => {
    const g = makeEnemy('golem', 'a1', 0, { x: 4, y: 1 });
    const s = soldier();
    const st = createGame({ map: openMap(), units: [s, g], rng: seq(0, 0.99), roles: { s1: { role: 'sniper', used: false } } });
    expect(preciseShot(st, 's1', 'a1').shots[0]).toEqual({ hit: true, damage: 7 });
    expect(g.hp).toBe(9);
  });

  it('дозор оперативника по голему — теж мінус броня', () => {
    const s = soldier();
    const g = makeEnemy('golem', 'a1', 0, { x: 4, y: 1 });
    const st = duel(s, g, seq(0, 0.99));
    setOverwatch(st, 's1');
    endTurn(st);
    moveUnit(st, 'a1', [{ x: 4, y: 2 }]);
    const shot = st.log.find((e) => e.type === 'shot');
    expect(shot).toMatchObject({ shooterId: 's1', hit: true, damage: 4 });
  });

  it('граната б’є голема повною шкодою', () => {
    const s = soldier();
    const g = makeEnemy('golem', 'a1', 0, { x: 4, y: 1 });
    const st = createGame({ map: openMap(), units: [s, g], rng: seq(0.99), items: { s1: { medkit: false, grenade: true } } });
    expect(throwGrenade(st, 's1', { x: 4, y: 1 }).damage).toBe(5);
    expect(g.hp).toBe(11);
  });
});

describe('п17.2: режими зброї і ближній бій (ADR-0149 п. 10; EARS 3, 5)', () => {
  const target = (x: number, y: number): Unit => makeUnit({ id: 's1', side: 'player', pos: { x, y } });

  it('гончак б’є впритул (і по діагоналі), 3 AP, шанс 85 %', () => {
    const h = makeEnemy('hound', 'a1', 0, { x: 5, y: 5 });
    const st = duel(h, target(6, 6), seq(0.84, 0), 'alien');
    const r = resolveAttack(st, 'a1', 's1', 'snap');
    expect(r.shots).toEqual([{ hit: true, damage: 3 }]);
    expect(h.ap).toBe(11);
    const miss = duel(makeEnemy('hound', 'a1', 0, { x: 5, y: 5 }), target(5, 6), seq(0.85), 'alien');
    expect(resolveAttack(miss, 'a1', 's1', 'snap').shots[0].hit).toBe(false);
  });

  it('гончак не б’є далі сусідньої клітинки — причина українською', () => {
    const st = duel(makeEnemy('hound', 'a1', 0, { x: 5, y: 5 }), target(7, 5), seq(0), 'alien');
    expect(() => resolveAttack(st, 'a1', 's1', 'snap')).toThrow('Ціль не впритул: «Кігті» б’ють лише сусідню клітинку');
  });

  it('режим, якого немає у зброї, — відмова з причиною', () => {
    const hs = duel(makeEnemy('hound', 'a1', 0, { x: 5, y: 5 }), target(5, 6), seq(0), 'alien');
    expect(() => resolveAttack(hs, 'a1', 's1', 'auto')).toThrow('Зброя «Кігті» не має режиму «Черга»');
    expect(() => resolveAttack(hs, 'a1', 's1', 'aimed')).toThrow('Зброя «Кігті» не має режиму «Прицільний»');
    const es = duel(makeEnemy('eye', 'a1', 0, { x: 0, y: 0 }), target(10, 10), seq(0, 0), 'alien');
    expect(() => resolveAttack(es, 'a1', 's1', 'snap')).toThrow('Зброя «Промінь» не має режиму «Швидкий»');
    const r = resolveAttack(es, 'a1', 's1', 'aimed');
    expect(r.shots).toEqual([{ hit: true, damage: 3 }]);
  });

  it('око: дальність 16, шанс 0,65 × 1,15', () => {
    const e = makeEnemy('eye', 'a1', 0, { x: 0, y: 0 });
    const st = createGame({ map: openMap(20, 20), units: [e, target(16, 3)], rng: seq(0.747, 0), startingSide: 'alien' });
    expect(resolveAttack(st, 'a1', 's1', 'aimed').shots[0].hit).toBe(true);
    const far = createGame({
      map: openMap(20, 20),
      units: [makeEnemy('eye', 'a1', 0, { x: 0, y: 0 }), target(17, 3)],
      startingSide: 'alien',
    });
    expect(() => resolveAttack(far, 'a1', 's1', 'aimed')).toThrow('Ціль поза дальністю зброї');
  });

  it('дозор ока — прицільний профіль зі штрафом, подія з режимом aimed', () => {
    const e = makeEnemy('eye', 'a1', 0, { x: 0, y: 0 });
    const s = target(10, 0);
    const st = createGame({ map: openMap(), units: [e, s], rng: seq(0, 0), startingSide: 'alien' });
    setOverwatch(st, 'a1');
    endTurn(st);
    moveUnit(st, 's1', [{ x: 10, y: 1 }]);
    expect(st.log.find((x) => x.type === 'shot')).toMatchObject({ shooterId: 'a1', mode: 'aimed', hit: true, damage: 3 });
  });

  it('bestShootMode: лише режими зброї — гончак snap, око aimed, демон — як раніше', () => {
    const h = makeEnemy('hound', 'a1', 0, { x: 5, y: 5 });
    const s = target(5, 6);
    const st = duel(h, s, seq(0), 'alien');
    expect(bestShootMode(st, h, s)).toBe('snap');
    h.pos = { x: 5, y: 3 };
    expect(bestShootMode(st, h, s)).toBeNull();
    const e = makeEnemy('eye', 'a1', 0, { x: 0, y: 0 });
    const t2 = target(9, 9);
    const st2 = duel(e, t2, seq(0), 'alien');
    expect(bestShootMode(st2, e, t2)).toBe('aimed');
    e.ap = 4;
    expect(bestShootMode(st2, e, t2)).toBeNull();
    const d = makeEnemy('demon', 'a1', 0, { x: 0, y: 0 });
    const st3 = duel(d, t2, seq(0), 'alien');
    expect(bestShootMode(st3, d, t2)).toBe('auto');
  });
});
