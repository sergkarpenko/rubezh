#!/usr/bin/env node
// scripts/audit-vibe-cli.mjs — проба аудиту PR через Mistral Vibe CLI (ADR-0102, Т.82).
// Викликає workflow `vibe-audit` (необов'язковий чек) трьома кроками:
//   node scripts/audit-vibe-cli.mjs --self-test  — самоперевірка чистих функцій, без мережі;
//   node scripts/audit-vibe-cli.mjs probe        — один прямий POST /v1/chat/completions ключем Vibe:
//                                                  код і тіло відповіді — у журнал і у файл для коментаря;
//   node scripts/audit-vibe-cli.mjs audit        — `vibe --prompt-file …` у копії репозиторію,
//                                                  знахідки з дослівною цитатою, коментар у PR «Аудит Vibe».
// Збій, 402 чи відповідь без JSON — коментар «Аудиту не було» з причиною і код 0: чек мерж не блокує.
// Знахідку, цитати якої немає ні у файлі на голові PR, ні в дифі, скрипт відкидає і називає в коментарі.
// Vibe 3.1.3 у неінтерактивному режимі не вимикає запис файлів ні `--enabled-tools`, ні `permission = "never"`
// (перевірено в Т.82 на підставному сервері): тому Vibe працює в копії, а цитати звіряються з оригіналом;
// у дочірнього процесу немає GITHUB_TOKEN, а ключ вирізається з усього, що йде в коментар.
import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';

export const MARKER = '<!-- vibe-audit -->';
const API_URL = 'https://api.mistral.ai/v1/chat/completions';
const PROBE_MODEL = 'mistral-large-latest';
const MAX_FINDINGS = 10;
const MAX_FIELD = 700;
const MIN_QUOTE = 6;
const SEVERITIES = ['висока', 'середня', 'низька'];
/** Межі прогону Vibe: ходи, ціна (орієнтовна, не стеля), час у секундах. */
export const LIMITS = { turns: 60, price: 2, seconds: 1500 };

export const cut = (s, n) => (String(s).length > n ? `${String(s).slice(0, n)}…` : String(s));

/** Вирізає секрети з тексту, що йде в журнал чи коментар. */
export function redact(s, secrets = []) {
  let out = String(s ?? '');
  for (const k of secrets) if (k && k.length >= 8) out = out.split(k).join('***');
  return out;
}

/** Текст для коментаря: без HTML-коментарів і масок, що ламають розмітку. */
export function safe(s) {
  return String(s ?? '')
    .replace(/<!--|-->/g, '')
    .replace(/@/g, '@​')
    .replace(/\r/g, '');
}

/** Промпт аудитора: інструкції англійською, знахідки українською. */
export function buildPrompt({ number, title, body, base, head, names }) {
  return `You are an independent auditor of pull request #${number} in the repository of the browser game «Рубіж».
You are NOT an executor: do not change, create or delete files, do not commit, do not push, do not open issues or PRs.
AGENTS.md is the repository rule book. Its roles «Vibe Work» and «Vibe Code» are historical (ADR-0100, ADR-0101);
in this run your only role is the PR auditor described here.

The working directory is a copy of the repository at the PR head ${head}. The PR base is ${base}.
See the change with \`git diff ${base}...${head}\` and \`git log --oneline ${base}..${head}\`.
Changed files: ${names.join(', ') || '(none)'}.
You may read any file, search with grep/git grep and run checks such as \`npm test\`, \`npx tsc --noEmit\`, \`npm run lint\`.
Dependencies are already installed. Rules for the project: AGENTS.md, docs/workflow.md (read only the parts you need:
the record of the step named in the PR and the lessons), docs/agents/*.md (practical advice, not rules), docs/adr/.

PR title: ${title}
PR description:
<<<
${body}
>>>

Look for: violations of AGENTS.md and docs/workflow.md; bugs and unhandled cases in the changed code; claims in the PR
description, reports or ADRs that the repository does not support (numbers, file names, commands); missing tests;
contradictions between changed documents. Verify every finding yourself with a command before you report it.

Answer with at most ${MAX_FINDINGS} findings, most important first. Write the finding texts in Ukrainian.
Each finding MUST cite a verbatim quote (one line or part of a line, at least ${MIN_QUOTE} characters) copied exactly
from the file at the PR head or from the diff; findings whose quote is not found are discarded automatically.
End your answer with exactly one fenced block in this format and nothing after it:
\`\`\`json
{"summary": "one or two Ukrainian sentences", "findings": [{"severity": "висока|середня|низька",
 "file": "path/from/repo/root", "line": 1, "quote": "exact text", "text": "Ukrainian: what is wrong and how you verified it"}]}
\`\`\`
If there is nothing to report, return "findings": [].`;
}

