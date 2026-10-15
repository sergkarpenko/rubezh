#!/bin/sh
# Pre-commit hook для проєкту Рубіж
# Викликається з .husky/pre-commit (Husky, ADR-0014)
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
    # Перевіряємо, чи змінюються заборонені файли
    # (package.json — правило 1b за ADR-0012; .github/workflows/ — правило 1c за ADR-0018;
    #  src/ui/ виключено з захисту власником 2026-10-15: застаріле правило прототипів
    #  React — архів у docs/prototypes, за ADR-0037 у src/ui/* живуть модулі UI)
    if git diff --cached --name-only | grep -qE '(tsconfig\.json|vite\.config\.ts)'; then
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

# 1c. Workflow-файли лише з ADR (ADR-0018): .github/workflows/ у коміті → docs/adr/ у тому ж коміті
if git diff --cached --name-only | grep -qE '^\.github/workflows/'; then
    if git diff --cached --name-only | grep -qE '^docs/adr/'; then
        echo "[OK] workflow-файли з ADR (процес ADR-0018)"
    else
        echo "[FAIL] .github/workflows/ БЕЗ ADR! Зміни CI/CD — лише за ADR-0018:"
        echo "       ADR у docs/adr/ у тому ж коміті; відповідність ADR вказівці власника перевіряється на рев'ю"
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
