// src/core/party-bot.ts — бот-гравець наскрізного циклу партії (П8.5).
// Оркеструє ПОВНУ партію «Рубіжа» від createParty(seed, preset) до перемоги на
// межі 30-ї доби (ADR-0033) або банкрутства (ADR-0021): тіки геоцени →
// перехоплення НЛО → тактичні місії → найм/лікування/ремонт.
//
// ADR-0002: чисте ядро без DOM/Canvas — лише публічне API наявних модулів
// (ядро НЕ змінюється, критерій П8.5.2). Патерн DemoSteps (ai-bot.ts) —
// покроковий драйвер бою autoBattle; прецедент масової симуляції з метриками —
// simulateInterceptCampaign (intercept-bot.ts).
//
// ADR-0003 (детермінізм): оркестратор НЕ має власного RNG — усі кидки
// лишаються в ін'єктованих RNG наявних станів (геосцена, перехоплення, сід
// місії з missionSeed). Рішення бота залежать лише від стану, тому
// сід + пресет + політика = байт-у-байт той самий лог і результат.
//
// Критерій П8.5.3: усі рантайм-виклики передають пресет партії
// (party.campaign.preset) — economyTick/hireSoldier/creditMissionBonus/
// interceptRound (прецедент шару застосунку main.ts/battle.ts/panels.ts,
// П8.4a). Без цього симуляції ×2 пресети міряли б однакові партії.

import { TICK_MINUTES, advanceTime, chebyshevWrap, geoDay, missionTargets, type GeoState, type Ufo } from './geo';
import { HIRE_PRICE, creditMissionBonus, economyTick } from './economy';
import { applyMissionResult, hireSoldier, hospitalTick, isBankrupt, missionSquad, readySoldiers } from './squad';
import { FIGHTER_MAX_HP, FIGHTER_REPAIR_COST, interceptRound, interceptTick, repairTick, startIntercept, startRepair } from './intercept';
import { BALANCED_POLICY, type InterceptPolicy } from './intercept-bot';
import { autoBattle } from './ai-bot';
import { completeMission, createMission } from './mission';
import { DEFAULT_PRESET, VICTORY_DAY, campaignScore, campaignTick, type CampaignScore, type DifficultyPreset } from './campaign';
import { createParty, type Party } from './save';

export const TICKS_PER_DAY = 1440 / TICK_MINUTES; // 48 тіків на добу геоцени
export const MISSION_SQUAD_SIZE = 3; // повний загін (SQUAD_SPAWN.length, mission.ts)

// Політика бот-гравця партії: детерміновані рішення лише за станом (ADR-0003).
export interface PartyBotPolicy {
  name: string;
  intercept: InterceptPolicy; // політика перехоплень (intercept-bot.ts)
  missions: boolean; // запускати тактичні місії з приземлених/збитих НЛО
  missionSquadSize: number; // боєготових для запуску місії (повний загін)
  hireUpTo: number; // тримати боєготових не менше (найм, ADR-0021)
  hireReserve: number; // мінімальний залишок грошей після найму (резерв на ремонт)
}

// Стандартна політика (X-COM-стиль): перехоплення — balanced (intercept-bot),
// місії — повним загоном, найм — до трьох боєготових із резервом на ремонт.
export const DEFAULT_PARTY_POLICY: PartyBotPolicy = {
  name: 'balanced',
  intercept: BALANCED_POLICY,
  missions: true,
  missionSquadSize: MISSION_SQUAD_SIZE,
  hireUpTo: MISSION_SQUAD_SIZE,
  hireReserve: FIGHTER_REPAIR_COST,
};

export type PartyOutcome = 'триває' | 'перемога' | 'банкрутство';

// Метрики однієї зіграної партії (П8.5: % до 30 діб, банкрутства/поранення/
// ремонти, крива балансу). Криві — знімки наприкінці кожної завершеної доби.
export interface PartySimResult {
  seed: number;
  preset: DifficultyPreset;
  policy: string;
  outcome: PartyOutcome;
  endDay: number; // перемога = 30; банкрутство = доба настання; «триває» = завершені доби
  ticks: number; // виконаних тіків геосцени
  score: CampaignScore; // підсумковий рахунок (похідні метрики, campaign.ts)
  missionsLaunched: number;
  missionsWon: number;
  missionsLost: number;
  hiredTotal: number;
  hireSpent: number;
  soldiersLost: number; // перма-смерть (ADR-0021)
  soldiersWounded: number; // госпіталізації після місій
  launches: number; // перехоплень
  engagements: number;
  shotDown: number;
  repairs: number;
  repairSpent: number;
  repairsWhenPoor: number; // бої з HP=0 без грошей на ремонт («запаркований» винищувач)
  moneyByDay: number[]; // крива балансу: гроші наприкінці доби 1..N
  readyByDay: number[]; // крива ростера: боєготові наприкінці доби 1..N
}

