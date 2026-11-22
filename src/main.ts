// src/main.ts
// Превью «Рубіж» — точка входу шару відображення (ADR-0010: ванільний TS +
// Canvas 2D; ADR-0001: браузер; ADR-0007: мінімалістична графіка).
// пR.2 (ADR-0037): тут лише init, partyTick, renderAll і зв'язування модулів
// src/ui/* (auto-battle, save-panel, journal, panels, battle, input) з чистим ядром
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
// П13.3 (ADR-0067): драйвер авто-бою — модуль src/ui/auto-battle.ts
// (переробка демо-драйвера пR.2: «Авто»/«Стоп», політика ядра party-bot).
import { AutoBattleDriver } from './ui/auto-battle';
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
// П14.8 (ADR-0073): ambient-шар — модуль src/ui/ambient.ts.
import { createAmbient } from './ui/ambient';
// пR.2 (ADR-0037): панелі стану і топбара — модуль src/ui/panels.ts; масштаб сітки — src/ui/grid.ts.
import { createPanels, inAirCombat, readyToIssue } from './ui/panels';
import { GCELL } from './ui/grid';
// Т.43: зупинки кнопок часу («До події», «+1 доба») — модуль src/ui/time-control.ts.
import { geoHotkey, isSpaceForEvent, runTime, type RunMode } from './ui/time-control';
// Т.43: рядок «Наступний крок» (Т.80 — у заголовку «Геосцени») — модуль src/ui/next-step.ts.
import { nextStep, renderNextStep, showStepTarget, type StepTarget } from './ui/next-step';
// пR.2 (ADR-0037): бойовище і флоу бою — модуль src/ui/battle.ts.
import { createBattleUI, type BattleUIState } from './ui/battle';
// П13.2 (ADR-0066): вертикальний тулбар бойових дій збоку — модуль src/ui/toolbar.ts.
import { createToolbar } from './ui/toolbar';
import { createInput } from './ui/input';
// П6.7 (ADR-0029): векторні спрайти — чисті функції малювання шару відображення.
// П6.8 (ADR-0029): анімаційний рушій — черга + rAF лише під час активних анімацій.
// пR.3 (ADR-0038): рушій і фабрики анімацій — чиста логіка src/core/render-core.ts;
// фабрика offscreen-канвасів — реєструється в шарі відображення (src/render.ts).
import { initPixelSprites, initGeoMap, initGeoTower, initMetroMap, initMetroTiles, initUnitAtlas } from './render';
import { AnimEngine, geoTrailPoints, makeGeoScanAnim, makeGeoTrailAnim, makeTracerAnim, type Anim } from './core/render-core';
// П5.3 (ADR-0026): партія і слоти збереження — із чистого ядра save.ts.
// П12.2 (ADR-0065): serializeParty — ще й контрольна точка «незбережених
// змін» для підтвердження виходу (той самий детермінований стан, без дублів).
import { createParty, serializeParty, type Party } from './core/save';
import { campaignTick, type DifficultyPreset } from './core/campaign';
// П12.2 (ADR-0065): каркас екранів і навігації — модуль src/ui/screens.ts;
// тут — лише зв'язування з партією, панеллю збереження і «Як грати».
import { createScreens, type Screens } from './ui/screens';
import { createSettings } from './ui/settings';
// П12.4 (ADR-0065): вкладки статус-колонки «Загін»/«База» (Т.128: «Система» — у «Меню») —
// модуль src/ui/status-tabs.ts (панелі в DOM, персист поза сейвом).
import { createStatusTabs, type StatusTabs } from './ui/status-tabs';
import { initPanelFrame } from './ui/panel-frame';
import { decorateIcons, decorateTabButtons } from './ui/tab-icons';

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

// П14.2 (ADR-0072): атлас спрайтів юнітів бою — ліниве завантаження (Image +
// onload → прапорець завантаженості в render.ts). До завантаження і при
// недоступності ассета (headless/офлайн) юніти малюються матрицями ADR-0031 —
// обов'язковий фолбек, тести від ассета не залежать; без rAF-анімацій
// (idle → 0 перерисовок, ADR-0029): наступний природний рендер підхопить атлас.
initUnitAtlas((url, onLoad) => {
  const probe = new Image();
  probe.onload = () => {
    onLoad(probe);
  };
  probe.src = url;
});

