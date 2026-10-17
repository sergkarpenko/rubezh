// src/core/economy.ts
// Фаза 4 (П4.2): економіка партії — баланс, надходження, витрати.
// ADR-0002: Чисте ядро логіки без DOM/Canvas
// ADR-0003: Детермінізм — жодного RNG: усі надходження детерміновані
// ADR-0021: Економіка: гроші, найм, лікарня, банкрутство
//
// Гроші — окремий стан партії (EconomyState) поруч із GeoState і Roster
// (патерн ізоляції ADR-0008): geo.ts нічого не знає про економіку; economy.ts
// читає лише час геосцени (geoDay) і не витягує geo.rng — траєкторія
// геосцени не залежить від грошей. Цикл шару застосунку (П4.5):
//   geoTick(geo) → economyTick(econ, geo) — на кожен тік геосцени;
//   після перемоги в місії — creditMissionBonus(econ, briefing.kind);
//   найм (П4.3, squad.ts) — spend(econ, HIRE_PRICE).
// Дотація нараховується за кожну ЗАВЕРШЕНУ добу (межа дня: geoDay зріс);
// премія — за тип НЛО лише за перемогу; списання — лише при достатку.

import { geoDay, type GeoState, type UfoKind } from './geo';
import { type DifficultyPreset, DEFAULT_PRESET, DIFFICULTY_MULTIPLIERS } from './campaign';

export const START_MONEY = 300; // стартовий баланс партії (ADR-0021)
export const DAILY_ALLOWANCE = 75; // дотація за завершену добу геосцени (П8.6: 100 → 75)
export const HIRE_PRICE = 100; // базова ціна найму одного солдата (ADR-0021)

// П11.8 (тунінг за симуляціями, docs/reports/p11.8-tuning.md): ціна найму
// солдата синхронізована з economyMultiplier пресету (ADR-0058 «множники
// діють лише на коштовність»; досі flat 100 — виняток із часів П4.3).
// Вердикт власника 2026-10-18: комбо-B probe-гріду — «легкий» 120, «норма»
// 100, «складний» 90. Дефолт «норма» — старі виклики без змін траєкторій.
export function hirePrice(preset: DifficultyPreset = DEFAULT_PRESET): number {
  return Math.round(HIRE_PRICE * DIFFICULTY_MULTIPLIERS[preset].economyMultiplier);
}

// Премія за перемогу в місії за тип НЛО (ADR-0021): важча ціль — більша премія.
// П8.6 (тунінг за симуляціями, docs/reports/p8.6-tuning.md): премії знижено — у базовій
// лінії П8.5 дохід стабільно перевищував витрати (крива грошей монотонно зростала,
// «норма» 4649 на Д30). Нижчі премії роблять поразки відчутними (нуль премії при
// живих витратах на найм) — банкрутство настає при серії невдач, а не лише на старті.
export const MISSION_BONUS: Record<UfoKind, number> = {
  розвідник: 110,
  збирач: 170,
};
// П7.6 (ADR-0032): премія за збиття НЛО у повітрі перехопленням — окрема стаття доходу,
// поверх премії за тактичну місію на місці падіння. П8.6: піднято (75/150 → 125/210) —
// кожне збиття відчутніше винагороджується; перехоплення лишається мінорною, але
// прибутковою статтєю (запусків ~2.8 за 30 діб — геометрія радара, geo.ts).
export const SHOT_DOWN_BONUS: Record<UfoKind, number> = {
  розвідник: 125,
  збирач: 210,
};

export type EconomyEvent =
  | { type: 'allowance'; day: number; amount: number }
  | { type: 'mission_bonus'; kind: UfoKind; amount: number }
  | { type: 'shot_down_bonus'; kind: UfoKind; amount: number }
  | { type: 'spend'; amount: number };

export interface EconomyState {
  money: number;
  lastAllowanceDay: number; // остання доба, за яку дотацію вже нараховано
  log: EconomyEvent[]; // надходження/витрати для панелі фінансів (П4.5)
}

export function createEconomy(preset: DifficultyPreset = DEFAULT_PRESET): EconomyState {
  const multipliers = DIFFICULTY_MULTIPLIERS[preset];
  return {
    money: Math.round(START_MONEY * multipliers.economyMultiplier),
    lastAllowanceDay: 0,
    log: [],
  };
}

// Тік економіки разом із геосценою: нарахувати дотацію за кожну добу,
// що завершилась з моменту останнього нарахування. День N завершено,
// коли geoDay(geo) > N (доба = 48 тіків). Повторний виклик без нових
// завершених діб — no-op (захист від подвійного нарахування).
export function economyTick(state: EconomyState, geo: GeoState, preset: DifficultyPreset = DEFAULT_PRESET): void {
  const completedDays = geoDay(geo) - 1;
  const multipliers = DIFFICULTY_MULTIPLIERS[preset];
  const effectiveAllowance = Math.round(DAILY_ALLOWANCE * multipliers.economyMultiplier);
  while (state.lastAllowanceDay < completedDays) {
    state.lastAllowanceDay += 1;
    state.money += effectiveAllowance;
    state.log.push({ type: 'allowance', day: state.lastAllowanceDay, amount: effectiveAllowance });
  }
}

// Премія за перемогу в місії за тип НЛО (поразка премії не дає — ADR-0021).
// Викликає шар застосунку один раз після mission_won; тип — із briefing.kind.
export function creditMissionBonus(state: EconomyState, kind: UfoKind, preset: DifficultyPreset = DEFAULT_PRESET): void {
  const baseAmount = MISSION_BONUS[kind];
  const multipliers = DIFFICULTY_MULTIPLIERS[preset];
  const amount = Math.round(baseAmount * multipliers.economyMultiplier);
  state.money += amount;
  state.log.push({ type: 'mission_bonus', kind, amount });
}

// П7.6 (ADR-0032): премія за збиття НЛО у повітрі перехопленням — відрізняється від премії
// за тактичну місію (окрема стаття доходу, константи SHOT_DOWN_BONUS вище).
export function creditShotDownBonus(state: EconomyState, kind: UfoKind, preset: DifficultyPreset = DEFAULT_PRESET): void {
  const baseAmount = SHOT_DOWN_BONUS[kind];
  const multipliers = DIFFICULTY_MULTIPLIERS[preset];
  const amount = Math.round(baseAmount * multipliers.economyMultiplier);
  state.money += amount;
  state.log.push({ type: 'shot_down_bonus', kind, amount });
}

// Списати гроші (найм у П4.3; сума валідується — ціла і додатна).
// Грошей менше суми → помилка: банкрутство відстежує окрема умова (П4.4),
// але списання в мінус неможливе за визначенням.
export function spend(state: EconomyState, amount: number): void {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error('Сума витрат має бути цілим числом більше 0');
  }
  if (state.money < amount) {
    throw new Error('Недостатньо грошей: ' + state.money + ' < ' + amount);
  }
  state.money -= amount;
  state.log.push({ type: 'spend', amount });
}