export interface SimulatePartyOptions {
  policy?: PartyBotPolicy;
  maxDays?: number; // горизонт симуляції (дефолт VICTORY_DAY — повна партія)
}

// Перший виявлений НЛО у повітрі — ціль запуску (дзеркало intercept-bot.ts).
function detectedFlyingUfo(geo: GeoState): Ufo | null {
  const list = geo.ufos.filter((u) => u.detected && u.status === 'летить');
  return list.length ? list[0] : null;
}

// Крок бот-гравця перехопленням — дзеркало interceptBotStep (intercept-bot.ts),
// але раунд бою викликається З ПРЕСЕТОМ ПАРТІЇ (критерій П8.5.3): множник
// премії за збиття береться з party.campaign.preset (прецедент panels.ts, П8.4a).
export function partyBotInterceptStep(party: Party, policy: InterceptPolicy): void {
  const ic = party.intercept;
  const f = ic.fighter;
  if (f.status === 'на базі' && f.hp === FIGHTER_MAX_HP) {
    const target = detectedFlyingUfo(party.geo);
    if (target && policy.shouldLaunch(target.kind, chebyshevWrap(party.geo.base, target.pos))) {
      startIntercept(ic, party.geo, target.id);
    }
  } else if (f.status === 'на базі' && f.hp < FIGHTER_MAX_HP && !f.repairTicksLeft) {
    // Пошкоджений без ремонту: платимо одразу, як лише є гроші (X-COM досвід, ADR-0021).
    if (party.econ.money >= FIGHTER_REPAIR_COST) startRepair(ic, party.geo, party.econ);
  } else if (f.status === 'бій' && ic.activeUfoId) {
    const ufo = party.geo.ufos.find((u) => u.id === ic.activeUfoId);
    if (ufo) {
      interceptRound(ic, party.geo, policy.chooseRange(ufo.kind, f.hp), party.econ, party.campaign.preset);
    }
  }
}

// Крок найму: тримати боєготових не менше hireUpTo, лишаючи резерв на ремонт
// винищувача. Виживання понад резерв: ready = 0 → найм, поки є гроші (інакше
// партія застрягне без солдатів і без місій). hireUpTo <= 0 — політика
// «не наймати» (для симуляцій банкрутства). Пресет — party.campaign.preset
// (HP новобранця ×1.2 на «легкому», критерій П8.5.3). Повертає кількість найнятих.
export function partyBotHireStep(party: Party, policy: PartyBotPolicy): number {
  if (policy.hireUpTo <= 0) return 0;
  let hired = 0;
  while (
    readySoldiers(party.roster).length < policy.hireUpTo &&
    party.econ.money >= HIRE_PRICE &&
    (party.econ.money - HIRE_PRICE >= policy.hireReserve || readySoldiers(party.roster).length === 0)
  ) {
    hireSoldier(party.econ, party.roster, party.campaign.preset);
    hired += 1;
  }
  return hired;
}

export interface MissionStepInfo {
  launched: boolean;
  outcome: 'перемога' | 'поразка' | null;
  lost: number; // загиблі (перма-смерть)
  wounded: number; // поранені → лікарня
}

// Крок тактичних місій: перший кандидат missionTargets (приземлений/збитий),
// боєготових — на повний загін. Бій — синхронний autoBattle (ai-bot.ts, патерн
// DemoSteps); час геосцени на бій не тікає (mission.ts). Результат — у ростер
// (лікарня/перма-смерть, squad.ts) і геосцену; премія — з пресетом партії
// (критерій П8.5.3, прецедент battle.ts П8.4a). Одна місія за крок.
export function partyBotMissionStep(party: Party, policy: PartyBotPolicy): MissionStepInfo {
  const info: MissionStepInfo = { launched: false, outcome: null, lost: 0, wounded: 0 };
  if (!policy.missions) return info;
  if (readySoldiers(party.roster).length < policy.missionSquadSize) return info;
  const target = missionTargets(party.geo)[0];
  if (!target) return info;
  const squad = missionSquad(party.roster, policy.missionSquadSize);
  const mission = createMission(party.geo, target.id, { squad });
  const battle = autoBattle(mission.state); // ліміт півходів autoBattle — рідкісний тупик
  const outcome: 'перемога' | 'поразка' = battle.outcome === 'перемога' ? 'перемога' : 'поразка';
  completeMission(party.geo, mission.briefing.ufoId, outcome);
  const aftermath = applyMissionResult(party.roster, mission.state);
  if (outcome === 'перемога') {
    creditMissionBonus(party.econ, mission.briefing.kind, party.campaign.preset);
  }
  info.launched = true;
  info.outcome = outcome;
  info.lost = aftermath.lost.length;
  info.wounded = aftermath.wounded.length;
  return info;
}

