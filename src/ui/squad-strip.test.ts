// @vitest-environment jsdom
// Т.130 (кандидат 127): смуга загону — дані карток і HTML (чисті функції).
import { describe, expect, it } from 'vitest';
import { makeUnit, type GameState, type Unit } from '../core/combat';
import { fighterLook } from '../core/render-core';
import { helmetSvg } from './avatar';
import { rgba, squadCardLabel, squadCards, squadOrder, squadStripHtml, SQUAD_CLIP_PREFIX } from './squad-strip';

const unit = (id: string, side: 'player' | 'alien', name = id): Unit => makeUnit({ id, side, name, pos: { x: 0, y: 0 } });

function state(units: Unit[], evacuated: Unit[] = []): GameState {
  return { units, evacuated } as unknown as GameState;
}

function dom(html: string): HTMLElement {
  const box = document.createElement('div');
  box.innerHTML = html;
  return box;
}

describe('squadOrder / squadCards', () => {
  it('порядок висадки: лише оперативники, вороги поза смугою', () => {
    const st = state([unit('s3', 'player'), unit('a1', 'alien'), unit('s1', 'player')]);
    expect(squadOrder(st)).toEqual(['s3', 's1']);
  });

  it('загиблий лишається на місці (down, HP 0, AP 0), евакуйований — теж (evac), порядок той самий', () => {
    const s1 = unit('s1', 'player');
    const s2 = unit('s2', 'player');
    const s3 = unit('s3', 'player');
    const st = state([s1, s2, s3]);
    const order = squadOrder(st);
    s1.alive = false;
    st.units = [s1, s3]; // s2 евакуйовано: з поля — у evacuated
    st.evacuated = [s2];
    const cards = squadCards(st, order, 's3');
    expect(cards.map((c) => [c.id, c.status])).toEqual([
      ['s1', 'down'],
      ['s2', 'evac'],
      ['s3', 'ready'],
    ]);
    expect(cards[0]).toMatchObject({ hp: 0, ap: 0, selected: false });
    expect(cards[1]).toMatchObject({ ap: 0, selected: false });
    expect(cards[2]!.selected).toBe(true);
  });

  it('вибраний загиблий картку не підсвічує; id поза порядком — у кінці', () => {
    const s1 = unit('s1', 'player');
    s1.alive = false;
    const cards = squadCards(state([s1, unit('s9', 'player')]), ['s1'], 's1');
    expect(cards.map((c) => c.id)).toEqual(['s1', 's9']);
    expect(cards.some((c) => c.selected)).toBe(false);
  });
});

describe('squadStripHtml', () => {
  it('картка: колір бійця, аватар з префіксом кліпа смуги, ім’я, HP, AP поділками, підпис', () => {
    const s = unit('s4', 'player', 'Олена');
    s.hp = 4;
    s.ap = 3;
    const box = dom(squadStripHtml(squadCards(state([s]), ['s4'], 's4')));
    const card = box.querySelector<HTMLButtonElement>('.sq-card')!;
    const color = fighterLook('s4').color;
    expect(card.dataset.unit).toBe('s4');
    expect(card.classList.contains('sel')).toBe(true);
    expect(card.getAttribute('aria-pressed')).toBe('true');
    expect(card.style.getPropertyValue('--c')).toBe(color);
    expect(card.getAttribute('aria-label')).toBe('Олена: HP 4/10 · AP 3/10');
    expect(card.title).toBe('Олена: HP 4/10 · AP 3/10 · Q — наступний боєць');
    expect(card.disabled).toBe(false);
    expect(box.querySelector('.sq-name')!.textContent).toBe('Олена');
    expect(box.querySelector('.sq-hpn')!.textContent).toBe('4/10');
    expect(box.querySelector<HTMLElement>('.sq-hp i')!.style.width).toBe('40%');
    expect(box.querySelectorAll('.sq-ap i')).toHaveLength(10);
    expect(box.querySelectorAll('.sq-ap i.on')).toHaveLength(3);
    // той самий боєць у ростері — `av-cp-s4`, у смузі — свій id кліпа (без дубля на сторінці)
    expect(box.querySelector('clipPath')!.id).toBe(SQUAD_CLIP_PREFIX + 's4');
    expect(dom(helmetSvg('s4')).querySelector('clipPath')!.id).toBe('av-cp-s4');
    expect(box.querySelector('.avatar')!.getAttribute('data-color')).toBe(color);
  });

  it('вибулі — вимкнена картка з підписом (за родом) і значком, без AP і числа HP', () => {
    const d = unit('s1', 'player', 'Олена');
    d.alive = false;
    const e = unit('s2', 'player', 'Тарас');
    const box = dom(squadStripHtml(squadCards(state([d], [e]), ['s1', 's2'], null)));
    const [cd, ce] = [...box.querySelectorAll<HTMLButtonElement>('.sq-card')];
    expect(cd!.disabled && ce!.disabled).toBe(true);
    expect(cd!.classList.contains('down')).toBe(true);
    expect(ce!.classList.contains('evac')).toBe(true);
    expect(cd!.querySelector('.sq-state')!.textContent).toBe('✝ Загинула');
    expect(cd!.querySelector('.sq-st-txt')!.textContent).toBe(' Загинула'); // на телефоні сховано — лишається ✝
    expect(ce!.querySelector('.sq-state')!.textContent).toBe('⇧ Евакуйовано');
    expect(cd!.getAttribute('aria-label')).toBe('Олена: загинула');
    expect(ce!.getAttribute('aria-label')).toBe('Тарас: евакуйовано');
    expect(ce!.title).toBe('Тарас: евакуйовано');
    expect(box.querySelectorAll('.sq-ap')).toHaveLength(0);
    expect(cd!.querySelector('.sq-hpn')!.textContent).toBe('');
    expect(cd!.querySelector<HTMLElement>('.sq-hp i')!.style.width).toBe('0%');
  });

  it('squadCardLabel чоловічого роду; rgba з #rrggbb', () => {
    expect(squadCardLabel({ id: 's1', name: 'Іван', hp: 0, maxHp: 10, ap: 0, maxAp: 10, status: 'down', selected: false })).toBe(
      'Іван: загинув'
    );
    expect(rgba('#8ee35b', 0.55)).toBe('rgba(142, 227, 91, 0.55)');
  });
});
