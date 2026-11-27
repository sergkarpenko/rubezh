// src/ui/next-step.ts
// Т.43 (огляд Т.30, знахідка 1; рішення власника 15.11.2026): рядок «Наступний
// крок» у заголовку геосцени — одна порада за станом партії, перша, умова якої
// виконана (згори вниз). Чиста функція: лише читає стан (ADR-0002 — ядро про
// підказки не знає). Тексти затверджені власником дослівно.
// Т.79 (кандидат 45; рішення власника 19.11.2026): клік по рядку показує, де діяти, —
// відкриває вкладку колонки, прокручує до кнопки, підсвічує її і дає їй фокус; дію
// гравець натискає сам. Порада після витраченого гелю чи гранати — окремий текст
// («поповніть запас»), нижче за «видайте» і «ремонт».
// Т.80 (залишок кандидата 45; рішення власника 20.11.2026): рядок — у заголовку
// «Геосцени»; порада «модуль на складі — встановіть» одразу після «видайте».
// Т.97 (залишки аудитів Т.79–Т.80, кандидат 45): ціль «запустіть місію» — кнопка
// зонда з найменшим вікном (id btn-mission-<зонд>), а не перша активна; на вікнах
// до 940 px префікс «Наступний крок:» заміняє стрілка «→» (варіант В власника 21.11.2026).

import { sciencePrice } from '../core/campaign';
import { TICK_MINUTES, detectedUfos, missionTargets } from '../core/geo';
import { FIGHTER_MAX_HP, FIGHTER_REPAIR_COST } from '../core/intercept';
import type { Party } from '../core/save';
import { isBankrupt, readySoldiers } from '../core/squad';
import { ITEM_IDS, SoldierItemIdOf, WORKSHOP_CATALOG, itemUnlocked, type ItemId } from '../core/workshop';
import { EQUIP_ITEMS, fighterBtnId, fighterReady, gunModuleFighter, inAirCombat, readyToIssue } from './panels';
import type { StatusTabId } from './status-tabs';

export const NEXT_STEP = {
  landed: (hours: number): string => 'Наступний крок: зонд приземлився — запустіть місію (вікно ' + hours + ' год)',
  shotDown: 'Наступний крок: збитий зонд чекає — запустіть місію',
  inAir: 'Наступний крок: зонд у повітрі — перехопіть або чекайте приземлення',
  noReady: 'Наступний крок: немає боєготових — вербуйте або чекайте одужання',
  order: 'Наступний крок: протокол завершено — замовте предмет у «Кузні»',
  issue: 'Наступний крок: на складі є спорядження — видайте оперативникам',
  repair: 'Наступний крок: перехоплювач пошкоджений — замовте ремонт',
  time: 'Наступний крок: рухайте час — сенсорна сітка шукає зонди',
  refill: 'Наступний крок: витратник закінчився — поповніть запас у «Кузні»', // Т.79
  install: 'Наступний крок: гарматний модуль на складі — встановіть на перехоплювач', // Т.80
} as const;

// Т.79: куди веде клік по рядку — вкладка колонки (null — не перемикати) і кнопка:
// id або селектор (перша активна з кількох, інакше перша).
export interface StepTarget {
  tab: StatusTabId | null;
  id?: string;
  selector?: string;
}

export interface NextStep {
  text: string;
  target: StepTarget;
}

// Т.79: витратники — гель і граната зникають, коли їх використано (П11.4).
const CONSUMABLES: readonly ItemId[] = ['medkit', 'grenade'];

// Предмет уже колись виготовлено: подія «produced» у журналі «Кузні» (журнал у сейві).
function everProduced(party: Party, id: ItemId): boolean {
  return party.workshop.log.some((e) => e.type === 'produced' && e.id === id);
}

