#!/usr/bin/env python3
"""Т.45: навмисні поломки прев'ю шляху в режимах.

Запуск із кореня репозиторію: python3 docs/reports/t45/mutations.py [--no-e2e]
Працює над копією репозиторію в тимчасовій теці (node_modules — посиланням), репозиторію не змінює.
Для e2e потрібен E2E_CHROME (або встановлений браузер Playwright) і вільний порт 4173.
"""
import os, shutil, subprocess, sys, tempfile, time

if len(sys.argv) > 1 and sys.argv[1] not in ("--no-e2e",):
    sys.exit(__doc__)
WITH_E2E = "--no-e2e" not in sys.argv
ROOT = os.getcwd()
INPUT, BATTLE = "src/ui/input.ts", "src/ui/battle.ts"
GUARD = """    if (ui.fireMode !== null || ui.itemMode !== null) {
      if (ui.hoverPath !== null) {
        ui.hoverPath = null;
        battle.renderBattle();
      }
      return;
    }
"""
COND = "if (ui.hoverPath && sel && playerTurnActive() && ui.fireMode === null && ui.itemMode === null) {"
HOVER = """  function battleCanvasHover(ev: MouseEvent): void {
    if (!battle.playerTurnActive() || !ui.mission) return;
"""
# назва, файл, було, стало, чи ганяти e2e
MUTATIONS = [
    ("наведення: умова без режиму пострілу", INPUT, GUARD, GUARD.replace("ui.fireMode !== null || ", ""), True),
    ("наведення: умова без витратників", INPUT, GUARD, GUARD.replace(" || ui.itemMode !== null", ""), False),
    ("наведення: з витратників лише граната", INPUT, GUARD, GUARD.replace("ui.itemMode !== null", "ui.itemMode === 'grenade'"), False),
    ("наведення: з витратників лише гель", INPUT, GUARD, GUARD.replace("ui.itemMode !== null", "ui.itemMode === 'medkit'"), False),
    ("наведення: старий шлях не прибирається", INPUT, GUARD, GUARD.replace("        ui.hoverPath = null;\n", ""), False),
    ("наведення: поле не перемальовується", INPUT, GUARD, GUARD.replace("        battle.renderBattle();\n", ""), False),
    ("наведення: перемальовка щоразу", INPUT, GUARD, GUARD.replace("      if (ui.hoverPath !== null) {\n", "      {\n"), False),
    ("наведення: умову режимів прибрано", INPUT, GUARD, "", True),
    ("наведення: умова спрацьовує і без режиму", INPUT, GUARD, GUARD.replace("ui.fireMode !== null || ui.itemMode !== null", "true"), True),
    ("авто-бій: #binfo переписується", INPUT, "if (path && !deps.autoBusy()) {", "if (path) {", False),
    ("авто-бій: #binfo лише в авто-бої", INPUT, "if (path && !deps.autoBusy()) {", "if (path && deps.autoBusy()) {", True),
    ("авто-бій: наведення вимкнено зовсім", INPUT, HOVER, HOVER + "    if (deps.autoBusy()) return;\n", False),
    ("малювання: умова без режиму пострілу", BATTLE, COND, COND.replace(" && ui.fireMode === null", ""), True),
    ("малювання: умова без витратників", BATTLE, COND, COND.replace(" && ui.itemMode === null", ""), False),
    ("малювання: з витратників лише граната", BATTLE, COND, COND.replace("ui.itemMode === null", "ui.itemMode !== 'grenade'"), False),
    ("малювання: з витратників лише гель", BATTLE, COND, COND.replace("ui.itemMode === null", "ui.itemMode !== 'medkit'"), False),
    ("малювання: умову режимів прибрано", BATTLE, COND, COND.replace(" && ui.fireMode === null && ui.itemMode === null", ""), True),
    ("малювання: прев'ю не малюється ніколи", BATTLE, COND, COND.replace("ui.hoverPath && ", "false && "), True),
]


def run(cmd, cwd):
    return subprocess.run(cmd, cwd=cwd, shell=True, capture_output=True, text=True).returncode


def main():
    started = time.time()
    tmp = tempfile.mkdtemp(prefix="t45-mut-")
    work = os.path.join(tmp, "repo")
    try:
        shutil.copytree(ROOT, work, ignore=shutil.ignore_patterns("node_modules", ".git", "dist", "coverage"))
        os.symlink(os.path.join(ROOT, "node_modules"), os.path.join(work, "node_modules"))
        unit = "npx vitest run src/ui/input.test.ts src/ui/battle.test.ts"
        e2e = "npm run test:e2e"
        assert run(unit, work) == 0, "тести модулів незміненої копії мають бути зелені"
        if WITH_E2E:
            assert run(e2e, work) == 0, "e2e незміненої копії має бути зелений"
        caught = e2e_red = e2e_runs = 0
        for name, rel, old, new, with_e2e in MUTATIONS:
            path = os.path.join(work, rel)
            src = open(path, encoding="utf-8").read()
            assert src.count(old) == 1, name + ": якір має зустрітись рівно раз"
            assert old != new, name + ": поломка нічого не міняє"
            open(path, "w", encoding="utf-8").write(src.replace(old, new))
            red = run(unit, work) != 0
            caught += red
            line = ("ЗЛОВЛЕНО " if red else "ПРОПУЩЕНО") + " модулями · "
            if WITH_E2E and with_e2e:
                e2e_runs += 1
                r = run(e2e, work) != 0
                e2e_red += r
                line += "e2e " + ("червоний" if r else "зелений") + " · "
            print(line + name, flush=True)
            open(path, "w", encoding="utf-8").write(src)
        print("Модулями: %d із %d" % (caught, len(MUTATIONS)))
        if WITH_E2E:
            print("e2e: червоний у %d із %d" % (e2e_red, e2e_runs))
        print("Час: %d с" % (time.time() - started))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


main()
