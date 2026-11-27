// Т.131 (кандидат 128, рішення 4 дизайн-сесії Т.125): меню на ворогові.
// Тап по видимому демону без зведеного режиму — картка біля нього: назва, HP
// числом і смугою, відстань, зброя демона; кнопки пострілів з AP і шансом
// (стріляють одразу) і «Граната» (зводить гранату з епіцентром на демоні).
// п20.2–п20.5: шанс кнопок — з укриттям цілі від стрільця (ADR-0166), рядок укриття — під відстанню (ADR-0169).
// Чисті функції: стан бою → дані картки → HTML і місце; DOM чіпає src/ui/battle.ts.
// п17.2 (ADR-0149 п. 15; рішення власника «А. Окремий рядок»): ближній бій — «впритул»
// замість дальності; зброя з одним режимом — рядок «Лише …»; броня — рядок «Броня N: −N
// від влучання». Назва типу — в імені; п21.5 (ADR-0179): «Гончак Скрегіт» і бюст у шапці.
import {
  GRENADE_AP_COST,
  GRENADE_RANGE,
  calculateHitChance,
  shotCover,
  distance,
  hasLineOfSight,
  hasTerrainLine,
  weaponHasMode,
  type CoverLevel,
  type GameState,
  type ShotMode,
  type Unit,
} from '../core/combat';
import { ENEMY_NAMES, ENEMY_ORDER, enemyKind, type EnemyKind } from '../core/enemies';
import { ATLAS_ROW } from '../render';
import { coverMenuLine } from './cover-ui';
import unitAtlasUrl from '../../assets/units-atlas.png';
import enemyPortraitsUrl from '../../assets/enemy-portraits.png';

// Чому дія недоступна — ті самі перевірки, що й assertCanFire / throwGrenade ядра
// п20.4 (ADR-0168): 'mode' — режиму немає у зброї стрільця (перша перевірка assertCanFire після цілі)
export type MenuBlock = 'mode' | 'ap' | 'range' | 'los' | 'none' | null;

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
  kind: EnemyKind; // п17.5: тип — мініатюра з ряду атласа
  name: string;
  hp: number;
  maxHp: number;
  weapon: string;
  damage: readonly [number, number];
  weaponRange: number;
  only: ShotMode | null; // п17.2: єдиний режим зброї ворога (око — прицільний), інакше null
  armor: number; // п17.2: броня (голем — 2), 0 — без броні
  // null — бійця не вибрано: картка лише з інформацією
  // п20.5: cover — укриття цілі від стрільця (undefined — укриття не діє: бій без `cover`, удар впритул)
  shooter: { dist: number; cover: CoverLevel | undefined; shots: EnemyMenuShot[]; grenade: MenuBlock } | null;
}

// Порядок кнопок — як плитки й клавіші 1–3
export const MENU_SHOTS: readonly ShotMode[] = ['snap', 'aimed', 'auto'];
const SHOT_LABEL: Record<ShotMode, string> = { snap: 'Швидкий', aimed: 'Прицільний', auto: 'Черга' };
const BLOCK_TEXT: Record<Exclude<MenuBlock, null>, string> = {
  mode: 'немає в зброї', // п20.4: той самий підпис, що на плитці режиму
  ap: 'мало AP',
  range: 'далеко',
  los: 'немає лінії',
  none: 'без гранат', // той самий підпис, що на плитці гранати
};

