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
  BOOM_MS,
  BOOM_PARTICLES,
  DEATH_MS,
  DNUM_MS,
  IMPACT_MS,
  MOVE_MS_PER_CELL,
  OW_FLASH_MS,
  RADAR_PULSE_MS,
  TRACER_MS,
  makeDeathAnim,
  makeDNumAnim,
  makeGeoPulseAnim,
  makeMoveAnim,
  makeOwFlashAnim,
  makeTracerAnim,
  makeBoomAnim,
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
    drawAnimFrame(ctx, a, MOVE_MS_PER_CELL, 48, 8); // t = 0.5 → клітинка (1,0)
    const d = calls.find((c) => c.m === 'drawImage');
    expect(d).toBeDefined();
    expect((d!.args as number[])[1]).toBe(72 - 16); // центр клітинки (1,0) мінус половина спрайта (П14.3: BCELL 48)
    expect((d!.args as number[])[2]).toBe(24 - 16);
    expect((d!.args as number[])[3]).toBe(32);
    expect((d!.args as number[])[4]).toBe(32);
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
    drawAnimFrame(f0.ctx, a, 0, 48, 8); // t = 0 → кадр «стій»
    const f1 = animCtx();
    drawAnimFrame(f1.ctx, a, MOVE_MS_PER_CELL / 2, 48, 8); // t = 0.25 → кадр «крок»
    expect(f0.calls.find((c) => c.m === 'drawImage')!.args[0]).not.toBe(f1.calls.find((c) => c.m === 'drawImage')!.args[0]);
  });

  it('трасер: фаза польоту — відрізок від стрільця до цілі; влучання — кільце, що росте і гасне', () => {
    const a = makeTracerAnim('player', { x: 1, y: 1 }, { x: 3, y: 1 }, true);
    a.start = 0;
    expect(a.dur).toBe(TRACER_MS + IMPACT_MS);
    const fly = animCtx();
    drawAnimFrame(fly.ctx, a, TRACER_MS / 2, 48, 8); // t* — куля на півдорозі
    const head = fly.calls.find((c) => c.m === 'lineTo');
    expect(head).toBeDefined();
    expect((head!.args as number[])[0]).toBeCloseTo(120, 5); /* 72 + 96 * 0.5 */
    expect(fly.calls.some((c) => c.m === 'arc')).toBe(false); // спалаху ще немає

    const boom = animCtx();
    drawAnimFrame(boom.ctx, a, TRACER_MS + IMPACT_MS / 2, 48, 8); // фаза 2: спалах
    const ring = boom.calls.find((c) => c.m === 'arc');
    expect(ring).toBeDefined();
    expect((ring!.args as number[])[0]).toBe(168); /* центр клітинки цілі (3,1): 3*48+24 */
    const alphas = boom.sets.filter((s) => s.p === 'globalAlpha').map((s) => s.v);
    expect(alphas[0]).toBeLessThan(1); // кільце гасне
    expect(alphas[alphas.length - 1]).toBe(1); // альфа відновлена
  });

  it('трасер-промах: лише політ кулі — без спалаху-кільця', () => {
    const a = makeTracerAnim('alien', { x: 5, y: 5 }, { x: 3, y: 5 }, false);
    a.start = 0;
    expect(a.dur).toBe(TRACER_MS);
    const { ctx, calls } = animCtx();
    drawAnimFrame(ctx, a, TRACER_MS - 10, 48, 8);
    expect(calls.some((c) => c.m === 'lineTo')).toBe(true);
    expect(calls.some((c) => c.m === 'arc')).toBe(false);
  });

  it('смерть: силует згасає (alpha спадає і відновлюється), позиція — клітинка загиблого', () => {
    const a = makeDeathAnim(unit('a1', 'alien', 4, 7));
    a.start = 0;
    expect(a.dur).toBe(DEATH_MS);
    expect(a.at).toEqual({ x: 4, y: 7 });
    const { ctx, calls, sets } = animCtx();
    drawAnimFrame(ctx, a, DEATH_MS / 2, 48, 8); // t = 0.5
    const d = calls.find((c) => c.m === 'drawImage'); // прибульчик — піксельний спрайт
    expect(d).toBeDefined();
    expect((d!.args as number[])[1]).toBe(4 * 48 + 24 - 16);
    expect((d!.args as number[])[2]).toBe(7 * 48 + 24 - 16);
    const alphas = sets.filter((s) => s.p === 'globalAlpha').map((s) => s.v);
    expect(alphas[0]).toBeCloseTo(0.5, 5);
    expect(alphas[alphas.length - 1]).toBe(1);
  });

  it('дозор: пульс-кільце кольору маркера дозору, що росте і гасне', () => {
    const a = makeOwFlashAnim(unit('s2', 'player', 6, 9));
    a.start = 0;
    const { ctx, calls, sets } = animCtx();
    drawAnimFrame(ctx, a, OW_FLASH_MS / 2, 48, 8);
    const ring = calls.find((c) => c.m === 'arc');
    expect(ring).toBeDefined();
    expect((ring!.args as number[])[0]).toBe(6 * 48 + 24);
    expect((ring!.args as number[])[1]).toBe(9 * 48 + 24);
    expect(sets.some((s) => s.p === 'strokeStyle' && s.v === '#ffb347')).toBe(true);
    expect(sets.filter((s) => s.p === 'globalAlpha').map((s) => s.v)[0]).toBeCloseTo(0.5, 5);
  });
});

