// П13.2 (ADR-0066): вертикальний тулбар бойових дій збоку — замість нижньої
// смуги кнопок (#bcontrols вилучено з index.html). Модуль шару відображення
// (ADR-0037): будує плитки у #btoolbar з векторними іконками (Т.123, ADR-0114;
// до того — піксель-матриці 12 × 12) і диспетчеризує кліки у дії бою (main.ts).
// Стан плиток (disabled, причини, .armed) оновлює renderBattle (src/ui/battle.ts)
// за стабільними id (контракт DOM-тестів, урок П11.6). Стиль — style-references
// («П13.2»): темно-сірі плитки, неонові акценти #00E5FF/#FF2E88, білі силуети.

import {
  EVAC_AP_COST,
  GRENADE_AP_COST,
  GRENADE_DAMAGE,
  GRENADE_RANGE,
  HEAL_AP_COST,
  HEAL_AMOUNT,
  OVERWATCH_AP_COST,
  RIFLE,
  type Weapon,
} from '../core/combat';
import { createIcon, type IconName } from './icons';

// Ідентифікатори дій тулбара — чинні дії бою (src/ui/battle.ts + input/
// auto-battle); «Авто»/«Стоп» — перемикач авто-бою (П13.3, ADR-0067).
// Т.71 (ADR-0075): «Евакуація» — між гранатою і кінцем ходу.
// п16.4 (ADR-0147, рішення власника «А»): «Роль» — одна плитка дії ролі між гранатою і евакуацією;
// підпис, іконку і ціну за роллю вибраного бійця ставить renderBattle (src/ui/roles.ts).
export type ToolbarActionId = 'snap' | 'aimed' | 'auto' | 'ow' | 'medkit' | 'grenade' | 'role' | 'evac' | 'end' | 'auto-battle';

export interface ToolbarAction {
  id: ToolbarActionId;
  btnId: string; // стабільний id плитки — той самий, що був у нижній смузі (контракт тестів)
  label: string; // короткий підпис на плитці
  hint: string; // базовий тултіп (AP/клавіша) — причину блокування дописує battle.ts (П6.14)
  icon: IconName; // векторна іконка (Т.123, ADR-0114) — src/ui/icons.ts
}

// П12.5 (ADR-0065): підказки режимів пострілу — числа ТІЛЬКИ з констант
// RIFLE (combat.ts, одне місце правди): AP, множник точності, кількість куль.
// п20.4 (аудит PR #531): числа — зброї вибраного бійця (battle.ts); без вибору — «Гарт».
export function fireModeHint(mode: 'snap' | 'aimed' | 'auto', key: string, w: Weapon = RIFLE): string {
  const m = w.modes[mode];
  // п20.5 (кандидат 205 д; рішення власника «Так, кома»): множник з комою, як у «Дослідженні» й меню
  return (
    m.apCost +
    ' AP · ×' +
    String(m.accuracyMod).replace('.', ',') +
    ' · ' +
    m.shots +
    (m.shots === 1 ? ' куля' : ' кулі') +
    ' · клавіша ' +
    key
  );
}

