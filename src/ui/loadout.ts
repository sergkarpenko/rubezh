// п20.4 (ADR-0165 п. 7, EARS 7; ADR-0168): вікно «Спорядження перед вильотом» — між «Запустити місію»
// (і «Атакувати Браму Розриву») та боєм. Картка на бійця загону: зброя — «Гарт» і наявна на складі
// «Кузні», предмети — «+ видати» / «− зняти»; «Висадити загін» запускає бій, «Скасувати» і Esc
// закривають вікно без бою (рішення власника п20.4 «А. Як запропоновано»). Штурм бази вікна не має.
// Без графіки (іконки зброї — п20.5). Дані ядра → HTML; DOM чіпає лише контролер нижче.
import type { Unit } from '../core/combat';
import { missionSquad } from '../core/squad';
import { squadSize } from '../core/research';
import { equipItem, equipWeapon, itemName, unequipItem, type ItemSlot, type SoldierEquipment, type SoldierItemId } from '../core/workshop';
import { FORGE_WEAPONS, WEAPONS, type WeaponId } from '../core/weapons';
import type { Party } from '../core/save';
import { weaponEffect } from './effects';
import { EQUIP_ITEMS } from './panels';
import { weaponIconHtml } from './weapon-icon';

const esc = (t: string): string => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

// Зброя на вибір бійцеві: «Гарт» завжди, зброя з «Кузні» — що вже при ньому або є на складі.
export function weaponChoices(party: Party, soldier: Unit): WeaponId[] {
  const held = party.workshop.equipped[soldier.id]?.weapon;
  return ['rifle', ...FORGE_WEAPONS.filter((id) => id === held || party.workshop.store[id] > 0)];
}

function button(id: string, text: string, title: string, extra = '', icon = ''): string {
  return '<button type="button" id="' + id + '" title="' + esc(title) + '"' + extra + '>' + icon + esc(text) + '</button>';
}

// п22.7 (ADR-0189, рішення власника «А. Плитка «Стимул»»): витратники казана — лише у вікні перед вильотом
// (картка ростера їх не показує — висота картки без змін). Еліксир уже містить стимулятор і щит.
export const BREW_EQUIP: [SoldierItemId, ItemSlot, string][] = [
  ['stim', 'stim', 'стимулятор'],
  ['shield', 'shield', 'щит'],
  ['elixir', 'elixir', 'еліксир'],
];
const LOADOUT_ITEMS = [...EQUIP_ITEMS, ...BREW_EQUIP];

// Видати зараз не можна: еліксир разом зі стимулятором чи щитом (equipItem ядра — той самий throw).
function clashes(eq: SoldierEquipment | undefined, slot: keyof SoldierEquipment): boolean {
  return (
    (slot === 'elixir' && (eq?.stim === true || eq?.shield === true)) || ((slot === 'stim' || slot === 'shield') && eq?.elixir === true)
  );
}

// п20.5: ширина іконки зброї на кнопці вікна, CSS px (48 × 16)
export const LOADOUT_WEAPON_W = 48;

