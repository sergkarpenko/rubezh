// src/core/workshop.test.ts
// П11.3 (Фаза 11): тести ядра «Цех і склад» (ADR-0058).
// ADR-0003: детермінізм — жодного RNG у цеху; тести з фіксованим станом.
// Інваріант ізоляції: workshopTick не витягує geo.rng — траєкторія
// геосцени з цехом і без нього байт-у-байт однакова (критерій П11.3).
// Числа балансу — кандидати П11.8: тести фіксують механіку, не твердження
// про баланс. Інтеграція стану у Party/сейв — у save.test.ts.

import { describe, expect, it } from 'vitest';
import { advanceTime, createGeoGame, geoTick, type GeoState } from './geo';
import type { StatefulRng } from './combat';
import { createResearch, type ResearchState } from './research';
import { createWorkshop, emptyStore, orderItem, WORKSHOP_CATALOG, workshopTick } from './workshop';
import {
  ARMOR_MAX_HP_BONUS,
  OPTICS_ACCURACY_BONUS,
  equipItem,
  installGunModule,
  removeGunModule,
  removeLostEquipment,
  unequipItem,
  type WorkshopState,
} from './workshop';
import type { EconomyState } from './economy';
import { makeSoldier } from './mission';
import { createRoster, missionSquad, type Roster } from './squad';
import { createIntercept } from './intercept';

// Геосцена без НЛО, щоб тести не залежали від спавну (прецедент research.test.ts).
function geoNoUfo(seed = 7): GeoState {
  return createGeoGame({ seed, spawnChance: 0, maxUfos: 0 });
}

// Економіка з великим балансом — тести замовлень не про банкрутство.
function richEcon(money = 5000): EconomyState {
  return { money, lastAllowanceDay: 0, log: [] };
}

// Наука із завершеним проєктом «аптечка» (гейт виробництва — П11.3).
function researchWith(...completed: ResearchState['completed']): ResearchState {
  return { ...createResearch(), completed };
}

describe('createWorkshop', () => {
  it('порожній цех: без черги, усі лічильники складу нульові', () => {
    const workshop = createWorkshop();
    expect(workshop.queue).toEqual([]);
    expect(workshop.store).toEqual(emptyStore());
    expect(workshop.log).toEqual([]);
  });
});

describe('замовлення (ADR-0058: оплата при замовленні, гейт дослідження)', () => {
  it('замовлення списує ціну, ставить в кінець черги, подія в журналі', () => {
    const econ = richEcon();
    const workshop = createWorkshop();
    const order = orderItem(econ, workshop, researchWith('аптечка'), 'аптечка');
    expect(econ.money).toBe(5000 - WORKSHOP_CATALOG['аптечка'].cost);
    expect(order).toEqual({ id: 'аптечка', ticksLeft: WORKSHOP_CATALOG['аптечка'].ticks });
    expect(workshop.queue).toEqual([order]);
    expect(workshop.log).toEqual([{ type: 'order', id: 'аптечка', ticks: WORKSHOP_CATALOG['аптечка'].ticks }]);
  });

  it('не досліджений предмет — throw, гроші й черга не змінюються', () => {
    const econ = richEcon();
    const workshop = createWorkshop();
    expect(() => orderItem(econ, workshop, createResearch(), 'аптечка')).toThrow('Предмет ще не досліджено: аптечка');
    expect(econ.money).toBe(5000);
    expect(workshop.queue).toEqual([]);
    expect(workshop.log).toEqual([]);
  });

  it('невідомий предмет — throw українською', () => {
    const econ = richEcon();
    const workshop = createWorkshop();
    expect(() => orderItem(econ, workshop, researchWith(), 'фотонна гармата' as never)).toThrow('Невідомий предмет');
  });

  it('недостатньо грошей — throw черги не змінюється (spend, у мінус неможливо)', () => {
    const econ = richEcon(10);
    const workshop = createWorkshop();
    expect(() => orderItem(econ, workshop, researchWith('аптечка'), 'аптечка')).toThrow('Недостатньо грошей');
    expect(workshop.queue).toEqual([]);
  });

  it('множник пресету діє на ціну, тики — без множників (ADR-0033/0058)', () => {
    const econ = richEcon();
    const workshop = createWorkshop();
    orderItem(econ, workshop, researchWith('аптечка'), 'аптечка', 'складний');
    expect(econ.money).toBe(5000 - Math.round(WORKSHOP_CATALOG['аптечка'].cost * 0.9));
    expect(workshop.queue[0].ticksLeft).toBe(WORKSHOP_CATALOG['аптечка'].ticks);
  });

  it('друге замовлення стає в кінець черги (одне активне — ADR-0058)', () => {
    const econ = richEcon();
    const workshop = createWorkshop();
    const research = researchWith('аптечка', 'легка броня');
    orderItem(econ, workshop, research, 'аптечка');
    orderItem(econ, workshop, research, 'легка броня');
    expect(workshop.queue.map((o) => o.id)).toEqual(['аптечка', 'легка броня']);
  });
});

