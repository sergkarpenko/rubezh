// src/main.ts
// Превью «Рубіж» (ванільний TS + Canvas 2D — цільова архітектура).
// ADR-0001: Цільова платформа — браузер
// ADR-0007: Мінімалістична графіка
// ADR-0009: Онлайн-превью через GitHub Pages
// ADR-0010: Цільовий UI — ванільний TS + Canvas 2D (не React)
//
// Тут лише відображення і керування; уся логіка — виклики чистого ядра (src/core):
// geo (час, НЛО, радар) + mission (бій) + squad (ростер, перма-смерть).
// Ітерація 5.3: тактичний бій — ІНТЕРАКТИВНИЙ (замість авто-ботів ітерації P):
// вибір солдата, клік-рух по шляху (A* + pathApCost), постріл у вибраному режимі,
// дозор, кінець ходу → синхронний хід прибульців (патерн 5.1.4, без таймерів).
// Авто-боти (src/bot.ts) лишились як кнопка «Демо-бій».
//
// Фаза 2 (П7): чисті шматки «візуальної логіки» (cellFromPoint, samePath,
// hpColor, geoEventText, battleEventText) експортуються для юніт-тестів
// (src/main.test.ts); DOM-ініціалізація — лише у браузері (typeof document).
//
// Фаза 4 (П4.5): економіка і лікарня (ADR-0021) — баланс і надходження
// в панелі «Фінанси», кнопка найму, статус поранених у ростері
// («лікарня: N тіків»); тік часу = geoTick + economyTick + hospitalTick,
// банкрутство фіксується на тіку геосцени (кнопки блокуються).
// Фаза 5 (П5.3, ADR-0026): панель збереження — 3 слоти (зберегти/
// завантажити/видалити), активна лише на геосцені (місія не переривається);
// сховище — localStorage через адаптер SlotStore (ядро без DOM — save.ts).
// Фаза 6a (П6.2, ADR-0027): єдиний каркас — топбар (годинник, сід, чипи
// балансу і боєготових, кнопки часу), фокусна зона (геосцена або бій),
// колонка стану (сканери, фінанси, ростер, збереження), журнал з фільтрами-
// вкладками (геосцена/економіка/бій). Дублювання балансу чипом і карткою —
// свідомо прийнято (ADR-0027).
// Фаза 6a (П6.3, ADR-0027): бойова фокусна зона — контекст-стрічка (тип
// місії, заморожений час, чий хід, активний юніт HP/AP), панель керування
// під бойовищем, колонка стану в бою приглушена й неактивна (клас dimmed);
// збереження лише на геосцені (ADR-0026).
// Фаза 6a (П6.4, ADR-0027): керування — гарячі клавіші 1/2/3/O/E/Esc
// (ігноруються у полях вводу; Esc — спершу режим пострілу, потім вибір)
// і тач-патерн руху «тап — прев'ю шляху, повторний тап у ту саму
// клітинку — хід»; той самий патерн для мишки (click). Ядро без змін.

import { RADAR_RANGE, advanceTime } from './core/geo';
import { hireSoldier, hospitalTick, isBankrupt } from './core/squad';
import { economyTick } from './core/economy';
import { interceptTick, repairTick, type InterceptEvent } from './core/intercept';
import {
  OVERWATCH_AP_COST,
  calculateHitChance,
  distance,
  endTurn,
  hasLineOfSight,
  moveUnit,
  resolveAttack,
  setOverwatch,
  type ShotMode,
  type Vec2,
} from './core/combat';
import { findPath, pathApCost } from './core/map';
import { aliensTurn } from './bot';
// пR.2 (ADR-0037): модулі шару UI — демо-драйвер, DOM-хелпер, панель збереження, журнал подій.
import { DemoDriver } from './ui/demo';
import { el } from './ui/dom';
import { createSavePanel } from './ui/save-panel';
import { createJournal, MODE_LABEL, type LogFilter } from './ui/journal';
// пR.2 (ADR-0037): панелі стану і топбара — модуль src/ui/panels.ts; масштаб сітки — src/ui/grid.ts.
import { createPanels } from './ui/panels';
import { BCELL, GCELL } from './ui/grid';
// пR.2 (ADR-0037): бойовище і флоу бою — модуль src/ui/battle.ts.
import { createBattleUI, type BattleUIState } from './ui/battle';
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

