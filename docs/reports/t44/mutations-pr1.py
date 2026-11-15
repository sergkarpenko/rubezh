#!/usr/bin/env python3
"""
Т.44, PR 1 («Декор, туман, квадрати»): навмисні поломки у звіті, кожну — окремо, над копією файла
(файл редагується і одразу відновлюється у `finally`; робоче дерево не псується — перевір `git status`).

Запуск із кореня репозиторію:
    python3 docs/reports/t44/mutations-pr1.py            # юніт-тести + e2e для кожної мутації
    python3 docs/reports/t44/mutations-pr1.py --unit     # лише юніт-тести (швидше)
Для e2e потрібен браузер: E2E_CHROME=/шлях/до/chrome (або ~/.cache/ms-playwright).

Кожна мутація: (назва, файл, [(старе, нове), ...]). Старе/нове — точні підрядки, count == 1.
Перевіряємо: vitest (render.sprites / render-core / battle) і e2e-гейт туману (acceptance.scenario.ts).
"""
import os
import subprocess
import sys

RENDER = 'src/render.ts'
CORE = 'src/core/render-core.ts'
BATTLE = 'src/ui/battle.ts'

DESAT_BLOCK = """    ctx.save();
    ctx.globalCompositeOperation = 'saturation';
    ctx.fillStyle = '#808080';
    for (const c of cells) {
      if (!c.visible) ctx.fillRect(c.x * cell, c.y * cell, cell, cell);
    }
    ctx.restore();
"""

HATCH_HEAD = "    ctx.save();\n    ctx.strokeStyle = 'rgba(150,170,190,0.16)';"

BORDER_BLOCK = """  ctx.save();
  ctx.strokeStyle = 'rgba(125,215,255,0.6)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (const s of fogBorderSegments(cells)) {
    ctx.moveTo(s.x1 * cell, s.y1 * cell);
    ctx.lineTo(s.x2 * cell, s.y2 * cell);
  }
  ctx.stroke();
  ctx.restore();
"""

SPAWN_BLOCK = """    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = 'rgba(110,168,255,0.5)';
    for (const p of SQUAD_SPAWN) ctx.strokeRect(p.x * BCELL + 2, p.y * BCELL + 2, BCELL - 5, BCELL - 5);
    ctx.strokeStyle = 'rgba(255,107,107,0.5)';
    for (const p of ALIEN_SPAWN) ctx.strokeRect(p.x * BCELL + 2, p.y * BCELL + 2, BCELL - 5, BCELL - 5);
    ctx.setLineDash([]);
"""

AMBIENT_LINE = '    deps.ambient.paintBattle(ctx, { cell: BCELL, cw: cv.width, ch: cv.height, cells, units: ambUnits });'

MUTS = [
    ('без знебарвлення (немає saturation- шару)', RENDER, [(DESAT_BLOCK, '')]),
    (
        'знебарвлені штрихи (штриховка всередині saturation-блоку)',
        RENDER,
        [(HATCH_HEAD, "    ctx.save();\n    ctx.globalCompositeOperation = 'saturation';\n    ctx.strokeStyle = 'rgba(150,170,190,0.16)';")],
    ),
    ('без межі туману (немає border-штриха)', RENDER, [(BORDER_BLOCK, '')]),
    (
        'межа без краю поля (out-of-map не вважається туманом)',
        CORE,
        [("!all.has(x + ',' + y) || !vis.has(x + ',' + y)", "all.has(x + ',' + y) && !vis.has(x + ',' + y)")],
    ),
    (
        'червоні/сині квадрати спавну поверх юнітів (блок перенесено в кінець renderBattle)',
        BATTLE,
        [(SPAWN_BLOCK, ''), (AMBIENT_LINE, SPAWN_BLOCK + '\n' + AMBIENT_LINE)],
    ),
    (
        'ключі декорів переплутані (світло↔решітка: колонки 1↔2)',
        CORE,
        [('{ світло: 1, решітка: 2,', '{ світло: 2, решітка: 1,')],
    ),
]

UNIT_CMD = 'npx vitest run src/render.sprites.test.ts src/core/render-core.test.ts src/ui/battle.test.ts'


def run(cmd):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True).returncode


def main():
    with_e2e = '--unit' not in sys.argv
    if with_e2e:
        assert os.environ.get('E2E_CHROME') or os.path.isdir(os.path.expanduser('~/.cache/ms-playwright')), (
            'для e2e потрібен браузер: E2E_CHROME=/шлях/до/chrome'
        )
        assert run(UNIT_CMD) == 0, 'базові юніт-тести не зелені — стоп'
        assert run('npm run test:e2e') == 0, 'базовий e2e не зелений — стоп'
    rows = []
    for name, path, pairs in MUTS:
        src = open(path, encoding='utf-8').read()
        out = src
        for a, b in pairs:
            assert out.count(a) == 1, (name, a[:60], out.count(a))
            out = out.replace(a, b)
        open(path, 'w', encoding='utf-8').write(out)
        try:
            unit = run(UNIT_CMD)
            e2e = run('npm run test:e2e') if with_e2e else None
        finally:
            open(path, 'w', encoding='utf-8').write(src)
        res = lambda c: '—' if c is None else ('ЧЕРВОНИЙ' if c else 'зелений')
        caught = []
        if unit != 0:
            caught.append('vitest')
        if e2e:
            caught.append('e2e')
        rows.append((name, res(unit), res(e2e), '+'.join(caught) if caught else 'НЕСПІЙМАНА'))
        print('| %s | юніт: %s | e2e: %s | спіймав: %s |' % rows[-1], flush=True)
    print('\nВИЯВЛЕНО: %d із %d' % (sum(1 for r in rows if r[3] != 'НЕСПІЙМАНА'), len(rows)))


main()
