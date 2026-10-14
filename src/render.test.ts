// src/render.test.ts
// П6.12 (ADR-0031): тести піксель-арт спрайтів — матриці розгортаються в мок
// offscreen-канвас (по одному fillRect на піксель), далі drawImage на цільовий
// мок-контекст: (1) малювання не виходить за клітинку (урок П6.6); (2) силуети
// і зброя солдата й прибульця відрізняються (кольори пікселів растру); (3)
// малювання детерміноване (той самий вхід → той самий потік викликів, без RNG);
// (4) читабельність стану (HP, вибір, заступа); (5) кеш offscreen-канвасів і
// nearest-neighbor (imageSmoothingEnabled = false, ціле кратне масштабування).
// П6.7/П6.8 (ADR-0029): тести анімаційного рушія — кадри (трасер/спалах/смерть/
// заступа/хід), черга з ін'єктованим планувальником (idle → 0 перерисовок) і
// чистий перетворювач подій логу (лог байт-у-байт незмінний — критерій П6.8).
// П6.13: нічна палітра — терен (двотоновий, хеш-варіація, без RNG), тонка
// сітка в проміжках, м'який край туману (сенс туману незмінний) і тряска
// канвасу при влучанні (лише фаза спалаху трасера, обмежена амплітуда).

import { beforeEach, describe, expect, it } from 'vitest';
import {
  AnimEngine,
  DEATH_MS,
  IMPACT_MS,
  MOVE_MS_PER_CELL,
  NIGHT_BG,
  OW_FLASH_MS,
  RADAR_PULSE_MS,
  SHAKE_PX,
  SPRITE_SCALE,
  TRACER_MS,
  animT,
  animsFromEvents,
  cellHash,
  drawAlienSprite,
  drawAnimFrame,
  drawBaseSprite,
  drawNightTerrain,
  drawSoldierSprite,
  drawUfoSprite,
  initPixelSprites,
  makeDeathAnim,
  makeGeoPulseAnim,
  makeMoveAnim,
  makeOwFlashAnim,
  makeTracerAnim,
  moveAnimPos,
  shakeOffset,
  type Anim,
  type MakeOffscreen,
  type TerrainCell,
  type UnitSprite,
} from './render';
import { makeUnit, type GameEvent, type Unit } from './core/combat';

// Клітиночка превью: BCELL = 26, центр (13, 13), радіус силуету 8 (як у renderBattle).
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

  it('маркер заступи — «блискавка» з кантом у кутку клітинки 10×10: солдат згори ліворуч, прибульчик знизу праворуч (П6.12b)', () => {
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

// --- П6.8 (ADR-0029): анімаційний рушій ---

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

const unit = (id: string, side: 'player' | 'alien', x: number, y: number): Unit => makeUnit({ id, side, pos: { x, y } });

describe('анімаційний рушій: прогрес і позиція (П6.8)', () => {
  it('animT: start === null → 0; у межах — частка; після dur — 1 (клімпиться)', () => {
    const a = makeOwFlashAnim(unit('s1', 'player', 2, 2));
    expect(a.dur).toBe(OW_FLASH_MS);
    expect(animT(a, 1000)).toBe(0); // ще не почалась
    a.start = 100;
    expect(animT(a, 100 + OW_FLASH_MS / 2)).toBe(0.5);
    expect(animT(a, 100 + OW_FLASH_MS * 10)).toBe(1);
  });

  it('makeMoveAnim: тривалість — 90 мс на клітинку шляху', () => {
    const u = unit('s1', 'player', 0, 0);
    const a = makeMoveAnim(
      u,
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
      ],
      false
    );
    expect(a.dur).toBe(2 * MOVE_MS_PER_CELL);
  });

  it('moveAnimPos: t=0 → центр першої клітинки, t=1 → останньої, середина — на ламаній', () => {
    const a = makeMoveAnim(
      unit('s1', 'player', 0, 0),
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
      ],
      false
    );
    expect(moveAnimPos(a, 0, 26)).toEqual({ cx: 13, cy: 13 });
    expect(moveAnimPos(a, 1, 26)).toEqual({ cx: 39, cy: 39 });
    expect(moveAnimPos(a, 0.25, 26)).toEqual({ cx: 26, cy: 13 }); // середина першого сегмента (0,0)→(1,0)
    expect(moveAnimPos(a, 0.5, 26)).toEqual({ cx: 39, cy: 13 }); // кут повороту (1,0)
  });
});

