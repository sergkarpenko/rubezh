// src/main.ts
// Превью «Рубіж» — точка входу шару відображення (ADR-0010: ванільний TS +
// Canvas 2D; ADR-0001: браузер; ADR-0007: мінімалістична графіка).
// пR.2 (ADR-0037): тут лише init, partyTick, renderAll і зв'язування модулів
// src/ui/* (demo, save-panel, journal, panels, battle, input) з чистим ядром
// src/core (ADR-0002) та анімаційним рушієм render.ts (ADR-0029). Історія
// ітерацій — docs/workflow.md. DOM-ініціалізація — лише у браузері
// (typeof document): node-середовище (vitest) імпортує модуль без побічних ефектів.

import { RADAR_RANGE, advanceTime } from './core/geo';
import { hireSoldier, hospitalTick, isBankrupt } from './core/squad';
import { economyTick } from './core/economy';
// П11.2 (ADR-0058): тік науки — після дотації того ж дня; без вчених — no-op.
import { researchTick } from './core/research';
// П11.3 (ADR-0058): тік цеху — разом із тіком геосцени; без замовлень — no-op.
import { workshopTick } from './core/workshop';
import { interceptTick, repairTick, type InterceptEvent } from './core/intercept';
// пR.2 (ADR-0037): модулі шару UI — демо-драйвер, DOM-хелпер, панель збереження, журнал подій.
import { DemoDriver } from './ui/demo';
import { el } from './ui/dom';
import { createSavePanel } from './ui/save-panel';
// П11.6 (ADR-0058/0037): панель «Дослідження» — модуль src/ui/research-panel.ts.
import { createResearchPanel } from './ui/research-panel';
// П11.6 (ADR-0058/0037): панель «Цех» — модуль src/ui/workshop-panel.ts.
import { createWorkshopPanel } from './ui/workshop-panel';
// П9.1 (Фаза 9): екран «Як грати» — модуль src/ui/help.ts (перший візит + кнопка «?»).
import { createHelp } from './ui/help';
import { createJournal, type LogFilter } from './ui/journal';
// П11.7 (ADR-0059): звуковий шар — WebAudio синтезом кодом, модуль src/ui/audio.ts.
import { createSound } from './ui/audio';
// пR.2 (ADR-0037): панелі стану і топбара — модуль src/ui/panels.ts; масштаб сітки — src/ui/grid.ts.
import { createPanels } from './ui/panels';
import { GCELL } from './ui/grid';
// пR.2 (ADR-0037): бойовище і флоу бою — модуль src/ui/battle.ts.
import { createBattleUI, type BattleUIState } from './ui/battle';
// П13.2 (ADR-0066): вертикальний тулбар бойових дій збоку — модуль src/ui/toolbar.ts.
import { createToolbar } from './ui/toolbar';
import { createInput } from './ui/input';
// П6.7 (ADR-0029): векторні спрайти — чисті функції малювання шару відображення.
// П6.8 (ADR-0029): анімаційний рушій — черга + rAF лише під час активних анімацій.
// пR.3 (ADR-0038): рушій і фабрики анімацій — чиста логіка src/core/render-core.ts;
// фабрика offscreen-канвасів — реєструється в шарі відображення (src/render.ts).
import { initPixelSprites } from './render';
import { AnimEngine, makeGeoPulseAnim, makeTracerAnim, type Anim } from './core/render-core';
// П5.3 (ADR-0026): партія і слоти збереження — із чистого ядра save.ts.
// П12.2 (ADR-0065): serializeParty — ще й контрольна точка «незбережених
// змін» для підтвердження виходу (той самий детермінований стан, без дублів).
import { createParty, serializeParty, type Party } from './core/save';
import { campaignTick, type DifficultyPreset } from './core/campaign';
// П12.2 (ADR-0065): каркас екранів і навігації — модуль src/ui/screens.ts;
// тут — лише зв'язування з партією, панеллю збереження і «Як грати».
import { createScreens, type Screens } from './ui/screens';
import { createSettings } from './ui/settings';
// П12.4 (ADR-0065): вкладки статус-колонки «Загін»/«База»/«Система» —
// модуль src/ui/status-tabs.ts (панелі в DOM, персист поза сейвом).
import { createStatusTabs } from './ui/status-tabs';

