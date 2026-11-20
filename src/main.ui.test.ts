// @vitest-environment jsdom
/// <reference types="vite/client" />
// src/main.ui.test.ts
// П7 (переробка, ADR-0013): DOM-тести UI-шару main.ts через jsdom.
// Розмітку беремо з реального index.html (без дублювання — дрейф розмітки
// ловиться тестом). Канва — no-op заглушка: jsdom без нативного canvas не
// рендерить 2D, а main.ts при null-контексті рано виходить з renderGeo/
// renderBattle і не оновлює DOM поруч із канвою; заглушка тримає кнопки/тексти
// живими. Малювання далі валідується візуально (прев'ю).
// П6.2 (ADR-0027): тести каркаса — топбар (чипи балансу/боєготових),
// фокусна зона (гео/бій), журнал з фільтрами-вкладками.
// П6.3 (ADR-0027): бойова фокусна зона — контекст-стрічка бою, керування
// під бойовищем, приглушена колонка стану в бою, збереження лише на геосцені.
// П6.4 (ADR-0027): керування — гарячі клавіші 1/2/3/O/E/Esc (поля вводу
// ігнорують) і тач-патерн «тап — прев'ю — повторний тап у ту саму
// клітинку — хід» (мишка — той самий патерн, click).
// П13.3 (ADR-0067): авто-бій — покрокове відтворення; фейк-таймери прокручують паузи
// між діями ботів, поки бій не дійде до результату (банер у #bresult).

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
// index.html — через ?raw-імпорт (vitest/vite): без node:fs і process.cwd(), тож
// @types/node не потрібен (ADR-0012 — нових залежностей немає; tsconfig.json не чіпаємо).
import htmlRaw from '../index.html?raw';
// П12.5 (ADR-0065): числа тверджень — з констант каталогів ядра (одне місце
// правди), не дублі руками.
import { ARMOR_MAX_HP_BONUS, OPTICS_ACCURACY_BONUS } from './core/workshop';
import { GRENADE_DAMAGE, HEAL_AMOUNT, HIT_CHANCE_CAP } from './core/combat';
import { GUN_MODULE_DAMAGE } from './core/intercept';
import { AnimEngine } from './core/render-core';

const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const btn = (id: string): HTMLButtonElement => $(id) as HTMLButtonElement;

// П13.3 (ADR-0067): авто-бій — покрокове відтворення; фейк-таймери прокручують
// паузи між діями політика-ядра-за-гравця, поки бій не дійде до результату
// (btn-auto-battle disabled у renderBattle після finishBattle).
// Флоу «Авто → Стоп → ручна дія → Авто» — критерій 1 П13.3.
// Т.73: jsdom ставить focus() у чергу через setImmediate, а також setInterval рендерингу
// (Window._requestFocusFixup) — їх не підробляємо, щоб лічильник таймерів
// (vi.getTimerCount) рахував лише таймери гри (авто-бій, підсумок ходу), а не фокус у вікнах поверх бою.
const PAGE_FAKE_TIMERS = {
  toNotFake: ['setImmediate', 'clearImmediate', 'setInterval', 'clearInterval'],
} as Parameters<typeof vi.useFakeTimers>[0];
const AUTO_STEP_MS = 200;
async function runAutoSteps(): Promise<void> {
  for (let i = 0; i < 6000 && !btn('btn-auto-battle').disabled; i++) {
    await vi.advanceTimersByTimeAsync(AUTO_STEP_MS);
  }
}
async function runAutoBattle(): Promise<void> {
  vi.useFakeTimers(PAGE_FAKE_TIMERS);
  try {
    btn('btn-auto-battle').click();
    await runAutoSteps();
  } finally {
    vi.useRealTimers();
  }
}

// П12.2 (ADR-0065): хелпер запуску партії через новий флоу — стартовий екран →
// діалог нової партії (інпути сіду/пресету мігрували з топбара в діалог).
// Заміняє прямий старт btn-new: ті самі сід/складність, твердження-контракти
// флоу не послаблює.
// Т.43: «+1 доба» тепер зупиняється на виявленні й приземленні зонда, тож
// «минула рівно доба» в тестах — 48 кліків «+1 тік» (той самий стан, що давав
// один клік «+1 доба» до Т.43); твердження тестів не змінено.
function passDay(): void {
  for (let i = 0; i < 48; i++) btn('btn-tick').click();
}

// Т.73: під вікном «Як грати» першого візиту бій не відповідає на плитки й клавіші — гравець спершу закриває
// його «Грати» (мишею кнопку «Нова партія» під вікном не натиснути); так само й тут.
function startParty(seed = '42', preset = 'норма'): void {
  if (!$('help-screen').classList.contains('hidden')) btn('btn-help-close').click();
  btn('btn-start-new').click();
  ($('new-game-seed') as HTMLInputElement).value = seed;
  ($('new-game-preset') as HTMLSelectElement).value = preset;
  btn('btn-new-game-start').click();
}

// П6.14: журнал операцій малювання no-op контексту (fillText/strokeRect/...) —
// рамки валідних цілей і плашки шансу assertions робимо по ньому.
const canvasOps: string[] = [];

// jsdom у цьому середовищі не створює Storage (window.localStorage — undefined),
// тому ставимо in-memory заміну ДО імпорту main.ts: ADR-0026 — тести на моках
// сховища; «недоступне сховище» (приватний режим) — окрема гілка main.ts.
class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length(): number {
    return this.data.size;
  }
  clear(): void {
    this.data.clear();
  }
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  setItem(key: string, value: string): void {
    this.data.set(key, String(value));
  }
}
const memoryStorage = new MemoryStorage();
Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage, configurable: true });
Object.defineProperty(window, 'localStorage', { value: memoryStorage, configurable: true });

beforeAll(async () => {
  // П6.16: jsdom надає requestAnimationFrame — у цьому середовищі він
  // недетермінований, тому стабимо його як відсутній ДО імпорту main.ts:
  // main.ts при імпорті зафіксує hasRaf = false (той самий патерн П6.8 —
  // «без rAF анімації не ставляться у чергу»), і покроковий авто-бій крокує
  // лише таймерами пауз (фейк-таймери у runAutoBattle). rAF-гілку рушія
  // (onIdle → пауза) покриває render.test.ts на фейковому планувальнику.
  vi.stubGlobal('requestAnimationFrame', undefined);
  vi.stubGlobal('cancelAnimationFrame', undefined);
  // Реальна розмітка: body з index.html (script через innerHTML не виконується).
  document.body.innerHTML = htmlRaw.match(/<body[^>]*>([\s\S]*)<\/body>/)![1];

  // No-op контекст малювання (П6.14: з журналом операцій — рамки цілей і
  // плашки шансу перевіряються рядком «метод(аргументи)»): усі виклики —
  // порожні, присвоєння властивостей — так.
  const noopCtx = new Proxy(
    {},
    {
      get:
        (_t, p) =>
        (...args: unknown[]) => {
          canvasOps.push(String(p) + '(' + args.map((a) => String(a)).join(',') + ')');
          return undefined;
        },
      set: (_t, p, v) => {
        canvasOps.push('set:' + String(p) + '=' + String(v));
        return true;
      },
    }
  ) as unknown as CanvasRenderingContext2D;
  const proto = HTMLCanvasElement.prototype as unknown as {
    getContext: () => CanvasRenderingContext2D;
    getBoundingClientRect: (this: HTMLCanvasElement) => DOMRect;
  };
  proto.getContext = () => noopCtx;
  // Клік-математика: канва розтягнута на 1:1, клітинка = width/20 (BCELL).
  proto.getBoundingClientRect = function (this: HTMLCanvasElement): DOMRect {
    return {
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      width: this.width,
      height: this.height,
      right: this.width,
      bottom: this.height,
      toJSON: () => '',
    } as DOMRect;
  };

  // Імпортуємо main.ts ПІСЛЯ розмітки: на рівні модуля він прив'язує обробники
  // (за typeof document) і робить перший renderAll.
  await import('./main');
});

// П12.2 (ADR-0065): критичний флоу екранів — «старт → нова партія → меню →
// стартовий екран → продовжити». Детермінізм: сід 42; сейв/завантаження через
// реальну панель (ADR-0026); переходи — без rAF-анімацій, 0 перерисовок
// канви (ADR-0029). Стартовий стан (порожні слоти, «Як грати» першого візиту)
// — лише тут: describe виконується першим у файлі.
describe('П12.2: флоу стартового екрана і навігації (ADR-0065, ADR-0013)', () => {
  it('стартовий екран: логотип, меню, версія; партії немає; «Продовжити» вимкнено без сейвів', () => {
    // перший візит (П9.1): «Як грати» показано поверх стартового екрана
    expect($('help-screen').classList.contains('hidden')).toBe(false);
    btn('btn-help-close').click();
    // ADR-0065: сторінка → стартовий екран; каркас гри приховано
    expect($('start-screen').classList.contains('hidden')).toBe(false);
    expect($('topbar').classList.contains('hidden')).toBe(true);
    expect($('layout').classList.contains('hidden')).toBe(true);
    expect($('start-logo').textContent).toBe('РУБІЖ');
    expect((document.querySelector('.start-version') as HTMLElement).textContent).toContain('Версія'); // ADR-0054
    // партію не створено: панелі топбара/колонки не відрендерені (idle → 0 перерисовок)
    expect($('money').textContent).toBe('—');
    expect($('clock').textContent).toBe('—');
    btn('btn-tick').click(); // кнопки гра-шару без партії — no-op
    expect($('clock').textContent).toBe('—');
    // EARS Фази 12: без сейвів «Продовжити» недоступний з причиною
    expect(btn('btn-start-continue').disabled).toBe(true);
    expect(btn('btn-start-continue').title).toBe('Немає збережених партій');
    // П12.3 (ADR-0065/0059): тумблер звуку мігрував з топбара у вікно
    // «Налаштування» — зі стартового екрана
    expect(document.getElementById('btn-sound')).toBeNull(); // топбар більше не тримає тумблер
    btn('btn-start-settings').click();
    expect($('settings-dialog').classList.contains('hidden')).toBe(false);
    expect(btn('settings-sound').textContent).toBe('Звук: увімк'); // підпис тепер у вікні
    btn('settings-sound').click(); // вимк — одразу в localStorage поза сейвом (ADR-0026)
    expect(btn('settings-sound').textContent).toBe('Звук: вимк');
    expect(localStorage.getItem('rubezh.settings.sound')).toBe('0');
    btn('settings-close').click();
    expect($('settings-dialog').classList.contains('hidden')).toBe(true);
    btn('btn-start-settings').click(); // повернути стан — дефолт «увімк» (ADR-0059)
    btn('settings-sound').click();
    expect(btn('settings-sound').textContent).toBe('Звук: увімк');
    expect(localStorage.getItem('rubezh.settings.sound')).toBe('1');
    btn('settings-close').click();
  });

  it('«Нова партія»: діалог сід/складність → ігровий екран (EARS Фази 12, ADR-0033)', () => {
    btn('btn-start-new').click();
    expect($('new-game-dialog').classList.contains('hidden')).toBe(false);
    expect(($('new-game-seed') as HTMLInputElement).value).toBe('42'); // дефолти діалогу
    expect(($('new-game-preset') as HTMLSelectElement).value).toBe('норма');
    btn('btn-new-game-start').click();
    expect($('new-game-dialog').classList.contains('hidden')).toBe(true);
    expect($('start-screen').classList.contains('hidden')).toBe(true); // ігровий екран
    expect($('topbar').classList.contains('hidden')).toBe(false);
    expect($('layout').classList.contains('hidden')).toBe(false);
    expect($('log').textContent).toContain('Нова партія (сід 42, складність «норма»)');
    expect($('clock').textContent).toBe('Д1 00:00');
    expect($('money').textContent).toBe('300');
    expect($('roster').textContent).toContain('6 оперативників (6 боєготових)');
  });

  it('сейв у флоу: тики → слот 1 (ADR-0026)', () => {
    for (let i = 0; i < 3; i++) btn('btn-tick').click();
    expect($('clock').textContent).toBe('Д1 01:30');
    btn('btn-save-1').click();
    expect($('log').textContent).toContain('Збережено: слот 1');
    expect(localStorage.getItem('rubezh.save.1')).not.toBeNull();
  });

  it('меню → вихід: незбережені дії — підтвердження; переходи без перерисовок (критерій 3)', () => {
    for (let i = 0; i < 2; i++) btn('btn-tick').click(); // дії після сейву — бруд
    expect($('clock').textContent).toBe('Д1 02:30');
    const opsBefore = canvasOps.length;
    btn('btn-menu').click();
    expect($('game-menu').classList.contains('hidden')).toBe(false);
    // П12.3: «Налаштування» з меню гри — меню закривається, вікно відкривається
    btn('btn-menu-settings').click();
    expect($('game-menu').classList.contains('hidden')).toBe(true); // один діалог (ADR-0065)
    expect($('settings-dialog').classList.contains('hidden')).toBe(false);
    expect(btn('settings-sound').textContent).toBe('Звук: увімк'); // стан з минулих тестів
    btn('settings-close').click();
    btn('btn-menu').click();
    btn('btn-menu-exit').click();
    expect($('exit-confirm').classList.contains('hidden')).toBe(false); // підтвердження
    expect($('start-screen').classList.contains('hidden')).toBe(true); // виходу ще не було
    btn('btn-exit-no').click(); // скасування — лишаємось у грі
    expect($('exit-confirm').classList.contains('hidden')).toBe(true);
    expect($('clock').textContent).toBe('Д1 02:30');
    btn('btn-menu').click();
    btn('btn-menu-exit').click();
    btn('btn-exit-yes').click(); // вихід без збереження
    expect($('start-screen').classList.contains('hidden')).toBe(false);
    expect($('topbar').classList.contains('hidden')).toBe(true);
    // діалоги і переходи екранів — 0 перерисовок канви (без rAF, ADR-0029)
    expect(canvasOps.length).toBe(opsBefore);
  });

  it('«Продовжити»: останній слот завантажується, стан сейву відновлено (критерії 1–2)', () => {
    expect(btn('btn-start-continue').disabled).toBe(false); // сейв у слоті 1
    expect(btn('btn-start-continue').title).not.toContain('Немає');
    btn('btn-start-continue').click();
    expect($('start-screen').classList.contains('hidden')).toBe(true); // знову гра
    expect($('log').textContent).toContain('Завантажено: слот 1');
    expect($('clock').textContent).toBe('Д1 01:30'); // стан точки збереження
    expect($('money').textContent).toBe('300');
    expect($('roster').textContent).toContain('6 оперативників (6 боєготових)');
  });

  it('вихід без дій після завантаження — без підтвердження; «Як грати» з меню', () => {
    btn('btn-menu').click();
    btn('btn-menu-help').click();
    expect($('help-screen').classList.contains('hidden')).toBe(false);
    btn('btn-help-close').click();
    btn('btn-menu').click();
    btn('btn-menu-exit').click();
    expect($('exit-confirm').classList.contains('hidden')).toBe(true); // змін немає — миттєво
    expect($('start-screen').classList.contains('hidden')).toBe(false);
  });
});

