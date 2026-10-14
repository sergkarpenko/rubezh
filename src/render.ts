// src/render.ts — шар відображення (ADR-0010/0029, П6.7): векторні спрайти Canvas 2D.
// Юніти йдуть з геометричних кружків на впізнавані силуети з характером:
// солдат зі штурмовою гвинтівкою «АР-14 Гарт», прибульчик з «Імпульсним різаком».
// Чисті функції малювання: без DOM-стану і без RNG (ADR-0002/0003 — ядро не зачіпається);
// експортовані для юніт-тестів (мок-контекст записує виклики).

import type { Side } from './core/combat';
import type { UfoKind } from './core/geo';

// Палітра — спадок мінімалізму (ADR-0007): ті самі акценти, що й у кружків.
const PLAYER_BODY = '#6ea8ff';
const PLAYER_OUTLINE = '#31548c';
const PLAYER_GEAR = '#3d5c94';
const PLAYER_HELMET = '#d7e4f7';
const PLAYER_WEAPON = '#e8eef7';
const ALIEN_BODY = '#ff6b6b';
const ALIEN_OUTLINE = '#8f2f2f';
const ALIEN_EYES = '#5a1f1f';
const ALIEN_LIMBS = '#c95454';
const ALIEN_WEAPON = '#ffd27a';
const HP_TEXT = '#0b0e15';
const OW_MARKER = '#d8b25a';
const SELECT_RING = '#d7e4f7';
const BASE_FILL = '#4f8cff';
const BASE_OUTLINE = '#9fc3ff';
const UFO_LANDED = '#e8c545';
const UFO_AIR = '#e0a24a';

// Дані для малювання юніта бойовища: cx/cy — центр клітинки в пікселях buffer'а,
// r — радіус силуету (у превью 8 при клітинці 26). hp — читабельність стану (ADR-0007).
export interface UnitSprite {
  side: Side;
  cx: number;
  cy: number;
  r: number;
  hp: number;
  selected: boolean;
  overwatch: boolean;
}

export interface BaseSprite {
  cx: number;
  cy: number;
  size: number; // сторона клітинки геосцени (GCELL)
}

export interface UfoSprite {
  cx: number;
  cy: number;
  r: number; // половина розміру позначки
  landed: boolean;
  kind: UfoKind;
}

// Маркер заступи — П6.6: строго в межах клітинки юніта
// (гравець — над силуетом, прибульці — під; ті самі зсуви, що й у виправленні).
function drawOverwatchMarker(ctx: CanvasRenderingContext2D, u: UnitSprite): void {
  ctx.fillStyle = OW_MARKER;
  ctx.fillRect(u.cx - 2, u.side === 'player' ? u.cy - u.r - 4 : u.cy + u.r, 4, 4);
}

function drawHpText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number): void {
  ctx.font = '9px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = HP_TEXT;
  ctx.fillText(text, x, y);
}

