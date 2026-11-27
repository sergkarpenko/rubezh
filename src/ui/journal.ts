// пR.2 (ADR-0037): журнал подій (ADR-0027: єдиний журнал з категоріями і
// фільтрами-вкладками) — винесено з main.ts без зміни поведінки. Тут —
// текстові перетворювачі подій ядра (geo/economy/combat → рядки журналу;
// П7: чисті функції для юніт-тестів), DOM-механіка журналу (записи,
// кеп 80, фільтри) і seen-трекінг прочитаних подів (drain*). Стан
// застосунку (party/mission) модуль знає лише через Deps-інтерфейс.

import { REGION_NAMES, type RegionId } from '../core/regions';
import type { GeoEvent } from '../core/geo';
import { missionTargets } from '../core/geo';
import { FIGHTER_MAX_HP, FIGHTER_REPAIR_COST } from '../core/intercept';
import type { EconomyEvent } from '../core/economy';
// П11.6 (ADR-0058): події науки і «Кузні» → журнал (категорія «База»).
import { projectName, type ResearchEvent } from '../core/research';
import { equipKeyItem, itemName, type WorkshopEvent } from '../core/workshop';
import { EVAC_AP_COST, type GameEvent, type ShotMode } from '../core/combat';
import { ENEMY_KINDS, ENEMY_ORDER } from '../core/enemies';
import { claimHint, type Party } from '../core/save';
import { el } from './dom';
import { byGender, plural, probeNo, ticksText } from './text';

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
  workshopLog(): readonly WorkshopEvent[]; // П11.6: події цеху (ADR-0058)
  unitName(id: string): string; // назва юніта бою для тексту пострілів
  isMelee?(id: string): boolean; // п17.5: стрілець б'є впритул (гончак) — у дужках «кігті», а не режим
  onGeoEvent(e: GeoEvent): void; // П7.5 (ADR-0032): анімації перехоплення з geo-подій
  // П11.7 (ADR-0059): звуки — там, де журнал уже бачить подію (без дублювання
  // умов); опціональні, щоб ізоляція звуку лишалась тривіальною (критерій 1).
  onBattleSound?(e: GameEvent): void; // постріл/влучання/смерть з подій бою
  onGeoSound?(e: GeoEvent): void; // виявлення НЛО, результат місії
  party(): Party; // П9.2: прапорці підказок живуть у Party (сейв-сумісні, ADR-0026)
  isEvacOperative?(id: string): boolean; // Т.72: юніт із цим id — оперативник гравця в бою з клітинками висадки; без цієї залежності підказки немає
}

export interface Journal {
  add(text: string, cls?: string, cat?: LogCat): void; // запис у журнал
  setFilter(f: LogFilter): void; // перемикання вкладки-фільтра
  drainGeo(): void; // нові geo-події → журнал (+ анімації перехоплення)
  drainEcon(): void; // нові події економіки → журнал
  drainBattle(): void; // нові події бою → журнал
  drainResearch(): void; // П11.6: нові події науки → журнал («База»)
  drainWorkshop(): void; // П11.6: нові події цеху → журнал («База»)
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
  let seenWorkshopLog = 0; // П11.6: seen-трекінг подій цеху

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
  // П7: чистий фільтр туману; knownDetected веде журнал (probe_detected
  // додається до набору ДО перевірки probe_landed/probe_left у тому ж batch).
  function drainGeoLog(): void {
    const log = deps.geoLog();
    const p = deps.party();
    for (; seenGeoLog < log.length; seenGeoLog++) {
      const e = log[seenGeoLog];
      if (e.type === 'probe_detected') knownDetected.add(e.probeId);
      const msg = geoEventText(e, knownDetected);
      if (msg) journal(msg.text, msg.cls);
      // П9.2: «Ремонт завершено» — подія ядра; підказка один раз за партію.
      if (e.type === 'fighter_repair_done' && claimHint(p.hints, 'repair')) {
        journal('Підказка: перехоплювач відремонтований і знову боєготовий — можна перехоплювати.');
      }
      // П7.5 (ADR-0032): події перехоплення — джерело анімацій трасерів повітряного
      // бою (сутово відображення: дії ядра вже застосовані; лог лише читається).
      deps.onGeoEvent(e);
      // П11.7 (ADR-0059): звук геоподій — drain-контур (умови не дублюємо).
      deps.onGeoSound?.(e);
    }
    maybeHints(p);
  }

