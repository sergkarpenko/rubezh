#!/usr/bin/env python3
"""Т.49: навмисні поломки над копією репозиторію (зразок — docs/reports/t48/mutations.py).

Запуск із кореня клону: python3 docs/reports/t49/mutations.py
Копія — у тимчасовій теці, node_modules — посиланням (кеш vitest пишеться у
node_modules/.vite вихідного клону — відоме з Т.45). e2e не ганяється: сценарій
приймання цих текстів не звіряє (записано у звіті як межу).
"""
import os
import shutil
import subprocess
import sys
import tempfile
import time

if len(sys.argv) > 1:
    sys.exit('аргументів немає: python3 docs/reports/t49/mutations.py')

ROOT = os.getcwd()
TESTS = ['src/ui/help.test.ts', 'src/ui/journal.test.ts', 'src/ui/panels.test.ts', 'src/ui/status-tabs.test.ts', 'src/main.ui.test.ts']

# назва, файл, було, стало
MUTATIONS = [
    ('журнал: текст приземлення — для причини ufo_lost', 'src/ui/journal.ts', "e.reason === 'ufo_landed'", "e.reason === 'ufo_lost'"),
    ('журнал: гілку приземлення прибрано (завжди «зник з трекінгу»)', 'src/ui/journal.ts', ": e.reason === 'ufo_landed'", ': false'),
    ('журнал: текст приземлення не дослівний', 'src/ui/journal.ts', "'✦ Зонд приземлився — перехоплення перервано'", "'✦ Зонд приземлився — перехоплення скасовано'"),
    ('панель: рядок приземлення знову приховано', 'src/ui/panels.ts', "if (last?.type === 'intercept_aborted' && !stale) {", "if (last?.type === 'intercept_aborted' && last.reason !== 'ufo_landed' && !stale) {"),
    ('розмітка: помилка в чипі стрічки перехоплення', 'index.html', 'Перехоплювач: <b id="ictx-fighter">', 'Перехоплюач: <b id="ictx-fighter">'),
    ('розмітка: помилка в заголовку панелі', 'index.html', '<h2>Перехоплювач</h2>', '<h2>Перехоплюач</h2>'),
    ('довідка: помилка в пункті про вузол', 'src/ui/help.ts', 'перехоплювач і загін', 'перехоплюач і загін'),
    ('довідка: помилка в пункті про перехоплення', 'src/ui/help.ts', 'перехоплювач атакує', 'перехоплюач атакує'),
    ('довідка: помилка в рядку цін', 'src/ui/help.ts', 'ремонт перехоплювача', 'ремонт перехоплюача'),
    ('журнал кузні: помилка в рядку гарматного модуля', 'src/ui/journal.ts', 'на перехоплювачі', 'на перехоплюачі'),
]

start = time.time()
tmp = tempfile.mkdtemp(prefix='t49-mut-')
copy = os.path.join(tmp, 'repo')
shutil.copytree(ROOT, copy, ignore=shutil.ignore_patterns('node_modules', '.git', 'dist', 'coverage'))
os.symlink(os.path.join(ROOT, 'node_modules'), os.path.join(copy, 'node_modules'))


def run_tests():
    r = subprocess.run(['npx', 'vitest', 'run', *TESTS], cwd=copy, capture_output=True, text=True)
    return r.returncode


caught = 0
try:
    assert run_tests() == 0, 'без поломок тести мають бути зелені'
    for name, rel, old, new in MUTATIONS:
        path = os.path.join(copy, rel)
        src = open(path, encoding='utf-8').read()
        assert src.count(old) == 1, (name, src.count(old))
        open(path, 'w', encoding='utf-8').write(src.replace(old, new))
        red = run_tests() != 0
        open(path, 'w', encoding='utf-8').write(src)
        caught += red
        print(('ЧЕРВОНИЙ' if red else 'ЗЕЛЕНИЙ ') + ' · ' + name, flush=True)
finally:
    shutil.rmtree(tmp)  # тимчасову копію прибираємо і при збої (аудит PR #349)
print(f'Зловлено {caught} із {len(MUTATIONS)}. Час: {round(time.time() - start)} с')
