// src/core/mission.ts
// Ітерація 5.0: зв'язок шарів — тактична місія з приземленого виявленого НЛО.
// ADR-0002: Чисте ядро логіки без DOM/Canvas
// ADR-0008: Ростер загону — персистентність між місіями
// ADR-0009: Онлайн-превью через GitHub Pages
//
// Чиста логіка: геосцена (geo.ts) → тактичний бій (combat.ts), і назад:
// результат місії застосовується до геосцени. Жодних залежностей від DOM/Canvas.
//
// Дизайн (MVP):
// - Місію можна запустити лише з приземленого виявленого НЛО (missionTargets).
// - Час геосцени не тікає, поки триває бій: місія — «вирваний» тактичний раунд.
// - Бойовище детерміноване: сід місії = FNV-1a(ufoId + ':' + geo.minute).
//   geo.rng не витягається → траєкторія геосцени не залежить від запуску місії.
// - Мапа: makeTestMap, але з гарантією зв'язності (зони висадки (2,2) і НЛО (17,2)
//   завжди чисті, проте генератор не гарантує зв'язності): missionMap перебирає
//   сіди seed+0..N, доки всі точки висадки і НЛО не стануть досяжними з зони
//   висадки — інакше місію фізично неможливо виграти. Перший сід, що підійшов,
//   детермінований для даної місії.
// - Розвідник → 2 прибульці, збирач → 3 (баланс підбере ітерація 6).
// - Перемога = усі прибульці мертві → НЛО зникає з геосцени («зачищено»).
// - Поразка = увесь загін мертвий → НЛО лишається до кінця вікна; загін
//   втрачено (перма-смерть). Евакуація/відступ — не в MVP.
// - Загін передається ззовні; персистентний ростер між місіями — модуль
//   squad.ts (ітерація 5.2, ADR 0008). За замовчуванням — 3 нових солдати
//   (для точкових тестів без ростеру).

import {
  ALIEN_CUTTER,
  RIFLE,
  createGame,
  isInside,
  makeUnit,
  mulberry32,
  type GameMap,
  type GameState,
  type Unit,
  type Vec2,
} from './combat';
import { makeTestMap } from './map';
import { missionTargets, type GeoState, type Ufo, type UfoKind } from './geo';

export const MISSION_MAP_W = 20;
export const MISSION_MAP_H = 20;
// Зони висадки і НЛО збігаються з «чистими» зонами makeTestMap (3×3 навколо (2,2) і (17,2)).
export const SQUAD_SPAWN: Vec2[] = [
  { x: 2, y: 2 },
  { x: 3, y: 2 },
  { x: 2, y: 3 },
];
export const ALIEN_SPAWN: Vec2[] = [
  { x: 17, y: 2 },
  { x: 16, y: 2 },
  { x: 17, y: 3 },
];

export const ALIENS_PER_KIND: Record<UfoKind, number> = { розвідник: 2, збирач: 3 };
// Точність прибульців — за балансом 3.6 (.50/.45/.40), циклічно.
const ALIEN_ACCURACY = [0.5, 0.45, 0.4];

// Детермінований сід місії (FNV-1a) з ідентифікатора НЛО та хвилини запуску.
// Один і той самий хід гри → та сама мапа і той самий бойовий RNG.
export function missionSeed(geo: GeoState, ufoId: string): number {
  let h = 0x811c9dc5;
  const s = ufoId + ':' + geo.minute;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// BFS (4 напрямки): чи досяжні всі клітинки targets з from по вільних клітинках.
function reachable(map: GameMap, from: Vec2, targets: Vec2[]): boolean {
  const seen = new Set<string>([from.x + ',' + from.y]);
  const queue: Vec2[] = [from];
  while (queue.length > 0) {
    const p = queue.shift()!;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const n = { x: p.x + dx, y: p.y + dy };
      const k2 = n.x + ',' + n.y;
      if (!isInside(map, n) || map.blocked.has(k2) || seen.has(k2)) continue;
      seen.add(k2);
      queue.push(n);
    }
  }
  return targets.every((t) => seen.has(t.x + ',' + t.y));
}

const MAP_SEED_ATTEMPTS = 50;

// Бойовище місії: makeTestMap зі зв'язністю — усі точки висадки і НЛО
// досяжні з першої точки висадки (інакше місію неможливо виграти).
function missionMap(seed: number): GameMap {
  for (let i = 0; i < MAP_SEED_ATTEMPTS; i++) {
    const map = makeTestMap(seed + i, MISSION_MAP_W, MISSION_MAP_H);
    if (reachable(map, SQUAD_SPAWN[0], [...SQUAD_SPAWN.slice(1), ...ALIEN_SPAWN])) return map;
  }
  throw new Error('Не вдалося згенерувати зв’язне бойовище для місії');
}

