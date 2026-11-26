// scripts/sim-p8.5.ts — масові симуляції П8.5/П10.4: 120 сідів × 3 пресети.
// Не входить у CI/юніт-тести (важкі симуляції — поза CI): запуск локально,
//   node scripts/run-ts.mjs scripts/sim-p8.5.ts                          — 120 сідів × 3 пресети
//   node scripts/run-ts.mjs scripts/sim-p8.5.ts --seeds 5               — короткий прогін
//   node scripts/run-ts.mjs scripts/sim-p8.5.ts --presets складний       — лише один пресет
//   node scripts/run-ts.mjs scripts/sim-p8.5.ts --policy campaign        — політика кампанії п18.6
//   … --policy campaign --interceptors 1                                  — п19.6: перехоплювачів політики (1 — без купівлі)
// П10.4: третій пресет «складний» + прапорець --presets (probe-прогони кандидатів
// у копії репозиторія до зміни коду — патерн П8.6). Запуск — scripts/run-ts.mjs
// на vite з devDependencies (Т.103), нових залежностей немає.
// Детермінізм (ADR-0003): фіксовані сіди 1..N, жодного впливу оточення;
// результати байт-у-байт відтворювані.
// Вивід: markdown-таблиці (агрегати по пресетах) у stdout — для звітів
// docs/reports/p8.5-simulations.md та p10.4-tuning.md; CSV — у dist/p8.5-parties.csv.

import { mkdirSync, writeFileSync } from 'node:fs';
import {
  CAMPAIGN_POLICY,
  DEFAULT_PARTY_POLICY,
  SCIENCE_POLICY,
  simulateParty,
  type PartyBotPolicy,
  type PartySimResult,
} from '../src/core/party-bot';
import type { DifficultyPreset } from '../src/core/campaign';
import type { Party } from '../src/core/save';
import { REGION_IDS, REGION_NAMES, trustDelta, type RegionId } from '../src/core/regions';

const ALL_PRESETS: DifficultyPreset[] = ['легкий', 'норма', 'складний'];

function parsePresets(): DifficultyPreset[] {
  const i = process.argv.indexOf('--presets');
  if (i === -1 || !process.argv[i + 1]) return ALL_PRESETS;
  const asked = process.argv[i + 1].split(',').map((s) => s.trim());
  const found = ALL_PRESETS.filter((p) => asked.includes(p));
  return found.length ? found : ALL_PRESETS;
}

