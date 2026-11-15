#!/usr/bin/env python3
"""Т.44, PR 1: навмисні поломки. Працює над копією репозиторію в тимчасовій теці, робоче дерево не чіпає.
Запуск із кореня: [E2E_CHROME=/шлях/до/chrome] python3 docs/reports/t44/mutations-pr1.py"""
import os, shutil, subprocess, sys, tempfile

ROOT = os.getcwd()
UNIT = ['npx', 'vitest', 'run', 'src/render.sprites.test.ts', 'src/core/render-core.test.ts', 'src/main.ui.test.ts']
E2E = ['npm', 'run', 'test:e2e']
# (назва, файл, було, стало, чи ганяти e2e)
MUT = [
    ('без знебарвлення', 'src/render.ts', "    ctx.fillStyle = FOG_GREY;\n    for (const c of cells) {\n      if (!c.visible)", "    ctx.fillStyle = FOG_GREY;\n    for (const c of cells) {\n      if (c.x < 0)", True),
    ('сіра заливка замість знебарвлення (без режиму накладання)', 'src/render.ts', "    ctx.globalCompositeOperation = 'saturation';\n", '', True),
    ('знебарвлення по видимих', 'src/render.ts', "    ctx.fillStyle = FOG_GREY;\n    for (const c of cells) {\n      if (!c.visible)", "    ctx.fillStyle = FOG_GREY;\n    for (const c of cells) {\n      if (c.visible)", True),
    ('режим накладання не відновлено', 'src/render.ts', "    ctx.restore();\n    // туман: приглушення", "    // туман: приглушення", False),
    ('штрих по видимих', 'src/render.ts', "      if (c.visible) continue;\n      const x0", "      if (!c.visible) continue;\n      const x0", False),
    ('без штриха', 'src/render.ts', "      for (let d = 0; d < 2 * cell; d += FOG_HATCH_STEP) {", "      for (let d = 0; d < 0; d += FOG_HATCH_STEP) {", False),
    ('без межі', 'src/render.ts', "  if (border.length > 0) {", "  if (border.length < 0) {", False),
    ('межа на краю поля', 'src/core/render-core.ts', "  const fog = new Set(cells.filter((c) => !c.visible).map((c) => c.x + ',' + c.y));", "  const seen = new Set(cells.filter((c) => c.visible).map((c) => c.x + ',' + c.y));\n  const fog = { has: (k: string): boolean => !seen.has(k) };", False),
    ('червоні квадрати повернено', 'src/ui/battle.ts', "    ctx.setLineDash([]);\n\n    // прев'ю шляху", "    ctx.strokeStyle = 'rgba(255,107,107,0.5)';\n    for (const p of SQUAD_SPAWN) ctx.strokeRect(p.x * BCELL + 2, p.y * BCELL + 2, BCELL - 5, BCELL - 5);\n    ctx.setLineDash([]);\n\n    // прев'ю шляху", False),
    ('синіх квадратів немає', 'src/ui/battle.ts', "    ctx.strokeStyle = 'rgba(110,168,255,0.5)';\n", '', False),
    ('ключі декору переплутано', 'src/render.ts', "{ світло: 1, решітка: 2, уламки: 3 }", "{ світло: 2, решітка: 1, уламки: 3 }", False),
]

def run(cmd, cwd):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True).returncode

tmp = tempfile.mkdtemp(prefix='t44-mut-')
work = os.path.join(tmp, 'repo')
shutil.copytree(ROOT, work, ignore=shutil.ignore_patterns('node_modules', '.git', 'dist', 'coverage'))
os.symlink(os.path.join(ROOT, 'node_modules'), os.path.join(work, 'node_modules'))
with_e2e = '--no-e2e' not in sys.argv
red = 0
for name, rel, old, new, e2e in MUT:
    path = os.path.join(work, rel)
    src = open(path, encoding='utf-8').read()
    assert src.count(old) == 1, (name, src.count(old))
    open(path, 'w', encoding='utf-8').write(src.replace(old, new))
    unit = run(UNIT, work)
    res = 'тести модулів: ' + ('червоні' if unit else 'ЗЕЛЕНІ')
    bad = unit != 0
    if e2e and with_e2e:
        e = run(E2E, work)
        res += '; e2e: ' + ('червоний' if e else 'ЗЕЛЕНИЙ')
        bad = bad or e != 0
    open(path, 'w', encoding='utf-8').write(src)
    red += bad
    print(('[виявлено] ' if bad else '[НЕ ВИЯВЛЕНО] ') + name + ' — ' + res, flush=True)
print(f'виявлено {red} із {len(MUT)}')
shutil.rmtree(tmp)
sys.exit(0 if red == len(MUT) else 1)
