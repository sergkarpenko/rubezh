#!/bin/sh
# Т.70: звірка scripts/vibe-step.py зі скриптами з блоків плану Т.69 на даних Т.69 (PR #371) і перевірка нових гілок.
# Обидва варіанти ганяються на тих самих вхідних файлах у копії репозиторію на ревізіях PR #371; перед кожним запуском
# нового скрипта його вихідні файли видаляються, код завершення перевіряється (аудит Т.70, знахідка 1).
# Запуск з кореня репозиторію (клон із ревізіями 61c3689, 22ecbb8, 20c6192, ffc6ac9, 2ff48d3 і node_modules;
# ще потрібні gh з доступом до PR #371 і chromium у /opt/pw-browsers — частина 4):
#   sh docs/reports/t70/replay-t69.sh
# Чекліст і таблиця поломок для docs не переганяються: їхні вхідні файли збираються з документів 20c6192.
set -eu
ROOT=$(pwd)
NEW="$ROOT/scripts/vibe-step.py"
W=/tmp/t70-replay O=/tmp/t70-replay-out # копія репозиторію і файли порівняння
rm -rf "$W" "$O" /tmp/t69 /tmp/blocks /tmp/blocks2 /tmp/old /tmp/old2 /tmp/pr-body.md /tmp/pr-body-v2.md
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
unset GH_TOKEN || true
gh api repos/sergkarpenko/rubezh/pulls/371 --jq .body > "$O/pr371.md"
truncate -s -1 "$O/pr371.md" # --jq дописує перенос рядка

FAIL=0
same() { if cmp -s "$1" "$2"; then echo "  однаково: $3"; else echo "  РІЗНИТЬСЯ: $3"; diff "$1" "$2" | head -20; FAIL=1; fi; }
ok() { if "$@" >"$O/last.out" 2>&1; then :; else echo "  ВПАВ (код $?): $*"; tail -n 3 "$O/last.out"; FAIL=1; fi; }
# check: код 0 лише без знахідок; рядок «Знахідок» — з виводу, код — не з конвеєра
check_ok() { if "$@" >"$O/check.out" 2>&1; then echo "  $(grep '^Знахід' "$O/check.out" | tail -n 1) (код 0): $*"; else echo "  ВПАВ (код $?): $*"; tail -n 3 "$O/check.out"; FAIL=1; fi; }
stops() { # команда має відмовити з кодом не 0 і повідомленням, що містить $1
  want=$1; shift
  if "$@" >"$O/stop.out" 2>&1; then echo "  НЕ ЗУПИНИВСЯ: $*"; FAIL=1
  elif grep -q -- "$want" "$O/stop.out"; then echo "  зупинився: $(grep -- "$want" "$O/stop.out" | tail -n 1 | cut -c1-110)"
  else echo "  ЗУПИНИВСЯ НЕ ТАК: $(tail -n 1 "$O/stop.out" | cut -c1-110)"; FAIL=1; fi
}
# check читає звіт з ревізії HEAD, тож документи — комітом, як у виконавця; потім назад
commit() { git add -A docs && git -c user.name=replay -c user.email=replay@local commit -qm replay --no-verify; }

echo 'Частина 1 (до аудиту), ревізія 22ecbb8:'
node scripts/vibe-plan-blocks.mjs docs/plans/t69-fighter-last-lost.md /tmp/old >/dev/null
for b in checklist docs check; do cp "/tmp/old/$b-py.txt" "$O/$b.py"; done
ok python3 "$O/checklist.py"
cp /tmp/t69/checklist.md "$O/old-checklist.md"; cp /tmp/t69/failed.md "$O/old-failed.md"
ok python3 "$O/docs.py"
for f in docs/workflow.md docs/reports/t69-fighter-last-lost.md; do cp "$f" "$O/old-$(basename "$f")"; done
cp /tmp/t69/pr-body-draft.md "$O/old-draft.md"
commit; ok python3 "$O/check.py"
cp /tmp/pr-body.md "$O/old-pr-body.md"
git reset -q --hard 22ecbb8
rm -f /tmp/pr-body.md /tmp/t69/pr-body-draft.md /tmp/t69/checklist.md /tmp/t69/failed.md /tmp/t69/checklist-head.txt
ok python3 "$NEW" checklist
same "$O/old-checklist.md" /tmp/t69/checklist.md 'зведення чекліста'
same "$O/old-failed.md" /tmp/t69/failed.md 'що з чекліста не вдалося'
ok python3 "$NEW" docs
same "$O/old-workflow.md" docs/workflow.md 'docs/workflow.md'
same "$O/old-t69-fighter-last-lost.md" docs/reports/t69-fighter-last-lost.md 'звіт'
same "$O/old-draft.md" /tmp/t69/pr-body-draft.md 'чернетка опису PR'
git show 20c6192:docs/workflow.md > "$O/c-workflow.md"
same "$O/c-workflow.md" docs/workflow.md 'docs/workflow.md проти 20c6192'
same "$O/report-20c6192.md" docs/reports/t69-fighter-last-lost.md 'звіт проти 20c6192'
commit; check_ok python3 "$NEW" check
same "$O/old-pr-body.md" /tmp/pr-body.md 'опис PR (check)'
# опис PR #371 на GitHub — уже після аудиту (рядки звірки «аудит — після»): з ним звіряє частина 2
git reset -q --hard 22ecbb8

