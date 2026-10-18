// @vitest-environment jsdom
// П12.2 (ADR-0065): юніт-тести каркасу екранів і навігації (src/ui/screens.ts).
// Критерії П12.2: флоу екранів і діалогів через DOM, пункти з причинами
// вимкнення (продовжити без сейвів, налаштування — п12.3), переходи без
// rAF-анімацій (idle → 0 перерисовок, ADR-0029). Повний флоу із сейвами —
// у src/main.ui.test.ts (там живе панель збереження).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createScreens, type ScreensDeps } from './screens';

// Скелетні секції — ті самі id, що й в index.html (контент генерує модуль).
const SKELETON =
  '<header id="topbar" class="hidden"></header>' +
  '<main id="layout" class="hidden"></main>' +
  '<section id="start-screen" class="hidden"></section>' +
  '<section id="new-game-dialog" class="hidden"></section>' +
  '<section id="game-menu" class="hidden"></section>' +
  '<section id="exit-confirm" class="hidden"></section>';

const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const btn = (id: string): HTMLButtonElement => $(id) as HTMLButtonElement;
const visible = (id: string): boolean => !$(id).classList.contains('hidden');

// Лічильник rAF-викликів: переходи екранів — лише перемикання класів (ADR-0029).
let rafCalls = 0;

function makeDeps(overrides: Partial<ScreensDeps> = {}): ScreensDeps {
  return {
    version: '0.3.0-тест',
    hasSaves: () => false,
    continueDisabledReason: () => 'Немає збережених партій',
    onNewGame: vi.fn(),
    onContinue: vi.fn(() => true),
    onHelp: vi.fn(),
    onSettings: vi.fn(),
    hasUnsavedChanges: () => false,
    onExitToStart: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  document.body.innerHTML = SKELETON;
  rafCalls = 0;
  vi.stubGlobal('requestAnimationFrame', () => {
    rafCalls++;
  });
});

describe('П12.2: екрани — стартовий і ігровий (ADR-0065)', () => {
  it('showStart: стартовий екран видимий, каркас гри прихований; showGame — навпаки', () => {
    const screens = createScreens(makeDeps());
    screens.showStart();
    expect(visible('start-screen')).toBe(true);
    expect(visible('topbar')).toBe(false);
    expect(visible('layout')).toBe(false);
    expect(screens.current()).toBe('стартовий');
    screens.showGame();
    expect(visible('start-screen')).toBe(false);
    expect(visible('topbar')).toBe(true);
    expect(visible('layout')).toBe(true);
    expect(screens.current()).toBe('гра');
  });

  it('переходи і діалоги — без rAF-анімацій (0 викликів, ADR-0029)', () => {
    const screens = createScreens(makeDeps({ hasSaves: () => true, hasUnsavedChanges: () => true }));
    screens.showStart();
    btn('btn-start-new').click();
    btn('btn-new-game-start').click();
    screens.showGame();
    screens.openMenu();
    btn('btn-menu-exit').click(); // бруд → підтвердження
    btn('btn-exit-yes').click();
    screens.showStart();
    expect(rafCalls).toBe(0);
  });

  it('стартовий екран: логотип, меню, версія; «Налаштування» відкривають вікно (п12.3)', () => {
    const deps = makeDeps();
    createScreens(deps).showStart();
    expect($('start-logo').textContent).toBe('РУБІЖ');
    expect(document.querySelector('.start-tagline')!.textContent).toContain('Розрив'); // ADR-0064: термінологія одразу
    expect(btn('btn-start-new').textContent).toBe('Нова партія');
    expect(btn('btn-start-continue').textContent).toBe('Продовжити');
    expect(btn('btn-start-help').textContent).toBe('Як грати');
    expect(document.querySelector('.start-version')!.textContent).toContain('Версія 0.3.0-тест'); // ADR-0054
    expect(btn('btn-start-settings').disabled).toBe(false); // п12.3: пункт активний
    btn('btn-start-settings').click();
    expect(deps.onSettings).toHaveBeenCalled(); // вікно — settings.ts (ADR-0065)
  });

  it('«Продовжити»: без сейвів — вимкнений з причиною; з сейвами — активний (EARS Фази 12)', () => {
    const screens = createScreens(makeDeps());
    screens.showStart();
    expect(btn('btn-start-continue').disabled).toBe(true);
    expect(btn('btn-start-continue').title).toBe('Немає збережених партій');
    // render() синхронізує стан: сейви з'явились → пункт доступний
    const live = createScreens(makeDeps({ hasSaves: () => true, continueDisabledReason: () => '' }));
    live.showStart();
    expect(btn('btn-start-continue').disabled).toBe(false);
    expect(btn('btn-start-continue').title).not.toContain('Немає');
  });
});

