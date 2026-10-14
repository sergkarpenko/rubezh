// src/render.ts — шар відображення (ADR-0010/0029/0031, П6.7/П6.8/П6.12/П6.13):
// піксель-арт спрайти Canvas 2D + анімаційний рушій превью + нічна палітра
// бойовища (терен з хеш-варіацією, тонка сітка, м'який край туману, тряска).
// Спрайти (солдат з «АР-14 Гарт», прибульчик з «Імпульсним різаком», база, НЛО) —
// матриці пікселів у коді (ADR-0031): розгортаються ліниво в offscreen-канвас
// низької роздільності з кешем і малюються drawImage з nearest-neighbor
// (imageSmoothingEnabled = false) у ціле кратному масштабі — крайові пікселі
// без розмиття. Кадри ходьби — окремі матриці, чергуються у анімації руху.
// Чисті функції малювання: без DOM-стану і без RNG (ADR-0002/0003 — ядро не зачіпається);
// експортовані для юніт-тестів (мок-контекст записує виклики).
// П6.8 (ADR-0029): анімація — суто візуальний шар. Дії ядра застосовуються миттєво,
// анімація лише відтворює результат поверх фактичного стану: лог бою
// байт-у-байт незмінний, RNG не викликається, туман (видимість) вирішує викликаюч.

import type { GameEvent, Side, Unit, Vec2 } from './core/combat';
import type { UfoKind } from './core/geo';

// Палітра — спадок мінімалізму (ADR-0007): ті самі акценти, що й у кружків.
const PLAYER_BODY = '#6ea8ff';
const PLAYER_OUTLINE = '#31548c';
const PLAYER_GEAR = '#3d5c94';
const PLAYER_HELMET = '#d7e4f7';
const PLAYER_WEAPON = '#e8eef7';
const ALIEN_BODY = '#ff6b6b';
const ALIEN_OUTLINE = '#8f2f2f';
const ALIEN_EYES = '#5a1f1f';
const ALIEN_LIMBS = '#c95454';
const ALIEN_WEAPON = '#ffd27a';
const HP_TEXT = '#0b0e15';
const OW_MARKER = '#d8b25a';
const OW_OUTLINE = '#0b0e15'; // П6.12b: темний кант знака заступи — контраст на будь-якому тлі
const SELECT_RING = '#d7e4f7';
const BASE_FILL = '#4f8cff';
const BASE_OUTLINE = '#9fc3ff';
// П6.9 (ADR-0029): м'якші позначки НЛО — приглушені кольори (менш кислотні,
// ніж #e8c545/#e0a24a) і прозорість 0.85 з обов'язковим відновленням alpha.
const UFO_LANDED_FILL = '#cbb05a';
const UFO_LANDED_EDGE = '#e6d59a';
const UFO_AIR = '#c79250';
const UFO_SOFT_ALPHA = 0.85;
const UFO_LEG = '#a8862f'; // П6.12 (ADR-0031): опори приземленого НЛО
const RADAR_PULSE = '#4f8cff'; // колір пульсу радара — сімейство кольору бази
const BASE_WALL = '#234083'; // П6.12 (ADR-0031): темні стіни бази геосцени

// --- П6.13: нічна палітра бойовища (темно-графітовий терен, тонка сітка) ---
// Фон канви — той самий колір, що й CSS-тло елемента (index.html): при трясці
// translate оголює край 1–2px, і збіг кольорів лишає його непомітним.
export const NIGHT_BG = '#0a0d12';
// Двотоновий терен: відкритий / завалений, у тумані — приглушені ті самі
// тони (туман — лише рельєф, ADR-0006). «Легка варіація клітинок» — по одному
// з чотирьох відтінків на клітинку за детермінованим хешем координат (без RNG,
// ADR-0003): сусідні клітинки розрізняються, мозаїка стабільна між кадрами.
const TERRAIN_OPEN = ['#151b28', '#171e2c', '#131926', '#161d2b'];
const TERRAIN_BLOCKED = ['#3d4657', '#414b5d', '#38414f', '#3f4a5c'];
const TERRAIN_OPEN_FOG = ['#0b0e15', '#0c0f17', '#0a0d13', '#0d1018'];
const TERRAIN_BLOCKED_FOG = ['#232936', '#252b39', '#202633', '#242a38'];
// Тонка напівпрозора сітка: 1px у проміжках між клітинками (клітинки
// малюються зі стороною cell−1 — сітка заповнює проміжок, урок П6.6).
export const GRID_COLOR = 'rgba(110,168,255,0.07)';
// М'який край туману: клітинка туману з видимим сусідом (4 напрямки)
// перекривається напівпрозорим тоном відкритої видимої клітинки — межа
// «видимо → туман» стає градієнтною. Сенс туману незмінний (ADR-0006):
// рельєф туману видно і так, вміст клітинки (юніти) не розкривається,
// перекриття однакове для порожньої і заваленої клітинки.
const FOG_EDGE = 'rgba(21,27,40,0.45)';

