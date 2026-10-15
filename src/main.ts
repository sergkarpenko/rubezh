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

import { RADAR_RANGE, TICK_MINUTES, WORLD_W, WORLD_H, advanceTime, detectedUfos, geoClock, geoDay, missionTargets } from './core/geo';
import { ALIEN_SPAWN, SQUAD_SPAWN, completeMission, createMission, missionOutcome, type Mission } from './core/mission';
import { applyMissionResult, hireSoldier, hospitalTick, isBankrupt, missionSquad, readySoldiers } from './core/squad';
import { creditMissionBonus, economyTick, HIRE_PRICE } from './core/economy';
import {
  FIGHTER_MAX_HP,
  FIGHTER_REPAIR_COST,
  RANGE_PROFILES,
  interceptRound,
  interceptTick,
  repairTick,
  startIntercept,
  startRepair,
  type InterceptChoice,
  type InterceptEvent,
} from './core/intercept';
import {
  OVERWATCH_AP_COST,
  calculateHitChance,
  distance,
  endTurn,
  hasLineOfSight,
  moveUnit,
  resolveAttack,
  setOverwatch,
  type GameState,
  type ShotMode,
  type Unit,
  type Vec2,
} from './core/combat';
import { computeVisibleCells, findPath, pathApCost } from './core/map';
import { aliensTurn } from './bot';
// пR.2 (ADR-0037): модулі шару UI — демо-драйвер, DOM-хелпер, панель збереження, журнал подій.
import { DemoDriver } from './ui/demo';
import { el } from './ui/dom';
import { createSavePanel } from './ui/save-panel';
import { createJournal, MODE_LABEL, type LogFilter } from './ui/journal';
// П6.7 (ADR-0029): векторні спрайти — чисті функції малювання шару відображення.
// П6.8 (ADR-0029): анімаційний рушій — черга + rAF лише під час активних анімацій.
import {
  AnimEngine,
  animsFromEvents,
  animT,
  drawAnimFrame,
  drawBaseSprite,
  drawChanceLabel,
  drawFighterSprite,
  drawNightTerrain,
  drawTargetFrame,
  drawUfoSprite,
  drawUnitSprite,
  initPixelSprites,
  makeGeoPulseAnim,
  makeTracerAnim,
  moveAnimPos,
  shakeOffset,
  type Anim,
  type TerrainCell,
} from './render';
// П5.3 (ADR-0026): партія і слоти збереження — із чистого ядра save.ts.
import { createParty, type Party } from './core/save';
import { campaignTick } from './core/campaign';

const GCELL = 36; // px на клітинку світу (16×8 → 576×288)
const BCELL = 26; // px на клітинку бойовища (20×20 → 520×520)

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
  battleLog: () => (mission ? mission.state.log : null),
  unitName,
  onGeoEvent: (e) => {
    if (hasRaf) geoAnim.push(...interceptAnims(e as InterceptEvent));
  },
});
const journal = journalUI.add; // виклики journal(text, cls, cat) у шарі застосунку без змін

let gameOver = false; // банкрутство (ADR-0021): боєготових немає і грошей на найм немає
let party: Party = newParty(42);
let mission: Mission | null = null;
let battleResult: 'перемога' | 'поразка' | null = null;
let selectedId: string | null = null; // вибраний солдат
let fireMode: ShotMode | null = null; // «зведений» режим пострілу
let hoverPath: Vec2[] | null = null; // прев'ю шляху під курсором
let hoverAp = 0;
let tapCell: Vec2 | null = null; // ADR-0027 (П6.4): клітинка першого тапу — повторний тап у неї робить хід
let aimCell: Vec2 | null = null; // П6.14: клітинка цілі під наведенням/першим тапом у зведеному режимі

// П6.8 (ADR-0029): анімаційний рушій — черга анімацій, rAF-цикл живе лише
// поки черга непорожня (idle → 0 перерисовок; батарея iPad). Кожен кадр —
// renderBattle з clearRect на весь buffer (урок П6.6). rAF може бути
// відсутній у тестовому середовищі — тоді анімації не ставляться в чергу
// (стан і лог бою від анімації не залежать — критерій «байт-у-байт»).
const hasRaf = typeof requestAnimationFrame === 'function';

// пR.2 (ADR-0037): покрокове демо П6.16 — стан і таймери драйвера в src/ui/demo.ts;
// тут лише зв'язування з місією, анімаціями та відображенням.
const demo = new DemoDriver({
  getMission: () => mission,
  battleFinished: () => battleResult !== null,
  renderBattle,
  renderAll,
  binfo,
  finishBattle,
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
  inBattle: () => mission !== null,
  interceptBusy: () => party.intercept.fighter.status === 'погоня' || party.intercept.fighter.status === 'бій',
  isGameOver: () => gameOver,
  journal,
  renderAll,
});

const anim = new AnimEngine({
  schedule: (cb) => requestAnimationFrame(cb),
  cancel: (h) => cancelAnimationFrame(h as number),
  draw: () => renderBattle(),
  onIdle: () => demo.onAnimIdle(), // П6.16: анімації дії демо відтворені — пауза і наступна дія
});
// П6.9 (ADR-0029): пульс радара геосцени — той самий рушій (черга + rAF лише
// під час активних анімацій, idle → 0 перерисовок), окремий інстанс зі своєю
// перерисовкою renderGeo. Суто візуальний: geo.rng не чіпається, траєкторія
// геосцени незмінна; туман — невиявлені НЛО у кадр не потрапляють (ADR-0006).
const geoAnim = new AnimEngine({
  schedule: (cb) => requestAnimationFrame(cb),
  cancel: (h) => cancelAnimationFrame(h as number),
  draw: () => renderGeo(),
});

