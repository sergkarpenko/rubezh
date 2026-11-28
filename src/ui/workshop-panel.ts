// П11.6 (Фаза 11, ADR-0058/0037): панель «Кузня» у колонці стану геосцени.
// Тут — замовлення предметів з оплатою одразу (каталог = завершені протоколи
// науки), черга з одним активним замовленням (тики геосцени) і склад
// (лічильники готових предметів). Екіпірування — у картці оперативника
// ростеру (модуль panels); гарматний модуль ставиться на перехоплювач
// (intercept) — поза цією панеллю. Логіка — виклики src/core/workshop
// (ADR-0002), DOM — через хелпер el (src/ui/dom.ts). Панель активна лише на
// геосцені (прецедент панелі збереження, П5.3): у бою кнопки вимкнені.
// Детермінізм: панель лише читає стан ядра, жодного RNG.

import { forgeTicks } from '../core/base';
import { FORGE_WEAPONS } from '../core/weapons';
import {
  INTERCEPTOR_COST,
  INTERCEPTOR_TICKS,
  ITEM_IDS,
  WORKSHOP_CATALOG,
  interceptorCount,
  itemName,
  itemUnlocked,
  orderInterceptor,
  orderItem,
  orderName,
  type ItemId,
} from '../core/workshop';
import { MAX_FIGHTERS } from '../core/intercept';
import { REGION_IDS, REGION_NAMES } from '../core/regions';
import { sciencePrice } from '../core/campaign';
import { CHAMPION_TROPHY_NAME, bestLevel, missingTrophies, type TrophyCost } from '../core/research';
import { BREW_IDS, BREW_LEVEL, FAST_BREW_LEVEL, CAULDRON_DOUBLE_LEVEL, brewItem, type BrewItemId } from '../core/workshop';
import { ENEMY_KINDS, ENEMY_ORDER } from '../core/enemies';
import type { WorkshopOrder } from '../core/workshop';

// п18.5 (ADR-0157): «Пробивний заряд» (після «Анатомії Розриву») — у панелі поруч із чинними предметами
// (ITEM_IDS ядра лишається п'ятьма предметами: на нього спираються бот і скрипти вимірів).
// п20.4 (ADR-0168): і зброя «Кузні» — замовлення і склад тут, видача — у вікні спорядження
export const WORKSHOP_UI_ITEMS: readonly ItemId[] = [...ITEM_IDS, 'breach-charge', ...FORGE_WEAPONS];
import type { Party } from '../core/save';
import { itemEffect } from './effects';
import { el, setWhy } from './dom';
import type { LogCat } from './journal';
import { ticksText } from './text';

// п18.5, п22.7 (ADR-0189): ціна в трофеях — «демон 6, гончак 3», трофей «чемпіон» — останнім.
export function trophyListText(cost: TrophyCost | undefined): string {
  const parts = ENEMY_ORDER.filter((k) => (cost?.[k] ?? 0) > 0).map((k) => ENEMY_KINDS[k].name.toLowerCase() + ' ' + cost?.[k]);
  if ((cost?.champion ?? 0) > 0) parts.push(CHAMPION_TROPHY_NAME + ' ' + cost?.champion);
  return parts.join(', ');
}

// п22.7 (ADR-0189): причина, з якої рецепт зараз не зварити (порядок перевірок — як у brewItem ядра), або null.
export function brewBlockReason(party: Party, id: BrewItemId): string | null {
  const def = WORKSHOP_CATALOG[id];
  if (party.modules.cauldron < 1) return 'Немає модуля «Казан алхіміка» — купіть у «Модулях бази»';
  const level = bestLevel(party.research, 'alchemist');
  if (level === 0) return 'Немає алхіміка в штаті';
  if (level < BREW_LEVEL[id]) return '«' + def.name + '» варить алхімік рівня ' + BREW_LEVEL[id];
  const lack = missingTrophies(party.research.trophies, def.trophies);
  if (lack !== undefined) return lack;
  const price = sciencePrice(def.cost, party.campaign.preset);
  if (party.econ.money < price) return 'Недостатньо кредитів (ціна ' + price + ')';
  return null;
}

