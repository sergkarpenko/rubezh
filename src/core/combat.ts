// src/core/combat.ts
// Бойове ядро «Рубіж» — ітерації 0–2.
// ADR-0002: Чисте ядро логіки без DOM/Canvas
// ADR-0003: Детермінізм через ін'єктований RNG (mulberry32)
// ADR-0004: Формула влучності без залежності від відстані (точність × модифікатор режиму)
// ADR-0005: Заступа (overwatch) — один постріл зі штрафом точності ×0.7
//
// Чиста логіка: жодних залежностей від DOM/Canvas.
// Уся недетермінованість ізольована в ін'єктованому RNG (детерміновані тести і реплеї).
// Дизайн шансів за мотивами X-COM: влучність = вроджена точність солдата × модифікатор типу пострілу.
// Ітерація 2: заступа (overwatch) з реакційним вогнем під час ходу ворога.

export type RNG = () => number; // [0, 1)

export interface Vec2 {
  x: number;
  y: number;
}
export type Side = 'player' | 'alien';
export type ShotMode = 'auto' | 'snap' | 'aimed';

export interface ShotProfile {
  apCost: number;
  accuracyMod: number;
  shots: number;
}
export interface Weapon {
  name: string;
  damage: [number, number];
  range: number;
  modes: Record<ShotMode, ShotProfile>;
}

export interface Unit {
  id: string;
  side: Side;
  name: string;
  pos: Vec2;
  hp: number;
  maxHp: number;
  ap: number; // очки дій (аналог Time Units)
  maxAp: number;
  firingAccuracy: number; // вроджена точність, 0..1
  weapon: Weapon;
  alive: boolean;
  kills: number;
  overwatch: boolean; // заступа: реакційний вогонь під час ходу ворога
}

export type GameEvent =
  | { type: 'move'; unitId: string; from: Vec2; to: Vec2 }
  | { type: 'shot'; shooterId: string; targetId: string; mode: ShotMode; hit: boolean; damage: number }
  | { type: 'death'; unitId: string; killerId: string }
  | { type: 'turn'; turn: number; side: Side }
  | { type: 'overwatch'; unitId: string; armed: boolean };

export interface GameMap {
  width: number;
  height: number;
  blocked: ReadonlySet<string>;
} // "x,y"
export interface GameState {
  map: GameMap;
  units: Unit[];
  turn: number;
  activeSide: Side;
  rng: RNG;
  log: GameEvent[];
}

export const MOVE_AP_PER_CELL = 1;
export const HIT_CHANCE_FLOOR = 0.02;
export const HIT_CHANCE_CAP = 0.95;
export const OVERWATCH_AP_COST = 3; // вартість заступи
export const OVERWATCH_ACC_PENALTY = 0.7; // штраф точності реакційного пострілу

export const RIFLE: Weapon = {
  name: 'АР-14 «Гарт»',
  damage: [3, 6],
  range: 12,
  modes: {
    auto: { apCost: 4, accuracyMod: 0.5, shots: 3 },
    snap: { apCost: 3, accuracyMod: 0.8, shots: 1 },
    aimed: { apCost: 5, accuracyMod: 1.15, shots: 1 },
  },
};

// Зброя прибульців (ітерація 3.6, баланс підібрано масовими симуляціями:
// dmg 2-5 проти 3-6 у гравця + нижча стартова точність прибульців .50/.45/.40 → ~70% перемог гравця,
// в середньому 1.5 вижившого з 3 — втрати залишаються відчутними).
export const ALIEN_CUTTER: Weapon = {
  name: 'Імпульсний різак',
  damage: [2, 5],
  range: 12,
  modes: {
    auto: { apCost: 4, accuracyMod: 0.5, shots: 3 },
    snap: { apCost: 3, accuracyMod: 0.8, shots: 1 },
    aimed: { apCost: 5, accuracyMod: 1.15, shots: 1 },
  },
};

// --- Утиліти ---

