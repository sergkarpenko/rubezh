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
import { type DifficultyPreset, DEFAULT_PRESET, sciencePrice } from './campaign';
import {
  missingTrophies,
  spendTrophies,
  type KeyProjectId,
  type SquadProjectId,
  type ProjectId,
  type ResearchState,
  type TrophyCost,
} from './research';
import { HIT_CHANCE_CAP, type Unit, type UnitItems } from './combat';
import { addFighter, baseWhere, fighterById, MAX_FIGHTERS, type InterceptState } from './intercept';
import type { GeoState } from './geo';
import type { RegionId } from './regions';
import { isForgeWeapon, WEAPONS, type ForgeWeaponId, type WeaponId } from './weapons';
import { bestLevel, scientistLevel } from './research';
import { forgeTicks, type BaseModules } from './base';

// Предмети «Кузні» — завершені протоколи науки, крім «Розширення лабораторії».
// П12.6 (ADR-0064): ключі англійські (стабільні, збігаються з ProjectId),
// відображувані назви — поле name каталогу.
// п18.2 (ADR-0153 п. 10–11): ключові протоколи предмета не виробляють; «Пробивний
// заряд» має власний id і протокол, що його відкриває (`unlockedBy`).
export type ItemId = Exclude<ProjectId, 'lab-extension' | KeyProjectId | SquadProjectId> | 'breach-charge' | BrewItemId;

// п22.5 (ADR-0182 п. 13; ADR-0187): витратники алхіміка — варить «Казан алхіміка», не «Кузня».
export type BrewItemId = 'stim' | 'shield';
export const BREW_IDS: readonly BrewItemId[] = ['stim', 'shield'];
export function isBrewItem(id: string): id is BrewItemId {
  return id === 'stim' || id === 'shield';
}
// Рівень найкращого алхіміка в штаті, з якого рецепт доступний (рішення власника «А. Свій ефект + очко»).
export const BREW_LEVEL: Record<BrewItemId, number> = { stim: 1, shield: 2 };
export const FAST_BREW_LEVEL = 3; // алхімік рівня 3 варить удвічі швидше
export const CAULDRON_DOUBLE_LEVEL = 2; // «Казан алхіміка» II — дві порції за раз

export interface WorkshopItemDef {
  name: string; // відображувана назва предмета (ADR-0064 — мапа перейменувань)
  cost: number; // кредити за замовлення (кандидат, П11.8)
  ticks: number; // тики геосцени на виготовлення (кандидат, П11.8)
  unlockedBy?: ProjectId; // п18.2: протокол, що відкриває предмет (відсутній — протокол з тим самим id)
  trophies?: TrophyCost; // п18.2: трофеї, що списуються при замовленні разом із кредитами
  brewed?: boolean; // п22.5: варить «Казан алхіміка» (brewItem), «Кузня» не замовляє
}

// Каталог «Кузні» (ADR-0058): формат кредити / тики.
export const WORKSHOP_CATALOG: Record<ItemId, WorkshopItemDef> = {
  medkit: { name: 'Регенеративний гель', cost: 40, ticks: 12 },
  grenade: { name: 'Імпульсна граната', cost: 60, ticks: 16 },
  optics: { name: 'Кібернетичне око', cost: 50, ticks: 20 },
  armor: { name: 'Композитна броня', cost: 60, ticks: 24 },
  'gun-module': { name: 'Гарматний модуль перехоплювача', cost: 80, ticks: 32 },
  // п18.2 (ADR-0153 п. 11, ADR-0154; числа — перемір п18.6 без змін, ADR-0158)
  'breach-charge': { name: 'Пробивний заряд', cost: 50, ticks: 16, unlockedBy: 'rift-anatomy', trophies: { hound: 1 } },
  // п20.4 (ADR-0165 п. 6, 12; ADR-0168): зброя — виріб «Кузні» за своїм протоколом; не витратник
  shotgun: { name: WEAPONS.shotgun.name, cost: 60, ticks: 16 },
  sniper: { name: WEAPONS.sniper.name, cost: 70, ticks: 20 },
  mg: { name: WEAPONS.mg.name, cost: 80, ticks: 24 },
  // п22.5 (рішення власника «А. Дія + пасивний щит»; числа — кандидати, probe п22.8)
  stim: { name: 'Стимулятор', cost: 30, ticks: 12, trophies: { demon: 1 }, brewed: true },
  shield: { name: 'Щит', cost: 40, ticks: 16, trophies: { hound: 1 }, brewed: true },
};