// Позафазна лінія «візуальні порівняння» (кандидат «Мегаполіс», крок 2,
// ADR-0072): терен бою — цілісна картина підлоги + згенеровані стіна і
// декори — той самий патерн лінивого завантаження (два джерела: фон
// metro-bg.webp і атлас metro-tiles.png); фолбек при !loaded — чинні
// два тони terrainShade (тести від ассета не залежать, сейви не
// зачіпаються — ADR-0026).
initMetroMap((url, onLoad) => {
  const probe = new Image();
  probe.onload = () => {
    onLoad(probe);
  };
  probe.src = url;
});
initMetroTiles((url, onLoad) => {
  const probe = new Image();
  probe.onload = () => {
    onLoad(probe);
  };
  probe.src = url;
});

// Позафазна лінія «візуальні порівняння» (кандидат А «нічний супутник»):
// фон геосцени — цілісна карта світу geo-map.webp та спрайт бази-радара —
// той самий патерн лінивого завантаження; фолбек — розклад GEO_LAYOUT
// двома тонами (тести від ассета не залежать, сейви не зачіпаються — ADR-0026).
initGeoMap((url, onLoad) => {
  const probe = new Image();
  probe.onload = () => {
    onLoad(probe);
  };
  probe.src = url;
});
initGeoTower((url, onLoad) => {
  const probe = new Image();
  probe.onload = () => {
    onLoad(probe);
  };
  probe.src = url;
});

// П14.6 (ADR-0072): рамка панелей 9-slice (assets/panel-frame.webp) — ліниве
// завантаження, той самий патерн; фолбек при !loaded — чинна кодова рамка
// (CSS у index.html застосовує border-image лише під класом .panel-frame;
// тести від ассета не залежать, сейви не зачіпаються — ADR-0026).
initPanelFrame((url, onLoad) => {
  const probe = new Image();
  probe.onload = () => {
    onLoad();
  };
  probe.src = url;
});

// П11.7 (ADR-0059): звуковий шар — суто відображення: не чіпає стан і
// траєкторії; події бою/геосцени подає drain-контур журналу, точкові
// виклики — кліки UI. Створюється ДО журналу: хуки звуку йдуть у його deps.
const sound = createSound();

// П14.8 (ADR-0073): ambient-шар — обмежені «живі» ефекти відображення
// (пульс стін бою, розгортка радара, мерехтіння вогнів міст, підсвічування
// поранених) з гейтами: тумблер «Анімація» (rubezh.settings.ambient поза
// сейвом, патерн звуку ADR-0059), видимість документа, typeof-rAF (jsdom —
// 0 кадрів, прецедент П6.16), тротлер ≤ 10 fps. Репейнт — активна сцена
// (бій або геосцена); ambient-цикл на стартовому екрані не малює (його анімація — лише CSS, ADR-0116). Створюється
// ДО модулів бою/панелей (deps-об'єкти беруть його за значенням — TDZ),
// сам читає стан лише через ліниві замикання.
const ambient = createAmbient({
  hasRaf: () => hasRaf,
  schedule: (cb) => requestAnimationFrame(cb),
  cancel: (h) => cancelAnimationFrame(h as number),
  now: () => performance.now(),
  visible: () => (typeof document === 'undefined' ? false : document.visibilityState === 'visible'),
  active: () => partyOnScreen,
  repaint: () => {
    if (party === null) return; // партії немає — 0 перерисовок (стартовий екран П12.2)
    if (!el('start-screen').classList.contains('hidden')) return; // П14.7: ambient-цикл стартовий екран не малює (анімація стартового — CSS, ADR-0116)
    if (ui.mission !== null) battle.renderBattle();
    else panels.renderGeo();
  },
});

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
  // Т.72: оперативник — юніт гравця (side === 'player') у бою місії, де є хоча б одна клітинка висадки (evacZone)
  isEvacOperative: (id) => {
    const m = ui.mission;
    if (m === null || m.state.evacZone === undefined || m.state.evacZone.length === 0) return false;
    return m.state.units.some((u) => u.id === id && u.side === 'player');
  },
});
const journal = journalUI.add; // виклики journal(text, cls, cat) у шарі застосунку без змін

