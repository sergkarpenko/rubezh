// @vitest-environment jsdom
/// <reference types="vite/client" />
// src/main.ui.test.ts
// П7 (переробка, ADR-0013): DOM-тести UI-шару main.ts через jsdom.
// Розмітку беремо з реального index.html (без дублювання — дрейф розмітки
// ловиться тестом). Канва — no-op заглушка: jsdom без нативного canvas не
// рендерить 2D, а main.ts при null-контексті рано виходить з renderGeo/
// renderBattle і не оновлює DOM поруч із канвою; заглушка тримає кнопки/тексти
// живими. Малювання далі валідується візуально (превью).
// П6.2 (ADR-0027): тести каркаса — топбар (чипи балансу/боєготових),
// фокусна зона (гео/бій), журнал з фільтрами-вкладками.
// П6.3 (ADR-0027): бойова фокусна зона — контекст-стрічка бою, керування
// під бойовищем, приглушена колонка стану в бою, збереження лише на геосцені.
// П6.4 (ADR-0027): керування — гарячі клавіші 1/2/3/O/E/Esc (поля вводу
// ігнорують) і тач-патерн «тап — прев'ю — повторний тап у ту саму
// клітинку — хід» (мишка — той самий патерн, click).
// П6.16: демо-бій — покрокове відтворення; фейк-таймери прокручують паузи
// між діями ботів, поки бій не дійде до результату (банер у #bresult).

import { beforeAll, describe, expect, it, vi } from 'vitest';
// index.html — через ?raw-імпорт (vitest/vite): без node:fs і process.cwd(), тож
// @types/node не потрібен (ADR-0012 — нових залежностей немає; tsconfig.json не чіпаємо).
import htmlRaw from '../index.html?raw';

const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const btn = (id: string): HTMLButtonElement => $(id) as HTMLButtonElement;

