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
  ENEMY_LOOK,
  RING_DY,
  RING_RX,
  RING_RY,
  BREATH_SCALE,
  DISSOLVE_STRIP,
  HP_BAR_H,
  HP_BAR_W,
  HP_BAR_Y,
  SPARKS,
  UNIT_DRAW,
  dissolveKept,
  recoilPx,
  sparkOffset,
  tracerShare,
  unitFrameOrigin,
  BOOM_PARTICLES,
  fighterLook,
  FOG_EDGE,
  fogBorderSegments,
  fogHatchStep,
  PATH_LABEL_CHAR_W,
  pathLabelBox,
  pathLabelScale,
  zoneOutlineSegments,
  GEO_CELL_A,
  GEO_CELL_B,
  GEO_GRID_COLOR,
  GEO_ICON_CELL,
  GEO_ICON_ORDER,
  GEO_ICON_PX,
  GRID_COLOR,
  NIGHT_BG,
  animT,
  boomParticleOffset,
  cellHash,
  geoIsLand,
  GEO_LAND_ROWS,
  hasVisibleNeighbor,
  moveAnimPos,
  terrainShade,
  visibleKeys,
  wallQuads,
  type Anim,
  type GeoIcon,
  type TerrainCell,
} from './core/render-core';
// П14.5: розмір світу для замикання скан-зони по X (куля; як RADAR_RANGE у geo.ts).
import { WORLD_W } from './core/geo';
import { grenadeZone } from './core/combat';
import type { EnemyKind } from './core/enemies';
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
import metroBgUrl from '../assets/metro-bg.webp';
import metroTilesUrl from '../assets/metro-tiles.png';
import geoMapUrl from '../assets/geo-map.webp';
import radarTowerUrl from '../assets/radar-tower.png';
import geoIconsUrl from '../assets/geo-icons.png';

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
// Джерело — assets/units-atlas.png: з п17.5 (ADR-0152) 480 × 480 — сітка 5 × 5 кадрів 96 × 96
// (до п17.5 — 480 × 192, 5 × 2), порядок колонок idle → walk1 → walk2 → fire → death; ряди —
// оперативник, демон, гончак, голем, око (ATLAS_ROW). П14.3: walk2 — окремий кадр (фідбек П14.2, константи кадрів
// 0/1/2/3/4); план — джерело правди чисел (style-references.md, Фаза 14).
// Т.133 (ADR-0122): кадри «мальовані» (аркуші Gemini, плавна альфа), геометрія та сама;
// стиль, промпти й конвертер — style-references.md, розділ «Т.133».
// Т.132 (ADR-0121): кадр 96 × 96 малюється 68 × 68 зі згладжуванням (масштаб не цілий),
// ноги — на UNIT_FEET_DY нижче центру клітинки, фігура росте вгору в межах клітинки
// (було 44 × 44 nearest-neighbor, ADR-0068); геометрія — UNIT_DRAW і unitFrameOrigin у ядрі.
export const ATLAS_FRAME = 96; // кадр атласу, px
export const ATLAS_COLS = 5; // idle, walk1, walk2, fire, death
export const ATLAS_UNIT = UNIT_DRAW; // сторона кадру на полі (Т.132: 68)

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

// Фідбек власника 2026-10-22 (юніт-атласи Gemini, PR #241): трасер бою стартує з ДУЛА
// стрільця, а не з центру клітинки. Т.132 (ADR-0121): якір — координати дулового спалаху
// в просторі кадру 96 × 96 fire у НАТИВНІЙ орієнтації (солдат вправо, демон вліво),
// виміряні по атласу скриптом конвертації (Т.133: `scripts/assets/units-t133-report.json`, поле muzzle);
// дзеркалення — x → 96 − x. Підказку
// передає ЛИШЕ бойовище (battle.ts); трасер перехоплення на геосцені — від центру.
// п17.5 (ADR-0152): атлас п'яти рядів — якір дула за типом ворога (`alien` — демон),
// поле muzzle звіту `scripts/assets/units-t194-report.json`; у гончака — край риски удару
// (трасера немає, якір лишається для повноти).
export const MUZZLE_ANCHOR: Readonly<Record<'player' | 'alien' | Exclude<EnemyKind, 'demon'>, { x: number; y: number }>> = {
  player: { x: 78, y: 45 }, // дуловий спалах АР-14 «Гарт» — правий край кадру fire (Т.134: нові аркуші)
  alien: { x: 4, y: 49 }, // дуло гармати демона — лівий край кадру fire (п17.5: новий аркуш)
  hound: { x: 14, y: 56 }, // край риски кігтів
  golem: { x: 7, y: 46 }, // дуло гармати-руки
  eye: { x: 26, y: 64 }, // кінець променя зі зіниці
};

// п17.5: ряд атласа за типом ворога (ряд 0 — оперативник); без типу — демон.
export const ATLAS_ROW: Readonly<Record<EnemyKind, number>> = { demon: 1, hound: 2, golem: 3, eye: 4 };

function muzzleKey(side: 'player' | 'alien', kind?: EnemyKind): keyof typeof MUZZLE_ANCHOR {
  return side === 'player' || kind === undefined || kind === 'demon' ? side : kind;
}

// Точка дула на полі для центру клітинки стрільця (cx, cy); recoil — віддача, px (назад);
// kind — тип стрільця-ворога (п17.5; без нього — демон).
export function muzzlePoint(
  side: 'player' | 'alien',
  flip: boolean,
  cx: number,
  cy: number,
  recoil = 0,
  kind?: EnemyKind
): { x: number; y: number } {
  const m = MUZZLE_ANCHOR[muzzleKey(side, kind)];
  const o = unitFrameOrigin(cx, cy);
  const back = recoil * facingSign(side, flip);
  const mx = flip ? ATLAS_FRAME - m.x : m.x;
  return { x: o.x + Math.round((mx * UNIT_DRAW) / ATLAS_FRAME) - back, y: o.y + Math.round((m.y * UNIT_DRAW) / ATLAS_FRAME) };
}

// Напрям погляду: +1 — праворуч; нативи — солдат праворуч, демон ліворуч.
function facingSign(side: 'player' | 'alien', flip: boolean): 1 | -1 {
  const native = side === 'player' ? 1 : -1;
  return (flip ? -native : native) as 1 | -1;
}

