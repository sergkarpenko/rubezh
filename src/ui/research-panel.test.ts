// @vitest-environment jsdom
// П11.6 (Фаза 11, ADR-0058/0013): DOM-тести панелі «Дослідження»
// (src/ui/research-panel.ts). Патерн save-panel.test.ts: мінімальна розмітка
// index.html (#research) + справжнє ядро (createParty/hireScientist/...) —
// панель покриває DOM-механіку: найм/звільнення, слоти, каталог проєктів,
// підказки причин, вимкненість у бою (прецедент збереження, критерій 1).
// T.39 «Зрозуміла наука»: смуга кроків, картка протоколу (плашка, «Ціна», «Час ≈»),
// кнопка «Замовити в «Кузні»» (btn-forge-…), ціни за пресетом.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createParty, type Party } from '../core/save';
import { BASE_LAB_SLOTS, HIRE_SCIENTIST_PRICE, PROJECTS, SCIENTIST_SALARY } from '../core/research';
import { GRENADE_DAMAGE, GRENADE_RANGE, HEAL_AMOUNT, HEAL_AP_COST, HIT_CHANCE_CAP } from '../core/combat';
import { GUN_MODULE_DAMAGE } from '../core/intercept';
import { ARMOR_MAX_HP_BONUS, OPTICS_ACCURACY_BONUS, WORKSHOP_CATALOG } from '../core/workshop';
import { sciencePrice } from '../core/campaign';
import { createResearchPanel, type ResearchPanelDeps } from './research-panel';
import { el } from './dom';
import { ticksText } from './text';

let party: Party;

function makeDeps(over: Partial<ResearchPanelDeps> = {}): ResearchPanelDeps {
  return {
    getParty: () => party,
    inBattle: () => false,
    isGameOver: () => false,
    journal: vi.fn(),
    drainResearch: vi.fn(),
    renderAll: vi.fn(),
    scrollToResearch: vi.fn(),
    scrollToWorkshop: vi.fn(),
    showSquadTab: vi.fn(),
    ...over,
  };
}

beforeEach(() => {
  document.body.innerHTML = '<div id="research"></div>';
  party = createParty(42);
});

// Рядок картки протоколу за назвою (T.39: .sci-card).
const card = (name: string): HTMLElement =>
  [...document.querySelectorAll<HTMLElement>('#research .sci-card')].find((c) => c.textContent!.includes(name))!;

