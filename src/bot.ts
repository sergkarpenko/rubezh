// src/bot.ts
// Демо-бот гравця для онлайн-превью (UI-шар; не частина бойового ядра).
// ADR-0009: Онлайн-превью через GitHub Pages
// ADR-0010: Цільовий UI — ванільний TS + Canvas 2D
//
// Дзеркало ШІ прибульців 3.5 (src/core/ai.ts): найближча видима ціль → постріл
// (auto > aimed > snap за очікуваним пошкодженням); не можна — рух у бік цілі;
// цілей не видно — рух до зони НЛО (без резерву на дозор: демо має досягти
// швидкого контакту). Спільні примітиви — у src/core/ai-utils.ts (Фаза 2, П6),
// дублювання з ai.ts усунуто. Використовує лише публічне API ядра; туман
// війни чесний (visibleEnemies). Логіка перевірена в пісочниці: 12/12 боїв
// завершуються, детерміновано.

import { endTurn, moveUnit, resolveAttack, type GameState, type Unit } from './core/combat';
import { visibleEnemies } from './core/map';
import { bestPathToNeighbors, bestShootMode, nearestEnemy, pathToward } from './core/ai-utils';
import { aiStep } from './core/ai';
import { ALIEN_SPAWN, SQUAD_SPAWN, missionOutcome } from './core/mission';
// П7.6: бот-гравець перехоплення (ADR-0032) — публічне API ядра; детерміновані політики.
import { chebyshevWrap, createGeoGame, geoTick, type GeoState, type Ufo, type UfoKind } from './core/geo';
import { createEconomy, economyTick, type EconomyState } from './core/economy';
import {
  FIGHTER_MAX_HP,
  FIGHTER_REPAIR_COST,
  createIntercept,
  interceptRound,
  interceptTick,
  repairTick,
  startIntercept,
  startRepair,
  type InterceptState,
} from './core/intercept';

// Одна жадібна дія солдата: true — дія виконана (виконана дія завжди витрачає AP).
function soldierStep(state: GameState, u: Unit): boolean {
  if (!u.alive || u.ap <= 0) return false;
  const enemies = visibleEnemies(state, 'player');
  if (enemies.length === 0) {
    // Рух до зони НЛО (дзеркало patrolStep, але без резерву на дозор:
    // демо має досягти швидкого контакту).
    const step = bestPathToNeighbors(state, u, ALIEN_SPAWN, u.ap);
    if (step) {
      moveUnit(state, u.id, step);
      return true;
    }
    return false;
  }
  const target = nearestEnemy(u, enemies);
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
  return false;
}

// Хід гравця ботами: кожен живий солдат діє, доки є AP; потім кінець ходу.
// Повертає кількість дій. Викликати лише в хід гравця.
export function botTurn(state: GameState): number {
  if (state.activeSide !== 'player') throw new Error('botTurn: зараз не хід гравця');
  let actions = 0;
  for (const u of state.units.filter((x) => x.side === 'player' && x.alive)) {
    let guard = 0;
    while (u.alive && u.ap > 0 && guard++ < 60 && soldierStep(state, u)) actions++;
  }
  endTurn(state);
  return actions;
}

// Хід прибульців: цикл aiStep (patrol = зона висадки, як у MissionBattle 5.1.5)
// до завершення, потім кінець ходу. Повертає кількість дій.
export function aliensTurn(state: GameState): number {
  if (state.activeSide !== 'alien') throw new Error('aliensTurn: зараз не хід прибульців');
  let actions = 0;
  let guard = 0;
  while (guard++ < 60 && aiStep(state, SQUAD_SPAWN)) actions++;
  endTurn(state);
  return actions;
}

// Авто-бій до перемоги/поразки (для демо-превью). Повертає результат і кількість півходів.
export function autoBattle(state: GameState, maxHalfTurns = 240): { outcome: ReturnType<typeof missionOutcome>; halfTurns: number } {
  let halfTurns = 0;
  while (missionOutcome(state) === 'триває' && halfTurns < maxHalfTurns) {
    if (state.activeSide === 'player') botTurn(state);
    else aliensTurn(state);
    halfTurns++;
  }
  return { outcome: missionOutcome(state), halfTurns };
}

