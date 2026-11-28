// src/core/combat.ts
// Бойове ядро «Рубіж» — ітерації 0–2.
// ADR-0002: Чисте ядро логіки без DOM/Canvas
// ADR-0003: Детермінізм через ін'єктований RNG (mulberry32)
// ADR-0004: Формула влучності без залежності від відстані (точність × модифікатор режиму)
// ADR-0005: Заступа (overwatch) — один постріл зі штрафом точності ×0.7
// П11.4 (ADR-0058): бойові дії з витратниками — «Лікування» (аптечка)
// і «Кидок гранати» (осколкова). ШІ прибульців предметів не має (MVP);
// бій без предметів — байт-у-байт незмінний (критерій П11.4).
// п16.3 (ADR-0147 п. 3, 11): дії ролей раз за бій — «Ривок» штурмовика,
// «Точний постріл» снайпера, «Польова допомога» медика; бій без ролей —
// байт-у-байт незмінний.
// П15.2 (ADR-0075): евакуація з місії — дія evacuate: активний солдат у
// клітинці зони висадки (evacZone) знімається з поля у список evacuated.
// Евакуйований вилучений з units → не ціль ШІ/пострілів/гранат/дозору
// (формальні тести — П15.3); бій без евакуації — байт-у-байт незмінний.
//
// п17.2 (ADR-0149 п. 9–11): типи ворогів — необов'язкові `Unit.kind` і
// `Unit.armor`, режими зброї `Weapon.only`; броня — у fireOnce (постріл, дозор,
// «Точний постріл»), граната її не враховує. Без цих полів — байт-у-байт як раніше.
//
// Чиста логіка: жодних залежностей від DOM/Canvas.
// Уся недетермінованість ізольована в ін'єктованому RNG (детерміновані тести і реплеї).
// Дизайн шансів за мотивами X-COM: влучність = вроджена точність солдата × модифікатор типу пострілу.
// Ітерація 2: дозор (overwatch) з реакційним вогнем під час ходу ворога.

import type { EnemyKind } from './enemies';

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
  // п17.2 (ADR-0149 п. 10): доступні режими; без поля — усі три. Профілі недоступних
  // режимів дорівнюють дозволеному (дозор бере `modes.snap`).
  only?: ShotMode[];
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
  overwatch: boolean; // дозор: реакційний вогонь під час ходу ворога
  kind?: EnemyKind; // п17.2 (ADR-0149 п. 9): тип ворога; відсутній — демон (і оперативник)
  armor?: number; // п17.2 (ADR-0149 п. 5, 11): мінус від кожного влучання пострілу
  // п18.4 (ADR-0153 п. 16, ADR-0156): турель бази — нерухомий юніт сторони загону
  // (стріляє і стає в дозор, рухатись не може; поза ростером і досвідом).
  turret?: boolean;
}

// П11.4 (ADR-0058): витратники юніта в цьому бою. «По одній на місцію»:
// дія доступна, поки прапорець true; використання списує його в стані бою.
// Стан ростеру/складу це ядро не знає — копію на місію готує шар екіпірування
// (deployConsumables/settleConsumables у workshop.ts).
export interface UnitItems {
  medkit: boolean; // «Аптечка»: доступна дія «Лікування»
  grenade: boolean; // «Осколкова граната»: доступна дія «Кидок»
  charge?: boolean; // п18.2 (ADR-0154): «Пробивний заряд» — перша атака по броньованій цілі без броні
}

// п16.3 (ADR-0147 п. 3, 11): роль оперативника і прапорець «дію використано»
// в стані бою — як витратники ADR-0058: кар'єри ростеру ядро бою не знає,
// копію на місію готує squad.ts (`deployRoles`).
export type BattleRole = 'assault' | 'sniper' | 'medic';
// п22.2 (ADR-0182 п. 1, 7; ADR-0183): спеціалізація «Сержанта» — підсилення дії ролі
// (каталог і назви — `CAREER_TREE` у career.ts; «Панцир» — броня в записі юніта ростеру).
export type RoleSpec = 'breakthrough' | 'plating' | 'hunter' | 'sentinel' | 'surgeon' | 'rescuer';
export interface UnitRole {
  role: BattleRole;
  used: boolean; // дію ролі використано в цьому бою
  spec?: RoleSpec; // п22.2: без поля — дія ролі як до п22.2
  extraUses?: number; // п22.2: «Рятівник» — ще стільки використань до `used`
}

export type GameEvent =
  | { type: 'move'; unitId: string; from: Vec2; to: Vec2 }
  | { type: 'shot'; shooterId: string; targetId: string; mode: ShotMode; hit: boolean; damage: number }
  | { type: 'death'; unitId: string; killerId: string }
  | { type: 'turn'; turn: number; side: Side }
  | { type: 'overwatch'; unitId: string; armed: boolean }
  // П11.4 (ADR-0058): події нових бойових дій з витратниками
  | { type: 'heal'; unitId: string; targetId: string; healed: number }
  | { type: 'grenade'; unitId: string; center: Vec2; hits: { unitId: string; damage: number }[] }
  // П15.2 (ADR-0075): солдат евакуйований з зони висадки (одна подія на солдата)
  | { type: 'evac_unit'; unitId: string }
  // п16.3 (ADR-0147 п. 11): дії ролей. «Точний постріл» — мітка перед звичайною
  // подією shot (режим aimed, шкода вже з множником), тож анімація і звук пострілу
  // ті самі, що в прицільного; при вбивстві — precise_shot, death, shot (як у fireOnce).
  | { type: 'dash'; unitId: string; bonus: number } // bonus — додані AP (не підсумок)
  | { type: 'precise_shot'; shooterId: string; targetId: string }
  | { type: 'field_aid'; unitId: string; targetId: string; healed: number }
  | { type: 'charge'; shooterId: string; targetId: string }; // п18.5 (ADR-0157): «Пробивний заряд» витрачено

