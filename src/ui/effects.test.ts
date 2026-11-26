// @vitest-environment jsdom
// П12.5 (Фаза 12, ADR-0065/0058): тести хелпера числових ефектів
// (src/ui/effects.ts). Критерій кроку (1): кожен протокол/предмет показує
// ефект числами до дії. Числа в твердженнях — з ТИХ САМИХ констант каталогів
// (import, не дублі руками) — одне місце правди (ADR-0065).
import { describe, expect, it } from 'vitest';
import {
  GRENADE_AP_COST,
  GRENADE_DAMAGE,
  GRENADE_RANGE,
  HEAL_AP_COST,
  HEAL_AMOUNT,
  HIT_CHANCE_CAP,
  makeUnit,
  type Unit,
} from '../core/combat';
import { BASE_LAB_SLOTS, MAX_LAB_SLOTS, PROJECTS } from '../core/research';
import { ITEM_IDS, ARMOR_MAX_HP_BONUS, OPTICS_ACCURACY_BONUS } from '../core/workshop';
import { GUN_MODULE_DAMAGE } from '../core/intercept';
import {
  armorEffect,
  grenadeEffect,
  gunModuleEffect,
  itemEffect,
  labSlotsEffect,
  medkitEffect,
  opticsEffect,
  pct,
  plainProjectEffect,
  projectEffect,
} from './effects';

// Солдат з довільними статами — для «зараз → стане».
function soldier(maxHp: number, firingAccuracy: number): Unit {
  return makeUnit({ id: 's1', side: 'player', pos: { x: 0, y: 0 }, maxHp, hp: maxHp, firingAccuracy });
}

describe('effects: формати чисел з констант', () => {
  it('pct: частка → відсотки (5%, 95%)', () => {
    expect(pct(OPTICS_ACCURACY_BONUS)).toBe('5%');
    expect(pct(HIT_CHANCE_CAP)).toBe('95%');
  });

  it('броня: +N макс. HP; з поточним maxHp — «(10 → 12)»', () => {
    expect(armorEffect()).toBe('+' + ARMOR_MAX_HP_BONUS + ' макс. HP');
    expect(armorEffect(10)).toBe('+2 макс. HP (10 → 12)');
    expect(armorEffect(10)).toBe('+' + ARMOR_MAX_HP_BONUS + ' макс. HP (10 → ' + (10 + ARMOR_MAX_HP_BONUS) + ')');
  });

  it('оптика: +5% точності з капом; з поточною — «(60% → 65%)», на капі — 95%', () => {
    expect(opticsEffect()).toBe('+5% точності (кап ' + pct(HIT_CHANCE_CAP) + ')');
    expect(opticsEffect(0.6)).toBe('+5% точності (60% → 65%) (кап 95%)');
    expect(opticsEffect(0.93)).toBe('+5% точності (93% → 95%) (кап 95%)'); // клемується капом
  });

  it('аптечка: +N HP (M AP), по одній на місію — числа з combat.ts', () => {
    expect(medkitEffect()).toBe('лікує +' + HEAL_AMOUNT + ' HP (' + HEAL_AP_COST + ' AP), по одній на місію');
  });

  it('граната: пошкодження 3–5, дальність, зона хреста, уражає і своїх, AP — числа з combat.ts', () => {
    expect(grenadeEffect()).toContain('пошкодження ' + GRENADE_DAMAGE[0] + '–' + GRENADE_DAMAGE[1]);
    expect(grenadeEffect()).toContain('дальність ' + GRENADE_RANGE);
    expect(grenadeEffect()).toContain('зона хреста');
    expect(grenadeEffect()).toContain('уражає і своїх');
    expect(grenadeEffect()).toContain(GRENADE_AP_COST + ' AP');
    expect(grenadeEffect()).toContain('по одній на місію');
  });

  it('розширення лабораторії: слоти з констант research.ts (2 → 3)', () => {
    expect(labSlotsEffect()).toBe('+1 слот лабораторії техномагії (' + BASE_LAB_SLOTS + ' → ' + MAX_LAB_SLOTS + ')');
  });

  it('гарматний модуль: +N пошкодження за раунд — з intercept.ts', () => {
    expect(gunModuleEffect()).toBe('+' + GUN_MODULE_DAMAGE + ' пошкодження за раунд повітряного бою');
  });
});

