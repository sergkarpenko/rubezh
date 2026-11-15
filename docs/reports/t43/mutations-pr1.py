#!/usr/bin/env python3
"""Т.43, PR 1: навмисні поломки зупинок часу. Запуск із кореня репозиторію:
python3 docs/reports/t43/mutations-pr1.py [--e2e | --only-e2e]
Кожна поломка — заміна «було → стало» в одному файлі; після прогону файл
відновлюється. Оракул: vitest на двох файлах тестів (код виходу); з --e2e —
ще й сценарій приймання (потрібен E2E_CHROME)."""
import os, subprocess, sys

TC = 'src/ui/time-control.ts'
MAIN = 'src/main.ts'
MUTS = [
    ('«+1 доба» без зупинок', TC, "events.some((e) => DAY_STOPS.has(e))", "false"),
    ('«До події» без межі 48', TC, "export const MAX_RUN_TICKS = 48;", "export const MAX_RUN_TICKS = 1000;"),
    ('приземлення невиявленого зонда зупиняє', TC, "u.id === e.ufoId && u.detected", "u.id === e.ufoId"),
    ('пропущено подію «одужав»', TC, "out.push('recovered')", "void 0"),
    ('пропущено подію «протокол завершено»', TC, "out.push('project_completed')", "void 0"),
    ('пропущено подію «замовлення готове»', TC, "out.push('produced')", "void 0"),
    ('пропущено подію «ремонт завершено»', TC, "out.push('repair_done')", "void 0"),
    ('«До події» зупиняється лише на зондах', TC, "mode === 'event' ? events.length > 0 :", "mode === 'event' ? events.some((e) => DAY_STOPS.has(e)) :"),
    ('завершення кампанії не зупиняє прогін', TC, "if (party.campaign.status !== before.campaignStatus) break;", ""),
    ('цикл не дивиться, чи йде час', TC, "done < MAX_RUN_TICKS && !halted()", "done < MAX_RUN_TICKS"),
    ('пробіл діє з кнопки у фокусі', TC, "tag === 'SELECT' || tag === 'BUTTON' ||", "tag === 'SELECT' ||"),
    ('пробіл діє з поля вводу', TC, "tag === 'INPUT' || ", ""),
    ('пробіл діє під відкритим вікном', MAIN, "if (OVERLAY_IDS.some((id) => !el(id).classList.contains('hidden'))) return;", ""),
    ('пробіл у бою рухає час (три запобіжники знято)', MAIN, None, None),
    ('кнопка «До події» працює як «+1 доба»', MAIN, "el('btn-event').onclick = () => runClock('event');", "el('btn-event').onclick = () => runClock('day');"),
    ('кнопка «+1 доба» працює як «До події»', MAIN, "el('btn-day').onclick = () => runClock('day');", "el('btn-day').onclick = () => runClock('event');"),
]
BATTLE = [
    ("    if (ui.mission || party === null) return;\n    const p = party;", "    if (party === null) return;\n    const p = party;"),
    ("() => ui.mission !== null || gameOver || inAirCombat(p)", "() => gameOver || inAirCombat(p)"),
    ("    if (b.disabled) return;\n    ev.preventDefault();\n    b.click();", "    ev.preventDefault();\n    b.onclick!(new MouseEvent('click') as PointerEvent);"),
]

def run(cmd, env=None):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True, env=env).returncode

def main():
    only_e2e = '--only-e2e' in sys.argv
    e2e = '--e2e' in sys.argv or only_e2e
    if e2e:
        assert os.environ.get('E2E_CHROME') or os.path.isdir(os.path.expanduser('~/.cache/ms-playwright')), 'для e2e потрібен браузер: E2E_CHROME=/шлях/до/chrome'
        assert run('npm run test:e2e', dict(os.environ)) == 0, 'сценарій приймання червоний без поломок — стовпчик e2e не мав би сенсу'
    rows = []
    for name, path, a, b in MUTS:
        src = open(path, encoding='utf-8').read()
        out = src
        pairs = BATTLE if a is None else [(a, b)]
        for x, y in pairs:
            assert out.count(x) == 1, (name, x, out.count(x))
            out = out.replace(x, y)
        open(path, 'w', encoding='utf-8').write(out)
        try:
            unit = None if only_e2e else run('npx vitest run src/ui/time-control.test.ts')
            ui = None if only_e2e else run('npx vitest run src/main.ui.test.ts')
            e = run('npm run test:e2e', dict(os.environ)) if e2e else None
        finally:
            open(path, 'w', encoding='utf-8').write(src)
        res = lambda c: '—' if c is None else ('червоний' if c else 'зелений')
        rows.append((name, res(unit), res(ui), res(e)))
        print('| %s | %s | %s | %s |' % rows[-1], flush=True)
    caught = sum(1 for r in rows if 'червоний' in r[1:])
    print('ВИЯВЛЕНО: %d із %d' % (caught, len(rows)))

main()
