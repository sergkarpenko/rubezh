// scripts/sim-p8.5.ts — масові симуляції П8.5/П10.4: 120 сідів × 3 пресети.
// Не входить у CI/юніт-тести (важкі симуляції — поза CI): запуск локально,
//   npx vite-node scripts/sim-p8.5.ts                          — 120 сідів × 3 пресети
//   npx vite-node scripts/sim-p8.5.ts --seeds 5               — короткий прогін
//   npx vite-node scripts/sim-p8.5.ts --presets складний       — лише один пресет
// П10.4: третій пресет «складний» + прапорець --presets (probe-прогони кандидатів
// у копії репозиторія до зміни коду — патерн П8.6). vite-node уже в дереві
// залежностей vitest — нових залежностей немає (ADR-0012 не зачіпається).
// Детермінізм (ADR-0003): фіксовані сіди 1..N, жодного впливу оточення;
// результати байт-у-байт відтворювані.
// Вивід: markdown-таблиці (агрегати по пресетах) у stdout — для звітів
// docs/reports/p8.5-simulations.md та p10.4-tuning.md; CSV — у dist/p8.5-parties.csv.

import { mkdirSync, writeFileSync } from 'node:fs';
import { simulateParty, type PartySimResult } from '../src/core/party-bot';
import type { DifficultyPreset } from '../src/core/campaign';

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

const seedCount = parseSeedCount();
const PRESETS = parsePresets();
const seeds = Array.from({ length: seedCount }, (_, i) => i + 1);
const byPreset = new Map<DifficultyPreset, PartySimResult[]>();
const started = Date.now();

for (const preset of PRESETS) {
  const results: PartySimResult[] = [];
  for (const seed of seeds) {
    results.push(simulateParty(seed, preset));
  }
  byPreset.set(preset, results);
}

console.log(`# П8.5 — масові симуляції: ${seedCount} сідів × ${PRESETS.length} пресети (${round1((Date.now() - started) / 1000)} с)\n`);

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
  console.log(`| Партій до 30 діб (перемога) | ${wins.length} (${round1((100 * wins.length) / rs.length)}%) |`);
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
  console.log(`| Найнято солдатів | ${mean((r) => r.hiredTotal)} / партію (витрати ${mean((r) => r.hireSpent)}) |`);
  console.log(`| Перехоплень | ${mean((r) => r.launches)} / партію; збитих НЛО ${mean((r) => r.shotDown)} |`);
  console.log(
    `| Ремонтів винищувача | ${mean((r) => r.repairs)} / партію (витрати ${mean((r) => r.repairSpent)}); HP=0 без грошей ${mean((r) => r.repairsWhenPoor)} |`
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
const lines = ['preset,seed,outcome,endDay,score,missionsLaunched,missionsWon,soldiersLost,soldiersWounded,repairs,hiredTotal'];
for (const preset of PRESETS) {
  for (const r of byPreset.get(preset)!) {
    lines.push(
      `${preset},${r.seed},${r.outcome},${r.endDay},${r.score.total},${r.missionsLaunched},${r.missionsWon},${r.soldiersLost},${r.soldiersWounded},${r.repairs},${r.hiredTotal}`
    );
  }
}
writeFileSync('dist/p8.5-parties.csv', lines.join('\n'), 'utf8');
console.log(`CSV партій: dist/p8.5-parties.csv (${lines.length - 1} партій)`);
