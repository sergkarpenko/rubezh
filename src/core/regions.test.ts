// п19.2 (ADR-0159 п. 1–3, 9–12, 14; EARS 1–4, 7): регіони, довіра, дотація, вихід регіону, сейв v4.
import { describe, expect, it } from 'vitest';
import { advanceTime, createGeoGame, WORLD_H, WORLD_W, type GeoEvent } from './geo';
import {
  createRegions,
  REGION_GRID_H,
  REGION_GRID_W,
  REGION_IDS,
  REGION_NAMES,
  REGION_OF,
  regionOf,
  regionsTick,
  totalTrust,
  trustDelta,
  TRUST_TOTAL_MAX,
  probeLastPos,
  type RegionId,
} from './regions';
import { campaignTick, createCampaign, DIFFICULTY_MULTIPLIERS, threatDelta, type DifficultyPreset } from './campaign';
import { createEconomy, DAILY_ALLOWANCE, dailyAllowance, economyTick } from './economy';
import { createRoster } from './squad';
import { createParty, deserializeParty, SAVE_VERSION, serializeParty } from './save';

const PRESETS: DifficultyPreset[] = ['легкий', 'норма', 'складний'];

// Зонд id: поява в from, рух до pos, посадка, (виявлення), далі хвіст подій.
function probe(id: string, pos: { x: number; y: number }, detected: boolean, tail: GeoEvent[] = []): GeoEvent[] {
  return [
    { type: 'probe_spawned', probeId: id, kind: 'розвідник', pos: { x: 0, y: 0 }, minute: 0 },
    { type: 'probe_move', probeId: id, from: { x: 0, y: 0 }, to: pos, minute: 30 },
    ...(detected ? [{ type: 'probe_detected', probeId: id, pos, minute: 30 } as GeoEvent] : []),
    { type: 'probe_landed', probeId: id, pos, minute: 30 },
    ...tail,
  ];
}

const left = (id: string): GeoEvent => ({ type: 'probe_left', probeId: id, minute: 300 });
const won = (id: string): GeoEvent => ({ type: 'mission_won', probeId: id, minute: 200 });

describe('п19.2: розклад регіонів (ADR-0159 п. 9, EARS 1)', () => {
  it('сітка 16 × 9 як мапа геоцени; кожна клітинка — рівно один із чотирьох регіонів', () => {
    expect([REGION_GRID_W, REGION_GRID_H]).toEqual([WORLD_W, WORLD_H]);
    expect(REGION_OF).toHaveLength(WORLD_H);
    const count: Record<RegionId, number> = { west: 0, north: 0, east: 0, south: 0 };
    for (const row of REGION_OF) {
      expect(row).toHaveLength(WORLD_W);
      for (const id of row) count[id] += 1;
    }
    expect(count).toEqual({ west: 45, north: 35, east: 36, south: 28 }); // кандидат 193: нерівні регіони
  });

  it('межі: Захід 0–4, Схід 12–15, Північ 5–11 × 0–4 з вузлом, Південь 5–11 × 5–8', () => {
    expect(regionOf({ x: 4, y: 8 })).toBe('west');
    expect(regionOf({ x: 5, y: 4 })).toBe('north');
    expect(regionOf({ x: 11, y: 5 })).toBe('south');
    expect(regionOf({ x: 12, y: 0 })).toBe('east');
    expect(regionOf({ x: 15, y: 8 })).toBe('east');
    expect(regionOf(createGeoGame({ seed: 1 }).base)).toBe('north'); // вузол «Рубіж» (8, 4)
    expect(REGION_NAMES).toEqual({ west: 'Порт', north: 'Шпилі', east: 'Промзона', south: 'Нетрі' });
  });

  it('клітинка поза мапою — помилка українською', () => {
    expect(() => regionOf({ x: 16, y: 0 })).toThrow('Клітинка поза мапою: (16, 0)');
    expect(() => regionOf({ x: 0, y: -1 })).toThrow('Клітинка поза мапою');
  });

  it('старт — довіра 100 скрізь, Σ 400', () => {
    const r = createRegions();
    expect(REGION_IDS.map((id) => r[id])).toEqual(REGION_IDS.map(() => ({ trust: 100, out: false })));
    expect(totalTrust(r)).toBe(TRUST_TOTAL_MAX);
    r.east = { trust: 0, out: true };
    r.west.trust = 55;
    expect(totalTrust(r)).toBe(255);
  });
});

