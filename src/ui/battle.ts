// пR.2 (ADR-0037): бойовище і флоу тактичного бою — винесено з main.ts без
// зміни поведінки (П6.3/П6.8/П6.13/П6.14/П6.16). Тут — рендер бойовища
// (контекст-стрічка бою, туман, прев'ю шляху, обведення цілей, анімаційний
// шар, шанс попадання), запуск/закриття/завершення місії, перевірка результату
// і валідні цілі (чиста функція). Стан бою (місія, вибір солдата, зведений
// режим, прев'ю шляху, тап-тап) — явний об'єкт BattleUIState, який передає
// застосунок (замість глобальних let — мітигація плану рефакторингу);
// обробники вводу (модуль input) працюють із тим самим об'єктом.

import { ALIEN_SPAWN, SQUAD_SPAWN, completeMission, createMission, missionOutcome, type Mission } from '../core/mission';
import { applyMissionResult, missionSquad } from '../core/squad';
// П11.3 (ADR-0058): предмети загиблих зникають разом з ними (перма-смерть).
// П11.4 (ADR-0058): витратники загону — копія в бій і розрахунок після бою.
import { deployConsumables, removeLostEquipment, settleConsumables } from '../core/workshop';
import { creditMissionBonus } from '../core/economy';
import {
  GRENADE_AP_COST,
  HEAL_AP_COST,
  OVERWATCH_AP_COST,
  calculateHitChance,
  distance,
  grenadeZone,
  hasLineOfSight,
  type GameState,
  type ShotMode,
  type Unit,
  type Vec2,
} from '../core/combat';
import { computeVisibleCells } from '../core/map';
import { geoClock } from '../core/geo';
import type { Party } from '../core/save';
import { drawAnimFrame, drawChanceLabel, drawNightTerrain, drawTargetFrame, drawUnitSprite } from '../render';
import { animT, animsFromEvents, moveAnimPos, pendingAlienMoveStarts, shakeOffset, type Anim, type TerrainCell } from '../core/render-core';
import { el } from './dom';
import { BCELL } from './grid';
import { type LogCat } from './journal';

export type BattleOutcome = 'перемога' | 'поразка';

// Стан бою UI — єдиний об'єкт замість модульних let у main.ts; його ж
// використовують обробники вводу (тап-тап, зведений режим, прев'ю шляху).
export interface BattleUIState {
  mission: Mission | null;
  battleResult: BattleOutcome | null;
  selectedId: string | null; // вибраний солдат
  fireMode: ShotMode | null; // «зведений» режим пострілу
  itemMode: 'medkit' | 'grenade' | null; // П11.6 (ADR-0058): зведений режим витратника — аптечка/граната
  hoverPath: Vec2[] | null; // прев'ю шляху під курсором
  hoverAp: number;
  tapCell: Vec2 | null; // ADR-0027 (П6.4): клітинка першого тапу — повторний тап у неї робить хід
  aimCell: Vec2 | null; // П6.14: клітинка цілі під наведенням/першим тапом у зведеному режимі
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
}

export interface BattleUI {
  playerTurnActive(): boolean;
  selectedUnit(): Unit | undefined;
  visibleCells(): Set<string>;
  displayedAlienAt(cell: Vec2): Unit | undefined; // П14.4: демон у клітинці за відображуваною позицією
  renderBattle(): void;
  binfo(text: string): void;
  launch(ufoId: string): void;
  close(): void;
  finish(outcome: BattleOutcome): void;
  checkOutcome(): boolean;
  enqueueAnims(prevLen: number): void; // П6.8: нові події логу бою → анімації
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

  function playerTurnActive(): boolean {
    return ui.mission !== null && ui.battleResult === null && ui.mission.state.activeSide === 'player';
  }

  function selectedUnit(): Unit | undefined {
    if (!ui.mission || !ui.selectedId) return undefined;
    return ui.mission.state.units.find((u) => u.id === ui.selectedId && u.alive);
  }

  function visibleCells(): Set<string> {
    const vis = new Set<string>();
    if (!ui.mission) return vis;
    for (const u of ui.mission.state.units) {
      if (u.side === 'player' && u.alive) for (const k of computeVisibleCells(ui.mission.state, u.pos)) vis.add(k);
    }
    return vis;
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
    if (!mission || !deps.hasRaf()) return;
    deps.anim.push(animsFromEvents(mission.state.log.slice(prevLen), mission.state.units, visibleCells()));
  }

