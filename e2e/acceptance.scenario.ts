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

// Стан загону на сторінці = стан у дзеркалі: вибираємо кожного живого
// оперативника і звіряємо його рядок HP/AP. Після ходу демонів це ловить
// розбіжність у їхніх пострілах і реакційному вогні дозору.
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

  await test.step('запуск місії', async () => {
    const mission = mirror.launch(mirror.targets()[0].id);
    await page.locator('#status-tab-base').click();
    await page.locator('#ufos button.mission').first().click();
    await expect(page.locator('#battle-panel')).toBeVisible();
    await expect(page.locator('#bctx-kind')).toHaveText(mission.briefing.kind);
    await expect(page.locator('#bctx-turn')).toHaveText('хід 1 · загін');
    await expect(unit).toHaveText('не вибраний');
  });

  await test.step('бій: вибрати юніта → рух (тап-тап)', async () => {
    const soldier = mirror.squad()[0];
    await tap(page, soldier.pos);
    await expect(unit).toHaveText(unitLine(soldier));
    // ADR-0081: демон у тумані не видає себе — тап по його клітинці дає те
    // саме прев'ю шляху, що й по порожній невидимій
    const probe = mirror.fogProbe(soldier);
    await tap(page, probe.cell);
    await expect(info).toContainText(probe.hint);
    const option = mirror.moveOption(soldier);
    await tap(page, option.cell); // перший тап — прев'ю шляху
    await expect(info).toContainText('Шлях: ' + option.cost + ' AP');
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

    await page.locator('#btn-end').click();
    const actions = mirror.endPlayerTurn();
    expect(mirror.outcome(), 'бій скінчився в перший хід демонів').toBe('триває');
    await expect(info).toContainText('Хід демонів Розриву відпрацьовано (' + actions + ' дій)');
    await expect(page.locator('#bctx-turn')).toHaveText('хід ' + mirror.state.turn + ' · загін');
    await expectSquad(page, mirror);
  });

  await test.step('бій: постріл у видиму ціль (тап-тап)', async () => {
    let shot = mirror.shotOption('snap');
    for (let i = 0; i < MAX_TURNS_TO_TARGET && shot === null; i++) {
      await page.locator('#btn-end').click();
      mirror.endPlayerTurn();
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
      await page.locator('#btn-auto-battle').click();
      mirror.autoBattle();
    }
    const banner = mirror.finish();
    await expect(page.locator('#bresult .banner')).toHaveText(banner, { timeout: AUTO_BATTLE_TIMEOUT_MS });
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
    await page.locator('#btn-day').click();
    mirror.tick(TICKS_PER_DAY);
    await expect(clock).toHaveText(mirror.clock());
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
