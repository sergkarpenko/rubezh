#!/bin/sh
# scripts/pr-class.sh <base> <head> — клас PR за ADR-0094 (Т.35).
#
# Клас визначає, чи потрібне для мержу «схвалюю» власника (ADR-0052):
#   auto    — PR чіпає лише «не гру»; після зелених чеків і аудиту без
#             невиправлених знахідок агент мержить сам (ADR-0094);
#   approve — як і раніше: мерж лише після «схвалюю».
#
# «Не гра» (рішення власника 2026-11-14) — кожен змінений файл із переліку:
#   docs/**                     крім docs/adr/** (ADR) і docs/prototypes/** (архів)
#   src/**/*.test.ts, e2e/**    додані або змінені; видалений файл — approve
#   scripts/**                  крім скриптів CI і хуків: сам цей скрипт і ті,
#                               чиє ім'я згадано в .github/, .husky/,
#                               package.json або scripts/pre-commit.sh
# Усе інше (код гри, AGENTS.md, ADR, workflow, конфігурація, ассети) — approve.
# Порожній диф і будь-яка незвична зміна — approve (сумнів = approve).
#
# Режими:
#   pr-class.sh <base> <head>  — рядок на файл і останній рядок «КЛАС: …»
#   pr-class.sh --ci           — крок workflow pr-size: $BASE_SHA і $HEAD_SHA;
#                                правило береться з бази PR, якщо воно там є
#   pr-class.sh --self-test    — перевірка скрипта на виписаних випадках
#
# Сесія агента перед мержем без «схвалюю» запускає версію з main:
#   git show origin/main:scripts/pr-class.sh > /tmp/pr-class.sh
#   sh /tmp/pr-class.sh origin/main HEAD
#
# Код виходу: 0 — клас визначено (будь-який); 1 — помилка; 2 — не ті аргументи.

set -eu

SELF='scripts/pr-class.sh'
REFS='.github .husky package.json scripts/pre-commit.sh'
TAB="$(printf '\t')"

# Скрипт CI або хуків: зміна такого скрипта міняє самі перевірки.
is_machinery() {
    [ "$1" = "$SELF" ] && return 0
    name="${1##*/}"
    for ref in $REFS; do
        [ "$ref" = "$1" ] && return 0
        for rev in "$BASE" "$HEAD"; do
            git grep -q -F -e "$name" "$rev" -- "$ref" < /dev/null 2> /dev/null && return 0
        done
    done
    return 1
}

