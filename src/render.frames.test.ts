// src/render.frames.test.ts
// Т.2 (тестовий рефакторинг, ADR-0038/пR.3): тести кадрів анімаційного шару
// (drawAnimFrame: трасер/спалах/смерть/дозор/хід, пульс радара, неонові
// трасери/спалахи) через мок-контексти (П6.7/П6.8/П6.9/П6.13, ADR-0029).
// пR.3 (ADR-0038): чиста логіка рушія (черга з планувальником, перетворювач
// подій логу, тряска) — у src/core/render-core.test.ts; тут — лише
// Canvas-виклики. Тести піксель-спрайтів — у src/render.sprites.test.ts.

import { beforeEach, describe, expect, it } from 'vitest';
import { drawAnimFrame, initPixelSprites, muzzlePoint, steepShot, type MakeOffscreen } from './render';
import {
  DISSOLVE_STRIP,
  RECOIL_PX,
  SPARKS,
  recoilPx,
  RING_DY,
  RING_RX,
  RING_RY,
  fighterLook,
  BOOM_MS,
  BOOM_PARTICLES,
  DEATH_MS,
  DNUM_MS,
  GEO_TRAIL_MS,
  IMPACT_MS,
  MOVE_MS_PER_CELL,
  OW_FLASH_MS,
  RADAR_PULSE_MS,
  TRACER_MS,
  makeDeathAnim,
  makeDNumAnim,
  makeGeoPulseAnim,
  makeGeoScanAnim,
  makeGeoTrailAnim,
  makeMoveAnim,
  makeOwFlashAnim,
  makeTracerAnim,
  makeBoomAnim,
  calmAnim,
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

  it('смерть: силует розчиняється смугами і блідне (Т.132), позиція — клітинка загиблого', () => {
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
    expect(alphas[0]).toBeCloseTo(0.7, 5); // 1 − 0,6 · t
    expect(alphas[alphas.length - 1]).toBe(1);
    // маска смуг: clip між save/restore; на t = 0,5 частину смуг уже прибрано
    const strips = calls.filter((c) => c.m === 'rect');
    expect(calls.some((c) => c.m === 'clip')).toBe(true);
    expect(strips.length).toBeGreaterThan(0);
    expect(strips.length).toBeLessThan(48 / DISSOLVE_STRIP);
    expect(calls.findIndex((c) => c.m === 'restore')).toBeGreaterThan(calls.findIndex((c) => c.m === 'clip'));
    // пил: DUST частинок 2 × 2 кольору сторони після маски
    expect(calls.filter((c) => c.m === 'fillRect' && (c.args as number[])[2] === 2)).toHaveLength(8);
    expect(sets.some((x) => x.p === 'fillStyle' && x.v === '#ff2e88')).toBe(true);
  });

  it('смерть на t = 0: кадр цілий (усі смуги), пилу ще немає', () => {
    const a = makeDeathAnim(unit('a1', 'alien', 4, 7));
    a.start = 0;
    const { ctx, calls } = animCtx();
    drawAnimFrame(ctx, a, 0, 48, 8);
    expect(calls.filter((c) => c.m === 'rect')).toHaveLength(48 / DISSOLVE_STRIP);
    expect(calls.some((c) => c.m === 'fillRect' && (c.args as number[])[2] === 2)).toBe(false);
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

describe('фідбек власника 2026-10-22: якір дула — трасер бою стартує з дулового спалаху кадру fire', () => {
  it('без підказки (геосцена, перехоплення): старт — центр клітинки, як раніше', () => {
    const a = makeTracerAnim('alien', { x: 5, y: 5 }, { x: 3, y: 5 }, false);
    a.start = 0;
    const { ctx, calls } = animCtx();
    drawAnimFrame(ctx, a, TRACER_MS / 2, 48, 8);
    const mv = calls.find((c) => c.m === 'moveTo');
    expect(mv).toBeDefined();
    expect((mv!.args as number[])[0]).toBe(5 * 48 + 24); // центр клітинки (5,5)
    expect((mv!.args as number[])[1]).toBe(5 * 48 + 24);
  });

  // Т.132 (ADR-0121): кадр 68 px, якір у просторі кадру 96 (виміряно по атласу):
  // початок кадру — (c − 34, c − 47) для центру клітинки c; дуло — + round(якір · 68 / 96).
  const tracerStart = (side: 'player' | 'alien', from: number, to: number, flip: boolean): number[] => {
    const a = makeTracerAnim(side, { x: from, y: 5 }, { x: to, y: 5 }, false);
    a.start = 0;
    const { ctx, calls } = animCtx();
    drawAnimFrame(ctx, a, TRACER_MS / 2, 48, 8, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, { side, flip });
    const mv = calls.find((c) => c.m === 'moveTo');
    expect(mv).toBeDefined();
    return (mv!.args as number[]).slice(0, 2);
  };

  it('демон (натив, вліво): старт — дуло фазового різака, лівий край кадру', () => {
    expect(tracerStart('alien', 5, 3, false)).toEqual([264 - 31, 264 - 12]); // п17.5: (4,49) → +3, +35
  });

  it('демон (дзеркало, вправо): дуло віддзеркалене до правого краю (x → 96 − x)', () => {
    expect(tracerStart('alien', 5, 7, true)).toEqual([264 + 31, 264 - 12]); // 92 → +65
  });

  it('солдат: дуло — правий край кадру fire, на рівні зброї', () => {
    expect(tracerStart('player', 5, 7, false)).toEqual([264 + 21, 264 - 15]); // (78,45) → +55, +32
  });

  it('солдат (дзеркало, вліво): дзеркальне дуло ліворуч', () => {
    expect(tracerStart('player', 5, 3, true)).toEqual([264 - 21, 264 - 15]); // 18 → +13
  });

  it('п17.5: muzzlePoint за типом ворога — якір свого ряду атласа (голем (10,52) — п21.5, латунний, око (26,64))', () => {
    expect(muzzlePoint('alien', false, 264, 264, 0, 'golem')).toEqual({ x: 230 + 7, y: 217 + 37 });
    expect(muzzlePoint('alien', true, 264, 264, 0, 'eye')).toEqual({ x: 230 + 50, y: 217 + 45 }); // 96 − 26 = 70 → 50
    expect(muzzlePoint('alien', false, 264, 264, 0, 'demon')).toEqual(muzzlePoint('alien', false, 264, 264));
  });

  it('п17.5: удар гончака (`melee`) — три риски кігтів на цілі, без лінії від стрільця і спалаху дула', () => {
    const a = makeTracerAnim('alien', { x: 5, y: 5 }, { x: 4, y: 5 }, true);
    a.melee = true;
    a.start = 0;
    const { ctx, calls } = animCtx();
    drawAnimFrame(ctx, a, TRACER_MS / 2, 48, 8, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, {
      side: 'alien',
      flip: false,
      kind: 'hound',
    });
    const moves = calls.filter((c) => c.m === 'moveTo').map((c) => c.args as number[]);
    expect(moves).toHaveLength(3);
    for (const [x, y] of moves) {
      expect(Math.abs(x! - 216)).toBeLessThanOrEqual(14); // біля центру цілі (4,5): 216, 264
      expect(Math.abs(y! - 264)).toBeLessThanOrEqual(14);
    }
    expect(calls.some((c) => c.m === 'arc')).toBe(false); // спалаху дула немає
  });

  it('muzzlePoint: віддача зсуває дуло назад від погляду', () => {
    expect(muzzlePoint('player', false, 264, 264, 3)).toEqual({ x: 264 + 21 - 3, y: 264 - 15 });
    expect(muzzlePoint('alien', false, 264, 264, 3)).toEqual({ x: 264 - 31 + 3, y: 264 - 12 });
    expect(muzzlePoint('player', true, 264, 264, 3)).toEqual({ x: 264 - 21 + 3, y: 264 - 15 });
  });
});

// Т.132 (ADR-0121): спалах дула і іскри влучання
describe('Т.132: спалах дула, віддача, іскри', () => {
  it('спалах дула — у першій третині польоту кулі і лише з підказкою бойовища', () => {
    const a = makeTracerAnim('player', { x: 5, y: 5 }, { x: 9, y: 5 }, true);
    a.start = 0;
    const early = animCtx();
    drawAnimFrame(early.ctx, a, TRACER_MS * 0.1, 48, 8, 960, 960, { side: 'player', flip: false });
    const arcs = early.calls.filter((c) => c.m === 'arc');
    expect(arcs).toHaveLength(2); // ореол і ядро
    // на початку — віддача 3 px: центр спалаху = дуло з віддачею
    expect((arcs[0]!.args as number[]).slice(0, 2)).toEqual([264 + 21 - 3, 264 - 15]);
    const late = animCtx();
    drawAnimFrame(late.ctx, a, TRACER_MS * 0.8, 48, 8, 960, 960, { side: 'player', flip: false });
    expect(late.calls.some((c) => c.m === 'arc')).toBe(false);
    const geo = animCtx();
    drawAnimFrame(geo.ctx, a, TRACER_MS * 0.1, 48, 8);
    expect(geo.calls.some((c) => c.m === 'arc')).toBe(false); // геосцена — без спалаху
  });

  it('recoilPx: 3 px у першій чверті кулі, 1 px у другій, далі 0', () => {
    expect(recoilPx(0, 0.4)).toBe(0);
    expect(recoilPx(0.05, 0.4)).toBe(RECOIL_PX);
    expect(recoilPx(0.15, 0.4)).toBe(1);
    expect(recoilPx(0.25, 0.4)).toBe(0);
    expect(recoilPx(0.9, 0.4)).toBe(0);
  });

  it('влучання: кільце і SPARKS іскор 3 × 3 у межах канви; промах — без іскор', () => {
    const hit = makeTracerAnim('player', { x: 15, y: 5 }, { x: 19, y: 0 }, true);
    hit.start = 0;
    for (const now of [TRACER_MS + 1, hit.dur * 0.7, hit.dur]) {
      const s = animCtx();
      drawAnimFrame(s.ctx, hit, now, 48, 8, 960, 960);
      const sparks = s.calls.filter((c) => c.m === 'fillRect');
      expect(sparks).toHaveLength(SPARKS);
      for (const c of sparks) {
        const [x, y, w, h] = c.args as number[];
        expect(w).toBe(3);
        expect(h).toBe(3);
        expect(x).toBeGreaterThanOrEqual(0);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(x + w).toBeLessThanOrEqual(960);
        expect(y + h).toBeLessThanOrEqual(960);
      }
    }
    const miss = makeTracerAnim('player', { x: 5, y: 5 }, { x: 9, y: 5 }, false);
    miss.start = 0;
    const m = animCtx();
    drawAnimFrame(m.ctx, miss, miss.dur * 0.7, 48, 8, 960, 960);
    expect(m.calls.some((c) => c.m === 'fillRect')).toBe(false);
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
  it('п22.7 (ADR-0189): пошкодження 0 — напис «щит» (поглинув «Щит»), зцілення 0 — «+0»', () => {
    const t = animCtx();
    const a = makeDNumAnim({ x: 3, y: 4 }, 0, false);
    a.start = 0;
    drawAnimFrame(t.ctx, a, 0, 48, 8, 960, 960);
    expect(t.calls.find((c) => c.m === 'fillText')!.args[0]).toBe('щит');
    const h = animCtx();
    const b = makeDNumAnim({ x: 3, y: 4 }, 0, true);
    b.start = 0;
    drawAnimFrame(h.ctx, b, 0, 48, 8, 960, 960);
    expect(h.calls.find((c) => c.m === 'fillText')!.args[0]).toBe('+0');
  });

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

// --- П14.5 (ADR-0072/0064): скан-радар 2.0 і хвіст перехоплення ---

describe('П14.5: скан-радар 2.0 (gscan) — сектор-розгортка + кільця, що гаснуть', () => {
  const MAXR = 216; // (RADAR_RANGE + 0.5) * GCELL = 4.5 * 48
  const mk = (): ReturnType<typeof makeGeoScanAnim> => {
    const a = makeGeoScanAnim(384, 192, MAXR); // база (8,4): 8*48+24, 4*48+24
    a.start = 1000;
    return a;
  };

  it('кільця у межах зони радара і ростуть; сектор робить повний оберт', () => {
    const a = mk();
    const mid = animCtx();
    drawAnimFrame(mid.ctx, a, 1000 + RADAR_PULSE_MS / 2, 48, 0, 768, 384);
    // 2 кільця + клин сектора; усі радіуси — у межах зони (≤ MAXR)
    const arcs = mid.calls.filter((c) => c.m === 'arc');
    expect(arcs.length).toBe(3);
    for (const arc of arcs) {
      const args = arc.args as number[];
      expect(args[0]).toBe(384);
      expect(args[1]).toBe(192);
      expect(args[2]).toBeGreaterThan(0);
      expect(args[2]).toBeLessThanOrEqual(MAXR);
    }
    // кільце росте: радіус першого кільця на півдорозжі менший за кінцевий
    const midRing = (arcs[0]!.args as number[])[2];
    const end = animCtx();
    drawAnimFrame(end.ctx, a, 1000 + RADAR_PULSE_MS, 48, 0, 768, 384);
    const endRing = (end.calls.filter((c) => c.m === 'arc')[0]!.args as number[])[2];
    expect(endRing).toBeCloseTo(MAXR);
    expect(midRing).toBeLessThan(endRing);
    // сектор обертається: кут переднього крау (кінцевий аргумент клина) зростає
    const wedgeMid = (arcs[2]!.args as number[])[4];
    const early = animCtx();
    drawAnimFrame(early.ctx, a, 1000 + RADAR_PULSE_MS / 4, 48, 0, 768, 384);
    const wedgeEarly = (early.calls.filter((c) => c.m === 'arc')[2]!.args as number[])[4];
    expect(wedgeMid - wedgeEarly).toBeCloseTo(Math.PI / 2, 5); // чверть циклу = 90°
  });

  it('гасне: alpha спадає за прогресом і завжди відновлюється до 1', () => {
    const a = mk();
    const start = animCtx();
    drawAnimFrame(start.ctx, a, 1000, 48, 0, 768, 384);
    const mid = animCtx();
    drawAnimFrame(mid.ctx, a, 1000 + RADAR_PULSE_MS / 2, 48, 0, 768, 384);
    const end = animCtx();
    drawAnimFrame(end.ctx, a, 1000 + RADAR_PULSE_MS, 48, 0, 768, 384);
    for (const s of [start, mid, end]) {
      const alphas = s.sets.filter((p) => p.p === 'globalAlpha').map((p) => p.v);
      expect(alphas[alphas.length - 1]).toBe(1);
      const widths = s.sets.filter((p) => p.p === 'lineWidth').map((p) => p.v);
      expect(widths[widths.length - 1]).toBe(1); // стан кадру не витікає
    }
    const alpha0 = start.sets.find((p) => p.p === 'globalAlpha')!.v as number;
    const alphaMid = mid.sets.find((p) => p.p === 'globalAlpha')!.v as number;
    const alphaEnd = mid.sets
      .filter((p) => p.p === 'globalAlpha')
      .map((p) => p.v)
      .at(-2) as number;
    expect(alphaMid).toBeLessThan(alpha0); // спадає за прогресом
    expect(alphaEnd).toBeLessThanOrEqual(alphaMid);
    // останній кадр — повністю погас: усі alpha ≤ 0 (крім скидання до 1)
    const endAlphas = end.sets.filter((p) => p.p === 'globalAlpha').map((p) => p.v) as number[];
    expect(endAlphas.every((v) => v === 0 || v === 1)).toBe(true);
  });

  it('туман (ADR-0006/0032): розгортка не підсвічує НЛО — без спрайтів і тексту', () => {
    const a = mk();
    const s = animCtx();
    drawAnimFrame(s.ctx, a, 1150, 48, 0, 768, 384);
    expect(s.calls.some((c) => c.m === 'arc')).toBe(true); // скан активний
    expect(s.calls.some((c) => c.m === 'fillText' || c.m === 'drawImage' || c.m === 'ellipse')).toBe(false);
  });

  it('замикання по X (куля): база біля краю — зсунута копія зони в кадрі', () => {
    const a = makeGeoScanAnim(48, 192, MAXR); // база (1,4): cx = 1*48+24
    a.start = 1000;
    const s = animCtx();
    drawAnimFrame(s.ctx, a, 1150, 48, 0, 768, 384);
    const centers = new Set(s.calls.filter((c) => c.m === 'arc').map((c) => (c.args as number[])[0]));
    expect(centers.has(48)).toBe(true); // основна копія
    expect(centers.has(816)).toBe(true); // зсунута на світ вправо (48 + 768)
    // без розміру канви (cw/ch за замовчуванням) — лише основна копія
    const s2 = animCtx();
    drawAnimFrame(s2.ctx, a, 1150, 48, 0);
    const centers2 = new Set(s2.calls.filter((c) => c.m === 'arc').map((c) => (c.args as number[])[0]));
    expect(centers2).toEqual(new Set([48]));
  });

  it('детермінізм (ADR-0003): той самий вхід → той самий потік викликів і присвоєнь', () => {
    const draw = (): { calls: Call[]; sets: { p: string; v: unknown }[] } => {
      const s = animCtx();
      drawAnimFrame(s.ctx, mk(), 1150, 48, 0, 768, 384);
      return { calls: s.calls, sets: s.sets };
    };
    expect(draw()).toEqual(draw());
  });
});

describe('П14.5: хвіст перехоплення (gtrail) — згасаюча ламана останніх позицій', () => {
  it('ламана клітинкових центрів у межах канви; свічення скидається', () => {
    const a = makeGeoTrailAnim([
      { x: 0, y: 2 },
      { x: 1, y: 2 },
      { x: 2, y: 2 },
    ]);
    a.start = 1000;
    const s = animCtx();
    drawAnimFrame(s.ctx, a, 1000 + GEO_TRAIL_MS / 2, 48, 0, 768, 384);
    const mv = s.calls.find((c) => c.m === 'moveTo');
    expect(mv).toBeDefined();
    expect(mv!.args).toEqual([24, 120]); // центр (0,2)
    const lines = s.calls.filter((c) => c.m === 'lineTo').map((c) => c.args);
    expect(lines).toEqual([
      [72, 120],
      [120, 120],
    ]);
    // ціан «Рубіжу» (ADR-0064) і свічення: встановлено та скинуто
    expect(s.sets.some((p) => p.p === 'strokeStyle' && p.v === '#00e5ff')).toBe(true);
    const blurs = s.sets.filter((p) => p.p === 'shadowBlur').map((p) => p.v);
    expect(blurs[blurs.length - 1]).toBe(0);
    const widths = s.sets.filter((p) => p.p === 'lineWidth').map((p) => p.v);
    expect(widths[widths.length - 1]).toBe(1);
  });

  it('точки за межами світу клімпляться у межі канви (критерій: у межах канви)', () => {
    const a = makeGeoTrailAnim([
      { x: 0, y: 0 },
      { x: 16, y: 8 },
    ]);
    a.start = 1000;
    const s = animCtx();
    drawAnimFrame(s.ctx, a, 1100, 48, 0, 768, 384);
    const lt = s.calls.filter((c) => c.m === 'lineTo').at(-1)!.args as number[];
    expect(lt[0]).toBe(767); // cw - 1
    expect(lt[1]).toBe(383); // ch - 1
  });

  it('згасає за прогресом: alpha на середині вища, ближче до кінця — нижча; завжди скидається', () => {
    const a = makeGeoTrailAnim([
      { x: 0, y: 2 },
      { x: 1, y: 2 },
    ]);
    a.start = 1000;
    const sample = (at: number): number[] => {
      const s = animCtx();
      drawAnimFrame(s.ctx, a, at, 48, 0, 768, 384);
      const alphas = s.sets.filter((p) => p.p === 'globalAlpha').map((p) => p.v) as number[];
      expect(alphas[alphas.length - 1]).toBe(1);
      return alphas;
    };
    const mid = sample(1000 + GEO_TRAIL_MS / 2);
    const late = sample(1000 + GEO_TRAIL_MS * 0.9);
    expect(mid[0]).toBeCloseTo(0.5, 5);
    expect(late[0]).toBeCloseTo(0.1, 5);
  });

  it('менше 2 точок — не малюється (порожній хвіст); туман: без спрайтів/тексту', () => {
    const a = makeGeoTrailAnim([{ x: 1, y: 1 }]);
    a.start = 1000;
    const s = animCtx();
    drawAnimFrame(s.ctx, a, 1100, 48, 0, 768, 384);
    expect(s.calls.length).toBe(0);
    // з точками: лише лінія — без позначок НЛО
    const b = makeGeoTrailAnim([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
    b.start = 1000;
    const s2 = animCtx();
    drawAnimFrame(s2.ctx, b, 1100, 48, 0, 768, 384);
    expect(s2.calls.some((c) => c.m === 'fillText' || c.m === 'drawImage' || c.m === 'ellipse')).toBe(false);
  });

  it('детермінізм (ADR-0003): той самий вхід → той самий потік викликів і присвоєнь', () => {
    const draw = (): { calls: Call[]; sets: { p: string; v: unknown }[] } => {
      const s = animCtx();
      drawAnimFrame(
        s.ctx,
        (() => {
          const a = makeGeoTrailAnim([
            { x: 1, y: 1 },
            { x: 2, y: 2 },
            { x: 3, y: 1 },
          ]);
          a.start = 1000;
          return a;
        })(),
        1100,
        48,
        0,
        768,
        384
      );
      return { calls: s.calls, sets: s.sets };
    };
    expect(draw()).toEqual(draw());
  });
});

// Т.129 (ADR-0118): у русі кільце кольору бійця їде з ним (аудит PR #442)
describe('Т.129: кільце в анімації руху', () => {
  it('еліпс кольору бійця за id — у проміжній позиції шляху', () => {
    const a = makeMoveAnim(
      unit('s8', 'player', 0, 0),
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      false
    );
    a.start = 0;
    const { ctx, calls, sets } = animCtx();
    drawAnimFrame(ctx, a, a.dur, 48, 8); // t = 1 → клітинка (1,0)
    const e = calls.find((c) => c.m === 'ellipse' && c.args[2] === RING_RX); // Т.132: перші еліпси — тінь
    expect(e).toBeDefined();
    expect((e!.args as number[]).slice(0, 4)).toEqual([72, 24 + RING_DY, RING_RX, RING_RY]);
    expect(sets.filter((x) => x.p === 'strokeStyle').map((x) => x.v)).toContain(fighterLook('s8').color);
  });
});

// Т.144 (ADR-0125, рішення власника «А. Спокійно»): кадри спокійних копій — без руху
describe('спокійні кадри за «менше руху» (Т.144)', () => {
  const arcR = (calls: Call[]): number[] => calls.filter((c) => c.m === 'arc').map((c) => (c.args as number[])[2]);
  it('хід: боєць проявляється в цілі (згасання навпаки), без кадрів ходьби по шляху', () => {
    const path = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ];
    const a = calmAnim(makeMoveAnim(unit('s1', 'player', 2, 0), path, false));
    a.start = 0;
    const { ctx, calls, sets } = animCtx();
    drawAnimFrame(ctx, a, a.dur / 2, 48, 8);
    const img = calls.filter((c) => c.m === 'drawImage');
    expect(img.length).toBeGreaterThan(0);
    for (const c of img) expect((c.args as number[])[1]).toBeGreaterThanOrEqual(2 * 48 - 20); // лише біля клітинки цілі
    expect(sets.filter((x) => x.p === 'globalAlpha').map((x) => x.v)).toContain(0.5);
  });
  it('постріл з влучанням: уся лінія одразу, без спалаху дула; кільце влучання — на місці, без іскор', () => {
    const a = calmAnim(makeTracerAnim('player', { x: 0, y: 0 }, { x: 3, y: 0 }, true));
    a.start = 0;
    const fly = animCtx();
    drawAnimFrame(fly.ctx, a, 1, 48, 8, 480, 480, { side: 'player', flip: false });
    const line = fly.calls.find((c) => c.m === 'lineTo');
    expect(line?.args).toEqual([3 * 48 + 24, 24]);
    // аудит PR #457: дуло без віддачі (повний трасер на тому кадрі віддає RECOIL_PX)
    const m0 = muzzlePoint('player', false, 24, 24, 0);
    expect(fly.calls.find((c) => c.m === 'moveTo')?.args).toEqual([m0.x, m0.y]);
    const full = makeTracerAnim('player', { x: 0, y: 0 }, { x: 3, y: 0 }, true);
    full.start = 0;
    const ff = animCtx();
    drawAnimFrame(ff.ctx, full, 1, 48, 8, 480, 480, { side: 'player', flip: false });
    expect(ff.calls.find((c) => c.m === 'moveTo')?.args).not.toEqual([m0.x, m0.y]);
    expect(fly.calls.filter((c) => c.m === 'arc')).toHaveLength(0);
    const rings = [a.dur * 0.6, a.dur * 0.95].map((now) => {
      const f = animCtx();
      drawAnimFrame(f.ctx, a, now, 48, 8, 480, 480);
      expect(f.calls.filter((c) => c.m === 'fillRect')).toHaveLength(0); // іскор немає
      return arcR(f.calls);
    });
    expect(rings[0]).toEqual(rings[1]);
    expect(rings[0]).toHaveLength(1);
  });
  it('промах: лише нерухома лінія до цілі на всю тривалість, без кілець і квадратиків', () => {
    const a = calmAnim(makeTracerAnim('alien', { x: 3, y: 0 }, { x: 0, y: 0 }, false));
    a.start = 0;
    for (const k of [0.1, 0.9]) {
      const f = animCtx();
      drawAnimFrame(f.ctx, a, a.dur * k, 48, 8, 480, 480);
      expect(f.calls.find((c) => c.m === 'lineTo')?.args).toEqual([24, 24]);
      expect(f.calls.filter((c) => c.m === 'arc' || c.m === 'fillRect')).toHaveLength(0);
    }
  });
  it('вибух: кільце на місці, без розльоту частинок', () => {
    const a = calmAnim(makeBoomAnim({ x: 2, y: 2 }));
    a.start = 0;
    const r = [0.2, 0.8].map((k) => {
      const f = animCtx();
      drawAnimFrame(f.ctx, a, a.dur * k, 48, 8, 480, 480);
      expect(f.calls.filter((c) => c.m === 'fillRect')).toHaveLength(0);
      return arcR(f.calls);
    });
    expect(r[0]).toEqual(r[1]);
  });
  it('число без підйому; загиблий згасає без смуг і частинок; дозор — кільце на місці', () => {
    const n = calmAnim(makeDNumAnim({ x: 1, y: 2 }, 3, false));
    n.start = 0;
    const y = [0.1, 0.9].map((k) => {
      const f = animCtx();
      drawAnimFrame(f.ctx, n, n.dur * k, 48, 8, 480, 480);
      return (f.calls.find((c) => c.m === 'fillRect')?.args as number[])[1];
    });
    expect(y[0]).toBe(y[1]);
    const d = calmAnim(makeDeathAnim(unit('a1', 'alien', 1, 1)));
    d.start = 0;
    const dd = animCtx();
    drawAnimFrame(dd.ctx, d, d.dur / 2, 48, 8, 480, 480);
    expect(dd.calls.filter((c) => c.m === 'rect' || c.m === 'clip')).toHaveLength(0);
    expect(dd.calls.filter((c) => c.m === 'fillRect' && (c.args as number[])[2] === 2)).toHaveLength(0);
    const o = calmAnim(makeOwFlashAnim(unit('s1', 'player', 1, 1)));
    o.start = 0;
    const r = [0.1, 0.9].map((k) => {
      const f = animCtx();
      drawAnimFrame(f.ctx, o, o.dur * k, 48, 8);
      return arcR(f.calls);
    });
    expect(r[0]).toEqual(r[1]);
  });
  it('скан-радар: нерухоме кільце на краю зони, без сектора-розгортки; пульс — так само', () => {
    const a = calmAnim(makeGeoScanAnim(500, 100, 60));
    a.start = 0;
    for (const k of [0.1, 0.7]) {
      const f = animCtx();
      drawAnimFrame(f.ctx, a, a.dur * k, 24, 0); // без ширини канви — без копій замикання по X
      expect(arcR(f.calls)).toEqual([60]);
      expect(f.calls.filter((c) => c.m === 'fill' || c.m === 'lineTo')).toHaveLength(0);
    }
    const p = calmAnim(makeGeoPulseAnim(100, 100, 60));
    p.start = 0;
    const f = animCtx();
    drawAnimFrame(f.ctx, p, p.dur * 0.2, 24, 0);
    expect(arcR(f.calls)).toEqual([60]);
  });
});

describe('Т.218: промінь на крутих кутах — з центру бійця (рішення власника «Центр корпусу на крутих»)', () => {
  it('steepShot: понад 60° від горизонталі (dy² > 3·dx²); горизонталь і діагональ — ні', () => {
    expect(steepShot({ x: 2, y: 2 }, { x: 2, y: 7 })).toBe(true); // строго вниз
    expect(steepShot({ x: 2, y: 7 }, { x: 3, y: 2 })).toBe(true); // 5 > √3 · 1
    expect(steepShot({ x: 2, y: 2 }, { x: 5, y: 7 })).toBe(false); // 25 < 27 — ≈ 59°
    expect(steepShot({ x: 2, y: 2 }, { x: 6, y: 2 })).toBe(false);
    expect(steepShot({ x: 2, y: 2 }, { x: 2, y: 2 })).toBe(false);
  });
  // п21.6 (ADR-0180): з центру — лише вигляд без кадрів «угору» / «униз» (Т.226: голем і око отримали
  // кадри — тут гончак); решта стріляє з дула свого кадру (src/render.aim.test.ts)
  it('ціль строго вгорі: лінія з центру клітинки стрільця, без спалаху дула; збоку — з дула, як раніше', () => {
    const up = makeTracerAnim('alien', { x: 2, y: 5 }, { x: 2, y: 1 }, false);
    up.start = 0;
    const f = animCtx();
    drawAnimFrame(f.ctx, up, up.dur * 0.1, 48, 8, 480, 480, { side: 'alien', flip: false, kind: 'hound' });
    expect(f.calls.find((c) => c.m === 'moveTo')?.args).toEqual([2 * 48 + 24, 5 * 48 + 24]);
    expect(f.calls.filter((c) => c.m === 'arc')).toHaveLength(0); // спалаху дула немає
    const side = makeTracerAnim('player', { x: 2, y: 5 }, { x: 6, y: 4 }, false);
    side.start = 0;
    const g = animCtx();
    drawAnimFrame(g.ctx, side, side.dur * 0.1, 48, 8, 480, 480, { side: 'player', flip: false });
    expect(g.calls.find((c) => c.m === 'moveTo')?.args).not.toEqual([2 * 48 + 24, 5 * 48 + 24]);
    expect(g.calls.filter((c) => c.m === 'arc').length).toBeGreaterThan(0);
  });
  it('турель (силует кодом) — з кінчика ствола і на крутому куті (аудит PR #534)', () => {
    const up = makeTracerAnim('player', { x: 2, y: 5 }, { x: 2, y: 1 }, false);
    up.start = 0;
    const f = animCtx();
    drawAnimFrame(f.ctx, up, up.dur * 0.1, 48, 8, 480, 480, { side: 'player', flip: false, turret: true });
    expect(f.calls.find((c) => c.m === 'moveTo')?.args).not.toEqual([2 * 48 + 24, 5 * 48 + 24]);
  });
});