describe('тик виробництва (1 виклик = 1 тік геосцени)', () => {
  it('без замовлень — no-op', () => {
    const workshop = createWorkshop();
    workshopTick(workshop);
    expect(workshop.queue).toEqual([]);
    expect(workshop.store).toEqual(emptyStore());
    expect(workshop.log).toEqual([]);
  });

  it('тик зменшує лічильник активного замовлення', () => {
    const econ = richEcon();
    const workshop = createWorkshop();
    orderItem(econ, workshop, researchWith('аптечка'), 'аптечка');
    workshopTick(workshop);
    expect(workshop.queue[0].ticksLeft).toBe(WORKSHOP_CATALOG['аптечка'].ticks - 1);
    expect(workshop.store['аптечка']).toBe(0);
  });

  it('виготовлення: предмет на склад, подія в журналі, черга порожніє', () => {
    const econ = richEcon();
    const workshop = createWorkshop();
    orderItem(econ, workshop, researchWith('аптечка'), 'аптечка');
    for (let i = 0; i < WORKSHOP_CATALOG['аптечка'].ticks; i++) workshopTick(workshop);
    expect(workshop.queue).toEqual([]);
    expect(workshop.store['аптечка']).toBe(1);
    expect(workshop.log.at(-1)).toEqual({ type: 'produced', id: 'аптечка' });
  });

  it('чергу веде лише активне замовлення; наступне стартує з наступного тіку', () => {
    const econ = richEcon();
    const workshop = createWorkshop();
    const research = researchWith('аптечка', 'легка броня');
    orderItem(econ, workshop, research, 'аптечка'); // 12 тиків
    orderItem(econ, workshop, research, 'легка броня'); // 24 тики
    const total = WORKSHOP_CATALOG['аптечка'].ticks + WORKSHOP_CATALOG['легка броня'].ticks;
    for (let i = 0; i < total; i++) workshopTick(workshop);
    expect(workshop.store).toEqual({ ...emptyStore(), аптечка: 1, 'легка броня': 1 });
    // на тік раніше броня ще не готова: активне замовлення стартує після здачі попереднього
    const workshop2 = createWorkshop();
    orderItem(richEcon(), workshop2, research, 'аптечка');
    orderItem(richEcon(), workshop2, research, 'легка броня');
    for (let i = 0; i < total - 1; i++) workshopTick(workshop2);
    expect(workshop2.store['аптечка']).toBe(1);
    expect(workshop2.store['легка броня']).toBe(0);
    expect(workshop2.queue[0].ticksLeft).toBe(1);
  });

  it('склад накопичує кілька предметів того самого типу', () => {
    const econ = richEcon();
    const workshop = createWorkshop();
    const research = researchWith('аптечка');
    orderItem(econ, workshop, research, 'аптечка');
    orderItem(econ, workshop, research, 'аптечка');
    for (let i = 0; i < WORKSHOP_CATALOG['аптечка'].ticks * 2; i++) workshopTick(workshop);
    expect(workshop.store['аптечка']).toBe(2);
  });
});

