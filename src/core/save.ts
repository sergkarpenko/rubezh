// src/core/save.ts
// Ітерація П5.2: збереження/відновлення партії — ядро без DOM (ADR-0026).
// ADR-0002: чисте ядро; конкретне сховище (localStorage у main.ts) підключається
// через абстракцію слоту «рядок-значення» (SlotStore).
// ADR-0003: geo.rng не викликається під час збереження — траєкторія не зсувається;
// позиція потоку зберігається як число (rng.state, mulberry32), тому відновлена
// партія продовжує траєкторію оригіналу байт-у-байт.
// ADR-0026: активна місія не зберігається (кнопки активні лише на геосцені);
// метадані слоту — похідні від збереженого стану.
// Формат: { version: 5, seed, savedAt, state } (п16.2, ADR-0147 п. 15: v2 —
// кар'єри оперативників roster.careers; сейв v1 мігрує на вході, migrateCareers;
// п18.3, ADR-0153 п. 18: v3 — загроза кампанії, сейви v1 і v2 мігрують, migrateThreat;
// п19.2, ADR-0159 п. 14: v4 — довіра регіонів, сейви v1–v3 мігрують з довірою 100;
// п22.2, ADR-0182 п. 8: v5 — гілки кар'єри `branches`, сейв v4 відкривається без гілок). Невідома версія або пошкоджений
// JSON — throw з українським текстом, без часткового стану. Зміни схеми —
// новою версією + міграцією на вході.

import { mulberry32, type StatefulRng, type Unit, type Vec2 } from './combat';
import { WEAPONS, isForgeWeapon } from './weapons';
import { WORLD_H, WORLD_W, createGeoGame, geoDay, type GeoEvent, type GeoState, type Probe } from './geo';
import { createRoster, type Roster } from './squad';
import {
  applyRankBonus,
  CAREER_TREE,
  newCareer,
  rankOf,
  SERGEANT_RANK,
  VETERAN_RANK,
  type SoldierCareer,
  type SoldierRole,
} from './career';
import { createEconomy, type EconomyEvent, type EconomyState } from './economy';
import {
  createIntercept,
  FIGHTER_MAX_HP,
  FIGHTER_REPAIR_TICKS,
  interceptRngState,
  MAX_FIGHTERS,
  type Fighter,
  type InterceptEvent,
  type InterceptState,
} from './intercept';
import { createCampaign, DEFAULT_PRESET, THREAT_MAX, ASSAULT_THRESHOLDS, type CampaignState, type DifficultyPreset } from './campaign';
import { ENEMY_ORDER } from './enemies';
import { createRegions, REGION_IDS, TRUST_MAX, type RegionId, type Regions } from './regions';
import {
  createResearch,
  emptyTrophies,
  type ProjectId,
  type ResearchEvent,
  type ResearchState,
  type Scientist,
  type TrophyStore,
  SCIENTIST_SPECS,
  BASE_LAB_SLOTS,
} from './research';
import { createModules, moduleMaxLevel, MODULE_IDS, type BaseModules } from './base';
import {
  createWorkshop,
  emptyStore,
  type ItemId,
  type SoldierEquipment,
  type SoldierItemId,
  type WorkshopEvent,
  type WorkshopState,
} from './workshop';

export const SAVE_VERSION = 5;
// п22.2 (ADR-0182 п. 8, ADR-0183): сейв v4 (Фази 19–21) вантажиться без гілок кар'єри.
export const SAVE_VERSION_V4 = 4;
// п19.2 (ADR-0159 п. 14): сейв v3 (Фаза 18) вантажиться з довірою 100 в усіх регіонах.
export const SAVE_VERSION_V3 = 3;
// п18.3 (ADR-0153 п. 18): сейв v2 (Фази 16–17) вантажиться з міграцією загрози.
export const SAVE_VERSION_V2 = 2;
// п16.2 (ADR-0147 п. 15): сейв v1 (до Фази 16) вантажиться з міграцією кар'єр.
export const SAVE_VERSION_V1 = 1;
export const SAVE_SLOTS = 3; // ADR-0026: три слоти, ключі rubezh.save.1..3 у main.ts

// П12.6 (ADR-0064/0026): міграція ключів каталогів при завантаженні сейвів
// ≤0.3.0. До П12.6 значення ProjectId/ItemId були українськими рядками і
// водночас ключами у сейві (completed/store/queue/логи подій); відображувані
// назви перейменовані за мапою ADR-0064, ключі стали стабільними
// англійськими ідентифікаторами, незалежними від назв. Формат (структура,
// version 1) не зростає: міграція — на вході при deserializeParty (прецедент
// опційних полів П7.4/П8.2). Невідомий ключ лишяється як є — дані не
// знищуємо, ядро відмовляється явно (throw «Невідомий протокол/предмет»).
const LEGACY_PROJECT_KEYS: Record<string, ProjectId> = {
  'легка броня': 'armor',
  'оптичний приціл': 'optics',
  аптечка: 'medkit',
  'осколкова граната': 'grenade',
  'гарматний модуль': 'gun-module',
  'розширення лабораторії': 'lab-extension',
};

function migrateProjectKey(id: string): ProjectId {
  return LEGACY_PROJECT_KEYS[id] ?? (id as ProjectId);
}

// Ключі предметів «Кузні» — ті самі, крім «Розширення лабораторії» (слот
// відкриває, предмета не виробляє — ItemId виключає його за визначенням).
const LEGACY_ITEM_KEYS: Record<string, ItemId> = {
  'легка броня': 'armor',
  'оптичний приціл': 'optics',
  аптечка: 'medkit',
  'осколкова граната': 'grenade',
  'гарматний модуль': 'gun-module',
};

function migrateItemKey(id: string): ItemId {
  return LEGACY_ITEM_KEYS[id] ?? (id as ItemId);
}

// П9.2 (Фаза 9): прапорці показаних підказок журналу — «один раз за партію».
// true = підказку вже показано; false = ще не показано. Сейв-сумісність (ADR-0026,
// прецедент П7.4): старий сейв без поля hints = усі прапорці false — підказки
// ще не показано (рішення власника зафіксовано в сесії П9.2, 2026-10-16).
export interface HintFlags {
  intercept: boolean; // «Можна перехопити»
  mission: boolean; // «Доступна місія»
  repair: boolean; // «Ремонт завершено»
  evac: boolean; // Т.72: «Можна евакуюватись»
}

