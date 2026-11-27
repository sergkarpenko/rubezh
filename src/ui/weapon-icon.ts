// п20.5 (ADR-0169; EARS 9 Фази 20): мальована іконка зброї з аркуша Gemini (assets/weapon-icons.png,
// 384 × 32 — чотири клітинки 96 × 32 у порядку WEAPON_IDS: «Гарт», «Шквал», «Голка», «Град»; дуло праворуч).
// Чисті функції: зброя → id → HTML з CSS-спрайтом; рядок із назвою — у title (підказка) і aria-label.
import type { Weapon } from '../core/combat';
import { WEAPONS, WEAPON_IDS, type WeaponId } from '../core/weapons';
import weaponIconsUrl from '../../assets/weapon-icons.png';

export const WEAPON_ICON_W = 96;
export const WEAPON_ICON_H = 32;

// Зброя юніта → id каталогу за назвою (стан бою зберігає копію профілю, а не посилання; зброя
// ворогів — поза каталогом → null).
export function weaponIdOf(w: Weapon): WeaponId | null {
  return WEAPON_IDS.find((id) => WEAPONS[id].name === w.name) ?? null;
}

// Іконка шириною width CSS px (висота — за пропорцією клітинки аркуша 3 : 1).
// decorative — поруч уже є назва (кнопка вікна спорядження): без підпису, aria-hidden.
export function weaponIconHtml(id: WeaponId, width: number, cls = 'wpn-icon', decorative = false): string {
  const k = width / WEAPON_ICON_W;
  const h = Math.round(WEAPON_ICON_H * k);
  const name = WEAPONS[id].name.replace(/"/g, '&quot;');
  return (
    '<span class="' +
    cls +
    '" data-weapon="' +
    id +
    (decorative ? '" aria-hidden="true' : '" role="img" aria-label="' + name + '" title="' + name) +
    '" style="width:' +
    width +
    'px;height:' +
    h +
    'px;background-image:url(' +
    weaponIconsUrl +
    ');background-size:' +
    Math.round(WEAPON_ICON_W * WEAPON_IDS.length * k) +
    'px ' +
    h +
    'px;background-position:' +
    -Math.round(WEAPON_IDS.indexOf(id) * width) +
    'px 0"></span>'
  );
}