// Предмет завершеного протоколу, якого зараз ніде немає (ні на складі, ні в черзі
// «Кузні», ні в оперативників, ні на перехоплювачі), а кредитів на нього вистачає.
function canOrderNew(party: Party, id: (typeof ITEM_IDS)[number]): boolean {
  const w = party.workshop;
  if (!itemUnlocked(party.research, id)) return false;
  if (w.store[id] > 0 || w.queue.some((o) => o.id === id)) return false;
  if (id === 'gun-module') {
    // п19.4: модуль «є», коли він уже на кожному перехоплювачі (новому перехоплювачу — новий модуль)
    if (party.intercept.fighters.every((f) => f.gunModule === true)) return false;
  } else if (party.roster.soldiers.some((s) => w.equipped[s.id]?.[SoldierItemIdOf(id)] === true)) return false;
  return party.econ.money >= sciencePrice(WORKSHOP_CATALOG[id].cost, party.campaign.preset);
}

export interface NextStepContext {
  inBattle: boolean; // тактичний бій (ui.mission)
  gameOver: boolean; // банкрутство
}

// null — рядок прихований: бій, повітряний бій, партію програно, кампанію завершено.
// Банкрутство перевіряється і тут: main.ts виставляє gameOver лише на тіку, а стан
// «боєготових немає і на вербування бракує» настає одразу після витрати — порада
// «вербуйте або чекайте» вела б до програшу (аудит PR #339).
export function nextStepText(party: Party, ctx: NextStepContext): string | null {
  return nextStep(party, ctx)?.text ?? null;
}

const order = (id: ItemId): StepTarget => ({ tab: 'base', id: 'btn-order-' + id });
// Т.97: кнопка «Запустити місію» конкретного зонда (id ставить renderUfos у panels.ts)
const mission = (ufoId: string): StepTarget => ({ tab: 'base', id: 'btn-mission-' + ufoId });

// Т.97 (варіант В власника 21.11.2026): префікс — окремим span, щоб CSS на вікнах
// до 940 px ховав його і ставив стрілку «→» перед рештою; textContent рядка — повний
// текст поради, aria-label — теж (читач екрана чує «Наступний крок: …» на будь-якому вікні).
export const NEXT_STEP_PREFIX = 'Наступний крок: ';

export function renderNextStep(btn: HTMLElement, text: string | null): void {
  btn.replaceChildren();
  btn.classList.toggle('hidden', text === null);
  if (text === null) {
    btn.removeAttribute('aria-label');
    return;
  }
  btn.setAttribute('aria-label', text);
  const hasPrefix = text.startsWith(NEXT_STEP_PREFIX);
  const rest = document.createElement('span');
  rest.className = 'ns-rest';
  rest.textContent = hasPrefix ? text.slice(NEXT_STEP_PREFIX.length) : text;
  if (!hasPrefix) {
    btn.append(rest);
    return;
  }
  const prefix = document.createElement('span');
  prefix.className = 'ns-prefix';
  prefix.textContent = NEXT_STEP_PREFIX;
  btn.append(prefix, rest);
}

// Перша кнопка «спорядити» в ростері: оперативник без предмета, який є на складі.
function issueTarget(party: Party): StepTarget {
  for (const [itemId, slot] of EQUIP_ITEMS) {
    if (party.workshop.store[itemId] <= 0) continue;
    const s = party.roster.soldiers.find((x) => party.workshop.equipped[x.id]?.[slot] !== true);
    if (s) return { tab: 'squad', id: 'btn-equip-' + s.id + '-' + slot };
  }
  return { tab: 'squad', selector: '#roster button' };
}

