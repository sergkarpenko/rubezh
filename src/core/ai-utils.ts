// src/core/ai-utils.ts
// Фаза 2 (П6): спільні примітиви ШІ — усувають дублювання між ШІ прибульців
// (ai.ts) і демо-ботом гравця (src/bot.ts). Обидві сторони поводяться
// дзеркально, різниця лише в політиці виклику (резерв AP, заступа).
// ADR-0002: Чисте ядро логіки без DOM/Canvas — уся логіка тут
// ADR-0003: Детермінізм — RNG не потрібен, порядок цілей фіксований
// ADR-0006: Туман війни — список цілей формує викликаючий (visibleEnemies)

import { distance, hasLineOfSight, type GameState, type ShotMode, type Unit, type Vec2 } from './combat';
import { findPath } from './map';

// Пріоритет режимів пострілу: за очікуваним пошкодженням на постріл.
export const MODE_PRIORITY: ShotMode[] = ['auto', 'aimed', 'snap'];

// Найкращий доступний режим пострілу: дальність + LOS + AP, інакше null.
export function bestShootMode(state: GameState, u: Unit, target: Unit): ShotMode | null {
  if (distance(u.pos, target.pos) > u.weapon.range) return null;
  if (!hasLineOfSight(state, u.pos, target.pos)) return null;
  for (const mode of MODE_PRIORITY) {
    if (u.ap >= u.weapon.modes[mode].apCost) return mode;
  }
  return null;
}

// Найближчий видимий ворог (Чебишев). Викликати лише при непорожньому списку.
export function nearestEnemy(u: Unit, enemies: Unit[]): Unit {
  return enemies.reduce((best, e) => (distance(u.pos, e.pos) < distance(u.pos, best.pos) ? e : best));
}

// Найкоротший шлях до СУСІДів заданих клітинок (самих клітинок може не бути
// в проходимих — вони зайняті, а findPath у зайняту клітину шляху не дає),
// обрізаний до бюджету AP; budget <= 0 або шляху немає → null.
// Порядок цілей фіксований (+x, -x, +y, -y) — при рівній довжині
// перемагає перший знайдений шлях (детермінізм).
export function bestPathToNeighbors(state: GameState, u: Unit, cells: Vec2[], budget: number): Vec2[] | null {
  if (budget <= 0) return null;
  const goals: Vec2[] = [];
  for (const p of cells) {
    goals.push({ x: p.x + 1, y: p.y }, { x: p.x - 1, y: p.y }, { x: p.x, y: p.y + 1 }, { x: p.x, y: p.y - 1 });
  }
  let best: Vec2[] | null = null;
  for (const g of goals) {
    const p = findPath(state, u.pos, g);
    if (p && p.length > 0 && (best === null || p.length < best.length)) best = p;
  }
  if (!best) return null;
  return best.slice(0, budget);
}

// Шлях до клітинки поруч із ціллю, обрізаний до наявних AP.
export function pathToward(state: GameState, u: Unit, target: Unit): Vec2[] | null {
  return bestPathToNeighbors(state, u, [target.pos], u.ap);
}