// пR.2 (ADR-0037): масштаб сітки (GCELL/BCELL) — спільний модуль src/ui/grid.ts.

// П6.12 (ADR-0031): піксель-арт спрайти — фабрика offscreen-канвасів для
// render.ts. Реєструється ДО першого рендера (нижче newParty(42) малює
// геосцену — TDZ/порядок оголошень, урок у docs/workflow.md).
initPixelSprites((w: number, h: number) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
});

// П11.7 (ADR-0059): звуковий шар — суто відображення: не чіпає стан і
// траєкторії; події бою/геосцени подає drain-контур журналу, точкові
// виклики — кліки UI. Створюється ДО журналу: хуки звуку йдуть у його deps.
const sound = createSound();

// Порядок оголошень важливий (TDZ — див. docs/workflow.md): усі змінні стану,
// які newParty() чи обробники пишуть, оголошуються ДО першого виклику newParty().
// пR.2 (ADR-0037): журнал подій (категорії і фільтри-вкладки — ADR-0027,
// EventText-перетворювачі, seen-трекінг подій) — модуль src/ui/journal.ts;
// тут — лише зв'язування зі станом застосунку (party/mission) і анімаціями
// перехоплення (П7.5). Створюється ДО newParty(42): adoptParty звідти
// використовує journal.adopt (урок TDZ — див. docs/workflow.md).
const journalUI = createJournal({
  geoLog: () => activeParty().geo.log,
  econLog: () => activeParty().econ.log,
  battleLog: () => (ui.mission ? ui.mission.state.log : null),
  researchLog: () => activeParty().research.log, // П11.6: події науки → журнал («База»)
  workshopLog: () => activeParty().workshop.log, // П11.6: події цеху → журнал («База»)
  unitName,
  onGeoEvent: (e) => {
    if (hasRaf) geoAnim.push(...interceptAnims(e as InterceptEvent));
  },
  // П11.7 (ADR-0059): звуки подій бою і геосцени — через drain-контур журналу.
  onBattleSound: (e) => sound.battleEvent(e),
  onGeoSound: (e) => sound.geoEvent(e),
  party: () => activeParty(), // П9.2: прапорці підказок журналу — у Party (сейв-сумісні)
});
const journal = journalUI.add; // виклики journal(text, cls, cat) у шарі застосунку без змін

let gameOver = false; // банкрутство (ADR-0021): боєготових немає і грошей на найм немає
let victoryDismissed = false; // П8.3a: endless — гравець закрив екран перемоги і продовжує гру
// П12.2 (ADR-0065): партія створюється лише вибором гравця на стартовому
// екрані — до того її немає (стартовий екран живе без стану партії).
let party: Party | null = null;
// Доступ до партії з closures шару відображення: усі виклики відбуваються
// лише в активній грі (стартовий екран панелі не рендерить); явний захист
// від розсинхрону — помилка українською, без тихих undefined.
function activeParty(): Party {
  if (party === null) throw new Error('Партію не створено — дії доступні лише в активній грі');
  return party;
}
// П12.2 (ADR-0026): контрольна серіалізація на момент останнього створення/
// збереження/завантаження; розбіжність = незбережені зміни (вихід — з
// підтвердженням, сейв лише вручну). Детермінований стан (ADR-0003).
let checkpoint: string | null = null;
function hasUnsavedChanges(): boolean {
  if (party === null || checkpoint === null) return false;
  return serializeParty(party) !== checkpoint;
}
// П12.2 (ADR-0065): каркас екранів — створюється лише у браузері (контент
// будує DOM); твердження про null страхують шари-зв'язки до ініціалізації.
let screens: Screens | null = null;
// пR.2 (ADR-0037): стан бою — явний об'єкт замість модульних let (мітигація
// плану рефакторингу); ним спільно користуються модуль бою (src/ui/battle.ts)
// і обробники вводу (нижче). Порядок оголошень — TDZ, див. docs/workflow.md.
const ui: BattleUIState = {
  mission: null,
  battleResult: null,
  selectedId: null, // вибраний солдат
  fireMode: null, // «зведений» режим пострілу
  itemMode: null, // П11.6: «зведений» витратник — аптечка/граната
  hoverPath: null, // прев'ю шляху під курсором
  hoverAp: 0,
  tapCell: null, // ADR-0027 (П6.4): клітинка першого тапу — повторний тап у неї робить хід
  aimCell: null, // П6.14: клітинка цілі під наведенням/першим тапом у зведеному режимі
};

