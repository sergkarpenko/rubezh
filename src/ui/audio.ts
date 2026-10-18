// П11.7 (ADR-0059): звуковий шар — WebAudio синтезом кодом: без аудіофайлів і
// залежностей (ADR-0012), суто відображення (ADR-0003): модуль не чіпає стан
// гри. Рецепти — детерміновані константи, шум — буфер з фіксованим LCG (жодного
// Math.random). AudioContext створюється ліниво при першому виклику звуку
// (autoplay policy: перший звук іде з жесту користувача — кліку); typeof-гейт
// як hasRaf (main.ts): jsdom (ADR-0013) і старі браузери без WebAudio — no-op
// без винятків (ADR-0063: headless-смок — нуль pageerror).

import type { GameEvent, ShotMode } from '../core/combat';
import type { GeoEvent } from '../core/geo';

// Набір звуків (ADR-0059): постріли трьох режимів (різні сигнатури), влучання,
// смерть, рух (крок), виявлення НЛО, результат місії (перемога/поразка), клік UI.
export type SoundName = 'click' | 'move' | 'shot-snap' | 'shot-aimed' | 'shot-auto' | 'hit' | 'death' | 'detect' | 'win' | 'lose';

// --- Мінімальні структурні інтерфейси WebAudio (для моків у тестах) ---

export interface SoundParam {
  value: number;
  setValueAtTime(v: number, t: number): void;
  exponentialRampToValueAtTime(v: number, t: number): void;
}

export interface SoundNode {
  connect(dest: unknown): unknown;
}

export interface SoundOsc extends SoundNode {
  type: string;
  frequency: SoundParam;
  start(t: number): void;
  stop(t: number): void;
}

export interface SoundGain extends SoundNode {
  gain: SoundParam;
}

export interface SoundBuffer {
  getChannelData(ch: number): Float32Array;
}

export interface SoundBufferSource extends SoundNode {
  buffer: unknown;
  start(t: number): void;
  stop(t: number): void;
}

export interface SoundContext {
  readonly currentTime: number;
  readonly sampleRate: number;
  readonly state: string; // 'running' | 'suspended' | ...
  readonly destination: unknown;
  resume(): Promise<void> | void;
  createOscillator(): SoundOsc;
  createGain(): SoundGain;
  createBuffer(channels: number, length: number, sampleRate: number): SoundBuffer;
  createBufferSource(): SoundBufferSource;
}

// --- Тумблер: localStorage ПОЗА сейвом (ADR-0059; ADR-0026 не зачіпається) ---

// Ключ стану тумблера: '1' — увімкнено, '0' — вимкнено; відсутній — дефолт
// «увімкнено» (рішення власника, сесія П11.7). Контракт «тихо» тримає фабрика:
// помилка читання/запису будь-якого адаптера — дефолт/мовчки пропущений персист
// (прецедент save-panel.ts; тумблер у сесії працює, без повідомлень у журнал).
// П12.3 (ADR-0065): формат розширювальний — ключі rubezh.settings.*; ключ
// топбара П11.7 rubezh.sound лишився фолбеком читання (вибір користувача
// мігрує без втрат), після першого запису прибирається (без дублікатів).
export const SOUND_KEY = 'rubezh.settings.sound';
const LEGACY_SOUND_KEY = 'rubezh.sound';

export interface SoundStore {
  read(): string | null;
  write(v: '1' | '0'): void;
}

const browserStore: SoundStore = {
  read: () => {
    const cur = localStorage.getItem(SOUND_KEY);
    return cur !== null ? cur : localStorage.getItem(LEGACY_SOUND_KEY); // фолбек-міграція
  },
  write: (v) => {
    localStorage.setItem(SOUND_KEY, v);
    try {
      localStorage.removeItem(LEGACY_SOUND_KEY); // мігрували — старий ключ не лишаємо
    } catch {
      /* тихо */
    }
  },
};

// typeof-гейт (патерн hasRaf, main.ts): без WebAudio — no-op, без винятків.
function browserContext(): SoundContext | null {
  const g = globalThis as { AudioContext?: unknown; webkitAudioContext?: unknown };
  const AC = g.AudioContext ?? g.webkitAudioContext;
  if (typeof AC !== 'function') return null;
  try {
    return new (AC as new () => SoundContext)();
  } catch {
    return null;
  }
}

