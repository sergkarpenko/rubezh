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
//
// П11.8: політика науки (ADR-0058) — вчені, проєкти, цех, екіпірування.
// Патерн ізоляції П11.2/П11.4: усі поля науки в DEFAULT_PARTY_POLICY вимкнені,
// наука нікого не викликає — партії без науки байт-у-байт незмінні
// (критерій П11.8.2). Політика SCIENCE_POLICY — базова для probe-симуляцій
// П11.8 (scripts/sim-p11.8.ts).

import { TICK_MINUTES, advanceTime, chebyshevWrap, geoDay, missionTargets, type GeoState, type Ufo } from './geo';
import { creditMissionBonus, economyTick, hirePrice } from './economy';
import { applyMissionResult, hireSoldier, hospitalTick, isBankrupt, missionSquad, readySoldiers } from './squad';
import { FIGHTER_MAX_HP, FIGHTER_REPAIR_COST, interceptRound, interceptTick, repairTick, startIntercept, startRepair } from './intercept';
import { BALANCED_POLICY, type InterceptPolicy } from './intercept-bot';
import { autoBattle } from './ai-bot';
import { completeMission, createMission } from './mission';
import {
  DEFAULT_PRESET,
  DIFFICULTY_MULTIPLIERS,
  VICTORY_DAY,
  campaignScore,
  campaignTick,
  type CampaignScore,
  type DifficultyPreset,
} from './campaign';
import { createParty, type Party } from './save';
// П11.8: наука (research.ts) і цех (workshop.ts) — публічне API ядра, ядро не змінюється.
import { HIRE_SCIENTIST_PRICE, PROJECT_CATALOG, hireScientist, researchTick, startProject, type ProjectId } from './research';
import {
  WORKSHOP_CATALOG,
  deployConsumables,
  equipItem,
  installGunModule,
  orderItem,
  removeLostEquipment,
  settleConsumables,
  workshopTick,
  type ItemId,
  type SoldierEquipment,
} from './workshop';

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
  // П11.8 (ADR-0058): політика науки. Усі поля вимкнені в DEFAULT — партії
  // без науки байт-у-байт незмінні (критерій П11.8.2, патерн ізоляції П11.2).
  scientistsUpTo: number; // тримати штат вчених не менше (0 = не наймати)
  projects: ProjectId[]; // порядок запуску проєктів (пріоритет; порожній = без проєктів)
  workshopOrders: ItemId[]; // порядок замовлень цеху (виготовляти за дефіцитом складу)
  equip: boolean; // екіпірувати готові предмети боєготових + гарматний модуль
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
  scientistsUpTo: 0,
  projects: [],
  workshopOrders: [],
  equip: false,
};

// П11.8: базова політика науки для probe-симуляцій (X-COM-стиль): штат трьох
// вчених (3 точки/добу), проєкти за пріоритетом «виживання → точність →
// винищувач», цех — за дефіцитом екіпірування. Числа стратегії — частина
// probe-гріду (робити/не робити науку проти DEFAULT — перший стовпець звіту).
export const SCIENCE_POLICY: PartyBotPolicy = {
  ...DEFAULT_PARTY_POLICY,
  name: 'science',
  scientistsUpTo: 3,
  projects: ['medkit', 'optics', 'armor', 'gun-module', 'grenade', 'lab-extension'],
  workshopOrders: ['medkit', 'optics', 'armor', 'gun-module', 'grenade'],
  equip: true,
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
  // П11.8: метрики науки (ADR-0058) — з подій журналів research/workshop
  // (патерн econCursor; призначення spend не несе — суми за каталогами подій).
  scientistsHired: number;
  scientistsFired: number; // авто-звільнення за невиплату (спіраль П11.2)
  salaryShortfallDays: number; // доб з невиплатою зарплати (спіраль П11.2)
  salarySpent: number;
  projectSpent: number; // кошти за стартовані проєкти
  workshopSpent: number; // кошти за замовлення цеху
  projectsCompleted: number;
  completedProjects: ProjectId[]; // у порядку завершення
  workshopProduced: number; // предмети, що дійшли до складу
  equippedItems: number; // екіпірування на солдатів (після втрат — повторне)
  scientistsByDay: number[]; // крива штату вчених наприкінці доби 1..N
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
  // П11.8: ціна найму за пресетом (hirePrice, ADR-0058) — «норма» 100 байт-у-байт.
  const cost = hirePrice(party.campaign.preset);
  while (
    readySoldiers(party.roster).length < policy.hireUpTo &&
    party.econ.money >= cost &&
    (party.econ.money - cost >= policy.hireReserve || readySoldiers(party.roster).length === 0)
  ) {
    hireSoldier(party.econ, party.roster, party.campaign.preset);
    hired += 1;
  }
  return hired;
}

