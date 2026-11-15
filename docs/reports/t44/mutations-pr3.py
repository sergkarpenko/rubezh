#!/usr/bin/env python3
"""Т.44, PR 3: навмисні поломки. Працює над копією репозиторію в тимчасовій теці, робоче дерево не чіпає.
Запуск із кореня: [E2E_CHROME=/шлях/до/chrome] python3 docs/reports/t44/mutations-pr3.py"""
import os, shutil, subprocess, sys, tempfile

ROOT = os.getcwd()
UNIT = ['npx', 'vitest', 'run', 'src/core/render-core.test.ts', 'src/render.sprites.test.ts', 'src/ui/battle.test.ts']
E2E = ['npm', 'run', 'test:e2e']
# (назва, файл, було, стало, чи ганяти e2e) — e2e ганяється для поломок зв'язування і кольору лінії; його результат друкується окремо
MUT = [
    ('лінія не від оперативника', 'src/ui/battle.ts', 'from: sel.pos,', 'from: ui.hoverPath[0]!,', True),
    ('ціна — число клітинок, а не hoverAp', 'src/ui/battle.ts', 'ap: ui.hoverAp,', 'ap: ui.hoverPath.length,', False),
    ('колір не залежить від AP', 'src/ui/battle.ts', 'affordable: ui.hoverAp <= sel.ap,', 'affordable: true,', False),
    ('рівно стільки AP, скільки є, — уже червоний', 'src/ui/battle.ts', 'affordable: ui.hoverAp <= sel.ap,', 'affordable: ui.hoverAp < sel.ap,', True),
    ("прев'ю шляху і не у хід гравця", 'src/ui/battle.ts', 'if (ui.hoverPath && sel && playerTurnActive()) {\n      drawPathPreview', 'if (ui.hoverPath && sel) {\n      drawPathPreview', False),
    ("прев'ю шляху на канві немає", 'src/ui/battle.ts', 'if (ui.hoverPath && sel && playerTurnActive()) {\n      drawPathPreview', 'if (ui.hoverPath && sel && !playerTurnActive()) {\n      drawPathPreview', True),
    ('плашка виходить за верхній край', 'src/core/render-core.ts', 'const y = cy - 34 < 2 ? cy + 12 : cy - 34;', 'const y = cy - 34;', False),
    ('поріг «не вміщується зверху» — 0 замість 2 px', 'src/core/render-core.ts', 'const y = cy - 34 < 2 ? cy + 12 : cy - 34;', 'const y = cy - 34 < 0 ? cy + 12 : cy - 34;', False),
    ('плашка завжди під ціллю', 'src/core/render-core.ts', 'const y = cy - 34 < 2 ? cy + 12 : cy - 34;', 'const y = cy + 12;', False),
    ('без притискання до правого краю', 'src/core/render-core.ts', 'Math.round(Math.min(Math.max(cx - w / 2, 2), cw - w - 2))', 'Math.round(Math.max(cx - w / 2, 2))', False),
    ('без притискання до лівого краю', 'src/core/render-core.ts', 'Math.round(Math.min(Math.max(cx - w / 2, 2), cw - w - 2))', 'Math.round(Math.min(cx - w / 2, cw - w - 2))', False),
    ('ширина плашки без запасу', 'src/core/render-core.ts', 'const w = Math.ceil(textW) + PATH_LABEL_PAD;', 'const w = Math.ceil(textW);', False),
    ('плашка від лівого краю клітинки, не по центру', 'src/core/render-core.ts', 'const cx = goal.x * cell + cell / 2;', 'const cx = goal.x * cell;', False),
    ('порожній шлях малюється', 'src/render.ts', '  if (!goal) return;\n', '', False),
    ('у кінці крапка радіусом 3', 'src/render.ts', 'const PATH_END_R = 7;', 'const PATH_END_R = 3;', False),
    ('лінія товщиною 1', 'src/render.ts', 'const PATH_W = 4;', 'const PATH_W = 1;', False),
    ('«не вистачає» тим самим зеленим', 'src/render.ts', "export const PATH_SHORT = 'rgba(255,156,156,0.95)';", "export const PATH_SHORT = 'rgba(127,226,160,0.95)';", False),
    ('кольори переплутано', 'src/render.ts', 'const color = p.affordable ? PATH_OK : PATH_SHORT;', 'const color = p.affordable ? PATH_SHORT : PATH_OK;', True),
    ('текст без « AP»', 'src/render.ts', "const text = p.ap + ' AP';", 'const text = String(p.ap);', False),
    ('лінія не доходить до цілі', 'src/render.ts', 'for (const c of p.path) ctx.lineTo(...mid(c));', 'for (const c of p.path.slice(0, -1)) ctx.lineTo(...mid(c));', False),
    ('лінії немає, лише коло і плашка', 'src/render.ts', '  for (const c of p.path) ctx.lineTo(...mid(c));\n  ctx.stroke();\n', '', True),
    ('стан контексту не відновлено', 'src/render.ts', '  ctx.fillText(text, box.x + box.w / 2, box.y + 11);\n  ctx.restore();\n', '  ctx.fillText(text, box.x + box.w / 2, box.y + 11);\n', False),
    ('текст не по центру плашки', 'src/render.ts', "  ctx.textAlign = 'center';\n", '', False),
    ('шрифт плашки 10px', 'src/render.ts', "ctx.font = 'bold 15px monospace';\n  ctx.textAlign", "ctx.font = '10px monospace';\n  ctx.textAlign", False),
    ('рамка плашки товщиною лінії (4)', 'src/render.ts', '  ctx.lineWidth = 1;\n  ctx.strokeRect(box.x + 0.5', '  ctx.strokeRect(box.x + 0.5', False),
    ('«вистачає» від максимального AP', 'src/ui/battle.ts', 'affordable: ui.hoverAp <= sel.ap,', 'affordable: ui.hoverAp <= sel.maxAp,', False),
    ('ламана без beginPath', 'src/render.ts', '  ctx.beginPath();\n  ctx.moveTo(...mid(p.from));', '  ctx.moveTo(...mid(p.from));', False),
    ('коло без beginPath', 'src/render.ts', '  ctx.beginPath();\n  ctx.arc(gx, gy,', '  ctx.arc(gx, gy,', False),
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
