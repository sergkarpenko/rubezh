// src/core/ai.ts
// Ітерація 3.5: прості ШІ-вороги для тактичного шару.
// ADR-0002: Чисте ядро логіки без DOM/Canvas
// ADR-0003: Детермінізм через ін'єктований RNG
// ADR-0005: Заступа (overwatch) — один постріл зі штрафом
// ADR-0006: Туман війни — лише рельєф
//
// 5.1.5: patrol-режим — якщо цілей не видно і задано зону патруля,
// прибульці наступають до неї (замість пасивного дозору); без patrol
// поведінка 3.5 без змін (BattleWidget 3.6 покладається саме на це).
// Жадібна поведінка: найближчий видимий ворог → постріл; якщо не можна — рух у бік цілі;
// якщо цілей не видно — дозор. ШІ не «читерить»: діє лише за visibleEnemies (туман війни).
// Один виклик aiStep = одна атомарна дія одного прибульця (постріл / рух / дозор) —
// зручно для покрокової анімації у віджеті. false = дій більше немає, хід можна завершувати.
//
// Фаза 2 (П6): спільні примітиви (bestShootMode, nearestEnemy, pathToward,
// bestPathToNeighbors) винесено в ai-utils.ts — ними користується і демо-бот
// гравця (src/bot.ts), дублювання логіки немає.
//
// п17.3 (ADR-0149 п. 6, п. 13; EARS 6): `aiStep` диспетчеризує за `Unit.kind`.
// Без `kind` (демон) — чинна гілка байт-у-байт. Гончак — до найслабшого видимого,
// удар впритул, дозору не тримає; голем — як демон, але рух лишає AP на постріл;
// око — відхід, якщо найближчий видимий ближче за EYE_KEEP_DISTANCE, прицільний
// постріл до 16, інакше рух на позицію пострілу. Цілі — лише видимі стороні (туман).

import {
  OVERWATCH_AP_COST,
  distance,
  hasLineOfSight,
  isImpassable,
  isInside,
  moveUnit,
  resolveAttack,
  setOverwatch,
  unitAt,
  type GameState,
  type Unit,
  type Vec2,
} from './combat';
import { findPath, visibleEnemies } from './map';
import { bestPathToNeighbors, bestShootMode, nearestEnemy, pathToward } from './ai-utils';

// Око тримається щонайменше на цій відстані (Чебишев) від найближчого видимого оперативника (ADR-0149 п. 6).
export const EYE_KEEP_DISTANCE = 6;

// Один крок ШІ прибульців. Викликати в циклі, поки не поверне false.
// 5.1.5: patrol? — зона висадки гравця (загін у місії); без patrol — 3.5 без змін.
export function aiStep(state: GameState, patrol?: Vec2[]): boolean {
  if (state.activeSide !== 'alien') return false;
  const enemies = visibleEnemies(state, 'alien');
  for (const u of state.units) {
    if (!u.alive || u.side !== 'alien' || u.ap <= 0) continue;
    const acted =
      u.kind === 'hound'
        ? houndStep(state, u, enemies, patrol)
        : u.kind === 'golem'
          ? golemStep(state, u, enemies, patrol)
          : u.kind === 'eye'
            ? eyeStep(state, u, enemies, patrol)
            : demonStep(state, u, enemies, patrol);
    if (acted) return true;
  }
  return false;
}

// Нікого не видно: патруль до зони висадки (якщо задано), потім дозор (watch).
function patrolStep(state: GameState, u: Unit, patrol: Vec2[] | undefined, watch: boolean): boolean {
  if (patrol) {
    // Цілі шляху — сусіди patrol-клітинок: самі клітини зони висадки зайняті
    // загоном, і findPath у зайняту клітину шляху не дає (v1 через це завжди
    // завершувалась дозором — зовні це виглядало як «ШІ не реагує»).
    // Резерв OVERWATCH_AP_COST — після прибуття прибулець одразу стає в дозор
    // (гончак дозору не тримає — іде без резерву).
    const step = bestPathToNeighbors(state, u, patrol, watch ? u.ap - OVERWATCH_AP_COST : u.ap);
    if (step) {
      moveUnit(state, u.id, step);
      return true;
    }
  }
  return watch && watchStep(state, u);
}

