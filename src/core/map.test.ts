// src/core/map.test.ts
// Тести ітерації 2: A*, туман війни, генератор тестових мап. Запуск: npx vitest
// Логіка всіх сценаріїв попередньо перевірена в пісочниці.

import { describe, expect, it } from 'vitest';
import { computeVisibleCells, findPath, makeTestMap, pathApCost, visibleEnemies } from './map';
import { createGame, makeUnit, moveUnit, type GameMap, type GameState, type RNG, type Vec2 } from './combat';

const alwaysHit: RNG = () => 0;
const FAR: Vec2 = { x: 8, y: 10 }; // прибілець поза зонами тестів пошуку шляху

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
    const vis = computeVisibleCells(g, { x: 2, y: 2 }, 5);
    expect(vis.size).toBe(64); // 8×8 після обрізання
    expect(vis.has('5,2')).toBe(true);
    expect(vis.has('0,0')).toBe(true);
    expect(vis.has('2,8')).toBe(false); // за радіусом
  });

  it('з центру мапи — повний квадрат (2×5+1)²', () => {
    const g = setupGame();
    expect(computeVisibleCells(g, { x: 10, y: 10 }, 5).size).toBe(121);
  });

  it('стіна видима сама, але ховає клітинки за нею', () => {
    const g = setupGame(['4,2']);
    const vis = computeVisibleCells(g, { x: 2, y: 2 }, 5);
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
