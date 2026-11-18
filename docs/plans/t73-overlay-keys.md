# Т.73 — вікна поверх бою: клавіші й плитки, фокус і Esc: план для Vibe Code

**Хто що робить (рішення власника 18.11.2026 для Т.72, продовжено на Т.73: код пише Vibe сам за описом поведінки і готовими тестами).** План, тести і прототип для звірки підготувала сесія Claude (Opus 5.5). **Код у цьому кроці пише агент Mistral Vibe Code сам** — за описом поведінки нижче: латки коду в плані немає. Тести приходять готовою латкою: вони суддя коду. Поломки, чекліст, звіт, запис кроку і PR теж робить Vibe Code; знахідки аудиту він виправляє в тій самій сесії. PR класу `approve` (зміна `src/`): мерж — **лише після «схвалюю» власника**, мержить планувальник. Виконавець **не мержить**.

**Джерело:** кандидат 77 (межа (г) звіту Т.71, `docs/reports/t71-evac-button.md`): під вікнами «Меню», «Як грати», «Незбережені зміни» клавіші бою і плитки тулбара досі діють, фокус лишається під вікном. Правила гри не міняються: ядро (`src/core/`) у кроці не чіпається.

**Перед роботою прочитати:** `AGENTS.md`, `docs/agents/common.md`, `docs/agents/ui.md` (розділи «Лише для хмарної сесії Claude» пропустити; розділ «Лише для Mistral Vibe Code» у `docs/agents/common.md` — прочитати). Записи Т.53 і Т.71: `grep -n 'Т.53\|Т.71' docs/workflow.md | cut -c1-200`. Зразок того, що вже є: вікно «Евакуювати останнього?» (Т.71) — `confirmLastEvac` у `src/main.ts`, перевірка `evacConfirmOpen` в `onKeyDown` (`src/ui/input.ts`) і в обробнику плиток `createToolbar(…, { onAction })` (`src/main.ts`); список вікон `OVERLAY_IDS` і обробник пробілу (Т.43) — `src/main.ts`.

**Готові блоки.** Нові рядки тестів і документів цього плану — блоки з позначкою `<!-- блок: ім'я -->`. Руками їх не набирати: спершу `node scripts/vibe-plan-blocks.mjs docs/plans/t73-overlay-keys.md /tmp/blocks`, далі брати вміст із `/tmp/blocks/<ім'я>.txt`. Тести — латкою (`git apply`), документи — скриптом `scripts/vibe-step.py`. Код — сам, за розділом 1. Текст поза блоками — вказівки: у код, документи й опис PR його не переносити.

Тести перевірено на `main` = `8e3bda0` (Т.72) на прототипі планувальника: без коду три нові тести червоні, решта зелені; з кодом — усі зелені, `npm test` — 47 файлів, 1207 тестів; сценарій e2e (3 сценарії) з кодом прототипу пройшов.

## Терміни гри (писати саме так)

Вивід інструментів у середовищі виконавця екранує кирилицю, тому слова легко переплутати. Файли з кирилицею читати через `python3`. У коді, тестах і документах:

- **вікно** — оверлей поверх гри з `OVERLAY_IDS` у `src/main.ts` (секції `#game-menu`, `#settings-dialog`, `#help-screen`, `#exit-confirm`, `#evac-confirm`, `#new-game-dialog`, `#campaign-victory`); **відкрите** — без класу `hidden`;
- назви вікон — як у заголовках: **«Меню»**, **«Налаштування»**, **«Як грати»**, **«Незбережені зміни»**, **«Евакуювати останнього?»**;
- **безпечна кнопка** вікна — та, що лише закриває його: «Закрити» (`btn-menu-close`, `settings-close`), «Грати» (`btn-help-close`), «Скасувати» (`btn-exit-no`, `btn-evac-no`, `btn-new-game-cancel`);
- **топбар** — верхня смуга з кнопками «Меню» (`btn-menu`) і «?» (`btn-help`); **плитка** — кнопка бойового тулбара (`#btoolbar`); **оперативник** — юніт гравця в бою;
- **немає** (не «не має»): слова «немає» і «нічого» в документи ставить скрипт `vibe-step.py docs` — руками їх у місця не вписувати;
- **наскрізний тест на сторінці** — тест vitest у `src/main.ui.test.ts`, що клікає сторінку в jsdom; це не сценарій e2e (`npm run test:e2e`, Playwright, тека `e2e/`).

## Відповідь власника (19.11.2026, до реалізації)

Вибір кроку (18.11.2026, після мержу Т.72; дослівного тексту питання в документі стану немає): кандидат 77 — клавіші бою і плитки діють під вікнами «Меню», «Як грати», «Незбережені зміни»; код пише Vibe за описом.

Питання: «Т.73 (вікна поверх бою). Які вікна блокують клавіші й плитки бою?». Відповідь: **«Усі вікна (Recommended)»**. Опис цього варіанта, який бачив власник: Меню, Налаштування, Як грати, Незбережені зміни — та сама перевірка, що вже діє для пробілу (усі вікна поверх гри).

Питання: «Куди переходить фокус, коли вікно відкривається над боєм?». Відповідь: **«На безпечну кнопку (Recommended)»**. Опис цього варіанта, який бачив власник: Меню — «Закрити», Як грати — «Грати», Незбережені зміни — «Скасувати», Налаштування — кнопка закриття (як «Скасувати» у вікні евакуації).

Питання: «Що робить Esc, коли відкрите вікно?». Відповідь: **«Закриває вікно (Recommended)»**. Опис цього варіанта, який бачив власник: Як «Закрити»/«Скасувати»/«Грати»; виділення бійця під вікном не скидається.

Питання: «Куди повертається фокус після закриття вікна?». Відповідь: **«На кнопку, що відкрила (Recommended)»**. Опис цього варіанта, який бачив власник: «Меню» або «?» у топбарі; пробіл однаково лишається «До події».

Що Esc закриває й вікно «Евакуювати останнього?» і діалог нової партії, а екран перемоги кампанії — ні, і що вікна, відкриті з «Меню», повертають фокус на «Меню», — рішення планувальника; власник побачить це на прев'ю перед «схвалюю».

У звіті, записі кроку й описі PR рішення власника цитувати **лише з цього розділу, дослівно** (їх уже містять блоки `report` і `pr-body`). Іншого власник не казав: нових цитат не складати, слова не переставляти.

## Що зробити

### 1. Код — пише виконавець сам: `src/main.ts`, `src/ui/input.ts`, `src/ui/screens.ts`, `src/ui/settings.ts`, `src/ui/help.ts`

Що є зараз (перевірено по коду на `main` = `8e3bda0`): вікна поверх гри перелічено в `OVERLAY_IDS` (`src/main.ts`); пробіл (Т.43) нічого не робить, поки відкрите хоч одне з них. А клавіші бою (`onKeyDown` у `src/ui/input.ts`) і плитки тулбара (`onAction` у `createToolbar(…)`, `src/main.ts`) зважають лише на вікно «Евакуювати останнього?» (залежність `evacConfirmOpen`). Фокус переводить у вікно лише «Евакуювати останнього?» (`btn-evac-no`); інші вікна фокус не беруть і на Esc не реагують.

Що має бути після коду (поведінка; як саме написати — вирішує виконавець, суддя — тести з розділу 2):

**(а) `src/main.ts` — одна перевірка «відкрите вікно».** Функція `overlayOpen(): boolean` — `true`, коли відкрите хоч одне вікно з `OVERLAY_IDS` (той самий вираз, що вже стоїть в обробнику пробілу).

