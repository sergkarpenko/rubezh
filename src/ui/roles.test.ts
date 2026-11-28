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
import {
  branchDialogHtml,
  branchDialogNote,
  branchDialogTitle,
  careerPathHtml,
  chevronHtml,
  ROLE_INFO,
  roleDesc,
  roleDialogHtml,
  roleDialogTitle,
  roleLabel,
  roleTileView,
  xpLine,
} from './roles';
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
    // п18.5 (ADR-0157): витрачений «Пробивний заряд» — мітка перед рядком пострілу
    expect(battleEventText({ type: 'charge', shooterId: 's1', targetId: 'a1' }, name)).toEqual({
      text: '⚡ Іван: «Пробивний заряд» — броню пробито (a1)',
      cls: '',
    });
    expect(battleEventText({ type: 'field_aid', unitId: 's2', targetId: 's1', healed: 3 }, name)).toEqual({
      text: '✚ Олена: «Польова допомога» → Іван +3 HP',
      cls: 'win',
    });
  });
});

describe('п22.2 (ADR-0183): опис дії ролі за спеціалізацією', () => {
  it('числа спеціалізацій і «двічі за бій» «Рятівника» в тултіпі плитки', () => {
    expect([roleDesc('assault'), roleDesc('sniper'), roleDesc('medic')]).toEqual([
      ROLE_INFO.assault.desc,
      ROLE_INFO.sniper.desc,
      ROLE_INFO.medic.desc,
    ]);
    expect(roleDesc('assault', 'breakthrough')).toBe('+6 AP цього ходу, сама дія — 0 AP');
    expect(roleDesc('sniper', 'hunter')).toBe('прицільний постріл, шкода ×2 — 6 AP');
    expect(roleDesc('medic', 'surgeon')).toBe('+5 HP собі чи сусідові без гелю — 2 AP');
    const g = game({
      s1: { role: 'medic', used: false, spec: 'rescuer', extraUses: 1 },
      s2: { role: 'sniper', used: false, spec: 'hunter' },
    });
    expect(roleTileView(g, 's1').hint).toContain('+3 HP собі чи сусідові без гелю — 2 AP · двічі за бій');
    expect(roleTileView(g, 's2').hint).toContain('шкода ×2 — 6 AP · раз за бій');
  });
});

// п22.3 (ADR-0185; рішення власника «А. Сходинки», тексти «Як на аркуші»): смуга шляху і вікно вибору гілки.
describe('п22.3 (ADR-0185): смуга шляху в ростері і вікно гілки', () => {
  const lines = (c: SoldierCareer): string[] => {
    document.body.innerHTML = careerPathHtml(c);
    return [...document.querySelectorAll('.s-path > div')].map((d) => d.textContent ?? '');
  };
  const xpOf = (r: number, plus = 0) => RANK_THRESHOLDS[r] + plus;

  it('«Рекрут» — лише наступна розвилка (роль) і досвід', () => {
    expect(lines(career(0))).toEqual(['○ Боєць: роль — » штурмовик · ◎ снайпер · ✚ медик', 'досвід 0 · до «Боєць» ' + RANK_THRESHOLDS[1]]);
  });

  it('«Боєць» з роллю — поточне з роллю, далі спеціалізації своєї ролі з ефектом', () => {
    expect(lines(career(xpOf(1, 1), 'sniper'))).toEqual([
      '● Боєць · ◎ снайпер',
      '○ Сержант: Мисливець — «Точний постріл» — шкода ×2 · Вартовий — дозор без штрафу точності',
      'досвід ' + xpOf(1, 1) + ' · до «Сержант» ' + (RANK_THRESHOLDS[2] - xpOf(1, 1)),
    ]);
    expect(lines(career(xpOf(1)))[0]).toBe('● Боєць · чекає вибору'); // роль ще не обрано (вікно відкрите)
    expect(lines(career(xpOf(1)))[1]).toBe('○ Сержант: спеціалізація ролі');
  });

  it('«Сержант» — пройдене «✓», поточне з гілкою, далі навички «Ветерана»; без гілки — «чекає вибору»', () => {
    const c: SoldierCareer = { ...career(xpOf(2), 'medic'), branches: { sergeant: 'surgeon' } };
    expect(lines(c)).toEqual([
      '✓ Боєць · ✚ медик',
      '● Сержант · Хірург',
      '○ Ветеран: Загартований — +2 HP · Тактик — +1 AP щоходу',
      'досвід ' + xpOf(2) + ' · до «Ветеран» ' + (RANK_THRESHOLDS[3] - xpOf(2)),
    ]);
    expect(lines(career(xpOf(2), 'medic'))[1]).toBe('● Сержант · чекає вибору');
  });

  it('«Ветеран» — увесь шлях, без наступної розвилки; назви гілок наступної розвилки — <b>', () => {
    const c: SoldierCareer = { ...career(xpOf(3, 2), 'assault'), branches: { sergeant: 'plating', veteran: 'tactician' } };
    expect(lines(c)).toEqual([
      '✓ Боєць · » штурмовик',
      '✓ Сержант · Панцир',
      '● Ветеран · Тактик',
      'досвід ' + xpOf(3, 2) + ' · найвище звання',
    ]);
    expect(careerPathHtml(c)).not.toContain('p-next');
    expect(careerPathHtml(career(0))).not.toContain('<b>'); // ролі — без виділення, як на аркуші
    expect(careerPathHtml(career(xpOf(1), 'assault'))).toContain('<b>Прорив</b> — «Ривок» +6 AP замість +4');
  });

  it('вікно «Сержанта»: заголовок, примітка з дією ролі, дві кнопки — назва й ефект з каталогу', () => {
    const c = career(xpOf(2), 'medic', 4); // позивний «Сокіл»
    expect(branchDialogTitle(c, 'sergeant')).toBe('Підвищення: «Сокіл» — Сержант. Оберіть спеціалізацію');
    expect(branchDialogNote(c, 'sergeant')).toBe('Спеціалізація — назавжди. Підсилює дію ролі «Польова допомога».');
    document.body.innerHTML = branchDialogHtml(c, 'sergeant');
    expect(document.querySelector('#role-dialog-title')!.textContent).toBe('Підвищення: «Сокіл» — Сержант. Оберіть спеціалізацію');
    const picks = [...document.querySelectorAll<HTMLButtonElement>('.role-pick')];
    expect(picks.map((b) => [b.id, b.dataset.branch, b.textContent])).toEqual([
      ['btn-branch-surgeon', 'surgeon', 'Хірург«Польова допомога» +5 HP'],
      ['btn-branch-rescuer', 'rescuer', 'Рятівник«Польова допомога» двічі за бій'],
    ]);
  });

  it('вікно «Ветерана»: «Оберіть навичку», «Навичка — назавжди. Діє в кожному бою.»', () => {
    const c: SoldierCareer = { ...career(xpOf(3), 'sniper', 4), branches: { sergeant: 'hunter' } };
    expect(branchDialogTitle(c, 'veteran')).toBe('Підвищення: «Сокіл» — Ветеран. Оберіть навичку');
    document.body.innerHTML = branchDialogHtml(c, 'veteran');
    expect(document.querySelector('p.meta')!.textContent).toBe('Навичка — назавжди. Діє в кожному бою.');
    expect([...document.querySelectorAll('.role-pick')].map((b) => b.textContent)).toEqual(['Загартований+2 HP', 'Тактик+1 AP щоходу']);
  });
});
