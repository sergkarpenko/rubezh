// п18.5 (ADR-0157; EARS 10 Фази 18): мета кампанії в UI — чип загрози в шапці, панель «Мета кампанії»
// першою на вкладці «Вузол» (рішення власника «А. Шапка + панель») і екрани кінця партії з причиною,
// добою і розкладом рахунку (рішення власника «А. Два вікна + зупинка»). Чисті функції тексту — для
// юніт-тестів; render* лише пишуть DOM. Числа — з констант ядра (урок П9.1), ядро не змінюється (ADR-0002).

import { ASSAULT_THRESHOLDS, THREAT_MAX, campaignScore, type CampaignScore } from '../core/campaign';
import { SCORE_PER_MISSION_WON, SCORE_PER_MONEY, SCORE_PER_UFO_SHOT_DOWN, SCORE_PER_VETERAN_ALIVE } from '../core/campaign';
import { gateKeyDone, gateOpen } from '../core/assault';
import { ENEMY_KINDS, ENEMY_ORDER } from '../core/enemies';
import { TICK_MINUTES, geoDay } from '../core/geo';
import { KEY_PROJECTS, missingTrophies, type ProjectDef } from '../core/research';
import type { Party } from '../core/save';
import { el } from './dom';
import { ticksText } from './text';

export type ThreatLevel = '' | 'warn' | 'crit';

// Колір чипа: бурштин — від першого порога штурму, червоний — від останнього.
export function threatLevel(threat: number): ThreatLevel {
  if (threat >= ASSAULT_THRESHOLDS[ASSAULT_THRESHOLDS.length - 1]) return 'crit';
  if (threat >= ASSAULT_THRESHOLDS[0]) return 'warn';
  return '';
}

// Підказка чипа — правило загрози словами (пороги з ядра).
export function threatTitle(threat: number): string {
  return (
    'Загроза Розриву ' +
    threat +
    ' з ' +
    THREAT_MAX +
    ': на ' +
    ASSAULT_THRESHOLDS.join(', ') +
    ' — штурм вузла, на ' +
    THREAT_MAX +
    ' — поразка'
  );
}

// Трофеї складу порядком типів: «демон 2 · гончак 0 · голем 1 · око 0».
export function trophiesText(party: Party): string {
  return ENEMY_ORDER.map((k) => ENEMY_KINDS[k].name.toLowerCase() + ' ' + party.research.trophies[k]).join(' · ');
}

// Перший незавершений ключовий протокол ланцюжка; null — усі три завершено.
export function nextKeyProject(party: Party): ProjectDef | null {
  return KEY_PROJECTS.find((p) => !party.research.completed.includes(p.id)) ?? null;
}

// Рядок «що далі» панелі: протокол і чого бракує, або стан Брами.
export function goalNextText(party: Party): string {
  const c = party.campaign;
  if (c.status === 'перемога') return 'Браму Розриву зачинено — кампанію виграно.';
  const next = nextKeyProject(party);
  if (next === null) {
    if (gateOpen(party)) return 'Брама Розриву відкрита — атакуйте її в «Сенсорній сітці» або тапом по порталу на геосцені.';
    if (gateKeyDone(party) && c.status === 'триває') {
      const left = Math.max(1, Math.ceil(((c.gateReadyAt ?? 0) - party.geo.minute) / TICK_MINUTES));
      return 'Брама Розриву — новий штурм через ' + ticksText(left) + '.';
    }
    return 'Брама Розриву недоступна.';
  }
  const head = 'Наступний крок до Брами: «' + next.name + '»';
  const active = party.research.active.find((p) => p.id === next.id);
  if (active) return head + ' — у роботі, ' + active.invested + ' з ' + next.points + ' очок потоку.';
  const lack = missingTrophies(party.research.trophies, next.trophies);
  if (lack !== undefined) return head + '. ' + lack + '.';
  return head + ' — трофеїв досить, дослідіть у панелі «Дослідження».';
}

// Ланцюжок: ✓ завершено, ◉ поточний крок, ○ далі; останній крок — Брама.
export function goalChain(party: Party): { text: string; cls: 'done' | 'now' | 'later' }[] {
  const out: { text: string; cls: 'done' | 'now' | 'later' }[] = [];
  let current = false;
  for (const p of KEY_PROJECTS) {
    if (party.research.completed.includes(p.id)) out.push({ text: '✓ ' + p.name, cls: 'done' });
    else if (!current) {
      current = true;
      out.push({ text: '◉ ' + p.name, cls: 'now' });
    } else out.push({ text: '○ ' + p.name, cls: 'later' });
  }
  const won = party.campaign.status === 'перемога';
  out.push(won ? { text: '✓ Брама', cls: 'done' } : current ? { text: '○ Брама', cls: 'later' } : { text: '◉ Брама', cls: 'now' });
  return out;
}

