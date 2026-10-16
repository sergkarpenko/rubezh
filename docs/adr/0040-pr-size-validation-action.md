# ADR-0040: GitHub Action для валідації розміру PR

**Статус:** accepted  
**Дата:** 2026-10-15  
**Автор:** Vibe Code  
**Заміняє:** -  
**Суперечить:** -  

---

## Контекст

ADR-0036 вводить обмеження на розмір PR до 500 рядків зміни. однак, на даний момент це правило не автоматизовано і покладається на ручну перевірку. Це призводить до:

1. **Порушень правила:** Рев'юери можуть не помітити великий PR
2. **Суб'єктивності:** Різні люди по-різному рахують рядки
3. **Запізнілих виявлень:** Порушення виявляється пізно, коли PR вже готовий до merge

---

## Рішення

Створити GitHub Action, який автоматично перевіряє розмір PR і:
1. **Блокує merge**, якщо PR перевищує 500 рядків
2. **Додає label** з інформацією про розмір
3. **Попереджає** автора в коментарі до PR

### Реалізація

Створити новий workflow файл: `.github/workflows/pr-size-check.yml`

```yaml
name: PR Size Check

on:
  pull_request:
    types: [opened, synchronize, reopened, edited]

jobs:
  check-pr-size:
    name: Check PR Size
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
      contents: read
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Get PR diff
        id: pr_diff
        run: |
          PR_NUMBER=${{ github.event.pull_request.number }}
          git fetch origin pull/$PR_NUMBER/head:pr-branch
          git diff --stat origin/main..pr-branch > diff.stat
          
          # Отримуємо кількість змінених рядків
          CHANGED_LINES=$(git diff --numstat origin/main..pr-branch | awk '{sum+=$1+$2} END {print sum}')
          echo "changed_lines=$CHANGED_LINES" >> $GITHUB_OUTPUT
          
          # Зберігаємо детальний diff для логування
          git diff origin/main..pr-branch > diff.txt
          echo "diff_length=$(wc -l < diff.txt)" >> $GITHUB_OUTPUT

      - name: Check size limit
        id: size_check
        run: |
          LIMIT=500
          CHANGED_LINES=${{ steps.pr_diff.outputs.changed_lines }}
          
          echo "PR changed lines: $CHANGED_LINES"
          
          if [ "$CHANGED_LINES" -gt "$LIMIT" ]; then
            echo "exceeds_limit=true" >> $GITHUB_OUTPUT
            echo "excess=$((CHANGED_LINES - LIMIT))" >> $GITHUB_OUTPUT
          else
            echo "exceeds_limit=false" >> $GITHUB_OUTPUT
            echo "excess=0" >> $GITHUB_OUTPUT
          fi

      - name: Add size label
        if: steps.size_check.outputs.exceeds_limit == 'false'
        uses: actions/github-script@v7
        with:
          script: |
            const { data: labels } = await github.rest.issues.listLabelsOnIssue({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number
            });
            
            const sizeLabel = labels.find(l => l.name.startsWith('size:'));
            if (sizeLabel) {
              await github.rest.issues.removeLabel({
                owner: context.repo.owner,
                repo: context.repo.repo,
                issue_number: context.issue.number,
                name: sizeLabel.name
              });
            }
            
            const changedLines = ${{ steps.pr_diff.outputs.changed_lines }};
            let label;
            if (changedLines < 100) label = 'size:xs';
            else if (changedLines < 300) label = 'size:s';
            else if (changedLines < 500) label = 'size:m';
            else label = 'size:l';
            
            await github.rest.issues.addLabels({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
              labels: [label]
            });

      - name: Add large size label and comment
        if: steps.size_check.outputs.exceeds_limit == 'true'
        uses: actions/github-script@v7
        with:
          script: |
            const changedLines = ${{ steps.pr_diff.outputs.changed_lines }};
            const excess = ${{ steps.size_check.outputs.excess }};
            const limit = 500;
            
            // Додаємо label
            await github.rest.issues.addLabels({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
              labels: ['size:xl']
            });
            
            // Додаємо коментар
            await github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
              body: `⚠️ **PR Size Warning**\n\nThis PR has **${changedLines} lines changed** (limit: ${limit}).\n\nPlease split this PR into smaller chunks (≤${limit} lines each) as per [ADR-0036](https://github.com/sergkarpenko/rubezh/blob/main/docs/adr/0036-pr-size-limit.md).\n\nExcess: **${excess} lines** above the limit.`
            });

      - name: Fail if exceeds limit
        if: steps.size_check.outputs.exceeds_limit == 'true'
        run: |
          echo "::error::PR size exceeds 500 lines limit (${{ steps.pr_diff.outputs.changed_lines }} lines changed)"
          echo "Please split this PR into smaller chunks as per ADR-0036"
          exit 1
