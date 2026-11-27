// Т.130 (кандидат 127, рішення 3 дизайн-сесії Т.125): смуга загону в бою.
// Картка бійця — аватар «шолом» (ADR-0118), ім'я, HP числом і смугою, AP
// поділками, риска кольору бійця; вибраний — рамка і світіння його кольору.
// Клік по картці — те саме, що тап по бійцю на полі (src/ui/input.ts).
// Чисті функції: стан бою → дані карток → HTML; DOM чіпає лише src/ui/battle.ts.
import type { GameState } from '../core/combat';
import { rankOf, type SoldierCareer } from '../core/career';
import { fighterLook } from '../core/render-core';
import { portraitHtml } from './portrait';
import { ROLE_INFO, chevronHtml } from './roles';
import { byGender } from './text';
import { weaponIconHtml, weaponIdOf } from './weapon-icon';
import type { WeaponId } from '../core/weapons';

export type SquadCardStatus = 'ready' | 'down' | 'evac';

export interface SquadCardView {
  id: string;
  name: string;
  hp: number;
  maxHp: number;
  ap: number;
  maxAp: number;
  status: SquadCardStatus;
  selected: boolean;
  // п16.4 (ADR-0147 п. 6): позивний замість імені, звання (шеврон) і значок ролі; без кар'єри — ім'я
  callsign?: string;
  rank?: number;
  roleGlyph?: string;
  // п20.5 (ADR-0169; EARS 9): зброя бійця — мальована іконка в рядку імені; поза каталогом — без іконки
  weapon?: WeaponId;
}

// Префікс id кліпа аватара в смузі: той самий боєць є й у ростері (`av-cp-<id>`).
export const SQUAD_CLIP_PREFIX = 'sq-cp-';
// п20.5: ширина іконки зброї на картці, CSS px (42 × 14)
export const SQUAD_WEAPON_W = 42;
// п21.4 (ADR-0178): сторона аватара (бюст у кільці) на картці смуги загону, CSS px — рішення власника «Б. Більші»
export const SQUAD_AVATAR = 32;

// Порядок карток — порядок висадки (перші id оперативників у стані бою);
// загиблий лишається в units, евакуйований переходить у evacuated — картка
// не міняє місця. Невідомі порядку id (не мали б з'являтись) — у кінці.
export function squadOrder(state: GameState): string[] {
  const ids = state.units.filter((u) => u.side === 'player').map((u) => u.id);
  for (const u of state.evacuated ?? []) if (!ids.includes(u.id)) ids.push(u.id);
  return ids;
}

export function squadCards(
  state: GameState,
  order: string[],
  selectedId: string | null,
  careers: Readonly<Record<string, SoldierCareer>> = {}
): SquadCardView[] {
  const byId = new Map<string, { u: GameState['units'][number]; status: SquadCardStatus }>();
  for (const u of state.units) if (u.side === 'player') byId.set(u.id, { u, status: u.alive ? 'ready' : 'down' });
  for (const u of state.evacuated ?? []) byId.set(u.id, { u, status: 'evac' });
  const ids = [...order.filter((id) => byId.has(id)), ...[...byId.keys()].filter((id) => !order.includes(id))];
  return ids.map((id) => {
    const { u, status } = byId.get(id)!;
    const c = careers[id];
    const role = state.roles?.[id]?.role;
    const weapon = weaponIdOf(u.weapon);
    return {
      ...(c ? { callsign: c.callsign, rank: rankOf(c.xp) } : {}),
      ...(role ? { roleGlyph: ROLE_INFO[role].glyph } : {}),
      ...(weapon !== null ? { weapon } : {}),
      id,
      name: u.name,
      hp: status === 'down' ? 0 : u.hp,
      maxHp: u.maxHp,
      ap: status === 'ready' ? u.ap : 0,
      maxAp: u.maxAp,
      status,
      selected: status === 'ready' && id === selectedId,
    };
  });
}