describe('П12.2: діалог «Нова партія» — сід і складність (ADR-0033/0065)', () => {
  it('відкриття з стартового екрана, дефолти сід 42 / «норма»; скасування — без дії', () => {
    const deps = makeDeps();
    createScreens(deps).showStart();
    btn('btn-start-new').click();
    expect(visible('new-game-dialog')).toBe(true);
    expect(($('new-game-seed') as HTMLInputElement).value).toBe('42');
    expect(($('new-game-preset') as HTMLSelectElement).value).toBe('норма');
    btn('btn-new-game-cancel').click();
    expect(visible('new-game-dialog')).toBe(false);
    expect(deps.onNewGame).not.toHaveBeenCalled();
  });

  it('підтвердження: сід і пресет передаються; нечисловий сід — 42 (валідація топбара)', () => {
    const deps = makeDeps();
    createScreens(deps).showStart();
    btn('btn-start-new').click();
    ($('new-game-seed') as HTMLInputElement).value = '7';
    ($('new-game-preset') as HTMLSelectElement).value = 'легкий';
    btn('btn-new-game-start').click();
    expect(deps.onNewGame).toHaveBeenCalledWith(7, 'легкий');
    expect(visible('new-game-dialog')).toBe(false);
    btn('btn-start-new').click();
    ($('new-game-seed') as HTMLInputElement).value = 'не число';
    ($('new-game-preset') as HTMLSelectElement).value = 'казус'; // невідомий — «норма»
    btn('btn-new-game-start').click();
    expect(deps.onNewGame).toHaveBeenLastCalledWith(42, 'норма');
  });

  it('після старту партії діалоги приховані (глибина навігації — один діалог, ADR-0065)', () => {
    const deps = makeDeps();
    const screens = createScreens(deps);
    screens.showStart();
    btn('btn-start-new').click();
    btn('btn-new-game-start').click();
    screens.showGame();
    expect(visible('new-game-dialog')).toBe(false);
    expect(visible('exit-confirm')).toBe(false);
    expect(visible('game-menu')).toBe(false);
  });
});

describe('П12.2: «Продовжити» і вікно «Меню» гри (ADR-0026/0065)', () => {
  it('продовжити: завантаження вдалось → ігровий екран; невдалось — залишаємось на стартовому', () => {
    const deps = makeDeps({ hasSaves: () => true, continueDisabledReason: () => '', onContinue: vi.fn(() => true) });
    const screens = createScreens(deps);
    screens.showStart();
    btn('btn-start-continue').click();
    expect(deps.onContinue).toHaveBeenCalled();
    expect(screens.current()).toBe('гра');
    const fail = makeDeps({ hasSaves: () => true, continueDisabledReason: () => '', onContinue: vi.fn(() => false) });
    const s2 = createScreens(fail);
    s2.showStart();
    btn('btn-start-continue').click();
    expect(s2.current()).toBe('стартовий');
  });

  it('вимкнений «Продовжити» — клік no-op (навіть якщо стан розійшовся з render)', () => {
    const deps = makeDeps(); // hasSaves: false
    createScreens(deps).showStart();
    btn('btn-start-continue').click(); // прихований клік по disabled — обробник страхує
    expect(deps.onContinue).not.toHaveBeenCalled();
  });

  it('меню: відкриття/закриття, «Як грати» закриває меню, «Налаштування» — теж (п12.3)', () => {
    const deps = makeDeps();
    const screens = createScreens(deps);
    screens.showGame();
    screens.openMenu();
    expect(visible('game-menu')).toBe(true);
    btn('btn-menu-help').click();
    expect(deps.onHelp).toHaveBeenCalled();
    expect(visible('game-menu')).toBe(false);
    screens.openMenu();
    expect(btn('btn-menu-settings').disabled).toBe(false); // п12.3: пункт активний
    btn('btn-menu-settings').click();
    expect(deps.onSettings).toHaveBeenCalled(); // вікно — settings.ts (ADR-0065)
    expect(visible('game-menu')).toBe(false); // один діалог одночасно (ADR-0065)
    screens.openMenu();
    btn('btn-menu-close').click();
    expect(visible('game-menu')).toBe(false);
    screens.openMenu();
    screens.closeMenu();
    expect(visible('game-menu')).toBe(false);
  });

  it('вихід без незбережених дій — миттєвий; «на стартовий екран» без зайвих діалогів', () => {
    const deps = makeDeps({ hasUnsavedChanges: () => false });
    const screens = createScreens(deps);
    screens.showGame();
    screens.openMenu();
    btn('btn-menu-exit').click();
    expect(deps.onExitToStart).toHaveBeenCalled();
    expect(visible('exit-confirm')).toBe(false);
    expect(visible('game-menu')).toBe(false);
  });

  it('вихід з незбереженими діями — підтвердження; «Скасувати» лишає в грі, «Вийти» — onExitToStart', () => {
    const deps = makeDeps({ hasUnsavedChanges: () => true });
    const screens = createScreens(deps);
    screens.showGame();
    screens.openMenu();
    btn('btn-menu-exit').click();
    expect(deps.onExitToStart).not.toHaveBeenCalled();
    expect(visible('exit-confirm')).toBe(true);
    btn('btn-exit-no').click();
    expect(visible('exit-confirm')).toBe(false);
    expect(screens.current()).toBe('гра');
    btn('btn-menu-exit').click();
    btn('btn-exit-yes').click();
    expect(deps.onExitToStart).toHaveBeenCalled();
    expect(visible('exit-confirm')).toBe(false);
    expect(visible('game-menu')).toBe(false);
  });
});

