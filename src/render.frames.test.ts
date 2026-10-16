// src/render.frames.test.ts
// Т.2 (тестовий рефакторинг, ADR-0038/пR.3): тести кадрів анімаційного шару
// (drawAnimFrame: трасер/спалах/смерть/дозор/хід, пульс радара, неонові
// трасери/спалахи) через мок-контексти (П6.7/П6.8/П6.9/П6.13, ADR-0029).
// пR.3 (ADR-0038): чиста логіка рушія (черга з планувальником, перетворювач
// подій логу, тряска) — у src/core/render-core.test.ts; тут — лише
// Canvas-виклики. Тести піксель-спрайтів — у src/render.sprites.test.ts.

import { beforeEach, describe, expect, it } from 'vitest';
import { drawAnimFrame, initPixelSprites, type MakeOffscreen } from './render';
import {
  DEATH_MS,
  IMPACT_MS,
  MOVE_MS_PER_CELL,
  OW_FLASH_MS,
  RADAR_PULSE_MS,
  TRACER_MS,
  makeDeathAnim,
  makeGeoPulseAnim,
  makeMoveAnim,
  makeOwFlashAnim,
  makeTracerAnim,
} from './core/render-core';
import { makeUnit, type Unit } from './core/combat';

type Call = { m: string; args: unknown[] };

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

  it('дозор: пульс-кільце кольору маркера дозору, що росте і гасне', () => {
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

// --- П6.9 (ADR-0029): мінімальний арт геосцени — м'які позначки НЛО, пульс радара ---

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
