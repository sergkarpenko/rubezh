#!/bin/sh
# scripts/pr-size.sh <base> <head> — розмір PR за ADR-0036/0061/0069 (ADR-0077).
#
# Рахує рядки зміни (додані + видалені) у дифі <base>...<head> (від merge-base)
# і порівнює з лімітом 500. У підрахунок НЕ входять:
#   - документація: docs/**, *.md            (ADR-0036: docs — без обмежень)
#   - ассети: assets/** і будь-які бінарні   (ADR-0069: ліміти лише для коду)
#   - package-lock.json                      (генерований файл)
# Плановане відхилення (ADR-0061): PR_SIZE_DEVIATION=true — перевищення не валить
# перевірку, лише друкується. У CI прапорець = мітка `size-deviation` на PR.
#
# Локально (прогноз дифа до пушу):  ./scripts/pr-size.sh origin/main HEAD
# Код виходу: 0 — у межах ліміту або відхилення заплановане; 1 — перевищення;
# 2 — неправильні аргументи або помилка git (немає ревізії чи спільного предка,
# ADR-0112): число не пораховано, «0 рядків» і [OK] не друкуються.

set -eu

if [ "$#" -ne 2 ]; then
    echo "Використання: $0 <base> <head>" >&2
    exit 2
fi

BASE="$1"
HEAD="$2"
LIMIT="${PR_SIZE_LIMIT:-500}"
DEVIATION="${PR_SIZE_DEVIATION:-false}"

# Помилка git — код 2 з поясненням (ADR-0112). Без цього збій git у конвеєрі
# «git diff | awk» губився: awk бачив порожній вхід, скрипт друкував «0 рядків» і [OK].
fail_git() {
    if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
        echo "::error::$1"
    else
        echo "[FAIL] $1"
    fi
    exit 2
}

if ! git rev-parse --verify --quiet "$BASE^{commit}" >/dev/null; then
    fail_git "Ревізії $BASE немає в клоні — розмір не пораховано. Мілкий клон: git fetch --depth=50 origin main (мілка сама гілка — ще git fetch --deepen=50)."
fi
if ! git rev-parse --verify --quiet "$HEAD^{commit}" >/dev/null; then
    fail_git "Ревізії $HEAD немає в клоні — розмір не пораховано."
fi
if ! git merge-base "$BASE" "$HEAD" >/dev/null 2>&1; then
    fail_git "У $BASE і $HEAD немає спільного предка — розмір не пораховано. Мілкий клон: git fetch --depth=50 origin main (мілка сама гілка — ще git fetch --deepen=50)."
fi

# Диф — окремим кроком: код виходу присвоєння = код git, set -e його не губить.
if ! NUMSTAT="$(git -c core.quotepath=off diff --numstat "$BASE...$HEAD")"; then
    fail_git "git diff $BASE...$HEAD завершився з помилкою — розмір не пораховано."
fi

REPORT="$(printf '%s\n' "$NUMSTAT" | awk -F'\t' '
        NF < 3 { next }                                         # порожній диф
    {
        path = $3
        if ($1 == "-") { skipped++; next }                      # бінарний файл
        if (path ~ /^docs\// || path ~ /\.md$/) { skipped++; next }
        if (path ~ /^assets\//) { skipped++; next }
        if (path == "package-lock.json") { skipped++; next }
        lines = $1 + $2
        total += lines
        printf "  %5d  %s\n", lines, path
    }
    END {
        printf "TOTAL %d\n", total + 0
        printf "SKIPPED %d\n", skipped + 0
    }
')"

TOTAL="$(printf '%s\n' "$REPORT" | awk '$1 == "TOTAL" { print $2 }')"
SKIPPED="$(printf '%s\n' "$REPORT" | awk '$1 == "SKIPPED" { print $2 }')"

echo "Розмір PR (ADR-0036/0061/0069/0077): $BASE...$HEAD"
printf '%s\n' "$REPORT" | grep -v -E '^(TOTAL|SKIPPED) ' || true
echo "Разом у підрахунку: $TOTAL рядків (ліміт $LIMIT); поза підрахунком файлів: $SKIPPED (docs, *.md, assets, бінарні, lockfile)"

if [ "$TOTAL" -le "$LIMIT" ]; then
    echo "[OK] У межах ліміту"
    exit 0
fi

EXCESS=$((TOTAL - LIMIT))
if [ "$DEVIATION" = "true" ]; then
    echo "[OK] Перевищення на $EXCESS рядків — плановане відхилення (ADR-0061, мітка size-deviation)"
    exit 0
fi

MSG="PR перевищує ліміт ADR-0036: $TOTAL рядків коду (ліміт $LIMIT, перевищення $EXCESS). Розбийте на серію PR або зафіксуйте плановане відхилення у кроці плану і поставте мітку size-deviation (ADR-0061)."
if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
    echo "::error::$MSG"
else
    echo "[FAIL] $MSG"
fi
exit 1
