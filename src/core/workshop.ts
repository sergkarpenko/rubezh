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
import { HIT_CHANCE_CAP, type Unit, type UnitItems } from './combat';
import type { InterceptState } from './intercept';

// Предмети «Кузні» — завершені протоколи науки, крім «Розширення лабораторії».
// П12.6 (ADR-0064): ключі англійські (стабільні, збігаються з ProjectId),
// відображувані назви — поле name каталогу.
export type ItemId = Exclude<ProjectId, 'lab-extension'>;

export interface WorkshopItemDef {
  name: string; // відображувана назва предмета (ADR-0064 — мапа перейменувань)
  cost: number; // кредити за замовлення (кандидат, П11.8)
  ticks: number; // тики геосцени на виготовлення (кандидат, П11.8)
}

// Каталог «Кузні» (ADR-0058): формат кредити / тики.
export const WORKSHOP_CATALOG: Record<ItemId, WorkshopItemDef> = {
  medkit: { name: 'Регенеративний гель', cost: 40, ticks: 12 },
  grenade: { name: 'Імпульсна граната', cost: 60, ticks: 16 },
  optics: { name: 'Кібернетичне око', cost: 50, ticks: 20 },
  armor: { name: 'Композитна броня', cost: 60, ticks: 24 },
  'gun-module': { name: 'Гарматний модуль перехоплювача', cost: 80, ticks: 32 },
};

export const ITEM_IDS = Object.keys(WORKSHOP_CATALOG) as ItemId[];

// Відображувана назва предмета за ключем (журнал, панелі, throw-тексти;
// невідомий ключ — як є).
export function itemName(id: ItemId): string {
  return WORKSHOP_CATALOG[id]?.name ?? id;
}

// Предмети, що екіпіруються на оперативника ростеру (ADR-0058). Гарматний
// модуль — озброєння перехоплювача, на оперативникові він не носиться
// (встановлення — intercept).
export type SoldierItemId = Exclude<ItemId, 'gun-module'>;

export const ARMOR_MAX_HP_BONUS = 2; // «Композитна броня»: +2 maxHp (ADR-0058)
export const OPTICS_ACCURACY_BONUS = 0.05; // «Кібернетичне око»: +0.05 точності (кап 0.95, ADR-0004)

export type WorkshopEvent =
  | { type: 'order'; id: ItemId; ticks: number } // замовлення оплачено і поставлено в чергу
  | { type: 'produced'; id: ItemId } // предмет готовий → склад
  | { type: 'equip'; soldierId: string; id: SoldierItemId } // предмет зі складу на солдата
  | { type: 'unequip'; soldierId: string; id: SoldierItemId } // предмет з солдата назад на склад
  | { type: 'equipment_lost'; soldierId: string; items: (keyof SoldierEquipment)[] } // предмети загиблого зникли (перма-смерть)
  | { type: 'gun_module_installed' } // модуль зі складу на винищувач
  | { type: 'gun_module_removed' }; // модуль з винищувача назад на склад

export interface WorkshopOrder {
  id: ItemId;
  ticksLeft: number; // тики геосцени до готовності
}

// Екіпірування солдата ростеру (ADR-0058): броня і оптика — постійні
// покращення (по одному кожного типу), аптечка і граната — витратні
// (по одній на місію, списуються при використанні — П11.4). Поле true =
// предмет при солдатові. Екіпірування/зняття — лише на геосцені
// (панель під час бою недоступна — П11.6; ядро стану бою не знає).
export interface SoldierEquipment {
  armor: boolean; // «Композитна броня»
  optics: boolean; // «Кібернетичне око»
  medkit: boolean; // «Регенеративний гель»
  grenade: boolean; // «Імпульсна граната»
}

function emptyEquipment(): SoldierEquipment {
  return { armor: false, optics: false, medkit: false, grenade: false };
}

export interface WorkshopState {
  queue: WorkshopOrder[]; // черга виробництва: перше — активне замовлення
  store: Record<ItemId, number>; // склад: лічильники готових предметів
  equipped: Record<string, SoldierEquipment>; // id оперативника → екіпірування
  log: WorkshopEvent[]; // події «Кузні» для журналу (П11.6)
}

