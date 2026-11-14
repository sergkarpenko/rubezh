// Т.30 (docs/reports/t30-ux-review.md): прохід гри зі знімками екранів на трьох розмірах вікна.
// Не входить у npm test, test:smoke і test:e2e (тека docs/ поза їхніми глобами); код гри не чіпає.
// Запуск із кореня репозиторію, збірка піднята окремо (npm run build && npx vite preview --port 4173 --strictPort):
//   T30_OUT=/tmp/t30-shots/ E2E_CHROME=/шлях/до/chrome npx playwright test -c docs/reports/t30/pw.config.ts
// Дзеркало ядра (e2e/mirror.ts) веде прохід до кінця бою; далі кроки йдуть за станом сторінки.
import { expect, test, type Page } from '@playwright/test';
import { TICK_MINUTES } from '../../../src/core/geo';
import { MISSION_MAP_H, MISSION_MAP_W } from '../../../src/core/mission';
import type { Vec2 } from '../../../src/core/combat';
import { CoreMirror } from '../../../e2e/mirror';

const SEED = 42;
const PRESET = 'норма';
const TICKS_PER_DAY = 1440 / TICK_MINUTES;
const OUT = process.env.T30_OUT ?? '/tmp/t30-shots/';
const notes: string[] = [];

async function tap(page: Page, cell: Vec2): Promise<void> {
  const canvas = page.locator('#battle');
  const box = await canvas.boundingBox();
  if (box === null) throw new Error('Канва бою не відображається');
  await canvas.click({
    position: { x: ((cell.x + 0.5) * box.width) / MISSION_MAP_W, y: ((cell.y + 0.5) * box.height) / MISSION_MAP_H },
  });
}

