// @vitest-environment jsdom
// пR.2: юніт-тести панелі збереження (src/ui/save-panel.ts, П5.3/ADR-0026).
// DOM-флоу панелі (зберегти → тіки → завантажити, вимкненість у бою) покрито
// main.ui.test.ts; тут — гілки помилок сховища (приватний режим, зламаний
// write/remove) і хелпер el (кидає на відсутньому елементі). Патерн Storage —
// як у main.ui.test.ts: jsdom у цьому середовищі не створює Storage.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createParty } from '../core/save';
import { createSavePanel, type SavePanelDeps } from './save-panel';
import { el } from './dom';

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length(): number {
    return this.data.size;
  }
  clear(): void {
    this.data.clear();
  }
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  setItem(key: string, value: string): void {
    this.data.set(key, String(value));
  }
}

const memoryStorage = new MemoryStorage();
Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage, configurable: true });
Object.defineProperty(window, 'localStorage', { value: memoryStorage, configurable: true });

function makeDeps(over: Partial<SavePanelDeps> = {}): SavePanelDeps {
  return {
    getParty: () => createParty(42),
    adoptLoaded: vi.fn(),
    inBattle: () => false,
    interceptBusy: () => false,
    isGameOver: () => false,
    journal: vi.fn(),
    renderAll: vi.fn(),
    ...over,
  };
}

function setupDom(): void {
  document.body.innerHTML = '<div id="save-panel"></div>';
}

beforeEach(() => {
  memoryStorage.clear();
  setupDom();
});

afterEach(() => {
  vi.restoreAllMocks(); // шпигуни setItem/removeItem не протікають у сусідні тести
});

describe('SavePanel: сховище недоступне (приватний режим)', () => {
  it('detectStorage бачить помилку — панель показує повідомлення, кнопок нема', () => {
    // setItem кидає — як приватний режим Safari
    vi.spyOn(memoryStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    const deps = makeDeps();
    const panel = createSavePanel(deps);
    panel.detectStorage();
    expect(panel.isStorageOk()).toBe(false);
    panel.render();
    expect(el('save-panel').textContent).toContain('Сховище недоступне');
    expect(el('save-panel').querySelector('button')).toBeNull();
  });

  it('detectStorage на робочому сховищі — isStorageOk=true', () => {
    const panel = createSavePanel(makeDeps());
    panel.detectStorage();
    expect(panel.isStorageOk()).toBe(true);
  });
});

describe('SavePanel: слоти', () => {
  it('render малює порожні слоти з вимкненим завантаженням/видаленням', () => {
    const panel = createSavePanel(makeDeps());
    panel.render();
    const saveBtn = el('btn-save-1') as HTMLButtonElement;
    const loadBtn = el('btn-load-1') as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(false);
    expect(loadBtn.disabled).toBe(true); // слот порожній
  });

  it('render вимикає збереження у бою і при перехопленні (патерн П6.3/П7.5)', () => {
    let inBattle = true;
    const panel = createSavePanel(makeDeps({ inBattle: () => inBattle, interceptBusy: () => true }));
    panel.render();
    expect((el('btn-save-1') as HTMLButtonElement).disabled).toBe(true);
    inBattle = false;
  });

  it('save+load: круговий цикл через справжні saveToSlot/loadFromSlot', () => {
    const adoptLoaded = vi.fn();
    const party = createParty(7);
    const deps = makeDeps({ getParty: () => party, adoptLoaded });
    const panel = createSavePanel(deps);
    panel.save(1);
    expect(localStorage.getItem('rubezh.save.1')).not.toBeNull();
    expect(deps.journal).toHaveBeenCalledWith('Збережено: слот 1.');
    panel.load(1);
    expect(adoptLoaded).toHaveBeenCalledTimes(1);
    expect(deps.renderAll).toHaveBeenCalledTimes(1);
  });

  it('save при помилці write — журнал про невдачу, без кидка', () => {
    vi.spyOn(memoryStorage, 'setItem').mockImplementation(() => {
      throw new Error('disk full');
    });
    const deps = makeDeps();
    const panel = createSavePanel(deps);
    expect(() => panel.save(2)).not.toThrow();
    expect(deps.journal).toHaveBeenCalledWith('✗ Збереження не вдалось: disk full', 'lose');
  });

  it('delete при помилці remove — журнал про невдачу, без кидка', () => {
    memoryStorage.setItem('rubezh.save.3', '{}');
    vi.spyOn(memoryStorage, 'removeItem').mockImplementation(() => {
      throw new Error('locked');
    });
    const deps = makeDeps();
    const panel = createSavePanel(deps);
    expect(() => panel.del(3)).not.toThrow();
    expect(deps.journal).toHaveBeenCalledWith('✗ locked', 'lose');
  });

  it('пошкоджений JSON у слоті — мітка «пошкоджений слот», load не ламає панель', () => {
    memoryStorage.setItem('rubezh.save.1', 'не-json{');
    const deps = makeDeps();
    const panel = createSavePanel(deps);
    panel.render();
    expect(el('slot-1').textContent).toContain('пошкоджений слот');
  });

  it('getItem кидає — адаптер читає слот як порожній (гілка catch адаптера read)', () => {
    vi.spyOn(memoryStorage, 'getItem').mockImplementation(() => {
      throw new Error('read denied');
    });
    const panel = createSavePanel(makeDeps());
    panel.render();
    expect(el('slot-1').textContent).toBe('—'); // порожній, кнопки load/del вимкнені
    expect((el('btn-load-1') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('el (src/ui/dom.ts)', () => {
  it('кидає українську помилку на відсутньому елементі', () => {
    expect(() => el('нема-такого')).toThrow('Немає елемента #нема-такого');
  });
});
