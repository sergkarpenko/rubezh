// src/core/ai-bot-evac.test.ts
// Т.76 (П15.5, ADR-0075): політика евакуації бота (EvacPolicy, ai-bot.ts) і її
// шлях у бот партії (party-bot.ts). Без політики бот не евакуює — бої й
// партії байт-у-байт як до Т.76.

import { describe, expect, it } from 'vitest';
import { createGame, makeUnit, mulberry32, type GameState, type Unit } from './combat';
import { advanceTime, createGeoGame, type GeoState } from './geo';
import { autoBattle, botTurn, type EvacPolicy } from './ai-bot';
import { createMission, missionOutcome, type Mission } from './mission';
import { createRoster, missionSquad } from './squad';
import { DEFAULT_PARTY_POLICY, simulateParty } from './party-bot';

function mkGeo(ufoId: string): GeoState {
  const g = createGeoGame({ seed: 9, spawnChance: 0 });
  advanceTime(g, 0);
  g.ufos.push({
    id: ufoId,
    kind: 'розвідник',
    pos: { ...g.base },
    target: { ...g.base },
    detected: true,
    status: 'приземлився',
    landedTicksLeft: 16,
  });
  return g;
}

function mkMission(seedId = 'u1'): Mission {
  return createMission(mkGeo(seedId), seedId, { squad: missionSquad(createRoster()) });
}

// Поле 20×20 без перешкод: зона висадки (2,2)/(3,2); солдати і прибулець задаються тестом.
function field(units: Unit[]): GameState {
  return createGame({
    map: { width: 20, height: 20, blocked: new Set() },
    rng: mulberry32(42),
    startingSide: 'player',
    units,
    evacZone: [
      { x: 2, y: 2 },
      { x: 3, y: 2 },
    ],
  });
}

const evacs = (g: GameState) => g.log.filter((e) => e.type === 'evac_unit').map((e) => (e as { unitId: string }).unitId);

describe('Т.76: без політики евакуації бій не змінюється', () => {
  it('порожня політика і її відсутність — той самий лог авто-бою, жодної евакуації', () => {
    const a = mkMission();
    const b = mkMission();
    const c = mkMission();
    autoBattle(a.state);
    autoBattle(b.state, undefined, {});
    autoBattle(c.state, undefined, { woundedAtOrBelow: 0 });
    expect(JSON.stringify(b.state.log)).toBe(JSON.stringify(a.state.log));
    expect(JSON.stringify(c.state.log)).toBe(JSON.stringify(a.state.log));
    expect(evacs(a.state)).toEqual([]);
  });

  it('без зони висадки (демо-бій) політика нічого не робить', () => {
    const mk = () =>
      createGame({
        map: { width: 20, height: 20, blocked: new Set() },
        rng: mulberry32(42),
        startingSide: 'player',
        units: [
          makeUnit({ id: 's1', side: 'player', pos: { x: 2, y: 2 }, hp: 1 }),
          makeUnit({ id: 'a1', side: 'alien', pos: { x: 6, y: 2 } }),
        ],
      });
    const plain = mk();
    const evac = mk();
    botTurn(plain);
    botTurn(evac, { woundedAtOrBelow: 0.5, lastStanding: 3 });
    expect(JSON.stringify(evac.log)).toBe(JSON.stringify(plain.log));
  });
});

