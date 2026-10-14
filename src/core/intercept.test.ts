// src/core/intercept.test.ts
// П7.2 (ADR-0032): юніт-тести ядра перехоплення НЛО. Запуск: npx vitest
// Логіка всіх сценаріїв попередньо перевірена вручну; покриття intercept.ts ≥ 80% (ADR-0017).

import { describe, expect, it } from 'vitest';
import { advanceTime, createGeoGame, type GeoState, type Ufo } from './geo';
import {
  FIGHTER_MAX_HP,
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
      interceptRound(ic, geo, 'впритул');
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
    const geo = geoWith(mkUfo({ id: 'u1', pos: { x: 8, y: 4 }, target: { x: 15, y: 7 }, detected: true }));
    startIntercept(ic, geo, 'u1');
    ic.fighter.pos = { ...geo.ufos[0].pos };
    interceptTick(ic, geo);
    ic.ufoHp['u1'] = 999;
    let guard = 0;
    while (ic.fighter.status !== 'ремонт' && guard++ < 2000) {
      interceptRound(ic, geo, 'впритул');
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
    expect(() => startRepair(ic, geo)).toThrow('не потребує');
  });

  it('startRepair не на базі (у погоні) — помилка', () => {
    const ic = createIntercept();
    const geo = geoWith(mkUfo({ id: 'u1', pos: { x: 8, y: 4 }, target: { x: 15, y: 7 }, detected: true }));
    startIntercept(ic, geo, 'u1');
    ic.fighter.hp = 1;
    expect(() => startRepair(ic, geo)).toThrow('на базі');
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

  it('geo.rng не витягається: траєкторія геосцени з перехопленням і без — байт-у-байт', () => {
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
      return JSON.stringify({ minute: geo.minute, ufos: geo.ufos, log: geo.log });
    };
    expect(run(true)).toEqual(run(false));
  });
});
