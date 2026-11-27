// src/core/regions.ts
// п19.2 (ADR-0159 п. 1–3, 9–12): чотири регіони мапи геосцени з довірою 0–100.
// Розклад — константа ядра (без RNG і без залежності від картини тла): west («Порт», п21.2) — стовпці 0–4,
// east («Промзона») — 12–15, north («Шпилі») — 5–11 × рядки 0–4 (з вузлом «Рубіж» (8, 4)), south («Нетрі») — 5–11 × рядки 5–8.
// Довіра змінюється подіями журналу геосцени від окремого курсора (як загроза, ADR-0155):
// відліт зонда без бою −30 (виявлений) / −15 (невиявлений), виграна місія +10 (не вище 100);
// збитий зонд не відлітає, програна місія й евакуація довіри не змінюють. Довіра 0 — регіон
// виходить назавжди (подія 'region_out' один раз), далі з подій не змінюється.
// ADR-0002: чисте ядро; ADR-0003: RNG не викликається — траєкторія геосцени незмінна.
// Назви регіонів і рядки журналу — рішення власника п19.2 (Т.205, кнопками).

import type { Vec2 } from './combat';
import { probeLeftKind, type GeoEvent } from './geo';

export type RegionId = 'west' | 'north' | 'east' | 'south';
export const REGION_IDS: readonly RegionId[] = ['west', 'north', 'east', 'south'];
// Рішення власника п21.1 (ADR-0175 п. 3) «А. Порт · Шпилі · Промзона · Нетрі» — райони мегаполіса;
// ідентифікатори й розклад — з п19.2 («А. Захід · Північ · Схід · Південь», ADR-0160).
export const REGION_NAMES: Record<RegionId, string> = { west: 'Порт', north: 'Шпилі', east: 'Промзона', south: 'Нетрі' };

export const TRUST_MAX = 100; // старт і стеля довіри регіону
export const TRUST_TOTAL_MAX = TRUST_MAX * REGION_IDS.length; // Σ довір за повної довіри — дотація як у v0.10.0
export const TRUST_PROBE_LEFT_DETECTED = -30; // виявлений зонд відлетів без бою
export const TRUST_PROBE_LEFT_UNDETECTED = -15; // невиявлений зонд відлетів без бою
export const TRUST_MISSION_WON = 10; // виграна місія в регіоні

function regionAtCell(x: number, y: number): RegionId {
  if (x <= 4) return 'west';
  if (x >= 12) return 'east';
  return y <= 4 ? 'north' : 'south';
}

// Розклад 16 × 9 — REGION_OF[y][x] (ADR-0159 п. 9). Розміри — власні числа, а не WORLD_W / WORLD_H:
// цикл імпортів regions.ts → geo.ts → campaign.ts → regions.ts — коли точка входу geo.ts, regions.ts
// обчислюється раніше за константи geo.ts (тест звіряє розміри з geo.ts).
export const REGION_GRID_W = 16;
export const REGION_GRID_H = 9;
export const REGION_OF: readonly (readonly RegionId[])[] = Array.from({ length: REGION_GRID_H }, (_, y) =>
  Array.from({ length: REGION_GRID_W }, (_, x) => regionAtCell(x, y))
);

export function regionOf(p: Vec2): RegionId {
  const row = REGION_OF[p.y];
  const id = row?.[p.x];
  if (id === undefined) throw new Error('Клітинка поза мапою: (' + p.x + ', ' + p.y + ')');
  return id;
}

export interface RegionState {
  trust: number; // 0–100
  out: boolean; // вийшов назавжди (довіра 0)
}
export type Regions = Record<RegionId, RegionState>;

export function createRegions(): Regions {
  return {
    west: { trust: TRUST_MAX, out: false },
    north: { trust: TRUST_MAX, out: false },
    east: { trust: TRUST_MAX, out: false },
    south: { trust: TRUST_MAX, out: false },
  };
}

// Σ довір — вхід дотації (ADR-0159 п. 12); регіон, що вийшов, має довіру 0.
export function totalTrust(regions: Regions): number {
  let sum = 0;
  for (const id of REGION_IDS) sum += regions[id].out ? 0 : regions[id].trust;
  return sum;
}

// Остання позиція зонда probeId у журналі до індексу i (ADR-0159 п. 10): рух, посадка, падіння,
// виявлення чи поява; подія 'probe_left' позиції не має. Немає — null.
export function probeLastPos(log: GeoEvent[], i: number, probeId: string): Vec2 | null {
  for (let j = i - 1; j >= 0; j--) {
    const e = log[j];
    if (!('probeId' in e) || e.probeId !== probeId) continue;
    if (e.type === 'probe_move') return e.to;
    if (e.type === 'probe_landed' || e.type === 'probe_shot_down' || e.type === 'probe_detected' || e.type === 'probe_spawned') {
      return e.pos;
    }
  }
  return null;
}

export interface TrustChange {
  region: RegionId;
  delta: number; // кандидат до меж 0..100
  reason: 'probe_left' | 'mission_won';
}

// Зміна довіри від однієї події журналу (ADR-0159 п. 11); решта подій — null.
export function trustDelta(log: GeoEvent[], i: number): TrustChange | null {
  const e = log[i];
  if (e.type !== 'probe_left' && e.type !== 'mission_won') return null;
  const pos = probeLastPos(log, i, e.probeId);
  if (pos === null) return null;
  if (e.type === 'mission_won') return { region: regionOf(pos), delta: TRUST_MISSION_WON, reason: 'mission_won' };
  const kind = probeLeftKind(log, i, e.probeId);
  if (kind === 'fought') return null; // відлетів після бою — не «без бою»
  return {
    region: regionOf(pos),
    delta: kind === 'detected' ? TRUST_PROBE_LEFT_DETECTED : TRUST_PROBE_LEFT_UNDETECTED,
    reason: 'probe_left',
  };
}

// Нові події журналу від курсора змінюють довіру; кожна фактична зміна — подія 'region_trust',
// довіра 0 — ще 'region_out' (один раз). Події, які пише сама функція, довіри не змінюють,
// курсор їх проходить. Повертає новий курсор.
export function regionsTick(regions: Regions, log: GeoEvent[], cursor: number, minute: number): number {
  let c = cursor;
  while (c < log.length) {
    const ch = trustDelta(log, c);
    c += 1;
    if (ch === null) continue;
    const r = regions[ch.region];
    if (r.out) continue; // вийшов назавжди — з подій не змінюється
    const trust = Math.max(0, Math.min(TRUST_MAX, r.trust + ch.delta));
    if (trust === r.trust) continue;
    const delta = trust - r.trust;
    r.trust = trust;
    log.push({ type: 'region_trust', region: ch.region, delta, trust, reason: ch.reason, minute });
    if (trust === 0) {
      r.out = true;
      log.push({ type: 'region_out', region: ch.region, minute });
    }
  }
  return c;
}
