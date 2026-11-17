# Т.61 — екран перемоги і рядок-пояснення на сторінці: план для Vibe Code

**Хто що робить (рішення власника 17.11.2026).** План підготувала хмарна сесія Claude (Opus). Тест, звіт, запис кроку і PR робить агент **Mistral Vibe Code**. Знахідки аудиту виправляє Vibe Code у тій самій сесії. Мерж — агент-планувальник після аудиту, клас `auto`; **виконавець PR не мержить**.

**Джерело:** кандидат 65 (перший крок Vibe за шаблоном плану Т.60, PR #361) зі змістом кандидата 63 — межі (є) і (ж) звіту Т.58 `docs/reports/t58-after-exit-to-start.md`: що кнопку «На стартовий екран» на екрані перемоги видно, жоден тест не тримає (кнопка з `display:none` проходить усі тести), і стилі `.start-note` жоден тест не тримає. Не міняється нічого, крім тесту e2e і документів: `src/`, `index.html`, правила гри і сценарій ADR-0030 (перший `test(...)` файла) — без змін. Перевірено по коду на `main` = `8caf659`.

**Перед роботою прочитати:** `AGENTS.md`, `docs/agents/common.md`, `docs/agents/ui.md` (розділи «Лише для хмарної сесії Claude» пропустити; розділ «Лише для Mistral Vibe Code» у `docs/agents/common.md` — прочитати). Запис Т.58: `grep -n 'Т.58' docs/workflow.md | cut -c1-200`; межі Т.58 — розділ «Межі» звіту `docs/reports/t58-after-exit-to-start.md`.

**Готові блоки.** Усі нові рядки цього плану — блоки з позначкою `<!-- блок: ім'я -->`. Руками їх не набирати: спершу `node scripts/vibe-plan-blocks.mjs docs/plans/t61-victory-note-e2e.md /tmp/blocks`, далі брати вміст із `/tmp/blocks/<ім'я>.txt`. Вставку і заміну робити скриптом `python3` поза репозиторієм (`/tmp`), з `assert s.count(якір) == 1` на кожну. Текст поза блоками — вказівки: у код, документи й опис PR його не переносити.

## Терміни гри (писати саме так)

Вивід інструментів у середовищі виконавця екранує кирилицю, тому слова легко переплутати. Файли з кирилицею читати через `python3`. У коді, тестах і документах:

- **зонд** (не «зона»), **сід** (не «сид», не «seed» у тексті), **тік** (на 21-му тіку), **перехоплювач** (не «перехоплюач»);
- **наскрізний тест на сторінці** — тест vitest у `src/main.ui.test.ts`, що клікає сторінку в jsdom; це не сценарій e2e (`npm run test:e2e`, Playwright, тека `e2e/`);
- **тест e2e «Т.61»** — новий `test(...)` Playwright цього кроку в `e2e/acceptance.scenario.ts`; **сценарій приймання** — перший `test(...)` того самого файла (ADR-0030), його не чіпати;
- **рядок-пояснення** (не «нотатка», не «примітка») — елемент `#start-note` стартового екрана; **екран перемоги** — `#campaign-victory`; **стартовий екран** — `#start-screen`;
- **навмисна поломка** (не «мутація» у тексті документів; скрипт поломок — назва файла `mutations.py` лишається).

## Відповідь власника (17.11.2026, до реалізації)

- Питання: «Т.61 — перший крок Mistral Vibe Code за новим шаблоном плану (Т.60). Який зміст кроку дати Vibe?» Відповідь: **«63: екран перемоги (Рекомендовано)»**.
- Питання: «Кандидат 63 має три пункти: (є) кнопку «На стартовий екран» на екрані перемоги не тримає жоден тест на видимість; (ж) стилі рядка-пояснення .start-note не тримає жоден тест; (а) рядок-пояснення «Не вдалося завантажити збереження. Почніть нову гру.» на стартовому екрані накриває підпис під логотипом, поки показаний. Тести для (є) і (ж) — сценарій e2e, клас auto (мерж без «схвалюю»). Виправлення (а) — зміна вигляду (index.html), клас approve. Що робимо з (а) у Т.61?» Відповідь: **«Лише тести, (а) пізніше (Рекомендовано)»**.

У звіті, записі кроку й описі PR рішення власника цитувати **лише з цього розділу, дослівно**. Іншого власник не казав: нових цитат не складати, слова не переставляти. Що тест — окремий `test(...)`, а не крок сценарію приймання, і які саме перевірки в ньому, — рішення планувальника.

## Що зробити

### 1. Код

Немає: `src/` і `index.html` не змінюються.

### 2. Тест модуля

Немає.

### 3. Тест e2e: `e2e/acceptance.scenario.ts`

Новий `test(...)` — у самому кінці файла, після закривного `});` сценарію приймання (той закінчується рядком `});` останнім у файлі на `main` = `8caf659`). Сценарій приймання не чіпати.

Блок — **дослівно, кодом нижче**: дописати в кінець файла скриптом `python3` — порожній рядок, вміст `/tmp/blocks/test-t61.txt`, перенос рядка (`s = s + '\n' + block + '\n'`, перед цим `assert s.endswith('});\n')`). Звірити побайтно. Перевірено планувальником на прототипі: зелений на `main`, червоний на поломках розділу 4, крім 8 і 12. Якщо блок не проходить — не переписувати, а написати в сесії, що саме падає.

<!-- блок: test-t61 -->
```ts
// Т.61: екран перемоги і рядок-пояснення невдалого «Продовжити» — на сторінці, а не лише класом hidden.
// Наскрізні тести на сторінці (jsdom) розкладки не мають: кнопка з display:none чи рядок без стилів їх проходять.
// Екран перемоги — правкою сейву (campaign.status = 'перемога'), як у наскрізному тесті Т.58; невдале
// «Продовжити» — зіпсованим списком зондів (ufos = [null]).
const T61_VIEWPORTS = [
  { width: 1366, height: 768 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
];

test('Т.61: екран перемоги і рядок-пояснення стартового екрана — видно на трьох розмірах вікна', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./');
  const helpClose = page.locator('#btn-help-close'); // перший візит — «Як грати» поверх стартового екрана
  if (await helpClose.isVisible()) await helpClose.click();
  await page.locator('#btn-start-new').click();
  await page.locator('#new-game-seed').fill(String(SEED));
  await page.locator('#new-game-preset').selectOption(PRESET);
  await page.locator('#btn-new-game-start').click();
  await expect(page.locator('#geo')).toBeVisible();
  await page.locator('#status-tab-system').click();
  await page.locator('#btn-save-1').click();
  await expect(page.locator('#log')).toContainText('Збережено: слот 1.');
  const good = await page.evaluate(() => localStorage.getItem('rubezh.save.1')!);
  const won = JSON.parse(good) as { state: { campaign: { status: string } } };
  won.state.campaign.status = 'перемога';
  const bad = JSON.parse(good) as { state: { geo: { ufos: unknown } } };
  bad.state.geo.ufos = [null]; // метадані читаються, розбір партії падає

  await test.step('екран перемоги: три кнопки видно в межах вікна, одна під одною', async () => {
    await page.evaluate((s) => localStorage.setItem('rubezh.save.1', s), JSON.stringify(won));
    await page.locator('#btn-load-1').click();
    await expect(page.locator('#campaign-victory')).toBeVisible();
    const ids = ['btn-continue', 'btn-play-again', 'btn-victory-exit'];
    await expect(page.locator('#campaign-victory button')).toHaveText(['Грати далі', 'Грати знов', 'На стартовий екран']);
    for (const size of T61_VIEWPORTS) {
      await page.setViewportSize(size);
      const label = size.width + ' × ' + size.height;
      for (const id of ids) {
        await expect(page.locator('#' + id), label + ': #' + id).toBeVisible();
        await expect(page.locator('#' + id), label + ': #' + id).toBeInViewport({ ratio: 1 });
      }
      const boxes = await page.evaluate(
        (list) =>
          list.map((id) => {
            const r = document.getElementById(id)!.getBoundingClientRect();
            return { top: r.top, bottom: r.bottom, h: r.height, w: r.width };
          }),
        ids
      );
      for (const b of boxes) {
        expect(b.h, label + ': кнопка нижча за тач-ціль 44 px').toBeGreaterThanOrEqual(44);
        expect(b.w, label + ': кнопка вужча за 44 px').toBeGreaterThanOrEqual(44);
      }
      for (let i = 1; i < boxes.length; i++)
        expect(boxes[i]!.top, label + ': кнопки накладаються').toBeGreaterThanOrEqual(boxes[i - 1]!.bottom);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('#btn-victory-exit').click(); // одразу після завантаження незбережених дій немає
    await expect(page.locator('#start-screen')).toBeVisible();
    await expect(page.locator('#campaign-victory')).toBeHidden();
  });

  await test.step('невдале «Продовжити»: рядок-пояснення над кнопками меню, кольором помилки на непрозорій підкладці', async () => {
    await expect(page.locator('#start-note')).toBeHidden();
    await page.evaluate((s) => localStorage.setItem('rubezh.save.1', s), JSON.stringify(bad));
    await page.locator('#btn-start-continue').click();
    const note = page.locator('#start-note');
    await expect(note).toHaveText('Не вдалося завантажити збереження. Почніть нову гру.');
    for (const size of T61_VIEWPORTS) {
      await page.setViewportSize(size);
      const label = size.width + ' × ' + size.height;
      await expect(note, label + ': рядок-пояснення').toBeVisible();
      await expect(note, label + ': рядок-пояснення').toBeInViewport({ ratio: 1 });
      const m = await page.evaluate(() => {
        const n = document.getElementById('start-note')!;
        const r = n.getBoundingClientRect();
        const first = document.getElementById('btn-start-new')!.getBoundingClientRect();
        const s = getComputedStyle(n);
        const rgba = (c: string): number[] => (c.match(/[\d.]+/g) ?? []).map(Number);
        return {
          gap: first.top - r.bottom,
          fits: n.scrollWidth <= n.clientWidth,
          widthDiff: Math.abs(r.width - first.width),
          color: rgba(s.color),
          background: rgba(s.backgroundColor),
        };
      });
      expect(m.gap, label + ': рядок не над першою кнопкою меню або далі за проміжок меню').toBeGreaterThanOrEqual(0);
      expect(m.gap, label + ': рядок не над першою кнопкою меню або далі за проміжок меню').toBeLessThanOrEqual(12);
      expect(m.widthDiff, label + ': рядок вужчий чи ширший за кнопки меню').toBeLessThanOrEqual(1);
      expect(m.fits, label + ': текст рядка обрізано').toBe(true);
      const [r, g, b] = m.color as [number, number, number];
      expect(r - Math.max(g, b), label + ': колір тексту — не колір помилки').toBeGreaterThanOrEqual(80);
      expect(m.background[3] ?? 1, label + ': підкладка рядка прозора').toBeGreaterThanOrEqual(0.9);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate((s) => localStorage.setItem('rubezh.save.1', s), good);
    await page.locator('#btn-start-continue').click(); // цілий слот вантажиться
    await expect(page.locator('#start-screen')).toBeHidden();
  });

  expect(errors, 'помилки сторінки: ' + errors.join(' | ')).toEqual([]);
});
```

Після вставки: `npx prettier --check e2e/acceptance.scenario.ts` і `npx tsc --noEmit -p tsconfig.e2e.json` — без помилок (на прототипі так).

### 4. Навмисні поломки (до PR, результати — у звіт)

Поломки робить скрипт — блок `mutations-py`: скопіювати `/tmp/blocks/mutations-py.txt` у `/tmp/t61/mutations.py` (поза репозиторієм) і запустити з кореня репозиторію проти вже піднятої збірки: `npx vite preview --port 4173 --strictPort` у фоні, далі `E2E_URL=http://localhost:4173/rubezh/ E2E_CHROME=<шлях до chrome> python3 /tmp/t61/mutations.py`. Скрипт по одній робить поломку, збирає гру (`npm run build`), проганяє лише тест «Т.61» (`-g "Т.61"`), друкує рядок таблиці і повертає файл (`git checkout -- <файл>`). Після прогону `git status --short` не показує `index.html` і `src/ui/screens.ts`. Вивід скрипта — рядки таблиці для звіту, без правок.

<!-- блок: mutations-py -->
```python
# Т.61: навмисні поломки для тесту e2e «Т.61» — по одній: правка, збірка, прогін тесту, повернення файла.
# Запуск з кореня репозиторію: E2E_URL=… E2E_CHROME=… python3 /tmp/t61/mutations.py [номери]
import os, re, subprocess, sys

ROOT = os.getcwd()
VICTORY = "      #campaign-victory .btn-play-again {\n"
NOTE_RULE = re.compile(r"      /\* Т\.58: пояснення невдалого.*?\n      \.start-note \{.*?\n      \}\n", re.S)
MUTATIONS = [
    ('index.html', VICTORY, "      #btn-victory-exit {\n        display: none;\n      }\n" + VICTORY, '`#btn-victory-exit { display: none; }` в `index.html`'),
    ('index.html', VICTORY, "      #btn-victory-exit {\n        visibility: hidden;\n      }\n" + VICTORY, '`#btn-victory-exit { visibility: hidden; }` в `index.html`'),
    ('index.html', "        font-size: 16px;\n        margin-top: 16px;\n", "        font-size: 16px;\n        margin-top: 300px;\n", '`margin-top` кнопок екрана перемоги 16px → 300px'),
    ('index.html', NOTE_RULE, '', 'прибрати правило `.start-note` з `index.html` цілком'),
    ('index.html', "        color: #ff8fa3;\n", "        color: #d7e4f7;\n", 'колір `.start-note` #ff8fa3 → #d7e4f7'),
    ('index.html', "        background: rgba(6, 10, 20, 0.95);\n        border: 1px solid rgba(255, 92, 122, 0.6);\n", "        background: rgba(6, 10, 20, 0.4);\n        border: 1px solid rgba(255, 92, 122, 0.6);\n", 'підкладка `.start-note` 0.95 → 0.4'),
    ('index.html', "      .start-note {\n        margin: 0;\n", "      .start-note {\n        margin: 16px 0;\n", '`margin` `.start-note` 0 → 16px 0'),
    ('index.html', "        font-size: 13px;\n        text-align: center;\n        color: #ff8fa3;\n", "        font-size: 13px;\n        color: #ff8fa3;\n", 'прибрати `text-align: center` з `.start-note`'),
    ('index.html', "        font-size: 13px;\n        text-align: center;\n        color: #ff8fa3;\n", "        font-size: 13px;\n        text-align: center;\n        white-space: nowrap;\n        overflow: hidden;\n        color: #ff8fa3;\n", '`white-space: nowrap; overflow: hidden` у `.start-note`'),
    ('src/ui/screens.ts', "    '<p class=\"start-note hidden\" id=\"start-note\"></p>' +\n    '<button id=\"btn-start-new\">Нова партія</button>' +\n", "    '<button id=\"btn-start-new\">Нова партія</button>' +\n    '<p class=\"start-note hidden\" id=\"start-note\"></p>' +\n", 'рядок `start-note` після кнопки `btn-start-new` у `src/ui/screens.ts`'),
    ('src/ui/screens.ts', "'Не вдалося завантажити збереження. Почніть нову гру.'", "'Не вдалося завантажити збереження. Почніть нову партію.'", 'текст `CONTINUE_FAILED_TEXT` «гру» → «партію» у `src/ui/screens.ts`'),
    ('index.html', VICTORY, "      #btn-victory-exit {\n        opacity: 0;\n      }\n" + VICTORY, '`#btn-victory-exit { opacity: 0; }` в `index.html`'),
]