// П11.8: ціна за пресетом — дзеркало формул research.ts/workshop.ts для
// перевірок «заплатимо без резерву» до виклику (spend сам кидає помилку,
// але бот не має «примх» — рішення лише за станом, ADR-0003).
function presetPrice(base: number, preset: DifficultyPreset): number {
  return Math.round(base * DIFFICULTY_MULTIPLIERS[preset].economyMultiplier);
}

// П11.8: дефіцит предмета цеху — скільки ще потрібно виготовити: готових на
// складі + замовлених бракує, щоб екіпірувати всіх, кому предмета не вистача
// (для гарматного модуля — один на винищувач). Порядок — за ростером
// (ветерани перші, прецедент missionSquad), жодного RNG.
function workshopDeficit(party: Party, id: ItemId): number {
  if (id === 'gun-module') return party.intercept.fighter.gunModule ? 0 : 1;
  const key: keyof SoldierEquipment = soldierEquipKey(id);
  const lacking = readySoldiers(party.roster).filter((s) => !party.workshop.equipped[s.id]?.[key]).length;
  const supply = party.workshop.store[id] + party.workshop.queue.filter((o) => o.id === id).length;
  return Math.max(0, lacking - supply);
}

// Ключ екіпірування за предметом каталогу (дзеркало SoldierItemIdOf у
// workshop.ts — там приватний; дублювання маленьке, ядро не розкриває).
// Гарматний модуль на солдатові не носиться — недосяжно за конструкцією
// (workshopDeficit відсікає його до виклику).
function soldierEquipKey(id: ItemId): 'armor' | 'optics' | 'medkit' | 'grenade' {
  switch (id) {
    case 'armor':
      return 'armor';
    case 'optics':
      return 'optics';
    case 'medkit':
      return 'medkit';
    case 'grenade':
      return 'grenade';
    case 'gun-module':
      throw new Error('Гарматний модуль перехоплювача — озброєння перехоплювача, ключ екіпірування оперативника недосяжний');
  }
}

