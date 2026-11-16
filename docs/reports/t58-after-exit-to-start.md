# Т.58 — після виходу на стартовий екран

Дата: 2026-11-16, сесія 16.11.2026 (Mistral Vibe Code, виміри до ~23:41 UTC). План — `docs/plans/t58-after-exit-to-start.md` (перший коміт гілки `fix/t58-after-exit-to-start` — `a581146`). Блокери: Т.48 (PR #348), Т.53 (PR #353). Рішення власника дослівно: «Текст після «Продовжити», Ambient на старті, Меню на екрані перемоги, Тест анімацій геосцени»; «Один PR (Recommended)»; «Варіант 1»; «Не вдалося завантажити збереження. Почніть нову гру.»; «Третя кнопка (Recommended)».

## Що зроблено

- Коміт `87d0613` (код і тести, лише додані блоки; наявні e2e-кроки й тести не змінено):
  - `src/ui/ambient.ts`: новий гейт `active(): boolean` у `AmbientDeps`; `start()` не планує rAF, якщо `!deps.active()` — ambient-цикл не стартує на стартовому екрані (після `visibilitychange` чи вмикання перемикача «Анімація»).
  - `src/main.ts`: `active: () => partyOnScreen`; `partyOnScreen = true` у `adoptParty` перед `ambient.start()`; у `exitToStart` — `partyOnScreen = false`, `ambient.pause()`, приховування `#campaign-victory`; `victoryDismissed: () => victoryDismissed || !partyOnScreen`; обробник `#btn-victory-exit` → `screens?.requestExit()`.
  - `src/ui/screens.ts`: `requestExit(): void` у `Screens`; рядок `#start-note` над кнопками стартового меню; `export const CONTINUE_FAILED_TEXT = 'Не вдалося завантажити збереження. Почніть нову гру.'`; `showNote('')` у `showStart()`; `else showNote(CONTINUE_FAILED_TEXT);` після невдалого «Продовжити».
  - `index.html`: кнопка `#btn-victory-exit` «На стартовий екран» у `#campaign-victory` після `#btn-play-again`; стилі `.start-note`.
  - Тести: `src/ui/ambient.test.ts` (гейт `active`), `src/ui/screens.test.ts` (`#start-note`, `requestExit`), `src/ui/settings.test.ts` (додано `active: () => true` у двох хелперах), `src/main.ui.test.ts` (невалідне «Продовжити», вихід з екрана перемоги); e2e — додано лише крок Т.58 у `e2e/acceptance.scenario.ts` (лічильник кадрів rAF на стартовому екрані).
- Цей docs-коміт: звіт `docs/reports/t58-after-exit-to-start.md`, запис у `docs/workflow.md`, довідники `docs/agents/ui.md` (`#start-note`, `#btn-victory-exit`) і `docs/agents/common.md`.

## Навмисні поломки

| № | Поломка | ambient | screens | сторінка | e2e |
| --- | --- | --- | --- | --- | --- |
| 1 | `src/ui/ambient.ts`: прибрати `\|\| !deps.active()` зі `start()` | червоний (Т.58) | зелений | зелений | червоний (крок Т.58) |
| 2 | `src/main.ts`: `active: () => true` | зелений | зелений | зелений | червоний (крок Т.58) |
| 3 | `src/main.ts`: прибрати `partyOnScreen = false` з `exitToStart` | зелений | зелений | зелений | червоний (крок Т.58) |
| 4 | `src/main.ts`: прибрати `partyOnScreen = true` з `adoptParty` | зелений | зелений | зелений | червоний (крок Т.58, останній рядок) |
| 5 | `src/main.ts`: прибрати `geoAnim.cancel()` з `exitToStart` | зелений | зелений | червоний (тест Т.48, число викликів) | червоний (крок Т.58) |
| 6 | `src/main.ts`: прибрати `ambient.pause()` з `exitToStart` | зелений | зелений | зелений | червоний (крок Т.47, гейт Т.48) |
| 7 | `src/main.ts`: прибрати рядок, що ховає `campaign-victory` в `exitToStart` | зелений | зелений | червоний (Т.58, екран перемоги) | — |
| 8 | `src/main.ts`: обробник `btn-victory-exit` кличе `exitToStart()` замість `screens?.requestExit()` | зелений | зелений | червоний (Т.58, екран перемоги) | — |
| 9 | `src/ui/screens.ts`: прибрати `else showNote(CONTINUE_FAILED_TEXT);` | зелений | червоний (Т.58) | червоний (Т.58, «Продовжити») | — |
| 10 | `src/ui/screens.ts`: прибрати `showNote('')` із `showStart` | зелений | червоний (Т.58) | червоний (Т.58, «Продовжити») | — |
| 11 | `src/ui/screens.ts`: у тексті «збереження» → «сейв» | зелений | червоний (Т.58) | червоний (Т.58, «Продовжити») | — |
| 12 | `src/ui/screens.ts`: рядок `start-note` після кнопки `btn-start-new` | зелений | червоний (Т.58) | зелений | — |
| 13 | `index.html`: текст кнопки «На стартовий екрани» | зелений | зелений | червоний (Т.58, екран перемоги) | — |
| 14 | `src/ui/screens.ts`: у `requestExit` умова `if (false) {` | зелений | червоний (Т.58 і тест П12.2 про вихід) | зелений | — |
| 15 | `src/main.ts`: `victoryDismissed: () => victoryDismissed,` (без `\|\| !partyOnScreen`) | зелений | зелений | червоний (Т.58, екран перемоги) | — |

У звіт писати те, що вийшло у виконавця; розбіжність із цією таблицею — назвати, без домислів.

## Межі

- У розділі «Межі» — щонайменше пункти плану, **словами плану, без переказу**: (а) рядок-пояснення на стартовому екрані займає два рядки тексту (340 × 56 px на 1366 × 768 і 1024 × 768, 335 × 56 px на 390 × 844) і накриває підпис під логотипом, поки показаний, — виміри планувальника на прототипі, власник цього розташування не бачив; (б) рядок-пояснення зникає лише з наступним показом стартового екрана; кнопка «Продовжити» після невдалої спроби лишається активною; (в) зв'язування `partyOnScreen` у `src/main.ts` (поломки 2–4) тримає лише сценарій e2e — у наскрізних тестах на сторінці rAF немає; (г) гейт e2e про анімації геосцени спирається на те, що вихід на стартовий екран відбувається раніше, ніж за 1,2 с після тіку: на повільній машині скан-радар може скінчитись сам, і гейт буде зеленим без `geoAnim.cancel()`; (ґ) подію `visibilitychange` сценарій e2e посилає сам, вкладку у фон він не ховає; (д) екран перемоги для тестів зроблено правкою сейву (`campaign.status = 'перемога'`, рахунку немає) — справжню перемогу на 30-ту добу тести не проходять; (е) на екрані перемоги три кнопки вміщаються без прокрутки на 1366 × 768, 1024 × 768 і 390 × 844 (нижній край третьої — 546, 546 і 602 px) — виміри планувальника, гейта на це немає. Межі, знайдені під час роботи, — окремими пунктами після них.

## Чекліст перед PR

- [x] `npx tsc --noEmit` (3 конфіги) — без помилок.
- [x] `npm run lint` — ок; `npm run format:check` — ок; `npx prettier --check e2e/acceptance.scenario.ts` — ок.
- [x] `npm test` — 1186 passed (47 файлів).
- [x] `npm run build` — ок; `npm run docs` — 0 помилок; `node scripts/agents-docs-check.mjs` — без зауважень до змінених файлів.
- [ ] `npm run test:e2e` — у цьому sandbox не проходить (див. «Що з чекліста не вдалося»); повний прогін — у CI PR.
- [ ] `node scripts/vibe-plan-check.mjs --plan docs/plans/t58-after-exit-to-start.md --title "fix(ui): Т.58 — після виходу на стартовий екран" --body-file <файл опису>` — перший запуск перед `gh pr create`; після відкриття PR — вдруге з `--pr <N>` (числа запусків запишу в опис PR; якщо запуск з `--pr` не вдасться — допускається `gh pr edit <N> --body-file <файл>`, не новим комітом).

## Метрики

- `./scripts/pr-size.sh origin/main HEAD` — 230 рядків (ліміт 500), [OK]; 5 файлів поза підрахунком (docs, *.md, assets, бінарні, lockfile). Мітку `size-deviation` не ставимо.
- `npm test` — 1186 passed, 47 файлів; `src/main.ui.test.ts` повністю — 92 passed.
- Браузерний зонд проти збірки (`vite preview` + playwright, 11 перевірок, усі пройшли): після виходу на стартовий екран і `visibilitychange` + перемикання «Анімація» — 0 кадрів rAF за 1,5 с; невалідне збереження (`ufos: [null]`) → `#start-note` видно з точним текстом, лишаємось на старті; валідне «Продовжити» — гру запущено, кадри rAF йдуть (43); екран перемоги → `#btn-victory-exit` з текстом «На стартовий екран», вихід → стартовий екран, `#campaign-victory` приховано.
- Геометрія `#start-note` у браузері (прямокутники, без накладань): 1366×768 — note top 470, `#btn-start-new` top 498, низ меню 704, версія top 740; 1024×768 — ті самі значення; 390×844 — note top 546, кнопка top 574, низ меню 780, версія top 816.
- Час кроку: сесія 16.11.2026, перевірки завершено до 23:41 UTC.

## Що з чекліста не вдалося

- `npm run test:e2e` у sandbox: браузер не стартує без системних lib (`libglib-2.0.so.0`), root немає, `apt-get`/`playwright install-deps` не працюють. Ручний набір .deb з deb.debian.org у `/tmp/debs/root` + `LD_LIBRARY_PATH` + `FONTCONFIG_FILE` запускає браузер, але сценарій падає на `e2e/acceptance.scenario.ts:138` (`#status-tab-base .tab-badge`, `toBeVisible`) — і та сама помилка на чистому `origin/main` в окремому worktree, тож це середовище sandbox, а не цей PR. Замість e2e — зонд playwright проти збірки: 11/11 перевірок. Повний e2e піде в CI.
- Номер PR, числа запусків `vibe-plan-check` із `--pr` і підпункт «Аудит» у `docs/workflow.md` — другим комітом після аудиту (за планом до аудиту не писати).
