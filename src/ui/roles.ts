// п16.4 (ADR-0147, рішення власника Т.186 — усі «А»): шар відображення кар'єри й ролей —
// шеврон звання, значок і описи ролі, рядок ростера, вікно вибору ролі, плитка дії ролі.
// Чисті функції: дані ядра → рядки й HTML; DOM чіпають panels.ts, battle.ts і main.ts.
import {
  DASH_AP_BONUS,
  FIELD_AID_AMOUNT,
  FIELD_AID_AP_COST,
  PRECISE_AP_COST,
  preciseMult,
  roleActionBlock,
  type BattleRole,
  type RoleSpec,
  type GameState,
} from '../core/combat';
import { RANK_NAMES, rankOf, xpToNextRank, type SoldierCareer } from '../core/career';
import type { IconName } from './icons';

export interface RoleInfo {
  name: string; // «Штурмовик»
  action: string; // «Ривок» — назва дії ролі
  tile: string; // підпис плитки
  glyph: string; // значок ролі в тексті (ростер, картка смуги загону, журнал)
  icon: IconName; // іконка плитки дії
  ap: number; // ціна дії в AP
  desc: string; // опис дії у вікні вибору (рішення власника «А»)
}

const num = (x: number): string => String(x).replace('.', ',');

export const ROLE_INFO: Record<BattleRole, RoleInfo> = {
  assault: {
    name: 'Штурмовик',
    action: 'Ривок',
    tile: 'Ривок',
    glyph: '»',
    icon: 'dash',
    ap: 0,
    desc: '+' + DASH_AP_BONUS + ' AP цього ходу, сама дія — 0 AP',
  },
  sniper: {
    name: 'Снайпер',
    action: 'Точний постріл',
    tile: 'Точний',
    glyph: '◎',
    icon: 'precise',
    ap: PRECISE_AP_COST,
    desc: sniperDesc(),
  },
  medic: {
    name: 'Медик',
    action: 'Польова допомога',
    tile: 'Допомога',
    glyph: '✚',
    icon: 'aid',
    ap: FIELD_AID_AP_COST,
    desc: '+' + FIELD_AID_AMOUNT + ' HP собі чи сусідові без гелю — ' + FIELD_AID_AP_COST + ' AP',
  },
};

// п22.2 (ADR-0183): опис «Точного пострілу» з множником спеціалізації («Мисливець» — ×2).
export function sniperDesc(spec?: RoleSpec): string {
  return 'прицільний постріл, шкода ×' + num(preciseMult(spec)) + ' — ' + PRECISE_AP_COST + ' AP';
}

export const ROLE_ORDER: readonly BattleRole[] = ['assault', 'sniper', 'medic'];

// Шеврон звання кодом (ADR-0147 п. 6): 1–4 смужки за званням 0–3; підпис — aria-label.
export function chevronHtml(rank: number): string {
  let bars = '';
  for (let i = 0; i <= rank; i++) bars += '<i></i>';
  return '<span class="chev" role="img" aria-label="' + RANK_NAMES[rank] + '" title="' + RANK_NAMES[rank] + '">' + bars + '</span>';
}

// Рядок досвіду в ростері: «досвід 6 · до «Ветеран» 3»; найвище звання — без «до …».
export function xpLine(career: SoldierCareer): string {
  const left = xpToNextRank(career.xp);
  const rank = rankOf(career.xp);
  return 'досвід ' + career.xp + (left === null ? ' · найвище звання' : ' · до «' + RANK_NAMES[rank + 1] + '» ' + left);
}

// Роль у ростері: «◎ снайпер»; «Боєць» і вище без ролі — «роль не обрано»; «Рекрут» — нічого.
export function roleLabel(career: SoldierCareer): string {
  if (career.role !== null) return ROLE_INFO[career.role].glyph + ' ' + ROLE_INFO[career.role].name.toLowerCase();
  return rankOf(career.xp) >= 1 ? 'роль не обрано' : '';
}

// Заголовок вікна вибору ролі (EARS 4): «Підвищення: «Шрам» — Боєць. Оберіть роль».
export function roleDialogTitle(career: SoldierCareer): string {
  return 'Підвищення: «' + career.callsign + '» — ' + RANK_NAMES[rankOf(career.xp)] + '. Оберіть роль';
}

// Вміст вікна вибору ролі: заголовок, примітка, три кнопки «Роль — «Дія»» з описом.
export function roleDialogHtml(career: SoldierCareer): string {
  return (
    '<div class="panel screen-dialog"><h2 id="role-dialog-title" tabindex="-1">' +
    roleDialogTitle(career) +
    '</h2><p class="meta">Роль — назавжди. Дія ролі — раз за бій.</p>' +
    ROLE_ORDER.map(
      (r) =>
        '<button type="button" class="role-pick" data-role="' +
        r +
        '" id="btn-role-' +
        r +
        '"><b>' +
        ROLE_INFO[r].glyph +
        ' ' +
        ROLE_INFO[r].name +
        ' — «' +
        ROLE_INFO[r].action +
        '»</b><span class="meta">' +
        ROLE_INFO[r].desc +
        '</span></button>'
    ).join('') +
    '</div>'
  );
}

// Коротка причина під неактивною плиткою ролі (патерн Т.33) з повного тексту ядра.
function shortReason(full: string): string {
  if (full.startsWith('Немає ролі')) return 'без ролі';
  if (full.includes('вже використано')) return 'вже було';
  if (full.includes('прицільного режиму')) return 'без прицільного'; // п20.4 (рішення власника «А»)
  if (full.startsWith('Недостатньо')) return 'мало AP';
  return 'недоступно';
}

export interface RoleTileView {
  role: BattleRole | null; // роль вибраного (null — немає вибраного чи ролі)
  label: string; // підпис плитки (aria-label)
  hint: string; // тултіп: опис дії + причина
  reason: string | null; // коротка причина під плиткою; null — доступна
}

// Стан плитки дії ролі для вибраного бійця: причина — з roleActionBlock ядра (EARS 6).
export function roleTileView(state: GameState, selId: string | null): RoleTileView {
  const role = selId === null ? null : (state.roles?.[selId]?.role ?? null);
  if (selId === null) return { role: null, label: 'Роль', hint: 'Дія ролі — раз за бій · клавіша R', reason: null };
  if (role === null) {
    return { role: null, label: 'Роль', hint: 'Дія ролі — раз за бій · клавіша R — у оперативника немає ролі', reason: 'без ролі' };
  }
  const info = ROLE_INFO[role];
  const base = info.ap + ' AP · «' + info.action + '»: ' + info.desc + ' · раз за бій · клавіша R';
  const block = roleActionBlock(state, selId, role);
  return { role, label: info.tile, hint: block === null ? base : base + ' — ' + block, reason: block === null ? null : shortReason(block) };
}
