// src/core/research.ts
// П11.2 (Фаза 11): ядро «Вчені та дослідження» (ADR-0058).
// ADR-0002: чисте ядро без DOM/Canvas. ADR-0003: жодного RNG — імена вчених
// з циклічного пулу за лічильником hired (прецедент squad.ts, ADR-0021).
// Патерн ізоляції шарів (як economy.ts): geo.ts не знає про науку, research.ts
// лише читає час геосцени (geoDay) і не витягує geo.rng — траєкторія геосцени
// з наукою і без неї байт-у-байт однакова.
// Вчені — окремий персонал (окремий штат, не в ростері солдатів): найм за гроші,
// зарплата на межі доби в одному контурі з дотацією (ADR-0021; researchTick
// викликає шар застосунку після economyTick). Продукт — 1 наукова точка за добу
// за вченого; пул спільний; розподіл між активними проєктами — порівну, остача
// першим за порядком запуску (round-robin по 1 точці — реалізація того самого
// розподілу з природним капом на потребу проєкту). Числа балансу — КАНДИДАТИ,
// тунінг probe-симуляціями П11.8 (патерн П10.4), затверджує власник.

import { geoDay, type GeoState } from './geo';
import { spend, type EconomyState } from './economy';
import { type DifficultyPreset, DEFAULT_PRESET, sciencePrice } from './campaign';
import type { GameState } from './combat';
import { ENEMY_KINDS, ENEMY_ORDER, enemyKind, type EnemyKind } from './enemies';
import { WEAPONS, type ForgeWeaponId } from './weapons';
import type { ModuleId } from './base';

export const HIRE_SCIENTIST_PRICE = 100; // кандидат (П11.8); прецедент найму солдата, ADR-0021
export const SCIENTIST_SALARY = 10; // зарплата за добу за вченого; Т.28 (ADR-0091): 20 → 10
export const BASE_LAB_SLOTS = 2; // стартові слоти лабораторії (ADR-0058)
export const MAX_LAB_SLOTS = 3; // після проєкту «Розширення лабораторії» (п22.5: +1 модулем «Стенд», base.ts)

// Ідентифікатори проєктів — стабільні англійські ключі (П12.6, ADR-0064:
// ключі — не відображувані назви; сейви ≤0.3.0 мігруються при завантаженні,
// save.ts). Відображувані назви — поле name каталогу.
// п20.4 (ADR-0168): протоколи зброї — ключі зброї «Кузні» (ForgeWeaponId, weapons.ts).
export type ProjectId =
  'armor' | 'optics' | 'medkit' | 'lab-extension' | 'grenade' | 'gun-module' | KeyProjectId | ForgeWeaponId | SquadProjectId;

// п22.4 (ADR-0186): протоколи розміру загону «Тактична мережа I / II» (ADR-0182 п. 2, 10).
export type SquadProjectId = 'tac-net-1' | 'tac-net-2';

// п18.2 (ADR-0153 п. 1, 10; ADR-0154): ключові протоколи ланцюжка до фінальної місії.
export type KeyProjectId = 'rift-anatomy' | 'gate-bearing' | 'gate-key';

// п18.2 (ADR-0153 п. 2, 9): трофеї партії — лічильник за типом убитого ворога.
// п22.6 (ADR-0188): `champion` — рідкісний трофей убитого чемпіона; необов'язкове поле —
// партія без чемпіонів (і сейв) байт-у-байт як до п22.6.
export type TrophyStore = Record<EnemyKind, number> & { champion?: number };
export type TrophyCost = Partial<Record<EnemyKind | 'champion', number>>;

export function emptyTrophies(): TrophyStore {
  return { demon: 0, hound: 0, golem: 0, eye: 0 };
}

export interface ProjectDef {
  id: ProjectId;
  name: string; // відображувана назва протоколу (ADR-0064 — мапа перейменувань)
  cost: number; // кредити за старт (кандидат, П11.8)
  points: number; // потік до завершення (кандидат, П11.8)
  prerequisite?: ProjectId; // передумова — завершений протокол
  trophies?: TrophyCost; // п18.2 (ADR-0153 п. 10): трофеї, що списуються на старті разом із кредитами
}

