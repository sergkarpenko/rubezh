// src/core/squad.ts
// Ітерація 5.2: персистентність загону між місіями — ростер солдатів «Рубіжа».
// Фаза 4 (П4.3): кадрування — найм за гроші та звільнення.
// Фаза 4 (П4.4): лікарня — поранення і час відновлення; банкрутство.
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
// Втрати покриваються наймом (П4.3): hireSoldier(econ, roster) списує hirePrice
// з EconomyState і додає солдата в кінець ростеру (ветерани йдуть у бій першими);
// fireSoldier(roster, id) — звільнення на прохання гравця.
// Перма-смерть наскрізна: солдат, загиблий у бою, вилучається з ростеру назавжди.
// Лікарня (ADR-0021, замість MVP-лікування ADR-0008): уцілілий з hp < maxHp →
// «поранений» (ростер.hospital[id] = тики одужання), не потрапляє в missionSquad;
// відлік веде hospitalTick(roster) — 1 тік геосцени, HEAL_TICKS_PER_HP тиків на HP.

import type { GameState, Unit } from './combat';
import { hirePrice, spend, type EconomyState } from './economy';
import { type DifficultyPreset, DEFAULT_PRESET, DIFFICULTY_MULTIPLIERS } from './campaign';
import { makeSoldier, SQUAD_SPAWN } from './mission';

export const STARTING_ROSTER_SIZE = 6; // два повні загони + запас
export const HEAL_TICKS_PER_HP = 2; // ADR-0021: 1 HP = 2 тики геосцени

// Стартовий пул імен — фіксований, без RNG (детермінізм). Циклічно: «Іван», …, «Віра», «Іван 2»…
const SOLDIER_NAMES = ['Іван', 'Олена', 'Тарас', 'Марія', 'Богдан', 'Софія', 'Дмитро', 'Ярина', 'Орест', 'Наталія', 'Андрій', 'Віра'];

export interface Roster {
  soldiers: Unit[]; // живі солдати; загиблі вилучаються (перма-смерть)
  hired: number; // скільки всього пройшло через ростер (для унікальності id/імен)
  hospital: Record<string, number>; // id пораненого → тики одужання, що лишилися
}

export interface MissionAftermath {
  lost: Unit[]; // солдати, вилучені з ростеру (загинули в бою)
  survivors: Unit[]; // усі виживші (готові + поранені)
  wounded: Unit[]; // поранені — на лікуванні в лікарні (підмножина survivors)
}

// Солдат ростеру за порядковим індексом (0-based): ім'я з циклічного пулу,
// id — порядковий номер. Спільне для старту партії і найму: лічильник hired
// робить id/імена унікальними без RNG (детермінізм, ADR-0021).
function rosterSoldier(index: number, preset: DifficultyPreset = DEFAULT_PRESET): Unit {
  const base = SOLDIER_NAMES[index % SOLDIER_NAMES.length];
  const name = index < SOLDIER_NAMES.length ? base : base + ' ' + (Math.floor(index / SOLDIER_NAMES.length) + 1);
  const soldier = makeSoldier('s' + (index + 1), name);
  const multipliers = DIFFICULTY_MULTIPLIERS[preset];
  // Apply HP bonus multiplier
  soldier.maxHp = Math.round(soldier.maxHp * multipliers.hpBonusMultiplier);
  soldier.hp = soldier.maxHp;
  return soldier;
}

// Стартовий ростер організації: size солдатів із фіксованого списку імен.
export function createRoster(size: number = STARTING_ROSTER_SIZE, preset: DifficultyPreset = DEFAULT_PRESET): Roster {
  if (!Number.isInteger(size) || size < 1) {
    throw new Error('Розмір ростеру має бути цілим числом від 1');
  }
  const soldiers: Unit[] = [];
  for (let i = 0; i < size; i++) soldiers.push(rosterSoldier(i, preset));
  return { soldiers, hired: size, hospital: {} };
}