describe('п19.2: зміна довіри від подій журналу (ADR-0159 п. 10–11, EARS 2)', () => {
  it('відліт без бою: виявлений −30, невиявлений −15 — регіон клітинки посадки', () => {
    const a = [...probe('u1', { x: 13, y: 2 }, true), left('u1')];
    expect(trustDelta(a, a.length - 1)).toEqual({ region: 'east', delta: -30, reason: 'probe_left' });
    const b = [...probe('u2', { x: 6, y: 7 }, false), left('u2')];
    expect(trustDelta(b, b.length - 1)).toEqual({ region: 'south', delta: -15, reason: 'probe_left' });
  });

  it('відліт після програної місії чи евакуації — довіра без змін', () => {
    for (const type of ['mission_lost', 'mission_evacuated'] as const) {
      const log = [...probe('u1', { x: 1, y: 1 }, true, [{ type, probeId: 'u1', minute: 100 }]), left('u1')];
      expect(trustDelta(log, log.length - 1)).toBeNull();
    }
  });

  it('виграна місія +10 у регіоні зонда; збитий зонд — регіон місця падіння', () => {
    const log = [...probe('u1', { x: 2, y: 3 }, true), won('u1')];
    expect(trustDelta(log, log.length - 1)).toEqual({ region: 'west', delta: 10, reason: 'mission_won' });
    const shot: GeoEvent[] = [
      ...probe('u2', { x: 13, y: 1 }, true),
      { type: 'probe_shot_down', probeId: 'u2', pos: { x: 9, y: 6 }, minute: 60 },
      won('u2'),
    ];
    expect(probeLastPos(shot, shot.length - 1, 'u2')).toEqual({ x: 9, y: 6 });
    expect(trustDelta(shot, shot.length - 1)).toEqual({ region: 'south', delta: 10, reason: 'mission_won' });
  });

  it('самі події програної місії, евакуації і збиття — без змін (аудит PR #521)', () => {
    const log: GeoEvent[] = [
      ...probe('u1', { x: 8, y: 2 }, true),
      { type: 'mission_lost', probeId: 'u1', minute: 100 },
      { type: 'mission_evacuated', probeId: 'u1', minute: 110 },
      { type: 'probe_shot_down', probeId: 'u1', pos: { x: 8, y: 2 }, minute: 120 },
    ];
    for (let i = log.length - 3; i < log.length; i++) expect(trustDelta(log, i)).toBeNull();
  });

  it('інші події і зонд без позиції в журналі — без змін', () => {
    const log: GeoEvent[] = [{ type: 'day', day: 1, minute: 1440 }, left('ghost'), won('ghost')];
    expect([0, 1, 2].map((i) => trustDelta(log, i))).toEqual([null, null, null]);
  });

  it('regionsTick: подія на кожну фактичну зміну, стеля 100, вихід на 0 — один раз назавжди', () => {
    const r = createRegions();
    const log: GeoEvent[] = [...probe('u1', { x: 8, y: 2 }, true), won('u1')];
    let c = regionsTick(r, log, 0, 500);
    expect(c).toBe(log.length);
    expect(r.north.trust).toBe(100); // +10 на 100 — без змін і без події
    expect(log.some((e) => e.type === 'region_trust')).toBe(false);
    for (const id of ['a', 'b', 'c', 'd']) log.push(...probe(id, { x: 8, y: 2 }, true), left(id));
    c = regionsTick(r, log, c, 600);
    expect(c).toBe(log.length); // власні події курсор проходить
    const trustEv = log.filter((e) => e.type === 'region_trust');
    expect(trustEv.map((e) => (e.type === 'region_trust' ? [e.delta, e.trust] : []))).toEqual([
      [-30, 70],
      [-30, 40],
      [-30, 10],
      [-10, 0],
    ]);
    expect(log.filter((e) => e.type === 'region_out')).toEqual([{ type: 'region_out', region: 'north', minute: 600 }]);
    expect(r.north).toEqual({ trust: 0, out: true });
    // вийшов — з подій не змінюється: ні перемога, ні новий відліт
    log.push(...probe('e', { x: 8, y: 2 }, true), won('e'), ...probe('f', { x: 8, y: 2 }, false), left('f'));
    regionsTick(r, log, c, 700);
    expect(r.north).toEqual({ trust: 0, out: true });
    expect(log.filter((e) => e.type === 'region_out')).toHaveLength(1);
    expect(totalTrust(r)).toBe(300);
  });
});