// Стартовий каталог (ADR-0058): Т1 без передумов, Т2 — за передумовами.
// П11.8 (тунінг за симуляціями, docs/reports/p11.8-tuning.md): наукові точки
// ×0.75 (вердикт власника 2026-10-18, комбо-B probe-гріду) — за кампанію
// 30 діб бот-гравець із трьома вченими встигає 1.7–2.4 проєкти замість
// 1.0–1.4; «легка броня» стає досяжною (до тунінгу — 0% партій).
// П12.6 (ADR-0064): ключі англійські, назви — за мапою перейменувань.
// Т.19 (ADR-0088, docs/reports/t19-tuning.md): ціни протоколів ×0,8
// (120/90/100/80/140/160 → 96/72/80/64/112/128) — вердикт власника 2026-11-11
// за probe на 480 сідах; точки й передумови без змін.
// Т.28 (ADR-0091, docs/reports/t28-science-balance.md): точки протоколу броні
// 27 → 14 — вердикт власника 2026-11-14 за probe Т.27.
export const PROJECTS: ProjectDef[] = [
  { id: 'armor', name: 'Композитна броня', cost: 96, points: 14 },
  { id: 'optics', name: 'Кібернетичне око', cost: 72, points: 23 },
  { id: 'medkit', name: 'Регенеративний гель', cost: 80, points: 24 },
  { id: 'lab-extension', name: 'Розширення лабораторії', cost: 64, points: 33 },
  { id: 'grenade', name: 'Імпульсна граната', cost: 112, points: 30, prerequisite: 'medkit' },
  { id: 'gun-module', name: 'Гарматний модуль перехоплювача', cost: 128, points: 36, prerequisite: 'optics' },
];

// п18.2 (ADR-0153 п. 10; числа — перемір п18.6 без змін, ADR-0158): три ключові протоколи.
// Окремий масив: панель «Дослідження» ітерує PROJECTS, а ключові протоколи
// до UI п18.5 у панелях не показуються (рішення власника «А. Сховати до п18.5», ADR-0154).
export const KEY_PROJECTS: ProjectDef[] = [
  { id: 'rift-anatomy', name: 'Анатомія Розриву', cost: 120, points: 20, trophies: { demon: 6, hound: 3 } },
  { id: 'gate-bearing', name: 'Пеленг брами', cost: 160, points: 30, prerequisite: 'rift-anatomy', trophies: { golem: 2, eye: 2 } },
  {
    id: 'gate-key',
    name: 'Ключ брами',
    cost: 200,
    points: 40,
    prerequisite: 'gate-bearing',
    trophies: { demon: 4, hound: 2, golem: 1, eye: 2 },
  },
];

// п20.4 (ADR-0165 п. 6, 12; ADR-0168): свій протокол на кожну зброю (рішення власника п20.1
// «А. Свій протокол на кожну + виріб у «Кузні»»); назва — назва зброї; числа — кандидати, probe п20.6.
// Окремий масив, як KEY_PROJECTS: PROJECTS і його порядок лишаються (бот, скрипти, тести).
export const WEAPON_PROJECTS: ProjectDef[] = [
  { id: 'shotgun', name: WEAPONS.shotgun.name, cost: 80, points: 20 },
  { id: 'sniper', name: WEAPONS.sniper.name, cost: 96, points: 24, prerequisite: 'optics' },
  { id: 'mg', name: WEAPONS.mg.name, cost: 110, points: 28, prerequisite: 'armor' },
];

export const LAB_EXTENSION_PROJECT: ProjectId = 'lab-extension';

// п18.2 (ADR-0153 п. 12): радіус радара бази — 4, після «Пеленгу брами» — 6.
export const RADAR_RANGE_BASE = 4; // те саме, що RADAR_RANGE у geo.ts
export const RADAR_RANGE_WIDE = 6;
export function radarRange(research: Pick<ResearchState, 'completed'>): number {
  return research.completed.includes('gate-bearing') ? RADAR_RANGE_WIDE : RADAR_RANGE_BASE;
}

