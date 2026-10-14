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

import {
  RADAR_RANGE,
  TICK_MINUTES,
  WORLD_W,
  WORLD_H,
  advanceTime,
  detectedUfos,
  geoClock,
  missionTargets,
  type GeoEvent,
} from './core/geo';
import { ALIEN_SPAWN, SQUAD_SPAWN, completeMission, createMission, missionOutcome, type Mission } from './core/mission';
import { applyMissionResult, hireSoldier, hospitalTick, isBankrupt, missionSquad, readySoldiers } from './core/squad';
import { creditMissionBonus, economyTick, HIRE_PRICE, type EconomyEvent } from './core/economy';
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
  type GameEvent,
  type GameState,
  type ShotMode,
  type Unit,
  type Vec2,
} from './core/combat';
import { computeVisibleCells, findPath, pathApCost } from './core/map';
import { aliensTurn, DemoSteps } from './bot';
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
import { SAVE_SLOTS, createParty, eraseSlot, loadFromSlot, saveToSlot, slotMeta, type Party, type SlotStore } from './core/save';

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

const MODE_LABEL: Record<ShotMode, string> = { snap: 'швидкий', aimed: 'прицільний', auto: 'черга' };

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error('Немає елемента #' + id);
  return e as T;
}

// Порядок оголошень важливий (TDZ — див. docs/workflow.md): усі змінні стану,
// які newParty() чи обробники пишуть, оголошуються ДО першого виклику newParty().
// ADR-0027: категорії записів єдиного журналу (фільтри-вкладки).
type LogCat = 'geo' | 'econ' | 'battle';
type LogFilter = 'all' | LogCat;
let logFilter: LogFilter = 'all';

let seenGeoLog = 0;
const knownDetected = new Set<string>();
let seenBattleLog = 0;
let seenEconLog = 0;
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

// П6.16: покрокове відтворення демо-бою — дії ботів по одній (DemoSteps —
// та сама послідовність, що й autoBattle), кожна відтворюється анімацією
// (animsFromEvents → AnimEngine), між діями — коротка пауза на таймері.
// Під час паузи черга анімацій порожня → 0 перерисовок (idle, ADR-0029).
const DEMO_PAUSE_MS = 160;
let demoSteps: DemoSteps | null = null; // не null — триває покрокове демо
let demoTimer: ReturnType<typeof setTimeout> | null = null;
let demoWaitIdle = false; // черга анімацій дії відтворюється — пауза після onIdle

// П6.8 (ADR-0029): анімаційний рушій — черга анімацій, rAF-цикл живе лише
// поки черга непорожня (idle → 0 перерисовок; батарея iPad). Кожен кадр —
// renderBattle з clearRect на весь buffer (урок П6.6). rAF може бути
// відсутній у тестовому середовищі — тоді анімації не ставляться в чергу
// (стан і лог бою від анімації не залежать — критерій «байт-у-байт»).
const hasRaf = typeof requestAnimationFrame === 'function';
const anim = new AnimEngine({
  schedule: (cb) => requestAnimationFrame(cb),
  cancel: (h) => cancelAnimationFrame(h as number),
  draw: () => renderBattle(),
  onIdle: () => {
    // П6.16: анімації дії демо відтворені — коротка пауза і наступна дія
    if (demoWaitIdle) {
      demoWaitIdle = false;
      demoPause();
    }
  },
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

// Прийняти партію у UI-шар: історію журналу не відтворюємо (лише нові події
// після точки входу), трекінг НЛО перебудовуємо з логу (ADR-0006), банкрутство
// перераховуємо (ADR-0021). Спільно для нової і завантаженої партії.
function adoptParty(p: Party): Party {
  seenGeoLog = p.geo.log.length;
  knownDetected.clear();
  for (const e of p.geo.log) if (e.type === 'ufo_detected') knownDetected.add(e.ufoId);
  seenEconLog = p.econ.log.length;
  gameOver = isBankrupt(p.econ, p.roster);
  return p;
}

function newParty(seed: number): Party {
  return adoptParty(createParty(seed));
}

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

function unitName(id: string): string {
  const u = mission?.state.units.find((x) => x.id === id);
  return u ? u.name : id;
}

// Бойові події (state.log) → журнал: постріли і смерті (туман не порушуємо:
// події пишуться лише про реальні дії, а читач — гравець, який їх бачив).
// П7: чистий перетворювач події → рядок журналу; null — не для гравця.
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
  return null; // move / turn / overwatch — не для журналу бою
}

function drainBattleLog(): void {
  if (!mission) return;
  const log = mission.state.log;
  for (; seenBattleLog < log.length; seenBattleLog++) {
    const msg = battleEventText(log[seenBattleLog], unitName);
    if (msg) journal(msg.text, msg.cls, 'battle');
  }
}

// Geo-події → журнал (туман стратегічного шару: лише виявлені НЛО, як у 4.2).
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

function drainGeoLog(): void {
  const log = party.geo.log;
  for (; seenGeoLog < log.length; seenGeoLog++) {
    const e = log[seenGeoLog];
    if (e.type === 'ufo_detected') knownDetected.add(e.ufoId);
    const msg = geoEventText(e, knownDetected);
    if (msg) journal(msg.text, msg.cls);
    // П7.5 (ADR-0032): події перехоплення — джерело анімацій трасерів повітряного бою
    // (сутово відображення: дії ядра вже застосовані; лог лише читається).
    if (hasRaf) geoAnim.push(...interceptAnims(e as InterceptEvent));
  }
}

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

function drainEconLog(): void {
  const log = party.econ.log;
  for (; seenEconLog < log.length; seenEconLog++) {
    const msg = economyEventText(log[seenEconLog]);
    journal(msg.text, msg.cls, 'econ');
  }
}

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
}

