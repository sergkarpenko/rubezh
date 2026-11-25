// @vitest-environment jsdom
// src/ui/roles.test.ts
// п16.4 (ADR-0147 п. 5–8, 13; EARS 4, 6, 8; рішення власника Т.186 «А»): шар відображення кар'єри й ролей —
// шеврон, рядки ростера, вікно вибору ролі, плитка дії ролі, рядки журналу дій ролей.
import { describe, expect, it } from 'vitest';
import {
  createGame,
  DASH_AP_BONUS,
  FIELD_AID_AMOUNT,
  FIELD_AID_AP_COST,
  makeUnit,
  PRECISE_AP_COST,
  type GameState,
  type UnitRole,
} from '../core/combat';
import { newCareer, RANK_THRESHOLDS, type SoldierCareer } from '../core/career';
import { battleEventText } from './journal';
import { chevronHtml, ROLE_INFO, roleDialogHtml, roleDialogTitle, roleLabel, roleTileView, xpLine } from './roles';
import { squadCards, squadStripHtml } from './squad-strip';

const career = (xp: number, role: SoldierCareer['role'] = null, index = 1): SoldierCareer => ({ ...newCareer(index), xp, role });

function game(roles?: Record<string, UnitRole>): GameState {
  return createGame({
    map: { width: 8, height: 4, blocked: new Set() },
    rng: () => 0,
    roles,
    units: [
      makeUnit({ id: 's1', side: 'player', pos: { x: 1, y: 1 } }),
      makeUnit({ id: 's2', side: 'player', pos: { x: 2, y: 1 }, hp: 5, maxHp: 10 }),
      makeUnit({ id: 'a1', side: 'alien', pos: { x: 6, y: 1 } }),
    ],
  });
}

describe('п16.4: шеврон, ростер і вікно вибору ролі', () => {
  it('шеврон: 1–4 смужки за званням, назва звання — підпис', () => {
    for (let r = 0; r < 4; r++) expect(chevronHtml(r).match(/<i><\/i>/g)).toHaveLength(r + 1);
    expect(chevronHtml(2)).toContain('aria-label="Сержант"');
  });

  it('досвід до наступного звання; найвище — без «до …»', () => {
    expect(xpLine(career(0))).toBe('досвід 0 · до «Боєць» ' + RANK_THRESHOLDS[1]);
    expect(xpLine(career(6))).toBe('досвід 6 · до «Ветеран» ' + (RANK_THRESHOLDS[3] - 6));
    expect(xpLine(career(RANK_THRESHOLDS[3] + 3))).toBe('досвід ' + (RANK_THRESHOLDS[3] + 3) + ' · найвище звання');
  });

  it('роль у ростері: значок і назва; «Боєць» без ролі — «роль не обрано»; «Рекрут» — нічого', () => {
    expect(roleLabel(career(6, 'sniper'))).toBe('◎ снайпер');
    expect(roleLabel(career(RANK_THRESHOLDS[1]))).toBe('роль не обрано');
    expect(roleLabel(career(RANK_THRESHOLDS[1] - 1))).toBe('');
  });

  it('вікно: заголовок EARS 4, примітка і три кнопки «Роль — «Дія»» з описом із констант ядра', () => {
    const c = career(RANK_THRESHOLDS[1]);
    expect(roleDialogTitle(c)).toBe('Підвищення: «Шрам» — Боєць. Оберіть роль');
    expect(roleDialogTitle(career(RANK_THRESHOLDS[2]))).toBe('Підвищення: «Шрам» — Сержант. Оберіть роль');
    document.body.innerHTML = roleDialogHtml(c);
    expect(document.querySelector('p.meta')!.textContent).toBe('Роль — назавжди. Дія ролі — раз за бій.');
    const picks = [...document.querySelectorAll<HTMLButtonElement>('.role-pick')];
    expect(picks.map((b) => b.dataset.role)).toEqual(['assault', 'sniper', 'medic']);
    expect(picks.map((b) => b.textContent)).toEqual([
      '» Штурмовик — «Ривок»+' + DASH_AP_BONUS + ' AP цього ходу, сама дія — 0 AP',
      '◎ Снайпер — «Точний постріл»прицільний постріл, шкода ×1,5 — ' + PRECISE_AP_COST + ' AP',
      '✚ Медик — «Польова допомога»+' + FIELD_AID_AMOUNT + ' HP собі чи сусідові без гелю — ' + FIELD_AID_AP_COST + ' AP',
    ]);
  });
});

