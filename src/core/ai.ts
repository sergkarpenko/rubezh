// src/core/ai.ts
// Ітерація 3.5: прості ШІ-вороги для тактичного шару.
// ADR-0002: Чисте ядро логіки без DOM/Canvas
// ADR-0003: Детермінізм через ін'єктований RNG
// ADR-0005: Заступа (overwatch) — один постріл зі штрафом
// ADR-0006: Туман війни — лише рельєф
//
// 5.1.5: patrol-режим — якщо цілей не видно і задано зону патруля,
// прибульці наступають до неї (замість пасивної заступи); без patrol
// поведінка 3.5 без змін (BattleWidget 3.6 покладається саме на це).
// Жадібна поведінка: найближчий видимий ворог → постріл; якщо не можна — рух у бік цілі;
// якщо цілей не видно — заступа. ШІ не «читерить»: діє лише за visibleEnemies (туман війни).
// Один виклик aiStep = одна атомарна дія одного прибульця (постріл / рух / заступа) —
// зручно для покрокової анімації у віджеті. false = дій більше немає, хід можна завершувати.
//
// Фаза 2 (П6): спільні примітиви (bestShootMode, nearestEnemy, pathToward,
// bestPathToNeighbors) винесено в ai-utils.ts — ними користується і демо-бот
// гравця (src/bot.ts), дублювання логіки немає.

import { OVERWATCH_AP_COST, moveUnit, resolveAttack, setOverwatch, type GameState, type Vec2 } from './combat';
import { visibleEnemies } from './map';
import { bestPathToNeighbors, bestShootMode, nearestEnemy, pathToward } from './ai-utils';

// Один крок ШІ прибульців. Викликати в циклі, поки не поверне false.
// 5.1.5: patrol? — зона висадки гравця (загін у місії); без patrol — 3.5 без змін.
export function aiStep(state: GameState, patrol?: Vec2[]): boolean {
  if (state.activeSide !== 'alien') return false;
  const enemies = visibleEnemies(state, 'alien');
  for (const u of state.units) {
    if (!u.alive || u.side !== 'alien' || u.ap <= 0) continue;

    if (enemies.length === 0) {
      // Нікого не видно: патруль до зони висадки (якщо задано), потім заступа.
      if (patrol) {
        // Цілі шляху — СУСІДИ patrol-клітинок: самі клітини зони висадки зайняті
        // загоном, і findPath у зайняту клітину шляху не дає (v1 через це завжди
        // завершувалась заступою — зовні це виглядало як «ШІ не реагує»).
        // Резерв OVERWATCH_AP_COST — після прибуття прибульець одразу заступає.
        const step = bestPathToNeighbors(state, u, patrol, u.ap - OVERWATCH_AP_COST);
        if (step) {
          moveUnit(state, u.id, step);
          return true;
        }
      }
      if (!u.overwatch && u.ap >= OVERWATCH_AP_COST) {
        setOverwatch(state, u.id);
        return true;
      }
      continue;
    }

    // Найближчий видимий ворог (Чебишев).
    const target = nearestEnemy(u, enemies);

    // 1) постріл, якщо можливо.
    const mode = bestShootMode(state, u, target);
    if (mode) {
      resolveAttack(state, u.id, target.id, mode);
      return true;
    }

    // 2) рух у бік цілі.
    const step = pathToward(state, u, target);
    if (step) {
      moveUnit(state, u.id, step);
      return true; // наступний aiStep спробує вистрілити з нової позиції
    }

    // 3) ні руху, ні пострілу — заступа як останній варіант.
    if (!u.overwatch && u.ap >= OVERWATCH_AP_COST) {
      setOverwatch(state, u.id);
      return true;
    }
  }
  return false;
}
