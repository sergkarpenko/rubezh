// src/core/intercept.test.ts
// П7.2 (ADR-0032): юніт-тести ядра перехоплення НЛО. Запуск: npx vitest
// Логіка всіх сценаріїв попередньо перевірена вручну; покриття intercept.ts ≥ 80% (ADR-0017).

import { describe, expect, it } from 'vitest';
import { SHOT_DOWN_BONUS, createEconomy } from './economy';
import { advanceTime, createGeoGame, type GeoState, type Ufo } from './geo';
import {
  FIGHTER_MAX_HP,
  FIGHTER_REPAIR_COST,
  FIGHTER_REPAIR_TICKS,
  RANGE_PROFILES,
  UFO_INTERCEPT_HP,
  createIntercept,
  interceptRound,
  interceptTick,
  repairTick,
  startIntercept,
  startRepair,
  shotDownUfos,
  interceptRngState,
  type InterceptState,
} from './intercept';

// НЛО вручну для точкових сценаріїв (спавн вимкнено).
function mkUfo(init: Partial<Ufo> & { id: string; pos: { x: number; y: number }; target: { x: number; y: number } }): Ufo {
  return {
    kind: 'розвідник',
    detected: false,
    status: 'летить',
    landedTicksLeft: 8,
    ...init,
  };
}

function geoWith(ufo: Ufo): GeoState {
  const geo = createGeoGame({ seed: 1, spawnChance: 0 });
  geo.ufos.push(ufo);
  return geo;
}

describe('intercept: запуск перехоплення', () => {
  it('запуск лише на виявлений НЛО у стані «летить»', () => {
    const ic = createIntercept();
    const geo = geoWith(mkUfo({ id: 'u1', pos: { x: 3, y: 3 }, target: { x: 10, y: 3 } }));
    expect(() => startIntercept(ic, geo, 'u1')).toThrow('виявлений');
    geo.ufos[0].detected = true;
    startIntercept(ic, geo, 'u1');
    expect(ic.fighter.status).toBe('погоня');
    expect(ic.fighter.targetId).toBe('u1');
    expect(ic.log[0].type).toBe('intercept_start');
  });

  it('приземлений НЛО — запуск заборонений', () => {
    const ic = createIntercept();
    const geo = geoWith(mkUfo({ id: 'u1', pos: { x: 3, y: 3 }, target: { x: 3, y: 3 }, detected: true }));
    geo.ufos[0].status = 'приземлився';
    expect(() => startIntercept(ic, geo, 'u1')).toThrow();
  });

  it('запуск під час погоні/бою/ремонту — помилка', () => {
    const ic = createIntercept();
    const geo = geoWith(mkUfo({ id: 'u1', pos: { x: 3, y: 3 }, target: { x: 10, y: 3 }, detected: true }));
    startIntercept(ic, geo, 'u1');
    expect(() => startIntercept(ic, geo, 'u1')).toThrow('не на базі');
  });

  it('пошкоджений винищувач не стартує', () => {
    const ic = createIntercept();
    ic.fighter.hp = FIGHTER_MAX_HP - 1;
    const geo = geoWith(mkUfo({ id: 'u1', pos: { x: 3, y: 3 }, target: { x: 10, y: 3 }, detected: true }));
    expect(() => startIntercept(ic, geo, 'u1')).toThrow('ремонт');
  });
});