// П6.8: нові події логу бою → анімації (суто відображення: дії ядра вже
// застосовані миттєво, лог лише читається і не змінюється).
function enqueueBattleAnims(prevLen: number): void {
  if (!mission || !hasRaf) return;
  anim.push(...animsFromEvents(mission.state.log.slice(prevLen), mission.state.units));
}

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
  const u = mission?.state.units.find((x) => x.id === id);
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

function renderGeo(): void {
  journalUI.drainGeo();
  const cv = el<HTMLCanvasElement>('geo');
  const ctx = cv.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, cv.width, cv.height);

  ctx.strokeStyle = '#1a2130';
  ctx.lineWidth = 1;
  for (let x = 0; x <= WORLD_W; x++) {
    ctx.beginPath();
    ctx.moveTo(x * GCELL, 0);
    ctx.lineTo(x * GCELL, WORLD_H * GCELL);
    ctx.stroke();
  }
  for (let y = 0; y <= WORLD_H; y++) {
    ctx.beginPath();
    ctx.moveTo(0, y * GCELL);
    ctx.lineTo(WORLD_W * GCELL, y * GCELL);
    ctx.stroke();
  }

  const b = party.geo.base;
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = '#2c3f2f';
  ctx.strokeRect((b.x - RADAR_RANGE) * GCELL, (b.y - RADAR_RANGE) * GCELL, (2 * RADAR_RANGE + 1) * GCELL, (2 * RADAR_RANGE + 1) * GCELL);
  ctx.setLineDash([]);

  // П6.7 (ADR-0029): статичні спрайти геосцени — база і позначки НЛО (туман:
  // detectedUfos повертає лише виявлені — невиявлені в малювання не потрапляють).
  drawBaseSprite(ctx, { cx: b.x * GCELL + GCELL / 2, cy: b.y * GCELL + GCELL / 2, size: GCELL });

  for (const u of detectedUfos(party.geo)) {
    drawUfoSprite(ctx, {
      cx: u.pos.x * GCELL + GCELL / 2,
      cy: u.pos.y * GCELL + GCELL / 2,
      landed: u.status === 'приземлився',
      kind: u.kind,
    });
  }
  // П7.5 (ADR-0032): маркер винищувача на геосцені — лише поза базою (на базі він у
  // спрайті бази; погоня/бій — дельта-крило поруч із позначкою НЛО).
  const fgt = party.intercept.fighter;
  if (fgt.status === 'погоня' || fgt.status === 'бій') {
    drawFighterSprite(ctx, { cx: fgt.pos.x * GCELL + GCELL / 2, cy: fgt.pos.y * GCELL + GCELL / 2 });
  }

  // П6.9 (ADR-0029): анімаційний шар геосцени — пульс радара поверх статичного
  // кадру (кадр малюється з нуля — clearRect вище; урок П6.6).
  const ga = geoAnim.active();
  if (ga !== null) drawAnimFrame(ctx, ga, geoAnim.now, GCELL, 0);

  el('clock').textContent = geoClock(party.geo);
  const busy = mission !== null;
  (el('btn-tick') as HTMLButtonElement).disabled = busy || gameOver;
  (el('btn-day') as HTMLButtonElement).disabled = busy || gameOver;
}

function renderUfos(): void {
  const box = el('ufos');
  box.innerHTML = '';
  const detected = detectedUfos(party.geo);
  const targets = new Set(missionTargets(party.geo).map((u) => u.id));
  if (detected.length === 0) {
    box.innerHTML = '<div class="meta">Нічого не виявлено — рухайте час.</div>';
    return;
  }
  for (const u of detected) {
    const div = document.createElement('div');
    div.className = 'ufo';
    const info = u.status === 'приземлився' ? 'вікно ' + (u.landedTicksLeft * TICK_MINUTES) / 60 + ' год' : 'у повітрі';
    div.innerHTML =
      '<b>' + u.kind + '</b> · ' + u.status + '<br><span class="meta">(' + u.pos.x + ',' + u.pos.y + ') · ' + info + '</span>';
    // П7.4 (ADR-0032): «Перехопити» — лише для виявленого НЛО в повітрі; під час ремонту
    // або погоні запуск заблокований (пошкоджений винищувач не стартує)
    if (u.status === 'летить' && party.intercept.fighter.status === 'на базі') {
      const ib = document.createElement('button');
      ib.className = 'intercept';
      ib.textContent = '✦ Перехопити';
      const readyFighter = party.intercept.fighter.hp === FIGHTER_MAX_HP;
      ib.disabled = mission !== null || gameOver || !readyFighter;
      ib.title = !readyFighter ? 'Винищувач пошкоджений — спочатку ремонт' : 'Підняти винищувач на перехоплення';
      ib.onclick = () => {
        if (mission) return;
        try {
          startIntercept(party.intercept, party.geo, u.id);
        } catch (e) {
          journal('✗ ' + (e as Error).message, 'lose');
        }
        renderAll();
      };
      div.appendChild(ib);
    }
    if (targets.has(u.id)) {
      const btn = document.createElement('button');
      btn.className = 'mission';
      btn.textContent = '▶ Запустити місію';
      // П4.5 (ADR-0021): поранені в лікарні не боєготові — місію запускати ніким
      const ready = readySoldiers(party.roster).length;
      btn.disabled = mission !== null || gameOver || ready === 0;
      if (gameOver) btn.title = 'Партію програно — банкрутство';
      else if (ready === 0)
        btn.title =
          party.roster.soldiers.length === 0
            ? 'Ростер порожній — найм солдата за гроші'
            : 'Усі солдати поранені — чекайте одужання або наймайте';
      btn.onclick = () => launchMission(u.id);
      div.appendChild(btn);
    }
    box.appendChild(div);
  }
}

