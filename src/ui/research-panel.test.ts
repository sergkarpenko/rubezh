// @vitest-environment jsdom
// П11.6 (Фаза 11, ADR-0058/0013): DOM-тести панелі «Дослідження»
// (src/ui/research-panel.ts). Патерн save-panel.test.ts: мінімальна розмітка
// index.html (#research) + справжнє ядро (createParty/hireScientist/...) —
// панель покриває DOM-механіку: найм/звільнення, слоти, каталог проєктів,
// підказки причин, вимкненість у бою (прецедент збереження, критерій 1).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createParty, type Party } from '../core/save';
import { BASE_LAB_SLOTS, MAX_LAB_SLOTS, SCIENTIST_SALARY, HIRE_SCIENTIST_PRICE } from '../core/research';
import { GRENADE_DAMAGE, HEAL_AMOUNT, HIT_CHANCE_CAP } from '../core/combat';
import { GUN_MODULE_DAMAGE } from '../core/intercept';
import { ARMOR_MAX_HP_BONUS, OPTICS_ACCURACY_BONUS } from '../core/workshop';
import { createResearchPanel, type ResearchPanelDeps } from './research-panel';
import { el } from './dom';

let party: Party;

function makeDeps(over: Partial<ResearchPanelDeps> = {}): ResearchPanelDeps {
  return {
    getParty: () => party,
    inBattle: () => false,
    isGameOver: () => false,
    journal: vi.fn(),
    drainResearch: vi.fn(),
    renderAll: vi.fn(),
    ...over,
  };
}

beforeEach(() => {
  document.body.innerHTML = '<div id="research"></div>';
  party = createParty(42);
});

describe('ResearchPanel: штат вчених', () => {
  it('найм — вчений у панелі, гроші списані, renderAll викликано', () => {
    const deps = makeDeps();
    const panel = createResearchPanel(deps);
    panel.render();
    const before = party.econ.money;
    (el('btn-hire-scientist') as HTMLButtonElement).click();
    expect(party.research.scientists).toHaveLength(1);
    expect(party.econ.money).toBe(before - HIRE_SCIENTIST_PRICE); // «норма» ×1
    expect(deps.renderAll).toHaveBeenCalledTimes(1);
    panel.render();
    expect(el('research').textContent).toContain('Зінаїда');
    expect((el('btn-fire-в1') as HTMLButtonElement).textContent).toBe('Звільнити');
  });

  it('найм без грошей — кнопка вимкнена, штат не змінюється', () => {
    party.econ.money = HIRE_SCIENTIST_PRICE - 1;
    const panel = createResearchPanel(makeDeps());
    panel.render();
    expect((el('btn-hire-scientist') as HTMLButtonElement).disabled).toBe(true);
    expect(party.research.scientists).toHaveLength(0);
  });

  it('звільнення — вченого немає в штаті, гроші найму не повертаються', () => {
    const deps = makeDeps();
    const panel = createResearchPanel(deps);
    panel.render();
    (el('btn-hire-scientist') as HTMLButtonElement).click();
    const afterHire = party.econ.money;
    panel.render();
    (el('btn-fire-в1') as HTMLButtonElement).click();
    expect(party.research.scientists).toHaveLength(0);
    expect(party.econ.money).toBe(afterHire); // без повернення коштів (ADR-0058)
  });

  it('шапка: кількість вчених, зарплата, слоти, пул', () => {
    const panel = createResearchPanel(makeDeps());
    panel.render();
    const head = el('research').querySelector('div')!.textContent!;
    expect(head).toContain('Вчених: 0');
    expect(head).toContain('зарплата ' + SCIENTIST_SALARY + '/добу');
    expect(head).toContain('слоти 0/' + BASE_LAB_SLOTS);
    expect(head).toContain('пул: 0');
  });
});

describe('ResearchPanel: каталог проєктів', () => {
  it('усі 6 проєктів каталогу — кнопки старту, ціна й точки видимі', () => {
    const panel = createResearchPanel(makeDeps());
    panel.render();
    const starts = document.querySelectorAll<HTMLButtonElement>('[id^="btn-start-"]');
    expect(starts).toHaveLength(6);
    expect(el('research').textContent).toContain('легка броня');
    expect(el('research').textContent).toContain('осколкова граната');
    expect(el('research').textContent).toContain('гарматний модуль');
  });

  it('старт проєкту — у роботі з прогресом, слоти 1/2; другий старт теж успішний, третій — заблокований', () => {
    const deps = makeDeps();
    const panel = createResearchPanel(deps);
    panel.render();
    (el('btn-start-0') as HTMLButtonElement).click(); // «легка броня»
    panel.render();
    expect(el('research').textContent).toContain('у роботі: 0/27'); // П11.8: точки ×0.75 (36 → 27)
    (el('btn-start-1') as HTMLButtonElement).click(); // «оптичний приціл»
    panel.render();
    expect(el('research').textContent).toContain('слоти 2/' + BASE_LAB_SLOTS);
    const third = el<HTMLButtonElement>('btn-start-3'); // «розширення лабораторії»
    expect(third.disabled).toBe(true); // слоти вичерпано
    expect(third.title).toContain('нема вільного слота');
  });

  it('Т2 з невиконаною передумовою — кнопка вимкнена з підказкою', () => {
    const panel = createResearchPanel(makeDeps());
    panel.render();
    const grenade = el<HTMLButtonElement>('btn-start-4'); // «осколкова граната» після «аптечки»
    expect(grenade.disabled).toBe(true);
    expect(grenade.title).toContain('спершу: аптечка');
  });

  it('завершений проєкт — мітка ✓, кнопки старту немає', () => {
    party.research.completed.push('аптечка');
    const panel = createResearchPanel(makeDeps());
    panel.render();
    const row = [...document.querySelectorAll('#research .ufo')].find((r) => r.textContent!.includes('аптечка'))!;
    expect(row.textContent).toContain('✓ завершено');
    expect(row.querySelector('button')).toBeNull();
  });

  it('недостатньо коштів — кнопка вимкнена з ціною в підказці', () => {
    party.econ.money = 10;
    const panel = createResearchPanel(makeDeps());
    panel.render();
    const start = el<HTMLButtonElement>('btn-start-0');
    expect(start.disabled).toBe(true);
    expect(start.title).toContain('недостатньо коштів');
  });
});