// Тики варіння з найкращим алхіміком штату (рівень 3 — удвічі менше, вгору; як brewItem).
function brewTicks(party: Party, id: BrewItemId): number {
  const t = WORKSHOP_CATALOG[id].ticks;
  return bestLevel(party.research, 'alchemist') >= FAST_BREW_LEVEL ? Math.ceil(t / 2) : t;
}

const portion = (o: WorkshopOrder): string => ((o.count ?? 1) > 1 ? ' ×' + o.count : '');

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

// T.39: спільний стан кнопки замовлення — одна умова активності і один title
// для «Кузні» (btn-order-<id>) і картки завершеного протоколу в панелі
// «Дослідження» (btn-forge-<id>); джерело правди — orderItem (ядро).
export interface OrderButtonState {
  disabled: boolean;
  title: string;
  why: string | null; // Т.43: причина неактивності (той самий текст, що title) або null
}

export function orderButtonState(party: Party, id: ItemId, busy: boolean): OrderButtonState {
  const def = WORKSHOP_CATALOG[id];
  const price = sciencePrice(def.cost, party.campaign.preset);
  const notResearched = !itemUnlocked(party.research, id);
  const lack = missingTrophies(party.research.trophies, def.trophies); // п18.5: заряд — трофей гончака
  const title = notResearched
    ? 'Ще не досліджено'
    : lack !== undefined
      ? lack
      : party.econ.money < price
        ? 'Недостатньо кредитів (ціна ' + price + ')'
        : 'Замовити в «Кузні» (−' + price + ', готовність через ' + ticksText(forgeTicks(def.ticks, party.research, party.modules)) + ')';
  const blocked = notResearched || lack !== undefined || party.econ.money < price;
  return { disabled: busy || blocked, title, why: blocked ? title : null };
}