// П7: чиста частина cellFromEvent — координати вікна (CSS) → клітинка бойовища
// (buffer-розмір канви / BCELL); rect — getBoundingClientRect канви.
export function cellFromPoint(
  cx: number,
  cy: number,
  rect: { left: number; top: number; width: number; height: number },
  canvas: { width: number; height: number }
): Vec2 {
  return {
    x: Math.floor((((cx - rect.left) / rect.width) * canvas.width) / BCELL),
    y: Math.floor((((cy - rect.top) / rect.height) * canvas.height) / BCELL),
  };
}

function cellFromEvent(ev: MouseEvent): Vec2 {
  const cv = el<HTMLCanvasElement>('battle');
  return cellFromPoint(ev.clientX, ev.clientY, cv.getBoundingClientRect(), cv);
}

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

function battleCanvasClick(ev: MouseEvent): void {
  if (!battle.playerTurnActive() || !ui.mission) return;
  if (demo.busy) return; // П6.16: триває демо — бойовище не клікається
  const st = ui.mission.state;
  const cell = cellFromEvent(ev);
  const u = st.units.find((x) => x.alive && x.pos.x === cell.x && x.pos.y === cell.y);

  if (u && u.side === 'player') {
    // вибір свого солдата
    ui.selectedId = u.id;
    ui.fireMode = null;
    ui.hoverPath = null;
    ui.tapCell = null;
    ui.aimCell = null; // П6.14
    battle.binfo(
      u.name + ': HP ' + u.hp + '/' + u.maxHp + ' · AP ' + u.ap + '/' + u.maxAp + '. Клікніть клітинку — рух, або кнопку пострілу.'
    );
    renderAll();
    return;
  }

  const sel = battle.selectedUnit();
  if (!sel) {
    battle.binfo('Спершу клікніть свого солдата (синє коло).');
    return;
  }

  if (u && u.side === 'alien') {
    const vis = battle.visibleCells();
    if (!vis.has(cell.x + ',' + cell.y)) {
      battle.binfo('Там нікого не видно (туман війни).');
      return;
    }
    if (!ui.fireMode) {
      battle.binfo('Виберіть режим пострілу (кнопка зліва), потім клікніть видимого прибульця.');
      return;
    }
    // П6.14: причини невалідної цілі — ті самі перевірки, що й assertCanFire ядра
    if (distance(sel.pos, u.pos) > sel.weapon.range) {
      battle.binfo('Ціль поза дальністю зброї (' + sel.weapon.range + ' клітинок).');
      return;
    }
    if (!hasLineOfSight(st, sel.pos, u.pos)) {
      battle.binfo('Немає лінії вогню до цілі.');
      return;
    }
    // П6.14: тап-тап і для пострілу (дзеркало руху П6.4): перший тап — шанс
    // попадання біля клітинки, повторний тап у ту саму ціль — постріл.
    if (ui.tapCell === null || ui.tapCell.x !== cell.x || ui.tapCell.y !== cell.y) {
      ui.tapCell = cell;
      ui.aimCell = cell;
      ui.hoverPath = null;
      battle.binfo(
        '~' +
          Math.round(calculateHitChance(sel, ui.fireMode) * 100) +
          '% · повторний тап у цю саму ціль — постріл (' +
          MODE_LABEL[ui.fireMode] +
          ').'
      );
      battle.renderBattle();
      return;
    }
    const mode = ui.fireMode;
    ui.fireMode = null;
    ui.tapCell = null;
    ui.aimCell = null;
    try {
      const prevLen = st.log.length;
      resolveAttack(st, sel.id, u.id, mode);
      battle.enqueueAnims(prevLen); // П6.8: трасер/спалах/смерть — з подій логу
      if (!battle.checkOutcome()) {
        battle.binfo(sel.name + ' вистрілив (' + MODE_LABEL[mode] + '). AP ' + sel.ap + '/' + sel.maxAp + '.');
        renderAll();
      }
    } catch (e) {
      battle.binfo('✗ ' + (e as Error).message);
      renderAll();
    }
    return;
  }

  // порожня клітинка — тач-патерн (ADR-0027, П6.4): перший тап/клік — прев'ю
  // шляху (зелені крапки, AP вистачає; червоні — ні), повторний тап/клік у ту
  // саму клітинку — хід. Один патерн для тачу і мишки.
  ui.fireMode = null;
  ui.aimCell = null; // П6.14: зведений режим знято — підказки прицілювання теж
  try {
    const path = findPath(st, sel.pos, cell);
    if (path === null) {
      ui.tapCell = null;
      battle.binfo('Туди не дістатись.');
      renderAll();
      return;
    }
    const ap = pathApCost(path);
    ui.hoverPath = path;
    ui.hoverAp = ap;
    if (ui.tapCell === null || ui.tapCell.x !== cell.x || ui.tapCell.y !== cell.y) {
      // перший тап — лише прев'ю (Esc скасовує)
      ui.tapCell = cell;
      battle.binfo(
        ap > sel.ap
          ? 'Не вистачає AP: шлях ' + ap + ' проти ' + sel.ap + ' — ходу не буде.'
          : 'Шлях: ' + ap + ' AP — повторний тап у ту саму клітинку — хід.'
      );
      battle.renderBattle();
      return;
    }
    // повторний тап у ту саму клітинку — хід
    ui.tapCell = null;
    if (ap > sel.ap) {
      battle.binfo('Не вистачає AP: шлях ' + ap + ' проти ' + sel.ap + '.');
      battle.renderBattle();
      return;
    }
    const prevLen = st.log.length;
    moveUnit(st, sel.id, path);
    battle.enqueueAnims(prevLen); // П6.8: хід по шляху (кроки логу об'єднуються)
    ui.hoverPath = null;
    if (!battle.checkOutcome()) {
      battle.binfo(sel.name + ': рух. AP ' + sel.ap + '/' + sel.maxAp + '.');
      renderAll();
    }
  } catch (e) {
    battle.binfo('✗ ' + (e as Error).message);
    renderAll();
  }
}