describe('кадри анімаційного шару (П6.8)', () => {
  it('хід: силует у проміжній позиції шляху (drawImage центрований у клітинці)', () => {
    const a = makeMoveAnim(
      unit('s1', 'player', 0, 0),
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
      ],
      false
    );
    a.start = 0;
    const { ctx, calls } = animCtx();
    drawAnimFrame(ctx, a, MOVE_MS_PER_CELL, 26, 8); // t = 0.5 → клітинка (1,0)
    const d = calls.find((c) => c.m === 'drawImage');
    expect(d).toBeDefined();
    expect((d!.args as number[])[1]).toBe(39 - 12); // центр клітинки (1,0) мінус половина спрайта
    expect((d!.args as number[])[2]).toBe(13 - 12);
    expect((d!.args as number[])[3]).toBe(24);
    expect((d!.args as number[])[4]).toBe(24);
  });

  it('хід (П6.12): кадри ходьби чергуються детерміновано — 2 кадри на клітинку шляху', () => {
    const a = makeMoveAnim(
      unit('s1', 'player', 0, 0),
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
      ],
      false
    );
    a.start = 0;
    const f0 = animCtx();
    drawAnimFrame(f0.ctx, a, 0, 26, 8); // t = 0 → кадр «стій»
    const f1 = animCtx();
    drawAnimFrame(f1.ctx, a, MOVE_MS_PER_CELL / 2, 26, 8); // t = 0.25 → кадр «крок»
    expect(f0.calls.find((c) => c.m === 'drawImage')!.args[0]).not.toBe(f1.calls.find((c) => c.m === 'drawImage')!.args[0]);
  });

  it('трасер: фаза польоту — відрізок від стрільця до цілі; влучання — кільце, що росте і гасне', () => {
    const a = makeTracerAnim('player', { x: 1, y: 1 }, { x: 3, y: 1 }, true);
    a.start = 0;
    expect(a.dur).toBe(TRACER_MS + IMPACT_MS);
    const fly = animCtx();
    drawAnimFrame(fly.ctx, a, TRACER_MS / 2, 26, 8); // t* — куля на півдорозі
    const head = fly.calls.find((c) => c.m === 'lineTo');
    expect(head).toBeDefined();
    expect((head!.args as number[])[0]).toBeCloseTo(65, 5); // 39 + 52 * 0.5
    expect(fly.calls.some((c) => c.m === 'arc')).toBe(false); // спалаху ще немає

    const boom = animCtx();
    drawAnimFrame(boom.ctx, a, TRACER_MS + IMPACT_MS / 2, 26, 8); // фаза 2: спалах
    const ring = boom.calls.find((c) => c.m === 'arc');
    expect(ring).toBeDefined();
    expect((ring!.args as number[])[0]).toBe(91); // центр клітинки цілі (3,1)
    const alphas = boom.sets.filter((s) => s.p === 'globalAlpha').map((s) => s.v);
    expect(alphas[0]).toBeLessThan(1); // кільце гасне
    expect(alphas[alphas.length - 1]).toBe(1); // альфа відновлена
  });

  it('трасер-промах: лише політ кулі — без спалаху-кільця', () => {
    const a = makeTracerAnim('alien', { x: 5, y: 5 }, { x: 3, y: 5 }, false);
    a.start = 0;
    expect(a.dur).toBe(TRACER_MS);
    const { ctx, calls } = animCtx();
    drawAnimFrame(ctx, a, TRACER_MS - 10, 26, 8);
    expect(calls.some((c) => c.m === 'lineTo')).toBe(true);
    expect(calls.some((c) => c.m === 'arc')).toBe(false);
  });

  it('смерть: силует згасає (alpha спадає і відновлюється), позиція — клітинка загиблого', () => {
    const a = makeDeathAnim(unit('a1', 'alien', 4, 7));
    a.start = 0;
    expect(a.dur).toBe(DEATH_MS);
    expect(a.at).toEqual({ x: 4, y: 7 });
    const { ctx, calls, sets } = animCtx();
    drawAnimFrame(ctx, a, DEATH_MS / 2, 26, 8); // t = 0.5
    const d = calls.find((c) => c.m === 'drawImage'); // прибульчик — піксельний спрайт
    expect(d).toBeDefined();
    expect((d!.args as number[])[1]).toBe(4 * 26 + 13 - 12);
    expect((d!.args as number[])[2]).toBe(7 * 26 + 13 - 12);
    const alphas = sets.filter((s) => s.p === 'globalAlpha').map((s) => s.v);
    expect(alphas[0]).toBeCloseTo(0.5, 5);
    expect(alphas[alphas.length - 1]).toBe(1);
  });

  it('заступа: пульс-кільце кольору маркера заступи, що росте і гасне', () => {
    const a = makeOwFlashAnim(unit('s2', 'player', 6, 9));
    a.start = 0;
    const { ctx, calls, sets } = animCtx();
    drawAnimFrame(ctx, a, OW_FLASH_MS / 2, 26, 8);
    const ring = calls.find((c) => c.m === 'arc');
    expect(ring).toBeDefined();
    expect((ring!.args as number[])[0]).toBe(6 * 26 + 13);
    expect((ring!.args as number[])[1]).toBe(9 * 26 + 13);
    expect(sets.some((s) => s.p === 'strokeStyle' && s.v === '#d8b25a')).toBe(true);
    expect(sets.filter((s) => s.p === 'globalAlpha').map((s) => s.v)[0]).toBeCloseTo(0.5, 5);
  });
});

