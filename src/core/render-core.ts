// src/core/render-core.ts — чиста логіка кадрів і анімацій (пR.3, ADR-0038;
// П6.8 ADR-0029, П6.13): типи анімацій і фабрики, прогрес/позиція/тряска,
// черга AnimEngine з ін'єктованим планувальником, перетворювач подій логу в
// анімації (лог — джерело істини, байт-у-байт незмінний) і палітра терену
// нічного бойовища (хеш-варіація без RNG, ADR-0003). Жодного посилання на
// Canvas/DOM API (ADR-0002) — Canvas-виклики живуть у шарі відображення
// (src/render.ts), планувальник кадрів ін'єктується викликачем.

import type { GameEvent, Side, Unit, Vec2 } from './combat';

// --- П6.13 (П12.7, ADR-0064): неонова палітра — синьо-чорна основа, неонові акценти ---
// Ціан — гравець/«Рубіж», пурпур — Розрив, бурштин — спалахи (ADR-0064).

// Фон канви — той самий колір, що й CSS-тло елемента (index.html): при трясці
// translate оголює край 1–2px, і збіг кольорів лишає його непомітним.
// П12.7: фон поглиблено до синьо-чорного (ніч кібернетичної епохи).
export const NIGHT_BG = '#060a14';
// Двотоновий терен: відкритий / завалений, у тумані — приглушені ті самі
// тони (туман — лише рельєф, ADR-0006). «Легка варіація клітинок» — по одному
// з чотирьох відтінків на клітинку за детермінованим хешем координат (без RNG,
// ADR-0003): сусідні клітинки розрізняються, мозаїка стабільна між кадрами.
// П12.7: тони зсунуті в синьо-чорну гаму під неонові акценти.
const TERRAIN_OPEN = ['#0b1220', '#0d1424', '#0a1120', '#0c1322'];
const TERRAIN_BLOCKED = ['#2b3a55', '#30405e', '#27354e', '#2e3d5a'];
const TERRAIN_OPEN_FOG = ['#05080f', '#060a12', '#04070d', '#050911'];
const TERRAIN_BLOCKED_FOG = ['#1a2233', '#1d2537', '#182030', '#1c2435'];
// Тонка напівпрозора НЕОНОВА сітка (П12.7): 1px у проміжках між клітинками
// (клітинки малюються зі стороною cell−1 — сітка заповнює проміжок, урок П6.6).
export const GRID_COLOR = 'rgba(0,229,255,0.08)';
// М'який край туману: клітинка туману з видимим сусідом (4 напрямки)
// перекривається напівпрозорим тоном відкритої видимої клітинки — межа
// «видимо → туман» стає градієнтною. Сенс туману незмінний (ADR-0006):
// рельєф туману видно і так, вміст клітинки (юніти) не розкривається,
// перекриття однакове для порожньої і заваленої клітинки.
// П12.7: край м'якший — прозоріша заливка, перехід плавніший.
export const FOG_EDGE = 'rgba(11,18,32,0.4)';

// --- П12.7 (ADR-0064): терен геосцени — двотоновий із неоновою сіткою ---
// Геосцена не має рельєфу (туман лише в бойовищі, ADR-0006): двотоновий
// терен — детермінований хеш клітинки (без RNG, ADR-0003) вибирає один із
// двох синьо-чорних тонів — ледь помітна мозаїка «нічного світу», сітка —
// тонкі напівпрозорі неонові лінії (циан «Рубіжу»).
export const GEO_CELL_A = '#0a1120';
export const GEO_CELL_B = '#0d1526';
export const GEO_GRID_COLOR = 'rgba(0,229,255,0.10)';

// Тон геосцени клітинки (x, y) — чисте перетворення координат → колір.
export function geoCellTone(x: number, y: number): string {
  return cellHash(x, y) % 2 === 0 ? GEO_CELL_A : GEO_CELL_B;
}

// Клітинка терену: blocked — завалення (рельєф туману видно і в тумані,
// ADR-0006), visible — у зоні видимості гравця.
export interface TerrainCell {
  x: number;
  y: number;
  blocked: boolean;
  visible: boolean;
}

