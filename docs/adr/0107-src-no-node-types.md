# 0107. Типи Node не видно в `src`: `types: []` у `tsconfig.json`

- Статус: accepted (мерж PR власником = «схвалюю» — конвенція ADR-0052)
- Дата: 2026-11-21
- Доповнює: ADR-0106 (розділ «Наслідки»: `@types/node` видно в `src`), ADR-0076 (гейт `tsc --noEmit` у CI), ADR-0079 (`tsconfig.core.json` з `types: []`)
- Автор: Claude Code (рішення власника 21.11.2026 на фініші Т.103 — кандидат 103; спосіб у Т.104 кнопкою «А: рядок у tsconfig.json (Recommended)» — вона ж явна згода на зміну забороненого файла `tsconfig.json` за `AGENTS.md`)

## Контекст

З ADR-0106 у `devDependencies` є `@types/node`. `tsconfig.json` не мав поля `types`, тож TypeScript підхоплював усі пакети `@types/*`, і в `src` були видимі глобали Node. Навмисний `export const leak = process.env.X;` у `src/ui/` проходив `npx tsc --noEmit` з кодом 0 — у браузері це `ReferenceError` під час виконання. Ядро захищене окремо (`tsconfig.core.json`, `types: []`).

Замір у Т.104 на `8e3de31`:

- У `src` поза тестами немає жодного `process`, `Buffer`, `__dirname` чи імпорту `node:*`; типи Vite (`?raw`, PNG-імпорти) дає `src/env.d.ts` явним `/// <reference types="vite/client" />`.
- Тести: лише коментар у `src/main.ui.test.ts` згадує `node:fs` і `process.cwd()` — як те, чого там немає. Конфіг `src` з `types: []` разом із тестами компілюється з кодом 0.
- З `types: []` у `tsconfig.json`: той самий `process.env` у файлі UI дає `TS2591` (і в конфігу з тестами, і без них); `tsconfig.core.json`, `tsconfig.scripts.json` (свій `types: ["node"]`), `tsconfig.e2e.json`, `tsconfig.typedoc.json` — код 0.

## Рішення

1. У `tsconfig.json` — `"types": []`. Тип-пакети в `src` — лише явні (`/// <reference types>` чи імпорт).
2. Нового конфіга і нового кроку в CI немає: наявний крок `npx tsc --noEmit` джоби `test` стає гейтом.
3. `tsconfig.scripts.json` і далі задає `types: ["node"]` для `scripts/*.ts`.
4. Коміт зі зміною `tsconfig.json` — з `--no-verify` (хук блокує файл механічно; прецедент — П10.2), перевірки хука (`npm test`, лінт, формат) прогнано вручну.

## Наслідки

- `process`, `Buffer`, `NodeJS.*` у коді UI чи в тесті червонять CI на PR, а не браузер гравця.
- Застереження (аудит PR #419): `/// <reference types="node" />` або `import type … from 'vite'` у будь-якому файлі `src` повертає глобали Node **усій програмі** `tsconfig.json`, а не одному файлу — гейт знову відкривається. Зараз таких рядків у `src` немає (`vite/client` Node не тягне); тест, якому справді знадобляться типи Node, — лише рішенням власника (окремий конфіг для таких тестів).
- Відхилено: окремий `tsconfig.ui.json` і ще один крок `tsc` у CI (дублює наявний гейт; `tsconfig.json` лишався б дірявим для редактора); ESLint `no-restricted-globals` для `src/ui` і `src/main.ts` (не ловить типи `NodeJS.*` і тести).
