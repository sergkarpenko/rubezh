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
// (idle/walk/fire/death, чиста функція без RNG), nearest-neighbor 44×44 у
// BCELL 48 (П14.3: walk2 — окремий кадр, фліп за напрямком), обов'язковий
// фолбек на матриці ADR-0031 при !loaded (тести від
// ассета не залежать — завантажувач інжектиться моком).
// Кадри анімаційного шару (drawAnimFrame) — у src/render.frames.test.ts;
// чиста логіка рушія — у src/core/render-core.test.ts (ADR-0038).

import { beforeEach, describe, expect, it } from 'vitest';
import {
  ATLAS_FRAME,
  ATLAS_POSE_COL,
  ATLAS_UNIT,
  ATLAS_WALK2_COL,
  CHANCE_LABEL_BG,
  CHANCE_LABEL_TEXT,
  TARGET_FRAME_COLOR,
  TERRAIN_DECOR_COL,
  TERRAIN_TILE,
  TERRAIN_WALL_COL,
  decorCol,
  drawAlienSprite,
  drawBaseSprite,
  drawChanceLabel,
  drawGeoTerrain,
  drawNightTerrain,
  drawSoldierSprite,
  drawTargetFrame,
  drawUfoSprite,
  drawUnitSprite,
  initPixelSprites,
  initTerrainAtlas,
  initUnitAtlas,
  isTerrainAtlasReady,
  isUnitAtlasReady,
  unitPose,
  type MakeOffscreen,
} from './render';
import { FOG_EDGE, GEO_GRID_COLOR, NIGHT_BG, cellHash, geoCellTone, terrainShade, type TerrainCell } from './core/render-core';
import {
  ALIEN_STAND,
  BASE_SPRITE,
  FIGHTER_SPRITE,
  OW_BOLT,
  SOLDIER_STAND,
  SPRITE_SCALE,
  UFO_LANDED_SPRITE,
  UFO_SCOUT_SPRITE,
  type UnitSpriteView,
} from './core/sprites';
import { BCELL, GCELL } from './ui/grid';

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
// атлас юнітів і тайлсет терену скидаються у фолбек — завантажувачі, що не
// кликаються (тести від ассетів не залежать; свої моки атласні describe
// ставлять локально).
beforeEach(() => {
  initPixelSprites(rasterFactory().make);
  initUnitAtlas(() => {});
  initTerrainAtlas(() => {});
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

  it('матриці прямокутні: юніти 16×16, вузол 16×16, НЛО/перехоплюач 12×12, дозор 5×5', () => {
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
    drawSoldierSprite(ctx, soldier({ selected: true, overwatch: true }));
    const e = extent(calls);
    expect(e.minX).toBeGreaterThanOrEqual(0);
    expect(e.maxX).toBeLessThanOrEqual(CELL);
    expect(e.minY).toBeGreaterThanOrEqual(0);
    expect(e.maxY).toBeLessThanOrEqual(CELL);
  });

  it('прибульчик з усіма маркерами не виходить за клітинку 48px (П14.3)', () => {
    const { ctx, calls } = mockCtx();
    drawAlienSprite(ctx, alien({ selected: true, overwatch: true }));
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
  it('HP: смуга у верхній частині клітинки (підкладка + заповнення за часткою) і число на плашці', () => {
    const s = animCtx(); // Proxy: записує і виклики, і присвоєння властивостей
    drawSoldierSprite(s.ctx, soldier({ hp: 7 }));
    expect(s.calls.some((c) => c.m === 'fillText' && c.args[0] === '7')).toBe(true);
    // смуга: підкладка на всю клітинку ВГОРУ і заповнення 7/10
    const rects = s.calls.filter((c) => c.m === 'fillRect') as Array<{ args: number[] }>;
    expect(rects.some((c) => c.args[0] === CX - 24 && c.args[1] === CY - 23 && c.args[2] === 48 && c.args[3] === 4)).toBe(true);
    expect(rects.some((c) => c.args[1] === CY - 23 && c.args[2] >= 33 && c.args[2] <= 34 && c.args[3] === 4)).toBe(true); // 48×0.7
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

  it('HP-число: кольори сторін на темній плашці (ціан/пурпур, ADR-0064), у межах клітинки', () => {
    const s = animCtx();
    drawSoldierSprite(s.ctx, soldier({ hp: 7 }));
    expect(s.sets.some((x) => x.p === 'fillStyle' && x.v === '#9adfff')).toBe(true);
    const plate = s.calls.find((c) => c.m === 'fillRect' && (c.args as number[])[3] === 11)!;
    expect((plate.args as number[])[0] + (plate.args as number[])[2]).toBeLessThanOrEqual(CX + 24); // край клітинки
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

    expect(moves.some((c) => (c.args as number[])[0] === CX - 16 && (c.args as number[])[1] === CY - 16 + 6)).toBe(
      true
    ); /* дужки на межах спрайта 32px (П13.5) */

    const notSel = mockCtx();
    drawSoldierSprite(notSel.ctx, soldier());
    expect(notSel.calls.some((c) => c.m === 'moveTo' || c.m === 'lineTo')).toBe(false);
  });

  it('маркер дозору — «блискавка» з кантом у кутку клітинки 10×10: солдат згори ліворуч, прибульчик знизу праворуч (П6.12b)', () => {
    const rf = rasterFactory();
    initPixelSprites(rf.make);
    const s = mockCtx();
    drawSoldierSprite(s.ctx, soldier({ overwatch: true }));
    const owS = s.calls.find((c) => c.m === 'drawImage' && (c.args as number[])[3] === 10);
    expect(owS).toBeDefined();
    expect((owS!.args as number[])[1]).toBe(CX - 17); // верхній лівий кут клітинки (центр CX-12, розмір 10 — П13.5)
    expect((owS!.args as number[])[2]).toBe(CY - 17);
    const bolt = rf.canvases[1]; // перша матриця після силуета — блискавка
    expect(bolt.pixels.some((p) => p.color === '#ffb347')).toBe(true); // бурштин знака (П12.7, ADR-0064)
    expect(bolt.pixels.some((p) => p.color === '#0b0e15')).toBe(true); // темний кант

    const a = mockCtx();
    drawAlienSprite(a.ctx, alien({ overwatch: true }));
    const owA = a.calls.find((c) => c.m === 'drawImage' && (c.args as number[])[3] === 10);
    expect(owA).toBeDefined();
    expect((owA!.args as number[])[1]).toBe(CX + 7); // нижній правий кут (центр CX+12), в межах клітинки
    expect((owA!.args as number[])[2]).toBe(CY + 7);
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
  it('вузол-маяк «Рубіж» (П12.7, ADR-0064; П13.5 — 16×16): 16×16 @2× = 32px вище центру, неоновий маяк, напис «ВУЗОЛ» під спрайтом', () => {
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
    const label = calls.find((c) => c.m === 'fillText' && c.args[0] === 'ВУЗОЛ');
    expect(label).toBeDefined();
    expect((label!.args as number[])[1]).toBe(22);
    expect((label!.args as number[])[2]).toBe(22 + 16); // напис під спрайтом
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

describe('П12.7: терен геосцени (drawGeoTerrain)', () => {
  const GCELL = 36; // клітинка геосцени (panels.renderGeo)

  it('перший кадр — фон NIGHT_BG на весь buffer; клітинки — два тони за хешем', () => {
    const s = seqCtx();
    drawGeoTerrain(s.ctx, 576, 288, GCELL);
    expect(s.ops[0]).toEqual({ set: 'fillStyle', v: NIGHT_BG });
    expect(s.ops[1]).toEqual({ m: 'fillRect', args: [0, 0, 576, 288] });
    // клітинка (2, 1) — тон geoCellTone за детермінованим хешем (без RNG)
    const tone = s.ops.find((o) => 'm' in o && o.m === 'fillRect' && o.args.join(',') === [2 * GCELL, 1 * GCELL, GCELL, GCELL].join(','));
    expect(tone).toBeDefined();
    expect(s.ops[s.ops.indexOf(tone!) - 1]).toEqual({ set: 'fillStyle', v: geoCellTone(2, 1) });
  });

  it('двотоновий: на сітці 16×8 обидва тони; неонові лінії сітки GEO_GRID_COLOR', () => {
    const s = seqCtx();
    drawGeoTerrain(s.ctx, 576, 288, GCELL);
    const tones = new Set<string>();
    for (let y = 0; y < 8; y++) for (let x = 0; x < 16; x++) tones.add(geoCellTone(x, y));
    expect(tones.size).toBe(2);
    // заливки клітинок — лише фоном і тими двома тонами (стабільні між кадрами)
    const fills = s.ops.filter((o) => 'set' in o && o.set === 'fillStyle').map((o) => (o as { v: unknown }).v);
    expect(fills.every((c) => c === NIGHT_BG || tones.has(c as string))).toBe(true);
    // сітка: стовпці і рядки лініями, колір — неоновий ціан (ADR-0064)
    expect(s.ops.some((o) => 'set' in o && o.set === 'strokeStyle' && o.v === GEO_GRID_COLOR)).toBe(true);
    const lines = s.ops.filter((o) => 'm' in o && o.m === 'lineTo');
    expect(lines.length).toBeGreaterThanOrEqual(16 + 8); // стовпці 0..16 і рядки 0..8
  });

  it('детермінізм (ADR-0003): той самий вхід → той самий потік операцій', () => {
    const a = seqCtx();
    drawGeoTerrain(a.ctx, 576, 288, GCELL);
    const b = seqCtx();
    drawGeoTerrain(b.ctx, 576, 288, GCELL);
    expect(a.ops).toEqual(b.ops);
  });
});

// --- П6.14: UX прицілювання — обведення валідних цілей і шанс попадання ---

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

  it('атлас готовий: кадр 96×96 → 44×44 у клітинці 48, nearest-neighbor, за позою і стороною', () => {
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
      expect(a[5]).toBe(CX - ATLAS_UNIT / 2); // Math.round(24 − 22) = 2
      expect(a[6]).toBe(CY - ATLAS_UNIT / 2);
      expect(a[7]).toBe(ATLAS_UNIT); // 44×44 у клітинці BCELL 48 (П14.3)
      expect(a[8]).toBe(ATLAS_UNIT);
      expect(a[5] + a[7]).toBeLessThanOrEqual(CELL); // межі клітинки (урок П6.6)
      expect(a[6] + a[8]).toBeLessThanOrEqual(CELL);
      expect(s.sets.some((x) => x.p === 'imageSmoothingEnabled' && x.v === false)).toBe(true);
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
    expect(plain.calls.some((c) => c.m === 'save')).toBe(false);
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

// --- П14.3 (ADR-0072): тайлсет терену бою — розклад за cellHash, фолбек ---

describe('П14.3 (ADR-0072): тайлсет терену — підлога за хешем, стіна, декори', () => {
  // Мок-тайлсет: завантажувач кликає onLoad синхронно з фіктивним джерелом.
  const tilesImg = { width: 384, height: 48 } as unknown as CanvasImageSource;
  const readyTiles = (): void => {
    initTerrainAtlas((_url, onLoad) => {
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
  const tileDraws = (ops: Op[]): Array<{ col: number; x: number; y: number }> =>
    ops
      .filter((o): o is { m: string; args: unknown[] } => 'm' in o && o.m === 'drawImage')
      .map((o) => ({
        col: (o.args[1] as number) / TERRAIN_TILE,
        x: o.args[5] as number,
        y: o.args[6] as number,
      }));

  it('прапорець завантаженості: фолбек до onload, готовий — після', () => {
    expect(isTerrainAtlasReady()).toBe(false);
    readyTiles();
    expect(isTerrainAtlasReady()).toBe(true);
  });

  it('підлога — 4 варіанти за cellHash (без RNG), стіна — за мапою (blocked), 1:1 під клітинку', () => {
    readyTiles();
    const s = seqCtx();
    drawNightTerrain(s.ctx, 144, 96, cells, 48);
    const draws = tileDraws(s.ops);
    // підлога/стіна кожній + декори за хешем (у сітці 3×2 одна клітинка з декором)
    const decors = cells.filter((c) => !c.blocked && decorCol(c.x, c.y) !== null).length;
    expect(draws.length).toBe(cells.length + decors);
    for (const c of cells) {
      const d = draws.find((t) => t.x === c.x * 48 && t.y === c.y * 48);
      expect(d, `клітинка (${c.x},${c.y})`).toBeDefined();
      expect(d!.col).toBe(c.blocked ? TERRAIN_WALL_COL : cellHash(c.x, c.y) % 4); // розклад за хешем (ADR-0072 п.6)
    }
    // nearest-neighbor і розмір 1:1 з клітинкою (48 = BCELL, П14.3)
    expect(s.ops.some((o) => 'set' in o && o.set === 'imageSmoothingEnabled' && o.v === false)).toBe(true);
    for (const o of s.ops) {
      if ('m' in o && o.m === 'drawImage') {
        expect(o.args[7]).toBe(48); // ширина цільова
        expect(o.args[8]).toBe(48); // висота цільова
      }
    }
  });

  it('декори — детермінований рідкий розклад decorCol (уламки/труба/вентиляція), лише на відкритих', () => {
    // чиста функція: знаходимо по одному представнику кожного типу на сітці 60×60
    const found = new Map<number, TerrainCell>();
    for (let y = 0; y < 60 && found.size < 3; y++) {
      for (let x = 0; x < 60 && found.size < 3; x++) {
        const d = decorCol(x, y);
        if (d !== null && !found.has(d)) found.set(d, { x, y, blocked: false, visible: true });
      }
    }
    expect([...found.keys()].sort()).toEqual(
      [TERRAIN_DECOR_COL['уламки'], TERRAIN_DECOR_COL['труба'], TERRAIN_DECOR_COL['вентиляція']].sort()
    );
    const list = [...found.values()];
    for (const c of list) expect(decorCol(c.x, c.y)).toBe(decorCol(c.x, c.y)); // стабільний (без RNG)
    readyTiles();
    const s = seqCtx();
    drawNightTerrain(s.ctx, 60 * 48, 60 * 48, list, 48);
    const draws = tileDraws(s.ops);
    expect(draws.length).toBe(list.length * 2); // підлога кожній + декор кожній
    for (const c of list) {
      const dcol = decorCol(c.x, c.y)!;
      expect(draws.some((t) => t.col === dcol && t.x === c.x * 48 && t.y === c.y * 48)).toBe(true);
    }
  });

  it('туман: клітинки поза видимістю перекриваються напівпрозорим TILE-шаром (вміст не розкривається)', () => {
    readyTiles();
    const fogged = cells.map((c) => ({ ...c, visible: c.x === 0 })); // видимий лише стовпець x=0
    const s = seqCtx();
    drawNightTerrain(s.ctx, 144, 96, fogged, 48);
    const fogFills = s.ops.filter(
      (o): o is { m: string; args: unknown[] } => 'm' in o && o.m === 'fillRect' && o.args[3] === 48 && o.args[2] === 48
    );
    expect(fogFills.length).toBe(4); // 4 клітинки туману (з 6)
  });

  it('фолбек без ассета — чинні два тони terrainShade (загальний випадок покривають тести П6.13)', () => {
    expect(isTerrainAtlasReady()).toBe(false); // завантажувач не кликнувся — headless/офлайн
    const s = seqCtx();
    drawNightTerrain(s.ctx, 144, 96, cells, 48);
    expect(s.ops.some((o) => 'm' in o && o.m === 'drawImage')).toBe(false); // тайли не малюються
    expect(cellFills(s.ops, 0, 0, 48)[0]).toBe(terrainShade(0, 0, false, true)); // двотоновий фолбек
  });

  it('детермінізм (ADR-0003): той самий терен → той самий потік операцій', () => {
    readyTiles();
    const a = seqCtx();
    drawNightTerrain(a.ctx, 144, 96, cells, 48);
    const b = seqCtx();
    drawNightTerrain(b.ctx, 144, 96, cells, 48);
    expect(a.ops).toEqual(b.ops);
  });
});
