// П14.8 (ADR-0073): обмежені ambient-анімації — «жива» картинка як уточнення
// правила idle → 0 перерисовок (ADR-0029): базовий режим лишається чинним —
// вимкнений тумблер або фоновий документ = 0 перерисовок. Ambient — суто шар
// відображення (ADR-0002/0037): стан ядра, лог і rng не чіпаються, подій
// логу не породжує (критерій П14.8: лог партії байт-у-байт однаковий з
// ambient і без). Детермінізм (ADR-0003): ефекти — чисті функції від
// wall-clock (performance.now) і позицій, жодного Math.random/geo.rng.
// Бюджет (ADR-0073 п.4):
// тротлер ≤ 10 fps, одночасних ефектів — не більше AMBIENT_MAX_EFFECTS
// (стала шару відображення). Фіксований перелік ефектів затверджено П14.8
// (ADR-0073 п.5); нові постійні цикли — лише через новий ADR:
//   wall-pulse   — пульсація ціанових кантів стін бою (повільна синусоїда);
//   radar-sweep  — безперервне повільне обертання радар-сектора геосцени
//                  у стані спокою (розвиток gscan П14.5);
//   hp-glow      — легке підсвічування HP-бейджів (П14.4) при частці
//                  hp/maxHp < AMBIENT_HP_FRACTION.
// city-flicker (мерехтіння вогнів міст) вимкнено у позафазній лінії
// «візуальні порівняння» (кандидат А «нічний супутник», 2026-10-22):
// вогні міст намальовані на карті світу — рендер-хеш дублював би їх.
// Стартовий екран не анімується (П14.7: 0 нових анімацій лишається чинним).
// Тумблер — патерн звуку (ADR-0059; персист поза сейвом ADR-0026): ключ
// rubezh.settings.ambient у локальному сховищі, дефолт — увімкнено;
// зміна тумблера — без перезапуску застосунку.

import { type TerrainCell } from '../core/render-core';
import { RADAR_RANGE } from '../core/geo';
import { HP_BAR_H, HP_BAR_W, HP_BAR_Y } from '../render';
import type { Vec2 } from '../core/combat';

// --- Тумблер: localStorage ПОЗА сейвом (ADR-0073 п.3; патерн audio.ts) ---

export const AMBIENT_KEY = 'rubezh.settings.ambient'; // '1' — увімк, '0' — вимк

export interface AmbientStore {
  read(): string | null;
  write(v: '1' | '0'): void;
}

const browserStore: AmbientStore = {
  read: () => localStorage.getItem(AMBIENT_KEY),
  write: (v) => localStorage.setItem(AMBIENT_KEY, v),
};

// --- Бюджет ADR-0073 п.4: частота і ліміт ефектів ---

export const AMBIENT_FPS_MAX = 10; // частота ambient-шару, кадрів/с
export const AMBIENT_FRAME_MS = Math.ceil(1000 / AMBIENT_FPS_MAX); // ≥ 100 мс між репейнтами
export const AMBIENT_MAX_EFFECTS = 4; // ліміт одночасних ефектів (стала шару відображення)
export const AMBIENT_HP_FRACTION = 0.35; // hp-glow: підсвічування нижче цієї частки HP

// --- Чисті функції прогресу (детерміновані, без RNG — ADR-0003) ---
// t — wall-clock (performance.now); періоди — константи ефектів; нормування
// фази тримає функцію сталою на одному періоді (той самий t = той самий кадр).

const WALL_PULSE_MS = 4000; // wall-pulse: повільна пульсація кантів стін
const HP_GLOW_MS = 1000; // hp-glow: подих підсвічування бейджів
const SWEEP_MS = 6000; // radar-sweep: повний оберт сектора

// Фаза у межах періоду (негативний wall-clock не ламає прогрес).
function phase(t: number, period: number): number {
  return ((t % period) + period) % period;
}

// wall-pulse: альфа ціанового канту — повільна синусоїда 0.10..0.24
// (легкий подих, не деренчання — «жива» картинка без шуму).
export function wallPulseAlpha(t: number): number {
  return 0.1 + 0.14 * (0.5 + 0.5 * Math.sin((2 * Math.PI * phase(t, WALL_PULSE_MS)) / WALL_PULSE_MS));
}

// hp-glow: альфа підсвічування бейджа — пульс 0.25..0.55 (помітніший за
// стіни: стан юніта — інформація, не декор).
export function hpGlowAlpha(t: number): number {
  return 0.25 + 0.3 * (0.5 + 0.5 * Math.sin((2 * Math.PI * phase(t, HP_GLOW_MS)) / HP_GLOW_MS));
}

// radar-sweep: кут сектора розгортки — безперервний повний оберт (розвиток
// подієвого gscan П14.5, який видно лише між сканами на тік).
export function radarSweepAngle(t: number): number {
  return -Math.PI / 2 + (2 * Math.PI * phase(t, SWEEP_MS)) / SWEEP_MS;
}

