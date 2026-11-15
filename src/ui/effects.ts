// П12.5 (Фаза 12, ADR-0065): зрозумілість розвитку — числові ефекти ДО дії.
// Хелпер шару відображення (ADR-0037): будує рядки «зараз → стане» і механіки
// витратників із КОНСТАНТ каталогів ядра (ADR-0058) — одне місце правди,
// текст ефекту не дублює числа руками. Ядро лише читається (ADR-0002);
// детермінізм: жодного RNG, усе відображення констант.

import { GRENADE_AP_COST, GRENADE_DAMAGE, GRENADE_RANGE, HEAL_AP_COST, HEAL_AMOUNT, HIT_CHANCE_CAP, type Unit } from '../core/combat';
import { BASE_LAB_SLOTS, MAX_LAB_SLOTS, type ProjectId } from '../core/research';
import { ARMOR_MAX_HP_BONUS, OPTICS_ACCURACY_BONUS, type ItemId } from '../core/workshop';
import { GUN_MODULE_DAMAGE } from '../core/intercept';

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
  }
}

// Ефект предмета «Кузні» ДО замовлення (механіка витратників — у підказках).
export function itemEffect(id: ItemId, soldier?: Unit): string {
  return projectEffect(id, soldier);
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
  }
}
