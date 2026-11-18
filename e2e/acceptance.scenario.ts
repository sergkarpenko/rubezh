// e2e/acceptance.scenario.ts
// Сценарій приймання (ADR-0080): стандартний smoke-сценарій валідації
// (ADR-0030, крок 7 циклу) як автоматичний прохід у браузері. Кроки ті самі,
// що їх робив власник очима: вибрати юніта → рух (тап-тап) → дозор → кінець
// ходу (хід демонів) → постріл у видиму ціль → до результату бою; геосцена:
// +1 тік, +1 доба, сейв → лоад; консоль без помилок. Порядок бойових кроків
// підлаштований під гру: ціль стає видимою, коли демони підійдуть, тож постріл
// іде після першого кінця ходу.
//
// Сценарій не знає мапи наперед: куди клікати і що має показати сторінка,
// каже дзеркало ядра (e2e/mirror.ts) — друга партія з тим самим сідом у Node.
// Суфікс *.scenario.ts — поза глобом vitest і поза testMatch домен-смоку
// прев'ю (ADR-0063): `npm test` і `npm run test:smoke` цей файл не тягнуть.

import { expect, test, type Page } from '@playwright/test';
import { TICK_MINUTES } from '../src/core/geo';
import { MISSION_MAP_H, MISSION_MAP_W } from '../src/core/mission';
import type { Vec2 } from '../src/core/combat';
import { cellHash } from '../src/core/render-core';
import { CoreMirror, enemyLine, unitLine } from './mirror';

const SEED = 42;
const PRESET = 'норма';
const TICKS_PER_DAY = 1440 / TICK_MINUTES;
const MAX_TICKS_TO_MISSION = 2 * TICKS_PER_DAY; // зонд має приземлитись за дві доби
const MAX_TURNS_TO_TARGET = 6; // демони мають вийти на лінію вогню за кілька ходів
const AUTO_BATTLE_TIMEOUT_MS = 120_000; // авто-бій іде з анімаціями і паузами

// Помилки сторінки і консолі за весь прохід. 404 на /favicon.ico — запит
// браузера до кореня хоста, якого гра не обслуговує, а не дефект гри.
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico')) errors.push(message.text());
  });
  return errors;
}

// Тап по центру клітинки бойовища: CSS-розмір канви → клітинка (обернена
// математика до cellFromPoint у src/ui/input.ts).
async function tap(page: Page, cell: Vec2): Promise<void> {
  const canvas = page.locator('#battle');
  const box = await canvas.boundingBox();
  if (box === null) throw new Error('Канва бою не відображається');
  await canvas.click({
    position: { x: ((cell.x + 0.5) * box.width) / MISSION_MAP_W, y: ((cell.y + 0.5) * box.height) / MISSION_MAP_H },
  });
}

// Т.32: бій у межах вікна — поле, плитки дій, підказка і журнал видно без
// прокрутки; minField — найменша сторона поля для цього розміру вікна.
async function expectBattleFits(page: Page, label: string, minField: number): Promise<void> {
  const m = await page.evaluate(() => {
    const box = (id: string) => document.getElementById(id)!.getBoundingClientRect();
    const focus = document.getElementById('focus')!;
    return {
      win: window.innerHeight,
      winW: window.innerWidth,
      page: document.documentElement.scrollHeight,
      field: box('battle').width,
      fieldH: box('battle').height,
      bottoms: [box('battle').bottom, box('btoolbar').bottom, box('binfo').bottom, box('journal').bottom],
      rights: [box('btoolbar').right, box('binfo').right, box('journal').right],
      overlap: box('btoolbar').left - box('battle').right,
      side: box('binfo').left - box('btoolbar').right,
      log: box('log').height,
      scroll: focus.scrollHeight - focus.clientHeight,
    };
  });
  expect(m.page, label + ': сторінка вища за вікно').toBeLessThanOrEqual(m.win);
  expect(Math.max(...m.bottoms), label + ': поле, плитки, підказка або журнал нижче вікна').toBeLessThanOrEqual(m.win);
  expect(Math.max(...m.rights), label + ': плитки, підказка або журнал за правим краєм').toBeLessThanOrEqual(m.winW);
  expect(m.scroll, label + ': фокусна зона прокручується').toBeLessThanOrEqual(0);
  expect(m.field, label + ': поле менше за межу').toBeGreaterThanOrEqual(minField);
  expect(Math.abs(m.field - m.fieldH), label + ': поле не квадратне').toBeLessThanOrEqual(1);
  expect(m.overlap, label + ': плитки дій накладаються на поле').toBeGreaterThanOrEqual(0);
  expect(m.side, label + ': плитки дій накладаються на підказку').toBeGreaterThanOrEqual(0);
  expect(m.log, label + ': у журналі менше двох рядків').toBeGreaterThanOrEqual(40);
}

