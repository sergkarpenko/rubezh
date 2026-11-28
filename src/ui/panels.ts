// пR.2 (ADR-0037): панелі стану і топбара — винесено з main.ts без зміни
// поведінки. Тут — рендери колонки стану (сканери НЛО, винищувач, фінанси,
// ростер), чипи топбара (годинник, баланс, боєготові, кампанія), контекст-
// стрічка повітряного бою (П7.5) і екран перемоги кампанії (П8.3). Стан
// застосунку (party/mission/gameOver) модуль знає лише через Deps-інтерфейс;
// логіка ядра — виклики src/core, DOM — через хелпер el (src/ui/dom.ts).

import { gateKeyDone, gateOpen } from '../core/assault';
import { TICK_MINUTES, WORLD_W, chebyshevWrap, detectedProbes, geoClock, geoDay, missionTargets, type Probe } from '../core/geo';
import {
  FIGHTER_MAX_HP,
  FIGHTER_REPAIR_COST,
  GUN_MODULE_DAMAGE,
  RANGE_PROFILES,
  assignFighter,
  baseWhere,
  hangarPos,
  fighterInBattle,
  interceptRound,
  startIntercept,
  repairRisksBankruptcy,
  startRepair,
  type Fighter,
  type InterceptChoice,
} from '../core/intercept';
import { REGION_IDS, REGION_NAMES, totalTrust } from '../core/regions';
import { drawRegionsLayer, renderRegions } from './regions-panel';
import { dailyAllowance, hirePrice, missionBonus } from '../core/economy';
import { radarRange } from '../core/research';
import type { Vec2 } from '../core/combat';
// П11.6 (ADR-0058): екіпірування в картці солдата ростеру — броня/оптика
// (постійні), аптечка/граната (витратні); дії — лише на геосцені.
import {
  equipItem,
  unequipItem,
  installGunModule,
  removeGunModule,
  itemName,
  type SoldierEquipment,
  type SoldierItemId,
} from '../core/workshop';
import { missionRisksBankruptcy, readySoldiers } from '../core/squad';
import { SQUAD_SPAWN } from '../core/mission';
import type { Party } from '../core/save';
import { gunModuleEffect, itemEffect } from './effects';
import {
  drawAnimFrame,
  drawFighterSprite,
  drawGatePortal,
  drawGeoBaseSprite,
  drawGeoTerrain,
  drawHangarSprite,
  drawProbeSprite,
} from '../render';
import type { Anim } from '../core/render-core';
import { el, setWhy } from './dom';
import { setIconText } from './icons';
import { portraitCell, portraitHtml } from './portrait';
import { weaponIconHtml, weaponIdOf } from './weapon-icon';
import { RANK_NAMES, rankOf } from '../core/career';
import { careerPathHtml, chevronHtml, roleLabel } from './roles';
import { GCELL } from './grid';
import { geoEventText, type LogCat } from './journal';
import { renderEndScreens, renderGoalPanel, renderThreatChip } from './campaign-panel';
import { probeNo, ticksText } from './text';
import type { AmbientGeoScene } from './ambient';

// п20.5: ширина іконки зброї в ростері, CSS px (42 × 14)
export const ROSTER_WEAPON_W = 42;
// п21.4 (ADR-0178): сторона аватара (бюст у кільці) в рядку ростера, CSS px — рішення власника «Б. Більші» (40 / 32 / 32)
export const ROSTER_AVATAR = 40;

// П7: колір HP (чиста функція): повне — зелений, понад половину — жовтий, інакше — червоний.
export function hpColor(hp: number, maxHp: number): string {
  return hp >= maxHp ? '#7fbf7f' : hp > maxHp / 2 ? '#d8b25a' : '#ff9c9c';
}

// П11.6 (ADR-0058): предмети спорядження у картці оперативника — коротка мітка,
// ключ екіпірування і предмет каталогу «Кузні». Порядок фіксований (детермінізм).
// П12.6 (ADR-0064): ключі каталогу англійські; назви — з каталогу (WORKSHOP_CATALOG).
export const EQUIP_ITEMS: [SoldierItemId, keyof SoldierEquipment, string][] = [
  ['armor', 'armor', 'броня'],
  ['optics', 'optics', 'око'],
  ['medkit', 'medkit', 'гель'],
  ['grenade', 'grenade', 'граната'],
  ['breach-charge', 'charge', 'заряд'], // п18.5 (ADR-0157): «Пробивний заряд» (до п18.5 панель його не видавала)
];

// п18.5 (ADR-0157): клітинка Брами Розриву на геосцені — праворуч від вузла (горизонталь замкнена).
export function gateCell(party: Pick<Party, 'geo'>): Vec2 {
  const b = party.geo.base;
  return { x: (b.x + 1) % WORLD_W, y: b.y };
}

// Залежності від шару застосунку (main.ts): читання стану і дії панелей.
// Панелі не знають, як стан зберігається у застосунку.
// Т.16 (рішення власника 2026-11-11): повітряний бій заморожує час геосцени, як
// тактична місія — тік партії нічого не робить, кнопки часу неактивні; вихід —
// раундом (збиття, пошкодження) або відступом.
// T.39: лічильник на вкладці «Загін» — скільки предметів зі складу можна видати
// прямо зараз: для кожного з броня/око/гель/граната — min(«на складі»,
// «оперативників без цього предмета»); гарматний модуль оперативникам не
// видається (встановлюється на перехоплювач). У бою/банкрутстві — 0 (main.ts).
export function readyToIssue(party: Party): number {
  let n = 0;
  for (const [itemId, slot] of EQUIP_ITEMS) {
    const without = party.roster.soldiers.filter((soldier) => party.workshop.equipped[soldier.id]?.[slot] !== true).length;
    n += Math.min(party.workshop.store[itemId], without);
  }
  return n;
}

