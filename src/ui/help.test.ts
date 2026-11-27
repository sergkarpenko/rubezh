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
import { EVAC_AP_COST } from '../core/combat';
import { BASE_LAB_SLOTS, SCIENTIST_SALARY } from '../core/research';
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
  it('легенда, мета кампанії (ланцюжок, загроза, ваги рахунку), керування з гарячими клавішами', () => {
    freshHelp();
    const text = $('help-screen').textContent ?? '';
    expect(text).toContain('Як грати');
    // Легенда
    expect(text).toContain('Вузол «Рубіж»');
    expect(text).toContain('Сенсорна сітка');
    expect(text).toContain('Зонди Розриву');
    expect(text).toContain('Перехоплення');
    expect(text).toContain('Місії');
    // Мета кампанії (ADR-0033): ваги рахунку (ветерани 50 / кредити 0.25 — глосарій П12.6:
    // «кредити», не «гроші»); п18.3 (рішення власника «А. Мінімум»): рядка «Вистояти 30 діб» немає
    expect(text).not.toContain('30 діб');
    expect(text).not.toContain('Вистояти');
    // п18.5 (ADR-0157; рішення власника «А. Повні»): ланцюжок, загроза з числами, поразка, вороги за загрозою;
    // «Рахунок» — коротший рядок
    expect(text).toContain(
      'Перемога — виграти фінальну місію «Брама Розриву». Її відкривають протоколи «Анатомія Розриву» → «Пеленг брами» → «Ключ брами»; їм потрібні трофеї — по одному за ворога, вбитого у виграній місії.'
    );
    expect(text).toContain(
      'Загроза 0–100: +2 за добу, +6 за виявлений зонд, що відлетів без бою (+2 — невиявлений), −1 за виграну місію. На 60, 75 і 90 демони штурмують вузол; на 100 — поразка.'
    );
    expect(text).toContain('Поразка — загроза 100 або банкрутство (немає боєготових і кредитів на вербування).');
    expect(text).toContain('Вороги: із загрози 8 гончак (кігті впритул), з 17 голем (броня 2), з 27 око (промінь до 16).');
    expect(text).toContain('Рахунок: 100 за зонд · 150 за місію · 50 за живого · 0,25 за кредит.');
    expect(text).toContain('ремонт, штурм), «+1 доба» — коли зонд виявлено чи приземлився або почався штурм.');
    // Числа економіки (П8.6): дотація 75, премії 110/170
    expect(text).toContain('дотація до 75/добу'); // п19.4 (рішення власника Т.207): дотація — за довірою регіонів
    expect(text).toContain('ремонт перехоплювача 50 · перехоплювач 200.');
    // п19.4: рядок «Регіони» — числа з констант ядра
    expect(text).toContain(
      'Регіони: довіра −30 / −15 за зонд, що відлетів без бою (виявлений / ні), +10 за виграну місію; дотація — за довірою, на 0 регіон виходить.'
    );
    expect(text).toContain('«Кузня»: протокол відкриває предмет чи зброю — замовте виготовлення; там же — до 3 перехоплювачів.'); // п20.5
    expect(text).toContain('110 (розвідник) / 170 (збирач)');
    // Керування: тулбар дій (П13.2) + тап-тап + гарячі клавіші 1/2/3/O/M/G/V/E/Esc (урок П11.9)
    expect(text).toContain('плитки тулбара збоку');
    expect(text).toContain('повторний тап — хід');
    expect(text).toContain('тап по демону — меню пострілів'); // Т.131
    expect(text).toContain('1');
    expect(text).toContain('O');
    expect(text).toContain('гель');
    expect(text).toContain('граната');
    expect(text).toContain('V — евакуація'); // П15.6: клавіша евакуації (Т.71) у довідці
    expect(text).toContain('E');
    expect(text).toContain('Esc');
  });
  it('T.39: блок «Наука і спорядження» — числа з констант ядра (зарплата, слоти лабораторії)', () => {
    freshHelp();
    const text = $('help-screen').textContent ?? '';
    expect(text).toContain('Наука і спорядження');
    expect(text).toContain('Техноманти');
    // п19.4 (рішення власника Т.207 «А»): «Техноманти» і «Протокол» — один рядок
    expect(text).toContain('1 очко потоку і ' + SCIENTIST_SALARY + ' кр. за добу кожен; до ' + BASE_LAB_SLOTS + ' протоколів одночасно');
    expect(text).toContain('«Кузня»');
    expect(text).toContain('Видача');
    // п20.5 (рішення власника «А. Як на аркуші»): видача — у вікні перед вильотом; укриття — числа з COVER_MULT
    expect(text).toContain('Видача: зброя й предмети — у вікні перед вильотом; гель, граната й заряд витрачаються в бою.');
    expect(text).toContain('Укриття: стіна — шанс ×0,5, ящик — ×0,75, фланг — ×1,2.');
  });
  it('П10.2: показує версію гри зі зборки (vite define ← package.json)', () => {
    freshHelp();
    const text = $('help-screen').textContent ?? '';
    // Значення інжектиться vite define з package.json (vite.config.ts);
    // твердження читає той самий package.json — джерело одне, дублів немає.
    expect(text).toContain('Версія ' + pkg.version);
  });
});

describe('Т.49: слово «перехоплювач» без друкарської помилки', () => {
  it('довідка і розмітка сторінки: «перехоплювач», а не «перехоплюач»', () => {
    freshHelp();
    const text = $('help-screen').textContent ?? '';
    expect(text).toContain('загін і перший перехоплювач живуть у ньому'); // п19.4
    expect(text).toContain('перехоплювач атакує зонд у повітрі');
    expect(text).toContain('ремонт перехоплювача');
    expect(text).not.toContain('ерехоплюач');
    expect(htmlRaw).toContain('Перехоплювач: <b id="ictx-fighter">');
    expect(htmlRaw).toContain('<h2 data-icon="fighter">Перехоплювачі</h2>'); // Т.128: іконка заголовка
    expect(htmlRaw).not.toContain('ерехоплюач');
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

describe('Т.90: правило евакуації в «Як грати» (кандидат 91)', () => {
  it('пункт «Евакуація» у легенді: плитка, клавіша V, ціна з ядра, без премії, перепитування', () => {
    freshHelp();
    const legend = [...$('help-screen').querySelectorAll('.help-cols > div')].find((d) => d.querySelector('h3')?.textContent === 'Легенда');
    const text = legend?.textContent ?? '';
    expect(text).toContain(
      'Евакуація — плитка «Евакуація» або клавіша V, ' +
        EVAC_AP_COST +
        ' AP, лише з синьої клітинки висадки. Якщо евакуювати всіх, хто лишився на полі, премії за місію немає; останнього бійця гра перепитає.'
    );
  });
});
