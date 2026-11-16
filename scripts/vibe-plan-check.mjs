#!/usr/bin/env node
// Звірка PR виконавця з планом кроку (кандидат 58, Т.54); план — docs/plans/tNN-*.md за шаблоном TEMPLATE-vibe.md.
// Перевіряє те, чого шаблон сам не втримав у Т.51 і Т.53: назву PR і рядок Iter-Tag; відповіді власника дослівно
// і цитати власника, яких у плані немає; розділи звіту; у доданих рядках — слова, заборонені планом чи анти-глосарієм
// («зона» замість «зонд»), імовірні одруківки слів плану («плітка»), трансліт і мішанину латинки з кирилицею.
// Запуск: node scripts/vibe-plan-check.mjs --plan docs/plans/tNN-x.md [--base origin/main] [--head HEAD]
//   [--pr N | --title "…" --body-file файл] [--terms файл.md]… [--allow "слово чи цитата"]…
// Код виходу: 0 — знахідок немає, 1 — є, 2 — помилка запуску. Нічого не пише на диск. Знахідка — підказка
// читачеві, а не вирок: слово чи цитату, що лишається свідомо, називає --allow.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CYR = 'А-Яа-яІіЇїЄєҐґ';
const WORD = new RegExp(`[A-Za-z${CYR}]+`, 'g');
const HAS_CYR = new RegExp(`[${CYR}]`);
const lower = (s) => s.toLocaleLowerCase('uk');
const norm = (s) => s.replace(/\s+/g, ' ').trim();

/** Розділ плану: від заголовка другого рівня, що відповідає re, до наступного такого заголовка. */
export function section(plan, re) {
  const lines = plan.split('\n');
  const i = lines.findIndex((l) => /^## /.test(l) && re.test(l));
  if (i < 0) return '';
  let j = i + 1;
  while (j < lines.length && !/^## /.test(lines[j])) j++;
  return lines.slice(i, j).join('\n');
}

/** Зовнішні цитати «…» з урахуванням вкладених: [{ text, start }]. */
export function quotes(text) {
  const out = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '«') {
      if (depth++ === 0) start = i;
    } else if (text[i] === '»' && depth > 0 && --depth === 0) out.push({ text: text.slice(start + 1, i), start });
  }
  return out;
}

/** Усі цитати тексту на всіх рівнях вкладення, без зайвих пробілів. */
const allQuotes = (text) => quotes(text).flatMap((q) => [norm(q.text), ...allQuotes(q.text)]);

/** Пари «не писати → писати» з розділу термінів плану: **слово** (не «хибне», не «хибне2»). */
export function parseTerms(text) {
  const terms = [];
  for (const m of text.matchAll(/\*\*([^*]+)\*\*\s*\(([^)]*)\)/g)) {
    const good = lower(m[1].replace(/[«»]/g, ''));
    for (const q of quotes(m[2])) if (/(^|[\s,;])не $/.test(m[2].slice(0, q.start))) terms.push({ bad: lower(q.text), good });
  }
  return terms;
}

/** Пари з таблиці «Анти-глосарій» docs/glossary.md: лише точні форми. */
export function parseAntiGlossary(text) {
  const terms = [];
  for (const line of section(text, /Анти-глосарій/).split('\n')) {
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length < 4 || /^-+$/.test(cells[1]) || cells[1] === 'Не пишемо') continue;
    for (const bad of cells[1].split(/\s*[/,]\s*/)) if (bad) terms.push({ bad: lower(bad), good: cells[2], exact: true });
  }
  return terms;
}