// Юніт бою з погляду шару відображення: поза вогонь/смерть — надбудова над
// UnitSprite ядра (ядровий frame 0/1 лишається семантикою стій/крок, ADR-0031);
// step — фаза двокадрової ходьби атласа (walk1/walk2, П14.3); flip — дзеркало
// за напрямком (детерміновано у battle.ts, без RNG; ядро не зачіпається).
export interface UnitSpriteView extends UnitSprite {
  pose?: 'fire' | 'death';
  step?: 1 | 2;
  flip?: boolean;
  maxHp: number; // П14.4: показник життя — частка hp/maxHp у смузі HP
  recoil?: number; // Т.132: віддача пострілу, px — фігура відходить назад від погляду
  breath?: number; // Т.132: «дихання» у спокої, 0..1 (ambient-шар; стискання по висоті від ніг)
  kind?: EnemyKind; // п17.5 (ADR-0152): тип ворога — ряд атласа; без поля — демон
  turret?: boolean; // п18.5 (ADR-0157): турель бази — власний силует кодом замість кадру атласа
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

// --- Позафазна лінія «візуальні порівняння» (кандидат «Мегаполіс», крок 2,
// ADR-0072): терен бою — ЦІЛА картина підлоги + згенеровані об'єкти ---
// Пер-тайлові підлоги відкладені рішенням власника (крок 1 — відхилено
// 2026-10-22): фон бою — ОДНА картина assets/metro-bg.webp (1024×1024,
// нічна вулиця згори) cover-кропом на весь buffer канви 960×960; стіна —
// спрайт з assets/metro-tiles.png (192×48, тайли 48×48: кол. 0 стіна з
// ціановим кантом, 1 пляма світла, 2 решітка в підлозі — пласкі деталі
// Т.44 замість лампи й голограми, схожих на юнітів; 3 уламки) на blocked-клітинках
// (з Т.135, ADR-0123 — «мальовані» з аркуша Gemini: стіна ¾ згори, лампа, решітка, авто;
// з Т.146, ADR-0127 — сусідні стіни стикуються чвертями того самого тайла);
// декори — за хешем координат (~8% відкритих, чинний контракт П14.3
// cellHash % 37); туман — чинне приглушення rgba(5,8,15,0.55) поверх
// фону (рельєф видно, вміст не розкривається — ADR-0006), м'який край —
// як і раніше. Фолбек без ассетів — чинні два тони terrainShade
// (обов'язковий, тести від ассета не залежать, сейви не зачіпаються —
// ADR-0026). Подієві ефекти/тряска/HP-бейджі П14.4 — без змін.
export const METRO_TILE = 48; // сторона тайла, px (= BCELL, 1:1)
export const METRO_WALL_COL = 0; // стіна блоку з ціановим кантом
export const METRO_DECOR_COL = { світло: 1, решітка: 2, уламки: 3 } as const;

// Розклад декорів — чиста функція координат (детермінований хеш, без RNG —
// ADR-0003/0072; чинний контракт П14.3): рідкі декори на відкритих
// клітинках, мозаїка стабільна між кадрами. ~3/37 відкритих (~8%).
export function decorCol(x: number, y: number): number | null {
  const h = cellHash(x, y) % 37;
  if (h === 0) return METRO_DECOR_COL['світло'];
  if (h === 1) return METRO_DECOR_COL['решітка'];
  if (h === 2) return METRO_DECOR_COL['уламки'];
  return null;
}

// Приглушення фону у тумані (рельєф видно, вміст не розкривається —
// ADR-0006): напівпрозоре перекриття поверх картини, патерн фолбеку.
const TILE_FOG = 'rgba(5,8,15,0.55)';
// Т.44 (рішення власника 15.11.2026): туман відрізняється від тіні підлоги —
// клітинки туману знебарвлено (накладання 'saturation' сірим) і злегка
// заштриховано діагоналями, межу зору обведено лінією.
const FOG_GREY = '#808080';
const FOG_HATCH = 'rgba(150,170,190,0.16)';
const FOG_BORDER = 'rgba(125,215,255,0.6)';
const FOG_BORDER_W = 2;

// Ліниве завантаження ассетів «Мегаполісу» — той самий патерн, що
// initUnitAtlas (ADR-0072 п.3): фабрика інжектиться, невдача — тихий
// фолбек на два тони. Фон і тайли — окремі джерела з окремими
// прапорцями; нова гілка рендера вимагає ОБИДВА (частина картин без
// стін читалась б гравцем як помилка).
export type LoadMetroAsset = (url: string, onLoad: (img: CanvasImageSource) => void) => void;
let metroBgImg: CanvasImageSource | null = null;
let metroTilesImg: CanvasImageSource | null = null;

export function initMetroMap(load: LoadMetroAsset): void {
  metroBgImg = null;
  load(metroBgUrl, (img) => {
    metroBgImg = img;
  });
}

export function initMetroTiles(load: LoadMetroAsset): void {
  metroTilesImg = null;
  load(metroTilesUrl, (img) => {
    metroTilesImg = img;
  });
}

// Прапорець готовності терену «Мегаполіс» (фолбек — !isMetroTerrainReady).
export function isMetroTerrainReady(): boolean {
  return metroBgImg !== null && metroTilesImg !== null;
}

// --- Геосцена — ОДНА цілісна картина світу (позафазна лінія «візуальні порівняння», 2026-10-21;
// з п19.5, ADR-0163, — картина «Живі береги») ---
// Фон — assets/geo-map.webp (1120×630, 16:9; аркуш Gemini п19.5 — чотири материки на місцях
// регіонів REGION_OF, конвертер scripts/assets/convert_geo_t208.py): малюється cover на всю
// канву геосцени (1120/768 = 630/432 — точний 16:9, без швів); розклад суші GEO_LAYOUT
// (render-core) ВИВЕДЕНО тим самим конвертером з цієї ж картини (ознака r + g - b, поріг Отсу),
// тож розклад збігається з картиною. Вогні міст намальовані на самій карті (оверлей вимкнено).
// Значок вузла — з аркуша значків (initGeoIcons нижче); без аркуша — вежа-радар
// assets/radar-tower.png (flood-fill альфа по чорному тлу сирця, 96×95 — 2× клітинки), по
// центру клітинки бази. Фолбек без ассетів — розклад двома тонами (суша/океан; поведінка не
// залежить від ассета, тести від ассета не залежать, сейви не зачіпаються — ADR-0026).
// Ліниве завантаження — той самий патерн, що initUnitAtlas (ADR-0072).
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

// п19.5 (ADR-0163): аркуш значків геосцени (assets/geo-icons.png, шість клітинок 96 × 96 —
// зонд-розвідник, зонд-збирач, перехоплювач, вузол, ангар, Брама) — ліниве завантаження, як карта;
// без аркуша — чинні значки кодом (ADR-0072).
let geoIconsImg: CanvasImageSource | null = null;

export function initGeoIcons(load: LoadGeoAsset): void {
  geoIconsImg = null;
  load(geoIconsUrl, (img) => {
    geoIconsImg = img;
  });
}

export function isGeoIconsReady(): boolean {
  return geoIconsImg !== null;
}

// Значок аркуша по центру (cx, cy), сторона side (типово — GEO_ICON_PX); false — аркуша немає.
function drawGeoIcon(ctx: CanvasRenderingContext2D, icon: GeoIcon, cx: number, cy: number, side: number = GEO_ICON_PX[icon]): boolean {
  if (geoIconsImg === null) return false;
  const sx = GEO_ICON_ORDER.indexOf(icon) * GEO_ICON_CELL;
  ctx.imageSmoothingEnabled = true; // мальований значок, масштаб 96 → 34–48 не цілий
  ctx.drawImage(geoIconsImg, sx, 0, GEO_ICON_CELL, GEO_ICON_CELL, Math.round(cx - side / 2), Math.round(cy - side / 2), side, side);
  return true;
}

// Кадр з атласа: 96 × 96 → UNIT_DRAW × UNIT_DRAW (Т.132, ADR-0121), ноги на UNIT_FEET_DY
// нижче центру; згладжування увімкнене — масштаб 68/96 не цілий, без нього пікселі рвуться.
// П14.3: двокадрова ходьба — step 2 обирає колонку walk2; фліп за напрямком
// (flip) — дзеркало scale(-1,1) навколо центру кадру, детерміновано (без RNG;
// напрямок рахує викликач — battle.ts, ядро і розкладка кадрів без змін).
// Т.132: віддача (recoil) — зсув назад від погляду; дихання (breath) — лише в позі «стій».
function drawAtlasUnit(ctx: CanvasRenderingContext2D, u: UnitSpriteView, row: number, img: CanvasImageSource): void {
  const pose = unitPose(u);
  const col = pose === 'walk' && u.step === 2 ? ATLAS_WALK2_COL : ATLAS_POSE_COL[pose];
  const o = unitFrameOrigin(u.cx, u.cy);
  // віддача — назад від РІДНОГО напрямку кадру: зсув рахується до дзеркала, і scale(-1,1)
  // сам перевертає його на екрані (аудит PR #445: зі знаком погляду дзеркальний боєць сіпався вперед)
  const x = o.x - (u.recoil ?? 0) * facingSign(u.side, false);
  const breath = pose === 'idle' ? (u.breath ?? 0) : 0;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  if (u.flip === true) {
    ctx.translate(u.cx, u.cy);
    ctx.scale(-1, 1);
    ctx.translate(-u.cx, -u.cy);
  }
  if (breath > 0) {
    const feet = o.y + UNIT_DRAW; // низ кадру — точка опори
    ctx.translate(0, feet);
    ctx.scale(1, 1 - BREATH_SCALE * breath);
    ctx.translate(0, -feet);
  }
  ctx.drawImage(img, col * ATLAS_FRAME, row * ATLAS_FRAME, ATLAS_FRAME, ATLAS_FRAME, x, o.y, UNIT_DRAW, UNIT_DRAW);
  ctx.restore();
}

function drawOverwatchMarker(ctx: CanvasRenderingContext2D, u: UnitSpriteView): void {
  // Т.132: верхній лівий кут клітинки для обох сторін — правий верхній зайняло число HP,
  // нижній край — смуга HP; більша фігура (68 px) стоїть по центру між ними.
  // п17.5 (рішення власника «Б. Без літери»): плашки літери типу ворога немає — знак у куті й у ворога
  drawPixelSprite(ctx, OW_BOLT, u.cx - OW_OFF, u.cy - OW_OFF, SPRITE_SCALE);
}

// Рамка вибору (доробка П6.12 за валідацією власника): кутові дужки по кутах
// спрайта — не перекривають силует (кільце навколо центру лягало на пікселі);
// кути матриць спрайтів прозорі — дужки лягають на чисте місце; нижні дужки
// перетинають кільце кольору бійця (Т.129) і малюються поверх нього.
// Т.132: фігура 68 px займає клітинку — дужки по кутах клітинки (±23), плече 7 px.
const OW_OFF = 16; // зсув знака дозору від центру — у кут клітинки
function drawSelectionBrackets(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  const s = 23; // кут клітинки BCELL 48 (лінія 2 px — у межах клітинки)
  const arm = 7; // довжина плеча дужки
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

// П14.4 (фідбек прев'ю): показники життя юнітів — смуга HP і число HP у кутковій зоні
// клітини. Т.132 (ADR-0121, рішення власника): смуга — під ногами, ширина кільця
// (HP_BAR_* у ядрі: ambient-шар підсвічує по тих самих константах), число — плашка
// у верхньому правому куті клітинки. Колір смуги за часткою: зелений → бурштин →
// червоний; число — кольори сторін (ціан «Рубіжу» / світлий пурпур Розриву, ADR-0064).
// Ширина числа — оцінка 6px на символ (без measureText — мок-контексти jsdom, урок П6.14).
export { HP_BAR_H, HP_BAR_W, HP_BAR_Y };
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
  // смуга HP під ногами: темна підкладка з 1 px облямівкою + заповнення за часткою
  const x = u.cx - HP_BAR_W / 2;
  const y = u.cy + HP_BAR_Y;
  ctx.fillStyle = HP_BACKING;
  ctx.fillRect(x - 1, y - 1, HP_BAR_W + 2, HP_BAR_H + 2);
  const f = Math.max(0, Math.min(1, u.maxHp > 0 ? u.hp / u.maxHp : 0));
  ctx.fillStyle = hpBarColor(u.hp, u.maxHp);
  ctx.fillRect(x, y, u.hp > 0 ? Math.max(2, HP_BAR_W * f) : 0, HP_BAR_H);
  // число HP: плашка у верхньому правому куті клітинки (у межах BCELL 48); у позі «вогонь»
  // не малюється — вона накрила б ствол і спалах дула солдата (аудит PR #445)
  if (u.pose === 'fire') return;
  const text = String(u.hp);
  const w = text.length * 6 + 3;
  const px = u.cx + 24 - w - 1;
  ctx.fillStyle = HP_PLATE_BG;
  ctx.fillRect(px, u.cy - 23, w, 11);
  ctx.fillStyle = u.side === 'player' ? HP_NUM_PLAYER : HP_NUM_ALIEN;
  ctx.font = '10px monospace';
  ctx.textBaseline = 'top';
  ctx.fillText(text, px + 1, u.cy - 21);
}

// Т.129 (ADR-0118): колір кільця за стороною — свій боєць за id, ворог — пурпур.
// п17.2 (ADR-0149 п. 15): ворог — колір свого типу (без типу — демон, пурпур).
export function unitRing(side: 'player' | 'alien', id: string, kind?: EnemyKind): string {
  return side === 'player' ? fighterLook(id).color : ENEMY_LOOK[kind ?? 'demon'].ring;
}

// п17.5 (ADR-0152; рішення власника «Б. Без літери»): тимчасову літеру типу ворога (п17.2)
// прибрано — тип видно з малюнка ряду атласа і кільця кольору типу.

// Т.129 (ADR-0118): кільце кольору бійця під ногами — еліпс 34 × 12 px біля
// низу клітинки, лінія 2 px зі світінням; малюється до силуету (ноги поверх)
// і до рамки вибору (нижні дужки лягають поверх кільця).
// Загиблому (hp 0) кільця немає.
const RING_GLOW = 6;

// Т.132 (ADR-0121): м'яка тінь під ногами — два напівпрозорі еліпси (без градієнта:
// мок-контексти тестів його не мають); малюється до кільця. Загиблому тіні немає.
const SHADOW = 'rgba(0,0,0,0.32)';
function drawFootShadow(ctx: CanvasRenderingContext2D, u: UnitSpriteView): void {
  if (u.hp <= 0) return;
  ctx.fillStyle = SHADOW;
  for (const [rx, ry] of [
    [RING_RX + 3, RING_RY + 1],
    [RING_RX - 5, RING_RY - 2],
  ] as const) {
    ctx.beginPath();
    ctx.ellipse(u.cx, u.cy + RING_DY, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawFootRing(ctx: CanvasRenderingContext2D, u: UnitSpriteView): void {
  drawFootShadow(ctx, u);
  if (u.ring === undefined || u.hp <= 0) return;
  ctx.strokeStyle = u.ring;
  ctx.lineWidth = 2;
  ctx.shadowColor = u.ring;
  ctx.shadowBlur = RING_GLOW;
  ctx.beginPath();
  ctx.ellipse(u.cx, u.cy + RING_DY, RING_RX, RING_RY, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 1;
}

// п18.5 (ADR-0157; рішення власника «А. Кодом»): турель бази — шестикутна основа, башта і ствол
// у бік погляду (flip) на висоті башти — нижче плашки HP у куті клітинки; трасер пострілу турелі
// стартує з кінчика ствола (turretMuzzle; підказку MuzzleHint.turret дає battle.ts).
const TURRET_HEAD_DY = -4; // центр башти — 4 px вище центру клітинки
const TURRET_BARREL = 21; // кінчик ствола — 21 px від центру по горизонталі
export function turretMuzzle(flip: boolean, cx: number, cy: number, recoil = 0): { x: number; y: number } {
  const dir = flip ? -1 : 1;
  return { x: cx + dir * (TURRET_BARREL - recoil), y: cy + TURRET_HEAD_DY };
}
// Без атласа і без RNG; загибла турель (hp 0) — лише основа, темніша.
const TURRET_BODY = '#5d6470';
const TURRET_EDGE = '#c9ced6';
export function drawTurretSprite(ctx: CanvasRenderingContext2D, u: UnitSpriteView): void {
  const flip = u.flip === true;
  const recoil = u.recoil ?? 0;
  const by = u.cy + 9; // центр основи — над кільцем (нижня дуга кільця лишається видимою)
  ctx.fillStyle = u.hp > 0 ? TURRET_BODY : '#3a3f47';
  ctx.strokeStyle = TURRET_EDGE;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 6 + (i * Math.PI) / 3;
    const x = u.cx + Math.cos(a) * 13;
    const y = by + Math.sin(a) * 7;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  if (u.hp <= 0) {
    ctx.lineWidth = 1;
    return;
  }
  const m = turretMuzzle(flip, u.cx, u.cy, recoil);
  const hx = u.cx - (flip ? -1 : 1) * recoil; // башта відходить з віддачею
  const hy = u.cy + TURRET_HEAD_DY;
  ctx.strokeStyle = TURRET_EDGE;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(hx, hy);
  ctx.lineTo(m.x, m.y);
  ctx.stroke();
  ctx.fillStyle = TURRET_BODY;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(hx, hy, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#00e5ff'; // сенсор башти — ціан «Рубіжу»
  ctx.beginPath();
  ctx.arc(hx + (flip ? -3 : 3), hy - 1, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 1;
}

export function drawSoldierSprite(ctx: CanvasRenderingContext2D, u: UnitSpriteView): void {
  drawFootRing(ctx, u);
  // П14.2 (ADR-0072): атлас готовий — кадр з нього; інакше матриці ADR-0031.
  if (u.turret === true) drawTurretSprite(ctx, u);
  else if (unitAtlasImg !== null) drawAtlasUnit(ctx, u, 0, unitAtlasImg);
  else drawPixelSprite(ctx, (u.frame ?? 0) === 1 ? SOLDIER_STEP : SOLDIER_STAND, u.cx, u.cy, SPRITE_SCALE);
  if (u.overwatch) drawOverwatchMarker(ctx, u);
  drawHpBadge(ctx, u); // П14.4: смуга HP + число у кутковій зоні (читабельність)
  if (u.selected) drawSelectionBrackets(ctx, u.cx, u.cy);
}

export function drawAlienSprite(ctx: CanvasRenderingContext2D, u: UnitSpriteView): void {
  drawFootRing(ctx, u);
  if (unitAtlasImg !== null)
    drawAtlasUnit(ctx, u, ATLAS_ROW[u.kind ?? 'demon'], unitAtlasImg); // п17.5: ряд за типом
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
// увімкнене (фото, не піксель-арт). Фідбек власника 2026-10-23: вежа —
// строго по ЦЕНТРУ клітинки бази (звідки виходить промінь/розгортка
// радара), а під клітинкою в скорегованій картині — острів. Підпис
// «ВУЗОЛ» прибрано (фідбек власника 2026-10-23). З п19.5 (ADR-0163) першим іде
// значок вузла з аркуша, вежа — фолбек без аркуша; без обох — піксельний
// спрайт ADR-0031 (drawBaseSprite); тести від ассета не залежать.
export function drawGeoBaseSprite(ctx: CanvasRenderingContext2D, b: BaseSprite): void {
  if (drawGeoIcon(ctx, 'node', b.cx, b.cy, b.size)) return; // п19.5: значок вузла з аркуша
  if (geoTowerImg === null) {
    drawBaseSprite(ctx, b);
    return;
  }
  const { w: iw, h: ih } = imgSize(geoTowerImg);
  const scale = Math.min(b.size / iw, b.size / ih); // вписати в клітинку
  const dw = Math.round(iw * scale);
  const dh = Math.round(ih * scale);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(geoTowerImg, Math.round(b.cx - dw / 2), Math.round(b.cy - dh / 2), dw, dh);
}

// п18.5 (ADR-0157; рішення власника «А. Кодом»): Брама Розриву на геосцені — пурпуровий портал
// у клітинці біля вузла: два кільця і шість іскор; `open` false (пауза після поразки) — приглушено.
export const GATE_COLOR = '#c45cff';
export function drawGatePortal(ctx: CanvasRenderingContext2D, g: { cx: number; cy: number; size: number; open: boolean }): void {
  const r = g.size * 0.34;
  ctx.globalAlpha = g.open ? 1 : 0.45;
  if (drawGeoIcon(ctx, 'gate', g.cx, g.cy)) {
    ctx.globalAlpha = 1; // п19.5: значок Брами з аркуша, приглушення — те саме
    return;
  }
  ctx.fillStyle = 'rgba(196,92,255,0.18)';
  ctx.beginPath();
  ctx.ellipse(g.cx, g.cy, r, r * 1.15, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = GATE_COLOR;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(g.cx, g.cy, r * 0.55, r * 0.7, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#f0d4ff';
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    ctx.fillRect(Math.round(g.cx + Math.cos(a) * r * 1.3) - 1, Math.round(g.cy + Math.sin(a) * r * 1.45) - 1, 2, 2);
  }
  ctx.globalAlpha = 1;
}

export function drawFighterSprite(ctx: CanvasRenderingContext2D, f: FighterSprite): void {
  if (drawGeoIcon(ctx, 'interceptor', f.cx, f.cy)) return; // п19.5: значок перехоплювача з аркуша
  drawPixelSprite(ctx, FIGHTER_SPRITE, f.cx, f.cy, SPRITE_SCALE);
}

// п19.5: приземлений зонд зі значком — кільце посадки під ним і приглушений значок.
export const UFO_LANDED_RING = 'rgba(255,46,136,0.75)';
export const UFO_LANDED_ALPHA = 0.8;

export function drawUfoSprite(ctx: CanvasRenderingContext2D, u: UfoSprite): void {
  if (geoIconsImg !== null) {
    if (u.landed) {
      ctx.strokeStyle = UFO_LANDED_RING;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(u.cx, u.cy + 10, 16, 6, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.globalAlpha = UFO_LANDED_ALPHA;
    }
    drawGeoIcon(ctx, u.kind === 'розвідник' ? 'scout' : 'harvester', u.cx, u.cy);
    ctx.globalAlpha = 1;
    return;
  }
  ctx.globalAlpha = UFO_SOFT_ALPHA;
  const def = u.landed ? UFO_LANDED_SPRITE : u.kind === 'розвідник' ? UFO_SCOUT_SPRITE : UFO_HARVESTER_SPRITE;
  drawPixelSprite(ctx, def, u.cx, u.cy, SPRITE_SCALE); // П13.5: 12×12 → 24px у клітинці GCELL 44
  ctx.globalAlpha = 1;
}

// п19.5 (ADR-0163): ангар регіону, де стоїть перехоплювач, — значок з аркуша; без аркуша — кодом:
// темне півкругле склепіння з ціановою смугою над воротами.
export const HANGAR_FILL = '#1c2633';
const HANGAR_LIGHT = '#00e5ff';
export function drawHangarSprite(ctx: CanvasRenderingContext2D, h: { cx: number; cy: number }): void {
  if (drawGeoIcon(ctx, 'hangar', h.cx, h.cy)) return;
  ctx.fillStyle = HANGAR_FILL;
  ctx.beginPath();
  ctx.arc(h.cx, h.cy + 8, 15, Math.PI, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(154,223,255,0.55)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = HANGAR_LIGHT;
  ctx.fillRect(Math.round(h.cx - 7), Math.round(h.cy + 1), 14, 2);
}

// --- П6.13: нічна палітра бойовища — терен, сітка, м'який край туману ---
// Палітра, хеш-варіація і сусідство туману — чиста логіка src/core/render-core.ts
// (terrainShade/visibleKeys/hasVisibleNeighbor); тут — лише Canvas-виклики.

// Нічний терен: фон → (Мегаполіс: цілісна картина cover → стіни → декори →
// знебарвлення туману → приглушення туману → штрих туману | фолбек: клітинки
// двома тонами і сітка) → м'який край туману → межа зору (Т.44).
// Позафазна лінія «візуальні порівняння» (крок 2): ассети готові — фон
// ОДНІМ кадром cover на весь buffer (фото — згладжування увімкнене),
// стіна — за мапою (blocked), декори — за хешем координат (піксель-арт
// атлас — nearest-neighbor), туман — чинне напівпрозоре приглушення
// rgba(5,8,15,0.55) поверх фону (рельєф видно, ADR-0006). Фолбек без
// ассетів — чинні два тони terrainShade (обов'язковий, тести від ассета
// не залежать). Чиста функція без RNG і DOM-стану; викликається кожен
// кадр після clearRect (урок П6.6) — кадр еквівалентний малюванню з
// нуля. w/h — розмір buffer'а канви в пікселях, cell — BCELL.
// п20.2 (ADR-0166, рішення власника «А. Тимчасово кодом»): низька перешкода — темний ящик
// з рамкою і двома планками; мальований тайл замінить його в п20.5. Малюється до туману —
// у тумані ящик приглушено, як стіну (рельєф видно, ADR-0006).
export const LOW_CRATE_FILL = '#2b3036';
export const LOW_CRATE_EDGE = '#8a96a3';
function drawLowCrates(ctx: CanvasRenderingContext2D, cells: readonly TerrainCell[], cell: number): void {
  const inset = Math.round(cell * 0.18);
  const size = cell - 2 * inset;
  ctx.save();
  ctx.lineWidth = Math.max(1, Math.round(cell / 22));
  for (const c of cells) {
    if (c.low !== true) continue;
    const x0 = c.x * cell + inset;
    const y0 = c.y * cell + inset;
    ctx.fillStyle = LOW_CRATE_FILL;
    ctx.fillRect(x0, y0, size, size);
    ctx.strokeStyle = LOW_CRATE_EDGE;
    ctx.strokeRect(x0, y0, size, size);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0 + size, y0 + size);
    ctx.moveTo(x0 + size, y0);
    ctx.lineTo(x0, y0 + size);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawNightTerrain(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  cells: readonly TerrainCell[],
  cell: number,
  px = 1 // Т.119: px buffer'а на CSS px — штрих і межа туману тримають товщину в CSS px
): void {
  // фон на весь buffer (при трясці translate оголює край — колір збігається з CSS-тлом)
  ctx.fillStyle = NIGHT_BG;
  ctx.fillRect(0, 0, w, h);
  // мапа видимості для м'якого краю туману (сусідство за 4 напрямками)
  const vis = visibleKeys(cells);
  if (metroBgImg !== null && metroTilesImg !== null) {
    // цілісна картина підлоги: cover на весь buffer, центр — у центрі канви
    // (квадратний ассет у квадратну канву 960×960 — рівномірний масштаб)
    const { w: iw, h: ih } = imgSize(metroBgImg);
    const scale = Math.max(w / iw, h / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(metroBgImg, Math.round((w - dw) / 2), Math.round((h - dh) / 2), Math.round(dw), Math.round(dh));
    // об'єкти поверх підлоги: піксель-арт атлас — nearest-neighbor, 1:1
    ctx.imageSmoothingEnabled = false;
    // стіни — на blocked-клітинках (за мапою рельєфу); Т.146 (ADR-0127): сусідні стіни — одна
    // маса з чвертей того самого тайла (wallQuads), одиночна — тайл цілком, як раніше
    const walls = new Set(cells.filter((c) => c.blocked).map((c) => c.x + ',' + c.y));
    const isWall = (x: number, y: number): boolean => walls.has(x + ',' + y);
    const wx = METRO_WALL_COL * METRO_TILE;
    for (const c of cells) {
      if (!c.blocked) continue;
      const quads = wallQuads(isWall, c.x, c.y, METRO_TILE);
      if (quads === null) {
        ctx.drawImage(metroTilesImg, wx, 0, METRO_TILE, METRO_TILE, c.x * cell, c.y * cell, cell, cell);
        continue;
      }
      for (const q of quads) {
        ctx.drawImage(metroTilesImg, wx + q.sx, q.sy, q.sw, q.sh, (c.x + q.dx) * cell, (c.y + q.dy) * cell, cell / 2, cell / 2);
      }
    }
    // декори — рідкий детермінований розклад на відкритих (без RNG); п20.2: не під ящиком
    for (const c of cells) {
      if (c.blocked || c.low === true) continue;
      const dcol = decorCol(c.x, c.y);
      if (dcol === null) continue;
      ctx.drawImage(metroTilesImg, dcol * METRO_TILE, 0, METRO_TILE, METRO_TILE, c.x * cell, c.y * cell, cell, cell);
    }
    drawLowCrates(ctx, cells, cell);
    // Т.44: знебарвлення клітинок туману — до приглушення; режим накладання
    // повертає restore
    ctx.save();
    ctx.globalCompositeOperation = 'saturation';
    ctx.fillStyle = FOG_GREY;
    for (const c of cells) {
      if (!c.visible) ctx.fillRect(c.x * cell, c.y * cell, cell, cell);
    }
    ctx.restore();
    // туман: приглушення клітинок поза зоною видимості (вміст не розкривається)
    ctx.fillStyle = TILE_FOG;
    for (const c of cells) {
      if (!c.visible) ctx.fillRect(c.x * cell, c.y * cell, cell, cell);
    }
    // Т.44: штрих — діагоналі в межах кожної клітинки туману
    ctx.save();
    ctx.strokeStyle = FOG_HATCH;
    // Т.119: на зменшеній канві (телефон) штрих 1 px buffer'а ставав 0,2 CSS px — товщина
    // і крок тримаються в CSS px (як на 1366 × 768: ≈ 0,7 і 5,5 px); на більшій канві — як було
    ctx.lineWidth = Math.max(1, 0.7 * px);
    const step = fogHatchStep(px);
    ctx.beginPath();
    for (const c of cells) {
      if (c.visible) continue;
      const x0 = c.x * cell;
      const y0 = c.y * cell;
      for (let d = 0; d < 2 * cell; d += step) {
        ctx.moveTo(x0 + Math.max(0, d - cell), y0 + Math.min(d, cell));
        ctx.lineTo(x0 + Math.min(d, cell), y0 + Math.max(0, d - cell));
      }
    }
    ctx.stroke();
    ctx.restore();
  } else {
    // фолбек: два тони (відкритий / завалений) × туман/видимо, відтінок — хеш
    for (const c of cells) {
      ctx.fillStyle = terrainShade(c.x, c.y, c.blocked, c.visible);
      ctx.fillRect(c.x * cell, c.y * cell, cell - 1, cell - 1);
    }
    drawLowCrates(ctx, cells, cell);
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
  // Т.44: межа зору — лінія між видимою клітинкою і туманом (з ассетами і у фолбеку)
  const border = fogBorderSegments(cells);
  if (border.length > 0) {
    ctx.save();
    ctx.strokeStyle = FOG_BORDER;
    ctx.lineWidth = Math.max(FOG_BORDER_W, 1.4 * px);
    ctx.beginPath();
    for (const e of border) {
      ctx.moveTo(e.x1 * cell, e.y1 * cell);
      ctx.lineTo(e.x2 * cell, e.y2 * cell);
    }
    ctx.stroke();
    ctx.restore();
  }
}

// --- Терен геосцени — ОДНА цілісна картина світу (позафазна лінія «візуальні порівняння»;
// з п19.5 — картина «Живі береги», ADR-0163) ---
// Фон — geo-map.webp cover на всю канву (ассет 1120×630, 16:9, 1120/768 = 630/432 — точне
// вписування без швів; згладжування увімкнене — мальована картина, не піксель-арт). Розклад суші GEO_LAYOUT
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
// Т.44 (рішення власника «контур + легка заливка»): зона ходу вибраного оперативника.
// keys — досяжні клітинки (ключі "x,y", без клітинки оперативника); контур обводить
// зону разом із клітинкою оперативника і зсунутий на 1 px усередину клітинок.
// Порожня зона — нічого не малюється.
export const REACH_FILL = 'rgba(127,226,160,0.09)';
export const REACH_OUTLINE = 'rgba(127,226,160,0.75)';
const REACH_OUTLINE_W = 2;
export function drawReachZone(
  ctx: CanvasRenderingContext2D,
  keys: ReadonlySet<string>,
  origin: { x: number; y: number },
  cell: number
): void {
  if (keys.size === 0) return;
  const zone = new Set(keys).add(origin.x + ',' + origin.y);
  ctx.save();
  ctx.fillStyle = REACH_FILL;
  for (const k of keys) {
    const i = k.indexOf(',');
    ctx.fillRect(Number(k.slice(0, i)) * cell + 1, Number(k.slice(i + 1)) * cell + 1, cell - 2, cell - 2);
  }
  ctx.strokeStyle = REACH_OUTLINE;
  ctx.lineWidth = REACH_OUTLINE_W;
  ctx.beginPath();
  for (const e of zoneOutlineSegments(zone)) {
    ctx.moveTo(e.x1 * cell + e.nx, e.y1 * cell + e.ny - e.e1);
    ctx.lineTo(e.x2 * cell + e.nx, e.y2 * cell + e.ny + e.e2);
  }
  ctx.stroke();
  ctx.restore();
}

// Т.44: прев'ю шляху — ламана через центри клітинок від оперативника до цілі, коло в кінці
// і плашка ціни «<число> AP» біля цілі. Колір: AP вистачає — зелений, не вистачає — червоний.
// Ширина тексту — оцінка 9 px на знак (як у drawChanceLabel: без measureText, якого немає
// в мок-контексті jsdom); текст вирівняно по центру плашки, тож похибка оцінки симетрична.
// Порожній шлях — нічого не малюється.
export const PATH_OK = 'rgba(127,226,160,0.95)';
export const PATH_SHORT = 'rgba(255,156,156,0.95)';
export const PATH_LABEL_BG = 'rgba(6,10,20,0.9)';
const PATH_W = 4;
const PATH_END_R = 7;
export interface PathPreview {
  from: { x: number; y: number }; // клітинка оперативника
  path: ReadonlyArray<{ x: number; y: number }>; // клітинки шляху без стартової
  ap: number; // ціна шляху
  affordable: boolean;
  cell: number;
  cw: number; // ширина buffer'а канви, px
  px?: number; // px buffer'а на CSS px (> 1 — канву показано зменшеною); 1 — без масштабу
}
export function drawPathPreview(ctx: CanvasRenderingContext2D, p: PathPreview): void {
  const goal = p.path[p.path.length - 1];
  if (!goal) return;
  const mid = (c: { x: number; y: number }): [number, number] => [c.x * p.cell + p.cell / 2, c.y * p.cell + p.cell / 2];
  const color = p.affordable ? PATH_OK : PATH_SHORT;
  // Т.119: канву показано зменшеною (iPad — ×0,58, телефон — ×0,2) — текст плашки не дрібніший
  // за PATH_LABEL_MIN_CSS CSS px, лінія шляху — за 2 CSS px, коло цілі — за 3,5 CSS px
  const px = p.px ?? 1;
  const k = pathLabelScale(px);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(PATH_W, 2 * px);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(...mid(p.from));
  for (const c of p.path) ctx.lineTo(...mid(c));
  ctx.stroke();
  const [gx, gy] = mid(goal);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(gx, gy, Math.max(PATH_END_R, 3.5 * px), 0, Math.PI * 2);
  ctx.fill();
  const text = p.ap + ' AP';
  const prev = p.path.length > 1 ? p.path[p.path.length - 2]! : p.from; // клітинка перед ціллю
  const box = pathLabelBox(goal, p.cell, text.length * PATH_LABEL_CHAR_W * k, p.cw, k, prev.x > goal.x);
  ctx.fillStyle = PATH_LABEL_BG;
  ctx.fillRect(box.x, box.y, box.w, box.h);
  ctx.lineWidth = Math.max(1, Math.round(k));
  ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1);
  ctx.fillStyle = color;
  ctx.font = 'bold ' + Math.ceil(15 * k - 1e-9) + 'px monospace'; // угору — не дрібніше за 12 CSS px
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, box.x + box.w / 2, box.y + box.h / 2 + 0.5);
  ctx.restore();
}

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
const BOOM_CALM_R = 14; // Т.144 (ADR-0125): нерухоме кільце вибуху за «менше руху», px
const IMPACT_CALM_R = 6; // Т.144: нерухоме кільце влучання, px

// п17.5 (рішення власника «А. Удар без трасера»): удар гончака — три паралельні риски кігтів
// навскіс через ціль (колір гончака), ростуть за grow 0..1 і гаснуть за alpha; без кулі,
// спалаху дула й іскор. «Менше руху» — одразу повні риски.
const CLAW = '#ff3b30';
const CLAW_LEN = 13; // півдовжина риски, px
const CLAW_GAP = 6; // відстань між рисками, px
export function drawClawSlash(ctx: CanvasRenderingContext2D, x: number, y: number, grow: number, alpha: number): void {
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = CLAW;
  ctx.lineWidth = 2;
  ctx.shadowColor = CLAW;
  ctx.shadowBlur = IMPACT_GLOW;
  for (let k = -1; k <= 1; k++) {
    const ox = x + k * CLAW_GAP;
    const oy = y - CLAW_LEN;
    ctx.beginPath();
    ctx.moveTo(ox + CLAW_LEN * 0.6, oy);
    ctx.lineTo(ox + CLAW_LEN * 0.6 - 1.2 * CLAW_LEN * grow, oy + 2 * CLAW_LEN * grow);
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 1;
}
const OW_CALM_R = 8; // Т.144: нерухоме кільце дозору, px
// Т.132 (ADR-0121): спалах дула, іскри влучання, пил розчинення
const MUZZLE_FLASH_SHARE = 0.35; // частка польоту кулі зі спалахом дула
const FLASH_CORE = '#f4fdff'; // світле ядро спалаху
const SPARK_HOT = '#fff3b0'; // гарячі іскри (через одну — бурштин IMPACT)
const DUST = 8; // частинок розчинення

// Підказка якоря дула для трасера бою (фідбек власника 2026-10-22): сторона
// стрільця і ЧИ ФЛІПНУТИЙ кадр (фактичний напрямок погляду цього кадру —
// його знає лише викликаючий шар бою, battle.ts). Суто відображення: без
// підказки трасер малюється від центру клітинки, як раніше (геосцена).
export interface MuzzleHint {
  side: 'player' | 'alien';
  flip: boolean;
  kind?: EnemyKind; // п17.5: тип стрільця-ворога — якір дула (без поля — демон)
  turret?: boolean; // п18.5 (ADR-0157): стрілець — турель, дуло — кінчик ствола (turretMuzzle)
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
    ctx.arc(a.cx, a.cy, a.calm === true ? a.maxR : 2 + (a.maxR - 2) * t, 0, Math.PI * 2); // Т.144: спокійно — кільце на місці
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
      // Т.144 (ADR-0125): «менше руху» — нерухоме кільце-спалах на краю зони, без розгортки
      if (a.calm === true) {
        ctx.globalAlpha = 0.6 * fade;
        ctx.strokeStyle = RADAR_PULSE;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, a.cy, a.maxR, 0, Math.PI * 2);
        ctx.stroke();
        continue;
      }
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
    ctx.arc(cx, cy, a.calm === true ? BOOM_CALM_R : 4 + 20 * t, 0, Math.PI * 2); // Т.144: спокійно — кільце на місці
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 1;
    for (let i = 0; a.calm !== true && i < BOOM_PARTICLES; i++) {
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
    const y = Math.round(base - (a.calm === true ? 0 : DNUM_RISE * t)); // підйом над ціллю; Т.144: спокійно — на місці
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
    // Т.144 (ADR-0125): «менше руху» — без ходьби по клітинках: боєць проявляється в цілі
    if (a.calm === true) {
      const first = a.path[0] ?? { x: 0, y: 0 };
      const last = a.path[a.path.length - 1] ?? first;
      const dir = Math.sign(last.x - first.x);
      ctx.globalAlpha = t;
      drawUnitSprite(ctx, {
        side: a.side,
        cx: p.cx,
        cy: p.cy,
        r,
        hp: a.hp,
        maxHp: a.hpMax,
        selected: a.selected,
        overwatch: a.overwatch,
        ring: unitRing(a.side, a.unitId, a.enemyKind),
        kind: a.enemyKind, // п17.5: ряд атласа за типом
        flip: dir !== 0 && dir !== (a.side === 'player' ? 1 : -1),
      });
      ctx.globalAlpha = 1;
      return;
    }
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
      ring: unitRing(a.side, a.unitId, a.enemyKind), // Т.129: кільце їде разом із бійцем
      kind: a.enemyKind, // п17.5: ряд атласа за типом
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
    // (якір — MUZZLE_ANCHOR, геометрія та ж, що drawAtlasUnit, з віддачею кадру)
    // — лише з підказкою бойовища; без неї (геосцена) — від центру клітинки.
    const share = tracerShare(a);
    const calm = a.calm === true; // Т.144 (ADR-0125): «менше руху» — лінія пострілу на місці, без віддачі, спалаху дула й іскор
    if (a.melee === true) {
      // промах — бліді риски (удар повз), влучання — яскраві і гаснуть у фазі влучання
      const fade = calm || t < share ? 1 : 1 - (t - share) / (1 - share);
      drawClawSlash(ctx, x1, y1, calm ? 1 : Math.min(1, t / share), fade * (a.hit ? 1 : 0.45));
      return;
    }
    if (muzzle !== undefined) {
      const m =
        muzzle.turret === true
          ? turretMuzzle(muzzle.flip, x0, y0, calm ? 0 : recoilPx(t, share))
          : muzzlePoint(muzzle.side, muzzle.flip, x0, y0, calm ? 0 : recoilPx(t, share), muzzle.kind);
      x0 = m.x;
      y0 = m.y;
    }
    const color = a.side === 'player' ? TRACER_PLAYER : TRACER_RIFT;
    if (t < share) {
      // фаза 1: куля летить — відрізок від стрільця до поточного «заголовка»
      const f = t / share;
      if (calm) {
        ctx.globalAlpha = 1 - 0.5 * f;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        ctx.lineWidth = 1;
        ctx.globalAlpha = 1;
        return;
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.shadowColor = color; // П6.13: неонове свічення трасера
      ctx.shadowBlur = TRACER_GLOW;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x0 + (x1 - x0) * f, y0 + (y1 - y0) * f);
      ctx.stroke();
      // Т.132 (ADR-0121): спалах дула — перша третина польоту кулі, гасне;
      // два кола: світле ядро і ореол кольору сторони
      if (muzzle !== undefined && f < MUZZLE_FLASH_SHARE) {
        const k = 1 - f / MUZZLE_FLASH_SHARE;
        ctx.shadowBlur = IMPACT_GLOW;
        ctx.globalAlpha = 0.55 * k;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x0, y0, 5 + 5 * k, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = k;
        ctx.fillStyle = FLASH_CORE;
        ctx.beginPath();
        ctx.arc(x0, y0, 2 + 2 * k, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.shadowBlur = 0;
      ctx.lineWidth = 1;
    } else if (a.hit) {
      // фаза 2: спалах у цілі — кільце, що росте і гасне, і іскри (Т.132, ADR-0121):
      // SPARKS квадратиків 3 px розлітаються й падають, у межах канви
      const f = (t - share) / (1 - share);
      ctx.globalAlpha = 1 - f;
      ctx.strokeStyle = IMPACT;
      ctx.lineWidth = 2;
      ctx.shadowColor = IMPACT; // П6.13: свічення спалаху
      ctx.shadowBlur = IMPACT_GLOW;
      ctx.beginPath();
      ctx.arc(x1, y1, calm ? IMPACT_CALM_R : 3 + 5 * f, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.lineWidth = 1;
      for (let i = 0; !calm && i < SPARKS; i++) {
        const o = sparkOffset(a.to, i, f);
        ctx.fillStyle = i % 2 === 0 ? SPARK_HOT : IMPACT;
        ctx.fillRect(Math.min(Math.max(x1 + o.dx - 1, 0), cw - 3), Math.min(Math.max(y1 + o.dy - 1, 0), ch - 3), 3, 3);
      }
      ctx.globalAlpha = 1;
    }
    return;
  }
  if (a.kind === 'death' && a.calm === true) {
    // Т.144 (ADR-0125): «менше руху» — загиблий просто згасає, без смуг і частинок
    ctx.globalAlpha = 1 - t;
    drawUnitSprite(ctx, {
      side: a.side,
      cx: a.at.x * cell + cell / 2,
      cy: a.at.y * cell + cell / 2,
      r,
      hp: 0,
      maxHp: a.hpMax,
      selected: false,
      overwatch: false,
      pose: 'death',
      kind: a.enemyKind, // п17.5: кадр смерті свого типу
      turret: a.turret, // п18.5 (аудит PR #516): турель розчиняється своїм силуетом
    });
    ctx.globalAlpha = 1;
    return;
  }
  if (a.kind === 'death') {
    // Т.132 (ADR-0121): розчинення — кадр смерті розсипається смугами DISSOLVE_STRIP px
    // (поріг смуги — dissolveKept, без RNG) і блідне; угору летять частинки кольору сторони.
    const cx = a.at.x * cell + cell / 2;
    const cy = a.at.y * cell + cell / 2;
    const top = a.at.y * cell;
    ctx.save();
    ctx.beginPath();
    for (let k = 0; k * DISSOLVE_STRIP < cell; k++) {
      if (dissolveKept(k, t)) ctx.rect(cx - UNIT_DRAW / 2, top + k * DISSOLVE_STRIP, UNIT_DRAW, DISSOLVE_STRIP);
    }
    ctx.clip();
    ctx.globalAlpha = 1 - 0.6 * t;
    drawUnitSprite(ctx, {
      side: a.side,
      cx,
      cy,
      r,
      hp: 0,
      maxHp: a.hpMax, // П14.4: порожня смуга HP загиблого
      selected: false,
      overwatch: false,
      pose: 'death', // П14.2 (ADR-0072): кадр смерті з атласа; фолбек — матриця
      kind: a.enemyKind, // п17.5: кадр смерті свого типу
      turret: a.turret, // п18.5 (аудит PR #516): турель розчиняється своїм силуетом
    });
    ctx.restore();
    if (t > 0) {
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = a.side === 'player' ? TRACER_PLAYER : TRACER_RIFT;
      for (let i = 0; i < DUST; i++) {
        const dx = -20 + i * 5;
        const dy = 10 - Math.round((30 * t * ((i % 3) + 1)) / 3);
        ctx.fillRect(Math.min(Math.max(cx + dx, 0), cw - 2), Math.max(cy + dy, 0), 2, 2);
      }
      ctx.globalAlpha = 1;
    }
    return;
  }
  // owflash: кільце дозору, що росте і гасне (колір — як маркер дозору)
  ctx.globalAlpha = 1 - t;
  ctx.strokeStyle = OW_FLASH;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(a.at.x * cell + cell / 2, a.at.y * cell + cell / 2, a.calm === true ? OW_CALM_R : 4 + 6 * t, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.globalAlpha = 1;
}