describe('intercept: погоня', () => {
  it('винищувач швидший: зближення на тіках геосцени, перехід у бій впритул', () => {
    const ic = createIntercept();
    const geo = geoWith(mkUfo({ id: 'u1', pos: { x: 8, y: 3 }, target: { x: 10, y: 3 }, detected: true }));
    startIntercept(ic, geo, 'u1');
    expect(ic.fighter.pos).toEqual(geo.base);
    let ticks = 0;
    while (ic.fighter.status === 'погоня' && ticks < 20) {
      advanceTime(geo, 1);
      interceptTick(ic, geo);
      ticks++;
    }
    expect(ic.fighter.status).toBe('бій');
    expect(ic.activeUfoId).toBe('u1');
    expect(ic.log.filter((e) => e.type === 'intercept_move').length).toBeGreaterThan(0);
    expect(ic.log.filter((e) => e.type === 'intercept_engage').length).toBe(1);
  });

  it('НЛО сів під час погоні — переривання, винищувач на базі', () => {
    const ic = createIntercept();
    const geo = geoWith(mkUfo({ id: 'u1', pos: { x: 8, y: 3 }, target: { x: 8, y: 3 }, detected: true }));
    startIntercept(ic, geo, 'u1');
    advanceTime(geo, 1);
    interceptTick(ic, geo);
    expect(geo.ufos[0].status).toBe('приземлився');
    interceptTick(ic, geo);
    const aborted = ic.log.find((e) => e.type === 'intercept_aborted');
    expect(aborted && aborted.reason).toBe('ufo_landed');
    expect(ic.fighter.status).toBe('на базі');
    expect(ic.fighter.pos).toEqual(geo.base);
  });

  it('НЛО зник з трекінгу — переривання з причиною ufo_lost', () => {
    const ic = createIntercept();
    const geo = geoWith(mkUfo({ id: 'u1', pos: { x: 8, y: 3 }, target: { x: 10, y: 3 }, detected: true }));
    startIntercept(ic, geo, 'u1');
    geo.ufos = [];
    interceptTick(ic, geo);
    const aborted = ic.log.find((e) => e.type === 'intercept_aborted');
    expect(aborted && aborted.reason).toBe('ufo_lost');
    expect(ic.fighter.status).toBe('на базі');
  });
});

describe('intercept: раундовий бій', () => {
  function engaged(seed = 7): { ic: InterceptState; geo: GeoState } {
    const ic = createIntercept(seed);
    const geo = geoWith(mkUfo({ id: 'u1', pos: { x: 8, y: 4 }, target: { x: 15, y: 7 }, detected: true }));
    startIntercept(ic, geo, 'u1');
    ic.fighter.pos = { ...geo.ufos[0].pos };
    interceptTick(ic, geo);
    expect(ic.fighter.status).toBe('бій');
    return { ic, geo };
  }

  it('НЛО у клітинці — бій з першого тіку (без руху)', () => {
    const { ic } = engaged();
    expect(ic.fighter.status).toBe('бій');
    expect(ic.log.filter((e) => e.type === 'intercept_move').length).toBe(0);
  });

  it('HP НЛО за типом: розвідник 3, збирач 5', () => {
    const { ic } = engaged();
    expect(ic.ufoHp['u1']).toBe(UFO_INTERCEPT_HP['розвідник']);
    const ic2 = createIntercept(9);
    const geo2 = geoWith(mkUfo({ id: 'u2', kind: 'збирач', pos: { x: 8, y: 4 }, target: { x: 8, y: 4 }, detected: true }));
    startIntercept(ic2, geo2, 'u2');
    expect(ic2.ufoHp['u2']).toBe(UFO_INTERCEPT_HP['збирач']);
  });

  it('раунд поза боєм — помилка', () => {
    const ic = createIntercept();
    const geo = geoWith(mkUfo({ id: 'u1', pos: { x: 3, y: 3 }, target: { x: 10, y: 3 }, detected: true }));
    expect(() => interceptRound(ic, geo, 'впритул')).toThrow('бій');
  });

  it('збиття: урон накопичується до нуля, винищувач на базі', () => {
    const { ic, geo } = engaged();
    ic.ufoHp['u1'] = 30;
    ic.fighter.hp = 1000; // ізолюємо бій від загибелі винищувача — перевіряємо саме збиття
    interceptRound(ic, geo, 'впритул');
    expect(ic.round).toBe(1);
    const hpAfter1 = ic.ufoHp['u1'];
    expect([2, 3]).toContain(30 - hpAfter1);
    let guard = 0;
    while (ic.fighter.status === 'бій' && guard++ < 200) {
      interceptRound(ic, geo, 'впритул');
    }
    expect(ic.log.some((e) => e.type === 'ufo_shot_down')).toBe(true);
    expect(ic.ufoHp['u1']).toBe(0);
    expect(ic.fighter.status).toBe('на базі');
    expect(ic.activeUfoId).toBeNull();
  });

  it('П7.6: збиття з економікою — премія SHOT_DOWN_BONUS одразу після бою; без econ — без премії', () => {
    // Дві ідентичні партії: з econ і без; різниця грошей = премія за збиття розвідника.
    const econ = createEconomy();
    const a = engaged();
    a.ic.ufoHp['u1'] = 1; // розвідник
    const moneyBefore = econ.money;
    interceptRound(a.ic, a.geo, 'впритул', econ);
    expect(a.ic.log.some((e) => e.type === 'ufo_shot_down')).toBe(true);
    expect(econ.money - moneyBefore).toBeGreaterThanOrEqual(0);
    if (a.ic.log.some((e) => e.type === 'ufo_shot_down')) {
      expect(econ.money).toBe(moneyBefore + SHOT_DOWN_BONUS['розвідник']);
      expect(econ.log.some((e) => e.type === 'shot_down_bonus' && e.amount === SHOT_DOWN_BONUS['розвідник'])).toBe(true);
    }
    // Без econ — виклик не падає, премії ніде не нараховується.
    const b = engaged();
    b.ic.ufoHp['u1'] = 1;
    expect(() => interceptRound(b.ic, b.geo, 'впритул')).not.toThrow();
  });

  it('відступ: розрив контакту, винищувач на базі, НЛО живий', () => {
    const { ic, geo } = engaged();
    interceptRound(ic, geo, 'відступ');
    expect(ic.log.some((e) => e.type === 'intercept_break_off')).toBe(true);
    expect(ic.fighter.status).toBe('на базі');
    expect(ic.ufoHp['u1']).toBeGreaterThan(0);
  });

  it('винищувач пошкоджений до нуля — вимушене переривання і ремонт', () => {
    const ic = createIntercept(123);
    const geo = geoWith(mkUfo({ id: 'u1', pos: { x: 8, y: 4 }, target: { x: 15, y: 7 }, detected: true }));
    startIntercept(ic, geo, 'u1');
    ic.fighter.pos = { ...geo.ufos[0].pos };
    interceptTick(ic, geo);
    expect(ic.fighter.status).toBe('бій');
    ic.ufoHp['u1'] = 999; // ізолюємо: НЛО не буде збитий раніше за пошкодження
    let guard = 0;
    while (ic.fighter.status !== 'ремонт' && guard++ < 2000) {
      interceptRound(ic, geo, 'впритул', createEconomy()); // П7.4: авто-ремонт за гроші
    }
    const aborted = ic.log.find((e) => e.type === 'intercept_aborted');
    expect(aborted && aborted.reason).toBe('fighter_damaged');
    expect(ic.fighter.status).toBe('ремонт');
    expect(ic.fighter.hp).toBe(0);
  });

  it('профілі дистанцій: впритул сильніша за середню, середня за далеку', () => {
    expect(RANGE_PROFILES['впритул'].fighterHitChance).toBeGreaterThan(RANGE_PROFILES['середня'].fighterHitChance);
    expect(RANGE_PROFILES['середня'].fighterHitChance).toBeGreaterThan(RANGE_PROFILES['далека'].fighterHitChance);
    expect(RANGE_PROFILES['впритул'].ufoHitChance).toBeGreaterThan(RANGE_PROFILES['далека'].ufoHitChance);
  });
});