// --- Малювальники ефектів: фіксований перелік П14.8 (ADR-0073 п.5) ---
// Чисті функції: ctx і сцена інжектуються, t — від викликача (facade) —
// у тестах мок-контекст записує потік викликів (детермінізм від t).
// Ліміти: не більше AMBIENT_MAX_EFFECTS одночасних ефектів на кадр
// (стіни — один ефект, розгортка — один, вогник/бейдж — по одному на ціль);
// порядок детермінований (стіни/розгортка перші, далі цілі в порядку сцени).
// Усі примітиви — у межах клітинок (урок П6.6); туман вирішує викликач:
// у сцену потрапляють лише намальовані юніти (battle.ts пропускає
// невидимих прибульців — ADR-0006), рельєф стін туман показує і так.

// Юніт бою з погляду ambient-шару: відображувана клітинка і HP (туман
// враховано на боці викликача; окремих знань про стан гри модуль не має).
export interface AmbientUnitView {
  at: Vec2;
  hp: number;
  maxHp: number;
}

// Сцена бою: клітинки (стіни — blocked) і намальовані юніти.
export interface AmbientBattleScene {
  cell: number; // BCELL
  cw: number;
  ch: number;
  cells: readonly TerrainCell[];
  units: readonly AmbientUnitView[];
}

// Сцена геосцени: клітинка бази (центр розгортки). Терен — цілісна
// картина світу (кандидат А «нічний супутник»): ambient-шар про розклад
// не знає — вогні міст намальовані на самій карті.
// scanActive (фікс фідбеку валідації): подієвий скан-радар П14.5 грає —
// ambient-розгортку не малюємо (один сектор на кадр, без «другого радара»
// на тік/добу; між сканами сектор спокою знову видно).
export interface AmbientGeoScene {
  cell: number; // GCELL
  cw: number;
  ch: number;
  base: Vec2;
  scanActive?: boolean;
}

// Бій: wall-pulse (кванти стін) + hp-glow (бейджі поранених).
export function paintBattleAmbient(ctx: CanvasRenderingContext2D, s: AmbientBattleScene, t: number): void {
  let fx = 0; // лічильник одночасних ефектів (бюджет ADR-0073 п.4)
  if (s.cells.some((c) => c.blocked) && fx < AMBIENT_MAX_EFFECTS) {
    fx++; // wall-pulse — один ефект на всі стіни (пульс ціанового канту)
    ctx.strokeStyle = 'rgba(0,229,255,' + wallPulseAlpha(t).toFixed(3) + ')';
    ctx.lineWidth = 1;
    for (const c of s.cells) {
      if (c.blocked) ctx.strokeRect(c.x * s.cell + 1.5, c.y * s.cell + 1.5, s.cell - 3, s.cell - 3);
    }
  }
  if (fx >= AMBIENT_MAX_EFFECTS) return;
  const glow = 'rgba(255,92,122,' + hpGlowAlpha(t).toFixed(3) + ')';
  for (const u of s.units) {
    if (fx >= AMBIENT_MAX_EFFECTS) break;
    if (u.maxHp <= 0 || u.hp / u.maxHp >= AMBIENT_HP_FRACTION) continue; // лише низький HP
    fx++; // hp-glow — по одному на пораненого юніта
    // геометрія бейджа — константи render.ts (HP_BAR_*): підсвічування смуги HP
    ctx.fillStyle = glow;
    ctx.fillRect(u.at.x * s.cell + (s.cell - HP_BAR_W) / 2, u.at.y * s.cell + s.cell / 2 + HP_BAR_Y, HP_BAR_W, HP_BAR_H);
  }
}

// Геосцена: radar-sweep (розгортка у стані спокою; city-flicker вимкнено —
// вогні міст намальовані на карті світу, кандидат А «нічний супутник»).
export function paintGeoAmbient(ctx: CanvasRenderingContext2D, s: AmbientGeoScene, t: number): void {
  let fx = 0; // лічильник одночасних ефектів (бюджет ADR-0073 п.4)
  const cx = s.base.x * s.cell + s.cell / 2;
  const cy = s.base.y * s.cell + s.cell / 2;
  // Фікс фідбеку валідації («сектор знизу обрізається»): зона сенсорної сітки
  // (RADAR_RANGE 4 від бази в центрі світу 16×8) виходить за нижню межу
  // світу — розгортка на повний радіус зоны різко обрізалась краєм канви і
  // промінь «зникав» на нижній дузі оберту. Радіус вписано у канву: коло
  // розгортки завжди повністю видиме, обертання без розривів. Суто
  // відображення (ADR-0073): зона виявлення у ядрі не змінюється; подієвий
  // gscan (короткий, 1200 мс) лишається на повному радіусі — там обріз
  // непомітний, а ambient-сектор обертається безперервно.
  const maxR = Math.max(1, Math.min((RADAR_RANGE + 0.5) * s.cell, cx, cy, s.cw - cx, s.ch - cy));
  if (!s.scanActive && fx < AMBIENT_MAX_EFFECTS) {
    fx++; // radar-sweep — безперервна розгортка (розвиток подієвого gscan)
    const ang = radarSweepAngle(t);
    ctx.strokeStyle = 'rgba(0,229,255,0.3)'; // передній край — приглушений ціан «Рубіжу»
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(ang) * maxR, cy + Math.sin(ang) * maxR);
    ctx.stroke();
    ctx.fillStyle = 'rgba(0,229,255,0.05)'; // слід сектора за променем (глибина розгортки)
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, maxR, ang - Math.PI / 6, ang);
    ctx.closePath();
    ctx.fill();
  }
  if (fx >= AMBIENT_MAX_EFFECTS) return;
  // city-flicker вимкнено (кандидат А «нічний супутник»): вогні міст
  // намальовані на самій карті — рендер-хеш дублював би їх не на своїх місцях
}

