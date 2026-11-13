// scripts/trace-party.ts — трасування партій бот-гравця (Т.20): чому партія
// закінчується банкрутством. Повторює цикл simulateParty (src/core/party-bot.ts)
// тими самими кроками бота і пише, з якими грошима і яким загоном запущено
// кожну місію та в якому стані настало банкрутство. Ядро не змінюється;
// `--verify` звіряє кожну партію із simulateParty (результат, тіки, число місій).
// Поза CI, як sim-p11.8.ts:
//   npx -y vite-node scripts/trace-party.ts -- --policy science --seeds 480
//   … --variant guard+repairfix    — варіанти політики бота (константи гри ті самі)
//   … --no-bankrupt                — грати далі після банкрутства (контрфакт)
//   … --out dist/trace.json        — записи партій у файл
// Варіанти: nomissions — місії не запускаються; guard — останній боєготовий
// загін іде в бій лише з грошима на найм; repairfix — без боєготових ремонт
// перехоплювача не оплачується. З Т.22 (ADR-0089) guard і repairfix — поведінка
// самого бота: ці два варіанти дають той самий результат, що й base.
// Probe констант гри — у копії репозиторію (патерн П10.4). Детермінізм
// (ADR-0003): сіди 1..N. Зведення для звіту — docs/reports/t20-bankruptcies.md.

import { writeFileSync } from 'node:fs';
import { advanceTime, geoDay } from '../src/core/geo';
import { economyTick, hirePrice } from '../src/core/economy';
import { hospitalTick, isBankrupt, readySoldiers } from '../src/core/squad';
import { FIGHTER_MAX_HP, interceptTick, repairTick } from '../src/core/intercept';
import { VICTORY_DAY, campaignTick, type DifficultyPreset } from '../src/core/campaign';
import { createParty } from '../src/core/save';
import { researchTick } from '../src/core/research';
import { workshopTick } from '../src/core/workshop';
import {
  DEFAULT_PARTY_POLICY,
  SCIENCE_POLICY,
  TICKS_PER_DAY,
  partyBotHireStep,
  partyBotInterceptStep,
  partyBotMissionStep,
  partyBotScienceStep,
  simulateParty,
} from '../src/core/party-bot';

