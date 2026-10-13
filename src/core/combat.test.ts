// src/core/combat.test.ts
// Юніт-тести бойового ядра (ітерації 0–2). Запуск: npx vitest
// Логіка всіх сценаріїв попередньо перевірена в пісочниці.
// 2026-10-13: узгоджено з ядром після першого запуску CI (3 тести заступи/атаки).

import { describe, expect, it } from 'vitest';
import {
  calculateHitChance,
  createGame,
  endTurn,
  hasLineOfSight,
  makeUnit,
  moveUnit,
  mulberry32,
  resolveAttack,
  setOverwatch,
  type GameEvent,
  type GameMap,
  type GameState,
  type RNG,
} from './combat';

const alwaysHit: RNG = () => 0;
const alwaysMiss: RNG = () => 0.9999;
// послідовний RNG для точкових перевірок порогів шансів
const seqRng = (vals: number[]): RNG => { let i = 0; return () => vals[i++ % vals.length]; };

const map = (blocked: string[] = []): GameMap => ({
  width: 20, height: 20, blocked: new Set(blocked),
});

// Ціль із 3 HP: мінімальне пошкодження гвинтівки (3) убиває точно.
function setupGame(rng: RNG = alwaysHit, blocked: string[] = []): GameState {
  return createGame({
    map: map(blocked),
    rng,
    units: [
      makeUnit({ id: 's1', side: 'player', name: 'Капітан', pos: { x: 2, y: 2 } }),
      makeUnit({ id: 'a1', side: 'alien', name: 'Скаут', pos: { x: 8, y: 2 }, hp: 3, maxHp: 3 }),
    ],
  });
}

describe('формула влучності', () => {
  it('точність 0.6: snap 48%, aimed 69%, auto 30%', () => {
    const s = setupGame().units[0];
    expect(calculateHitChance(s, 'snap')).toBeCloseTo(0.48);
    expect(calculateHitChance(s, 'aimed')).toBeCloseTo(0.69);
    expect(calculateHitChance(s, 'auto')).toBeCloseTo(0.3);
  });

  it('межі: кап 0.95 і підлога 0.02', () => {
    const sniper = makeUnit({ id: 'sn', side: 'player', pos: { x: 0, y: 0 }, firingAccuracy: 1.0 });
    expect(calculateHitChance(sniper, 'aimed')).toBe(0.95);
    const rookie = makeUnit({ id: 'rk', side: 'player', pos: { x: 0, y: 0 }, firingAccuracy: 0.01 });
    expect(calculateHitChance(rookie, 'auto')).toBe(0.02);
  });
});

describe('лінія вогню', () => {
  it('відкрита місність — видно', () => {
    expect(hasLineOfSight(setupGame(), { x: 2, y: 2 }, { x: 8, y: 2 })).toBe(true);
  });

  it('стіна між — не видно', () => {
    const g = setupGame(alwaysHit, ['5,2']);
    expect(hasLineOfSight(g, { x: 2, y: 2 }, { x: 8, y: 2 })).toBe(false);
    expect(hasLineOfSight(g, { x: 2, y: 2 }, { x: 3, y: 2 })).toBe(true);
  });
});

describe('атака', () => {
  it('aimed при завжди-влучному RNG: ціль гине, AP і kills враховані', () => {
    const g = setupGame();
    const r = resolveAttack(g, 's1', 'a1', 'aimed');
    expect(r.targetDown).toBe(true);
    expect(r.shots).toHaveLength(1);
    expect(r.shots[0].hit).toBe(true);
    expect(r.shots[0].damage).toBeGreaterThanOrEqual(3);
    expect(r.shots[0].damage).toBeLessThanOrEqual(6);
    expect(g.units[0].ap).toBe(5);          // 10 − 5
    expect(g.units[0].kills).toBe(1);
    expect(g.units[1].alive).toBe(false);
    expect(g.units[1].hp).toBe(0);
    expect(g.log).toContainEqual(expect.objectContaining({ type: 'death', unitId: 'a1' }));
  });

  it('авто-серія зупиняється, коли ціль гине', () => {
    const g = setupGame();
    const r = resolveAttack(g, 's1', 'a1', 'auto');
    expect(r.shots).toHaveLength(1);        // перше ж влучання вбило
    expect(g.units[0].ap).toBe(6);          // 10 − 4
  });

  it('промах: 0 пошкоджень', () => {
    const g = setupGame(alwaysMiss);
    const r = resolveAttack(g, 's1', 'a1', 'snap');
    expect(r.shots[0].hit).toBe(false);
    expect(r.shots[0].damage).toBe(0);
    expect(g.units[1].hp).toBe(3);
  });

  it('заборонені випадки: по своїх, поза дальністю, без LOS, без AP', () => {
    const g = setupGame();
    expect(() => resolveAttack(g, 's1', 's1', 'snap')).toThrow('по своїх');
    g.units[1].pos = { x: 18, y: 18 };
    expect(() => resolveAttack(g, 's1', 'a1', 'aimed')).toThrow('дальністю');

    const walled = setupGame(alwaysHit, ['5,2']);
    expect(() => resolveAttack(walled, 's1', 'a1', 'aimed')).toThrow('лінії вогню');

    // без стіни: ядро перевіряє LOS раніше за AP, тож для винятку про AP
    // лінія вогню має бути чистою
    const tired = setupGame(alwaysHit);
    tired.units[0].ap = 2;
    expect(() => resolveAttack(tired, 's1', 'a1', 'snap')).toThrow('очок дій');
  });
});