/** Останній блок ```json … ``` з відповіді (або останній об'єкт з ключем findings). */
export function extractFindings(text) {
  const t = String(text ?? '');
  const blocks = [...t.matchAll(/```json\s*([\s\S]*?)```/g)].map((m) => m[1]);
  const candidates = blocks.length ? blocks.reverse() : [t.slice(t.lastIndexOf('{"summary"'))];
  for (const c of candidates) {
    try {
      const j = JSON.parse(c.trim());
      if (j && Array.isArray(j.findings)) return { ok: true, summary: String(j.summary ?? ''), findings: j.findings };
    } catch {
      /* наступний кандидат */
    }
  }
  return { ok: false, reason: 'у відповіді Vibe немає блоку JSON зі знахідками' };
}

const norm = (s) => String(s).replace(/\s+/g, ' ').trim();

/** Залишає знахідки з цитатою у файлі на голові PR або в дифі; решту — у dropped з причиною. */
export function verifyFindings(findings, { readFile, diff }) {
  const kept = [];
  const dropped = [];
  const nd = norm(diff);
  for (const f of findings.slice(0, MAX_FINDINGS)) {
    const file = String(f?.file ?? '');
    const quote = String(f?.quote ?? '');
    const bad = (reason) => dropped.push({ file, reason });
    if (!f || typeof f !== 'object' || !f.text) bad('немає тексту знахідки');
    else if (norm(quote).length < MIN_QUOTE) bad('немає цитати');
    else if (!file || isAbsolute(file) || file.split('/').includes('..')) bad('шлях поза репозиторієм');
    else {
      const content = readFile(file);
      const inFile = content !== null && norm(content).includes(norm(quote));
      if (inFile || nd.includes(norm(quote))) kept.push({ ...f, where: inFile ? 'файл' : 'диф' });
      else bad(content === null ? 'файла немає на голові PR' : 'цитати немає ні у файлі, ні в дифі');
    }
  }
  if (findings.length > MAX_FINDINGS) dropped.push({ file: '', reason: `понад ${MAX_FINDINGS} знахідок` });
  return { kept, dropped };
}

export function renderComment(r) {
  const head = `${MARKER}\n### Аудит Vibe (Mistral Vibe CLI${r.model ? `, ${safe(r.model)}` : ''}) — проба ADR-0102\n\n`;
  const probe = r.probe ? `Прямий виклик API ключем Vibe: ${safe(cut(r.probe, 400))}\n\n` : '';
  const usage = r.usage
    ? `\n\n<sub>${safe(r.usage)}. Знахідки — пропозиції: перевірити, підтверджені виправити, відхилені перелічити з причиною в описі PR.</sub>`
    : '';
  if (!r.ok) return `${head}${probe}**Аудиту не було:** ${safe(cut(r.reason, 600))}.${usage}`;
  const list = r.kept.length
    ? r.kept
        .map((f, i) => {
          const sev = SEVERITIES.includes(f.severity) ? f.severity : 'низька';
          const line = Number.isInteger(f.line) ? `:${f.line}` : '';
          const q = safe(cut(norm(f.quote), 300)).replace(/`/g, "'");
          return `${i + 1}. **${sev}** — \`${safe(cut(f.file, 200))}${line}\` (цитата з: ${f.where}): \`${q}\`\n   ${safe(cut(f.text, MAX_FIELD))}`;
        })
        .join('\n')
    : 'Знахідок немає.';
  const drop = r.dropped.length
    ? `\n\nВідкинуто скриптом (${r.dropped.length}): ${r.dropped.map((d) => `${safe(cut(d.file || '—', 120))} — ${d.reason}`).join('; ')}.`
    : '';
  const summary = r.summary ? `${safe(cut(r.summary, MAX_FIELD))}\n\n` : '';
  return `${head}${probe}${summary}${list}${drop}${usage}`;
}

/** Рядок про прогін з export.json Vibe. */
export function usageLine(exp, code) {
  if (!exp) return `код виходу vibe ${code}, export.json немає`;
  const u = exp.usage ?? {};
  const cost = typeof exp.cost_usd === 'number' ? `$${exp.cost_usd.toFixed(4)}` : '?';
  return `vibe ${exp.vibe_version ?? '?'}, код ${code}, результат ${exp.outcome ?? '?'}${exp.stop_reason ? ` (${exp.stop_reason})` : ''}, кроків ${exp.steps ?? '?'}; токени: ввід ${u.input_tokens ?? '?'} (з кешу ${u.cached_input_tokens ?? '?'}), вивід ${u.output_tokens ?? '?'}; ціна за Vibe ${cost}`;
}

export async function probe({ fetch, key, log }) {
  if (!key) return 'секрету MISTRAL_VIBE_API_KEY немає';
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: PROBE_MODEL, max_tokens: 8, messages: [{ role: 'user', content: 'Reply: ok' }] }),
    });
    const text = redact(await res.text(), [key]);
    log(`audit-vibe-cli probe: ${res.status} — ${cut(text, 600)}`);
    return res.ok ? `${res.status} — ключ працює поза Vibe` : `${res.status} — ${cut(text.replace(/\s+/g, ' '), 300)}`;
  } catch (e) {
    return `помилка мережі: ${cut(redact(e.message, [key]), 200)}`;
  }
}