**(б) Клавіші бою під вікном не діють.** У `InputDeps` (`src/ui/input.ts`) залежність `evacConfirmOpen` перейменувати на `overlayOpen` (значення — «відкрите будь-яке вікно»); `onKeyDown` на початку, як і зараз, нічого не робить, якщо вона повертає `true`. У `createInput(…)` у `src/main.ts` передати `overlayOpen` з пункту (а). У `src/ui/input.test.ts` ім'я залежності міняє латка тестів (розділ 2).

**(в) Плитки тулбара під вікном не діють.** В обробнику плиток (`onAction`, `src/main.ts`) перевірку `evac-confirm` замінити на `overlayOpen()`.

**(г) Фокус — на безпечну кнопку вікна, коли воно відкривається:**
- «Меню» (`openMenu` у `src/ui/screens.ts`) — на `btn-menu-close`;
- «Незбережені зміни» (`requestExit` у `src/ui/screens.ts`, коли показує вікно) — на `btn-exit-no`;
- «Налаштування» (`open` у `src/ui/settings.ts`) — на `settings-close`;
- «Як грати» (`open` у `src/ui/help.ts`) — на `btn-help-close`;
- «Евакуювати останнього?» — як є (`btn-evac-no`).

**(ґ) Esc закриває відкрите вікно — тією ж дією, що його безпечна кнопка** (натиснути її: `.click()`):

| Вікно | Кнопка |
| --- | --- |
| `evac-confirm` | `btn-evac-no` |
| `exit-confirm` | `btn-exit-no` |
| `settings-dialog` | `settings-close` |
| `help-screen` | `btn-help-close` |
| `game-menu` | `btn-menu-close` |
| `new-game-dialog` | `btn-new-game-cancel` |

Екран перемоги кампанії (`campaign-victory`) Esc не закриває. Якщо відкрито два вікна — закривається перше за порядком таблиці. Обробник Esc — окремий слухач `keydown` на `document` у `src/main.ts`, **доданий після** `document.addEventListener('keydown', input.onKeyDown)`: тоді `onKeyDown` бачить вікно ще відкритим і Esc не скасовує вибір чи зведений режим під вікном (так вимагає тест «Esc і повернення фокусу»).

**(д) Після закриття вікна фокус — на кнопку топбару, що відкрила вікно.** Клік «Меню» (`btn-menu`) і клік «?» (`btn-help`) запам'ятовують свою кнопку (в їхніх `onclick` у `src/main.ts`). Після кліку по `btn-menu-close`, `btn-exit-no`, `settings-close`, `btn-help-close` (Esc натискає ці самі кнопки): якщо відкритих вікон уже немає, показано екран гри (`screens.current() === 'гра'`) і кнопку запам'ятовано — фокус на неї. Тож «Налаштування», «Як грати» і «Незбережені зміни», відкриті з «Меню», повертають фокус на «Меню», а «Як грати», відкрите «?», — на «?». Слухачі цих кнопок — `addEventListener('click', …)` у `src/main.ts`, після створення модулів (`onclick` модулів спрацьовує раніше — модуль закриває вікно, потім перевірка). Після «Вийти без збереження» показано стартовий екран — фокус не повертається.

Коментарі до нових рядків — українською, з позначкою `Т.73`, як у сусідніх рядках (`// Т.71: …`). Формат — `npx prettier --write` на змінених файлах (хук pre-commit теж форматує).

Порядок: написати код у п'яти файлах → **не комітити окремо**, а одразу наклати латку тестів (розділ 2) і закомітити код і тести **одним комітом**: латка міняє наявні тести (`src/ui/input.test.ts`, хелпери `src/main.ui.test.ts`), а хук pre-commit жене повний `npm test` — код без латки не комітиться (урок запису Т.72).

Інших файлів коду немає. Якщо для коду здається потрібним змінити ще якийсь файл — не міняти, а написати в сесії, який і чому.

<!-- блок: commit-code -->
```text
feat(ui): Т.73 — вікна поверх бою: клавіші й плитки не діють, фокус у вікні, Esc закриває
```

### 2. Тести — готовою латкою: `src/main.ui.test.ts`, `src/ui/input.test.ts`

Латка `test-patch`:

- у `src/ui/input.test.ts` — ім'я залежності `evacConfirmOpen` → `overlayOpen` (два місця, значення те саме);
- у `src/main.ui.test.ts` — хелпер `startParty` спершу закриває вікно «Як грати» першого візиту (воно відкрите від завантаження сторінки, і з Т.73 під ним бій не відповідає — як і для гравця, який спершу натискає «Грати»);
- у `src/main.ui.test.ts` — фейк-таймери сторінкових тестів вмикаються з `PAGE_FAKE_TIMERS` (без підробки `setImmediate`): jsdom ставить `focus()` у чергу через `setImmediate`, і перевірки «таймерів 0» Т.48, Т.53, Т.55 рахували б фокус у вікні як таймер гри. Самі перевірки не змінено;
- у кінці `src/main.ui.test.ts` — новий блок із трьох тестів (він же блок `test-t73` нижче; скрипт поломок шукає його у файлі дослівно).

Нові тести перевіряють:

1. сід 42, пресет «норма», бій місії, вибрано оперативника: під «Меню», «Налаштування», «Як грати» (і з меню, і кнопкою «?») і «Незбережені зміни» клавіші E, 1, O, G, V і плитки «Швидкий», «Евакуація», «Кінець» не міняють ні номера ходу, ні рядка `#binfo`; фокус — на безпечній кнопці вікна; без вікна E знову закінчує хід;
2. зведений «Швидкий»: Esc закриває «Меню», «Налаштування», «Як грати», «Незбережені зміни» (бій на місці), режим під вікном не скасовано; фокус після Esc, «Грати» чи «Закрити» — на «Меню» чи «?», що відкрили вікно; Esc без вікна скасовує режим («Режим пострілу скасовано.»);
3. Esc закриває «Евакуювати останнього?» (бій не закінчено) і діалог нової партії на стартовому екрані.

Застосувати латку з кореня репозиторію **після коду розділу 1** і закомітити все одним комітом назвою з блоку `commit-code`:

```
{ cat /tmp/blocks/test-patch.txt; echo; } | git apply
git add src/main.ts src/ui/input.ts src/ui/screens.ts src/ui/settings.ts src/ui/help.ts src/main.ui.test.ts src/ui/input.test.ts && git commit -F /tmp/blocks/commit-code.txt
```

(вирізач пише блок без кінцевого переносу рядка — `echo` його повертає, без нього `git apply` каже «corrupt patch»). Якщо `git apply` відмовляє — нічого не правити руками, а написати в сесії вивід команди. Після коміту `git diff HEAD~1 --stat -- src/main.ui.test.ts src/ui/input.test.ts` — два файли, 156 доданих рядків і 10 вилучених.

Перед комітом — `npx tsc --noEmit` і `npm test`. **Тести — суддя коду:** якщо тест червоний — виправляти **код** розділу 1 (і написати в сесії, що саме було не так), а не тест. Тести не правити, не послаблювати, жодного `it.skip`, `it.only`. Якщо тест здається хибним — написати в сесії, який і чому, і чекати.

