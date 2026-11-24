# 0140. Кореневі `playwright*.config.ts` — під ESLint, Prettier і `tsc`

- Статус: accepted (мерж PR власником = «схвалюю» — конвенція ADR-0052)
- Дата: 2026-11-24
- Частково Supersedes: ADR-0111 (охоплення `npm run lint` і `lint:fix`), ADR-0133 (п. 1 — охоплення `format:check` і `format`), ADR-0106 (охоплення `tsconfig.scripts.json` — лише `scripts/*.ts`)
- Доповнює: ADR-0063 і ADR-0080 (конфіги домен-смоку і сценарію приймання), ADR-0139 (`FONTCONFIG_FILE` у `playwright.e2e.config.ts`), ADR-0108 (lint-staged), ADR-0109 (маска `format:check` = маска lint-staged), ADR-0107 (`types: []` у `tsconfig.json`), ADR-0076 (гейти в CI), ADR-0015 (ESLint + Prettier), ADR-0014 (Husky + lint-staged), ADR-0012 (зміна `package.json` — з ADR і авторизацією власника)
- Автор: Claude Code (рішення власника 24.11.2026 на фініші Т.171 кнопкою — «Схвалюю; лінт конфігів (111)»; кандидат процесу 111)

## Контекст

- `playwright.config.ts` (домен-смок прев'ю, ADR-0063) і `playwright.e2e.config.ts` (сценарій приймання, ADR-0080) лежать у корені — поза `npm run lint` (`eslint src scripts e2e`), `format:check`, lint-staged і будь-яким `tsconfig`: `tsconfig.json` — `include: ["src"]`, `tsconfig.e2e.json` — сценарії і `e2e/mirror.ts`, `tsconfig.scripts.json` — `scripts/*.ts`. Т.171 змінив `playwright.e2e.config.ts` (ADR-0139) — і цю правку не перевіряв жоден гейт (аудит PR #485).
- Замір на `fbaad86` (Т.172): ESLint на обох файлах — 0 знахідок; `prettier --check` — у форматі; `tsc` з `tsconfig.scripts.json` (`types: ["node"]`) і обома файлами в `include` — 0 помилок; з `tsconfig.e2e.json` (успадковує `types: []`) — 5 помилок `TS2591` / `TS2307` (`process`, `node:url`): конфіги — код для Node.

## Рішення

1. `npm run lint` і `lint:fix` — `eslint src scripts e2e "playwright*.config.ts"`; правила — `recommended` з `eslint.config.js`, як для `scripts/` і `e2e/`.
2. `format:check` і `format` — той самий перелік, що й досі, плюс `"playwright*.config.ts"` (перед `AGENTS.md`).
3. lint-staged — ключ `./playwright*.config.ts`: `eslint --fix`, `prettier --write`. Маска з `/` вимикає `matchBase` (ADR-0133): збігаються лише кореневі файли, як і в `format:check` і `npm run lint`.
4. `tsconfig.scripts.json` — `include: ["scripts/*.ts", "playwright*.config.ts"]`: обидва конфіги перевіряє той самий крок `npx tsc --noEmit -p tsconfig.scripts.json` джоби `test` з типами Node.
5. Workflow без змін (кроки `npm run lint`, `npm run format:check` і `tsc -p tsconfig.scripts.json` у джобі `test` уже є). Залежностей не додано. `tsconfig.json` не змінено.

## Наслідки

- Перевірка Т.172 поломкою кожного гейта на `playwright.e2e.config.ts`: невикористана змінна — `npm run lint` знаходить `@typescript-eslint/no-unused-vars`; зайві пробіли — `format:check` код 1 з цим файлом у переліку; `const PORT: string = 4173` — `tsc -p tsconfig.scripts.json` код 2 (`TS2322`); файл із зайвими пробілами в індексі — `npx lint-staged` форматує його назад байт у байт. Маска lint-staged (`matchFiles`): `./playwright*.config.ts` — лише два кореневі файли; без `./` — і `e2e/…`, `docs/prototypes/…` з тим самим іменем.
- Новий кореневий `playwright.<щось>.config.ts` потрапляє під усі три гейти сам; інші кореневі конфіги (`vite.config.ts`, `vitest.stryker.config.ts`, `stryker.config.mjs`, `eslint.config.js`) — і далі поза ними.
- Відхилено: `tsconfig.e2e.json` — без типів Node конфіги не компілюються, а `types: ["node"]` там дав би типи Node і сценаріям; окремий `tsconfig.config.json` — новий крок у workflow (ADR-0018) там, де досить `include`; `tsconfig.json` — заборонений файл і `types: []` (ADR-0107); ключ lint-staged без `./` — `matchBase`, зайві збіги в підтеках.