def run(cmd: str) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, shell=True, cwd=ROOT, capture_output=True, text=True)


chosen = [int(x) for x in sys.argv[1:]] or range(1, len(MUTATIONS) + 1)
for n in chosen:
    path, old, new, name = MUTATIONS[n - 1]
    src = open(os.path.join(ROOT, path), encoding='utf-8').read()
    if isinstance(old, re.Pattern):
        found = old.findall(src)
        assert len(found) == 1, (n, 'правило не знайдено')
        broken = src.replace(found[0], new)
    else:
        assert src.count(old) == 1, (n, old)
        broken = src.replace(old, new)
    open(os.path.join(ROOT, path), 'w', encoding='utf-8').write(broken)
    try:
        assert run('npm run build').returncode == 0, (n, 'збірка впала')
        res = run('npx playwright test -c playwright.e2e.config.ts -g "Т.61"')
        errors = [l.strip() for l in res.stdout.splitlines() if l.strip().startswith('Error:')]
        verdict = 'червоний' if res.returncode else 'зелений'
        print('| ' + str(n) + ' | ' + name + ' | ' + verdict + ' | ' + (errors[0][:120] if errors else '—') + ' |')
    finally:
        run('git checkout -- ' + path)
run('npm run build')
```

Що побачив планувальник на прототипі (після останньої правки прототипу, повний вивід скрипта):

| № | Поломка | Тест «Т.61» | Перша помилка |
| --- | --- | --- | --- |
| 1 | `#btn-victory-exit { display: none; }` в `index.html` | червоний | Error: 1366 × 768: #btn-victory-exit |
| 2 | `#btn-victory-exit { visibility: hidden; }` в `index.html` | червоний | Error: 1366 × 768: #btn-victory-exit |
| 3 | `margin-top` кнопок екрана перемоги 16px → 300px | червоний | Error: 1366 × 768: #btn-victory-exit |
| 4 | прибрати правило `.start-note` з `index.html` цілком | червоний | Error: 1366 × 768: рядок не над першою кнопкою меню або далі за проміжок меню |
| 5 | колір `.start-note` #ff8fa3 → #d7e4f7 | червоний | Error: 1366 × 768: колір тексту — не колір помилки |
| 6 | підкладка `.start-note` 0.95 → 0.4 | червоний | Error: 1366 × 768: підкладка рядка прозора |
| 7 | `margin` `.start-note` 0 → 16px 0 | червоний | Error: 1366 × 768: рядок не над першою кнопкою меню або далі за проміжок меню |
| 8 | прибрати `text-align: center` з `.start-note` | зелений | — |
| 9 | `white-space: nowrap; overflow: hidden` у `.start-note` | червоний | Error: 1366 × 768: текст рядка обрізано |
| 10 | рядок `start-note` після кнопки `btn-start-new` у `src/ui/screens.ts` | червоний | Error: 1366 × 768: рядок не над першою кнопкою меню або далі за проміжок меню |
| 11 | текст `CONTINUE_FAILED_TEXT` «гру» → «партію» у `src/ui/screens.ts` | червоний | Error: expect(locator).toHaveText(expected) failed |
| 12 | `#btn-victory-exit { opacity: 0; }` в `index.html` | зелений | — |

