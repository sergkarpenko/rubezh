# 0111. `e2e/` під ESLint: `npm run lint` і lint-staged

- Статус: accepted (мерж PR власником = «схвалюю» — конвенція ADR-0052)
- Дата: 2026-11-22
- Частково Supersedes: ADR-0110 (п. 2 — у lint-staged для `e2e/**/*.ts` лише `prettier --write`; п. 3 — ESLint для `e2e/` поза кроком), ADR-0106 (охоплення `npm run lint` — `eslint src scripts`), ADR-0080 (наслідок «`e2e/` лишається поза `npm run lint` і `format:check`»; частину про `format:check` замінив ADR-0110)
- Доповнює: ADR-0015 (ESLint + Prettier), ADR-0076 (гейт лінту в CI), ADR-0108 (lint-staged для `scripts/`), ADR-0012 (зміна `package.json` — з ADR і авторизацією власника)
- Автор: Claude Code (рішення власника 22.11.2026 на фініші Т.111 кнопкою — «ESLint для e2e/ (Recommended)»; кандидат 110 — з Т.111)

## Контекст

- Після ADR-0110 `e2e/` (сценарій приймання ADR-0080, дзеркало ядра, смок) перевіряє Prettier у CI і в pre-commit, але не ESLint: `npm run lint` — `eslint src scripts`, lint-staged для `e2e/**/*.ts` — лише `prettier --write`.
- Замір у Т.112 на `602682c`: `npx eslint e2e` — код 0 на всіх трьох файлах (`acceptance.scenario.ts`, `mirror.ts`, `smoke.e2e.ts`). Плаский конфіг `eslint.config.js` уже бачить `e2e/`: `tseslint.configs.recommended` діє на всі `*.ts` поза `ignores` (`dist/`, `docs/prototypes/`, `node_modules/`), окремого блоку чи `tsconfig` для лінту не треба — правила без інформації про типи.

## Рішення

1. `lint` — `eslint src scripts e2e`; `lint:fix` — те саме з `--fix`.
2. lint-staged: маска `e2e/**/*.ts` — `eslint --fix`, потім `prettier --write` (як `src/**/*.ts` і `scripts/**/*.{ts,mjs}`). Що перевіряє CI, те перевіряє й хук.
3. Конфіг ESLint без змін: правила — ті самі `recommended`; правила ядра (ADR-0079) на `e2e/` не діють.
4. Workflow без змін: джоба `test` і далі викликає `npm run lint`.

## Наслідки

- Перевірка Т.112: `e2e/zz-probe.ts` з невикористаною змінною, `let` без переприсвоєння і `any` — `npm run lint` код 1, три помилки (`no-unused-vars`, `prefer-const`, `no-explicit-any`); файл із невикористаною змінною в стейджі — `npx lint-staged` код 1 на `eslint --fix`, коміт заблоковано; без них — код 0.
- Відхилено: плагін `eslint-plugin-playwright` (нова залежність, ADR-0012; правил під конкретну ваду в `e2e/` немає — замір чистий); окремий блок `files: ['e2e/**/*.ts']` у `eslint.config.js` (нічого додати понад `recommended`); лінт кореневих `playwright.config.ts` і `playwright.e2e.config.ts` (поза кандидатом; у `format:check` їх теж немає — окреме рішення).
