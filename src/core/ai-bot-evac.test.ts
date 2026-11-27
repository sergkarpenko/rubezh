// src/core/ai-bot-evac.test.ts
// Т.76 (П15.5, ADR-0075): політика евакуації бота (EvacPolicy, ai-bot.ts) і її
// шлях у бот партії (party-bot.ts). Без політики бот не евакуює — бої й
// партії байт-у-байт як до Т.76.

import { describe, expect, it } from 'vitest';
import { createGame, makeUnit, mulberry32, type GameState, type Unit } from './combat';
import { advanceTime, createGeoGame, type GeoState } from './geo';
import { aliensTurn, autoBattle, botTurn, type EvacPolicy } from './ai-bot';
import { createMission, missionOutcome, type Mission } from './mission';
import { missionTargets } from './geo';
import { createRoster, fireSoldier, missionSquad, readySoldiers } from './squad';
import { DEFAULT_PARTY_POLICY, TICKS_PER_DAY, partyBotMissionStep, simulateParty } from './party-bot';
import { createParty } from './save';

function mkGeo(probeId: string): GeoState {
  const g = createGeoGame({ seed: 9, spawnChance: 0 });
  advanceTime(g, 0);
  g.probes.push({
    id: probeId,
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
        map: { width: 20, height: 20, blocked: new Set(['1,2', '3,2', '2,1', '2,3']) }, // зону замуровано
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
    expect(evac.log.some((e) => e.type === 'shot')).toBe(true); // до зони шляху немає — стріляє
    expect(JSON.stringify(evac.log)).toBe(JSON.stringify(plain.log));
  });

  it('відступ довший за запас AP — за кілька ходів: спершу рух, потім евакуація', () => {
    const g = field([
      makeUnit({ id: 's1', side: 'player', pos: { x: 15, y: 2 }, hp: 3 }),
      makeUnit({ id: 'a1', side: 'alien', pos: { x: 19, y: 19 } }),
    ]);
    botTurn(g, { woundedAtOrBelow: 0.5 });
    expect(evacs(g)).toEqual([]);
    expect(g.units.find((u) => u.id === 's1')!.pos).toEqual({ x: 5, y: 2 }); // 10 кроків із 12
    aliensTurn(g);
    botTurn(g, { woundedAtOrBelow: 0.5 });
    expect(evacs(g)).toEqual(['s1']);
  });

  it('часткова евакуація: поранений виходить, здоровий добиває ворога — перемога з евакуйованим', () => {
    const g = field([
      makeUnit({ id: 's1', side: 'player', pos: { x: 2, y: 2 }, hp: 4 }),
      makeUnit({ id: 's2', side: 'player', pos: { x: 3, y: 2 }, firingAccuracy: 1 }),
      makeUnit({ id: 'a1', side: 'alien', pos: { x: 6, y: 2 }, hp: 1, maxHp: 1 }),
    ]);
    botTurn(g, { woundedAtOrBelow: 0.5 });
    expect(evacs(g)).toEqual(['s1']);
    expect(missionOutcome(g)).toBe('перемога');
    expect(g.evacuated!.map((u) => u.id)).toEqual(['s1']);
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

  it('місія «евакуйовано»: подія mission_evacuated, НЛО лишається ціллю, премії немає', () => {
    const p = createParty(42, 'норма');
    for (let t = 0; t < 30 * TICKS_PER_DAY && missionTargets(p.geo).length === 0; t++) advanceTime(p.geo, 1);
    while (readySoldiers(p.roster).length > 3) fireSoldier(p.roster, p.roster.soldiers[0].id);
    const probeId = missionTargets(p.geo)[0].id;
    const money = p.econ.money;
    const info = partyBotMissionStep(p, { ...DEFAULT_PARTY_POLICY, evac: { lastStanding: 3 } });
    expect(info).toEqual({ launched: true, outcome: 'евакуйовано', lost: 0, wounded: 0, evacuated: 3 });
    expect(p.geo.log.filter((e) => e.type === 'mission_evacuated')).toHaveLength(1);
    expect(p.geo.log.some((e) => e.type === 'mission_lost')).toBe(false);
    expect(missionTargets(p.geo).some((u) => u.id === probeId)).toBe(true);
    expect(p.econ.money).toBe(money);
  });

  // п17.4 (туман із блокуванням): на сіді 7 евакуацій більше немає — сід 55 з тим самим візерунком
  it('евакуйованих солдатів рахує поштучно, і в місіях-перемогах (сід 55, «норма», 6 діб, поранений ≤ 50 %)', () => {
    const r = simulateParty(55, 'норма', { maxDays: 6, policy: { ...DEFAULT_PARTY_POLICY, evac: { woundedAtOrBelow: 0.5 } } });
    // зафіксовані значення: 3 місії «евакуйовано», 4 евакуйовані — не 3 на місію
    // (до п20.3 — 2 і 3; ШІ ворогів і бот загону з укриттям, ADR-0167)
    expect(r.missionsEvacuated).toBe(3);
    expect(r.soldiersEvacuated).toBe(4);
  });
});

// Т.140: тести на живих мутантів Т.76 у ai-bot.ts (прицільний прогін Stryker
// 23.11.2026). Поле — як у field(), але зону висадки задає тест: порядок клітинок
// зони вирішує нічию за довжиною шляху.
function fieldZone(units: Unit[], evacZone: { x: number; y: number }[]): GameState {
  return createGame({
    map: { width: 20, height: 20, blocked: new Set() },
    rng: mulberry32(42),
    startingSide: 'player',
    units,
    evacZone,
  });
}

describe('Т.140: межі умов відступу і вибору клітинки зони', () => {
  it('lastStanding: живих на полі більше N — не відступає ніхто', () => {
    const g = field([
      makeUnit({ id: 's1', side: 'player', pos: { x: 2, y: 2 } }),
      makeUnit({ id: 's2', side: 'player', pos: { x: 3, y: 2 } }),
      makeUnit({ id: 'a1', side: 'alien', pos: { x: 15, y: 15 } }),
    ]);
    botTurn(g, { lastStanding: 1 });
    expect(evacs(g)).toEqual([]);
    expect(g.units.filter((u) => u.side === 'player')).toHaveLength(2);
  });

  it('евакуація — дія: botTurn рахує її, як рух чи постріл', () => {
    const g = field([
      makeUnit({ id: 's1', side: 'player', pos: { x: 2, y: 2 } }),
      makeUnit({ id: 's2', side: 'player', pos: { x: 3, y: 2 } }),
      makeUnit({ id: 'a1', side: 'alien', pos: { x: 15, y: 15 } }),
    ]);
    expect(botTurn(g, { lastStanding: 2 })).toBe(2);
    expect(evacs(g)).toEqual(['s1', 's2']);
  });

  it('у зоні рівно 2 AP — евакуюється (поріг нестрогий)', () => {
    const g = field([
      makeUnit({ id: 's1', side: 'player', pos: { x: 2, y: 2 }, hp: 3 }),
      makeUnit({ id: 'a1', side: 'alien', pos: { x: 15, y: 15 } }),
    ]);
    g.units[0].ap = 2;
    expect(botTurn(g, { woundedAtOrBelow: 0.5 })).toBe(1);
    expect(evacs(g)).toEqual(['s1']);
  });

  it('«у зоні» — збіг обох координат: той самий x, інший y — спершу рух до зони', () => {
    const g = field([
      makeUnit({ id: 's1', side: 'player', pos: { x: 3, y: 6 }, hp: 3 }),
      makeUnit({ id: 'a1', side: 'alien', pos: { x: 15, y: 15 } }),
    ]);
    botTurn(g, { woundedAtOrBelow: 0.5 });
    expect(evacs(g)).toEqual(['s1']);
    expect(g.evacuated![0].pos).toEqual({ x: 3, y: 2 });
  });

  it('найближча клітинка зони, хоч вона й перша за порядком', () => {
    const g = fieldZone(
      [makeUnit({ id: 's1', side: 'player', pos: { x: 6, y: 2 }, hp: 3 }), makeUnit({ id: 'a1', side: 'alien', pos: { x: 15, y: 15 } })],
      [
        { x: 3, y: 2 },
        { x: 2, y: 2 },
      ]
    );
    botTurn(g, { woundedAtOrBelow: 0.5 });
    expect(g.evacuated![0].pos).toEqual({ x: 3, y: 2 }); // 3 кроки, а не 4
  });

  it('рівна довжина шляху — перша за порядком зони клітинка', () => {
    const mk = (zone: { x: number; y: number }[]) =>
      fieldZone(
        [makeUnit({ id: 's1', side: 'player', pos: { x: 2, y: 6 }, hp: 3 }), makeUnit({ id: 'a1', side: 'alien', pos: { x: 15, y: 15 } })],
        zone
      );
    const left = mk([
      { x: 1, y: 2 },
      { x: 3, y: 2 },
    ]);
    botTurn(left, { woundedAtOrBelow: 0.5 });
    expect(left.evacuated![0].pos).toEqual({ x: 1, y: 2 });
    const right = mk([
      { x: 3, y: 2 },
      { x: 1, y: 2 },
    ]);
    botTurn(right, { woundedAtOrBelow: 0.5 });
    expect(right.evacuated![0].pos).toEqual({ x: 3, y: 2 });
  });
});

describe('Т.140: запобіжник циклу botTurn', () => {
  it('не більше 60 дій на солдата за хід, навіть коли AP вистачає на більше', () => {
    const g = field([
      makeUnit({ id: 's1', side: 'player', pos: { x: 6, y: 6 } }),
      makeUnit({ id: 'a1', side: 'alien', pos: { x: 9, y: 6 }, hp: 1_000_000, maxHp: 1_000_000 }),
    ]);
    g.units[0].ap = 1000; // штучний запас: кожна дія витрачає AP, у грі 60 дій недосяжні
    expect(botTurn(g)).toBe(60);
    expect(g.log.filter((e) => e.type === 'shot').length).toBeGreaterThanOrEqual(60);
    expect(g.activeSide).toBe('alien');
  });
});
