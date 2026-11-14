#!/bin/sh
# scripts/iter-tag.sh — назва тегу кроку з опису PR (ADR-0093, Т.34).
#
# Тег кроку ставить workflow `iter-tag` після мержу PR. Назву він бере з рядка
# опису PR, що починається з «Iter-Tag:», наприклад:
#
#     Iter-Tag: iter-T.34
#
# Режими:
#   PR_BODY="…" ./scripts/iter-tag.sh    — друкує назву тегу; без рядка — нічого
#   ./scripts/iter-tag.sh --check <назва> — перевіряє назву і друкує її
#   ./scripts/iter-tag.sh --self-test     — перевірка самого скрипта на парах
#
# Код виходу: 0 — назва є або рядка немає; 1 — назва недопустима або в описі
# два рядки з різними назвами.

set -eu

NAME_RE='^iter-[A-Za-z0-9]+(\.[A-Za-z0-9]+)*$'

check_name() {
    if ! printf '%s\n' "$1" | grep -Eq "$NAME_RE"; then
        echo "Недопустима назва тегу кроку: «$1» (очікується iter-X.Y, ADR-0093)" >&2
        return 1
    fi
    printf '%s\n' "$1"
}

from_body() {
    names="$(printf '%s\n' "$1" | tr -d '\r' |
        sed -n 's/^[[:space:]]*Iter-Tag:[[:space:]]*//p' |
        sed 's/[[:space:]]*$//' | sort -u)"
    [ -n "$names" ] || return 0
    if [ "$(printf '%s\n' "$names" | wc -l)" -ne 1 ]; then
        echo "В описі PR кілька рядків Iter-Tag з різними назвами (ADR-0093)" >&2
        return 1
    fi
    check_name "$names"
}

# expect <мітка> <очікуваний код> <очікуваний вивід> <опис PR>
expect() {
    code=0
    out="$(from_body "$4" 2>/dev/null)" || code=$?
    if [ "$code" != "$2" ] || [ "$out" != "$3" ]; then
        echo "[FAIL] $1: код $code, вивід «$out»; очікувалось $2, «$3»" >&2
        FAILED=1
    else
        echo "[ok] $1"
    fi
}

self_test() {
    FAILED=0
    expect 'рядка немає' 0 '' 'Звичайний опис PR'
    expect 'порожній опис' 0 '' ''
    expect 'крок технічної лінії' 0 'iter-T.34' 'Опис

Iter-Tag: iter-T.34
'
    expect 'крок фази з літерою' 0 'iter-8.4a' 'Iter-Tag: iter-8.4a'
    expect 'нечисловий крок' 0 'iter-P' '  Iter-Tag:   iter-P  '
    expect 'кінці рядків CRLF' 0 'iter-15.2' "$(printf 'Текст\r\nIter-Tag: iter-15.2\r\n')"
    expect 'той самий рядок двічі' 0 'iter-T.34' 'Iter-Tag: iter-T.34
Iter-Tag: iter-T.34'
    expect 'рядок не з початку' 0 '' 'Див. Iter-Tag: iter-T.34'
    expect 'дві різні назви' 1 '' 'Iter-Tag: iter-T.34
Iter-Tag: iter-T.35'
    expect 'реліз-тег' 1 '' 'Iter-Tag: v0.5.0'
    expect 'порожня назва' 0 '' 'Iter-Tag:'
    expect 'пробіл у назві' 1 '' 'Iter-Tag: iter-T.34 зайве'
    expect 'спроба вставити команду' 1 '' 'Iter-Tag: iter-T.34;id'
    expect 'шлях ref' 1 '' 'Iter-Tag: iter-T/34'
    expect 'назва в лапках' 1 '' 'Iter-Tag: `iter-T.34`'
    [ "$FAILED" = 0 ]
}

case "${1:-}" in
--check)
    check_name "${2:-}"
    ;;
--self-test)
    self_test
    ;;
'')
    from_body "${PR_BODY:-}"
    ;;
*)
    echo "Використання: $0 [--check <назва> | --self-test]" >&2
    exit 2
    ;;
esac