// пR.2 (ADR-0037): бойовище і флоу бою (П6.3–П6.16) — модуль src/ui/battle.ts;
// тут — зв'язування зі станом застосунку (party/ui), журналом (drain/reset)
// і анімаційними рушіями (через адаптер: closures нижче оголошені пізніше,
// викликаються лише у рантаймі).
const battle = createBattleUI(ui, {
  getParty: () => activeParty(),
  journal,
  drainBattle: () => journalUI.drainBattle(),
  resetBattleLog: () => journalUI.resetBattle(),
  renderAll,
  anim: {
    active: () => anim.active(),
    get now() {
      return anim.now;
    },
    push: (a) => anim.push(...a),
    cancel: () => anim.cancel(),
  },
  hasRaf: () => hasRaf,
  stopDemo: () => demo.stop(),
  cancelGeoAnim: () => geoAnim.cancel(),
});

// пR.2 (ADR-0037): ввід тактичного бою (клік/hover/клавіші, зведення режимів,
// дозор, кінець ходу) — модуль src/ui/input.ts; тут — лише зв'язування зі
// станом бою (ui), діями бою (battle) і демо-драйвером.
const input = createInput(ui, battle, {
  renderAll,
  demoBusy: () => demo.busy,
});

// П6.8 (ADR-0029): анімаційний рушій — черга анімацій, rAF-цикл живе лише
// поки черга непорожня (idle → 0 перерисовок; батарея iPad). Кожен кадр —
// renderBattle з clearRect на весь buffer (урок П6.6). rAF може бути
// відсутній у тестовому середовищі — тоді анімації не ставляться в чергу
// (стан і лог бою від анімації не залежать — критерій «байт-у-байт»).
const hasRaf = typeof requestAnimationFrame === 'function';

// пR.2 (ADR-0037): покрокове демо П6.16 — стан і таймери драйвера в src/ui/demo.ts;
// тут лише зв'язування з місією, анімаціями та відображенням.
const demo = new DemoDriver({
  getMission: () => ui.mission,
  battleFinished: () => ui.battleResult !== null,
  renderBattle: () => battle.renderBattle(),
  renderAll,
  binfo: battle.binfo,
  finishBattle: battle.finish,
  pushAnims: (anims) => anim.push(...anims),
  hasRaf,
});

// пR.2 (ADR-0037): панель збереження (П5.3, ADR-0026) — модуль src/ui/save-panel.ts;
// тут лише зв'язування зі станом застосунку (party/mission/gameOver) і журналом.
const savePanel = createSavePanel({
  getParty: () => activeParty(),
  adoptLoaded: (p) => {
    party = adoptParty(p);
  },
  // П12.2 (ADR-0026): вдалий сейв — нова контрольна точка незбережених змін
  onSaved: () => {
    checkpoint = party === null ? null : serializeParty(party);
  },
  inBattle: () => ui.mission !== null,
  interceptBusy: () => {
    const f = activeParty().intercept.fighter;
    return f.status === 'погоня' || f.status === 'бій';
  },
  isGameOver: () => gameOver,
  journal,
  renderAll,
});

