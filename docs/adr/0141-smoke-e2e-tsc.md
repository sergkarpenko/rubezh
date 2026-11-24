# 0141. `e2e/smoke.e2e.ts` — під `tsc` з типами Node

- Статус: accepted (мерж PR власником = «схвалюю» — конвенція ADR-0052)
- Дата: 2026-11-25
- Частково Supersedes: ADR-0140 (п. 4 — `include` у `tsconfig.scripts.json`)
- Доповнює: ADR-0063 (домен-смок прев'ю, `e2e/smoke.e2e.ts`), ADR-0080 (`tsconfig.e2e.json` — сценарії і дзеркало), ADR-0106 (`tsconfig.scripts.json`, типи Node), ADR-0107 (`types: []` у `tsconfig.json`), ADR-0076 (гейти в CI), ADR-0018 (зміна workflow — лише з ADR)
- Автор: Claude Code (рішення власника 25.11.2026 на фініші Т.172 кнопкою — «Схвалюю; smoke.e2e.ts під tsc (161)»; кандидат процесу 161)

## Контекст

- `e2e/smoke.e2e.ts` — спек домен-смоку прев'ю (ADR-0063): `preview-branch.yml` запускає його з `main` проти задеплоєного прев'ю (`SMOKE_URL`, `npm run test:smoke`). Файл під ESLint, `format:check` і lint-staged (теку `e2e/` охоплюють ADR-0110, ADR-0111), але поза будь-яким `tsconfig`: `tsconfig.e2e.json` бере лише `e2e/*.scenario.ts` і `e2e/mirror.ts` і успадковує `types: []`, `tsconfig.scripts.json` — `scripts/*.ts` і кореневі `playwright*.config.ts` (ADR-0140). Playwright типів не перевіряє (урок П11.3), тож вада типів у спеку смоку виявилась би лише на деплої прев'ю.
- Замір на `9d75d93` (Т.173): у `e2e/` чотири файли — `acceptance.scenario.ts`, `mirror.ts` (обидва в `tsconfig.e2e.json`), `fonts.conf` (не код) і `smoke.e2e.ts`; інших `e2e/*.ts` поза `include` немає. `smoke.e2e.ts` читає `process.env.SMOKE_URL` — код для Node; з `tsconfig.scripts.json` і файлом у `include` — 0 помилок.

## Рішення

1. `tsconfig.scripts.json` — `include: ["scripts/*.ts", "playwright*.config.ts", "e2e/smoke.e2e.ts"]`: спек смоку перевіряє той самий крок `npx tsc --noEmit -p tsconfig.scripts.json` джоби `test` з типами Node, поруч із кореневими конфігами Playwright, у яких його конфіг (`playwright.config.ts`, ADR-0063).
2. Файл названо явно, а не маскою: нові сценарії `e2e/*.scenario.ts` лишаються в `tsconfig.e2e.json` без типів Node.
3. Workflow, `tsconfig.e2e.json`, `tsconfig.json`, `package.json` і сам спек без змін.

## Наслідки

- Перевірка Т.173 поломкою: `const errors: number[] = []` у `e2e/smoke.e2e.ts` — `tsc -p tsconfig.scripts.json` код 2 (`TS2345` ×2); після повернення — код 0.
- Новий спек смоку з іншим іменем під `tsc` сам не потрапить — його треба дописати в `include`.
- Відхилено: `tsconfig.e2e.json` з `types: ["node"]` — дав би типи Node і сценаріям приймання, де `process` не потрібен (той самий довід, що в ADR-0140); `smoke.e2e.ts` у `include` `tsconfig.e2e.json` без типів Node — `process` дає `TS2591`; окремий `tsconfig.smoke.json` — новий крок у workflow (ADR-0018) там, де досить `include`; маска `e2e/*.e2e.ts` — один файл, явна назва точніша.
