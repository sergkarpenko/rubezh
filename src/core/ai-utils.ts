// src/core/ai-utils.ts
// Фаза 2 (П6): спільні примітиви ШІ — усувають дублювання між ШІ прибульців
// (ai.ts) і демо-ботом гравця (src/bot.ts). Обидві сторони поводяться
// дзеркально, різниця лише в політиці виклику (резерв AP, дозор).
// ADR-0002: Чисте ядро логіки без DOM/Canvas — уся логіка тут
// ADR-0003: Детермінізм — RNG не потрібен, порядок цілей фіксований
// ADR-0006: Туман війни — список цілей формує викликаючий (visibleEnemies)

import {
  coverOf,
  distance,
  hasLineOfSight,
  isImpassable,
  isInside,
  unitAt,
  weaponHasMode,
  type GameState,
  type ShotMode,
  type Unit,
  type Vec2,
  type Weapon,
} from './combat';
import { findPath } from './map';

// Пріоритет режимів пострілу: за очікуваним пошкодженням на постріл.
export const MODE_PRIORITY: ShotMode[] = ['auto', 'aimed', 'snap'];

// Найкращий доступний режим пострілу: дальність + LOS + AP, інакше null.
// п17.2 (ADR-0149 п. 10): лише режими зброї (`Weapon.only`) — гончак б'є, око цілиться.
export function bestShootMode(state: GameState, u: Unit, target: Unit): ShotMode | null {
  if (distance(u.pos, target.pos) > u.weapon.range) return null;
  if (!hasLineOfSight(state, u.pos, target.pos, u.side)) return null;
  for (const mode of MODE_PRIORITY) {
    if (weaponHasMode(u.weapon, mode) && u.ap >= u.weapon.modes[mode].apCost) return mode;
  }
  return null;
}

// Найближчий видимий ворог (Чебишев). Викликати лише при непорожньому списку.
export function nearestEnemy(u: Unit, enemies: Unit[]): Unit {
  return enemies.reduce((best, e) => (distance(u.pos, e.pos) < distance(u.pos, best.pos) ? e : best));
}

// Найкоротший шлях до сусідів заданих клітинок (самих клітинок може не бути
// у прохідних — вони зайняті, а findPath у зайняту клітину шляху не дає),
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

// Клітинка, до якої юніт дійде за steps кроків (обхід у ширину), і шлях до неї.
export interface Reach {
  pos: Vec2;
  path: Vec2[];
}

// Обхід у ширину по 4 напрямках (+x, -x, +y, -y), прохідність — як у findPath
// (перешкоди і живі юніти непрохідні); старт не входить. Порядок — детермінований.
// п20.3: перенесено з ai.ts — ним користуються і ШІ ворогів, і бот загону.
export function reachable(state: GameState, start: Vec2, steps: number): Reach[] {
  const out: Reach[] = [];
  const seen = new Set<string>([start.x + ',' + start.y]);
  let frontier: Reach[] = [{ pos: start, path: [] }];
  for (let d = 1; d <= steps && frontier.length > 0; d++) {
    const next: Reach[] = [];
    for (const cur of frontier) {
      for (const n of [
        { x: cur.pos.x + 1, y: cur.pos.y },
        { x: cur.pos.x - 1, y: cur.pos.y },
        { x: cur.pos.x, y: cur.pos.y + 1 },
        { x: cur.pos.x, y: cur.pos.y - 1 },
      ]) {
        const k = n.x + ',' + n.y;
        if (seen.has(k)) continue;
        seen.add(k);
        if (!isInside(state.map, n) || isImpassable(state.map, n) || unitAt(state, n) !== undefined) continue;
        const r = { pos: n, path: [...cur.path, n] };
        out.push(r);
        next.push(r);
      }
    }
    frontier = next;
  }
  return out;
}

