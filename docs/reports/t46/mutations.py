#!/usr/bin/env python3
"""Т.46: навмисні поломки зняття зведеного режиму на старті авто-бою.

Запуск із кореня репозиторію: python3 docs/reports/t46/mutations.py [--no-e2e]
Працює над копією репозиторію в тимчасовій теці (node_modules — посиланням); відстежуваних файлів
репозиторію не змінює, але vitest через посилання пише свій кеш у node_modules/.vite вихідного клону.
Для e2e потрібен E2E_CHROME (або встановлений браузер Playwright) і вільний порт 4173.
"""
import os, shutil, subprocess, sys, tempfile, time

if any(arg != "--no-e2e" for arg in sys.argv[1:]):
    sys.exit(__doc__)
WITH_E2E = "--no-e2e" not in sys.argv
ROOT = os.getcwd()
INPUT, DRIVER, MAIN = "src/ui/input.ts", "src/ui/auto-battle.ts", "src/main.ts"
GUARD = "    if (ui.fireMode === null && ui.itemMode === null) return;\n"
HEAD = "  function disarm(): void {\n"
BODY = """    ui.fireMode = null;
    ui.itemMode = null;
    ui.tapCell = null;
    ui.aimCell = null;
  }

  function armFire("""
CALL = "    this.deps.onStart?.(); // Т.46: до першого кроку — його renderBattle малює плитки вже без режиму\n"
START = CALL + "    this.deps.binfo('Авто-бій: загін веде політика ядра. «Стоп» — керування вручну.');\n    this.next();\n"
GATE = "    if (!mission || this.deps.battleFinished() || this.steps !== null) return;\n"
STOP = "  stop(): void {\n    this.steps = null;\n"
STEP = "    const r = this.steps.step(mission.state);\n"
WIRE = "  onStart: () => input.disarm(), // Т.46: зведений постріл чи витратник авто-бій знімає\n"
# назва, файл, було, стало, чи ганяти e2e
MUTATIONS = [
    ("зняття: постріл лишається зведеним", INPUT, BODY, BODY.replace("    ui.fireMode = null;\n", ""), True),
    ("зняття: витратник лишається зведеним", INPUT, BODY, BODY.replace("    ui.itemMode = null;\n", ""), True),
    ("зняття: ціль тап-тапу лишається", INPUT, BODY, BODY.replace("    ui.tapCell = null;\n", ""), False),
    ("зняття: плашка шансу лишається", INPUT, BODY, BODY.replace("    ui.aimCell = null;\n", ""), False),
    ("зняття: без режиму тап-тап і плашка лишаються", INPUT, HEAD, HEAD + GUARD, False),
    ("зняття: без пострілу нічого не знімає", INPUT, HEAD, HEAD + "    if (ui.fireMode === null) return;\n", False),
    ("зняття: без витратника нічого не знімає", INPUT, HEAD, HEAD + "    if (ui.itemMode === null) return;\n", True),
    ("зняття: знімає і вибір оперативника", INPUT, BODY, BODY.replace("    ui.aimCell = null;\n", "    ui.aimCell = null;\n    ui.selectedId = null;\n"), True),
    ("зняття: стирає шлях під курсором", INPUT, HEAD, HEAD + "    ui.hoverPath = null;\n", False),
    ("зняття: переписує #binfo", INPUT, BODY, BODY.replace("    ui.aimCell = null;\n", "    ui.aimCell = null;\n    battle.binfo('Режим знято.');\n"), False),
    ("драйвер: onStart не викликається", DRIVER, CALL, "", True),
    ("драйвер: onStart до гейтів запуску", DRIVER, GATE, "    this.deps.onStart?.();\n" + GATE, False),
    ("драйвер: onStart після першого кроку", DRIVER, START, START.replace(CALL, "") + "    this.deps.onStart?.();\n", False),
    ("драйвер: onStart і на «Стоп»", DRIVER, STOP, STOP + "    this.deps.onStart?.();\n", False),
    ("драйвер: onStart на кожному кроці", DRIVER, STEP, STEP + "    this.deps.onStart?.();\n", False),
    ("зв'язування: main.ts не передає onStart", MAIN, WIRE, "", True),
]


def run(cmd, cwd):
    return subprocess.run(cmd, cwd=cwd, shell=True, capture_output=True, text=True).returncode


def main():
    started = time.time()
    tmp = tempfile.mkdtemp(prefix="t46-mut-")
    work = os.path.join(tmp, "repo")
    try:
        shutil.copytree(ROOT, work, ignore=shutil.ignore_patterns("node_modules", ".git", "dist", "coverage"))
        os.symlink(os.path.join(ROOT, "node_modules"), os.path.join(work, "node_modules"))
        unit = "npx vitest run src/ui/input.test.ts src/ui/auto-battle.test.ts src/main.ui.test.ts"
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
