// src/core/render-core.ts — чиста логіка кадрів і анімацій (пR.3, ADR-0038;
// П6.8 ADR-0029, П6.13): типи анімацій і фабрики, прогрес/позиція/тряска,
// черга AnimEngine з ін'єктованим планувальником, перетворювач подій логу в
// анімації (лог — джерело істини, байт-у-байт незмінний) і палітра терену
// нічного бойовища (хеш-варіація без RNG, ADR-0003). Жодного посилання на
// Canvas/DOM API (ADR-0002) — Canvas-виклики живуть у шарі відображення
// (src/render.ts), планувальник кадрів ін'єктується викликачем.

import { VISION_RANGE, distance, lineCells, type GameEvent, type Side, type Unit, type Vec2 } from './combat';
import type { EnemyKind } from './enemies';
// П14.5: розкладка геосцени 16×8 і хвіст перехоплення читають розміри світу та
// події журналу з geo.ts (лише типи/константи — ядро не змінюється, ADR-0002).
import { WORLD_H, WORLD_W, type GeoEvent } from './geo';

// --- П6.13 (П12.7, ADR-0064): неонова палітра — синьо-чорна основа, неонові акценти ---
// Ціан — гравець/«Рубіж», пурпур — Розрив, бурштин — спалахи (ADR-0064).

// Фон канви — той самий колір, що й CSS-тло елемента (index.html): при трясці
// translate оголює край 1–2px, і збіг кольорів лишає його непомітним.
// П12.7: фон поглиблено до синьо-чорного (ніч кібернетичної епохи).
export const NIGHT_BG = '#060a14';
// Двотоновий терен: відкритий / завалений, у тумані — приглушені ті самі
// тони (туман — лише рельєф, ADR-0006). «Легка варіація клітинок» — по одному
// з чотирьох відтінків на клітинку за детермінованим хешем координат (без RNG,
// ADR-0003): сусідні клітинки розрізняються, мозаїка стабільна між кадрами.
// П12.7: тони зсунуті в синьо-чорну гаму під неонові акценти.
const TERRAIN_OPEN = ['#0b1220', '#0d1424', '#0a1120', '#0c1322'];
const TERRAIN_BLOCKED = ['#2b3a55', '#30405e', '#27354e', '#2e3d5a'];
const TERRAIN_OPEN_FOG = ['#05080f', '#060a12', '#04070d', '#050911'];
const TERRAIN_BLOCKED_FOG = ['#1a2233', '#1d2537', '#182030', '#1c2435'];
// Тонка напівпрозора НЕОНОВА сітка (П12.7): 1px у проміжках між клітинками
// (клітинки малюються зі стороною cell−1 — сітка заповнює проміжок, урок П6.6).
export const GRID_COLOR = 'rgba(0,229,255,0.08)';
// М'який край туману: клітинка туману з видимим сусідом (4 напрямки)
// перекривається напівпрозорим тоном відкритої видимої клітинки — межа
// «видимо → туман» стає градієнтною. Сенс туману незмінний (ADR-0006):
// рельєф туману видно і так, вміст клітинки (юніти) не розкривається,
// перекриття однакове для порожньої і заваленої клітинки.
// П12.7: край м'якший — прозоріша заливка, перехід плавніший.
export const FOG_EDGE = 'rgba(11,18,32,0.4)';

// --- П12.7 (ADR-0064): терен геосцени — двотоновий із неоновою сіткою ---
// Геосцена не має рельєфу (туман лише в бойовищі, ADR-0006): фолбек без
// ассета картини — два синьо-чорні тони, океан GEO_CELL_A і суша GEO_CELL_B,
// за розкладом GEO_LAYOUT нижче; сітка — тонкі напівпрозорі неонові лінії
// (циан «Рубіжу»). Хеш-мозаїку П12.7 `geoCellTone` з П14.5 не викликав
// ніхто — видалено в Т.161.
export const GEO_CELL_A = '#0a1120';
export const GEO_CELL_B = '#0d1526';
export const GEO_GRID_COLOR = 'rgba(0,229,255,0.10)';

// --- Позафазна лінія «візуальні порівняння» (Work-сесія 2026-10-21,
// кандидат А «нічний супутник»; скореговано за фідбеком власника
// 2026-10-23 ×4: острів під радаром → вище → масштаб мельче →
// «сюди»: великий світлий масив південного узбережжя материка) ---
// Терену геосцени НЕ існує в ядрі і сейвах (GeoState без мапи рельєфу,
// ADR-0026): розклад — суто шар відображення. Джерело — картина світу
// assets/geo-map.webp (нічний супутник): клітинка = суша, якщо медіана
// яскравості її 70×70-піксельної ділянки вище порогу. Ассет — вікно
// сирця geo-map2.jpg x 0..1024, y 9..639 (повна ширина, 82% висоти —
// увесь материк з вогнями) + безшовні паддінги тоном темної рамки
// сирця: захід 68px, схід 28px; ассет 1120×630 (16:9), 1:1 з вікном,
// cover на канву 768×432. Вікно вибрано за вказівкою власника
// («сюди», 2026-10-23): клітинка бази (8,4) = сирець x 492..562,
// y 289..359 — ЯСКРАВИЙ мис-«острів» південного узбережжя материка
// (сирець x 480..576, y 288..352, піки 40–61, яскраве ядро покриває
// клітинку на ~90%); вежа-радар по центру клітинки, промінь з вежі,
// підошва на освітленій суші (21–24), берег — ~15px нижче.
// Поріг за фактичним джерелом: 17.0 — центр розриву океан→суша у
// розподілі медіан (океан плоско 12.8–13.8, розрив 15.8 → 18.2).
// Відхилення правила виведення (фідбек власника 2026-10-23, «масштаб
// мельче»): острів бази (52×36 px) ДРІБНІШИЙ за клітинку 70×70 —
// медіана клітинки бази 13.0 (океан-мода); поріг НЕ силувався —
// клітинка бази позначається B (суша за призначенням: картина показує
// острів під радаром, фолбек показує базу сушею). Решта розкладу —
// медіани. Виведення — разовий скрипт scripts/geo-layout.py
// (результат — константа; рантайм від ассета розклад НЕ залежить).
// Розклад не залежить від сіда партії (константа, ADR-0003; geo.rng не
// витягується, потік ядра не зсувається, сейви сумісні). Світ
// циліндричний по X (wrap у geoIsLand); вертикаль — без замикання.
// Жорсткі перевірки доручення виконані БЕЗ відхилень (нове вікно
// «сюди», фідбек 2026-10-23): (а) клітинка бази (8,4) — суша (медіана
// 35.6, яскраве ядро мису покриває клітинку ~90%); (б) обидва краї —
// суцільний океан (захід — паддінг/темна рамка сирця, схід —
// рамка+паддінг), wrap без шва; суша 46/144 (31.9%) — в орієнтирі
// 30–40%. Поріг: 16.5 — центр розриву 15.0 → 18.0 (океан 12.8–13.8).
// B у карті — клітинка бази (8,4), суша (геометрія радара geo.ts без
// змін, ADR-0032).
export const GEO_LAYOUT: ReadonlyArray<string> = [
  '......LLLLLL....',
  '...LLLLLLLLLLL..',
  '..LLLLLLLLLLLL..',
  '...LLLLLLLLLLL..',
  '......LLBL......',
  '................',
  '................',
  '...........L....',
  '.........L......',
];

