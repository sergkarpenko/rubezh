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
  AMBIENT_HP_FRACTION,
  AMBIENT_KEY,
  AMBIENT_MAX_EFFECTS,
  cityFlickerAlpha,
  createAmbient,
  hpGlowAlpha,
  paintBattleAmbient,
  paintGeoAmbient,
  radarSweepAngle,
  wallPulseAlpha,
  type AmbientStore,
  type AmbientUnitView,
} from './ambient';
import { createGame, endTurn, makeUnit, moveUnit, mulberry32, resolveAttack, type GameState, type StatefulRng } from '../core/combat';
import { advanceTime } from '../core/geo';
import { createParty, serializeParty } from '../core/save';

// --- Мок-контекст малювання: журнал Canvas-викликів (патерн П6.14) ---

function mockCtx(): { ctx: CanvasRenderingContext2D; ops: string[] } {
  const ops: string[] = [];
  const ctx = new Proxy(
    {},
    {
      get:
        (_t, p) =>
        (...args: unknown[]) => {
          ops.push(String(p) + '(' + args.map(String).join(',') + ')');
          return undefined;
        },
      set: (_t, p, v) => {
        ops.push('set:' + String(p) + '=' + String(v));
        return true;
      },
    }
  );
  return { ctx: ctx as unknown as CanvasRenderingContext2D, ops };
}

// Клітинка сцени бою (стіна/підлога).
const cell = (x: number, y: number, blocked = false): { x: number; y: number; blocked: boolean; visible: boolean } => ({
  x,
  y,
  blocked,
  visible: true,
});

const unit = (x: number, y: number, hp: number, maxHp: number): AmbientUnitView => ({ at: { x, y }, hp, maxHp });

const battleScene = (cells: readonly { x: number; y: number; blocked: boolean }[], units: readonly AmbientUnitView[]) => ({
  cell: 48,
  cw: 960,
  ch: 960,
  cells: cells.map((c) => ({ ...c, visible: true })),
  units,
});

const geoScene = (seed: number, base: { x: number; y: number }) => ({
  cell: 48,
  cw: 768,
  ch: 384,
  seed,
  base,
});

// Поранений бій (сцена з пораненими обох сторін) для тестів hp-glow.
const wounded = (): AmbientUnitView[] => [
  unit(2, 2, 1, 10), // 0.1 < 0.35 — світиться
  unit(3, 2, 3, 10), // 0.3 < 0.35 — світиться
  unit(4, 2, 4, 10), // 0.4 — ні
  unit(5, 2, 10, 10), // повний — ні
];

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

describe('П14.8: малювальник бою — wall-pulse + hp-glow (перелік П14.8)', () => {
  it('стіни: пульс ціанового канту — strokeRect на кожній стіні у межах клітинки', () => {
    const { ctx, ops } = mockCtx();
    paintBattleAmbient(ctx, battleScene([cell(0, 0, true), cell(1, 0, true), cell(2, 0, false)], []), 0);
    const frames = ops.filter((o) => o.startsWith('strokeRect'));
    expect(frames).toEqual(['strokeRect(1.5,1.5,45,45)', 'strokeRect(49.5,1.5,45,45)']);
    expect(ops.some((o) => o === 'set:strokeStyle=rgba(0,229,255,' + wallPulseAlpha(0).toFixed(3) + ')')).toBe(true);
  });

  it('без стін і без поранених — 0 Canvas-викликів (здоровий бій не підсвічений)', () => {
    const { ctx, ops } = mockCtx();
    paintBattleAmbient(ctx, battleScene([cell(0, 0)], [unit(1, 1, 10, 10)]), 500);
    expect(ops).toEqual([]);
  });

  it('hp-glow: лише hp/maxHp < 0.35; геометрія бейджа — смуга HP зверху клітинки', () => {
    const { ctx, ops } = mockCtx();
    paintBattleAmbient(ctx, battleScene([cell(0, 0)], wounded()), 700);
    const glows = ops.filter((o) => o.startsWith('fillRect'));
    expect(glows).toEqual(['fillRect(96,97,48,4)', 'fillRect(144,97,48,4)']); // x*48, y*48+1 (HP_BAR_*)
    expect(ops.some((o) => o.startsWith('set:fillStyle=rgba(255,92,122,'))).toBe(true);
    expect(AMBIENT_HP_FRACTION).toBe(0.35); // поріг підсвічування — стала шару
  });

  it('детермінізм від t: той самий t — той самий потік Canvas-викликів', () => {
    const scene = battleScene([cell(0, 0, true)], wounded());
    const a = mockCtx();
    const b = mockCtx();
    paintBattleAmbient(a.ctx, scene, 1234);
    paintBattleAmbient(b.ctx, scene, 1234);
    expect(a.ops).toEqual(b.ops);
    const c = mockCtx();
    paintBattleAmbient(c.ctx, scene, 1234 + 2000); // інша фаза — інша альфа
    expect(c.ops).not.toEqual(a.ops);
  });

  it('ліміт одночасних ефектів: 10 поранених + стіни — не більше AMBIENT_MAX_EFFECTS', () => {
    const { ctx, ops } = mockCtx();
    const many = Array.from({ length: 10 }, (_, i) => unit(i, 2, 1, 10));
    paintBattleAmbient(ctx, battleScene([cell(0, 0, true)], many), 0);
    const wall = ops.filter((o) => o.startsWith('strokeRect')).length; // 1 ефект wall-pulse
    const glows = ops.filter((o) => o.startsWith('fillRect')).length; // решта бюджету — hp-glow
    expect(wall).toBe(1);
    expect(wall + glows).toBe(AMBIENT_MAX_EFFECTS); // бюджет кадра вичерпано
    expect(glows).toBe(3); // перші три юніта в порядку сцени — детерміновано
  });

  it('без стін: бюджет дозволяє AMBIENT_MAX_EFFECTS підсвічувань', () => {
    const { ctx, ops } = mockCtx();
    const many = Array.from({ length: 10 }, (_, i) => unit(i, 2, 1, 10));
    paintBattleAmbient(ctx, battleScene([cell(0, 0)], many), 0);
    expect(ops.filter((o) => o.startsWith('fillRect')).length).toBe(AMBIENT_MAX_EFFECTS);
  });

  it('поранений з maxHp=0 — не світиться (захист від ділення)', () => {
    const { ctx, ops } = mockCtx();
    paintBattleAmbient(ctx, battleScene([cell(0, 0)], [unit(1, 1, 0, 0)]), 0);
    expect(ops).toEqual([]);
  });
});

