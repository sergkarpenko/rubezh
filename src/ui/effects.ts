// П12.5 (Фаза 12, ADR-0065): зрозумілість розвитку — числові ефекти ДО дії.
// Хелпер шару відображення (ADR-0037): будує рядки «зараз → стане» і механіки
// витратників із КОНСТАНТ каталогів ядра (ADR-0058) — одне місце правди,
// текст ефекту не дублює числа руками. Ядро лише читається (ADR-0002);
// детермінізм: жодного RNG, усе відображення констант.

import {
  GRENADE_AP_COST,
  GRENADE_DAMAGE,
  GRENADE_RANGE,
  HEAL_AP_COST,
  HEAL_AMOUNT,
  HIT_CHANCE_CAP,
  STIM_AP_BONUS,
  type ShotMode,
  type Unit,
} from '../core/combat';
import {
  BASE_LAB_SLOTS,
  BASE_SQUAD_SIZE,
  MAX_LAB_SLOTS,
  RADAR_RANGE_BASE,
  RADAR_RANGE_WIDE,
  SQUAD_PROJECTS,
  type KeyProjectId,
  type ProjectId,
  type SquadProjectId,
} from '../core/research';
import { ARMOR_MAX_HP_BONUS, OPTICS_ACCURACY_BONUS, type ItemId } from '../core/workshop';
import { GUN_MODULE_DAMAGE } from '../core/intercept';
import { isForgeWeapon, WEAPONS, type ForgeWeaponId, type WeaponId } from '../core/weapons';

// Частка у відсотках: 0.05 → «5%», 0.95 → «95%».
export function pct(x: number): string {
  return Math.round(x * 100) + '%';
}

// «Композитна броня»: +N макс. HP; з поточним maxHp оперативника — «(10 → 12)».
export function armorEffect(currentMaxHp?: number): string {
  const base = '+' + ARMOR_MAX_HP_BONUS + ' макс. HP';
  return currentMaxHp === undefined ? base : base + ' (' + currentMaxHp + ' → ' + (currentMaxHp + ARMOR_MAX_HP_BONUS) + ')';
}

// «Кібернетичне око»: +5% точності з капом; з поточною точністю — «(60% → 65%)».
export function opticsEffect(currentAccuracy?: number): string {
  const base = '+' + pct(OPTICS_ACCURACY_BONUS) + ' точності';
  const cap = ' (кап ' + pct(HIT_CHANCE_CAP) + ')';
  if (currentAccuracy === undefined) return base + cap;
  return base + ' (' + pct(currentAccuracy) + ' → ' + pct(Math.min(HIT_CHANCE_CAP, currentAccuracy + OPTICS_ACCURACY_BONUS)) + ')' + cap;
}

// «Регенеративний гель» (витратник): лікує +3 HP (4 AP), ціль поруч, по одній на місцію.
export function medkitEffect(): string {
  return 'лікує +' + HEAL_AMOUNT + ' HP (' + HEAL_AP_COST + ' AP), по одній на місію';
}

// «Імпульсна граната» (витратник): пошкодження 3–5, дальність 6, зона хреста,
// уражає і своїх, 4 AP, по одній на місію.
export function grenadeEffect(): string {
  return (
    'пошкодження ' +
    GRENADE_DAMAGE[0] +
    '–' +
    GRENADE_DAMAGE[1] +
    ' · дальність ' +
    GRENADE_RANGE +
    ' · зона хреста · уражає і своїх · ' +
    GRENADE_AP_COST +
    ' AP · по одній на місію'
  );
}

// «Розширення лабораторії»: слоти 2 → 3 (константи research.ts).
export function labSlotsEffect(): string {
  const n = MAX_LAB_SLOTS - BASE_LAB_SLOTS;
  return (
    '+' + n + ' слот' + (n === 1 ? '' : n < 5 ? 'и' : 'ів') + ' лабораторії техномагії (' + BASE_LAB_SLOTS + ' → ' + MAX_LAB_SLOTS + ')'
  );
}

// «Гарматний модуль перехоплювача»: +2 пошкодження за раунд повітряного бою (intercept.ts).
export function gunModuleEffect(): string {
  return '+' + GUN_MODULE_DAMAGE + ' пошкодження за раунд повітряного бою';
}

// п22.4 (ADR-0186, рішення власника «Як у кандидатах»): «Загін — 4 бійці замість 3» /
// «Загін — 5 бійців замість 4» — числа з порядку SQUAD_PROJECTS і BASE_SQUAD_SIZE.
export function squadProjectEffect(id: SquadProjectId): string {
  const n = BASE_SQUAD_SIZE + SQUAD_PROJECTS.findIndex((p) => p.id === id) + 1;
  return 'Загін — ' + n + (n < 5 ? ' бійці' : ' бійців') + ' замість ' + (n - 1);
}

// Ефект протоколу дослідження ДО старту; soldier — звідки береться «зараз»
// для покращень ростеру (перший оперативник загону; без ростеру — без «→»).
export function projectEffect(id: ProjectId, soldier?: Unit): string {
  switch (id) {
    case 'armor':
      return armorEffect(soldier?.maxHp);
    case 'optics':
      return opticsEffect(soldier?.firingAccuracy);
    case 'medkit':
      return medkitEffect();
    case 'grenade':
      return grenadeEffect();
    case 'lab-extension':
      return labSlotsEffect();
    case 'gun-module':
      return gunModuleEffect();
    case 'tac-net-1':
    case 'tac-net-2':
      return squadProjectEffect(id);
    default:
      return keyProjectEffect(id);
  }
}