describe('effects: диспетчери каталогів', () => {
  it('projectEffect: ефект для КОЖНОГО протоколу каталогу (критерій 1)', () => {
    for (const def of PROJECTS) {
      expect(projectEffect(def.id, soldier(10, 0.6))).not.toBe('');
    }
    expect(projectEffect('armor', soldier(10, 0.6))).toBe(armorEffect(10));
    expect(projectEffect('optics', soldier(10, 0.6))).toBe(opticsEffect(0.6));
    expect(projectEffect('medkit')).toBe(medkitEffect());
    expect(projectEffect('grenade')).toBe(grenadeEffect());
    expect(projectEffect('lab-extension')).toBe(labSlotsEffect());
    expect(projectEffect('gun-module')).toBe(gunModuleEffect());
  });

  it('itemEffect: ефект для КОЖНОГО предмета цеху (критерій 1)', () => {
    for (const id of ITEM_IDS) {
      expect(itemEffect(id, soldier(10, 0.6))).not.toBe('');
    }
    expect(itemEffect('armor')).toBe(armorEffect(undefined));
  });
});

describe('T.39: plainProjectEffect — текст картки протоколу в панелі «Дослідження»', () => {
  it('броня/око: «має X HP замість Y» / «… % замість … %» від солдата; числа з констант', () => {
    expect(plainProjectEffect('armor', soldier(10, 0.6))).toBe('Оперативник у броні має ' + (10 + ARMOR_MAX_HP_BONUS) + ' HP замість 10');
    expect(plainProjectEffect('optics', soldier(10, 0.6))).toBe(
      'Точність оперативника з оком — ' + Math.round(Math.min(HIT_CHANCE_CAP, 0.6 + OPTICS_ACCURACY_BONUS) * 100) + ' % замість 60 %'
    );
  });

  it('стеля точності ока: оперативник із 93 % -> 95 % (кап HIT_CHANCE_CAP)', () => {
    expect(plainProjectEffect('optics', soldier(10, 0.93))).toBe(
      'Точність оперативника з оком — ' + Math.round(HIT_CHANCE_CAP * 100) + ' % замість ' + Math.round(0.93 * 100) + ' %'
    );
  });

  it('без солдата — без порівняння («замість» немає)', () => {
    expect(plainProjectEffect('armor')).toBe('Оперативник у броні має +' + ARMOR_MAX_HP_BONUS + ' HP');
    expect(plainProjectEffect('optics')).not.toContain('замість');
  });

  it('гель/граната/лаб/модуль — тексти за планом, числа з констант', () => {
    expect(plainProjectEffect('medkit')).toBe('Лікує ' + HEAL_AMOUNT + ' HP за ' + HEAL_AP_COST + ' AP; одна штука на місію');
    expect(plainProjectEffect('grenade')).toBe(
      'Пошкодження ' + GRENADE_DAMAGE[0] + '–' + GRENADE_DAMAGE[1] + ' у зоні хреста, дальність ' + GRENADE_RANGE + '; зачіпає і своїх'
    );
    expect(plainProjectEffect('lab-extension')).toBe('Три протоколи в роботі одночасно замість двох'); // NUM_NOM[MAX_LAB_SLOTS]/NUM_GEN[BASE_LAB_SLOTS]
    expect(plainProjectEffect('gun-module')).toBe('Перехоплювач завдає на ' + GUN_MODULE_DAMAGE + ' пошкодження більше за раунд');
  });
});

describe('п18.2 (ADR-0154, рішення власника «А. Повні»): ефекти ключових протоколів і заряду', () => {
  it('тексти дослівно; обидві функції ефекту протоколу — однаково', () => {
    const want = {
      'rift-anatomy': 'Відкриває «Пробивний заряд» у «Кузні»',
      'gate-bearing': 'Радар вузла — 6 клітинок замість 4',
      'gate-key': 'Відкриває «Браму Розриву» і дві турелі бази',
    } as const;
    for (const [id, text] of Object.entries(want) as [keyof typeof want, string][]) {
      expect(projectEffect(id)).toBe(text);
      expect(plainProjectEffect(id)).toBe(text);
    }
    expect(itemEffect('breach-charge')).toBe('Атака по броньованій цілі — без броні (один раз)');
  });
});
