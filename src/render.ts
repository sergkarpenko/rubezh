// src/render.ts — шар відображення (ADR-0010/0029/0031, П6.7/П6.8/П6.12/П6.13):
// піксель-арт спрайти Canvas 2D + кадри анімаційного шару + нічна палітра
// бойовища (терен з хеш-варіацією, тонка сітка, м'який край туману, тряска).
// пR.3 (ADR-0038): чисті дані (матриці, палітри, типи) — src/core/sprites.ts,
// чиста логіка кадрів/анімацій (AnimEngine, анімації, палітра терену) —
// src/core/render-core.ts; тут — лише розгортання в offscreen-канвас
// і Canvas-виклики. Спрайти розгортаються ліниво в offscreen-канвас
// низької роздільності з кешем і малюються drawImage з nearest-neighbor
// (imageSmoothingEnabled = false) у ціле кратному масштабі — крайові пікселі
// без розмиття. Кадри ходьби — окремі матриці, чергуються у анімації руху.
// Чисті функції малювання: без DOM-стану і без RNG (ADR-0002/0003 — ядро не зачіпається);
// експортовані для юніт-тестів (мок-контекст записує виклики).
// П6.8 (ADR-0029): анімація — суто візуальний шар. Дії ядра застосовуються миттєво,
// анімація лише відтворює результат поверх фактичного стану: лог бою
// байт-у-байт незмінний, RNG не викликається, туман (видимість) вирішує викликаюч.

import {
  FOG_EDGE,
  GEO_GRID_COLOR,
  GRID_COLOR,
  NIGHT_BG,
  TRACER_MS,
  animT,
  geoCellTone,
  hasVisibleNeighbor,
  moveAnimPos,
  terrainShade,
  visibleKeys,
  type Anim,
  type TerrainCell,
} from './core/render-core';
import {
  ALIEN_STAND,
  ALIEN_STEP,
  BASE_OUTLINE,
  BASE_SPRITE,
  FIGHTER_SPRITE,
  OW_BOLT,
  SOLDIER_STAND,
  SOLDIER_STEP,
  SPRITE_SCALE,
  UFO_HARVESTER_SPRITE,
  UFO_LANDED_SPRITE,
  UFO_SCOUT_SPRITE,
  type BaseSprite,
  type FighterSprite,
  type PixelSprite,
  type UnitSprite,
  type UfoSprite,
} from './core/sprites';

const HP_TEXT = '#0b0e15';
const SELECT_RING = '#9adfff'; // П12.7: рамка вибору — гама ціану «Рубіжу» (ADR-0064)
const UFO_SOFT_ALPHA = 0.85;
const RADAR_PULSE = '#00e5ff'; // П12.7: пульс сенсорної сітки — неоновий ціан «Рубіжу» (ADR-0064)

// --- П6.12 (ADR-0031): піксель-арт — offscreen-канваси ---

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

// Малювання розгорнутого спрайта: nearest-neighbor (без розмиття крайових
// пікселів — ADR-0031), позиція — цілі пікселі (Math.round).
function drawPixelSprite(ctx: CanvasRenderingContext2D, def: PixelSprite, cx: number, cy: number, scale: number): void {
  const s = rasterSprite(def);
  const w = s.w * scale;
  const h = s.h * scale;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(s.img, Math.round(cx - w / 2), Math.round(cy - h / 2), w, h);
}

function drawOverwatchMarker(ctx: CanvasRenderingContext2D, u: UnitSprite): void {
  const off = u.side === 'player' ? -12 : 12; // кути клітинки: згори-ліворуч / знизу-праворуч (П13.5: BCELL 36)
  drawPixelSprite(ctx, OW_BOLT, u.cx + off, u.cy + off, SPRITE_SCALE);
}

// Рамка вибору (доробка П6.12 за валідацією власника): кутові дужки по кутах
// спрайта — не перекривають силует (кільце навколо центру лягало на пікселі);
// кути матриць спрайтів прозорі — дужки лягають на чисте місце.
function drawSelectionBrackets(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  const s = 16; // половина спрайта (32px у клітинці 36 — П13.5)
  const arm = 6; // довжина плеча дужки
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
  ctx.font = '11px system-ui'; // П13.5: читабельність при більшому спрайті
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = HP_TEXT;
  ctx.fillText(text, x, y);
}

export function drawSoldierSprite(ctx: CanvasRenderingContext2D, u: UnitSprite): void {
  drawPixelSprite(ctx, (u.frame ?? 0) === 1 ? SOLDIER_STEP : SOLDIER_STAND, u.cx, u.cy, SPRITE_SCALE);
  if (u.overwatch) drawOverwatchMarker(ctx, u);
  drawHpText(ctx, String(u.hp), u.cx, u.cy);
  if (u.selected) drawSelectionBrackets(ctx, u.cx, u.cy);
}

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