// П13.4 (ADR-0068): лого стартового екрана — PNG-ассет з текстовим фолбеком.
// Фолбек — єдине місце правди для тестів: у headless jsdom ассет не
// завантажується, тож DOM-тести стартового екрана від PNG не залежать
// (критерій 1). Image стабиться фейком (детермінізм: onload/onerror — лише
// явні виклики в тесті, ADR-0003-дух без випадкових подій).
class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  src = '';
}

describe('П13.4: лого стартового екрана — PNG з текстовим фолбеком (ADR-0068)', () => {
  let probes: FakeImage[];

  beforeEach(() => {
    probes = [];
    vi.stubGlobal(
      'Image',
      class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        src = '';
        constructor() {
          probes.push(this as unknown as FakeImage);
        }
      }
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('критерій 1 — headless без ассета: текстовий фолбек «РУБІЖ», без img', () => {
    createScreens(makeDeps()).showStart();
    expect(probes).toHaveLength(1); // запит іде, але onload не спрацював
    const h1 = $('start-logo');
    expect(h1.textContent).toBe('РУБІЖ'); // фолбек — місце правди
    expect(h1.querySelector('img')).toBeNull();
    expect(h1.classList.contains('logo-loaded')).toBe(false);
  });

  it('успіх: <img> у #start-logo з alt «РУБІЖ», клас logo-loaded, текст лишається у DOM', () => {
    createScreens(makeDeps()).showStart();
    probes[0].onload!();
    const h1 = $('start-logo');
    const img = h1.querySelector('img');
    expect(img).not.toBeNull();
    expect(img!.id).toBe('start-logo-img');
    expect(img!.alt).toBe('РУБІЖ');
    expect(img!.getAttribute('src')).toContain('logo');
    expect(h1.classList.contains('logo-loaded')).toBe(true); // CSS ховає текст
    expect(h1.textContent).toBe('РУБІЖ'); // фолбек — джерело для тверджень
  });

  it('ліниво і один раз: повторні showStart не дублюють запит і <img>', () => {
    const screens = createScreens(makeDeps());
    screens.showStart();
    screens.showGame();
    screens.showStart(); // вихід у меню → назад на стартовий
    expect(probes).toHaveLength(1);
    probes[0].onload!();
    screens.showStart();
    expect($('start-logo').querySelectorAll('img')).toHaveLength(1);
  });

  it('недоступний ассет (провал завантаження): фолбек лишається, без img і класу', () => {
    createScreens(makeDeps()).showStart();
    // провал: жоден колбек не спрацював (onerror модуль не підписує — фолбек
    // і нічого не робити — еквівалентні за DOM-станом)
    const h1 = $('start-logo');
    expect(h1.textContent).toBe('РУБІЖ');
    expect(h1.querySelector('img')).toBeNull();
    expect(h1.classList.contains('logo-loaded')).toBe(false);
  });

  it('ліниво до показу: createScreens без showStart не завантажує ассет', () => {
    const screens = createScreens(makeDeps());
    screens.showGame();
    expect(probes).toHaveLength(0); // запит лише при першому showStart
  });
});
