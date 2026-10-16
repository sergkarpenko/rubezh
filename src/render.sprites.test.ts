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
// Кадри анімаційного шару (drawAnimFrame) — у src/render.frames.test.ts;
// чиста логіка рушія — у src/core/render-core.test.ts (ADR-0038).

import { beforeEach, describe, expect, it } from 'vitest';
import {
  CHANCE_LABEL_BG,
  CHANCE_LABEL_TEXT,
  TARGET_FRAME_COLOR,
  drawAlienSprite,
  drawBaseSprite,
  drawChanceLabel,
  drawNightTerrain,
  drawSoldierSprite,
  drawTargetFrame,
  drawUfoSprite,
  initPixelSprites,
  type MakeOffscreen,
} from './render';
import { NIGHT_BG, cellHash, type TerrainCell } from './core/render-core';
import { SPRITE_SCALE, type UnitSprite } from './core/sprites';

// Клітиночка прев'ю: BCELL = 26, центр (13, 13), радіус силуету 8 (як у renderBattle).
const CX = 13;
const CY = 13;
const R = 8;
const CELL = 26;

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

const soldier = (over: Partial<UnitSprite> = {}): UnitSprite => ({
  side: 'player',
  cx: CX,
  cy: CY,
  r: R,
  hp: 10,
  selected: false,
  overwatch: false,
  ...over,
});

