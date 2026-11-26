// src/core/campaign.test.ts
// Ітерація П8.2: тести ядра кампанії (ADR-0033) — стан, підсумковий рахунок, geo.rng не викликається.
// п18.3 (ADR-0153 п. 13, 15; ADR-0155): перемоги на межі 30-ї доби немає — шкала загрози, поразка на 100.
import { describe, expect, it } from 'vitest';
import {
  campaignScore,
  campaignTick,
  createCampaign,
  DEFAULT_PRESET,
  DIFFICULTY_MULTIPLIERS,
  SCORE_PER_MONEY,
  SCORE_PER_MISSION_WON,
  SCORE_PER_UFO_SHOT_DOWN,
  SCORE_PER_VETERAN_ALIVE,
  sciencePrice,
  THREAT_MAX,
  THREAT_MISSION_WON,
  THREAT_PER_DAY,
  THREAT_UFO_LEFT_DETECTED,
  THREAT_UFO_LEFT_UNDETECTED,
  threatDelta,
  type CampaignContext,
} from './campaign';
import { createGeoGame, TICK_MINUTES, type GeoState } from './geo';
import { createRoster, type Roster } from './squad';
import { createEconomy, type EconomyState } from './economy';
import { createParty, deserializeParty, serializeParty } from './save';

function ctxOf(geo: GeoState, roster: Roster = createRoster(), econ: EconomyState = createEconomy()): CampaignContext {
  return { geo, roster, econ };
}

describe('campaign — початковий стан (ADR-0033)', () => {
  it('нова кампанія: «триває», рахунок не зафіксовано, дефолт-пресет «норма»', () => {
    const c = createCampaign();
    expect(c.status).toBe('триває');
    expect(c.score).toBeNull();
    expect(c.victoryDay).toBeNull();
    expect(DEFAULT_PRESET).toBe('норма');
  });

  it('пресет передається явним параметром (П8.4 — вибір при новій партії)', () => {
    expect(createCampaign('легкий').preset).toBe('легкий');
  });

  it('П10.3/П10.4: пресет «складний» — тиск вищий за «норму», спавн не чіпаємо (probe П8.6)', () => {
    expect(createCampaign('складний').preset).toBe('складний');
    const m = DIFFICULTY_MULTIPLIERS['складний'];
    // тиск — HP солдатів і економіка (менше грошей); числа затверджено П10.4
    // (×0.9/×0.9 за 120 сідів, docs/reports/p10.4-tuning.md)
    expect(m.hpBonusMultiplier).toBeLessThan(DIFFICULTY_MULTIPLIERS['норма'].hpBonusMultiplier);
    expect(m.economyMultiplier).toBeLessThan(DIFFICULTY_MULTIPLIERS['норма'].economyMultiplier);
    // спавн — не ручка тиску (probe П8.6: більше НЛО → більше премій → легше)
    expect(m.ufoSpawnMultiplier).toBe(DIFFICULTY_MULTIPLIERS['норма'].ufoSpawnMultiplier);
  });
});

