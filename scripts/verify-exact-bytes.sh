#!/bin/bash
# verify-exact-bytes.sh
# Перевірка "exact-байти": робоча копія файла має байт-у-байт збігатися
# з версією в git-індексі (тим, що комітиться). Порівняння — через blob-hash
# git (портувально: без sha256sum/grep -P, яких немає на macOS).
# Використання: ./scripts/verify-exact-bytes.sh [--fix]
#   --fix: відкинути локальні зміни текстового файла (git checkout -- <file>)
#
# П13 (Фаза 2): полагоджено падіння "$2: unbound variable" (compare_file
# викликався без аргумента fix_mode) і саму логіку порівняння — sha256sum
# проти git-hash не збігається ніколи; --fix тепер відновлює з індексу.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

# Кольори для виводу
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

say() { printf '%b\n' "$1"; } # printf замість echo: echo у bash не розкриває \033

# Файли, які потрібно перевіряти (текстові файли ядра та UI)
FILES_TO_CHECK=(
  "src/core/combat.ts"
  "src/core/map.ts"
  "src/core/ai.ts"
  "src/core/ai-utils.ts"
  "src/core/geo.ts"
  "src/core/mission.ts"
  "src/core/squad.ts"
  "src/main.ts"
  "src/core/ai-bot.ts"
  "src/core/intercept-bot.ts"
  "index.html"
)

# Файли, які не перевіряємо (бінарні, великі прототипи тощо)
SKIP_PATTERNS=(
  "node_modules/"
  "dist/"
  "docs/prototypes/"
  ".git/"
)

say "=========================================="
say "Перевірка exact-байти для проєкту Рубіж"
say "=========================================="

# Текстовий файл: `file` повертає "text" для текстових (UTF-8 укр. — теж),
# "data" для бінарних. Без grep -P (не підтримується BSD grep на macOS).
is_text_file() {
  local f="$1"
  file "$f" | grep -qi 'text'
}

# Порівняння робочої копії з git-індексом: blob-hash'и мають збігатися.
compare_file() {
  local file="$1"
  local fix_mode="${2:-}"

  # Пропускаємо, якщо файл не існує
  if [ ! -f "$file" ]; then
    say "${YELLOW}-- Пропускаю: $file (файл не існує)${NC}"
    return 0
  fi

  # Пропускаємо заборонені шаблони
  for pattern in "${SKIP_PATTERNS[@]}"; do
    if [[ "$file" == *"$pattern"* ]]; then
      say "${YELLOW}-- Пропускаю: $file (заборонений шаблон)${NC}"
      return 0
    fi
  done

  # Blob-hash версії в індексі (порожньо — файл не відстежується git)
  local index_blob
  index_blob=$(git ls-files -s -- "$file" | awk '{print $2}')
  if [ -z "$index_blob" ]; then
    say "${GREEN}[OK] Не відстежується git (новий): $file${NC}"
    return 0
  fi

  # Blob-hash робочої копії — канонічне байтове порівняння git
  local work_blob
  work_blob=$(git hash-object "$file")
  if [ "$work_blob" = "$index_blob" ]; then
    say "${GREEN}[OK] $file${NC}"
    return 0
  fi

  say "${RED}[FAIL] РОЗХОДЖЕННЯ: $file${NC}"
  say "   Робоча копія: $work_blob"
  say "   Git-індекс:   $index_blob"

  if [ "$fix_mode" = "--fix" ] && is_text_file "$file"; then
    say "   ${YELLOW}-- Відкидаю локальні зміни (git checkout -- $file)...${NC}"
    git checkout -- "$file"
    if [ "$(git hash-object "$file")" = "$index_blob" ]; then
      say "   ${GREEN}[FIXED] Виправлено: $file${NC}"
      return 0
    fi
    say "   ${RED}[ERROR] Не вдалося виправити автоматично${NC}"
  fi
  return 1
}

# Головний цикл
say ""
say "--- Перевірка основних файлів ---"
all_ok=true
for file in "${FILES_TO_CHECK[@]}"; do
  compare_file "$file" "$@" || all_ok=false
done

# Додатково: решта TypeScript файлів у src/ (без дублів зі списком вище)
say ""
say "--- Додаткова перевірка TypeScript файлів у src/ ---"
# без declare -A (macOS — bash 3.2, асоціативних масивів немає)
while IFS= read -r -d '' file; do
  case " ${FILES_TO_CHECK[*]} " in
    *" $file "*) continue ;;
  esac
  compare_file "$file" "$@" || all_ok=false
done < <(find src -name '*.ts' -print0)

say ""
if $all_ok; then
  say "${GREEN}[OK] Усі файли у порядку! Exact-байти збережено.${NC}"
  exit 0
else
  say "${RED}[FAIL] Виявлено розходження! Перевірте файли вище.${NC}"
  say ""
  say "Рекомендації:"
  say "  1. Перевірте файли у пісочниці перед комітом"
  say "  2. Використовуйте конкатенацію рядків замість template literals"
  say "  3. Уникайте екранування, яке може пошкодити вміст"
  exit 1
fi