// --- П6.9 (ADR-0029): мінімальний арт геосцени — м'які позначки НЛО, пульс радара ---

describe('П6.9: пульс радара геосцени (критерії: туман і траєкторія незмінні)', () => {
  const MAXR = 216; // (RADAR_RANGE + 0.5) * GCELL = 4.5 * 48 (П14.5: міграція 44→48)

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
    drawAnimFrame(mid.ctx, a, 1000 + RADAR_PULSE_MS / 2, 48, 0);
    const midArc = mid.calls.find((c) => c.m === 'arc');
    expect(midArc).toBeDefined();
    const midR = (midArc!.args as number[])[2];
    expect(midR).toBeGreaterThan(2);
    expect(midR).toBeLessThan(MAXR);
    const end = animCtx();
    drawAnimFrame(end.ctx, a, 1000 + RADAR_PULSE_MS, 48, 0);
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
    drawAnimFrame(a0.ctx, a, 1000, 48, 0);
    const alpha0 = a0.sets.find((p) => p.p === 'globalAlpha')!.v as number;
    const alphaMid = mid.sets.find((p) => p.p === 'globalAlpha')!.v as number;
    expect(alphaMid).toBeLessThan(alpha0);
  });

  it('пульс не анімує НЛО: лише кільце — без спрайтів, заливок і тексту (туман, критерій П6.9)', () => {
    const a = makeGeoPulseAnim(18, 18, MAXR);
    a.start = 1000;
    const s = animCtx();
    drawAnimFrame(s.ctx, a, 1150, 48, 0);
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
    drawAnimFrame(s1.ctx, mk(), 1150, 48, 0);
    const s2 = animCtx();
    drawAnimFrame(s2.ctx, mk(), 1150, 48, 0);
    expect(s1.calls).toEqual(s2.calls);
    expect(s1.sets).toEqual(s2.sets);
  });
});

describe('П6.13 (П12.7): неонові трасери/спалахи — ціан «Рубіж», пурпур Розриву, бурштин (ADR-0064)', () => {
  it('трасер гравця: неоновий ціан зі свіченням (shadowBlur встановлено і скинуто)', () => {
    const a = makeTracerAnim('player', { x: 1, y: 1 }, { x: 3, y: 1 }, false);
    a.start = 0;
    const s = animCtx();
    drawAnimFrame(s.ctx, a, TRACER_MS / 2, 48, 8);
    expect(s.sets.some((x) => x.p === 'strokeStyle' && x.v === '#00e5ff')).toBe(true);
    const glows = s.sets.filter((x) => x.p === 'shadowBlur').map((x) => x.v);
    expect(glows[0]).toBe(6);
    expect(glows[glows.length - 1]).toBe(0); // свічення обов'язково скидається
  });

  it('трасер Розриву: неоновий пурпур; спалах влучання — бурштиновий, зі свіченням', () => {
    const a = makeTracerAnim('alien', { x: 5, y: 5 }, { x: 3, y: 5 }, true);
    a.start = 0;
    const fly = animCtx();
    drawAnimFrame(fly.ctx, a, TRACER_MS / 2, 48, 8);
    expect(fly.sets.some((x) => x.p === 'strokeStyle' && x.v === '#ff2e88')).toBe(true);
    const boom = animCtx();
    drawAnimFrame(boom.ctx, a, TRACER_MS + IMPACT_MS / 2, 48, 8);
    expect(boom.sets.some((x) => x.p === 'strokeStyle' && x.v === '#ffb347')).toBe(true);
    expect(boom.sets.some((x) => x.p === 'shadowColor' && x.v === '#ffb347')).toBe(true);
    const glows = boom.sets.filter((x) => x.p === 'shadowBlur').map((x) => x.v);
    expect(glows[0]).toBe(8);
    expect(glows[glows.length - 1]).toBe(0);
  });
});