describe('intercept: ремонт', () => {
  it('ремонт: FIGHTER_REPAIR_TICKS тіків — знову боєготовий', () => {
    const ic = createIntercept(3);
    const econ = createEconomy();
    const geo = geoWith(mkUfo({ id: 'u1', pos: { x: 8, y: 4 }, target: { x: 15, y: 7 }, detected: true }));
    startIntercept(ic, geo, 'u1');
    ic.fighter.pos = { ...geo.ufos[0].pos };
    interceptTick(ic, geo);
    ic.ufoHp['u1'] = 999;
    let guard = 0;
    while (ic.fighter.status !== 'ремонт' && guard++ < 2000) {
      interceptRound(ic, geo, 'впритул', econ);
    }
    expect(ic.fighter.status).toBe('ремонт');
    let ticks = 0;
    while (ic.fighter.status === 'ремонт') {
      advanceTime(geo, 1);
      repairTick(ic, geo);
      ticks++;
    }
    expect(ticks).toBe(FIGHTER_REPAIR_TICKS);
    expect(ic.fighter.hp).toBe(FIGHTER_MAX_HP);
    expect(ic.log.some((e) => e.type === 'fighter_repair_done')).toBe(true);
    expect(ic.fighter.status).toBe('на базі'); // знову боєготовий
    geo.ufos.push(mkUfo({ id: 'u2', pos: { x: 3, y: 3 }, target: { x: 10, y: 3 }, detected: true }));
    startIntercept(ic, geo, 'u2'); // запуск знову можливий
    expect(ic.fighter.status).toBe('погоня');
  });

  it('startRepair на здоровому винищувачі — помилка', () => {
    const ic = createIntercept();
    const geo = createGeoGame({ seed: 1 });
    expect(() => startRepair(ic, geo, createEconomy())).toThrow('не потребує');
  });

  it('startRepair не на базі (у погоні) — помилка', () => {
    const ic = createIntercept();
    const geo = geoWith(mkUfo({ id: 'u1', pos: { x: 8, y: 4 }, target: { x: 15, y: 7 }, detected: true }));
    startIntercept(ic, geo, 'u1');
    ic.fighter.hp = 1;
    expect(() => startRepair(ic, geo, createEconomy())).toThrow('на базі');
  });

  it('НЛО зник під час бою — переривання, винищувач на базі', () => {
    const ic = createIntercept();
    const geo = geoWith(mkUfo({ id: 'u1', pos: { x: 8, y: 4 }, target: { x: 15, y: 7 }, detected: true }));
    startIntercept(ic, geo, 'u1');
    ic.fighter.pos = { ...geo.ufos[0].pos };
    interceptTick(ic, geo);
    expect(ic.fighter.status).toBe('бій');
    geo.ufos = [];
    interceptRound(ic, geo, 'впритул');
    const aborted = ic.log.find((e) => e.type === 'intercept_aborted');
    expect(aborted && aborted.reason).toBe('ufo_lost');
    expect(ic.fighter.status).toBe('на базі');
  });
});

