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
# Самоперевірка (ADR-0143; перший крок джоби pr-size):  sh scripts/pr-size.sh --self-test
#   — виписані випадки в тимчасовому репозиторії: код 0 — усі зійшлись, 1 — ні.
# Код виходу: 0 — у межах ліміту або відхилення заплановане; 1 — перевищення;
# 2 — неправильні аргументи або помилка git (немає ревізії чи спільного предка,
# ADR-0112): число не пораховано, «0 рядків» і [OK] не друкуються.

set -eu

# Самоперевірка (ADR-0143): кожен випадок — гілка work від main у тимчасовому
# репозиторії, запуск цього самого скрипта і звірка коду виходу та рядків виводу.
ST_FAILED=0
ST_COUNT=0

st_fail() {
    ST_FAILED=$((ST_FAILED + 1))
    echo "[FAIL] $1"
}

# st_case <назва> <код> <зміна на work> <запуск> [<рядок є у виводі>] [<рядка немає>]
st_case() {
    ST_COUNT=$((ST_COUNT + 1))
    git checkout -q -B work main
    git clean -qffdx
    eval "$3"
    git add -A
    git commit -q --allow-empty -m work
    rc=0
    out="$(eval "$4" 2>&1)" || rc=$?
    cd "$ST_REPO"
    if [ "$rc" -ne "$2" ]; then
        st_fail "$1: очікувався код $2, отримано $rc"
        printf '%s\n' "$out"
        return 0
    fi
    if [ -n "${5:-}" ] && ! printf '%s\n' "$out" | grep -q -F -e "$5"; then
        st_fail "$1: у виводі немає «$5»"
        printf '%s\n' "$out"
    fi
    if [ -n "${6:-}" ] && printf '%s\n' "$out" | grep -q -F -e "$6"; then
        st_fail "$1: у виводі є «$6»"
        printf '%s\n' "$out"
    fi
}

