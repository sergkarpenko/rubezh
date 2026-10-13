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
// заступа, кінець ходу → синхронний хід прибульців (патерн 5.1.4, без таймерів).
// Авто-боти (src/bot.ts) лишились як кнопка «Демо-бій».
//
// Фаза 2 (П7): чисті шматки «візуальної логіки» (cellFromPoint, samePath,
// hpColor, geoEventText, battleEventText) експортуються для юніт-тестів
// (src/main.test.ts); DOM-ініціалізація — лише у браузері (typeof document).

import {
  RADAR_RANGE,
  TICK_MINUTES,
  WORLD_W,
  WORLD_H,
  advanceTime,
  createGeoGame,
  detectedUfos,
  geoClock,
  missionTargets,
  type GeoEvent,
  type GeoState,
} from './core/geo';
import { ALIEN_SPAWN, SQUAD_SPAWN, completeMission, createMission, missionOutcome, type Mission } from './core/mission';
import { applyMissionResult, createRoster, missionSquad, type Roster } from './core/squad';
import {
  calculateHitChance,
  endTurn,
  moveUnit,
  resolveAttack,
  setOverwatch,
  type GameEvent,
  type ShotMode,
  type Unit,
  type Vec2,
} from './core/combat';
import { computeVisibleCells, findPath, pathApCost } from './core/map';
import { aliensTurn, autoBattle } from './bot';

const GCELL = 36; // px на клітинку світу (16×8 → 576×288)
const BCELL = 26; // px на клітинку бойовища (20×20 → 520×520)

const MODE_LABEL: Record<ShotMode, string> = { snap: 'швидкий', aimed: 'прицільний', auto: 'черга' };

interface Party {
  geo: GeoState;
  roster: Roster;
}

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error('Немає елемента #' + id);
  return e as T;
}

// Порядок оголошень важливий (TDZ — див. docs/workflow.md): усі змінні стану,
// які newParty() чи обробники пишуть, оголошуються ДО першого виклику newParty().
let seenGeoLog = 0;
const knownDetected = new Set<string>();
let seenBattleLog = 0;
let party: Party = newParty(42);
let mission: Mission | null = null;
let battleResult: 'перемога' | 'поразка' | null = null;
let selectedId: string | null = null; // вибраний солдат
let fireMode: ShotMode | null = null; // «зведений» режим пострілу
let hoverPath: Vec2[] | null = null; // прев'ю шляху під курсором
let hoverAp = 0;

function newParty(seed: number): Party {
  seenGeoLog = 0;
  knownDetected.clear();
  return { geo: createGeoGame({ seed }), roster: createRoster() };
}