export function createWorkshopPanel(deps: WorkshopPanelDeps): WorkshopPanel {
  function renderWorkshopPanel(): void {
    const party = deps.getParty();
    deps.drainWorkshop();
    const w = party.workshop;
    const box = el('workshop');
    box.innerHTML = '';
    const busy = deps.inBattle() || deps.isGameOver();

    // черга: одне активне замовлення (перше в черзі), решта чекає
    const active = w.queue[0];
    const queue = document.createElement('div');
    queue.className = 'meta';
    queue.style.marginBottom = '4px';
    queue.innerHTML =
      'Активне замовлення: <b>' +
      (active ? orderName(active) + ' — ' + ticksText(active.ticksLeft) : '—') +
      '</b>' +
      (w.queue.length > 1 ? ' · у черзі ще ' + (w.queue.length - 1) : '');
    box.appendChild(queue);

    // склад: лічильники готових предметів (назви — з каталогу, П12.6)
    const store = document.createElement('div');
    store.className = 'meta';
    store.style.marginBottom = '6px';
    // аудит PR #516: заряд у рядку складу — після «Анатомії Розриву» або коли він є на складі
    const shownItems = WORKSHOP_UI_ITEMS.filter((id) => id !== 'breach-charge' || itemUnlocked(party.research, id) || w.store[id] > 0);
    store.textContent = 'Склад: ' + shownItems.map((id) => itemName(id) + ' ' + w.store[id]).join(' · ');
    box.appendChild(store);

    // каталог: замовлення — лише досліджені предмети (гейт завершеного
    // протоколу в orderItem; тут — підказка на кнопці, джерело правди — ядро);
    // числовий ефект ДО замовлення (П12.5, ADR-0065 — числа з констант
    // каталогів, хелпер effects.ts; «зараз → стане» — від першого оперативника)
    const catalog = document.createElement('div');
    const ref = party.roster.soldiers[0];
    for (const id of WORKSHOP_UI_ITEMS) {
      const def = WORKSHOP_CATALOG[id];
      const row = document.createElement('div');
      row.className = 'probe';
      row.style.marginBottom = '4px';
      const info = document.createElement('span');
      const price = sciencePrice(def.cost, party.campaign.preset);
      info.textContent = def.name + ' · ' + price + ' · ' + ticksText(forgeTicks(def.ticks, party.research, party.modules));
      row.appendChild(info);
      const effect = document.createElement('span');
      effect.className = 'meta';
      effect.textContent = ' · ' + itemEffect(id, ref);
      row.appendChild(effect);
      const order = document.createElement('button');
      order.id = 'btn-order-' + id.replace(/ /g, '-'); // id без пробілів (HTML)
      order.className = 'research'; // той самий акцент, що й у панелі «Дослідження»
      order.textContent = 'Замовити';
      // T.39: та сама умова/title, що у картки протоколу (btn-forge-<id>)
      const ob = orderButtonState(party, id, busy);
      order.disabled = ob.disabled;
      order.title = ob.title;
      order.onclick = () => {
        try {
          orderItem(party.econ, party.workshop, party.research, id, party.campaign.preset, party.modules);
        } catch (e) {
          deps.journal('✗ ' + (e as Error).message, 'lose', 'base');
        }
        deps.renderAll();
      };
      // Т.80: кнопка і причина — одна рядкова група: причина не відривається від кнопки
      // залежно від шрифту машини (у CI переносилась під кнопку, локально — ні)
      const line = document.createElement('span');
      line.className = 'order-line';
      line.appendChild(order);
      row.appendChild(line);
      setWhy(order, ob.why); // Т.43
      catalog.appendChild(row);
    }
    box.appendChild(catalog);
    box.appendChild(interceptorRow(party, busy));
    box.appendChild(cauldronBlock(party, busy));
  }

  // п22.7 (ADR-0189, рішення власника «А. У чинних панелях»): «Казан алхіміка» — під замовленнями «Кузні»:
  // стан варіння і черга, склад витратників, рецепт на рядок з кнопкою «Зварити» (джерело правди — brewItem).
  function cauldronBlock(party: Party, busy: boolean): HTMLElement {
    const w = party.workshop;
    const wrap = document.createElement('div');
    wrap.id = 'cauldron';
    wrap.className = 'cauldron';
    const level = party.modules.cauldron;
    const head = document.createElement('div');
    head.className = 'meta';
    const active = w.brew[0];
    head.innerHTML =
      '<b>Казан алхіміка' +
      (level >= CAULDRON_DOUBLE_LEVEL ? ' II' : level >= 1 ? ' I' : '') +
      '</b> · ' +
      (level < 1
        ? 'модуля немає — купіть у «Модулях бази» («Дослідження»)'
        : 'варіння: <b>' +
          (active ? orderName(active) + portion(active) + ' — ' + ticksText(active.ticksLeft) : '—') +
          '</b>' +
          (w.brew.length > 1 ? ' · у черзі ще ' + (w.brew.length - 1) : ''));
    wrap.appendChild(head);
    const store = document.createElement('div');
    store.className = 'meta';
    store.textContent = 'На складі: ' + BREW_IDS.map((id) => itemName(id) + ' ' + w.store[id]).join(' · ');
    wrap.appendChild(store);
    for (const id of BREW_IDS) {
      const def = WORKSHOP_CATALOG[id];
      const row = document.createElement('div');
      row.className = 'probe';
      row.style.marginBottom = '4px';
      const info = document.createElement('span');
      info.textContent =
        def.name +
        ' · ' +
        sciencePrice(def.cost, party.campaign.preset) +
        ' кр. · трофеї: ' +
        trophyListText(def.trophies) +
        ' · ' +
        ticksText(brewTicks(party, id)) +
        ' · алхімік ' +
        BREW_LEVEL[id];
      row.appendChild(info);
      const effect = document.createElement('span');
      effect.className = 'meta';
      effect.textContent = ' · ' + itemEffect(id);
      row.appendChild(effect);
      const b = document.createElement('button');
      b.id = 'btn-brew-' + id;
      b.className = 'research';
      b.textContent = 'Зварити';
      const why = brewBlockReason(party, id);
      b.disabled = busy || why !== null;
      b.title =
        why ??
        'Зварити (−' +
          sciencePrice(def.cost, party.campaign.preset) +
          ', трофеї: ' +
          trophyListText(def.trophies) +
          ', готовність через ' +
          ticksText(brewTicks(party, id)) +
          (level >= CAULDRON_DOUBLE_LEVEL ? ', дві порції' : '') +
          ')';
      b.onclick = () => {
        try {
          brewItem(party.econ, party.workshop, party.research, party.modules, id, party.campaign.preset);
        } catch (e) {
          deps.journal('✗ ' + (e as Error).message, 'lose', 'base');
        }
        deps.renderAll();
      };
      const line = document.createElement('span');
      line.className = 'order-line';
      line.appendChild(b);
      row.appendChild(line);
      setWhy(b, why);
      wrap.appendChild(row);
    }
    return wrap;
  }

  // п19.4 (ADR-0159 п. 4, 13; ADR-0161): купівля перехоплювача — рядок «Кузні» з вибором ангара:
  // кнопка на кожен регіон (і той, що вийшов — рішення власника п19.3); разом із замовленими — до трьох.
  function interceptorRow(party: Party, busy: boolean): HTMLElement {
    const row = document.createElement('div');
    row.className = 'probe';
    row.id = 'interceptor-order';
    row.style.marginBottom = '4px';
    const price = sciencePrice(INTERCEPTOR_COST, party.campaign.preset);
    const count = interceptorCount(party.workshop, party.intercept);
    const info = document.createElement('div');
    info.innerHTML =
      'Перехоплювач · ' +
      price +
      ' · ' +
      ticksText(forgeTicks(INTERCEPTOR_TICKS, party.research, party.modules)) +
      '<span class="meta"> · є ' +
      count +
      ' з ' +
      MAX_FIGHTERS +
      ' · ангар:</span>';
    info.title = 'Перехоплювачів разом із замовленими в «Кузні» — не більше ' + MAX_FIGHTERS; // аудит PR #523
    row.appendChild(info);
    const full = count >= MAX_FIGHTERS;
    const poor = party.econ.money < price;
    const why = full
      ? 'Перехоплювачів уже ' + MAX_FIGHTERS + ' разом із замовленими'
      : poor
        ? 'Недостатньо кредитів (ціна ' + price + ')'
        : null;
    const line = document.createElement('span');
    line.className = 'order-line';
    for (const r of REGION_IDS) {
      const b = document.createElement('button');
      b.id = 'btn-order-interceptor-' + r;
      b.className = 'research';
      b.textContent = REGION_NAMES[r] + (party.campaign.regions[r].out ? ' ✗' : '');
      b.disabled = busy || why !== null;
      b.title =
        why ??
        'Замовити перехоплювач в ангар «' +
          REGION_NAMES[r] +
          '» (−' +
          price +
          ', готовність через ' +
          ticksText(forgeTicks(INTERCEPTOR_TICKS, party.research, party.modules)) +
          ')';
      b.onclick = () => {
        try {
          orderInterceptor(party.econ, party.workshop, party.intercept, r, party.campaign.preset, party.research, party.modules);
        } catch (e) {
          deps.journal('✗ ' + (e as Error).message, 'lose', 'base');
        }
        deps.renderAll();
      };
      line.appendChild(b);
    }
    row.appendChild(line);
    if (why !== null) {
      const w = document.createElement('div');
      w.className = 'btn-why'; // Т.43: причина — тим самим стилем, що під кнопками (одна на рядок)
      w.textContent = why;
      row.appendChild(w);
    }
    return row;
  }

  return { render: renderWorkshopPanel };
}
