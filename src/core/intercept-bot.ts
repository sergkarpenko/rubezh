// src/core/intercept-bot.ts — бот-гравець перехоплення НЛО (пR.3, ADR-0038; П7.6, ADR-0032).
// Чиста логіка: політики запускання/дистанції, один «хід» бот-гравця і масивна
// симуляція перехоплень — жодного DOM/Canvas (ADR-0002). UI-інтеграція
// (зв'язування з ігровим циклом) — шар відображення/застосунку.
// Детерміновані (ADR-0003): рішення залежать лише від стану, кидки — окремий
// RNG перехоплення.

import { chebyshevWrap, createGeoGame, geoTick, type GeoState, type Ufo, type UfoKind } from './geo';
import { createEconomy, economyTick, type EconomyState } from './economy';
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
} from './intercept';

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

// Обережна політика: лише розвідники (дешевша ціль, нижчий ризик), дистанція середня.
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
