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
import { interceptTick, repairTick, type InterceptEvent } from './core/intercept';
// пR.2 (ADR-0037): модулі шару UI — демо-драйвер, DOM-хелпер, панель збереження, журнал подій.
import { DemoDriver } from './ui/demo';
import { el } from './ui/dom';
import { createSavePanel } from './ui/save-panel';
import { createJournal, type LogFilter } from './ui/journal';
// пR.2 (ADR-0037): панелі стану і топбара — модуль src/ui/panels.ts; масштаб сітки — src/ui/grid.ts.
import { createPanels } from './ui/panels';
import { GCELL } from './ui/grid';
// пR.2 (ADR-0037): бойовище і флоу бою — модуль src/ui/battle.ts.
import { createBattleUI, type BattleUIState } from './ui/battle';
import { createInput } from './ui/input';
// П6.7 (ADR-0029): векторні спрайти — чисті функції малювання шару відображення.
// П6.8 (ADR-0029): анімаційний рушій — черга + rAF лише під час активних анімацій.
import { AnimEngine, initPixelSprites, makeGeoPulseAnim, makeTracerAnim, type Anim } from './render';
// П5.3 (ADR-0026): партія і слоти збереження — із чистого ядра save.ts.
import { createParty, type Party } from './core/save';
import { campaignTick } from './core/campaign';

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

// Порядок оголошень важливий (TDZ — див. docs/workflow.md): усі змінні стану,
// які newParty() чи обробники пишуть, оголошуються ДО першого виклику newParty().
// пR.2 (ADR-0037): журнал подій (категорії і фільтри-вкладки — ADR-0027,
// EventText-перетворювачі, seen-трекінг подій) — модуль src/ui/journal.ts;
// тут — лише зв'язування зі станом застосунку (party/mission) і анімаціями
// перехоплення (П7.5). Створюється ДО newParty(42): adoptParty звідти
// використовує journal.adopt (урок TDZ — див. docs/workflow.md).
const journalUI = createJournal({
  geoLog: () => party.geo.log,
  econLog: () => party.econ.log,
  battleLog: () => (ui.mission ? ui.mission.state.log : null),
  unitName,
  onGeoEvent: (e) => {
    if (hasRaf) geoAnim.push(...interceptAnims(e as InterceptEvent));
  },
});
const journal = journalUI.add; // виклики journal(text, cls, cat) у шарі застосунку без змін

let gameOver = false; // банкрутство (ADR-0021): боєготових немає і грошей на найм немає
let party: Party = newParty(42);
// пR.2 (ADR-0037): стан бою — явний об'єкт замість модульних let (мітигація
// плану рефакторингу); ним спільно користуються модуль бою (src/ui/battle.ts)
// і обробники вводу (нижче). Порядок оголошень — TDZ, див. docs/workflow.md.
const ui: BattleUIState = {
  mission: null,
  battleResult: null,
  selectedId: null, // вибраний солдат
  fireMode: null, // «зведений» режим пострілу
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
  getParty: () => party,
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
  getParty: () => party,
  adoptLoaded: (p) => {
    party = adoptParty(p);
  },
  inBattle: () => ui.mission !== null,
  interceptBusy: () => party.intercept.fighter.status === 'погоня' || party.intercept.fighter.status === 'бій',
  isGameOver: () => gameOver,
  journal,
  renderAll,
});

// пR.2 (ADR-0037): панелі стану і топбара (геосцена, сканери НЛО, винищувач,
// фінанси, ростер, чипи кампанії, екран перемоги) — модуль src/ui/panels.ts;
// тут — лише зв'язування зі станом застосунку (party/mission/gameOver),
// журналом (drain*), анімацією геосцени (пульс радара) і запуском місії.
const panels = createPanels({
  getParty: () => party,
  inBattle: () => ui.mission !== null,
  isGameOver: () => gameOver,
  journal,
  renderAll,
  launchMission: battle.launch,
  drainGeo: () => journalUI.drainGeo(),
  drainEcon: () => journalUI.drainEcon(),
  activeGeoAnim: () => geoAnim.active(),
  geoAnimNow: () => geoAnim.now,
});

const anim = new AnimEngine({
  schedule: (cb) => requestAnimationFrame(cb),
  cancel: (h) => cancelAnimationFrame(h as number),
  draw: () => battle.renderBattle(),
  onIdle: () => demo.onAnimIdle(), // П6.16: анімації дії демо відтворені — пауза і наступна дія
});
// П6.9 (ADR-0029): пульс радара геосцени — той самий рушій (черга + rAF лише
// під час активних анімацій, idle → 0 перерисовок), окремий інстанс зі своєю
// перерисовкою renderGeo. Суто візуальний: geo.rng не чіпається, траєкторія
// геосцени незмінна; туман — невиявлені НЛО у кадр не потрапляють (ADR-0006).
const geoAnim = new AnimEngine({
  schedule: (cb) => requestAnimationFrame(cb),
  cancel: (h) => cancelAnimationFrame(h as number),
  draw: () => panels.renderGeo(),
});

