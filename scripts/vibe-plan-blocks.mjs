#!/usr/bin/env node
// Вирізач готових блоків плану для Mistral Vibe Code (Т.60).
// Блок плану — рядок-позначка `<!-- блок: ім'я -->` і огорожа (```text, ```ts …) одразу після неї.
// Вміст огорожі без кінцевого переносу рядка пишеться у файл <тека>/<ім'я>.txt; ім'я — латинські літери,
// цифри, `.`, `_`, `-`. Старих файлів у теці скрипт не видаляє.
// Той самий скрипт ганяють і виконавець, і планувальник на своєму прототипі — тоді диф виконавця
// можна звірити з прототипом побайтно (порада залишків Т.58 у docs/agents/common.md).
// Використання: node scripts/vibe-plan-blocks.mjs <план> <тека>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [planPath, outDir] = process.argv.slice(2);
if (!planPath || !outDir) {
  console.error('Використання: node scripts/vibe-plan-blocks.mjs <план> <тека>');
  process.exit(2);
}

let plan;
try {
  plan = readFileSync(planPath, 'utf8').replace(/\r\n/g, '\n');
} catch (e) {
  console.error(`Не прочитано план ${planPath}: ${e.message}`);
  process.exit(2);
}
// Будь-який рядок, схожий на позначку (з відступом, з великої літери, з іншими пробілами), — щоб позначка
// з помилкою не пропала мовчки: її не знайде точний вираз блоку, і числа розійдуться.
const marks = plan.match(/^[ \t]*<!--[ \t]*[Бб]лок[ \t]*:/gm) ?? [];
// Закривна огорожа — ті самі лапки, далі лише пробіли: інакше блок поглинув би текст до наступної огорожі.
const blocks = [...plan.matchAll(/^<!-- блок: (\S+) -->\n(`{3,})[^\n`]*\n([\s\S]*?)\n\2[ \t]*$/gm)];
const errors = [];
const names = new Set();
for (const [, name] of blocks) {
  if (!/^[A-Za-z0-9._-]+$/.test(name) || /^\.+$/.test(name)) errors.push(`недопустиме ім'я блоку: ${name}`);
  if (names.has(name)) errors.push(`ім'я двічі: ${name}`);
  names.add(name);
}
if (marks.length !== blocks.length)
  errors.push(
    `позначок ${marks.length}, блоків ${blocks.length}: позначка з помилкою, без огорожі одразу після неї, порожній блок або позначка всередині іншого блоку`
  );
if (errors.length) {
  for (const e of errors) console.error(e);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
for (const [, name, , body] of blocks) writeFileSync(join(outDir, `${name}.txt`), body);
console.log(`Блоків: ${blocks.length}${blocks.length ? ' — ' + blocks.map((b) => b[1]).join(', ') : ''}`);