// п18.2: причина «Бракує трофеїв: …» (усі типи, яких бракує, порядком ENEMY_ORDER) або undefined.
// п22.7 (ADR-0189): і рідкісний трофей «чемпіон» — останнім, після типів.
export function missingTrophies(trophies: TrophyStore, cost: TrophyCost | undefined): string | undefined {
  if (!cost) return undefined;
  const lacks = ENEMY_ORDER.filter((k) => (cost[k] ?? 0) > trophies[k]).map(
    (k) => ENEMY_KINDS[k].name.toLowerCase() + ' ' + trophies[k] + ' з ' + cost[k]
  );
  const champ = trophies.champion ?? 0;
  if ((cost.champion ?? 0) > champ) lacks.push(CHAMPION_TROPHY_NAME + ' ' + champ + ' з ' + cost.champion);
  return lacks.length > 0 ? 'Бракує трофеїв: ' + lacks.join(', ') : undefined;
}

// п22.7 (ADR-0189): назва трофея чемпіона в текстах (журнал, панелі, причини).
export const CHAMPION_TROPHY_NAME = 'чемпіон';

// Списати трофеї (перевірку зроблено missingTrophies до оплати).
// п22.7: трофей «чемпіон» — лише коли рецепт його бере (поле необов'язкове — сейв без нього байт-у-байт).
export function spendTrophies(trophies: TrophyStore, cost: TrophyCost | undefined): void {
  if (!cost) return;
  for (const k of ENEMY_ORDER) trophies[k] -= cost[k] ?? 0;
  if ((cost.champion ?? 0) > 0) trophies.champion = (trophies.champion ?? 0) - (cost.champion ?? 0);
}

// п18.2 (ADR-0153 п. 9, EARS 1): трофеї за виграну місію — по одному за кожного
// загиблого ворога за його типом (відсутній kind ≡ демон). Поразка й евакуація — нічого.
// Без RNG: бойовий RNG і траєкторія геосцени не змінюються. Повертає нараховане.
export function awardTrophies(research: ResearchState, battle: Pick<GameState, 'units'>, outcome: string): TrophyCost {
  const gained: TrophyCost = {};
  if (outcome !== 'перемога') return gained;
  for (const u of battle.units) {
    if (u.side !== 'alien' || u.alive) continue;
    const k = enemyKind(u);
    gained[k] = (gained[k] ?? 0) + 1;
    research.trophies[k] += 1;
    if (u.champion) {
      gained.champion = (gained.champion ?? 0) + 1;
      research.trophies.champion = (research.trophies.champion ?? 0) + 1;
    }
  }
  if (Object.keys(gained).length > 0) research.log.push({ type: 'trophies', gained });
  return gained;
}

// п22.4 (ADR-0186, рішення власника «Як у кандидатах»): «Тактична мережа I» — загін 4,
// «II» (після I) — загін 5; ціни й очки — кандидати, переміряє probe п22.8. Окремий масив,
// як WEAPON_PROJECTS: PROJECTS і його порядок лишаються (бот, скрипти, тести).
export const SQUAD_PROJECTS: ProjectDef[] = [
  { id: 'tac-net-1', name: 'Тактична мережа I', cost: 120, points: 24 },
  { id: 'tac-net-2', name: 'Тактична мережа II', cost: 180, points: 36, prerequisite: 'tac-net-1' },
];

// Розмір загону без протоколів і найбільший (п'ять клітинок зони висадки, mission.ts).
export const BASE_SQUAD_SIZE = 3;
export const MAX_SQUAD_SIZE = BASE_SQUAD_SIZE + SQUAD_PROJECTS.length;

// п22.4 (ADR-0186, EARS 3 Фази 22): скільки бійців іде в бій — 3, з «Тактичною мережею I» 4,
// з «II» 5 (кожен завершений протокол — +1 місце; II без I не стартує — передумова).
export function squadSize(research: Pick<ResearchState, 'completed'>): number {
  return BASE_SQUAD_SIZE + SQUAD_PROJECTS.filter((p) => research.completed.includes(p.id)).length;
}

