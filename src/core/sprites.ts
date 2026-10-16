// src/core/sprites.ts — піксель-арт дані спрайтів (пR.3, ADR-0038; П6.12 ADR-0031).
// Матриці пікселів, палітри й типи вхідних даних спрайтів — чисті дані ядра:
// жодного посилання на Canvas/DOM API (ADR-0002). Розгортання матриць в
// offscreen-канваси і малювання drawImage — шар відображення (src/render.ts).
// Матриці: солдат з «АР-14 Гарт», прибульчик з «Імпульсним різаком», база,
// НЛО, винищувач; кадри ходьби — окремі матриці, чергуються в анімації руху.

import type { Side } from './combat';
import type { UfoKind } from './geo';

// Палітра — спадок мінімалізму (ADR-0007): ті самі акценти, що й у кружків.
export const PLAYER_BODY = '#6ea8ff';
export const PLAYER_OUTLINE = '#31548c';
export const PLAYER_GEAR = '#3d5c94';
export const PLAYER_HELMET = '#d7e4f7';
export const PLAYER_WEAPON = '#e8eef7';
export const ALIEN_BODY = '#ff6b6b';
export const ALIEN_OUTLINE = '#8f2f2f';
export const ALIEN_EYES = '#5a1f1f';
export const ALIEN_LIMBS = '#c95454';
export const ALIEN_WEAPON = '#ffd27a';
export const OW_MARKER = '#d8b25a';
export const OW_OUTLINE = '#0b0e15'; // П6.12b: темний кант знака дозору — контраст на будь-якому тлі
export const BASE_FILL = '#4f8cff';
export const BASE_OUTLINE = '#9fc3ff';
// П6.9 (ADR-0029): м'якші позначки НЛО — приглушені кольори (менш кислотні,
// ніж #e8c545/#e0a24a) і прозорість 0.85 з обов'язковим відновленням alpha.
export const UFO_LANDED_FILL = '#cbb05a';
export const UFO_LANDED_EDGE = '#e6d59a';
export const UFO_AIR = '#c79250';
export const UFO_LEG = '#a8862f'; // П6.12 (ADR-0031): опори приземленого НЛО
export const BASE_WALL = '#234083'; // П6.12 (ADR-0031): темні стіни бази геосцени

// Дані для малювання юніта бойовища: cx/cy — центр клітинки в пікселях buffer'а,
// r — радіус маркерів (рамка вибору, дозор; у прев'ю 8 при клітинці 26).
// hp — читабельність стану (ADR-0007). frame — кадр ходьби (0 «стій», 1 «крок»):
// передається лише анімацією руху (П6.12), у статиці малюється кадр «стій».
export interface UnitSprite {
  side: Side;
  cx: number;
  cy: number;
  r: number;
  hp: number;
  selected: boolean;
  overwatch: boolean;
  frame?: number;
}

export interface BaseSprite {
  cx: number;
  cy: number;
  size: number; // сторона клітинки геосцени (GCELL)
}

export interface UfoSprite {
  cx: number;
  cy: number;
  landed: boolean;
  kind: UfoKind;
}

export interface FighterSprite {
  cx: number;
  cy: number;
}

// --- П6.12 (ADR-0031): піксель-арт — матриці пікселів ---

// Матриця спрайта: рядки рівної довжини, символ → колір палітри,
// '.' (та будь-який символ поза палітрою) — прозорий піксель.
export interface PixelSprite {
  rows: readonly string[];
  palette: Readonly<Record<string, string>>;
}

// Ціле кратне масштаб у клітинці (ADR-0031): 12×12 → 24px у клітинці BCELL 26
// (запас 1px з боків — маркери й рамка вибору в межах клітинки, урок П6.6),
// на 520 і 720px пікселі лишаються рівними квадратами.
export const SPRITE_SCALE = 2;

// Маркер дозору (доробка П6.12b за повторною валідацією власника):
// піксельна «блискавка» з ТЕМНИМ КАНТОМ у кутку клітинки — гравець верхній
// лівий, прибульці нижній правий. Урок: золотий знак на пікселях спрайта
// (світлий шолом / червона мантія) без канту губився; кути матриць спрайтів
// прозорі, тло клітинки темне — золото з кантом видно на будь-якому тлі,
// силует не перекривається, HP-число в центрі не зачіпається. 5×5 @2× = 10×10.
export const OW_BOLT: PixelSprite = {
  rows: ['.KKK.', 'KKAK.', 'KAAKK', 'KKAAK', '.KKKK'],
  palette: { A: OW_MARKER, K: OW_OUTLINE },
};

// ADR-0031 (П6.12): солдат зі штурмовою гвинтівкою «АР-14 Гарт» — шолом з
// темним визиром, броня, рюкзак зліва, ствол вправо (дуло — крайній правий
// піксель матриці, за межами тіла), магазин темний під стволом.
export const SOLDIER_PALETTE: Readonly<Record<string, string>> = {
  H: PLAYER_HELMET,
  O: PLAYER_OUTLINE,
  B: PLAYER_BODY,
  G: PLAYER_GEAR,
  W: PLAYER_WEAPON,
};

export const SOLDIER_STAND: PixelSprite = {
  rows: [
    '....HHHH....',
    '...HHHHHH...',
    '...HHHHHH...',
    '...HOOOOH...',
    '..BBBBBBBB..',
    '.GBBBBBBBB..',
    '.GGBBBBBBWW.',
    '.GGBBBBBWWWW',
    '..BBBBBBOO..',
    '..GG..GG....',
    '..OO..OO....',
    '............',
  ],
  palette: SOLDIER_PALETTE,
};