describe('Т.76: умови відступу', () => {
  it('woundedAtOrBelow: поранений у зоні евакуюється, здоровий б’ється', () => {
    const g = field([
      makeUnit({ id: 's1', side: 'player', pos: { x: 2, y: 2 }, hp: 5 }),
      makeUnit({ id: 's2', side: 'player', pos: { x: 3, y: 2 } }),
      makeUnit({ id: 'a1', side: 'alien', pos: { x: 8, y: 2 }, hp: 100, maxHp: 100 }),
    ]);
    botTurn(g, { woundedAtOrBelow: 0.5 });
    expect(evacs(g)).toEqual(['s1']);
    const shooters = g.log.filter((e) => e.type === 'shot').map((e) => (e as { shooterId: string }).shooterId);
    expect(shooters.length).toBeGreaterThan(0);
    expect(shooters.every((id) => id === 's2')).toBe(true);
    expect(g.units.map((u) => u.id)).toEqual(['s2', 'a1']);
  });

  it('поріг строгий згори: hp більше частки — не відступає', () => {
    const g = field([
      makeUnit({ id: 's1', side: 'player', pos: { x: 2, y: 2 }, hp: 6 }),
      makeUnit({ id: 'a1', side: 'alien', pos: { x: 8, y: 2 }, hp: 100, maxHp: 100 }),
    ]);
    botTurn(g, { woundedAtOrBelow: 0.5 });
    expect(evacs(g)).toEqual([]);
  });

  it('поранений поза зоною йде до зони, а не стріляє; і в тому ж ході евакуюється', () => {
    const g = field([
      makeUnit({ id: 's1', side: 'player', pos: { x: 6, y: 2 }, hp: 3 }),
      makeUnit({ id: 'a1', side: 'alien', pos: { x: 9, y: 2 }, hp: 100, maxHp: 100 }),
    ]);
    botTurn(g, { woundedAtOrBelow: 0.5 });
    expect(g.log.some((e) => e.type === 'shot')).toBe(false);
    expect(g.evacuated![0].pos).toEqual({ x: 3, y: 2 }); // найближча клітинка зони, 3 кроки
    expect(evacs(g)).toEqual(['s1']); // AP вистачило і на рух, і на евакуацію
    expect(missionOutcome(g)).toBe('евакуйовано');
  });

  it('до зони шляху немає — поранений діє як без політики', () => {
    const mk = () =>
      createGame({
        map: { width: 20, height: 20, blocked: new Set(['5,6', '6,5', '6,7', '7,6']) },
        rng: mulberry32(42),
        startingSide: 'player',
        units: [
          makeUnit({ id: 's1', side: 'player', pos: { x: 6, y: 6 }, hp: 2 }),
          makeUnit({ id: 'a1', side: 'alien', pos: { x: 9, y: 6 } }),
        ],
        evacZone: [{ x: 2, y: 2 }],
      });
    const plain = mk();
    const evac = mk();
    botTurn(plain);
    botTurn(evac, { woundedAtOrBelow: 0.5 });
    expect(evacs(evac)).toEqual([]);
    expect(JSON.stringify(evac.log)).toBe(JSON.stringify(plain.log));
  });

  it('у зоні, але AP менше 2 — чекає, хід передано без дій', () => {
    const g = field([
      makeUnit({ id: 's1', side: 'player', pos: { x: 2, y: 2 }, hp: 3 }),
      makeUnit({ id: 'a1', side: 'alien', pos: { x: 15, y: 15 } }),
    ]);
    g.units[0].ap = 1; // createGame видає повні AP — залишок задаємо після
    expect(botTurn(g, { woundedAtOrBelow: 0.5 })).toBe(0);
    expect(evacs(g)).toEqual([]);
    expect(g.activeSide).toBe('alien');
  });

  it('lastStanding: живих на полі не більше N — відступають усі', () => {
    const g = field([
      makeUnit({ id: 's1', side: 'player', pos: { x: 2, y: 2 } }),
      makeUnit({ id: 's2', side: 'player', pos: { x: 3, y: 2 } }),
      makeUnit({ id: 'a1', side: 'alien', pos: { x: 15, y: 15 } }),
    ]);
    botTurn(g, { lastStanding: 2 });
    expect(evacs(g)).toEqual(['s1', 's2']);
    expect(missionOutcome(g)).toBe('евакуйовано');
  });

  it('outnumbered: видимих ворогів більше, ніж живих солдатів — відступ; рівно стільки ж — бій', () => {
    const mk = (aliens: number) =>
      field([
        makeUnit({ id: 's1', side: 'player', pos: { x: 2, y: 2 } }),
        ...Array.from({ length: aliens }, (_, i) => makeUnit({ id: 'a' + i, side: 'alien', pos: { x: 8, y: 2 + i }, hp: 100, maxHp: 100 })),
      ]);
    const two = mk(2);
    botTurn(two, { outnumbered: true });
    expect(evacs(two)).toEqual(['s1']);
    const one = mk(1);
    botTurn(one, { outnumbered: true });
    expect(evacs(one)).toEqual([]);
  });
});

describe('Т.76: бот партії з політикою евакуації', () => {
  it('без політики — та сама партія; з політикою місії рахуються без втрат і детерміновано', () => {
    const base = simulateParty(42, 'норма', { maxDays: 6 });
    const named = simulateParty(42, 'норма', { maxDays: 6, policy: { ...DEFAULT_PARTY_POLICY, evac: {} } });
    expect(JSON.stringify(named)).toBe(JSON.stringify(base));
    expect(base.missionsEvacuated).toBe(0);
    expect(base.soldiersEvacuated).toBe(0);
    const policy = { ...DEFAULT_PARTY_POLICY, evac: { lastStanding: 3 } satisfies EvacPolicy };
    const r = simulateParty(42, 'норма', { maxDays: 6, policy });
    expect(r.missionsLaunched).toBeGreaterThan(0);
    expect(r.missionsWon + r.missionsLost + r.missionsEvacuated).toBe(r.missionsLaunched);
    expect(r.missionsEvacuated).toBe(r.missionsLaunched); // загін одразу відступає з зони висадки
    expect(r.missionsWon).toBe(0);
    expect(r.soldiersEvacuated).toBe(3 * r.missionsLaunched);
    expect(r.soldiersLost).toBe(0);
    expect(JSON.stringify(simulateParty(42, 'норма', { maxDays: 6, policy }))).toBe(JSON.stringify(r));
  });
});
