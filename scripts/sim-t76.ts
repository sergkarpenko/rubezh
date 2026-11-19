// scripts/sim-t76.ts — probe політики евакуації бота партії (Т.76, П15.5,
// ADR-0075): ті самі партії simulateParty (src/core/party-bot.ts) з різними
// умовами відступу бота в бою (EvacPolicy, src/core/ai-bot.ts). Ядро і правила
// гри не змінюються. Поза CI, як sim-p11.8.ts:
//   npx -y vite-node scripts/sim-t76.ts -- --variants none,w50 --presets норма --seeds 120 --out /tmp/t76/a.csv
//   npx -y vite-node scripts/sim-t76.ts -- --summary /tmp/a.csv,/tmp/b.csv   — markdown-зведення CSV
// Варіант — частини через «+» (політика без науки, DEFAULT_PARTY_POLICY, якщо немає sci):
//   none   — без евакуації (чинний бот, референс);
//   wNN    — солдат із hp ≤ NN % maxHp відступає сам (w50 — половина);
//   lastN  — живих на полі ≤ N → відступають усі;
//   out    — видимих ворогів більше, ніж живих солдатів, → відступають усі;
//   sci    — політика науки (SCIENCE_POLICY) замість політики без науки.
// «Порожня перемога» (методика П11.8): партія дожила до 30-ї доби, але виграла
// менше EMPTY_WON місій — вона не воювала, а відсиджувалась.
// Детермінізм (ADR-0003): сіди 1..N.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DEFAULT_PARTY_POLICY, MISSION_SQUAD_SIZE, SCIENCE_POLICY, simulateParty, type PartyBotPolicy } from '../src/core/party-bot';
import type { EvacPolicy } from '../src/core/ai-bot';
import type { DifficultyPreset } from '../src/core/campaign';

export const EMPTY_WON = 10;

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

export function variantPolicy(variant: string): PartyBotPolicy {
  const parts = variant.split('+');
  const base = parts.includes('sci') ? SCIENCE_POLICY : DEFAULT_PARTY_POLICY;
  const evac: EvacPolicy = {};
  for (const p of parts) {
    if (p === 'none' || p === 'sci') continue;
    if (/^w\d+$/.test(p)) evac.woundedAtOrBelow = Number(p.slice(1)) / 100;
    else if (/^last\d+$/.test(p)) evac.lastStanding = Number(p.slice(4));
    else if (p === 'out') evac.outnumbered = true;
    else throw new Error('Невідома частина варіанта: ' + p);
  }
  return Object.keys(evac).length ? { ...base, name: variant, evac } : { ...base, name: variant };
}

const COLS = [
  'variant',
  'preset',
  'seed',
  'outcome',
  'endDay',
  'launched',
  'won',
  'lost',
  'evacMissions',
  'evacSoldiers',
  'soldiersLost',
  'wounded',
  'hired',
  'money30',
  'veterans',
  'score',
  'daysShort',
] as const;

function run(): void {
  const variants = (arg('--variants') ?? 'none').split(',');
  const presets = (arg('--presets') ?? 'легкий,норма,складний').split(',') as DifficultyPreset[];
  const seeds = Number(arg('--seeds') ?? 120);
  const out = arg('--out') ?? '/tmp/t76.csv';
  const rows: string[] = [COLS.join(',')];
  for (const v of variants) {
    const policy = variantPolicy(v);
    for (const preset of presets) {
      for (let seed = 1; seed <= seeds; seed++) {
        const r = simulateParty(seed, preset, { policy });
        rows.push(
          [
            v,
            preset,
            seed,
            r.outcome,
            r.endDay,
            r.missionsLaunched,
            r.missionsWon,
            r.missionsLost,
            r.missionsEvacuated,
            r.soldiersEvacuated,
            r.soldiersLost,
            r.soldiersWounded,
            r.hiredTotal,
            r.score.moneyLeft,
            r.score.veteransAlive,
            r.score.total,
            r.readyByDay.filter((n) => n < MISSION_SQUAD_SIZE).length,
          ].join(',')
        );
      }
      console.log(`${v} / ${preset}: ${seeds} партій`);
    }
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, rows.join('\n') + '\n');
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0;
};
const f1 = (x: number) => x.toFixed(1).replace('.', ',');

function summary(files: string[]): void {
  type Row = Record<(typeof COLS)[number], string>;
  const all: Row[] = [];
  for (const f of files) {
    const [head, ...lines] = readFileSync(f, 'utf8').trim().split('\n');
    const h = head.split(',');
    for (const l of lines) {
      const c = l.split(',');
      all.push(Object.fromEntries(h.map((k, i) => [k, c[i]])) as Row);
    }
  }
  const keys = [...new Set(all.map((r) => r.preset + '|' + r.variant))];
  const base = new Map(all.filter((r) => r.variant === 'none').map((r) => [r.preset + '|' + r.seed, r]));
  console.log(
    '| Пресет | Варіант | Партій | Перемог | Банкрутств | «Порожніх» перемог | Місій запущено | Виграно | Програно | Евакуйовано місій | Евакуйовано солдатів | Загиблих | Гроші 30, медіана | Ветеранів, медіана | Рахунок, медіана | Рахунок − none, середнє | Діб без загону, % |'
  );
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const k of keys) {
    const rs = all.filter((r) => r.preset + '|' + r.variant === k);
    const n = (c: (typeof COLS)[number]) => rs.map((r) => Number(r[c]));
    const wins = rs.filter((r) => r.outcome === 'перемога');
    const empty = wins.filter((r) => Number(r.won) < EMPTY_WON).length;
    const dScore = rs.map((r) => {
      const b = base.get(r.preset + '|' + r.seed);
      return b ? Number(r.score) - Number(b.score) : NaN;
    });
    const dOk = dScore.filter((x) => !Number.isNaN(x));
    const days = mean(n('endDay'));
    console.log(
      `| ${rs[0].preset} | ${rs[0].variant} | ${rs.length} | ${wins.length} | ${rs.filter((r) => r.outcome === 'банкрутство').length} | ${empty} | ${f1(mean(n('launched')))} | ${f1(mean(n('won')))} | ${f1(mean(n('lost')))} | ${f1(mean(n('evacMissions')))} | ${f1(mean(n('evacSoldiers')))} | ${f1(mean(n('soldiersLost')))} | ${median(n('money30'))} | ${median(n('veterans'))} | ${median(n('score'))} | ${dOk.length ? f1(mean(dOk)) : '—'} | ${f1((100 * mean(n('daysShort'))) / Math.max(1, days))} |`
    );
  }
}

const sumArg = arg('--summary');
if (sumArg) summary(sumArg.split(','));
else run();