// Кадр ходьби: ноги розставлені (крок) — решта силуету та сама (ADR-0031).
export const SOLDIER_STEP: PixelSprite = {
  rows: [
    '....HHHH....',
    '...HHHHHH...',
    '...HHHHHH...',
    '...HOOOOH...',
    '..BBBBBBBB..',
    '.GBBBBBBBB..',
    '.GGBBBBBBWW.',
    '.GGBBBBBWWWW',
    '..BBBBBBOO..',
    '..GG...GG...',
    '.OO.....OO..',
    '............',
  ],
  palette: SOLDIER_PALETTE,
};

// ADR-0031 (П6.12): прибульчик з «Імпульсним різаком» — енергетична «вилка»
// з двома піками над головою, мантія з темними очима, щупальця знизу.
// Силует і зброя свідомо відмінні від солдата (критерій П6.12: зброя
// відрізляється — колір, форма і розташування пікселів).
export const ALIEN_PALETTE: Readonly<Record<string, string>> = {
  A: ALIEN_BODY,
  E: ALIEN_EYES,
  L: ALIEN_LIMBS,
  Y: ALIEN_WEAPON,
  R: ALIEN_OUTLINE,
};

export const ALIEN_STAND: PixelSprite = {
  rows: [
    '....Y..Y....',
    '....Y..Y....',
    '.....YY.....',
    '....AAAA....',
    '...AAAAAA...',
    '...AEAAEA...',
    '..RAAAAAAR..',
    '..RAAAAAAR..',
    '..RAAAAAAR..',
    '...RAAAAR...',
    '...L.LL.L...',
    '...L.LL.L...',
  ],
  palette: ALIEN_PALETTE,
};

// Кадр ходьби: щупальця зсунуті (колиже) — решта силуету та сама (ADR-0031).
export const ALIEN_STEP: PixelSprite = {
  rows: [
    '....Y..Y....',
    '....Y..Y....',
    '.....YY.....',
    '....AAAA....',
    '...AAAAAA...',
    '...AEAAEA...',
    '..RAAAAAAR..',
    '..RAAAAAAR..',
    '..RAAAAAAR..',
    '...RAAAAR...',
    '..L.LL.L....',
    '..L.LL.L....',
  ],
  palette: ALIEN_PALETTE,
};

// ADR-0031 (П6.12, доробка за валідацією власника): база геосцени —
// «Радарний пост»: велика світла тарілка на темній щоглі, світла хатина
// з темними воротами. Один великий знак замість дрібних деталей (попередня
// 16×16 «фортеця» на 32px читалась як темний блок). Напис «БАЗА» — ПІД
// спрайтом, світлим на темному тлі (раніше текст поверх іконки мав
// майже нульовий контраст). 12×12 @ 2× = 24px у клітинці GCELL 36.
export const BASE_SPRITE: PixelSprite = {
  rows: [
    '...OOOOOO...',
    '....OOOO....',
    '.....OO.....',
    '.....DD.....',
    '.....DD.....',
    '..BBBBBBBB..',
    '.OOOOOOOOOO.',
    '.OOOODDOOOO.',
    '.OOOODDOOOO.',
    '.OOOODDOOOO.',
    '.OOOOOOOOOO.',
    '............',
  ],
  palette: { O: BASE_OUTLINE, D: BASE_WALL, B: BASE_FILL },
};

// Позначка НЛО геосцени (туман: лише виявлені потрапляють у виклик — фільтр у main.ts).
// П6.9 (ADR-0029): м'якість (alpha 0.85 з відновленням) лишається.
// П6.12 (ADR-0031): форми — піксельні: приземлений — тарілка з куполом і
// опорами, «розвідник» — порожній ромб, «збирач» — контур кола з ядром-відсіком.
export const UFO_LANDED_SPRITE: PixelSprite = {
  rows: [
    '...SSSS...',
    '..SSSSSS..',
    '..SSSSSS..',
    '.HHHHHHHH.',
    'HHHHHHHHHH',
    'HHHHHHHHHH',
    '.HHHHHHHH.',
    '..HHHHHH..',
    '..G....G..',
    '..G....G..',
  ],
  palette: { H: UFO_LANDED_FILL, S: UFO_LANDED_EDGE, G: UFO_LEG },
};

export const UFO_SCOUT_SPRITE: PixelSprite = {
  rows: [
    '....AA....',
    '...A..A...',
    '..A....A..',
    '.A......A.',
    'A........A',
    'A........A',
    '.A......A.',
    '..A....A..',
    '...A..A...',
    '....AA....',
  ],
  palette: { A: UFO_AIR },
};

export const UFO_HARVESTER_SPRITE: PixelSprite = {
  rows: [
    '..AAAAAA..',
    '.A......A.',
    'A........A',
    'A........A',
    'A...AA...A',
    'A...AA...A',
    'A........A',
    'A........A',
    '.A......A.',
    '..AAAAAA..',
  ],
  palette: { A: UFO_AIR },
};

// П7.5 (ADR-0031/0032): піксель-арт винищувача на геосцені — дельта-крило гравця, холодний
// блакит з темним кантом (контраст на будь-якому тлі — урок П6.12b), 10×10 @2× = 20px у клітинці GCELL 36.
export const FIGHTER_SPRITE: PixelSprite = {
  rows: [
    '....FF....',
    '....FF....',
    '...FFFF...',
    '.FFFFFFFF.',
    'F.KKFFKK.F',
    'F..FFFF..F',
    '....FF....',
    '...F..F...',
    '...F..F...',
    '...F..F...',
  ],
  palette: { F: '#6fd3ff', K: '#0b0e15' },
};
