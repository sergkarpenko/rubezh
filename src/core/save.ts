// src/core/save.ts
// Ітерація П5.2: збереження/відновлення партії — ядро без DOM (ADR-0026).
// ADR-0002: чисте ядро; конкретне сховище (localStorage у main.ts) підключається
// через абстракцію слоту «рядок-значення» (SlotStore).
// ADR-0003: geo.rng не викликається під час збереження — траєкторія не зсувається;
// позиція потоку зберігається як число (rng.state, mulberry32), тому відновлена
// партія продовжує траєкторію оригіналу байт-у-байт.
// ADR-0026: активна місія не зберігається (кнопки активні лише на геосцені);
// метадані слоту — похідні від збереженого стану.
// Формат: { version: 1, seed, savedAt, state }. Невідома версія або пошкоджений
// JSON — throw з українським текстом, без часткового стану. Зміни схеми —
// новою версією + міграцією на вході.

import { mulberry32, type StatefulRng, type Unit, type Vec2 } from './combat';
import { createGeoGame, type GeoEvent, type GeoState, type Ufo } from './geo';
import { createRoster, type Roster } from './squad';
import { createEconomy, type EconomyEvent, type EconomyState } from './economy';
import { createIntercept, interceptRngState, type Fighter, type InterceptEvent, type InterceptState } from './intercept';
import { createCampaign, DEFAULT_PRESET, type CampaignState, type DifficultyPreset } from './campaign';
import { createResearch, type ProjectId, type ResearchEvent, type ResearchState, type Scientist } from './research';
import {
  createWorkshop,
  emptyStore,
  type ItemId,
  type SoldierEquipment,
  type SoldierItemId,
  type WorkshopEvent,
  type WorkshopState,
} from './workshop';

export const SAVE_VERSION = 1;
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
}

export type HintKey = keyof HintFlags;

export function defaultHints(): HintFlags {
  return { intercept: false, mission: false, repair: false };
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
  };
}

// Серіалізований стан: усе, що описує подальшу траєкторію. rng.state — позиція
// потоку mulberry32 (не сам файл-функція: функції не серіалізуються).
interface GeoSave {
  rngState: number;
  minute: number;
  base: Vec2;
  ufos: Ufo[];
  log: GeoEvent[];
  spawnChance: number;
  maxUfos: number;
  nextId: number;
}

interface RosterSave {
  soldiers: Unit[];
  hired: number;
  hospital: Record<string, number>;
}

interface EconSave {
  money: number;
  lastAllowanceDay: number;
  log: EconomyEvent[];
}
// П7.4 (ADR-0032): стан перехоплення в сейві; відсутнє поле (старі сейви) =
// «боєготовий на базі» — версія формату не зростає.
interface InterceptSave {
  rngState: number;
  fighter: Fighter;
  ufoHp: Record<string, number>;
  activeUfoId: string | null;
  round: number;
  log: InterceptEvent[];
}

// П8.2 (ADR-0033): стан кампанії в сейві; відсутні поля (старі сейви) = «триває»
// і пресет «норма» (версія формату не зростає).
interface CampaignSave {
  status: 'триває' | 'перемога';
  preset: DifficultyPreset;
  score: CampaignState['score'];
  victoryDay: number | null;
}

// П9.2: прапорці підказок у сейві; відсутнє поле (старі сейви) = усі false.
interface HintsSave {
  intercept: boolean;
  mission: boolean;
  repair: boolean;
}

// П11.2 (ADR-0058): стан науки в сейві; відсутнє поле (сейви до Фази 11) =
// порожня наука (createResearch) — версія формату не зростає (прецедент П7.4).
// П12.6: id — ключі каталогу; у сейвах ≤0.3.0 — старі українські значення
// (мігруються на вході, LEGACY_PROJECT_KEYS).
interface ResearchSave {
  scientists: Scientist[];
  hired: number;
  slots: number;
  active: { id: string; invested: number }[];
  completed: string[];
  pool: number;
  lastSalaryDay: number;
  log: ResearchEvent[];
}

// П11.3 (ADR-0058): стан «Кузні» і складу в сейві; відсутнє поле (сейви до
// П11.3) = порожній цех (createWorkshop) — версія формату не зростає.
// П12.6: id/store — ключі каталогу; у сейвах ≤0.3.0 — старі українські
// значення (мігруються на вході).
interface WorkshopSave {
  queue: { id: string; ticksLeft: number }[];
  store: Record<string, number>;
  equipped?: Record<string, SoldierEquipment>; // П11.3 екіпірування (старіші сейви — порожньо)
  log: WorkshopEvent[];
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
        ufos: party.geo.ufos.map((u) => ({ ...u, pos: { ...u.pos }, target: { ...u.target } })),
        log: party.geo.log.slice(),
        spawnChance: party.geo.spawnChance,
        maxUfos: party.geo.maxUfos,
        nextId: party.geo.nextId,
      },
      roster: {
        soldiers: party.roster.soldiers.map((s) => ({ ...s, pos: { ...s.pos }, weapon: { ...s.weapon } })),
        hired: party.roster.hired,
        hospital: { ...party.roster.hospital },
      },
      econ: {
        money: party.econ.money,
        lastAllowanceDay: party.econ.lastAllowanceDay,
        log: party.econ.log.slice(),
      },
      intercept: {
        rngState: interceptRngState(party.intercept),
        fighter: { ...party.intercept.fighter, pos: { ...party.intercept.fighter.pos } },
        ufoHp: { ...party.intercept.ufoHp },
        activeUfoId: party.intercept.activeUfoId,
        round: party.intercept.round,
        log: party.intercept.log.slice(),
      },
      campaign: {
        status: party.campaign.status,
        preset: party.campaign.preset,
        score: party.campaign.score ? { ...party.campaign.score } : null,
        victoryDay: party.campaign.victoryDay,
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
      },
      workshop: {
        queue: party.workshop.queue.map((o) => ({ ...o })),
        store: { ...party.workshop.store },
        equipped: Object.fromEntries(Object.entries(party.workshop.equipped).map(([id, eq]) => [id, { ...eq }])),
        log: party.workshop.log.slice(),
      },
    },
  };
  return JSON.stringify(data);
}