<!-- блок: test-patch -->
```diff
diff --git a/src/main.ui.test.ts b/src/main.ui.test.ts
index b80bc42..e2e3452 100644
--- a/src/main.ui.test.ts
+++ b/src/main.ui.test.ts
@@ -36,4 +36,7 @@ const btn = (id: string): HTMLButtonElement => $(id) as HTMLButtonElement;
 // (btn-auto-battle disabled у renderBattle після finishBattle).
 // Флоу «Авто → Стоп → ручна дія → Авто» — критерій 1 П13.3.
+// Т.73: jsdom ставить focus() у чергу через setImmediate — його не підробляємо, щоб лічильник таймерів
+// (vi.getTimerCount) рахував лише таймери гри (авто-бій, підсумок ходу), а не фокус у вікнах поверх бою.
+const PAGE_FAKE_TIMERS = { toNotFake: ['setImmediate', 'clearImmediate'] } as Parameters<typeof vi.useFakeTimers>[0];
 const AUTO_STEP_MS = 200;
 async function runAutoSteps(): Promise<void> {
@@ -43,5 +46,5 @@ async function runAutoSteps(): Promise<void> {
 }
 async function runAutoBattle(): Promise<void> {
-  vi.useFakeTimers();
+  vi.useFakeTimers(PAGE_FAKE_TIMERS);
   try {
     btn('btn-auto-battle').click();
@@ -63,5 +66,8 @@ function passDay(): void {
 }
 
+// Т.73: під вікном «Як грати» першого візиту бій не відповідає на плитки й клавіші — гравець спершу закриває
+// його «Грати» (мишею кнопку «Нова партія» під вікном не натиснути); так само й тут.
 function startParty(seed = '42', preset = 'норма'): void {
+  if (!$('help-screen').classList.contains('hidden')) btn('btn-help-close').click();
   btn('btn-start-new').click();
   ($('new-game-seed') as HTMLInputElement).value = seed;
@@ -406,5 +412,5 @@ describe('UI-флоу прев’ю: геосцена → місія → бій
       cv.dispatchEvent(new MouseEvent('click', { clientX: x * 48 + 24, clientY: y * 48 + 24 }));
     };
-    vi.useFakeTimers();
+    vi.useFakeTimers(PAGE_FAKE_TIMERS);
     try {
       // Авто: політика ядра веде загін — покроково (перша дія одразу), не миттєво
@@ -775,5 +781,5 @@ describe('панель збереження: 3 слоти, лише на гео
   it('Т.48: авто-бій, запущений до виходу, за стартовим екраном не йде далі', async () => {
     const money = saveTickAndLaunch();
-    vi.useFakeTimers();
+    vi.useFakeTimers(PAGE_FAKE_TIMERS);
     try {
       btn('btn-auto-battle').click();
@@ -1024,5 +1030,5 @@ describe('П6.14: UX прицілювання — обведення цілей,
   it('Т.46: зведений постріл і «Авто» — плитка пострілу не зведена ні в авто-бої, ні після «Стоп»; вибір лишається', () => {
     const armed = (id: string): boolean => btn(id).classList.contains('armed');
-    vi.useFakeTimers();
+    vi.useFakeTimers(PAGE_FAKE_TIMERS);
     try {
       btn('btn-snap').click(); // AP 3 — швидкий постріл зводиться
@@ -1649,5 +1655,5 @@ describe('Т.53: меню і «Як грати» зупиняють авто-б
     expect($('battle-panel').classList.contains('hidden')).toBe(false);
     // 2. фейк-таймери — як у блоці Т.48
-    vi.useFakeTimers();
+    vi.useFakeTimers(PAGE_FAKE_TIMERS);
     try {
       // 3. авто-бій справді запущений
@@ -1721,5 +1727,5 @@ describe('Т.55: тести після Т.53 — меню без авто-бою
     // 1. бій з попереднього тесту триває; фейк-таймери — як у блоці Т.53
     expect($('battle-panel').classList.contains('hidden')).toBe(false);
-    vi.useFakeTimers();
+    vi.useFakeTimers(PAGE_FAKE_TIMERS);
     try {
       // 2. авто-бій запущений
@@ -1867,5 +1873,5 @@ describe('Т.64: зупинка авто-бою в battle.close на сторі
 
   it('Т.64: вихід на стартовий екран без кліку «Меню» — авто-бій зупиняє battle.close', async () => {
-    vi.useFakeTimers();
+    vi.useFakeTimers(PAGE_FAKE_TIMERS);
     try {
       await launchAuto();
@@ -1886,5 +1892,5 @@ describe('Т.64: зупинка авто-бою в battle.close на сторі
 
   it('Т.64: нова партія під час авто-бою — авто-бій зупиняє battle.close', async () => {
-    vi.useFakeTimers();
+    vi.useFakeTimers(PAGE_FAKE_TIMERS);
     try {
       await launchAuto();
@@ -2078,2 +2084,142 @@ describe('Т.72: підказка «Можна евакуюватись» на 
   });
 });
+
+// Т.73 (кандидат 77, рішення власника 19.11.2026): вікна поверх бою — «Меню», «Налаштування», «Як грати»,
+// «Незбережені зміни». Під вікном клавіші й плитки бою не діють; фокус — на безпечній кнопці вікна;
+// Esc закриває вікно; після закриття фокус — на кнопці топбару, що відкрила вікно.
+describe('Т.73: вікна поверх бою — клавіші, плитки, фокус і Esc', () => {
+  const press = (code: string, key: string): void => {
+    document.dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true }));
+  };
+  const tap = (x: number, y: number): void => {
+    $('battle').dispatchEvent(new MouseEvent('click', { clientX: x * 48 + 24, clientY: y * 48 + 24 }));
+  };
+  const open = (id: string): boolean => !$(id).classList.contains('hidden');
+  const focused = (): string => document.activeElement?.id ?? '';
+  const startBattle = (): void => {
+    startParty('42');
+    for (let i = 0; i < 1500 && document.querySelector('button.mission') === null; i++) btn('btn-tick').click();
+    (document.querySelector('button.mission') as HTMLButtonElement).click();
+    expect($('battle-panel').classList.contains('hidden')).toBe(false);
+    tap(2, 2); // оперативник на синій клітинці висадки (як у тесті Т.71)
+  };
+  // Під відкритим вікном: клавіші бою і плитки тулбара не міняють ні хід, ні рядок #binfo.
+  const battleFrozen = (): void => {
+    const turn = $('bctx-turn').textContent;
+    const info = $('binfo').textContent;
+    press('KeyE', 'e');
+    press('Digit1', '1');
+    press('KeyO', 'o');
+    press('KeyG', 'g');
+    press('KeyV', 'v');
+    btn('btn-snap').click();
+    btn('btn-evac').click();
+    btn('btn-end').click();
+    expect($('bctx-turn').textContent).toBe(turn);
+    expect($('binfo').textContent).toBe(info);
+  };
+
+  it('Т.73: під «Меню», «Налаштування», «Як грати» і «Незбережені зміни» клавіші й плитки бою не діють; фокус — на безпечній кнопці вікна', () => {
+    startBattle();
+    // 1. «Меню»: фокус на «Закрити»
+    btn('btn-menu').click();
+    expect(open('game-menu')).toBe(true);
+    expect(focused()).toBe('btn-menu-close');
+    battleFrozen();
+    // 2. «Налаштування» з меню: фокус на «Закрити» вікна
+    btn('btn-menu-settings').click();
+    expect(open('settings-dialog')).toBe(true);
+    expect(focused()).toBe('settings-close');
+    battleFrozen();
+    btn('settings-close').click();
+    // 3. «Як грати» з меню: фокус на «Грати»
+    btn('btn-menu').click();
+    btn('btn-menu-help').click();
+    expect(open('help-screen')).toBe(true);
+    expect(focused()).toBe('btn-help-close');
+    battleFrozen();
+    btn('btn-help-close').click();
+    // 4. «Як грати» кнопкою «?» у топбарі: так само
+    btn('btn-help').click();
+    expect(focused()).toBe('btn-help-close');
+    battleFrozen();
+    btn('btn-help-close').click();
+    // 5. «Незбережені зміни»: фокус на «Скасувати»
+    btn('btn-menu').click();
+    btn('btn-menu-exit').click();
+    expect(open('exit-confirm')).toBe(true);
+    expect(focused()).toBe('btn-exit-no');
+    battleFrozen();
+    btn('btn-exit-no').click();
+    // 6. без вікна клавіша бою знову діє: E — кінець ходу
+    const turn = $('bctx-turn').textContent;
+    press('KeyE', 'e');
+    expect($('bctx-turn').textContent).not.toBe(turn);
+  });
+
+  it('Т.73: Esc закриває вікно і не скидає зведений режим під ним; фокус повертається на кнопку топбару, що відкрила вікно', () => {
+    startBattle();
+    press('Digit1', '1'); // зведений «Швидкий» у вибраного оперативника
+    const info = $('binfo').textContent;
+    // 1. «Меню» → Esc: вікно закрите, режим під ним не скасовано, фокус — на «Меню»
+    btn('btn-menu').click();
+    press('Escape', 'Escape');
+    expect(open('game-menu')).toBe(false);
+    expect($('binfo').textContent).toBe(info);
+    expect(focused()).toBe('btn-menu');
+    // 2. «Меню» → «Налаштування» → Esc: фокус — на «Меню»
+    btn('btn-menu').click();
+    btn('btn-menu-settings').click();
+    press('Escape', 'Escape');
+    expect(open('settings-dialog')).toBe(false);
+    expect(open('game-menu')).toBe(false);
+    expect(focused()).toBe('btn-menu');
+    // 3. «?» → Esc: фокус — на «?»
+    btn('btn-help').click();
+    press('Escape', 'Escape');
+    expect(open('help-screen')).toBe(false);
+    expect(focused()).toBe('btn-help');
+    // 4. «Меню» → «Як грати» → «Грати»: фокус — на «Меню»
+    btn('btn-menu').click();
+    btn('btn-menu-help').click();
+    btn('btn-help-close').click();
+    expect(focused()).toBe('btn-menu');
+    // 5. «Незбережені зміни» → Esc: вікно закрите, бій на місці, фокус — на «Меню»
+    btn('btn-menu').click();
+    btn('btn-menu-exit').click();
+    press('Escape', 'Escape');
+    expect(open('exit-confirm')).toBe(false);
+    expect($('battle-panel').classList.contains('hidden')).toBe(false);
+    expect(focused()).toBe('btn-menu');
+    // 6. «Меню» → «Закрити»: фокус — на «Меню»
+    btn('btn-menu').click();
+    btn('btn-menu-close').click();
+    expect(focused()).toBe('btn-menu');
+    // 7. режим досі зведений: Esc без вікна його скасовує
+    expect($('binfo').textContent).toBe(info);
+    press('Escape', 'Escape');
+    expect($('binfo').textContent).toBe('Режим пострілу скасовано.');
+  });
+  it('Т.73: Esc закриває й вікно «Евакуювати останнього?» (оперативник лишається) і діалог нової партії на стартовому екрані', () => {
+    startBattle(); // вибрано оперативника на (2, 2)
+    press('KeyV', 'v');
+    tap(3, 2);
+    press('KeyV', 'v');
+    tap(2, 3);
+    press('KeyV', 'v');
+    expect(open('evac-confirm')).toBe(true);
+    press('Escape', 'Escape');
+    expect(open('evac-confirm')).toBe(false);
+    expect($('bresult').textContent).toBe('');
+    // стартовий екран: «Нова партія» → Esc — діалог закрито, партію не створено
+    btn('btn-menu').click();
+    btn('btn-menu-exit').click();
+    btn('btn-exit-yes').click();
+    expect(open('start-screen')).toBe(true);
+    btn('btn-start-new').click();
+    expect(open('new-game-dialog')).toBe(true);
+    press('Escape', 'Escape');
+    expect(open('new-game-dialog')).toBe(false);
+    expect(open('start-screen')).toBe(true);
+  });
+});
diff --git a/src/ui/input.test.ts b/src/ui/input.test.ts
index 7a802ce..15911bc 100644
--- a/src/ui/input.test.ts
+++ b/src/ui/input.test.ts
@@ -112,5 +112,5 @@ function makeFixture(autoBusy = false, queue: Anim[] = []): Fixture {
   const busy = vi.fn(() => autoBusy);
   const confirmLastEvac = vi.fn(); // Т.71: вікно підтвердження — у тестах лише виклик
-  const input = createInput(ui, battle, { renderAll: vi.fn(), autoBusy: busy, confirmLastEvac, evacConfirmOpen: () => false });
+  const input = createInput(ui, battle, { renderAll: vi.fn(), autoBusy: busy, confirmLastEvac, overlayOpen: () => false });
   return {
     party,
@@ -118,5 +118,5 @@ function makeFixture(autoBusy = false, queue: Anim[] = []): Fixture {
     battle,
     input,
-    deps: { renderAll: vi.fn(), autoBusy: busy, confirmLastEvac, evacConfirmOpen: () => false },
+    deps: { renderAll: vi.fn(), autoBusy: busy, confirmLastEvac, overlayOpen: () => false },
     binfo: () => document.getElementById('binfo')!.textContent ?? '',
   };
```

