// src/core/assault.test.ts
// п18.4 (ADR-0153 п. 16–17, ADR-0156; EARS 7–8 Фази 18): штурм бази на порогах загрози,
// турелі після «Ключа брами», фінал «Брама Розриву», кроки бота, поля сейва v3.

import { describe, expect, it } from 'vitest';
import { RIFLE, createGame, isInside, makeUnit, moveUnit, mulberry32, type Unit } from './combat';
import { botTurn } from './ai-bot';
import { campaignTick, threatDelta, ASSAULT_THRESHOLDS, THREAT_BATTLE_LOST } from './campaign';
import {
  ASSAULT_ENEMIES,
  ASSAULT_SPAWN,
  GATE_ENEMIES,
  GATE_MAP,
  GATE_RETRY_MINUTES,
  GATE_SPAWN,
  TURRET_HP,
  TURRET_SPAWN,
  completeAssault,
  completeGate,
  createAssault,
  createGateMission,
  gateMix,
  gateOpen,
  makeTurret,
} from './assault';
import { ENEMY_ORDER, kindsForThreat, enemyKind, enemyName } from './enemies';
import { SQUAD_SPAWN, connectedMap, missionOutcome, textSeed } from './mission';
import { DEFAULT_PARTY_POLICY, partyBotAssaultStep, partyBotGateStep } from './party-bot';
import { applyMissionResult, readySoldiers } from './squad';
import { createParty, deserializeParty, serializeParty, type Party } from './save';
import { fighterLook, TURRET_RING } from './render-core';

const tick = (p: Party): void => campaignTick({ geo: p.geo, roster: p.roster, econ: p.econ }, p.campaign);
const squadOf = (p: Party, n = 3): Unit[] => readySoldiers(p.roster).slice(0, n);
// загроза рівно t: подія доби в журналі не потрібна — пишемо стан прямо, курсор — кінець журналу
function atThreat(p: Party, t: number): void {
  p.campaign.threat = t;
  p.campaign.threatCursor = p.geo.log.length;
}

describe('п18.4: пороги штурму в campaignTick (ADR-0153 п. 16)', () => {
  it('поріг 60 — подія base_assault, штурм чекає бою; поки чекає — другого немає', () => {
    const p = createParty(42);
    atThreat(p, 59);
    tick(p);
    expect(p.campaign.assaultPending).toBeUndefined();
    atThreat(p, 60);
    tick(p);
    expect(p.campaign.assaults).toBe(1);
    expect(p.campaign.assaultPending).toBe(true);
    expect(p.geo.log.at(-1)).toEqual({ type: 'base_assault', threshold: 60, minute: p.geo.minute });
    expect(p.campaign.threatCursor).toBe(p.geo.log.length); // власна подія не рахується двічі
    atThreat(p, 80);
    tick(p);
    expect(p.campaign.assaults).toBe(1); // 75 перейдено, але перший штурм ще не відбувся
    completeAssault(p, 'перемога');
    tick(p);
    expect(p.campaign.assaults).toBe(2);
    expect(p.geo.log.filter((e) => e.type === 'base_assault').map((e) => (e as { threshold: number }).threshold)).toEqual([60, 75]);
  });

  it('кожен поріг — один раз: падіння і повторне досягнення штурму не дають; після 90 — більше немає', () => {
    const p = createParty(42);
    for (const t of ASSAULT_THRESHOLDS) {
      atThreat(p, t);
      tick(p);
      completeAssault(p, 'перемога');
      atThreat(p, t - 5);
      tick(p);
      atThreat(p, t);
      tick(p);
      expect(p.campaign.assaultPending).toBe(false);
    }
    atThreat(p, 99);
    tick(p);
    expect(p.campaign.assaults).toBe(3);
    expect(p.geo.log.filter((e) => e.type === 'base_assault')).toHaveLength(3);
  });

  it('програний штурм і фінал — +10 загрози (threatDelta); виграний штурм — 0', () => {
    const p = createParty(42);
    p.geo.log.push({ type: 'assault_lost', money: 0, minute: 0 }, { type: 'gate_lost', minute: 0 }, { type: 'assault_won', minute: 0 });
    const n = p.geo.log.length;
    expect([threatDelta(p.geo.log, n - 3), threatDelta(p.geo.log, n - 2), threatDelta(p.geo.log, n - 1)]).toEqual([
      THREAT_BATTLE_LOST,
      THREAT_BATTLE_LOST,
      0,
    ]);
    expect(THREAT_BATTLE_LOST).toBe(10);
  });

  it('поразка на 100 — першою: поріг штурму на тому самому тіку не спрацьовує', () => {
    const p = createParty(42);
    p.campaign.threat = 95;
    p.campaign.threatCursor = p.geo.log.length;
    p.geo.log.push({ type: 'assault_lost', money: 0, minute: 0 });
    p.campaign.assaults = 2;
    tick(p);
    expect(p.campaign.status).toBe('поразка');
    expect(p.campaign.assaultPending).toBeUndefined();
  });
});

