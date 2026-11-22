// @vitest-environment jsdom
// Т.123 (ADR-0114): векторні іконки інтерфейсу (src/ui/icons.ts). Перевіряється
// те, що зламана іконка показала б порожнім місцем: кожен малюнок розбирається
// в елементи SVG, шляхи — без залишку, точки шляхів — у сітці 24 × 24, кольори —
// лише з палітри. Справжні межі малюнка (`getBBox`) міряє гейт e2e `expectIcons`.
import { describe, expect, it } from 'vitest';
import { ICONS, createIcon, type IconName } from './icons';

const NAMES = Object.keys(ICONS) as IconName[];
const PALETTE = ['#ffffff', '#00e5ff', '#ff2e88', '#ffb347', '#7fe2a0'];

// Точки шляху SVG: кінець кожної команди (для кривих — ще й керівні точки). Команда з невідомою
// літерою, без чисел або з неповним набором чисел — помилка: браузер такий шлях обрізав би мовчки.
const ARITY: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
function pathPoints(d: string): [number, number][] {
  const pts: [number, number][] = [];
  let [x, y, sx, sy] = [0, 0, 0, 0];
  const cmds = [...d.matchAll(/([a-zA-Z])([^a-zA-Z]*)/g)];
  if (cmds.map((c) => c[0]).join('') !== d || !d.startsWith('M')) throw new Error('шлях: ' + d);
  for (const [, cmd, args] of cmds) {
    const up = cmd!.toUpperCase();
    const n = ARITY[up];
    const nums = (args!.match(/-?\d*\.?\d+/g) ?? []).map(Number);
    if (n === undefined || (n === 0 ? nums.length > 0 : nums.length === 0 || nums.length % n !== 0))
      throw new Error('команда: ' + cmd + args);
    if (up === 'Z') pts.push(([x, y] = [sx, sy]));
    for (let i = 0; i < nums.length; i += n!) {
      const a = nums.slice(i, i + n!);
      const rel = cmd !== up;
      if (up === 'H') x = rel ? x + a[0]! : a[0]!;
      else if (up === 'V') y = rel ? y + a[0]! : a[0]!;
      else {
        const from = up === 'A' ? 5 : 0; // дуга: радіуси, поворот і прапорці — не точки
        for (let j = from; j < a.length - 2; j += 2) pts.push([rel ? x + a[j]! : a[j]!, rel ? y + a[j + 1]! : a[j + 1]!]);
        [x, y] = [rel ? x + a[n! - 2]! : a[n! - 2]!, rel ? y + a[n! - 1]! : a[n! - 1]!];
      }
      if (up === 'M' && i === 0) [sx, sy] = [x, y];
      pts.push([x, y]);
    }
  }
  return pts;
}
function circlePoints(el: Element): [number, number][] {
  const [cx, cy, r] = ['cx', 'cy', 'r'].map((k) => Number(el.getAttribute(k))) as [number, number, number];
  return [
    [cx - r, cy - r],
    [cx + r, cy + r],
  ];
}

describe('Т.123 icons: векторні іконки', () => {
  it('createIcon: svg з класом, сіткою 24 × 24, лінією 2 і aria-hidden; малюнок — лише path і circle, явна товщина — 1.5, 2 або 2.5', () => {
    for (const name of NAMES) {
      const svg = createIcon(name, 'tb-icon');
      expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
      expect([svg.getAttribute('class'), svg.getAttribute('viewBox'), svg.getAttribute('aria-hidden')]).toEqual([
        'tb-icon',
        '0 0 24 24',
        'true',
      ]);
      expect(svg.getAttribute('fill')).toBe('none'); // лінія без заливки, якщо заливку не задано явно
      expect(svg.getAttribute('stroke-width')).toBe('2'); // основна товщина — одна на всі малюнки
      const parts = [...svg.children];
      expect(parts.length, name).toBeGreaterThan(0);
      for (const el of parts) {
        expect(el.namespaceURI, name).toBe('http://www.w3.org/2000/svg');
        expect(['path', 'circle'], name).toContain(el.tagName);
        expect([null, '1.5', '2', '2.5'], name).toContain(el.getAttribute('stroke-width')); // явна товщина — лише тонша чи товща деталь
      }
    }
  });

  it('кольори — лише палітра; кожен елемент має обвід або заливку', () => {
    for (const name of NAMES) {
      for (const el of createIcon(name, 'x').children) {
        const paint = [el.getAttribute('stroke'), el.getAttribute('fill')].filter((c): c is string => c !== null);
        expect(paint.length, name).toBeGreaterThan(0);
        for (const c of paint) expect(PALETTE, name).toContain(c);
      }
    }
  });

  it('шляхи розбираються без залишку, а всі точки шляхів (абсолютні й відносні команди, кінці дуг) і кола — в сітці 24 × 24', () => {
    for (const name of NAMES) {
      for (const el of createIcon(name, 'x').children) {
        const pts = el.tagName === 'circle' ? circlePoints(el) : pathPoints(el.getAttribute('d') ?? '');
        expect(pts.length, name).toBeGreaterThan(1);
        for (const [x, y] of pts) expect(x >= 0 && x <= 24 && y >= 0 && y <= 24, name + ': ' + x + ',' + y).toBe(true);
      }
    }
    expect(() => pathPoints('M2 2lQ 4-5')).toThrow(); // команда без чисел
    expect(() => pathPoints('M2 2l4')).toThrow(); // чисел менше, ніж потрібно команді
    expect(pathPoints('M2 2l3 4-1 1H9v2a1 1 0 0 1 2 2z')).toEqual([
      [2, 2],
      [5, 6],
      [4, 7],
      [9, 7],
      [9, 9],
      [11, 11],
      [2, 2],
    ]);
  });

  it('кожна іконка — свій малюнок', () => {
    expect(new Set(Object.values(ICONS)).size).toBe(NAMES.length);
  });
});
