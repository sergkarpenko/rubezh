
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

import {
  OVERWATCH_AP_COST,
  distance,
  hasLineOfSight,
  moveUnit,
  resolveAttack,
  setOverwatch,
  type GameState,
  type ShotMode,
  type Unit,
  type Vec2,
} from './combat';
import { findPath, visibleEnemies } from './map';

const MODE_PRIORITY: ShotMode[] = ['auto', 'aimed', 'snap']; // за очікуваним пошкодженням на постріл

// Найкращий доступний режим пострілу: дальність + LOS + AP, інакше null.
function bestShootMode(state: GameState, u: Unit, target: Unit): ShotMode | null {
  if (distance(u.pos, target.pos) > u.weapon.range) return null;
  if (!hasLineOfSight(state, u.pos, target.pos)) return null;
  for (const mode of MODE_PRIORITY) {
    if (u.ap >= u.weapon.modes[mode].apCost) return mode;
  }
  return null;
}

// Шлях до клітинки поруч із ціллю (сусідні 4 клітинки цілі), обрізаний до наявних AP.
function pathToward(state: GameState, u: Unit, target: Unit): Vec2[] | null {
  const goals: Vec2[] = [
    { x: target.pos.x + 1, y: target.pos.y }, { x: target.pos.x - 1, y: target.pos.y },
    { x: target.pos.x, y: target.pos.y + 1 }, { x: target.pos.x, y: target.pos.y - 1 },
  ];
  let best: Vec2[] | null = null;
  for (const g of goals) {
    const p = findPath(state, u.pos, g);
    if (p && p.length > 0 && (best === null || p.length < best.length)) best = p;
  }
  if (!best) return null;
  return best.slice(0, u.ap);
}

// Патруль 5.1.5: рух до зони висадки гравця, якщо цілей не видно.
// Цілі шляху — СУСІДИ patrol-клітинок: самі клітини зони висадки зайняті
// загоном, і findPath у зайняту клітину шляху не дає (v1 через це завжди
// завершувалась заступою — зовні це виглядало як «ШІ не реагує»).
// Резерв OVERWATCH_AP_COST — після прибуття прибульець одразу заступає.
function patrolStep(state: GameState, u: Unit, patrol: Vec2[]): Vec2[] | null {
  const goals: Vec2[] = [];
  for (const p of patrol) {
    goals.push({ x: p.x + 1, y: p.y }, { x: p.x - 1, y: p.y }, { x: p.x, y: p.y + 1 }, { x: p.x, y: p.y - 1 });
  }
  const budget = u.ap - OVERWATCH_AP_COST;
  if (budget <= 0) return null;
  let best: Vec2[] | null = null;
  for (const g of goals) {
    const p = findPath(state, u.pos, g);
    if (p && p.length > 0 && (best === null || p.length < best.length)) best = p;
  }
  if (!best) return null;
  return best.slice(0, budget);
}

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
        const step = patrolStep(state, u, patrol);
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
    const target = enemies.reduce((best, e) => distance(u.pos, e.pos) < distance(u.pos, best.pos) ? e : best);

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
