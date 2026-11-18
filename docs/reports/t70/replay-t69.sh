#!/bin/sh
# Т.70: звірка scripts/vibe-step.py зі скриптами з блоків плану Т.69 на даних Т.69 (PR #371).
# Обидва варіанти ганяються на тих самих вхідних файлах у копії репозиторію на ревізіях PR #371,
# результати порівнюються побайтно між собою і з файлами, які закомітив виконавець.
# Запуск з кореня репозиторію (клон із ревізіями 61c3689, 22ecbb8, 20c6192, ffc6ac9, 2ff48d3 і node_modules):
#   sh docs/reports/t70/replay-t69.sh
# Чекліст і таблиця поломок не переганяються: їхні вхідні файли збираються з документів 20c6192 —
# порівнюється лише те, що з них роблять docs і check. Прогін поломок — окремо (mutations, звіт Т.70).
set -eu
ROOT=$(pwd)
NEW="$ROOT/scripts/vibe-step.py"
W=/tmp/t70-replay O=/tmp/t70-replay-out  # копія репозиторію і файли порівняння
rm -rf "$W" "$O" /tmp/t69 /tmp/blocks /tmp/blocks2 /tmp/pr-body.md /tmp/pr-body-v2.md
mkdir -p "$W" "$O"
cp -a "$ROOT/.git" "$W/.git"
cd "$W"
ln -s "$ROOT/node_modules" node_modules
echo node_modules >> .git/info/exclude
git update-ref refs/remotes/origin/main 61c3689
git checkout -q -f 22ecbb8

# Вхідні файли — як у пісочниці виконавця: таблиця = блок table-plan (розбіжностей у Т.69 не було),
# підсумок і рядки чекліста — з комітованого звіту 20c6192.
mkdir -p /tmp/t69/checklist
node scripts/vibe-plan-blocks.mjs docs/plans/t69-fighter-last-lost.md /tmp/blocks >/dev/null
cp "$ROOT/docs/reports/t70/step-t69.txt" /tmp/blocks/step.txt
cp /tmp/blocks/table-plan.txt /tmp/t69/table.md
git show 20c6192:docs/reports/t69-fighter-last-lost.md > "$O/report-20c6192.md"
python3 - "$O/report-20c6192.md" <<'EOF'
import re, sys
r = open(sys.argv[1], encoding='utf-8').read()
s = re.search(r'^Навмисних поломок — .*$', r, re.M).group(0)
open('/tmp/t69/summary.md', 'w', encoding='utf-8').write(s + '\n')
keys = ['tsc', 'tsc-core', 'tsc-e2e', 'lint', 'format', 'test', 'docs', 'e2e']
rows = re.findall(r'^- `[^`]+` — (.+)$', r.split('## Чекліст перед PR')[1].split('## Метрики')[0], re.M)
assert len(rows) == len(keys), rows
for k, res in zip(keys, rows):
    open('/tmp/t69/checklist/' + k + '.txt', 'w', encoding='utf-8').write('22ecbb8\n' + res + '\n')
EOF
echo 22ecbb8 > /tmp/t69/mutations-head.txt

same() { cmp -s "$1" "$2" && echo "  однаково: $3" || { echo "  РІЗНИТЬСЯ: $3"; diff "$1" "$2" | head -20; FAIL=1; }; }
FAIL=0
# check читає звіт з ревізії HEAD, тож документи — комітом, як у виконавця; потім назад
commit() { git add -A docs && git -c user.name=replay -c user.email=replay@local commit -qm replay --no-verify; }

echo 'Частина 1 (до аудиту), ревізія 22ecbb8:'
node scripts/vibe-plan-blocks.mjs docs/plans/t69-fighter-last-lost.md /tmp/old >/dev/null
for b in checklist docs check; do cp "/tmp/old/$b-py.txt" "/tmp/t69/$b.py"; done
python3 /tmp/t69/checklist.py >/dev/null
cp /tmp/t69/checklist.md "$O/old-checklist.md"; cp /tmp/t69/failed.md "$O/old-failed.md"
python3 "$NEW" checklist >/dev/null
same "$O/old-checklist.md" /tmp/t69/checklist.md 'зведення чекліста'
same "$O/old-failed.md" /tmp/t69/failed.md 'що з чекліста не вдалося'
python3 /tmp/t69/docs.py >/dev/null
for f in docs/workflow.md docs/reports/t69-fighter-last-lost.md; do cp "$f" "$O/old-$(basename "$f")"; done
cp /tmp/t69/pr-body-draft.md "$O/old-draft.md"
commit; python3 /tmp/t69/check.py >/dev/null || true
cp /tmp/pr-body.md "$O/old-pr-body.md"
git reset -q --hard 22ecbb8
python3 "$NEW" docs >/dev/null
same "$O/old-workflow.md" docs/workflow.md 'docs/workflow.md'
same "$O/old-t69-fighter-last-lost.md" docs/reports/t69-fighter-last-lost.md 'звіт'
same "$O/old-draft.md" /tmp/t69/pr-body-draft.md 'чернетка опису PR'
git show 20c6192:docs/workflow.md > "$O/c-workflow.md"
same "$O/c-workflow.md" docs/workflow.md 'docs/workflow.md проти 20c6192'
same "$O/report-20c6192.md" docs/reports/t69-fighter-last-lost.md 'звіт проти 20c6192'
commit; python3 "$NEW" check | tail -2 | head -1 | sed 's/^/  check: /'
same "$O/old-pr-body.md" /tmp/pr-body.md 'опис PR (check)'
gh api repos/sergkarpenko/rubezh/pulls/371 --jq .body > "$O/pr371.md" 2>/dev/null && truncate -s -1 "$O/pr371.md" && grep -q 'Знахідок немає.' /tmp/pr-body.md && echo '  рядки звірки — «Знахідок немає.», як в описі PR #371' || true
git reset -q --hard 22ecbb8