describe('ResearchPanel: критерій 1 — числові ефекти ДО старту (П12.5, ADR-0065)', () => {
  // Рядок картки протоколу за назвою.
  const row = (name: string): HTMLElement => [...document.querySelectorAll('#research .ufo')].find((r) => r.textContent!.includes(name))!;

  it('кожен протокол показує числовий ефект до старту — числа з констант каталогів', () => {
    const panel = createResearchPanel(makeDeps());
    panel.render();
    const s = party.roster.soldiers[0]!;
    // «легка броня»: +2 макс. HP (10 → 12) — «зараз» від першого солдата
    const armor = row('легка броня').textContent!;
    expect(armor).toContain('+' + ARMOR_MAX_HP_BONUS + ' макс. HP');
    expect(armor).toContain('(' + s.maxHp + ' → ' + (s.maxHp + ARMOR_MAX_HP_BONUS) + ')');
    // «оптичний приціл»: +5% точності (60% → 65%, кап 95%)
    const optics = row('оптичний приціл').textContent!;
    expect(optics).toContain('+' + OPTICS_ACCURACY_BONUS * 100 + '% точності');
    expect(optics).toContain('(' + Math.round(s.firingAccuracy * 100) + '% → ');
    expect(optics).toContain('кап ' + HIT_CHANCE_CAP * 100 + '%');
    // «аптечка»: +3 HP з AP-вартістю (combat.ts)
    expect(row('аптечка').textContent).toContain('+' + HEAL_AMOUNT + ' HP');
    // «осколкова граната»: пошкодження 3–5, уражає і своїх
    const grenade = row('осколкова граната').textContent!;
    expect(grenade).toContain(GRENADE_DAMAGE[0] + '–' + GRENADE_DAMAGE[1]);
    expect(grenade).toContain('уражає і своїх');
    // «розширення лабораторії»: слоти 2 → 3 (константи research.ts)
    expect(row('розширення лабораторії').textContent).toContain('(' + BASE_LAB_SLOTS + ' → ' + MAX_LAB_SLOTS + ')');
    // «гарматний модуль»: +2 пошкодження за раунд (intercept.ts)
    expect(row('гарматний модуль').textContent).toContain('+' + GUN_MODULE_DAMAGE + ' пошкодження за раунд');
  });

  it('ефект видимий і в картках активного/завершеного протоколу (до наступної дії)', () => {
    const panel = createResearchPanel(makeDeps());
    panel.render();
    (el('btn-start-0') as HTMLButtonElement).click(); // «легка броня» активна
    party.research.completed.push('аптечка'); // «аптечка» завершена
    panel.render();
    expect(row('легка броня').textContent).toContain('макс. HP');
    expect(row('аптечка').textContent).toContain('+' + HEAL_AMOUNT + ' HP');
  });

  it('без ростеру покращення показують ефект без «зараз → стане»', () => {
    party.roster.soldiers = [];
    const panel = createResearchPanel(makeDeps());
    panel.render();
    expect(row('легка броня').textContent).toContain('+' + ARMOR_MAX_HP_BONUS + ' макс. HP');
    expect(row('легка броня').textContent).not.toContain('→');
  });
});

describe('ResearchPanel: критерій 1 — лише на геосцені (прецедент збереження)', () => {
  it('у бою всі кнопки вимкнені (найм, звільнення, старт)', () => {
    party.research.scientists.push({ id: 'в1', name: 'Зінаїда' });
    const panel = createResearchPanel(makeDeps({ inBattle: () => true }));
    panel.render();
    expect((el('btn-hire-scientist') as HTMLButtonElement).disabled).toBe(true);
    expect((el('btn-fire-в1') as HTMLButtonElement).disabled).toBe(true);
    expect((el('btn-start-0') as HTMLButtonElement).disabled).toBe(true);
  });

  it('після банкрутства найм вимкнений (isGameOver)', () => {
    const panel = createResearchPanel(makeDeps({ isGameOver: () => true }));
    panel.render();
    expect((el('btn-hire-scientist') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('ResearchPanel: помилки ядра — у журнал, без кидка', () => {
  it('startProject кидає (стан змінився поза панеллю) — панель журналює і не ламається', () => {
    const deps = makeDeps();
    const panel = createResearchPanel(deps);
    panel.render(); // кнопка активна: коштів вистачає, слот вільний
    party.econ.money = 0; // гроші зникли поза панеллю — ядро кине, панель ще не перемальована
    (el('btn-start-0') as HTMLButtonElement).click();
    expect(deps.journal).toHaveBeenCalledWith(expect.stringContaining('Недостатньо грошей'), 'lose', 'base');
    expect(deps.renderAll).toHaveBeenCalledTimes(1);
    expect(party.research.active).toHaveLength(0); // стан ядра не змінився
  });
});