// «Штурми вузла: 1 з 3 (наступний — на загрозі 75)».
export function assaultsText(party: Party): string {
  const n = party.campaign.assaults ?? 0;
  const all = ASSAULT_THRESHOLDS.length;
  const head = 'Штурми вузла: ' + n + ' з ' + all;
  return n < all ? head + ' (наступний — на загрозі ' + ASSAULT_THRESHOLDS[n] + ')' : head;
}

// Рахунок партії: зафіксований у мить кінця або (банкрутство — рахунку ядро не фіксує) поточний.
export function endScore(party: Party): CampaignScore {
  return party.campaign.score ?? campaignScore(party.geo, party.roster, party.econ);
}

// Розклад рахунку: «зонди 3 × 100 · місії 5 × 150 · живі 4 × 50 · кредити 0,25 × 400».
export function scoreLinesText(s: CampaignScore): string {
  return (
    'зонди ' +
    s.ufosShotDown +
    ' × ' +
    SCORE_PER_UFO_SHOT_DOWN +
    ' · місії ' +
    s.missionsWon +
    ' × ' +
    SCORE_PER_MISSION_WON +
    ' · живі ' +
    s.veteransAlive +
    ' × ' +
    SCORE_PER_VETERAN_ALIVE +
    ' · кредити ' +
    String(SCORE_PER_MONEY).replace('.', ',') +
    ' × ' +
    s.moneyLeft
  );
}

// Причина поразки: загроза 100 (доба поразки ядра) або банкрутство (доба геоцени).
export function defeatText(party: Party): string {
  const c = party.campaign;
  if (c.status === 'поразка') return 'Загроза Розриву досягла ' + THREAT_MAX + ' на ' + (c.defeatDay ?? geoDay(party.geo)) + '-й добі.';
  return 'Банкрутство на ' + geoDay(party.geo) + '-й добі: немає боєготових оперативників і кредитів на вербування.';
}

export function victoryText(party: Party): string {
  return 'Брама Розриву зачинена на ' + (party.campaign.victoryDay ?? geoDay(party.geo)) + '-й добі.';
}

// Чип загрози в шапці: число, смужка 0–100 з рисками порогів штурму, колір за рівнем.
export function renderThreatChip(party: Party): void {
  const t = party.campaign.threat;
  const chip = el('threat');
  const ticks = ASSAULT_THRESHOLDS.map((v) => '<s style="left:' + (v / THREAT_MAX) * 100 + '%"></s>').join('');
  chip.innerHTML =
    'Загроза <b id="threat-num">' +
    t +
    '</b><span class="tbar" aria-hidden="true"><i style="width:' +
    Math.min(100, (t / THREAT_MAX) * 100) +
    '%"></i>' +
    ticks +
    '</span>';
  chip.className = 'chip' + (threatLevel(t) === '' ? '' : ' ' + threatLevel(t));
  chip.title = threatTitle(t);
}

// Панель «Мета кампанії» (вкладка «Вузол»).
export function renderGoalPanel(party: Party): void {
  const box = el('campaign-goal');
  box.innerHTML = '';
  const chain = document.createElement('div');
  chain.className = 'goal-chain';
  for (const step of goalChain(party)) {
    const s = document.createElement('span');
    s.className = step.cls;
    s.textContent = step.text;
    chain.appendChild(s);
  }
  const lines = [goalNextText(party), 'Трофеї: ' + trophiesText(party), assaultsText(party)];
  box.appendChild(chain);
  for (const text of lines) {
    const d = document.createElement('div');
    d.textContent = text;
    box.appendChild(d);
  }
  box.lastElementChild?.classList.add('meta');
}

// Екрани кінця партії. victoryShown — екран перемоги видимий (не закрито «Грати далі»);
// defeatShown — поразка (загроза чи банкрутство) поза боєм.
export function renderEndScreens(party: Party, victoryShown: boolean, defeatShown: boolean): void {
  el('campaign-victory').classList.toggle('hidden', !victoryShown);
  el('campaign-defeat').classList.toggle('hidden', !defeatShown);
  if (party.campaign.status === 'перемога') {
    // П8.3a: рахунок перемоги лишається і після «Грати далі» (екран схований)
    const s = endScore(party);
    el('campaign-victory-text').textContent = victoryText(party);
    el('campaign-score').textContent = String(s.total);
    el('campaign-score-lines').textContent = scoreLinesText(s);
  }
  if (defeatShown) {
    const s = endScore(party);
    el('campaign-defeat-text').textContent = defeatText(party);
    el('campaign-defeat-score').textContent = String(s.total);
    el('campaign-defeat-lines').textContent = scoreLinesText(s);
  }
}
