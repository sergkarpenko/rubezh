// src/core/workshop.ts
// П11.3 (Фаза 11): ядро «Цех і склад» (ADR-0058).
// ADR-0002: чисте ядро без DOM/Canvas. ADR-0003: жодного RNG — цех
// детермінований (черга фіксованого порядку, тики без випадковості).
// Патерн ізоляції шарів (як research.ts): geo.ts не знає про цех;
// workshopTick не підписаний на геосцену — 1 виклик = 1 тік геосцени
// (викликає шар застосунку у partyTick після researchTick), geo.rng
// не витягується — траєкторія геосцени з цехом і без нього байт-у-байт
// однакова.
// Виробництво — черга (ADR-0058): одне активне замовлення (перше в черзі),
// нові стають у кінець черги; оплата при замовленні (spend, у мінус
// неможливо); час виготовлення — тики геосцени; готовий предмет → склад
// (лічильники на Party). Замовлення вимагає завершеного проєкту науки —
// каталог цеху = предметні проєкти каталогу досліджень (дослідження
// відкриває виробництво; «Розширення лабораторії» слот відкриває,
// а предмета не виробляє).
// Множники пресетів (ADR-0033/0058) діють лише на коштовність (ціну);
// тики виготовлення — без множників. Числа балансу — КАНДИДАТИ, тунінг
// probe-симуляціями П11.8 (патерн П10.4), затверджує власник.

import { spend, type EconomyState } from './economy';
import { type DifficultyPreset, DEFAULT_PRESET, DIFFICULTY_MULTIPLIERS } from './campaign';
import type { ProjectId, ResearchState } from './research';

// Предмети цеху — завершені проєкти науки, крім «Розширення лабораторії».
export type ItemId = Exclude<ProjectId, 'розширення лабораторії'>;

export interface WorkshopItemDef {
  cost: number; // кошти за замовлення (кандидат, П11.8)
  ticks: number; // тики геосцени на виготовлення (кандидат, П11.8)
}

// Каталог цеху (ADR-0058): формат кошти / тики.
export const WORKSHOP_CATALOG: Record<ItemId, WorkshopItemDef> = {
  аптечка: { cost: 40, ticks: 12 },
  'осколкова граната': { cost: 60, ticks: 16 },
  'оптичний приціл': { cost: 50, ticks: 20 },
  'легка броня': { cost: 60, ticks: 24 },
  'гарматний модуль': { cost: 80, ticks: 32 },
};

export const ITEM_IDS = Object.keys(WORKSHOP_CATALOG) as ItemId[];

export type WorkshopEvent =
  | { type: 'order'; id: ItemId; ticks: number } // замовлення оплачено і поставлено в чергу
  | { type: 'produced'; id: ItemId }; // предмет готовий → склад

export interface WorkshopOrder {
  id: ItemId;
  ticksLeft: number; // тики геосцени до готовності
}

export interface WorkshopState {
  queue: WorkshopOrder[]; // черга виробництва: перше — активне замовлення
  store: Record<ItemId, number>; // склад: лічильники готових предметів
  log: WorkshopEvent[]; // події цеху для журналу (П11.6)
}

// Порожній склад: усі предмети каталогу з нульовими лічильниками. Експортовано
// для сейву (мерж із збереженим складом лишає валідні ключі майбутніх предметів).
export function emptyStore(): Record<ItemId, number> {
  return { аптечка: 0, 'осколкова граната': 0, 'оптичний приціл': 0, 'легка броня': 0, 'гарматний модуль': 0 };
}

export function createWorkshop(): WorkshopState {
  return { queue: [], store: emptyStore(), log: [] };
}

// Замовлення предмета в цех (ADR-0058): оплата коштами ОДРУЧ при
// замовленні (недостатньо коштів → помилка, черга не змінюється),
// предмет ставиться в кінець черги. Вимоги: предмет відомий, проєкт
// завершений (дослідження відкриває виробництво). Порушення → throw
// з українським текстом, стан не змінюється. Множник пресету — лише
// на ціну; тики без множників (ADR-0033/0058).
export function orderItem(
  econ: EconomyState,
  workshop: WorkshopState,
  research: ResearchState,
  id: ItemId,
  preset: DifficultyPreset = DEFAULT_PRESET
): WorkshopOrder {
  const def = WORKSHOP_CATALOG[id];
  if (!def) throw new Error('Невідомий предмет: ' + id);
  if (!research.completed.includes(id)) {
    throw new Error('Предмет ще не досліджено: ' + id);
  }
  const multipliers = DIFFICULTY_MULTIPLIERS[preset];
  spend(econ, Math.round(def.cost * multipliers.economyMultiplier));
  const order: WorkshopOrder = { id, ticksLeft: def.ticks };
  workshop.queue.push(order);
  workshop.log.push({ type: 'order', id, ticks: def.ticks });
  return order;
}

// Тік цеху разом із геосценою (прецедент repairTick): 1 виклик = 1 тік
// геосцени. Активне замовлення (перше в черзі) добирає тик; нуль →
// предмет на склад, наступне замовлення стає активним з наступного
// тіку. Без замовлень — no-op. Детермінізм: порядок фіксований, жодного RNG.
export function workshopTick(workshop: WorkshopState): void {
  const active = workshop.queue[0];
  if (!active) return;
  active.ticksLeft -= 1;
  if (active.ticksLeft <= 0) {
    workshop.queue.shift();
    workshop.store[active.id] += 1;
    workshop.log.push({ type: 'produced', id: active.id });
  }
}
