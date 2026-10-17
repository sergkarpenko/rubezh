// пR.2 (ADR-0037): журнал подій (ADR-0027: єдиний журнал з категоріями і
// фільтрами-вкладками) — винесено з main.ts без зміни поведінки. Тут —
// текстові перетворювачі подій ядра (geo/economy/combat → рядки журналу;
// П7: чисті функції для юніт-тестів), DOM-механіка журналу (записи,
// кеп 80, фільтри) і seen-трекінг прочитаних подів (drain*). Стан
// застосунку (party/mission) модуль знає лише через Deps-інтерфейс.

import type { GeoEvent } from '../core/geo';
import { missionTargets } from '../core/geo';
import { FIGHTER_MAX_HP, FIGHTER_REPAIR_COST } from '../core/intercept';
import type { EconomyEvent } from '../core/economy';
// П11.6 (ADR-0058): події науки і цеху → журнал (категорія «База»).
import type { ResearchEvent } from '../core/research';
import type { GameEvent, ShotMode } from '../core/combat';
import { claimHint, type Party } from '../core/save';
import { el } from './dom';

// Підписи режимів пострілу (спільні для журналу і панелі керування боєм).
export const MODE_LABEL: Record<ShotMode, string> = { snap: 'швидкий', aimed: 'прицільний', auto: 'черга' };

// ADR-0027: категорії записів єдиного журналу (фільтри-вкладки).
// П11.6 (ADR-0058): «База» — події науки (а з П11.6-серії — і цеху).
export type LogCat = 'geo' | 'econ' | 'battle' | 'base';
export type LogFilter = 'all' | LogCat;

// Залежності від шару застосунку (main.ts): джерела подій і назви юнітів.
export interface JournalDeps {
  geoLog(): readonly GeoEvent[]; // події геосцени (туман: knownDetected веде журнал)
  econLog(): readonly EconomyEvent[]; // події економіки
  battleLog(): readonly GameEvent[] | null; // події бою; null — бою нема
  researchLog(): readonly ResearchEvent[]; // П11.6: події науки (ADR-0058)
  unitName(id: string): string; // назва юніта бою для тексту пострілів
  onGeoEvent(e: GeoEvent): void; // П7.5 (ADR-0032): анімації перехоплення з geo-подій
  party(): Party; // П9.2: прапорці підказок живуть у Party (сейв-сумісні, ADR-0026)
}

export interface Journal {
  add(text: string, cls?: string, cat?: LogCat): void; // запис у журнал
  setFilter(f: LogFilter): void; // перемикання вкладки-фільтра
  drainGeo(): void; // нові geo-події → журнал (+ анімації перехоплення)
  drainEcon(): void; // нові події економіки → журнал
  drainBattle(): void; // нові події бою → журнал
  drainResearch(): void; // П11.6: нові події науки → журнал («База»)
  adopt(p: Party): void; // прийняти партію: seen-трекінг з точки входу (нової/завантаженої)
  resetBattle(): void; // новий бій: seenBattleLog = 0
}