// Солдат: круглий корпус (броня) + шолом зверху + рюкзак зліва +
// штурмова гвинтівка «АР-14 Гарт» — довгий прямий ствол вправо із магазином.
export function drawSoldierSprite(ctx: CanvasRenderingContext2D, u: UnitSprite): void {
  if (u.overwatch) drawOverwatchMarker(ctx, u);
  ctx.beginPath();
  ctx.arc(u.cx, u.cy, u.r, 0, Math.PI * 2);
  ctx.fillStyle = PLAYER_BODY;
  ctx.fill();
  ctx.strokeStyle = PLAYER_OUTLINE;
  ctx.lineWidth = 1;
  ctx.stroke();
  // рюкзак (верхній лівий сектор корпусу)
  ctx.fillStyle = PLAYER_GEAR;
  ctx.fillRect(u.cx - 6, u.cy - 6, 4, 5);
  // шолом — менше коло над центром (HP лишається читабельним у центрі корпусу)
  ctx.beginPath();
  ctx.arc(u.cx, u.cy - 4, 2.5, 0, Math.PI * 2);
  ctx.fillStyle = PLAYER_HELMET;
  ctx.fill();
  // «АР-14 Гарт»: ствол — пряма лінія нижньою частиною корпусу, дуло за межами тіла
  ctx.strokeStyle = PLAYER_WEAPON;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(u.cx - 4, u.cy + 5);
  ctx.lineTo(u.cx + u.r + 3, u.cy + 5);
  ctx.stroke();
  ctx.fillStyle = PLAYER_OUTLINE;
  ctx.fillRect(u.cx, u.cy + 6, 2, 3); // магазин
  drawHpText(ctx, String(u.hp), u.cx, u.cy);
  if (u.selected) {
    ctx.strokeStyle = SELECT_RING;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(u.cx, u.cy, u.r + 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1;
  }
}

// Прибульчик: видовжений овал («мантія») з очима, щупальця позаду і
// «Імпульсний різак» — яскрава енергетична «вилка» перед головою.
// Силует і зброя свідомо відмінні від солдата (П6.7: різні силуети, зброя відрізняється).
export function drawAlienSprite(ctx: CanvasRenderingContext2D, u: UnitSprite): void {
  if (u.overwatch) drawOverwatchMarker(ctx, u);
  ctx.beginPath();
  ctx.ellipse(u.cx, u.cy, u.r * 0.8, u.r * 0.95, 0, 0, Math.PI * 2);
  ctx.fillStyle = ALIEN_BODY;
  ctx.fill();
  ctx.strokeStyle = ALIEN_OUTLINE;
  ctx.lineWidth = 1;
  ctx.stroke();
  // очі
  ctx.fillStyle = ALIEN_EYES;
  ctx.fillRect(u.cx - 3, u.cy - 4, 2, 2);
  ctx.fillRect(u.cx + 1, u.cy - 4, 2, 2);
  // щупальця — трьома штрихами позаду (низ), кінці в межах клітинки
  ctx.strokeStyle = ALIEN_LIMBS;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(u.cx - 4, u.cy + 5);
  ctx.lineTo(u.cx - 6, u.cy + 9);
  ctx.moveTo(u.cx, u.cy + 6);
  ctx.lineTo(u.cx, u.cy + 11);
  ctx.moveTo(u.cx + 4, u.cy + 5);
  ctx.lineTo(u.cx + 6, u.cy + 9);
  ctx.stroke();
  // «Імпульсний різак»: енергетична вилка з двома піками перед головою (верх)
  ctx.strokeStyle = ALIEN_WEAPON;
  ctx.beginPath();
  ctx.moveTo(u.cx - 3, u.cy - 9);
  ctx.lineTo(u.cx - 2, u.cy - 12);
  ctx.lineTo(u.cx - 1, u.cy - 9);
  ctx.moveTo(u.cx + 1, u.cy - 9);
  ctx.lineTo(u.cx + 2, u.cy - 12);
  ctx.lineTo(u.cx + 3, u.cy - 9);
  ctx.stroke();
  ctx.lineWidth = 1;
  drawHpText(ctx, String(u.hp), u.cx, u.cy + 2);
  if (u.selected) {
    ctx.strokeStyle = SELECT_RING;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(u.cx, u.cy, u.r + 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1;
  }
}

// Диспетчер за стороною — єдина точка виклику з renderBattle.
export function drawUnitSprite(ctx: CanvasRenderingContext2D, u: UnitSprite): void {
  if (u.side === 'player') drawSoldierSprite(ctx, u);
  else drawAlienSprite(ctx, u);
}

// База геосцени: колишній синій квадрат з написом, тепер із рамкою-контуром.
export function drawBaseSprite(ctx: CanvasRenderingContext2D, b: BaseSprite): void {
  const half = b.size / 2 - 6;
  ctx.fillStyle = BASE_FILL;
  ctx.fillRect(b.cx - half, b.cy - half, half * 2, half * 2);
  ctx.strokeStyle = BASE_OUTLINE;
  ctx.lineWidth = 1;
  ctx.strokeRect(b.cx - half, b.cy - half, half * 2, half * 2);
  ctx.font = '10px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = BASE_OUTLINE;
  ctx.fillText('БАЗА', b.cx, b.cy);
}

// Позначка НЛО геосцени (туман: лише виявлені потрапляють у виклик — фільтр у main.ts):
// приземлився — залитий квадрат; у повітрі «розвідник» — ромб, «збирач» — контур квадрата.
export function drawUfoSprite(ctx: CanvasRenderingContext2D, u: UfoSprite): void {
  if (u.landed) {
    ctx.fillStyle = UFO_LANDED;
    ctx.fillRect(u.cx - u.r / 2, u.cy - u.r / 2, u.r, u.r);
    return;
  }
  ctx.strokeStyle = UFO_AIR;
  ctx.lineWidth = 1;
  if (u.kind === 'розвідник') {
    ctx.beginPath();
    ctx.moveTo(u.cx, u.cy - u.r / 2);
    ctx.lineTo(u.cx + u.r / 2, u.cy);
    ctx.lineTo(u.cx, u.cy + u.r / 2);
    ctx.lineTo(u.cx - u.r / 2, u.cy);
    ctx.closePath();
    ctx.stroke();
  } else {
    ctx.strokeRect(u.cx - u.r / 2, u.cy - u.r / 2, u.r, u.r);
  }
}
