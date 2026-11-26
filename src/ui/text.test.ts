// Т.7: тести граматики гравцевих текстів — числівник + «тік», рід дієслова
// за іменем оперативника (пул імен ядра розбито явно: нове ім'я валить тест
// і змушує звірити правило «-а/-я — жіночий рід»).
import { describe, expect, it } from 'vitest';
import { SOLDIER_NAMES } from '../core/squad';
import { byGender, daysText, isFeminineName, plural, ticksText } from './text';

describe('ticksText: узгодження числівника з «тік»', () => {
  it('1 → тік; 2–4 → тіки; 0 і 5–20 → тіків', () => {
    expect(ticksText(1)).toBe('1 тік');
    expect([2, 3, 4].map(ticksText)).toEqual(['2 тіки', '3 тіки', '4 тіки']);
    expect([0, 5, 8, 10, 12, 16, 20].map(ticksText)).toEqual([
      '0 тіків',
      '5 тіків',
      '8 тіків',
      '10 тіків',
      '12 тіків',
      '16 тіків',
      '20 тіків',
    ]);
  });

  it('11–14 — завжди «тіків»; далі — за останньою цифрою (21 тік, 24 тіки, 48 тіків)', () => {
    expect([11, 12, 13, 14].map(ticksText)).toEqual(['11 тіків', '12 тіків', '13 тіків', '14 тіків']);
    expect(ticksText(21)).toBe('21 тік');
    expect(ticksText(24)).toBe('24 тіки');
    expect(ticksText(48)).toBe('48 тіків');
    expect([111, 112, 121].map(ticksText)).toEqual(['111 тіків', '112 тіків', '121 тік']);
  });
});

describe('рід за іменем: пул імен ядра (SOLDIER_NAMES)', () => {
  it('розбиття пулу на жіночі й чоловічі імена — повне і явне', () => {
    expect(SOLDIER_NAMES.filter(isFeminineName)).toEqual(['Олена', 'Марія', 'Софія', 'Ярина', 'Наталія', 'Віра']);
    expect(SOLDIER_NAMES.filter((n) => !isFeminineName(n))).toEqual(['Іван', 'Тарас', 'Богдан', 'Дмитро', 'Орест', 'Андрій']);
    expect([isFeminineName('Турель 1'), isFeminineName('Демон 1')]).toEqual([true, false]); // п18.4: «Турель 1 загинула»
  });

  it('друге коло найму («Олена 2») — рід за першим словом; демон — чоловічий', () => {
    expect(isFeminineName('Олена 2')).toBe(true);
    expect(isFeminineName('Іван 2')).toBe(false);
    expect(isFeminineName('Демон 1')).toBe(false);
  });

  it('byGender обирає форму слова', () => {
    expect(byGender('Олена', 'загинув', 'загинула')).toBe('загинула');
    expect(byGender('Іван', 'загинув', 'загинула')).toBe('загинув');
  });
});

describe('T.39: daysText — узгодження «доба» з числом (як «тик»)', () => {
  it('1 доба; 2–4 доби; 5–20, 11–14 діб; 21 доба, 22 доби, 25 діб', () => {
    expect(daysText(1)).toBe('1 доба');
    expect([2, 3, 4].map(daysText)).toEqual(['2 доби', '3 доби', '4 доби']);
    expect([0, 5, 8, 11, 14, 20].map(daysText)).toEqual(['0 діб', '5 діб', '8 діб', '11 діб', '14 діб', '20 діб']);
    expect(daysText(21)).toBe('21 доба');
    expect(daysText(22)).toBe('22 доби');
    expect(daysText(25)).toBe('25 діб');
  });
});

describe('T.39: plural — число + іменівник (техноманти у «Час ≈ …»)', () => {
  it('1 техномант; 2–4 техноманти; 5+ техномантів; 21 техномант', () => {
    const w: [string, string, string] = ['техномант', 'техноманти', 'техномантів'];
    expect(plural(1, ...w)).toBe('1 техномант');
    expect(plural(2, ...w)).toBe('2 техноманти');
    expect(plural(5, ...w)).toBe('5 техномантів');
    expect(plural(21, ...w)).toBe('21 техномант');
  });
});
