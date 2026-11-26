// src/core/party-bot.ts — бот-гравець наскрізного циклу партії (П8.5).
// Оркеструє ПОВНУ партію «Рубіжа» від createParty(seed, preset) до поразки за
// загрозою (п18.3, ADR-0155), перемоги або банкрутства (ADR-0021): тіки геоцени →
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
import { REGION_IDS, totalTrust, type RegionId } from './regions';
import {
  applyMissionResult,
  assignBotRoles,
  deployRoles,
  hireSoldier,
  hospitalTick,
  isBankrupt,
  missionRisksBankruptcy,
  missionSquad,
  readySoldiers,
} from './squad';
import {
  FIGHTER_MAX_HP,
  FIGHTER_REPAIR_COST,
  MAX_FIGHTERS,
  fighterInBattle,
  hangarPos,
  interceptRound,
  interceptTick,
  repairTick,
  startIntercept,
  startRepair,
  type Fighter,
} from './intercept';
import { BALANCED_POLICY, type InterceptPolicy } from './intercept-bot';
import { autoBattle, type EvacPolicy } from './ai-bot';
import { completeMission, createMission, type Mission } from './mission';
import { completeAssault, completeGate, createAssault, createGateMission, gateOpen } from './assault';
import { DEFAULT_PRESET, sciencePrice, campaignScore, campaignTick, type CampaignScore, type DifficultyPreset } from './campaign';
import { createParty, type Party } from './save';
// П11.8: наука (research.ts) і цех (workshop.ts) — публічне API ядра, ядро не змінюється.
import {
  HIRE_SCIENTIST_PRICE,
  awardTrophies,
  PROJECT_CATALOG,
  fireScientist,
  hireScientist,
  missingTrophies,
  radarRange,
  researchTick,
  startProject,
  type ProjectId,
  type TrophyCost,
} from './research';
import { ENEMY_ORDER } from './enemies';
import { rankOf } from './career';
import {
  INTERCEPTOR_COST,
  WORKSHOP_CATALOG,
  deployConsumables,
  equipItem,
  installGunModule,
  interceptorCount,
  itemUnlocked,
  orderInterceptor,
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
  fireScientistsWhenDone: boolean; // Т.28: усі протоколи політики завершено — звільнити штат і більше не наймати
  // Т.76 (П15.5, ADR-0075): політика евакуації бота в бою (ai-bot.ts). Немає —
  // бот не евакуює, партії байт-у-байт як до Т.76.
  evac?: EvacPolicy;
  // п18.6 (ADR-0158): трофеї, ще потрібні незапущеним ключовим протоколам політики, не витрачати
  // на предмети цеху («Пробивний заряд» бере трофей гончака). Немає — без резерву.
  reserveTrophies?: boolean;
  // п18.6: фінал «Брама Розриву» — лише коли в загоні стільки бійців зі званням від «Боєць» і вище
  // (missionSquad — ветерани перші). Немає — фінал одразу, щойно брама відкрита і загін повний.
  gateMinRanked?: number;
  // п18.6 (ADR-0158): дозор бота — тримати позицію в дозорі (ai-bot.ts holdStep): 'all' — у кожному бою,
  // 'gate' — лише у фіналі. Немає — бій байт-у-байт як до п18.6.
  hold?: 'all' | 'gate';
  // п19.6 (ADR-0159 п. 17): тримати перехоплювачів (разом із замовленими) не менше — купівля в «Кузні»,
  // коли черга порожня і гроші після оплати не нижчі за резерв найму; ангар — регіон з найнижчою довірою.
  // Немає — без купівлі, партії байт-у-байт як до п19.6.
  interceptorsUpTo?: number;
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
  fireScientistsWhenDone: false,
};