// Дані для малювання юніта бойовища: cx/cy — центр клітинки в пікселях buffer'а,
// r — радіус маркерів (рамка вибору, заступа; у превью 8 при клітинці 26).
// hp — читабельність стану (ADR-0007). frame — кадр ходьби (0 «стій», 1 «крок»):
// передається лише анімацією руху (П6.12), у статиці малюється кадр «стій».
export interface UnitSprite {
  side: Side;
  cx: number;
  cy: number;
  r: number;
  hp: number;
  selected: boolean;
  overwatch: boolean;
  frame?: number;
}

export interface BaseSprite {
  cx: number;
  cy: number;
  size: number; // сторона клітинки геосцени (GCELL)
}

export interface UfoSprite {
  cx: number;
  cy: number;
  landed: boolean;
  kind: UfoKind;
}

// --- П6.12 (ADR-0031): піксель-арт — матриці пікселів + offscreen-канваси ---

// Матриця спрайта: рядки рівної довжини, символ → колір палітри,
// '.' (та будь-який символ поза палітрою) — прозорий піксель.
interface PixelSprite {
  rows: readonly string[];
  palette: Readonly<Record<string, string>>;
}

// Offscreen-канвас, структурно сумісний із HTMLCanvasElement. Фабрика
// ін'єктується (браузер: document.createElement; тести: мок) — render.ts
// не знає DOM-глобалів (той самий патерн, що й планувальник AnimEngine, ADR-0029).
export interface OffscreenCanvasLike {
  width: number;
  height: number;
  getContext(type: '2d'): CanvasRenderingContext2D | null;
}
export type MakeOffscreen = (w: number, h: number) => OffscreenCanvasLike;

let makeOffscreen: MakeOffscreen | null = null;

// Ініціалізація піксельного рушія: реєструє фабрику offscreen-канвасів і
// скидає кеш (тестовий код передає свій мок на кожен тест).
export function initPixelSprites(make: MakeOffscreen): void {
  makeOffscreen = make;
  spriteCache.clear();
}

// Кеш розгорнутих спрайтів: матриця → offscreen-канвас (ліниво, один раз на
// спрайт — ADR-0031). Ключ — сам об'єкт матриці (константи модуля, стабільні).
const spriteCache = new Map<PixelSprite, { img: CanvasImageSource; w: number; h: number }>();

// Розгортання матриці в offscreen-канвас 1 піксель на клітинку (детерміновано,
// без RNG — ADR-0003; помилка явно краще за мовчки порожній кадр).
function rasterSprite(def: PixelSprite): { img: CanvasImageSource; w: number; h: number } {
  const cached = spriteCache.get(def);
  if (cached !== undefined) return cached;
  if (makeOffscreen === null) {
    throw new Error('Піксельний рушій не ініціалізований — виклич initPixelSprites (ADR-0031)');
  }
  const h = def.rows.length;
  const w = def.rows[0]?.length ?? 0;
  const cv = makeOffscreen(w, h);
  const g = cv.getContext('2d');
  if (g === null) throw new Error('Offscreen-канвас без 2d-контексту (ADR-0031)');
  for (let y = 0; y < h; y++) {
    const row = def.rows[y] ?? '';
    for (let x = 0; x < row.length; x++) {
      const color = def.palette[row.charAt(x)];
      if (color !== undefined) {
        g.fillStyle = color;
        g.fillRect(x, y, 1, 1); // один піксель матриці
      }
    }
  }
  const built = { img: cv as unknown as CanvasImageSource, w, h };
  spriteCache.set(def, built);
  return built;
}

