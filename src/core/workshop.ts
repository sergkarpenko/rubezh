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
import { HIT_CHANCE_CAP, type Unit } from './combat';
import type { InterceptState } from './intercept';

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

// Предмети, що екіпіруються на солдата ростеру (ADR-0058). Гаркатний модуль —
// озброєння винищувача, на солдаті він не носиться (встановлення — intercept).
export type SoldierItemId = Exclude<ItemId, 'гаркатний модуль'>;

export const ARMOR_MAX_HP_BONUS = 2; // «Легка броня»: +2 maxHp (ADR-0058)
export const OPTICS_ACCURACY_BONUS = 0.05; // «Оптичний приціл»: +0.05 точності (кап 0.95, ADR-0004)

export type WorkshopEvent =
  | { type: 'order'; id: ItemId; ticks: number } // замовлення оплачено і поставлено в чергу
  | { type: 'produced'; id: ItemId } // предмет готовий → склад
  | { type: 'equip'; soldierId: string; id: SoldierItemId } // предмет зі складу на солдата
  | { type: 'unequip'; soldierId: string; id: SoldierItemId } // предмет з солдата назад на склад
  | { type: 'equipment_lost'; soldierId: string; items: SoldierItemId[] } // предмети загиблого зникли (перма-смерть)
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
  armor: boolean; // «легка броня»
  optics: boolean; // «оптичний приціл»
  medkit: boolean; // «аптечка»
  grenade: boolean; // «осколкова граната»
}

function emptyEquipment(): SoldierEquipment {
  return { armor: false, optics: false, medkit: false, grenade: false };
}

export interface WorkshopState {
  queue: WorkshopOrder[]; // черга виробництва: перше — активне замовлення
  store: Record<ItemId, number>; // склад: лічильники готових предметів
  equipped: Record<string, SoldierEquipment>; // id солдата → екіпірування
  log: WorkshopEvent[]; // події цеху для журналу (П11.6)
}

// Порожній склад: усі предмети каталогу з нульовими лічильниками (мерж у сейві
// лишає валідні ключі майбутніх предметів).
export function emptyStore(): Record<ItemId, number> {
  return { аптечка: 0, 'осколкова граната': 0, 'оптичний приціл': 0, 'легка броня': 0, 'гаркатний модуль': 0 };
}

export function createWorkshop(): WorkshopState {
  return { queue: [], store: emptyStore(), equipped: {}, log: [] };
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

// Екіпірування солдата предметом зі складу (ADR-0058): списує лічильник
// складу, ставить предмет на солдата. Броня/оптика — постійні покращення
// (по одному кожного типу): броня +2 maxHp (разом з hp — солдат не стає
// «пораненим» від екіпірування), оптика +0.05 точності з капом 0.95
// (ADR-0004). Аптечка/граната — витратні, по одній на місію: солдат несе
// не більше однієї кожної (ADR-0058). Порушення → throw з українським
// текстом, стан не змінюється. Гаркатний модуль на солдатові не носиться.
export function equipItem(workshop: WorkshopState, soldier: Unit, id: ItemId): void {
  if (id === 'гаркатний модуль') {
    throw new Error('Гаркатний модуль — озброєння винищувача, на солдатові не носиться');
  }
  const soldierId = SoldierItemIdOf(id);
  if (workshop.store[id] <= 0) {
    throw new Error('Предмета немає на складі: ' + id);
  }
  const eq = equipmentOf(workshop, soldier.id);
  if (eq[soldierId]) {
    throw new Error('Предмет уже при солдатові: ' + id);
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

// Зняття предмета з солдата назад на склад (ADR-0058: екіпірування/зняття —
// лише на геосцені): повертає лічильник складу, прибирає покращення.
// Поранений солдат при знятті броні не «оздоровлюється»: hp клемується
// новим maxHp. Предмета на солдатові немає → throw.
export function unequipItem(workshop: WorkshopState, soldier: Unit, id: ItemId): void {
  if (id === 'гаркатний модуль') {
    throw new Error('Гаркатний модуль — озброєння винищувача, на солдатові не носиться');
  }
  const soldierId = SoldierItemIdOf(id);
  const eq = workshop.equipped[soldier.id];
  if (!eq || !eq[soldierId]) {
    throw new Error('Предмета немає на солдатові: ' + id);
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

// Гаркатний модуль на винищувач (ADR-0058): один модуль, екіпірування на
// геосцені; +2 пошкодження за раунд повітряного бою, доки встановлено
// (застосовує interceptRound; зняття повертає модуль на склад). Модуль
// ставиться/знімається лише на базі — винищувач у погоні, бою чи ремонті
// недоступний для обслуговування.
export function installGunModule(workshop: WorkshopState, intercept: InterceptState): void {
  if (intercept.fighter.status !== 'на базі') {
    throw new Error('Модуль встановлюється лише на базі: винищувач у польоті');
  }
  if (intercept.fighter.gunModule) {
    throw new Error('Гаркатний модуль уже встановлено');
  }
  if (workshop.store['гаркатний модуль'] <= 0) {
    throw new Error('Предмета немає на складі: гаркатний модуль');
  }
  workshop.store['гаркатний модуль'] -= 1;
  intercept.fighter.gunModule = true;
  workshop.log.push({ type: 'gun_module_installed' });
}

export function removeGunModule(workshop: WorkshopState, intercept: InterceptState): void {
  if (intercept.fighter.status !== 'на базі') {
    throw new Error('Модуль знімається лише на базі: винищувач у польоті');
  }
  if (!intercept.fighter.gunModule) {
    throw new Error('Гаркатний модуль не встановлено');
  }
  intercept.fighter.gunModule = false;
  workshop.store['гаркатний модуль'] += 1;
  workshop.log.push({ type: 'gun_module_removed' });
}

// Ключ запису екіпірування за предметом каталогу.
function SoldierItemIdOf(id: ItemId): keyof SoldierEquipment {
  switch (id) {
    case 'легка броня':
      return 'armor';
    case 'оптичний приціл':
      return 'optics';
    case 'аптечка':
      return 'medkit';
    case 'осколкова граната':
      return 'grenade';
  }
}
