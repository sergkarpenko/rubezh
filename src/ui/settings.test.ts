// @vitest-environment jsdom
// П12.3 (ADR-0065/0059): тести вікна «Налаштування» — відкриття/зміна/закриття,
// збереження між сесіями сховища (localStorage поза сейвом, ADR-0026),
// фолбек-міграція rubezh.sound → rubezh.settings.sound (вибір користувача
// не губиться), контракт «тихо» на зламаному сховищі (ADR-0059). Тумблер —
// справжній аудіо-модуль (єдине джерело стану); jsdom без WebAudio —
// typeof-гейт no-op. Перехід екранів — без rAF (ADR-0029).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSound, SOUND_KEY, type SoundStore } from './audio';
// П14.8 (ADR-0073): тумблер «Анімація» — справжній ambient-модуль (єдине
// джерело стану, патерн звуку); jsdom без rAF — typeof-гейт no-op.
import { AMBIENT_KEY, createAmbient, type AmbientStore } from './ambient';
import { createSettings, type SettingsAmbient, type SettingsSound } from './settings';

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

// П14.8: мок-тумблер ambient — той самий контракт, що й звук.
const mockAmbient = (on: boolean): SettingsAmbient & { set(v: boolean): void } => {
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

// П14.8: справжній ambient-модуль у вікні — deps без rAF (typeof-гейт jsdom:
// 0 кадрів; тумблер працює без планувальника).
const ambientNoRaf = (store?: AmbientStore) =>
  createAmbient({
    hasRaf: () => false,
    schedule: () => 0,
    cancel: () => {},
    now: () => 0,
    visible: () => true,
    repaint: () => {},
    store,
  });

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
    const settings = createSettings({ sound: mockSound(true), ambient: mockAmbient(true) });
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
    const settings = createSettings({ sound, ambient: mockAmbient(true) });
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
    const settings = createSettings({ sound, ambient: mockAmbient(true) });
    settings.open();
    expect(btn('settings-sound').textContent).toBe('Звук: вимк');
    settings.close();
    sound.set(true); // стан змінили поза вікном
    settings.open();
    expect(btn('settings-sound').textContent).toBe('Звук: увімк');
  });

  it('відкриття/тумблер/закриття — без rAF-анімацій (0 викликів, ADR-0029)', () => {
    const settings = createSettings({ sound: mockSound(true), ambient: mockAmbient(true) });
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
    const w1 = createSettings({ sound: s1, ambient: mockAmbient(true) });
    w1.open();
    expect(btn('settings-sound').textContent).toBe('Звук: вимк');
    btn('settings-sound').click(); // увімкнули — одразу в localStorage
    expect(localStorage.getItem(SOUND_KEY)).toBe('1');
    expect(btn('settings-sound').textContent).toBe('Звук: увімк');
    // «нова сесія браузера»: свіжі звук і вікно читають той самий ключ
    const s2 = createSound({ makeContext: () => null });
    const w2 = createSettings({ sound: s2, ambient: mockAmbient(true) });
    w2.open();
    expect(btn('settings-sound').textContent).toBe('Звук: увімк');
  });

  it('фолбек-міграція rubezh.sound: вибір користувача не губиться, дублікат прибирається', () => {
    localStorage.setItem('rubezh.sound', '0'); // ключ топбара П11.7, нового нема
    const s = createSound({ makeContext: () => null });
    const w = createSettings({ sound: s, ambient: mockAmbient(true) });
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
    createSettings({ sound: s, ambient: mockAmbient(true) }).open();
    expect(btn('settings-sound').textContent).toBe('Звук: увімк');
  });

  it('зламане сховище — тихо: вікно працює, винятків нема (ADR-0059)', () => {
    const s = createSound({ makeContext: () => null, store: boomStore() });
    const w = createSettings({ sound: s, ambient: mockAmbient(true) });
    expect(() => w.open()).not.toThrow();
    expect(visible('settings-dialog')).toBe(true);
    expect(() => btn('settings-sound').click()).not.toThrow();
    expect(btn('settings-sound').textContent).toBe('Звук: вимк'); // у сесії тумблер працює
    expect(() => w.close()).not.toThrow();
    expect(visible('settings-dialog')).toBe(false);
  });
});

describe('П14.8 (ADR-0073): секція «Анімація» — тумблер ambient поза сейвом', () => {
  it('дефолт увімк; click перемикає через ambient-модуль, підпис і персист синхронізуються', () => {
    const ambient = ambientNoRaf(); // справжній модуль — єдине джерело стану
    const settings = createSettings({ sound: mockSound(true), ambient });
    settings.open();
    expect(btn('settings-ambient').textContent).toBe('Анімація: увімк');
    expect(ambient.enabled()).toBe(true); // дефолт — увімкнено (ADR-0073 п.3)
    btn('settings-ambient').click();
    expect(ambient.enabled()).toBe(false); // стан змінив ambient-модуль, не вікно
    expect(localStorage.getItem(AMBIENT_KEY)).toBe('0'); // одразу в localStorage поза сейвом (ADR-0026)
    expect(btn('settings-ambient').textContent).toBe('Анімація: вимк');
    btn('settings-ambient').click();
    expect(localStorage.getItem(AMBIENT_KEY)).toBe('1');
    expect(btn('settings-ambient').textContent).toBe('Анімація: увімк');
  });

  it('персист між сесіями: минула сесія вимкнула — нова читає «0» (без перезапуску гри)', () => {
    localStorage.setItem(AMBIENT_KEY, '0');
    const w1 = createSettings({ sound: mockSound(true), ambient: ambientNoRaf() });
    w1.open();
    expect(btn('settings-ambient').textContent).toBe('Анімація: вимк'); // вибір користувача пережив сесію
    // «нова сесія» з тим самим сховищем
    const w2 = createSettings({ sound: mockSound(true), ambient: ambientNoRaf() });
    w2.open();
    expect(btn('settings-ambient').textContent).toBe('Анімація: вимк');
  });

  it('render(): зовнішня зміна стану ambient відображається при наступному open', () => {
    const ambient = mockAmbient(false);
    const settings = createSettings({ sound: mockSound(true), ambient });
    settings.open();
    expect(btn('settings-ambient').textContent).toBe('Анімація: вимк');
    settings.close();
    ambient.set(true); // стан змінили поза вікном (toggle у ambient-модулі)
    settings.open();
    expect(btn('settings-ambient').textContent).toBe('Анімація: увімк');
  });

  it('зламане сховище — тихо: вікно працює, винятків нема (контракт ADR-0059)', () => {
    const ambient = ambientNoRaf(boomStore());
    const w = createSettings({ sound: mockSound(true), ambient });
    expect(() => w.open()).not.toThrow();
    expect(() => btn('settings-ambient').click()).not.toThrow();
    expect(btn('settings-ambient').textContent).toBe('Анімація: вимк'); // у сесії тумблер працює
  });

  it('вікно (відкриття/звук/закриття) — без rAF-анімацій; ambient-цикл не стартує без партії', () => {
    const ambient = createAmbient({
      hasRaf: () => true,
      schedule: () => {
        rafCalls++;
        return rafCalls;
      },
      cancel: () => {},
      now: () => 0,
      visible: () => true,
      repaint: () => {},
    });
    const settings = createSettings({ sound: mockSound(true), ambient });
    settings.open();
    btn('settings-sound').click(); // тумблер звуку — 0 rAF (П12.3)
    btn('settings-close').click();
    settings.open();
    settings.close();
    expect(rafCalls).toBe(0); // тумблер ambient не чіпали — цикл не заплановано
    ambient.enabled(); // стан читається без кадрів
  });
});