// Розклад суші WORLD_H×WORLD_W (9×16): [y][x] = суша/океан. Константа.
export type GeoLayout = ReadonlyArray<ReadonlyArray<boolean>>;

export const GEO_LAND_ROWS: GeoLayout = GEO_LAYOUT.map((r) => [...r].map((c) => c === 'L' || c === 'B'));

// Чи суша в клітинці (x, y) розкладу — X замикається (куля по X), y — ні.
export function geoIsLand(layout: GeoLayout, x: number, y: number): boolean {
  if (y < 0 || y >= WORLD_H) return false;
  const wx = (((x % WORLD_W) + WORLD_W) % WORLD_W) | 0;
  return layout[y]?.[wx] === true;
}

// Клітинка терену: blocked — завалення (рельєф туману видно і в тумані,
// ADR-0006), visible — у зоні видимості гравця.
export interface TerrainCell {
  x: number;
  y: number;
  blocked: boolean;
  visible: boolean;
}

// Детермінований хеш від координат (П6.13, без RNG — ADR-0003): той самий
// (x, y) завжди дає той самий відтінок — мозаїка терену стабільна між кадрами.
export function cellHash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = (h * 1274126177) | 0;
  return (h ^ (h >>> 16)) >>> 0;
}

// Відтінок клітинки терену (чисте перетворення стану → колір, без Canvas):
// два тони (відкритий / завалений) × туман/видимо, варіація — хеш клітинки.
export function terrainShade(x: number, y: number, blocked: boolean, visible: boolean): string {
  const shades = blocked ? (visible ? TERRAIN_BLOCKED : TERRAIN_BLOCKED_FOG) : visible ? TERRAIN_OPEN : TERRAIN_OPEN_FOG;
  return shades[cellHash(x, y) % shades.length] ?? shades[0]!;
}

// Ключі видимих клітинок — для м'якого краю туману (сусідство за 4 напрямками).
export function visibleKeys(cells: readonly TerrainCell[]): Set<string> {
  return new Set(cells.filter((c) => c.visible).map((c) => c.x + ',' + c.y));
}

// Чи є у клітинки туману видимий сусід по прямій (4 напрямки, без діагоналей).
export function hasVisibleNeighbor(vis: ReadonlySet<string>, x: number, y: number): boolean {
  return vis.has(x - 1 + ',' + y) || vis.has(x + 1 + ',' + y) || vis.has(x + ',' + (y - 1)) || vis.has(x + ',' + (y + 1));
}

// Т.44, Т.119: крок діагоналей штриха туману, px buffer'а: 8 px, на зменшеній канві (телефон) —
// 5,5 CSS px (px — px buffer'а на CSS px). Т.143: спільний для рендера і гейта e2e штриха.
export const FOG_HATCH_STEP = 8;
export function fogHatchStep(px: number): number {
  return Math.max(FOG_HATCH_STEP, 5.5 * px);
}

// Т.44: межа зору — відрізки на спільній стороні пари «видима клітинка —
// невидима сусідка» (4 напрямки). Координати — у клітинках (вузли сітки);
// край поля межею не є: сусідки поза переліком клітинок немає.
export interface CellEdge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
export function fogBorderSegments(cells: readonly TerrainCell[]): CellEdge[] {
  const fog = new Set(cells.filter((c) => !c.visible).map((c) => c.x + ',' + c.y));
  const out: CellEdge[] = [];
  for (const c of cells) {
    if (!c.visible) continue;
    if (fog.has(c.x + 1 + ',' + c.y)) out.push({ x1: c.x + 1, y1: c.y, x2: c.x + 1, y2: c.y + 1 });
    if (fog.has(c.x - 1 + ',' + c.y)) out.push({ x1: c.x, y1: c.y, x2: c.x, y2: c.y + 1 });
    if (fog.has(c.x + ',' + (c.y + 1))) out.push({ x1: c.x, y1: c.y + 1, x2: c.x + 1, y2: c.y + 1 });
    if (fog.has(c.x + ',' + (c.y - 1))) out.push({ x1: c.x, y1: c.y, x2: c.x + 1, y2: c.y });
  }
  return out;
}

// Т.44: контур множини клітинок (зона ходу) — сторони клітинок множини, за якими
// сусідки з множини немає (зокрема край поля і стіни всередині зони). Координати
// в клітинках; (nx, ny) — одиничний зсув усередину клітинки, щоб лінію малювати в її межах.
// e1, e2 — подовження вертикального відрізка вгору і вниз, px (0 або 2): на увігнутому куті зони
// зсунуті лінії двох клітинок не сходяться, і без подовження в куті лишається дірка 2 × 2 px.
export interface ZoneEdge extends CellEdge {
  nx: number;
  ny: number;
  e1: number;
  e2: number;
}
export function zoneOutlineSegments(keys: ReadonlySet<string>): ZoneEdge[] {
  const out: ZoneEdge[] = [];
  for (const k of keys) {
    const i = k.indexOf(',');
    const x = Number(k.slice(0, i));
    const y = Number(k.slice(i + 1));
    const has = (dx: number, dy: number): boolean => keys.has(x + dx + ',' + (y + dy));
    // увігнутий кут: сусідка згори (знизу) і клітинка за нею по діагоналі — обидві в множині
    const ext = (dx: number, dy: number): number => (has(0, dy) && has(dx, dy) ? 2 : 0);
    if (!has(1, 0)) out.push({ x1: x + 1, y1: y, x2: x + 1, y2: y + 1, nx: -1, ny: 0, e1: ext(1, -1), e2: ext(1, 1) });
    if (!has(-1, 0)) out.push({ x1: x, y1: y, x2: x, y2: y + 1, nx: 1, ny: 0, e1: ext(-1, -1), e2: ext(-1, 1) });
    if (!has(0, 1)) out.push({ x1: x, y1: y + 1, x2: x + 1, y2: y + 1, nx: 0, ny: -1, e1: 0, e2: 0 });
    if (!has(0, -1)) out.push({ x1: x, y1: y, x2: x + 1, y2: y, nx: 0, ny: 1, e1: 0, e2: 0 });
  }
  return out;
}