export type HintKey = keyof HintFlags;

export function defaultHints(): HintFlags {
  return { intercept: false, mission: false, repair: false, evac: false };
}

// Атомарне «бронювання» підказки: true — лише перший виклик (підказку щойно
// показано і прапорець стоїтиме в сейві); далі — false. Чистий стан, без RNG.
export function claimHint(hints: HintFlags, key: HintKey): boolean {
  if (hints[key]) return false;
  hints[key] = true;
  return true;
}

// Партія — єдиний стан збереження: GeoState + Roster + EconomyState + сід.
// Сід окремо: GeoState не зберігає походження свого rng, а він потрібен
// у форматі сейва (ADR-0026) і для подальших планів на авто-продовження.
export interface Party {
  seed: number;
  geo: GeoState;
  roster: Roster;
  econ: EconomyState;
  intercept: InterceptState; // П7.4 (ADR-0032): стан винищувача — у Party
  campaign: CampaignState; // П8.2 (ADR-0033): стан кампанії — у Party
  hints: HintFlags; // П9.2: прапорці підказок — у Party (один раз за партію)
  research: ResearchState; // П11.2 (ADR-0058): штат вчених і проєкти — у Party
  workshop: WorkshopState; // П11.3 (ADR-0058): черга цеху і склад — у Party
  modules: BaseModules; // п22.5 (ADR-0187): рівні модулів бази — у Party
}

// П8.4a (борг П8.4): пресет партії передається в усі фабрики ядра — geo
// (частота НЛО), roster (HP солдатів), econ (стартові кошти), campaign (ім'я
// пресету в стані, сейв фіксує — П8.2). Дефолт «норма» — старі виклики без
// змін; runtime-множники дотацій/премій шар застосунку бере з campaign.preset.
export function createParty(seed: number, preset: DifficultyPreset = DEFAULT_PRESET): Party {
  return {
    seed,
    geo: createGeoGame({ seed, preset }),
    roster: createRoster(undefined, preset),
    econ: createEconomy(preset),
    intercept: createIntercept(seed),
    campaign: createCampaign(preset),
    hints: defaultHints(),
    research: createResearch(),
    workshop: createWorkshop(),
    modules: createModules(),
  };
}

// Серіалізований стан: усе, що описує подальшу траєкторію. rng.state — позиція
// потоку mulberry32 (не сам файл-функція: функції не серіалізуються).
interface GeoSave {
  rngState: number;
  minute: number;
  base: Vec2;
  probes: Probe[];
  log: GeoEvent[];
  spawnChance: number;
  maxProbes: number;
  nextId: number;
}

interface RosterSave {
  soldiers: Unit[];
  hired: number;
  hospital: Record<string, number>;
  careers?: Record<string, SoldierCareer>; // п16.2: обов'язкове у v2, немає у v1
}

// п16.2 (ADR-0147): копія кар'єр у порядку ростеру — save → load → save дає
// той самий рядок (детермінізм, ADR-0003).
function copyCareers(soldiers: Unit[], careers: Record<string, SoldierCareer>): Record<string, SoldierCareer> {
  const out: Record<string, SoldierCareer> = {};
  for (const s of soldiers) {
    const c = careers[s.id];
    out[s.id] = c.branches === undefined ? { ...c } : { ...c, branches: { ...c.branches } };
  }
  return out;
}

const ROLES: readonly (SoldierRole | null)[] = ['assault', 'sniper', 'medic', null];

// Кар'єра v2: типи полів, невід'ємні лічильники і зараховані вбивства не
// більше за kills юніта (інакше settleCareer зменшив би досвід — аудит PR #499).
// п22.2: гілки — лише в сейві v5, лише варіант своєї розвилки і лише з досягнутим званням.
function validBranches(b: unknown, k: Record<string, unknown>): boolean {
  if (b === undefined) return true;
  if (b === null || typeof b !== 'object' || Array.isArray(b)) return false;
  const { sergeant, veteran, ...rest } = b as Record<string, unknown>;
  if (Object.keys(rest).length > 0) return false;
  const rank = rankOf(k.xp as number);
  const role = k.role as SoldierRole | null;
  const sergeantOk =
    sergeant === undefined ||
    (role !== null && rank >= SERGEANT_RANK && (CAREER_TREE.sergeant[role] as readonly unknown[]).includes(sergeant));
  const veteranOk =
    veteran === undefined ||
    (sergeant !== undefined && rank >= VETERAN_RANK && (CAREER_TREE.veteran as readonly unknown[]).includes(veteran));
  return sergeantOk && veteranOk;
}

function validCareer(c: unknown, kills: number, withBranches: boolean): boolean {
  if (c === null || typeof c !== 'object') return false;
  const k = c as Record<string, unknown>;
  return (
    typeof k.callsign === 'string' &&
    typeof k.bio === 'string' &&
    Number.isInteger(k.xp) &&
    (k.xp as number) >= 0 &&
    Number.isInteger(k.missions) &&
    (k.missions as number) >= 0 &&
    Number.isInteger(k.killsCounted) &&
    (k.killsCounted as number) >= 0 &&
    (k.killsCounted as number) <= kills &&
    ROLES.includes(k.role as SoldierRole | null) &&
    (withBranches ? validBranches(k.branches, k) : k.branches === undefined)
  );
}

// п16.2 (ADR-0147 п. 15, EARS 10): міграція ростеру сейву v1. Оперативник
// старого сейву: досвід = kills (вбивства вже зараховано), місій 0, позивний і
// біографія з пулів за порядковим номером найму (id «sN» → номер N − 1), без
// ролі; звання з досвіду — прирости в запис юніта (soldiers — уже копії).
// п18.3 (ADR-0153 п. 18): загроза сейва v1 / v2 — min(99, 2 × (доба − 1)) мінус виграні
// місії з журналу, не менше 0; події, що вже були, загрозу більше не змінюють (курсор — кінець журналу).
export function migrateThreat(geo: GeoState): number {
  const won = geo.log.filter((e) => e.type === 'mission_won').length;
  return Math.max(0, Math.min(THREAT_MAX - 1, 2 * (geoDay(geo) - 1)) - won);
}