function journal(text: string, cls = ''): void {
  const li = document.createElement('li');
  li.textContent = text;
  if (cls) li.className = cls;
  const log = el('log');
  log.prepend(li);
  while (log.childElementCount > 80) log.removeChild(log.lastChild!);
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
    if (msg) journal(msg.text, msg.cls);
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

  ctx.fillStyle = '#4f8cff';
  ctx.fillRect(b.x * GCELL + 6, b.y * GCELL + 6, GCELL - 12, GCELL - 12);
  ctx.fillStyle = '#9fc3ff';
  ctx.font = '10px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('БАЗА', b.x * GCELL + GCELL / 2, b.y * GCELL + GCELL / 2);

  for (const u of detectedUfos(party.geo)) {
    const cx = u.pos.x * GCELL + GCELL / 2,
      cy = u.pos.y * GCELL + GCELL / 2,
      r = 11;
    if (u.status === 'приземлився') {
      ctx.fillStyle = '#e8c545';
      ctx.fillRect(cx - r / 2, cy - r / 2, r, r);
    } else if (u.kind === 'розвідник') {
      ctx.strokeStyle = '#e0a24a';
      ctx.beginPath();
      ctx.moveTo(cx, cy - r / 2);
      ctx.lineTo(cx + r / 2, cy);
      ctx.lineTo(cx, cy + r / 2);
      ctx.lineTo(cx - r / 2, cy);
      ctx.closePath();
      ctx.stroke();
    } else {
      ctx.strokeStyle = '#e0a24a';
      ctx.strokeRect(cx - r / 2, cy - r / 2, r, r);
    }
  }

  el('clock').textContent = geoClock(party.geo);
  const busy = mission !== null;
  (el('btn-tick') as HTMLButtonElement).disabled = busy;
  (el('btn-day') as HTMLButtonElement).disabled = busy;
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
    if (targets.has(u.id)) {
      const btn = document.createElement('button');
      btn.className = 'mission';
      btn.textContent = '▶ Запустити місію';
      const rosterEmpty = party.roster.soldiers.length === 0;
      btn.disabled = mission !== null || rosterEmpty;
      if (rosterEmpty) btn.title = 'Ростер порожній — немає кого відправити';
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

function renderRoster(): void {
  const box = el('roster');
  box.innerHTML = '';
  const soldiers = party.roster.soldiers;
  if (soldiers.length === 0) {
    box.innerHTML = '<div style="color:#ff9c9c">Загін втрачено — місії більше неможливі. Почніть нову партію.</div>';
    return;
  }
  const head = document.createElement('div');
  head.className = 'meta';
  head.style.marginBottom = '4px';
  head.textContent = soldiers.length + ' солдатів у строю';
  box.appendChild(head);
  for (const s of soldiers) {
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
      '<span class="kills">⚔ ' +
      s.kills +
      '</span>';
    box.appendChild(row);
  }
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
  el('bturn').textContent = '· хід ' + mission.state.turn + ' · ' + (mission.state.activeSide === 'player' ? 'загін' : 'прибульці');
  const cv = el<HTMLCanvasElement>('battle');
  const ctx = cv.getContext('2d');
  if (!ctx) return;
  const st = mission.state;

  const vis = visibleCells();
  for (let y = 0; y < st.map.height; y++) {
    for (let x = 0; x < st.map.width; x++) {
      const k2 = x + ',' + y;
      const blocked = st.map.blocked.has(k2);
      const visible = vis.has(k2);
      ctx.fillStyle = blocked ? (visible ? '#3d4657' : '#232936') : visible ? '#151b28' : '#0b0e15';
      ctx.fillRect(x * BCELL, y * BCELL, BCELL - 1, BCELL - 1);
    }
  }

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

  ctx.font = '9px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const u of st.units) {
    if (!u.alive) continue;
    const visible = vis.has(u.pos.x + ',' + u.pos.y);
    if (u.side === 'alien' && !visible) continue;
    const cx = u.pos.x * BCELL + BCELL / 2,
      cy = u.pos.y * BCELL + BCELL / 2,
      r = 8;
    if (u.side === 'player') {
      ctx.fillStyle = '#6ea8ff';
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0b0e15';
      ctx.fillText(String(u.hp), cx, cy);
      if (u.id === selectedId) {
        // рамка вибору
        ctx.strokeStyle = '#d7e4f7';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, r + 2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 1;
      }
    } else {
      ctx.fillStyle = '#ff6b6b';
      ctx.beginPath();
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r, cy + r);
      ctx.lineTo(cx - r, cy + r);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#0b0e15';
      ctx.fillText(String(u.hp), cx, cy + r / 3);
    }
    if (u.overwatch) {
      // маркер заступи
      ctx.fillStyle = '#d8b25a';
      ctx.fillRect(cx - 2, u.side === 'player' ? cy - r - 6 : cy + r + 2, 4, 4);
    }
  }

  // стан кнопок керування
  const busy = !playerTurnActive();
  for (const id of ['btn-snap', 'btn-aimed', 'btn-auto', 'btn-ow', 'btn-end']) {
    (el(id) as HTMLButtonElement).disabled = busy;
  }
  (el('btn-demo') as HTMLButtonElement).disabled = battleResult !== null;
  for (const m of ['snap', 'aimed', 'auto'] as ShotMode[]) {
    el('btn-' + m).classList.toggle('armed', fireMode === m);
  }
}

function renderAll(): void {
  renderGeo();
  renderUfos();
  renderRoster();
  if (mission) renderBattle();
  else el('battle-panel').classList.add('hidden');
}

function closeBattle(): void {
  mission = null;
  battleResult = null;
  selectedId = null;
  fireMode = null;
  hoverPath = null;
  seenBattleLog = 0;
  el('bresult').innerHTML = '';
  renderAll();
}

