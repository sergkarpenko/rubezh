// Т.131 (кандидат 128, рішення 4 дизайн-сесії Т.125): меню на ворогові.
// Тап по видимому демону без зведеного режиму — картка біля нього: назва, HP
// числом і смугою, відстань, зброя демона; кнопки пострілів з AP і шансом
// (стріляють одразу) і «Граната» (зводить гранату з епіцентром на демоні).
// Укриття в грі немає: шанс — лише від стрільця і режиму (ADR-0004).
// Чисті функції: стан бою → дані картки → HTML і місце; DOM чіпає src/ui/battle.ts.
import {
  GRENADE_AP_COST,
  GRENADE_RANGE,
  calculateHitChance,
  distance,
  hasLineOfSight,
  type GameState,
  type ShotMode,
  type Unit,
} from '../core/combat';

// Чому дія недоступна — ті самі перевірки, що й assertCanFire / throwGrenade ядра
export type MenuBlock = 'ap' | 'range' | 'los' | 'none' | null;

export interface EnemyMenuShot {
  mode: ShotMode;
  label: string;
  ap: number;
  chancePct: number;
  shots: number;
  block: MenuBlock;
}

export interface EnemyMenuView {
  id: string;
  name: string;
  hp: number;
  maxHp: number;
  weapon: string;
  damage: readonly [number, number];
  weaponRange: number;
  // null — бійця не вибрано: картка лише з інформацією
  shooter: { dist: number; shots: EnemyMenuShot[]; grenade: MenuBlock } | null;
}

// Порядок кнопок — як плитки й клавіші 1–3
export const MENU_SHOTS: readonly ShotMode[] = ['snap', 'aimed', 'auto'];
const SHOT_LABEL: Record<ShotMode, string> = { snap: 'Швидкий', aimed: 'Прицільний', auto: 'Черга' };
const BLOCK_TEXT: Record<Exclude<MenuBlock, null>, string> = {
  ap: 'мало AP',
  range: 'далеко',
  los: 'немає лінії',
  none: 'без гранат', // той самий підпис, що на плитці гранати
};

