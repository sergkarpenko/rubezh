// src/ui/time-control.ts
// Т.43 (огляд Т.30, знахідка 8; рішення власника 15.11.2026): кнопки часу
// «До події» і «+1 доба» зупиняються на подіях. Модуль лише читає стан партії
// до і після одного тіку та вирішує, чи зупинитись; сам тік (partyTick у
// main.ts) викликається так само, як від кліку «+1 тік», тож детермінізм
// (ADR-0003) не зачеплено. Ядро про зупинки не знає (ADR-0002).

import type { Party } from '../core/save';

// Найдовший прогін однієї кнопки: 1 доба = 48 тіків по 30 хв.
export const MAX_RUN_TICKS = 48;

// «event» — кнопка «До події» (усі шість подій); «day» — «+1 доба» (лише зонди).
export type RunMode = 'event' | 'day';

export type StopEvent = 'ufo_detected' | 'ufo_landed' | 'project_completed' | 'produced' | 'recovered' | 'repair_done';

const DAY_STOPS: ReadonlySet<StopEvent> = new Set<StopEvent>(['ufo_detected', 'ufo_landed']);

// Відбиток стану перед тіком: довжини журналів і перелік поранених.
export interface TickSnapshot {
  geoLog: number;
  researchLog: number;
  workshopLog: number;
  hospital: string[];
  campaignStatus: string;
}

export function takeSnapshot(party: Party): TickSnapshot {
  return {
    geoLog: party.geo.log.length,
    researchLog: party.research.log.length,
    workshopLog: party.workshop.log.length,
    hospital: Object.keys(party.roster.hospital),
    campaignStatus: party.campaign.status,
  };
}

// Події зупинки, що сталися після відбитка `before`.
// Приземлення невиявленого зонда подією не є (туман: гравець про нього не знає).
export function stopEvents(party: Party, before: TickSnapshot): StopEvent[] {
  const out: StopEvent[] = [];
  for (const e of party.geo.log.slice(before.geoLog)) {
    if (e.type === 'ufo_detected') out.push('ufo_detected');
    else if (e.type === 'ufo_landed') {
      if (party.geo.ufos.some((u) => u.id === e.ufoId && u.detected)) out.push('ufo_landed');
    } else if (e.type === 'fighter_repair_done') out.push('repair_done');
  }
  if (party.research.log.slice(before.researchLog).some((e) => e.type === 'project_completed')) out.push('project_completed');
  if (party.workshop.log.slice(before.workshopLog).some((e) => e.type === 'produced')) out.push('produced');
  const inRoster = new Set(party.roster.soldiers.map((s) => s.id));
  if (before.hospital.some((id) => party.roster.hospital[id] === undefined && inRoster.has(id))) out.push('recovered');
  return out;
}

export function shouldStop(mode: RunMode, events: StopEvent[]): boolean {
  return mode === 'event' ? events.length > 0 : events.some((e) => DAY_STOPS.has(e));
}

// Прогін часу: до MAX_RUN_TICKS тіків, зупинка після тіку з подією режиму або
// коли час далі не йде (`halted`: бій, повітряний бій, банкрутство) чи кампанію
// щойно завершено. Повертає число зроблених тіків.
export function runTime(mode: RunMode, party: Party, tick: () => void, halted: () => boolean): number {
  let done = 0;
  while (done < MAX_RUN_TICKS && !halted()) {
    const before = takeSnapshot(party);
    tick();
    done++;
    if (party.campaign.status !== before.campaignStatus) break;
    if (shouldStop(mode, stopEvents(party, before))) break;
  }
  return done;
}

// Пробіл на геосцені = «До події». Не діє з поля вводу і з кнопки у фокусі
// (пробіл на кнопці вже натискає її саму — подвійного спрацювання не буде).
export function isSpaceForEvent(ev: KeyboardEvent): boolean {
  if (ev.code !== 'Space' && ev.key !== ' ') return false;
  if (ev.repeat || ev.ctrlKey || ev.metaKey || ev.altKey) return false;
  const t = ev.target;
  if (!(t instanceof HTMLElement)) return true;
  const tag = t.tagName;
  return !(tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON' || t.isContentEditable);
}
