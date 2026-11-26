// src/render.kinds.test.ts
// п17.5 (ADR-0152; аудит PR #510): тип ворога доходить до малювання в кадрах анімаційного шару —
// хід (з «менше руху» і без), смерть (обидва варіанти), трасер (якір дула за підказкою), удар
// гончака («менше руху» — повні риски, промах — бліді). Атлас — мок, завантажений синхронно.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ATLAS_FRAME,
  ATLAS_ROW,
  MUZZLE_ANCHOR,
  drawAnimFrame,
  drawGatePortal,
  drawUnitSprite,
  initPixelSprites,
  turretMuzzle,
  initUnitAtlas,
  muzzlePoint,
  type MakeOffscreen,
} from './render';
import { DEATH_MS, TRACER_MS, makeDeathAnim, makeMoveAnim, makeTracerAnim, type Anim } from './core/render-core';
import { makeEnemy } from './core/enemies';

type Call = { m: string; args: unknown[] };
const atlasImg = { width: 480, height: 480 } as unknown as CanvasImageSource;

// мок offscreen для піксельних спрайтів (знак дозору тощо) — лише заглушка
const make: MakeOffscreen = (w, h) =>
  ({ width: w, height: h, getContext: () => new Proxy({}, { get: () => () => undefined, set: () => true }) }) as never;

function ctxRec(): { ctx: CanvasRenderingContext2D; calls: Call[]; sets: { p: string; v: unknown }[] } {
  const calls: Call[] = [];
  const sets: { p: string; v: unknown }[] = [];
  const ctx = new Proxy(
    {},
    {
      get: (_t, p) => (typeof p === 'string' ? (...args: unknown[]) => void calls.push({ m: p, args }) : undefined),
      set: (_t, p, v) => {
        sets.push({ p: String(p), v });
        return true;
      },
    }
  );
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, sets };
}

const atlasRows = (calls: Call[]): number[] =>
  calls.filter((c) => c.m === 'drawImage' && c.args[0] === atlasImg).map((c) => (c.args[2] as number) / ATLAS_FRAME);

const frame = (a: Anim, t: number, hint?: Parameters<typeof drawAnimFrame>[7]): ReturnType<typeof ctxRec> => {
  a.start = 0;
  const r = ctxRec();
  drawAnimFrame(r.ctx, a, t, 48, 8, 960, 960, hint);
  return r;
};

beforeEach(() => {
  initPixelSprites(make);
  initUnitAtlas((_url, onLoad) => onLoad(atlasImg));
});

describe('п17.5: тип ворога в кадрах анімаційного шару', () => {
  it('хід голема — ряд голема; «менше руху» — теж; демон — ряд 1', () => {
    const g = makeEnemy('golem', 'a1', 0, { x: 3, y: 3 });
    const mv = makeMoveAnim(
      g,
      [
        { x: 3, y: 3 },
        { x: 4, y: 3 },
      ],
      false
    );
    expect(atlasRows(frame(mv, 100).calls)).toEqual([ATLAS_ROW.golem]);
    const calm = makeMoveAnim(
      g,
      [
        { x: 3, y: 3 },
        { x: 4, y: 3 },
      ],
      false
    );
    calm.calm = true;
    expect(atlasRows(frame(calm, 100).calls)).toEqual([ATLAS_ROW.golem]);
    const d = makeEnemy('demon', 'a2', 0, { x: 3, y: 3 });
    expect(
      atlasRows(
        frame(
          makeMoveAnim(
            d,
            [
              { x: 3, y: 3 },
              { x: 4, y: 3 },
            ],
            false
          ),
          100
        ).calls
      )
    ).toEqual([ATLAS_ROW.demon]);
  });

  it('смерть ока — кадр смерті ряду ока; «менше руху» — теж', () => {
    const e = makeEnemy('eye', 'a1', 0, { x: 3, y: 3 });
    expect(atlasRows(frame(makeDeathAnim(e), DEATH_MS / 2).calls)).toEqual([ATLAS_ROW.eye]);
    const calm = makeDeathAnim(e);
    calm.calm = true;
    expect(atlasRows(frame(calm, DEATH_MS / 2).calls)).toEqual([ATLAS_ROW.eye]);
  });

  it('трасер з підказкою голема — старт від якоря дула голема, не демона', () => {
    const a = makeTracerAnim('alien', { x: 5, y: 5 }, { x: 3, y: 5 }, false);
    a.enemyKind = 'golem';
    const mv = frame(a, TRACER_MS / 2, { side: 'alien', flip: false, kind: 'golem' }).calls.find((c) => c.m === 'moveTo');
    const want = muzzlePoint('alien', false, 264, 264, 0, 'golem');
    expect(MUZZLE_ANCHOR.golem).not.toEqual(MUZZLE_ANCHOR.alien);
    expect((mv!.args as number[])[0]).toBeCloseTo(want.x, 0);
    expect(Math.round((mv!.args as number[])[1]!)).toBe(want.y);
  });

  it('удар гончака: «менше руху» — повні риски одразу, промах — бліді (альфа 0,45)', () => {
    const calm = makeTracerAnim('alien', { x: 5, y: 5 }, { x: 4, y: 5 }, true);
    calm.melee = true;
    calm.calm = true;
    const c = frame(calm, 1)
      .calls.filter((x) => x.m === 'lineTo')
      .map((x) => x.args as number[]);
    expect(c).toHaveLength(3);
    for (const [, y] of c) expect(y).toBe(264 + 13); // повна довжина: від y − 13 до y + 13
    const miss = makeTracerAnim('alien', { x: 5, y: 5 }, { x: 4, y: 5 }, false);
    miss.melee = true;
    const m = frame(miss, TRACER_MS / 2);
    expect(m.sets.find((s) => s.p === 'globalAlpha')?.v).toBe(0.45);
    const hit = makeTracerAnim('alien', { x: 5, y: 5 }, { x: 4, y: 5 }, true);
    hit.melee = true;
    expect(frame(hit, 1).sets.find((s) => s.p === 'globalAlpha')?.v).toBe(1);
  });
});

