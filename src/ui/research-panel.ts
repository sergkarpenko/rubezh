// П11.6 (Фаза 11, ADR-0058/0037): панель «Дослідження» у колонці стану
// геострени. Тут — штат вчених (найм/звільнення, зарплата), слоти лабораторії,
// каталог проєктів (старт/прогрес/завершення) і пул наукових точок. Логіка —
// виклики src/core/research (ADR-0002), DOM — через хелпер el (src/ui/dom.ts).
// Панель активна лише на геострені (прецедент панелі збереження, П5.3):
// у тактичному бою кнопки вимкнені — бій не переривається (ADR-0026).
// Вімір детермінізму: жодного RNG, все відображення стану ядра.
//
// T.39 «Зрозуміла наука» (docs/plans/t39-clear-science.md, тексти затверджені
// власником): смуга кроків «дослідити → виготовити → видати» (чиста навігація,
// кнопки смуги завжди активні, коли панель видима), шапка у три рядки, картка
// протоколу з плашкою стану, ціною «Ціна … кр.» (Т.100: рядок прибрано) і часом «Час ≈ …» простими
// словами, кнопка «Замовити в «Кузні»» на картці завершеного протоколу-предмета.
// Ядро src/core не змінюється.
//
// Т.100 (кандидат 22, варіант В власника): коротша панель — у картці «не розпочато»
// немає рядка «Ціна» (ціна є на кнопці), «Час» коротший; картка з невиконаною
// передумовою згорнута до назви з плашкою «після «…»»; у завершеній немає рядка
// ефекту. В обох назва — кнопка «▸»: тап / клік / Enter показує рядок ефекту, ще раз —
// ховає (рішення власника після аудиту: на iPad і телефоні підказку title не побачити).
// Розгорнуті картки пам'ятає панель (поза сейвом), стан гри не змінюється.

import {
  HIRE_SCIENTIST_PRICE,
  KEY_PROJECTS,
  WEAPON_PROJECTS,
  PROJECTS,
  PROJECT_CATALOG,
  SCIENTIST_SALARY,
  hireScientist,
  fireScientist,
  missingTrophies,
  projectName,
  startProject,
  type ProjectDef,
} from '../core/research';
import { WORKSHOP_CATALOG, orderItem, type ItemId } from '../core/workshop';
import { sciencePrice } from '../core/campaign';
import type { Party } from '../core/save';
import { plainProjectEffect } from './effects';
import { orderButtonState } from './workshop-panel';
import { el, setWhy } from './dom';
import { setIconText } from './icons';
import type { LogCat } from './journal';
import { daysText, ticksText } from './text';
import { portraitHtml } from './portrait';
import { ENEMY_KINDS, ENEMY_ORDER } from '../core/enemies';

// п21.4 (ADR-0178): сторона аватара техноманта в рядку штату, CSS px — рішення власника «Б. Більші»
export const STAFF_AVATAR = 32;

// п18.5 (ADR-0157): ціна ключового протоколу в трофеях — «демон 6, гончак 3» (порядок типів ядра).
export function trophyCostText(def: ProjectDef): string {
  return ENEMY_ORDER.filter((k) => (def.trophies?.[k] ?? 0) > 0)
    .map((k) => ENEMY_KINDS[k].name.toLowerCase() + ' ' + def.trophies?.[k])
    .join(', ');
}

// Залежності від шару застосунку (main.ts): читання стану і дії панелі.
// Панель не знає, як саме стан зберігається у застосунку.
export interface ResearchPanelDeps {
  getParty(): Party;
  inBattle(): boolean; // тактичний бій триває — панель вимкнена (прецедент збереження)
  isGameOver(): boolean; // банкрутство (ADR-0021)
  journal(text: string, cls?: string, cat?: LogCat): void;
  drainResearch(): void; // нові події науки -> журнал (seen-трекінг у src/ui/journal.ts)
  renderAll(): void;
  // T.39: кроки смуги — чиста навігація, стан гри не змінюється
  scrollToResearch(): void; // крок 1 — прокрутити до панелі «Дослідження»
  scrollToWorkshop(): void; // крок 2 — прокрутити до панелі «Кузня» (#workshop)
  showSquadTab(): void; // крок 3 — перемкнути вкладку на «Загін»
}