// П6.16: демо-бій — покрокове відтворення (пауза 160 мс між діями, таймер).
// Фейк-таймери прокручують паузи, поки бій не дійде до результату (btn-demo
// disabled у renderBattle після finishBattle). Крок 200 мс > паузи — 1–2
// дії за ітерацію; ліміт ітерацій — страховка від зависання.
const DEMO_STEP_MS = 200;
async function runDemoSteps(): Promise<void> {
  for (let i = 0; i < 6000 && !btn('btn-demo').disabled; i++) {
    await vi.advanceTimersByTimeAsync(DEMO_STEP_MS);
  }
}
async function runDemo(): Promise<void> {
  vi.useFakeTimers();
  try {
    btn('btn-demo').click();
    await runDemoSteps();
  } finally {
    vi.useRealTimers();
  }
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
  // «без rAF анімації не ставляться у чергу»), і покрокове демо крокує
  // лише таймерами пауз (фейк-таймери у runDemo). rAF-гілку рушія
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

describe('UI-флоу превью: геосцена → місія → бій → результат (ADR-0013)', () => {
  it('ініціалізація: журнал старту, годинник, ростер, фінанси, панель бою прихована', () => {
    expect($('log').textContent).toContain('Партію розпочато');
    expect($('clock').textContent).toBe('Д1 00:00');
    expect($('roster').textContent).toContain('6 солдатів (6 боєготових)');
    expect($('money').textContent).toBe('300');
    expect($('ready').textContent).toBe('6/6'); // П6.2: чип боєготових у топбарі
    expect($('money-card').textContent).toBe('300'); // П6.2: дублювання балансу чипом і карткою (ADR-0027)
    expect($('battle-panel').classList.contains('hidden')).toBe(true);
    expect($('geo-panel').classList.contains('hidden')).toBe(false);
    expect(btn('btn-tick').disabled).toBe(false);
  });

  it('btn-tick: +30 хв; btn-day: +1 доба', () => {
    btn('btn-tick').click();
    expect($('clock').textContent).toBe('Д1 00:30');
    btn('btn-day').click();
    expect($('clock').textContent).toBe('Д2 00:30');
  });

  it('нова партія зі сідом: годинник і журнал', () => {
    ($('seed') as HTMLInputElement).value = '42';
    btn('btn-new').click();
    expect($('clock').textContent).toBe('Д1 00:00');
    expect($('log').textContent).toContain('Нова партія (сід 42, складність «норма»)');
  });

  it('П8.4a: вибір «легкий» — нова партія з множниками легкого рівня', () => {
    ($('preset') as HTMLSelectElement).value = 'легкий';
    btn('btn-new').click();
    // журнал фіксує пресет; стартові кошти 300 × 1.2 = 360 (П8.4, ADR-0033)
    expect($('log').textContent).toContain('складність «легкий»');
    expect($('money').textContent).toBe('360');
    // повертаємо «норму»: наступні тести очікують дефолтний баланс і HP 10
    ($('preset') as HTMLSelectElement).value = 'норма';
    btn('btn-new').click();
    expect($('money').textContent).toBe('300');
  });

  it('радар: тіки до виявленого приземленого НЛО → кнопка місії (детерміновано)', () => {
    let found = false;
    for (let i = 0; i < 1500 && !found; i++) {
      btn('btn-tick').click();
      found = document.querySelector('button.mission') !== null;
    }
    expect(found).toBe(true); // сід 42: виявлений НЛО приземлюється в межах ліміту
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
  });

  it('вибір солдата кліком по бойовищу (клітина 2,2 — зона висадки)', () => {
    const cv = $('battle') as HTMLCanvasElement;
    cv.dispatchEvent(new MouseEvent('click', { clientX: 2 * 26 + 13, clientY: 2 * 26 + 13 }));
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
    expect($('binfo').textContent).toContain('Хід прибульців відпрацьовано');
  });

  it('демо-бій: покрокове відтворення доводить бій до результату (П6.16)', async () => {
    vi.useFakeTimers();
    try {
      btn('btn-demo').click();
      await vi.advanceTimersByTimeAsync(600); // кілька дій ботів (пауза 160 мс)
      expect($('bresult').textContent).toBe(''); // кроки тривають — не миттєвий прогін
      await runDemoSteps();
    } finally {
      vi.useRealTimers();
    }
    expect($('bresult').textContent).toMatch(/ЗАЧИЩЕНО|ЗАГІН ВТРАЧЕНО/);
    expect(btn('btn-demo').disabled).toBe(true); // бій завершено — демо більше не тискається
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
  // Сід 42 детермінований (перевірено сценарієм у пісочниці): перша місія —
  // «розвідник» на 22-му тіку; демо-бій — перемога, s2 гине, s1 поранений
  // 6/10 → лікарня 8 тіків; премія +150.

  it('скидання партії: баланс 300, ростер 6', () => {
    ($('seed') as HTMLInputElement).value = '42';
    btn('btn-new').click();
    expect($('money').textContent).toBe('300');
    expect($('roster').textContent).toContain('6 солдатів (6 боєготових)');
  });

  it('найм: −100, новобранець «Дмитро» в кінці ростеру', () => {
    btn('btn-hire').click();
    expect($('money').textContent).toBe('200');
    expect($('roster').textContent).toContain('7 солдатів (7 боєготових)');
    expect($('roster').textContent).toContain('Дмитро');
    expect($('log').textContent).toContain('Найм: Дмитро');
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

  it('поранення: демо-бій — перемога, поранений у лікарні, премія за місію', async () => {
    await runDemo();
    expect($('bresult').textContent).toContain('ЗАЧИЩЕНО');
    expect($('bresult').textContent).toContain('поранених: 1');
    expect($('log').textContent).toContain('Іван поранений — лікарня: 8 тик(и)');
    expect($('log').textContent).toContain('Премія за місію (розвідник): +110');
    expect($('money').textContent).toBe('310'); // 300 − 100 найм + 110 премія (П8.6)
  });

  it('поранений не боєготовий: статус у ростері, місія недоступна поки вікно триває', () => {
    btn('btn-close').click();
    expect($('battle-panel').classList.contains('hidden')).toBe(true);
    expect($('roster').textContent).toContain('6 солдатів (5 боєготових)');
    expect($('roster').textContent).toContain('лікарня: 8 тик(и)');
    expect($('roster').textContent).toContain('HP 6/10');
    expect(btn('btn-tick').disabled).toBe(false);
  });

  it('одужання: 8 тіків — ветеран знову боєготовий, баланс і годинник цілі', () => {
    for (let i = 0; i < 8; i++) btn('btn-tick').click();
    expect($('roster').textContent).not.toContain('лікарня');
    expect($('roster').textContent).toContain('HP 10/10');
    expect($('roster').textContent).toContain('6 солдатів (6 боєготових)');
    expect($('money').textContent).toBe('310'); // доти не було — доба не завершена
    expect($('clock').textContent).toBe('Д1 15:00'); // 22 + 8 тіків по 30 хв
  });

  it('дотація: завершення доби 1 — +75 у журналі і балансі', () => {
    for (let i = 0; i < 18; i++) btn('btn-tick').click(); // 30 тіків усього
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

  it('новий запис під активним фільтром видимий, під іншим — приховується', () => {
    btn('log-tab-econ').click();
    btn('btn-hire').click(); // 385 → 285 (два записи: «Найм» + «Витрати»)
    const hireLi = Array.from(document.querySelectorAll('#log li[data-cat="econ"]')).find((li) =>
      li.textContent!.includes('Найм')
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
  beforeAll(() => {
    localStorage.clear(); // кожен флоу панелі — на чистих слотах
  });

  it('критичний флоу: зберегти → «перезавантаження» (нова партія) → завантажити → жорсткий збіг стану', () => {
    ($('seed') as HTMLInputElement).value = '42';
    btn('btn-new').click();
    // дотікати до виявленого приземленого НЛО (трекінг НЛО має потрапити у сейв)
    let found = false;
    for (let i = 0; i < 1500 && !found; i++) {
      btn('btn-tick').click();
      found = document.querySelector('button.mission') !== null;
    }
    expect(found).toBe(true);
    const ufosBefore = $('ufos').textContent;
    const rosterBefore = $('roster').textContent;
    expect($('clock').textContent).toBe('Д1 11:00'); // 22-й тік (детерміновано, сід 42)

    btn('btn-save-1').click();
    expect($('log').textContent).toContain('Збережено: слот 1');
    expect($('slot-1').textContent).toContain('сід 42');
    expect(btn('btn-load-1').disabled).toBe(false);
    expect(localStorage.getItem('rubezh.save.1')).not.toBeNull();

    // «перезавантаження сторінки»: свіжа партія — слот виживає у localStorage
    btn('btn-new').click();
    expect($('clock').textContent).toBe('Д1 00:00');
    expect($('ufos').textContent).toContain('Нічого не виявлено');

    // завантаження відновлює партію: час, трекінг НЛО, ростер, фінанси
    btn('btn-load-1').click();
    expect($('log').textContent).toContain('Завантажено: слот 1');
    expect($('clock').textContent).toBe('Д1 11:00');
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
    btn('btn-day').click(); // доба вперед: дотація +75 (П8.6)
    expect($('clock').textContent).toBe('Д2 11:00');
    expect($('money').textContent).toBe('375');
    btn('btn-load-1').click();
    expect($('clock').textContent).toBe('Д1 11:00');
    expect($('money').textContent).toBe('300');
    expect(document.querySelector('button.mission')).not.toBeNull(); // вікно місії відновлено
  });

  it('під час бою панель збереження вимкнена (ADR-0026: місія не переривається)', async () => {
    (document.querySelector('button.mission') as HTMLButtonElement).click();
    expect($('battle-panel').classList.contains('hidden')).toBe(false);
    expect(btn('btn-save-1').disabled).toBe(true);
    expect(btn('btn-load-1').disabled).toBe(true);
    expect(btn('btn-del-1').disabled).toBe(true);
    await runDemo(); // завершити бій (детерміновано: сід 42)
    btn('btn-close').click();
    expect(btn('btn-save-1').disabled).toBe(false);
    expect(btn('btn-load-1').disabled).toBe(false);
  });

  it('лікарня у сейві: поранений відновлюється після завантаження', () => {
    // демо-бій цієї партії: перемога, s2 загинув, Іван поранений 6/10 (сід 42)
    expect($('roster').textContent).toContain('лікарня: 8 тик(и)');
    expect($('money').textContent).toBe('410'); // 300 + премія 110 (П8.6)
    btn('btn-save-3').click();
    for (let i = 0; i < 8; i++) btn('btn-tick').click(); // одужання
    expect($('roster').textContent).not.toContain('лікарня');
    btn('btn-load-3').click();
    expect($('roster').textContent).toContain('лікарня: 8 тик(и)');
    expect($('roster').textContent).toContain('HP 6/10');
    expect($('money').textContent).toBe('410');
  });

  it('пошкоджений слот: мітадані «пошкоджений слот», завантаження — помилка без зміни стану', () => {
    localStorage.setItem('rubezh.save.2', 'не json');
    btn('btn-tick').click(); // renderAll → перерисовка панелі
    expect($('slot-2').textContent).toBe('пошкоджений слот');
    const clockBefore = $('clock').textContent;
    btn('btn-load-2').click();
    expect($('log').textContent).toContain('Завантаження не вдалось');
    expect($('log').textContent).toContain('Пошкоджені дані');
    expect($('clock').textContent).toBe(clockBefore); // без часткового стану
  });

  it('видалення слота: мітадані «—», завантаження вимкнене', () => {
    btn('btn-del-2').click();
    expect($('slot-2').textContent).toBe('—');
    expect(btn('btn-load-2').disabled).toBe(true);
    expect(btn('btn-del-2').disabled).toBe(true);
    expect(localStorage.getItem('rubezh.save.2')).toBeNull();
  });
});

describe('бойова фокусна зона (П6.3, ADR-0027)', () => {
  it('розмітка: керування під бойовищем, бойовище — квадрат (ширина колонки, кап 720px)', () => {
    const panel = htmlRaw.match(/<section class="panel hidden" id="battle-panel">[\s\S]*?<\/section>/)![0];
    expect(panel.indexOf('id="battle"')).toBeLessThan(panel.indexOf('id="bcontrols"')); // панель керування — під бойовищем
    expect(panel.indexOf('id="bctx"')).toBeLessThan(panel.indexOf('id="battle"')); // контекст-стрічка — над бойовищем
    const css = htmlRaw.match(/#battle \{[^}]*\}/)![0];
    expect(css).toContain('width: 100%'); // на ширину фокусної колонки
    expect(css).toContain('max-width: 720px'); // кап ~720px (ADR-0027)
    expect(css).toContain('aspect-ratio: 1'); // квадрат
    const cv = $('battle') as HTMLCanvasElement;
    expect(cv.width).toBe(520); // buffer 520×520: на десктопі бойовище не менше поточних 520px
  });

  it('контекст-стрічка: тип місії, заморожений час, чий хід; колонка стану dimmed; збереження вимкнене', () => {
    ($('seed') as HTMLInputElement).value = '42';
    btn('btn-new').click();
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
    cv.dispatchEvent(new MouseEvent('click', { clientX: 2 * 26 + 13, clientY: 2 * 26 + 13 }));
    expect($('bctx-unit').textContent).toContain('HP 10/10');
    expect($('bctx-unit').textContent).toContain('AP 10/10');
    expect($('binfo').textContent).toContain('HP 10/10');
  });

  it('після бою: dimmed знято, збереження активне', async () => {
    await runDemo();
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
    $('battle').dispatchEvent(new MouseEvent('click', { clientX: x * 26 + 13, clientY: y * 26 + 13 }));
  };

  it('підготовка: нова партія (сід 42) → місія → вибір солдата у зоні висадки', () => {
    ($('seed') as HTMLInputElement).value = '42';
    btn('btn-new').click();
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
    tap(3, 3); // перший тап — прев’ю шляху (обхід сусідів по висадці: 6 клітинок)
    expect($('binfo').textContent).toContain('Шлях: 6 AP');
    expect($('binfo').textContent).toContain('повторний тап');
    expect($('bctx-unit').textContent).toContain('AP 10/10'); // ходу ще не було
    tap(3, 3); // повторний тап у ту саму клітинку — хід
    expect($('binfo').textContent).toContain('рух');
    expect($('bctx-unit').textContent).toContain('AP 4/10');
  });

  it('тап у ІНШУ клітинку — нове прев’ю; шлях без AP: повторний тап ходу не робить', () => {
    tap(2, 2); // шлях 6 AP проти 4 — прев’ю «червоними крапками» (AP не вистачає)
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
    expect($('binfo').textContent).toContain('Хід прибульців відпрацьовано');
  });

  it('поля вводу: гарячі клавіші ігноруються (сід) — хід не завершується', () => {
    const seed = $('seed') as HTMLInputElement;
    seed.focus();
    key('e', 'KeyE', seed); // keydown із поля вводу — ігнорується
    expect($('bctx-turn').textContent).toContain('хід 2'); // хід не передано
    key('1', 'Digit1', seed); // і режим пострілу не зводиться
    expect(btn('btn-snap').classList.contains('armed')).toBe(false);
    seed.blur();
  });
});

describe('П6.14: UX прицілювання — обведення цілей, шанс біля клітинки, кнопки без AP', () => {
  const tap = (x: number, y: number): void => {
    $('battle').dispatchEvent(new MouseEvent('click', { clientX: x * 26 + 13, clientY: y * 26 + 13 }));
  };
  const hover = (x: number, y: number): void => {
    $('battle').dispatchEvent(new MouseEvent('mousemove', { clientX: x * 26 + 13, clientY: y * 26 + 13 }));
  };
  const keydown = (k: string, code: string): void => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: k, code: code, bubbles: true }));
  };
  // Рамка валідної цілі: strokeRect(gx*26+2, gy*26+2, 22, 22) — spawn-зони малюються 21×21
  const frame = (x: number, y: number): string => 'strokeRect(' + (x * 26 + 2) + ',' + (y * 26 + 2) + ',22,22)';

  it('підготовка: нова партія (сід 42) → місія → солдат (3,2) крокує на (4,2) — 1 AP', () => {
    ($('seed') as HTMLInputElement).value = '42';
    btn('btn-new').click();
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
    tap(16, 2); // прибульець без зведеного режиму
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
    expect($('binfo').textContent).toContain('вистрілив');
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
    ($('seed') as HTMLInputElement).value = '42';
    btn('btn-new').click();
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
      expect($('log').textContent).toContain('Ремонт винищувача завершено');
    } else {
      expect(fighterText()).toContain('боєготовий');
      expect($('log').textContent).toContain('збитий');
    }
  });

  it('кнопка «Ремонт (50)» з’являється лише для пошкодженого винищувача', () => {
    btn('btn-new').click(); // чиста партія — здоровий винищувач
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
    ($('seed') as HTMLInputElement).value = '42';
    btn('btn-new').click();
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
  });
});

describe('П8.3a: перемога кампанії — 30 діб → екран → «Грати далі» (endless), рахунок зафіксований', () => {
  it('підготовка: нова партія — екрана перемоги нема, кампанія «триває»', () => {
    ($('seed') as HTMLInputElement).value = '42';
    btn('btn-new').click();
    expect($('clock').textContent).toBe('Д1 00:00');
    expect($('campaign-status').textContent).toBe('кампанія: триває');
    expect($('campaign-progress').textContent).toBe('Д1/30');
    expect($('campaign-victory').classList.contains('hidden')).toBe(true);
  });

  it('30 діб: настала доба 31 — екран перемоги з підсумковим рахунком', () => {
    for (let i = 0; i < 30; i++) btn('btn-day').click();
    expect($('clock').textContent).toBe('Д31 00:00');
    expect($('campaign-status').textContent).toBe('кампанія: перемога');
    expect($('campaign-victory').classList.contains('hidden')).toBe(false);
    expect($('campaign-score').textContent).toMatch(/^\d+$/); // рахунок зафіксовано на межі 30-ї доби (П8.2)
  });

  it('«Грати далі» (endless): екран зникає, час іде далі, рахунок не змінюється', () => {
    const score = $('campaign-score').textContent;
    btn('btn-continue').click();
    expect($('campaign-victory').classList.contains('hidden')).toBe(true);
    expect($('log').textContent).toContain('Партію продовжено');
    // партія жива після перемоги: тік часу працює, статус і рахунок зафіксовані (EARS Фази 8)
    btn('btn-day').click();
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