describe('п19.2: дотація з довір регіонів (ADR-0159 п. 12, EARS 3–4)', () => {
  it('за довіри 400 — та сама формула, що й у v0.10.0, на всіх пресетах', () => {
    for (const p of PRESETS) {
      expect(dailyAllowance(p)).toBe(Math.round(DAILY_ALLOWANCE * DIFFICULTY_MULTIPLIERS[p].economyMultiplier));
      expect(dailyAllowance(p, TRUST_TOTAL_MAX)).toBe(dailyAllowance(p));
    }
    expect(dailyAllowance('складний')).toBe(68); // 67,5 → 68 — без похибки множення
  });

  it('частка × довіра: округлення (75 × множник × Σ / 400); усі вийшли — 0', () => {
    expect(dailyAllowance('норма', 300)).toBe(56); // 56,25
    expect(dailyAllowance('норма', 200)).toBe(38); // 37,5
    expect(dailyAllowance('легкий', 355)).toBe(80); // 90 × 355 / 400 = 79,875
    expect(dailyAllowance('норма', 0)).toBe(0);
    expect(dailyAllowance('норма', -5)).toBe(0);
  });

  it('economyTick нараховує дотацію за переданою Σ довір', () => {
    const geo = createGeoGame({ seed: 7 });
    const econ = createEconomy();
    const start = econ.money;
    advanceTime(geo, 48);
    economyTick(econ, geo, 'норма', 300);
    expect(econ.log).toEqual([{ type: 'allowance', day: 1, amount: 56 }]);
    expect(econ.money).toBe(start + 56);
  });
});

describe('п19.2: кампанія — довіра з журналу, траєкторія незмінна (ADR-0159 п. 11, 13)', () => {
  it('120 діб: геоцена байт-у-байт; довіра = повтор trustDelta; загроза — та сама', () => {
    const a = createGeoGame({ seed: 21 });
    const b = createGeoGame({ seed: 21 });
    const c = createCampaign();
    const ctx = { geo: a, roster: createRoster(), econ: createEconomy() };
    for (let i = 0; i < 48 * 120 && c.status === 'триває'; i++) {
      advanceTime(a, 1);
      advanceTime(b, 1);
      campaignTick(ctx, c);
    }
    const own = (e: GeoEvent) =>
      e.type === 'region_trust' || e.type === 'region_out' || e.type === 'campaign_defeat' || e.type === 'base_assault';
    expect(a.log.filter((e) => !own(e))).toEqual(b.log);
    expect(a.rng()).toBe(b.rng());
    // повтор: кожен відліт без бою дає подію зміни довіри, поки регіон не вийшов
    const r = createRegions();
    for (let i = 0; i < c.trustCursor; i++) {
      const ch = trustDelta(a.log, i);
      if (ch === null || r[ch.region].out) continue;
      r[ch.region].trust = Math.max(0, Math.min(100, r[ch.region].trust + ch.delta));
      if (r[ch.region].trust === 0) r[ch.region].out = true;
    }
    expect(c.regions).toEqual(r);
    expect(totalTrust(c.regions)).toBeLessThan(TRUST_TOTAL_MAX);
  });

  it('загроза ігнорує події довіри (threatDelta 0)', () => {
    const log: GeoEvent[] = [
      { type: 'region_trust', region: 'west', delta: -30, trust: 70, reason: 'probe_left', minute: 1 },
      { type: 'region_out', region: 'west', minute: 1 },
    ];
    expect([threatDelta(log, 0), threatDelta(log, 1)]).toEqual([0, 0]);
  });
});