export function enemyMenuView(state: GameState, target: Unit, shooter: Unit | undefined): EnemyMenuView {
  const w = target.weapon;
  const view: EnemyMenuView = {
    id: target.id,
    name: target.name,
    hp: target.hp,
    maxHp: target.maxHp,
    weapon: w.name,
    damage: w.damage,
    weaponRange: w.range,
    shooter: null,
  };
  if (shooter === undefined) return view;
  const dist = distance(shooter.pos, target.pos);
  const los = hasLineOfSight(state, shooter.pos, target.pos);
  const shots = MENU_SHOTS.map((mode): EnemyMenuShot => {
    const p = shooter.weapon.modes[mode];
    // порядок причин — як у assertCanFire: дальність, лінія, AP
    const block: MenuBlock = dist > shooter.weapon.range ? 'range' : !los ? 'los' : shooter.ap < p.apCost ? 'ap' : null;
    return {
      mode,
      label: SHOT_LABEL[mode],
      ap: p.apCost,
      chancePct: Math.round(calculateHitChance(shooter, mode) * 100),
      shots: p.shots,
      block,
    };
  });
  // граната: порядок — як у throwGrenade (предмет, AP, дальність, лінія кидка)
  const grenade: MenuBlock = !state.items?.[shooter.id]?.grenade
    ? 'none'
    : shooter.ap < GRENADE_AP_COST
      ? 'ap'
      : dist > GRENADE_RANGE
        ? 'range'
        : !los
          ? 'los'
          : null;
  view.shooter = { dist, shots, grenade };
  return view;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function hpColor(hp: number, maxHp: number): string {
  return hp >= maxHp ? '#7fe2a0' : hp > maxHp / 2 ? '#f5c86a' : '#ff7a7a';
}

// кнопка — два рядки: назва і «AP · шанс»; недоступна — вимкнена, замість другого рядка причина
// (кнопка вузька: 88 px тексту — виміри Т.131 з DejaVu Sans)
function button(action: string, label: string, ap: number, chance: string, block: MenuBlock): string {
  const meta = block === null ? ap + ' AP · ' + chance : BLOCK_TEXT[block];
  return (
    '<button type="button" data-act="' +
    action +
    '"' +
    (block === null ? '' : ' disabled') +
    '><span class="em-lbl">' +
    label +
    '</span><span class="em-meta">' +
    meta +
    '</span></button>'
  );
}

export function enemyMenuHtml(v: EnemyMenuView): string {
  const pct = v.maxHp > 0 ? Math.round((v.hp / v.maxHp) * 100) : 0;
  let html =
    '<div class="em-head"><span class="em-name">' +
    esc(v.name) +
    '</span><span class="em-hpn">HP ' +
    v.hp +
    '/' +
    v.maxHp +
    '</span></div>' +
    '<div class="em-hp"><i style="width:' +
    pct +
    '%;background:' +
    hpColor(v.hp, v.maxHp) +
    '"></i></div>' +
    '<div class="em-line" title="«' +
    esc(v.weapon) +
    '»">Шкода ' +
    v.damage[0] +
    '–' +
    v.damage[1] +
    ' · дальність ' +
    v.weaponRange +
    '</div>';
  const s = v.shooter;
  if (s === null) return html + '<div class="em-line em-hint">Виберіть бійця — тоді постріли.</div>';
  html += '<div class="em-line">Відстань ' + s.dist + '</div><div class="em-acts">';
  for (const shot of s.shots) {
    html += button(shot.mode, shot.label, shot.ap, (shot.shots > 1 ? shot.shots + '×' : '') + '~' + shot.chancePct + '%', shot.block);
  }
  html += button('grenade', 'Граната', GRENADE_AP_COST, 'зона', s.grenade);
  return html + '</div>';
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

// Місце картки в межах поля (координати контейнера поля, CSS px): праворуч від
// клітинки демона; не вміщується — ліворуч («перевертається»), далі — під нею чи над нею;
// поперек — центр на клітинці, притиснутий до меж поля. Ніде цілком (мале поле, демон у
// центрі) — на ширшому боці, притиснута до краю, covers: true — картка накриває клітинку
// демона, і battle.ts пробує компактну картку (аудит PR #444).
export type MenuSide = 'right' | 'left' | 'below' | 'above';
export function enemyMenuPlace(
  cell: Box,
  field: Box,
  w: number,
  h: number,
  gap = 6
): { left: number; top: number; side: MenuSide; covers: boolean } {
  const fr = field.left + field.width;
  const fb = field.top + field.height;
  const clampX = (x: number): number => Math.max(field.left, Math.min(x, fr - w));
  const clampY = (y: number): number => Math.max(field.top, Math.min(y, fb - h));
  const midY = clampY(cell.top + cell.height / 2 - h / 2);
  const midX = clampX(cell.left + cell.width / 2 - w / 2);
  const right = cell.left + cell.width + gap;
  const left = cell.left - gap - w;
  const below = cell.top + cell.height + gap;
  const above = cell.top - gap - h;
  let at: { left: number; top: number; side: MenuSide; covers: boolean };
  if (right + w <= fr) at = { left: right, top: midY, side: 'right', covers: false };
  else if (left >= field.left) at = { left, top: midY, side: 'left', covers: false };
  else if (below + h <= fb) at = { left: midX, top: below, side: 'below', covers: false };
  else if (above >= field.top) at = { left: midX, top: above, side: 'above', covers: false };
  else if (fr - right >= cell.left - gap - field.left) at = { left: clampX(right), top: midY, side: 'right', covers: true };
  else at = { left: clampX(left), top: midY, side: 'left', covers: true };
  return { left: Math.round(at.left), top: Math.round(at.top), side: at.side, covers: at.covers };
}