// Крок бот-гравця наукою (П11.8, ADR-0058): найм вчених до policy.
// scientistsUpTo, старт першого доступного проєкту за пріоритетом (один за
// крок), замовлення цеху за дефіцитом (черга порожня — одне активне
// замовлення, прецедент UI), екіпірування готових предметів боєготових і
// встановлення гарматного модуля. Резерв грошей — спільний hireReserve
// (ремонт винищувача лишають на кращі часи). Уся політика вимкнена — no-op
// (партії без науки байт-у-байт незмінні, критерій П11.8.2).
export function partyBotScienceStep(party: Party, policy: PartyBotPolicy): void {
  if (policy.scientistsUpTo <= 0 && policy.projects.length === 0 && policy.workshopOrders.length === 0 && !policy.equip) return;
  const preset = party.campaign.preset;
  const reserve = policy.hireReserve;
  // 1) штат вчених: тримати не менше scientistsUpTo, лишаючи резерв.
  while (
    party.research.scientists.length < policy.scientistsUpTo &&
    party.econ.money - presetPrice(HIRE_SCIENTIST_PRICE, preset) >= reserve
  ) {
    hireScientist(party.econ, party.research, preset);
  }
  // 2) проєкти: перший за пріоритетом, який можна запустити (не завершений,
  // не активний, передумова виконана, є слот, кошти з резервом) — один за крок.
  for (const id of policy.projects) {
    const r = party.research;
    if (r.completed.includes(id) || r.active.some((p) => p.id === id)) continue;
    if (r.active.length >= r.slots) break; // слоти зайняті — нижчі пріоритети не стартувати
    const def = PROJECT_CATALOG[id];
    if (def.prerequisite !== undefined && !r.completed.includes(def.prerequisite)) continue;
    if (party.econ.money - presetPrice(def.cost, preset) < reserve) continue;
    startProject(party.econ, r, id, preset);
    break;
  }
  // 3) цех: замовлення за дефіцитом, перший за пріоритетом; одне активне
  // замовлення (черга порожня) — виробництво не випереджає потребу.
  if (policy.workshopOrders.length > 0 && party.workshop.queue.length === 0) {
    for (const id of policy.workshopOrders) {
      if (!party.research.completed.includes(id)) continue; // гейт завершеного проєкту
      if (workshopDeficit(party, id) <= 0) continue;
      if (party.econ.money - presetPrice(WORKSHOP_CATALOG[id].cost, preset) < reserve) continue;
      orderItem(party.econ, party.workshop, party.research, id, preset);
      break;
    }
  }
  if (!policy.equip) return;
  // 4) екіпірування: готові предмети зі складу — боєготовим у порядку ростера
  // (броня/оптика постійні, аптечка/граната — витратники на наступну місію).
  for (const soldier of readySoldiers(party.roster)) {
    for (const id of ['armor', 'optics', 'medkit', 'grenade'] as const) {
      if (party.workshop.equipped[soldier.id]?.[soldierEquipKey(id)]) continue;
      if (party.workshop.store[id] <= 0) continue;
      equipItem(party.workshop, soldier, id);
    }
  }
  // 5) гарматний модуль: зі складу на перехоплювач, лише у вузлі (ADR-0058).
  if (party.intercept.fighter.status === 'на базі' && !party.intercept.fighter.gunModule && party.workshop.store['gun-module'] > 0) {
    installGunModule(party.workshop, party.intercept);
  }
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
// (критерій П8.5.3, прецедент battle.ts П8.4a). П11.8: витратники загону —
// копія екіпірування в бій (deployConsumables) і розрахунок після
// (settleConsumables + removeLostEquipment, дзеркало finish у ui/battle.ts).
// Без екіпірованих витратників items не передається — бій байт-у-байт
// як до П11.8 (критерій П11.8.2). Одна місія за крок.
export function partyBotMissionStep(party: Party, policy: PartyBotPolicy): MissionStepInfo {
  const info: MissionStepInfo = { launched: false, outcome: null, lost: 0, wounded: 0 };
  if (!policy.missions) return info;
  if (readySoldiers(party.roster).length < policy.missionSquadSize) return info;
  const target = missionTargets(party.geo)[0];
  if (!target) return info;
  const squad = missionSquad(party.roster, policy.missionSquadSize);
  const consumables = deployConsumables(party.workshop, squad);
  const hasItems = Object.keys(consumables).length > 0;
  const mission = createMission(party.geo, target.id, hasItems ? { squad, items: consumables } : { squad });
  const battle = autoBattle(mission.state); // ліміт півходів autoBattle — рідкісний тупик
  const outcome: 'перемога' | 'поразка' = battle.outcome === 'перемога' ? 'перемога' : 'поразка';
  completeMission(party.geo, mission.briefing.ufoId, outcome);
  const aftermath = applyMissionResult(party.roster, mission.state);
  removeLostEquipment(party.workshop, aftermath.lost); // перма-смерть предметів (П11.3)
  settleConsumables(party.workshop, aftermath.survivors, mission.state.items); // витратники (П11.4)
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
    scientistsHired: 0,
    scientistsFired: 0,
    salaryShortfallDays: 0,
    salarySpent: 0,
    projectSpent: 0,
    workshopSpent: 0,
    projectsCompleted: 0,
    completedProjects: [],
    workshopProduced: 0,
    equippedItems: 0,
    scientistsByDay: [],
  };
  let icCursor = 0; // курсор журналу перехоплень (метрики — з нових подій)
  let econCursor = 0; // курсор журналу економіки
  let researchCursor = 0; // П11.8: курсор журналу науки
  let workshopCursor = 0; // П11.8: курсор журналу цеху
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

    // Фаза 2: тік партії — той самий порядок, що partyTick (main.ts, П8.4a);
    // П11.8: researchTick/workshopTick додано дзеркально partyTick — без
    // вчених і замовлень no-op (критерій П11.8.2).
    advanceTime(party.geo, 1);
    economyTick(party.econ, party.geo, party.campaign.preset);
    researchTick(party.research, party.econ, party.geo, party.campaign.preset);
    workshopTick(party.workshop);
    hospitalTick(party.roster);

    // Фаза 3: найм (перед місіями — загін має бути повним).
    res.hiredTotal += partyBotHireStep(party, policy);

    // Фаза 3.5 (П11.8): рішення науки — вчені/проєкти/цех/екіпірування
    // (перед місією: витратники цього тика йдуть у бій).
    partyBotScienceStep(party, policy);

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
    // розрізняємо за сумою: ремонт 50; патерн intercept-bot.ts). Найм
    // П11.8 сумою не розрізнити (hirePrice збігається з наймом вченого) —
    // hireSpent рахуємо за фактом: hiredTotal × ціна найму за пресетом.
    for (const e of party.econ.log.slice(econCursor)) {
      if (e.type === 'spend' && e.amount === FIGHTER_REPAIR_COST) res.repairSpent += e.amount;
    }
    econCursor = party.econ.log.length;

    // Фаза 5.5 (П11.8): метрики науки з журналів research/workshop — ті самі
    // курсори, що й економіка; суми витрат — за каталогами подій (призначення
    // spend не несе, суми науку/найм солдатів не завжди розрізнити за сумою).
    for (const e of party.research.log.slice(researchCursor)) {
      if (e.type === 'hire') res.scientistsHired += 1;
      if (e.type === 'salary') res.salarySpent += e.amount;
      if (e.type === 'salary_shortfall') {
        res.salaryShortfallDays += 1;
        res.scientistsFired += e.fired.length;
      }
      if (e.type === 'project_started') res.projectSpent += presetPrice(PROJECT_CATALOG[e.id].cost, preset);
      if (e.type === 'project_completed') {
        res.projectsCompleted += 1;
        res.completedProjects.push(e.id);
      }
    }
    researchCursor = party.research.log.length;
    for (const e of party.workshop.log.slice(workshopCursor)) {
      if (e.type === 'order') res.workshopSpent += presetPrice(WORKSHOP_CATALOG[e.id].cost, preset);
      if (e.type === 'produced') res.workshopProduced += 1;
      if (e.type === 'equip') res.equippedItems += 1;
    }
    workshopCursor = party.workshop.log.length;

    res.ticks = t + 1;

    // Кінець доби — знімок кривих балансу (гроші + боєготові + штат вчених).
    const day = geoDay(party.geo);
    if (day !== lastDay) {
      res.moneyByDay.push(party.econ.money);
      res.readyByDay.push(readySoldiers(party.roster).length);
      res.scientistsByDay.push(party.research.scientists.length);
      lastDay = day;
    }

    // Банкрутство (ADR-0021): боєготових немає і грошей на найм немає
    // (П11.8: поріг найму за пресетом — 120/100/90).
    if (isBankrupt(party.econ, party.roster, party.campaign.preset)) {
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
  // П11.8: витрати на найм — за фактом найнятих × ціна за пресетом (детерміновано;
  // spend-події суму не розрізняють після синхронізації hirePrice з наукою).
  res.hireSpent = res.hiredTotal * hirePrice(preset);
  res.score = campaignScore(party.geo, party.roster, party.econ);
  return res;
}