describe('рух', () => {
  it('дві клітинки = 2 AP, позиція оновлена, події в лозі', () => {
    const g = setupGame();
    moveUnit(g, 's1', [{ x: 3, y: 2 }, { x: 4, y: 2 }]);
    expect(g.units[0].pos).toEqual({ x: 4, y: 2 });
    expect(g.units[0].ap).toBe(8);
    expect(g.log.filter(e => e.type === 'move')).toHaveLength(2);
  });

  it('заборонені випадки: діагональ, розрив, перешкода, зайнята клітинка, без AP, не свій хід', () => {
    const g = setupGame();
    expect(() => moveUnit(g, 's1', [{ x: 5, y: 3 }])).toThrow();   // діагональ
    expect(() => moveUnit(g, 's1', [{ x: 6, y: 4 }])).toThrow();   // не суміжний
    expect(() => moveUnit(g, 's1', [{ x: 5, y: 2 }, { x: 6, y: 2 }, { x: 7, y: 2 }, { x: 8, y: 2 }])).toThrow(); // зайнята

    const walled = setupGame(alwaysHit, ['3,2']);
    expect(() => moveUnit(walled, 's1', [{ x: 3, y: 2 }])).toThrow(); // перешкода

    const empty = setupGame();
    empty.units[0].ap = 0;
    expect(() => moveUnit(empty, 's1', [{ x: 2, y: 3 }])).toThrow();  // без AP

    const g2 = setupGame();
    expect(() => moveUnit(g2, 'a1', [{ x: 8, y: 3 }])).toThrow();     // не свій хід
  });
});

describe('ходи', () => {
  it('передача ходу відновлює AP сторони; turn рахує кола гравця', () => {
    const g = setupGame();
    g.units[0].ap = 1;
    endTurn(g);
    expect(g.activeSide).toBe('alien');
    expect(g.turn).toBe(1);
    expect(g.units[1].ap).toBe(10);
    endTurn(g);
    expect(g.activeSide).toBe('player');
    expect(g.turn).toBe(2);
    expect(g.units[0].ap).toBe(10);
  });
});