// Колір смуги HP — та сама шкала, що в ростері (hpColor у panels.ts), але яскравіша для смуги
function hpBarColor(hp: number, maxHp: number): string {
  return hp >= maxHp ? '#7fe2a0' : hp > maxHp / 2 ? '#f5c86a' : '#ff7a7a';
}

// #rrggbb → rgba(…, a): світіння вибраної картки кольору бійця
export function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return 'rgba(' + ((n >> 16) & 255) + ', ' + ((n >> 8) & 255) + ', ' + (n & 255) + ', ' + a + ')';
}

export function squadCardLabel(c: SquadCardView): string {
  // п16.4: «Іван «Крук»» — ім'я з позивним (на картці — позивний, ім'я — у підписі для диктора й підказці)
  const who = c.callsign === undefined ? c.name : c.name + ' «' + c.callsign + '»';
  if (c.status === 'down') return who + ': ' + byGender(c.name, 'загинув', 'загинула');
  if (c.status === 'evac') return who + ': евакуйовано';
  return who + ': HP ' + c.hp + '/' + c.maxHp + ' · AP ' + c.ap + '/' + c.maxAp;
}

function cardHtml(c: SquadCardView): string {
  const col = fighterLook(c.id).color;
  const pct = c.maxHp > 0 ? Math.round((100 * Math.max(0, c.hp)) / c.maxHp) : 0;
  let foot: string;
  // Т.130 (рішення власника): картка вибулого лишається приглушеною з підписом; на телефоні — лише значок
  if (c.status === 'down')
    foot = '<span class="sq-state">✝<span class="sq-st-txt"> ' + byGender(c.name, 'Загинув', 'Загинула') + '</span></span>';
  else if (c.status === 'evac') foot = '<span class="sq-state">⇧<span class="sq-st-txt"> Евакуйовано</span></span>';
  else {
    foot = '<span class="sq-ap">';
    for (let i = 0; i < c.maxAp; i++) foot += i < c.ap ? '<i class="on"></i>' : '<i></i>';
    foot += '</span>';
  }
  const label = squadCardLabel(c);
  return (
    '<button type="button" class="sq-card' +
    (c.selected ? ' sel' : '') +
    (c.status !== 'ready' ? ' ' + c.status : '') +
    '" data-unit="' +
    c.id +
    '" style="--c:' +
    col +
    ';--g:' +
    rgba(col, 0.55) +
    '" aria-pressed="' +
    c.selected +
    '" aria-label="' +
    label +
    '" title="' +
    label +
    (c.status === 'ready' ? ' · Q — наступний боєць' : '') +
    '"' +
    (c.status !== 'ready' ? ' disabled' : '') +
    '>' +
    // п16.4: шеврон звання — у куті аватара (на вузькій картці не забирає місця в позивного)
    (c.rank !== undefined
      ? '<span class="sq-av">' + portraitHtml(c.id, SQUAD_AVATAR, SQUAD_CLIP_PREFIX) + chevronHtml(c.rank) + '</span>'
      : portraitHtml(c.id, SQUAD_AVATAR, SQUAD_CLIP_PREFIX)) +
    '<span class="sq-body"><span class="sq-head"><span class="sq-name">' +
    (c.roleGlyph !== undefined ? '<span class="sq-role">' + c.roleGlyph + '</span>' : '') +
    (c.callsign ?? c.name) +
    '</span>' +
    (c.weapon !== undefined ? weaponIconHtml(c.weapon, SQUAD_WEAPON_W, 'wpn-icon sq-wpn') : '') +
    '<span class="sq-hpn">' +
    (c.status === 'ready' ? c.hp + '/' + c.maxHp : '') +
    '</span></span><span class="sq-hp"><i style="width:' +
    pct +
    '%;background:' +
    hpBarColor(c.hp, c.maxHp) +
    '"></i></span>' +
    foot +
    '</span></button>'
  );
}

export function squadStripHtml(cards: SquadCardView[]): string {
  return cards.map(cardHtml).join('');
}