  // П9.2 (Фаза 9): підказки по ходу — один раз за партію, прапорці в Party
  // (сейв-сумісні, ADR-0026). Перевірка стану після дрену подій покриває всі
  // шляхи, якими умова стає істинною: виявлення НЛО, завершення ремонту,
  // завантаження сейву. Туман не порушуємо: умови лише за виявленими НЛО.
  function maybeHints(p: Party): void {
    // «Можна перехопити»: виявлений НЛО у повітрі + боєготовий винищувач (п19.4: будь-який)
    if (
      p.intercept.fighters.some((f) => f.status === 'на базі' && f.hp === FIGHTER_MAX_HP) &&
      p.geo.probes.some((u) => u.detected && u.status === 'летить')
    ) {
      if (claimHint(p.hints, 'intercept')) {
        journal(
          'Підказка: виявлений зонд Розриву у повітрі можна перехопити — кнопка «Перехопити» на вкладці «Вузол», панель «Сенсорна сітка».'
        );
      }
    }
    // «Доступна місія»: приземлений/збитий виявлений НЛО — ціль місії (missionTargets)
    if (missionTargets(p.geo).length > 0) {
      if (claimHint(p.hints, 'mission')) {
        journal(
          'Підказка: зонд Розриву на землі — можна висадити загін, кнопка «Запустити місію» на вкладці «Вузол», панель «Сенсорна сітка».'
        );
      }
    }
  }

