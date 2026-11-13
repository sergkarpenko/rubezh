// scripts/probe-t23.ts — probe політик науки бот-гравця (Т.23): чи окуповується
// наука за розумнішої політики, ніж чинна SCIENCE_POLICY. Константи й правила
// гри ті самі; ядро не змінюється. Повторює цикл simulateParty
// (src/core/party-bot.ts) тими самими кроками бота, але політику на кожен тік
// будує за станом партії. `--verify` звіряє варіанти `none` і `sci3` із
// simulateParty (результат, тіки, місії, гроші за добами).
// Поза CI, як sim-p11.8.ts і trace-party.ts:
//   npx -y vite-node scripts/probe-t23.ts -- --variants sci3,sci1,rh --presets норма --seeds 480 --out dist/t23.csv
// Варіант — частини через «+»:
//   none    — без науки (DEFAULT_PARTY_POLICY);
//   sciN    — штат техномантів не більше N (чинна політика — sci3);
//   afterN  — наука починається після N-ї завершеної доби, до того — політика без науки;
//   resN    — резерв грошей для витрат на науку N кредитів (чинний — 50, спільний із наймом);
//   rh, rh2 — резерв для науки = ціна найму оперативника (×2) за пресетом;
//   p:a.b.c — протоколи лише ці й у цьому порядку (цех — ті самі предмети в тому ж порядку);
//   fire    — щойно всі протоколи політики завершено, усіх техномантів звільнено;
//   done:a.b — ці протоколи завершено від першого тіку без техномантів і витрат (стан партії
//             задає скрипт); предмети бот замовляє в цеху за гроші;
//   gift    — верхня межа користі: склад повний (99 кожного предмета) від першого тіку,
//             без техномантів, протоколів і витрат; бот лише екіпірує (стан партії задає
//             скрипт); gift+afterN — склад наповнюється після N-ї доби;
//   g:<предмет> — те саме для одного предмета (medkit, grenade, optics, armor, gun-module).
// Т.25 — probe констант (ядро не змінюється; зарплату міряють у копії репозиторію з sed):
//   c:<предмет>=N — ціна предмета в цеху N кредитів (на час варіанта міняє запис каталогу в пам'яті);
//   keep    — броня й око загиблого повертаються на склад (скрипт читає журнал цеху після бою);
//   eqN     — бот замовляє й екіпірує предмети лише для перших N боєготових (eq3 — загін місії);
//             eq99 повторює чинну політику іншим кодом — звірка цього варіанта.
// Детермінізм (ADR-0003): сіди 1..N. Зведення — docs/reports/t23-science-policies.md.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { advanceTime, geoDay } from '../src/core/geo';
import { economyTick, hirePrice } from '../src/core/economy';
import { hospitalTick, isBankrupt, readySoldiers } from '../src/core/squad';
import { interceptTick, repairTick } from '../src/core/intercept';
import { DIFFICULTY_MULTIPLIERS, VICTORY_DAY, campaignScore, campaignTick, type DifficultyPreset } from '../src/core/campaign';
import { createParty } from '../src/core/save';
import { fireScientist, researchTick, type ProjectId } from '../src/core/research';
import { WORKSHOP_CATALOG, equipItem, installGunModule, orderItem, workshopTick, type ItemId } from '../src/core/workshop';
import {
  DEFAULT_PARTY_POLICY,
  MISSION_SQUAD_SIZE,
  SCIENCE_POLICY,
  TICKS_PER_DAY,
  partyBotHireStep,
  partyBotInterceptStep,
  partyBotMissionStep,
  partyBotScienceStep,
  simulateParty,
  type PartyBotPolicy,
} from '../src/core/party-bot';