// Т.146 (рішення власника «А. Стик кодом», ADR-0127): сусідні стіни — одна маса з чинного
// тайла стіни (¾ згори: ціановий кант угорі, верхня грань, темна передня грань унизу, рамка
// по краях). Стіна без сусідки-стіни за 4 напрямками — тайл цілком, як раніше (null); інакше —
// чотири чверті: чверть біля сусідки-стіни бере середину тайла замість краю. По горизонталі —
// стовпці tile/4..¾ tile (без бічної рамки); по вертикалі — рядки верхньої грані без канта
// і без передньої грані (WALL_FACE_Y0..Y1 тайла 48 px), розтягнуті на чверть. Діагональ
// не враховується. Координати джерела — px тайла (кол. 0 атласа), dx/dy — зсув чверті
// в частках клітинки.
export const WALL_FACE_Y0 = 8 / 48; // перший рядок, що береться з верхньої грані (6–33): 6–7 — відблиск канта
export const WALL_FACE_Y1 = 24 / 48; // половина тайла (межа верхніх і нижніх чвертей)
export interface WallQuad {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
}
export function wallQuads(blocked: (x: number, y: number) => boolean, x: number, y: number, tile: number): WallQuad[] | null {
  const l = blocked(x - 1, y);
  const r = blocked(x + 1, y);
  const u = blocked(x, y - 1);
  const d = blocked(x, y + 1);
  if (!l && !r && !u && !d) return null;
  const half = tile / 2;
  const out: WallQuad[] = [];
  for (const qy of [0, 1]) {
    for (const qx of [0, 1]) {
      const h = qx === 0 ? l : r;
      const v = qy === 0 ? u : d;
      const sx = h ? tile / 4 : qx * half;
      const sy = v ? tile * WALL_FACE_Y0 : qy * half;
      const sh = v ? tile * (WALL_FACE_Y1 - WALL_FACE_Y0) : half;
      out.push({ sx, sy, sw: half, sh, dx: qx / 2, dy: qy / 2 });
    }
  }
  return out;
}

// Т.44: плашка ціни шляху «<число> AP» біля цілі: ширина — ширина тексту + 10 px, висота 21 px
// (× k, Т.119). Координати — px канви, цілі.
export const PATH_LABEL_H = 21;
export const PATH_LABEL_PAD = 10; // сумарний запас ширини навколо тексту, px
export const PATH_LABEL_CHAR_W = 9; // ширина знака bold 15px monospace (0,6 em)
export interface LabelBox {
  x: number;
  y: number;
  w: number;
  h: number;
}
// Т.119 (рішення власника, варіант А): текст плашки — не дрібніший за 12 CSS px. px — px buffer'а
// на CSS px; множник розміру плашки ≥ 1 (1366 × 768 — ≈ 1,17, iPad 1024 × 768 — ≈ 1,38,
// телефон 390 × 844 — ≈ 3,96).
export const PATH_LABEL_MIN_CSS = 12;
export function pathLabelScale(px: number): number {
  return Math.max(1, (px * PATH_LABEL_MIN_CSS) / 15);
}
// Т.119 (рішення власника, варіант А; замість «над ціллю» Т.44, що закривало клітинку над ціллю):
// плашка збоку від клітинки цілі з відступом 2 px × k — праворуч, а якщо шлях приходить у ціль справа
// (fromRight; аудит PR #434: інакше плашка лягала на кінець шляху і клітинку оперативника) — ліворуч;
// якщо обраний бік не вміщується (ближче 2 px до краю канви) — інший. По вертикалі — по центру
// клітинки, притиснута в межі квадратної канви з відступом 2 px. Клітинку над ціллю не закриває.
export function pathLabelBox(goal: { x: number; y: number }, cell: number, textW: number, cw: number, k = 1, fromRight = false): LabelBox {
  const cy = goal.y * cell + cell / 2;
  const w = Math.ceil(textW + PATH_LABEL_PAD * k);
  const h = Math.round(PATH_LABEL_H * k);
  const m = Math.round(2 * k);
  const right = goal.x * cell + cell + m;
  const left = goal.x * cell - m - w;
  const x = fromRight ? (left >= 2 ? left : right) : right + w <= cw - 2 ? right : Math.max(2, left);
  return { x, y: Math.round(Math.min(Math.max(cy - h / 2, 2), cw - h - 2)), w, h };
}

// --- П6.8 (ADR-0029): анімаційний рушій — черга + rAF лише під час активних анімацій ---

// Тривалості фаз (мс): стримана анімація, без поспіху (дизайн-сесія 6b).
export const MOVE_MS_PER_CELL = 90; // хід: 90 мс на клітинку шляху
export const TRACER_MS = 150; // трасер кулі від стрільця до цілі
export const IMPACT_MS = 200; // спалах влучання (лише при попаданні)
export const DEATH_MS = 350; // згасання силуета загиблого
export const OW_FLASH_MS = 300; // спалах дозору (озброєння реакційного вогню)
export const RADAR_PULSE_MS = 1200; // П6.9: пульс радара — від бази до краю зони виявлення
// П14.4 (ADR-0072/0064): подієві ефекти 2.0 — тривалості у чинній шкалі
// AnimEngine; вибух довший за спалах влучання (орієнтир 400–450 мс,
// зафіксовано у коміті кроку — затверджує прев'ю), число — як згасання смерті.
export const BOOM_MS = 430; // вибух гранати: спалах-кільце + розліт частинок
export const DNUM_MS = 350; // плаваюче число пошкодження/зцілення над ціллю
export const BOOM_PARTICLES = 12; // ≤ 12 одночасних частинок на вибух (П14.4)
export const BOOM_SHAKE_PX = 4; // тряска вибуху — ×2 від пострілу (SHAKE_PX 2)
// П14.5 (ADR-0072/0064): скан-радар і хвіст перехоплення — тривалості у
// чинній шкалі AnimEngine (числа узгоджені власником ДО прев'ю 2026-10-20,
// урок iter-13.5): розгортка 1200 мс як у пульсу П6.9, хвіст коротший за крок.
export const GEO_TRAIL_MS = 600; // хвіст перехоплення: згасання лінії останніх позицій
export const GEO_TRAIL_POINTS = 8; // останніх позицій польоту винищувача (≈4 тіки)