/** Що план вимагає дослівно: назва PR, рядок тегу, відповіді власника, звіт і його розділи, терміни, слова. */
export function parsePlan(plan) {
  const owner = section(plan, /Відповід\S* власника/);
  const report = plan.match(/Звіт `([^`]+)`([^\n]*)/);
  const listed = report?.[2].match(/з розділами:(.*?)(\*\*Жодного|$)/);
  return {
    title: section(plan, /^## PR/).match(/[Нн]азва[^`\n]*`([^`\n]+)`/)?.[1] ?? null,
    iterTag: plan.match(/^Iter-Tag: \S+$/m)?.[0] ?? null,
    answers: [...owner.matchAll(/\*\*«(.+?)»\*\*/g)].map((m) => m[1]),
    hasOwner: owner !== '',
    reportPath: report?.[1] ?? null,
    reportSections: listed ? quotes(listed[1]).map((q) => q.text) : [],
    terms: parseTerms(section(plan, /Терміни гри/)),
    words: new Set((plan.match(WORD) ?? []).filter((w) => HAS_CYR.test(w)).map(lower)),
    quotes: new Set(allQuotes(plan)),
    heads: plan.split('\n').filter((l) => /^#+ /.test(l)),
  };
}

const stem = (s) => {
  const t = s.replace(/[аеиіоуюяьй]+$/, '');
  return t.length >= 3 ? t : s;
};
/** Чи є слово w формою забороненого терміна (за основою), але не формою правильного. */
export function matchesBad(w, term) {
  if (term.exact) return w === term.bad;
  const sb = stem(term.bad);
  if (!w.startsWith(sb) || w.length > sb.length + (sb.length < 4 ? 2 : 3)) return false;
  return !w.startsWith(stem(term.good));
}

const TR = { а: 'a', б: 'b', в: 'v', г: 'h', ґ: 'g', д: 'd', е: 'e', є: 'ie', ж: 'zh', з: 'z', и: 'y', і: 'i', ї: 'i', й: 'i', к: 'k' };
Object.assign(TR, { л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch' });
Object.assign(TR, { ш: 'sh', щ: 'shch', ь: '', ю: 'iu', я: 'ia' });
const POPULAR = { є: 'ye', ї: 'yi', й: 'y', ю: 'yu', я: 'ya' };
const ALT = [{}, POPULAR, { ...POPULAR, г: 'g', и: 'i', х: 'h' }];
/** Варіанти запису кириличного слова латинкою (офіційний, побутовий, «з російської»). */
export const translit = (w) => ALT.map((alt) => [...lower(w)].map((c) => alt[c] ?? TR[c] ?? '').join(''));
// Службові слова, які в трансліті трапляються завжди, навіть коли слів плану в рядку немає.
const COMMON = 'якщо що цей для після коли немає треба можна буде тільки лише також кожен перед потім зміни рішення власник';

const VOWELS = 'аеєиіїоуюя';
/** Одруківка слова плану: та сама довжина, одна голосна замінена іншою, не в закінченні. */
function typoOf(w, planWords) {
  for (const p of planWords) {
    if (p.length !== w.length) continue;
    let diff = -1;
    for (let i = 0; i < w.length && diff !== -2; i++) if (w[i] !== p[i]) diff = diff === -1 ? i : -2;
    if (diff >= 0 && diff < w.length - 2 && VOWELS.includes(w[diff]) && VOWELS.includes(p[diff])) return p;
  }
  return null;
}

/**
 * Слова в доданих рядках. items — [{ where, text, md }]; vocab — { cyr, lat }: слова бази;
 * terms — заборонені пари; allow — слова (малими), які лишаються свідомо. Повертає знахідки з лічильником.
 */
export function checkWords(items, plan, vocab, terms, allow = new Set()) {
  const found = new Map();
  const add = (kind, word, note, where) => {
    const key = `${kind}|${lower(word)}`;
    const f = found.get(key) ?? found.set(key, { kind, word, note, where, count: 0 }).get(key);
    f.count++;
  };
  const tr = new Map();
  for (const w of [...plan.words, ...COMMON.split(' ')]) if (w.length >= 4) for (const t of translit(w)) if (t.length >= 5) tr.set(t, w);
  for (const { where, text, md } of items) {
    const clean = text.replace(/\\[nrtu]/g, '  ');
    const prose = md ? clean.replace(/`[^`]*`/g, (m) => ' '.repeat(m.length)) : clean;
    for (const m of clean.matchAll(WORD)) {
      const [t] = m;
      const w = lower(t);
      if (allow.has(w)) continue;
      const cyr = HAS_CYR.test(t);
      if (cyr && /[A-Za-z]/.test(t)) {
        add('мішанина латинки й кирилиці', t, '', where);
      } else if (cyr) {
        if (clean[m.index - 1] === '«' && clean[m.index + t.length] === '»') continue; // слово в лапках — згадка, а не вжиток
        const term = terms.find((x) => HAS_CYR.test(x.bad) && matchesBad(w, x));
        if (term) add('слово поза словником', t, `писати «${term.good}»`, where);
        else if (w.length >= 5 && !vocab.cyr.has(w) && !plan.words.has(w)) {
          const p = typoOf(w, plan.words);
          if (p) add('можлива одруківка', t, `у плані «${p}»`, where);
        }
      } else if (prose.slice(m.index, m.index + t.length) === t) {
        const term = md && terms.find((x) => !HAS_CYR.test(x.bad) && x.bad === w);
        if (term) add('слово поза словником', t, `писати «${term.good}»`, where);
        for (const part of new Set([w, ...t.split(/(?=[A-Z])/).map(lower)])) {
          if (part.length >= 5 && tr.has(part) && !vocab.lat.has(part)) add('схоже на трансліт', t, `«${tr.get(part)}»`, where);
        }
      }
    }
  }
  return [...found.values()].map((f) => `${f.kind}: «${f.word}»${f.note ? ` — ${f.note}` : ''} (×${f.count}; ${f.where})`);
}

