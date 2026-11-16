#!/usr/bin/env node
// Звірка довідників агентів (docs/agents/*.md) з репозиторієм (кандидат 36, Т.50).
// Перевіряє, що згадане в довідниках існує: шляхи файлів і тек у `…` та посиланнях,
// номери ADR (файл docs/adr/NNNN-*.md), назви npm-скриптів (`npm run X`).
// Запуск: node scripts/agents-docs-check.mjs [файл.md …] — без аргументів бере docs/agents/*.md.
// Код виходу: 0 — розбіжностей немає, 1 — є, 2 — помилка запуску. Нічого не пише на диск.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.some((a) => a.startsWith('-'))) {
  console.log('Запуск: node scripts/agents-docs-check.mjs [файл.md …]');
  process.exit(args.every((a) => a === '--help' || a === '-h') ? 0 : 2);
}
const files = args.length
  ? args.map((f) => relative(root, resolve(process.cwd(), f))) // аргументи — від поточної теки
  : readdirSync(join(root, 'docs/agents'))
      .filter((f) => f.endsWith('.md'))
      .map((f) => `docs/agents/${f}`);

// Верхній рівень репозиторію, з якого починаються відносні шляхи в довідниках: робоча тека
// разом із origin/main — інакше згадка файла чи теки, видалених у гілці, пройшла б мовчки (аудит Т.50).
const TOP = new Set(readdirSync(root).filter((f) => f !== '.git' && f !== 'node_modules'));
try {
  const out = execFileSync('git', ['-C', root, 'ls-tree', '--name-only', 'origin/main'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  for (const name of out.split('\n')) if (name) TOP.add(name);
} catch {
  console.log('Увага: origin/main не прочитано — видалені на верхньому рівні файли не перевіряються');
}
const EXT = /\.(md|ts|mjs|js|sh|py|json|ya?ml|html|webp|png)$/;
const adrFiles = readdirSync(join(root, 'docs/adr'));
const npmScripts = Object.keys(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts ?? {});

/** Чи схоже на шлях у репозиторії (а не на команду, змінну чи шаблон). */
function pathCandidate(token) {
  // Зрізати «./» на початку, номер рядка «:N», якір «#…» і розділовий знак у кінці.
  const t = token
    .replace(/^\.\//, '')
    .replace(/(:\d+(-\d+)?|#[^/]*)$/, '')
    .replace(/[:,;.]$/, '');
  if (!t || /[\s*<>{}$|=?"'\\]/.test(t) || t.includes('…')) return null;
  if (/^(https?:|\/|~)/.test(t) || t.startsWith('-')) return null;
  const first = t.split('/')[0];
  if (TOP.has(first) && (t.includes('/') || EXT.test(t))) return t;
  return null;
}

const problems = [];
const seen = { paths: new Set(), adr: new Set(), npm: new Set() };

for (const file of files) {
  let text;
  try {
    text = readFileSync(join(root, file), 'utf8');
  } catch (e) {
    console.error(`Не прочитано ${file}: ${e.message}`);
    process.exit(2);
  }
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    const where = `${file}:${i + 1}`;
    const tokens = [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    // Шляхи: окремий токен у `…` або слово-шлях усередині команди.
    for (const tok of tokens) {
      for (const word of tok.split(/\s+/)) {
        const p = pathCandidate(word.replace(/^["(]|[")]$/g, ''));
        if (!p) continue;
        seen.paths.add(p);
        if (!existsSync(join(root, p))) problems.push(`${where}: шляху немає — ${p}`);
      }
      const npm = tok.match(/npm run ([\w:-]+)/g) ?? [];
      for (const m of npm) {
        const name = m.slice('npm run '.length);
        seen.npm.add(name);
        if (!npmScripts.includes(name)) problems.push(`${where}: npm-скрипта немає — ${name}`);
      }
    }
    // Посилання Markdown: відносні до файлу довідника.
    for (const m of line.matchAll(/\]\(([^)#\s]+)(#[^)]*)?\)/g)) {
      const target = m[1];
      if (/^(https?:|mailto:|\/)/.test(target)) continue;
      const p = join(dirname(file), target);
      seen.paths.add(p);
      if (!existsSync(join(root, p))) problems.push(`${where}: посилання веде в нікуди — ${target}`);
    }
    // ADR: номер має файл у docs/adr/.
    for (const m of line.matchAll(/ADR-(\d{4})(?!\d)/g)) {
      seen.adr.add(m[1]);
      if (!adrFiles.some((f) => f.startsWith(`${m[1]}-`))) problems.push(`${where}: ADR немає — ADR-${m[1]}`);
    }
  });
}

for (const p of problems) console.log(p);
console.log(
  `${problems.length ? '[FAIL]' : '[OK]'} файлів ${files.length}; шляхів ${seen.paths.size}, ADR ${seen.adr.size}, npm-скриптів ${seen.npm.size}; розбіжностей ${problems.length}`
);
process.exit(problems.length ? 1 : 0);