// пR.2 (ADR-0037): панелі стану і топбара (геосцена, сканери НЛО, винищувач,
// фінанси, ростер, чипи кампанії, екран перемоги) — модуль src/ui/panels.ts;
// тут — лише зв'язування зі станом застосунку (party/mission/gameOver),
// журналом (drain*), анімацією геосцени (пульс радара) і запуском місії.
const panels = createPanels({
  getParty: () => activeParty(),
  inBattle: () => ui.mission !== null,
  isGameOver: () => gameOver,
  journal,
  renderAll,
  launchMission: battle.launch,
  drainGeo: () => journalUI.drainGeo(),
  drainEcon: () => journalUI.drainEcon(),
  activeGeoAnim: () => geoAnim.active(),
  geoAnimNow: () => geoAnim.now,
  victoryDismissed: () => victoryDismissed,
});

// П11.6 (ADR-0058/0037): панель «Дослідження» — тут лише зв'язування зі
// станом застосунку (party/mission/gameOver) і журналом (drain).
const researchPanel = createResearchPanel({
  getParty: () => activeParty(),
  inBattle: () => ui.mission !== null,
  isGameOver: () => gameOver,
  journal,
  drainResearch: () => journalUI.drainResearch(),
  renderAll,
});

// П11.6 (ADR-0058/0037): панель «Цех» — тут лише зв'язування зі станом
// застосунку і журналом (drain). Екіпірування — у модулі panels (картка солдата).
const workshopPanel = createWorkshopPanel({
  getParty: () => activeParty(),
  inBattle: () => ui.mission !== null,
  isGameOver: () => gameOver,
  journal,
  drainWorkshop: () => journalUI.drainWorkshop(),
  renderAll,
});

const anim = new AnimEngine({
  schedule: (cb) => requestAnimationFrame(cb),
  cancel: (h) => cancelAnimationFrame(h as number),
  draw: () => battle.renderBattle(),
  onIdle: () => demo.onAnimIdle(), // П6.16: анімації дії демо відтворені — пауза і наступна дія
});
// П6.9 (ADR-0029): пульс радара геосцени — той самий рушій (черга + rAF лише
// під час активних анімацій, idle → 0 перерисовок), окремий інстанс зі своєю
// перемальовкою renderGeo. Суто візуальний: geo.rng не чіпається, траєкторія
// геосцени незмінна; туман — невиявлені НЛО у кадр не потрапляють (ADR-0006).
const geoAnim = new AnimEngine({
  schedule: (cb) => requestAnimationFrame(cb),
  cancel: (h) => cancelAnimationFrame(h as number),
  draw: () => panels.renderGeo(),
});

// Прийняти партію у UI-шар: seen-трекінг журналу — у модулі journal (історію
// не відтворюємо — лише нові події після точки входу, трекінг НЛО з логу —
// ADR-0006), банкрутство перераховуємо тут (ADR-0021). Спільно для нової
// і завантаженої партії. П12.2 (ADR-0026): точка прийняття — контрольна
// серіалізація (незбережених змін на цей момент немає).
function adoptParty(p: Party): Party {
  journalUI.adopt(p);
  gameOver = isBankrupt(p.econ, p.roster, p.campaign.preset);
  victoryDismissed = false; // П8.3a: нова/завантажена партія — екран перемоги показується знову
  checkpoint = serializeParty(p);
  return p;
}

function newParty(seed: number, preset: DifficultyPreset = 'норма'): Party {
  return adoptParty(createParty(seed, preset));
}

function unitName(id: string): string {
  const u = ui.mission?.state.units.find((x) => x.id === id);
  return u ? u.name : id;
}

// Geo-події → журнал: перетворювач і seen-трекінг — у src/ui/journal.ts (пR.2).

