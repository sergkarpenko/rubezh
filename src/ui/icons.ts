// Т.123 (ADR-0114): векторні іконки інтерфейсу — SVG кодом замість піксель-матриць
// 12 × 12 (toolbar.ts П13.2, tab-icons.ts П14.6). Одна сітка 24 × 24, основна лінія 2,
// заокруглені кінці; палітра тулбара П13.2 (білий силует, ціан «Рубіжу»,
// пурпур Розриву), бурштин ADR-0064 і зелений лікування — як у смузі HP. Чіткі на будь-якій щільності екрана,
// без канви і без ассета; розмір і місце на кнопці задає CSS (index.html).
// Шар відображення: ядра не чіпає, малюється один раз при створенні кнопки.

const W = '#ffffff';
const C = '#00e5ff';
const P = '#ff2e88';
const A = '#ffb347';
const G = '#7fe2a0';

// Основна товщина лінії — на корені svg; тонша (1.5) і товща (2.5) — лише там, де задано явно.
const LINE = 2;

// Лінія кольором; заливка кольором (op — прозорість заливки, обвід тим самим кольором).
const line = (d: string, color: string, width = LINE): string => `<path d="${d}" stroke="${color}" stroke-width="${width}"/>`;
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
  // п22.7 (ADR-0189): «Стимулятор» — ампула з блискавкою
  stim: shape('M9 3h6v3l-1 1v12.5a2 2 0 0 1-4 0V7L9 6z', W, 0.12) + shape('M12.8 9l-2.3 4h2l-1.3 4 3-5h-2l1.3-3z', A, 0.9),
  // п16.4 (ADR-0147): дії ролей — «Ривок», «Точний постріл», «Польова допомога»
  dash: line('M4 6l6 6-6 6M11 6l6 6-6 6', W) + line('M18 6l3 6-3 6', C),
  precise: ring(12, 12, 8, W) + ring(12, 12, 3.5, C, 0.25) + line('M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4', P),
  aid: ring(12, 12, 9, W, 0.12) + line('M12 7.5v9M7.5 12h9', G, 2.5),
  end:
    line('M6 3h12M6 21h12M7.5 3c0 5 3.5 6.5 4.5 9-1 2.5-4.5 4-4.5 9M16.5 3c0 5-3.5 6.5-4.5 9 1 2.5 4.5 4 4.5 9', W) +
    shape('M9.5 6.5h5L12 10zM8.7 20l3.3-3.5 3.3 3.5z', C),
  'auto-battle': shape('M3 5l7.5 7L3 19z', C, 0.35) + shape('M11 5l7.5 7-7.5 7z', C, 0.8) + line('M21.5 5v14', W),
  // — вкладки колонки стану і журналу —
  squad: ring(12, 7, 3, W) + line('M6.5 19c0-4 2.5-6 5.5-6s5.5 2 5.5 6', W) + dot(4.5, 9.5, 2, C) + dot(19.5, 9.5, 2, C),
  base: line('M12 11v9M8 20h8', W) + dot(12, 8, 2.2, C) + line('M7 4a6.5 6.5 0 0 0 0 8M17 4a6.5 6.5 0 0 1 0 8', C),
  all: line('M4 6h16', C) + line('M4 12h16M4 18h10', W),
  geo: ring(12, 12, 8, W) + line('M4 12h16M12 4c-3.5 3-3.5 13 0 16M12 4c3.5 3 3.5 13 0 16', C, 1.5),
  econ:
    line('M5 8v8c0 1.7 3.1 3 7 3s7-1.3 7-3V8M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3', W) +
    shape('M5 8c0-1.7 3.1-3 7-3s7 1.3 7 3-3.1 3-7 3-7-1.3-7-3z', A, 0.3),
  battle: shape('M13 2L5 13h5.5L9 22l8-11.5h-5.5z', C, 0.3),
  // — Т.128: заголовки панелей, кнопки вербування, пункт меню «Збереження» (контури дизайн-сесії Т.125) —
  probe:
    shape('M3 13c0-2 4-3.5 9-3.5s9 1.5 9 3.5-4 3.5-9 3.5-9-1.5-9-3.5z', P, 0.2) +
    line('M7.5 10c0-3 2-5 4.5-5s4.5 2 4.5 5', P) +
    line('M8 19l-1 2M12 19.5v2M16 19l1 2', W),
  fighter: shape('M12 2l2.5 8 6.5 5v2l-6.5-2-1 5 2 1.5v1L12 21l-3.5 1.5v-1l2-1.5-1-5L3 17v-2l6.5-5z', C, 0.2),
  finance: ring(12, 12, 8.5, A, 0.15) + line('M12 7.5v9M14.5 9.5h-3.5a1.5 1.5 0 0 0 0 3h2a1.5 1.5 0 0 1 0 3H9.5', A),
  research: line('M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3', W) + shape('M7.5 15.5h9l1.5 3.5H6z', C, 0.6),
  forge:
    shape('M4 9h13c0 2.5-2 4-4.5 4v3h3v3h-10v-3h3v-3C6 13 4 11.5 4 9z', W, 0.12) +
    `<path d="M19.5 3l.9 1.8 1.8.9-1.8.9-.9 1.8-.9-1.8-1.8-.9 1.8-.9z" fill="${A}" stroke="${A}" stroke-width="1.5"/>`,
  roster: ring(12, 7.5, 3.5, W) + line('M5 20c0-4 3-6.5 7-6.5s7 2.5 7 6.5', W) + line('M8.5 7h7', C, 2.5),
  tech: ring(11, 8.5, 3.5, W) + line('M4 20c0-4 3-6 7-6s7 2 7 6', W) + line('M19 3v4M17 5h4', C) + dot(19, 11, 1, C),
  save: line('M5 4h11l3 3v13H5z', W) + line('M8 4v5h7V4M8 20v-6h8v6', C),
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
    ['stroke-width', String(LINE)],
    ['stroke-linecap', 'round'],
    ['stroke-linejoin', 'round'],
    ['aria-hidden', 'true'],
  ] as const)
    svg.setAttribute(k, v);
  svg.innerHTML = ICONS[name];
  return svg;
}

// Т.128: кнопка з іконкою перед підписом — svg і текстовий вузол створюються один раз, далі міняється
// лише текст (рендер панелі не перемальовує іконку); textContent кнопки — сам підпис (svg тексту не має).
export function setIconText(btn: HTMLElement, name: IconName, text: string): void {
  let label = btn.lastChild;
  if (btn.firstElementChild?.getAttribute('class') !== 'btn-icon' || label?.nodeType !== Node.TEXT_NODE) {
    btn.textContent = '';
    label = document.createTextNode('');
    btn.append(createIcon(name, 'btn-icon'), label);
  }
  if (label.textContent !== text) label.textContent = text;
}
