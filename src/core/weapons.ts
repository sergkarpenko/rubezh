// src/core/weapons.ts
// п20.4 (ADR-0165 п. 5, 12; ADR-0168): каталог зброї оперативника — «Гарт» (стартова, у кожного),
// «Шквал», «Голка», «Град» (протокол і виріб у «Кузні», склад). ADR-0002: чисте ядро.
// Зброя з одним режимом — поле `only` (ADR-0149 п. 10): профілі недоступних режимів дорівнюють
// дозволеному, тож дозор (`modes.snap`) — один постріл профілем зброї × 0,7 за 3 AP (рішення власника
// п20.4 «А. Як є»). Відстань на шанс не впливає (ADR-0004 у цій частині чинний).
import { RIFLE, type ShotProfile, type Weapon } from './combat';

export type WeaponId = 'rifle' | 'shotgun' | 'sniper' | 'mg';
// Зброя з «Кузні» (усе, крім стартового «Гарта»): ключі збігаються з протоколом і предметом каталогу.
export type ForgeWeaponId = Exclude<WeaponId, 'rifle'>;

function sameModes(p: ShotProfile): Weapon['modes'] {
  return { auto: { ...p }, snap: { ...p }, aimed: { ...p } };
}

// Числа — ADR-0165 п. 5 (рішення власника п20.1); назви — рішення власника п20.4 «А. Тип + назва».
export const SHOTGUN: Weapon = {
  name: 'Дробовик «Шквал»',
  damage: [4, 8],
  range: 6,
  modes: sameModes({ apCost: 3, accuracyMod: 1, shots: 1 }),
  only: ['snap'],
};

export const SNIPER_RIFLE: Weapon = {
  name: 'Гвинтівка «Голка»',
  damage: [4, 7],
  range: 18,
  modes: sameModes({ apCost: 6, accuracyMod: 1.3, shots: 1 }),
  only: ['aimed'],
};

export const MACHINE_GUN: Weapon = {
  name: 'Кулемет «Град»',
  damage: [3, 5],
  range: 12,
  modes: sameModes({ apCost: 5, accuracyMod: 0.45, shots: 4 }),
  only: ['auto'],
};

export const WEAPONS: Readonly<Record<WeaponId, Weapon>> = { rifle: RIFLE, shotgun: SHOTGUN, sniper: SNIPER_RIFLE, mg: MACHINE_GUN };
export const WEAPON_IDS: readonly WeaponId[] = ['rifle', 'shotgun', 'sniper', 'mg'];
export const FORGE_WEAPONS: readonly ForgeWeaponId[] = ['shotgun', 'sniper', 'mg'];

export function isForgeWeapon(id: string): id is ForgeWeaponId {
  return (FORGE_WEAPONS as readonly string[]).includes(id);
}

// Ключ зброї за об'єктом юніта (ростер зберігає зброю об'єктом, ADR-0165 п. 13): за назвою каталогу;
// невідома назва (ворожа зброя) — undefined.
export function weaponIdOf(w: Pick<Weapon, 'name'>): WeaponId | undefined {
  return WEAPON_IDS.find((id) => WEAPONS[id].name === w.name);
}
