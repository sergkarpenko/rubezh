
import React, { useEffect, useReducer, useRef, useState } from "react";

// ============================================================
// Рубіж — віджет бою з ШІ прибульців (ітерація 3.6: баланс підібрано симуляціями)
// Ядро (combat.ts + map.ts, ітерації 0–2) вбудоване нижче без змін логіки.
// Нове: ai.ts — жадібні ШІ-вороги; хід прибульців програється автоматично.
// Баланс: прибульці — «Імпульсний різак» (2–5), точність .50/.45/.40 → ~70% перемог гравця.
// Туман війни зафіксовано на боці гравця (рішення з теми Knowledge).
// ============================================================

// ======== ЯДРО: src/core/combat.ts ========

type RNG = () => number; // [0, 1)

interface Vec2 { x: number; y: number }
type Side = "player" | "alien";
type ShotMode = "auto" | "snap" | "aimed";

interface ShotProfile { apCost: number; accuracyMod: number; shots: number }
interface Weapon { name: string; damage: [number, number]; range: number; modes: Record<ShotMode, ShotProfile> }

interface Unit {
  id: string;
  side: Side;
  name: string;
  pos: Vec2;
  hp: number;
  maxHp: number;
  ap: number;
  maxAp: number;
  firingAccuracy: number;
  weapon: Weapon;
  alive: boolean;
  kills: number;
  overwatch: boolean;
}

type GameEvent =
  | { type: "move"; unitId: string; from: Vec2; to: Vec2 }
  | { type: "shot"; shooterId: string; targetId: string; mode: ShotMode; hit: boolean; damage: number }
  | { type: "death"; unitId: string; killerId: string }
  | { type: "turn"; turn: number; side: Side }
  | { type: "overwatch"; unitId: string; armed: boolean };

interface GameMap { width: number; height: number; blocked: ReadonlySet<string> }
interface GameState {
  map: GameMap;
  units: Unit[];
  turn: number;
  activeSide: Side;
  rng: RNG;
  log: GameEvent[];
}

const MOVE_AP_PER_CELL = 1;
const HIT_CHANCE_FLOOR = 0.02;
const HIT_CHANCE_CAP = 0.95;
const OVERWATCH_AP_COST = 3;
const OVERWATCH_ACC_PENALTY = 0.7;

const RIFLE: Weapon = {
  name: "АР-14 «Гарт»",
  damage: [3, 6],
  range: 12,
  modes: {
    auto: { apCost: 4, accuracyMod: 0.5, shots: 3 },
    snap: { apCost: 3, accuracyMod: 0.8, shots: 1 },
    aimed: { apCost: 5, accuracyMod: 1.15, shots: 1 },
  },
};

// Зброя прибульців (баланс 3.6, підібрано масовими симуляціями: dmg 2-5, acc .50/.45/.40).
const ALIEN_CUTTER: Weapon = {
  name: "Імпульсний різак",
  damage: [2, 5],
  range: 12,
  modes: {
    auto: { apCost: 4, accuracyMod: 0.5, shots: 3 },
    snap: { apCost: 3, accuracyMod: 0.8, shots: 1 },
    aimed: { apCost: 5, accuracyMod: 1.15, shots: 1 },
  },
};

function mulberry32(seed: number): RNG {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function key(pos: Vec2): string { return pos.x + "," + pos.y; }

function distance(a: Vec2, b: Vec2): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function bresenham(a: Vec2, b: Vec2): Vec2[] {
  const pts: Vec2[] = [];
  let x0 = a.x, y0 = a.y;
  const x1 = b.x, y1 = b.y;
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  for (;;) {
    pts.push({ x: x0, y: y0 });
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 < dx) { err += dx; y0 += sy; }
  }
  return pts;
}

function isInside(map: GameMap, pos: Vec2): boolean {
  return pos.x >= 0 && pos.y >= 0 && pos.x < map.width && pos.y < map.height;
}
function isBlocked(map: GameMap, pos: Vec2): boolean { return map.blocked.has(key(pos)); }
function unitAt(state: GameState, pos: Vec2): Unit | undefined {
  return state.units.find(u => u.alive && u.pos.x === pos.x && u.pos.y === pos.y);
}
function getUnit(state: GameState, id: string): Unit {
  const u = state.units.find(u => u.id === id);
  if (!u) throw new Error("Невідомий юніт: " + id);
  return u;
}
function requireActive(state: GameState, u: Unit): void {
  if (!u.alive) throw new Error("Юніт " + u.id + " мертвий");
  if (u.side !== state.activeSide) throw new Error("Зараз хід не сторони " + u.side);
}