// Ціле кратне масштаб у клітинці (ADR-0031): 12×12 → 24px у клітинці BCELL 26
// (запас 1px з боків — маркери й рамка вибору в межах клітинки, урок П6.6),
// на 520 і 720px пікселі лишаються рівними квадратами.
export const SPRITE_SCALE = 2;

// Малювання розгорнутого спрайта: nearest-neighbor (без розмиття крайових
// пікселів — ADR-0031), позиція — цілі пікселі (Math.round).
function drawPixelSprite(ctx: CanvasRenderingContext2D, def: PixelSprite, cx: number, cy: number, scale: number): void {
  const s = rasterSprite(def);
  const w = s.w * scale;
  const h = s.h * scale;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(s.img, Math.round(cx - w / 2), Math.round(cy - h / 2), w, h);
}

// Маркер заступи (доробка П6.12b за повторною валідацією власника):
// піксельна «блискавка» з ТЕМНИМ КАНТОМ у кутку клітинки — гравець верхній
// лівий, прибульці нижній правий. Урок: золотий знак на пікселях спрайта
// (світлий шолом / червона мантія) без канту губився; кути матриць спрайтів
// прозорі, тло клітинки темне — золото з кантом видно на будь-якому тлі,
// силует не перекривається, HP-число в центрі не зачіпається. 5×5 @2× = 10×10.
const OW_BOLT: PixelSprite = {
  rows: ['.KKK.', 'KKAK.', 'KAAKK', 'KKAAK', '.KKKK'],
  palette: { A: OW_MARKER, K: OW_OUTLINE },
};

function drawOverwatchMarker(ctx: CanvasRenderingContext2D, u: UnitSprite): void {
  const off = u.side === 'player' ? -8 : 7; // кути клітинки: згори-ліворуч / знизу-праворуч
  drawPixelSprite(ctx, OW_BOLT, u.cx + off, u.cy + off, SPRITE_SCALE);
}

// Рамка вибору (доробка П6.12 за валідацією власника): кутові дужки по кутах
// спрайта — не перекривають силует (кільце навколо центру лягало на пікселі);
// кути матриць спрайтів прозорі — дужки лягають на чисте місце.
function drawSelectionBrackets(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  const s = 12; // половина спрайта (24px у клітинці 26)
  const arm = 4; // довжина плеча дужки
  ctx.strokeStyle = SELECT_RING;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - s, cy - s + arm);
  ctx.lineTo(cx - s, cy - s);
  ctx.lineTo(cx - s + arm, cy - s);
  ctx.moveTo(cx + s - arm, cy - s);
  ctx.lineTo(cx + s, cy - s);
  ctx.lineTo(cx + s, cy - s + arm);
  ctx.moveTo(cx + s, cy + s - arm);
  ctx.lineTo(cx + s, cy + s);
  ctx.lineTo(cx + s - arm, cy + s);
  ctx.moveTo(cx - s + arm, cy + s);
  ctx.lineTo(cx - s, cy + s);
  ctx.lineTo(cx - s, cy + s - arm);
  ctx.stroke();
  ctx.lineWidth = 1;
}

function drawHpText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number): void {
  ctx.font = '9px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = HP_TEXT;
  ctx.fillText(text, x, y);
}

// ADR-0031 (П6.12): солдат зі штурмовою гвинтівкою «АР-14 Гарт» — шолом з
// темним визором, броня, рюкзак зліва, ствол вправо (дуло — крайній правий
// піксель матриці, за межами тіла), магазин темний під стволом.
const SOLDIER_PALETTE: Readonly<Record<string, string>> = {
  H: PLAYER_HELMET,
  O: PLAYER_OUTLINE,
  B: PLAYER_BODY,
  G: PLAYER_GEAR,
  W: PLAYER_WEAPON,
};

const SOLDIER_STAND: PixelSprite = {
  rows: [
    '....HHHH....',
    '...HHHHHH...',
    '...HHHHHH...',
    '...HOOOOH...',
    '..BBBBBBBB..',
    '.GBBBBBBBB..',
    '.GGBBBBBBWW.',
    '.GGBBBBBWWWW',
    '..BBBBBBOO..',
    '..GG..GG....',
    '..OO..OO....',
    '............',
  ],
  palette: SOLDIER_PALETTE,
};