// п18.5 (ADR-0157; рішення власника «А. Кодом»): турель — силует кодом, ствол до точки дула; Брама — портал.
describe('п18.5: турель і портал Брами', () => {
  const view = (over: object) => ({
    side: 'player' as const,
    cx: 100,
    cy: 100,
    r: 8,
    hp: 12,
    maxHp: 12,
    selected: false,
    overwatch: false,
    ring: '#9aa1ab',
    turret: true,
    ...over,
  });

  it('турель — без кадру атласа; ствол закінчується в точці дула турелі (і дзеркально), нижче плашки HP', () => {
    for (const flip of [false, true]) {
      const r = ctxRec();
      drawUnitSprite(r.ctx, view({ flip }));
      expect(atlasRows(r.calls)).toEqual([]);
      const m = turretMuzzle(flip, 100, 100, 0);
      expect(m).toEqual({ x: flip ? 79 : 121, y: 96 });
      expect(m.y).toBeGreaterThan(100 - 12); // плашка HP — до cy − 12
      expect(r.calls.some((c) => c.m === 'lineTo' && c.args[0] === m.x && c.args[1] === m.y)).toBe(true);
      expect(r.calls.filter((c) => c.m === 'arc').length).toBe(2); // башта і сенсор
    }
  });

  it('загибла турель — лише основа, без ствола і башти; без turret — кадр атласа', () => {
    const r = ctxRec();
    drawUnitSprite(r.ctx, view({ hp: 0 }));
    expect(r.calls.filter((c) => c.m === 'arc')).toEqual([]);
    const s = ctxRec();
    drawUnitSprite(s.ctx, view({ turret: undefined }));
    expect(atlasRows(s.calls)).toEqual([0]);
  });

  it('трасер турелі — з кінчика ствола (MuzzleHint.turret), з віддачею назад', () => {
    const tr = makeTracerAnim('player', { x: 2, y: 2 }, { x: 8, y: 2 }, true);
    const r = frame(tr, 1, { side: 'player', flip: false, turret: true });
    const start = r.calls.find((c) => c.m === 'moveTo')!;
    expect(start.args[1]).toBe(2 * 48 + 24 - 4);
    expect(start.args[0] as number).toBeGreaterThan(2 * 48 + 24 + 15);
  });

  it('загибель турелі — розчиняється силуетом кодом, без кадру оперативника (аудит PR #516)', () => {
    const t = { id: 't1', side: 'player', pos: { x: 3, y: 1 }, maxHp: 12, turret: true } as Parameters<typeof makeDeathAnim>[0];
    const d = makeDeathAnim(t);
    expect(d.turret).toBe(true);
    for (const calm of [false, true]) {
      const r = frame({ ...d, calm }, DEATH_MS / 2);
      expect(atlasRows(r.calls)).toEqual([]);
    }
    const s = makeDeathAnim({ ...t, id: 's1', turret: undefined });
    expect('turret' in s).toBe(false);
    expect(atlasRows(frame(s, DEATH_MS / 2).calls)).toEqual([0]);
  });

  it('портал: два еліпси і шість іскор; закритий — приглушений', () => {
    const r = ctxRec();
    drawGatePortal(r.ctx, { cx: 456, cy: 216, size: 48, open: true });
    expect(r.calls.filter((c) => c.m === 'ellipse').length).toBe(2);
    expect(r.calls.filter((c) => c.m === 'fillRect').length).toBe(6);
    expect(r.sets.find((x) => x.p === 'globalAlpha')!.v).toBe(1);
    const c = ctxRec();
    drawGatePortal(c.ctx, { cx: 456, cy: 216, size: 48, open: false });
    expect(c.sets.find((x) => x.p === 'globalAlpha')!.v).toBe(0.45);
  });
});
