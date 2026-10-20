// П14.6 (ADR-0072): рамка панелей 9-slice — ліниве завантаження ассета
// assets/panel-frame.webp і перемикання шару відображення на border-image.
// Механізм — виключно CSS border-image (без JS-нарізки): slice-лінії —
// виміряні по фактичному ассету (761×709; смуги з запасом сяйва:
// top 116 / right 123 / bottom 107 / left 121), repeat: stretch, БЕЗ fill
// (центральна зона відкидається — фон панелей лишається кодовим, рішення
// власника: рамка — не фон панелі). Успіх завантаження → клас .panel-frame
// на body + CSS-змінна --panel-frame-url; CSS у index.html застосовує рамку
// ЛИШЕ під цим класом. Фолбек (ADR-0072, прецедент лого П13.4): при
// !loaded (headless/офлайн/без файла) панелі лишаються з чинною кодовою
// рамкою — тести від ассета не залежать, прогін без файлу зелений.
// Завантажувач інжектиться (патерн initUnitAtlas): модуль не знає
// DOM-глобалів поза document.body (клас/змінна), жодних rAF-анімацій
// (idle → 0 перерисовок, ADR-0029).

import panelFrameUrl from '../../assets/panel-frame.webp';

// Клас-прапорець готовності (друге джерело правди — CSS-селектори в index.html).
export const PANEL_FRAME_CLASS = 'panel-frame';

// CSS-змінна з URL ассета (ставиться на body разом з класом).
export const PANEL_FRAME_URL_VAR = '--panel-frame-url';

// Інжектований завантажувач: браузер — Image + onload; тести — мок
// (синхронний або «ніколи», патерн LoadUnitAtlas).
export type LoadPanelFrame = (url: string, onLoad: () => void) => void;

let panelFrameReady = false;

// Реєстрація завантажувача (і скидання стану — як initUnitAtlas: кожен тест
// ставить свій мок перед перевіркою фолбеку).
export function initPanelFrame(load: LoadPanelFrame): void {
  panelFrameReady = false;
  document.body.classList.remove(PANEL_FRAME_CLASS);
  load(panelFrameUrl, () => {
    panelFrameReady = true;
    // Змінну ставимо ДО класу: селектори під .panel-frame одразу бачать URL.
    document.body.style.setProperty(PANEL_FRAME_URL_VAR, 'url("' + panelFrameUrl + '")');
    document.body.classList.add(PANEL_FRAME_CLASS);
  });
}

// Прапорець готовності (фолбек рамки — !isPanelFrameReady).
export function isPanelFrameReady(): boolean {
  return panelFrameReady;
}
