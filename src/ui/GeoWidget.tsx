
import React, { useEffect, useReducer, useRef, useState } from "react";

// ============================================================
// Рубіж — віджет геосцени з місіями (ітерація 5.1 = 4.2 + місії)
// Ядра src/core (geo/combat/map/ai/mission) вбудовані нижче БЕЗ ЗМІН логіки.
// Нове тут — лише відображення + виклики ядра:
// - «▶ Запустити місію» з приземленого виявленого НЛО (createMission);
// - модальний тактичний бій (UI бою 3.6 поверх mission.state);
// - час геосцени заморожено, поки триває бій (кнопки часу неактивні);
// - після бою completeMission → результат у журнал і на мапу світу:
//   перемога = НЛО зачищено, поразка = НЛО лишається, загін втрачено.
// Детермінізм: сід місії = FNV-1a(ufoId + ':' + geo.minute), geo.rng не
// витягається — гео-траєкторія не залежить від запуску місії.
// ============================================================

// ======== ЯДРО: src/core/geo.ts (копія, без змін) ========

type RNG = () => number; // [0, 1)
interface Vec2 { x: number; y: number }

const TICK_MINUTES = 30;
const WORLD_W = 16;
const WORLD_H = 8;
const RADAR_RANGE = 4;
const DEFAULT_SPAWN_CHANCE = 0.03;
const DEFAULT_MAX_UFOS = 3;

type UfoKind = "розвідник" | "збирач";

interface KindProfile { moveEveryTicks: number; landingTicks: number }

const UFO_KINDS: Record<UfoKind, KindProfile> = {
  "розвідник": { moveEveryTicks: 1, landingTicks: 8 },
  "збирач": { moveEveryTicks: 2, landingTicks: 16 },
};

type UfoStatus = "летить" | "приземлився";

interface Ufo {
  id: string;
  kind: UfoKind;
  pos: Vec2;
  target: Vec2;
  detected: boolean;
  status: UfoStatus;
  landedTicksLeft: number;
}

type GeoEvent =
  | { type: "ufo_spawned"; ufoId: string; kind: UfoKind; pos: Vec2; minute: number }
  | { type: "ufo_move"; ufoId: string; from: Vec2; to: Vec2; minute: number }
  | { type: "ufo_detected"; ufoId: string; pos: Vec2; minute: number }
  | { type: "ufo_landed"; ufoId: string; pos: Vec2; minute: number }
  | { type: "ufo_left"; ufoId: string; minute: number }
  | { type: "day"; day: number; minute: number }
  // Ітерація 5.0 (записує модуль mission.ts):
  | { type: "mission_won"; ufoId: string; minute: number }
  | { type: "mission_lost"; ufoId: string; minute: number };

interface GeoState {
  minute: number;
  rng: RNG;
  base: Vec2;
  ufos: Ufo[];
  log: GeoEvent[];
  spawnChance: number;
  maxUfos: number;
  nextId: number;
}

interface GeoOptions {
  seed?: number;
  rng?: RNG;
  base?: Vec2;
  spawnChance?: number;
  maxUfos?: number;
}

function mulberry32(seed: number): RNG {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createGeoGame(opts: GeoOptions = {}): GeoState {
  const base = opts.base ?? { x: Math.floor(WORLD_W / 2), y: Math.floor(WORLD_H / 2) };
  if (base.x < 0 || base.y < 0 || base.x >= WORLD_W || base.y >= WORLD_H) {
    throw new Error("База за межами мапи світу");
  }
  return {
    minute: 0,
    rng: opts.rng ?? mulberry32(opts.seed ?? 42),
    base: { ...base },
    ufos: [],
    log: [],
    spawnChance: opts.spawnChance ?? DEFAULT_SPAWN_CHANCE,
    maxUfos: opts.maxUfos ?? DEFAULT_MAX_UFOS,
    nextId: 1,
  };
}

function geoDay(state: GeoState): number {
  return Math.floor(state.minute / 1440) + 1;
}

function geoClock(state: GeoState): string {
  const m = state.minute % 1440;
  const h = Math.floor(m / 60), mm = m % 60;
  return "Д" + geoDay(state) + " " + String(h).padStart(2, "0") + ":" + String(mm).padStart(2, "0");
}

function chebyshevWrap(a: Vec2, b: Vec2): number {
  const dx = Math.abs(a.x - b.x);
  const dxw = Math.min(dx, WORLD_W - dx);
  return Math.max(dxw, Math.abs(a.y - b.y));
}

function randomCell(rng: RNG): Vec2 {
  return { x: Math.floor(rng() * WORLD_W), y: Math.floor(rng() * WORLD_H) };
}

function stepToward(pos: Vec2, target: Vec2): Vec2 {
  let dx = target.x - pos.x;
  if (dx > WORLD_W / 2) dx -= WORLD_W;
  if (dx < -WORLD_W / 2) dx += WORLD_W;
  const dy = target.y - pos.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return { x: (pos.x + Math.sign(dx) + WORLD_W) % WORLD_W, y: pos.y };
  }
  return { x: pos.x, y: pos.y + Math.sign(dy) };
}

