// src/render.test.ts
// П6.7 (ADR-0029): юніт-тести векторних спрайтів на мок-контексті — запис викликів
// Canvas 2D дозволяє перевірити: (1) малювання не виходить за клітинку (урок П6.6:
// проміжки 1px між клітинками не бруднимось); (2) силуети і зброя солдата й
// прибульця відрізняються; (3) малювання детерміноване (той самий вхід → той самий
// потік викликів, без RNG); (4) читабельність стану (HP, вибір, заступа).

import { describe, expect, it } from 'vitest';
import { drawAlienSprite, drawBaseSprite, drawSoldierSprite, drawUfoSprite, type UnitSprite } from './render';

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

// Піксельні межі всіх точок, яких торкається малювання: arc — центр ± r,
// ellipse — центр ± rx/ry, moveTo/lineTo — точка, fillRect/strokeRect — прямокутник,
// fillText — точка. Stroke розширює межі на lineWidth/2 — лишаємо запас ≥ 1px.
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

describe('солдат і прибульчик: різні силуети, зброя відрізняється (П6.7)', () => {
  it('солдат — круглий корпус (arc), прибульчик — овал (ellipse)', () => {
    const s = mockCtx();
    drawSoldierSprite(s.ctx, soldier());
    expect(s.calls.some((c) => c.m === 'arc')).toBe(true);
    expect(s.calls.some((c) => c.m === 'ellipse')).toBe(false);

    const a = mockCtx();
    drawAlienSprite(a.ctx, alien());
    expect(a.calls.some((c) => c.m === 'ellipse')).toBe(true);
  });

  it('«АР-14 Гарт»: у солдата один довгий прямий сегмент — ствол (дуло за межами тіла)', () => {
    const { ctx, calls } = mockCtx();
    drawSoldierSprite(ctx, soldier());
    const segs: number[] = [];
    let cur: { x: number; y: number } | null = null;
    for (const c of calls) {
      if (c.m === 'moveTo') cur = { x: (c.args as number[])[0], y: (c.args as number[])[1] };
      else if (c.m === 'lineTo' && cur) {
        segs.push(Math.hypot((c.args as number[])[0] - cur.x, (c.args as number[])[1] - cur.y));
        cur = { x: (c.args as number[])[0], y: (c.args as number[])[1] };
      }
    }
    expect(segs.some((len) => len > R * 1.5)).toBe(true); // ствал довший за півтора радіуси
  });

  it('«Імпульсний різак»: у прибульця немає прямих сегментів як у ствола — зброя «вилка» з піками над тілом', () => {
    const { ctx, calls } = mockCtx();
    drawAlienSprite(ctx, alien());
    const segs: number[] = [];
    let cur: { x: number; y: number } | null = null;
    for (const c of calls) {
      if (c.m === 'moveTo') cur = { x: (c.args as number[])[0], y: (c.args as number[])[1] };
      else if (c.m === 'lineTo' && cur) {
        segs.push(Math.hypot((c.args as number[])[0] - cur.x, (c.args as number[])[1] - cur.y));
        cur = { x: (c.args as number[])[0], y: (c.args as number[])[1] };
      }
    }
    expect(segs.every((len) => len < R * 1.5)).toBe(true); // жодного «ствола» — тільки щупальця і вилка
    // піки вилки — точки різака вище тіла (y < cy − r)
    expect(calls.some((c) => c.m === 'lineTo' && (c.args as number[])[1] < CY - R)).toBe(true);
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

  it('рамка вибору — коло радіусом r+2 лише коли selected', () => {
    const sel = mockCtx();
    drawSoldierSprite(sel.ctx, soldier({ selected: true }));
    expect(sel.calls.some((c) => c.m === 'arc' && (c.args as number[])[2] === R + 2)).toBe(true);

    const notSel = mockCtx();
    drawSoldierSprite(notSel.ctx, soldier());
    expect(notSel.calls.some((c) => c.m === 'arc' && (c.args as number[])[2] === R + 2)).toBe(false);
  });

  it('маркер заступи — 4×4 у межах клітинки: солдат над силуетом, прибульчик під (П6.6)', () => {
    const s = mockCtx();
    drawSoldierSprite(s.ctx, soldier({ overwatch: true }));
    const ow = s.calls.find((c) => c.m === 'fillRect' && (c.args as number[])[3] === 4 && (c.args as number[])[2] === 4);
    expect(ow).toBeDefined();
    expect((ow!.args as number[])[1]).toBe(CY - R - 4);

    const a = mockCtx();
    drawAlienSprite(a.ctx, alien({ overwatch: true }));
    const owA = a.calls.find((c) => c.m === 'fillRect' && (c.args as number[])[3] === 4 && (c.args as number[])[2] === 4);
    expect(owA).toBeDefined();
    expect((owA!.args as number[])[1]).toBe(CY + R);
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

describe('спрайти геосцени (статична інтеграція П6.7)', () => {
  it('база: квадрат із контуром і написом «БАЗА» у центрі', () => {
    const { ctx, calls } = mockCtx();
    drawBaseSprite(ctx, { cx: 18, cy: 18, size: 36 });
    expect(calls.some((c) => c.m === 'fillRect')).toBe(true);
    expect(calls.some((c) => c.m === 'strokeRect')).toBe(true);
    expect(calls.some((c) => c.m === 'fillText' && c.args[0] === 'БАЗА')).toBe(true);
  });

  it('НЛО: приземлився — залитий квадрат; «розвідник» — ромб; «збирач» — контур квадрата', () => {
    const landed = mockCtx();
    drawUfoSprite(landed.ctx, { cx: 18, cy: 18, r: 11, landed: true, kind: 'розвідник' });
    expect(landed.calls.some((c) => c.m === 'fillRect')).toBe(true);
    expect(landed.calls.some((c) => c.m === 'strokeRect')).toBe(false);

    const scout = mockCtx();
    drawUfoSprite(scout.ctx, { cx: 18, cy: 18, r: 11, landed: false, kind: 'розвідник' });
    expect(scout.calls.some((c) => c.m === 'closePath')).toBe(true); // ромб
    expect(scout.calls.some((c) => c.m === 'strokeRect')).toBe(false);

    const harv = mockCtx();
    drawUfoSprite(harv.ctx, { cx: 18, cy: 18, r: 11, landed: false, kind: 'збирач' });
    expect(harv.calls.some((c) => c.m === 'strokeRect')).toBe(true);
    expect(harv.calls.some((c) => c.m === 'closePath')).toBe(false);
  });
});
