// src/core/campaign.ts
// Ітерація П8.2: мета кампанії (ADR-0033) — перемога на 30-ту добу з підсумковим рахунком.
// п18.3 (ADR-0153 п. 13–15, ADR-0155): перемоги на межі 30-ї доби більше немає — шкала
// загрози 0–100 рахується з подій журналу геоцени, 100 — поразка партії; перемога —
// виграна фінальна місія (п18.4). Рахунок фіксується в мить кінця партії.
// ADR-0002: чисте ядро без DOM; ADR-0003: campaign не має власного RNG — усі кидки
// лишаються в наявних ін'єктованих RNG (геоцени, перехоплення), geo.rng не викликається.
// Патерн ізоляції шарів (як economy.ts/squad.ts, ADR-0008/0021): geo.ts не знає про
// кампанію, стан кампанії живе в Party (save.ts) поруч із GeoState/EconomyState/Roster.
// Підсумковий рахунок — похідні метрики партії без нового стану (ADR-0033): збиті в
// повітрі НЛО та переможні місії — з журналу геоцени, живі ветерани — з ростера,
// залишок коштів — з економіки. Вагові коефіцієнти — константи, калібруються
// масовими симуляціями Фази 8 (П8.5/П8.6). Пресети складності ('легкий'/'норма' —
// П8.4, 'складний' — П10.3); тут лише ім'я пресета в стані (дефолт «норма», ADR-0033).

import { geoDay, probeLeftKind, type GeoEvent, type GeoState } from './geo';
import { createRegions, regionsTick, type Regions } from './regions';
import type { Roster } from './squad';
import type { EconomyState } from './economy';

// п18.3 (ADR-0153 п. 13): числа шкали загрози — перемір probe п18.6 без змін (ADR-0158).
export const THREAT_MAX = 100; // загроза 100 — поразка партії
export const THREAT_PER_DAY = 2; // за кожну завершену добу (подія 'day')
export const THREAT_PROBE_LEFT_DETECTED = 6; // виявлений зонд відлетів без бою
export const THREAT_PROBE_LEFT_UNDETECTED = 2; // невиявлений зонд відлетів (радар має ціну)
export const THREAT_MISSION_WON = -1; // виграна місія стримує загрозу
export const THREAT_BATTLE_LOST = 10; // п18.4: програний штурм бази чи фінал (ADR-0153 п. 13)
// п18.4 (ADR-0153 п. 16): штурм бази — коли загроза вперше досягає порога (по одному на поріг).
export const ASSAULT_THRESHOLDS: readonly number[] = [60, 75, 90];

// Вагові коефіцієнти рахунку — константи (ADR-0033); зафіксовано П8.6 за симуляціями
// (120 сідів × 2 пресети, docs/reports/p8.6-tuning.md): ветерани ×2 (ростер — головний
// актив кампанії, ADR-0021), гроші ×0.5 — рахунок про людей і перемоги, а не про купу грошей.
export const SCORE_PER_PROBE_SHOT_DOWN = 100;
export const SCORE_PER_MISSION_WON = 150;
export const SCORE_PER_VETERAN_ALIVE = 50;
export const SCORE_PER_MONEY = 0.25;

export type DifficultyPreset = 'легкий' | 'норма' | 'складний'; // множники — П8.4; «складний» — П10.3
export const DEFAULT_PRESET: DifficultyPreset = 'норма'; // ADR-0033: дефолт «норма»

