# 0106. `scripts/` під `tsc` і ESLint: `tsconfig.scripts.json`, `@types/node`, крок у CI

- Статус: accepted (мерж PR власником = «схвалюю» — конвенція ADR-0018/0052)
- Дата: 2026-11-21
- Доповнює: ADR-0076 (гейти типів, лінту і формату в CI), ADR-0079 (окремий `tsconfig` для частини коду), ADR-0012 (залежність `@types/node`), ADR-0018 (зміна `ci.yml`), ADR-0015 (ESLint)
- Автор: Claude Code (рішення власника 21.11.2026 на фініші Т.101 — кандидат 4; обсяг у Т.102 кнопкою «Lint + tsc + CI (Recommended)» — вона ж явна авторизація залежності за ADR-0012)

## Контекст

`npm run lint` перевіряв лише `src`, `tsc` — `src` (`tsconfig.json`), ядро і e2e. Скрипти `scripts/*.ts` (probe і симуляції, запуск — `vite-node`) і `scripts/*.mjs` (CI, аудитори, самоперевірки) не перевіряв ніхто: довідник прямо казав «закомічений скрипт запускати перед комітом».

Замір у Т.102 на `99fda88`:

- `eslint scripts` — 2 помилки: давня `no-unused-vars` у `sim-p11.8.ts` і `no-unused-expressions` у `vibe-plan-check-selftest.mjs` (`console.log(…) || failed++`).
- `tsc` по `scripts/*.ts` без типів Node — 46 помилок (36 — `process`, `node:fs`, `node:path`; решта — їхні наслідки). З `@types/node` — 6, і всі шість — справжня вада: таблиця «Завершені проєкти» в `sim-p11.8.ts` шукала проєкти за старими id («легка броня», «оптичний приціл»…), а в ядрі id давно `'armor'`, `'optics'`… — таблиця тихо показувала нулі.

## Рішення

1. `npm run lint` і `lint:fix` — `eslint src scripts` (`.ts` і `.mjs`). Окремого кроку в CI не треба: джоба `test` уже викликає `npm run lint`.
2. Новий `tsconfig.scripts.json`: розширює `tsconfig.json`, `types: ["node"]`, `include: ["scripts/*.ts"]`. `.mjs` під `tsc` (`checkJs`) не беремо — лише ESLint.
3. Залежність `@types/node` `^22.20.5` у `devDependencies` (мажор — як `node-version: 22` у workflow).
4. Крок `npx tsc --noEmit -p tsconfig.scripts.json` у джобі `test` (`.github/workflows/ci.yml`), одразу після кроку ядра.
5. Наявні помилки виправлено в тому самому PR: id проєктів у `sim-p11.8.ts` беруться з каталогу ядра (`PROJECTS`), у таблиці — назва (`projectName`); невикористаний параметр прибрано; вираз у самоперевірці — звичайний `if`.

## Наслідки

- Скрипт, що розійшовся з ядром за типами (перейменування id, змінений підпис функції), червонить CI на PR, а не на наступному ручному запуску.
- `tsconfig.json` не має поля `types`, тож `@types/node` видно і в `src`: `tsc --noEmit` пропустить, наприклад, `process` у коді UI (у браузері — помилка під час виконання). Ядро захищене — `tsconfig.core.json` має `types: []` (ADR-0079). Закрити це для UI — змінити `tsconfig.json` (заборонений файл AGENTS.md) або винести `src/ui` в окремий конфіг; окремий кандидат.
- `scripts/` і далі поза `format:check` і поза lint-staged — Prettier на свій файл, як раніше.
- Відхилено: лише lint (без `tsc` вада id лишилась би непомітною); `tsc` без залежності — власний файл оголошень `process` / `node:fs` (дублює `@types/node` і розходиться з ним); `tsc` без кроку в CI.
