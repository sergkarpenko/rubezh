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
import { type DifficultyPreset, DEFAULT_PRESET, DIFFICULTY_MULTIPLIERS } from './campaign';
import type { RegionId } from './regions';

export const TICK_MINUTES = 30; // 1 тік = 30 хвилин; доба = 48 тіків
export const WORLD_W = 16;
// 9 рядків (рішення власника за фідбеком валідації П14.8): зона радара
// (RADAR_RANGE 4 від бази y=4) вписується у світ точно — візуальна розгортка
// радара на повному радіусі не обрізається нижнім краєм; сейви сумісні
// (позиції НЛО y≤7 валідні, формат — ADR-0026).
export const WORLD_H = 9;
export const RADAR_RANGE = 4; // Чебишев, із замиканням по X
export const DEFAULT_SPAWN_CHANCE = 0.03; // за тік ≈ 1.5 НЛО/добу (за симуляціями 20 сідів × 10 днів)
export const DEFAULT_MAX_PROBES = 3;

export type ProbeKind = 'розвідник' | 'збирач';

export interface KindProfile {
  moveEveryTicks: number;
  landingTicks: number;
}

export const PROBE_KINDS: Record<ProbeKind, KindProfile> = {
  розвідник: { moveEveryTicks: 1, landingTicks: 8 }, // швидкий, коротке вікно (4 год)
  збирач: { moveEveryTicks: 2, landingTicks: 16 }, // повільний, широке вікно (8 год)
};

export type ProbeStatus = 'летить' | 'приземлився' | 'збитий';

export interface Probe {
  id: string;
  kind: ProbeKind;
  pos: Vec2;
  target: Vec2;
  detected: boolean;
  status: ProbeStatus;
  landedTicksLeft: number;
}

export type GeoEvent =
  | { type: 'probe_spawned'; probeId: string; kind: ProbeKind; pos: Vec2; minute: number }
  | { type: 'probe_move'; probeId: string; from: Vec2; to: Vec2; minute: number }
  | { type: 'probe_detected'; probeId: string; pos: Vec2; minute: number }
  | { type: 'probe_landed'; probeId: string; pos: Vec2; minute: number }
  | { type: 'probe_left'; probeId: string; minute: number }
  | { type: 'day'; day: number; minute: number }
  // Ітерація 5.0 (записує модуль mission.ts):
  | { type: 'mission_won'; probeId: string; minute: number }
  | { type: 'mission_lost'; probeId: string; minute: number }
  // П15.2 (ADR-0075): третій результат місії — загін евакуйований
  // (НЛО лишається приземленим, премії немає); записує mission.ts.
  | { type: 'mission_evacuated'; probeId: string; minute: number }
  // П7.3 (ADR-0032): події перехоплення — в журналі геосцени (туман: події лише
  // про виявлені НЛО, бо запуск перехоплення можливий лише на виявлений).
  // Записує модуль intercept.ts; geoTick про винищувача не знає (ADR-0002/0032).
  // п19.3 (ADR-0161): поле fighter (id перехоплювача) — лише коли перехоплювачів два і більше,
  // region — ангар вильоту й повернення; fighter_assigned — перепризначення в інший ангар.
  | ((
      | { type: 'intercept_start'; probeId: string; pos: Vec2; minute: number }
      | { type: 'intercept_move'; from: Vec2; to: Vec2; minute: number }
      | { type: 'intercept_engage'; probeId: string; pos: Vec2; minute: number }
      | {
          type: 'intercept_round';
          round: number;
          choice: 'далека' | 'середня' | 'впритул' | 'відступ';
          fighterHit: boolean;
          fighterDamage: number;
          probeHit: boolean;
          probeDamage: number;
          minute: number;
        }
      | { type: 'intercept_break_off'; probeId: string; minute: number }
      | { type: 'intercept_aborted'; probeId: string; reason: 'probe_lost' | 'probe_landed' | 'fighter_damaged'; pos: Vec2; minute: number }
      | { type: 'probe_shot_down'; probeId: string; pos: Vec2; minute: number }
      | { type: 'fighter_returned'; pos: Vec2; minute: number }
      | { type: 'fighter_repair_start'; minute: number } // П7.4: ремонт оплачемо
      | { type: 'fighter_repair_done'; minute: number }
      | { type: 'fighter_assigned'; from: RegionId; to: RegionId; minute: number }
    ) & { fighter?: number; region?: RegionId })
  // П8.2 (ADR-0033): подію перемоги кампанії записує campaign.ts (п18.3: межі 30-ї доби немає — фінал п18.4);
  // geoTick про кампанію не знає (ADR-0002), а журнал — спільний для шарів.
  | { type: 'campaign_victory'; day: number; score: number; minute: number }
  // п18.3 (ADR-0153 п. 13): поразка партії — загроза досягла 100 (записує campaign.ts).
  | { type: 'campaign_defeat'; day: number; score: number; minute: number }
  // п18.4 (ADR-0153 п. 16–17, ADR-0156): штурм бази (поріг загрози), його результат і програний
  // фінал «Брама Розриву» (записують campaign.ts і assault.ts; +10 загрози — threatDelta).
  | { type: 'base_assault'; threshold: number; minute: number }
  | { type: 'assault_won'; minute: number }
  | { type: 'assault_lost'; money: number; minute: number }
  | { type: 'gate_lost'; minute: number }
  // п19.2 (ADR-0159 п. 11): зміна довіри регіону і вихід регіону (записує regions.ts з campaignTick).
  | { type: 'region_trust'; region: RegionId; delta: number; trust: number; reason: 'probe_left' | 'mission_won'; minute: number }
  | { type: 'region_out'; region: RegionId; minute: number };

