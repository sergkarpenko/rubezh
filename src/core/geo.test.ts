// src/core/geo.test.ts
// Юніт-тести стратегічного ядра (ітерація 4.1). Запуск: npx vitest
// Логіка всіх сценаріїв попередньо перевірена в пісочниці.

import { describe, expect, it } from 'vitest';
import { advanceTime, chebyshevWrap, createGeoGame, detectedUfos, geoClock, missionTargets, type Ufo } from './geo';

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

describe('geo: час', () => {
  it('1 тік = 30 хвилин; 48 тіків = доба з подією day', () => {
    const s = createGeoGame({ seed: 7, spawnChance: 0 });
    advanceTime(s, 3);
    expect(geoClock(s)).toBe('Д1 01:30');
    advanceTime(s, 45);
    expect(geoClock(s)).toBe('Д2 00:00');
    expect(s.log.filter((e) => e.type === 'day')).toEqual([{ type: 'day', day: 2, minute: 1440 }]);
  });

  it('негативна або неціла кількість тіків — помилка', () => {
    const s = createGeoGame({ seed: 1 });
    expect(() => advanceTime(s, -1)).toThrow();
    expect(() => advanceTime(s, 1.5)).toThrow();
  });
});

describe('geo: детермінізм', () => {
  it('один сід — повністю однаковий лог і стан', () => {
    const run = () => {
      const s = createGeoGame({ seed: 42 });
      advanceTime(s, 480);
      return JSON.stringify({ log: s.log, ufos: s.ufos, minute: s.minute });
    };
    expect(run()).toBe(run());
  });

  it('різні сіди — різні партії', () => {
    const a = createGeoGame({ seed: 1 });
    const b = createGeoGame({ seed: 2 });
    advanceTime(a, 480);
    advanceTime(b, 480);
    expect(JSON.stringify(a.log)).not.toBe(JSON.stringify(b.log));
  });
});

describe('geo: спавн НЛО', () => {
  it('spawnChance=1: щотік новий НЛО, але не більше maxUfos', () => {
    const s = createGeoGame({ seed: 1, spawnChance: 1, maxUfos: 3 });
    advanceTime(s, 5);
    expect(s.ufos.length).toBe(3);
    expect(s.log.filter((e) => e.type === 'ufo_spawned').length).toBe(3);
  });
});

describe('geo: радар і туман', () => {
  it('НЛО в межах радара виявляється за тік, поза межами — ні', () => {
    const s = createGeoGame({ seed: 1, spawnChance: 0 });
    s.ufos.push(mkUfo({ id: 'a', pos: { x: 8, y: 5 }, target: { x: 14, y: 7 } }));
    s.ufos.push(mkUfo({ id: 'b', pos: { x: 2, y: 0 }, target: { x: 2, y: 7 } }));
    advanceTime(s, 1);
    expect(s.ufos[0].detected).toBe(true);
    expect(s.ufos[1].detected).toBe(false);
    expect(detectedUfos(s).map((u) => u.id)).toEqual(['a']);
  });

  it('замикання по X: відстань через край, рух і виявлення через край', () => {
    expect(chebyshevWrap({ x: 0, y: 4 }, { x: 15, y: 4 })).toBe(1);
    const s = createGeoGame({ seed: 1, spawnChance: 0, base: { x: 0, y: 4 } });
    s.ufos.push(mkUfo({ id: 'w', pos: { x: 15, y: 4 }, target: { x: 1, y: 4 } }));
    advanceTime(s, 1);
    expect(s.ufos[0].detected).toBe(true); // радар «бачить» через край світу
    expect(s.ufos[0].pos).toEqual({ x: 0, y: 4 }); // рух НЛО через край світу
  });
});

describe('geo: життєвий цикл НЛО', () => {
  it('летить → приземлився у цілі → вікно 8 тіків → відлітає', () => {
    const s = createGeoGame({ seed: 1, spawnChance: 0 });
    s.ufos.push(mkUfo({ id: 'l', pos: { x: 8, y: 4 }, target: { x: 10, y: 4 } }));
    advanceTime(s, 2);
    const u = s.ufos.find((x) => x.id === 'l')!;
    expect(u.status).toBe('приземлився');
    expect(u.landedTicksLeft).toBe(8); // вікно не витікає в тік посадки
    advanceTime(s, 8);
    expect(s.ufos.some((x) => x.id === 'l')).toBe(false);
    expect(s.log.some((e) => e.type === 'ufo_left' && e.ufoId === 'l')).toBe(true);
  });

  it('збирач рухається раз на два тіки', () => {
    const s = createGeoGame({ seed: 1, spawnChance: 0 });
    s.ufos.push(mkUfo({ id: 'h', kind: 'збирач', pos: { x: 0, y: 0 }, target: { x: 5, y: 0 }, landedTicksLeft: 16 }));
    advanceTime(s, 1);
    expect(s.ufos[0].pos).toEqual({ x: 0, y: 0 }); // непарний тік — стоїть
    advanceTime(s, 1);
    expect(s.ufos[0].pos).toEqual({ x: 1, y: 0 }); // парний тік — крок
  });
});

describe('geo: місії', () => {
  it('missionTargets: лише виявлені приземлені НЛО', () => {
    const s = createGeoGame({ seed: 1, spawnChance: 0 });
    s.ufos.push(mkUfo({ id: 'm1', pos: { x: 8, y: 4 }, target: { x: 8, y: 4 }, detected: true, status: 'приземлився' }));
    s.ufos.push(mkUfo({ id: 'm2', pos: { x: 3, y: 3 }, target: { x: 3, y: 3 }, status: 'приземлився' })); // невиявлений
    s.ufos.push(mkUfo({ id: 'm3', pos: { x: 4, y: 4 }, target: { x: 9, y: 7 }, detected: true })); // ще в повітрі
    expect(missionTargets(s).map((u) => u.id)).toEqual(['m1']);
  });
});

describe('geo: валідація', () => {
  it('база за межами світу — помилка', () => {
    expect(() => createGeoGame({ base: { x: 99, y: 0 } })).toThrow();
  });
});