function battleCanvasHover(ev: MouseEvent): void {
  if (!battle.playerTurnActive() || !ui.mission) return;
  const sel = battle.selectedUnit();
  if (!sel) return;
  const cell = cellFromEvent(ev);
  // П6.14: у зведеному режимі наведення на валідну ціль показує шанс біля
  // клітинки (плашка на канві); прев'ю шляху над ціллю не показуємо.
  if (ui.fireMode !== null) {
    const t = ui.mission.state.units.find((x) => x.alive && x.side === 'alien' && x.pos.x === cell.x && x.pos.y === cell.y);
    const valid =
      t !== undefined &&
      battle.visibleCells().has(cell.x + ',' + cell.y) &&
      distance(sel.pos, t.pos) <= sel.weapon.range &&
      hasLineOfSight(ui.mission.state, sel.pos, t.pos);
    const next: Vec2 | null = valid ? cell : null;
    if (!sameCell(next, ui.aimCell)) {
      ui.aimCell = next;
      if (next !== null) ui.hoverPath = null;
      battle.renderBattle();
    }
    if (ui.aimCell !== null) return;
  }
  if (cell.x === sel.pos.x && cell.y === sel.pos.y) {
    if (ui.hoverPath !== null) {
      ui.hoverPath = null;
      battle.renderBattle();
    }
    return;
  }
  const path = findPath(ui.mission.state, sel.pos, cell);
  if (samePath(path, ui.hoverPath)) return; // без перерисовки на кожен піксель
  ui.hoverPath = path;
  ui.hoverAp = path ? pathApCost(path) : 0;
  if (path) {
    if (ui.hoverAp > sel.ap)
      battle.binfo('Не вистачає AP: шлях ' + ui.hoverAp + ' проти ' + sel.ap + ' (клавіша скасує — просто не клікайте).');
    else battle.binfo('Шлях: ' + ui.hoverAp + ' AP — клікніть, щоб рухатись.');
  }
  battle.renderBattle();
}