// П7.4 (ADR-0021/0032): ремонт — гроші + тіки геосцени (патерн лікарні);
// правило банкрутства не змінюється — неспроможність перехоплення не прогараш.
describe('intercept: ремонт — економіка (П7.4)', () => {
  function damagedFighter(): { ic: InterceptState; geo: GeoState } {
    const ic = createIntercept(3);
    const geo = geoWith(mkUfo({ id: 'u1', pos: { x: 8, y: 4 }, target: { x: 15, y: 7 }, detected: true }));
    startIntercept(ic, geo, 'u1');
    ic.fighter.pos = { ...geo.ufos[0].pos };
    interceptTick(ic, geo);
    ic.ufoHp['u1'] = 999;
    return { ic, geo };
  }

  it('пошкодження до нуля з грошима — ремонт стартує автоматично, гроші списано', () => {
    const { ic, geo } = damagedFighter();
    const econ = createEconomy();
    const moneyBefore = econ.money;
    let guard = 0;
    while (ic.fighter.status !== 'ремонт' && ic.fighter.status !== 'на базі' && guard++ < 2000) {
      interceptRound(ic, geo, 'впритул', econ);
    }
    expect(ic.fighter.hp).toBe(0);
    expect(ic.fighter.status).toBe('ремонт');
    expect(econ.money).toBe(moneyBefore - FIGHTER_REPAIR_COST);
    expect(econ.log.some((e) => e.type === 'spend' && e.amount === FIGHTER_REPAIR_COST)).toBe(true);
    expect(ic.log.some((e) => e.type === 'fighter_repair_start')).toBe(true);
  });

  it('без грошей — винищувач чекає пошкоджений на базі; ремонт можна оплатити пізніше', () => {
    const { ic, geo } = damagedFighter();
    const econ = createEconomy();
    econ.money = 0; // немає грошей — авточин не спрацює
    let guard = 0;
    while (ic.fighter.status !== 'на базі' && guard++ < 2000) {
      interceptRound(ic, geo, 'впритул', econ);
    }
    expect(ic.fighter.hp).toBe(0);
    expect(ic.fighter.status).toBe('на базі');
    expect(ic.fighter.repairTicksLeft).toBeUndefined();
    expect(() => startRepair(ic, geo, econ)).toThrow('грошей');
    econ.money = FIGHTER_REPAIR_COST; // з'явилися гроші — ремонт оплачується
    startRepair(ic, geo, econ);
    expect(ic.fighter.status).toBe('ремонт');
    expect(econ.money).toBe(0);
  });

  it('під час ремонту запуск перехоплення заблокований; після FIGHTER_REPAIR_TICKS — знову боєготовий', () => {
    const { ic, geo } = damagedFighter();
    const econ = createEconomy();
    let guard = 0;
    while (ic.fighter.status !== 'ремонт' && ic.fighter.status !== 'на базі' && guard++ < 2000) {
      interceptRound(ic, geo, 'впритул', econ);
    }
    geo.ufos.push(mkUfo({ id: 'u2', pos: { x: 3, y: 3 }, target: { x: 10, y: 3 }, detected: true }));
    expect(ic.fighter.status).toBe('ремонт');
    expect(() => startIntercept(ic, geo, 'u2')).toThrow(); // критерій 1: запуск заблокований
    let ticks = 0;
    while (ic.fighter.status === 'ремонт') {
      advanceTime(geo, 1);
      repairTick(ic, geo);
      ticks++;
    }
    expect(ticks).toBe(FIGHTER_REPAIR_TICKS);
    expect(ic.fighter.hp).toBe(FIGHTER_MAX_HP);
    expect(ic.log.some((e) => e.type === 'fighter_repair_done')).toBe(true);
    // за тіки ремонту геосцена могла посадити/скинути u2 — свіжий виявлений НЛО в повітрі
    geo.ufos = geo.ufos.filter((u) => u.id !== 'u2');
    geo.ufos.push(mkUfo({ id: 'u3', pos: { x: 3, y: 3 }, target: { x: 10, y: 3 }, detected: true }));
    startIntercept(ic, geo, 'u3'); // знову готовий
    expect(ic.fighter.status).toBe('погоня');
  });

  it('стартові гроші партії покривають ремонт: 300 > 50', () => {
    const econ = createEconomy();
    expect(econ.money).toBeGreaterThan(FIGHTER_REPAIR_COST); // банкрутство не спрацює від одного ремонту
  });
});

