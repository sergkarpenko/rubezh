// @vitest-environment jsdom
// src/main.ui.test.ts
// П7 (переробка, ADR-0013): DOM-тести UI-шару main.ts через jsdom.
// Розмітку беремо з реального index.html (без дублювання — дрейф розмітки
// ловиться тестом). Канва — no-op заглушка: jsdom без нативного canvas не
// рендерить 2D, а main.ts при null-контексті рано виходить з renderGeo/
// renderBattle і не оновлює DOM поруч із канвою; заглушка тримає кнопки/тексти
// живими. Малювання далі валідується візуально (превью).

import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const btn = (id: string): HTMLButtonElement => $(id) as HTMLButtonElement;

beforeAll(async () => {
  // Реальна розмітка: body з index.html (script через innerHTML не виконується).
  // import.meta.url у vitest не file-схема — шлях від process.cwd().
  const html = readFileSync(process.cwd() + '/index.html', 'utf-8');
  document.body.innerHTML = html.match(/<body[^>]*>([\s\S]*)<\/body>/)![1];

  // No-op контекст малювання: усі виклики — порожні, присвоєння властивостей — так.
  const noopCtx = new Proxy(
    {},
    {
      get: () => () => undefined,
      set: () => true,
    }
  ) as unknown as CanvasRenderingContext2D;
  const proto = HTMLCanvasElement.prototype as unknown as {
    getContext: () => CanvasRenderingContext2D;
    getBoundingClientRect: (this: HTMLCanvasElement) => DOMRect;
  };
  proto.getContext = () => noopCtx;
  // Клік-математика: канва розтягнута на 1:1, клітинка = width/20 (BCELL).
  proto.getBoundingClientRect = function (this: HTMLCanvasElement): DOMRect {
    return {
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      width: this.width,
      height: this.height,
      right: this.width,
      bottom: this.height,
      toJSON: () => '',
    } as DOMRect;
  };

  // Імпортуємо main.ts ПІСЛЯ розмітки: на рівні модуля він прив'язує обробники
  // (за typeof document) і робить перший renderAll.
  await import('./main');
});

describe('UI-флоу превью: геосцена → місія → бій → результат (ADR-0013)', () => {
  it('ініціалізація: журнал старту, годинник, ростер, фінанси, панель бою прихована', () => {
    expect($('log').textContent).toContain('Партію розпочато');
    expect($('clock').textContent).toBe('Д1 00:00');
    expect($('roster').textContent).toContain('6 солдатів (6 боєготових)');
    expect($('money').textContent).toBe('300');
    expect($('battle-panel').classList.contains('hidden')).toBe(true);
    expect(btn('btn-tick').disabled).toBe(false);
  });

  it('btn-tick: +30 хв; btn-day: +1 доба', () => {
    btn('btn-tick').click();
    expect($('clock').textContent).toBe('Д1 00:30');
    btn('btn-day').click();
    expect($('clock').textContent).toBe('Д2 00:30');
  });

  it('нова партія зі сідом: годинник і журнал', () => {
    ($('seed') as HTMLInputElement).value = '42';
    btn('btn-new').click();
    expect($('clock').textContent).toBe('Д1 00:00');
    expect($('log').textContent).toContain('Нова партія (сід 42)');
  });

  it('радар: тіки до виявленого приземленого НЛО → кнопка місії (детерміновано)', () => {
    let found = false;
    for (let i = 0; i < 1500 && !found; i++) {
      btn('btn-tick').click();
      found = document.querySelector('button.mission') !== null;
    }
    expect(found).toBe(true); // сід 42: виявлений НЛО приземлюється в межах ліміту
  });

  it('запуск місії: панель бою відкрита, хід 1 загону, час геосцени заблоковано', () => {
    (document.querySelector('button.mission') as HTMLButtonElement).click();
    expect($('battle-panel').classList.contains('hidden')).toBe(false);
    expect($('bturn').textContent).toContain('хід 1');
    expect($('bturn').textContent).toContain('загін');
    expect(btn('btn-tick').disabled).toBe(true);
    expect($('binfo').textContent).toContain('Ваш хід');
    expect($('log').textContent).toContain('Місія: загін висаджено');
  });

  it('вибір солдата кліком по бойовищу (клітина 2,2 — зона висадки)', () => {
    const cv = $('battle') as HTMLCanvasElement;
    cv.dispatchEvent(new MouseEvent('click', { clientX: 2 * 26 + 13, clientY: 2 * 26 + 13 }));
    expect($('binfo').textContent).toContain('HP 10/10');
    expect($('binfo').textContent).toContain('AP 10/10');
  });

  it('заступа: кнопка резервація AP, підказка в binfo', () => {
    btn('btn-ow').click();
    expect($('binfo').textContent).toContain('заступі');
    expect($('binfo').textContent).toContain('AP 7/10');
  });

  it('кінець ходу: ШІ відпрацьовує синхронно, хід 2 гравцю', () => {
    btn('btn-end').click();
    expect($('bresult').textContent).toBe(''); // загін 3×10 HP виживає перший хід ШІ (сід 42)
    expect($('bturn').textContent).toContain('хід 2');
    expect($('binfo').textContent).toContain('Хід прибульців відпрацьовано');
  });

  it('демо-бій доводить бій до результату (перемога або поразка)', () => {
    btn('btn-demo').click();
    expect($('bresult').textContent).toMatch(/ЗАЧИЩЕНО|ЗАГІН ВТРАЧЕНО/);
    expect(btn('btn-demo').disabled).toBe(true); // бій завершено — демо більше не тискається
    expect($('log').textContent).toMatch(/Місію зачищено|Загін втрачено/);
  });

  it('закриття бою повертає на геосцену і розблоковує час', () => {
    btn('btn-close').click();
    expect($('battle-panel').classList.contains('hidden')).toBe(true);
    expect(btn('btn-tick').disabled).toBe(false);
    expect($('bresult').textContent).toBe('');
  });
});

