#!/usr/bin/env python3
"""Т.54: навмисні поломки scripts/vibe-plan-check.mjs — кожну має зловити самоперевірка.

Запуск із кореня клону: python3 docs/reports/t54/mutations.py
Скрипт і самоперевірка копіюються в тимчасову теку; у клоні нічого не міняється.
"""
import os
import shutil
import subprocess
import sys
import tempfile
import time

if len(sys.argv) > 1:
    sys.exit('аргументів немає: python3 docs/reports/t54/mutations.py')

SRC = 'scripts/vibe-plan-check.mjs'
TEST = 'scripts/vibe-plan-check-selftest.mjs'

# назва, було, стало
MUTATIONS = [
    ('цитати: вкладені не рахуються', 'if (depth++ === 0) start = i;', 'start = i;'),
    ('терміни: «не» перед цитатою не вимагається', "if (/(^|[\\s,;])не $/.test(m[2].slice(0, q.start))) terms.push", 'terms.push'),
    ('анти-глосарій: рядки таблиці пропущено', "if (cells.length < 4 ||", 'if (cells.length < 9 ||'),
    ('форма слова: правильний термін не відсіюється', 'return !w.startsWith(stem(term.good));', 'return true;'),
    ('форма слова: коротка основа — як довга', '(sb.length < 4 ? 2 : 3)', '3'),
    ('одруківка: закінчення теж рахується', 'diff < w.length - 2 &&', 'diff < w.length &&'),
    ('одруківка: слова бази не відсіюються', '!vocab.cyr.has(w) && ', ''),
    ('слова: --allow не діє', 'if (allow.has(w)) continue;', ''),
    ('слова: згадка в лапках — як вжиток', "if (clean[m.index - 1] === '«' && clean[m.index + t.length] === '»') continue;", ''),
    ('слова: латинське заборонене слово не шукається', 'x.bad === w);', 'x.bad === w && false);'),
    ('трансліт: слова бази не відсіюються', ' && !vocab.lat.has(part)', ''),
    ('трансліт: вимкнено', 'tr.has(part) &&', 'false &&'),
    ('мішанина: вимкнено', "if (cyr && /[A-Za-z]/.test(t)) {", 'if (false) {'),
    ('цитати власника: таблиця відповідей не рахується', "(table && /\\|\\s*$/.test(before))", 'false'),
    ('цитати власника: маркер не потрібен', 'if (marked && !known', 'if (!known'),
    ('цитати власника: звірка з планом вимкнена', 'if (marked && !known &&', 'if (false &&'),
    ('цитати власника: назва розділу плану — чужа цитата', ' || plan.heads.some((h) => h.replace(/^#+ /, \'\').startsWith(t))', ''),
    ('цитати власника: досить підрядка плану', 'quotes: new Set(allQuotes(plan)),', 'quotes: { has: (t) => norm(plan).includes(t) },'),
    ('цитати власника: «Власник» з великої не маркер', '/([Вв]ласник|[Вв]ідпов)', '/(власник|[Вв]ідпов)'),
    ('цитати власника: --allow не діє', ' && !allow.has(lower(t))', ''),
    ('назва PR: не звіряється', 'else if (title !== plan.title)', 'else if (false)'),
    ('Iter-Tag: досить підрядка', "!body.split(/\\r?\\n/).includes(plan.iterTag)", '!body.includes(plan.iterTag)'),
    ('опис PR: відповідь без лапок', "if (!norm(body).includes(`«${a}»`))", 'if (!norm(body).includes(a))'),
    ('звіт: розділи не звіряються', 'if (!heads.some((h) => h.startsWith(s)))', 'if (false)'),
    ('звіт: розділ має збігатися повністю', 'h.startsWith(s)', 'h === s'),
    ('документи: відповідь власника не шукається', "if (!all.includes(`«${a}»`))", 'if (false)'),
    ('диф: тека планів не виключена', "':(exclude)docs/plans', ", ''),
    ('диф: словник не виключено', ", ':(exclude)docs/glossary.md'", ''),
    ('диф: прямо від бази, а не від спільного предка', "from = git(['merge-base', opt.base, opt.head]).trim();", ''),
    ('анти-глосарій: з гілки, а не з бази', "show(opt.base, 'docs/glossary.md')", "show(opt.head, 'docs/glossary.md')"),
    ('--terms: не читається', 'for (const f of opt.terms) terms.push', 'for (const f of []) terms.push'),
    ('документи: код у зворотних лапках — як текст', "md ? clean.replace(/`[^`]*`/g, (m) => ' '.repeat(m.length)) : clean", 'clean'),
    ('слова: екранування \\n не прибирається', "text.replace(/\\\\[nrtu]/g, '  ')", 'text'),
    ('трансліт: без службових слів', "...COMMON.split(' ')", ''),
    ('трансліт: без частин camelCase', 'new Set([w, ...t.split(/(?=[A-Z])/).map(lower)])', '[w]'),
    ('звіт: відсутній звіт — не знахідка', 'if (report === null) return [`звіту ${plan.reportPath} немає`];', 'if (report === null) return [];'),
    ('документи: запис кроку не враховується', '...checkReport(plan, report, record),', "...checkReport(plan, report, ''),"),
    ('--pr: номер не перевіряється', "if (opt.pr && !/^\\d+$/.test(opt.pr))", 'if (false)'),
    ('коміти: зауваги стають порожніми', 'const notes = checkWords(messages, plan, vocab, terms, allow);', 'const notes = [];'),
    ('код виходу: завжди 0', 'return findings.length ? 1 : 0;', 'return 0;'),
    ("аргументи: значення не обов'язкове", 'argv[i + 1] === undefined', 'false'),
    ('словник бази: згадка в лапках — слово бази', "if (baseText[m.index - 1] === '«' && baseText[m.index + t.length] === '»') continue;", ''),
]

start = time.time()
tmp = tempfile.mkdtemp(prefix='t54-mut-')
os.makedirs(os.path.join(tmp, 'scripts'))
shutil.copy(TEST, os.path.join(tmp, TEST))
original = open(SRC, encoding='utf8').read()
red = 0
try:
    for name, old, new in MUTATIONS:
        assert original.count(old) == 1, f'{name}: рядок «{old}» трапляється {original.count(old)} разів'
        with open(os.path.join(tmp, SRC), 'w', encoding='utf8') as f:
            f.write(original.replace(old, new))
        code = subprocess.run(['node', TEST], cwd=tmp, capture_output=True, text=True).returncode
        red += code != 0
        print(f"{'червоний' if code != 0 else 'ЗЕЛЕНИЙ'} — {name}")
finally:
    shutil.rmtree(tmp)
print(f'Червоних: {red} із {len(MUTATIONS)}. Час: {time.time() - start:.0f} с')
sys.exit(0 if red == len(MUTATIONS) else 1)