describe('П14.8: малювальник геосцени — radar-sweep + city-flicker', () => {
  it('розгортка: промінь + слід сектора від бази; кут — від t (детерміновано)', () => {
    const { ctx, ops } = mockCtx();
    paintGeoAmbient(ctx, geoScene(42, { x: 8, y: 4 }), 1000);
    expect(ops).toContain('moveTo(408,216)');
    expect(ops.filter((o) => o.startsWith('lineTo')).length).toBe(1); // передній край
    expect(ops.filter((o) => o.startsWith('arc')).length).toBe(1); // слід сектора
    const other = mockCtx();
    paintGeoAmbient(other.ctx, geoScene(42, { x: 8, y: 4 }), 1000 + 3000); // пів періоду — інший кут
    expect(other.ops.filter((o) => o.startsWith('lineTo'))).not.toEqual(ops.filter((o) => o.startsWith('lineTo')));
  });

  it('мерехтіння міст: вогники лише на клітинках вогнів з альфою > 0; ліміт кадру', () => {
    // сцена з вогнями: сід/база як у реальній партії; t підбираємо з мерехтінням
    let t = -1;
    let flickers: string[] = [];
    for (let probe = 0; probe < 2600 && flickers.length === 0; probe += 20) {
      const m = mockCtx();
      paintGeoAmbient(m.ctx, geoScene(42, { x: 8, y: 4 }), probe);
      flickers = m.ops.filter((o) => o.startsWith('fillRect'));
      if (flickers.length > 0) t = probe;
    }
    expect(t).toBeGreaterThanOrEqual(0); // мерехтіння існує на розкладі вогнів
    const m = mockCtx();
    paintGeoAmbient(m.ctx, geoScene(42, { x: 8, y: 4 }), t);
    const all = m.ops.filter((o) => o.startsWith('fillRect'));
    expect(all.length).toBeGreaterThan(0);
    expect(all.length).toBeLessThanOrEqual(AMBIENT_MAX_EFFECTS - 1); // розгортка вже зайняла 1
    expect(m.ops.some((o) => o.startsWith('set:fillStyle=rgba(255,207,92,'))).toBe(true); // теплий вогник
  });

  it('детермінізм від t: той самий (t, сцена) — той самий потік викликів', () => {
    const a = mockCtx();
    const b = mockCtx();
    paintGeoAmbient(a.ctx, geoScene(42, { x: 8, y: 4 }), 777);
    paintGeoAmbient(b.ctx, geoScene(42, { x: 8, y: 4 }), 777);
    expect(a.ops).toEqual(b.ops);
  });
});