// П7.5 (ADR-0032): подія перехоплення → анімації геосцени. Трасер винищувача — холодний
// блакит (колір гравця), трасер НЛО — розпечений оранж (колір прибульців); куля летить
// між поточними позиціями винищувача і НЛО у клітинках геосцени (GCELL задає drawAnimFrame).
// Промахи не анімуємо (лише влучання — спалах удару), відступ/ремонт — без анімацій.
function interceptAnims(e: InterceptEvent): Anim[] {
  if (party === null) return []; // П12.2: події геосцени — лише в активній грі
  if (e.type !== 'intercept_round' || e.choice === 'відступ') return [];
  const p = party;
  const ufo = p.geo.ufos.find((u) => u.id === p.intercept.activeUfoId);
  if (!ufo) return [];
  const fpos = p.intercept.fighter.pos;
  const anims: Anim[] = [];
  if (e.fighterHit) anims.push(makeTracerAnim('player', { ...fpos }, { ...ufo.pos }, true));
  if (e.ufoHit) anims.push(makeTracerAnim('alien', { ...ufo.pos }, { ...fpos }, true));
  return anims;
}

// Події економіки → журнал: перетворювач і seen-трекінг — у src/ui/journal.ts (пR.2).

// П4.5 (ADR-0021): один тік часу партії — геосцена + дотація + лікарня +
// перевірка банкрутства. Викликати лише поза бою (час геосцени заморожено).
// П12.2 (ADR-0065): виклик можливий лише в активній грі (стартовий екран
// партії не має) — захист на вході.
function partyTick(): void {
  if (party === null) return;
  const p = party;
  advanceTime(p.geo, 1);
  economyTick(p.econ, p.geo, p.campaign.preset);
  // П11.2 (ADR-0058): зарплата і наукові точки — тим самим контуром доби,
  // одразу після дотації; без вчених — no-op (партії без науки не змінюються).
  researchTick(p.research, p.econ, p.geo, p.campaign.preset);
  // П11.3 (ADR-0058): виробництво — тіками геосцени (1 виклик = 1 тік);
  // без замовлень — no-op (партії без цеху не змінюються).
  workshopTick(p.workshop);
  hospitalTick(p.roster);
  // П7.4 (ADR-0032): погоня й ремонт живуть тіками геосцени разом з партією
  interceptTick(p.intercept, p.geo);
  repairTick(p.intercept, p.geo);
  // П6.9 (ADR-0029): пульс радара на тік часу — серія тіків (доба) дає один
  // пульс (coalesce за busy), idle → 0 перерисовок. Лише візуальний ефект.
  if (hasRaf && !geoAnim.busy) {
    const b = p.geo.base;
    geoAnim.push(makeGeoPulseAnim(b.x * GCELL + GCELL / 2, b.y * GCELL + GCELL / 2, (RADAR_RANGE + 0.5) * GCELL));
  }
  if (!gameOver && isBankrupt(p.econ, p.roster, p.campaign.preset)) {
    gameOver = true;
    journal('✗ Банкрутство: немає боєготових оперативників і кредитів на вербування — партію програно.', 'lose', 'econ');
  }

  // П8.3: перевірка кампанії на межі 30-ї доби
  campaignTick({ geo: p.geo, roster: p.roster, econ: p.econ }, p.campaign);
}

// --- пR.2 (ADR-0037): панелі стану і топбара — модуль src/ui/panels.ts ---

// --- П5.3: панель збереження (ADR-0026) — модуль src/ui/save-panel.ts (пR.2) ---

// --- тактичний бій (5.3) ---

// ADR-0027: фокусна зона — геосцена або бій (не «два екрани»); чипи кампанії
// і панелі — модуль panels, рендер бойовища — модуль battle (пR.2).
// П12.2 (ADR-0065): без активної партії не рендеримо — стартовий екран
// показує каркас екранів (screens.ts), панелі лишаються у початковому стані.
function renderAll(): void {
  if (party === null) return;
  el('geo-panel').classList.toggle('hidden', ui.mission !== null);
  el('battle-panel').classList.toggle('hidden', ui.mission === null);
  // ADR-0027 (П6.3): у бою колонка стану приглушена й неактивна —
  // джерело стану тоді топбар і контекст-стрічка бою
  el('status').classList.toggle('dimmed', ui.mission !== null);
  panels.renderCampaign();
  panels.renderGeo();
  panels.renderUfos();
  panels.renderFighter();
  panels.renderFinances();
  panels.renderRoster();
  researchPanel.render(); // П11.6: панель «Дослідження» (лише геосцена — кнопки вимкнені в бою)
  workshopPanel.render(); // П11.6: панель «Цех» (лише геосцена — кнопки вимкнені в бою)
  savePanel.render();
  if (ui.mission) battle.renderBattle();
}