// Порожній склад: усі предмети каталогу з нульовими лічильниками (мерж у сейві
// лишає валідні ключі майбутніх предметів).
export function emptyStore(): Record<ItemId, number> {
  return { medkit: 0, grenade: 0, optics: 0, armor: 0, 'gun-module': 0 };
}

export function createWorkshop(): WorkshopState {
  return { queue: [], store: emptyStore(), equipped: {}, log: [] };
}

// Замовлення предмета в «Кузні» (ADR-0058): оплата кредитами ОДРУЧ при
// замовленні (недостатньо кредитів → помилка, черга не змінюється),
// предмет ставиться в кінець черги. Вимоги: предмет відомий, протокол
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
    throw new Error('Предмет ще не досліджено: ' + itemName(id));
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

// Екіпірування оперативника предметом зі складу (ADR-0058): списує лічильник
// складу, ставить предмет на оперативника. Броня/оптика — постійні покращення
// (по одному кожного типу): броня +2 maxHp (разом з hp — оперативник не стає
// «пораненим» від екіпірування), оптика +0.05 точності з капом 0.95
// (ADR-0004). Гель/граната — витратні, по одній на місію: оперативник несе
// не більше однієї кожної (ADR-0058). Порушення → throw з українським
// текстом, стан не змінюється. Гарматний модуль на оперативникові не носиться.
export function equipItem(workshop: WorkshopState, soldier: Unit, id: ItemId): void {
  if (id === 'gun-module') {
    throw new Error('Гарматний модуль перехоплювача — озброєння перехоплювача, на оперативникові не носиться');
  }
  const soldierId = SoldierItemIdOf(id);
  if (workshop.store[id] <= 0) {
    throw new Error('Предмета немає на складі: ' + itemName(id));
  }
  const eq = equipmentOf(workshop, soldier.id);
  if (eq[soldierId]) {
    throw new Error('Предмет уже при оперативникові: ' + itemName(id));
  }
  eq[soldierId] = true;
  workshop.store[id] -= 1;
  if (soldierId === 'armor') {
    soldier.maxHp += ARMOR_MAX_HP_BONUS;
    soldier.hp += ARMOR_MAX_HP_BONUS;
  }
  if (soldierId === 'optics') {
    soldier.firingAccuracy = Math.min(HIT_CHANCE_CAP, soldier.firingAccuracy + OPTICS_ACCURACY_BONUS);
  }
  workshop.equipped[soldier.id] = eq;
  workshop.log.push({ type: 'equip', soldierId: soldier.id, id });
}

// Зняття предмета з оперативника назад на склад (ADR-0058: екіпірування/
// зняття — лише на геосцені): повертає лічильник складу, прибирає покращення.
// Поранений оперативник при знятті броні не «оздоровлюється»: hp клемується
// новим maxHp. Предмета на оперативникові немає → throw.
export function unequipItem(workshop: WorkshopState, soldier: Unit, id: ItemId): void {
  if (id === 'gun-module') {
    throw new Error('Гарматний модуль перехоплювача — озброєння перехоплювача, на оперативникові не носиться');
  }
  const soldierId = SoldierItemIdOf(id);
  const eq = workshop.equipped[soldier.id];
  if (!eq || !eq[soldierId]) {
    throw new Error('Предмета немає на оперативникові: ' + itemName(id));
  }
  eq[soldierId] = false;
  workshop.store[id] += 1;
  if (soldierId === 'armor') {
    soldier.maxHp -= ARMOR_MAX_HP_BONUS;
    soldier.hp = Math.min(soldier.hp, soldier.maxHp);
  }
  if (soldierId === 'optics') {
    soldier.firingAccuracy -= OPTICS_ACCURACY_BONUS;
  }
  // порожній запис екіпірування не тримаємо (чистий стан у сейві)
  if (!eq.armor && !eq.optics && !eq.medkit && !eq.grenade) {
    delete workshop.equipped[soldier.id];
  }
  workshop.log.push({ type: 'unequip', soldierId: soldier.id, id });
}

// Предмети загиблих зникають разом з ними (ADR-0058: перма-смерть наскрізна,
// на склад НЕ повертаються): запис екіпірування вилучається, подія в журналі.
// Викликає шар застосунку після applyMissionResult з aftermath.lost.
export function removeLostEquipment(workshop: WorkshopState, lost: Unit[]): void {
  for (const soldier of lost) {
    const eq = workshop.equipped[soldier.id];
    if (!eq) continue;
    const items = (Object.keys(eq) as (keyof SoldierEquipment)[]).filter((k) => eq[k]);
    delete workshop.equipped[soldier.id];
    workshop.log.push({ type: 'equipment_lost', soldierId: soldier.id, items });
  }
}

