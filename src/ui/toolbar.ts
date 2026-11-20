// П13.2 (ADR-0066): вертикальний тулбар бойових дій збоку — замість нижньої
// смуги кнопок (#bcontrols вилучено з index.html). Модуль шару відображення
// (ADR-0037): будує плитки у #btoolbar, малює іконки піксель-матрицями кодом
// (механізм ADR-0031 без змін) і диспетчеризує кліки у дії бою (main.ts).
// Стан плиток (disabled, причини, .armed) оновлює renderBattle (src/ui/battle.ts)
// за стабільними id (контракт DOM-тестів, урок П11.6). Стиль — style-references
// («П13.2»): темно-сірі плитки, неонові акценти #00E5FF/#FF2E88, білі силуети.

import type { PixelSprite } from '../core/sprites';
import {
  EVAC_AP_COST,
  GRENADE_AP_COST,
  GRENADE_DAMAGE,
  GRENADE_RANGE,
  HEAL_AP_COST,
  HEAL_AMOUNT,
  OVERWATCH_AP_COST,
  RIFLE,
} from '../core/combat';

// Ідентифікатори дій тулбара — чинні дії бою (src/ui/battle.ts + input/
// auto-battle); «Авто»/«Стоп» — перемикач авто-бою (П13.3, ADR-0067).
// Т.71 (ADR-0075): «Евакуація» — між гранатою і кінцем ходу.
export type ToolbarActionId = 'snap' | 'aimed' | 'auto' | 'ow' | 'medkit' | 'grenade' | 'evac' | 'end' | 'auto-battle';

// Палітра іконок (ігровий трек, style-references): білі силуети фігурок,
// неонові акценти блакитний («Рубіж»/гравець) і рожевий (акценти).
const ICON_WHITE = '#FFFFFF';
const ICON_CYAN = '#00E5FF';
const ICON_PINK = '#FF2E88';
const ICON_PALETTE: Readonly<Record<string, string>> = { W: ICON_WHITE, C: ICON_CYAN, P: ICON_PINK };

// Матриця 12×12 @3× = 36px у плитці (ADR-0031: ціле кратне масштабування;
// П13.5 ADR-0068 — більші іконки у більших плитках).
const ICON_PX = 12;
const ICON_SCALE = 3;
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

// П13.3 (ADR-0067): авто-бій — трикутник «плей» (політика веде загін) і
// білі смуги «пауза» праворуч («Стоп» — керування назад гравцю).
const ICON_AUTO_BATTLE: PixelSprite = {
  rows: [
    '............',
    '..CCC.......',
    '..CCCC......',
    '..CCCCC...WW',
    '..CCCCCC..WW',
    '..CCCCCCC.WW',
    '..CCCCCCC.WW',
    '..CCCCCC..WW',
    '..CCCCC...WW',
    '..CCCC......',
    '..CCC.......',
    '............',
  ],
  palette: ICON_PALETTE,
};