export function createJournal(deps: JournalDeps): Journal {
  let logFilter: LogFilter = 'all';
  let seenGeoLog = 0;
  const knownDetected = new Set<string>();
  let seenBattleLog = 0;
  let seenEconLog = 0;
  let seenResearchLog = 0; // П11.6: seen-трекінг подій науки

  function journal(text: string, cls = '', cat: LogCat = 'geo'): void {
    const li = document.createElement('li');
    li.textContent = text;
    if (cls) li.className = cls;
    li.dataset.cat = cat; // ADR-0027: категорія для фільтрів-вкладок журналу
    if (logFilter !== 'all' && cat !== logFilter) li.style.display = 'none';
    const log = el('log');
    log.prepend(li);
    while (log.childElementCount > 80) log.removeChild(log.lastChild!);
  }

  // ADR-0027: перемикання фільтра журналу — активна вкладка підсвічується,
  // невідповідні записи ховаються (наявні і нові — одним правилом).
  function setLogFilter(f: LogFilter): void {
    logFilter = f;
    for (const b of document.querySelectorAll<HTMLButtonElement>('#log-tabs button')) {
      b.classList.toggle('active', b.dataset.filter === f);
    }
    for (const li of document.querySelectorAll<HTMLLIElement>('#log li')) {
      li.style.display = f === 'all' || li.dataset.cat === f ? '' : 'none';
    }
  }

  // Geo-події → журнал (туман стратегічного шару: лише виявлені НЛО, як у 4.2).
  // П7: чистий фільтр туману; knownDetected веде журнал (ufo_detected
  // додається до набору ДО перевірки ufo_landed/ufo_left у тому ж batch).
  function drainGeoLog(): void {
    const log = deps.geoLog();
    const p = deps.party();
    for (; seenGeoLog < log.length; seenGeoLog++) {
      const e = log[seenGeoLog];
      if (e.type === 'ufo_detected') knownDetected.add(e.ufoId);
      const msg = geoEventText(e, knownDetected);
      if (msg) journal(msg.text, msg.cls);
      // П9.2: «Ремонт завершено» — подія ядра; підказка один раз за партію.
      if (e.type === 'fighter_repair_done' && claimHint(p.hints, 'repair')) {
        journal('Підказка: винищувач відремонтований і знову боєготовий — можна перехоплювати.');
      }
      // П7.5 (ADR-0032): події перехоплення — джерело анімацій трасерів повітряного
      // бою (сутово відображення: дії ядра вже застосовані; лог лише читається).
      deps.onGeoEvent(e);
    }
    maybeHints(p);
  }

  // П9.2 (Фаза 9): підказки по ходу — один раз за партію, прапорці в Party
  // (сейв-сумісні, ADR-0026). Перевірка стану після дрену подій покриває всі
  // шляхи, якими умова стає істинною: виявлення НЛО, завершення ремонту,
  // завантаження сейву. Туман не порушуємо: умови лише за виявленими НЛО.
  function maybeHints(p: Party): void {
    const f = p.intercept.fighter;
    // «Можна перехопити»: виявлений НЛО у повітрі + боєготовий винищувач
    if (f.status === 'на базі' && f.hp === FIGHTER_MAX_HP && p.geo.ufos.some((u) => u.detected && u.status === 'летить')) {
      if (claimHint(p.hints, 'intercept')) {
        journal('Підказка: виявлений НЛО у повітрі можна перехопити — кнопка «Перехопити» у панелі «Сканери».');
      }
    }
    // «Доступна місія»: приземлений/збитий виявлений НЛО — ціль місії (missionTargets)
    if (missionTargets(p.geo).length > 0) {
      if (claimHint(p.hints, 'mission')) {
        journal('Підказка: НЛО на землі — можна висадити загін, кнопка «Запустити місію» у панелі «Сканери».');
      }
    }
  }

  // Бойові події (state.log) → журнал: постріли і смерті (туман не порушуємо:
  // події пишуться лише про реальні дії, а читач — гравець, який їх бачив).
  function drainBattleLog(): void {
    const log = deps.battleLog();
    if (!log) return;
    for (; seenBattleLog < log.length; seenBattleLog++) {
      const msg = battleEventText(log[seenBattleLog], deps.unitName);
      if (msg) journal(msg.text, msg.cls, 'battle');
    }
  }

  // П4.5: події економіки → журнал (дотації, премії, витрати).
  function drainEconLog(): void {
    const log = deps.econLog();
    for (; seenEconLog < log.length; seenEconLog++) {
      const msg = economyEventText(log[seenEconLog]);
      journal(msg.text, msg.cls, 'econ');
    }
  }

  // П11.6 (ADR-0058): події науки → журнал (категорія «База»). Перетворювач —
  // чиста функція нижче (юніт-тести без DOM).
  function drainResearchLog(): void {
    const log = deps.researchLog();
    for (; seenResearchLog < log.length; seenResearchLog++) {
      const msg = researchEventText(log[seenResearchLog]);
      if (msg) journal(msg.text, msg.cls, 'base');
    }
  }

  // Прийняти партію: seen-трекінг підвинути до кінця логів (історію журналу
  // не відтворюємо — лише нові події), трекінг НЛО перебудувати з логу
  // (ADR-0006). Спільно для нової і завантаженої партії.
  function adopt(p: Party): void {
    seenGeoLog = p.geo.log.length;
    knownDetected.clear();
    for (const e of p.geo.log) if (e.type === 'ufo_detected') knownDetected.add(e.ufoId);
    seenEconLog = p.econ.log.length;
    seenResearchLog = p.research.log.length; // П11.6
  }

  return {
    add: journal,
    setFilter: setLogFilter,
    drainGeo: drainGeoLog,
    drainBattle: drainBattleLog,
    drainEcon: drainEconLog,
    drainResearch: drainResearchLog, // П11.6
    adopt,
    resetBattle: () => {
      seenBattleLog = 0;
    },
  };
}

// П7: чистий перетворювач події бою → рядок журналу; null — не для гравця.
export function battleEventText(e: GameEvent, name: (id: string) => string): { text: string; cls: string } | null {
  if (e.type === 'shot') {
    return {
      text: name(e.shooterId) + ' → ' + name(e.targetId) + ' (' + MODE_LABEL[e.mode] + '): ' + (e.hit ? '−' + e.damage : 'промах'),
      cls: '',
    };
  }
  if (e.type === 'death') {
    return { text: '✝ ' + name(e.unitId) + ' загинув', cls: 'lose' };
  }
  // П11.4 (ADR-0058): події нових бойових дій з витратниками
  if (e.type === 'heal') {
    return { text: '✚ ' + name(e.unitId) + ' лікує ' + name(e.targetId) + ': +' + e.healed + ' HP', cls: 'win' };
  }
  if (e.type === 'grenade') {
    const hits = e.hits.length > 0 ? e.hits.map((h) => '−' + h.damage + ' ' + name(h.unitId)).join(', ') : 'у зоні нікого';
    return { text: '✦ ' + name(e.unitId) + ' кидає гранату в (' + e.center.x + ', ' + e.center.y + '): ' + hits, cls: '' };
  }
  return null; // move / turn / overwatch — не для журналу бою
}