// Предмети, які показують панелі «Кузні» і порада «Наступний крок». п18.2: «Пробивний
// заряд» — у каталозі, але в панелях до UI п18.5 не показується (рішення власника, ADR-0154).
// п20.4: без зброї «Кузні» (тип — щоб бот, «Наступний крок» і скрипти не потребували гілок зброї)
export const ITEM_IDS: Exclude<ItemId, ForgeWeaponId>[] = ['medkit', 'grenade', 'optics', 'armor', 'gun-module'];

// п18.2: чи відкрито виробництво предмета (завершено протокол unlockedBy або протокол з тим самим id).
export function itemUnlocked(research: Pick<ResearchState, 'completed'>, id: ItemId): boolean {
  const def = WORKSHOP_CATALOG[id];
  return research.completed.includes(def?.unlockedBy ?? (id as ProjectId));
}

// п18.2: предмет за ключем запису екіпірування (ключ «charge» — «Пробивний заряд»).
export function equipKeyItem(k: ItemSlot): SoldierItemId {
  return k === 'charge' ? 'breach-charge' : k;
}

// Відображувана назва предмета за ключем (журнал, панелі, throw-тексти;
// невідомий ключ — як є).
export function itemName(id: ItemId): string {
  return WORKSHOP_CATALOG[id]?.name ?? id;
}

// п19.3: назва замовлення черги «Кузні» (перехоплювач — не предмет каталогу).
export function orderName(o: Pick<WorkshopOrder, 'id'>): string {
  return o.id === 'interceptor' ? 'Перехоплювач' : itemName(o.id);
}

// Предмети, що екіпіруються на оперативника ростеру (ADR-0058). Гарматний
// модуль — озброєння перехоплювача, на оперативникові він не носиться
// (встановлення — intercept). п20.4: зброя — окремий слот (`SoldierEquipment.weapon`, equipWeapon).
export type SoldierItemId = Exclude<ItemId, 'gun-module' | ForgeWeaponId>;

// п19.3 (ADR-0159 п. 13, ADR-0161): перехоплювач — замовлення в черзі «Кузні» поруч із предметами
// (одне активне); ціна — 200 × множник науки пресета (sciencePrice), виготовлення — 48 тіків (1 доба);
// після виготовлення — в ангар обраного регіону, не на склад. Дослідження не потрібне.
export const INTERCEPTOR_COST = 200;
export const INTERCEPTOR_TICKS = 48;

export const ARMOR_MAX_HP_BONUS = 2; // «Композитна броня»: +2 maxHp (ADR-0058)
export const OPTICS_ACCURACY_BONUS = 0.05; // «Кібернетичне око»: +0.05 точності (кап 0.95, ADR-0004)