```

---

## Наслідки

### Переваги

1. **Автоматична перевірка:** Не потрібно ручно рахувати рядки
2. **Раннє попередження:** Автор дізнається про проблему відразу після пушу
3. **Блокування merge:** Неможливо змержити PR, який порушує правило
4. **Візуальна індикація:** Labels показують розмір PR в списку
5. **Прозорість:** Всі бачать, який PR великий

### Недоліки

1. **Додатковий час CI:** Кожен PR буде витрачати декілька секунд на перевірку
2. **Складність обходу:** Якщо потрібно зробити виняток, доведеться тимчасово вимикати Action
3. **Помилки рахунку:** Можливі розбіжності з ручним підрахунком

### Ризики

1. **False positives:** Action може блокувати PR, який насправді в межах ліміту
2. **False negatives:** Action може пропустити PR, який перевищує ліміт
3. **Затримка CI:** Якщо Action повільний, це може уповільнити весь процес

---

## Альтернативи

### Альтернатива 1: Використання існуючого Action

Використати ready-made Action з GitHub Marketplace:
- [size-label-action](https://github.com/marketplace/actions/size-label-action)
- [pr-size-action](https://github.com/marketplace/actions/pr-size-action)

**Плюси:** Швидше впровадження, менше коду для підтримки
**Мінуси:** Менше контролю, можливі обмеження

### Альтернатива 2: Тільки label без блокування

Додавати тільки label з розміром, але не блокувати merge.

**Плюси:** менше обмежень, більше гнучкості
**Мінуси:** Не гарантує дотримання правила

### Альтернатива 3: Попередження в status check

Додати status check, який показує попередження, але не блокує merge.

**Плюси:** М'якше впровадження
**Мінуси:** Не ефективне для вимушеного дотримання правила

---

## Реалізація

### Крок 1: Створення workflow файлу

```bash
mkdir -p .github/workflows
touch .github/workflows/pr-size-check.yml
```

### Крок 2: Налаштування в GitHub

1. Переконатися, що workflow має права на:
   - Читання репозиторію
   - Запис коментарів до PR
   - Керування labels

2. Додати вимогу в Branch Protection для `main`:
   - Require status checks to pass: ✅
   - Додати `pr-size-check` до списку обов'язкових checks

### Крок 3: Тестування

Створити тестовий PR і перевірити:
- Чи додається label
- Чи з'являється коментар при перевищенні ліміту
- Чи блокується merge при перевищенні

### Крок 4: Документування

Оновити:
- `docs/workflow.md` — додати інформацію про автоматичну перевірку
- `AGENTS.md` — додати посилання на ADR-0040

---

## Вимоги до комітів

```bash
chore(ci): add PR size check workflow (ADR-0040)
docs(adr): ADR-0040 GitHub Action for PR size validation
docs(workflow): document PR size validation process
```

---

## Залежності

- **ADR-0028:** Delivery via PR + merge commit (Action працює з PR)
- **ADR-0034:** Codecov patch gate (аналогічний підхід до status checks)
- **ADR-0036:** PR size limit (цей ADR автоматизує перевірку)