<!-- блок: test-t73 -->
```ts
describe('Т.73: вікна поверх бою — клавіші, плитки, фокус і Esc', () => {
  const press = (code: string, key: string): void => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true }));
  };
  const tap = (x: number, y: number): void => {
    $('battle').dispatchEvent(new MouseEvent('click', { clientX: x * 48 + 24, clientY: y * 48 + 24 }));
  };
  const open = (id: string): boolean => !$(id).classList.contains('hidden');
  const focused = (): string => document.activeElement?.id ?? '';
  const startBattle = (): void => {
    startParty('42');
    for (let i = 0; i < 1500 && document.querySelector('button.mission') === null; i++) btn('btn-tick').click();
    (document.querySelector('button.mission') as HTMLButtonElement).click();
    expect($('battle-panel').classList.contains('hidden')).toBe(false);
    tap(2, 2); // оперативник на синій клітинці висадки (як у тесті Т.71)
  };
  // Під відкритим вікном: клавіші бою і плитки тулбара не міняють ні хід, ні рядок #binfo.
  const battleFrozen = (): void => {
    const turn = $('bctx-turn').textContent;
    const info = $('binfo').textContent;
    press('KeyE', 'e');
    press('Digit1', '1');
    press('KeyO', 'o');
    press('KeyG', 'g');
    press('KeyV', 'v');
    btn('btn-snap').click();
    btn('btn-evac').click();
    btn('btn-end').click();
    expect($('bctx-turn').textContent).toBe(turn);
    expect($('binfo').textContent).toBe(info);
  };

  it('Т.73: під «Меню», «Налаштування», «Як грати» і «Незбережені зміни» клавіші й плитки бою не діють; фокус — на безпечній кнопці вікна', () => {
    startBattle();
    // 1. «Меню»: фокус на «Закрити»
    btn('btn-menu').click();
    expect(open('game-menu')).toBe(true);
    expect(focused()).toBe('btn-menu-close');
    battleFrozen();
    // 2. «Налаштування» з меню: фокус на «Закрити» вікна
    btn('btn-menu-settings').click();
    expect(open('settings-dialog')).toBe(true);
    expect(focused()).toBe('settings-close');
    battleFrozen();
    btn('settings-close').click();
    // 3. «Як грати» з меню: фокус на «Грати»
    btn('btn-menu').click();
    btn('btn-menu-help').click();
    expect(open('help-screen')).toBe(true);
    expect(focused()).toBe('btn-help-close');
    battleFrozen();
    btn('btn-help-close').click();
    // 4. «Як грати» кнопкою «?» у топбарі: так само
    btn('btn-help').click();
    expect(focused()).toBe('btn-help-close');
    battleFrozen();
    btn('btn-help-close').click();
    // 5. «Незбережені зміни»: фокус на «Скасувати»
    btn('btn-menu').click();
    btn('btn-menu-exit').click();
    expect(open('exit-confirm')).toBe(true);
    expect(focused()).toBe('btn-exit-no');
    battleFrozen();
    btn('btn-exit-no').click();
    // 6. без вікна клавіша бою знову діє: E — кінець ходу
    const turn = $('bctx-turn').textContent;
    press('KeyE', 'e');
    expect($('bctx-turn').textContent).not.toBe(turn);
  });

  it('Т.73: Esc закриває вікно і не скидає зведений режим під ним; фокус повертається на кнопку топбару, що відкрила вікно', () => {
    startBattle();
    press('Digit1', '1'); // зведений «Швидкий» у вибраного оперативника
    const info = $('binfo').textContent;
    // 1. «Меню» → Esc: вікно закрите, режим під ним не скасовано, фокус — на «Меню»
    btn('btn-menu').click();
    press('Escape', 'Escape');
    expect(open('game-menu')).toBe(false);
    expect($('binfo').textContent).toBe(info);
    expect(focused()).toBe('btn-menu');
    // 2. «Меню» → «Налаштування» → Esc: фокус — на «Меню»
    btn('btn-menu').click();
    btn('btn-menu-settings').click();
    press('Escape', 'Escape');
    expect(open('settings-dialog')).toBe(false);
    expect(open('game-menu')).toBe(false);
    expect(focused()).toBe('btn-menu');
    // 3. «?» → Esc: фокус — на «?»
    btn('btn-help').click();
    press('Escape', 'Escape');
    expect(open('help-screen')).toBe(false);
    expect(focused()).toBe('btn-help');
    // 4. «Меню» → «Як грати» → «Грати»: фокус — на «Меню»
    btn('btn-menu').click();
    btn('btn-menu-help').click();
    btn('btn-help-close').click();
    expect(focused()).toBe('btn-menu');
    // 5. «Незбережені зміни» → Esc: вікно закрите, бій на місці, фокус — на «Меню»
    btn('btn-menu').click();
    btn('btn-menu-exit').click();
    press('Escape', 'Escape');
    expect(open('exit-confirm')).toBe(false);
    expect($('battle-panel').classList.contains('hidden')).toBe(false);
    expect(focused()).toBe('btn-menu');
    // 6. «Меню» → «Закрити»: фокус — на «Меню»
    btn('btn-menu').click();
    btn('btn-menu-close').click();
    expect(focused()).toBe('btn-menu');
    // 7. режим досі зведений: Esc без вікна його скасовує
    expect($('binfo').textContent).toBe(info);
    press('Escape', 'Escape');
    expect($('binfo').textContent).toBe('Режим пострілу скасовано.');
  });
  it('Т.73: Esc закриває й вікно «Евакуювати останнього?» (оперативник лишається) і діалог нової партії на стартовому екрані', () => {
    startBattle(); // вибрано оперативника на (2, 2)
    press('KeyV', 'v');
    tap(3, 2);
    press('KeyV', 'v');
    tap(2, 3);
    press('KeyV', 'v');
    expect(open('evac-confirm')).toBe(true);
    press('Escape', 'Escape');
    expect(open('evac-confirm')).toBe(false);
    expect($('bresult').textContent).toBe('');
    // стартовий екран: «Нова партія» → Esc — діалог закрито, партію не створено
    btn('btn-menu').click();
    btn('btn-menu-exit').click();
    btn('btn-exit-yes').click();
    expect(open('start-screen')).toBe(true);
    btn('btn-start-new').click();
    expect(open('new-game-dialog')).toBe(true);
    press('Escape', 'Escape');
    expect(open('new-game-dialog')).toBe(false);
    expect(open('start-screen')).toBe(true);
  });
});
```