export type WorkshopEvent =
  | { type: 'order'; id: ItemId; ticks: number } // замовлення оплачено і поставлено в чергу
  | { type: 'produced'; id: ItemId } // предмет готовий → склад
  | { type: 'equip'; soldierId: string; id: SoldierItemId | ForgeWeaponId } // предмет (п20.4: і зброя) зі складу на солдата
  | { type: 'unequip'; soldierId: string; id: SoldierItemId | ForgeWeaponId } // предмет (зброя) з солдата назад на склад
  | { type: 'equipment_lost'; soldierId: string; items: ItemSlot[] } // витратники загиблого зникли (до Т.28 — усі предмети)
  | { type: 'equipment_returned'; soldierId: string; items: ('armor' | 'optics' | ForgeWeaponId)[] } // броня, око (п20.4: і зброя) загиблого — на склад (ADR-0091)
  | { type: 'gun_module_installed'; fighter?: number } // модуль зі складу на винищувач (п19.3: id — коли їх ≥ 2)
  | { type: 'gun_module_removed'; fighter?: number } // модуль з винищувача назад на склад
  | { type: 'interceptor_order'; region: RegionId; ticks: number } // п19.3: перехоплювач замовлено
  | { type: 'interceptor_produced'; fighter: number; region: RegionId } // п19.3: перехоплювач — в ангарі
  | { type: 'store_lost'; lost: Partial<Record<ItemId, number>> } // п18.4: половина складу — у програному штурмі бази
  | { type: 'brew'; id: BrewItemId; ticks: number; count: number } // п22.5: казан алхіміка — варіння почато
  | { type: 'brewed'; id: BrewItemId; count: number }; // п22.5: зварено → склад

export interface WorkshopOrder {
  id: ItemId | 'interceptor'; // п19.3: 'interceptor' — перехоплювач (region — ангар призначення)
  ticksLeft: number; // тики геосцени до готовності
  region?: RegionId; // п19.3: лише для 'interceptor'
  count?: number; // п22.5: порцій варіння казана (без поля — 1)
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
  charge?: boolean; // п18.2: «Пробивний заряд» (витратник; поле лише за наявності — сейви без нього байт-у-байт)
  stim?: boolean; // п22.5: «Стимулятор» (витратник; поле лише за наявності)
  shield?: boolean; // п22.5: «Щит» (витратник; поле лише за наявності)
  // п20.4 (ADR-0165 п. 13, ADR-0168): зброя з «Кузні»; без поля — «Гарт» (у кожного, на складі не рахується)
  weapon?: ForgeWeaponId;
}

// п20.4: слоти предметів (прапорці) — без слоту зброї.
export type ItemSlot = Exclude<keyof SoldierEquipment, 'weapon'>;

function emptyEquipment(): SoldierEquipment {
  return { armor: false, optics: false, medkit: false, grenade: false };
}

export interface WorkshopState {
  queue: WorkshopOrder[]; // черга виробництва: перше — активне замовлення
  store: Record<ItemId, number>; // склад: лічильники готових предметів
  equipped: Record<string, SoldierEquipment>; // id оперативника → екіпірування
  log: WorkshopEvent[]; // події «Кузні» для журналу (П11.6)
  brew: WorkshopOrder[]; // п22.5: черга «Казана алхіміка» (перше — активне), окрема від «Кузні»
}

// Порожній склад: усі предмети каталогу з нульовими лічильниками (мерж у сейві
// лишає валідні ключі майбутніх предметів).
export function emptyStore(): Record<ItemId, number> {
  return {
    medkit: 0,
    grenade: 0,
    optics: 0,
    armor: 0,
    'gun-module': 0,
    'breach-charge': 0,
    shotgun: 0,
    sniper: 0,
    mg: 0,
    stim: 0,
    shield: 0,
  };
}

export function createWorkshop(): WorkshopState {
  return { queue: [], store: emptyStore(), equipped: {}, log: [], brew: [] };
}