describe('UI-флоу прев’ю: геосцена → місія → бій → результат (ADR-0013)', () => {
  it('нова партія через флоу: стартовий стан гри — годинник, ростер, фінанси, панель бою прихована', () => {
    // П12.2: партія через хелпер флоу (стартовий екран → діалог); ініціалізацію
    // без партії покрито describe'ом П12.2 вище
    startParty();
    expect($('clock').textContent).toBe('Д1 00:00');
    expect($('roster').textContent).toContain('6 оперативників (6 боєготових)');
    expect($('money').textContent).toBe('300');
    expect($('ready').textContent).toBe('6/6'); // П6.2: чип боєготових у топбарі
    expect($('money-card').textContent).toBe('300'); // П6.2: дублювання балансу чипом і карткою (ADR-0027)
    expect($('battle-panel').classList.contains('hidden')).toBe(true);
    expect($('geo-panel').classList.contains('hidden')).toBe(false);
    expect(btn('btn-tick').disabled).toBe(false);
  });

  // П9.1 (EARS Фази 9): показ першого візиту — у describe П12.2 (перед закриттям);
  // тут — кнопка «?» у топбарі відкриває/закриває будь-коли.
  it('П9.1: «?» у топбарі відкриває/закриває «Як грати»', () => {
    btn('btn-help').click(); // кнопка «?» у топбарі — будь-коли
    expect($('help-screen').classList.contains('hidden')).toBe(false);
    btn('btn-help-close').click();
    expect($('help-screen').classList.contains('hidden')).toBe(true);
  });

  it('btn-tick: +30 хв; btn-day: +1 доба із зупинкою на виявленні зонда (Т.43)', () => {
    btn('btn-tick').click();
    expect($('clock').textContent).toBe('Д1 00:30');
    expect(document.querySelectorAll('#ufos .ufo').length).toBe(0);
    // сід 42: перший зонд виявлено о 09:30 першої доби — «+1 доба» стає тут
    btn('btn-day').click();
    expect($('clock').textContent).toBe('Д1 09:30');
    expect(document.querySelectorAll('#ufos .ufo').length).toBe(1);
    // наступний клік іде далі й стає на приземленні цього зонда (вікно місії відкрите)
    btn('btn-day').click();
    expect($('clock').textContent).toBe('Д1 11:00');
    expect(document.querySelector('#ufos button.mission')).not.toBeNull();
  });

  it('нова партія зі сідом: годинник і журнал', () => {
    startParty();
    expect($('clock').textContent).toBe('Д1 00:00');
    expect($('log').textContent).toContain('Нова партія (сід 42, складність «норма»)');
  });

  it('П8.4a: вибір «легкий» — нова партія з множниками легкого рівня', () => {
    startParty('42', 'легкий');
    // журнал фіксує пресет; стартові кошти 300 × 1.2 = 360 (П8.4, ADR-0033)
    expect($('log').textContent).toContain('складність «легкий»');
    expect($('money').textContent).toBe('360');
    // повертаємо «норму»: наступні тести очікують дефолтний баланс і HP 10
    startParty();
    expect($('money').textContent).toBe('300');
  });

  it('П10.3: вибір «складний» — нова партія з множниками складного рівня', () => {
    startParty('42', 'складний');
    expect($('log').textContent).toContain('складність «складний»');
    // економіка ×0.9 (П10.4): стартові кошти 300 → 270
    expect($('money').textContent).toBe('270');
    // Т.7: ставки в картці «Фінанси» — фактичні за пресетом (з ядра, не з розмітки)
    expect($('econ-rates').textContent).toBe('· дотація 68/добу · премії за місію 99/153');
    expect($('btn-hire').textContent).toBe('Вербувати оперативника (90)');
    // повертаємо «норму»: наступні тести очікують дефолтний баланс
    startParty();
    expect($('money').textContent).toBe('300');
  });

  it('радар: тіки до виявленого приземленого НЛО → кнопка місії (детерміновано)', () => {
    let found = false;
    for (let i = 0; i < 1500 && !found; i++) {
      btn('btn-tick').click();
      found = document.querySelector('button.mission') !== null;
    }
    expect(found).toBe(true); // сід 42: виявлений НЛО приземлюється в межах ліміту
    // Т.7: відкрита вкладка «Загін», кнопка місії — у «Вузлі»: сигнал на вкладці
    expect($('status-tab-squad').classList.contains('active')).toBe(true);
    expect($('status-tab-base').querySelector('.tab-badge')).not.toBeNull();
    expect($('status-tab-base').classList.contains('attention')).toBe(true);
  });

  it('Т.7: розмітка без службового підпису в шапці і без зашитих чисел економіки', () => {
    const doc = new DOMParser().parseFromString(htmlRaw, 'text/html');
    expect(doc.querySelector('#topbar > div')!.textContent!.trim()).toBe('РУБІЖ');
    expect(htmlRaw).not.toContain("прев'ю · фаза");
    expect(doc.getElementById('econ-rates')!.textContent).toBe('');
    expect(doc.getElementById('btn-hire')!.textContent).not.toMatch(/\d/);
  });

  it('запуск місії: панель бою відкрита, геосцена прихована, час геосцени заблоковано', () => {
    (document.querySelector('button.mission') as HTMLButtonElement).click();
    expect($('battle-panel').classList.contains('hidden')).toBe(false);
    expect($('geo-panel').classList.contains('hidden')).toBe(true); // П6.2: фокусна зона — бій (ADR-0027)
    expect($('bctx-turn').textContent).toContain('хід 1'); // П6.3: чий хід — у контекст-стрічці
    expect($('bctx-turn').textContent).toContain('загін');
    expect(btn('btn-tick').disabled).toBe(true);
    expect($('binfo').textContent).toContain('Ваш хід');
    expect($('log').textContent).toContain('Місія: загін висаджено');
    expect($('status-tab-base').querySelector('.tab-badge')).toBeNull(); // Т.7: у бою сигналу нема
  });

  it('вибір солдата кліком по бойовищу (клітина 2,2 — зона висадки)', () => {
    const cv = $('battle') as HTMLCanvasElement;
    cv.dispatchEvent(new MouseEvent('click', { clientX: 2 * 48 + 24, clientY: 2 * 48 + 24 }));
    expect($('binfo').textContent).toContain('HP 10/10');
    expect($('binfo').textContent).toContain('AP 10/10');
  });

  it('дозор: кнопка резервація AP, підказка в binfo', () => {
    btn('btn-ow').click();
    expect($('binfo').textContent).toContain('дозорі');
    expect($('binfo').textContent).toContain('AP 7/10');
  });

  it('кінець ходу: ШІ відпрацьовує синхронно, хід 2 гравцю', () => {
    btn('btn-end').click();
    expect($('bresult').textContent).toBe(''); // загін 3×10 HP виживає перший хід ШІ (сід 42)
    expect($('bctx-turn').textContent).toContain('хід 2'); // П6.3: стрічка відобразила хід 2
    expect($('binfo').textContent).toContain('Хід демонів Розриву відпрацьовано');
    expect($('bturn').className).toBe('done'); // Т.33: підсумок ходу — до першої дії гравця (без rAF плашки «діють» немає)
    expect($('bturn').textContent).toMatch(
      /^ХІД ДЕМОНІВ РОЗРИВУ — ПІДСУМОК(Демони не атакували\.|Пострілів по загону: \d+, влучань: \d+).*Демонів у полі зору: \d+$/
    );
    btn('btn-ow').click();
    expect($('bturn').className).toBe('hidden');
  });

  it('П13.3 (ADR-0067): флоу «Авто → Стоп → ручна дія → Авто» — бій доведено до результату (критерій 1)', async () => {
    const cap = (): string => (document.querySelector('#btn-auto-battle .tb-cap') as HTMLElement | null)?.textContent ?? '';
    const cv = $('battle') as HTMLCanvasElement;
    const cellClick = (x: number, y: number): void => {
      cv.dispatchEvent(new MouseEvent('click', { clientX: x * 48 + 24, clientY: y * 48 + 24 }));
    };
    vi.useFakeTimers(PAGE_FAKE_TIMERS);
    try {
      // Авто: політика ядра веде загін — покроково (перша дія одразу), не миттєво
      btn('btn-auto-battle').click();
      expect(cap()).toBe('Стоп'); // підпис плитки — стан драйвера
      expect(btn('btn-auto-battle').classList.contains('armed')).toBe(true); // підсвітка тривалості
      expect($('binfo').textContent).toContain('Авто-бій'); // стартове повідомлення драйвера
      expect($('bresult').textContent).toBe(''); // бій триває — не миттєвий прогін
      btn('btn-ow').click(); // ручне керування заблоковане під час авто-бою
      expect($('binfo').textContent).not.toContain('дозорі');
      // Стоп: завершує поточну дію (кроки атомарні), керування — назад гравцю
      btn('btn-auto-battle').click();
      expect(cap()).toBe('Авто');
      expect(btn('btn-auto-battle').classList.contains('armed')).toBe(false);
      // ручна дія з досягнутого стану: оперативник із AP у зоні висадки — дозор
      // (перша дія політики витратила AP одного солдата — перебираємо зони)
      let overwatched = false;
      for (const [x, y] of [
        [2, 2],
        [3, 2],
        [4, 2],
      ]) {
        cellClick(x, y);
        btn('btn-ow').click();
        if ($('binfo').textContent.includes('дозорі')) {
          overwatched = true;
          break;
        }
      }
      expect(overwatched).toBe(true);
      // Авто знову — з будь-якого моменту; доводимо бій до результату
      btn('btn-auto-battle').click();
      expect(cap()).toBe('Стоп');
      await runAutoSteps();
    } finally {
      vi.useRealTimers();
    }
    expect($('bresult').textContent).toMatch(/ЗАЧИЩЕНО|ЗАГІН ВТРАЧЕНО/);
    expect(btn('btn-auto-battle').disabled).toBe(true); // бій завершено — авто-бій більше не тискається
    expect($('log').textContent).toMatch(/Місію зачищено|Загін втрачено/);
  });

  it('закриття бою повертає на геосцену і розблоковує час', () => {
    btn('btn-close').click();
    expect($('battle-panel').classList.contains('hidden')).toBe(true);
    expect($('geo-panel').classList.contains('hidden')).toBe(false); // П6.2: фокусна зона — геосцена
    expect(btn('btn-tick').disabled).toBe(false);
    expect($('bresult').textContent).toBe('');
  });
});

describe('критичний флоу економіки: найм → місія → поранення → одужання (П4.5, ADR-0021)', () => {
  // Сід 27 детермінований: перша місія — «розвідник» на 18-му тіку; авто-бій —
  // перемога, Олена гине, Іван поранений 3/10 → лікарня 14 тіків; премія +110.
  // Т.18 (ADR-0087): до симетричної лінії вогню флоу йшов на сіді 42 — там
  // авто-бій тепер минає без поранених.

  it('скидання партії: баланс 300, ростер 6', () => {
    startParty('27');
    expect($('money').textContent).toBe('300');
    expect($('roster').textContent).toContain('6 оперативників (6 боєготових)');
  });

  it('найм: −100, новобранець «Дмитро» в кінці ростеру', () => {
    btn('btn-hire').click();
    expect($('money').textContent).toBe('200');
    expect($('roster').textContent).toContain('7 оперативників (7 боєготових)');
    expect($('roster').textContent).toContain('Дмитро');
    expect($('log').textContent).toContain('Вербування: Дмитро');
    expect($('log').textContent).toContain('Витрати: −100');
  });

  it('місія: тіки до вікна, запуск, час заблоковано', () => {
    let found = false;
    for (let i = 0; i < 1500 && !found; i++) {
      btn('btn-tick').click();
      found = document.querySelector('button.mission') !== null;
    }
    expect(found).toBe(true);
    (document.querySelector('button.mission') as HTMLButtonElement).click();
    expect($('battle-panel').classList.contains('hidden')).toBe(false);
    expect(btn('btn-tick').disabled).toBe(true);
  });

  it('поранення: авто-бій — перемога, поранений у лікарні, премія за місію', async () => {
    await runAutoBattle();
    expect($('bresult').textContent).toContain('ЗАЧИЩЕНО');
    expect($('bresult').textContent).toContain('поранених: 1');
    expect($('log').textContent).toContain('Іван поранений — лікарня: 14 тіків');
    expect($('log').textContent).toContain('Премія за місію (розвідник): +110');
    expect($('money').textContent).toBe('310'); // 300 − 100 найм + 110 премія (П8.6)
  });

  it('поранений не боєготовий: статус у ростері, місія недоступна поки вікно триває', () => {
    btn('btn-close').click();
    expect($('battle-panel').classList.contains('hidden')).toBe(true);
    expect($('roster').textContent).toContain('6 оперативників (5 боєготових)');
    expect($('roster').textContent).toContain('лікарня: 14 тіків');
    expect($('roster').textContent).toContain('HP 3/10');
    expect(btn('btn-tick').disabled).toBe(false);
  });

  it('одужання: 14 тіків — ветеран знову боєготовий, баланс і годинник цілі', () => {
    for (let i = 0; i < 14; i++) btn('btn-tick').click();
    expect($('roster').textContent).not.toContain('лікарня');
    expect($('roster').textContent).toContain('HP 10/10');
    expect($('roster').textContent).toContain('6 оперативників (6 боєготових)');
    expect($('money').textContent).toBe('310'); // доти не було — доба не завершена
    expect($('clock').textContent).toBe('Д1 16:00'); // 18 + 14 тіків по 30 хв
  });

  it('дотація: завершення доби 1 — +75 у журналі і балансі', () => {
    for (let i = 0; i < 16; i++) btn('btn-tick').click(); // 48 тіків усього
    expect($('clock').textContent).toBe('Д2 00:00');
    expect($('money').textContent).toBe('385');
    expect($('log').textContent).toContain('Дотація за добу 1: +75');
  });
});

describe('журнал з фільтрами-вкладками (П6.2, ADR-0027)', () => {
  // Стан продовжує флоу економіки: Д2 00:00, баланс 385, 6 солдатів.

  it('вкладка ховає невідповідні записи, активна підсвічена, «Усе» повертає все', () => {
    const geoLi = document.querySelector('#log li[data-cat="geo"]') as HTMLElement;
    expect(geoLi.style.display).toBe(''); // фільтр «Усе» — усе видимо
    btn('log-tab-econ').click();
    expect((document.querySelector('#log-tabs button.active') as HTMLElement).id).toBe('log-tab-econ');
    expect(geoLi.style.display).toBe('none');
    const econLi = document.querySelector('#log li[data-cat="econ"]') as HTMLElement;
    expect(econLi.style.display).toBe('');
    btn('log-tab-all').click();
    expect(geoLi.style.display).toBe('');
  });

  it('Т.31: кнопка розгортає журнал-смугу і згортає її назад', () => {
    const journal = document.getElementById('journal') as HTMLElement;
    const expand = btn('btn-log-expand');
    expect(journal.classList.contains('expanded')).toBe(false);
    expand.click();
    expect(journal.classList.contains('expanded')).toBe(true);
    expect(expand.textContent).toBe('Згорнути');
    expect(expand.getAttribute('aria-expanded')).toBe('true');
    expand.click();
    expect(journal.classList.contains('expanded')).toBe(false);
    expect(expand.textContent).toBe('Розгорнути');
    expect(expand.getAttribute('aria-expanded')).toBe('false');
  });

  it('новий запис під активним фільтром видимий, під іншим — приховується', () => {
    btn('log-tab-econ').click();
    btn('btn-hire').click(); // 385 → 285 (два записи: «Найм» + «Витрати»)
    const hireLi = Array.from(document.querySelectorAll('#log li[data-cat="econ"]')).find((li) =>
      li.textContent!.includes('Вербування')
    ) as HTMLElement;
    expect(hireLi.style.display).toBe('');
    btn('log-tab-battle').click();
    expect(hireLi.style.display).toBe('none');
    btn('log-tab-all').click();
    expect(hireLi.style.display).toBe('');
    expect($('money').textContent).toBe('285');
  });
});