# $1 — статус git (A, M, D…), $2 — шлях; друкує «auto» або «approve<TAB>причина».
rule() {
    case "$1" in
    A | M | D) ;;
    *)
        echo "approve${TAB}незвична зміна ($1)"
        return 0
        ;;
    esac
    case "$2" in
    docs/adr/*) echo "approve${TAB}ADR" ;;
    docs/prototypes/*) echo "approve${TAB}архів прототипів" ;;
    docs/*) echo auto ;;
    src/*.test.ts | e2e/*)
        if [ "$1" = D ]; then
            echo "approve${TAB}видалення тесту"
        else
            echo auto
        fi
        ;;
    scripts/*)
        if is_machinery "$2"; then
            echo "approve${TAB}скрипт CI або хуків"
        else
            echo auto
        fi
        ;;
    src/*) echo "approve${TAB}код гри" ;;
    *) echo "approve${TAB}правила, конфігурація або інше" ;;
    esac
}

classify() {
    BASE="$1"
    HEAD="$2"
    list="$(git -c core.quotepath=off diff --no-renames --name-status "$BASE...$HEAD")"
    echo "Клас PR (ADR-0094): $BASE...$HEAD"
    if [ -z "$list" ]; then
        echo "  диф порожній"
        echo "КЛАС: approve — потрібне «схвалюю» власника (ADR-0052)"
        return 0
    fi
    lines="$(printf '%s\n' "$list" | while IFS="$TAB" read -r st path; do
        verdict="$(rule "$st" "$path")"
        case "$verdict" in
        auto) printf '  auto     %s\n' "$path" ;;
        *) printf '  approve  %s — %s\n' "$path" "${verdict#*"$TAB"}" ;;
        esac
    done)"
    printf '%s\n' "$lines"
    if printf '%s\n' "$lines" | grep -q '^  approve  '; then
        echo "КЛАС: approve — потрібне «схвалюю» власника (ADR-0052)"
    else
        echo "КЛАС: auto — мерж без «схвалюю» після зелених чеків і аудиту (ADR-0094)"
    fi
}

# Крок workflow: правило з бази PR — PR не може сам собі змінити клас.
ci() {
    : "${BASE_SHA:?потрібен BASE_SHA}" "${HEAD_SHA:?потрібен HEAD_SHA}"
    if git cat-file -e "$BASE_SHA:$SELF" 2> /dev/null; then
        tmp="$(mktemp)"
        git show "$BASE_SHA:$SELF" > "$tmp"
        out="$(sh "$tmp" "$BASE_SHA" "$HEAD_SHA")" || {
            rm -f "$tmp"
            echo "::error::Скрипт класу з бази PR завершився помилкою (ADR-0094)" >&2
            return 1
        }
        rm -f "$tmp"
        out="Правило класу — з бази PR.
$out"
    else
        out="$(classify "$BASE_SHA" "$HEAD_SHA")"
    fi
    printf '%s\n' "$out"
    if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
        {
            echo '```'
            printf '%s\n' "$out"
            echo '```'
        } >> "$GITHUB_STEP_SUMMARY"
    fi
}

# ---- самоперевірка -------------------------------------------------------

T_FAILED=0
T_COUNT=0

t_fail() {
    T_FAILED=$((T_FAILED + 1))
    echo "[FAIL] $1"
}

# t_case <назва> <очікуваний клас> <команди зміни> [рядок, що має бути у виводі]
t_case() {
    T_COUNT=$((T_COUNT + 1))
    git checkout -q -B work main
    git clean -qfdx
    eval "$3"
    git add -A
    git commit -q --allow-empty -m work
    got="$(classify main work)"
    class="$(printf '%s\n' "$got" | sed -n '$s/^КЛАС: \([a-z]*\) .*/\1/p')"
    if [ "$class" != "$2" ]; then
        t_fail "$1: очікувався клас $2, отримано «$class»"
        printf '%s\n' "$got"
        return 0
    fi
    if [ -n "${4:-}" ] && ! printf '%s\n' "$got" | grep -q -F -e "$4"; then
        t_fail "$1: у виводі немає «$4»"
        printf '%s\n' "$got"
    fi
}

