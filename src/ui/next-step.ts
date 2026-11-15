// src/ui/next-step.ts
// Т.43 (огляд Т.30, знахідка 1; рішення власника 15.11.2026): рядок «Наступний
// крок» у шапці геосцени — одна порада за станом партії, перша, умова якої
// виконана (згори вниз). Чиста функція: лише читає стан (ADR-0002 — ядро про
// підказки не знає). Тексти затверджені власником дослівно.

import { sciencePrice } from '../core/campaign';
import { TICK_MINUTES, detectedUfos, missionTargets } from '../core/geo';
import { FIGHTER_MAX_HP } from '../core/intercept';
import type { Party } from '../core/save';
import { readySoldiers } from '../core/squad';
import { ITEM_IDS, WORKSHOP_CATALOG, type ItemId } from '../core/workshop';
import { inAirCombat, readyToIssue } from './panels';

export const NEXT_STEP = {
  landed: (hours: number): string => 'Наступний крок: зонд приземлився — запустіть місію (вікно ' + hours + ' год)',
  shotDown: 'Наступний крок: збитий зонд чекає — запустіть місію',
  inAir: 'Наступний крок: зонд у повітрі — перехопіть або чекайте приземлення',
  noReady: 'Наступний крок: немає боєготових — вербуйте або чекайте одужання',
  order: 'Наступний крок: протокол завершено — замовте предмет у «Кузні»',
  issue: 'Наступний крок: на складі є спорядження — видайте оперативникам',
  repair: 'Наступний крок: перехоплювач пошкоджений — замовте ремонт',
  time: 'Наступний крок: рухайте час — сенсорна сітка шукає зонди',
} as const;

// Предмет завершеного протоколу, якого зараз ніде немає (ні на складі, ні в черзі
// «Кузні», ні в оперативників, ні на перехоплювачі), а кредитів на нього вистачає.
function canOrderNew(party: Party, id: ItemId): boolean {
  const w = party.workshop;
  if (!party.research.completed.includes(id)) return false;
  if (w.store[id] > 0 || w.queue.some((o) => o.id === id)) return false;
  if (id === 'gun-module') {
    if (party.intercept.fighter.gunModule) return false;
  } else if (party.roster.soldiers.some((s) => w.equipped[s.id]?.[id] === true)) return false;
  return party.econ.money >= sciencePrice(WORKSHOP_CATALOG[id].cost, party.campaign.preset);
}

export interface NextStepContext {
  inBattle: boolean; // тактичний бій (ui.mission)
  gameOver: boolean; // банкрутство
}

// null — рядок прихований: бій, повітряний бій, партію програно, кампанію завершено.
export function nextStepText(party: Party, ctx: NextStepContext): string | null {
  if (ctx.inBattle || ctx.gameOver || inAirCombat(party) || party.campaign.status !== 'триває') return null;
  const ready = readySoldiers(party.roster).length;
  const fighter = party.intercept.fighter;
  const targets = missionTargets(party.geo);
  if (ready > 0) {
    const landed = targets.filter((u) => u.status === 'приземлився');
    if (landed.length > 0) return NEXT_STEP.landed((Math.min(...landed.map((u) => u.landedTicksLeft)) * TICK_MINUTES) / 60);
    if (targets.some((u) => u.status === 'збитий')) return NEXT_STEP.shotDown;
  }
  const flying = detectedUfos(party.geo).some((u) => u.status === 'летить');
  if (flying && fighter.status === 'на базі' && fighter.hp === FIGHTER_MAX_HP) return NEXT_STEP.inAir;
  if (ready === 0) return NEXT_STEP.noReady;
  if (ITEM_IDS.some((id) => canOrderNew(party, id))) return NEXT_STEP.order;
  if (readyToIssue(party) > 0) return NEXT_STEP.issue;
  if (fighter.status === 'на базі' && fighter.hp < FIGHTER_MAX_HP) return NEXT_STEP.repair;
  return NEXT_STEP.time;
}