  // Бойові події (state.log) → журнал: постріли і смерті (туман не порушуємо:
  // події пишуться лише про реальні дії, а читач — гравець, який їх бачив).
  function drainBattleLog(): void {
    const log = deps.battleLog();
    if (!log) return;
    for (; seenBattleLog < log.length; seenBattleLog++) {
      const e = log[seenBattleLog];
      const msg = battleEventText(e, deps.unitName, deps.isMelee);
      if (msg) journal(msg.text, msg.cls, 'battle');
      // П11.7 (ADR-0059): постріл/влучання/смерть → звук (drain-контур журналу).
      deps.onBattleSound?.(e);
      // Т.72: перше поранення чи смерть оперативника в бою з клітинками висадки — підказка «Можна евакуюватись», один раз за партію.
      const op = deps.isEvacOperative ?? (() => false);
      const evacHurt =
        (e.type === 'shot' && e.hit && e.damage > 0 && op(e.targetId)) ||
        (e.type === 'death' && op(e.unitId)) ||
        (e.type === 'grenade' && e.hits.some((h) => h.damage > 0 && op(h.unitId)));
      if (evacHurt && claimHint(deps.party().hints, 'evac')) {
        journal(
          `Підказка: оперативника можна евакуювати із зони висадки — плитка «Евакуація» або клавіша V, ${EVAC_AP_COST} AP. Якщо евакуювати всіх, хто лишився на полі, премії за місію немає.`,
          '',
          'battle'
        );
      }
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

  // П11.6 (ADR-0058): події цеху → журнал (категорія «База»). Перетворювач —
  // чиста функція нижче (юніт-тести без DOM).
  function drainWorkshopLog(): void {
    const log = deps.workshopLog();
    for (; seenWorkshopLog < log.length; seenWorkshopLog++) {
      const msg = workshopEventText(log[seenWorkshopLog]);
      if (msg) journal(msg.text, msg.cls, 'base');
    }
  }

  // Прийняти партію: seen-трекінг підвинути до кінця логів (історію журналу
  // не відтворюємо — лише нові події), трекінг НЛО перебудувати з логу
  // (ADR-0006). Спільно для нової і завантаженої партії.
  function adopt(p: Party): void {
    seenGeoLog = p.geo.log.length;
    knownDetected.clear();
    for (const e of p.geo.log) if (e.type === 'probe_detected') knownDetected.add(e.probeId);
    seenEconLog = p.econ.log.length;
    seenResearchLog = p.research.log.length; // П11.6
    seenWorkshopLog = p.workshop.log.length; // П11.6
  }

  return {
    add: journal,
    setFilter: setLogFilter,
    drainGeo: drainGeoLog,
    drainBattle: drainBattleLog,
    drainEcon: drainEconLog,
    drainResearch: drainResearchLog, // П11.6
    drainWorkshop: drainWorkshopLog, // П11.6
    adopt,
    resetBattle: () => {
      seenBattleLog = 0;
    },
  };
}

// П7: чистий перетворювач події бою → рядок журналу; null — не для гравця.
// п17.5 (рішення власника «А. Удар без трасера, «(кігті)»»): удар гончака — «(кігті)» замість режиму.
export function battleEventText(
  e: GameEvent,
  name: (id: string) => string,
  melee: (id: string) => boolean = () => false
): { text: string; cls: string } | null {
  if (e.type === 'shot') {
    const how = melee(e.shooterId) ? 'кігті' : MODE_LABEL[e.mode];
    return {
      text: name(e.shooterId) + ' → ' + name(e.targetId) + ' (' + how + '): ' + (e.hit ? '−' + e.damage : 'промах'),
      cls: '',
    };
  }
  if (e.type === 'death') {
    const dead = name(e.unitId);
    return { text: '✝ ' + dead + ' ' + byGender(dead, 'загинув', 'загинула'), cls: 'lose' };
  }
  // П11.4 (ADR-0058): події нових бойових дій з витратниками
  if (e.type === 'heal') {
    return { text: '✚ ' + name(e.unitId) + ' лікує ' + name(e.targetId) + ': +' + e.healed + ' HP', cls: 'win' };
  }
  if (e.type === 'grenade') {
    const hits = e.hits.length > 0 ? e.hits.map((h) => '−' + h.damage + ' ' + name(h.unitId)).join(', ') : 'у зоні нікого';
    return { text: '✦ ' + name(e.unitId) + ' кидає гранату в (' + e.center.x + ', ' + e.center.y + '): ' + hits, cls: '' };
  }
  // п16.4 (ADR-0147, рішення власника «А»): дії ролей; «Точний постріл» — мітка перед звичайним рядком пострілу
  if (e.type === 'dash') return { text: '» ' + name(e.unitId) + ': «Ривок» +' + e.bonus + ' AP', cls: '' };
  if (e.type === 'precise_shot') return { text: '◎ ' + name(e.shooterId) + ': «Точний постріл»', cls: '' };
  // п18.5 (ADR-0157; кандидат 181 а): витрачений «Пробивний заряд» — мітка перед рядком пострілу
  if (e.type === 'charge')
    return { text: '⚡ ' + name(e.shooterId) + ': «Пробивний заряд» — броню пробито (' + name(e.targetId) + ')', cls: '' };
  if (e.type === 'field_aid') {
    return { text: '✚ ' + name(e.unitId) + ': «Польова допомога» → ' + name(e.targetId) + ' +' + e.healed + ' HP', cls: 'win' };
  }
  // Т.75 (рішення власника 19.11.2026): рядок евакуації — без роду, як рядок під полем бою
  if (e.type === 'evac_unit') {
    return { text: '⇧ Евакуйовано: ' + name(e.unitId), cls: '' };
  }
  return null; // move / turn / overwatch — не для журналу бою
}

// п19.3: « N» — номер перехоплювача з поля fighter події (є, коли перехоплювачів ≥ 2), інакше порожньо.
function num(e: { fighter?: number }): string {
  return e.fighter !== undefined ? ' ' + e.fighter : '';
}

// п19.3: назва ангара (регіону) події вильоту чи повернення; без поля — north («Шпилі», вузол).
function hangarName(e: { region?: RegionId }): string {
  return REGION_NAMES[e.region ?? 'north'];
}

// П7: чистий фільтр туману; knownDetected веде викликаючий (probe_detected
// додається до набору ДО перевірки probe_landed/probe_left у тому ж batch).
export function geoEventText(e: GeoEvent, knownDetected: ReadonlySet<string>): { text: string; cls: string } | null {
  switch (e.type) {
    case 'day':
      return { text: '— Доба ' + e.day + ' —', cls: '' };
    case 'probe_detected':
      return { text: 'Виявлено зонд Розриву ' + probeNo(e.probeId), cls: '' };
    case 'probe_landed':
      return knownDetected.has(e.probeId)
        ? { text: 'Зонд Розриву ' + probeNo(e.probeId) + ' приземлився — відкрито вікно місії', cls: '' }
        : null;
    case 'probe_left':
      return knownDetected.has(e.probeId) ? { text: 'Зонд Розриву ' + probeNo(e.probeId) + ' відлетів і зник', cls: '' } : null;
    case 'mission_won':
      return { text: 'Місію зачищено ✓', cls: 'win' };
    case 'mission_evacuated': // Т.75 (рішення власника 19.11.2026): у парі до «зачищено ✓» / «втрачено ✗»
      return { text: 'Загін евакуйовано ⇧', cls: '' };
    case 'mission_lost':
      return { text: 'Загін втрачено ✗', cls: 'lose' };
    // п19.3 (ADR-0161; рішення власника «А. Номер»): з полем fighter (перехоплювачів ≥ 2) — номер
    // і ангар; без нього — рядки як у v0.10.0.
    case 'intercept_start':
      return e.fighter !== undefined
        ? {
            text: '✦ Перехоплювач ' + e.fighter + ' піднявся з ангара «' + hangarName(e) + '» на зонд Розриву ' + probeNo(e.probeId),
            cls: '',
          }
        : { text: '✦ Перехоплення: перехоплювач піднявся на зонд Розриву ' + probeNo(e.probeId), cls: '' };
    case 'intercept_engage':
      return { text: '✦ Перехоплювач' + num(e) + ' зблизився із зондом Розриву ' + probeNo(e.probeId) + ' — повітряний бій', cls: '' };
    case 'intercept_break_off':
      return e.fighter !== undefined
        ? { text: '✦ Розрив контакту — перехоплювач ' + e.fighter + ' повертається в ангар', cls: '' }
        : { text: '✦ Розрив контакту — перехоплювач повернувся у вузол «Рубіж»', cls: '' };
    case 'intercept_aborted': {
      const by = e.fighter !== undefined ? ' (перехоплювач ' + e.fighter + ')' : '';
      return {
        text:
          e.reason === 'fighter_damaged'
            ? '✦ Перехоплювач' + num(e) + ' пошкоджений — вимушене переривання бою'
            : e.reason === 'probe_landed'
              ? '✦ Зонд Розриву ' + probeNo(e.probeId) + ' приземлився — перехоплення перервано' + by // Т.49: текст власника з номером зонда
              : '✦ Зонд Розриву ' + probeNo(e.probeId) + ' зник з трекінгу — перехоплення перервано' + by,
        cls: e.reason === 'fighter_damaged' ? 'lose' : '',
      };
    }
    case 'probe_shot_down':
      return { text: '✦ Зонд Розриву ' + probeNo(e.probeId) + ' збитий! На місці падіння — місія', cls: 'win' };
    case 'fighter_returned':
      return e.fighter !== undefined
        ? { text: '✦ Перехоплювач ' + e.fighter + ' повернувся в ангар «' + hangarName(e) + '»', cls: '' }
        : { text: '✦ Перехоплювач повернувся у вузол «Рубіж»', cls: '' };
    case 'fighter_repair_start':
      return { text: '✦ Ремонт перехоплювача' + num(e) + ' оплачено (−' + FIGHTER_REPAIR_COST + ')', cls: 'lose' };
    case 'fighter_repair_done':
      return { text: '✦ Ремонт перехоплювача' + num(e) + ' завершено — знову боєготовий', cls: 'win' };
    // п19.3 (рішення власника «А. Кілька в одному»)
    case 'fighter_assigned':
      return {
        text: '✦ Перехоплювач' + num(e) + ' перебазовано: ангар «' + REGION_NAMES[e.from] + '» → «' + REGION_NAMES[e.to] + '»',
        cls: '',
      };
    // п18.4 (ADR-0156; рішення власника «А. Мінімум»): штурм бази і фінал «Брама Розриву»
    case 'base_assault':
      return { text: '⚠ Штурм вузла «Рубіж»: загроза ' + e.threshold + ' — демони атакують базу.', cls: 'lose' };
    case 'assault_won':
      return { text: 'Штурм бази відбито ✓', cls: 'win' };
    case 'assault_lost':
      return {
        text:
          'Штурм бази не відбито ✗ — втрачено ' +
          (e.money > 0 ? plural(e.money, 'кредит', 'кредити', 'кредитів') + ' і ' : '') +
          'половину складу, загроза +10',
        cls: 'lose',
      };
    case 'gate_lost':
      return { text: 'Брама Розриву встояла ✗ — загроза +10, повтор через добу', cls: 'lose' };
    case 'campaign_victory':
      return { text: '★ Браму Розриву закрито — перемога (рахунок ' + e.score + ')', cls: 'win' };
    // п19.2 (ADR-0159 п. 11; рішення власника «А. Обидва напрями, і невиявлені», «А. …вийшов…»)
    case 'region_trust':
      return e.delta < 0
        ? { text: '▼ Довіра «' + REGION_NAMES[e.region] + '» −' + -e.delta + ' → ' + e.trust + ': зонд відлетів без бою', cls: 'lose' }
        : { text: '▲ Довіра «' + REGION_NAMES[e.region] + '» +' + e.delta + ' → ' + e.trust + ': місію зачищено', cls: 'win' };
    case 'region_out':
      return { text: '✗ Район «' + REGION_NAMES[e.region] + '» вийшов — його частки дотації більше немає', cls: 'lose' };
    default:
      return null; // probe_spawned / probe_move — приховано туманом
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
// юніт-тестів); null — не для гравця. Утримання і штрафні звільнення — classe
// 'lose' (кредити й втрати), вербування/потік/завершення — 'win'.
// П12.6 (ADR-0064): термінологія Розриву — техноманти, потік, протоколи;
// назви протоколів — з каталогу ядра (ключі — не відображення).
export function researchEventText(e: ResearchEvent): { text: string; cls: string } | null {
  switch (e.type) {
    case 'hire':
      return { text: '⚑ Техноманта вербовано: ' + e.name, cls: 'win' };
    case 'fire':
      return { text: '⚑ Техноманта звільнено: ' + e.name, cls: '' };
    case 'salary':
      return { text: '⚑ Утримання техномантів (доба ' + e.day + '): −' + e.amount, cls: 'lose' };
    case 'salary_shortfall':
      return { text: '✗ Не вистачило на утримання (доба ' + e.day + '): звільнено ' + e.fired.join(', '), cls: 'lose' };
    case 'points':
      return { text: '⚑ Потік: +' + e.amount + ' (доба ' + e.day + ')', cls: 'win' };
    case 'project_started':
      return { text: '⚑ Протокол розпочато: ' + projectName(e.id), cls: '' };
    case 'project_completed':
      return { text: '⚑ Протокол завершено: ' + projectName(e.id) + ' ✓', cls: 'win' };
    case 'trophies': {
      // п18.5 (ADR-0157): трофеї виграної місії — типи порядком ENEMY_ORDER, назви з ядра
      const parts = ENEMY_ORDER.filter((k) => (e.gained[k] ?? 0) > 0).map((k) => ENEMY_KINDS[k].name.toLowerCase() + ' +' + e.gained[k]);
      return { text: '⚑ Трофеї: ' + parts.join(', '), cls: 'win' };
    }
  }
}

// П11.6 (ADR-0058): чистий перетворювач події «Кузні» → рядок журналу (для
// юніт-тестів); null — не для гравця. Оперативник — за id (ростер журналу не
// відображає; ім'я видно в панелі ростеру). Виготовлення — 'win', втрата
// екіпірування загиблого — 'lose' (перма-смерть).
// П12.6 (ADR-0064): «Кузня»; назви предметів — з каталогу ядра.
export function workshopEventText(e: WorkshopEvent): { text: string; cls: string } | null {
  switch (e.type) {
    case 'order':
      return { text: '⚑ Кузня: замовлено «' + itemName(e.id) + '» — ' + ticksText(e.ticks), cls: '' };
    case 'produced':
      return { text: '⚑ Кузня: виготовлено «' + itemName(e.id) + '» → склад ✓', cls: 'win' };
    case 'equip':
      return { text: '⚑ Кузня: ' + e.soldierId + ' споряджено «' + itemName(e.id) + '»', cls: '' };
    case 'unequip':
      return { text: '⚑ Кузня: з ' + e.soldierId + ' знято «' + itemName(e.id) + '» → склад', cls: '' };
    case 'equipment_lost':
      return {
        text:
          '✗ Витратники ' +
          e.soldierId +
          ' втрачено разом із оперативником (' +
          e.items.map((k) => itemName(equipKeyItem(k))).join(', ') +
          ')',
        cls: 'lose',
      };
    case 'equipment_returned':
      return {
        text: '⚑ Кузня: спорядження ' + e.soldierId + ' повернуто на склад (' + e.items.map((k) => itemName(k)).join(', ') + ')',
        cls: '',
      };
    case 'gun_module_installed':
      return { text: '⚑ Кузня: гарматний модуль встановлено на перехоплювач' + num(e), cls: '' };
    case 'gun_module_removed':
      return { text: '⚑ Кузня: гарматний модуль знято з перехоплювача' + num(e) + ' → склад', cls: '' };
    // п19.3 (ADR-0161; рішення власника «А. З ангаром»)
    case 'interceptor_order':
      return { text: '⚑ Кузня: замовлено «Перехоплювач» для ангара «' + REGION_NAMES[e.region] + '» — ' + ticksText(e.ticks), cls: '' };
    case 'interceptor_produced':
      return { text: '⚑ Кузня: перехоплювач ' + e.fighter + ' виготовлено → ангар «' + REGION_NAMES[e.region] + '» ✓', cls: 'win' };
    case 'store_lost':
      return null; // п18.4: утрату складу називає рядок штурму (geoEventText, assault_lost)
  }
}
