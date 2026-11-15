#!/usr/bin/env python3
"""Т.44, PR 2: навмисні поломки. Працює над копією репозиторію в тимчасовій теці, робоче дерево не чіпає.
Запуск із кореня: [E2E_CHROME=/шлях/до/chrome] python3 docs/reports/t44/mutations-pr2.py"""
import os, shutil, subprocess, sys, tempfile

ROOT = os.getcwd()
UNIT = ['npx', 'vitest', 'run', 'src/core/map.test.ts', 'src/core/render-core.test.ts', 'src/render.sprites.test.ts', 'src/ui/battle.test.ts']
E2E = ['npm', 'run', 'test:e2e']
# (назва, файл, було, стало, чи ганяти e2e)
MUT = [
    ('зона без урахування AP', 'src/core/map.ts', 'for (let d = 1; d <= steps && frontier.length > 0; d++) {', 'for (let d = 1; d <= 99 && frontier.length > 0; d++) {', True),
    ('зона на крок менша', 'src/core/map.ts', 'for (let d = 1; d <= steps && frontier.length > 0; d++) {', 'for (let d = 1; d < steps && frontier.length > 0; d++) {', False),
    ('зона ігнорує стіни', 'src/core/map.ts', 'if (!isInside(state.map, n) || isBlocked(state.map, n)) continue;\n        if (unitAt', 'if (!isInside(state.map, n)) continue;\n        if (unitAt', True),
    ('юніт у тумані обрізає зону', 'src/core/map.ts', 'if (unitAt(state, n) !== undefined && (seen === undefined || seen.has(nk))) continue;', 'if (unitAt(state, n) !== undefined) continue;', True),
    ('видимий юніт зони не обрізає', 'src/core/map.ts', '        if (unitAt(state, n) !== undefined && (seen === undefined || seen.has(nk))) continue;\n', '', False),
    ('клітинка старту входить у зону', 'src/core/map.ts', 'if (nk === startKey || out.has(nk)) continue;', 'if (out.has(nk)) continue;', False),
    ('зона показується в режимі пострілу', 'src/ui/battle.ts', 'if (sel && playerTurnActive() && ui.fireMode === null && ui.itemMode === null) {', 'if (sel && playerTurnActive() && ui.itemMode === null) {', False),
    ('зона показується в режимі витратника', 'src/ui/battle.ts', 'if (sel && playerTurnActive() && ui.fireMode === null && ui.itemMode === null) {', 'if (sel && playerTurnActive() && ui.fireMode === null) {', False),
    ('зона показується не у хід гравця', 'src/ui/battle.ts', 'if (sel && playerTurnActive() && ui.fireMode === null && ui.itemMode === null) {', 'if (sel && ui.fireMode === null && ui.itemMode === null) {', False),
    ('зона рахується без туману (усі юніти відомі)', 'src/ui/battle.ts', 'drawReachZone(ctx, reachableCells(st, sel.pos, sel.ap, vis), sel.pos, BCELL);', 'drawReachZone(ctx, reachableCells(st, sel.pos, sel.ap), sel.pos, BCELL);', True),
    ('зона від повного запасу AP', 'src/ui/battle.ts', 'drawReachZone(ctx, reachableCells(st, sel.pos, sel.ap, vis), sel.pos, BCELL);', 'drawReachZone(ctx, reachableCells(st, sel.pos, sel.maxAp, vis), sel.pos, BCELL);', False),
    ('зони на канві немає', 'src/ui/battle.ts', '      drawReachZone(ctx, reachableCells(st, sel.pos, sel.ap, vis), sel.pos, BCELL);\n', '', True),
    ('контур між клітинками зони', 'src/core/render-core.ts', "if (!keys.has(x + 1 + ',' + y)) out.push({ x1: x + 1, y1: y, x2: x + 1, y2: y + 1, nx: -1, ny: 0 });", 'out.push({ x1: x + 1, y1: y, x2: x + 1, y2: y + 1, nx: -1, ny: 0 });', False),
    ('зсув контуру назовні', 'src/core/render-core.ts', "if (!keys.has(x + 1 + ',' + y)) out.push({ x1: x + 1, y1: y, x2: x + 1, y2: y + 1, nx: -1, ny: 0 });", "if (!keys.has(x + 1 + ',' + y)) out.push({ x1: x + 1, y1: y, x2: x + 1, y2: y + 1, nx: 1, ny: 0 });", False),
    ('контур без клітинки оперативника', 'src/render.ts', "const zone = new Set(keys).add(origin.x + ',' + origin.y);", 'const zone = new Set(keys);', False),
    ('контур по межі клітинки, без зсуву', 'src/render.ts', 'ctx.moveTo(e.x1 * cell + e.nx, e.y1 * cell + e.ny);', 'ctx.moveTo(e.x1 * cell, e.y1 * cell);', False),
    ('заливка на всю клітинку', 'src/render.ts', '* cell + 1, cell - 2, cell - 2);', '* cell + 1, cell, cell);', False),
    ('порожня зона малює контур оперативника', 'src/render.ts', '  if (keys.size === 0) return;\n', '', False),
    ('колір заливки з варіанта А (0.16)', 'src/render.ts', "export const REACH_FILL = 'rgba(127,226,160,0.09)';", "export const REACH_FILL = 'rgba(127,226,160,0.16)';", False),
    ('заливка зони без restore', 'src/render.ts', '  ctx.stroke();\n  ctx.restore();\n}\n\nexport const TARGET_FRAME_COLOR', '  ctx.stroke();\n}\n\nexport const TARGET_FRAME_COLOR', False),
]

ENV = {k: v for k, v in os.environ.items() if k != 'E2E_URL'}  # e2e має міряти збірку копії, а не зовнішню


def run(cmd, cwd):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, env=ENV).returncode

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