// --- Чисті перетворювачі подій → звуки (юніт-тести без DOM і контексту) ---

const SHOT_SOUND: Record<ShotMode, SoundName> = { snap: 'shot-snap', aimed: 'shot-aimed', auto: 'shot-auto' };

// Постріл — звук режиму; влучання — додатковий «удар»; рух — «тупотіння»
// (серія кроків). Хід/дозор/лікування/граната — без звуку (скоуп ADR-0059).
export function battleSounds(e: GameEvent): SoundName[] {
  if (e.type === 'shot') return e.hit ? [SHOT_SOUND[e.mode], 'hit'] : [SHOT_SOUND[e.mode]];
  if (e.type === 'death') return ['death'];
  if (e.type === 'move') return ['move'];
  return [];
}

// Геосцена: виявлення НЛО і результат місії (події читає журнал — ADR-0006 не
// порушується: undetected-події (ufo_spawned/ufo_move) звуку не мають).
export function geoSounds(e: GeoEvent): SoundName[] {
  if (e.type === 'ufo_detected') return ['detect'];
  if (e.type === 'mission_won') return ['win'];
  if (e.type === 'mission_lost') return ['lose'];
  return [];
}

// --- Синтез (детерміновані параметри; ADR-0003 — без Math.random) ---

// Осцилятор з огинаючою гучності; from→to — експоненційне ковзання частоти.
function note(c: SoundContext, t0: number, type: string, from: number, to: number | undefined, dur: number, vol: number): void {
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t0);
  if (to !== undefined) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g);
  g.connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

// Шумовий буфер кешується на контекст; заповнення — фіксований LCG (той самий
// буфер байт-у-байт для того самого контексту).
const noiseByCtx = new WeakMap<object, SoundBuffer>();

function noiseBuffer(c: SoundContext): SoundBuffer {
  const cached = noiseByCtx.get(c as object);
  if (cached) return cached;
  const len = Math.floor(c.sampleRate * 0.25);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  let s = 0x2a2462; // фіксований стан LCG — детерміноване заповнення
  for (let i = 0; i < len; i++) {
    s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
    data[i] = ((s / 0x3fffffff) * 2 - 1) * 0.6;
  }
  noiseByCtx.set(c as object, buf);
  return buf;
}