function migrateCareers(soldiers: Unit[]): Record<string, SoldierCareer> {
  const out: Record<string, SoldierCareer> = {};
  for (const s of soldiers) {
    const m = /^s(\d+)$/.exec(s.id);
    if (!m || Number(m[1]) < 1) fail('Пошкоджені дані збереження: ростер');
    const career = newCareer(Number(m[1]) - 1);
    career.xp = s.kills;
    career.killsCounted = s.kills;
    applyRankBonus(s, rankOf(career.xp));
    out[s.id] = career;
  }
  return out;
}

interface EconSave {
  money: number;
  lastAllowanceDay: number;
  log: EconomyEvent[];
}
// П7.4 (ADR-0032): стан перехоплення в сейві; відсутнє поле (старі сейви) =
// «боєготовий на базі» — версія формату не зростає.
// п19.3 (ADR-0161): сейв v4 пише перелік `fighters`; `fighter` — один перехоплювач сейвів v1–v3
// і v4 до п19.3 (без id і регіону): мігрує в перелік з одного (id 1, регіон north — «Шпилі»).
interface InterceptSave {
  rngState: number;
  fighter?: Omit<Fighter, 'id' | 'region'> & Partial<Pick<Fighter, 'id' | 'region'>>;
  fighters?: Fighter[];
  probeHp: Record<string, number>;
  activeProbeId: string | null;
  round: number;
  log: InterceptEvent[];
}

// П8.2 (ADR-0033): стан кампанії в сейві; відсутні поля (старі сейви) = «триває»
// і пресет «норма» (версія формату не зростає).
interface CampaignSave {
  status: CampaignState['status']; // «поразка» — лише у v3
  preset: DifficultyPreset;
  score: CampaignState['score'];
  victoryDay: number | null;
  // п18.3 (ADR-0153 п. 18): у v3 — обов'язкові; у v1 / v2 їх немає (migrateThreat)
  defeatDay?: number | null;
  threat?: number;
  threatCursor?: number;
  // п18.4 (ADR-0155 п. 9, ADR-0156): необов'язкові й у v3 — без поля 0 / false
  assaults?: number;
  assaultPending?: boolean;
  gateReadyAt?: number;
  // п19.2 (ADR-0159 п. 14): у v4 — обов'язкові; у v1–v3 їх немає (migratedRegions)
  regions?: Regions;
  trustCursor?: number;
}

// Загроза кампанії — у сейвах з v3 (п18.3).
function hasThreat(version: number): boolean {
  return version === SAVE_VERSION || version === SAVE_VERSION_V4 || version === SAVE_VERSION_V3;
}

// Довіра регіонів і перелік перехоплювачів — у сейвах з v4 (п19.2–п19.3).
function hasRegions(version: number): boolean {
  return version === SAVE_VERSION || version === SAVE_VERSION_V4;
}

// п19.2 (ADR-0159 п. 14): довіра сейва v1–v3 — 100 скрізь; курсор — кінець журналу, щоб
// відльоти зі старого журналу не знімали довіру заднім числом.
function migratedRegions(geo: GeoState): Pick<CampaignState, 'regions' | 'trustCursor'> {
  return { regions: createRegions(), trustCursor: geo.log.length };
}

// п19.2: регіони сейва v4 — рівно чотири, довіра ціла 0–100, «вийшов» ⇔ довіра 0.
function validRegions(r: unknown): boolean {
  if (r === null || typeof r !== 'object' || Array.isArray(r)) return false;
  const keys = Object.keys(r);
  if (keys.length !== REGION_IDS.length || !REGION_IDS.every((id) => keys.includes(id))) return false;
  return REGION_IDS.every((id) => {
    const x = (r as Record<string, unknown>)[id] as { trust?: unknown; out?: unknown } | null;
    return (
      x !== null &&
      typeof x === 'object' &&
      Number.isInteger(x.trust) &&
      (x.trust as number) >= 0 &&
      (x.trust as number) <= TRUST_MAX &&
      typeof x.out === 'boolean' &&
      x.out === (x.trust === 0)
    );
  });
}

function copyRegions(r: Regions): Regions {
  const out = createRegions();
  for (const id of REGION_IDS) out[id] = { trust: r[id].trust, out: r[id].out };
  return out;
}

// п18.3 (ADR-0153 п. 18): кампанія v1 / v2 → v3. п18.4 (аудит PR #515): пороги штурму, які
// мігрована загроза вже перейшла, вважаються минулими — старий сейв не отримує штурми заднім числом.
function migratedCampaign(geo: GeoState): Pick<CampaignState, 'defeatDay' | 'threat' | 'threatCursor' | 'assaults'> {
  const threat = migrateThreat(geo);
  const assaults = ASSAULT_THRESHOLDS.filter((t) => threat >= t).length;
  return { defeatDay: null, threat, threatCursor: geo.log.length, ...(assaults > 0 ? { assaults } : {}) };
}

// п18.4: поля штурмів і брами — копія лише заданих (сейв без них — як у п18.3).
function campaignBattleFields(c: Pick<CampaignSave, 'assaults' | 'assaultPending' | 'gateReadyAt'>): Partial<CampaignSave> {
  return {
    ...(c.assaults !== undefined ? { assaults: c.assaults } : {}),
    ...(c.assaultPending !== undefined ? { assaultPending: c.assaultPending } : {}),
    ...(c.gateReadyAt !== undefined ? { gateReadyAt: c.gateReadyAt } : {}),
  };
}

// П9.2: прапорці підказок у сейві; відсутнє поле (старі сейви) = усі false.
interface HintsSave {
  intercept: boolean;
  mission: boolean;
  repair: boolean;
  evac?: boolean; // Т.72: нове поле; у сейвах до Т.72 його немає — злиття з defaultHints() у deserializeParty дає false
}

// П11.2 (ADR-0058): стан науки в сейві; відсутнє поле (сейви до Фази 11) =
// порожня наука (createResearch) — версія формату не зростає (прецедент П7.4).
// П12.6: id — ключі каталогу; у сейвах ≤0.3.0 — старі українські значення
// (мігруються на вході, LEGACY_PROJECT_KEYS).
interface ResearchSave {
  scientists: (Pick<Scientist, 'id' | 'name'> & Partial<Pick<Scientist, 'spec' | 'done'>>)[]; // п22.5: v4 — без spec / done
  hired: number;
  slots: number;
  active: { id: string; invested: number }[];
  completed: string[];
  pool: number;
  lastSalaryDay: number;
  log: ResearchEvent[];
  // п18.2 (ADR-0153 п. 9, ADR-0154): трофеї; відсутнє поле (сейви до п18.2) = 0 кожного типу.
  // Версія формату не зростає — v3 з загрозою і брамою — п18.3.
  trophies?: Partial<TrophyStore>;
}

