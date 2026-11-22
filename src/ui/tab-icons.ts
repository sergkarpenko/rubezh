// П14.6 (ADR-0072/0066), Т.123 (ADR-0114): іконки вкладок — векторні, з
// src/ui/icons.ts (до Т.123 — піксель-матриці 12 × 12 на канві). Оформлює
// існуючі кнопки вкладок status-колонки (#status-tabs, data-tab) і журналу
// (#log-tabs, data-filter): svg ставиться перед текстом — DOM-контракти П11.6
// (id, класи, dataset, textContent) не змінюються. Малюється один раз при
// створенні (idle → 0 перерисовок, ADR-0029), без RNG (ADR-0003).

import { createIcon, type IconName } from './icons';

// Іконки за ключами вкладок: status-колонка (data-tab) + журнал (data-filter);
// «Вузол» спільний для обох (база = вузол «Рубіж», термінологія ADR-0064).
export const TAB_ICONS: Readonly<Record<string, IconName>> = {
  squad: 'squad',
  base: 'base',
  system: 'system',
  all: 'all',
  geo: 'geo',
  econ: 'econ',
  battle: 'battle',
};

// Оформити кнопки вкладок (idempotent: повторний виклик не дублює іконки).
// Викликається після створення вкладок (main.ts: createStatusTabs вже
// побудував #status-tabs; #log-tabs — статична розмітка index.html).
export function decorateTabButtons(): void {
  for (const btn of Array.from(document.querySelectorAll<HTMLButtonElement>('#status-tabs button, #log-tabs button'))) {
    const key = btn.dataset.tab ?? btn.dataset.filter ?? '';
    const icon = TAB_ICONS[key];
    if (icon === undefined || btn.querySelector('svg.tab-icon') !== null) continue;
    btn.insertBefore(createIcon(icon, 'tab-icon'), btn.firstChild); // текст лишається після іконки
  }
}