function geoTick(state: GeoState): void {
  state.minute += TICK_MINUTES;
  if (state.minute % 1440 === 0) {
    state.log.push({ type: "day", day: geoDay(state), minute: state.minute });
  }
  if (state.ufos.length < state.maxUfos && state.rng() < state.spawnChance) {
    const kind: UfoKind = state.rng() < 0.7 ? "розвідник" : "збирач";
    const pos = randomCell(state.rng);
    const ufo: Ufo = {
      id: "ufo" + state.nextId++, kind, pos,
      target: randomCell(state.rng), detected: false,
      status: "летить", landedTicksLeft: UFO_KINDS[kind].landingTicks,
    };
    state.ufos.push(ufo);
    state.log.push({ type: "ufo_spawned", ufoId: ufo.id, kind, pos: { ...pos }, minute: state.minute });
  }
  for (const ufo of [...state.ufos]) {
    if (ufo.status === "летить") {
      const prof = UFO_KINDS[ufo.kind];
      if ((state.minute / TICK_MINUTES) % prof.moveEveryTicks !== 0) continue;
      if (ufo.pos.x === ufo.target.x && ufo.pos.y === ufo.target.y) {
        ufo.status = "приземлився";
        state.log.push({ type: "ufo_landed", ufoId: ufo.id, pos: { ...ufo.pos }, minute: state.minute });
        continue;
      }
      const from = { ...ufo.pos };
      ufo.pos = stepToward(ufo.pos, ufo.target);
      state.log.push({ type: "ufo_move", ufoId: ufo.id, from, to: { ...ufo.pos }, minute: state.minute });
      if (ufo.pos.x === ufo.target.x && ufo.pos.y === ufo.target.y) {
        ufo.status = "приземлився";
        state.log.push({ type: "ufo_landed", ufoId: ufo.id, pos: { ...ufo.pos }, minute: state.minute });
      }
    } else {
      ufo.landedTicksLeft -= 1;
      if (ufo.landedTicksLeft <= 0) {
        state.ufos = state.ufos.filter(u => u !== ufo);
        state.log.push({ type: "ufo_left", ufoId: ufo.id, minute: state.minute });
      }
    }
  }
  for (const ufo of state.ufos) {
    if (!ufo.detected && chebyshevWrap(state.base, ufo.pos) <= RADAR_RANGE) {
      ufo.detected = true;
      state.log.push({ type: "ufo_detected", ufoId: ufo.id, pos: { ...ufo.pos }, minute: state.minute });
    }
  }
}

function advanceTime(state: GeoState, ticks: number): void {
  if (!Number.isInteger(ticks) || ticks < 0) {
    throw new Error("Кількість тіків має бути невід'ємним цілим");
  }
  for (let i = 0; i < ticks; i++) geoTick(state);
}

function detectedUfos(state: GeoState): Ufo[] {
  return state.ufos.filter(u => u.detected);
}

function missionTargets(state: GeoState): Ufo[] {
  return state.ufos.filter(u => u.detected && u.status === "приземлився");
}

// ======== ЯДРО: src/core/combat.ts (копія, без змін) — тактичний бій ========

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

function hasLineOfSight(state: GameState, from: Vec2, to: Vec2): boolean {
  const line = bresenham(from, to);
  for (let i = 1; i < line.length - 1; i++) {
    if (isBlocked(state.map, line[i])) return false;
  }
  return true;
}

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
  for (const u of state.units) if (u.side === next && u.alive) { u.ap = u.maxAp; u.overwatch = false; }
  state.log.push({ type: "turn", turn: state.turn, side: next });
}

function setOverwatch(state: GameState, unitId: string): void {
  const u = getUnit(state, unitId);
  requireActive(state, u);
  if (u.overwatch) return;
  if (u.ap < OVERWATCH_AP_COST) throw new Error("Недостатньо очок дій для заступи");
  u.ap -= OVERWATCH_AP_COST;
  u.overwatch = true;
  state.log.push({ type: "overwatch", unitId: u.id, armed: true });
}

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
    if (!u.alive) break;
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
    w.overwatch = false;
    fireReaction(state, w, mover);
    if (!mover.alive) return;
  }
}

function resolveAttack(state: GameState, shooterId: string, targetId: string, mode: ShotMode) {
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
  for (let i = 0; i < profile.shots; i++) {
    const hit = state.rng() < chance;
    let damage = 0;
    if (hit) {
      const dmin = s.weapon.damage[0], dmax = s.weapon.damage[1];
      damage = dmin + Math.floor(state.rng() * (dmax - dmin + 1));
      t.hp -= damage;
      if (t.hp <= 0) {
        t.hp = 0; t.alive = false; s.kills += 1;
        state.log.push({ type: "death", unitId: t.id, killerId: s.id });
      }
    }
    state.log.push({ type: "shot", shooterId: s.id, targetId: t.id, mode, hit, damage });
    if (!t.alive) break;
  }
}

// ======== ЯДРО: src/core/map.ts (копія, без змін) — A*, туман, мапи ========

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

// ======== ЯДРО: src/core/ai.ts (копія, 5.1.5: patrol-режим ШІ місії) — жадібні ШІ-вороги ========

const MODE_PRIORITY: ShotMode[] = ["auto", "aimed", "snap"];

function bestShootMode(state: GameState, u: Unit, target: Unit): ShotMode | null {
  if (distance(u.pos, target.pos) > u.weapon.range) return null;
  if (!hasLineOfSight(state, u.pos, target.pos)) return null;
  for (const mode of MODE_PRIORITY) {
    if (u.ap >= u.weapon.modes[mode].apCost) return mode;
  }
  return null;
}

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

