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
import { type DifficultyPreset, DEFAULT_PRESET, DIFFICULTY_MULTIPLIERS } from './campaign';

export const HIRE_SCIENTIST_PRICE = 100; // кандидат (П11.8); прецедент найму солдата, ADR-0021
export const SCIENTIST_SALARY = 20; // зарплата за добу за вченого — кандидат (П11.8)
export const BASE_LAB_SLOTS = 2; // стартові слоти лабораторії (ADR-0058)
export const MAX_LAB_SLOTS = 3; // після проєкту «Розширення лабораторії»

// Ідентифікатори проєктів — українські рядки (прецедент UfoKind, geo.ts).
export type ProjectId = 'легка броня' | 'оптичний приціл' | 'аптечка' | 'розширення лабораторії' | 'осколкова граната' | 'гарматний модуль';

export interface ProjectDef {
  id: ProjectId;
  cost: number; // кошти за старт (кандидат, П11.8)
  points: number; // наукові точки до завершення (кандидат, П11.8)
  prerequisite?: ProjectId; // передумова — завершений проєкт
}

// Стартовий каталог (ADR-0058): Т1 без передумов, Т2 — за передумовами.
export const PROJECTS: ProjectDef[] = [
  { id: 'легка броня', cost: 120, points: 36 },
  { id: 'оптичний приціл', cost: 90, points: 30 },
  { id: 'аптечка', cost: 100, points: 32 },
  { id: 'розширення лабораторії', cost: 80, points: 44 },
  { id: 'осколкова граната', cost: 140, points: 40, prerequisite: 'аптечка' },
  { id: 'гарматний модуль', cost: 160, points: 48, prerequisite: 'оптичний приціл' },
];

export const LAB_EXTENSION_PROJECT: ProjectId = 'розширення лабораторії';

export const PROJECT_CATALOG: Record<ProjectId, ProjectDef> = Object.fromEntries(PROJECTS.map((p) => [p.id, p])) as Record<
  ProjectId,
  ProjectDef
>;

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

export interface Scientist {
  id: string;
  name: string;
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
  | { type: 'project_completed'; id: ProjectId };

export interface ResearchState {
  scientists: Scientist[]; // штат вчених (окремий від ростеру солдатів)
  hired: number; // скільки всього пройшло через штат — для унікальності id/імен
  slots: number; // доступні слоти лабораторії: 2, після «Розширення» — 3
  active: ActiveProject[]; // активні проєкти в порядку запуску
  completed: ProjectId[]; // завершені проєкти (передумови Т2 і майбутніх фаз)
  pool: number; // спільний пул наукових точок (невитрачені)
  lastSalaryDay: number; // остання доба, за яку зарплату вже проведено
  log: ResearchEvent[]; // події науки для журналу (П11.6)
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
  };
}

function scientistName(index: number): string {
  const base = SCIENTIST_NAMES[index % SCIENTIST_NAMES.length];
  return index < SCIENTIST_NAMES.length ? base : base + ' ' + (Math.floor(index / SCIENTIST_NAMES.length) + 1);
}

// Найм вченого за гроші (ADR-0058): списує ціну найму з економіки
// (недостатньо грошей → помилка, штат не змінюється). Без RNG: id та ім'я —
// наступні за лічильником hired (прецедент hireSoldier, squad.ts).
export function hireScientist(econ: EconomyState, research: ResearchState, preset: DifficultyPreset = DEFAULT_PRESET): Scientist {
  const multipliers = DIFFICULTY_MULTIPLIERS[preset];
  spend(econ, Math.round(HIRE_SCIENTIST_PRICE * multipliers.economyMultiplier));
  const scientist: Scientist = { id: 'в' + (research.hired + 1), name: scientistName(research.hired) };
  research.hired += 1;
  research.scientists.push(scientist);
  research.log.push({ type: 'hire', name: scientist.name });
  return scientist;
}

// Звільнення вченого на прохання гравця (без повернення коштів):
// вилучає зі штату за id; вченого з таким id немає → помилка.
export function fireScientist(research: ResearchState, id: string): Scientist {
  const rec = research.scientists.find((s) => s.id === id);
  if (!rec) throw new Error('Вченого немає в штаті: ' + id);
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
  while (research.pool > 0 && progressed) {
    progressed = false;
    for (const project of [...research.active]) {
      if (research.pool <= 0) break;
      if (project.invested >= PROJECT_CATALOG[project.id].points) continue;
      project.invested += 1;
      research.pool -= 1;
      progressed = true;
      if (project.invested >= PROJECT_CATALOG[project.id].points) {
        research.active = research.active.filter((p) => p !== project);
        research.completed.push(project.id);
        research.log.push({ type: 'project_completed', id: project.id });
        if (project.id === LAB_EXTENSION_PROJECT) {
          research.slots = MAX_LAB_SLOTS;
        }
      }
    }
  }
}

// Старт проєкту (ADR-0058): оплата коштами одразу; перевіри — відома
// ідентифікація, не завершений, не активний, передумова виконана, є вільний
// слот. Порушення → throw з українським текстом, стан не змінюється.
// Накопичений пул одразу розподіляється у новий проєкт (пул спільний).
export function startProject(
  econ: EconomyState,
  research: ResearchState,
  id: ProjectId,
  preset: DifficultyPreset = DEFAULT_PRESET
): ActiveProject {
  const def = PROJECT_CATALOG[id];
  if (!def) throw new Error('Невідомий проєкт: ' + id);
  if (research.completed.includes(id)) {
    throw new Error('Проєкт уже завершено: ' + id);
  }
  if (research.active.some((p) => p.id === id)) {
    throw new Error('Проєкт уже триває: ' + id);
  }
  if (def.prerequisite !== undefined && !research.completed.includes(def.prerequisite)) {
    throw new Error('Передумову не завершено: ' + def.prerequisite);
  }
  if (research.active.length >= research.slots) {
    throw new Error('Немає вільного слота лабораторії (' + research.slots + ')');
  }
  const multipliers = DIFFICULTY_MULTIPLIERS[preset];
  spend(econ, Math.round(def.cost * multipliers.economyMultiplier));
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
  const multipliers = DIFFICULTY_MULTIPLIERS[preset];
  const salaryPerScientist = Math.round(SCIENTIST_SALARY * multipliers.economyMultiplier);
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
      research.pool += research.scientists.length;
      research.log.push({ type: 'points', day, amount: research.scientists.length });
    }
    distributePool(research);
  }
}
