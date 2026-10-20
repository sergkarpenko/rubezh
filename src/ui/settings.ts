// src/ui/settings.ts (П12.3, ADR-0065): вікно «Налаштування» — модальний діалог
// шару відображення (ADR-0037). Скелет #settings-dialog — в index.html
// (мінімальні зміни розмітки, патерн screens.ts/help.ts), контент генерує
// модуль. Секція «Звук»: тумблер мігрував з топбара (П11.7); єдине джерело
// стану — аудіо-модуль (enabled()/toggle(), ADR-0059), модуль не кешує стан.
// Секція «Анімація» (П14.8, ADR-0073): тумблер ambient-анімацій — єдине
// джерело стану ambient-модуль (src/ui/ambient.ts), той самий патерн.
// Збереження — одразу в localStorage поза сейвом (ADR-0026, ключі
// rubezh.settings.* — розширюваний формат); помилки сховища — тихо
// (контракт аудіо-модуля). Без анімацій: перемикання класів, idle → 0
// перерисовок (ADR-0029). id нових елементів — префікс settings- без
// колізій з контрактами DOM-тестів (урок П11.6).

import { el } from './dom';

// Мінімальний інтерфейс тумблера звуку: стан і персист живуть в аудіо-модулі
// (ADR-0059) — вікно лише читає/перемикає, не дублюючи сховище.
export interface SettingsSound {
  enabled(): boolean; // увімкнено (дефолт — так, ADR-0059)
  toggle(): boolean; // перемкнути і персистити; новий стан
}

// П14.8 (ADR-0073): тумблер ambient-анімацій — той самий контракт, що й звук:
// стан і персист (rubezh.settings.ambient) живуть в ambient-модулі
// (src/ui/ambient.ts); вікно лише читає/перемикає.
export interface SettingsAmbient {
  enabled(): boolean; // увімкнено (дефолт — так, ADR-0073 п.3)
  toggle(): boolean; // перемкнути і персистити; новий стан
}

export interface SettingsDeps {
  sound: SettingsSound;
  ambient: SettingsAmbient; // П14.8: секція «Анімація»
}

export interface Settings {
  open(): void; // показати (синхронізує секції з актуальним станом)
  close(): void;
  isOpen(): boolean;
  render(): void; // синхронізувати підписи (стан живе в аудіо-модулі)
}

// Контент вікна (конкатенація рядків — стиль шару відображення, патерн
// screens.ts). Формат розширювальний (ADR-0065): нові опції — нові секції
// з id префіксу settings-, без змін каркасу вікна.
function settingsHtml(): string {
  return (
    '<div class="panel screen-dialog">' +
    '<h2>Налаштування</h2>' +
    '<h3>Звук</h3>' +
    '<p>Синтезовані звукові ефекти. Зміни зберігаються у браузері одразу, поза сейвом.</p>' +
    '<button id="settings-sound">Звук: увімк</button>' +
    '<h3>Анімація</h3>' +
    '<p>Живі ефекти сцени: свічення стін, радар, вогні міст. Зміни зберігаються у браузері одразу, поза сейвом.</p>' +
    '<button id="settings-ambient">Анімація: увімк</button>' +
    '<div class="dialog-actions">' +
    '<button id="settings-close">Закрити</button>' +
    '</div>' +
    '</div>'
  );
}

export function createSettings(deps: SettingsDeps): Settings {
  const dialog = el('settings-dialog');
  dialog.innerHTML = settingsHtml();
  const soundBtn = el<HTMLButtonElement>('settings-sound');
  const ambientBtn = el<HTMLButtonElement>('settings-ambient');

  function render(): void {
    soundBtn.textContent = deps.sound.enabled() ? 'Звук: увімк' : 'Звук: вимк';
    ambientBtn.textContent = deps.ambient.enabled() ? 'Анімація: увімк' : 'Анімація: вимк';
  }

  function open(): void {
    render();
    dialog.classList.remove('hidden'); // перемикання класу — без анімацій (ADR-0029)
  }

  function close(): void {
    dialog.classList.add('hidden');
  }

  soundBtn.onclick = () => {
    deps.sound.toggle(); // персист — в аудіо-модулі, тихо при помилках сховища
    render();
  };
  // П14.8 (ADR-0073): тумблер «Анімація» — той самий патерн; персист
  // (rubezh.settings.ambient) і старт/стоп циклу — в ambient-модулі.
  ambientBtn.onclick = () => {
    deps.ambient.toggle();
    render();
  };
  el('settings-close').onclick = close;

  return {
    open,
    close,
    isOpen: () => !dialog.classList.contains('hidden'),
    render,
  };
}
