// пR.2 (ADR-0037): бойовище і флоу тактичного бою — винесено з main.ts без
// зміни поведінки (П6.3/П6.8/П6.13/П6.14/П6.16). Тут — рендер бойовища
// (контекст-стрічка бою, туман, прев'ю шляху, обведення цілей, анімаційний
// шар, шанс попадання), запуск/закриття/завершення місії, перевірка результату
// і валідні цілі (чиста функція). Стан бою (місія, вибір солдата, зведений
// режим, прев'ю шляху, тап-тап) — явний об'єкт BattleUIState, який передає
// застосунок (замість глобальних let — мітигація плану рефакторингу);
// обробники вводу (модуль input) працюють із тим самим об'єктом.

import { SQUAD_SPAWN, completeMission, createMission, missionOutcome, type Mission } from '../core/mission';
import { awardTrophies } from '../core/research';
import { completeAssault, completeGate, createAssault, createGateMission, type CampaignBattleOptions } from '../core/assault';
import { applyMissionResult, deployRoles, missionSquad } from '../core/squad';
import { RANK_NAMES, rankOf, type SoldierCareer } from '../core/career';
// Т.28 (ADR-0091): броня й око загиблих — на склад, витратники зникають.
// П11.4 (ADR-0058): витратники загону — копія в бій і розрахунок після бою.
import { deployConsumables, removeLostEquipment, settleConsumables } from '../core/workshop';
import { creditMissionBonus, missionBonus } from '../core/economy';
import {
  EVAC_AP_COST,
  GRENADE_AP_COST,
  HEAL_AP_COST,
  OVERWATCH_AP_COST,
  calculateHitChance,
  shotCover,
  distance,
  grenadeZone,
  hasLineOfSight,
  weaponHasMode,
  RIFLE,
  type GameState,
  type ShotMode,
  type Unit,
  type Vec2,
} from '../core/combat';
import { TILE_KEY, fireModeHint } from './toolbar';
import { reachableCells, sideVisibleCells } from '../core/map';
import { geoClock } from '../core/geo';
import type { Party } from '../core/save';
import {
  drawAnimFrame,
  drawChanceLabel,
  drawNightTerrain,
  drawPathPreview,
  drawReachZone,
  drawTargetFrame,
  drawUnitSprite,
  shotAim,
  unitRing,
} from '../render';
import {
  animT,
  animsFromEvents,
  moveAnimPos,
  pendingAlienMoveStarts,
  pendingDeathStarts,
  pendingHp,
  recoilPx,
  shakeOffset,
  tracerShare,
  type Anim,
  type TerrainCell,
} from '../core/render-core';
import { takeHpBefore } from './hp-track';
import { el } from './dom';
import { BCELL } from './grid';
import { type LogCat } from './journal';
import { ICONS } from './icons';
import { ROLE_INFO, roleTileView } from './roles';
import { byGender, probeNo, ticksText } from './text';
import { squadCards, squadOrder, squadStripHtml } from './squad-strip';
import { enemyMenuHtml, enemyMenuPlace, enemyMenuView } from './enemy-menu';
import { previewCover } from './cover-ui';
import {
  resultCardHtml,
  summarizeAlienTurn,
  TURN_PLATE_ACTING,
  TURN_PLATE_DONE,
  TURN_PLATE_MIN_MS,
  TURN_PLATE_SKIP,
} from './battle-feedback';
import type { AmbientBattleScene, AmbientUnitView } from './ambient';

// П15.2 (ADR-0075): третій результат бою «евакуйовано» — той самий виклик
// finish; повний UI евакуації (тулбар/клавіша V/підсвітка/звук) — П15.4.
export type BattleOutcome = 'перемога' | 'поразка' | 'евакуйовано';

// Стан бою UI — єдиний об'єкт замість модульних let у main.ts; його ж
// використовують обробники вводу (тап-тап, зведений режим, прев'ю шляху).
export interface BattleUIState {
  mission: Mission | null;
  battleResult: BattleOutcome | null;
  selectedId: string | null; // вибраний солдат
  fireMode: ShotMode | null; // «зведений» режим пострілу
  // П11.6 (ADR-0058): зведений режим витратника — аптечка/граната; п16.4 (ADR-0147): дії ролей —
  // 'precise' («Точний постріл», разом із fireMode 'aimed') і 'aid' («Польова допомога», ціль як у гелю)
  itemMode: 'medkit' | 'grenade' | 'precise' | 'aid' | null;
  hoverPath: Vec2[] | null; // прев'ю шляху під курсором
  hoverAp: number;
  tapCell: Vec2 | null; // ADR-0027 (П6.4): клітинка першого тапу — повторний тап у неї робить хід
  aimCell: Vec2 | null; // П6.14: клітинка цілі під наведенням/першим тапом у зведеному режимі
  menuId: string | null; // Т.131: демон, на якому відкрите меню (src/ui/enemy-menu.ts)
}

// Анімаційний рушій бою (AnimEngine у main.ts) — тонкий адаптер: черга,
// скасування, активний кадр і його час (П6.8).
export interface BattleAnimAdapter {
  active(): Anim | null;
  now: number;
  push(anims: Anim[]): void;
  cancel(): void;
  queued(): readonly Anim[]; // П14.4: знімок черги — хід ШІ відтворюється поверх фінального стану
}

// П14.8 (ADR-0073): ambient-шар бою — малювальник «живих» ефектів поверх
// кадру (пульс стін, підсвічування поранених). Гейти — в ambient-модулі
// (тумблер, typeof-rAF): вимкнено/jsdom — 0 Canvas-викликів.
export interface BattleAmbient {
  paintBattle(ctx: CanvasRenderingContext2D, scene: AmbientBattleScene): void;
  // Т.132 (ADR-0121): «дихання» бійця в спокої, 0..1 за клітинкою; вимкнено — 0
  breath?(at: Vec2): number;
}

// Залежності від шару застосунку (main.ts).
export interface BattleDeps {
  getParty(): Party;
  journal(text: string, cls?: string, cat?: LogCat): void;
  drainBattle(): void; // нові події бою → журнал (seen-трекінг у src/ui/journal.ts)
  resetBattleLog(): void; // новий бій: seenBattleLog = 0
  renderAll(): void;
  anim: BattleAnimAdapter;
  hasRaf(): boolean; // rAF нема у тестовому середовищі — анімації не ставляться в чергу
  stopAuto(): void; // П13.3 (ADR-0067): закриття бою зупиняє авто-бій
  autoBusy(): boolean; // П13.3: стан драйвера авто-бою — підпис плитки «Авто»/«Стоп»
  cancelGeoAnim(): void; // П6.9: геосцену сховано — пульс радара скидаємо
  ambient: BattleAmbient; // П14.8: ефекти поверх кадру (без впливу на клік-математику)
}