// П11.3 (ADR-0058): стан «Кузні» і складу в сейві; відсутнє поле (сейви до
// П11.3) = порожній цех (createWorkshop) — версія формату не зростає.
// П12.6: id/store — ключі каталогу; у сейвах ≤0.3.0 — старі українські
// значення (мігруються на вході).
interface WorkshopSave {
  queue: { id: string; ticksLeft: number; region?: RegionId }[]; // п19.3: region — лише 'interceptor'
  store: Record<string, number>;
  equipped?: Record<string, SoldierEquipment>; // П11.3 екіпірування (старіші сейви — порожньо)
  log: WorkshopEvent[];
  brew?: { id: string; ticksLeft: number; count?: number }[]; // п22.5: черга казана (без поля — порожня)
}

export interface SaveData {
  version: number;
  seed: number;
  savedAt: string;
  state: {
    geo: GeoSave;
    roster: RosterSave;
    econ: EconSave;
    intercept?: InterceptSave;
    campaign?: CampaignSave;
    hints?: HintsSave;
    research?: ResearchSave;
    workshop?: WorkshopSave;
    modules?: Partial<BaseModules>; // п22.5: без поля — модулів немає (EARS 7)
  };
}

// Зберігає партію у JSON-рядок. savedAt — мітка часу для панелі слотів;
// передається параметром, щоб ядро лишалося чистим і тестованим.
export function serializeParty(party: Party, savedAt: string = ''): string {
  const rng = party.geo.rng as StatefulRng;
  if (typeof rng.state !== 'number') {
    // ADR-0026: без стану rng відновити траєкторію неможливо — відмовляємо явно.
    throw new Error('geo.rng не має стану: збереження можливе лише з mulberry32 (ADR-0003)');
  }
  const data: SaveData = {
    version: SAVE_VERSION,
    seed: party.seed,
    savedAt,
    state: {
      geo: {
        // >>> 0: стан mulberry32 — знакове int32 після |0; без нормалізації
        // формат «дрифтував» б (save → load → save давав інший рядок).
        // Біти ті самі, тож траєкторія не залежить від подання (ADR-0003).
        rngState: rng.state >>> 0,
        minute: party.geo.minute,
        base: { ...party.geo.base },
        probes: party.geo.probes.map((u) => ({ ...u, pos: { ...u.pos }, target: { ...u.target } })),
        log: party.geo.log.slice(),
        spawnChance: party.geo.spawnChance,
        maxProbes: party.geo.maxProbes,
        nextId: party.geo.nextId,
      },
      roster: {
        soldiers: party.roster.soldiers.map((s) => ({ ...s, pos: { ...s.pos }, weapon: { ...s.weapon } })),
        hired: party.roster.hired,
        hospital: { ...party.roster.hospital },
        careers: copyCareers(party.roster.soldiers, party.roster.careers),
      },
      econ: {
        money: party.econ.money,
        lastAllowanceDay: party.econ.lastAllowanceDay,
        log: party.econ.log.slice(),
      },
      intercept: {
        rngState: interceptRngState(party.intercept),
        fighters: party.intercept.fighters.map((f) => ({ ...f, pos: { ...f.pos } })), // п19.3
        probeHp: { ...party.intercept.probeHp },
        activeProbeId: party.intercept.activeProbeId,
        round: party.intercept.round,
        log: party.intercept.log.slice(),
      },
      campaign: {
        status: party.campaign.status,
        preset: party.campaign.preset,
        score: party.campaign.score ? { ...party.campaign.score } : null,
        victoryDay: party.campaign.victoryDay,
        defeatDay: party.campaign.defeatDay,
        threat: party.campaign.threat,
        threatCursor: party.campaign.threatCursor,
        ...campaignBattleFields(party.campaign), // п18.4: лише задані поля
        regions: copyRegions(party.campaign.regions), // п19.2 (ADR-0159 п. 14)
        trustCursor: party.campaign.trustCursor,
      },
      hints: { ...party.hints },
      research: {
        scientists: party.research.scientists.map((s) => ({ ...s })),
        hired: party.research.hired,
        slots: party.research.slots,
        active: party.research.active.map((p) => ({ ...p })),
        completed: party.research.completed.slice(),
        pool: party.research.pool,
        lastSalaryDay: party.research.lastSalaryDay,
        log: party.research.log.slice(),
        trophies: { ...party.research.trophies },
      },
      workshop: {
        queue: party.workshop.queue.map((o) => ({ ...o })),
        store: { ...party.workshop.store },
        equipped: Object.fromEntries(Object.entries(party.workshop.equipped).map(([id, eq]) => [id, { ...eq }])),
        log: party.workshop.log.slice(),
        brew: party.workshop.brew.map((o) => ({ ...o })),
      },
      modules: { ...party.modules },
    },
  };
  return JSON.stringify(toDisk(data)); // Т.218: ключі `ufo` на диску
}

// Т.218 (рішення власника «probe / «зонд»»): у коді сутність — `probe`, на диску — старі ключі й
// значення `ufo` (сейв v4 байт у байт: старі сейви вантажаться, нові читає й попередня версія гри).
// Ключі з `probe` ↔ `ufo` (регістр зберігається: `probes` ↔ `ufos`, `activeProbeId` ↔ `activeUfoId`),
// рядкові значення ідентифікаторів і типів подій: `probe3` ↔ `ufo3`, `probe_landed` ↔ `ufo_landed`.
const DISK = { probe: 'ufo', Probe: 'Ufo', PROBE: 'UFO' } as const;
const MEM = { ufo: 'probe', Ufo: 'Probe', UFO: 'PROBE' } as const;
function renameKey(k: string, map: Readonly<Record<string, string>>): string {
  return k.replace(/probe|Probe|PROBE|ufo|Ufo|UFO/g, (m) => map[m] ?? m);
}
function renameValue(v: string, from: string, to: string): string {
  return v.startsWith(from) && /^[_0-9]/.test(v.charAt(from.length)) ? to + v.slice(from.length) : v;
}
function translate(v: unknown, map: Readonly<Record<string, string>>, from: string, to: string): unknown {
  if (typeof v === 'string') return renameValue(v, from, to);
  if (Array.isArray(v)) return v.map((x) => translate(x, map, from, to));
  if (v !== null && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[renameKey(k, map)] = translate(x, map, from, to);
    return out;
  }
  return v;
}
export function toDisk(v: unknown): unknown {
  return translate(v, DISK, 'probe', 'ufo');
}
export function fromDisk(v: unknown): unknown {
  return translate(v, MEM, 'ufo', 'probe');
}