// Найм нового солдата за гроші (ADR-0021): списує ціну найму за пресетом
// (П11.8: ×economyMultiplier, ADR-0058 — «легкий» 120, «норма» 100,
// «складний» 90; недостатньо грошей → помилка, ростер не змінюється)
// і додає солдата в КІНЕЦЬ ростеру — ветерани залишаються першими у
// missionSquad. Без RNG: id та ім'я — наступні за лічильником hired.
export function hireSoldier(econ: EconomyState, roster: Roster, preset: DifficultyPreset = DEFAULT_PRESET): Unit {
  spend(econ, hirePrice(preset));
  const soldier = rosterSoldier(roster.hired, preset);
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

// Загін на наступну місію: перші size БОЄГОТОВИХ солдатів ростеру
// (поранені в лікарні не рахуються — ADR-0021). size обмежений зоною
// висадки; солдатів може виявитись менше, ніж просили, якщо ростер порідів
// (валідний загін — від 1 солдата).
export function missionSquad(roster: Roster, size: number = SQUAD_SPAWN.length): Unit[] {
  if (!Number.isInteger(size) || size < 1 || size > SQUAD_SPAWN.length) {
    throw new Error('Розмір загону: ціле число від 1 до ' + SQUAD_SPAWN.length);
  }
  const squad = readySoldiers(roster).slice(0, size);
  if (squad.length === 0) {
    throw new Error(
      roster.soldiers.length === 0
        ? 'Ростер порожній — немає кого відправити на місію'
        : 'Немає боєготових солдатів — усі поранені в лікарні'
    );
  }
  return squad;
}

// Боєготові солдати: живі, поза лікарнею (ADR-0021). Порядок — як у ростері
// (ветерани перші, новобранці останніми).
export function readySoldiers(roster: Roster): Unit[] {
  return roster.soldiers.filter((s) => roster.hospital[s.id] === undefined);
}

// Тік лікарні разом із геосценою (ADR-0021): відлік одужання поранених.
// Тики скінчилися → солдат знову боєготовий (hp = maxHp).
// Детермінізм: порядок фіксований за ростером, жодного RNG.
export function hospitalTick(roster: Roster): void {
  for (const s of roster.soldiers) {
    const left = roster.hospital[s.id];
    if (left === undefined) continue;
    if (left <= 1) {
      delete roster.hospital[s.id];
      s.hp = s.maxHp;
    } else {
      roster.hospital[s.id] = left - 1;
    }
  }
}

// Банкрутство партії (ADR-0021): боєготових немає і грошей на найм теж —
// кінець партії. Перевіряти на тіку геосцени; поранені в лікарні НЕ
// рахуються готовими (сувора умова власника: банкрутство настає одразу).
// П11.8: поріг найму — за пресетом (hirePrice; дефолт «норма» — старі
// виклики без пресету зберігають порівняння з HIRE_PRICE байт-у-байт).
export function isBankrupt(econ: EconomyState, roster: Roster, preset: DifficultyPreset = DEFAULT_PRESET): boolean {
  return readySoldiers(roster).length === 0 && econ.money < hirePrice(preset);
}

// Застосувати результат завершеної місії до ростеру (один раз після бою;
// порядок виклику щодо completeMission не важливий — це різні стани).
// Порівняння за id: солдат у стані місії, якого нема в ростері, → помилка
// (захист від застосування бою «чужого» загону; повторний виклик теж падає).
// Загиблий вилучається з ростеру назавжди; уцілілий НЕ лікується миттєво
// (ADR-0021): hp < maxHp → «поранений» у лікарню на (maxHp − hp) × HEAL_TICKS_PER_HP
// тиків; дозор скидається; kills зберігаються — стаж ветерана.
export function applyMissionResult(roster: Roster, state: GameState): MissionAftermath {
  const deployed = state.units.filter((u) => u.side === 'player');
  if (deployed.length === 0) throw new Error('У стані місії немає солдатів гравця');
  const lost: Unit[] = [];
  const survivors: Unit[] = [];
  const wounded: Unit[] = [];
  for (const u of deployed) {
    const rec = roster.soldiers.find((s) => s.id === u.id);
    if (!rec) throw new Error('Солдат не з цього ростеру: ' + u.id);
    if (!u.alive) {
      roster.soldiers = roster.soldiers.filter((s) => s.id !== u.id);
      delete roster.hospital[u.id];
      lost.push(rec);
    } else {
      rec.ap = rec.maxAp;
      rec.overwatch = false;
      if (rec.hp < rec.maxHp) {
        roster.hospital[rec.id] = (rec.maxHp - rec.hp) * HEAL_TICKS_PER_HP;
        wounded.push(rec);
      }
      survivors.push(rec);
    }
  }
  return { lost, survivors, wounded };
}