У звіт писати те, що вийшло у виконавця; розбіжність із цією таблицею — назвати, без домислів. Якщо e2e у пісочниці не піднявся (розділ «Чекліст перед PR») — поломки не проганяти, у звіті написати «не прогнано: e2e у пісочниці не стартує», таблицю планувальника не копіювати: поломки прожене планувальник.

### 5. Документи кроку (у гілці до відкриття PR)

- Звіт `docs/reports/t61-victory-note-e2e.md` з розділами: «Що зроблено», «Навмисні поломки», «Межі», «Чекліст перед PR», «Метрики», «Що з чекліста не вдалося». **Жодного розділу не пропускати.** Звіт — блок `report` (у ньому вже є блок `limits`), місця `<…>` заповнити: таблиця поломок — вивід скрипта; результати чекліста — по рядку на команду; число рядків; час кроку; що не вдалося (або «нічого»).
- У розділі «Межі» — щонайменше пункти плану, **словами плану, без переказу** — блок `limits` (у блоці `report` він уже стоїть). Межі, знайдені під час роботи, — окремими пунктами після них.

<!-- блок: limits -->
```text
- (а) рядок-пояснення накриває підпис під логотипом, поки показаний (межа (а) звіту Т.58) — тест цього не перевіряє: власник відклав (а) на пізніше
- (б) вирівнювання тексту рядка-пояснення по центру тест не тримає: `text-align: center` успадковується і від `.start-box` (поломка 8 — зелений)
- (в) кнопку з `opacity: 0` тест вважає видимою (поломка 12 — зелений): Playwright `toBeVisible` прозорість не перевіряє; колір тексту рядка перевіряється лише як «червоний канал переважає», контраст з підкладкою — ні
- (г) екран перемоги зроблено правкою сейву (`campaign.status = 'перемога'`) — справжню перемогу на 30-ту добу тест не проходить (як у Т.58)
- (ґ) розмірів вікна три — 1366 × 768, 1024 × 768 і 390 × 844; інші не перевіряються
- (д) з кнопок екрана перемоги тест натискає лише «На стартовий екран» і лише без незбережених дій; вікно «Незбережені зміни» з екрана перемоги тримає наскрізний тест на сторінці Т.58
```

<!-- блок: report -->
````text
# Т.61 — екран перемоги і рядок-пояснення на сторінці: звіт

План — `docs/plans/t61-victory-note-e2e.md`. Тест, звіт, запис кроку і PR — Mistral Vibe Code; план — хмарна сесія Claude.

## Що зроблено

- `e2e/acceptance.scenario.ts`: новий тест e2e «Т.61» (`test(...)` у кінці файла, сценарій приймання ADR-0030 без змін) — дослівно з плану, блок `test-t61`.
  - Екран перемоги (правкою сейву): на 1366 × 768, 1024 × 768 і 390 × 844 кнопки «Грати далі», «Грати знов», «На стартовий екран» видимі, цілком у межах вікна, не менші за 44 px і не накладаються; «На стартовий екран» веде на стартовий екран.
  - Невдале «Продовжити»: на тих самих розмірах рядок-пояснення «Не вдалося завантажити збереження. Почніть нову гру.» видимий, цілком у межах вікна, над першою кнопкою меню (проміжок 0–12 px), завширшки як кнопки, текст не обрізано, колір помилки (червоний канал більший за зелений і синій щонайменше на 80), підкладка з альфою не менше 0,9.
- `src/` і `index.html` не змінювались.
- Документи: цей звіт, запис кроку в `docs/workflow.md`.

## Навмисні поломки

Скрипт `mutations.py` з плану (блок `mutations-py`), прогін проти збірки на кожну поломку, лише тест «Т.61».

| № | Поломка | Тест «Т.61» | Перша помилка |
| --- | --- | --- | --- |
<рядки виводу скрипта без правок>

<розбіжності з таблицею плану — або «Розбіжностей із таблицею плану немає.»>

## Межі

- (а) рядок-пояснення накриває підпис під логотипом, поки показаний (межа (а) звіту Т.58) — тест цього не перевіряє: власник відклав (а) на пізніше
- (б) вирівнювання тексту рядка-пояснення по центру тест не тримає: `text-align: center` успадковується і від `.start-box` (поломка 8 — зелений)
- (в) кнопку з `opacity: 0` тест вважає видимою (поломка 12 — зелений): Playwright `toBeVisible` прозорість не перевіряє; колір тексту рядка перевіряється лише як «червоний канал переважає», контраст з підкладкою — ні
- (г) екран перемоги зроблено правкою сейву (`campaign.status = 'перемога'`) — справжню перемогу на 30-ту добу тест не проходить (як у Т.58)
- (ґ) розмірів вікна три — 1366 × 768, 1024 × 768 і 390 × 844; інші не перевіряються
- (д) з кнопок екрана перемоги тест натискає лише «На стартовий екран» і лише без незбережених дій; вікно «Незбережені зміни» з екрана перемоги тримає наскрізний тест на сторінці Т.58

## Чекліст перед PR

<по рядку на кожну команду чекліста плану: команда — результат>

## Метрики

- `./scripts/pr-size.sh origin/main HEAD` — <число> рядків (ліміт 500).
- Час кроку — <від запуску сесії до відкриття PR, хв>.

## Що з чекліста не вдалося

<що саме і чому — або «нічого»>

## Відповідь власника (17.11.2026)

- Питання: «Т.61 — перший крок Mistral Vibe Code за новим шаблоном плану (Т.60). Який зміст кроку дати Vibe?» Відповідь: «63: екран перемоги (Рекомендовано)».
- Питання: «Кандидат 63 має три пункти: (є) кнопку «На стартовий екран» на екрані перемоги не тримає жоден тест на видимість; (ж) стилі рядка-пояснення .start-note не тримає жоден тест; (а) рядок-пояснення «Не вдалося завантажити збереження. Почніть нову гру.» на стартовому екрані накриває підпис під логотипом, поки показаний. Тести для (є) і (ж) — сценарій e2e, клас auto (мерж без «схвалюю»). Виправлення (а) — зміна вигляду (index.html), клас approve. Що робимо з (а) у Т.61?» Відповідь: «Лише тести, (а) пізніше (Рекомендовано)».

## Аудит

Аудит ще не проведено.
````

- Числа звірки скриптом до відкриття PR — у звіт, розділ «Чекліст перед PR»; числа запуску з `--pr` одразу після відкриття PR — в опис, а не новим комітом (розділ «PR» нижче); у звіт — разом із порцією документів після аудиту, якщо планувальник попросить.
- Число рядків PR перераховувати **після кожного коміту** і виправляти скрізь, де воно названо: у звіті, записі кроку й описі PR.
- Запис кроку в `docs/workflow.md`, розділ «Технічні задачі (позафазні)», одразу після запису Т.60 — після рядка-якоря ``    - Звіт — `docs/reports/t60-vibe-plan-template.md` `` (він у файлі один) — блок `record` (місця `<…>` — числа і результати виконавця: число червоних поломок, число рядків, урок). Підпункт «Аудит» і номер PR — другим комітом, після аудиту; до аудиту тверджень про його результат не писати.

<!-- блок: record -->
```text
- [x] **Т.61 (рішення власника 17.11.2026, після Т.60): екран перемоги і рядок-пояснення на сторінці — перший крок Vibe за шаблоном Т.60.** Мета: кандидат 65 — малий крок тестів робить Mistral Vibe Code за планом із готовими блоками (`docs/plans/t61-victory-note-e2e.md`); зміст — кандидат 63, межі (є) і (ж) звіту Т.58: кнопку «На стартовий екран» на екрані перемоги і стилі рядка-пояснення `.start-note` не тримав жоден тест. Відповіді власника кнопками: «63: екран перемоги (Рекомендовано)»; «Лише тести, (а) пізніше (Рекомендовано)». `src/` і `index.html` не змінювались.
    - Зроблено: новий тест e2e «Т.61» у кінці `e2e/acceptance.scenario.ts` — окремий `test(...)`, сценарій приймання ADR-0030 без змін. Екран перемоги (правкою сейву): три кнопки видимі, цілком у межах вікна на 1366 × 768, 1024 × 768 і 390 × 844, не менші за 44 px, не накладаються; «На стартовий екран» веде на стартовий екран. Невдале «Продовжити»: рядок-пояснення з текстом дослівно, у межах вікна, над першою кнопкою меню (проміжок 0–12 px), завширшки як кнопки, текст не обрізано, колір помилки, непрозора підкладка.
    - Виконано: навмисні поломки — <скільки з 12 червоні; або «не прогнано: e2e у пісочниці не стартує»>; межі (а)–(д) — у звіті; `./scripts/pr-size.sh origin/main HEAD` — <число> рядків.
    - Урок: <одне речення виконавця про те, що справді сталося в цій сесії>
    - Звіт — `docs/reports/t61-victory-note-e2e.md`
```

