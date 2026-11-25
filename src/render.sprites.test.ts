// src/render.sprites.test.ts
// Т.2 (тестовий рефакторинг, ADR-0038/пR.3): тести піксель-спрайтів шару
// відображення, перенесені з src/render.test.ts без зміни логіки й тверджень.
// П6.12 (ADR-0031): тести піксель-арт спрайтів — матриці розгортаються в мок
// offscreen-канвас (по одному fillRect на піксель), далі drawImage на цільовий
// мок-контекст: (1) малювання не виходить за клітинку (урок П6.6); (2) силуети
// і зброя солдата й прибульця відрізняються (кольори пікселів растру); (3)
// малювання детерміноване (той самий вхід → той самий потік викликів, без RNG);
// (4) читабельність стану (HP, вибір, дозор); (5) кеш offscreen-канвасів і
// nearest-neighbor (imageSmoothingEnabled = false, ціле кратне масштабування).
// П6.13: нічна палітра — терен (двотоновий, хеш-варіація, без RNG), тонка
// сітка в проміжках, м'який край туману (сенс туману незмінний).
// П6.14: обведення валідних цілей і шанс попадання (drawTargetFrame/drawChanceLabel).
// П14.2 (ADR-0072): атлас спрайтів юнітів бою — вибір кадру за станом юніта
// (idle/walk/fire/death, чиста функція без RNG), Т.132: 68 × 68 зі згладжуванням у
// BCELL 48 (П14.3: walk2 — окремий кадр, фліп за напрямком), обов'язковий
// фолбек на матриці ADR-0031 при !loaded (тести від
// ассета не залежать — завантажувач інжектиться моком).
// Кадри анімаційного шару (drawAnimFrame) — у src/render.frames.test.ts;
// чиста логіка рушія — у src/core/render-core.test.ts (ADR-0038).

import htmlRaw from '../index.html?raw';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ATLAS_FRAME,
  ATLAS_POSE_COL,
  ATLAS_UNIT,
  ATLAS_WALK2_COL,
  CHANCE_LABEL_BG,
  CHANCE_LABEL_TEXT,
  TARGET_FRAME_COLOR,
  METRO_DECOR_COL,
  METRO_TILE,
  METRO_WALL_COL,
  decorCol,
  drawAlienSprite,
  drawBaseSprite,
  drawChanceLabel,
  drawGeoBaseSprite,
  drawGeoTerrain,
  drawNightTerrain,
  drawPathPreview,
  drawReachZone,
  drawSoldierSprite,
  unitLetter,
  unitRing,
  drawTargetFrame,
  drawUfoSprite,
  drawUnitSprite,
  initGeoMap,
  initGeoTower,
  initMetroMap,
  initMetroTiles,
  initPixelSprites,
  initUnitAtlas,
  muzzlePoint,
  isGeoMapReady,
  isGeoTowerReady,
  isMetroTerrainReady,
  isUnitAtlasReady,
  unitPose,
  type MakeOffscreen,
  type UnitSpriteView,
} from './render';
import {
  GEO_CELL_A,
  GEO_CELL_B,
  GEO_GRID_COLOR,
  NIGHT_BG,
  cellHash,
  geoIsLand,
  GEO_LAND_ROWS,
  terrainShade,
  type TerrainCell,
  fogBorderSegments,
  zoneOutlineSegments,
  wallQuads,
} from './core/render-core';
import {
  ALIEN_STAND,
  BASE_SPRITE,
  FIGHTER_SPRITE,
  OW_BOLT,
  SOLDIER_STAND,
  SPRITE_SCALE,
  UFO_LANDED_SPRITE,
  UFO_SCOUT_SPRITE,
} from './core/sprites';
import { BCELL, GCELL } from './ui/grid';
import {
  ALIEN_RING,
  ENEMY_LOOK,
  ATLAS_FEET_ROW,
  BREATH_SCALE,
  FIGHTER_COLORS,
  HP_BAR_H,
  RING_DY,
  RING_RX,
  RING_RY,
  UNIT_FEET_DY,
} from './core/render-core';

// Клітиночка прев'ю: BCELL = 48 (П14.3, ADR-0068), центр (24, 24), радіус силуету 8 (як у renderBattle).
const CX = 24;
const CY = 24;
const R = 8;
const CELL = 48;

type Call = { m: string; args: unknown[] };