// Т.71 (ADR-0075): евакуація — блакитна стрілка вгору з білої рамки (клітинки висадки).
const ICON_EVAC: PixelSprite = {
  rows: [
    '.....CC.....',
    '....CCCC....',
    '...CCCCCC...',
    '..CC.CC.CC..',
    '.....CC.....',
    '.....CC.....',
    'WWW..CC..WWW',
    'W....CC....W',
    'W..........W',
    'W..........W',
    'W..........W',
    'WWWWWWWWWWWW',
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

// П12.5 (ADR-0065): підказки режимів пострілу — числа ТІЛЬКИ з констант
// RIFLE (combat.ts, одне місце правди): AP, множник точності, кількість куль.
function fireModeHint(mode: 'snap' | 'aimed' | 'auto', key: string): string {
  const m = RIFLE.modes[mode];
  return m.apCost + ' AP · ×' + m.accuracyMod + ' · ' + m.shots + (m.shots === 1 ? ' куля' : ' кулі') + ' · клавіша ' + key;
}

// Перелік дій — за чинними діями бою (src/ui/battle.ts): режими пострілу,
// дозор, витратники (П11.6, ADR-0058), кінець ходу, авто-бій (П13.3, ADR-0067
// — підпис «Авто» міняється на «Стоп» у renderBattle за станом драйвера).
// П12.5 (ADR-0065): усі числа механіки — з констант каталогів (combat.ts),
// текст не дублює числа руками.
export const TOOLBAR_ACTIONS: readonly ToolbarAction[] = [
  { id: 'snap', btnId: 'btn-snap', label: 'Швидкий', hint: fireModeHint('snap', '1'), icon: ICON_SNAP },
  { id: 'aimed', btnId: 'btn-aimed', label: 'Прицільний', hint: fireModeHint('aimed', '2'), icon: ICON_AIMED },
  { id: 'auto', btnId: 'btn-auto', label: 'Черга', hint: fireModeHint('auto', '3'), icon: ICON_AUTO },
  {
    id: 'ow',
    btnId: 'btn-ow',
    label: 'Дозор',
    hint: OVERWATCH_AP_COST + ' AP · реакційний вогонь у хід демонів Розриву · клавіша O',
    icon: ICON_OW,
  },
  {
    id: 'medkit',
    btnId: 'btn-medkit',
    label: 'Лікування',
    hint: HEAL_AP_COST + ' AP · +' + HEAL_AMOUNT + ' HP пораненому союзнику поруч (≤1) · клавіша M',
    icon: ICON_MEDKIT,
  },
  {
    id: 'grenade',
    btnId: 'btn-grenade',
    label: 'Граната',
    hint:
      GRENADE_AP_COST +
      ' AP · пошкодження ' +
      GRENADE_DAMAGE[0] +
      '–' +
      GRENADE_DAMAGE[1] +
      ', зона епіцентр + хрест (≤' +
      GRENADE_RANGE +
      '), уражає і своїх · клавіша G',
    icon: ICON_GRENADE,
  },
  {
    id: 'evac',
    btnId: 'btn-evac',
    label: 'Евакуація',
    // Т.91 (рішення власника 21.11.2026, кандидат 100): премії немає лише при евакуації всього загону —
    // часткова евакуація з перемогою решти премію дає (missionOutcome, ADR-0075)
    hint:
      EVAC_AP_COST +
      ' AP · оперативник на синій клітинці висадки покидає бій; якщо евакуювати весь загін, премії за місію немає · клавіша V',
    icon: ICON_EVAC,
  },
  { id: 'end', btnId: 'btn-end', label: 'Кінець', hint: 'клавіша E', icon: ICON_END },
  {
    id: 'auto-battle',
    btnId: 'btn-auto-battle',
    label: 'Авто',
    hint: 'Авто-бій: політика ядра веде загін; «Стоп» — продовжити вручну',
    icon: ICON_AUTO_BATTLE,
  },
];

// Т.33: клавіша і ціна в AP — у кутках плитки (висота плитки без змін); ціни — з констант ядра.
const TILE_KEY: Partial<Record<ToolbarActionId, string>> = {
  snap: '1',
  aimed: '2',
  auto: '3',
  ow: 'O',
  medkit: 'M',
  grenade: 'G',
  evac: 'V',
  end: 'E',
};
const ITEM_AP: Partial<Record<ToolbarActionId, number>> = {
  ow: OVERWATCH_AP_COST,
  medkit: HEAL_AP_COST,
  grenade: GRENADE_AP_COST,
  evac: EVAC_AP_COST,
};

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
    const ap = a.id === 'snap' || a.id === 'aimed' || a.id === 'auto' ? RIFLE.modes[a.id].apCost : ITEM_AP[a.id];
    for (const [cls, text] of [['tb-ap', ap === undefined ? undefined : ap + ' AP'] as const, ['tb-key', TILE_KEY[a.id]] as const]) {
      if (text === undefined) continue;
      const c = document.createElement('span');
      c.className = cls;
      c.textContent = text;
      b.append(c);
    }
    b.onclick = () => deps.onAction(a.id);
    root.appendChild(b);
  }
}