function noise(c: SoundContext, t0: number, dur: number, vol: number): void {
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(g);
  g.connect(c.destination);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

// Рецепти звуків (ADR-0059): сигнатури режимів пострілу різні — короткий
// (щільний шумовий спалах + квадрат), прицільний (довгий свист вниз), черга
// (коротші нижчі кулі-імпульси; зсув кулі черги — у play, стакато-циклом).
function playRecipe(c: SoundContext, name: SoundName, t: number): void {
  switch (name) {
    case 'click':
      note(c, t, 'square', 660, 440, 0.05, 0.04);
      break;
    case 'move': // крок: короткий стук (подія move = одна клітинка шляху; серія
      // клітинок одного дрену звучить тупотінням — стакато-зсув у play)
      noise(c, t, 0.05, 0.07);
      note(c, t, 'triangle', 95, 65, 0.05, 0.05);
      break;
    case 'shot-snap':
      noise(c, t, 0.12, 0.18);
      note(c, t, 'square', 220, 90, 0.12, 0.1);
      break;
    case 'shot-aimed':
      note(c, t, 'sawtooth', 900, 240, 0.18, 0.08);
      break;
    case 'shot-auto':
      noise(c, t, 0.05, 0.16);
      note(c, t, 'square', 150, 80, 0.05, 0.09);
      break;
    case 'hit':
      note(c, t, 'triangle', 150, 55, 0.12, 0.16);
      break;
    case 'death':
      note(c, t, 'sawtooth', 300, 45, 0.35, 0.1);
      break;
    case 'detect': // дві висхідні ноти — «пінг» радара
      note(c, t, 'sine', 440, undefined, 0.09, 0.1);
      note(c, t + 0.1, 'sine', 660, undefined, 0.12, 0.1);
      break;
    case 'win': // трьохноття вгору
      note(c, t, 'triangle', 523.25, undefined, 0.14, 0.1);
      note(c, t + 0.12, 'triangle', 659.25, undefined, 0.14, 0.1);
      note(c, t + 0.24, 'triangle', 783.99, undefined, 0.18, 0.1);
      break;
    case 'lose': // дві ноти вниз
      note(c, t, 'sine', 392, undefined, 0.18, 0.1);
      note(c, t + 0.18, 'sine', 261.63, undefined, 0.24, 0.1);
      break;
  }
}

// --- Фабрика: тумблер, лінивий контекст, публічний API ---

export interface SoundDeps {
  makeContext(): SoundContext | null; // браузер: typeof-гейт; тести: мок
  store: SoundStore; // тумблер: localStorage поза сейвом (ADR-0026)
}

export interface Sound {
  play(name: SoundName): void; // точковий виклик (клік UI)
  battleEvent(e: GameEvent): void; // drain-контур журналу: події бою
  geoEvent(e: GeoEvent): void; // drain-контур журналу: геосцена
  enabled(): boolean;
  toggle(): boolean; // новий стан (персиститься у сховище)
}

export function createSound(deps: Partial<SoundDeps> = {}): Sound {
  const makeContext = deps.makeContext ?? browserContext;
  const store = deps.store ?? browserStore;
  // Помилки сховища — тихо: читання → null (дефолт «увімкнено»), запис — мовчки.
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
  let on = readState() !== '0'; // дефолт — увімкнено (ADR-0059)
  let ctx: SoundContext | null = null;
  let noApi = false; // WebAudio відсутній — далі не пробуємо (один гейт)
  // Черга (auto): три кулі атаки дренуються журналом одразу — без зсуву вони
  // зливаються в один імпульс. Кулі черги граються стакато-циклом 0/0.09/0.18с
  // («тр-р-р»). Детерміновано: зсув залежить лише від порядку викликів.
  let autoTap = 0;
  // Тупотіння (move): подія move — одна на клітинку шляху (combat.ts), усі
  // події ходу дренуються одним батчем з однаковим currentTime — без зсуву
  // кроки теж зливаються в один стук. Кроки серії зсуваються по 0.14с.
  let moveTap = 0;
  let moveAt = -1;

  function context(): SoundContext | null {
    if (ctx) return ctx;
    if (noApi) return null;
    const c = makeContext();
    if (!c) {
      noApi = true;
      return null;
    }
    ctx = c;
    return c;
  }

  function play(name: SoundName): void {
    if (!on) return;
    const c = context();
    if (!c) return;
    // autoplay policy: контекст з жесту вже «running»; підвислий — тихо будимо
    if (c.state === 'suspended') {
      try {
        void Promise.resolve(c.resume()).catch(() => {});
      } catch {
        /* тихо */
      }
    }
    // Черга — стакато-зсув кулі; кроки одного дрену — стакато-серія «тупотіння»
    // (подія move = одна клітинка шляху, усі події дрену мають той самий
    // currentTime; серія замикається новим дреном — новим currentTime).
    if (name === 'shot-auto') {
      playRecipe(c, name, c.currentTime + autoTap * 0.09);
      autoTap = (autoTap + 1) % 3; // три кулі черги — цикл починається знову
    } else if (name === 'move') {
      if (moveAt !== c.currentTime) {
        moveAt = c.currentTime;
        moveTap = 0; // нова серія кроків — новий хід
      }
      playRecipe(c, name, c.currentTime + moveTap * 0.14);
      moveTap = Math.min(moveTap + 1, 16); // кап довгих батчів (авто-бій)
    } else {
      playRecipe(c, name, c.currentTime);
    }
  }

  return {
    play,
    battleEvent: (e) => {
      for (const s of battleSounds(e)) play(s);
    },
    geoEvent: (e) => {
      for (const s of geoSounds(e)) play(s);
    },
    enabled: () => on,
    toggle: () => {
      on = !on;
      writeState(on ? '1' : '0');
      return on;
    },
  };
}