- Власні уроки про спосіб роботи — один-два рядки в `docs/agents/common.md`, розділ «Лише для Mistral Vibe Code», з позначкою «Т.61».
- **Писати лише те, що сам зробив і побачив.** Про секрети репозиторію, налаштування CI і чужі середовища нічого не стверджувати: `mistral-audit` — джоба CI, з пісочниці не видно, чи є в неї ключ. Про аудит писати лише отримане в сесії: знахідки, що з кожною зроблено, і числа аудиторів, які дав планувальник, — у підпункті «Аудит» запису кроку, розділі «Аудит» звіту й опису PR (відхилені знахідки — з причиною). Урок — лише про те, що справді сталося в цій сесії; причин не вигадувати.

## Обмеження

- **Розмір:** оцінка — 0 рядків коду і ≈ 105 рядків тесту e2e, один PR. Якщо виходить понад 200 рядків у підрахунку — написати про це в сесії до того, як продовжувати; мітку `size-deviation` не ставити.
- **Не чіпати:** `src/`, `index.html`, сценарій приймання (перший `test(...)` у `e2e/acceptance.scenario.ts`), `e2e/mirror.ts`, `playwright*.config.ts`, `.github/`, `package.json`, `docs/plans/`.
- У доданих рядках (код, коментарі, тести, документи) немає трансліту — лише кирилиця.
- Тести не послаблювати, щоб пройшли.
- Історію не переписувати (без amend, rebase, force-push).
- **Працювати короткими кроками:** одна правка — одна перевірка — коміт. Великий документ писати частинами, а не обмірковувати цілком.

## Чекліст перед PR

`npx tsc --noEmit`, `npx tsc --noEmit -p tsconfig.core.json`, `npx tsc --noEmit -p tsconfig.e2e.json`, `npm run lint`, `npm run format:check`, `npx prettier --check e2e/acceptance.scenario.ts`, `npm test`, `npm run docs`, `npm run test:e2e`.

Крок змінює файл сценарію e2e, тож e2e обов'язковий (`AGENTS.md`). Як проганяти в пісочниці: підготовка браузера — розділ «Лише для Mistral Vibe Code» довідника (`npx playwright install chromium`, бібліотеки з `.deb` у `/tmp/debs/root`, `LD_LIBRARY_PATH`, шрифти DejaVu і `FONTCONFIG_FILE` — без шрифтів текст нульової висоти, і `toBeVisible` падає навіть на `main`), на підготовку — **не більше 15 хвилин**. Далі `npm run test:e2e` (обидва тести файла) і окремо лише новий: `npx playwright test -c playwright.e2e.config.ts -g "Т.61"`. Якщо браузер не піднявся або тест «Т.61» падає — перевірити той самий прогін на чистому `origin/main` з доданим блоком (`git stash` не потрібен: блок — єдина зміна коду). Падає через пісочницю (той самий збій на сценарії приймання без змін) — написати це у звіті й описі PR і йти далі: e2e прожене CI, поломки — планувальник. Падає лише тест «Т.61» — не правити його, а написати в сесії, що саме падає (перша помилка повністю).

## PR

- Гілка — ця сама: `test/t61-victory-note-e2e` (план уже в ній першим комітом). Комітити в неї, Conventional Commits українською.
- **Документи кроку закомітити до відкриття PR** (звіт, запис кроку, рядки довідника): перед `gh pr create` команда `git log --oneline origin/main..HEAD` показує коміт із ними.
- PR у `main`, **не чернеткою**. Назва — **дослівно, скопіювати**: `test(e2e): Т.61 — екран перемоги і рядок-пояснення на сторінці`.
- Опис PR — **увесь, дослівно** блоком `pr-body`: скопіювати `/tmp/blocks/pr-body.txt` у `/tmp/pr-body.md` і заповнити місця `<…>` там (повторний запуск вирізача перезаписує `/tmp/blocks`): результати чекліста, число рядків, результат поломок, числа звірки. Перед відкриттям PR `grep -n '<[^!]' /tmp/pr-body.md` нічого не знаходить. Рядок `Iter-Tag` — з початку рядка, без відступу. Розділів понад ці не додавати; розділ «Аудит» до аудиту каже «Аудит ще не проведено», після аудиту його текст дає планувальник.

<!-- блок: pr-body -->
```text
### Що змінено і чому

Т.61 — перший крок Mistral Vibe Code за шаблоном плану Т.60 (кандидат 65); зміст — кандидат 63, межі (є) і (ж) звіту Т.58 (`docs/reports/t58-after-exit-to-start.md`): що кнопку «На стартовий екран» на екрані перемоги видно і що рядок-пояснення невдалого «Продовжити» має свої стилі, не тримав жоден тест — наскрізні тести на сторінці (jsdom) розкладки не мають. Новий тест e2e «Т.61» у `e2e/acceptance.scenario.ts` перевіряє це в браузері на трьох розмірах вікна; сценарій приймання ADR-0030 без змін. `src/` і `index.html` не змінювались. Звіт — `docs/reports/t61-victory-note-e2e.md`, запис кроку — `docs/workflow.md`.

### Критерії приймання

- Коли показано екран перемоги, тест e2e «Т.61» перевіряє на 1366 × 768, 1024 × 768 і 390 × 844, що кнопки «Грати далі», «Грати знов» і «На стартовий екран» видимі, цілком у межах вікна, не менші за 44 px і не накладаються; «На стартовий екран» веде на стартовий екран.
- Коли «Продовжити» не вдалося, тест перевіряє на тих самих розмірах, що рядок-пояснення «Не вдалося завантажити збереження. Почніть нову гру.» видимий, цілком у межах вікна, над першою кнопкою меню (проміжок 0–12 px), завширшки як кнопки, текст не обрізано, колір тексту — колір помилки, підкладка непрозора.
- Навмисні поломки 1–7 і 9–11 плану тест ловить, 8 і 12 — ні (межі (б) і (в) звіту).
- Наявні тести не послаблено; клас PR — `auto`.

### Відповідь власника (17.11.2026)

- Питання: «Т.61 — перший крок Mistral Vibe Code за новим шаблоном плану (Т.60). Який зміст кроку дати Vibe?» Відповідь: «63: екран перемоги (Рекомендовано)».
- Питання: «Кандидат 63 має три пункти: (є) кнопку «На стартовий екран» на екрані перемоги не тримає жоден тест на видимість; (ж) стилі рядка-пояснення .start-note не тримає жоден тест; (а) рядок-пояснення «Не вдалося завантажити збереження. Почніть нову гру.» на стартовому екрані накриває підпис під логотипом, поки показаний. Тести для (є) і (ж) — сценарій e2e, клас auto (мерж без «схвалюю»). Виправлення (а) — зміна вигляду (index.html), клас approve. Що робимо з (а) у Т.61?» Відповідь: «Лише тести, (а) пізніше (Рекомендовано)».

### Перевірка

<по рядку на кожну команду чекліста: команда — результат>
- `./scripts/pr-size.sh origin/main HEAD` — <число> рядків (ліміт 500).
- Навмисні поломки — <скільки з 12 червоні, розбіжності з таблицею плану; або «не прогнано: e2e у пісочниці не стартує»>.
- `node scripts/vibe-plan-check.mjs --plan docs/plans/t61-victory-note-e2e.md` з назвою й описом — <число> знахідок; з `--pr` — <число> знахідок.

### Аудит

Аудит ще не проведено.

Згадка: Т.58, PR #358; Т.60, PR #361; план — `docs/plans/t61-victory-note-e2e.md`.

Iter-Tag: iter-T.61
```

- Перед відкриттям PR, коли документи кроку вже закомічено, запустити звірку з планом разом із готовими назвою й описом: `node scripts/vibe-plan-check.mjs --plan docs/plans/t61-victory-note-e2e.md --title "test(e2e): Т.61 — екран перемоги і рядок-пояснення на сторінці" --body-file /tmp/pr-body.md` — числа цього запуску вже в описі, з яким відкривається PR; після відкриття — ще раз із `--pr <номер>` (звіряє назву й опис PR). Кожну знахідку виправити або назвати в описі PR з причиною. **Якщо числа запуску з `--pr` інші — дописати їх в опис PR** (`gh pr edit <номер> --body-file <файл>`), **а не новим комітом**. Якщо знахідка вимагає правки файла — один коміт і повідомлення про нього в сесії.
- Після відкриття PR — коротко відповісти в сесії: номер PR, що з чекліста не вдалося, скільки часу зайняв крок і перелік «пункт плану — зроблено / ні» з доказом `grep` на кожен рядок «зроблено» (пункти: тест вставлено, поломки, звіт, запис кроку, рядок довідника, опис PR). **Не мержити.**

## Після аудиту: порції (додано планувальником після аудиту PR #362)

