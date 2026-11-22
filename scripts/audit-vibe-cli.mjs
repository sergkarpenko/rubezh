#!/usr/bin/env node
// scripts/audit-vibe-cli.mjs — аудит PR через Mistral Vibe CLI (проба ADR-0102, Т.82; з Т.87 — єдиний аудитор Mistral, ADR-0104).
// Викликає workflow `vibe-audit` (необов'язковий чек) двома кроками — `--self-test` і `audit` (ADR-0104):
//   node scripts/audit-vibe-cli.mjs --self-test  — самоперевірка чистих функцій, без мережі;
//   node scripts/audit-vibe-cli.mjs probe        — лише вручну (з Т.87 workflow не викликає), зі змінними
//                                                  MISTRAL_API_KEY (і VIBE_OUTPUT_DIR — туди probe.txt): прямий POST
//                                                  /v1/chat/completions ключем Vibe — код і тіло відповіді;
//   node scripts/audit-vibe-cli.mjs audit        — `vibe --prompt-file …` у копії репозиторію,
//                                                  знахідки з дослівною цитатою, коментар у PR «Аудит Vibe».
// Відповідь без блоку JSON — один повтор у тій самій сесії (`--resume <session_id>` з export.json, ADR-0105):
// «поверни лише блок JSON» з короткими межами RETRY; і після повтору без JSON — «Аудиту не було».
// Збій, 402 чи відповідь без JSON — коментар «Аудиту не було» з причиною і код 0: чек мерж не блокує.
// Знахідку, цитати якої немає ні у файлі на голові PR, ні в дифі, скрипт відкидає і називає в коментарі.
// Vibe 3.1.3: `--disabled-tools write_file/edit` діє лише разом з `--auto-approve`, а `bash` (потрібен для пошуку
// і тестів) пише куди завгодно — тому Vibe працює в копії, а вміст файлів для цитат скрипт бере з об'єктів коміту
// голови PR; у дочірнього процесу немає GITHUB_TOKEN, ключ вирізається з усього, що йде в коментар і журнал.
// Це захист від випадкових правок, а не від зловмисного PR: ключ Vibe видно з `bash` (ADR-0102 п. 5).
import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MARKER = '<!-- vibe-audit -->';
const API_URL = 'https://api.mistral.ai/v1/chat/completions';
const PROBE_MODEL = 'mistral-large-latest';
const MAX_FINDINGS = 10;
const MAX_FIELD = 700;
const MIN_QUOTE = 6;
const SEVERITIES = ['висока', 'середня', 'низька'];
/** Межі прогону Vibe: ходи, ціна (орієнтовна, не стеля), час у секундах. */
export const LIMITS = { turns: 60, price: 2, seconds: 1500 };
/** Межі повтору «лише блок JSON» (ADR-0105): два ходи — на випадок, якщо модель ще раз викличе інструмент; ціна — не стеля. */
export const RETRY = { turns: 2, price: 0.5, seconds: 300 };

export const cut = (s, n) => (String(s).length > n ? `${String(s).slice(0, n)}…` : String(s));

/** Вирізає секрети з тексту, що йде в журнал чи коментар. */
export function redact(s, secrets = []) {
  let out = String(s ?? '');
  for (const k of secrets) if (k && k.length >= 8) out = out.split(k).join('***');
  return out;
}

/** Вирізає секрети з усіх рядків об'єкта — до будь-якого cut, щоб на межі обрізання не лишився початок ключа. */
export function scrub(v, secrets = []) {
  if (typeof v === 'string') return redact(v, secrets);
  if (Array.isArray(v)) return v.map((x) => scrub(x, secrets));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrub(x, secrets)]));
  return v;
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