export const PROJECT_CATALOG: Record<ProjectId, ProjectDef> = Object.fromEntries(
  [...PROJECTS, ...KEY_PROJECTS, ...WEAPON_PROJECTS, ...SQUAD_PROJECTS].map((p) => [p.id, p])
) as Record<ProjectId, ProjectDef>;

// Відображувана назва протоколу за ключем (для throw-текстів, журналу і
// панелей; невідомий ключ — як є, без викиту).
export function projectName(id: ProjectId): string {
  return PROJECT_CATALOG[id]?.name ?? id;
}

// Стартовий пул імен вчених — фіксований, без RNG (детермінізм), циклічно
// з суфіксом номера за прецедентом ростеру (squad.ts).
const SCIENTIST_NAMES = [
  'Зінаїда',
  'Ярослав',
  'Меланія',
  'Володимир',
  'Дарія',
  'Микола',
  'Оксана',
  'Левко',
  'Ірина',
  'Панас',
  'Любов',
  'Остап',
];

// п22.5 (ADR-0182 п. 3, 11; ADR-0187): спеціалізація техноманта — обирає гравець при наймі.
export type ScientistSpec = 'researcher' | 'alchemist' | 'mechanic';
export const SCIENTIST_SPECS: readonly ScientistSpec[] = ['researcher', 'alchemist', 'mechanic'];
export const SPEC_NAMES: Record<ScientistSpec, string> = { researcher: 'Дослідник', alchemist: 'Алхімік', mechanic: 'Механік' };
// Рівень 1–3 за протоколи, завершені, поки техномант у штаті (рішення власника «А. Свій ефект + очко»).
export const LEVEL_THRESHOLDS: readonly number[] = [0, 2, 5];
export const MAX_SCIENTIST_LEVEL = 3;

export interface Scientist {
  id: string;
  name: string;
  spec: ScientistSpec; // п22.5: сейв без поля — «Дослідник» (EARS 7)
  done: number; // п22.5: протоколи, завершені в штаті (рівень — scientistLevel)
}

// п22.5: рівень техноманта — найвищий поріг LEVEL_THRESHOLDS, якого досягли завершені протоколи.
export function scientistLevel(s: Pick<Scientist, 'done'>): number {
  let level = 1;
  for (let i = 1; i < LEVEL_THRESHOLDS.length; i++) if (s.done >= LEVEL_THRESHOLDS[i]) level = i + 1;
  return level;
}

// п22.5: очки за добу — кожен 1, дослідник — за рівнем (1 / 2 / 3).
export function scientistPoints(s: Scientist): number {
  return s.spec === 'researcher' ? scientistLevel(s) : 1;
}

// п22.5: найвищий рівень техноманта спеціалізації в штаті (0 — такого немає).
export function bestLevel(research: Pick<ResearchState, 'scientists'>, spec: ScientistSpec): number {
  return research.scientists.reduce((m, s) => (s.spec === spec ? Math.max(m, scientistLevel(s)) : m), 0);
}

// Активний проєкт лабораторії: порядок у масиві = порядок запуску
// (визначає розподіл остачі точок — першим запущеним першим).
export interface ActiveProject {
  id: ProjectId;
  invested: number; // вкладені наукові точки
}

export type ResearchEvent =
  | { type: 'hire'; name: string }
  | { type: 'fire'; name: string }
  | { type: 'salary'; day: number; amount: number }
  | { type: 'salary_shortfall'; day: number; fired: string[] }
  | { type: 'points'; day: number; amount: number }
  | { type: 'project_started'; id: ProjectId }
  | { type: 'project_completed'; id: ProjectId }
  | { type: 'trophies'; gained: TrophyCost } // п18.2: трофеї за виграну місію
  | { type: 'module'; id: ModuleId; level: number }; // п22.5: модуль бази куплено чи покращено (base.ts)

