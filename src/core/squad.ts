// src/core/squad.ts
// Ітерація 5.2: персистентність загону між місіями — ростер солдатів «Рубіжа».
// Фаза 4 (П4.3): кадрування — найм за гроші та звільнення.
// ADR-0002: Чисте ядро логіки без DOM/Canvas
// ADR-0008: Ростер загону — персистентність між місіями
// ADR-0010: Цільовий UI — ванільний TS + Canvas (ростер вижив у main.ts)
// ADR-0021: Економіка: гроші, найм, лікарня, банкрутство
//
// Чиста логіка: жодних залежностей від DOM/Canvas і жодного RNG — стартовий ростер
// і найм детерміновані (фіксований пул імен, циклічний за лічильником hired).
// Ростер — окремий стан партії поруч із GeoState: geo.ts нічого не знає про солдатів,
// mission.ts приймає загін ззовні (opts.squad). Цикл шару застосунка:
//   createRoster() → missionSquad(roster) → createMission(geo, ufoId, { squad })
//   → бій → applyMissionResult(roster, mission.state) → completeMission(geo, ufoId, …)
// Втрати покриваються наймом (П4.3): hireSoldier(econ, roster) списує HIRE_PRICE
// з EconomyState і додає солдата в кінець ростеру (ветерани йдуть у бій першими);
// fireSoldier(roster, id) — звільнення на прохання гравця.
// Перма-смерть наскрізна: солдат, загиблий у бою, вилучається з ростеру назавжди.
// MVP-спрощення (зміни — новими ADR): виживші повністю лікуються на базі між
// місіями (лікарня з часом відновлення — П4.4, ADR-0021).

import type { GameState, Unit } from './combat';
import { HIRE_PRICE, spend, type EconomyState } from './economy';
import { makeSoldier, SQUAD_SPAWN } from './mission';

export const STARTING_ROSTER_SIZE = 6; // два повні загони + запас

// Стартовий пул імен — фіксований, без RNG (детермінізм). Циклічно: «Іван», …, «Віра», «Іван 2»…
const SOLDIER_NAMES = ['Іван', 'Олена', 'Тарас', 'Марія', 'Богдан', 'Софія', 'Дмитро', 'Ярина', 'Орест', 'Наталія', 'Андрій', 'Віра'];

export interface Roster {
  soldiers: Unit[]; // живі солдати; загиблі вилучаються (перма-смерть)
  hired: number; // скільки всього пройшло через ростер (для унікальності id/імен)
}

export interface MissionAftermath {
  lost: Unit[]; // солдати, вилучені з ростеру (загинули в бою)
  survivors: Unit[]; // виживші після повного лікування на базі
}

// Солдат ростеру за порядковим індексом (0-based): ім'я з циклічного пулу,
// id — порядковий номер. Спільне для старту партії і найму: лічильник hired
// робить id/імена унікальними без RNG (детермінізм, ADR-0021).
function rosterSoldier(index: number): Unit {
  const base = SOLDIER_NAMES[index % SOLDIER_NAMES.length];
  const name = index < SOLDIER_NAMES.length ? base : base + ' ' + (Math.floor(index / SOLDIER_NAMES.length) + 1);
  return makeSoldier('s' + (index + 1), name);
}

// Стартовий ростер організації: size солдатів із фіксованого списку імен.
export function createRoster(size: number = STARTING_ROSTER_SIZE): Roster {
  if (!Number.isInteger(size) || size < 1) {
    throw new Error('Розмір ростеру має бути цілим числом від 1');
  }
  const soldiers: Unit[] = [];
  for (let i = 0; i < size; i++) soldiers.push(rosterSoldier(i));
  return { soldiers, hired: size };
}

// Найм нового солдата за гроші (ADR-0021): списує HIRE_PRICE з економіки
// (недостатньо грошей → помилка, ростер не змінюється) і додає солдата
// в КІНЕЦЬ ростеру — ветерани залишаються першими у missionSquad.
// Без RNG: id та ім'я — наступні за лічильником hired.
export function hireSoldier(econ: EconomyState, roster: Roster): Unit {
  spend(econ, HIRE_PRICE);
  const soldier = rosterSoldier(roster.hired);
  roster.hired += 1;
  roster.soldiers.push(soldier);
  return soldier;
}

// Звільнення солдата на прохання гравця: вилучає з ростеру за id
// (як перма-смерть, але добровільно). Солдата з таким id немає → помилка.
export function fireSoldier(roster: Roster, id: string): Unit {
  const rec = roster.soldiers.find((s) => s.id === id);
  if (!rec) throw new Error('Солдата немає в ростері: ' + id);
  roster.soldiers = roster.soldiers.filter((s) => s.id !== id);
  return rec;
}

// Загін на наступну місію: перші size живих солдатів ростеру.
// size обмежений зоною висадки; солдатів може виявитись менше, ніж просили,
// якщо ростер порідів (валідний загін — від 1 солдата).
export function missionSquad(roster: Roster, size: number = SQUAD_SPAWN.length): Unit[] {
  if (!Number.isInteger(size) || size < 1 || size > SQUAD_SPAWN.length) {
    throw new Error('Розмір загону: ціле число від 1 до ' + SQUAD_SPAWN.length);
  }
  const squad = roster.soldiers.slice(0, size);
  if (squad.length === 0) throw new Error('Ростер порожній — немає кого відправити на місію');
  return squad;
}

// Застосувати результат завершеної місії до ростеру (один раз після бою;
// порядок виклику щодо completeMission не важливий — це різні стани).
// Порівняння за id: солдат у стані місії, якого нема в ростері, → помилка
// (захист від застосування бою «чужого» загону; повторний виклик теж падає).
// Загиблий вилучається з ростеру назавжди; виживший повністю лікується на
// базі (hp = maxHp), заступа скидається; kills зберігаються — стаж ветерана.
export function applyMissionResult(roster: Roster, state: GameState): MissionAftermath {
  const deployed = state.units.filter((u) => u.side === 'player');
  if (deployed.length === 0) throw new Error('У стані місії немає солдатів гравця');
  const lost: Unit[] = [];
  const survivors: Unit[] = [];
  for (const u of deployed) {
    const rec = roster.soldiers.find((s) => s.id === u.id);
    if (!rec) throw new Error('Солдат не з цього ростеру: ' + u.id);
    if (!u.alive) {
      roster.soldiers = roster.soldiers.filter((s) => s.id !== u.id);
      lost.push(rec);
    } else {
      rec.hp = rec.maxHp;
      rec.ap = rec.maxAp;
      rec.overwatch = false;
      survivors.push(rec);
    }
  }
  return { lost, survivors };
}