function fail(msg: string): never {
  throw new Error(msg);
}

// Розбір JSON-рядка у валідований SaveData. Будь-яка проблема — throw
// з українським текстом; частковий стан не виникає (валідація до конструювання).
function parseSave(json: string): SaveData {
  let data: SaveData;
  try {
    data = fromDisk(JSON.parse(json)) as SaveData; // Т.218: ключі `ufo` з диска — у `probe`
  } catch {
    fail('Пошкоджені дані збереження: некоректний JSON');
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    fail('Пошкоджені дані збереження: очікувався об’єкт');
  }
  if (
    data.version !== SAVE_VERSION &&
    data.version !== SAVE_VERSION_V4 &&
    data.version !== SAVE_VERSION_V3 &&
    data.version !== SAVE_VERSION_V2 &&
    data.version !== SAVE_VERSION_V1
  ) {
    fail('Невідома версія збереження: ' + String(data.version) + ' (очікується ' + SAVE_VERSION + ')');
  }
  if (!Number.isInteger(data.seed)) {
    fail('Пошкоджені дані збереження: seed');
  }
  if (typeof data.savedAt !== 'string') {
    fail('Пошкоджені дані збереження: savedAt');
  }
  const st = data.state;
  if (st === null || typeof st !== 'object') {
    fail('Пошкоджені дані збереження: state');
  }
  if (
    !Number.isInteger(st.geo?.rngState) ||
    !Number.isInteger(st.geo?.minute) ||
    !Number.isInteger(st.geo?.nextId) ||
    typeof st.geo?.spawnChance !== 'number' ||
    !Number.isInteger(st.geo?.maxProbes) ||
    !Array.isArray(st.geo?.probes) ||
    !Array.isArray(st.geo?.log) ||
    typeof st.geo?.base?.x !== 'number' ||
    typeof st.geo?.base?.y !== 'number'
  ) {
    fail('Пошкоджені дані збереження: гео-стан');
  }
  if (
    !Array.isArray(st.roster?.soldiers) ||
    !Number.isInteger(st.roster?.hired) ||
    st.roster?.hospital === null ||
    typeof st.roster?.hospital !== 'object'
  ) {
    fail('Пошкоджені дані збереження: ростер');
  }
  // п16.2 (ADR-0147): з v2 кар'єра — у кожного оперативника ростеру.
  if (data.version !== SAVE_VERSION_V1) {
    const cs = st.roster.careers;
    if (
      cs === null ||
      typeof cs !== 'object' ||
      !st.roster.soldiers.every((s) => s !== null && typeof s === 'object' && validCareer(cs[s.id], s.kills, data.version === SAVE_VERSION))
    ) {
      fail("Пошкоджені дані збереження: кар'єри оперативників");
    }
  }
  if (!Number.isInteger(st.econ?.money) || !Number.isInteger(st.econ?.lastAllowanceDay) || !Array.isArray(st.econ?.log)) {
    fail('Пошкоджені дані збереження: економіка');
  }
  // П7.4 (ADR-0032): поле intercept опційне (старі сейви) — але якщо є, мусить бути цілим
  const icsv = st.intercept;
  if (
    icsv !== undefined &&
    (icsv === null ||
      !Number.isInteger(icsv.rngState) ||
      (icsv.fighters !== undefined
        ? !validFighters(icsv.fighters) ||
          // аудит PR #522: «бій» у переліку ⇔ активний зонд бою
          (hasRegions(data.version) && icsv.fighters.some((f) => f.status === 'бій') !== (icsv.activeProbeId != null))
        : icsv.fighter === null || typeof icsv.fighter !== 'object'))
  ) {
    fail('Пошкоджені дані збереження: перехоплення');
  }
  // П8.2 (ADR-0033): поле campaign опційне (старі сейви) — але якщо є, має бути коректним.
  // П10.3: третій пресет «складний»; старі сейви без поля — «норма» (deserialize нижче).
  const ccsv = st.campaign;
  if (ccsv === null || (ccsv !== undefined && typeof ccsv !== 'object')) fail('Пошкоджені дані збереження: кампанія'); // аудит PR #514
  if (
    ccsv !== undefined &&
    ((ccsv.status !== 'триває' && ccsv.status !== 'перемога' && (ccsv.status !== 'поразка' || !hasThreat(data.version))) ||
      (ccsv.preset !== 'легкий' && ccsv.preset !== 'норма' && ccsv.preset !== 'складний'))
  ) {
    fail('Пошкоджені дані збереження: кампанія');
  }
  // п18.3 (ADR-0153 п. 18): з v3 кампанія обов'язкова, загроза 0–100, курсор — у межах журналу геоцени.
  if (
    hasThreat(data.version) &&
    (ccsv === undefined ||
      !Number.isInteger(ccsv.threat) ||
      (ccsv.threat as number) < 0 ||
      (ccsv.threat as number) > THREAT_MAX ||
      !Number.isInteger(ccsv.threatCursor) ||
      (ccsv.threatCursor as number) < 0 ||
      (ccsv.threatCursor as number) > st.geo.log.length ||
      (ccsv.defeatDay !== null && (!Number.isInteger(ccsv.defeatDay) || (ccsv.defeatDay as number) < 1)) ||
      // узгодженість (аудит PR #514): «поразка» — рівно на 100 з добою поразки; «триває» — нижче 100
      (ccsv.status === 'поразка') !== (ccsv.threat === THREAT_MAX && ccsv.defeatDay !== null) ||
      (ccsv.status !== 'поразка' && ccsv.defeatDay !== null) ||
      (ccsv.status === 'триває' && ccsv.threat === THREAT_MAX))
  ) {
    fail('Пошкоджені дані збереження: загроза кампанії');
  }
  // п18.4 (ADR-0156): штурми і брама — лише у v3, кожне поле необов'язкове.
  if (
    ccsv !== undefined &&
    ((ccsv.assaults !== undefined &&
      (!Number.isInteger(ccsv.assaults) || ccsv.assaults < 0 || ccsv.assaults > ASSAULT_THRESHOLDS.length)) ||
      (ccsv.assaultPending !== undefined && typeof ccsv.assaultPending !== 'boolean') ||
      (ccsv.assaultPending === true && (ccsv.assaults ?? 0) === 0) ||
      (ccsv.gateReadyAt !== undefined && (!Number.isInteger(ccsv.gateReadyAt) || ccsv.gateReadyAt < 0)) ||
      (!hasThreat(data.version) && (ccsv.assaults !== undefined || ccsv.assaultPending !== undefined || ccsv.gateReadyAt !== undefined)))
  ) {
    fail('Пошкоджені дані збереження: штурми і брама');
  }
  // п19.2 (ADR-0159 п. 14): у v4 — регіони і курсор довіри в межах журналу; у v1–v3 поля
  // не читаються (міграція — довіра 100), як поля загрози у v1 / v2 (прецедент п18.3).
  if (
    hasRegions(data.version) &&
    ccsv !== undefined &&
    (!validRegions(ccsv.regions) ||
      !Number.isInteger(ccsv.trustCursor) ||
      (ccsv.trustCursor as number) < 0 ||
      (ccsv.trustCursor as number) > st.geo.log.length)
  ) {
    fail('Пошкоджені дані збереження: райони');
  }
  // П9.2: поле hints опційне (старі сейви) — але якщо є, має бути об'єктом.
  if (data.state.hints !== undefined && (typeof data.state.hints !== 'object' || data.state.hints === null)) {
    fail('Пошкоджені дані збереження: підказки');
  }
  // П11.2: поле research опційне (сейви до Фази 11) — але якщо є, має бути коректним.
  const rsv = st.research;
  if (
    rsv !== undefined &&
    (!Array.isArray(rsv.scientists) ||
      !Number.isInteger(rsv.hired) ||
      !Number.isInteger(rsv.slots) ||
      !Array.isArray(rsv.active) ||
      !Array.isArray(rsv.completed) ||
      !Number.isInteger(rsv.pool) ||
      !Number.isInteger(rsv.lastSalaryDay) ||
      !Array.isArray(rsv.log) ||
      (rsv.trophies !== undefined && !validTrophies(rsv.trophies)) ||
      !rsv.scientists.every(validScientist))
  ) {
    fail('Пошкоджені дані збереження: наука');
  }
  // п22.5: модулі бази — необов'язкові; якщо є — рівні 0..найвищий
  if (st.modules !== undefined && !validModules(st.modules)) fail('Пошкоджені дані збереження: модулі бази');
  // аудит PR #551: «Стенд» — слот понад «Розширення лабораторії»: слотів не менше 3 + стенд
  if (st.modules?.stand && (rsv === undefined || rsv.slots < BASE_LAB_SLOTS + 1 + st.modules.stand))
    fail('Пошкоджені дані збереження: модулі бази');
  // П11.3: поле workshop опційне (сейви до П11.3) — але якщо є, має бути коректним.
  const wsv = st.workshop;
  if (
    wsv !== undefined &&
    (!Array.isArray(wsv.queue) ||
      wsv.store === null ||
      typeof wsv.store !== 'object' ||
      !Array.isArray(wsv.log) ||
      (wsv.equipped !== undefined && (typeof wsv.equipped !== 'object' || wsv.equipped === null)) ||
      (wsv.brew !== undefined && !validBrew(wsv.brew)) ||
      !validInterceptorOrders(wsv.queue, savedFighters(icsv, data.version), data.version))
  ) {
    fail('Пошкоджені дані збереження: Кузня');
  }
  return data;
}