Спершу `git pull`. Блоки цього розділу вирізає той самий скрипт: `node scripts/vibe-plan-blocks.mjs docs/plans/t61-victory-note-e2e.md /tmp/blocks2` (нова тека). Кожну порцію — окремим комітом; **пуш один, наприкінці порції 3**, після правки опису PR. Після кожної порції — перелік «пункт — зроблено / ні» з доказом `grep`.

### Порція 1 — тест і поломки (код)

1. У `e2e/acceptance.scenario.ts` замінити текст від рядка `// Т.61: екран перемоги і рядок-пояснення невдалого «Продовжити» — на сторінці, а не лише класом hidden.` (він у файлі один) до кінця файла вмістом блоку `test-t61-v2` і переносом рядка в кінці. Сценарій приймання не чіпати. Перевірка: `npx prettier --check e2e/acceptance.scenario.ts`, `npx tsc --noEmit -p tsconfig.e2e.json`.
2. `npm run test:e2e` — обидва тести зелені.
3. Поломки — блок `mutations-py-v2` у `/tmp/t61/mutations-v2.py`, запуск як у розділі 4 (поломок тепер 19; тайм-аут тесту на поломку — 60 с). Що побачив планувальник — таблиця нижче.
4. Коміт: `test(e2e): Т.61 — тест посилено за аудитом: перекриття, прозорість, кегль, обрізаний текст`.

<!-- блок: test-t61-v2 -->
```ts
// Т.61: екран перемоги і рядок-пояснення невдалого «Продовжити» — на сторінці, а не лише класом hidden.
// Наскрізні тести на сторінці (jsdom) розкладки не мають: кнопка з display:none чи рядок без стилів їх проходять.
// Екран перемоги — правкою сейву (campaign.status = 'перемога'), як у наскрізному тесті Т.58; невдале
// «Продовжити» — зіпсованим списком зондів (ufos = [null]).
const T61_VIEWPORTS = [
  { width: 1366, height: 768 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
];

// Т.61: що бачить гравець у центрі елемента — сам елемент (не перекритий), повна непрозорість з предками,
// непрозорий текст не меншого за 12 px кегля, текст не обрізано по ширині
const t61Look = (page: Page, id: string) =>
  page.evaluate((elId) => {
    const el = document.getElementById(elId)!;
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    let opacity = 1;
    for (let e: Element | null = el; e !== null; e = e.parentElement) opacity *= Number(getComputedStyle(e).opacity);
    const s = getComputedStyle(el);
    const rgba = (c: string): number[] => (c.match(/[\d.]+/g) ?? []).map(Number);
    return {
      top: r.top,
      bottom: r.bottom,
      h: r.height,
      w: r.width,
      onTop: hit !== null && el.contains(hit),
      opacity,
      color: rgba(s.color),
      background: rgba(s.backgroundColor),
      fontSize: parseFloat(s.fontSize),
      fits: el.scrollWidth <= el.clientWidth,
    };
  }, id);

const t61Visible = (b: Awaited<ReturnType<typeof t61Look>>, label: string): void => {
  expect(b.onTop, label + ': елемент перекрито').toBe(true);
  expect(b.opacity, label + ': елемент прозорий').toBe(1);
  expect(b.color[3] ?? 1, label + ': текст прозорий').toBeGreaterThanOrEqual(0.9);
  expect(b.fontSize, label + ': кегль тексту менший за 12 px').toBeGreaterThanOrEqual(12);
  expect(b.fits, label + ': текст обрізано').toBe(true);
};

test('Т.61: екран перемоги і рядок-пояснення стартового екрана — видно на трьох розмірах вікна', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./');
  const helpClose = page.locator('#btn-help-close'); // перший візит — «Як грати» поверх стартового екрана
  if (await helpClose.isVisible()) await helpClose.click();
  await page.locator('#btn-start-new').click();
  await page.locator('#new-game-seed').fill(String(SEED));
  await page.locator('#new-game-preset').selectOption(PRESET);
  await page.locator('#btn-new-game-start').click();
  await expect(page.locator('#geo')).toBeVisible();
  await page.locator('#status-tab-system').click();
  await page.locator('#btn-save-1').click();
  await expect(page.locator('#log')).toContainText('Збережено: слот 1.');
  const good = await page.evaluate(() => localStorage.getItem('rubezh.save.1')!);
  const won = JSON.parse(good) as { state: { campaign: { status: string } } };
  won.state.campaign.status = 'перемога';
  const bad = JSON.parse(good) as { state: { geo: { ufos: unknown } } };
  bad.state.geo.ufos = [null]; // метадані читаються, розбір партії падає

  await test.step('екран перемоги: три кнопки видно в межах вікна, одна під одною', async () => {
    await page.evaluate((s) => localStorage.setItem('rubezh.save.1', s), JSON.stringify(won));
    await page.locator('#btn-load-1').click();
    await expect(page.locator('#campaign-victory')).toBeVisible();
    const ids = ['btn-continue', 'btn-play-again', 'btn-victory-exit'];
    await expect(page.locator('#campaign-victory button')).toHaveText(['Грати далі', 'Грати знов', 'На стартовий екран']);
    for (const size of T61_VIEWPORTS) {
      await page.setViewportSize(size);
      const label = size.width + ' × ' + size.height;
      for (const id of ids) {
        await expect(page.locator('#' + id), label + ': #' + id).toBeVisible();
        await expect(page.locator('#' + id), label + ': #' + id).toBeInViewport({ ratio: 1 });
      }
      const boxes = [];
      for (const id of ids) boxes.push(await t61Look(page, id));
      for (const [i, b] of boxes.entries()) {
        t61Visible(b, label + ': #' + ids[i]);
        expect(b.h, label + ': кнопка нижча за тач-ціль 44 px').toBeGreaterThanOrEqual(44);
        expect(b.w, label + ': кнопка вужча за 44 px').toBeGreaterThanOrEqual(44);
      }
      for (let i = 1; i < boxes.length; i++)
        expect(boxes[i]!.top, label + ': кнопки накладаються').toBeGreaterThanOrEqual(boxes[i - 1]!.bottom);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('#btn-victory-exit').click(); // одразу після завантаження незбережених дій немає
    await expect(page.locator('#start-screen')).toBeVisible();
    await expect(page.locator('#campaign-victory')).toBeHidden();
  });

  await test.step('невдале «Продовжити»: рядок-пояснення над кнопками меню, кольором помилки на непрозорій підкладці', async () => {
    await expect(page.locator('#start-note')).toBeHidden();
    await page.evaluate((s) => localStorage.setItem('rubezh.save.1', s), JSON.stringify(bad));
    await page.locator('#btn-start-continue').click();
    const note = page.locator('#start-note');
    await expect(note).toHaveText('Не вдалося завантажити збереження. Почніть нову гру.');
    for (const size of T61_VIEWPORTS) {
      await page.setViewportSize(size);
      const label = size.width + ' × ' + size.height;
      await expect(note, label + ': рядок-пояснення').toBeVisible();
      await expect(note, label + ': рядок-пояснення').toBeInViewport({ ratio: 1 });
      const m = await t61Look(page, 'start-note');
      const first = await t61Look(page, 'btn-start-new');
      t61Visible(m, label + ': рядок-пояснення');
      const gap = first.top - m.bottom;
      expect(gap, label + ': рядок не над першою кнопкою меню або далі за проміжок меню').toBeGreaterThanOrEqual(0);
      expect(gap, label + ': рядок не над першою кнопкою меню або далі за проміжок меню').toBeLessThanOrEqual(12);
      expect(Math.abs(m.w - first.w), label + ': рядок вужчий чи ширший за кнопки меню').toBeLessThanOrEqual(1);
      const [r, g, b] = m.color as [number, number, number];
      expect(r - Math.max(g, b), label + ': колір тексту — не колір помилки').toBeGreaterThanOrEqual(80);
      expect(m.background[3] ?? 1, label + ': підкладка рядка прозора').toBeGreaterThanOrEqual(0.9);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate((s) => localStorage.setItem('rubezh.save.1', s), good);
    await page.locator('#btn-start-continue').click(); // цілий слот вантажиться
    await expect(page.locator('#start-screen')).toBeHidden();
  });

  expect(errors, 'помилки сторінки: ' + errors.join(' | ')).toEqual([]);
});
```