### 3. Навмисні поломки (до PR, результати — у звіт)

Код і тести спершу закомітити. Поломки робить скрипт `python3 scripts/vibe-step.py mutations` з кореня репозиторію за блоком `step` нижче: по одній поломці, кожен із трьох нових тестів — окремим прогоном, `src/ui/input.test.ts` — цілком (стовпців для нього немає: нових тестів у ньому немає); файл після кожної поломки повертає; таблиця — у `/tmp/t73/table.md`, підсумок — у `/tmp/t73/summary.md`.

**Код ваш, тому якорі поломок заповнюєте ви.** У блоці `step` у кожній поломці третій елемент — `'ЯКІР'`, четвертий — `'ПОЛОМКА'`. Перед запуском скрипта:

1. скопіювати `/tmp/blocks/step.txt` у `/tmp/t73/step-filled.txt` і в ньому для кожної поломки замінити `'ЯКІР'` на рядок (чи шматок рядка) **вашого** коду з названого файла дослівно — він має бути в файлі **рівно один раз** — а `'ПОЛОМКА'` — на той самий шматок, зіпсований **рівно так, як написано в описі поломки** (більше нічого в ньому не міняти; «прибрати рядок» — замінити його на порожній рядок `''` чи `void 0;` з тим самим відступом);
2. перевірити: `python3 -c "import ast; s=ast.literal_eval(open('/tmp/t73/step-filled.txt').read()); [print(m[0][:40], open(m[1]).read().count(m[2]), m[2] != m[3]) for m in s['mutations']]"` — у кожному рядку `1 True`;
3. `cp /tmp/t73/step-filled.txt /tmp/blocks/step.txt` і `python3 scripts/vibe-step.py mutations` (≈ 10 хв: 14 поломок × 3 прогони);
4. заповнений блок іде в PR файлом `docs/reports/t73-step.txt` (`cp /tmp/t73/step-filled.txt docs/reports/t73-step.txt`) — разом із документами, розділ 4: аудитор звірить, що кожна поломка робить описане.

Якщо для якоїсь поломки у вашому коді немає такого місця (наприклад, перевірку написано інакше) — вибрати найближче місце, що ламає **ту саму поведінку**, і назвати його в сесії. Опис поломки (перший елемент) не міняти: за ним скрипт `docs` звіряє таблицю з таблицею плану.

