# 0035. Звіт Codecov на PR — гейт codecov/patch стає реальним

- Статус: proposed
- Дата: 2026-10-14
- Supersedes: (доповнює ADR-0025, ADR-0034)

## Контекст

ADR-0034 зробив `codecov/patch` required status check з target 95% з `codecov.yml`. Але ADR-0025 свідомо не додав завантаження покриття у `ci.yml` (PR-гейт): «дублювати завантаження на Codecov не треба: те робить preview.yml на push у main». Наслідок: на PR Codecov не отримує звіт, чек `codecov/patch` вічно висить у «Expected — Waiting for status to be reported» і **блокує мердж** (виявлено на PR #51 одразу після додавання чека власником). Гейт без джерела даних — не гейт, а пастка.

## Рішення

Ми додаємо крок завантаження покриття на Codecov у `ci.yml` (job `test`, після `npm run test:coverage`, який уже генерує `dist/coverage/coverage-final.json`):

```yaml
- name: Codecov
  uses: codecov/codecov-action@v7
  with:
    files: dist/coverage/coverage-final.json
    token: ${{ secrets.CODECOV_TOKEN }}
```

Той самий крок і токен, що й у `preview.yml` (П3.1). Тепер на кожному PR: тести → покриття → Codecov рахує patch проти 95% (`codecov.yml`, ADR-0034) → чек `codecov/patch` зеленіє або червоніє. Для дифів без нових рядків коду (доки) Codecov репортить patch як «no lines» — чек зелений, доки не блокують мердж. Завантаження на push у main лишається у `preview.yml` (для project-тренду); дублювання припустиме — це різні події (pull_request vs push) і Codecov їх розділяє.

## Наслідки

Гейт ADR-0034 стає функціональним: PR з patch-покриттям < 95% не змерджиться, чек більше не висить у «Waiting». Ціна: +1 крок CI на PR (~5–10 с, завантаження одного JSON); дублювання звітів для мерж-коміту (PR + push) — Codecov дедуплікує за commit SHA. Зміна workflow-файлу — з ADR у тому ж коміті (ADR-0018), що виконано цим ADR.
