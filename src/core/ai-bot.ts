// src/core/ai-bot.ts — демо-бот гравця для бою (пR.3, ADR-0038; П6.16).
// Чиста логіка рішень і покроковий драйвер демо-бою: жодного DOM/Canvas
// (ADR-0002) — паузи і анімації між діями вставляє шар відображення
// (src/ui/demo.ts). UI-інтеграція бота — не тут: модуль лише виконує дії ядра.
// П11.4 (ADR-0058): бот синхронізований з витратниками — лікування при
// пораненні (аптечка), граната при скупченні ворогів (grenadeTarget);
// без предметів логіка байт-у-байт незмінна (критерій 1 П11.4).
// п16.3 (ADR-0147 п. 12): дії ролей — допомога медика першою, точний постріл
// снайпера замість звичайного, ривок штурмовика, коли AP не вистачає на чергу;
// без ролей (state.roles немає) логіка байт-у-байт незмінна.
//
// Дзеркало ШІ прибульців 3.5 (src/core/ai.ts): найближча видима ціль → постріл
// (auto > aimed > snap за очікуваним пошкодженням); не можна — рух у бік цілі;
// цілей не видно — рух до зони НЛО (без резерву на дозор: демо має досягти
// швидкого контакту). Спільні примітиви — у src/core/ai-utils.ts (Фаза 2, П6),
// дублювання з ai.ts усунуто. Використовує лише публічне API ядра; туман
// війни чесний (visibleEnemies). Логіка перевірена в пісочниці: 12/12 боїв
// завершуються, детерміновано.

import {
  endTurn,
  moveUnit,
  resolveAttack,
  throwGrenade,
  useMedkit,
  evacuate,
  fieldAid,
  preciseShot,
  roleActionBlock,
  useDash,
  EVAC_AP_COST,
  GRENADE_RANGE,
  HEAL_AP_COST,
  GRENADE_AP_COST,
  distance,
  grenadeZone,
  hasTerrainLine,
  type GameState,
  type Unit,
  type Vec2,
} from './combat';
import { findPath, visibleEnemies } from './map';
import { bestPathToNeighbors, bestShootMode, nearestEnemy, pathToward } from './ai-utils';
import { aiStep } from './ai';
import { ALIEN_SPAWN, SQUAD_SPAWN, missionOutcome } from './mission';

// Т.76 (П15.5, ADR-0075): політика евакуації бота. Порожня політика
// (жодне поле не задане) і її відсутність — бот не евакуює: бої байт-у-байт
// як до Т.76. Умови читають лише те, що бачить гравець (живі на полі,
// видимі вороги, HP свого солдата) — туман війни чесний (ADR-0006).
export interface EvacPolicy {
  // Солдат із hp ≤ частки maxHp (0 < частка < 1) відступає сам; решта б'ється.
  woundedAtOrBelow?: number;
  // Живих солдатів на полі ≤ N → відступають усі.
  lastStanding?: number;
  // Видимих ворогів більше, ніж живих солдатів на полі → відступають усі.
  outnumbered?: boolean;
}

// Чи відступає солдат за політикою (порядок умов фіксований, без RNG).
function retreating(state: GameState, u: Unit, evac: EvacPolicy): boolean {
  const w = evac.woundedAtOrBelow;
  if (w !== undefined && u.hp <= u.maxHp * w) return true;
  const alive = state.units.filter((x) => x.side === 'player' && x.alive).length;
  if (evac.lastStanding !== undefined && alive <= evac.lastStanding) return true;
  if (evac.outnumbered && visibleEnemies(state, 'player').length > alive) return true;
  return false;
}

// Крок відступу: у зоні висадки — евакуація (2 AP); не в зоні — рух до
// найближчої вільної клітинки зони (рівна довжина — перша за порядком зони).
// true — дія виконана; false — у зоні, але AP замало (чекати наступного ходу);
// null — до зони шляху немає (солдат б'ється як звичайно).
function retreatStep(state: GameState, u: Unit): boolean | null {
  const zone = state.evacZone ?? [];
  if (zone.some((c) => c.x === u.pos.x && c.y === u.pos.y)) {
    if (u.ap < EVAC_AP_COST) return false;
    evacuate(state, u.id);
    return true;
  }
  let best: Vec2[] | null = null;
  for (const c of zone) {
    const p = findPath(state, u.pos, c);
    if (p && p.length > 0 && (best === null || p.length < best.length)) best = p;
  }
  if (!best) return null;
  moveUnit(state, u.id, best.slice(0, u.ap));
  return true;
}