describe('ResearchPanel: штат вчених', () => {
  it('найм — вчений у панелі, гроші списані, renderAll викликано, кнопка «Вербувати техноманта — H кр.»', () => {
    const deps = makeDeps();
    const panel = createResearchPanel(deps);
    panel.render();
    expect(el('btn-hire-scientist').textContent).toBe('Вербувати техноманта — ' + HIRE_SCIENTIST_PRICE + ' кр.'); // «норма» ×1
    const before = party.econ.money;
    (el('btn-hire-scientist') as HTMLButtonElement).click();
    expect(party.research.scientists).toHaveLength(1);
    expect(party.econ.money).toBe(before - HIRE_SCIENTIST_PRICE);
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

  it('T.39 шапка: три рядки — «Техномантів: K · утримання S кр. за добу», потік, «Протоколів у роботі: A з N»', () => {
    const panel = createResearchPanel(makeDeps());
    panel.render();
    const head = el('research').querySelector('.sci-head')!.textContent!;
    expect(head).toContain('Техномантів: 0');
    expect(head).toContain('утримання ' + SCIENTIST_SALARY + ' кр. за добу');
    expect(head).toContain('Кожен техномант дає 1 очко потоку за добу');
    expect(head).toContain('Протоколів у роботі: 0 з ' + BASE_LAB_SLOTS);
  });
});

describe('T.39: смуга кроків «1. Дослідити → 2. Виготовити → 3. Видати»', () => {
  it('тексти кнопок за планом; кліки викликають відповідні дії навігації (без renderAll/зміни стану)', () => {
    const deps = makeDeps();
    createResearchPanel(deps).render();
    const steps = el('research').textContent!;
    expect(steps).toContain('1. Дослідити');
    expect(steps).toContain('протокол тут');
    expect(steps).toContain('2. Виготовити');
    expect(steps).toContain('у «Кузні»');
    expect(steps).toContain('3. Видати');
    expect(steps).toContain('вкладка «Загін»');
    (el('btn-sci-step-1') as HTMLButtonElement).click();
    (el('btn-sci-step-2') as HTMLButtonElement).click();
    (el('btn-sci-step-3') as HTMLButtonElement).click();
    expect(deps.scrollToResearch).toHaveBeenCalledTimes(1);
    expect(deps.scrollToWorkshop).toHaveBeenCalledTimes(1);
    expect(deps.showSquadTab).toHaveBeenCalledTimes(1);
    expect(deps.renderAll).not.toHaveBeenCalled(); // чиста навігація
  });

  it('кнопки смуги активні завжди, коли панель видима — і в бою теж (за планом це навігація)', () => {
    createResearchPanel(makeDeps({ inBattle: () => true })).render();
    for (const id of ['btn-sci-step-1', 'btn-sci-step-2', 'btn-sci-step-3']) {
      expect((el(id) as HTMLButtonElement).disabled).toBe(false);
    }
  });
});

describe('ResearchPanel: каталог проєктів (картки T.39)', () => {
  it('усі 6 проєктів каталогу — картки з кнопками старту; назви з каталогу', () => {
    const panel = createResearchPanel(makeDeps());
    panel.render();
    expect(document.querySelectorAll('#research .sci-card')).toHaveLength(6);
    expect(document.querySelectorAll<HTMLButtonElement>('[id^="btn-start-"]')).toHaveLength(6);
    expect(el('research').textContent).toContain('Композитна броня');
    expect(el('research').textContent).toContain('Імпульсна граната');
    expect(el('research').textContent).toContain('Гарматний модуль перехоплювача');
    // не розпочато: «Ціна C кр.», «Час ≈ …», кнопка «Дослідити — C кр.» на всю ширину
    const armor = card('Композитна броня');
    expect(armor.textContent).toContain('Ціна');
    expect(armor.textContent).toContain('96 кр.');
    expect(armor.textContent).toContain('Час ≈');
    const start = el<HTMLButtonElement>('btn-start-0');
    expect(start.textContent).toBe('Дослідити — 96 кр.');
    expect(start.classList.contains('wide')).toBe(true);
    expect(el('research').textContent).not.toContain('14 очок'); // рядка «96 · 14 очок потоку» більше немає (критерій 1)
  });

  it('старт проєкту — картка в роботі: смуга прогресу + «X з P очок потоку»; зайнято 2/2 слотів; третій старт заблокований', () => {
    const deps = makeDeps();
    const panel = createResearchPanel(deps);
    panel.render();
    (el('btn-start-0') as HTMLButtonElement).click(); // «Композитна броня»
    panel.render();
    const armor = card('Композитна броня');
    expect(armor.querySelector('.sci-bar')).not.toBeNull();
    expect(armor.textContent).toContain('0 з ' + PROJECTS[0].points + ' очок потоку');
    expect(armor.textContent).toContain('зупинено: немає техномантів'); // K = 0
    (el('btn-start-1') as HTMLButtonElement).click(); // «Кібернетичне око»
    panel.render();
    expect(el('research').querySelector('.sci-head')!.textContent).toContain('Протоколів у роботі: 2 з ' + BASE_LAB_SLOTS);
    const third = el<HTMLButtonElement>('btn-start-3'); // «Розширення лабораторії»
    expect(third.disabled).toBe(true); // слоти вичерпано
    expect(third.title).toContain('немає вільного слота');
  });

  it('T2 з невиконаною передумовою — кнопка вимкнена з підказкою (title як зараз)', () => {
    const panel = createResearchPanel(makeDeps());
    panel.render();
    const grenade = el<HTMLButtonElement>('btn-start-4'); // «Імпульсна граната» після «Регенеративного гелю»
    expect(grenade.disabled).toBe(true);
    expect(grenade.title).toContain('спершу: «Регенеративний гель»');
  });

  it('завершений протокол-предмет — плашка «завершено» + кнопка «Замовити в «Кузні»»; «Розширення лабораторії» — лише плашка', () => {
    party.research.completed.push('medkit');
    party.research.completed.push('lab-extension');
    const panel = createResearchPanel(makeDeps());
    panel.render();
    const medkit = card('Регенеративний гель');
    expect(medkit.querySelector('.sci-badge')!.textContent).toBe('завершено');
    expect(medkit.querySelector('.sci-badge')!.classList.contains('ok')).toBe(true);
    expect(medkit.querySelector('#btn-forge-medkit')).not.toBeNull();
    expect(card('Розширення лабораторії').querySelector('button')).toBeNull(); // лише плашка
  });

  it('недостатньо коштів — кнопка вимкнена з ціною в підказці (title як зараз)', () => {
    party.econ.money = 10;
    const panel = createResearchPanel(makeDeps());
    panel.render();
    const start = el<HTMLButtonElement>('btn-start-0');
    expect(start.disabled).toBe(true);
    expect(start.title).toContain('недостатньо кредитів');
  });
});

describe('T.39: плашки стану картки (перша умова зверху)', () => {
  it('без техномантів і з грошима — «потрібен техномант»; без грошей — «бракує кредитів»', () => {
    const panel = createResearchPanel(makeDeps());
    panel.render();
    expect(card('Композитна броня').querySelector('.sci-badge')!.textContent).toBe('потрібен техномант');
    party.econ.money = 10;
    panel.render();
    expect(card('Композитна броня').querySelector('.sci-badge')!.textContent).toBe('бракує кредитів');
  });

  it('передумова — «після «…»»; зайнято слоти — «немає вільного слота»; активний — «у роботі» (клас run)', () => {
    const panel = createResearchPanel(makeDeps());
    panel.render();
    expect(card('Імпульсна граната').querySelector('.sci-badge')!.textContent).toBe('після «Регенеративний гель»');
    (el('btn-start-0') as HTMLButtonElement).click();
    (el('btn-start-1') as HTMLButtonElement).click();
    panel.render();
    expect(card('Розширення лабораторії').querySelector('.sci-badge')!.textContent).toBe('немає вільного слота');
    const runBadge = card('Композитна броня').querySelector('.sci-badge')!;
    expect(runBadge.textContent).toBe('у роботі');
    expect(runBadge.classList.contains('run')).toBe(true);
  });

  it('з техномантом і грошима нерозпочатий протокол — «доступний» (нейтральна плашка)', () => {
    const panel = createResearchPanel(makeDeps());
    panel.render();
    (el('btn-hire-scientist') as HTMLButtonElement).click(); // 300 − 100 = 200 ≥ 96
    panel.render();
    const badge = card('Композитна броня').querySelector('.sci-badge')!;
    expect(badge.textContent).toBe('доступний');
    expect(badge.className).toBe('sci-badge'); // без додаткових класів
  });
});

describe('T.39: формули «Час ≈ …» (K техномантів, P очок, A протоколів у роботі)', () => {
  it('K = 0: «Час ≈ 14 діб з одним техномантом, 7 — з двома» (друге число без «діб», текст плану дослівно)', () => {
    createResearchPanel(makeDeps()).render();
    expect(card('Композитна броня').textContent).toContain('Час ≈ 14 діб з одним техномантом, 7 — з двома');
  });

  it('K = 1: «Час ≈ 14 діб з вашим техномантом»; K = 2: «Час ≈ 7 діб з вашими 2 техномантами» (орудний відмінок)', () => {
    const panel = createResearchPanel(makeDeps());
    panel.render();
    (el('btn-hire-scientist') as HTMLButtonElement).click();
    panel.render();
    expect(card('Композитна броня').textContent).toContain('Час ≈ 14 діб з вашим техномантом');
    (el('btn-hire-scientist') as HTMLButtonElement).click();
    panel.render();
    expect(card('Композитна броня').textContent).toContain('Час ≈ 7 діб з вашими 2 техномантами');
  });

  it('у роботі, K ≥ 1: D = ⌈(P − X) · A / K⌉ діб — «6 з 14 очок потоку · ще ≈ 16 діб» (A = 2, K = 1)', () => {
    const panel = createResearchPanel(makeDeps());
    panel.render();
    (el('btn-hire-scientist') as HTMLButtonElement).click(); // K = 1
    (el('btn-start-0') as HTMLButtonElement).click(); // броня активна, X = 0
    (el('btn-start-1') as HTMLButtonElement).click(); // око активне, A = 2
    party.research.active.find((p) => p.id === 'armor')!.invested = 6; // X = 6
    panel.render();
    expect(card('Композитна броня').textContent).toContain('6 з 14 очок потоку · ще ≈ 16 діб');
  });

  it('у роботі без техномантів: «… очок потоку · зупинено: немає техномантів» (без «ще ≈»)', () => {
    const panel = createResearchPanel(makeDeps());
    panel.render();
    (el('btn-start-0') as HTMLButtonElement).click();
    party.research.scientists.push({ id: 'в1', name: 'Зінаїда' });
    panel.render();
    (el('btn-fire-в1') as HTMLButtonElement).click();
    panel.render();
    const armor = card('Композитна броня').textContent!;
    expect(armor).toContain('0 з 14 очок потоку · зупинено: немає техномантів');
    expect(armor).not.toContain('ще ≈');
  });
});

describe('T.39: кнопка «Замовити в «Кузні»» на картці завершеного протоколу (btn-forge-<id>)', () => {
  it('клік — orderItem: гроші списані, черга зросла, renderAll; умова/title — ті самі, що в btn-order-<id>', () => {
    party.research.completed.push('medkit');
    const deps = makeDeps();
    const panel = createResearchPanel(deps);
    panel.render();
    const forge = el<HTMLButtonElement>('btn-forge-medkit');
    expect(forge.textContent).toBe('Замовити в «Кузні» — ' + WORKSHOP_CATALOG.medkit.cost + ' кр.');
    expect(forge.title).toContain('готовність через ' + ticksText(WORKSHOP_CATALOG.medkit.ticks));
    const before = party.econ.money;
    forge.click();
    expect(party.econ.money).toBe(before - WORKSHOP_CATALOG.medkit.cost);
    expect(party.workshop.queue).toHaveLength(1);
    expect(deps.renderAll).toHaveBeenCalledTimes(1);
  });

  it('недостатньо грошей — вимкнена, title «Недостатньо кредитів (ціна N)» (як у «Кузні»)', () => {
    party.research.completed.push('medkit');
    party.econ.money = 10;
    createResearchPanel(makeDeps()).render();
    const forge = el<HTMLButtonElement>('btn-forge-medkit');
    expect(forge.disabled).toBe(true);
    expect(forge.title).toBe('Недостатньо кредитів (ціна ' + WORKSHOP_CATALOG.medkit.cost + ')');
  });

  it('під кнопкою — «У «Кузні»: виготовляється, ще T» і/або «На складі: N — видайте на вкладці «Загін»»', () => {
    party.research.completed.push('medkit');
    party.workshop.queue.push({ id: 'medkit', ticksLeft: 12 });
    party.workshop.store.medkit = 2;
    createResearchPanel(makeDeps()).render();
    const c = card('Регенеративний гель').textContent!;
    expect(c).toContain('У «Кузні»: виготовляється, ще ' + ticksText(12));
    expect(c).toContain('На складі: 2 — видайте на вкладці «Загін»');
  });

  it('гарматний модуль: на складі лише «На складі: N» (ручного встановлення в UI немає)', () => {
    party.research.completed.push('gun-module');
    party.workshop.store['gun-module'] = 1;
    createResearchPanel(makeDeps()).render();
    expect(el('btn-forge-gun-module')).not.toBeNull();
    const c = card('Гарматний модуль перехоплювача').textContent!;
    expect(c).toContain('На складі: 1');
    expect(c).not.toContain('Перехоплювач»'); // немає підказки на дію, якої в UI немає
  });

  it('у бою кнопка «Замовити в «Кузні»» вимкнена', () => {
    party.research.completed.push('medkit');
    createResearchPanel(makeDeps({ inBattle: () => true })).render();
    expect((el('btn-forge-medkit') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('T.39: ефекти протоколів простими словами (числа з констант; «зараз → стане» від першого солдата)', () => {
  it('кожен протокол на картці — текст від plainProjectEffect (критерій 1: без «96 · 14 очок»)', () => {
    const panel = createResearchPanel(makeDeps());
    panel.render();
    const s = party.roster.soldiers[0]!;
    // «легка броня»: +2 макс. HP (10 → 12) — «зараз» від першого солдата
    // «оптичний приціл»: +5% точності (60% → 65%, кап 95%)
    // «аптечка»: +3 HP з AP-вартістю (combat.ts)
    // «осколкова граната»: пошкодження 3–5, уражає і своїх
    // «розширення лабораторії»: слоти 2 → 3 (константи research.ts)
    // «гарматний модуль»: +2 пошкодження за раунд (intercept.ts)
    expect(card('Композитна броня').textContent).toContain(s.maxHp + ARMOR_MAX_HP_BONUS + ' HP замість ' + s.maxHp);
    const optics = card('Кібернетичне око').textContent!;
    expect(optics).toContain(
      Math.round(Math.min(HIT_CHANCE_CAP, s.firingAccuracy + OPTICS_ACCURACY_BONUS) * 100) +
        ' % замість ' +
        Math.round(s.firingAccuracy * 100) +
        ' %'
    );
    expect(card('Регенеративний гель').textContent).toContain(
      'Лікує ' + HEAL_AMOUNT + ' HP за ' + HEAL_AP_COST + ' AP; одна штука на місію'
    );
    const grenade = card('Імпульсна граната').textContent!;
    expect(grenade).toContain(
      'Пошкодження ' + GRENADE_DAMAGE[0] + '–' + GRENADE_DAMAGE[1] + ' у зоні хреста, дальність ' + GRENADE_RANGE + '; зачіпає і своїх'
    );
    expect(card('Розширення лабораторії').textContent).toContain('протоколи в роботі одночасно замість');
    expect(card('Гарматний модуль перехоплювача').textContent).toContain('на ' + GUN_MODULE_DAMAGE + ' пошкодження більше за раунд');
    expect(el('research').textContent).toContain('HP'); // числа є
    expect(el('research').textContent).not.toContain('->'); // старий формат «зараз -> стане» в картках відсутній
  });

  it('ефект показується і в картках активного/завершеного протоколу', () => {
    const panel = createResearchPanel(makeDeps());
    panel.render();
    (el('btn-start-0') as HTMLButtonElement).click(); // броня активна
    party.research.completed.push('medkit'); // гель завершено
    panel.render();
    expect(card('Композитна броня').textContent).toContain('HP замість');
    expect(card('Регенеративний гель').textContent).toContain('Лікує ' + HEAL_AMOUNT + ' HP');
  });

  it('без ростеру — без порівняння «замість» (план: «без ростеру — без порівняння»)', () => {
    party.roster.soldiers = [];
    const panel = createResearchPanel(makeDeps());
    panel.render();
    const armor = card('Композитна броня').textContent!;
    expect(armor).toContain('+' + ARMOR_MAX_HP_BONUS + ' HP');
    expect(armor).not.toContain('замість');
    expect(card('Кібернетичне око').textContent).not.toContain('замість');
  });
});

describe('ResearchPanel: критерій 1 — лише на геострені (прецедент збереження)', () => {
  it('у бою вимкнені всі кнопки панелі (найм, звільнення, старт), крім кнопок смуги кроків', () => {
    party.research.scientists.push({ id: 'в1', name: 'Зінаїда' });
    const panel = createResearchPanel(makeDeps({ inBattle: () => true }));
    panel.render();
    expect((el('btn-hire-scientist') as HTMLButtonElement).disabled).toBe(true);
    expect((el('btn-fire-в1') as HTMLButtonElement).disabled).toBe(true);
    expect((el('btn-start-0') as HTMLButtonElement).disabled).toBe(true);
    // смуга кроків — навігація, активна й у бою (за планом)
    expect((el('btn-sci-step-1') as HTMLButtonElement).disabled).toBe(false);
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
    party.econ.money = 0; // гроші зникли поза панеллю — ядро кидає, панель ще не перемальована
    (el('btn-start-0') as HTMLButtonElement).click();
    expect(deps.journal).toHaveBeenCalledWith(expect.stringContaining('Недостатньо кредитів'), 'lose', 'base');
    expect(deps.renderAll).toHaveBeenCalledTimes(1);
    expect(party.research.active).toHaveLength(0); // стан ядра не змінився
  });
});

describe('ResearchPanel: ціни за пресетом (T.29) — картки T.39 показують пресети', () => {
  it('«легкий»: найм 50, утримання 5, протокол броні 48, «Замовити в «Кузні»» 30 — в усіх місцях', () => {
    party = createParty(42, 'легкий');
    const panel = createResearchPanel(makeDeps());
    panel.render();
    expect(el('btn-hire-scientist').textContent).toBe('Вербувати техноманта — ' + sciencePrice(HIRE_SCIENTIST_PRICE, 'легкий') + ' кр.');
    expect(el('research').querySelector('.sci-head')!.textContent).toContain(
      'утримання ' + sciencePrice(SCIENTIST_SALARY, 'легкий') + ' кр. за добу'
    );
    const price = sciencePrice(PROJECTS[0].cost, 'легкий');
    const armor = card('Композитна броня');
    expect(armor.textContent).toContain('Ціна');
    expect(armor.textContent).toContain(price + ' кр.');
    const start = el('btn-start-0') as HTMLButtonElement;
    expect(start.textContent).toBe('Дослідити — ' + price + ' кр.');
    expect(start.title).toBe('Почати протокол (−' + price + ')');
    const before = party.econ.money;
    start.click();
    expect(party.econ.money).toBe(before - price);
    // завершений протокол-предмет: ціна виробництва теж за пресетом
    party.research.completed.push('armor');
    panel.render();
    const forgePrice = sciencePrice(WORKSHOP_CATALOG.armor.cost, 'легкий');
    expect((el('btn-forge-armor') as HTMLButtonElement).textContent).toBe('Замовити в «Кузні» — ' + forgePrice + ' кр.');
  });
});

// Т.43 (знахідка 14): причина неактивної кнопки — рядком під нею, текст = title.
describe('Т.43: причини під неактивними кнопками панелі «Дослідження»', () => {
  const why = (b: Element): string | null => {
    const n = b.nextElementSibling;
    return n?.classList.contains('btn-why') ? n.textContent : null;
  };
  const btn = (id: string): HTMLButtonElement => el<HTMLButtonElement>(id);

  it('«Вербувати техноманта» і «Дослідити»: рядок = title, коли є причина; без причини рядка немає', () => {
    party = createParty(42, 'легкий'); // техномант 50, протокол броні 48 (множник не 1)
    party.econ.money = 47;
    const panel = createResearchPanel(makeDeps());
    panel.render();
    expect(why(btn('btn-hire-scientist'))).toBe('Недостатньо кредитів (ціна вербування 50)');
    expect(why(btn('btn-hire-scientist'))).toBe(btn('btn-hire-scientist').title);
    expect(btn('btn-start-0').disabled).toBe(true);
    expect(why(btn('btn-start-0'))).not.toBeNull();
    expect(why(btn('btn-start-0'))).toBe(btn('btn-start-0').title);
    party.econ.money = 50; // рівно ціна вербування — кнопка активна, рядка немає
    panel.render();
    expect(btn('btn-hire-scientist').disabled).toBe(false);
    expect(why(btn('btn-hire-scientist'))).toBeNull();
    party.econ.money = 1000;
    btn('btn-hire-scientist').click();
    panel.render();
    expect(btn('btn-start-0').disabled).toBe(false);
    expect(why(btn('btn-start-0'))).toBeNull();
    // у бою «Дослідити» неактивна, але причини немає — рядка немає
    createResearchPanel(makeDeps({ inBattle: () => true })).render();
    expect(btn('btn-start-0').disabled).toBe(true);
    expect(why(btn('btn-start-0'))).toBeNull();
  });

  it('«Замовити в «Кузні»» на картці завершеного протоколу: без кредитів — рядок = title; у бою з кредитами — без рядка', () => {
    party = createParty(42, 'легкий');
    party.research.completed.push('armor');
    party.econ.money = 0;
    createResearchPanel(makeDeps()).render();
    expect(why(btn('btn-forge-armor'))).toBe('Недостатньо кредитів (ціна ' + sciencePrice(WORKSHOP_CATALOG.armor.cost, 'легкий') + ')');
    expect(why(btn('btn-forge-armor'))).toBe(btn('btn-forge-armor').title);
    party.econ.money = 1000;
    createResearchPanel(makeDeps({ inBattle: () => true })).render();
    expect(btn('btn-forge-armor').disabled).toBe(true);
    expect(why(btn('btn-forge-armor'))).toBeNull();
  });
});