echo 'Порція після аудиту, ревізія 2ff48d3 мінус документи порції (ffc6ac9):'
git checkout -q -f ffc6ac9
node scripts/vibe-plan-blocks.mjs docs/plans/t69-fighter-last-lost.md /tmp/blocks2 >/dev/null
node scripts/vibe-plan-blocks.mjs docs/plans/t69-fighter-last-lost.md /tmp/old2 >/dev/null
# step із ci_ok: урок lesson-v2 Т.69 містить «сценарій пройшов у CI» — саме те, що нова перевірка забороняє
python3 -c "
import ast; c = ast.literal_eval(open('$ROOT/docs/reports/t70/step-t69.txt', encoding='utf-8').read()); c['ci_ok'] = True
open('/tmp/blocks2/step.txt', 'w', encoding='utf-8').write(repr(c))"
cp "$ROOT/docs/reports/t70/step-t69.txt" /tmp/blocks2/step-no-ci.txt
# чекліст і таблиця — з 22ecbb8, як у Т.69: після них мінялись лише документи
cp /tmp/old2/docs-py-v2.txt /tmp/t69/docs-v2.py; cp /tmp/old2/check-py-v2.txt /tmp/t69/check-v2.py; cp /tmp/old2/handbook-py-v2.txt /tmp/t69/handbook.py
python3 /tmp/t69/handbook.py >/dev/null
python3 /tmp/t69/docs-v2.py --lesson-file /tmp/old2/lesson-v2.txt >/dev/null
for f in docs/workflow.md docs/reports/t69-fighter-last-lost.md docs/agents/common.md; do cp "$f" "$O/old2-$(basename "$f")"; done
commit; python3 /tmp/t69/check-v2.py >/dev/null || true
cp /tmp/pr-body-v2.md "$O/old-pr-body-v2.md"
git reset -q --hard ffc6ac9
python3 "$NEW" docs --v2 --lesson-file /tmp/blocks2/lesson-v2.txt >/dev/null
same "$O/old2-workflow.md" docs/workflow.md 'docs/workflow.md'
same "$O/old2-t69-fighter-last-lost.md" docs/reports/t69-fighter-last-lost.md 'звіт'
same "$O/old2-common.md" docs/agents/common.md 'рядок довідника (docs/agents/common.md)'
for f in docs/workflow.md docs/reports/t69-fighter-last-lost.md docs/agents/common.md; do git show "2ff48d3:$f" > "$O/c2-$(basename "$f")"; done
same "$O/c2-workflow.md" docs/workflow.md 'docs/workflow.md проти 2ff48d3'
same "$O/c2-t69-fighter-last-lost.md" docs/reports/t69-fighter-last-lost.md 'звіт проти 2ff48d3'
same "$O/c2-common.md" docs/agents/common.md 'docs/agents/common.md проти 2ff48d3'
commit; python3 "$NEW" check --v2 | tail -2 | head -1 | sed 's/^/  check --v2: /'
same "$O/old-pr-body-v2.md" /tmp/pr-body-v2.md 'опис PR після аудиту (check)'
same "$O/pr371.md" /tmp/pr-body-v2.md 'опис PR після аудиту проти опису PR #371 на GitHub'
git reset -q --hard ffc6ac9

echo 'Заборона «CI» (кандидат 74): урок lesson-v2 Т.69 без ci_ok у step:'
cp /tmp/blocks2/step-no-ci.txt /tmp/blocks2/step.txt
if python3 "$NEW" docs --v2 --lesson-file /tmp/blocks2/lesson-v2.txt 2>"$O/ci.err"; then echo '  НЕ ЗУПИНИВСЯ'; FAIL=1; else echo "  зупинився: $(tail -1 "$O/ci.err" | cut -c1-120)"; fi
git checkout -q -- docs
exit $FAIL
