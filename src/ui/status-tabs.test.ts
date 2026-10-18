// @vitest-environment jsdom
// П12.4 (ADR-0065): тести вкладок статус-колонки — перемикання «Загін»/
// «База»/«Система», панелі лишаються в DOM (приховані класом, не вилучені),
// усі 7 панелей досяжні вкладками (жодна не втрачена), персист активної
// вкладки між «сесіями» сховища (localStorage поза сейвом, ADR-0026),
// контракт «тихо» на зламаному сховищі, 0 rAF (ADR-0029). Скелет — ті самі
// id/структура, що й в index.html (контент вкладок генерує модуль).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStatusTabs, DEFAULT_STATUS_TAB, STATUS_TAB_KEY, STATUS_TABS, type StatusTabId, type StatusTabStore } from './status-tabs';

// Скелет — дзеркало колонки в index.html: #status-tabs + 7 панелей з
// data-tab (порядок і розподіл — як у розмітці, щоб тест ловив дрейф).
const SKELETON = `
<aside id="status">
  <div id="status-tabs"></div>
  <section class="panel" data-tab="base"><h2>Сканери (виявлені НЛО)</h2><div id="ufos"></div></section>
  <section class="panel" data-tab="base"><h2>Винищувач</h2><div id="fighter"></div></section>
  <section class="panel" data-tab="squad"><h2>Фінанси</h2><b id="money-card">300</b><button id="btn-hire">Найм</button></section>
  <section class="panel" data-tab="base"><h2>Дослідження</h2><div id="research"></div></section>
  <section class="panel" data-tab="base"><h2>Цех</h2><div id="workshop"></div></section>
  <section class="panel" data-tab="squad"><h2>Ростер загону</h2><div id="roster">6 солдатів</div></section>
  <section class="panel" data-tab="system"><h2>Збереження</h2><div id="save-panel"></div></section>
</aside>`;

const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const btn = (id: string): HTMLButtonElement => $(id) as HTMLButtonElement;
const panels = (): HTMLElement[] => Array.from(document.querySelectorAll('#status section.panel[data-tab]'));
const visible = (p: HTMLElement): boolean => !p.classList.contains('hidden');
const visibleIds = (tab: StatusTabId): string[] =>
  panels()
    .filter((p) => p.dataset.tab === tab)
    .map((p) => p.querySelector('h2')!.textContent ?? '');

let rafCalls = 0;

// Сховище, що кидає (приватний режим) — контракт «тихо».
const boomStore = (): StatusTabStore => {
  const boom = (): never => {
    throw new Error('storage blocked');
  };
  return { read: boom, write: boom };
};

beforeEach(() => {
  document.body.innerHTML = SKELETON;
  localStorage.clear();
  rafCalls = 0;
  vi.stubGlobal('requestAnimationFrame', () => {
    rafCalls++;
  });
});

describe('П12.4: вкладки статус-колонки — перемикання (ADR-0065)', () => {
  it('init: три кнопки «Загін»/«База»/«Система», дефолт — «Загін», панелі інших вкладок приховані класом', () => {
    const tabs = createStatusTabs();
    expect(tabs.active()).toBe(DEFAULT_STATUS_TAB);
    expect(tabs.active()).toBe('squad');
    for (const t of STATUS_TABS) {
      expect(btn('status-tab-' + t.id).textContent).toBe(t.label); // id без колізій (урок П11.6)
      expect(btn('status-tab-' + t.id).classList.contains('active')).toBe(t.id === 'squad');
    }
    // «Загін»: фінанси і ростер видимі, «База»/«Система» приховані
    expect(visibleIds('squad')).toEqual(['Фінанси', 'Ростер загону']);
    expect(visibleIds('base')).toEqual(['Сканери (виявлені НЛО)', 'Винищувач', 'Дослідження', 'Цех']);
    expect(visibleIds('system')).toEqual(['Збереження']);
    expect(
      panels()
        .filter(visible)
        .map((p) => p.querySelector('h2')!.textContent)
    ).toEqual(['Фінанси', 'Ростер загону']);
  });

  it('клік перемикає видимість: усі 7 панелей у DOM, кожна досяжна своєю вкладкою (жодна не втрачена)', () => {
    createStatusTabs();
    expect(panels().length).toBe(7); // панелі лишаються в DOM — не вилучаються
    btn('status-tab-base').click();
    expect(
      panels()
        .filter(visible)
        .map((p) => p.querySelector('h2')!.textContent)
    ).toEqual(['Сканери (виявлені НЛО)', 'Винищувач', 'Дослідження', 'Цех']);
    expect(btn('status-tab-squad').classList.contains('active')).toBe(false);
    // приховані панелі зберігають контент (контракти DOM-тестів не послаблюються)
    expect($('roster').textContent).toBe('6 солдатів');
    btn('status-tab-system').click();
    expect(
      panels()
        .filter(visible)
        .map((p) => p.querySelector('h2')!.textContent)
    ).toEqual(['Збереження']);
    // обхід усіх вкладок: кожна з 7 панелей хоч раз видимa
    const seen = new Set<string>();
    for (const t of STATUS_TABS) {
      btn('status-tab-' + t.id).click();
      for (const p of panels().filter(visible)) seen.add(p.querySelector('h2')!.textContent ?? '');
    }
    expect(seen.size).toBe(7);
  });

  it('set(): програмне перемикання — той самий стан, що й клік', () => {
    const tabs = createStatusTabs();
    tabs.set('system');
    expect(tabs.active()).toBe('system');
    expect(panels().filter(visible).length).toBe(1);
    expect(visible(panels()[6])).toBe(true); // збереження
  });

  it('перемикання — без rAF-анімацій (0 викликів, ADR-0029)', () => {
    createStatusTabs();
    btn('status-tab-base').click();
    btn('status-tab-system').click();
    btn('status-tab-squad').click();
    expect(rafCalls).toBe(0);
  });
});

describe('П12.4: персист активної вкладки поза сейвом (ADR-0026)', () => {
  it('вибір зберігається між «сесіями» сховища: ключ rubezh.settings.status-tab', () => {
    createStatusTabs();
    btn('status-tab-base').click(); // вибір користувача — одразу в localStorage
    expect(localStorage.getItem(STATUS_TAB_KEY)).toBe('base');
    // «нова сесія браузера»: свіжий модуль читає той самий ключ
    document.body.innerHTML = SKELETON;
    const again = createStatusTabs();
    expect(again.active()).toBe('base');
    expect(panels().filter(visible).length).toBe(4); // панелі «Бази»
  });

  it('дефолт: ключ відсутній — активна перша вкладка ADR-0065 («Загін»)', () => {
    expect(localStorage.getItem(STATUS_TAB_KEY)).toBeNull();
    expect(createStatusTabs().active()).toBe(DEFAULT_STATUS_TAB);
  });

  it('зіпсоване/стороннє значення ключа ігнорується — дефолт', () => {
    localStorage.setItem(STATUS_TAB_KEY, 'немає-такої-вкладки');
    expect(createStatusTabs().active()).toBe('squad');
  });

  it('зламане сховище — тихо: init і перемикання працюють, без винятків', () => {
    const tabs = createStatusTabs({ store: boomStore() });
    expect(tabs.active()).toBe('squad'); // читання впало — дефолт
    expect(() => btn('status-tab-system').click()).not.toThrow(); // запис впав — мовчки
    expect(tabs.active()).toBe('system'); // вибір у сесії працює
    expect(
      panels()
        .filter(visible)
        .map((p) => p.querySelector('h2')!.textContent)
    ).toEqual(['Збереження']);
  });
});
