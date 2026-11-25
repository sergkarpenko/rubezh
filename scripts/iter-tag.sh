#!/bin/sh
# scripts/iter-tag.sh — тег кроку з опису PR (ADR-0093, Т.34).
#
# Тег кроку ставить workflow `iter-tag` після мержу PR. Назву він бере з рядка
# опису PR, що починається (без відступу) з «Iter-Tag:», наприклад:
#
#     Iter-Tag: iter-T.34
#
# Уся логіка workflow — тут, щоб її перевіряла самоперевірка, а не лише
# перший живий прогін. Режими:
#   PR_BODY="…" iter-tag.sh    — друкує назву тегу; без рядка — нічого
#   iter-tag.sh --check <назва> — перевіряє назву і друкує її
#   iter-tag.sh --preview       — джоба check: назва майбутнього тегу, чи вільна;
#                                 PR кроку фази (у назві PR «пX.Y», $PR_TITLE)
#                                 без рядка — попередження (кандидат 170, Т.189)
#   iter-tag.sh --plan          — джоба tag: назва і коміт у $GITHUB_OUTPUT
#   iter-tag.sh --put           — джоба tag: створює тег $TAG на коміті $SHA
#   iter-tag.sh --self-test     — перевірка скрипта на виписаних випадках
#
# Код виходу: 0 — гаразд (зокрема «рядка немає»); 1 — помилка.

set -eu

NAME_RE='^iter-[A-Za-z0-9]+(\.[A-Za-z0-9]+)*$'
NL='
'

fail() {
    echo "::error::$1" >&2
    return 1
}

check_name() {
    case "$1" in
    *"$NL"* | *.lock) fail "Недопустима назва тегу кроку (ADR-0093): «$1»" || return 1 ;;
    esac
    printf '%s\n' "$1" | grep -Eq "$NAME_RE" ||
        fail "Недопустима назва тегу кроку: «$1» (очікується iter-X.Y, ADR-0093)" || return 1
    printf '%s\n' "$1"
}

check_sha() {
    case "$1" in
    *[!0-9a-f]* | '') fail "Очікується повний sha (40 знаків), отримано «$1»" || return 1 ;;
    esac
    [ "${#1}" -eq 40 ] || fail "Очікується повний sha (40 знаків), отримано «$1»" || return 1
}

from_body() {
    names="$(printf '%s\n' "$1" | tr -d '\r' |
        sed -n 's/^Iter-Tag:[[:space:]]*//p' |
        sed 's/[[:space:]]*$//' | grep -v '^$' | sort -u || true)"
    [ -n "$names" ] || return 0
    [ "$(printf '%s\n' "$names" | wc -l)" -eq 1 ] ||
        fail "В описі PR кілька рядків Iter-Tag з різними назвами (ADR-0093)" || return 1
    check_name "$names"
}

# Коміт наявного тегу: друкує sha коміту; порожньо — тегу немає (404).
# Анотований тег розіменовується до коміту. Інша помилка API — код 1.
tag_commit() {
    if ! ref="$(gh api "repos/${GITHUB_REPOSITORY}/git/ref/tags/$1" \
        --jq '.object.type + " " + .object.sha' 2> "$ERR")"; then
        grep -q 'HTTP 404' "$ERR" && return 0
        fail "Не вдалося перевірити тег $1: $(cat "$ERR")" || return 1
    fi
    case "$ref" in
    'tag '*) gh api "repos/${GITHUB_REPOSITORY}/git/tags/${ref#tag }" --jq .object.sha ;;
    *) printf '%s\n' "${ref#* }" ;;
    esac
}

summary() {
    echo "$1" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
}

# Назва PR кроку фази («п16.5 (Т.187): …») — друкує очікуваний тег iter-16.5; інакше нічого.
# Альтернатива, а не набір у дужках: літера «п» — два байти, набір залежав би від локалі.
step_hint() {
    step="$(printf '%s\n' "$1" | grep -oE '(^|[^0-9A-Za-z.])п[0-9]+\.[0-9]+([^0-9.]|$)' | head -n 1 || true)"
    [ -n "$step" ] || return 0
    step="${step##*п}"
    printf 'iter-%s\n' "${step%%[!0-9.]*}"
}