// Політика науки (Т.28, ADR-0091; до того — П11.8: три вчені й усі шість
// протоколів, починаючи з гелю): два техноманти, лише протокол броні, після
// його завершення штат звільнено; цех виготовляє броню за дефіцитом. Виміряно
// probe Т.23–Т.27 (docs/reports/t27-science-entry.md): броня — єдиний предмет,
// що окуповується, а зарплата після протоколу — чиста витрата.
export const SCIENCE_POLICY: PartyBotPolicy = {
  ...DEFAULT_PARTY_POLICY,
  name: 'science',
  scientistsUpTo: 2,
  projects: ['armor'],
  workshopOrders: ['armor'],
  equip: true,
  fireScientistsWhenDone: true,
};

// п18.6 (ADR-0158): політика кампанії — ланцюжок до Брами. Три техноманти (90 точок ланцюжка ≈ 30 діб;
// точки копляться в пулі, поки бракує трофеїв), броня першою, далі ключові протоколи за порядком;
// цех — броня і «Пробивний заряд» з резервом трофеїв; дозор у кожному бою (рішення власника
// «А. У кожному бою»); фінал — коли в загоні троє зі званням від «Боєць». Виміри —
// docs/reports/p18.6-balance.md.
// п19.6 (ADR-0159 п. 17): перехоплювачів політики кампанії — перший і ще один із «Кузні».
export const CAMPAIGN_INTERCEPTORS = 2;
export const CAMPAIGN_POLICY: PartyBotPolicy = {
  ...DEFAULT_PARTY_POLICY,
  name: 'campaign',
  scientistsUpTo: 3,
  projects: ['armor', 'rift-anatomy', 'gate-bearing', 'gate-key'],
  workshopOrders: ['armor', 'breach-charge'],
  equip: true,
  fireScientistsWhenDone: true,
  reserveTrophies: true,
  hold: 'all',
  gateMinRanked: MISSION_SQUAD_SIZE,
  interceptorsUpTo: CAMPAIGN_INTERCEPTORS,
};

export type PartyOutcome = 'триває' | 'перемога' | 'банкрутство' | 'поразка'; // п18.3: «поразка» — загроза 100

// п18.3 (ADR-0153 п. 15, ADR-0155): типовий горизонт simulateParty замість VICTORY_DAY —
// партія без перемоги триває до поразки за загрозою (≈ 64-та доба на «нормі» за темпом п18.1);
// горизонт — запобіжник, якщо загроза не досягла 100.
export const PARTY_HORIZON_DAYS = 120;

// Метрики однієї зіграної партії (П8.5: % до 30 діб, банкрутства/поранення/
// ремонти, крива балансу). Криві — знімки наприкінці кожної завершеної доби.
export interface PartySimResult {
  seed: number;
  preset: DifficultyPreset;
  policy: string;
  outcome: PartyOutcome;
  endDay: number; // перемога, поразка, банкрутство — доба настання; «триває» = завершені доби
  ticks: number; // виконаних тіків геосцени
  score: CampaignScore; // підсумковий рахунок (похідні метрики, campaign.ts)
  missionsLaunched: number;
  missionsWon: number;
  missionsLost: number;
  missionsEvacuated: number; // Т.76: місії з результатом «евакуйовано» (не входять у missionsLost)
  soldiersEvacuated: number; // Т.76: евакуйовані солдати за партію (зокрема в місіях-перемогах)
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
  // п18.4 (ADR-0156): штурми бази і спроби фіналу
  assaults: number; // штурмів (зокрема програних без бою)
  assaultsLost: number;
  gateAttempts: number; // боїв «Брама Розриву»
}

export interface SimulatePartyOptions {
  policy?: PartyBotPolicy;
  maxDays?: number; // горизонт симуляції (дефолт PARTY_HORIZON_DAYS — до кінця партії)
  // п18.6 (кандидат 180): спостерігач стану партії наприкінці кожного тіку — для вимірів скриптів;
  // лише читає (зміна стану — порушення контракту), на результат і лог не впливає.
  onTick?: (party: Readonly<Party>, tick: number) => void;
}

// Виявлені НЛО у повітрі, яких ще не переслідує жоден перехоплювач, — цілі запуску в порядку
// списку геосцени (дзеркало intercept-bot.ts; з одним перехоплювачем — лише перша).
function freeFlyingUfos(party: Party): Ufo[] {
  const chased = new Set(party.intercept.fighters.filter((f) => f.status === 'погоня' || f.status === 'бій').map((f) => f.targetId));
  return party.geo.ufos.filter((u) => u.detected && u.status === 'летить' && !chased.has(u.id));
}

