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
export const DAILY_ALLOWANCE = 100; // дотація за завершену добу геосцени
export const HIRE_PRICE = 100; // ціна найму одного солдата (витрати — П4.3)

// Премія за перемогу в місії за тип НЛО (ADR-0021): важча ціль — більша премія.
export const MISSION_BONUS: Record<UfoKind, number> = {
  розвідник: 150,
  збирач: 250,
};
// П7.6 (ADR-0032): премія за збиття НЛО у повітрі перехопленням — окрема стаття доходу,
// поверх премії за тактичну місію на місці падіння. Затверджено симуляціями П7.6 (128 сідів,
// bot.ts): доплата покриває середній ремонт винищувача і робить перехоплення
// прибутковимшим за пасивне очікування, не роблячи винищувача невразимим.
export const SHOT_DOWN_BONUS: Record<UfoKind, number> = {
  розвідник: 75,
  збирач: 150,
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