export interface GameMap {
  width: number;
  height: number;
  blocked: ReadonlySet<string>;
  // п20.2 (ADR-0165 п. 3, 11): низькі перешкоди (ящики, уламки) — не проходяться, але огляд,
  // вогонь і гранату не закривають; дають пів-укриття. Без поля — мапа як до п20.2.
  low?: ReadonlySet<string>;
} // "x,y"
export interface GameState {
  map: GameMap;
  units: Unit[];
  turn: number;
  activeSide: Side;
  rng: RNG;
  log: GameEvent[];
  items?: Record<string, UnitItems>; // П11.4: витратники юнітів у цьому бою (id → предмети)
  // П15.2 (ADR-0075): зона висадки — клітинки, з яких можлива евакуація
  // (у місії — SQUAD_SPAWN, mission.ts); без зони (демо-бої) евакуація недоступна.
  evacZone?: Vec2[];
  // П15.2 (ADR-0075): евакуйовані солдати — зняті з поля, поза units.
  // Стан бою (сейв у бою недоступний, ADR-0026): формат сейву не змінюється.
  evacuated?: Unit[];
  roles?: Record<string, UnitRole>; // п16.3: ролі оперативників у цьому бою (id → роль)
  // п18.4 (ADR-0156): зона ворогів, до якої йде бот загону, поки ворога не видно
  // (фінал «Брама Розриву» — свій кут мапи); без поля — ALIEN_SPAWN, як досі.
  enemyZone?: Vec2[];
  // п20.2 (ADR-0165 п. 10): укриття цілі множить шанс пострілу й дозору (бої місій);
  // без поля — шанс і журнал як до п20.2.
  cover?: boolean;
}

export const MOVE_AP_PER_CELL = 1;
export const HIT_CHANCE_FLOOR = 0.02;
export const HIT_CHANCE_CAP = 0.95;
export const OVERWATCH_AP_COST = 3; // вартість дозору
export const OVERWATCH_ACC_PENALTY = 0.7; // штраф точності реакційного пострілу
// Радіус огляду юніта (Чебишев). п17.3: тут, а не в map.ts, — його бере дозор
// (`triggerOverwatch`); map.ts реекспортує ту саму константу.
export const VISION_RANGE = 12;

// П11.4 (ADR-0058): параметри нових бойових дій. Усі числа — КАНДИДАТИ,
// тунінг probe-симуляціями П11.8 (патерн П10.4).
export const HEAL_AP_COST = 4; // «Лікування»: 4 AP
export const HEAL_AMOUNT = 3; // +3 HP, не вище maxHp
export const GRENADE_AP_COST = 4; // «Кидок гранати»: 4 AP
export const GRENADE_RANGE = 6; // дальність кидка (Чебишев) — менша за радіус огляду 12 (map.ts)
export const GRENADE_DAMAGE: [number, number] = [3, 5]; // пошкодження всієї зони вибуху (один кидок RNG)

// п16.3 (ADR-0147 п. 3): дії ролей; числа — кандидати, probe п16.5.
export const DASH_AP_BONUS = 4; // «Ривок»: +4 AP цього ходу, сам — 0 AP, AP може перевищити максимум
export const PRECISE_AP_COST = 6; // «Точний постріл»: 6 AP
export const PRECISE_DAMAGE_MULT = 1.5; // шкода ×1,5 з округленням униз
export const FIELD_AID_AP_COST = 2; // «Польова допомога»: 2 AP
export const FIELD_AID_AMOUNT = HEAL_AMOUNT; // +3 HP за правилом гелю, без гелю
// п22.2 (ADR-0183, рішення власника «А. Підсилення дії ролі»): спеціалізації «Сержанта» в бою.
export const BREAKTHROUGH_DASH_BONUS = 6; // «Прорив»: «Ривок» +6 AP замість +4
export const HUNTER_DAMAGE_MULT = 2; // «Мисливець»: «Точний постріл» — шкода ×2 замість ×1,5
export const SURGEON_AID_AMOUNT = 5; // «Хірург»: «Польова допомога» +5 HP замість +3
export const RESCUER_EXTRA_USES = 1; // «Рятівник»: «Польова допомога» двічі за бій

export const EVAC_AP_COST = 2; // П15.2 (ADR-0075): «Евакуація» — 2 AP (кандидат, probe П15.5)

// п17.2: назви режимів у повідомленнях ядра (як підписи плиток UI)
const MODE_NAMES: Record<ShotMode, string> = { snap: '«Швидкий»', aimed: '«Прицільний»', auto: '«Черга»' };

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
// в середньому 1.5 уцілілого з 3 — втрати залишаються відчутними).
export const ALIEN_CUTTER: Weapon = {
  name: 'Фазовий різак',
  damage: [2, 5],
  range: 12,
  modes: {
    auto: { apCost: 4, accuracyMod: 0.5, shots: 3 },
    snap: { apCost: 3, accuracyMod: 0.8, shots: 1 },
    aimed: { apCost: 5, accuracyMod: 1.15, shots: 1 },
  },
};

// --- Утиліти ---