// Вміст вікна для загону squad (ті самі бійці, що підуть у бій, — missionSquad).
export function loadoutHtml(party: Party, squad: readonly Unit[]): string {
  const cards = squad.map((s) => {
    const eq = party.workshop.equipped[s.id];
    const held: WeaponId = eq?.weapon ?? 'rifle';
    const career = party.roster.careers[s.id];
    const weapons = weaponChoices(party, s)
      .map((w) => {
        const store = w === 'rifle' || w === held ? '' : ' · на складі ' + party.workshop.store[w];
        return button(
          'btn-lo-w-' + s.id + '-' + w,
          WEAPONS[w].name,
          weaponEffect(w) + store,
          ' class="lo-weapon" aria-pressed="' + (w === held) + '"',
          weaponIconHtml(w, LOADOUT_WEAPON_W, 'wpn-icon', true) // п20.5: іконка зброї перед назвою (ADR-0169)
        );
      })
      .join('');
    const items = LOADOUT_ITEMS.flatMap(([item, slot, short]) => {
      if (eq?.[slot] === true) return [button('btn-lo-i-' + s.id + '-' + item, '− зняти: ' + short, itemName(item) + ' → склад')];
      if (party.workshop.store[item] > 0 && !clashes(eq, slot))
        return [
          button('btn-lo-i-' + s.id + '-' + item, '+ видати: ' + short, itemName(item) + ' · на складі ' + party.workshop.store[item]),
        ];
      return [];
    });
    return (
      '<div class="lo-card" data-unit="' +
      s.id +
      '"><div class="lo-head"><b>' +
      esc(s.name) +
      '</b>' +
      (career ? ' <span class="meta">«' + esc(career.callsign) + '»</span>' : '') +
      ' <span class="meta">HP ' +
      s.hp +
      '/' +
      s.maxHp +
      '</span></div><div class="lo-row"><span class="meta">Зброя:</span> ' +
      weapons +
      '</div><div class="lo-row"><span class="meta">Предмети:</span> ' +
      (items.length > 0 ? items.join('') : '<span class="meta">на складі нічого</span>') +
      '</div></div>'
    );
  });
  return (
    '<div class="panel screen-dialog"><h2 id="loadout-title" tabindex="-1">Спорядження перед вильотом</h2>' +
    cards.join('') +
    '<div class="lo-actions">' +
    button('btn-deploy', 'Висадити загін', 'Почати бій цим загоном') +
    button('btn-deploy-cancel', 'Скасувати', 'Закрити вікно без бою · Esc') +
    '</div></div>'
  );
}

export interface LoadoutDeps {
  box: HTMLElement; // #loadout-dialog
  getParty(): Party;
  journal(text: string, cls: string): void;
  renderAll(): void; // панелі (склад, ростер) після видачі
  closed(): void; // вікно закрито без бою — фокус назад
}

export interface Loadout {
  open(go: () => void): void; // відкрити перед боєм; «Висадити загін» — go()
  close(): void;
}

export function createLoadout(deps: LoadoutDeps): Loadout {
  let go: (() => void) | null = null;

  function act(f: () => void): void {
    try {
      f();
    } catch (e) {
      deps.journal('✗ ' + (e as Error).message, 'lose');
    }
    const focused = document.activeElement?.id;
    deps.renderAll();
    render();
    if (focused) document.getElementById(focused)?.focus();
  }

  function render(): void {
    if (go === null) return;
    const party = deps.getParty();
    let squad: Unit[];
    try {
      squad = missionSquad(party.roster, squadSize(party.research)); // п22.4: ті самі, що підуть у бій
    } catch (e) {
      deps.journal('✗ ' + (e as Error).message, 'lose');
      close();
      return;
    }
    deps.box.innerHTML = loadoutHtml(party, squad);
    for (const s of squad) {
      for (const w of weaponChoices(party, s)) {
        const b = document.getElementById('btn-lo-w-' + s.id + '-' + w) as HTMLButtonElement;
        b.onclick = () => {
          if ((party.workshop.equipped[s.id]?.weapon ?? 'rifle') !== w) act(() => equipWeapon(party.workshop, s, w));
        };
      }
      for (const [item, slot] of LOADOUT_ITEMS) {
        const b = document.getElementById('btn-lo-i-' + s.id + '-' + item) as HTMLButtonElement | null;
        if (b === null) continue;
        b.onclick = () => act(() => (party.workshop.equipped[s.id]?.[slot] === true ? unequipItem : equipItem)(party.workshop, s, item));
      }
    }
    (document.getElementById('btn-deploy') as HTMLButtonElement).onclick = () => {
      const run = go;
      close();
      run?.();
    };
    (document.getElementById('btn-deploy-cancel') as HTMLButtonElement).onclick = () => {
      close();
      deps.closed();
    };
  }

  function open(next: () => void): void {
    go = next;
    deps.box.classList.remove('hidden');
    render();
    if (go !== null) deps.box.querySelector<HTMLElement>('#loadout-title')?.focus();
  }

  function close(): void {
    go = null;
    deps.box.classList.add('hidden');
    deps.box.innerHTML = '';
  }

  return { open, close };
}
