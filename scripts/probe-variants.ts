// scripts/probe-variants.ts — probe варіантів політики бота кампанії (Т.236, кандидати процесу 124, 179 і 224 е):
// той самий цикл simulateParty для кількох латок CAMPAIGN_POLICY на тих самих сідах — зведення за пресетом.
// Заміняє тимчасові `proto/probe-t*.ts` кінця фаз (Т.230–Т.235; тека `proto/` у новий чат не доживає).
// Поза CI, як sim-p8.5.ts і probe-t23.ts; ядро не змінюється:
//   node scripts/run-ts.mjs scripts/probe-variants.ts -- --seeds 120 --presets норма,складний
//   … -- --variant 'nobrew={"brew":[],"modules":{}}' --variant 'nonet={"projects":["armor","rift-anatomy","gate-bearing","gate-key"]}'
//   … -- --self-test — перевірка розбору аргументів і зведення без партій
// Варіант — `<ім'я>=<JSON>`: поля JSON замінюють поля CAMPAIGN_POLICY цілком (масив — увесь масив); `base` — сама
// політика, іде завжди першим (контроль: на тому самому коді його рядок дорівнює `sim-p8.5.ts --policy campaign`).
// Дерево `main` — той самий скрипт у `git worktree` з посиланням на `node_modules` (sim.md, «Порядок кроку»);
// варіант числа правила ядра — копія репозиторію з правкою константи (латка політики правил не міняє).
// Детерміновано (ADR-0003): сіди 1..N. Вивід — markdown-таблиця в stdout, CSV партій — `--out <файл>`.
import { writeFileSync } from 'node:fs';
import type { DifficultyPreset } from '../src/core/campaign';
import { CAMPAIGN_POLICY, simulateParty, type PartyBotPolicy, type PartySimResult } from '../src/core/party-bot';

export interface Variant {
  name: string;
  policy: PartyBotPolicy;
}

export interface Summary {
  variant: string;
  preset: DifficultyPreset;
  parties: number;
  winPct: number; // частка перемог, %
  medianWinDay: number | null; // медіана доби перемоги (лише перемоги)
  lostMean: number; // загиблих за партію в середньому
  bankrupt: number;
  defeats: number;
}

const PRESETS: readonly DifficultyPreset[] = ['легкий', 'норма', 'складний'];

/** `<ім'я>=<JSON>` → варіант; ім'я — латиниця, цифри, `-` і `_`; JSON — об'єкт з полями PartyBotPolicy. */
export function parseVariant(spec: string, base: PartyBotPolicy = CAMPAIGN_POLICY): Variant {
  const i = spec.indexOf('=');
  const name = i < 0 ? spec : spec.slice(0, i);
  if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error(`варіант «${spec}»: ім'я — латиниця, цифри, «-», «_»`);
  if (i < 0) throw new Error(`варіант «${spec}»: потрібно <ім'я>=<JSON>`);
  const patch: unknown = JSON.parse(spec.slice(i + 1));
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) throw new Error(`варіант «${name}»: JSON — об'єкт`);
  // необов'язкові поля PartyBotPolicy, яких немає в CAMPAIGN_POLICY, теж законні — лише попередження (друкарська помилка)
  const extra = Object.keys(patch).filter((k) => !(k in base));
  if (extra.length) console.error(`probe-variants: варіант «${name}» — полів ${extra.join(', ')} у CAMPAIGN_POLICY немає`);
  return { name, policy: { ...base, ...(patch as Partial<PartyBotPolicy>), name } };
}