// Стан загону на сторінці = стан у дзеркалі: вибираємо кожного живого
// оперативника і звіряємо його рядок HP/AP. Після ходу демонів це ловить
// розбіжність у їхніх пострілах і реакційному вогні дозору.
// Т.33: «Кінець» → плашка ходу демонів (хід гравця ще не починається) → підсумок ходу в правій частині панелі.
async function endTurnOnPage(page: Page, mirror: CoreMirror): Promise<number> {
  await page.locator('#btn-end').click();
  const actions = mirror.endPlayerTurn();
  if (mirror.outcome() !== 'триває') return actions;
  const plate = page.locator('#bturn');
  await expect(plate).toHaveText('ХІД ДЕМОНІВ РОЗРИВУ…Демони діють. Зачекайте.');
  await expect(page.locator('#btn-end')).toBeDisabled();
  await expect(page.locator('#bctx-turn')).toHaveText('хід демонів Розриву');
  await expect(page.locator('#binfo')).toHaveText('');
  await expect(plate).toHaveClass('done');
  await expect(plate).toHaveText(mirror.turnSummary);
  return actions;
}

async function expectSquad(page: Page, mirror: CoreMirror): Promise<void> {
  for (const soldier of mirror.squad()) {
    await tap(page, soldier.pos);
    await expect(page.locator('#bctx-unit')).toHaveText(unitLine(soldier));
  }
}

