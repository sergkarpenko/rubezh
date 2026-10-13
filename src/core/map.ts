// src/core/map.ts
// Ітерація 2: пошук шляху (A*), туман війни, генератор тестових мап.
// ADR-0002: Чисте ядро логіки без DOM/Canvas
// ADR-0006: Туман війни — лише рельєф (юніти не блокують огляд)
//
// Чиста логіка без DOM/Canvas; туман рахується лише по рельєфу (юніти не блокують огляд — MVP-спрощення).

import {
  MOVE_AP_PER_CELL,
  hasLineOfSight,
  isBlocked,
  isInside,
  mulberry32,
  unitAt,
  type GameMap,
  type GameState,
  type Side,
  type Unit,
  type Vec2,
} from './combat';

export const VISION_RANGE = 12;

function key(pos: Vec2): string {
  return pos.x + ',' + pos.y;
}

// --- Пошук шляху (A*, 4 напрямки, евристика Мангеттен) ---

/**
 * Коротший шлях від start до goal (не включаючи start) або null, якщо ціль недосяжна.
 * Перешкоди та зайняті юнітами клітинки непрохідні; ціль, зайнята юнітом → null.
 * Вартість: path.length × MOVE_AP_PER_CELL (див. pathApCost).
 */
export function findPath(state: GameState, start: Vec2, goal: Vec2, maxNodes = 2000): Vec2[] | null {
  const k = (p: Vec2) => p.x + ',' + p.y;
  if (k(start) === k(goal)) return []; // спершу старт = ціль, потім перевірка зайнятості
  const passable = (p: Vec2): boolean => isInside(state.map, p) && !isBlocked(state.map, p) && !unitAt(state, p);
  if (!passable(goal)) return null;

  const h = (p: Vec2) => Math.abs(p.x - goal.x) + Math.abs(p.y - goal.y);
  interface Node {
    pos: Vec2;
    g: number;
    f: number;
  }
  const open: Node[] = [{ pos: start, g: 0, f: h(start) }];
  const cameFrom = new Map<string, string>();
  const gScore = new Map<string, number>([[k(start), 0]]);
  const closed = new Set<string>();
  let visited = 0;

  while (open.length > 0 && visited < maxNodes) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const cur = open.splice(bi, 1)[0];
    if (closed.has(k(cur.pos))) continue;
    closed.add(k(cur.pos));
    visited++;
    if (k(cur.pos) === k(goal)) {
      const path: Vec2[] = [];
      let ck: string | undefined = k(cur.pos);
      while (ck && ck !== k(start)) {
        const [x, y] = ck.split(',').map(Number);
        path.unshift({ x, y });
        ck = cameFrom.get(ck);
      }
      return path;
    }
    const nb: Vec2[] = [
      { x: cur.pos.x + 1, y: cur.pos.y },
      { x: cur.pos.x - 1, y: cur.pos.y },
      { x: cur.pos.x, y: cur.pos.y + 1 },
      { x: cur.pos.x, y: cur.pos.y - 1 },
    ];
    for (const n of nb) {
      if (closed.has(k(n)) || !passable(n)) continue;
      const ng = cur.g + 1;
      if (ng < (gScore.get(k(n)) ?? Infinity)) {
        gScore.set(k(n), ng);
        cameFrom.set(k(n), k(cur.pos));
        open.push({ pos: n, g: ng, f: ng + h(n) });
      }
    }
  }
  return null;
}

export function pathApCost(path: Vec2[]): number {
  return path.length * MOVE_AP_PER_CELL;
}

// --- Туман війни ---

/**
 * Клітинки, видимі з pos (ключі "x,y"): вся клітинка «залишається видимою»,
 * якщо лінія вогню до неї чиста; стіни самі видимі, але ховають клітинки за ними.
 * range — радіус Чебишова; квадрат дальності обрізується межами мапи.
 */
export function computeVisibleCells(state: GameState, pos: Vec2, range = VISION_RANGE): Set<string> {
  const visible = new Set<string>();
  visible.add(key(pos));
  for (let dx = -range; dx <= range; dx++) {
    for (let dy = -range; dy <= range; dy++) {
      const cell = { x: pos.x + dx, y: pos.y + dy };
      if (!isInside(state.map, cell)) continue;
      if (hasLineOfSight(state, pos, cell)) visible.add(key(cell));
    }
  }
  return visible;
}

/**
 * Ворожі юніти, видимі даною стороною: хоч один її юніт бачить клітинку ворога.
 */
export function visibleEnemies(state: GameState, side: Side): Unit[] {
  const seen = new Set<string>();
  for (const u of state.units) {
    if (u.side !== side || !u.alive) continue;
    for (const kk of computeVisibleCells(state, u.pos)) seen.add(kk);
  }
  return state.units.filter((u) => u.alive && u.side !== side && seen.has(key(u.pos)));
}

// --- Генератор тестових мап ---

/**
 * Детермінована сідом мапа зі розкиданими перешкодами.
 * Спавн-зони (2,2) і (17,2) завжди чисті. Без гарантії зв'язності —
 * для масових тестових боїв; сюжетні мапи пишемо вручну.
 */
export function makeTestMap(seed: number, width = 20, height = 20, density = 0.08): GameMap {
  const rng = mulberry32(seed);
  const blocked = new Set<string>();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (rng() < density) blocked.add(x + ',' + y);
    }
  }
  for (const [sx, sy] of [
    [2, 2],
    [17, 2],
  ] as const) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        blocked.delete(sx + dx + ',' + (sy + dy));
      }
    }
  }
  return { width, height, blocked };
}