// Лінія вогню: проміжні клітинки (без кінців) не мають перешкод.
function hasLineOfSight(state: GameState, from: Vec2, to: Vec2): boolean {
  const line = bresenham(from, to);
  for (let i = 1; i < line.length - 1; i++) {
    if (isBlocked(state.map, line[i])) return false;
  }
  return true;
}

// Влучність не залежить від цілі (як в оригіналі): точність солдата × режим пострілу.
function calculateHitChance(attacker: Unit, mode: ShotMode): number {
  const mod = attacker.weapon.modes[mode].accuracyMod;
  return Math.min(HIT_CHANCE_CAP, Math.max(HIT_CHANCE_FLOOR, attacker.firingAccuracy * mod));
}

function makeUnit(init: Partial<Unit> & { id: string; side: Side; pos: Vec2 }): Unit {
  return {
    name: init.id, hp: 10, maxHp: 10, ap: 10, maxAp: 10,
    firingAccuracy: 0.6, weapon: RIFLE, alive: true, kills: 0, overwatch: false,
    ...init,
  };
}

interface CreateGameOptions {
  map: GameMap;
  units: Unit[];
  rng?: RNG;
  startingSide?: Side;
}

function createGame(opts: CreateGameOptions): GameState {
  const state: GameState = {
    map: opts.map, units: opts.units, turn: 1,
    activeSide: opts.startingSide ?? "player",
    rng: opts.rng ?? mulberry32(42),
    log: [],
  };
  for (const u of state.units) if (u.side === state.activeSide) u.ap = u.maxAp;
  return state;
}

function endTurn(state: GameState): void {
  const next: Side = state.activeSide === "player" ? "alien" : "player";
  if (next === "player") state.turn += 1;
  state.activeSide = next;
  // на початку свого ходу заступа скидається (AP зарезервовані минулого разу)
  for (const u of state.units) if (u.side === next && u.alive) { u.ap = u.maxAp; u.overwatch = false; }
  state.log.push({ type: "turn", turn: state.turn, side: next });
}

// Заступа: резервація AP за один хід до початку ходу ворога.
function setOverwatch(state: GameState, unitId: string): void {
  const u = getUnit(state, unitId);
  requireActive(state, u);
  if (u.overwatch) return;
  if (u.ap < OVERWATCH_AP_COST) throw new Error("Недостатньо очок дій для заступи");
  u.ap -= OVERWATCH_AP_COST;
  u.overwatch = true;
  state.log.push({ type: "overwatch", unitId: u.id, armed: true });
}

// Рух по готовому шляху (A* — нижче). Кожен крок може спровокувати реакційний вогонь.
function moveUnit(state: GameState, unitId: string, path: Vec2[]): void {
  const u = getUnit(state, unitId);
  requireActive(state, u);
  for (const step of path) {
    if (Math.abs(step.x - u.pos.x) + Math.abs(step.y - u.pos.y) !== 1) {
      throw new Error("Крок не суміжний (дозволені 4 напрямки)");
    }
    if (!isInside(state.map, step)) throw new Error("Крок за межі мапи");
    if (isBlocked(state.map, step)) throw new Error("Крок у перешкоду");
    if (unitAt(state, step)) throw new Error("Клітинка зайнята");
    if (u.ap < MOVE_AP_PER_CELL) throw new Error("Недостатньо очок дій");
    const from = { ...u.pos };
    u.ap -= MOVE_AP_PER_CELL;
    u.pos = { ...step };
    state.log.push({ type: "move", unitId: u.id, from, to: { ...step } });
    triggerOverwatch(state, u);
    if (!u.alive) break; // реакційний вогонь перервав рух
  }
}

function fireReaction(state: GameState, shooter: Unit, target: Unit): void {
  const profile = shooter.weapon.modes.snap;
  const chance = Math.min(
    HIT_CHANCE_CAP,
    Math.max(HIT_CHANCE_FLOOR, shooter.firingAccuracy * profile.accuracyMod * OVERWATCH_ACC_PENALTY),
  );
  const hit = state.rng() < chance;
  let damage = 0;
  if (hit) {
    const dmin = shooter.weapon.damage[0], dmax = shooter.weapon.damage[1];
    damage = dmin + Math.floor(state.rng() * (dmax - dmin + 1));
    target.hp -= damage;
    if (target.hp <= 0) {
      target.hp = 0; target.alive = false; shooter.kills += 1;
      state.log.push({ type: "death", unitId: target.id, killerId: shooter.id });
    }
  }
  state.log.push({ type: "shot", shooterId: shooter.id, targetId: target.id, mode: "snap", hit, damage });
}