// Стандартний солдат «Рубіжа» (10 HP, 10 AP, точність 0.6, «АР-14 Гарт»).
export function makeSoldier(id: string, name: string): Unit {
  return makeUnit({ id, side: 'player', name, pos: { x: 0, y: 0 }, firingAccuracy: 0.6, weapon: RIFLE });
}

export interface MissionBriefing {
  ufoId: string;
  kind: UfoKind;
  aliens: number; // прибульців на бойовищі
  minute: number; // хвилина геосцени на момент запуску
}

export interface Mission {
  briefing: MissionBriefing;
  state: GameState; // тактичний бій у термінах combat.ts
}

export interface CreateMissionOptions {
  squad?: Unit[]; // свій загін (максимум 3 — розмір зони висадки)
}

// Пошук цілі місії з валідацією: лише приземлений виявлений НЛО.
function findTarget(geo: GeoState, ufoId: string): Ufo {
  const ufo = missionTargets(geo).find((u) => u.id === ufoId);
  if (!ufo) throw new Error('Місію можна запустити лише з приземленого виявленого НЛО: ' + ufoId);
  return ufo;
}

// Створити тактичну місію з НЛО. Не змінює geo: геосцена «заморожена» на час бою.
export function createMission(geo: GeoState, ufoId: string, opts: CreateMissionOptions = {}): Mission {
  const ufo = findTarget(geo, ufoId);
  const seed = missionSeed(geo, ufoId);
  const map = missionMap(seed);
  const rng = mulberry32(seed);

  const squad = opts.squad ?? [makeSoldier('s1', 'Іван'), makeSoldier('s2', 'Олена'), makeSoldier('s3', 'Тарас')];
  if (squad.length === 0) throw new Error('Загін не може бути порожнім');
  if (squad.length > SQUAD_SPAWN.length) throw new Error('Максимум ' + SQUAD_SPAWN.length + ' солдатів у зоні висадки');
  for (const u of squad) {
    if (u.side !== 'player') throw new Error('У загині можуть бути лише солдати гравця: ' + u.id);
  }
  squad.forEach((u, i) => {
    u.pos = { ...SQUAD_SPAWN[i] };
  });

  const n = ALIENS_PER_KIND[ufo.kind];
  const aliens: Unit[] = [];
  for (let i = 0; i < n; i++) {
    aliens.push(
      makeUnit({
        id: 'a' + (i + 1),
        side: 'alien',
        name: 'Прибулець ' + (i + 1),
        pos: { ...ALIEN_SPAWN[i] },
        firingAccuracy: ALIEN_ACCURACY[i % ALIEN_ACCURACY.length],
        weapon: ALIEN_CUTTER,
      })
    );
  }

  const state = createGame({ map, units: [...squad, ...aliens], rng });
  return { briefing: { ufoId: ufo.id, kind: ufo.kind, aliens: n, minute: geo.minute }, state };
}

export type MissionOutcome = 'триває' | 'перемога' | 'поразка';

// Стан місії за бойовим станом: перемога перевіряється першою
// (останній постріл прибульця не буває «одночасним» із останнім пострілом солдата).
export function missionOutcome(state: GameState): MissionOutcome {
  const aliveAliens = state.units.filter((u) => u.side === 'alien' && u.alive).length;
  if (aliveAliens === 0) return 'перемога';
  const aliveSquad = state.units.filter((u) => u.side === 'player' && u.alive).length;
  if (aliveSquad === 0) return 'поразка';
  return 'триває';
}

// Застосувати завершену місію до геосцени (викликати один раз після бою).
// Перемога: НЛО зникає (зачищено). Поразка: НЛО лишається, вікно триває.
export function completeMission(geo: GeoState, ufoId: string, outcome: 'перемога' | 'поразка'): void {
  const ufo = geo.ufos.find((u) => u.id === ufoId);
  if (!ufo) throw new Error('Невідомий НЛО: ' + ufoId);
  if (outcome === 'перемога') {
    geo.ufos = geo.ufos.filter((u) => u.id !== ufoId);
    geo.log.push({ type: 'mission_won', ufoId, minute: geo.minute });
  } else {
    geo.log.push({ type: 'mission_lost', ufoId, minute: geo.minute });
  }
}
