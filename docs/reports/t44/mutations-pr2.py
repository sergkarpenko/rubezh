#!/usr/bin/env python3
"""Т.44, PR 2: навмисні поломки. Працює над копією репозиторію в тимчасовій теці, робоче дерево не чіпає.
Запуск із кореня: [E2E_CHROME=/шлях/до/chrome] python3 docs/reports/t44/mutations-pr2.py"""
import os, shutil, subprocess, sys, tempfile

ROOT = os.getcwd()
UNIT = ['npx', 'vitest', 'run', 'src/core/map.test.ts', 'src/core/render-core.test.ts', 'src/render.sprites.test.ts', 'src/ui/battle.test.ts']
E2E = ['npm', 'run', 'test:e2e']
# (назва, файл, було, стало, чи ганяти e2e) — e2e ганяється для поломок ядра і зв'язування; його результат друкується окремо
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
    ('контур між клітинками зони', 'src/core/render-core.ts', 'if (!has(1, 0)) out.push({ x1: x + 1, y1: y, x2: x + 1, y2: y + 1, nx: -1, ny: 0, e1: ext(1, -1), e2: ext(1, 1) });', 'out.push({ x1: x + 1, y1: y, x2: x + 1, y2: y + 1, nx: -1, ny: 0, e1: ext(1, -1), e2: ext(1, 1) });', False),
    ('зсув контуру назовні', 'src/core/render-core.ts', 'if (!has(1, 0)) out.push({ x1: x + 1, y1: y, x2: x + 1, y2: y + 1, nx: -1, ny: 0, e1: ext(1, -1), e2: ext(1, 1) });', 'if (!has(1, 0)) out.push({ x1: x + 1, y1: y, x2: x + 1, y2: y + 1, nx: 1, ny: 0, e1: ext(1, -1), e2: ext(1, 1) });', False),
    ('контур без клітинки оперативника', 'src/render.ts', "const zone = new Set(keys).add(origin.x + ',' + origin.y);", 'const zone = new Set(keys);', False),
    ('контур по межі клітинки, без зсуву', 'src/render.ts', 'ctx.moveTo(e.x1 * cell + e.nx, e.y1 * cell + e.ny - e.e1);', 'ctx.moveTo(e.x1 * cell, e.y1 * cell - e.e1);', False),
    ('заливка на всю клітинку', 'src/render.ts', '* cell + 1, cell - 2, cell - 2);', '* cell + 1, cell, cell);', False),
    ('порожня зона малює контур оперативника', 'src/render.ts', '  if (keys.size === 0) return;\n', '', False),
    ('колір заливки з варіанта А (0.16)', 'src/render.ts', "export const REACH_FILL = 'rgba(127,226,160,0.09)';", "export const REACH_FILL = 'rgba(127,226,160,0.16)';", False),
    ('заливка зони без restore', 'src/render.ts', '  ctx.stroke();\n  ctx.restore();\n}\n\nexport const TARGET_FRAME_COLOR', '  ctx.stroke();\n}\n\nexport const TARGET_FRAME_COLOR', False),
    ('зона показується під плашкою ходу демонів', 'src/ui/battle.ts', 'if (sel && playerTurnActive() && ui.fireMode === null && ui.itemMode === null) {', "if (sel && ui.battleResult === null && st.activeSide === 'player' && ui.fireMode === null && ui.itemMode === null) {", False),
    ('шар зони над юнітами', 'src/ui/battle.ts', (('    if (sel && playerTurnActive() && ui.fireMode === null && ui.itemMode === null) {\n      drawReachZone(ctx, reachableCells(st, sel.pos, sel.ap, vis), sel.pos, BCELL);\n    }\n', ''), ('    deps.ambient.paintBattle(', '    if (sel && playerTurnActive() && ui.fireMode === null && ui.itemMode === null) {\n      drawReachZone(ctx, reachableCells(st, sel.pos, sel.ap, vis), sel.pos, BCELL);\n    }\n    deps.ambient.paintBattle(')), None, False),
    ('дробовий AP округлено вгору', 'src/core/map.ts', 'const steps = Math.floor(ap / MOVE_AP_PER_CELL);', 'const steps = Math.ceil(ap / MOVE_AP_PER_CELL);', False),
    ('увігнуті кути без подовження', 'src/core/render-core.ts', '(has(0, dy) && has(dx, dy) ? 2 : 0)', '0', False),
    ('подовження на всіх кутах', 'src/core/render-core.ts', '(has(0, dy) && has(dx, dy) ? 2 : 0)', '2', False),
    ('малювання ігнорує подовження', 'src/render.ts', 'e.y1 * cell + e.ny - e.e1);', 'e.y1 * cell + e.ny);', False),
]

ENV = {k: v for k, v in os.environ.items() if k != 'E2E_URL'}  # e2e має міряти збірку копії, а не зовнішню


def run(cmd, cwd):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, env=ENV).returncode

tmp = tempfile.mkdtemp(prefix='t44-mut-')
work = os.path.join(tmp, 'repo')
with_e2e = '--no-e2e' not in sys.argv
red = 0
e2e_red = e2e_all = 0
try:
    shutil.copytree(ROOT, work, ignore=shutil.ignore_patterns('node_modules', '.git', 'dist', 'coverage'))
    os.symlink(os.path.join(ROOT, 'node_modules'), os.path.join(work, 'node_modules'))
    if with_e2e:  # без поломки e2e копії має бути зелений — інакше «червоний» нічого не означає
        assert run(E2E, work) == 0, 'e2e незміненої копії червоний'
    for name, rel, old, new, e2e in MUT:
        path = os.path.join(work, rel)
        src = open(path, encoding='utf-8').read()
        out = src
        for a, b in (old if isinstance(old, tuple) else ((old, new),)):  # кілька замін — перелік пар у полі «було»
            assert out.count(a) == 1, (name, out.count(a))
            out = out.replace(a, b)
        open(path, 'w', encoding='utf-8').write(out)
        unit = run(UNIT, work)
        res = 'тести модулів: ' + ('червоні' if unit else 'ЗЕЛЕНІ')
        if e2e and with_e2e:
            e = run(E2E, work)
            res += '; e2e: ' + ('червоний' if e else 'ЗЕЛЕНИЙ')
            e2e_all += 1
            e2e_red += e != 0
        open(path, 'w', encoding='utf-8').write(src)
        red += unit != 0
        print(('[виявлено] ' if unit else '[НЕ ВИЯВЛЕНО] ') + name + ' — ' + res, flush=True)
finally:
    shutil.rmtree(tmp, ignore_errors=True)
# підсумок — за тестами модулів; e2e — окреме число: зелений e2e не ховається за червоними модулями
print(f'виявлено тестами модулів {red} із {len(MUT)}; e2e червоний у {e2e_red} із {e2e_all}')
sys.exit(0 if red == len(MUT) else 1)