preview() {
    tag="$(from_body "${PR_BODY:-}")" || return 1
    if [ -z "$tag" ]; then
        hint="$(step_hint "${PR_TITLE:-}")"
        if [ -n "$hint" ]; then
            echo "::warning::Назва PR — крок фази, а рядка «Iter-Tag: $hint» в описі немає — тег не буде поставлено (ADR-0093)"
        elif printf '%s\n' "${PR_BODY:-}" | grep -qi 'iter-tag'; then
            echo "::warning::В описі PR згадано Iter-Tag, але рядка «Iter-Tag: iter-X.Y» з початку рядка немає — тег не буде поставлено"
        fi
        summary "Рядка Iter-Tag в описі PR немає — після мержу тег не ставиться."
        return 0
    fi
    existing="$(tag_commit "$tag")" || return 1
    [ -z "$existing" ] ||
        fail "Тег $tag уже існує (коміт $existing) — workflow його не пересуне (ADR-0093)" || return 1
    summary "Після мержу буде поставлено тег \`$tag\` на merge-коміт цього PR."
}

plan() {
    if [ "${GITHUB_EVENT_NAME:-}" = "workflow_dispatch" ]; then
        tag="$(check_name "${INPUT_TAG:-}")" || return 1
        sha="${INPUT_SHA:-}"
    else
        tag="$(from_body "${PR_BODY:-}")" || return 1
        sha="${MERGE_SHA:-}"
    fi
    if [ -z "$tag" ]; then
        summary "Рядка Iter-Tag в описі PR немає — тег не ставиться."
        return 0
    fi
    check_sha "$sha" || return 1
    # коміт має бути в історії main: main збігається з ним або попереду
    status="$(gh api "repos/${GITHUB_REPOSITORY}/compare/${sha}...main" --jq .status)" || return 1
    case "$status" in
    ahead | identical) ;;
    *) fail "Коміт $sha не в історії main (compare: $status)" || return 1 ;;
    esac
    printf 'tag=%s\nsha=%s\n' "$tag" "$sha" >> "$GITHUB_OUTPUT"
}

put() {
    tag="$(check_name "${TAG:-}")" || return 1
    check_sha "${SHA:-}" || return 1
    existing="$(tag_commit "$tag")" || return 1
    if [ "$existing" = "$SHA" ]; then
        summary "Тег \`$tag\` уже стоїть на \`$SHA\` — без змін."
        return 0
    fi
    [ -z "$existing" ] ||
        fail "Тег $tag уже існує на $existing, а не на $SHA — workflow тегів не пересуває (ADR-0093)" || return 1
    gh api "repos/${GITHUB_REPOSITORY}/git/refs" -f "ref=refs/tags/$tag" -f "sha=$SHA" --jq .ref
    summary "Поставлено тег \`$tag\` → \`$SHA\`."
}

# ---- самоперевірка -------------------------------------------------------

# expect <мітка> <очікуваний код> <очікуваний вивід> <команда…>
expect() {
    label="$1" want_code="$2" want_out="$3"
    shift 3
    code=0
    out="$("$@" 2> /dev/null)" || code=$?
    if [ "$code" != "$want_code" ] || [ "$out" != "$want_out" ]; then
        echo "[FAIL] $label: код $code, вивід «$out»; очікувалось $want_code, «$want_out»" >&2
        FAILED=1
    else
        echo "[ok] $label"
    fi
}

# Заглушка gh для самоперевірки: STUB_REF — відповідь git/ref/tags
# («commit <sha>», «tag <sha об'єкта>», порожньо — 404, «boom» — інша помилка),
# STUB_TAGGED — коміт анотованого тегу, STUB_CMP — статус compare.
stub_gh() {
    case "$2" in
    */git/ref/tags/*)
        case "${STUB_REF:-}" in
        '') echo 'gh: Not Found (HTTP 404)' >&2 && return 1 ;;
        boom) echo 'gh: Server Error (HTTP 502)' >&2 && return 1 ;;
        *) echo "$STUB_REF" ;;
        esac
        ;;
    */git/tags/*) echo "$STUB_TAGGED" ;;
    */compare/*) echo "${STUB_CMP:-ahead}" ;;
    */git/refs) echo "refs/tags/created" && echo created >> "$CALLS" ;;
    esac
}

# run_stub <режим> <VAR=значення…> — режим із заглушкою; друкує виходи і число створень
run_stub() {
    mode="$1"
    shift
    (
        for kv in "$@"; do export "$kv"; done
        gh() { stub_gh "$@"; }
        : > "$CALLS"
        : > "$GITHUB_OUTPUT"
        "$mode" > /dev/null || exit 1
        printf '%s|створень %s\n' "$(tr '\n' ' ' < "$GITHUB_OUTPUT")" "$(wc -l < "$CALLS" | tr -d ' ')"
    )
}