// Детермінований хеш від координат (П6.13, без RNG — ADR-0003): той самий
// (x, y) завжди дає той самий відтінок — мозаїка терену стабільна між кадрами.
export function cellHash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = (h * 1274126177) | 0;
  return (h ^ (h >>> 16)) >>> 0;
}

// Відтінок клітинки терену (чисте перетворення стану → колір, без Canvas):
// два тони (відкритий / завалений) × туман/видимо, варіація — хеш клітинки.
export function terrainShade(x: number, y: number, blocked: boolean, visible: boolean): string {
  const shades = blocked ? (visible ? TERRAIN_BLOCKED : TERRAIN_BLOCKED_FOG) : visible ? TERRAIN_OPEN : TERRAIN_OPEN_FOG;
  return shades[cellHash(x, y) % shades.length] ?? shades[0]!;
}

// Ключі видимих клітинок — для м'якого краю туману (сусідство за 4 напрямками).
export function visibleKeys(cells: readonly TerrainCell[]): Set<string> {
  return new Set(cells.filter((c) => c.visible).map((c) => c.x + ',' + c.y));
}

// Чи є у клітинки туману видимий сусід по прямій (4 напрямки, без діагоналей).
export function hasVisibleNeighbor(vis: ReadonlySet<string>, x: number, y: number): boolean {
  return vis.has(x - 1 + ',' + y) || vis.has(x + 1 + ',' + y) || vis.has(x + ',' + (y - 1)) || vis.has(x + ',' + (y + 1));
}

// --- П6.8 (ADR-0029): анімаційний рушій — черга + rAF лише під час активних анімацій ---

// Тривалості фаз (мс): стримана анімація, без поспіху (дизайн-сесія 6b).
export const MOVE_MS_PER_CELL = 90; // хід: 90 мс на клітинку шляху
export const TRACER_MS = 150; // трасер кулі від стрільця до цілі
export const IMPACT_MS = 200; // спалах влучання (лише при попаданні)
export const DEATH_MS = 350; // згасання силуета загиблого
export const OW_FLASH_MS = 300; // спалах дозору (озброєння реакційного вогню)
export const RADAR_PULSE_MS = 1200; // П6.9: пульс радара — від бази до краю зони виявлення

// Один елемент черги анімацій. start — мітка часу початку відтворення
// (призначає рушій на першому кадрі; null — ще не починалось).
export interface MoveAnim {
  kind: 'move';
  unitId: string;
  side: Side;
  path: Vec2[]; // [from, to1, ...] — клітинкові координати
  hp: number; // знімок стану на момент постановки в чергу
  overwatch: boolean;
  selected: boolean;
  dur: number;
  start: number | null;
}
export interface TracerAnim {
  kind: 'tracer';
  side: Side; // сторона стрільця — колір трасера
  from: Vec2;
  to: Vec2;
  hit: boolean;
  dur: number; // TRACER_MS (+ IMPACT_MS при влучанні)
  start: number | null;
}
export interface DeathAnim {
  kind: 'death';
  side: Side;
  at: Vec2;
  dur: number;
  start: number | null;
}
export interface OwFlashAnim {
  kind: 'owflash';
  side: Side;
  at: Vec2;
  dur: number;
  start: number | null;
}
// П6.9 (ADR-0029): пульс радара геосцени — кільце, що розходиться від бази
// до краю зони виявлення і гасне. Суто візуальний: не читає ні НЛО, ні geo.rng;
// невиявлені НЛО не показуються і не анімуються (туман — ADR-0006/0029).
export interface GeoPulseAnim {
  kind: 'gpulse';
  cx: number; // центр бази в пікселях buffer'а
  cy: number;
  maxR: number; // радіус зони виявлення в пікселях
  dur: number;
  start: number | null;
}
export type Anim = MoveAnim | TracerAnim | DeathAnim | OwFlashAnim | GeoPulseAnim;