// Т.144 (ADR-0125, рішення власника «А. Спокійно»): системне «менше руху» —
// подієва анімація без руху: прапорець calm ставить calmAnim; тривалість ≈ ½.
export interface CalmFlag {
  calm?: boolean;
}
export const CALM_DUR_K = 0.5;

// Один елемент черги анімацій. start — мітка часу початку відтворення
// (призначає рушій на першому кадрі; null — ще не починалось).
export interface MoveAnim extends CalmFlag {
  kind: 'move';
  unitId: string;
  side: Side;
  enemyKind?: EnemyKind; // п17.2: тип ворога — кільце й літера їдуть разом із ним (без поля — демон)
  path: Vec2[]; // [from, to1, ...] — клітинкові координати
  hp: number; // знімок стану на момент постановки в чергу
  hpMax: number; // П14.4: показник життя — частка hp/maxHp у смузі HP
  overwatch: boolean;
  selected: boolean;
  dur: number;
  start: number | null;
}
export interface TracerAnim extends CalmFlag {
  kind: 'tracer';
  side: Side; // сторона стрільця — колір трасера
  from: Vec2;
  to: Vec2;
  hit: boolean;
  dur: number; // TRACER_MS (+ IMPACT_MS при влучанні)
  start: number | null;
  fog?: true; // п17.3: стрілець у тумані — from = перша видима клітинка лінії, пози «вогонь» і спалаху дула немає
}
export interface DeathAnim extends CalmFlag {
  kind: 'death';
  unitId: string; // фікс фідбеку валідації: юніт очікує відтворення — статичний прохід тримає його на полі
  side: Side;
  at: Vec2;
  hpMax: number; // П14.4: показник життя загиблого — порожня смуга (hp 0)
  dur: number;
  start: number | null;
}
export interface OwFlashAnim extends CalmFlag {
  kind: 'owflash';
  side: Side;
  at: Vec2;
  dur: number;
  start: number | null;
}
// П6.9 (ADR-0029): пульс радара геосцени — кільце, що розходиться від бази
// до краю зони виявлення і гасне. Суто візуальний: не читає ні НЛО, ні geo.rng;
// невиявлені НЛО не показуються і не анімуються (туман — ADR-0006/0029).
export interface GeoPulseAnim extends CalmFlag {
  kind: 'gpulse';
  cx: number; // центр бази в пікселях buffer'а
  cy: number;
  maxR: number; // радіус зони виявлення в пікселях
  dur: number;
  start: number | null;
}
export type Anim = MoveAnim | TracerAnim | DeathAnim | OwFlashAnim | GeoPulseAnim | BoomAnim | DNumAnim | GeoScanAnim | GeoTrailAnim;

// П14.4 (ADR-0072/0064): подієві ефекти 2.0 — вибух гранати і плаваючі
// числа. Ефекти — суто відображення над фактичним станом (патерн П6.8):
// дії ядра вже застосовані, анімація лише відтворює результат. Boom —
// спалах-кільце і розліт частинок з епіцентру (зона «епіцентр + хрест»
// малює шар відображення — дзеркало прев'ю гранати у battle.ts); DNum —
// число над ціллю: підйом і згасання за прогресом кадру (пошкодження —
// бурштин, зцілення — зелений, ADR-0064).
export interface BoomAnim extends CalmFlag {
  kind: 'boom';
  at: Vec2; // епіцентр вибуху
  dur: number;
  start: number | null;
}
export interface DNumAnim extends CalmFlag {
  kind: 'dnum';
  at: Vec2; // клітинка цілі
  amount: number; // N пошкодження або зцілення
  heal: boolean; // true — «+N» зцілення, false — «-N» пошкодження
  dur: number;
  start: number | null;
}
// П14.5 (ADR-0072/0064): скан-радар геосцени 2.0 — розвиток пульсу П6.9:
// у зоні виявлення (RADAR_RANGE 4, Чебишев із замиканням по X від бази)
// обертається сектор-розгортка і розходяться кільця, що гаснуть. Подієво
// (пульс у черзі на тік часу, coalesce за busy — патерн П6.9), без вічного
// циклу (ADR-0029); невиявлені НЛО не підсвічуються (туман — ADR-0006/0032).
export interface GeoScanAnim extends CalmFlag {
  kind: 'gscan';
  cx: number; // центр бази в пікселях buffer'а
  cy: number;
  maxR: number; // радіус зони виявлення в пікселях
  dur: number;
  start: number | null;
}
// П14.5: хвіст траєкторії перехоплення — лінія останніх позицій польоту
// винищувача (джерело — події intercept_move у журналі, лог лише читається),
// що згасає за прогресом; малюється лише в кадрах анімаційного шару
// (idle → 0, ADR-0029). points — клітинкові координати, старша → новіша.
export interface GeoTrailAnim extends CalmFlag {
  kind: 'gtrail';
  points: Vec2[];
  dur: number;
  start: number | null;
}

