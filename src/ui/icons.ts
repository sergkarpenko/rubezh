// Т.123 (ADR-0114): векторні іконки інтерфейсу — SVG кодом замість піксель-матриць
// 12 × 12 (toolbar.ts П13.2, tab-icons.ts П14.6). Одна сітка 24 × 24, лінія 2,
// заокруглені кінці; палітра ADR-0064: світлий силует, ціан «Рубіжу», пурпур
// Розриву, бурштин, зелений лікування. Чіткі на будь-якій щільності екрана,
// без канви і без ассета; розмір і місце на кнопці задає CSS (index.html).
// Шар відображення: ядра не чіпає, малюється один раз при створенні кнопки.

const W = '#f2f7ff';
const C = '#00e5ff';
const P = '#ff2e88';
const A = '#ffb347';
const G = '#7fe2a0';

// Лінія кольором; заливка кольором (op — прозорість заливки, обвід тим самим кольором).
const line = (d: string, color: string, width = 2): string => `<path d="${d}" stroke="${color}" stroke-width="${width}"/>`;
const shape = (d: string, color: string, op = 1): string => `<path d="${d}" fill="${color}" fill-opacity="${op}" stroke="${color}"/>`;
const ring = (cx: number, cy: number, r: number, color: string, op = 0): string =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" fill-opacity="${op}" stroke="${color}"/>`;
const dot = (cx: number, cy: number, r: number, color: string): string => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}"/>`;

export const ICONS = {
  // — плитки дій бою —
  snap: shape('M10 8h6.5l5 4-5 4H10z', W) + line('M2.5 9H7M1.5 12H7M2.5 15H7', C),
  aimed: ring(12, 12, 7, W) + line('M12 2v5M12 17v5M2 12h5M17 12h5', C) + dot(12, 12, 2, P),
  auto:
    shape('M9.5 4h4.5l3 2.5-3 2.5H9.5zM6.5 9.5H11l3 2.5-3 2.5H6.5zM9.5 15h4.5l3 2.5-3 2.5H9.5z', W) +
    line('M2 6.5h4M1.5 12h2.5M2 17.5h4', C) +
    line('M20 6.5h2M17.5 12h3.5M20 17.5h2', P),
  ow: line('M2 12c3-5 6.5-7 10-7s7 2 10 7c-3 5-6.5 7-10 7s-7-2-10-7z', W) + ring(12, 12, 3.5, C, 0.25) + dot(12, 12, 1.4, P),
  medkit:
    shape('M5.5 8h13A2.5 2.5 0 0 1 21 10.5v7a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5v-7A2.5 2.5 0 0 1 5.5 8z', W, 0.12) +
    line('M9 8V6.5A1.5 1.5 0 0 1 10.5 5h3A1.5 1.5 0 0 1 15 6.5V8', W) +
    line('M12 11v6M9 14h6', G, 2.5),
  grenade: ring(11, 15, 6, W, 0.14) + line('M9 9V6h4v3', W) + line('M13 6.5h3.5l2.5 4', C) + ring(6.5, 5, 2, A),
  evac: shape('M12 2l6 7h-3.5v6h-5V9H6z', C, 0.3) + line('M4 16v4.5h16V16', W),
  end:
    line('M6 3h12M6 21h12M7.5 3c0 5 3.5 6.5 4.5 9-1 2.5-4.5 4-4.5 9M16.5 3c0 5-3.5 6.5-4.5 9 1 2.5 4.5 4 4.5 9', W) +
    shape('M9.5 6.5h5L12 10zM8.7 20l3.3-3.5 3.3 3.5z', C),
  'auto-battle': shape('M3 5l7.5 7L3 19z', C, 0.35) + shape('M11 5l7.5 7-7.5 7z', C, 0.8) + line('M21.5 5v14', W),
  // — вкладки колонки стану і журналу —
  squad: ring(12, 7, 3, W) + line('M6.5 19c0-4 2.5-6 5.5-6s5.5 2 5.5 6', W) + dot(4.5, 9.5, 2, C) + dot(19.5, 9.5, 2, C),
  base: line('M12 11v9M8 20h8', W) + dot(12, 8, 2.2, C) + line('M7 4a6.5 6.5 0 0 0 0 8M17 4a6.5 6.5 0 0 1 0 8', C),
  system: line('M3 7h8M18 7h3M3 17h3M13 17h8', W) + ring(14.5, 7, 2.5, C) + ring(9.5, 17, 2.5, C),
  all: line('M4 6h16', C) + line('M4 12h16M4 18h10', W),
  geo: ring(12, 12, 8, W) + line('M4 12h16M12 4c-3.5 3-3.5 13 0 16M12 4c3.5 3 3.5 13 0 16', C, 1.5),
  econ: ring(12, 12, 8, W) + line('M12 7.5v9M9.5 10h3.5a1.75 1.75 0 0 1 0 3.5h-2a1.75 1.75 0 0 0 0 3.5', A, 1.5),
  battle: shape('M13 2L5 13h5.5L9 22l8-11.5h-5.5z', C, 0.3),
} as const;

export type IconName = keyof typeof ICONS;

const SVG_NS = 'http://www.w3.org/2000/svg';

// Елемент іконки: клас задає розмір і місце (CSS), aria-hidden — підпис кнопки
// читає екранний диктор, іконка — прикраса.
export function createIcon(name: IconName, cls: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  for (const [k, v] of [
    ['class', cls],
    ['viewBox', '0 0 24 24'],
    ['fill', 'none'],
    ['stroke-linecap', 'round'],
    ['stroke-linejoin', 'round'],
    ['aria-hidden', 'true'],
  ] as const)
    svg.setAttribute(k, v);
  svg.innerHTML = ICONS[name];
  return svg;
}
