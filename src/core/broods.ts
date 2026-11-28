// src/core/broods.ts
// п22.6 (ADR-0182 п. 5, 6, 14, 15; ADR-0188): виводки Розриву поверх типів ворогів і чемпіони.
// ADR-0002: чисте ядро без DOM/Canvas. ADR-0003: виводок і чемпіон — окремим генератором від сіду
// місії (`BROOD_SALT`), бойовий RNG і генератор складу (`ENEMY_MIX_SALT`) не зсуваються.
//
// Виводок дає ворогам одну особливість полями юніта (`Unit.brood`, `dmgBonus`, `armor`, `evade`),
// тож бій (combat.ts) не знає каталогу виводків: «Попіл» — +шкода кожного влучання, «Іржа» —
// +броня, «Тінь» — множник шансу влучити по ньому. Чемпіон — один іменний ворог місії з порогу
// загрози: HP ×CHAMPION_HP_MULT (угору), особливість виводку посилена, убитий — трофей `champion`.

import { mulberry32, type Unit } from './combat';
import { ENEMY_KINDS, ENEMY_ORDER, enemyKind } from './enemies';
import type { RegionId } from './regions';

export type BroodId = 'ash' | 'rust' | 'shadow';
export const BROOD_IDS: readonly BroodId[] = ['ash', 'rust', 'shadow'];

export interface BroodDef {
  name: string; // назва в меню на ворогові й журналі
  damage: number; // + до шкоди кожного влучання (до броні цілі)
  armor: number; // + до броні
  evade: number; // множник шансу влучити по ньому (1 — без змін)
}

// Кандидати ADR-0182 п. 14; числа — рішенням власника п22.6, перемір — probe п22.8.
export const ENEMY_BROODS: Readonly<Record<BroodId, BroodDef>> = {
  ash: { name: 'Попіл', damage: 1, armor: 0, evade: 1 },
  rust: { name: 'Іржа', damage: 0, armor: 1, evade: 1 },
  shadow: { name: 'Тінь', damage: 0, armor: 0, evade: 0.8 },
};

// Виводок місії зонда за районом посадки; 'seed' — один із трьох за сідом місії.
export type BroodRule = BroodId | 'seed';
export const REGION_BROODS: Readonly<Record<RegionId, BroodRule>> = {
  west: 'rust', // «Порт»
  east: 'ash', // «Промзона»
  south: 'shadow', // «Нетрі»
  north: 'seed', // «Шпилі»
};
// Штурм бази — один виводок за сідом; Брама — кожен ворог свого виводку за сідом.
export const ASSAULT_BROOD: BroodRule = 'seed';

export const BROOD_SALT = 0x2545f491;

// Чемпіон (ADR-0182 п. 15): з загрози CHAMPION_THREAT, з імовірністю CHAMPION_CHANCE за сідом.
export const CHAMPION_THREAT = 40;
export const CHAMPION_CHANCE = 0.5;
export const CHAMPION_HP_MULT = 1.5;
export const CHAMPION_BROOD_MULT = 2; // особливість виводку чемпіона: +шкода і +броня ×2, ухил — (1 − e) × 2

// Пул імен чемпіонів — `docs/design/setting.md` (рішення власника п22.6); як пул ворогів (ADR-0179):
// вигадані, без реальних імен, не закінчуються на «-а»/«-я» (рід — за назвою типу).
export const CHAMPION_NAMES: readonly string[] = ['Скверн', 'Ґрімхар', 'Вельзаг', 'Тарґул', 'Шракс', 'Морох', 'Кзарт', 'Ульґар'];

function broodRng(seed: number): () => number {
  return mulberry32((seed ^ BROOD_SALT) >>> 0);
}

function pick(rng: () => number): BroodId {
  return BROOD_IDS[Math.floor(rng() * BROOD_IDS.length)];
}

export function broodOfRule(rule: BroodRule, seed: number): BroodId {
  return rule === 'seed' ? pick(broodRng(seed)) : rule;
}

// Виводок місії зонда: район посадки (`regionOf(probe.pos)`) і сід місії.
export function missionBrood(region: RegionId, seed: number): BroodId {
  return broodOfRule(REGION_BROODS[region], seed);
}