const alien = (over: Partial<UnitSprite> = {}): UnitSprite => ({ ...soldier(), side: 'alien', ...over });

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
// розгорнутих спрайтів (ліниво + кеш — ADR-0031).
beforeEach(() => {
  initPixelSprites(rasterFactory().make);
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

describe('спрайти юнітів: межі клітинки (урок П6.6)', () => {
  it('солдат з усіма маркерами не виходить за клітинку 26px', () => {
    const { ctx, calls } = mockCtx();
    drawSoldierSprite(ctx, soldier({ selected: true, overwatch: true }));
    const e = extent(calls);
    expect(e.minX).toBeGreaterThanOrEqual(0);
    expect(e.maxX).toBeLessThanOrEqual(CELL);
    expect(e.minY).toBeGreaterThanOrEqual(0);
    expect(e.maxY).toBeLessThanOrEqual(CELL);
  });

  it('прибульчик з усіма маркерами не виходить за клітинку 26px', () => {
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
  it('drawImage з offscreen-канваса: цілий масштаб 2× (24px у клітинці 26), згладжування вимкнене', () => {
    const s = animCtx(); // Proxy: записує і виклики, і присвоєння властивостей
    drawSoldierSprite(s.ctx, soldier());
    const d = s.calls.find((c) => c.m === 'drawImage');
    expect(d).toBeDefined();
    expect((d!.args as number[])[1]).toBe(CX - (12 * SPRITE_SCALE) / 2); // Math.round(13 - 12) = 1
    expect((d!.args as number[])[2]).toBe(CY - (12 * SPRITE_SCALE) / 2);
    expect((d!.args as number[])[3]).toBe(12 * SPRITE_SCALE);
    expect((d!.args as number[])[4]).toBe(12 * SPRITE_SCALE);
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
    expect(rf.canvases[0].pixels.some((p) => p.color === '#6ea8ff')).toBe(true); // тіло солдата
    expect(rf.canvases[1].pixels.some((p) => p.color === '#ff6b6b')).toBe(true); // мантія прибульця
  });

  it('«АР-14 Гарт»: ствол кольором зброї, дуло — крайній правий піксель растру', () => {
    const rf = rasterFactory();
    initPixelSprites(rf.make);
    drawSoldierSprite(mockCtx().ctx, soldier());
    const ras = rf.canvases[0];
    const barrel = ras.pixels.filter((p) => p.color === '#e8eef7');
    expect(barrel.length).toBeGreaterThanOrEqual(4);
    expect(barrel.some((p) => p.x === ras.width - 1)).toBe(true); // дуло за межами тіла
  });

  it('«Імпульсний різак»: піки кольором різака над головою, кольору ствола в растрі нема', () => {
    const rf = rasterFactory();
    initPixelSprites(rf.make);
    drawAlienSprite(mockCtx().ctx, alien());
    const ras = rf.canvases[0];
    const fork = ras.pixels.filter((p) => p.color === '#ffd27a');
    expect(fork.length).toBeGreaterThanOrEqual(4);
    expect(fork.every((p) => p.y < 3)).toBe(true); // верхні рядки — над головою (голова з y = 3)
    expect(ras.pixels.some((p) => p.color === '#e8eef7')).toBe(false); // жодного ствола
  });
});

describe('читабельність стану (ADR-0007)', () => {
  it('HP малюється числом у центрі силуетів', () => {
    const s = mockCtx();
    drawSoldierSprite(s.ctx, soldier({ hp: 7 }));
    expect(s.calls.some((c) => c.m === 'fillText' && c.args[0] === '7')).toBe(true);

    const a = mockCtx();
    drawAlienSprite(a.ctx, alien({ hp: 4 }));
    expect(a.calls.some((c) => c.m === 'fillText' && c.args[0] === '4')).toBe(true);
  });

  it('рамка вибору — кутові дужки по кутах спрайта лише коли selected (доробка П6.12)', () => {
    const sel = mockCtx();
    drawSoldierSprite(sel.ctx, soldier({ selected: true }));
    const moves = sel.calls.filter((c) => c.m === 'moveTo');
    const lines = sel.calls.filter((c) => c.m === 'lineTo');
    expect(moves.length).toBe(4); // по одній дужці на кут
    expect(lines.length).toBe(8); // два плечі на кут
    // кути — на межах спрайта (±12 від центру), в межах клітинки (урок П6.6)
    expect(moves.some((c) => (c.args as number[])[0] === CX - 12 && (c.args as number[])[1] === CY - 12 + 4)).toBe(true);

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
    expect((owS!.args as number[])[1]).toBe(CX - 13); // верхній лівий кут клітинки
    expect((owS!.args as number[])[2]).toBe(CY - 13);
    const bolt = rf.canvases[1]; // перша матриця після силуета — блискавка
    expect(bolt.pixels.some((p) => p.color === '#d8b25a')).toBe(true); // золото знака
    expect(bolt.pixels.some((p) => p.color === '#0b0e15')).toBe(true); // темний кант

    const a = mockCtx();
    drawAlienSprite(a.ctx, alien({ overwatch: true }));
    const owA = a.calls.find((c) => c.m === 'drawImage' && (c.args as number[])[3] === 10);
    expect(owA).toBeDefined();
    expect((owA!.args as number[])[1]).toBe(CX + 2); // нижній правий кут, в межах клітинки
    expect((owA!.args as number[])[2]).toBe(CY + 2);
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
  it('база «Радарний пост» (доробка П6.12): 12×12 @2× = 24px вище центру, напис «БАЗА» під спрайтом', () => {
    const { ctx, calls } = mockCtx();
    drawBaseSprite(ctx, { cx: 18, cy: 18, size: 36 });
    const d = calls.find((c) => c.m === 'drawImage');
    expect(d).toBeDefined();
    expect((d!.args as number[])[1]).toBe(18 - 12); // Math.round(cx - 24/2)
    expect((d!.args as number[])[2]).toBe(18 - 4 - 12); // спрайт зміщено вгору
    expect((d!.args as number[])[3]).toBe(24);
    expect((d!.args as number[])[4]).toBe(24);
    const label = calls.find((c) => c.m === 'fillText' && c.args[0] === 'БАЗА');
    expect(label).toBeDefined();
    expect((label!.args as number[])[1]).toBe(18);
    expect((label!.args as number[])[2]).toBe(18 + 13); // напис під спрайтом
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

  it('позначка в межах клітинки 36px (урок П6.6): 10×10 у масштабі 2× → 20px', () => {
    const { ctx, calls } = mockCtx();
    drawUfoSprite(ctx, { cx: 18, cy: 18, landed: true, kind: 'збирач' });
    const e = extent(calls);
    expect(e.maxX - e.minX).toBeLessThanOrEqual(20);
    expect(e.maxY - e.minY).toBeLessThanOrEqual(20);
  });
});
// --- П6.13: нічна палітра бойовища — терен, сітка, м'який край туману ---

// Сімейства відтінків терену (двотоновий терен × видимо/туман) — стабільні
// константи палітри render.ts; варіація в межах сімейства — за хешем клітинки.
const OPEN = ['#151b28', '#171e2c', '#131926', '#161d2b'];
const BLOCKED = ['#3d4657', '#414b5d', '#38414f', '#3f4a5c'];
const OPEN_FOG = ['#0b0e15', '#0c0f17', '#0a0d13', '#0d1018'];
const BLOCKED_FOG = ['#232936', '#252b39', '#202633', '#242a38'];
const FOG_EDGE = 'rgba(21,27,40,0.45)';
const GRID_COLOR = 'rgba(110,168,255,0.07)';

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