// Замовлення предмета в «Кузні» (ADR-0058): оплата кредитами ОДРУЧ при
// замовленні (недостатньо кредитів → помилка, черга не змінюється),
// предмет ставиться в кінець черги. Вимоги: предмет відомий, протокол
// завершений (дослідження відкриває виробництво). Порушення → throw
// з українським текстом, стан не змінюється. Множник пресету — лише
// на ціну; тики без множників (ADR-0033/0058).
// п22.5 (ADR-0187): тики — з «Паровим котлом» і механіком (forgeTicks, base.ts).
export function orderItem(
  econ: EconomyState,
  workshop: WorkshopState,
  research: ResearchState,
  id: ItemId,
  preset: DifficultyPreset = DEFAULT_PRESET,
  modules?: BaseModules
): WorkshopOrder {
  const def = WORKSHOP_CATALOG[id];
  if (!def) throw new Error('Невідомий предмет: ' + id);
  if (def.brewed) throw new Error('«' + def.name + '» варить «Казан алхіміка», а не «Кузня»');
  if (!itemUnlocked(research, id)) {
    throw new Error('Предмет ще не досліджено: ' + itemName(id));
  }
  // п18.2 (EARS 3): трофеї — перевірка до оплати, списання разом із кредитами
  const lack = missingTrophies(research.trophies, def.trophies);
  if (lack !== undefined) throw new Error(lack);
  spend(econ, sciencePrice(def.cost, preset));
  spendTrophies(research.trophies, def.trophies);
  const ticks = forgeTicks(def.ticks, research, modules);
  const order: WorkshopOrder = { id, ticksLeft: ticks };
  workshop.queue.push(order);
  workshop.log.push({ type: 'order', id, ticks });
  return order;
}

// п22.5 (ADR-0182 п. 13; ADR-0187): варіння витратника в «Казані алхіміка» — потрібні казан і
// алхімік рівня BREW_LEVEL у штаті; оплата кредитами й трофеями одразу; окрема черга (одне
// активне варіння). Алхімік рівня 3 — удвічі менше тиків (вгору), казан II — дві порції.
// Порушення → throw з українським текстом, стан не змінюється.
export function brewItem(
  econ: EconomyState,
  workshop: WorkshopState,
  research: ResearchState,
  modules: BaseModules,
  id: BrewItemId,
  preset: DifficultyPreset = DEFAULT_PRESET
): WorkshopOrder {
  if (!isBrewItem(id)) throw new Error('Невідомий рецепт казана: ' + String(id));
  const def = WORKSHOP_CATALOG[id];
  if (modules.cauldron < 1) throw new Error('Немає модуля «Казан алхіміка»');
  const level = bestLevel(research, 'alchemist');
  if (level === 0) throw new Error('Немає алхіміка в штаті');
  if (level < BREW_LEVEL[id]) throw new Error('«' + def.name + '» варить алхімік рівня ' + BREW_LEVEL[id]);
  const lack = missingTrophies(research.trophies, def.trophies);
  if (lack !== undefined) throw new Error(lack);
  spend(econ, sciencePrice(def.cost, preset));
  spendTrophies(research.trophies, def.trophies);
  const ticks = level >= FAST_BREW_LEVEL ? Math.ceil(def.ticks / 2) : def.ticks;
  const count = modules.cauldron >= CAULDRON_DOUBLE_LEVEL ? 2 : 1;
  const order: WorkshopOrder = { id, ticksLeft: ticks, ...(count > 1 ? { count } : {}) };
  workshop.brew.push(order);
  workshop.log.push({ type: 'brew', id, ticks, count });
  return order;
}

// п22.5: чи може штат зварити рецепт (для панелей і бота; джерело правди — brewItem).
export function canBrew(research: Pick<ResearchState, 'scientists'>, modules: BaseModules, id: BrewItemId): boolean {
  return modules.cauldron >= 1 && research.scientists.some((s) => s.spec === 'alchemist' && scientistLevel(s) >= BREW_LEVEL[id]);
}

// п19.3 (ADR-0161): перехоплювачів разом із замовленими в «Кузні» — не більше MAX_FIGHTERS.
export function interceptorCount(workshop: WorkshopState, intercept: InterceptState): number {
  return intercept.fighters.length + workshop.queue.filter((o) => o.id === 'interceptor').length;
}

