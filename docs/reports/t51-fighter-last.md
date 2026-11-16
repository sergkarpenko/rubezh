# Т.51. Рядок переривання перехоплення (#fighter-last), коли зона вже не на радарі

Дата: 2026-11-16. Крок процесу, виконує Vibe Code за планом `docs/plans/t51-fighter-last.md`. Рішення (16.11.2026, після Т.49 / PR #349): «Коли при зриві перехоплення рядок про перерву показувати лише тоді, коли зона ще є на радарі».

## Що зроблено

1. **Код** — `src/ui/panels.ts`, функція `renderFighter` (+6/−1 рядок): нова умова `zoneGone` — якщо остання подія `intercept_aborted` з причиною `ufo_landed` або `ufo_lost` і зона `last.ufoId` вже відсутня в `party.geo.ufos` (`!party.geo.ufos.some((u) => u.id === last.ufoId)`), рядок `#fighter-last` не показується. Наявний виняток `stale` (причина `fighter_damaged` при повному HP після ремонту) збережено; текст/id/клас/порядок елементів панелі і `src/ui/journal.ts` не змінено; `src/core/` не чіпаємо. Коли зона зникає з `geo.ufos`: `ufo_left` у `geoTick` (після приземлення) або `completeMission(…, 'перемога')` у `src/core/mission.ts`.
2. **Тести-модуль** — `src/ui/panels.test.ts`: у наявному тесті `#fighter-last` зони подій `ufo2`/`ufo4` додано до `f.party.geo.ufos` (копія створеної ядром зони зі зміненим `id`) — інакше після зміни коду перевірки причин `ufo_lost`/`ufo_landed` стали б червоними; додано блок `Т.51: #fighter-last при відсутній зоні події в geo.ufos` із 5 тестами (Т.51.1–Т.51.5): `ufo_landed` із зоною → рядок; без зони → немає; те саме для `ufo_lost`; `fighter_damaged` при HP < max без зони → рядок є; у `geo.ufos` лише інша зона (інший id) → рядка немає (перевірка за id). Тексти UI у тестах — лише через `geoEventText` із `src/ui/journal.ts`.
3. **Навмисний тест сторінки** — `src/main.ui.test.ts`, новий блок у кінці файла `Т.51: переривання перехоплення при приземленні зони — журнал і панель #fighter-last`: сид 42, пресет «норма» — кнопка `button.intercept` з'являється на 19-му тику (запобіжник 60), старт перехоплення, на 22-му тику `intercept_aborted` з причиною `ufo_landed` (запобіжник 10): текст `#fighter-last` точно дорівнює рядку журналу, у `#log` та сама рядок і ще немає рядка `ufo_left`; далі тики до появи `ufo_left` у `#log` (запобіжник 400) — і `#fighter-last` зникає.
4. **Навмисні поломки** — таблиця нижче.
5. **Документи** — запис кроку в `docs/workflow.md` (після Т.50), примітка в `docs/agents/common.md` (розділ «Лишее для Mistral Vibe Code»).

## Навмисні поломки (до PR, результат — у цьому звіті)

Команда: `npx vitest run src/ui/panels.test.ts src/main.ui.test.ts` (база: 135 тестів, зелено).

| # | поломка в `renderFighter` | результат |
| - | ------------------------ | --------- |
| 1 | прибрано `&& !zoneGone` (нова умова не застосовується) | **червоний**: Т.51.2, Т.51.3, Т.51.5 + UI-сценарій Т.51 (4 failed / 131 passed) |
| 2 | умова поширена і на `fighter_damaged` | **червоний**: Т.51.4 + старий тест `#fighter-last` (2 failed / 133 passed) |
| 3 | `party.geo.ufos.length === 0` замість пошуку за id | **червоний**: Т.51.5 + UI-сценарій Т.51 (2 failed / 133 passed) |
| 4 | умова лише для `ufo_landed` (без `ufo_lost`) | **червоний**: Т.51.3 (1 failed / 134 passed) |

## Чекліст перед PR

- `npx tsc --noEmit` — OK
- `npx tsc --noEmit -p tsconfig.core.json` — OK
- `npx tsc --noEmit -p tsconfig.e2e.json` — OK
- `npm run lint` — OK
- `npm run format:check` — OK
- `npm test` — OK: 47 файлів, 1178 тестів
- `npm run docs` — OK (typedoc: 0 errors, 8 попереджень — попередні)
- `npm run test:e2e` — **не вдалося** (див. нижче)

## Метрики

- Розмір PR (`./scripts/pr-size.sh origin/main HEAD` після останнього коміту): **див. оновлення другим комітом** (docs/*.md з розміру виключаються; код+тести ≈ 121 рядок, ліміт 500 — без `size-deviation`).
- Час кроку: старт ≈ 11:38 UTC, старт перевірок 12:05 UTC — загалом **див. оновлення другим комітом**.

## Що з чекліста не вдалося

- `npm run test:e2e` — у цьому sandbox немає браузера Playwright (`chromium_headless_shell-1254` відсутній у `~/.cache/ms-playwright`; `npx playwright install` неможливий — немає root і дозволу на встановлення з мережі). Помилка: `browserType.launch: Executable doesn't exist`. Сценарій e2e цей крок не зачіпає (зміни лише в `src/ui/panels.ts` + тести); e2e запустить CI. Пропуск записано також в описі PR.
- Аудит Mistral (ADR-0097, `mistral-audit`) — не проводився: у сесії Vibe Code немає `MISTRAL_API_KEY`. Твердження про результат аудиту не пишу.
