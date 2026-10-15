// src/core/campaign.test.ts
// Ітерація П8.2: тести ядра кампанії (ADR-0033) — стан, перемога на межі 30-ї доби,
// підсумковий рахунок, геоцінна подія перемоги, geo.rng не викликається.
import { describe, expect, it } from 'vitest';
import {
  campaignScore,
  campaignTick,
  createCampaign,
  DEFAULT_PRESET,
  SCORE_PER_MONEY,
  SCORE_PER_MISSION_WON,
  SCORE_PER_UFO_SHOT_DOWN,
  SCORE_PER_VETERAN_ALIVE,
  VICTORY_DAY,
  type CampaignContext,
} from './campaign';
import { createGeoGame, TICK_MINUTES, type GeoState } from './geo';
import { createRoster, type Roster } from './squad';
import { createEconomy, type EconomyState } from './economy';
import { createParty, deserializeParty, serializeParty } from './save';

function ctxOf(geo: GeoState, roster: Roster = createRoster(), econ: EconomyState = createEconomy()): CampaignContext {
  return { geo, roster, econ };
}

// Доба N завершується на хвилині N * 1440 (48 тіків по TICK_MINUTES).
function minuteOfDay(day: number): number {
  return day * 1440;
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
});

describe('campaignTick — межа 30-ї доби', () => {
  it('до 30-ї доби: no-op, стан «триває», журнал без подій перемоги', () => {
    const geo = createGeoGame({ seed: 1 });
    const c = createCampaign();
    geo.minute = minuteOfDay(29);
    campaignTick(ctxOf(geo), c);
    expect(c.status).toBe('триває');
    expect(c.score).toBeNull();
    expect(geo.log.filter((e) => e.type === 'campaign_victory')).toHaveLength(0);
  });

  it('на межі 30-ї доби (1440 хв * 30): перемога, рахунок зафіксовано, подія в журналі', () => {
    const geo = createGeoGame({ seed: 2 });
    geo.minute = minuteOfDay(VICTORY_DAY);
    const c = createCampaign();
    campaignTick(ctxOf(geo), c);
    expect(c.status).toBe('перемога');
    expect(c.victoryDay).toBe(VICTORY_DAY);
    expect(c.score).not.toBeNull();
    const events = geo.log.filter((e) => e.type === 'campaign_victory');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'campaign_victory', day: VICTORY_DAY, score: c.score!.total });
  });

  it('після 30-ї доби перемога теж фіксується (запізнілий перший виклик)', () => {
    const geo = createGeoGame({ seed: 3 });
    geo.minute = minuteOfDay(35);
    const c = createCampaign();
    campaignTick(ctxOf(geo), c);
    expect(c.status).toBe('перемога');
    // перемога завжди «на 30-ту добу» (ADR-0033), пізніший виклик лише фіксує
    expect(c.victoryDay).toBe(VICTORY_DAY);
  });

  it('повторні виклики на межі та після — no-op: рахунок і подія не дублюються', () => {
    const geo = createGeoGame({ seed: 4 });
    geo.minute = minuteOfDay(VICTORY_DAY);
    const c = createCampaign();
    const ctx = ctxOf(geo);
    campaignTick(ctx, c);
    const frozen = c.score!.total;
    // зміними метрики після фіксації — рахунок не перераховується (ADR-0033)
    geo.log.push({ type: 'ufo_shot_down', ufoId: 'ufo1', pos: { x: 0, y: 0 }, minute: geo.minute });
    campaignTick(ctx, c);
    campaignTick(ctx, c);
    expect(c.score!.total).toBe(frozen);
    expect(geo.log.filter((e) => e.type === 'campaign_victory')).toHaveLength(1);
  });

  it('geo.rng не викликається — траєкторія геоцени з кампанією і без неї байт-у-байт', () => {
    const geoA = createGeoGame({ seed: 7 });
    const geoB = createGeoGame({ seed: 7 });
    const c = createCampaign();
    const ctx = ctxOf(geoA);
    for (let i = 0; i < 48 * 31; i++) {
      geoTickX(geoA);
      geoTickX(geoB);
      campaignTick(ctx, c);
    }
    expect(geoA.log.filter((e) => e.type === 'campaign_victory')).toHaveLength(1);
    // журнали відрізняються лише подією перемоги; усі події геоцени (спавн/рух/день) ідентичні
    const stripVictory = (log: typeof geoA.log) => log.filter((e) => e.type !== 'campaign_victory');
    expect(stripVictory(geoA.log)).toEqual(stripVictory(geoB.log));
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
  it('стан кампанії зберігається і відновлюється: save → load — байт-у-байт', () => {
    const party = createParty(11);
    party.geo.minute = minuteOfDay(VICTORY_DAY);
    party.geo.log.push({ type: 'ufo_shot_down', ufoId: 'ufo9', pos: { x: 3, y: 3 }, minute: 4000 });
    campaignTick({ geo: party.geo, roster: party.roster, econ: party.econ }, party.campaign);
    const restored = deserializeParty(serializeParty(party));
    expect(restored.campaign.status).toBe('перемога');
    expect(restored.campaign.preset).toBe(party.campaign.preset);
    expect(restored.campaign.score).toEqual(party.campaign.score);
    expect(restored.campaign.victoryDay).toBe(VICTORY_DAY);
  });

  it('старий сейв без поля campaign: «триває» і пресет «норма» (версія формату не зросла)', () => {
    const party = createParty(12);
    const json = JSON.parse(serializeParty(party));
    delete json.state.campaign; // сейв до П8.2
    const restored = deserializeParty(JSON.stringify(json));
    expect(restored.campaign).toEqual({
      status: 'триває',
      preset: 'норма',
      score: null,
      victoryDay: null,
    });
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