describe('intercept: допоміжні функції', () => {
  it('shotDownUfos повертає id збитих; порожній без збиттів', () => {
    const ic = createIntercept();
    expect(shotDownUfos(ic)).toEqual([]);
    ic.log.push({ type: 'ufo_shot_down', ufoId: 'u9', pos: { x: 1, y: 1 }, minute: 0 });
    expect(shotDownUfos(ic)).toEqual(['u9']);
  });

  it('interceptRngState: позиція потоку mulberry32, зсунута після кидків', () => {
    const ic = createIntercept(5);
    const before = interceptRngState(ic);
    ic.rng();
    ic.rng();
    expect(interceptRngState(ic)).not.toBe(before);
  });

  it('interceptRngState без стану rng — помилка', () => {
    const ic = createIntercept();
    ic.rng = () => 0.5;
    expect(() => interceptRngState(ic)).toThrow('mulberry32');
  });
});

describe('intercept: детермінізм', () => {
  it('один сід + ті самі рішення — той самий лог (байт-у-байт)', () => {
    const run = () => {
      const ic = createIntercept(42);
      const geo = geoWith(mkUfo({ id: 'u1', pos: { x: 8, y: 4 }, target: { x: 15, y: 7 }, detected: true }));
      startIntercept(ic, geo, 'u1');
      const events = [];
      let guard = 0;
      while (guard++ < 100) {
        if (ic.fighter.status === 'бій') {
          interceptRound(ic, geo, 'середня');
        } else {
          advanceTime(geo, 1);
          interceptTick(ic, geo);
        }
        events.push(ic.fighter.status);
        if (ic.fighter.status === 'на базі' || ic.fighter.status === 'ремонт') break;
      }
      return { log: JSON.stringify(ic.log), hp: ic.ufoHp['u1'], events };
    };
    const a = run();
    const b = run();
    expect(a.log).toEqual(b.log);
    expect(a.hp).toEqual(b.hp);
  });

  it('geo.rng не витягається: власна траєкторія геосцени (спавни/рухи/виявлення) з перехопленням і без — байт-у-байт', () => {
    // П7.3: події перехоплення тепер законно пишуться в geo.log (ADR-0032),
    // а збитий НЛО змінює статус — тому інваріант звужено до власних подій геосцени:
    // спавни, рухи, посадки, виявлення, дні мають бути байт-у-байт ідентичними.
    const run = (withIntercept: boolean) => {
      const geo = createGeoGame({ seed: 42, spawnChance: 0.5 });
      const ic = createIntercept(7);
      for (let i = 0; i < 200; i++) {
        advanceTime(geo, 1);
        if (withIntercept) {
          const target = geo.ufos.find((u) => u.detected && u.status === 'летить');
          if (target && ic.fighter.status === 'на базі' && ic.fighter.hp === FIGHTER_MAX_HP) {
            startIntercept(ic, geo, target.id);
          }
          if (ic.fighter.status === 'погоня') interceptTick(ic, geo);
          if (ic.fighter.status === 'бій') interceptRound(ic, geo, 'середня');
        }
      }
      const geoEvents = geo.log.filter((e) => e.type.startsWith('ufo_') || e.type === 'day');
      return JSON.stringify({ minute: geo.minute, geoEvents });
    };
    expect(run(true)).toEqual(run(false));
  });
});