// п19.3 (ADR-0159 п. 4, 13): замовлення перехоплювача в ангар регіону region — оплата одразу
// (sciencePrice, у мінус неможливо), у кінець черги; регіон — будь-який, і той, що вийшов
// (рішення власника «А. Кілька в одному»). Порушення → throw, стан не змінюється.
export function orderInterceptor(
  econ: EconomyState,
  workshop: WorkshopState,
  intercept: InterceptState,
  region: RegionId,
  preset: DifficultyPreset = DEFAULT_PRESET,
  research?: Pick<ResearchState, 'scientists'>, // п22.5: механік і котел — і для перехоплювача
  modules?: BaseModules
): WorkshopOrder {
  if (interceptorCount(workshop, intercept) >= MAX_FIGHTERS) {
    throw new Error('Перехоплювачів уже ' + MAX_FIGHTERS + ' разом із замовленими: більше не буває');
  }
  spend(econ, sciencePrice(INTERCEPTOR_COST, preset));
  const ticks = forgeTicks(INTERCEPTOR_TICKS, research, modules);
  const order: WorkshopOrder = { id: 'interceptor', ticksLeft: ticks, region };
  workshop.queue.push(order);
  workshop.log.push({ type: 'interceptor_order', region, ticks });
  return order;
}

// Тік цеху разом із геосценою (прецедент repairTick): 1 виклик = 1 тік
// геосцени. Активне замовлення (перше в черзі) добирає тик; нуль →
// предмет на склад, наступне замовлення стає активним з наступного
// тіку. Без замовлень — no-op. Детермінізм: порядок фіксований, жодного RNG.
// п19.3: готовий перехоплювач — в ангар регіону замовлення (потрібні intercept і geo; без
// замовлень перехоплювача виклик без них — як до п19.3).
export function workshopTick(workshop: WorkshopState, intercept?: InterceptState, geo?: GeoState): void {
  brewTick(workshop);
  const active = workshop.queue[0];
  if (!active) return;
  // аудит PR #522: перевірка до зміни стану — помилка не губить замовлення
  if (active.ticksLeft <= 1 && active.id === 'interceptor') {
    if (!intercept || !geo) throw new Error('workshopTick: для перехоплювача потрібні стан перехоплення і геосцена');
    if (intercept.fighters.length >= MAX_FIGHTERS) throw new Error('Перехоплювачів уже ' + MAX_FIGHTERS + ': більше не буває');
  }
  active.ticksLeft -= 1;
  if (active.ticksLeft <= 0) {
    if (active.id === 'interceptor') {
      workshop.queue.shift();
      const f = addFighter(intercept!, geo!, active.region!);
      workshop.log.push({ type: 'interceptor_produced', fighter: f.id, region: f.region });
      return;
    }
    workshop.queue.shift();
    workshop.store[active.id] += 1;
    workshop.log.push({ type: 'produced', id: active.id });
  }
}

// п22.5: тік казана — той самий виклик, що й «Кузня»; окрема черга не чекає на «Кузню».
function brewTick(workshop: WorkshopState): void {
  const active = workshop.brew[0];
  if (!active) return;
  active.ticksLeft -= 1;
  if (active.ticksLeft > 0) return;
  workshop.brew.shift();
  const id = active.id as BrewItemId;
  const count = active.count ?? 1;
  workshop.store[id] += count;
  workshop.log.push({ type: 'brewed', id, count });
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
  if (isForgeWeapon(id)) return equipWeapon(workshop, soldier, id); // п20.4: зброя — свій слот
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
  if (isForgeWeapon(id)) {
    // п20.4: зняти зброю — повернути «Гарт»
    if (workshop.equipped[soldier.id]?.weapon !== id) throw new Error('Зброї немає в оперативника: ' + itemName(id));
    return equipWeapon(workshop, soldier, 'rifle');
  }
  const soldierId = SoldierItemIdOf(id);
  const eq = workshop.equipped[soldier.id];
  if (!eq || !eq[soldierId]) {
    throw new Error('Предмета немає на оперативникові: ' + itemName(id));
  }
  if (soldierId === 'charge' || soldierId === 'stim' || soldierId === 'shield')
    delete eq[soldierId]; // п18.2, п22.5: поле витратника — лише за наявності (аудит PR #513)
  else eq[soldierId] = false;
  workshop.store[id] += 1;
  if (soldierId === 'armor') {
    soldier.maxHp -= ARMOR_MAX_HP_BONUS;
    soldier.hp = Math.min(soldier.hp, soldier.maxHp);
  }
  if (soldierId === 'optics') {
    soldier.firingAccuracy -= OPTICS_ACCURACY_BONUS;
  }
  // порожній запис екіпірування не тримаємо (чистий стан у сейві)
  if (isEmptyEquipment(eq)) {
    delete workshop.equipped[soldier.id];
  }
  workshop.log.push({ type: 'unequip', soldierId: soldier.id, id });
}

