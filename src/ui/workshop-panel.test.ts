// @vitest-environment jsdom
// П11.6 (Фаза 11, ADR-0058/0013): DOM-тести панелі «Цех»
// (src/ui/workshop-panel.ts). Патерн research-panel.test.ts: мінімальна
// розмітка index.html (#workshop) + справжнє ядро (orderItem/workshopTick) —
// панель покриває DOM-механіку: гейт дослідження, оплата, черга з одним
// активним замовленням, склад-лічильники, вимкненість у бою (критерій 1).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createParty, type Party } from '../core/save';
import { ITEM_IDS, WORKSHOP_CATALOG, workshopTick } from '../core/workshop';
import { createWorkshopPanel, type WorkshopPanelDeps } from './workshop-panel';
import { el } from './dom';

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
    expect(el('workshop').textContent).toContain(String(WORKSHOP_CATALOG['аптечка'].ticks) + ' тік(и)');
  });

  it('не досліджений предмет — кнопка вимкнена з підказкою; досліджений — активна', () => {
    const panel = createWorkshopPanel(makeDeps());
    panel.render();
    const locked = el<HTMLButtonElement>('btn-order-аптечка');
    expect(locked.disabled).toBe(true);
    expect(locked.title).toContain('Ще не досліджено');
    party.research.completed.push('аптечка');
    panel.render();
    expect(el<HTMLButtonElement>('btn-order-аптечка').disabled).toBe(false);
  });

  it('недостатньо коштів — кнопка вимкнена з ціною в підказці', () => {
    party.research.completed.push('аптечка');
    party.econ.money = 5;
    const panel = createWorkshopPanel(makeDeps());
    panel.render();
    const b = el<HTMLButtonElement>('btn-order-аптечка');
    expect(b.disabled).toBe(true);
    expect(b.title).toContain('Недостатньо коштів');
  });
});

describe('WorkshopPanel: замовлення, черга і склад', () => {
  it('замовлення — оплата одразу, активне замовлення з тиками; друге — у черзі', () => {
    party.research.completed.push('аптечка', 'легка броня');
    const deps = makeDeps();
    const panel = createWorkshopPanel(deps);
    panel.render();
    const before = party.econ.money;
    (el('btn-order-аптечка') as HTMLButtonElement).click();
    expect(party.econ.money).toBe(before - WORKSHOP_CATALOG['аптечка'].cost);
    expect(party.workshop.queue).toHaveLength(1);
    panel.render();
    expect(el('workshop').textContent).toContain('Активне замовлення: аптечка — 12 тік(и)');
    (el('btn-order-легка-броня') as HTMLButtonElement).click();
    expect(party.workshop.queue).toHaveLength(2);
    panel.render();
    expect(el('workshop').textContent).toContain('у черзі ще 1');
  });

  it('тики геосцени доводять замовлення до складу — лічильник росте (ядро workshopTick)', () => {
    party.research.completed.push('аптечка');
    const panel = createWorkshopPanel(makeDeps());
    panel.render();
    (el('btn-order-аптечка') as HTMLButtonElement).click();
    for (let i = 0; i < WORKSHOP_CATALOG['аптечка'].ticks; i++) workshopTick(party.workshop);
    expect(party.workshop.store['аптечка']).toBe(1);
    panel.render();
    expect(el('workshop').textContent).toContain('аптечка 1');
    expect(el('workshop').textContent).toContain('Активне замовлення: —'); // черга порожня
  });

  it('склад показує нульові лічильники на старті', () => {
    const panel = createWorkshopPanel(makeDeps());
    panel.render();
    const text = el('workshop').textContent!;
    for (const id of ITEM_IDS) expect(text).toContain(id + ' 0');
  });
});

describe('WorkshopPanel: критерій 1 — лише на геосцені', () => {
  it('у бою кнопки замовлення вимкнені', () => {
    party.research.completed.push('аптечка');
    const panel = createWorkshopPanel(makeDeps({ inBattle: () => true }));
    panel.render();
    expect((el('btn-order-аптечка') as HTMLButtonElement).disabled).toBe(true);
  });

  it('помилка ядра (гроші зникли поза панеллю) — у журнал, без кидка', () => {
    party.research.completed.push('аптечка');
    const deps = makeDeps();
    const panel = createWorkshopPanel(deps);
    panel.render();
    party.econ.money = 0;
    (el('btn-order-аптечка') as HTMLButtonElement).click();
    expect(deps.journal).toHaveBeenCalledWith(expect.stringContaining('Недостатньо грошей'), 'lose', 'base');
    expect(party.workshop.queue).toHaveLength(0);
  });
});
