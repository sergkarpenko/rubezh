// п17.4 (ADR-0151, рішення власника «Б. За стороною»): туман із блокуванням юнітами.
// Живий юніт закриває огляд і вогонь: свій — завжди, чужий — коли його бачить сторона
// (перший прохід за відстанню від глядача); невидимий стороні юніт її огляду не закриває
// і себе не видає (ADR-0081); граната — лише рельєф.
import { describe, expect, it } from 'vitest';
import {
  createGame,
  endTurn,
  hasLineOfSight,
  hasTerrainLine,
  makeUnit,
  moveUnit,
  resolveAttack,
  seenEnemies,
  setOverwatch,
  sideSees,
  sightBlockers,
  throwGrenade,
  type GameState,
  type RNG,
  type Unit,
} from './combat';
import { computeVisibleCells, sideVisibleCells, visibleEnemies } from './map';
import { aiStep } from './ai';

const alwaysHit: RNG = () => 0;

function game(units: Unit[], blocked: string[] = [], size = 20): GameState {
  return createGame({ map: { width: size, height: size, blocked: new Set(blocked) }, rng: alwaysHit, units });
}
const P = (id: string, x: number, y: number, extra: Partial<Unit> = {}) => makeUnit({ id, side: 'player', pos: { x, y }, ...extra });
const A = (id: string, x: number, y: number, extra: Partial<Unit> = {}) => makeUnit({ id, side: 'alien', pos: { x, y }, ...extra });

describe('п17.4: юніт закриває огляд і вогонь', () => {
  it('видимий ворог на лінії закриває клітинку за собою; його клітинку видно', () => {
    const g = game([P('s1', 2, 2), A('a1', 5, 2), A('a2', 8, 2)]);
    expect(hasLineOfSight(g, { x: 2, y: 2 }, { x: 5, y: 2 }, 'player')).toBe(true);
    expect(hasLineOfSight(g, { x: 2, y: 2 }, { x: 8, y: 2 }, 'player')).toBe(false);
    const vis = computeVisibleCells(g, { x: 2, y: 2 }, 'player');
    expect(vis.has('5,2')).toBe(true);
    expect(vis.has('8,2')).toBe(false);
    expect(visibleEnemies(g, 'player').map((u) => u.id)).toEqual(['a1']);
    expect(() => resolveAttack(g, 's1', 'a2', 'snap')).toThrow('Немає лінії вогню');
    expect(() => resolveAttack(g, 's1', 'a1', 'snap')).not.toThrow();
  });

  it('свій юніт закриває завжди — і огляд, і вогонь', () => {
    const g = game([P('s1', 2, 2), P('s2', 4, 2), A('a1', 8, 2)]);
    expect(computeVisibleCells(g, { x: 2, y: 2 }, 'player').has('8,2')).toBe(false);
    expect(sightBlockers(g, 'player').has('4,2')).toBe(true);
    expect(() => resolveAttack(g, 's1', 'a1', 'snap')).toThrow('Немає лінії вогню');
  });

  it('ignore: клітинку юніта, що оцінює позицію, куди піде, не рахують закривачем (ШІ ока)', () => {
    const g = game([P('s1', 2, 2), A('a1', 5, 2), A('a2', 8, 2)]);
    expect(hasLineOfSight(g, { x: 3, y: 2 }, { x: 8, y: 2 }, 'alien')).toBe(false);
    expect(hasLineOfSight(g, { x: 3, y: 2 }, { x: 8, y: 2 }, 'alien', { x: 5, y: 2 })).toBe(true);
    expect(sightBlockers(g, 'alien').has('5,2')).toBe(true); // кеш не зіпсовано
  });

  it('загиблий і евакуйований не закривають', () => {
    const g = game([P('s1', 2, 2), A('a1', 5, 2, { alive: false, hp: 0 }), A('a2', 8, 2)]);
    expect(hasLineOfSight(g, { x: 2, y: 2 }, { x: 8, y: 2 }, 'player')).toBe(true);
    g.units.splice(1, 1); // евакуйований зникає з units
    expect(hasLineOfSight(g, { x: 2, y: 2 }, { x: 8, y: 2 }, 'player')).toBe(true);
  });

  it('ворог, якого бачить один боєць, закриває огляд і вогонь усім бійцям сторони («за стороною»)', () => {
    // a1 (5,5) за стіною (5,3) від s2 (5,1), але його бачить s1 (2,5); лінія s2→a2 (5,9) іде через a1
    const g = game([P('s1', 2, 5), P('s2', 5, 1), A('a1', 5, 5), A('a2', 5, 9)], ['5,3', '4,3', '6,3', '3,7', '2,8', '3,8']);
    expect(computeVisibleCells(g, { x: 5, y: 1 }, 'player').has('5,5')).toBe(false); // s2 сам a1 не бачить
    expect(seenEnemies(g, 'player').map((u) => u.id)).toContain('a1');
    expect(hasLineOfSight(g, { x: 5, y: 1 }, { x: 5, y: 9 }, 'player')).toBe(false);
  });
});