// Т.80 (кандидат 45): гарматний модуль можна встановити просто зараз — є на складі,
// ще не встановлено, перехоплювач у вузлі «Рубіж» (ті самі умови, що в ядрі
// installGunModule і в активній кнопці «Встановити модуль»). Спільна умова
// сигналу вкладки «Вузол» (nodeActions) і поради «Наступний крок».
// п19.4: перехоплювачів кілька — перший без модуля на базі (його кнопку «Встановити» показує порада).
export function gunModuleFighter(party: Party): Fighter | null {
  if (party.workshop.store['gun-module'] <= 0) return null;
  return party.intercept.fighters.find((f) => !f.gunModule && f.status === 'на базі') ?? null;
}
export function gunModuleReady(party: Party): boolean {
  return gunModuleFighter(party) !== null;
}

// п19.4: id кнопок картки перехоплювача — у першого (id 1) без суфікса (як до п19.4: порада
// «Наступний крок», тести), в інших — «-<id>».
export function fighterBtnId(base: string, f: Pick<Fighter, 'id'>): string {
  return f.id === 1 ? base : base + '-' + f.id;
}

// п19.4: боєготовий перехоплювач — на базі з повним HP.
export function fighterReady(f: Fighter): boolean {
  return f.status === 'на базі' && f.hp === FIGHTER_MAX_HP;
}

// п19.4 (кнопка «Перехопити» в «Сенсорній сітці»): найближчий до зонда боєготовий перехоплювач
// (відстань від ангара за Чебишевим з замиканням по X; рівні — менший id); немає — null.
export function nearestReady(party: Party, u: Probe): Fighter | null {
  let best: Fighter | null = null;
  let bestD = Infinity;
  for (const f of party.intercept.fighters) {
    if (!fighterReady(f)) continue;
    const d = chebyshevWrap(hangarPos(f.region, party.geo), u.pos);
    if (d < bestD) {
      best = f;
      bestD = d;
    }
  }
  return best;
}

// п19.4: перехоплювач, що веде погоню чи бій за зондом (на один зонд — один, ADR-0161).
function chaserOf(party: Party, probeId: string): Fighter | null {
  return party.intercept.fighters.find((f) => (f.status === 'погоня' || f.status === 'бій') && f.targetId === probeId) ?? null;
}

// п19.4: перехоплювач для контекст-стрічки — той, що в бою, інакше перший у погоні.
export function activeFighter(party: Party): Fighter | null {
  return fighterInBattle(party.intercept) ?? party.intercept.fighters.find((f) => f.status === 'погоня') ?? null;
}

export function inAirCombat(party: Party): boolean {
  return fighterInBattle(party.intercept) !== null; // п19.3: бій одночасно — один, будь-якого перехоплювача
}

export interface PanelsDeps {
  getParty(): Party;
  inBattle(): boolean; // тактичний бій триває (час геосцени заморожено, ADR-0026)
  isGameOver(): boolean; // банкрутство (ADR-0021)
  journal(text: string, cls?: string, cat?: LogCat): void;
  renderAll(): void;
  launchMission(probeId: string): void;
  launchGate(): void; // п18.4 (ADR-0156): фінал «Брама Розриву»
  drainGeo(): void; // нові geo-події → журнал (seen-трекінг у src/ui/journal.ts)
  drainEcon(): void; // нові події економіки → журнал
  activeGeoAnim(): Anim | null; // активна анімація геосцени (пульс радара, П6.9)
  geoAnimNow(): number; // час активної анімації геосцени
  victoryDismissed(): boolean; // П8.3a: гравець закрив екран перемоги і продовжує гру (endless)
  partyOnScreen?(): boolean; // п18.5 (аудит PR #516): партія на екрані — інакше екран поразки не показується (без поля — так)
  ambient: GeoAmbient; // П14.8: ефекти поверх кадру геосцени (ADR-0073)
}

// П14.8 (ADR-0073): ambient-шар геосцени — малювальник «живих» ефектів
// (розгортка радара у стані спокою, мерехтіння вогнів міст). Гейти — в
// ambient-модулі (тумблер, typeof-rAF): вимкнено/jsdom — 0 Canvas-викликів.
export interface GeoAmbient {
  paintGeo(ctx: CanvasRenderingContext2D, scene: AmbientGeoScene): void;
}

export interface Panels {
  renderGeo(): void;
  renderProbes(): void;
  renderFighter(): void;
  renderFinances(): void;
  renderRoster(): void;
  renderInterceptCtx(): void;
  renderRegions(): void; // п19.4: панель «Регіони» середньої колонки
  renderCampaign(): void; // П8.3: чипи кампанії + екран перемоги; п18.5 — загроза, мета, поразка
  nodeActions(): number; // Т.7: дії, що чекають гравця на вкладці «Вузол» (сигнал вкладки)
}

// П7.4 (ADR-0032): «Перехопити» — лише для зонда в повітрі, коли перехоплювач
// на базі. Спільна умова кнопки (renderProbes) і сигналу вкладки (nodeActions, Т.7).
// п19.4: хоч один перехоплювач на базі, і зонд ще ніхто не переслідує.
function canIntercept(party: Party, u: Probe): boolean {
  return u.status === 'летить' && chaserOf(party, u.id) === null && party.intercept.fighters.some((f) => f.status === 'на базі');
}

