// @vitest-environment jsdom
// П11.6 (Фаза 11, ADR-0058/0013): DOM-тести панелі «Цех»
// (src/ui/workshop-panel.ts). Патерн research-panel.test.ts: мінімальна
// розмітка index.html (#workshop) + справжнє ядро (orderItem/workshopTick) —
// панель покриває DOM-механіку: гейт дослідження, оплата, черга з одним
// активним замовленням, склад-лічильники, вимкненість у бою (критерій 1).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createParty, type Party } from '../core/save';
import { ITEM_IDS, WORKSHOP_CATALOG, ARMOR_MAX_HP_BONUS, OPTICS_ACCURACY_BONUS, itemName, workshopTick } from '../core/workshop';
import { GRENADE_DAMAGE, GRENADE_RANGE, HEAL_AMOUNT, HIT_CHANCE_CAP } from '../core/combat';
import { GUN_MODULE_DAMAGE } from '../core/intercept';
import { createWorkshopPanel, type WorkshopPanelDeps } from './workshop-panel';
import { el } from './dom';
import { ticksText } from './text';

let party: Party;

function makeDeps(over: Partial<WorkshopPanelDeps> = {}): WorkshopPanelDeps {
  return {
    getParty: () => party,
    inBattle: () => false,
    isGameOver: () => false,
    journal: vi.fn(),
    drainWorkshop: vi.fn(),
    renderAll: vi.fn(),
    ...over,
  };
}

beforeEach(() => {
  document.body.innerHTML = '<div id="workshop"></div>';
  party = createParty(42);
});

describe('WorkshopPanel: каталог і гейт дослідження', () => {
  it('усі 5 предметів каталогу — кнопки замовлення з ціною й тиками', () => {
    const panel = createWorkshopPanel(makeDeps());
    panel.render();
    for (const id of ITEM_IDS) {
      const b = el<HTMLButtonElement>('btn-order-' + id.replace(/ /g, '-'));
      expect(b).toBeTruthy();
      expect(b.textContent).toBe('Замовити');
    }
    expect(el('workshop').textContent).toContain(ticksText(WORKSHOP_CATALOG['medkit'].ticks));
  });

  it('не досліджений предмет — кнопка вимкнена з підказкою; досліджений — активна', () => {
    const panel = createWorkshopPanel(makeDeps());
    panel.render();
    const locked = el<HTMLButtonElement>('btn-order-medkit');
    expect(locked.disabled).toBe(true);
    expect(locked.title).toContain('Ще не досліджено');
    party.research.completed.push('medkit');
    panel.render();
    expect(el<HTMLButtonElement>('btn-order-medkit').disabled).toBe(false);
  });

  it('недостатньо коштів — кнопка вимкнена з ціною в підказці', () => {
    party.research.completed.push('medkit');
    party.econ.money = 5;
    const panel = createWorkshopPanel(makeDeps());
    panel.render();
    const b = el<HTMLButtonElement>('btn-order-medkit');
    expect(b.disabled).toBe(true);
    expect(b.title).toContain('Недостатньо кредитів');
  });
});

describe('WorkshopPanel: замовлення, черга і склад', () => {
  it('замовлення — оплата одразу, активне замовлення з тиками; друге — у черзі', () => {
    party.research.completed.push('medkit', 'armor');
    const deps = makeDeps();
    const panel = createWorkshopPanel(deps);
    panel.render();
    const before = party.econ.money;
    (el('btn-order-medkit') as HTMLButtonElement).click();
    expect(party.econ.money).toBe(before - WORKSHOP_CATALOG['medkit'].cost);
    expect(party.workshop.queue).toHaveLength(1);
    panel.render();
    expect(el('workshop').textContent).toContain('Активне замовлення: Регенеративний гель — 12 тіків');
    (el('btn-order-armor') as HTMLButtonElement).click();
    expect(party.workshop.queue).toHaveLength(2);
    panel.render();
    expect(el('workshop').textContent).toContain('у черзі ще 1');
  });

  it('тики геосцени доводять замовлення до складу — лічильник росте (ядро workshopTick)', () => {
    party.research.completed.push('medkit');
    const panel = createWorkshopPanel(makeDeps());
    panel.render();
    (el('btn-order-medkit') as HTMLButtonElement).click();
    for (let i = 0; i < WORKSHOP_CATALOG['medkit'].ticks; i++) workshopTick(party.workshop);
    expect(party.workshop.store['medkit']).toBe(1);
    panel.render();
    expect(el('workshop').textContent).toContain('Регенеративний гель 1');
    expect(el('workshop').textContent).toContain('Активне замовлення: —'); // черга порожня
  });

  it('склад показує нульові лічильники на старті', () => {
    const panel = createWorkshopPanel(makeDeps());
    panel.render();
    const text = el('workshop').textContent!;
    for (const id of ITEM_IDS) expect(text).toContain(itemName(id) + ' 0');
  });
});

