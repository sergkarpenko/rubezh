#!/usr/bin/env node
// Вирізач готових блоків плану для Mistral Vibe Code (Т.60).
// Блок плану — рядок-позначка `<!-- блок: ім'я -->` і огорожа (```text, ```ts …) одразу після неї.
// Вміст огорожі без кінцевого переносу рядка пишеться у файл <тека>/<ім'я>.txt.
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

const plan = readFileSync(planPath, 'utf8').replace(/\r\n/g, '\n');
const marks = plan.match(/^<!-- блок: .*$/gm) ?? [];
const blocks = [...plan.matchAll(/^<!-- блок: (\S+) -->\n(`{3,})[^\n`]*\n([\s\S]*?)\n\2$/gm)];
const errors = [];
const names = new Set();
for (const [, name] of blocks) {
  if (!/^[\p{L}\p{N}._-]+$/u.test(name)) errors.push(`недопустиме ім'я блоку: ${name}`);
  if (names.has(name)) errors.push(`ім'я двічі: ${name}`);
  names.add(name);
}
if (marks.length !== blocks.length)
  errors.push(`позначок ${marks.length}, блоків ${blocks.length}: позначка без огорожі одразу після неї або порожній блок`);
if (errors.length) {
  for (const e of errors) console.error(e);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
for (const [, name, , body] of blocks) writeFileSync(join(outDir, `${name}.txt`), body);
console.log(`Блоків: ${blocks.length}${blocks.length ? ' — ' + blocks.map((b) => b[1]).join(', ') : ''}`);
