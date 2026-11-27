// Т.218 (відгук власника 27.11.2026): HP юнітів після останньої пачки подій бою, перетвореної
// в анімації (`animsFromEvents`), — HP «до» наступної пачки. Ключ — стан бою: нова місія —
// новий стан, знімка ще немає (перша пачка відновлює HP назад від стану після неї).
import type { GameState } from '../core/combat';
import { hpSnapshot } from '../core/render-core';

const lastHp = new WeakMap<GameState, Map<string, number>>();

// Повертає знімок до пачки (або undefined) і запам'ятовує стан після неї.
export function takeHpBefore(state: GameState): Map<string, number> | undefined {
  const before = lastHp.get(state);
  lastHp.set(state, hpSnapshot(state.units));
  return before;
}
