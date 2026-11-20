# Т.82 — проба аудиту PR через Mistral Vibe CLI в CI (ADR-0102)

Дата: 20.11.2026. PR #397. Модель сесії — Opus 5.5 medium.

## Навіщо

`mistral-audit` з 20.11 ≈ 13:31 UTC отримує 402 `billing_wallet_depleted`: прямі виклики API на плані Team оплачуються з гаманця ($0), бюджет плану покриває лише Vibe Code. Питання кроку: чи працює аудит ключем Vibe у CI, хто його оплачує і чи дає він знахідки понад аудитора для мержу.

## Що зроблено

- Секрет `MISTRAL_VIBE_API_KEY`: ключ Vibe скопійовано кнопкою в Code › Extensions і вставлено в поле секрету GitHub у Chrome власника; значення сесія не бачила. Окремого ключа типу Vibe адмінка не створює («New key» дає ключ Studio).
- `.github/workflows/vibe-audit.yml`, `scripts/audit-vibe-cli.mjs` (самоперевірка: чисті функції, межі числами і повний прохід `audit()` на тимчасовому git-репозиторії з підставними GitHub і Vibe).
- Навмисні поломки скрипта (вимкнути вирізання ключа, лишити `GITHUB_TOKEN` у Vibe, читати цитати з робочої теки, зарахувати цитату з дифа для неіснуючого файла, вважати код 3 успіхом, прибрати `--disabled-tools`, прибрати `try` навколо аудиту, ігнорувати збій встановлення) — 8 з 8 спіймано самоперевіркою.

## Що з'ясовано про Vibe CLI 3.1.3 (підставний сервер, локально)

- Неінтерактивний режим: `--prompt-file`, `--output text` — у stdout лише остання відповідь; `--output-dir` пише `export.json` (`outcome`, `stop_reason`, `error`, `usage`, `cost_usd`, `steps`).
- `bash` без `--auto-approve` відхиляється («Tool execution denied by approval callback»); `write_file` без `--auto-approve` проходить; `--disabled-tools write_file/edit` діє лише з `--auto-approve`; `[tools.*] permission` у `config.toml` на це не впливає. Вбудована модель `mistral-large-4-0` (ціни у Vibe $0,7 / $2,1 за млн), типовий рівень міркувань — `high`.
- `bash` бачить змінні оточення, зокрема ключ — тому ключ вирізається з коментаря, а `GITHUB_TOKEN` у Vibe не передається.

## Прогін наживо

(дописується після першого прогону `vibe-audit` на PR #397)

## Аудит

(дописується)
