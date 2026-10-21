// @vitest-environment jsdom
// П14.8 (ADR-0073): тести рушія ambient-шару. Гейти й бюджет: typeof-гейт rAF
// (0 кадрів без rAF — прецедент П6.16), гейт видимості документа (фон — 0
// перерисовок, ADR-0029 як базовий режим), тротлер ≤ 10 fps (інтервали ≥
// AMBIENT_FRAME_MS), тумблер rubezh.settings.ambient поза сейвом (ADR-0026,
// патерн звуку ADR-0059: дефолт увімк, помилки сховища — тихо). Детермінізм
// ефектів (ADR-0003): чисті функції прогресу — той самий t = та сама альфа,
// жодного Math.random. Еквівалентність логу (критерій П14.8) і малювальники
// ефектів — у секціях нижче (патерн audio-synth.test.ts).
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AMBIENT_FRAME_MS,
  AMBIENT_FPS_MAX,
  AMBIENT_KEY,
  AMBIENT_MAX_EFFECTS,
  cityFlickerAlpha,
  createAmbient,
  hpGlowAlpha,
  radarSweepAngle,
  wallPulseAlpha,
  type AmbientStore,
} from './ambient';

// --- Харнес: фейковий планувальник rAF + фейковий wall-clock ---

interface Harness {
  hasRaf(): boolean;
  schedule(cb: (now: number) => void): unknown;
  cancel(h: unknown): void;
  now(): number;
  visible(): boolean;
  repaint(): void;
  // керування фейковим планувальником (тільки у тестах)
  step(dt: number): void; // «кадр браузера»: t += dt, викликати запланований кадр
  scheduled(): number; // скільки разів планувальник отримав запит (rAF-виклики)
  cancelled(): number; // скільки разів хендл знімали
  pending(): boolean; // чи запланований наступний кадр
  repaints: number[]; // часові мітки репейнтів (t на момент кадру)
  setVisible(v: boolean): void;
}

function makeHarness(visible = true): Harness {
  let t = 0;
  let cb: ((now: number) => void) | null = null;
  let vis = visible;
  let scheduled = 0;
  let cancelled = 0;
  const repaints: number[] = [];
  return {
    hasRaf: () => true,
    schedule: (fn) => {
      scheduled++;
      cb = fn;
      return scheduled;
    },
    cancel: () => {
      cancelled++;
      cb = null;
    },
    now: () => t,
    visible: () => vis,
    repaint: () => {
      repaints.push(t);
    },
    step: (dt) => {
      t += dt;
      const f = cb;
      cb = null;
      if (f !== null) f(t); // кадр перепланувальний: цикл сам поставить наступний
    },
    scheduled: () => scheduled,
    cancelled: () => cancelled,
    pending: () => cb !== null,
    repaints,
    setVisible: (v) => {
      vis = v;
    },
  };
}

// Сховище в пам'яті (патерн audio.test.ts) — зламане кидає (контракт «тихо»).
function memStore(initial: string | null = null): AmbientStore {
  let v = initial;
  return {
    read: () => v,
    write: (x) => {
      v = x;
    },
  };
}

function boomStore(): AmbientStore {
  const boom = (): never => {
    throw new Error('storage blocked');
  };
  return { read: boom, write: boom };
}

beforeEach(() => {
  localStorage.clear();
});

describe('П14.8: тумблер rubezh.settings.ambient (ADR-0073 п.3, патерн ADR-0059)', () => {
  it('дефолт — увімкнено; ключ rubezh.settings.ambient поза сейвом', () => {
    const h = makeHarness();
    const amb = createAmbient({ ...h, store: memStore() });
    expect(amb.enabled()).toBe(true);
    amb.start();
    h.step(0);
    expect(h.repaints.length).toBe(1); // увімкнено — цикл малює
  });

  it('toggle: вимк → ключ «0», цикл зупиняється; увімк → «1», продовжує без перезапуску', () => {
    const h = makeHarness();
    const store = memStore();
    const amb = createAmbient({ ...h, store });
    amb.start();
    h.step(0);
    expect(amb.toggle()).toBe(false); // вимк
    expect(store.read()).toBe('0');
    expect(h.pending()).toBe(false); // планування знято
    const before = h.repaints.length;
    h.step(AMBIENT_FRAME_MS * 3);
    expect(h.repaints.length).toBe(before); // вимкнено — 0 репейнтів (ADR-0029)
    expect(amb.toggle()).toBe(true); // увімк — без перезапуску застосунку
    expect(store.read()).toBe('1');
    h.step(0);
    expect(h.repaints.length).toBe(before + 1);
  });

  it('мінуса сесія: «0» у сховищі — ambient вимкнено з початку', () => {
    const amb = createAmbient({ ...makeHarness(), store: memStore('0') });
    expect(amb.enabled()).toBe(false);
  });

  it('браузерне сховище: реальний localStorage jsdom (дефолтний store)', () => {
    localStorage.setItem(AMBIENT_KEY, '0');
    const amb1 = createAmbient(makeHarness());
    expect(amb1.enabled()).toBe(false);
    amb1.toggle(); // увімк — персист у реальний localStorage
    expect(localStorage.getItem(AMBIENT_KEY)).toBe('1');
    const amb2 = createAmbient(makeHarness()); // «нова сесія»
    expect(amb2.enabled()).toBe(true);
  });

  it('зламане сховище — тихо: тумблер у сесії працює, винятків нема', () => {
    const h = makeHarness();
    const amb = createAmbient({ ...h, store: boomStore() });
    expect(() => amb.toggle()).not.toThrow();
    expect(amb.enabled()).toBe(false); // у сесії перемкнувся
    expect(() => amb.toggle()).not.toThrow();
    expect(amb.enabled()).toBe(true);
    amb.start();
    h.step(0);
    expect(h.repaints.length).toBe(1); // цикл не залежить від персисту
  });
});

