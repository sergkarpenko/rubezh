
// src/core/geo.ts
// Ітерація 4.1: стратегічне ядро «Рубіж» — час, мапа світу, база, НЛО.
// ADR-0001: Цільова платформа — браузер
// ADR-0002: Чисте ядро логіки без DOM/Canvas
// ADR-0003: Детермінізм через ін'єктований RNG
// ADR-0006: Туман війни — лише рельєф (стратегічний шар)
// ADR-0007: Мінімалістична графіка
//
// Чиста логіка: жодних залежностей від DOM/Canvas. Уся випадковість — ін'єктований RNG.
// Світ — сітка WORLD_W×WORLD_H; горизонталь замкнена (куля): рух НЛО і радар
// рахують відстань через край по X (Чебишев), вертикаль — без замикання.
// Час: 1 тік = TICK_MINUTES хвилин; доба = 48 тіків.
// Життєвий цикл НЛО: з'явився → летить до випадкової цілі → приземлився на
// landingTicks тіків (вікно перехоплення / тактичної місії) → відлітає і зникає.
// Виявлення: НЛО в межах RADAR_RANGE від бази стає detected і лишається на
// звіті до зникнення (трекінг). Невиявлені НЛО живуть у стані, але гравцеві
// не показуються — туман стратегічного шару. Зв'язок із тактичним боєм —
// модуль mission.ts (ітерація 5.0); тут missionTargets() та події результату
// місії (mission_won / mission_lost записує mission.ts).

import { mulberry32, type RNG, type Vec2 } from './combat';

export const TICK_MINUTES = 30;            // 1 тік = 30 хвилин; доба = 48 тіків
export const WORLD_W = 16;
export const WORLD_H = 8;
export const RADAR_RANGE = 4;             // Чебишев, із замиканням по X
export const DEFAULT_SPAWN_CHANCE = 0.03;  // за тік ≈ 1.5 НЛО/добу (за симуляціями 20 сідів × 10 днів)
export const DEFAULT_MAX_UFOS = 3;

export type UfoKind = 'розвідник' | 'збирач';

interface KindProfile { moveEveryTicks: number; landingTicks: number }

export const UFO_KINDS: Record<UfoKind, KindProfile> = {
  'розвідник': { moveEveryTicks: 1, landingTicks: 8 },  // швидкий, коротке вікно (4 год)
  'збирач': { moveEveryTicks: 2, landingTicks: 16 },    // повільний, широке вікно (8 год)
};

export type UfoStatus = 'летить' | 'приземлився';

export interface Ufo {
  id: string;
  kind: UfoKind;
  pos: Vec2;
  target: Vec2;
  detected: boolean;
  status: UfoStatus;
  landedTicksLeft: number;
}

export type GeoEvent =
  | { type: 'ufo_spawned'; ufoId: string; kind: UfoKind; pos: Vec2; minute: number }
  | { type: 'ufo_move'; ufoId: string; from: Vec2; to: Vec2; minute: number }
  | { type: 'ufo_detected'; ufoId: string; pos: Vec2; minute: number }
  | { type: 'ufo_landed'; ufoId: string; pos: Vec2; minute: number }
  | { type: 'ufo_left'; ufoId: string; minute: number }
  | { type: 'day'; day: number; minute: number }
  // Ітерація 5.0 (записує модуль mission.ts):
  | { type: 'mission_won'; ufoId: string; minute: number }
  | { type: 'mission_lost'; ufoId: string; minute: number };

export interface GeoState {
  minute: number;     // хвилини від старту; 0 = 00:00 дня 1
  rng: RNG;
  base: Vec2;         // єдина база «Рубіж»
  ufos: Ufo[];        // усі НЛО, включно з невиявленими (туман: гравець бачить лише detected)
  log: GeoEvent[];
  spawnChance: number;
  maxUfos: number;
  nextId: number;
}

export interface GeoOptions {
  seed?: number;
  rng?: RNG;
  base?: Vec2;
  spawnChance?: number;
  maxUfos?: number;
}