// Сирий блок кампанії сейва для зіпсованих випадків.
type C = { regions?: unknown; trustCursor?: unknown };
type R = Record<string, { trust: unknown; out: unknown }>;

describe('п19.2: сейв v4 (ADR-0159 п. 14, EARS 7)', () => {
  function played(): ReturnType<typeof createParty> {
    const p = createParty(42);
    for (let i = 0; i < 48 * 6; i++) {
      advanceTime(p.geo, 1);
      campaignTick({ geo: p.geo, roster: p.roster, econ: p.econ }, p.campaign);
    }
    return p;
  }

  it('v4 зберігає довіру, вихід і курсор; save → load → save — байт-у-байт', () => {
    const p = played();
    p.campaign.regions.east = { trust: 0, out: true };
    const json = serializeParty(p, 'T');
    const data = JSON.parse(json);
    expect(data.version).toBe(SAVE_VERSION);
    expect(SAVE_VERSION).toBe(4);
    expect(data.state.campaign.regions.east).toEqual({ trust: 0, out: true });
    const again = deserializeParty(json);
    expect(again.campaign.regions).toEqual(p.campaign.regions);
    expect(again.campaign.trustCursor).toBe(p.campaign.trustCursor);
    expect(serializeParty(again, 'T')).toBe(json);
  });

  it.each([3, 2, 1])('v%i мігрує: довіра 100 скрізь, курсор — кінець журналу (старі відльоти не знімають довіри)', (v) => {
    const p = played();
    const data = JSON.parse(serializeParty(p, 'T'));
    data.version = v;
    delete data.state.campaign.regions;
    delete data.state.campaign.trustCursor;
    if (v === 1) delete data.state.roster.careers;
    const m = deserializeParty(JSON.stringify(data));
    expect(m.campaign.regions).toEqual(createRegions());
    expect(m.campaign.trustCursor).toBe(m.geo.log.length);
    campaignTick({ geo: m.geo, roster: m.roster, econ: m.econ }, m.campaign);
    expect(m.campaign.regions).toEqual(createRegions());
    expect(JSON.parse(serializeParty(m, 'T')).version).toBe(4);
  });

  it('v3 з полями регіонів — поля не читаються, міграція', () => {
    const p = played();
    const data = JSON.parse(serializeParty(p, 'T'));
    data.version = 3;
    data.state.campaign.regions = 'сміття';
    expect(deserializeParty(JSON.stringify(data)).campaign.regions).toEqual(createRegions());
  });

  it.each([
    ['довіра 101', (c: C) => ((c.regions as R).west.trust = 101)],
    ['довіра −1', (c: C) => ((c.regions as R).west = { trust: -1, out: false })],
    ['довіра дробом', (c: C) => ((c.regions as R).west.trust = 50.5)],
    ['вийшов з довірою', (c: C) => ((c.regions as R).west.out = true)],
    ['довіра 0 без виходу', (c: C) => ((c.regions as R).west.trust = 0)],
    ['out не булеве', (c: C) => ((c.regions as R).west.out = 'ні')],
    ['немає регіону', (c: C) => delete (c.regions as R).south],
    ['зайвий регіон', (c: C) => ((c.regions as R).center = { trust: 100, out: false })],
    ['регіон null', (c: C) => ((c.regions as Record<string, unknown>).north = null)],
    ['регіони масивом', (c: C) => (c.regions = [])],
    ['немає регіонів', (c: C) => delete c.regions],
    ['курсор поза журналом', (c: C) => (c.trustCursor = 1e9)],
    ['курсор −1', (c: C) => (c.trustCursor = -1)],
    ['курсор рядком', (c: C) => (c.trustCursor = '0')],
  ])('v4: %s — відмова «райони»', (_name, edit) => {
    const data = JSON.parse(serializeParty(played(), 'T'));
    edit(data.state.campaign);
    expect(() => deserializeParty(JSON.stringify(data))).toThrow('Пошкоджені дані збереження: райони');
  });
});
