# 0109. `format:check` у CI охоплює `scripts/`

- Статус: accepted (мерж PR власником = «схвалюю» — конвенція ADR-0052)
- Дата: 2026-11-22
- Доповнює: ADR-0108 (lint-staged для `scripts/`), ADR-0076 (гейт формату в CI), ADR-0015 (ESLint + Prettier), ADR-0012 (зміна `package.json` — з ADR і авторизацією власника)
- Автор: Claude Code (рішення власника 22.11.2026 на фініші Т.109 кнопкою — «107: scripts/ у format:check»; кандидат 107 — з Т.108)

## Контекст

- З Т.108 (ADR-0108) lint-staged форматує `scripts/**/*.{ts,mjs}` на коміті, але `npm run format:check` (крок джоби `test`, ADR-0076) дивився лише `src` та `index.html`. Коміт повз хук (`--no-verify`) або правка на GitHub могли лишити скрипт поза форматом, і CI цього не бачив.
- Замір у Т.110 на `7b384e7`: усі 15 файлів `scripts/*.{ts,mjs}` у форматі (`prettier --list-different` — 0); `prettier --check scripts` (уся тека) — 2 файли поза форматом: `scripts/assets/README.md` і `scripts/assets/units-gemini-report.json` (звіт і нотатки конвертації ассетів); `e2e/` — 0.

## Рішення

1. `format:check` — `prettier --check src index.html "scripts/**/*.{ts,mjs}"`; `format` — та сама маска з `--write`. Маска збігається з lint-staged (ADR-0108): що форматує хук, те перевіряє CI. Лапки — щоб маску розгортав Prettier, а не оболонка.
2. Workflow без змін: джоба `test` і далі викликає `npm run format:check`.
3. `.sh`, `.py`, `scripts/assets/` (README, JSON-звіт) і `e2e/` — поза перевіркою, як і раніше.

## Наслідки

- Перевірка Т.110: новий `scripts/zz-probe.mjs` і `scripts/sub/zz.ts` з кривим форматом — `npm run format:check` код 1, обидва файли в переліку; без поломок — код 0.
- Новий скрипт `.ts` чи `.mjs` у підтеці `scripts/` теж під перевіркою (на відміну від `tsc`, де `include` — `scripts/*.ts`).
- Відхилено: уся тека `scripts` (червонить на `scripts/assets/README.md` і JSON-звіті — форматувати їх заради гейта означає чіпати матеріал ассетів); окремий крок `prettier --check` у workflow (зміна `.yml` з ADR-0018 там, де досить `package.json`, і `npm run format:check` локально розійшовся б із CI). `e2e/` у ту саму перевірку — поза кандидатом 107, лишено кандидатом.
