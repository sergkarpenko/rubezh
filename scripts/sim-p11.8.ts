// scripts/sim-p11.8.ts — масові симуляції П11.8 «Баланс probe-симуляціями»:
// 120 сідів × 3 пресети × 2 політики (DEFAULT без науки — референс П8.5/П10.4
// і SCIENCE_POLICY — партії з наукою Фази 11). Не входить у CI (важкі
// симуляції — поза CI, прецедент sim-p8.5.ts): запуск локально,
//   npx vite-node scripts/sim-p11.8.ts                              — 120 сідів × 3 пресети × 2 політики
//   npx vite-node scripts/sim-p11.8.ts --seeds 5                     — короткий прогін
//   npx vite-node scripts/sim-p11.8.ts --presets складний            — лише один пресет
//   npx vite-node scripts/sim-p11.8.ts --policies science            — лише політика науки
// Probe-кандидати чисел (зарплата/ціни/точки/тики) проганяються у КОПІЇ
// репозиторію зі зміненими константами ДО зміни коду (патерн П10.4,
// прецедент П8.6) — цей скрипт відтворює таблиці для будь-якого набору
// констант. vite-node уже в дереві залежностей vitest — нових залежностей
// немає (ADR-0012 не зачіпається).
// Детермінізм (ADR-0003): сіди 1..N фіксовані, жодного впливу оточення;
// повторний прогін — таблиці байт-у-байт ідентичні (розбіжність лише в
// рядку тривалості).
// Вивід (урок П8.5: повний вивід/CSV одразу на диск): markdown-таблиці в
// stdout І у dist/p11.8-simulations.md; по-партійний CSV — dist/p11.8-parties.csv.
// Зведення для звіту — docs/reports/p11.8-tuning.md.
// Т.21: розділ «Числа балансу» — вимірювачі поруч із часткою перемог (вона
// міряє обережність бота, Т.20): виграні місії на партію, гроші й ростер на
// 30-ту добу, частка діб без повного загону. Базова лінія —
// docs/reports/t21-balance-numbers.md.

import { mkdirSync, writeFileSync } from 'node:fs';
import { DEFAULT_PARTY_POLICY, MISSION_SQUAD_SIZE, SCIENCE_POLICY, simulateParty, type PartySimResult } from '../src/core/party-bot';
import { VICTORY_DAY, type DifficultyPreset } from '../src/core/campaign';
import type { ProjectId } from '../src/core/research';

const ALL_PRESETS: DifficultyPreset[] = ['легкий', 'норма', 'складний'];
const ALL_POLICIES = { default: DEFAULT_PARTY_POLICY, science: SCIENCE_POLICY } as const;
type PolicyName = keyof typeof ALL_POLICIES;