// п20.4 (ADR-0165 п. 6, 13; ADR-0168): видати оперативникові зброю — «Гарт» (rifle) завжди є,
// решта — зі складу «Кузні». Попередня зброя з «Кузні» повертається на склад; зброя оперативника
// (`Unit.weapon`, яку бере бій і зберігає сейв) — об'єкт каталогу WEAPONS. Та сама зброя — throw,
// стан не змінюється. Події — ті самі `equip` / `unequip`, що в предметів (журнал «Кузні»).
export function equipWeapon(workshop: WorkshopState, soldier: Unit, id: WeaponId): void {
  if (!Object.prototype.hasOwnProperty.call(WEAPONS, id)) throw new Error('Невідома зброя: ' + id);
  const eq = equipmentOf(workshop, soldier.id);
  const current: WeaponId = eq.weapon ?? 'rifle';
  if (current === id) throw new Error('Ця зброя вже в оперативника: ' + WEAPONS[id].name);
  if (id !== 'rifle' && workshop.store[id] <= 0) throw new Error('Зброї немає на складі: ' + WEAPONS[id].name);
  if (current !== 'rifle') {
    workshop.store[current] += 1;
    workshop.log.push({ type: 'unequip', soldierId: soldier.id, id: current });
  }
  if (id === 'rifle') delete eq.weapon;
  else {
    workshop.store[id] -= 1;
    eq.weapon = id;
    workshop.log.push({ type: 'equip', soldierId: soldier.id, id });
  }
  soldier.weapon = WEAPONS[id];
  if (isEmptyEquipment(eq)) delete workshop.equipped[soldier.id];
  else workshop.equipped[soldier.id] = eq;
}

// Спорядження загиблого (Т.28, ADR-0091; змінює П11.3, ADR-0058): броня й око
// повертаються на склад (подія equipment_returned), витратники — гель і
// граната — зникають разом з оперативником (подія equipment_lost). Запис
// екіпірування вилучається. Порядок предметів у подіях — порядок ключів запису.
// Викликає шар застосунку після applyMissionResult з aftermath.lost.
export function removeLostEquipment(workshop: WorkshopState, lost: Unit[]): void {
  for (const soldier of lost) {
    const eq = workshop.equipped[soldier.id];
    if (!eq) continue;
    const items = (Object.keys(eq) as (keyof SoldierEquipment)[]).filter((k): k is ItemSlot => k !== 'weapon' && eq[k] === true);
    const returned: ('armor' | 'optics' | ForgeWeaponId)[] = items.filter((k): k is 'armor' | 'optics' => k === 'armor' || k === 'optics');
    if (eq.weapon !== undefined) returned.push(eq.weapon); // п20.4: зброя загиблого — на склад, як броня
    const gone = items.filter((k) => k === 'medkit' || k === 'grenade' || k === 'charge' || k === 'stim' || k === 'shield');
    delete workshop.equipped[soldier.id];
    for (const k of returned) workshop.store[k] += 1;
    if (returned.length > 0) workshop.log.push({ type: 'equipment_returned', soldierId: soldier.id, items: returned });
    if (gone.length > 0) workshop.log.push({ type: 'equipment_lost', soldierId: soldier.id, items: gone });
  }
}

