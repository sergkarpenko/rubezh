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
import logoUrl from '../../assets/logo.webp';
import startBgUrl from '../../assets/start-bg.webp';

// Стан шару відображення (ADR-0065): до вибору гравця партії немає —
// показується стартовий екран; після старту/продовження — ігровий екран.
export type ScreenName = 'стартовий' | 'гра';

// П12.3 (ADR-0065): вікно «Налаштування» — окремий модуль src/ui/settings.ts;
// екрани лише відкривають його (deps.onSettings) зі стартового екрана і з меню.

export interface ScreensDeps {
  version: string; // версія гри (ADR-0054; у застосунку — __APP_VERSION__, патерн help.ts)
  hasSaves(): boolean; // «Продовжити» доступне: сховище живе і є хоч один слот (ADR-0026)
  continueDisabledReason(): string; // '' — доступно; інакше причина для тултіпа
  onNewGame(seed: number, preset: DifficultyPreset): void; // старт нової партії (ADR-0033)
  onContinue(): boolean; // завантажити останній активний слот; true — перехід у гру
  onHelp(): void; // «Як грати» — help.ts без змін (П9.1)
  onSettings(): void; // «Налаштування» — вікно settings.ts (П12.3, ADR-0065)
  onSave(): void; // Т.128 (ADR-0117): «Збереження» — вікно зі слотами (було вкладкою «Система»)
  hasUnsavedChanges(): boolean; // зміни після останнього збереження (ADR-0026: сейв лише вручну)
  onExitToStart(): void; // вихід на стартовий екран (після підтвердження, якщо потрібно)
}

export interface Screens {
  showStart(): void; // стартовий екран (логотип, меню, версія)
  showGame(): void; // ігровий екран — каркас ADR-0027 без змін
  current(): ScreenName;
  openMenu(): void; // вікно «Меню» у грі (кнопка «Меню» у топбарі)
  closeMenu(): void;
  requestExit(): void; // Т.58: вихід на стартовий екран з підтвердженням, якщо є незбережені дії (меню і екран перемоги)
  render(): void; // синхронізувати стани пунктів (наприклад, «Продовжити»)
}