// P8.4: множники для пресетів. П10.3: «складний» — початкові числа за probe П8.6
// (спавн — не ручка тиску: більше НЛО → більше місій → більше премій → легше,
// docs/reports/p8.6-tuning.md), тож probeSpawnMultiplier = 1.0; тиск — HP солдатів
// і економіка (менше грошей). П10.4: числа затверджено власником 2026-10-17 за
// симуляціями 120 сідів (docs/reports/p10.4-tuning.md): HP ×0.9 (ефективно 9 HP,
// ручка дискретна через Math.round) + економіка ×0.9 → 58.3% перемог бот-гравця
// проти 90% у «норми» (32.5% на початкових числах — надто жорстко). Спавн знову
// не міняли: probe на «складному» дав обернений знак (spawn 1.2 → 19.2% перемог).
export const DIFFICULTY_MULTIPLIERS = {
  легкий: {
    probeSpawnMultiplier: 0.7,
    hpBonusMultiplier: 1.2,
    economyMultiplier: 1.2,
    scienceMultiplier: 0.5,
  },
  норма: {
    probeSpawnMultiplier: 1.0,
    hpBonusMultiplier: 1.0,
    economyMultiplier: 1.0,
    scienceMultiplier: 1.0,
  },
  складний: {
    probeSpawnMultiplier: 1.0,
    hpBonusMultiplier: 0.9,
    economyMultiplier: 0.9,
    scienceMultiplier: 0.9,
  },
} as const;

// Т.29 (ADR-0092): ціни науки — найм і зарплата техноманта, протоколи, предмети
// цеху — множаться на scienceMultiplier пресету, а не на economyMultiplier.
// «Норма» і «складний» — ті самі числа, що й раніше (1.0 і 0.9); «легкий» —
// 0.5 замість 1.2: втрат там мало, і за цінами ×1.2 броня не окуповувалась
// (probe на 480 сідах — docs/reports/t29-easy-science.md).
export function sciencePrice(base: number, preset: DifficultyPreset = DEFAULT_PRESET): number {
  return Math.round(base * DIFFICULTY_MULTIPLIERS[preset].scienceMultiplier);
}

export type CampaignStatus = 'триває' | 'перемога' | 'поразка';

export interface CampaignScore {
  probesShotDown: number; // збиті в повітрі НЛО (intercept, ADR-0032)
  missionsWon: number; // переможні тактичні місії (mission.ts)
  veteransAlive: number; // живі ветерани кампанії (ростер)
  moneyLeft: number; // залишок коштів (economy.ts)
  total: number; // сума зважених метрик
}

export interface CampaignState {
  status: CampaignStatus;
  preset: DifficultyPreset;
  score: CampaignScore | null; // фіксується один раз у мить кінця партії (перемога чи поразка)
  victoryDay: number | null;
  defeatDay: number | null; // п18.3: доба поразки за загрозою
  threat: number; // п18.3: шкала загрози 0–100
  threatCursor: number; // п18.3: скільки подій geo.log уже враховано в загрозі
  // п19.2 (ADR-0159 п. 11, 14): довіра регіонів і окремий курсор журналу геоцени (сейв v4).
  regions: Regions;
  trustCursor: number;
  // п18.4 (ADR-0155 п. 9, ADR-0156): необов'язкові поля сейва v3 — без поля 0 / false.
  assaults?: number; // скільки порогів штурму вже спрацювало (0..3)
  assaultPending?: boolean; // штурм почався і чекає бою (застосунок — бій одразу, бот — авто-бій)
  gateReadyAt?: number; // хвилина геоцени, з якої брама знову доступна (після поразки — +1440)
}

export function createCampaign(preset: DifficultyPreset = DEFAULT_PRESET): CampaignState {
  return {
    status: 'триває',
    preset,
    score: null,
    victoryDay: null,
    defeatDay: null,
    threat: 0,
    threatCursor: 0,
    regions: createRegions(),
    trustCursor: 0,
  };
}

// Зонд відлетів: виявлений і без бою — +6, невиявлений — +2, після бою — 0 (probeLeftKind, geo.ts).
function probeLeftDelta(log: GeoEvent[], i: number, probeId: string): number {
  const kind = probeLeftKind(log, i, probeId);
  return kind === 'fought' ? 0 : kind === 'detected' ? THREAT_PROBE_LEFT_DETECTED : THREAT_PROBE_LEFT_UNDETECTED;
}

