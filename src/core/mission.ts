// src/core/mission.ts
// Ітерація 5.0: зв'язок шарів — тактична місія з приземленого виявленого НЛО.
// ADR-0002: Чисте ядро логіки без DOM/Canvas
// ADR-0008: Ростер загону — персистентність між місіями
// ADR-0009: Онлайн-прев'ю через GitHub Pages
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
// - Розвідник → 2 прибульці, збирач → 3 (баланс підбере ітерація 6); п17.2 (ADR-0149):
//   склад за загрозою кампанії (п18.3) — enemyMix(kindsForThreat(threat)), загроза < 8 — лише демони.
// - Перемога = усі прибульці мертві → НЛО зникає з геосцени («зачищено»).
// - Поразка = увесь загін мертвий → НЛО лишається до кінця вікна; загін
//   втрачено (перма-смерть). П15.2 (ADR-0075): третій результат «евакуйовано» —
//   живих на полі немає й ≥1 евакуйований: НЛО лишається (як при поразці),
//   премія не нараховується, врятовані — уцілілі (контур applyMissionResult).
// - Загін передається ззовні; персистентний ростер між місіями — модуль
//   squad.ts (ітерація 5.2, ADR 0008). За замовчуванням — 3 нових солдати
//   (для точкових тестів без ростеру).

import {
  RIFLE,
  createGame,
  isInside,
  makeUnit,
  mulberry32,
  type GameMap,
  type GameState,
  type Unit,
  type UnitItems,
  type UnitRole,
  type Vec2,
} from './combat';
import { makeTestMap } from './map';
import { missionTargets, type GeoState, type Ufo, type UfoKind } from './geo';
import { enemyMix, kindsForThreat, makeEnemies } from './enemies';

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

// Детермінований сід місії (FNV-1a) з ідентифікатора НЛО та хвилини запуску.
// Один і той самий хід гри → та сама мапа і той самий бойовий RNG.
export function missionSeed(geo: GeoState, ufoId: string): number {
  return textSeed(ufoId + ':' + geo.minute);
}

// FNV-1a рядка — сід бойовища (п18.4: штурм і брама беруть свій рядок, ADR-0156).
export function textSeed(s: string): number {
  let h = 0x811c9dc5;
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
// п18.4 (ADR-0156): розмір, зона ворогів і додаткова чиста зона (3 × 3 навколо clear) —
// параметрами для штурму бази і брами; типові — звичайна місія байт-у-байт.
export function connectedMap(
  seed: number,
  width = MISSION_MAP_W,
  height = MISSION_MAP_H,
  enemyZone: readonly Vec2[] = ALIEN_SPAWN,
  clear?: Vec2
): GameMap {
  for (let i = 0; i < MAP_SEED_ATTEMPTS; i++) {
    let map = makeTestMap(seed + i, width, height);
    if (clear) {
      const blocked = new Set(map.blocked);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) blocked.delete(clear.x + dx + ',' + (clear.y + dy));
      map = { ...map, blocked };
    }
    if (reachable(map, SQUAD_SPAWN[0], [...SQUAD_SPAWN.slice(1), ...enemyZone])) return map;
  }
  throw new Error('Не вдалося згенерувати зв’язне бойовище для місії');
}

// Стандартний солдат «Рубіжа» (10 HP, 10 AP, точність 0.6, «АР-14 Гарт»).
export function makeSoldier(id: string, name: string): Unit {
  return makeUnit({ id, side: 'player', name, pos: { x: 0, y: 0 }, firingAccuracy: 0.6, weapon: RIFLE });
}

// п18.4 (ADR-0156): бій кампанії без зонда — штурм бази або фінал «Брама Розриву»;
// без поля — звичайна місія з зонда.
export type MissionOp = 'штурм' | 'брама';

export interface MissionBriefing {
  ufoId: string; // п18.4: у штурмі й брамі — 'база' / 'брама' (зонда немає)
  kind: UfoKind; // п18.4: у штурмі й брамі — не має значення (премії немає)
  op?: MissionOp;
  aliens: number; // прибульців на бойовищі
  minute: number; // хвилина геосцени на момент запуску
}

export interface Mission {
  briefing: MissionBriefing;
  state: GameState; // тактичний бій у термінах combat.ts
}

export interface CreateMissionOptions {
  squad?: Unit[]; // свій загін (максимум 3 — розмір зони висадки)
  items?: Record<string, UnitItems>; // П11.4 (ADR-0058): витратники загону в бою (deployConsumables)
  roles?: Record<string, UnitRole>; // п16.3 (ADR-0147 п. 11): ролі загону в бою (deployRoles, squad.ts)
  // п18.3 (ADR-0153 п. 14): загроза кампанії — склад ворогів; без поля — 0 (лише демони).
  // Виклики застосунку, бота, дзеркала e2e і probe передають campaign.threat.
  threat?: number;
}