// ADR-0003: Детермінізм через ін'єктований RNG (mulberry32)
// ADR-0026: rng.state відкритий лише для збереження/відновлення партії;
// виклик rng не змінюється — це той самий mulberry32, з видимою позицією потоку.
export interface StatefulRng extends RNG {
  state: number; // внутрішній 32-бітний стан генератора
}

export function mulberry32(seed: number): StatefulRng {
  const rng = () => {
    rng.state = (rng.state + 0x6d2b79f5) | 0;
    let t = Math.imul(rng.state ^ (rng.state >>> 15), 1 | rng.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.state = seed >>> 0;
  return rng;
}

function key(pos: Vec2): string {
  return pos.x + ',' + pos.y;
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

// п17.3: клітинки лінії від a до b включно з кінцями (Брезенгем у напрямку a→b) — трасер від краю туману.
export function lineCells(a: Vec2, b: Vec2): Vec2[] {
  return bresenham(a, b);
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
// п20.2: низька перешкода (ADR-0165 п. 11).
export function isLow(map: GameMap, pos: Vec2): boolean {
  return map.low?.has(key(pos)) ?? false;
}
// п20.2: клітинка не проходиться — стіна чи низька перешкода (рух, шлях, зона руху);
// огляд, вогонь і граната — лише стіни (`isBlocked`).
export function isImpassable(map: GameMap, pos: Vec2): boolean {
  return isBlocked(map, pos) || isLow(map, pos);
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

function lineClear(map: GameMap, from: Vec2, to: Vec2, blockers?: ReadonlySet<string>): boolean {
  const line = bresenham(from, to);
  for (let i = 1; i < line.length - 1; i++) {
    if (isBlocked(map, line[i])) return false;
    if (blockers?.has(key(line[i]))) return false;
  }
  return true;
}

// Лінія лише рельєфом (кінці не рахуються), симетрична (ADR-0087). п17.4: лінія кидка
// гранати — кидок іде над головами, юніти її не закривають (ADR-0149 п. 14).
export function hasTerrainLine(state: GameState, from: Vec2, to: Vec2): boolean {
  return lineClear(state.map, from, to) || lineClear(state.map, to, from);
}

// п17.4 (ADR-0151, рішення власника «Б. За стороною»): хто з живих юнітів закриває огляд
// і вогонь для сторони side. Свої — завжди (сторона їх знає). Чужі — лише ті, кого бачить
// хоч один свій юніт за першим проходом: глядач v бачить клітинку c, якщо лінія v→c чи c→v
// чиста від рельєфу, від своїх юнітів і від чужих у клітинках, які v уже бачить. Проміжна
// клітинка лінії Брезенгема ближча до v (Чебишов), ніж c, тож означення фундоване відстанню
// і не залежить від невидимих юнітів — туман не видає їх (ADR-0081).
interface SightCache {
  sig: string;
  blocked: ReadonlySet<string>;
  side: Partial<Record<Side, { blockers: Set<string>; seen: Unit[] }>>;
}
const sightCache = new WeakMap<GameState, SightCache>();

function sightOf(state: GameState, side: Side): { blockers: Set<string>; seen: Unit[] } {
  // ключ кешу — живі юніти з позиціями і стіни (у тестах стан міняють напряму)
  let sig = state.map.width + 'x' + state.map.height + '#' + state.map.blocked.size + ':';
  for (const u of state.units) if (u.alive) sig += u.id + '@' + u.pos.x + ',' + u.pos.y + ';';
  let c = sightCache.get(state);
  if (!c || c.sig !== sig || c.blocked !== state.map.blocked) {
    c = { sig, blocked: state.map.blocked, side: {} };
    sightCache.set(state, c);
  }
  const hit = c.side[side];
  if (hit) return hit;
  const at = new Map<string, Unit>();
  for (const u of state.units) if (u.alive) at.set(key(u.pos), u);
  const own = state.units.filter((u) => u.alive && u.side === side);
  const foes = state.units.filter((u) => u.alive && u.side !== side);
  const memo = new Map<Unit, Map<string, boolean>>(own.map((v) => [v, new Map()]));
  const seen = foes.filter((e) => own.some((v) => firstPassSees(state, v, e.pos, at, memo.get(v) as Map<string, boolean>)));
  const blockers = new Set<string>([...own, ...seen].map((u) => key(u.pos)));
  const res = { blockers, seen };
  c.side[side] = res;
  return res;
}

function firstPassSees(state: GameState, v: Unit, c: Vec2, at: Map<string, Unit>, memo: Map<string, boolean>): boolean {
  if (distance(v.pos, c) > VISION_RANGE) return false;
  const ck = key(c);
  const m = memo.get(ck);
  if (m !== undefined) return m;
  const clear = (a: Vec2, b: Vec2): boolean => {
    const line = bresenham(a, b);
    for (let i = 1; i < line.length - 1; i++) {
      if (isBlocked(state.map, line[i])) return false;
      const u = at.get(key(line[i]));
      if (u === undefined || u === v) continue;
      if (u.side === v.side || firstPassSees(state, v, line[i], at, memo)) return false;
    }
    return true;
  };
  const r = ck === key(v.pos) || clear(v.pos, c) || clear(c, v.pos);
  memo.set(ck, r);
  return r;
}

// Закривачі огляду для сторони: свої живі юніти і чужі, яких сторона бачить (п17.4).
export function sightBlockers(state: GameState, side: Side): ReadonlySet<string> {
  return sightOf(state, side).blockers;
}

// Чужі живі юніти, яких бачить сторона side (п17.4): вони ж — видимі вороги туману.
export function seenEnemies(state: GameState, side: Side): Unit[] {
  return [...sightOf(state, side).seen];
}

// Лінія огляду й вогню для сторони side: проміжні клітинки (без кінців) — без рельєфу і без
// закривачів сторони (sightBlockers). Растеризація залежить від напрямку, тож лінія чиста,
// якщо чиста хоч в один бік — за тих самих закривачів правило симетричне (ADR-0087).
// ignore — клітинка, яку не рахувати закривачем (юніт, що оцінює позицію, куди піде, ШІ).
export function hasLineOfSight(state: GameState, from: Vec2, to: Vec2, side: Side, ignore?: Vec2): boolean {
  let blockers = sightBlockers(state, side);
  if (ignore !== undefined && blockers.has(key(ignore))) {
    const b = new Set(blockers);
    b.delete(key(ignore));
    blockers = b;
  }
  return lineClear(state.map, from, to, blockers) || lineClear(state.map, to, from, blockers);
}

// п17.2 (ADR-0149 п. 10): чи має зброя режим (без `only` — усі три).
export function weaponHasMode(w: Weapon, mode: ShotMode): boolean {
  return w.only === undefined || w.only.includes(mode);
}

// п20.2 (ADR-0165 п. 1–2, 9–10; ADR-0166): укриття цілі з боку стрільця.
export type CoverLevel = 'none' | 'half' | 'full';
// Множник шансу за укриттям цілі: фланг (без укриття) ×1,2, пів ×0,75, повне ×0,5.
export const COVER_MULT: Readonly<Record<CoverLevel, number>> = { none: 1.2, half: 0.75, full: 0.5 };
const COVER_RANK: Readonly<Record<CoverLevel, number>> = { none: 0, half: 1, full: 2 };

// Укриття цілі target від стрільця в клітинці shooter. Сусід N = target + a, a = (dx, dy) —
// «з боку стрільця», коли кут між a і b = shooter − target не більший за 45° (цілочисельно:
// dot > 0 і 2·dot² ≥ |a|²·|b|², межа включно); стіна в такому сусіді — повне, низька
// перешкода — пів, з кількох — найсильніше; немає — фланг. Стрілець у сусідній клітинці
// цілі (впритул, і по діагоналі) — завжди фланг (рішення власника п20.2 «Б»). Юніти укриття
// не дають (ADR-0151).
export function coverOf(map: GameMap, target: Vec2, shooter: Vec2): CoverLevel {
  const bx = shooter.x - target.x,
    by = shooter.y - target.y;
  if (Math.max(Math.abs(bx), Math.abs(by)) <= 1) return 'none';
  const bb = bx * bx + by * by;
  let best: CoverLevel = 'none';
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const dot = dx * bx + dy * by;
      if (dot <= 0 || 2 * dot * dot < (dx * dx + dy * dy) * bb) continue;
      const n = { x: target.x + dx, y: target.y + dy };
      const c: CoverLevel = isBlocked(map, n) ? 'full' : isLow(map, n) ? 'half' : 'none';
      if (COVER_RANK[c] > COVER_RANK[best]) best = c;
    }
  }
  return best;
}

// Укриття, що діє на постріл shooter → target у цьому бою: undefined — бій без опції
// `cover` чи зброя ближнього бою (дальність 1, «Кігті»): шанс як до п20.2.
export function shotCover(state: GameState, shooter: Unit, target: Unit): CoverLevel | undefined {
  if (!state.cover || shooter.weapon.range <= 1) return undefined;
  return coverOf(state.map, target.pos, shooter.pos);
}

// Шанс у межах HIT_CHANCE_FLOOR…HIT_CHANCE_CAP.
function clampChance(p: number): number {
  return Math.min(HIT_CHANCE_CAP, Math.max(HIT_CHANCE_FLOOR, p));
}

// Точність солдата × режим пострілу (ADR-0004); п20.2: × множник укриття цілі, якщо його
// передано (`shotCover`); без укриття — як до п20.2.
export function calculateHitChance(attacker: Unit, mode: ShotMode, cover?: CoverLevel): number {
  const mod = attacker.weapon.modes[mode].accuracyMod;
  if (cover === undefined) return clampChance(attacker.firingAccuracy * mod);
  return clampChance(attacker.firingAccuracy * mod * COVER_MULT[cover]);
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
  items?: Record<string, UnitItems>; // П11.4: витратники юнітів у цьому бою
  evacZone?: Vec2[]; // П15.2 (ADR-0075): зона висадки для евакуації (mission.ts)
  roles?: Record<string, UnitRole>; // п16.3: ролі оперативників (deployRoles у squad.ts)
  enemyZone?: Vec2[]; // п18.4: зона ворогів для бота загону (брама)
  cover?: boolean; // п20.2 (ADR-0165 п. 10): укриття в шансі — бої місій
}

export function createGame(opts: CreateGameOptions): GameState {
  const state: GameState = {
    map: opts.map,
    units: opts.units,
    turn: 1,
    activeSide: opts.startingSide ?? 'player',
    rng: opts.rng ?? mulberry32(42),
    log: [],
    items: opts.items,
    evacZone: opts.evacZone?.map((c) => ({ ...c })), // П15.2: копія — зона не мутується боєм
    evacuated: [], // П15.2 (ADR-0075): евакуйовані цього бою
  };
  // п16.3: копія — бій змінює used, переданий об'єкт лишається як був; без ролей — стан як до п16.3
  if (opts.roles) state.roles = Object.fromEntries(Object.entries(opts.roles).map(([id, r]) => [id, { ...r }]));
  if (opts.enemyZone) state.enemyZone = opts.enemyZone.map((c) => ({ ...c })); // п18.4: без поля — стан як досі
  if (opts.cover) state.cover = true; // п20.2: без опції — стан як досі
  for (const u of state.units) if (u.side === state.activeSide) u.ap = u.maxAp;
  return state;
}

// --- Дії ---

export function endTurn(state: GameState): void {
  const next: Side = state.activeSide === 'player' ? 'alien' : 'player';
  if (next === 'player') state.turn += 1;
  state.activeSide = next;
  // на початку свого ходу дозор скидається (AP зарезервовані минулого разу)
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
  if (u.ap < OVERWATCH_AP_COST) throw new Error('Недостатньо очок дій для дозору');
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
  if (isImpassable(state.map, step)) throw new Error('Крок у перешкоду');
  if (unitAt(state, step)) throw new Error('Клітинка зайнята');
  if (u.ap < MOVE_AP_PER_CELL) throw new Error('Недостатньо очок дій');
}

// Рух по готовому шляху (A* — у map.ts, ітерація 2). Кроки строго по 4 напрямках.
// Кожен крок може спровокувати реакційний вогонь дозору ворога; смерть перериває рух.
// stopAtUnit (ADR-0081): шлях планувався без знання про юнітів у тумані — крок у
// зайняту клітинку не помилка, а кінець руху перед нею; пройдені кроки й AP
// лишаються. Повертає юніта, що перекрив шлях (інакше undefined).
export function moveUnit(state: GameState, unitId: string, path: Vec2[], stopAtUnit = false): Unit | undefined {
  const u = getUnit(state, unitId);
  requireActive(state, u);
  if (u.turret) throw new Error('Турель нерухома');
  for (const step of path) {
    const blocker = stopAtUnit ? unitAt(state, step) : undefined;
    if (blocker !== undefined) return blocker;
    assertStep(state, u, step);
    const from = { ...u.pos };
    u.ap -= MOVE_AP_PER_CELL;
    u.pos = { ...step };
    state.log.push({ type: 'move', unitId: u.id, from, to: { ...step } });
    triggerOverwatch(state, u);
    if (!u.alive) break; // реакційний вогонь перервав рух
  }
  return undefined;
}

// Один постріл (спільний для атаки й реакційного вогню дозору, Фаза 2/П5):
// кидок влучності, пошкодження, смерть цілі; події — у state.log.
// ADR-0003: порядок викликів RNG фіксований — кидок влучності, потім лише
// при влучанні кидок пошкодження.
// п16.3: mult — множник шкоди «Точного пострілу» (округлення вниз); RNG той самий.
// п17.2 (ADR-0149 п. 11): броня цілі — після множника, не менше 1; подія несе шкоду після броні.
function fireOnce(
  state: GameState,
  shooter: Unit,
  target: Unit,
  mode: ShotMode,
  chance: number,
  mult = 1,
  pierce = false
): { hit: boolean; damage: number } {
  const hit = state.rng() < chance;
  let damage = 0;
  if (hit) {
    const dmin = shooter.weapon.damage[0],
      dmax = shooter.weapon.damage[1];
    damage = Math.floor((dmin + Math.floor(state.rng() * (dmax - dmin + 1))) * mult);
    if (!pierce && target.armor !== undefined && target.armor > 0) damage = Math.max(1, damage - target.armor);
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

// Один реакційний постріл дозору: режим snap без витрати AP (AP зарезервовані),
// зі штрафом точності OVERWATCH_ACC_PENALTY. п17.2: зброя з `only` — профіль
// `modes.snap` дорівнює дозволеному, подія пише режим `only[0]`.
function fireReaction(state: GameState, shooter: Unit, target: Unit): void {
  const profile = shooter.weapon.modes.snap;
  // п20.2: укриття цілі — множником після штрафу дозору; без укриття — вираз як до п20.2
  const cover = shotCover(state, shooter, target);
  // п22.2: «Вартовий» стріляє з дозору без штрафу точності; решта — як досі
  const penalty = state.roles?.[shooter.id]?.spec === 'sentinel' ? 1 : OVERWATCH_ACC_PENALTY;
  const base = shooter.firingAccuracy * profile.accuracyMod * penalty;
  const chance = clampChance(cover === undefined ? base : base * COVER_MULT[cover]);
  fireOnce(state, shooter, target, shooter.weapon.only?.[0] ?? 'snap', chance);
}

// п17.3 (рішення власника «А. Лише по видимих»): чи бачить клітинку pos хоч один
// живий юніт сторони — те саме правило, що `computeVisibleCells` / `visibleEnemies` (map.ts).
// п17.4: плюс клітинки ворогів, яких сторона бачить (seenEnemies), — як sideVisibleCells.
export function sideSees(state: GameState, side: Side, pos: Vec2): boolean {
  if (seenEnemies(state, side).some((e) => e.pos.x === pos.x && e.pos.y === pos.y)) return true;
  return state.units.some(
    (u) => u.alive && u.side === side && distance(u.pos, pos) <= VISION_RANGE && hasLineOfSight(state, u.pos, pos, side)
  );
}

// Реакційний вогонь по юніту, що рухається: один постріл з кожного дозору.
// п17.3: далі за огляд (VISION_RANGE) — лише по цілі, яку бачить сторона дозорця
// (око б'є на 16); у межах огляду лінія вогню вже означає, що дозорець бачить ціль сам.
function triggerOverwatch(state: GameState, mover: Unit): void {
  for (const w of state.units) {
    if (!w.alive || !w.overwatch || w.side === mover.side) continue;
    const d = distance(w.pos, mover.pos);
    if (d > w.weapon.range) continue;
    if (!hasLineOfSight(state, w.pos, mover.pos, w.side)) continue;
    if (d > VISION_RANGE && !sideSees(state, w.side, mover.pos)) continue;
    w.overwatch = false; // дозор «розряджається» одним пострілом
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
  // п17.2 (ADR-0149 п. 10, EARS 5): режим, якого немає у зброї; ціль ближнього бою — лише впритул
  if (!weaponHasMode(s.weapon, mode)) throw new Error('Зброя «' + s.weapon.name + '» не має режиму ' + MODE_NAMES[mode]);
  if (distance(s.pos, t.pos) > s.weapon.range) {
    throw new Error(
      s.weapon.range === 1 ? 'Ціль не впритул: «' + s.weapon.name + '» б’ють лише сусідню клітинку' : 'Ціль поза дальністю зброї'
    );
  }
  if (!hasLineOfSight(state, s.pos, t.pos, s.side)) throw new Error('Немає лінії вогню');
  if (s.ap < s.weapon.modes[mode].apCost) throw new Error('Недостатньо очок дій для пострілу ' + MODE_NAMES[mode]); // п17.2 (аудит PR #507): назва режиму українською
}

export function resolveAttack(state: GameState, shooterId: string, targetId: string, mode: ShotMode): AttackResult {
  const s = getUnit(state, shooterId);
  const t = getUnit(state, targetId);
  assertCanFire(state, s, t, mode);
  const profile = s.weapon.modes[mode];
  s.ap -= profile.apCost;
  const chance = calculateHitChance(s, mode, shotCover(state, s, t));
  const pierce = useCharge(state, s, t);
  const result: AttackResult = { shots: [], targetDown: false };
  for (let i = 0; i < profile.shots; i++) {
    const shot = fireOnce(state, s, t, mode, chance, 1, pierce);
    result.shots.push(shot);
    if (!t.alive) {
      result.targetDown = true;
      break;
    } // мертва ціль не отримує зайвих куль серії
  }
  return result;
}

// --- П11.4 (ADR-0058): дії з витратниками ---

// Зона вибуху гранати: епіцентр + чотири сусіди за напрямками (хрест).
// Експортовано для бота (ai-bot.ts будує зону без дублювання, ADR-0038).
export function grenadeZone(center: Vec2): Vec2[] {
  return [
    { x: center.x, y: center.y },
    { x: center.x + 1, y: center.y },
    { x: center.x - 1, y: center.y },
    { x: center.x, y: center.y + 1 },
    { x: center.x, y: center.y - 1 },
  ];
}

function inCells(pos: Vec2, cells: Vec2[]): boolean {
  return cells.some((c) => c.x === pos.x && c.y === pos.y);
}

// п18.2 (рішення власника «А. Сам на броні», ADR-0154): заряд стрільця витрачається
// першою атакою (постріл будь-яким режимом чи «Точний постріл») по цілі з бронею —
// уся атака, і черга, без броні; по цілі без броні заряд лишається. Дозор заряду не бере.
// RNG не викликається — порядок кидків той самий.
function useCharge(state: GameState, s: Unit, t: Unit): boolean {
  const items = state.items?.[s.id];
  if (!items?.charge || !(t.armor !== undefined && t.armor > 0)) return false;
  items.charge = false;
  state.log.push({ type: 'charge', shooterId: s.id, targetId: t.id }); // п18.5: подія для журналу бою (без RNG)
  return true;
}

// Витратники юніта в цьому бою (відсутній запис = предметів немає).
function unitItems(state: GameState, unitId: string): UnitItems | undefined {
  return state.items?.[unitId];
}

export interface HealResult {
  healed: number; // фактично відновлені HP (з капом maxHp)
}

// «Лікування» (аптечка, ADR-0058): 4 AP, +3 HP не вище maxHp, ціль — соба або
// союзник на відстані ≤1 (Чебишев). Витратник один на місію — списується при
// використанні. Ціль без поранення — помилка (без марнотратства аптечки;
// кандидат П11.8). Порядок перевірок фіксований (детермінізм, ADR-0003).
export function useMedkit(state: GameState, healerId: string, targetId: string): HealResult {
  const u = getUnit(state, healerId);
  requireActive(state, u);
  const items = unitItems(state, u.id);
  if (!items?.medkit) throw new Error('Гелю немає у юніта: ' + u.id);
  if (u.ap < HEAL_AP_COST) throw new Error('Недостатньо очок дій для лікування');
  const t = getUnit(state, targetId);
  if (!t.alive) throw new Error('Ціль уже мертва');
  if (t.side !== u.side) throw new Error('Лікування можливе лише по своїх');
  if (distance(u.pos, t.pos) > 1) throw new Error('Ціль поза межами лікування (відстань ≤1)');
  if (t.hp >= t.maxHp) throw new Error('Ціль не поранена');
  const healed = Math.min(HEAL_AMOUNT, t.maxHp - t.hp);
  t.hp += healed;
  u.ap -= HEAL_AP_COST;
  items.medkit = false; // витратник списується (по одній на місію, ADR-0058)
  state.log.push({ type: 'heal', unitId: u.id, targetId: t.id, healed });
  return { healed };
}

export interface GrenadeResult {
  damage: number; // пошкодження зони (однакове для всіх уражених)
  affected: string[]; // id уражених у порядку масиву юнітів (детермінізм)
}

// «Кидок гранати» (ADR-0058): 4 AP, дальність ≤6 (Чебишев), LOS до епіцентру
// за рельєфом (ADR-0006). Дальність 6 менша за радіус огляду 12 (map.ts), тож
// епіцентр із чистою лінією — видима кидачу клітинка (вимога ADR-0058).
// Пошкодження 3–5 (RNG бою): ОДИН кидок RNG на вибух — однакове пошкодження
// всієї зони (епіцентр + хрест), незалежно від кількості уражених (число —
// кандидат П11.8). Friendly fire: уражаються всі юніти в зоні, включно зі
// своїми (свідома тактична ціна, ADR-0058); за смерть союзника kills не
// ростуть. Порядок уражених — порядок масиву юнітів (детермінізм, ADR-0003).
export function throwGrenade(state: GameState, throwerId: string, center: Vec2): GrenadeResult {
  const u = getUnit(state, throwerId);
  requireActive(state, u);
  const items = unitItems(state, u.id);
  if (!items?.grenade) throw new Error('Гранати немає у юніта: ' + u.id);
  if (u.ap < GRENADE_AP_COST) throw new Error('Недостатньо очок дій для кидка');
  if (!isInside(state.map, center)) throw new Error('Епіцентр за межами мапи');
  if (distance(u.pos, center) > GRENADE_RANGE) throw new Error('Епіцентр поза дальністю кидка');
  if (!hasTerrainLine(state, u.pos, center)) throw new Error('Немає лінії кидка');
  const zone = grenadeZone(center);
  const affected = state.units.filter((t) => t.alive && inCells(t.pos, zone));
  // один кидок RNG на вибух — споживання rng не залежить від зони (детермінізм)
  const dmin = GRENADE_DAMAGE[0];
  const dmax = GRENADE_DAMAGE[1];
  const damage = dmin + Math.floor(state.rng() * (dmax - dmin + 1));
  const hits: { unitId: string; damage: number }[] = [];
  for (const t of affected) {
    t.hp -= damage;
    if (t.hp <= 0) {
      t.hp = 0;
      t.alive = false;
      if (t.side !== u.side) u.kills += 1; // friendly fire у kills не зараховується
      state.log.push({ type: 'death', unitId: t.id, killerId: u.id });
    }
    hits.push({ unitId: t.id, damage });
  }
  u.ap -= GRENADE_AP_COST;
  items.grenade = false; // витратник списується (по одній на місію, ADR-0058)
  state.log.push({ type: 'grenade', unitId: u.id, center: { ...center }, hits });
  return { damage, affected: affected.map((t) => t.id) };
}

// --- П15.2 (ADR-0075): евакуація з місії ---

export interface EvacuateResult {
  unit: Unit; // евакуйований солдат (той самий об'єкт — стан ростеру збережено)
}

// «Евакуація» (ADR-0075): активний солдат у клітинці зони висадки (evacZone),
// 2 AP, будь-який момент ходу гравця. Успіх: солдат знімається з поля
// (вилучається з units) і потрапляє у список evacuated стану бою; подія
// evac_unit у лог (одна на солдата). Евакуйований поза боєм: не ціль ШІ,
// пострілів, гранат, дозору й реакційного вогню — його немає в units;
// сама дія — не рух, реакційного вогню не провокує (triggerOverwatch не викликається).
// Відхилення (EARS 2): поза зоною висадки або <2 AP → throw з причиною.
// Порядок перевірок фіксований (детермінізм, ADR-0003): бік → зона → AP.
// RNG не витягається (ADR-0003/0075): geo.rng і бойовий потік не змінюються.
export function evacuate(state: GameState, unitId: string): EvacuateResult {
  const u = getUnit(state, unitId);
  requireActive(state, u);
  if (u.side !== 'player') throw new Error('Евакуюватись можуть лише оперативники гравця');
  const zone = state.evacZone;
  if (!zone?.some((c) => c.x === u.pos.x && c.y === u.pos.y)) {
    throw new Error('Евакуація доступна лише з клітинки зони висадки');
  }
  if (u.ap < EVAC_AP_COST) throw new Error('Недостатньо очок дій для евакуації');
  u.ap -= EVAC_AP_COST;
  u.overwatch = false; // з поля знятий — дозор не актуальний
  state.units = state.units.filter((x) => x.id !== unitId);
  (state.evacuated ??= []).push(u);
  state.log.push({ type: 'evac_unit', unitId: u.id });
  return { unit: u };
}

// --- п16.3 (ADR-0147 п. 3, 11): дії ролей раз за бій ---

const ROLE_NAMES: Record<BattleRole, string> = { assault: 'штурмовик', sniper: 'снайпер', medic: 'медик' };
const ROLE_ACTION_NAMES: Record<BattleRole, string> = {
  assault: '«Ривок»',
  sniper: '«Точний постріл»',
  medic: '«Польова допомога»',
};
const ROLE_AP_COST: Record<BattleRole, number> = { assault: 0, sniper: PRECISE_AP_COST, medic: FIELD_AID_AP_COST };

// Чому дія ролі юніта недоступна без огляду цілі (null — доступна): немає ролі,
// роль інша, вже використано, юніта немає на полі, загинув, не його хід, бракує AP.
// Для плитки UI (п16.4) і бота; ціль перевіряє сама дія — команда без цілі
// відмовляє рівно з цим текстом. Не кидає — читає стан.
export function roleActionBlock(state: GameState, unitId: string, role: BattleRole): string | null {
  const slot = state.roles?.[unitId];
  if (!slot) return 'Немає ролі: дія ' + ROLE_ACTION_NAMES[role] + ' недоступна';
  if (slot.role !== role) return ROLE_ACTION_NAMES[role] + ' — дія ролі ' + ROLE_NAMES[role] + 'а';
  if (slot.used) return ROLE_ACTION_NAMES[role] + ' вже використано в цьому бою';
  const u = state.units.find((x) => x.id === unitId);
  if (!u) return 'Оперативника немає на полі бою'; // евакуйований (ADR-0075)
  if (!u.alive) return 'Оперативник загинув';
  if (u.side !== state.activeSide) return 'Зараз хід демонів Розриву';
  // п20.4 (рішення власника «А. Вимкнена з причиною», ADR-0168): «Точний постріл» — прицільний режим зброї
  if (role === 'sniper' && !weaponHasMode(u.weapon, 'aimed'))
    return ROLE_ACTION_NAMES[role] + ': зброя «' + u.weapon.name + '» не має прицільного режиму';
  if (u.ap < ROLE_AP_COST[role]) return 'Недостатньо очок дій: ' + ROLE_ACTION_NAMES[role] + ' — ' + ROLE_AP_COST[role] + ' AP';
  return null;
}

// Спільні перевірки дії ролі — roleActionBlock (роль, прапорець, поле, хід, AP)
// до пошуку юніта: відмова — з тим самим текстом, що на плитці. Порядок
// фіксований (детермінізм, ADR-0003); стан не змінюється до кінця перевірок.
function requireRole(state: GameState, unitId: string, role: BattleRole): { u: Unit; slot: UnitRole } {
  const reason = roleActionBlock(state, unitId, role);
  if (reason !== null) throw new Error(reason);
  return { u: getUnit(state, unitId), slot: state.roles![unitId] };
}

// п22.2: числа дії ролі за спеціалізацією — для ядра і підказок UI (без спеціалізації — як до п22.2).
export function dashBonus(spec?: RoleSpec): number {
  return spec === 'breakthrough' ? BREAKTHROUGH_DASH_BONUS : DASH_AP_BONUS;
}
export function preciseMult(spec?: RoleSpec): number {
  return spec === 'hunter' ? HUNTER_DAMAGE_MULT : PRECISE_DAMAGE_MULT;
}
export function aidAmount(spec?: RoleSpec): number {
  return spec === 'surgeon' ? SURGEON_AID_AMOUNT : FIELD_AID_AMOUNT;
}

// Використання дії ролі: «Рятівник» спершу витрачає додаткові використання (п22.2).
function spendRole(slot: UnitRole): void {
  if (slot.extraUses !== undefined && slot.extraUses > 0) slot.extraUses -= 1;
  else slot.used = true;
}

export interface DashResult {
  ap: number; // AP юніта після ривка
}

// «Ривок» штурмовика (ADR-0147 п. 3): +4 AP цього ходу, сам коштує 0 AP;
// AP може перевищити максимум — наступний хід відновлює maxAp (endTurn).
export function useDash(state: GameState, unitId: string): DashResult {
  const { u, slot } = requireRole(state, unitId, 'assault');
  const bonus = dashBonus(slot.spec);
  u.ap += bonus;
  spendRole(slot);
  state.log.push({ type: 'dash', unitId: u.id, bonus });
  return { ap: u.ap };
}

// «Точний постріл» снайпера (ADR-0147 п. 3, 11): 6 AP, один постріл з
// модифікатором прицільного режиму (точність, дальність і лінія вогню — як у
// aimed), шкода ×1,5 з округленням униз. Подія precise_shot — перед shot
// (при вбивстві — precise_shot, death, shot).
export function preciseShot(state: GameState, shooterId: string, targetId: string): AttackResult {
  const { u: s, slot } = requireRole(state, shooterId, 'sniper');
  const t = getUnit(state, targetId);
  assertCanFire(state, s, t, 'aimed');
  s.ap -= PRECISE_AP_COST;
  spendRole(slot);
  const mult = preciseMult(slot.spec);
  state.log.push({ type: 'precise_shot', shooterId: s.id, targetId: t.id });
  const pierce = useCharge(state, s, t);
  const shot = fireOnce(state, s, t, 'aimed', calculateHitChance(s, 'aimed', shotCover(state, s, t)), mult, pierce);
  return { shots: [shot], targetDown: !t.alive };
}

// «Польова допомога» медика (ADR-0147 п. 3, 11): 2 AP, +3 HP не вище maxHp
// без гелю; ціль і сусідство — за правилом гелю (useMedkit): сам медик або
// свій на відстані ≤1 (Чебишев), лише поранений.
export function fieldAid(state: GameState, medicId: string, targetId: string): HealResult {
  const { u, slot } = requireRole(state, medicId, 'medic');
  const t = getUnit(state, targetId);
  if (!t.alive) throw new Error('Ціль уже мертва');
  if (t.side !== u.side) throw new Error('Допомога можлива лише своїм');
  if (distance(u.pos, t.pos) > 1) throw new Error('Ціль поза межами допомоги (відстань ≤1)');
  if (t.hp >= t.maxHp) throw new Error('Ціль не поранена');
  const healed = Math.min(aidAmount(slot.spec), t.maxHp - t.hp);
  t.hp += healed;
  u.ap -= FIELD_AID_AP_COST;
  spendRole(slot);
  state.log.push({ type: 'field_aid', unitId: u.id, targetId: t.id, healed });
  return { healed };
}