export interface ResearchPanel {
  render(): void;
}

export function createResearchPanel(deps: ResearchPanelDeps): ResearchPanel {
  // Т.100: згорнуті й завершені картки, у яких гравець розгорнув рядок ефекту
  const shown = new Set<string>();

  // Причина, чому проєкт не можна стартувати зараз (підказка на кнопці);
  // null — можна. Перевірки дублюють правила ядра лише для підказки —
  // джерело правди лишається throw'и startProject (ядро не дублюється).
  function startBlockReason(party: Party, def: ProjectDef): string | null {
    const r = party.research;
    if (r.completed.includes(def.id)) return 'завершено';
    if (r.active.some((p) => p.id === def.id)) return 'у роботі';
    // Т.100: невиконана передумова — картка згорнута без кнопки старту, причину показує плашка «після «…»»
    if (r.active.length >= r.slots) return 'немає вільного слота (' + r.active.length + '/' + r.slots + ')';
    const lack = missingTrophies(r.trophies, def.trophies); // п18.5: ключові протоколи — трофеї на вході
    if (lack !== undefined) return lack;
    const price = sciencePrice(def.cost, party.campaign.preset);
    if (party.econ.money < price) return 'недостатньо кредитів (ціна ' + price + ')';
    return null;
  }

  // T.39: плашка стану картки протоколу — перша підходяща умова згори вниз.
  function badgeFor(party: Party, def: ProjectDef): { text: string; cls: string } {
    const r = party.research;
    if (r.completed.includes(def.id)) return { text: 'завершено', cls: 'ok' };
    if (r.active.some((p) => p.id === def.id)) return { text: 'у роботі', cls: 'run' };
    if (def.prerequisite !== undefined && !r.completed.includes(def.prerequisite))
      return { text: 'після «' + projectName(def.prerequisite) + '»', cls: 'lock' };
    if (r.active.length >= r.slots) return { text: 'немає вільного слота', cls: 'lock' };
    if (missingTrophies(r.trophies, def.trophies) !== undefined) return { text: 'бракує трофеїв', cls: 'lock' }; // п18.5
    if (party.econ.money < sciencePrice(def.cost, party.campaign.preset)) return { text: 'бракує кредитів', cls: 'lock' };
    if (r.scientists.length === 0) return { text: 'потрібен техномант', cls: 'lock' };
    return { text: 'доступний', cls: '' };
  }

  // T.39: «Час ≈ …» простими словами. K — техномантів, P — очок протоколу.
  // Т.100 (варіант В): K ≥ 1 — «Час ≈ D діб» з наявним штатом; K = 0 — «Час ≈ P діб, з двома — ⌈P/2⌉»
  // (друге число без слова «діб», як у тексті Т.39).
  function timeTextNotStarted(points: number, scientists: number): string {
    if (scientists >= 1) return 'Час ≈ ' + daysText(Math.ceil(points / scientists));
    return 'Час ≈ ' + daysText(points) + ', з двома — ' + Math.ceil(points / 2);
  }

  function renderResearchPanel(): void {
    const party = deps.getParty();
    deps.drainResearch();
    const r = party.research;
    const box = el('research');
    box.innerHTML = '';
    const busy = deps.inBattle() || deps.isGameOver();
    const preset = party.campaign.preset;
    const hirePrice = sciencePrice(HIRE_SCIENTIST_PRICE, preset);
    const salary = sciencePrice(SCIENTIST_SALARY, preset);
    const scientists = r.scientists.length;

    // T.39: смуга кроків «1. Дослідити → 2. Виготовити → 3. Видати» — навігація;
    // кнопки смуги завжди активні, коли панель видима (стан гри не змінюється)
    const steps = document.createElement('div');
    steps.className = 'sci-steps';
    const stepDefs: [string, string, string, () => void][] = [
      ['btn-sci-step-1', '1. Дослідити', 'протокол тут', () => deps.scrollToResearch()],
      ['btn-sci-step-2', '2. Виготовити', 'у «Кузні»', () => deps.scrollToWorkshop()],
      ['btn-sci-step-3', '3. Видати', 'вкладка «Загін»', () => deps.showSquadTab()],
    ];
    for (let i = 0; i < stepDefs.length; i++) {
      if (i > 0) {
        const arr = document.createElement('span');
        arr.className = 'arr';
        arr.textContent = '→';
        steps.appendChild(arr);
      }
      const [id, title, sub, action] = stepDefs[i];
      const b = document.createElement('button');
      b.id = id;
      b.innerHTML = '<b>' + title + '</b>' + sub;
      b.onclick = action;
      steps.appendChild(b);
    }
    box.appendChild(steps);

    // T.39: шапка — три рядки: штат і утримання, потік, протоколи в роботі
    const head = document.createElement('div');
    head.className = 'sci-head';
    const l1 = document.createElement('div');
    l1.innerHTML = 'Техномантів: <b>' + scientists + '</b> · утримання ' + salary + ' кр. за добу';
    const l2 = document.createElement('div');
    l2.textContent = 'Кожен техномант дає 1 очко потоку за добу';
    const l3 = document.createElement('div');
    l3.innerHTML = 'Протоколів у роботі: <b>' + r.active.length + ' з ' + r.slots + '</b>';
    head.append(l1, l2, l3);
    box.appendChild(head);

    // вербування техноманта (прецедент btn-hire у панелі «Фінанси»); id без змін
    const hire = document.createElement('button');
    hire.id = 'btn-hire-scientist';
    // Т.128 (рішення власника): іконка перед підписом, ціна в дужках — як у «Вербувати оперативника (100)»
    setIconText(hire, 'tech', 'Вербувати техноманта (' + hirePrice + ')');
    hire.disabled = busy || party.econ.money < hirePrice;
    hire.title = hire.disabled
      ? 'Недостатньо кредитів (ціна вербування ' + hirePrice + ')'
      : 'Новий техномант у лабораторію техномагії (−' + hirePrice + ', утримання ' + salary + '/добу)';
    hire.onclick = () => {
      try {
        hireScientist(party.econ, party.research, party.campaign.preset);
      } catch (e) {
        deps.journal('✗ ' + (e as Error).message, 'lose', 'base');
      }
      deps.renderAll();
    };
    box.appendChild(hire);
    setWhy(hire, party.econ.money < hirePrice ? hire.title : null); // Т.43

    // штат вчених — по рядку на вченого з кнопкою звільнення
    if (r.scientists.length > 0) {
      const staff = document.createElement('div');
      staff.className = 'staff';
      staff.style.margin = '6px 0';
      for (const s of r.scientists) {
        const row = document.createElement('div');
        row.className = 'soldier';
        row.style.marginBottom = '2px';
        const name = document.createElement('span');
        name.style.minWidth = '64px';
        name.textContent = s.name;
        // п21.4 (ADR-0178): мальований бюст техноманта перед іменем; шолом кодом — запасний
        row.insertAdjacentHTML('beforeend', portraitHtml(s.id, STAFF_AVATAR));
        const fire = document.createElement('button');
        fire.id = 'btn-fire-' + s.id;
        fire.textContent = 'Звільнити';
        fire.disabled = busy;
        fire.title = 'Звільнити без повернення кредитів (утримання більше не нараховується)';
        fire.onclick = () => {
          try {
            fireScientist(party.research, s.id);
          } catch (e) {
            deps.journal('✗ ' + (e as Error).message, 'lose', 'base');
          }
          deps.renderAll();
        };
        row.append(name, fire);
        staff.appendChild(row);
      }
      box.appendChild(staff);
    }

    // T.39: картка протоколу: рядок 1 — назва + плашка стану; рядок 2 — ефект
    // простими словами; далі — за станом (ціна/час/кнопка, смуга прогресу,
    // «Замовити в «Кузні»»). Назви — з каталогу (П12.6, ADR-0064).
    const catalog = document.createElement('div');
    const ref = party.roster.soldiers[0];
    // п18.5 (ADR-0157): після звичайних — три ключові протоколи ланцюжка до Брами Розриву (до п18.5 сховано)
    // п20.4 (ADR-0168): за ними — протоколи зброї (свій на кожну, виріб у «Кузні»)
    const all = [...PROJECTS, ...KEY_PROJECTS, ...WEAPON_PROJECTS];
    for (let i = 0; i < all.length; i++) {
      const def = all[i];
      if (i === PROJECTS.length) {
        const sep = document.createElement('div');
        sep.className = 'sci-row sci-key-head';
        sep.innerHTML = '<b>Ключові протоколи</b> — шлях до Брами Розриву, потрібні трофеї';
        catalog.appendChild(sep);
      }
      if (i === PROJECTS.length + KEY_PROJECTS.length) {
        const sep = document.createElement('div');
        sep.className = 'sci-row sci-key-head';
        sep.innerHTML = '<b>Зброя</b> — виріб у «Кузні», видача — у вікні спорядження перед вильотом';
        catalog.appendChild(sep);
      }
      const active = r.active.find((p) => p.id === def.id);
      const done = r.completed.includes(def.id);
      const card = document.createElement('div');
      card.className = 'sci-card';
      const top = document.createElement('div');
      top.className = 'sci-top';
      const name = document.createElement('span');
      name.className = 'sci-name';
      name.textContent = def.name;
      const badge = badgeFor(party, def);
      const bs = document.createElement('span');
      bs.className = 'sci-badge' + (badge.cls === '' ? '' : ' ' + badge.cls);
      bs.textContent = badge.text;
      top.append(name, bs);
      card.appendChild(top);
      const effText = plainProjectEffect(def.id, ref);
      // Т.100: невиконана передумова — картка згорнута до назви з плашкою «після «…»»
      // (ціна і кнопка з'являться, коли передумову завершено)
      // п18.5 (ADR-0157): ключовий протокол без трофеїв — так само згорнутий (плашка «бракує трофеїв»);
      // у рядку ефекту за кнопкою-назвою — і ціна в трофеях
      const lacksTrophies = def.trophies !== undefined && missingTrophies(r.trophies, def.trophies) !== undefined;
      const folded = !done && !active && ((def.prerequisite !== undefined && !r.completed.includes(def.prerequisite)) || lacksTrophies);
      const eff = document.createElement('div');
      eff.className = 'sci-eff';
      eff.textContent = folded && def.trophies !== undefined ? effText + ' · трофеї: ' + trophyCostText(def) : effText;
      if (folded || done) {
        // Т.100: рядок ефекту — за кнопкою-назвою; працює й у бою (лише вигляд панелі)
        const open = shown.has(def.id);
        const toggle = document.createElement('button');
        toggle.id = 'btn-sci-eff-' + def.id;
        toggle.className = 'sci-name sci-toggle';
        toggle.textContent = (open ? '▾\u00a0' : '▸\u00a0') + def.name; // нерозривний пробіл: стрілка не лишається сама в рядку
        toggle.setAttribute('aria-expanded', String(open));
        toggle.onclick = () => {
          if (shown.has(def.id)) shown.delete(def.id);
          else shown.add(def.id);
          renderResearchPanel();
          document.getElementById(toggle.id)?.focus();
        };
        name.replaceWith(toggle);
        card.title = effText; // для миші — і підказкою
        if (open) card.appendChild(eff);
        if (folded) {
          card.classList.add('folded');
          catalog.appendChild(card);
          continue;
        }
      } else {
        card.appendChild(eff);
      }

      if (done) {
        // T.39: завершений протокол-предмет (усі, крім «Розширення лабораторії»):
        // кнопка «Замовити в «Кузні»» — та сама умова активності і той самий title,
        // що й btn-order-<id> у «Кузні» (orderItem, спільний хелпер workshop-panel)
        if (Object.prototype.hasOwnProperty.call(WORKSHOP_CATALOG, def.id)) {
          // п18.5: «Розширення лабораторії» і ключові протоколи предмета не дають — лише плашка
          const itemId = def.id as ItemId;
          const price = sciencePrice(WORKSHOP_CATALOG[itemId].cost, preset);
          const forge = document.createElement('button');
          forge.id = 'btn-forge-' + itemId;
          forge.className = 'research wide';
          forge.textContent = 'Замовити в «Кузні» — ' + price + ' кр.';
          const st = orderButtonState(party, itemId, busy);
          forge.disabled = st.disabled;
          forge.title = st.title;
          forge.onclick = () => {
            try {
              orderItem(party.econ, party.workshop, party.research, itemId, preset);
            } catch (e) {
              deps.journal('✗ ' + (e as Error).message, 'lose', 'base');
            }
            deps.renderAll();
          };
          card.appendChild(forge);
          setWhy(forge, st.why); // Т.43
          // під кнопкою — що з предметом зараз: в «Кузні» і/або на складі
          // (гарматний модуль — Т.78: встановлюється в панелі «Перехоплювач»)
          const notes: string[] = [];
          const q = party.workshop.queue.find((o) => o.id === itemId);
          if (q) notes.push('У «Кузні»: виготовляється, ще ' + ticksText(q.ticksLeft));
          const onStore = party.workshop.store[itemId];
          if (onStore > 0) {
            // Т.78 (аудит): модуль уже на перехоплювачі — другий не встановити, підказки на дію немає
            const hint =
              itemId !== 'gun-module'
                ? ' — видайте на вкладці «Загін»'
                : party.intercept.fighters.every((f) => f.gunModule === true)
                  ? ''
                  : ' — встановіть у панелі «Перехоплювачі»'; // п19.4: панель середньої колонки
            notes.push('На складі: ' + onStore + hint);
          }
          for (const n of notes) {
            const note = document.createElement('div');
            note.className = 'sci-row';
            note.textContent = n;
            card.appendChild(note);
          }
        }
        // «Розширення лабораторії»: лише плашка
      } else if (active) {
        // у роботі: смуга прогресу (invested/points) і рядок «X з P очок потоку · ще ≈ D»
        const points = PROJECT_CATALOG[def.id].points;
        const bar = document.createElement('div');
        bar.className = 'sci-bar';
        const fill = document.createElement('i');
        fill.style.width = Math.min(100, (active.invested / points) * 100) + '%';
        bar.appendChild(fill);
        card.appendChild(bar);
        const row = document.createElement('div');
        row.className = 'sci-row';
        if (scientists === 0) {
          row.innerHTML = '<b>' + active.invested + ' з ' + points + '</b> очок потоку · зупинено: немає техномантів';
        } else {
          // D = ⌈(P − X) · A / K⌉ діб, A — протоколів у роботі
          const d = Math.ceil(((points - active.invested) * r.active.length) / scientists);
          row.innerHTML = '<b>' + active.invested + ' з ' + points + '</b> очок потоку · ще ≈ ' + daysText(d);
        }
        card.appendChild(row);
      } else {
        // не розпочато: «Час ≈ …», кнопка на всю ширину з ціною (Т.100: окремого рядка «Ціна» немає);
        // активна тільки коли reason null (ті самі правила, що в ядрі startProject)
        const price = sciencePrice(def.cost, preset);
        const tRow = document.createElement('div');
        tRow.className = 'sci-row';
        tRow.textContent = timeTextNotStarted(def.points, scientists);
        card.append(tRow);
        if (def.trophies !== undefined) {
          // п18.5: трофеї на вході — «Трофеї: демон 6, гончак 3» (списуються разом із кредитами)
          const trRow = document.createElement('div');
          trRow.className = 'sci-row';
          trRow.textContent = 'Трофеї: ' + trophyCostText(def);
          card.append(trRow);
        }
        const start = document.createElement('button');
        start.id = 'btn-start-' + i;
        start.className = 'research wide'; // не 'mission': той клас — семантика запуску місії
        start.textContent = 'Дослідити — ' + price + ' кр.';
        const reason = startBlockReason(party, def);
        start.disabled = busy || reason !== null;
        start.title = reason ?? 'Почати протокол (−' + price + ')';
        start.onclick = () => {
          try {
            startProject(party.econ, party.research, def.id, party.campaign.preset);
          } catch (e) {
            deps.journal('✗ ' + (e as Error).message, 'lose', 'base');
          }
          deps.renderAll();
        };
        card.appendChild(start);
        setWhy(start, reason); // Т.43: reason — той самий рядок, що в title
      }
      catalog.appendChild(card);
    }
    box.appendChild(catalog);
  }

  return { render: renderResearchPanel };
}