async function github(fetch, token, method, path, body) {
  const res = await fetch(`https://api.github.com/${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`GitHub ${method} ${path}: ${res.status} ${cut(await res.text(), 200)}`);
  return res.status === 204 ? null : res.json();
}

async function upsertComment(fetch, token, repo, number, body) {
  const all = await github(fetch, token, 'GET', `repos/${repo}/issues/${number}/comments?per_page=100`);
  const mine = all.find((c) => c.user?.login === 'github-actions[bot]' && c.body?.includes(MARKER));
  if (mine) await github(fetch, token, 'PATCH', `repos/${repo}/issues/comments/${mine.id}`, { body });
  else await github(fetch, token, 'POST', `repos/${repo}/issues/${number}/comments`, { body });
}

export async function audit({ env, fetch, log }) {
  const repo = env.GITHUB_REPOSITORY;
  const token = env.GITHUB_TOKEN;
  const key = env.MISTRAL_API_KEY;
  const root = resolve(env.GITHUB_WORKSPACE ?? '.');
  const work = env.VIBE_WORKDIR;
  const outDir = env.VIBE_OUTPUT_DIR;
  const model = env.VIBE_MODEL || 'mistral-large-4-0';
  const number = Number(env.PR_NUMBER);
  const pr = await github(fetch, token, 'GET', `repos/${repo}/pulls/${number}`);
  const probeFile = join(outDir, 'probe.txt');
  const probeLine = existsSync(probeFile) ? readFileSync(probeFile, 'utf8').trim() : '';
  const say = async (r) => {
    const text = redact(renderComment({ ...r, model, probe: probeLine }), [key]);
    await upsertComment(fetch, token, repo, number, text);
    log(text);
  };
  if (!key) return say({ ok: false, reason: 'секрету MISTRAL_VIBE_API_KEY немає' });
  const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 });
  const base = pr.base.sha;
  const headSha = pr.head.sha;
  const names = git('diff', '--name-only', `${base}...${headSha}`).split('\n').filter(Boolean);
  const diff = git('diff', `${base}...${headSha}`);
  const promptFile = join(outDir, 'prompt.md');
  writeFileSync(promptFile, buildPrompt({ number, title: pr.title, body: pr.body ?? '', base, head: headSha, names }));
  const childEnv = { ...env };
  delete childEnv.GITHUB_TOKEN;
  delete childEnv.ACTIONS_RUNTIME_TOKEN;
  const args = [
    '--workdir',
    work,
    '--prompt-file',
    promptFile,
    '--output',
    'text',
    '--output-dir',
    outDir,
    '--model',
    model,
    '--thinking',
    env.VIBE_THINKING || 'medium',
    '--max-turns',
    String(LIMITS.turns),
    '--max-price',
    String(LIMITS.price),
    '--time-limit',
    String(LIMITS.seconds),
    '--trust',
    '--auto-approve',
  ];
  log(`audit-vibe-cli: vibe ${args.join(' ')}`);
  const run = spawnSync('vibe', args, { env: childEnv, encoding: 'utf8', maxBuffer: 64 << 20, timeout: (LIMITS.seconds + 120) * 1000 });
  const code = run.status ?? -1;
  const expFile = join(outDir, 'export.json');
  const exp = existsSync(expFile) ? JSON.parse(readFileSync(expFile, 'utf8')) : null;
  const usage = usageLine(exp, code);
  log(redact(`audit-vibe-cli: ${usage}\nstderr: ${cut(run.stderr ?? '', 3000)}`, [key]));
  if (code !== 0 && code !== 3) {
    const reason = exp?.error?.message ?? (run.error?.message || cut(run.stderr ?? '', 400) || `код ${code}`);
    return say({ ok: false, reason: `Vibe CLI завершився з кодом ${code}: ${redact(reason, [key])}`, usage });
  }
  const parsed = extractFindings(run.stdout);
  if (!parsed.ok) return say({ ok: false, reason: parsed.reason, usage });
  const readFile = (f) => (existsSync(join(root, f)) ? readFileSync(join(root, f), 'utf8') : null);
  const { kept, dropped } = verifyFindings(parsed.findings, { readFile, diff });
  return say({ ok: true, summary: parsed.summary, kept, dropped, usage });
}

function selfTest() {
  let errors = 0;
  const check = (name, cond) => {
    if (!cond) errors++;
    console.log(`${cond ? 'ok ' : 'ПОМИЛКА'} ${name}`);
  };
  const reply =
    'текст\n```json\n{"summary":"s","findings":[]}\n```\nще\n```json\n{"summary":"Підсумок","findings":[{"severity":"висока","file":"a.ts","line":2,"quote":"const  x = 1","text":"т"}]}\n```';
  const ex = extractFindings(reply);
  check('береться останній блок JSON', ex.ok && ex.summary === 'Підсумок' && ex.findings.length === 1);
  check('без JSON — причина', !extractFindings('нічого').ok);
  check('зіпсований JSON — причина', !extractFindings('```json\n{"findings": [\n```').ok);
  const files = { 'a.ts': 'let y;\nconst x = 1;\n' };
  const readFile = (f) => files[f] ?? null;
  const mk = (o) => ({ severity: 'середня', file: 'a.ts', line: 1, quote: 'const x = 1', text: 'т', ...o });
  const v = verifyFindings(
    [
      mk({}),
      mk({ quote: 'const x = 2' }),
      mk({ file: 'b.ts', quote: '+ new line' }),
      mk({ file: 'c.ts' }),
      mk({ quote: 'x' }),
      mk({ file: '../etc/passwd' }),
      mk({ text: '' }),
    ],
    { readFile, diff: '+ new   line\n' }
  );
  check('цитата у файлі (пробіли нормалізовано) — лишається', v.kept[0]?.where === 'файл');
  check('цитата з дифа — лишається', v.kept[1]?.where === 'диф' && v.kept.length === 2);
  check(
    'вигадана цитата — відкинуто',
    v.dropped.some((d) => d.reason.startsWith('цитати немає'))
  );
  check(
    'файла немає — відкинуто',
    v.dropped.some((d) => d.file === 'c.ts' && d.reason.startsWith('файла немає'))
  );
  check('коротка цитата, шлях з .., без тексту — відкинуто', v.dropped.length === 5);
  const many = verifyFindings(
    Array.from({ length: 12 }, () => mk({})),
    { readFile, diff: '' }
  );
  check(`понад ${MAX_FINDINGS} — обрізано і названо`, many.kept.length === 10 && many.dropped.length === 1);
  check('ключ вирізано', redact('a sk-12345678 b sk-12345678', ['sk-12345678']) === 'a *** b ***');
  check('короткий «секрет» не ріже текст', redact('abc', ['ab']) === 'abc');
  const c = renderComment({ ok: true, summary: 's', kept: v.kept, dropped: v.dropped, usage: 'u', probe: '402 — x', model: 'm' });
  check(
    'коментар має маркер, пробу, знахідки і відкинуті',
    c.startsWith(MARKER) && c.includes('402 — x') && c.includes('Відкинуто скриптом (5)')
  );
  check(
    'HTML-коментар у тексті знахідки знешкоджено',
    !renderComment({ ok: false, reason: '<!-- x -->' }).slice(MARKER.length).includes('<!--')
  );
  check('збій — «Аудиту не було»', renderComment({ ok: false, reason: 'код 2' }).includes('**Аудиту не було:** код 2'));
  check(
    'рядок прогону з export.json',
    usageLine({ usage: { input_tokens: 5 }, cost_usd: 0.5, outcome: 'finished', steps: 3 }, 0).includes('$0.5000')
  );
  check('рядок прогону без export.json', usageLine(null, 2).includes('export.json немає'));
  const p = buildPrompt({ number: 1, title: 't', body: 'b', base: 'B', head: 'H', names: ['x.ts'] });
  check(
    'промпт: диф base...head, роль аудитора, формат JSON',
    p.includes('git diff B...H') && p.includes('NOT an executor') && p.includes('"findings"')
  );
  console.log(`audit-vibe-cli self-test: помилок ${errors}`);
  return errors;
}

const mode = process.argv[2];
if (mode === '--self-test') process.exit(selfTest() ? 1 : 0);
else if (mode === 'probe') {
  const line = await probe({ fetch, key: process.env.MISTRAL_API_KEY, log: console.log });
  mkdirSync(process.env.VIBE_OUTPUT_DIR, { recursive: true });
  writeFileSync(join(process.env.VIBE_OUTPUT_DIR, 'probe.txt'), line);
  console.log(`audit-vibe-cli probe: ${line}`);
} else if (mode === 'audit') {
  try {
    await audit({ env: process.env, fetch, log: console.log });
  } catch (e) {
    // коментар не вдалося записати чи PR не прочитано — у журнал; чек лишається зеленим
    console.log(`audit-vibe-cli: ${redact(e.message, [process.env.MISTRAL_API_KEY])}`);
  }
}
