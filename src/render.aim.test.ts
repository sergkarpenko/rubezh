// src/render.aim.test.ts
// п21.6 (ADR-0180): кадри пострілу вгору / вниз атласа бійців — вибір кадру (стовпці 5 і 6) за
// крутим кутом до цілі, якір дула кадру й віддача вздовж кадру; вигляди без кадрів (гончак, турель) —
// бічний кадр і промінь з центру бійця, як у Т.218 (ADR-0171). Т.226 (ADR-0183): кадри голема й ока.
// Атлас — мок, завантажений синхронно.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ATLAS_AIM_COL,
  ATLAS_FRAME,
  ATLAS_POSE_COL,
  ATLAS_ROW,
  MUZZLE_AIM,
  MUZZLE_ANCHOR,
  drawAnimFrame,
  drawUnitSprite,
  hasAimFrames,
  initPixelSprites,
  initUnitAtlas,
  muzzlePoint,
  shotAim,
  type MakeOffscreen,
  type UnitSpriteView,
} from './render';
import { TRACER_MS, UNIT_DRAW, animT, makeTracerAnim, recoilPx, tracerShare, unitFrameOrigin } from './core/render-core';
import report from '../scripts/assets/aim-t224-report.json';

type Call = { m: string; args: unknown[] };
const atlasImg = { width: 672, height: 480 } as unknown as CanvasImageSource;
const make: MakeOffscreen = (w, h) =>
  ({ width: w, height: h, getContext: () => new Proxy({}, { get: () => () => undefined, set: () => true }) }) as never;