export interface ResearchState {
  scientists: Scientist[]; // штат вчених (окремий від ростеру солдатів)
  hired: number; // скільки всього пройшло через штат — для унікальності id/імен
  slots: number; // доступні слоти лабораторії: 2, +1 «Розширення», +1 модуль «Стенд техномантів» (п22.5)
  active: ActiveProject[]; // активні проєкти в порядку запуску
  completed: ProjectId[]; // завершені проєкти (передумови Т2 і майбутніх фаз)
  pool: number; // спільний пул наукових точок (невитрачені)
  lastSalaryDay: number; // остання доба, за яку зарплату вже проведено
  log: ResearchEvent[]; // події науки для журналу (П11.6)
  trophies: TrophyStore; // п18.2 (ADR-0153 п. 9): трофеї за типом убитого ворога
}

export function createResearch(): ResearchState {
  return {
    scientists: [],
    hired: 0,
    slots: BASE_LAB_SLOTS,
    active: [],
    completed: [],
    pool: 0,
    lastSalaryDay: 0,
    log: [],
    trophies: emptyTrophies(),
  };
}

function scientistName(index: number): string {
  const base = SCIENTIST_NAMES[index % SCIENTIST_NAMES.length];
  return index < SCIENTIST_NAMES.length ? base : base + ' ' + (Math.floor(index / SCIENTIST_NAMES.length) + 1);
}

// Найм вченого за гроші (ADR-0058): списує ціну найму з економіки
// (недостатньо грошей → помилка, штат не змінюється). Без RNG: id та ім'я —
// наступні за лічильником hired (прецедент hireSoldier, squad.ts).
// п22.5 (ADR-0187): спеціалізацію обирає гравець; без аргументу — «Дослідник» (бот і UI до п22.7).
export function hireScientist(
  econ: EconomyState,
  research: ResearchState,
  preset: DifficultyPreset = DEFAULT_PRESET,
  spec: ScientistSpec = 'researcher'
): Scientist {
  if (!SCIENTIST_SPECS.includes(spec)) throw new Error('Невідома спеціалізація техноманта: ' + String(spec));
  spend(econ, sciencePrice(HIRE_SCIENTIST_PRICE, preset));
  const scientist: Scientist = { id: 'в' + (research.hired + 1), name: scientistName(research.hired), spec, done: 0 };
  research.hired += 1;
  research.scientists.push(scientist);
  research.log.push({ type: 'hire', name: scientist.name });
  return scientist;
}

// Звільнення вченого на прохання гравця (без повернення коштів):
// вилучає зі штату за id; вченого з таким id немає → помилка.
export function fireScientist(research: ResearchState, id: string): Scientist {
  const rec = research.scientists.find((s) => s.id === id);
  if (!rec) throw new Error('Техноманта немає в штаті: ' + id);
  research.scientists = research.scientists.filter((s) => s.id !== id);
  research.log.push({ type: 'fire', name: rec.name });
  return rec;
}

// Розподіл спільного пулу точок по активних проєктах (ADR-0058): порівну,
// остача — першим за порядком запуску. Реалізація — round-robin по 1 точці
// в порядку запуску: кожен прохід дає кожному проєкту по точці, останній
// неповний прохід встигає тільки першим запущеним — той самий розподіл,
// але з капом на потребу проєкту (лишок лишається в пулі). Проєкт, що
// заповнився, завершується одразу (звільняє слот); «Розширення лабораторії»
// відкриває третій слот. Детермінізм: порядок фіксований, жодного RNG.
function distributePool(research: ResearchState): void {
  let progressed = true;
  // Т.28 (ADR-0091): протокол із прогресом понад потребу (сейв до зміни очок
  // каталогу) завершується одразу, надлишок повертається в пул.
  for (const project of [...research.active]) {
    const extra = project.invested - PROJECT_CATALOG[project.id].points;
    if (extra < 0) continue;
    research.pool += extra;
    completeProject(research, project);
  }
  while (research.pool > 0 && progressed) {
    progressed = false;
    for (const project of [...research.active]) {
      if (research.pool <= 0) break;
      project.invested += 1;
      research.pool -= 1;
      progressed = true;
      if (project.invested >= PROJECT_CATALOG[project.id].points) completeProject(research, project);
    }
  }
}