function launchMission(ufoId: string): void {
  if (mission) return;
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
  seenBattleLog = 0;
  el('battle-panel').classList.remove('hidden');
  journal('▶ Місія: загін висаджено біля НЛО ' + ufoId);
  binfo('Ваш хід: клікніть свого солдата (синє коло), потім клітинку — рух.');
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
  const st = mission.state;
  const cell = cellFromEvent(ev);
  const u = st.units.find((x) => x.alive && x.pos.x === cell.x && x.pos.y === cell.y);

  if (u && u.side === 'player') {
    // вибір свого солдата
    selectedId = u.id;
    fireMode = null;
    hoverPath = null;
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
    const mode = fireMode;
    fireMode = null;
    try {
      resolveAttack(st, sel.id, u.id, mode);
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

  // порожня клітинка — рух (клік скасовує зведений режим)
  fireMode = null;
  try {
    const path = findPath(st, sel.pos, cell);
    if (path === null) {
      binfo('Туди не дістатись.');
      renderAll();
      return;
    }
    if (pathApCost(path) > sel.ap) {
      binfo('Не вистачає AP: шлях ' + pathApCost(path) + ' проти ' + sel.ap + '.');
      renderAll();
      return;
    }
    moveUnit(st, sel.id, path);
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
  if (hoverPath !== null) {
    hoverPath = null;
    renderBattle();
  }
}

function armFire(mode: ShotMode): void {
  if (!playerTurnActive() || !mission) return;
  const sel = selectedUnit();
  if (!sel) {
    binfo('Спершу клікніть свого солдата.');
    return;
  }
  fireMode = mode;
  const prof = sel.weapon.modes[mode];
  const chance = Math.round(calculateHitChance(sel, mode) * 100);
  binfo(MODE_LABEL[mode] + ' постріл: ' + prof.apCost + ' AP · ~' + chance + '% · клікніть видимого прибульця.');
  renderBattle();
}

function armOverwatch(): void {
  if (!playerTurnActive() || !mission) return;
  const sel = selectedUnit();
  if (!sel) {
    binfo('Спершу клікніть свого солдата.');
    return;
  }
  try {
    setOverwatch(mission.state, sel.id);
    binfo(sel.name + ' у заступі (реакційний вогонь у хід прибульців). AP ' + sel.ap + '/' + sel.maxAp + '.');
  } catch (e) {
    binfo('✗ ' + (e as Error).message);
  }
  renderBattle();
}

function endPlayerTurn(): void {
  if (!playerTurnActive() || !mission) return;
  hoverPath = null;
  fireMode = null;
  try {
    endTurn(mission.state); // передати хід прибульцям (aliensTurn очікує їхній хід)
    const actions = aliensTurn(mission.state); // синхронно, одним кліком (5.1.4)
    if (!checkOutcome()) {
      binfo('Хід прибульців відпрацьовано (' + actions + ' дій). Ваш хід — хід ' + mission.state.turn + '.');
      renderAll();
    }
  } catch (e) {
    binfo('✗ Помилка ШІ: ' + (e as Error).message);
    renderAll();
  }
}

function demoBattle(): void {
  if (!mission || battleResult !== null) return;
  try {
    const res = autoBattle(mission.state, 240);
    if (res.outcome !== 'триває') finishBattle(res.outcome);
    else {
      binfo('Демо: бій не завершився за ліміт півходів.');
      renderAll();
    }
  } catch (e) {
    binfo('✗ Помилка демо: ' + (e as Error).message);
    renderAll();
  }
}

function finishBattle(outcome: 'перемога' | 'поразка'): void {
  if (!mission) return;
  battleResult = outcome;
  const aftermath = applyMissionResult(party.roster, mission.state);
  completeMission(party.geo, mission.briefing.ufoId, outcome);
  for (const s of aftermath.lost) journal('✝ ' + s.name + ' загинув у бою', 'lose');
  if (outcome === 'перемога') {
    el('bresult').innerHTML =
      '<div class="banner win">ЗАЧИЩЕНО ✓ — загін повернувся на базу (' +
      aftermath.survivors.length +
      ' виживших)</div>' +
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

// П7: у node-середовищі (vitest) DOM відсутній — ініціалізацію керування
// пропускаємо; чисті функції вище імпортуються тестами напряму.
if (typeof document !== 'undefined') {
  el('btn-tick').onclick = () => {
    if (!mission) {
      advanceTime(party.geo, 1);
      renderAll();
    }
  };
  el('btn-day').onclick = () => {
    if (!mission) {
      advanceTime(party.geo, 48);
      renderAll();
    }
  };
  el('btn-new').onclick = restart;
  el('btn-snap').onclick = () => armFire('snap');
  el('btn-aimed').onclick = () => armFire('aimed');
  el('btn-auto').onclick = () => armFire('auto');
  el('btn-ow').onclick = armOverwatch;
  el('btn-end').onclick = endPlayerTurn;
  el('btn-demo').onclick = demoBattle;
  const bc = el<HTMLCanvasElement>('battle');
  bc.addEventListener('click', battleCanvasClick);
  bc.addEventListener('mousemove', battleCanvasHover);
  bc.addEventListener('mouseleave', battleCanvasLeave);
  renderAll();
  journal('Партію розпочато. Рухайте час — радар шукає НЛО.');
}