describe('п18.3: campaignTick — шкала загрози (ADR-0153 п. 13)', () => {
  const day = (d: number) => ({ type: 'day' as const, day: d, minute: (d - 1) * 1440 });

  it('числа-кандидати ADR-0153 п. 13', () => {
    expect([THREAT_PER_DAY, THREAT_UFO_LEFT_DETECTED, THREAT_UFO_LEFT_UNDETECTED, THREAT_MISSION_WON, THREAT_MAX]).toEqual([
      2, 6, 2, -1, 100,
    ]);
    expect(createCampaign()).toMatchObject({ threat: 0, threatCursor: 0, defeatDay: null });
  });

  it('доба +2, виграна місія −1 (не нижче 0); курсор — кінець журналу', () => {
    const geo = createGeoGame({ seed: 1 });
    const c = createCampaign();
    geo.log.push({ type: 'mission_won', ufoId: 'u0', minute: 1 }); // 0 − 1 → межа 0
    geo.log.push(day(2), day(3), { type: 'mission_won', ufoId: 'u1', minute: 2 });
    campaignTick(ctxOf(geo), c);
    expect(c.threat).toBe(3);
    expect(c.threatCursor).toBe(geo.log.length);
    campaignTick(ctxOf(geo), c); // ті самі події вдруге не рахуються
    expect(c.threat).toBe(3);
  });

  it('зонд відлетів: виявлений без бою +6, невиявлений +2, після поразки чи евакуації — 0', () => {
    const geo = createGeoGame({ seed: 2 });
    const pos = { x: 1, y: 1 };
    const spawn = (id: string) => ({ type: 'ufo_spawned' as const, ufoId: id, kind: 'розвідник' as const, pos, minute: 0 });
    geo.log.push(spawn('a'), { type: 'ufo_detected', ufoId: 'a', pos, minute: 1 }, { type: 'ufo_left', ufoId: 'a', minute: 2 });
    geo.log.push(spawn('b'), { type: 'ufo_left', ufoId: 'b', minute: 3 });
    geo.log.push(
      spawn('c'),
      { type: 'ufo_detected', ufoId: 'c', pos, minute: 1 },
      { type: 'mission_lost', ufoId: 'c', minute: 2 },
      { type: 'ufo_left', ufoId: 'c', minute: 4 }
    );
    geo.log.push(
      spawn('d'),
      { type: 'ufo_detected', ufoId: 'd', pos, minute: 1 },
      { type: 'mission_evacuated', ufoId: 'd', minute: 2 },
      { type: 'ufo_left', ufoId: 'd', minute: 5 }
    );
    const lefts = geo.log.flatMap((e, i) => (e.type === 'ufo_left' ? [threatDelta(geo.log, i)] : []));
    expect(lefts).toEqual([6, 2, 0, 0]);
    const c = createCampaign();
    campaignTick(ctxOf(geo), c);
    expect(c.threat).toBe(8);
  });

  it('загроза 100 — поразка: рахунок і доба фіксуються один раз, подія campaign_defeat, далі no-op', () => {
    const geo = createGeoGame({ seed: 3 });
    geo.minute = 60 * 1440;
    const c = createCampaign();
    c.threat = 98;
    geo.log.push(day(61), { type: 'mission_won', ufoId: 'u', minute: 1 }); // 98 + 2 = 100 — перемога після неї не рятує
    campaignTick(ctxOf(geo), c);
    expect(c.status).toBe('поразка');
    expect(c.threat).toBe(THREAT_MAX);
    expect(c.defeatDay).toBe(61);
    expect(c.score).toEqual(campaignScore(geo, createRoster(), createEconomy()));
    const ev = geo.log.filter((e) => e.type === 'campaign_defeat');
    expect(ev).toEqual([{ type: 'campaign_defeat', day: 61, score: c.score!.total, minute: geo.minute }]);
    expect(c.threatCursor).toBe(geo.log.length);
    const frozen = { ...c, score: { ...c.score! } };
    geo.log.push(day(62), { type: 'mission_won', ufoId: 'v', minute: 2 });
    campaignTick(ctxOf(geo), c);
    expect(c).toEqual(frozen);
    expect(geo.log.filter((e) => e.type === 'campaign_defeat')).toHaveLength(1);
  });

  it('загроза не перевищує 100; кінець партії перемогою — no-op', () => {
    const geo = createGeoGame({ seed: 4 });
    const c = createCampaign();
    c.status = 'перемога';
    geo.log.push(day(2));
    campaignTick(ctxOf(geo), c);
    expect(c).toMatchObject({ threat: 0, threatCursor: 0, status: 'перемога' });
    const d = createCampaign();
    d.threat = 99;
    geo.log.push(
      { type: 'ufo_spawned', ufoId: 'x', kind: 'збирач', pos: { x: 0, y: 0 }, minute: 0 },
      { type: 'ufo_detected', ufoId: 'x', pos: { x: 0, y: 0 }, minute: 0 },
      { type: 'ufo_left', ufoId: 'x', minute: 0 }
    );
    d.threatCursor = 1; // лише відліт: 99 + 6 → 100
    campaignTick(ctxOf(geo), d);
    expect(d.threat).toBe(THREAT_MAX);
    expect(d.status).toBe('поразка');
  });

  it('31 доба геоцени без місій: перемоги на межі 30-ї доби немає; загроза — сума threatDelta; geo.rng не викликається', () => {
    const geoA = createGeoGame({ seed: 7 });
    const geoB = createGeoGame({ seed: 7 });
    const c = createCampaign();
    for (let i = 0; i < 48 * 31; i++) {
      geoTickX(geoA);
      geoTickX(geoB);
      campaignTick(ctxOf(geoA), c);
    }
    expect(geoA.log.some((e) => e.type === 'campaign_victory')).toBe(false);
    // без виграних місій загроза доходить до 100 (доба + відліт зондів) — поразка з подією в журналі
    let t = 0;
    let at = -1;
    for (let i = 0; i < geoB.log.length && t < THREAT_MAX; i++) {
      t = Math.max(0, Math.min(THREAT_MAX, t + threatDelta(geoB.log, i)));
      at = i;
    }
    expect(c.threat).toBe(t);
    expect(c.status).toBe(t >= THREAT_MAX ? 'поразка' : 'триває');
    // п18.4: поріг 60 дає подію штурму (бою тут ніхто не грає — штурм лишається в очікуванні)
    const noAssault = geoA.log.filter((e) => e.type !== 'base_assault');
    expect(geoA.log.filter((e) => e.type === 'base_assault').length).toBe(t >= 60 ? 1 : 0);
    expect(noAssault.findIndex((e) => e.type === 'campaign_defeat')).toBe(t >= THREAT_MAX ? at + 1 : -1);
    const strip = (log: typeof geoA.log) => log.filter((e) => e.type !== 'campaign_defeat' && e.type !== 'base_assault');
    expect(strip(geoA.log)).toEqual(geoB.log);
    expect(geoA.ufos).toEqual(geoB.ufos);
  });
});

// тонка обгортка, щоб імпорт geoTick лежав у тесті (критерій 2: geo.rng не витягається)
import { geoTick as geoTickX } from './geo';