// 5.1.5 patrolStep: якщо цілей не видно — рух до зони висадки загону.
// Цілі шляху — СУСІДИ patrol-клітинок: самі клітини зони висадки зайняті
// юнітами гравця, і findPath у зайняту клітину шляху не дає (v1 через це
// завжди завершувалась заступою — зовні це виглядало як «ШІ не реагує»).
// Резерв OVERWATCH_AP_COST — після прибуття прибульець одразу заступає.
function patrolStep(state: GameState, u: Unit, patrol: Vec2[]): Vec2[] | null {
  const goals: Vec2[] = [];
  for (const p of patrol) {
    goals.push({ x: p.x + 1, y: p.y }, { x: p.x - 1, y: p.y }, { x: p.x, y: p.y + 1 }, { x: p.x, y: p.y - 1 });
  }
  const budget = u.ap - OVERWATCH_AP_COST;
  if (budget <= 0) return null;
  let best: Vec2[] | null = null;
  for (const g of goals) {
    const p = findPath(state, u.pos, g);
    if (p && p.length > 0 && (best === null || p.length < best.length)) best = p;
  }
  if (!best) return null;
  return best.slice(0, budget);
}

// Один крок ШІ. 5.1.5: опційний patrol (зона висадки гравця) — цілей
// не видно → рух до зони (patrolStep) замість пасивної заступи; після
// контакту — бій за 3.5. Без patrol — поведінка 3.5 без змін.
function aiStep(state: GameState, patrol?: Vec2[]): boolean {
  if (state.activeSide !== "alien") return false;
  const enemies = visibleEnemies(state, "alien");
  for (const u of state.units) {
    if (!u.alive || u.side === "alien" || u.ap <= 0) continue;

    if (enemies.length === 0) {
      if (patrol) {
        const step = patrolStep(state, u, patrol);
        if (step) {
          moveUnit(state, u.id, step);
          return true;
        }
      }
      if (!u.overwatch && u.ap >= OVERWATCH_AP_COST) {
        setOverwatch(state, u.id);
        return true;
      }
      continue;
    }

    const target = enemies.reduce((best, e) => distance(u.pos, e.pos) < distance(u.pos, best.pos) ? e : best);

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

    if (!u.overwatch && u.ap >= OVERWATCH_AP_COST) {
      setOverwatch(state, u.id);
      return true;
    }
  }
  return false;
}

// ======== ЯДРО: src/core/mission.ts (копія, без змін) — зв'язок шарів (5.0) ========

const MISSION_MAP_W = 20;
const MISSION_MAP_H = 20;
const SQUAD_SPAWN: Vec2[] = [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 2, y: 3 }];
const ALIEN_SPAWN: Vec2[] = [{ x: 17, y: 2 }, { x: 16, y: 2 }, { x: 17, y: 3 }];

const ALIENS_PER_KIND: Record<UfoKind, number> = { "розвідник": 2, "збирач": 3 };
const ALIEN_ACCURACY = [0.5, 0.45, 0.4];

function missionSeed(geo: GeoState, ufoId: string): number {
  let h = 0x811c9dc5;
  const s = ufoId + ":" + geo.minute;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function reachable(map: GameMap, from: Vec2, targets: Vec2[]): boolean {
  const seen = new Set<string>([from.x + "," + from.y]);
  const queue: Vec2[] = [from];
  while (queue.length > 0) {
    const p = queue.shift()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const n = { x: p.x + dx, y: p.y + dy };
      const k2 = n.x + "," + n.y;
      if (!isInside(map, n) || map.blocked.has(k2) || seen.has(k2)) continue;
      seen.add(k2);
      queue.push(n);
    }
  }
  return targets.every(t => seen.has(t.x + "," + t.y));
}

const MAP_SEED_ATTEMPTS = 50;

function missionMap(seed: number): GameMap {
  for (let i = 0; i < MAP_SEED_ATTEMPTS; i++) {
    const map = makeTestMap(seed + i, MISSION_MAP_W, MISSION_MAP_H);
    if (reachable(map, SQUAD_SPAWN[0], [...SQUAD_SPAWN.slice(1), ...ALIEN_SPAWN])) return map;
  }
  throw new Error("Не вдалося згенерувати зв'язне бойовище для місії");
}

function makeSoldier(id: string, name: string): Unit {
  return makeUnit({ id, side: "player", name, pos: { x: 0, y: 0 }, firingAccuracy: 0.6, weapon: RIFLE });
}

interface MissionBriefing {
  ufoId: string;
  kind: UfoKind;
  aliens: number;
  minute: number;
}

interface Mission {
  briefing: MissionBriefing;
  state: GameState;
}

function findTarget(geo: GeoState, ufoId: string): Ufo {
  const ufo = missionTargets(geo).find(u => u.id === ufoId);
  if (!ufo) throw new Error("Місію можна запустити лише з приземленого виявленого НЛО: " + ufoId);
  return ufo;
}

