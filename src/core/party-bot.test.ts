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
import type { ProjectId } from './research';
import { spend } from './economy';
import { advanceTime, missionTargets } from './geo';
import { BALANCED_POLICY, PASSIVE_POLICY } from './intercept-bot';
import {
  CAMPAIGN_POLICY,
  CAMPAIGN_SCIENTISTS,
  DEFAULT_PARTY_POLICY,
  SCIENCE_POLICY,
  TICKS_PER_DAY,
  partyBotHireStep,
  partyBotInterceptStep,
  partyBotMissionStep,
  partyBotScienceStep,
  partyBotGateStep,
  partyBotAssaultStep,
  PARTY_HORIZON_DAYS,
  simulateParty,
  type PartyBotPolicy,
} from './party-bot';

describe('П8.5: оркестратор — детермінізм (ADR-0003)', () => {
  it('повна партія: сід + пресет + політика = байт-у-байт той самий результат', () => {
    const a = simulateParty(42, 'норма');
    const b = simulateParty(42, 'норма');
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  }, 30_000); // issue #377: явний тайм-аут замість дефолтних 5000 мс (під покриттям повільніше)

  it('короткий горизонт теж відтворюваний (10 діб, усі три пресети)', () => {
    for (const preset of ['легкий', 'норма', 'складний'] as const) {
      const a = simulateParty(7, preset, { maxDays: 10 });
      const b = simulateParty(7, preset, { maxDays: 10 });
      expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    }
  }, 30_000); // issue #377: явний тайм-аут замість дефолтних 5000 мс (під покриттям повільніше)
});

