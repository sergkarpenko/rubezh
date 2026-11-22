# 0110. `e2e/` у `format:check` CI і в lint-staged

- Статус: accepted (мерж PR власником = «схвалюю» — конвенція ADR-0052)
- Дата: 2026-11-22
- Частково Supersedes: ADR-0109 (п. 3 — `e2e/` поза перевіркою)
- Доповнює: ADR-0108 (lint-staged для `scripts/`), ADR-0076 (гейт формату в CI), ADR-0080 (сценарій приймання в `e2e/`), ADR-0012 (зміна `package.json` — з ADR і авторизацією власника)
- Автор: Claude Code (рішення власника 22.11.2026 на фініші Т.110 кнопкою — «`e2e/` у format:check»; кандидат 109 — з Т.110)

## Контекст

- Після ADR-0109 `npm run format:check` перевіряє `src`, `index.html` і `scripts/**/*.{ts,mjs}`; `e2e/` (сценарій приймання ADR-0080, дзеркало ядра, смок) не перевіряли ні CI, ні pre-commit — довідник радив `prettier --check` на свій файл вручну.
- Замір у Т.111 на `df643d9`: `e2e/` — 3 файли `.ts`, `prettier --check e2e` — усі у форматі; `npx eslint e2e` — код 0 (ESLint їх не дивиться: `npm run lint` — `eslint src scripts`).

## Рішення

1. `format:check` — `prettier --check src index.html "scripts/**/*.{ts,mjs}" e2e`; `format` — те саме з `--write`. Уся тека: у `e2e/` немає файлів поза кодом (на відміну від `scripts/assets/`).
2. lint-staged: маска `e2e/**/*.ts` — лише `prettier --write`. Що форматує хук, те перевіряє CI (принцип ADR-0109).
3. ESLint для `e2e/` — поза кроком: розширення `npm run lint` — окреме рішення.
4. Workflow без змін: джоба `test` і далі викликає `npm run format:check`.

## Наслідки

- Перевірка Т.111: кривий `e2e/zz-probe.ts` — `npm run format:check` код 1, файл у переліку; той самий файл у стейджі — `npx lint-staged` виправив формат (`const x = 1;`); без поломок — код 0.
- Відхилено: маска `e2e/**/*.ts` у `format:check` замість теки (немає чого виключати; новий `.js`/`.json` в `e2e/` теж під перевіркою); ESLint на `e2e/` у lint-staged без `npm run lint` (хук і CI розійшлися б).
