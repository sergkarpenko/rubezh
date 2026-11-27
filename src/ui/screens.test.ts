// @vitest-environment jsdom
// П12.2 (ADR-0065): юніт-тести каркасу екранів і навігації (src/ui/screens.ts).
// Критерії П12.2: флоу екранів і діалогів через DOM, пункти з причинами
// вимкнення (продовжити без сейвів, налаштування — п12.3), переходи без
// rAF-анімацій (idle → 0 перерисовок, ADR-0029). Повний флоу із сейвами —
// у src/main.ui.test.ts (там живе панель збереження).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONTINUE_FAILED_TEXT, PRESET_TEXT, SCENARIO_FAILED_TEXT, createScreens, keepMultiplier, type ScreensDeps } from './screens';

// Т.218: складність у «Новій партії» — радіогрупа карток (обрана / вибрати)
function presetOf(): string | undefined {
  return document.querySelector<HTMLInputElement>('input[name="new-game-preset"]:checked')?.value;
}
function pickPreset(v: string): void {
  for (const r of document.querySelectorAll<HTMLInputElement>('input[name="new-game-preset"]')) r.checked = r.value === v;
}

// Скелетні секції — ті самі id, що й в index.html (контент генерує модуль).
const SKELETON =
  '<header id="topbar" class="hidden"></header>' +
  '<main id="layout" class="hidden"></main>' +
  '<section id="start-screen" class="hidden"></section>' +
  '<section id="new-game-dialog" class="hidden"></section>' +
  '<section id="scenario-dialog" class="hidden"></section>' +
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
    onScenario: vi.fn(() => true),
    onHelp: vi.fn(),
    onSettings: vi.fn(),
    onSave: vi.fn(),
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
    expect(presetOf()).toBe('норма');
    btn('btn-new-game-cancel').click();
    expect(visible('new-game-dialog')).toBe(false);
    expect(deps.onNewGame).not.toHaveBeenCalled();
  });

  it('підтвердження: сід і пресет передаються; нечисловий сід — 42 (валідація топбара)', () => {
    const deps = makeDeps();
    createScreens(deps).showStart();
    btn('btn-start-new').click();
    ($('new-game-seed') as HTMLInputElement).value = '7';
    pickPreset('легкий');
    btn('btn-new-game-start').click();
    expect(deps.onNewGame).toHaveBeenCalledWith(7, 'легкий');
    expect(visible('new-game-dialog')).toBe(false);
    btn('btn-start-new').click();
    ($('new-game-seed') as HTMLInputElement).value = 'не число';
    pickPreset('казус'); // невідомий — «норма»
    btn('btn-new-game-start').click();
    expect(deps.onNewGame).toHaveBeenLastCalledWith(42, 'норма');
  });

  it('Т.218: картки складності з описом пресета, сід — у «Додатково», «Випадковий» дає число 1–999999', () => {
    createScreens(makeDeps()).showStart();
    btn('btn-start-new').click();
    const cards = [...document.querySelectorAll<HTMLElement>('#new-game-preset .preset-card')];
    expect(cards.map((c) => c.querySelector('.preset-name')?.textContent)).toEqual(['Легкий', 'Норма', 'Складний']);
    // тексти власника (Т.218); Т.221 — нерозривний пробіл перед «×» (кандидат 209 (ж))
    expect(cards.map((c) => c.querySelector('.preset-desc')?.textContent?.replace(/\u00a0/g, ' '))).toEqual([
      'Зондів менше (×0,7), бійці міцніші (HP ×1,2), наука вдвічі дешевша, дотація, премії й найм ×1,2',
      'Базові числа гри',
      'Бійці слабші (HP ×0,9), дотація, премії й найм ×0,9',
    ]);
    expect(cards.map((c) => c.querySelector('.preset-desc')?.textContent)).toEqual(
      (['легкий', 'норма', 'складний'] as const).map((p) => keepMultiplier(PRESET_TEXT[p]))
    );
    expect(PRESET_TEXT['норма']).toBe('Базові числа гри');
    expect($('new-game-seed').closest('details')?.querySelector('summary')?.textContent).toBe('Додатково');
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      btn('btn-new-game-random').click();
    } finally {
      rnd.mockRestore();
    }
    expect(($('new-game-seed') as HTMLInputElement).value).toBe('500000');
  });

  it('Т.221: keepMultiplier — нерозривний пробіл перед кожним «×», решта тексту без змін', () => {
    expect(keepMultiplier('премії й найм ×1,2')).toBe('премії й найм\u00a0×1,2');
    expect(keepMultiplier('(HP ×0,9), найм ×0,9')).toBe('(HP\u00a0×0,9), найм\u00a0×0,9');
    expect(keepMultiplier('Базові числа гри')).toBe('Базові числа гри');
    expect(keepMultiplier('×2 на початку')).toBe('×2 на початку'); // без пробілу перед — без змін
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

  it('Т.128 (ADR-0117): «Збереження» — перший пункт меню, перед «Налаштуваннями»; клік закриває меню і відкриває вікно (onSave)', () => {
    const deps = makeDeps();
    const screens = createScreens(deps);
    screens.showGame();
    screens.openMenu();
    const items = [...$('game-menu').querySelectorAll('button')].map((b) => b.id);
    expect(items).toEqual(['btn-menu-save', 'btn-menu-settings', 'btn-menu-help', 'btn-menu-exit', 'btn-menu-close']);
    expect(btn('btn-menu-save').textContent).toBe('Збереження');
    expect(btn('btn-menu-save').dataset.icon).toBe('save'); // іконку ставить decorateIcons (main.ts)
    btn('btn-menu-save').click();
    expect(deps.onSave).toHaveBeenCalledTimes(1);
    expect(visible('game-menu')).toBe(false); // один діалог одночасно (ADR-0065)
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

// П13.4 (ADR-0068/0071): лого стартового екрана — ассет (WebP) з текстовим фолбеком.
// Фолбек — єдине місце правди для тестів: у headless jsdom ассет не
// завантажується, тож DOM-тести стартового екрана від ассета не залежать
// (критерій 1). Image стабиться фейком (детермінізм: onload/onerror — лише
// явні виклики в тесті, ADR-0003-дух без випадкових подій).
class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  src = '';
}

describe('П13.4: лого стартового екрана — ассет з текстовим фолбеком (ADR-0068/0071)', () => {
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
    // Т.150: знімає й стаб rAF верхнього beforeEach — безпечно, бо той ставить його знову перед кожним тестом файла
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

// Т.58 (кандидат 54; рішення власника 17.11.2026): пояснення невдалого «Продовжити» і вихід для екрана перемоги
describe('Т.58: пояснення невдалого «Продовжити», requestExit', () => {
  const TEXT = 'Не вдалося завантажити збереження. Почніть нову гру.';

  it('Т.58: невдале «Продовжити» показує рядок-пояснення (Т.93 — банер угорі); showStart його прибирає; вдале — рядка немає', () => {
    expect(CONTINUE_FAILED_TEXT).toBe(TEXT);
    let ok = false;
    const screens = createScreens(makeDeps({ hasSaves: () => true, continueDisabledReason: () => '', onContinue: () => ok }));
    screens.showStart();
    expect(visible('start-note')).toBe(false);
    expect($('start-note').textContent).toBe('');
    expect($('start-note').parentElement?.classList.contains('start-box')).toBe(true); // Т.93: банер поза стеком меню
    expect($('start-note').getAttribute('role')).toBe('status');
    btn('btn-start-continue').click();
    expect(screens.current()).toBe('стартовий');
    expect(visible('start-note')).toBe(true);
    expect($('start-note').textContent).toBe(TEXT);
    screens.showStart(); // наступний показ стартового екрана
    expect(visible('start-note')).toBe(false);
    expect($('start-note').textContent).toBe('');
    ok = true;
    btn('btn-start-continue').click();
    expect(screens.current()).toBe('гра');
    expect(visible('start-note')).toBe(false);
  });

  it('Т.58: requestExit — з незбереженими діями підтвердження, без них вихід одразу; меню закривається', () => {
    let dirty = true;
    const deps = makeDeps({ hasUnsavedChanges: () => dirty });
    const screens = createScreens(deps);
    screens.showGame();
    screens.openMenu();
    screens.requestExit();
    expect(visible('game-menu')).toBe(false);
    expect(visible('exit-confirm')).toBe(true);
    expect(deps.onExitToStart).not.toHaveBeenCalled();
    btn('btn-exit-no').click();
    dirty = false;
    screens.requestExit();
    expect(visible('exit-confirm')).toBe(false);
    expect(deps.onExitToStart).toHaveBeenCalledTimes(1);
  });
});

describe('Т.218: «Сценарії для перевірки» — посилання в рядку версії і вікно віх', () => {
  it('посилання відкриває вікно з сімома віхами, фокус — на першій; «Скасувати» закриває без дії', () => {
    const deps = makeDeps();
    createScreens(deps).showStart();
    expect(document.querySelector('.start-version #btn-start-scenarios')?.textContent).toBe('Сценарії');
    btn('btn-start-scenarios').click();
    expect(visible('scenario-dialog')).toBe(true);
    const items = [...document.querySelectorAll<HTMLButtonElement>('#scenario-dialog .scenario-item')];
    expect(items.map((b) => b.dataset.scenario)).toEqual(['kinds', 'arsenal', 'assault', 'gate', 'gate-retry', 'edge', 'fleet']);
    expect(items[3].querySelector('.scenario-title')?.textContent).toBe('Перед Брамою');
    expect(document.activeElement).toBe(items[0]);
    btn('btn-scenario-cancel').click();
    expect(visible('scenario-dialog')).toBe(false);
    expect(document.activeElement).toBe(btn('btn-start-scenarios'));
    expect(deps.onScenario).not.toHaveBeenCalled();
  });

  it('вибір віхи — onScenario з id і перехід у гру; невдача — банер на стартовому екрані', () => {
    const deps = makeDeps();
    createScreens(deps).showStart();
    btn('btn-start-scenarios').click();
    document.querySelector<HTMLButtonElement>('[data-scenario="gate"]')!.click();
    expect(deps.onScenario).toHaveBeenCalledWith('gate');
    expect(visible('scenario-dialog')).toBe(false);
    expect(visible('layout')).toBe(true);
    const bad = makeDeps({ onScenario: vi.fn(() => false) });
    document.body.innerHTML = SKELETON;
    createScreens(bad).showStart();
    btn('btn-start-scenarios').click();
    document.querySelector<HTMLButtonElement>('[data-scenario="edge"]')!.click();
    expect(visible('start-screen')).toBe(true);
    expect($('start-note').textContent).toBe(SCENARIO_FAILED_TEXT);
  });
});