/** Промпт повтору в тій самій сесії Vibe, коли відповідь без блоку JSON (ADR-0105). */
export function retryPrompt() {
  return `Your previous answer did not end with the required fenced \`\`\`json block, so the audit could not be read.
Do not run any more checks and do not call tools. Reply with ONLY one fenced block in exactly the format from the
first message — {"summary": …, "findings": [{"severity", "file", "line", "quote", "text"}]} — with at most ${MAX_FINDINGS}
findings you have already verified, texts in Ukrainian, each quote copied verbatim from the file at the PR head or
from the diff. If you have no verified findings, return "findings": []. Nothing before or after the block.`;
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

/** Диф по файлах: шлях (a/ і b/ — для перейменування і видалення) → його частина дифа. */
export function diffByFile(diff) {
  const map = new Map();
  for (const part of String(diff).split(/^(?=diff --git )/m)) {
    const m = /^diff --git a\/(\S+) b\/(\S+)/.exec(part);
    if (!m) continue;
    for (const f of new Set([m[1], m[2]])) map.set(f, (map.get(f) ?? '') + part);
  }
  return map;
}

/** Залишає знахідки з цитатою у файлі на голові PR або в дифі; решту — у dropped з причиною. */
export function verifyFindings(findings, { readFile, diff }) {
  const kept = [];
  const dropped = [];
  const parts = diffByFile(diff);
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
      // цитата з дифа — лише з частини дифа цього самого файла (зокрема видаленого PR)
      const inDiff = norm(parts.get(file) ?? '').includes(norm(quote));
      if (inFile || inDiff) kept.push({ ...f, where: inFile ? 'файл' : 'диф' });
      else bad(content === null ? 'файла немає на голові PR' : 'цитати немає ні у файлі, ні в дифі');
    }
  }
  if (findings.length > MAX_FINDINGS) dropped.push({ file: '', reason: `понад ${MAX_FINDINGS} знахідок` });
  return { kept, dropped };
}

export function renderComment(r) {
  const head = `${MARKER}\n### Аудит Vibe (Mistral Vibe CLI${r.model ? `, ${safe(r.model)}` : ''}) — ADR-0102, ADR-0104\n\n`;
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
  const retried = r.retried ? '\n\nБлок JSON — з повтору «лише блок JSON» у тій самій сесії (ADR-0105).' : '';
  return `${head}${probe}${summary}${list}${drop}${retried}${usage}`;
}

/** Рядок про прогін з export.json Vibe. */
export function usageLine(exp, code) {
  if (!exp) return `код виходу vibe ${code}, export.json немає`;
  const u = exp.usage ?? {};
  // Vibe 3.1.3 буває пише cost_usd 0 при ненульових токенах (PR #417, обидва прогони PR #422; Т.109): «$0.0000» вводить
  // в оману. $0.0000 лишається лише тоді, коли токени відомі й обидва нульові.
  const noTokens = u.input_tokens === 0 && u.output_tokens === 0;
  const zero = exp.cost_usd === 0 && !noTokens;
  const cost = zero ? 'не порахована (у export.json 0)' : typeof exp.cost_usd === 'number' ? `$${exp.cost_usd.toFixed(4)}` : '?';
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
  let mine = null;
  for (let page = 1; page <= 30 && !mine; page++) {
    const batch = await github(fetch, token, 'GET', `repos/${repo}/issues/${number}/comments?per_page=100&page=${page}`);
    mine = batch.find((c) => c.user?.login === 'github-actions[bot]' && c.body?.includes(MARKER)) ?? null;
    if (batch.length < 100) break;
  }
  if (mine) await github(fetch, token, 'PATCH', `repos/${repo}/issues/comments/${mine.id}`, { body });
  else await github(fetch, token, 'POST', `repos/${repo}/issues/${number}/comments`, { body });
}

/** Аргументи Vibe: запис файлів вимкнено (діє з --auto-approve), bash лишається для пошуку і тестів. */
export function vibeArgs({ work, promptFile, outDir, model, thinking }) {
  return [
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
    thinking,
    '--max-turns',
    String(LIMITS.turns),
    '--max-price',
    String(LIMITS.price),
    '--time-limit',
    String(LIMITS.seconds),
    '--trust',
    '--auto-approve',
    '--disabled-tools',
    'write_file',
    '--disabled-tools',
    'edit',
  ];
}

/** Аргументи повтору: та сама сесія (модель і рівень міркування — з неї), короткі межі, запис файлів вимкнено. */
export function resumeArgs({ work, sessionId, promptFile, outDir }) {
  return [
    '--workdir',
    work,
    '--resume',
    sessionId,
    '--prompt-file',
    promptFile,
    '--output',
    'text',
    '--output-dir',
    outDir,
    '--max-turns',
    String(RETRY.turns),
    '--max-price',
    String(RETRY.price),
    '--time-limit',
    String(RETRY.seconds),
    '--trust',
    '--auto-approve',
    '--disabled-tools',
    'write_file',
    '--disabled-tools',
    'edit',
  ];
}