function fail(msg: string): never {
  throw new Error(msg);
}

// Розбір JSON-рядка у валідований SaveData. Будь-яка проблема — throw
// з українським текстом; частковий стан не виникає (валідація до конструювання).
function parseSave(json: string): SaveData {
  let data: SaveData;
  try {
    data = JSON.parse(json) as SaveData;
  } catch {
    fail('Пошкоджені дані збереження: некоректний JSON');
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    fail('Пошкоджені дані збереження: очікувався об’єкт');
  }
  if (data.version !== SAVE_VERSION) {
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
    !Number.isInteger(st.geo?.maxUfos) ||
    !Array.isArray(st.geo?.ufos) ||
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
  if (!Number.isInteger(st.econ?.money) || !Number.isInteger(st.econ?.lastAllowanceDay) || !Array.isArray(st.econ?.log)) {
    fail('Пошкоджені дані збереження: економіка');
  }
  // П7.4 (ADR-0032): поле intercept опційне (старі сейви) — але якщо є, мусить бути цілим
  const icsv = st.intercept;
  if (icsv !== undefined && (!Number.isInteger(icsv.rngState) || typeof icsv.fighter !== 'object')) {
    fail('Пошкоджені дані збереження: перехоплення');
  }
  // П8.2 (ADR-0033): поле campaign опційне (старі сейви) — але якщо є, має бути коректним.
  // П10.3: третій пресет «складний»; старі сейви без поля — «норма» (deserialize нижче).
  const ccsv = st.campaign;
  if (
    ccsv !== undefined &&
    ((ccsv.status !== 'триває' && ccsv.status !== 'перемога') ||
      (ccsv.preset !== 'легкий' && ccsv.preset !== 'норма' && ccsv.preset !== 'складний'))
  ) {
    fail('Пошкоджені дані збереження: кампанія');
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
      !Array.isArray(rsv.log))
  ) {
    fail('Пошкоджені дані збереження: наука');
  }
  // П11.3: поле workshop опційне (сейви до П11.3) — але якщо є, має бути коректним.
  const wsv = st.workshop;
  if (
    wsv !== undefined &&
    (!Array.isArray(wsv.queue) ||
      wsv.store === null ||
      typeof wsv.store !== 'object' ||
      !Array.isArray(wsv.log) ||
      (wsv.equipped !== undefined && (typeof wsv.equipped !== 'object' || wsv.equipped === null)))
  ) {
    fail('Пошкоджені дані збереження: Кузня');
  }
  return data;
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
  geo.ufos = g.ufos.map((u) => ({ ...u, pos: { ...u.pos }, target: { ...u.target } }));
  geo.log = g.log.slice();
  geo.spawnChance = g.spawnChance;
  geo.maxUfos = g.maxUfos;
  geo.nextId = g.nextId;
  // П7.4 (ADR-0032): відсутнє поле intercept (старі сейви) = боєготовий на базі;
  // rng відновлюється з позиції потоку mulberry32 — бій продовжується байт-у-байт.
  const sv = data.state.intercept;
  const ic = sv !== undefined ? createIntercept({ rng: mulberry32(sv.rngState) }) : createIntercept(data.seed);
  if (sv !== undefined) {
    ic.fighter = { ...sv.fighter, pos: { ...sv.fighter.pos } };
    ic.ufoHp = { ...sv.ufoHp };
    ic.activeUfoId = sv.activeUfoId;
    ic.round = sv.round;
    ic.log = sv.log.slice();
  }
  // П8.2 (ADR-0033): відсутні поля (старі сейви) = «триває» + пресет «норма» (DEFAULT_PRESET).
  const ccsv = data.state.campaign;
  const cc = ccsv ?? { status: 'триває' as const, preset: DEFAULT_PRESET, score: null, victoryDay: null };
  return {
    seed: data.seed,
    geo,
    roster: {
      soldiers: data.state.roster.soldiers.map((s) => ({ ...s, pos: { ...s.pos } })),
      hired: data.state.roster.hired,
      hospital: { ...data.state.roster.hospital },
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
            scientists: rsv.scientists.map((s) => ({ ...s })),
            hired: rsv.hired,
            slots: rsv.slots,
            active: rsv.active.map((p) => ({ id: migrateProjectKey(p.id), invested: p.invested })),
            completed: rsv.completed.map(migrateProjectKey),
            pool: rsv.pool,
            lastSalaryDay: rsv.lastSalaryDay,
            log: rsv.log.map((e) =>
              e.type === 'project_started' || e.type === 'project_completed' ? { ...e, id: migrateProjectKey(e.id as string) } : e
            ),
          }
        : createResearch(),
    // П11.3 (ADR-0058): відсутнє поле workshop (сейви до П11.3) = порожня
    // «Кузня»: без замовлень, порожній склад (критерій сейв-сумісності П11.3).
    // П12.6: ключі предметів мігруються зі старих українських значень.
    workshop:
      wsv !== undefined
        ? {
            queue: wsv.queue.map((o) => ({ id: migrateItemKey(o.id), ticksLeft: o.ticksLeft })),
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
          }
        : createWorkshop(),
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