// п19.6 (ADR-0159 п. 17): найближчий до цілі боєготовий перехоплювач (від ангара, Чебишев із
// замиканням по X); рівні — менший id.
function nearestFighter(ready: Fighter[], geo: GeoState, ufo: Ufo): Fighter | null {
  let best: Fighter | null = null;
  let bestDist = Infinity;
  for (const f of ready) {
    const d = chebyshevWrap(hangarPos(f.region, geo), ufo.pos);
    if (d < bestDist) {
      best = f;
      bestDist = d;
    }
  }
  return best;
}

// Раунд повітряного бою бота: дистанція — за політикою; зонда вже немає — interceptRound сам перериває
// бій (`ufo_lost`), вибір для нього не важить. п19.6 (аудит PR #525): до п19.6 охорона «є зонд» лишала
// перехоплювач у «бою» назавжди, коли бот вигравав місію на зонді, з яким той ще бився.
function botRound(party: Party, policy: InterceptPolicy, f: Fighter): void {
  const ic = party.intercept;
  const ufo = party.geo.ufos.find((u) => u.id === ic.activeUfoId);
  const choice = ufo ? policy.chooseRange(ufo.kind, f.hp) : 'відступ';
  interceptRound(ic, party.geo, choice, party.econ, party.campaign.preset, party.roster);
}

// Запобіжник повітряного бою одного тіку (бій з кидками RNG закінчується за кілька раундів).
export const AIR_BATTLE_MAX_ROUNDS = 100;

// п19.6 (ADR-0164; рішення власника «А. Бій як у грі»): повітряний бій, що почався цим тіком, бот
// доводить до кінця, поки час стоїть, — як гравець у застосунку (час у бою не йде, раунди тіків не
// споживають). Викликати одразу після interceptTick, до advanceTime. Повертає зіграні раунди.
export function partyBotAirBattle(party: Party, policy: InterceptPolicy): number {
  let rounds = 0;
  for (
    let f = fighterInBattle(party.intercept);
    f && party.intercept.activeUfoId && rounds < AIR_BATTLE_MAX_ROUNDS;
    f = fighterInBattle(party.intercept)
  ) {
    botRound(party, policy, f);
    rounds += 1;
  }
  return rounds;
}

