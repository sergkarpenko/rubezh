# Рубіж

[![codecov](https://codecov.io/gh/sergkarpenko/rubezh/graph/badge.svg)](https://codecov.io/gh/sergkarpenko/rubezh)

Однокористувацька тактична стратегія за мотивами X-COM: UFO Defense: глобальний стратегічний шар (час, мапа світу, база, радар, НЛО) + покроковий тактичний бій (AP, режими пострілів, дозор, туман війни).

Стовпи дизайну: незворотність наслідків (перма-смерть), інформація як ресурс, гібридний стрес двох шарів.

## Статус

Проєкт у розробці (MVP). Зроблено: бойове ядро, мапа/туман війни, ШІ прибульців, стратегічне ядро (`src/core/geo.ts`), зв'язок шарів (`src/core/mission.ts`), персистентний ростер загону з перма-смертю (`src/core/squad.ts`), цільовий UI на ванільному TS + Canvas 2D (`src/main.ts`), онлайн-превью на GitHub Pages. Якість: 126 тестів (юніт, DOM-тести UI через jsdom, інтеграційні тести повного циклу), покриття ядра ~99% (поріг 80% — рубіж CI), ESLint + Prettier, TypeDoc-довідка, Codecov. Далі: економіка, дослідження, перехоплення НЛО, баланс, поліровка.

## Онлайн-превью

Демо-превью ядра у браузері: **https://sergkarpenko.github.io/rubezh/**

Геосцена (час, радар, НЛО), панель ростеру, запуск місій — і тактичний бій, що
відтворюється ботами автоматично (демо-бот гравця з src/bot.ts проти ШІ прибульців
з src/core/ai.ts). Інтерактивне керування бійцем — майбутня ітерація; це превью ядра.

Збирається і деплоїться GitHub Actions при кожному пуші в main (тести → покриття →
vite build → GitHub Pages). Якщо сторінка не відкривається: Settings → Pages → Build and deployment →
Source: **GitHub Actions**.

## Стек

- TypeScript + Canvas 2D, Vite, без фреймворків (ADR-0001, ADR-0010)
- Тестування: vitest (jsdom для DOM-тестів UI), покриття v8 → Codecov
- Якість: ESLint + Prettier (лінт і формат — рубіж на коміті), TypeDoc для довідки API, Dependabot для оновлення залежностей (ADR-0020)

## Розробка

```bash
npm install        # також встановлює pre-commit hook (Husky, ADR-0014)
npm test           # усі тести (vitest): ядро + DOM-флоу + інтеграційний цикл
npm run lint       # ESLint (src/), fix: npm run lint:fix
npm run format     # Prettier (src/, index.html), перевірка: npm run format:check
npm run test:coverage  # покриття src/core/ з порогом 80% (звіт у dist/coverage)
npm run docs       # TypeDoc-довідка API (HTML у dist/api)
```

Онлайн-довідка API публікується з кожним пушем: https://sergkarpenko.github.io/rubezh/api/

Pre-commit hook перевіряє правила AGENTS.md, процес ADR-0012 для залежностей, тести і exact-байти, а lint-staged автоматично виправляє формат staged-файлів.

**Примітка про `docs/prototypes/`**: це архів React-прототипів віджетів (довідковий знімок, не змінювати — див. README там). Вони містять вбудовані копії старих модулів ядра; джерело правди про логіку — `src/core/`.

## Структура

- `src/core/` — чиста логіка гри без DOM: бойове ядро, мапа/туман, ШІ, геосцена, місії, ростер + тести
- `src/main.ts` — цільовий UI (ванільний TS + Canvas 2D, ADR-0010); `src/bot.ts` — демо-бот превью
- `docs/prototypes/` — архів прототипів React (див. примітку)
- `docs/adr/` — архітектурні рішення (ADR); записи незмінні, зміна рішення = новий ADR з полем Supersedes
- `docs/workflow.md` — робочий процес розробки (AI-native SDLC): сесії, коміти, теги, уроки, статус фаз
- `scripts/` — pre-commit hook і перевірка exact-байти

## Детермінізм

Уся випадковість — через ін'єктований RNG (mulberry32, сід передається в createGame). Один сід + послідовність дій = той самий лог. Основа тестів і майбутніх реплеїв (ADR-0003).
