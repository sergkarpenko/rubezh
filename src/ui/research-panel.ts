// П11.6 (Фаза 11, ADR-0058/0037): панель «Дослідження» у колонці стану
// геосцени. Тут — штат вчених (найм/звільнення, зарплата), слоти лабораторії,
// каталог проєктів (старт/прогрес/завершення) і пул наукових точок. Логіка —
// виклики src/core/research (ADR-0002), DOM — через хелпер el (src/ui/dom.ts).
// Панель активна лише на геосцені (прецедент панелі збереження, П5.3):
// у тактичному бою кнопки вимкнені — бій не переривається (ADR-0026).
// Візьмеш детермінізм: жодного RNG, усе відображення стану ядра.

import {
  HIRE_SCIENTIST_PRICE,
  PROJECTS,
  PROJECT_CATALOG,
  SCIENTIST_SALARY,
  hireScientist,
  fireScientist,
  startProject,
  type ProjectDef,
} from '../core/research';
import { DIFFICULTY_MULTIPLIERS } from '../core/campaign';
import type { Party } from '../core/save';
import { el } from './dom';
import type { LogCat } from './journal';

// Залежності від шару застосунку (main.ts): читання стану і дії панелі.
// Панель не знає, як саме стан зберігається у застосунку.
export interface ResearchPanelDeps {
  getParty(): Party;
  inBattle(): boolean; // тактичний бій триває — панель вимкнена (прецедент збереження)
  isGameOver(): boolean; // банкрутство (ADR-0021)
  journal(text: string, cls?: string, cat?: LogCat): void;
  drainResearch(): void; // нові події науки → журнал (seen-трекінг у src/ui/journal.ts)
  renderAll(): void;
}

export interface ResearchPanel {
  render(): void;
}

export function createResearchPanel(deps: ResearchPanelDeps): ResearchPanel {
  // Причина, чому проєкт не можна стартувати зараз (підказка на кнопці);
  // null — можна. Перевірки дублюють правила ядра лише для підказки —
  // джерело правди лишаються throw'и startProject (ядро не дублюється).
  function startBlockReason(party: Party, def: ProjectDef): string | null {
    const r = party.research;
    if (r.completed.includes(def.id)) return 'завершено';
    if (r.active.some((p) => p.id === def.id)) return 'у роботі';
    if (def.prerequisite !== undefined && !r.completed.includes(def.prerequisite)) return 'спершу: ' + def.prerequisite;
    if (r.active.length >= r.slots) return 'нема вільного слота (' + r.active.length + '/' + r.slots + ')';
    const price = Math.round(def.cost * DIFFICULTY_MULTIPLIERS[party.campaign.preset].economyMultiplier);
    if (party.econ.money < price) return 'недостатньо коштів (ціна ' + price + ')';
    return null;
  }

  function renderResearchPanel(): void {
    const party = deps.getParty();
    deps.drainResearch();
    const r = party.research;
    const box = el('research');
    box.innerHTML = '';
    const busy = deps.inBattle() || deps.isGameOver();
    const mult = DIFFICULTY_MULTIPLIERS[party.campaign.preset].economyMultiplier;
    const hirePrice = Math.round(HIRE_SCIENTIST_PRICE * mult);
    const salary = Math.round(SCIENTIST_SALARY * mult);

    // шапка: штат, зарплата, слоти лабораторії, спільний пул точок
    const head = document.createElement('div');
    head.className = 'meta';
    head.style.marginBottom = '4px';
    head.innerHTML =
      'Вчених: <b>' +
      r.scientists.length +
      '</b> (зарплата ' +
      salary +
      '/добу) · слоти ' +
      r.active.length +
      '/' +
      r.slots +
      ' · пул: <b>' +
      r.pool +
      '</b> точок';
    box.appendChild(head);

    // найм вченого (прецедент btn-hire у панелі «Фінанси»)
    const hire = document.createElement('button');
    hire.id = 'btn-hire-scientist';
    hire.textContent = 'Найм вченого (' + hirePrice + ')';
    hire.disabled = busy || party.econ.money < hirePrice;
    hire.title = hire.disabled
      ? 'Недостатньо грошей (ціна найму ' + hirePrice + ')'
      : 'Новий вчений у лабораторію (−' + hirePrice + ', зарплата ' + salary + '/добу)';
    hire.onclick = () => {
      try {
        hireScientist(party.econ, party.research, party.campaign.preset);
      } catch (e) {
        deps.journal('✗ ' + (e as Error).message, 'lose', 'base');
      }
      deps.renderAll();
    };
    box.appendChild(hire);

    // штат вчених — по рядку на вченого з кнопкою звільнення
    if (r.scientists.length > 0) {
      const staff = document.createElement('div');
      staff.style.margin = '6px 0';
      for (const s of r.scientists) {
        const row = document.createElement('div');
        row.className = 'soldier';
        row.style.marginBottom = '2px';
        const name = document.createElement('span');
        name.style.minWidth = '64px';
        name.textContent = s.name;
        const fire = document.createElement('button');
        fire.id = 'btn-fire-' + s.id;
        fire.textContent = 'Звільнити';
        fire.disabled = busy;
        fire.title = 'Звільнити без повернення коштів (зарплата більше не нараховується)';
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

    // каталог проєктів: статус кожного + кнопка старту з підказкою причини
    const catalog = document.createElement('div');
    for (let i = 0; i < PROJECTS.length; i++) {
      const def = PROJECTS[i];
      const active = r.active.find((p) => p.id === def.id);
      const done = r.completed.includes(def.id);
      const row = document.createElement('div');
      row.className = 'ufo';
      row.style.marginBottom = '4px';
      const info = document.createElement('span');
      info.textContent =
        def.id + ' · ' + def.cost + ' · ' + def.points + ' точок' + (def.prerequisite ? ' · після «' + def.prerequisite + '»' : '');
      row.appendChild(info);
      const status = document.createElement('span');
      status.className = 'meta';
      if (done) {
        status.textContent = '✓ завершено';
        row.appendChild(status);
      } else if (active) {
        status.textContent = 'у роботі: ' + active.invested + '/' + PROJECT_CATALOG[def.id].points;
        row.appendChild(status);
      } else {
        const start = document.createElement('button');
        start.id = 'btn-start-' + i;
        start.className = 'research'; // не 'mission': той клас — семантика запуску місії
        start.textContent = 'Старт';
        const reason = startBlockReason(party, def);
        start.disabled = busy || reason !== null;
        start.title = reason ?? 'Почати дослідження (−' + def.cost + ')';
        start.onclick = () => {
          try {
            startProject(party.econ, party.research, def.id, party.campaign.preset);
          } catch (e) {
            deps.journal('✗ ' + (e as Error).message, 'lose', 'base');
          }
          deps.renderAll();
        };
        row.appendChild(start);
      }
      catalog.appendChild(row);
    }
    box.appendChild(catalog);
  }

  return { render: renderResearchPanel };
}
