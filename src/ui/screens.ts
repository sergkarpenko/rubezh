// П12.2 (ADR-0065): каркас екранів і навігації — стартовий екран, діалог
// нової партії, вікно «Меню» гри, підтвердження виходу. Модуль шару
// відображення (ADR-0037): не знає про ядро партії — дії подає через deps
// (старт нової партії, продовжити зі слота, «Як грати», вихід). Стан екранів
// ('стартовий' | 'гра') живе тут; ігровий екран — чинний каркас ADR-0027,
// який модуль лише показує/ховає класами. Переходи — миттєві перемикання
// класів, без rAF-анімацій (idle → 0 перерисовок, ADR-0029). id нових
// елементів — з префіксами start-/new-game-/menu-/exit- без колізій з
// контрактами DOM-тестів (урок П11.6). Ядро src/core не змінюється (ADR-0002).

import type { DifficultyPreset } from '../core/campaign';
import { el } from './dom';

// Стан шару відображення (ADR-0065): до вибору гравця партії немає —
// показується стартовий екран; після старту/продовження — ігровий екран.
export type ScreenName = 'стартовий' | 'гра';

// П12.3 (ADR-0065): вікно «Налаштування» — окремий крок; у п12.2 пункти
// присутні, але вимкнені з причиною (патерн кнопок з причиною — П6.14).
const SETTINGS_HINT = 'Вікно налаштувань — крок п12.3 (ADR-0065)';

export interface ScreensDeps {
  version: string; // версія гри (ADR-0054; у застосунку — __APP_VERSION__, патерн help.ts)
  hasSaves(): boolean; // «Продовжити» доступне: сховище живе і є хоч один слот (ADR-0026)
  continueDisabledReason(): string; // '' — доступно; інакше причина для тултіпа
  onNewGame(seed: number, preset: DifficultyPreset): void; // старт нової партії (ADR-0033)
  onContinue(): boolean; // завантажити останній активний слот; true — перехід у гру
  onHelp(): void; // «Як грати» — help.ts без змін (П9.1)
  hasUnsavedChanges(): boolean; // зміни після останнього збереження (ADR-0026: сейв лише вручну)
  onExitToStart(): void; // вихід на стартовий екран (після підтвердження, якщо потрібно)
}

export interface Screens {
  showStart(): void; // стартовий екран (логотип, меню, версія)
  showGame(): void; // ігровий екран — каркас ADR-0027 без змін
  current(): ScreenName;
  openMenu(): void; // вікно «Меню» у грі (кнопка «Меню» у топбарі)
  closeMenu(): void;
  render(): void; // синхронізувати стани пунктів (наприклад, «Продовжити»)
}

// Контент стартового екрана (конкатенація рядків — стиль шару відображення,
// патерн help.ts). Логотип текстовий — місце під PNG-ассет П13.4 (ADR-0068):
// секція #start-logo замінюється ассетом без змін навігації. Термінологія
// Розриву — одразу за мапою перейменувань ADR-0064 (щоб П12.6 не перероблював
// стартовий екран).
function startScreenHtml(version: string): string {
  return (
    '<div class="panel start-box">' +
    '<h1 class="start-logo" id="start-logo">РУБІЖ</h1>' +
    '<p class="start-tagline">Остання лінія оборони людства проти Аномалії «Розрив»</p>' +
    '<div class="start-menu">' +
    '<button id="btn-start-new">Нова партія</button>' +
    '<button id="btn-start-continue">Продовжити</button>' +
    '<button id="btn-start-settings" title="' +
    SETTINGS_HINT +
    '">Налаштування</button>' +
    '<button id="btn-start-help">Як грати</button>' +
    '</div>' +
    '<p class="start-version">Версія ' +
    version +
    '</p>' +
    '</div>'
  );
}

// Діалог нової партії (ADR-0033): сід + пресет складності — інпути
// мігрували з топбара (ADR-0065); дефолти ті самі, що були в топбарі.
function newGameDialogHtml(): string {
  return (
    '<div class="panel screen-dialog">' +
    '<h2>Нова партія</h2>' +
    '<label class="dialog-field">Сід <input id="new-game-seed" type="number" value="42" /></label>' +
    '<label class="dialog-field">Складність <select id="new-game-preset">' +
    '<option value="норма" selected>норма</option>' +
    '<option value="легкий">легкий</option>' +
    '<option value="складний">складний</option>' +
    '</select></label>' +
    '<div class="dialog-actions">' +
    '<button id="btn-new-game-start">Стартувати</button>' +
    '<button id="btn-new-game-cancel">Скасувати</button>' +
    '</div>' +
    '</div>'
  );
}

// Вікно «Меню» у грі (ADR-0065): налаштування (п12.3), «Як грати», вихід.
function gameMenuHtml(): string {
  return (
    '<div class="panel screen-dialog">' +
    '<h2>Меню</h2>' +
    '<div class="start-menu">' +
    '<button id="btn-menu-settings" title="' +
    SETTINGS_HINT +
    '">Налаштування</button>' +
    '<button id="btn-menu-help">Як грати</button>' +
    '<button id="btn-menu-exit">На стартовий екран</button>' +
    '<button id="btn-menu-close">Закрити</button>' +
    '</div>' +
    '</div>'
  );
}