// Знімки стану беруться ПІСЛЯ застосування дії ядром (позиція/HP уже фінальні,
// лог — джерело істини про те, що відбулося).
export function makeMoveAnim(u: Unit, path: Vec2[], selected: boolean): MoveAnim {
  const anim: MoveAnim = {
    kind: 'move',
    unitId: u.id,
    side: u.side,
    path,
    hp: u.hp,
    hpMax: u.maxHp, // П14.4: смуга HP під час руху
    overwatch: u.overwatch,
    selected,
    dur: Math.max(1, path.length - 1) * MOVE_MS_PER_CELL,
    start: null,
  };
  if (u.kind !== undefined) anim.enemyKind = u.kind; // п17.2: демон — без поля, як раніше
  return anim;
}
export function makeTracerAnim(side: Side, from: Vec2, to: Vec2, hit: boolean): TracerAnim {
  return { kind: 'tracer', side, from, to, hit, dur: TRACER_MS + (hit ? IMPACT_MS : 0), start: null };
}
export function makeDeathAnim(u: Unit): DeathAnim {
  return { kind: 'death', unitId: u.id, side: u.side, at: { ...u.pos }, hpMax: u.maxHp, dur: DEATH_MS, start: null };
}
export function makeOwFlashAnim(u: Unit): OwFlashAnim {
  return { kind: 'owflash', side: u.side, at: { ...u.pos }, dur: OW_FLASH_MS, start: null };
}
export function makeGeoPulseAnim(cx: number, cy: number, maxR: number): GeoPulseAnim {
  return { kind: 'gpulse', cx, cy, maxR, dur: RADAR_PULSE_MS, start: null };
}
// П14.4: фабрики подієвих ефектів 2.0 — вибух за епіцентром кидка і число
// над ціллю (знімок позиції ПІСЛЯ застосування дії ядром, патерн П6.8).
export function makeBoomAnim(at: Vec2): BoomAnim {
  return { kind: 'boom', at: { ...at }, dur: BOOM_MS, start: null };
}
export function makeDNumAnim(at: Vec2, amount: number, heal: boolean): DNumAnim {
  return { kind: 'dnum', at: { ...at }, amount, heal, dur: DNUM_MS, start: null };
}
// П14.5: фабрики скан-радара і хвоста перехоплення (знімки позицій — після
// застосування дій ядром; лог — джерело істини, патерн П6.8).
export function makeGeoScanAnim(cx: number, cy: number, maxR: number): GeoScanAnim {
  return { kind: 'gscan', cx, cy, maxR, dur: RADAR_PULSE_MS, start: null };
}
export function makeGeoTrailAnim(points: Vec2[]): GeoTrailAnim {
  return { kind: 'gtrail', points: points.map((p) => ({ ...p })), dur: GEO_TRAIL_MS, start: null };
}

// П14.5: останні позиції польоту винищувача з журналу геосцени — чиста
// функція (лог лише читається, байт-у-байт не змінюється). Збирає хвіст
// послідовних подій intercept_move з кінця журналу: хвіст подій після
// останнього руху (engage/round тощо) пропускається, будь-яка інша подія
// обриває ланцюжок (свіжий сегмент польоту). points: [from старшої, to...],
// максимум max останніх позицій (GEO_TRAIL_POINTS), старша → новіша.
export function geoTrailPoints(log: readonly GeoEvent[], max = GEO_TRAIL_POINTS): Vec2[] {
  const moves: { from: Vec2; to: Vec2 }[] = [];
  let i = log.length - 1;
  while (i >= 0 && log[i]!.type !== 'intercept_move') i--; // хвіст не-рухів пропускаємо
  while (i >= 0 && log[i]!.type === 'intercept_move') {
    const m = log[i]! as { type: 'intercept_move'; from: Vec2; to: Vec2 };
    moves.unshift({ from: { ...m.from }, to: { ...m.to } });
    i--;
  }
  if (moves.length === 0) return [];
  const pts: Vec2[] = [{ ...moves[0]!.from }];
  for (const m of moves) pts.push({ ...m.to });
  return pts.slice(-max);
}

// Прогрес анімації 0..1 (за межами — клімпиться; start === null → ще не почалась).
export function animT(a: Anim, now: number): number {
  if (a.start === null) return 0;
  return Math.min(1, Math.max(0, (now - a.start) / a.dur));
}

// Т.144 (ADR-0125): спокійна копія анімації — той самий кадр без руху (хід — поява в цілі,
// без тряски, віддачі, іскор, розльоту, підйому числа, розгортки), тривалість ≈ ½.
export function calmAnim(a: Anim): Anim {
  return { ...a, calm: true, dur: Math.max(1, Math.round(a.dur * CALM_DUR_K)) };
}
// Частка польоту кулі в тривалості трасера — від пропорції, а не від dur (спокійна копія коротша)
export function tracerShare(a: TracerAnim): number {
  return a.hit ? TRACER_MS / (TRACER_MS + IMPACT_MS) : 1;
}

// Позиція рухомого юніта на кадрі: інтерполяція вздовж ламаної шляху (клітинки → px).
export function moveAnimPos(a: MoveAnim, t: number, cell: number): { cx: number; cy: number } {
  const pts = a.path;
  const k = a.calm === true ? 1 : t; // Т.144: спокійний хід — одразу в цілі (поява згасанням малює render.ts)
  if (k <= 0 || pts.length < 2) return { cx: pts[0].x * cell + cell / 2, cy: pts[0].y * cell + cell / 2 };
  if (k >= 1) {
    const last = pts[pts.length - 1];
    return { cx: last.x * cell + cell / 2, cy: last.y * cell + cell / 2 };
  }
  const prog = k * (pts.length - 1);
  const i = Math.min(Math.floor(prog), pts.length - 2);
  const f = prog - i;
  const x = pts[i].x + (pts[i + 1].x - pts[i].x) * f;
  const y = pts[i].y + (pts[i + 1].y - pts[i].y) * f;
  return { cx: x * cell + cell / 2, cy: y * cell + cell / 2 };
}

// П6.13: легка тряска канвасу при влучанні — зсув кадру на фазі спалаху
// трасера (той самий AnimEngine: тряска живе лише в кадрах анімації, idle →
// 0 перерисовок не порушується). Детерміновано, без RNG (ADR-0003): амплітуда
// спадає до кінця спалаху, коливання — синус/косинус від прогресу фази.
// П14.4: вибух гранати дає сильнішу тряску (амплітуда ×2 від пострілу,
// BOOM_SHAKE_PX) на всю тривалість вибуху; ядро тряски не міняється.
// Викликаюч робить ctx.translate(dx, dy) на весь кадр; фон канви збігається з
// CSS-тлом — оголений край непомітний. Промах не трясе.
export const SHAKE_PX = 2; // максимальна амплітуда (легка тряска)
export function shakeOffset(a: Anim | null, now: number): { dx: number; dy: number } {
  if (a === null || a.start === null || a.calm === true) return { dx: 0, dy: 0 }; // Т.144: спокійно — без тряски
  if (a.kind === 'boom') {
    const t = animT(a, now);
    if (t <= 0 || t >= 1) return { dx: 0, dy: 0 }; // лише кадри вибуху
    const amp = BOOM_SHAKE_PX * (1 - t); // спадає до нуля до кінця вибуху
    return { dx: Math.round(amp * Math.sin(t * Math.PI * 4)) + 0, dy: Math.round(amp * Math.cos(t * Math.PI * 4)) + 0 };
  }
  if (a.kind !== 'tracer' || !a.hit) return { dx: 0, dy: 0 };
  const t = animT(a, now);
  const share = tracerShare(a);
  if (t <= share || t >= 1) return { dx: 0, dy: 0 }; // лише фаза спалаху влучання
  const f = (t - share) / (1 - share);
  const amp = SHAKE_PX * (1 - f); // спадає до нуля до кінця спалаху
  // + 0 нормалізує -0 від Math.round малих від'ємних значень (0 === -0, але
  // зсув кадру лишається «строго нульовим» і детермінованим у тестах)
  return { dx: Math.round(amp * Math.sin(f * Math.PI * 4)) + 0, dy: Math.round(amp * Math.cos(f * Math.PI * 4)) + 0 };
}

