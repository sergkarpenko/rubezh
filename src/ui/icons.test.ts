// @vitest-environment jsdom
// Т.123 (ADR-0114): векторні іконки інтерфейсу (src/ui/icons.ts). Перевіряється
// те, що зламана іконка показала б порожнім місцем: кожен малюнок розбирається
// в елементи SVG, усі числа шляхів — у сітці 24 × 24, кольори — лише з палітри.
import { describe, expect, it } from 'vitest';
import { ICONS, createIcon, type IconName } from './icons';

const NAMES = Object.keys(ICONS) as IconName[];
const PALETTE = ['#f2f7ff', '#00e5ff', '#ff2e88', '#ffb347', '#7fe2a0'];

describe('Т.123 icons: векторні іконки', () => {
  it('createIcon: svg з класом, сіткою 24 × 24 і aria-hidden; малюнок — лише path і circle в просторі імен SVG', () => {
    for (const name of NAMES) {
      const svg = createIcon(name, 'tb-icon');
      expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
      expect([svg.getAttribute('class'), svg.getAttribute('viewBox'), svg.getAttribute('aria-hidden')]).toEqual([
        'tb-icon',
        '0 0 24 24',
        'true',
      ]);
      expect(svg.getAttribute('fill')).toBe('none'); // лінія без заливки, якщо заливку не задано явно
      const parts = [...svg.children];
      expect(parts.length, name).toBeGreaterThan(0);
      for (const el of parts) {
        expect(el.namespaceURI, name).toBe('http://www.w3.org/2000/svg');
        expect(['path', 'circle'], name).toContain(el.tagName);
      }
    }
  });

  it('кольори — лише палітра ADR-0064; кожен елемент видимий (має обвід або заливку)', () => {
    for (const name of NAMES) {
      for (const el of createIcon(name, 'x').children) {
        const paint = [el.getAttribute('stroke'), el.getAttribute('fill')].filter((c): c is string => c !== null);
        expect(paint.length, name).toBeGreaterThan(0);
        for (const c of paint) expect(PALETTE, name).toContain(c);
      }
    }
  });

  it('координати шляхів і кіл не виходять за сітку 24 × 24 (абсолютні команди M, L, H, V і центри кіл)', () => {
    const inGrid = (n: number): boolean => n >= 0 && n <= 24;
    for (const name of NAMES) {
      for (const el of createIcon(name, 'x').children) {
        if (el.tagName === 'circle') {
          const [cx, cy, r] = ['cx', 'cy', 'r'].map((k) => Number(el.getAttribute(k)));
          expect([cx! - r!, cx! + r!, cy! - r!, cy! + r!].every(inGrid), name).toBe(true);
          continue;
        }
        const d = el.getAttribute('d') ?? '';
        expect(d.startsWith('M'), name).toBe(true);
        for (const m of d.matchAll(/([MLHV])\s*(-?[\d.]+)(?:[\s,]+(-?[\d.]+))?/g)) {
          const nums = [m[2], m[1] === 'H' || m[1] === 'V' ? undefined : m[3]].filter((v): v is string => v !== undefined).map(Number);
          expect(nums.every(inGrid), name + ': ' + m[0]).toBe(true);
        }
      }
    }
  });

  it('кожна іконка — свій малюнок', () => {
    expect(new Set(Object.values(ICONS)).size).toBe(NAMES.length);
  });
});
