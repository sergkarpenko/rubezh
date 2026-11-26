// src/core/map.test.ts
// Тести ітерації 2: A*, туман війни, генератор тестових мап. Запуск: npx vitest
// Логіка всіх сценаріїв попередньо перевірена в пісочниці.

import { describe, expect, it } from 'vitest';
import { computeVisibleCells, findPath, makeTestMap, pathApCost, reachableCells, visibleEnemies } from './map';
import { createGame, makeUnit, moveUnit, type GameMap, type GameState, type RNG, type Vec2 } from './combat';

const alwaysHit: RNG = () => 0;
const FAR: Vec2 = { x: 8, y: 10 }; // прибулець поза зонами тестів пошуку шляху

const map = (blocked: string[] = []): GameMap => ({
  width: 20,
  height: 20,
  blocked: new Set(blocked),
});

function setupGame(blocked: string[] = [], aPos: Vec2 = FAR): GameState {
  return createGame({
    map: map(blocked),
    rng: alwaysHit,
    units: [makeUnit({ id: 's1', side: 'player', pos: { x: 2, y: 2 } }), makeUnit({ id: 'a1', side: 'alien', pos: aPos })],
  });
}

describe('A*: базові шляхи', () => {
  it('відкрита мапа: оптимальний прямий шлях', () => {
    const g = setupGame();
    const p = findPath(g, { x: 2, y: 2 }, { x: 8, y: 2 })!;
    expect(p).not.toBeNull();
    expect(p).toHaveLength(6);
    expect(p[0]).toEqual({ x: 3, y: 2 });
    expect(pathApCost(p)).toBe(6);
    // усі кроки валідні: 4 напрямки, без перешкод
    let prev: Vec2 = { x: 2, y: 2 };
    for (const st of p) {
      expect(Math.abs(st.x - prev.x) + Math.abs(st.y - prev.y)).toBe(1);
      expect(g.map.blocked.has(st.x + ',' + st.y)).toBe(false);
      prev = st;
    }
    expect(p[p.length - 1]).toEqual({ x: 8, y: 2 });
  });

  it('старт = ціль → порожній шлях', () => {
    const g = setupGame();
    expect(findPath(g, { x: 2, y: 2 }, { x: 2, y: 2 })).toEqual([]);
  });
});

describe('A*: перешкоди і недосяжність', () => {
  it('обхід стіни через єдиний прохід: оптимум 14 кроків', () => {
    const wallCol: string[] = [];
    for (let y = 0; y < 20; y++) if (y !== 6) wallCol.push('5,' + y);
    const g = setupGame(wallCol);
    const p = findPath(g, { x: 2, y: 2 }, { x: 8, y: 2 })!;
    expect(p).toHaveLength(14);
    expect(p.some((st) => wallCol.includes(st.x + ',' + st.y))).toBe(false); // не крізь стіну
    expect(p.some((st) => st.x === 5 && st.y === 6)).toBe(true); // через прохід
  });

  it('замкнена ціль і зайнята ціль → null', () => {
    const g = setupGame(['7,1', '7,2', '7,3', '6,1', '6,3', '5,1', '5,3']);
    expect(findPath(g, { x: 2, y: 2 }, { x: 7, y: 2 })).toBeNull();

    const occupied = setupGame([], { x: 4, y: 2 });
    expect(findPath(occupied, { x: 2, y: 2 }, { x: 4, y: 2 })).toBeNull();
  });

  it('юніт посередині шляху обходиться стороною', () => {
    const g = setupGame([], { x: 3, y: 2 });
    const p = findPath(g, { x: 2, y: 2 }, { x: 4, y: 2 })!;
    expect(p).toHaveLength(4);
    expect(p.some((st) => st.x === 3 && st.y === 2)).toBe(false);
  });

  it('ADR-0081: юніт поза seen шляху не перекриває, у seen — обходиться; зайнята невидима ціль досяжна', () => {
    const g = setupGame([], { x: 3, y: 2 });
    const fog = findPath(g, { x: 2, y: 2 }, { x: 4, y: 2 }, undefined, new Set())!;
    expect(fog).toEqual([
      { x: 3, y: 2 },
      { x: 4, y: 2 },
    ]); // планувальник про юніта не знає — шлях прямий, крізь його клітинку
    const known = findPath(g, { x: 2, y: 2 }, { x: 4, y: 2 }, undefined, new Set(['3,2']))!;
    expect(known).toHaveLength(4); // видимий юніт — обхід, як без seen
    expect(known.some((st) => st.x === 3 && st.y === 2)).toBe(false);
    expect(findPath(g, { x: 2, y: 2 }, { x: 3, y: 2 }, undefined, new Set())).toEqual([{ x: 3, y: 2 }]);
    expect(findPath(g, { x: 2, y: 2 }, { x: 3, y: 2 }, undefined, new Set(['3,2']))).toBeNull();
  });

  it('інтеграція: findPath → moveUnit витрачає AP за шляхом', () => {
    const g = setupGame();
    const path = findPath(g, { x: 2, y: 2 }, { x: 8, y: 2 })!;
    moveUnit(g, 's1', path);
    expect(g.units[0].pos).toEqual({ x: 8, y: 2 });
    expect(g.units[0].ap).toBe(4); // 10 − 6
  });
});

