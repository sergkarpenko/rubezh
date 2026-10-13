// src/main.ts
// Демо-превью «Рубіж» (ванільний TS + Canvas 2D — цільова архітектура, ADR 0001/0007).
// Тут лише відображення і керування; уся логіка — виклики чистого ядра (src/core):
// geo (час, НЛО, радар) + mission (бій) + squad (ростер, перма-смерть).
// Тактичний бій відтворюється автоматично: демо-бот гравця (src/bot.ts, дзеркало
// ШІ 3.5) проти ШІ прибульців (ai.ts, patrol-режим 5.1.5). Інтерактивне керування
// бійцем — майбутня ітерація; це превью ядра.

import {
  RADAR_RANGE, TICK_MINUTES, WORLD_W, WORLD_H, advanceTime, createGeoGame,
  detectedUfos, geoClock, missionTargets, type GeoState,
} from './core/geo';
import { ALIEN_SPAWN, SQUAD_SPAWN, completeMission, createMission, missionOutcome, type Mission } from './core/mission';
import { applyMissionResult, createRoster, missionSquad, type Roster } from './core/squad';
import { computeVisibleCells } from './core/map';
import { aliensTurn, botTurn } from './bot';

const GCELL = 36; // px на клітинку світу (16×8 → 576×288)
const BCELL = 26; // px на клітинку бойовища (20×20 → 520×520)

interface Party { geo: GeoState; roster: Roster; }

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error('Немає елемента #' + id);
  return e as T;
}

// Порядок оголошень важливий: newParty() на старті модуля пише seenGeoLog
// і knownDetected — вони мають бути ініціалізовані ДО виклику (інакше TDZ:
// ReferenceError до першого рендера, і вся сторінка лишається порожньою).
let seenGeoLog = 0;
const knownDetected = new Set<string>();
let party: Party = newParty(42);
let mission: Mission | null = null;
let battleTimer: ReturnType<typeof setInterval> | undefined;
let battleResult: 'перемога' | 'поразка' | null = null;

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

// Geo-події → журнал (туман стратегічного шару: лише виявлені НЛО, як у 4.2).
function drainGeoLog(): void {
  const log = party.geo.log;
  for (; seenGeoLog < log.length; seenGeoLog++) {
    const e = log[seenGeoLog];
    switch (e.type) {
      case 'day': journal('— Доба ' + e.day + ' —'); break;
      case 'ufo_detected':
        knownDetected.add(e.ufoId);
        journal('Виявлено НЛО: ' + e.ufoId);
        break;
      case 'ufo_landed':
        if (knownDetected.has(e.ufoId)) journal('НЛО ' + e.ufoId + ' приземлився — відкрито вікно місії');
        break;
      case 'ufo_left':
        if (knownDetected.has(e.ufoId)) journal('НЛО ' + e.ufoId + ' відлетів і зник');
        break;
      case 'mission_won': journal('Місію зачищено ✓', 'win'); break;
      case 'mission_lost': journal('Загін втрачено ✗', 'lose'); break;
      default: break; // ufo_spawned / ufo_move — приховано туманом
    }
  }
}