// Кадр ходьби: ноги розставлені (крок) — решта силуету та сама (ADR-0031).
const SOLDIER_STEP: PixelSprite = {
  rows: [
    '....HHHH....',
    '...HHHHHH...',
    '...HHHHHH...',
    '...HOOOOH...',
    '..BBBBBBBB..',
    '.GBBBBBBBB..',
    '.GGBBBBBBWW.',
    '.GGBBBBBWWWW',
    '..BBBBBBOO..',
    '..GG...GG...',
    '.OO.....OO..',
    '............',
  ],
  palette: SOLDIER_PALETTE,
};

export function drawSoldierSprite(ctx: CanvasRenderingContext2D, u: UnitSprite): void {
  drawPixelSprite(ctx, (u.frame ?? 0) === 1 ? SOLDIER_STEP : SOLDIER_STAND, u.cx, u.cy, SPRITE_SCALE);
  if (u.overwatch) drawOverwatchMarker(ctx, u);
  drawHpText(ctx, String(u.hp), u.cx, u.cy);
  if (u.selected) drawSelectionBrackets(ctx, u.cx, u.cy);
}

// ADR-0031 (П6.12): прибульчик з «Імпульсним різаком» — енергетична «вилка»
// з двома піками над головою, мантія з темними очима, щупальця знизу.
// Силует і зброя свідомо відмінні від солдата (критерій П6.12: зброя
// відрізляється — колір, форма і розташування пікселів).
const ALIEN_PALETTE: Readonly<Record<string, string>> = {
  A: ALIEN_BODY,
  E: ALIEN_EYES,
  L: ALIEN_LIMBS,
  Y: ALIEN_WEAPON,
  R: ALIEN_OUTLINE,
};

const ALIEN_STAND: PixelSprite = {
  rows: [
    '....Y..Y....',
    '....Y..Y....',
    '.....YY.....',
    '....AAAA....',
    '...AAAAAA...',
    '...AEAAEA...',
    '..RAAAAAAR..',
    '..RAAAAAAR..',
    '..RAAAAAAR..',
    '...RAAAAR...',
    '...L.LL.L...',
    '...L.LL.L...',
  ],
  palette: ALIEN_PALETTE,
};

// Кадр ходьби: щупальця зсунуті (колищо) — решта силуету та сама (ADR-0031).
const ALIEN_STEP: PixelSprite = {
  rows: [
    '....Y..Y....',
    '....Y..Y....',
    '.....YY.....',
    '....AAAA....',
    '...AAAAAA...',
    '...AEAAEA...',
    '..RAAAAAAR..',
    '..RAAAAAAR..',
    '..RAAAAAAR..',
    '...RAAAAR...',
    '..L.LL.L....',
    '..L.LL.L....',
  ],
  palette: ALIEN_PALETTE,
};

export function drawAlienSprite(ctx: CanvasRenderingContext2D, u: UnitSprite): void {
  drawPixelSprite(ctx, (u.frame ?? 0) === 1 ? ALIEN_STEP : ALIEN_STAND, u.cx, u.cy, SPRITE_SCALE);
  if (u.overwatch) drawOverwatchMarker(ctx, u);
  drawHpText(ctx, String(u.hp), u.cx, u.cy);
  if (u.selected) drawSelectionBrackets(ctx, u.cx, u.cy);
}

// Диспетчер за стороною — єдина точка виклику з renderBattle.
export function drawUnitSprite(ctx: CanvasRenderingContext2D, u: UnitSprite): void {
  if (u.side === 'player') drawSoldierSprite(ctx, u);
  else drawAlienSprite(ctx, u);
}

// ADR-0031 (П6.12, доробка за валідацією власника): база геосцени —
// «Радарний пост»: велика світла тарілка на темній щоглі, світла хатина
// з темними воротами. Один великий знак замість дрібних деталей (попередня
// 16×16 «фортеця» на 32px читалась як темний блок). Напис «БАЗА» — ПІД
// спрайтом, світлим на темному тлі (раніше текст поверх іконки мав
// майже нульовий контраст). 12×12 @ 2× = 24px у клітинці GCELL 36.
const BASE_SPRITE: PixelSprite = {
  rows: [
    '...OOOOOO...',
    '....OOOO....',
    '.....OO.....',
    '.....DD.....',
    '.....DD.....',
    '..BBBBBBBB..',
    '.OOOOOOOOOO.',
    '.OOOODDOOOO.',
    '.OOOODDOOOO.',
    '.OOOODDOOOO.',
    '.OOOOOOOOOO.',
    '............',
  ],
  palette: { O: BASE_OUTLINE, D: BASE_WALL, B: BASE_FILL },
};

