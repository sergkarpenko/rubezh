// src/core/sprites.ts — піксель-арт дані спрайтів (пR.3, ADR-0038; П6.12 ADR-0031).
// Матриці пікселів, палітри й типи вхідних даних спрайтів — чисті дані ядра:
// жодного посилання на Canvas/DOM API (ADR-0002). Розгортання матриць в
// offscreen-канваси і малювання drawImage — шар відображення (src/render.ts).
// П12.7 (ADR-0064): редизайн за тематикою «кіберпанк/техномагія» — неонові
// акценти: ціан (гравець/«Рубіж»), пурпур (Розрив), бурштин (спалахи/дозор).
// Матриці: оперативник у плащі з неоновим візором, демон Розриву з «Фазовим
// різаком», вузол-маяк, зонд Розриву, перехоплюач; кадри ходьби — окремі
// матриці, чергуються в анімації руху. Глітч-акценти — лише в подієвих
// анімаціях (ADR-0064): статичні матриці читабельні, без шуму.

import type { Side } from './combat';
import type { UfoKind } from './geo';

// Палітра (П12.7, ADR-0064): неонові акценти на синьо-чорній основі —
// ціан «Рубіжу», пурпур Розриву, бурштин спалахів.
export const PLAYER_BODY = '#175d8a'; // бронекостюм оперативника
export const PLAYER_OUTLINE = '#0a1826'; // темний кант силуета
export const PLAYER_GEAR = '#0d3a5f'; // плащ і спорядження
export const PLAYER_HELMET = '#9fd8f2'; // капюшон-шолом
export const PLAYER_VISOR = '#00e5ff'; // неоновий візор — цяність «Рубіжу»
export const PLAYER_WEAPON = '#e6f7ff'; // кінематична зброя «АР-14 Гарт»
export const ALIEN_BODY = '#a32eff'; // пурпурне тіло демона Розриву
export const ALIEN_OUTLINE = '#2a0a3d'; // темний кант глітч-силуета
export const ALIEN_CRACKS = '#ffd9f2'; // «тріщини світла» в тілі демона
export const ALIEN_LIMBS = '#6f1d9e'; // щупальця-відростки
export const ALIEN_WEAPON = '#ff2e88'; // «Фазовий різак» — неоновий пурпур
export const OW_MARKER = '#ffb347'; // бурштин знака дозору (спалахова гама)
export const OW_OUTLINE = '#0b0e15'; // П6.12b: темний кант знака дозору — контраст на будь-якому тлі
export const BASE_FILL = '#123c5e'; // стовп вежі-вузла «Рубіж»
export const BASE_OUTLINE = '#66d9ff'; // світлі ребра-канти вежі
export const BASE_BEACON = '#00e5ff'; // неоновий маяк-вогонь вузла
export const BASE_WALL = '#0a1a2e'; // темний осередок/брама вежі
// П6.9 (ADR-0029): м'якші позначки зондів — приглушені кольори і прозорість
// 0.85 з обов'язковим відновленням alpha.
export const UFO_LANDED_FILL = '#7a1fd9'; // пурпурний осередок приземленого зонда
export const UFO_LANDED_EDGE = '#e3b8ff'; // світлі «тріщини» глітч-осередку
export const UFO_AIR = '#c45cff'; // контур зонда в повітрі
export const UFO_CORE = '#ff2e88'; // ядро-пульс зонда-«збирача»
export const UFO_LEG = '#4a1580'; // опори приземленого зонда

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
// лівий, демони нижній правий. Урок: бурштиновий знак на пікселях спрайта
// (неоновий візор / пурпурна мантія) без канту губився; кути матриць спрайтів
// прозорі, тло клітинки темне — бурштин з кантом видно на будь-якому тлі,
// силует не перекривається, HP-число в центрі не зачіпається. 5×5 @2× = 10×10.
export const OW_BOLT: PixelSprite = {
  rows: ['.KKK.', 'KKAK.', 'KAAKK', 'KKAAK', '.KKKK'],
  palette: { A: OW_MARKER, K: OW_OUTLINE },
};

// ADR-0031 (П12.7, ADR-0064): оперативник «Рубіжу» — силует у плащі з
// неоновим візором: капюшон, суцільна смуга візора (циан), плащ ліворуч,
// «АР-14 Гарт» вправо (дуло — крайній правий піксель матриці, за межами
// тіла), темний магазин під стволом.
export const SOLDIER_PALETTE: Readonly<Record<string, string>> = {
  H: PLAYER_HELMET,
  V: PLAYER_VISOR,
  O: PLAYER_OUTLINE,
  B: PLAYER_BODY,
  G: PLAYER_GEAR,
  W: PLAYER_WEAPON,
};

export const SOLDIER_STAND: PixelSprite = {
  rows: [
    '....HHHH....',
    '...HHHHHH...',
    '...HVVVVH...',
    '...HHHHHH...',
    '...BBBBBB...',
    '..BBBBBBBB..',
    '.BBBBBBBBB..',
    '.GBBBBBBWW..',
    '.GBBBBWWWWWW',
    '.GGBBBBBB...',
    '.GG..GG.....',
    '..O..O......',
  ],
  palette: SOLDIER_PALETTE,
};