describe('критичний флоу економіки: найм → місія → поранення → одужання (П4.5, ADR-0021)', () => {
  // Сід 42 детермінований (перевірено сценарієм у пісочниці): перша місія —
  // «розвідник» на 22-му тіку; демо-бій — перемога, s2 гине, s1 поранений
  // 6/10 → лікарня 8 тіків; премія +150.

  it('скидання партії: баланс 300, ростер 6', () => {
    ($('seed') as HTMLInputElement).value = '42';
    btn('btn-new').click();
    expect($('money').textContent).toBe('300');
    expect($('roster').textContent).toContain('6 солдатів (6 боєготових)');
  });

  it('найм: −100, новобранець «Дмитро» в кінці ростеру', () => {
    btn('btn-hire').click();
    expect($('money').textContent).toBe('200');
    expect($('roster').textContent).toContain('7 солдатів (7 боєготових)');
    expect($('roster').textContent).toContain('Дмитро');
    expect($('log').textContent).toContain('Найм: Дмитро');
    expect($('log').textContent).toContain('Витрати: −100');
  });

  it('місія: тіки до вікна, запуск, час заблоковано', () => {
    let found = false;
    for (let i = 0; i < 1500 && !found; i++) {
      btn('btn-tick').click();
      found = document.querySelector('button.mission') !== null;
    }
    expect(found).toBe(true);
    (document.querySelector('button.mission') as HTMLButtonElement).click();
    expect($('battle-panel').classList.contains('hidden')).toBe(false);
    expect(btn('btn-tick').disabled).toBe(true);
  });

  it('поранення: демо-бій — перемога, поранений у лікарні, премія за місію', () => {
    btn('btn-demo').click();
    expect($('bresult').textContent).toContain('ЗАЧИЩЕНО');
    expect($('bresult').textContent).toContain('поранених: 1');
    expect($('log').textContent).toContain('Іван поранений — лікарня: 8 тик(и)');
    expect($('log').textContent).toContain('Премія за місію (розвідник): +150');
    expect($('money').textContent).toBe('350'); // 300 − 100 найм + 150 премія
  });

  it('поранений не боєготовий: статус у ростері, місія недоступна поки вікно триває', () => {
    btn('btn-close').click();
    expect($('battle-panel').classList.contains('hidden')).toBe(true);
    expect($('roster').textContent).toContain('6 солдатів (5 боєготових)');
    expect($('roster').textContent).toContain('лікарня: 8 тик(и)');
    expect($('roster').textContent).toContain('HP 6/10');
    expect(btn('btn-tick').disabled).toBe(false);
  });

  it('одужання: 8 тіків — ветеран знову боєготовий, баланс і годинник цілі', () => {
    for (let i = 0; i < 8; i++) btn('btn-tick').click();
    expect($('roster').textContent).not.toContain('лікарня');
    expect($('roster').textContent).toContain('HP 10/10');
    expect($('roster').textContent).toContain('6 солдатів (6 боєготових)');
    expect($('money').textContent).toBe('350'); // доти не було — доба не завершена
    expect($('clock').textContent).toBe('Д1 15:00'); // 22 + 8 тіків по 30 хв
  });

  it('дотація: завершення доби 1 — +100 у журналі і балансі', () => {
    for (let i = 0; i < 18; i++) btn('btn-tick').click(); // 30 тіків усього
    expect($('clock').textContent).toBe('Д2 00:00');
    expect($('money').textContent).toBe('450');
    expect($('log').textContent).toContain('Дотація за добу 1: +100');
  });
});
