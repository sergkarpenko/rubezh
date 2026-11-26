// src/render.geo-icons.test.ts
// п19.5 (ADR-0163): аркуш значків геосцени assets/geo-icons.png — вузол, перехоплювач, два зонди,
// ангар і Брама малюються клітинкою аркуша 96 × 96 по центру; без аркуша — чинні значки кодом
// (ADR-0072). Завантажувач інжектиться моком — тести від ассета не залежать.

import { afterEach, describe, expect, it } from 'vitest';
import {
  HANGAR_FILL,
  UFO_LANDED_ALPHA,
  UFO_LANDED_RING,
  drawFighterSprite,
  drawGatePortal,
  drawGeoBaseSprite,
  drawHangarSprite,
  drawUfoSprite,
  initGeoIcons,
  initGeoTower,
  initPixelSprites,
  isGeoIconsReady,
  type MakeOffscreen,
} from './render';
import { GEO_ICON_CELL, GEO_ICON_ORDER, GEO_ICON_PX, type GeoIcon } from './core/render-core';

type Call = { m: string; args: unknown[] };
const iconsImg = { width: 576, height: 96 } as unknown as CanvasImageSource;

function rec(): { ctx: CanvasRenderingContext2D; calls: Call[]; sets: { p: string; v: unknown }[] } {
  const calls: Call[] = [];
  const sets: { p: string; v: unknown }[] = [];
  const ctx = new Proxy(
    {},
    {
      get: (_t, p) =>
        typeof p === 'string'
          ? (...args: unknown[]): void => {
              calls.push({ m: p, args });
            }
          : undefined,
      set: (_t, p, v) => {
        sets.push({ p: String(p), v });
        return true;
      },
    }
  );
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, sets };
}

// мок offscreen для фолбеку піксельних спрайтів — лише заглушка з контекстом-записувачем
const offscreen: MakeOffscreen = (width, height) => ({ width, height, getContext: () => rec().ctx });

const ready = (): void =>
  initGeoIcons((_url, onLoad) => {
    onLoad(iconsImg);
  });

// очікувані аргументи drawImage значка: клітинка аркуша → квадрат side по центру (cx, cy)
const iconArgs = (icon: GeoIcon, cx: number, cy: number, side: number = GEO_ICON_PX[icon]): unknown[] => [
  iconsImg,
  GEO_ICON_ORDER.indexOf(icon) * GEO_ICON_CELL,
  0,
  GEO_ICON_CELL,
  GEO_ICON_CELL,
  Math.round(cx - side / 2),
  Math.round(cy - side / 2),
  side,
  side,
];
const images = (calls: Call[]): unknown[][] => calls.filter((c) => c.m === 'drawImage').map((c) => c.args);

afterEach(() => {
  initGeoIcons(() => {}); // скидання у фолбек для решти файлів
  initGeoTower(() => {});
});