function createMission(geo: GeoState, ufoId: string): Mission {
  const ufo = findTarget(geo, ufoId);
  const seed = missionSeed(geo, ufoId);
  const map = missionMap(seed);
  const rng = mulberry32(seed);

  const squad = [makeSoldier("s1", "Іван"), makeSoldier("s2", "Олена"), makeSoldier("s3", "Тарас")];
  squad.forEach((u, i) => { u.pos = { ...SQUAD_SPAWN[i] }; });

  const n = ALIENS_PER_KIND[ufo.kind];
  const aliens: Unit[] = [];
  for (let i = 0; i < n; i++) {
    aliens.push(makeUnit({
      id: "a" + (i + 1), side: "alien",
      name: "Прибулець " + (i + 1),
      pos: { ...ALIEN_SPAWN[i] },
      firingAccuracy: ALIEN_ACCURACY[i % ALIEN_ACCURACY.length],
      weapon: ALIEN_CUTTER,
    }));
  }

  const state = createGame({ map, units: [...squad, ...aliens], rng });
  return { briefing: { ufoId: ufo.id, kind: ufo.kind, aliens: n, minute: geo.minute }, state };
}

type MissionOutcome = "триває" | "перемога" | "поразка";

function missionOutcome(state: GameState): MissionOutcome {
  const aliveAliens = state.units.filter(u => u.side === "alien" && u.alive).length;
  if (aliveAliens === 0) return "перемога";
  const aliveSquad = state.units.filter(u => u.side === "player" && u.alive).length;
  if (aliveSquad === 0) return "поразка";
  return "триває";
}

function completeMission(geo: GeoState, ufoId: string, outcome: "перемога" | "поразка"): void {
  const ufo = geo.ufos.find(u => u.id === ufoId);
  if (!ufo) throw new Error("Невідомий НЛО: " + ufoId);
  if (outcome === "перемога") {
    geo.ufos = geo.ufos.filter(u => u.id !== ufoId);
    geo.log.push({ type: "mission_won", ufoId, minute: geo.minute });
  } else {
    geo.log.push({ type: "mission_lost", ufoId, minute: geo.minute });
  }
}

// ======== ДОПОМІЖНЕ ДЛЯ ВІДЖЕТА (лише відображення, без правил) ========

// Зона покриття радара: клітинки в межах RADAR_RANGE із замиканням по X.
function radarCoverage(base: Vec2): Set<string> {
  const cells = new Set<string>();
  for (let dx = -RADAR_RANGE; dx <= RADAR_RANGE; dx++) {
    for (let dy = -RADAR_RANGE; dy <= RADAR_RANGE; dy++) {
      const y = base.y + dy;
      if (y < 0 || y >= WORLD_H) continue;
      const x = (base.x + dx + WORLD_W) % WORLD_W;
      cells.add(x + "," + y);
    }
  }
  return cells;
}

// Мітка часу події: "Д1 06:30".
function clockOf(minute: number): string {
  const d = Math.floor(minute / 1440) + 1;
  const m = minute % 1440;
  return "Д" + d + " " + String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
}

// Події геосцени, видимі гравцеві (туман стратегічного шару).
// Правило видимості: подія НЛО показується, лише якщо цей НЛО уже виявлено
// радаром на момент події (трекінг: виявлений НЛО лишається на звіті до відльоту).
// Спавн і рух — внутрішня кухня, у звіті не показуються.
// 5.1: нові гілки mission_won / mission_lost — результат власних дій гравця,
// тому показуються завжди (без перевірки трекінгу виявлення).
function visibleEvents(state: GeoState): { e: GeoEvent; text: string }[] {
  const detected = new Set<string>();
  const out: { e: GeoEvent; text: string }[] = [];
  for (const e of state.log) {
    if (e.type === "ufo_detected") {
      detected.add(e.ufoId);
      out.push({ e, text: `${e.ufoId} виявлено радаром (${e.pos.x},${e.pos.y})` });
    } else if (e.type === "ufo_landed" && detected.has(e.ufoId)) {
      out.push({ e, text: `${e.ufoId} приземлився (${e.pos.x},${e.pos.y})` });
    } else if (e.type === "ufo_left" && detected.has(e.ufoId)) {
      out.push({ e, text: `${e.ufoId} відлетів — зникнув зі сканерів` });
    } else if (e.type === "mission_won") {
      out.push({ e, text: `Місія проти ${e.ufoId}: ЗАЧИЩЕНО ✓` });
    } else if (e.type === "mission_lost") {
      out.push({ e, text: `Місія проти ${e.ufoId}: загін втрачено ✗` });
    } else if (e.type === "day") {
      out.push({ e, text: `День ${e.day}` });
    }
  }
  return out;
}

// Текст бойової події (для журналу бою в модалі місії).
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

// ============================================================
// МОДАЛЬНИЙ БІЙ МІСІЇ (UI бою з ітерації 3.6 поверх mission.state)
// ============================================================