// Зміна загрози від однієї події журналу геоцени (ADR-0153 п. 13); решта подій — 0.
export function threatDelta(log: GeoEvent[], i: number): number {
  const e = log[i];
  if (e.type === 'day') return THREAT_PER_DAY;
  if (e.type === 'mission_won') return THREAT_MISSION_WON;
  if (e.type === 'probe_left') return probeLeftDelta(log, i, e.probeId);
  if (e.type === 'assault_lost' || e.type === 'gate_lost') return THREAT_BATTLE_LOST; // п18.4
  return 0;
}

function countEvents(log: GeoEvent[], type: GeoEvent['type']): number {
  let n = 0;
  for (const e of log) if (e.type === type) n += 1;
  return n;
}

// Підсумковий рахунок партії — похідні метрики без нового стану (ADR-0033).
export function campaignScore(geo: GeoState, roster: Roster, econ: EconomyState): CampaignScore {
  const probesShotDown = countEvents(geo.log, 'probe_shot_down');
  const missionsWon = countEvents(geo.log, 'mission_won');
  const veteransAlive = roster.soldiers.length;
  const moneyLeft = econ.money;
  const total =
    probesShotDown * SCORE_PER_PROBE_SHOT_DOWN +
    missionsWon * SCORE_PER_MISSION_WON +
    veteransAlive * SCORE_PER_VETERAN_ALIVE +
    moneyLeft * SCORE_PER_MONEY;
  return { probesShotDown, missionsWon, veteransAlive, moneyLeft, total: Math.round(total) };
}

export interface CampaignContext {
  geo: GeoState;
  roster: Roster;
  econ: EconomyState;
}

// Тік кампанії (п18.3, ADR-0153 п. 13, 15): нові події журналу геоцени від курсора
// змінюють загрозу (межі 0 і THREAT_MAX після кожної події); щойно загроза досягла
// THREAT_MAX — статус «поразка», рахунок фіксується один раз, подія 'campaign_defeat'.
// Кінець партії (перемога чи поразка) — no-op, курсор далі не рухається.
// geo.rng не викликається — траєкторія геоцени незмінна (ADR-0003). Викликається шаром
// застосунку після geoTick (як economyTick); події місій між тіками враховує наступний тік.
export function campaignTick(ctx: CampaignContext, campaign: CampaignState): void {
  if (campaign.status !== 'триває') return;
  const log = ctx.geo.log;
  // п19.2 (ADR-0159 п. 11): довіра — до загрози; її події ('region_trust', 'region_out') загрози не змінюють.
  campaign.trustCursor = regionsTick(campaign.regions, log, campaign.trustCursor, ctx.geo.minute);
  while (campaign.threatCursor < log.length) {
    const i = campaign.threatCursor;
    campaign.threatCursor += 1;
    campaign.threat = Math.max(0, Math.min(THREAT_MAX, campaign.threat + threatDelta(log, i)));
    if (campaign.threat >= THREAT_MAX) {
      const score = campaignScore(ctx.geo, ctx.roster, ctx.econ);
      campaign.status = 'поразка';
      campaign.score = score;
      campaign.defeatDay = geoDay(ctx.geo);
      log.push({ type: 'campaign_defeat', day: campaign.defeatDay, score: score.total, minute: ctx.geo.minute });
      campaign.threatCursor = log.length;
      return;
    }
  }
  // п18.4 (ADR-0153 п. 16): поріг штурму — по одному; наступний чекає, поки бій не відбувся.
  const done = campaign.assaults ?? 0;
  if (!campaign.assaultPending && done < ASSAULT_THRESHOLDS.length && campaign.threat >= ASSAULT_THRESHOLDS[done]) {
    campaign.assaults = done + 1;
    campaign.assaultPending = true;
    log.push({ type: 'base_assault', threshold: ASSAULT_THRESHOLDS[done], minute: ctx.geo.minute });
    campaign.threatCursor = log.length;
  }
}