// п21.5 (ADR-0179, аудит PR #542): імена — «<Тип> <ім'я>» з пулу за сідом бою, порядок — серед свого типу
function expectNamesBySeed(aliens: readonly Unit[], seed: number): void {
  const seen = new Map<string, number>();
  const want = aliens.map((u) => {
    const k = enemyKind(u);
    const i = seen.get(k) ?? 0;
    seen.set(k, i + 1);
    return enemyName(k, i, seed);
  });
  expect(aliens.map((u) => u.name)).toEqual(want);
  expect(new Set(want).size).toBe(want.length);
}

describe('п18.4: бій штурму (createAssault)', () => {
  it('без штурму — відмова; 4 вороги за загрозою на ASSAULT_SPAWN, без евакуації, без турелей до «Ключа брами»', () => {
    const p = createParty(42);
    expect(() => createAssault(p, { squad: squadOf(p) })).toThrow('Штурму бази зараз немає');
    atThreat(p, 60);
    tick(p);
    const rng = p.geo.rng;
    let calls = 0;
    p.geo.rng = () => (calls++, rng());
    const m = createAssault(p, { squad: squadOf(p) });
    expect(calls).toBe(0); // geo.rng не викликається (ADR-0003)
    expect(m.briefing.op).toBe('штурм');
    const aliens = m.state.units.filter((u) => u.side === 'alien');
    expect(aliens).toHaveLength(ASSAULT_ENEMIES);
    expect(aliens.map((u) => u.pos)).toEqual(ASSAULT_SPAWN);
    expect(aliens[0].kind).toBeUndefined(); // перший — демон
    for (const a of aliens) expect(kindsForThreat(60)).toContain(enemyKind(a));
    expect(m.state.evacZone).toBeUndefined(); // рішення власника «А»: евакуації немає
    expect(m.state.units.some((u) => u.turret)).toBe(false);
    expectNamesBySeed(aliens, textSeed('штурм:' + (p.campaign.assaults ?? 0) + ':' + p.geo.minute));
    // детермінізм: той самий стан — той самий бій
    const again = createAssault(p, { squad: squadOf(p) });
    expect([...again.state.map.blocked].sort()).toEqual([...m.state.map.blocked].sort());
    expect(again.state.units.map((u) => u.kind)).toEqual(m.state.units.map((u) => u.kind));
    // мапа бази — не мапа звичайної місії тієї ж хвилини (свій сід)
    expect(m.state.map.width).toBe(20);
  });

  it('загін: порожній, понад 3 чи з чужим юнітом — відмова (як createMission)', () => {
    const p = createParty(42);
    atThreat(p, 60);
    tick(p);
    expect(() => createAssault(p, { squad: [] })).toThrow('Загін не може бути порожнім');
    expect(() => createAssault(p, { squad: squadOf(p, 4) })).toThrow('Максимум 3 оперативників');
    const alien = makeUnit({ id: 'x', side: 'alien', pos: { x: 0, y: 0 } });
    const [s1] = squadOf(p, 1);
    const pos = { ...s1.pos };
    expect(() => createAssault(p, { squad: [s1, alien] })).toThrow('лише оперативники гравця: x');
    expect(s1.pos).toEqual(pos); // відмова — без зміни позицій
    p.research.completed.push('gate-key');
    expect(() => createGateMission(p, { squad: [] })).toThrow('Загін не може бути порожнім');
  });

  it('після «Ключа брами» — дві турелі сторони загону на TURRET_SPAWN, поза ростером', () => {
    const p = createParty(42);
    p.research.completed.push('gate-key');
    atThreat(p, 60);
    tick(p);
    const m = createAssault(p, { squad: squadOf(p) });
    const turrets = m.state.units.filter((u) => u.turret);
    expect(turrets.map((u) => [u.id, u.name, u.side, u.hp, u.weapon])).toEqual([
      ['t1', 'Турель 1', 'player', TURRET_HP, RIFLE],
      ['t2', 'Турель 2', 'player', TURRET_HP, RIFLE],
    ]);
    expect(turrets.map((u) => u.pos)).toEqual(TURRET_SPAWN);
    for (const t of TURRET_SPAWN) expect(m.state.map.blocked.has(t.x + ',' + t.y)).toBe(false);
  });
});