function triggerOverwatch(state: GameState, mover: Unit): void {
  for (const w of state.units) {
    if (!w.alive || !w.overwatch || w.side === mover.side) continue;
    if (distance(w.pos, mover.pos) > w.weapon.range) continue;
    if (!hasLineOfSight(state, w.pos, mover.pos)) continue;
    w.overwatch = false; // заступа «розряджається» одним пострілом
    fireReaction(state, w, mover);
    if (!mover.alive) return;
  }
}

interface AttackResult { shots: { hit: boolean; damage: number }[]; targetDown: boolean }

function resolveAttack(state: GameState, shooterId: string, targetId: string, mode: ShotMode): AttackResult {
  const s = getUnit(state, shooterId);
  const t = getUnit(state, targetId);
  requireActive(state, s);
  if (!t.alive) throw new Error("Ціль уже мертва");
  if (s.side === t.side) throw new Error("Вогонь по своїх заборонений");
  if (distance(s.pos, t.pos) > s.weapon.range) throw new Error("Ціль поза дальністю зброї");
  if (!hasLineOfSight(state, s.pos, t.pos)) throw new Error("Немає лінії вогню");
  const profile = s.weapon.modes[mode];
  if (s.ap < profile.apCost) throw new Error("Недостатньо очок дій для пострілу " + mode);
  s.ap -= profile.apCost;
  const chance = calculateHitChance(s, mode);
  const result: AttackResult = { shots: [], targetDown: false };
  for (let i = 0; i < profile.shots; i++) {
    const hit = state.rng() < chance;
    let damage = 0;
    if (hit) {
      const dmin = s.weapon.damage[0], dmax = s.weapon.damage[1];
      damage = dmin + Math.floor(state.rng() * (dmax - dmin + 1));
      t.hp -= damage;
      if (t.hp <= 0) {
        t.hp = 0; t.alive = false; s.kills += 1;
        result.targetDown = true;
        state.log.push({ type: "death", unitId: t.id, killerId: s.id });
      }
    }
    state.log.push({ type: "shot", shooterId: s.id, targetId: t.id, mode, hit, damage });
    result.shots.push({ hit, damage });
    if (!t.alive) break; // мертва ціль не отримує зайвих куль серії
  }
  return result;
}

// ======== ЯДРО: src/core/map.ts ========

const VISION_RANGE = 12;

function findPath(state: GameState, start: Vec2, goal: Vec2, maxNodes = 2000): Vec2[] | null {
  const k = (p: Vec2) => p.x + "," + p.y;
  if (k(start) === k(goal)) return [];
  const passable = (p: Vec2): boolean =>
    isInside(state.map, p) && !isBlocked(state.map, p) && !unitAt(state, p);
  if (!passable(goal)) return null;

  const h = (p: Vec2) => Math.abs(p.x - goal.x) + Math.abs(p.y - goal.y);
  interface Node { pos: Vec2; g: number; f: number }
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
        const [x, y] = ck.split(",").map(Number);
        path.unshift({ x, y });
        ck = cameFrom.get(ck);
      }
      return path;
    }
    const nb: Vec2[] = [
      { x: cur.pos.x + 1, y: cur.pos.y }, { x: cur.pos.x - 1, y: cur.pos.y },
      { x: cur.pos.x, y: cur.pos.y + 1 }, { x: cur.pos.x, y: cur.pos.y - 1 },
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

function pathApCost(path: Vec2[]): number {
  return path.length * MOVE_AP_PER_CELL;
}

function computeVisibleCells(state: GameState, pos: Vec2, range = VISION_RANGE): Set<string> {
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

function visibleEnemies(state: GameState, side: Side): Unit[] {
  const seen = new Set<string>();
  for (const u of state.units) {
    if (u.side !== side || !u.alive) continue;
    for (const kk of computeVisibleCells(state, u.pos)) seen.add(kk);
  }
  return state.units.filter(u => u.alive && u.side !== side && seen.has(key(u.pos)));
}

function makeTestMap(seed: number, width = 20, height = 20, density = 0.08): GameMap {
  const rng = mulberry32(seed);
  const blocked = new Set<string>();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (rng() < density) blocked.add(x + "," + y);
    }
  }
  for (const [sx, sy] of [[2, 2], [17, 2]] as const) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        blocked.delete((sx + dx) + "," + (sy + dy));
      }
    }
  }
  return { width, height, blocked };
}