describe('панель збереження: 3 слоти, лише на геосцені (П5.3, ADR-0026, ADR-0013)', () => {
  beforeEach(() => {
    localStorage.clear(); // кожен тест блоку — на чистих слотах
    startParty('27');
    for (let i = 0; i < 1500 && document.querySelector('button.mission') === null; i++) btn('btn-tick').click();
    expect($('slot-1').textContent).toBe('—'); // issue #378: beforeEach не зберігає слот 1 — тести зберігають самі
  });

  it('критичний флоу: зберегти → «перезавантаження» (нова партія) → завантажити → жорсткий збіг стану', () => {
    startParty('27');
    // дотікати до виявленого приземленого НЛО (трекінг НЛО має потрапити у сейв)
    let found = false;
    for (let i = 0; i < 1500 && !found; i++) {
      btn('btn-tick').click();
      found = document.querySelector('button.mission') !== null;
    }
    expect(found).toBe(true);
    const ufosBefore = $('ufos').textContent;
    const rosterBefore = $('roster').textContent;
    expect($('clock').textContent).toBe('Д1 09:00'); // 18-й тік (детерміновано, сід 27)

    btn('btn-save-1').click();
    expect($('log').textContent).toContain('Збережено: слот 1');
    expect($('slot-1').textContent).toContain('сід 27');
    expect(btn('btn-load-1').disabled).toBe(false);
    expect(localStorage.getItem('rubezh.save.1')).not.toBeNull();

    // «перезавантаження сторінки»: свіжа партія — слот виживає у localStorage
    startParty('27');
    expect($('clock').textContent).toBe('Д1 00:00');
    expect($('ufos').textContent).toContain('Нічого не виявлено');

    // завантаження відновлює партію: час, трекінг НЛО, ростер, фінанси
    btn('btn-load-1').click();
    expect($('log').textContent).toContain('Завантажено: слот 1');
    expect($('clock').textContent).toBe('Д1 09:00');
    expect($('ufos').textContent).toBe(ufosBefore);
    expect($('roster').textContent).toBe(rosterBefore);
    expect($('money').textContent).toBe('300');

    // жорсткий збіг: повторний сейв того самого стану — ідентичний state
    btn('btn-save-2').click();
    const s1 = JSON.parse(localStorage.getItem('rubezh.save.1')!) as { state: unknown };
    const s2 = JSON.parse(localStorage.getItem('rubezh.save.2')!) as { state: unknown };
    expect(JSON.stringify(s2.state)).toBe(JSON.stringify(s1.state));
  });

  it('розбіжність і відкат: тики після сейву → завантаження повертає стан точки збереження', () => {
    btn('btn-save-1').click(); // сейв слота 1 у Д1 09:00 — до passDay (issue #378)
    passDay(); // доба вперед: дотація +75 (П8.6)
    expect($('clock').textContent).toBe('Д2 09:00');
    expect($('money').textContent).toBe('375');
    btn('btn-load-1').click();
    expect($('clock').textContent).toBe('Д1 09:00');
    expect($('money').textContent).toBe('300');
    expect(document.querySelector('button.mission')).not.toBeNull(); // вікно місії відновлено
  });

  it('під час бою панель збереження вимкнена (ADR-0026: місія не переривається)', async () => {
    btn('btn-save-1').click(); // сейв слота 1, щоб після бою load-1 був доступний (issue #378)
    (document.querySelector('button.mission') as HTMLButtonElement).click();
    expect($('battle-panel').classList.contains('hidden')).toBe(false);
    expect(btn('btn-save-1').disabled).toBe(true);
    expect(btn('btn-load-1').disabled).toBe(true);
    expect(btn('btn-del-1').disabled).toBe(true);
    await runAutoBattle(); // завершити бій (детерміновано: сід 27)
    btn('btn-close').click();
    expect(btn('btn-save-1').disabled).toBe(false);
    expect(btn('btn-load-1').disabled).toBe(false);
  });

  it('лікарня у сейві: поранений відновлюється після завантаження', async () => {
    // авто-бій цієї партії: перемога, один загиблий, Іван поранений 3/10 (сід 27)
    (document.querySelector('button.mission') as HTMLButtonElement).click();
    await runAutoBattle();
    btn('btn-close').click();
    expect($('roster').textContent).toContain('лікарня: 14 тіків');
    expect($('money').textContent).toBe('410'); // 300 + премія 110 (П8.6)
    btn('btn-save-3').click();
    for (let i = 0; i < 14; i++) btn('btn-tick').click(); // одужання
    expect($('roster').textContent).not.toContain('лікарня');
    btn('btn-load-3').click();
    expect($('roster').textContent).toContain('лікарня: 14 тіків');
    expect($('roster').textContent).toContain('HP 3/10');
    expect($('money').textContent).toBe('410');
  });

  it('пошкоджений слот: метадані «пошкоджений слот», завантаження — помилка без зміни стану', () => {
    localStorage.setItem('rubezh.save.2', 'не json');
    btn('btn-tick').click(); // renderAll → перемальовка панелі
    expect($('slot-2').textContent).toBe('пошкоджений слот');
    const clockBefore = $('clock').textContent;
    btn('btn-load-2').click();
    expect($('log').textContent).toContain('Завантаження не вдалось');
    expect($('log').textContent).toContain('Пошкоджені дані');
    expect($('clock').textContent).toBe(clockBefore); // без часткового стану
  });

  it('видалення слота: метадані «—», завантаження вимкнене', () => {
    btn('btn-save-2').click();
    btn('btn-del-2').click();
    expect($('slot-2').textContent).toBe('—');
    expect(btn('btn-load-2').disabled).toBe(true);
    expect(btn('btn-del-2').disabled).toBe(true);
    expect(localStorage.getItem('rubezh.save.2')).toBeNull();
  });

  // Т.47: сейв на геосцені зі знайденим зондом, ще один тік (щоб завантажений стан
  // відрізнявся від покинутого) і запуск місії
  const saveTickAndLaunch = (): string => {
    btn('btn-del-3').click(); // останнім активним слотом має бути слот 1
    startParty('27');
    for (let i = 0; i < 1500 && document.querySelector('button.mission') === null; i++) btn('btn-tick').click();
    btn('btn-save-1').click();
    const money = $('money').textContent ?? '';
    expect($('clock').textContent).toBe('Д1 09:00');
    btn('btn-tick').click();
    expect($('clock').textContent).toBe('Д1 09:30');
    (document.querySelector('button.mission') as HTMLButtonElement).click();
    expect($('battle-panel').classList.contains('hidden')).toBe(false);
    return money;
  };
  const exitToStart = (unsaved: boolean): void => {
    btn('btn-menu').click();
    btn('btn-menu-exit').click();
    expect($('exit-confirm').classList.contains('hidden')).toBe(!unsaved); // підтвердження — лише коли є що втрачати
    if (unsaved) btn('btn-exit-yes').click();
    expect($('start-screen').classList.contains('hidden')).toBe(false);
  };
  const expectLoadedGeo = (money: string): void => {
    expect($('start-screen').classList.contains('hidden')).toBe(true);
    expect($('clock').textContent).toBe('Д1 09:00'); // стан сейву, а не покинутої партії
    expect($('money').textContent).toBe(money);
    expect($('battle-panel').classList.contains('hidden')).toBe(true);
    expect($('geo-panel').classList.contains('hidden')).toBe(false);
    expect($('layout').classList.contains('in-battle')).toBe(false);
    expect($('status').classList.contains('dimmed')).toBe(false);
    expect($('next-step').classList.contains('hidden')).toBe(false);
    expect($('bresult').innerHTML).toBe('');
  };

  it('Т.47: «Продовжити» після виходу з бою, що триває, завантажує сейв і закриває бій', () => {
    const money = saveTickAndLaunch();
    exitToStart(true);
    btn('btn-start-continue').click();
    expectLoadedGeo(money);
    // місія з сейву на місці: новий бій починається з першого ходу
    (document.querySelector('button.mission') as HTMLButtonElement).click();
    expect($('bctx-turn').textContent).toBe('хід 1 · загін');
    exitToStart(true);
  });

  it('Т.47: «Продовжити» після виходу з екрана результату бою — банера результату немає', async () => {
    const money = saveTickAndLaunch();
    await runAutoBattle();
    expect($('bresult').textContent).toMatch(/ЗАЧИЩЕНО|ЗАГІН ВТРАЧЕНО/);
    exitToStart(true);
    expect($('bresult').innerHTML).toBe(''); // Т.48: завершений бій закриває вже вихід
    btn('btn-start-continue').click();
    expectLoadedGeo(money);
    exitToStart(false);
  });

  // Т.48 (рішення власника «Зупиняти все»): вихід закриває бій одразу, а не «Продовжити»
  it('Т.48: вихід на стартовий екран із бою закриває бій; з геосцени — лише скидає анімації', () => {
    const cancel = vi.spyOn(AnimEngine.prototype, 'cancel');
    try {
      saveTickAndLaunch();
      cancel.mockClear();
      exitToStart(true);
      expect($('battle-panel').classList.contains('hidden')).toBe(true);
      expect($('geo-panel').classList.contains('hidden')).toBe(false);
      expect($('layout').classList.contains('in-battle')).toBe(false);
      expect($('clock').textContent).toBe('Д1 09:30'); // партія покинута, не завантажена
      expect(cancel).toHaveBeenCalledTimes(2); // рушій бою (close) і рушій геосцени
      cancel.mockClear();
      btn('btn-start-continue').click();
      expect(cancel).toHaveBeenCalledTimes(2); // «Продовжити»: close і рушій геосцени
      cancel.mockClear();
      btn('btn-tick').click(); // незбережена дія на геосцені
      exitToStart(true);
      expect(cancel).toHaveBeenCalledTimes(1); // бою немає — лише рушій геосцени
      expect($('clock').textContent).toBe('Д1 09:30');
    } finally {
      cancel.mockRestore();
    }
  });

  it('Т.48: невдале завантаження останнього слота — лишаємось на стартовому екрані', () => {
    btn('btn-save-1').click(); // сейв слота 1 у Д1 09:00 (issue #378)
    btn('btn-start-continue').click(); // слот 1 цілий — у гру
    expect($('start-screen').classList.contains('hidden')).toBe(true);
    exitToStart(false);
    const good = localStorage.getItem('rubezh.save.1') as string;
    const bad = JSON.parse(good) as { state: { geo: { ufos: unknown } } };
    bad.state.geo.ufos = [null]; // метадані читаються (слот лишається останнім), розбір партії падає
    const failures = (): number => ($('log').textContent ?? '').split('✗ Завантаження не вдалось').length - 1;
    const failuresBefore = failures();
    localStorage.setItem('rubezh.save.1', JSON.stringify(bad));
    try {
      expect(btn('btn-start-continue').disabled).toBe(false);
      btn('btn-start-continue').click();
      expect($('start-screen').classList.contains('hidden')).toBe(false);
      expect($('topbar').classList.contains('hidden')).toBe(true);
      expect(failures()).toBe(failuresBefore + 1); // завантаження справді пробували
    } finally {
      localStorage.setItem('rubezh.save.1', good);
    }
    btn('btn-start-continue').click(); // цілий слот знову вантажиться
    expect($('start-screen').classList.contains('hidden')).toBe(true);
    exitToStart(false);
  });

  // останнім у блоці: запускає авто-бій (спільний стан тестів блоку)
  it('Т.48: авто-бій, запущений до виходу, за стартовим екраном не йде далі', async () => {
    const money = saveTickAndLaunch();
    vi.useFakeTimers(PAGE_FAKE_TIMERS);
    try {
      btn('btn-auto-battle').click();
      await vi.advanceTimersByTimeAsync(AUTO_STEP_MS * 3); // авто-бій справді йде
      const logBefore = $('log').textContent;
      exitToStart(true);
      expect(vi.getTimerCount()).toBe(0); // таймер паузи авто-бою знято
      await vi.advanceTimersByTimeAsync(AUTO_STEP_MS * 6000);
      expect($('log').textContent).toBe(logBefore); // жодної дії бою після виходу
      expect($('bresult').innerHTML).toBe('');
    } finally {
      vi.useRealTimers();
    }
    btn('btn-start-continue').click();
    expectLoadedGeo(money);
    exitToStart(false);
  });
});

describe('бойова фокусна зона (П6.3, ADR-0027)', () => {
  it('розмітка: тулбар дій збоку (П13.2, ADR-0066), бойовище — квадрат (ширина колонки, кап 960px — П14.3)', () => {
    const panel = htmlRaw.match(/<section class="panel hidden" id="battle-panel">[\s\S]*?<\/section>/)![0];
    expect(panel).not.toContain('id="bcontrols"'); // нижня смуга кнопок вилучена (ADR-0066)
    expect(panel.indexOf('id="bctx"')).toBeLessThan(panel.indexOf('id="battle"')); // контекст-стрічка — над бойовищем
    expect(panel.indexOf('id="battle"')).toBeLessThan(panel.indexOf('id="btoolbar"')); // тулбар — збоку бойовища
    const css = htmlRaw.match(/#battle \{[^}]*\}/)![0];
    expect(css).toContain('width: 100%'); // на ширину фокусної колонки
    expect(css).toContain('max-width: 960px'); // кап 960px — 1:1 buffer 960×960 (П14.3, ADR-0068)
    expect(css).toContain('aspect-ratio: 1'); // квадрат
    // П13.2 (ADR-0066): тулбар вертикальний, плитки — тач-цілі ≥ 44px
    const tb = htmlRaw.match(/#btoolbar \{[^}]*\}/)![0];
    expect(tb).toContain('flex-direction: column');
    const tbBtn = htmlRaw.match(/#btoolbar button \{[^}]*\}/)![0];
    expect(tbBtn).toContain('min-height: 48px');
    const cv = $('battle') as HTMLCanvasElement;
    expect(cv.width).toBe(960); // buffer 960×960: BCELL 48 × 20 клітинок (П14.3, ADR-0068)
  });

  it('контекст-стрічка: тип місії, заморожений час, чий хід; колонка стану dimmed; збереження вимкнене', () => {
    startParty();
    let found = false;
    for (let i = 0; i < 1500 && !found; i++) {
      btn('btn-tick').click();
      found = document.querySelector('button.mission') !== null;
    }
    expect(found).toBe(true);
    (document.querySelector('button.mission') as HTMLButtonElement).click();
    expect($('battle-panel').classList.contains('hidden')).toBe(false);
    // сід 42: перша місія — «розвідник» на 22-му тіку (детерміновано)
    expect($('bctx-kind').textContent).toBe('розвідник');
    expect($('bctx-time').textContent).toBe($('clock').textContent + ' · заморожено');
    expect($('bctx-turn').textContent).toBe('хід 1 · загін');
    expect($('bctx-unit').textContent).toBe('не вибраний');
    // ADR-0027: у бою колонка стану приглушена й неактивна
    expect($('status').classList.contains('dimmed')).toBe(true);
    // ADR-0026: збереження лише на геосцені — кнопки disabled у бою
    expect(btn('btn-save-1').disabled).toBe(true);
    expect(btn('btn-load-1').disabled).toBe(true);
    expect(btn('btn-del-1').disabled).toBe(true);
  });

  it('вибір юніта: стрічка показує активний юніт HP/AP', () => {
    const cv = $('battle') as HTMLCanvasElement;
    cv.dispatchEvent(new MouseEvent('click', { clientX: 2 * 48 + 24, clientY: 2 * 48 + 24 }));
    expect($('bctx-unit').textContent).toContain('HP 10/10');
    expect($('bctx-unit').textContent).toContain('AP 10/10');
    expect($('binfo').textContent).toContain('HP 10/10');
  });

  it('після бою: dimmed знято, збереження активне', async () => {
    await runAutoBattle();
    expect($('bresult').textContent).toMatch(/ЗАЧИЩЕНО|ЗАГІН ВТРАЧЕНО/);
    btn('btn-close').click();
    expect($('geo-panel').classList.contains('hidden')).toBe(false);
    expect($('status').classList.contains('dimmed')).toBe(false);
    expect(btn('btn-save-1').disabled).toBe(false);
    expect(btn('btn-load-1').disabled).toBe(false); // слот 1 має дані з флоу збереження вище
    expect(btn('btn-del-1').disabled).toBe(false);
  });
});

describe('керування: гарячі клавіші і тач-патерн (П6.4, ADR-0027)', () => {
  const key = (k: string, code: string, target: EventTarget = document): void => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, code: code, bubbles: true }));
  };
  const tap = (x: number, y: number): void => {
    $('battle').dispatchEvent(new MouseEvent('click', { clientX: x * 48 + 24, clientY: y * 48 + 24 }));
  };

  it('підготовка: нова партія (сід 42) → місія → вибір солдата у зоні висадки', () => {
    startParty();
    let found = false;
    for (let i = 0; i < 1500 && !found; i++) {
      btn('btn-tick').click();
      found = document.querySelector('button.mission') !== null;
    }
    expect(found).toBe(true);
    (document.querySelector('button.mission') as HTMLButtonElement).click();
    tap(2, 2); // зона висадки — свій солдат
    expect($('bctx-unit').textContent).toContain('AP 10/10');
  });

  it('тап-тап: перший тап — лише прев’ю (AP лишається), повторний у ту саму клітинку — рух', () => {
    tap(3, 3); // перший тап — прев'ю шляху (обхід сусідів по висадці: 6 клітинок)
    expect($('binfo').textContent).toContain('Шлях: 6 AP');
    expect($('binfo').textContent).toContain('повторний тап');
    expect($('bctx-unit').textContent).toContain('AP 10/10'); // ходу ще не було
    tap(3, 3); // повторний тап у ту саму клітинку — хід
    expect($('binfo').textContent).toContain('рух');
    expect($('bctx-unit').textContent).toContain('AP 4/10');
  });

  it('тап у ІНШУ клітинку — нове прев’ю; шлях без AP: повторний тап ходу не робить', () => {
    tap(2, 2); // шлях 6 AP проти 4 — прев'ю «червоними крапками» (AP не вистачає)
    expect($('binfo').textContent).toContain('Не вистачає AP: шлях 6 проти 4');
    expect($('bctx-unit').textContent).toContain('AP 4/10'); // ходу не було
    tap(2, 2); // повторний тап у ту саму клітинку — ходу все одно немає
    expect($('binfo').textContent).toContain('Не вистачає AP: шлях 6 проти 4');
    expect($('bctx-unit').textContent).toContain('AP 4/10');
  });

  it('гарячі клавіші 1/2/3: зводять режим пострілу, кнопка підсвічена (armed)', () => {
    key('1', 'Digit1');
    expect(btn('btn-snap').classList.contains('armed')).toBe(true);
    expect($('binfo').textContent).toContain('швидкий');
    // П6.14: AP 4 — прицільний (5 AP) не зводиться: відмова з причиною, режим лишається попереднім
    key('2', 'Digit2');
    expect(btn('btn-aimed').classList.contains('armed')).toBe(false);
    expect(btn('btn-aimed').disabled).toBe(true); // кнопка без AP приглушена
    expect(btn('btn-aimed').title).toContain('не вистачає AP');
    expect($('binfo').textContent).toContain('Не вистачає AP');
    expect(btn('btn-snap').classList.contains('armed')).toBe(true); // режим не перемкнувся
    key('3', 'Digit3');
    expect(btn('btn-auto').classList.contains('armed')).toBe(true); // черга рівно 4 AP — ок
  });

  it('Esc скасовує режим пострілу (armed знято, підказка в binfo)', () => {
    key('Escape', 'Escape');
    expect(btn('btn-auto').classList.contains('armed')).toBe(false);
    expect($('binfo').textContent).toContain('Режим пострілу скасовано');
  });

  it('E завершує хід: ШІ відпрацьовує синхронно, хід 2 гравцю', () => {
    key('e', 'KeyE');
    expect($('bctx-turn').textContent).toContain('хід 2');
    expect($('binfo').textContent).toContain('Хід демонів Розриву відпрацьовано');
  });

  it('поля вводу: гарячі клавіші ігноруються (поле діалогу) — хід не завершується', () => {
    // П12.2: поле сіду — у діалозі нової партії (мігрувало з топбара); target
    // keydown — те саме поле вводу, контракт гарячих клавіш незмінний
    const field = $('new-game-seed') as HTMLInputElement;
    field.focus();
    key('e', 'KeyE', field); // keydown із поля вводу — ігнорується
    expect($('bctx-turn').textContent).toContain('хід 2'); // хід не передано
    key('1', 'Digit1', field); // і режим пострілу не зводиться
    expect(btn('btn-snap').classList.contains('armed')).toBe(false);
    field.blur();
  });
});

