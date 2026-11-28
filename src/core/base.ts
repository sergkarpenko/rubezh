// src/core/base.ts
// п22.5 (ADR-0182 п. 4, 12; ADR-0187): легкі модулі бази — без плану приміщень, енергії й
// будівництва за добу (рішення власника п22.1 «А. Легка: модулі лабораторії й «Кузні»»).
// Рішення власника п22.5 «А. Протокол + три модулі»: «Розширення лабораторії» лишається
// протоколом; модулі за кредити — «Стенд техномантів» (+1 слот), «Паровий котел» I / II
// (замовлення «Кузні» −20 % тиків за рівень), «Казан алхіміка» I / II (без нього алхімік не
// варить; II — дві порції за раз). Купівля — одразу (ціна пресета, sciencePrice), без RNG.
// Числа — кандидати, probe п22.8.

import { spend, type EconomyState } from './economy';
import { type DifficultyPreset, DEFAULT_PRESET, sciencePrice } from './campaign';
import { LAB_EXTENSION_PROJECT, bestLevel, type ResearchState } from './research';

export type ModuleId = 'stand' | 'boiler' | 'cauldron';
export const MODULE_IDS: readonly ModuleId[] = ['stand', 'boiler', 'cauldron'];

export interface ModuleDef {
  name: string;
  prices: readonly number[]; // ціна рівня i + 1 (кредити до множника науки); довжина — найвищий рівень
}

export const MODULES: Record<ModuleId, ModuleDef> = {
  stand: { name: 'Стенд техномантів', prices: [160] },
  boiler: { name: 'Паровий котел', prices: [120, 200] },
  cauldron: { name: 'Казан алхіміка', prices: [100, 180] },
};

// Рівні модулів бази: 0 — модуля немає.
export type BaseModules = Record<ModuleId, number>;

export function createModules(): BaseModules {
  return { stand: 0, boiler: 0, cauldron: 0 };
}

export const BOILER_TICKS_CUT = 0.2; // «Паровий котел»: −20 % тиків замовлення «Кузні» за рівень
export const MECHANIC_TICKS_CUT = 0.1; // механік: −10 % тиків за рівень найкращого механіка в штаті

export function moduleMaxLevel(id: ModuleId): number {
  return MODULES[id].prices.length;
}

// Ціна наступного рівня з множником пресета; undefined — модуль на найвищому рівні.
export function modulePrice(modules: BaseModules, id: ModuleId, preset: DifficultyPreset = DEFAULT_PRESET): number | undefined {
  const base = MODULES[id].prices[modules[id]];
  return base === undefined ? undefined : sciencePrice(base, preset);
}

// Купівля модуля чи наступного рівня: оплата одразу (у мінус неможливо); «Стенд» — +1 слот
// лабораторії. Порушення → throw з українським текстом, стан не змінюється. Подія — у журналі науки.
export function buyModule(
  econ: EconomyState,
  research: ResearchState,
  modules: BaseModules,
  id: ModuleId,
  preset: DifficultyPreset = DEFAULT_PRESET
): number {
  if (!Object.prototype.hasOwnProperty.call(MODULES, id)) throw new Error('Невідомий модуль бази: ' + String(id));
  const price = modulePrice(modules, id, preset);
  if (price === undefined) throw new Error('Модуль уже на найвищому рівні: ' + MODULES[id].name);
  // рішення власника: «Стенд» — 4-й слот, тобто після протоколу «Розширення лабораторії» (аудит PR #551)
  if (id === 'stand' && !research.completed.includes(LAB_EXTENSION_PROJECT))
    throw new Error('«Стенд техномантів» — четвертий слот: спершу протокол «Розширення лабораторії»');
  spend(econ, price);
  modules[id] += 1;
  if (id === 'stand') research.slots += 1;
  research.log.push({ type: 'module', id, level: modules[id] });
  return modules[id];
}

// Тики замовлення «Кузні» з котлом і механіком: не менше 1, округлення вгору.
// Без модулів і механіків — ті самі тики каталогу (до п22.5 — байт-у-байт).
export function forgeTicks(ticks: number, research?: Pick<ResearchState, 'scientists'>, modules?: BaseModules): number {
  const cut = BOILER_TICKS_CUT * (modules?.boiler ?? 0) + MECHANIC_TICKS_CUT * (research ? bestLevel(research, 'mechanic') : 0);
  if (cut === 0) return ticks;
  // цілі відсотки — без похибки дробів (0,1 + 0,2 у double)
  return Math.max(1, Math.ceil((ticks * Math.round(100 - cut * 100)) / 100));
}