// Кадр ходьби: ноги розставлені (крок) — решта силуету та сама (ADR-0031).
export const SOLDIER_STEP: PixelSprite = {
  rows: [
    '....HHHH....',
    '...HHHHHH...',
    '...HVVVVH...',
    '...HHHHHH...',
    '...BBBBBB...',
    '..BBBBBBBB..',
    '.BBBBBBBBB..',
    '.GBBBBBBWW..',
    '.GBBBBWWWWWW',
    '.GGBBBBBB...',
    '.GG...GG....',
    '.OO....OO...',
  ],
  palette: SOLDIER_PALETTE,
};

// ADR-0031 (П12.7, ADR-0064): демон Розриву — гострокутий глітч-силует:
// шпиляста голова без ока, «тріщини світла» крізь пурпурне тіло, темний кант,
// щупальця знизу; над головою — дві піки «Фазового різака» (неоновий пурпур).
// Силует і зброя свідомо відмінні від оперативника (критерій П6.12: зброя
// відрізняється — колір, форма і розташування пікселів).
export const ALIEN_PALETTE: Readonly<Record<string, string>> = {
  A: ALIEN_BODY,
  C: ALIEN_CRACKS,
  L: ALIEN_LIMBS,
  Y: ALIEN_WEAPON,
  R: ALIEN_OUTLINE,
};

export const ALIEN_STAND: PixelSprite = {
  rows: [
    '..Y..Y......',
    '..Y..Y......',
    '...YY.......',
    '...AAAAA....',
    '..AACACAA...',
    '.AAACACAAA..',
    '.RAAAAAAAAR.',
    '.RAACACAAAR.',
    '.RAAAAAAAAR.',
    '..RAAAAAR...',
    '..L.LL.L....',
    '..L.LL.L....',
  ],
  palette: ALIEN_PALETTE,
};

// Кадр ходьби: щупальця зсунуті (колиже) — решта силуету та сама (ADR-0031).
export const ALIEN_STEP: PixelSprite = {
  rows: [
    '..Y..Y......',
    '..Y..Y......',
    '...YY.......',
    '...AAAAA....',
    '..AACACAA...',
    '.AAACACAAA..',
    '.RAAAAAAAAR.',
    '.RAACACAAAR.',
    '.RAAAAAAAAR.',
    '..RAAAAAR...',
    '.L.LL.L.....',
    '.L.LL.L.....',
  ],
  palette: ALIEN_PALETTE,
};

// ADR-0031 (П12.7, ADR-0064): вузол «Рубіж» геосцени — вежа-маяк: неоновий
// вогонь на вершині (циан), ґратчаста щогла, широкя підніжна платформа з
// темним осередком-брамою. Один великий знак замість дрібних деталей
// (урок П6.12: 16×16 «фортеця» читалась як темний блок). Напис «ВУЗОЛ» —
// ПІД спрайтом, світлим на темному тлі. 12×12 @ 2× = 24px у клітинці GCELL 36.
export const BASE_SPRITE: PixelSprite = {
  rows: [
    '.....PP.....',
    '.....OO.....',
    '.....OO.....',
    '....O..O....',
    '....O..O....',
    '....O..O....',
    '...OOOOOO...',
    '..FFFFFFFF..',
    '.FFFFFFFFFF.',
    '.FFFFDDFFFF.',
    '.FFFFDDFFFF.',
    '............',
  ],
  palette: { P: BASE_BEACON, O: BASE_OUTLINE, F: BASE_FILL, D: BASE_WALL },
};

// Позначка зонда Розриву геосцени (туман: лише виявлені потрапляють у виклик —
// фільтр у main.ts). П6.9 (ADR-0029): м'якість (alpha 0.85 з відновленням)
// лишається. П12.7 (ADR-0064): приземлений зонд — пурпурний глітч-осередок
// (ромб з «тріщинами» світла й опорами), «розвідник» — порожній ромб,
// «збирач» — суцільний ромб із ядром-пульсом (пульс — подієвий кадр,
// у статичній матриці — лише ядро-мітка).
export const UFO_LANDED_SPRITE: PixelSprite = {
  rows: [
    '....HH....',
    '...HKKH...',
    '..HKHHKK..',
    '.HKHHHHKH.',
    'HKKHHHHKKH',
    'HHKHHHHKHH',
    '.HKHHHHKH.',
    '..HKHHKH..',
    '..G....G..',
    '..G....G..',
  ],
  palette: { H: UFO_LANDED_FILL, K: UFO_LANDED_EDGE, G: UFO_LEG },
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
    '....AA....',
    '...AAAA...',
    '..AAAAAA..',
    '.AAAKKAAA.',
    'AAAKKKAAA.',
    '.AAAKKAAA.',
    '..AAAAAA..',
    '...AAAA...',
    '....AA....',
    '..........',
  ],
  palette: { A: UFO_AIR, K: UFO_CORE },
};

// П7.5 (П12.7, ADR-0031/0032): перехоплювач на геосцені — дельта-силует
// гравця, неоновий ціан з темним кантом (контраст на будь-якому тлі —
// урок П6.12b), 10×10 @2× = 20px у клітинці GCELL 36.
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
  palette: { F: '#00e5ff', K: '#0b0e15' },
};