// п19.2: як відлетів зонд probeId (подія з індексом i): виявлений чи ні без бою, або після бою
// (програна місія чи евакуація) — спільне правило загрози (ADR-0155) і довіри (ADR-0159 п. 11).
export function probeLeftKind(log: GeoEvent[], i: number, probeId: string): 'detected' | 'undetected' | 'fought' {
  let detected = false;
  for (let j = i - 1; j >= 0; j--) {
    const e = log[j];
    if (!('probeId' in e) || e.probeId !== probeId) continue;
    if (e.type === 'mission_lost' || e.type === 'mission_evacuated') return 'fought'; // зонд відлетів після бою
    if (e.type === 'probe_detected') detected = true;
    if (e.type === 'probe_spawned') break;
  }
  return detected ? 'detected' : 'undetected';
}

export interface GeoState {
  minute: number; // хвилини від старту; 0 = 00:00 дня 1
  rng: RNG;
  base: Vec2; // єдина база «Рубіж»
  probes: Probe[]; // усі НЛО, включно з невиявленими (туман: гравець бачить лише detected)
  log: GeoEvent[];
  spawnChance: number;
  maxProbes: number;
  nextId: number;
}

export interface GeoOptions {
  seed?: number;
  rng?: RNG;
  base?: Vec2;
  spawnChance?: number;
  maxProbes?: number;
  preset?: DifficultyPreset;
}