// Дозор як останній варіант.
function watchStep(state: GameState, u: Unit): boolean {
  if (!u.overwatch && u.ap >= OVERWATCH_AP_COST) {
    setOverwatch(state, u.id);
    return true;
  }
  return false;
}

// Демон (і юніт без `kind`) — чинна поведінка 3.5 / 5.1.5 байт-у-байт.
function demonStep(state: GameState, u: Unit, enemies: Unit[], patrol?: Vec2[]): boolean {
  if (enemies.length === 0) return patrolStep(state, u, patrol, true);

  // Найближчий видимий ворог (Чебишев).
  const target = nearestEnemy(u, enemies);

  // 1) постріл, якщо можливо.
  const mode = bestShootMode(state, u, target);
  if (mode) {
    resolveAttack(state, u.id, target.id, mode);
    return true;
  }

  // 2) рух у бік цілі.
  const step = pathToward(state, u, target);
  if (step) {
    moveUnit(state, u.id, step);
    return true; // наступний aiStep спробує вистрілити з нової позиції
  }

  // 3) ні руху, ні пострілу — дозор як останній варіант.
  return watchStep(state, u);
}

// Найдешевший постріл зброї юніта (AP) серед доступних режимів.
function cheapestShotAp(u: Unit): number {
  const modes = u.weapon.only ?? (['snap', 'aimed', 'auto'] as const);
  return Math.min(...modes.map((m) => u.weapon.modes[m].apCost));
}

// Гончак (ADR-0149 п. 13): ціль — найменше HP серед видимих, рівність — найближчий
// (далі — порядок юнітів); удар, якщо впритул; інакше рух до клітинки впритул
// (8 сусідів — Чебишев 1) на всі AP; дійшов і лишилось ≥ 3 AP — наступний крок б'є.
// Недосяжна ціль — наступна за тим самим порядком. Дозору не тримає.
function houndStep(state: GameState, u: Unit, enemies: Unit[], patrol?: Vec2[]): boolean {
  if (enemies.length === 0) return patrolStep(state, u, patrol, false);
  const order = [...enemies].sort((a, b) => a.hp - b.hp || distance(u.pos, a.pos) - distance(u.pos, b.pos));
  for (const t of order) {
    const mode = bestShootMode(state, u, t);
    if (mode) {
      resolveAttack(state, u.id, t.id, mode);
      return true;
    }
    if (distance(u.pos, t.pos) <= 1) return false; // уже впритул до своєї цілі, AP на удар немає — чекає
    const path = pathAdjacent(state, u.pos, t.pos);
    if (path === null) continue;
    moveUnit(state, u.id, path.slice(0, u.ap)); // аудит PR #508: окремого резерву немає — шлях до цілі коротший за AP
    return true;
  }
  return false;
}

// Найкоротший шлях до клітинки впритул (Чебишев 1) до pos; порядок сусідів фіксований.
function pathAdjacent(state: GameState, from: Vec2, pos: Vec2): Vec2[] | null {
  let best: Vec2[] | null = null;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const p = findPath(state, from, { x: pos.x + dx, y: pos.y + dy });
      if (p && p.length > 0 && (best === null || p.length < best.length)) best = p;
    }
  }
  return best;
}

// Голем (ADR-0149 п. 13): як демон, але рух лишає AP на найдешевший постріл.
function golemStep(state: GameState, u: Unit, enemies: Unit[], patrol?: Vec2[]): boolean {
  if (enemies.length === 0) return patrolStep(state, u, patrol, true);
  const target = nearestEnemy(u, enemies);
  const mode = bestShootMode(state, u, target);
  if (mode) {
    resolveAttack(state, u.id, target.id, mode);
    return true;
  }
  const step = bestPathToNeighbors(state, u, [target.pos], u.ap - cheapestShotAp(u));
  if (step) {
    moveUnit(state, u.id, step);
    return true;
  }
  return watchStep(state, u);
}

// Клітинка, до якої юніт дійде за steps кроків (обхід у ширину), і шлях до неї.
interface Reach {
  pos: Vec2;
  path: Vec2[];
}