export function createGeoGame(opts: GeoOptions = {}): GeoState {
  const base = opts.base ?? { x: Math.floor(WORLD_W / 2), y: Math.floor(WORLD_H / 2) };
  if (base.x < 0 || base.y < 0 || base.x >= WORLD_W || base.y >= WORLD_H) {
    throw new Error('База за межами мапи світу');
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

// Номер дня: 1..
export function geoDay(state: GeoState): number {
  return Math.floor(state.minute / 1440) + 1;
}

// Мітка часу для UI: "Д1 06:30"
export function geoClock(state: GeoState): string {
  const m = state.minute % 1440;
  const h = Math.floor(m / 60), mm = m % 60;
  return 'Д' + geoDay(state) + ' ' + String(h).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
}

// Чебишев із замиканням по X (куля по горизонталі).
export function chebyshevWrap(a: Vec2, b: Vec2): number {
  const dx = Math.abs(a.x - b.x);
  const dxw = Math.min(dx, WORLD_W - dx);
  return Math.max(dxw, Math.abs(a.y - b.y));
}

function randomCell(rng: RNG): Vec2 {
  return { x: Math.floor(rng() * WORLD_W), y: Math.floor(rng() * WORLD_H) };
}

// Крок НЛО до цілі: спершу по осі з більшою лишковою відстанню (з урахуванням краю по X).
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

// Один тік геосцени. Порядок фаз фіксований (детермінізм):
// час → спавн → рух/посадка/відліт → виявлення радаром.
export function geoTick(state: GeoState): void {
  state.minute += TICK_MINUTES;
  if (state.minute % 1440 === 0) {
    state.log.push({ type: 'day', day: geoDay(state), minute: state.minute });
  }

  // Фаза 1: спавн нового НЛО (якщо є місце і пощастило з шансом).
  if (state.ufos.length < state.maxUfos && state.rng() < state.spawnChance) {
    const kind: UfoKind = state.rng() < 0.7 ? 'розвідник' : 'збирач';
    const pos = randomCell(state.rng);
    const ufo: Ufo = {
      id: 'ufo' + state.nextId++,
      kind,
      pos,
      target: randomCell(state.rng),
      detected: false,
      status: 'летить',
      landedTicksLeft: UFO_KINDS[kind].landingTicks,
    };
    state.ufos.push(ufo);
    state.log.push({ type: 'ufo_spawned', ufoId: ufo.id, kind, pos: { ...pos }, minute: state.minute });
  }

  // Фаза 2: рух, посадка, відлік вікна, відліт.
  for (const ufo of [...state.ufos]) {
    if (ufo.status === 'летить') {
      const prof = UFO_KINDS[ufo.kind];
      if ((state.minute / TICK_MINUTES) % prof.moveEveryTicks !== 0) continue;
      // вже на місці (рідкісний випадок спавну в клітинці цілі) — одразу посадка
      if (ufo.pos.x === ufo.target.x && ufo.pos.y === ufo.target.y) {
        ufo.status = 'приземлився';
        state.log.push({ type: 'ufo_landed', ufoId: ufo.id, pos: { ...ufo.pos }, minute: state.minute });
        continue;
      }
      const from = { ...ufo.pos };
      ufo.pos = stepToward(ufo.pos, ufo.target);
      state.log.push({ type: 'ufo_move', ufoId: ufo.id, from, to: { ...ufo.pos }, minute: state.minute });
      if (ufo.pos.x === ufo.target.x && ufo.pos.y === ufo.target.y) {
        ufo.status = 'приземлився';
        state.log.push({ type: 'ufo_landed', ufoId: ufo.id, pos: { ...ufo.pos }, minute: state.minute });
      }
    } else {
      ufo.landedTicksLeft -= 1;
      if (ufo.landedTicksLeft <= 0) {
        state.ufos = state.ufos.filter(u => u !== ufo);
        state.log.push({ type: 'ufo_left', ufoId: ufo.id, minute: state.minute });
      }
    }
  }

  // Фаза 3: виявлення радаром бази (виявлений НЛО лишається на звіті — трекінг).
  for (const ufo of state.ufos) {
    if (!ufo.detected && chebyshevWrap(state.base, ufo.pos) <= RADAR_RANGE) {
      ufo.detected = true;
      state.log.push({ type: 'ufo_detected', ufoId: ufo.id, pos: { ...ufo.pos }, minute: state.minute });
    }
  }
}

export function advanceTime(state: GeoState, ticks: number): void {
  if (!Number.isInteger(ticks) || ticks < 0) {
    throw new Error("Кількість тіків має бути невід'ємним цілим");
  }
  for (let i = 0; i < ticks; i++) geoTick(state);
}

// НЛО, видимі гравцеві (туман стратегічного шару: лише виявлені радаром).
export function detectedUfos(state: GeoState): Ufo[] {
  return state.ufos.filter(u => u.detected);
}

// Приземлені виявлені НЛО — кандидати на тактичну місію (зв'язок шарів — ітерація 5).
export function missionTargets(state: GeoState): Ufo[] {
  return state.ufos.filter(u => u.detected && u.status === 'приземлився');
}
