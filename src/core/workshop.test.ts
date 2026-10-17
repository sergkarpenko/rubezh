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
import type { EconomyState } from './economy';

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