function parseList<T extends string>(flag: string, all: readonly T[]): T[] {
  const i = process.argv.indexOf(flag);
  if (i === -1 || !process.argv[i + 1]) return [...all];
  const asked = process.argv[i + 1].split(',').map((s) => s.trim());
  const found = all.filter((p) => asked.includes(p));
  return found.length ? found : [...all];
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

function meanOf(rs: PartySimResult[], f: (r: PartySimResult) => number): number {
  return round1(rs.reduce((a, r) => a + f(r), 0) / rs.length);
}

// Середнє значення кривої наприкінці заданої доби (0, якщо доба не досягнута).
function curveAt(rs: PartySimResult[], curve: (r: PartySimResult) => number[], day: number): number {
  const xs = rs.map((r) => curve(r)[day - 1]).filter((x) => x !== undefined);
  return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0;
}

// Квантиль p відсортованої вибірки (правило таблиці «Розподіл фінального рахунку»).
function quantile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

// Т.21: числа балансу однієї партії. Гроші, боєготові й ростер на 30-ту добу —
// лише для партій, що до неї дожили (знімок кінця 30-ї доби; ростер — живі
// оперативники разом із лікарнею, score.veteransAlive). Доба «без повного
// загону» — наприкінці доби боєготових менше, ніж іде в місію.
interface BalanceNumbers {
  missionsWon: number;
  days: number; // завершених діб партії
  daysNoFullSquad: number;
  money30: number | null;
  ready30: number | null;
  roster30: number | null;
}

function balanceOf(r: PartySimResult): BalanceNumbers {
  const reached = r.moneyByDay.length >= VICTORY_DAY;
  return {
    missionsWon: r.missionsWon,
    days: r.readyByDay.length,
    daysNoFullSquad: r.readyByDay.filter((n) => n < MISSION_SQUAD_SIZE).length,
    money30: reached ? r.moneyByDay[VICTORY_DAY - 1] : null,
    ready30: reached ? r.readyByDay[VICTORY_DAY - 1] : null,
    roster30: reached ? r.score.veteransAlive : null,
  };
}

const seedCount = parseSeedCount();
const PRESETS = parseList('--presets', ALL_PRESETS);
const POLICIES = parseList('--policies', Object.keys(ALL_POLICIES) as PolicyName[]);
const seeds = Array.from({ length: seedCount }, (_, i) => i + 1);
const byCell = new Map<string, PartySimResult[]>();
const started = Date.now();

for (const policyName of POLICIES) {
  const policy = ALL_POLICIES[policyName];
  for (const preset of PRESETS) {
    const results: PartySimResult[] = [];
    for (const seed of seeds) {
      results.push(simulateParty(seed, preset, { policy }));
    }
    byCell.set(`${policyName}/${preset}`, results);
  }
}

const out: string[] = [];
out.push(
  `# П11.8 — симуляції балансу науки: ${seedCount} сідів × ${PRESETS.length} пресети × ${POLICIES.length} політики (${round1((Date.now() - started) / 1000)} с)`
);
out.push('');
out.push(
  `Політики: default = ${DEFAULT_PARTY_POLICY.name} (без науки, референс П8.5/П10.4), science = ${SCIENCE_POLICY.name} (вчені + проєкти + цех + екіпірування).`
);
out.push('');

for (const policyName of POLICIES) {
  for (const preset of PRESETS) {
    const rs = byCell.get(`${policyName}/${preset}`)!;
    const wins = rs.filter((r) => r.outcome === 'перемога');
    const bankrupts = rs.filter((r) => r.outcome === 'банкрутство');
    const scores = rs.map((r) => r.score.total);
    const shortfallParties = rs.filter((r) => r.salaryShortfallDays > 0);
    out.push(`## Політика «${policyName}», пресет «${preset}» (${rs.length} партій)`);
    out.push('');
    out.push('| Метрика | Значення |');
    out.push('| --- | --- |');
    out.push(`| Партій до 30 діб (перемога) | ${wins.length} (${round1((100 * wins.length) / rs.length)}%) |`);
    out.push(
      `| Банкрутств | ${bankrupts.length} (${round1((100 * bankrupts.length) / rs.length)}%)${bankrupts.length ? `, медіана дня ${median(bankrupts.map((r) => r.endDay))}` : ''} |`
    );
    out.push(
      `| Середній фінальний рахунок | ${meanOf(rs, (r) => r.score.total)} (медіана ${median(scores)}, мін ${Math.min(...scores)}, макс ${Math.max(...scores)}) |`
    );
    out.push(
      `| Місій запущено | ${meanOf(rs, (r) => r.missionsLaunched)} / партію; перемог ${meanOf(rs, (r) => r.missionsWon)}, поразок ${meanOf(rs, (r) => r.missionsLost)} |`
    );
    out.push(`| Загиблих / поранень | ${meanOf(rs, (r) => r.soldiersLost)} / ${meanOf(rs, (r) => r.soldiersWounded)} на партію |`);
    out.push(`| Наймано солдатів (витрати) | ${meanOf(rs, (r) => r.hiredTotal)} (${meanOf(rs, (r) => r.hireSpent)}) |`);
    out.push(
      `| Вчених наймано / звільнено (спіраль) | ${meanOf(rs, (r) => r.scientistsHired)} / ${meanOf(rs, (r) => r.scientistsFired)} |`
    );
    out.push(
      `| Партій з невиплатою зарплати | ${shortfallParties.length} (${round1((100 * shortfallParties.length) / rs.length)}%); діб з невиплатою ${meanOf(rs, (r) => r.salaryShortfallDays)} / партію |`
    );
    out.push(
      `| Зарплата / проєкти / цех (витрати) | ${meanOf(rs, (r) => r.salarySpent)} / ${meanOf(rs, (r) => r.projectSpent)} / ${meanOf(rs, (r) => r.workshopSpent)} |`
    );
    out.push(`| Проєктів завершено | ${meanOf(rs, (r) => r.projectsCompleted)} / партію |`);
    out.push(`| Предметів вироблено / екіпіровано | ${meanOf(rs, (r) => r.workshopProduced)} / ${meanOf(rs, (r) => r.equippedItems)} |`);
    out.push('');
  }
}

// Т.21: числа балансу — поруч із часткою перемог, а не замість неї.
out.push('## Числа балансу (Т.21)');
out.push('');
out.push(
  `Виграні місії і доби без повного загону — за всіма партіями; гроші й ростер на ${VICTORY_DAY}-ту добу — за партіями, що до неї дожили (медіана, у дужках p25–p75).`
);
out.push('');
out.push(
  `| Політика/Пресет | Виграно місій / партію (медіана) | Дожили до ${VICTORY_DAY}-ї доби | Гроші на ${VICTORY_DAY}-ту добу | Ростер на ${VICTORY_DAY}-ту добу | із них боєготових | Діб без повного загону, % |`
);
out.push('| --- | --- | --- | --- | --- | --- | --- |');
for (const policyName of POLICIES) {
  for (const preset of PRESETS) {
    const bs = byCell.get(`${policyName}/${preset}`)!.map(balanceOf);
    const at30 = (f: (b: BalanceNumbers) => number | null): string => {
      const xs = bs.flatMap((b) => (f(b) === null ? [] : [f(b)!])).sort((a, b) => a - b);
      return xs.length ? `${median(xs)} (${quantile(xs, 0.25)}–${quantile(xs, 0.75)})` : '—';
    };
    const days = bs.reduce((a, b) => a + b.days, 0);
    const noFull = bs.reduce((a, b) => a + b.daysNoFullSquad, 0);
    out.push(
      `| ${policyName}/${preset} | ${round1(bs.reduce((a, b) => a + b.missionsWon, 0) / bs.length)} (${median(bs.map((b) => b.missionsWon))}) | ${bs.filter((b) => b.money30 !== null).length} із ${bs.length} | ${at30((b) => b.money30)} | ${at30((b) => b.roster30)} | ${at30((b) => b.ready30)} | ${days ? round1((100 * noFull) / days) : 0} |`
    );
  }
}
out.push('');

// Завершення проєктів: скільки партій завершили кожен проєкт (політика науки).
for (const preset of PRESETS) {
  const rs = byCell.get(`science/${preset}`);
  if (!rs) continue;
  out.push(`## Завершені проєкти, «${preset}» (політика science, ${rs.length} партій)`);
  out.push('');
  const ids: ProjectId[] = ['легка броня', 'оптичний приціл', 'аптечка', 'розширення лабораторії', 'осколкова граната', 'гарматний модуль'];
  out.push('| Проєкт | Партій, що завершили | Середній день завершення |');
  out.push('| --- | --- | --- |');
  for (const id of ids) {
    const done = rs.filter((r) => r.completedProjects.includes(id));
    // день завершення — із кривої штату не витягнути; рахуємо по завершеним до кінця партії
    out.push(`| ${id} | ${done.length} (${round1((100 * done.length) / rs.length)}%) | — |`);
  }
  out.push('');
}

// Крива грошей і штату вчених: контрольні доби Д5/Д10/Д15/Д20/Д25/Д30.
out.push('## Крива грошей (середні наприкінці доби)');
out.push('');
out.push(`| Доба |${POLICIES.flatMap((p) => PRESETS.map((x) => ` ${p}/${x} |`)).join('')}`);
out.push(`| --- |${POLICIES.flatMap((p) => PRESETS.map(() => ' --- |')).join('')}`);
for (const day of [5, 10, 15, 20, 25, 30]) {
  out.push(
    `| Д${day} |${POLICIES.flatMap((p) => PRESETS.map((x) => ` ${curveAt(byCell.get(`${p}/${x}`)!, (r) => r.moneyByDay, day)} |`)).join('')}`
  );
}
out.push('');
out.push('## Крива штату вчених (середні наприкінці доби, політика science)');
out.push('');
out.push(`| Доба |${PRESETS.map((x) => ` ${x} |`).join('')}`);
out.push(`| --- |${PRESETS.map(() => ' --- |').join('')}`);
for (const day of [5, 10, 15, 20, 25, 30]) {
  const rs = (preset: DifficultyPreset) => byCell.get(`science/${preset}`);
  out.push(`| Д${day} |${PRESETS.map((x) => ` ${rs(x) ? round1(meanOf(rs(x)!, (r) => r.scientistsByDay[day - 1] ?? 0)) : 0} |`).join('')}`);
}
out.push('');

// Розподіл фінального рахунку (прийнятність балансу, прецедент П10.4).
out.push('## Розподіл фінального рахунку');
out.push('');
out.push('| Політика/Пресет | мін | p25 | медіана | p75 | макс |');
out.push('| --- | --- | --- | --- | --- | --- |');
for (const policyName of POLICIES) {
  for (const preset of PRESETS) {
    const s = byCell
      .get(`${policyName}/${preset}`)!
      .map((r) => r.score.total)
      .sort((a, b) => a - b);
    out.push(`| ${policyName}/${preset} | ${s[0]} | ${quantile(s, 0.25)} | ${median(s)} | ${quantile(s, 0.75)} | ${s[s.length - 1]} |`);
  }
}
out.push('');

mkdirSync('dist', { recursive: true });
writeFileSync('dist/p11.8-simulations.md', out.join('\n'), 'utf8');
console.log(out.join('\n'));

// CSV по-партійний: усі метрики, включно з наукою (probe-аналіз поза скриптом).
const header =
  'policy,preset,seed,outcome,endDay,score,missionsLaunched,missionsWon,soldiersLost,soldiersWounded,hiredTotal,hireSpent,repairs,scientistsHired,scientistsFired,salaryShortfallDays,salarySpent,projectSpent,workshopSpent,projectsCompleted,completedProjects,workshopProduced,equippedItems,days,daysNoFullSquad,money30,roster30,ready30';
const lines = [header];
for (const policyName of POLICIES) {
  for (const preset of PRESETS) {
    for (const r of byCell.get(`${policyName}/${preset}`)!) {
      const b = balanceOf(r);
      lines.push(
        [
          policyName,
          preset,
          r.seed,
          r.outcome,
          r.endDay,
          r.score.total,
          r.missionsLaunched,
          r.missionsWon,
          r.soldiersLost,
          r.soldiersWounded,
          r.hiredTotal,
          r.hireSpent,
          r.repairs,
          r.scientistsHired,
          r.scientistsFired,
          r.salaryShortfallDays,
          r.salarySpent,
          r.projectSpent,
          r.workshopSpent,
          r.projectsCompleted,
          r.completedProjects.join(';'),
          r.workshopProduced,
          r.equippedItems,
          b.days,
          b.daysNoFullSquad,
          b.money30 ?? '',
          b.roster30 ?? '',
          b.ready30 ?? '',
        ].join(',')
      );
    }
  }
}
writeFileSync('dist/p11.8-parties.csv', lines.join('\n'), 'utf8');
console.log(`\nCSV партій: dist/p11.8-parties.csv (${lines.length - 1} партій); повний вивід: dist/p11.8-simulations.md`);