echo 'Частина 2 — порція після аудиту, ревізія ffc6ac9 (2ff48d3 без документів порції):'
git checkout -q -f ffc6ac9
node scripts/vibe-plan-blocks.mjs docs/plans/t69-fighter-last-lost.md /tmp/blocks2 >/dev/null
node scripts/vibe-plan-blocks.mjs docs/plans/t69-fighter-last-lost.md /tmp/old2 >/dev/null
# step із ci_ok: урок lesson-v2 Т.69 містить «сценарій пройшов у CI» — саме те, що нова перевірка забороняє
python3 -c "
import ast; c = ast.literal_eval(open('$ROOT/docs/reports/t70/step-t69.txt', encoding='utf-8').read()); c['ci_ok'] = True
open('/tmp/blocks2/step.txt', 'w', encoding='utf-8').write(repr(c))"
# чекліст і таблиця — з 22ecbb8, як у Т.69: після них мінялись лише документи
cp /tmp/old2/docs-py-v2.txt "$O/docs-v2.py"; cp /tmp/old2/check-py-v2.txt "$O/check-v2.py"; cp /tmp/old2/handbook-py-v2.txt "$O/handbook.py"
ok python3 "$O/handbook.py"
ok python3 "$O/docs-v2.py" --lesson-file /tmp/old2/lesson-v2.txt
for f in docs/workflow.md docs/reports/t69-fighter-last-lost.md docs/agents/common.md; do cp "$f" "$O/old2-$(basename "$f")"; done
commit; ok python3 "$O/check-v2.py"
cp /tmp/pr-body-v2.md "$O/old-pr-body-v2.md"
git reset -q --hard ffc6ac9
rm -f /tmp/pr-body-v2.md /tmp/t69/pr-body-draft.md
ok python3 "$NEW" docs --v2 --lesson-file /tmp/blocks2/lesson-v2.txt
same "$O/old2-workflow.md" docs/workflow.md 'docs/workflow.md'
same "$O/old2-t69-fighter-last-lost.md" docs/reports/t69-fighter-last-lost.md 'звіт'
same "$O/old2-common.md" docs/agents/common.md 'рядок довідника (docs/agents/common.md)'
for f in docs/workflow.md docs/reports/t69-fighter-last-lost.md docs/agents/common.md; do git show "2ff48d3:$f" > "$O/c2-$(basename "$f")"; done
same "$O/c2-workflow.md" docs/workflow.md 'docs/workflow.md проти 2ff48d3'
same "$O/c2-t69-fighter-last-lost.md" docs/reports/t69-fighter-last-lost.md 'звіт проти 2ff48d3'
same "$O/c2-common.md" docs/agents/common.md 'docs/agents/common.md проти 2ff48d3'
commit; check_ok python3 "$NEW" check --v2
same "$O/old-pr-body-v2.md" /tmp/pr-body-v2.md 'опис PR після аудиту (check)'
same "$O/pr371.md" /tmp/pr-body-v2.md 'опис PR після аудиту проти опису PR #371 на GitHub'
check_ok python3 "$NEW" check --v2 --pr 371
git reset -q --hard ffc6ac9