describe('П6.14: UX прицілювання — обведення цілей, шанс біля клітинки, кнопки без AP', () => {
  const tap = (x: number, y: number): void => {
    $('battle').dispatchEvent(new MouseEvent('click', { clientX: x * 48 + 24, clientY: y * 48 + 24 }));
  };
  const hover = (x: number, y: number): void => {
    $('battle').dispatchEvent(new MouseEvent('mousemove', { clientX: x * 48 + 24, clientY: y * 48 + 24 }));
  };
  const keydown = (k: string, code: string): void => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: k, code: code, bubbles: true }));
  };
  // Рамка валідної цілі: strokeRect(gx*48+2, gy*48+2, 44, 44) — BCELL 48 (П14.3)
  const frame = (x: number, y: number): string => 'strokeRect(' + (x * 48 + 2) + ',' + (y * 48 + 2) + ',44,44)';

  it('підготовка: нова партія (сід 42) → місія → солдат (3,2) крокує на (4,2) — 1 AP', () => {
    startParty();
    let found = false;
    for (let i = 0; i < 1500 && !found; i++) {
      btn('btn-tick').click();
      found = document.querySelector('button.mission') !== null;
    }
    expect(found).toBe(true);
    (document.querySelector('button.mission') as HTMLButtonElement).click();
    tap(3, 2); // вибір солдата у зоні висадки
    tap(4, 2); // перший тап — прев'ю шляху (1 AP)
    tap(4, 2); // повторний тап — хід
    expect($('bctx-unit').textContent).toContain('AP 9/10');
    // Т.44 (рішення власника): синій пунктир зони висадки лишився, червоного пунктиру старту демонів немає
    expect(canvasOps.includes('set:strokeStyle=rgba(110,168,255,0.5)')).toBe(true);
    expect(canvasOps.some((o) => /^strokeRect\(\d+,\d+,43,43\)$/.test(o))).toBe(true);
    expect(canvasOps.some((o) => o.includes('255,107,107'))).toBe(false);
    // до зведення режиму цілі не обведені
    expect(canvasOps.includes(frame(16, 2))).toBe(false);
  });

  it('зведений режим: валідна ціль (16,2) обведена; невидима (17,2) — ні (туман)', () => {
    btn('btn-snap').click();
    expect(btn('btn-snap').classList.contains('armed')).toBe(true);
    expect(canvasOps.includes(frame(16, 2))).toBe(true); // валідна ціль підсвічена
    expect(canvasOps.includes(frame(17, 2))).toBe(false); // поза зором/дальністю — не підсвічена
  });

  it('наведення на ціль: шанс попадання біля клітинки (плашка на канві)', () => {
    hover(16, 2);
    const chance = $('binfo').textContent.match(/~(\d+)%/);
    expect(chance).not.toBe(null);
    // елемент журналу — уся операція з координатами, тому префіксний пошук
    expect(canvasOps.some((o) => o.startsWith('fillText(~' + chance![1] + '%,'))).toBe(true);
  });

  it('тап без режиму — підказка; тап-тап пострілу: перший тап — шанс (AP не змінюється), другий — постріл', () => {
    keydown('Escape', 'Escape'); // зняти режим
    tap(16, 2); // прибулець без зведеного режиму
    expect($('binfo').textContent).toContain('Виберіть режим пострілу');
    btn('btn-snap').click(); // зведено
    tap(16, 2); // перший тап по цілі — прев'ю шансу
    expect($('binfo').textContent).toContain('повторний тап у цю саму ціль');
    expect($('binfo').textContent).toContain('~');
    expect($('bctx-unit').textContent).toContain('AP 9/10'); // пострілу ще не було
    // фідбек не ламає тап-тап: тап в ІНШУ клітинку — прев'ю руху, режим знято
    tap(5, 2);
    expect($('binfo').textContent).toContain('Шлях: 1 AP');
    expect(btn('btn-snap').classList.contains('armed')).toBe(false);
    btn('btn-snap').click();
    tap(16, 2); // знову перший тап — прев'ю (ходу/пострілу ще немає)
    expect($('bctx-unit').textContent).toContain('AP 9/10');
    tap(16, 2); // повторний тап у ту саму ціль — постріл
    expect($('binfo').textContent).toContain('Олена вистрілила'); // Т.7: рід дієслова — за іменем
    expect($('bctx-unit').textContent).toContain('AP 6/10');
  });

  it('кнопки без достатку AP — приглушені з причиною «не вистачає AP» (постріл → AP 3)', () => {
    btn('btn-snap').click();
    tap(16, 2);
    tap(16, 2); // другий постріл: AP 6 − 3 = 3
    expect($('bctx-unit').textContent).toContain('AP 3/10');
    expect(btn('btn-aimed').disabled).toBe(true); // 5 AP > 3
    expect(btn('btn-aimed').title).toContain('не вистачає AP (потрібно 5)');
    expect(btn('btn-auto').disabled).toBe(true); // 4 AP > 3
    expect(btn('btn-ow').disabled).toBe(false); // дозор 3 AP — ок
    expect(btn('btn-snap').disabled).toBe(false); // 3 AP — ок
    // гаряча клавіша дає ту саму відмову з причиною
    keydown('2', 'Digit2');
    expect($('binfo').textContent).toContain('Не вистачає AP');
    expect(btn('btn-aimed').classList.contains('armed')).toBe(false);
  });

  it('Т.46: зведений постріл і «Авто» — плитка пострілу не зведена ні в авто-бої, ні після «Стоп»; вибір лишається', () => {
    const armed = (id: string): boolean => btn(id).classList.contains('armed');
    vi.useFakeTimers(PAGE_FAKE_TIMERS);
    try {
      btn('btn-snap').click(); // AP 3 — швидкий постріл зводиться
      expect(armed('btn-snap')).toBe(true);
      btn('btn-auto-battle').click();
      expect(armed('btn-auto-battle')).toBe(true); // авто-бій іде
      expect(armed('btn-snap')).toBe(false);
      expect($('binfo').textContent).toContain('Авто-бій');
      btn('btn-auto-battle').click(); // «Стоп»
      expect(armed('btn-auto-battle')).toBe(false);
      expect(armed('btn-snap')).toBe(false);
      expect($('bctx-unit').textContent).toContain('AP '); // оперативник досі вибраний
    } finally {
      vi.useRealTimers();
    }
  });
});

// П7.4 (ADR-0021/0032): критичний флоу економіки винищувача — «запуск → бій →
// пошкодження → ремонт → знову готовий». Ремонт — гроші + тіки (патерн лікарні);
// під час ремонту запуск перехоплення заблокований; банкрутство не змінюється.
describe('П7.4: винищувач — запуск → бій → пошкодження → ремонт → знову готовий', () => {
  const fighterText = (): string => $('fighter').textContent ?? '';
  const interceptBtn = (): HTMLButtonElement | null => {
    for (const b of document.querySelectorAll<HTMLButtonElement>('button.intercept')) {
      if (!b.disabled) return b;
    }
    return null;
  };

  it('критичний флоу: перехоплення → бій → пошкодження → ремонт (−50) → знову боєготовий', () => {
    startParty();
    expect(fighterText()).toContain('боєготовий');
    expect(fighterText()).toContain('HP 4/4');
    // спроби перехоплення: НЛО може сісти/зникнути під час погоні (EARS, ADR-0032) —
    // тоді винищувач на базі й чекаємо нову ціль; раунди бою розв'язують бій до результату
    let battleMoney = -1;
    let rounds = 0;
    let guard = 0;
    while (guard++ < 6000) {
      if (fighterText().includes('Бій з')) {
        if (battleMoney < 0) battleMoney = Number($('money').textContent);
        const choice = document.querySelector<HTMLButtonElement>('button.intercept-range[data-choice="впритул"]');
        if (!choice) break; // бій завершився попереднім кліком
        choice.click();
        rounds++;
        continue;
      }
      if (fighterText().includes('ремонт') || fighterText().includes('пошкоджений') || $('log').textContent.includes('збитий')) break;
      if (fighterText().includes('на базі') || fighterText().includes('боєготовий')) {
        const b = interceptBtn();
        if (b) {
          b.click();
          continue;
        }
      }
      btn('btn-tick').click();
    }
    expect(rounds).toBeGreaterThan(0);
    // результат: збиття (боєготовий) або пошкодження → платний ремонт (−50)
    if (fighterText().includes('ремонт') || fighterText().includes('пошкоджений')) {
      // пошкоджений винищувач: авто-ремонт (HP 0) або кнопка «Ремонт (50)» (HP 1..3)
      const repairBtn = document.getElementById('btn-repair') as HTMLButtonElement | null;
      if (repairBtn && !repairBtn.disabled) repairBtn.click();
      expect(battleMoney).toBeGreaterThan(0);
      expect(fighterText()).toMatch(/ремонт: \d+ тік/);
      // критерій: ремонт оплачено — запис у журналі про списання
      expect($('log').textContent).toContain('оплачено');
      // під час ремонту нове перехоплення недоступне; тікаємо ремонт до кінця
      let ready = false;
      for (let i = 0; i < 40 && !ready; i++) {
        btn('btn-tick').click();
        ready = fighterText().includes('боєготовий');
      }
      expect(ready).toBe(true);
      expect(fighterText()).toContain('HP 4/4');
      expect($('log').textContent).toContain('Ремонт перехоплювача завершено');
    } else {
      expect(fighterText()).toContain('боєготовий');
      expect($('log').textContent).toContain('збитий');
    }
  });

  it('кнопка «Ремонт (50)» з’являється лише для пошкодженого винищувача', () => {
    startParty(); // чиста партія — здоровий винищувач
    expect(document.getElementById('btn-repair')).toBeNull(); // здоровий — кнопки немає
  });
});

// П7.5 (ADR-0026/0032): прев'ю UI повітряного бою — контекст-стрічка у фокусній зоні
// (видима лише під час погоні/бою), збереження вимкнене в повітряному бою.
describe('П7.5: повітряний бій — контекст-стрічка і збереження', () => {
  const fighterText = (): string => $('fighter').textContent ?? '';
  const interceptBtn = (): HTMLButtonElement | null => {
    for (const b of document.querySelectorAll<HTMLButtonElement>('button.intercept')) {
      if (!b.disabled) return b;
    }
    return null;
  };
  // Погоня/бій: клікаємо «Перехопити» при нагоді, тікаємо час до бою; guard — страховка від зависання.
  const pursueBattle = (maxTicks = 200): boolean => {
    for (let i = 0; i < maxTicks; i++) {
      if (fighterText().includes('Бій з')) return true;
      const b = interceptBtn();
      if (b) b.click();
      btn('btn-tick').click();
    }
    return fighterText().includes('Бій з');
  };

  it('контекст-стрічка прихована на геосцені, видима в погоню/бій, ховається після бою', () => {
    startParty();
    // на базі — прихована (джерело правди — панель «Винищувач» у колонці стану)
    expect($('ictx').classList.contains('hidden')).toBe(true);
    // запускаємо перехоплення: кнопка лише для виявленого НЛО в повітрі (критерій 1)
    let launched = false;
    for (let i = 0; i < 300 && !launched; i++) {
      const b = interceptBtn();
      if (b) {
        b.click();
        launched = fighterText().includes('погоня') || fighterText().includes('Бій з');
      }
      if (!launched) btn('btn-tick').click();
    }
    expect(launched).toBe(true);
    // погоня: стрічка видима, ціль відома
    expect($('ictx').classList.contains('hidden')).toBe(false);
    expect($('ictx-status').textContent).toMatch(/погоня|бій/);
    expect($('ictx-target').textContent).not.toBe('—');
    // збереження вимкнене в повітряному бою (ADR-0026, патерн П6.3)
    expect(btn('btn-save-1').disabled).toBe(true);
    // бій: раунд і HP обох сторін
    expect(pursueBattle()).toBe(true);
    expect($('ictx-round').textContent).toMatch(/^\d+$/);
    expect($('ictx-fighter').textContent).toContain('HP 4/4');
    expect($('ictx-ufo').textContent).toMatch(/HP \d+/);
    // Т.16: у бою час геосцени заморожено — кнопки вимкнені, а обробники
    // (виклик в обхід disabled) не рухають ні годинника, ні зондів, ні фінансів
    expect(btn('btn-tick').disabled).toBe(true);
    expect(btn('btn-day').disabled).toBe(true);
    const frozen = (): string[] => [$('clock').textContent, $('ufos').textContent, $('money').textContent, $('ictx').textContent];
    const before = frozen();
    btn('btn-tick').onclick!(new MouseEvent('click') as PointerEvent);
    btn('btn-day').onclick!(new MouseEvent('click') as PointerEvent);
    expect(frozen()).toEqual(before);
    // доводимо бій до результату — стрічка ховається, збереження повертається
    let guard = 0;
    while (guard++ < 6000 && fighterText().includes('Бій з')) {
      const choice = document.querySelector<HTMLButtonElement>('button.intercept-range[data-choice="впритул"]');
      if (!choice || choice.disabled) break;
      choice.click();
    }
    expect(fighterText()).not.toContain('Бій з');
    expect($('ictx').classList.contains('hidden')).toBe(true);
    expect(btn('btn-save-1').disabled).toBe(false);
    expect(btn('btn-tick').disabled).toBe(false); // Т.16: бій завершено — час знову йде
  });
});