// Підтвердження виходу з незбереженими діями (ADR-0026: сейв лише вручну —
// вихід не зберігає автоматично).
function exitConfirmHtml(): string {
  return (
    '<div class="panel screen-dialog">' +
    '<h2>Незбережені зміни</h2>' +
    '<p>Після останнього збереження були дії. Збереження — лише вручну: незбережений прогрес партії буде втрачено.</p>' +
    '<div class="dialog-actions">' +
    '<button id="btn-exit-yes">Вийти без збереження</button>' +
    '<button id="btn-exit-no">Скасувати</button>' +
    '</div>' +
    '</div>'
  );
}

export function createScreens(deps: ScreensDeps): Screens {
  // Скелетні секції — у index.html (мінімальні зміни розмітки, патерн
  // #help-screen); контент генерується тут.
  const startScreen = el('start-screen');
  const newGameDialog = el('new-game-dialog');
  const gameMenu = el('game-menu');
  const exitConfirm = el('exit-confirm');
  const topbar = el('topbar');
  const layout = el('layout');
  startScreen.innerHTML = startScreenHtml(deps.version);
  newGameDialog.innerHTML = newGameDialogHtml();
  gameMenu.innerHTML = gameMenuHtml();
  exitConfirm.innerHTML = exitConfirmHtml();

  let current: ScreenName = 'стартовий';

  // Продовжити: доступне лише при живих сейвах; причина — у тултіп (EARS
  // Фази 12: за відсутності сейвів пункт недоступний з причиною).
  function render(): void {
    const b = el<HTMLButtonElement>('btn-start-continue');
    const reason = deps.continueDisabledReason();
    b.disabled = !deps.hasSaves();
    b.title = reason === '' ? 'Завантажити останню збережену партію' : reason;
  }

  function showStart(): void {
    current = 'стартовий';
    render();
    startScreen.classList.remove('hidden');
    topbar.classList.add('hidden');
    layout.classList.add('hidden');
    closeMenu();
    hideDialogs();
  }

  function showGame(): void {
    current = 'гра';
    startScreen.classList.add('hidden');
    topbar.classList.remove('hidden');
    layout.classList.remove('hidden');
    closeMenu();
    hideDialogs();
  }

  function hideDialogs(): void {
    newGameDialog.classList.add('hidden');
    exitConfirm.classList.add('hidden');
  }

  function openMenu(): void {
    closeMenu();
    gameMenu.classList.remove('hidden'); // перемикання класу — без анімацій (ADR-0029)
  }

  function closeMenu(): void {
    gameMenu.classList.add('hidden');
    exitConfirm.classList.add('hidden');
  }

  // Вихід на стартовий екран: з підтвердженням, якщо після останнього
  // збереження були дії (ADR-0026); інакше — миттєво.
  function requestExit(): void {
    closeMenu();
    if (deps.hasUnsavedChanges()) {
      exitConfirm.classList.remove('hidden');
      return;
    }
    deps.onExitToStart();
  }

  el('btn-start-new').onclick = () => {
    newGameDialog.classList.remove('hidden');
  };
  el('btn-new-game-cancel').onclick = () => {
    newGameDialog.classList.add('hidden');
  };
  el('btn-new-game-start').onclick = () => {
    // Ті самі правила, що були в топбарі: порожній/нечисловий сід — 42;
    // невідомий пресет — «норма» (детермінізм валідації не міняється).
    const seed = Number(el<HTMLInputElement>('new-game-seed').value) || 42;
    const raw = el<HTMLSelectElement>('new-game-preset').value;
    const preset: DifficultyPreset = raw === 'легкий' || raw === 'складний' ? raw : 'норма';
    hideDialogs();
    deps.onNewGame(seed, preset);
  };
  el('btn-start-continue').onclick = () => {
    if (!deps.hasSaves()) return; // вимкнений пункт — no-op (страхування від прихованих кліків)
    if (deps.onContinue()) showGame();
  };
  el<HTMLButtonElement>('btn-start-settings').disabled = true; // п12.3: пункт присутній, вимкнений
  el('btn-start-help').onclick = () => deps.onHelp();

  el<HTMLButtonElement>('btn-menu-settings').disabled = true; // п12.3
  el('btn-menu-help').onclick = () => {
    closeMenu();
    deps.onHelp();
  };
  el('btn-menu-exit').onclick = requestExit;
  el('btn-menu-close').onclick = closeMenu;
  el('btn-exit-yes').onclick = () => {
    hideDialogs();
    deps.onExitToStart();
  };
  el('btn-exit-no').onclick = () => {
    exitConfirm.classList.add('hidden');
  };

  return {
    showStart,
    showGame,
    current: () => current,
    openMenu,
    closeMenu,
    render,
  };
}
