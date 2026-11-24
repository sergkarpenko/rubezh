# 0136. `npm audit`: виправлення в межах діапазонів — лише lockfile; решта вразливостей dev-залежностей — прийнятий ризик з умовою перегляду

- Статус: accepted (мерж PR власником = «схвалюю» — конвенція ADR-0023/0030/0052)
- Дата: 2026-11-24
- Доповнює: ADR-0012 (процес залежностей), ADR-0020 (Dependabot, мерж = авторизація), ADR-0016 (TypeDoc), ADR-0083 (StrykerJS), ADR-0134 (мажори `@types/node`)
- Автор: Claude Code (Т.167, рішення власника кнопкою «А. Лише lockfile»)

## Контекст

Після Т.165 `npm audit --package-lock-only` на `main` `49ac6b5` дає 7 вразливостей: 1 високу і 6 помірних. Усі — у dev-залежностях (`"dev": true` у `package-lock.json`); у збірку гри (`dist/`) жоден із пакетів не потрапляє.

| Пакет (версія) | Хто тягне | Вразливість | Виправлення |
| --- | --- | --- | --- |
| `markdown-it` 14.3.2 (висока) | `typedoc` 0.28.20 (`^14.3.0`) | GHSA-vfgh-jcmw-g37q, GHSA-gfr2-rv44-r23c — квадратичний час розбору (DoS) | 14.3.3 у межах діапазону — лише lockfile |
| `qs` 6.15.1 | `typed-rest-client` 2.3.1 (точно `6.15.1`) ← `@stryker-mutator/core` 10.1.1 (`~2.3.0`) | GHSA-q8mj-m7cp-5q26, GHSA-4mjr-xmp4-gh2g, GHSA-6pq8-jhm2-2vcw — DoS; GHSA-x5fp-wj9c-mxmx — обхід ліміту масиву | у межах діапазонів немає; лише `overrides` у `package.json` |
| `typed-rest-client` 2.3.1 | `@stryker-mutator/core` | через `qs` | те саме |
| `minimatch` 10.2.6 | `@stryker-mutator/core` (`~10.2.4`), `typedoc` (`^10.2.5`) | GHSA-g3hv-75wg-m249 — DoS (уражені 7.0.0 – 11.0.0) | у гілці 10.x немає (10.2.6 — остання); лише мажор 11 |
| `typedoc`, `@stryker-mutator/core`, `@stryker-mutator/vitest-runner` | прямі dev-залежності | через `minimatch` | новіших версій немає (`typedoc` 0.28.20 і Stryker 10.1.1 — `latest`) |

Перевірено в тимчасових теках з `package.json` і lockfile `main`:

- `npm audit fix --package-lock-only` (без `--force`) міняє в lockfile лише `markdown-it` 14.3.2 → 14.3.3: 7 → 6, високої немає.
- Плюс `overrides` `qs: ^6.17.1` — 7 → 4. `typed-rest-client` (і з ним `qs`) завантажується з ядром Stryker на кожному прогоні (статичний імпорт репортера `dashboard`), а викликають його лише команда `stryker init` і репортер `dashboard`; у `stryker.config.mjs` репортери `clear-text`, `progress`, `html`, `json`.
- Плюс `overrides` `minimatch: ^11.0.1` — 0, але `npm run docs` падає: `TypeError: mini.matchOne is not a function` у `typedoc` (API `minimatch` 11 несумісний).

Вхід усіх трьох пакетів — файли самого репозиторію (коментарі TypeDoc, маски файлів Stryker), а не дані від стороннього користувача.

## Рішення

1. `package-lock.json` — результат `npm audit fix --package-lock-only`: `markdown-it` 14.3.3. `package.json` без змін, `overrides` не додаються. Мерж PR власником = авторизація зміни (ADR-0012, ADR-0020).
2. Решта 6 помірних (`qs`, `typed-rest-client`, `minimatch`, `typedoc`, `@stryker-mutator/core`, `@stryker-mutator/vitest-runner`) — прийнятий ризик: лише dev-інструменти, вхід — файли репозиторію.
3. Умова перегляду: новий реліз `typedoc` чи Stryker з `minimatch` ≥ 11.0.1 або реліз Stryker з `typed-rest-client` ≥ 3.1.1 (`qs` `^6.16.1`; зараз Stryker тримає `~2.3.0`) — оновлення шляхом ADR-0020 (Dependabot) чи окремим кроком; нова висока чи критична вразливість у `npm audit` — окремий крок.

## Наслідки

- `npm audit --package-lock-only` на `main` після мержу — 6 помірних, 0 високих.
- Гейта `npm audit` у CI немає; число перевіряє сесія кроку про залежності.
- `overrides` не з'являються в `package.json` — їх не треба буде знімати, коли вийдуть виправлення.

## Альтернативи

- «Б. А + override `qs`» — відхилено власником (кнопкою). Аргумент сесії: зміна `package.json` заради коду, який наш конфіг Stryker не викликає.
- `overrides` `minimatch` 11 — не пропонувався: ламає `npm run docs` (перевірено).
- `npm audit fix --force` — відкинуто: пропонує `typedoc` 0.23.25 (відкат мажору).
- «В. Лише звіт» — відхилено власником (кнопкою). Аргумент сесії: висока лишилася б, хоча виправлення — лише lockfile.