function arg(flag: string, def: string): string {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const variants = arg('--variants', 'none,sci3').split(',');
const presets = arg('--presets', 'норма').split(',') as DifficultyPreset[];
const seedCount = Math.max(1, Number(arg('--seeds', '120')) || 120);
const out = arg('--out', '');
const verify = process.argv.includes('--verify');

interface Variant {
  science: boolean;
  gift: ItemId[]; // предмети, які скрипт кладе на склад без витрат
  scientists: number;
  projects: ProjectId[] | null; // null — порядок SCIENCE_POLICY
  fire: boolean;
  done: ProjectId[]; // протоколи, завершені від початку без витрат
  afterDay: number; // наука — після стількох завершених діб
  reserve: (preset: DifficultyPreset) => number | null; // null — резерв політики (спільний із наймом)
  costs: Partial<Record<ItemId, number>>; // Т.25: ціни предметів на час варіанта
  keep: boolean; // Т.25: броня й око загиблого повертаються на склад
  equipFirst: number; // Т.25: замовляти й екіпірувати для перших N боєготових; 0 — крок бота
}

function parseVariant(name: string): Variant {
  const v: Variant = {
    science: true,
    gift: [],
    projects: null,
    fire: false,
    done: [],
    scientists: SCIENCE_POLICY.scientistsUpTo,
    afterDay: 0,
    reserve: () => null,
    costs: {},
    keep: false,
    equipFirst: 0,
  };
  for (const part of name.split('+')) {
    const num = Number(part.replace(/^[a-z]+/, ''));
    if (part === 'none') v.science = false;
    else if (part === 'gift') v.gift = Object.keys(WORKSHOP_CATALOG) as ItemId[];
    else if (part.startsWith('p:')) v.projects = part.slice(2).split('.') as ProjectId[];
    else if (part === 'fire') v.fire = true;
    else if (part.startsWith('done:')) v.done = part.slice(5).split('.') as ProjectId[];
    else if (part.startsWith('g:')) v.gift = [part.slice(2) as ItemId];
    else if (part.startsWith('c:')) v.costs[part.slice(2).split('=')[0] as ItemId] = Number(part.split('=')[1]);
    else if (part === 'keep') v.keep = true;
    else if (part.startsWith('eq')) v.equipFirst = num;
    else if (part.startsWith('sci')) v.scientists = num;
    else if (part.startsWith('after')) v.afterDay = num;
    else if (part === 'rh') v.reserve = (p) => hirePrice(p);
    else if (part === 'rh2') v.reserve = (p) => 2 * hirePrice(p);
    else if (part.startsWith('res')) v.reserve = () => num;
    else throw new Error(`Невідома частина варіанта: ${part}`);
  }
  return v;
}

interface Rec {
  variant: string;
  preset: DifficultyPreset;
  seed: number;
  won: boolean;
  ticks: number;
  missions: number;
  missionsWon: number;
  lost: number; // загиблих оперативників
  hired: number;
  moneyByDay: number[];
  readyByDay: number[];
  roster: number; // живі разом із лікарнею наприкінці партії
  score: number;
  projects: number; // завершених протоколів
  scientistDays: number; // сума штату техномантів за добами
  spentScience: number; // найм техномантів + протоколи + цех
  spentSalary: number;
}

// Т.25: пункти 3–5 partyBotScienceStep (цех, екіпірування, гарматний модуль) для
// перших `first` боєготових замість усіх. Решта умов — як у кроці бота.
const SOLDIER_ITEMS = ['armor', 'optics', 'medkit', 'grenade'] as const;
function scienceTail(party: ReturnType<typeof createParty>, policy: PartyBotPolicy, first: number): void {
  const preset = party.campaign.preset;
  const w = party.workshop;
  const squad = readySoldiers(party.roster).slice(0, first);
  if (policy.workshopOrders.length > 0 && w.queue.length === 0) {
    for (const id of policy.workshopOrders) {
      if (!party.research.completed.includes(id)) continue;
      const lacking =
        id === 'gun-module' ? (party.intercept.fighter.gunModule ? 0 : 1) : squad.filter((s) => !w.equipped[s.id]?.[id]).length;
      if (lacking - w.store[id] - w.queue.filter((o) => o.id === id).length <= 0) continue;
      const price = Math.round(WORKSHOP_CATALOG[id].cost * DIFFICULTY_MULTIPLIERS[preset].economyMultiplier);
      if (party.econ.money - price < policy.hireReserve) continue;
      orderItem(party.econ, w, party.research, id, preset);
      break;
    }
  }
  if (!policy.equip) return;
  for (const soldier of squad) {
    for (const id of SOLDIER_ITEMS) {
      if (w.equipped[soldier.id]?.[id] || w.store[id] <= 0) continue;
      equipItem(w, soldier, id);
    }
  }
  if (party.intercept.fighter.status === 'на базі' && !party.intercept.fighter.gunModule && w.store['gun-module'] > 0) {
    installGunModule(w, party.intercept);
  }
}

function run(name: string, v: Variant, preset: DifficultyPreset, seed: number): Rec {
  const party = createParty(seed, preset);
  const sci: PartyBotPolicy = v.gift.length
    ? { ...SCIENCE_POLICY, scientistsUpTo: 0, projects: [], workshopOrders: [] }
    : { ...SCIENCE_POLICY, scientistsUpTo: v.scientists };
  if (v.done.length) {
    party.research.completed = [...v.done];
    sci.scientistsUpTo = 0;
    sci.projects = [];
    sci.workshopOrders = v.done.filter((id): id is ItemId => id !== 'lab-extension');
  }
  if (v.projects) {
    sci.projects = v.projects;
    sci.workshopOrders = v.projects.filter((id): id is ItemId => id !== 'lab-extension');
  }
  const reserve = v.reserve(preset);
  const sciStep: PartyBotPolicy = reserve === null ? sci : { ...sci, hireReserve: reserve };
  const sciDone: PartyBotPolicy = { ...sciStep, scientistsUpTo: 0 };
  const rec: Rec = {
    variant: name,
    preset,
    seed,
    won: false,
    ticks: 0,
    missions: 0,
    missionsWon: 0,
    lost: 0,
    hired: 0,
    moneyByDay: [],
    readyByDay: [],
    roster: 0,
    score: 0,
    projects: 0,
    scientistDays: 0,
    spentScience: 0,
    spentSalary: 0,
  };
  let lastDay = geoDay(party.geo);
  for (let t = 0; t < VICTORY_DAY * TICKS_PER_DAY; t++) {
    // Наука ввімкнена: варіант із наукою і минуло afterDay завершених діб.
    const on = v.science && rec.moneyByDay.length >= v.afterDay;
    const policy = on ? sci : DEFAULT_PARTY_POLICY;
    if (on && t % TICKS_PER_DAY === 0) for (const id of v.gift) party.workshop.store[id] = 99;
    partyBotInterceptStep(party, policy.intercept);
    interceptTick(party.intercept, party.geo);
    repairTick(party.intercept, party.geo);
    advanceTime(party.geo, 1);
    economyTick(party.econ, party.geo, preset);
    const m0 = party.econ.money;
    researchTick(party.research, party.econ, party.geo, preset);
    rec.spentSalary += m0 - party.econ.money;
    workshopTick(party.workshop);
    hospitalTick(party.roster);
    rec.hired += partyBotHireStep(party, policy);
    const m1 = party.econ.money;
    const done = v.fire && sci.projects.every((id) => party.research.completed.includes(id));
    if (on && done) for (const sc of [...party.research.scientists]) fireScientist(party.research, sc.id);
    const step = on ? (done ? sciDone : sciStep) : DEFAULT_PARTY_POLICY;
    if (on && v.equipFirst > 0) {
      partyBotScienceStep(party, { ...step, workshopOrders: [], equip: false });
      scienceTail(party, step, v.equipFirst);
    } else partyBotScienceStep(party, step);
    rec.spentScience += m1 - party.econ.money;
    const logFrom = party.workshop.log.length;
    const m = partyBotMissionStep(party, policy);
    if (v.keep) {
      for (const e of party.workshop.log.slice(logFrom)) {
        if (e.type !== 'equipment_lost') continue;
        for (const k of e.items) if (k === 'armor' || k === 'optics') party.workshop.store[k] += 1;
      }
    }
    if (m.launched) {
      rec.missions += 1;
      if (m.outcome === 'перемога') rec.missionsWon += 1;
      rec.lost += m.lost;
    }
    rec.ticks = t + 1;
    const day = geoDay(party.geo);
    if (day !== lastDay) {
      rec.moneyByDay.push(party.econ.money);
      rec.readyByDay.push(readySoldiers(party.roster).length);
      rec.scientistDays += party.research.scientists.length;
      lastDay = day;
    }
    if (isBankrupt(party.econ, party.roster, preset)) break;
    campaignTick({ geo: party.geo, roster: party.roster, econ: party.econ }, party.campaign);
    if (party.campaign.status === 'перемога') {
      rec.won = true;
      break;
    }
  }
  const score = campaignScore(party.geo, party.roster, party.econ);
  rec.roster = score.veteransAlive;
  rec.score = score.total;
  rec.projects = party.research.completed.length;
  return rec;
}

const median = (a: number[]): number => {
  const s = [...a].sort((x, y) => x - y);
  const mid = s.length >> 1;
  return s.length ? (s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2) : NaN;
};
const quantile = (a: number[], p: number): number => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const mean = (a: number[]): number => a.reduce((x, y) => x + y, 0) / a.length;
const f1 = (x: number): string => x.toFixed(1);

const all: Rec[] = [];
const ITEMS = Object.keys(WORKSHOP_CATALOG) as ItemId[];
// Ціни каталогу до першого варіанта: кожен варіант стартує від них, а не від цін попереднього.
const baseCosts = Object.fromEntries(ITEMS.map((id) => [id, WORKSHOP_CATALOG[id].cost]));
console.log(
  '| Варіант / пресет | Перемог, % | Виграно місій на партію | Частка виграних місій, % | Місій на добу | Діб без повного загону, % | Завершили 30-ту добу | Гроші на 30-ту добу | Ростер на 30-ту добу | Загиблих на партію | Протоколів | Техномантів у середньому | Витрати: наука / зарплата | Рахунок, медіана |'
);
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const name of variants) {
  const v = parseVariant(name);
  for (const id of ITEMS) WORKSHOP_CATALOG[id].cost = v.costs[id] ?? baseCosts[id];
  for (const preset of presets) {
    const rs: Rec[] = [];
    let mismatch = 0;
    for (let seed = 1; seed <= seedCount; seed++) {
      const r = run(name, v, preset, seed);
      rs.push(r);
      if (!verify) continue;
      if (name !== 'none' && name !== 'sci3') throw new Error('--verify — лише для варіантів none і sci3');
      const ref = simulateParty(seed, preset, { policy: name === 'none' ? DEFAULT_PARTY_POLICY : SCIENCE_POLICY });
      const same =
        (ref.outcome === 'перемога') === r.won &&
        ref.ticks === r.ticks &&
        ref.missionsLaunched === r.missions &&
        ref.missionsWon === r.missionsWon &&
        ref.hiredTotal === r.hired &&
        ref.score.total === r.score &&
        ref.projectsCompleted === r.projects &&
        ref.salarySpent === r.spentSalary &&
        ref.moneyByDay.join() === r.moneyByDay.join() &&
        ref.readyByDay.join() === r.readyByDay.join();
      if (!same) {
        mismatch += 1;
        console.log(`розбіжність із simulateParty: ${name} / ${preset} / сід ${seed}`);
      }
    }
    all.push(...rs);
    const at30 = rs.filter((r) => r.moneyByDay.length >= VICTORY_DAY);
    const days = rs.reduce((a, r) => a + r.readyByDay.length, 0);
    const noFull = rs.reduce((a, r) => a + r.readyByDay.filter((n) => n < MISSION_SQUAD_SIZE).length, 0);
    const missions = rs.reduce((a, r) => a + r.missions, 0);
    const wonM = rs.reduce((a, r) => a + r.missionsWon, 0);
    const money = at30.map((r) => r.moneyByDay[VICTORY_DAY - 1]);
    console.log(
      `| ${name} / ${preset} | ${f1((100 * rs.filter((r) => r.won).length) / rs.length)} | ${f1(wonM / rs.length)} | ${f1((100 * wonM) / missions)} | ${(missions / days).toFixed(2)} | ${f1((100 * noFull) / days)} | ${at30.length} | ${median(money)} (${quantile(money, 0.25)}–${quantile(money, 0.75)}) | ${median(at30.map((r) => r.roster))} | ${f1(mean(rs.map((r) => r.lost)))} | ${f1(mean(rs.map((r) => r.projects)))} | ${f1(rs.reduce((a, r) => a + r.scientistDays, 0) / days)} | ${Math.round(mean(rs.map((r) => r.spentScience)))} / ${Math.round(mean(rs.map((r) => r.spentSalary)))} | ${median(rs.map((r) => r.score))} |${verify ? ` звірка: розбіжностей ${mismatch}` : ''}`
    );
  }
}

if (out) {
  mkdirSync(dirname(out), { recursive: true });
  const header =
    'variant,preset,seed,won,days,missions,missionsWon,lost,hired,daysNoFullSquad,money30,roster,score,projects,scientistDays,spentScience,spentSalary';
  const lines = all.map((r) =>
    [
      r.variant,
      r.preset,
      r.seed,
      r.won ? 1 : 0,
      r.readyByDay.length,
      r.missions,
      r.missionsWon,
      r.lost,
      r.hired,
      r.readyByDay.filter((n) => n < MISSION_SQUAD_SIZE).length,
      r.moneyByDay[VICTORY_DAY - 1] ?? '',
      r.roster,
      r.score,
      r.projects,
      r.scientistDays,
      r.spentScience,
      r.spentSalary,
    ].join(',')
  );
  writeFileSync(out, [header, ...lines].join('\n'), 'utf8');
}