<!-- блок: table-plan -->
```text
| № | Поломка | Т.73 клавіші, плитки і фокус (окремо) | Т.73 Esc і повернення фокусу (окремо) | Т.73 Esc у вікні евакуації і діалозі нової партії (окремо) |
| --- | --- | --- | --- | --- |
| 1 | плитки тулбара під вікном діють: в обробнику плиток прибрати перевірку відкритого вікна | червоний | зелений | зелений |
| 2 | клавіші бою під вікном діють: в `onKeyDown` (`src/ui/input.ts`) прибрати перевірку відкритого вікна | червоний | червоний | зелений |
| 3 | Esc під вікном доходить до бою: перевірка відкритого вікна в `onKeyDown` пропускає клавішу Escape | зелений | червоний | зелений |
| 4 | бій глушить лише вікно «Евакуювати останнього?»: перевірка відкритого вікна дивиться тільки на `evac-confirm` | червоний | червоний | зелений |
| 5 | відкрите «Меню» не бере фокус: прибрати переведення фокусу на «Закрити» | червоний | зелений | зелений |
| 6 | відкрите вікно «Незбережені зміни» не бере фокус: прибрати переведення фокусу на «Скасувати» | червоний | зелений | зелений |
| 7 | відкрите вікно «Налаштування» не бере фокус: прибрати переведення фокусу на «Закрити» | червоний | зелений | зелений |
| 8 | відкрите вікно «Як грати» не бере фокус: прибрати переведення фокусу на «Грати» | червоний | зелений | зелений |
| 9 | Esc не закриває жодного вікна: обробник Esc для вікон чекає іншої клавіші («Esc» замість «Escape») | зелений | червоний | червоний |
| 10 | Esc у «Незбережені зміни» натискає «Вийти без збереження» замість «Скасувати» | зелений | червоний | зелений |
| 11 | Esc не закриває вікно «Евакуювати останнього?» | зелений | зелений | червоний |
| 12 | Esc не закриває діалог нової партії | зелений | зелений | червоний |
| 13 | після «Закрити» в «Меню» фокус не повертається на «Меню» | зелений | червоний | зелений |
| 14 | «?» не стає кнопкою повернення фокусу: після «Як грати», відкритого кнопкою «?», фокус не йде на «?» | зелений | червоний | зелений |
```

Підсумок, який надрукував скрипт на прототипі: «Навмисних поломок — 14; хоча б один новий тест ловить 14 з 14.» Перевірки `expect` без поломки на прототипі (файл `expects.md`, 23 з 35) — передумови (вікно відкрилось, бій на місці) і повтори того самого на іншому шляху відкриття вікна; поломки, що ламають кожну поведінку кроку, у таблиці є.

Таблицю плану знято на прототипі планувальника; розбіжність із нею виконавець не пояснює і не домислює: розбіжні рядки назве `vibe-step.py docs`, а пояснить планувальник на аудиті.

<!-- блок: step -->
```text
{'step': 'Т.73',
 'plan': 'docs/plans/t73-overlay-keys.md',
 'report': 'docs/reports/t73-overlay-keys.md',
 'anchor': '    - Звіт — `docs/reports/t72-evac-sound-hint.md`\n',
 'new_file': 'src/main.ui.test.ts',
 'test_block': 'test-t73',
 'files': ['src/ui/input.test.ts'],
 'alone': [('Т.73 клавіші, плитки і фокус (окремо)',
            'Т.73: під «Меню», «Налаштування», «Як грати» і «Незбережені зміни» клавіші й плитки бою не діють; фокус — '
            'на безпечній кнопці вікна'),
           ('Т.73 Esc і повернення фокусу (окремо)',
            'Т.73: Esc закриває вікно і не скидає зведений режим під ним; фокус повертається на кнопку топбару, що '
            'відкрила вікно'),
           ('Т.73 Esc у вікні евакуації і діалозі нової партії (окремо)',
            'Т.73: Esc закриває й вікно «Евакуювати останнього?» (оперативник лишається) і діалог нової партії на '
            'стартовому екрані')],
 'whole': [],
 'mutations': [('плитки тулбара під вікном діють: в обробнику плиток прибрати перевірку відкритого вікна',
                'src/main.ts',
                'ЯКІР',
                'ПОЛОМКА'),
               ('клавіші бою під вікном діють: в `onKeyDown` (`src/ui/input.ts`) прибрати перевірку відкритого вікна',
                'src/ui/input.ts',
                'ЯКІР',
                'ПОЛОМКА'),
               ('Esc під вікном доходить до бою: перевірка відкритого вікна в `onKeyDown` пропускає клавішу Escape',
                'src/ui/input.ts',
                'ЯКІР',
                'ПОЛОМКА'),
               ('бій глушить лише вікно «Евакуювати останнього?»: перевірка відкритого вікна дивиться тільки на '
                '`evac-confirm`',
                'src/main.ts',
                'ЯКІР',
                'ПОЛОМКА'),
               ('відкрите «Меню» не бере фокус: прибрати переведення фокусу на «Закрити»',
                'src/ui/screens.ts',
                'ЯКІР',
                'ПОЛОМКА'),
               ('відкрите вікно «Незбережені зміни» не бере фокус: прибрати переведення фокусу на «Скасувати»',
                'src/ui/screens.ts',
                'ЯКІР',
                'ПОЛОМКА'),
               ('відкрите вікно «Налаштування» не бере фокус: прибрати переведення фокусу на «Закрити»',
                'src/ui/settings.ts',
                'ЯКІР',
                'ПОЛОМКА'),
               ('відкрите вікно «Як грати» не бере фокус: прибрати переведення фокусу на «Грати»',
                'src/ui/help.ts',
                'ЯКІР',
                'ПОЛОМКА'),
               ('Esc не закриває жодного вікна: обробник Esc для вікон чекає іншої клавіші («Esc» замість «Escape»)',
                'src/main.ts',
                'ЯКІР',
                'ПОЛОМКА'),
               ('Esc у «Незбережені зміни» натискає «Вийти без збереження» замість «Скасувати»',
                'src/main.ts',
                'ЯКІР',
                'ПОЛОМКА'),
               ('Esc не закриває вікно «Евакуювати останнього?»', 'src/main.ts', 'ЯКІР', 'ПОЛОМКА'),
               ('Esc не закриває діалог нової партії', 'src/main.ts', 'ЯКІР', 'ПОЛОМКА'),
               ('після «Закрити» в «Меню» фокус не повертається на «Меню»', 'src/main.ts', 'ЯКІР', 'ПОЛОМКА'),
               ('«?» не стає кнопкою повернення фокусу: після «Як грати», відкритого кнопкою «?», фокус не йде на «?»',
                'src/main.ts',
                'ЯКІР',
                'ПОЛОМКА')]}
```

### 4. Документи кроку (у гілці до відкриття PR)

Звіт, запис кроку, рядок довідника і чернетку опису PR збирає скрипт `vibe-step.py docs` з блоків цього плану — `report`, `limits`, `record`, `handbook`, `pr-body`, `table-plan` — і з файлів скриптів поломок і чекліста. Виконавець у цих документах руками нічого не набирає і не править: ні чисел, ні слів «немає» чи «нічого». Порядок: коміт коду й тестів → поломки (розділ 3) → чекліст (нижче) → `vibe-step.py docs` → `cp /tmp/t73/step-filled.txt docs/reports/t73-step.txt` → коміт документів → `vibe-step.py check` → PR.

- Звіт `docs/reports/t73-overlay-keys.md` з розділами: «Що зроблено», «Навмисні поломки», «Межі», «Чекліст перед PR», «Метрики», «Що з чекліста не вдалося». Усі вони є в блоці `report`. Власного підсумку таблиці поломок не писати: лише речення зі скрипта.
- Межі — блок `limits`, **словами плану, без переказу**; у звіт його вставляє скрипт. Межу, знайдену під час роботи, виконавець пише в сесії, а не у звіт.