// п19.3 (ADR-0161): перелік перехоплювачів — 1..MAX_FIGHTERS, id цілі за зростанням, відомий
// регіон і стан, HP 0..макс., у бою — не більше одного.
const FIGHTER_STATUSES: readonly string[] = ['на базі', 'погоня', 'бій', 'ремонт'];
function validFighters(list: unknown): boolean {
  if (!Array.isArray(list) || list.length < 1 || list.length > MAX_FIGHTERS) return false;
  let prev = 0;
  for (const f of list as Fighter[]) {
    if (f === null || typeof f !== 'object' || !Number.isInteger(f.id) || f.id <= prev || f.id > MAX_FIGHTERS) return false;
    if (!(REGION_IDS as readonly string[]).includes(f.region) || !FIGHTER_STATUSES.includes(f.status)) return false;
    if (!Number.isInteger(f.hp) || f.hp < 0 || f.hp > FIGHTER_MAX_HP || f.pos === null || typeof f.pos !== 'object') return false;
    // аудит Vibe PR #522: клітинка — цілі в межах світу; лічильник ремонту — лише в ремонті, 1..16
    if (!Number.isInteger(f.pos.x) || !Number.isInteger(f.pos.y) || f.pos.x < 0 || f.pos.y < 0 || f.pos.x >= WORLD_W || f.pos.y >= WORLD_H)
      return false;
    const left = f.repairTicksLeft;
    if (f.status === 'ремонт' ? !Number.isInteger(left) || left! < 1 || left! > FIGHTER_REPAIR_TICKS : left !== undefined) return false;
    prev = f.id;
  }
  // аудит PR #522: на один зонд — один перехоплювач
  const chased = (list as Fighter[]).filter((f) => f.targetId != null).map((f) => f.targetId);
  return (list as Fighter[]).filter((f) => f.status === 'бій').length <= 1 && new Set(chased).size === chased.length;
}