describe('WorkshopPanel: критерій 1 — числові ефекти ДО замовлення (П12.5, ADR-0065)', () => {
  // Рядок картки предмета за назвою.
  const row = (name: string): HTMLElement =>
    [...document.querySelectorAll<HTMLElement>('#workshop .ufo')].find((r) => r.textContent!.includes(name))!;

  it('кожен предмет показує числовий ефект до замовлення — числа з констант каталогів', () => {
    const panel = createWorkshopPanel(makeDeps());
    panel.render();
    const s = party.roster.soldiers[0]!;
    // «легка броня»: +2 макс. HP (10 → 12)
    const armor = row('Композитна броня').textContent!;
    expect(armor).toContain('+' + ARMOR_MAX_HP_BONUS + ' макс. HP');
    expect(armor).toContain('(' + s.maxHp + ' → ' + (s.maxHp + ARMOR_MAX_HP_BONUS) + ')');
    // «оптичний приціл»: +5% точності (кап 95%)
    expect(row('Кібернетичне око').textContent).toContain('+' + OPTICS_ACCURACY_BONUS * 100 + '% точності');
    expect(row('Кібернетичне око').textContent).toContain('кап ' + HIT_CHANCE_CAP * 100 + '%');
    // «аптечка»: механіка витратника — +3 HP, по одній на місію
    const medkit = row('Регенеративний гель').textContent!;
    expect(medkit).toContain('+' + HEAL_AMOUNT + ' HP');
    expect(medkit).toContain('по одній на місію');
    // «осколкова граната»: пошкодження 3–5, дальність, уражає і своїх, по одній на місію
    const grenade = row('Імпульсна граната').textContent!;
    expect(grenade).toContain('пошкодження ' + GRENADE_DAMAGE[0] + '–' + GRENADE_DAMAGE[1]);
    expect(grenade).toContain('дальність ' + GRENADE_RANGE);
    expect(grenade).toContain('уражає і своїх');
    expect(grenade).toContain('по одній на місію');
    // «гарматний модуль»: +2 пошкодження за раунд повітряного бою
    expect(row('Гарматний модуль перехоплювача').textContent).toContain('+' + GUN_MODULE_DAMAGE + ' пошкодження за раунд повітряного бою');
  });

  it('ефект видимий до ПЕРШОГО замовлення (гейт дослідження вимкнений — ефект усе одно показано)', () => {
    const panel = createWorkshopPanel(makeDeps());
    panel.render();
    expect(el<HTMLButtonElement>('btn-order-medkit').disabled).toBe(true); // ще не досліджено
    expect(row('Регенеративний гель').textContent).toContain('+' + HEAL_AMOUNT + ' HP'); // критерій: до дії
  });
});

describe('WorkshopPanel: критерій 1 — лише на геосцені', () => {
  it('у бою кнопки замовлення вимкнені', () => {
    party.research.completed.push('medkit');
    const panel = createWorkshopPanel(makeDeps({ inBattle: () => true }));
    panel.render();
    expect((el('btn-order-medkit') as HTMLButtonElement).disabled).toBe(true);
  });

  it('помилка ядра (гроші зникли поза панеллю) — у журнал, без кидка', () => {
    party.research.completed.push('medkit');
    const deps = makeDeps();
    const panel = createWorkshopPanel(deps);
    panel.render();
    party.econ.money = 0;
    (el('btn-order-medkit') as HTMLButtonElement).click();
    expect(deps.journal).toHaveBeenCalledWith(expect.stringContaining('Недостатньо кредитів'), 'lose', 'base');
    expect(party.workshop.queue).toHaveLength(0);
  });
});