function renderGeo(): void {
  drainGeoLog();
  const cv = el<HTMLCanvasElement>('geo');
  const ctx = cv.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, cv.width, cv.height);

  // сітка
  ctx.strokeStyle = '#1a2130';
  ctx.lineWidth = 1;
  for (let x = 0; x <= WORLD_W; x++) { ctx.beginPath(); ctx.moveTo(x * GCELL, 0); ctx.lineTo(x * GCELL, WORLD_H * GCELL); ctx.stroke(); }
  for (let y = 0; y <= WORLD_H; y++) { ctx.beginPath(); ctx.moveTo(0, y * GCELL); ctx.lineTo(WORLD_W * GCELL, y * GCELL); ctx.stroke(); }

  // зона радара (Чебишев ≤ RADAR_RANGE), пунктиром
  const b = party.geo.base;
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = '#2c3f2f';
  ctx.strokeRect((b.x - RADAR_RANGE) * GCELL, (b.y - RADAR_RANGE) * GCELL, (2 * RADAR_RANGE + 1) * GCELL, (2 * RADAR_RANGE + 1) * GCELL);
  ctx.setLineDash([]);

  // база
  ctx.fillStyle = '#4f8cff';
  ctx.fillRect(b.x * GCELL + 6, b.y * GCELL + 6, GCELL - 12, GCELL - 12);
  ctx.fillStyle = '#9fc3ff';
  ctx.font = '10px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('БАЗА', b.x * GCELL + GCELL / 2, b.y * GCELL + GCELL / 2);

  // виявлені НЛО: ромб — розвідник у повітрі, квадрат — збирач, жовтий — приземлений
  for (const u of detectedUfos(party.geo)) {
    const cx = u.pos.x * GCELL + GCELL / 2, cy = u.pos.y * GCELL + GCELL / 2, r = 11;
    if (u.status === 'приземлився') {
      ctx.fillStyle = '#e8c545';
      ctx.fillRect(cx - r / 2, cy - r / 2, r, r);
    } else if (u.kind === 'розвідник') {
      ctx.strokeStyle = '#e0a24a';
      ctx.beginPath();
      ctx.moveTo(cx, cy - r / 2); ctx.lineTo(cx + r / 2, cy); ctx.lineTo(cx, cy + r / 2); ctx.lineTo(cx - r / 2, cy); ctx.closePath();
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
  const targets = new Set(missionTargets(party.geo).map(u => u.id));
  if (detected.length === 0) {
    box.innerHTML = '<div class="meta">Нічого не виявлено — рухайте час.</div>';
    return;
  }
  for (const u of detected) {
    const div = document.createElement('div');
    div.className = 'ufo';
    const info = u.status === 'приземлився' ? 'вікно ' + (u.landedTicksLeft * TICK_MINUTES / 60) + ' год' : 'у повітрі';
    div.innerHTML = '<b>' + u.kind + '</b> · ' + u.status + '<br><span class="meta">(' + u.pos.x + ',' + u.pos.y + ') · ' + info + '</span>';
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
    const hpColor = s.hp >= s.maxHp ? '#7fbf7f' : s.hp > s.maxHp / 2 ? '#d8b25a' : '#ff9c9c';
    row.innerHTML = '<span style="min-width:64px">' + s.name + '</span>' +
      '<span style="color:' + hpColor + '">HP ' + s.hp + '/' + s.maxHp + '</span>' +
      '<span class="kills">⚔ ' + s.kills + '</span>';
    box.appendChild(row);
  }
}

function renderBattle(): void {
  if (!mission) return;
  el('bturn').textContent = '· хід ' + mission.state.turn + ' · ' + (mission.state.activeSide === 'player' ? 'загін' : 'прибульці');
  const cv = el<HTMLCanvasElement>('battle');
  const ctx = cv.getContext('2d');
  if (!ctx) return;
  const st = mission.state;

  // туман війни: видимі клітинки з погляду живих солдатів
  const vis = new Set<string>();
  for (const u of st.units) {
    if (u.side === 'player' && u.alive) for (const k2 of computeVisibleCells(st, u.pos)) vis.add(k2);
  }

  for (let y = 0; y < st.map.height; y++) {
    for (let x = 0; x < st.map.width; x++) {
      const k2 = x + ',' + y;
      const blocked = st.map.blocked.has(k2);
      const visible = vis.has(k2);
      ctx.fillStyle = blocked ? (visible ? '#3d4657' : '#232936') : (visible ? '#151b28' : '#0b0e15');
      ctx.fillRect(x * BCELL, y * BCELL, BCELL - 1, BCELL - 1);
    }
  }

  // позначки зон: висадка (синій пунктир) і НЛО (червоний пунктир)
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = 'rgba(110,168,255,0.5)';
  for (const p of SQUAD_SPAWN) ctx.strokeRect(p.x * BCELL + 2, p.y * BCELL + 2, BCELL - 5, BCELL - 5);
  ctx.strokeStyle = 'rgba(255,107,107,0.5)';
  for (const p of ALIEN_SPAWN) ctx.strokeRect(p.x * BCELL + 2, p.y * BCELL + 2, BCELL - 5, BCELL - 5);
  ctx.setLineDash([]);

  // юніти: солдати — кола з HP, прибульці — трикутники (лише видимі)
  ctx.font = '9px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const u of st.units) {
    if (!u.alive) continue;
    const visible = vis.has(u.pos.x + ',' + u.pos.y);
    if (u.side === 'alien' && !visible) continue;
    const cx = u.pos.x * BCELL + BCELL / 2, cy = u.pos.y * BCELL + BCELL / 2, r = 8;
    if (u.side === 'player') {
      ctx.fillStyle = '#6ea8ff';
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#0b0e15';
      ctx.fillText(String(u.hp), cx, cy);
    } else {
      ctx.fillStyle = '#ff6b6b';
      ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy + r); ctx.lineTo(cx - r, cy + r); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#0b0e15';
      ctx.fillText(String(u.hp), cx, cy + r / 3);
    }
  }
}

