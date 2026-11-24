# 0133. `format:check` і lint-staged охоплюють кореневий `README.md`

- Статус: accepted (мерж PR власником = «схвалюю» — конвенція ADR-0052)
- Дата: 2026-11-24
- Частково Supersedes: ADR-0130 (п. 1 — охоплення `format:check` і `format`; наслідок «Відхилено: `README.md` у тому ж гейті»)
- Доповнює: ADR-0109 (маска `format:check` = маска lint-staged; `scripts/assets/` поза форматом), ADR-0108 (lint-staged), ADR-0076 (гейт формату в CI), ADR-0015 (ESLint + Prettier), ADR-0014 (Husky + lint-staged), ADR-0012 (зміна `package.json` — з ADR і авторизацією власника)
- Автор: Claude Code (рішення власника 24.11.2026 на фініші Т.156 кнопкою — «Схвалюю; README під prettier (148)»; кандидат процесу 148)

## Контекст

- ADR-0130 (Т.154) додав у гейт формату `AGENTS.md`, а `README.md` лишив поза ним: ключ lint-staged `README.md` без косої риски lint-staged зіставляє з іменем файла в будь-якій теці (`matchBase`), тож він зачепив би й `scripts/assets/README.md`, який ADR-0109 лишає поза форматом, і `docs/prototypes/README.md` (архів, `docs/` — у `.prettierignore`).
- lint-staged 17.6 (`lib/matchFiles.js`): `matchBase` вмикається лише для маски без `/`; шляхи файлів зіставляються відносно теки конфігу. Замір у Т.157 на трьох файлах: маска `README.md` — усі три; `./README.md` — лише кореневий; `/README.md` — жодного.
- `README.md` на `fa0ced4` — у форматі (`npx prettier --check README.md`, Т.154 і Т.157).

## Рішення

1. `format:check` — `prettier --check src index.html "scripts/**/*.{ts,mjs}" e2e AGENTS.md README.md`; `format` — той самий перелік з `--write`. Явний шлях `README.md` у CLI Prettier — лише кореневий файл.
2. lint-staged — ключ `./README.md`: `prettier --write`. Маска з `/` вимикає `matchBase`: збігається лише кореневий `README.md`, як і перелік `format:check` (ADR-0109).
3. Workflow без змін: джоба `test` і далі викликає `npm run format:check`. Залежностей не додано.

## Наслідки

- Перевірка Т.157: зайві пробіли в маркері списку `README.md` — `npm run format:check` код 1, у переліку `README.md`; той самий файл у індексі — `npx lint-staged` виконує `prettier --write`, файл повертається байт у байт до відформатованого; `scripts/assets/README.md` з поломкою в індексі — lint-staged «could not find any staged files matching configured tasks», файл не змінено; без поломки — `format:check` код 0.
- Коміт повз хук (`--no-verify`) або правка `README.md` на GitHub без формату — червона джоба `test`; виправлення — `npm run format` або `npx prettier --write README.md`.
- Відхилено: маска `{AGENTS,README}.md` чи `*.md` — `matchBase`, ті самі зайві файли; функція в конфігу lint-staged (`.lintstagedrc.mjs`) — новий файл конфігу там, де досить маски в `package.json`; `scripts/assets/README.md` теж у формат — ADR-0109 лишає теку `scripts/assets/` поза ним; міняти це — окреме рішення.
