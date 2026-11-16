#!/usr/bin/env node
// Самоперевірка scripts/vibe-plan-check.mjs (Т.54): функції окремо і весь скрипт у тимчасовому
// git-репозиторії (mktemp, без хуків) — «поганий» PR має дати рівно очікувані знахідки, «добрий» — жодної.
// Запуск: node scripts/vibe-plan-check-selftest.mjs. Код виходу: 0 — усе зійшлось, 1 — ні. Пише лише в тимчасову теку.
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchesBad, parsePlan, parseTerms, quotes, translit } from './vibe-plan-check.mjs';

let failed = 0;
let total = 0;
const ok = (name, cond) => {
  total++;
  if (!cond) console.log(`ПРОВАЛ: ${name}`) || failed++;
};
const eq = (name, a, b) => ok(`${name}: є «${a}», очікувалось «${b}»`, String(a) === String(b));

// Функції окремо.
eq(
  'вкладені цитати',
  quotes('a «b «c» d» e «f»')
    .map((q) => q.text)
    .join('|'),
  'b «c» d|f'
);
const terms = parseTerms('- **зонд** (не «зона»), **сід** (не «сид», не «seed» у тексті), **тік** (на «21-му» тіку)');
eq('терміни', terms.map((t) => `${t.bad}>${t.good}`).join(), 'зона>зонд,сид>сід,seed>сід');
const forms = ['зона', 'зони', 'зоною', 'зонда', 'зондом', 'сезон'].map((w) => matchesBad(w, terms[0]));
eq('форми слова «зона»', forms.join(), 'true,true,true,false,false,false');
eq('коротке слово «сид»', ['сид', 'сиду', 'сидить'].map((w) => matchesBad(w, terms[1])).join(), 'true,true,false');
eq('трансліт', translit('після').join(), 'pislia,pislya,pislya');

const P = 'docs/plans/t99-x.md';
const PLAN = `# Т.99 — проба: план для Vibe Code
## Терміни гри (писати саме так)
- **зонд** (не «зона»), **сід** (не «сид», не «seed» у тексті), плитка **«Стоп»**;
## Відповідь власника (01.01.2026, до реалізації)
Питання: «Що робить «Меню» під час бою?». Відповідь: **«Зупиняти»** (варіант: «Діє як «Стоп»»).
## Що зробити
- Звіт \`docs/reports/t99-x.md\` з розділами: «Що зроблено», «Межі» (таблиця), «Метрики». **Жодного розділу не пропускати.**
- Після зупинки зонд лишається, статус і перевірка після кліку.
## PR
- PR у \`main\`. Назва — **дослівно, скопіювати**: \`fix(ui): Т.99 — проба «Меню»\`.
\`\`\`
Iter-Tag: iter-T.99
\`\`\`
`;
const plan = parsePlan(PLAN);
eq('план: назва', plan.title, 'fix(ui): Т.99 — проба «Меню»');
const parsed = [plan.iterTag, plan.answers, plan.reportPath, plan.reportSections].join('; ');
eq('план: тег, відповіді, звіт', parsed, 'Iter-Tag: iter-T.99; Зупиняти; docs/reports/t99-x.md; Що зроблено,Межі,Метрики');

// Увесь скрипт у тимчасовому репозиторії. Описи PR лежать у .git — поза деревом, у коміти не потрапляють.
const dir = mkdtempSync(join(tmpdir(), 'vibe-plan-check-'));
const ID = ['-c', 'core.hooksPath=/dev/null', '-c', 'user.name=t', '-c', 'user.email=t@t'];
const git = (...a) => execFileSync('git', ['-C', dir, ...ID, ...a], { encoding: 'utf8' });
const commit = (msg, files) => {
  for (const [f, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), text);
  }
  git('add', '-A');
  git('commit', '-q', '-m', msg);
  return git('rev-parse', 'HEAD').trim();
};
// Аргументи — одним рядком через «·».
const run = (args) =>
  spawnSync('node', ['scripts/vibe-plan-check.mjs', ...args.split('·').filter(Boolean)], { encoding: 'utf8', cwd: dir });
