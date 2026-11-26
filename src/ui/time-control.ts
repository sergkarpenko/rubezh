// src/ui/time-control.ts
// Т.43 (огляд Т.30, знахідка 8; рішення власника 15.11.2026): кнопки часу
// «До події» і «+1 доба» зупиняються на подіях. Модуль лише читає стан партії
// до і після одного тіку та вирішує, чи зупинитись; сам тік (partyTick у
// main.ts) викликається так само, як від кліку «+1 тік», тож детермінізм
// (ADR-0003) не зачеплено. Ядро про зупинки не знає (ADR-0002).

import type { Party } from '../core/save';

// Найдовший прогін однієї кнопки: 1 доба = 48 тіків по 30 хв.
export const MAX_RUN_TICKS = 48;

// «event» — кнопка «До події» (усі сім подій); «day» — «+1 доба» (зонди і штурм вузла, п18.5).
export type RunMode = 'event' | 'day';

export type StopEvent = 'ufo_detected' | 'ufo_landed' | 'project_completed' | 'produced' | 'recovered' | 'repair_done' | 'assault';

// п18.5 (ADR-0157; рішення власника «А. Два вікна + зупинка»): штурм вузла і програний штурм
// (без боєготових бою немає — лише рядок журналу) зупиняють обидві кнопки.
const DAY_STOPS: ReadonlySet<StopEvent> = new Set<StopEvent>(['ufo_detected', 'ufo_landed', 'assault']);

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
    else if (e.type === 'base_assault' || e.type === 'assault_lost') out.push('assault');
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

// Пробіл на геосцені = «До події» (рішення власника 15.11.2026: після кліку
// мишею фокус лишається на кнопці, і пробіл не має її повторювати; фокус із
// кнопки знімає обробник у main.ts). Т.98 (рішення власника 21.11.2026):
// кнопку, вибрану з клавіатури (`keyboardFocus`: після Tab чи N, до наступного
// натискання вказівника), пробіл натискає сам, як звичайна кнопка браузера.
// :focus-visible для цього не годиться: Chrome вмикає його вже на keydown
// пробілу і після кліку мишею. З поля вводу, переліку чи текстового поля
// пробіл лишається звичайним символом.
export function isSpaceForEvent(ev: KeyboardEvent, keyboardFocus = false): boolean {
  if (ev.code !== 'Space' && ev.key !== ' ') return false;
  if (ev.repeat || ev.ctrlKey || ev.metaKey || ev.altKey) return false;
  const t = ev.target;
  if (!(t instanceof HTMLElement)) return true;
  if (keyboardFocus && t instanceof HTMLButtonElement) return false;
  return !isTypingElement(t);
}

function isTypingElement(t: HTMLElement): boolean {
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}

// Т.98 (рішення власника 21.11.2026): гарячі клавіші геосцени — за фізичною
// клавішею (ev.code, незалежно від розкладки), як клавіші бою: D — «+1 доба»,
// T — «+1 тік», N — «Наступний крок» (вкладка і фокус на кнопці дії, далі Enter
// чи пробіл). Без утримання і модифікаторів; з поля вводу не діють.
export type GeoHotkey = 'day' | 'tick' | 'next';

const GEO_HOTKEYS: Partial<Record<string, GeoHotkey>> = { KeyD: 'day', KeyT: 'tick', KeyN: 'next' };

export function geoHotkey(ev: KeyboardEvent): GeoHotkey | null {
  const key = GEO_HOTKEYS[ev.code];
  if (key === undefined) return null;
  if (ev.repeat || ev.ctrlKey || ev.metaKey || ev.altKey || ev.shiftKey) return null;
  const t = ev.target;
  if (t instanceof HTMLElement && isTypingElement(t)) return null;
  return key;
}