export function mulberry32(seed: number): RNG {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function key(pos: Vec2): string {
  return pos.x + ',' + pos.y;
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function bresenham(a: Vec2, b: Vec2): Vec2[] {
  const pts: Vec2[] = [];
  let x0 = a.x,
    y0 = a.y;
  const x1 = b.x,
    y1 = b.y;
  const dx = Math.abs(x1 - x0),
    dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1,
    sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  for (;;) {
    pts.push({ x: x0, y: y0 });
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
  }
  return pts;
}

export function isInside(map: GameMap, pos: Vec2): boolean {
  return pos.x >= 0 && pos.y >= 0 && pos.x < map.width && pos.y < map.height;
}
export function isBlocked(map: GameMap, pos: Vec2): boolean {
  return map.blocked.has(key(pos));
}
export function unitAt(state: GameState, pos: Vec2): Unit | undefined {
  return state.units.find((u) => u.alive && u.pos.x === pos.x && u.pos.y === pos.y);
}
export function getUnit(state: GameState, id: string): Unit {
  const u = state.units.find((u) => u.id === id);
  if (!u) throw new Error('Невідомий юніт: ' + id);
  return u;
}
function requireActive(state: GameState, u: Unit): void {
  if (!u.alive) throw new Error('Юніт ' + u.id + ' мертвий');
  if (u.side !== state.activeSide) throw new Error('Зараз хід не сторони ' + u.side);
}

// Лінія вогню: проміжні клітинки (без кінців) не мають перешкод.
export function hasLineOfSight(state: GameState, from: Vec2, to: Vec2): boolean {
  const line = bresenham(from, to);
  for (let i = 1; i < line.length - 1; i++) {
    if (isBlocked(state.map, line[i])) return false;
  }
  return true;
}

// Влучність не залежить від цілі (як в оригіналі): точність солдата × режим пострілу.
export function calculateHitChance(attacker: Unit, mode: ShotMode): number {
  const mod = attacker.weapon.modes[mode].accuracyMod;
  return Math.min(HIT_CHANCE_CAP, Math.max(HIT_CHANCE_FLOOR, attacker.firingAccuracy * mod));
}

// --- Фабрики ---

export function makeUnit(init: Partial<Unit> & { id: string; side: Side; pos: Vec2 }): Unit {
  return {
    name: init.id,
    hp: 10,
    maxHp: 10,
    ap: 10,
    maxAp: 10,
    firingAccuracy: 0.6,
    weapon: RIFLE,
    alive: true,
    kills: 0,
    overwatch: false,
    ...init,
  };
}

export interface CreateGameOptions {
  map: GameMap;
  units: Unit[];
  rng?: RNG;
  startingSide?: Side;
}

export function createGame(opts: CreateGameOptions): GameState {
  const state: GameState = {
    map: opts.map,
    units: opts.units,
    turn: 1,
    activeSide: opts.startingSide ?? 'player',
    rng: opts.rng ?? mulberry32(42),
    log: [],
  };
  for (const u of state.units) if (u.side === state.activeSide) u.ap = u.maxAp;
  return state;
}

// --- Дії ---

export function endTurn(state: GameState): void {
  const next: Side = state.activeSide === 'player' ? 'alien' : 'player';
  if (next === 'player') state.turn += 1;
  state.activeSide = next;
  // на початку свого ходу заступа скидається (AP зарезервовані минулого разу)
  for (const u of state.units)
    if (u.side === next && u.alive) {
      u.ap = u.maxAp;
      u.overwatch = false;
    }
  state.log.push({ type: 'turn', turn: state.turn, side: next });
}

// Заступа: резервація AP за один хід до початку ходу ворога.
export function setOverwatch(state: GameState, unitId: string): void {
  const u = getUnit(state, unitId);
  requireActive(state, u);
  if (u.overwatch) return;
  if (u.ap < OVERWATCH_AP_COST) throw new Error('Недостатньо очок дій для заступи');
  u.ap -= OVERWATCH_AP_COST;
  u.overwatch = true;
  state.log.push({ type: 'overwatch', unitId: u.id, armed: true });
}

// Перевірки одного кроку шляху: суміжність, межі мапи, перешкода, зайнятість, AP.
function assertStep(state: GameState, u: Unit, step: Vec2): void {
  if (Math.abs(step.x - u.pos.x) + Math.abs(step.y - u.pos.y) !== 1) {
    throw new Error('Крок не суміжний (дозволені 4 напрямки)');
  }
  if (!isInside(state.map, step)) throw new Error('Крок за межі мапи');
  if (isBlocked(state.map, step)) throw new Error('Крок у перешкоду');
  if (unitAt(state, step)) throw new Error('Клітинка зайнята');
  if (u.ap < MOVE_AP_PER_CELL) throw new Error('Недостатньо очок дій');
}

// Рух по готовому шляху (A* — у map.ts, ітерація 2). Кроки строго по 4 напрямках.
// Кожен крок може спровокувати реакційний вогонь заступи ворога; смерть перериває рух.
export function moveUnit(state: GameState, unitId: string, path: Vec2[]): void {
  const u = getUnit(state, unitId);
  requireActive(state, u);
  for (const step of path) {
    assertStep(state, u, step);
    const from = { ...u.pos };
    u.ap -= MOVE_AP_PER_CELL;
    u.pos = { ...step };
    state.log.push({ type: 'move', unitId: u.id, from, to: { ...step } });
    triggerOverwatch(state, u);
    if (!u.alive) break; // реакційний вогонь перервав рух
  }
}

// Один постріл (спільний для атаки й реакційного вогню заступи, Фаза 2/П5):
// кидок влучності, пошкодження, смерть цілі; події — у state.log.
// ADR-0003: порядок викликів RNG фіксований — кидок влучності, потім лише
// при влучанні кидок пошкодження.
function fireOnce(state: GameState, shooter: Unit, target: Unit, mode: ShotMode, chance: number): { hit: boolean; damage: number } {
  const hit = state.rng() < chance;
  let damage = 0;
  if (hit) {
    const dmin = shooter.weapon.damage[0],
      dmax = shooter.weapon.damage[1];
    damage = dmin + Math.floor(state.rng() * (dmax - dmin + 1));
    target.hp -= damage;
    if (target.hp <= 0) {
      target.hp = 0;
      target.alive = false;
      shooter.kills += 1;
      state.log.push({ type: 'death', unitId: target.id, killerId: shooter.id });
    }
  }
  state.log.push({ type: 'shot', shooterId: shooter.id, targetId: target.id, mode, hit, damage });
  return { hit, damage };
}

// Один реакційний постріл заступою: режим snap без витрати AP (AP зарезервовані),
// зі штрафом точності OVERWATCH_ACC_PENALTY.
function fireReaction(state: GameState, shooter: Unit, target: Unit): void {
  const profile = shooter.weapon.modes.snap;
  const chance = Math.min(HIT_CHANCE_CAP, Math.max(HIT_CHANCE_FLOOR, shooter.firingAccuracy * profile.accuracyMod * OVERWATCH_ACC_PENALTY));
  fireOnce(state, shooter, target, 'snap', chance);
}

// Реакційний вогонь по юніту, що рухається: один постріл з кожної заступи.
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

export interface AttackResult {
  shots: { hit: boolean; damage: number }[];
  targetDown: boolean;
}

// Перевірки перед пострілом: активна сторона, жива ціль, вогонь лише по ворогах,
// дальність, лінія вогню, вартість AP (ADR-0004: відстань не впливає на влучність).
function assertCanFire(state: GameState, s: Unit, t: Unit, mode: ShotMode): void {
  requireActive(state, s);
  if (!t.alive) throw new Error('Ціль уже мертва');
  if (s.side === t.side) throw new Error('Вогонь по своїх заборонений');
  if (distance(s.pos, t.pos) > s.weapon.range) throw new Error('Ціль поза дальністю зброї');
  if (!hasLineOfSight(state, s.pos, t.pos)) throw new Error('Немає лінії вогню');
  if (s.ap < s.weapon.modes[mode].apCost) throw new Error('Недостатньо очок дій для пострілу ' + mode);
}

export function resolveAttack(state: GameState, shooterId: string, targetId: string, mode: ShotMode): AttackResult {
  const s = getUnit(state, shooterId);
  const t = getUnit(state, targetId);
  assertCanFire(state, s, t, mode);
  const profile = s.weapon.modes[mode];
  s.ap -= profile.apCost;
  const chance = calculateHitChance(s, mode);
  const result: AttackResult = { shots: [], targetDown: false };
  for (let i = 0; i < profile.shots; i++) {
    const shot = fireOnce(state, s, t, mode, chance);
    result.shots.push(shot);
    if (!t.alive) {
      result.targetDown = true;
      break;
    } // мертва ціль не отримує зайвих куль серії
  }
  return result;
}
