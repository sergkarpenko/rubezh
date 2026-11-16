# Т.58 — після виходу на стартовий екран: план для Vibe Code

**Хто що робить (рішення власника 15.11.2026 і 17.11.2026).** План підготувала хмарна сесія Claude (Fable 5.2). Код, тести, звіт, запис кроку і PR робить агент **Mistral Vibe Code**. Знахідки аудиту виправляє Vibe Code у тій самій сесії. Мерж — лише після «схвалюю» власника; **виконавець PR не мержить**.

**Джерело:** кандидат 54 — решта знахідок аудиту PR #348 (Т.48 «Вихід на стартовий екран зупиняє все»); частину закрив Т.53 (PR #353). Правила гри і `src/core/` не міняються.

**Перед роботою прочитати:** `AGENTS.md`, `docs/agents/common.md`, `docs/agents/ui.md` (розділи «Лише для хмарної сесії Claude» пропустити; розділ «Лише для Mistral Vibe Code» у `docs/agents/common.md` — прочитати). Записи кроків: `grep -n 'Т.48\|Т.53' docs/workflow.md | cut -c1-200`.

Усе нижче перевірено по коду на `main` = `8a43fb8` і на прототипі планувальника (зміна і тести в робочій теці, прогони, відкат).

## Терміни гри (писати саме так)

Вивід інструментів у середовищі виконавця екранує кирилицю, тому слова легко переплутати. Файли з кирилицею читати через `python3`. У коді, тестах і документах:

- **зонд** (не «зона»), **сід** (не «сид», не «seed» у тексті), **тік** (на 21-му тіку), **перехоплювач** (не «перехоплюач»);
- **наскрізний тест на сторінці** — тест vitest у `src/main.ui.test.ts`, що клікає сторінку в jsdom; це не сценарій e2e (`npm run test:e2e`, Playwright, тека `e2e/`);
- **стартовий екран** (не «головне меню»), **екран перемоги**, **збереження** в тексті для гравця (не «сейв»); у коментарях і документах «сейв» ужито, як у наявному коді;
- **ambient** — назва шару анімацій у коді (ADR-0073), пишеться латинкою.

Назви змінних і функцій — як у цьому плані (`partyOnScreen`, `showNote`, `requestExit`, `CONTINUE_FAILED_TEXT`).

## Відповідь власника (17.11.2026, до реалізації)

Питання: «Т.58 (кандидат 54, решта після виходу на старт): які пункти входять у крок?». Відповідь: **«Текст після «Продовжити», Ambient на старті, Меню на екрані перемоги, Тест анімацій геосцени»**.

Питання: «Якщо пунктів кілька — це один PR чи окремий PR на кожен пункт (кожен «схвалюю» окремо)?». Відповідь: **«Один PR (Recommended)»**.

Питання: «Який текст показувати на стартовому екрані після невдалого «Продовжити»?». Відповідь: **«Варіант 1»** — у питанні це рядок **«Не вдалося завантажити збереження. Почніть нову гру.»**.

Питання: «Перевірив на сторінці (1366×768, 1024×768, телефон): екран «Перемога в кампанії!» накриває кнопку «Меню» — вийти на стартовий екран можна лише після «Грати далі». Як виправити?». Відповідь: **«Третя кнопка (Recommended)»** — опис варіанта в питанні: на екрані перемоги під «Грати далі» і «Грати знов» — кнопка «На стартовий екран» (текст як у меню; з тим самим вікном «Незбережені зміни»).

У звіті, записі кроку й описі PR рішення власника цитувати **лише з цього розділу, дослівно**. Іншого власник не казав: нових цитат не складати, слова не переставляти. Решта (місце рядка над кнопками меню, кольори, назви в коді, спосіб перевірки) — рішення планувальника.

## Що зробити

Чотири пункти кандидата 54, один PR. Правки — `python3`-скриптом із `assert s.count(a) == 1` на кожен рядок-якір.

### 1. Код