const WF = 'Гравець бачить стан і читання журналу, зона ходу, перевірка; рядки лишаються; «плітка» — одруківка.\n';
try {
  git('init', '-q');
  mkdirSync(join(dir, 'scripts'));
  cpSync(fileURLToPath(new URL('./vibe-plan-check.mjs', import.meta.url)), join(dir, 'scripts/vibe-plan-check.mjs'));
  const glossary = '# Глосарій\n## Анти-глосарій\n| Не пишемо | Пишемо |\n| --- | --- |\n| папка | тека |\n';
  const src = 'export const status = 1; // плитка керування\n';
  const base = commit('base', { 'docs/glossary.md': glossary, 'docs/workflow.md': WF, 'src/a.ts': src });
  const planRev = commit('docs(plans): план', { [P]: PLAN });
  ok('звіту ще немає', run(`--plan·${P}·--base·${base}·--head·${planRev}`).stdout.includes('звіту docs/reports/t99-x.md немає'));
  const table = '| Питання | Відповідь |\n| --- | --- |\n| Що? | «Зупинити» |\n';
  const bad = commit('fix: зона і сид', {
    'docs/reports/t99-x.md': `# Т.99\n## Що зроблено\nПлітка «Стоп», гайдJFKів, зони немає, одна папка; seed 5 і \`seed\`, напис «Готово».\n\n${table}## Метрики\n`,
    'docs/workflow.md': `${WF}- Т.99 (рішення власника «Так, усе збережено»): слово «зона» тут лише згадано; читання, зупинка, рядки лишаються.\n`,
    'src/b.ts': "// zupynky pislia kliku: status лишається\nexport const yakshchoStop = 'Стан\\nГравець';\n",
    'docs/glossary.md': `${glossary}| зона | зонд |\n| рядки | смуги |\n`,
  });
  writeFileSync(
    join(dir, '.git/body-bad.md'),
    'Власник: «Зупинити».\nВласник сказав «Що робить».\nЗупиняти треба.\n  Iter-Tag: iter-T.99\n'
  );
  writeFileSync(join(dir, '.git/terms.md'), '## Терміни гри\n- **перегляд** (не «читання»)\n');
  const r1 = run(`--plan·${P}·--base·${base}·--head·${bad}·--title·fix(ui): Т.99 — проба·--body-file·.git/body-bad.md`);
  eq('поганий PR: код виходу', r1.status, 1);
  // Очікувані рядки виводу, по одному через «|».
  const expected =
    'назва PR не збігається з планом|в описі PR немає рядка «Iter-Tag: iter-T.99»|' +
    'в описі PR немає відповіді власника дослівно: «Зупиняти»|цитата власника не з плану: «Зупинити» (docs/reports/t99-x.md:7)|' +
    'цитата власника не з плану: «Так, усе збережено»|цитата власника не з плану: «Зупинити» (опис PR:1)|' +
    'у звіті немає розділу «Межі»|у звіті й записі кроку немає відповіді власника дослівно: «Зупиняти»|' +
    'можлива одруківка: «Плітка» — у плані «плитка»|мішанина латинки й кирилиці: «гайдJFKів»|' +
    'слово поза словником: «зони» — писати «зонд» (×1;|слово поза словником: «папка» — писати «тека»|' +
    'слово поза словником: «seed» — писати «сід»|схоже на трансліт: «zupynky» — «зупинки»|' +
    'схоже на трансліт: «pislia» — «після»|схоже на трансліт: «kliku» — «кліку»|Знахідок: 18.|' +
    'цитата власника не з плану: «Що робить» (опис PR:2)|схоже на трансліт: «yakshchoStop» — «якщо»|слово поза словником: «seed» — писати «сід» (×1;|' +
    'Заувага (повідомлення коміту, не виправити): слово поза словником: «зона»|' +
    'Заувага (повідомлення коміту, не виправити): слово поза словником: «сид»';
  for (const e of expected.split('|')) ok(`поганий PR: немає рядка «${e}» у виводі:\n${r1.stdout}`, r1.stdout.includes(e));
  const r1a = run(`--plan·${P}·--base·${base}·--head·${bad}·--allow·плітка·--allow·Так, усе збережено·--terms·.git/terms.md`);
  ok(
    `--allow прибирає слово і цитату, --terms додає «читання» (без назви й опису — 12 знахідок):\n${r1a.stdout}`,
    r1a.stdout.includes('Знахідок: 12.')
  );

  const good = commit('fix: виправлено', {
    'docs/reports/t99-x.md': '# Т.99\n## Що зроблено\nПлитка «Стоп».\n## Межі (після аудиту)\n## Метрики\n',
    'docs/workflow.md': `${WF}- Т.99 (рішення власника «Зупиняти»): слово «зона» тут лише згадано; читання.\n`,
    'src/b.ts': "// зупинки після кліку: status лишається\nexport const afterStop = 'Стан\\nГравець';\n",
  });
  writeFileSync(join(dir, '.git/body-good.md'), 'Власник, розділ «Відповідь власника»: **«Зупиняти»**.\n\nIter-Tag: iter-T.99\n');
  const r2 = run(`--plan·${P}·--base·${base}·--head·${good}·--title·fix(ui): Т.99 — проба «Меню»·--body-file·.git/body-good.md`);
  ok(`добрий PR: код ${r2.status}, вивід:\n${r2.stdout}`, r2.status === 0 && r2.stdout.includes('Знахідок немає.'));
  eq('добрий PR: зауваги про коміти лишаються', (r2.stdout.match(/^Заувага/gm) ?? []).length, 2);

  const wrong = ['', '--plan', `--plan·${P}·--pr·abc`, `--plan·немає.md·--base·${base}`, `--plan·${P}·--base·немає`, `--plan·${P}·--head`];
  // База пішла вперед після відгалуження: її зміна рядка про зону ходу — не «доданий рядок» гілки.
  git('checkout', '-q', '-b', 'side', base);
  const side = commit('side', { 'docs/workflow.md': WF.replace('зона', 'смуга') });
  eq('база пішла вперед', run(`--plan·${P}·--base·${side}·--head·${good}`).status, 0);
  ok('--pr без номера названо', run(`--plan·${P}·--pr·abc`).stdout.includes('--pr: потрібен номер'));
  ok('неповний аргумент названо', run(`--plan·${P}·--head`).stdout.includes('Невідомий або неповний аргумент: --head'));
  eq('помилки запуску', [...wrong, '--help'].map((a) => run(a).status).join(), '2,2,2,2,2,2,0');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log(failed ? `Самоперевірка: провалів ${failed} із ${total}.` : `Самоперевірка: ${total} перевірок, усі зійшлись.`);
process.exit(failed ? 1 : 0);