// Одна жадібна дія солдата: true — дія виконана (виконана дія завжди витрачає AP).
// П11.4 (ADR-0058/0038): синхронізація з витратниками — лікування при пораненні
// (аптечка, собі), граната при скупченні ворогів (≥2 у зоні вибуху і жодного
// союзника — бот не платить дружнім вогнем). Рішення без RNG, порядок фіксований.
// Т.76: з політикою евакуації — відступ після аптечки (лікування першим).
function soldierStep(state: GameState, u: Unit, evac?: EvacPolicy): boolean {
  if (!u.alive || u.ap <= 0) return false;
  const aid = aidTarget(state, u);
  if (aid) {
    fieldAid(state, u.id, aid.id);
    return true;
  }
  const items = state.items?.[u.id];
  if (items?.medkit && u.hp < u.maxHp && u.ap >= HEAL_AP_COST) {
    useMedkit(state, u.id, u.id);
    return true;
  }
  if (evac && retreating(state, u, evac)) {
    const r = retreatStep(state, u);
    if (r !== null) return r;
  }
  const enemies = visibleEnemies(state, 'player');
  if (items?.grenade && u.ap >= GRENADE_AP_COST && enemies.length > 0) {
    const center = grenadeTarget(state, u, enemies);
    if (center) {
      throwGrenade(state, u.id, center);
      return true;
    }
  }
  if (enemies.length === 0) {
    if (u.turret) return false; // п18.4 (ADR-0156): турель нерухома — чекає ворога
    // Рух до зони НЛО (дзеркало patrolStep, але без резерву на дозор:
    // демо має досягти швидкого контакту). п18.4: у брамі зона ворогів — своя (state.enemyZone).
    const step = bestPathToNeighbors(state, u, state.enemyZone ?? ALIEN_SPAWN, u.ap);
    if (step) {
      moveUnit(state, u.id, step);
      return true;
    }
    return false;
  }
  const target = nearestEnemy(u, enemies);
  const mode = bestShootMode(state, u, target);
  if (mode && roleActionBlock(state, u.id, 'sniper') === null) {
    preciseShot(state, u.id, target.id); // дальність і лінія — ті самі, що в bestShootMode
    return true;
  }
  // Ривок: ворога видно, а на чергу AP бракує — +4 AP, далі звичайний вибір
  if (u.ap < u.weapon.modes.auto.apCost && roleActionBlock(state, u.id, 'assault') === null) {
    useDash(state, u.id);
    return true;
  }
  if (mode) {
    resolveAttack(state, u.id, target.id, mode);
    return true;
  }
  if (u.turret) return false; // п18.4: турель не підходить до цілі
  const step = pathToward(state, u, target);
  if (step) {
    moveUnit(state, u.id, step);
    return true;
  }
  return false;
}

// п16.3: ціль «Польової допомоги» для бота — медик із невикористаною дією,
// поранений свій на відстані ≤1 (зокрема сам медик): найбільша нестача HP,
// рівність — порядок масиву юнітів (детермінізм). null — допомога не потрібна.
function aidTarget(state: GameState, u: Unit): Unit | null {
  if (roleActionBlock(state, u.id, 'medic') !== null) return null;
  let best: Unit | null = null;
  for (const t of state.units) {
    if (!t.alive || t.side !== u.side || t.hp >= t.maxHp || distance(u.pos, t.pos) > 1) continue;
    if (best === null || t.maxHp - t.hp > best.maxHp - best.hp) best = t;
  }
  return best;
}

// Кращий епіцентр гранати для бота (П11.4, ADR-0058): позиція видимого ворога,
// у зоні вибуху (епіцентр + хрест) — ≥2 ворогів і жодного союзника
// (friendly fire — свідома тактична ціна гравця, бот її не платить);
// в дальності кидка і з чистою лінією від кидача. Перший за порядком
// масиву при рівності — детермінізм (ADR-0003, без RNG). null — кидок
// не вигідний.
function grenadeTarget(state: GameState, u: Unit, enemies: Unit[]): Vec2 | null {
  for (const e of enemies) {
    if (distance(u.pos, e.pos) > GRENADE_RANGE) continue;
    if (!hasTerrainLine(state, u.pos, e.pos)) continue; // п17.4: лінія кидка — лише рельєф, як у throwGrenade
    const zone = grenadeZone(e.pos);
    const inZone = (p: Vec2) => zone.some((c) => c.x === p.x && c.y === p.y);
    const foes = enemies.filter((x) => x.alive && inZone(x.pos)).length;
    const allies = state.units.filter((x) => x.alive && x.side === u.side && inZone(x.pos)).length;
    if (foes >= 2 && allies === 0) return { ...e.pos };
  }
  return null;
}