// Запис екіпірування солдата (створюється порожнім при першому зверненні).
function equipmentOf(workshop: WorkshopState, soldierId: string): SoldierEquipment {
  return workshop.equipped[soldierId] ?? emptyEquipment();
}

// Гарматний модуль на перехоплювач (ADR-0058): один модуль, екіпірування на
// геосцені; +2 пошкодження за раунд повітряного бою, доки встановлено
// (застосовує interceptRound; зняття повертає модуль на склад). Модуль
// ставиться/знімається лише у вузлі «Рубіж» — перехоплювач у погоні, бою
// чи ремонті недоступний для обслуговування.
export function installGunModule(workshop: WorkshopState, intercept: InterceptState): void {
  if (intercept.fighter.status !== 'на базі') {
    throw new Error('Модуль встановлюється лише у вузлі «Рубіж»: перехоплювач у польоті');
  }
  if (intercept.fighter.gunModule) {
    throw new Error('Гарматний модуль перехоплювача уже встановлено');
  }
  if (workshop.store['gun-module'] <= 0) {
    throw new Error('Предмета немає на складі: Гарматний модуль перехоплювача');
  }
  workshop.store['gun-module'] -= 1;
  intercept.fighter.gunModule = true;
  workshop.log.push({ type: 'gun_module_installed' });
}

export function removeGunModule(workshop: WorkshopState, intercept: InterceptState): void {
  if (intercept.fighter.status !== 'на базі') {
    throw new Error('Модуль знімається лише у вузлі «Рубіж»: перехоплювач у польоті');
  }
  if (!intercept.fighter.gunModule) {
    throw new Error('Гарматний модуль перехоплювача не встановлено');
  }
  intercept.fighter.gunModule = false;
  workshop.store['gun-module'] += 1;
  workshop.log.push({ type: 'gun_module_removed' });
}

// П11.4 (ADR-0058): витратники загону на місію — копія екіпірування в стан
// бою (id солдата → предмети). Ядро бою не знає про ростер/склад: список
// для GameState.items готує цех, дії списують прапорці вже у копії.
// Детермінізм: порядок фіксований за загоном, жодного RNG.
export function deployConsumables(workshop: WorkshopState, squad: Unit[]): Record<string, UnitItems> {
  const items: Record<string, UnitItems> = {};
  for (const soldier of squad) {
    const eq = workshop.equipped[soldier.id];
    if (eq?.medkit || eq?.grenade) items[soldier.id] = { medkit: eq.medkit, grenade: eq.grenade };
  }
  return items;
}

// П11.4 (ADR-0058): розрахунок витратників після місії — повертає істину в
// ростер: невикористані лишаються при солдатові («по одній на місію»),
// використані зникають (на склад не повертаються — витратник витрачено).
// Загиблих опрацьовує removeLostEquipment — сюди передаємо лише уцілілих.
// Порожній запис екіпірування не тримаємо (чистий стан у сейві, як в unequipItem).
export function settleConsumables(workshop: WorkshopState, survivors: Unit[], items: Record<string, UnitItems> | undefined): void {
  for (const soldier of survivors) {
    const eq = workshop.equipped[soldier.id];
    if (!eq) continue;
    eq.medkit = items?.[soldier.id]?.medkit ?? false;
    eq.grenade = items?.[soldier.id]?.grenade ?? false;
    if (!eq.armor && !eq.optics && !eq.medkit && !eq.grenade) delete workshop.equipped[soldier.id];
  }
}

// Ключ запису екіпірування за предметом каталогу (гарматний модуль відсіюється
// guard'ом у equipItem/unequipItem — звуження типу до SoldierItemId).
function SoldierItemIdOf(id: SoldierItemId): keyof SoldierEquipment {
  switch (id) {
    case 'armor':
      return 'armor';
    case 'optics':
      return 'optics';
    case 'medkit':
      return 'medkit';
    case 'grenade':
      return 'grenade';
  }
}