// П10.3: третій пресет «складний» — каркас у ядрі; числа затверджено П10.4
// тунінгом (×0.9/×0.9 за симуляціями 120 сідів, патерн П8.5/П8.6).
describe('П10.3: пресет «складний» у симуляціях', () => {
  it('три пресети на одному сіді дають різні траєкторії; тиск «складного» вищий за «норму»', () => {
    // п20.3 (ADR-0167): сід 7 → 8 — на сіді 7 гроші першої доби 674 / 745 / 662 («легкий» / «норма» / «складний»):
    // «легкий» бідніший за «норму» (його бій першої доби інший); скан сідів 1–40 — порядок грошей тримають 32 з 40.
    const легкий = simulateParty(8, 'легкий', { maxDays: 10 });
    const норма = simulateParty(8, 'норма', { maxDays: 10 });
    const складний = simulateParty(8, 'складний', { maxDays: 10 });
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
    // п20.3 (ADR-0167): сід 7 → 8 (як у тесті П10.3 вище).
    const легкий = simulateParty(8, 'легкий', { maxDays: 10 });
    const норма = simulateParty(8, 'норма', { maxDays: 10 });
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
  it('п18.3: межа 30-ї доби — без перемоги; горизонт 30 діб — «триває»', () => {
    expect(PARTY_HORIZON_DAYS).toBe(120);
    const r = simulateParty(42, 'норма', { maxDays: 30 });
    expect(r.outcome).toBe('триває');
    expect(r.endDay).toBe(30);
    expect(r.ticks).toBe(30 * TICKS_PER_DAY);
  }, 30_000);

  it('п18.3 (ADR-0153 п. 13, 15): партія без перемоги закінчується поразкою за загрозою — сід 42 «норма»', () => {
    const r = simulateParty(42, 'норма');
    expect(r.outcome).toBe('поразка');
    expect(r.endDay).toBe(36); // доба настання (загроза 100); п18.3 — 56-та, п18.4 — 44-та, п19.6 — 36-та
    expect(r.ticks).toBe(35 * TICKS_PER_DAY);
    expect(r.moneyByDay).toHaveLength(35);
    expect(r.readyByDay).toHaveLength(35);
    // П8.6/П14.8: числа лінії тунінгу (probe-перед-тестами, урок П8.5); WORLD_H 9
    // (фідбек П14.8) і симетрична лінія вогню (Т.18, ADR-0087) зсунули
    // траєкторії: залишок 2610, ваги рахунку (ветерани 50, гроші 0.25) → тотал 4203.
    // п16.2 (ADR-0147): прирости звань (+1 HP, +0,03 точності) зменшили втрати
    // (30 → 22) і найм (29 → 21): залишок 3410, тотал 4403; баланс — probe п16.5.
    // п16.3 (ADR-0147 п. 3, 12): дії ролей бота — втрати 22 → 20, найм 21 → 18,
    // залишок 3710, ветеранів 4, тотал 4428.
    // п17.2 (ADR-0149): нові типи ворогів з 6-ї доби (ШІ демона до п17.3) — місій 24 → 31,
    // поразок 2 → 9, втрати 20 → 46, найм 18 → 44, залишок 1110, тотал 3778; баланс — probe п17.6.
    // п17.3 (ADR-0149 п. 13): ШІ за типом — місій 31 → 28, поразок 9 → 7, втрати 46 → 37,
    // поранених 23 → 25, найм 44 → 36, залишок 1740, тотал 3835.
    // п17.4 (ADR-0151): живі юніти закривають огляд і вогонь — місій 28 → 23, поразок 7 → 1,
    // втрати 37 → 15, поранених 25 → 22, найм 36 → 13, залишок 4210, ветеранів 4, тотал 4553.
    // п18.3 (ADR-0153 п. 13–15): склад ворогів за загрозою і партія до поразки (56 діб замість 30) —
    // місій 23 → 58, поразок 1 → 10, втрати 15 → 57, поранених 22 → 48, найм 13 → 54, залишок 5385,
    // ветеранів 3, тотал 8696; бот без політики кампанії (п18.6 — CAMPAIGN_POLICY, ADR-0158).
    // п18.4 (ADR-0156): три штурми бази (один програно: +10 загрози, −30 % кредитів) — поразка на 44-й добі:
    // місій 58 → 40, поразок 10 → 6, втрати 57 → 41, поранених 48 → 38, найм 54 → 40, залишок 3210, тотал 6153.
    // п19.2 (ADR-0159 п. 11–12): відльоти без бою знижують довіру регіонів — дотація менша, залишок 2819, тотал 6055;
    // траєкторія місій і боїв — та сама.
    // п19.6 (ADR-0164): повітряний бій бота — до кінця, поки час стоїть; до п19.6 перехоплювач застрягав у «бою»
    // з 3-ї доби (бот вигравав місію на зонді, з яким той бився) — збито 0 → 16, місій 40 → 26, поразок 6 → 4,
    // втрати 41 → 34, поранених 38 → 24, найм 40 → 31, програно штурмів 1 → 2 — поразка на 36-й добі, тотал 5560.
    // п20.2 (ADR-0165, ADR-0166): укриття і низькі перешкоди в боях місій (бот укриття ще не шукає, п20.3) —
    // поранених 24 → 28, залишок 2179, тотал 5595; місії, втрати й штурми ті самі.
    // п20.3 (ADR-0167): ШІ ворогів і бот загону шукають укриття — місій 26 → 27, поразок 4 → 5, втрати 34 → 38,
    // поранених 28 → 24, найм 31 → 36, ветеранів 3 → 4, залишок 1895, тотал 5574; поразка — та сама 36-та доба.
    // п22.2 (ADR-0183): гілки «Сержанта» й «Ветерана» в бота — місій 27 → 26, поразок 5 → 4, втрати 38 → 36,
    // найм 36 → 35, ветеранів 4 → 5, залишок 1944, тотал 5636; поразка — та сама 36-та доба.
    expect(r.score).toEqual({ probesShotDown: 16, missionsWon: 22, veteransAlive: 5, moneyLeft: 1944, total: 5636 });
    expect([r.launches, r.shotDown]).toEqual([19, 16]);
    expect(r.missionsLaunched).toBe(26);
    expect(r.missionsWon).toBe(22);
    expect(r.missionsLost).toBe(4);
    expect(r.soldiersLost).toBe(36);
    expect(r.soldiersWounded).toBe(24);
    expect(r.hiredTotal).toBe(35);
    expect(r.hireSpent).toBe(35 * hirePrice('норма')); // П11.8: hirePrice «норми» = 100
    expect(r.assaults).toBe(3);
    expect(r.assaultsLost).toBe(2);
    expect(r.gateAttempts).toBe(0); // DEFAULT «Ключа брами» не досліджує (CAMPAIGN_POLICY — п18.6)
  });

  // Т.22 (ADR-0089): чинний бот не банкрутує — останній загін без грошей на найм
  // у бій не йде, ремонт без боєготових чекає (сід 16, банкрутний до Т.22, тепер
  // виграє). Банкрутство лишається досяжним для політики, що не наймає і
  // витрачає на науку: загін гине, а гроші на найм ідуть техномантам (probe).
  it('чинний бот на колись банкрутному сіді 16 «норма» не банкрутує (п18.3: до поразки за загрозою)', () => {
    const r = simulateParty(16, 'норма');
    expect(r.outcome).toBe('поразка');
    expect(r.endDay).toBe(55);
    // п16.2 (ADR-0147): прирости звань — 42 → 41 місія, 50 → 45 загиблих;
    // п16.3: дії ролей — 41 → 39 місій, 35 → 32 виграних, 45 → 39 загиблих;
    // п17.2 (ADR-0149): нові типи ворогів — 39 → 40 місій, 39 → 52 загиблих.
    // п17.3 (ШІ за типом): 40 → 50 місій, перемог 32 → 37, загиблих 52 → 66.
    // п17.4 (туман із блокуванням): 50 → 48 місій, перемог 37 → 40, загиблих 66 → 46.
    // п18.3 (склад за загрозою, партія до 64-ї доби): 48 → 88 місій, перемог 40 → 75, загиблих 46 → 82.
    // п18.4 (штурми бази, два програно — поразка на 55-й добі): 88 → 81 місія, перемог 75 → 69, загиблих 82 → 83.
    // п19.6 (бій перехоплювача до кінця — збиті зонди дають місії на місці падіння): 81 → 92 місії, загиблих 83 → 117.
    // п20.2 (укриття і низькі перешкоди, ADR-0166): поразка на 61-й, 92 → 81 місія, перемог 69 → 74, загиблих 117 → 54,
    // програно штурмів 2 → 1.
    // п20.3 (ШІ ворогів і бот загону з укриттям, ADR-0167): поразка на 55-й, 81 → 79 місій, перемог 74 → 69, загиблих 54 → 69,
    // програно штурмів 1 → 2.
    // п22.2 (гілки «Сержанта» й «Ветерана» в бота, ADR-0183): 79 → 70 місій, перемог 69, загиблих 69 → 35.
    expect(r.missionsLaunched).toBe(70);
    expect(r.missionsWon).toBe(69);
    expect(r.soldiersLost).toBe(35);
    expect(r.assaults).toBe(3);
    expect(r.assaultsLost).toBe(2);
  }, 30_000); // issue #377: явний тайм-аут замість дефолтних 5000 мс (під покриттям повільніше)

  // п17.4 (туман із блокуванням): сід 26 тепер виграє; банкрутний сід — 44 (скан сідів 1–120).
  // п20.2 (укриття і низькі перешкоди, ADR-0166): SCIENCE_POLICY без найму не банкрутує на жодному сіді 1–400
  // («норма» і «складний», 40 діб) — загін виживає довше, дотація накопичується; політика з повним штатом
  // вчених без найму — банкрутує (скан 1–120: сіди 2, 8, 9, 11, …), сід 2.
  it('банкрутство (ADR-0021): наука без найму, сід 2 «норма» — боєготових немає і грошей немає', () => {
    const r = simulateParty(2, 'норма', {
      policy: {
        ...SCIENCE_POLICY,
        name: 'sci-heavy-no-hire',
        hireUpTo: 0,
        scientistsUpTo: 8,
        projects: ['medkit', 'optics', 'armor', 'gun-module', 'grenade', 'lab-extension'],
        fireScientistsWhenDone: false,
      },
    });
    expect(r.outcome).toBe('банкрутство');
    expect(r.endDay).toBe(9); // п20.3 (ШІ з укриттям, ADR-0167): 12 → 9
    expect(r.ticks).toBe(384);
    expect(r.soldiersLost).toBe(6);
    expect(r.moneyByDay.length).toBeLessThan(30); // обірвана крива — доба 9 незавершена
  });

  it('смоук: 4 доби × 2 сіди × 2 пресети — без винятків, криви заповнені', () => {
    for (const seed of [1, 42]) {
      for (const preset of ['легкий', 'норма'] as const) {
        const r = simulateParty(seed, preset, { maxDays: 4 });
        expect(r.outcome).toBe('триває');
        expect(r.ticks).toBe(4 * TICKS_PER_DAY);
        expect(r.moneyByDay).toHaveLength(4);
        expect(r.readyByDay).toHaveLength(4);
        expect(r.missionsWon + r.missionsLost + r.missionsEvacuated).toBe(r.missionsLaunched);
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

// Т.22 (ADR-0089, рішення власника за звітом Т.20): два дефекти політики, з
// яких складались усі банкрутства бота.
describe('Т.22: запобіжник останнього загону і ремонт без боєготових', () => {
  // Партія з ціллю місії: тіки геосцени до першого приземленого зонда.
  function partyWithTarget(): ReturnType<typeof createParty> {
    const p = createParty(42, 'норма');
    for (let t = 0; t < 30 * TICKS_PER_DAY && missionTargets(p.geo).length === 0; t++) advanceTime(p.geo, 1);
    expect(missionTargets(p.geo).length).toBeGreaterThan(0);
    while (readySoldiers(p.roster).length > 3) fireSoldier(p.roster, p.roster.soldiers[0].id);
    return p;
  }

  it('останній боєготовий загін без грошей на найм у бій не йде', () => {
    const p = partyWithTarget();
    spend(p.econ, p.econ.money - 99); // 99 < ціни найму 100
    const before = JSON.stringify(p);
    expect(partyBotMissionStep(p, DEFAULT_PARTY_POLICY).launched).toBe(false);
    expect(JSON.stringify(p)).toBe(before); // крок нічого не змінив
  });

  it('із грошима рівно на найм той самий загін іде в бій', () => {
    const p = partyWithTarget();
    spend(p.econ, p.econ.money - 100);
    expect(partyBotMissionStep(p, DEFAULT_PARTY_POLICY).launched).toBe(true);
  });

  it('п18.2 (ADR-0153 п. 9): трофеї — лише за перемогу, по одному за кожного ворога місії', () => {
    const p = partyWithTarget();
    const info = partyBotMissionStep(p, DEFAULT_PARTY_POLICY);
    expect(info.outcome).toBe('перемога'); // сід 42, перша ціль
    const total = Object.values(p.research.trophies).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThanOrEqual(2); // звичайна місія — 2 або 3 вороги, усі загинули
    expect(p.research.log.filter((e) => e.type === 'trophies')).toHaveLength(1);
  });

  it('п18.2 (аудит PR #513): ключовий протокол у політиці без трофеїв — пропуск, а не помилка', () => {
    const p = createParty(42, 'норма');
    p.econ.money = 10_000; // кредитів на старт будь-якого протоколу з резервом
    expect(() => partyBotScienceStep(p, { ...SCIENCE_POLICY, projects: ['rift-anatomy', 'armor'] })).not.toThrow();
    expect(p.research.active.map((a) => a.id)).toEqual(['armor']);
  });

  it('без грошей, але з четвертим боєготовим місія запускається', () => {
    const p = createParty(42, 'норма');
    for (let t = 0; t < 30 * TICKS_PER_DAY && missionTargets(p.geo).length === 0; t++) advanceTime(p.geo, 1);
    while (readySoldiers(p.roster).length > 4) fireSoldier(p.roster, p.roster.soldiers[0].id);
    spend(p.econ, p.econ.money);
    expect(partyBotMissionStep(p, DEFAULT_PARTY_POLICY).launched).toBe(true);
  });

  it('пошкоджений перехоплювач без боєготових не ремонтується; з одним боєготовим — ремонтується', () => {
    const p = createParty(42, 'норма');
    p.intercept.fighters[0].hp = 1;
    const money = p.econ.money;
    const all = p.roster.soldiers.map((s) => s.id);
    for (const id of all) p.roster.hospital[id] = 10; // боєготових немає
    partyBotInterceptStep(p, BALANCED_POLICY);
    expect(p.econ.money).toBe(money);
    expect(p.intercept.fighters[0].status).toBe('на базі');
    expect(p.intercept.fighters[0].repairTicksLeft).toBeUndefined();

    delete p.roster.hospital[all[0]];
    partyBotInterceptStep(p, BALANCED_POLICY);
    expect(p.econ.money).toBe(money - 50);
    expect(p.intercept.fighters[0].repairTicksLeft).toBeGreaterThan(0);
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
  }, 30_000); // issue #377: явний тайм-аут замість дефолтних 5000 мс (під покриттям повільніше)

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
    // золоті числа сіда 42 пинить тест вище (score 4053 при WORLD_H 9) — траєкторія
    // геосцени/бою не змінена додаванням науки в оркестратор
  });
});

describe('П11.8: політика науки — повний флоу (фіксовані сіди фіксують баланс)', () => {
  // WORLD_H 9 (фідбек П14.8) зсунув траєкторії: на сіді 42 наука тепер
  // банкрутує — переможний сід флоу науки перемірено probe-сканом (урок П8.5):
  // сід 49 дає той самий візерунок (вчені, проєкти, цех, екіпірування).
  // Т.28 (ADR-0091): політика — два техноманти, лише протокол броні, потім штат
  // звільнено; броня загиблих повертається на склад — числа перемірено.
  it('SCIENCE_POLICY: сід 49 «норма» — вчені, проєкти, цех, екіпірування; байт-у-байт', () => {
    const a = simulateParty(49, 'норма', { policy: SCIENCE_POLICY });
    const b = simulateParty(49, 'норма', { policy: SCIENCE_POLICY });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(a.outcome).toBe('поразка'); // п18.3: до поразки за загрозою — 72-га доба; п20.3 (ШІ з укриттям) — 58-ма; п22.2 (гілки) — 63-тя
    expect(a.endDay).toBe(63);
    expect(a.scientistsHired).toBe(2);
    expect(a.completedProjects).toEqual(['armor']);
    expect(a.workshopProduced).toBe(9); // п17.4: 7 → 8; п18.3: 7; п20.3: 10; п22.2: 9
    // броня загиблих повертається на склад і йде наступним; п16.2 (ADR-0147): менше загиблих — 41 → 32; п16.3 (ролі) — 28;
    // п17.2 (ADR-0149): нові типи ворогів — більше загиблих, броня йде наступним частіше — 50; п17.3 (ШІ за типом) — 57;
    // п17.4 (туман із блокуванням, ADR-0151) — менше загиблих — 26; п18.3 (72 доби, склад за загрозою) — 70;
    // п18.4 (штурми бази, усі три відбито) — 68; п19.6 (бій перехоплювача до кінця) — 63; п20.2 (укриття) — 44;
    // п20.3 (ШІ ворогів і бот загону з укриттям, ADR-0167) — 64; п22.2 (гілки «Сержанта» й «Ветерана», ADR-0183) — 35
    expect(a.equippedItems).toBe(35);
    expect(a.salarySpent).toBe(140); // 2 × 10 × 7 діб (14 очок, 2 очки на добу)
    expect(a.projectSpent).toBe(96);
    expect(a.workshopSpent).toBe(540); // п18.3: 7 предметів; п20.3: 10; п22.2: 9
    expect(a.scientistsFired).toBe(0); // лічильник — лише авто-звільнення за невиплату
    expect(Math.max(...a.scientistsByDay)).toBe(2);
    expect(a.scientistsByDay[a.scientistsByDay.length - 1]).toBe(0); // штат звільнено після протоколу
    expect(a.missionsLaunched).toBe(79); // п16.2: 45 → 44; п16.3: 43; п17.2: 49; п17.3: 50; п17.4: 41; п18.3: 98; п18.4: 95; п19.6: 94; п20.2: 91; п20.3: 79; п22.2: 79
    expect(a.missionsWon).toBe(75); // п20.3: 68; п22.2: 75
    expect([a.assaults, a.assaultsLost]).toEqual([3, 1]); // п20.3: програно 2; п22.2: 1
  }, 30_000); // дві повні партії з наукою: під інструментуванням покриття в CI не вкладається в 5 с

  it('спіраль зарплата→звільнення (урок П11.2): бідна партія звільняє вчених з кінця штату', () => {
    // Т.28 (ADR-0091): зарплата 10 — спіраль настає лише за восьми техномантів, усіх
    // протоколів і без звільнення після завершення; сід 54 (probe; до Т.28 — сід 42, штат 5).
    // п17.4 (туман із блокуванням): на сіді 54 штат наприкінці знову 8 — сід 66 (скан 50–80).
    // п18.3: сід 66 програє за загрозою на 16-й добі з одним днем невиплати — сід 54 (скан 40–140:
    // два і більше звільнень — сіди 54 і 94), поразка на 15-й добі.
    // п18.4 (ADR-0156): програний штурм бази (−30 % кредитів) доводить бідну партію сіду 54 до
    // банкрутства на 11-й добі — два дні невиплати, два звільнення (скан 40–140: два і більше — лише 54).
    // п19.2 (ADR-0159 п. 12): дотація з довір регіонів менша — два і більше звільнень на 49 сідах зі 101; на 54 штат уже
    // не доходить до 8 — сід 56 (скан 40–140): два дні невиплати, чотири звільнення, штат 8, на кінці 7.
    // п19.6 (бій перехоплювача до кінця): той самий сід 56 — два дні невиплати, п'ять звільнень, на кінці 5.
    // п20.2 (укриття і низькі перешкоди, ADR-0166): сід 56 не банкрутує — сід 52 (скан 40–140: банкрутують 31 сід,
    // штат 8 і два і більше звільнень — 42, 50, 52, 55, 63, 72): програний штурм, три дні невиплати, чотири звільнення, на кінці 4.
    // п20.3 (ШІ ворогів і бот загону з укриттям, ADR-0167): сід 52 не банкрутує — сід 82 (скан 40–140: банкрутують 42 сіди,
    // з них штат 8 і два і більше звільнень — 22): програний штурм, два дні невиплати, чотири звільнення, на кінці 4.
    // п22.2 (гілки «Сержанта» й «Ветерана» в бота, ADR-0183): сід 82 не банкрутує — сід 72 (скан 40–140: штат 8 і два і
    // більше звільнень — 21 сід): програний штурм, два дні невиплати, чотири звільнення, на кінці 5.
    const heavy: PartyBotPolicy = {
      ...SCIENCE_POLICY,
      name: 'sci-heavy',
      scientistsUpTo: 8,
      projects: ['medkit', 'optics', 'armor', 'gun-module', 'grenade', 'lab-extension'],
      fireScientistsWhenDone: false,
    };
    const r = simulateParty(72, 'норма', { policy: heavy });
    expect(r.outcome).toBe('банкрутство');
    expect(r.assaultsLost).toBe(1);
    expect(r.salaryShortfallDays).toBe(2);
    expect(r.scientistsFired).toBe(4);
    // штат 8, звільнених наймають знову — метрики бачать спіраль (і звільнення, і повний штат)
    expect(Math.max(...r.scientistsByDay)).toBe(8);
    expect(r.scientistsByDay[r.scientistsByDay.length - 1]).toBe(5);
  });
});

describe('П11.8: partyBotScienceStep — детерміновані рішення за станом', () => {
  const NO_SCIENCE_BASE = { ...SCIENCE_POLICY, scientistsUpTo: 3, projects: [], workshopOrders: [], equip: false };

  it('наймає вчених до scientistsUpTo, лишаючи резерв hireReserve', () => {
    const p = createParty(42, 'норма'); // старт 300, резерв 50: 2 найми (300−200), третій лишив би 0 < 50
    partyBotScienceStep(p, NO_SCIENCE_BASE);
    expect(p.research.scientists).toHaveLength(2);
    expect(p.econ.money).toBe(100);
  });

  it('Т.28: усі протоколи політики завершено — штат звільнено, нових не наймає; без прапорця штат лишається', () => {
    const p = createParty(42, 'норма');
    const policy = { ...NO_SCIENCE_BASE, scientistsUpTo: 2, projects: ['armor', 'optics'] as ProjectId[] };
    partyBotScienceStep(p, policy); // два найми (300 − 200), протокол броні не по кишені з резервом
    expect(p.research.scientists).toHaveLength(2);
    p.research.completed.push('armor');
    p.econ.money = 100; // «око» (72) з резервом 50 не стартує
    partyBotScienceStep(p, policy);
    expect(p.research.scientists).toHaveLength(2); // завершено не все — штат працює
    p.research.completed.push('optics');
    p.econ.money = 1000;
    partyBotScienceStep(p, { ...policy, fireScientistsWhenDone: false });
    expect(p.research.scientists).toHaveLength(2);
    partyBotScienceStep(p, policy);
    expect(p.research.scientists).toHaveLength(0);
    expect(p.research.log.filter((e) => e.type === 'fire')).toHaveLength(2);
    expect(p.econ.money).toBe(1000); // після звільнення не наймає
    partyBotScienceStep(p, policy);
    expect(p.research.scientists).toHaveLength(0);
    expect(p.econ.money).toBe(1000);
  });

  it('Т.28: політика без протоколів штат не звільняє (порожній список — не «все завершено»)', () => {
    const p = createParty(42, 'норма');
    partyBotScienceStep(p, { ...NO_SCIENCE_BASE, fireScientistsWhenDone: true });
    partyBotScienceStep(p, { ...NO_SCIENCE_BASE, fireScientistsWhenDone: true });
    expect(p.research.scientists).toHaveLength(2);
  });

  it('SCIENCE_POLICY (Т.28, ADR-0091): два техноманти, лише протокол броні, цех — броня, звільнення після', () => {
    expect(SCIENCE_POLICY).toMatchObject({
      scientistsUpTo: 2,
      projects: ['armor'],
      workshopOrders: ['armor'],
      equip: true,
      fireScientistsWhenDone: true,
    });
    expect(DEFAULT_PARTY_POLICY.fireScientistsWhenDone).toBe(false);
  });

  it('стартує перший доступний проєкт за пріоритетом — один за крок', () => {
    const p = createParty(42, 'норма');
    partyBotScienceStep(p, { ...NO_SCIENCE_BASE, scientistsUpTo: 0, projects: ['grenade', 'medkit'] });
    // «осколкова граната»: передумова «аптечка» не завершена — гейт;
    // «аптечка» стартує першою доступною (80 кредитів, Т.19), слот один зайнятий
    expect(p.research.active.map((x) => x.id)).toEqual(['medkit']);
    expect(p.econ.money).toBe(220);
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
    expect(p.intercept.fighters[0].gunModule).toBe(true);
    expect(p.workshop.store['gun-module']).toBe(0);
    // повторний крок: предмет уже при солдатові/винищувачі — без змін і винятків
    partyBotScienceStep(p, { ...NO_SCIENCE_BASE, scientistsUpTo: 0, equip: true });
    expect(first.maxHp).toBe(12);
    expect(p.intercept.fighters[0].gunModule).toBe(true);
  });

  it('гарматний модуль не ставиться поза базою (винищувач у польоті)', () => {
    const p = createParty(42, 'норма');
    p.workshop.store['gun-module'] = 1;
    p.intercept.fighters[0].status = 'ремонт';
    partyBotScienceStep(p, { ...NO_SCIENCE_BASE, scientistsUpTo: 0, equip: true });
    expect(p.intercept.fighters[0].gunModule).toBeFalsy(); // гейт «лише на базі» (ADR-0058; поле опційне)
    expect(p.workshop.store['gun-module']).toBe(1);
  });
});

// п18.6 (ADR-0158): політика кампанії — ланцюжок до Брами, заряд з резервом трофеїв, дозор, фінал зі званнями.
describe('п18.6: політика кампанії (CAMPAIGN_POLICY)', () => {
  const BASE = { ...CAMPAIGN_POLICY, scientistsUpTo: 0, projects: [] as ProjectId[], equip: false };

  // п20.6 (ADR-0170): п'ять техномантів, протоколи зброї після ключових, зброя за роллю, дозор з укриттям
  it('склад політики: п’ять техномантів, броня, три ключові протоколи і зброя за порядком, заряд, дозор з укриттям у кожному бою, фінал зі званнями', () => {
    expect(CAMPAIGN_SCIENTISTS).toBe(5);
    expect(CAMPAIGN_POLICY).toMatchObject({
      name: 'campaign',
      scientistsUpTo: 5,
      projects: ['armor', 'rift-anatomy', 'gate-bearing', 'gate-key', 'shotgun', 'mg', 'optics', 'sniper'],
      holdCover: true,
      weapons: true,
      workshopOrders: ['armor', 'breach-charge'],
      equip: true,
      fireScientistsWhenDone: true,
      reserveTrophies: true,
      hold: 'all',
      gateMinRanked: 3,
    });
  });

  // п19.6 (ADR-0164): бій перехоплювача — до кінця, поки час стоїть (вада застряглого бою виправлена), і другий
  // перехоплювач — траєкторії інші: до п19.6 сід 7 вигравав на 37-й (ланцюжок 13 / 24 / 36), сід 6 програвав на 45-й.
  // п20.2 (укриття і низькі перешкоди, ADR-0166): сід 6 виграє на 43-й у п'ятому фіналі (було 41-ша, третій),
  // сід 7 — на 37-й; поразка — сід 5 (скан 1–30: поразок 5 — сіди 3, 4, 5, 18, 19).
  // п20.3 (ШІ ворогів з укриттям, ADR-0167; бот кампанії в дозорі, з місця не йде): сід 6 виграє на 38-й у другому фіналі, сід 5 — на 42-й; п'ятий фінал —
  // сід 7 (перемога на 42-й), поразка — сід 17 (скан 1–30: поразок 3 — сіди 1, 17, 18).
  // п20.6 (бот зі зброєю за роллю, п'ять техномантів, дозор з укриттям, «Град» ×0,6; ADR-0170): сід 7 виграє на 42-й
  // у другому фіналі, ланцюжок 19 / 33 / 41-ша, зброю досліджено у вільному слоті до «Пеленгу брами»; поразка —
  // сід 17 на 44-й (скан 1–30: поразок 6 — сіди 2, 17, 18, 19, 22, 25).
  // п22.2 (гілки «Сержанта» й «Ветерана» в бота, ADR-0183): сід 7 виграє на 41-й у першому фіналі, загиблих 11 → 6,
  // ланцюжок той самий; поразка сіду 17 — та сама 44-та доба; сіди переміряє п22.8 (ADR-0182 «Наслідки»).
  it('повна партія, сід 7 «норма»: ланцюжок 15 / 27 / 31-ша доба, зброя до «Пеленгу», перемога на 31-й у першому фіналі; байт-у-байт', () => {
    const days: Record<string, number> = {};
    const r = simulateParty(7, 'норма', {
      policy: CAMPAIGN_POLICY,
      onTick: (p) => {
        for (const id of p.research.completed) days[id] ??= Math.floor(p.geo.minute / 1440) + 1;
      },
    });
    expect([r.outcome, r.endDay, r.gateAttempts, r.assaults, r.soldiersLost]).toEqual(['перемога', 31, 1, 0, 4]); // п22.5 (ADR-0187): дослідники ростуть рівнем — 41-ша → 31-ша
    expect(r.completedProjects).toEqual(['optics', 'shotgun', 'armor', 'rift-anatomy', 'mg', 'sniper', 'gate-bearing', 'gate-key']);
    expect([days['rift-anatomy'], days['gate-bearing'], days['gate-key']]).toEqual([15, 27, 31]);
    expect(simulateParty(7, 'норма', { policy: CAMPAIGN_POLICY })).toEqual(r);
  }, 30_000);

  it('повна партія, сід 17 «норма»: фінали програно, поразка за загрозою на 38-й добі', () => {
    const r = simulateParty(17, 'норма', { policy: CAMPAIGN_POLICY });
    expect([r.outcome, r.endDay, r.gateAttempts, r.assaults]).toEqual(['поразка', 38, 5, 3]); // п22.5: до п22.5 — 44-та, 2 спроби Брами
  }, 30_000);

  it('onTick: виклик на кожен тік, результат той самий, що без спостерігача', () => {
    let calls = 0;
    const r = simulateParty(42, 'норма', { maxDays: 3, onTick: () => (calls += 1) });
    expect(calls).toBe(r.ticks);
    expect(r).toEqual(simulateParty(42, 'норма', { maxDays: 3 }));
  });

  it('заряд: трофеї гончаків для незапущених ключових протоколів не витрачає; надлишок — замовляє', () => {
    const p = createParty(42, 'норма');
    p.research.completed.push('rift-anatomy'); // «Пеленг» і «Ключ» не запущено — резерв гончаків 2 («Ключ брами»)
    const pol: PartyBotPolicy = { ...BASE, projects: ['rift-anatomy', 'gate-bearing', 'gate-key'], workshopOrders: ['breach-charge'] };
    p.research.trophies.hound = 2;
    partyBotScienceStep(p, pol);
    expect(p.workshop.queue).toHaveLength(0);
    p.research.trophies.hound = 3;
    partyBotScienceStep(p, pol);
    expect(p.workshop.queue.map((o) => o.id)).toEqual(['breach-charge']);
    expect(p.research.trophies.hound).toBe(2);
  });

  it('заряд: без reserveTrophies — один трофей гончака, і замовлення є; без трофея — немає і без помилки', () => {
    const p = createParty(42, 'норма');
    p.research.completed.push('rift-anatomy');
    const pol: PartyBotPolicy = { ...BASE, projects: ['gate-key'], workshopOrders: ['breach-charge'], reserveTrophies: false };
    expect(() => partyBotScienceStep(p, pol)).not.toThrow();
    expect(p.workshop.queue).toHaveLength(0);
    p.research.trophies.hound = 1;
    partyBotScienceStep(p, pol);
    expect(p.workshop.queue.map((o) => o.id)).toEqual(['breach-charge']);
  });

  it('запущений ключовий протокол резерву не тримає — його трофеї вже списано', () => {
    const p = createParty(42, 'норма');
    p.research.completed.push('rift-anatomy');
    p.research.active.push({ id: 'gate-key', invested: 0 });
    p.research.trophies.hound = 1;
    partyBotScienceStep(p, { ...BASE, projects: ['gate-key'], workshopOrders: ['breach-charge'] });
    expect(p.workshop.queue.map((o) => o.id)).toEqual(['breach-charge']);
  });

  it('екіпірування: заряд зі складу — боєготовому, повторно не дається', () => {
    const p = createParty(42, 'норма');
    p.workshop.store['breach-charge'] = 1;
    partyBotScienceStep(p, { ...BASE, equip: true });
    const first = readySoldiers(p.roster)[0];
    expect(p.workshop.equipped[first.id]?.charge).toBe(true);
    expect(p.workshop.store['breach-charge']).toBe(0);
  });

  it('фінал: брама відкрита, але у загоні двоє від «Боєць» — чекає; троє — бій', () => {
    const p = createParty(42, 'норма');
    p.research.completed.push('gate-key');
    const squad = readySoldiers(p.roster).slice(0, 3);
    p.roster.careers[squad[0].id].xp = 2;
    p.roster.careers[squad[1].id].xp = 2;
    p.roster.careers[squad[2].id].xp = 1; // «Рекрут»
    expect(partyBotGateStep(p, CAMPAIGN_POLICY).fought).toBe(false);
    p.roster.careers[squad[2].id].xp = 2;
    expect(partyBotGateStep(p, CAMPAIGN_POLICY).fought).toBe(true);
  });

  it("дозор 'gate' звичайних місій не змінює (байт-у-байт як без дозору); 'all' — змінює", () => {
    const base = simulateParty(42, 'норма', { maxDays: 10 });
    expect(simulateParty(42, 'норма', { maxDays: 10, policy: { ...DEFAULT_PARTY_POLICY, hold: 'gate' } })).toEqual({ ...base });
    expect(simulateParty(42, 'норма', { maxDays: 10, policy: { ...DEFAULT_PARTY_POLICY, hold: 'all' } }).soldiersWounded).not.toBe(
      base.soldiersWounded
    );
  });

  it("дозор 'gate' — у бою фіналу: той самий загін б'ється інакше, ніж без дозору", () => {
    // сід бою брами — від хвилини: 10 боїв з різною хвилиною свіжим загоном — із дозором 2 перемоги, без — 0
    // (п20.2, укриття і низькі перешкоди: 4 і 1; п20.3, ШІ ворогів з укриттям: 2 і 0)
    const wins = (hold: PartyBotPolicy['hold']) => {
      let n = 0;
      for (let k = 0; k < 10; k++) {
        const p = createParty(42, 'норма');
        p.research.completed.push('gate-key');
        p.geo.minute += k * 7;
        if (partyBotGateStep(p, { ...CAMPAIGN_POLICY, gateMinRanked: undefined, hold }).outcome === 'перемога') n += 1;
      }
      return n;
    };
    expect([wins('gate'), wins(undefined)]).toEqual([2, 0]);
  });

  it("дозор 'gate' у штурмі бази не діє (байт-у-байт як без дозору); 'all' — діє (аудит PR #517)", () => {
    const run = (hold: PartyBotPolicy['hold'], k: number) => {
      const p = createParty(42, 'норма');
      p.campaign.assaultPending = true;
      p.geo.minute += k * 7;
      const info = partyBotAssaultStep(p, { ...DEFAULT_PARTY_POLICY, hold });
      return JSON.stringify([info, p.roster, p.econ.money]);
    };
    const ks = Array.from({ length: 10 }, (_, k) => k);
    expect(ks.map((k) => run('gate', k))).toEqual(ks.map((k) => run(undefined, k)));
    expect(ks.map((k) => run('all', k))).not.toEqual(ks.map((k) => run(undefined, k)));
  });

  it('фінал без gateMinRanked — одразу, як до п18.6, навіть із рекрутами', () => {
    const p = createParty(42, 'норма');
    p.research.completed.push('gate-key');
    expect(partyBotGateStep(p, { ...CAMPAIGN_POLICY, gateMinRanked: undefined }).fought).toBe(true);
  });
});