describe('П8.3a: перемога кампанії — 30 діб → екран → «Грати далі» (endless), рахунок зафіксований', () => {
  it('підготовка: нова партія — екрана перемоги нема, кампанія «триває»', () => {
    startParty();
    expect($('clock').textContent).toBe('Д1 00:00');
    expect($('campaign-status').textContent).toBe('кампанія: триває');
    expect($('campaign-progress').textContent).toBe('Д1/30');
    expect($('campaign-victory').classList.contains('hidden')).toBe(true);
  });

  it('30 діб: настала доба 31 — екран перемоги з підсумковим рахунком', () => {
    for (let i = 0; i < 30; i++) passDay();
    expect($('clock').textContent).toBe('Д31 00:00');
    expect($('campaign-status').textContent).toBe('кампанія: перемога');
    expect($('campaign-victory').classList.contains('hidden')).toBe(false);
    expect($('campaign-score').textContent).toMatch(/^\d+$/); // рахунок зафіксовано на межі 30-ї доби (П8.2)
  }, 30_000); // Т.43: 1440 кліків «+1 тік» замість 30 кліків «+1 доба» — явний тайм-аут

  it('«Грати далі» (endless): екран зникає, час іде далі, рахунок не змінюється', () => {
    const score = $('campaign-score').textContent;
    btn('btn-continue').click();
    expect($('campaign-victory').classList.contains('hidden')).toBe(true);
    expect($('log').textContent).toContain('Партію продовжено');
    // партія жива після перемоги: тік часу працює, статус і рахунок зафіксовані (EARS Фази 8)
    passDay();
    expect($('clock').textContent).toBe('Д32 00:00');
    expect($('campaign-status').textContent).toBe('кампанія: перемога');
    expect($('campaign-score').textContent).toBe(score);
  });

  it('«Грати знов»: рестарт — нова кампанія «триває», екран приховано', () => {
    btn('btn-play-again').click();
    expect($('clock').textContent).toBe('Д1 00:00');
    expect($('campaign-status').textContent).toBe('кампанія: триває');
    expect($('campaign-victory').classList.contains('hidden')).toBe(true);
  });
});

// П11.6 (Фаза 11, ADR-0058/0013): критичний флоу «дослідити → виробити →
// екіпірувати → бойова дія» — суто через DOM реального застосунку (кнопки
// панелей, гарячі клавіші M/G, тап-тап бойовища). Детермінізм — сід 42,
// «норма»; час ганяємо кнопками доби/тіків, бій — фіксованими кліками.
describe('П11.6: критичний флоу «дослідити → виробити → екіпірувати → бойова дія» (ADR-0013)', () => {
  const key = (code: string): void => {
    document.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
  };
  const tap = (x: number, y: number): void => {
    $('battle').dispatchEvent(new MouseEvent('click', { clientX: x * 48 + 24, clientY: y * 48 + 24 }));
  };
  const researchDone = (id: string): boolean =>
    [...document.querySelectorAll('#research .sci-card')].some((r) => r.textContent!.includes(id) && r.textContent!.includes('завершено'));

  it('дослідити → виробити → екіпірувати → граната і лікування в бою', () => {
    // чиста партія: сід 42, «норма» (баланс 300, ростер 6)
    startParty();

    // 1. ДОСЛІДИТИ: 2 вчених, старт «аптечки» (каталог: індекс 2), доби до завершення
    btn('btn-hire-scientist').click();
    btn('btn-hire-scientist').click();
    btn('btn-start-2').click(); // «аптечка» — 80 (Т.19, ADR-0088): баланс 300−200−80
    expect($('money').textContent).toBe('20');
    let done = researchDone('Регенеративний гель');
    for (let i = 0; i < 60 && !done; i++) {
      btn('btn-day').click();
      done = researchDone('Регенеративний гель');
    }
    expect(done).toBe(true); // 2 вчені = 2 точки/добу → 16 діб

    // Т2 «осколкова граната» (передумова «аптечка» виконана) — ще 20 діб
    btn('btn-start-4').click();
    done = researchDone('Імпульсна граната');
    for (let i = 0; i < 60 && !done; i++) {
      btn('btn-day').click();
      done = researchDone('Імпульсна граната');
    }
    expect(done).toBe(true);

    // 2. ВИРОБИТИ: замовлення обох предметів; одна доба (48 тіків) покриває 12+16
    btn('btn-order-medkit').click();
    btn('btn-order-grenade').click();
    passDay();
    expect($('workshop').textContent).toContain('Регенеративний гель 1');
    expect($('workshop').textContent).toContain('Імпульсна граната 1');

    // 3. ЕКІПІРУВАТИ: s1 — граната, s2 — аптечка (перші дві картки ростеру)
    btn('btn-equip-s1-grenade').click();
    btn('btn-equip-s2-medkit').click();
    expect($('roster').textContent).toContain('граната ✓');
    expect($('roster').textContent).toContain('гель ✓');

    // 4. Місія: детерміновано чекаємо приземленого НЛО (сід 42) і висаджуємось
    let found = false;
    for (let i = 0; i < 1500 && !found; i++) {
      btn('btn-tick').click();
      found = document.querySelector('button.mission') !== null;
    }
    expect(found).toBe(true);
    (document.querySelector('button.mission') as HTMLButtonElement).click();
    expect($('battle-panel').classList.contains('hidden')).toBe(false);

    // 5. БОЙОВА ДІЯ: s1 у (2,2) — граната в скупчення (friendly fire ADR-0058 —
    // свідома ціна: після вибуху хтось із загону поранений), потім s2 (медик,
    // (3,2)) лікує пораненого тап-тапом (клавіша M)
    tap(2, 2); // вибір s1 — зона висадки SQUAD_SPAWN[0]
    expect($('binfo').textContent).toContain('AP 10/10');
    key('KeyG'); // зведення гранати (гаряча клавіша G — рішення власника)
    expect($('binfo').textContent).toContain('Граната');
    // валідний епіцентр: порожня клітинка з лінією кидка (клік по юніту — перевибір)
    const candidates: [number, number][] = [
      [4, 2],
      [3, 1],
      [3, 3],
      [2, 1],
      [1, 2],
      [4, 3],
      [2, 4],
    ];
    let thrown = false;
    for (const [ex, ey] of candidates) {
      key('KeyG'); // перевзводимо після невдалих спроб (режин міг скинутись вибором)
      tap(ex, ey);
      if ($('binfo').textContent.includes('Зона вибуху')) {
        tap(ex, ey); // повторний тап у ту саму клітинку — кидок
        thrown = true;
        break;
      }
    }
    expect(thrown).toBe(true);
    expect($('log').textContent).toContain('кидає гранату'); // журнал бою (ADR-0027)

    // медик s2: вибір, зведення аптечки (M), тап-тап по пораненому союзнику
    tap(3, 2); // вибір s2 — SQUAD_SPAWN[1]
    key('KeyM');
    expect($('binfo').textContent).toContain('Гель');
    const wounded: [number, number][] = [
      [2, 2],
      [2, 3],
      [3, 2],
    ]; // сусіди ≤1: s1, s3, соба
    let healed = false;
    for (const [tx, ty] of wounded) {
      key('KeyM');
      tap(tx, ty);
      if ($('binfo').textContent.includes('повторний клік')) {
        tap(tx, ty); // лікування
        healed = true;
        break;
      }
    }
    expect(healed).toBe(true);
    expect($('binfo').textContent).toContain('лікує');
    expect($('log').textContent).toContain('лікує');
  });
});

