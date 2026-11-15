#!/usr/bin/env python3
"""Т.43, PR 2: навмисні поломки рядка «Наступний крок». Запуск із кореня:
E2E_CHROME=/шлях/до/chrome python3 docs/reports/t43/mutations-pr2.py
Заміна «було → стало» в одному файлі, після прогону файл відновлюється (у
`finally`; убитий процес лишає зламаний файл — `git checkout -- src/ index.html`).
Оракул: код виходу vitest на двох файлах і сценарію приймання."""
import os, subprocess

NS = 'src/ui/next-step.ts'
MAIN = 'src/main.ts'
MUTS = [
    ('рядок 4 раніше за рядок 3', NS, "  const flying = detectedUfos", "  if (ready === 0) return NEXT_STEP.noReady;\n  const flying = detectedUfos"),
    ('рядок 1 без вимоги боєготових', NS, "  if (ready > 0) {\n    const landed", "  {\n    const landed"),
    ('вікно вписано числом 4', NS, "NEXT_STEP.landed((Math.min(...landed.map((u) => u.landedTicksLeft)) * TICK_MINUTES) / 60)", "NEXT_STEP.landed(4)"),
    ('вікно — першого зонда, а не найменше', NS, "Math.min(...landed.map((u) => u.landedTicksLeft))", "landed[0].landedTicksLeft"),
    ('збитий раніше за приземленого', NS, "    if (landed.length > 0) return", "    if (targets.some((u) => u.status === 'збитий')) return NEXT_STEP.shotDown;\n    if (landed.length > 0) return"),
    ('рядок 3 з пошкодженим перехоплювачем', NS, " && fighter.hp === FIGHTER_MAX_HP) return NEXT_STEP.inAir", ") return NEXT_STEP.inAir"),
    ('рядок 3 з перехоплювачем не на базі', NS, "flying && fighter.status === 'на базі' && ", "flying && "),
    ('ціна без множника пресета', NS, "sciencePrice(WORKSHOP_CATALOG[id].cost, party.campaign.preset)", "WORKSHOP_CATALOG[id].cost"),
    ('«замовте» попри предмет у черзі', NS, " || w.queue.some((o) => o.id === id)", ""),
    ('«замовте» попри предмет в оперативника', NS, "w.equipped[s.id]?.[id] === true", "false"),
    ('«замовте» попри модуль на перехоплювачі', NS, "if (party.intercept.fighter.gunModule) return false;", ""),
    ('видати раніше за замовити', NS, "  if (ITEM_IDS.some((id) => canOrderNew(party, id))) return NEXT_STEP.order;\n  if (readyToIssue(party) > 0) return NEXT_STEP.issue;", "  if (readyToIssue(party) > 0) return NEXT_STEP.issue;\n  if (ITEM_IDS.some((id) => canOrderNew(party, id))) return NEXT_STEP.order;"),
    ('ремонт і під час ремонту', NS, "fighter.status === 'на базі' && fighter.hp < FIGHTER_MAX_HP", "fighter.hp < FIGHTER_MAX_HP"),
    ('не ховається в бою', NS, "ctx.inBattle || ctx.gameOver", "ctx.gameOver"),
    ('не ховається в повітряному бою', NS, " || inAirCombat(party)", ""),
    ('не ховається після перемоги', NS, " || party.campaign.status !== 'триває'", ""),
    ('main.ts не передає стан бою', MAIN, "inBattle: ui.mission !== null, gameOver }", "inBattle: false, gameOver }"),
    ('main.ts не ховає елемент', MAIN, "el('next-step').classList.toggle('hidden', step === null);", ""),
    ('текст рядка 8 з дефісом замість тире', NS, "рухайте час — сенсорна", "рухайте час - сенсорна"),
    ('рядок не на всю ширину шапки', 'index.html', "        flex-basis: 100%;\n        margin-top: -8px;", "        margin-top: -8px;"),
]

def run(cmd):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True, env=dict(os.environ)).returncode

def main():
    assert os.environ.get('E2E_CHROME'), 'потрібен E2E_CHROME=/шлях/до/chrome'
    assert run('npm run test:e2e') == 0, 'сценарій приймання червоний без поломок'
    res = lambda c: 'червоний' if c else 'зелений'
    caught = 0
    for name, path, a, b in MUTS:
        src = open(path, encoding='utf-8').read()
        assert src.count(a) == 1, (name, src.count(a))
        open(path, 'w', encoding='utf-8').write(src.replace(a, b))
        try:
            row = (name, res(run('npx vitest run src/ui/next-step.test.ts')), res(run('npx vitest run src/main.ui.test.ts')), res(run('npm run test:e2e')))
        finally:
            open(path, 'w', encoding='utf-8').write(src)
        caught += 'червоний' in row[1:]
        print('| %s | %s | %s | %s |' % row, flush=True)
    print('ВИЯВЛЕНО: %d із %d' % (caught, len(MUTS)))

main()