function MissionBattle({ mission, onReturn }: { mission: Mission; onReturn: (outcome: "перемога" | "поразка") => void }) {
  const [tick, force] = useReducer((x: number) => x + 1, 0);
  const [selectedId, setSelectedId] = useState<string | null>("s1");
  const [targetId, setTargetId] = useState<string | null>(null);
  const [hover, setHover] = useState<Vec2 | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aiStepN, setAiStepN] = useState(0); // кількість дій ШІ в останньому ході прибульців
  const errTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const state = mission.state;
  const active = state.activeSide;
  const nameOf = (id: string) => state.units.find(u => u.id === id)?.name ?? id;

  const alivePlayers = state.units.filter(u => u.side === "player" && u.alive);
  const outcome = missionOutcome(state);
  const finished = outcome !== "триває";

  const playerTurn = active === "player" && !finished;

  // Туман війни — з погляду гравця.
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

  // Автопрогравання ходу прибульців — план Б (збірка 5.1.4): без таймерів.
  // Таймери в React-ефектах у рендері канваса не спрацьовували (зависання на
  // «крок ШІ: 0»), тож хід прибульців відпрацьовуємо синхронно одним кліком
  // «Кінець ходу»: цикл aiStep до завершення, потім endTurn. Усі дії ШІ одразу
  // видно на мапі і в журналі; виняток ШІ → банер «Помилка ШІ», хід повертається
  // гравцеві (зависання неможливе). Перемога/поразка переривають цикл (фінальний банер).
  const playAiTurn = (): number => {
    let actions = 0;
    let guard = 0;
    while (guard++ < 60 && state.activeSide === "alien" && missionOutcome(state) === "триває") {
      let acted: boolean;
      try {
        // 5.1.5: patrol = SQUAD_SPAWN — без видимих цілей прибульці наступають.
        acted = aiStep(state, SQUAD_SPAWN);
      } catch (e) {
        setError("Помилка ШІ: " + (e instanceof Error ? e.message : String(e)));
        endTurn(state);
        return actions;
      }
      if (!acted) break;
      actions++;
    }
    if (state.activeSide === "alien" && missionOutcome(state) === "триває") endTurn(state);
    return actions;
  };

  // Попередній перегляд шляху при наведенні.
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
      const fill = vis ? (blocked ? "#324359" : "#101a28") : (blocked ? "#0a1018" : "#04070d");
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

  const squadTotal = state.units.filter(u => u.side === "player").length;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[#03060c]/95 p-3 lg:p-5">
      <div className="mx-auto max-w-6xl">
        <header className="mb-3 flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-bold tracking-[0.2em] text-amber-300">МІСІЯ: {mission.briefing.ufoId}</h2>
          <span className="text-[11px] text-slate-500">
            НЛО «{mission.briefing.kind}» · прибульців: {mission.briefing.aliens} · старт {clockOf(mission.briefing.minute)}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <span className="rounded bg-slate-800 px-2 py-1 text-xs">Раунд {state.turn}</span>
            <span className={"rounded px-2 py-1 text-xs font-medium " + (playerTurn ? "bg-cyan-950 text-cyan-300" : finished ? "bg-slate-800 text-slate-300" : "bg-rose-950 text-rose-300")}>
              {finished ? "бій завершено" : playerTurn ? "хід: Рубіж" : "хід: Прибульці (ШІ)"}
            </span>
          </div>
        </header>

        {finished && (
          <div className={"mb-3 rounded border px-3 py-2 text-sm font-medium " + (outcome === "перемога" ? "border-emerald-600/50 bg-emerald-950/40 text-emerald-300" : "border-rose-600/50 bg-rose-950/40 text-rose-300")}>
            {outcome === "перемога"
              ? "Перемога — усі прибульці знищені. НЛО буде зачищено з геосцени."
              : `Загін втрачено (${squadTotal} солдат). НЛО лишається — вікно перехоплення триває.`}
            <button
              onClick={() => onReturn(outcome as "перемога" | "поразка")}
              className="ml-3 rounded border border-cyan-700 bg-cyan-950/60 px-3 py-1 text-xs text-cyan-200 hover:bg-cyan-900/60"
            >
              Завершити місію → на геосцену
            </button>
          </div>
        )}

        {!finished && active === "player" && aiStepN > 0 && (
          <div className="mb-3 rounded border border-slate-700/60 bg-slate-900/50 px-3 py-2 text-sm text-slate-300">
            Хід прибульців відпрацьовано ({aiStepN} дій) — деталі в журналі бою.
          </div>
        )}

        <div className="flex flex-col gap-4 lg:flex-row">
          <div className="min-w-0 flex-1">
            <div className="max-w-[700px] overflow-hidden rounded-lg border border-slate-800 bg-black/40">
              <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full select-none" onMouseLeave={() => setHover(null)}>
                {cells}
                {selected && path && path.length > 0 && (
                  <>
                    <polyline
                      points={[`${selected.pos.x + 0.5},${selected.pos.y + 0.5}`, ...path.map(p => `${p.x + 0.5},${p.y + 0.5}`)].join(" ")}
                      fill="none" stroke={pathColor} strokeWidth={0.12}
                      strokeLinecap="round" strokeLinejoin="round" opacity={0.85} pointerEvents="none"
                    />
                    <text x={hover!.x + 0.5} y={hover!.y + 0.35} fontSize={0.55} textAnchor="middle" fill={pathColor} pointerEvents="none" fontWeight={600}>
                      {pathCost} AP
                    </text>
                  </>
                )}
                {hover && (
                  <rect x={hover.x} y={hover.y} width={1} height={1} fill="none" stroke="#94a3b8" strokeWidth={0.05} pointerEvents="none" />
                )}
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
                      {isSel && <circle r={0.48} fill="none" stroke="#e2e8f0" strokeWidth={0.06} strokeDasharray="0.14 0.09" />}
                      {isTgt && <circle r={0.55} fill="none" stroke="#fbbf24" strokeWidth={0.07} strokeDasharray="0.22 0.12" />}
                      {u.side === "player"
                        ? <circle r={0.33} fill="#22d3ee" stroke="#0e7490" strokeWidth={0.05} />
                        : <rect x={-0.3} y={-0.3} width={0.6} height={0.6} fill="#fb7185" stroke="#7f1d1d" strokeWidth={0.05} transform="rotate(45)" />}
                      {u.overwatch && <circle cx={0.3} cy={-0.28} r={0.11} fill="#fbbf24" />}
                      <rect x={-0.42} y={-0.62} width={0.84} height={0.11} fill="#1e293b" />
                      <rect x={-0.42} y={-0.62} width={hpw} height={0.11} fill={u.side === "player" ? "#4ade80" : "#fb7185"} />
                      <text y={0.78} fontSize={0.32} textAnchor="middle" fill="#cbd5e1" pointerEvents="none">{u.name}</text>
                    </g>
                  );
                })}
              </svg>
            </div>
            <p className="mt-2 max-w-[700px] text-[11px] leading-5 text-slate-500">
              Клік по своєму юніту — обрати; наведення — шлях і його вартість у AP; клік по клітинці — рух;
              клік по видимому ворогу — ціль. Час геосцени заморожено, поки триває місія.
            </p>
            {error && (
              <div className="mt-2 max-w-[700px] rounded border border-rose-800/60 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">{error}</div>
            )}
          </div>

          <aside className="flex w-full shrink-0 flex-col gap-3 lg:w-80">
            <div className="rounded border border-slate-800 bg-slate-900/60 p-2">
              <div className="mb-1.5 text-[11px] uppercase tracking-wider text-slate-500">Загін (Рубіж)</div>
              <div className="flex flex-col gap-1.5">
                {alivePlayers.map(u => (
                  <button
                    key={u.id}
                    onClick={() => { if (playerTurn) { setSelectedId(u.id); setTargetId(null); } }}
                    className={"rounded border px-2 py-1.5 text-left text-sm " + (u.id === selectedId && playerTurn ? "border-cyan-500/60 bg-cyan-950/40" : "border-slate-800 bg-slate-950/50 hover:border-slate-600")}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{u.name}{u.overwatch && <span className="ml-1 text-amber-400">◉</span>}</span>
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
                {alivePlayers.length === 0 && <div className="px-1 py-2 text-sm text-slate-500">Живих солдатів немає.</div>}
              </div>
            </div>

            {playerTurn && selected && (
              <div className="rounded border border-slate-800 bg-slate-900/60 p-3">
                <div className="text-sm font-semibold">{selected.name}</div>
                <div className="text-[11px] text-slate-400">
                  {selected.weapon.name} · пошкодження {selected.weapon.damage[0]}–{selected.weapon.damage[1]} · дальність {selected.weapon.range}
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
                        className={"rounded border px-1 py-1.5 text-center text-[11px] leading-tight " + (chk.ok ? "border-cyan-700 bg-cyan-950/50 text-cyan-200 hover:bg-cyan-900/60" : "border-slate-800 bg-slate-950/40 text-slate-600")}
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
                    title={selected.overwatch ? "Уже у заступі" : selected.ap < OVERWATCH_AP_COST ? `Недостатньо AP (${OVERWATCH_AP_COST})` : "Реакційний вогонь під час ходу ворога"}
                    onClick={() => act(() => setOverwatch(state, selected.id))}
                    className={"flex-1 rounded border px-2 py-1.5 text-xs " + (!selected.overwatch && selected.ap >= OVERWATCH_AP_COST ? "border-amber-700/70 bg-amber-950/40 text-amber-200 hover:bg-amber-900/40" : "border-slate-800 bg-slate-950/40 text-slate-600")}
                  >
                    ◉ Заступа ({OVERWATCH_AP_COST} AP)
                  </button>
                  <button
                    onClick={() => act(() => { endTurn(state); setTargetId(null); setAiStepN(playAiTurn()); })}
                    className="flex-1 rounded border border-slate-700 bg-slate-800/60 px-2 py-1.5 text-xs text-slate-200 hover:bg-slate-700/60"
                  >
                    Кінець ходу
                  </button>
                </div>
              </div>
            )}

            <div className="rounded border border-slate-800 bg-slate-950/70 p-2">
              <div className="mb-1 text-[11px] uppercase tracking-wider text-slate-500">Журнал бою</div>
              <div className="max-h-56 space-y-0.5 overflow-y-auto font-mono text-[11px] leading-5">
                {state.log.slice(-60).reverse().map((e, i) => (
                  <div
                    key={i}
                    className={e.type === "death" ? "text-rose-400" : e.type === "turn" ? "text-slate-500 italic" : e.type === "overwatch" ? "text-amber-300" : e.type === "shot" ? "text-slate-300" : "text-slate-400"}
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
    </div>
  );
}

// ======== ВІДЖЕТ ========

export default function App() {
  const [seed, setSeed] = useState(42);
  const gameRef = useRef<GeoState | null>(null);
  if (!gameRef.current) gameRef.current = createGeoGame({ seed: 42 });
  const [, force] = useReducer((x: number) => x + 1, 0);
  const [mission, setMission] = useState<Mission | null>(null);
  const [error, setError] = useState<string | null>(null);
  const errTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const state = gameRef.current;
  const clock = geoClock(state);
  const coverage = radarCoverage(state.base);
  const visible = detectedUfos(state);
  const missions = missionTargets(state);
  const missionIds = new Set(missions.map(u => u.id));
  const events = visibleEvents(state);

  const showError = (msg: string) => {
    setError(msg);
    if (errTimer.current) clearTimeout(errTimer.current);
    errTimer.current = setTimeout(() => setError(null), 4500);
  };

  const doTicks = (n: number) => {
    if (mission) return; // час заморожено на час місії
    advanceTime(state, n);
    force();
  };

  const restart = (s: number) => {
    if (mission) return;
    gameRef.current = createGeoGame({ seed: s });
    force();
  };

  // Запуск місії з бейджа «МІСІЯ» у звіті сканерів.
  const launchMission = (ufoId: string) => {
    try {
      setMission(createMission(state, ufoId));
      setError(null);
    } catch (e) {
      showError(e instanceof Error ? e.message : String(e));
    }
  };

  // Завершення місії: результат застосовується до геосцени, повернення на мапу.
  const finishMission = (outcome: "перемога" | "поразка") => {
    if (!mission) return;
    completeMission(state, mission.briefing.ufoId, outcome);
    setMission(null);
    force();
  };

  // Клітинки мапи світу.
  const cells: React.ReactNode[] = [];
  for (let y = 0; y < WORLD_H; y++) {
    for (let x = 0; x < WORLD_W; x++) {
      const kk = x + "," + y;
      cells.push(
        <rect
          key={kk}
          x={x} y={y} width={1} height={1}
          fill={coverage.has(kk) ? "#0c1e2e" : "#080d14"}
          stroke="rgba(148,163,184,0.10)"
          strokeWidth={0.02}
        />
      );
    }
  }

  return (
    <div className="min-h-screen bg-[#03060c] p-3 text-slate-200 lg:p-5">
      <header className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-bold tracking-[0.3em] text-cyan-300">РУБІЖ</h1>
        <span className="text-[11px] text-slate-500">геосцена + місії · ітерація 5.1 · зв'язок шарів</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="rounded bg-slate-800 px-2 py-1 font-mono text-xs tracking-wider text-emerald-300">
            ⏱ {clock}
          </span>
          <button
            onClick={() => doTicks(1)}
            disabled={!!mission}
            className="rounded border border-cyan-800 bg-cyan-950/60 px-3 py-1 text-xs text-cyan-200 hover:bg-cyan-900/60 disabled:opacity-40"
            title="Один тік = 30 хвилин"
          >
            +1 тік (30 хв)
          </button>
          <button
            onClick={() => doTicks(48)}
            disabled={!!mission}
            className="rounded border border-cyan-800 bg-cyan-950/60 px-3 py-1 text-xs text-cyan-200 hover:bg-cyan-900/60 disabled:opacity-40"
            title="Доба = 48 тіків"
          >
            +1 доба
          </button>
          <input
            type="number"
            value={seed}
            onChange={e => setSeed(Number(e.target.value) || 0)}
            className="w-20 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs"
            title="Сід генератора (детермінізм)"
          />
          <button
            onClick={() => restart(seed)}
            disabled={!!mission}
            className="rounded border border-slate-600 bg-slate-800/60 px-3 py-1 text-xs text-slate-200 hover:bg-slate-700/60 disabled:opacity-40"
          >
            Нова партія
          </button>
        </div>
      </header>

      {error && (
        <div className="mb-3 rounded border border-rose-800/60 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">{error}</div>
      )}

      <div className="flex flex-col gap-4 lg:flex-row">
        {/* Мапа світу */}
        <div className="min-w-0 flex-1">
          <div className="max-w-[760px] overflow-hidden rounded-lg border border-slate-800 bg-black/40">
            <svg
              viewBox={`0 0 ${WORLD_W} ${WORLD_H}`}
              className="block h-auto w-full select-none"
            >
              {cells}

              {/* Позначка замикання по X: краї світу з'єднані */}
              <text x={0.12} y={0.42} fontSize={0.34} fill="#334155">⇄</text>
              <text x={WORLD_W - 0.5} y={0.42} fontSize={0.34} textAnchor="end" fill="#334155">⇄</text>

              {/* База «Рубіж» */}
              <g transform={`translate(${state.base.x + 0.5},${state.base.y + 0.5})`}>
                <circle r={0.42} fill="none" stroke="#22d3ee" strokeWidth={0.06} strokeDasharray="0.14 0.1" />
                <circle r={0.28} fill="#22d3ee" stroke="#0e7490" strokeWidth={0.05} />
                <text y={0.95} fontSize={0.32} textAnchor="middle" fill="#67e8f9" fontWeight={600}>
                  база «Рубіж»
                </text>
              </g>

              {/* Виявлені НЛО: у повітрі — ромб, приземлені — квадрат із вікном */}
              {visible.map(u => (
                <g
                  key={u.id}
                  transform={`translate(${u.pos.x + 0.5},${u.pos.y + 0.5})`}
                  style={{ transition: "transform 0.25s ease-out" }}
                >
                  {missionIds.has(u.id) && (
                    <circle r={0.55} fill="none" stroke="#fbbf24" strokeWidth={0.07} strokeDasharray="0.22 0.12" className="animate-pulse" />
                  )}
                  {u.status === "летить" ? (
                    <rect
                      x={-0.26} y={-0.26} width={0.52} height={0.52}
                      fill="#fb7185" stroke="#7f1d1d" strokeWidth={0.05}
                      transform={u.kind === "розвідник" ? "rotate(45)" : ""}
                    />
                  ) : (
                    <rect
                      x={-0.24} y={-0.24} width={0.48} height={0.48}
                      fill="#fbbf24" stroke="#78350f" strokeWidth={0.05}
                      className="animate-pulse"
                    />
                  )}
                  <text y={0.88} fontSize={0.3} textAnchor="middle" fill="#e2e8f0" pointerEvents="none">
                    {u.id}
                  </text>
                </g>
              ))}
            </svg>
          </div>

          <p className="mt-2 max-w-[760px] text-[11px] leading-5 text-slate-500">
            Синій пунктир навколо бази — покриття радара (Чебишев ≤ {RADAR_RANGE}, світ замкнений по горизонталі:
            відстань і рух рахуються через край). Ромби — НЛО в повітрі (повернутий — «розвідник», рівний —
            «збирач»), пульсуючі жовті квадрати — приземлені НЛО: із них можна запустити тактичну
            місію (кнопка у звіті сканерів). Час геосцени заморожено, поки триває бій. Невиявлені НЛО приховані — туман стратегічного шару; трапляється, що НЛО з'являється і відлітає,
            так і не потрапивши на сканери. Один сід — детермінована партія.
          </p>
        </div>

        {/* Панель: звіт НЛО + журнал */}
        <aside className="flex w-full shrink-0 flex-col gap-3 lg:w-80">
          <div className="rounded border border-slate-800 bg-slate-900/60 p-2">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-wider text-slate-500">Звіт сканерів</span>
              <span className="text-[11px] text-slate-400">{visible.length} виявл. НЛО</span>
            </div>
            <div className="flex flex-col gap-1.5">
              {visible.map(u => {
                const isMission = missionIds.has(u.id);
                return (
                  <div
                    key={u.id}
                    className={
                      "rounded border px-2 py-1.5 text-sm " +
                      (isMission
                        ? "border-amber-500/50 bg-amber-950/30"
                        : "border-slate-800 bg-slate-950/50")
                    }
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">
                        <span className={u.status === "летить" ? "text-rose-300" : "text-amber-300"}>
                          {u.kind === "розвідник" ? "◆" : "■"}
                        </span>{" "}
                        {u.id} · {u.kind}
                      </span>
                      {isMission && (
                        <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
                          МІСІЯ
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center justify-between text-[11px] text-slate-400">
                      <span>
                        {u.status === "летить" ? "у повітрі" : "приземлився"} · ({u.pos.x},{u.pos.y})
                      </span>
                      {u.status === "приземлився" && (
                        <span className="text-amber-300/90">
                          вікно: ще {(u.landedTicksLeft * TICK_MINUTES / 60).toFixed(0)} год
                        </span>
                      )}
                    </div>
                    {/* 5.1: запуск тактичної місії з приземленого виявленого НЛО */}
                    {isMission && (
                      <button
                        onClick={() => launchMission(u.id)}
                        disabled={!!mission}
                        className="mt-1.5 w-full rounded border border-amber-600/70 bg-amber-950/40 px-2 py-1 text-[11px] font-medium text-amber-200 hover:bg-amber-900/40 disabled:opacity-40"
                        title="Запустити тактичну місію: загін висаджується біля НЛО"
                      >
                        ▶ Запустити місію
                      </button>
                    )}
                  </div>
                );
              })}
              {visible.length === 0 && (
                <div className="px-1 py-2 text-sm text-slate-500">Сканери чисті. Виявлених НЛО немає.</div>
              )}
            </div>
          </div>

          <div className="rounded border border-slate-800 bg-slate-950/70 p-2">
            <div className="mb-1 text-[11px] uppercase tracking-wider text-slate-500">Журнал спостережень</div>
            <div className="max-h-72 space-y-0.5 overflow-y-auto font-mono text-[11px] leading-5">
              {events.slice(-50).reverse().map((ev, i) => (
                <div
                  key={i}
                  className={
                    ev.e.type === "day" ? "text-slate-500 italic"
                      : ev.e.type === "ufo_left" ? "text-rose-400/90"
                        : ev.e.type === "ufo_landed" ? "text-amber-300"
                          : ev.e.type === "mission_won" ? "font-semibold text-emerald-400"
                            : ev.e.type === "mission_lost" ? "font-semibold text-rose-400"
                              : "text-slate-300"
                  }
                >
                  [{clockOf(ev.e.minute)}] {ev.text}
                </div>
              ))}
              {events.length === 0 && <div className="text-slate-600">Спостережень ще немає.</div>}
            </div>
          </div>

          <div className="rounded border border-slate-800 bg-slate-900/40 p-2 text-[11px] leading-5 text-slate-500">
            Приземлений виявлений НЛО — ціль тактичної операції: «▶ Запустити місію» відкриває бій
            (загін 3 солдати, бойовище детерміноване сідом місії). Перемога — НЛО зачищено; поразка —
            загін втрачено назавжди, НЛО лишається до кінця вікна. Час геосцени на час бою заморожено.
          </div>
        </aside>
      </div>

      {/* Модальний тактичний бій місії (час геосцени заморожено) */}
      {mission && <MissionBattle mission={mission} onReturn={finishMission} />}
    </div>
  );
}
