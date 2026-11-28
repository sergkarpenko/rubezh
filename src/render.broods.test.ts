// src/render.broods.test.ts
// п22.6 (ADR-0188): аура виводку під ворогом і вінець чемпіона — кодом; без полів — малювання як до п22.6.
import { beforeEach, describe, expect, it } from 'vitest';
import { drawUnitSprite, initPixelSprites, type MakeOffscreen } from './render';
import { AURA_ALPHA, BROOD_COLORS, CROWN_DY, CROWN_W } from './core/render-core';

type Call = { m: string; args: unknown[] };
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

const base = { side: 'alien' as const, cx: 100, cy: 100, r: 8, hp: 10, maxHp: 10, selected: false, overwatch: false };

beforeEach(() => initPixelSprites(make));

describe('п22.6: аура виводку й вінець чемпіона', () => {
  it('аура — напівпрозорий еліпс кольору виводку; вінець — контур над головою', () => {
    const r = ctxRec();
    drawUnitSprite(r.ctx, { ...base, aura: BROOD_COLORS.ash, crown: true });
    expect(r.sets).toContainEqual({ p: 'globalAlpha', v: AURA_ALPHA });
    expect(r.sets.filter((s) => s.p === 'fillStyle' && s.v === BROOD_COLORS.ash).length).toBeGreaterThanOrEqual(2); // аура і вінець
    expect(r.calls).toContainEqual({ m: 'moveTo', args: [100 - CROWN_W / 2, 100 - CROWN_DY + 8] });
  });

  it('без полів — ні аури, ні вінця; загиблий — теж без них', () => {
    const plain = ctxRec();
    drawUnitSprite(plain.ctx, { ...base });
    expect(plain.sets.some((s) => s.p === 'globalAlpha' && s.v === AURA_ALPHA)).toBe(false);
    expect(plain.calls.some((c) => c.m === 'moveTo' && (c.args[1] as number) === 100 - CROWN_DY + 8)).toBe(false);
    const dead = ctxRec();
    drawUnitSprite(dead.ctx, { ...base, hp: 0, aura: BROOD_COLORS.rust, crown: true });
    expect(dead.sets.some((s) => s.p === 'globalAlpha' && s.v === AURA_ALPHA)).toBe(false);
    expect(dead.sets.some((s) => s.p === 'fillStyle' && s.v === BROOD_COLORS.rust)).toBe(false);
  });

  it('вінець без аури — бурштин', () => {
    const r = ctxRec();
    drawUnitSprite(r.ctx, { ...base, crown: true });
    expect(r.sets).toContainEqual({ p: 'fillStyle', v: '#FFB454' });
  });
});