self_test() {
    script="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
    T="$(mktemp -d)"
    trap 'rm -rf "$T"' EXIT
    unset GITHUB_STEP_SUMMARY
    mkdir "$T/r"
    cd "$T/r"
    git init -q .
    git checkout -q -b main
    git config user.email pr-class@example.invalid
    git config user.name pr-class
    git config commit.gpgsign false
    git config core.hooksPath /dev/null
    mkdir -p docs/adr docs/reports docs/prototypes src/core e2e scripts .github/workflows .husky assets
    for f in docs/reports/r.md docs/workflow.md docs/adr/0001-a.md docs/prototypes/p.md \
        src/core/a.ts src/core/a.test.ts src/main.ts src/b.property.test.ts e2e/s.scenario.ts \
        scripts/probe.ts scripts/pr-size.sh scripts/verify.sh scripts/summary.mjs \
        scripts/lint-helper.mjs scripts/hook-extra.sh scripts/pr-class.sh AGENTS.md README.md index.html assets/a.png; do
        echo base > "$f"
    done
    echo '"$(dirname "$0")/verify.sh"' > scripts/pre-commit.sh
    printf './scripts/pre-commit.sh\n./scripts/hook-extra.sh\n' > .husky/pre-commit
    printf 'run: ./scripts/pr-size.sh\nrun: node scripts/summary.mjs\n' > .github/workflows/ci.yml
    echo '{"scripts":{"x":"node scripts/lint-helper.mjs"}}' > package.json
    git add -A
    git commit -q -m base

    # «не гра» — auto
    t_case 'звіт' auto 'echo x > docs/reports/t.md' '  auto     docs/reports/t.md'
    t_case 'workflow.md' auto 'echo x >> docs/workflow.md'
    t_case 'знімок у docs' auto 'mkdir -p docs/reports/t/shots; echo x > docs/reports/t/shots/a.png'
    t_case 'видалений звіт' auto 'git rm -q docs/reports/r.md'
    t_case 'шлях із пробілом' auto 'echo x > "docs/reports/a b.md"' 'docs/reports/a b.md'
    t_case 'змінений тест' auto 'echo x >> src/core/a.test.ts'
    t_case 'новий тест' auto 'echo x > src/core/c.test.ts'
    t_case 'property-тест' auto 'echo x >> src/b.property.test.ts'
    t_case 'сценарій e2e' auto 'echo x >> e2e/s.scenario.ts'
    t_case 'скрипт аналізу' auto 'echo x >> scripts/probe.ts'
    t_case 'новий скрипт аналізу' auto 'echo x > scripts/probe-t99.ts'
    t_case 'звіт + тест + скрипт' auto 'echo x > docs/reports/t.md; echo x >> src/core/a.test.ts; echo x >> scripts/probe.ts'

    # гра, правила, перевірки — approve
    t_case 'код ядра' approve 'echo x >> src/core/a.ts' 'src/core/a.ts — код гри'
    t_case 'код UI' approve 'echo x >> src/main.ts'
    t_case 'не тест у src' approve 'echo x > src/core/a.test.ts.bak'
    t_case 'tsx не тест' approve 'echo x > src/core/a.test.tsx'
    t_case 'ADR' approve 'echo x > docs/adr/0002-b.md' 'docs/adr/0002-b.md — ADR'
    t_case 'архів прототипів' approve 'echo x >> docs/prototypes/p.md'
    t_case 'AGENTS.md' approve 'echo x >> AGENTS.md'
    t_case 'README.md' approve 'echo x >> README.md'
    t_case 'workflow CI' approve 'echo x >> .github/workflows/ci.yml'
    t_case 'package.json' approve 'echo x >> package.json'
    t_case 'index.html' approve 'echo x >> index.html'
    t_case 'ассет' approve 'echo x >> assets/a.png'
    t_case 'тека, схожа на docs' approve 'mkdir docs-extra; echo x > docs-extra/a.md'
    t_case 'видалений тест' approve 'git rm -q src/core/a.test.ts' 'видалення тесту'
    t_case 'видалений сценарій e2e' approve 'git rm -q e2e/s.scenario.ts'
    t_case 'перейменований тест' approve 'git mv src/core/a.test.ts src/core/z.test.ts' 'видалення тесту'
    t_case 'скрипт із workflow' approve 'echo x >> scripts/pr-size.sh' 'скрипт CI або хуків'
    t_case 'скрипт із workflow (node)' approve 'echo x >> scripts/summary.mjs'
    t_case 'скрипт із package.json' approve 'echo x >> scripts/lint-helper.mjs'
    t_case 'скрипт хука' approve 'echo x >> scripts/pre-commit.sh'
    t_case 'скрипт із pre-commit.sh, згадка без теки' approve 'echo x >> scripts/verify.sh'
    t_case 'скрипт лише з .husky' approve 'echo x >> scripts/hook-extra.sh'
    t_case 'сам pr-class.sh' approve 'echo x >> scripts/pr-class.sh'
    t_case 'згадку прибрано в тому ж PR' approve 'echo x >> scripts/verify.sh; echo y > scripts/pre-commit.sh' \
        'scripts/verify.sh — скрипт CI або хуків'
    t_case 'згадка лише в гілці' approve 'echo x >> scripts/probe.ts; echo "node scripts/probe.ts" >> scripts/pre-commit.sh' \
        'scripts/probe.ts — скрипт CI або хуків'
    t_case 'звіт + код' approve 'echo x > docs/reports/t.md; echo x >> src/core/a.ts' '  auto     docs/reports/t.md'
    t_case 'порожній диф' approve ':' 'диф порожній'
    t_case 'файл став посиланням' approve 'rm docs/reports/r.md; ln -s ../workflow.md docs/reports/r.md' 'незвична зміна'

    # main пішов уперед після відгалуження: рахується лише зміна гілки
    T_COUNT=$((T_COUNT + 1))
    git checkout -q -B work main
    git clean -qfdx
    echo x > docs/reports/t.md
    git add -A
    git commit -q -m work
    git checkout -q main
    echo x >> src/core/a.ts
    git commit -q -am main-ahead
    got="$(classify main work)"
    [ "$(printf '%s\n' "$got" | tail -n 1 | cut -d' ' -f2)" = auto ] ||
        t_fail "main попереду: чужа зміна потрапила в клас: «$got»"

    # режим --ci: правило береться з бази PR
    T_COUNT=$((T_COUNT + 3))
    git checkout -q main
    git clean -qfdx
    echo 'echo "КЛАС: з-бази $1 $2"' > scripts/pr-class.sh
    git commit -q -am base-script
    git checkout -q -B work main
    echo x >> docs/workflow.md
    echo 'echo "КЛАС: auto — підмінено"' > scripts/pr-class.sh
    git commit -q -am work
    got="$(BASE_SHA=main HEAD_SHA=work sh "$script" --ci)"
    [ "$(printf '%s\n' "$got" | tail -n 1)" = 'КЛАС: з-бази main work' ] ||
        t_fail "--ci: правило не з бази PR: «$got»"
    git checkout -q main
    git rm -q scripts/pr-class.sh
    git commit -q -m no-script
    git checkout -q -B work main
    echo x >> docs/workflow.md
    git commit -q -am work
    GITHUB_STEP_SUMMARY="$T/summary" BASE_SHA=main HEAD_SHA=work sh "$script" --ci > /dev/null
    grep -q '^КЛАС: auto ' "$T/summary" || t_fail '--ci: без скрипта в базі клас не auto або підсумку немає'
    git checkout -q main
    echo 'exit 3' > scripts/pr-class.sh
    git add -A
    git commit -q -m broken-script
    git checkout -q -B work main
    echo x >> docs/workflow.md
    git commit -q -am work
    if BASE_SHA=main HEAD_SHA=work sh "$script" --ci > /dev/null 2>&1; then
        t_fail '--ci: помилка скрипта бази не стала помилкою кроку'
    fi

    # аргументи
    T_COUNT=$((T_COUNT + 2))
    if sh "$script" main > /dev/null 2>&1; then t_fail 'один аргумент прийнято'; fi
    if sh "$script" main no-such-rev > /dev/null 2>&1; then t_fail 'невідома ревізія прийнята'; fi

    cd /
    if [ "$T_FAILED" -ne 0 ]; then
        echo "[FAIL] Самоперевірка pr-class.sh: $T_FAILED з $T_COUNT"
        return 1
    fi
    echo "[OK] Самоперевірка pr-class.sh: $T_COUNT випадків"
}

case "${1:-}" in
--self-test) self_test ;;
--ci) ci ;;
*)
    if [ "$#" -ne 2 ]; then
        echo "Використання: $0 <base> <head> | --ci | --self-test" >&2
        exit 2
    fi
    classify "$1" "$2"
    ;;
esac