function renderAll(): void {
  renderGeo();
  renderUfos();
  renderRoster();
  if (mission) renderBattle(); else el('battle-panel').classList.add('hidden');
}

function stopTimer(): void {
  if (battleTimer !== undefined) { clearInterval(battleTimer); battleTimer = undefined; }
}

function closeBattle(): void {
  stopTimer();
  mission = null;
  battleResult = null;
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
  el('battle-panel').classList.remove('hidden');
  journal('▶ Місія: загін висаджено біля НЛО ' + ufoId);
  renderAll();
  battleTimer = setInterval(battleTick, 500);
}

function battleTick(): void {
  if (!mission || battleResult !== null) return;
  try {
    if (mission.state.activeSide === 'player') botTurn(mission.state);
    else aliensTurn(mission.state);
    const outcome = missionOutcome(mission.state);
    if (outcome !== 'триває') finishBattle(outcome);
  } catch (e) {
    stopTimer();
    battleResult = 'поразка';
    el('bresult').innerHTML = '<div class="banner lose">Помилка під час бою: ' + (e as Error).message + '</div>' +
      '<button id="btn-close">← Повернутись на геосцену</button>';
    (document.getElementById('btn-close') as HTMLButtonElement).onclick = closeBattle;
    return;
  }
  renderAll();
}

function finishBattle(outcome: 'перемога' | 'поразка'): void {
  if (!mission) return;
  stopTimer();
  battleResult = outcome;
  const aftermath = applyMissionResult(party.roster, mission.state);
  completeMission(party.geo, mission.briefing.ufoId, outcome);
  for (const s of aftermath.lost) journal('✝ ' + s.name + ' загинув у бою', 'lose');
  if (outcome === 'перемога') {
    el('bresult').innerHTML = '<div class="banner win">ЗАЧИЩЕНО ✓ — загін повернувся на базу (' + aftermath.survivors.length + ' виживших)</div>' +
      '<button id="btn-close">← Повернутись на геосцену</button>';
  } else {
    el('bresult').innerHTML = '<div class="banner lose">ЗАГІН ВТРАЧЕНО ✗ — НЛО лишається активним</div>' +
      '<button id="btn-close">← Повернутись на геосцену</button>';
  }
  (document.getElementById('btn-close') as HTMLButtonElement).onclick = closeBattle;
  renderAll();
}

function restart(): void {
  closeBattle();
  const seed = Number(el<HTMLInputElement>('seed').value) || 42;
  party = newParty(seed);
  renderAll();
  journal('Нова партія (сід ' + seed + '). Рухайте час — радар шукає НЛО.');
}

el('btn-tick').onclick = () => { if (!mission) { advanceTime(party.geo, 1); renderAll(); } };
el('btn-day').onclick = () => { if (!mission) { advanceTime(party.geo, 48); renderAll(); } };
el('btn-new').onclick = restart;
renderAll();
journal('Партію розпочато. Рухайте час — радар шукає НЛО.');