describe('П12.4: вкладки статус-колонки «Загін»/«База»/«Система» (ADR-0065)', () => {
  const colPanels = (): HTMLElement[] => Array.from(document.querySelectorAll('#status section.panel[data-tab]'));
  const visible = (p: HTMLElement): boolean => !p.classList.contains('hidden');
  const visibleTitles = (): string[] =>
    colPanels()
      .filter(visible)
      .map((p) => p.querySelector('h2')!.textContent ?? '');

  it('розмітка: скелет #status-tabs у колонці, 7 панелей з data-tab; «Загін» — фінанси/ростер, «База» — сканери/винищувач/дослідження/цех (рішення власника П12.4), «Система» — збереження', () => {
    const col = htmlRaw.match(/<aside id="status">[\s\S]*?<\/aside>/)![0];
    expect(col).toContain('<div id="status-tabs"></div>'); // скелет — контент генерує модуль
    expect((col.match(/data-tab="/g) ?? []).length).toBe(7); // усі панелі колонки розподілені
    const byTab = (tab: string): number =>
      (col.match(new RegExp('<section class="panel" data-tab="' + tab + '">[\\s\\S]*?</section>', 'g')) ?? []).length;
    expect(byTab('squad')).toBe(2); // фінанси + ростер (ADR-0065)
    expect(byTab('base')).toBe(4); // дослідження + цех (ADR-0065) + сканери + винищувач (рішення власника)
    expect(byTab('system')).toBe(1); // збереження (ADR-0065)
    // патерн стилю — як #log-tabs журналу; id кнопок — префікс status-tab- (урок П11.6)
    expect(htmlRaw).toContain('#status-tabs button.active');
    for (const t of ['squad', 'base', 'system']) {
      expect(document.getElementById('status-tab-' + t)).not.toBeNull(); // модуль згенерував кнопки
    }
  });

  it('флоу: перемикання вкладок показує всі 7 панелей, панелі лишаються в DOM, вибір персиститься поза сейвом', () => {
    startParty();
    expect(colPanels().length).toBe(7); // жодна панель не втрачена (критерій 1)
    btn('status-tab-squad').click();
    expect(visibleTitles()).toEqual(['Фінанси', 'Ростер загону']);
    btn('status-tab-base').click();
    expect(visibleTitles()).toEqual(['Сенсорна сітка (виявлені зонди)', 'Перехоплювач', 'Дослідження', 'Кузня']);
    // приховані панелі зберігають контент у DOM (контракти не послаблюються)
    expect($('roster').textContent).toContain('оперативник');
    expect($('money-card').textContent).not.toBe('');
    btn('status-tab-system').click();
    expect(visibleTitles()).toEqual(['Збереження']);
    expect(localStorage.getItem('rubezh.settings.status-tab')).toBe('system'); // ключ П12.3-формату
  });

  it('у бою колонка dimmed (П6.3 без змін), вкладки — у колонці; після бою dimmed знято', async () => {
    startParty();
    btn('status-tab-squad').click();
    let found = false;
    for (let i = 0; i < 1500 && !found; i++) {
      btn('btn-tick').click();
      found = document.querySelector('button.mission') !== null;
    }
    expect(found).toBe(true); // сід 42: місія детерміновано
    (document.querySelector('button.mission') as HTMLButtonElement).click();
    expect($('status').classList.contains('dimmed')).toBe(true); // чинний механізм П6.3
    expect($('status').contains($('status-tabs'))).toBe(true); // вкладки приглушуються разом з колонкою
    await runAutoBattle();
    btn('btn-close').click();
    expect($('status').classList.contains('dimmed')).toBe(false);
    expect(visibleTitles()).toEqual(['Фінанси', 'Ростер загону']); // вкладка «Загін» активна після бою
  });
  it('T.39: лічильник «Загін» — скільки предметів зі складу можна видати зараз; у бою — 0 (та сама умова, що й кнопки видачі в panels.ts)', async () => {
    startParty();
    expect(btn('status-tab-squad').querySelector('.tab-badge')).toBeNull(); // склад порожній
    btn('btn-save-1').click();
    const raw = JSON.parse(localStorage.getItem('rubezh.save.1')!) as { state: { workshop: { store: Record<string, number> } } };
    raw.state.workshop.store.medkit = 2;
    raw.state.workshop.store.armor = 1;
    localStorage.setItem('rubezh.save.1', JSON.stringify(raw));
    btn('btn-load-1').click();
    expect(btn('status-tab-squad').querySelector('.tab-badge')?.textContent).toBe('3'); // 2 гелі + 1 броня
    // у бою лічильник 0 — та сама умова (busy), що вимикає кнопки видачі спорядження в panels.ts
    let found = false;
    for (let i = 0; i < 1500 && !found; i++) {
      btn('btn-tick').click();
      found = document.querySelector('button.mission') !== null;
    }
    expect(found).toBe(true);
    (document.querySelector('button.mission') as HTMLButtonElement).click();
    expect($('status').classList.contains('dimmed')).toBe(true);
    expect(btn('status-tab-squad').querySelector('.tab-badge')).toBeNull(); // 0 — бейдж не показується
    await runAutoBattle();
    btn('btn-close').click();
  });
});

describe('П12.5: зрозумілість розвитку — числові ефекти до дії (ADR-0065)', () => {
  const rowText = (root: string, name: string): string =>
    Array.from(document.querySelectorAll('#' + root + ' .ufo, #' + root + ' .sci-card'))
      .map((r) => r.textContent ?? '')
      .find((t) => t.includes(name)) ?? '';

  it('флоу: вкладка «База» — ефекти протоколів видимі ДО старту (критерії 1–2)', () => {
    startParty();
    btn('status-tab-base').click();
    btn('btn-save-1').click(); // сейв — беремо реальні характеристики першого солдата
    const s0 = (
      JSON.parse(localStorage.getItem('rubezh.save.1')!).state as { roster: { soldiers: { maxHp: number; firingAccuracy: number }[] } }
    ).roster.soldiers[0];
    // дослідження: кожен протокол картки — числовий ефект до старту
    expect(rowText('research', 'Композитна броня')).toContain(
      'Оперативник у броні має ' + (s0.maxHp + ARMOR_MAX_HP_BONUS) + ' HP замість ' + s0.maxHp
    ); // T.39: простий текст, «замість» від першого солдата
    expect(rowText('research', 'Кібернетичне око')).toContain(
      'Точність оперативника з оком — ' +
        Math.round(Math.min(HIT_CHANCE_CAP, s0.firingAccuracy + OPTICS_ACCURACY_BONUS) * 100) +
        ' % замість ' +
        Math.round(s0.firingAccuracy * 100) +
        ' %'
    );
    expect(rowText('research', 'Регенеративний гель')).toContain('Лікує ' + HEAL_AMOUNT + ' HP');
    expect(rowText('research', 'Імпульсна граната')).toContain('Пошкодження ' + GRENADE_DAMAGE[0] + '–' + GRENADE_DAMAGE[1]);
    expect(rowText('research', 'Імпульсна граната')).toContain('зачіпає і своїх');
    expect(rowText('research', 'Розширення лабораторії')).toContain('протоколи в роботі одночасно замість');
    expect(rowText('research', 'Гарматний модуль перехоплювача')).toContain('на ' + GUN_MODULE_DAMAGE + ' пошкодження більше за раунд');
    // T.39: жоден проєкт не запущено — плашка «у роботі» немає (ефекти самі «до дії»)
    expect(document.querySelectorAll('#research .sci-badge.run')).toHaveLength(0);
  });

  it('флоу: вкладка «База» — ефекти предметів цеху видимі ДО замовлення (критерії 1–2)', () => {
    startParty();
    btn('status-tab-base').click();
    // цех: кожен предмет — числовий ефект до замовлення; гейт дослідження вимкнений
    expect(rowText('workshop', 'Композитна броня')).toContain('+' + ARMOR_MAX_HP_BONUS + ' макс. HP');
    expect(rowText('workshop', 'Регенеративний гель')).toContain('+' + HEAL_AMOUNT + ' HP');
    expect(rowText('workshop', 'Імпульсна граната')).toContain('уражає і своїх');
    expect(rowText('workshop', 'Імпульсна граната')).toContain('по одній на місію');
    expect(rowText('workshop', 'Гарматний модуль перехоплювача')).toContain(
      '+' + GUN_MODULE_DAMAGE + ' пошкодження за раунд повітряного бою'
    );
    expect(btn('btn-order-medkit').disabled).toBe(true); // ще не досліджено — ефект усе одно показано
  });
});

describe('Т.43: «До події», зупинки «+1 доба» і пробіл', () => {
  const clock = (): string | null => $('clock').textContent;
  const ufoCount = (): number => document.querySelectorAll('#ufos .ufo').length;
  // повертає defaultPrevented: істина лише для пробілу, що зрушив час
  const space = (target: EventTarget = document): boolean => {
    const ev = new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true });
    target.dispatchEvent(ev);
    return ev.defaultPrevented;
  };
  let firstDetection: string | null = null;

  it('еталон: кліками «+1 тік» до першого виявлення зонда (сід 42)', () => {
    startParty();
    for (let i = 0; i < 48 && ufoCount() === 0; i++) btn('btn-tick').click();
    expect(ufoCount()).toBe(1);
    firstDetection = clock();
    expect(firstDetection).toBe('Д1 09:30');
  });

  it('«До події» з нової партії стає на тому самому тіку, що й еталон', () => {
    startParty();
    expect(btn('btn-event').disabled).toBe(false);
    expect(btn('btn-event').textContent).toBe('До події');
    expect(btn('btn-event').title).toBe('Час іде до першої події, найдовше 1 добу (пробіл)');
    btn('btn-event').click();
    expect(clock()).toBe(firstDetection);
    expect(ufoCount()).toBe(1);
  });

  it('пробіл на геосцені — те саме, що клік «До події»', () => {
    startParty();
    expect(space()).toBe(true); // preventDefault — сторінка не прокручується
    expect(clock()).toBe(firstDetection);
  });

  it('пробіл із поля вводу не діє; з фокусом на кнопці — «До події», а не ця кнопка (фокус знято)', () => {
    startParty();
    const before = clock();
    expect(space($('new-game-seed'))).toBe(false);
    expect(clock()).toBe(before);
    btn('btn-tick').focus();
    expect(document.activeElement).toBe(btn('btn-tick'));
    expect(space(btn('btn-tick'))).toBe(true);
    expect(clock()).toBe(firstDetection); // не +30 хв від «+1 тік»
    expect(document.activeElement).not.toBe(btn('btn-tick'));
  });

  it.each(['help-screen', 'game-menu', 'settings-dialog', 'new-game-dialog', 'exit-confirm', 'campaign-victory'])(
    'пробіл не діє під відкритим вікном #%s',
    (id) => {
      startParty();
      const before = clock();
      $(id).classList.remove('hidden');
      expect(space()).toBe(false);
      expect(clock()).toBe(before);
      $(id).classList.add('hidden');
      expect(space()).toBe(true);
      expect(clock()).toBe(firstDetection);
    }
  );

  it('пробіл не діє на стартовому екрані після виходу з гри', () => {
    startParty();
    btn('btn-menu').click();
    btn('btn-menu-exit').click();
    if (!$('exit-confirm').classList.contains('hidden')) btn('btn-exit-yes').click();
    expect($('start-screen').classList.contains('hidden')).toBe(false);
    expect(space()).toBe(false);
    expect(clock()).toBe('Д1 00:00');
  });

  it('одужання зупиняє «До події», але не «+1 доба» (поранений через правку сейва)', () => {
    startParty();
    btn('btn-save-1').click();
    const save = JSON.parse(localStorage.getItem('rubezh.save.1')!) as {
      state: { roster: { soldiers: { id: string }[]; hospital: Record<string, number> } };
    };
    save.state.roster.hospital[save.state.roster.soldiers[0].id] = 2; // одужає за 2 тіки
    localStorage.setItem('rubezh.save.1', JSON.stringify(save));
    btn('btn-load-1').click();
    expect($('ready').textContent).toBe('5/6');
    btn('btn-event').click();
    expect(clock()).toBe('Д1 01:00');
    expect($('ready').textContent).toBe('6/6');
    btn('btn-load-1').click();
    btn('btn-day').click();
    expect(clock()).toBe(firstDetection);
  });

  it('рядок «Наступний крок»: час → зонд у повітрі → зонд приземлився; у бою прихований', () => {
    startParty();
    const step = $('next-step');
    expect(step.classList.contains('hidden')).toBe(false);
    expect(step.textContent).toBe('Наступний крок: рухайте час — сенсорна сітка шукає зонди');
    btn('btn-event').click(); // Д1 09:30 — зонд виявлено в повітрі
    expect(step.textContent).toBe('Наступний крок: зонд у повітрі — перехопіть або чекайте приземлення');
    btn('btn-event').click(); // Д1 11:00 — приземлився
    const win = /вікно ([\d.]+) год/.exec(document.querySelector('#ufos .ufo')!.textContent)![1];
    expect(step.textContent).toBe('Наступний крок: зонд приземлився — запустіть місію (вікно ' + win + ' год)');
    document.querySelector<HTMLButtonElement>('button.mission')!.click();
    expect(step.classList.contains('hidden')).toBe(true);
    expect(step.textContent).toBe('');
  });

  it('у бою «До події» неактивна, пробіл і клік в обхід disabled часу не рухають', () => {
    startParty();
    let launched = false;
    for (let i = 0; i < 1500 && !launched; i++) {
      const m = document.querySelector<HTMLButtonElement>('button.mission');
      if (m && !m.disabled) {
        m.click();
        launched = true;
      } else btn('btn-tick').click();
    }
    expect(launched).toBe(true);
    expect(btn('btn-event').disabled).toBe(true);
    const before = clock();
    expect(space()).toBe(false);
    btn('btn-event').onclick!(new MouseEvent('click') as PointerEvent);
    expect(clock()).toBe(before);
  });
});

// Т.51: рядок #fighter-last має зникати, коли зонд події (приземлився → ufo_left) вже не в geo.ufos.
describe('Т.51: переривання перехоплення при приземленні зонда — журнал і панель #fighter-last', () => {
  it('сід 42, пресет «норма»: ufo1 виявлено, старт перехоплення, abort (ufo_landed); після ufo_left рядка немає', () => {
    startParty();
    const interceptBtn = (): HTMLButtonElement | null => {
      for (const b of document.querySelectorAll<HTMLButtonElement>('button.intercept')) {
        if (!b.disabled) return b;
      }
      return null;
    };
    // 1. тикаємо, доки не з'явиться активна кнопка button.intercept (запобіжник — 60 кліків), і клікаємо її
    let launched = false;
    for (let i = 0; i < 60 && !launched; i++) {
      const b = interceptBtn();
      if (b) {
        b.click();
        launched = true;
      } else {
        btn('btn-tick').click();
      }
    }
    expect(launched).toBe(true);
    // 2. тикаємо, доки не з'явиться #fighter-last (запобіжник — 10 кліків)
    let shown = false;
    for (let i = 0; i < 10 && !shown; i++) {
      btn('btn-tick').click();
      shown = document.getElementById('fighter-last') !== null;
    }
    expect(shown).toBe(true);
    // 3. текст #fighter-last — точно рядок журналу про abort; у #log такий самий рядок, «зник з трекінгу» ще немає
    const abortedText = '✦ Зонд Розриву ufo1 приземлився — перехоплення перервано';
    const leftText = 'Зонд Розриву ufo1 відлетів і зник';
    expect($('fighter-last').textContent).toBe(abortedText);
    expect($('log').textContent ?? '').toContain(abortedText);
    expect($('log').textContent ?? '').not.toContain(leftText);
    expect($('log').textContent ?? '').not.toContain('зник з трекінгу');
    // 4. тикаємо, доки в #log не з'явиться рядок ufo_left (запобіжник — 400 кліків)
    let left = false;
    for (let i = 0; i < 400 && !left; i++) {
      btn('btn-tick').click();
      left = ($('log').textContent ?? '').includes(leftText);
    }
    expect(left).toBe(true);
    // 5. зонд ufo1 вже не в geo.ufos — елемента #fighter-last немає
    expect(document.getElementById('fighter-last')).toBeNull();
  });
});

// Т.53 (висновок аудиту PR #348, Т.48; план — docs/plans/t53-menu-auto-battle.md, Т.52/PR #352): меню і «Як грати»
// поверх бою зупиняють авто-бій, як плитка «Стоп» (рішення власника 16.11.2026 «Зупиняти»).
describe('Т.53: меню і «Як грати» зупиняють авто-бій', () => {
  const cap = (): string => (document.querySelector('#btn-auto-battle .tb-cap') as HTMLElement | null)?.textContent ?? '';

  it('Т.53: клік «Меню» і «?» під час авто-бою зупиняє авто-бій: плитка «Авто», таймерів 0, журнал стоїть', async () => {
    // 1. сід 27, пресет «норма»: кнопка місії з'являється, коли годинник показує «Д1 09:00»
    startParty('27');
    for (let i = 0; i < 1500 && document.querySelector('button.mission') === null; i++) btn('btn-tick').click();
    (document.querySelector('button.mission') as HTMLButtonElement).click();
    expect($('battle-panel').classList.contains('hidden')).toBe(false);
    // 2. фейк-таймери — як у блоці Т.48
    vi.useFakeTimers(PAGE_FAKE_TIMERS);
    try {
      // 3. авто-бій справді запущений
      btn('btn-auto-battle').click();
      await vi.advanceTimersByTimeAsync(AUTO_STEP_MS * 3);
      expect(cap()).toBe('Стоп');
      // 4. «Меню» зупиняє авто-бій і відкриває вікно
      btn('btn-menu').click();
      expect($('game-menu').classList.contains('hidden')).toBe(false);
      expect(cap()).toBe('Авто');
      expect(vi.getTimerCount()).toBe(0);
      // 5. журнал не йде далі, поки вікно відкрите
      const logBefore = $('log').textContent;
      await vi.advanceTimersByTimeAsync(AUTO_STEP_MS * 50);
      expect($('log').textContent).toBe(logBefore);
      // 6. закрили меню — авто-бій не поновлюється, бій не завершується
      btn('btn-menu-close').click();
      await vi.advanceTimersByTimeAsync(AUTO_STEP_MS * 50);
      expect($('log').textContent).toBe(logBefore);
      expect($('bresult').textContent).toBe('');
      // 7. знову «Авто» — авто-бій поновлюється (таймер є, плитка «Стоп», журнал іде)
      btn('btn-auto-battle').click();
      await vi.advanceTimersByTimeAsync(AUTO_STEP_MS * 3);
      expect(cap()).toBe('Стоп');
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      expect($('log').textContent).not.toBe(logBefore);
      // 8. «?» («Як грати») теж зупиняє авто-бій
      btn('btn-help').click();
      expect($('help-screen').classList.contains('hidden')).toBe(false);
      expect(cap()).toBe('Авто');
      expect(vi.getTimerCount()).toBe(0);
      btn('btn-help-close').click();
    } finally {
      vi.useRealTimers();
    }
    // 9. без авто-бою меню не чіпає binfo
    const binfoBefore = $('binfo').textContent;
    btn('btn-menu').click();
    btn('btn-menu-close').click();
    expect($('binfo').textContent).toBe(binfoBefore);
  });
});

// Т.55 (висновки аудитів PR #353, Т.53; план — docs/plans/t55-tests-after-t53.md): тести тримають перевірку
// `busy` у `stopAutoForWindow` і зупинку авто-бою на шляху до вікон «Налаштування» та «Незбережені зміни».
describe('Т.55: тести після Т.53 — меню без авто-бою і вікна з меню', () => {
  const cap = (): string => (document.querySelector('#btn-auto-battle .tb-cap') as HTMLElement | null)?.textContent ?? '';

  it('Т.55: «Меню» і «?» у ручному бою не перемальовують бій', () => {
    // 1. сід 27, пресет «норма»: бій без авто-бою
    startParty('27');
    for (let i = 0; i < 1500 && document.querySelector('button.mission') === null; i++) btn('btn-tick').click();
    (document.querySelector('button.mission') as HTMLButtonElement).click();
    expect($('battle-panel').classList.contains('hidden')).toBe(false);
    expect(cap()).toBe('Авто');
    // 2. «Меню» без авто-бою: жодної операції на канві
    const opsBeforeMenu = canvasOps.length;
    btn('btn-menu').click();
    expect($('game-menu').classList.contains('hidden')).toBe(false);
    expect(canvasOps.length).toBe(opsBeforeMenu);
    btn('btn-menu-close').click();
    // 3. «?» без авто-бою: так само
    const opsBeforeHelp = canvasOps.length;
    btn('btn-help').click();
    expect($('help-screen').classList.contains('hidden')).toBe(false);
    expect(canvasOps.length).toBe(opsBeforeHelp);
    btn('btn-help-close').click();
  });

  it('Т.55: «Налаштування» і «Незбережені зміни» відкриваються з меню вже після зупинки авто-бою', async () => {
    // 1. бій з попереднього тесту триває; фейк-таймери — як у блоці Т.53
    expect($('battle-panel').classList.contains('hidden')).toBe(false);
    vi.useFakeTimers(PAGE_FAKE_TIMERS);
    try {
      // 2. авто-бій запущений
      btn('btn-auto-battle').click();
      await vi.advanceTimersByTimeAsync(AUTO_STEP_MS * 3);
      expect(cap()).toBe('Стоп');
      // 3. «Меню» → «Налаштування»: вікно відкрите, авто-бій стоїть
      btn('btn-menu').click();
      btn('btn-menu-settings').click();
      expect($('settings-dialog').classList.contains('hidden')).toBe(false);
      expect($('game-menu').classList.contains('hidden')).toBe(true);
      expect(cap()).toBe('Авто');
      expect(vi.getTimerCount()).toBe(0);
      const logSettings = $('log').textContent;
      await vi.advanceTimersByTimeAsync(AUTO_STEP_MS * 50);
      expect($('log').textContent).toBe(logSettings);
      btn('settings-close').click();
      // 4. знову авто-бій
      btn('btn-auto-battle').click();
      await vi.advanceTimersByTimeAsync(AUTO_STEP_MS * 3);
      expect(cap()).toBe('Стоп');
      expect($('log').textContent).not.toBe(logSettings);
      // 5. «Меню» → «На стартовий екран»: вікно «Незбережені зміни», авто-бій стоїть
      btn('btn-menu').click();
      btn('btn-menu-exit').click();
      expect($('exit-confirm').classList.contains('hidden')).toBe(false);
      expect($('exit-confirm').querySelector('h2')?.textContent).toBe('Незбережені зміни');
      expect(cap()).toBe('Авто');
      expect(vi.getTimerCount()).toBe(0);
      const logExit = $('log').textContent;
      await vi.advanceTimersByTimeAsync(AUTO_STEP_MS * 50);
      expect($('log').textContent).toBe(logExit);
      // 6. «Скасувати»: бій на місці, авто-бій не поновлюється
      btn('btn-exit-no').click();
      expect($('exit-confirm').classList.contains('hidden')).toBe(true);
      expect($('battle-panel').classList.contains('hidden')).toBe(false);
      await vi.advanceTimersByTimeAsync(AUTO_STEP_MS * 50);
      expect($('log').textContent).toBe(logExit);
      expect($('bresult').textContent).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });
});

// Т.58 (кандидат 54, решта після Т.48; план — docs/plans/t58-after-exit-to-start.md): пояснення невдалого
// «Продовжити» і вихід з екрана перемоги (рішення власника 17.11.2026). Останній блок файла.
describe('Т.58: стартовий екран після невдалого «Продовжити» і вихід з екрана перемоги', () => {
  const hidden = (id: string): boolean => $(id).classList.contains('hidden');
  // нова партія, один тік, сейв у слот 1 — єдиний, отже останній активний
  const freshSave = (): string => {
    btn('btn-del-2').click();
    btn('btn-del-3').click();
    startParty('27');
    btn('btn-tick').click();
    btn('btn-save-1').click();
    return localStorage.getItem('rubezh.save.1') as string;
  };
  const exitViaMenu = (): void => {
    btn('btn-menu').click();
    btn('btn-menu-exit').click();
    expect(hidden('exit-confirm')).toBe(true); // після сейву чи завантаження втрачати нічого
    expect(hidden('start-screen')).toBe(false);
  };

  it('Т.58: невдале «Продовжити» — рядок-пояснення на стартовому екрані; наступний показ екрана його прибирає', () => {
    const good = freshSave();
    exitViaMenu();
    expect(hidden('start-note')).toBe(true);
    const bad = JSON.parse(good) as { state: { geo: { ufos: unknown } } };
    bad.state.geo.ufos = [null]; // метадані читаються (слот лишається останнім), розбір партії падає
    localStorage.setItem('rubezh.save.1', JSON.stringify(bad));
    try {
      btn('btn-start-continue').click();
      expect(hidden('start-screen')).toBe(false);
      expect(hidden('start-note')).toBe(false);
      expect($('start-note').textContent).toBe('Не вдалося завантажити збереження. Почніть нову гру.');
    } finally {
      localStorage.setItem('rubezh.save.1', good);
    }
    btn('btn-start-continue').click(); // цілий слот вантажиться
    expect(hidden('start-screen')).toBe(true);
    exitViaMenu();
    expect(hidden('start-note')).toBe(true);
    expect($('start-note').textContent).toBe('');
  });

  it('Т.58: «На стартовий екран» на екрані перемоги — вихід, з незбереженою дією через підтвердження; екран перемоги поверх стартового не лишається', () => {
    const good = freshSave();
    const won = JSON.parse(good) as { state: { campaign: { status: string } } };
    won.state.campaign.status = 'перемога';
    localStorage.setItem('rubezh.save.1', JSON.stringify(won));
    try {
      btn('btn-load-1').click();
      expect(hidden('campaign-victory')).toBe(false);
      expect(btn('btn-victory-exit').textContent).toBe('На стартовий екран');
      btn('btn-victory-exit').click(); // одразу після завантаження незбережених дій немає
      expect(hidden('exit-confirm')).toBe(true);
      expect(hidden('start-screen')).toBe(false);
      expect(hidden('campaign-victory')).toBe(true);
      // невдале «Продовжити» перемальовує панелі покинутої партії — екран перемоги не повертається
      const bad = JSON.parse(good) as { state: { geo: { ufos: unknown } } };
      bad.state.geo.ufos = [null];
      localStorage.setItem('rubezh.save.1', JSON.stringify(bad));
      btn('btn-start-continue').click();
      expect(hidden('start-note')).toBe(false);
      expect(hidden('campaign-victory')).toBe(true);
      localStorage.setItem('rubezh.save.1', JSON.stringify(won));
      btn('btn-start-continue').click(); // сейв із перемогою — екран перемоги знову показано
      expect(hidden('start-screen')).toBe(true);
      expect(hidden('campaign-victory')).toBe(false);
      btn('btn-tick').click(); // незбережена дія
      btn('btn-victory-exit').click();
      expect(hidden('exit-confirm')).toBe(false);
      expect(hidden('start-screen')).toBe(true);
      btn('btn-exit-no').click(); // «Скасувати» — лишаємось на екрані перемоги
      expect(hidden('campaign-victory')).toBe(false);
      btn('btn-victory-exit').click();
      btn('btn-exit-yes').click();
      expect(hidden('start-screen')).toBe(false);
      expect(hidden('campaign-victory')).toBe(true);
    } finally {
      localStorage.setItem('rubezh.save.1', good);
    }
  });
});

// Т.64 (кандидат 60, після Т.53; план — docs/plans/t64-auto-battle-close.md): з Т.53 клік «Меню» зупиняє
// авто-бій раніше, ніж battle.close, тож зупинку в battle.close на сторінці тримають лише ці тести —
// кнопки виходу і нової партії клікаються без кліку «Меню»: гравець так не може, зате так видно саму зупинку
// в battle.close і її зв'язок у src/main.ts (stopAuto: () => autoBattle.stop()).
describe('Т.64: зупинка авто-бою в battle.close на сторінці', () => {
  const cap = (): string => (document.querySelector('#btn-auto-battle .tb-cap') as HTMLElement | null)?.textContent ?? '';
  // сід 27, пресет «норма»: місія, авто-бій справді йде (плитка «Стоп», таймер є)
  const launchAuto = async (): Promise<void> => {
    startParty('27');
    for (let i = 0; i < 1500 && document.querySelector('button.mission') === null; i++) btn('btn-tick').click();
    (document.querySelector('button.mission') as HTMLButtonElement).click();
    expect($('battle-panel').classList.contains('hidden')).toBe(false);
    btn('btn-auto-battle').click();
    await vi.advanceTimersByTimeAsync(AUTO_STEP_MS * 3);
    expect(cap()).toBe('Стоп');
    expect(vi.getTimerCount()).toBeGreaterThan(0);
  };

  it('Т.64: вихід на стартовий екран без кліку «Меню» — авто-бій зупиняє battle.close', async () => {
    vi.useFakeTimers(PAGE_FAKE_TIMERS);
    try {
      await launchAuto();
      btn('btn-menu-exit').click(); // вікно «Меню» не відкривали — stopAutoForWindow не викликано
      expect($('exit-confirm').classList.contains('hidden')).toBe(false); // після запуску місії є незбережені дії
      expect(cap()).toBe('Стоп'); // вікно підтвердження авто-бій не зупиняє
      btn('btn-exit-yes').click(); // exitToStart → battle.close
      expect($('start-screen').classList.contains('hidden')).toBe(false);
      expect(vi.getTimerCount()).toBe(0); // таймер паузи авто-бою знято
      const logBefore = $('log').textContent;
      await vi.advanceTimersByTimeAsync(AUTO_STEP_MS * 6000);
      expect($('log').textContent).toBe(logBefore); // жодної дії бою після виходу
      expect($('bresult').innerHTML).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });

  it('Т.64: нова партія під час авто-бою — авто-бій зупиняє battle.close', async () => {
    vi.useFakeTimers(PAGE_FAKE_TIMERS);
    try {
      await launchAuto();
      startParty('42'); // startNewParty → battle.close
      expect($('battle-panel').classList.contains('hidden')).toBe(true);
      expect($('clock').textContent).toBe('Д1 00:00'); // нова партія з нуля, а не покинута
      expect(vi.getTimerCount()).toBe(0); // таймер паузи авто-бою знято
      const logBefore = $('log').textContent;
      await vi.advanceTimersByTimeAsync(AUTO_STEP_MS * 6000);
      expect($('log').textContent).toBe(logBefore); // жодної дії бою покинутої партії
      expect($('bresult').innerHTML).toBe('');
      // стан драйвера теж скинуто, а не лише таймер: у наступному бою плитка — «Авто», а не «Стоп»
      for (let i = 0; i < 1500 && document.querySelector('button.mission') === null; i++) btn('btn-tick').click();
      (document.querySelector('button.mission') as HTMLButtonElement).click();
      expect($('battle-panel').classList.contains('hidden')).toBe(false);
      expect(cap()).toBe('Авто');
    } finally {
      vi.useRealTimers();
    }
  });
});

// Т.66 (кандидат 55, після Т.51; план — docs/plans/t66-fighter-last-mission.md): рядок #fighter-last
// після перерваного перехоплення (зонд приземлився) зникає, коли місію на цьому зонді виграно, — зонда
// вже немає в geo.ufos (completeMission), хоча відліт ufo_left так і не настав. Досі це тримав лише тест модуля.
describe('Т.66: рядок #fighter-last зникає після виграної місії', () => {
  it('Т.66: сід 42, пресет «норма»: перехоплення ufo1 перервано приземленням, місію на ufo1 виграно — рядка немає', async () => {
    startParty();
    // 1. тикаємо, доки не з'явиться активна кнопка перехоплення (запобіжник — 60 кліків), і клікаємо її
    let launched = false;
    for (let i = 0; i < 60 && !launched; i++) {
      const b = [...document.querySelectorAll<HTMLButtonElement>('button.intercept')].find((x) => !x.disabled);
      if (b) {
        b.click();
        launched = true;
      } else btn('btn-tick').click();
    }
    expect(launched).toBe(true);
    // 2. тикаємо, доки не з'явиться #fighter-last (запобіжник — 10 кліків): зонд приземлився під час погоні
    for (let i = 0; i < 10 && document.getElementById('fighter-last') === null; i++) btn('btn-tick').click();
    const abortedText = '✦ Зонд Розриву ufo1 приземлився — перехоплення перервано';
    expect(document.getElementById('fighter-last')?.textContent).toBe(abortedText);
    // у списку зондів — один зонд (ufo1; назв зондів список не показує) з кнопкою місії
    expect(document.querySelectorAll('#ufos .ufo')).toHaveLength(1);
    // 3. місія на ufo1 — одразу, без жодного тіку: відліт ufo_left не настає
    const mission = document.querySelector<HTMLButtonElement>('#ufos .ufo button.mission');
    expect(mission).not.toBeNull();
    expect(mission!.disabled).toBe(false);
    mission!.click();
    expect($('battle-panel').classList.contains('hidden')).toBe(false);
    // 4. авто-бій до результату — перемога (сід 42)
    await runAutoBattle();
    expect($('bresult').textContent).toContain('ЗАЧИЩЕНО');
    // 5. уже на картці результату (finish перемальовує панелі): зонда в списку немає, рядка немає — ні елемента, ні тексту
    expect(document.querySelectorAll('#ufos .ufo')).toHaveLength(0);
    expect(document.getElementById('fighter-last')).toBeNull();
    expect($('fighter').textContent ?? '').not.toContain(abortedText);
    // 6. назад на геосцену: те саме, а в журналі рядок про переривання лишився, рядка про відліт немає
    btn('btn-close').click();
    expect($('geo-panel').classList.contains('hidden')).toBe(false);
    expect(document.querySelectorAll('#ufos .ufo')).toHaveLength(0);
    expect($('log').textContent ?? '').not.toContain('Зонд Розриву ufo1 відлетів і зник');
    expect($('log').textContent ?? '').toContain(abortedText);
    expect(document.getElementById('fighter-last')).toBeNull();
    expect($('fighter').textContent ?? '').not.toContain(abortedText);
  });
});

// Т.69 (кандидат 55, після Т.66; план — docs/plans/t69-fighter-last-lost.md): рядок #fighter-last
// після перерваного перехоплення (зонд приземлився) лишається, коли місію на цьому зонді програно, — зонд
// лишається в geo.ufos (completeMission). Виграну місію тримає тест Т.66; евакуйованої зі сторінки не досягти.
describe('Т.69: рядок #fighter-last лишається після програної місії', () => {
  it('Т.69: сід 36, пресет «складний»: перехоплення ufo1 перервано приземленням, місію на ufo1 програно — рядок лишається', async () => {
    startParty('36', 'складний');
    // 1. тикаємо, доки не з'явиться активна кнопка перехоплення (запобіжник — 60 кліків), і клікаємо її
    let launched = false;
    for (let i = 0; i < 60 && !launched; i++) {
      const b = [...document.querySelectorAll<HTMLButtonElement>('button.intercept')].find((x) => !x.disabled);
      if (b) {
        b.click();
        launched = true;
      } else btn('btn-tick').click();
    }
    expect(launched).toBe(true);
    // 2. тикаємо, доки не з'явиться #fighter-last (запобіжник — 10 кліків): зонд приземлився під час погоні
    for (let i = 0; i < 10 && document.getElementById('fighter-last') === null; i++) btn('btn-tick').click();
    const abortedText = '✦ Зонд Розриву ufo1 приземлився — перехоплення перервано';
    expect(document.getElementById('fighter-last')?.textContent).toBe(abortedText);
    // 3. місія на ufo1 — одразу, без жодного тіку
    const mission = document.querySelector<HTMLButtonElement>('#ufos .ufo button.mission');
    expect(mission).not.toBeNull();
    expect(mission!.disabled).toBe(false);
    mission!.click();
    expect($('battle-panel').classList.contains('hidden')).toBe(false);
    // 4. авто-бій до результату — поразка (сід 36, пресет «складний»)
    await runAutoBattle();
    expect($('bresult').textContent).toContain('ЗАГІН ВТРАЧЕНО');
    // 5. уже на картці результату (finish перемальовує панелі): зонд лишився в списку, рядок на панелі — той самий, один
    expect(document.querySelectorAll('#ufos .ufo')).toHaveLength(1);
    expect(document.querySelectorAll('#fighter-last')).toHaveLength(1);
    expect(document.getElementById('fighter-last')?.textContent).toBe(abortedText);
    // 6. назад на геосцену: зонд у списку, місію можна повторити, рядок на панелі лишився
    btn('btn-close').click();
    expect($('geo-panel').classList.contains('hidden')).toBe(false);
    expect(document.querySelectorAll('#ufos .ufo button.mission')).toHaveLength(1);
    expect(document.getElementById('fighter-last')?.textContent).toBe(abortedText);
  });
});

// Т.78 (кандидат 55, після Т.66 і Т.69): рядок #fighter-last лишається після евакуації місії —
// при outcome 'евакуацияно' completeMission не прибирає зонд з geo.ufos, тому рядок не зникає (на відміну від перемоги, Т.66).
describe('кандидат 55: рядок #fighter-last лишається після евакуації місії', () => {
  it('кандидат 55: сід 42, пресет «норма»: місія без тіків, евакуація трьох оперативників — рядок лишається', () => {
    startParty('42');
    // 1. кроки 1–2 Т.66: intercept → запуск перехоплення (запобіжник — 60 кліків), потім тики до #fighter-last (10 кліків)
    let launched = false;
    for (let i = 0; i < 60 && !launched; i++) {
      const b = [...document.querySelectorAll<HTMLButtonElement>('button.intercept')].find((x) => !x.disabled);
      if (b) {
        b.click();
        launched = true;
      } else btn('btn-tick').click();
    }
    expect(launched).toBe(true);
    for (let i = 0; i < 10 && document.getElementById('fighter-last') === null; i++) btn('btn-tick').click();
    const abortedText = '✦ Зонд Розриву ufo1 приземлився — перехоплення перервано';
    expect(document.getElementById('fighter-last')?.textContent).toBe(abortedText);
    // 2. місія на ufo1 без тіків; поки бойова панель видима (#battle-panel видно) — #fighter-last є, з тим самим текстом
    const mission = document.querySelector<HTMLButtonElement>('#ufos .ufo button.mission');
    expect(mission).not.toBeNull();
    expect(mission!.disabled).toBe(false);
    mission!.click();
    expect($('battle-panel').classList.contains('hidden')).toBe(false);
    expect(document.querySelectorAll('#fighter-last')).toHaveLength(1);
    expect(document.getElementById('fighter-last')?.textContent).toBe(abortedText);
    // 3. евакуація всіх трьох оперативників як у Т.71: тап (2,2), (3,2), (2,3), далі клавіша V; наприкінці — btn-evac-yes
    for (const [x, y] of [
      [2, 2],
      [3, 2],
      [2, 3],
    ] as const) {
      $('battle').dispatchEvent(new MouseEvent('click', { clientX: x * 48 + 24, clientY: y * 48 + 24 }));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', code: 'KeyV', bubbles: true }));
    }
    btn('btn-evac-yes').click();
    expect($('bresult').textContent).toContain('ЗАГІН ЕВАКУЙОВАНО — врятовані на базі, зонд Розриву лишається активним');
    // 4. картка результату: у #ufos .ufo — один зонд; #fighter-last — один, з тим самим текстом
    expect(document.querySelectorAll('#ufos .ufo')).toHaveLength(1);
    expect(document.querySelectorAll('#fighter-last')).toHaveLength(1);
    expect(document.getElementById('fighter-last')?.textContent).toBe(abortedText);
    // 5. btn-close → геосцена: кнопка місії одна (#ufos .ufo button.mission — одна), #fighter-last з тим самим текстом
    btn('btn-close').click();
    expect($('geo-panel').classList.contains('hidden')).toBe(false);
    expect(document.querySelectorAll('#ufos .ufo button.mission')).toHaveLength(1);
    expect(document.querySelectorAll('#fighter-last')).toHaveLength(1);
    expect(document.getElementById('fighter-last')?.textContent).toBe(abortedText);
  });
});

// Т.71 (ADR-0075, рішення власника 18.11.2026): вікно підтвердження евакуації останнього оперативника на сторінці.
describe('Т.71: евакуація на сторінці — плитка, клавіша V і вікно підтвердження', () => {
  it('Т.71: сід 42, пресет «норма»: загін покидає поле з синіх клітинок; останнього — через вікно, «Скасувати» його лишає', () => {
    const key = (code: string): void => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: code.slice(3).toLowerCase(), code, bubbles: true }));
    };
    const tap = (x: number, y: number): void => {
      $('battle').dispatchEvent(new MouseEvent('click', { clientX: x * 48 + 24, clientY: y * 48 + 24 }));
    };
    startParty('42');
    for (let i = 0; i < 1500 && document.querySelector('button.mission') === null; i++) btn('btn-tick').click();
    (document.querySelector('button.mission') as HTMLButtonElement).click();
    expect($('battle-panel').classList.contains('hidden')).toBe(false);
    expect(btn('btn-evac').hidden).toBe(false);
    expect(btn('btn-evac').title).toBe('2 AP · оперативник на синій клітинці висадки покидає бій; премії за місію немає · клавіша V');
    tap(2, 2);
    btn('btn-evac').click();
    expect($('binfo').textContent).toMatch(/^Евакуйовано: .+\. На полі лишилось оперативників: 2\.$/);
    tap(3, 2);
    key('KeyV');
    expect($('binfo').textContent).toMatch(/^Евакуйовано: .+\. На полі лишилось оперативників: 1\.$/);
    tap(2, 3);
    key('KeyV');
    expect($('evac-confirm').classList.contains('hidden')).toBe(false);
    expect($('evac-confirm-text').textContent).toMatch(
      / — останній оперативник на полі\. Місію буде завершено без премії, зонд Розриву лишиться активним\.$/
    );
    expect(document.activeElement?.id).toBe('btn-evac-no'); // фокус у вікні, а не на плитці під ним
    const turn = $('bctx-turn').textContent;
    key('KeyE'); // під вікном клавіші бою не діють
    btn('btn-end').click(); // і плитки теж
    expect($('bctx-turn').textContent).toBe(turn);
    btn('btn-evac-no').click();
    expect($('evac-confirm').classList.contains('hidden')).toBe(true);
    expect($('bresult').textContent).toBe('');
    key('KeyV');
    btn('btn-evac-yes').click();
    expect($('evac-confirm').classList.contains('hidden')).toBe(true);
    expect($('bresult').textContent).toContain('ЗАГІН ЕВАКУЙОВАНО — врятовані на базі, зонд Розриву лишається активним');
  });

  it('Т.71: вихід на стартовий екран з відкритим вікном евакуації — вікно закривається разом із боєм', () => {
    startParty('42');
    for (let i = 0; i < 1500 && document.querySelector('button.mission') === null; i++) btn('btn-tick').click();
    (document.querySelector('button.mission') as HTMLButtonElement).click();
    const keyV = (): void => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', code: 'KeyV', bubbles: true }));
    for (const [x, y] of [
      [2, 2],
      [3, 2],
      [2, 3],
    ] as const) {
      $('battle').dispatchEvent(new MouseEvent('click', { clientX: x * 48 + 24, clientY: y * 48 + 24 }));
      keyV();
    }
    expect($('evac-confirm').classList.contains('hidden')).toBe(false);
    btn('btn-menu').click();
    btn('btn-menu-exit').click();
    btn('btn-exit-yes').click();
    expect($('start-screen').classList.contains('hidden')).toBe(false);
    expect($('evac-confirm').classList.contains('hidden')).toBe(true);
  });
});