describe('п18.4: турель — нерухомий юніт загону (ADR-0156 п. 3)', () => {
  const open = { width: 20, height: 20, blocked: new Set<string>() };
  it('рух відхилено з українською причиною; стан не змінюється', () => {
    const t = makeTurret(0);
    const s = createGame({ map: open, units: [t, makeUnit({ id: 'a1', side: 'alien', pos: { x: 18, y: 18 } })] });
    expect(() => moveUnit(s, 't1', [{ x: 3, y: 4 }])).toThrow('Турель нерухома');
    expect(t.pos).toEqual(TURRET_SPAWN[0]);
    expect(t.ap).toBe(10);
  });

  it('бот загону: турель без цілі не рухається, ціль у дальності — стріляє; поза дальністю — стоїть', () => {
    const t = makeTurret(0);
    const far = makeUnit({ id: 'a1', side: 'alien', pos: { x: 18, y: 18 } });
    const s = createGame({ map: open, units: [t, far], rng: mulberry32(1) });
    botTurn(s);
    expect(t.pos).toEqual(TURRET_SPAWN[0]);
    expect(s.log.filter((e) => e.type === 'move')).toHaveLength(0);
    const near = makeUnit({ id: 'a2', side: 'alien', pos: { x: 8, y: 3 } });
    const s2 = createGame({ map: open, units: [makeTurret(0), near], rng: mulberry32(1) });
    botTurn(s2);
    expect(s2.log.some((e) => e.type === 'shot' && e.shooterId === 't1')).toBe(true);
    expect(s2.log.some((e) => e.type === 'move')).toBe(false);
  });

  it('бій триває, поки жива турель (рішення власника «А»); applyMissionResult турелі не бере', () => {
    const p = createParty(42);
    const [s1] = squadOf(p, 1);
    const t = makeTurret(0);
    const a = makeUnit({ id: 'a1', side: 'alien', pos: { x: 18, y: 18 } });
    const st = createGame({ map: open, units: [s1, t, a] });
    s1.alive = false;
    s1.hp = 0;
    expect(missionOutcome(st)).toBe('триває');
    a.alive = false;
    expect(missionOutcome(st)).toBe('перемога');
    const res = applyMissionResult(p.roster, st);
    expect(res.lost.map((u) => u.id)).toEqual([s1.id]);
    expect(res.survivors).toHaveLength(0);
    t.alive = false;
    a.alive = true;
    expect(missionOutcome(st)).toBe('поразка');
  });

  it('кільце турелі до п18.5 — сіре (рішення власника «А. Мінімум»), бійці — як були', () => {
    expect(fighterLook('t1').color).toBe(TURRET_RING);
    expect(fighterLook('t2').color).toBe(TURRET_RING);
    expect(fighterLook('s1').color).not.toBe(TURRET_RING);
  });
});