describe('П14.8: typeof-гейт rAF — 0 кадрів без requestAnimationFrame (П6.16)', () => {
  it('hasRaf=false: start не планує жодного кадру, тумблер не будить', () => {
    const h = makeHarness();
    const amb = createAmbient({ ...h, hasRaf: () => false, store: memStore() });
    amb.start();
    expect(h.scheduled()).toBe(0); // 0 rAF
    expect(h.repaints.length).toBe(0); // 0 перерисовок
    amb.toggle(); // вимк/увімк — все одно 0 кадрів
    amb.toggle();
    amb.start();
    expect(h.scheduled()).toBe(0);
  });

  it('hasRaf=false: зміна тумблера не кидає (гейт першим)', () => {
    const amb = createAmbient({ ...makeHarness(), hasRaf: () => false, store: boomStore() });
    expect(() => {
      amb.start();
      amb.toggle();
    }).not.toThrow();
  });
});

describe('П14.8: тротлер ≤ 10 fps (ADR-0073 п.4)', () => {
  it('кадри браузера 60 Гц — репейнти не частіші за AMBIENT_FRAME_MS (≤ 10/с)', () => {
    const h = makeHarness();
    createAmbient({ ...h, store: memStore() }).start();
    const total = 1600; // 1.6 с «трого» у 16-мс кадрах
    for (let t = 0; t < total; t += 16) h.step(16);
    // інтервали між репейнтами — не менші за бюджет (частота ≤ AMBIENT_FPS_MAX)
    for (let i = 1; i < h.repaints.length; i++) {
      expect(h.repaints[i]! - h.repaints[i - 1]!).toBeGreaterThanOrEqual(AMBIENT_FRAME_MS);
    }
    // кількість — у межах бюджету на прогін (перший кадр — одразу, далі тротлер)
    expect(h.repaints.length).toBeLessThanOrEqual(Math.floor(total / AMBIENT_FRAME_MS) + 1);
    expect(AMBIENT_FRAME_MS).toBe(Math.ceil(1000 / AMBIENT_FPS_MAX)); // 100 мс — бюджет ADR-0073
    expect(h.repaints.length).toBeGreaterThan(0); // цикл реально малював
  });

  it('перший репейнт — одразу, наступний — не раніше 100 мс', () => {
    const h = makeHarness();
    createAmbient({ ...h, store: memStore() }).start();
    h.step(0);
    expect(h.repaints).toEqual([0]);
    h.step(99); // 99 < 100 — тротлер пропускає
    expect(h.repaints).toEqual([0]);
    h.step(1); // 100 ≥ 100 — репейнт
    expect(h.repaints).toEqual([0, 100]);
  });
});

