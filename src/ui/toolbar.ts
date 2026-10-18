// П13.2 (ADR-0066): вертикальний тулбар бойових дій збоку — замість нижньої
// смуги кнопок (#bcontrols вилучено з index.html). Модуль шару відображення
// (ADR-0037): будує плитки у #btoolbar, малює іконки піксель-матрицями кодом
// (механізм ADR-0031 без змін) і диспетчеризує кліки у дії бою (main.ts).
// Стан плиток (disabled, причини, .armed) оновлює renderBattle (src/ui/battle.ts)
// за стабільними id (контракт DOM-тестів, урок П11.6). Стиль — style-references
// («П13.2»): темно-сірі плитки, неонові акценти #00E5FF/#FF2E88, білі силуети.

import type { PixelSprite } from '../core/sprites';

// Ідентифікатори дій тулбара — чинні дії бою (src/ui/battle.ts + input/demo);
// «Авто»/«Стоп» — окремий крок П13.3 (ADR-0067), тут їх немає.
export type ToolbarActionId = 'snap' | 'aimed' | 'auto' | 'ow' | 'medkit' | 'grenade' | 'end' | 'demo';

// Палітра іконок (ігровий трек, style-references): білі силуети фігурок,
// неонові акценти блакитний («Рубіж»/гравець) і рожевий (акценти).
const ICON_WHITE = '#FFFFFF';
const ICON_CYAN = '#00E5FF';
const ICON_PINK = '#FF2E88';
const ICON_PALETTE: Readonly<Record<string, string>> = { W: ICON_WHITE, C: ICON_CYAN, P: ICON_PINK };

// Матриця 12×12 @2× = 24px у плитці (ADR-0031: ціле кратне масштабування).
const ICON_PX = 12;
const ICON_SCALE = 2;
export const ICON_SIZE = ICON_PX * ICON_SCALE;

// Швидкий постріл: куля з трасером і спалахом (блакитний вихлоп праворуч).
const ICON_SNAP: PixelSprite = {
  rows: [
    '............',
    '............',
    '..WWWWW.....',
    '..WWWWW.C...',
    '..WWWWWWWC..',
    '..WWWWWWWC..',
    '..WWWWW.C...',
    '..WWWWW.....',
    '............',
    '............',
    '............',
    '............',
  ],
  palette: ICON_PALETTE,
};

// Прицільний: перехрестя з рожевим центром (прорізи навколо центру).
const ICON_AIMED: PixelSprite = {
  rows: [
    '.....WW.....',
    '.....WW.....',
    '.....WW.....',
    '.....WW.....',
    '............',
    'WW...PP...WW',
    'WW...PP...WW',
    '............',
    '.....WW.....',
    '.....WW.....',
    '.....WW.....',
    '.....WW.....',
  ],
  palette: ICON_PALETTE,
};

// Черга: три кулі драбинкою, кожна з трасером.
const ICON_AUTO: PixelSprite = {
  rows: [
    '............',
    'WWWW........',
    'WWWW...C....',
    '............',
    '..WWWW......',
    '..WWWW...C..',
    '............',
    '....WWWW....',
    '....WWWW..C.',
    '............',
    '............',
    '............',
  ],
  palette: ICON_PALETTE,
};

// Дозор: око — блакитний контур, рожевий зіниця.
const ICON_OW: PixelSprite = {
  rows: [
    '............',
    '............',
    '....CCCC....',
    '..CC....CC..',
    '.CC......CC.',
    '.C...PP...C.',
    '.C...PP...C.',
    '.CC......CC.',
    '..CC....CC..',
    '....CCCC....',
    '............',
    '............',
  ],
  palette: ICON_PALETTE,
};

// Лікування: білий медичний хрест, рожеве серце-центр.
const ICON_MEDKIT: PixelSprite = {
  rows: [
    '............',
    '....WWWW....',
    '....WWWW....',
    '....WWWW....',
    '.WWWWWWWWWW.',
    '.WWWWPPWWWW.',
    '.WWWWPPWWWW.',
    '.WWWWWWWWWW.',
    '....WWWW....',
    '....WWWW....',
    '....WWWW....',
    '............',
  ],
  palette: ICON_PALETTE,
};

// Граната: біле тіло, блакитна чека/важіль.
const ICON_GRENADE: PixelSprite = {
  rows: [
    '............',
    '.........CC.',
    '......W..CC.',
    '......WW....',
    '....WWWWWW..',
    '...WWWWWWW..',
    '..WWWWWWWW..',
    '..WWWWWWWW..',
    '..WWWWWWWW..',
    '...WWWWWW...',
    '....WWWW....',
    '............',
  ],
  palette: ICON_PALETTE,
};

