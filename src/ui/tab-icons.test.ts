// П14.6 (ADR-0072), Т.123 (ADR-0114): тести іконок вкладок — векторні іконки,
// контракти DOM. Перевіряється: decorateTabButtons ставить svg.tab-icon першою
// дитиною кожної кнопки #status-tabs/#log-tabs, текст кнопок (контракт
// textContent уроку П11.6) не змінюється, виклик idempotent, невідомі ключі
// пропускаються.
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { TAB_ICONS, decorateTabButtons } from './tab-icons';

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

describe('П14.6, Т.123 tab-icons: векторні іконки вкладок', () => {
  beforeEach(() => {
    document.body.innerHTML = STRIP;
  });

  it('усі ключі вкладок мають іконки (status + журнал, «Вузол» спільний)', () => {
    expect(Object.keys(TAB_ICONS).sort()).toEqual(['all', 'base', 'battle', 'econ', 'geo', 'squad', 'system']);
    expect(new Set(Object.values(TAB_ICONS)).size).toBe(7); // кожній вкладці — своя іконка
  });

  it('decorate: svg.tab-icon першою дитиною кожної відомої кнопки, textContent не змінюється', () => {
    const before = Array.from(document.querySelectorAll('#status-tabs button, #log-tabs button')).map((b) => b.textContent);
    decorateTabButtons();
    const known = Array.from(document.querySelectorAll<HTMLButtonElement>('#status-tabs button, #log-tabs button')).filter(
      (b) => b.dataset.filter !== 'unknown'
    );
    expect(known.length).toBe(8);
    for (const b of known) {
      const cv = b.querySelector('svg.tab-icon');
      expect(cv).not.toBeNull();
      expect(b.firstChild).toBe(cv);
      expect(cv?.childElementCount).toBeGreaterThan(0);
      expect(cv?.getAttribute('aria-hidden')).toBe('true');
    }
    const after = Array.from(document.querySelectorAll('#status-tabs button, #log-tabs button')).map((b) => b.textContent);
    expect(after).toEqual(before); // DOM-контракти П11.6: текст недоторканий
  });

  it('невідома вкладка лишається без іконки; повторний виклик не дублює', () => {
    decorateTabButtons();
    decorateTabButtons();
    const unknown = document.getElementById('log-tab-x') as HTMLButtonElement;
    expect(unknown.querySelector('svg')).toBeNull();
    const squad = document.getElementById('status-tab-squad') as HTMLButtonElement;
    expect(squad.querySelectorAll('svg.tab-icon').length).toBe(1);
  });
});