// Т.72 (рішення власника 18.11.2026): разова підказка «Можна евакуюватись» на сторінці —
// після першого поранення чи смерті оперативника в бою місії, один раз за партію.
describe('Т.72: підказка «Можна евакуюватись» на сторінці', () => {
  it('Т.72: сід 42, пресет «норма»: до першого поранення оперативника підказки немає, після — рівно одна, у вкладці «Бій»', () => {
    const HINT =
      'Підказка: оперативника можна евакуювати із зони висадки — плитка «Евакуація» або клавіша V, 2 AP. Евакуйовані повертаються на базу без премії.';
    const hints = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('#log li')].filter((li) => li.textContent === HINT);
    startParty('42');
    $('log').replaceChildren(); // журнал сторінки зберігає записи попередніх тестів файла
    for (let i = 0; i < 1500 && document.querySelector('button.mission') === null; i++) btn('btn-tick').click();
    (document.querySelector('button.mission') as HTMLButtonElement).click();
    expect($('battle-panel').classList.contains('hidden')).toBe(false);
    expect(hints()).toHaveLength(0);
    for (let i = 0; i < 30 && hints().length === 0 && $('bresult').textContent === ''; i++) btn('btn-end').click();
    expect(hints()).toHaveLength(1);
    expect(hints()[0].dataset.cat).toBe('battle');
    for (let i = 0; i < 5 && $('bresult').textContent === ''; i++) btn('btn-end').click();
    expect(hints()).toHaveLength(1);
  });
});