test('сценарій приймання ADR-0030: партія → місія → бій до результату → геосцена → сейв/лоад', async ({ page }) => {
  const errors = watchErrors(page);
  const mirror = new CoreMirror(SEED, PRESET);
  const clock = page.locator('#clock');
  const unit = page.locator('#bctx-unit');
  const info = page.locator('#binfo');

  await test.step('старт: стартовий екран → нова партія', async () => {
    await page.goto('./');
    await expect(page).toHaveTitle(/Рубіж/);
    const helpClose = page.locator('#btn-help-close'); // перший візит — «Як грати» поверх стартового екрана
    if (await helpClose.isVisible()) await helpClose.click();
    await page.locator('#btn-start-new').click();
    await page.locator('#new-game-seed').fill(String(SEED));
    await page.locator('#new-game-preset').selectOption(PRESET);
    await page.locator('#btn-new-game-start').click();
    await expect(page.locator('#geo')).toBeVisible();
    await expect(page.locator('#log')).toContainText('Нова партія (сід ' + SEED + ', складність «' + PRESET + '»)');
    await expect(clock).toHaveText(mirror.clock());
  });

  await test.step('геосцена: тіки до приземлення зонда', async () => {
    for (let i = 0; i < MAX_TICKS_TO_MISSION && mirror.targets().length === 0; i++) {
      await page.locator('#btn-tick').click();
      mirror.tick();
    }
    expect(mirror.targets().length, 'на сіді ' + SEED + ' зонд не приземлився за дві доби').toBeGreaterThan(0);
    await expect(clock).toHaveText(mirror.clock());
    await expect(page.locator('#ufos .ufo')).toHaveCount(mirror.detected().length);
    await expect(page.locator('#ufos button.mission')).toHaveCount(mirror.targets().length);
    // Т.7: дія чекає на вкладці «Вузол» — лічильник видно з вкладки «Загін»
    await expect(page.locator('#status-tab-base .tab-badge')).toBeVisible();
  });

  // Т.31: геосцена, журнал і колонка стану — в одному екрані; сторінка не
  // прокручується на жодній вкладці, журнал видно і він розгортається в межах вікна.
  await test.step('геосцена: екран без прокрутки, журнал у вікні', async () => {
    const fits = (): Promise<{ page: number; journal: number; log: number; win: number; map: number; gap: number }> =>
      page.evaluate(() => ({
        page: document.documentElement.scrollHeight,
        journal: document.getElementById('journal')!.getBoundingClientRect().bottom,
        log: document.getElementById('log')!.getBoundingClientRect().height,
        win: window.innerHeight,
        map: document.getElementById('geo')!.getBoundingClientRect().height,
        gap:
          document.getElementById('journal')!.getBoundingClientRect().top -
          document.getElementById('geo-panel')!.getBoundingClientRect().bottom,
      }));
    for (const tab of ['squad', 'base', 'system']) {
      await page.locator('#status-tab-' + tab).click();
      const m = await fits();
      expect(m.page, 'вкладка ' + tab + ': сторінка вища за вікно').toBeLessThanOrEqual(m.win);
      expect(m.journal, 'вкладка ' + tab + ': журнал нижче вікна').toBeLessThanOrEqual(m.win);
      expect(m.log, 'вкладка ' + tab + ': у журналі менше двох рядків').toBeGreaterThanOrEqual(40);
      expect(m.map, 'вкладка ' + tab + ': карта нижча за половину вікна').toBeGreaterThanOrEqual(m.win / 2);
      expect(m.gap, 'вкладка ' + tab + ': порожнеча між картою і журналом').toBeLessThanOrEqual(16);
    }
    await page.locator('#btn-log-expand').click();
    await expect(page.locator('#log-tab-econ')).toBeVisible();
    const open = await fits();
    expect(open.page).toBeLessThanOrEqual(open.win);
    expect(open.journal).toBeLessThanOrEqual(open.win);
    expect(open.log).toBeGreaterThanOrEqual(200);
    await page.locator('#btn-log-expand').click();
    await expect(page.locator('#log-tab-econ')).toBeHidden();
    await page.locator('#status-tab-squad').click();
  });

  // T.39 «Зрозуміла наука»: картка протоколу (назва, плашка, «Ціна», «Час ≈»), смуга кроків
  // («3. Видати» перемикає на «Загін»), лічильник на вкладці «Загін», розмір «Як грати» на 1366 × 768 і 1024 × 768.
  await test.step('T.39: панель «Дослідження», крок «3. Видати», довідка на 1366 × 768', async () => {
    await page.locator('#status-tab-base').click();
    const cards = page.locator('#research .sci-card');
    await expect(cards).toHaveCount(6);
    const armor = cards.first();
    await expect(armor.locator('.sci-name')).toHaveText('Композитна броня');
    await expect(armor.locator('.sci-badge')).toHaveText('потрібен техномант'); // техномантів 0, кредитів вистачає
    await expect(armor).toContainText('Ціна 96 кр.');
    await expect(armor).toContainText('Час ≈ 14 діб з одним техномантом, 7 — з двома'); // K = 0
    await expect(armor.locator('#btn-start-0')).toHaveText('Дослідити — 96 кр.');
    await expect(page.locator('#btn-hire-scientist')).toHaveText('Вербувати техноманта — 100 кр.');
    // смуга кроків: три кнопки; «3. Видати» перемикає вкладку на «Загін»
    await expect(page.locator('#btn-sci-step-1')).toBeEnabled();
    await expect(page.locator('#btn-sci-step-2')).toBeEnabled();
    await page.locator('#btn-sci-step-2').click();
    // крок 2: панель «Кузня» (#workshop) відображається всередині колонки #status
    await expect(page.locator('#workshop')).toBeVisible();
    const workshopInView = await page.evaluate(() => {
      const col = document.querySelector<HTMLElement>('#status')!.getBoundingClientRect();
      const w = document.querySelector<HTMLElement>('#workshop')!.getBoundingClientRect();
      return w.top >= col.top - 1 && w.bottom <= col.bottom + 1;
    });
    expect(workshopInView, '#workshop має бути у видимій частині колонки після кроку 2').toBe(true);
    // Т.43: причина неактивної кнопки — рядком під нею (на iPad підказки title не видно)
    await expect(page.locator('#btn-order-armor + .btn-why')).toHaveText('Ще не досліджено');
    // у «Кузні» причина — рядковий елемент одразу після кнопки (панель не росте на рядок
    // за кожну кнопку), кольором попередження Т.24. Чи вмістився текст на лінії кнопки,
    // залежить від шрифту машини (у CI переноситься) — тому перевіряється display, а не лінія.
    const whyBox = await page.evaluate(() => {
      const w = document.querySelector<HTMLElement>('#btn-order-armor + .btn-why')!;
      const st = getComputedStyle(w);
      return { display: st.display, color: st.color, pieces: w.getClientRects().length };
    });
    expect(whyBox.display, 'причина в «Кузні» має бути рядковим елементом після кнопки «Замовити»').toBe('inline');
    expect(whyBox.pieces, 'текст причини в «Кузні» розірвано між рядками').toBe(1);
    expect(whyBox.color, 'колір рядка-причини — як у попередження .mission-warn').toBe('rgb(224, 166, 58)');
    await page.locator('#btn-sci-step-3').click();
    await expect(page.locator('#status-tab-squad')).toHaveClass(/active/);
    // лічильник «Загін»: склад порожній — бейджа нема
    await expect(page.locator('#status-tab-squad .tab-badge')).toHaveCount(0);
    await page.locator('#status-tab-base').click();
    // «Як грати» на 1366 × 768: блок «Наука і спорядження» вміщується без прокрутки
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.locator('#btn-menu').click();
    await page.locator('#btn-menu-help').click();
    await expect(page.locator('#help-screen')).toBeVisible();
    await expect(page.locator('#help-screen')).toContainText('Наука і спорядження');
    const help = await page.evaluate(() => {
      const r = document.querySelector<HTMLElement>('#help-screen .help-box')!.getBoundingClientRect();
      return { h: Math.round(r.height), w: Math.round(r.width), win: window.innerHeight, page: document.documentElement.scrollHeight };
    });
    expect(help.h, 'екран «Як грати» вищий за вікно на 1366×768').toBeLessThanOrEqual(help.win - 32);
    expect(help.page, 'сторінка з довідкою довша за вікно на 1366×768').toBeLessThanOrEqual(help.win);
    await page.locator('#btn-help-close').click();
    // та сама перевірка довідки на 1024 × 768
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.locator('#btn-menu').click();
    await page.locator('#btn-menu-help').click();
    await expect(page.locator('#help-screen')).toBeVisible();
    await expect(page.locator('#help-screen')).toContainText('Наука і спорядження');
    const helpSmall = await page.evaluate(() => {
      const r = document.querySelector<HTMLElement>('#help-screen .help-box')!.getBoundingClientRect();
      return { h: Math.round(r.height), win: window.innerHeight, page: document.documentElement.scrollHeight };
    });
    expect(helpSmall.h, 'екран «Як грати» вищий за вікно на 1024×768').toBeLessThanOrEqual(helpSmall.win - 32);
    expect(helpSmall.page, 'сторінка з довідкою довша за вікно на 1024×768').toBeLessThanOrEqual(helpSmall.win);
    await page.locator('#btn-help-close').click();
    // Т.43: з третьою кнопкою часу шапка на 1024 × 768 лишається в один рядок
    // (кнопки часу на одній висоті з чипами), сторінка — у вікні
    const bar = await page.evaluate(() => {
      const top = (sel: string): number => Math.round(document.querySelector(sel)!.getBoundingClientRect().top);
      return {
        chips: top('#topbar .chips'),
        event: top('#btn-event'),
        page: document.documentElement.scrollHeight,
        win: window.innerHeight,
      };
    });
    expect(Math.abs(bar.event - bar.chips), 'кнопки часу з’їхали в другий рядок шапки на 1024×768').toBeLessThanOrEqual(8);
    // рядок «Наступний крок» на 1024 × 768: видимий, під кнопками й чипами, не обрізаний
    const stepSmall = await page.evaluate(() => {
      const s = document.getElementById('next-step')!;
      const bottom = (sel: string): number => document.querySelector(sel)!.getBoundingClientRect().bottom;
      const r = s.getBoundingClientRect();
      return {
        h: r.height,
        gap: r.top - Math.max(bottom('#topbar .chips'), bottom('#topbar .actions')),
        fits: s.scrollWidth <= s.clientWidth,
      };
    });
    expect(stepSmall.h, 'рядок «Наступний крок» не видно на 1024×768').toBeGreaterThan(0);
    expect(stepSmall.gap, 'рядок «Наступний крок» налазить на перший ряд шапки на 1024×768').toBeGreaterThanOrEqual(0);
    expect(stepSmall.fits, 'текст рядка «Наступний крок» обрізано на 1024×768').toBe(true);
    expect(bar.page, 'сторінка довша за вікно на 1024×768').toBeLessThanOrEqual(bar.win);
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  await test.step('Т.47: «Продовжити» після виходу з бою — сейв завантажено, старого бою немає', async () => {
    const saved = mirror.clock();
    await page.locator('#status-tab-system').click();
    await page.locator('#btn-save-1').click();
    await expect(page.locator('#log')).toContainText('Збережено: слот 1.');
    // тік і бій — лише на сторінці: дзеркало лишається на точці сейву, а годинник покинутої партії йде далі
    await page.locator('#btn-tick').click();
    await expect(clock).not.toHaveText(saved);
    await page.locator('#status-tab-base').click();
    await page.locator('#ufos button.mission').first().click();
    await expect(page.locator('#battle-panel')).toBeVisible();
    // Т.48: авто-бій запущено до виходу і справді йде — у журналі з'явились його рядки
    const logBeforeAuto = await page.locator('#log').innerHTML();
    await page.locator('#btn-auto-battle').click();
    await expect.poll(() => page.locator('#log').innerHTML(), { timeout: 15_000 }).not.toBe(logBeforeAuto);
    await page.locator('#btn-menu').click();
    await page.locator('#btn-menu-exit').click();
    await page.locator('#btn-exit-yes').click();
    await expect(page.locator('#start-screen')).toBeVisible();
    // Т.48: вихід зупиняє все — бій закрито вже на стартовому екрані, авто-бій далі не йде
    await expect(page.locator('#battle-panel')).toHaveClass(/hidden/);
    await expect(page.locator('#layout')).not.toHaveClass(/in-battle/);
    // три секунди на стартовому екрані (рядки авто-бою йдуть щонайрідше раз на ≈ 2 с): журнал
    // не змінюється і жоден цикл анімації (бій, геосцена, ambient) не планує кадрів
    const logAtExit = await page.locator('#log').innerHTML();
    const frames = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          let n = 0;
          const orig = window.requestAnimationFrame;
          window.requestAnimationFrame = (cb) => {
            n++;
            return orig.call(window, cb);
          };
          setTimeout(() => {
            window.requestAnimationFrame = orig;
            resolve(n);
          }, 3000);
        })
    );
    expect(frames, 'після виходу на стартовий екран хтось планує кадри анімації').toBe(0);
    expect(await page.locator('#log').innerHTML(), 'журнал змінився після виходу на стартовий екран').toBe(logAtExit);
    await page.locator('#btn-start-continue').click();
    await expect(page.locator('#start-screen')).toBeHidden();
    await expect(page.locator('#battle-panel')).toBeHidden();
    await expect(page.locator('#geo-panel')).toBeVisible();
    await expect(page.locator('#next-step')).toBeVisible();
    await expect(clock).toHaveText(saved);
    await expect(page.locator('#log')).toContainText('Завантажено: слот 1 — ' + saved);
  });

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

  await test.step('запуск місії', async () => {
    const mission = mirror.launch(mirror.targets()[0].id);
    await page.locator('#status-tab-base').click();
    await page.locator('#ufos button.mission').first().click();
    await expect(page.locator('#battle-panel')).toBeVisible();
    await expect(page.locator('#bctx-kind')).toHaveText(mission.briefing.kind);
    await expect(page.locator('#next-step')).toBeHidden(); // Т.43: у бою рядка «Наступний крок» немає
    await expect(page.locator('#bctx-turn')).toHaveText('хід 1 · загін');
    await expect(unit).toHaveText('не вибраний');
    // Т.32: розкладка бою на трьох розмірах вікна (журнал збоку / смугою)
    // Т.33: ціна в AP і клавіша — у кутках плиток дій
    // Т.71: плитка «Евакуація» — 2 AP, клавіша V
    await expect(page.locator('#btoolbar .tb-key')).toHaveText(['1', '2', '3', 'O', 'M', 'G', 'V', 'E']);
    await expect(page.locator('#btoolbar .tb-ap')).toHaveText(['3 AP', '5 AP', '4 AP', '3 AP', '4 AP', '4 AP', '2 AP']); // snap, aimed, auto, дозор, гель, граната, евакуація
    // Т.44: туман знебарвлено — у клітинках туману (без стіни, декору, юніта і м'якого краю) середній розкид
    // каналів max(R,G,B) − min(R,G,B) у центральній ділянці 24 × 24 px не більший за 9 (до Т.44 — 13,6–18,3);
    // видимі клітинки кольорові. Пікселі канви від шрифту машини не залежать.
    const seen = mirror.seen();
    const st = mirror.state;
    const plain = (x: number, y: number): boolean =>
      !st.map.blocked.has(x + ',' + y) && cellHash(x, y) % 37 > 2 && !st.units.some((u) => u.pos.x === x && u.pos.y === y);
    const inSeen = (x: number, y: number): boolean => seen.has(x + ',' + y);
    const fogCells: Vec2[] = [];
    const seenCells: Vec2[] = [];
    for (let y = 0; y < MISSION_MAP_H; y++)
      for (let x = 0; x < MISSION_MAP_W; x++) {
        if (!plain(x, y)) continue;
        if (inSeen(x, y)) seenCells.push({ x, y });
        else if (!inSeen(x - 1, y) && !inSeen(x + 1, y) && !inSeen(x, y - 1) && !inSeen(x, y + 1)) fogCells.push({ x, y });
      }
    expect(fogCells.length).toBeGreaterThan(20);
    expect(seenCells.length).toBeGreaterThan(20);
    const spread = (cells: Vec2[]): Promise<number[]> =>
      page.evaluate((cs) => {
        const cv = document.getElementById('battle') as HTMLCanvasElement;
        const d = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height).data;
        return cs.map((c) => {
          let sum = 0;
          for (let y = c.y * 48 + 12; y < c.y * 48 + 36; y++)
            for (let x = c.x * 48 + 12; x < c.x * 48 + 36; x++) {
              const i = (y * cv.width + x) * 4;
              sum += Math.max(d[i]!, d[i + 1]!, d[i + 2]!) - Math.min(d[i]!, d[i + 1]!, d[i + 2]!);
            }
          return sum / (24 * 24);
        });
      }, cells);
    await expect.poll(async () => Math.max(...(await spread(fogCells))), { message: 'Т.44: туман знебарвлено' }).toBeLessThanOrEqual(9);
    const seenSpread = await spread(seenCells);
    expect(seenSpread.reduce((a, v) => a + v, 0) / seenSpread.length, 'Т.44: видимі клітинки кольорові').toBeGreaterThan(12);
    await expectBattleFits(page, '1440 × 900', 740);
    await page.setViewportSize({ width: 1366, height: 768 });
    await expectBattleFits(page, '1366 × 768', 640);
    await page.setViewportSize({ width: 1024, height: 768 });
    await expectBattleFits(page, '1024 × 768', 540);
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  await test.step('бій: вибрати юніта → рух (тап-тап)', async () => {
    const soldier = mirror.squad()[0];
    // Т.44: зона ходу — на пікселях канви. Середній зелений канал центральної ділянки 24 × 24 px кожної клітинки
    // до і після вибору оперативника: заливка зони rgba(127,226,160,0.09) піднімає його щонайменше на 2 (на сіді сценарію — від 9,2),
    // поза зоною він не міняється. Множина таких клітинок дорівнює зоні з дзеркала (findPath до кожної клітинки).
    const greens = (): Promise<number[]> =>
      page.evaluate(() => {
        const cv = document.getElementById('battle') as HTMLCanvasElement;
        const d = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height).data;
        const out: number[] = [];
        for (let cy = 0; cy < cv.height / 48; cy++)
          for (let cx = 0; cx < cv.width / 48; cx++) {
            let sum = 0;
            for (let y = cy * 48 + 12; y < cy * 48 + 36; y++)
              for (let x = cx * 48 + 12; x < cx * 48 + 36; x++) sum += d[(y * cv.width + x) * 4 + 1]!;
            out.push(sum / (24 * 24));
          }
        return out;
      });
    const before = await greens();
    await tap(page, soldier.pos);
    await expect(unit).toHaveText(unitLine(soldier));
    const reach = mirror.reach(soldier);
    expect(reach.size, 'Т.44: зона першого оперативника на старті (сід сценарію, 10 AP)').toBeGreaterThan(40);
    const drawn = async (): Promise<string> => {
      const after = await greens();
      const cells: string[] = [];
      after.forEach((g, i) => {
        const x = i % MISSION_MAP_W;
        const y = Math.floor(i / MISSION_MAP_W);
        // клітинки загону не рахуються: рамка вибору і спрайт міняють їхні пікселі, у зоні їх немає
        if (g - before[i]! >= 2 && !mirror.squad().some((u) => u.pos.x === x && u.pos.y === y)) cells.push(x + ',' + y);
      });
      return cells.sort().join(' ');
    };
    await expect.poll(drawn, { message: 'Т.44: зона ходу на канві = зона з дзеркала' }).toBe([...reach].sort().join(' '));
    // Т.33: причина під неактивною плиткою — у загоні на старті немає гелю
    await expect(page.locator('#btn-medkit .tb-cap')).toHaveText('немає гелю');
    // ADR-0081: демон у тумані не видає себе — тап по його клітинці дає те
    // саме прев'ю шляху, що й по порожній невидимій
    const probe = mirror.fogProbe(soldier);
    await tap(page, probe.cell);
    await expect(info).toContainText(probe.hint);
    const option = mirror.moveOption(soldier);
    await tap(page, option.cell); // перший тап — прев'ю шляху
    await expect(info).toContainText('Шлях: ' + option.cost + ' AP');
    // Т.44: шлях — лінією на пікселях канви. Зелені (G помітно більший за R і B; колір лінії rgba(127,226,160,0.95)):
    // центр цілі (коло) і середина кожного відрізка від оперативника через клітинки шляху — крім точок під плашкою ціни
    // (над ціллю, а у верхньому рядку — під нею). Від шрифту не залежить.
    const centers = [soldier.pos, ...option.path].map((c) => ({ x: c.x * 48 + 24, y: c.y * 48 + 24 }));
    const goal = centers[centers.length - 1]!;
    const underLabel = (p: { x: number; y: number }): boolean => {
      const top = goal.y - 34 < 2 ? goal.y + 12 : goal.y - 34;
      return Math.abs(p.x - goal.x) <= 40 && p.y >= top - 2 && p.y <= top + 23;
    };
    const points = [goal];
    for (let i = 1; i < centers.length; i++) {
      const m = { x: (centers[i - 1]!.x + centers[i]!.x) / 2, y: (centers[i - 1]!.y + centers[i]!.y) / 2 };
      if (!underLabel(m)) points.push(m);
    }
    const greenAt = (): Promise<boolean[]> =>
      page.evaluate((ps) => {
        const cv = document.getElementById('battle') as HTMLCanvasElement;
        const cx = cv.getContext('2d')!;
        return ps.map((p) => {
          const d = cx.getImageData(p.x, p.y, 1, 1).data;
          return d[1]! - d[0]! > 40 && d[1]! - d[2]! > 25;
        });
      }, points);
    await expect.poll(greenAt, { message: 'Т.44: шлях лінією — точки ' + JSON.stringify(points) }).toEqual(points.map(() => true));
    // Т.45: зведений постріл ховає прев'ю шляху — ті самі точки більше не зелені, наведення на ціль
    // його не повертає і підказку режиму не переписує; Esc знімає режим, тап знову дає прев'ю
    await page.keyboard.press('Digit1');
    await expect(page.locator('#btn-snap')).toHaveClass(/armed/);
    const armedHint = await info.textContent();
    // миша ще стоїть на цілі після тапу: шлях ховає сама умова малювання, без жодного наведення
    await expect.poll(greenAt, { message: 'Т.45: одразу після зведення шляху немає' }).toEqual(points.map(() => false));
    await page.locator('#battle').hover({ position: { x: 3, y: 3 } });
    const box = (await page.locator('#battle').boundingBox())!;
    const goalCell = option.path[option.path.length - 1]!;
    await page.locator('#battle').hover({
      position: { x: ((goalCell.x + 0.5) * box.width) / MISSION_MAP_W, y: ((goalCell.y + 0.5) * box.height) / MISSION_MAP_H },
    });
    await expect.poll(greenAt, { message: 'Т.45: у режимі пострілу шляху немає' }).toEqual(points.map(() => false));
    await expect(info).toHaveText(armedHint ?? '');
    await page.keyboard.press('Escape');
    await tap(page, option.cell); // режим знято: перший тап — знову прев'ю
    await expect(info).toContainText('Шлях: ' + option.cost + ' AP');
    await expect.poll(greenAt, { message: 'Т.45: після Esc шлях повернувся' }).toEqual(points.map(() => true));
    await tap(page, option.cell); // повторний тап — хід
    mirror.move(soldier, option);
    await expect(info).toContainText(soldier.name + ': рух.');
    await expect(unit).toHaveText(unitLine(soldier));
  });

  await test.step('бій: дозор → кінець ходу (хід демонів)', async () => {
    const guard = mirror.squad()[1];
    await tap(page, guard.pos);
    await expect(unit).toHaveText(unitLine(guard));
    await page.locator('#btn-ow').click();
    mirror.overwatch(guard);
    await expect(info).toContainText(guard.name + ' у дозорі');
    await expect(unit).toHaveText(unitLine(guard));

    const actions = await endTurnOnPage(page, mirror);
    expect(mirror.outcome(), 'бій скінчився в перший хід демонів').toBe('триває');
    await expectBattleFits(page, 'підсумок ходу демонів', 740);
    await expect(info).toContainText('Хід демонів Розриву відпрацьовано (' + actions + ' дій)');
    await expect(page.locator('#bctx-turn')).toHaveText('хід ' + mirror.state.turn + ' · загін');
    await expectSquad(page, mirror);
    await expect(page.locator('#bturn')).toBeHidden(); // перша дія гравця прибирає підсумок
  });

  await test.step('бій: постріл у видиму ціль (тап-тап)', async () => {
    let shot = mirror.shotOption('snap');
    for (let i = 0; i < MAX_TURNS_TO_TARGET && shot === null; i++) {
      await endTurnOnPage(page, mirror);
      expect(mirror.outcome(), 'бій скінчився до першого пострілу загону').toBe('триває');
      await expectSquad(page, mirror);
      shot = mirror.shotOption('snap');
    }
    if (shot === null) throw new Error('За ' + MAX_TURNS_TO_TARGET + ' ходів жоден демон не вийшов на лінію вогню');
    await tap(page, shot.shooter.pos);
    await expect(unit).toHaveText(unitLine(shot.shooter));
    await page.locator('#btn-snap').click();
    await expect(info).toContainText('~' + shot.chancePct + '%');
    await tap(page, shot.target.pos); // перший тап — шанс влучання
    await expect(info).toContainText('повторний тап у цю саму ціль — постріл');
    await tap(page, shot.target.pos); // повторний тап — постріл
    mirror.shoot(shot, 'snap');
    if (mirror.outcome() !== 'триває') return;
    await expect(unit).toHaveText(unitLine(shot.shooter));
    if (shot.target.alive && mirror.sees(shot.target)) {
      await tap(page, shot.target.pos); // без зведеного режиму — характеристики демона: HP після пострілу
      await expect(info).toContainText(enemyLine(shot.target));
    }
  });

  await test.step('бій: авто-бій до результату → повернення на геосцену', async () => {
    if (mirror.outcome() === 'триває') {
      // Т.46: зведений постріл авто-бій знімає — плитка не лишається зведеною (стан бою зведення не міняє)
      await page.keyboard.press('Digit1');
      await expect(page.locator('#btn-snap')).toHaveClass(/armed/);
      await page.locator('#btn-auto-battle').click();
      await expect(page.locator('#btn-snap')).not.toHaveClass(/armed/);
      mirror.autoBattle();
    }
    const turns = mirror.state.turn;
    const aliens = mirror.state.units.filter((u) => u.side === 'alien');
    const banner = mirror.finish();
    await expect(page.locator('#bresult .banner')).toHaveText(banner, { timeout: AUTO_BATTLE_TIMEOUT_MS });
    // Т.33: картка результату — хід і знищені демони, як у дзеркалі
    await expect(page.locator('#bresult .rrow').nth(0)).toHaveText('Ходів' + turns);
    await expect(page.locator('#bresult .rrow').nth(1)).toHaveText(
      'Демонів знищено' + aliens.filter((u) => !u.alive).length + ' з ' + aliens.length
    );
    await expectBattleFits(page, 'результат бою', 740);
    await page.locator('#btn-close').click();
    await expect(page.locator('#geo-panel')).toBeVisible();
    await expect(page.locator('#battle-panel')).toBeHidden();
    // відбиток бою в ростері: хто вижив, HP і вбивства кожного — як у дзеркалі
    await expect(page.locator('#roster .soldier')).toHaveText(mirror.rosterRows());
    await expect(page.locator('#ready')).toHaveText(mirror.readyChip());
  });

  await test.step('геосцена: +1 тік, +1 доба', async () => {
    await page.locator('#btn-tick').click();
    mirror.tick();
    await expect(clock).toHaveText(mirror.clock());
    // Т.43: «+1 доба» зупиняється на виявленні й приземленні зонда, «До події» —
    // на першій події; дзеркало рухається за тим самим правилом (mirror.ts).
    // Т.43: рядок «Наступний крок» — текст за станом дзеркала (цілі місії, зонди в повітрі)
    const stepText = (): string => {
      const landed = mirror.targets().filter((u) => u.status === 'приземлився');
      if (landed.length > 0) {
        const hours = (Math.min(...landed.map((u) => u.landedTicksLeft)) * TICK_MINUTES) / 60;
        return 'Наступний крок: зонд приземлився — запустіть місію (вікно ' + hours + ' год)';
      }
      if (mirror.detected().some((u) => u.status === 'летить'))
        return 'Наступний крок: зонд у повітрі — перехопіть або чекайте приземлення';
      return 'Наступний крок: рухайте час — сенсорна сітка шукає зонди';
    };
    await expect(page.locator('#next-step')).toHaveText(stepText());
    // рядок — другим рядком шапки на всю її ширину, текст не обрізано
    const stepBox = await page.evaluate(() => {
      const s = document.getElementById('next-step')!;
      const r = s.getBoundingClientRect();
      const chips = document.querySelector('#topbar .chips')!.getBoundingClientRect();
      return {
        below: r.top >= chips.bottom,
        wide: r.width / document.getElementById('topbar')!.getBoundingClientRect().width,
        fits: s.scrollWidth <= s.clientWidth,
      };
    });
    expect(stepBox.below, 'рядок «Наступний крок» має бути під чипами шапки').toBe(true);
    expect(stepBox.wide, 'рядок «Наступний крок» — на всю ширину шапки').toBeGreaterThan(0.9);
    expect(stepBox.fits, 'текст рядка «Наступний крок» обрізано').toBe(true);
    await page.locator('#btn-day').click();
    const dayTicks = mirror.dayWithStops();
    await expect(page.locator('#next-step')).toHaveText(stepText());
    await expect(clock).toHaveText(mirror.clock());
    await expect(page.locator('#btn-event')).toHaveText('До події');
    await page.locator('#btn-event').click();
    const eventTicks = mirror.toEvent();
    await expect(clock).toHaveText(mirror.clock());
    // пробіл на геосцені — завжди «До події»: і з фокусом на «До події» (один раз, не двічі),
    // і після кліку «+1 тік», коли фокус лишився на ній (не ще один тік)
    await page.keyboard.press('Space');
    mirror.toEvent();
    await expect(clock).toHaveText(mirror.clock());
    await page.locator('#btn-tick').click();
    mirror.tick();
    await page.keyboard.press('Space');
    const spaceTicks = mirror.toEvent();
    await expect(clock).toHaveText(mirror.clock());
    expect(spaceTicks, 'пробіл після «+1 тік» має пройти більше одного тіку — інакше крок не відрізняє його від кнопки').toBeGreaterThan(1);
    // на сіді сценарію хоч одна з двох кнопок стає раніше за добу — інакше крок нічого не перевіряє
    expect(Math.min(dayTicks, eventTicks), 'зупинка на події раніше за 48 тіків').toBeLessThan(TICKS_PER_DAY);
    await expect(page.locator('#ufos .ufo')).toHaveCount(mirror.detected().length);
    await expect(page.locator('#ready')).toHaveText(mirror.readyChip()); // лікарня тікає разом з геосценою
  });

  await test.step('сейв → лоад', async () => {
    const saved = mirror.clock();
    await page.locator('#status-tab-system').click();
    await page.locator('#btn-save-1').click();
    await expect(page.locator('#log')).toContainText('Збережено: слот 1.');
    await page.locator('#btn-tick').click();
    mirror.tick();
    await expect(clock).toHaveText(mirror.clock());
    await page.locator('#btn-load-1').click();
    await expect(clock).toHaveText(saved);
    await expect(page.locator('#log')).toContainText('Завантажено: слот 1 — ' + saved);
  });

  expect(errors, 'помилки сторінки: ' + errors.join(' | ')).toEqual([]);
});

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
