// П14.6 (ADR-0072): тести рамки панелей 9-slice — фолбек і перемикання.
// Контракти: (1) завантажувач «ніколи» → класу нема, панелі з кодовою рамкою
// (прогін без ассета зелений); (2) синхронний завантажувач → клас і
// CSS-змінна на body; (3) повторна ініціалізація скидає стан (патерн
// initUnitAtlas). DOM — мінімальний скелет: модуль чіпає лише body.
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { PANEL_FRAME_CLASS, PANEL_FRAME_URL_VAR, initPanelFrame, isPanelFrameReady, type LoadPanelFrame } from './panel-frame';

const never: LoadPanelFrame = () => undefined; // headless/офлайн/без файла

describe('П14.6 panel-frame: 9-slice рамка панелей', () => {
  beforeEach(() => {
    document.body.className = '';
    document.body.removeAttribute('style');
  });

  it('фолбек: без завантаження класу нема — панелі лишаються з кодовою рамкою', () => {
    initPanelFrame(never);
    expect(isPanelFrameReady()).toBe(false);
    expect(document.body.classList.contains(PANEL_FRAME_CLASS)).toBe(false);
    expect(document.body.style.getPropertyValue(PANEL_FRAME_URL_VAR)).toBe('');
  });

  it('успіх: синхронний завантажувач ставить клас і CSS-змінну на body', () => {
    const sync: LoadPanelFrame = (_url, onLoad) => {
      onLoad();
    };
    initPanelFrame(sync);
    expect(isPanelFrameReady()).toBe(true);
    expect(document.body.classList.contains(PANEL_FRAME_CLASS)).toBe(true);
    expect(document.body.style.getPropertyValue(PANEL_FRAME_URL_VAR)).toContain('panel-frame.webp');
  });

  it('повторна ініціалізація скидає стан (незалежні тести/сесії)', () => {
    const sync: LoadPanelFrame = (_url, onLoad) => {
      onLoad();
    };
    initPanelFrame(sync);
    initPanelFrame(never);
    expect(isPanelFrameReady()).toBe(false);
    expect(document.body.classList.contains(PANEL_FRAME_CLASS)).toBe(false);
  });
});