// Хід гравця ботами: кожен живий солдат діє, доки є AP; потім кінець ходу.
// Повертає кількість дій. Викликати лише в хід гравця.
// Т.76: evac — політика евакуації (без неї бот не евакуює). Евакуйований
// зникає з units, але лишається в знімку циклу, і AP у нього ще є (евакуація
// знімає лише 2) — повторну дію зупиняє перевірка state.units.includes(u).
export function botTurn(state: GameState, evac?: EvacPolicy): number {
  if (state.activeSide !== 'player') throw new Error('botTurn: зараз не хід гравця');
  let actions = 0;
  for (const u of state.units.filter((x) => x.side === 'player' && x.alive)) {
    let guard = 0;
    while (u.alive && u.ap > 0 && guard++ < 60 && state.units.includes(u) && soldierStep(state, u, evac)) actions++;
  }
  endTurn(state);
  return actions;
}

// Хід прибульців: цикл aiStep (patrol = зона висадки, як у MissionBattle 5.1.5)
// до завершення, потім кінець ходу. Повертає кількість дій.
export function aliensTurn(state: GameState): number {
  if (state.activeSide !== 'alien') throw new Error('aliensTurn: зараз не хід демонів Розриву');
  let actions = 0;
  let guard = 0;
  while (guard++ < 60 && aiStep(state, SQUAD_SPAWN)) actions++;
  endTurn(state);
  return actions;
}

// Авто-бій до перемоги/поразки (для демо-прев'ю). Повертає результат і кількість півходів.
export function autoBattle(
  state: GameState,
  maxHalfTurns = 240,
  evac?: EvacPolicy
): { outcome: ReturnType<typeof missionOutcome>; halfTurns: number } {
  let halfTurns = 0;
  while (missionOutcome(state) === 'триває' && halfTurns < maxHalfTurns) {
    if (state.activeSide === 'player') botTurn(state, evac);
    else aliensTurn(state);
    halfTurns++;
  }
  return { outcome: missionOutcome(state), halfTurns };
}

// П6.16: покроковий драйвер демо-бою — ті самі дії ядра, що й autoBattle,
// але по одній за виклик; паузи і анімації між діями вставляє викликаюч
// (src/ui/demo.ts). Послідовність викликів ядра ідентична autoBattle (розгортка
// циклів botTurn/aliensTurn) — лог бою байт-у-байт той самий (детермінізм,
// ADR-0003). Ядро не змінюється — це логіка демо-бота над публічним API (ADR-0002).
export interface DemoStepResult {
  acted: boolean; // true — виконано рівно одну дію ботів
  over: boolean; // true — авто-бій завершено (результат або ліміт півходів)
}

export class DemoSteps {
  // Юніти півходу гравця фіксуються ОДИН раз на початку півходу — як у botTurn
  // (filter в botTurn обчислюється до циклу; живість перевіряється щоразу).
  private snapshot: Unit[] = [];
  private idx = 0; // позиція в snapshot поточного півходу
  private guard = 0; // спроби поточного юніта/півходу (ліміт 60, як у botTurn/aliensTurn)
  private halfTurns = 0;
  private inTurn = false;
  private over = false;

  constructor(private readonly maxHalfTurns = 240) {}

  get halfTurnsDone(): number {
    return this.halfTurns;
  }

  // Одна дія авто-бою. Викликати до over === true; після over — без дій.
  step(state: GameState): DemoStepResult {
    if (this.over) return { acted: false, over: true };
    if (!this.inTurn) {
      // autoBattle перевіряє результат ПЕРЕД кожним півходом — так само тут:
      // середині півходу вихід не даємо (розгортка циклу, байт-у-байт).
      if (missionOutcome(state) !== 'триває' || this.halfTurns >= this.maxHalfTurns) {
        this.over = true;
        return { acted: false, over: true };
      }
      this.inTurn = true;
      this.idx = 0;
      this.guard = 0;
      this.snapshot = state.activeSide === 'player' ? state.units.filter((x) => x.side === 'player' && x.alive) : [];
    }
    if (state.activeSide === 'player') {
      while (this.idx < this.snapshot.length) {
        const u = this.snapshot[this.idx];
        // Той самий порядок умов, що в while botTurn: живий → є AP → ліміт → дія
        if (u.alive && u.ap > 0 && this.guard++ < 60 && soldierStep(state, u)) {
          return { acted: true, over: false };
        }
        this.idx++;
        this.guard = 0;
      }
    } else {
      if (this.guard++ < 60 && aiStep(state, SQUAD_SPAWN)) {
        return { acted: true, over: false };
      }
    }
    endTurn(state); // півхід вичерпано — дзеркало кінцівки botTurn/aliensTurn
    this.halfTurns++;
    this.inTurn = false;
    this.snapshot = [];
    this.idx = 0;
    this.guard = 0;
    return { acted: false, over: false };
  }
}
