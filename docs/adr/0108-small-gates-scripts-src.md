# 0108. Дрібні гейти: lint-staged для `scripts/` і канарка типів Node у `src`

- Статус: accepted (мерж PR власником = «схвалюю» — конвенція ADR-0052)
- Дата: 2026-11-22
- Частково Supersedes: ADR-0106 (наслідок «`scripts/` … поза lint-staged»)
- Доповнює: ADR-0107 (застереження аудиту PR #419), ADR-0014/0015 (Husky + lint-staged, ESLint + Prettier), ADR-0012 (зміна `package.json` — з ADR і авторизацією власника)
- Автор: Claude Code (рішення власника 22.11.2026 на фініші Т.107 кнопкою — «104 + 105: дрібні гейти»; кандидати 104 — аудит Т.102, 105 — аудит Т.104)

## Контекст

- lint-staged (`package.json`, ADR-0014/0015) мав маски `src/**/*.ts` і `*.{html,css}`: скрипт `scripts/*.ts` чи `scripts/*.mjs` з помилкою ESLint проходив pre-commit — її ловили лише `npm run lint` і CI (ADR-0106). Замір у Т.108 на `f931d21`: усі 15 файлів `scripts/*.{ts,mjs}` уже у форматі Prettier (`prettier --list-different` — 0), `npm run lint` — 0.
- ADR-0107 закрив глобали Node у `src` (`types: []`), але аудит PR #419 показав дірку: `/// <reference types="node" />` або `import type … from 'vite'` у будь-якому файлі `src` повертає їх усій програмі `tsconfig.json`, і `npx tsc --noEmit` знову мовчить. Механічної перевірки цього не було — лише застереження в ADR-0107 і `docs/agents/common.md`.

## Рішення

1. lint-staged: маска `scripts/**/*.{ts,mjs}` — `eslint --fix`, `prettier --write` (як у `src`). `.sh` і `.py` — як і раніше поза перевірками; `format:check` у CI скриптів не охоплює.
2. Канарка `src/no-node-types.ts` — лише типи: `typeof process`, `typeof Buffer`, `NodeJS.Timeout`, кожен під `@ts-expect-error`. Поки типів Node у `src` немає, директиви гасять «Cannot find name»; якщо вони повернуться будь-яким шляхом (посилання `types="node"`, імпорт типів з `vite`, інший пакет із типами Node), директиви стануть невикористаними — `TS2578`, і наявний крок `npx tsc --noEmit` джоби `test` червоніє. Нового кроку в CI і нового конфіга немає.
3. Файл канарки нічого не виконує: Vite його не імпортує, мутаційний прогін і покриття (`src/core`) його не бачать; typedoc його не документує (точки входу — `src/core`, `src/main.ts`), але перевіряє типи (`tsconfig.typedoc.json` успадковує `include: ["src"]`) — витік червонить і `npm run docs`.

## Наслідки

- Помилка ESLint у скрипті зупиняє коміт (перевірка Т.108: `const unused = 1;` у новому `scripts/*.mjs` — lint-staged код 1, `no-unused-vars`); криве форматування скрипта виправляється на коміті.
- Перевірка канарки (Т.108): `/// <reference types="node" />` першим рядком `src/ui/ambient.ts` — три `TS2578`; `import type { UserConfig } from 'vite'` у тому ж файлі — три `TS2578`; без поломок — `tsc` п'яти конфігів (`tsconfig.json`, `-core`, `-typedoc`, `-scripts`, `-e2e`) код 0.
- Тест, якому справді знадобляться типи Node, і далі — лише рішенням власника (окремий конфіг); канарку тоді не прибирати, а виключити такі тести з програми `tsconfig.json`.
- Відхилено: ESLint-правило `@typescript-eslint/triple-slash-reference` з `types: 'never'` і `no-restricted-imports` для `vite` (ловить лише два відомі шляхи, а `src/env.d.ts` потребує `vite/client` — виняток для файла знову відкриває дірку); тест із пошуком рядків у `src` через `import.meta.glob` (той самий недолік — перелік відомих шляхів).