// П7: колір HP у ростері (чиста функція): повне — зелений, понад половину — жовтий, інакше — червоний.
export function hpColor(hp: number, maxHp: number): string {
  return hp >= maxHp ? '#7fbf7f' : hp > maxHp / 2 ? '#d8b25a' : '#ff9c9c';
}

// П4.5 (ADR-0021): панель фінансів — баланс, кнопка найму, надходження в журнал.
function renderFinances(): void {
  journalUI.drainEcon();
  // ADR-0027: баланс у двох місцях — чип топбару і картка «Фінанси» (дублювання свідоме)
  const moneyText = gameOver ? 'БАНКРУТ' : String(party.econ.money);
  el('money').textContent = moneyText;
  el('money-card').textContent = moneyText;
  const hire = el<HTMLButtonElement>('btn-hire');
  hire.disabled = gameOver || party.econ.money < HIRE_PRICE;
  hire.title = hire.disabled ? 'Недостатньо грошей (ціна найму ' + HIRE_PRICE + ')' : 'Новий солдат у кінець ростеру (−' + HIRE_PRICE + ')';
}

// П7.5 (ADR-0032/0027): контекст-стрічка повітряного бою у фокусній зоні — видима лише
// під час погоні/бою (на базі/ремонті джерело правди — панель «Винищувач» у колонці стану).
function renderInterceptCtx(): void {
  const f = party.intercept.fighter;
  const active = f.status === 'погоня' || f.status === 'бій';
  el('ictx').classList.toggle('hidden', !active);
  if (!active) return;
  el('ictx-target').textContent = f.targetId ?? '—';
  el('ictx-status').textContent = f.status;
  el('ictx-round').textContent = f.status === 'бій' ? String(party.intercept.round) : '—';
  el('ictx-fighter').textContent = 'HP ' + f.hp + '/' + FIGHTER_MAX_HP;
  const ufo = party.geo.ufos.find((u) => u.id === party.intercept.activeUfoId);
  el('ictx-ufo').textContent = ufo ? 'HP ' + party.intercept.ufoHp[ufo.id] : '—';
}

// П7.4 (ADR-0032): панель винищувача — статус/HP у колонці стану; кнопки дій залежно
// від стану: «Перехопити» (боєготовий + виявлений НЛО в повітрі), «Ремонт (50)»
// (пошкоджений на базі), дистанції бою (стан «бій» — рішення гравця кожен раунд).
function renderFighter(): void {
  const box = el('fighter');
  box.innerHTML = '';
  const f = party.intercept.fighter;
  renderInterceptCtx(); // П7.5: контекст-стрічка повітряного бою у фокусній зоні
  const statusText =
    f.status === 'ремонт'
      ? 'ремонт: ' + f.repairTicksLeft + ' тік(и)'
      : f.status === 'на базі'
        ? f.hp < FIGHTER_MAX_HP
          ? 'на базі · пошкоджений'
          : 'боєготовий'
        : f.status;
  const head = document.createElement('div');
  head.className = 'meta';
  head.style.marginBottom = '4px';
  head.innerHTML =
    'Статус: <b>' +
    statusText +
    '</b> · HP <span style="color:' +
    hpColor(f.hp, FIGHTER_MAX_HP) +
    '">' +
    f.hp +
    '/' +
    FIGHTER_MAX_HP +
    '</span>';
  box.appendChild(head);
  if (f.status === 'бій') {
    const ufo = party.geo.ufos.find((u) => u.id === party.intercept.activeUfoId);
    const ctx = document.createElement('div');
    ctx.className = 'meta';
    ctx.style.marginBottom = '4px';
    ctx.textContent =
      'Бій з ' + (ufo ? ufo.id : '?') + ' · раунд ' + party.intercept.round + ' · НЛО HP ' + (ufo ? party.intercept.ufoHp[ufo.id] : '?');
    box.appendChild(ctx);
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:4px';
    for (const c of ['далека', 'середня', 'впритул', 'відступ'] as const) {
      const b = document.createElement('button');
      b.className = 'intercept-range';
      b.dataset.choice = c;
      b.textContent = c + (c !== 'відступ' ? ' (~' + Math.round(RANGE_PROFILES[c].fighterHitChance * 100) + '%)' : '');
      b.disabled = mission !== null;
      b.onclick = () => {
        try {
          interceptRound(party.intercept, party.geo, c as InterceptChoice, party.econ);
        } catch (e) {
          journal('✗ ' + (e as Error).message, 'lose');
        }
        renderAll();
      };
      row.appendChild(b);
    }
    box.appendChild(row);
  }
  if (f.status === 'на базі' && f.hp < FIGHTER_MAX_HP) {
    const b = document.createElement('button');
    b.id = 'btn-repair';
    b.textContent = 'Ремонт (' + FIGHTER_REPAIR_COST + ')';
    b.disabled = gameOver || party.econ.money < FIGHTER_REPAIR_COST;
    b.title = b.disabled
      ? 'Недостатньо грошей (ціна ремонту ' + FIGHTER_REPAIR_COST + ')'
      : 'Повний HP після ремонту (−' + FIGHTER_REPAIR_COST + ')';
    b.onclick = () => {
      try {
        startRepair(party.intercept, party.geo, party.econ);
      } catch (e) {
        journal('✗ ' + (e as Error).message, 'lose', 'econ');
      }
      renderAll();
    };
    box.appendChild(b);
  }
}