describe('П14.4 (ADR-0072/0064): вибух гранати — зона, спалах-кільце, частинки', () => {
  it('boom: зона «епіцентр + хрест» (5 рамок, дзеркало прев’ю гранати), кільце з епіцентру і 12 частинок', () => {
    const a = makeBoomAnim({ x: 5, y: 2 });
    a.start = 0;
    expect(a.dur).toBe(BOOM_MS);
    const s = animCtx();
    drawAnimFrame(s.ctx, a, BOOM_MS / 2, 48, 8, 960, 960);
    expect(s.calls.filter((c) => c.m === 'strokeRect')).toHaveLength(5); // епіцентр + 4 хрести
    const ring = s.calls.find((c) => c.m === 'arc');
    expect(ring).toBeDefined();
    expect((ring!.args as number[])[0]).toBe(5 * 48 + 24); // центр епіцентру
    expect((ring!.args as number[])[1]).toBe(2 * 48 + 24);
    expect(s.sets.some((x) => x.p === 'strokeStyle' && x.v === '#ffb347')).toBe(true); // бурштиновий спалах
    const parts = s.calls.filter((c) => c.m === 'fillRect');
    expect(parts).toHaveLength(BOOM_PARTICLES); // ≤ 12 одночасних частинок
    const alphas = s.sets.filter((x) => x.p === 'globalAlpha').map((x) => x.v);
    expect(alphas[alphas.length - 1]).toBe(1); // альфа відновлена (кадр не тече)
  });

  it('boom: частинки не виходять за межі канви (клімп) — епіцентр біля краю, максимальний розліт', () => {
    const a = makeBoomAnim({ x: 19, y: 0 }); // правий верхній кут бойовища
    a.start = 0;
    const s = animCtx();
    drawAnimFrame(s.ctx, a, BOOM_MS, 48, 8, 960, 960); // t=1 — найдаліший розліт
    for (const p of s.calls.filter((c) => c.m === 'fillRect')) {
      const [x, y, w, h] = p.args as number[];
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x + w).toBeLessThanOrEqual(960);
      expect(y + h).toBeLessThanOrEqual(960);
    }
  });

  it('детермінізм частинок (ADR-0003): той самий вхід → той самий потік Canvas-викликів і присвоєнь', () => {
    const mk = (): ReturnType<typeof makeBoomAnim> => {
      const a = makeBoomAnim({ x: 5, y: 2 });
      a.start = 100;
      return a;
    };
    const s1 = animCtx();
    drawAnimFrame(s1.ctx, mk(), 100 + BOOM_MS / 2, 48, 8, 960, 960);
    const s2 = animCtx();
    drawAnimFrame(s2.ctx, mk(), 100 + BOOM_MS / 2, 48, 8, 960, 960);
    expect(s1.calls).toEqual(s2.calls);
    expect(s1.sets).toEqual(s2.sets);
  });
});

describe('П14.4 (ADR-0072/0064): плаваючі числа пошкоджень/зцілення', () => {
  it('dnum: підйом (y спадає) і згасання (alpha), текст «-N» бурштин на темній плашці', () => {
    const a = makeDNumAnim({ x: 3, y: 4 }, 7, false);
    a.start = 0;
    expect(a.dur).toBe(DNUM_MS);
    const t0 = animCtx();
    drawAnimFrame(t0.ctx, a, 0, 48, 8, 960, 960);
    const t1 = animCtx();
    drawAnimFrame(t1.ctx, a, DNUM_MS, 48, 8, 960, 960);
    const txt0 = t0.calls.find((c) => c.m === 'fillText');
    const txt1 = t1.calls.find((c) => c.m === 'fillText');
    expect(txt0!.args[0]).toBe('-7');
    expect((txt1!.args as number[])[2]).toBeLessThan((txt0!.args as number[])[2]); // підйом (y спадає)
    expect(t0.sets.some((x) => x.p === 'fillStyle' && x.v === '#ffb347')).toBe(true); // бурштин
    expect(t0.sets.some((x) => x.p === 'fillStyle' && x.v === 'rgba(10,13,18,0.85)')).toBe(true); // плашка
    const a0 = t0.sets.find((x) => x.p === 'globalAlpha')!.v as number;
    const a1 = t1.sets.filter((x) => x.p === 'globalAlpha').map((x) => x.v)[0] as number;
    expect(a1).toBeLessThan(a0); // згасання за прогресом
    expect(
      t1.sets
        .filter((x) => x.p === 'globalAlpha')
        .map((x) => x.v)
        .pop()
    ).toBe(1); // альфа відновлена
  });

  it('dnum-зцілення: текст «+N», зелений колір', () => {
    const a = makeDNumAnim({ x: 3, y: 4 }, 3, true);
    a.start = 0;
    const s = animCtx();
    drawAnimFrame(s.ctx, a, 0, 48, 8, 960, 960);
    expect(s.calls.find((c) => c.m === 'fillText')!.args[0]).toBe('+3');
    expect(s.sets.some((x) => x.p === 'fillStyle' && x.v === '#7fe2a0')).toBe(true);
  });

  it('dnum: число біля правого краю канви не виходить за межі — клімп як drawChanceLabel', () => {
    const a = makeDNumAnim({ x: 19, y: 4 }, 12, false); // «-12» біля правого краю
    a.start = 0;
    const s = animCtx();
    drawAnimFrame(s.ctx, a, 0, 48, 8, 940, 960); // вузька канва — краю досягається
    const [px, , pw] = s.calls.find((c) => c.m === 'fillRect')!.args as number[];
    expect(px).toBe(940 - ('-12'.length * 6 + 4) - 1); // клімп правого краю (3 символи → 22px)
    expect(px + pw).toBeLessThanOrEqual(940);
  });
});
