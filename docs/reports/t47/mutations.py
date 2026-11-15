#!/usr/bin/env python3
"""Т.47: навмисні поломки закриття старого бою перед «Продовжити».

Запуск із кореня репозиторію: python3 docs/reports/t47/mutations.py [--no-e2e]
Працює над копією репозиторію в тимчасовій теці (node_modules — посиланням); відстежуваних файлів
репозиторію не змінює, але vitest через посилання пише свій кеш у node_modules/.vite вихідного клону.
Для e2e потрібен E2E_CHROME (або встановлений браузер Playwright) і вільний порт 4173.
"""
import os, shutil, subprocess, sys, tempfile, time

if any(arg != "--no-e2e" for arg in sys.argv[1:]):
    sys.exit(__doc__)
WITH_E2E = "--no-e2e" not in sys.argv
ROOT = os.getcwd()
MAIN = "src/main.ts"
CLOSE = "  battle.close();\n"
LOAD = "  savePanel.load(slot); // adoptParty + renderAll + журнал «Завантажено: слот N»\n"
FIX = CLOSE + LOAD
# назва, файл, було, стало, чи ганяти e2e
MUTATIONS = [
    ("бій не закривається", MAIN, FIX, LOAD, True),
    ("бій закривається після завантаження", MAIN, FIX, LOAD + CLOSE, True),
    ("закривається лише завершений бій", MAIN, FIX, "  if (ui.battleResult !== null) battle.close();\n" + LOAD, True),
    ("закривається лише бій, що триває", MAIN, FIX, "  if (ui.battleResult === null) battle.close();\n" + LOAD, True),
    ("замість закриття — лише ui.mission = null", MAIN, FIX, "  ui.mission = null;\n" + LOAD, False),
    ("бій закривається, сейв не завантажується", MAIN, FIX, CLOSE, True),
]

def run(cmd, cwd):
    return subprocess.run(cmd, cwd=cwd, shell=True, capture_output=True, text=True).returncode


def main():
    started = time.time()
    tmp = tempfile.mkdtemp(prefix="t47-mut-")
    work = os.path.join(tmp, "repo")
    try:
        shutil.copytree(ROOT, work, ignore=shutil.ignore_patterns("node_modules", ".git", "dist", "coverage"))
        os.symlink(os.path.join(ROOT, "node_modules"), os.path.join(work, "node_modules"))
        unit = "npx vitest run src/main.ui.test.ts"
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