// П14.4: детерміновані частинки вибуху (ADR-0003) — без Math.random і без
// geo.rng: напрямок/швидкість частинки №i — чиста функція від (епіцентр, i)
// за патерном cellHash. Зсув — у клітинках (шар відображення множить на
// cell і клімпить у межі канви); максимальний розліт ≈ 1 клітинка — у межах
// зони вибуху, політ сповільнюється (ease-out), t = 0 → епіцентр.
export function boomParticleOffset(at: Vec2, i: number, t: number): { dx: number; dy: number } {
  if (t <= 0) return { dx: 0, dy: 0 };
  const dir = cellHash(at.x * 31 + i, at.y * 17 - i);
  const spd = cellHash(at.x - i * 13, at.y + i * 7);
  const ang = ((dir % 360) / 360) * Math.PI * 2;
  const max = 0.45 + ((spd % 100) / 100) * 0.55; // 0.45..1.0 клітинки
  const dist = max * (1 - (1 - t) * (1 - t)); // ease-out: швидкий старт, гальмування
  // + 0 нормалізує -0 (той самий прийом, що shakeOffset)
  return { dx: Math.cos(ang) * dist + 0, dy: Math.sin(ang) * dist + 0 };
}

// Рушій: анімації відтворюються послідовно (черга), rAF-цикл живе ЛИШЕ поки
// черга непорожня — idle → 0 перерисовок (ADR-0029; батарея iPad). Останній
// кадр (черга спорожніла) малюється ще раз — статичний стан без шару анімації.
// schedule/cancel — ін'єктовані (rAF у браузері; у тестах — фейк): render-core
// не знає DOM-глобалів.
export interface AnimEngineDeps {
  schedule: (cb: (now: number) => void) => unknown;
  cancel: (handle: unknown) => void;
  draw: () => void; // повний кадр: clearRect + статика + анімаційний шар (урок П6.6)
  onIdle?: () => void; // П6.16: черга спорожніла після відтворення — рушій пішов у idle
}
export class AnimEngine {
  private queue: Anim[] = [];
  private handle: unknown = null;
  private lastNow = 0;
  constructor(private readonly deps: AnimEngineDeps) {}
  get busy(): boolean {
    return this.queue.length > 0;
  }
  active(): Anim | null {
    return this.queue[0] ?? null;
  }
  // П14.4 (фідбек прев'ю): знімок черги (у порядку відтворення, перший елемент —
  // активний) — шар відображення вирішує, чи не показувати юніт у фінальній
  // клітинці до відтворення його ходу (спойлер синхронного ходу ШІ).
  queued(): readonly Anim[] {
    return this.queue;
  }
  get now(): number {
    return this.lastNow;
  }
  push(...anims: Anim[]): void {
    this.queue.push(...anims);
    if (this.handle === null) this.handle = this.deps.schedule(this.frame);
  }
  cancel(): void {
    this.queue = [];
    if (this.handle !== null) {
      this.deps.cancel(this.handle);
      this.handle = null;
    }
  }
  private readonly frame = (now: number): void => {
    this.lastNow = now;
    const a = this.queue[0];
    if (a !== undefined) {
      if (a.start === null) a.start = now;
      if (now - a.start >= a.dur) {
        this.queue.shift();
        const n = this.queue[0];
        if (n !== undefined) n.start = now;
      }
    }
    this.deps.draw();
    if (this.queue.length === 0) {
      this.handle = null; // idle: наступних кадрів не плануємо
      this.deps.onIdle?.(); // П6.16: серія анімацій відтворена (без push не викликається)
      return;
    }
    this.handle = this.deps.schedule(this.frame);
  };
}

// П14.4 (фідбек прев'ю): стартові клітинки демонів, чий хід у черзі ще НЕ
// відтворено. Хід ШІ виконується синхронно (aliensTurn) і стан уже фінальний —
// статичний прохід, малюючи демонів у фінальних клітинках, споїлить їхні
// ходи: демон «з'являється» одразу у цілі, анімація ходу не помітна (у
// туманній ділянці active-ходу — те саме). Правило відображення: до початку
// відтворення свого ходу демон стоїть на ПАЧАТКУ шляху (перший хід юніта,
// наступні — заміщаються відтвореними); туман не розкривається (ADR-0006).
// Чиста функція без RNG: перший хід юніта в черзі — його «теперішня» позиція.
export function pendingAlienMoveStarts(queue: readonly Anim[]): Map<string, Vec2> {
  const out = new Map<string, Vec2>();
  for (const a of queue) {
    if (a.kind !== 'move' || a.side !== 'alien') continue;
    const p0 = a.path[0];
    if (p0 !== undefined && !out.has(a.unitId)) out.set(a.unitId, p0);
  }
  return out;
}

// Фікс фідбеку валідації П14.8 («старий баг» блимання смерті): ядро
// застосовує смерть миттєво (alive=false), а кадр згасання відтворюється
// лише після попередніх анімацій черги (трасер, вибух) — статичний прохід,
// пропускаючи загиблих, давав «зник → з'явився (кадр смерті) → зник».
// Правило відображення: смерть у черзі ще НЕ відтворена — юніт лишається
// на полі до свого кадру. Активний кадр (queue[0]) не враховуємо — його
// уже малює анімаційний шар (інакше силует подвоїться). Чиста функція без
// RNG: перша смерть юніта в черзі — його позиція.
export function pendingDeathStarts(queue: readonly Anim[]): Map<string, Vec2> {
  const out = new Map<string, Vec2>();
  for (let i = 1; i < queue.length; i++) {
    const a = queue[i];
    if (a.kind !== 'death') continue;
    if (!out.has(a.unitId)) out.set(a.unitId, a.at);
  }
  return out;
}

