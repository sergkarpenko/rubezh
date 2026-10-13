// src/core/economy.test.ts
// Фаза 4 (П4.2): тести економіки — баланс, надходження, витрати.
// ADR-0003: детермінізм — фіксовані сіди геосцени; жодного RNG в економіці.
// ADR-0021: модель грошей (дотація/премія/найм), числа балансу.
// Інваріант ізоляції: economyTick не витягує geo.rng — траєкторія
// геосцени з економікою і без неї байт-у-байт однакова.

import { describe, expect, it } from 'vitest';
import { advanceTime, createGeoGame, geoTick, type GeoState } from './geo';
import {
  createEconomy,
  creditMissionBonus,
  DAILY_ALLOWANCE,
  economyTick,
  HIRE_PRICE,
  MISSION_BONUS,
  spend,
  START_MONEY,
  type EconomyState,
} from './economy';

// Геосцена без НЛО, щоб тести доти не залежали від спавну.
function geoNoUfo(seed = 7): GeoState {
  return createGeoGame({ seed, spawnChance: 0, maxUfos: 0 });
}

describe('createEconomy', () => {
  it('стартовий баланс 300, дотація за добу 1 ще не нарахована, лог порожній', () => {
    const econ = createEconomy();
    expect(econ.money).toBe(START_MONEY);
    expect(econ.lastAllowanceDay).toBe(0);
    expect(econ.log).toEqual([]);
  });
});

describe('economyTick — добова дотація (ADR-0021)', () => {
  it('протягом доби 1 дотації немає: доба ще не завершена', () => {
    const econ = createEconomy();
    const geo = geoNoUfo();
    advanceTime(geo, 47); // 23:30 дня 1
    economyTick(econ, geo);
    expect(econ.money).toBe(START_MONEY);
    expect(econ.log).toEqual([]);
  });

  it('межа дня: 48-й тік завершує добу 1 → +100 з подією allowance', () => {
    const econ = createEconomy();
    const geo = geoNoUfo();
    advanceTime(geo, 48); // 00:00 дня 2
    economyTick(econ, geo);
    expect(econ.money).toBe(START_MONEY + DAILY_ALLOWANCE);
    expect(econ.log).toEqual([{ type: 'allowance', day: 1, amount: DAILY_ALLOWANCE }]);
  });

  it('тик-у-тик і одним викликом після 96 тіків дають однаковий результат', () => {
    const step = createEconomy();
    const geoStep = geoNoUfo();
    for (let i = 0; i < 96; i++) {
      geoTick(geoStep);
      economyTick(step, geoStep);
    }
    const batch = createEconomy();
    const geoBatch = geoNoUfo();
    advanceTime(geoBatch, 96);
    economyTick(batch, geoBatch);
    expect(batch.money).toBe(step.money);
    expect(batch.money).toBe(START_MONEY + 2 * DAILY_ALLOWANCE);
    expect(batch.log).toEqual(step.log);
  });

  it('декілька діб одним викликом: окрема подія на кожну добу', () => {
    const econ = createEconomy();
    const geo = geoNoUfo();
    advanceTime(geo, 48 * 5); // 00:00 дня 6 → завершено доби 1–5
    economyTick(econ, geo);
    expect(econ.lastAllowanceDay).toBe(5);
    expect(econ.money).toBe(START_MONEY + 5 * DAILY_ALLOWANCE);
    expect(econ.log.map((e) => (e.type === 'allowance' ? e.day : 0))).toEqual([1, 2, 3, 4, 5]);
  });

  it('повторний виклик без нової доби — no-op (подвійного нарахування немає)', () => {
    const econ = createEconomy();
    const geo = geoNoUfo();
    advanceTime(geo, 48);
    economyTick(econ, geo);
    const money = econ.money;
    economyTick(econ, geo); // той самий день 2, доба 2 ще триває
    expect(econ.money).toBe(money);
    expect(econ.log).toHaveLength(1);
  });
});