/** Цитати, приписані власникові (маркер перед цитатою або клітинка таблиці відповідей), яких серед цитат плану немає. */
export function checkOwnerQuotes(items, plan, allow = new Set()) {
  const out = [];
  let table = false;
  let prev = '';
  for (const { where, text } of items) {
    const row = text.trimStart().startsWith('|');
    if (row && !prev.trimStart().startsWith('|')) table = /власник|[Вв]ідповід/.test(text);
    if (!row) table = false;
    prev = text;
    for (const q of quotes(text)) {
      const before = text.slice(Math.max(0, q.start - 30), q.start);
      const marked = /([Вв]ласник|[Вв]ідпов)[^«»|]*$/.test(before) || (table && /\|\s*$/.test(before));
      const t = norm(q.text);
      const known = plan.quotes.has(t) || plan.heads.some((h) => h.replace(/^#+ /, '').startsWith(t)); // цитата або назва розділу плану
      if (marked && !known && !allow.has(lower(t))) out.push(`цитата власника не з плану: «${t}» (${where})`);
    }
  }
  return [...new Set(out)];
}

/** Назва PR, рядок тегу і дослівні відповіді власника в описі PR. */
export function checkPr(plan, title, body) {
  const out = [];
  if (title !== null) {
    if (plan.title === null) out.push('назва PR: у плані немає рядка «Назва … `…`» у розділі «PR» — звірити нема з чим');
    else if (title !== plan.title) out.push(`назва PR не збігається з планом: є «${title}», у плані «${plan.title}»`);
  }
  if (body !== null) {
    if (plan.iterTag && !body.split(/\r?\n/).includes(plan.iterTag)) out.push(`в описі PR немає рядка «${plan.iterTag}» з початку рядка`);
    for (const a of plan.answers) if (!norm(body).includes(`«${a}»`)) out.push(`в описі PR немає відповіді власника дослівно: «${a}»`);
  }
  return out;
}

/** Розділи звіту з переліку плану і відповіді власника в документах кроку. */
export function checkReport(plan, report, docsText) {
  const out = [];
  if (plan.reportPath === null) return ['звіт: у плані немає рядка «Звіт `шлях`» — звірити нема з чим'];
  if (report === null) return [`звіту ${plan.reportPath} немає`];
  const heads = report
    .split('\n')
    .filter((l) => /^##+ /.test(l))
    .map((l) => l.replace(/^##+ /, ''));
  for (const s of plan.reportSections) if (!heads.some((h) => h.startsWith(s))) out.push(`у звіті немає розділу «${s}»`);
  const all = norm(`${report}\n${docsText}`);
  for (const a of plan.answers) if (!all.includes(`«${a}»`)) out.push(`у звіті й записі кроку немає відповіді власника дослівно: «${a}»`);
  return out;
}

// Поза дифом: план і шаблон самі називають заборонені слова, словник — теж.
const EXCLUDE = [':(exclude)docs/plans', ':(exclude)docs/glossary.md'];
const USAGE =
  'Запуск: node scripts/vibe-plan-check.mjs --plan docs/plans/tNN-x.md [--base origin/main] [--head HEAD] [--pr N | --title "…" --body-file файл] [--terms файл.md]… [--allow "слово чи цитата"]…';

function main(argv) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const opt = { base: 'origin/main', head: 'HEAD', terms: [], allow: [] };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (argv[i] === '--help' && argv.length === 1) return (console.log(USAGE), 0);
    if (
      !['plan', 'base', 'head', 'pr', 'title', 'bodyFile', 'terms', 'allow'].includes(key) ||
      !argv[i].startsWith('--') ||
      argv[i + 1] === undefined
    ) {
      return (console.log(`Невідомий або неповний аргумент: ${argv[i]}\n${USAGE}`), 2);
    }
    if (Array.isArray(opt[key])) opt[key].push(argv[i + 1]);
    else opt[key] = argv[i + 1];
  }
  if (!opt.plan) return (console.log(USAGE), 2);
  if (opt.pr && !/^\d+$/.test(opt.pr)) return (console.log(`--pr: потрібен номер, є «${opt.pr}»`), 2);
  const git = (args, okCodes = [0]) => {
    try {
      return execFileSync('git', ['-C', root, ...args], {
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      if (okCodes.includes(e.status)) return e.stdout ?? '';
      throw new Error(
        `git ${args.join(' ')}: ${
          String(e.stderr ?? e.message)
            .trim()
            .split('\n')[0]
        }`
      );
    }
  };
  // Файла в ревізії немає — null; будь-яка інша помилка git — помилка запуску, а не «немає».
  const show = (rev, path) => (git(['ls-tree', '--name-only', rev, '--', path]).trim() ? git(['show', `${rev}:${path}`]) : null);
  git(['rev-parse', '--verify', `${opt.base}^{commit}`]);
  git(['rev-parse', '--verify', `${opt.head}^{commit}`]);
  const planText = show(opt.head, opt.plan);
  if (planText === null) throw new Error(`плану ${opt.plan} немає в ${opt.head}`);
  const plan = parsePlan(planText);
  const terms = [...plan.terms, ...parseAntiGlossary(show(opt.base, 'docs/glossary.md') ?? '')];
  for (const f of opt.terms) terms.push(...parseTerms(section(readFileSync(resolve(process.cwd(), f), 'utf8'), /Терміни гри/)));
  const allow = new Set(opt.allow.map((a) => lower(norm(a))));

  const items = [];
  let file = '';
  let line = 0;
  // Диф — від спільного предка (як `база...гілка`): інакше рядки, змінені в базі після відгалуження, вийшли б «доданими».
  let from = opt.base;
  try {
    from = git(['merge-base', opt.base, opt.head]).trim();
  } catch {
    console.log('Увага: спільного предка не знайдено (мілкий клон?) — диф рахується прямо від бази');
  }
  const diff = git(['-c', 'core.quotePath=false', 'diff', '--unified=0', '--no-color', from, opt.head, '--', '.', ...EXCLUDE]);
  for (const l of diff.split('\n')) {
    if (l.startsWith('+++ ')) file = l.slice(6).replace(/\t$/, '');
    else if (l.startsWith('@@')) line = Number(l.match(/\+(\d+)/)[1]);
    else if (l.startsWith('+')) items.push({ where: `${file}:${line++}`, text: l.slice(1), md: file.endsWith('.md'), file });
  }
  const commits = git(['log', '--no-merges', '--format=%h%x09%s %b%x00', `${from}..${opt.head}`]).split('\0');
  const messages = commits
    .map((c) => c.trim().split('\t'))
    .filter((c) => c.length === 2)
    .map(([h, text]) => ({ where: `коміт ${h}`, text: norm(text), md: true }));

  // Слова бази: усе, що вже є в репозиторії, одруківкою чи транслітом не вважається. Свої файли скрипт
  // пропускає: самоперевірка тримає хибні слова без лапок.
  const paths = ['src', 'scripts', 'e2e', 'docs', 'index.html', '*.md', ':(exclude)scripts/vibe-plan-check*'];
  const baseText = git(['grep', '-hI', '-e', '', opt.base, '--', ...paths], [0, 1]);
  const vocab = { cyr: new Set(), lat: new Set() };
  for (const m of baseText.matchAll(WORD)) {
    const [t] = m;
    if (baseText[m.index - 1] === '«' && baseText[m.index + t.length] === '»') continue; // згадка в лапках — не слово бази
    if (HAS_CYR.test(t)) vocab.cyr.add(lower(t));
    else for (const part of [t, ...t.split(/(?=[A-Z])/)]) vocab.lat.add(lower(part));
  }

  let title = opt.title ?? null;
  let body = opt.bodyFile ? readFileSync(resolve(process.cwd(), opt.bodyFile), 'utf8') : null;
  if (opt.pr) {
    const pr = JSON.parse(
      execFileSync('gh', ['api', `repos/sergkarpenko/rubezh/pulls/${opt.pr}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    );
    title ??= pr.title;
    body ??= pr.body ?? '';
  }
  const docs = items.filter((x) => x.md);
  const bodyItems = (body ?? '').split(/\r?\n/).map((text, i) => ({ where: `опис PR:${i + 1}`, text, md: true }));
  const titleItems = title === null ? [] : [{ where: 'назва PR', text: title, md: true }];
  const report = plan.reportPath ? show(opt.head, plan.reportPath) : null;
  const record = items
    .filter((x) => x.file === 'docs/workflow.md')
    .map((x) => x.text)
    .join('\n');
  const findings = [
    ...checkPr(plan, title, body),
    ...(plan.hasOwner ? [] : ['у плані немає розділу «Відповідь власника» — цитати звірити нема з чим']),
    ...checkOwnerQuotes([...items, ...bodyItems], plan, allow),
    ...checkReport(plan, report, record),
    ...checkWords([...items, ...bodyItems, ...titleItems], plan, vocab, terms, allow),
  ];
  // Повідомлення комітів виправити не можна (історію не переписуємо) — це зауваги, код виходу вони не міняють.
  const notes = checkWords(messages, plan, vocab, terms, allow);
  console.log(
    `План: ${opt.plan}; диф ${opt.base}..${opt.head}: доданих рядків ${items.length} (з них документів ${docs.length}), комітів ${messages.length}.`
  );
  console.log(
    `Звірено: назва PR — ${title === null ? 'ні (не задано)' : 'так'}; опис PR — ${body === null ? 'ні (не задано)' : 'так'}; розділів звіту в плані — ${plan.reportSections.length}; відповідей власника — ${plan.answers.length}; заборонених слів — ${terms.length}.`
  );
  findings.forEach((f, i) => console.log(`${i + 1}. ${f}`));
  notes.forEach((f) => console.log(`Заувага (повідомлення коміту, не виправити): ${f}`));
  console.log(findings.length ? `Знахідок: ${findings.length}.` : 'Знахідок немає.');
  return findings.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (e) {
    console.log(`Помилка запуску: ${e.message}`);
    process.exit(2);
  }
}