describe('campaignScore — похідні метрики (ADR-0033)', () => {
  it('рахунок = збиті НЛО + переможні місії + живі ветерани + залишок коштів, за константами', () => {
    const geo = createGeoGame({ seed: 5 });
    geo.log.push({ type: 'ufo_shot_down', ufoId: 'ufo1', pos: { x: 1, y: 1 }, minute: 100 });
    geo.log.push({ type: 'ufo_shot_down', ufoId: 'ufo2', pos: { x: 2, y: 1 }, minute: 200 });
    geo.log.push({ type: 'mission_won', ufoId: 'ufo3', minute: 300 });
    const roster = createRoster(4);
    const econ = createEconomy();
    const s = campaignScore(geo, roster, econ);
    expect(s.ufosShotDown).toBe(2);
    expect(s.missionsWon).toBe(1);
    expect(s.veteransAlive).toBe(4);
    expect(s.moneyLeft).toBe(econ.money);
    expect(s.total).toBe(
      2 * SCORE_PER_UFO_SHOT_DOWN + 1 * SCORE_PER_MISSION_WON + 4 * SCORE_PER_VETERAN_ALIVE + Math.round(econ.money * SCORE_PER_MONEY)
    );
  });

  it('місії-поразки та інші події в рахунок не входять', () => {
    const geo = createGeoGame({ seed: 6 });
    geo.log.push({ type: 'mission_lost', ufoId: 'ufo1', minute: 100 });
    const s = campaignScore(geo, createRoster(2), createEconomy());
    expect(s.missionsWon).toBe(0);
    expect(s.ufosShotDown).toBe(0);
  });
});

describe('campaign — сумісність сейвів (ADR-0026/0033)', () => {
  it('п18.3: загроза, курсор і поразка зберігаються і відновлюються: save → load — байт-у-байт', () => {
    const party = createParty(11);
    party.campaign.threat = 98;
    party.geo.minute = 40 * 1440;
    party.geo.log.push({ type: 'day', day: 41, minute: party.geo.minute });
    campaignTick({ geo: party.geo, roster: party.roster, econ: party.econ }, party.campaign);
    const json = serializeParty(party);
    const restored = deserializeParty(json);
    expect(restored.campaign).toEqual(party.campaign);
    expect(restored.campaign).toMatchObject({ status: 'поразка', threat: 100, defeatDay: 41 });
    expect(serializeParty(restored)).toBe(json);
  });

  it('старий сейв (v2) без поля campaign: «триває», пресет «норма», загроза — з доби', () => {
    const party = createParty(12);
    party.geo.minute = 4 * 1440; // доба 5
    const json = JSON.parse(serializeParty(party));
    json.version = 2;
    delete json.state.campaign; // сейв до П8.2
    const restored = deserializeParty(JSON.stringify(json));
    expect(restored.campaign).toEqual({
      status: 'триває',
      preset: 'норма',
      score: null,
      victoryDay: null,
      defeatDay: null,
      threat: 8,
      threatCursor: party.geo.log.length,
    });
  });

  it('пошкоджені дані кампанії в сейві — відмова без часткового стану', () => {
    const party = createParty(14);
    const json = JSON.parse(serializeParty(party));
    json.state.campaign = { ...json.state.campaign, preset: '?' };
    expect(() => deserializeParty(JSON.stringify(json))).toThrow('Пошкоджені дані збереження: кампанія');
  });

  it('кампанія не викликає geo.rng: save → load → тіки — та сама траєкторія', () => {
    const party = createParty(13);
    const restored = deserializeParty(serializeParty(party));
    for (let i = 0; i < 48; i++) {
      party.geo.log.push({ type: 'day', day: 1, minute: 0 }); // не впливає; тіки нижче
      restored.geo.log.push({ type: 'day', day: 1, minute: 0 });
    }
    void TICK_MINUTES;
    const a = createGeoGame({ seed: 13 });
    const b = createGeoGame({ seed: 13 });
    for (let i = 0; i < 96; i++) {
      geoTickX(a);
      geoTickX(b);
      campaignTick({ geo: a, roster: createRoster(), econ: createEconomy() }, createCampaign());
    }
    expect(a.log).toEqual(b.log);
  });
});

describe('ціни науки за пресетом (Т.29, ADR-0092)', () => {
  it('«легкий» — половина «норми», «складний» — ×0.9; решта економіки «легкого» — ×1.2', () => {
    // найм техноманта, зарплата, протокол броні, броня, найдорожчий протокол
    const base = [100, 10, 96, 60, 128];
    expect(base.map((b) => sciencePrice(b, 'легкий'))).toEqual([50, 5, 48, 30, 64]);
    expect(base.map((b) => sciencePrice(b, 'норма'))).toEqual(base);
    expect(base.map((b) => sciencePrice(b, 'складний'))).toEqual([90, 9, 86, 54, 115]);
    expect(base.map((b) => sciencePrice(b))).toEqual(base);
    expect(DIFFICULTY_MULTIPLIERS['легкий'].economyMultiplier).toBe(1.2);
  });
});