function renderRoster(): void {
  const box = el('roster');
  box.innerHTML = '';
  const soldiers = party.roster.soldiers;
  // ADR-0027: чип боєготових у топбарі — завжди видний стан партії
  const readyN = readySoldiers(party.roster).length;
  el('ready').textContent = readyN + '/' + soldiers.length;
  if (soldiers.length === 0) {
    box.innerHTML =
      '<div style="color:#ff9c9c">Загін втрачено.</div>' +
      (party.econ.money >= HIRE_PRICE
        ? '<div class="meta">Найм доступний — кнопка «Найм солдата».</div>'
        : '<div class="meta">Грошей на найм немає.</div>');
    return;
  }
  const head = document.createElement('div');
  head.className = 'meta';
  head.style.marginBottom = '4px';
  head.textContent = soldiers.length + ' солдатів (' + readyN + ' боєготових)';
  box.appendChild(head);
  for (const s of soldiers) {
    const heal = party.roster.hospital[s.id];
    const row = document.createElement('div');
    row.className = 'soldier';
    row.innerHTML =
      '<span style="min-width:64px">' +
      s.name +
      '</span>' +
      '<span style="color:' +
      hpColor(s.hp, s.maxHp) +
      '">HP ' +
      s.hp +
      '/' +
      s.maxHp +
      '</span>' +
      (heal !== undefined ? '<span class="meta">лікарня: ' + heal + ' тик(и)</span>' : '') +
      '<span class="kills">⚔ ' +
      s.kills +
      '</span>';
    box.appendChild(row);
  }
}

// --- П5.3: панель збереження (ADR-0026) — модуль src/ui/save-panel.ts (пR.2) ---

// --- тактичний бій (5.3) ---

function binfo(text: string): void {
  el('binfo').textContent = text;
}

function playerTurnActive(): boolean {
  return mission !== null && battleResult === null && mission.state.activeSide === 'player';
}

function selectedUnit(): Unit | undefined {
  if (!mission || !selectedId) return undefined;
  return mission.state.units.find((u) => u.id === selectedId && u.alive);
}

function visibleCells(): Set<string> {
  const vis = new Set<string>();
  if (!mission) return vis;
  for (const u of mission.state.units) {
    if (u.side === 'player' && u.alive) for (const k of computeVisibleCells(mission.state, u.pos)) vis.add(k);
  }
  return vis;
}