// Прийняти партію у UI-шар: seen-трекінг журналу — у модулі journal (історію
// не відтворюємо — лише нові події після точки входу, трекінг НЛО з логу —
// ADR-0006), банкрутство перераховуємо тут (ADR-0021). Спільно для нової
// і завантаженої партії.
function adoptParty(p: Party): Party {
  journalUI.adopt(p);
  gameOver = isBankrupt(p.econ, p.roster);
  return p;
}

function newParty(seed: number): Party {
  return adoptParty(createParty(seed));
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
  if (e.type !== 'intercept_round' || e.choice === 'відступ') return [];
  const ufo = party.geo.ufos.find((u) => u.id === party.intercept.activeUfoId);
  if (!ufo) return [];
  const fpos = party.intercept.fighter.pos;
  const anims: Anim[] = [];
  if (e.fighterHit) anims.push(makeTracerAnim('player', { ...fpos }, { ...ufo.pos }, true));
  if (e.ufoHit) anims.push(makeTracerAnim('alien', { ...ufo.pos }, { ...fpos }, true));
  return anims;
}

// Події економіки → журнал: перетворювач і seen-трекінг — у src/ui/journal.ts (пR.2).

// П4.5 (ADR-0021): один тік часу партії — геосцена + дотація + лікарня +
// перевірка банкрутства. Викликати лише поза бою (час геосцени заморожено).
function partyTick(): void {
  advanceTime(party.geo, 1);
  economyTick(party.econ, party.geo);
  hospitalTick(party.roster);
  // П7.4 (ADR-0032): погоня й ремонт живуть тіками геосцени разом з партією
  interceptTick(party.intercept, party.geo);
  repairTick(party.intercept, party.geo);
  // П6.9 (ADR-0029): пульс радара на тік часу — серія тіків (доба) дає один
  // пульс (coalesce за busy), idle → 0 перерисовок. Лише візуальний ефект.
  if (hasRaf && !geoAnim.busy) {
    const b = party.geo.base;
    geoAnim.push(makeGeoPulseAnim(b.x * GCELL + GCELL / 2, b.y * GCELL + GCELL / 2, (RADAR_RANGE + 0.5) * GCELL));
  }
  if (!gameOver && isBankrupt(party.econ, party.roster)) {
    gameOver = true;
    journal('✗ Банкрутство: немає боєготових солдатів і грошей на найм — партію програно.', 'lose', 'econ');
  }

  // П8.3: перевірка кампанії на межі 30-ї доби
  campaignTick({ geo: party.geo, roster: party.roster, econ: party.econ }, party.campaign);
}

// --- пR.2 (ADR-0037): панелі стану і топбара — модуль src/ui/panels.ts ---

// --- П5.3: панель збереження (ADR-0026) — модуль src/ui/save-panel.ts (пR.2) ---

// --- тактичний бій (5.3) ---

// ADR-0027: фокусна зона — геосцена або бій (не «два екрани»); чипи кампанії
// і панелі — модуль panels, рендер бойовища — модуль battle (пR.2).
function renderAll(): void {
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
  savePanel.render();
  if (ui.mission) battle.renderBattle();
}

function restart(): void {
  battle.close();
  geoAnim.cancel(); // П6.9: нова партія — пульс старої бази не відтворюємо
  const seed = Number(el<HTMLInputElement>('seed').value) || 42;
  party = newParty(seed);
  renderAll();
  journal('Нова партія (сід ' + seed + '). Рухайте час — радар шукає НЛО.');
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
  el('btn-new').onclick = restart;
  // П8.3: кнопка "Грати знов" для перезапуску кампанії
  el('btn-play-again').onclick = () => restart();
  // П4.5 (ADR-0021): найм солдата — списання грошей, новобранець у кінець ростеру
  el('btn-hire').onclick = () => {
    try {
      const s = hireSoldier(party.econ, party.roster);
      journal('+ Найм: ' + s.name + ' у ростері', '', 'econ');
      renderAll();
    } catch (e) {
      journal('✗ ' + (e as Error).message, 'lose', 'econ');
    }
  };
  el('btn-snap').onclick = () => input.armFire('snap');
  el('btn-aimed').onclick = () => input.armFire('aimed');
  el('btn-auto').onclick = () => input.armFire('auto');
  el('btn-ow').onclick = input.armOverwatch;
  el('btn-end').onclick = input.endPlayerTurn;
  el('btn-demo').onclick = () => demo.battle();
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
  savePanel.detectStorage();
  renderAll();
  journal('Партію розпочато. Рухайте час — радар шукає НЛО.');
  if (!savePanel.isStorageOk()) journal('✗ Сховище недоступне — збереження вимкнено (приватний режим?).', 'lose');
}