// Рішення власника п22.6 «А. Лише не-демонам»: демон (не чемпіон) несе виводок лише виглядом
// (аура, назва) — без особливості; гончак, голем, око і чемпіон — з нею.
export function broodCarrier(u: Pick<Unit, 'kind' | 'champion'>): boolean {
  return enemyKind(u) !== 'demon' || u.champion === true;
}

// Особливість виводку на юніті; mult — посилення чемпіона (0 — лише вигляд).
function applyOne(u: Unit, brood: BroodId, mult: number): void {
  const d = ENEMY_BROODS[brood];
  u.brood = brood;
  if (mult === 0) return;
  if (d.damage > 0) u.dmgBonus = d.damage * mult;
  else delete u.dmgBonus;
  const baseArmor = enemyKind(u) === 'demon' ? 0 : ENEMY_KINDS[enemyKind(u)].armor;
  const armor = baseArmor + d.armor * mult;
  if (armor > 0) u.armor = armor;
  else delete u.armor;
  if (d.evade !== 1) u.evade = 1 - (1 - d.evade) * mult;
  else delete u.evade;
}

export interface BroodOptions {
  brood: BroodId | 'mixed'; // 'mixed' — кожен ворог свого виводку за сідом (Брама)
  threat: number;
  champion: boolean; // чи може бути чемпіон у цьому бою
}

// Виводок і чемпіон ворогів бою (aliens — щойно зроблені `makeEnemies`). Генератор — окремий:
// перший кидок — чемпіон (лише з порогу загрози), далі — виводки ворогів 'mixed'.
// Повертає чемпіона або undefined.
export function applyBroods(aliens: Unit[], seed: number, opts: BroodOptions): Unit | undefined {
  const rng = broodRng(seed ^ 0x51ed27);
  let champ: Unit | undefined;
  if (opts.champion && opts.threat >= CHAMPION_THREAT && aliens.length > 0 && rng() < CHAMPION_CHANCE) {
    // найсильніший тип складу (останній за ENEMY_ORDER), перший такий
    const top = Math.max(...aliens.map((u) => ENEMY_ORDER.indexOf(enemyKind(u))));
    champ = aliens.find((u) => ENEMY_ORDER.indexOf(enemyKind(u)) === top);
  }
  if (champ) champ.champion = true;
  for (const u of aliens) {
    const b = opts.brood === 'mixed' ? pick(rng) : opts.brood;
    applyOne(u, b, u === champ ? CHAMPION_BROOD_MULT : broodCarrier(u) ? 1 : 0);
  }
  if (champ) {
    champ.maxHp = Math.ceil(champ.maxHp * CHAMPION_HP_MULT);
    champ.hp = champ.maxHp;
    champ.name = ENEMY_KINDS[enemyKind(champ)].name + ' ' + CHAMPION_NAMES[championNameIndex(seed)];
  }
  return champ;
}

// Ім'я чемпіона — ціла арифметика від сіду без RNG (як `enemyNameStart`, ADR-0179 п. 2).
export function championNameIndex(seed: number): number {
  const h = Math.imul((seed ^ BROOD_SALT) >>> 0, 0x9e3779b1);
  return ((h ^ (h >>> 16)) >>> 0) % CHAMPION_NAMES.length;
}

// Назва виводку для меню на ворогові й журналу; без виводку — undefined.
export function broodName(u: Pick<Unit, 'brood'>): string | undefined {
  return u.brood === undefined ? undefined : ENEMY_BROODS[u.brood].name;
}

// Особливість виводку юніта словами — для меню на ворогові й журналу (п22.6; тексти — рішення власника).
// Демон без особливості (`broodCarrier`) — undefined; broodEffectOf — для виводку без юніта.
export function broodEffect(u: Pick<Unit, 'brood' | 'champion' | 'kind'>): string | undefined {
  if (u.brood === undefined || !broodCarrier(u)) return undefined;
  return broodEffectOf(u.brood, u.champion ? CHAMPION_BROOD_MULT : 1);
}
export function broodEffectOf(brood: BroodId, m = 1): string {
  const d = ENEMY_BROODS[brood];
  if (d.damage > 0) return '+' + d.damage * m + ' шкоди';
  if (d.armor > 0) return '+' + d.armor * m + ' броні';
  return '−' + Math.round((1 - d.evade) * m * 100) + ' % до влучання';
}