**1.1. `src/ui/ambient.ts`** — ambient-цикл не стартує, коли партії немає на екрані. Зараз `start()` (він же `resume`, і його кличе `toggle`) дивиться лише на тумблер, rAF і видимість вкладки, тому на стартовому екрані повернення вкладки з фону і тумблер «Анімація» запускають цикл кадрів.

- в інтерфейс `AmbientDeps` після рядка `visible(): boolean; …` додати рядок:

```ts
  active(): boolean; // Т.58: партія на екрані; на стартовому екрані цикл не стартує (вкладка з фону, тумблер)
```

- у `start()` умову `if (handle !== null || !on || !deps.hasRaf() || !deps.visible()) return;` замінити на:

```ts
    if (handle !== null || !on || !deps.hasRaf() || !deps.visible() || !deps.active()) return;
```

**1.2. `src/main.ts`** — п'ять місць:

- у `createAmbient({…})` після рядка `visible: …` додати `  active: () => partyOnScreen,`;
- перед рядком `let victoryDismissed = false; …` додати:

```ts
let partyOnScreen = false; // Т.58: партію показано (не стартовий екран) — лише тоді ambient-цикл стартує
```

- у `adoptParty` перед рядком `ambient.start(); …` додати `  partyOnScreen = true; // Т.58: до ambient.start — гейт active`;
- у залежностях панелей рядок `  victoryDismissed: () => victoryDismissed,` замінити на:

```ts
  // Т.58: на стартовому екрані екран перемоги не показуємо — і коли невдале «Продовжити» перемальовує панелі
  victoryDismissed: () => victoryDismissed || !partyOnScreen,
```

- тіло `exitToStart` після змін (два нові рядки, решта без змін):

```ts
function exitToStart(): void {
  if (ui.mission !== null) battle.close();
  geoAnim.cancel();
  partyOnScreen = false; // Т.58: повернення вкладки з фону і тумблер налаштувань ambient на стартовому екрані не будять
  ambient.pause();
  el('campaign-victory').classList.add('hidden'); // Т.58: вихід з екрана перемоги — екран не лишається поверх стартового
  screens?.showStart();
}
```

- перед коментарем `// П4.5 (ADR-0021): найм солдата` (одразу після обробника `btn-continue`) додати:

```ts
  // Т.58 (рішення власника 17.11.2026 «Третя кнопка»): вихід з екрана перемоги — той самий шлях, що «На стартовий екран» у меню
  el('btn-victory-exit').onclick = () => screens?.requestExit();
```

**1.3. `src/ui/screens.ts`** — рядок-пояснення і `requestExit` назовні:

- в інтерфейс `Screens` після `closeMenu(): void;` додати `  requestExit(): void; // Т.58: вихід на стартовий екран з підтвердженням, якщо є незбережені дії (меню і екран перемоги)`;
- у `startScreenHtml` між рядком `'<div class="start-menu">' +` і кнопкою `btn-start-new` додати рядок `    '<p class="start-note hidden" id="start-note"></p>' +` (рядок — **над** кнопками);
- перед `export function createScreens(` додати:

```ts
// Т.58 (рішення власника 17.11.2026): текст на стартовому екрані після невдалого «Продовжити»
export const CONTINUE_FAILED_TEXT = 'Не вдалося завантажити збереження. Почніть нову гру.';
```

- у `showStart()` після `current = 'стартовий';` додати `    showNote(''); // Т.58: пояснення невдалого «Продовжити» живе до наступного показу екрана`;
- перед `function hideDialogs()` додати:

```ts
  // Т.58: рядок-пояснення над меню стартового екрана; порожній текст — сховати
  function showNote(text: string): void {
    const note = el('start-note');
    note.textContent = text;
    note.classList.toggle('hidden', text === '');
  }
```

- в обробнику `btn-start-continue` після `if (deps.onContinue()) showGame();` додати `    else showNote(CONTINUE_FAILED_TEXT); // Т.58: слот не розібрано — пояснити, а не мовчати`;
- у поверненому об'єкті після `closeMenu,` додати `requestExit,`.