export function createGeoGame(opts: GeoOptions = {}): GeoState {
  const base = opts.base ?? { x: Math.floor(WORLD_W / 2), y: Math.floor(WORLD_H / 2) };
  if (base.x < 0 || base.y < 0 || base.x >= WORLD_W || base.y >= WORLD_H) {
    throw new Error('Вузол «Рубіж» за межами мапи');
  }
  const preset = opts.preset ?? DEFAULT_PRESET;
  const multipliers = DIFFICULTY_MULTIPLIERS[preset];
  return {
    minute: 0,
    rng: opts.rng ?? mulberry32(opts.seed ?? 42),
    base: { ...base },
    probes: [],
    log: [],
    spawnChance: (opts.spawnChance ?? DEFAULT_SPAWN_CHANCE) * multipliers.probeSpawnMultiplier,
    maxProbes: Math.round((opts.maxProbes ?? DEFAULT_MAX_PROBES) * multipliers.probeSpawnMultiplier),
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
  const h = Math.floor(m / 60),
    mm = m % 60;
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
// п18.2 (ADR-0153 п. 12): радіус радара — параметром (шар застосунку бере radarRange(research));
// типовий — RADAR_RANGE, тож траєкторія до «Пеленгу брами» байт-у-байт; geo.rng від радіуса не залежить.
export function geoTick(state: GeoState, radar: number = RADAR_RANGE): void {
  state.minute += TICK_MINUTES;
  if (state.minute % 1440 === 0) {
    state.log.push({ type: 'day', day: geoDay(state), minute: state.minute });
  }

  // Фаза 1: спавн нового НЛО (якщо є місце і пощастило з шансом). Збиті НЛО
  // ліміт не займають (Т.17, ADR-0086): вони чекають місії без строку.
  const airborne = state.probes.filter((u) => u.status !== 'збитий').length;
  if (airborne < state.maxProbes && state.rng() < state.spawnChance) {
    const kind: ProbeKind = state.rng() < 0.7 ? 'розвідник' : 'збирач';
    const pos = randomCell(state.rng);
    const probe: Probe = {
      id: 'probe' + state.nextId++,
      kind,
      pos,
      target: randomCell(state.rng),
      detected: false,
      status: 'летить',
      landedTicksLeft: PROBE_KINDS[kind].landingTicks,
    };
    state.probes.push(probe);
    state.log.push({ type: 'probe_spawned', probeId: probe.id, kind, pos: { ...pos }, minute: state.minute });
  }

  // Фаза 2: рух, посадка, відлік вікна, відліт.
  for (const probe of [...state.probes]) {
    if (probe.status === 'летить') {
      const prof = PROBE_KINDS[probe.kind];
      if ((state.minute / TICK_MINUTES) % prof.moveEveryTicks !== 0) continue;
      // вже на місці (рідкісний випадок спавну в клітинці цілі) — одразу посадка
      if (probe.pos.x === probe.target.x && probe.pos.y === probe.target.y) {
        probe.status = 'приземлився';
        state.log.push({ type: 'probe_landed', probeId: probe.id, pos: { ...probe.pos }, minute: state.minute });
        continue;
      }
      const from = { ...probe.pos };
      probe.pos = stepToward(probe.pos, probe.target);
      state.log.push({ type: 'probe_move', probeId: probe.id, from, to: { ...probe.pos }, minute: state.minute });
      if (probe.pos.x === probe.target.x && probe.pos.y === probe.target.y) {
        probe.status = 'приземлився';
        state.log.push({ type: 'probe_landed', probeId: probe.id, pos: { ...probe.pos }, minute: state.minute });
      }
    } else if (probe.status === 'приземлився') {
      probe.landedTicksLeft -= 1;
      if (probe.landedTicksLeft <= 0) {
        state.probes = state.probes.filter((u) => u !== probe);
        state.log.push({ type: 'probe_left', probeId: probe.id, minute: state.minute });
      }
    }
    // «збитий» (П7.3, ADR-0032): сидить на місці падіння як кандидат на тактичну
    // місію (missionTargets), не рухається і не зникає сам — лише після місії
    // (completeMission 'перемога' прибирає його з геосцени).
  }

  // Фаза 3: виявлення радаром бази (виявлений НЛО лишається на звіті — трекінг).
  for (const probe of state.probes) {
    if (!probe.detected && chebyshevWrap(state.base, probe.pos) <= radar) {
      probe.detected = true;
      state.log.push({ type: 'probe_detected', probeId: probe.id, pos: { ...probe.pos }, minute: state.minute });
    }
  }
}

export function advanceTime(state: GeoState, ticks: number, radar: number = RADAR_RANGE): void {
  if (!Number.isInteger(ticks) || ticks < 0) {
    throw new Error("Кількість тіків має бути невід'ємним цілим");
  }
  for (let i = 0; i < ticks; i++) geoTick(state, radar);
}

// НЛО, видимі гравцеві (туман стратегічного шару: лише виявлені радаром).
export function detectedProbes(state: GeoState): Probe[] {
  return state.probes.filter((u) => u.detected);
}

// Приземлені виявлені НЛО — кандидати на тактичну місію (зв'язок шарів — ітерація 5).
// П7.3 (ADR-0032): збиті перехопленням НЛО — теж кандидати (місія на місці падіння).
export function missionTargets(state: GeoState): Probe[] {
  return state.probes.filter((u) => u.detected && (u.status === 'приземлився' || u.status === 'збитий'));
}