<!-- блок: mutations-py-v2 -->
```python
# Т.61: навмисні поломки для тесту e2e «Т.61» — по одній: правка, збірка, прогін тесту, повернення файла.
# Запуск з кореня репозиторію: E2E_URL=… E2E_CHROME=… python3 /tmp/t61/mutations.py [номери]
import os, re, subprocess, sys

ROOT = os.getcwd()
VICTORY = "      #campaign-victory .btn-play-again {\n"
NOTE_RULE = re.compile(r"      /\* Т\.58: пояснення невдалого.*?\n      \.start-note \{.*?\n      \}\n", re.S)
MUTATIONS = [
    ('index.html', VICTORY, "      #btn-victory-exit {\n        display: none;\n      }\n" + VICTORY, '`#btn-victory-exit { display: none; }` в `index.html`'),
    ('index.html', VICTORY, "      #btn-victory-exit {\n        visibility: hidden;\n      }\n" + VICTORY, '`#btn-victory-exit { visibility: hidden; }` в `index.html`'),
    ('index.html', "        font-size: 16px;\n        margin-top: 16px;\n", "        font-size: 16px;\n        margin-top: 300px;\n", '`margin-top` кнопок екрана перемоги 16px → 300px'),
    ('index.html', NOTE_RULE, '', 'прибрати правило `.start-note` з `index.html` цілком'),
    ('index.html', "        color: #ff8fa3;\n", "        color: #d7e4f7;\n", 'колір `.start-note` #ff8fa3 → #d7e4f7'),
    ('index.html', "        background: rgba(6, 10, 20, 0.95);\n        border: 1px solid rgba(255, 92, 122, 0.6);\n", "        background: rgba(6, 10, 20, 0.4);\n        border: 1px solid rgba(255, 92, 122, 0.6);\n", 'підкладка `.start-note` 0.95 → 0.4'),
    ('index.html', "      .start-note {\n        margin: 0;\n", "      .start-note {\n        margin: 16px 0;\n", '`margin` `.start-note` 0 → 16px 0'),
    ('index.html', "        font-size: 13px;\n        text-align: center;\n        color: #ff8fa3;\n", "        font-size: 13px;\n        color: #ff8fa3;\n", 'прибрати `text-align: center` з `.start-note`'),
    ('index.html', "        font-size: 13px;\n        text-align: center;\n        color: #ff8fa3;\n", "        font-size: 13px;\n        text-align: center;\n        white-space: nowrap;\n        overflow: hidden;\n        color: #ff8fa3;\n", '`white-space: nowrap; overflow: hidden` у `.start-note`'),
    ('src/ui/screens.ts', "    '<p class=\"start-note hidden\" id=\"start-note\"></p>' +\n    '<button id=\"btn-start-new\">Нова партія</button>' +\n", "    '<button id=\"btn-start-new\">Нова партія</button>' +\n    '<p class=\"start-note hidden\" id=\"start-note\"></p>' +\n", 'рядок `start-note` після кнопки `btn-start-new` у `src/ui/screens.ts`'),
    ('src/ui/screens.ts', "'Не вдалося завантажити збереження. Почніть нову гру.'", "'Не вдалося завантажити збереження. Почніть нову партію.'", 'текст `CONTINUE_FAILED_TEXT` «гру» → «партію» у `src/ui/screens.ts`'),
    ('index.html', VICTORY, "      #btn-victory-exit {\n        opacity: 0;\n      }\n" + VICTORY, '`#btn-victory-exit { opacity: 0; }` в `index.html`'),
    ('index.html', "        justify-content: center;\n        z-index: 100;\n      }\n      #campaign-victory .panel {\n", "        justify-content: center;\n        z-index: -1;\n      }\n      #campaign-victory .panel {\n", '`z-index` екрана перемоги 100 → -1 (під грою)'),
    ('index.html', VICTORY, "      #btn-victory-exit {\n        color: transparent !important;\n      }\n" + VICTORY, '`#btn-victory-exit { color: transparent }` в `index.html`'),
    ('index.html', "      .start-note {\n        margin: 0;\n", "      .start-note {\n        margin: 0;\n        font-size: 0 !important;\n", '`font-size: 0` у `.start-note`'),
    ('index.html', "        color: #ff8fa3;\n", "        color: rgba(255, 143, 163, 0);\n", 'колір `.start-note` з альфою 0'),
    ('index.html', "      .start-note {\n        margin: 0;\n", "      .start-note {\n        margin: 0;\n        opacity: 0;\n", '`opacity: 0` у `.start-note`'),
    ('index.html', VICTORY, "      #btn-victory-exit {\n        width: 60px;\n        white-space: nowrap;\n        overflow: hidden;\n      }\n" + VICTORY, '`#btn-victory-exit` 60px, `nowrap`, `overflow: hidden`'),
    ('index.html', VICTORY, "      @media (max-width: 400px) {\n        #campaign-victory {\n          z-index: -1;\n        }\n      }\n" + VICTORY, 'екран перемоги під грою лише при `max-width: 400px`'),
]


def run(cmd: str) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, shell=True, cwd=ROOT, capture_output=True, text=True)


chosen = [int(x) for x in sys.argv[1:]] or range(1, len(MUTATIONS) + 1)
for n in chosen:
    path, old, new, name = MUTATIONS[n - 1]
    src = open(os.path.join(ROOT, path), encoding='utf-8').read()
    if isinstance(old, re.Pattern):
        found = old.findall(src)
        assert len(found) == 1, (n, 'правило не знайдено')
        broken = src.replace(found[0], new)
    else:
        assert src.count(old) == 1, (n, old)
        broken = src.replace(old, new)
    open(os.path.join(ROOT, path), 'w', encoding='utf-8').write(broken)
    try:
        assert run('npm run build').returncode == 0, (n, 'збірка впала')
        res = run('npx playwright test -c playwright.e2e.config.ts -g "Т.61" --timeout 60000')
        errors = [l.strip() for l in res.stdout.splitlines() if l.strip().startswith('Error:')]
        verdict = 'червоний' if res.returncode else 'зелений'
        print('| ' + str(n) + ' | ' + name + ' | ' + verdict + ' | ' + (errors[0][:120] if errors else '—') + ' |')
    finally:
        run('git checkout -- ' + path)
run('npm run build')
```

Що побачив планувальник на прототипі з блоком `test-t61-v2` (повний вивід `mutations-v2.py`):

| № | Поломка | Тест «Т.61» | Перша помилка |
| --- | --- | --- | --- |
| 1 | `#btn-victory-exit { display: none; }` в `index.html` | червоний | Error: 1366 × 768: #btn-victory-exit |
| 2 | `#btn-victory-exit { visibility: hidden; }` в `index.html` | червоний | Error: 1366 × 768: #btn-victory-exit |
| 3 | `margin-top` кнопок екрана перемоги 16px → 300px | червоний | Error: 1366 × 768: #btn-victory-exit |
| 4 | прибрати правило `.start-note` з `index.html` цілком | червоний | Error: 1366 × 768: рядок не над першою кнопкою меню або далі за проміжок меню |
| 5 | колір `.start-note` #ff8fa3 → #d7e4f7 | червоний | Error: 1366 × 768: колір тексту — не колір помилки |
| 6 | підкладка `.start-note` 0.95 → 0.4 | червоний | Error: 1366 × 768: підкладка рядка прозора |
| 7 | `margin` `.start-note` 0 → 16px 0 | червоний | Error: 1366 × 768: рядок не над першою кнопкою меню або далі за проміжок меню |
| 8 | прибрати `text-align: center` з `.start-note` | зелений | — |
| 9 | `white-space: nowrap; overflow: hidden` у `.start-note` | червоний | Error: 1366 × 768: рядок-пояснення: текст обрізано |
| 10 | рядок `start-note` після кнопки `btn-start-new` у `src/ui/screens.ts` | червоний | Error: 1366 × 768: рядок не над першою кнопкою меню або далі за проміжок меню |
| 11 | текст `CONTINUE_FAILED_TEXT` «гру» → «партію» у `src/ui/screens.ts` | червоний | Error: expect(locator).toHaveText(expected) failed |
| 12 | `#btn-victory-exit { opacity: 0; }` в `index.html` | червоний | Error: 1366 × 768: #btn-victory-exit: елемент прозорий |
| 13 | `z-index` екрана перемоги 100 → -1 (під грою) | червоний | Error: 1366 × 768: #btn-continue: елемент перекрито |
| 14 | `#btn-victory-exit { color: transparent }` в `index.html` | червоний | Error: 1366 × 768: #btn-victory-exit: текст прозорий |
| 15 | `font-size: 0` у `.start-note` | червоний | Error: 1366 × 768: рядок-пояснення: кегль тексту менший за 12 px |
| 16 | колір `.start-note` з альфою 0 | червоний | Error: 1366 × 768: рядок-пояснення: текст прозорий |
| 17 | `opacity: 0` у `.start-note` | червоний | Error: 1366 × 768: рядок-пояснення: елемент прозорий |
| 18 | `#btn-victory-exit` 60px, `nowrap`, `overflow: hidden` | червоний | Error: 1366 × 768: #btn-victory-exit: текст обрізано |
| 19 | екран перемоги під грою лише при `max-width: 400px` | червоний | Error: 390 × 844: #btn-continue: елемент перекрито |

### Порція 2 — звіт і запис кроку

1. `docs/reports/t61-victory-note-e2e.md` — переписати цілком вмістом блоку `report-v2` з переносом рядка в кінці; місця `<…>`: рядки виводу скрипта поломок порції 1 без правок; результат `npm run test:e2e` порції 1.
2. `docs/workflow.md` — замінити весь запис Т.61 (від рядка, що починається з `- [x] **Т.61 (рішення власника 17.11.2026, після Т.60)`, до рядка ``    - Звіт — `docs/reports/t61-victory-note-e2e.md` `` включно) вмістом блоку `record-v2` з переносом рядка в кінці; місце `<…>` — одне речення уроку про те, що справді сталося в цій сесії.
3. `grep -n 'мутац\|sandbox\|закроку' docs/reports/t61-victory-note-e2e.md docs/workflow.md` — порожньо в рядках Т.61.
4. Коміт: `docs(reports): Т.61 — звіт і запис кроку після аудиту`.

