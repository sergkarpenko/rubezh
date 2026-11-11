#!/usr/bin/env node
// scripts/mutation-summary.mjs — зведення мутаційного прогону (ADR-0084).
// Читає звіт Stryker (dist/mutation/mutation.json) і друкує Markdown: загальний
// mutation score, таблицю за файлами і перелік мутантів, яких тести не виявили.
// Workflow `mutation` дописує цей вивід у зведення прогону ($GITHUB_STEP_SUMMARY).
// Запуск: node scripts/mutation-summary.mjs [шлях до mutation.json]
import { readFileSync } from 'node:fs';

/** Скільки не виявлених мутантів показувати у зведенні; повний перелік — у звіті. */
const MAX_LISTED = 60;

const UNDETECTED = new Set(['Survived', 'NoCoverage']);

/** Частка у відсотках з одним знаком і десятковою комою; без мутантів — «—». */
function percent(detected, undetected) {
  const valid = detected + undetected;
  return valid === 0 ? '—' : ((100 * detected) / valid).toFixed(1).replace('.', ',');
}

/** Лічильники статусів одного файла звіту. */
function countFile(mutants) {
  const counts = { killed: 0, timeout: 0, survived: 0, noCoverage: 0, other: 0 };
  for (const { status } of mutants) {
    if (status === 'Killed') counts.killed++;
    else if (status === 'Timeout') counts.timeout++;
    else if (status === 'Survived') counts.survived++;
    else if (status === 'NoCoverage') counts.noCoverage++;
    else counts.other++;
  }
  return counts;
}

const path = process.argv[2] ?? 'dist/mutation/mutation.json';
const report = JSON.parse(readFileSync(path, 'utf8'));

const rows = Object.entries(report.files)
  .map(([file, { mutants }]) => {
    const counts = countFile(mutants);
    const detected = counts.killed + counts.timeout;
    const undetected = counts.survived + counts.noCoverage;
    // Файл без мутантів — у кінець таблиці, а не NaN посеред сортування.
    const ratio = detected + undetected === 0 ? 1 : detected / (detected + undetected);
    return { file, ...counts, detected, undetected, ratio };
  })
  .sort((a, b) => a.ratio - b.ratio || a.file.localeCompare(b.file));

const total = rows.reduce(
  (sum, row) => ({
    detected: sum.detected + row.detected,
    undetected: sum.undetected + row.undetected,
    timeout: sum.timeout + row.timeout,
    survived: sum.survived + row.survived,
    noCoverage: sum.noCoverage + row.noCoverage,
    other: sum.other + row.other,
  }),
  { detected: 0, undetected: 0, timeout: 0, survived: 0, noCoverage: 0, other: 0 }
);

const lines = [];
const sha = process.env.GITHUB_SHA;
lines.push(`## Мутаційний прогін ядра${sha ? ` — \`${sha.slice(0, 7)}\`` : ''}`, '');
lines.push(
  `**Mutation score: ${percent(total.detected, total.undetected)} %** — виявлено ` +
    `${total.detected} з ${total.detected + total.undetected} мутантів (файлів: ${rows.length}); ` +
    `${total.survived} вижили, ${total.noCoverage} без покриття` +
    `${total.timeout ? `; з виявлених ${total.timeout} — за тайм-аутом` : ''}` +
    `${total.other ? `; ${total.other} поза рахунком (помилки компіляції чи виконання)` : ''}.`,
  ''
);
lines.push('| Файл | Score, % | Виявлено | Вижили | Без покриття |', '| --- | ---: | ---: | ---: | ---: |');
for (const row of rows) {
  lines.push(`| \`${row.file}\` | ${percent(row.detected, row.undetected)} | ${row.detected} | ${row.survived} | ${row.noCoverage} |`);
}

const undetectedMutants = Object.entries(report.files).flatMap(([file, { mutants }]) =>
  mutants.filter(({ status }) => UNDETECTED.has(status)).map((mutant) => ({ file, line: mutant.location.start.line, ...mutant }))
);
if (undetectedMutants.length > 0) {
  lines.push('', `<details><summary>Не виявлено: ${undetectedMutants.length}</summary>`, '');
  for (const mutant of undetectedMutants.slice(0, MAX_LISTED)) {
    const mark = mutant.status === 'NoCoverage' ? ' (без покриття)' : '';
    lines.push(`- \`${mutant.file}:${mutant.line}\` — ${mutant.mutatorName}${mark}`);
  }
  if (undetectedMutants.length > MAX_LISTED) {
    lines.push(`- …і ще ${undetectedMutants.length - MAX_LISTED} — повний перелік у звіті (артефакт прогону).`);
  }
  lines.push('', '</details>');
}
lines.push(
  '',
  'Мутантів убивають лише тести без DOM (ADR-0083): «вижив» означає «немає прицільного тесту в ядрі». ' +
    'Порога немає (ADR-0084). Повний звіт — артефакт `mutation-report` цього прогону.'
);

// Звіт без жодного виявленого мутанта — поломка прогону, а не результат:
// workflow має стати червоним, а не показати порожню таблицю.
if (total.detected === 0) {
  console.error('mutation-summary: у звіті немає жодного виявленого мутанта — прогін зламаний');
  process.exit(1);
}

console.log(lines.join('\n'));
