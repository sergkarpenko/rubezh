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

export const START_MONEY = 300; // стартовий баланс партії (ADR-0021)
export const DAILY_ALLOWANCE = 100; // дотація за завершену добу геосцени
export const HIRE_PRICE = 100; // ціна найму одного солдата (витрати — П4.3)

// Премія за перемогу в місії за тип НЛО (ADR-0021): важча ціль — більша премія.
export const MISSION_BONUS: Record<UfoKind, number> = {
  розвідник: 150,
  збирач: 250,
};

export type EconomyEvent =
  | { type: 'allowance'; day: number; amount: number }
  | { type: 'mission_bonus'; kind: UfoKind; amount: number }
  | { type: 'spend'; amount: number };

export interface EconomyState {
  money: number;
  lastAllowanceDay: number; // остання доба, за яку дотацію вже нараховано
  log: EconomyEvent[]; // надходження/витрати для панелі фінансів (П4.5)
}

export function createEconomy(): EconomyState {
  return { money: START_MONEY, lastAllowanceDay: 0, log: [] };
}

// Тік економіки разом із геосценою: нарахувати дотацію за кожну добу,
// що завершилась з моменту останнього нарахування. День N завершено,
// коли geoDay(geo) > N (доба = 48 тіків). Повторний виклик без нових
// завершених діб — no-op (захист від подвійного нарахування).
export function economyTick(state: EconomyState, geo: GeoState): void {
  const completedDays = geoDay(geo) - 1;
  while (state.lastAllowanceDay < completedDays) {
    state.lastAllowanceDay += 1;
    state.money += DAILY_ALLOWANCE;
    state.log.push({ type: 'allowance', day: state.lastAllowanceDay, amount: DAILY_ALLOWANCE });
  }
}

// Премія за перемогу в місії за тип НЛО (поразка премії не дає — ADR-0021).
// Викликає шар застосунку один раз після mission_won; тип — із briefing.kind.
export function creditMissionBonus(state: EconomyState, kind: UfoKind): void {
  const amount = MISSION_BONUS[kind];
  state.money += amount;
  state.log.push({ type: 'mission_bonus', kind, amount });
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