function arg(flag: string, def: string): string {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const policyName = arg('--policy', 'science');
const preset = arg('--preset', 'норма') as DifficultyPreset;
const seedCount = Math.max(1, Number(arg('--seeds', '120')) || 120);
const variant = arg('--variant', 'base');
const out = arg('--out', '');
const verify = process.argv.includes('--verify');
const noBankrupt = process.argv.includes('--no-bankrupt');
const flags = new Set(variant.split('+'));
const policy = policyName === 'science' ? SCIENCE_POLICY : DEFAULT_PARTY_POLICY;

interface MissionRec {
  tick: number;
  moneyBefore: number;
  readyBefore: number;
  won: boolean;
  lost: number;
  readyAfter: number;
  moneyAfter: number;
}
interface Bust {
  tick: number;
  day: number;
  money: number;
  alive: number;
  afterRepair: boolean; // боєготових не було, гроші на найм були — їх забрав ремонт
  spent48: { hire: number; science: number; salary: number; repair: number }; // витрати за останню добу
  recoverTicks?: number; // --no-bankrupt: через скільки тіків умова банкрутства зникла
  wonAfter: number; // --no-bankrupt: виграно місій після банкрутства
}
interface Rec {
  seed: number;
  won: boolean;
  missions: MissionRec[]; // до банкрутства включно
  moneyByDay: number[];
  aliveByDay: number[];
  endMoney: number;
  bust?: Bust;
}

function run(seed: number): Rec {
  const party = createParty(seed, preset);
  const rec: Rec = { seed, won: false, missions: [], moneyByDay: [], aliveByDay: [], endMoney: 0 };
  const spent: Bust['spent48'][] = [];
  const hire = hirePrice(preset);
  let lastDay = geoDay(party.geo);
  let prevReady = readySoldiers(party.roster).length;
  for (let t = 0; t < VICTORY_DAY * TICKS_PER_DAY; t++) {
    const f = party.intercept.fighter;
    const wouldRepair = f.status === 'на базі' && f.hp < FIGHTER_MAX_HP && !f.repairTicksLeft;
    const m0 = party.econ.money;
    if (!(flags.has('repairfix') && wouldRepair && prevReady === 0)) partyBotInterceptStep(party, policy.intercept);
    const m1 = party.econ.money;
    interceptTick(party.intercept, party.geo);
    repairTick(party.intercept, party.geo);
    advanceTime(party.geo, 1);
    economyTick(party.econ, party.geo, preset);
    const m2 = party.econ.money;
    researchTick(party.research, party.econ, party.geo, preset);
    const m3 = party.econ.money;
    workshopTick(party.workshop);
    hospitalTick(party.roster);
    partyBotHireStep(party, policy);
    const m4 = party.econ.money;
    partyBotScienceStep(party, policy);
    const m5 = party.econ.money;
    spent.push({ repair: Math.max(0, m0 - m1), salary: m2 - m3, hire: m3 - m4, science: m4 - m5 });
    const readyBefore = readySoldiers(party.roster).length;
    const skip = flags.has('nomissions') || (flags.has('guard') && readyBefore === 3 && m5 < hire);
    const ms = skip ? { launched: false, outcome: null, lost: 0 } : partyBotMissionStep(party, policy);
    const ready = readySoldiers(party.roster).length;
    if (ms.launched) {
      const m: MissionRec = {
        tick: t,
        moneyBefore: m5,
        readyBefore,
        won: ms.outcome === 'перемога',
        lost: ms.lost,
        readyAfter: ready,
        moneyAfter: party.econ.money,
      };
      if (!rec.bust) rec.missions.push(m);
      else if (m.won) rec.bust.wonAfter += 1;
    }
    const day = geoDay(party.geo);
    if (day !== lastDay && !rec.bust) {
      rec.moneyByDay.push(party.econ.money);
      rec.aliveByDay.push(party.roster.soldiers.length);
    }
    lastDay = day;
    const bankrupt = isBankrupt(party.econ, party.roster, preset);
    if (bankrupt && !rec.bust) {
      const spent48 = { hire: 0, science: 0, salary: 0, repair: 0 };
      for (const s of spent.slice(-TICKS_PER_DAY)) for (const k of Object.keys(s) as (keyof typeof s)[]) spent48[k] += s[k];
      rec.bust = {
        tick: t,
        day,
        money: party.econ.money,
        alive: party.roster.soldiers.length,
        afterRepair: !ms.launched,
        spent48,
        wonAfter: 0,
      };
      if (!noBankrupt) break;
    } else if (!bankrupt && rec.bust && rec.bust.recoverTicks === undefined) {
      rec.bust.recoverTicks = t - rec.bust.tick;
    }
    prevReady = ready;
    campaignTick({ geo: party.geo, roster: party.roster, econ: party.econ }, party.campaign);
    if (party.campaign.status === 'перемога') {
      rec.won = !rec.bust;
      break;
    }
  }
  rec.endMoney = party.econ.money;
  return rec;
}

const recs: Rec[] = [];
let mismatch = 0;
for (let seed = 1; seed <= seedCount; seed++) {
  const r = run(seed);
  recs.push(r);
  if (!verify) continue;
  const ref = simulateParty(seed, preset, { policy });
  const ticks = r.bust ? r.bust.tick + 1 : VICTORY_DAY * TICKS_PER_DAY;
  if ((ref.outcome === 'перемога') !== r.won || ref.ticks !== ticks || ref.missionsLaunched !== r.missions.length) {
    mismatch += 1;
    console.log(`розбіжність із simulateParty: сід ${seed}`);
  }
}

const median = (a: number[]): number => (a.length ? [...a].sort((x, y) => x - y)[a.length >> 1] : NaN);
const pct = (n: number, d: number): string => (d ? ((100 * n) / d).toFixed(1) : '—');
const busts = recs.flatMap((r) => (r.bust ? [r.bust] : []));
const missions = recs.flatMap((r) => r.missions);
const lastSquad = missions.filter((m) => m.readyBefore === 3);
const fatal = missions.filter((m) => !m.won && m.readyAfter === 0 && m.moneyAfter < hirePrice(preset));
const days = recs.reduce((a, r) => a + (r.bust ? r.bust.tick / TICKS_PER_DAY : VICTORY_DAY), 0);
const wins = recs.filter((r) => r.won);

console.log(`# ${policyName} / ${preset} / ${variant}${noBankrupt ? ' / гра після банкрутства' : ''}, сідів ${recs.length}`);
if (verify) console.log(`звірка із simulateParty: розбіжностей ${mismatch}`);
console.log(`виграних партій: ${wins.length} (${pct(wins.length, recs.length)} %); банкрутств: ${busts.length}`);
console.log(`місій на партію: ${(missions.length / recs.length).toFixed(1)}; на прожиту добу: ${(missions.length / days).toFixed(2)}`);
console.log(
  `програно місій: ${pct(missions.filter((m) => !m.won).length, missions.length)} %; із них загинув увесь загін: ${pct(missions.filter((m) => !m.won && m.lost === 3).length, missions.filter((m) => !m.won).length)} %`
);
console.log(
  `місій останнім боєготовим загоном: ${pct(lastSquad.length, missions.length)} %; із них із грошима менше ціни найму: ${pct(lastSquad.filter((m) => m.moneyBefore < hirePrice(preset)).length, lastSquad.length)} %`
);
console.log(
  `фатальних місій на 100 запущених: ${pct(fatal.length, missions.length)}; медіана грошей перед місією: ${median(missions.map((m) => m.moneyBefore))}`
);
console.log(
  `виграно місій на партію: ${(missions.filter((m) => m.won).length / recs.length).toFixed(1)}; гроші переможців на 30-ту добу, медіана: ${median(wins.map((r) => r.endMoney))}`
);
if (busts.length) {
  const s = (k: keyof Bust['spent48']): string => (busts.reduce((a, b) => a + b.spent48[k], 0) / busts.length).toFixed(0);
  console.log(
    `банкрутства: після програної місії ${busts.filter((b) => !b.afterRepair).length}, після оплати ремонту ${busts.filter((b) => b.afterRepair).length}`
  );
  console.log(
    `  гроші в мить банкрутства: ${Math.min(...busts.map((b) => b.money))}–${Math.max(...busts.map((b) => b.money))}, медіана ${median(busts.map((b) => b.money))}; живих у ростері 0: ${busts.filter((b) => b.alive === 0).length}`
  );
  console.log(
    `  доба: медіана ${median(busts.map((b) => b.day))}; витрати за останню добу, середнє: найм ${s('hire')}, наука і цех ${s('science')}, зарплата ${s('salary')}, ремонт ${s('repair')}`
  );
  if (noBankrupt) {
    const rec48 = busts.filter((b) => b.recoverTicks !== undefined && b.recoverTicks <= TICKS_PER_DAY).length;
    console.log(
      `  гра далі: умова банкрутства зникла за добу — ${rec48}; виграно ще хоч одну місію — ${busts.filter((b) => b.wonAfter > 0).length}; гроші на 30-ту добу, медіана ${median(recs.filter((r) => r.bust).map((r) => r.endMoney))}`
    );
  }
}
console.log('медіани наприкінці доби серед партій, що дожили: доба — гроші / живих у ростері');
console.log(
  [1, 3, 5, 10, 15, 20, 25, 29]
    .map(
      (d) =>
        `${d} — ${median(recs.filter((r) => r.moneyByDay.length >= d).map((r) => r.moneyByDay[d - 1]))} / ${median(recs.filter((r) => r.aliveByDay.length >= d).map((r) => r.aliveByDay[d - 1]))}`
    )
    .join('; ')
);
if (out) writeFileSync(out, JSON.stringify(recs));