/** Прогін Vibe: код виходу, вивід і export.json (зіпсований чи відсутній — null). */
function runVibe(spawn, args, { env, outDir, seconds }) {
  const run = spawn('vibe', args, { env, encoding: 'utf8', maxBuffer: 64 << 20, timeout: (seconds + 120) * 1000 });
  const expFile = join(outDir, 'export.json');
  let exp = null;
  try {
    exp = existsSync(expFile) ? JSON.parse(readFileSync(expFile, 'utf8')) : null;
  } catch {
    exp = null;
  }
  return { run, code: run.status ?? -1, exp };
}

/**
 * Аудит одного PR. git читає з оригінального checkout (вміст файлів — з об'єктів коміту голови PR,
 * а не з робочої теки: bash Vibe міг би її змінити); spawn запускає Vibe. Будь-який збій — коментар.
 */
export async function audit({ env, fetch, log, spawn = spawnSync, gitRun }) {
  const repo = env.GITHUB_REPOSITORY;
  const token = env.GITHUB_TOKEN;
  const key = env.MISTRAL_API_KEY;
  const root = resolve(env.GITHUB_WORKSPACE ?? '.');
  const outDir = env.VIBE_OUTPUT_DIR;
  const model = env.VIBE_MODEL || 'mistral-large-4-0';
  const number = Number(env.PR_NUMBER);
  const git =
    gitRun ?? ((...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'] }));
  const probeFile = join(outDir, 'probe.txt');
  const probeLine = existsSync(probeFile) ? readFileSync(probeFile, 'utf8').trim() : '';
  const say = async (r) => {
    const text = redact(renderComment(scrub({ ...r, model, probe: probeLine }, [key])), [key]);
    await upsertComment(fetch, token, repo, number, text);
    log(text);
  };
  let usage = '';
  try {
    if (!key) return await say({ ok: false, reason: 'секрету MISTRAL_VIBE_API_KEY немає' });
    if (env.SETUP_OUTCOME && env.SETUP_OUTCOME !== 'success')
      return await say({ ok: false, reason: `встановлення залежностей чи Vibe CLI не вдалося (${env.SETUP_OUTCOME}) — див. журнал джоби` });
    const pr = await github(fetch, token, 'GET', `repos/${repo}/pulls/${number}`);
    const base = pr.base.sha;
    const headSha = pr.head.sha;
    const names = git('diff', '--name-only', `${base}...${headSha}`).split('\n').filter(Boolean);
    const diff = git('diff', `${base}...${headSha}`);
    const readFile = (f) => {
      try {
        return git('cat-file', '-t', `${headSha}:${f}`).trim() === 'blob' ? git('show', `${headSha}:${f}`) : null;
      } catch {
        return null;
      }
    };
    const promptFile = join(outDir, 'prompt.md');
    writeFileSync(promptFile, buildPrompt({ number, title: pr.title, body: pr.body ?? '', base, head: headSha, names }));
    const childEnv = { ...env };
    for (const k of ['GITHUB_TOKEN', 'ACTIONS_RUNTIME_TOKEN', 'ACTIONS_ID_TOKEN_REQUEST_TOKEN']) delete childEnv[k];
    const args = vibeArgs({ work: env.VIBE_WORKDIR, promptFile, outDir, model, thinking: env.VIBE_THINKING || 'medium' });
    log(`audit-vibe-cli: vibe ${args.join(' ')}`);
    const { run, code, exp } = runVibe(spawn, args, { env: childEnv, outDir, seconds: LIMITS.seconds });
    usage = usageLine(exp, code);
    log(`audit-vibe-cli: ${redact(usage, [key])}\nstderr: ${cut(redact(run.stderr ?? '', [key]), 3000)}`);
    if (code !== 0 && code !== 3) {
      const reason = exp?.error?.message ?? (run.error?.message || cut(redact(run.stderr ?? '', [key]), 400) || `код ${code}`);
      return await say({ ok: false, reason: `Vibe CLI завершився з кодом ${code}: ${reason}`, usage });
    }
    let parsed = extractFindings(run.stdout);
    const first = code === 3 ? `Vibe зупинився на ліміті (${exp?.outcome ?? exp?.stop_reason ?? 'код 3'}) до відповіді` : parsed.reason;
    let retried = '';
    if (!parsed.ok && typeof exp?.session_id === 'string' && exp.session_id) {
      // повтор «лише блок JSON» у тій самій сесії (ADR-0105): Vibe бачить усю свою попередню роботу
      const retryDir = join(outDir, 'retry');
      mkdirSync(retryDir, { recursive: true });
      const retryFile = join(outDir, 'retry.md');
      writeFileSync(retryFile, retryPrompt());
      const rArgs = resumeArgs({ work: env.VIBE_WORKDIR, sessionId: exp.session_id, promptFile: retryFile, outDir: retryDir });
      log(`audit-vibe-cli: повтор — vibe ${rArgs.join(' ')}`);
      const again = runVibe(spawn, rArgs, { env: childEnv, outDir: retryDir, seconds: RETRY.seconds });
      usage = `${usage}; повтор: ${usageLine(again.exp, again.code)}`;
      // ключ вирізається до обрізання: інакше на межі cut лишився б його початок
      log(`audit-vibe-cli: повтор — ${usageLine(again.exp, again.code)}\nstderr: ${cut(redact(again.run.stderr ?? '', [key]), 1500)}`);
      parsed = again.code === 0 || again.code === 3 ? extractFindings(again.run.stdout) : parsed;
      retried = again.code === 0 || again.code === 3 ? 'теж без нього' : `завершився з кодом ${again.code}`;
    }
    if (!parsed.ok) return await say({ ok: false, reason: retried ? `${first}; повтор «лише блок JSON» ${retried}` : first, usage });
    const { kept, dropped } = verifyFindings(parsed.findings, { readFile, diff });
    return await say({ ok: true, summary: parsed.summary, kept, dropped, usage, retried: Boolean(retried) });
  } catch (e) {
    return say({ ok: false, reason: `збій скрипта: ${cut(redact(e.message, [key]), 300)}`, usage });
  }
}

async function selfTest() {
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
      mk({ file: 'b.ts', quote: '- old line' }),
      mk({ file: 'c.ts' }),
      mk({ quote: 'x' }),
      mk({ file: '../etc/passwd' }),
      mk({ text: '' }),
      mk({ file: 'd.ts', quote: '- old line' }),
      mk({ quote: '- old line' }),
    ],
    { readFile, diff: 'diff --git a/b.ts b/b.ts\n-  old   line\ndiff --git a/a.ts b/a.ts\n+ only in a\n' }
  );
  check('цитата у файлі (пробіли нормалізовано) — лишається', v.kept[0]?.where === 'файл');
  check('цитата з дифа видаленого файла — лишається', v.kept[1]?.file === 'b.ts' && v.kept[1]?.where === 'диф' && v.kept.length === 2);
  check(
    'вигадана цитата — відкинуто',
    v.dropped.some((d) => d.reason.startsWith('цитати немає'))
  );
  check(
    'цитата з дифа іншого файла — відкинуто',
    v.dropped.filter((d) => d.file === 'a.ts' && d.reason.startsWith('цитати немає')).length === 2
  );
  check(
    'файла немає і його немає в дифі — відкинуто',
    v.dropped.some((d) => d.file === 'd.ts')
  );
  check('коротка цитата, шлях з .., без тексту — відкинуто', v.dropped.length === 7);
  const many = verifyFindings(
    Array.from({ length: 12 }, () => mk({})),
    { readFile, diff: '' }
  );
  check('понад 10 — обрізано і названо', many.kept.length === 10 && many.dropped.length === 1);
  check('ключ вирізано', redact('a sk-12345678 b sk-12345678', ['sk-12345678']) === 'a *** b ***');
  check('короткий «секрет» не ріже текст', redact('abc', ['ab']) === 'abc');
  const c = renderComment({ ok: true, summary: 's', kept: v.kept, dropped: v.dropped, usage: 'u', probe: '402 — x', model: 'm' });
  check(
    'коментар має маркер, пробу, знахідки і відкинуті',
    c.startsWith(MARKER) && c.includes('402 — x') && c.includes('Відкинуто скриптом (7)')
  );
  check('HTML-коментар у тексті знешкоджено', !renderComment({ ok: false, reason: '<!-- x -->' }).slice(MARKER.length).includes('<!--'));
  check('рядок прогону без export.json', usageLine(null, 2).includes('export.json немає'));
  check(
    'ціна 0 при ненульових чи невідомих токенах — «не порахована», при нульових — $0.0000, не число — ?',
    usageLine({ usage: { input_tokens: 10 }, cost_usd: 0 }, 3).includes('ціна за Vibe не порахована') &&
      usageLine({ usage: { input_tokens: 0, output_tokens: 5 }, cost_usd: 0 }, 0).includes('ціна за Vibe не порахована') &&
      usageLine({ cost_usd: 0 }, 0).includes('ціна за Vibe не порахована') &&
      usageLine({ usage: {}, cost_usd: 0 }, 0).includes('ціна за Vibe не порахована') &&
      usageLine({ usage: { input_tokens: 0, output_tokens: 0 }, cost_usd: 0 }, 0).includes('ціна за Vibe $0.0000') &&
      usageLine({ usage: { input_tokens: 10 } }, 0).endsWith('ціна за Vibe ?') &&
      usageLine({ usage: { input_tokens: 10 }, cost_usd: 0.1148 }, 0).includes('ціна за Vibe $0.1148')
  );
  const p = buildPrompt({ number: 1, title: 't', body: 'b', base: 'B', head: 'H', names: ['x.ts'] });
  check(
    'промпт: диф base...head, роль аудитора, формат JSON',
    p.includes('git diff B...H') && p.includes('NOT an executor') && p.includes('"findings"')
  );
  // межі — числами, а не тими самими константами
  const a = vibeArgs({ work: 'W', promptFile: 'P', outDir: 'O', model: 'M', thinking: 'medium' });
  const arg = (n) => a[a.indexOf(n) + 1];
  check('межі: 60 ходів, $2, 1500 с', arg('--max-turns') === '60' && arg('--max-price') === '2' && arg('--time-limit') === '1500');
  check(
    'запис файлів вимкнено',
    ['write_file', 'edit'].every((t) => a[a.indexOf(t) - 1] === '--disabled-tools') && a.includes('--auto-approve')
  );
  // повний прохід audit() на тимчасовому репозиторії з підставними GitHub і Vibe
  const tmp = mkdtempSync(join(tmpdir(), 'audit-vibe-'));
  const g = (...x) => execFileSync('git', x, { cwd: tmp, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q');
  g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'base');
  const baseSha = g('rev-parse', 'HEAD').trim();
  mkdirSync(join(tmp, 'dir'));
  writeFileSync(join(tmp, 'dir', 'f.ts'), 'export const answer = 42;\n');
  g('add', '.');
  g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'head');
  const headSha = g('rev-parse', 'HEAD').trim();
  writeFileSync(join(tmp, 'dir', 'f.ts'), 'export const answer = 43; // змінено «аудитором»\n');
  const outDir = join(tmp, 'out');
  mkdirSync(outDir);
  const pass = async ({ stdout, status = 0, exportJson, envExtra = {}, crash = false, retry, stderr }) => {
    const posted = [];
    posted.calls = [];
    const fetch = async (url, o = {}) => {
      if (crash && url.includes('/pulls/')) return { ok: false, status: 500, text: async () => 'boom' };
      if (url.includes('/pulls/'))
        return { ok: true, status: 200, json: async () => ({ title: 'T', body: 'B', base: { sha: baseSha }, head: { sha: headSha } }) };
      if (url.includes('comments?per_page=100')) return { ok: true, status: 200, json: async () => [] };
      posted.push(JSON.parse(o.body).body);
      return { ok: true, status: 201, json: async () => ({}) };
    };
    rmSync(join(outDir, 'export.json'), { force: true });
    rmSync(join(outDir, 'retry'), { recursive: true, force: true });
    const spawn = (cmd, args, opts) => {
      posted.calls.push(args);
      const again = args.includes('--resume');
      const r = again ? (retry ?? { stdout: '', status: 1 }) : { stdout, status, exportJson, stderr };
      const od = args[args.indexOf('--output-dir') + 1];
      if (r.exportJson !== undefined) writeFileSync(join(od, 'export.json'), r.exportJson);
      if (opts.env.GITHUB_TOKEN) return { status: 2, stdout: '', stderr: 'TOKEN-LEAK' };
      return { status: r.status ?? 0, stdout: r.stdout, stderr: r.stderr ?? '' };
    };
    const env = {
      GITHUB_REPOSITORY: 'o/r',
      GITHUB_TOKEN: 'tok',
      MISTRAL_API_KEY: 'secret-key-123',
      GITHUB_WORKSPACE: tmp,
      VIBE_WORKDIR: tmp,
      VIBE_OUTPUT_DIR: outDir,
      PR_NUMBER: '5',
      ...envExtra,
    };
    posted.logs = [];
    await audit({ env, fetch, log: (m) => posted.logs.push(String(m)), spawn });
    return posted;
  };
  const good =
    '```json\n{"summary":"ok","findings":[{"severity":"висока","file":"dir/f.ts","line":1,"quote":"answer = 42","text":"т secret-key-123"},{"severity":"низька","file":"dir/f.ts","line":1,"quote":"answer = 43","text":"т"},{"severity":"низька","file":"dir","line":1,"quote":"answer = 42","text":"тека"}]}\n```';
  let r = await pass({ stdout: good, exportJson: '{"outcome":"finished","usage":{},"cost_usd":0.1}' });
  check(
    'прохід: одна знахідка з голови PR, правка робочої теки не зараховується',
    r.length === 1 && r[0].includes('answer = 42') && r[0].includes('Відкинуто скриптом (2)')
  );
  check('прохід: тека замість файла — відкинуто, не падіння', r[0].includes('dir — файла немає'));
  check('прохід: ключ вирізано, токена GitHub у Vibe немає', !r[0].includes('secret-key-123') && !r[0].includes('TOKEN-LEAK'));
  r = await pass({
    stdout: 'x',
    status: 2,
    exportJson: '{"outcome":"infrastructure_failure","error":{"message":"402 billing_wallet_depleted"}}',
  });
  check('прохід: код 2 — «Аудиту не було» з причиною', r[0].includes('**Аудиту не було:** Vibe CLI завершився з кодом 2: 402 billing'));
  r = await pass({ stdout: 'Stopped: turn_limit', status: 3, exportJson: '{"stop_reason":"turn_limit"' });
  check(
    'прохід: ліміт і зіпсований export.json — коментар про ліміт',
    r[0].includes('ліміті (код 3)') && r[0].includes('export.json немає')
  );
  // повтор «лише блок JSON» у тій самій сесії (ADR-0105)
  const sess = '{"outcome":"finished","session_id":"S-1","usage":{}}';
  const sessRetry = '{"outcome":"finished","session_id":"S-1","steps":1,"usage":{}}';
  const longErr = `${'x'.repeat(1490)}secret-key-123`;
  r = await pass({
    stdout: 'перевірив, без JSON',
    exportJson: sess,
    retry: { stdout: good, exportJson: sessRetry, stderr: longErr },
  });
  const ra = r.calls[1] ?? [];
  check(
    'повтор: без JSON — другий виклик з --resume S-1, без --model, межі 2 ходи, $0.5, 300 с',
    r.calls.length === 2 &&
      ra[ra.indexOf('--resume') + 1] === 'S-1' &&
      !ra.includes('--model') &&
      ra[ra.indexOf('--max-turns') + 1] === '2' &&
      ra[ra.indexOf('--max-price') + 1] === '0.5' &&
      ra[ra.indexOf('--time-limit') + 1] === '300' &&
      ['write_file', 'edit'].every((t) => ra[ra.indexOf(t) - 1] === '--disabled-tools')
  );
  check(
    'повтор: знахідки з повтору, позначка і два рядки прогону',
    r[0].includes('answer = 42') && r[0].includes('з повтору') && r[0].includes('повтор: vibe')
  );
  check(
    'повтор: промпт у файлі, export.json першого прогону не перезаписано',
    readFileSync(join(outDir, 'retry.md'), 'utf8').includes('ONLY one fenced block') &&
      readFileSync(join(outDir, 'export.json'), 'utf8') === sess &&
      readFileSync(join(outDir, 'retry', 'export.json'), 'utf8') === sessRetry
  );
  check('повтор: ключ на межі обрізання stderr не потрапляє в журнал', !r.logs.join('\n').includes('secret-key'));
  r = await pass({ stdout: 'x', status: 2, stderr: `${'x'.repeat(395)}secret-key-123` });
  check('код 2: ключ на межі обрізання причини не потрапляє в коментар і журнал', !`${r[0]}${r.logs.join('')}`.includes('sec'));
  const longText = `${'т'.repeat(MAX_FIELD - 3)}secret-key-123`;
  r = await pass({
    stdout: good.replace('"text":"т secret-key-123"', `"text":"${longText}"`),
    exportJson: sess,
  });
  check('текст знахідки: ключ на межі обрізання не потрапляє в коментар', r[0].includes('answer = 42') && !r[0].includes('sec'));
  r = await pass({ stdout: 'без JSON', exportJson: sess, retry: { stdout: 'знову без', exportJson: sess } });
  check('повтор теж без JSON — «Аудиту не було» з обома причинами', r[0].includes('немає блоку JSON') && r[0].includes('теж без нього'));
  r = await pass({ stdout: 'без JSON', exportJson: sess, retry: { stdout: good, status: 1 } });
  check(
    'повтор з кодом 1 — його вивід не читається, причина з кодом',
    r[0].includes('завершився з кодом 1') && !r[0].includes('answer = 42')
  );
  r = await pass({ stdout: 'без JSON', exportJson: sess, retry: { stdout: 'Stopped', status: 3 } });
  check(
    'повтор з кодом 3 без JSON і без export.json — «Аудиту не було»',
    r[0].includes('теж без нього') && r[0].includes('export.json немає')
  );
  r = await pass({ stdout: 'без JSON', exportJson: '{"outcome":"finished"}' });
  check('без session_id повтору немає', r.calls.length === 1 && r[0].includes('немає блоку JSON') && !r[0].includes('повтор'));
  r = await pass({
    stdout: 'Stopped',
    status: 3,
    exportJson: '{"outcome":"turn_limit","stop_reason":"limit","session_id":"S-2"}',
    retry: { stdout: good },
  });
  check('ліміт (код 3) — повтор у сесії, знахідки є', r.calls.length === 2 && r[0].includes('answer = 42'));
  r = await pass({ stdout: 'Stopped', status: 3, exportJson: '{"outcome":"turn_limit","stop_reason":"limit"}' });
  check('ліміт без session_id — назва ліміту з outcome, повтору немає', r.calls.length === 1 && r[0].includes('ліміті (turn_limit)'));
  r = await pass({ stdout: good, exportJson: sess });
  check('JSON з першого разу — повтору немає', r.calls.length === 1 && !r[0].includes('з повтору'));
  // кандидат 95: ручний probe без VIBE_OUTPUT_DIR і без ключа — без падіння
  const probeEnv = { ...process.env };
  delete probeEnv.VIBE_OUTPUT_DIR;
  delete probeEnv.MISTRAL_API_KEY;
  const pr = spawnSync(process.execPath, [fileURLToPath(import.meta.url), 'probe'], { env: probeEnv, encoding: 'utf8' });
  check('probe без VIBE_OUTPUT_DIR — код 0', pr.status === 0 && pr.stdout.includes('секрету MISTRAL_VIBE_API_KEY немає'));
  r = await pass({ stdout: good, envExtra: { SETUP_OUTCOME: 'failure' } });
  check('прохід: збій встановлення — «Аудиту не було»', r[0].includes('встановлення залежностей'));
  r = await pass({ stdout: good, crash: true });
  check('прохід: збій GitHub API — коментар «збій скрипта»', r.length === 1 && r[0].includes('збій скрипта'));
  rmSync(tmp, { recursive: true, force: true });
  console.log(`audit-vibe-cli self-test: помилок ${errors}`);
  return errors;
}

const mode = process.argv[2];
if (mode === '--self-test') process.exit((await selfTest()) ? 1 : 0);
else if (mode === 'probe') {
  const line = await probe({ fetch, key: process.env.MISTRAL_API_KEY, log: console.log });
  // ручний запуск без VIBE_OUTPUT_DIR — лише вивід (кандидат 95)
  if (process.env.VIBE_OUTPUT_DIR) {
    mkdirSync(process.env.VIBE_OUTPUT_DIR, { recursive: true });
    writeFileSync(join(process.env.VIBE_OUTPUT_DIR, 'probe.txt'), line);
  }
  console.log(`audit-vibe-cli probe: ${line}`);
} else if (mode === 'audit') {
  try {
    await audit({ env: process.env, fetch, log: console.log });
  } catch (e) {
    // коментар не вдалося записати — у журнал; чек лишається зеленим
    console.log(`audit-vibe-cli: ${redact(e.message, [process.env.MISTRAL_API_KEY])}`);
  }
}
