#!/usr/bin/env python3
"""Т.43, PR 3: навмисні поломки рядків-причин, рядка перехоплювача і пробілу.
Запуск із кореня: E2E_CHROME=/шлях/до/chrome python3 docs/reports/t43/mutations-pr3.py [номер першої поломки]
Заміна «було → стало» в одному файлі, після прогону файл відновлюється (у
`finally`; убитий процес лишає зламаний файл — `git checkout -- src/ index.html`).
Оракул: код виходу vitest на тестах модулів (`src/ui`), на `main.ui.test.ts` і
сценарію приймання."""
import os, subprocess, sys

P, R, W, TC, MAIN, HTML = 'src/ui/panels.ts', 'src/ui/research-panel.ts', 'src/ui/workshop-panel.ts', 'src/ui/time-control.ts', 'src/main.ts', 'index.html'
MUTS = [
    ('рядок під активною «Вербувати оперативника»', P, "setWhy(hire, party.econ.money < hireCost ? hire.title : null)", "setWhy(hire, hire.title)"),
    ('рядок під «Запустити місію» в бою без причини', P, "btn.disabled && btn.title !== '' ? btn.title : null", "btn.disabled ? btn.title : null"),
    ('немає рядка під «Перехопити»', P, "setWhy(ib, !readyFighter ? ib.title : null)", "setWhy(ib, null)"),
    ('немає рядка під «Ремонт»', P, "setWhy(b, party.econ.money < FIGHTER_REPAIR_COST ? b.title : null)", "setWhy(b, null)"),
    ('повторний рендер дублює рядок', 'src/ui/dom.ts', "  if (next?.classList.contains('btn-why')) next.remove();\n", ""),
    ('рядок «Замовити» розійшовся з title', W, "why: blocked ? title : null", "why: blocked ? 'причина' : null"),
    ('рядок під «Замовити» в бою без причини', W, "why: blocked ? title : null", "why: busy || blocked ? title : null"),
    ('немає рядка під «Дослідити»', R, "setWhy(start, reason)", "setWhy(start, null)"),
    ('немає рядка під «Вербувати техноманта»', R, "setWhy(hire, party.econ.money < hirePrice ? hire.title : null)", "setWhy(hire, null)"),
    ('немає рядка під «Замовити в «Кузні»» на картці', R, "setWhy(forge, st.why)", "setWhy(forge, null)"),
    ('#fighter-last не зникає після нового старту', P, "['intercept_start', 'intercept_aborted', 'intercept_break_off']", "['intercept_aborted', 'intercept_break_off']"),
    ('#fighter-last не зникає після розриву контакту', P, "['intercept_start', 'intercept_aborted', 'intercept_break_off']", "['intercept_start', 'intercept_aborted']"),
    ('пробіл із кнопки у фокусі не діє (як до рішення)', TC, "tag === 'SELECT' || t.isContentEditable", "tag === 'SELECT' || tag === 'BUTTON' || t.isContentEditable"),
    ('фокус із кнопки не знімається', MAIN, "    if (ev.target instanceof HTMLButtonElement) ev.target.blur();\n", ""),
    ('причина в «Кузні» — окремим рядком (панель росте)', HTML, "        display: inline;\n        margin: 0 0 0 6px;", "        margin: 4px 0 0 0;"),
    ('стиль рядка-причини прибрано', HTML, "      .mission-warn,\n      .btn-why {", "      .mission-warn {"),
]

def run(cmd):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True, env=dict(os.environ)).returncode

def main():
    assert os.environ.get('E2E_CHROME'), 'потрібен E2E_CHROME=/шлях/до/chrome'
    assert run('npm run test:e2e') == 0, 'сценарій приймання червоний без поломок'
    res = lambda c: 'червоний' if c else 'зелений'
    caught = 0
    start = int(sys.argv[1]) if len(sys.argv) > 1 else 0  # номер першої поломки (з 0)
    for name, path, a, b in MUTS[start:]:
        src = open(path, encoding='utf-8').read()
        assert src.count(a) == 1, (name, src.count(a))
        open(path, 'w', encoding='utf-8').write(src.replace(a, b))
        try:
            row = (name, res(run('npx vitest run src/ui')), res(run('npx vitest run src/main.ui.test.ts')), res(run('npm run test:e2e')))
        finally:
            open(path, 'w', encoding='utf-8').write(src)
        caught += 'червоний' in row[1:]
        print('| %s | %s | %s | %s |' % row, flush=True)
    print('ВИЯВЛЕНО: %d із %d' % (caught, len(MUTS) - start))

main()