// Контент стартового екрана (конкатенація рядків — стиль шару відображення,
// патерн help.ts). П13.4 (ADR-0068/0071): текстовий логотип — фолбек; ассет
// завантажується ліниво (loadLogo нижче) і вбудовується у той самий
// #start-logo — навігація не змінюється. Фолбек — єдине місце правди для
// тестів: у headless/офлайн/без файла onload не спрацює — текст лишається.
// Термінологія Розриву — одразу за мапою перейменувань ADR-0064 (щоб П12.6
// не перероблював стартовий екран).
// П14.7 (ADR-0072): вільна повноекранна компоновка — панель-коробку
// прибрано; .start-box лишається лише координатною сіткою CSS (лого+tagline
// у центрі — темний просвіт кільця кадру Б1, меню lower-center, версія
// внизу). Діалоги лишаються панелями .panel.screen-dialog з 9-slice (П14.6)
// і тут не зачіпаються.
function startScreenHtml(version: string): string {
  return (
    '<div class="start-box">' +
    // Т.93 (рішення власника 21.11.2026): пояснення невдалого «Продовжити» — банер угорі екрана,
    // поза стеком меню: над кнопками воно накривало підпис під логотипом (кандидат 63 (а))
    '<p class="start-note hidden" id="start-note" role="status"></p>' +
    '<div class="start-hero">' +
    '<h1 class="start-logo" id="start-logo"><span class="start-logo-text">РУБІЖ</span></h1>' +
    '<p class="start-tagline">Остання лінія оборони людства проти Аномалії «Розрив»</p>' +
    '</div>' +
    '<div class="start-menu">' +
    '<button id="btn-start-new">Нова партія</button>' +
    '<button id="btn-start-continue">Продовжити</button>' +
    '<button id="btn-start-settings" title="Налаштування гри — зберігаються у браузері">Налаштування</button>' +
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
  // Т.218 (відгук власника 27.11.2026: «сід та дропдаун, не зручно, не зрозуміло»; рішення —
  // картки складності): радіогрупа карток з описом, що змінює пресет (числа — DIFFICULTY_MULTIPLIERS);
  // сід — у «Додатково» з кнопкою «Випадковий». Перемальовування екрана — Фаза 21.
  const card = (value: DifficultyPreset, name: string, desc: string): string =>
    '<label class="preset-card">' +
    `<input type="radio" name="new-game-preset" value="${value}"${value === 'норма' ? ' checked' : ''} />` +
    `<span class="preset-name">${name}</span><span class="preset-desc">${desc}</span></label>`;
  return (
    '<div class="panel screen-dialog">' +
    '<h2>Нова партія</h2>' +
    '<div class="preset-cards" id="new-game-preset" role="radiogroup" aria-label="Складність">' +
    card('легкий', 'Легкий', PRESET_TEXT['легкий']) +
    card('норма', 'Норма', PRESET_TEXT['норма']) +
    card('складний', 'Складний', PRESET_TEXT['складний']) +
    '</div>' +
    '<details class="dialog-more" id="new-game-more"><summary>Додатково</summary>' +
    '<label class="dialog-field">Сід <input id="new-game-seed" type="number" value="42" /></label>' +
    '<button id="btn-new-game-random" type="button" title="Випадковий сід партії">Випадковий</button>' +
    '</details>' +
    '<div class="dialog-actions">' +
    '<button id="btn-new-game-start">Стартувати</button>' +
    '<button id="btn-new-game-cancel">Скасувати</button>' +
    '</div>' +
    '</div>'
  );
}

// Т.218: описи карток складності (тексти власника дослівно).
export const PRESET_TEXT: Readonly<Record<DifficultyPreset, string>> = {
  легкий: 'Зондів менше (×0,7), бійці міцніші (HP ×1,2), наука вдвічі дешевша, дотація, премії й найм ×1,2',
  норма: 'Базові числа гри',
  складний: 'Бійці слабші (HP ×0,9), дотація, премії й найм ×0,9',
};

// Вікно «Меню» у грі (ADR-0065): Т.128 — «Збереження» (ADR-0117), налаштування (п12.3), «Як грати», вихід.
function gameMenuHtml(): string {
  return (
    '<div class="panel screen-dialog">' +
    '<h2>Меню</h2>' +
    '<div class="start-menu">' +
    '<button id="btn-menu-save" data-icon="save" title="Зберегти, завантажити або видалити партію">Збереження</button>' +
    '<button id="btn-menu-settings" title="Налаштування гри — зберігаються у браузері">Налаштування</button>' +
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

// Т.58 (рішення власника 17.11.2026): текст на стартовому екрані після невдалого «Продовжити»
export const CONTINUE_FAILED_TEXT = 'Не вдалося завантажити збереження. Почніть нову гру.';

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
  // П14.7 (ADR-0072/0071): фон стартового екрана — обраний власником кадр
  // Б1 «Лінія оборони» (assets/start-bg.webp; конвертація з JPG власника —
  // один цикл стиснення WebP q92, PSNR 46.5 дБ проти оригіналу, розмір
  // 1376×768 без звуження). URL — з vite-імпорту (base-аварійний); це
  // CSS-фон, не Image-завантаження (прецедент П13.4): headless/офлайн/без
  // файла бачать суцільний колір #060a14 з CSS (фолбек — той самий вигляд
  // без зображення, тести від ассета не залежать).
  startScreen.style.backgroundImage = `url("${startBgUrl}")`;
  newGameDialog.innerHTML = newGameDialogHtml();
  gameMenu.innerHTML = gameMenuHtml();
  exitConfirm.innerHTML = exitConfirmHtml();

  let current: ScreenName = 'стартовий';

  // П13.4 (ADR-0068/0071): ліниве завантаження ассета лого (WebP) — один раз, при
  // першому показі стартового екрана. URL — з vite-імпорту (base-аварійний:
  // і корінь, і прев'ю гілок, ADR-0060). При успіху <img> вбудовується у
  // #start-logo, клас logo-loaded ховає текст; при недоступності ассета
  // (headless/офлайн/відсутній файл) onload/onerror не змінює DOM —
  // текстовий фолбек лишається. Без rAF-анімацій (idle → 0 перерисовок).
  let logoRequested = false;
  function loadLogo(): void {
    if (logoRequested) return;
    logoRequested = true;
    const probe = new Image();
    probe.onload = () => {
      const logo = document.createElement('img');
      logo.id = 'start-logo-img';
      logo.className = 'start-logo-img';
      logo.alt = 'РУБІЖ';
      logo.src = logoUrl;
      el('start-logo').insertBefore(logo, el('start-logo').firstChild);
      el('start-logo').classList.add('logo-loaded');
    };
    probe.src = logoUrl;
  }

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
    showNote(''); // Т.58: пояснення невдалого «Продовжити» живе до наступного показу екрана
    render();
    loadLogo(); // П13.4: ліниво, один раз (ADR-0068)
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

  // Т.58: рядок-пояснення стартового екрана (з Т.93 — банер угорі); порожній текст — сховати
  function showNote(text: string): void {
    const note = el('start-note');
    // Т.93: спершу показати, потім текст — live-регіон role="status" уже в дереві доступності, і зчитувач оголосить зміну
    note.classList.toggle('hidden', text === '');
    note.textContent = text;
  }

  function hideDialogs(): void {
    newGameDialog.classList.add('hidden');
    exitConfirm.classList.add('hidden');
  }

  function openMenu(): void {
    closeMenu();
    gameMenu.classList.remove('hidden'); // перемикання класу — без анімацій (ADR-0029)
    el<HTMLButtonElement>('btn-menu-close').focus(); // Т.73: фокус на безпечну кнопку «Закрити»
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
      el<HTMLButtonElement>('btn-exit-no').focus(); // Т.73: фокус на безпечну кнопку «Скасувати»
      return;
    }
    deps.onExitToStart();
  }

  el('btn-start-new').onclick = () => {
    newGameDialog.classList.remove('hidden');
  };
  // Т.218: випадковий сід — у шарі UI (ядро детерміноване, ADR-0003: сід лише вхід партії)
  el('btn-new-game-random').onclick = () => {
    el<HTMLInputElement>('new-game-seed').value = String(1 + Math.floor(Math.random() * 999999));
  };
  el('btn-new-game-cancel').onclick = () => {
    newGameDialog.classList.add('hidden');
  };
  el('btn-new-game-start').onclick = () => {
    // Ті самі правила, що були в топбарі: порожній/нечисловий сід — 42;
    // невідомий пресет — «норма» (детермінізм валідації не міняється).
    const seed = Number(el<HTMLInputElement>('new-game-seed').value) || 42;
    const raw = newGameDialog.querySelector<HTMLInputElement>('input[name="new-game-preset"]:checked')?.value;
    const preset: DifficultyPreset = raw === 'легкий' || raw === 'складний' ? raw : 'норма';
    hideDialogs();
    deps.onNewGame(seed, preset);
  };
  el('btn-start-continue').onclick = () => {
    if (!deps.hasSaves()) return; // вимкнений пункт — no-op (страхування від прихованих кліків)
    if (deps.onContinue()) showGame();
    else showNote(CONTINUE_FAILED_TEXT); // Т.58: слот не розібрано — пояснити, а не мовчати
  };
  el('btn-start-settings').onclick = () => deps.onSettings(); // п12.3: вікно налаштувань
  el('btn-start-help').onclick = () => deps.onHelp();

  el('btn-menu-save').onclick = () => {
    closeMenu(); // один діалог одночасно (ADR-0065)
    deps.onSave();
  };
  el('btn-menu-settings').onclick = () => {
    closeMenu(); // один діалог одночасно (глибина навігації — ADR-0065)
    deps.onSettings();
  };
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
    requestExit,
    render,
  };
}