describe('п17.4: невидимий стороні юніт не закриває і не видає себе (ADR-0081)', () => {
  it('контрприклад аудиту PR #506: стіна (0,2), глядач (0,0), юніт (1,5) — клітинка (2,7) лишається видимою', () => {
    const g = game([P('s1', 0, 0), A('a1', 1, 5)], ['0,2']);
    expect(computeVisibleCells(g, { x: 0, y: 0 }, 'player').has('1,5')).toBe(false); // юніта не видно
    const withUnit = sideVisibleCells(g, 'player');
    expect(withUnit.has('2,7')).toBe(true);
    const empty = game([P('s1', 0, 0)], ['0,2']);
    expect([...withUnit].sort()).toEqual([...sideVisibleCells(empty, 'player')].sort());
  });

  it('невидимий ворог не ховає видимого: демон у (2,7) за невидимим у (1,5) — видно', () => {
    const g = game([P('s1', 0, 0), A('a1', 1, 5), A('a2', 2, 7)], ['0,2']);
    expect(visibleEnemies(g, 'player').map((u) => u.id)).toEqual(['a2']);
    expect(() => resolveAttack(g, 's1', 'a2', 'snap')).not.toThrow();
  });

  it('ворог, якого ховає інший ворог, сам не закриває: перший прохід іде від глядача за відстанню', () => {
    // a1 (4,2) закриває a2 (6,2); a2 не закриває клітинку (8,3) — лінія до неї через (6,2)… перевірка: туман той самий, що без a2
    const g = game([P('s1', 2, 2), A('a1', 4, 2), A('a2', 6, 2)]);
    expect(visibleEnemies(g, 'player').map((u) => u.id)).toEqual(['a1']);
    const without = game([P('s1', 2, 2), A('a1', 4, 2)]);
    expect([...sideVisibleCells(g, 'player')].sort()).toEqual([...sideVisibleCells(without, 'player')].sort());
  });

  it('сторона ворога має свої закривачі: невидимий демонам оперативник не закриває їм огляд', () => {
    const g = game([A('a1', 0, 0), P('s1', 1, 5)], ['0,2']);
    expect(seenEnemies(g, 'alien')).toEqual([]);
    expect(sightBlockers(g, 'alien').has('1,5')).toBe(false);
    expect(sideVisibleCells(g, 'alien').has('2,7')).toBe(true);
    // видимий демонам оперативник — закриває
    const open = game([A('a1', 0, 0), P('s1', 1, 5)]);
    expect(sightBlockers(open, 'alien').has('1,5')).toBe(true);
  });
});

describe('п17.4: лінія симетрична за тих самих закривачів (ADR-0087)', () => {
  it('для кожної пари клітинок поля 8 × 8 з юнітами — однаково в обидва боки', () => {
    const g = game([P('s1', 1, 1), P('s2', 3, 4), A('a1', 5, 2), A('a2', 6, 6)], ['3,2', '4,5'], 8);
    const cells = [];
    for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) cells.push({ x, y });
    for (const side of ['player', 'alien'] as const)
      for (const a of cells) for (const b of cells) expect(hasLineOfSight(g, a, b, side)).toBe(hasLineOfSight(g, b, a, side));
  });
});

describe('п17.4: граната — лише рельєф', () => {
  it('юніт на лінії кидка не заважає; стіна — заважає', () => {
    const g = game([P('s1', 2, 2), P('s2', 3, 2), A('a1', 5, 2)], ['2,4']);
    g.items = { s1: { medkit: false, grenade: true } };
    expect(hasLineOfSight(g, { x: 2, y: 2 }, { x: 5, y: 2 }, 'player')).toBe(false);
    expect(hasTerrainLine(g, { x: 2, y: 2 }, { x: 5, y: 2 })).toBe(true);
    expect(() => throwGrenade(g, 's1', { x: 2, y: 6 })).toThrow('Немає лінії кидка');
    expect(() => throwGrenade(g, 's1', { x: 5, y: 2 })).not.toThrow();
  });
});

describe('п17.4: дозор і ШІ', () => {
  it('дозор не стріляє крізь юніта на лінії; без нього — стріляє', () => {
    const run = (withBlocker: boolean) => {
      const units = [P('s1', 2, 2), A('a1', 9, 2)];
      if (withBlocker) units.push(P('s2', 4, 2));
      const g = game(units);
      setOverwatch(g, 's1');
      endTurn(g);
      moveUnit(g, 'a1', [{ x: 8, y: 2 }]);
      return g.log.filter((e) => e.type === 'shot').length;
    };
    expect(run(false)).toBe(1);
    expect(run(true)).toBe(0);
  });

  it('sideSees: клітинку за видимим ворогом сторона не бачить', () => {
    const g = game([P('s1', 2, 2), A('a1', 5, 2)]);
    expect(sideSees(g, 'player', { x: 5, y: 2 })).toBe(true);
    expect(sideSees(g, 'player', { x: 7, y: 2 })).toBe(false);
  });

  it('демон не стріляє крізь іншого демона: йде на позицію з чистою лінією', () => {
    const g = game([P('s1', 2, 2), A('a1', 4, 2), A('a2', 7, 2, { ap: 10, maxAp: 10 })]);
    endTurn(g);
    g.units[2].ap = 10;
    const hp = g.units[0].hp;
    // крок a1 — постріл (лінія чиста), далі a2: його лінія до s1 іде через a1 — пострілу з місця немає
    while (aiStep(g, [{ x: 18, y: 18 }]));
    const shotsA2 = g.log.filter((e) => e.type === 'shot' && e.shooterId === 'a2');
    const movedA2 = g.log.some((e) => e.type === 'move' && e.unitId === 'a2');
    expect(hp).toBeGreaterThan(0);
    expect(shotsA2.length === 0 || movedA2).toBe(true);
  });
});
