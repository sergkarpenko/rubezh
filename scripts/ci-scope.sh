#!/bin/sh
# scripts/ci-scope.sh — обсяг перевірок за зміненими файлами (ADR-0146, Т.181).
#
# Рівень зміни — найвищий серед змінених файлів:
#   docs  — лише docs/** (без файлів тестів): тести, лінт і збірка не потрібні;
#   tools — ще scripts/** і кореневі *.md (AGENTS.md, README.md): потрібні
#           tsc скриптів, лінт і формат, тести гри — ні;
#   full  — усе інше (код гри, тести, e2e, ассети, конфігурація, .github/):
#           повний набір перевірок.
# Файл тестів (*.test.*, *.spec.*) будь-де, сам цей скрипт, scripts/pr-class.sh,
# символьне посилання, підмодуль і порожній диф — full (сумнів = full).
#
# «Легка зміна» (ADR-0146) — рівень не full і клас auto за scripts/pr-class.sh:
# без номера кроку, запису, тегу й аудиту.
#
# Режими (рядки «ключ=значення» — у stdout, перелік файлів — у stderr):
#   ci-scope.sh <base> <head>          — level=docs|tools|full
#   ci-scope.sh --light <base> <head>  — level=… і light=true|false
#   ci-scope.sh --staged               — level=… для індексу (pre-commit)
#   ci-scope.sh --self-test            — перевірка скрипта на виписаних випадках
#
# Код виходу: 0 — рівень визначено; 1 — провал самоперевірки; 2 — помилка git
# або не ті аргументи (у CI — червона джоба, а не тихий пропуск перевірок).

set -eu

TAB="$(printf '\t')"

# $1 — шлях; друкує рівень файла.
file_level() {
    case "$1" in
        *.test.* | *.spec.*) echo full ;;
        scripts/ci-scope.sh | scripts/pr-class.sh) echo full ;;
        docs/*) echo docs ;;
        scripts/*) echo tools ;;
        */*) echo full ;;
        *.md) echo tools ;;
        *) echo full ;;
    esac
}

# stdin — вивід `git diff --raw --no-renames`; друкує підсумковий рівень.
level_of_raw() {
    level=''
    while IFS="$TAB" read -r meta path; do
        [ -n "$path" ] || continue
        # shellcheck disable=SC2086
        set -- $meta
        fl="$(file_level "$path")"
        case "$1$2" in
            *120000* | *160000*) fl=full ;;
        esac
        echo "$fl$TAB$path" >&2
        case "$level:$fl" in
            :* | docs:* | tools:full) level="$fl" ;;
        esac
    done
    echo "${level:-full}"
}

# $1, $2 — ревізії; друкує рівень дифа «спільний предок … $2».
level_of_range() {
    mb="$(git merge-base "$1" "$2")" || {
        echo "ci-scope: немає спільного предка $1 і $2" >&2
        return 2
    }
    raw="$(git -c core.quotePath=false diff --raw --no-abbrev --no-renames "$mb" "$2")" || return 2
    printf '%s\n' "$raw" | level_of_raw
}

