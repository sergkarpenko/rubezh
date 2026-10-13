// src/bot.ts
// Демо-бот гравця для онлайн-превью (UI-шар; не частина бойового ядра).
// ADR-0009: Онлайн-превью через GitHub Pages
// ADR-0010: Цільовий UI — ванільний TS + Canvas 2D
//
// Дзеркало ШІ прибульців 3.5 (src/core/ai.ts): найближча видима ціль → постріл
// (auto > aimed > snap за очікуваним пошкодженням); не можна — рух у бік цілі;
// цілей не видно — рух до зони НЛО (без резерву на заступу: демо має досягти
// швидкого контакту). Спільні примітиви — у src/core/ai-utils.ts (Фаза 2, П6),
// дублювання з ai.ts усунуто. Використовує лише публічне API ядра; туман
// війни чесний (visibleEnemies). Логіка перевірена в пісочниці: 12/12 боїв
// завершуються, детерміновано.

import { endTurn, moveUnit, resolveAttack, type GameState, type Unit } from './core/combat';
import { visibleEnemies } from './core/map';
import { bestPathToNeighbors, bestShootMode, nearestEnemy, pathToward } from './core/ai-utils';
import { aiStep } from './core/ai';
import { ALIEN_SPAWN, SQUAD_SPAWN, missionOutcome } from './core/mission';

// Одна жадібна дія солдата: true — дія виконана (виконана дія завжди витрачає AP).
function soldierStep(state: GameState, u: Unit): boolean {
  if (!u.alive || u.ap <= 0) return false;
  const enemies = visibleEnemies(state, 'player');
  if (enemies.length === 0) {
    // Рух до зони НЛО (дзеркало patrolStep, але без резерву на заступу:
    // демо має досягти швидкого контакту).
    const step = bestPathToNeighbors(state, u, ALIEN_SPAWN, u.ap);
    if (step) {
      moveUnit(state, u.id, step);
      return true;
    }
    return false;
  }
  const target = nearestEnemy(u, enemies);
  const mode = bestShootMode(state, u, target);
  if (mode) {
    resolveAttack(state, u.id, target.id, mode);
    return true;
  }
  const step = pathToward(state, u, target);
  if (step) {
    moveUnit(state, u.id, step);
    return true;
  }
  return false;
}

// Хід гравця ботами: кожен живий солдат діє, доки є AP; потім кінець ходу.
// Повертає кількість дій. Викликати лише в хід гравця.
export function botTurn(state: GameState): number {
  if (state.activeSide !== 'player') throw new Error('botTurn: зараз не хід гравця');
  let actions = 0;
  for (const u of state.units.filter((x) => x.side === 'player' && x.alive)) {
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
    if (state.activeSide === 'player') botTurn(state);
    else aliensTurn(state);
    halfTurns++;
  }
  return { outcome: missionOutcome(state), halfTurns };
}