// Т.43: вікна поверх гри — поки хоч одне відкрите, пробіл час не рухає.
// Т.128 (ADR-0117): «Збереження» — вікно save-dialog з пункту «Меню» (було вкладкою «Система»)
const OVERLAY_IDS = [
  'help-screen',
  'game-menu',
  'settings-dialog',
  'save-dialog',
  'new-game-dialog',
  'exit-confirm',
  'campaign-victory',
  'evac-confirm',
];
// Т.73: одна перевірка «відкрите вікно» (той самий OVERLAY_IDS, що й в обробнику пробілу нижче)
function overlayOpen(): boolean {
  return OVERLAY_IDS.some((id) => !el(id).classList.contains('hidden'));
}
// Т.73: безпечна кнопка кожного вікна для Esc — у порядку, в якому Esc перебирає вікна (таблиця плану);
// екрана перемоги кампанії (campaign-victory) тут немає — Esc його не закриває
const OVERLAY_ESC_CLOSE: Record<string, string> = {
  'evac-confirm': 'btn-evac-no',
  'exit-confirm': 'btn-exit-no',
  'settings-dialog': 'settings-close',
  'save-dialog': 'btn-save-close',
  'help-screen': 'btn-help-close',
  'game-menu': 'btn-menu-close',
  'new-game-dialog': 'btn-new-game-cancel',
};
// Т.75: елементи, на які Tab ставить фокус (пастка фокусу у вікні)
const FOCUSABLE = 'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])';
let gameOver = false; // банкрутство (ADR-0021): боєготових немає і грошей на найм немає
let partyOnScreen = false; // Т.58: партію показано (не стартовий екран) — лише тоді ambient-цикл стартує
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
// Т.73: кнопка топбара («Меню»/«?»), що відкрила вікно; після закриття вікна фокус повертається на неї
let topbarOpener: HTMLButtonElement | null = null;
function focusTopbarOpener(): void {
  if (topbarOpener === null || overlayOpen() || screens?.current() !== 'гра') return;
  topbarOpener.focus();
}
// Т.7: вкладки статус-колонки — посилання для сигналу дій «Вузла» (renderAll);
// null до ініціалізації DOM (node-середовище тестів модулів).
let statusTabs: StatusTabs | null = null;
let stepTarget: StepTarget | null = null; // Т.79: ціль рядка «Наступний крок» з останнього renderAll
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
    queued: () => anim.queued(), // П14.4: хід ШІ відтворюється поверх фінального стану
  },
  hasRaf: () => hasRaf,
  stopAuto: () => autoBattle.stop(),
  autoBusy: () => autoBattle.busy, // П13.3: підпис плитки «Авто»/«Стоп»
  cancelGeoAnim: () => geoAnim.cancel(),
  ambient, // П14.8: ефекти поверх кадру (гейти — в ambient-модулі)
});

// пR.2 (ADR-0037): ввід тактичного бою (клік/hover/клавіші, зведення режимів,
// дозор, кінець ходу) — модуль src/ui/input.ts; тут — лише зв'язування зі
// станом бою (ui), діями бою (battle) і драйвером авто-бою (П13.3).
const input = createInput(ui, battle, {
  renderAll,
  autoBusy: () => autoBattle.busy,
  confirmLastEvac,
  overlayOpen, // Т.73: замість evacConfirmOpen (Т.71) — клавіші бою не діють під будь-яким вікном
});

// Т.71 (ADR-0075, рішення власника 18.11.2026): вікно підтвердження евакуації останнього оперативника на
// полі — після неї бій закінчиться без премії. Розмітка — як у «Незбережені зміни» (screens.ts).
function confirmLastEvac(name: string, yes: () => void): void {
  const box = el('evac-confirm');
  box.innerHTML =
    '<div class="panel screen-dialog"><h2>Евакуювати останнього?</h2><p id="evac-confirm-text"></p>' +
    '<div class="dialog-actions"><button id="btn-evac-yes">Евакуювати</button><button id="btn-evac-no">Скасувати</button></div></div>';
  el('evac-confirm-text').textContent =
    name + ' — останній оперативник на полі. Місію буде завершено без премії, зонд Розриву лишиться активним.';
  box.classList.remove('hidden');
  el('btn-evac-no').focus(); // Т.71 (аудит): фокус у вікні, а не на плитці під ним
  const close = (go: boolean): void => {
    box.classList.add('hidden');
    box.innerHTML = '';
    if (go) yes();
  };
  el('btn-evac-yes').onclick = () => close(true);
  el('btn-evac-no').onclick = () => close(false);
}