self_test() {
    here="$(cd "$(dirname "$0")" && pwd)"
    tmp="$(mktemp -d)"
    trap 'rm -rf "$tmp"' EXIT
    fails=0
    total=0
    # $1 — назва, $2 — очікуване, решта — команда
    check() {
        name="$1"
        want="$2"
        shift 2
        total=$((total + 1))
        got="$("$@" 2> /dev/null)" || got="код $?"
        if [ "$got" != "$want" ]; then
            fails=$((fails + 1))
            echo "[FAIL] $name: очікувано «$want», отримано «$got»"
        fi
    }
    for p in \
        'docs/a.md docs' 'docs/adr/0001-x.md docs' 'docs/reports/t1/x.py docs' \
        'docs/x.test.ts full' 'scripts/a.ts tools' 'scripts/assets/b.py tools' \
        'scripts/x.spec.mjs full' 'scripts/ci-scope.sh full' 'scripts/pr-class.sh full' \
        'AGENTS.md tools' 'README.md tools' 'src/README.md full' 'src/core/a.ts full' \
        'src/core/a.test.ts full' 'e2e/a.scenario.ts full' 'package.json full' \
        '.github/workflows/ci.yml full' 'assets/a.png full' 'index.html full' 'docsx/a.md full'; do
        check "файл ${p% *}" "${p#* }" file_level "${p% *}"
    done

    (
        cd "$tmp"
        git init -q -b main .
        git config user.email t@example.com
        git config user.name t
        git config core.hooksPath /dev/null
        mkdir -p docs scripts src
        echo a > docs/a.md
        echo a > scripts/a.ts
        echo a > src/a.ts
        echo a > README.md
        git add . && git commit -q -m base
        git tag base
        echo b >> docs/a.md && git commit -q -am docs && git tag t-docs
        echo b >> scripts/a.ts && git commit -q -am tools && git tag t-tools
        echo b >> README.md && git commit -q -am md && git tag t-md
        git checkout -q -b code base && echo b >> src/a.ts && git commit -q -am code && git tag t-code
        git checkout -q -b del base && git rm -q docs/a.md && git commit -q -m del && git tag t-del
        git checkout -q -b mv base && git mv docs/a.md src/b.ts && git commit -q -m mv && git tag t-mv
        git checkout -q -b ln base && ln -s a.md docs/l.md && git add docs/l.md && git commit -q -m ln && git tag t-ln
        git checkout -q -b side base && echo s > src/s.ts && git add . && git commit -q -m side && git tag t-side
        git checkout -q -b mix1 base && echo b >> scripts/a.ts && echo b >> src/a.ts && git commit -q -am mix1 && git tag t-mix1
        git checkout -q -b mix2 base && echo b >> README.md && echo b >> src/a.ts && git commit -q -am mix2 && git tag t-mix2
        git checkout -q -b tst base && echo a > src/a.test.ts && git add . && git commit -q -m tst && git tag t-tst
        git checkout -q -b sub base
        git update-index --add --cacheinfo "160000,$(git rev-parse base),docs/sub"
        git commit -q -m sub && git tag t-sub
        git checkout -q -f main
    )
    run() { (cd "$tmp" && sh "$here/ci-scope.sh" "$@"); }
    check 'діапазон: лише docs' 'level=docs' run base t-docs
    check 'діапазон: docs + scripts' 'level=tools' run base t-tools
    check 'діапазон: + кореневий md' 'level=tools' run base t-md
    check 'діапазон: код гри' 'level=full' run base t-code
    check 'діапазон: видалений документ' 'level=docs' run base t-del
    check 'діапазон: перенос docs → src' 'level=full' run base t-mv
    check 'діапазон: посилання в docs' 'level=full' run base t-ln
    check 'діапазон: scripts + код гри' 'level=full' run base t-mix1
    check 'діапазон: кореневий md + код гри' 'level=full' run base t-mix2
    check 'діапазон: підмодуль у docs' 'level=full' run base t-sub
    check 'діапазон: порожній диф' 'level=full' run base base
    # диф — від спільного предка: чужий коміт бази рівень не піднімає
    check 'діапазон: база пішла вперед' 'level=docs' run t-side t-docs
    check 'діапазон: немає ревізії' 'код 2' run base nope
    check 'аргументи: один' 'код 2' run base
    check 'аргументи: невідомий режим' 'код 2' run --nope
    (cd "$tmp" && echo c >> docs/a.md && git add docs/a.md)
    check 'індекс: лише docs' 'level=docs' run --staged
    (cd "$tmp" && echo c >> src/a.ts && git add src/a.ts)
    check 'індекс: + код гри' 'level=full' run --staged
    (cd "$tmp" && git reset -q --hard)
    check 'індекс: порожній' 'level=full' run --staged
    # --light: клас дає pr-class.sh поруч зі скриптом (ADR — docs, але approve)
    (cd "$tmp" && git checkout -q -b adr base && mkdir -p docs/adr && echo a > docs/adr/0001-x.md \
        && git add . && git commit -q -m adr && git tag t-adr && git checkout -q main)
    check 'легка: docs, auto' "level=docs
light=true" run --light base t-docs
    check 'легка: scripts, auto' "level=tools
light=true" run --light base t-tools
    check 'легка: README — approve' "level=tools
light=false" run --light base t-md
    check 'легка: ADR — approve' "level=docs
light=false" run --light base t-adr
    # тест гри: клас auto, але рівень full — не легка
    check 'легка: лише тест гри' "level=full
light=false" run --light base t-tst
    check 'легка: код гри' "level=full
light=false" run --light base t-code

    echo "ci-scope self-test: випадків $total, помилок $fails"
    [ "$fails" -eq 0 ]
}

case "${1:-}" in
    --self-test)
        self_test
        ;;
    --staged)
        [ "$#" -eq 1 ] || exit 2
        raw="$(git -c core.quotePath=false diff --cached --raw --no-abbrev --no-renames)" || exit 2
        echo "level=$(printf '%s\n' "$raw" | level_of_raw)"
        ;;
    --light)
        [ "$#" -eq 3 ] || exit 2
        level="$(level_of_range "$2" "$3")" || exit 2
        echo "level=$level"
        class="$(sh "$(dirname "$0")/pr-class.sh" "$2" "$3" | tail -n 1)" || exit 2
        case "$level:$class" in
            full:*) echo 'light=false' ;;
            *:'КЛАС: auto'*) echo 'light=true' ;;
            *) echo 'light=false' ;;
        esac
        ;;
    --* | '')
        echo "ci-scope: <base> <head> | --light <base> <head> | --staged | --self-test" >&2
        exit 2
        ;;
    *)
        [ "$#" -eq 2 ] || exit 2
        level="$(level_of_range "$1" "$2")" || exit 2
        echo "level=$level"
        ;;
esac