export function drawBaseSprite(ctx: CanvasRenderingContext2D, b: BaseSprite): void {
  // спрайт — трохи вище центру клітинки, під ним напис (обидва в межах клітинки)
  drawPixelSprite(ctx, BASE_SPRITE, b.cx, b.cy - 6, SPRITE_SCALE);
  ctx.font = '11px system-ui'; // П13.5: більший підпис під більшим спрайтом
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = BASE_OUTLINE;
  ctx.fillText('ВУЗОЛ', b.cx, b.cy + 16);
}

export function drawFighterSprite(ctx: CanvasRenderingContext2D, f: FighterSprite): void {
  drawPixelSprite(ctx, FIGHTER_SPRITE, f.cx, f.cy, SPRITE_SCALE);
}

export function drawUfoSprite(ctx: CanvasRenderingContext2D, u: UfoSprite): void {
  ctx.globalAlpha = UFO_SOFT_ALPHA;
  const def = u.landed ? UFO_LANDED_SPRITE : u.kind === 'розвідник' ? UFO_SCOUT_SPRITE : UFO_HARVESTER_SPRITE;
  drawPixelSprite(ctx, def, u.cx, u.cy, SPRITE_SCALE); // П13.5: 12×12 → 24px у клітинці GCELL 44
  ctx.globalAlpha = 1;
}

// --- П6.13: нічна палітра бойовища — терен, сітка, м'який край туману ---
// Палітра, хеш-варіація і сусідство туману — чиста логіка src/core/render-core.ts
// (terrainShade/visibleKeys/hasVisibleNeighbor); тут — лише Canvas-виклики.

// Нічний терен: фон → клітинки (двотоновий терен з хеш-варіацією) → м'який
// край туману → тонка сітка в проміжках. Чиста функція без RNG і DOM-стану;
// викликається кожен кадр після clearRect (урок П6.6) — кадр еквівалентний
// малюванню з нуля. w/h — розмір buffer'а канви в пікселях, cell — BCELL.
export function drawNightTerrain(ctx: CanvasRenderingContext2D, w: number, h: number, cells: readonly TerrainCell[], cell: number): void {
  // фон на весь buffer (при трясці translate оголює край — колір збігається з CSS-тлом)
  ctx.fillStyle = NIGHT_BG;
  ctx.fillRect(0, 0, w, h);
  // мапа видимості для м'якого краю туману (сусідство за 4 напрямками)
  const vis = visibleKeys(cells);
  // клітинки: два тони (відкритий / завалений) × туман/видимо, відтінок — хеш
  for (const c of cells) {
    ctx.fillStyle = terrainShade(c.x, c.y, c.blocked, c.visible);
    ctx.fillRect(c.x * cell, c.y * cell, cell - 1, cell - 1);
  }
  // м'який край туману: напівпрозоре перекриття на клітинках туману біля видимих
  ctx.fillStyle = FOG_EDGE;
  for (const c of cells) {
    if (c.visible) continue;
    if (hasVisibleNeighbor(vis, c.x, c.y)) ctx.fillRect(c.x * cell, c.y * cell, cell - 1, cell - 1);
  }
  // тонка сітка: 1px у проміжках між клітинками (стовпці і рядки)
  ctx.fillStyle = GRID_COLOR;
  const cols = Math.floor(w / cell);
  const rows = Math.floor(h / cell);
  for (let i = 1; i < cols; i++) ctx.fillRect(i * cell - 1, 0, 1, h);
  for (let j = 1; j < rows; j++) ctx.fillRect(0, j * cell - 1, w, 1);
}

// --- П12.7 (ADR-0064): терен геосцени — двотоновий із неоновою сіткою ---
// Палітра і тон — чиста логіка src/core/render-core.ts (geoCellTone —
// детермінований хеш, без RNG, ADR-0003); тут — лише Canvas-виклики.
// Кадр еквівалентний малюванню з нуля (патерн renderGeo, урок П6.6):
// повна заливка фону → двотонові клітинки на всю сторону GCELL → тонкі
// неонові лінії сітки по межах (у геосцені немає проміжків між клітинками).
// Чиста функція без DOM-стану; викликається з src/ui/panels.ts (renderGeo).
export function drawGeoTerrain(ctx: CanvasRenderingContext2D, w: number, h: number, cell: number): void {
  // фон на весь buffer — краї канви не блимають
  ctx.fillStyle = NIGHT_BG;
  ctx.fillRect(0, 0, w, h);
  const cols = Math.ceil(w / cell);
  const rows = Math.ceil(h / cell);
  // двотоновий терен: тон клітинки — хеш координат, мозаїка стабільна між кадрами
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      ctx.fillStyle = geoCellTone(x, y);
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  }
  // тонка неонова сітка: лінії по межах клітинок наскрізь (ціан «Рубіжу»)
  ctx.strokeStyle = GEO_GRID_COLOR;
  ctx.lineWidth = 1;
  for (let x = 0; x <= cols; x++) {
    ctx.beginPath();
    ctx.moveTo(x * cell, 0);
    ctx.lineTo(x * cell, rows * cell);
    ctx.stroke();
  }
  for (let y = 0; y <= rows; y++) {
    ctx.beginPath();
    ctx.moveTo(0, y * cell);
    ctx.lineTo(cols * cell, y * cell);
    ctx.stroke();
  }
}