  function renderBattle(): void {
    const mission = ui.mission;
    if (!mission) return;
    deps.drainBattle();
    // ADR-0027 (П6.3): контекст-стрічка бою — тип місії, заморожений час,
    // чий хід, активний юніт HP/AP. Час геосцени стоїть (ADR-0026: місія
    // не переривається) — показуємо його як «заморожено».
    el('bctx-kind').textContent = mission.briefing.kind;
    el('bctx-time').textContent = geoClock(deps.getParty().geo) + ' · заморожено';
    el('bctx-turn').textContent =
      'хід ' + mission.state.turn + ' · ' + (mission.state.activeSide === 'player' ? 'загін' : 'демони Розриву');
    const selCtx = selectedUnit();
    el('bctx-unit').textContent = selCtx
      ? selCtx.name + ': HP ' + selCtx.hp + '/' + selCtx.maxHp + ' · AP ' + selCtx.ap + '/' + selCtx.maxAp
      : 'не вибраний';
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
    if (activeAnim !== null && activeAnim.kind === 'tracer') {
      const shooter = st.units.find(
        (u) => u.alive && u.side === activeAnim.side && u.pos.x === activeAnim.from.x && u.pos.y === activeAnim.from.y
      );
      if (shooter !== undefined) firingId = shooter.id;
    }

    // П14.4 (фідбек прев'ю): ходи демонів у черзі ще не відтворені —
    // статичний прохід не малює їх у фінальних клітинках до початку їхньої
    // анімації (синхронний хід ШІ вже застосований — інакше демон
    // «з'являється» одразу у цілі і хід не анімується). До відтворення
    // свого ходу демон стоїть на початку шляху; туманна ділянка не
    // показується (туман не розкривається, ADR-0006).
    const pendingMove = pendingAlienMoveStarts(deps.anim.queued());

    // П6.13: нічна палітра. Легка тряска канвасу при влучанні — зсув усього кадру
    // на фазі спалаху трасера (через AnimEngine — лише в кадрах анімації); фон
    // канви збігається з CSS-тлом, оголений край непомітний. Туман: зсув
    // однаковий для всіх клітинок — сенс туману незмінний (ADR-0006).
    const shake = shakeOffset(activeAnim, deps.anim.now);
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
    if (ui.hoverPath && sel && playerTurnActive()) {
      const affordable = ui.hoverAp <= sel.ap;
      ctx.fillStyle = affordable ? 'rgba(127,226,160,0.9)' : 'rgba(255,156,156,0.9)';
      for (const p of ui.hoverPath) {
        ctx.beginPath();
        ctx.arc(p.x * BCELL + BCELL / 2, p.y * BCELL + BCELL / 2, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // П6.14: у зведеному режимі пострілу — обведення всіх валідних цілей
    // (видимі прибульці, дистанція і лінія вогню). Туман: невидимі цілі
    // не підсвічуються (ADR-0006) — підказка лише про те, що гравець бачив.
    let targets: Unit[] = [];
    if (ui.fireMode !== null && sel && playerTurnActive()) targets = validFireTargets(st, sel, vis);
    for (const t of targets) drawTargetFrame(ctx, { gx: t.pos.x, gy: t.pos.y, cell: BCELL });

    // П11.6 (ADR-0058): обведення валідних цілей аптечки (поранені союзники
    // поруч) і прев'ю зони вибуху гранати (епіцентр + хрест) після першого тапу.
    if (ui.itemMode === 'medkit' && sel && playerTurnActive()) {
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
    // силует, зброя, HP, рамка вибору і маркер дозору малює render.ts
    // (маркер дозору — строго в межах клітинки, П6.6).
    for (const u of st.units) {
      if (!u.alive) continue;
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
      drawUnitSprite(ctx, {
        side: u.side,
        cx: at.x * BCELL + BCELL / 2,
        cy: at.y * BCELL + BCELL / 2,
        r: 8,
        hp: u.hp,
        maxHp: u.maxHp, // П14.4: смуга HP + число
        selected: u.id === ui.selectedId,
        overwatch: u.overwatch,
        pose: u.id === firingId ? 'fire' : undefined, // П14.2 (ADR-0072)
        flip: (facing.get(u.id) ?? native) !== native, // П14.3: дзеркало за напрямком
      });
    }

    // П6.8 (ADR-0029): анімаційний шар поверх статичного стану. Рух прибульця
    // поза туманом не малюємо (movingId null — П14.4: до входу у зону видимості
    // демон прихований, а не стоїть у фінальній клітинці).
    // П14.4: розміри buffer'а — клімп частинок вибуху і чисел у межі канви.
    if (activeAnim !== null && (activeAnim.kind !== 'move' || movingId !== null)) {
      drawAnimFrame(ctx, activeAnim, deps.anim.now, BCELL, 8, cv.width, cv.height);
    }

    // П6.14: шанс попадання біля клітинки цілі — при наведенні (aimCell) або
    // першому тапі (tapCell у зведеному режимі — тап-тап, дзеркало руху П6.4).
    if (ui.fireMode !== null && sel && playerTurnActive()) {
      const focus = [ui.aimCell, ui.tapCell].find((c) => c !== null && targets.some((t) => t.pos.x === c!.x && t.pos.y === c!.y));
      if (focus) {
        drawChanceLabel(ctx, {
          gx: focus.x,
          gy: focus.y,
          cell: BCELL,
          cw: cv.width,
          text: '~' + Math.round(calculateHitChance(sel, ui.fireMode) * 100) + '%',
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
      const noAp = sel !== undefined && sel.ap < cost;
      b.disabled = busy || noAp;
      const hint = b.dataset.hint || b.title;
      b.dataset.hint = hint;
      b.title = noAp ? hint + ' — не вистачає AP (потрібно ' + cost + ')' : hint;
      b.classList.toggle('armed', ui.fireMode === m);
    }
    const ow = el<HTMLButtonElement>('btn-ow');
    const owNoAp = sel !== undefined && sel.ap < OVERWATCH_AP_COST;
    ow.disabled = busy || owNoAp;
    const owHint = ow.dataset.hint || ow.title;
    ow.dataset.hint = owHint;
    ow.title = owNoAp ? owHint + ' — не вистачає AP (потрібно ' + OVERWATCH_AP_COST + ')' : owHint;

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
      b.classList.toggle('armed', ui.itemMode === mode);
    }
  }

  function close(): void {
    deps.stopAuto(); // П13.3: авто-бій міг тривати — таймер і стан драйвера скидаємо
    deps.anim.cancel(); // П6.8: бій закрито — чергу анімацій скидаємо
    ui.mission = null;
    ui.battleResult = null;
    ui.selectedId = null;
    ui.fireMode = null;
    ui.itemMode = null; // П11.6
    ui.hoverPath = null;
    ui.tapCell = null;
    ui.aimCell = null; // П6.14
    deps.resetBattleLog();
    el('bresult').innerHTML = '';
    facing.clear(); // П14.3: бій закрито — напрямки погляду не переносяться
    deps.renderAll();
  }

  function launch(ufoId: string): void {
    if (ui.mission) return;
    deps.anim.cancel(); // П6.8: новий бій — без залишків черги попереднього
    deps.cancelGeoAnim(); // П6.9: геосцену сховано — пульс радара скидаємо
    const party = deps.getParty();
    try {
      const squad = missionSquad(party.roster);
      // П11.4 (ADR-0058): аптечка/граната при солдатах — у стан бою.
      ui.mission = createMission(party.geo, ufoId, { squad, items: deployConsumables(party.workshop, squad) });
    } catch (e) {
      deps.journal('✗ ' + (e as Error).message, 'lose');
      return;
    }
    facing.clear(); // П14.3: новий бій — напрямки погляду з нуля (дефолти кадрів)
    ui.battleResult = null;
    ui.selectedId = null;
    ui.fireMode = null;
    ui.itemMode = null; // П11.6
    ui.hoverPath = null;
    ui.tapCell = null;
    ui.aimCell = null; // П6.14
    deps.resetBattleLog();
    deps.journal('▶ Місія: загін висаджено біля зонду Розриву ' + ufoId, '', 'battle');
    binfo('Ваш хід: клікніть свого оперативника (синє коло), потім клітинку — прев’ю шляху; повторний клік у ту саму клітинку — хід.');
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
    const party = deps.getParty();
    const aftermath = applyMissionResult(party.roster, mission.state);
    // П11.3 (ADR-0058): предмети загиблих на склад не повертаються (перма-смерть).
    removeLostEquipment(party.workshop, aftermath.lost);
    // П11.4 (ADR-0058): витратники уцілілих — використані зникають, невикористані лишаються.
    settleConsumables(party.workshop, aftermath.survivors, mission.state.items);
    completeMission(party.geo, mission.briefing.ufoId, outcome);
    for (const s of aftermath.lost) deps.journal('✝ ' + s.name + ' загинув у бою', 'lose', 'battle');
    for (const s of aftermath.wounded)
      deps.journal('✚ ' + s.name + ' поранений — лікарня: ' + party.roster.hospital[s.id] + ' тик(и)', '', 'battle');
    if (outcome === 'перемога') {
      // П4.5 (ADR-0021): премія за перемогу за тип НЛО; надходження — у журнал
      creditMissionBonus(party.econ, mission.briefing.kind, party.campaign.preset);
      const woundedNote = aftermath.wounded.length > 0 ? ' · поранених: ' + aftermath.wounded.length : '';
      el('bresult').innerHTML =
        '<div class="banner win">ЗАЧИЩЕНО ✓ — загін повернувся на базу (' +
        aftermath.survivors.length +
        ' уцілілих' +
        woundedNote +
        ')</div>' +
        '<button id="btn-close">← Повернутись на геосцену</button>';
    } else {
      el('bresult').innerHTML =
        '<div class="banner lose">ЗАГІН ВТРАЧЕНО ✗ — зонд Розриву лишається активним</div>' +
        '<button id="btn-close">← Повернутись на геосцену</button>';
    }
    (document.getElementById('btn-close') as HTMLButtonElement).onclick = close;
    binfo('Бій завершено.');
    deps.renderAll();
  }

  return {
    playerTurnActive,
    selectedUnit,
    visibleCells,
    displayedAlienAt, // П14.4: клік по демону за відображуваною позицією
    renderBattle,
    binfo,
    launch,
    close,
    finish,
    checkOutcome,
    enqueueAnims: enqueueBattleAnims,
  };
}