export interface BattleUI {
  playerTurnActive(): boolean;
  animating(): boolean; // Т.121: грає анімація бою (черга непорожня) — порожня клітинка поля мовчить
  selectedUnit(): Unit | undefined;
  visibleCells(): Set<string>;
  displayedAlienAt(cell: Vec2): Unit | undefined; // П14.4: демон у клітинці за відображуваною позицією
  renderBattle(): void;
  binfo(text: string): void;
  launch(probeId: string): void;
  launchAssault(): void; // п18.4 (ADR-0156): штурм бази — бій одразу (рішення власника «А. Мінімум»)
  launchGate(): void; // п18.4: фінал «Брама Розриву» — кнопкою панелі зондів
  close(): void;
  finish(outcome: BattleOutcome): void;
  checkOutcome(): boolean;
  enqueueAnims(prevLen: number): void; // П6.8: нові події логу бою → анімації
  alienTurnDone(prevLen: number, info: string): void; // Т.33: плашка ходу демонів, потім підсумок і підказка info
  dismissTurnPlate(force?: boolean): void; // Т.33: перша дія гравця прибирає підсумок
  skipAlienTurn(): boolean; // Т.117: ручний бій — обірвати анімації ходу демонів, одразу підсумок; true — плашку пропущено
  autoAlienTurn(from: number | null): void; // Т.116: авто-бій — null: хід демонів почався (плашка), число: скінчився (підсумок подій від from)
  autoStopped(): void; // Т.116: авто-бій зупинено — плашка «діють» зникає, підсумок лишається
}

// п18.4 (ADR-0156): банер результату штурму чи брами.
export function campaignBanner(op: 'штурм' | 'брама', outcome: BattleOutcome): string {
  if (op === 'штурм') return outcome === 'перемога' ? 'ШТУРМ ВІДБИТО ✓' : 'ШТУРМ НЕ ВІДБИТО ✗ — втрачено 30 % кредитів і половину складу';
  if (outcome === 'перемога') return 'БРАМУ РОЗРИВУ ЗАКРИТО ✓ — ПЕРЕМОГА';
  return 'БРАМА РОЗРИВУ ВСТОЯЛА ✗ — повтор через добу';
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
    if (!hasLineOfSight(state, shooter.pos, t.pos, shooter.side)) continue;
    out.push(t);
  }
  return out;
}

// П11.6 (ADR-0058): валідні цілі аптечки — живі поранені союзники на
// відстані ≤1 (Чебишев), включно із самим лікарем. Ті самі перевірки, що й
// useMedkit у ядрі. Чиста функція: стан лише читається, без RNG.
export function validHealTargets(state: GameState, healer: Unit): Unit[] {
  const out: Unit[] = [];
  for (const t of state.units) {
    if (t.side !== 'player' || !t.alive) continue;
    if (distance(healer.pos, t.pos) > 1) continue;
    if (t.hp >= t.maxHp) continue;
    out.push(t);
  }
  return out;
}

// Т.71 (ADR-0075): чому оперативник не може евакуюватись — ті самі перевірки, що й evacuate
// у ядрі (клітинка висадки, потім AP); null — може. Чиста функція: стан лише читається, без RNG.
export function evacBlockReason(state: GameState, u: Unit): 'cell' | 'ap' | null {
  if (!state.evacZone?.some((c) => c.x === u.pos.x && c.y === u.pos.y)) return 'cell';
  return u.ap < EVAC_AP_COST ? 'ap' : null;
}