function battleCanvasLeave(): void {
  // П6.14: ui.aimCell — лише наведення; тап-тап тримає підказку у ui.tapCell
  if (ui.hoverPath !== null || ui.aimCell !== null) {
    ui.hoverPath = null;
    ui.aimCell = null;
    battle.renderBattle();
  }
}

function armFire(mode: ShotMode): void {
  if (!battle.playerTurnActive() || !ui.mission) return;
  if (demo.busy) return; // П6.16: триває демо — керування заблоковано
  const sel = battle.selectedUnit();
  if (!sel) {
    battle.binfo('Спершу клікніть свого солдата.');
    return;
  }
  // П6.14: без достатку AP режим не зводиться — кнопка приглушена, гаряча
  // клавіша дає ту саму відмову з причиною (фідбек не розходиться з кнопками).
  const cost = sel.weapon.modes[mode].apCost;
  if (sel.ap < cost) {
    battle.binfo('Не вистачає AP: ' + MODE_LABEL[mode] + ' постріл коштує ' + cost + ', є ' + sel.ap + '.');
    return;
  }
  ui.fireMode = mode;
  ui.tapCell = null; // П6.14: нове зведення — ціль обираємо заново (тап-тап з нуля)
  ui.aimCell = null;
  const chance = Math.round(calculateHitChance(sel, mode) * 100);
  battle.binfo(MODE_LABEL[mode] + ' постріл: ' + cost + ' AP · ~' + chance + '% · тапніть обведену ціль — шанс, повторний тап — постріл.');
  battle.renderBattle();
}

function armOverwatch(): void {
  if (!battle.playerTurnActive() || !ui.mission) return;
  if (demo.busy) return; // П6.16: триває демо — керування заблоковано
  const sel = battle.selectedUnit();
  if (!sel) {
    battle.binfo('Спершу клікніть свого солдата.');
    return;
  }
  // П6.14: та сама перевірка AP, що й у кнопки (підказка причини в binfo)
  if (sel.ap < OVERWATCH_AP_COST) {
    battle.binfo('Не вистачає AP: дозор коштує ' + OVERWATCH_AP_COST + ', є ' + sel.ap + '.');
    return;
  }
  try {
    const prevLen = ui.mission.state.log.length;
    setOverwatch(ui.mission.state, sel.id);
    battle.enqueueAnims(prevLen); // П6.8: спалах дозору
    battle.binfo(sel.name + ' у дозорі (реакційний вогонь у хід прибульців). AP ' + sel.ap + '/' + sel.maxAp + '.');
  } catch (e) {
    battle.binfo('✗ ' + (e as Error).message);
  }
  battle.renderBattle();
}

function endPlayerTurn(): void {
  if (!battle.playerTurnActive() || !ui.mission) return;
  if (demo.busy) return; // П6.16: триває демо — хід ведуть боти
  ui.hoverPath = null;
  ui.fireMode = null;
  ui.tapCell = null;
  ui.aimCell = null; // П6.14
  try {
    const prevLen = ui.mission.state.log.length;
    endTurn(ui.mission.state); // передати хід прибульцям (aliensTurn очікує їхній хід)
    const actions = aliensTurn(ui.mission.state); // синхронно, одним кліком (5.1.4)
    battle.enqueueAnims(prevLen); // П6.8: відтворення ходу прибульців поверх фінального стану
    if (!battle.checkOutcome()) {
      battle.binfo('Хід прибульців відпрацьовано (' + actions + ' дій). Ваш хід — хід ' + ui.mission.state.turn + '.');
      renderAll();
    }
  } catch (e) {
    battle.binfo('✗ Помилка ШІ: ' + (e as Error).message);
    renderAll();
  }
}