echo 'Частина 3 — відмови (на ffc6ac9):'
cp "$ROOT/docs/reports/t70/step-t69.txt" /tmp/blocks2/step.txt
stops 'урок: у тексті є «CI»' python3 "$NEW" docs --v2 --lesson-file /tmp/blocks2/lesson-v2.txt
git checkout -q -- docs
cp /tmp/blocks2/limits-v2.txt "$O/limits-v2.bak"; printf '\n- (в) зелене в CI' >> /tmp/blocks2/limits-v2.txt
stops 'limits-v2: у тексті є «CI»' python3 "$NEW" docs --v2
cp "$O/limits-v2.bak" /tmp/blocks2/limits-v2.txt; git checkout -q -- docs
cp /tmp/blocks2/report-v2.txt "$O/report-v2.bak"; printf '\nЧеки CI зелені.' >> /tmp/blocks2/report-v2.txt
stops 'report-v2: у тексті є «CI»' python3 "$NEW" docs --v2
cp "$O/report-v2.bak" /tmp/blocks2/report-v2.txt; git checkout -q -- docs
# блок step-v2 (порція зі зміною тесту) має перевагу над step: з ci_ok у ньому той самий урок проходить
python3 -c "
import ast; c = ast.literal_eval(open('/tmp/blocks2/step.txt', encoding='utf-8').read()); c['ci_ok'] = True
open('/tmp/blocks2/step-v2.txt', 'w', encoding='utf-8').write(repr(c))"
ok python3 "$NEW" docs --v2 --lesson-file /tmp/blocks2/lesson-v2.txt
echo '  step-v2 прочитано замість step'
rm /tmp/blocks2/step-v2.txt; git checkout -q -- docs
echo 61c3689 > /tmp/t69/mutations-head.txt
stops 'таблиця поломок' python3 "$NEW" docs --v2
echo 22ecbb8 > /tmp/t69/mutations-head.txt; git checkout -q -- docs
stops 'Зайві аргументи: --help' python3 "$NEW" docs --help
stops 'Зайві аргументи: --lessonfile' python3 "$NEW" docs --lessonfile /tmp/blocks2/lesson-v2.txt
stops '--lesson-file без значення' python3 "$NEW" docs --lesson-file
if [ -z "$(git status --porcelain)" ]; then echo '  після відмов дерево чисте'; else echo '  ДЕРЕВО НЕ ЧИСТЕ'; git status --short | head; FAIL=1; fi

echo 'Частина 4 — нові гілки (на 22ecbb8):'
git checkout -q -f 22ecbb8
# рядок довідника блоком handbook у першій частині: дописується останнім рядком розділу виконавця
cp /tmp/old2/handbook-v2.txt /tmp/blocks/handbook.txt
before=$(wc -l < docs/agents/common.md)
ok python3 "$NEW" docs
if [ "$(tail -n 1 docs/agents/common.md)" = "$(cat /tmp/blocks/handbook.txt)" ] && [ "$(wc -l < docs/agents/common.md)" -eq $((before + 1)) ]; then
  echo '  handbook: рядок дописано останнім, +1 рядок'; else echo '  handbook: НЕ ТАК'; FAIL=1; fi
commit
# порція після аудиту з іншою датою в рядку: замінити, а не дописати другий (аудит Т.70, знахідка 3)
sed 's/18\.11\.2026/19.11.2026/' /tmp/old2/handbook-v2.txt > /tmp/blocks2/handbook-v2.txt
for b in table-plan limits report record pr-body; do cp "/tmp/blocks/$b.txt" "/tmp/blocks2/$b-v2.txt"; done
ok python3 "$NEW" docs --v2
n=$(sed -n '/^## Лише для Mistral Vibe Code/,$p' docs/agents/common.md | grep -c '^- \*\*Т.69 (' || true)
if [ "$n" -eq 1 ] && grep -q '^- \*\*Т.69 (19.11.2026)' docs/agents/common.md; then echo '  handbook-v2 з іншою датою: замінено, рядок один'; else echo "  handbook-v2: рядків $n"; FAIL=1; fi
git reset -q --hard 22ecbb8
# обхід e2e: повний chromium потрібної ревізії є, headless shell — ні (аудит Т.70, знахідка 5)
REV=$(node -e "process.stdout.write(require('@playwright/test').chromium.executablePath())" | sed -n 's|.*/chromium-\([0-9]*\)/.*|\1|p')
FAKE=/tmp/t70-pw
rm -rf "$FAKE"; mkdir -p "$FAKE"
ln -s "$(ls -d /opt/pw-browsers/chromium-[0-9]* | head -n 1)" "$FAKE/chromium-$REV"
ok env PLAYWRIGHT_BROWSERS_PATH="$FAKE" python3 "$NEW" checklist e2e
if grep -q 'пройшла (з обходом `E2E_CHROME`: chromium-' /tmp/t69/checklist/e2e.txt; then echo "  e2e без headless shell ревізії $REV: $(tail -n 1 /tmp/t69/checklist/e2e.txt)"
else echo "  e2e: $(tail -n 1 /tmp/t69/checklist/e2e.txt)"; FAIL=1; fi
rm -rf "$FAKE"
exit $FAIL