// Мок 2D-контексту: методи записуються, властивості (fillStyle тощо) — просто присвоюються.
function mockCtx(): { ctx: CanvasRenderingContext2D; calls: Call[] } {
  const calls: Call[] = [];
  const rec =
    (m: string) =>
    (...args: unknown[]): void => {
      calls.push({ m, args });
    };
  const ctx = {
    beginPath: rec('beginPath'),
    moveTo: rec('moveTo'),
    lineTo: rec('lineTo'),
    arc: rec('arc'),
    ellipse: rec('ellipse'),
    closePath: rec('closePath'),
    fill: rec('fill'),
    stroke: rec('stroke'),
    fillRect: rec('fillRect'),
    strokeRect: rec('strokeRect'),
    fillText: rec('fillText'),
    drawImage: rec('drawImage'),
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

const soldier = (over: Partial<UnitSpriteView> = {}): UnitSpriteView => ({
  side: 'player',
  cx: CX,
  cy: CY,
  r: R,
  hp: 10,
  maxHp: 10, // П14.4: показник життя — смуга HP
  selected: false,
  overwatch: false,
  ...over,
});

const alien = (over: Partial<UnitSpriteView> = {}): UnitSpriteView => ({ ...soldier(), side: 'alien', ...over });

// П6.12 (ADR-0031): мок-фабрика offscreen-канвасів — розгортання матриці пише
// по одному fillRect на піксель; сам об'єкт «канваса» стає джерелом drawImage
// (тотожність об'єктів у викликах = перевірка кешу), колір пікселя — у pixels.
interface RasterCanvas {
  width: number;
  height: number;
  pixels: Array<{ x: number; y: number; color: string }>;
  getContext(type: '2d'): CanvasRenderingContext2D | null;
}
function rasterFactory(): { make: MakeOffscreen; canvases: RasterCanvas[] } {
  const canvases: RasterCanvas[] = [];
  const make: MakeOffscreen = (w, h) => {
    const cv: RasterCanvas = {
      width: w,
      height: h,
      pixels: [],
      getContext: () => g as unknown as CanvasRenderingContext2D,
    };
    const style = { color: '' };
    const g = {
      get fillStyle(): string {
        return style.color;
      },
      set fillStyle(c: string) {
        style.color = c;
      },
      fillRect: (x: number, y: number): void => {
        cv.pixels.push({ x, y, color: style.color });
      },
    };
    canvases.push(cv);
    return cv;
  };
  return { make, canvases };
}

// Кожен тест малює через свіжий мок-фабрик: initPixelSprites скидає кеш
// розгорнутих спрайтів (ліниво + кеш — ADR-0031). П14.2/П14.3 (ADR-0072):
// атлас юнітів і ассети терену «Мегаполіс» скидаються у фолбек —
// завантажувачі, що не кликаються (тести від ассетів не залежать; свої
// моки атласні describe ставлять локально).
beforeEach(() => {
  initPixelSprites(rasterFactory().make);
  initUnitAtlas(() => {});
  initMetroMap(() => {}); // позафазна лінія «Мегаполіс»: фон і тайли — фолбек за замовчуванням
  initMetroTiles(() => {});
  initGeoMap(() => {}); // позафазна лінія: карта світу і спрайт радара — фолбек за замовчуванням
  initGeoTower(() => {});
});

// Піксельні межі всіх точок, яких торкається малювання: arc — центр ± r,
// ellipse — центр ± rx/ry, moveTo/lineTo — точка, fillRect/strokeRect — прямокутник,
// fillText — точка, drawImage — прямокутник (img, x, y, w, h). Stroke розширює
// межі на lineWidth/2 — лишаємо запас ≥ 1px.
function extent(calls: Call[]): { minX: number; maxX: number; minY: number; maxY: number } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const c of calls) {
    const a = c.args as number[];
    switch (c.m) {
      case 'arc':
        xs.push(a[0] - a[2], a[0] + a[2]);
        ys.push(a[1] - a[2], a[1] + a[2]);
        break;
      case 'ellipse':
        xs.push(a[0] - a[2], a[0] + a[2]);
        ys.push(a[1] - a[3], a[1] + a[3]);
        break;
      case 'moveTo':
      case 'lineTo':
      case 'fillText':
        xs.push(a[0]);
        ys.push(a[1]);
        break;
      case 'fillRect':
      case 'strokeRect':
        xs.push(a[0], a[0] + a[2]);
        ys.push(a[1], a[1] + a[3]);
        break;
      case 'drawImage':
        // args: (img, x, y, w, h)
        xs.push(a[1], a[1] + a[3]);
        ys.push(a[2], a[2] + a[4]);
        break;
      default:
        break; // beginPath/fill/stroke/closePath — без координат
    }
  }
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

describe('П13.5 (ADR-0068): масштаб піксель-арту — матриці зафіксовані тестами', () => {
  // Критерій 1 кроку: механізм ADR-0031 без змін (кеш, nearest-neighbor, цілий
  // кратний масштаб — тести вище), масштаб ТІЛЬКИ в матрицях/кроці сітки.
  const rect = (rows: readonly string[]): boolean => new Set(rows.map((r) => r.length)).size === 1;

  it('матриці прямокутні: юніти 16×16, вузол 16×16, НЛО/перехоплювач 12×12, дозор 5×5', () => {
    for (const [def, px] of [
      [SOLDIER_STAND, 16],
      [ALIEN_STAND, 16],
      [BASE_SPRITE, 16],
      [UFO_LANDED_SPRITE, 12],
      [UFO_SCOUT_SPRITE, 12],
      [FIGHTER_SPRITE, 12],
      [OW_BOLT, 5],
    ] as const) {
      expect(def.rows.length).toBe(px);
      expect(def.rows[0]!.length).toBe(px);
      expect(rect(def.rows)).toBe(true); // усі рядки рівні (урок растра: довжина за rows[0])
    }
  });

  it('ціле кратне масштабування в клітинках: юніт 32px ≤ BCELL 48, гео 24/32px ≤ GCELL 44', () => {
    expect(SPRITE_SCALE).toBe(2); // ціле кратне (ADR-0031)
    expect(SOLDIER_STAND.rows.length * SPRITE_SCALE).toBeLessThanOrEqual(BCELL);
    expect(BASE_SPRITE.rows.length * SPRITE_SCALE).toBeLessThanOrEqual(GCELL);
    expect(UFO_SCOUT_SPRITE.rows.length * SPRITE_SCALE).toBeLessThanOrEqual(GCELL);
    expect(FIGHTER_SPRITE.rows.length * SPRITE_SCALE).toBeLessThanOrEqual(GCELL);
  });
});

describe('спрайти юнітів: межі клітинки (урок П6.6)', () => {
  it('солдат з усіма маркерами не виходить за клітинку 48px (П14.3)', () => {
    const { ctx, calls } = mockCtx();
    drawSoldierSprite(ctx, soldier({ selected: true, overwatch: true, ring: '#8ee35b' }));
    const e = extent(calls);
    expect(e.minX).toBeGreaterThanOrEqual(0);
    expect(e.maxX).toBeLessThanOrEqual(CELL);
    expect(e.minY).toBeGreaterThanOrEqual(0);
    expect(e.maxY).toBeLessThanOrEqual(CELL);
  });

  it('прибульчик з усіма маркерами не виходить за клітинку 48px (П14.3)', () => {
    const { ctx, calls } = mockCtx();
    drawAlienSprite(ctx, alien({ selected: true, overwatch: true, ring: ALIEN_RING }));
    const e = extent(calls);
    expect(e.minX).toBeGreaterThanOrEqual(0);
    expect(e.maxX).toBeLessThanOrEqual(CELL);
    expect(e.minY).toBeGreaterThanOrEqual(0);
    expect(e.maxY).toBeLessThanOrEqual(CELL);
  });
});

describe('піксель-арт: offscreen-канваси, nearest-neighbor, кеш (П6.12, ADR-0031)', () => {
  it('drawImage з offscreen-канваса: цілий масштаб 2× (32px у клітинці 48 — П14.3), згладжування вимкнене', () => {
    const s = animCtx(); // Proxy: записує і виклики, і присвоєння властивостей
    drawSoldierSprite(s.ctx, soldier());
    const d = s.calls.find((c) => c.m === 'drawImage');
    expect(d).toBeDefined();
    expect((d!.args as number[])[1]).toBe(CX - (16 * SPRITE_SCALE) / 2); /* Math.round(24 - 16) = 8; матриця 16×16 (П14.3) */
    expect((d!.args as number[])[2]).toBe(CY - (16 * SPRITE_SCALE) / 2);
    expect((d!.args as number[])[3]).toBe(16 * SPRITE_SCALE);
    expect((d!.args as number[])[4]).toBe(16 * SPRITE_SCALE);
    expect(s.sets.some((x) => x.p === 'imageSmoothingEnabled' && x.v === false)).toBe(true);
  });

  it('кеш: повторне малювання — той самий offscreen-канвас, фабрика викликається один раз', () => {
    const rf = rasterFactory();
    initPixelSprites(rf.make);
    const a = mockCtx();
    const b = mockCtx();
    drawSoldierSprite(a.ctx, soldier());
    drawSoldierSprite(b.ctx, soldier());
    const imgA = a.calls.find((c) => c.m === 'drawImage')!.args[0];
    const imgB = b.calls.find((c) => c.m === 'drawImage')!.args[0];
    expect(imgA).toBe(imgB);
    expect(rf.canvases.length).toBe(1);
  });

  it('без фабрики — явна помилка (не мовчки порожній кадр)', () => {
    initPixelSprites(null as unknown as MakeOffscreen);
    const { ctx } = mockCtx();
    expect(() => drawSoldierSprite(ctx, soldier())).toThrow(/initPixelSprites/);
  });

  it('кадри ходьби: frame 1 — інша матриця (інший offscreen-канвас)', () => {
    const rf = rasterFactory();
    initPixelSprites(rf.make);
    const f0 = mockCtx();
    drawSoldierSprite(f0.ctx, soldier());
    const f1 = mockCtx();
    drawSoldierSprite(f1.ctx, soldier({ frame: 1 }));
    expect(f0.calls.find((c) => c.m === 'drawImage')!.args[0]).not.toBe(f1.calls.find((c) => c.m === 'drawImage')!.args[0]);
    expect(rf.canvases.length).toBe(2);
  });
});

describe('солдат і прибульчик: різні матриці, зброя відрізняється (П6.12)', () => {
  it('різні силуети: інші джерела drawImage, кольори тіл різні', () => {
    const rf = rasterFactory();
    initPixelSprites(rf.make);
    const s = mockCtx();
    drawSoldierSprite(s.ctx, soldier());
    const a = mockCtx();
    drawAlienSprite(a.ctx, alien());
    expect(s.calls.find((c) => c.m === 'drawImage')!.args[0]).not.toBe(a.calls.find((c) => c.m === 'drawImage')!.args[0]);
    expect(rf.canvases[0].pixels.some((p) => p.color === '#175d8a')).toBe(true); // тіло оперативника
    expect(rf.canvases[1].pixels.some((p) => p.color === '#a32eff')).toBe(true); // пурпурне тіло демона Розриву
    // П12.7 (ADR-0064): неонові акценти — візор ціан у оперативника, «тріщини світла» в демона
    expect(rf.canvases[0].pixels.some((p) => p.color === '#00e5ff')).toBe(true); // неоновий візор
    expect(rf.canvases[1].pixels.some((p) => p.color === '#ffd9f2')).toBe(true); // тріщини світла
  });

  it('«АР-14 Гарт»: ствол кольором зброї, дуло — крайній правий піксель растру', () => {
    const rf = rasterFactory();
    initPixelSprites(rf.make);
    drawSoldierSprite(mockCtx().ctx, soldier());
    const ras = rf.canvases[0];
    const barrel = ras.pixels.filter((p) => p.color === '#e6f7ff');
    expect(barrel.length).toBeGreaterThanOrEqual(4);
    expect(barrel.some((p) => p.x === ras.width - 1)).toBe(true); // дуло за межами тіла
  });

  it('«Фазовий різак»: піки кольором різака над головою, кольору ствола в растрі нема', () => {
    const rf = rasterFactory();
    initPixelSprites(rf.make);
    drawAlienSprite(mockCtx().ctx, alien());
    const ras = rf.canvases[0];
    const fork = ras.pixels.filter((p) => p.color === '#ff2e88');
    expect(fork.length).toBeGreaterThanOrEqual(4);
    expect(fork.every((p) => p.y < 3)).toBe(true); // верхні рядки — над головою (голова з y = 3)
    expect(ras.pixels.some((p) => p.color === '#e6f7ff')).toBe(false); // жодного ствола
  });
});

describe('читабельність стану (ADR-0007)', () => {
  it('HP: смуга під ногами (Т.132: підкладка з облямівкою + заповнення за часткою) і число на плашці', () => {
    const s = animCtx(); // Proxy: записує і виклики, і присвоєння властивостей
    drawSoldierSprite(s.ctx, soldier({ hp: 7 }));
    expect(s.calls.some((c) => c.m === 'fillText' && c.args[0] === '7')).toBe(true);
    // смуга: підкладка 36 × 5 під ногами (CY+19..CY+24 — у межах клітинки) і заповнення 7/10 від 34
    const rects = s.calls.filter((c) => c.m === 'fillRect') as Array<{ args: number[] }>;
    expect(rects.some((c) => c.args[0] === CX - 18 && c.args[1] === CY + 19 && c.args[2] === 36 && c.args[3] === 5)).toBe(true);
    expect(rects.some((c) => c.args[1] === CY + 20 && c.args[2] >= 23 && c.args[2] <= 24 && c.args[3] === 3)).toBe(true); // 34×0.7
    expect(CY + 19 + 5).toBeLessThanOrEqual(CY + 24); // низ підкладки — низ клітинки
    expect(s.sets.some((x) => x.p === 'fillStyle' && x.v === '#7fe2a0')).toBe(true); // >50% — зелений

    const a = animCtx();
    drawAlienSprite(a.ctx, alien({ hp: 4 }));
    expect(a.calls.some((c) => c.m === 'fillText' && c.args[0] === '4')).toBe(true);
    expect(a.sets.some((x) => x.p === 'fillStyle' && x.v === '#ffcf5c')).toBe(true); // 40% — бурштин

    const low = animCtx();
    drawSoldierSprite(low.ctx, soldier({ hp: 1 }));
    expect(low.sets.some((x) => x.p === 'fillStyle' && x.v === '#ff5c7a')).toBe(true); // ≤25% — червоний
    expect(low.calls.some((c) => c.m === 'fillText' && c.args[0] === '1')).toBe(true);
  });

  it('HP-число: кольори сторін на темній плашці (ціан/пурпур, ADR-0064), у верхньому правому куті клітинки', () => {
    const s = animCtx();
    drawSoldierSprite(s.ctx, soldier({ hp: 7 }));
    expect(s.sets.some((x) => x.p === 'fillStyle' && x.v === '#9adfff')).toBe(true);
    const plate = s.calls.find((c) => c.m === 'fillRect' && (c.args as number[])[3] === 11)!;
    const p = plate.args as number[];
    expect(p[0] + p[2]).toBeLessThanOrEqual(CX + 24); // край клітинки
    expect(p[1]).toBe(CY - 23); // Т.132: верхній правий кут клітинки (смуга — під ногами)
    const a = animCtx();
    drawAlienSprite(a.ctx, alien({ hp: 4 }));
    expect(a.sets.some((x) => x.p === 'fillStyle' && x.v === '#ff9ecb')).toBe(true);
  });

  it('рамка вибору — кутові дужки по кутах спрайта лише коли selected (доробка П6.12)', () => {
    const sel = mockCtx();
    drawSoldierSprite(sel.ctx, soldier({ selected: true }));
    const moves = sel.calls.filter((c) => c.m === 'moveTo');
    const lines = sel.calls.filter((c) => c.m === 'lineTo');
    expect(moves.length).toBe(4); // по одній дужці на кут
    expect(lines.length).toBe(8); // два плечі на кут

    expect(moves.some((c) => (c.args as number[])[0] === CX - 23 && (c.args as number[])[1] === CY - 23 + 7)).toBe(
      true
    ); /* Т.132: дужки по кутах клітинки 48 (фігура 68 px займає клітинку) */

    const notSel = mockCtx();
    drawSoldierSprite(notSel.ctx, soldier());
    expect(notSel.calls.some((c) => c.m === 'moveTo' || c.m === 'lineTo')).toBe(false);
  });

  it('маркер дозору — «блискавка» з кантом у кутку клітинки 10×10: верхній лівий кут для обох сторін (Т.132)', () => {
    const rf = rasterFactory();
    initPixelSprites(rf.make);
    const s = mockCtx();
    drawSoldierSprite(s.ctx, soldier({ overwatch: true }));
    const owS = s.calls.find((c) => c.m === 'drawImage' && (c.args as number[])[3] === 10);
    expect(owS).toBeDefined();
    expect((owS!.args as number[])[1]).toBe(CX - 21); // верхній лівий кут клітинки (центр CX-16, розмір 10)
    expect((owS!.args as number[])[2]).toBe(CY - 21);
    const bolt = rf.canvases[1]; // перша матриця після силуета — блискавка
    expect(bolt.pixels.some((p) => p.color === '#ffb347')).toBe(true); // бурштин знака (П12.7, ADR-0064)
    expect(bolt.pixels.some((p) => p.color === '#0b0e15')).toBe(true); // темний кант

    const a = mockCtx();
    drawAlienSprite(a.ctx, alien({ overwatch: true }));
    const owA = a.calls.find((c) => c.m === 'drawImage' && (c.args as number[])[3] === 10);
    expect(owA).toBeDefined();
    expect((owA!.args as number[])[1]).toBe(CX - 21); // Т.132: правий верхній — число HP, низ — смуга HP
    expect((owA!.args as number[])[2]).toBe(CY - 21);
  });

  it('п17.2 (аудит PR #507): ворог з літерою типу — знак дозору праворуч від плашки, не під нею', () => {
    const rf = rasterFactory();
    initPixelSprites(rf.make);
    for (const [letter, w] of [
      ['Гн', 15],
      ['Д', 9],
    ] as const) {
      const a = mockCtx();
      drawAlienSprite(a.ctx, alien({ overwatch: true, letter, ring: ALIEN_RING, hp: 10 }));
      const ow = a.calls.find((c) => c.m === 'drawImage' && (c.args as number[])[3] === 10);
      const x = (ow!.args as number[])[1];
      expect(x).toBe(CX - 23 + w + 1); // центр знака — на 6 px правіше краю плашки
      expect(x).toBeGreaterThanOrEqual(CX - 23 + w); // плашка x [CX-23, CX-23+w) знака не накриває
      expect(x + 10).toBeLessThan(CX + 24 - (2 * 6 + 3) - 1); // і знак не доходить до плашки числа HP «10»
      expect((ow!.args as number[])[2]).toBe(CY - 21);
    }
  });
});

describe('детермінованість малювання (ADR-0003 — без RNG)', () => {
  it('солдат: той самий вхід → той самий потік викликів', () => {
    const a = mockCtx();
    drawSoldierSprite(a.ctx, soldier({ selected: true, overwatch: true }));
    const b = mockCtx();
    drawSoldierSprite(b.ctx, soldier({ selected: true, overwatch: true }));
    expect(a.calls).toEqual(b.calls);
  });

  it('прибульчик: той самий вхід → той самий потік викликів', () => {
    const a = mockCtx();
    drawAlienSprite(a.ctx, alien());
    const b = mockCtx();
    drawAlienSprite(b.ctx, alien());
    expect(a.calls).toEqual(b.calls);
  });
});

describe('спрайти геосцени (піксель-арт П6.12)', () => {
  it('вузол-маяк «Рубіж» (П12.7, ADR-0064; П13.5 — 16×16): 16×16 @2× = 32px вище центру, неоновий маяк; підпису «ВУЗОЛ» нема (фідбек власника 2026-10-23)', () => {
    const rf = rasterFactory();
    initPixelSprites(rf.make);
    const { ctx, calls } = mockCtx();
    drawBaseSprite(ctx, { cx: 22, cy: 22, size: 44 }); // GCELL 44 (П13.5)
    const d = calls.find((c) => c.m === 'drawImage');
    expect(d).toBeDefined();
    expect((d!.args as number[])[1]).toBe(22 - 16); // Math.round(cx - 32/2)
    expect((d!.args as number[])[2]).toBe(22 - 6 - 16); // спрайт зміщено вгору
    expect((d!.args as number[])[3]).toBe(32);
    expect((d!.args as number[])[4]).toBe(32);
    // фідбек власника 2026-10-23: текстовий підпис на геосцені прибрано
    expect(calls.some((c) => c.m === 'fillText')).toBe(false);
    // неоновий маяк-вогонь на вершині вежі (ціан «Рубіжу»)
    expect(rf.canvases[0].pixels.some((p) => p.color === '#00e5ff')).toBe(true);
  });

  it('НЛО: три види — три різні матриці; приземлений залитий, «розвідник» — порожній ромб', () => {
    const rf = rasterFactory();
    initPixelSprites(rf.make);
    const imgs: unknown[] = [];
    for (const u of [
      { cx: 18, cy: 18, landed: true, kind: 'розвідник' as const },
      { cx: 18, cy: 18, landed: false, kind: 'розвідник' as const },
      { cx: 18, cy: 18, landed: false, kind: 'збирач' as const },
    ]) {
      const s = mockCtx();
      drawUfoSprite(s.ctx, u);
      imgs.push(s.calls.find((c) => c.m === 'drawImage')!.args[0]);
    }
    expect(new Set(imgs).size).toBe(3);
    expect(rf.canvases[0].pixels.length).toBeGreaterThan(30); // тарілка залита
    expect(rf.canvases[1].pixels.length).toBeLessThan(rf.canvases[0].pixels.length); // ромб — контур
  });
});

// Мок контексту для анімаційних кадрів: методи записуються у calls,
// присвоєння властивостей (globalAlpha, strokeStyle...) — у sets.
function animCtx(): { ctx: CanvasRenderingContext2D; calls: Call[]; sets: { p: string; v: unknown }[] } {
  const calls: Call[] = [];
  const sets: { p: string; v: unknown }[] = [];
  const rec =
    (m: string) =>
    (...args: unknown[]): void => {
      calls.push({ m, args });
    };
  const ctx = new Proxy(
    {},
    {
      get: (_t, p) => (typeof p === 'string' ? rec(p) : undefined),
      set: (_t, p, v) => {
        sets.push({ p: String(p), v });
        return true;
      },
    }
  );
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, sets };
}