describe('ізоляція від геосцени (критерій П11.3: geo.rng не витягується)', () => {
  it('траєкторія геосцени з цехом і без нього — байт-у-байт однакова', () => {
    const withWorkshop = geoNoUfo(42);
    const withoutWorkshop = geoNoUfo(42);
    const econ = richEcon();
    const workshop = createWorkshop();
    orderItem(econ, workshop, researchWith('аптечка'), 'аптечка');
    for (let i = 0; i < 120; i++) {
      geoTick(withWorkshop);
      geoTick(withoutWorkshop);
      workshopTick(workshop);
    }
    expect(JSON.stringify(withWorkshop.log)).toBe(JSON.stringify(withoutWorkshop.log));
    expect(withWorkshop.minute).toBe(withoutWorkshop.minute);
    expect((withWorkshop.rng as StatefulRng).state).toBe((withoutWorkshop.rng as StatefulRng).state);
    // 120 тиків: замовлення здано (12 тиків), склад наповнений
    expect(workshop.store['аптечка']).toBe(1);
    expect(workshop.queue).toEqual([]);
  });

  it('партія без замовлень: тік цеху — no-op поряд із геосценою', () => {
    const geo = geoNoUfo(42);
    const workshop = createWorkshop();
    advanceTime(geo, 48);
    workshopTick(workshop);
    expect(workshop).toEqual(createWorkshop());
  });
});

// Склад, поповнений напряму (тести екіпірування не про виробництво).
function stockedWorkshop(): WorkshopState {
  const workshop = createWorkshop();
  workshop.store['легка броня'] = 1;
  workshop.store['оптичний приціл'] = 1;
  workshop.store['аптечка'] = 2;
  workshop.store['осколкова граната'] = 1;
  return workshop;
}