// п19.3: замовлення перехоплювача в черзі «Кузні» — з відомим регіоном (лише v4), а перехоплювачів
// разом із замовленими — не більше MAX_FIGHTERS.
function validInterceptorOrders(queue: { id: string; region?: unknown }[], fighters: number, version: number): boolean {
  const orders = queue.filter((o) => o?.id === 'interceptor');
  if (orders.length > 0 && !hasRegions(version)) return false;
  return orders.every((o) => (REGION_IDS as readonly string[]).includes(o.region as string)) && fighters + orders.length <= MAX_FIGHTERS;
}
// (поле fighters у v1–v3 не читається — для ліміту там рахується один перехоплювач)
function savedFighters(icsv: InterceptSave | undefined, version: number): number {
  return hasRegions(version) && icsv?.fighters ? icsv.fighters.length : 1;
}

// п18.2: трофеї в сейві — об'єкт лише з відомими типами і цілими ≥ 0.
// п22.5 (ADR-0187): техномант — id і ім'я; spec і done необов'язкові (v4), якщо є — відомі.
function validScientist(s: unknown): boolean {
  if (s === null || typeof s !== 'object') return false;
  const r = s as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    typeof r.name === 'string' &&
    (r.spec === undefined || SCIENTIST_SPECS.includes(r.spec as never)) &&
    (r.done === undefined || (Number.isInteger(r.done) && (r.done as number) >= 0))
  );
}

function validModules(m: unknown): boolean {
  if (m === null || typeof m !== 'object' || Array.isArray(m)) return false;
  const r = m as Record<string, unknown>;
  return (
    Object.keys(r).every((k) => MODULE_IDS.includes(k as never)) &&
    MODULE_IDS.every(
      (k) => r[k] === undefined || (Number.isInteger(r[k]) && (r[k] as number) >= 0 && (r[k] as number) <= moduleMaxLevel(k))
    )
  );
}

function validBrew(q: unknown): boolean {
  return (
    Array.isArray(q) &&
    q.every(
      (o) =>
        o !== null &&
        typeof o === 'object' &&
        (o.id === 'stim' || o.id === 'shield') &&
        Number.isInteger(o.ticksLeft) &&
        o.ticksLeft > 0 &&
        (o.count === undefined || o.count === 2)
    )
  );
}

// п22.6 (ADR-0188): і необов'язковий `champion` — трофей чемпіона.
function validTrophies(t: unknown): boolean {
  if (t === null || typeof t !== 'object' || Array.isArray(t)) return false;
  // аудит PR #513: не `in` — він бачить ключі прототипу («constructor», «toString»)
  return Object.entries(t).every(
    ([k, v]) => ((ENEMY_ORDER as readonly string[]).includes(k) || k === 'champion') && Number.isInteger(v) && (v as number) >= 0
  );
}