describe('туман війни', () => {
  it('радіус видимості: у кутку квадрат дальності обрізаний межами мапи', () => {
    const g = setupGame();
    const vis = computeVisibleCells(g, { x: 2, y: 2 }, 'player', 5);
    expect(vis.size).toBe(64); // 8×8 після обрізання
    expect(vis.has('5,2')).toBe(true);
    expect(vis.has('0,0')).toBe(true);
    expect(vis.has('2,8')).toBe(false); // за радіусом
  });

  it('з центру мапи — повний квадрат (2×5+1)²', () => {
    const g = setupGame([], { x: 19, y: 19 }); // п17.4: демон поза квадратом огляду — юніти закривають
    expect(computeVisibleCells(g, { x: 10, y: 10 }, 'player', 5).size).toBe(121);
  });

  it('стіна видима сама, але ховає клітинки за нею', () => {
    const g = setupGame(['4,2']);
    const vis = computeVisibleCells(g, { x: 2, y: 2 }, 'player', 5);
    expect(vis.has('3,2')).toBe(true); // перед стіною
    expect(vis.has('4,2')).toBe(true); // сама стіна
    expect(vis.has('5,2')).toBe(false); // за стіною
    expect(vis.has('6,2')).toBe(false);
  });

  it('visibleEnemies: за стіною не видно, на відкритій — видно, симетрично', () => {
    const hidden = setupGame(['4,2'], { x: 6, y: 2 });
    expect(visibleEnemies(hidden, 'player')).toHaveLength(0);

    const open = setupGame([], { x: 3, y: 2 });
    expect(visibleEnemies(open, 'player').map((u) => u.id)).toEqual(['a1']);
    expect(visibleEnemies(open, 'alien').map((u) => u.id)).toEqual(['s1']);
  });
});

describe('генератор тестових мап', () => {
  it('детермінований: один сід — однакова мапа', () => {
    const a = makeTestMap(7);
    const b = makeTestMap(7);
    expect([...a.blocked]).toEqual([...b.blocked]);
    expect(a.width).toBe(b.width);
  });

  it('спавн-зони завжди чисті', () => {
    const m = makeTestMap(13, 20, 20, 0.9); // щільність 90%
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        expect(m.blocked.has(2 + dx + ',' + (2 + dy))).toBe(false);
        expect(m.blocked.has(17 + dx + ',' + (2 + dy))).toBe(false);
      }
    }
  });

  it('різні сіди дають різні мапи (найімовірніше)', () => {
    const a = makeTestMap(1, 50, 50, 0.1);
    const b = makeTestMap(2, 50, 50, 0.1);
    expect([...a.blocked]).not.toEqual([...b.blocked]);
  });
});

// --- Т.14: прогалини за мутаційним прогоном ---

describe('Т.14: бюджет вузлів A*, вибір з рівних шляхів, межі генератора', () => {
  const from: Vec2 = { x: 2, y: 2 };
  const cells = (p: Vec2[] | null): string => (p ?? []).map((c) => c.x + ',' + c.y).join(' ');

  it('maxNodes — число розкритих вузлів: пряма на 6 клітинок коштує рівно 7', () => {
    const g = setupGame();
    expect(findPath(g, from, { x: 8, y: 2 }, 7)).toHaveLength(6);
    expect(findPath(g, from, { x: 8, y: 2 }, 6)).toBeNull();
  });

  it('з рівних за довжиною шляхів обирається той самий (детермінізм траєкторій)', () => {
    expect(cells(findPath(setupGame(), from, { x: 4, y: 4 }))).toBe('3,2 4,2 4,3 4,4');
    expect(cells(findPath(setupGame(['3,2', '2,3', '4,3']), from, { x: 4, y: 4 }))).toBe('1,2 1,3 1,4 2,4 3,4 4,4');
    // стіна x = 3: обхід згори і знизу рівні (7 кроків) — обирається нижній
    expect(cells(findPath(setupGame(['3,1', '3,2', '3,3']), from, { x: 5, y: 2 }))).toBe('2,3 2,4 3,4 4,4 5,4 5,3 5,2');
  });

  it('перешкоди генератора — лише в межах мапи, ключі «x,y»', () => {
    const m = makeTestMap(3, 6, 4, 0.5);
    expect(m.blocked.size).toBeGreaterThan(0);
    for (const cell of m.blocked) expect(cell).toMatch(/^[0-5],[0-3]$/);
  });
});