// --- П6.9 (ADR-0029): мінімальний арт геосцени — м'які позначки НЛО, пульс радара ---

describe('П6.9: м’які позначки НЛО геосцени', () => {
  it('м’якість: alpha 0.85 на час малювання і відновлення до 1 (усі три види)', () => {
    for (const u of [
      { cx: 18, cy: 18, landed: true, kind: 'розвідник' as const },
      { cx: 18, cy: 18, landed: false, kind: 'розвідник' as const },
      { cx: 18, cy: 18, landed: false, kind: 'збирач' as const },
    ]) {
      const s = animCtx();
      drawUfoSprite(s.ctx, u);
      const alphas = s.sets.filter((p) => p.p === 'globalAlpha').map((p) => p.v);
      expect(alphas[0]).toBeCloseTo(0.85);
      expect(alphas[alphas.length - 1]).toBe(1);
    }
  });

  it('позначка в межах клітинки 44px (урок П6.6; П13.5): 12×12 у масштабі 2× → 24px', () => {
    const { ctx, calls } = mockCtx();
    drawUfoSprite(ctx, { cx: 22, cy: 22, landed: true, kind: 'збирач' });
    const e = extent(calls);
    expect(e.maxX - e.minX).toBeLessThanOrEqual(24);
    expect(e.maxY - e.minY).toBeLessThanOrEqual(24);
  });
});
// --- П6.13 (П12.7, ADR-0064): неонова палітра бойовища — терен, сітка, туман ---

// --- П6.13 (П12.7, ADR-0064): неонова палітра бойовища — терен, сітка, туман ---

// Сімейства відтінків терену (двотоновий терен × видимо/туман, П12.7 —
// синьо-чорна гама) — стабільні константи палітри render.ts; варіація в
// межах сімейства — за хешем клітинки.
const OPEN = ['#0b1220', '#0d1424', '#0a1120', '#0c1322'];
const BLOCKED = ['#2b3a55', '#30405e', '#27354e', '#2e3d5a'];
const OPEN_FOG = ['#05080f', '#060a12', '#04070d', '#050911'];
const BLOCKED_FOG = ['#1a2233', '#1d2537', '#182030', '#1c2435'];
const FOG_EDGE = 'rgba(11,18,32,0.4)';
const GRID_COLOR = 'rgba(0,229,255,0.08)';

// Мок контексту з ЄДИНИМ журналом операцій (присвоєння властивостей і виклики
// методів у порядку виконання) — колір кожної заливки визначається точно.
type Op = { set: string; v: unknown } | { m: string; args: unknown[] };
function seqCtx(): { ctx: CanvasRenderingContext2D; ops: Op[] } {
  const ops: Op[] = [];
  const rec =
    (m: string) =>
    (...args: unknown[]): void => {
      ops.push({ m, args });
    };
  const ctx = new Proxy(
    {},
    {
      get: (_t, p) => (typeof p === 'string' ? rec(p) : undefined),
      set: (_t, p, v) => {
        ops.push({ set: String(p), v });
        return true;
      },
    }
  );
  return { ctx: ctx as unknown as CanvasRenderingContext2D, ops };
}

// Кольори заливок клітинки (cx, cy) у порядку малювання (терен, потім край туману).
// Розмір rect строго (cell−1)×(cell−1) — фон (0,0,w,h) і лінії сітки 1px не рахуються.
function cellFills(ops: Op[], cx: number, cy: number, cell: number): string[] {
  const colors: string[] = [];
  let cur = '';
  for (const op of ops) {
    if ('set' in op && op.set === 'fillStyle') cur = op.v as string;
    if (
      'm' in op &&
      op.m === 'fillRect' &&
      op.args[0] === cx * cell &&
      op.args[1] === cy * cell &&
      op.args[2] === cell - 1 &&
      op.args[3] === cell - 1
    ) {
      colors.push(cur);
    }
  }
  return colors;
}

// Сітка клітинок терену: open — видима відкрита, fog — туман, wall — завалення.
function grid(w: number, h: number, kind: 'open' | 'fog' | 'wall' = 'open'): TerrainCell[] {
  const cells: TerrainCell[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      cells.push({ x, y, blocked: kind === 'wall', visible: kind !== 'fog' });
    }
  }
  return cells;
}

