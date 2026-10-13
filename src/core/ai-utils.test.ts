// src/core/ai-utils.test.ts
// Фаза 2 (П6): прямі тести спільних примітивів ШІ (ai-utils.ts) —
// до цього вони покривалися лише опосередковано через ai.ts / bot.ts.

import { describe, expect, it } from 'vitest';
import { createGame, makeUnit, type GameMap, type GameState, type Unit } from './combat';
import { bestPathToNeighbors, bestShootMode, nearestEnemy, pathToward } from './ai-utils';

const alwaysHit = () => 0;

const map = (blocked: string[] = []): GameMap => ({
  width: 20,
  height: 20,
  blocked: new Set(blocked),
});

function game(blocked: string[] = []): GameState {
  return createGame({
    map: map(blocked),
    rng: alwaysHit,
    units: [makeUnit({ id: 's1', side: 'player', pos: { x: 2, y: 2 } }), makeUnit({ id: 'a1', side: 'alien', pos: { x: 8, y: 2 } })],
  });
}

describe('bestShootMode', () => {
  it('поблизу з AP — авто (найбільше очікуване пошкодження)', () => {
    const g = game();
    expect(bestShootMode(g, g.units[1], g.units[0])).toBe('auto');
  });

  it('AP 2 — замало на найдешевший режим → null', () => {
    const g = game();
    g.units[1].ap = 2;
    expect(bestShootMode(g, g.units[1], g.units[0])).toBe(null);
  });

  it('поза дальністю зброї → null', () => {
    const g = game();
    g.units[0].pos = { x: 2, y: 19 }; // відстань 17 > дальності 12
    expect(bestShootMode(g, g.units[1], g.units[0])).toBe(null);
  });

  it('стіна на лінії огляду → null', () => {
    const g = game(['5,2']);
    expect(bestShootMode(g, g.units[1], g.units[0])).toBe(null);
  });
});

describe('nearestEnemy', () => {
  it('найближчий за Чебишевим', () => {
    const g = game();
    const far: Unit = makeUnit({ id: 's2', side: 'player', pos: { x: 18, y: 18 } });
    g.units.push(far);
    expect(nearestEnemy(g.units[1], [far, g.units[0]]).id).toBe('s1');
  });
});

describe('bestPathToNeighbors', () => {
  it("бюджет 0 → null (резерв на заступу з'ївся)", () => {
    const g = game();
    expect(bestPathToNeighbors(g, g.units[1], [{ x: 2, y: 2 }], 0)).toBe(null);
  });

  it('зайнята клітинка — шлях у її сусіда, обрізаний до бюджету', () => {
    const g = game();
    const step = bestPathToNeighbors(g, g.units[1], [g.units[0].pos], 3);
    expect(step).not.toBe(null);
    expect(step).toHaveLength(3); // від (8,2) до (3,2) — 5 кроків, обрізано до 3
  });

  it('кілька клітинок — найкоротший шлях до найближчого сусіда', () => {
    const g = game();
    const step = bestPathToNeighbors(
      g,
      g.units[1],
      [
        { x: 2, y: 2 },
        { x: 7, y: 3 },
      ],
      g.units[1].ap
    );
    expect(step).toHaveLength(1); // сусід (7,3) — поруч, достатньо 1 кроку
  });

  it('перешкода навколо всіх сусідів → null', () => {
    const g = game(['2,1', '2,3', '1,2', '3,2', '8,2', '8,3', '7,2', '9,2']);
    // ціль (2,2) повністю відгороджена стіною; (8,2)/(7,2)... блокують рух прибульця
    expect(bestPathToNeighbors(g, g.units[1], [{ x: 2, y: 2 }], 10)).toBe(null);
  });
});

describe('pathToward', () => {
  it('шлях до сусіда цілі, обрізаний до наявних AP', () => {
    const g = game();
    const step = pathToward(g, g.units[1], g.units[0]);
    expect(step).toHaveLength(5); // (8,2) → (3,2): сусід цілі (2,2)
  });
});