// П8.5: зіграти повну партію бот-гравцем і зібрати метрики. Порядок фаз тіка —
// partyTick (main.ts) + рішення гравця між тіками; перехоплення — порядок
// simulateInterceptCampaign (intercept-bot.ts). Завершення: перемога на межі
// 30-ї доби (campaignTick), банкрутство (isBankrupt) або горизонт maxDays
// (для коротких смоук-симуляцій). Детермінізм (ADR-0003): без власного RNG,
// сід + пресет + політика = байт-у-байт той самий результат.
export function simulateParty(seed: number, preset: DifficultyPreset = DEFAULT_PRESET, opts: SimulatePartyOptions = {}): PartySimResult {
  const policy = opts.policy ?? DEFAULT_PARTY_POLICY;
  const maxDays = opts.maxDays ?? VICTORY_DAY;
  const party = createParty(seed, preset);
  const res: PartySimResult = {
    seed,
    preset,
    policy: policy.name,
    outcome: 'триває',
    endDay: 0,
    ticks: 0,
    score: { ufosShotDown: 0, missionsWon: 0, veteransAlive: 0, moneyLeft: 0, total: 0 },
    missionsLaunched: 0,
    missionsWon: 0,
    missionsLost: 0,
    hiredTotal: 0,
    hireSpent: 0,
    soldiersLost: 0,
    soldiersWounded: 0,
    launches: 0,
    engagements: 0,
    shotDown: 0,
    repairs: 0,
    repairSpent: 0,
    repairsWhenPoor: 0,
    moneyByDay: [],
    readyByDay: [],
  };
  let icCursor = 0; // курсор журналу перехоплень (метрики — з нових подій)
  let econCursor = 0; // курсор журналу економіки
  let lastDay = geoDay(party.geo);

  for (let t = 0; t < maxDays * TICKS_PER_DAY; t++) {
    // Фаза 1: рішення перехоплень + погоня/ремонт (порядок intercept-bot.ts).
    partyBotInterceptStep(party, policy.intercept);
    interceptTick(party.intercept, party.geo);
    repairTick(party.intercept, party.geo);
    for (const e of party.intercept.log.slice(icCursor)) {
      if (e.type === 'intercept_start') res.launches += 1;
      if (e.type === 'intercept_engage') res.engagements += 1;
      if (e.type === 'ufo_shot_down') res.shotDown += 1;
      if (e.type === 'fighter_repair_start') res.repairs += 1;
      if (e.type === 'intercept_aborted' && e.reason === 'fighter_damaged') {
        // Гроші міряємо в мить події — до дотації цієї доби (семантика intercept-bot.ts).
        if (party.econ.money < FIGHTER_REPAIR_COST) res.repairsWhenPoor += 1;
      }
    }
    icCursor = party.intercept.log.length;

    // Фаза 2: тік партії — той самий порядок, що partyTick (main.ts, П8.4a).
    advanceTime(party.geo, 1);
    economyTick(party.econ, party.geo, party.campaign.preset);
    hospitalTick(party.roster);

    // Фаза 3: найм (перед місіями — загін має бути повним).
    res.hiredTotal += partyBotHireStep(party, policy);

    // Фаза 4: тактична місія (час геосцени заморожено — синхронний бій).
    const m = partyBotMissionStep(party, policy);
    if (m.launched) {
      res.missionsLaunched += 1;
      if (m.outcome === 'перемога') res.missionsWon += 1;
      else res.missionsLost += 1;
      res.soldiersLost += m.lost;
      res.soldiersWounded += m.wounded;
    }

    // Фаза 5: витрати з журналу економіки (spend не несе призначення —
    // розрізняємо за сумою: найм 100, ремонт 50; патерн intercept-bot.ts).
    for (const e of party.econ.log.slice(econCursor)) {
      if (e.type === 'spend' && e.amount === HIRE_PRICE) res.hireSpent += e.amount;
      if (e.type === 'spend' && e.amount === FIGHTER_REPAIR_COST) res.repairSpent += e.amount;
    }
    econCursor = party.econ.log.length;

    res.ticks = t + 1;

    // Кінець доби — знімок кривих балансу (гроші + боєготові).
    const day = geoDay(party.geo);
    if (day !== lastDay) {
      res.moneyByDay.push(party.econ.money);
      res.readyByDay.push(readySoldiers(party.roster).length);
      lastDay = day;
    }

    // Банкрутство (ADR-0021): боєготових немає і грошей на найм немає.
    if (isBankrupt(party.econ, party.roster)) {
      res.outcome = 'банкрутство';
      break;
    }

    // Перемога на межі 30-ї доби (ADR-0033; no-op до межі й після).
    campaignTick({ geo: party.geo, roster: party.roster, econ: party.econ }, party.campaign);
    if (party.campaign.status === 'перемога') {
      res.outcome = 'перемога';
      break;
    }
  }

  if (res.outcome === 'перемога') res.endDay = VICTORY_DAY;
  else if (res.outcome === 'банкрутство')
    res.endDay = geoDay(party.geo); // доба настання
  else res.endDay = res.moneyByDay.length; // «триває» = завершені доби горизонту
  res.score = campaignScore(party.geo, party.roster, party.econ);
  return res;
}