describe('заступа (overwatch)', () => {
  it('резервація: 3 AP, прапор і подія в лозі', () => {
    const g = setupGame();
    setOverwatch(g, 's1');
    expect(g.units[0].ap).toBe(7);
    expect(g.units[0].overwatch).toBe(true);
    expect(g.log).toContainEqual({ type: 'overwatch', unitId: 's1', armed: true });
    // озброєна заступа ігнорується повторним викликом — скидаємо прапор,
    // щоб перевірити саме брак AP
    g.units[0].overwatch = false;
    g.units[0].ap = 2;
    expect(() => setOverwatch(g, 's1')).toThrow('очок дій');
  });

  it('реакційний вогонь: один постріл за рух ворога, заступа розряджається', () => {
    const g = setupGame();
    // ціль 10 HP: мінімальний дамаг гвинтівки (3) при alwaysHit не вбиває —
    // перевіряємо саме «поранений, але живий»
    g.units[1].hp = 10;
    g.units[1].maxHp = 10;
    setOverwatch(g, 's1');
    endTurn(g);
    expect(g.units[0].overwatch).toBe(true); // тримається під час ходу ворога
    moveUnit(g, 'a1', [{ x: 7, y: 2 }, { x: 6, y: 2 }]);
    const shots = g.log.filter(e => e.type === 'shot' && e.shooterId === 's1');
    expect(shots).toHaveLength(1);
    expect(g.units[0].overwatch).toBe(false);
    expect(g.units[1].alive).toBe(true);
    expect(g.units[1].hp).toBeLessThanOrEqual(7); // поранений, але живий
  });

  it('смерть у русі: заступа вбиває на першому кроці, рух перервано', () => {
    const g = setupGame(); // a1 має 3 HP
    setOverwatch(g, 's1');
    endTurn(g);
    moveUnit(g, 'a1', [{ x: 7, y: 2 }, { x: 6, y: 2 }]);
    expect(g.units[1].alive).toBe(false);
    expect(g.units[1].pos).toEqual({ x: 7, y: 2 });
    expect(g.log.filter(e => e.type === 'move' && e.unitId === 'a1')).toHaveLength(1);
  });

  it('без лінії вогню заступа не спрацьовує і залишається зброєною', () => {
    const g = setupGame(alwaysHit, ['4,2', '4,3', '4,4']);
    g.units[1].pos = { x: 6, y: 2 };
    setOverwatch(g, 's1');
    endTurn(g);
    moveUnit(g, 'a1', [{ x: 6, y: 1 }]);
    expect(g.log.some(e => e.type === 'shot')).toBe(false);
    expect(g.units[0].overwatch).toBe(true);
  });

  it('на початку свого ходу заступа скидається, AP відновлюються', () => {
    const g = setupGame();
    setOverwatch(g, 's1');
    endTurn(g);
    endTurn(g);
    expect(g.units[0].overwatch).toBe(false);
    expect(g.units[0].ap).toBe(10);
  });

  it('штраф точності реакційного пострілу: 0.6×0.8×0.7 = 0.336', () => {
    const hit = setupGame(seqRng([0.33, 0.5]));
    setOverwatch(hit, 's1');
    endTurn(hit);
    moveUnit(hit, 'a1', [{ x: 7, y: 2 }]);
    const s = hit.log.find(e => e.type === 'shot' && e.shooterId === 's1') as Extract<GameEvent, { type: 'shot' }>;
    expect(s.hit).toBe(true);
    expect(s.damage).toBe(5); // 3 + floor(0.5×4)

    const miss = setupGame(seqRng([0.34]));
    setOverwatch(miss, 's1');
    endTurn(miss);
    moveUnit(miss, 'a1', [{ x: 7, y: 2 }]);
    const s2 = miss.log.find(e => e.type === 'shot' && e.shooterId === 's1') as Extract<GameEvent, { type: 'shot' }>;
    expect(s2.hit).toBe(false);
    expect(s2.damage).toBe(0);
  });

  it('симетрія: прибульці теж можуть заступати і стріляти по гравцю', () => {
    const g = setupGame();
    endTurn(g);
    setOverwatch(g, 'a1');
    endTurn(g);
    moveUnit(g, 's1', [{ x: 3, y: 2 }]);
    expect(g.log.some(e => e.type === 'shot' && e.shooterId === 'a1')).toBe(true);
    expect(g.units[0].alive).toBe(true);
    expect(g.units[0].hp).toBeLessThanOrEqual(7);
  });
});

describe('детермінізм', () => {
  it('один сід RNG — повністю однаковий лог і стан', () => {
    const play = (seed: number) => {
      const g = createGame({
        map: map(['5,4']),
        rng: mulberry32(seed),
        units: [
          makeUnit({ id: 's1', side: 'player', pos: { x: 2, y: 2 } }),
          makeUnit({ id: 'a1', side: 'alien', pos: { x: 8, y: 2 }, hp: 20, maxHp: 20 }),
        ],
      });
      moveUnit(g, 's1', [{ x: 2, y: 3 }, { x: 3, y: 3 }]);
      resolveAttack(g, 's1', 'a1', 'auto');
      resolveAttack(g, 's1', 'a1', 'snap');
      endTurn(g);
      resolveAttack(g, 'a1', 's1', 'aimed');
      return JSON.stringify(g.log) + '|' + g.units.map(u => u.hp + ':' + u.ap + ':' + u.alive).join(',');
    };
    expect(play(7)).toBe(play(7));
  });
});