export function drawBaseSprite(ctx: CanvasRenderingContext2D, b: BaseSprite): void {
  // спрайт — трохи вище центру клітинки, під ним напис (обидва в межах клітинки)
  drawPixelSprite(ctx, BASE_SPRITE, b.cx, b.cy - 4, SPRITE_SCALE);
  ctx.font = '9px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = BASE_OUTLINE;
  ctx.fillText('БАЗА', b.cx, b.cy + 13);
}

// Позначка НЛО геосцени (туман: лише виявлені потрапляють у виклик — фільтр у main.ts).
// П6.9 (ADR-0029): м'якість (alpha 0.85 з відновленням) лишається.
// П6.12 (ADR-0031): форми — піксельні: приземлений — тарілка з куполом і
// опорами, «розвідник» — порожній ромб, «збирач» — контур кола з ядром-відсіком.
const UFO_LANDED_SPRITE: PixelSprite = {
  rows: [
    '...SSSS...',
    '..SSSSSS..',
    '..SSSSSS..',
    '.HHHHHHHH.',
    'HHHHHHHHHH',
    'HHHHHHHHHH',
    '.HHHHHHHH.',
    '..HHHHHH..',
    '..G....G..',
    '..G....G..',
  ],
  palette: { H: UFO_LANDED_FILL, S: UFO_LANDED_EDGE, G: UFO_LEG },
};

const UFO_SCOUT_SPRITE: PixelSprite = {
  rows: [
    '....AA....',
    '...A..A...',
    '..A....A..',
    '.A......A.',
    'A........A',
    'A........A',
    '.A......A.',
    '..A....A..',
    '...A..A...',
    '....AA....',
  ],
  palette: { A: UFO_AIR },
};

const UFO_HARVESTER_SPRITE: PixelSprite = {
  rows: [
    '..AAAAAA..',
    '.A......A.',
    'A........A',
    'A........A',
    'A...AA...A',
    'A...AA...A',
    'A........A',
    'A........A',
    '.A......A.',
    '..AAAAAA..',
  ],
  palette: { A: UFO_AIR },
};

export function drawUfoSprite(ctx: CanvasRenderingContext2D, u: UfoSprite): void {
  ctx.globalAlpha = UFO_SOFT_ALPHA;
  const def = u.landed ? UFO_LANDED_SPRITE : u.kind === 'розвідник' ? UFO_SCOUT_SPRITE : UFO_HARVESTER_SPRITE;
  drawPixelSprite(ctx, def, u.cx, u.cy, SPRITE_SCALE); // 10×10 → 20px у клітинці GCELL 36
  ctx.globalAlpha = 1;
}

// --- П6.13: нічна палітра бойовища — терен, сітка, м'який край туману ---

// Клітинка терену для drawNightTerrain: blocked — завалення (рельєф туману
// видно і в тумані, ADR-0006), visible — у зоні видимості гравця.
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

// Нічний терен: фон → клітинки (двотоновий терен з хеш-варіацією) → м'який
// край туману → тонка сітка в проміжках. Чиста функція без RNG і DOM-стану;
// викликається кожен кадр після clearRect (урок П6.6) — кадр еквівалентний
// малюванню з нуля. w/h — розмір buffer'а канви в пікселях, cell — BCELL.
export function drawNightTerrain(ctx: CanvasRenderingContext2D, w: number, h: number, cells: readonly TerrainCell[], cell: number): void {
  // фон на весь buffer (при трясці translate оголює край — колір збігається з CSS-тлом)
  ctx.fillStyle = NIGHT_BG;
  ctx.fillRect(0, 0, w, h);
  // мапа видимості для м'якого краю туману (сусідство за 4 напрямками)
  const vis = new Set(cells.filter((c) => c.visible).map((c) => c.x + ',' + c.y));
  // клітинки: два тони (відкритий / завалений) × туман/видимо, відтінок — хеш
  for (const c of cells) {
    const shades = c.blocked ? (c.visible ? TERRAIN_BLOCKED : TERRAIN_BLOCKED_FOG) : c.visible ? TERRAIN_OPEN : TERRAIN_OPEN_FOG;
    ctx.fillStyle = shades[cellHash(c.x, c.y) % shades.length] ?? shades[0]!;
    ctx.fillRect(c.x * cell, c.y * cell, cell - 1, cell - 1);
  }
  // м'який край туману: напівпрозоре перекриття на клітинках туману біля видимих
  ctx.fillStyle = FOG_EDGE;
  for (const c of cells) {
    if (c.visible) continue;
    const nearVisible =
      vis.has(c.x - 1 + ',' + c.y) || vis.has(c.x + 1 + ',' + c.y) || vis.has(c.x + ',' + (c.y - 1)) || vis.has(c.x + ',' + (c.y + 1));
    if (nearVisible) ctx.fillRect(c.x * cell, c.y * cell, cell - 1, cell - 1);
  }
  // тонка сітка: 1px у проміжках між клітинками (стовпці і рядки)
  ctx.fillStyle = GRID_COLOR;
  const cols = Math.floor(w / cell);
  const rows = Math.floor(h / cell);
  for (let i = 1; i < cols; i++) ctx.fillRect(i * cell - 1, 0, 1, h);
  for (let j = 1; j < rows; j++) ctx.fillRect(0, j * cell - 1, w, 1);
}