// П12.2 (ADR-0065): старт нової партії — єдиний шлях створення партії:
// діалог стартового екрана (сід + складність, ADR-0033) або «Грати знов» на
// екрані перемоги (дефолти 42/«норма», чинний контракт П8.3a). Каркас
// екранів перемикається до рендеру, журнал — як у чинному рестарті.
function startNewParty(seed: number, preset: DifficultyPreset = 'норма'): void {
  battle.close();
  geoAnim.cancel(); // П6.9: нова партія — пульс старої бази не відтворюємо
  party = newParty(seed, preset);
  screens?.showGame();
  renderAll();
  journal('Нова партія (сід ' + seed + ', складність «' + party.campaign.preset + '»). Рухайте час — сенсорна сітка шукає зонди Розриву.');
}

// П12.2 (ADR-0065): «Продовжити» — останній активний слот через API панелі
// збереження (ADR-0026); завантаження приймає партію (adoptLoaded →
// adoptParty) і повертає успіх для переходу на ігровий екран.
function continueGame(): boolean {
  const slot = savePanel.latestSlot();
  if (slot === null) return false;
  savePanel.load(slot); // adoptParty + renderAll + журнал «Завантажено: слот N»
  return party !== null;
}

// пR.2 (ADR-0037): у node-середовищі (vitest) DOM відсутній — ініціалізацію
// керування пропускаємо; юніт-тести модулів — у src/ui/*.test.ts.
if (typeof document !== 'undefined') {
  el('btn-tick').onclick = () => {
    if (!ui.mission) {
      partyTick();
      renderAll();
    }
  };
  el('btn-day').onclick = () => {
    if (!ui.mission) {
      for (let i = 0; i < 48; i++) partyTick();
      renderAll();
    }
  };
  // П8.3: кнопка "Грати знов" для перезапуску кампанії
  // П12.2 (ADR-0065): інпути сіду/пресету мігрували з топбара в діалог
  // нової партії; «Грати знов» — рестарт з дефолтами 42/«норма» (контракт П8.3a)
  el('btn-play-again').onclick = () => startNewParty(42);
  // П8.3a (рішення власника 2026-10-15): endless — «Грати далі» ховає екран
  // перемоги і продовжує партію; зафіксований рахунок не змінюється (campaignTick
  // після «перемога» — no-op), ядро без змін понад П8.2
  el('btn-continue').onclick = () => {
    if (party === null) return; // екран перемоги живе лише в активній грі
    victoryDismissed = true;
    renderAll();
    journal('Перемогу зафіксовано (рахунок ' + party.campaign.score?.total + '). Партію продовжено.', 'win');
  };
  // П4.5 (ADR-0021): найм солдата — списання грошей, новобранець у кінець ростеру
  el('btn-hire').onclick = () => {
    try {
      const p = activeParty();
      const s = hireSoldier(p.econ, p.roster, p.campaign.preset);
      journal('+ Вербування: ' + s.name + ' у ростері', '', 'econ');
      renderAll();
    } catch (e) {
      journal('✗ ' + (e as Error).message, 'lose', 'econ');
    }
  };
  // П12.4 (ADR-0065): вкладки статус-колонки «Загін»/«База»/«Система» —
  // панелі лишаються в DOM (renderAll оновлює їх без змін), активна вкладка
  // запам'ятовується в localStorage поза сейвом (ADR-0026, формат
  // rubezh.settings.*), помилки сховища — тихо. Приглушення в бою — чинний
  // механізм #status.dimmed (П6.3): вкладки живуть у колонці.
  createStatusTabs();
  // П13.2 (ADR-0066): бойові дії — з вертикального тулбара збоку (плитки і
  // іконки будує src/ui/toolbar.ts; стани/причини блокування — renderBattle).
  createToolbar(el('btoolbar'), {
    onAction: (id) => {
      if (id === 'snap' || id === 'aimed' || id === 'auto') input.armFire(id);
      else if (id === 'ow') input.armOverwatch();
      else if (id === 'medkit') input.armMedkit();
      else if (id === 'grenade') input.armGrenade();
      else if (id === 'end') input.endPlayerTurn();
      else if (id === 'demo') demo.battle();
    },
  });
  // ADR-0027: фільтри-вкладки єдиного журналу
  for (const b of document.querySelectorAll<HTMLButtonElement>('#log-tabs button')) {
    b.onclick = () => journalUI.setFilter(b.dataset.filter as LogFilter);
  }
  const bc = el<HTMLCanvasElement>('battle');
  bc.addEventListener('click', input.battleCanvasClick);
  bc.addEventListener('mousemove', input.battleCanvasHover);
  bc.addEventListener('mouseleave', input.battleCanvasLeave);
  // ADR-0027 (П6.4): гарячі клавіші — на document (бій у фокусі канви не потрібен)
  document.addEventListener('keydown', input.onKeyDown);
  // П11.7 (ADR-0059): клік UI — делегований слухач (усі кнопки застосунку);
  // перший звук іде з жесту користувача — AudioContext розблоковується (autoplay).
  document.addEventListener('click', (ev) => {
    if ((ev.target as HTMLElement | null)?.closest('button')) sound.play('click');
  });
  // П12.3 (ADR-0065/0059): тумблер звуку мігрував з топбара у вікно
  // «Налаштування» (settings.ts) — єдине джерело стану залишається
  // аудіо-модуль; підпис «Звук: увімк/вимк» тепер у вікні.
  savePanel.detectStorage();
  // П9.1 (EARS Фази 9): перший візит (усі слоти порожні або сховище недоступне)
  // — показ «Як грати»; кнопка «?» у топбарі відкриває його будь-коли.
  const help = createHelp({
    storageOk: () => savePanel.isStorageOk(),
    slotsEmpty: () => savePanel.slotsEmpty(),
  });
  el('btn-help').onclick = help.open;
  help.maybeShowOnFirstVisit();
  // П12.3 (ADR-0065): вікно «Налаштування» — тумблер звуку мігрував з топбара;
  // стан — аудіо-модуль (ADR-0059), персист поза сейвом (ADR-0026).
  const settings = createSettings({ sound });
  // П12.2 (ADR-0065): каркас екранів — зв'язування з панеллю збереження
  // («Продовжити» — останній активний слот, ADR-0026), «Як грати» (help.ts
  // без змін) і стартом нової партії (сід + складність з діалогу).
  screens = createScreens({
    version: __APP_VERSION__, // ADR-0054: версія — константа зборки (урок П9.1)
    hasSaves: () => savePanel.isStorageOk() && savePanel.latestSlot() !== null,
    continueDisabledReason: () => {
      if (!savePanel.isStorageOk()) return 'Сховище недоступне — збереження вимкнено';
      return savePanel.latestSlot() === null ? 'Немає збережених партій' : '';
    },
    onNewGame: startNewParty,
    onContinue: continueGame,
    onHelp: help.open,
    onSettings: settings.open, // П12.3: зі стартового екрана і з меню гри
    hasUnsavedChanges,
    onExitToStart: () => screens?.showStart(),
  });
  el('btn-menu').onclick = () => screens?.openMenu();
  // ADR-0065: сторінка → стартовий екран; партія не створюється до вибору
  // гравця (журнал старту партії — у startNewParty). Перший візит (П9.1)
  // показує «Як грати» поверх стартового екрана.
  screens.showStart();
  if (!savePanel.isStorageOk()) journal('✗ Сховище недоступне — збереження вимкнено (приватний режим?).', 'lose');
}