<!-- блок: report-v2 -->
````text
# Т.61 — екран перемоги і рядок-пояснення на сторінці: звіт

План — `docs/plans/t61-victory-note-e2e.md`. Тест, звіт, запис кроку і PR — Mistral Vibe Code; план і аудит — хмарна сесія Claude.

## Що зроблено

- `e2e/acceptance.scenario.ts`: новий тест e2e «Т.61» (`test(...)` у кінці файла, сценарій приймання ADR-0030 без змін) — дослівно з плану, блок `test-t61`, після аудиту — блок `test-t61-v2`.
  - Екран перемоги (правкою сейву): на 1366 × 768, 1024 × 768 і 390 × 844 кнопки «Грати далі», «Грати знов», «На стартовий екран» видимі, цілком у межах вікна, не менші за 44 px і не накладаються; «На стартовий екран» веде на стартовий екран.
  - Невдале «Продовжити»: на тих самих розмірах рядок-пояснення «Не вдалося завантажити збереження. Почніть нову гру.» видимий, цілком у межах вікна, над першою кнопкою меню (проміжок 0–12 px), завширшки як кнопки, колір помилки (червоний канал більший за зелений і синій щонайменше на 80), підкладка з альфою не менше 0,9.
  - Після аудиту — для кожної кнопки екрана перемоги і для рядка-пояснення: у центрі елемента — сам елемент (не перекритий), непрозорість з усіма предками — 1, альфа кольору тексту не менше 0,9, кегль не менший за 12 px, текст не обрізано по ширині.
- `src/` і `index.html` не змінювались.
- Документи: цей звіт, запис кроку в `docs/workflow.md`, рядок у `docs/agents/common.md` (розділ «Лише для Mistral Vibe Code»).

## Навмисні поломки

Скрипт `mutations-v2.py` з плану (блок `mutations-py-v2`, поломки 1–12 — плану, 13–19 — з аудиту), прогін проти збірки на кожну поломку, лише тест «Т.61».

| № | Поломка | Тест «Т.61» | Перша помилка |
| --- | --- | --- | --- |
<рядки виводу скрипта без правок>

## Межі

- (а) рядок-пояснення накриває підпис під логотипом, поки показаний (межа (а) звіту Т.58) — тест цього не перевіряє: власник відклав (а) на пізніше
- (б) вирівнювання тексту рядка-пояснення по центру тест не тримає: `text-align: center` успадковується і від `.start-box` (поломка 8 — зелений)
- (в) контраст тексту з підкладкою тест не перевіряє: колір тексту рядка-пояснення — лише «червоний канал переважає», текст кнопок — лише непрозорість; перекриття — лише в центральній точці елемента
- (г) екран перемоги зроблено правкою сейву (`campaign.status = 'перемога'`) — справжню перемогу на 30-ту добу тест не проходить (як у Т.58)
- (ґ) розмірів вікна три — 1366 × 768, 1024 × 768 і 390 × 844; інші не перевіряються
- (д) з кнопок екрана перемоги тест натискає лише «На стартовий екран» і лише без незбережених дій; вікно «Незбережені зміни» з екрана перемоги тримає наскрізний тест на сторінці Т.58

## Чекліст перед PR

- `npx tsc --noEmit` — ок
- `npx tsc --noEmit -p tsconfig.core.json` — ок
- `npx tsc --noEmit -p tsconfig.e2e.json` — ок
- `npm run lint` — ок
- `npm run format:check` — ок
- `npx prettier --check e2e/acceptance.scenario.ts` — ок
- `npm test` — 47 файлів, 1186 тестів, усі зелені
- `npm run docs` — 0 помилок
- `npm run test:e2e` — до аудиту: 2 passed; після порції 1: <результат>
- `node scripts/vibe-plan-check.mjs --plan docs/plans/t61-victory-note-e2e.md` з назвою й описом — 0 знахідок; з `--pr 362` — 0 знахідок

## Метрики

- `./scripts/pr-size.sh origin/main HEAD` — 122 рядки (ліміт 500).
- Час кроку — ≈ 24 хв від запуску сесії виконавця до відкриття PR #362 (за годинником сесії-планувальника, 13:00–13:24 UTC).

## Що з чекліста не вдалося

Нічого.

## Відповідь власника (17.11.2026)

- Питання: «Т.61 — перший крок Mistral Vibe Code за новим шаблоном плану (Т.60). Який зміст кроку дати Vibe?» Відповідь: «63: екран перемоги (Рекомендовано)».
- Питання: «Кандидат 63 має три пункти: (є) кнопку «На стартовий екран» на екрані перемоги не тримає жоден тест на видимість; (ж) стилі рядка-пояснення .start-note не тримає жоден тест; (а) рядок-пояснення «Не вдалося завантажити збереження. Почніть нову гру.» на стартовому екрані накриває підпис під логотипом, поки показаний. Тести для (є) і (ж) — сценарій e2e, клас auto (мерж без «схвалюю»). Виправлення (а) — зміна вигляду (index.html), клас approve. Що робимо з (а) у Т.61?» Відповідь: «Лише тести, (а) пізніше (Рекомендовано)».

## Аудит

Аудит PR #362 (ADR-0097). Аудитор для мержу — Opus, субагент сесії-планувальника з копією репозиторію (коміт `e27e18f`): знайдено 10, підтверджено 9, відхилено 1; ≈ 9 хв, ≈ 157 тис. токенів. Mistral Large (джоба `mistral-audit`, коміт `c8c5d80`): знайдено 1, підтверджено 1 (та сама, що знахідка 3 аудитора для мержу).

Підтверджені — що зроблено:

1. Звіт і запис кроку стверджували «`mistral-audit` pass (11s, без зауважень)» ще до аудиту; 11-секундний прогін — коротка джоба на зміну опису PR, повний прогін на `c8c5d80` дав одну знахідку — твердження прибрано, цей розділ дав планувальник.
2. Тест пропускав прозорий текст кнопки виходу і рядка-пояснення (колір з альфою 0, `opacity: 0`, кегль 0), обрізаний текст кнопок і перекритий екран перемоги — тест посилено: не перекритий у центрі, непрозорість з предками, альфа тексту, кегль від 12 px, текст не обрізано; поломки 13–19 — з аудиту, усі червоні.
3. Термін «мутаційний аудит» замість «навмисні поломки» у звіті й записі кроку (і Mistral) — виправлено; `vibe-plan-check.mjs` цього слова не бачить (обмеження довжини слова, рядок 95 скрипта) — кандидат на доробку скрипта.
4. Немає рядка виконавця в `docs/agents/common.md`, розділ «Лише для Mistral Vibe Code» (план, розділ 5) — додано.
5. Два коміти лише з документами (`840f7af`, `e27e18f`) через 7 і 9 хв після відкриття PR, до аудиту, хоча план велить числа після PR писати в опис — скасували прогони `test` і `mistral-audit`; історію не переписуємо, записано тут.
6. Назва коміту `c8c5d80` не дослівно з плану («на стартовий екран» замість «на сторінці»; назва PR правильна) — історію не переписуємо, записано тут.
7. Запис кроку виходив за місця блоку `record` (дописки, «sandbox» замість «пісочниці», урок-перелік чисел, «PR у `main` (не мержиться)») — запис замінено блоком `record-v2`.
8. Звіт не дослівно з блоку («Розбіжностей немає: …»), одруківка «Час закроку», файл без кінцевого переносу рядка — звіт замінено блоком `report-v2`.
9. Опис PR, розділ «Перевірка», заповнено плутано — опис замінено блоком `pr-body-v2`.

Відхилені:

10. «`npm run lint` і `npm run format:check` нічого не кажуть про файл e2e» — це команди чекліста плану з їхнім результатом, а не твердження про тест; файл e2e у тому самому переліку перевіряють `npx prettier --check e2e/acceptance.scenario.ts` і `npx tsc --noEmit -p tsconfig.e2e.json`.
````