function renderGeo(): void {
  drainGeoLog();
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
  drainEconLog();
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

// --- П5.3: панель збереження (ADR-0026) ---

// ADR-0026: сховище — localStorage, ключі rubezh.save.1..3. Ядро бачить лише
// абстракцію SlotStore (save.ts); тут — конкретний браузерний адаптер.
const store: SlotStore = {
  read: (slot) => {
    try {
      return localStorage.getItem('rubezh.save.' + slot);
    } catch {
      return null;
    }
  },
  write: (slot, data) => localStorage.setItem('rubezh.save.' + slot, data),
  remove: (slot) => localStorage.removeItem('rubezh.save.' + slot),
};

// Недоступний localStorage (приватний режим тощо) — повідомлення в UI (ADR-0026).
let storageOk = true;
function detectStorage(): void {
  try {
    localStorage.setItem('rubezh.probe', '1');
    localStorage.removeItem('rubezh.probe');
    storageOk = true;
  } catch {
    storageOk = false;
  }
}

function renderSavePanel(): void {
  const box = el('save-panel');
  box.innerHTML = '';
  if (!storageOk) {
    box.innerHTML = '<div class="meta">Сховище недоступне (приватний режим?) — збереження вимкнено.</div>';
    return;
  }
  // П7.5 (ADR-0026): збереження вимкнене і в повітряному бою — погоня/бій не переривається
  const busy = mission !== null || party.intercept.fighter.status === 'погоня' || party.intercept.fighter.status === 'бій';
  for (let slot = 1; slot <= SAVE_SLOTS; slot++) {
    const row = document.createElement('div');
    row.className = 'save-row';
    const meta = document.createElement('span');
    meta.id = 'slot-' + slot;
    meta.className = 'meta';
    const json = store.read(slot);
    const empty = json === null;
    if (json === null) meta.textContent = '—';
    else {
      try {
        const m = slotMeta(json);
        const mnt = m.minute % 1440;
        meta.textContent =
          'Д' +
          m.day +
          ' ' +
          String(Math.floor(mnt / 60)).padStart(2, '0') +
          ':' +
          String(mnt % 60).padStart(2, '0') +
          ' · сід ' +
          m.seed +
          ' · ' +
          m.money +
          ' · ' +
          m.aliveSoldiers +
          ' солд · ' +
          m.savedAt.slice(0, 16).replace('T', ' ');
      } catch {
        meta.textContent = 'пошкоджений слот';
      }
    }
    const bSave = document.createElement('button');
    bSave.id = 'btn-save-' + slot;
    bSave.textContent = 'Зберегти';
    bSave.disabled = busy || gameOver;
    bSave.onclick = () => saveSlot(slot);
    const bLoad = document.createElement('button');
    bLoad.id = 'btn-load-' + slot;
    bLoad.textContent = 'Завантажити';
    bLoad.disabled = busy || empty;
    bLoad.onclick = () => loadSlot(slot);
    const bDel = document.createElement('button');
    bDel.id = 'btn-del-' + slot;
    bDel.textContent = 'Видалити';
    bDel.disabled = busy || empty;
    bDel.onclick = () => deleteSlot(slot);
    row.append(meta, bSave, bLoad, bDel);
    box.appendChild(row);
  }
}

// ADR-0026: збереження можливе лише на геосцені (місія не переривається).
function saveSlot(slot: number): void {
  // П7.5 (ADR-0026): під час погоні/бою збереження вимкнене (патерн П6.3 — бій не переривається)
  if (mission !== null || gameOver || party.intercept.fighter.status === 'погоня' || party.intercept.fighter.status === 'бій') return;
  try {
    saveToSlot(store, slot, party, new Date().toISOString());
    journal('Збережено: слот ' + slot + '.');
  } catch (e) {
    journal('✗ Збереження не вдалось: ' + (e as Error).message, 'lose');
  }
  renderSavePanel();
}

function loadSlot(slot: number): void {
  if (mission !== null) return;
  try {
    party = adoptParty(loadFromSlot(store, slot));
    journal('Завантажено: слот ' + slot + ' — ' + geoClock(party.geo) + ', баланс ' + party.econ.money + '.');
  } catch (e) {
    journal('✗ Завантаження не вдалось: ' + (e as Error).message, 'lose');
  }
  renderAll();
}

function deleteSlot(slot: number): void {
  if (mission !== null) return;
  try {
    eraseSlot(store, slot);
    journal('Слот ' + slot + ' видалено.');
  } catch (e) {
    journal('✗ ' + (e as Error).message, 'lose');
  }
  renderSavePanel();
}

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
  drainBattleLog();
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

function renderAll(): void {
  // ADR-0027: фокусна зона — геосцена або бій (не «два екрани»)
  el('geo-panel').classList.toggle('hidden', mission !== null);
  el('battle-panel').classList.toggle('hidden', mission === null);
  // ADR-0027 (П6.3): у бою колонка стану приглушена й неактивна —
  // джерело стану тоді топбар і контекст-стрічка бою
  el('status').classList.toggle('dimmed', mission !== null);
  renderGeo();
  renderUfos();
  renderFighter();
  renderFinances();
  renderRoster();
  renderSavePanel();
  if (mission) renderBattle();
}

function closeBattle(): void {
  demoStop(); // П6.16: демо могло тривати — таймер і стан драйвера скидаємо
  anim.cancel(); // П6.8: бій закрито — чергу анімацій скидаємо
  mission = null;
  battleResult = null;
  selectedId = null;
  fireMode = null;
  hoverPath = null;
  tapCell = null;
  aimCell = null; // П6.14
  seenBattleLog = 0;
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
  seenBattleLog = 0;
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
  if (demoSteps !== null) return; // П6.16: триває демо — бойовище не клікається
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
  if (demoSteps !== null) return; // П6.16: триває демо — керування заблоковано
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
  if (demoSteps !== null) return; // П6.16: триває демо — керування заблоковано
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
  if (demoSteps !== null) return; // П6.16: триває демо — хід ведуть боти
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

// П6.16: наступна дія демо — DemoSteps виконує одну дію ботів, анімації її
// подій ставляться в чергу; коли відтворяться (onIdle) або анімацій нема
// (endTurn) — коротка пауза і далі. renderBattle після кожної дії тримає
// стрічку/кнопки/журнал бою в актуальному стані.
function demoNext(): void {
  if (!mission || !demoSteps) return;
  const prevLen = mission.state.log.length;
  const r = demoSteps.step(mission.state);
  renderBattle();
  if (r.over) {
    const outcome = missionOutcome(mission.state);
    demoStop();
    // фінальний банер — без змін (П6.16): finishBattle той самий, що в звичайному бою
    if (outcome === 'перемога' || outcome === 'поразка') finishBattle(outcome);
    else {
      binfo('Демо: бій не завершився за ліміт півходів.');
      renderAll();
    }
    return;
  }
  // Патерн enqueueBattleAnims, але тут власний гейт hasRaf: без rAF (тести)
  // анімації не ставляться — демо крокує лише паузами таймера.
  const anims = hasRaf ? animsFromEvents(mission.state.log.slice(prevLen), mission.state.units) : [];
  if (anims.length > 0) {
    demoWaitIdle = true; // пауза — після відтворення черги (onIdle)
    anim.push(...anims);
  } else {
    demoPause(); // turn-події не анімуються — пауза одразу
  }
}

function demoPause(): void {
  demoTimer = setTimeout(demoNext, DEMO_PAUSE_MS);
}

// П6.16: зупинка демо — таймер і прапорці скидаємо (чергу анімацій скидає
// anim.cancel() викликаючого — closeBattle/launchMission, як і раніше).
function demoStop(): void {
  demoSteps = null;
  demoWaitIdle = false;
  if (demoTimer !== null) {
    clearTimeout(demoTimer);
    demoTimer = null;
  }
}

function demoBattle(): void {
  if (!mission || battleResult !== null || demoSteps !== null) return;
  // П6.16: замість миттєвого autoBattle — покрокове відтворення: дії по одній,
  // лог байт-у-байт ідентичний (DemoSteps), дивитись приємніше.
  demoSteps = new DemoSteps(240);
  binfo('Демо: покрокове відтворення бою…');
  demoNext();
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
  el('btn-demo').onclick = demoBattle;
  // ADR-0027: фільтри-вкладки єдиного журналу
  for (const b of document.querySelectorAll<HTMLButtonElement>('#log-tabs button')) {
    b.onclick = () => setLogFilter(b.dataset.filter as LogFilter);
  }
  const bc = el<HTMLCanvasElement>('battle');
  bc.addEventListener('click', battleCanvasClick);
  bc.addEventListener('mousemove', battleCanvasHover);
  bc.addEventListener('mouseleave', battleCanvasLeave);
  // ADR-0027 (П6.4): гарячі клавіші — на document (бій у фокусі канви не потрібен)
  document.addEventListener('keydown', onKeyDown);
  detectStorage();
  renderAll();
  journal('Партію розпочато. Рухайте час — радар шукає НЛО.');
  if (!storageOk) journal('✗ Сховище недоступне — збереження вимкнено (приватний режим?).', 'lose');
}