// Т.73 (кандидат 77, рішення власника 19.11.2026): вікна поверх бою — «Меню», «Налаштування», «Як грати»,
// «Незбережені зміни». Під вікном клавіші й плитки бою не діють; фокус — на безпечній кнопці вікна;
// Esc закриває вікно; після закриття фокус — на кнопці топбару, що відкрила вікно.
describe('Т.73: вікна поверх бою — клавіші, плитки, фокус і Esc', () => {
  const press = (code: string, key: string): void => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true }));
  };
  const tap = (x: number, y: number): void => {
    $('battle').dispatchEvent(new MouseEvent('click', { clientX: x * 48 + 24, clientY: y * 48 + 24 }));
  };
  const open = (id: string): boolean => !$(id).classList.contains('hidden');
  const focused = (): string => document.activeElement?.id ?? '';
  const startBattle = (): void => {
    startParty('42');
    for (let i = 0; i < 1500 && document.querySelector('button.mission') === null; i++) btn('btn-tick').click();
    (document.querySelector('button.mission') as HTMLButtonElement).click();
    expect($('battle-panel').classList.contains('hidden')).toBe(false);
    tap(2, 2); // оперативник на синій клітинці висадки (як у тесті Т.71)
  };
  // Під відкритим вікном: клавіші бою і плитки тулбара не міняють ні хід, ні рядок #binfo.
  const battleFrozen = (): void => {
    const turn = $('bctx-turn').textContent;
    const info = $('binfo').textContent;
    press('KeyE', 'e');
    press('Digit1', '1');
    press('KeyO', 'o');
    press('KeyG', 'g');
    press('KeyV', 'v');
    btn('btn-snap').click();
    btn('btn-evac').click();
    btn('btn-end').click();
    expect($('bctx-turn').textContent).toBe(turn);
    expect($('binfo').textContent).toBe(info);
  };

  it('Т.73: під «Меню», «Налаштування», «Як грати» і «Незбережені зміни» клавіші й плитки бою не діють; фокус — на безпечній кнопці вікна', () => {
    startBattle();
    // 1. «Меню»: фокус на «Закрити»
    btn('btn-menu').click();
    expect(open('game-menu')).toBe(true);
    expect(focused()).toBe('btn-menu-close');
    battleFrozen();
    // 2. «Налаштування» з меню: фокус на «Закрити» вікна
    btn('btn-menu-settings').click();
    expect(open('settings-dialog')).toBe(true);
    expect(focused()).toBe('settings-close');
    battleFrozen();
    btn('settings-close').click();
    // 3. «Як грати» з меню: фокус на «Грати»
    btn('btn-menu').click();
    btn('btn-menu-help').click();
    expect(open('help-screen')).toBe(true);
    expect(focused()).toBe('btn-help-close');
    battleFrozen();
    btn('btn-help-close').click();
    // 4. «Як грати» кнопкою «?» у топбарі: так само
    btn('btn-help').click();
    expect(focused()).toBe('btn-help-close');
    battleFrozen();
    btn('btn-help-close').click();
    // 5. «Незбережені зміни»: фокус на «Скасувати»
    btn('btn-menu').click();
    btn('btn-menu-exit').click();
    expect(open('exit-confirm')).toBe(true);
    expect(focused()).toBe('btn-exit-no');
    battleFrozen();
    btn('btn-exit-no').click();
    // 6. без вікна клавіша бою знову діє: E — кінець ходу
    const turn = $('bctx-turn').textContent;
    press('KeyE', 'e');
    expect($('bctx-turn').textContent).not.toBe(turn);
  });

  it('Т.73: Esc закриває вікно і не скидає зведений режим під ним; фокус повертається на кнопку топбару, що відкрила вікно', () => {
    startBattle();
    press('Digit1', '1'); // зведений «Швидкий» у вибраного оперативника
    const info = $('binfo').textContent;
    // 1. «Меню» → Esc: вікно закрите, режим під ним не скасовано, фокус — на «Меню»
    btn('btn-menu').click();
    press('Escape', 'Escape');
    expect(open('game-menu')).toBe(false);
    expect($('binfo').textContent).toBe(info);
    expect(focused()).toBe('btn-menu');
    // 2. «Меню» → «Налаштування» → Esc: фокус — на «Меню»
    btn('btn-menu').click();
    btn('btn-menu-settings').click();
    press('Escape', 'Escape');
    expect(open('settings-dialog')).toBe(false);
    expect(open('game-menu')).toBe(false);
    expect(focused()).toBe('btn-menu');
    // 3. «?» → Esc: фокус — на «?»
    btn('btn-help').click();
    press('Escape', 'Escape');
    expect(open('help-screen')).toBe(false);
    expect(focused()).toBe('btn-help');
    // 4. «Меню» → «Як грати» → «Грати»: фокус — на «Меню»
    btn('btn-menu').click();
    btn('btn-menu-help').click();
    btn('btn-help-close').click();
    expect(focused()).toBe('btn-menu');
    // 5. «Незбережені зміни» → Esc: вікно закрите, бій на місці, фокус — на «Меню»
    btn('btn-menu').click();
    btn('btn-menu-exit').click();
    press('Escape', 'Escape');
    expect(open('exit-confirm')).toBe(false);
    expect($('battle-panel').classList.contains('hidden')).toBe(false);
    expect(focused()).toBe('btn-menu');
    // 6. «Меню» → «Закрити»: фокус — на «Меню»
    btn('btn-menu').click();
    btn('btn-menu-close').click();
    expect(focused()).toBe('btn-menu');
    // 7. режим досі зведений: Esc без вікна його скасовує
    expect($('binfo').textContent).toBe(info);
    press('Escape', 'Escape');
    expect($('binfo').textContent).toBe('Режим пострілу скасовано.');
  });
  it('Т.73: Esc закриває й вікно «Евакуювати останнього?» (оперативник лишається) і діалог нової партії на стартовому екрані', () => {
    startBattle(); // вибрано оперативника на (2, 2)
    press('KeyV', 'v');
    tap(3, 2);
    press('KeyV', 'v');
    tap(2, 3);
    press('KeyV', 'v');
    expect(open('evac-confirm')).toBe(true);
    press('Escape', 'Escape');
    expect(open('evac-confirm')).toBe(false);
    expect($('bresult').textContent).toBe('');
    // стартовий екран: «Нова партія» → Esc — діалог закрито, партію не створено
    btn('btn-menu').click();
    btn('btn-menu-exit').click();
    btn('btn-exit-yes').click();
    expect(open('start-screen')).toBe(true);
    btn('btn-start-new').click();
    expect(open('new-game-dialog')).toBe(true);
    press('Escape', 'Escape');
    expect(open('new-game-dialog')).toBe(false);
    expect(open('start-screen')).toBe(true);
  });
});

// Т.75 (хвіст Т.73, межа (а) звіту): пастка фокусу — Tab і Shift+Tab не виводять фокус з відкритого вікна
describe('Т.75: пастка фокусу у вікнах поверх гри', () => {
  // jsdom сам фокус по Tab не рухає: на краях кола подію треба скасувати, інакше браузер зсуне фокус далі
  const tab = (shift = false): void => {
    const ev = new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', shiftKey: shift, bubbles: true, cancelable: true });
    document.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  };
  const items = (id: string): HTMLButtonElement[] => [...$(id).querySelectorAll<HTMLButtonElement>('button')].filter((b) => !b.disabled);
  const focused = (): Element | null => document.activeElement;
  // Tab з останньої кнопки — на першу; Shift+Tab з першої — на останню; фокус поза вікном — Tab на першу
  const trapped = (id: string): void => {
    const b = items(id);
    expect(b.length).toBeGreaterThan(1);
    b[b.length - 1].focus();
    tab();
    expect(focused()).toBe(b[0]);
    tab(true);
    expect(focused()).toBe(b[b.length - 1]);
    btn('btn-menu').focus(); // кнопка топбару під вікном
    tab();
    expect(focused()).toBe(b[0]);
    btn('btn-menu').focus();
    tab(true);
    expect(focused()).toBe(b[b.length - 1]);
  };

  it('Т.75: «Меню» і «Незбережені зміни» тримають фокус; без вікна Tab не перехоплюється', () => {
    startParty('42');
    btn('btn-tick').click(); // незбережені зміни — тоді «Вийти» відкриває «Незбережені зміни»
    btn('btn-menu').click();
    trapped('game-menu');
    btn('btn-menu-exit').click();
    expect($('exit-confirm').classList.contains('hidden')).toBe(false);
    trapped('exit-confirm');
    btn('btn-exit-no').click();
    // вікна закрито: Tab іде браузеру — подію не скасовано, фокус на місці
    btn('btn-menu').focus();
    const ev = new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', bubbles: true, cancelable: true });
    document.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(focused()).toBe(btn('btn-menu'));
  });

  it('Т.75: вимкнена кнопка в коло не входить; у діалозі «Нова партія» коло починається з поля сіду', () => {
    startParty('42');
    btn('btn-menu').click();
    const b = items('game-menu');
    b[b.length - 1].disabled = true; // штучно: остання кнопка вимкнена — Tab з передостанньої йде на першу
    b[b.length - 2].focus();
    tab();
    expect(focused()).toBe(b[0]);
    b[b.length - 1].disabled = false;
    btn('btn-menu-close').click();
    // «Нова партія» на стартовому екрані: поле сіду і вибір складності — у колі
    btn('btn-menu').click();
    btn('btn-menu-exit').click();
    if (!$('exit-confirm').classList.contains('hidden')) btn('btn-exit-yes').click();
    btn('btn-start-new').click();
    expect($('new-game-dialog').classList.contains('hidden')).toBe(false);
    (document.activeElement as HTMLElement).blur(); // фокус поза діалогом
    tab();
    expect(focused()?.id).toBe('new-game-seed');
    tab(true);
    const last = [...$('new-game-dialog').querySelectorAll<HTMLElement>('button, input, select')].pop();
    expect(focused()).toBe(last);
  });

  it('Т.75: рядок журналу бою — «⇧ Евакуйовано: <ім’я>» з іменем, а не id оперативника', () => {
    startParty('42');
    for (let i = 0; i < 1500 && document.querySelector('button.mission') === null; i++) btn('btn-tick').click();
    (document.querySelector('button.mission') as HTMLButtonElement).click();
    $('battle').dispatchEvent(new MouseEvent('click', { clientX: 2 * 48 + 24, clientY: 2 * 48 + 24 }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', code: 'KeyV', bubbles: true }));
    const name = /^Евакуйовано: (.+?)\./.exec($('binfo').textContent ?? '')?.[1];
    expect(name).toBeTruthy();
    const lines = [...document.querySelectorAll('#log li')].map((li) => li.textContent);
    expect(lines).toContain('⇧ Евакуйовано: ' + name);
  });

  it('Т.75: «Налаштування» і «Як грати» тримають фокус', () => {
    startParty('42');
    btn('btn-menu').click();
    btn('btn-menu-settings').click();
    trapped('settings-dialog');
    btn('settings-close').click();
    btn('btn-help').click();
    const b = items('help-screen');
    // у «Як грати» може бути одна кнопка — тоді Tab лишає фокус на ній
    b[b.length - 1].focus();
    tab();
    expect(focused()).toBe(b[0]);
    btn('btn-menu').focus();
    tab();
    expect(focused()).toBe(b[0]);
  });
});