// --- Рушій ambient-шару: гейти + тротлер + тумблер (ADR-0073 п.2–4) ---

export interface AmbientDeps {
  hasRaf(): boolean; // typeof-гейт (патерн hasRaf у main.ts): jsdom/стаб П6.16 — 0 кадрів
  schedule(cb: (now: number) => void): unknown; // браузер: requestAnimationFrame
  cancel(h: unknown): void; // браузер: cancelAnimationFrame
  now(): number; // wall-clock ефектів (браузер: performance.now)
  visible(): boolean; // гейт видимості: document.visibilityState === 'visible'
  repaint(): void; // перемальовка активної сцени (бій або геосцена) — вирішує викликач
  store?: AmbientStore; // тумблер: сховище поза сейвом (дефолт — localStorage)
}

export interface Ambient {
  enabled(): boolean;
  toggle(): boolean; // новий стан; персист + старт/стоп циклу без перезапуску
  start(): void; // партія активна: запустити цикл (гейти всередині; повторний виклик — no-op)
  pause(): void; // документ у фоні: зупинити планування (0 перерисовок)
  resume(): void; // документ знову видимий: поновити цикл, якщо увімкнено
  // Малювальники ефектів поверх чинного кадру (викликає рендер сцени):
  // гейти тумблера і typeof-rAF усередині — jsdom (стаб П6.16) — 0 викликів.
  paintBattle(ctx: CanvasRenderingContext2D, scene: AmbientBattleScene): void;
  paintGeo(ctx: CanvasRenderingContext2D, scene: AmbientGeoScene): void;
}

export function createAmbient(deps: AmbientDeps): Ambient {
  const store = deps.store ?? browserStore;
  // Помилки сховища — тихо (контракт audio.ts): читання → дефолт, запис — мовчки.
  const readState = (): string | null => {
    try {
      return store.read();
    } catch {
      return null;
    }
  };
  const writeState = (v: '1' | '0'): void => {
    try {
      store.write(v);
    } catch {
      /* тихо: у сесії тумблер працює, персист пропущено */
    }
  };
  let on = readState() !== '0'; // дефолт — увімкнено (ADR-0073 п.3)
  let handle: unknown = null; // активний rAF-хендл (null — цикл не планується)
  let lastFrame = -AMBIENT_FRAME_MS; // тротлер: час останнього репейнта

  // Кадр циклу: гейти спочатку (вимкнено/фоновий документ — цикл зупиняється,
  // 0 перерисовок — ADR-0029 як базовий режим), потім тротлер ≥ 100 мс.
  const frame = (now: number): void => {
    if (!on || !deps.visible()) {
      handle = null; // далі не плануємо; pause/resume або тумблер розбудять
      return;
    }
    if (now - lastFrame >= AMBIENT_FRAME_MS) {
      lastFrame = now;
      deps.repaint();
    }
    handle = deps.schedule(frame);
  };

  function start(): void {
    if (handle !== null || !on || !deps.hasRaf() || !deps.visible()) return;
    lastFrame = -AMBIENT_FRAME_MS; // перший кадр — одразу; далі тротлер тримає інтервал
    handle = deps.schedule(frame);
  }

  function pause(): void {
    if (handle === null) return;
    deps.cancel(handle);
    handle = null;
  }

  return {
    enabled: () => on,
    toggle: () => {
      on = !on;
      writeState(on ? '1' : '0');
      if (on) start();
      else pause(); // вимкнено — 0 перерисовок (ADR-0029)
      return on;
    },
    start,
    pause,
    resume: start, // видимість повернулася — ті самі гейти, що й старт
    // Гейти малювальників: вимкнений тумблер або середовище без rAF (jsdom,
    // стаб П6.16) — 0 Canvas-викликів; подієві кадри у браузері малюють
    // ambient тим самим t (без мерехтіння між циклами кадрів).
    paintBattle: (ctx, scene) => {
      if (!on || !deps.hasRaf()) return;
      paintBattleAmbient(ctx, scene, deps.now());
    },
    paintGeo: (ctx, scene) => {
      if (!on || !deps.hasRaf()) return;
      paintGeoAmbient(ctx, scene, deps.now());
    },
  };
}