// Пошук цілі місії з валідацією: лише приземлений виявлений НЛО.
function findTarget(geo: GeoState, ufoId: string): Ufo {
  const ufo = missionTargets(geo).find((u) => u.id === ufoId);
  if (!ufo) throw new Error('Місію можна запустити лише з приземленого виявленого зонду Розриву: ' + ufoId);
  return ufo;
}

// Створити тактичну місію з НЛО. Не змінює geo: геосцена «заморожена» на час бою.
export function createMission(geo: GeoState, ufoId: string, opts: CreateMissionOptions = {}): Mission {
  const ufo = findTarget(geo, ufoId);
  const seed = missionSeed(geo, ufoId);
  const map = connectedMap(seed);
  const rng = mulberry32(seed);

  const squad = opts.squad ?? [makeSoldier('s1', 'Іван'), makeSoldier('s2', 'Олена'), makeSoldier('s3', 'Тарас')];
  if (squad.length === 0) throw new Error('Загін не може бути порожнім');
  if (squad.length > SQUAD_SPAWN.length) throw new Error('Максимум ' + SQUAD_SPAWN.length + ' оперативників у зоні висадки');
  for (const u of squad) {
    if (u.side !== 'player') throw new Error('У загині можуть бути лише оперативники гравця: ' + u.id);
  }
  squad.forEach((u, i) => {
    u.pos = { ...SQUAD_SPAWN[i] };
  });

  // п17.2 (ADR-0149 п. 8, 12): склад окремим генератором від сіду місії — бойовий RNG
  // не зсувається; п18.3 (ADR-0153 п. 14): доступні типи — за загрозою, а не за добою.
  // П12.6 (ADR-0064): «демон Розриву», не «прибулець».
  const n = ALIENS_PER_KIND[ufo.kind];
  const aliens: Unit[] = makeEnemies(enemyMix(kindsForThreat(opts.threat ?? 0), n, seed), ALIEN_SPAWN);

  const state = createGame({ map, units: [...squad, ...aliens], rng, items: opts.items, evacZone: SQUAD_SPAWN, roles: opts.roles });
  return { briefing: { ufoId: ufo.id, kind: ufo.kind, aliens: n, minute: geo.minute }, state };
}

export type MissionOutcome = 'триває' | 'перемога' | 'поразка' | 'евакуйовано';

// Стан місії за бойовим станом. Порядок перевірок фіксований (детермінізм):
// 1) перемога першою (рішення власника №5, П15.1: часткова евакуація +
//    останній солдат знищує всіх прибульців → ПЕРЕМОГА; евакуйовані — уцілілі);
// 2) живих на полі немає → розрізняємо за списком evacuated (евакуйований
//    вилучений з units, тож «порожнє» поле — ще не поразка): ≥1 евакуйований
//    = «евакуйовано», інакше — чинна «поразка» 5.0 без змін (EARS 3/4).
export function missionOutcome(state: GameState): MissionOutcome {
  const aliveAliens = state.units.filter((u) => u.side === 'alien' && u.alive).length;
  if (aliveAliens === 0) return 'перемога';
  const aliveSquad = state.units.filter((u) => u.side === 'player' && u.alive).length;
  if (aliveSquad === 0) return (state.evacuated?.length ?? 0) > 0 ? 'евакуйовано' : 'поразка';
  return 'триває';
}

// Застосувати завершену місію до геосцени (викликати один раз після бою).
// Перемога: НЛО зникає (зачищено). Поразка: НЛО лишається, вікно триває.
// П15.2 (ADR-0075) «евакуйовано»: НЛО лишається приземленим (вікно посадки
// тікає чинною логікою geo.ts), премія не нараховується (creditMissionBonus
// не викликається), місію можна повторити новим загоном (missionTargets
// без змін); подія mission_evacuated у журнал партії.
export function completeMission(geo: GeoState, ufoId: string, outcome: 'перемога' | 'поразка' | 'евакуйовано'): void {
  const ufo = geo.ufos.find((u) => u.id === ufoId);
  if (!ufo) throw new Error('Невідомий зонд Розриву: ' + ufoId);
  if (outcome === 'перемога') {
    geo.ufos = geo.ufos.filter((u) => u.id !== ufoId);
    geo.log.push({ type: 'mission_won', ufoId, minute: geo.minute });
  } else if (outcome === 'евакуйовано') {
    geo.log.push({ type: 'mission_evacuated', ufoId, minute: geo.minute });
  } else {
    geo.log.push({ type: 'mission_lost', ufoId, minute: geo.minute });
  }
}