// Відновлює партію з JSON-рядка. rng відновлюється з позиції потоку
// (mulberry32(rngState) продовжує з того самого місця), тож подальші
// тики/дії дають лог байт-у-байт оригіналу (ADR-0026, критерій П5.2).
export function deserializeParty(json: string): Party {
  const data = parseSave(json);
  const g = data.state.geo;
  // П11.2: блок науки зі сейву (може бути відсутнім — сейви до Фази 11)
  const rsv = data.state.research;
  // П11.3: блок цеху зі сейву (може бути відсутнім — сейви до П11.3)
  const wsv = data.state.workshop;
  // mulberry32(S) робить перший виклик зі стану S + INC — ідентично
  // наступному виклику оригіналу, що зупинився на S.
  const geo = createGeoGame({ seed: data.seed, rng: mulberry32(g.rngState) });
  geo.minute = g.minute;
  geo.base = { x: g.base.x, y: g.base.y };
  geo.probes = g.probes.map((u) => ({ ...u, pos: { ...u.pos }, target: { ...u.target } }));
  geo.log = g.log.slice();
  geo.spawnChance = g.spawnChance;
  geo.maxProbes = g.maxProbes;
  geo.nextId = g.nextId;
  // П7.4 (ADR-0032): відсутнє поле intercept (старі сейви) = боєготовий на базі;
  // rng відновлюється з позиції потоку mulberry32 — бій продовжується байт-у-байт.
  const sv = data.state.intercept;
  const ic = sv !== undefined ? createIntercept({ rng: mulberry32(sv.rngState) }) : createIntercept(data.seed);
  if (sv !== undefined) {
    // п19.3 (ADR-0161): v4 — перелік; один перехоплювач старих сейвів — id 1, регіон north — «Шпилі» (вузол)
    // (у v1–v3 переліку не буває: поле не читається, крім першого запису за відсутності fighter — урок Т.205)
    if (sv.fighters && hasRegions(data.version)) {
      ic.fighters = sv.fighters.map((f) => ({ ...f, pos: { ...f.pos } }));
    } else {
      const one = sv.fighter ?? sv.fighters![0];
      ic.fighters = [{ ...one, id: 1, region: 'north', pos: { ...one.pos } }];
    }
    ic.probeHp = { ...sv.probeHp };
    ic.activeProbeId = sv.activeProbeId;
    ic.round = sv.round;
    ic.log = sv.log.slice();
  }
  // П8.2 (ADR-0033): відсутні поля (старі сейви) = «триває» + пресет «норма» (DEFAULT_PRESET).
  const ccsv = data.state.campaign;
  const cc = ccsv ?? { status: 'триває' as const, preset: DEFAULT_PRESET, score: null, victoryDay: null };
  const soldiers = data.state.roster.soldiers.map((s) => ({ ...s, pos: { ...s.pos } }));
  // п20.6 (ADR-0170, аудит PR #533): профіль зброї «Кузні» — з каталогу за видачею, а не з сейва: зміна чисел
  // зброї (тут — «Град» ×0,6) діє і на вже видану в старих сейвах. «Гарт» — як у сейві (RIFLE не змінювався).
  const weaponOfSv = data.state.workshop?.equipped ?? {};
  for (const s of soldiers) {
    const w = weaponOfSv[s.id]?.weapon;
    if (w !== undefined && isForgeWeapon(w)) s.weapon = WEAPONS[w];
  }
  // п16.2 (ADR-0147 п. 15): v1 — міграція кар'єр, v2 — копія (parseSave перевірив).
  const careersSv = data.version !== SAVE_VERSION_V1 ? data.state.roster.careers : undefined;
  return {
    seed: data.seed,
    geo,
    roster: {
      soldiers,
      hired: data.state.roster.hired,
      hospital: { ...data.state.roster.hospital },
      careers: careersSv !== undefined ? copyCareers(soldiers, careersSv) : migrateCareers(soldiers),
    },
    econ: {
      money: data.state.econ.money,
      lastAllowanceDay: data.state.econ.lastAllowanceDay,
      log: data.state.econ.log.slice(),
    },
    intercept: ic,
    // П8.2 (ADR-0033): відсутнє поле campaign (старі сейви) = «триває» і пресет «норма».
    campaign: {
      status: cc.status,
      preset: cc.preset,
      score: cc.score ? { ...cc.score } : null,
      victoryDay: cc.victoryDay,
      // п18.3 (ADR-0153 п. 18): v3–v4 — копія; v1 / v2 — загроза з доби й виграних місій
      ...(hasThreat(data.version)
        ? {
            defeatDay: cc.defeatDay ?? null,
            threat: cc.threat as number,
            threatCursor: cc.threatCursor as number,
            ...campaignBattleFields(cc),
          }
        : migratedCampaign(geo)),
      // п19.2 (ADR-0159 п. 14): v4 — копія; v1–v3 — довіра 100, курсор — кінець журналу
      ...(hasRegions(data.version)
        ? { regions: copyRegions(cc.regions as Regions), trustCursor: cc.trustCursor as number }
        : migratedRegions(geo)),
    },
    // П9.2: відсутнє поле hints (старі сейви) = усі підказки ще не показано.
    hints: { ...defaultHints(), ...(data.state.hints ?? {}) },
    // П11.2 (ADR-0058): відсутнє поле research (сейви до Фази 11) = порожня
    // наука: без техномантів, 2 слоти, порожні протоколи і пул (критерій П11.2).
    // П12.6: ключі протоколів мігруються зі старих українських значень
    // (сейви ≤0.3.0) на англійські — стан у пам'яті однаковий з новою партією.
    research:
      rsv !== undefined
        ? {
            // п22.5 (EARS 7): v4 — «Дослідник» рівня 1 (done 0)
            scientists: rsv.scientists.map((s) => ({ id: s.id, name: s.name, spec: s.spec ?? 'researcher', done: s.done ?? 0 })),
            hired: rsv.hired,
            slots: rsv.slots,
            active: rsv.active.map((p) => ({ id: migrateProjectKey(p.id), invested: p.invested })),
            completed: rsv.completed.map(migrateProjectKey),
            pool: rsv.pool,
            lastSalaryDay: rsv.lastSalaryDay,
            log: rsv.log.map((e) =>
              e.type === 'project_started' || e.type === 'project_completed' ? { ...e, id: migrateProjectKey(e.id as string) } : e
            ),
            trophies: { ...emptyTrophies(), ...(rsv.trophies ?? {}) },
          }
        : createResearch(),
    // П11.3 (ADR-0058): відсутнє поле workshop (сейви до П11.3) = порожня
    // «Кузня»: без замовлень, порожній склад (критерій сейв-сумісності П11.3).
    // П12.6: ключі предметів мігруються зі старих українських значень.
    workshop:
      wsv !== undefined
        ? {
            queue: wsv.queue.map((o) =>
              o.id === 'interceptor'
                ? { id: 'interceptor' as const, ticksLeft: o.ticksLeft, region: o.region }
                : { id: migrateItemKey(o.id), ticksLeft: o.ticksLeft }
            ),
            store: {
              ...emptyStore(),
              ...Object.fromEntries(Object.entries(wsv.store).map(([k, v]) => [migrateItemKey(k), v])),
            },
            equipped: Object.fromEntries(Object.entries(wsv.equipped ?? {}).map(([id, eq]) => [id, { ...eq }])),
            log: wsv.log.map((e) => {
              if (e.type === 'order' || e.type === 'produced') return { ...e, id: migrateItemKey(e.id as string) };
              // equip/unequip — предмети оперативників (gun-module сюди не
              // потрапляє за конструкцією ядра — guard у equipItem/unequipItem)
              if (e.type === 'equip' || e.type === 'unequip') return { ...e, id: migrateItemKey(e.id as string) as SoldierItemId };
              return e;
            }),
            brew: (wsv.brew ?? []).map((o) => ({ ...o, id: o.id as ItemId })),
          }
        : createWorkshop(),
    modules: { ...createModules(), ...(data.state.modules ?? {}) }, // п22.5: без поля — модулів немає
  };
}

// Абстракція слоту (ADR-0026): ядро бачить лише рядок-значення за номером;
// localStorage підключається у main.ts, тести ядра — на моках сховища.
export interface SlotStore {
  read(slot: number): string | null;
  write(slot: number, data: string): void;
  remove(slot: number): void;
}

function assertSlot(slot: number): void {
  if (!Number.isInteger(slot) || slot < 1 || slot > SAVE_SLOTS) {
    throw new Error('Номер слоту має бути цілим від 1 до ' + SAVE_SLOTS);
  }
}

export function saveToSlot(store: SlotStore, slot: number, party: Party, savedAt: string = ''): void {
  assertSlot(slot);
  store.write(slot, serializeParty(party, savedAt));
}

export function loadFromSlot(store: SlotStore, slot: number): Party {
  assertSlot(slot);
  const json = store.read(slot);
  if (json === null) {
    throw new Error('Слот ' + slot + ' порожній');
  }
  return deserializeParty(json);
}

export function slotIsEmpty(store: SlotStore, slot: number): boolean {
  assertSlot(slot);
  return store.read(slot) === null;
}

export function eraseSlot(store: SlotStore, slot: number): void {
  assertSlot(slot);
  store.remove(slot);
}

// Метадані слоту (ADR-0026, п.4): дата/сід/тик/баланс/живі солдати —
// похідні від збереженого стану, окремо не дублюються.
export interface SlotMeta {
  savedAt: string;
  seed: number;
  day: number;
  minute: number;
  money: number;
  aliveSoldiers: number;
}

export function slotMeta(json: string): SlotMeta {
  const data = parseSave(json);
  return {
    savedAt: data.savedAt,
    seed: data.seed,
    // доба = floor(хвилини / 1440) + 1 — та сама формула, що geoDay (geo.ts)
    day: Math.floor(data.state.geo.minute / 1440) + 1,
    minute: data.state.geo.minute,
    money: data.state.econ.money,
    aliveSoldiers: data.state.roster.soldiers.length,
  };
}
