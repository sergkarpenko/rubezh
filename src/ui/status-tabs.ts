// П12.4 (ADR-0065): вкладки статус-колонки «Загін»/«База»/«Система» — шар
// відображення (ADR-0037), ядро не зачіпається. Скелет #status-tabs — в
// index.html (мінімальні зміни розмітки, патерн settings.ts), контент
// генерує модуль. Панелі лишаються в DOM — видимість перемикається класом
// .hidden за атрибутом data-tab секції (контракти контенту панелей у
// DOM-тестах не залежать від видимості). Активна вкладка персиститься в
// localStorage поза сейвом (ADR-0026) ключем rubezh.settings.status-tab —
// розширюваний формат П12.3; помилки сховища — «тихо» (прецедент audio.ts:
// вибір у сесії працює, просто не запам'ятовується). Без анімацій:
// перемикання класів, idle → 0 перерисовок (ADR-0029). id нових елементів —
// префікс status-tab- без колізій з контрактами DOM-тестів (урок П11.6).
// Приглушення в бою — чинний механізм #status.dimmed (П6.3): вкладки живуть
// у колонці і приглушуються разом з нею, окремої логіки бою тут нема.

import { el } from './dom';

// Ідентифікатори вкладок: стабільні рядки у сховищі (формат розширювальний —
// нові вкладки = нові id, старі значення лишаються валідними).
export type StatusTabId = 'squad' | 'base' | 'system';

// Ключ персисту активної вкладки поза сейвом (розширюваний формат
// rubezh.settings.*, прецедент П12.3).
export const STATUS_TAB_KEY = 'rubezh.settings.status-tab';

// Вкладки у порядку відображення (ADR-0065): «Загін» — ростер, екіпірування
// (картка солдата ростера), фінанси; «База» — дослідження, цех;
// «Система» — збереження. Розподіл панелей «Сканери» і «Винищувач», які
// ADR-0065 не визначає, — рішення власника сесії П12.4: обидві в «Базі».
export const STATUS_TABS: ReadonlyArray<{ id: StatusTabId; label: string }> = [
  { id: 'squad', label: 'Загін' },
  { id: 'base', label: 'Вузол' },
  { id: 'system', label: 'Система' },
];

// Дефолтна вкладка — перша в порядку ADR-0065 («Загін»).
export const DEFAULT_STATUS_TAB: StatusTabId = 'squad';

// Мінімальний інтерфейс сховища (для моків у тестах); браузерна фабрика —
// проста: контракт «тихо» тримає createStatusTabs (як createSound в audio.ts)
// — помилка читання — дефолт, помилка запису — мовчки пропущений персист.
export interface StatusTabStore {
  read(): string | null;
  write(v: string): void;
}

const browserStore: StatusTabStore = {
  read: () => localStorage.getItem(STATUS_TAB_KEY),
  write: (v) => localStorage.setItem(STATUS_TAB_KEY, v),
};

export interface StatusTabsDeps {
  store?: StatusTabStore; // браузерний localStorage за замовчуванням
}

export interface StatusTabs {
  active(): StatusTabId; // активна вкладка (для тестів і зв'язок шару)
  set(id: StatusTabId): void; // перемкнути (клік або програмно) і персистити
}

// Збережене значення валідне, лише якщо збігається з id вкладки —
// стороннє/зіпсоване значення сховища ігнорується (дефолт).
// Контракт «тихо» тримає фабрика (прецедент createSound): помилка читання/
// запису будь-якого адаптера — дефолт/мовчки пропущений персист, без винятків.
function readStored(store: StatusTabStore): StatusTabId | null {
  let v: string | null = null;
  try {
    v = store.read();
  } catch {
    return null; // недоступне сховище — дефолтна вкладка
  }
  return STATUS_TABS.some((t) => t.id === v) ? (v as StatusTabId) : null;
}

export function createStatusTabs(deps: StatusTabsDeps = {}): StatusTabs {
  const store = deps.store ?? browserStore;
  const strip = el('status-tabs');
  // Кнопки вкладок — контент генерує модуль (патерн settings.ts);
  // data-tab дублює id для селекторів, id — унікальні з префіксом status-tab-.
  strip.innerHTML = STATUS_TABS.map((t) => '<button data-tab="' + t.id + '" id="status-tab-' + t.id + '">' + t.label + '</button>').join(
    ''
  );
  const buttons = new Map<StatusTabId, HTMLButtonElement>(
    STATUS_TABS.map((t) => {
      const b = el<HTMLButtonElement>('status-tab-' + t.id);
      b.onclick = () => set(t.id);
      return [t.id, b];
    })
  );
  // Панелі колонки — статична розмітка index.html з атрибутом data-tab;
  // секції без атрибута (журнал — окрема зона) модуль не чіпає.
  const panels = Array.from(document.querySelectorAll<HTMLElement>('#status section.panel[data-tab]'));

  let current = readStored(store) ?? DEFAULT_STATUS_TAB;

  // Перемикання: активна кнопка — клас .active, панелі вкладки видимі,
  // решта приховані класом .hidden (елементи лишаються в DOM — рендери
  // панелей у renderAll працюють без змін, ADR-0029 — без перерисовок).
  function set(id: StatusTabId): void {
    current = id;
    for (const [tid, b] of buttons) b.classList.toggle('active', tid === id);
    for (const p of panels) p.classList.toggle('hidden', (p.dataset.tab as StatusTabId) !== id);
    try {
      store.write(id); // тихо при помилках сховища (вибір живе лише в сесії)
    } catch {
      /* тихо */
    }
  }

  set(current); // початковий стан: збережена вкладка або дефолт
  return {
    active: () => current,
    set,
  };
}