// --- П6.8 (ADR-0029): анімаційний рушій — черга + rAF лише під час активних анімацій ---

// Тривалості фаз (мс): стримка анімація, без поспіху (дизайн-сесія 6b).
export const MOVE_MS_PER_CELL = 90; // хід: 90 мс на клітинку шляху
export const TRACER_MS = 150; // трасер кулі від стрільця до цілі
export const IMPACT_MS = 200; // спалах влучання (лише при попаданні)
export const DEATH_MS = 350; // згасання силуета загиблого
export const OW_FLASH_MS = 300; // спалах заступи (озброєння реакційного вогню)
export const RADAR_PULSE_MS = 1200; // П6.9: пульс радара — від бази до краю зони виявлення

// Один елемент черги анімацій. start — мітка часу початку відтворення
// (призначає рушій на першому кадрі; null — ще не починалось).
export interface MoveAnim {
  kind: 'move';
  unitId: string;
  side: Side;
  path: Vec2[]; // [from, to1, ...] — клітинкові координати
  hp: number; // знімок стану на момент постановки в чергу
  overwatch: boolean;
  selected: boolean;
  dur: number;
  start: number | null;
}
export interface TracerAnim {
  kind: 'tracer';
  side: Side; // сторона стрільця — колір трасера
  from: Vec2;
  to: Vec2;
  hit: boolean;
  dur: number; // TRACER_MS (+ IMPACT_MS при влучанні)
  start: number | null;
}
export interface DeathAnim {
  kind: 'death';
  side: Side;
  at: Vec2;
  dur: number;
  start: number | null;
}
export interface OwFlashAnim {
  kind: 'owflash';
  side: Side;
  at: Vec2;
  dur: number;
  start: number | null;
}
// П6.9 (ADR-0029): пульс радара геосцени — кільце, що розходиться від бази
// до краю зони виявлення і гасне. Суто візуальний: не читає ні НЛО, ні geo.rng;
// невиявлені НЛО не показуються і не анімуються (туман — ADR-0006/0029).
export interface GeoPulseAnim {
  kind: 'gpulse';
  cx: number; // центр бази в пікселях buffer'а
  cy: number;
  maxR: number; // радіус зони виявлення в пікселях
  dur: number;
  start: number | null;
}
export type Anim = MoveAnim | TracerAnim | DeathAnim | OwFlashAnim | GeoPulseAnim;

// Знімки стану беруться ПІСЛЯ застосування дії ядром (позиція/HP уже фінальні,
// лог — джерело істини про те, що відбулося).
export function makeMoveAnim(u: Unit, path: Vec2[], selected: boolean): MoveAnim {
  return {
    kind: 'move',
    unitId: u.id,
    side: u.side,
    path,
    hp: u.hp,
    overwatch: u.overwatch,
    selected,
    dur: Math.max(1, path.length - 1) * MOVE_MS_PER_CELL,
    start: null,
  };
}
export function makeTracerAnim(side: Side, from: Vec2, to: Vec2, hit: boolean): TracerAnim {
  return { kind: 'tracer', side, from, to, hit, dur: TRACER_MS + (hit ? IMPACT_MS : 0), start: null };
}
export function makeDeathAnim(u: Unit): DeathAnim {
  return { kind: 'death', side: u.side, at: { ...u.pos }, dur: DEATH_MS, start: null };
}
export function makeOwFlashAnim(u: Unit): OwFlashAnim {
  return { kind: 'owflash', side: u.side, at: { ...u.pos }, dur: OW_FLASH_MS, start: null };
}
export function makeGeoPulseAnim(cx: number, cy: number, maxR: number): GeoPulseAnim {
  return { kind: 'gpulse', cx, cy, maxR, dur: RADAR_PULSE_MS, start: null };
}

