# 0130. `format:check` і lint-staged охоплюють `AGENTS.md`

- Статус: accepted (мерж PR власником = «схвалюю» — конвенція ADR-0052)
- Дата: 2026-11-24
- Частково Supersedes: ADR-0110 (п. 1 — охоплення `format:check` і `format`: `src`, `index.html`, `scripts/**/*.{ts,mjs}`, `e2e`)
- Доповнює: ADR-0109 (маска `format:check` = маска lint-staged), ADR-0108 (lint-staged), ADR-0076 (гейт формату в CI), ADR-0015 (ESLint + Prettier), ADR-0014 (Husky + lint-staged), ADR-0012 (зміна `package.json` — з ADR і авторизацією власника)
- Автор: Claude Code (рішення власника 24.11.2026 на фініші Т.153 кнопкою — «Схвалюю; гейт prettier AGENTS.md»; кандидат процесу 147 — з Т.153)

## Контекст

- До Т.153 `AGENTS.md` не проходив `prettier --check`: таблиці «Модифікація файлів» і ADR розходились із вирівнюванням Prettier. Т.153 (PR #466) відформатував файл, але гейта не додав — перший новий рядок таблиці ADR без `prettier --write` знову розводить файл із форматом, і CI цього не бачить.
- Замір у Т.154 на `7272075`: `npx prettier --check AGENTS.md README.md` — обидва в форматі. У репозиторії ще два файли з тими самими іменами: `docs/prototypes/README.md` (у `.prettierignore` через `docs/`) і `scripts/assets/README.md` (поза форматом, ADR-0109 п. 3).

## Рішення

1. `format:check` — `prettier --check src index.html "scripts/**/*.{ts,mjs}" e2e AGENTS.md`; `format` — той самий перелік з `--write`.
2. lint-staged — ключ `AGENTS.md`: `prettier --write`. Маска без косої риски lint-staged зіставляє з іменем файла в будь-якій теці; `AGENTS.md` у репозиторії один, тож маска збігається з переліком `format:check` (ADR-0109).
3. Workflow без змін: джоба `test` і далі викликає `npm run format:check`. Залежностей не додано.

## Наслідки

- Перевірка Т.154: зсув вирівнювання рядка ADR-0001 у таблиці `AGENTS.md` — `npm run format:check` код 1, у переліку `AGENTS.md`; той самий файл у індексі — `npx lint-staged` виконує `prettier --write`, файл повертається байт у байт до `main` (lint-staged зупиняє порожній коміт); без поломки — код 0.
- Новий рядок таблиці ADR вирівнює хук на коміті; коміт повз хук (`--no-verify`) або правка на GitHub — червона джоба `test`, виправлення — `npm run format` або `npx prettier --write AGENTS.md`.
- Відхилено: `README.md` у тому ж гейті — у форматі, але ключ lint-staged `README.md` (або `{AGENTS,README}.md`) за іменем зачепив би й `scripts/assets/README.md`, який ADR-0109 лишає поза форматом; лишено кандидатом. Маска `*.md` — те саме і ширше. Окремий крок `prettier --check AGENTS.md` у workflow — зміна `.yml` з ADR-0018 там, де досить `package.json`, і локальний `npm run format:check` розійшовся б із CI.