describe('п19.5 (ADR-0163): значки геосцени з аркуша Gemini', () => {
  it('порядок аркуша і розміри: шість клітинок 96 × 96; вузол — на всю клітинку геосцени (48)', () => {
    expect(GEO_ICON_ORDER).toEqual(['scout', 'harvester', 'interceptor', 'node', 'hangar', 'gate']);
    expect(GEO_ICON_CELL).toBe(96);
    expect(GEO_ICON_PX).toEqual({ scout: 34, harvester: 40, interceptor: 34, node: 48, hangar: 36, gate: 46 });
  });

  it('прапорець готовності: до onload — фолбек, після — аркуш; повторна ініціалізація скидає', () => {
    initGeoIcons(() => {});
    expect(isGeoIconsReady()).toBe(false);
    ready();
    expect(isGeoIconsReady()).toBe(true);
    initGeoIcons(() => {});
    expect(isGeoIconsReady()).toBe(false);
  });

  it('вузол: значок «node» на всю клітинку по центру, зі згладжуванням; без аркуша — не аркуш', () => {
    ready();
    const r = rec();
    drawGeoBaseSprite(r.ctx, { cx: 408, cy: 216, size: 48 });
    expect(images(r.calls)).toEqual([iconArgs('node', 408, 216, 48)]);
    expect(r.sets).toContainEqual({ p: 'imageSmoothingEnabled', v: true });
    initGeoIcons(() => {});
    initPixelSprites(offscreen);
    const f = rec();
    drawGeoBaseSprite(f.ctx, { cx: 408, cy: 216, size: 48 });
    expect(images(f.calls).every((a) => a[0] !== iconsImg)).toBe(true);
  });

  it('перехоплювач: значок «interceptor» 34 px по центру клітинки', () => {
    ready();
    const r = rec();
    drawFighterSprite(r.ctx, { cx: 168, cy: 168 });
    expect(images(r.calls)).toEqual([iconArgs('interceptor', 168, 168)]);
  });

  it('зонди: розвідник і збирач — різні значки, у польоті без приглушення і без кільця', () => {
    ready();
    for (const [kind, icon] of [
      ['розвідник', 'scout'],
      ['збирач', 'harvester'],
    ] as const) {
      const r = rec();
      drawUfoSprite(r.ctx, { cx: 504, cy: 24, landed: false, kind });
      expect(images(r.calls)).toEqual([iconArgs(icon, 504, 24)]);
      expect(r.calls.some((c) => c.m === 'ellipse')).toBe(false);
      expect(r.sets.filter((x) => x.p === 'globalAlpha').map((x) => x.v)).toEqual([1]);
    }
  });

  it('приземлений зонд: кільце посадки під значком, значок приглушений, альфа повертається до 1', () => {
    ready();
    const r = rec();
    drawUfoSprite(r.ctx, { cx: 120, cy: 72, landed: true, kind: 'збирач' });
    const ring = r.calls.find((c) => c.m === 'ellipse')!;
    expect(ring.args.slice(0, 4)).toEqual([120, 82, 16, 6]);
    expect(r.sets).toContainEqual({ p: 'strokeStyle', v: UFO_LANDED_RING });
    // кільце — до значка (під ним)
    expect(r.calls.findIndex((c) => c.m === 'stroke')).toBeLessThan(r.calls.findIndex((c) => c.m === 'drawImage'));
    expect(r.sets.filter((x) => x.p === 'globalAlpha').map((x) => x.v)).toEqual([UFO_LANDED_ALPHA, 1]);
    expect(images(r.calls)).toEqual([iconArgs('harvester', 120, 72)]);
  });

  it('Брама: значок «gate» замість кодового порталу; закрита — приглушена 0,45, альфа повертається', () => {
    ready();
    const o = rec();
    drawGatePortal(o.ctx, { cx: 456, cy: 216, size: 48, open: true });
    expect(images(o.calls)).toEqual([iconArgs('gate', 456, 216)]);
    expect(o.calls.some((c) => c.m === 'ellipse')).toBe(false);
    const c = rec();
    drawGatePortal(c.ctx, { cx: 456, cy: 216, size: 48, open: false });
    expect(c.sets.filter((x) => x.p === 'globalAlpha').map((x) => x.v)).toEqual([0.45, 1]);
  });

  it('ангар: значок «hangar» 36 px; без аркуша — склепіння кодом з ціановою смугою над воротами', () => {
    ready();
    const r = rec();
    drawHangarSprite(r.ctx, { cx: 648, cy: 216 });
    expect(images(r.calls)).toEqual([iconArgs('hangar', 648, 216)]);
    expect(r.calls.some((c) => c.m === 'arc')).toBe(false);
    initGeoIcons(() => {});
    const f = rec();
    drawHangarSprite(f.ctx, { cx: 648, cy: 216 });
    expect(images(f.calls)).toEqual([]);
    expect(f.calls.find((c) => c.m === 'arc')!.args).toEqual([648, 224, 15, Math.PI, 0]);
    expect(f.sets).toContainEqual({ p: 'fillStyle', v: HANGAR_FILL });
    expect(f.calls.find((c) => c.m === 'fillRect')!.args).toEqual([641, 217, 14, 2]);
  });
});