// П6.8 (ADR-0029): анімаційний рушій — черга анімацій, rAF-цикл живе лише
// поки черга непорожня (idle → 0 перерисовок; батарея iPad). Кожен кадр —
// renderBattle з clearRect на весь buffer (урок П6.6). rAF може бути
// відсутній у тестовому середовищі — тоді анімації не ставляться в чергу
// (стан і лог бою від анімації не залежать — критерій «байт-у-байт»).
const hasRaf = typeof requestAnimationFrame === 'function';

// П13.3 (ADR-0067): покроковий драйвер авто-бою — стан і таймери в
// src/ui/auto-battle.ts; тут лише зв'язування з місією, анімаціями та
// відображення. «Авто» вмикається з будь-якого моменту бою, «Стоп»
// завершує поточну дію і повертає керування гравцю.
const autoBattle = new AutoBattleDriver({
  getMission: () => ui.mission,
  battleFinished: () => ui.battleResult !== null,
  renderBattle: () => battle.renderBattle(),
  renderAll,
  binfo: battle.binfo,
  finishBattle: battle.finish,
  pushAnims: (anims) => anim.push(...anims),
  onStart: () => input.disarm(), // Т.46: зведений постріл чи витратник авто-бій знімає
  hasRaf,
  visibleCells: battle.visibleCells, // П14.4: туман для чисел пошкоджень авто-бою
  onAlienTurn: (from) => battle.autoAlienTurn(from), // Т.116: плашка і підсумок ходу демонів в авто-бої
  onStop: () => battle.autoStopped(),
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
  // Т.128 (рішення власника): успішне «Завантажити» закриває вікно — видно завантажену гру
  onLoaded: () => {
    el('save-dialog').classList.add('hidden');
    focusTopbarOpener();
  },
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
  // Т.58: на стартовому екрані екран перемоги не показуємо — і коли невдале «Продовжити» перемальовує панелі
  victoryDismissed: () => victoryDismissed || !partyOnScreen,
  ambient, // П14.8: ефекти поверх кадру геосцени (ADR-0073)
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
  // T.39: смуга кроків панелі «Дослідження» — чиста навігація (стан гри не змінюється)
  scrollToResearch: () => el('research').scrollIntoView({ block: 'nearest' }),
  scrollToWorkshop: () => el('workshop').scrollIntoView({ block: 'nearest' }),
  showSquadTab: () => statusTabs?.set('squad'),
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
  onIdle: () => autoBattle.onAnimIdle(), // П13.3: анімації дії відтворені — пауза і наступна дія авто-бою
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
  partyOnScreen = true; // Т.58: до ambient.start — гейт active
  ambient.start(); // П14.8: партія активна — ambient-цикл (гейти всередині; стартовий екран репейнт пропускає)
  return p;
}

function newParty(seed: number, preset: DifficultyPreset = 'норма'): Party {
  return adoptParty(createParty(seed, preset));
}

function unitName(id: string): string {
  // Т.75: евакуйований уже поза units (evacuate спершу знімає його з поля) — ім'я шукаємо й у evacuated
  const st = ui.mission?.state;
  const u = st?.units.find((x) => x.id === id) ?? st?.evacuated?.find((x) => x.id === id);
  return u ? u.name : id;
}

// Geo-події → журнал: перетворювач і seen-трекінг — у src/ui/journal.ts (пR.2).

// П7.5 (ADR-0032): подія перехоплення → анімації геосцени. Трасер винищувача — холодний
// блакит (колір гравця), трасер НЛО — розпечений оранж (колір прибульців); куля летить
// між поточними позиціями винищувача і НЛО у клітинках геосцени (GCELL задає drawAnimFrame).
// Промахи не анімуємо (лише влучання — спалах удару), відступ/ремонт — без анімацій.
// П14.5: intercept_move → хвіст траєкторії винищувача (лінія останніх позицій
// з подій intercept_move у логу — лог лише читається, geo.rng не витягується);
// дублікат хвоста в черзі (кроки одного тіку дають однакові точки) — coalesce.
function interceptAnims(e: InterceptEvent): Anim[] {
  if (party === null) return []; // П12.2: події геосцени — лише в активній грі
  if (e.type === 'intercept_move') {
    const points = geoTrailPoints(party.geo.log);
    const queued = geoAnim.queued();
    const last = queued[queued.length - 1];
    const same =
      last !== undefined &&
      last.kind === 'gtrail' &&
      last.points.length === points.length &&
      last.points.every((p, i) => p.x === points[i]?.x && p.y === points[i]?.y);
    if (same) return [];
    return [makeGeoTrailAnim(points)];
  }
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
// Т.16: у повітряному бою час геосцени теж заморожено — тік нічого не робить
// (і «+1 доба», що почалась до зустрічі, решту тіків не рахує).
function partyTick(): void {
  if (party === null || inAirCombat(party)) return;
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
  // П6.9 (ADR-0029): скан-радар на тік часу — серія тіків (доба) дає один
  // цикл розгортки (coalesce за busy), idle → 0 перерисовок. Лише візуальний
  // ефект (П14.5: сектор + кільця замість кільця П6.9; туман не розкривається).
  if (hasRaf && !geoAnim.busy) {
    const b = p.geo.base;
    geoAnim.push(makeGeoScanAnim(b.x * GCELL + GCELL / 2, b.y * GCELL + GCELL / 2, (RADAR_RANGE + 0.5) * GCELL));
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
  // Т.32: розкладка бою (index.html) — колонку вузла сховано, поле вписане у вікно
  el('layout').classList.toggle('in-battle', ui.mission !== null);
  // Т.43: одна порада за станом партії; у бою і після кінця гри рядок прихований
  const step = nextStep(party, { inBattle: ui.mission !== null, gameOver });
  stepTarget = step?.target ?? null; // Т.79: куди веде клік по рядку
  renderNextStep(el('next-step'), step?.text ?? null); // Т.97: префікс окремим span
  panels.renderCampaign();
  panels.renderGeo();
  panels.renderUfos();
  panels.renderFighter();
  panels.renderFinances();
  panels.renderRoster();
  researchPanel.render(); // П11.6: панель «Дослідження» (лише геосцена — кнопки вимкнені в бою)
  workshopPanel.render(); // П11.6: панель «Цех» (лише геосцена — кнопки вимкнені в бою)
  savePanel.render();
  // Т.7: сигнал на вкладці «Вузол» — скільки дій чекає там гравця
  statusTabs?.setAttention('base', panels.nodeActions());
  // T.39: сигнал на вкладці «Загін» — скільки предметів зі складу можна видати зараз;
  // 0 за тієї самої умови busy, що вимикає кнопки видачі в renderRoster (panels.ts):
  // deps.inBattle() || deps.isGameOver() тут тотожне (ui.mission !== null || gameOver)
  statusTabs?.setAttention('squad', ui.mission !== null || gameOver ? 0 : readyToIssue(party));
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
  // Т.47: з бою теж можна вийти на стартовий екран — старий бій закриваємо, як у
  // startNewParty: інакше завантаження мовчки не відбувається (панель у бою не вантажить)
  battle.close();
  geoAnim.cancel(); // Т.48: як у startNewParty — анімації покинутої партії поверх завантаженої не відтворюємо
  const before = party;
  savePanel.load(slot); // adoptParty + renderAll + журнал «Завантажено: слот N»
  // Т.48: невдале завантаження (слот не розібрано) партії не міняє — лишаємось на
  // стартовому екрані, а не показуємо геосцену покинутої партії
  return party !== null && party !== before;
}

// Т.48 (рішення власника 16.11.2026 «Зупиняти все»): вихід на стартовий екран зупиняє
// авто-бій, закриває бій і скидає анімації геосцени; назад у партію — лише «Продовжити»
// із сейву. На геосцені бою немає — close не кличемо (вихід без перерисовок, критерій П12.2);
// вихід із бою геосцену перемальовує (close → renderAll). Ambient-цикл стає на паузу до
// наступної партії (adoptParty → ambient.start).
function exitToStart(): void {
  if (ui.mission !== null) battle.close();
  geoAnim.cancel();
  partyOnScreen = false; // Т.58: повернення вкладки з фону і тумблер налаштувань ambient на стартовому екрані не будять
  ambient.pause();
  el('campaign-victory').classList.add('hidden'); // Т.58: вихід з екрана перемоги — екран не лишається поверх стартового
  screens?.showStart();
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
  // Т.43 (рішення власника 15.11.2026): «+1 доба» зупиняється на виявленні й
  // приземленні зонда, «До події» — на всіх шести подіях (src/ui/time-control.ts).
  const runClock = (mode: RunMode): void => {
    if (ui.mission || party === null) return;
    const p = party;
    runTime(mode, p, partyTick, () => ui.mission !== null || gameOver || inAirCombat(p));
    renderAll();
  };
  el('btn-day').onclick = () => runClock('day');
  el('btn-event').onclick = () => runClock('event');
  // Пробіл на геосцені = «До події»: кнопка активна, поверх гри немає вікна чи стартового екрана.
  // Т.98: D / T / N — «+1 доба», «+1 тік», «Наступний крок» з тими самими умовами, поза боєм.
  // Фокус «з клавіатури» — після Tab чи N до наступного натискання мишею чи пальцем.
  let keyboardFocus = false;
  document.addEventListener('pointerdown', () => (keyboardFocus = false), true);
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Tab') keyboardFocus = true;
    const hotkey = geoHotkey(ev);
    if (hotkey === null && !isSpaceForEvent(ev, keyboardFocus)) return;
    if (party === null || screens?.current() !== 'гра') return;
    if (overlayOpen()) return; // Т.43; Т.73: та сама перевірка overlayOpen()
    if (hotkey !== null) {
      if (ui.mission) return;
      const target = el<HTMLButtonElement>(hotkey === 'day' ? 'btn-day' : hotkey === 'tick' ? 'btn-tick' : 'next-step');
      if (target.disabled || target.classList.contains('hidden')) return;
      ev.preventDefault();
      const before = document.activeElement;
      target.click();
      // фокус перейшов на кнопку дії з клавіатури; ціль не знайдено — прапорець не чіпати
      if (hotkey === 'next' && document.activeElement !== before) keyboardFocus = true;
      return;
    }
    const b = el<HTMLButtonElement>('btn-event');
    if (b.disabled) return;
    ev.preventDefault();
    // фокус на кнопці (після кліку мишею): зняти, щоб відпускання пробілу її не натисло
    if (ev.target instanceof HTMLButtonElement) ev.target.blur();
    b.click();
  });
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
  // Т.58 (рішення власника 17.11.2026 «Третя кнопка»): вихід з екрана перемоги — той самий шлях, що «На стартовий екран» у меню
  el('btn-victory-exit').onclick = () => screens?.requestExit();
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
  // П12.4 (ADR-0065): вкладки статус-колонки «Загін»/«База» (Т.128: без «Системи») —
  // панелі лишаються в DOM (renderAll оновлює їх без змін), активна вкладка
  // запам'ятовується в localStorage поза сейвом (ADR-0026, формат
  // rubezh.settings.*), помилки сховища — тихо. Приглушення в бою — чинний
  // механізм #status.dimmed (П6.3): вкладки живуть у колонці.
  statusTabs = createStatusTabs();
  // Т.79: клік по рядку «Наступний крок» показує кнопку дії (вкладка, прокрутка, підсвітка, фокус)
  el('next-step').onclick = () => {
    if (stepTarget !== null) showStepTarget(stepTarget, (id) => statusTabs?.set(id));
  };
  // П14.6 (ADR-0072): іконки вкладок («Загін»/«Вузол» статус-колонки
  // і фільтри журналу) — векторні, з src/ui/icons.ts (Т.123, ADR-0114), узгоджені
  // з тулбаром; svg перед текстом, контракти кнопок не змінюються.
  decorateTabButtons();
  decorateIcons(); // Т.128 (ADR-0117): заголовки панелей і вікна «Збереження» (data-icon)
  // П13.2 (ADR-0066): бойові дії — з вертикального тулбара збоку (плитки і
  // іконки будує src/ui/toolbar.ts; стани/причини блокування — renderBattle).
  createToolbar(el('btoolbar'), {
    onAction: (id) => {
      if (overlayOpen()) return; // Т.73: під відкритим вікном плитки тулбара не діють (було evac-confirm у Т.71)
      // Т.33: дія гравця прибирає підсумок ходу демонів; «Авто» — і плашку; Т.116: «Стоп» підсумок лишає (до першої дії)
      if (id !== 'auto-battle') battle.dismissTurnPlate();
      else if (!autoBattle.busy) battle.dismissTurnPlate(true);
      if (id === 'snap' || id === 'aimed' || id === 'auto') input.armFire(id);
      else if (id === 'ow') input.armOverwatch();
      else if (id === 'medkit') input.armMedkit();
      else if (id === 'grenade') input.armGrenade();
      else if (id === 'evac')
        input.evacuateSelected(); // Т.71 (ADR-0075)
      else if (id === 'end') input.endPlayerTurn();
      // П13.3 (ADR-0067): «Авто»/«Стоп» — після зупинки драйвера плитка
      // оновлює підпис («Стоп» → «Авто») одразу; старт оновлює сам (крок).
      else if (id === 'auto-battle') {
        autoBattle.toggle();
        battle.renderBattle();
      }
    },
  });
  // ADR-0027: фільтри-вкладки єдиного журналу
  for (const b of document.querySelectorAll<HTMLButtonElement>('#log-tabs button')) {
    b.onclick = () => journalUI.setFilter(b.dataset.filter as LogFilter);
  }
  // Т.31: журнал-смуга розгортається поверх карти і згортається тією ж кнопкою
  const logExpand = el('btn-log-expand');
  logExpand.onclick = () => {
    const open = el('journal').classList.toggle('expanded');
    logExpand.textContent = open ? 'Згорнути' : 'Розгорнути';
    logExpand.setAttribute('aria-expanded', String(open));
  };
  const bc = el<HTMLCanvasElement>('battle');
  // Т.33: до обробника кліку; Т.116: під час авто-бою клік підсумок не прибирає
  bc.addEventListener('click', (ev) => {
    if (autoBattle.busy) return;
    // Т.117: клік під час плашки «діють» лише пропускає анімації ходу демонів — до обробника поля не доходить
    if (battle.skipAlienTurn()) ev.stopImmediatePropagation();
    else battle.dismissTurnPlate();
  });
  bc.addEventListener('click', input.battleCanvasClick);
  // Т.117 (аудит): підпис «Клік / пробіл / Esc — пропустити» стоїть на самій плашці — клік по ній теж пропускає
  el('bturn').addEventListener('click', () => {
    if (!autoBattle.busy) battle.skipAlienTurn();
  });
  bc.addEventListener('mousemove', input.battleCanvasHover);
  bc.addEventListener('mouseleave', input.battleCanvasLeave);
  // ADR-0027 (П6.4): гарячі клавіші — на document (бій у фокусі канви не потрібен)
  document.addEventListener('keydown', input.onKeyDown);
  // Т.73: Esc закриває відкрите вікно натисканням його безпечної кнопки. Слухач — ПІСЛЯ input.onKeyDown:
  // тоді onKeyDown бачить вікно ще відкритим і цей самий Esc не скасовує вибір чи зведений режим під вікном
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    for (const id of Object.keys(OVERLAY_ESC_CLOSE)) {
      if (!el(id).classList.contains('hidden')) {
        el<HTMLButtonElement>(OVERLAY_ESC_CLOSE[id]).click();
        return;
      }
    }
  });
  // Т.75: пастка фокусу — Tab і Shift+Tab ходять по колу всередині відкритого вікна (вікно — за порядком Esc)
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Tab') return;
    const box = [...Object.keys(OVERLAY_ESC_CLOSE), 'campaign-victory'].map((id) => el(id)).find((o) => !o.classList.contains('hidden'));
    if (box === undefined) return;
    const items = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (e) => !(e as HTMLButtonElement).disabled && !e.hidden && e.closest('.hidden') === null
    );
    const i = items.indexOf(document.activeElement as HTMLElement);
    const edge = ev.shiftKey ? i <= 0 : i === -1 || i === items.length - 1;
    if (!edge) return; // всередині вікна — звичайний Tab браузера
    ev.preventDefault();
    if (items.length > 0) items[ev.shiftKey ? items.length - 1 : 0].focus();
  });
  // П11.7 (ADR-0059): клік UI — делегований слухач (усі кнопки застосунку);
  // перший звук іде з жесту користувача — AudioContext розблоковується (autoplay).
  document.addEventListener('click', (ev) => {
    if ((ev.target as HTMLElement | null)?.closest('button')) sound.play('click');
  });
  // П14.8 (ADR-0073): гейт видимості — у фоні 0 перерисовок: планування
  // знімаємо самі (не сподіваємось на тротлинг rAF браузера); повернення
  // видимості поновлює цикл, якщо тумблер увімкнено.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) ambient.pause();
    else ambient.resume();
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
  // Т.53 (рішення власника 16.11.2026 «Зупиняти»): вікно поверх бою зупиняє авто-бій, як «Стоп»
  const stopAutoForWindow = (): void => {
    if (!autoBattle.busy) return;
    autoBattle.stop();
    battle.renderBattle();
  };
  el('btn-help').onclick = () => {
    topbarOpener = el<HTMLButtonElement>('btn-help'); // Т.73: запам'ятати кнопку топбара, що відкрила вікно
    stopAutoForWindow();
    help.open();
  };
  help.maybeShowOnFirstVisit();
  // П12.3 (ADR-0065): вікно «Налаштування» — тумблер звуку мігрував з топбара;
  // стан — аудіо-модуль (ADR-0059), персист поза сейвом (ADR-0026).
  // П14.8 (ADR-0073): секція «Анімація» — тумблер ambient (ambient-модуль —
  // єдине джерело стану; перемикання зупиняє/поновлює цикл без перезапуску).
  // Т.126 (ADR-0116): анімація стартового екрана (CSS) — той самий тумблер «Анімація»:
  // вимкнено — клас anim-off на #start-screen; синхронізація на старті і після перемикання.
  const syncStartAnim = (): void => {
    document.getElementById('start-screen')?.classList.toggle('anim-off', !ambient.enabled());
  };
  syncStartAnim();
  const settings = createSettings({
    sound,
    ambient: {
      enabled: () => ambient.enabled(),
      toggle: () => {
        const on = ambient.toggle();
        syncStartAnim();
        return on;
      },
    },
  });
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
    // Т.128 (ADR-0117): вікно «Збереження» з меню — слоти на момент відкриття, фокус на «Закрити» (правила Т.73)
    onSave: () => {
      savePanel.render();
      el('save-dialog').classList.remove('hidden');
      el<HTMLButtonElement>('btn-save-close').focus();
    },
    hasUnsavedChanges,
    onExitToStart: exitToStart,
  });
  el('btn-menu').onclick = () => {
    topbarOpener = el<HTMLButtonElement>('btn-menu'); // Т.73: запам'ятати кнопку топбара, що відкрила вікно
    stopAutoForWindow();
    screens?.openMenu();
  };
  // Т.73: після закриття вікна кнопками «Закрити»/«Скасувати» (Esc натискає ті самі кнопки через .click()) —
  // фокус на кнопку топбара, що відкрила вікно. addEventListener — після створення модулів: їхні onclick
  // спершу закривають вікно, і лише потім цей слухач повертає фокус (коли відкритих вікон немає і показано екран гри)
  el('btn-save-close').onclick = () => el('save-dialog').classList.add('hidden'); // Т.128
  decorateIcons(el('game-menu')); // Т.128: іконка пункту «Збереження»
  for (const closeId of ['btn-menu-close', 'btn-exit-no', 'settings-close', 'btn-help-close', 'btn-save-close']) {
    el(closeId).addEventListener('click', focusTopbarOpener);
  }
  // ADR-0065: сторінка → стартовий екран; партія не створюється до вибору
  // гравця (журнал старту партії — у startNewParty). Перший візит (П9.1)
  // показує «Як грати» поверх стартового екрана.
  screens.showStart();
  if (!savePanel.isStorageOk()) journal('✗ Сховище недоступне — збереження вимкнено (приватний режим?).', 'lose');
}