// Чистий перетворювач подій логу бою в анімації (П6.8, ADR-0029: анімація —
// відображення, лог — джерело істини). Лог і юніти тільки ЧИТАЮТЬСЯ:
// state.log/стан байт-у-байт не змінюються.
// Особливості порядку подій ядра: moveUnit пише окрему подію на кожен крок
// (реакційний вогонь між кроками перериває рух) — послідовні кроки одного
// юніта об'єднуються в один хід по шляху; fireOnce пише смерть РАНІШЕ за
// постріл, що її спричинив — відтворюємо спершу трасер, потім смерть;
// throwGrenade пише смерті уражених РАНІШЕ за подію grenade — відтворюємо
// спершу вибух, потім смерті і числа (переупорядкування лише у черзі кадрів).
// П14.4: третій параметр — видимість клітинок (туман, ADR-0006): числа
// пошкоджень/зцілення породжуються лише для видимих цілей; туман вирішує
// викликаюч (патерн П14.2), без набору — фільтрації нема (усе видиме).
export function animsFromEvents(events: readonly GameEvent[], units: readonly Unit[], vis?: ReadonlySet<string>): Anim[] {
  const byId = new Map(units.map((u) => [u.id, u]));
  const seen = (p: Vec2): boolean => vis === undefined || vis.has(p.x + ',' + p.y);
  const anims: Anim[] = [];
  // п17.3 (рішення власника «А. Від краю туману»; аудит PR #508): стрілець у тумані (око з
  // 13–16 клітинок) позиції не видає — трасер стартує з першої видимої клітинки лінії до
  // цілі (видимої немає — лише в клітинці цілі: її, бійця гравця, видно завжди). Пачка
  // подій — хід цілком, а units і vis — стан після неї, тож позиція стрільця — на момент
  // пострілу (`from` його першого ходу після події); у межах огляду ціль-боєць бачить
  // стрільця сама (лінія симетрична, ADR-0087) — туману немає, трасер як раніше.
  const posAt = (u: Unit, at: number): Vec2 => {
    for (let k = at + 1; k < events.length; k++) {
      const m = events[k];
      if (m.type === 'move' && m.unitId === u.id) return m.from;
    }
    return u.pos;
  };
  const tracer = (shooter: Unit, to: Vec2, hit: boolean, at: number): void => {
    const p = posAt(shooter, at);
    if (shooter.side === 'player' || distance(p, to) <= VISION_RANGE || seen(p)) {
      anims.push(makeTracerAnim(shooter.side, { ...shooter.pos }, { ...to }, hit));
      return;
    }
    const from = lineCells(p, to).find((c) => seen(c) || (c.x === to.x && c.y === to.y)) ?? to;
    const a = makeTracerAnim(shooter.side, { ...from }, { ...to }, hit);
    a.fog = true;
    anims.push(a);
  };
  let i = 0;
  while (i < events.length) {
    const e = events[i];
    if (e.type === 'move') {
      const path: Vec2[] = [{ ...e.from }, { ...e.to }];
      let j = i + 1;
      while (j < events.length) {
        const m = events[j];
        if (m.type !== 'move' || m.unitId !== e.unitId) break;
        path.push({ ...m.to });
        j++;
      }
      const u = byId.get(e.unitId);
      if (u !== undefined) anims.push(makeMoveAnim(u, path, false));
      i = j;
      continue;
    }
    if (e.type === 'death') {
      const next = events[i + 1];
      const victim = byId.get(e.unitId);
      if (next !== undefined && next.type === 'shot' && next.targetId === e.unitId) {
        const shooter = byId.get(next.shooterId);
        if (shooter !== undefined && victim !== undefined) {
          tracer(shooter, victim.pos, next.hit, i + 1);
          anims.push(makeDeathAnim(victim));
          // П14.4: число фатального пошкодження — після згасання силуета
          if (next.hit && next.damage > 0 && seen(victim.pos)) anims.push(makeDNumAnim(victim.pos, next.damage, false));
        }
        i += 2;
        continue;
      }
      // П14.4: смерті уражених вибухом — ядро логує їх РАНІШЕ за grenade
      // (цикл пошкоджень зони) — відтворюємо вибух, потім смерті і числа.
      // Т.160: граната може вбити кількох — гранату шукаємо за всією серією
      // смертей від того самого кидача (раніше — лише за наступною подією, і
      // перший загиблий згасав до вибуху).
      const series: Unit[] = [];
      let g = i;
      for (; g < events.length; g++) {
        const d = events[g];
        if (d.type !== 'death' || d.killerId !== e.killerId) break;
        const v = byId.get(d.unitId);
        if (v !== undefined) series.push(v);
      }
      const gr = events[g];
      if (gr !== undefined && gr.type === 'grenade' && gr.unitId === e.killerId) {
        anims.push(makeBoomAnim(gr.center));
        for (const v of series) anims.push(makeDeathAnim(v));
        for (const h of gr.hits) {
          const t = byId.get(h.unitId);
          if (t !== undefined && seen(t.pos)) anims.push(makeDNumAnim(t.pos, h.damage, false));
        }
        i = g + 1; // events[g] — подія grenade, її вже відтворено
        continue;
      }
      if (victim !== undefined) anims.push(makeDeathAnim(victim));
      i++;
      continue;
    }
    if (e.type === 'shot') {
      const shooter = byId.get(e.shooterId);
      const target = byId.get(e.targetId);
      if (shooter !== undefined && target !== undefined) {
        tracer(shooter, target.pos, e.hit, i);
        // П14.4: число пошкодження над ціллю — лише при влучанні з реальною
        // шкодою і лише для видимих цілей (туман не розкривається, ADR-0006)
        if (e.hit && e.damage > 0 && seen(target.pos)) anims.push(makeDNumAnim(target.pos, e.damage, false));
      }
      i++;
      continue;
    }
    if (e.type === 'grenade') {
      // П14.4: вибух без попередніх смертей (уражені вижили або зона порожня)
      anims.push(makeBoomAnim(e.center));
      for (const h of e.hits) {
        const t = byId.get(h.unitId);
        if (t !== undefined && seen(t.pos)) anims.push(makeDNumAnim(t.pos, h.damage, false));
      }
      i++;
      continue;
    }
    if (e.type === 'heal') {
      // П14.4: зцілення — зелене «+N» над ціллю (лише видима ціль)
      const t = byId.get(e.targetId);
      if (t !== undefined && e.healed > 0 && seen(t.pos)) anims.push(makeDNumAnim(t.pos, e.healed, true));
      i++;
      continue;
    }
    if (e.type === 'overwatch' && e.armed) {
      const u = byId.get(e.unitId);
      if (u !== undefined) anims.push(makeOwFlashAnim(u));
    }
    i++; // turn — не анімується; overwatch(armed:false) ядра не логує
  }
  return anims;
}

