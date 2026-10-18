// src/core/party-bot.test.ts
// П8.5: тести бот-гравця наскрізного циклу партії — оркестратор грає повні
// партії (тіки → перехоплення → місії → найм/лікування/ремонт).
// Детермінізм (ADR-0003): сід + пресет + політика = байт-у-байт той самий
// результат. Критерій П8.5.3: рантайм-виклики бота передають пресет партії —
// твердження на розбіжність траєкторій «легкий»/«норма» і на HP найнятих.
// Тяжкі симуляції (120+ сідів) — НЕ тут (позбавляємо CI): у юніт-тестах лише
// короткий детермінований смоук і поодинокі повні партії (~0.3 с); масовий
// прогін — scripts/sim-p8.5.ts, результати — docs/reports/ (критерій П8.5.1).

import { describe, expect, it } from 'vitest';
import { createParty } from './save';
import { fireSoldier, readySoldiers } from './squad';
import { hirePrice } from './economy';
import { PASSIVE_POLICY } from './intercept-bot';
import { DEFAULT_PARTY_POLICY, SCIENCE_POLICY, TICKS_PER_DAY, partyBotHireStep, partyBotScienceStep, simulateParty } from './party-bot';

describe('П8.5: оркестратор — детермінізм (ADR-0003)', () => {
  it('повна партія: сід + пресет + політика = байт-у-байт той самий результат', () => {
    const a = simulateParty(42, 'норма');
    const b = simulateParty(42, 'норма');
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('короткий горизонт теж відтворюваний (10 діб, усі три пресети)', () => {
    for (const preset of ['легкий', 'норма', 'складний'] as const) {
      const a = simulateParty(7, preset, { maxDays: 10 });
      const b = simulateParty(7, preset, { maxDays: 10 });
      expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    }
  });
});

// П10.3: третій пресет «складний» — каркас у ядрі; числа затверджено П10.4
// тунінгом (×0.9/×0.9 за симуляціями 120 сідів, патерн П8.5/П8.6).
describe('П10.3: пресет «складний» у симуляціях', () => {
  it('три пресети на одному сіді дають різні траєкторії; тиск «складного» вищий за «норму»', () => {
    const легкий = simulateParty(7, 'легкий', { maxDays: 10 });
    const норма = simulateParty(7, 'норма', { maxDays: 10 });
    const складний = simulateParty(7, 'складний', { maxDays: 10 });
    // економіка ×0.9 (старт + дотація): «складний» бідніший з першої доби
    expect(складний.moneyByDay[0]).toBeLessThan(норма.moneyByDay[0]);
    expect(норма.moneyByDay[0]).toBeLessThan(легкий.moneyByDay[0]);
    // уся траєкторія (криві, місії, перехоплення) розходиться за трьома пресетами
    expect(JSON.stringify(складний)).not.toBe(JSON.stringify(норма));
    expect(JSON.stringify(норма)).not.toBe(JSON.stringify(легкий));
  });
});

describe('П8.5: критерій 3 — пресет у рантайм-викликах бота', () => {
  it('«легкий» і «норма» на одному сіді дають різні траєкторії', () => {
    const легкий = simulateParty(7, 'легкий', { maxDays: 10 });
    const норма = simulateParty(7, 'норма', { maxDays: 10 });
    // Стартові кошти ×1.2 + дотація ×1.2 — «легкий» багатший з першої доби
    expect(легкий.moneyByDay[0]).toBeGreaterThan(норма.moneyByDay[0]);
    // Уся траєкторія (криві, місії, перехоплення) розходиться — пресет
    // досягає рантайму, а не лишився в createParty
    expect(JSON.stringify(легкий)).not.toBe(JSON.stringify(норма));
  });

  it('partyBotHireStep передає пресет у hireSoldier: HP новобранця ×1.2 на «легкому»', () => {
    const p = createParty(42, 'легкий');
    for (let i = 0; i < 4; i++) fireSoldier(p.roster, p.roster.soldiers[0].id); // лишаємо 2 боєготових
    expect(partyBotHireStep(p, DEFAULT_PARTY_POLICY)).toBe(1);
    expect(p.roster.soldiers[p.roster.soldiers.length - 1].maxHp).toBe(12); // 10 × 1.2

    const n = createParty(42, 'норма');
    for (let i = 0; i < 4; i++) fireSoldier(n.roster, n.roster.soldiers[0].id);
    expect(partyBotHireStep(n, DEFAULT_PARTY_POLICY)).toBe(1);
    expect(n.roster.soldiers[n.roster.soldiers.length - 1].maxHp).toBe(10); // 10 × 1.0
  });
});

describe('П8.5: оркестратор — повна партія (фіксовані сіди фіксують баланс)', () => {
  it('перемога на межі 30-ї доби (ADR-0033): сід 42 «норма»', () => {
    const r = simulateParty(42, 'норма');
    expect(r.outcome).toBe('перемога');
    expect(r.endDay).toBe(30);
    expect(r.ticks).toBe(30 * TICKS_PER_DAY);
    expect(r.moneyByDay).toHaveLength(30);
    expect(r.readyByDay).toHaveLength(30);
    // П8.6: числа нової лінії тунінгу (probe-перед-тестами, урок П8.5): премії/дотація
    // нижчі → залишок 2510; ваги рахунку (ветерани 50, гроші 0.25) → тотал 4128.
    expect(r.score).toEqual({ ufosShotDown: 0, missionsWon: 22, veteransAlive: 4, moneyLeft: 2510, total: 4128 });
    expect(r.missionsLaunched).toBe(27);
    expect(r.missionsWon).toBe(22);
    expect(r.missionsLost).toBe(5);
    expect(r.soldiersLost).toBe(32);
    expect(r.soldiersWounded).toBe(19);
    expect(r.hiredTotal).toBe(30);
    expect(r.hireSpent).toBe(30 * hirePrice('норма')); // П11.8: hirePrice «норми» = 100
  });

  // П8.6: банкрутний сід нової лінії — сід 45 зі старої лінії тепер переможний
  // (probe-перед-тестами, урок П8.5); сід 35 банкрутує на Д11 — серія невдач
  // у середині гри (медіана банкрутств «норми» Д9.5, docs/reports/p8.6-tuning.md).
  it('банкрутство (ADR-0021): сід 35 «норма» — боєготових немає і грошей немає', () => {
    const r = simulateParty(35, 'норма');
    expect(r.outcome).toBe('банкрутство');
    expect(r.endDay).toBe(11);
    expect(r.ticks).toBe(498);
    expect(r.soldiersLost).toBe(27);
    expect(r.moneyByDay.length).toBeLessThan(30); // обірвана крива — доба 11 незавершена
  });

  it('смоук: 4 доби × 2 сіди × 2 пресети — без винятків, криви заповнені', () => {
    for (const seed of [1, 42]) {
      for (const preset of ['легкий', 'норма'] as const) {
        const r = simulateParty(seed, preset, { maxDays: 4 });
        expect(r.outcome).toBe('триває');
        expect(r.ticks).toBe(4 * TICKS_PER_DAY);
        expect(r.moneyByDay).toHaveLength(4);
        expect(r.readyByDay).toHaveLength(4);
        expect(r.missionsWon + r.missionsLost).toBe(r.missionsLaunched);
        // П11.8: ціна найму за пресетом (hirePrice): «легкий» 120, «норма» 100
        expect(r.hireSpent).toBe(r.hiredTotal * hirePrice(preset));
      }
    }
  });
});

describe('П8.5: політика бот-гравця — детерміновані рішення за станом', () => {
  it('пасивне перехоплення: запусків немає', () => {
    const policy = { ...DEFAULT_PARTY_POLICY, name: 'passive-test', intercept: PASSIVE_POLICY };
    const r = simulateParty(42, 'норма', { policy, maxDays: 5 });
    expect(r.launches).toBe(0);
    expect(r.engagements).toBe(0);
    expect(r.shotDown).toBe(0);
  });

  it('місії вимкнені: жодної місії', () => {
    const policy = { ...DEFAULT_PARTY_POLICY, name: 'no-missions', missions: false };
    const r = simulateParty(42, 'норма', { policy, maxDays: 5 });
    expect(r.missionsLaunched).toBe(0);
  });

  it('політика «не наймати» (hireUpTo 0) не наймає', () => {
    const policy = { ...DEFAULT_PARTY_POLICY, name: 'no-hire', hireUpTo: 0 };
    const r = simulateParty(42, 'норма', { policy, maxDays: 5 });
    expect(r.hiredTotal).toBe(0);
    expect(r.hireSpent).toBe(0);
  });
});

// П11.8 (Фаза 11, ADR-0058): політика науки у бот-гравці — найм вчених,
// порядок проєктів, замовлення цеху, екіпірування. Критерій П11.8.2: партії
// без науки байт-у-байт незмінні (патерн ізоляції П11.2/П11.4) — наука

describe('П11.8: політика науки — ізоляція (критерій 2)', () => {
  it('без науки — той самий результат, що й DEFAULT (усі поля науки вимкнені)', () => {
    const zeroed = { ...DEFAULT_PARTY_POLICY, name: 'zero-science' };
    const a = simulateParty(42, 'норма');
    const b = simulateParty(42, 'норма', { policy: zeroed });
    // розбіжність лише в імені політики — траєкторія байт-у-байт та сама
    expect(JSON.stringify(b)).toBe(JSON.stringify({ ...a, policy: 'zero-science' }));
  });

  it('метрики науки нульові без науки; крива штату — нулі (партія не помічає науки)', () => {
    const r = simulateParty(42, 'норма');
    expect(r.scientistsHired).toBe(0);
    expect(r.scientistsFired).toBe(0);
    expect(r.salaryShortfallDays).toBe(0);
    expect(r.salarySpent).toBe(0);
    expect(r.projectSpent).toBe(0);
    expect(r.workshopSpent).toBe(0);
    expect(r.projectsCompleted).toBe(0);
    expect(r.completedProjects).toEqual([]);
    expect(r.workshopProduced).toBe(0);
    expect(r.equippedItems).toBe(0);
    expect(r.scientistsByDay.every((n) => n === 0)).toBe(true);
    // золоті числа сіда 42 пинить тест вище (score 4128) — траєкторія
    // геосцени/бою не змінена додаванням науки в оркестратор
  });
});

describe('П11.8: політика науки — повний флоу (фіксовані сіди фіксують баланс)', () => {
  it('SCIENCE_POLICY: сід 42 «норма» — вчені, проєкти, цех, екіпірування; байт-у-байт', () => {
    const a = simulateParty(42, 'норма', { policy: SCIENCE_POLICY });
    const b = simulateParty(42, 'норма', { policy: SCIENCE_POLICY });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(a.outcome).toBe('перемога');
    expect(a.scientistsHired).toBe(3);
    // П11.8 (тунінг ×0.75 точок, комбо-B): за 30 діб — 3 проєкти (до тунінгу — 2)
    expect(a.completedProjects).toEqual(['medkit', 'lab-extension', 'optics']);
    expect(a.workshopProduced).toBe(15);
    expect(a.equippedItems).toBe(15);
    expect(a.salarySpent).toBe(1800);
    expect(a.projectSpent).toBe(270);
    expect(a.workshopSpent).toBe(640);
    expect(a.scientistsFired).toBe(0);
    expect(a.scientistsByDay[a.scientistsByDay.length - 1]).toBe(3);
  });

  it('спіраль зарплата→звільнення (урок П11.2): бідна партія звільняє вчених з кінця штату', () => {
    const heavy = { ...SCIENCE_POLICY, name: 'sci-heavy', scientistsUpTo: 5 };
    const r = simulateParty(45, 'норма', { policy: heavy });
    expect(r.salaryShortfallDays).toBe(2);
    expect(r.scientistsFired).toBe(2);
    // штат просідає 5 → 3 (наймані поверх звільнених) — метрики бачать спіраль
    expect(Math.max(...r.scientistsByDay)).toBe(5);
    expect(r.scientistsByDay[r.scientistsByDay.length - 1]).toBeLessThan(5);
  });
});

describe('П11.8: partyBotScienceStep — детерміновані рішення за станом', () => {
  const NO_SCIENCE_BASE = { ...SCIENCE_POLICY, projects: [], workshopOrders: [], equip: false };

  it('наймає вчених до scientistsUpTo, лишаючи резерв hireReserve', () => {
    const p = createParty(42, 'норма'); // старт 300, резерв 50: 2 найми (300−200), третій лишив би 0 < 50
    partyBotScienceStep(p, NO_SCIENCE_BASE);
    expect(p.research.scientists).toHaveLength(2);
    expect(p.econ.money).toBe(100);
  });

  it('стартує перший доступний проєкт за пріоритетом — один за крок', () => {
    const p = createParty(42, 'норма');
    partyBotScienceStep(p, { ...NO_SCIENCE_BASE, scientistsUpTo: 0, projects: ['grenade', 'medkit'] });
    // «осколкова граната»: передумова «аптечка» не завершена — гейт;
    // «аптечка» стартує першою доступною (100 кошти), слот один зайнятий
    expect(p.research.active.map((x) => x.id)).toEqual(['medkit']);
    expect(p.econ.money).toBe(200);
  });

  it('проєкт не стартує без слота (слоти лабораторії — гейт ADR-0058)', () => {
    const p = createParty(42, 'норма');
    p.research.slots = 2;
    p.research.active.push({ id: 'optics', invested: 0 }, { id: 'armor', invested: 0 });
    partyBotScienceStep(p, { ...NO_SCIENCE_BASE, scientistsUpTo: 0, projects: ['medkit'] });
    expect(p.research.active).toHaveLength(2); // слоти зайняті — нижчі пріоритети не стартуються
    expect(p.econ.money).toBe(300);
  });

  it('цех: замовлення лише завершеного проєкту, за дефіцитом, одне в черзі', () => {
    const p = createParty(42, 'норма');
    partyBotScienceStep(p, { ...NO_SCIENCE_BASE, scientistsUpTo: 0, workshopOrders: ['medkit'] });
    expect(p.workshop.queue).toHaveLength(0); // проєкт не досліджено — гейт
    p.research.completed.push('medkit');
    partyBotScienceStep(p, { ...NO_SCIENCE_BASE, scientistsUpTo: 0, workshopOrders: ['medkit'] });
    expect(p.workshop.queue.map((o) => o.id)).toEqual(['medkit']); // дефіцит 6 готових солдатів
    expect(p.econ.money).toBe(260); // 40 кошти за замовлення (норма ×1.0)
    partyBotScienceStep(p, { ...NO_SCIENCE_BASE, scientistsUpTo: 0, workshopOrders: ['medkit'] });
    expect(p.workshop.queue).toHaveLength(1); // одне активне замовлення — дублі не копляться
  });

  it('цех: без дефіциту замовлення немає (склад покриває потребу)', () => {
    const p = createParty(42, 'норма');
    p.research.completed.push('medkit');
    p.workshop.store['medkit'] = 6; // усім боєготовим вистачає
    partyBotScienceStep(p, { ...NO_SCIENCE_BASE, scientistsUpTo: 0, workshopOrders: ['medkit'] });
    expect(p.workshop.queue).toHaveLength(0);
    expect(p.econ.money).toBe(300);
  });

  it('екіпірування: броня зі складу → +2 maxHp боєготовому; гарматний модуль → на винищувач', () => {
    const p = createParty(42, 'норма');
    p.workshop.store['armor'] = 1;
    p.workshop.store['gun-module'] = 1;
    partyBotScienceStep(p, { ...NO_SCIENCE_BASE, scientistsUpTo: 0, equip: true });
    const first = readySoldiers(p.roster)[0];
    expect(p.workshop.equipped[first.id]?.armor).toBe(true);
    expect(first.maxHp).toBe(12); // 10 + 2 (ADR-0058)
    expect(p.intercept.fighter.gunModule).toBe(true);
    expect(p.workshop.store['gun-module']).toBe(0);
    // повторний крок: предмет уже при солдатові/винищувачі — без змін і винятків
    partyBotScienceStep(p, { ...NO_SCIENCE_BASE, scientistsUpTo: 0, equip: true });
    expect(first.maxHp).toBe(12);
    expect(p.intercept.fighter.gunModule).toBe(true);
  });

  it('гарматний модуль не ставиться поза базою (винищувач у польоті)', () => {
    const p = createParty(42, 'норма');
    p.workshop.store['gun-module'] = 1;
    p.intercept.fighter.status = 'ремонт';
    partyBotScienceStep(p, { ...NO_SCIENCE_BASE, scientistsUpTo: 0, equip: true });
    expect(p.intercept.fighter.gunModule).toBeFalsy(); // гейт «лише на базі» (ADR-0058; поле опційне)
    expect(p.workshop.store['gun-module']).toBe(1);
  });
});
