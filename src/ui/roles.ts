// п16.4 (ADR-0147, рішення власника Т.186 — усі «А»): шар відображення кар'єри й ролей —
// шеврон звання, значок і описи ролі, рядок ростера, вікно вибору ролі, плитка дії ролі.
// Чисті функції: дані ядра → рядки й HTML; DOM чіпають panels.ts, battle.ts і main.ts.
import {
  aidAmount,
  dashBonus,
  FIELD_AID_AP_COST,
  PRECISE_AP_COST,
  preciseMult,
  roleActionBlock,
  type BattleRole,
  type RoleSpec,
  type GameState,
} from '../core/combat';
import {
  BRANCH_EFFECTS,
  BRANCH_NAMES,
  branchOptions,
  RANK_NAMES,
  rankOf,
  ROLE_RANK,
  SERGEANT_RANK,
  VETERAN_RANK,
  xpToNextRank,
  type BranchTier,
  type CareerBranch,
  type SoldierCareer,
} from '../core/career';
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
    desc: roleDesc('assault'),
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
    desc: roleDesc('medic'),
  },
};

// п22.2 (ADR-0183): опис «Точного пострілу» з множником спеціалізації («Мисливець» — ×2).
// п22.2: опис дії ролі з числом спеціалізації (без спеціалізації — `ROLE_INFO[role].desc`).
export function roleDesc(role: BattleRole, spec?: RoleSpec): string {
  if (role === 'assault') return '+' + dashBonus(spec) + ' AP цього ходу, сама дія — 0 AP';
  if (role === 'sniper') return sniperDesc(spec);
  return '+' + aidAmount(spec) + ' HP собі чи сусідові без гелю — ' + FIELD_AID_AP_COST + ' AP';
}

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

// п22.3 (ADR-0185; рішення власника «А. Сходинки»): смуга шляху в картці ростера — рядок на звання:
// «✓» пройдені з обраною гілкою, «●» поточне, «○» наступна розвилка з ефектом обох гілок; під ними —
// рядок досвіду (`xpLine`). «Рекрут» рядка не має — лише наступна розвилка (роль).
const roleShort = (r: BattleRole): string => ROLE_INFO[r].glyph + ' ' + ROLE_INFO[r].name.toLowerCase();

// Обрана гілка звання (1 — роль, 2 — спеціалізація, 3 — навичка); null — ще не обрано.
function chosenBranch(career: SoldierCareer, rank: number): string | null {
  if (rank === ROLE_RANK) return career.role === null ? null : roleShort(career.role);
  const b = rank === VETERAN_RANK ? career.branches?.veteran : career.branches?.sergeant;
  return b === undefined ? null : BRANCH_NAMES[b];
}

// Варіанти розвилки звання з ефектом: «Прорив — «Ривок» +6 AP замість +4 · Панцир — броня 1».
function forkText(career: SoldierCareer, rank: number): string {
  if (rank === ROLE_RANK) return 'роль — ' + ROLE_ORDER.map(roleShort).join(' · ');
  const opts = branchOptions(career, rank === VETERAN_RANK ? 'veteran' : 'sergeant');
  if (opts.length === 0) return 'спеціалізація ролі';
  return opts.map((b) => '<b>' + BRANCH_NAMES[b] + '</b> — ' + BRANCH_EFFECTS[b]).join(' · ');
}

export function careerPathHtml(career: SoldierCareer): string {
  const rank = rankOf(career.xp);
  let html = '<div class="s-path">';
  for (let r = ROLE_RANK; r <= Math.min(VETERAN_RANK, rank + 1); r++) {
    if (r > rank) html += '<div class="p-next">○ ' + RANK_NAMES[r] + ': ' + forkText(career, r) + '</div>';
    else
      html +=
        '<div class="' +
        (r === rank ? 'p-cur">● ' : 'p-done">✓ ') +
        RANK_NAMES[r] +
        ' · ' +
        (chosenBranch(career, r) ?? 'чекає вибору') +
        '</div>';
  }
  return html + '<div class="meta">' + xpLine(career) + '</div></div>';
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

// п22.3 (ADR-0185; тексти власника «Як на аркуші»): вікно вибору гілки за зразком вікна ролі.
// Заголовок: «Підвищення: «Сокіл» — Сержант. Оберіть спеціалізацію» / «… — Ветеран. Оберіть навичку».
export function branchDialogTitle(career: SoldierCareer, tier: BranchTier): string {
  return (
    'Підвищення: «' +
    career.callsign +
    '» — ' +
    RANK_NAMES[tier === 'veteran' ? VETERAN_RANK : SERGEANT_RANK] +
    '. Оберіть ' +
    (tier === 'veteran' ? 'навичку' : 'спеціалізацію')
  );
}

// Примітка під заголовком: спеціалізація підсилює дію своєї ролі, навичка діє в кожному бою.
export function branchDialogNote(career: SoldierCareer, tier: BranchTier): string {
  if (tier === 'veteran' || career.role === null) return 'Навичка — назавжди. Діє в кожному бою.';
  return 'Спеціалізація — назавжди. Підсилює дію ролі «' + ROLE_INFO[career.role].action + '».';
}

// Вміст вікна: заголовок, примітка, дві кнопки «Назва» з ефектом гілки (каталог п22.2).
export function branchDialogHtml(career: SoldierCareer, tier: BranchTier): string {
  return (
    '<div class="panel screen-dialog"><h2 id="role-dialog-title" tabindex="-1">' +
    branchDialogTitle(career, tier) +
    '</h2><p class="meta">' +
    branchDialogNote(career, tier) +
    '</p>' +
    branchOptions(career, tier)
      .map(
        (b: CareerBranch) =>
          '<button type="button" class="role-pick" data-branch="' +
          b +
          '" id="btn-branch-' +
          b +
          '"><b>' +
          BRANCH_NAMES[b] +
          '</b><span class="meta">' +
          BRANCH_EFFECTS[b] +
          '</span></button>'
      )
      .join('') +
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
  if (selId === null) return { role: null, label: 'Роль', hint: 'Дія ролі — раз за бій («Рятівник» — двічі) · клавіша R', reason: null };
  if (role === null) {
    return {
      role: null,
      label: 'Роль',
      hint: 'Дія ролі — раз за бій («Рятівник» — двічі) · клавіша R — у оперативника немає ролі',
      reason: 'без ролі',
    };
  }
  const info = ROLE_INFO[role];
  const spec = state.roles?.[selId]?.spec; // п22.2 (ADR-0183): число дії і «двічі» — за спеціалізацією
  const base =
    info.ap +
    ' AP · «' +
    info.action +
    '»: ' +
    roleDesc(role, spec) +
    (spec === 'rescuer' ? ' · двічі за бій' : ' · раз за бій') +
    ' · клавіша R';
  const block = roleActionBlock(state, selId, role);
  return { role, label: info.tile, hint: block === null ? base : base + ' — ' + block, reason: block === null ? null : shortReason(block) };
}
