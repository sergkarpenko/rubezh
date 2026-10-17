// src/core/combat.test.ts
// Юніт-тести бойового ядра (ітерації 0–2). Запуск: npx vitest
// Логіка всіх сценаріїв попередньо перевірена в пісочниці.
// 2026-10-13: узгоджено з ядром після першого запуску CI (3 тести дозору/атаки).

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
  throwGrenade,
  useMedkit,
  type GameEvent,
  type GameMap,
  type GameState,
  type RNG,
  type StatefulRng,
  type UnitItems,
} from './combat';

const alwaysHit: RNG = () => 0;
const alwaysMiss: RNG = () => 0.9999;
// послідовний RNG для точкових перевірок порогів шансів
const seqRng = (vals: number[]): RNG => {
  let i = 0;
  return () => vals[i++ % vals.length];
};

const map = (blocked: string[] = []): GameMap => ({
  width: 20,
  height: 20,
  blocked: new Set(blocked),
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
  it('відкрита місцевість — видно', () => {
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
    expect(g.units[0].ap).toBe(5); // 10 − 5
    expect(g.units[0].kills).toBe(1);
    expect(g.units[1].alive).toBe(false);
    expect(g.units[1].hp).toBe(0);
    expect(g.log).toContainEqual(expect.objectContaining({ type: 'death', unitId: 'a1' }));
  });

  it('авто-серія зупиняється, коли ціль гине', () => {
    const g = setupGame();
    const r = resolveAttack(g, 's1', 'a1', 'auto');
    expect(r.shots).toHaveLength(1); // перше ж влучання вбило
    expect(g.units[0].ap).toBe(6); // 10 − 4
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
    moveUnit(g, 's1', [
      { x: 3, y: 2 },
      { x: 4, y: 2 },
    ]);
    expect(g.units[0].pos).toEqual({ x: 4, y: 2 });
    expect(g.units[0].ap).toBe(8);
    expect(g.log.filter((e) => e.type === 'move')).toHaveLength(2);
  });

  it('заборонені випадки: діагональ, розрив, перешкода, зайнята клітинка, без AP, не свій хід', () => {
    const g = setupGame();
    expect(() => moveUnit(g, 's1', [{ x: 5, y: 3 }])).toThrow(); // діагональ
    expect(() => moveUnit(g, 's1', [{ x: 6, y: 4 }])).toThrow(); // не суміжний
    expect(() =>
      moveUnit(g, 's1', [
        { x: 5, y: 2 },
        { x: 6, y: 2 },
        { x: 7, y: 2 },
        { x: 8, y: 2 },
      ])
    ).toThrow(); // зайнята

    const walled = setupGame(alwaysHit, ['3,2']);
    expect(() => moveUnit(walled, 's1', [{ x: 3, y: 2 }])).toThrow(); // перешкода

    const empty = setupGame();
    empty.units[0].ap = 0;
    expect(() => moveUnit(empty, 's1', [{ x: 2, y: 3 }])).toThrow(); // без AP

    const g2 = setupGame();
    expect(() => moveUnit(g2, 'a1', [{ x: 8, y: 3 }])).toThrow(); // не свій хід
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

describe('дозор (overwatch)', () => {
  it('резервація: 3 AP, прапор і подія в лозі', () => {
    const g = setupGame();
    setOverwatch(g, 's1');
    expect(g.units[0].ap).toBe(7);
    expect(g.units[0].overwatch).toBe(true);
    expect(g.log).toContainEqual({ type: 'overwatch', unitId: 's1', armed: true });
    // озброєний дозор ігнорується повторним викликом — скидаємо прапор,
    // щоб перевірити саме брак AP
    g.units[0].overwatch = false;
    g.units[0].ap = 2;
    expect(() => setOverwatch(g, 's1')).toThrow('очок дій');
  });

  it('реакційний вогонь: один постріл за рух ворога, дозор розряджається', () => {
    const g = setupGame();
    // ціль 10 HP: мінімальна шкода гвинтівки (3) при alwaysHit не вбиває —
    // перевіряємо саме «поранений, але живий»
    g.units[1].hp = 10;
    g.units[1].maxHp = 10;
    setOverwatch(g, 's1');
    endTurn(g);
    expect(g.units[0].overwatch).toBe(true); // тримається під час ходу ворога
    moveUnit(g, 'a1', [
      { x: 7, y: 2 },
      { x: 6, y: 2 },
    ]);
    const shots = g.log.filter((e) => e.type === 'shot' && e.shooterId === 's1');
    expect(shots).toHaveLength(1);
    expect(g.units[0].overwatch).toBe(false);
    expect(g.units[1].alive).toBe(true);
    expect(g.units[1].hp).toBeLessThanOrEqual(7); // поранений, але живий
  });

  it('смерть у русі: дозор вбиває на першому кроці, рух перервано', () => {
    const g = setupGame(); // a1 має 3 HP
    setOverwatch(g, 's1');
    endTurn(g);
    moveUnit(g, 'a1', [
      { x: 7, y: 2 },
      { x: 6, y: 2 },
    ]);
    expect(g.units[1].alive).toBe(false);
    expect(g.units[1].pos).toEqual({ x: 7, y: 2 });
    expect(g.log.filter((e) => e.type === 'move' && e.unitId === 'a1')).toHaveLength(1);
  });

  it('без лінії вогню дозор не спрацьовує і залишається озброєним', () => {
    const g = setupGame(alwaysHit, ['4,2', '4,3', '4,4']);
    g.units[1].pos = { x: 6, y: 2 };
    setOverwatch(g, 's1');
    endTurn(g);
    moveUnit(g, 'a1', [{ x: 6, y: 1 }]);
    expect(g.log.some((e) => e.type === 'shot')).toBe(false);
    expect(g.units[0].overwatch).toBe(true);
  });

  it('на початку свого ходу дозор скидається, AP відновлюються', () => {
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
    const s = hit.log.find((e) => e.type === 'shot' && e.shooterId === 's1') as Extract<GameEvent, { type: 'shot' }>;
    expect(s.hit).toBe(true);
    expect(s.damage).toBe(5); // 3 + floor(0.5×4)

    const miss = setupGame(seqRng([0.34]));
    setOverwatch(miss, 's1');
    endTurn(miss);
    moveUnit(miss, 'a1', [{ x: 7, y: 2 }]);
    const s2 = miss.log.find((e) => e.type === 'shot' && e.shooterId === 's1') as Extract<GameEvent, { type: 'shot' }>;
    expect(s2.hit).toBe(false);
    expect(s2.damage).toBe(0);
  });

  it('симетрія: прибульці теж можуть ставати в дозор і стріляти по гравцю', () => {
    const g = setupGame();
    endTurn(g);
    setOverwatch(g, 'a1');
    endTurn(g);
    moveUnit(g, 's1', [{ x: 3, y: 2 }]);
    expect(g.log.some((e) => e.type === 'shot' && e.shooterId === 'a1')).toBe(true);
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
      moveUnit(g, 's1', [
        { x: 2, y: 3 },
        { x: 3, y: 3 },
      ]);
      resolveAttack(g, 's1', 'a1', 'auto');
      resolveAttack(g, 's1', 'a1', 'snap');
      endTurn(g);
      resolveAttack(g, 'a1', 's1', 'aimed');
      return JSON.stringify(g.log) + '|' + g.units.map((u) => u.hp + ':' + u.ap + ':' + u.alive).join(',');
    };
    expect(play(7)).toBe(play(7));
  });
});

// --- П11.4 (ADR-0058): дії з витратниками ---

// Гра з трьома юнітами гравця й двома прибульцями; витратники — через items.
function itemsGame(items?: Record<string, UnitItems>, blocked: string[] = [], rng: RNG = alwaysHit): GameState {
  return createGame({
    map: map(blocked),
    rng,
    items,
    units: [
      makeUnit({ id: 's1', side: 'player', pos: { x: 2, y: 2 } }),
      makeUnit({ id: 's2', side: 'player', pos: { x: 3, y: 2 }, hp: 4, maxHp: 10 }),
      makeUnit({ id: 'a1', side: 'alien', pos: { x: 8, y: 2 }, hp: 10, maxHp: 10 }),
      makeUnit({ id: 'a2', side: 'alien', pos: { x: 8, y: 3 }, hp: 10, maxHp: 10 }),
    ],
  });
}

describe('П11.4: лікування (аптечка)', () => {
  it('союзнику поруч: +3 HP, −4 AP, аптечка списана, подія в логу', () => {
    const g = itemsGame({ s1: { medkit: true, grenade: false } });
    const r = useMedkit(g, 's1', 's2');
    expect(r.healed).toBe(3);
    expect(g.units[1].hp).toBe(7);
    expect(g.units[0].ap).toBe(6);
    expect(g.items?.s1.medkit).toBe(false);
    expect(g.log).toContainEqual({ type: 'heal', unitId: 's1', targetId: 's2', healed: 3 });
  });

  it('соба з капом: +3 не вище maxHp', () => {
    const g = itemsGame({ s2: { medkit: true, grenade: false } });
    g.units[1].hp = 9;
    const r = useMedkit(g, 's2', 's2');
    expect(r.healed).toBe(1); // 9 + 3 → кап 10
    expect(g.units[1].hp).toBe(10);
  });

  it('діагональний сусід (Чебишев ≤1) — валідна ціль', () => {
    const g = itemsGame({ s1: { medkit: true, grenade: false } });
    g.units[1].pos = { x: 3, y: 3 }; // діагональ від s1 (2,2) — відстань Чебишева 1
    useMedkit(g, 's1', 's2');
    expect(g.units[1].hp).toBe(7);
  });

  it('аптечка одна на місію: повторний виклик — throw', () => {
    const g = itemsGame({ s1: { medkit: true, grenade: false } });
    useMedkit(g, 's1', 's2');
    expect(() => useMedkit(g, 's1', 's1')).toThrow('Аптечки немає');
  });

  it('помилки правил: без аптечки, AP, ворог, відстань 2, здорова ціль, мертва ціль, не свій хід', () => {
    const g = itemsGame({ s1: { medkit: true, grenade: false } });
    expect(() => useMedkit(g, 's2', 's2')).toThrow('Аптечки немає'); // запису items немає = предметів немає
    g.units[0].ap = 3;
    expect(() => useMedkit(g, 's1', 's2')).toThrow('Недостатньо очок дій');
    g.units[0].ap = 10;
    expect(() => useMedkit(g, 's1', 'a1')).toThrow('Лікування можливе лише по своїх');
    g.units[1].pos = { x: 5, y: 2 };
    expect(() => useMedkit(g, 's1', 's2')).toThrow('поза межами лікування');
    g.units[1].pos = { x: 2, y: 2 }; // той самий квадрат — відстань 0
    g.units[1].hp = 10;
    expect(() => useMedkit(g, 's1', 's2')).toThrow('Ціль не поранена');
    g.units[1].alive = false;
    expect(() => useMedkit(g, 's1', 's2')).toThrow('Ціль уже мертва');
    endTurn(g);
    expect(() => useMedkit(g, 's1', 's1')).toThrow('Зараз хід не сторони player');
  });

  it('без RNG: лікування не споживає бойовий генератор (детермінізм)', () => {
    const g = itemsGame({ s1: { medkit: true, grenade: false } }, [], mulberry32(5));
    const s0 = (g.rng as StatefulRng).state;
    useMedkit(g, 's1', 's2');
    expect((g.rng as StatefulRng).state).toBe(s0);
  });
});

describe('П11.4: кидок гранати', () => {
  it('епіцентр + хрест: усіх у зоні уражено однаковим пошкодженням, подія в логу', () => {
    const g = itemsGame({ s1: { medkit: false, grenade: true } });
    const r = throwGrenade(g, 's1', { x: 8, y: 2 }); // епіцентр a1, сусід a2
    expect(r.damage).toBeGreaterThanOrEqual(3);
    expect(r.damage).toBeLessThanOrEqual(5);
    expect(r.affected).toEqual(['a1', 'a2']);
    expect(g.units[2].hp).toBe(10 - r.damage);
    expect(g.units[3].hp).toBe(10 - r.damage);
    expect(g.units[0].ap).toBe(6);
    expect(g.items?.s1.grenade).toBe(false);
    const ev = g.log.find((e) => e.type === 'grenade');
    expect(ev).toEqual({
      type: 'grenade',
      unitId: 's1',
      center: { x: 8, y: 2 },
      hits: [
        { unitId: 'a1', damage: r.damage },
        { unitId: 'a2', damage: r.damage },
      ],
    });
  });

  it('friendly fire: союзник у зоні уражений, за нього kills не ростуть; за ворогів — ростуть', () => {
    const g = itemsGame({ s1: { medkit: false, grenade: true } }, [], seqRng([0.999]));
    g.units[1].pos = { x: 8, y: 2 }; // s2 накладено на епіцентр
    g.units[1].hp = 5; // 5 − 5 = 0: гине від дружнього вибуху
    g.units[2].hp = 4; // 4 − 5 = 0: гине ворог
    const r = throwGrenade(g, 's1', { x: 8, y: 2 });
    expect(r.damage).toBe(5);
    expect(g.units[1].alive).toBe(false);
    expect(g.units[2].alive).toBe(false);
    expect(g.units[0].kills).toBe(1); // лише ворог
    expect(g.log).toContainEqual({ type: 'death', unitId: 's2', killerId: 's1' });
    expect(g.log).toContainEqual({ type: 'death', unitId: 'a1', killerId: 's1' });
  });

  it('порожня зона: кидок валідний, пошкодження немає нікому', () => {
    const g = itemsGame({ s1: { medkit: false, grenade: true } });
    const r = throwGrenade(g, 's1', { x: 5, y: 6 }); // сідло — нікого в зоні
    expect(r.affected).toEqual([]);
    expect(g.log.find((e) => e.type === 'grenade')).toEqual({
      type: 'grenade',
      unitId: 's1',
      center: { x: 5, y: 6 },
      hits: [],
    });
  });

  it('один кидок RNG на вибух незалежно від кількості уражених', () => {
    const g = itemsGame({ s1: { medkit: false, grenade: true } }, [], mulberry32(9));
    throwGrenade(g, 's1', { x: 8, y: 2 }); // дві цілі в зоні
    const one = mulberry32(9);
    one(); // рівно один кидок
    expect((g.rng as StatefulRng).state).toBe(one.state);
  });

  it('детермінізм: той самий сід → той самий лог і стани (критерій 3)', () => {
    const play = (seed: number) => {
      const g = itemsGame({ s1: { medkit: true, grenade: true } }, ['6,5'], mulberry32(seed));
      useMedkit(g, 's1', 's2'); // 4 AP
      throwGrenade(g, 's1', { x: 8, y: 2 }); // ще 4 AP — серія різних дій з предметами
      endTurn(g);
      return JSON.stringify(g.log) + '|' + g.units.map((u) => u.hp + ':' + u.ap + ':' + u.alive + ':' + u.kills).join(',');
    };
    expect(play(11)).toBe(play(11));
  });

  it('помилки правил: без гранати, AP, межі мапи, дальність 7, стіна на лінії кидка', () => {
    const g = itemsGame({ s1: { medkit: false, grenade: true } });
    expect(() => throwGrenade(g, 's2', { x: 8, y: 2 })).toThrow('Гранати немає');
    g.units[0].ap = 3;
    expect(() => throwGrenade(g, 's1', { x: 8, y: 2 })).toThrow('Недостатньо очок дій');
    g.units[0].ap = 10;
    expect(() => throwGrenade(g, 's1', { x: -1, y: 2 })).toThrow('за межами мапи');
    expect(() => throwGrenade(g, 's1', { x: 9, y: 2 })).toThrow('поза дальністю кидка');
    const w = itemsGame({ s1: { medkit: false, grenade: true } }, ['6,2']);
    expect(() => throwGrenade(w, 's1', { x: 8, y: 2 })).toThrow('Немає лінії кидка');
  });

  it('епіцентр — видима кидачу клітинка: дальність 6 < радіуса огляду, LOS достатній', () => {
    // дзеркало computeVisibleCells (map.ts): клітинка в зоні кидка з чистою
    // лінією від кидача завжди видима йому (туман — лише рельєф, ADR-0006)
    const g = itemsGame({ s1: { medkit: false, grenade: true } });
    expect(() => throwGrenade(g, 's1', { x: 8, y: 2 })).not.toThrow();
  });
});

describe('П11.4: ізоляція (критерій 1: бій без предметів байт-у-байт незмінний)', () => {
  it('наявність невикористаних предметів не міняє бій: лог і rng.state збігаються', () => {
    const play = (items?: Record<string, UnitItems>) => {
      const g = itemsGame(items, ['5,4'], mulberry32(42));
      resolveAttack(g, 's1', 'a1', 'auto');
      moveUnit(g, 's1', [{ x: 2, y: 3 }]);
      resolveAttack(g, 's1', 'a2', 'snap');
      endTurn(g);
      resolveAttack(g, 'a1', 's1', 'aimed');
      return JSON.stringify(g.log) + '|' + (g.rng as StatefulRng).state;
    };
    expect(play()).toBe(play({ s1: { medkit: true, grenade: true }, s2: { medkit: true, grenade: true } }));
  });
});