**1.4. `index.html`** — два місця:

- у секції `#campaign-victory` після кнопки `btn-play-again` додати `      <button id="btn-victory-exit" class="btn-play-again">На стартовий екран</button>`;
- перед правилом `.start-version {` додати:

```css
      /* Т.58: пояснення невдалого «Продовжити» — над кнопками меню */
      .start-note {
        margin: 0;
        padding: 8px 12px;
        font-size: 13px;
        text-align: center;
        color: #ff8fa3;
        background: rgba(6, 10, 20, 0.95);
        border: 1px solid rgba(255, 92, 122, 0.6);
      }
```

Коментарі над змінами — українською, з позначкою «Т.58», як у блоках вище.

### 2. Тести модулів

Наявні тести **не послаблювати і не видаляти з них перевірок**; жодного `it.skip`, `it.only`. **Тексти UI в тестах — рядковими літералами**, як у блоках нижче; порівнювати з результатом функції, що будує текст, заборонено.

**2.1. `src/ui/ambient.test.ts`** — харнес отримує `active` (нова обов'язкова залежність):

- в інтерфейс `Harness` після `visible(): boolean;` додати `  active(): boolean;`, після `setVisible(v: boolean): void;` — `  setActive(v: boolean): void; // Т.58: партія на екрані чи стартовий екран`;
- у `makeHarness` після `let vis = visible;` додати `  let act = true;`, після `hasRaf: () => true,` — `    active: () => act,`, після блоку `setVisible: …` — `    setActive: (v) => { act = v; },` (Prettier розгорне на три рядки);
- у кінець файла — блок дослівно:

```ts
// Т.58 (кандидат 54): на стартовому екрані ambient-цикл не стартує — ні після повернення вкладки з фону, ні від тумблера
describe('Т.58: ambient і стартовий екран', () => {
  it('Т.58: active=false — start, resume і тумблер кадрів не планують; active=true — планують', () => {
    const h = makeHarness();
    const amb = createAmbient({ ...h, store: memStore() });
    h.setActive(false);
    amb.start();
    amb.resume(); // вкладка повернулась із фону
    expect(amb.toggle()).toBe(false); // тумблер: вимк
    expect(amb.toggle()).toBe(true); // тумблер: увімк
    expect(h.scheduled()).toBe(0);
    expect(h.pending()).toBe(false);
    h.setActive(true);
    amb.resume();
    expect(h.scheduled()).toBe(1);
    expect(h.pending()).toBe(true);
  });
});
```

**2.2. `src/ui/settings.test.ts`** — у двох об'єктах залежностей `createAmbient` після `visible: () => true,` додати `active: () => true,` (без цього не проходить `npx tsc --noEmit`).

**2.3. `src/ui/screens.test.ts`** — імпорт замінити на `import { CONTINUE_FAILED_TEXT, createScreens, type ScreensDeps } from './screens';`, у кінець файла — блок дослівно:

```ts
// Т.58 (кандидат 54; рішення власника 17.11.2026): пояснення невдалого «Продовжити» і вихід для екрана перемоги
describe('Т.58: пояснення невдалого «Продовжити», requestExit', () => {
  const TEXT = 'Не вдалося завантажити збереження. Почніть нову гру.';

  it('Т.58: невдале «Продовжити» показує рядок над меню; showStart його прибирає; вдале — рядка немає', () => {
    expect(CONTINUE_FAILED_TEXT).toBe(TEXT);
    let ok = false;
    const screens = createScreens(makeDeps({ hasSaves: () => true, continueDisabledReason: () => '', onContinue: () => ok }));
    screens.showStart();
    expect(visible('start-note')).toBe(false);
    expect($('start-note').textContent).toBe('');
    expect($('start-note').nextElementSibling).toBe($('btn-start-new')); // рядок — над кнопками меню
    btn('btn-start-continue').click();
    expect(screens.current()).toBe('стартовий');
    expect(visible('start-note')).toBe(true);
    expect($('start-note').textContent).toBe(TEXT);
    screens.showStart(); // наступний показ стартового екрана
    expect(visible('start-note')).toBe(false);
    expect($('start-note').textContent).toBe('');
    ok = true;
    btn('btn-start-continue').click();
    expect(screens.current()).toBe('гра');
    expect(visible('start-note')).toBe(false);
  });

  it('Т.58: requestExit — з незбереженими діями підтвердження, без них вихід одразу; меню закривається', () => {
    let dirty = true;
    const deps = makeDeps({ hasUnsavedChanges: () => dirty });
    const screens = createScreens(deps);
    screens.showGame();
    screens.openMenu();
    screens.requestExit();
    expect(visible('game-menu')).toBe(false);
    expect(visible('exit-confirm')).toBe(true);
    expect(deps.onExitToStart).not.toHaveBeenCalled();
    btn('btn-exit-no').click();
    dirty = false;
    screens.requestExit();
    expect(visible('exit-confirm')).toBe(false);
    expect(deps.onExitToStart).toHaveBeenCalledTimes(1);
  });
});
```

### 3. Наскрізний тест на сторінці: `src/main.ui.test.ts`

Новий блок у кінці файла (блоки тримають спільний стан — у чужі не вставляти). Блок — **дослівно, кодом нижче** (сід 27, пресет «норма»; перевірено планувальником на прототипі: до зміни коду обидва тести червоні — елементів `start-note` і `btn-victory-exit` немає; після — зелені). Вставити без змін скриптом `python3`, що вирізає блок `ts` із цього плану, і звірити побайтно; якщо блок не проходить — не переписувати, а написати в сесії, що саме падає.

```ts
// Т.58 (кандидат 54, решта після Т.48; план — docs/plans/t58-after-exit-to-start.md): пояснення невдалого
// «Продовжити» і вихід з екрана перемоги (рішення власника 17.11.2026). Останній блок файла.
describe('Т.58: стартовий екран після невдалого «Продовжити» і вихід з екрана перемоги', () => {
  const hidden = (id: string): boolean => $(id).classList.contains('hidden');
  // нова партія, один тік, сейв у слот 1 — єдиний, отже останній активний
  const freshSave = (): string => {
    btn('btn-del-2').click();
    btn('btn-del-3').click();
    startParty('27');
    btn('btn-tick').click();
    btn('btn-save-1').click();
    return localStorage.getItem('rubezh.save.1') as string;
  };
  const exitViaMenu = (): void => {
    btn('btn-menu').click();
    btn('btn-menu-exit').click();
    expect(hidden('exit-confirm')).toBe(true); // після сейву чи завантаження втрачати нічого
    expect(hidden('start-screen')).toBe(false);
  };

  it('Т.58: невдале «Продовжити» — рядок-пояснення на стартовому екрані; наступний показ екрана його прибирає', () => {
    const good = freshSave();
    exitViaMenu();
    expect(hidden('start-note')).toBe(true);
    const bad = JSON.parse(good) as { state: { geo: { ufos: unknown } } };
    bad.state.geo.ufos = [null]; // метадані читаються (слот лишається останнім), розбір партії падає
    localStorage.setItem('rubezh.save.1', JSON.stringify(bad));
    try {
      btn('btn-start-continue').click();
      expect(hidden('start-screen')).toBe(false);
      expect(hidden('start-note')).toBe(false);
      expect($('start-note').textContent).toBe('Не вдалося завантажити збереження. Почніть нову гру.');
    } finally {
      localStorage.setItem('rubezh.save.1', good);
    }
    btn('btn-start-continue').click(); // цілий слот вантажиться
    expect(hidden('start-screen')).toBe(true);
    exitViaMenu();
    expect(hidden('start-note')).toBe(true);
    expect($('start-note').textContent).toBe('');
  });

  it('Т.58: «На стартовий екран» на екрані перемоги — вихід, з незбереженою дією через підтвердження; екран перемоги поверх стартового не лишається', () => {
    const good = freshSave();
    const won = JSON.parse(good) as { state: { campaign: { status: string } } };
    won.state.campaign.status = 'перемога';
    localStorage.setItem('rubezh.save.1', JSON.stringify(won));
    try {
      btn('btn-load-1').click();
      expect(hidden('campaign-victory')).toBe(false);
      expect(btn('btn-victory-exit').textContent).toBe('На стартовий екран');
      btn('btn-victory-exit').click(); // одразу після завантаження незбережених дій немає
      expect(hidden('exit-confirm')).toBe(true);
      expect(hidden('start-screen')).toBe(false);
      expect(hidden('campaign-victory')).toBe(true);
      // невдале «Продовжити» перемальовує панелі покинутої партії — екран перемоги не повертається
      const bad = JSON.parse(good) as { state: { geo: { ufos: unknown } } };
      bad.state.geo.ufos = [null];
      localStorage.setItem('rubezh.save.1', JSON.stringify(bad));
      btn('btn-start-continue').click();
      expect(hidden('start-note')).toBe(false);
      expect(hidden('campaign-victory')).toBe(true);
      localStorage.setItem('rubezh.save.1', JSON.stringify(won));
      btn('btn-start-continue').click(); // сейв із перемогою — екран перемоги знову показано
      expect(hidden('start-screen')).toBe(true);
      expect(hidden('campaign-victory')).toBe(false);
      btn('btn-tick').click(); // незбережена дія
      btn('btn-victory-exit').click();
      expect(hidden('exit-confirm')).toBe(false);
      expect(hidden('start-screen')).toBe(true);
      btn('btn-exit-no').click(); // «Скасувати» — лишаємось на екрані перемоги
      expect(hidden('campaign-victory')).toBe(false);
      btn('btn-victory-exit').click();
      btn('btn-exit-yes').click();
      expect(hidden('start-screen')).toBe(false);
      expect(hidden('campaign-victory')).toBe(true);
    } finally {
      localStorage.setItem('rubezh.save.1', good);
    }
  });
});
```

### 3а. Сценарій e2e: `e2e/acceptance.scenario.ts`

Новий крок — між кроком «Т.47: «Продовжити» після виходу з бою…» і кроком «запуск місії» (перед рядком `  await test.step('запуск місії', async () => {`), дослівно. Він тримає те, чого в jsdom не видно (там немає rAF): зв'язування `partyOnScreen` у `src/main.ts` і скидання анімацій геосцени на виході — тік перед виходом запускає скан-радар на 1,2 с, і без `geoAnim.cancel()` його кадри йдуть уже на стартовому екрані.

```ts
  await test.step('Т.58: стартовий екран після виходу з геосцени — кадрів ніхто не планує', async () => {
    const saved = mirror.clock();
    // тік — лише на сторінці (стан повертає «Продовжити»): запускає скан-радар геосцени на 1,2 с
    await page.locator('#btn-tick').click();
    await expect(clock).not.toHaveText(saved);
    await page.locator('#btn-menu').click();
    await page.locator('#btn-menu-exit').click();
    await page.locator('#btn-exit-yes').click();
    await expect(page.locator('#start-screen')).toBeVisible();
    await page.evaluate(() => {
      const w = window as unknown as { t58Frames: number };
      const orig = window.requestAnimationFrame;
      w.t58Frames = 0;
      window.requestAnimationFrame = (cb) => {
        w.t58Frames++;
        return orig.call(window, cb);
      };
    });
    // повернення вкладки з фону і тумблер «Анімація» (вимк → увімк) ambient на стартовому екрані не будять
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.locator('#btn-start-settings').click();
    await page.locator('#settings-ambient').click();
    await expect(page.locator('#settings-ambient')).toHaveText('Анімація: вимк');
    await page.locator('#settings-ambient').click();
    await expect(page.locator('#settings-ambient')).toHaveText('Анімація: увімк');
    await page.locator('#settings-close').click();
    await page.waitForTimeout(1500);
    const frames = await page.evaluate(() => (window as unknown as { t58Frames: number }).t58Frames);
    expect(frames, 'на стартовому екрані хтось планує кадри анімації').toBe(0);
    await page.locator('#btn-start-continue').click();
    await expect(page.locator('#start-screen')).toBeHidden();
    await expect(clock).toHaveText(saved);
    // у грі ambient знову працює: цикл планує кадри
    await expect.poll(() => page.evaluate(() => (window as unknown as { t58Frames: number }).t58Frames)).toBeGreaterThan(0);
  });
```

### 4. Навмисні поломки (до PR, результати — у звіт)

Кожну зробити по одній, прогнати `npx vitest run src/ui/ambient.test.ts src/ui/screens.test.ts src/main.ui.test.ts`, записати «червоний / зелений» для кожного з трьох файлів і повернути код (`git checkout <файл>`; перед комітом `git status --short` його не показує). Для поломок 1–6 — ще й `npm run build && npm run test:e2e`, **якщо e2e в пісочниці піднявся**; якщо ні — так і написати, колонку e2e у звіті заповнити словами «у пісочниці не запускався; у планувальника — …». Що побачив планувальник на прототипі:

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

### 5. Документи кроку (у гілці до відкриття PR)

- Звіт `docs/reports/t58-after-exit-to-start.md` з розділами: «Що зроблено», «Навмисні поломки» (таблиця), «Межі» (пункти нижче), «Чекліст перед PR», «Метрики» (число рядків із `./scripts/pr-size.sh origin/main HEAD`; час кроку), «Що з чекліста не вдалося». **Жодного розділу не пропускати.**
- У розділі «Межі» — щонайменше пункти плану, **словами плану, без переказу**: (а) рядок-пояснення на стартовому екрані займає два рядки тексту (340 × 56 px на 1366 × 768 і 1024 × 768, 335 × 56 px на 390 × 844) і накриває підпис під логотипом, поки показаний, — виміри планувальника на прототипі, власник цього розташування не бачив; (б) рядок-пояснення зникає лише з наступним показом стартового екрана; кнопка «Продовжити» після невдалої спроби лишається активною; (в) зв'язування `partyOnScreen` у `src/main.ts` (поломки 2–4) тримає лише сценарій e2e — у наскрізних тестах на сторінці rAF немає; (г) гейт e2e про анімації геосцени спирається на те, що вихід на стартовий екран відбувається раніше, ніж за 1,2 с після тіку: на повільній машині скан-радар може скінчитись сам, і гейт буде зеленим без `geoAnim.cancel()`; (ґ) подію `visibilitychange` сценарій e2e посилає сам, вкладку у фон він не ховає; (д) екран перемоги для тестів зроблено правкою сейву (`campaign.status = 'перемога'`, рахунку немає) — справжню перемогу на 30-ту добу тести не проходять; (е) на екрані перемоги три кнопки вміщаються без прокрутки на 1366 × 768, 1024 × 768 і 390 × 844 (нижній край третьої — 546, 546 і 602 px) — виміри планувальника, гейта на це немає. Межі, знайдені під час роботи, — окремими пунктами після них.
- Числа звірки скриптом до відкриття PR — у звіт, розділ «Чекліст перед PR»; числа запуску з `--pr` одразу після відкриття PR — в опис, а не новим комітом (розділ «PR» нижче); у звіт — разом із порцією документів після аудиту, якщо планувальник попросить.
- Число рядків PR перераховувати **після кожного коміту** і виправляти скрізь, де воно названо: у звіті, записі кроку й описі PR.
- Запис кроку в `docs/workflow.md`, розділ «Технічні задачі (позафазні)», після запису Т.57: `- [x] **Т.58 (рішення власника 17.11.2026, після Т.57): після виходу на стартовий екран.** Мета…` з підпунктами «Зроблено», «Виконано», «Урок». Підпункт «Аудит» і номер PR — другим комітом, після аудиту; до аудиту тверджень про його результат не писати.
- У `docs/agents/ui.md`, розділ «Довідкові дані», у переліку id елементів додати `#start-note` і `#btn-victory-exit`.
- Власні уроки про спосіб роботи — один-два рядки в `docs/agents/common.md`, розділ «Лише для Mistral Vibe Code», з позначкою «Т.58».
- **Писати лише те, що сам зробив і побачив.** Про секрети репозиторію, налаштування CI і чужі середовища нічого не стверджувати. Про аудит писати лише отримане в сесії: знахідки, що з кожною зроблено, і числа аудиторів, які дав планувальник. Урок — лише про те, що справді сталося в цій сесії; причин не вигадувати.

## Обмеження

- **Розмір:** на прототипі — 230 рядків у підрахунку `./scripts/pr-size.sh` (≈ 40 рядків коду і розмітки, ≈ 155 рядків тестів, ≈ 35 рядків e2e), один PR. Якщо виходить понад 300 рядків — написати про це в сесії до того, як продовжувати; мітку `size-deviation` не ставити.
- **Не чіпати:** `src/core/`, `.github/`, `package.json`, `scripts/`, `docs/adr/`, наявні кроки сценарію e2e і наявні тести (крім названих правок харнеса).
- У доданих рядках (код, коментарі, тести, документи) немає трансліту — лише кирилиця.
- Тести не послаблювати, щоб пройшли.
- Історію не переписувати (без amend, rebase, force-push).
- **Працювати короткими кроками:** одна правка — одна перевірка — коміт. Великий документ писати частинами, а не обмірковувати цілком.

## Чекліст перед PR

`npx tsc --noEmit`, `npx tsc --noEmit -p tsconfig.core.json`, `npx tsc --noEmit -p tsconfig.e2e.json`, `npm run lint`, `npm run format:check`, `npx prettier --check e2e/acceptance.scenario.ts`, `npm test`, `npm run docs`, `npm run test:e2e`.

Крок зачіпає сценарій e2e: e2e обов'язковий (`AGENTS.md`). Підготовка браузера в пісочниці — у розділі «Лише для Mistral Vibe Code» довідника (у Т.55 спрацювало); на неї — **не більше 15 хвилин**. Якщо e2e не піднявся — не лагодити сценарій наосліп: написати про це в сесії, у звіті й в описі PR; планувальник прогнав сценарій на прототипі (1 passed, 24 с) і прожене його на гілці PR сам, а на PR його жене CI.

## PR

- Гілка — ця сама: `fix/t58-after-exit-to-start` (план уже в ній першим комітом). Комітити в неї, Conventional Commits українською.
- **Документи кроку закомітити до відкриття PR** (звіт, запис кроку, рядки довідників): перед `gh pr create` команда `git log --oneline origin/main..HEAD` показує коміт із ними.
- PR у `main`, **не чернеткою**. Назва — **дослівно, скопіювати**: `fix(ui): Т.58 — після виходу на стартовий екран`.
- Опис PR: що змінилось і чому; відповіді власника дослівно (з розділу вище); згадка «Т.48, PR #348», «Т.53, PR #353» і цього плану; результати чекліста; число рядків; числа звірки скриптом (до PR і з `--pr`); і окремим рядком з початку рядка, без відступу:

```
Iter-Tag: iter-T.58
```

- Перед відкриттям PR, коли документи кроку вже закомічено, запустити звірку з планом разом із готовими назвою й описом: `node scripts/vibe-plan-check.mjs --plan docs/plans/t58-after-exit-to-start.md --title "fix(ui): Т.58 — після виходу на стартовий екран" --body-file <файл опису>` — числа цього запуску вже в описі, з яким відкривається PR; після відкриття — ще раз із `--pr <номер>`. Кожну знахідку виправити або назвати в описі PR з причиною. **Якщо числа запуску з `--pr` інші — дописати їх в опис PR** (`gh pr edit <номер> --body-file <файл>`), **а не новим комітом**. Якщо знахідка вимагає правки файла — один коміт і повідомлення про нього в сесії.
- Після відкриття PR — коротко відповісти в сесії: номер PR, що з чекліста не вдалося, скільки часу зайняв крок. **Не мержити.**