export function createBattleUI(ui: BattleUIState, deps: BattleDeps): BattleUI {
  // П14.3 (фідбек П14.2): напрямок погляду юнітів — суто відображення,
  // детерміновано (без RNG, ADR-0003): напрямок останнього руху/цілі
  // запам'ятовується на юніт; дефолти — нативні напрямки кадрів атласа
  // (оперативник — вправо, демон Розриву — вліво; спавни: загін зліва,
  // Розрив справа). Ядро і розкладка кадрів не зачіпаються — фліп
  // (scale(-1,1)) робить drawAtlasUnit у render.ts.
  const facing = new Map<string, 1 | -1>();

  function binfo(text: string): void {
    el('binfo').textContent = text;
  }

  // Т.33: плашка ходу демонів. acting — анімації ще грають, хід гравця не починається; далі — підсумок до першої дії.
  // skip — пропуск плашки «діють» (Т.117), лише в ручному бою
  type TurnPlate = { acting: boolean; skip: (() => void) | null; lines: string[] };
  let plate: TurnPlate | null = null;
  let plateTimer: ReturnType<typeof setTimeout> | null = null;

  function dropPlate(): void {
    if (plateTimer !== null) clearTimeout(plateTimer);
    plateTimer = null;
    plate = null;
  }

  function dismissTurnPlate(force = false): void {
    if (plate === null || (plate.acting && !force)) return;
    dropPlate();
    renderBattle();
  }

  // Хід демонів уже застосовано (події логу від prevLen): без rAF підсумок одразу; з rAF — плашка, поки черга анімацій не спорожніє.
  function alienTurnDone(prevLen: number, info: string): void {
    const mission = ui.mission;
    if (!mission) return;
    dropPlate();
    const p: TurnPlate = {
      acting: deps.hasRaf(),
      skip: null,
      lines: summarizeAlienTurn(mission.state.log.slice(prevLen), mission.state.units, visibleCells()),
    };
    plate = p;
    const finish = (): void => {
      if (plateTimer !== null) clearTimeout(plateTimer);
      plateTimer = null;
      p.acting = false;
      p.skip = null;
      binfo(info);
      deps.renderAll();
    };
    const settle = (): void => {
      if (deps.anim.active() !== null || deps.anim.queued().length > 0) {
        plateTimer = setTimeout(settle, 100);
        return;
      }
      finish();
    };
    binfo(p.acting ? '' : info);
    if (!p.acting) return;
    plateTimer = setTimeout(settle, TURN_PLATE_MIN_MS);
    // Т.117: пропуск — черга анімацій скидається, стан ядра вже застосовано, підсумок той самий
    p.skip = () => {
      deps.anim.cancel();
      finish();
    };
  }

  function skipAlienTurn(): boolean {
    if (plate?.skip == null) return false;
    plate.skip();
    return true;
  }

  // Т.116 (рішення власника, варіант Б): в авто-бої — та сама плашка, поки ходять демони, і той самий підсумок,
  // коли хід повернувся загону; підсумок тримається до наступного ходу демонів, після «Стоп» — до першої дії.
  // Темп авто-бою не змінюється: плашка не чекає анімацій і TURN_PLATE_MIN_MS.
  function autoAlienTurn(from: number | null): void {
    const mission = ui.mission;
    if (!mission) return;
    dropPlate();
    plate =
      from === null
        ? { acting: true, skip: null, lines: [] }
        : { acting: false, skip: null, lines: summarizeAlienTurn(mission.state.log.slice(from), mission.state.units, visibleCells()) };
  }

  function autoStopped(): void {
    if (plate?.acting === true) dropPlate();
  }

  function renderTurnPlate(): void {
    const box = el('bturn');
    box.classList.toggle('hidden', plate === null);
    box.classList.toggle('done', plate !== null && !plate.acting);
    const acting = plate?.skip != null ? [...TURN_PLATE_ACTING, TURN_PLATE_SKIP] : [...TURN_PLATE_ACTING]; // в авто-бої пропуску немає
    const lines = plate === null ? [] : plate.acting ? acting : [TURN_PLATE_DONE, ...plate.lines];
    box.replaceChildren(
      ...lines.map((t, i) => {
        const d = document.createElement(i === 0 ? 'b' : 'div');
        d.textContent = t;
        if (t === TURN_PLATE_SKIP) d.className = 'bturn-skip';
        return d;
      })
    );
  }

  // Т.33: причина під неактивною плиткою — замість підпису (підпис — aria-label)
  function tileReason(b: HTMLButtonElement, reason: string | null): void {
    const cap = b.querySelector<HTMLElement>('.tb-cap');
    if (cap === null) return;
    cap.textContent = reason ?? b.getAttribute('aria-label');
    cap.classList.toggle('tb-why', reason !== null);
  }

  function playerTurnActive(): boolean {
    return ui.mission !== null && ui.battleResult === null && ui.mission.state.activeSide === 'player' && plate?.acting !== true;
  }

  function animating(): boolean {
    return deps.anim.active() !== null;
  }

  function selectedUnit(): Unit | undefined {
    if (!ui.mission || !ui.selectedId) return undefined;
    return ui.mission.state.units.find((u) => u.id === ui.selectedId && u.alive);
  }

  function visibleCells(): Set<string> {
    // п17.4: туман сторони гравця — ядро (`sideVisibleCells`, закривачі сторони)
    if (!ui.mission) return new Set<string>();
    return sideVisibleCells(ui.mission.state, 'player');
  }

  // П14.4 (фідбек прев'ю): демон, який ВІДОБРАЖАЄТЬСЯ у клітинці. Під час
  // відтворення черги ходу ШІ демон стоїть на початку свого шляху
  // (pendingAlienMoveStarts — фінальна позиція не споїлиться), тож клік по
  // видимій клітині має шукати саме відображувану позицію. Суто відображення:
  // бойові гілки вводу (постріл/лікування) працюють із фактичним u.pos —
  // валідність дій і туман не зачіпаються (ADR-0006).
  function displayedAlienAt(cell: Vec2): Unit | undefined {
    const mission = ui.mission;
    if (!mission) return undefined;
    const pending = pendingAlienMoveStarts(deps.anim.queued());
    for (const u of mission.state.units) {
      if (!u.alive || u.side !== 'alien') continue;
      const at = pending.get(u.id) ?? u.pos;
      if (at.x === cell.x && at.y === cell.y) return u;
    }
    return undefined;
  }

  // П6.8: нові події логу бою → анімації (суто відображення: дії ядра вже
  // застосовані миттєво, лог лише читається і не змінюється).
  // П14.4: видимість (туман, ADR-0006) передається у перетворювач — числа
  // пошкоджень породжуються лише для видимих цілей.
  function enqueueBattleAnims(prevLen: number): void {
    const mission = ui.mission;
    if (!mission) return;
    const hpBefore = takeHpBefore(mission.state); // Т.218: і без rAF — знімок не застаріває
    if (!deps.hasRaf()) return;
    deps.anim.push(animsFromEvents(mission.state.log.slice(prevLen), mission.state.units, visibleCells(), hpBefore));
  }

  // Т.130 (кандидат 127): смуга загону — картки замість плашки «Юніт». Порядок — висадки
  // (запам'ятовується на місію); HTML міняється лише за зміни стану: перемальовка кадру
  // (ambient, анімації) не замінює кнопку між натисканням і відпусканням — клік не губиться.
  const squadOrders = new WeakMap<Mission, string[]>();
  // п16.4: кар'єри загону — знімок на запуску місії (launch): загиблий після finish зникає з ростеру,
  // а його картка лишається з позивним і шевроном, з якими він ішов у бій
  const squadCareers = new WeakMap<Mission, Record<string, SoldierCareer>>();
  let squadHtml = '';
  function renderSquadStrip(mission: Mission): void {
    let order = squadOrders.get(mission);
    if (order === undefined) {
      order = squadOrder(mission.state);
      squadOrders.set(mission, order);
    }
    const html = squadStripHtml(squadCards(mission.state, order, ui.selectedId, squadCareers.get(mission)));
    const box = el('bsquad');
    if (html === squadHtml && box.childElementCount > 0) return;
    squadHtml = html;
    // аудит PR #443: фокус на картці (клавіатура) після заміни кнопки — на ту саму картку
    const focused = box.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.unit : undefined;
    box.innerHTML = html;
    if (focused !== undefined) box.querySelector<HTMLElement>('[data-unit="' + focused + '"]')?.focus();
  }

  // Т.131 (кандидат 128): меню на ворогові — картка поверх поля біля демона. Лише в хід загону,
  // без анімацій і авто-бою, на живому видимому демоні (туман, ADR-0081); інакше сховане.
  // HTML — лише за зміни (як смуга загону): перемальовка кадру не губить клік по кнопці.
  let menuHtml = '';
  function renderEnemyMenu(mission: Mission): void {
    const box = el('benemy');
    const t = ui.menuId === null ? undefined : mission.state.units.find((u) => u.id === ui.menuId && u.alive);
    const seen = t !== undefined && visibleCells().has(t.pos.x + ',' + t.pos.y);
    // аудит PR #444: демон загинув чи пішов у туман — меню закрито (не лише сховано), інакше
    // наступний тап мовчки «закривав» невидиму картку
    if (ui.menuId !== null && (t === undefined || (!seen && !animating()))) ui.menuId = null;
    if (t === undefined || !seen || !playerTurnActive() || animating() || deps.autoBusy()) {
      box.classList.add('hidden');
      return;
    }
    const html = enemyMenuHtml(enemyMenuView(mission.state, t, selectedUnit()));
    if (html !== menuHtml || box.childElementCount === 0) {
      menuHtml = html;
      box.innerHTML = html;
    }
    box.classList.remove('hidden');
    box.dataset.unit = t.id;
    box.setAttribute('aria-label', t.name);
    // місце: клітинка демона в CSS px контейнера #battle-stage (канва масштабується)
    const cv = el<HTMLCanvasElement>('battle');
    const k = cv.width > 0 ? cv.clientWidth / cv.width : 0;
    const field = { left: cv.offsetLeft, top: cv.offsetTop, width: cv.clientWidth, height: cv.clientHeight };
    const cell = { left: field.left + t.pos.x * BCELL * k, top: field.top + t.pos.y * BCELL * k, width: BCELL * k, height: BCELL * k };
    box.classList.remove('compact');
    let at = enemyMenuPlace(cell, field, box.offsetWidth, box.offsetHeight);
    // мале поле, демон у центрі: повна картка ніде не вміщується — компактна (без рядків
    // характеристик; вони в #binfo) стає під чи над демоном (аудит PR #444)
    if (at.covers) {
      box.classList.add('compact');
      at = enemyMenuPlace(cell, field, box.offsetWidth, box.offsetHeight);
    }
    box.style.left = at.left + 'px';
    box.style.top = at.top + 'px';
    box.dataset.side = at.side;
  }

  function renderBattle(): void {
    const mission = ui.mission;
    if (!mission) return;
    deps.drainBattle();
    renderTurnPlate();
    // ADR-0027 (П6.3): контекст-стрічка бою — тип місії, заморожений час,
    // чий хід (активний юніт HP/AP — з Т.130 у картках смуги загону). Час геосцени стоїть (ADR-0026: місія
    // не переривається) — показуємо його як «заморожено».
    el('bctx-kind').textContent =
      mission.briefing.op === 'штурм' ? 'штурм бази' : mission.briefing.op === 'брама' ? 'Брама Розриву' : mission.briefing.kind;
    el('bctx-time').textContent = geoClock(deps.getParty().geo) + ' · заморожено';
    // Т.33: поки плашка ходу демонів на екрані — хід ще їхній (стан ядра вже передав хід загону)
    el('bctx-turn').textContent =
      plate?.acting === true
        ? 'хід демонів Розриву'
        : 'хід ' + mission.state.turn + ' · ' + (mission.state.activeSide === 'player' ? 'загін' : 'демони Розриву');
    renderSquadStrip(mission);
    renderEnemyMenu(mission);
    const cv = el<HTMLCanvasElement>('battle');
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    // П6.6: повне очищення кадру — клітинки заливаються з проміжком у 1px,
    // і без clearRect ці проміжки накопичують залишки (маркери дозору тощо).
    // Патерн renderGeo: кадр еквівалентний малюванню з нуля.
    ctx.clearRect(0, 0, cv.width, cv.height);
    const st = mission.state;

    const vis = visibleCells();

    // П6.8: активна анімація руху — юніт малює анімаційний шар у проміжній
    // позиції, статичний прохід його пропускає. Туман: рух прибульця показуємо
    // лише у видимих клітинках — невидимий рух не розкриває позицію (ADR-0006).
    const activeAnim = deps.anim.active();
    let movingId: string | null = null;
    if (activeAnim !== null && activeAnim.kind === 'move') {
      const p = moveAnimPos(activeAnim, animT(activeAnim, deps.anim.now), BCELL);
      const cellK = Math.floor(p.cx / BCELL) + ',' + Math.floor(p.cy / BCELL);
      if (activeAnim.side === 'player' || vis.has(cellK)) movingId = activeAnim.unitId;
    }

    // П14.2 (ADR-0072): поза «вогонь» — стрілець активного трасера (кадр з
    // атласа за станом юніта, без RNG; атлас не готовий — матриці, та сама
    // логіка вибору). Туман: невидимий стрілець у статичному проході й так
    // пропускається — поза на нього нічого не розкриває (ADR-0006).
    let firingId: string | null = null;
    // п17.3: трасер з туману (`fog`) стрільця на полі не має — і пози «вогонь» теж
    if (activeAnim !== null && activeAnim.kind === 'tracer' && activeAnim.fog !== true) {
      const shooter = st.units.find(
        (u) => u.alive && u.side === activeAnim.side && u.pos.x === activeAnim.from.x && u.pos.y === activeAnim.from.y
      );
      if (shooter !== undefined) firingId = shooter.id;
    }
    // Т.132 (ADR-0121): віддача стрільця — перші кадри польоту кулі; Т.144 (ADR-0125): «менше руху» — без віддачі
    const recoil =
      activeAnim !== null && activeAnim.kind === 'tracer' && activeAnim.calm !== true && activeAnim.melee !== true // п17.5: удар кігтями — без віддачі
        ? recoilPx(animT(activeAnim, deps.anim.now), tracerShare(activeAnim))
        : 0;

    // П14.4 (фідбек прев'ю): ходи демонів у черзі ще не відтворені —
    // статичний прохід не малює їх у фінальних клітинках до початку їхньої
    // анімації (синхронний хід ШІ вже застосований — інакше демон
    // «з'являється» одразу у цілі і хід не анімується). До відтворення
    // свого ходу демон стоїть на початку шляху; туманна ділянка не
    // показується (туман не розкривається, ADR-0006).
    const pendingMove = pendingAlienMoveStarts(deps.anim.queued());
    // Фікс фідбеку валідації П14.8 («старий баг» блимання): смерть застосована
    // миттєво, кадр згасання ще в черзі — загиблий лишається на полі до свого
    // кадру (поза «зник → з'явився → зник»); туман — як для живих (ADR-0006).
    const pendingDeath = pendingDeathStarts(deps.anim.queued());
    // Т.218: HP, яке черга ще не відіграла (влучання летить) — смуга й число до свого кадру
    const shownHp = pendingHp(deps.anim.queued());

    // П6.13: нічна палітра. Легка тряска канвасу при влучанні — зсув усього кадру
    // на фазі спалаху трасера (через AnimEngine — лише в кадрах анімації); фон
    // канви збігається з CSS-тлом, оголений край непомітний. Туман: зсув
    // однаковий для всіх клітинок — сенс туману незмінний (ADR-0006).
    const shake = shakeOffset(activeAnim, deps.anim.now);
    ctx.save();
    ctx.translate(shake.dx, shake.dy);
    // П14.8: клітинки кадру — спільні для терену і ambient-сцени (стіни wall-pulse)
    const cells: TerrainCell[] = Array.from({ length: st.map.height }, (_, y) =>
      Array.from({ length: st.map.width }, (_, x): TerrainCell => {
        const k2 = x + ',' + y;
        const cell: TerrainCell = { x, y, blocked: st.map.blocked.has(k2), visible: vis.has(k2) };
        if (st.map.low?.has(k2) === true) cell.low = true; // п20.2: без поля — клітинка як досі
        return cell;
      })
    ).flat();
    const px = cv.clientWidth > 0 ? cv.width / cv.clientWidth : 1;
    drawNightTerrain(ctx, cv.width, cv.height, cells, BCELL, px);

    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = 'rgba(110,168,255,0.5)';
    for (const p of SQUAD_SPAWN) ctx.strokeRect(p.x * BCELL + 2, p.y * BCELL + 2, BCELL - 5, BCELL - 5);
    ctx.setLineDash([]);

    // Т.44: зона ходу вибраного оперативника — у хід гравця, поки не зведено ні постріл,
    // ні витратник; рахується і в тумані (рельєф відомий, юніт у тумані зони не обрізає — ADR-0081)
    const sel = selectedUnit();
    // Т.119: зона ходу і прев'ю шляху — лише коли гравець справді може ходити: не в авто-бої
    // і не під час анімації (рух, постріл)
    const calm = !deps.autoBusy() && activeAnim === null;
    if (calm && sel && !sel.turret && playerTurnActive() && ui.fireMode === null && ui.itemMode === null) {
      drawReachZone(ctx, reachableCells(st, sel.pos, sel.ap, vis), sel.pos, BCELL);
    }

    // Т.44: прев'ю шляху під курсором — лінія від оперативника і ціна «<число> AP» біля цілі:
    // зелені — вистачає AP, червоні — ні. Т.45: у зведеному режимі пострілу, гранати чи гелю
    // прев'ю не малюється (шлях міг лишитись від наведення до зведення) — як і зона ходу
    if (calm && ui.hoverPath && sel && playerTurnActive() && ui.fireMode === null && ui.itemMode === null) {
      drawPathPreview(ctx, {
        from: sel.pos,
        path: ui.hoverPath,
        ap: ui.hoverAp,
        affordable: ui.hoverAp <= sel.ap,
        cell: BCELL,
        cw: cv.width,
        px,
        // п20.5 (EARS 4; рішення власника «А. Найслабше»): щиток укриття на клітинці цілі ходу
        cover: previewCover(st, sel, ui.hoverPath[ui.hoverPath.length - 1] ?? sel.pos, vis),
      });
    }

    // П6.14: у зведеному режимі пострілу — обведення всіх валідних цілей
    // (видимі прибульці, дистанція і лінія вогню). Туман: невидимі цілі
    // не підсвічуються (ADR-0006) — підказка лише про те, що гравець бачив.
    let targets: Unit[] = [];
    if (ui.fireMode !== null && sel && playerTurnActive()) targets = validFireTargets(st, sel, vis);
    for (const t of targets) drawTargetFrame(ctx, { gx: t.pos.x, gy: t.pos.y, cell: BCELL });

    // П11.6 (ADR-0058): обведення валідних цілей аптечки (поранені союзники
    // поруч) і прев'ю зони вибуху гранати (епіцентр + хрест) після першого тапу.
    if ((ui.itemMode === 'medkit' || ui.itemMode === 'aid') && sel && playerTurnActive()) {
      for (const t of validHealTargets(st, sel)) drawTargetFrame(ctx, { gx: t.pos.x, gy: t.pos.y, cell: BCELL });
    }
    if (ui.itemMode === 'grenade' && ui.tapCell) {
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = 'rgba(255,159,64,0.8)';
      for (const c of grenadeZone(ui.tapCell)) {
        ctx.strokeRect(c.x * BCELL + 2, c.y * BCELL + 2, BCELL - 5, BCELL - 5);
      }
      ctx.setLineDash([]);
    }

    // П6.7 (ADR-0029): векторні спрайти юнітів замість геометричних кружків —
    // силует, зброя, HP, рамка вибору, маркер дозору і кільце кольору бійця (Т.129) малює render.ts
    // (маркер дозору — строго в межах клітинки, П6.6).
    // П14.8: намальовані юніти — сцена ambient-шару (туман врахований:
    // невидимі прибульці сюди не потрапляють — ADR-0006).
    const ambUnits: AmbientUnitView[] = [];
    for (const u of st.units) {
      if (!u.alive) {
        // Фікс фідбеку валідації П14.8: смерть у черзі ще не відтворена —
        // силует стоїть до свого кадру згасання (анімаційний шар далі
        // відтворить смерть); позиція — з кадру смерті (стан вже фінальний).
        const at = pendingDeath.get(u.id);
        if (at === undefined) continue;
        if (u.side === 'alien' && !vis.has(at.x + ',' + at.y)) continue; // туман не розкривається
        drawUnitSprite(ctx, {
          side: u.side,
          cx: at.x * BCELL + BCELL / 2,
          cy: at.y * BCELL + BCELL / 2,
          r: 8,
          hp: shownHp.get(u.id) ?? 0, // Т.218: до кадру влучання — HP до нього
          maxHp: u.maxHp, // П14.4: смуга за HP; Т.218 — до кадру влучання HP до нього, далі порожня
          selected: false,
          overwatch: false,
          kind: u.kind, // п17.5: ряд атласа за типом
          turret: u.turret === true, // п18.5: турель — силует кодом
        });
        continue;
      }
      // П14.3: напрямок погляду — детерміновано за останнім рухом/ціллю:
      // активний рух юніта — за шляхом анімації, постріл — за ціллю трасера,
      // вибраний солдат — за клітинкою прицілювання (aimCell/tapCell).
      let dir: 1 | -1 | 0 = 0;
      if (activeAnim !== null && activeAnim.kind === 'move' && activeAnim.unitId === u.id) {
        const p0 = activeAnim.path[0] ?? u.pos;
        const p1 = activeAnim.path[activeAnim.path.length - 1] ?? p0;
        if (p1.x !== p0.x) dir = p1.x > p0.x ? 1 : -1;
      } else if (activeAnim !== null && activeAnim.kind === 'tracer' && u.id === firingId) {
        if (activeAnim.to.x !== activeAnim.from.x) dir = activeAnim.to.x > activeAnim.from.x ? 1 : -1;
      } else if (u.id === ui.selectedId) {
        const aim = ui.aimCell ?? ui.tapCell;
        if (aim !== null && aim.x !== u.pos.x) dir = aim.x > u.pos.x ? 1 : -1;
      }
      if (dir !== 0) facing.set(u.id, dir);
      if (u.id === movingId) continue; // П6.8: його малює анімаційний шар у проміжній позиції
      // П14.4 (фідбек прев'ю): хід демона ще не відтворено (чергу/туманна
      // ділянка активного ходу) — стоїть на початку свого шляху, не у цілі;
      // початок у тумані — не малюється зовсім (до ходу з туману).
      const pend = u.side === 'alien' ? pendingMove.get(u.id) : undefined;
      const at = pend ?? u.pos;
      const visible = vis.has(at.x + ',' + at.y);
      if (u.side === 'alien' && !visible) continue;
      const native: 1 | -1 = u.side === 'player' ? 1 : -1;
      const hp = shownHp.get(u.id) ?? u.hp; // Т.218: HP за чергою анімацій
      ambUnits.push({ at: { x: at.x, y: at.y }, hp, maxHp: u.maxHp }); // П14.8: сцена ambient
      drawUnitSprite(ctx, {
        side: u.side,
        cx: at.x * BCELL + BCELL / 2,
        cy: at.y * BCELL + BCELL / 2,
        r: 8,
        hp,
        maxHp: u.maxHp, // П14.4: смуга HP + число
        selected: u.id === ui.selectedId,
        overwatch: u.overwatch,
        pose: u.id === firingId ? 'fire' : undefined, // П14.2 (ADR-0072)
        aim: u.id === firingId && activeAnim?.kind === 'tracer' ? shotAim(activeAnim.from, activeAnim.to) : undefined, // п21.6: кадр угору / вниз
        recoil: u.id === firingId ? recoil : 0, // Т.132: віддача пострілу
        breath: u.id === firingId ? 0 : (deps.ambient.breath?.(at) ?? 0), // Т.132: дихання у спокої
        ring: unitRing(u.side, u.id, u.kind), // Т.129: кільце кольору бійця; п17.2: ворог — колір типу
        kind: u.kind, // п17.5 (ADR-0152): ряд атласа за типом ворога
        turret: u.turret === true, // п18.5 (ADR-0157): турель бази — силует кодом
        flip: (facing.get(u.id) ?? native) !== native, // П14.3: дзеркало за напрямком
      });
    }

    // П6.8 (ADR-0029): анімаційний шар поверх статичного стану. Рух прибульця
    // поза туманом не малюємо (movingId null — П14.4: до входу у зону видимості
    // демон прихований, а не стоїть у фінальній клітинці).
    // П14.4: розміри buffer'а — клімп частинок вибуху і чисел у межі канви.
    // Фідбек власника 2026-10-22: трасер бою стартує з ДУЛА стрільця (якір
    // кадру fire — MUZZLE_ANCHOR у render.ts), не з центру клітинки. Фліп —
    // фактичний напрямок погляду стрільця ЦЬОГО кадру (facing уже оновано
    // статичним проходом за активним трасером; вертикальний постріл — facing
    // попередній, як і намальована поза fire). Лише трасер бою: перехоплення
    // на геосцені малюється без підказки, від центру, як раніше.
    const muzzleHint =
      activeAnim !== null && activeAnim.kind === 'tracer' && firingId !== null
        ? {
            side: activeAnim.side,
            kind: activeAnim.enemyKind, // п17.5: якір дула свого типу
            turret: st.units.find((u) => u.id === firingId)?.turret === true, // п18.5: дуло турелі — кінчик ствола
            flip: (facing.get(firingId) ?? (activeAnim.side === 'player' ? 1 : -1)) !== (activeAnim.side === 'player' ? 1 : -1),
          }
        : undefined;
    if (activeAnim !== null && (activeAnim.kind !== 'move' || movingId !== null)) {
      drawAnimFrame(ctx, activeAnim, deps.anim.now, BCELL, 8, cv.width, cv.height, muzzleHint);
    }

    // П14.8 (ADR-0073): ambient-ефекти поверх кадру (пульс ціанових кантів
    // стін, підсвічування HP-бейджів поранених) — суто відображення: клік-
    // математика, відображувані позиції і лог не зачіпаються; у кадрі тряски
    // малюється у тому ж зсуві, що й сцена (без розсинхрону шарів).
    deps.ambient.paintBattle(ctx, { cell: BCELL, cw: cv.width, ch: cv.height, cells, units: ambUnits });

    // П6.14: шанс попадання біля клітинки цілі — при наведенні (aimCell) або
    // першому тапі (tapCell у зведеному режимі — тап-тап, дзеркало руху П6.4).
    if (ui.fireMode !== null && sel && playerTurnActive()) {
      const focus = [ui.aimCell, ui.tapCell].find((c) => c !== null && targets.some((t) => t.pos.x === c!.x && t.pos.y === c!.y));
      if (focus) {
        // п20.2 (ADR-0166): шанс з укриттям цілі — той самий, що кидає ядро (`shotCover`)
        const tgt = targets.find((t) => t.pos.x === focus.x && t.pos.y === focus.y);
        const cover = tgt === undefined ? undefined : shotCover(st, sel, tgt);
        drawChanceLabel(ctx, {
          gx: focus.x,
          gy: focus.y,
          cell: BCELL,
          cw: cv.width,
          text: '~' + Math.round(calculateHitChance(sel, ui.fireMode, cover) * 100) + '%',
        });
      }
    }
    ctx.restore(); // П6.13: кінець зсуву тряски — кадр повертається у межі buffer'а

    // стан кнопок керування
    const busy = !playerTurnActive();
    (el('btn-end') as HTMLButtonElement).disabled = busy;
    // П13.3 (ADR-0067): плитка «Авто»/«Стоп» — перемикач авто-бою. Доступна
    // весь бій без результату (в т.ч. в хід демонів Розриву — «Стоп» має
    // працювати будь-коли); підпис і підсвітка — за станом драйвера.
    const ab = el<HTMLButtonElement>('btn-auto-battle');
    const abBusy = deps.autoBusy();
    ab.disabled = ui.battleResult !== null;
    const abCap = ab.querySelector<HTMLElement>('.tb-cap');
    if (abCap !== null) abCap.textContent = abBusy ? 'Стоп' : 'Авто';
    ab.classList.toggle('armed', abBusy);
    // П6.14: кнопки режимів без достатку AP — приглушені (disabled) з причиною
    // «не вистачає AP» у підказці; підказка з index.html зберігається (dataset).
    for (const m of ['snap', 'aimed', 'auto'] as ShotMode[]) {
      const b = el<HTMLButtonElement>('btn-' + m);
      const cost = sel ? sel.weapon.modes[m].apCost : 0;
      // п20.4 (EARS 6, ADR-0168): режим, якого зброя не має, — вимкнена плитка з причиною (рішення власника «немає в зброї»)
      const noMode = sel !== undefined && !weaponHasMode(sel.weapon, m);
      const noAp = sel !== undefined && !noMode && sel.ap < cost;
      b.disabled = busy || noMode || noAp;
      // п20.4 (аудит PR #531): ціна в кутку і тултіп — за зброєю вибраного (без вибору — «Гарт»)
      const hint = fireModeHint(m, TILE_KEY[m]!, sel?.weapon);
      const apCorner = b.querySelector<HTMLElement>('.tb-ap');
      if (apCorner !== null) apCorner.textContent = (sel ? cost : RIFLE.modes[m].apCost) + ' AP';
      b.title = noMode
        ? hint + ' — у зброї «' + sel?.weapon.name + '» цього режиму немає'
        : noAp
          ? hint + ' — не вистачає AP (потрібно ' + cost + ')'
          : hint;
      tileReason(b, noMode ? 'немає в зброї' : noAp ? 'мало AP' : null);
      b.classList.toggle('armed', ui.fireMode === m && ui.itemMode !== 'precise'); // п16.4: «Точний» світить плитку ролі
    }
    const ow = el<HTMLButtonElement>('btn-ow');
    const owNoAp = sel !== undefined && sel.ap < OVERWATCH_AP_COST;
    ow.disabled = busy || owNoAp;
    const owHint = ow.dataset.hint || ow.title;
    ow.dataset.hint = owHint;
    ow.title = owNoAp ? owHint + ' — не вистачає AP (потрібно ' + OVERWATCH_AP_COST + ')' : owHint;
    tileReason(ow, owNoAp ? 'мало AP' : null);

    // П11.6 (ADR-0058): кнопки витратників — аптечка і граната. Приглушені без
    // предмета у вибраного солдата або без AP (підказка причини, патерн П6.14).
    const itemButtons: [HTMLButtonElement, 'medkit' | 'grenade', number][] = [
      [el<HTMLButtonElement>('btn-medkit'), 'medkit', HEAL_AP_COST],
      [el<HTMLButtonElement>('btn-grenade'), 'grenade', GRENADE_AP_COST],
    ];
    for (const [b, mode, cost] of itemButtons) {
      const hasItem = sel !== undefined && (st.items?.[sel.id]?.[mode] ?? false);
      const noAp = sel !== undefined && sel.ap < cost;
      b.disabled = busy || !hasItem || noAp;
      const hint = b.dataset.hint || b.title;
      b.dataset.hint = hint;
      b.title = !hasItem
        ? hint + ' — ' + (mode === 'medkit' ? 'гелю' : 'гранати') + ' немає при оперативникові'
        : noAp
          ? hint + ' — не вистачає AP (потрібно ' + cost + ')'
          : hint;
      const noItem = sel !== undefined && !hasItem;
      tileReason(b, noItem ? (mode === 'medkit' ? 'без гелю' : 'без гранат') : noAp ? 'мало AP' : null);
      b.classList.toggle('armed', ui.itemMode === mode);
    }

    // п16.4 (ADR-0147, рішення власника «А»): одна плитка дії ролі — підпис, іконка й ціна за роллю
    // вибраного; причина — з roleActionBlock ядра (EARS 6), коротко під плиткою, повністю в підказці.
    const rb = el<HTMLButtonElement>('btn-role');
    const rv = roleTileView(st, sel?.id ?? null);
    rb.disabled = busy || rv.reason !== null || sel === undefined;
    rb.title = rv.hint;
    rb.setAttribute('aria-label', rv.label);
    rb.dataset.role = rv.role ?? '';
    const rIcon = rb.querySelector('svg');
    const iconName = rv.role === null ? 'dash' : ROLE_INFO[rv.role].icon;
    if (rIcon !== null && rIcon.dataset.icon !== iconName) {
      rIcon.innerHTML = ICONS[iconName];
      rIcon.dataset.icon = iconName;
    }
    const rAp = rb.querySelector<HTMLElement>('.tb-ap');
    if (rAp !== null) rAp.textContent = rv.role === null ? '' : ROLE_INFO[rv.role].ap + ' AP';
    tileReason(rb, rv.reason);
    rb.classList.toggle('armed', ui.itemMode === 'precise' || ui.itemMode === 'aid');

    // Т.71 (ADR-0075, рішення власника 18.11.2026): плитка «Евакуація» — завжди в бою місії;
    // оперативник не на синій клітинці висадки чи без AP — неактивна з причиною (патерн П6.14).
    const ev = el<HTMLButtonElement>('btn-evac');
    ev.hidden = !st.evacZone?.length;
    const evWhy = sel === undefined ? null : evacBlockReason(st, sel);
    ev.disabled = busy || evWhy !== null;
    const evHint = ev.dataset.hint || ev.title;
    ev.dataset.hint = evHint;
    ev.title =
      evWhy === 'cell'
        ? evHint + ' — оперативник не на синій клітинці висадки'
        : evWhy === 'ap'
          ? evHint + ' — не вистачає AP (потрібно ' + EVAC_AP_COST + ')'
          : evHint;
    tileReason(ev, evWhy === 'cell' ? 'поза зоною' : evWhy === 'ap' ? 'мало AP' : null);
  }

  function close(): void {
    document.getElementById('evac-confirm')?.classList.add('hidden'); // Т.71 (аудит): вікно евакуації — разом із боєм
    deps.stopAuto(); // П13.3: авто-бій міг тривати — таймер і стан драйвера скидаємо
    deps.anim.cancel(); // П6.8: бій закрито — чергу анімацій скидаємо
    dropPlate(); // Т.33
    ui.mission = null;
    ui.battleResult = null;
    ui.selectedId = null;
    ui.fireMode = null;
    ui.itemMode = null; // П11.6
    ui.hoverPath = null;
    ui.tapCell = null;
    ui.aimCell = null; // П6.14
    ui.menuId = null; // Т.131
    el('benemy').classList.add('hidden');
    deps.resetBattleLog();
    el('bresult').innerHTML = '';
    facing.clear(); // П14.3: бій закрито — напрямки погляду не переносяться
    deps.renderAll();
  }

  function launch(probeId: string): void {
    start(
      (party, opts) => createMission(party.geo, probeId, { ...opts, threat: party.campaign.threat }), // п18.3: склад за загрозою
      '▶ Місія: загін висаджено біля зонду Розриву ' + probeNo(probeId) // Т.218: «№N» (аудит PR #536)
    );
  }

  // п18.4 (ADR-0156): штурм бази і фінал — той самий шлях запуску, інша фабрика бою.
  function launchAssault(): void {
    start(createAssault, '▶ Штурм бази: загін займає оборону вузла «Рубіж»');
  }
  function launchGate(): void {
    start(createGateMission, '▶ Брама Розриву: загін висаджено біля брами');
  }

  function start(make: (party: Party, opts: CampaignBattleOptions) => Mission, line: string): void {
    if (ui.mission) return;
    deps.anim.cancel(); // П6.8: новий бій — без залишків черги попереднього
    deps.cancelGeoAnim(); // П6.9: геосцену сховано — пульс радара скидаємо
    const party = deps.getParty();
    try {
      const squad = missionSquad(party.roster);
      // П11.4 (ADR-0058): аптечка/граната при солдатах — у стан бою.
      // п16.4 (ADR-0147): ролі загону — копія з ростеру (без ролей — бій байт-у-байт як до п16.3)
      const roles = deployRoles(party.roster, squad);
      ui.mission = make(party, { squad, items: deployConsumables(party.workshop, squad), ...(roles !== null ? { roles } : {}) });
    } catch (e) {
      deps.journal('✗ ' + (e as Error).message, 'lose');
      return;
    }
    const all = party.roster.careers;
    squadCareers.set(ui.mission, Object.fromEntries(Object.keys(all).map((id) => [id, { ...all[id] }])));
    facing.clear(); // П14.3: новий бій — напрямки погляду з нуля (дефолти кадрів)
    dropPlate(); // Т.33
    ui.battleResult = null;
    ui.selectedId = null;
    ui.fireMode = null;
    ui.itemMode = null; // П11.6
    ui.hoverPath = null;
    ui.tapCell = null;
    ui.aimCell = null; // П6.14
    deps.resetBattleLog();
    deps.journal(line, '', 'battle');
    binfo('Ваш хід: виберіть бійця — на полі або карткою загону, потім клітинку — прев’ю шляху; повторний клік у ту саму клітинку — хід.');
    deps.renderAll();
  }

  // Перевірка завершення після кожної дії; true — бій скінчився.
  function checkOutcome(): boolean {
    const mission = ui.mission;
    if (!mission) return true;
    const outcome = missionOutcome(mission.state);
    if (outcome !== 'триває') {
      finish(outcome);
      return true;
    }
    return false;
  }

  function finish(outcome: BattleOutcome): void {
    const mission = ui.mission;
    if (!mission) return;
    ui.battleResult = outcome;
    dropPlate(); // Т.33: бій скінчився — замість плашки ходу картка результату
    const party = deps.getParty();
    const aftermath = applyMissionResult(party.roster, mission.state);
    // п22.3 (ADR-0185): гілки «Сержанта» і «Ветерана» обирає гравець у вікні після бою (promptRole у main.ts)
    // Т.28 (ADR-0091): броня й око загиблих повертаються на склад, витратники зникають.
    removeLostEquipment(party.workshop, aftermath.lost);
    // П11.4 (ADR-0058): витратники уцілілих — використані зникають, невикористані лишаються.
    settleConsumables(party.workshop, aftermath.survivors, mission.state.items);
    // п18.4 (ADR-0156): штурм і брама — свої наслідки (зонда немає; штурм без евакуації)
    const op = mission.briefing.op;
    if (op === 'штурм') completeAssault(party, outcome === 'перемога' ? 'перемога' : 'поразка');
    else if (op === 'брама') completeGate(party, outcome);
    else completeMission(party.geo, mission.briefing.probeId, outcome);
    awardTrophies(party.research, mission.state, outcome); // п18.2 (ADR-0153 п. 9): трофеї лише за перемогу; показ — п18.5
    // п16.4 (ADR-0147 п. 7, 14; EARS 7): рядок втрати зі статистикою — у журнал і в картку результату.
    // Журнал історії після завантаження не відтворює (adoptParty у main.ts) — подія ядра для нього не потрібна.
    for (const line of aftermath.lossLines) deps.journal(line, 'lose', 'battle');
    // п16.4 (рішення власника «А»): рядок підвищення для кожного нового звання
    for (const s of aftermath.promoted) {
      const c = party.roster.careers[s.id];
      if (c) deps.journal('▲ Підвищення: «' + c.callsign + '» — ' + RANK_NAMES[rankOf(c.xp)].toLowerCase(), 'win', 'battle');
    }
    for (const s of aftermath.wounded)
      deps.journal(
        '✚ ' + s.name + ' ' + byGender(s.name, 'поранений', 'поранена') + ' — лікарня: ' + ticksText(party.roster.hospital[s.id]),
        '',
        'battle'
      );
    // Т.33: картка результату під банером — хід, демони, премія, поранені й загиблі поіменно
    const aliens = mission.state.units.filter((u) => u.side === 'alien');
    const card = resultCardHtml({
      turns: mission.state.turn,
      killed: aliens.filter((u) => !u.alive).length,
      aliens: aliens.length,
      bonus: outcome === 'перемога' && op === undefined ? missionBonus(mission.briefing.kind, party.campaign.preset) : null,
      wounded: aftermath.wounded.map((s) => s.name + ' — лікарня: ' + ticksText(party.roster.hospital[s.id])),
      lost: aftermath.lossLines.map((line) => line.replace(/^✝ /, '')), // п16.4: «✝ » додає сама картка
    });
    if (op !== undefined) {
      // п18.4 (рішення власника «А. Мінімум»): підсумок штурму чи брами — у журналі геоцени
      // (рядки geoEventText); перемога в брамі відкриває чинний екран перемоги.
      el('bresult').innerHTML =
        '<div class="banner ' +
        (outcome === 'перемога' ? 'win' : 'lose') +
        '">' +
        campaignBanner(op, outcome) +
        '</div>' +
        card +
        '<button id="btn-close">← Повернутись на геосцену</button>';
    } else if (outcome === 'перемога') {
      // П4.5 (ADR-0021): премія за перемогу за тип НЛО; надходження — у журнал
      creditMissionBonus(party.econ, mission.briefing.kind, party.campaign.preset);
      const woundedNote = aftermath.wounded.length > 0 ? ' · поранених: ' + aftermath.wounded.length : '';
      el('bresult').innerHTML =
        '<div class="banner win">ЗАЧИЩЕНО ✓ — загін повернувся на базу (' +
        aftermath.survivors.length +
        ' уцілілих' +
        woundedNote +
        ')</div>' +
        card +
        '<button id="btn-close">← Повернутись на геосцену</button>';
    } else if (outcome === 'евакуйовано') {
      // П15.2 (ADR-0075): без премії (гілка перемоги вище), НЛО лишається активним
      el('bresult').innerHTML =
        '<div class="banner lose">ЗАГІН ЕВАКУЙОВАНО — врятовані на базі, зонд Розриву лишається активним</div>' +
        card +
        '<button id="btn-close">← Повернутись на геосцену</button>';
    } else {
      el('bresult').innerHTML =
        '<div class="banner lose">ЗАГІН ВТРАЧЕНО ✗ — зонд Розриву лишається активним</div>' +
        card +
        '<button id="btn-close">← Повернутись на геосцену</button>';
    }
    (document.getElementById('btn-close') as HTMLButtonElement).onclick = close;
    binfo('Бій завершено.');
    deps.renderAll();
  }

  return {
    playerTurnActive,
    animating,
    selectedUnit,
    visibleCells,
    displayedAlienAt, // П14.4: клік по демону за відображуваною позицією
    renderBattle,
    binfo,
    launch,
    launchAssault,
    launchGate,
    close,
    finish,
    checkOutcome,
    enqueueAnims: enqueueBattleAnims,
    alienTurnDone,
    dismissTurnPlate,
    skipAlienTurn,
    autoAlienTurn,
    autoStopped,
  };
}
