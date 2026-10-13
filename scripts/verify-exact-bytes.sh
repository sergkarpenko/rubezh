#!/bin/bash
# verify-exact-bytes.sh
# Перевірка "exact-байти": порівняння файлів після генерації через пісочницю
# Використання: ./scripts/verify-exact-bytes.sh [--fix]
#   --fix: спробувати автоматично виправити розходження (лише для текстових файлів)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Кольори для виводу
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Файли, які потрібно перевіряти (текстові файли ядра та UI)
FILES_TO_CHECK=(
  "src/core/combat.ts"
  "src/core/map.ts"
  "src/core/ai.ts"
  "src/core/geo.ts"
  "src/core/mission.ts"
  "src/core/squad.ts"
  "src/main.ts"
  "src/bot.ts"
  "index.html"
)

# Файли, які не перевіряємо (бінарні, великі прототипи тощо)
SKIP_PATTERNS=(
  "node_modules/"
  "dist/"
  "docs/prototypes/"
  ".git/"
)

echo "=========================================="
echo "Перевірка exact-байти для проєкту Рубіж"
echo "=========================================="

# Функція для перевірки, чи файл є текстовим
is_text_file() {
  local file="$1"
  # Перевіряємо, чи файл містить лише друковані символи та переноси рядків
  if file "$file" | grep -qP '[^\x00-\x7F]'; then
    return 1  # Не текстовий (містить не-ASCII)
  fi
  # Перевіряємо на наявність нульових байтів
  if grep -qP '\x00' "$file" 2>/dev/null; then
    return 1  # Бінарний файл
  fi
  return 0  # Текстовий файл
}

# Функція для порівняння файлу з його git-версією
compare_file() {
  local file="$1"
  local fix_mode="$2"
  
  # Пропускаємо, якщо файл не існує
  if [ ! -f "$file" ]; then
    echo "${YELLOW}-- Пропускаю: $file (файл не існує)${NC}"
    return 0
  fi
  
  # Пропускаємо заборонені шаблони
  for pattern in "${SKIP_PATTERNS[@]}"; do
    if [[ "$file" == *"$pattern"* ]]; then
      echo "${YELLOW}-- Пропускаю: $file (заборонений шаблон)${NC}"
      return 0
    fi
  done
  
  # Отримуємо hash поточного файлу
  current_hash=$(sha256sum "$file" | awk '{print $1}')
  
  # Отримуємо hash версії у git (index або HEAD)
  if git diff --cached --quiet "$file" 2>/dev/null; then
    # Файл у staging area
    staged_hash=$(git hash-object "$file" | awk '{print $1}')
  else
    # Файл у HEAD
    staged_hash=$(git hash-object HEAD:"$file" 2>/dev/null || echo "")
  fi
  
  if [ -z "$staged_hash" ]; then
    # Файл новий (не в git)
    echo "${GREEN}[OK] Новий файл: $file${NC}"
    return 0
  fi
  
  if [ "$current_hash" != "$staged_hash" ]; then
    echo "${RED}[FAIL] РОЗХІДЖЕННЯ: $file${NC}"
    echo "   Поточний hash: $current_hash"
    echo "   Git hash:     $staged_hash"
    
    if [ "$fix_mode" = "--fix" ] && is_text_file "$file"; then
      echo "   ${YELLOW}-- Спроба автоматичного виправлення...${NC}"
      git checkout HEAD -- "$file" 2>/dev/null || git restore "$file" 2>/dev/null
      if [ "$current_hash" = "$(sha256sum "$file" | awk '{print $1}')" ]; then
        echo "   ${GREEN}[FIXED] Виправлено: $file${NC}"
        return 0
      else
        echo "   ${RED}[ERROR] Не вдалося виправити автоматично${NC}"
      fi
    fi
    return 1
  else
    echo "${GREEN}[OK] $file${NC}"
    return 0
  fi
}

# Головний цикл
echo ""
echo "--- Перевірка основних файлів ---"
all_ok=true
for file in "${FILES_TO_CHECK[@]}"; do
  if ! compare_file "$file" "$@"; then
    all_ok=false
  fi
done

# Додатково: перевіряємо всі TypeScript файли у src/
echo ""
echo "--- Додаткова перевірка усіх TypeScript файлів у src/ ---"
while IFS= read -r -d '' file; do
  if ! compare_file "$file" "$@"; then
    all_ok=false
  fi
done < <(find "$PROJECT_ROOT/src" -name "*.ts" -print0)

echo ""
if $all_ok; then
  echo "${GREEN}[OK] Усі файли у порядку! Exact-байти збережено.${NC}"
  exit 0
else
  echo "${RED}[FAIL] Виявлено розходження! Перевірте файли вище.${NC}"
  echo ""
  echo "Рекомендації:"
  echo "  1. Перевірте файли у пісочниці перед комітом"
  echo "  2. Використовуйте concatenation рядків замість template literals"
  echo "  3. Уникнійте екранування, яке може пошкодити вміст"
  exit 1
fi
