
// src/core/ai.test.ts
// Тести ітерації 3.5: жадібні ШІ-вороги. Запуск: npx vitest
// Логіка всіх сценаріїв попередньо перевірена в пісочниці.

import { describe, expect, it } from 'vitest';
import {
  createGame,
  endTurn,
  makeUnit,
  mulberry32,
  setOverwatch,
  type GameMap,
  type GameState,
  type RNG,
  type Vec2,
} from './combat';
import { makeTestMap } from './map';
import { aiStep } from './ai';

const alwaysHit: RNG = () => 0;

const map = (blocked: string[] = []): GameMap => ({
  width: 20, height: 20, blocked: new Set(blocked),
});

// Програти весь хід прибульців через aiStep (з захистом від зациклення).
// patrol? — режим 5.1.5; без нього всі тести лишаються поведінкою 3.5 (регресія).
function playAlienTurn(state: GameState, maxSteps = 100, patrol?: Vec2[]): number {
  let steps = 0;
  while (aiStep(state, patrol) && steps < maxSteps) steps++;
  return steps;
}

describe('ШІ прибульців (жадібний)', () => {
  it('видима ціль: дві авто-серії, потім рух на 2 клітинки, AP 0', () => {
    const g = createGame({
      map: map(), rng: alwaysHit, startingSide: 'alien',
      units: [
        makeUnit({ id: 's1', side: 'player', pos: { x: 2, y: 2 }, hp: 100, maxHp: 100 }),
        makeUnit({ id: 'a1', side: 'alien', pos: { x: 8, y: 2 } }),
      ],
    });
    playAlienTurn(g);
    const shots = g.log.filter(e => e.type === 'shot');
    const moves = g.log.filter(e => e.type === 'move');
    expect(shots).toHaveLength(6);        // 2 × auto (3 кулі)
    expect(shots[0].mode).toBe('auto');
    expect(moves).toHaveLength(2);        // AP 2 → рух 2 клітинки
    expect(g.units[1].ap).toBe(0);
    expect(aiStep(g)).toBe(false);       // дій більше немає
  });

  it('цілі не видно → заступа, без пострілів (не «читерить»)', () => {
    const g = createGame({
      map: map(), rng: alwaysHit, startingSide: 'alien',
      units: [
        makeUnit({ id: 's1', side: 'player', pos: { x: 18, y: 18 } }), // відстань 16 > зору 12
        makeUnit({ id: 'a1', side: 'alien', pos: { x: 2, y: 2 } }),
      ],
    });
    const steps = playAlienTurn(g);
    expect(steps).toBe(1);
    expect(g.units[1].overwatch).toBe(true);
    expect(g.units[1].ap).toBe(7);
    expect(g.log.filter(e => e.type === 'shot')).toHaveLength(0);
    expect(aiStep(g)).toBe(false);       // у заступі, повторно не діє
  });

  it('стіна між → заступа, без пострілів і руху', () => {
    const g = createGame({
      map: map(['5,2', '5,3', '5,4', '5,5']), rng: alwaysHit, startingSide: 'alien',
      units: [
        makeUnit({ id: 's1', side: 'player', pos: { x: 2, y: 2 } }),
        makeUnit({ id: 'a1', side: 'alien', pos: { x: 7, y: 2 } }),
      ],
    });
    playAlienTurn(g);
    expect(g.units[1].overwatch).toBe(true);
    expect(g.log.filter(e => e.type === 'shot')).toHaveLength(0);
    expect(g.log.filter(e => e.type === 'move')).toHaveLength(0);
  });

  it('AP замало на постріл → рух до видимої цілі', () => {
    const g = createGame({
      map: map(), rng: alwaysHit, startingSide: 'alien',
      units: [
        makeUnit({ id: 's1', side: 'player', pos: { x: 10, y: 10 } }),
        makeUnit({ id: 'a1', side: 'alien', pos: { x: 3, y: 10 }, ap: 2, maxAp: 2 }),
      ],
    });
    playAlienTurn(g);
    expect(g.log.filter(e => e.type === 'move')).toHaveLength(2);
    expect(g.log.filter(e => e.type === 'shot')).toHaveLength(0);
    expect(g.units[1].pos).toEqual({ x: 5, y: 10 });
  });

  it('не діє поза ходом прибульців', () => {
    const g = createGame({
      map: map(), rng: alwaysHit,
      units: [makeUnit({ id: 's1', side: 'player', pos: { x: 2, y: 2 } })],
    });
    expect(aiStep(g)).toBe(false);
  });

  it('смерть прибульця від заступи під час його руху не ламає aiStep', () => {
    const g = createGame({
      map: map(), rng: alwaysHit,
      units: [
        makeUnit({ id: 's1', side: 'player', pos: { x: 2, y: 2 } }),
        makeUnit({ id: 'a1', side: 'alien', pos: { x: 14, y: 2 }, hp: 3, maxHp: 3 }),
      ],
    });
    setOverwatch(g, 's1');
    endTurn(g);
    let guard = 0;
    while (aiStep(g) && guard++ < 50); // не зациклюється
    expect(guard).toBeLessThan(50);
    expect(aiStep(g)).toBe(false);
  });

  it('повний раунд ШІ + endTurn повертає хід гравцеві (раунд 2, AP відновлені)', () => {
    const g = createGame({
      map: map(), rng: alwaysHit,
      units: [
        makeUnit({ id: 's1', side: 'player', pos: { x: 3, y: 3 }, hp: 100, maxHp: 100 }),
        makeUnit({ id: 'a1', side: 'alien', pos: { x: 6, y: 3 } }),
      ],
    });
    endTurn(g);
    playAlienTurn(g);
    endTurn(g);
    expect(g.activeSide).toBe('player');
    expect(g.turn).toBe(2);
    expect(g.units[0].ap).toBe(10);
  });

  it('детермінізм: один сід — однаковий лог раунду ШІ', () => {
    const play = (seed: number) => {
      const g = createGame({
        map: makeTestMap(seed),
        rng: mulberry32(seed + 1),
        startingSide: 'alien',
        units: [
          makeUnit({ id: 's1', side: 'player', pos: { x: 2, y: 2 }, firingAccuracy: 0.7 }),
          makeUnit({ id: 's2', side: 'player', pos: { x: 3, y: 2 }, firingAccuracy: 0.6 }),
          makeUnit({ id: 'a1', side: 'alien', pos: { x: 17, y: 2 } }),
          makeUnit({ id: 'a2', side: 'alien', pos: { x: 17, y: 3 } }),
          makeUnit({ id: 'a3', side: 'alien', pos: { x: 16, y: 2 } }),
        ],
      });
      playAlienTurn(g);
      return JSON.stringify(g.log);
    };
    expect(play(11)).toBe(play(11));
  });

  it('5.1.5 patrol: цілей не видно → рух до зони висадки + заступа (резерв 3 AP)', () => {
    const g = createGame({
      map: map(), rng: alwaysHit, startingSide: 'alien',
      units: [
        makeUnit({ id: 's1', side: 'player', pos: { x: 18, y: 18 } }), // далеко, невидимий
        makeUnit({ id: 'a1', side: 'alien', pos: { x: 17, y: 2 } }),
      ],
    });
    const steps = playAlienTurn(g, 100, [{ x: 2, y: 2 }]);
    expect(steps).toBe(2);                          // рух бюджетом 7, потім заступа
    expect(g.log.filter(e => e.type === 'move')).toHaveLength(7);
    expect(g.units[1].pos).toEqual({ x: 10, y: 2 }); // 17 → 10, до сусіда зони
    expect(g.units[1].overwatch).toBe(true);
    expect(g.units[1].ap).toBe(0);
    expect(aiStep(g, [{ x: 2, y: 2 }])).toBe(false); // дій більше немає
  });

  it('5.1.5 patrol: зона висадки зайнята загоном — шлях у сусіда, після контакту постріл', () => {
    const g = createGame({
      map: map(), rng: alwaysHit, startingSide: 'alien',
      units: [
        makeUnit({ id: 's1', side: 'player', pos: { x: 2, y: 2 }, hp: 100, maxHp: 100 }),
        makeUnit({ id: 'a1', side: 'alien', pos: { x: 17, y: 2 } }),
      ],
    });
    const steps = playAlienTurn(g, 100, [{ x: 2, y: 2 }]);
    expect(g.log.filter(e => e.type === 'move')).toHaveLength(7); // v2: ціль — сусід зони, не зайнята клітинка
    expect(g.units[1].pos).toEqual({ x: 10, y: 2 });
    const shots = g.log.filter(e => e.type === 'shot');
    expect(shots).toHaveLength(1);                  // дистанція 8 ≤ огляду 12 → snap з решти 3 AP
    expect(shots[0].mode).toBe('snap');
    expect(steps).toBe(2);
  });

  it('5.1.5 patrol: AP 3 — руху немає (бюджет 0), лише заступа', () => {
    const g = createGame({
      map: map(), rng: alwaysHit, startingSide: 'alien',
      units: [
        makeUnit({ id: 's1', side: 'player', pos: { x: 18, y: 18 } }),
        makeUnit({ id: 'a1', side: 'alien', pos: { x: 17, y: 2 }, ap: 3, maxAp: 3 }),
      ],
    });
    const steps = playAlienTurn(g, 100, [{ x: 2, y: 2 }]);
    expect(steps).toBe(1);
    expect(g.log.filter(e => e.type === 'move')).toHaveLength(0);
    expect(g.units[1].overwatch).toBe(true);
  });
});