export function enemyMenuView(state: GameState, target: Unit, shooter: Unit | undefined): EnemyMenuView {
  const w = target.weapon;
  const view: EnemyMenuView = {
    id: target.id,
    kind: enemyKind(target),
    name: target.name,
    hp: target.hp,
    maxHp: target.maxHp,
    weapon: w.name,
    damage: w.damage,
    weaponRange: w.range,
    only: w.only?.length === 1 ? w.only[0] : null,
    armor: target.armor ?? 0,
    shooter: null,
  };
  if (shooter === undefined) return view;
  const dist = distance(shooter.pos, target.pos);
  const los = hasLineOfSight(state, shooter.pos, target.pos, shooter.side);
  const cover = shotCover(state, shooter, target);
  const shots = MENU_SHOTS.map((mode): EnemyMenuShot => {
    const p = shooter.weapon.modes[mode];
    // порядок причин — як у assertCanFire: режим зброї (п20.4), дальність, лінія, AP
    const block: MenuBlock = !weaponHasMode(shooter.weapon, mode)
      ? 'mode'
      : dist > shooter.weapon.range
        ? 'range'
        : !los
          ? 'los'
          : shooter.ap < p.apCost
            ? 'ap'
            : null;
    return {
      mode,
      label: SHOT_LABEL[mode],
      ap: p.apCost,
      chancePct: Math.round(calculateHitChance(shooter, mode, cover) * 100), // п20.2: з укриттям цілі
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
        : !hasTerrainLine(state, shooter.pos, target.pos) // п17.4: лінія кидка — лише рельєф
          ? 'los'
          : null;
  view.shooter = { dist, cover, shots, grenade };
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

// п17.5 (ADR-0152; рішення власника «А. Мініатюра типу»): кадр «стій» свого ряду атласа бійців —
// фігура (x 8–88, y 33–93 кадру 96) у 2/3 масштабу: 53 × 40 px; атлас 480 × 480 → 320 × 320
// (п21.6, ADR-0180: атлас 672 × 480 зі стовпцями пострілу вгору / вниз → 448 × 320).
// п21.5 (ADR-0179): це запасний шар під бюстом — видно, якщо атлас бюстів не завантажився;
// у колі 40 px фігуру зсунуто на FACE_SHIFT, щоб тулуб був по центру.
export const FACE_SCALE = 2 / 3;
export const FACE_SHIFT = -6;
// п21.5 (ADR-0179; рішення власника «А. 4 на тип»): мальований бюст ворога з атласа
// assets/enemy-portraits.png (384 × 384, клітинки 96 × 96): ряд — тип (ENEMY_ORDER), стовпець —
// обличчя 0–3 за місцем імені в пулі типу (ENEMY_NAMES) по колу; ім'я поза пулом — обличчя 0.
export const ENEMY_PORTRAIT_SIZE = 40;
export const ENEMY_FACES = 4;
export function enemyPortraitCell(kind: EnemyKind, name: string): { col: number; row: number } {
  const i = ENEMY_NAMES[kind].indexOf(name.split(' ')[1] ?? '');
  return { col: Math.max(i, 0) % ENEMY_FACES, row: ENEMY_ORDER.indexOf(kind) };
}
export function enemyFaceStyle(kind: EnemyKind, name: string): string {
  const c = enemyPortraitCell(kind, name);
  const atlas = ENEMY_PORTRAIT_SIZE * ENEMY_FACES;
  const x = -Math.round(8 * FACE_SCALE) + FACE_SHIFT;
  const y = -Math.round((ATLAS_ROW[kind] * 96 + 33) * FACE_SCALE);
  return (
    'background-image:url(' +
    enemyPortraitsUrl +
    '),url(' +
    unitAtlasUrl +
    ');background-size:' +
    atlas +
    'px ' +
    atlas +
    'px,448px 320px;background-position:' +
    -c.col * ENEMY_PORTRAIT_SIZE +
    'px ' +
    -c.row * ENEMY_PORTRAIT_SIZE +
    'px,' +
    x +
    'px ' +
    y +
    'px'
  );
}

export function enemyMenuHtml(v: EnemyMenuView): string {
  const pct = v.maxHp > 0 ? Math.round((v.hp / v.maxHp) * 100) : 0;
  let html =
    '<div class="em-head"><span class="em-face" data-kind="' +
    v.kind +
    '" data-face="' +
    enemyPortraitCell(v.kind, v.name).col +
    '" style="' +
    enemyFaceStyle(v.kind, v.name) +
    '"></span><span class="em-name">' +
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
    (v.weaponRange === 1 ? ' · впритул' : ' · дальність ' + v.weaponRange) +
    '</div>';
  // п17.2: рядок єдиного режиму — для зброї на відстані (удар гончака вже «впритул»)
  if (v.only !== null && v.weaponRange > 1) html += '<div class="em-line">Лише ' + SHOT_LABEL[v.only].toLowerCase() + '</div>';
  if (v.armor > 0) html += '<div class="em-line">Броня ' + v.armor + ': −' + v.armor + ' від влучання</div>';
  const s = v.shooter;
  if (s === null) return html + '<div class="em-line em-hint">Виберіть бійця — тоді постріли.</div>';
  html += '<div class="em-line">Відстань ' + s.dist + '</div>';
  // п20.5 (рішення власника «А. З множником»): рядок укриття цілі від обраного бійця
  const coverLine = coverMenuLine(s.cover);
  if (coverLine !== null) html += '<div class="em-line em-cover" data-cover="' + s.cover + '">' + coverLine + '</div>';
  html += '<div class="em-acts">';
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
