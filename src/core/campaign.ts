// src/core/campaign.ts
// Ітерація П8.2: мета кампанії (ADR-0033) — перемога на 30-ту добу з підсумковим рахунком.
// ADR-0002: чисте ядро без DOM; ADR-0003: campaign не має власного RNG — усі кидки
// лишаються в наявних ін'єктованих RNG (геоцени, перехоплення), geo.rng не викликається.
// Патерн ізоляції шарів (як economy.ts/squad.ts, ADR-0008/0021): geo.ts не знає про
// кампанію, стан кампанії живе в Party (save.ts) поруч із GeoState/EconomyState/Roster.
// Підсумковий рахунок — похідні метрики партії без нового стану (ADR-0033): збиті в
// повітрі НЛО та переможні місії — з журналу геоцени, живі ветерани — з ростера,
// залишок коштів — з економіки. Вагові коефіцієнти — константи, калібруються
// масовими симуляціями Фази 8 (П8.5/П8.6). Пресети складності ('легкий'/'норма' —
// П8.4, 'складний' — П10.3); тут лише ім'я пресета в стані (дефолт «норма», ADR-0033).

import { geoDay, type GeoEvent, type GeoState } from './geo';
import type { Roster } from './squad';
import type { EconomyState } from './economy';

export const VICTORY_DAY = 30; // перемога фіксується на межі 30-ї доби (ADR-0033)

// Вагові коефіцієнти рахунку — константи (ADR-0033); зафіксовано П8.6 за симуляціями
// (120 сідів × 2 пресети, docs/reports/p8.6-tuning.md): ветерани ×2 (ростер — головний
// актив кампанії, ADR-0021), гроші ×0.5 — рахунок про людей і перемоги, а не про купу грошей.
export const SCORE_PER_UFO_SHOT_DOWN = 100;
export const SCORE_PER_MISSION_WON = 150;
export const SCORE_PER_VETERAN_ALIVE = 50;
export const SCORE_PER_MONEY = 0.25;

export type DifficultyPreset = 'легкий' | 'норма' | 'складний'; // множники — П8.4; «складний» — П10.3
export const DEFAULT_PRESET: DifficultyPreset = 'норма'; // ADR-0033: дефолт «норма»

// P8.4: множники для пресетів. П10.3: «складний» — початкові числа за probe П8.6
// (спавн — не ручка тиску: більше НЛО → більше місій → більше премій → легше,
// docs/reports/p8.6-tuning.md), тож ufoSpawnMultiplier = 1.0; тиск — HP солдатів
// і економіка (менше грошей). П10.4: числа затверджено власником 2026-10-17 за
// симуляціями 120 сідів (docs/reports/p10.4-tuning.md): HP ×0.9 (ефективно 9 HP,
// ручка дискретна через Math.round) + економіка ×0.9 → 58.3% перемог бот-гравця
// проти 90% у «норми» (32.5% на початкових числах — надто жорстко). Спавн знову
// не міняли: probe на «складному» дав обернений знак (spawn 1.2 → 19.2% перемог).
export const DIFFICULTY_MULTIPLIERS = {
  легкий: {
    ufoSpawnMultiplier: 0.7,
    hpBonusMultiplier: 1.2,
    economyMultiplier: 1.2,
  },
  норма: {
    ufoSpawnMultiplier: 1.0,
    hpBonusMultiplier: 1.0,
    economyMultiplier: 1.0,
  },
  складний: {
    ufoSpawnMultiplier: 1.0,
    hpBonusMultiplier: 0.9,
    economyMultiplier: 0.9,
  },
} as const;

export type CampaignStatus = 'триває' | 'перемога';

export interface CampaignScore {
  ufosShotDown: number; // збиті в повітрі НЛО (intercept, ADR-0032)
  missionsWon: number; // переможні тактичні місії (mission.ts)
  veteransAlive: number; // живі ветерани кампанії (ростер)
  moneyLeft: number; // залишок коштів (economy.ts)
  total: number; // сума зважених метрик
}

export interface CampaignState {
  status: CampaignStatus;
  preset: DifficultyPreset;
  score: CampaignScore | null; // фіксується один раз на межі 30-ї доби
  victoryDay: number | null;
}

export function createCampaign(preset: DifficultyPreset = DEFAULT_PRESET): CampaignState {
  return { status: 'триває', preset, score: null, victoryDay: null };
}

function countEvents(log: GeoEvent[], type: GeoEvent['type']): number {
  let n = 0;
  for (const e of log) if (e.type === type) n += 1;
  return n;
}

// Підсумковий рахунок партії — похідні метрики без нового стану (ADR-0033).
export function campaignScore(geo: GeoState, roster: Roster, econ: EconomyState): CampaignScore {
  const ufosShotDown = countEvents(geo.log, 'ufo_shot_down');
  const missionsWon = countEvents(geo.log, 'mission_won');
  const veteransAlive = roster.soldiers.length;
  const moneyLeft = econ.money;
  const total =
    ufosShotDown * SCORE_PER_UFO_SHOT_DOWN +
    missionsWon * SCORE_PER_MISSION_WON +
    veteransAlive * SCORE_PER_VETERAN_ALIVE +
    moneyLeft * SCORE_PER_MONEY;
  return { ufosShotDown, missionsWon, veteransAlive, moneyLeft, total: Math.round(total) };
}

export interface CampaignContext {
  geo: GeoState;
  roster: Roster;
  econ: EconomyState;
}

// Тік кампанії: на межі 30-ї завершеної доби реєструє в журналі геоцени подію перемоги
// і один раз фіксує підсумковий рахунок (ADR-0033). Доби геоцени нумеруються з 1
// (geoDay), тому 30 повних діб пройдено, коли настала доба 31 (minute >= 30 * 1440) —
// та сама мить, коли geoTick записує подію 'day' 31. Повторні виклики на межі та після —
// no-op, дублікати не нараховуються, зафіксований рахунок не перераховується.
// geo.rng не викликається — траєкторія геоцени незмінна (ADR-0003). Викликається шаром
// застосунку після geoTick (як economyTick).
export function campaignTick(ctx: CampaignContext, campaign: CampaignState): void {
  if (campaign.status === 'перемога') return;
  if (geoDay(ctx.geo) <= VICTORY_DAY) return;
  const score = campaignScore(ctx.geo, ctx.roster, ctx.econ);
  campaign.status = 'перемога';
  campaign.score = score;
  campaign.victoryDay = VICTORY_DAY;
  ctx.geo.log.push({
    type: 'campaign_victory',
    day: VICTORY_DAY,
    score: score.total,
    minute: ctx.geo.minute,
  });
}
