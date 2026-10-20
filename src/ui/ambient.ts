// П14.8 (ADR-0073): обмежені ambient-анімації — «жива» картинка як уточнення
// правила idle → 0 перерисовок (ADR-0029): базовий режим лишається чинним —
// вимкнений тумблер або фоновий документ = 0 перерисовок. Ambient — суто шар
// відображення (ADR-0002/0037): стан ядра, лог і rng не чіпаються, подій
// логу не породжує (критерій П14.8: лог партії байт-у-байт однаковий з
// ambient і без). Детермінізм (ADR-0003): ефекти — чисті функції від
// wall-clock (performance.now) і позицій, жодного Math.random/geo.rng
// (поріг мерехтіння — патерн cellHash П14.4). Бюджет (ADR-0073 п.4):
// тротлер ≤ 10 fps, одночасних ефектів — не більше AMBIENT_MAX_EFFECTS
// (стала шару відображення). Фіксований перелік ефектів затверджено П14.8
// (ADR-0073 п.5); нові постійні цикли — лише через новий ADR:
//   wall-pulse   — пульсація ціанових кантів стін бою (повільна синусоїда);
//   radar-sweep  — безперервне повільне обертання радар-сектора геосцени
//                  у стані спокою (розвиток gscan П14.5);
//   city-flicker — легке мерехтіння вогнів міст (поріг за cellHash);
//   hp-glow      — легке підсвічування HP-бейджів (П14.4) при частці
//                  hp/maxHp < AMBIENT_HP_FRACTION.
// Стартовий екран не анімується (П14.7: 0 нових анімацій лишається чинним).
// Тумблер — патерн звуку (ADR-0059; персист поза сейвом ADR-0026): ключ
// rubezh.settings.ambient у локальному сховищі, дефолт — увімкнено;
// зміна тумблера — без перезапуску застосунку.

import { cellHash } from '../core/render-core';

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
const CITY_FLICKER_MS = 2600; // city-flicker: період мерехтіння вогню
const CITY_FLICKER_SPARSE = 8; // city-flicker: поріг cellHash % 8 — рідкі кандидати

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

// city-flicker: альфа мерехтіння вогню міста у клітинці (0 — клітинка не
// мерехтить). Кандидати — рідкі за cellHash (детерміновано, без RNG);
// фаза мерехтіння зсунута хешем клітинки (вогні не блимають синхронно).
export function cityFlickerAlpha(x: number, y: number, t: number): number {
  const h = cellHash(x, y);
  if (h % CITY_FLICKER_SPARSE !== 0) return 0;
  const local = phase(t + (h % CITY_FLICKER_MS), CITY_FLICKER_MS);
  return 0.35 * Math.max(0, Math.sin((2 * Math.PI * local) / CITY_FLICKER_MS));
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
  };
}