<!-- блок: limits -->
```text
- (а) Пастки фокусу у вікні немає: клавіша Tab може вивести фокус на кнопки під вікном. Плитки й клавіші бою під вікном не діють, а інші кнопки (топбар, панелі) Enter натисне.
- (б) Esc не закриває екран перемоги кампанії: це екран після кампанії, а не вікно над боєм (рішення планувальника).
- (в) Esc натискає безпечну кнопку вікна, тож звук кліку (П11.7) звучить і на Esc.
- (г) Фокус повертається на кнопку топбару лише на екрані гри: після «Вийти без збереження» і на стартовому екрані — ні.
- (д) Фокус перевірено лише в jsdom (`document.activeElement`); рамку фокусу на кнопці вікна бачить власник на прев'ю.
- (е) Код написав виконавець сам за описом поведінки; прототип планувальника в план не йшов — лише для таблиці поломок і перевірки тестів.
```

<!-- блок: report -->
````text
# Т.73 — вікна поверх бою: клавіші й плитки, фокус і Esc: звіт

План — `docs/plans/t73-overlay-keys.md`. Код — Mistral Vibe Code сам за описом поведінки плану; тести — готовою латкою плану; поломки (якорі в коді виконавця — `docs/reports/t73-step.txt`), чекліст, звіт, запис кроку і PR — Mistral Vibe Code; план, тести і прототип для звірки — сесія Claude (Opus 5.5).

## Що зроблено

- Під будь-яким вікном поверх гри («Меню», «Налаштування», «Як грати», «Незбережені зміни», «Евакуювати останнього?») клавіші бою і плитки тулбара не діють — одна перевірка `overlayOpen` (`src/main.ts`, залежність `overlayOpen` в `src/ui/input.ts` замість `evacConfirmOpen`).
- Фокус при відкритті вікна — на його безпечній кнопці: «Закрити» в «Меню» і «Налаштуваннях», «Грати» в «Як грати», «Скасувати» в «Незбережених змінах» (`src/ui/screens.ts`, `src/ui/settings.ts`, `src/ui/help.ts`).
- Esc закриває відкрите вікно тією ж дією, що безпечна кнопка; вибір і зведений режим під вікном не скидаються.
- Після закриття вікна фокус — на кнопці топбару, що його відкрила («Меню» чи «?»).
- Тести: три наскрізні тести на сторінці (сід 42, пресет «норма»); хелпер `startParty` закриває «Як грати» першого візиту; фейк-таймери сторінкових тестів — без підробки `setImmediate` (`PAGE_FAKE_TIMERS`); у `src/ui/input.test.ts` — нове ім'я залежності.

## Навмисні поломки

Поломки робив скрипт `python3 scripts/vibe-step.py mutations` за блоком `step` плану з якорями виконавця: по одній поломці в коді кроку, кожен новий тест — окремим прогоном; файл після кожної поломки повернуто.

<таблиця поломок>

<речення з summary.md>

Розбіжності з таблицею плану: <розбіжності з таблицею плану>

## Межі

<межі плану>

## Чекліст перед PR

<рядки чекліста>

## Метрики

- Рядків у підрахунку `./scripts/pr-size.sh origin/main HEAD` — <число рядків>
- Час від запуску сесії до відкриття PR — запише планувальник після аудиту, за своїм годинником

## Що з чекліста не вдалося

<що з чекліста не вдалося>

## Відповідь власника (19.11.2026)

Питання: «Т.73 (вікна поверх бою). Які вікна блокують клавіші й плитки бою?». Відповідь: «Усі вікна (Recommended)».

Питання: «Куди переходить фокус, коли вікно відкривається над боєм?». Відповідь: «На безпечну кнопку (Recommended)».

Питання: «Що робить Esc, коли відкрите вікно?». Відповідь: «Закриває вікно (Recommended)».

Питання: «Куди повертається фокус після закриття вікна?». Відповідь: «На кнопку, що відкрила (Recommended)».

## Аудит

Аудит ще не проведено.
````

- Число рядків PR скрипт бере з `./scripts/pr-size.sh origin/main HEAD` (документи в підрахунок не йдуть).
- Запис кроку в `docs/workflow.md`, розділ «Технічні задачі (позафазні)», після запису Т.72 — блок `record`; вставляє скрипт. Місця, які він заповнює: `<число рядків>`, `<речення з summary.md>`, `<урок>`. Урок — лише про те, що справді сталося в цій сесії (наприклад, що в коді довелось виправити після тестів): тоді один-два рядки записати у файл `/tmp/t73/lesson.md` і запустити `python3 scripts/vibe-step.py docs --lesson-file /tmp/t73/lesson.md`; без уроку — `python3 scripts/vibe-step.py docs`.

<!-- блок: record -->
```text
- [x] **Т.73 (рішення власника 19.11.2026, після Т.72): вікна поверх бою — клавіші й плитки, фокус і Esc (кандидат 77).** Мета: під вікнами «Меню», «Налаштування», «Як грати», «Незбережені зміни» бій не відповідає на клавіші й плитки (межа (г) Т.71), фокус і Esc працюють як у вікні евакуації; код Vibe пише сам за описом поведінки.
    - Зроблено: одна перевірка відкритого вікна для клавіш і плиток бою (`overlayOpen`); фокус на безпечну кнопку вікна; Esc закриває вікно; фокус повертається на «Меню» чи «?». Пастки фокусу (Tab) у кроці немає (межі звіту).
    - Виконано: рядків у підрахунку `./scripts/pr-size.sh origin/main HEAD` — <число рядків>. <речення з summary.md>
    - Урок: <урок>
    - Звіт — `docs/reports/t73-overlay-keys.md`
```

Виконавцеві: `python3 scripts/vibe-step.py docs` з кореня репозиторію (з уроком — `--lesson-file`, пункт вище); блоки плану — у `/tmp/blocks`.

- Коміт документів — назвою з блоку `commit-docs`: `git add docs/ && git commit -F /tmp/blocks/commit-docs.txt` (у ньому і `docs/reports/t73-step.txt`).

<!-- блок: commit-docs -->
```text
docs(workflow): Т.73 — звіт і запис кроку
```

- Рядок довідника виконавця — блоком `handbook`: його вставляє `vibe-step.py docs` останнім рядком розділу «Лише для Mistral Vibe Code» у `docs/agents/common.md`. Свою пораду, знайдену під час роботи, виконавець пише в сесії — у довідник вона піде блоком `handbook-v2`.

<!-- блок: handbook -->
```text
- **Т.73 (19.11.2026):** код кроку гри — удруге сам виконавець за описом поведінки плану `docs/plans/t73-overlay-keys.md`; латка тестів міняла наявні тести, тож код і тести пішли одним комітом (хук pre-commit жене повний `npm test`).
```

- **Писати лише те, що сам зробив і побачив.** Про секрети репозиторію, налаштування CI і чужі середовища нічого не стверджувати. Про аудит виконавець сам нічого не пише: текст розділів «Аудит» дає планувальник готовими блоками порції після аудиту.

## Обмеження

- **Розмір:** оцінка — 210 рядків у підрахунку `./scripts/pr-size.sh` (код ≈ 50, тести 166), один PR. Якщо виходить понад 330 рядків — написати про це в сесії до того, як продовжувати; мітку `size-deviation` не ставити.
- **Змінювати лише:** п'ять файлів коду розділу 1, два файли тестів латкою розділу 2, документи кроку розділу 4. **Не чіпати:** `package.json`, `.github/`, `AGENTS.md`, ADR, `index.html`, `src/core/`, інші плани в `docs/plans/`, інші файли `src/`.
- У доданих рядках (код, коментарі, тести, документи) немає трансліту — лише кирилиця.
- Тести не послаблювати і не правити, щоб пройшли: червоний тест — привід виправити код.
- Історію не переписувати (без amend, rebase, force-push); `git commit --no-verify` не вживати — якщо хук падає, написати вивід у сесії.
- **Працювати короткими кроками:** одна правка — одна перевірка.