describe('п16.4: плитка дії ролі (EARS 6)', () => {
  it('без вибраного — «Роль» без причини; без ролі — «без ролі»', () => {
    expect(roleTileView(game(), null)).toMatchObject({ role: null, label: 'Роль', reason: null });
    const v = roleTileView(game(), 's1');
    expect(v).toMatchObject({ role: null, label: 'Роль', reason: 'без ролі' });
    expect(v.hint).toContain('немає ролі');
  });

  it('роль: підпис дії; причина з roleActionBlock ядра — коротко на плитці, повністю в підказці', () => {
    const g = game({ s1: { role: 'sniper', used: false }, s2: { role: 'medic', used: true } });
    const ok = roleTileView(g, 's1');
    expect(ok).toMatchObject({ role: 'sniper', label: 'Точний', reason: null });
    expect(ok.hint).toContain(PRECISE_AP_COST + ' AP · «Точний постріл»');
    const used = roleTileView(g, 's2');
    expect(used).toMatchObject({ role: 'medic', label: 'Допомога', reason: 'вже було' });
    expect(used.hint).toContain('«Польова допомога» вже використано в цьому бою');
    g.units[0].ap = PRECISE_AP_COST - 1;
    expect(roleTileView(g, 's1')).toMatchObject({ reason: 'мало AP' });
    g.units[0].ap = 10;
    g.activeSide = 'alien';
    expect(roleTileView(g, 's1')).toMatchObject({ reason: 'недоступно' });
    expect(roleTileView(g, 's1').hint).toContain('Зараз хід демонів Розриву');
  });

  it('значки й ціни ролей — з констант ядра', () => {
    expect([ROLE_INFO.assault.ap, ROLE_INFO.sniper.ap, ROLE_INFO.medic.ap]).toEqual([0, PRECISE_AP_COST, FIELD_AID_AP_COST]);
  });
});

describe('п16.4: картка смуги загону (EARS 8) і журнал бою', () => {
  it('позивний замість імені, шеврон і значок ролі; ім’я з позивним — у підписі; без кар’єри — як раніше', () => {
    const g = game({ s1: { role: 'assault', used: false } });
    g.units[0].name = 'Іван';
    const cards = squadCards(g, ['s1', 's2'], 's1', { s1: { ...newCareer(0), xp: RANK_THRESHOLDS[2] } });
    expect(cards[0]).toMatchObject({ callsign: 'Крук', rank: 2, roleGlyph: '»' });
    expect(cards[1].callsign).toBeUndefined();
    document.body.innerHTML = squadStripHtml(cards);
    const [a, b] = [...document.querySelectorAll<HTMLElement>('.sq-card')];
    expect(a.querySelector('.sq-name')!.textContent).toBe('»Крук');
    expect(a.querySelectorAll('.chev i')).toHaveLength(3);
    expect(a.getAttribute('aria-label')).toBe('Іван «Крук»: HP 10/10 · AP 10/10');
    expect(b.querySelector('.sq-name')!.textContent).toBe('s2');
    expect(b.querySelector('.chev')).toBeNull();
  });

  it('рядки журналу дій ролей (рішення власника «А»)', () => {
    const name = (id: string): string => ({ s1: 'Іван', s2: 'Олена' })[id] ?? id;
    expect(battleEventText({ type: 'dash', unitId: 's1', bonus: 4 }, name)).toEqual({ text: '» Іван: «Ривок» +4 AP', cls: '' });
    expect(battleEventText({ type: 'precise_shot', shooterId: 's1', targetId: 'a1' }, name)).toEqual({
      text: '◎ Іван: «Точний постріл»',
      cls: '',
    });
    expect(battleEventText({ type: 'field_aid', unitId: 's2', targetId: 's1', healed: 3 }, name)).toEqual({
      text: '✚ Олена: «Польова допомога» → Іван +3 HP',
      cls: 'win',
    });
  });
});