// Прогрес анімації 0..1 (за межами — клімпиться; start === null → ще не почалась).
export function animT(a: Anim, now: number): number {
  if (a.start === null) return 0;
  return Math.min(1, Math.max(0, (now - a.start) / a.dur));
}

// Позиція рухомого юніта на кадрі: інтерполяція вздовж ламаної шляху (клітинки → px).
export function moveAnimPos(a: MoveAnim, t: number, cell: number): { cx: number; cy: number } {
  const pts = a.path;
  if (t <= 0 || pts.length < 2) return { cx: pts[0].x * cell + cell / 2, cy: pts[0].y * cell + cell / 2 };
  if (t >= 1) {
    const last = pts[pts.length - 1];
    return { cx: last.x * cell + cell / 2, cy: last.y * cell + cell / 2 };
  }
  const prog = t * (pts.length - 1);
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
// Викликаюч робить ctx.translate(dx, dy) на весь кадр; фон канви збігається з
// CSS-тлом — оголений край непомітний. Промах не трясе.
export const SHAKE_PX = 2; // максимальна амплітуда (легка тряска)
export function shakeOffset(a: Anim | null, now: number): { dx: number; dy: number } {
  if (a === null || a.kind !== 'tracer' || !a.hit || a.start === null) return { dx: 0, dy: 0 };
  const t = animT(a, now);
  const share = TRACER_MS / a.dur;
  if (t <= share || t >= 1) return { dx: 0, dy: 0 }; // лише фаза спалаху влучання
  const f = (t - share) / (1 - share);
  const amp = SHAKE_PX * (1 - f); // спадає до нуля до кінця спалаху
  // + 0 нормалізує -0 від Math.round малих від'ємних значень (0 === -0, але
  // зсув кадру лишається «строго нульовим» і детермінованим у тестах)
  return { dx: Math.round(amp * Math.sin(f * Math.PI * 4)) + 0, dy: Math.round(amp * Math.cos(f * Math.PI * 4)) + 0 };
}

// П6.13: яскравіші неонові трасери/спалахи (нічна палітра — «дарк» терен,
// неонові акценти): холодний блакитний у гравця, розпечений оранж у прибульців;
// свічення — shadowBlur навколо лінії/кільця (обов'язково скидається).
const TRACER_PLAYER = '#6fd3ff';
const TRACER_ALIEN = '#ff9a52';
const IMPACT = '#ffe38a';
const TRACER_GLOW = 6; // радіус свічення трасера
const IMPACT_GLOW = 8; // радіус свічення спалаху
const OW_FLASH = '#d8b25a';

// Один кадр анімаційного шару (малюється поверх статичного стану).
// move — силует у проміжній позиції; tracer — куля летить від стрільця до цілі,
// при влучанні друга фаза — спалах-кільце; death — згасання силуета; owflash —
// пульсуюче кільце заступи. Усі координати — у межах клітинок (урок П6.6).
export function drawAnimFrame(ctx: CanvasRenderingContext2D, a: Anim, now: number, cell: number, r: number): void {
  const t = animT(a, now);
  // П6.9: пульс радара геосцени — кільце від бази до maxR, що гасне.
  // Клітинка і радіус силуету не потрібні (cell/r — параметри бойовища).
  if (a.kind === 'gpulse') {
    ctx.globalAlpha = 0.6 * (1 - t);
    ctx.strokeStyle = RADAR_PULSE;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(a.cx, a.cy, 2 + (a.maxR - 2) * t, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.globalAlpha = 1;
    return;
  }
  if (a.kind === 'move') {
    const p = moveAnimPos(a, t, cell);
    // П6.12 (ADR-0031): кадри ходьби — з прогресу шляху, детерміновано
    // (2 кадри на клітинку, без RNG); у статиці малюється кадр «стій».
    const frame = Math.floor(t * Math.max(1, a.path.length - 1) * 2) % 2;
    drawUnitSprite(ctx, {
      side: a.side,
      cx: p.cx,
      cy: p.cy,
      r,
      hp: a.hp,
      selected: a.selected,
      overwatch: a.overwatch,
      frame,
    });
    return;
  }
  if (a.kind === 'tracer') {
    const x0 = a.from.x * cell + cell / 2;
    const y0 = a.from.y * cell + cell / 2;
    const x1 = a.to.x * cell + cell / 2;
    const y1 = a.to.y * cell + cell / 2;
    const share = TRACER_MS / a.dur;
    if (t < share) {
      // фаза 1: куля летить — відрізок від стрільця до поточного «заголовка»
      const f = t / share;
      const color = a.side === 'player' ? TRACER_PLAYER : TRACER_ALIEN;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.shadowColor = color; // П6.13: неонове свічення трасера
      ctx.shadowBlur = TRACER_GLOW;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x0 + (x1 - x0) * f, y0 + (y1 - y0) * f);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.lineWidth = 1;
    } else if (a.hit) {
      // фаза 2: спалах у цілі — кільце, що росте і гасне
      const f = (t - share) / (1 - share);
      ctx.globalAlpha = 1 - f;
      ctx.strokeStyle = IMPACT;
      ctx.lineWidth = 2;
      ctx.shadowColor = IMPACT; // П6.13: свічення спалаху
      ctx.shadowBlur = IMPACT_GLOW;
      ctx.beginPath();
      ctx.arc(x1, y1, 3 + 5 * f, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 1;
    }
    return;
  }
  if (a.kind === 'death') {
    ctx.globalAlpha = 1 - t;
    drawUnitSprite(ctx, {
      side: a.side,
      cx: a.at.x * cell + cell / 2,
      cy: a.at.y * cell + cell / 2,
      r,
      hp: 0,
      selected: false,
      overwatch: false,
    });
    ctx.globalAlpha = 1;
    return;
  }
  // owflash: кільце заступи, що росте і гасне (колір — як маркер заступи)
  ctx.globalAlpha = 1 - t;
  ctx.strokeStyle = OW_FLASH;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(a.at.x * cell + cell / 2, a.at.y * cell + cell / 2, 4 + 6 * t, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.globalAlpha = 1;
}

// Рушій: анімації відтворюються послідовно (черга), rAF-цикл живе ЛИШЕ поки
// черга непорожня — idle → 0 перерисовок (ADR-0029; батарея iPad). Останній
// кадр (черга спорожніла) малюється ще раз — статичний стан без шару анімації.
// schedule/cancel — ін'єктовані (rAF у браузері; у тестах — фейк): render.ts
// не знає DOM-глобалів.
export interface AnimEngineDeps {
  schedule: (cb: (now: number) => void) => unknown;
  cancel: (handle: unknown) => void;
  draw: () => void; // повний кадр: clearRect + статика + анімаційний шар (урок П6.6)
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
      return;
    }
    this.handle = this.deps.schedule(this.frame);
  };
}

// Чистий перетворювач подій логу бою в анімації (П6.8, ADR-0029: анімація —
// відображення, лог — джерело істини). Лог і юніти тільки ЧИТАЮТЬСЯ:
// state.log/стан байт-у-байт не змінюються.
// Особливості порядку подій ядра: moveUnit пише окрему подію на кожен крок
// (реакційний вогонь між кроками перериває рух) — послідовні кроки одного
// юніта об'єднуються в один хід по шляху; fireOnce пише смерть РАНІШЕ за
// постріл, що її спричинив — відтворюємо спершу трасер, потім смерть.
export function animsFromEvents(events: readonly GameEvent[], units: readonly Unit[]): Anim[] {
  const byId = new Map(units.map((u) => [u.id, u]));
  const anims: Anim[] = [];
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
          anims.push(makeTracerAnim(shooter.side, { ...shooter.pos }, { ...victim.pos }, next.hit));
          anims.push(makeDeathAnim(victim));
        }
        i += 2;
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
        anims.push(makeTracerAnim(shooter.side, { ...shooter.pos }, { ...target.pos }, e.hit));
      }
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
