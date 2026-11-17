#!/usr/bin/env node
// Самоперевірка scripts/vibe-plan-check.mjs (Т.54; Т.62 — форми слів, місця <…>, аудит, вказівки): функції окремо і весь скрипт у тимчасовому
// git-репозиторії (mktemp, без хуків) — «поганий» PR має дати рівно очікувані знахідки, «добрий» — жодної.
// Запуск: node scripts/vibe-plan-check-selftest.mjs. Код виходу: 0 — усе зійшлось, 1 — ні. Пише лише в тимчасову теку.
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkAudit, checkInstructions, checkPlaces, matchesBad, parsePlan, parseTerms, quotes, translit } from './vibe-plan-check.mjs';

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
// Т.62: довжина форми не обмежена, але після основи — лише закінчення чи суфікс прикметника.
const mut = parseTerms('**навмисна поломка** (не «мутація»)')[0];
const longForms = ['мутаційний', 'мутаційного', 'мутаціями', 'мутації', 'мутацій', 'мутаційна'].map((w) => matchesBad(w, mut));
eq('довгі форми «мутація»', longForms.join(), 'true,true,true,true,true,true');
eq(
  'не форми «зона»',
  ['зонт', 'зонтик', 'зонами', 'зоны', 'зонний'].map((w) => matchesBad(w, terms[0])).join(),
  'false,false,true,true,true'
);
eq('не форма «мутація»', ['мутаціяк', 'мутацнік'].map((w) => matchesBad(w, mut)).join(), 'false,false');
eq('апостроф — одне слово', [...parsePlan("ім’я, м'ятий, імʼя").words].join(), "ім'я,м'ятий");
const BL = '<!-- блок: rep -->\n```text\n- Рядків — <число>; команда `git checkout <файл>`.\n```\n';
const bp = parsePlan(`# П\n${BL}- Перед відкриттям PR запустити звірку з планом і числа записати в опис PR, а не новим комітом.\n`);
eq('місця з блоків, без коду', [...bp.places].join(), '<число>');
eq('вказівки поза блоками', bp.instructions.length, 1);
const noBlocks = parsePlan('<число> і довга вказівка плану, яка не в блоці, але блоків немає в плані зовсім.');
eq('без блоків — ні місць, ні вказівок', [noBlocks.places.size, noBlocks.instructions.length].join(), '0,0');
const LONG = 'заголовок або рядок таблиці, довший за шістдесят знаків, — не вказівка плану';
const marked = parsePlan(`${BL.replace('<число>', '<!-- примітка в блоці --> <число>')}## ${LONG}\n| ${LONG} |\n`);
eq(
  'HTML-коментар у блоці — не місце; заголовок і таблиця — не вказівки',
  [[...marked.places].join(), marked.instructions.length].join(),
  '<число>,0'
);
eq('розділ «Після аудиту»', [bp.afterAudit, parsePlan('## Після аудиту: порції\n').afterAudit].join(), 'false,true');
const it = (text) => [{ where: 'w', text }];
eq(
  'незаповнені місця',
  checkPlaces(it('<число> і <…> і `<число>` і <файл> і <br> і <!-- блок: x -->'), bp).join('|'),
  'незаповнене місце плану: «<число>» (×1; w)|незаповнене місце плану: «<…>» (×1; w)'
);
const claims = ['Аудит проведено', 'аудит CI зелений', 'CI `mistral-audit` pass (11s)', 'mistral-audit: success', 'Аудит PR #362 пройдено'];
const calm = ['Аудит ще не проведено.', 'Аудит не проведено', 'Після аудиту — порції', 'mistral-audit — джоба CI', 'Переаудит проведено'];
eq('твердження про аудит', claims.map((c) => checkAudit(it(c), bp, null, null).length).join(), '1,1,1,1,1');
eq('не твердження про аудит', calm.map((c) => checkAudit(it(c), bp, null, null).length).join(), '0,0,0,0,0');
const after = { ...bp, afterAudit: true };
eq(
  'після аудиту',
  [
    checkAudit(it('Аудит проведено'), after, null, null).length,
    checkAudit([], after, 'Аудит ще не проведено.', 'Аудит ще не проведено.').length,
  ].join(),
  '0,2'
);
eq('місце з --allow', checkPlaces(it('<число>'), bp, new Set(['<число>'])).length, 0);
const dup = parsePlan(
  `${BL.replace('<число>; команда', 'вказівка, що є і в блоці, і поза ним, тож це текст документа, а не вказівка')}- Рядків — вказівка, що є і в блоці, і поза ним, тож це текст документа, а не вказівка \`git checkout <файл>\`.\n`
);
eq('рядок блоку поза блоком — не вказівка', dup.instructions.length, 0);
eq(
  'вказівка дослівно',
  checkInstructions(it('- Перед відкриттям PR запустити звірку з планом і числа записати в опис PR, а не новим комітом. Так.'), bp).length,
  1
);

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
- Перед відкриттям PR запустити звірку з планом і числа записати в опис PR, а не новим комітом.
<!-- блок: rep -->
\`\`\`text
- Рядків — <число>; команда \`git checkout <файл>\`.
\`\`\`
`;
const plan = parsePlan(PLAN);
eq(
  'вказівки плану: без відповіді власника і термінів',
  plan.instructions.map((l) => l.slice(0, 12)).join('|'),
  'Звіт `docs/r|Після зупинк|PR у `main`.|Перед відкри'
);
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
    'docs/reports/t99-x.md': `# Т.99\n## Що зроблено\nПлітка «Стоп», гайдJFKів, зони немає, одна папка; seed 5 і \`seed\`, напис «Готово».\n\n${table}## Метрики\n- Рядків — <число>; команда \`git checkout <файл>\`.\nАудит проведено, mistral-audit pass.\n`,
    'docs/workflow.md': `${WF}- Т.99 (рішення власника «Так, усе збережено»): слово «зона» тут лише згадано; читання, зупинка, рядки лишаються.\n`,
    'src/b.ts': "// zupynky pislia kliku: status лишається\nexport const yakshchoStop = 'Стан\\nГравець';\n",
    'docs/glossary.md': `${glossary}| зона | зонд |\n| рядки | смуги |\n`,
  });
  writeFileSync(
    join(dir, '.git/body-bad.md'),
    'Власник: «Зупинити».\nВласник сказав «Що робить».\nЗупиняти треба.\n  Iter-Tag: iter-T.99\nЧисла — <…>.\n- Перед відкриттям PR запустити звірку з планом і числа записати в опис PR, а не новим комітом.\nАудит пройдено.\n'
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
    'схоже на трансліт: «pislia» — «після»|схоже на трансліт: «kliku» — «кліку»|Знахідок: 23.|' +
    'незаповнене місце плану: «<число>» (×1; docs/reports/t99-x.md:9)|незаповнене місце плану: «<…>» (×1; опис PR:5)|' +
    'твердження про аудит до аудиту: «Аудит проведено» (docs/reports/t99-x.md:10)|твердження про аудит до аудиту: «Аудит пройдено» (опис PR:7)|вказівку плану вставлено дослівно: «Перед відкриттям PR|' +
    'цитата власника не з плану: «Що робить» (опис PR:2)|схоже на трансліт: «yakshchoStop» — «якщо»|слово поза словником: «seed» — писати «сід» (×1;|' +
    'Заувага (повідомлення коміту, не виправити): слово поза словником: «зона»|' +
    'Заувага (повідомлення коміту, не виправити): слово поза словником: «сид»';
  for (const e of expected.split('|')) ok(`поганий PR: немає рядка «${e}» у виводі:\n${r1.stdout}`, r1.stdout.includes(e));
  const r1a = run(`--plan·${P}·--base·${base}·--head·${bad}·--allow·плітка·--allow·Так, усе збережено·--terms·.git/terms.md`);
  ok(
    `--allow прибирає слово і цитату, --terms додає «читання» (без назви й опису — 14 знахідок):\n${r1a.stdout}`,
    r1a.stdout.includes('Знахідок: 14.')
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
  // Після аудиту: «Аудит ще не проведено» у звіті — знахідка лише з --after-audit.
  const stale = commit('docs: аудит', {
    'docs/reports/t99-x.md': '# Т.99\n## Що зроблено\nПлитка «Стоп».\n## Межі\n## Метрики\n## Аудит\nАудит ще не проведено.\n',
  });
  eq('до аудиту «ще не проведено» — не знахідка', run(`--plan·${P}·--base·${base}·--head·${stale}`).status, 0);
  const r3 = run(`--after-audit·--plan·${P}·--base·${base}·--head·${stale}`); // прапорець без значення — і першим
  ok(
    `--after-audit: «ще не проведено» у звіті:\n${r3.stdout}`,
    r3.status === 1 && r3.stdout.includes('після аудиту у звіті лишилось') && r3.stdout.includes('аудит — після')
  );

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