describe('п18.4: наслідки штурму (completeAssault)', () => {
  it('перемога — assault_won, кредити і склад без змін, штурм знято', () => {
    const p = createParty(42);
    atThreat(p, 60);
    tick(p);
    const money = p.econ.money;
    expect(completeAssault(p, 'перемога')).toBe(0);
    expect(p.geo.log.at(-1)).toEqual({ type: 'assault_won', minute: p.geo.minute });
    expect(p.econ.money).toBe(money);
    expect(p.campaign.assaultPending).toBe(false);
    expect(() => completeAssault(p, 'перемога')).toThrow('Штурму бази зараз немає');
  });

  it('поразка — −30 % кредитів (вниз), половина кожного предмета складу (вниз), +10 загрози наступним тіком', () => {
    const p = createParty(42);
    atThreat(p, 60);
    tick(p);
    p.econ.money = 333;
    p.workshop.store.medkit = 3;
    p.workshop.store.grenade = 1;
    p.workshop.store['breach-charge'] = 4;
    expect(completeAssault(p, 'поразка')).toBe(99);
    expect(p.econ.money).toBe(234);
    expect(p.econ.log.at(-1)).toEqual({ type: 'spend', amount: 99 });
    expect(p.workshop.store).toMatchObject({ medkit: 2, grenade: 1, 'breach-charge': 2, armor: 0 });
    expect(p.workshop.log.at(-1)).toEqual({ type: 'store_lost', lost: { medkit: 1, 'breach-charge': 2 } });
    expect(p.geo.log.at(-1)).toEqual({ type: 'assault_lost', money: 99, minute: p.geo.minute });
    tick(p);
    expect(p.campaign.threat).toBe(70);
  });

  it('поразка без кредитів — без події витрат', () => {
    const p = createParty(42);
    atThreat(p, 60);
    tick(p);
    p.econ.money = 3;
    const n = p.econ.log.length;
    expect(completeAssault(p, 'поразка')).toBe(0);
    expect(p.econ.log).toHaveLength(n);
    expect(p.econ.money).toBe(3);
    expect(p.workshop.log.some((e) => e.type === 'store_lost')).toBe(false); // порожній склад — без події
  });
});

describe('п18.4: фінал «Брама Розриву» (ADR-0153 п. 17)', () => {
  it('брама відкрита лише після «Ключа брами», поки партія триває і минула пауза', () => {
    const p = createParty(42);
    expect(gateOpen(p)).toBe(false);
    p.research.completed.push('gate-key');
    expect(gateOpen(p)).toBe(true);
    p.campaign.gateReadyAt = p.geo.minute + 1;
    expect(gateOpen(p)).toBe(false);
    p.campaign.gateReadyAt = p.geo.minute;
    expect(gateOpen(p)).toBe(true);
    p.campaign.status = 'поразка';
    expect(gateOpen(p)).toBe(false);
  });

  it('склад: по одному кожного типу і ще два з доступних, голем ≤ 2; лише демони — ще два демони', () => {
    for (let seed = 0; seed < 200; seed++) {
      const kinds = gateMix(kindsForThreat(100), seed);
      expect(kinds).toHaveLength(GATE_ENEMIES);
      expect(kinds.slice(0, 4)).toEqual(ENEMY_ORDER);
      expect(kinds.filter((k) => k === 'golem').length).toBeLessThanOrEqual(2);
    }
    expect(gateMix(['demon'], 7)).toEqual([...ENEMY_ORDER, 'demon', 'demon']);
    expect(gateMix(kindsForThreat(100), 7)).toEqual(gateMix(kindsForThreat(100), 7));
    // пул без голема, коли два вже є: перебором сідів знаходимо склад із двома големами
    expect([...Array(200).keys()].some((s) => gateMix(kindsForThreat(100), s).filter((k) => k === 'golem').length === 2)).toBe(true);
  });

  it('бій фіналу: мапа 24 × 24, 6 ворогів у протилежному куті, евакуація — із зони висадки, зона ворогів для бота', () => {
    const p = createParty(42);
    expect(() => createGateMission(p, { squad: squadOf(p) })).toThrow('Брама Розриву зараз недоступна');
    p.research.completed.push('gate-key');
    const m = createGateMission(p, { squad: squadOf(p) });
    expect(m.briefing.op).toBe('брама');
    expect([m.state.map.width, m.state.map.height]).toEqual([GATE_MAP, GATE_MAP]);
    const aliens = m.state.units.filter((u) => u.side === 'alien');
    expect(aliens.map((u) => u.pos)).toEqual(GATE_SPAWN);
    for (const c of GATE_SPAWN) {
      expect(isInside(m.state.map, c)).toBe(true);
      expect(m.state.map.blocked.has(c.x + ',' + c.y)).toBe(false);
    }
    expect(m.state.evacZone).toEqual(SQUAD_SPAWN);
    expect(m.state.enemyZone).toEqual(GATE_SPAWN);
    expect(m.state.units.filter((u) => u.side === 'player').map((u) => u.pos)).toEqual(SQUAD_SPAWN);
    expectNamesBySeed(aliens, textSeed('брама:' + p.geo.minute));
  });

  it('перемога — «перемога» партії з рахунком і подією campaign_victory; далі загроза не росте', () => {
    const p = createParty(42);
    p.research.completed.push('gate-key');
    completeGate(p, 'перемога');
    expect(p.campaign.status).toBe('перемога');
    expect(p.campaign.victoryDay).toBe(1);
    expect(p.campaign.score).not.toBeNull();
    expect(p.geo.log.at(-1)).toEqual({ type: 'campaign_victory', day: 1, score: p.campaign.score!.total, minute: p.geo.minute });
    const t = p.campaign.threat;
    p.geo.log.push({ type: 'day', day: 2, minute: 1440 });
    tick(p);
    expect(p.campaign.threat).toBe(t);
    expect(gateOpen(p)).toBe(false);
  });

  it.each(['поразка', 'евакуйовано'] as const)('%s — gate_lost (+10) і брама знову через добу', (outcome) => {
    const p = createParty(42);
    p.research.completed.push('gate-key');
    p.geo.minute = 600;
    completeGate(p, outcome);
    expect(p.campaign.status).toBe('триває');
    expect(p.campaign.gateReadyAt).toBe(600 + GATE_RETRY_MINUTES);
    expect(p.geo.log.at(-1)).toEqual({ type: 'gate_lost', minute: 600 });
    tick(p);
    expect(p.campaign.threat).toBe(10);
    expect(gateOpen(p)).toBe(false);
    p.geo.minute = 600 + GATE_RETRY_MINUTES;
    expect(gateOpen(p)).toBe(true);
  });
});