describe('creditMissionBonus — премія за місію (ADR-0021)', () => {
  it('премія за тип НЛО: розвідник 150, збирач 250', () => {
    const econ = createEconomy();
    creditMissionBonus(econ, 'розвідник');
    expect(econ.money).toBe(START_MONEY + MISSION_BONUS['розвідник']);
    creditMissionBonus(econ, 'збирач');
    expect(econ.money).toBe(START_MONEY + MISSION_BONUS['розвідник'] + MISSION_BONUS['збирач']);
    expect(econ.log).toEqual([
      { type: 'mission_bonus', kind: 'розвідник', amount: MISSION_BONUS['розвідник'] },
      { type: 'mission_bonus', kind: 'збирач', amount: MISSION_BONUS['збирач'] },
    ]);
  });

  it('премія не залежить від стану геосцени (лише тип НЛО)', () => {
    const econ = createEconomy();
    creditMissionBonus(econ, 'збирач');
    expect(econ.money).toBe(START_MONEY + 250);
  });
});

describe('spend — витрати (примітив найму П4.3)', () => {
  it('списує суму і пише подію spend', () => {
    const econ = createEconomy();
    spend(econ, HIRE_PRICE);
    expect(econ.money).toBe(START_MONEY - HIRE_PRICE);
    expect(econ.log).toEqual([{ type: 'spend', amount: HIRE_PRICE }]);
  });

  it('грошей менше суми — помилка з українським текстом, баланс не змінюється', () => {
    const econ = createEconomy();
    spend(econ, 250); // лишається 50
    expect(() => spend(econ, HIRE_PRICE)).toThrow('Недостатньо грошей: 50 < 100');
    expect(econ.money).toBe(50);
    expect(econ.log).toHaveLength(1);
  });

  it('некоректна сума (дробова, нуль, від’ємна) — помилка', () => {
    const econ = createEconomy();
    expect(() => spend(econ, 10.5)).toThrow('цілим числом');
    expect(() => spend(econ, 0)).toThrow('цілим числом');
    expect(() => spend(econ, -5)).toThrow('цілим числом');
    expect(econ.money).toBe(START_MONEY);
    expect(econ.log).toEqual([]);
  });
});

describe('інваріанти ізоляції (ADR-0002/0003)', () => {
  it('economyTick не витягує geo.rng: траєкторія геосцени ідентична з економікою і без', () => {
    const geoPlain = createGeoGame({ seed: 42 });
    const geoEcon = createGeoGame({ seed: 42 });
    const econ: EconomyState = createEconomy();
    for (let i = 0; i < 48 * 3; i++) {
      geoTick(geoPlain);
      geoTick(geoEcon);
      economyTick(econ, geoEcon);
    }
    expect(geoEcon.minute).toBe(geoPlain.minute);
    expect(geoEcon.log).toEqual(geoPlain.log);
    // та сама траєкторія при повторі: один сід + дії = той самий результат
    const geoAgain = createGeoGame({ seed: 42 });
    const econAgain = createEconomy();
    for (let i = 0; i < 48 * 3; i++) {
      geoTick(geoAgain);
      economyTick(econAgain, geoAgain);
    }
    expect(geoAgain.log).toEqual(geoPlain.log);
    expect(econAgain).toEqual(econ);
  });

  it('повний міні-цикл: дотації + премія − найм дають відтворюваний баланс', () => {
    const run = () => {
      const econ = createEconomy();
      const geo = geoNoUfo();
      advanceTime(geo, 48 * 2); // дві доби → +200
      economyTick(econ, geo);
      creditMissionBonus(econ, 'збирач'); // перемога над збирачем
      spend(econ, HIRE_PRICE); // найм (П4.3)
      return econ;
    };
    expect(run()).toEqual(run());
    expect(run().money).toBe(START_MONEY + 2 * DAILY_ALLOWANCE + 250 - HIRE_PRICE);
  });
});