function parseSeedCount(): number {
  const i = process.argv.indexOf('--seeds');
  if (i !== -1 && process.argv[i + 1]) return Math.max(1, Number(process.argv[i + 1]) || 120);
  return 120;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

function curveMean(results: PartySimResult[], day: number): number {
  const xs = results.map((r) => r.moneyByDay[day - 1]).filter((x) => x !== undefined);
  return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0;
}

function readyCurveMean(results: PartySimResult[], day: number): number {
  const xs = results.map((r) => r.readyByDay[day - 1]).filter((x) => x !== undefined);
  return xs.length ? round1(xs.reduce((a, b) => a + b, 0) / xs.length) : 0;
}

// п18.6 (ADR-0158): політика бота — default (типово, як до п18.6), science, campaign.
const POLICIES: Record<string, PartyBotPolicy> = { default: DEFAULT_PARTY_POLICY, science: SCIENCE_POLICY, campaign: CAMPAIGN_POLICY };
function parsePolicy(): PartyBotPolicy {
  const i = process.argv.indexOf('--policy');
  if (i === -1 || !process.argv[i + 1]) return DEFAULT_PARTY_POLICY;
  const p = POLICIES[process.argv[i + 1]];
  if (!p) throw new Error('Невідома політика: ' + process.argv[i + 1] + ' (є: ' + Object.keys(POLICIES).join(', ') + ')');
  return p;
}

// п19.6 (ADR-0159 п. 17): --interceptors N — interceptorsUpTo політики (виміри варіантів купівлі).
function withInterceptors(p: PartyBotPolicy): PartyBotPolicy {
  const i = process.argv.indexOf('--interceptors');
  if (i === -1 || !process.argv[i + 1]) return p;
  const n = Number(process.argv[i + 1]);
  if (!Number.isInteger(n) || n < 0 || n > 3) throw new Error('--interceptors: ціле 0..3');
  return { ...p, name: p.name + '-i' + n, interceptorsUpTo: n };
}

// п19.6: геосцена партії — з останнього стану (спостерігач onTick лише читає).
interface GeoStats {
  regionsOut: number; // регіонів, що вийшли, наприкінці партії
  allowanceMean: number; // середня дотація доби
  leftDetected: Record<RegionId, number>; // відльоти без бою за регіоном
  leftUndetected: Record<RegionId, number>;
  bought: number; // куплено перехоплювачів
  firstBuyDay: number | null; // доба першої купівлі
  launchesOther: number; // погонь перехоплювачами з «Кузні» (id ≥ 2)
}

function geoStats(p: Readonly<Party>, firstBuyDay: number | null): GeoStats {
  const zero = (): Record<RegionId, number> => ({ west: 0, north: 0, east: 0, south: 0 });
  const st: GeoStats = {
    regionsOut: REGION_IDS.filter((id) => p.campaign.regions[id].out).length,
    allowanceMean: 0,
    leftDetected: zero(),
    leftUndetected: zero(),
    bought: p.workshop.log.filter((e) => e.type === 'interceptor_order').length,
    firstBuyDay,
    launchesOther: p.intercept.log.filter((e) => e.type === 'intercept_start' && (e.fighter ?? 1) >= 2).length,
  };
  const allow = p.econ.log.filter((e) => e.type === 'allowance').map((e) => (e as { amount: number }).amount);
  st.allowanceMean = allow.length ? allow.reduce((a, b) => a + b, 0) / allow.length : 0;
  const log = p.geo.log;
  for (let i = 0; i < log.length; i++) {
    const ch = log[i].type === 'ufo_left' ? trustDelta(log, i) : null;
    if (!ch) continue;
    if (ch.delta <= -30) st.leftDetected[ch.region] += 1;
    else st.leftUndetected[ch.region] += 1;
  }
  return st;
}

const seedCount = parseSeedCount();
const POLICY = withInterceptors(parsePolicy());
const PRESETS = parsePresets();
const seeds = Array.from({ length: seedCount }, (_, i) => i + 1);
const byPreset = new Map<DifficultyPreset, PartySimResult[]>();
const geoBy = new Map<DifficultyPreset, GeoStats[]>();
const started = Date.now();

for (const preset of PRESETS) {
  const results: PartySimResult[] = [];
  const geos: GeoStats[] = [];
  for (const seed of seeds) {
    let last: Readonly<Party> | null = null;
    let buyDay: number | null = null;
    const onTick = (p: Readonly<Party>) => {
      last = p;
      if (buyDay === null && p.workshop.queue.some((o) => o.id === 'interceptor')) buyDay = Math.floor(p.geo.minute / 1440) + 1;
    };
    results.push(simulateParty(seed, preset, { policy: POLICY, onTick }));
    geos.push(geoStats(last!, buyDay));
  }
  byPreset.set(preset, results);
  geoBy.set(preset, geos);
}

console.log(
  `# П8.5 — масові симуляції: ${seedCount} сідів × ${PRESETS.length} пресети, політика ${POLICY.name} (${round1((Date.now() - started) / 1000)} с)\n`
);

for (const preset of PRESETS) {
  const rs = byPreset.get(preset)!;
  const wins = rs.filter((r) => r.outcome === 'перемога');
  const bankrupts = rs.filter((r) => r.outcome === 'банкрутство');
  const sum = (f: (r: PartySimResult) => number) => rs.reduce((a, r) => a + f(r), 0);
  const scores = rs.map((r) => r.score.total);
  const mean = (f: (r: PartySimResult) => number) => round1(sum(f) / rs.length);
  console.log(`## Пресет «${preset}» (${rs.length} партій)\n`);
  console.log(`| Метрика | Значення |`);
  console.log(`| --- | --- |`);
  // п18.6: доба перемоги — медіана і p10–p90 (межі власника ADR-0153 п. 4: 35–50)
  const wd = wins.map((r) => r.endDay).sort((a, b) => a - b);
  const pq = (p: number) => wd[Math.min(wd.length - 1, Math.floor(p * wd.length))];
  console.log(
    `| Перемог | ${wins.length} (${round1((100 * wins.length) / rs.length)}%)${wins.length ? `, доба — медіана ${median(wd)}, p10–p90 ${pq(0.1)}–${pq(0.9)}` : ''} |`
  );
  // п18.3 (ADR-0155): поразка за загрозою — медіана доби
  const defeats = rs.filter((r) => r.outcome === 'поразка');
  console.log(
    `| Поразок за загрозою | ${defeats.length} (${round1((100 * defeats.length) / rs.length)}%)${defeats.length ? `, медіана доби ${median(defeats.map((r) => r.endDay))}` : ''} |`
  );
  console.log(
    `| Банкрутств | ${bankrupts.length} (${round1((100 * bankrupts.length) / rs.length)}%)${bankrupts.length ? `, медіана дня ${median(bankrupts.map((r) => r.endDay))}` : ''} |`
  );
  console.log(
    `| Середній фінальний рахунок | ${mean((r) => r.score.total)} (медіана ${median(scores)}, мін ${Math.min(...scores)}, макс ${Math.max(...scores)}) |`
  );
  console.log(
    `| Місій запущено | ${mean((r) => r.missionsLaunched)} / партію; перемог ${mean((r) => r.missionsWon)}, поразок ${mean((r) => r.missionsLost)} |`
  );
  console.log(
    `| Поранень (госпіталізацій) | ${mean((r) => r.soldiersWounded)} / партію (${round1(
      sum((r) => r.soldiersWounded) /
        Math.max(
          1,
          sum((r) => r.missionsLaunched)
        )
    )} / місію) |`
  );
  console.log(`| Загиблих солдатів | ${mean((r) => r.soldiersLost)} / партію |`);
  console.log(
    `| Штурмів бази | ${mean((r) => r.assaults)} / партію (програно ${mean((r) => r.assaultsLost)}); боїв «Брама Розриву» ${mean((r) => r.gateAttempts)} |`
  );
  console.log(`| Найнято солдатів | ${mean((r) => r.hiredTotal)} / партію (витрати ${mean((r) => r.hireSpent)}) |`);
  console.log(`| Перехоплень | ${mean((r) => r.launches)} / партію; збитих НЛО ${mean((r) => r.shotDown)} |`);
  console.log(
    `| Ремонтів винищувача | ${mean((r) => r.repairs)} / партію (витрати ${mean((r) => r.repairSpent)}); HP=0 без грошей ${mean((r) => r.repairsWhenPoor)} |`
  );
  // п19.6 (ADR-0159 п. 17): регіони і перехоплювачі
  const gs = geoBy.get(preset)!;
  const gmean = (f: (g: GeoStats) => number) => round1(gs.reduce((a, g) => a + f(g), 0) / gs.length);
  const outAny = gs.filter((g) => g.regionsOut > 0).length;
  console.log(
    `| Регіонів вийшло | ${gmean((g) => g.regionsOut)} / партію; партій з виходом ${outAny} (${round1((100 * outAny) / gs.length)}%) |`
  );
  console.log(`| Дотація | ${gmean((g) => g.allowanceMean)} / добу в середньому |`);
  console.log(
    `| Відльотів без бою (виявлених / невиявлених) | ${REGION_IDS.map((id) => `${REGION_NAMES[id]} ${gmean((g) => g.leftDetected[id])} / ${gmean((g) => g.leftUndetected[id])}`).join('; ')} |`
  );
  const buys = gs.filter((g) => g.firstBuyDay !== null).map((g) => g.firstBuyDay!);
  console.log(
    `| Перехоплювачів куплено | ${gmean((g) => g.bought)} / партію${buys.length ? `; перша купівля — медіана доби ${median(buys)}` : ''}; погонь куплених ${gmean((g) => g.launchesOther)} / партію |`
  );
  console.log('');
}

// Крива балансу: середні гроші наприкінці доби (Д1–Д30) по пресетах.
console.log(`## Крива балансу: середні гроші наприкінці доби\n`);
console.log(`| Доба | ${PRESETS.join(' | ')} |`);
console.log(`| --- |${PRESETS.map(() => ' --- |').join('')}`);
const maxDay = Math.max(...PRESETS.flatMap((p) => byPreset.get(p)!.map((r) => r.moneyByDay.length)));
for (let day = 1; day <= Math.min(maxDay, 30); day++) {
  console.log(`| Д${day} |${PRESETS.map((p) => ` ${curveMean(byPreset.get(p)!, day)} |`).join('')}`);
}
console.log('');

// Крива ростера: середні боєготові наприкінці доби.
console.log(`## Крива ростера: середні боєготові наприкінці доби\n`);
console.log(`| Доба | ${PRESETS.join(' | ')} |`);
console.log(`| --- |${PRESETS.map(() => ' --- |').join('')}`);
for (let day = 1; day <= Math.min(maxDay, 30); day++) {
  console.log(`| Д${day} |${PRESETS.map((p) => ` ${readyCurveMean(byPreset.get(p)!, day)} |`).join('')}`);
}
console.log('');

// Розподіл фінального рахунку (для кривої прийнятності балансу).
console.log(`## Розподіл фінального рахунку\n`);
console.log(`| Пресет | мін | p25 | медіана | p75 | макс |`);
console.log(`| --- | --- | --- | --- | --- | --- |`);
for (const preset of PRESETS) {
  const s = byPreset
    .get(preset)!
    .map((r) => r.score.total)
    .sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  console.log(`| ${preset} | ${s[0]} | ${q(0.25)} | ${median(s)} | ${q(0.75)} | ${s[s.length - 1]} |`);
}
console.log('');

// CSV кривих (дні × партії) для додаткового аналізу.
mkdirSync('dist', { recursive: true });
const lines = [
  'preset,seed,outcome,endDay,score,missionsLaunched,missionsWon,soldiersLost,soldiersWounded,repairs,hiredTotal,assaults,assaultsLost,gateAttempts,regionsOut,allowanceMean,interceptorsBought,firstBuyDay',
];
for (const preset of PRESETS) {
  const gs = geoBy.get(preset)!;
  byPreset.get(preset)!.forEach((r, i) => {
    const g = gs[i];
    lines.push(
      `${preset},${r.seed},${r.outcome},${r.endDay},${r.score.total},${r.missionsLaunched},${r.missionsWon},${r.soldiersLost},${r.soldiersWounded},${r.repairs},${r.hiredTotal},${r.assaults},${r.assaultsLost},${r.gateAttempts},${g.regionsOut},${round1(g.allowanceMean)},${g.bought},${g.firstBuyDay ?? ''}`
    );
  });
}
writeFileSync('dist/p8.5-parties.csv', lines.join('\n'), 'utf8');
console.log(`CSV партій: dist/p8.5-parties.csv (${lines.length - 1} партій)`);
