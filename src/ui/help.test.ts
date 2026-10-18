// @vitest-environment jsdom
// П9.1 (Фаза 9, ADR-0013): тести екрана «Як грати» (src/ui/help.ts) — чиста
// логіка показу isFirstVisit і DOM-поведінка модуля на розмітці з реального
// index.html (без дублювання). Інтеграцію у складі застосунку (перший візит
// при порожніх слотах, кнопка «?» відкриває/закриває) покриває main.ui.test.ts.
import { beforeAll, describe, expect, it } from 'vitest';
import htmlRaw from '../../index.html?raw';
// П10.2: version з package.json — єдине джерело числа (урок П9.1); тест
// звіряє показ екрана з ним, дублювати версію в твердженні не можна.
import pkg from '../../package.json';
import { createHelp, isFirstVisit, type Help } from './help';

const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;

// Розмітка #help-screen — з реального index.html (дрейф розмітки ловиться тут).
beforeAll(() => {
  document.body.innerHTML = htmlRaw.match(/<body[^>]*>([\s\S]*)<\/body>/)![1];
});

// #help-screen — спільний DOM-елемент між тестами: чистий старт — примусово
// приховано, щоб стан попереднього тесту не протікав у наступний.
function freshHelp(storageOk = true, slotsEmpty = true): Help {
  const help = createHelp({
    storageOk: () => storageOk,
    slotsEmpty: () => slotsEmpty,
  });
  help.close();
  return help;
}

describe('П9.1: логіка показу isFirstVisit (EARS Фази 9)', () => {
  it('перший візит: сховище доступне, усі слоти порожні', () => {
    expect(isFirstVisit(true, true)).toBe(true);
  });
  it('є сейв у слотах — не перший візит, екран сам не показується', () => {
    expect(isFirstVisit(true, false)).toBe(false);
  });
  it('сховище недоступне — сейвів немає, перший візит', () => {
    expect(isFirstVisit(false, false)).toBe(true);
  });
});

describe('П9.1: екран «Як грати» — контент з констант ядра', () => {
  it('легенда, мета кампанії (30 діб, ваги рахунку), керування з гарячими клавішами', () => {
    freshHelp();
    const text = $('help-screen').textContent ?? '';
    expect(text).toContain('Як грати');
    // Легенда
    expect(text).toContain('Вузол «Рубіж»');
    expect(text).toContain('Сенсорна сітка');
    expect(text).toContain('Зонди Розриву');
    expect(text).toContain('Перехоплення');
    expect(text).toContain('Місії');
    // Мета кампанії (ADR-0033): 30 діб + ваги рахунку (ветерани 50 / гроші 0.25)
    expect(text).toContain('30 діб');
    expect(text).toContain('50 за живого ветерана');
    expect(text).toContain('0.25 за кожну грошову одиницю');
    // Числа економіки (П8.6): дотація 75, премії 110/170
    expect(text).toContain('дотація 75/добу');
    expect(text).toContain('110 (розвідник) / 170 (збирач)');
    // Керування: тап-тап + гарячі клавіші 1/2/3/O/E/Esc
    expect(text).toContain('повторний тап у ту саму клітинку — хід');
    expect(text).toContain('1');
    expect(text).toContain('O');
    expect(text).toContain('E');
    expect(text).toContain('Esc');
  });
  it('П10.2: показує версію гри зі зборки (vite define ← package.json)', () => {
    freshHelp();
    const text = $('help-screen').textContent ?? '';
    // Значення інжектиться vite define з package.json (vite.config.ts);
    // твердження читає той самий package.json — джерело одне, дублів немає.
    expect(text).toContain('Версія ' + pkg.version);
  });
});

describe('П9.1: відкриття/закриття і перший візит', () => {
  it('maybeShowOnFirstVisit: порожні слоти — показано', () => {
    const help = freshHelp(true, true);
    help.maybeShowOnFirstVisit();
    expect(help.isOpen()).toBe(true);
    expect($('help-screen').classList.contains('hidden')).toBe(false);
  });
  it('maybeShowOnFirstVisit: зайняті слоти — не показано', () => {
    const help = freshHelp(true, false);
    help.maybeShowOnFirstVisit();
    expect(help.isOpen()).toBe(false);
    expect($('help-screen').classList.contains('hidden')).toBe(true);
  });
  it('open відкриває будь-коли; кнопка «Грати» закриває', () => {
    const help = freshHelp(true, false); // навіть якщо не перший візит
    help.open();
    expect(help.isOpen()).toBe(true);
    ($('btn-help-close') as HTMLButtonElement).click();
    expect(help.isOpen()).toBe(false);
    expect($('help-screen').classList.contains('hidden')).toBe(true);
  });
});