// Т.129 (ADR-0118): колір і форма шолома бійця — за id ростера назавжди
// ('s1' → 0, 's7' → 6): шість кольорів × три форми шолома = 18 комбінацій;
// сьомий і далі завербовані — повтор кольору з іншою формою. Палітра відмінна
// від бірюзи своїх, пурпуру Розриву і бурштину головної дії (ADR-0064, ADR-0115).
export const FIGHTER_COLORS = ['#8ee35b', '#5b9bff', '#f5e050', '#ff8a5c', '#b58cff', '#f2f5fa'] as const;
export const ALIEN_RING = '#ff2e88'; // кільце ворогів — пурпур Розриву (ADR-0064)
// п17.2 (ADR-0149 п. 4, 15; рішення власника «Б. Контраст»): до мальованих кадрів п17.5 тип
// ворога видно кільцем кольору типу і літерою в лівому верхньому куті клітинки; демон —
// пурпур, як раніше; три нові кольори не збігаються з шістьма кольорами бійців.
export const ENEMY_LOOK: Record<EnemyKind, { ring: string; letter: string }> = {
  demon: { ring: ALIEN_RING, letter: 'Д' },
  hound: { ring: '#ff3b30', letter: 'Гн' },
  golem: { ring: '#8fa3b8', letter: 'Гл' },
  eye: { ring: '#2ee6d6', letter: 'О' },
};
export const HELMET_SHAPES = 3;
// Геометрія кільця під ногами (src/render.ts і гейт e2e — одне місце правди):
// еліпс 34 × 12 px, як на аркуші, який схвалив власник (Т.129); центр нижче
// центру клітинки, нижні дужки рамки вибору малюються поверх кільця.
export const RING_RX = 17;
export const RING_RY = 6;
export const RING_DY = 16;

export interface FighterLook {
  index: number; // порядковий номер у ростері від 0
  color: string;
  shape: number; // 0..HELMET_SHAPES-1
}

export function fighterLook(id: string): FighterLook {
  const m = /^s(\d+)$/.exec(id);
  const index = m ? Math.max(0, Number(m[1]) - 1) : 0;
  const n = FIGHTER_COLORS.length;
  return { index, color: FIGHTER_COLORS[index % n], shape: Math.floor(index / n) % HELMET_SHAPES };
}

// --- Т.132 (ADR-0121): поле бою й анімація «Сміливіше» ---
// Геометрія бійця на полі (src/render.ts, ambient-шар і тести — одне місце правди):
// кадр атласа 96 × 96 малюється 68 × 68 (рішення власника, варіант «В/Г»), низ фігури
// (рядок 93 кадру) стоїть на UNIT_FEET_DY нижче центру клітинки — ноги на місці, фігура
// росте вгору в межах своєї клітинки; смуга HP — під ногами, у нижньому краї клітинки.
export const UNIT_DRAW = 68; // сторона кадру на полі, px (було 44)
export const ATLAS_FEET_ROW = 93; // рядок кадру 96 px, де стоять ноги
export const UNIT_FEET_DY = 19; // низ фігури — на 19 px нижче центру клітинки
export const HP_BAR_W = 34; // смуга HP під ногами — ширина кільця
export const HP_BAR_H = 3;
export const HP_BAR_Y = 20; // верх смуги — 20 px нижче центру; з підкладкою 19..24 — у межах клітинки
export const RECOIL_PX = 3; // віддача стрільця на початку пострілу, px
export const SPARKS = 10; // іскор влучання (≤ 12, як частинок вибуху — П14.4)
export const DISSOLVE_STRIP = 3; // висота смуги розчинення, px
export const BREATH_SCALE = 0.03; // «дихання» — стискання фігури по висоті від ніг, частка

// Верхній лівий кут кадру на полі для центру клітинки (cx, cy).
export function unitFrameOrigin(cx: number, cy: number): { x: number; y: number } {
  return {
    x: Math.round(cx - UNIT_DRAW / 2),
    y: Math.round(cy + UNIT_FEET_DY - (UNIT_DRAW * ATLAS_FEET_ROW) / 96),
  };
}

// Віддача на кадрі трасера: перша чверть польоту кулі — RECOIL_PX, друга — 1 px, далі 0.
// share — частка трасера в тривалості анімації (TRACER_MS / dur).
export function recoilPx(t: number, share: number): number {
  if (t <= 0 || share <= 0) return 0;
  const f = t / share;
  return f < 0.25 ? RECOIL_PX : f < 0.5 ? 1 : 0;
}

// Іскра влучання i з SPARKS: кут — рівномірно по колу зі зсувом за клітинкою цілі
// (без RNG, ADR-0003), відліт ease-out до 22 px і падіння (+10 px · f²).
export function sparkOffset(at: Vec2, i: number, f: number): { dx: number; dy: number } {
  if (f <= 0) return { dx: 0, dy: 0 };
  const ang = (i / SPARKS) * Math.PI * 2 + (cellHash(at.x, at.y) % 60) / 100;
  const reach = (i % 3 === 0 ? 14 : 22) * (1 - (1 - f) * (1 - f));
  return { dx: Math.round(Math.cos(ang) * reach) + 0, dy: Math.round(Math.sin(ang) * reach * 0.8 + 10 * f * f) + 0 };
}

// Розчинення загиблого: смуга k (зверху вниз) зникає, щойно прогрес t перейшов її поріг
// 0..1 — поріг за хешем номера смуги, тож кадр розсипається нерівно, але детерміновано.
export function dissolveKept(k: number, t: number): boolean {
  if (t <= 0) return true;
  return ((k * 37) % 11) / 11 >= t;
}
