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
import { fireSoldier } from './squad';
import { HIRE_PRICE } from './economy';
import { PASSIVE_POLICY } from './intercept-bot';
import { DEFAULT_PARTY_POLICY, TICKS_PER_DAY, partyBotHireStep, simulateParty } from './party-bot';

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
    expect(r.hireSpent).toBe(30 * HIRE_PRICE);
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
        expect(r.hireSpent).toBe(r.hiredTotal * HIRE_PRICE);
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