// --- П6.14: UX прицілювання — обведення валідних цілей і шанс попадання ---

// Обведення цілі — бурштиновий неон П12.7 (ADR-0064), плашка шансу — бурштин.
export const TARGET_FRAME_COLOR = 'rgba(255,179,71,0.9)';
export const CHANCE_LABEL_BG = 'rgba(10,13,18,0.85)';
export const CHANCE_LABEL_TEXT = '#ffcf5c';

export interface TargetFrame {
  gx: number; // клітинка цілі
  gy: number;
  cell: number;
}

// Обведення клітинки валідної цілі у зведеному режимі пострілу: пунктирна рамка
// строго в межах клітинки (урок П6.6 — не бруднити проміжки), dash скидається
// save/restore (стан кадру не витікає у подальше малювання).
export function drawTargetFrame(ctx: CanvasRenderingContext2D, f: TargetFrame): void {
  ctx.save();
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = TARGET_FRAME_COLOR;
  ctx.lineWidth = 2;
  ctx.strokeRect(f.gx * f.cell + 2, f.gy * f.cell + 2, f.cell - 4, f.cell - 4);
  ctx.restore();
}

export interface ChanceLabel {
  gx: number; // клітинка цілі
  gy: number;
  cell: number;
  cw: number; // ширина buffer'а канви (px) — clamp правого краю
  text: string; // наприклад '~62%'
}

// Шанс попадання біля клітинки цілі: темна плашка з неоновим текстом над
// клітинкою (біля верхнього краю канви — під нею). Ширина — оцінка 6px на
// символ моноширинного шрифту 10px (без measureText — мок-контекст jsdom його
// не реалізує), за правий край канви не виходить.
export function drawChanceLabel(ctx: CanvasRenderingContext2D, l: ChanceLabel): void {
  const w = l.text.length * 6 + 4;
  const h = 13;
  let x = l.gx * l.cell + 1;
  if (x + w > l.cw) x = l.cw - w - 1;
  const y = l.gy * l.cell >= h + 1 ? l.gy * l.cell - (h + 1) : (l.gy + 1) * l.cell + 1;
  ctx.fillStyle = CHANCE_LABEL_BG;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = CHANCE_LABEL_TEXT;
  ctx.font = '10px monospace';
  ctx.textBaseline = 'top';
  ctx.fillText(l.text, x + 2, y + 2);
}

// П6.13 (П12.7, ADR-0064): неонові трасери/спалахи у гамі Рубіжу — холодний
// ціан у гравця («Рубіж»), пурпур-маджента у демонів Розриву, спалах влучання
// і маркери дозору — бурштин; свічення — shadowBlur навколо лінії/кільця
// (обов'язково скидається). Глітч-акценти — лише в подієвих кадрах нижче,
// статичний шар не зашумлюється (читабельність пріоритет, ADR-0064).
const TRACER_PLAYER = '#00e5ff';
const TRACER_RIFT = '#ff2e88';
const IMPACT = '#ffb347';
const TRACER_GLOW = 6; // радіус свічення трасера
const IMPACT_GLOW = 8; // радіус свічення спалаху
const OW_FLASH = '#ffb347';

// Один кадр анімаційного шару (малюється поверх статичного стану).
// move — силует у проміжній позиції; tracer — куля летить від стрільця до цілі,
// при влучанні друга фаза — спалах-кільце; death — згасання силуета; owflash —
// пульсуюче кільце дозору. Усі координати — у межах клітинок (урок П6.6).
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
      const color = a.side === 'player' ? TRACER_PLAYER : TRACER_RIFT;
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
  // owflash: кільце дозору, що росте і гасне (колір — як маркер дозору)
  ctx.globalAlpha = 1 - t;
  ctx.strokeStyle = OW_FLASH;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(a.at.x * cell + cell / 2, a.at.y * cell + cell / 2, 4 + 6 * t, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.globalAlpha = 1;
}