function completeProject(research: ResearchState, project: ActiveProject): void {
  research.active = research.active.filter((p) => p !== project);
  research.completed.push(project.id);
  research.log.push({ type: 'project_completed', id: project.id });
  // п22.5: протокол росте досвід усього штату (рівень — scientistLevel)
  for (const s of research.scientists) s.done += 1;
  // п22.5: +1, а не «= 3» — «Стенд техномантів» міг дати слот раніше (до п22.5 2 + 1 = 3 те саме)
  if (project.id === LAB_EXTENSION_PROJECT) research.slots += 1;
}

// Старт протоколу (ADR-0058): оплата кредитами одразу; перевіри — відома
// ідентифікація, не завершений, не активний, передумова виконана, є вільний
// слот. Порушення → throw з українським текстом, стан не змінюється.
// Накопичений пул одразу розподіляється у новий протокол (пул спільний).
export function startProject(
  econ: EconomyState,
  research: ResearchState,
  id: ProjectId,
  preset: DifficultyPreset = DEFAULT_PRESET
): ActiveProject {
  const def = PROJECT_CATALOG[id];
  if (!def) throw new Error('Невідомий протокол: ' + id);
  if (research.completed.includes(id)) {
    throw new Error('Протокол уже завершено: ' + projectName(id));
  }
  if (research.active.some((p) => p.id === id)) {
    throw new Error('Протокол уже триває: ' + projectName(id));
  }
  if (def.prerequisite !== undefined && !research.completed.includes(def.prerequisite)) {
    throw new Error('Передумову не завершено: ' + projectName(def.prerequisite));
  }
  if (research.active.length >= research.slots) {
    throw new Error('Немає вільного слота лабораторії техномагії (' + research.slots + ')');
  }
  // п18.2 (ADR-0153 п. 10, EARS 2): трофеї — перевірка до оплати, списання разом із кредитами
  const lack = missingTrophies(research.trophies, def.trophies);
  if (lack !== undefined) throw new Error(lack);
  spend(econ, sciencePrice(def.cost, preset));
  spendTrophies(research.trophies, def.trophies);
  const project: ActiveProject = { id, invested: 0 };
  research.active.push(project);
  research.log.push({ type: 'project_started', id });
  distributePool(research);
  return project;
}

// Тік науки разом із геосценою (прецедент economyTick): на кожну ЗАВЕРШЕНУ
// добу — зарплата (одразу після дотації того ж дня; researchTick викликається
// після economyTick), потім наукові точки від тих, хто залишився у штаті.
// Зарплати бракує → вчені звільняються автоматично з кінця штату (останні
// найняті перші), подія в журналі; у мінус неможливо (spend). Повторний виклик
// без нових завершених діб — no-op. Множники пресетів (ADR-0033/0058) діють
// лише на коштовність (зарплата); наукові точки — без множників.
export function researchTick(research: ResearchState, econ: EconomyState, geo: GeoState, preset: DifficultyPreset = DEFAULT_PRESET): void {
  const completedDays = geoDay(geo) - 1;
  const salaryPerScientist = sciencePrice(SCIENTIST_SALARY, preset);
  while (research.lastSalaryDay < completedDays) {
    research.lastSalaryDay += 1;
    const day = research.lastSalaryDay;
    const fired: string[] = [];
    while (research.scientists.length > 0 && econ.money < salaryPerScientist * research.scientists.length) {
      const s = research.scientists.pop() as Scientist;
      fired.push(s.name);
    }
    if (fired.length > 0) {
      research.log.push({ type: 'salary_shortfall', day, fired });
    }
    if (research.scientists.length > 0) {
      const amount = salaryPerScientist * research.scientists.length;
      spend(econ, amount);
      research.log.push({ type: 'salary', day, amount });
      // п22.5: очки за спеціалізацією й рівнем (до п22.5 — по 1 на техноманта)
      const points = research.scientists.reduce((sum, s) => sum + scientistPoints(s), 0);
      research.pool += points;
      research.log.push({ type: 'points', day, amount: points });
    }
    distributePool(research);
  }
}