export function createPanels(deps: PanelsDeps): Panels {
  function renderGeo(): void {
    const party = deps.getParty();
    deps.drainGeo();
    const cv = el<HTMLCanvasElement>('geo');
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, cv.width, cv.height);

    // П12.7 (ADR-0064): терен геосцени — двотоновий синьо-чорний з неоновою
    // сіткою (ціан «Рубіжу»); кадр малюється з нуля (урок П6.6).
    drawGeoTerrain(ctx, cv.width, cv.height, GCELL);
    // п19.4 (ADR-0159 п. 15): межі регіонів пунктиром і підписи з довірою — під радаром і спрайтами
    drawRegionsLayer(ctx, party, GCELL);

    const b = party.geo.base;
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = 'rgba(0,229,255,0.25)'; // П12.7: межа сенсорної сітки — приглушений неоновий ціан
    // п18.5 (ADR-0157): рамка — радіус radarRange (6 після «Пеленгу брами»); по вертикалі — у межах канви
    // (світ 9 рядків: радар 4 уже займає всю висоту, ширшає лише горизонталь)
    const rr = radarRange(party.research);
    const fy0 = Math.max(0, (b.y - rr) * GCELL);
    const fy1 = Math.min(cv.height, (b.y + rr + 1) * GCELL);
    ctx.strokeRect((b.x - rr) * GCELL, fy0, (2 * rr + 1) * GCELL, fy1 - fy0);
    ctx.setLineDash([]);

    // П6.7 (ADR-0029): статичні спрайти геосцени — база і позначки НЛО (туман:
    // detectedProbes повертає лише виявлені — невиявлені в малювання не потрапляють).
    // п19.5: значок вузла з аркуша (фолбек — вежа-радар, далі піксельний спрайт ВУЗОЛ)
    drawGeoBaseSprite(ctx, { cx: b.x * GCELL + GCELL / 2, cy: b.y * GCELL + GCELL / 2, size: GCELL });
    // п18.5 (ADR-0157; рішення власника «А. Кодом»): Брама Розриву — портал у клітинці праворуч від вузла
    if (gateKeyDone(party) && party.campaign.status === 'триває') {
      const g = gateCell(party);
      drawGatePortal(ctx, { cx: g.x * GCELL + GCELL / 2, cy: g.y * GCELL + GCELL / 2, size: GCELL, open: gateOpen(party) });
    }

    // П7.5 (ADR-0032): маркер винищувача на геосцені — лише поза базою (на базі він у
    // спрайті бази; погоня/бій — дельта-крило поруч із позначкою НЛО).
    // п19.5 (ADR-0163): ангар регіону з перехоплювачем (крім north — «Шпилі», там ангар у вузлі) — значок
    // на клітинці ангара; перехоплювач на базі чи в ремонті — «в ангарі» (як у вузлі), крило — лише в погоні й бою
    // (позиція бою — pos; ангар — з hangarPos, а не pos: до першого вильоту pos може бути (0, 0), кандидат 196 г);
    // ангари — до зондів: зонд, що сів на клітинку ангара (ціль посадки — будь-яка клітинка), видно поверх (аудит PR #524).
    const hangars = new Set<string>(party.intercept.fighters.map((f) => f.region).filter((r) => r !== 'north'));
    for (const r of REGION_IDS) {
      if (!hangars.has(r)) continue;
      const h = hangarPos(r, party.geo);
      drawHangarSprite(ctx, { cx: h.x * GCELL + GCELL / 2, cy: h.y * GCELL + GCELL / 2 });
    }
    for (const u of detectedProbes(party.geo)) {
      drawProbeSprite(ctx, {
        cx: u.pos.x * GCELL + GCELL / 2,
        cy: u.pos.y * GCELL + GCELL / 2,
        landed: u.status === 'приземлився',
        kind: u.kind,
      });
    }
    for (const fgt of party.intercept.fighters) {
      if (fgt.status === 'погоня' || fgt.status === 'бій')
        drawFighterSprite(ctx, { cx: fgt.pos.x * GCELL + GCELL / 2, cy: fgt.pos.y * GCELL + GCELL / 2 });
    }

    // П6.9 (ADR-0029): анімаційний шар геосцени — пульс радара поверх статичного
    // кадру (кадр малюється з нуля — clearRect вище; урок П6.6). П14.5: cw/ch —
    // розміри buffer'а (скан-зона замикається по X — зсунуті копії; клімп хвоста).
    // П14.8 (ADR-0073): ambient-ефекти поверх кадру (розгортка радара у стані
    // спокою, мерехтіння вогнів міст) — до подієвого шару; суто відображення.
    // Фікс фідбеку валідації: подієвий скан-радар П14.5 грає — ambient-розгортку
    // приглушаємо (scanActive): один сектор на кадр, без «другого радара» на тік/добу.
    const ga = deps.activeGeoAnim();
    deps.ambient.paintGeo(ctx, {
      cell: GCELL,
      cw: cv.width,
      ch: cv.height,
      base: { x: b.x, y: b.y },
      scanActive: ga !== null && ga.kind === 'gscan',
      range: rr, // п18.5: розгортка радара 6
      ...(gateOpen(party) ? { gate: gateCell(party) } : {}), // п18.5: пульс відкритої брами
    });
    if (ga !== null) drawAnimFrame(ctx, ga, deps.geoAnimNow(), GCELL, 0, cv.width, cv.height);

    el('clock').textContent = geoClock(party.geo);
    const busy = deps.inBattle() || inAirCombat(party);
    (el('btn-tick') as HTMLButtonElement).disabled = busy || deps.isGameOver();
    (el('btn-day') as HTMLButtonElement).disabled = busy || deps.isGameOver();
    (el('btn-event') as HTMLButtonElement).disabled = busy || deps.isGameOver(); // Т.43
  }

  // Т.7: дії гравця на вкладці «Вузол» — ті самі умови, що показують кнопки
  // «Перехопити» / «Запустити місію» (renderProbes) і дистанції повітряного бою
  // (renderFighter). У тактичному бою і після банкрутства дій нема.
  function nodeActions(): number {
    if (deps.inBattle() || deps.isGameOver()) return 0;
    const party = deps.getParty();
    const targets = new Set(missionTargets(party.geo).map((u) => u.id));
    // п19.4: дистанції бою і модуль — у середній колонці «Перехоплювачі» (видна без вкладки) — не рахуються
    let n = 0;
    if (gateOpen(party) && readySoldiers(party.roster).length > 0) n++; // п18.4: брама чекає атаки
    for (const u of detectedProbes(party.geo)) {
      if (canIntercept(party, u)) n++;
      if (targets.has(u.id)) n++;
    }
    return n;
  }

  // п18.4 (рішення власника «А. Мінімум»): рядок фіналу в панелі зондів — кнопка
  // «▶ Атакувати Браму Розриву» (боєготових немає — вимкнена з причиною, як «Запустити місію»).
  function gateRow(party: Party): HTMLElement {
    const div = document.createElement('div');
    div.className = 'probe';
    div.innerHTML = '<b>Брама Розриву</b> · відкрита<br><span class="meta">фінальна місія · 6 ворогів</span>';
    const btn = document.createElement('button');
    btn.className = 'mission';
    btn.id = 'btn-gate';
    btn.textContent = '▶ Атакувати Браму Розриву';
    const ready = readySoldiers(party.roster).length;
    btn.disabled = deps.inBattle() || deps.isGameOver() || ready === 0;
    if (ready === 0) btn.title = 'Немає боєготових оперативників — чекайте одужання або вербуйте';
    btn.onclick = () => deps.launchGate();
    div.appendChild(btn);
    setWhy(btn, btn.disabled && btn.title !== '' ? btn.title : null);
    return div;
  }

  function renderProbes(): void {
    const party = deps.getParty();
    const box = el('probes');
    box.innerHTML = '';
    const detected = detectedProbes(party.geo);
    const targets = new Set(missionTargets(party.geo).map((u) => u.id));
    if (gateOpen(party)) box.appendChild(gateRow(party)); // п18.4: фінал — над зондами
    if (detected.length === 0) {
      if (box.childElementCount === 0) box.innerHTML = '<div class="meta">Нічого не виявлено — рухайте час.</div>';
      return;
    }
    for (const u of detected) {
      const div = document.createElement('div');
      div.className = 'probe';
      const info = u.status === 'приземлився' ? 'вікно ' + (u.landedTicksLeft * TICK_MINUTES) / 60 + ' год' : 'у повітрі';
      div.innerHTML =
        '<b>' + u.kind + '</b> · ' + u.status + '<br><span class="meta">(' + u.pos.x + ',' + u.pos.y + ') · ' + info + '</span>';
      // П7.4 (ADR-0032): «Перехопити» — лише для виявленого НЛО в повітрі; під час ремонту
      // або погоні запуск заблокований (пошкоджений винищувач не стартує)
      if (canIntercept(party, u)) {
        const ib = document.createElement('button');
        ib.className = 'intercept';
        ib.textContent = '✦ Перехопити';
        // п19.4: піднімається найближчий боєготовий; з двома і більше — номер і ангар у підказці
        const pick = nearestReady(party, u);
        const many = party.intercept.fighters.length > 1;
        ib.disabled = deps.inBattle() || deps.isGameOver() || pick === null;
        ib.title =
          pick === null
            ? 'Перехоплювач пошкоджений — спочатку ремонт'
            : many
              ? 'Підняти перехоплювач ' + pick.id + ' з ангара «' + REGION_NAMES[pick.region] + '» на перехоплення'
              : 'Підняти перехоплювач на перехоплення';
        ib.onclick = () => {
          if (deps.inBattle() || pick === null) return;
          try {
            startIntercept(party.intercept, party.geo, u.id, many ? pick.id : undefined);
          } catch (e) {
            deps.journal('✗ ' + (e as Error).message, 'lose');
          }
          deps.renderAll();
        };
        div.appendChild(ib);
        setWhy(ib, pick === null ? ib.title : null); // Т.43
      }
      if (targets.has(u.id)) {
        const btn = document.createElement('button');
        btn.className = 'mission';
        btn.id = 'btn-mission-' + u.id; // Т.97: ціль рядка «Наступний крок» — кнопка цього зонда
        btn.textContent = '▶ Запустити місію';
        // П4.5 (ADR-0021): поранені в лікарні не боєготові — місію запускати ніким
        const ready = readySoldiers(party.roster).length;
        btn.disabled = deps.inBattle() || deps.isGameOver() || ready === 0;
        if (deps.isGameOver()) btn.title = 'Партію програно — банкрутство';
        else if (ready === 0)
          btn.title =
            party.roster.soldiers.length === 0
              ? 'Ростер порожній — вербування оперативника за кредити'
              : 'Усі оперативники поранені — чекайте одужання або вербуйте';
        btn.onclick = () => deps.launchMission(u.id);
        div.appendChild(btn);
        setWhy(btn, btn.disabled && btn.title !== '' ? btn.title : null); // Т.43
        // Т.24 (рішення власника за Т.20): у бій іде останній боєготовий загін, а на
        // вербування не вистачає — рядок-попередження; запуск лишається в один клік.
        // Умова — та сама, що в боті партії (missionRisksBankruptcy, ADR-0089);
        // розмір загону — як у missionSquad за замовчуванням (SQUAD_SPAWN).
        const preset = party.campaign.preset;
        if (!btn.disabled && missionRisksBankruptcy(party.econ, party.roster, SQUAD_SPAWN.length, preset)) {
          const warn = document.createElement('div');
          warn.className = 'mission-warn';
          warn.textContent =
            '⚠ Останній загін, а на вербування бракує (' + party.econ.money + ' з ' + hirePrice(preset) + '): загине — банкрутство.';
          div.appendChild(warn);
        }
      }
      box.appendChild(div);
    }
  }

  // П4.5 (ADR-0021): панель фінансів — баланс, кнопка найму, надходження в журнал.
  function renderFinances(): void {
    const party = deps.getParty();
    deps.drainEcon();
    // ADR-0027: баланс у двох місцях — чип топбару і картка «Фінанси» (дублювання свідоме)
    const moneyText = deps.isGameOver() ? 'БАНКРУТ' : String(party.econ.money);
    el('money').textContent = moneyText;
    el('money-card').textContent = moneyText;
    const hire = el<HTMLButtonElement>('btn-hire');
    // П11.8: ціна найму за пресетом (ADR-0058 — «легкий» 120, «норма» 100, «складний» 90).
    const preset = party.campaign.preset;
    const hireCost = hirePrice(preset);
    // Т.7: ставки і ціна — з ядра за пресетом (урок П9.1: числа в розмітці дрейфують)
    el('econ-rates').textContent =
      '· дотація ' +
      dailyAllowance(preset, totalTrust(party.campaign.regions)) + // п19.2: поточна дотація з довір
      '/добу · премії за місію ' +
      missionBonus('розвідник', preset) +
      '/' +
      missionBonus('збирач', preset);
    setIconText(hire, 'roster', 'Вербувати оперативника (' + hireCost + ')'); // Т.128: іконка перед підписом
    hire.disabled = deps.isGameOver() || party.econ.money < hireCost;
    hire.title = hire.disabled
      ? 'Недостатньо кредитів (ціна вербування ' + hireCost + ')'
      : 'Новий оперативник у кінець ростеру (−' + hireCost + ')';
    setWhy(hire, party.econ.money < hireCost ? hire.title : null); // Т.43
  }

  // П7.5 (ADR-0032/0027): контекст-стрічка повітряного бою у фокусній зоні — видима лише
  // під час погоні/бою (на базі/ремонті джерело правди — панель «Винищувач» у колонці стану).
  function renderInterceptCtx(): void {
    const party = deps.getParty();
    const f = activeFighter(party); // п19.4: той, хто в бою, інакше перший у погоні
    el('ictx').classList.toggle('hidden', f === null);
    if (f === null) return;
    el('ictx-target').textContent = f.targetId === null || f.targetId === undefined ? '—' : probeNo(f.targetId); // Т.218: «№N»
    el('ictx-status').textContent = f.status;
    el('ictx-round').textContent = f.status === 'бій' ? String(party.intercept.round) : '—';
    el('ictx-fighter').textContent = (party.intercept.fighters.length > 1 ? f.id + ' · ' : '') + 'HP ' + f.hp + '/' + FIGHTER_MAX_HP;
    const probe = f.status === 'бій' ? party.geo.probes.find((u) => u.id === party.intercept.activeProbeId) : undefined;
    el('ictx-probe').textContent = probe ? 'HP ' + party.intercept.probeHp[probe.id] : '—';
  }

  // п19.4 (ADR-0159 п. 15): перехоплювачі, що показують кнопки регіонів «Призначити» (розгорнуто кліком).
  const assignOpen = new Set<number>();
  let assignParty: Party | null = null; // аудит PR #523: нова партія чи сейв — розгорнуті ряди скидаються
  let shownBattle: string | null = null; // аудит PR #523: бій, до картки якого вже прокручено

  // П7.4 (ADR-0032): панель винищувача — статус/HP; кнопки дій залежно від стану: «Ремонт (50)»
  // (пошкоджений на базі), дистанції бою (стан «бій» — рішення гравця кожен раунд).
  // п19.4 (ADR-0159 п. 15; рішення власника Т.207): панель «Перехоплювачі» середньої колонки —
  // картка на кожен перехоплювач: ангар, стан, «Погоня» на виявлені зонди, дистанції бою, ремонт,
  // модуль і «Призначити» (лише на базі). Рядок останнього переривання — над картками, як і досі.
  function renderFighter(): void {
    const party = deps.getParty();
    if (assignParty !== party) {
      assignParty = party;
      assignOpen.clear();
    }
    // аудит PR #523: «Призначити» — лише на базі; після вильоту розгорнутий ряд не повертається сам
    for (const f of party.intercept.fighters) if (f.status !== 'на базі') assignOpen.delete(f.id);
    const box = el('fighter');
    box.innerHTML = '';
    renderInterceptCtx(); // П7.5: контекст-стрічка повітряного бою у фокусній зоні
    // Т.43 (знахідка 15): перерване перехоплення лишається рядком на панелі до
    // наступного старту — той самий текст, що в журналі; стан береться з журналу геосцени.
    const log = party.geo.log;
    let i = log.length - 1;
    while (i >= 0 && !['intercept_start', 'intercept_aborted', 'intercept_break_off'].includes(log[i].type)) i--;
    const last = log[i];
    // Не показуємо пошкодження, яке вже відремонтовано (аудит PR #340). Т.51: для причин probe_landed/probe_lost
    // рядок показуємо лише поки зонд із події ще в geo.probes. п19.4: «відремонтовано» — у перехоплювача з події.
    const owner =
      last !== undefined && 'fighter' in last && last.fighter !== undefined
        ? party.intercept.fighters.find((f) => f.id === last.fighter)
        : party.intercept.fighters[0];
    const stale =
      last?.type === 'intercept_aborted' && last.reason === 'fighter_damaged' && (owner?.hp ?? FIGHTER_MAX_HP) === FIGHTER_MAX_HP;
    const probeGone =
      last?.type === 'intercept_aborted' &&
      (last.reason === 'probe_landed' || last.reason === 'probe_lost') &&
      !party.geo.probes.some((u) => u.id === last.probeId);
    if (last?.type === 'intercept_aborted' && !stale && !probeGone) {
      const note = document.createElement('div');
      note.id = 'fighter-last';
      note.className = 'meta';
      note.textContent = geoEventText(last, new Set())?.text ?? '';
      box.appendChild(note);
    }
    for (const f of party.intercept.fighters) box.appendChild(fighterCard(party, f));
    // аудит PR #523: сигналу вкладки на повітряний бій немає (дистанції — у середній колонці) — на початку
    // бою картку того, хто б'ється, прокручено у видиму частину колонки (раз на бій)
    const fighting = fighterInBattle(party.intercept);
    const key = fighting === null ? null : fighting.id + ':' + String(party.intercept.activeProbeId);
    if (key !== null && key !== shownBattle)
      document.getElementById('fighter-card-' + fighting!.id)?.scrollIntoView?.({ block: 'nearest' });
    shownBattle = key;
  }

  function fighterCard(party: Party, f: Fighter): HTMLElement {
    const many = party.intercept.fighters.length > 1;
    const card = document.createElement('div');
    card.className = 'fighter-card';
    card.id = 'fighter-card-' + f.id;
    const title = document.createElement('div');
    title.className = 'fc-title';
    title.textContent = (many ? 'Перехоплювач ' + f.id + ' · ' : '') + 'ангар «' + REGION_NAMES[f.region] + '»';
    card.appendChild(title);
    const statusText =
      f.status === 'ремонт'
        ? 'ремонт: ' + ticksText(f.repairTicksLeft ?? 0)
        : f.status === 'на базі'
          ? f.hp < FIGHTER_MAX_HP
            ? 'на базі · пошкоджений'
            : 'боєготовий'
          : f.status === 'погоня'
            ? 'погоня: ' + (f.targetId ? probeNo(f.targetId) : '?')
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
    card.appendChild(head);
    if (f.status === 'бій') renderRanges(party, card);
    if (fighterReady(f)) renderChase(party, f, card);
    if (f.status === 'на базі' && f.hp < FIGHTER_MAX_HP) renderRepair(party, f, card);
    renderGunModule(party, f, card);
    if (f.status === 'на базі') renderAssign(party, f, card);
    return card;
  }

  // П7.4: дистанції повітряного бою — у картці того, хто в бою (бій одночасно — один, ADR-0161).
  function renderRanges(party: Party, box: HTMLElement): void {
    const probe = party.geo.probes.find((u) => u.id === party.intercept.activeProbeId);
    const ctx = document.createElement('div');
    ctx.className = 'meta';
    ctx.style.marginBottom = '4px';
    ctx.textContent =
      'Бій із зондом ' +
      (probe ? probeNo(probe.id) : '?') +
      ' · раунд ' +
      party.intercept.round +
      ' · зонд HP ' +
      (probe ? party.intercept.probeHp[probe.id] : '?');
    box.appendChild(ctx);
    const row = document.createElement('div');
    row.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:4px'; // п19.4: дві в ряд
    for (const c of ['далека', 'середня', 'впритул', 'відступ'] as const) {
      const b = document.createElement('button');
      b.className = 'intercept-range';
      b.dataset.choice = c;
      b.textContent = c + (c !== 'відступ' ? ' (~' + Math.round(RANGE_PROFILES[c].fighterHitChance * 100) + '%)' : '');
      b.disabled = deps.inBattle();
      b.onclick = () => {
        try {
          interceptRound(party.intercept, party.geo, c as InterceptChoice, party.econ, party.campaign.preset, party.roster);
        } catch (e) {
          deps.journal('✗ ' + (e as Error).message, 'lose');
        }
        deps.renderAll();
      };
      row.appendChild(b);
    }
    box.appendChild(row);
  }

  // п19.4: «Погоня» — боєготовий перехоплювач на виявлений зонд у повітрі, який ще ніхто не переслідує.
  function renderChase(party: Party, f: Fighter, box: HTMLElement): void {
    const many = party.intercept.fighters.length > 1;
    for (const u of detectedProbes(party.geo)) {
      if (u.status !== 'летить' || chaserOf(party, u.id) !== null) continue;
      const b = document.createElement('button');
      b.className = 'chase';
      b.id = 'btn-chase-' + f.id + '-' + u.id;
      b.textContent = '✦ Погоня: ' + u.kind + ' ' + probeNo(u.id);
      b.disabled = deps.inBattle() || deps.isGameOver();
      b.title =
        'Підняти перехоплювач' +
        (many ? ' ' + f.id : '') +
        ' з ангара «' +
        REGION_NAMES[f.region] +
        '» — до зонда ' +
        chebyshevWrap(hangarPos(f.region, party.geo), u.pos) +
        ' кл.';
      b.onclick = () => {
        if (deps.inBattle()) return;
        try {
          startIntercept(party.intercept, party.geo, u.id, many ? f.id : undefined);
        } catch (e) {
          deps.journal('✗ ' + (e as Error).message, 'lose');
        }
        deps.renderAll();
      };
      box.appendChild(b);
    }
  }

  function renderRepair(party: Party, f: Fighter, box: HTMLElement): void {
    const many = party.intercept.fighters.length > 1;
    const b = document.createElement('button');
    b.id = fighterBtnId('btn-repair', f);
    b.textContent = 'Ремонт (' + FIGHTER_REPAIR_COST + ')';
    b.disabled = deps.isGameOver() || party.econ.money < FIGHTER_REPAIR_COST;
    b.title = b.disabled
      ? 'Недостатньо кредитів (ціна ремонту ' + FIGHTER_REPAIR_COST + ')'
      : 'Повний HP після ремонту (−' + FIGHTER_REPAIR_COST + ')';
    b.onclick = () => {
      try {
        startRepair(party.intercept, party.geo, party.econ, many ? f.id : undefined);
      } catch (e) {
        deps.journal('✗ ' + (e as Error).message, 'lose', 'econ');
      }
      deps.renderAll();
    };
    box.appendChild(b);
    setWhy(b, party.econ.money < FIGHTER_REPAIR_COST ? b.title : null); // Т.43
    // Т.26 (ADR-0090): авторемонт не почався, бо оплата доведе до банкрутства —
    // рядок-попередження; ручна оплата лишається в один клік (як Т.24 для місії).
    const preset = party.campaign.preset;
    if (!b.disabled && repairRisksBankruptcy(party.econ, party.roster, preset)) {
      const warn = document.createElement('div');
      warn.className = 'mission-warn';
      warn.id = fighterBtnId('repair-warn', f);
      warn.textContent =
        '⚠ Ремонт не почався сам: боєготових немає, а після ремонту не лишиться на вербування (' +
        party.econ.money +
        ' з ' +
        (FIGHTER_REPAIR_COST + hirePrice(preset)) +
        ').';
      box.appendChild(warn);
    }
  }

  // Т.78 (кандидат 21, рішення власника 19.11.2026): гарматний модуль вручну —
  // встановити зі складу і зняти назад, безкоштовно й одразу; лише на базі
  // (статус «на базі», правило ядра installGunModule/removeGunModule). п19.4: на кожен перехоплювач.
  function renderGunModule(party: Party, f: Fighter, box: HTMLElement): void {
    const many = party.intercept.fighters.length > 1;
    const onStore = party.workshop.store['gun-module'];
    if (!f.gunModule && onStore <= 0) return;
    const atBase = f.status === 'на базі';
    const why = deps.isGameOver()
      ? 'Партію програно'
      : deps.inBattle()
        ? 'Під час бою недоступно'
        : atBase
          ? null
          : 'Лише ' + baseWhere(f) + ': перехоплювач зараз — ' + f.status;
    if (f.gunModule) {
      const note = document.createElement('div');
      note.id = fighterBtnId('gun-module-state', f);
      note.className = 'meta';
      note.textContent = 'Гарматний модуль: встановлено';
      box.appendChild(note);
    }
    const b = document.createElement('button');
    b.id = fighterBtnId(f.gunModule ? 'btn-gun-remove' : 'btn-gun-install', f);
    b.textContent = f.gunModule ? 'Зняти модуль' : 'Встановити модуль (+' + GUN_MODULE_DAMAGE + ' пошк.)';
    b.disabled = why !== null;
    b.title = why ?? (f.gunModule ? 'Модуль повертається на склад' : gunModuleEffect() + ' · зі складу: ' + onStore);
    b.onclick = () => {
      try {
        if (f.gunModule) removeGunModule(party.workshop, party.intercept, many ? f.id : undefined);
        else installGunModule(party.workshop, party.intercept, many ? f.id : undefined);
      } catch (e) {
        deps.journal('✗ ' + (e as Error).message, 'lose', 'base');
      }
      deps.renderAll();
    };
    box.appendChild(b);
    setWhy(b, why);
  }

  // п19.4 (ADR-0161; рішення власника п19.3 «А. Кілька в одному»): «Призначити» — розгортає кнопки
  // інших регіонів (будь-який, і той, що вийшов); клік — миттєве перебазування (assignFighter).
  function renderAssign(party: Party, f: Fighter, box: HTMLElement): void {
    const many = party.intercept.fighters.length > 1;
    const open = assignOpen.has(f.id);
    const b = document.createElement('button');
    b.id = 'btn-assign-' + f.id;
    b.className = 'assign';
    b.textContent = '⇄ Призначити';
    b.setAttribute('aria-expanded', String(open));
    b.disabled = deps.inBattle() || deps.isGameOver();
    b.title = 'Перебазувати перехоплювач' + (many ? ' ' + f.id : '') + ' в ангар іншого району — одразу і безкоштовно';
    b.onclick = () => {
      if (open) assignOpen.delete(f.id);
      else assignOpen.add(f.id);
      deps.renderAll();
    };
    box.appendChild(b);
    if (!open || b.disabled) return;
    const row = document.createElement('div');
    row.className = 'assign-row';
    for (const r of REGION_IDS) {
      if (r === f.region) continue;
      const rb = document.createElement('button');
      rb.id = 'btn-assign-' + f.id + '-' + r;
      rb.textContent = '→ ' + REGION_NAMES[r] + (party.campaign.regions[r].out ? ' (район вийшов)' : '');
      rb.onclick = () => {
        try {
          assignFighter(party.intercept, party.geo, f.id, r);
        } catch (e) {
          deps.journal('✗ ' + (e as Error).message, 'lose', 'base');
        }
        assignOpen.delete(f.id);
        deps.renderAll();
      };
      row.appendChild(rb);
    }
    box.appendChild(row);
  }

  function renderRoster(): void {
    const party = deps.getParty();
    const box = el('roster');
    box.innerHTML = '';
    const soldiers = party.roster.soldiers;
    // П11.6: екіпірування — лише на геосцені; у бою/банкрутстві кнопки вимкнені
    const busy = deps.inBattle() || deps.isGameOver();
    // ADR-0027: чип боєготових у топбарі — завжди видний стан партії
    const readyN = readySoldiers(party.roster).length;
    el('ready').textContent = readyN + '/' + soldiers.length;
    if (soldiers.length === 0) {
      box.innerHTML =
        '<div style="color:#ff9c9c">Загін втрачено.</div>' +
        (party.econ.money >= hirePrice(party.campaign.preset)
          ? '<div class="meta">Вербування доступне — кнопка «Вербувати оперативника».</div>'
          : '<div class="meta">Кредитів на вербування немає.</div>');
      return;
    }
    const head = document.createElement('div');
    head.className = 'meta';
    head.style.marginBottom = '4px';
    head.textContent = soldiers.length + ' оперативників (' + readyN + ' боєготових)';
    box.appendChild(head);
    for (const s of soldiers) {
      const heal = party.roster.hospital[s.id];
      const row = document.createElement('div');
      // п21.4 (ADR-0178): клас рядка з бюстом — відступ під бюст 40 px без `:has()` (аудит PR #541)
      row.className = portraitCell(s.id) !== null ? 'soldier with-pt' : 'soldier';
      // п16.4 (ADR-0147 п. 6, EARS 8; рішення власника «А. Три рядки»): ім'я «позивний», шеврон, звання,
      // роль, HP, вбивства; під ними — біографія і досвід до наступного звання
      const career = party.roster.careers[s.id];
      const rank = career ? rankOf(career.xp) : 0;
      const role = career ? roleLabel(career) : '';
      row.innerHTML =
        portraitHtml(s.id, ROSTER_AVATAR) + // п21.4 (ADR-0178): мальований бюст у кільці кольору бійця; шолом — запасний
        '<span class="s-name">' +
        s.name +
        (career ? ' <span class="s-call">«' + career.callsign + '»</span>' : '') +
        '</span>' +
        (career ? chevronHtml(rank) + '<span class="s-rank">' + RANK_NAMES[rank] + '</span>' : '') +
        (role !== '' ? '<span class="s-role' + (career?.role === null ? ' s-norole' : '') + '">' + role + '</span>' : '') +
        (career ? '<div class="meta s-bio">' + career.bio + '</div><div class="s-stats">' : '') +
        '<span style="color:' +
        hpColor(s.hp, s.maxHp) +
        '">HP ' +
        s.hp +
        '/' +
        s.maxHp +
        '</span>' +
        (heal !== undefined ? '<span class="meta">лікарня: ' + ticksText(heal) + '</span>' : '') +
        // п20.5 (ADR-0169; рішення власника «Б. + ростер «Загін»»): мальована іконка зброї бійця
        weaponIconHtml(weaponIdOf(s.weapon) ?? 'rifle', ROSTER_WEAPON_W, 'wpn-icon s-wpn') +
        '<span class="kills">⚔ ' +
        s.kills +
        '</span>' +
        // п22.3 (ADR-0185; рішення власника «А. Сходинки»): під рядком HP — смуга шляху, рядок досвіду в ній
        (career ? '</div>' + careerPathHtml(career) : '');
      box.appendChild(row);
      // П11.6 (ADR-0058): екіпірування в картці оперативника — кнопки
      // «спорядити» зі складу / «зняти» назад на склад; лише на геосцені
      // (прецедент збереження). Предмет на оперативникові — мітка ✓.
      // П12.5 (ADR-0065): підказка спорядження несе числовий ефект ДО дії —
      // «зараз → стане» цього оперативника, числа з констант (effects.ts).
      // П12.6: назви предметів — з каталогу (ідентифікатор — не відображення).
      const eq = party.workshop.equipped[s.id];
      const eqRow = document.createElement('div');
      eqRow.className = 'meta';
      eqRow.style.marginBottom = '4px';
      for (const [itemId, slot, label] of EQUIP_ITEMS) {
        const on = eq?.[slot] === true;
        const b = document.createElement('button');
        b.id = 'btn-equip-' + s.id + '-' + slot;
        b.textContent = on ? label + ' ✓' : label;
        b.disabled = busy || (!on && party.workshop.store[itemId] <= 0);
        b.title = on
          ? 'Зняти «' + itemName(itemId) + '» — назад на склад'
          : party.workshop.store[itemId] > 0
            ? 'Спорядити «' + itemName(itemId) + '» зі складу — ' + itemEffect(itemId, s)
            : '«' + itemName(itemId) + '» немає на складі — замовте в «Кузні»';
        b.onclick = () => {
          try {
            if (on) unequipItem(party.workshop, s, itemId);
            else equipItem(party.workshop, s, itemId);
          } catch (e) {
            deps.journal('✗ ' + (e as Error).message, 'lose', 'base');
          }
          deps.renderAll();
        };
        eqRow.appendChild(b);
      }
      box.appendChild(eqRow);
    }
  }

  // П8.3: чипи кампанії у топбарі + екран перемоги (п18.3 — доба без «/30»).
  // п18.5 (ADR-0157): чип загрози замість «кампанія: …», панель «Мета кампанії», екран поразки.
  function renderCampaign(): void {
    const party = deps.getParty();
    renderThreatChip(party);
    el('campaign-progress').textContent = 'Д' + geoDay(party.geo); // п18.3: без «/30» — таймера 30 діб немає (рішення власника «А. Мінімум»)
    el('campaign-progress').classList.toggle('hidden', deps.inBattle());
    renderGoalPanel(party);
    // П8.3a: endless (рішення власника 2026-10-15) — «Грати далі» ховає екран,
    // але статус «перемога» і зафіксований рахунок лишаються (EARS Фази 8)
    const isVictory = party.campaign.status === 'перемога';
    renderEndScreens(
      party,
      isVictory && !deps.victoryDismissed(),
      !isVictory && deps.isGameOver() && !deps.inBattle() && (deps.partyOnScreen?.() ?? true)
    );
  }

  return {
    renderGeo,
    renderProbes,
    renderFighter,
    renderFinances,
    renderRoster,
    renderInterceptCtx,
    renderRegions: () => renderRegions(deps.getParty()),
    renderCampaign,
    nodeActions,
  };
}
