// @vitest-environment jsdom
// П12.3 (ADR-0065/0059): тести вікна «Налаштування» — відкриття/зміна/закриття,
// збереження між сесіями сховища (localStorage поза сейвом, ADR-0026),
// фолбек-міграція rubezh.sound → rubezh.settings.sound (вибір користувача
// не губиться), контракт «тихо» на зламаному сховищі (ADR-0059). Тумблер —
// справжній аудіо-модуль (єдине джерело стану); jsdom без WebAudio —
// typeof-гейт no-op. Перехід екранів — без rAF (ADR-0029).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSound, SOUND_KEY, type SoundStore } from './audio';
import { createSettings, type SettingsSound } from './settings';

// Скелет — той самий id, що й в index.html (контент генерує модуль).
const SKELETON = '<section id="settings-dialog" class="hidden"></section>';

const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const btn = (id: string): HTMLButtonElement => $(id) as HTMLButtonElement;
const visible = (id: string): boolean => !$(id).classList.contains('hidden');

let rafCalls = 0;

// Мок-тумблер (стан без сховища) — для перевірки, що вікно лише читає/перемикає.
const mockSound = (on: boolean): SettingsSound & { set(v: boolean): void } => {
  const s = {
    value: on,
    enabled: () => s.value,
    toggle: () => {
      s.value = !s.value;
      return s.value;
    },
    set: (v: boolean) => {
      s.value = v;
    },
  };
  return s;
};

// Сховище, що кидає (приватний режим) — контракт «тихо» (ADR-0059).
const boomStore = (): SoundStore => {
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

describe('П12.3: вікно «Налаштування» — відкриття/зміна/закриття (ADR-0065)', () => {
  it('open/close/isOpen: перемикання класу, контент — секція «Звук» з тумблером', () => {
    const settings = createSettings({ sound: mockSound(true) });
    expect(settings.isOpen()).toBe(false);
    settings.open();
    expect(visible('settings-dialog')).toBe(true);
    expect(settings.isOpen()).toBe(true);
    expect($('settings-dialog').textContent).toContain('Налаштування');
    expect(btn('settings-sound').textContent).toBe('Звук: увімк'); // підпис мігрував з топбара
    settings.close();
    expect(visible('settings-dialog')).toBe(false);
    expect(settings.isOpen()).toBe(false);
  });

  it('тумблер: click перемикає через аудіо-модуль, підпис синхронізується', () => {
    const sound = mockSound(true);
    const toggle = vi.spyOn(sound, 'toggle');
    const settings = createSettings({ sound });
    settings.open();
    btn('settings-sound').click();
    expect(toggle).toHaveBeenCalledTimes(1); // єдине джерело стану — аудіо-модуль
    expect(btn('settings-sound').textContent).toBe('Звук: вимк');
    btn('settings-sound').click();
    expect(btn('settings-sound').textContent).toBe('Звук: увімк');
    settings.close();
  });

  it('render(): зовнішня зміна стану відображається при наступному open', () => {
    const sound = mockSound(false);
    const settings = createSettings({ sound });
    settings.open();
    expect(btn('settings-sound').textContent).toBe('Звук: вимк');
    settings.close();
    sound.set(true); // стан змінили поза вікном
    settings.open();
    expect(btn('settings-sound').textContent).toBe('Звук: увімк');
  });

  it('відкриття/тумблер/закриття — без rAF-анімацій (0 викликів, ADR-0029)', () => {
    const settings = createSettings({ sound: mockSound(true) });
    settings.open();
    btn('settings-sound').click();
    btn('settings-close').click();
    settings.open();
    settings.close();
    expect(rafCalls).toBe(0);
  });
});

describe('П12.3: персист поза сейвом і фолбек rubezh.sound (ADR-0026/0059)', () => {
  it('стан зберігається між сесіями сховища: ключ rubezh.settings.sound', () => {
    localStorage.setItem(SOUND_KEY, '0'); // минула сесія вимкнула звук
    const s1 = createSound({ makeContext: () => null }); // типова фабрика (browserStore)
    const w1 = createSettings({ sound: s1 });
    w1.open();
    expect(btn('settings-sound').textContent).toBe('Звук: вимк');
    btn('settings-sound').click(); // увімкнули — одразу в localStorage
    expect(localStorage.getItem(SOUND_KEY)).toBe('1');
    expect(btn('settings-sound').textContent).toBe('Звук: увімк');
    // «нова сесія браузера»: свіжі звук і вікно читають той самий ключ
    const s2 = createSound({ makeContext: () => null });
    const w2 = createSettings({ sound: s2 });
    w2.open();
    expect(btn('settings-sound').textContent).toBe('Звук: увімк');
  });

  it('фолбек-міграція rubezh.sound: вибір користувача не губиться, дублікат прибирається', () => {
    localStorage.setItem('rubezh.sound', '0'); // ключ топбара П11.7, нового нема
    const s = createSound({ makeContext: () => null });
    const w = createSettings({ sound: s });
    w.open();
    expect(btn('settings-sound').textContent).toBe('Звук: вимк'); // фолбек прочитано
    expect(s.enabled()).toBe(false);
    btn('settings-sound').click(); // перший запис мігрує у новий формат
    expect(localStorage.getItem(SOUND_KEY)).toBe('1');
    expect(localStorage.getItem('rubezh.sound')).toBeNull(); // старий ключ не лишається
    expect(btn('settings-sound').textContent).toBe('Звук: увімк');
  });

  it('дефолт: обидва ключі відсутні — звук увімкнено', () => {
    const s = createSound({ makeContext: () => null });
    createSettings({ sound: s }).open();
    expect(btn('settings-sound').textContent).toBe('Звук: увімк');
  });

  it('зламане сховище — тихо: вікно працює, винятків нема (ADR-0059)', () => {
    const s = createSound({ makeContext: () => null, store: boomStore() });
    const w = createSettings({ sound: s });
    expect(() => w.open()).not.toThrow();
    expect(visible('settings-dialog')).toBe(true);
    expect(() => btn('settings-sound').click()).not.toThrow();
    expect(btn('settings-sound').textContent).toBe('Звук: вимк'); // у сесії тумблер працює
    expect(() => w.close()).not.toThrow();
    expect(visible('settings-dialog')).toBe(false);
  });
});