# preview_as <назва PR> <опис> — preview без рядка тегу (запитів gh немає)
preview_as() {
    PR_TITLE="$1" PR_BODY="$2" preview
}

self_test() {
    FAILED=0
    A=6bbff2732a86ef98c3fc68ebdd47152eb34321a7
    B=d9ab9b7d8b75bedbac90a5ecc49899665970e57c
    CALLS="$(mktemp)" GITHUB_OUTPUT="$(mktemp)" GITHUB_REPOSITORY=o/r
    export GITHUB_REPOSITORY

    # назва з опису PR
    expect 'рядка немає' 0 '' from_body 'Звичайний опис PR'
    expect 'порожній опис' 0 '' from_body ''
    expect 'крок технічної лінії' 0 'iter-T.34' from_body "Опис${NL}${NL}Iter-Tag: iter-T.34${NL}"
    expect 'крок фази з літерою' 0 'iter-8.4a' from_body 'Iter-Tag: iter-8.4a'
    expect 'нечисловий крок, пробіли' 0 'iter-P' from_body 'Iter-Tag:   iter-P  '
    expect 'кінці рядків CRLF' 0 'iter-15.2' from_body "$(printf 'Текст\r\nIter-Tag: iter-15.2\r\n')"
    expect 'той самий рядок двічі' 0 'iter-T.34' from_body "Iter-Tag: iter-T.34${NL}Iter-Tag: iter-T.34"
    expect 'порожній рядок і справжній' 0 'iter-T.34' from_body "Iter-Tag:${NL}Iter-Tag: iter-T.34"
    expect 'рядок не з початку' 0 '' from_body 'Див. Iter-Tag: iter-T.34'
    expect 'рядок з відступом (приклад у коді)' 0 '' from_body '    Iter-Tag: iter-X.Y'
    expect 'інший регістр ключа' 0 '' from_body 'iter-tag: iter-T.34'
    expect 'порожня назва' 0 '' from_body 'Iter-Tag:'
    expect 'дві різні назви' 1 '' from_body "Iter-Tag: iter-T.34${NL}Iter-Tag: iter-T.35"
    expect 'реліз-тег' 1 '' from_body 'Iter-Tag: v0.5.0'
    expect 'зайве слово після назви' 1 '' from_body 'Iter-Tag: iter-T.34 зайве'
    expect 'спроба вставити команду' 1 '' from_body 'Iter-Tag: iter-T.34;id'
    expect 'шлях ref' 1 '' from_body 'Iter-Tag: iter-T/34'
    expect 'назва в лапках' 1 '' from_body 'Iter-Tag: `iter-T.34`'

    # перевірка назви і sha
    expect 'check: добра назва' 0 'iter-T.34' check_name 'iter-T.34'
    expect 'check: префікс перед iter-' 1 '' check_name 'xiter-T.34'
    expect 'check: лише iter-' 1 '' check_name 'iter-'
    expect 'check: великі літери ITER' 1 '' check_name 'ITER-T.34'
    expect 'check: кирилична Т' 1 '' check_name 'iter-Т.34'
    expect 'check: закінчення .lock' 1 '' check_name 'iter-T.lock'
    expect 'check: дві крапки' 1 '' check_name 'iter-T..34'
    expect 'check: другий рядок' 1 '' check_name "iter-T.34${NL}sha=x"
    expect 'sha: повний' 0 '' check_sha "$A"
    expect 'sha: короткий' 1 '' check_sha '6bbff27'
    expect 'sha: великі літери' 1 '' check_sha 'D9AB9B7D8B75BEDBAC90A5ECC49899665970E57C'
    expect 'sha: другий рядок' 1 '' check_sha "$A${NL}x"

    # назва PR кроку фази (кандидат 170)
    expect 'hint: крок фази' 0 'iter-16.5' step_hint 'п16.5 (Т.187): probe-баланс'
    expect 'hint: крок фази в кінці назви' 0 'iter-16.2' step_hint "feat(core): кар'єра (п16.2, Т.184)"
    expect 'hint: крок з двозначними числами' 0 'iter-17.12' step_hint 'feat(ui): п17.12 — вороги'
    expect 'hint: технічний крок' 0 '' step_hint 'docs(workflow): Т.180 — запис'
    expect 'hint: без кроку' 0 '' step_hint 'docs(agents): уроки'
    expect 'hint: п без крапки' 0 '' step_hint 'п16 — план'
    expect 'hint: п після цифри' 0 '' step_hint 'v2п16.5'
    expect 'hint: п після латинської літери' 0 '' step_hint 'vп16.5'
    expect 'hint: п після крапки' 0 '' step_hint 'v1.п16.5'
    expect 'hint: три числа' 0 '' step_hint 'п16.5.3 — щось'

    # джоба check
    expect 'preview: без рядка' 0 '|створень 0' run_stub preview 'PR_BODY=опис'
    expect 'preview: крок фази без рядка — попередження' 0 '::warning::Назва PR — крок фази, а рядка «Iter-Tag: iter-16.5» в описі немає — тег не буде поставлено (ADR-0093)' preview_as 'п16.5 (Т.187): probe' 'опис'
    expect 'preview: не крок фази — без попередження' 0 '' preview_as 'docs: уроки' 'опис'
    expect 'preview: крок фази з рядком — без попередження' 0 '|створень 0' run_stub preview 'PR_TITLE=п16.5: probe' 'PR_BODY=Iter-Tag: iter-16.5'
    expect 'preview: нова назва' 0 '|створень 0' run_stub preview 'PR_BODY=Iter-Tag: iter-T.34'
    expect 'preview: назва зайнята' 1 '' run_stub preview 'PR_BODY=Iter-Tag: iter-T.33' "STUB_REF=commit $B"
    expect 'preview: недопустима назва' 1 '' run_stub preview 'PR_BODY=Iter-Tag: v1'
    expect 'preview: помилка API — не «вільна»' 1 '' run_stub preview 'PR_BODY=Iter-Tag: iter-T.34' 'STUB_REF=boom'

    # джоба tag: план
    expect 'plan: мерж без рядка' 0 '|створень 0' run_stub plan 'GITHUB_EVENT_NAME=pull_request' 'PR_BODY=x' "MERGE_SHA=$A"
    expect 'plan: мерж з рядком' 0 "tag=iter-T.34 sha=$A |створень 0" run_stub plan 'GITHUB_EVENT_NAME=pull_request' 'PR_BODY=Iter-Tag: iter-T.34' "MERGE_SHA=$A"
    expect 'plan: вручну' 0 "tag=iter-T.34 sha=$A |створень 0" run_stub plan 'GITHUB_EVENT_NAME=workflow_dispatch' 'INPUT_TAG=iter-T.34' "INPUT_SHA=$A"
    expect 'plan: вручну, короткий sha' 1 '' run_stub plan 'GITHUB_EVENT_NAME=workflow_dispatch' 'INPUT_TAG=iter-T.34' 'INPUT_SHA=6bbff27'
    expect 'plan: вручну, погана назва' 1 '' run_stub plan 'GITHUB_EVENT_NAME=workflow_dispatch' 'INPUT_TAG=iter-T.34;id' "INPUT_SHA=$A"
    expect 'plan: вручну, порожня назва' 1 '' run_stub plan 'GITHUB_EVENT_NAME=workflow_dispatch' 'INPUT_TAG=' "INPUT_SHA=$A"
    expect 'plan: коміт не в main' 1 '' run_stub plan 'GITHUB_EVENT_NAME=workflow_dispatch' 'INPUT_TAG=iter-T.34' "INPUT_SHA=$A" 'STUB_CMP=diverged'

    # джоба tag: запис
    expect 'put: тегу немає — створено' 0 '|створень 1' run_stub put 'TAG=iter-T.34' "SHA=$A"
    expect 'put: легкий тег на тому ж коміті' 0 '|створень 0' run_stub put 'TAG=iter-T.34' "SHA=$A" "STUB_REF=commit $A"
    expect 'put: анотований тег на тому ж коміті' 0 '|створень 0' run_stub put 'TAG=iter-T.34' "SHA=$A" "STUB_REF=tag $B" "STUB_TAGGED=$A"
    expect 'put: тег на іншому коміті' 1 '' run_stub put 'TAG=iter-T.34' "SHA=$A" "STUB_REF=commit $B"
    expect 'put: помилка API — не створює' 1 '' run_stub put 'TAG=iter-T.34' "SHA=$A" 'STUB_REF=boom'

    rm -f "$CALLS" "$GITHUB_OUTPUT"
    [ "$FAILED" = 0 ]
}

ERR="$(mktemp)"
trap 'rm -f "$ERR"' EXIT

case "${1:-}" in
--check) check_name "${2:-}" ;;
--preview) preview ;;
--plan) plan ;;
--put) put ;;
--self-test) self_test ;;
'') from_body "${PR_BODY:-}" ;;
*)
    echo "Використання: $0 [--check <назва> | --preview | --plan | --put | --self-test]" >&2
    exit 2
    ;;
esac