describe('п18.4: кроки бота партії (simulateParty грає штурм авто-боєм)', () => {
  it('штурму немає — no-op; без боєготових — програно без бою', () => {
    const p = createParty(42);
    expect(partyBotAssaultStep(p, DEFAULT_PARTY_POLICY).fought).toBe(false);
    atThreat(p, 60);
    tick(p);
    for (const s of p.roster.soldiers) p.roster.hospital[s.id] = 10;
    const money = p.econ.money;
    expect(partyBotAssaultStep(p, DEFAULT_PARTY_POLICY)).toEqual({ fought: true, outcome: 'поразка', lost: 0, wounded: 0 });
    expect(p.econ.money).toBe(money - Math.floor(money * 0.3));
    expect(p.campaign.assaultPending).toBe(false);
  });

  it('з боєготовими — бій авто-боєм: ростер і трофеї розраховано, штурм знято; байт-у-байт', () => {
    const run = (): Party => {
      const p = createParty(42);
      atThreat(p, 60);
      tick(p);
      const info = partyBotAssaultStep(p, DEFAULT_PARTY_POLICY);
      expect(info.fought).toBe(true);
      expect(info.outcome === 'перемога' || info.outcome === 'поразка').toBe(true);
      expect(p.campaign.assaultPending).toBe(false);
      const last = p.geo.log.at(-1)!;
      expect(last.type).toBe(info.outcome === 'перемога' ? 'assault_won' : 'assault_lost');
      return p;
    };
    expect(serializeParty(run())).toBe(serializeParty(run()));
  });

  it('фінал: лише відкрита брама і повний загін; перемога закінчує партію', () => {
    const p = createParty(42);
    expect(partyBotGateStep(p, DEFAULT_PARTY_POLICY).fought).toBe(false);
    p.research.completed.push('gate-key');
    for (const s of p.roster.soldiers.slice(2)) p.roster.hospital[s.id] = 5;
    expect(readySoldiers(p.roster).length).toBeLessThan(DEFAULT_PARTY_POLICY.missionSquadSize);
    expect(partyBotGateStep(p, DEFAULT_PARTY_POLICY).fought).toBe(false);
    p.roster.hospital = {};
    const info = partyBotGateStep(p, DEFAULT_PARTY_POLICY);
    expect(info.fought).toBe(true);
    if (info.outcome === 'перемога') expect(p.campaign.status).toBe('перемога');
    else expect(p.campaign.gateReadyAt).toBe(p.geo.minute + GATE_RETRY_MINUTES);
    expect(partyBotGateStep({ ...p, campaign: { ...p.campaign, status: 'поразка' } }, DEFAULT_PARTY_POLICY).fought).toBe(false);
  });
});