// Крок бот-гравця перехопленням — дзеркало interceptBotStep (intercept-bot.ts),
// але раунд бою викликається З ПРЕСЕТОМ ПАРТІЇ (критерій П8.5.3): множник
// премії за збиття береться з party.campaign.preset (прецедент panels.ts, П8.4a).
// п19.6 (ADR-0159 п. 17): кожен перехоплювач — за станом на початку кроку (одна дія на крок):
// бій — раунд, пошкоджений у ангарі — ремонт, боєготові — погоня найближчим на кожну вільну ціль за
// порядком; перша ціль, на яку політика не запускає, зупиняє запуски кроку. З одним перехоплювачем —
// байт-у-байт як до п19.6.
export function partyBotInterceptStep(party: Party, policy: InterceptPolicy): void {
  const ic = party.intercept;
  const fighters = [...ic.fighters];
  const inBattle = fighterInBattle(ic);
  const damaged = fighters.filter((f) => f.status === 'на базі' && f.hp < FIGHTER_MAX_HP && !f.repairTicksLeft);
  const ready = fighters.filter((f) => f.status === 'на базі' && f.hp === FIGHTER_MAX_HP);
  if (inBattle && ic.activeUfoId) botRound(party, policy, inBattle);
  for (const f of damaged) {
    // Пошкоджений без ремонту: платимо одразу, як лише є гроші (X-COM досвід, ADR-0021).
    // Т.22 (ADR-0089): без боєготових ремонт чекає — цей крок іде раніше за найм,
    // і ремонт забрав би гроші, на які після розгрому наймають новий загін.
    if (party.econ.money >= FIGHTER_REPAIR_COST && readySoldiers(party.roster).length > 0) {
      startRepair(ic, party.geo, party.econ, f.id);
    }
  }
  for (const target of freeFlyingUfos(party)) {
    const f = nearestFighter(ready, party.geo, target);
    if (!f) break;
    if (!policy.shouldLaunch(target.kind, chebyshevWrap(hangarPos(f.region, party.geo), target.pos))) break;
    startIntercept(ic, party.geo, target.id, f.id);
    ready.splice(ready.indexOf(f), 1);
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
  return sciencePrice(base, preset);
}

// П11.8: дефіцит предмета цеху — скільки ще потрібно виготовити: готових на
// складі + замовлених бракує, щоб екіпірувати всіх, кому предмета не вистача
// (для гарматного модуля — один на винищувач). Порядок — за ростером
// (ветерани перші, прецедент missionSquad), жодного RNG.
function workshopDeficit(party: Party, id: ItemId): number {
  if (id === 'gun-module') {
    // п19.6 (аудит PR #525): на кожен перехоплювач без модуля, мінус склад і черга — інакше, поки
    // перехоплювач у польоті (модуль ставиться лише на базі), бот замовляв модулі без кінця
    const lackingModule = party.intercept.fighters.filter((f) => !f.gunModule).length;
    const supplyModule = party.workshop.store['gun-module'] + party.workshop.queue.filter((o) => o.id === 'gun-module').length;
    return Math.max(0, lackingModule - supplyModule);
  }
  const key: keyof SoldierEquipment = soldierEquipKey(id);
  const lacking = readySoldiers(party.roster).filter((s) => !party.workshop.equipped[s.id]?.[key]).length;
  const supply = party.workshop.store[id] + party.workshop.queue.filter((o) => o.id === id).length;
  return Math.max(0, lacking - supply);
}

// Ключ екіпірування за предметом каталогу (дзеркало SoldierItemIdOf у
// workshop.ts; тут гарматний модуль — помилкою, а не мовчки).
// Гарматний модуль на солдатові не носиться — недосяжно за конструкцією
// (workshopDeficit відсікає його до виклику).
function soldierEquipKey(id: ItemId): 'armor' | 'optics' | 'medkit' | 'grenade' | 'charge' {
  switch (id) {
    case 'armor':
      return 'armor';
    case 'optics':
      return 'optics';
    case 'medkit':
      return 'medkit';
    case 'grenade':
      return 'grenade';
    case 'breach-charge':
      return 'charge'; // п18.2; замовляє політика кампанії (п18.6, CAMPAIGN_POLICY)
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
  if (
    policy.scientistsUpTo <= 0 &&
    policy.projects.length === 0 &&
    policy.workshopOrders.length === 0 &&
    !policy.equip &&
    !policy.interceptorsUpTo
  )
    return;
  const preset = party.campaign.preset;
  const reserve = policy.hireReserve;
  // 1) штат вчених: тримати не менше scientistsUpTo, лишаючи резерв. Т.28:
  // усі протоколи політики завершено — штат звільнити й більше не наймати.
  const done =
    policy.fireScientistsWhenDone && policy.projects.length > 0 && policy.projects.every((id) => party.research.completed.includes(id));
  if (done) for (const sc of [...party.research.scientists]) fireScientist(party.research, sc.id);
  while (
    !done &&
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
    if (missingTrophies(r.trophies, def.trophies) !== undefined) continue; // п18.2: ключовий протокол без трофеїв (аудит PR #513)
    startProject(party.econ, r, id, preset);
    break;
  }
  // 3) цех: замовлення за дефіцитом, перший за пріоритетом; одне активне
  // замовлення (черга порожня) — виробництво не випереджає потребу.
  if (policy.workshopOrders.length > 0 && party.workshop.queue.length === 0) {
    for (const id of policy.workshopOrders) {
      if (!itemUnlocked(party.research, id)) continue; // гейт завершеного проєкту
      if (workshopDeficit(party, id) <= 0) continue;
      if (!trophiesAfford(party, policy, WORKSHOP_CATALOG[id].trophies)) continue; // п18.6: трофеї предмета (заряд)
      if (party.econ.money - presetPrice(WORKSHOP_CATALOG[id].cost, preset) < reserve) continue;
      orderItem(party.econ, party.workshop, party.research, id, preset);
      break;
    }
  }
  // 3.5) п19.6 (ADR-0159 п. 17): перехоплювач — коли черга й далі порожня (предмети цеху першими).
  partyBotFleetStep(party, policy);
  if (!policy.equip) return;
  // 4) екіпірування: готові предмети зі складу — боєготовим у порядку ростера
  // (броня/оптика постійні, аптечка/граната — витратники на наступну місію).
  for (const soldier of readySoldiers(party.roster)) {
    for (const id of ['armor', 'optics', 'medkit', 'grenade', 'breach-charge'] as const) {
      if (party.workshop.equipped[soldier.id]?.[soldierEquipKey(id)]) continue;
      if (party.workshop.store[id] <= 0) continue;
      equipItem(party.workshop, soldier, id);
    }
  }
  // 5) гарматний модуль: зі складу на перехоплювач, лише в ангарі (ADR-0058); п19.6 — за id.
  for (const f of party.intercept.fighters) {
    if (party.workshop.store['gun-module'] <= 0) break;
    if (f.status === 'на базі' && !f.gunModule) installGunModule(party.workshop, party.intercept, f.id);
  }
}

// п19.6 (ADR-0159 п. 17): регіон ангара нового перехоплювача — найнижча довіра серед регіонів,
// що не вийшли; рівні — регіон без перехоплювача, далі порядок REGION_IDS. Усі вийшли — «Північ» (вузол).
export function weakestRegion(party: Pick<Party, 'campaign' | 'intercept'>): RegionId {
  const regions = party.campaign.regions;
  const manned = new Set(party.intercept.fighters.map((f) => f.region));
  const open = REGION_IDS.filter((id) => !regions[id].out);
  if (open.length === 0) return 'north';
  return [...open].sort((a, b) => regions[a].trust - regions[b].trust || Number(manned.has(a)) - Number(manned.has(b)))[0];
}

// п19.6: купівля перехоплювача політикою — до interceptorsUpTo разом із замовленими, черга «Кузні»
// порожня (одне активне замовлення, як предмети), гроші після оплати — не нижче резерву найму
// (hireUpTo × ціна найму пресета + hireReserve).
export function partyBotFleetStep(party: Party, policy: PartyBotPolicy): void {
  const upTo = Math.min(policy.interceptorsUpTo ?? 0, MAX_FIGHTERS); // аудит Vibe PR #525: понад ліміт — не кидати
  if (upTo <= 0 || party.workshop.queue.length > 0) return;
  if (interceptorCount(party.workshop, party.intercept) >= upTo) return;
  // резерв найму — повний загін за ціною пресета і залишок на ремонт (купівля не з'їдає найм після розгрому)
  const reserve = hirePrice(party.campaign.preset) * policy.hireUpTo + policy.hireReserve;
  if (party.econ.money - presetPrice(INTERCEPTOR_COST, party.campaign.preset) < reserve) return;
  orderInterceptor(party.econ, party.workshop, party.intercept, weakestRegion(party), party.campaign.preset);
}

// п18.6 (ADR-0158): чи вистачає трофеїв на предмет цеху з резервом незапущених ключових
// протоколів політики (reserveTrophies) — бот не витрачає гончаків «Анатомії» на заряди.
function trophiesAfford(party: Party, policy: PartyBotPolicy, cost: TrophyCost | undefined): boolean {
  if (!cost) return true;
  const r = party.research;
  const keep: TrophyCost = {};
  if (policy.reserveTrophies) {
    for (const pid of policy.projects) {
      const need = PROJECT_CATALOG[pid].trophies;
      if (!need || r.completed.includes(pid) || r.active.some((p) => p.id === pid)) continue;
      for (const k of ENEMY_ORDER) keep[k] = (keep[k] ?? 0) + (need[k] ?? 0);
    }
  }
  // тип, якого предмет не просить, не перевіряється (резерв голема й ока заряду не стосується)
  return ENEMY_ORDER.every((k) => (cost[k] ?? 0) === 0 || r.trophies[k] - (keep[k] ?? 0) >= (cost[k] ?? 0));
}

export interface MissionStepInfo {
  launched: boolean;
  outcome: 'перемога' | 'поразка' | 'евакуйовано' | null;
  lost: number; // загиблі (перма-смерть)
  evacuated: number; // Т.76: евакуйовані цієї місії (і при перемозі — частковий відступ)
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
  const info: MissionStepInfo = { launched: false, outcome: null, lost: 0, wounded: 0, evacuated: 0 };
  if (!policy.missions) return info;
  if (party.campaign.status !== 'триває') return info; // п18.3: кінець партії — місій немає (gameOver у main.ts)
  if (readySoldiers(party.roster).length < policy.missionSquadSize) return info;
  // Т.22 (ADR-0089): запобіжник останнього загону — без грошей на найм
  // останні боєготові в бій не йдуть (розгром був би банкрутством).
  if (missionRisksBankruptcy(party.econ, party.roster, policy.missionSquadSize, party.campaign.preset)) return info;
  const target = missionTargets(party.geo)[0];
  if (!target) return info;
  const squad = missionSquad(party.roster, policy.missionSquadSize);
  const consumables = deployConsumables(party.workshop, squad);
  const hasItems = Object.keys(consumables).length > 0;
  const roles = deployRoles(party.roster, squad); // п16.3: ролі загону; без ролей — бій як до п16.3
  const mission = createMission(party.geo, target.id, {
    squad,
    ...(hasItems ? { items: consumables } : {}),
    ...(roles ? { roles } : {}),
    threat: party.campaign.threat, // п18.3 (ADR-0153 п. 14): склад ворогів за загрозою
  });
  const battle = autoBattle(mission.state, undefined, policy.evac, policy.hold === 'all'); // ліміт півходів — рідкісний тупик
  // Т.76: «евакуйовано» — НЛО лишається, премії немає (completeMission); тупик — поразка, як і раніше.
  const outcome: 'перемога' | 'поразка' | 'евакуйовано' =
    battle.outcome === 'перемога' ? 'перемога' : battle.outcome === 'евакуйовано' ? 'евакуйовано' : 'поразка';
  completeMission(party.geo, mission.briefing.ufoId, outcome);
  awardTrophies(party.research, mission.state, outcome); // п18.2 (ADR-0153 п. 9): трофеї лише за перемогу
  const aftermath = applyMissionResult(party.roster, mission.state);
  assignBotRoles(party.roster); // п16.3 (ADR-0147 п. 12): роль кожному, хто дослужився до «Боєць»
  removeLostEquipment(party.workshop, aftermath.lost); // броня й око — на склад (ADR-0091)
  settleConsumables(party.workshop, aftermath.survivors, mission.state.items); // витратники (П11.4)
  if (outcome === 'перемога') {
    creditMissionBonus(party.econ, mission.briefing.kind, party.campaign.preset);
  }
  info.launched = true;
  info.outcome = outcome;
  info.lost = aftermath.lost.length;
  info.wounded = aftermath.wounded.length;
  info.evacuated = mission.state.evacuated?.length ?? 0;
  return info;
}

// п18.4 (ADR-0156): бій кампанії авто-боєм — розрахунок ростеру, складу і трофеїв, як у місії
// (без премії); евакуацію політика бота може вмикати лише там, де є зона (брама).
function botCampaignBattle(
  party: Party,
  policy: PartyBotPolicy,
  make: (p: Party, o: { squad: ReturnType<typeof missionSquad> }) => Mission
): { mission: Mission; outcome: 'перемога' | 'поразка' | 'евакуйовано'; lost: number; wounded: number } {
  const squad = missionSquad(party.roster, Math.min(policy.missionSquadSize, readySoldiers(party.roster).length));
  const consumables = deployConsumables(party.workshop, squad);
  const roles = deployRoles(party.roster, squad);
  const mission = make(party, {
    squad,
    ...(Object.keys(consumables).length > 0 ? { items: consumables } : {}),
    ...(roles ? { roles } : {}),
  });
  const hold = policy.hold === 'all' || (policy.hold === 'gate' && make === createGateMission);
  const battle = autoBattle(mission.state, undefined, policy.evac, hold);
  const outcome: 'перемога' | 'поразка' | 'евакуйовано' =
    battle.outcome === 'перемога' ? 'перемога' : battle.outcome === 'евакуйовано' ? 'евакуйовано' : 'поразка';
  awardTrophies(party.research, mission.state, outcome);
  const aftermath = applyMissionResult(party.roster, mission.state);
  assignBotRoles(party.roster);
  removeLostEquipment(party.workshop, aftermath.lost);
  settleConsumables(party.workshop, aftermath.survivors, mission.state.items);
  return { mission, outcome, lost: aftermath.lost.length, wounded: aftermath.wounded.length };
}

export interface CampaignBattleInfo {
  fought: boolean; // штурм відбувся (зокрема програний без бою) / фінал зіграно
  outcome: 'перемога' | 'поразка' | 'евакуйовано' | null;
  lost: number;
  wounded: number;
}

// п18.4 (ADR-0153 п. 16): штурм бази — одразу, як у застосунку (main.ts startPendingAssault):
// загін до 3 боєготових (без запобіжника останнього загону — штурм не обирають), без боєготових —
// програно без бою. Один штурм за крок.
export function partyBotAssaultStep(party: Party, policy: PartyBotPolicy): CampaignBattleInfo {
  const info: CampaignBattleInfo = { fought: false, outcome: null, lost: 0, wounded: 0 };
  if (party.campaign.status !== 'триває' || !party.campaign.assaultPending) return info;
  info.fought = true;
  if (readySoldiers(party.roster).length === 0) {
    completeAssault(party, 'поразка');
    info.outcome = 'поразка';
    return info;
  }
  const b = botCampaignBattle(party, policy, createAssault);
  const outcome = b.outcome === 'перемога' ? 'перемога' : 'поразка'; // евакуації в штурмі немає
  completeAssault(party, outcome);
  return { fought: true, outcome, lost: b.lost, wounded: b.wounded };
}

// п18.4 (ADR-0153 п. 17, 19): фінал — щойно брама відкрита і загін повний; п18.6 (ADR-0158):
// з gateMinRanked — ще й коли в загоні (missionSquad, ветерани перші) стільки бійців від «Боєць».
export function partyBotGateStep(party: Party, policy: PartyBotPolicy): CampaignBattleInfo {
  const info: CampaignBattleInfo = { fought: false, outcome: null, lost: 0, wounded: 0 };
  if (!policy.missions || !gateOpen(party)) return info;
  if (readySoldiers(party.roster).length < policy.missionSquadSize) return info;
  if (policy.gateMinRanked !== undefined) {
    const squad = missionSquad(party.roster, policy.missionSquadSize);
    if (squad.filter((u) => rankOf(party.roster.careers[u.id]?.xp ?? 0) >= 1).length < policy.gateMinRanked) return info;
  }
  const b = botCampaignBattle(party, policy, createGateMission);
  completeGate(party, b.outcome);
  return { fought: true, outcome: b.outcome, lost: b.lost, wounded: b.wounded };
}

// П8.5: зіграти повну партію бот-гравцем і зібрати метрики. Порядок фаз тіка —
// partyTick (main.ts) + рішення гравця між тіками; перехоплення — порядок
// simulateInterceptCampaign (intercept-bot.ts). Завершення (п18.3): поразка за загрозою
// чи перемога (campaignTick), банкрутство (isBankrupt) або горизонт maxDays
// (для коротких смоук-симуляцій). Детермінізм (ADR-0003): без власного RNG,
// сід + пресет + політика = байт-у-байт той самий результат.
export function simulateParty(seed: number, preset: DifficultyPreset = DEFAULT_PRESET, opts: SimulatePartyOptions = {}): PartySimResult {
  const policy = opts.policy ?? DEFAULT_PARTY_POLICY;
  const maxDays = opts.maxDays ?? PARTY_HORIZON_DAYS;
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
    missionsEvacuated: 0,
    soldiersEvacuated: 0,
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
    assaults: 0,
    assaultsLost: 0,
    gateAttempts: 0,
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
    partyBotAirBattle(party, policy.intercept); // п19.6: бій — до кінця, поки час стоїть
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
    advanceTime(party.geo, 1, radarRange(party.research)); // п18.2 (ADR-0153 п. 12)
    economyTick(party.econ, party.geo, party.campaign.preset, totalTrust(party.campaign.regions)); // п19.2
    researchTick(party.research, party.econ, party.geo, party.campaign.preset);
    workshopTick(party.workshop, party.intercept, party.geo);
    hospitalTick(party.roster);
    // п18.3 (аудит PR #514): загроза — наприкінці тіку, до рішень гравця, як partyTick у main.ts:
    // склад місії цього тіку бачить події доби й відльотів цього тіку; поразка — місій немає.
    campaignTick({ geo: party.geo, roster: party.roster, econ: party.econ }, party.campaign);

    // Фаза 2.5 (п18.4): штурм бази — до рішень гравця, як startPendingAssault у partyTick.
    const a = partyBotAssaultStep(party, policy);
    if (a.fought) {
      res.assaults += 1;
      if (a.outcome !== 'перемога') res.assaultsLost += 1;
      res.soldiersLost += a.lost;
      res.soldiersWounded += a.wounded;
    }

    // Фаза 3: найм (перед місіями — загін має бути повним).
    res.hiredTotal += partyBotHireStep(party, policy);

    // Фаза 3.5 (П11.8): рішення науки — вчені/проєкти/цех/екіпірування
    // (перед місією: витратники цього тика йдуть у бій).
    partyBotScienceStep(party, policy);

    // Фаза 3.8 (п18.4): фінал «Брама Розриву» — перед звичайною місією.
    const g = partyBotGateStep(party, policy);
    if (g.fought) {
      res.gateAttempts += 1;
      res.soldiersLost += g.lost;
      res.soldiersWounded += g.wounded;
    }

    // Фаза 4: тактична місія (час геосцени заморожено — синхронний бій).
    const m = partyBotMissionStep(party, policy);
    if (m.launched) {
      res.missionsLaunched += 1;
      if (m.outcome === 'перемога') res.missionsWon += 1;
      else if (m.outcome === 'евакуйовано') res.missionsEvacuated += 1;
      else res.missionsLost += 1;
      res.soldiersEvacuated += m.evacuated;
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
      if (e.type === 'interceptor_order') res.workshopSpent += presetPrice(INTERCEPTOR_COST, preset); // п19.6
      if (e.type === 'produced') res.workshopProduced += 1;
      if (e.type === 'equip') res.equippedItems += 1;
    }
    workshopCursor = party.workshop.log.length;

    res.ticks = t + 1;
    opts.onTick?.(party, t);

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

    // п18.3: загроза кампанії — поразка на 100 (перемога — фінальна місія, п18.4); події місії
    // цього тіку враховує вже цей виклик (у main.ts — наступний partyTick; послідовність загрози та сама).
    campaignTick({ geo: party.geo, roster: party.roster, econ: party.econ }, party.campaign);
    if (party.campaign.status !== 'триває') {
      res.outcome = party.campaign.status;
      break;
    }
  }

  if (res.outcome === 'перемога' || res.outcome === 'поразка' || res.outcome === 'банкрутство')
    res.endDay = geoDay(party.geo); // доба настання
  else res.endDay = res.moneyByDay.length; // «триває» = завершені доби горизонту
  // П11.8: витрати на найм — за фактом найнятих × ціна за пресетом (детерміновано;
  // spend-події суму не розрізняють після синхронізації hirePrice з наукою).
  res.hireSpent = res.hiredTotal * hirePrice(preset);
  res.score = campaignScore(party.geo, party.roster, party.econ);
  return res;
}