describe('П14.8: facade-методи малювання — гейти тумблера і rAF', () => {
  it('увімкнено + rAF: малює за now() рушія; вимкнено або без rAF — 0 викликів', () => {
    const h = makeHarness();
    const amb = createAmbient({ ...h, store: memStore() });
    const { ctx, ops } = mockCtx();
    amb.paintBattle(ctx, battleScene([cell(0, 0, true)], wounded())); // t = now() = 0
    expect(ops.length).toBeGreaterThan(0);
    const off = mockCtx();
    amb.toggle(); // вимк
    amb.paintBattle(off.ctx, battleScene([cell(0, 0, true)], wounded()));
    amb.paintGeo(off.ctx, geoScene(42, { x: 8, y: 4 }));
    expect(off.ops).toEqual([]); // вимкнений тумблер — 0 Canvas-викликів
    amb.toggle(); // увімк
    const noRaf = createAmbient({ ...makeHarness(), hasRaf: () => false, store: memStore() });
    const jsdom = mockCtx();
    noRaf.paintBattle(jsdom.ctx, battleScene([cell(0, 0, true)], wounded())); // jsdom: стаб П6.16
    noRaf.paintGeo(jsdom.ctx, geoScene(42, { x: 8, y: 4 }));
    expect(jsdom.ops).toEqual([]); // typeof-гейт — 0 викликів
  });
});

// --- Критерій П14.8: ambient не міняє партію (байт-у-байт, патерн П11.7) ---

// Скриптований бій (сід 42, детерміновано): рух + постріли обох сторін.
function battleGame(): GameState {
  const g = createGame({
    map: { width: 20, height: 20, blocked: new Set<string>() },
    rng: mulberry32(42),
    units: [
      makeUnit({ id: 's1', side: 'player', name: 'Гарт', pos: { x: 2, y: 2 } }),
      makeUnit({ id: 's2', side: 'player', name: 'Ліс', pos: { x: 3, y: 2 } }),
      makeUnit({ id: 'a1', side: 'alien', name: 'Морок', pos: { x: 8, y: 2 }, hp: 10, maxHp: 10 }),
      makeUnit({ id: 'a2', side: 'alien', name: 'Ірж', pos: { x: 8, y: 3 }, hp: 10, maxHp: 10 }),
    ],
  });
  moveUnit(g, 's1', [{ x: 2, y: 3 }]);
  resolveAttack(g, 's1', 'a1', 'auto');
  resolveAttack(g, 's1', 'a2', 'snap');
  endTurn(g);
  resolveAttack(g, 'a1', 's1', 'aimed');
  return g;
}

describe('П14.8 критерій: лог партії байт-у-байт однаковий з ambient і без', () => {
  it('бой: кадри ambient поверх логу дій — лог бою і rng.state не змінюються', () => {
    const h = makeHarness();
    const amb = createAmbient({ ...h, store: memStore() });
    const g = battleGame();
    const before = JSON.stringify(g.log) + '|' + (g.rng as StatefulRng).state;
    // «граємо з ambient»: кадри малювання між діями ядра (сцена з пораненими)
    const m = mockCtx();
    for (let i = 0; i < 5; i++) {
      h.step(AMBIENT_FRAME_MS); // цикл репейнтить (repaint — мок)
      amb.paintBattle(
        m.ctx,
        battleScene(
          [cell(0, 0, true)],
          g.units.map((u) => unit(u.pos.x, u.pos.y, u.hp, u.maxHp))
        )
      );
      expect(m.ops.length).toBeGreaterThan(0); // ambient реально малював
    }
    expect(JSON.stringify(g.log) + '|' + (g.rng as StatefulRng).state).toBe(before);
    // той самий бій без ambient — той самий лог і стан rng (байт-у-байт)
    const g2 = battleGame();
    expect(JSON.stringify(g2.log) + '|' + (g2.rng as StatefulRng).state).toBe(before);
  });

  it('партія: доба тіків із запущеним ambient-циклом — serializeParty байт-у-байт той самий', () => {
    // «з ambient»: цикл тікає і малює між тіками геосцени (repaint → paintGeo)
    const h = makeHarness();
    const amb = createAmbient({ ...h, store: memStore() });
    amb.start();
    const m = mockCtx();
    const p1 = createParty(42);
    for (let i = 0; i < 48; i++) {
      advanceTime(p1.geo, 1);
      h.step(AMBIENT_FRAME_MS); // репейнт циклу (repaint — мок) + кадр малювання
      amb.paintGeo(m.ctx, geoScene(p1.seed, p1.geo.base));
    }
    expect(m.ops.length).toBeGreaterThan(0); // ambient реально малював
    // «без ambient»: та сама послідовність тіків
    const p2 = createParty(42);
    for (let i = 0; i < 48; i++) advanceTime(p2.geo, 1);
    expect(serializeParty(p1)).toBe(serializeParty(p2)); // сейв-контракт (ADR-0026) не зачіпається
  });
});