// Лексикографічне порівняння ключів однакової довжини: a краще за b.
export function better(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

// п20.3 (ADR-0167; EARS 5 Фази 20): ранг укриття клітинки pos для юніта u від видимих
// супротивників enemies — найгірше укриття серед тих, хто може вистрілити в pos
// (дальність зброї і лінія огляду сторони u без власної клітинки u): повне 2, пів 1,
// фланг 0; жоден не дістає — 3 (поза вогнем). Ближній бій («Кігті», дальність 1)
// укриття не знає — не рахується (ADR-0165 п. 2).
export const COVER_SCORE = { none: 0, half: 1, full: 2, out: 3 } as const;
export function coverRank(state: GameState, u: Unit, pos: Vec2, enemies: Unit[]): number {
  let rank: number = COVER_SCORE.out;
  for (const e of enemies) {
    if (e.weapon.range <= 1 || distance(e.pos, pos) > e.weapon.range) continue;
    if (!hasLineOfSight(state, e.pos, pos, u.side, u.pos)) continue;
    rank = Math.min(rank, COVER_SCORE[coverOf(state.map, pos, e.pos)]);
    if (rank === COVER_SCORE.none) break;
  }
  return rank;
}

// п20.3 (ADR-0167 п. 3): на скільки клітинок (Чебишов) до цілі юніт готовий зупинитись
// далі, ніж кінець жадібного шляху, заради кращого укриття (probe на голих боях).
export const COVER_SLACK = 1;

// Найдешевший постріл зброї (AP) серед її режимів.
export function cheapestShotAp(w: Weapon): number {
  const modes = w.only ?? (['snap', 'aimed', 'auto'] as const);
  return Math.min(...modes.map((m) => w.modes[m].apCost));
}

// п20.3 (ADR-0167 п. 2): чи юніт уже ходив у цьому півході — з журналу бою від останньої
// події `turn` (стан без прихованої пам'яті ШІ: той самий стан — те саме рішення).
export function movedThisTurn(state: GameState, u: Unit): boolean {
  for (let i = state.log.length - 1; i >= 0; i--) {
    const e = state.log[i];
    if (e.type === 'turn') return false;
    if (e.type === 'move' && e.unitId === u.id) return true;
  }
  return false;
}

// п20.3 (ADR-0167 п. 2): хід з укриттям замість жадібного шляху greedy (вже обрізаного
// до бюджету). Кандидати — клітинки, досяжні за budget кроків, ближчі до цілі, ніж
// клітинка юніта, і не далі за кінець greedy більше ніж на COVER_SLACK; keep (за
// наявності) — додаткова умова типу. Ключ: ранг укриття (coverRank), далі — постріл
// по цілі з клітинки із залишком AP, далі — ближче до цілі, далі — коротший шлях,
// далі — порядок обходу. Бій без `state.cover` чи без жадібного шляху — greedy як є;
// юніт, що вже ходив цього півходу, — null (далі не йде: постріл чи дозор викликача).
export function coverStep(
  state: GameState,
  u: Unit,
  target: Unit,
  enemies: Unit[],
  greedy: Vec2[] | null,
  budget: number,
  keep?: (pos: Vec2) => boolean
): Vec2[] | null {
  if (!state.cover || greedy === null || greedy.length === 0) return greedy;
  if (movedThisTurn(state, u)) return null; // уже зайняв клітинку цього ходу — постріл або дозор, не далі
  const end = greedy[greedy.length - 1];
  const limit = distance(end, target.pos) + COVER_SLACK;
  const here = distance(u.pos, target.pos);
  const shot = cheapestShotAp(u.weapon);
  let best: Reach | null = null;
  let bestKey: number[] = [];
  for (const r of reachable(state, u.pos, budget)) {
    const d = distance(r.pos, target.pos);
    if (d >= here || d > limit || (keep && !keep(r.pos))) continue;
    const fire = d <= u.weapon.range && u.ap - r.path.length >= shot && hasLineOfSight(state, r.pos, target.pos, u.side, u.pos) ? 1 : 0;
    const k = [coverRank(state, u, r.pos, enemies), fire, -d, -r.path.length];
    if (best === null || better(k, bestKey)) {
      best = r;
      bestKey = k;
    }
  }
  return best === null ? greedy : best.path;
}
