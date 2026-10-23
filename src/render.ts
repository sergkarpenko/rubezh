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
  BOOM_PARTICLES,
  FOG_EDGE,
  GEO_CELL_A,
  GEO_CELL_B,
  GEO_GRID_COLOR,
  GRID_COLOR,
  NIGHT_BG,
  TRACER_MS,
  animT,
  boomParticleOffset,
  cellHash,
  geoIsLand,
  GEO_LAND_ROWS,
  hasVisibleNeighbor,
  moveAnimPos,
  terrainShade,
  visibleKeys,
  type Anim,
  type TerrainCell,
} from './core/render-core';
// П14.5: розмір світу для замикання скан-зони по X (куля; як RADAR_RANGE у geo.ts).
import { WORLD_W } from './core/geo';
import { grenadeZone } from './core/combat';
import {
  ALIEN_STAND,
  ALIEN_STEP,
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
import unitAtlasUrl from '../assets/units-atlas.png';
import terrainTilesUrl from '../assets/terrain-tiles.png';
import geoMapUrl from '../assets/geo-map.webp';
import radarTowerUrl from '../assets/radar-tower.png';

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

// --- П14.2/П14.3 (ADR-0072): атлас спрайтів юнітів бою — згенеровані кадри ---
// Джерело — assets/units-atlas.png (480×192): сітка 5×2 кадрів 96×96, порядок
// колонок idle → walk1 → walk2 → fire → death; ряд 0 — оперативник, ряд 1 —
// демон Розриву. П14.3: walk2 — окремий кадр (фідбек П14.2, константи кадрів
// 0/1/2/3/4); план — джерело правди чисел (style-references.md, Фаза 14).
// Відображення 44×44 у BCELL 48, nearest-neighbor (ADR-0068): 92% заповнення
// клітинки, тач-цілі 48 ≥ 44px.
export const ATLAS_FRAME = 96; // кадр атласу, px
export const ATLAS_COLS = 5; // idle, walk1, walk2, fire, death
export const ATLAS_UNIT = 44; // сторона відображення у клітинці BCELL 48

export type UnitPose = 'idle' | 'walk' | 'fire' | 'death';

// Колонка атласа за позою: walk1 — кол. 1; walk2 (крок іншою ногою) — кол. 2
// (П14.3: окремий кадр, дубль walk1 у П14.2 замінено).
export const ATLAS_POSE_COL: Readonly<Record<UnitPose, number>> = {
  idle: 0,
  walk: 1,
  fire: 3,
  death: 4,
};
export const ATLAS_WALK2_COL = 2;

// Фідбек власника 2026-10-22 (юніт-атласи Gemini, PR #241): трасер бою має
// стартувати з ДУЛА стрільця, а не з центру клітинки — у демона Розриву
// фазовий різак зі спалахом лежить поза центром кадру fire (дуло ліворуч,
// нижче осі), і «куля з середини тіла» виглядала відірваною. Якір —
// координати дулового спалаху в 44-просторі кадру fire у НАТИВНІЙ
// орієнтації (солдат вправо, демон вліво); дзеркалення (flip) мапить
// колонку col → ATLAS_UNIT-1-col. Солдат — центр кадру (спалах прикриває
// центр, нульовий офсет — вигляд без змін). Підказку передає ЛИШЕ бойовище
// (battle.ts); трасер перехоплення на геосцені — від центру, як раніше.
export const MUZZLE_ANCHOR: Readonly<Record<'player' | 'alien', { x: number; y: number }>> = {
  player: { x: 22, y: 22 }, // дуловий спалах АР-14 «Гарт» — по центру кадру
  alien: { x: 5, y: 24 }, // дуловий спалах фазового різака: лівий край, +2 від осі
};

// Юніт бою з погляду шару відображення: поза вогонь/смерть — надбудова над
// UnitSprite ядра (ядровий frame 0/1 лишається семантикою стій/крок, ADR-0031);
// step — фаза двокадрової ходьби атласа (walk1/walk2, П14.3); flip — дзеркало
// за напрямком (детерміновано у battle.ts, без RNG; ядро не зачіпається).
export interface UnitSpriteView extends UnitSprite {
  pose?: 'fire' | 'death';
  step?: 1 | 2;
  flip?: boolean;
  maxHp: number; // П14.4: показник життя — частка hp/maxHp у смузі HP
}

// Поза за станом юніта — чиста функція, детермінована (без RNG, ADR-0003):
// вогонь/смерть мають пріоритет (подієві кадри), двокадрова ходьба (step,
// П14.3) і кадр ходьби ядра — далі, інакше стій.
export function unitPose(u: Pick<UnitSpriteView, 'frame' | 'pose' | 'step'>): UnitPose {
  if (u.pose === 'fire' || u.pose === 'death') return u.pose;
  if (u.step === 1 || u.step === 2) return 'walk';
  return (u.frame ?? 0) === 1 ? 'walk' : 'idle';
}

// Ліниве завантаження атласа (ADR-0072 п.3): фабрика-завантажувач інжектиться
// (браузер: Image + onload; тести: мок, синхронний або «ніколи») — render.ts
// не знає DOM-глобалів (той самий патерн, що initPixelSprites). Невдача
// завантаження — тихий перехід на матриці ADR-0031 (onload не кликнувся —
// прапорець лишається зайнятим матрицями, тести від ассета не залежать).
export type LoadUnitAtlas = (url: string, onLoad: (img: CanvasImageSource) => void) => void;
let unitAtlasImg: CanvasImageSource | null = null;

// Реєстрація завантажувача (і скидання стану — як initPixelSprites: кожен
// тест ставить свій мок перед першим рендером).
export function initUnitAtlas(load: LoadUnitAtlas): void {
  unitAtlasImg = null;
  load(unitAtlasUrl, (img) => {
    unitAtlasImg = img;
  });
}

// Прапорець завантаженості (готовність атласа; фолбек — !isUnitAtlasReady).
export function isUnitAtlasReady(): boolean {
  return unitAtlasImg !== null;
}

// --- П14.3 (ADR-0072): тайлсет терену бою — згенеровані тайли ---
// Джерело — assets/terrain-tiles.png (384×48): 8 тайлів 48×48 — кол. 0–3
// варіанти підлоги (темні й ненасичені — дизайн-вимога контрасту: неон
// юнітів — найяскравіший акцент клітинки), кол. 4 — стіна з неоновим
// ціановим кантом, кол. 5–7 — декори (уламки, труба, вентиляція зі
// світінням). Малюються під клітинку 48 (= BCELL, 1:1; П14.3 ADR-0068).
export const TERRAIN_TILE = 48; // сторона тайла, px
export const TERRAIN_COLS = 8; // 0–3 підлоги, 4 стіна, 5–7 декори
export const TERRAIN_WALL_COL = 4;
export const TERRAIN_DECOR_COL = { уламки: 5, труба: 6, вентиляція: 7 } as const;

// Розклад декорів — чиста функція координат (детермінований хеш, без RNG —
// ADR-0003/0072): рідкі декори на відкритих клітинках, мозаїка стабільна
// між кадрами. ~3/37 відкритих клітинок (~8%).
export function decorCol(x: number, y: number): number | null {
  const h = cellHash(x, y) % 37;
  if (h === 0) return TERRAIN_DECOR_COL['уламки'];
  if (h === 1) return TERRAIN_DECOR_COL['труба'];
  if (h === 2) return TERRAIN_DECOR_COL['вентиляція'];
  return null;
}

// Приглушення тайлів у тумані (рельєф видно, вміст не розкривається —
// ADR-0006): напівпрозоре перекриття поверх тайла, патерн фолбеку.
const TILE_FOG = 'rgba(5,8,15,0.55)';

// Ліниве завантаження тайлсету — той самий патерн, що initUnitAtlas
// (ADR-0072 п.3): фабрика інжектиться, невдача — тихий фолбек на два тони.
export type LoadTerrainTiles = (url: string, onLoad: (img: CanvasImageSource) => void) => void;
let terrainTilesImg: CanvasImageSource | null = null;

export function initTerrainAtlas(load: LoadTerrainTiles): void {
  terrainTilesImg = null;
  load(terrainTilesUrl, (img) => {
    terrainTilesImg = img;
  });
}

// Прапорець готовності тайлсету (фолбек терену — !isTerrainAtlasReady).
export function isTerrainAtlasReady(): boolean {
  return terrainTilesImg !== null;
}

// --- Позафазна лінія «візуальні порівняння» (кандидат А «нічний супутник»,
// Work-сесія 2026-10-21): геосцена — ОДНА цілісна картина світу ---
// Фон — assets/geo-map.webp (1024×576, кроп видимого вікна cover сирця
// власника 1024×768): малюється cover на всю канву геосцени; розклад
// суші GEO_LAYOUT (render-core) ВИВЕДЕНО з цієї ж картини (медіани
// яскравості клітинок 64×64, поріг за фактичним джерелом — скрипт
// scripts/geo-layout.py), тож розклад збігається з картиною. Атлас
// geo-tiles.png і тайл узбережжя більше не використовуються; вогні
// міст намальовані на самій карті (оверлей вимкнено). Спрайт бази —
// вежа-радар assets/radar-tower.png (flood-fill альфа по чорному тлу
// сирця, 96×95 — 2× клітинки). Фолбек без ассетів — розклад двома
// тонами (суша/океан; поведінка не залежить від ассета, тести від
// ассета не залежать, сейви не зачіпаються — ADR-0026).
// Ліниве завантаження — той самий патерн, що initTerrainAtlas (ADR-0072).
export type LoadGeoAsset = (url: string, onLoad: (img: CanvasImageSource) => void) => void;
let geoMapImg: CanvasImageSource | null = null;
let geoTowerImg: CanvasImageSource | null = null;

export function initGeoMap(load: LoadGeoAsset): void {
  geoMapImg = null;
  load(geoMapUrl, (img) => {
    geoMapImg = img;
  });
}

export function initGeoTower(load: LoadGeoAsset): void {
  geoTowerImg = null;
  load(radarTowerUrl, (img) => {
    geoTowerImg = img;
  });
}

// Джерело з вимірюваними сторонами: CanvasImageSource — union без гарантії
// width/height (VideoFrame тощо); браузерний загрузчик дає HTMLImageElement.
type SizedImageSource = CanvasImageSource & { width: number; height: number };

// Розміри завантаженого ассета (звуження union — джерело завжди HTMLImageElement).
function imgSize(img: CanvasImageSource): { w: number; h: number } {
  const sized = img as SizedImageSource;
  return { w: sized.width, h: sized.height };
}

// Прапорці готовності (фолбеки — !ready).
export function isGeoMapReady(): boolean {
  return geoMapImg !== null;
}

export function isGeoTowerReady(): boolean {
  return geoTowerImg !== null;
}

// Кадр з атласа: 96×96 → 44×44 у клітинці, цілі пікселі (Math.round),
// згладжування вимкнене — крайові пікселі без розмиття (ADR-0068).
// П14.3: двокадрова ходьба — step 2 обирає колонку walk2; фліп за напрямком
// (flip) — дзеркало scale(-1,1) навколо центру кадру, детерміновано (без RNG;
// напрямок рахує викликач — battle.ts, ядро і розкладка кадрів без змін).
function drawAtlasUnit(ctx: CanvasRenderingContext2D, u: UnitSpriteView, row: 0 | 1, img: CanvasImageSource): void {
  const pose = unitPose(u);
  const col = pose === 'walk' && u.step === 2 ? ATLAS_WALK2_COL : ATLAS_POSE_COL[pose];
  const x = Math.round(u.cx - ATLAS_UNIT / 2);
  const y = Math.round(u.cy - ATLAS_UNIT / 2);
  ctx.imageSmoothingEnabled = false;
  if (u.flip === true) {
    ctx.save();
    ctx.translate(u.cx, u.cy);
    ctx.scale(-1, 1);
    ctx.translate(-u.cx, -u.cy);
    ctx.drawImage(img, col * ATLAS_FRAME, row * ATLAS_FRAME, ATLAS_FRAME, ATLAS_FRAME, x, y, ATLAS_UNIT, ATLAS_UNIT);
    ctx.restore();
    return;
  }
  ctx.drawImage(img, col * ATLAS_FRAME, row * ATLAS_FRAME, ATLAS_FRAME, ATLAS_FRAME, x, y, ATLAS_UNIT, ATLAS_UNIT);
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

// П14.4 (фідбек прев'ю): показники життя юнітів — смуга HP у верхній частині
// клітинки (заповнення за часткою hp/maxHp; фідбек власника: перенесено
// з низу на верх) і число HP у кутковій зоні клітини (тло клітинки, не
// спрайта — урок П6.12: темний текст у центрі силуета був невидимий на
// атласних спрайтах П14.3). Колір смуги за часткою: зелений → бурштин →
// червоний; число — кольори сторін (ціан «Рубіжу» / світлий пурпур Розриву,
// ADR-0064). Ширина числа — оцінка 6px на символ (без measureText —
// мок-контексти jsdom, урок П6.14).
// П14.8 (ADR-0073): геометрія бейджа експортована — підсвічування ambient-шару
// (src/ui/ambient.ts) малює по тих самих константах (одне місце правди).
export const HP_BAR_W = 48; // ширина смуги — вся клітинка (BCELL 48)
export const HP_BAR_H = 4; // висота смуги, px
export const HP_BAR_Y = -23; // зміщення смуги від центру клітинки (верх клітинки)
const HP_BACKING = 'rgba(5,8,15,0.75)'; // підкладка смуги
const HP_PLATE_BG = 'rgba(5,8,15,0.8)'; // плашка числа HP
const HP_NUM_PLAYER = '#9adfff'; // ціан «Рубіжу» (ADR-0064)
const HP_NUM_ALIEN = '#ff9ecb'; // світлий пурпур Розриву (ADR-0064)

// Колір заповнення смуги HP за часткою (детерміновано, без RNG).
function hpBarColor(hp: number, maxHp: number): string {
  const f = maxHp > 0 ? hp / maxHp : 0;
  return f > 0.5 ? '#7fe2a0' : f > 0.25 ? '#ffcf5c' : '#ff5c7a';
}

function drawHpBadge(ctx: CanvasRenderingContext2D, u: UnitSpriteView): void {
  // смуга HP: темна підкладка на всю клітинку + заповнення за часткою (верх)
  const x = u.cx - HP_BAR_W / 2;
  const y = u.cy + HP_BAR_Y;
  ctx.fillStyle = HP_BACKING;
  ctx.fillRect(x, y, HP_BAR_W, HP_BAR_H);
  const f = Math.max(0, Math.min(1, u.maxHp > 0 ? u.hp / u.maxHp : 0));
  ctx.fillStyle = hpBarColor(u.hp, u.maxHp);
  ctx.fillRect(x, y, u.hp > 0 ? Math.max(2, HP_BAR_W * f) : 0, HP_BAR_H);
  // число HP: плашка у верхньому правому куті клітинки, одразу ПІД смугою
  // (фідбек прев'ю: на одній лінії зі смугою плашка перекривала її заповнення);
  // у межах клітинки (BCELL 48)
  const text = String(u.hp);
  const w = text.length * 6 + 3;
  const px = u.cx + 24 - w - 1;
  ctx.fillStyle = HP_PLATE_BG;
  ctx.fillRect(px, u.cy + HP_BAR_Y + HP_BAR_H + 1, w, 11);
  ctx.fillStyle = u.side === 'player' ? HP_NUM_PLAYER : HP_NUM_ALIEN;
  ctx.font = '10px monospace';
  ctx.textBaseline = 'top';
  ctx.fillText(text, px + 1, u.cy + HP_BAR_Y + HP_BAR_H + 3);
}

export function drawSoldierSprite(ctx: CanvasRenderingContext2D, u: UnitSpriteView): void {
  // П14.2 (ADR-0072): атлас готовий — кадр з нього; інакше матриці ADR-0031.
  if (unitAtlasImg !== null) drawAtlasUnit(ctx, u, 0, unitAtlasImg);
  else drawPixelSprite(ctx, (u.frame ?? 0) === 1 ? SOLDIER_STEP : SOLDIER_STAND, u.cx, u.cy, SPRITE_SCALE);
  if (u.overwatch) drawOverwatchMarker(ctx, u);
  drawHpBadge(ctx, u); // П14.4: смуга HP + число у кутковій зоні (читабельність)
  if (u.selected) drawSelectionBrackets(ctx, u.cx, u.cy);
}

export function drawAlienSprite(ctx: CanvasRenderingContext2D, u: UnitSpriteView): void {
  if (unitAtlasImg !== null) drawAtlasUnit(ctx, u, 1, unitAtlasImg);
  else drawPixelSprite(ctx, (u.frame ?? 0) === 1 ? ALIEN_STEP : ALIEN_STAND, u.cx, u.cy, SPRITE_SCALE);
  if (u.overwatch) drawOverwatchMarker(ctx, u);
  drawHpBadge(ctx, u); // П14.4: смуга HP + число у кутковій зоні (читабельність)
  if (u.selected) drawSelectionBrackets(ctx, u.cx, u.cy);
}

// Диспетчер за стороною — єдина точка виклику з renderBattle.
export function drawUnitSprite(ctx: CanvasRenderingContext2D, u: UnitSpriteView): void {
  if (u.side === 'player') drawSoldierSprite(ctx, u);
  else drawAlienSprite(ctx, u);
}

export function drawBaseSprite(ctx: CanvasRenderingContext2D, b: BaseSprite): void {
  // спрайт — трохи вище центру клітинки; підпис «ВУЗОЛ» прибрано (фідбек
  // власника 2026-10-23: текст на геосцені зайвий)
  drawPixelSprite(ctx, BASE_SPRITE, b.cx, b.cy - 6, SPRITE_SCALE);
}

// Позафазна лінія «візуальні порівняння» (кандидат А): позначка бази геосцени —
// вежа-радар з assets/radar-tower.png (фото-спрайт, альфа flood-fill по чорному
// тлу сирця), вписується у клітинку зі збереженням аспекта, згладжування
// увімкнене (фото, не піксель-арт). Фідбек власника 2026-10-23: видимый острів
// у картині — світле узбережжя у ВЕРХНІЙ частині клітинки бази (нічний
// супутник: темна суша мало відрізняється від океану, читається лише світла
// смуга вогнів), низ клітинки читається як вода; якір — ПІДОШВА вежі (низ
// спрайта) на верхньому краї клітинки (feet = cy - size/2), щоб вежа стояла
// на узбережжі острова. Підпис «ВУЗОЛ» прибрано (фідбек власника 2026-10-23).
// Фолбек без ассета — піксельний спрайт ADR-0031 (drawBaseSprite); тести від
// ассета не залежать.
export function drawGeoBaseSprite(ctx: CanvasRenderingContext2D, b: BaseSprite): void {
  if (geoTowerImg === null) {
    drawBaseSprite(ctx, b);
    return;
  }
  const { w: iw, h: ih } = imgSize(geoTowerImg);
  const scale = Math.min(b.size / iw, b.size / ih); // вписати в клітинку
  const dw = Math.round(iw * scale);
  const dh = Math.round(ih * scale);
  const feet = b.cy - Math.round(b.size / 2); // підошва — верхній край клітинки (острів)
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(geoTowerImg, Math.round(b.cx - dw / 2), feet - dh, dw, dh);
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

// Нічний терен: фон → клітинки → м'який край туману → (фолбек) тонка сітка.
// П14.3 (ADR-0072): тайлсет готовий — підлога за хешем (4 варіанти, без RNG),
// стіна — за мапою (blocked), декори — за хешем координат; туман —
// напівпрозоре приглушення поверх тайла (рельєф видно, ADR-0006), м'який
// край — як і раніше. Фолбек без ассета — чинні два тони terrainShade
// (обов'язковий, тести від ассета не залежать). Чиста функція без RNG і
// DOM-стану; викликається кожен кадр після clearRect (урок П6.6) — кадр
// еквівалентний малюванню з нуля. w/h — розмір buffer'а канви в пікселях,
// cell — BCELL.
export function drawNightTerrain(ctx: CanvasRenderingContext2D, w: number, h: number, cells: readonly TerrainCell[], cell: number): void {
  // фон на весь buffer (при трясці translate оголює край — колір збігається з CSS-тлом)
  ctx.fillStyle = NIGHT_BG;
  ctx.fillRect(0, 0, w, h);
  // мапа видимості для м'якого краю туману (сусідство за 4 напрямками)
  const vis = visibleKeys(cells);
  if (terrainTilesImg !== null) {
    // П14.3: тайли — nearest-neighbor, підлога/стіна цілодобово під клітинку
    ctx.imageSmoothingEnabled = false;
    for (const c of cells) {
      const col = c.blocked ? TERRAIN_WALL_COL : cellHash(c.x, c.y) % (TERRAIN_COLS - TERRAIN_WALL_COL);
      ctx.drawImage(terrainTilesImg, col * TERRAIN_TILE, 0, TERRAIN_TILE, TERRAIN_TILE, c.x * cell, c.y * cell, cell, cell);
    }
    // декори поверх підлоги — рідкий детермінований розклад (без RNG)
    for (const c of cells) {
      if (c.blocked) continue;
      const dcol = decorCol(c.x, c.y);
      if (dcol === null) continue;
      ctx.drawImage(terrainTilesImg, dcol * TERRAIN_TILE, 0, TERRAIN_TILE, TERRAIN_TILE, c.x * cell, c.y * cell, cell, cell);
    }
    // туман: приглушення клітинок поза зоною видимості (вміст не розкривається)
    ctx.fillStyle = TILE_FOG;
    for (const c of cells) {
      if (!c.visible) ctx.fillRect(c.x * cell, c.y * cell, cell, cell);
    }
  } else {
    // фолбек: два тони (відкритий / завалений) × туман/видимо, відтінок — хеш
    for (const c of cells) {
      ctx.fillStyle = terrainShade(c.x, c.y, c.blocked, c.visible);
      ctx.fillRect(c.x * cell, c.y * cell, cell - 1, cell - 1);
    }
    // тонка сітка: 1px у проміжках між клітинками (стовпці і рядки)
    ctx.fillStyle = GRID_COLOR;
    const cols = Math.floor(w / cell);
    const rows = Math.floor(h / cell);
    for (let i = 1; i < cols; i++) ctx.fillRect(i * cell - 1, 0, 1, h);
    for (let j = 1; j < rows; j++) ctx.fillRect(0, j * cell - 1, w, 1);
  }
  // м'який край туману: напівпрозоре перекриття на клітинках туману біля видимих
  ctx.fillStyle = FOG_EDGE;
  for (const c of cells) {
    if (c.visible) continue;
    if (hasVisibleNeighbor(vis, c.x, c.y)) ctx.fillRect(c.x * cell, c.y * cell, cell - 1, cell - 1);
  }
}

// --- Позафазна лінія «візуальні порівняння» (кандидат А «нічний супутник»):
// терен геосцени — ОДНА цілісна картина світу ---
// Фон — geo-map.webp cover на всю канву (ассет — кроп видимого вікна cover
// сирця власника, аспект 16:9 = канва 768×432 — точне вписування без швів;
// згладжування увімкнене — фото, не піксель-арт). Розклад суші GEO_LAYOUT
// виведено з цієї ж картини (render-core; константа — не залежить ні від
// сіда партії, ні в рантаймі від ассета). Фолбек !loaded — ТОЙ САМИЙ
// розклад двома тонами: суша GEO_CELL_B, океан GEO_CELL_A (мапа читається
// і без ассета; поведінка не залежає від ассета, тести від ассета не залежать).
// Розклад і палітра — чиста логіка src/core/render-core.ts; тут — лише
// Canvas-виклики. Кадр еквівалентний малюванню з нуля (патерн renderGeo,
// урок П6.6). Чиста функція без DOM-стану; викликається з src/ui/panels.ts.
export function drawGeoTerrain(ctx: CanvasRenderingContext2D, w: number, h: number, cell: number): void {
  // фон на весь buffer — краї канви не блимають (і підкладка під cover)
  ctx.fillStyle = NIGHT_BG;
  ctx.fillRect(0, 0, w, h);
  // розклад суші — фіксована константа, виведена з картини (одна мапа для всіх партій)
  const layout = GEO_LAND_ROWS;
  const cols = Math.ceil(w / cell);
  const rows = Math.ceil(h / cell);
  if (geoMapImg !== null) {
    // cover: масштаб по більшій стороні, центр — у центрі канви (ассет
    // 16:9 лягає точно; формула коректна для будь-якого аспекта джерела)
    const { w: iw, h: ih } = imgSize(geoMapImg);
    const scale = Math.max(w / iw, h / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(geoMapImg, Math.round((w - dw) / 2), Math.round((h - dh) / 2), Math.round(dw), Math.round(dh));
  } else {
    // фолбек: ТОЙ САМИЙ розклад блобів двома тонами — суша GEO_CELL_B,
    // океан GEO_CELL_A (мапа читається і без ассета; behavior не залежить від нього)
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        ctx.fillStyle = geoIsLand(layout, x, y) ? GEO_CELL_B : GEO_CELL_A;
        ctx.fillRect(x * cell, y * cell, cell, cell);
      }
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
// П14.4 (ADR-0064): подієві ефекти 2.0 — вибух гранати і числа пошкоджень.
// Зона вибуху — дзеркало прев'ю гранати у battle.ts (пунктирні бурштинові
// рамки); частинки — бурштин/помаранчевий спалах; числа: пошкодження —
// бурштин, зцілення — зелений (колір крапок шляху, П6.14).
const BOOM_ZONE = 'rgba(255,159,64,0.8)';
const BOOM_SPARK_ALT = '#ff7b2e';
const DMG_NUM = '#ffb347';
const HEAL_NUM = '#7fe2a0';
const DNUM_RISE = 16; // підйом числа за тривалість анімації, px

// Підказка якоря дула для трасера бою (фідбек власника 2026-10-22): сторона
// стрільця і ЧИ ФЛІПНУТИЙ кадр (фактичний напрямок погляду цього кадру —
// його знає лише викликаючий шар бою, battle.ts). Суто відображення: без
// підказки трасер малюється від центру клітинки, як раніше (геосцена).
export interface MuzzleHint {
  side: 'player' | 'alien';
  flip: boolean;
}

// Один кадр анімаційного шару (малюється поверх статичного стану).
// move — силует у проміжній позиції; tracer — куля летить від стрільця до цілі,
// при влучанні друга фаза — спалах-кільце; death — згасання силуета; owflash —
// пульсуюче кільце дозору; gpulse — пульс радара геосцени; boom (П14.4) —
// вибух гранати: зона «епіцентр + хрест», спалах-кільце і розліт частинок;
// dnum (П14.4) — плаваюче число пошкодження/зцілення над ціллю; gscan (П14.5)
// — скан-радар 2.0: сектор-розгортка + кільця, що гаснуть; gtrail (П14.5) —
// хвіст перехоплення, що згасає. Усі
// координати — у межах клітинок (урок П6.6); cw/ch — розміри buffer'а канви
// (клімп частинок і тексту у межі; за замовчуванням — без обмеження).
export function drawAnimFrame(
  ctx: CanvasRenderingContext2D,
  a: Anim,
  now: number,
  cell: number,
  r: number,
  cw = Number.POSITIVE_INFINITY,
  ch = Number.POSITIVE_INFINITY,
  muzzle?: MuzzleHint
): void {
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
  // П14.5 (ADR-0072/0064): скан-радар 2.0 — розвиток пульсу П6.9. У зоні
  // виявлення (замикання по X — світ циліндричний): сектор-розгортка робить
  // повний оберт за тривалість і гасне; два кільця розходяться від бази до
  // краю зони і гаснуть. Свічення скидається; невиявлені НЛО не підсвічуються
  // (туман — ADR-0006/0032). Копії зони за межами канви з'являються з краю
  // (куля по X): малюємо зсунуті копії, що перетинають канву (cw — ширина).
  if (a.kind === 'gscan') {
    const fade = 1 - t;
    const offsets = [0, -WORLD_W * cell, WORLD_W * cell].filter(
      (o) => o === 0 || (cw !== Number.POSITIVE_INFINITY && a.cx + o - a.maxR < cw && a.cx + o + a.maxR > 0)
    );
    for (const o of offsets) {
      const cx = a.cx + o;
      // кільце, що розходиться (спадкоємець пульсу П6.9)
      ctx.globalAlpha = 0.6 * fade;
      ctx.strokeStyle = RADAR_PULSE;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, a.cy, 2 + (a.maxR - 2) * t, 0, Math.PI * 2);
      ctx.stroke();
      // друге кільце — ближче до бази, слабше (глибина розгортки)
      ctx.globalAlpha = 0.35 * fade;
      ctx.beginPath();
      ctx.arc(cx, a.cy, 2 + (a.maxR - 2) * t * 0.55, 0, Math.PI * 2);
      ctx.stroke();
      // сектор-розгортка: клин ~30°, що обертається на повний оберт за тривалість
      const ang = -Math.PI / 2 + t * Math.PI * 2;
      ctx.globalAlpha = 0.12 * fade;
      ctx.fillStyle = RADAR_PULSE;
      ctx.beginPath();
      ctx.moveTo(cx, a.cy);
      ctx.arc(cx, a.cy, a.maxR, ang - Math.PI / 6, ang);
      ctx.closePath();
      ctx.fill();
      // передній край розгортки — неоновий промінь (циан «Рубіжу», ADR-0064)
      ctx.globalAlpha = 0.5 * fade;
      ctx.beginPath();
      ctx.moveTo(cx, a.cy);
      ctx.lineTo(cx + Math.cos(ang) * a.maxR, a.cy + Math.sin(ang) * a.maxR);
      ctx.stroke();
    }
    ctx.lineWidth = 1;
    ctx.globalAlpha = 1;
    return;
  }
  // П14.5: хвіст траєкторії перехоплення — лінія останніх позицій винищувача
  // (клітинки → px), згасає за прогресом; ціан «Рубіжу» з неоновим свіченням
  // (свічення скидається); точки клімпляться у межі канви. Лише ≥ 2 точки.
  if (a.kind === 'gtrail') {
    if (a.points.length < 2) return;
    ctx.globalAlpha = 1 - t;
    ctx.strokeStyle = TRACER_PLAYER;
    ctx.lineWidth = 2;
    ctx.shadowColor = TRACER_PLAYER; // П6.13: неонове свічення хвоста
    ctx.shadowBlur = TRACER_GLOW;
    ctx.beginPath();
    for (let i = 0; i < a.points.length; i++) {
      const p = a.points[i]!;
      const px = Math.min(Math.max(p.x * cell + cell / 2, 0), cw - 1);
      const py = Math.min(Math.max(p.y * cell + cell / 2, 0), ch - 1);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 1;
    return;
  }
  // П14.4 (ADR-0072/0064): вибух гранати — зона «епіцентр + хрест»
  // (дзеркало прев'ю гранати у battle.ts), спалах-кільце з епіцентру і
  // розліт детермінованих частинок (≤ 12, без RNG — ADR-0003) з клімпом
  // у межі канви.
  if (a.kind === 'boom') {
    const cx = a.at.x * cell + cell / 2;
    const cy = a.at.y * cell + cell / 2;
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = BOOM_ZONE;
    for (const c of grenadeZone(a.at)) ctx.strokeRect(c.x * cell + 2, c.y * cell + 2, cell - 5, cell - 5);
    ctx.setLineDash([]);
    ctx.globalAlpha = 1 - t;
    ctx.strokeStyle = IMPACT;
    ctx.lineWidth = 3;
    ctx.shadowColor = IMPACT; // П6.13: свічення спалаху вибуху
    ctx.shadowBlur = IMPACT_GLOW;
    ctx.beginPath();
    ctx.arc(cx, cy, 4 + 20 * t, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 1;
    for (let i = 0; i < BOOM_PARTICLES; i++) {
      const o = boomParticleOffset(a.at, i, t);
      const px = Math.min(Math.max(cx + o.dx * cell, 0), cw - 2);
      const py = Math.min(Math.max(cy + o.dy * cell, 0), ch - 2);
      ctx.fillStyle = i % 2 === 0 ? IMPACT : BOOM_SPARK_ALT;
      ctx.fillRect(Math.round(px), Math.round(py), 2, 2);
    }
    ctx.globalAlpha = 1;
    return;
  }
  // П14.4: плаваюче число над ціллю — підйом (y спадає) і згасання (alpha) за
  // прогресом кадру; ширина — оцінка N×6px без measureText (урок П6.14 —
  // мок-контексти jsdom його не реалізують), клімп правого краю як
  // drawChanceLabel; текст у межах канви.
  if (a.kind === 'dnum') {
    const text = (a.heal ? '+' : '-') + a.amount;
    const w = text.length * 6 + 4;
    const h = 13;
    let x = a.at.x * cell + (cell - w) / 2;
    if (x + w > cw) x = cw - w - 1;
    const base = a.at.y * cell >= h + 1 ? a.at.y * cell - (h + 1) : (a.at.y + 1) * cell + 1;
    const y = Math.round(base - DNUM_RISE * t); // підйом над ціллю
    ctx.globalAlpha = 1 - t; // згасання до кінця кадру
    ctx.fillStyle = CHANCE_LABEL_BG;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = a.heal ? HEAL_NUM : DMG_NUM;
    ctx.font = '11px monospace';
    ctx.textBaseline = 'top';
    ctx.fillText(text, x + 2, y + 2);
    ctx.globalAlpha = 1;
    return;
  }
  if (a.kind === 'move') {
    const p = moveAnimPos(a, t, cell);
    // П6.12 (ADR-0031): кадри ходьби — з прогресу шляху, детерміновано
    // (2 кадри на клітинку, без RNG); у статиці малюється кадр «стій».
    const frame = Math.floor(t * Math.max(1, a.path.length - 1) * 2) % 2;
    // П14.3 (фідбек П14.2): фліп за напрямком руху — дзеркало кодом у шарі
    // відображення (детерміновано, без RNG; ядро і розкладка кадрів без змін);
    // нативні напрямки кадрів: оперативник — вправо, демон Розриву — вліво.
    const first = a.path[0] ?? { x: 0, y: 0 };
    const last = a.path[a.path.length - 1] ?? first;
    const dir = Math.sign(last.x - first.x);
    const native = a.side === 'player' ? 1 : -1;
    drawUnitSprite(ctx, {
      side: a.side,
      cx: p.cx,
      cy: p.cy,
      r,
      hp: a.hp,
      maxHp: a.hpMax, // П14.4: смуга HP під час руху
      selected: a.selected,
      overwatch: a.overwatch,
      frame,
      step: frame === 1 ? 2 : 1, // П14.3: двокадрова ходьба — walk1/walk2 (фолбек — frame)
      flip: dir !== 0 && dir !== native,
    });
    return;
  }
  if (a.kind === 'tracer') {
    let x0 = a.from.x * cell + cell / 2;
    let y0 = a.from.y * cell + cell / 2;
    const x1 = a.to.x * cell + cell / 2;
    const y1 = a.to.y * cell + cell / 2;
    // Фідбек власника 2026-10-22: куля стартує з дулового спалаху кадру fire
    // (якір — MUZZLE_ANCHOR, геометрия та ж, що drawAtlasUnit: round(центр-22))
    // — лише з підказкою бойовища; без неї (геосцена) — від центру клітинки.
    if (muzzle !== undefined) {
      const m = MUZZLE_ANCHOR[muzzle.side];
      const mx = muzzle.flip ? ATLAS_UNIT - 1 - m.x : m.x;
      x0 = Math.round(x0 - ATLAS_UNIT / 2) + mx;
      y0 = Math.round(y0 - ATLAS_UNIT / 2) + m.y;
    }
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
      maxHp: a.hpMax, // П14.4: порожня смуга HP загиблого
      selected: false,
      overwatch: false,
      pose: 'death', // П14.2 (ADR-0072): кадр смерті з атласа; фолбек — матриця
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