describe('черга анімацій: rAF лише під час активних анімацій (ADR-0029)', () => {
  // Фейковий планувальник: кадри виконує тест («пропускаємо час»), рахує
  // заплановані кадри, перерисовки та скасування.
  function fakeDeps() {
    const st = { schedules: 0, draws: 0, canceled: 0, frames: [] as Array<(now: number) => void> };
    const run = (now: number): void => {
      const batch = st.frames.splice(0);
      for (const cb of batch) cb(now);
    };
    const deps = {
      schedule: (cb: (now: number) => void): number => {
        st.schedules++;
        st.frames.push(cb);
        return st.frames.length;
      },
      cancel: (): void => {
        st.canceled++;
      },
      draw: (): void => {
        st.draws++;
      },
    };
    return { st, run, deps };
  }

  it('idle → 0 перерисовок: без анімацій рушій не планує жодного кадру', () => {
    const { st, run, deps } = fakeDeps();
    const eng = new AnimEngine(deps); // черга порожня
    expect(eng.busy).toBe(false);
    expect(eng.active()).toBeNull();
    run(0);
    run(1000);
    expect(st.schedules).toBe(0);
    expect(st.draws).toBe(0);
  });

  it('послідовне відтворення і зупинка: останній кадр статичний, далі 0 перерисовок', () => {
    const { st, run, deps } = fakeDeps();
    const eng = new AnimEngine(deps);
    const a = makeOwFlashAnim(unit('s1', 'player', 0, 0)); // dur 300
    const b = makeDeathAnim(unit('a1', 'alien', 1, 1)); // dur 350
    eng.push(a, b);
    expect(st.schedules).toBe(1); // один rAF на push
    expect(eng.active()).toBe(a);

    run(0); // кадр 1: a почалась
    expect(st.draws).toBe(1);
    expect(st.schedules).toBe(2); // черга непорожня → наступний кадр
    expect(a.start).toBe(0);

    run(150); // кадр 2: a триває
    expect(animT(eng.active() as Anim, 150)).toBeCloseTo(0.5, 5);

    run(300); // кадр 3: a завершена → b почалась
    expect(eng.active()).toBe(b);
    expect(b.start).toBe(300);
    expect(st.schedules).toBe(4);

    run(650); // кадр 4: b завершена → черга порожня
    expect(eng.busy).toBe(false);
    expect(eng.active()).toBeNull();
    expect(st.draws).toBe(4); // останній кадр — фінальна перерисовка (статика)

    run(1000); // після idle: жодного нового кадру
    expect(st.schedules).toBe(4);
    expect(st.draws).toBe(4);
  });

  it('cancel: черга скидається, запланований кадр скасовується', () => {
    const { st, deps } = fakeDeps();
    const eng = new AnimEngine(deps);
    eng.push(makeOwFlashAnim(unit('s1', 'player', 0, 0)));
    expect(st.schedules).toBe(1);
    eng.cancel();
    expect(eng.busy).toBe(false);
    expect(st.canceled).toBe(1);
    expect(st.draws).toBe(0);
    eng.cancel(); // повторний cancel — безпомилковий (handle null)
    expect(st.canceled).toBe(1);
  });
});

