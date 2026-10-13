#!/bin/sh
# Pre-commit hook для проєкту Рубіж
# Встановлення: ln -s ../../scripts/pre-commit.sh .git/hooks/pre-commit
# 
# Перевіряє:
# 1. Тести проходять (npm test)
# 2. Exact-байти збережено
# 3. AGENTS.md дотримується

set -e

echo "=========================================="
echo "Pre-commit hook: Рубіж"
echo "=========================================="

# 1. Перевірка AGENTS.md rules (проста перевірка)
echo ""
echo "--- Перевірка правил AGENTS.md ---"
if [ -f "AGENTS.md" ]; then
    # Перевіряємо, чи змінюються заборонені файли (package.json — окремо, правило 1b за ADR-0012)
    if git diff --cached --name-only | grep -qE '(src/ui/|\.github/workflows/|tsconfig\.json|vite\.config\.ts)'; then
        echo "[FAIL] ЗМІНЕНО ЗАБОРОНЕНИЙ ФАЙЛ! Див. AGENTS.md"
        git diff --cached --name-only | grep -E '(src/ui/|\.github/workflows/|tsconfig\.json|vite\.config\.ts)'
        echo ""
        echo "Дію заборонено. Внесіть зміни у коміт окремо або зверніться до власнику."
        exit 1
    fi
    echo "[OK] Правила AGENTS.md дотримано"
else
    echo "[WARN] AGENTS.md не знайдено"
fi

# 1b. Залежності лише з ADR (ADR-0012): package.json у коміті → docs/adr/ у тому ж коміті
if git diff --cached --name-only | grep -qE '^package\.json$'; then
    if git diff --cached --name-only | grep -qE '^docs/adr/'; then
        echo "[OK] package.json з ADR (процес ADR-0012)"
    else
        echo "[FAIL] package.json БЕЗ ADR! Залежності — лише за ADR-0012:"
        echo "       ADR + явна авторизація власника, окремий коміт chore(deps):"
        exit 1
    fi
fi

# 2. Запуск тестів
echo ""
echo "--- Запуск тестів (npm test) ---"
if npm test > /tmp/rubezh-test-output.txt 2>&1; then
    echo "[OK] Тести пройшли успішно"
else
    echo "[FAIL] Тести не пройшли!"
    echo ""
    echo "Остання частина виводу:"
    tail -20 /tmp/rubezh-test-output.txt
    exit 1
fi

# 3. Перевірка exact-байти (якщо скрипт існує)
echo ""
echo "--- Перевірка exact-байти ---"
if [ -f "scripts/verify-exact-bytes.sh" ]; then
    if ! ./scripts/verify-exact-bytes.sh; then
        echo "[FAIL] Виявлено розходження exact-байти!"
        exit 1
    fi
else
    echo "[WARN] Скрипт verify-exact-bytes.sh не знайдено, пропускаю"
fi

# 4. Додаткові перевірки
echo ""
echo "[OK] Pre-commit hook завершено успішно!"
echo ""
echo "Перед пушем не забудьте:"
echo "  - Перевірити превью: https://sergkarpenko.github.io/rubezh/"
echo "  - Додати тег ітерації (iter-X.Y) після валідації людиною"

exit 0
