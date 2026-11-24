// scripts/mutants-list.ts — перелік живих мутантів одного файла зі звіту Stryker і звірка «до / після»
// (Т.147, Т.160–Т.161; кандидат процесу 124, Т.163). Поза npm test. Звіт — `dist/mutation/mutation.json`
// прицільного прогону (`npx stryker run --mutate "src/core/<файл>.ts"`, docs/agents/sim.md); перед наступним
// прогоном скопіювати його в /tmp, теку `dist` прибрати до звірки довідників.
//   node scripts/run-ts.mjs scripts/mutants-list.ts list <звіт.json> src/core/<файл>.ts [--all]
//     рядок:колонка, статус, мутатор, функція, заміна — живі (Survived, NoCoverage; з --all — усі)
//   node scripts/run-ts.mjs scripts/mutants-list.ts diff <до.json> <після.json> src/core/<файл>.ts
//     відповідність мутантів — за рядком зі зсувом (вирівнювання рядків сирця двох звітів), колонкою,
//     мутатором і заміною: «убито» (живий до, убитий після), «живий» (лишився), «зник або рядок змінено»
//     (живого до немає серед мутантів після: рядок видалено чи змінено), «ожив» (убитий до, живий після),
//     «новий живий» (живий після без пари до)
import fs from 'node:fs';

interface Mutant {
  mutatorName: string;
  replacement?: string;
  status: string;
  location: { start: { line: number; column: number } };
}
interface FileReport {
  source: string;
  mutants: Mutant[];
}
interface Report {
  files: Record<string, FileReport>;
}

const ALIVE = new Set(['Survived', 'NoCoverage']);
const args = process.argv.slice(process.argv.findIndex((a) => a.endsWith('.ts')) + 1).filter((a) => a !== '--');
const usage = (): never => {
  console.error('Використання: … mutants-list.ts list <звіт.json> <файл> [--all] | diff <до.json> <після.json> <файл>');
  process.exit(2);
};

function fileOf(reportPath: string, file: string): FileReport {
  const r = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as Report;
  const key = Object.keys(r.files).find((k) => k === file || k.endsWith('/' + file));
  if (key === undefined) {
    console.error(`У звіті ${reportPath} немає файла ${file}; є: ${Object.keys(r.files).join(', ')}`);
    process.exit(2);
  }
  return r.files[key];
}

// найближче оголошення функції верхнього рівня вище рядка (function f, const f = (…) => / function); внутрішні
// стрілки (`const seen = …` у тілі функції) пропускаються — потрібна функція модуля, як у записах кроків
function functionAt(lines: string[], line: number): string {
  const re =
    /^(?:export\s+)?(?:async\s+)?(?:function\s*\*?\s*([\w$]+)|(?:const|let)\s+([\w$]+)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\(|function|[\w$]+\s*=>))/;
  for (let i = line - 1; i >= 0; i--) {
    const m = re.exec(lines[i]);
    if (m) return m[1] ?? m[2];
  }
  return '—';
}

const oneLine = (s: string | undefined): string => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > 80 ? t.slice(0, 77) + '…' : t;
};
const pos = (m: Mutant): string => m.location.start.line + ':' + m.location.start.column;
const byPos = (a: Mutant, b: Mutant): number =>
  a.location.start.line - b.location.start.line || a.location.start.column - b.location.start.column;
const row = (m: Mutant, lines: string[]): string =>
  [pos(m), m.status, m.mutatorName, functionAt(lines, m.location.start.line), oneLine(m.replacement)].join('\t');

function summary(f: FileReport): string {
  const n: Record<string, number> = {};
  for (const m of f.mutants) n[m.status] = (n[m.status] ?? 0) + 1;
  const killed = (n.Killed ?? 0) + (n.Timeout ?? 0);
  const valid = killed + (n.Survived ?? 0) + (n.NoCoverage ?? 0);
  const score = valid ? ((killed / valid) * 100).toFixed(2) : '—';
  return `мутантів ${f.mutants.length}: ${Object.entries(n)
    .map(([k, v]) => k + ' ' + v)
    .join(', ')}; рахунок ${score} %`;
}

// номер рядка «до» → номер рядка «після» для рядків, що лишились без змін (найдовша спільна підпослідовність)
function lineMap(a: string[], b: string[]): Map<number, number> {
  const n = a.length;
  const m = b.length;
  const dp = new Int32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i * (m + 1) + j] =
        a[i] === b[j] ? dp[(i + 1) * (m + 1) + j + 1] + 1 : Math.max(dp[(i + 1) * (m + 1) + j], dp[i * (m + 1) + j + 1]);
  const map = new Map<number, number>();
  for (let i = 0, j = 0; i < n && j < m;) {
    if (a[i] === b[j]) map.set(++i, ++j);
    else if (dp[(i + 1) * (m + 1) + j] >= dp[i * (m + 1) + j + 1]) i++;
    else j++;
  }
  return map;
}

const [mode] = args;
if (mode === 'list') {
  const [, report, file] = args;
  if (!report || !file) usage();
  const f = fileOf(report, file);
  const lines = f.source.split('\n');
  const shown = f.mutants.filter((m) => args.includes('--all') || ALIVE.has(m.status)).sort(byPos);
  console.log(summary(f));
  console.log(['рядок', 'статус', 'мутатор', 'функція', 'заміна'].join('\t'));
  for (const m of shown) console.log(row(m, lines));
} else if (mode === 'diff') {
  const [, beforePath, afterPath, file] = args;
  if (!beforePath || !afterPath || !file) usage();
  const before = fileOf(beforePath, file);
  const after = fileOf(afterPath, file);
  const bl = before.source.split('\n');
  const al = after.source.split('\n');
  const map = lineMap(bl, al);
  const key = (line: number, m: Mutant): string => [line, m.location.start.column, m.mutatorName, m.replacement ?? ''].join('|');
  // кілька мутантів з однаковим ключем (той самий мутатор і заміна в одному місці) — пари по черзі
  const afterBy = new Map<string, Mutant[]>();
  for (const m of [...after.mutants].sort(byPos)) {
    const k = key(m.location.start.line, m);
    afterBy.set(k, [...(afterBy.get(k) ?? []), m]);
  }
  const pairOf = new Map<Mutant, Mutant>(); // мутант «після» → його пара «до»
  const groups: Record<string, string[]> = { убито: [], живий: [], 'зник або рядок змінено': [], ожив: [], 'новий живий': [] };
  for (const m of [...before.mutants].sort(byPos)) {
    const to = map.get(m.location.start.line);
    const a = to === undefined ? undefined : afterBy.get(key(to, m))?.shift();
    if (a !== undefined) pairOf.set(a, m);
    if (!ALIVE.has(m.status)) continue;
    if (a === undefined) groups['зник або рядок змінено'].push(row(m, bl));
    else groups[ALIVE.has(a.status) ? 'живий' : 'убито'].push(`${pos(m)} → ${row(a, al)}`);
  }
  for (const a of after.mutants.filter((x) => ALIVE.has(x.status)).sort(byPos)) {
    const m = pairOf.get(a);
    if (m === undefined) groups['новий живий'].push(row(a, al));
    else if (!ALIVE.has(m.status)) groups['ожив'].push(`${pos(m)} → ${row(a, al)}`);
  }
  console.log('до: ' + summary(before));
  console.log('після: ' + summary(after));
  for (const [g, rows] of Object.entries(groups)) {
    console.log(`\n${g} (${rows.length})`);
    for (const r of rows) console.log(r);
  }
} else usage();