// Кінець ходу: годинник (пісок скінчиться — хід чужий).
const ICON_END: PixelSprite = {
  rows: [
    '............',
    '.WWWWWWWWWW.',
    '..W......W..',
    '...W....W...',
    '....W..W....',
    '.....WW.....',
    '.....WW.....',
    '....W..W....',
    '...W....W...',
    '..W......W..',
    '.WWWWWWWWWW.',
    '............',
  ],
  palette: ICON_PALETTE,
};

// Демо-бій: трикутник «плей» — бій дограють боти.
const ICON_DEMO: PixelSprite = {
  rows: [
    '............',
    '..CC........',
    '..CCCC......',
    '..CCCCCC....',
    '..CCCCCCC...',
    '..CCCCCCCC..',
    '..CCCCCCCC..',
    '..CCCCCCC...',
    '..CCCCCC....',
    '..CCCC......',
    '..CC........',
    '............',
  ],
  palette: ICON_PALETTE,
};

export interface ToolbarAction {
  id: ToolbarActionId;
  btnId: string; // стабільний id плитки — той самий, що був у нижній смузі (контракт тестів)
  label: string; // короткий підпис на плитці
  hint: string; // базовий тултіп (AP/клавіша) — причину блокування дописує battle.ts (П6.14)
  icon: PixelSprite;
}

// Перелік дій — за чинними діями бою (src/ui/battle.ts): режими пострілу,
// дозор, витратники (П11.6, ADR-0058), кінець ходу, демо-бій (до П13.3).
export const TOOLBAR_ACTIONS: readonly ToolbarAction[] = [
  { id: 'snap', btnId: 'btn-snap', label: 'Швидкий', hint: '3 AP · ×0.8 · 1 куля · клавіша 1', icon: ICON_SNAP },
  { id: 'aimed', btnId: 'btn-aimed', label: 'Прицільний', hint: '5 AP · ×1.15 · 1 куля · клавіша 2', icon: ICON_AIMED },
  { id: 'auto', btnId: 'btn-auto', label: 'Черга', hint: '4 AP · ×0.5 · 3 кулі · клавіша 3', icon: ICON_AUTO },
  { id: 'ow', btnId: 'btn-ow', label: 'Дозор', hint: '3 AP · реакційний вогонь у хід прибульців · клавіша O', icon: ICON_OW },
  {
    id: 'medkit',
    btnId: 'btn-medkit',
    label: 'Лікування',
    hint: '4 AP · +3 HP пораненому союзнику поруч (≤1) · клавіша M',
    icon: ICON_MEDKIT,
  },
  {
    id: 'grenade',
    btnId: 'btn-grenade',
    label: 'Граната',
    hint: '4 AP · граната, зона епіцентр + хрест (≤6) · клавіша G',
    icon: ICON_GRENADE,
  },
  { id: 'end', btnId: 'btn-end', label: 'Кінець', hint: 'клавіша E', icon: ICON_END },
  { id: 'demo', btnId: 'btn-demo', label: 'Демо', hint: 'Бій дограють боти (демо ітерації P)', icon: ICON_DEMO },
];

export interface ToolbarDeps {
  onAction(id: ToolbarActionId): void;
}

// Розгортання матриці в канву плитки: один fillRect на піксель матриці,
// детерміновано і без RNG (ADR-0003/0031). Малюється один раз при створенні
// тулбара — renderBattle іконки не чіпає (idle → 0 перерисовок, ADR-0029).
export function drawToolbarIcon(cv: HTMLCanvasElement, icon: PixelSprite): void {
  const ctx = cv.getContext('2d');
  if (ctx === null) return; // headless/офлайн без 2d — плитка лишається з підписом
  ctx.imageSmoothingEnabled = false;
  for (let y = 0; y < icon.rows.length; y++) {
    const row = icon.rows[y] ?? '';
    for (let x = 0; x < row.length; x++) {
      const color = icon.palette[row.charAt(x)];
      if (color === undefined) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x * ICON_SCALE, y * ICON_SCALE, ICON_SCALE, ICON_SCALE);
    }
  }
}

// Створити тулбар у контейнері: плитки будуються один раз (розмітка статична,
// стан оновлює battle.ts за id). Клік плитки → onAction з id дії.
export function createToolbar(root: HTMLElement, deps: ToolbarDeps): void {
  for (const a of TOOLBAR_ACTIONS) {
    const b = document.createElement('button');
    b.id = a.btnId;
    b.type = 'button';
    b.dataset.action = a.id;
    b.title = a.hint;
    b.setAttribute('aria-label', a.label);
    const icon = document.createElement('canvas');
    icon.className = 'tb-icon';
    icon.width = ICON_SIZE;
    icon.height = ICON_SIZE;
    drawToolbarIcon(icon, a.icon);
    const cap = document.createElement('span');
    cap.className = 'tb-cap';
    cap.textContent = a.label;
    b.append(icon, cap);
    b.onclick = () => deps.onAction(a.id);
    root.appendChild(b);
  }
}