// П6.16: покроковий драйвер демо-бою — ті самі дії ядра, що й autoBattle,
// але по одній за виклик; паузи і анімації між діями вставляє викликаюч
// (main.ts). Послідовність викликів ядра ідентична autoBattle (розгортка
// циклів botTurn/aliensTurn) — лог бою байт-у-байт той самий (детермінізм,
// ADR-0003). Ядро не змінюється — це UI-шар демо-бота (ADR-0002).
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

// П7.6: політики бот-гравця для перехоплення НЛО (ADR-0032) — коли запускати винищувач
// і яку дистанцію тримати в повітряному бою. Використовують лише публічне API ядра
// (intercept.ts/geo.ts); жодного DOM. Детерміновані: рішення залежать лише від стану,
// кидки — окремий RNG перехоплення (ADR-0003).
export type InterceptPolicyRange = 'впритул' | 'середня' | 'далека';
export interface InterceptPolicy {
  name: string;
  // запускати перехоплення на даного НЛО (виявлений, «летить»)?
  shouldLaunch: (kind: UfoKind, dist: number) => boolean;
  // дистанція раунду залежно від типу НЛО та HP винищувача
  chooseRange: (kind: UfoKind, fighterHp: number) => InterceptPolicyRange;
}

// Агресивна політика: запуск на будь-який виявлений НЛО, завжди впритул.
export const AGGRESSIVE_POLICY: InterceptPolicy = {
  name: 'aggressive',
  shouldLaunch: () => true,
  chooseRange: () => 'впритул',
};

// Збалансована політика (MVP-стандарт, X-COM-стиль): запуск завжди; розвідник (3 HP) —
// впритул, збирач (5 HP) — середня, поки винищувач здоровий; пошкоджений (HP ≤ 2) —
// далека (безпека, ADR-0032: далека — безпечно, але шанси низькі).
export const BALANCED_POLICY: InterceptPolicy = {
  name: 'balanced',
  shouldLaunch: () => true,
  chooseRange: (kind, hp) => {
    if (hp <= 2) return 'далека';
    return kind === 'збирач' ? 'середня' : 'впритул';
  },
};

// Обережна політика: лише розвідники (дешевша ціль, нижчий ризик), дистанція серединна.
export const CAUTIOUS_POLICY: InterceptPolicy = {
  name: 'cautious',
  shouldLaunch: (kind) => kind === 'розвідник',
  chooseRange: (kind) => (kind === 'розвідник' ? 'середня' : 'далека'),
};

// Стратегія «пасивного очікування» для порівняння у симуляціях (не запускає перехоплення).
export const PASSIVE_POLICY: InterceptPolicy = {
  name: 'passive',
  shouldLaunch: () => false,
  chooseRange: () => 'далека',
};

// П7.6: результати однієї партії-симуляції перехоплень (дні геосцени).
export interface InterceptSimResult {
  seed: number;
  policy: string;
  launches: number;
  engagements: number;
  shotDown: number;
  damages: number; // бої, де винищувач отримав пошкодження (HP < max після бою)
  destroyedToZero: number; // бої, що завершилися HP винищувача = 0 (вимушене переривання)
  repairs: number;
  repairsWhenPoor: number; // бої з HP=0 без грошей на ремонт («запаркований» винищувач)
  repairSpent: number;
  bonusEarned: number; // премії за збиття у повітрі (SHOT_DOWN_BONUS)
  // Розріз за типом НЛО та дистанцією (П7.6: «шанс збиття за тип НЛО і дистанцію»)
  engagementsByKind: Record<UfoKind, number>;
  shotDownByKind: Record<UfoKind, number>;
  roundsByRange: Record<InterceptPolicyRange, number>;
  hitRoundsByRange: Record<InterceptPolicyRange, number>; // раунди з влучанням винищувача
  ticks: number;
}