export function median(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

type Row = Pick<PartySimResult, 'outcome' | 'endDay' | 'soldiersLost'>;

export function summarize(variant: string, preset: DifficultyPreset, rows: readonly Row[]): Summary {
  const wins = rows.filter((r) => r.outcome === 'перемога');
  const n = rows.length;
  return {
    variant,
    preset,
    parties: n,
    winPct: n ? (100 * wins.length) / n : 0,
    medianWinDay: median(wins.map((r) => r.endDay)),
    lostMean: n ? rows.reduce((a, r) => a + r.soldiersLost, 0) / n : 0,
    bankrupt: rows.filter((r) => r.outcome === 'банкрутство').length,
    defeats: rows.filter((r) => r.outcome === 'поразка').length,
  };
}

const f1 = (x: number): string => x.toFixed(1).replace('.', ',');

export function table(rows: readonly Summary[]): string {
  const head = '| Варіант | Пресет | Партій | Перемог, % | Медіана доби перемоги | Загиблих (сер.) | Банкрутств | Поразок |';
  const sep = '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |';
  const body = rows.map(
    (s) =>
      `| ${s.variant} | ${s.preset} | ${s.parties} | ${f1(s.winPct)} | ${s.medianWinDay === null ? '—' : f1(s.medianWinDay)} | ${f1(s.lostMean)} | ${s.bankrupt} | ${s.defeats} |`
  );
  return [head, sep, ...body].join('\n');
}

function selfTest(): number {
  let bad = 0;
  const check = (name: string, ok: boolean): void => {
    console.log(`${ok ? 'ok ' : 'FAIL'} ${name}`);
    if (!ok) bad++;
  };
  const v = parseVariant('nobrew={"brew":[],"modules":{}}');
  check(
    "латка: поля замінено, решта — з CAMPAIGN_POLICY, ім'я — з варіанта",
    v.name === 'nobrew' && v.policy.brew?.length === 0 && v.policy.projects === CAMPAIGN_POLICY.projects && v.policy.name === 'nobrew'
  );
  const throws = (s: string): boolean => {
    try {
      parseVariant(s);
      return false;
    } catch {
      return true;
    }
  };
  check("помилки: без «=», ім'я кирилицею, масив, не JSON", ['abc', 'варіант={}', 'a=[1]', 'a={brew}'].every(throws));
  check('медіана: непарна, парна, порожня', median([5, 1, 3]) === 3 && median([4, 1, 3, 2]) === 2.5 && median([]) === null);
  const s = summarize('base', 'норма', [
    { outcome: 'перемога', endDay: 30, soldiersLost: 8 },
    { outcome: 'перемога', endDay: 34, soldiersLost: 10 },
    { outcome: 'поразка', endDay: 64, soldiersLost: 20 },
    { outcome: 'банкрутство', endDay: 12, soldiersLost: 6 },
  ]);
  check(
    'зведення: 50 % перемог, медіана 32 лише за перемогами, 11 загиблих, 1 банкрутство, 1 поразка',
    s.winPct === 50 && s.medianWinDay === 32 && s.lostMean === 11 && s.bankrupt === 1 && s.defeats === 1
  );
  check(
    'таблиця: кома в числах, «—» без перемог',
    table([s, summarize('x', 'складний', [])]).includes('| base | норма | 4 | 50,0 | 32,0 | 11,0 | 1 | 1 |') &&
      table([summarize('x', 'складний', [])]).includes('| — |')
  );
  console.log(`probe-variants self-test: помилок ${bad}`);
  return bad;
}

function main(): void {
  const i0 = process.argv.indexOf('--');
  const args = i0 < 0 ? [] : process.argv.slice(i0 + 1);
  if (args.includes('--self-test')) process.exit(selfTest() ? 1 : 0);
  const value = (name: string, d: string): string => {
    const i = args.indexOf('--' + name);
    return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d;
  };
  const seeds = Number(value('seeds', '120'));
  if (!Number.isInteger(seeds) || seeds < 1) throw new Error('--seeds — ціле ≥ 1');
  const presets = value('presets', PRESETS.join(',')).split(',') as DifficultyPreset[];
  for (const p of presets) if (!PRESETS.includes(p)) throw new Error(`невідомий пресет «${p}»`);
  const variants: Variant[] = [{ name: 'base', policy: CAMPAIGN_POLICY }];
  args.forEach((a, i) => {
    if (a === '--variant') variants.push(parseVariant(args[i + 1] ?? ''));
  });
  const out = value('out', '');
  const csv: string[] = ['variant,preset,seed,outcome,endDay,soldiersLost,missionsWon'];
  const sums: Summary[] = [];
  for (const v of variants)
    for (const preset of presets) {
      const rows: PartySimResult[] = [];
      for (let seed = 1; seed <= seeds; seed++) {
        const r = simulateParty(seed, preset, { policy: v.policy });
        rows.push(r);
        csv.push([v.name, preset, seed, r.outcome, r.endDay, r.soldiersLost, r.missionsWon].join(','));
      }
      sums.push(summarize(v.name, preset, rows));
      console.error(`probe-variants: ${v.name} / ${preset} — ${seeds} партій`);
    }
  console.log(table(sums));
  if (out) writeFileSync(out, csv.join('\n') + '\n');
}

main();
