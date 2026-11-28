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
//   createRoster() → missionSquad(roster) → createMission(geo, probeId, { squad })
//   → бій → applyMissionResult(roster, mission.state) → completeMission(geo, probeId, …)
// Втрати покриваються наймом (П4.3): hireSoldier(econ, roster) списує hirePrice
// з EconomyState і додає солдата в кінець ростеру (ветерани йдуть у бій першими);
// fireSoldier(roster, id) — звільнення на прохання гравця.
// Перма-смерть наскрізна: солдат, загиблий у бою, вилучається з ростеру назавжди.
// Лікарня (ADR-0021, замість MVP-лікування ADR-0008): уцілілий з hp < maxHp →
// «поранений» (ростер.hospital[id] = тики одужання), не потрапляє в missionSquad;
// відлік веде hospitalTick(roster) — 1 тік геосцени, HEAL_TICKS_PER_HP тиків на HP.

import { RESCUER_EXTRA_USES, type GameState, type Unit, type UnitRole } from './combat';
import { hirePrice, spend, type EconomyState } from './economy';
import { type DifficultyPreset, DEFAULT_PRESET, DIFFICULTY_MULTIPLIERS } from './campaign';
import { makeSoldier, SQUAD_SPAWN } from './mission';
import {
  applyBranchBonus,
  awaitingBranch,
  awaitingRole,
  branchOptions,
  type BranchTier,
  type CareerBranch,
  lossLine,
  newCareer,
  rankOf,
  ROLE_RANK,
  settleCareer,
  SOLDIER_ROLES,
  type SoldierCareer,
  type SoldierRole,
} from './career';

export const STARTING_ROSTER_SIZE = 6; // два повні загони + запас
export const HEAL_TICKS_PER_HP = 2; // ADR-0021: 1 HP = 2 тики геосцени

// Стартовий пул імен — фіксований, без RNG (детермінізм). Циклічно: «Іван», …, «Віра», «Іван 2»…
export const SOLDIER_NAMES = [
  'Іван',
  'Олена',
  'Тарас',
  'Марія',
  'Богдан',
  'Софія',
  'Дмитро',
  'Ярина',
  'Орест',
  'Наталія',
  'Андрій',
  'Віра',
];

export interface Roster {
  soldiers: Unit[]; // живі солдати; загиблі вилучаються (перма-смерть)
  hired: number; // скільки всього пройшло через ростер (для унікальності id/імен)
  hospital: Record<string, number>; // id пораненого → тики одужання, що лишилися
  // п16.2 (ADR-0147): id оперативника → кар'єра (позивний, біографія, досвід,
  // роль). Окремо від Unit: юніт бою (і прибульці) кар'єри не має.
  careers: Record<string, SoldierCareer>;
}

export interface MissionAftermath {
  lost: Unit[]; // солдати, вилучені з ростеру (загинули в бою)
  survivors: Unit[]; // усі виживші (готові + поранені)
  wounded: Unit[]; // поранені — на лікуванні в лікарні (підмножина survivors)
  // п16.2 (ADR-0147): уцілілі з новим званням (порядок — як survivors)
  promoted: Unit[];
  // п16.2 (ADR-0147 п. 14, EARS 7): рядки втрати «✝ Втрата: …» (порядок — як lost)
  lossLines: string[];
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
  const careers: Record<string, SoldierCareer> = {};
  for (let i = 0; i < size; i++) {
    const s = rosterSoldier(i, preset);
    soldiers.push(s);
    careers[s.id] = newCareer(i);
  }
  return { soldiers, hired: size, hospital: {}, careers };
}

// Найм нового солдата за гроші (ADR-0021): списує ціну найму за пресетом
// (П11.8: ×economyMultiplier, ADR-0058 — «легкий» 120, «норма» 100,
// «складний» 90; недостатньо грошей → помилка, ростер не змінюється)
// і додає солдата в КІНЕЦЬ ростеру — ветерани залишаються першими у
// missionSquad. Без RNG: id та ім'я — наступні за лічильником hired.
export function hireSoldier(econ: EconomyState, roster: Roster, preset: DifficultyPreset = DEFAULT_PRESET): Unit {
  spend(econ, hirePrice(preset));
  const soldier = rosterSoldier(roster.hired, preset);
  roster.careers[soldier.id] = newCareer(roster.hired);
  roster.hired += 1;
  roster.soldiers.push(soldier);
  return soldier;
}