// Знімки стану беруться ПІСЛЯ застосування дії ядром (позиція/HP уже фінальні,
// лог — джерело істини про те, що відбулося).
export function makeMoveAnim(u: Unit, path: Vec2[], selected: boolean): MoveAnim {
  return {
    kind: 'move',
    unitId: u.id,
    side: u.side,
    path,
    hp: u.hp,
    overwatch: u.overwatch,
    selected,
    dur: Math.max(1, path.length - 1) * MOVE_MS_PER_CELL,
    start: null,
  };
}
export function makeTracerAnim(side: Side, from: Vec2, to: Vec2, hit: boolean): TracerAnim {
  return { kind: 'tracer', side, from, to, hit, dur: TRACER_MS + (hit ? IMPACT_MS : 0), start: null };
}
export function makeDeathAnim(u: Unit): DeathAnim {
  return { kind: 'death', side: u.side, at: { ...u.pos }, dur: DEATH_MS, start: null };
}
export function makeOwFlashAnim(u: Unit): OwFlashAnim {
  return { kind: 'owflash', side: u.side, at: { ...u.pos }, dur: OW_FLASH_MS, start: null };
}
export function makeGeoPulseAnim(cx: number, cy: number, maxR: number): GeoPulseAnim {
  return { kind: 'gpulse', cx, cy, maxR, dur: RADAR_PULSE_MS, start: null };
}

// Прогрес анімації 0..1 (за межами — клімпиться; start === null → ще не почалась).
export function animT(a: Anim, now: number): number {
  if (a.start === null) return 0;
  return Math.min(1, Math.max(0, (now - a.start) / a.dur));
}

// Позиція рухомого юніта на кадрі: інтерполяція вздовж ламаної шляху (клітинки → px).
export function moveAnimPos(a: MoveAnim, t: number, cell: number): { cx: number; cy: number } {
  const pts = a.path;
  if (t <= 0 || pts.length < 2) return { cx: pts[0].x * cell + cell / 2, cy: pts[0].y * cell + cell / 2 };
  if (t >= 1) {
    const last = pts[pts.length - 1];
    return { cx: last.x * cell + cell / 2, cy: last.y * cell + cell / 2 };
  }
  const prog = t * (pts.length - 1);
  const i = Math.min(Math.floor(prog), pts.length - 2);
  const f = prog - i;
  const x = pts[i].x + (pts[i + 1].x - pts[i].x) * f;
  const y = pts[i].y + (pts[i + 1].y - pts[i].y) * f;
  return { cx: x * cell + cell / 2, cy: y * cell + cell / 2 };
}

// П6.13: легка тряска канвасу при влучанні — зсув кадру на фазі спалаху
// трасера (той самий AnimEngine: тряска живе лише в кадрах анімації, idle →
// 0 перерисовок не порушується). Детерміновано, без RNG (ADR-0003): амплітуда
// спадає до кінця спалаху, коливання — синус/косинус від прогресу фази.
// Викликаюч робить ctx.translate(dx, dy) на весь кадр; фон канви збігається з
// CSS-тлом — оголений край непомітний. Промах не трясе.
export const SHAKE_PX = 2; // максимальна амплітуда (легка тряска)
export function shakeOffset(a: Anim | null, now: number): { dx: number; dy: number } {
  if (a === null || a.kind !== 'tracer' || !a.hit || a.start === null) return { dx: 0, dy: 0 };
  const t = animT(a, now);
  const share = TRACER_MS / a.dur;
  if (t <= share || t >= 1) return { dx: 0, dy: 0 }; // лише фаза спалаху влучання
  const f = (t - share) / (1 - share);
  const amp = SHAKE_PX * (1 - f); // спадає до нуля до кінця спалаху
  // + 0 нормалізує -0 від Math.round малих від'ємних значень (0 === -0, але
  // зсув кадру лишається «строго нульовим» і детермінованим у тестах)
  return { dx: Math.round(amp * Math.sin(f * Math.PI * 4)) + 0, dy: Math.round(amp * Math.cos(f * Math.PI * 4)) + 0 };
}