function ctxRec(): { ctx: CanvasRenderingContext2D; calls: Call[] } {
  const calls: Call[] = [];
  const ctx = new Proxy(
    {},
    {
      get: (_t, p) => (typeof p === 'string' ? (...args: unknown[]) => void calls.push({ m: p, args }) : undefined),
      set: () => true,
    }
  );
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

// джерело кадру атласа: [стовпець, ряд] і місце на полі [x, y]
const atlasCell = (calls: Call[]): { col: number; row: number; x: number; y: number } => {
  const d = calls.find((c) => c.m === 'drawImage' && c.args[0] === atlasImg)!.args as number[];
  return { col: d[1]! / ATLAS_FRAME, row: d[2]! / ATLAS_FRAME, x: d[5]!, y: d[6]! };
};

const view = (over: Partial<UnitSpriteView>): UnitSpriteView => ({
  side: 'player',
  cx: 120,
  cy: 120,
  r: 8,
  hp: 10,
  maxHp: 10,
  selected: false,
  overwatch: false,
  ring: '#00e5ff',
  pose: 'fire',
  ...over,
});

beforeEach(() => {
  initPixelSprites(make);
  initUnitAtlas((_url, onLoad) => onLoad(atlasImg));
});

describe('п21.6: напрям кадру пострілу і вигляди з кадрами', () => {
  it('shotAim: крутий кут угору — up, униз — down; не крутий і та сама клітинка — немає', () => {
    expect(shotAim({ x: 2, y: 5 }, { x: 2, y: 1 })).toBe('up');
    expect(shotAim({ x: 2, y: 5 }, { x: 3, y: 9 })).toBe('down'); // 16 > 3
    expect(shotAim({ x: 2, y: 2 }, { x: 5, y: 7 })).toBeUndefined(); // ≈ 59° — бічний
    expect(shotAim({ x: 2, y: 2 }, { x: 6, y: 2 })).toBeUndefined();
    expect(shotAim({ x: 2, y: 2 }, { x: 2, y: 2 })).toBeUndefined();
  });
  it('кадри є в оперативника, демона, голема й ока (Т.226); гончак (удар упритул) — без них', () => {
    expect(hasAimFrames('player')).toBe(true);
    expect(hasAimFrames('alien')).toBe(true);
    expect(hasAimFrames('alien', 'demon')).toBe(true);
    expect(hasAimFrames('alien', 'golem')).toBe(true);
    expect(hasAimFrames('alien', 'eye')).toBe(true);
    expect(hasAimFrames('alien', 'hound')).toBe(false);
  });
  it('якорі MUZZLE_AIM — зі звіту конвертера; гончак — без якоря', () => {
    expect(MUZZLE_AIM.player).toEqual({ up: report.soldier!.up.muzzle, down: report.soldier!.down.muzzle });
    expect(MUZZLE_AIM.alien).toEqual({ up: report.demon!.up.muzzle, down: report.demon!.down.muzzle });
    expect(MUZZLE_AIM.golem).toEqual({ up: report.golem!.up.muzzle, down: report.golem!.down.muzzle });
    expect(MUZZLE_AIM.eye).toEqual({ up: report.eye!.up.muzzle, down: report.eye!.down.muzzle });
    expect(MUZZLE_AIM.hound).toBeUndefined();
    // голем у «стій» тримає гармату перед собою — дуло кадру попереду колонки ступнів (Т.226, конвертер)
    expect(MUZZLE_AIM.golem!.up.x).toBeLessThan(report.golem!.anchorX);
    expect(MUZZLE_AIM.golem!.down.x).toBeLessThan(report.golem!.anchorX);
    expect(MUZZLE_AIM.eye!.up.x).toBeLessThan(report.eye!.idleBox[0]!);
    expect(MUZZLE_AIM.eye!.down.x).toBeLessThan(report.eye!.idleBox[0]!);
    // дуло — за переднім краєм «стій» у бік погляду (аудит PR #543: якір на носку чобота лежав під корпусом)
    expect(MUZZLE_AIM.player!.down.x).toBeGreaterThan(report.soldier!.idleBox[2]!);
    expect(MUZZLE_AIM.player!.up.x).toBeGreaterThan(report.soldier!.idleBox[2]!);
    expect(MUZZLE_AIM.alien!.down.x).toBeLessThan(report.demon!.idleBox[0]!);
    expect(MUZZLE_AIM.alien!.up.x).toBeLessThan(report.demon!.idleBox[0]!);
    // ствол угору — вище, униз — нижче за бічний якір того самого вигляду
    for (const k of ['player', 'alien', 'golem', 'eye'] as const) {
      expect(MUZZLE_AIM[k]!.up.y).toBeLessThan(MUZZLE_ANCHOR[k].y);
      expect(MUZZLE_AIM[k]!.down.y).toBeGreaterThan(MUZZLE_ANCHOR[k].y);
    }
  });
});

describe('п21.6: кадр бійця на полі', () => {
  it('поза «вогонь» з aim — стовпці 5 / 6 свого ряду; без aim — бічний кадр 3', () => {
    const r = (v: Partial<UnitSpriteView>): ReturnType<typeof atlasCell> => {
      const c = ctxRec();
      drawUnitSprite(c.ctx, view(v));
      return atlasCell(c.calls);
    };
    expect(r({ aim: 'up' })).toMatchObject({ col: ATLAS_AIM_COL.up, row: 0 });
    expect(r({ aim: 'down' })).toMatchObject({ col: ATLAS_AIM_COL.down, row: 0 });
    expect(r({ side: 'alien', aim: 'up' })).toMatchObject({ col: 5, row: ATLAS_ROW.demon });
    expect(r({ side: 'alien', kind: 'demon', aim: 'down' })).toMatchObject({ col: 6, row: ATLAS_ROW.demon });
    expect(r({ side: 'alien', kind: 'golem', aim: 'up' })).toMatchObject({ col: 5, row: ATLAS_ROW.golem });
    expect(r({ side: 'alien', kind: 'eye', aim: 'down' })).toMatchObject({ col: 6, row: ATLAS_ROW.eye });
    expect(r({})).toMatchObject({ col: ATLAS_POSE_COL.fire, row: 0 });
  });
  it('вигляд без кадрів і не «вогонь» — aim не діє', () => {
    const r = (v: Partial<UnitSpriteView>): number => {
      const c = ctxRec();
      drawUnitSprite(c.ctx, view(v));
      return atlasCell(c.calls).col;
    };
    expect(r({ side: 'alien', kind: 'hound', aim: 'up' })).toBe(ATLAS_POSE_COL.fire);
    expect(r({ side: 'alien', kind: 'hound', aim: 'down' })).toBe(ATLAS_POSE_COL.fire);
    expect(r({ pose: undefined, aim: 'up' })).toBe(ATLAS_POSE_COL.idle);
    expect(r({ pose: 'death', aim: 'up' })).toBe(ATLAS_POSE_COL.death);
  });
  it('віддача кадру угору — фігура осідає вниз, униз — підскакує; бічна — назад від погляду', () => {
    const o = unitFrameOrigin(120, 120);
    const at = (v: Partial<UnitSpriteView>): { x: number; y: number } => {
      const c = ctxRec();
      drawUnitSprite(c.ctx, view(v));
      const a = atlasCell(c.calls);
      return { x: a.x, y: a.y };
    };
    expect(at({ aim: 'up', recoil: 3 })).toEqual({ x: o.x, y: o.y + 3 });
    expect(at({ aim: 'down', recoil: 3 })).toEqual({ x: o.x, y: o.y - 3 });
    expect(at({ recoil: 3 })).toEqual({ x: o.x - 3, y: o.y });
    expect(at({ side: 'alien', recoil: 3 })).toEqual({ x: o.x + 3, y: o.y });
  });
});

describe('п21.6: точка дула і трасер на крутому куті', () => {
  it('muzzlePoint з aim — якір кадру в масштабі поля, дзеркало по x, віддача вздовж кадру', () => {
    const o = unitFrameOrigin(120, 120);
    const sc = (v: number): number => Math.round((v * UNIT_DRAW) / ATLAS_FRAME);
    const up = MUZZLE_AIM.player!.up;
    expect(muzzlePoint('player', false, 120, 120, 0, undefined, 'up')).toEqual({ x: o.x + sc(up.x), y: o.y + sc(up.y) });
    expect(muzzlePoint('player', true, 120, 120, 0, undefined, 'up')).toEqual({ x: o.x + sc(ATLAS_FRAME - up.x), y: o.y + sc(up.y) });
    expect(muzzlePoint('player', false, 120, 120, 3, undefined, 'up').y).toBe(o.y + sc(up.y) + 3);
    const dn = MUZZLE_AIM.alien!.down;
    expect(muzzlePoint('alien', false, 120, 120, 3, 'demon', 'down')).toEqual({ x: o.x + sc(dn.x), y: o.y + sc(dn.y) - 3 });
    // Т.226: голем — якір свого кадру «угору» і віддача вздовж кадру (фігура осідає)
    const gu = MUZZLE_AIM.golem!.up;
    expect(muzzlePoint('alien', false, 120, 120, 3, 'golem', 'up')).toEqual({ x: o.x + sc(gu.x), y: o.y + sc(gu.y) + 3 });
    // гончак без кадрів — бічний якір і бічна віддача, як без aim (аудит PR #543: з віддачею 3 px)
    expect(muzzlePoint('alien', false, 120, 120, 3, 'hound', 'up')).toEqual(muzzlePoint('alien', false, 120, 120, 3, 'hound'));
  });
  it('оперативник стріляє круто вгору — промінь з дула кадру «угору» і зі спалахом (не з центру)', () => {
    const a = makeTracerAnim('player', { x: 2, y: 5 }, { x: 2, y: 1 }, false);
    a.start = 0;
    const c = ctxRec();
    drawAnimFrame(c.ctx, a, TRACER_MS * 0.05, 48, 8, 480, 480, { side: 'player', flip: false });
    const rec = recoilPx(animT(a, TRACER_MS * 0.05), tracerShare(a)); // віддача кадру «угору» — униз
    expect(rec).toBeGreaterThan(0);
    const want = muzzlePoint('player', false, 2 * 48 + 24, 5 * 48 + 24, rec, undefined, 'up');
    const mv = c.calls.find((x) => x.m === 'moveTo')!.args as number[];
    expect(mv[0]).toBeCloseTo(want.x, 0);
    expect(mv[1]).toBeCloseTo(want.y, 0);
    expect(c.calls.filter((x) => x.m === 'arc').length).toBeGreaterThan(0);
  });
  it('демон стріляє круто вниз (дзеркальний) — з дула кадру «униз»', () => {
    const a = makeTracerAnim('alien', { x: 4, y: 2 }, { x: 5, y: 8 }, false);
    a.start = 0;
    a.calm = true; // без віддачі — точка стала
    const c = ctxRec();
    drawAnimFrame(c.ctx, a, TRACER_MS * 0.05, 48, 8, 480, 480, { side: 'alien', flip: true, kind: 'demon' });
    const want = muzzlePoint('alien', true, 4 * 48 + 24, 2 * 48 + 24, 0, 'demon', 'down');
    expect(c.calls.find((x) => x.m === 'moveTo')!.args).toEqual([want.x, want.y]);
  });
  it('око стріляє круто вгору (дзеркальне) — з кінця променя кадру «угору» (Т.226)', () => {
    const a = makeTracerAnim('alien', { x: 2, y: 5 }, { x: 2, y: 1 }, false);
    a.start = 0;
    a.calm = true;
    const c = ctxRec();
    drawAnimFrame(c.ctx, a, TRACER_MS * 0.05, 48, 8, 480, 480, { side: 'alien', flip: true, kind: 'eye' });
    const want = muzzlePoint('alien', true, 2 * 48 + 24, 5 * 48 + 24, 0, 'eye', 'up');
    expect(c.calls.find((x) => x.m === 'moveTo')!.args).toEqual([want.x, want.y]);
  });
  it('гончак (без кадрів) на крутому куті — з центру клітинки, без спалаху дула (ADR-0171)', () => {
    const a = makeTracerAnim('alien', { x: 2, y: 5 }, { x: 2, y: 1 }, false);
    a.start = 0;
    const c = ctxRec();
    drawAnimFrame(c.ctx, a, TRACER_MS * 0.05, 48, 8, 480, 480, { side: 'alien', flip: false, kind: 'hound' });
    expect(c.calls.find((x) => x.m === 'moveTo')!.args).toEqual([2 * 48 + 24, 5 * 48 + 24]);
    expect(c.calls.filter((x) => x.m === 'arc')).toHaveLength(0);
  });
});