## Чекліст перед PR

`npx tsc --noEmit`, `npx tsc --noEmit -p tsconfig.core.json`, `npx tsc --noEmit -p tsconfig.e2e.json`, `npm run lint`, `npm run format:check`, `npm test`, `npm run docs`, `npm run test:e2e`.

Команди запускає скрипт `vibe-step.py checklist` — по одній за запуск, після поломок, до `vibe-step.py docs`: `python3 scripts/vibe-step.py checklist tsc`, потім так само з ключами `tsc-core`, `tsc-e2e`, `lint`, `format`, `test`, `docs`, `e2e`, і наостанок без ключа — `python3 scripts/vibe-step.py checklist`: він зводить результати у `/tmp/t73/checklist.md` і `/tmp/t73/failed.md`. У звіт і опис PR обидва файли вставляє `vibe-step.py docs`; результатів руками не писати.

Крок міняє UI (ввід і фокус), тож e2e у чеклісті (`AGENTS.md`): `python3 scripts/vibe-step.py checklist e2e`. У середовищі виконавця e2e досі не стартував (немає системної бібліотеки браузера) — тоді скрипт запише «не пройшла»; написати причину в сесії одним рядком і йти далі: сценарій e2e на гілці прожене планувальник.

Після коміту документів, перед `vibe-step.py check`: `git diff origin/main...HEAD -- . ':(exclude)docs/plans/' | grep -niP '^\+.*(?<!«)не має'` нічого не знаходить. Якщо знайшло — написати в сесії.

## PR

- Гілка — ця сама: `feat/t73-overlay-keys` (план уже в ній першим комітом). Комітити в неї. Назву коміту, яку дає план блоком `commit-…`, не набирати: `git commit -F /tmp/blocks/<ім'я блоку>.txt`. **Помилку в коміті виправляти новим комітом, а не `git commit --amend`** — і до пушу теж.
- **Документи кроку закомітити до відкриття PR**: перед `gh pr create` команда `git log --oneline origin/main..HEAD` показує коміт плану, коду з тестами (і, якщо був, виправлення коду) і документів.
- PR у `main`, **не чернеткою**. Назва — **дослівно** з блоку `pr-title`; не набирати.

<!-- блок: pr-title -->
```text
feat(ui): Т.73 — вікна поверх бою: клавіші й плитки не діють, фокус у вікні, Esc закриває
```

- Опис PR — **увесь** блоком `pr-body`; місця в ньому заповнюють скрипти: `vibe-step.py docs` — `<рядки чекліста>`, `<речення з summary.md>`, `<розбіжності з таблицею плану>`, `<число рядків>` (виходить чернетка `/tmp/t73/pr-body-draft.md`), `vibe-step.py check` — `<рядки vibe-plan-check>` (виходить `/tmp/pr-body.md`). Місць для виконавця в блоці немає; готовий опис руками не правити.

<!-- блок: pr-body -->
```text
### Що змінено і чому

Кандидат 77 (межа (г) Т.71): під вікнами «Меню», «Як грати», «Незбережені зміни» клавіші бою і плитки тулбара діяли, фокус лишався під вікном. Тепер під будь-яким вікном поверх гри бій не відповідає на клавіші й плитки (одна перевірка `overlayOpen`), фокус при відкритті — на безпечній кнопці вікна, Esc закриває вікно, а після закриття фокус повертається на «Меню» чи «?», що відкрили вікно. Код написав Mistral Vibe Code сам за описом поведінки плану; тести — готові з плану. Пастки фокусу (Tab) у кроці немає.

### Критерії приймання

- Під «Меню», «Налаштування», «Як грати», «Незбережені зміни» клавіші E, 1, O, G, V і плитки тулбара не міняють ні ходу, ні рядка `#binfo`.
- Фокус при відкритті: «Меню» — «Закрити», «Налаштування» — «Закрити», «Як грати» — «Грати», «Незбережені зміни» — «Скасувати».
- Esc закриває відкрите вікно (і «Евакуювати останнього?», і діалог нової партії) тією ж дією, що безпечна кнопка; зведений режим під вікном не скасовується; екран перемоги кампанії Esc не закриває.
- Після закриття вікна на екрані гри фокус — на «Меню» чи «?», що відкрили вікно (вікна з «Меню» — на «Меню»).

### Відповідь власника (19.11.2026)

Питання: «Т.73 (вікна поверх бою). Які вікна блокують клавіші й плитки бою?». Відповідь: «Усі вікна (Recommended)».

Питання: «Куди переходить фокус, коли вікно відкривається над боєм?». Відповідь: «На безпечну кнопку (Recommended)».

Питання: «Що робить Esc, коли відкрите вікно?». Відповідь: «Закриває вікно (Recommended)».

Питання: «Куди повертається фокус після закриття вікна?». Відповідь: «На кнопку, що відкрила (Recommended)».

### Перевірка

<рядки чекліста>

- <речення з summary.md>
- Розбіжності з таблицею плану: <розбіжності з таблицею плану>
- Рядків у підрахунку `./scripts/pr-size.sh origin/main HEAD` — <число рядків>
- `vibe-plan-check.mjs` перед відкриттям PR, рядки «Звірено» і «Знахідок» дослівно:
<рядки vibe-plan-check>

### Аудит

Аудит ще не проведено.

Згадка: кандидат 77, межа (г) Т.71; план — `docs/plans/t73-overlay-keys.md`; якорі поломок — `docs/reports/t73-step.txt`.

Iter-Tag: iter-T.73
```

- Перед відкриттям PR, коли документи кроку вже закомічено, — `python3 scripts/vibe-step.py check`: скрипт сам вставляє в опис рядки «Звірено» і «Знахідок» дослівно. Знахідку в тесті чи документах з блоків плану виконавець не виправляє руками — написати про неї в сесії і відкривати PR; знахідку у своєму коді — виправити новим комітом коду до PR і назвати в сесії.
- Відкрити PR готовими файлами: `gh pr create --base main --title "$(cat /tmp/blocks/pr-title.txt)" --body-file /tmp/pr-body.md` — без `--draft`. Одразу після цього — `gh pr view <номер> --json isDraft`: має бути `{"isDraft":false}`; якщо `true` — `gh pr ready <номер>`.
- Після відкриття — `python3 scripts/vibe-step.py check --pr <номер>`. Якщо рядки звірки інші, ніж в описі, — **нового коміту не робити і опис не правити**, а написати про це в сесії.
- Після відкриття PR — коротко відповісти в сесії: номер PR, вивід `gh pr view <номер> --json isDraft`, останній рядок `vibe-step.py check --pr`, вміст `/tmp/t73/failed.md`, чи були червоні тести після латки і що в коді виправлено, і перелік «пункт плану — зроблено / ні» з доказом `grep` на кожен рядок «зроблено». Скільки часу зайняв крок, не писати. **Не мержити.**
- **Після відкриття PR — нічого не пушити, доки планувальник не дасть знахідок.** **Про аудит і результати чеків CI нічого не писати** — ні в документах, ні в описі PR. Розділ «Аудит» лишається «Аудит ще не проведено», доки його текст не дасть планувальник.