// Один «хід» бот-гравця перехопленням: запуски за політикою, погоня, бій, ремонт.
// Викликати після кожного geoTick разом із interceptTick/repairTick (шар застосунку П7.5).
export function interceptBotStep(ic: InterceptState, geo: GeoState, econ: EconomyState, policy: InterceptPolicy): void {
  const f = ic.fighter;
  if (f.status === 'на базі' && f.hp === FIGHTER_MAX_HP) {
    const target = detectedFlyingUfo(geo);
    if (target && policy.shouldLaunch(target.kind, chebyshevWrap(geo.base, target.pos))) {
      startIntercept(ic, geo, target.id);
    }
  } else if (f.status === 'на базі' && f.hp < FIGHTER_MAX_HP && !f.repairTicksLeft) {
    // Пошкоджений без ремонту: платимо одразу, як лише є гроші (X-COM досвід, ADR-0021).
    if (econ.money >= FIGHTER_REPAIR_COST) startRepair(ic, geo, econ);
  } else if (f.status === 'бій' && ic.activeUfoId) {
    const ufo = geo.ufos.find((u) => u.id === ic.activeUfoId);
    if (ufo) interceptRound(ic, geo, policy.chooseRange(ufo.kind, f.hp), econ);
  }
}

function detectedFlyingUfo(geo: GeoState): Ufo | null {
  const list = geo.ufos.filter((u) => u.detected && u.status === 'летить');
  return list.length ? list[0] : null;
}

// П7.6: масивна симуляція перехоплень — днів × 48 тиків геосцени з бот-гравачем за політикою.
// Детермінована (ADR-0003): сід геосцени + сід перехоплення + детермінована політика.
// Використовує лише публічне API ядра; симуляції міряють баланс (критерії — workflow.md П7.6).
export function simulateInterceptCampaign(seed: number, policy: InterceptPolicy, days = 10): InterceptSimResult {
  const geo = createGeoGame({ seed, spawnChance: 0.06, maxUfos: 3 });
  const ic = createIntercept(seed ^ 0x9e3779b9);
  const econ = createEconomy();
  const res: InterceptSimResult = {
    seed,
    policy: policy.name,
    launches: 0,
    engagements: 0,
    shotDown: 0,
    damages: 0,
    destroyedToZero: 0,
    repairs: 0,
    repairsWhenPoor: 0,
    repairSpent: 0,
    bonusEarned: 0,
    engagementsByKind: { розвідник: 0, збирач: 0 },
    shotDownByKind: { розвідник: 0, збирач: 0 },
    roundsByRange: { впритул: 0, середня: 0, далека: 0 },
    hitRoundsByRange: { впритул: 0, середня: 0, далека: 0 },
    ticks: 0,
  };
  const ticks = days * 48;
  let prevStatus = ic.fighter.status;
  let econCursor = 0;
  for (let t = 0; t < ticks; t++) {
    const before = ic.log.length;
    interceptBotStep(ic, geo, econ, policy);
    interceptTick(ic, geo);
    repairTick(ic, geo);
    geoTick(geo);
    economyTick(econ, geo);
    for (const e of ic.log.slice(before)) {
      if (e.type === 'intercept_start') res.launches++;
      if (e.type === 'intercept_engage') {
        res.engagements++;
        const kind = geo.ufos.find((u) => u.id === e.ufoId)?.kind;
        if (kind) res.engagementsByKind[kind]++;
      }
      if (e.type === 'ufo_shot_down') {
        res.shotDown++;
        const kind = geo.ufos.find((u) => u.id === e.ufoId)?.kind;
        if (kind) res.shotDownByKind[kind]++;
      }
      if (e.type === 'intercept_round' && e.choice !== 'відступ') {
        res.roundsByRange[e.choice]++;
        if (e.fighterHit) res.hitRoundsByRange[e.choice]++;
      }
      if (e.type === 'intercept_aborted' && e.reason === 'fighter_damaged') {
        res.destroyedToZero++;
        if (econ.money < FIGHTER_REPAIR_COST) res.repairsWhenPoor++;
      }
      if (e.type === 'fighter_repair_start') res.repairs++;
    }
    for (const e of econ.log.slice(econCursor)) {
      if (e.type === 'spend' && e.amount === FIGHTER_REPAIR_COST) res.repairSpent += e.amount;
      if (e.type === 'shot_down_bonus') res.bonusEarned += e.amount;
    }
    econCursor = econ.log.length;
    if (ic.fighter.status === 'на базі' && prevStatus !== 'на базі' && ic.fighter.hp < FIGHTER_MAX_HP) {
      res.damages++;
    }
    prevStatus = ic.fighter.status;
    res.ticks = t + 1;
  }
  return res;
}