// Порожній запис екіпірування (не тримаємо в сейві).
function isEmptyEquipment(eq: SoldierEquipment): boolean {
  return !eq.armor && !eq.optics && !eq.medkit && !eq.grenade && !eq.charge && !eq.stim && !eq.shield && eq.weapon === undefined;
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
// п19.3: модуль — на кожен перехоплювач окремо (fighterId; без нього — перший).
function moduleTag(intercept: InterceptState, id: number): { fighter?: number } {
  return intercept.fighters.length >= 2 ? { fighter: id } : {};
}

export function installGunModule(workshop: WorkshopState, intercept: InterceptState, fighterId?: number): void {
  const f = fighterById(intercept, fighterId);
  if (f.status !== 'на базі') {
    throw new Error('Модуль встановлюється лише ' + baseWhere(f) + ': перехоплювач у польоті');
  }
  if (f.gunModule) {
    throw new Error('Гарматний модуль перехоплювача уже встановлено');
  }
  if (workshop.store['gun-module'] <= 0) {
    throw new Error('Предмета немає на складі: Гарматний модуль перехоплювача');
  }
  workshop.store['gun-module'] -= 1;
  f.gunModule = true;
  workshop.log.push({ type: 'gun_module_installed', ...moduleTag(intercept, f.id) });
}

export function removeGunModule(workshop: WorkshopState, intercept: InterceptState, fighterId?: number): void {
  const f = fighterById(intercept, fighterId);
  if (f.status !== 'на базі') {
    throw new Error('Модуль знімається лише ' + baseWhere(f) + ': перехоплювач у польоті');
  }
  if (!f.gunModule) {
    throw new Error('Гарматний модуль перехоплювача не встановлено');
  }
  f.gunModule = false;
  workshop.store['gun-module'] += 1;
  workshop.log.push({ type: 'gun_module_removed', ...moduleTag(intercept, f.id) });
}

// П11.4 (ADR-0058): витратники загону на місію — копія екіпірування в стан
// бою (id солдата → предмети). Ядро бою не знає про ростер/склад: список
// для GameState.items готує цех, дії списують прапорці вже у копії.
// Детермінізм: порядок фіксований за загоном, жодного RNG.
export function deployConsumables(workshop: WorkshopState, squad: Unit[]): Record<string, UnitItems> {
  const items: Record<string, UnitItems> = {};
  for (const soldier of squad) {
    const eq = workshop.equipped[soldier.id];
    if (eq?.medkit || eq?.grenade || eq?.charge || eq?.stim || eq?.shield) {
      items[soldier.id] = { medkit: eq.medkit, grenade: eq.grenade };
      if (eq.charge) items[soldier.id].charge = true; // п18.2: поле лише за наявності заряду
      if (eq.stim) items[soldier.id].stim = true; // п22.5
      if (eq.shield) items[soldier.id].shield = true; // п22.5
    }
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
    if (items?.[soldier.id]?.charge) eq.charge = true;
    else delete eq.charge; // п18.2: витрачений заряд зникає
    // п22.5: використаний стимулятор / щит зникає, невикористаний лишається, як граната
    if (items?.[soldier.id]?.stim) eq.stim = true;
    else delete eq.stim;
    if (items?.[soldier.id]?.shield) eq.shield = true;
    else delete eq.shield;
    if (isEmptyEquipment(eq)) delete workshop.equipped[soldier.id];
  }
}

// Ключ запису екіпірування за предметом каталогу (гарматний модуль відсіюється
// guard'ом у equipItem/unequipItem — звуження типу до SoldierItemId).
export function SoldierItemIdOf(id: SoldierItemId): ItemSlot {
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
      return 'charge';
    case 'stim':
      return 'stim';
    case 'shield':
      return 'shield';
  }
}