describe('п18.4: сейв v3 — штурми і брама необов’язковими полями (ADR-0155 п. 9)', () => {
  it('поля без значень у сейві відсутні; задані — повертаються як були', () => {
    const p = createParty(42);
    expect(Object.keys(JSON.parse(serializeParty(p)).state.campaign)).not.toContain('assaults');
    p.campaign.assaults = 2;
    p.campaign.assaultPending = true;
    p.campaign.gateReadyAt = 2880;
    const q = deserializeParty(serializeParty(p));
    expect([q.campaign.assaults, q.campaign.assaultPending, q.campaign.gateReadyAt]).toEqual([2, true, 2880]);
    const r = deserializeParty(serializeParty(createParty(42)));
    expect('assaults' in r.campaign || 'assaultPending' in r.campaign || 'gateReadyAt' in r.campaign).toBe(false);
  });

  it.each([
    ['assaults', 4],
    ['assaults', -1],
    ['assaults', 1.5],
    ['assaultPending', 'так'],
    ['gateReadyAt', -1],
    ['gateReadyAt', 0.5],
  ])('пошкоджене поле %s = %s — відмова', (key, value) => {
    const raw = JSON.parse(serializeParty(createParty(42)));
    raw.state.campaign[key] = value;
    expect(() => deserializeParty(JSON.stringify(raw))).toThrow('Пошкоджені дані збереження: штурми і брама');
  });

  it.each(['assaults', 'assaultPending', 'gateReadyAt'])('сейв v2 з полем %s — відмова (поля лише у v3)', (key) => {
    const raw = JSON.parse(serializeParty(createParty(42)));
    raw.version = 2;
    raw.state.campaign[key] = key === 'assaultPending' ? false : 1;
    expect(() => deserializeParty(JSON.stringify(raw))).toThrow('штурми і брама');
  });

  it('міграція v2: пороги, які загроза вже перейшла, — минулі (штурмів заднім числом немає)', () => {
    const raw = JSON.parse(serializeParty(createParty(42)));
    raw.version = 2;
    for (const k of ['threat', 'threatCursor', 'defeatDay']) delete raw.state.campaign[k];
    expect('assaults' in deserializeParty(JSON.stringify(raw)).campaign).toBe(false); // доба 1 — загроза 0
    raw.state.geo.minute = 1440 * 39; // доба 40: 2 × 39 = 78 — пороги 60 і 75 минули
    const p = deserializeParty(JSON.stringify(raw));
    expect(p.campaign.threat).toBe(78);
    expect(p.campaign.assaults).toBe(2);
    tick(p);
    expect(p.campaign.assaultPending).toBeUndefined();
  });

  it('штурм чекає без жодного спрацьованого порога — відмова', () => {
    const raw = JSON.parse(serializeParty(createParty(42)));
    raw.state.campaign.assaultPending = true;
    expect(() => deserializeParty(JSON.stringify(raw))).toThrow('штурми і брама');
  });
});

describe('п18.4: бойовище — connectedMap і звичайна місія без змін', () => {
  it('типовий розмір — 20 × 20 (мапи місій байт-у-байт — mission.test.ts); чиста зона clear — 3 × 3', () => {
    const m = connectedMap(12345);
    expect(m.width).toBe(20);
    const big = connectedMap(12345, 24, 24, GATE_SPAWN, { x: 21, y: 21 });
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) expect(big.blocked.has(21 + dx + ',' + (21 + dy))).toBe(false);
  });
});