// П7: чистий фільтр туману; knownDetected веде викликаючий (ufo_detected
// додається до набору ДО перевірки ufo_landed/ufo_left у тому ж batch).
export function geoEventText(e: GeoEvent, knownDetected: ReadonlySet<string>): { text: string; cls: string } | null {
  switch (e.type) {
    case 'day':
      return { text: '— Доба ' + e.day + ' —', cls: '' };
    case 'ufo_detected':
      return { text: 'Виявлено НЛО: ' + e.ufoId, cls: '' };
    case 'ufo_landed':
      return knownDetected.has(e.ufoId) ? { text: 'НЛО ' + e.ufoId + ' приземлився — відкрито вікно місії', cls: '' } : null;
    case 'ufo_left':
      return knownDetected.has(e.ufoId) ? { text: 'НЛО ' + e.ufoId + ' відлетів і зник', cls: '' } : null;
    case 'mission_won':
      return { text: 'Місію зачищено ✓', cls: 'win' };
    case 'mission_lost':
      return { text: 'Загін втрачено ✗', cls: 'lose' };
    case 'intercept_start':
      return { text: '✦ Перехоплення: винищувач піднявся на НЛО ' + e.ufoId, cls: '' };
    case 'intercept_engage':
      return { text: '✦ Винищувач зблизився з НЛО ' + e.ufoId + ' — повітряний бій', cls: '' };
    case 'intercept_break_off':
      return { text: '✦ Розрив контакту — винищувач повернувся на базу', cls: '' };
    case 'intercept_aborted':
      return {
        text:
          e.reason === 'fighter_damaged'
            ? '✦ Винищувач пошкоджений — вимушене переривання бою'
            : '✦ НЛО ' + e.ufoId + ' зник з трекінгу — перехоплення перервано',
        cls: e.reason === 'fighter_damaged' ? 'lose' : '',
      };
    case 'ufo_shot_down':
      return { text: '✦ НЛО ' + e.ufoId + ' збитий! На місці падіння — місія', cls: 'win' };
    case 'fighter_returned':
      return { text: '✦ Винищувач повернувся на базу', cls: '' };
    case 'fighter_repair_start':
      return { text: '✦ Ремонт винищувача оплачено (−' + FIGHTER_REPAIR_COST + ')', cls: 'lose' };
    case 'fighter_repair_done':
      return { text: '✦ Ремонт винищувача завершено — знову боєготовий', cls: 'win' };
    default:
      return null; // ufo_spawned / ufo_move — приховано туманом
  }
}

// П4.5: чистий перетворювач події економіки → рядок журналу (для юніт-тестів).
export function economyEventText(e: EconomyEvent): { text: string; cls: string } {
  switch (e.type) {
    case 'allowance':
      return { text: 'Дотація за добу ' + e.day + ': +' + e.amount, cls: '' };
    case 'mission_bonus':
      return { text: 'Премія за місію (' + e.kind + '): +' + e.amount, cls: 'win' };
    // П7.6: премія за збиття НЛО у повітрі перехопленням (SHOT_DOWN_BONUS, ADR-0032).
    case 'shot_down_bonus':
      return { text: 'Збиття у повітрі (' + e.kind + '): +' + e.amount, cls: 'win' };
    case 'spend':
      return { text: 'Витрати: −' + e.amount, cls: 'lose' };
  }
}

// П11.6 (ADR-0058): чистий перетворювач події науки → рядок журналу (для
// юніт-тестів); null — не для гравця. Зарплата й штрафні звільнення — classe
// 'lose' (гроші й втрати), найм/точки/завершення — 'win'.
export function researchEventText(e: ResearchEvent): { text: string; cls: string } | null {
  switch (e.type) {
    case 'hire':
      return { text: '⚑ Вченого найнято: ' + e.name, cls: 'win' };
    case 'fire':
      return { text: '⚑ Вченого звільнено: ' + e.name, cls: '' };
    case 'salary':
      return { text: '⚑ Зарплата вчених (доба ' + e.day + '): −' + e.amount, cls: 'lose' };
    case 'salary_shortfall':
      return { text: '✗ Не вистачило на зарплату (доба ' + e.day + '): звільнено ' + e.fired.join(', '), cls: 'lose' };
    case 'points':
      return { text: '⚑ Наука: +' + e.amount + ' точок (доба ' + e.day + ')', cls: 'win' };
    case 'project_started':
      return { text: '⚑ Проєкт розпочато: ' + e.id, cls: '' };
    case 'project_completed':
      return { text: '⚑ Проєкт завершено: ' + e.id + ' ✓', cls: 'win' };
  }
}