export function nextStep(party: Party, ctx: NextStepContext): NextStep | null {
  if (ctx.inBattle || ctx.gameOver || inAirCombat(party) || party.campaign.status !== 'триває') return null;
  if (isBankrupt(party.econ, party.roster, party.campaign.preset)) return null;
  const ready = readySoldiers(party.roster).length;
  const fighters = party.intercept.fighters;
  const targets = missionTargets(party.geo);
  if (ready > 0) {
    const landed = targets.filter((u) => u.status === 'приземлився');
    if (landed.length > 0) {
      // Т.97: та сама кнопка, чиє вікно в тексті, — зонд з найменшим вікном (перший з рівних)
      const soonest = landed.reduce((a, u) => (u.landedTicksLeft < a.landedTicksLeft ? u : a));
      return { text: NEXT_STEP.landed((soonest.landedTicksLeft * TICK_MINUTES) / 60), target: mission(soonest.id) };
    }
    const shot = targets.find((u) => u.status === 'збитий');
    if (shot !== undefined) return { text: NEXT_STEP.shotDown, target: mission(shot.id) };
  }
  // п19.4: зонд у повітрі, якого ще ніхто не переслідує, і хоч один боєготовий перехоплювач
  const chased = new Set(fighters.filter((f) => f.status === 'погоня' || f.status === 'бій').map((f) => f.targetId));
  const flying = detectedUfos(party.geo).some((u) => u.status === 'летить' && !chased.has(u.id));
  if (flying && fighters.some(fighterReady)) return { text: NEXT_STEP.inAir, target: { tab: 'base', selector: '#ufos button.intercept' } };
  if (ready === 0) return { text: NEXT_STEP.noReady, target: { tab: 'squad', id: 'btn-hire' } };
  const toOrder = ITEM_IDS.filter((id) => canOrderNew(party, id));
  const fresh = toOrder.find((id) => !CONSUMABLES.includes(id) || !everProduced(party, id));
  if (fresh !== undefined) return { text: NEXT_STEP.order, target: order(fresh) };
  if (readyToIssue(party) > 0) return { text: NEXT_STEP.issue, target: issueTarget(party) };
  // Т.80: модуль на складі — одразу після «видайте» (рішення власника 20.11.2026)
  // п19.4: кнопки перехоплювачів — у середній колонці (без вкладки): ціль — картка першого, кому треба
  const gun = gunModuleFighter(party);
  if (gun !== null) return { text: NEXT_STEP.install, target: { tab: null, id: fighterBtnId('btn-gun-install', gun) } };
  // ремонт радимо, лише коли кнопка «Ремонт» активна (кредитів вистачає) — аудит PR #339
  const damaged = fighters.find((f) => f.status === 'на базі' && f.hp < FIGHTER_MAX_HP);
  if (damaged !== undefined && party.econ.money >= FIGHTER_REPAIR_COST)
    return { text: NEXT_STEP.repair, target: { tab: null, id: fighterBtnId('btn-repair', damaged) } };
  // Т.79: витратник, що вже був і закінчився, — нижче за «видайте» і «ремонт»
  if (toOrder.length > 0) return { text: NEXT_STEP.refill, target: order(toOrder[0]) };
  return { text: NEXT_STEP.time, target: { tab: null, id: 'btn-event' } };
}

// Т.79: клік по рядку — вкладка, прокрутка до кнопки, підсвітка (CSS-анімація
// .step-target, без таймерів; знімається на animationend чи blur) і фокус. Повертає кнопку або null, якщо її немає.
export function showStepTarget(target: StepTarget, setTab: (id: StatusTabId) => void): HTMLElement | null {
  if (target.tab !== null) setTab(target.tab);
  const found =
    target.id !== undefined
      ? [document.getElementById(target.id)].filter((e): e is HTMLElement => e !== null)
      : Array.from(document.querySelectorAll<HTMLElement>(target.selector ?? ''));
  const t = found.find((e) => !(e as HTMLButtonElement).disabled) ?? found[0];
  if (t === undefined) return null;
  t.scrollIntoView?.({ block: 'center' }); // центр — рамка спалаху не обрізається краєм вікна (аудит PR #393)
  t.classList.remove('step-target');
  void t.offsetWidth; // перезапуск анімації на повторний клік
  t.classList.add('step-target');
  // клас знімається після спалахів або з втратою фокусу: статичні кнопки (#btn-event, #btn-hire)
  // панелі не перемальовують, і рамка prefers-reduced-motion лишалась би назавжди (аудит PR #393)
  const clear = (): void => t.classList.remove('step-target');
  t.addEventListener('animationend', clear, { once: true });
  t.addEventListener('blur', clear, { once: true });
  t.focus({ preventScroll: true });
  return t;
}
