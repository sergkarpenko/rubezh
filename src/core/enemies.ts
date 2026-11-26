// src/core/enemies.ts
// п17.2 (ADR-0149 п. 1–3, 8–12): типи ворогів — демон, гончак, голем, око.
// ADR-0002: чисте ядро без DOM/Canvas. ADR-0003: склад місії — окремий
// генератор від сіду місії (`ENEMY_MIX_SALT`), бойовий RNG не зсувається.
//
// Відсутній `Unit.kind` ≡ демон (ADR-0149 п. 9): демона ядро будує без поля,
// тож бій лише з демонами — байт-у-байт як до фази 17.

import { ALIEN_CUTTER, makeUnit, mulberry32, type ShotProfile, type Unit, type Vec2, type Weapon } from './combat';

export type EnemyKind = 'demon' | 'hound' | 'golem' | 'eye';

// Порядок — порядок появи за загрозою (ADR-0149 п. 3, ADR-0153 п. 14); вибір складу йде цим порядком.
export const ENEMY_ORDER: readonly EnemyKind[] = ['demon', 'hound', 'golem', 'eye'];

// Один профіль на всі три режими: у зброї з `only` профілі недоступних режимів
// дорівнюють дозволеному (ADR-0149 п. 10) — дозор бере `modes.snap` за чинним правилом.
function sameModes(p: ShotProfile): Weapon['modes'] {
  return { auto: { ...p }, snap: { ...p }, aimed: { ...p } };
}

// Гончак: удар «Кігті» лише впритул (Чебишев 1), 3 AP, один удар; шанс 85 % —
// точність 0,85 × модифікатор 1 (формула ADR-0004 без змін).
export const HOUND_CLAWS: Weapon = {
  name: 'Кігті',
  damage: [3, 6],
  range: 1,
  modes: sameModes({ apCost: 3, accuracyMod: 1, shots: 1 }),
  only: ['snap'],
};

// Голем: гармата з режимами різака, коротша дальність.
export const GOLEM_CANNON: Weapon = {
  name: 'Гармата',
  damage: [3, 6],
  range: 8,
  modes: {
    auto: { ...ALIEN_CUTTER.modes.auto },
    snap: { ...ALIEN_CUTTER.modes.snap },
    aimed: { ...ALIEN_CUTTER.modes.aimed },
  },
};

// Око: промінь на 16 клітинок, лише прицільний постріл (профіль прицільного різака).
export const EYE_BEAM: Weapon = {
  name: 'Промінь',
  damage: [3, 7],
  range: 16,
  modes: sameModes(ALIEN_CUTTER.modes.aimed),
  only: ['aimed'],
};

export interface EnemyKindDef {
  name: string; // назва типу — на полі «<назва> <N>»
  hp: number;
  ap: number;
  accuracy: readonly number[]; // за порядком серед свого типу, циклічно
  weapon: Weapon;
  armor: number; // мінус від кожного влучання пострілу (ADR-0149 п. 5)
  fromThreat: number; // п18.3 (ADR-0153 п. 14): загроза кампанії, з якої тип з'являється
}

// Числа — ADR-0149 п. 2 («Помітна різниця»); probe п17.6 може їх змінити рішенням власника.
// Точність демона — баланс 3.6 (.50/.45/.40), циклічно за порядком серед демонів.
export const ENEMY_KINDS: Record<EnemyKind, EnemyKindDef> = {
  demon: { name: 'Демон', hp: 10, ap: 10, accuracy: [0.5, 0.45, 0.4], weapon: ALIEN_CUTTER, armor: 0, fromThreat: 0 },
  hound: { name: 'Гончак', hp: 7, ap: 14, accuracy: [0.85], weapon: HOUND_CLAWS, armor: 0, fromThreat: 8 },
  golem: { name: 'Голем', hp: 16, ap: 8, accuracy: [0.4], weapon: GOLEM_CANNON, armor: 2, fromThreat: 17 },
  eye: { name: 'Око', hp: 8, ap: 10, accuracy: [0.65], weapon: EYE_BEAM, armor: 0, fromThreat: 27 },
};

export const GOLEM_LIMIT = 1; // голем — не більше одного на місію (ADR-0149 п. 8)
// Сіль окремого генератора складу: `mulberry32(seed ^ ENEMY_MIX_SALT)` (ADR-0149 п. 12).
export const ENEMY_MIX_SALT = 0x9e3779b9;

// Тип юніта: відсутній `kind` — демон (і оперативник гравця, якщо спитати).
export function enemyKind(u: Pick<Unit, 'kind'>): EnemyKind {
  return u.kind ?? 'demon';
}

// п18.3 (ADR-0153 п. 14): типи, доступні на цій загрозі (пороги-кандидати 8 / 17 / 27,
// за темпом ≈ 1,6 на добу — ≈ 6 / 12 / 18-та доба, як ADR-0149 п. 3; перемір п18.6 — без змін, ADR-0158).
export function kindsForThreat(threat: number): EnemyKind[] {
  return ENEMY_ORDER.filter((k) => ENEMY_KINDS[k].fromThreat <= threat);
}

// Склад місії з n ворогів (ADR-0149 п. 8): перший — демон, решта — випадково
// з доступних типів avail (п18.3: набір — параметром, kindsForThreat); голем, що вже є, —
// перевибір з решти доступних. Генератор окремий від бойового RNG; лише демони —
// без витягання чисел.
export function enemyMix(avail: readonly EnemyKind[], n: number, seed: number): EnemyKind[] {
  const kinds: EnemyKind[] = [];
  if (n <= 0) return kinds;
  kinds.push('demon');
  if (avail.length === 1) {
    while (kinds.length < n) kinds.push('demon');
    return kinds;
  }
  const rng = mulberry32((seed ^ ENEMY_MIX_SALT) >>> 0);
  while (kinds.length < n) {
    const golems = kinds.filter((k) => k === 'golem').length;
    const pool = golems >= GOLEM_LIMIT ? avail.filter((k) => k !== 'golem') : avail;
    kinds.push(pool[Math.floor(rng() * pool.length)]);
  }
  return kinds;
}

// Ворог типу kind: index — порядок серед свого типу від 0 (ім'я «<назва> <index+1>»,
// точність — за цим порядком). Демон — без полів kind і armor (байт-у-байт як до фази 17).
export function makeEnemy(kind: EnemyKind, id: string, index: number, pos: Vec2): Unit {
  const d = ENEMY_KINDS[kind];
  const u = makeUnit({
    id,
    side: 'alien',
    name: d.name + ' ' + (index + 1),
    pos: { ...pos },
    firingAccuracy: d.accuracy[index % d.accuracy.length],
    weapon: d.weapon,
  });
  if (kind === 'demon') return u;
  u.hp = d.hp;
  u.maxHp = d.hp;
  u.ap = d.ap;
  u.maxAp = d.ap;
  u.kind = kind;
  if (d.armor > 0) u.armor = d.armor;
  return u;
}

// Вороги місії за складом: id 'a1'.., імена — за порядком серед свого типу.
export function makeEnemies(kinds: readonly EnemyKind[], spawn: readonly Vec2[]): Unit[] {
  const seen: Record<EnemyKind, number> = { demon: 0, hound: 0, golem: 0, eye: 0 };
  return kinds.map((k, i) => makeEnemy(k, 'a' + (i + 1), seen[k]++, spawn[i]));
}
