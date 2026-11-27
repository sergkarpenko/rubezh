// @vitest-environment jsdom
// Т.218 (аудит PR #534): зупинки Tab пастки фокусу — закритий «Додатково» і радіогрупа.
import { describe, expect, it } from 'vitest';
import { tabStop } from './tab-stop';

describe('Т.218: tabStop — зупинки Tab, як у браузері', () => {
  it('поле в закритому details — ні, його summary — так; відкрито — так', () => {
    document.body.innerHTML = '<details id="d"><summary id="s">Додатково</summary><input id="seed" /></details><button id="b">x</button>';
    const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
    expect(tabStop($('seed'))).toBe(false);
    expect(tabStop($('s'))).toBe(true);
    expect(tabStop($('b'))).toBe(true);
    ($('d') as HTMLDetailsElement).open = true;
    expect(tabStop($('seed'))).toBe(true);
  });
  it('радіогрупа — лише обрана кнопка', () => {
    document.body.innerHTML = '<input type="radio" name="g" id="r1" /><input type="radio" name="g" id="r2" checked />';
    expect(tabStop(document.getElementById('r1') as HTMLElement)).toBe(false);
    expect(tabStop(document.getElementById('r2') as HTMLElement)).toBe(true);
  });
});