function restart(): void {
  battle.close();
  geoAnim.cancel(); // П6.9: нова партія — пульс старої бази не відтворюємо
  const seed = Number(el<HTMLInputElement>('seed').value) || 42;
  party = newParty(seed);
  renderAll();
  journal('Нова партія (сід ' + seed + '). Рухайте час — радар шукає НЛО.');
}

// П7: той самий шлях під курсором? (без перерисовки на кожен піксель)
export function samePath(a: Vec2[] | null, b: Vec2[] | null): boolean {
  if (a === null || b === null) return false;
  return a.length === b.length && a.every((p, i) => p.x === b[i].x && p.y === b[i].y);
}

// П6.14: та сама клітинка? (порівняння nullable-клітинок без перерисовок)
export function sameCell(a: Vec2 | null, b: Vec2 | null): boolean {
  if (a === null || b === null) return a === b;
  return a.x === b.x && a.y === b.y;
}

// ADR-0027 (П6.4): Esc — скасовує спершу зведений режим пострілу,
// за його відсутності — вибір солдата (разом із прев'ю шляху).
function cancelSelection(): void {
  if (!ui.mission) return;
  if (ui.fireMode !== null) {
    ui.fireMode = null;
    ui.tapCell = null;
    ui.aimCell = null; // П6.14
    battle.binfo('Режим пострілу скасовано.');
    battle.renderBattle();
    return;
  }
  if (ui.selectedId !== null || ui.hoverPath !== null) {
    ui.selectedId = null;
    ui.hoverPath = null;
    ui.tapCell = null;
    ui.aimCell = null; // П6.14
    battle.binfo('Вибір знято.');
    battle.renderBattle();
  }
}

// ADR-0027 (П6.4): гарячі клавіші керування боєм — 1/2/3 (режими пострілу),
// O (дозор), E (кінець ходу), Esc (скасувати). Ключ — за ev.code
// (фізична клавіша, незалежно від розкладки), цифри — ще й за ev.key.
// Поля вводу (сід) клавіші не перехоплюють — подія з них ігнорується.
function isTypingTarget(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}

function onKeyDown(ev: KeyboardEvent): void {
  if (isTypingTarget(ev.target)) return;
  if (ev.code === 'Digit1' || ev.key === '1') armFire('snap');
  else if (ev.code === 'Digit2' || ev.key === '2') armFire('aimed');
  else if (ev.code === 'Digit3' || ev.key === '3') armFire('auto');
  else if (ev.code === 'KeyO') armOverwatch();
  else if (ev.code === 'KeyE') endPlayerTurn();
  else if (ev.key === 'Escape') cancelSelection();
}

// П7: у node-середовищі (vitest) DOM відсутній — ініціалізацію керування
// пропускаємо; чисті функції вище імпортуються тестами напряму.
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
  el('btn-snap').onclick = () => armFire('snap');
  el('btn-aimed').onclick = () => armFire('aimed');
  el('btn-auto').onclick = () => armFire('auto');
  el('btn-ow').onclick = armOverwatch;
  el('btn-end').onclick = endPlayerTurn;
  el('btn-demo').onclick = () => demo.battle();
  // ADR-0027: фільтри-вкладки єдиного журналу
  for (const b of document.querySelectorAll<HTMLButtonElement>('#log-tabs button')) {
    b.onclick = () => journalUI.setFilter(b.dataset.filter as LogFilter);
  }
  const bc = el<HTMLCanvasElement>('battle');
  bc.addEventListener('click', battleCanvasClick);
  bc.addEventListener('mousemove', battleCanvasHover);
  bc.addEventListener('mouseleave', battleCanvasLeave);
  // ADR-0027 (П6.4): гарячі клавіші — на document (бій у фокусі канви не потрібен)
  document.addEventListener('keydown', onKeyDown);
  savePanel.detectStorage();
  renderAll();
  journal('Партію розпочато. Рухайте час — радар шукає НЛО.');
  if (!savePanel.isStorageOk()) journal('✗ Сховище недоступне — збереження вимкнено (приватний режим?).', 'lose');
}
