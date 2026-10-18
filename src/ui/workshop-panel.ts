// П11.6 (Фаза 11, ADR-0058/0037): панель «Цех» у колонці стану геосцени.
// Тут — замовлення предметів з оплатою одразу (каталог = завершені проєкти
// науки), черга з одним активним замовленням (тики геосцени) і склад
// (лічильники готових предметів). Екіпірування — у картці солдата ростеру
// (модуль panels); гарматний модуль ставиться на винищувач (intercept) —
// поза цією панеллю. Логіка — виклики src/core/workshop (ADR-0002), DOM —
// через хелпер el (src/ui/dom.ts). Панель активна лише на геосцені
// (прецедент панелі збереження, П5.3): у бою кнопки вимкнені.
// Детермінізм: панель лише читає стан ядра, жодного RNG.

import { ITEM_IDS, WORKSHOP_CATALOG, orderItem } from '../core/workshop';
import { DIFFICULTY_MULTIPLIERS } from '../core/campaign';
import type { Party } from '../core/save';
import { itemEffect } from './effects';
import { el } from './dom';
import type { LogCat } from './journal';

// Залежності від шару застосунку (main.ts): читання стану і дії панелі.
export interface WorkshopPanelDeps {
  getParty(): Party;
  inBattle(): boolean; // тактичний бій триває — панель вимкнена
  isGameOver(): boolean; // банкрутство (ADR-0021)
  journal(text: string, cls?: string, cat?: LogCat): void;
  drainWorkshop(): void; // нові події цеху → журнал (seen-трекінг у src/ui/journal.ts)
  renderAll(): void;
}

export interface WorkshopPanel {
  render(): void;
}

export function createWorkshopPanel(deps: WorkshopPanelDeps): WorkshopPanel {
  function renderWorkshopPanel(): void {
    const party = deps.getParty();
    deps.drainWorkshop();
    const w = party.workshop;
    const box = el('workshop');
    box.innerHTML = '';
    const busy = deps.inBattle() || deps.isGameOver();
    const mult = DIFFICULTY_MULTIPLIERS[party.campaign.preset].economyMultiplier;

    // черга: одне активне замовлення (перше в черзі), решта чекає
    const active = w.queue[0];
    const queue = document.createElement('div');
    queue.className = 'meta';
    queue.style.marginBottom = '4px';
    queue.innerHTML =
      'Активне замовлення: <b>' +
      (active ? active.id + ' — ' + active.ticksLeft + ' тік(и)' : '—') +
      '</b>' +
      (w.queue.length > 1 ? ' · у черзі ще ' + (w.queue.length - 1) : '');
    box.appendChild(queue);

    // склад: лічильники готових предметів
    const store = document.createElement('div');
    store.className = 'meta';
    store.style.marginBottom = '6px';
    store.textContent = 'Склад: ' + ITEM_IDS.map((id) => id + ' ' + w.store[id]).join(' · ');
    box.appendChild(store);

    // каталог: замовлення — лише досліджені предмети (гейт завершеного
    // проєкту в orderItem; тут — підказка на кнопці, джерело правди — ядро);
    // числовий ефект ДО замовлення (П12.5, ADR-0065 — числа з констант
    // каталогів, хелпер effects.ts; «зараз → стане» — від першого солдата)
    const catalog = document.createElement('div');
    const ref = party.roster.soldiers[0];
    for (const id of ITEM_IDS) {
      const def = WORKSHOP_CATALOG[id];
      const row = document.createElement('div');
      row.className = 'ufo';
      row.style.marginBottom = '4px';
      const info = document.createElement('span');
      info.textContent = id + ' · ' + def.cost + ' · ' + def.ticks + ' тік(и)';
      row.appendChild(info);
      const effect = document.createElement('span');
      effect.className = 'meta';
      effect.textContent = ' · ' + itemEffect(id, ref);
      row.appendChild(effect);
      const order = document.createElement('button');
      order.id = 'btn-order-' + id.replace(/ /g, '-'); // id без пробілів (HTML)
      order.className = 'research'; // той самий акцент, що й у панелі «Дослідження»
      order.textContent = 'Замовити';
      const price = Math.round(def.cost * mult);
      const notResearched = !party.research.completed.includes(id);
      order.disabled = busy || notResearched || party.econ.money < price;
      order.title = notResearched
        ? 'Ще не досліджено (панель «Дослідження»)'
        : party.econ.money < price
          ? 'Недостатньо коштів (ціна ' + price + ')'
          : 'Замовити у цеху (−' + price + ', готовність через ' + def.ticks + ' тік(и))';
      order.onclick = () => {
        try {
          orderItem(party.econ, party.workshop, party.research, id, party.campaign.preset);
        } catch (e) {
          deps.journal('✗ ' + (e as Error).message, 'lose', 'base');
        }
        deps.renderAll();
      };
      row.appendChild(order);
      catalog.appendChild(row);
    }
    box.appendChild(catalog);
  }

  return { render: renderWorkshopPanel };
}