describe('П6.13: нічна палітра — терен і фон', () => {
  it('перший кадр — фон NIGHT_BG на весь buffer (тряска оголяє край того самого кольору)', () => {
    const s = seqCtx();
    drawNightTerrain(s.ctx, 520, 520, [], 26);
    expect(s.ops[0]).toEqual({ set: 'fillStyle', v: NIGHT_BG });
    expect(s.ops[1]).toEqual({ m: 'fillRect', args: [0, 0, 520, 520] });
  });

  it('Т.161: NIGHT_BG — той самий колір, що CSS-тло канви в index.html (тряска оголяє край)', () => {
    const m = /canvas \{[^}]*background: (#[0-9a-f]{6});/.exec(htmlRaw);
    expect(m?.[1]).toBe(NIGHT_BG);
  });

  it('клітинки малюються зі стороною cell−1 (проміжок — під сітку, урок П6.6)', () => {
    const s = seqCtx();
    drawNightTerrain(s.ctx, 52, 52, grid(2, 2), 26);
    expect(s.ops.some((o) => 'm' in o && o.m === 'fillRect' && o.args.join(',') === [0, 0, 25, 25].join(','))).toBe(true);
  });

  it('двотоновий терен: сімейства кольорів відкритий/завалений × видимо/туман', () => {
    const mk = (cells: TerrainCell[]): Op[] => {
      const s = seqCtx();
      drawNightTerrain(s.ctx, 520, 520, cells, 26);
      return s.ops;
    };
    expect(cellFills(mk(grid(20, 20, 'open')), 5, 5, 26)[0]).toBe(OPEN[cellHash(5, 5) % 4]);
    expect(cellFills(mk(grid(20, 20, 'wall')), 5, 5, 26)[0]).toBe(BLOCKED[cellHash(5, 5) % 4]);
    expect(cellFills(mk(grid(20, 20, 'fog')), 5, 5, 26)[0]).toBe(OPEN_FOG[cellHash(5, 5) % 4]);
    const wallFog = grid(20, 20, 'fog').map((c) => ({ ...c, blocked: true }));
    expect(cellFills(mk(wallFog), 5, 5, 26)[0]).toBe(BLOCKED_FOG[cellHash(5, 5) % 4]);
    // тони різні: завалення світліше відкритого, туман темніше видимого
    expect(BLOCKED[0]).not.toBe(OPEN[0]);
    expect(OPEN_FOG[0]).not.toBe(OPEN[0]);
  });

  it('варіація клітинок — детермінований хеш (без RNG): більше одного відтінку на сітці 20×20', () => {
    const s = seqCtx();
    drawNightTerrain(s.ctx, 520, 520, grid(20, 20, 'open'), 26);
    const shades = new Set<string>();
    for (const o of s.ops) {
      if ('set' in o && o.set === 'fillStyle' && OPEN.includes(o.v as string)) shades.add(o.v as string);
    }
    expect(shades.size).toBeGreaterThanOrEqual(2);
    // cellHash: стабільний і розрізнює координати
    expect(cellHash(5, 5)).toBe(cellHash(5, 5));
    expect(cellHash(5, 5)).not.toBe(cellHash(6, 5));
  });

  it('Т.44: фолбек без ассетів — межа зору є, знебарвлення і штриха немає', () => {
    const cells = grid(3, 3, 'fog');
    cells[4] = { x: 1, y: 1, blocked: false, visible: true }; // центр видимий
    const s = seqCtx();
    drawNightTerrain(s.ctx, 78, 78, cells, 26);
    expect(s.ops.some((o) => 'set' in o && o.set === 'globalCompositeOperation')).toBe(false);
    expect(s.ops.some((o) => 'set' in o && o.set === 'strokeStyle' && o.v === 'rgba(150,170,190,0.16)')).toBe(false);
    const border = s.ops.findIndex((o) => 'set' in o && o.set === 'strokeStyle' && o.v === 'rgba(125,215,255,0.6)');
    expect(border).toBeGreaterThan(-1);
    // чотири сторони видимої клітинки (1,1), клітинка 26 px
    expect(s.ops.slice(border).filter((o) => 'm' in o && o.m === 'moveTo').length).toBe(4);
    expect(s.ops.slice(border).filter((o) => 'm' in o && o.m === 'lineTo').length).toBe(4);
  });

  it('детермінізм (ADR-0003): той самий терен → той самий потік операцій', () => {
    const cells = grid(4, 4, 'open').concat(grid(4, 4, 'fog'));
    const a = seqCtx();
    drawNightTerrain(a.ctx, 104, 208, cells, 26);
    const b = seqCtx();
    drawNightTerrain(b.ctx, 104, 208, cells, 26);
    expect(a.ops).toEqual(b.ops);
  });
});

describe('П6.13: м’які краї туману і тонка сітка (критерій: туман не відкривається)', () => {
  it('клітинка туману з видимим сусідом (4 напрямки) — друге перекриття FOG_EDGE; діагональний сусід — без', () => {
    const cells = grid(3, 3, 'fog');
    cells[4] = { x: 1, y: 1, blocked: false, visible: true }; // центр видимий
    const s = seqCtx();
    drawNightTerrain(s.ctx, 78, 78, cells, 26);
    // сусід по прямій: терен + перекриття
    expect(cellFills(s.ops, 0, 1, 26)).toEqual([OPEN_FOG[cellHash(0, 1) % 4], FOG_EDGE]);
    expect(cellFills(s.ops, 1, 0, 26)).toEqual([OPEN_FOG[cellHash(1, 0) % 4], FOG_EDGE]);
    // кут (0,0) — лише діагональний сусід: перекриття нема, вміст не підсвічений
    expect(cellFills(s.ops, 0, 0, 26)).toEqual([OPEN_FOG[cellHash(0, 0) % 4]]);
    // видима клітинка — лише терен
    expect(cellFills(s.ops, 1, 1, 26)).toEqual([OPEN[cellHash(1, 1) % 4]]);
  });

  it('тонка напівпрозора сітка: 1px у проміжках між клітинками, GRID_COLOR', () => {
    const s = seqCtx();
    drawNightTerrain(s.ctx, 52, 52, grid(2, 2), 26);
    const lines = s.ops.filter((o) => 'm' in o && o.m === 'fillRect' && (o.args[2] === 1 || o.args[3] === 1));
    // 2×2: один стовпець і один рядок проміжків
    expect(lines.length).toBe(2);
    expect(lines.some((o) => 'm' in o && o.m === 'fillRect' && o.args.join(',') === [25, 0, 1, 52].join(','))).toBe(true);
    expect(lines.some((o) => 'm' in o && o.m === 'fillRect' && o.args.join(',') === [0, 25, 52, 1].join(','))).toBe(true);
    expect(s.ops.some((o) => 'set' in o && o.set === 'fillStyle' && o.v === GRID_COLOR)).toBe(true);
  });
});

// --- П12.7 (ADR-0064): терен геосцени — двотоновий із неоновою сіткою ---

describe('П12.7/П14.5: терен геосцени — фолбек (без ассета): фіксований розклад двома тонами', () => {
  const GCELL = 36; // клітинка геосцени (менша за GCELL 48 — математика не залежить)
  const layout = GEO_LAND_ROWS;

  it('перший кадр — фон NIGHT_BG; клітинки — суша/океан двома тонами ЗА РОЗКЛАДОМ', () => {
    const s = seqCtx();
    drawGeoTerrain(s.ctx, 576, 288, GCELL);
    expect(s.ops[0]).toEqual({ set: 'fillStyle', v: NIGHT_BG });
    expect(s.ops[1]).toEqual({ m: 'fillRect', args: [0, 0, 576, 288] });
    // тон клітинки — за фіксованим розкладом (той самий, що й з ассетом; без RNG)
    for (const [x, y] of [
      [8, 4],
      [3, 3],
      [0, 0],
    ]) {
      const tone = s.ops.find((o) => 'm' in o && o.m === 'fillRect' && o.args.join(',') === [x * GCELL, y * GCELL, GCELL, GCELL].join(','));
      expect(tone, `(${x},${y})`).toBeDefined();
      expect(s.ops[s.ops.indexOf(tone!) - 1]).toEqual({
        set: 'fillStyle',
        v: geoIsLand(layout, x, y) ? GEO_CELL_B : GEO_CELL_A,
      });
    }
  });

  it('двотоновий: заливки лише фоном і тонами суші/океану; неонова сітка GEO_GRID_COLOR', () => {
    const s = seqCtx();
    drawGeoTerrain(s.ctx, 576, 288, GCELL);
    const fills = s.ops.filter((o) => 'set' in o && o.set === 'fillStyle').map((o) => (o as { v: unknown }).v);
    expect(fills.every((c) => c === NIGHT_BG || c === GEO_CELL_A || c === GEO_CELL_B)).toBe(true);
    expect(fills).toContain(GEO_CELL_B); // сушя є
    expect(fills).toContain(GEO_CELL_A); // океан є
    // сітка: стовпці і рядки лініями, колір — неоновий ціан (ADR-0064)
    expect(s.ops.some((o) => 'set' in o && o.set === 'strokeStyle' && o.v === GEO_GRID_COLOR)).toBe(true);
    const lines = s.ops.filter((o) => 'm' in o && o.m === 'lineTo');
    expect(lines.length).toBeGreaterThanOrEqual(16 + 8); // стовпці 0..16 і рядки 0..8
  });

  it('детермінізм (ADR-0003): той самий вхід → той самий потік операцій (фіксована мапа без сіда)', () => {
    const a = seqCtx();
    drawGeoTerrain(a.ctx, 576, 288, GCELL);
    const b = seqCtx();
    drawGeoTerrain(b.ctx, 576, 288, GCELL);
    expect(a.ops).toEqual(b.ops);
  });
});

describe('П6.14: рамка валідної цілі (drawTargetFrame)', () => {
  it('пунктирна неонова рамка строго в межах клітинки; dash скидається save/restore', () => {
    const s = seqCtx();
    drawTargetFrame(s.ctx, { gx: 4, gy: 7, cell: 26 });
    const dash = s.ops.find((o) => 'm' in o && o.m === 'setLineDash');
    expect(dash).toEqual({ m: 'setLineDash', args: [[4, 3]] });
    expect(s.ops.some((o) => 'set' in o && o.set === 'strokeStyle' && o.v === TARGET_FRAME_COLOR)).toBe(true);
    expect(s.ops).toContainEqual({ m: 'strokeRect', args: [4 * 26 + 2, 7 * 26 + 2, 22, 22] });
    expect(s.ops[0]).toEqual({ m: 'save', args: [] });
    expect(s.ops[s.ops.length - 1]).toEqual({ m: 'restore', args: [] });
  });

  it('детермінізм: той самий вхід → той самий потік операцій (ADR-0003)', () => {
    const a = seqCtx();
    const b = seqCtx();
    drawTargetFrame(a.ctx, { gx: 0, gy: 19, cell: 26 });
    drawTargetFrame(b.ctx, { gx: 0, gy: 19, cell: 26 });
    expect(a.ops).toEqual(b.ops);
  });
});

describe('П6.14: шанс попадання біля клітинки (drawChanceLabel)', () => {
  it('плашка над клітинкою: темний фон, неоновий текст ~NN%, зверху зліва', () => {
    const s = seqCtx();
    drawChanceLabel(s.ctx, { gx: 4, gy: 7, cell: 26, cw: 520, text: '~62%' });
    const w = 4 * 6 + 4; // 4 символи × 6px + рамка
    expect(s.ops).toContainEqual({ m: 'fillRect', args: [4 * 26 + 1, 7 * 26 - 14, w, 13] });
    expect(s.ops).toContainEqual({ m: 'fillText', args: ['~62%', 4 * 26 + 3, 7 * 26 - 12] });
    const fills = s.ops.filter((o) => 'set' in o && o.set === 'fillStyle').map((o) => (o as { v: unknown }).v);
    expect(fills).toContain(CHANCE_LABEL_BG);
    expect(fills).toContain(CHANCE_LABEL_TEXT);
  });

  it('верхній рядок: плашка під клітинкою; правий край: не виходить за канву', () => {
    const s = seqCtx();
    drawChanceLabel(s.ctx, { gx: 19, gy: 0, cell: 26, cw: 520, text: '~62%' });
    const w = 4 * 6 + 4;
    const x = Math.min(19 * 26 + 1, 520 - w - 1);
    expect(s.ops).toContainEqual({ m: 'fillRect', args: [x, 26 + 1, w, 13] }); // під клітинкою (y=0)
    expect(x + w).toBeLessThanOrEqual(520);
  });
});

describe('П14.2/П14.3 (ADR-0072): атлас спрайтів юнітів — кадри за станом, фолбек', () => {
  // Мок-атлас: завантажувач кликає onLoad синхронно з фіктивним джерелом.
  const atlasImg = { width: 480, height: 192 } as unknown as CanvasImageSource;
  const readyAtlas = (): void => {
    initUnitAtlas((_url, onLoad) => {
      onLoad(atlasImg);
    });
  };

  it('прапорець завантаженості: фолбек до onload, готовий — після', () => {
    expect(isUnitAtlasReady()).toBe(false);
    readyAtlas();
    expect(isUnitAtlasReady()).toBe(true);
  });

  it('поза за станом юніта — чиста функція (без RNG, ADR-0003): idle/walk за кадром ядра, двокадрова ходьба (step, П14.3), вогонь і смерть мають пріоритет', () => {
    expect(unitPose({})).toBe('idle');
    expect(unitPose({ frame: 0 })).toBe('idle');
    expect(unitPose({ frame: 1 })).toBe('walk');
    expect(unitPose({ step: 1 })).toBe('walk');
    expect(unitPose({ step: 2 })).toBe('walk');
    expect(unitPose({ step: 2, pose: 'fire' })).toBe('fire');
    expect(unitPose({ frame: 1, pose: 'death' })).toBe('death');
  });

  it('атлас готовий: кадр 96×96 → 68×68 (Т.132), фігура в межах клітинки 48 по висоті, згладжування, за позою і стороною', () => {
    readyAtlas();
    const cases = [
      { side: 'player' as const, pose: undefined, col: ATLAS_POSE_COL.idle, row: 0 },
      { side: 'player' as const, pose: 'fire' as const, col: ATLAS_POSE_COL.fire, row: 0 },
      { side: 'player' as const, pose: 'death' as const, col: ATLAS_POSE_COL.death, row: 0 },
      { side: 'alien' as const, pose: undefined, col: ATLAS_POSE_COL.idle, row: 1 },
      { side: 'alien' as const, pose: 'fire' as const, col: ATLAS_POSE_COL.fire, row: 1 },
      { side: 'alien' as const, pose: 'death' as const, col: ATLAS_POSE_COL.death, row: 1 },
    ];
    for (const c of cases) {
      const s = animCtx();
      drawUnitSprite(s.ctx, { ...soldier(), side: c.side, pose: c.pose });
      const d = s.calls.find((call) => call.m === 'drawImage');
      expect(d, `side=${c.side} pose=${c.pose ?? 'idle'}`).toBeDefined();
      const a = d!.args as number[];
      expect(a[0]).toBe(atlasImg); // джерело — атлас
      expect(a[1]).toBe(c.col * ATLAS_FRAME); // колонка кадру
      expect(a[2]).toBe(c.row * ATLAS_FRAME); // рядок: 0 — оперативник, 1 — демон Розриву
      expect(a[3]).toBe(ATLAS_FRAME);
      expect(a[4]).toBe(ATLAS_FRAME);
      expect(a[5]).toBe(CX - ATLAS_UNIT / 2); // Math.round(24 − 34) = −10
      expect(a[6]).toBe(Math.round(CY + UNIT_FEET_DY - (ATLAS_UNIT * ATLAS_FEET_ROW) / ATLAS_FRAME)); // −23
      expect(a[7]).toBe(ATLAS_UNIT); // 68 × 68 (Т.132, ADR-0121)
      expect(a[8]).toBe(ATLAS_UNIT);
      // фігура кадру — рядки 34..93 атласа (прозорі поля зверху): у межах клітинки по висоті
      expect(a[6] + (34 * ATLAS_UNIT) / ATLAS_FRAME).toBeGreaterThanOrEqual(0);
      expect(a[6] + (ATLAS_FEET_ROW * ATLAS_UNIT) / ATLAS_FRAME).toBeLessThanOrEqual(CELL);
      expect(s.sets.some((x) => x.p === 'imageSmoothingEnabled' && x.v === true)).toBe(true); // масштаб 68/96 не цілий
    }
  });

  it('двокадрова ходьба (П14.3): step 1 → walk1 (кол. 1), step 2 → walk2 (кол. 2); кадр ядра — walk1', () => {
    readyAtlas();
    const w1 = animCtx();
    drawUnitSprite(w1.ctx, soldier({ step: 1 }));
    const w2 = animCtx();
    drawUnitSprite(w2.ctx, soldier({ step: 2 }));
    const core = animCtx();
    drawUnitSprite(core.ctx, soldier({ frame: 1 }));
    expect((w1.calls.find((c) => c.m === 'drawImage')!.args as number[])[1]).toBe(ATLAS_POSE_COL.walk * ATLAS_FRAME);
    expect((w2.calls.find((c) => c.m === 'drawImage')!.args as number[])[1]).toBe(ATLAS_WALK2_COL * ATLAS_FRAME);
    expect((core.calls.find((c) => c.m === 'drawImage')!.args as number[])[1]).toBe(ATLAS_POSE_COL.walk * ATLAS_FRAME);
  });

  it('фліп за напрямком (П14.3): flip — дзеркало scale(-1,1) навколо центру кадру; без flip — без дзеркала', () => {
    readyAtlas();
    const fl = animCtx();
    drawUnitSprite(fl.ctx, soldier({ flip: true }));
    expect(fl.calls.some((c) => c.m === 'scale' && (c.args as number[])[0] === -1)).toBe(true);
    const first = fl.calls.findIndex((c) => c.m === 'save');
    const last = fl.calls.findIndex((c) => c.m === 'restore');
    expect(first).toBeGreaterThanOrEqual(0);
    expect(last).toBeGreaterThan(first);
    const trans = fl.calls.filter((c) => c.m === 'translate').map((c) => c.args as number[]);
    expect(trans).toContainEqual([CX, CY]); // дзеркало навколо центру кадру
    expect((fl.calls.find((c) => c.m === 'drawImage')!.args as number[])[5]).toBe(CX - ATLAS_UNIT / 2);
    const plain = animCtx();
    drawUnitSprite(plain.ctx, soldier());
    expect(plain.calls.some((c) => c.m === 'scale')).toBe(false);
  });

  it('Т.132: віддача зсуває кадр назад від погляду (солдат — ліворуч, демон — праворуч, дзеркало — навпаки)', () => {
    readyAtlas();
    // лівий край кадру НА ЕКРАНІ: у дзеркалі (scale(-1,1) навколо CX) — 2·CX − (x + 68)
    const left = (u: Parameters<typeof soldier>[0]): number => {
      const s = animCtx();
      drawUnitSprite(s.ctx, soldier(u));
      const x = (s.calls.find((c) => c.m === 'drawImage')!.args as number[])[5]!;
      return u?.flip === true ? 2 * CX - (x + ATLAS_UNIT) : x;
    };
    const base = CX - ATLAS_UNIT / 2;
    // назад від погляду: солдат праворуч → ліворуч; демон ліворуч → праворуч; дзеркало — навпаки
    for (const [u, back] of [
      [{ side: 'player' as const }, -3],
      [{ side: 'alien' as const }, 3],
      [{ side: 'player' as const, flip: true }, 3],
      [{ side: 'alien' as const, flip: true }, -3],
    ] as const) {
      expect(left({ ...u, pose: 'fire', recoil: 3 }) - left({ ...u, pose: 'fire' }), JSON.stringify(u)).toBe(back);
      // кадр і дуло (muzzlePoint) зсуваються однаково
      const flip = 'flip' in u && u.flip === true;
      expect(muzzlePoint(u.side, flip, CX, CY, 3).x - muzzlePoint(u.side, flip, CX, CY, 0).x).toBe(back);
    }
    expect(left({ pose: 'fire' })).toBe(base);
  });

  it('Т.132: у позі «вогонь» плашки числа HP немає (не накриває ствол), смуга HP лишається', () => {
    readyAtlas();
    const s = animCtx();
    drawUnitSprite(s.ctx, soldier({ pose: 'fire', hp: 7 }));
    expect(s.calls.some((c) => c.m === 'fillText')).toBe(false);
    expect(s.calls.some((c) => c.m === 'fillRect' && (c.args as number[])[3] === HP_BAR_H)).toBe(true);
  });

  it('Т.132: дихання — стискання по висоті від низу кадру лише в позі «стій»', () => {
    readyAtlas();
    const idle = animCtx();
    drawUnitSprite(idle.ctx, soldier({ breath: 1 }));
    const sc = idle.calls.find((c) => c.m === 'scale')!.args as number[];
    expect(sc[0]).toBe(1);
    expect(sc[1]).toBeCloseTo(1 - BREATH_SCALE, 6);
    const img = idle.calls.find((c) => c.m === 'drawImage')!.args as number[];
    expect(idle.calls.find((c) => c.m === 'translate')!.args).toEqual([0, img[6]! + ATLAS_UNIT]); // опора — низ кадру
    for (const u of [{ breath: 1, pose: 'fire' as const }, { breath: 1, step: 1 as const }, { breath: 0 }]) {
      const s = animCtx();
      drawUnitSprite(s.ctx, soldier(u));
      expect(s.calls.some((c) => c.m === 'scale')).toBe(false);
    }
  });

  it('Т.132: тінь — два еліпси під ногами до кільця; загиблому тіні немає', () => {
    const { ctx, calls } = mockCtx();
    drawSoldierSprite(ctx, soldier({ ring: FIGHTER_COLORS[0] }));
    const el = calls.filter((c) => c.m === 'ellipse').map((c) => c.args as number[]);
    expect(el).toHaveLength(3);
    expect(el[0]!.slice(0, 4)).toEqual([CX, CY + RING_DY, RING_RX + 3, RING_RY + 1]);
    expect(el[2]![2]).toBe(RING_RX); // кільце — після тіні
    expect(RING_DY + RING_RY + 1).toBeLessThanOrEqual(CELL / 2); // тінь у межах клітинки
    const dead = mockCtx();
    drawSoldierSprite(dead.ctx, soldier({ hp: 0 }));
    expect(dead.calls.some((c) => c.m === 'ellipse')).toBe(false);
  });

  it('фолбек при !loaded: матриці ADR-0031 (drawImage з offscreen-канваса, 5 аргументів), маркери на місці', () => {
    const rf = rasterFactory();
    initPixelSprites(rf.make);
    expect(isUnitAtlasReady()).toBe(false); // атлас не завантажився — headless/офлайн
    const { ctx, calls } = mockCtx();
    drawUnitSprite(ctx, soldier({ hp: 7, selected: true, overwatch: true }));
    const d = calls.find((c) => c.m === 'drawImage');
    expect(d).toBeDefined();
    expect(d!.args[0]).toBe(rf.canvases[0]); // розгорнута матриця, не атлас
    expect(d!.args).toHaveLength(5); // (img, x, y, w, h) — растрова гілка
    expect(calls.some((c) => c.m === 'fillText' && c.args[0] === '7')).toBe(true); // HP читається
    expect(rf.canvases.length).toBeGreaterThan(0);
  });

  it('детермінізм: той самий вхід → той самий кадр атласа (без RNG)', () => {
    readyAtlas();
    const a = animCtx();
    const b = animCtx();
    drawUnitSprite(a.ctx, soldier({ frame: 1, pose: 'fire' }));
    drawUnitSprite(b.ctx, soldier({ frame: 1, pose: 'fire' }));
    expect(a.calls).toEqual(b.calls);
  });
});

// --- Позафазна лінія «візуальні порівняння» (кандидат «Мегаполіс», крок 2,
// ADR-0072): цілісна підлога + згенеровані стіна і декори ---

describe('позафазна лінія «Мегаполіс»: цілісна підлога cover, стіна, декори', () => {
  // Мок-ассети: завантажувачі кличуть onLoad синхронно з фіктивними джерелами
  // (фон 1024×1024 — як ассет; атлас 192×48 — 4 тайли 48).
  const bgImg = { width: 1024, height: 1024 } as unknown as CanvasImageSource;
  const tilesImg = { width: 192, height: 48 } as unknown as CanvasImageSource;
  const readyMetro = (): void => {
    initMetroMap((_url, onLoad) => {
      onLoad(bgImg);
    });
    initMetroTiles((_url, onLoad) => {
      onLoad(tilesImg);
    });
  };
  // Клітинки сітки 3×2: усі видимі, (1,1) — завалена (стіна).
  const cells: TerrainCell[] = [
    { x: 0, y: 0, blocked: false, visible: true },
    { x: 1, y: 0, blocked: false, visible: true },
    { x: 2, y: 0, blocked: false, visible: true },
    { x: 0, y: 1, blocked: false, visible: true },
    { x: 1, y: 1, blocked: true, visible: true },
    { x: 2, y: 1, blocked: false, visible: true },
  ];
  const tileDraws = (ops: Op[]): Array<{ img: unknown; col: number; x: number; y: number }> =>
    ops
      .filter((o): o is { m: string; args: unknown[] } => 'm' in o && o.m === 'drawImage')
      .map((o) => ({
        img: o.args[0],
        col: (o.args[1] as number) / METRO_TILE,
        x: o.args[5] as number,
        y: o.args[6] as number,
      }));

  it('прапорець завантаженості: фолбек до onload, готовий — після (потрібні ОБИДВА ассети)', () => {
    expect(isMetroTerrainReady()).toBe(false);
    initMetroMap((_url, onLoad) => {
      onLoad(bgImg);
    }); // лише фон — терен ще у фолбеку (без стін не читається)
    expect(isMetroTerrainReady()).toBe(false);
    readyMetro();
    expect(isMetroTerrainReady()).toBe(true);
  });

  it('підлога — ОДНА цілісна картина cover на весь buffer (без розкладу тайлів); фото — згладжування', () => {
    readyMetro();
    const s = seqCtx();
    drawNightTerrain(s.ctx, 144, 96, cells, 48);
    const imgs = s.ops.filter((o): o is { m: string; args: unknown[] } => 'm' in o && o.m === 'drawImage');
    // фон + стіна + декори за хешем (у сітці 3×2 одна клітинка з декором) — жодних тайлів підлоги
    const decors = cells.filter((c) => !c.blocked && decorCol(c.x, c.y) !== null).length;
    expect(imgs.length).toBe(1 + 1 + decors);
    // перший кадр — фон: cover 1024→144 (масштаб 0.140625), dh=144>96 — центр у центрі канви
    const bg = imgs[0]!;
    expect(bg.args[0]).toBe(bgImg);
    expect(bg.args[1]).toBe(0); // (144−144)/2
    expect(bg.args[2]).toBe(-24); // (96−144)/2
    expect(bg.args[3]).toBe(144);
    expect(bg.args[4]).toBe(144);
    // фото-фон — згладжування; піксель-арт атлас об'єктів — nearest-neighbor (по одному разу)
    expect(s.ops.filter((o) => 'set' in o && o.set === 'imageSmoothingEnabled' && o.v === true).length).toBe(1);
    expect(s.ops.filter((o) => 'set' in o && o.set === 'imageSmoothingEnabled' && o.v === false).length).toBe(1);
  });

  it('стіна — за мапою (blocked), тайл кол. 0; декори — детермінований рідкий розклад decorCol (світло/решітка/уламки), лише на відкритих', () => {
    readyMetro();
    const s = seqCtx();
    drawNightTerrain(s.ctx, 144, 96, cells, 48);
    const draws = tileDraws(s.ops).filter((d) => d.img === tilesImg);
    // стіна кожній blocked + декори за хешем (у сітці 3×2 одна клітинка з декором)
    const decors = cells.filter((c) => !c.blocked && decorCol(c.x, c.y) !== null).length;
    expect(draws.length).toBe(1 + decors); // 1 стіна + декори
    const wall = draws.find((d) => d.x === 48 && d.y === 48); // (1,1) — blocked
    expect(wall).toBeDefined();
    expect(wall!.col).toBe(METRO_WALL_COL);
    expect(draws.some((d) => d.col === METRO_WALL_COL && d.x === 0 && d.y === 0)).toBe(false); // відкрита — не стіна
    // чиста функція decorCol: по одному представнику кожного типу на сітці 60×60
    const found = new Map<number, TerrainCell>();
    for (let y = 0; y < 60 && found.size < 3; y++) {
      for (let x = 0; x < 60 && found.size < 3; x++) {
        const d = decorCol(x, y);
        if (d !== null && !found.has(d)) found.set(d, { x, y, blocked: false, visible: true });
      }
    }
    expect([...found.keys()].sort()).toEqual([METRO_DECOR_COL['світло'], METRO_DECOR_COL['решітка'], METRO_DECOR_COL['уламки']].sort());
    for (const c of found.values()) expect(decorCol(c.x, c.y)).toBe(decorCol(c.x, c.y)); // стабільний (без RNG)
    // Т.44: колонки атласа — пляма світла 1, решітка 2, уламки 3; хеш % 37: 0 → світло, 1 → решітка, 2 → уламки
    expect(METRO_DECOR_COL).toEqual({ світло: 1, решітка: 2, уламки: 3 });
    for (const c of found.values()) expect(decorCol(c.x, c.y)).toBe((cellHash(c.x, c.y) % 37) + 1);
    // розклад рідкий: ~3/37 відкритих (~8%), три типи
    let dec = 0;
    const kinds = new Set<number>();
    for (let y = 0; y < 60; y++)
      for (let x = 0; x < 60; x++) {
        const d = decorCol(x, y);
        if (d !== null) {
          dec++;
          kinds.add(d);
        }
      }
    expect(dec / (60 * 60)).toBeGreaterThan(0.05);
    expect(dec / (60 * 60)).toBeLessThan(0.11);
    expect(kinds.size).toBe(3);
  });

  it('Т.146 (ADR-0127): сусідні стіни — чверті тайла стіни за wallQuads, одиночна — тайл цілком', () => {
    readyMetro();
    // 3×2: (0,0)+(1,0) — пара стін, (2,1) — одиночна (сусідка (1,0) лише по діагоналі)
    const joined: TerrainCell[] = [
      { x: 0, y: 0, blocked: true, visible: true },
      { x: 1, y: 0, blocked: true, visible: true },
      { x: 2, y: 0, blocked: false, visible: true },
      { x: 0, y: 1, blocked: false, visible: true },
      { x: 1, y: 1, blocked: false, visible: true },
      { x: 2, y: 1, blocked: true, visible: true },
    ];
    const s = seqCtx();
    drawNightTerrain(s.ctx, 144, 96, joined, 48);
    const walls = s.ops
      .filter((o): o is { m: string; args: unknown[] } => 'm' in o && o.m === 'drawImage' && o.args[0] === tilesImg)
      .map((o) => o.args.slice(1) as number[])
      .filter((a) => a[0]! < METRO_TILE); // кол. 0 атласа — стіна (декори — кол. 1–3)
    // пара: 4 + 4 чверті 24 × 24 на канві; одиночна — один тайл 48 × 48
    expect(walls).toHaveLength(9);
    const isWall = (x: number, y: number): boolean => (x === 0 || x === 1) && y === 0;
    const expectQuads = (cx: number, start: number): void => {
      const qs = wallQuads(isWall, cx, 0, METRO_TILE)!;
      qs.forEach((q, i) => expect(walls[start + i]).toEqual([q.sx, q.sy, q.sw, q.sh, (cx + q.dx) * 48, q.dy * 48, 24, 24]));
    };
    expectQuads(0, 0);
    expectQuads(1, 4);
    expect(walls[8]).toEqual([0, 0, 48, 48, 96, 48, 48, 48]);
    // шов пари: права чверть лівої стіни і ліва чверть правої — середина тайла (без бічної рамки)
    expect(walls[1]![0]).toBe(12);
    expect(walls[4]![0]).toBe(12);
  });

  it('туман: клітинки поза видимістю перекриваються чинним напівпрозорим шаром поверх фону (вміст не розкривається)', () => {
    readyMetro();
    const fogged = cells.map((c) => ({ ...c, visible: c.x === 0 })); // видимий лише стовпець x=0
    const s = seqCtx();
    drawNightTerrain(s.ctx, 144, 96, fogged, 48);
    const fogFills = s.ops.filter(
      (o): o is { m: string; args: unknown[] } => 'm' in o && o.m === 'fillRect' && o.args[2] === 48 && o.args[3] === 48
    );
    // 4 клітинки туману (з 6) × два шари (Т.44: знебарвлення, потім приглушення); фон 144×96 і край туману 47×47 не рахуються
    expect(fogFills.length).toBe(8);
    const before = s.ops.findIndex((o) => 'm' in o && o.m === 'drawImage');
    const fogStyle = s.ops.findIndex((o) => 'set' in o && o.set === 'fillStyle' && o.v === 'rgba(5,8,15,0.55)');
    expect(fogStyle).toBeGreaterThan(-1);
    expect(s.ops[fogStyle + 1]).toEqual({ m: 'fillRect', args: [48, 0, 48, 48] }); // перша клітинка туману (1,0)
    expect(fogStyle).toBeGreaterThan(before); // туман — ПОВЕРХ фону і об'єктів
  });

  it('Т.44: туман знебарвлено до приглушення — лише клітинки туману, режим накладання повертає restore', () => {
    readyMetro();
    const fogged = cells.map((c) => ({ ...c, visible: c.x === 0 }));
    const s = seqCtx();
    drawNightTerrain(s.ctx, 144, 96, fogged, 48);
    const sat = s.ops.findIndex((o) => 'set' in o && o.set === 'globalCompositeOperation');
    const fogStyle = s.ops.findIndex((o) => 'set' in o && o.set === 'fillStyle' && o.v === 'rgba(5,8,15,0.55)');
    expect(s.ops[sat]).toEqual({ set: 'globalCompositeOperation', v: 'saturation' });
    expect(s.ops[sat - 1]).toEqual({ m: 'save', args: [] });
    expect(s.ops[sat + 1]).toEqual({ set: 'fillStyle', v: '#808080' });
    // чотири клітинки туману (x = 1, 2) і одразу restore — видимий стовпець x = 0 не знебарвлюється
    const grey = s.ops.slice(sat + 2, sat + 6);
    expect(grey.map((o) => ('m' in o ? o.m : ''))).toEqual(['fillRect', 'fillRect', 'fillRect', 'fillRect']);
    expect(grey.every((o) => 'm' in o && (o.args[0] as number) >= 48)).toBe(true);
    expect(s.ops[sat + 6]).toEqual({ m: 'restore', args: [] });
    expect(sat + 6).toBeLessThan(fogStyle);
    expect(s.ops.filter((o) => 'set' in o && o.set === 'globalCompositeOperation').length).toBe(1);
  });

  it('Т.44: штрих туману — діагоналі кроком 8 px у межах клітинок туману; межа зору — відрізки fogBorderSegments', () => {
    readyMetro();
    const fogged = cells.map((c) => ({ ...c, visible: c.x === 0 }));
    const s = seqCtx();
    drawNightTerrain(s.ctx, 144, 96, fogged, 48);
    const hatch = s.ops.findIndex((o) => 'set' in o && o.set === 'strokeStyle' && o.v === 'rgba(150,170,190,0.16)');
    const border = s.ops.findIndex((o) => 'set' in o && o.set === 'strokeStyle' && o.v === 'rgba(125,215,255,0.6)');
    expect(hatch).toBeGreaterThan(-1);
    expect(border).toBeGreaterThan(hatch);
    const lines = (from: number, to: number): number[][] =>
      s.ops.slice(from, to).flatMap((o) => ('m' in o && (o.m === 'moveTo' || o.m === 'lineTo') ? [o.args as number[]] : []));
    const hatchPts = lines(hatch, border);
    expect(hatchPts.length).toBe(4 * 12 * 2); // 4 клітинки × 12 діагоналей (d = 0…88) × два кінці
    expect(hatchPts.every(([x, y]) => x! >= 48 && x! <= 144 && y! >= 0 && y! <= 96)).toBe(true); // видимий стовпець без штриха
    // кожна діагональ лежить в одній клітинці: обидва кінці — в межах тієї самої клітинки 48×48
    for (let i = 0; i < hatchPts.length; i += 2) {
      const [ax, ay] = hatchPts[i]!;
      const [bx, by] = hatchPts[i + 1]!;
      for (const [a, b] of [
        [ax!, bx!],
        [ay!, by!],
      ]) {
        const c = Math.floor((a! + b!) / 2 / 48);
        expect(Math.min(a!, b!)).toBeGreaterThanOrEqual(c * 48);
        expect(Math.max(a!, b!)).toBeLessThanOrEqual((c + 1) * 48);
      }
    }
    // межа: два відрізки між стовпцями x = 0 і x = 1 (рядки 0 і 1), товщина 2
    expect(fogBorderSegments(fogged).length).toBe(2);
    expect(lines(border, s.ops.length)).toEqual([
      [48, 0],
      [48, 48],
      [48, 48],
      [48, 96],
    ]);
    expect(s.ops[border + 1]).toEqual({ set: 'lineWidth', v: 2 });
    // стан контексту відновлено: штрих і межа — кожен у своїй парі save … restore, restore одразу після stroke
    const strokes = s.ops.flatMap((o, i) => ('m' in o && o.m === 'stroke' ? [i] : []));
    expect(strokes.length).toBe(2);
    for (const i of strokes) expect(s.ops[i + 1]).toEqual({ m: 'restore', args: [] });
    expect(s.ops[hatch - 1]).toEqual({ m: 'save', args: [] });
    expect(s.ops[border - 1]).toEqual({ m: 'save', args: [] });
    expect(s.ops.filter((o) => 'm' in o && o.m === 'save').length).toBe(s.ops.filter((o) => 'm' in o && o.m === 'restore').length);
    expect(strokes[1]! + 1).toBe(s.ops.length - 1); // межа — останній шар терену
    // межа — після м'якого краю туману
    const edge = s.ops.findIndex((o) => 'set' in o && o.set === 'fillStyle' && o.v === FOG_EDGE);
    expect(edge).toBeGreaterThan(hatch);
    expect(edge).toBeLessThan(border);
  });

  it("Т.119: зменшена канва (px = 4, телефон) — штрих 2,8 і крок 22 px buffer'а, межа 5,6; px = 1,4 (1366 × 768) — як Т.44", () => {
    readyMetro();
    const fogged = cells.map((c) => ({ ...c, visible: c.x === 0 }));
    const widths = (px?: number): { hatch: unknown; border: unknown; pts: number } => {
      const s = seqCtx();
      drawNightTerrain(s.ctx, 144, 96, fogged, 48, px);
      const hatch = s.ops.findIndex((o) => 'set' in o && o.set === 'strokeStyle' && o.v === 'rgba(150,170,190,0.16)');
      const border = s.ops.findIndex((o) => 'set' in o && o.set === 'strokeStyle' && o.v === 'rgba(125,215,255,0.6)');
      const pts = s.ops.slice(hatch, border).filter((o) => 'm' in o && (o.m === 'moveTo' || o.m === 'lineTo')).length;
      return { hatch: s.ops[hatch + 1], border: s.ops[border + 1], pts };
    };
    const phone = widths(4);
    expect(phone.hatch).toEqual({ set: 'lineWidth', v: 2.8 });
    expect(phone.pts).toBe(4 * 5 * 2); // d = 0, 22, 44, 66, 88
    expect(phone.border).toEqual({ set: 'lineWidth', v: 5.6 });
    // 0,7 CSS px штриха і 1,4 CSS px межі на 1366 × 768 (px ≈ 1,47) — ті самі числа, що без масштабу
    expect(widths(1.4)).toEqual(widths());
    expect(widths().hatch).toEqual({ set: 'lineWidth', v: 1 });
  });

  it('Т.44: без туману — ні штриха, ні межі', () => {
    readyMetro();
    const clear = seqCtx();
    drawNightTerrain(clear.ctx, 144, 96, cells, 48);
    expect(clear.ops.some((o) => 'set' in o && o.set === 'strokeStyle' && o.v === 'rgba(125,215,255,0.6)')).toBe(false);
    expect(clear.ops.some((o) => 'm' in o && o.m === 'moveTo')).toBe(false);
  });

  it('фолбек без ассетів — чинні два тони terrainShade (загальний випадок покривають тести П6.13)', () => {
    expect(isMetroTerrainReady()).toBe(false); // завантажувачі не кликнулися — headless/офлайн
    const s = seqCtx();
    drawNightTerrain(s.ctx, 144, 96, cells, 48);
    expect(s.ops.some((o) => 'm' in o && o.m === 'drawImage')).toBe(false); // картина і тайли не малюються
    expect(cellFills(s.ops, 0, 0, 48)[0]).toBe(terrainShade(0, 0, false, true)); // двотоновий фолбек
  });

  it('детермінізм (ADR-0003): той самий терен → той самий потік операцій', () => {
    readyMetro();
    const a = seqCtx();
    drawNightTerrain(a.ctx, 144, 96, cells, 48);
    const b = seqCtx();
    drawNightTerrain(b.ctx, 144, 96, cells, 48);
    expect(a.ops).toEqual(b.ops);
  });
});

// --- Позафазна лінія «візуальні порівняння» (кандидат А «нічний супутник»,
// 2026-10-22): геосцена — ОДНА цілісна картина світу (фон cover) ---
describe('позафазна лінія: фон геосцени — цілісна картина світу cover; розклад GEO_LAYOUT', () => {
  // Мок-карта: асети рантайму — кроп видимого вікна cover (1024×576, 16:9).
  const mapImg = { width: 1024, height: 576 } as unknown as CanvasImageSource;
  // Мок-спрайт бази: вежа-радар 96×95 (bbox сирця після flood-fill альфи).
  const towerImg = { width: 96, height: 95 } as unknown as CanvasImageSource;
  const readyMap = (): void => {
    initGeoMap((_url, onLoad) => {
      onLoad(mapImg);
    });
  };
  const readyTower = (): void => {
    initGeoTower((_url, onLoad) => {
      onLoad(towerImg);
    });
  };
  const CELL = 48; // GCELL
  const W = 768; // 16 × 48 — канва геосцени
  const H = 432; // 9 × 48

  it('прапорці готовності: фолбек до onload, готовий — після (карта і радар окремо)', () => {
    expect(isGeoMapReady()).toBe(false);
    expect(isGeoTowerReady()).toBe(false);
    readyMap();
    readyTower();
    expect(isGeoMapReady()).toBe(true);
    expect(isGeoTowerReady()).toBe(true);
  });

  it('фон: ОДИН drawImage cover на всю канву — карта без швів; згладжування увімкнене; сітка поверх', () => {
    readyMap();
    const s = animCtx();
    drawGeoTerrain(s.ctx, W, H, CELL);
    // підкладка фону (краї канви не блимають) + єдиний кадр картини
    expect(s.sets[0]).toEqual({ p: 'fillStyle', v: NIGHT_BG });
    const bg = s.calls.find((c) => c.m === 'fillRect');
    expect(bg?.args).toEqual([0, 0, W, H]);
    const imgs = s.calls.filter((c) => c.m === 'drawImage');
    expect(imgs.length).toBe(1); // цілісна картина — жодних тайлів/оверлеїв
    const a = imgs[0]!.args as unknown[];
    expect(a[0]).toBe(mapImg);
    expect(a[1]).toBe(0); // ассет 16:9 = канва — точне вписування, центри збігаються
    expect(a[2]).toBe(0);
    expect(a[3]).toBe(W);
    expect(a[4]).toBe(H);
    // фото-джерело — згладжування (не nearest-neighbor піксель-арту)
    expect(s.sets.some((x) => x.p === 'imageSmoothingEnabled' && x.v === true)).toBe(true);
    // неонова сітка поверх картини (читабельність клітинок)
    expect(s.sets.some((x) => x.p === 'strokeStyle' && x.v === GEO_GRID_COLOR)).toBe(true);
  });

  it('cover: джерело НЕ 16:9 — центр у центрі канви, без залишення смуг', () => {
    readyMap();
    const s = animCtx();
    drawGeoTerrain(s.ctx, 800, 432, CELL); // канва ширша за аспект ассета
    const a = s.calls.filter((c) => c.m === 'drawImage')[0]!.args as unknown[];
    // scale = max(800/1024, 432/576) = 0.78125: dw = 800, dh = 450, dy = -9
    expect(a[1]).toBe(0);
    expect(a[2]).toBe(-9);
    expect(a[3]).toBe(800);
    expect(a[4]).toBe(450);
  });

  it('вежа-радар на базі: кадр з ассету аспект-фітом, строго по центру клітинки, без підпису; фолбек — піксельний спрайт (ADR-0031)', () => {
    const b = { cx: 8 * CELL + CELL / 2, cy: 4 * CELL + CELL / 2, size: CELL };
    readyTower();
    const s = animCtx();
    drawGeoBaseSprite(s.ctx, b);
    const d = s.calls.find((c) => c.m === 'drawImage');
    expect(d).toBeDefined();
    const a = d!.args as unknown[];
    expect(a[0]).toBe(towerImg);
    // фіт у клітинку зі збереженням аспекта: scale = min(48/96, 48/95) = 0.5
    // фідбек власника 2026-10-23: вежа — по центру клітинки (звідки виходить
    // промінь радара); острів у скорегованій картині — саме там
    expect(a[1]).toBe(Math.round(b.cx - CELL / 2)); // центр клітинки бази по X
    expect(a[2]).toBe(Math.round(b.cy - CELL / 2)); // і по Y
    expect(a[3]).toBe(CELL);
    expect(a[4]).toBe(CELL);
    // фідбек власника 2026-10-23: підпис «ВУЗОЛ» прибрано — жодного тексту
    expect(s.calls.some((c) => c.m === 'fillText')).toBe(false);
    // фолбек: без ассета — піксельний спрайт ADR-0031 (джерело — offscreen, не ассет)
    initGeoTower(() => {}); // скидання у фолбек (завантажувач не кликається)
    const f = animCtx();
    drawGeoBaseSprite(f.ctx, b);
    const fd = f.calls.find((c) => c.m === 'drawImage');
    expect(fd).toBeDefined();
    expect((fd!.args as unknown[])[0]).not.toBe(towerImg);
    expect(f.calls.some((c) => c.m === 'fillText')).toBe(false);
  });

  it('детермінізм (ADR-0003): той самий вхід → той самий потік викликів і присвоєнь', () => {
    readyMap();
    const draw = (): { calls: Call[]; sets: { p: string; v: unknown }[] } => {
      const s = animCtx();
      drawGeoTerrain(s.ctx, W, H, CELL);
      return { calls: s.calls, sets: s.sets };
    };
    expect(draw()).toEqual(draw());
  });
});

describe('Т.44: drawReachZone — зона ходу (заливка і контур)', () => {
  const fillsOf = (ops: Op[]): Array<{ color: string; args: unknown[] }> => {
    const out: Array<{ color: string; args: unknown[] }> = [];
    let cur = '';
    for (const op of ops) {
      if ('set' in op && op.set === 'fillStyle') cur = op.v as string;
      if ('m' in op && op.m === 'fillRect') out.push({ color: cur, args: op.args });
    }
    return out;
  };
  const pts = (ops: Op[]): number[][] =>
    ops.flatMap((o) => ('m' in o && (o.m === 'moveTo' || o.m === 'lineTo') ? [o.args as number[]] : []));

  it('порожня зона — жодної операції (і контуру навколо оперативника немає)', () => {
    const s = seqCtx();
    drawReachZone(s.ctx, new Set(), { x: 2, y: 2 }, 48);
    expect(s.ops).toEqual([]);
  });

  it('заливка — кожна клітинка зони, без клітинки оперативника: (x·48+1, y·48+1, 46, 46), колір рішення власника', () => {
    const s = seqCtx();
    drawReachZone(s.ctx, new Set(['3,2', '1,2', '2,3']), { x: 2, y: 2 }, 48);
    expect(fillsOf(s.ops)).toEqual([
      { color: 'rgba(127,226,160,0.09)', args: [145, 97, 46, 46] },
      { color: 'rgba(127,226,160,0.09)', args: [49, 97, 46, 46] },
      { color: 'rgba(127,226,160,0.09)', args: [97, 145, 46, 46] },
    ]);
  });

  it('контур: один шлях кольором 0.75 товщиною 2 навколо зони разом з оперативником, без ліній між її клітинками, зсув 1 px усередину', () => {
    const s = seqCtx();
    const keys = new Set(['3,2', '1,2', '2,3']);
    drawReachZone(s.ctx, keys, { x: 2, y: 2 }, 48);
    expect(s.ops).toContainEqual({ set: 'strokeStyle', v: 'rgba(127,226,160,0.75)' });
    expect(s.ops).toContainEqual({ set: 'lineWidth', v: 2 });
    expect(s.ops.filter((o) => 'm' in o && o.m === 'beginPath')).toHaveLength(1);
    expect(s.ops.filter((o) => 'm' in o && o.m === 'stroke')).toHaveLength(1);
    const segs = zoneOutlineSegments(new Set([...keys, '2,2']));
    expect(segs).toHaveLength(10); // «Т» з чотирьох клітинок: 16 сторін − 3 спільні × 2
    const p = pts(s.ops);
    expect(p).toHaveLength(segs.length * 2);
    // жоден відрізок не лежить на межі клітинки (кратне 48) — усі зсунуті на 1 px усередину
    for (let i = 0; i < p.length; i += 2) {
      const [ax, ay] = p[i]!;
      const [bx, by] = p[i + 1]!;
      if (ax === bx) expect([1, 47]).toContain(ax! % 48);
      else expect([1, 47]).toContain(ay! % 48);
      expect(ax === bx || ay === by).toBe(true);
    }
    // увігнуті кути «Т» — під (1,2) і (3,2) біля ніжки (2,3): сторони ніжки x = 97 і x = 143 починаються на 2 px вище (y = 142)
    const legs = p.filter((_v, i) => i % 2 === 0 && p[i]![0] === p[i + 1]![0] && p[i + 1]![1] === 192).map(([x, y]) => [x, y]);
    expect(legs).toEqual([
      [143, 142],
      [97, 142],
    ]);
    // спільна сторона оперативника (2,2) і клітинки (3,2) — x = 144 у рядку 2 (y від 96 до 144): ліній на 143 і 145 там немає
    const inRow2 = (i: number): boolean => p[i]![0] === p[i + 1]![0] && Math.min(p[i]![1]!, p[i + 1]![1]!) === 96;
    expect(p.filter((_v, i) => i % 2 === 0 && inRow2(i)).map(([x]) => x)).toEqual([191, 49]);
    // стан контексту відновлено: save на початку, restore наприкінці
    expect(s.ops[0]).toEqual({ m: 'save', args: [] });
    expect(s.ops[s.ops.length - 1]).toEqual({ m: 'restore', args: [] });
  });
});

describe('Т.44: drawPathPreview — шлях лінією і ціна біля цілі', () => {
  const base = { from: { x: 5, y: 5 }, cell: 48, cw: 960 };
  const calls = (ops: Op[], m: string): unknown[][] => ops.flatMap((o) => ('m' in o && o.m === m ? [o.args] : []));
  const sets = (ops: Op[], k: string): unknown[] => ops.flatMap((o) => ('set' in o && o.set === k ? [o.v] : []));

  it('порожній шлях — жодної операції', () => {
    const s = seqCtx();
    drawPathPreview(s.ctx, { ...base, path: [], ap: 0, affordable: true });
    expect(s.ops).toEqual([]);
  });

  it('ламана від клітинки оперативника через центри клітинок шляху: товщина 4, круглі стики й кінці, один шлях', () => {
    const s = seqCtx();
    const path = [
      { x: 5, y: 4 },
      { x: 6, y: 4 },
      { x: 6, y: 3 },
    ];
    drawPathPreview(s.ctx, { ...base, path, ap: 3, affordable: true });
    expect(calls(s.ops, 'moveTo')).toEqual([[264, 264]]);
    expect(calls(s.ops, 'lineTo')).toEqual([
      [264, 216],
      [312, 216],
      [312, 168],
    ]);
    expect(calls(s.ops, 'stroke')).toHaveLength(1);
    expect(sets(s.ops, 'lineWidth')).toEqual([4, 1]); // лінія, потім рамка плашки
    expect(sets(s.ops, 'lineJoin')).toEqual(['round']);
    expect(sets(s.ops, 'lineCap')).toEqual(['round']);
    // у кінці — одне коло радіусом 7 у центрі цілі; крапок радіусом 3 немає
    expect(calls(s.ops, 'arc')).toEqual([[312, 168, 7, 0, Math.PI * 2]]);
    // два окремі шляхи: beginPath перед ламаною (контур зони до неї не домальовується) і перед колом
    // (заливка кола не зачіпає ламану)
    const names = s.ops.flatMap((o) => ('m' in o ? [o.m] : []));
    expect(names.slice(0, 3)).toEqual(['save', 'beginPath', 'moveTo']);
    expect(names.slice(names.indexOf('stroke'), names.indexOf('stroke') + 4)).toEqual(['stroke', 'beginPath', 'arc', 'fill']);
    expect(names.filter((n) => n === 'beginPath')).toHaveLength(2);
    // лінія — до кола і плашки
    const idx = (m: string): number => s.ops.findIndex((o) => 'm' in o && o.m === m);
    expect(idx('stroke')).toBeLessThan(idx('arc'));
    expect(idx('arc')).toBeLessThan(idx('fillRect'));
    expect(s.ops[0]).toEqual({ m: 'save', args: [] });
    expect(s.ops[s.ops.length - 1]).toEqual({ m: 'restore', args: [] });
  });

  it('плашка: текст «<число> AP» шрифтом bold 15px monospace по центру, фон і рамка 1 px кольором лінії', () => {
    const s = seqCtx();
    drawPathPreview(s.ctx, { ...base, path: [{ x: 5, y: 4 }], ap: 9, affordable: true });
    // «9 AP»: 4 знаки × 9 + 10 = 46 × 21, праворуч від цілі (5,4) — Т.119: (290, 206)
    expect(calls(s.ops, 'fillRect')).toEqual([[290, 206, 46, 21]]);
    expect(calls(s.ops, 'strokeRect')).toEqual([[290.5, 206.5, 45, 20]]);
    expect(calls(s.ops, 'fillText')).toEqual([['9 AP', 313, 217]]);
    expect(sets(s.ops, 'font')).toEqual(['bold 15px monospace']);
    expect(sets(s.ops, 'textAlign')).toEqual(['center']);
    expect(sets(s.ops, 'textBaseline')).toEqual(['middle']);
    expect(sets(s.ops, 'strokeStyle')).toEqual(['rgba(127,226,160,0.95)']);
    expect(sets(s.ops, 'fillStyle')).toEqual(['rgba(127,226,160,0.95)', 'rgba(6,10,20,0.9)', 'rgba(127,226,160,0.95)']);
  });

  it('AP не вистачає — лінія, коло, рамка і текст червоні; число — ціна шляху, а не довжина', () => {
    const s = seqCtx();
    drawPathPreview(s.ctx, { ...base, path: [{ x: 5, y: 4 }], ap: 12, affordable: false });
    expect(sets(s.ops, 'strokeStyle')).toEqual(['rgba(255,156,156,0.95)']);
    expect(sets(s.ops, 'fillStyle')).toEqual(['rgba(255,156,156,0.95)', 'rgba(6,10,20,0.9)', 'rgba(255,156,156,0.95)']);
    expect(calls(s.ops, 'fillText')[0]![0]).toBe('12 AP');
  });

  it('ціль у правому верхньому куті — плашка ліворуч від неї, у межах канви', () => {
    const s = seqCtx();
    drawPathPreview(s.ctx, { from: { x: 19, y: 1 }, path: [{ x: 19, y: 0 }], ap: 1, affordable: true, cell: 48, cw: 960 });
    expect(calls(s.ops, 'fillRect')).toEqual([[864, 14, 46, 21]]);
    expect(calls(s.ops, 'fillText')).toEqual([['1 AP', 887, 25]]);
  });

  it("Т.119: зменшена канва (px = 2,5 — iPad у меншому вікні) — текст 30 px buffer'а = 12 CSS px, лінія 5, коло 8,75", () => {
    const s = seqCtx();
    drawPathPreview(s.ctx, { ...base, path: [{ x: 5, y: 4 }], ap: 9, affordable: true, px: 2.5 });
    expect(sets(s.ops, 'font')).toEqual(['bold 30px monospace']);
    expect(sets(s.ops, 'lineWidth')).toEqual([5, 2]); // лінія 2 CSS px, рамка — 2 (k = 2)
    expect(calls(s.ops, 'arc')).toEqual([[264, 216, 8.75, 0, Math.PI * 2]]);
    // плашка ×2: 36 × 2 + 20 = 92 × 42, відступ 4
    expect(calls(s.ops, 'fillRect')).toEqual([[292, 195, 92, 42]]);
    expect(calls(s.ops, 'fillText')).toEqual([['9 AP', 338, 216.5]]);
  });

  it("Т.119: шрифт округлюється вгору — 768 × 1024 (поле 572, px = 960 / 572): 21 px buffer'а, 12,5 CSS px, а не 20 (11,9)", () => {
    const s = seqCtx();
    drawPathPreview(s.ctx, { ...base, path: [{ x: 5, y: 4 }], ap: 9, affordable: true, px: 960 / 572 });
    expect(sets(s.ops, 'font')).toEqual(['bold 21px monospace']);
  });

  it('аудит PR #434: шлях приходить у ціль справа — плашка ліворуч, не на кінці шляху', () => {
    const s = seqCtx();
    drawPathPreview(s.ctx, { ...base, from: { x: 6, y: 4 }, path: [{ x: 5, y: 4 }], ap: 1, affordable: true });
    expect(calls(s.ops, 'fillRect')).toEqual([[192, 206, 46, 21]]);
    const t = seqCtx();
    drawPathPreview(t.ctx, {
      ...base,
      from: { x: 7, y: 4 },
      path: [
        { x: 6, y: 4 },
        { x: 5, y: 3 },
      ],
      ap: 2,
      affordable: true,
    });
    expect(calls(t.ops, 'fillRect')[0]![0]).toBe(192); // передостання (6,4) правіше за ціль (5,3)
  });

  it('Т.119: px ≤ 1,25 — розміри Т.44 без змін', () => {
    const a = seqCtx();
    const b = seqCtx();
    drawPathPreview(a.ctx, { ...base, path: [{ x: 5, y: 4 }], ap: 9, affordable: true });
    drawPathPreview(b.ctx, { ...base, path: [{ x: 5, y: 4 }], ap: 9, affordable: true, px: 1.25 });
    expect(b.ops).toEqual(a.ops);
  });
});

// Т.129 (ADR-0118): кільце кольору бійця під ногами
describe('Т.129: кільце кольору бійця під ногами', () => {
  // мок, що запам'ятовує strokeStyle у момент виклику ellipse
  const ringCalls = (draw: (ctx: CanvasRenderingContext2D) => void): { style: unknown; args: unknown[] }[] => {
    const { ctx, calls } = mockCtx();
    const rec: { style: unknown; args: unknown[] }[] = [];
    const c = ctx as unknown as { ellipse: (...a: unknown[]) => void; strokeStyle: unknown };
    const base = c.ellipse;
    c.ellipse = (...a: unknown[]) => {
      if (a[2] === RING_RX) rec.push({ style: c.strokeStyle, args: a }); // Т.132: тінь — інші радіуси
      base(...a);
    };
    draw(ctx);
    expect(calls.length).toBeGreaterThan(0);
    return rec;
  };

  it('свій боєць: еліпс кольору бійця під центром клітинки, до силуету', () => {
    const { ctx, calls } = mockCtx();
    drawSoldierSprite(ctx, soldier({ ring: FIGHTER_COLORS[1] }));
    const iE = calls.findIndex((c) => c.m === 'ellipse' && c.args[2] === RING_RX);
    const iImg = calls.findIndex((c) => c.m === 'drawImage');
    expect(iE).toBeGreaterThanOrEqual(0);
    expect(iE).toBeLessThan(iImg);
    expect(calls[iE]!.args.slice(0, 4)).toEqual([CX, CY + RING_DY, RING_RX, RING_RY]);
    expect(ringCalls((c) => drawSoldierSprite(c, soldier({ ring: FIGHTER_COLORS[1] })))[0]!.style).toBe(FIGHTER_COLORS[1]);
  });

  it('ворог — пурпурове кільце; без поля ring і в загиблого кільця немає', () => {
    expect(ringCalls((c) => drawAlienSprite(c, alien({ ring: unitRing('alien', 'a1') })))[0]!.style).toBe(ALIEN_RING);
    expect(ringCalls((c) => drawSoldierSprite(c, soldier()))).toEqual([]);
    expect(ringCalls((c) => drawSoldierSprite(c, soldier({ ring: FIGHTER_COLORS[0], hp: 0 })))).toEqual([]);
  });

  it('unitRing: свій — колір за id ростера, ворог — пурпур', () => {
    expect(unitRing('player', 's1')).toBe(FIGHTER_COLORS[0]);
    expect(unitRing('player', 's8')).toBe(FIGHTER_COLORS[1]);
    expect(unitRing('alien', 's1')).toBe(ALIEN_RING);
  });

  it('п17.2: unitRing і unitLetter — колір і літера типу ворога; свій — без літери', () => {
    expect(unitRing('alien', 'a1', 'demon')).toBe(ALIEN_RING);
    expect(unitRing('alien', 'a1', 'hound')).toBe(ENEMY_LOOK.hound.ring);
    expect(unitRing('alien', 'a1', 'eye')).toBe(ENEMY_LOOK.eye.ring);
    expect(unitRing('player', 's1', 'golem')).toBe(FIGHTER_COLORS[0]);
    expect(unitLetter('alien')).toBe('Д');
    expect(unitLetter('alien', 'golem')).toBe('Гл');
    expect(unitLetter('player', 'golem')).toBeUndefined();
    expect(ringCalls((c) => drawAlienSprite(c, alien({ ring: unitRing('alien', 'a2', 'golem') })))[0]!.style).toBe(ENEMY_LOOK.golem.ring);
  });

  it('п17.2: літера типу — плашка в лівому верхньому куті кольором кільця; у «вогні» й загиблому — немає', () => {
    const a = animCtx();
    drawAlienSprite(a.ctx, alien({ ring: ENEMY_LOOK.hound.ring, letter: 'Гн', hp: 7, maxHp: 7 }));
    const iText = a.calls.findIndex((c) => c.m === 'fillText' && c.args[0] === 'Гн');
    expect(iText).toBeGreaterThanOrEqual(0);
    expect(a.calls[iText]!.args.slice(1)).toEqual([CX - 24 + 2, CY - 21]);
    // плашка: x = лівий край клітинки + 1, ширина 2 × 6 + 3 = 15 — не доходить до числа HP праворуч
    const plate = a.calls.find((c) => c.m === 'fillRect' && c.args[0] === CX - 23 && c.args[1] === CY - 23) as
      { args: number[] } | undefined;
    expect(plate?.args.slice(2)).toEqual([15, 11]);
    expect(CX - 23 + 15).toBeLessThan(CX + 24 - (1 * 6 + 3) - 1);
    expect(a.sets.some((x) => x.p === 'fillStyle' && x.v === ENEMY_LOOK.hound.ring)).toBe(true);
    for (const over of [{ pose: 'fire' as const }, { hp: 0 }]) {
      const b = animCtx();
      drawAlienSprite(b.ctx, alien({ ring: ALIEN_RING, letter: 'Д', ...over }));
      expect(b.calls.some((c) => c.m === 'fillText' && c.args[0] === 'Д')).toBe(false);
    }
    const n = animCtx();
    drawAlienSprite(n.ctx, alien({ ring: ALIEN_RING }));
    expect(n.calls.filter((c) => c.m === 'fillText').map((c) => c.args[0])).toEqual(['10']);
  });

  it('кільце в межах клітинки; рамка вибору — поверх кільця', () => {
    expect(RING_DY + RING_RY).toBeLessThanOrEqual(CELL / 2 - 1);
    expect(RING_RX).toBeLessThanOrEqual(CELL / 2 - 1);
    const { ctx, calls } = mockCtx();
    drawSoldierSprite(ctx, soldier({ ring: FIGHTER_COLORS[0], selected: true }));
    const iE = calls.findIndex((c) => c.m === 'ellipse' && c.args[2] === RING_RX);
    const iBracket = calls.map((c) => c.m).lastIndexOf('stroke');
    expect(iE).toBeGreaterThanOrEqual(0);
    expect(iBracket).toBeGreaterThan(iE + 1); // друга лінія після кільця — дужки
  });
});