test('знімки екранів', async ({ page }, info) => {
  const proj = info.project.name;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.location().url.endsWith('/favicon.ico')) errors.push(m.text());
  });
  const shot = async (name: string, full = false): Promise<void> => {
    await page.waitForTimeout(250);
    await page.screenshot({ path: OUT + name + '-' + proj + '.png' });
    if (full) {
      const h = await page.evaluate(() => document.documentElement.scrollHeight);
      const vh = page.viewportSize()!.height;
      notes.push(proj + ' ' + name + ' висота сторінки ' + h + ' (вікно ' + vh + ')');
      if (h > vh + 4) await page.screenshot({ path: OUT + name + '-' + proj + '-full.png', fullPage: true });
    }
  };
  const mirror = new CoreMirror(SEED, PRESET);

  await page.goto('./');
  await page.waitForTimeout(600);
  await shot('01-help-first-visit');
  await page.locator('#btn-help-close').click();
  await shot('02-start');
  await page.locator('#btn-start-settings').click();
  await shot('03-settings');
  await page.locator('#settings-close').click();
  await page.locator('#btn-start-new').click();
  await shot('04-new-game');
  await page.locator('#new-game-seed').fill(String(SEED));
  await page.locator('#new-game-preset').selectOption(PRESET);
  await page.locator('#btn-new-game-start').click();
  await expect(page.locator('#geo')).toBeVisible();
  await page.waitForTimeout(500);
  await page.locator('#status-tab-squad').click();
  await shot('05-geo-squad', true);
  await page.locator('#status-tab-base').click();
  await shot('06-geo-base', true);
  await page.locator('#status-tab-system').click();
  await shot('07-geo-system', true);
  await page.locator('#status-tab-squad').click();

  // тіки до приземлення зонда
  for (let i = 0; i < 2 * TICKS_PER_DAY && mirror.targets().length === 0; i++) {
    await page.locator('#btn-tick').click();
    mirror.tick();
  }
  await shot('08-geo-probe-squad-tab', true);
  await page.locator('#status-tab-base').click();
  await shot('09-geo-probe-base-tab', true);

  // місія
  mirror.launch(mirror.targets()[0].id);
  await page.locator('#ufos button.mission').first().click();
  await expect(page.locator('#battle-panel')).toBeVisible();
  await page.waitForTimeout(600);
  await shot('10-battle-start', true);
  const soldier = mirror.squad()[0];
  await tap(page, soldier.pos);
  await shot('11-battle-unit-selected');
  const option = mirror.moveOption(soldier);
  await tap(page, option.cell);
  await shot('12-battle-path-preview');
  await tap(page, option.cell);
  mirror.move(soldier, option);
  await page.waitForTimeout(500);
  const guard = mirror.squad()[1];
  await tap(page, guard.pos);
  await page.locator('#btn-ow').click();
  mirror.overwatch(guard);
  await shot('13-battle-overwatch');
  await page.locator('#btn-end').click();
  await page.waitForTimeout(120);
  await page.screenshot({ path: OUT + '14-battle-demons-turn-' + proj + '.png' });
  mirror.endPlayerTurn();
  await page.waitForTimeout(1500);
  await shot('15-battle-turn2');
  let shotOpt = mirror.shotOption('snap');
  for (let i = 0; i < 6 && shotOpt === null && mirror.outcome() === 'триває'; i++) {
    await page.locator('#btn-end').click();
    mirror.endPlayerTurn();
    await page.waitForTimeout(1200);
    shotOpt = mirror.shotOption('snap');
  }
  if (shotOpt !== null && mirror.outcome() === 'триває') {
    await tap(page, shotOpt.shooter.pos);
    await page.locator('#btn-snap').click();
    await shot('16-battle-shot-mode');
    await tap(page, shotOpt.target.pos);
    await shot('17-battle-shot-confirm');
    await tap(page, shotOpt.target.pos);
    mirror.shoot(shotOpt, 'snap');
    await page.waitForTimeout(150);
    await page.screenshot({ path: OUT + '18-battle-shot-fired-' + proj + '.png' });
    await page.waitForTimeout(800);
    await shot('19-battle-after-shot', true);
  } else notes.push(proj + ': пострілу не було');
  if (mirror.outcome() === 'триває') {
    await page.locator('#btn-auto-battle').click();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: OUT + '20-battle-auto-' + proj + '.png' });
  }
  await expect(page.locator('#bresult .banner')).toBeVisible({ timeout: 180_000 });
  await shot('21-battle-result', true);
  await page.locator('#btn-close').click();
  await expect(page.locator('#geo-panel')).toBeVisible();
  await page.locator('#status-tab-squad').click();
  await shot('22-geo-after-battle-squad', true);
  await page.locator('#log-tab-battle').click();
  await page.locator('#journal').scrollIntoViewIfNeeded();
  await shot('23-journal-battle');
  await page.locator('#log-tab-all').click();
  await page.evaluate(() => window.scrollTo(0, 0));

  // наука: техномант і протокол броні
  await page.locator('#status-tab-base').click();
  const hireSci = page.locator('#btn-hire-scientist');
  if (await hireSci.isEnabled()) await hireSci.click();
  const startArmor = page.locator('#btn-start-0');
  if (await startArmor.isEnabled()) await startArmor.click();
  else notes.push(proj + ': протокол броні не стартував (кнопка неактивна)');
  await page.locator('#research').scrollIntoViewIfNeeded();
  await shot('24-research-started');
  await page.evaluate(() => window.scrollTo(0, 0));

  // повітряний бій: перехоплюємо кожен зонд у повітрі, доки не дійде до дистанцій
  let air = false;
  let pursuitShot = false;
  let lastStatus = '';
  for (let i = 0; i < 10 * TICKS_PER_DAY && !air; i++) {
    const status = (await page.locator('#fighter').innerText()).split('\n')[0];
    if (status !== lastStatus) {
      notes.push(proj + ' перехоплювач: ' + status + ' @ ' + (await page.locator('#clock').innerText()));
      lastStatus = status;
    }
    if ((await page.locator('button.intercept-range').count()) > 0) {
      air = true;
      break;
    }
    const ib = page.locator('#ufos button.intercept:not([disabled])').first();
    if ((await ib.count()) > 0) {
      if (!pursuitShot) await shot('25-geo-probe-in-air', true);
      await ib.click();
      if (!pursuitShot) await shot('26-air-pursuit', true);
      pursuitShot = true;
      continue;
    }
    await page.locator('#btn-tick').click();
  }
  if (air) {
    await shot('27-air-battle', true);
    for (let r = 0; r < 12 && (await page.locator('button.intercept-range').count()) > 0; r++) {
      await page.locator('button.intercept-range').nth(1).click();
      if (r === 0) await shot('28-air-battle-round');
    }
    await shot('29-air-battle-after', true);
    await page.locator('#log-tab-geo').click();
    await page.locator('#journal').scrollIntoViewIfNeeded();
    await shot('29b-journal-geo');
    await page.locator('#log-tab-all').click();
    await page.evaluate(() => window.scrollTo(0, 0));
  } else notes.push(proj + ': до дистанцій повітряного бою не дійшло');

  // кузня: дні до завершення протоколу
  for (let d = 0; d < 16; d++) {
    if ((await page.locator('#workshop button[id^="btn-order-"]:not([disabled])').count()) > 0) break;
    await page.locator('#btn-day').click();
  }
  await page.locator('#research').scrollIntoViewIfNeeded();
  await shot('30-research-later');
  const order = page.locator('#workshop button[id^="btn-order-"]:not([disabled])').first();
  if ((await order.count()) > 0) {
    await order.click();
    await page.locator('#workshop').scrollIntoViewIfNeeded();
    await shot('31-workshop-order');
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot('32-geo-base-midgame', true);
  } else notes.push(proj + ': замовлення в кузні недоступне за 16 діб');
  await page.evaluate(() => window.scrollTo(0, 0));

  // меню, налаштування, вихід, довідка, сейв
  await page.locator('#btn-menu').click();
  await shot('33-menu');
  await page.locator('#btn-menu-settings').click();
  await shot('34-settings-ingame');
  await page.locator('#settings-close').click();
  if (!(await page.locator('#btn-menu-exit').isVisible())) await page.locator('#btn-menu').click();
  await page.locator('#btn-menu-exit').click();
  await shot('35-exit-confirm');
  await page.locator('#btn-exit-no').click();
  if (await page.locator('#btn-menu-close').isVisible()) await page.locator('#btn-menu-close').click();
  await page.locator('#btn-help').click();
  await shot('36-help-ingame');
  await page.locator('#btn-help-close').click();
  await page.locator('#status-tab-system').click();
  await page.locator('#btn-save-1').click();
  await shot('37-save-slot', true);
  await page.locator('#btn-tick').click();
  await page.locator('#btn-load-1').click();
  await shot('38-after-load', true);
  await page.locator('#status-tab-squad').click();
  await shot('39-squad-midgame', true);

  // до кінця кампанії
  for (let d = 0; d < 34; d++) {
    if (await page.locator('#campaign-victory').isVisible()) break;
    if (!(await page.locator('#btn-day').isEnabled())) break;
    await page.locator('#btn-day').click();
  }
  await shot('40-campaign-end', true);
  notes.push(proj + ' помилки консолі: ' + errors.length + (errors.length ? ' ' + errors.join(' | ') : ''));
  console.log(notes.join('\n'));
});