// Звільнення солдата на прохання гравця: вилучає з ростеру за id
// (як перма-смерть, але добровільно). Солдата з таким id немає → помилка.
export function fireSoldier(roster: Roster, id: string): Unit {
  const rec = roster.soldiers.find((s) => s.id === id);
  if (!rec) throw new Error('Оперативника немає в ростері: ' + id);
  roster.soldiers = roster.soldiers.filter((s) => s.id !== id);
  delete roster.careers[id];
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
        : 'Немає боєготових оперативників — усі поранені в лікарні'
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

// Т.22 (ADR-0089): чи загрожує місія банкрутством — якщо загін із squadSize
// боєготових загине весь, боєготових не лишиться, а грошей на найм немає
// (тобто після розгрому одразу настане isBankrupt). Одна умова для бота
// партії (party-bot.ts) і для попередження в UI перед запуском місії.
export function missionRisksBankruptcy(
  econ: EconomyState,
  roster: Roster,
  squadSize: number,
  preset: DifficultyPreset = DEFAULT_PRESET
): boolean {
  return readySoldiers(roster).length <= squadSize && econ.money < hirePrice(preset);
}

// Застосувати результат завершеної місії до ростеру (один раз після бою;
// порядок виклику щодо completeMission не важливий — це різні стани).
// Порівняння за id: солдат у стані місії, якого нема в ростері, → помилка
// (захист від застосування бою «чужого» загону; повторний виклик теж падає).
// Загиблий вилучається з ростеру назавжди; уцілілий НЕ лікується миттєво
// (ADR-0021): hp < maxHp → «поранений» у лікарню на (maxHp − hp) × HEAL_TICKS_PER_HP
// тиків; дозор скидається; kills зберігаються — стаж ветерана.
// П15.2 (ADR-0075): евакуйований — уцілілий через чинний контур (вилучений
// з поля бою → у списку evacuated стану бою, EARS 6: лікарня при пораненні,
// предмети/kills збережені, перма-смерть не зачіпається); порядок — спершу
// юніти на полі, потім евакуйовані (детермінізм, ADR-0003).
// п16.2 (ADR-0147 п. 10): уцілілий — +1 місія, досвід за місію і вбивства
// цієї місії, прирости нових звань (settleCareer); загиблий — рядок втрати
// з кар'єри до вилучення; виклик — один раз на місію (повторний на тому самому
// стані дав би ще +1 місію і досвід). Тики лікарні — з різниці maxHp − hp, прирости
// звання її не міняють.
export function applyMissionResult(roster: Roster, state: GameState): MissionAftermath {
  // п18.4 (ADR-0156): турелі бази — поза ростером і досвідом
  const deployed = [...state.units.filter((u) => u.side === 'player' && !u.turret), ...(state.evacuated ?? [])];
  if (deployed.length === 0) throw new Error('У стані місії немає оперативників гравця');
  const lost: Unit[] = [];
  const survivors: Unit[] = [];
  const wounded: Unit[] = [];
  const promoted: Unit[] = [];
  const lossLines: string[] = [];
  for (const u of deployed) {
    const rec = roster.soldiers.find((s) => s.id === u.id);
    if (!rec) throw new Error('Оперативник не з цього ростеру: ' + u.id);
    const career = roster.careers[rec.id];
    if (!career) throw new Error("Немає кар'єри оперативника: " + rec.id);
    if (!u.alive) {
      roster.soldiers = roster.soldiers.filter((s) => s.id !== u.id);
      delete roster.hospital[u.id];
      delete roster.careers[u.id];
      lossLines.push(lossLine(rec, career));
      lost.push(rec);
    } else {
      rec.ap = rec.maxAp;
      rec.overwatch = false;
      if (settleCareer(rec, career) > 0) promoted.push(rec);
      if (rec.hp < rec.maxHp) {
        roster.hospital[rec.id] = (rec.maxHp - rec.hp) * HEAL_TICKS_PER_HP;
        wounded.push(rec);
      }
      survivors.push(rec);
    }
  }
  return { lost, survivors, wounded, promoted, lossLines };
}

// --- п16.3 (ADR-0147 п. 11–13): ролі ---

// Ролі загону на місію (id → роль, прапорець «використано» скинуто) — копія
// для стану бою, як deployConsumables (ADR-0058): ядро бою кар'єри не знає.
// Оперативник без ролі запису не має; порожній результат — null, і місія
// створюється без ролей (бій байт-у-байт як до п16.3).
export function deployRoles(roster: Roster, squad: Unit[]): Record<string, UnitRole> | null {
  const roles: Record<string, UnitRole> = {};
  for (const u of squad) {
    const career = roster.careers[u.id];
    const role = career?.role;
    if (!role) continue;
    // п22.2: спеціалізація «Сержанта» — лише за наявності (без неї запис як до п22.2)
    const spec = career.branches?.sergeant;
    roles[u.id] = spec === undefined ? { role, used: false } : { role, used: false, spec };
    if (spec === 'rescuer') roles[u.id].extraUses = RESCUER_EXTRA_USES;
  }
  return Object.keys(roles).length > 0 ? roles : null;
}

// Вибір ролі (ADR-0147 п. 5, 13): лише оперативник ростеру, що чекає вибору
// (звання «Боєць» і вище без ролі); роль назавжди.
export function chooseRole(roster: Roster, id: string, role: SoldierRole): void {
  const career = roster.careers[id];
  if (!career || !roster.soldiers.some((s) => s.id === id)) throw new Error('Оперативника немає в ростері: ' + id);
  if (!SOLDIER_ROLES.includes(role)) throw new Error('Невідома роль: ' + String(role));
  if (career.role !== null) throw new Error('Роль уже обрано: ' + id);
  if (!awaitingRole(career)) throw new Error('Роль обирається зі звання «Боєць»: ' + id);
  career.role = role;
}

// Роль для бота партії (ADR-0147 п. 12): якої найменше серед оперативників
// ростеру зі званням (від «Боєць», зокрема в лікарні); рівність — штурмовик →
// снайпер → медик. Без RNG (ADR-0003).
export function botRole(roster: Roster): SoldierRole {
  const count: Record<SoldierRole, number> = { assault: 0, sniper: 0, medic: 0 };
  for (const s of roster.soldiers) {
    const c = roster.careers[s.id];
    if (c && c.role !== null && rankOf(c.xp) >= ROLE_RANK) count[c.role] += 1;
  }
  let best = SOLDIER_ROLES[0];
  for (const r of SOLDIER_ROLES) if (count[r] < count[best]) best = r;
  return best;
}

// Бот партії після місії: кожному, хто чекає ролі, — за botRole, по черзі
// ростеру (наступний бачить ролі попередніх). Повертає id із новою роллю.
export function assignBotRoles(roster: Roster): string[] {
  const assigned: string[] = [];
  for (const s of roster.soldiers) {
    const c = roster.careers[s.id];
    if (!c || !awaitingRole(c)) continue;
    chooseRole(roster, s.id, botRole(roster));
    assigned.push(s.id);
  }
  return assigned;
}

// --- п22.2 (ADR-0182 п. 1, 7; ADR-0183): гілки «Сержанта» і «Ветерана» ---

// Вибір гілки: лише розвилка, що чекає (`awaitingBranch`), і лише її варіант;
// гілка назавжди, прирости — у запис юніта ростеру (`applyBranchBonus`).
export function chooseBranch(roster: Roster, id: string, branch: CareerBranch): void {
  const career = roster.careers[id];
  const soldier = roster.soldiers.find((s) => s.id === id);
  if (!career || !soldier) throw new Error('Оперативника немає в ростері: ' + id);
  const tier = awaitingBranch(career);
  if (tier === null) throw new Error('Розвилки, що чекає вибору, немає: ' + id);
  if (!branchOptions(career, tier).includes(branch)) throw new Error('Гілка не з цієї розвилки: ' + String(branch));
  career.branches = { ...career.branches, [tier]: branch };
  applyBranchBonus(soldier, branch);
}

// Гілка для бота партії (ADR-0182 п. 7, за правилом ролей ADR-0147 п. 12): з
// варіантів розвилки — якої найменше в ростері (зокрема в лікарні); рівність —
// порядок каталогу `CAREER_TREE`. Без RNG (ADR-0003).
export function botBranch(roster: Roster, career: SoldierCareer, tier: BranchTier): CareerBranch {
  const options = branchOptions(career, tier);
  const count = (b: CareerBranch) => roster.soldiers.filter((s) => roster.careers[s.id]?.branches?.[tier] === b).length;
  let best = options[0];
  for (const b of options) if (count(b) < count(best)) best = b;
  return best;
}

// Бот партії після місії (після `assignBotRoles`): кожна розвилка, що чекає, — за
// botBranch, по черзі ростеру; перескочив два звання — обидві. Повертає id з новою гілкою.
export function assignBotBranches(roster: Roster): string[] {
  const assigned: string[] = [];
  for (const s of roster.soldiers) {
    const c = roster.careers[s.id];
    if (!c) continue;
    for (let tier = awaitingBranch(c); tier !== null; tier = awaitingBranch(c)) {
      chooseBranch(roster, s.id, botBranch(roster, c, tier));
      if (!assigned.includes(s.id)) assigned.push(s.id);
    }
  }
  return assigned;
}