// Перелік дій — за чинними діями бою (src/ui/battle.ts): режими пострілу,
// дозор, витратники (П11.6, ADR-0058), кінець ходу, авто-бій (П13.3, ADR-0067
// — підпис «Авто» міняється на «Стоп» у renderBattle за станом драйвера).
// П12.5 (ADR-0065): усі числа механіки — з констант каталогів (combat.ts),
// текст не дублює числа руками.
export const TOOLBAR_ACTIONS: readonly ToolbarAction[] = [
  { id: 'snap', btnId: 'btn-snap', label: 'Швидкий', hint: fireModeHint('snap', '1'), icon: 'snap' },
  { id: 'aimed', btnId: 'btn-aimed', label: 'Прицільний', hint: fireModeHint('aimed', '2'), icon: 'aimed' },
  { id: 'auto', btnId: 'btn-auto', label: 'Черга', hint: fireModeHint('auto', '3'), icon: 'auto' },
  {
    id: 'ow',
    btnId: 'btn-ow',
    label: 'Дозор',
    hint: OVERWATCH_AP_COST + ' AP · реакційний вогонь у хід демонів Розриву · клавіша O',
    icon: 'ow',
  },
  {
    id: 'medkit',
    btnId: 'btn-medkit',
    label: 'Лікування',
    hint: HEAL_AP_COST + ' AP · +' + HEAL_AMOUNT + ' HP пораненому союзнику поруч (≤1) · клавіша M',
    icon: 'medkit',
  },
  {
    id: 'grenade',
    btnId: 'btn-grenade',
    label: 'Граната',
    hint:
      GRENADE_AP_COST +
      ' AP · пошкодження ' +
      GRENADE_DAMAGE[0] +
      '–' +
      GRENADE_DAMAGE[1] +
      ', зона епіцентр + хрест (≤' +
      GRENADE_RANGE +
      '), уражає і своїх · клавіша G',
    icon: 'grenade',
  },
  { id: 'role', btnId: 'btn-role', label: 'Роль', hint: 'Дія ролі — раз за бій · клавіша R', icon: 'dash' },
  {
    id: 'evac',
    btnId: 'btn-evac',
    label: 'Евакуація',
    // Т.91 (рішення власника 21.11.2026, кандидат 100): премії немає лише коли евакуйовано всіх, хто лишився на полі —
    // часткова евакуація з перемогою решти премію дає (missionOutcome, ADR-0075)
    hint:
      EVAC_AP_COST +
      ' AP · оперативник на синій клітинці висадки покидає бій; якщо евакуювати всіх, хто лишився на полі, премії за місію немає · клавіша V',
    icon: 'evac',
  },
  { id: 'end', btnId: 'btn-end', label: 'Кінець', hint: 'клавіша E', icon: 'end' },
  {
    id: 'auto-battle',
    btnId: 'btn-auto-battle',
    label: 'Авто',
    hint: 'Авто-бій: політика ядра веде загін; «Стоп» — продовжити вручну',
    icon: 'auto-battle',
  },
];

// Т.33: клавіша і ціна в AP — у кутках плитки (висота плитки без змін); ціни — з констант ядра.
export const TILE_KEY: Partial<Record<ToolbarActionId, string>> = {
  snap: '1',
  aimed: '2',
  auto: '3',
  ow: 'O',
  medkit: 'M',
  grenade: 'G',
  role: 'R',
  evac: 'V',
  end: 'E',
};
const ITEM_AP: Partial<Record<ToolbarActionId, number>> = {
  ow: OVERWATCH_AP_COST,
  medkit: HEAL_AP_COST,
  grenade: GRENADE_AP_COST,
  evac: EVAC_AP_COST,
};

export interface ToolbarDeps {
  onAction(id: ToolbarActionId): void;
}

// Створити тулбар у контейнері: плитки будуються один раз (розмітка статична,
// стан оновлює battle.ts за id). Клік плитки → onAction з id дії.
export function createToolbar(root: HTMLElement, deps: ToolbarDeps): void {
  for (const a of TOOLBAR_ACTIONS) {
    const b = document.createElement('button');
    b.id = a.btnId;
    b.type = 'button';
    b.dataset.action = a.id;
    b.title = a.hint;
    b.setAttribute('aria-label', a.label);
    const icon = createIcon(a.icon, 'tb-icon');
    icon.dataset.icon = a.icon; // п16.4: плитка «Роль» міняє іконку за роллю — renderBattle звіряє з цим
    const cap = document.createElement('span');
    cap.className = 'tb-cap';
    cap.textContent = a.label;
    b.append(icon, cap);
    const ap = a.id === 'snap' || a.id === 'aimed' || a.id === 'auto' ? RIFLE.modes[a.id].apCost : ITEM_AP[a.id];
    // п16.4: ціну плитки ролі ставить renderBattle за роллю вибраного — тут порожній куток
    const apText = a.id === 'role' ? '' : ap === undefined ? undefined : ap + ' AP';
    for (const [cls, text] of [['tb-ap', apText] as const, ['tb-key', TILE_KEY[a.id]] as const]) {
      if (text === undefined) continue;
      const c = document.createElement('span');
      c.className = cls;
      c.textContent = text;
      b.append(c);
    }
    b.onclick = () => deps.onAction(a.id);
    root.appendChild(b);
  }
}