function renderBattle(): void {
  if (!mission) return;
  journalUI.drainBattle();
  // ADR-0027 (П6.3): контекст-стрічка бою — тип місії, заморожений час,
  // чий хід, активний юніт HP/AP. Час геосцени стоїть (ADR-0026: місія
  // не переривається) — показуємо його як «заморожено».
  el('bctx-kind').textContent = mission.briefing.kind;
  el('bctx-time').textContent = geoClock(party.geo) + ' · заморожено';
  el('bctx-turn').textContent = 'хід ' + mission.state.turn + ' · ' + (mission.state.activeSide === 'player' ? 'загін' : 'прибульці');
  const selCtx = selectedUnit();
  el('bctx-unit').textContent = selCtx
    ? selCtx.name + ': HP ' + selCtx.hp + '/' + selCtx.maxHp + ' · AP ' + selCtx.ap + '/' + selCtx.maxAp
    : 'не вибраний';
  const cv = el<HTMLCanvasElement>('battle');
  const ctx = cv.getContext('2d');
  if (!ctx) return;
  // П6.6: повна очистка кадру — клітинки заливаються з проміжком у 1px,
  // і без clearRect ці проміжки накопичують залишки (маркери дозору тощо).
  // Патерн renderGeo: кадр еквівалентний малюванню з нуля.
  ctx.clearRect(0, 0, cv.width, cv.height);
  const st = mission.state;

  const vis = visibleCells();

  // П6.8: активна анімація руху — юніт малює анімаційний шар у проміжній
  // позиції, статичний прохід його пропускає. Туман: рух прибульця показуємо
  // лише у видимих клітинках — невидимий рух не розкриває позицію (ADR-0006).
  const activeAnim = anim.active();
  let movingId: string | null = null;
  if (activeAnim !== null && activeAnim.kind === 'move') {
    const p = moveAnimPos(activeAnim, animT(activeAnim, anim.now), BCELL);
    const cellK = Math.floor(p.cx / BCELL) + ',' + Math.floor(p.cy / BCELL);
    if (activeAnim.side === 'player' || vis.has(cellK)) movingId = activeAnim.unitId;
  }

  // П6.13: нічна палітра. Легка тряска канвасу при влучанні — зсув усього кадру
  // на фазі спалаху трасера (через AnimEngine — лише в кадрах анімації); фон
  // канви збігається з CSS-тлом, оголений край непомітний. Туман: зсув
  // однаковий для всіх клітинок — сенс туману незмінний (ADR-0006).
  const shake = shakeOffset(activeAnim, anim.now);
  ctx.save();
  ctx.translate(shake.dx, shake.dy);
  drawNightTerrain(
    ctx,
    cv.width,
    cv.height,
    Array.from({ length: st.map.height }, (_, y) =>
      Array.from({ length: st.map.width }, (_, x): TerrainCell => {
        const k2 = x + ',' + y;
        return { x, y, blocked: st.map.blocked.has(k2), visible: vis.has(k2) };
      })
    ).flat(),
    BCELL
  );

  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = 'rgba(110,168,255,0.5)';
  for (const p of SQUAD_SPAWN) ctx.strokeRect(p.x * BCELL + 2, p.y * BCELL + 2, BCELL - 5, BCELL - 5);
  ctx.strokeStyle = 'rgba(255,107,107,0.5)';
  for (const p of ALIEN_SPAWN) ctx.strokeRect(p.x * BCELL + 2, p.y * BCELL + 2, BCELL - 5, BCELL - 5);
  ctx.setLineDash([]);

  // прев'ю шляху під курсором: зелені крапки — вистачає AP, червоні — ні
  const sel = selectedUnit();
  if (hoverPath && sel && playerTurnActive()) {
    const affordable = hoverAp <= sel.ap;
    ctx.fillStyle = affordable ? 'rgba(127,226,160,0.9)' : 'rgba(255,156,156,0.9)';
    for (const p of hoverPath) {
      ctx.beginPath();
      ctx.arc(p.x * BCELL + BCELL / 2, p.y * BCELL + BCELL / 2, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // П6.14: у зведеному режимі пострілу — обведення всіх валідних цілей
  // (видимі прибульці, дистанція і лінія вогню). Туман: невидимі цілі
  // не підсвічуються (ADR-0006) — підказка лише про те, що гравець бачив.
  let targets: Unit[] = [];
  if (fireMode !== null && sel && playerTurnActive()) targets = validFireTargets(st, sel, vis);
  for (const t of targets) drawTargetFrame(ctx, { gx: t.pos.x, gy: t.pos.y, cell: BCELL });

  // П6.7 (ADR-0029): векторні спрайти юнітів замість геометричних кружків —
  // силует, зброя, HP, рамка вибору і маркер дозору малює render.ts
  // (маркер дозору — строго в межах клітинки, П6.6).
  for (const u of st.units) {
    if (!u.alive) continue;
    if (u.id === movingId) continue; // П6.8: його малює анімаційний шар у проміжній позиції
    const visible = vis.has(u.pos.x + ',' + u.pos.y);
    if (u.side === 'alien' && !visible) continue;
    drawUnitSprite(ctx, {
      side: u.side,
      cx: u.pos.x * BCELL + BCELL / 2,
      cy: u.pos.y * BCELL + BCELL / 2,
      r: 8,
      hp: u.hp,
      selected: u.id === selectedId,
      overwatch: u.overwatch,
    });
  }

  // П6.8 (ADR-0029): анімаційний шар поверх статичного стану. Рух прибульця
  // поза туманом не малюємо (movingId null — статика показує його у фінальній
  // клітинці лише якщо вона видима, як і без анімації).
  if (activeAnim !== null && (activeAnim.kind !== 'move' || movingId !== null)) {
    drawAnimFrame(ctx, activeAnim, anim.now, BCELL, 8);
  }

  // П6.14: шанс попадання біля клітинки цілі — при наведенні (aimCell) або
  // першому тапі (tapCell у зведеному режимі — тап-тап, дзеркало руху П6.4).
  if (fireMode !== null && sel && playerTurnActive()) {
    const focus = [aimCell, tapCell].find((c) => c !== null && targets.some((t) => t.pos.x === c.x && t.pos.y === c.y));
    if (focus) {
      drawChanceLabel(ctx, {
        gx: focus.x,
        gy: focus.y,
        cell: BCELL,
        cw: cv.width,
        text: '~' + Math.round(calculateHitChance(sel, fireMode) * 100) + '%',
      });
    }
  }
  ctx.restore(); // П6.13: кінець зсуву тряски — кадр повертається у межі buffer'а

  // стан кнопок керування
  const busy = !playerTurnActive();
  (el('btn-end') as HTMLButtonElement).disabled = busy;
  (el('btn-demo') as HTMLButtonElement).disabled = battleResult !== null;
  // П6.14: кнопки режимів без достатку AP — приглушені (disabled) з причиною
  // «не вистачає AP» у підказці; підказка з index.html зберігається (dataset).
  for (const m of ['snap', 'aimed', 'auto'] as ShotMode[]) {
    const b = el<HTMLButtonElement>('btn-' + m);
    const cost = sel ? sel.weapon.modes[m].apCost : 0;
    const noAp = sel !== undefined && sel.ap < cost;
    b.disabled = busy || noAp;
    const hint = b.dataset.hint || b.title;
    b.dataset.hint = hint;
    b.title = noAp ? hint + ' — не вистачає AP (потрібно ' + cost + ')' : hint;
    b.classList.toggle('armed', fireMode === m);
  }
  const ow = el<HTMLButtonElement>('btn-ow');
  const owNoAp = sel !== undefined && sel.ap < OVERWATCH_AP_COST;
  ow.disabled = busy || owNoAp;
  const owHint = ow.dataset.hint || ow.title;
  ow.dataset.hint = owHint;
  ow.title = owNoAp ? owHint + ' — не вистачає AP (потрібно ' + OVERWATCH_AP_COST + ')' : owHint;
}

// П8.3: відображення екрану перемоги кампанії
function renderCampaignVictory(): void {
  const victoryPanel = el('campaign-victory');
  const isVictory = party.campaign.status === 'перемога';
  victoryPanel.classList.toggle('hidden', !isVictory);
  if (isVictory && party.campaign.score) {
    el('campaign-score').textContent = String(party.campaign.score.total);
  }
}

function renderAll(): void {
  // ADR-0027: фокусна зона — геосцена або бій (не «два екрани»)
  el('geo-panel').classList.toggle('hidden', mission !== null);
  el('battle-panel').classList.toggle('hidden', mission === null);
  // ADR-0027 (П6.3): у бою колонка стану приглушена й неактивна —
  // джерело стану тоді топбар і контекст-стрічка бою
  el('status').classList.toggle('dimmed', mission !== null);
  // П8.3: відображення статусу кампанії
  el('campaign-status').textContent = 'кампанія: ' + party.campaign.status;
  el('campaign-progress').textContent = 'Д' + geoDay(party.geo) + '/30';
  el('campaign-progress').classList.toggle('hidden', mission !== null);
  renderGeo();
  renderUfos();
  renderFighter();
  renderFinances();
  renderRoster();
  savePanel.render();
  // П8.3: відображення екрану перемоги кампанії
  renderCampaignVictory();
  if (mission) renderBattle();
}

function closeBattle(): void {
  demo.stop(); // П6.16: демо могло тривати — таймер і стан драйвера скидаємо
  anim.cancel(); // П6.8: бій закрито — чергу анімацій скидаємо
  mission = null;
  battleResult = null;
  selectedId = null;
  fireMode = null;
  hoverPath = null;
  tapCell = null;
  aimCell = null; // П6.14
  journalUI.resetBattle();
  el('bresult').innerHTML = '';
  renderAll();
}

function launchMission(ufoId: string): void {
  if (mission) return;
  anim.cancel(); // П6.8: новий бій — без залишків черги попереднього
  geoAnim.cancel(); // П6.9: геосцену сховано — пульс радара скидаємо
  try {
    mission = createMission(party.geo, ufoId, { squad: missionSquad(party.roster) });
  } catch (e) {
    journal('✗ ' + (e as Error).message, 'lose');
    return;
  }
  battleResult = null;
  selectedId = null;
  fireMode = null;
  hoverPath = null;
  tapCell = null;
  aimCell = null; // П6.14
  journalUI.resetBattle();
  journal('▶ Місія: загін висаджено біля НЛО ' + ufoId, '', 'battle');
  binfo('Ваш хід: клікніть свого солдата (синє коло), потім клітинку — прев’ю шляху; повторний клік у ту саму клітинку — хід.');
  renderAll();
}

// Перевірка завершення після кожної дії; true — бій скінчився.
function checkOutcome(): boolean {
  if (!mission) return true;
  const outcome = missionOutcome(mission.state);
  if (outcome !== 'триває') {
    finishBattle(outcome);
    return true;
  }
  return false;
}

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

function battleCanvasClick(ev: MouseEvent): void {
  if (!playerTurnActive() || !mission) return;
  if (demo.busy) return; // П6.16: триває демо — бойовище не клікається
  const st = mission.state;
  const cell = cellFromEvent(ev);
  const u = st.units.find((x) => x.alive && x.pos.x === cell.x && x.pos.y === cell.y);

  if (u && u.side === 'player') {
    // вибір свого солдата
    selectedId = u.id;
    fireMode = null;
    hoverPath = null;
    tapCell = null;
    aimCell = null; // П6.14
    binfo(u.name + ': HP ' + u.hp + '/' + u.maxHp + ' · AP ' + u.ap + '/' + u.maxAp + '. Клікніть клітинку — рух, або кнопку пострілу.');
    renderAll();
    return;
  }

  const sel = selectedUnit();
  if (!sel) {
    binfo('Спершу клікніть свого солдата (синє коло).');
    return;
  }

  if (u && u.side === 'alien') {
    const vis = visibleCells();
    if (!vis.has(cell.x + ',' + cell.y)) {
      binfo('Там нікого не видно (туман війни).');
      return;
    }
    if (!fireMode) {
      binfo('Виберіть режим пострілу (кнопка зліва), потім клікніть видимого прибульця.');
      return;
    }
    // П6.14: причини невалідної цілі — ті самі перевірки, що й assertCanFire ядра
    if (distance(sel.pos, u.pos) > sel.weapon.range) {
      binfo('Ціль поза дальністю зброї (' + sel.weapon.range + ' клітинок).');
      return;
    }
    if (!hasLineOfSight(st, sel.pos, u.pos)) {
      binfo('Немає лінії вогню до цілі.');
      return;
    }
    // П6.14: тап-тап і для пострілу (дзеркало руху П6.4): перший тап — шанс
    // попадання біля клітинки, повторний тап у ту саму ціль — постріл.
    if (tapCell === null || tapCell.x !== cell.x || tapCell.y !== cell.y) {
      tapCell = cell;
      aimCell = cell;
      hoverPath = null;
      binfo(
        '~' +
          Math.round(calculateHitChance(sel, fireMode) * 100) +
          '% · повторний тап у цю саму ціль — постріл (' +
          MODE_LABEL[fireMode] +
          ').'
      );
      renderBattle();
      return;
    }
    const mode = fireMode;
    fireMode = null;
    tapCell = null;
    aimCell = null;
    try {
      const prevLen = st.log.length;
      resolveAttack(st, sel.id, u.id, mode);
      enqueueBattleAnims(prevLen); // П6.8: трасер/спалах/смерть — з подій логу
      if (!checkOutcome()) {
        binfo(sel.name + ' вистрілив (' + MODE_LABEL[mode] + '). AP ' + sel.ap + '/' + sel.maxAp + '.');
        renderAll();
      }
    } catch (e) {
      binfo('✗ ' + (e as Error).message);
      renderAll();
    }
    return;
  }

  // порожня клітинка — тач-патерн (ADR-0027, П6.4): перший тап/клік — прев'ю
  // шляху (зелені крапки, AP вистачає; червоні — ні), повторний тап/клік у ту
  // саму клітинку — хід. Один патерн для тачу і мишки.
  fireMode = null;
  aimCell = null; // П6.14: зведений режим знято — підказки прицілювання теж
  try {
    const path = findPath(st, sel.pos, cell);
    if (path === null) {
      tapCell = null;
      binfo('Туди не дістатись.');
      renderAll();
      return;
    }
    const ap = pathApCost(path);
    hoverPath = path;
    hoverAp = ap;
    if (tapCell === null || tapCell.x !== cell.x || tapCell.y !== cell.y) {
      // перший тап — лише прев'ю (Esc скасовує)
      tapCell = cell;
      binfo(
        ap > sel.ap
          ? 'Не вистачає AP: шлях ' + ap + ' проти ' + sel.ap + ' — ходу не буде.'
          : 'Шлях: ' + ap + ' AP — повторний тап у ту саму клітинку — хід.'
      );
      renderBattle();
      return;
    }
    // повторний тап у ту саму клітинку — хід
    tapCell = null;
    if (ap > sel.ap) {
      binfo('Не вистачає AP: шлях ' + ap + ' проти ' + sel.ap + '.');
      renderBattle();
      return;
    }
    const prevLen = st.log.length;
    moveUnit(st, sel.id, path);
    enqueueBattleAnims(prevLen); // П6.8: хід по шляху (кроки логу об'єднуються)
    hoverPath = null;
    if (!checkOutcome()) {
      binfo(sel.name + ': рух. AP ' + sel.ap + '/' + sel.maxAp + '.');
      renderAll();
    }
  } catch (e) {
    binfo('✗ ' + (e as Error).message);
    renderAll();
  }
}

function battleCanvasHover(ev: MouseEvent): void {
  if (!playerTurnActive() || !mission) return;
  const sel = selectedUnit();
  if (!sel) return;
  const cell = cellFromEvent(ev);
  // П6.14: у зведеному режимі наведення на валідну ціль показує шанс біля
  // клітинки (плашка на канві); прев'ю шляху над ціллю не показуємо.
  if (fireMode !== null) {
    const t = mission.state.units.find((x) => x.alive && x.side === 'alien' && x.pos.x === cell.x && x.pos.y === cell.y);
    const valid =
      t !== undefined &&
      visibleCells().has(cell.x + ',' + cell.y) &&
      distance(sel.pos, t.pos) <= sel.weapon.range &&
      hasLineOfSight(mission.state, sel.pos, t.pos);
    const next: Vec2 | null = valid ? cell : null;
    if (!sameCell(next, aimCell)) {
      aimCell = next;
      if (next !== null) hoverPath = null;
      renderBattle();
    }
    if (aimCell !== null) return;
  }
  if (cell.x === sel.pos.x && cell.y === sel.pos.y) {
    if (hoverPath !== null) {
      hoverPath = null;
      renderBattle();
    }
    return;
  }
  const path = findPath(mission.state, sel.pos, cell);
  if (samePath(path, hoverPath)) return; // без перерисовки на кожен піксель
  hoverPath = path;
  hoverAp = path ? pathApCost(path) : 0;
  if (path) {
    if (hoverAp > sel.ap) binfo('Не вистачає AP: шлях ' + hoverAp + ' проти ' + sel.ap + ' (клавіша скасує — просто не клікайте).');
    else binfo('Шлях: ' + hoverAp + ' AP — клікніть, щоб рухатись.');
  }
  renderBattle();
}

function battleCanvasLeave(): void {
  // П6.14: aimCell — лише наведення; тап-тап тримає підказку у tapCell
  if (hoverPath !== null || aimCell !== null) {
    hoverPath = null;
    aimCell = null;
    renderBattle();
  }
}

function armFire(mode: ShotMode): void {
  if (!playerTurnActive() || !mission) return;
  if (demo.busy) return; // П6.16: триває демо — керування заблоковано
  const sel = selectedUnit();
  if (!sel) {
    binfo('Спершу клікніть свого солдата.');
    return;
  }
  // П6.14: без достатку AP режим не зводиться — кнопка приглушена, гаряча
  // клавіша дає ту саму відмову з причиною (фідбек не розходиться з кнопками).
  const cost = sel.weapon.modes[mode].apCost;
  if (sel.ap < cost) {
    binfo('Не вистачає AP: ' + MODE_LABEL[mode] + ' постріл коштує ' + cost + ', є ' + sel.ap + '.');
    return;
  }
  fireMode = mode;
  tapCell = null; // П6.14: нове зведення — ціль обираємо заново (тап-тап з нуля)
  aimCell = null;
  const chance = Math.round(calculateHitChance(sel, mode) * 100);
  binfo(MODE_LABEL[mode] + ' постріл: ' + cost + ' AP · ~' + chance + '% · тапніть обведену ціль — шанс, повторний тап — постріл.');
  renderBattle();
}

function armOverwatch(): void {
  if (!playerTurnActive() || !mission) return;
  if (demo.busy) return; // П6.16: триває демо — керування заблоковано
  const sel = selectedUnit();
  if (!sel) {
    binfo('Спершу клікніть свого солдата.');
    return;
  }
  // П6.14: та сама перевірка AP, що й у кнопки (підказка причини в binfo)
  if (sel.ap < OVERWATCH_AP_COST) {
    binfo('Не вистачає AP: дозор коштує ' + OVERWATCH_AP_COST + ', є ' + sel.ap + '.');
    return;
  }
  try {
    const prevLen = mission.state.log.length;
    setOverwatch(mission.state, sel.id);
    enqueueBattleAnims(prevLen); // П6.8: спалах дозору
    binfo(sel.name + ' у дозорі (реакційний вогонь у хід прибульців). AP ' + sel.ap + '/' + sel.maxAp + '.');
  } catch (e) {
    binfo('✗ ' + (e as Error).message);
  }
  renderBattle();
}

function endPlayerTurn(): void {
  if (!playerTurnActive() || !mission) return;
  if (demo.busy) return; // П6.16: триває демо — хід ведуть боти
  hoverPath = null;
  fireMode = null;
  tapCell = null;
  aimCell = null; // П6.14
  try {
    const prevLen = mission.state.log.length;
    endTurn(mission.state); // передати хід прибульцям (aliensTurn очікує їхній хід)
    const actions = aliensTurn(mission.state); // синхронно, одним кліком (5.1.4)
    enqueueBattleAnims(prevLen); // П6.8: відтворення ходу прибульців поверх фінального стану
    if (!checkOutcome()) {
      binfo('Хід прибульців відпрацьовано (' + actions + ' дій). Ваш хід — хід ' + mission.state.turn + '.');
      renderAll();
    }
  } catch (e) {
    binfo('✗ Помилка ШІ: ' + (e as Error).message);
    renderAll();
  }
}

function finishBattle(outcome: 'перемога' | 'поразка'): void {
  if (!mission) return;
  battleResult = outcome;
  const aftermath = applyMissionResult(party.roster, mission.state);
  completeMission(party.geo, mission.briefing.ufoId, outcome);
  for (const s of aftermath.lost) journal('✝ ' + s.name + ' загинув у бою', 'lose', 'battle');
  for (const s of aftermath.wounded)
    journal('✚ ' + s.name + ' поранений — лікарня: ' + party.roster.hospital[s.id] + ' тик(и)', '', 'battle');
  if (outcome === 'перемога') {
    // П4.5 (ADR-0021): премія за перемогу за тип НЛО; надходження — у журнал
    creditMissionBonus(party.econ, mission.briefing.kind);
    const woundedNote = aftermath.wounded.length > 0 ? ' · поранених: ' + aftermath.wounded.length : '';
    el('bresult').innerHTML =
      '<div class="banner win">ЗАЧИЩЕНО ✓ — загін повернувся на базу (' +
      aftermath.survivors.length +
      ' виживших' +
      woundedNote +
      ')</div>' +
      '<button id="btn-close">← Повернутись на геосцену</button>';
  } else {
    el('bresult').innerHTML =
      '<div class="banner lose">ЗАГІН ВТРАЧЕНО ✗ — НЛО лишається активним</div>' +
      '<button id="btn-close">← Повернутись на геосцену</button>';
  }
  (document.getElementById('btn-close') as HTMLButtonElement).onclick = closeBattle;
  binfo('Бій завершено.');
  renderAll();
}

function restart(): void {
  closeBattle();
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

// П6.14: валідні цілі стрільця — живі видимі прибульці (туман, ADR-0006) у
// дальності зброї з лінією вогню — ті самі перевірки, що й assertCanFire у
// ядрі (ADR-0004: влучність від відстані не залежить, дальність — ліміт
// зброї). Чиста функція: стан лише читається (ADR-0002), без RNG (ADR-0003).
export function validFireTargets(state: GameState, shooter: Unit, vis: ReadonlySet<string>): Unit[] {
  const out: Unit[] = [];
  for (const t of state.units) {
    if (t.side !== 'alien' || !t.alive) continue;
    if (!vis.has(t.pos.x + ',' + t.pos.y)) continue; // туман: невидима ціль не підсвічується
    if (distance(shooter.pos, t.pos) > shooter.weapon.range) continue;
    if (!hasLineOfSight(state, shooter.pos, t.pos)) continue;
    out.push(t);
  }
  return out;
}

// ADR-0027 (П6.4): Esc — скасовує спершу зведений режим пострілу,
// за його відсутності — вибір солдата (разом із прев'ю шляху).
function cancelSelection(): void {
  if (!mission) return;
  if (fireMode !== null) {
    fireMode = null;
    tapCell = null;
    aimCell = null; // П6.14
    binfo('Режим пострілу скасовано.');
    renderBattle();
    return;
  }
  if (selectedId !== null || hoverPath !== null) {
    selectedId = null;
    hoverPath = null;
    tapCell = null;
    aimCell = null; // П6.14
    binfo('Вибір знято.');
    renderBattle();
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
    if (!mission) {
      partyTick();
      renderAll();
    }
  };
  el('btn-day').onclick = () => {
    if (!mission) {
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
