// П14.6 (ADR-0072/0066): іконки вкладок — піксель-матрицями кодом (прецедент
// toolbar.ts, П13.2), НЕ в ассеті. Стилістика і палітра — узгоджені з
// тулбаром: білі силуети (нейтральний), ціановий акцент #00E5FF; матриця
// 12×12, відображення 1:1 (буфер 12px, CSS 12px + pixelated — чітко і на
// retina). Оформлює існуючі кнопки вкладок status-колонки (#status-tabs,
// data-tab) і журналу (#log-tabs, data-filter): canvas prepend'иться перед
// текстом — DOM-контракти П11.6 (id, класи, dataset, textContent) не
// змінюються, існуючі тести зелені без правок. Малюється один раз при
// створенні (idle → 0 перерисовок, ADR-0029), без RNG (ADR-0003).

import type { PixelSprite } from '../core/sprites';

// Палітра — та сама, що в тулбарі (toolbar.ts): білий силует + ціановий акцент.
const TAB_PALETTE: Readonly<Record<string, string>> = { W: '#FFFFFF', C: '#00E5FF' };

// Матриця 12×12, 1 матриця-піксель = 1 canvas-піксель (масштаб 1:1).
const TAB_ICON_PX = 12;
export const TAB_ICON_SIZE = TAB_ICON_PX;

// «Загін»: три оперативники пліч-о-пліч (голови + тулуб), ціанові «пульси»
// під кожним — боєготовність загону.
const ICON_SQUAD: PixelSprite = {
  rows: [
    '............',
    '............',
    '.WW..WW..WW.',
    '.WW..WW..WW.',
    '............',
    '.WW..WW..WW.',
    '.WW..WW..WW.',
    '.WW..WW..WW.',
    '............',
    '.C....C....C',
    '............',
    '............',
  ],
  palette: TAB_PALETTE,
};

// «Вузол» (база): вежа-радар — ціановий приймач на щоглі (позначка
// бази геосцени, П14.5), білі щогла і підніжжя.
const ICON_BASE: PixelSprite = {
  rows: [
    '............',
    '....CCCC....',
    '...C....C...',
    '...C....C...',
    '....C..C....',
    '.....CC.....',
    '.....WW.....',
    '.....WW.....',
    '.....WW.....',
    '....WWWW....',
    '...WWWWWW...',
    '............',
  ],
  palette: TAB_PALETTE,
};

// «Система»: чип-модуль — біле тіло, ціанове ядро (збереження і системні
// функції — «Система» статус-колонки).
const ICON_SYSTEM: PixelSprite = {
  rows: [
    '............',
    '....W..W....',
    '............',
    '..WWWWWWWW..',
    '..WWCCWWWW..',
    '..WWCCWWWW..',
    '..WWWWWWWW..',
    '..WWWWWWWW..',
    '............',
    '....W..W....',
    '............',
    '............',
  ],
  palette: TAB_PALETTE,
};

// «Усе» (журнал): список подій — рядки-біти ціан, білі лінії записів.
const ICON_ALL: PixelSprite = {
  rows: [
    '............',
    '............',
    '.C.WWWWWWW..',
    '............',
    '.C.WWWWWWW..',
    '............',
    '.C.WWWWWWW..',
    '............',
    '.C.WWWWW....',
    '............',
    '............',
    '............',
  ],
  palette: TAB_PALETTE,
};

// «Геосцена»: планетоїд — біла сфера з ціановим меридіаном.
const ICON_GEO: PixelSprite = {
  rows: [
    '............',
    '....WWWW....',
    '..WWWWWWWW..',
    '.WWWWCCWWWW.',
    '.WWWWCCWWWW.',
    'WWWWWCCWWWWW',
    'WWWWWCCWWWWW',
    '.WWWWCCWWWW.',
    '.WWWWCCWWWW.',
    '..WWWWWWWW..',
    '....WWWW....',
    '............',
  ],
  palette: TAB_PALETTE,
};

// «Економіка»: кредит-чип — контур монети з ціановим номіналом.
const ICON_ECON: PixelSprite = {
  rows: [
    '............',
    '....WWWW....',
    '..WW....WW..',
    '.W........W.',
    '.W...CC...W.',
    '.W...CC...W.',
    '.W........W.',
    '..WW....WW..',
    '....WWWW....',
    '............',
    '............',
    '............',
  ],
  palette: TAB_PALETTE,
};

// «Бій»: перехрестя прицілу — та сама стилістика, що ICON_AIMED тулбара
// (П13.2), у neutral/ціановій схемі вкладок.
const ICON_BATTLE: PixelSprite = {
  rows: [
    '.....WW.....',
    '.....WW.....',
    '.....WW.....',
    '.....WW.....',
    '............',
    'WW...CC...WW',
    'WW...CC...WW',
    '............',
    '.....WW.....',
    '.....WW.....',
    '.....WW.....',
    '.....WW.....',
  ],
  palette: TAB_PALETTE,
};

// Іконки за ключами вкладок: status-колонка (data-tab) + журнал (data-filter);
// «Вузол» спільний для обох (база = вузол «Рубіж», термінологія ADR-0064).
export const TAB_ICONS: Readonly<Record<string, PixelSprite>> = {
  squad: ICON_SQUAD,
  base: ICON_BASE,
  system: ICON_SYSTEM,
  all: ICON_ALL,
  geo: ICON_GEO,
  econ: ICON_ECON,
  battle: ICON_BATTLE,
};

// Розгортання матриці в канву: один fillRect на піксель, детерміновано
// (ADR-0003/0031). headless без 2d-контексту — мовчки без іконки.
export function drawTabIcon(cv: HTMLCanvasElement, icon: PixelSprite): void {
  const ctx = cv.getContext('2d');
  if (ctx === null) return;
  ctx.imageSmoothingEnabled = false;
  for (let y = 0; y < icon.rows.length; y++) {
    const row = icon.rows[y] ?? '';
    for (let x = 0; x < row.length; x++) {
      const color = icon.palette[row.charAt(x)];
      if (color === undefined) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    }
  }
}

// Оформити кнопки вкладок (idempotent: повторний виклик не дублює канви).
// Викликається після створення вкладок (main.ts: createStatusTabs вже
// побудував #status-tabs; #log-tabs — статична розмітка index.html).
export function decorateTabButtons(): void {
  for (const btn of Array.from(document.querySelectorAll<HTMLButtonElement>('#status-tabs button, #log-tabs button'))) {
    const key = btn.dataset.tab ?? btn.dataset.filter ?? '';
    const icon = TAB_ICONS[key];
    if (icon === undefined || btn.querySelector('canvas.tab-icon') !== null) continue;
    const cv = document.createElement('canvas');
    cv.className = 'tab-icon';
    cv.width = TAB_ICON_SIZE;
    cv.height = TAB_ICON_SIZE;
    cv.setAttribute('aria-hidden', 'true');
    drawTabIcon(cv, icon);
    btn.insertBefore(cv, btn.firstChild); // текст лишається після іконки
  }
}