// ======== ЯДРО: src/core/ai.ts (ітерація 3.5) ========
// Прості ШІ-вороги: жадібна поведінка — рух до найближчого видимого ворога + постріл.
// Один виклик aiStep = одна атомарна дія одного прибульця (постріл / рух / заступа) —
// зручно для покрокової анімації у віджеті. false = дій більше немає, хід можна завершувати.
// ШІ не «читерить»: діє лише за відомою йому інформацією (visibleEnemies).

const MODE_PRIORITY: ShotMode[] = ["auto", "aimed", "snap"]; // за очікуваним пошкодженням на постріл

// Найкращий доступний режим пострілу: дальність + LOS + AP, інакше null.
function bestShootMode(state: GameState, u: Unit, target: Unit): ShotMode | null {
  if (distance(u.pos, target.pos) > u.weapon.range) return null;
  if (!hasLineOfSight(state, u.pos, target.pos)) return null;
  for (const mode of MODE_PRIORITY) {
    if (u.ap >= u.weapon.modes[mode].apCost) return mode;
  }
  return null;
}

// Шлях до клітинки поруч із ціллю (сусідні 4 клітинки цілі), обрізаний до наявних AP.
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

// Один крок ШІ прибульців. Викликати в циклі, поки не поверне false.
function aiStep(state: GameState): boolean {
  if (state.activeSide !== "alien") return false;
  const enemies = visibleEnemies(state, "alien");
  for (const u of state.units) {
    if (!u.alive || u.side !== "alien" || u.ap <= 0) continue;

    if (enemies.length === 0) {
      // Нікого не видно: заступа, інакше стоїть.
      if (!u.overwatch && u.ap >= OVERWATCH_AP_COST) {
        setOverwatch(state, u.id);
        return true;
      }
      continue;
    }

    // Найближчий видимий ворог (Чебишев).
    const target = enemies.reduce((best, e) => distance(u.pos, e.pos) < distance(u.pos, best.pos) ? e : best);

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

    // 3) ні руху, ні пострілу — заступа як останній варіант.
    if (!u.overwatch && u.ap >= OVERWATCH_AP_COST) {
      setOverwatch(state, u.id);
      return true;
    }
  }
  return false;
}

// ======== ДОПОМІЖНЕ ДЛЯ ВІДЖЕТА (лише відображення, без правил) ========

// Перша вільна клітинка спіраллю навколо точки (розміщення юнітів на старті).
function findFreeCell(map: GameMap, around: Vec2, occupied: Set<string>): Vec2 {
  for (let r = 0; r < 8; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const p = { x: around.x + dx, y: around.y + dy };
        if (isInside(map, p) && !isBlocked(map, p) && !occupied.has(p.x + "," + p.y)) return p;
      }
    }
  }
  return { ...around };
}

// Нова битва: той самий сід — той самий бій (детермінізм ядра).
function newBattle(seed: number): GameState {
  const map = makeTestMap(seed);
  const occupied = new Set<string>();
  const place = (around: Vec2): Vec2 => {
    const p = findFreeCell(map, around, occupied);
    occupied.add(p.x + "," + p.y);
    return p;
  };
  return createGame({
    map,
    rng: mulberry32(seed),
    units: [
      makeUnit({ id: "s1", side: "player", name: "Коваль", pos: place({ x: 2, y: 2 }), firingAccuracy: 0.7 }),
      makeUnit({ id: "s2", side: "player", name: "Тихий", pos: place({ x: 2, y: 3 }), firingAccuracy: 0.6 }),
      makeUnit({ id: "s3", side: "player", name: "Верба", pos: place({ x: 3, y: 2 }), firingAccuracy: 0.5 }),
      makeUnit({ id: "a1", side: "alien", name: "Скаут", pos: place({ x: 17, y: 2 }), firingAccuracy: 0.5, weapon: ALIEN_CUTTER }),
      makeUnit({ id: "a2", side: "alien", name: "Сірач", pos: place({ x: 17, y: 3 }), firingAccuracy: 0.45, weapon: ALIEN_CUTTER }),
      makeUnit({ id: "a3", side: "alien", name: "Тінь", pos: place({ x: 16, y: 2 }), firingAccuracy: 0.4, weapon: ALIEN_CUTTER }),
    ],
  });
}

function eventText(e: GameEvent, nameOf: (id: string) => string): string {
  switch (e.type) {
    case "move": return `${nameOf(e.unitId)}: (${e.from.x},${e.from.y}) → (${e.to.x},${e.to.y})`;
    case "shot": return e.hit
      ? `${nameOf(e.shooterId)} → ${nameOf(e.targetId)} (${e.mode}): влучив, −${e.damage} HP`
      : `${nameOf(e.shooterId)} → ${nameOf(e.targetId)} (${e.mode}): промах`;
    case "death": return `☠ ${nameOf(e.unitId)} загинув (постріл ${nameOf(e.killerId)})`;
    case "turn": return e.side === "player" ? `— Раунд ${e.turn}: хід Рубіжу` : `— Раунд ${e.turn}: хід прибульців`;
    case "overwatch": return `${nameOf(e.unitId)} стає у заступу`;
  }
}