self_test() {
    script="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
    T="$(mktemp -d)"
    trap 'rm -rf "$T"' EXIT
    # оточення джоби (GITHUB_ACTIONS=true) і локальні змінні не мають впливати на випадки
    unset GITHUB_ACTIONS PR_SIZE_DEVIATION PR_SIZE_LIMIT
    ST_REPO="$T/r"
    mkdir "$ST_REPO"
    cd "$ST_REPO"
    git init -q .
    git checkout -q -b main
    git config user.email pr-size@example.invalid
    git config user.name pr-size
    git config commit.gpgsign false
    git config core.hooksPath /dev/null
    mkdir -p docs src assets
    echo base > docs/r.md
    echo base > README.md
    echo base > assets/a.png
    echo base > package-lock.json
    seq 10 > src/a.ts
    git add -A
    git commit -q -m base
    S='sh "$script"'

    # поза підрахунком — 0 рядків
    st_case 'порожній диф' 0 ':' "$S main work" 'поза підрахунком файлів: 0' '[FAIL]'
    st_case 'лише docs' 0 'echo x >> docs/r.md; echo x > docs/new.md' "$S main work" \
        'Разом у підрахунку: 0 рядків (ліміт 500); поза підрахунком файлів: 2'
    st_case '*.md поза docs' 0 'echo x >> README.md; echo x > src/notes.md' "$S main work" \
        'Разом у підрахунку: 0 рядків (ліміт 500); поза підрахунком файлів: 2'
    st_case 'ассет, бінарний, lockfile' 0 \
        'echo x >> assets/a.png; printf "\000\001" > src/b.bin; echo x >> package-lock.json' "$S main work" \
        'Разом у підрахунку: 0 рядків (ліміт 500); поза підрахунком файлів: 3'
    st_case 'тека, схожа на docs' 0 'mkdir docs-extra; echo x > docs-extra/a.ts' "$S main work" \
        'Разом у підрахунку: 1 рядків'

    # код — додані + видалені
    st_case 'код: додані + видалені' 0 'sed -i.bak 1s/1/один/ src/a.ts; rm src/a.ts.bak; echo x >> src/a.ts' \
        "$S main work" '      3  src/a.ts'
    st_case 'шлях не ASCII' 0 'echo x > src/звіт.ts' "$S main work" '      1  src/звіт.ts'
    st_case 'запуск із підтеки' 0 'echo x >> src/a.ts' "(cd docs && $S main work)" '      1  src/a.ts'
    st_case 'диф від merge-base' 0 \
        'git checkout -q -B side main; seq 20 > src/m.ts; git add -A; git commit -q -m side; git checkout -q work; echo x >> docs/r.md' \
        "$S side work" 'Разом у підрахунку: 0 рядків'

    # ліміт і відхилення
    st_case 'ліміт 500 — рівно' 0 'seq 500 > src/big.ts' "$S main work" '[OK] У межах ліміту'
    st_case 'ліміт 500 + 1' 1 'seq 501 > src/big.ts' "$S main work" \
        '[FAIL] PR перевищує ліміт ADR-0036: 501 рядків коду (ліміт 500, перевищення 1)' '[OK]'
    st_case 'PR_SIZE_LIMIT — рівно' 0 'seq 5 > src/b.ts' "PR_SIZE_LIMIT=5 $S main work" '[OK] У межах ліміту'
    st_case 'PR_SIZE_LIMIT + 1' 1 'seq 6 > src/b.ts' "PR_SIZE_LIMIT=5 $S main work" '[FAIL] PR перевищує' '[OK]'
    st_case 'мітка size-deviation' 0 'seq 6 > src/b.ts' "PR_SIZE_LIMIT=5 PR_SIZE_DEVIATION=true $S main work" \
        '[OK] Перевищення на 1 рядків — плановане відхилення'
    st_case 'без мітки (false)' 1 'seq 6 > src/b.ts' "PR_SIZE_LIMIT=5 PR_SIZE_DEVIATION=false $S main work" \
        '[FAIL] PR перевищує'
    st_case 'перевищення в CI' 1 'seq 6 > src/b.ts' "PR_SIZE_LIMIT=5 GITHUB_ACTIONS=true $S main work" \
        '::error::PR перевищує' '[FAIL]'

    # помилки — код 2, без «0 рядків» і [OK] (ADR-0112)
    st_case 'немає ревізії head' 2 ':' "$S main no-such-rev" '[FAIL] Ревізії no-such-rev немає' '[OK]'
    st_case 'немає ревізії base' 2 ':' "$S no-such-rev work" '[FAIL] Ревізії no-such-rev немає' 'Разом у підрахунку'
    st_case 'помилка git у CI' 2 ':' "GITHUB_ACTIONS=true $S no-such-rev work" '::error::Ревізії no-such-rev' '[FAIL]'
    st_case 'немає спільного предка' 2 \
        'git checkout -q --orphan lone; git rm -rqf .; echo x > o.ts; git add o.ts; git commit -q -m lone; git checkout -q work' \
        "$S lone work" 'немає спільного предка' '[OK]'
    # git diff падає після перевірок ревізій: blob гілки work зіпсовано (видалено об'єкт)
    st_case 'помилка git diff' 2 'echo pr-size-self-test > src/c.ts' \
        "rm -f .git/objects/\$(git rev-parse work:src/c.ts | sed 's#^..#&/#') && $S main work" \
        'git diff main...work завершився з помилкою' 'Разом у підрахунку'
    st_case 'один аргумент' 2 ':' "$S main" 'Використання' 'Разом у підрахунку'
    st_case 'три аргументи' 2 ':' "$S main work extra" 'Використання'

    cd /
    if [ "$ST_FAILED" -ne 0 ]; then
        echo "[FAIL] Самоперевірка pr-size.sh: $ST_FAILED з $ST_COUNT"
        return 1
    fi
    echo "[OK] Самоперевірка pr-size.sh: $ST_COUNT випадків"
}

if [ "$#" -eq 1 ] && [ "$1" = "--self-test" ]; then
    self_test
    exit 0
fi

if [ "$#" -ne 2 ]; then
    echo "Використання: $0 <base> <head> | --self-test" >&2
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