// п18.2 (рішення власника «А. Повні», ADR-0154): ефекти ключових протоколів і заряду.
// Показ у панелях — UI п18.5 (до нього ключові протоколи й заряд у панелях сховано).
export const KEY_PROJECT_EFFECTS: Record<KeyProjectId, string> = {
  'rift-anatomy': 'Відкриває «Пробивний заряд» у «Кузні»',
  'gate-bearing': 'Радар вузла — ' + RADAR_RANGE_WIDE + ' клітинок замість ' + RADAR_RANGE_BASE,
  'gate-key': 'Відкриває «Браму Розриву» і дві турелі бази',
};
export const BREACH_CHARGE_EFFECT = 'Атака по броньованій цілі — без броні (один раз)';

// п20.4 (ADR-0168): ефект протоколу й виробу зброї — числа з каталогу WEAPONS (weapons.ts); режим — єдиний (`only`).
const WEAPON_MODE_NAMES: Record<ShotMode, string> = { snap: '«Швидкий»', aimed: '«Прицільний»', auto: '«Черга»' };
export function weaponEffect(id: WeaponId): string {
  const w = WEAPONS[id];
  const m = w.only?.[0];
  const mode =
    m === undefined
      ? 'усі три режими'
      : 'лише ' +
        WEAPON_MODE_NAMES[m] +
        ' — ' +
        w.modes[m].apCost +
        ' AP, ×' +
        String(w.modes[m].accuracyMod).replace('.', ',') +
        (w.modes[m].shots > 1 ? ', ' + w.modes[m].shots + ' кулі' : '');
  return 'Шкода ' + w.damage[0] + '–' + w.damage[1] + ', дальність ' + w.range + '; ' + mode;
}

function keyProjectEffect(id: KeyProjectId | ForgeWeaponId): string {
  return isForgeWeapon(id) ? weaponEffect(id) : KEY_PROJECT_EFFECTS[id];
}

// Ефект предмета «Кузні» ДО замовлення (механіка витратників — у підказках).
// п22.5 (ADR-0187): витратники казана — тексти до UI п22.7 (числа з констант ядра).
export const STIM_EFFECT = 'Дія без AP: +' + STIM_AP_BONUS + ' AP цього ходу; один на бій';
export const SHIELD_EFFECT = 'Сам поглинає перше влучання будь-якої шкоди; один на бій';
// п22.7 (ADR-0189, рішення власника «А. «Еліксир чемпіона»»): обидва ефекти в одному витратнику
export const ELIXIR_EFFECT = '«Стимулятор» (+' + STIM_AP_BONUS + ' AP за 0 AP) і «Щит» разом; один на бій';
export function itemEffect(id: ItemId, soldier?: Unit): string {
  if (id === 'stim') return STIM_EFFECT;
  if (id === 'shield') return SHIELD_EFFECT;
  if (id === 'elixir') return ELIXIR_EFFECT;
  return id === 'breach-charge' ? BREACH_CHARGE_EFFECT : projectEffect(id, soldier);
}

// T.39: «простий» текст ефекту для картки протоколу в панелі «Дослідження»
// (тексти затверджені в плані Т.39): числа — з тих самих констант ядра;
// «зараз → стане» — від першого оперативника загону (як у projectEffect),
// без ростеру — без порівняння.
const NUM_NOM: Record<number, string> = { 1: 'Один', 2: 'Два', 3: 'Три', 4: 'Чотири', 5: "П'ять" };
const NUM_GEN: Record<number, string> = { 1: 'одного', 2: 'двох', 3: 'трьох', 4: 'чотирьох', 5: "п'ятьох" };

export function plainProjectEffect(id: ProjectId, soldier?: Unit): string {
  switch (id) {
    case 'armor':
      return soldier === undefined
        ? 'Оперативник у броні має +' + ARMOR_MAX_HP_BONUS + ' HP'
        : 'Оперативник у броні має ' + (soldier.maxHp + ARMOR_MAX_HP_BONUS) + ' HP замість ' + soldier.maxHp;
    case 'optics':
      return soldier === undefined
        ? 'Точність оперативника з оком — +' + Math.round(OPTICS_ACCURACY_BONUS * 100) + ' %'
        : 'Точність оперативника з оком — ' +
            Math.round(Math.min(HIT_CHANCE_CAP, soldier.firingAccuracy + OPTICS_ACCURACY_BONUS) * 100) +
            ' % замість ' +
            Math.round(soldier.firingAccuracy * 100) +
            ' %';
    case 'medkit':
      return 'Лікує ' + HEAL_AMOUNT + ' HP за ' + HEAL_AP_COST + ' AP; одна штука на місію';
    case 'grenade':
      return (
        'Пошкодження ' + GRENADE_DAMAGE[0] + '–' + GRENADE_DAMAGE[1] + ' у зоні хреста, дальність ' + GRENADE_RANGE + '; зачіпає і своїх'
      );
    case 'lab-extension':
      return NUM_NOM[MAX_LAB_SLOTS] + ' протоколи в роботі одночасно замість ' + NUM_GEN[BASE_LAB_SLOTS];
    case 'gun-module':
      return 'Перехоплювач завдає на ' + GUN_MODULE_DAMAGE + ' пошкодження більше за раунд';
    case 'tac-net-1':
    case 'tac-net-2':
      return squadProjectEffect(id);
    default:
      return keyProjectEffect(id);
  }
}
