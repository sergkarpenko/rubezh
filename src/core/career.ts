// src/core/career.ts
// п16.2 (ADR-0147): кар'єра оперативника — позивний, біографія, досвід,
// звання з приростами, роль, рядок втрати.
// ADR-0002: чисте ядро без DOM; ADR-0003: без RNG — пули за порядковим
// номером найму, як пул імен (`SOLDIER_NAMES` у squad.ts).
//
// Звання не зберігається — обчислюється з досвіду (`rankOf`): у сейві немає
// двох джерел правди, міграція сейву v1 (save.ts) дає звання тим самим
// правилом. Прирости звання (HP, точність) пишуться в запис юніта ростеру
// в момент підвищення (`promote`) — ядро бою кар'єри не знає.

import type { Unit } from './combat';

// Пули позивних і біографій (ADR-0147 п. 16; власник править у рев'ю PR п16.2).
export const CALLSIGNS = ['Крук', 'Шрам', 'Іскра', 'Тінь', 'Сокіл', 'Байт', 'Грім', 'Рись', 'Кремінь', 'Мла', 'Вольт', 'Оса'];

export const BIOGRAPHIES = [
  "Роки в диспетчерській метро — знає тунелі напам'ять.",
  'Майстерня дронів на Подолі, поки не прийшли зонди.',
  'Перший рій пережито в підвалі лікарні.',
  'Студентські роки — кібербезпека, тепер — фазові різаки.',
  'З ночі першої посадки не пропускає жодного сигналу.',
  'Мисливство в Карпатах навчило чекати й не промахуватись.',
  'Родина в евакуації, дім — на лінії з роєм.',
  "Кур'єрські маршрути нічним містом — найкраща школа руху.",
  'Шість років у швидкій — руки не тремтять.',
  "Імплант ока — пам'ять про першу зустріч із демоном.",
  'Аматорський страйкбол колись був грою.',
  'Справжнього імені не знає ніхто — і так краще.',
];

// Звання (ADR-0147 п. 1): індекс 0 — «Рекрут». Пороги досвіду — п16.2,
// остаточні числа підбирає probe п16.5 (ADR-0147 п. 2).
export const RANK_NAMES = ['Рекрут', 'Боєць', 'Сержант', 'Ветеран'] as const;
export const RANK_THRESHOLDS = [0, 2, 5, 9] as const;
export const RANK_HP_BONUS = 1; // +1 до maxHp і hp за кожне звання понад «Рекрут»
export const RANK_ACCURACY_BONUS = 0.03; // +0,03 до точності за кожне звання
export const MISSION_XP = 1; // досвід за пережиту місію (зокрема евакуацію)
export const KILL_XP = 1; // досвід за кожне вбивство в місії
// Звання, з якого оперативник обирає роль (ADR-0147 п. 1).
export const ROLE_RANK = 1;

export type SoldierRole = 'assault' | 'sniper' | 'medic';

export interface SoldierCareer {
  callsign: string;
  bio: string;
  xp: number; // очки досвіду за всю кар'єру
  missions: number; // пережиті місії (фатальна — лише в рядку втрати)
  // Вбивства, уже зараховані в досвід: знімок `kills` юніта після останньої
  // місії. `kills` накопичувальний, тож вбивства цієї місії — різниця
  // (ADR-0147 п. 10). Сейв робиться лише між місіями — знімок завжди чинний.
  killsCounted: number;
  role: SoldierRole | null; // роль обирається на званні «Боєць» (п16.3–п16.4)
}

// Пул за порядковим номером (0-based), понад довжину — з номером кола:
// «Крук», …, «Оса», «Крук 2»… (як імена, ADR-0147 п. 16).
function fromPool(pool: readonly string[], index: number, numbered: boolean): string {
  const base = pool[index % pool.length];
  return numbered && index >= pool.length ? base + ' ' + (Math.floor(index / pool.length) + 1) : base;
}

// Кар'єра новобранця за порядковим номером найму (0-based).
export function newCareer(index: number): SoldierCareer {
  return {
    callsign: fromPool(CALLSIGNS, index, true),
    bio: fromPool(BIOGRAPHIES, index, false),
    xp: 0,
    missions: 0,
    killsCounted: 0,
    role: null,
  };
}

// Звання за досвідом: найвищий поріг, якого досягнуто (0 — «Рекрут»).
export function rankOf(xp: number): number {
  let rank = 0;
  for (let r = 1; r < RANK_THRESHOLDS.length; r++) if (xp >= RANK_THRESHOLDS[r]) rank = r;
  return rank;
}

// Досвід до наступного звання; null — найвище звання.
export function xpToNextRank(xp: number): number | null {
  const rank = rankOf(xp);
  return rank + 1 < RANK_THRESHOLDS.length ? RANK_THRESHOLDS[rank + 1] - xp : null;
}

// Прирости за `steps` нових звань — у запис юніта ростеру (ADR-0147 п. 10):
// maxHp і hp +1 (тики лікарні рахує applyMissionResult з різниці, вона не
// міняється), точність +0,03 з округленням до сотих (без хвоста 0.63000…01).
export function applyRankBonus(unit: Unit, steps: number): void {
  if (steps <= 0) return;
  unit.maxHp += RANK_HP_BONUS * steps;
  unit.hp += RANK_HP_BONUS * steps;
  unit.firingAccuracy = Math.round((unit.firingAccuracy + RANK_ACCURACY_BONUS * steps) * 100) / 100;
}

// Підсумок місії для уцілілого (зокрема евакуйованого): +1 місія, досвід за
// місію і вбивства цієї місії, прирости нових звань. Повертає кількість нових
// звань (0 — без підвищення; більше 1 — перескочив звання за одну місію).
export function settleCareer(unit: Unit, career: SoldierCareer): number {
  const before = rankOf(career.xp);
  const missionKills = unit.kills - career.killsCounted;
  career.xp += MISSION_XP + KILL_XP * missionKills;
  career.missions += 1;
  career.killsCounted = unit.kills;
  const steps = rankOf(career.xp) - before;
  applyRankBonus(unit, steps);
  return steps;
}

// Оперативник чекає вибору ролі: звання «Боєць» або вище, ролі ще немає
// (ADR-0147 п. 13; вікно вибору — п16.4).
export function awaitingRole(career: SoldierCareer): boolean {
  return career.role === null && rankOf(career.xp) >= ROLE_RANK;
}

// Відмінок іменника після числівника: 1 місія, 2 місії, 5 місій, 11 місій, 21 місія.
export function pluralUk(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

// Рядок втрати (ADR-0147 п. 14, EARS 7): без роду, звання з малої;
// місії — з фатальною (career.missions ще без неї), вбивства — усі за кар'єру.
export function lossLine(unit: Unit, career: SoldierCareer): string {
  const missions = career.missions + 1;
  const kills = unit.kills;
  return (
    '✝ Втрата: ' +
    RANK_NAMES[rankOf(career.xp)].toLowerCase() +
    ' «' +
    career.callsign +
    '» — ' +
    missions +
    ' ' +
    pluralUk(missions, 'місія', 'місії', 'місій') +
    ', ' +
    kills +
    ' ' +
    pluralUk(kills, 'вбивство', 'вбивства', 'вбивств')
  );
}