// Обхід у ширину по 4 напрямках (+x, -x, +y, -y), прохідність — як у findPath
// (перешкоди і живі юніти непрохідні); старт не входить. Порядок — детермінований.
function reachable(state: GameState, start: Vec2, steps: number): Reach[] {
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

// Відстань від pos до найближчого з видимих ворогів (Чебишев).
function minDistance(pos: Vec2, enemies: Unit[]): number {
  return Math.min(...enemies.map((e) => distance(pos, e.pos)));
}

// Чи може юніт з клітинки pos вистрілити хоч в одного видимого ворога (дальність і лінія).
// п17.4: лінія — із закривачами сторони, без власної клітинки юніта (він піде з неї).
function canShootFrom(state: GameState, u: Unit, pos: Vec2, enemies: Unit[]): boolean {
  return enemies.some((e) => distance(pos, e.pos) <= u.weapon.range && hasLineOfSight(state, pos, e.pos, u.side, u.pos));
}

// Око (ADR-0149 п. 13): найближчий видимий ближче за EYE_KEEP_DISTANCE і є відхід
// із запасом AP на прицільний постріл — відхід; інакше прицільний постріл (найближча
// ціль, яку можна вразити); інакше рух на позицію пострілу (не ближче за EYE_KEEP_DISTANCE),
// а якщо такої цього ходу немає — до цілі, зупиняючись перед EYE_KEEP_DISTANCE.
function eyeStep(state: GameState, u: Unit, enemies: Unit[], patrol?: Vec2[]): boolean {
  if (enemies.length === 0) return patrolStep(state, u, patrol, true);
  const shot = cheapestShotAp(u);
  const here = minDistance(u.pos, enemies);
  const keep = (d: number): number => Math.min(d, EYE_KEEP_DISTANCE);

  // 1) відхід: більша відстань до найближчого (до EYE_KEEP_DISTANCE), далі — позиція
  // з пострілом, далі — ще більша відстань, далі — коротший шлях.
  if (here < EYE_KEEP_DISTANCE && u.ap - shot > 0) {
    let best: Reach | null = null;
    let bestKey: number[] = [];
    for (const r of reachable(state, u.pos, u.ap - shot)) {
      const d = minDistance(r.pos, enemies);
      if (d <= here) continue;
      const k = [keep(d), canShootFrom(state, u, r.pos, enemies) ? 1 : 0, d, -r.path.length];
      if (best === null || better(k, bestKey)) {
        best = r;
        bestKey = k;
      }
    }
    if (best !== null) {
      moveUnit(state, u.id, best.path);
      return true;
    }
  }

  // 2) прицільний постріл — найближча ціль, яку можна вразити.
  const byDistance = [...enemies].sort((a, b) => distance(u.pos, a.pos) - distance(u.pos, b.pos));
  for (const t of byDistance) {
    const mode = bestShootMode(state, u, t);
    if (mode) {
      resolveAttack(state, u.id, t.id, mode);
      return true;
    }
  }

  // 3) позиція пострілу цього ходу: найкоротший шлях, далі — більша відстань.
  let pos: Reach | null = null;
  for (const r of reachable(state, u.pos, u.ap - shot)) {
    const d = minDistance(r.pos, enemies);
    if (d < EYE_KEEP_DISTANCE || !canShootFrom(state, u, r.pos, enemies)) continue;
    if (pos === null || r.path.length < pos.path.length || (r.path.length === pos.path.length && d > minDistance(pos.pos, enemies)))
      pos = r;
  }
  if (pos !== null) {
    moveUnit(state, u.id, pos.path);
    return true;
  }

  // Уже на позиції пострілу, але AP на постріл немає, — не підходить, а дозор.
  if (here >= EYE_KEEP_DISTANCE && canShootFrom(state, u, u.pos, enemies)) return watchStep(state, u);

  // 4) рух до найближчої цілі на всі AP, але не ближче за EYE_KEEP_DISTANCE.
  const toward = pathToward(state, u, nearestEnemy(u, enemies)) ?? [];
  const cut = toward.findIndex((p) => minDistance(p, enemies) < EYE_KEEP_DISTANCE);
  const step = cut < 0 ? toward : toward.slice(0, cut);
  if (step.length > 0) {
    moveUnit(state, u.id, step);
    return true;
  }
  return watchStep(state, u);
}

// Лексикографічне порівняння ключів однакової довжини: a краще за b.
function better(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