const MODE_LABEL: Record<ShotMode, string> = {
  auto: "Авто ×3",
  snap: "Короткий",
  aimed: "Прицільний",
};

// ======== ВІДЖЕТ ========

export default function App() {
  const [seed, setSeed] = useState(42);
  const gameRef = useRef<GameState | null>(null);
  if (!gameRef.current) gameRef.current = newBattle(42);
  const [tick, force] = useReducer((x: number) => x + 1, 0);
  const [selectedId, setSelectedId] = useState<string | null>("s1");
  const [targetId, setTargetId] = useState<string | null>(null);
  const [hover, setHover] = useState<Vec2 | null>(null);
  const [error, setError] = useState<string | null>(null);
  const errTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const state = gameRef.current;
  const active = state.activeSide;
  const nameOf = (id: string) => state.units.find(u => u.id === id)?.name ?? id;

  const alivePlayers = state.units.filter(u => u.side === "player" && u.alive);
  const aliveAliens = state.units.filter(u => u.side === "alien" && u.alive);
  const winner: Side | null =
    aliveAliens.length === 0 ? "player" : alivePlayers.length === 0 ? "alien" : null;

  // Хід гравця — тільки тоді доступні дії; хід прибульців програє ШІ.
  const playerTurn = active === "player" && !winner;

  // Туман війни — ЗАВЖДИ з погляду гравця (ШІ ворога з'явився; hot-seat більше не потрібен).
  const vision = new Set<string>();
  for (const u of alivePlayers) {
    for (const kk of computeVisibleCells(state, u.pos)) vision.add(kk);
  }
  const seenEnemyIds = new Set(visibleEnemies(state, "player").map(u => u.id));

  const selected =
    playerTurn && selectedId
      ? state.units.find(u => u.id === selectedId && u.alive && u.side === "player") ?? null
      : null;
  const target =
    playerTurn && targetId
      ? state.units.find(u => u.id === targetId && u.alive && u.side === "alien" && seenEnemyIds.has(u.id)) ?? null
      : null;

  // Автопрогравання ходу прибульців: один крок ШІ за тік таймера.
  useEffect(() => {
    if (active !== "alien" || winner) return;
    const t = setTimeout(() => {
      if (gameRef.current !== state) return;
      if (!aiStep(state)) endTurn(state); // дій немає — хід гравцеві
      force();
    }, 700);
    return () => clearTimeout(t);
  }, [active, tick]);

  // Попередній перегляд шляху при наведенні (лише відображення; сам рух — у ядрі).
  let path: Vec2[] | null = null;
  let pathCost = 0;
  if (playerTurn && selected && hover && (hover.x !== selected.pos.x || hover.y !== selected.pos.y)) {
    path = findPath(state, selected.pos, hover);
    if (path) pathCost = pathApCost(path);
  }

  const showError = (msg: string) => {
    setError(msg);
    if (errTimer.current) clearTimeout(errTimer.current);
    errTimer.current = setTimeout(() => setError(null), 4500);
  };

  // Обгортка дій: помилки правил ядра — українським текстом користувачу.
  const act = (fn: () => void) => {
    try {
      fn();
      setError(null);
    } catch (e) {
      showError(e instanceof Error ? e.message : String(e));
    }
    force();
  };

  const clickCell = (pos: Vec2) => {
    if (!playerTurn) return;
    const u = state.units.find(u => u.alive && u.pos.x === pos.x && u.pos.y === pos.y);
    if (u) {
      if (u.side === "player") {
        setSelectedId(u.id);
        setTargetId(null);
      } else if (seenEnemyIds.has(u.id)) {
        setTargetId(u.id);
      }
      return;
    }
    if (selected && path && pathCost <= selected.ap) {
      const sid = selected.id;
      act(() => moveUnit(state, sid, path as Vec2[]));
      const mover = state.units.find(x => x.id === sid);
      if (!mover || !mover.alive) setSelectedId(null);
    } else if (selected && path) {
      showError("Недостатньо очок дій для цього шляху");
    }
  };

  const shoot = (mode: ShotMode) => {
    if (!selected || !target) return;
    const sid = selected.id, tid = target.id;
    act(() => {
      resolveAttack(state, sid, tid, mode);
      const t = state.units.find(x => x.id === tid);
      if (!t || !t.alive) setTargetId(null);
    });
  };

  const doOverwatch = () => {
    if (!selected) return;
    const sid = selected.id;
    act(() => setOverwatch(state, sid));
  };

  const doEndTurn = () => {
    act(() => endTurn(state));
    setTargetId(null);
  };

  const restart = (s: number) => {
    gameRef.current = newBattle(s);
    setSelectedId("s1");
    setTargetId(null);
    setHover(null);
    setError(null);
    force();
  };

  // Перевірка можливості пострілу — лише для відображення, не правила.
  const shotCheck = (mode: ShotMode): { ok: boolean; reason?: string } => {
    if (!selected || !target) return { ok: false, reason: "Оберіть видиму ціль" };
    const p = selected.weapon.modes[mode];
    if (selected.ap < p.apCost) return { ok: false, reason: `Недостатньо AP (${p.apCost})` };
    if (distance(selected.pos, target.pos) > selected.weapon.range) return { ok: false, reason: "Поза дальністю зброї" };
    if (!hasLineOfSight(state, selected.pos, target.pos)) return { ok: false, reason: "Немає лінії вогню" };
    return { ok: true };
  };

  const W = state.map.width, H = state.map.height;
  const pathAffordable = !!(selected && pathCost > 0 && pathCost <= selected.ap);
  const pathColor = pathAffordable ? "#38bdf8" : "#f87171";

  const cells: React.ReactNode[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const kk = x + "," + y;
      const vis = vision.has(kk);
      const blocked = state.map.blocked.has(kk);
      const fill = vis
        ? (blocked ? "#324359" : "#101a28")
        : (blocked ? "#0a1018" : "#04070d");
      cells.push(
        <rect
          key={kk}
          x={x} y={y} width={1} height={1}
          fill={fill}
          stroke="rgba(148,163,184,0.09)"
          strokeWidth={0.02}
          onMouseEnter={() => setHover({ x, y })}
          onClick={() => clickCell({ x, y })}
          className="cursor-pointer"
        />
      );
    }
  }

  return (
    <div className="min-h-screen bg-[#03060c] p-3 text-slate-200 lg:p-5">
      <header className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-bold tracking-[0.3em] text-cyan-300">РУБІЖ</h1>
        <span className="text-[11px] text-slate-500">тактичний бій · ітерація 3.6 · ШІ прибульців</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="rounded bg-slate-800 px-2 py-1 text-xs">Раунд {state.turn}</span>
          <span
            className={
              "rounded px-2 py-1 text-xs font-medium " +
              (playerTurn ? "bg-cyan-950 text-cyan-300" : "bg-rose-950 text-rose-300")
            }
          >
            {playerTurn ? "хід: Рубіж" : "хід: Прибульці (ШІ)"}
          </span>
          <input
            type="number"
            value={seed}
            onChange={e => setSeed(Number(e.target.value) || 0)}
            className="w-20 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs"
            title="Сія генератора (детермінізм)"
          />
          <button
            onClick={() => restart(seed)}
            className="rounded border border-cyan-800 bg-cyan-950/60 px-3 py-1 text-xs text-cyan-200 hover:bg-cyan-900/60"
          >
            Нова битва
          </button>
        </div>
      </header>

      {winner && (
        <div
          className={
            "mb-3 rounded border px-3 py-2 text-sm font-medium " +
            (winner === "player"
              ? "border-emerald-600/50 bg-emerald-950/40 text-emerald-300"
              : "border-rose-600/50 bg-rose-950/40 text-rose-300")
          }
        >
          {winner === "player" ? "Перемога Рубіжу — усі прибульці знищені." : "Загін втрачено. Рубіж зазнав поразки."}
        </div>
      )}

      {!winner && active === "alien" && (
        <div className="mb-3 rounded border border-rose-800/50 bg-rose-950/30 px-3 py-2 text-sm text-rose-300">
          <span className="animate-pulse">◉ Прибульці діють…</span>
          <span className="ml-2 text-[11px] text-rose-400/70">реакційний вогонь заступ може спрацювати на їхньому руху</span>
        </div>
      )}

      <div className="flex flex-col gap-4 lg:flex-row">
        {/* Поле бою */}
        <div className="min-w-0 flex-1">
          <div className="max-w-[700px] overflow-hidden rounded-lg border border-slate-800 bg-black/40">
            <svg
              viewBox={`0 0 ${W} ${H}`}
              className="block h-auto w-full select-none"
              onMouseLeave={() => setHover(null)}
            >
              {cells}

              {/* Попередній перегляд шляху + вартість AP */}
              {selected && path && path.length > 0 && (
                <>
                  <polyline
                    points={[
                      `${selected.pos.x + 0.5},${selected.pos.y + 0.5}`,
                      ...path.map(p => `${p.x + 0.5},${p.y + 0.5}`),
                    ].join(" ")}
                    fill="none"
                    stroke={pathColor}
                    strokeWidth={0.12}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={0.85}
                    pointerEvents="none"
                  />
                  <text
                    x={hover!.x + 0.5}
                    y={hover!.y + 0.35}
                    fontSize={0.55}
                    textAnchor="middle"
                    fill={pathColor}
                    pointerEvents="none"
                    fontWeight={600}
                  >
                    {pathCost} AP
                  </text>
                </>
              )}

              {/* Підсвітка клітинки під курсором */}
              {hover && (
                <rect
                  x={hover.x} y={hover.y} width={1} height={1}
                  fill="none" stroke="#94a3b8" strokeWidth={0.05}
                  pointerEvents="none"
                />
              )}

              {/* Свої видно завжди; прибульців — лише в зоні огляду гравця */}
              {state.units.filter(u => u.alive && (u.side === "player" || seenEnemyIds.has(u.id))).map(u => {
                const isSel = selected?.id === u.id;
                const isTgt = target?.id === u.id;
                const hpw = 0.84 * (u.hp / u.maxHp);
                return (
                  <g
                    key={u.id}
                    transform={`translate(${u.pos.x + 0.5},${u.pos.y + 0.5})`}
                    style={{ transition: "transform 0.18s ease-out" }}
                    onClick={() => clickCell(u.pos)}
                    onMouseEnter={() => setHover({ ...u.pos })}
                    className="cursor-pointer"
                  >
                    {isSel && (
                      <circle r={0.48} fill="none" stroke="#e2e8f0" strokeWidth={0.06} strokeDasharray="0.14 0.09" />
                    )}
                    {isTgt && (
                      <circle r={0.55} fill="none" stroke="#fbbf24" strokeWidth={0.07} strokeDasharray="0.22 0.12" />
                    )}
                    {u.side === "player" ? (
                      <circle r={0.33} fill="#22d3ee" stroke="#0e7490" strokeWidth={0.05} />
                    ) : (
                      <rect x={-0.3} y={-0.3} width={0.6} height={0.6} fill="#fb7185" stroke="#7f1d1d" strokeWidth={0.05} transform="rotate(45)" />
                    )}
                    {u.overwatch && (
                      <circle cx={0.3} cy={-0.28} r={0.11} fill="#fbbf24" />
                    )}
                    <rect x={-0.42} y={-0.62} width={0.84} height={0.11} fill="#1e293b" />
                    <rect x={-0.42} y={-0.62} width={hpw} height={0.11} fill={u.side === "player" ? "#4ade80" : "#fb7185"} />
                    <text y={0.78} fontSize={0.32} textAnchor="middle" fill="#cbd5e1" pointerEvents="none">
                      {u.name}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          <p className="mt-2 max-w-[700px] text-[11px] leading-5 text-slate-500">
            Клік по своєму юніту — обрати; наведіть на клітинку — попередній перегляд шляху та його вартість у AP;
            клік по клітинці — рух; клік по видимому ворогу — обрати ціль. Хід прибульців програє простий ШІ
            (жадібно: рух до найближчого видимого ворога + постріл). Туман війни — з погляду гравця.
            Один сід — детермінований бій.
          </p>
          {error && (
            <div className="mt-2 max-w-[700px] rounded border border-rose-800/60 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">
              {error}
            </div>
          )}
        </div>

        {/* Панель дій — загін гравця завжди */}
        <aside className="flex w-full shrink-0 flex-col gap-3 lg:w-80">
          <div className="rounded border border-slate-800 bg-slate-900/60 p-2">
            <div className="mb-1.5 text-[11px] uppercase tracking-wider text-slate-500">
              Загін (Рубіж)
            </div>
            <div className="flex flex-col gap-1.5">
              {alivePlayers.map(u => (
                <button
                  key={u.id}
                  onClick={() => { if (playerTurn) { setSelectedId(u.id); setTargetId(null); } }}
                  className={
                    "rounded border px-2 py-1.5 text-left text-sm " +
                    (u.id === selectedId && playerTurn
                      ? "border-cyan-500/60 bg-cyan-950/40"
                      : "border-slate-800 bg-slate-950/50 hover:border-slate-600")
                  }
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">
                      {u.name}
                      {u.overwatch && <span className="ml-1 text-amber-400" title="у заступі">◉</span>}
                    </span>
                    <span className="text-xs text-slate-400">HP {u.hp}/{u.maxHp}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <div className="h-1 flex-1 rounded bg-slate-800">
                      <div className="h-1 rounded bg-emerald-400" style={{ width: `${(100 * u.hp) / u.maxHp}%` }} />
                    </div>
                    <span className="w-14 text-right text-[10px] text-sky-300">AP {u.ap}/{u.maxAp}</span>
                  </div>
                </button>
              ))}
              {alivePlayers.length === 0 && (
                <div className="px-1 py-2 text-sm text-slate-500">Живих юнітів немає.</div>
              )}
            </div>
          </div>

          {playerTurn && selected && (
            <div className="rounded border border-slate-800 bg-slate-900/60 p-3">
              <div className="text-sm font-semibold">{selected.name}</div>
              <div className="text-[11px] text-slate-400">
                {selected.weapon.name} · пошкодження {selected.weapon.damage[0]}–{selected.weapon.damage[1]} ·
                дальність {selected.weapon.range}
              </div>

              {target && (
                <div className="mt-2 rounded bg-slate-950/60 px-2 py-1.5 text-[11px] text-slate-300">
                  Ціль: <span className="text-rose-300">{target.name}</span> · HP {target.hp}/{target.maxHp} ·
                  дальність {distance(selected.pos, target.pos)} ·{" "}
                  {hasLineOfSight(state, selected.pos, target.pos) ? "лінія вогню ✓" : "лінія вогню ✗"}
                </div>
              )}

              <div className="mt-2 grid grid-cols-3 gap-1.5">
                {(["auto", "snap", "aimed"] as ShotMode[]).map(mode => {
                  const p = selected.weapon.modes[mode];
                  const chk = shotCheck(mode);
                  const chance = Math.round(calculateHitChance(selected, mode) * 100);
                  return (
                    <button
                      key={mode}
                      disabled={!chk.ok}
                      title={chk.reason ?? `${p.shots} постріл(и), ${chance}% на влучність`}
                      onClick={() => shoot(mode)}
                      className={
                        "rounded border px-1 py-1.5 text-center text-[11px] leading-tight " +
                        (chk.ok
                          ? "border-cyan-700 bg-cyan-950/50 text-cyan-200 hover:bg-cyan-900/60"
                          : "border-slate-800 bg-slate-950/40 text-slate-600")
                      }
                    >
                      <div className="font-medium">{MODE_LABEL[mode]}</div>
                      <div>{p.apCost} AP · {chance}%</div>
                    </button>
                  );
                })}
              </div>

              <div className="mt-2 flex gap-1.5">
                <button
                  disabled={selected.overwatch || selected.ap < OVERWATCH_AP_COST}
                  title={
                    selected.overwatch
                      ? "Уже у заступі"
                      : selected.ap < OVERWATCH_AP_COST
                        ? `Недостатньо AP (${OVERWATCH_AP_COST})`
                        : "Реакційний вогонь під час ходу ворога"
                  }
                  onClick={doOverwatch}
                  className={
                    "flex-1 rounded border px-2 py-1.5 text-xs " +
                    (!selected.overwatch && selected.ap >= OVERWATCH_AP_COST
                      ? "border-amber-700/70 bg-amber-950/40 text-amber-200 hover:bg-amber-900/40"
                      : "border-slate-800 bg-slate-950/40 text-slate-600")
                  }
                >
                  ◉ Заступа ({OVERWATCH_AP_COST} AP)
                </button>
                <button
                  onClick={doEndTurn}
                  className="flex-1 rounded border border-slate-700 bg-slate-800/60 px-2 py-1.5 text-xs text-slate-200 hover:bg-slate-700/60"
                >
                  Кінець ходу
                </button>
              </div>
            </div>
          )}

          <div className="rounded border border-slate-800 bg-slate-950/70 p-2">
            <div className="mb-1 text-[11px] uppercase tracking-wider text-slate-500">Журнал подій</div>
            <div className="max-h-64 space-y-0.5 overflow-y-auto font-mono text-[11px] leading-5">
              {state.log.slice(-60).reverse().map((e, i) => (
                <div
                  key={i}
                  className={
                    e.type === "death" ? "text-rose-400"
                      : e.type === "turn" ? "text-slate-500 italic"
                        : e.type === "overwatch" ? "text-amber-300"
                          : e.type === "shot" ? "text-slate-300"
                            : "text-slate-400"
                  }
                >
                  {eventText(e, nameOf)}
                </div>
              ))}
              {state.log.length === 0 && <div className="text-slate-600">Бій ще не почався.</div>}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