describe('П14.8: гейт видимості документа (ADR-0073 п.2; фон — 0 перерисовок)', () => {
  it('документ прихований на старті — цикл не запускається', () => {
    const h = makeHarness(false);
    createAmbient({ ...h, store: memStore() }).start();
    expect(h.scheduled()).toBe(0);
    expect(h.repaints.length).toBe(0);
  });

  it('документ пішов у фон під час циклу — кадр зупиняє планування', () => {
    const h = makeHarness();
    const amb = createAmbient({ ...h, store: memStore() });
    amb.start();
    h.step(0);
    expect(h.repaints.length).toBe(1);
    h.setVisible(false); // visibilitychange → фон
    h.step(AMBIENT_FRAME_MS);
    expect(h.pending()).toBe(false); // далі не планується
    const before = h.repaints.length;
    h.step(AMBIENT_FRAME_MS * 5); // у фоні кадри «були» б — репейнтів 0
    expect(h.repaints.length).toBe(before);
  });

  it('pause/resume: pause знімає планування, resume поновлює (якщо увімкнено)', () => {
    const h = makeHarness();
    const amb = createAmbient({ ...h, store: memStore() });
    amb.start();
    h.step(0);
    amb.pause(); // visibilitychange → pause
    expect(h.pending()).toBe(false);
    expect(h.cancelled()).toBe(1);
    amb.resume(); // видимість повернулася
    expect(h.pending()).toBe(true);
    h.step(AMBIENT_FRAME_MS);
    expect(h.repaints.length).toBe(2);
  });

  it('pause без активного циклу — no-op; старт повторний — один планувальник', () => {
    const h = makeHarness();
    const amb = createAmbient({ ...h, store: memStore() });
    amb.pause();
    expect(h.cancelled()).toBe(0);
    amb.start();
    amb.start(); // idempotent
    expect(h.scheduled()).toBe(1);
    amb.pause();
    amb.pause();
    expect(h.cancelled()).toBe(1);
  });
});

describe('П14.8: детермінізм ефектів — чисті функції від t (ADR-0003)', () => {
  it('wallPulseAlpha: той самий t — та сама альфа; періодична; у межах [0.10, 0.24]', () => {
    for (const t of [0, 123, 4000, 12345.678]) {
      expect(wallPulseAlpha(t)).toBe(wallPulseAlpha(t));
      expect(wallPulseAlpha(t)).toBeCloseTo(wallPulseAlpha(t + 4000), 10); // період
    }
    for (let t = 0; t < 4000; t += 37) {
      const a = wallPulseAlpha(t);
      expect(a).toBeGreaterThanOrEqual(0.1);
      expect(a).toBeLessThanOrEqual(0.24); // легкий подих — без деренчання
    }
  });

  it('hpGlowAlpha: періодична, у межах [0.25, 0.55]', () => {
    for (let t = 0; t < 1000; t += 13) {
      const a = hpGlowAlpha(t);
      expect(a).toBeGreaterThanOrEqual(0.25);
      expect(a).toBeLessThanOrEqual(0.55);
      expect(hpGlowAlpha(t)).toBe(hpGlowAlpha(t + 1000));
    }
  });

  it('radarSweepAngle: повний оберт за період; той самий t — той самий кут', () => {
    expect(radarSweepAngle(0)).toBeCloseTo(-Math.PI / 2, 10); // старт — вгору (прецедент gscan)
    expect(radarSweepAngle(3000)).toBeCloseTo(-Math.PI / 2 + Math.PI, 10); // пів періоду — пів-оберт
    expect(radarSweepAngle(6000)).toBeCloseTo(radarSweepAngle(0), 10); // період — оберт замкнувся
    expect(radarSweepAngle(1234)).toBe(radarSweepAngle(1234));
    expect(radarSweepAngle(1234)).toBeLessThan(radarSweepAngle(1300)); // монотонний рух
  });

  it('cityFlickerAlpha: той самий (x,y,t) — та сама альфа; поріг за cellHash', () => {
    expect(cityFlickerAlpha(3, 5, 700)).toBe(cityFlickerAlpha(3, 5, 700));
    let dense = 0;
    let sparse = 0;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 16; x++) {
        let any = 0;
        for (let t = 0; t < 2600; t += 100) any = Math.max(any, cityFlickerAlpha(x, y, t));
        if (any > 0) dense++;
        else sparse++;
      }
    }
    expect(dense).toBeGreaterThan(0); // кандидати мерехтять
    expect(sparse).toBeGreaterThan(dense); // більшість клітинок — поза порогом (рідкість)
  });

  it('негативний wall-clock не ламає прогрес (фаза нормована)', () => {
    expect(wallPulseAlpha(-500)).toBe(wallPulseAlpha(-500 + 4000));
    expect(cityFlickerAlpha(1, 2, -100)).toBe(cityFlickerAlpha(1, 2, -100 + 2600));
  });
});

describe('П14.8: бюджет — константи шару відображення (ADR-0073 п.4–5)', () => {
  it('ліміт ефектів і частота — сталі, перелік фіксовано П14.8', () => {
    expect(AMBIENT_MAX_EFFECTS).toBe(4); // wall-pulse, radar-sweep, city-flicker, hp-glow
    expect(AMBIENT_FPS_MAX).toBe(10); // ≤ 10 fps — бюджет ambient-шару
  });
});
