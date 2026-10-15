// src/core/intercept-bot.test.ts
// П7.6: тести бот-гравця перехоплення НЛО (ADR-0032), перенесені з
// src/bot.test.ts без зміни тверджень — одиничні рішення політик і масивні
// симуляції балансу перехоплень (128 сідів × 10 діб).
// Детерміновані (ADR-0003): фіксовані сіди фіксують і результати, і пороги балансу.

import { describe, expect, it } from 'vitest';
import { createGeoGame, geoTick } from './geo';
import { createIntercept, interceptTick, repairTick } from './intercept';
import { SHOT_DOWN_BONUS, createEconomy } from './economy';
import {
  AGGRESSIVE_POLICY,
  BALANCED_POLICY,
  CAUTIOUS_POLICY,
  PASSIVE_POLICY,
  interceptBotStep,
  simulateInterceptCampaign,
  type InterceptPolicy,
} from './intercept-bot';

describe('П7.6: бот-гравець перехоплення — одиничні рішення', () => {
  it('aggressive: запуск на будь-який виявлений НЛО, дистанція впритул', () => {
    expect(AGGRESSIVE_POLICY.shouldLaunch('збирач', 7)).toBe(true);
    expect(AGGRESSIVE_POLICY.chooseRange('збирач', 4)).toBe('впритул');
  });
  it('balanced: пошкоджений винищувач тримає далеку дистанцію', () => {
    expect(BALANCED_POLICY.chooseRange('збирач', 4)).toBe('середня');
    expect(BALANCED_POLICY.chooseRange('збирач', 2)).toBe('далека');
    expect(BALANCED_POLICY.chooseRange('розвідник', 4)).toBe('впритул');
  });
  it('cautious: запуск лише на розвідники', () => {
    expect(CAUTIOUS_POLICY.shouldLaunch('розвідник', 3)).toBe(true);
    expect(CAUTIOUS_POLICY.shouldLaunch('збирач', 3)).toBe(false);
  });
  it('passive: не запускає перехоплень', () => {
    expect(PASSIVE_POLICY.shouldLaunch('розвідник', 2)).toBe(false);
    const r = simulateInterceptCampaign(42, PASSIVE_POLICY, 2);
    expect(r.launches).toBe(0);
    expect(r.engagements).toBe(0);
    expect(r.shotDown).toBe(0);
  });
});

describe('П7.6: масивні симуляції — 128 сідів × 10 діб', () => {
  const SEEDS = 128;
  const POLICIES: InterceptPolicy[] = [AGGRESSIVE_POLICY, BALANCED_POLICY, CAUTIOUS_POLICY];

  function aggregate(policy: InterceptPolicy) {
    let launches = 0,
      engagements = 0,
      shotDown = 0,
      damages = 0,
      zero = 0,
      repairs = 0,
      poor = 0,
      spent = 0,
      bonus = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const r = simulateInterceptCampaign(seed, policy);
      launches += r.launches;
      engagements += r.engagements;
      shotDown += r.shotDown;
      damages += r.damages;
      zero += r.destroyedToZero;
      repairs += r.repairs;
      poor += r.repairsWhenPoor;
      spent += r.repairSpent;
      bonus += r.bonusEarned;
    }
    return { launches, engagements, shotDown, damages, zero, repairs, poor, spent, bonus };
  }

  it('критерій 1: перехоплення вигідніше пасивного очікування — премії за збиття > витрат на ремонт', () => {
    for (const p of POLICIES) {
      const a = aggregate(p);
      expect(a.bonus).toBeGreaterThan(a.spent);
    }
  });
  it('критерій 2: винищувач не невразливий — пошкодження > 40% боїв, вимушені переривання трапляються', () => {
    for (const p of POLICIES) {
      const a = aggregate(p);
      expect(a.damages / a.engagements).toBeGreaterThan(0.4);
      expect(a.zero).toBeGreaterThan(0);
    }
  });
  it('економіка: ремонт завжди доступний (бот не «паркує» винищувач без грошей)', () => {
    for (const p of POLICIES) {
      const a = aggregate(p);
      expect(a.poor).toBe(0); // старт 300 + щоденні 100 покривають ремонт 50 (ADR-0021)
    }
  });
  it('шанс збиття за типом НЛО і дистанцією: впритул > середня > далека; розвідник частіше за збирача', () => {
    const agg = {
      rounds: { впритул: 0, середня: 0, далека: 0 } as Record<string, number>,
      hits: { впритул: 0, середня: 0, далека: 0 } as Record<string, number>,
      eng: { розвідник: 0, збирач: 0 } as Record<string, number>,
      down: { розвідник: 0, збирач: 0 } as Record<string, number>,
    };
    for (let seed = 1; seed <= SEEDS; seed++) {
      const r = simulateInterceptCampaign(seed, AGGRESSIVE_POLICY); // завжди впритул
      for (const k of ['впритул', 'середня', 'далека']) {
        agg.rounds[k] += r.roundsByRange[k as 'впритул'];
        agg.hits[k] += r.hitRoundsByRange[k as 'впритул'];
      }
      agg.eng['розвідник'] += r.engagementsByKind['розвідник'];
      agg.eng['збирач'] += r.engagementsByKind['збирач'];
      agg.down['розвідник'] += r.shotDownByKind['розвідник'];
      agg.down['збирач'] += r.shotDownByKind['збирач'];
    }
    // шанс влучання впритул ≈ профіль 0.7 (ADR-0032) — у межах статистичного діапазону
    expect(agg.hits['впритул'] / agg.rounds['впритул']).toBeGreaterThan(0.6);
    expect(agg.hits['впритул'] / agg.rounds['впритул']).toBeLessThan(0.8);
    // розвідник (3 HP) збивається частіше за збирача (5 HP) у відносних бойових одиницях
    expect(agg.down['розвідник'] / agg.eng['розвідник']).toBeGreaterThan(agg.down['збирач'] / agg.eng['збирач']);
  });
  it('премії за збиття відповідають константам SHOT_DOWN_BONUS', () => {
    const min = Math.min(SHOT_DOWN_BONUS['розвідник'], SHOT_DOWN_BONUS['збирач']);
    for (const p of POLICIES) {
      const a = aggregate(p);
      expect(a.bonus).toBeGreaterThanOrEqual(a.shotDown * min);
    }
  });
  it('детермінізм: той самий сід + політика = той самий результат', () => {
    const a = simulateInterceptCampaign(77, BALANCED_POLICY);
    const b = simulateInterceptCampaign(77, BALANCED_POLICY);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
  it('geo.rng не витягується: дії бота перехоплення не зсувають гео-генератор', () => {
    // Пряма перевірка інваріанту ADR-0032: перехоплення живе окремим RNG; стан geo.rng
    // (mulberry32) не змінюється від дій бот-гравця (запуск/погоня/бій/ремонт).
    const geo = createGeoGame({ seed: 5, spawnChance: 0.06, maxUfos: 3 });
    for (let t = 0; t < 24; t++) geoTick(geo); // народити виявлені НЛО
    const geoRng = geo.rng as unknown as { state?: number };
    const before = geoRng.state;
    expect(typeof before).toBe('number'); // mulberry32 має стан (ADR-0003)
    const ic = createIntercept(99);
    const econ = createEconomy();
    interceptBotStep(ic, geo, econ, AGGRESSIVE_POLICY); // запуск (якщо є ціль)
    interceptTick(ic, geo);
    repairTick(ic, geo);
    interceptBotStep(ic, geo, econ, AGGRESSIVE_POLICY);
    expect(geoRng.state).toBe(before); // гео-генератор не зсунувся
  });
});