describe('екіпірування ростеру (ADR-0058: броня/оптика постійні, аптечка/граната витратні)', () => {
  it('броня: з складу на солдата, +maxHp і +hp — солдат не стає пораненим', () => {
    const workshop = stockedWorkshop();
    const soldier = makeSoldier('s1', 'Іван');
    equipItem(workshop, soldier, 'легка броня');
    expect(workshop.store['легка броня']).toBe(0);
    expect(soldier.maxHp).toBe(10 + ARMOR_MAX_HP_BONUS);
    expect(soldier.hp).toBe(soldier.maxHp);
    expect(workshop.equipped['s1']).toEqual({ armor: true, optics: false, medkit: false, grenade: false });
    expect(workshop.log.at(-1)).toEqual({ type: 'equip', soldierId: 's1', id: 'легка броня' });
  });

  it('оптика: +0.05 точності з капом 0.95 (ADR-0004)', () => {
    const workshop = stockedWorkshop();
    const soldier = makeSoldier('s1', 'Іван');
    equipItem(workshop, soldier, 'оптичний приціл');
    expect(soldier.firingAccuracy).toBeCloseTo(0.6 + OPTICS_ACCURACY_BONUS, 10);
    expect(workshop.store['оптичний приціл']).toBe(0);
    // кап: снайпер на межі 0.95 вище не піднімається
    const sniperShop = stockedWorkshop();
    const sniper = makeSoldier('s2', 'Олена');
    sniper.firingAccuracy = 0.95;
    equipItem(sniperShop, sniper, 'оптичний приціл');
    expect(sniper.firingAccuracy).toBe(0.95);
  });

  it('аптечка і граната: по одній на місію — друга не надягається', () => {
    const workshop = stockedWorkshop();
    const soldier = makeSoldier('s1', 'Іван');
    equipItem(workshop, soldier, 'аптечка');
    equipItem(workshop, soldier, 'осколкова граната');
    expect(workshop.equipped['s1']).toEqual({ armor: false, optics: false, medkit: true, grenade: true });
    expect(() => equipItem(workshop, soldier, 'аптечка')).toThrow('Предмет уже при солдатові: аптечка');
    expect(workshop.store['аптечка']).toBe(1); // невдала спроба нічого не списала
  });

  it('порожній склад — throw, стан солдата не змінюється', () => {
    const workshop = createWorkshop();
    const soldier = makeSoldier('s1', 'Іван');
    expect(() => equipItem(workshop, soldier, 'аптечка')).toThrow('Предмета немає на складі: аптечка');
    expect(soldier.maxHp).toBe(10);
    expect(workshop.equipped).toEqual({});
  });

  it('гарматний модуль на солдатові не носиться — throw українською', () => {
    const workshop = stockedWorkshop();
    const soldier = makeSoldier('s1', 'Іван');
    expect(() => equipItem(workshop, soldier, 'гарматний модуль')).toThrow('озброєння винищувача');
    expect(() => unequipItem(workshop, soldier, 'гарматний модуль')).toThrow('озброєння винищувача');
  });

  it('зняття броні: предмет на склад, hp клемується новим maxHp', () => {
    const workshop = stockedWorkshop();
    const soldier = makeSoldier('s1', 'Іван');
    equipItem(workshop, soldier, 'легка броня');
    soldier.hp = 5; // поранений у броні
    unequipItem(workshop, soldier, 'легка броня');
    expect(soldier.maxHp).toBe(10);
    expect(soldier.hp).toBe(5);
    expect(workshop.store['легка броня']).toBe(1);
    expect(workshop.equipped).toEqual({}); // порожній запис не тримали
    expect(workshop.log.at(-1)).toEqual({ type: 'unequip', soldierId: 's1', id: 'легка броня' });
  });

  it('зняття оптики: точність повертається', () => {
    const workshop = stockedWorkshop();
    const soldier = makeSoldier('s1', 'Іван');
    equipItem(workshop, soldier, 'оптичний приціл');
    unequipItem(workshop, soldier, 'оптичний приціл');
    expect(soldier.firingAccuracy).toBeCloseTo(0.6, 10);
    expect(workshop.store['оптичний приціл']).toBe(1);
  });

  it('зняття одного предмету з кількох: запис екіпірування лишається', () => {
    const workshop = stockedWorkshop();
    const soldier = makeSoldier('s1', 'Іван');
    equipItem(workshop, soldier, 'легка броня');
    equipItem(workshop, soldier, 'аптечка');
    unequipItem(workshop, soldier, 'легка броня');
    expect(workshop.equipped['s1']).toEqual({ armor: false, optics: false, medkit: true, grenade: false });
    expect(workshop.store['легка броня']).toBe(1);
    expect(workshop.store['аптечка']).toBe(1); // аптечина залишилась при солдатові
  });

  it('зняття того, чого немає на солдатові — throw', () => {
    const workshop = stockedWorkshop();
    const soldier = makeSoldier('s1', 'Іван');
    expect(() => unequipItem(workshop, soldier, 'аптечка')).toThrow('Предмета немає на солдатові: аптечка');
  });
});

describe('передача ефектів у місію (критерій П11.3)', () => {
  it('загін місії — ті самі юніти ростеру: броня і оптика з ними (ADR-0058)', () => {
    const workshop = stockedWorkshop();
    const roster: Roster = createRoster(3);
    equipItem(workshop, roster.soldiers[0], 'легка броня');
    equipItem(workshop, roster.soldiers[0], 'оптичний приціл');
    const squad = missionSquad(roster);
    expect(squad[0].maxHp).toBe(roster.soldiers[0].maxHp);
    expect(squad[0].maxHp).toBe(10 + ARMOR_MAX_HP_BONUS);
    expect(squad[0].firingAccuracy).toBeCloseTo(0.6 + OPTICS_ACCURACY_BONUS, 10);
    // решта загону без предметів — бій без предметів байт-у-байт незмінний
    expect(squad[1].maxHp).toBe(10);
    expect(squad[1].firingAccuracy).toBe(0.6);
  });
});