<!-- блок: record-v2 -->
```text
- [x] **Т.61 (рішення власника 17.11.2026, після Т.60): екран перемоги і рядок-пояснення на сторінці — перший крок Vibe за шаблоном Т.60.** Мета: кандидат 65 — малий крок тестів робить Mistral Vibe Code за планом із готовими блоками (`docs/plans/t61-victory-note-e2e.md`); зміст — кандидат 63, межі (є) і (ж) звіту Т.58: кнопку «На стартовий екран» на екрані перемоги і стилі рядка-пояснення `.start-note` не тримав жоден тест. Відповіді власника кнопками: «63: екран перемоги (Рекомендовано)»; «Лише тести, (а) пізніше (Рекомендовано)». `src/` і `index.html` не змінювались.
    - Зроблено: новий тест e2e «Т.61» у кінці `e2e/acceptance.scenario.ts` — окремий `test(...)`, сценарій приймання ADR-0030 без змін. Екран перемоги (правкою сейву): три кнопки видимі, цілком у межах вікна на 1366 × 768, 1024 × 768 і 390 × 844, не менші за 44 px, не накладаються; «На стартовий екран» веде на стартовий екран. Невдале «Продовжити»: рядок-пояснення з текстом дослівно, у межах вікна, над першою кнопкою меню (проміжок 0–12 px), завширшки як кнопки, колір помилки, непрозора підкладка. Після аудиту — для кожної кнопки і рядка: не перекриті в центрі, непрозорі з предками, непрозорий текст кеглем від 12 px, текст не обрізано.
    - Виконано: навмисні поломки — 19 (12 плану і 7 з аудиту), червоні всі, крім 8 (межа (б)); межі (а)–(д) — у звіті; `./scripts/pr-size.sh origin/main HEAD` — 122 рядки; диф виконавця до аудиту побайтно збігся з прототипом планувальника, крім місць `<…>`.
    - Урок: <одне речення виконавця про те, що справді сталося в цій сесії>
    - Аудит (PR #362, ADR-0097): Opus, субагент сесії-планувальника з копією репозиторію (коміт `e27e18f`) — знайдено 10, підтверджено 9 (≈ 9 хв, ≈ 157 тис. токенів); Mistral Large (джоба `mistral-audit`, коміт `c8c5d80`) — знайдено 1, підтверджено 1. Головне — твердження про аудит до аудиту і тест, що пропускав прозорий, перекритий і обрізаний текст; що зроблено з кожною знахідкою — розділ «Аудит» звіту.
    - Виконано (2026-11-17): клас `auto` (`e2e/**` і `docs/**`), мерж без «схвалюю» після зелених чеків і аудиту (ADR-0094). Тег `iter-T.61` — ставить workflow `iter-tag` на merge-коміт PR кроку.
    - Звіт — `docs/reports/t61-victory-note-e2e.md`
```

### Порція 3 — довідник, опис PR, пуш

1. `docs/agents/common.md`, розділ «Лише для Mistral Vibe Code», у кінець розділу — один-два рядки власного уроку з позначкою «Т.61» (свій текст, не блок; лише про те, що сталося в цій сесії). Коміт: `docs(agents): Т.61 — урок виконавця`.
2. Опис PR — блок `pr-body-v2`: скопіювати `/tmp/blocks2/pr-body-v2.txt` у `/tmp/pr-body-v2.md`, заповнити місця `<…>` (результат `npm run test:e2e` порції 1); `grep -n '<[^!]' /tmp/pr-body-v2.md` — порожньо; `gh pr edit 362 --body-file /tmp/pr-body-v2.md`. **Спершу опис, потім пуш.**
3. `git push` — один раз, після пунктів 1–2.
4. Відповісти в сесії: перелік «пункт — зроблено / ні» порцій 1–3 з доказом `grep`. Не мержити.

<!-- блок: pr-body-v2 -->
```text
### Що змінено і чому

Т.61 — перший крок Mistral Vibe Code за шаблоном плану Т.60 (кандидат 65); зміст — кандидат 63, межі (є) і (ж) звіту Т.58 (`docs/reports/t58-after-exit-to-start.md`): що кнопку «На стартовий екран» на екрані перемоги видно і що рядок-пояснення невдалого «Продовжити» має свої стилі, не тримав жоден тест — наскрізні тести на сторінці (jsdom) розкладки не мають. Новий тест e2e «Т.61» у `e2e/acceptance.scenario.ts` перевіряє це в браузері на трьох розмірах вікна; сценарій приймання ADR-0030 без змін. `src/` і `index.html` не змінювались. Звіт — `docs/reports/t61-victory-note-e2e.md`, запис кроку — `docs/workflow.md`.

### Критерії приймання

- Коли показано екран перемоги, тест e2e «Т.61» перевіряє на 1366 × 768, 1024 × 768 і 390 × 844, що кнопки «Грати далі», «Грати знов» і «На стартовий екран» видимі, цілком у межах вікна, не менші за 44 px, не накладаються, не перекриті в центрі, непрозорі, з непрозорим текстом кеглем від 12 px, текст не обрізано; «На стартовий екран» веде на стартовий екран.
- Коли «Продовжити» не вдалося, тест перевіряє на тих самих розмірах, що рядок-пояснення «Не вдалося завантажити збереження. Почніть нову гру.» видимий, цілком у межах вікна, над першою кнопкою меню (проміжок 0–12 px), завширшки як кнопки, не перекритий, непрозорий, текст не обрізано, кегль від 12 px, колір тексту — колір помилки, підкладка непрозора.
- З 19 навмисних поломок (12 плану, 7 з аудиту) тест ловить усі, крім 8 (межа (б) звіту).
- Наявні тести не послаблено; клас PR — `auto`.

### Відповідь власника (17.11.2026)

- Питання: «Т.61 — перший крок Mistral Vibe Code за новим шаблоном плану (Т.60). Який зміст кроку дати Vibe?» Відповідь: «63: екран перемоги (Рекомендовано)».
- Питання: «Кандидат 63 має три пункти: (є) кнопку «На стартовий екран» на екрані перемоги не тримає жоден тест на видимість; (ж) стилі рядка-пояснення .start-note не тримає жоден тест; (а) рядок-пояснення «Не вдалося завантажити збереження. Почніть нову гру.» на стартовому екрані накриває підпис під логотипом, поки показаний. Тести для (є) і (ж) — сценарій e2e, клас auto (мерж без «схвалюю»). Виправлення (а) — зміна вигляду (index.html), клас approve. Що робимо з (а) у Т.61?» Відповідь: «Лише тести, (а) пізніше (Рекомендовано)».

### Перевірка

- `npx tsc --noEmit` (три конфіги), `npm run lint`, `npm run format:check`, `npx prettier --check e2e/acceptance.scenario.ts`, `npm run docs` — ок; `npm test` — 1186 тестів зелені.
- `npm run test:e2e` — <результат після порції 1>.
- `./scripts/pr-size.sh origin/main HEAD` — 122 рядки (ліміт 500).
- Навмисні поломки — 19, червоні всі, крім 8.
- `node scripts/vibe-plan-check.mjs --plan docs/plans/t61-victory-note-e2e.md --pr 362` — 0 знахідок.

### Аудит

Аудит PR #362 (ADR-0097). Аудитор для мержу — Opus, субагент сесії-планувальника з копією репозиторію (коміт `e27e18f`): знайдено 10, підтверджено 9, відхилено 1; ≈ 9 хв, ≈ 157 тис. токенів. Mistral Large (джоба `mistral-audit`, коміт `c8c5d80`): знайдено 1, підтверджено 1 (та сама, що знахідка 3 аудитора для мержу).

Підтверджені — що зроблено:

1. Звіт і запис кроку стверджували «`mistral-audit` pass (11s, без зауважень)» ще до аудиту; 11-секундний прогін — коротка джоба на зміну опису PR, повний прогін на `c8c5d80` дав одну знахідку — твердження прибрано, цей розділ дав планувальник.
2. Тест пропускав прозорий текст кнопки виходу і рядка-пояснення (колір з альфою 0, `opacity: 0`, кегль 0), обрізаний текст кнопок і перекритий екран перемоги — тест посилено: не перекритий у центрі, непрозорість з предками, альфа тексту, кегль від 12 px, текст не обрізано; поломки 13–19 — з аудиту, усі червоні.
3. Термін «мутаційний аудит» замість «навмисні поломки» у звіті й записі кроку (і Mistral) — виправлено; `vibe-plan-check.mjs` цього слова не бачить (обмеження довжини слова, рядок 95 скрипта) — кандидат на доробку скрипта.
4. Немає рядка виконавця в `docs/agents/common.md`, розділ «Лише для Mistral Vibe Code» (план, розділ 5) — додано.
5. Два коміти лише з документами (`840f7af`, `e27e18f`) через 7 і 9 хв після відкриття PR, до аудиту, хоча план велить числа після PR писати в опис — скасували прогони `test` і `mistral-audit`; історію не переписуємо, записано тут.
6. Назва коміту `c8c5d80` не дослівно з плану («на стартовий екран» замість «на сторінці»; назва PR правильна) — історію не переписуємо, записано тут.
7. Запис кроку виходив за місця блоку `record` (дописки, «sandbox» замість «пісочниці», урок-перелік чисел, «PR у `main` (не мержиться)») — запис замінено блоком `record-v2`.
8. Звіт не дослівно з блоку («Розбіжностей немає: …»), одруківка «Час закроку», файл без кінцевого переносу рядка — звіт замінено блоком `report-v2`.
9. Опис PR, розділ «Перевірка», заповнено плутано — опис замінено блоком `pr-body-v2`.

Відхилені:

10. «`npm run lint` і `npm run format:check` нічого не кажуть про файл e2e» — це команди чекліста плану з їхнім результатом, а не твердження про тест; файл e2e у тому самому переліку перевіряють `npx prettier --check e2e/acceptance.scenario.ts` і `npx tsc --noEmit -p tsconfig.e2e.json`.

Згадка: Т.58, PR #358; Т.60, PR #361; план — `docs/plans/t61-victory-note-e2e.md`.

Iter-Tag: iter-T.61
```