describe('перетворювач подій логу → анімації (критерій: лог байт-у-байт незмінний)', () => {
  it("кроки руху об'єднуються в один хід; смерть-перед-пострілом → трасер потім смерть", () => {
    const s1 = unit('s1', 'player', 2, 2);
    const a1 = unit('a1', 'alien', 5, 2);
    const events: GameEvent[] = [
      { type: 'overwatch', unitId: 's1', armed: true },
      { type: 'move', unitId: 'a1', from: { x: 3, y: 2 }, to: { x: 4, y: 2 } },
      { type: 'move', unitId: 'a1', from: { x: 4, y: 2 }, to: { x: 5, y: 2 } },
      { type: 'death', unitId: 'a1', killerId: 's1' }, // fireOnce пише смерть РАНІШЕ пострілу
      { type: 'shot', shooterId: 's1', targetId: 'a1', mode: 'snap', hit: true, damage: 10 },
      { type: 'turn', turn: 2, side: 'player' },
    ];
    const before = JSON.stringify(events);
    const unitsBefore = JSON.stringify([s1, a1]);
    const anims = animsFromEvents(events, [s1, a1]);
    expect(anims.map((x) => x.kind)).toEqual(['owflash', 'move', 'tracer', 'death']);
    expect(anims[1].kind === 'move' && anims[1].path).toEqual([
      { x: 3, y: 2 },
      { x: 4, y: 2 },
      { x: 5, y: 2 },
    ]);
    expect(anims[2].kind === 'tracer' && anims[2].hit).toBe(true);
    expect(anims[3].kind === 'death' && anims[3].at).toEqual({ x: 5, y: 2 });
    // лог і юніти лише читались — байт-у-байт незмінні
    expect(JSON.stringify(events)).toBe(before);
    expect(JSON.stringify([s1, a1])).toBe(unitsBefore);
  });

  it('реакційний вогень перериває рух: постріл між кроками розбиває хід на два', () => {
    const s1 = unit('s1', 'player', 2, 2);
    const a1 = unit('a1', 'alien', 5, 2);
    const events: GameEvent[] = [
      { type: 'move', unitId: 'a1', from: { x: 3, y: 2 }, to: { x: 4, y: 2 } },
      { type: 'shot', shooterId: 's1', targetId: 'a1', mode: 'snap', hit: false, damage: 0 },
      { type: 'move', unitId: 'a1', from: { x: 4, y: 2 }, to: { x: 5, y: 2 } },
    ];
    const anims = animsFromEvents(events, [s1, a1]);
    expect(anims.map((x) => x.kind)).toEqual(['move', 'tracer', 'move']);
    expect(anims[1].kind === 'tracer' && anims[1].hit).toBe(false);
  });

  it('події без анімації (turn) і невідомі юніти пропускаються', () => {
    const events: GameEvent[] = [
      { type: 'turn', turn: 2, side: 'alien' },
      { type: 'move', unitId: 'ghost', from: { x: 0, y: 0 }, to: { x: 1, y: 0 } },
    ];
    expect(animsFromEvents(events, [unit('s1', 'player', 0, 0)])).toEqual([]);
  });
});

