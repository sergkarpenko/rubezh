// src/bot.ts
// Демо-бот гравця для онлайн-превью (UI-шар; не частина бойового ядра).
// ADR-0009: Онлайн-превью через GitHub Pages
// ADR-0010: Цільовий UI — ванільний TS + Canvas 2D
//
// Дзеркало ШІ прибульців 3.5 (src/core/ai.ts): найближча видима ціль → постріл
// (auto > aimed > snap за очікуваним пошкодженням); не можна — рух у бік цілі;
// цілей не видно — рух до зони НЛО (без резерву на заступу: демо має досягти
// швидкого контакту). Використовує лише публічне API ядра; туман війни чесний
// (visibleEnemies). Логіка перевірена в пісочниці: 12/12 боїв завершуються,
// детерміновано.

import {
  distance, endTurn, hasLineOfSight, moveUnit, resolveAttack,
  type GameState, type ShotMode, type Unit, type Vec2,
} from './core/combat';
import { findPath, visibleEnemies } from './core/map';
import { aiStep } from './core/ai';
import { ALIEN_SPAWN, SQUAD_SPAWN, missionOutcome } from './core/mission';

const MODE_PRIORITY: ShotMode[] = ['auto', 'aimed', 'snap']; // за очікуваним пошкодженням на постріл

// Найкращий доступний режим пострілу: дальність + LOS + AP, інакше null.
function bestShootMode(state: GameState, u: Unit, target: Unit): ShotMode | null {
  if (distance(u.pos, target.pos) > u.weapon.range) return null;
  if (!hasLineOfSight(state, u.pos, target.pos)) return null;
  for (const mode of MODE_PRIORITY) {
    if (u.ap >= u.weapon.modes[mode].apCost) return mode;
  }
  return null;
}

// Шлях до клітинки поруч із ціллю, обрізаний до наявних AP (як pathToward у ai.ts).
function pathToward(state: GameState, u: Unit, target: Unit): Vec2[] | null {
  const goals: Vec2[] = [
    { x: target.pos.x + 1, y: target.pos.y }, { x: target.pos.x - 1, y: target.pos.y },
    { x: target.pos.x, y: target.pos.y + 1 }, { x: target.pos.x, y: target.pos.y - 1 },
  ];
  let best: Vec2[] | null = null;
  for (const g of goals) {
    const p = findPath(state, u.pos, g);
    if (p && p.length > 0 && (best === null || p.length < best.length)) best = p;
  }
  if (!best) return null;
  return best.slice(0, u.ap);
}

// Рух до зони НЛО, коли цілей не видно (дзеркало patrolStep, без резерву AP).
function advanceStep(state: GameState, u: Unit): Vec2[] | null {
  const goals: Vec2[] = [];
  for (const p of ALIEN_SPAWN) {
    goals.push({ x: p.x + 1, y: p.y }, { x: p.x - 1, y: p.y }, { x: p.x, y: p.y + 1 }, { x: p.x, y: p.y - 1 });
  }
  let best: Vec2[] | null = null;
  for (const g of goals) {
    const p = findPath(state, u.pos, g);
    if (p && p.length > 0 && (best === null || p.length < best.length)) best = p;
  }
  if (!best) return null;
  return best.slice(0, u.ap);
}

// Одна жадібна дія солдата: true — дія виконана (виконана дія завжди витрачає AP).
function soldierStep(state: GameState, u: Unit): boolean {
  if (!u.alive || u.ap <= 0) return false;
  const enemies = visibleEnemies(state, 'player');
  if (enemies.length === 0) {
    const step = advanceStep(state, u);
    if (step) { moveUnit(state, u.id, step); return true; }
    return false;
  }
  const target = enemies.reduce((best, e) => distance(u.pos, e.pos) < distance(u.pos, best.pos) ? e : best);
  const mode = bestShootMode(state, u, target);
  if (mode) { resolveAttack(state, u.id, target.id, mode); return true; }
  const step = pathToward(state, u, target);
  if (step) { moveUnit(state, u.id, step); return true; }
  return false;
}

// Хід гравця ботами: кожен живий солдат діє, доки є AP; потім кінець ходу.
// Повертає кількість дій. Викликати лише в хід гравця.
export function botTurn(state: GameState): number {
  if (state.activeSide !== 'player') throw new Error('botTurn: зараз не хід гравця');
  let actions = 0;
  for (const u of state.units.filter(x => x.side === 'player' && x.alive)) {
    let guard = 0;
    while (u.alive && u.ap > 0 && guard++ < 60 && soldierStep(state, u)) actions++;
  }
  endTurn(state);
  return actions;
}

// Хід прибульців: цикл aiStep (patrol = зона висадки, як у MissionBattle 5.1.5)
// до завершення, потім кінець ходу. Повертає кількість дій.
export function aliensTurn(state: GameState): number {
  if (state.activeSide !== 'alien') throw new Error('aliensTurn: зараз не хід прибульців');
  let actions = 0;
  let guard = 0;
  while (guard++ < 60 && aiStep(state, SQUAD_SPAWN)) actions++;
  endTurn(state);
  return actions;
}

// Авто-бій до перемоги/поразки (для демо-превью). Повертає результат і кількість півходів.
export function autoBattle(state: GameState, maxHalfTurns = 240): { outcome: ReturnType<typeof missionOutcome>; halfTurns: number } {
  let halfTurns = 0;
  while (missionOutcome(state) === 'триває' && halfTurns < maxHalfTurns) {
    if (state.activeSide === 'player') botTurn(state); else aliensTurn(state);
    halfTurns++;
  }
  return { outcome: missionOutcome(state), halfTurns };
}