describe('WorkshopPanel: ціни за пресетом (Т.29)', () => {
  it('«легкий»: броня 30 — у списку, підказці і списанні', () => {
    party = createParty(42, 'легкий');
    party.research.completed.push('armor');
    const panel = createWorkshopPanel(makeDeps());
    panel.render();
    expect(el('workshop').textContent).toContain('Композитна броня · 30 · ');
    const b = el<HTMLButtonElement>('btn-order-armor');
    expect(b.title).toContain('(−30, ');
    const before = party.econ.money;
    b.click();
    expect(party.econ.money).toBe(before - 30);
  });
});

// Т.43 (знахідка 14): причина неактивної кнопки — рядком під нею, текст = title.
describe('Т.43: причина під «Замовити» в «Кузні»', () => {
  const why = (b: Element): string | null => {
    const n = b.nextElementSibling;
    return n?.classList.contains('btn-why') ? n.textContent : null;
  };

  it('не досліджено / бракує кредитів — рядок = title; можна замовити або лише бій — рядка немає', () => {
    party = createParty(42, 'легкий');
    const order = (): HTMLButtonElement => el<HTMLButtonElement>('btn-order-armor');
    createWorkshopPanel(makeDeps()).render();
    expect(why(order())).toBe('Ще не досліджено');
    expect(why(order())).toBe(order().title);
    party.research.completed.push('armor');
    party.econ.money = 29; // броня на «легкому» — 30
    createWorkshopPanel(makeDeps()).render();
    expect(why(order())).toBe('Недостатньо кредитів (ціна 30)');
    party.econ.money = 30;
    createWorkshopPanel(makeDeps()).render();
    expect(order().disabled).toBe(false);
    expect(why(order())).toBeNull();
    createWorkshopPanel(makeDeps({ inBattle: () => true })).render();
    expect(order().disabled).toBe(true);
    expect(why(order())).toBeNull();
  });

  // Т.80: кнопка і причина — одна група .order-line у рядку каталогу: причина не
  // відривається від кнопки за іншого шрифту (у CI переносилась під кнопку)
  it('Т.80: кнопка і причина — разом у групі .order-line, остання в рядку каталогу', () => {
    party = createParty(42);
    createWorkshopPanel(makeDeps()).render();
    const rows = document.querySelectorAll('#workshop .ufo');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const line = row.lastElementChild!;
      expect(line.classList.contains('order-line')).toBe(true);
      expect(line.firstElementChild!.id).toMatch(/^btn-order-/);
      expect(line.children[1]?.classList.contains('btn-why')).toBe(true);
    }
  });
});

// п18.5 (ADR-0157): «Пробивний заряд» — у «Кузні» після «Анатомії Розриву», трофей гончака на вході.
describe('п18.5: «Пробивний заряд» у «Кузні»', () => {
  it('рядок заряду з ефектом; до протоколу — «Ще не досліджено»; без трофея — причина; з трофеєм — замовлення', () => {
    const panel = createWorkshopPanel(makeDeps());
    panel.render();
    const b = el<HTMLButtonElement>('btn-order-breach-charge');
    expect(b.disabled).toBe(true);
    expect(b.title).toBe('Ще не досліджено');
    expect(el('workshop').textContent).toContain('Пробивний заряд · 50 · ');
    expect(el('workshop').textContent).toContain('Атака по броньованій цілі — без броні (один раз)');
    expect(el('workshop').textContent).not.toContain('Пробивний заряд 0'); // склад — лише після протоколу (аудит PR #516)
    party.research.completed.push('rift-anatomy');
    panel.render();
    expect(el('workshop').textContent).toContain('Пробивний заряд 0');
    expect(el<HTMLButtonElement>('btn-order-breach-charge').title).toBe('Бракує трофеїв: гончак 0 з 1');
    expect(el<HTMLButtonElement>('btn-order-breach-charge').disabled).toBe(true);
    party.research.trophies.hound = 1;
    panel.render();
    const ok = el<HTMLButtonElement>('btn-order-breach-charge');
    expect(ok.disabled).toBe(false);
    ok.click();
    expect(party.workshop.queue.map((o) => o.id)).toEqual(['breach-charge']);
    expect(party.research.trophies.hound).toBe(0);
  });
});
