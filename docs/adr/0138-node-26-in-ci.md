# 0138. Node у CI — 26 (активна LTS), `@types/node` 26.x

- Статус: accepted (мерж PR власником = «схвалюю» — конвенція ADR-0023/0030/0052; зміна workflow — ADR-0018, зміна `package.json` — ADR-0012)
- Дата: 2026-11-24
- Доповнює: ADR-0134 (мажори `@types/node` слідом за Node у CI), ADR-0012 (процес залежностей), ADR-0018 (зміна workflow), ADR-0020 (Dependabot), ADR-0083 (Stryker вимагає Node 22+), ADR-0106 (`scripts/` під `tsc`)
- Автор: Claude Code (Т.170, рішення власника кнопкою «А. Node 26 + типи 26»)

## Контекст

У всіх п'яти workflow з `actions/setup-node` (`ci.yml` — три джоби, `mutation.yml`, `preview.yml`, `preview-branch.yml` — дві джоби, `vibe-audit.yml`) стояло `node-version: 22`; `tag-version.yml` бере `node` з образу раннера лише для читання версії з `package.json`. `@types/node` — 22.x, мажори поза Dependabot до переходу CI (ADR-0134).

На фініші Т.169 власник обрав кнопкою кандидат «Node 24 у CI». На старті Т.170 звірка реліз-ліній на nodejs.org (24.11.2026) показала: Node 26 (Lithium) — активна LTS з 28.10.2026 (реліз — травень 2026; остання — 26.13.1); дати LTS і EOL — таблиця розкладу github.com/nodejs/release, Node 24 (Krypton) і Node 22 (Jod) — Maintenance LTS. Власникові поставлено питання кнопками з цим фактом.

Перевірка в контейнері сесії на Node 26.13.1 (двійковий файл з пакета npm `node@26` у тимчасовій теці, копія клону `main`): `npm ci`, `npm test` (51 файл, 1513 тестів), `npx tsc --noEmit`, `tsc -p tsconfig.core.json`, `tsc -p tsconfig.scripts.json` (і з `@types/node` 26.6.7), `npm run lint`, `npm run format:check`, `npm run docs`, `npm run build`, e2e (5 сценаріїв), прицільний Stryker `src/core/ai-utils.ts` — усе без помилок. Поле `engines` чинних dev-залежностей Node 26 допускає (`vite` `>=22.12.0`, `vitest` і `jsdom` `>=26.0.0` серед діапазонів, `@stryker-mutator/core` `>=22.0.0`, `eslint` `>=24`, `lint-staged` `>=22.22.1`).

## Рішення

1. `node-version: 26` у всіх восьми кроках `actions/setup-node` п'яти workflow. Інших змін у workflow немає; `tag-version.yml` без змін.
2. `@types/node` — `^26.6.7` (`npm install -D @types/node@26.6.7`; разом із ним у lockfile — `undici-types` 8.9.0). Мерж PR власником = авторизація зміни залежності (ADR-0012).
3. Правило `ignore` мажорів `@types/node` у `.github/dependabot.yml` лишається (ADR-0134): Dependabot і далі пропонує мінори й патчі 26.x, а мажор 27+ — лише разом із наступним переходом CI. Коментар правила — «зараз 26».
4. Поле `engines` у `package.json` не додається (рішення власника — варіант «А»).

## Наслідки

- CI, прев'ю, мутаційний прогін і `vibe-audit` ідуть на Node 26; підтримка лінії — до 30.04.2029 (≈ 30 місяців від початку LTS у жовтні 2026).
- Локально в контейнері сесії — Node 22: сесія, що перевіряє зміну, чутливу до версії Node, ставить 26 окремо (`npm i --no-save node@26` у тимчасовій теці, `PATH` на його `bin`).
- Скрипти `scripts/*.ts` бачать типи Node 26; API Node 26, якого немає в 22, у локальному прогоні сесії на 22 впаде — у CI ні.
- Умова перегляду: наступна активна LTS — Node 27 (LTS з 20.10.2027; з Node 27 LTS стає кожен мажор, розклад github.com/nodejs/release) — тим самим кроком `node-version` і мажор `@types/node`.

## Альтернативи

- Node 24 і `@types/node` 24 (як обрано на фініші Т.169) — відхилено власником кнопкою; аргумент агента: 24 уже Maintenance LTS, підтримка коротша на рік, а проблем з 26 перевірка не показала.
- Node 26, `@types/node` 26 і `"engines": {"node": ">=26"}` — відхилено власником кнопкою; аргумент агента: гра — статичний сайт, Node потрібен лише інструментам, а `engines` без `engine-strict` лише попереджає.
- Зняти `ignore` мажорів `@types/node` — не пропонувалось: правило знадобиться при кожному наступному переході (ADR-0134).