// Рушій: анімації відтворюються послідовно (черга), rAF-цикл живе ЛИШЕ поки
// черга непорожня — idle → 0 перерисовок (ADR-0029; батарея iPad). Останній
// кадр (черга спорожніла) малюється ще раз — статичний стан без шару анімації.
// schedule/cancel — ін'єктовані (rAF у браузері; у тестах — фейк): render-core
// не знає DOM-глобалів.
export interface AnimEngineDeps {
  schedule: (cb: (now: number) => void) => unknown;
  cancel: (handle: unknown) => void;
  draw: () => void; // повний кадр: clearRect + статика + анімаційний шар (урок П6.6)
  onIdle?: () => void; // П6.16: черга спорожніла після відтворення — рушій пішов у idle
}
export class AnimEngine {
  private queue: Anim[] = [];
  private handle: unknown = null;
  private lastNow = 0;
  constructor(private readonly deps: AnimEngineDeps) {}
  get busy(): boolean {
    return this.queue.length > 0;
  }
  active(): Anim | null {
    return this.queue[0] ?? null;
  }
  get now(): number {
    return this.lastNow;
  }
  push(...anims: Anim[]): void {
    this.queue.push(...anims);
    if (this.handle === null) this.handle = this.deps.schedule(this.frame);
  }
  cancel(): void {
    this.queue = [];
    if (this.handle !== null) {
      this.deps.cancel(this.handle);
      this.handle = null;
    }
  }
  private readonly frame = (now: number): void => {
    this.lastNow = now;
    const a = this.queue[0];
    if (a !== undefined) {
      if (a.start === null) a.start = now;
      if (now - a.start >= a.dur) {
        this.queue.shift();
        const n = this.queue[0];
        if (n !== undefined) n.start = now;
      }
    }
    this.deps.draw();
    if (this.queue.length === 0) {
      this.handle = null; // idle: наступних кадрів не плануємо
      this.deps.onIdle?.(); // П6.16: серія анімацій відтворена (без push не викликається)
      return;
    }
    this.handle = this.deps.schedule(this.frame);
  };
}

// Чистий перетворювач подій логу бою в анімації (П6.8, ADR-0029: анімація —
// відображення, лог — джерело істини). Лог і юніти тільки ЧИТАЮТЬСЯ:
// state.log/стан байт-у-байт не змінюються.
// Особливості порядку подій ядра: moveUnit пише окрему подію на кожен крок
// (реакційний вогонь між кроками перериває рух) — послідовні кроки одного
// юніта об'єднуються в один хід по шляху; fireOnce пише смерть РАНІШЕ за
// постріл, що її спричинив — відтворюємо спершу трасер, потім смерть.
export function animsFromEvents(events: readonly GameEvent[], units: readonly Unit[]): Anim[] {
  const byId = new Map(units.map((u) => [u.id, u]));
  const anims: Anim[] = [];
  let i = 0;
  while (i < events.length) {
    const e = events[i];
    if (e.type === 'move') {
      const path: Vec2[] = [{ ...e.from }, { ...e.to }];
      let j = i + 1;
      while (j < events.length) {
        const m = events[j];
        if (m.type !== 'move' || m.unitId !== e.unitId) break;
        path.push({ ...m.to });
        j++;
      }
      const u = byId.get(e.unitId);
      if (u !== undefined) anims.push(makeMoveAnim(u, path, false));
      i = j;
      continue;
    }
    if (e.type === 'death') {
      const next = events[i + 1];
      const victim = byId.get(e.unitId);
      if (next !== undefined && next.type === 'shot' && next.targetId === e.unitId) {
        const shooter = byId.get(next.shooterId);
        if (shooter !== undefined && victim !== undefined) {
          anims.push(makeTracerAnim(shooter.side, { ...shooter.pos }, { ...victim.pos }, next.hit));
          anims.push(makeDeathAnim(victim));
        }
        i += 2;
        continue;
      }
      if (victim !== undefined) anims.push(makeDeathAnim(victim));
      i++;
      continue;
    }
    if (e.type === 'shot') {
      const shooter = byId.get(e.shooterId);
      const target = byId.get(e.targetId);
      if (shooter !== undefined && target !== undefined) {
        anims.push(makeTracerAnim(shooter.side, { ...shooter.pos }, { ...target.pos }, e.hit));
      }
      i++;
      continue;
    }
    if (e.type === 'overwatch' && e.armed) {
      const u = byId.get(e.unitId);
      if (u !== undefined) anims.push(makeOwFlashAnim(u));
    }
    i++; // turn — не анімується; overwatch(armed:false) ядра не логує
  }
  return anims;
}