describe('Т.44: reachableCells — зона ходу', () => {
  const from: Vec2 = { x: 2, y: 2 };
  const sorted = (s: Set<string>): string => [...s].sort().join(' ');

  it('ap = 0 — порожньо; клітинка старту в зону не входить', () => {
    expect(reachableCells(setupGame(), from, 0).size).toBe(0);
    expect(reachableCells(setupGame(), from, 3).has('2,2')).toBe(false);
  });

  it('відкрита мапа: ромб за Мангеттеном — 4 клітинки за 1 AP, 12 за 2 AP; край поля обрізає', () => {
    expect(sorted(reachableCells(setupGame(), from, 1))).toBe('1,2 2,1 2,3 3,2');
    expect(reachableCells(setupGame(), from, 2).size).toBe(12);
    // з кута (0,0) за 2 AP: (1,0) (0,1) (2,0) (1,1) (0,2)
    expect(sorted(reachableCells(setupGame(), { x: 0, y: 0 }, 2))).toBe('0,1 0,2 1,0 1,1 2,0');
  });

  it('стіна обрізає зону і змушує обходити: за стіною x = 3 клітинка (4,2) коштує 6 AP, а не 2', () => {
    const g = setupGame(['3,1', '3,2', '3,3']);
    expect(reachableCells(g, from, 2).has('3,2')).toBe(false);
    expect(reachableCells(g, from, 5).has('4,2')).toBe(false);
    expect(reachableCells(g, from, 6).has('4,2')).toBe(true);
  });

  it('видимий юніт обрізає зону; юніт у тумані — ні (ADR-0081)', () => {
    const g = setupGame([], { x: 3, y: 2 });
    expect(sorted(reachableCells(g, from, 1))).toBe('1,2 2,1 2,3'); // без seen усі юніти відомі
    expect(sorted(reachableCells(g, from, 1, new Set(['3,2'])))).toBe('1,2 2,1 2,3');
    expect(sorted(reachableCells(g, from, 1, new Set(['1,2'])))).toBe('1,2 2,1 2,3 3,2');
    // загиблий клітинки не займає
    g.units[1]!.alive = false;
    expect(reachableCells(g, from, 1).has('3,2')).toBe(true);
  });

  it('звірка з findPath на кожній клітинці: чотири сіди мапи, сім значень AP (одне дробове), з туманом і без', () => {
    for (const [seed, density] of [
      [1, 0.08],
      [7, 0.2],
      [42, 0.3],
      [99, 0.08],
    ] as const) {
      const g = createGame({
        map: makeTestMap(seed, 20, 20, density),
        rng: alwaysHit,
        units: [
          makeUnit({ id: 's1', side: 'player', pos: { x: 2, y: 2 } }),
          makeUnit({ id: 's2', side: 'player', pos: { x: 3, y: 2 } }),
          makeUnit({ id: 'a1', side: 'alien', pos: { x: 2, y: 4 } }),
          makeUnit({ id: 'a2', side: 'alien', pos: { x: 17, y: 2 } }),
        ],
      });
      for (const seen of [undefined, computeVisibleCells(g, from, 'player', 3)]) {
        // довжина найкоротшого шляху до кожної клітинки — один раз на мапу
        const cost = new Map<string, number>();
        for (let y = 0; y < 20; y++)
          for (let x = 0; x < 20; x++) {
            const p = findPath(g, from, { x, y }, undefined, seen);
            if (p !== null && p.length > 0) cost.set(x + ',' + y, pathApCost(p));
          }
        for (const ap of [0, 1, 2.5, 3, 6, 10, 40]) {
          const expected = new Set([...cost].filter(([, c]) => c <= ap).map(([k]) => k));
          expect(sorted(reachableCells(g, from, ap, seen)), 'сід ' + seed + ', ap ' + ap).toBe(sorted(expected));
        }
        expect(cost.size).toBeGreaterThan(50);
      }
    }
  });

  it('ap = Infinity: цикл зупиняється, коли frontier порожній; зона точна, оточений start — порожньо', () => {
    const g = setupGame();
    expect(reachableCells(g, from, Infinity).size).toBe(398);
    const walled = setupGame(['1,2', '3,2', '2,1', '2,3']);
    expect(reachableCells(walled, from, Infinity).size).toBe(0);
  });
});