// --- П6.9 (ADR-0029): мінімальний арт геосцени — м’які позначки НЛО, пульс радара ---

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

describe('П6.9: пульс радара геосцени (критерії: туман і траєкторія незмінні)', () => {
  const MAXR = 162; // (RADAR_RANGE + 0.5) * GCELL = 4.5 * 36

  it('makeGeoPulseAnim: тривалість RADAR_PULSE_MS, start null', () => {
    const a = makeGeoPulseAnim(18, 18, MAXR);
    expect(a.kind).toBe('gpulse');
    expect(a.dur).toBe(RADAR_PULSE_MS);
    expect(a.start).toBeNull();
  });

  it('кільце росте від бази до maxR і гасне; alpha відновлюється до 1', () => {
    const a = makeGeoPulseAnim(18, 18, MAXR);
    a.start = 1000;
    const mid = animCtx();
    drawAnimFrame(mid.ctx, a, 1000 + RADAR_PULSE_MS / 2, 36, 0);
    const midArc = mid.calls.find((c) => c.m === 'arc');
    expect(midArc).toBeDefined();
    const midR = (midArc!.args as number[])[2];
    expect(midR).toBeGreaterThan(2);
    expect(midR).toBeLessThan(MAXR);
    const end = animCtx();
    drawAnimFrame(end.ctx, a, 1000 + RADAR_PULSE_MS, 36, 0);
    const endR = (end.calls.find((c) => c.m === 'arc')!.args as number[])[2];
    expect(endR).toBeCloseTo(MAXR);
    for (const s of [mid, end]) {
      const alphas = s.sets.filter((p) => p.p === 'globalAlpha').map((p) => p.v);
      expect(alphas[alphas.length - 1]).toBe(1); // alpha завжди відновлюється
    }
    const midAlpha = mid.sets.find((p) => p.p === 'globalAlpha')!.v as number;
    const endAlpha = end.sets.find((p) => p.p === 'globalAlpha')!.v as number;
    expect(midAlpha).toBeGreaterThan(0);
    expect(midAlpha).toBeLessThan(0.6);
    expect(endAlpha).toBe(0); // останній кадр — кільце повністю погасло
    // кільце гасне: альфа серединного кадру нижча за початкову
    const a0 = animCtx();
    drawAnimFrame(a0.ctx, a, 1000, 36, 0);
    const alpha0 = a0.sets.find((p) => p.p === 'globalAlpha')!.v as number;
    const alphaMid = mid.sets.find((p) => p.p === 'globalAlpha')!.v as number;
    expect(alphaMid).toBeLessThan(alpha0);
  });

  it('пульс не анімує НЛО: лише кільце — без спрайтів, заливок і тексту (туман, критерій П6.9)', () => {
    const a = makeGeoPulseAnim(18, 18, MAXR);
    a.start = 1000;
    const s = animCtx();
    drawAnimFrame(s.ctx, a, 1150, 36, 0);
    expect(s.calls.some((c) => c.m === 'arc')).toBe(true);
    expect(s.calls.some((c) => c.m === 'fillText' || c.m === 'ellipse' || c.m === 'fillRect' || c.m === 'fill')).toBe(false);
  });

  it('детермінізм (ADR-0003): той самий вхід → той самий потік викликів і присвоєнь', () => {
    const mk = (): ReturnType<typeof makeGeoPulseAnim> => {
      const a = makeGeoPulseAnim(18, 18, MAXR);
      a.start = 1000;
      return a;
    };
    const s1 = animCtx();
    drawAnimFrame(s1.ctx, mk(), 1150, 36, 0);
    const s2 = animCtx();
    drawAnimFrame(s2.ctx, mk(), 1150, 36, 0);
    expect(s1.calls).toEqual(s2.calls);
    expect(s1.sets).toEqual(s2.sets);
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
    cells[4] = { x: 1, y: 1, blocked: false, visible: true }; // центр видимый
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

describe('П6.13: тряска канвасу при влучанні (через AnimEngine, без RNG)', () => {
  it('без анімації, промах, фаза польоту і після завершення — нульовий зсув', () => {
    expect(shakeOffset(null, 100)).toEqual({ dx: 0, dy: 0 });
    const miss = makeTracerAnim('player', { x: 1, y: 1 }, { x: 3, y: 1 }, false);
    miss.start = 0;
    expect(shakeOffset(miss, 50)).toEqual({ dx: 0, dy: 0 });
    const hit = makeTracerAnim('player', { x: 1, y: 1 }, { x: 3, y: 1 }, true);
    expect(shakeOffset(hit, 100)).toEqual({ dx: 0, dy: 0 }); // start === null
    hit.start = 0;
    expect(shakeOffset(hit, TRACER_MS / 2)).toEqual({ dx: 0, dy: 0 }); // куля ще летить
    expect(shakeOffset(hit, TRACER_MS + IMPACT_MS + 10)).toEqual({ dx: 0, dy: 0 }); // спалах завершено
  });

  it('фаза спалаху: зсув у межах SHAKE_PX, гасне до кінця спалаху, детермінований', () => {
    const hit = makeTracerAnim('alien', { x: 5, y: 5 }, { x: 3, y: 5 }, true);
    hit.start = 0;
    const at = (frac: number) => shakeOffset(hit, TRACER_MS + IMPACT_MS * frac);
    const first = at(0.125); // амплітуда максимальна: sin(π/2) = 1
    expect(Math.abs(first.dx) + Math.abs(first.dy)).toBeGreaterThan(0);
    for (let k = 1; k <= 40; k++) {
      const o = at(k / 40);
      expect(Math.abs(o.dx)).toBeLessThanOrEqual(SHAKE_PX);
      expect(Math.abs(o.dy)).toBeLessThanOrEqual(SHAKE_PX);
    }
    expect(at(0.99)).toEqual({ dx: 0, dy: 0 }); // амплітуда спала до нуля
    expect(at(0.125)).toEqual(first); // той самий вхід → той самий зсув
  });
});

describe('П6.13: яскравіші неонові трасери/спалахи', () => {
  it('трасер гравця: неоновий блакитний зі свіченням (shadowBlur встановлено і скинуто)', () => {
    const a = makeTracerAnim('player', { x: 1, y: 1 }, { x: 3, y: 1 }, false);
    a.start = 0;
    const s = animCtx();
    drawAnimFrame(s.ctx, a, TRACER_MS / 2, 26, 8);
    expect(s.sets.some((x) => x.p === 'strokeStyle' && x.v === '#6fd3ff')).toBe(true);
    const glows = s.sets.filter((x) => x.p === 'shadowBlur').map((x) => x.v);
    expect(glows[0]).toBe(6);
    expect(glows[glows.length - 1]).toBe(0); // свічення обов'язково скидається
  });

  it('трасер прибульця: розпечений оранж; спалах влучання — яскравий, зі свіченням', () => {
    const a = makeTracerAnim('alien', { x: 5, y: 5 }, { x: 3, y: 5 }, true);
    a.start = 0;
    const fly = animCtx();
    drawAnimFrame(fly.ctx, a, TRACER_MS / 2, 26, 8);
    expect(fly.sets.some((x) => x.p === 'strokeStyle' && x.v === '#ff9a52')).toBe(true);
    const boom = animCtx();
    drawAnimFrame(boom.ctx, a, TRACER_MS + IMPACT_MS / 2, 26, 8);
    expect(boom.sets.some((x) => x.p === 'strokeStyle' && x.v === '#ffe38a')).toBe(true);
    expect(boom.sets.some((x) => x.p === 'shadowColor' && x.v === '#ffe38a')).toBe(true);
    const glows = boom.sets.filter((x) => x.p === 'shadowBlur').map((x) => x.v);
    expect(glows[0]).toBe(8);
    expect(glows[glows.length - 1]).toBe(0);
  });
});
