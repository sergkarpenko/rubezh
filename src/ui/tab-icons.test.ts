// П14.6 (ADR-0072): тести іконок вкладок — матриці кодом, контракти DOM.
// Перевіряється: decorateTabButtons ставить canvas.tab-icon першою дитиною
// кожної кнопки #status-tabs/#log-tabs, текст кнопок (контракт textContent
// уроку П11.6) не змінюється, виклик idempotent, невідомі ключі пропускаються.
// jsdom без 2d-контексту: drawTabIcon мовчки пропускає — канва все одно
// prepend'иться (контракт структури від рендера не залежить).
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { TAB_ICON_SIZE, TAB_ICONS, decorateTabButtons } from './tab-icons';

const STRIP = `
<div id="status-tabs">
  <button data-tab="squad" id="status-tab-squad">Загін</button>
  <button data-tab="base" id="status-tab-base">Вузол</button>
  <button data-tab="system" id="status-tab-system">Система</button>
</div>
<div id="log-tabs">
  <button class="active" data-filter="all" id="log-tab-all">Усе</button>
  <button data-filter="geo" id="log-tab-geo">Геосцена</button>
  <button data-filter="econ" id="log-tab-econ">Економіка</button>
  <button data-filter="battle" id="log-tab-battle">Бій</button>
  <button data-filter="base" id="log-tab-base">Вузол</button>
  <button data-filter="unknown" id="log-tab-x">Інше</button>
</div>`;

describe('П14.6 tab-icons: іконки вкладок піксель-матрицями', () => {
  beforeEach(() => {
    document.body.innerHTML = STRIP;
  });

  it('усі ключі вкладок мають іконки (status + журнал, «Вузол» спільний)', () => {
    expect(Object.keys(TAB_ICONS).sort()).toEqual(['all', 'base', 'battle', 'econ', 'geo', 'squad', 'system']);
    for (const icon of Object.values(TAB_ICONS)) {
      expect(icon.rows.length).toBe(12);
      for (const row of icon.rows) expect(row.length).toBe(12);
    }
  });

  it('decorate: canvas.tab-icon першою дитиною кожної відомої кнопки, textContent не змінюється', () => {
    const before = Array.from(document.querySelectorAll('#status-tabs button, #log-tabs button')).map((b) => b.textContent);
    decorateTabButtons();
    const known = Array.from(document.querySelectorAll<HTMLButtonElement>('#status-tabs button, #log-tabs button')).filter(
      (b) => b.dataset.filter !== 'unknown'
    );
    expect(known.length).toBe(8);
    for (const b of known) {
      const cv = b.querySelector('canvas.tab-icon') as HTMLCanvasElement | null;
      expect(cv).not.toBeNull();
      expect(b.firstChild).toBe(cv);
      expect(cv?.width).toBe(TAB_ICON_SIZE);
      expect(cv?.getAttribute('aria-hidden')).toBe('true');
    }
    const after = Array.from(document.querySelectorAll('#status-tabs button, #log-tabs button')).map((b) => b.textContent);
    expect(after).toEqual(before); // DOM-контракти П11.6: текст недоторканий
  });

  it('невідома вкладка лишається без іконки; повторний виклик не дублює', () => {
    decorateTabButtons();
    decorateTabButtons();
    const unknown = document.getElementById('log-tab-x') as HTMLButtonElement;
    expect(unknown.querySelector('canvas')).toBeNull();
    const squad = document.getElementById('status-tab-squad') as HTMLButtonElement;
    expect(squad.querySelectorAll('canvas.tab-icon').length).toBe(1);
  });
});