describe('перма-смерть предметів (критерій П11.3: загиблий — предмети зникають)', () => {
  it('предмети загиблого не повертаються на склад, запис вилучається, подія в журналі', () => {
    const workshop = stockedWorkshop();
    const roster = createRoster(3);
    equipItem(workshop, roster.soldiers[0], 'легка броня');
    equipItem(workshop, roster.soldiers[0], 'аптечка');
    const storeBefore = { ...workshop.store };
    removeLostEquipment(workshop, [roster.soldiers[0]]);
    expect(workshop.equipped).toEqual({});
    expect(workshop.store).toEqual(storeBefore); // на склад НЕ повернулось
    expect(workshop.log.at(-1)).toEqual({ type: 'equipment_lost', soldierId: 's1', items: ['armor', 'medkit'] });
  });

  it('загиблий без предметів — no-op без події', () => {
    const workshop = stockedWorkshop();
    const roster = createRoster(3);
    const logBefore = workshop.log.length;
    removeLostEquipment(workshop, [roster.soldiers[1]]);
    expect(workshop.log.length).toBe(logBefore);
    expect(workshop.equipped).toEqual({});
  });
});

describe('гарматний модуль винищувача (ADR-0058: один модуль, екіпірування на геосцені)', () => {
  it('встановлення: з складу на винищувач, подія в журналі', () => {
    const workshop = stockedWorkshop();
    workshop.store['гарматний модуль'] = 1;
    const ic = createIntercept(11);
    installGunModule(workshop, ic);
    expect(ic.fighter.gunModule).toBe(true);
    expect(workshop.store['гарматний модуль']).toBe(0);
    expect(workshop.log.at(-1)).toEqual({ type: 'gun_module_installed' });
  });

  it('порожній склад — throw, винищувач без змін', () => {
    const workshop = createWorkshop();
    const ic = createIntercept(11);
    expect(() => installGunModule(workshop, ic)).toThrow('Предмета немає на складі: гарматний модуль');
    expect(ic.fighter.gunModule).toBeUndefined();
  });

  it('подвійне встановлення — throw', () => {
    const workshop = stockedWorkshop();
    workshop.store['гарматний модуль'] = 1;
    const ic = createIntercept(11);
    installGunModule(workshop, ic);
    workshop.store['гарматний модуль'] = 1;
    expect(() => installGunModule(workshop, ic)).toThrow('уже встановлено');
  });

  it('винищувач у польоті — обслуговування неможливе', () => {
    const workshop = stockedWorkshop();
    workshop.store['гарматний модуль'] = 1;
    const ic = createIntercept(11);
    ic.fighter.status = 'погоня';
    expect(() => installGunModule(workshop, ic)).toThrow('лише на базі');
    expect(() => removeGunModule(workshop, ic)).toThrow('лише на базі');
  });

  it('зняття: модуль назад на склад, прапорець скинуто', () => {
    const workshop = stockedWorkshop();
    workshop.store['гарматний модуль'] = 1;
    const ic = createIntercept(11);
    installGunModule(workshop, ic);
    removeGunModule(workshop, ic);
    expect(ic.fighter.gunModule).toBe(false);
    expect(workshop.store['гарматний модуль']).toBe(1);
    expect(workshop.log.at(-1)).toEqual({ type: 'gun_module_removed' });
  });

  it('зняття не встановленого — throw', () => {
    const workshop = createWorkshop();
    const ic = createIntercept(11);
    expect(() => removeGunModule(workshop, ic)).toThrow('не встановлено');
  });
});
