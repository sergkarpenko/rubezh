// src/core/geo.test.ts
// Юніт-тести стратегічного ядра (ітерація 4.1). Запуск: npx vitest
// Логіка всіх сценаріїв попередньо перевірена в пісочниці.

import { describe, expect, it } from 'vitest';
import type { RNG } from './combat';
import { advanceTime, chebyshevWrap, createGeoGame, detectedUfos, geoClock, missionTargets, WORLD_H, WORLD_W, type Ufo } from './geo';

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

// Т.11: крок НЛО до цілі (stepToward) — через рухи в geoTick. Спавн вимкнено,
// розвідник рухається щотіку.
describe('geo: крок НЛО до цілі (Т.11)', () => {
  // Клітинки НЛО після кожного з ticks тіків, записом 'x,y'.
  function fly(from: [number, number], to: [number, number], ticks: number): string[] {
    const s = createGeoGame({ seed: 1, spawnChance: 0 });
    s.ufos.push(mkUfo({ id: 'u', pos: { x: from[0], y: from[1] }, target: { x: to[0], y: to[1] } }));
    const track: string[] = [];
    for (let i = 0; i < ticks; i++) {
      advanceTime(s, 1);
      track.push(s.ufos[0].pos.x + ',' + s.ufos[0].pos.y);
    }
    return track;
  }

  it('ціль по інший бік краю світу: коротший шлях — через край, в обидва боки', () => {
    expect(fly([1, 4], [15, 4], 2)).toEqual(['0,4', '15,4']); // на захід: два кроки замість чотирнадцяти
    expect(fly([14, 4], [0, 4], 2)).toEqual(['15,4', '0,4']); // на схід
  });

  it('рівно півсвіту (8 клітинок): обидва шляхи однакові — НЛО не йде через край', () => {
    expect(fly([0, 4], [8, 4], 1)).toEqual(['1,4']);
    expect(fly([8, 4], [0, 4], 1)).toEqual(['7,4']);
  });

  it('вісь кроку — та, де лишок більший; за рівних лишків — X', () => {
    // лишки X/Y: 2/3 → крок по Y; 2/2 → по X; 1/2 → по Y
    expect(fly([3, 3], [5, 6], 3)).toEqual(['3,4', '4,4', '4,5']);
  });
});

describe('geo: спавн, радар, журнал — точні значення (Т.11)', () => {
  const seqRng = (vals: number[]): RNG => {
    let i = 0;
    return () => vals[i++ % vals.length];
  };

  it('вузол на крайніх клітинках світу дозволений, за будь-яким краєм — помилка', () => {
    expect(createGeoGame({ base: { x: 0, y: 0 } }).base).toEqual({ x: 0, y: 0 });
    expect(createGeoGame({ base: { x: WORLD_W - 1, y: WORLD_H - 1 } }).base).toEqual({ x: 15, y: 8 });
    for (const base of [
      { x: -1, y: 4 },
      { x: 8, y: -1 },
      { x: WORLD_W, y: 4 },
      { x: 8, y: WORLD_H },
    ]) {
      expect(() => createGeoGame({ base })).toThrow('за межами мапи світу');
    }
  });

  it('нуль тіків — дозволено, час стоїть', () => {
    const s = createGeoGame({ seed: 1 });
    advanceTime(s, 0);
    expect(s.minute).toBe(0);
  });

  it('спавн: кидок, що дорівнює шансу, — НЛО немає', () => {
    const s = createGeoGame({ rng: seqRng([0.5]), spawnChance: 0.5 });
    advanceTime(s, 1);
    expect(s.ufos).toHaveLength(0);
  });

  it('спавн: кидок типу 0.7 — уже збирач; клітинка і ціль — з наступних кидків; подія в журналі', () => {
    // кидки: спавн, тип, клітинка (x, y), ціль (x, y)
    const s = createGeoGame({ rng: seqRng([0, 0.7, 0.5, 0.5, 0.25, 0.25]), spawnChance: 0.5 });
    advanceTime(s, 1);
    expect(s.ufos).toHaveLength(1);
    expect(s.ufos[0]).toMatchObject({ id: 'ufo1', kind: 'збирач', pos: { x: 8, y: 4 }, target: { x: 4, y: 2 } });
    // збирач на непарному тіку стоїть; з'явився над вузлом — радар бачить одразу
    expect(s.log).toEqual([
      { type: 'ufo_spawned', ufoId: 'ufo1', kind: 'збирач', pos: { x: 8, y: 4 }, minute: 30 },
      { type: 'ufo_detected', ufoId: 'ufo1', pos: { x: 8, y: 4 }, minute: 30 },
    ]);
  });

  it('id НЛО — ufo1, ufo2, ufo3 у порядку появи', () => {
    const s = createGeoGame({ seed: 1, spawnChance: 1, maxUfos: 3 });
    advanceTime(s, 3);
    expect(s.log.filter((e) => e.type === 'ufo_spawned').map((e) => e.ufoId)).toEqual(['ufo1', 'ufo2', 'ufo3']);
  });

  it('радар: рівно 4 клітинки від вузла — виявлено, 5 — ні', () => {
    const s = createGeoGame({ seed: 1, spawnChance: 0 }); // вузол (8,4)
    s.ufos.push(mkUfo({ id: 'near', pos: { x: 12, y: 4 }, target: { x: 12, y: 4 }, status: 'приземлився' }));
    s.ufos.push(mkUfo({ id: 'far', pos: { x: 13, y: 4 }, target: { x: 13, y: 4 }, status: 'приземлився' }));
    advanceTime(s, 1);
    expect(detectedUfos(s).map((u) => u.id)).toEqual(['near']);
    expect(s.log).toEqual([{ type: 'ufo_detected', ufoId: 'near', pos: { x: 12, y: 4 }, minute: 30 }]);
  });

  it('НЛО вже у клітинці цілі: посадка без руху', () => {
    const s = createGeoGame({ seed: 1, spawnChance: 0 });
    s.ufos.push(mkUfo({ id: 'u', pos: { x: 1, y: 1 }, target: { x: 1, y: 1 } }));
    advanceTime(s, 1);
    expect(s.ufos[0].status).toBe('приземлився');
    expect(s.log).toEqual([{ type: 'ufo_landed', ufoId: 'u', pos: { x: 1, y: 1 }, minute: 30 }]);
  });

  it('журнал перельоту: крок — «звідки» і «куди», посадка — клітинка цілі', () => {
    const s = createGeoGame({ seed: 1, spawnChance: 0 });
    s.ufos.push(mkUfo({ id: 'u', pos: { x: 0, y: 0 }, target: { x: 1, y: 0 } }));
    advanceTime(s, 1);
    expect(s.log).toEqual([
      { type: 'ufo_move', ufoId: 'u', from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, minute: 30 },
      { type: 'ufo_landed', ufoId: 'u', pos: { x: 1, y: 0 }, minute: 30 },
    ]);
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
