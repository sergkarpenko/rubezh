// e2e/smoke.spec.ts
// Домен-смок прев'ю (ADR-0063): сторінка жива як документ, а не лише HTTP 200
// (ADR-0062). Одна сторона = один смок-прогін; твердження — «відкривається,
// заголовок проекту, стартовий екран → нова партія → канвас видимий, нуль
// помилок сторінки» (П12.2: партія не створюється до вибору гравця, тож
// канва з'являється лише після старту партії). Візуальну коректність далі
// валідує власник у браузері — смок її не замінює.
import { expect, test } from '@playwright/test';

test('сторінка відкривається: стартовий екран → нова партія → канвас, без помилок сторінки', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  // Ціль — повний URL з SMOKE_URL (прев'ю у CI, локально може бути file://);
  // без env — відносний '/' від baseURL (локальний статичний сервер).
  const response = await page.goto(process.env.SMOKE_URL ?? '/');
  // 200 — мережева ціль (прев'ю у CI); 0 — локальний прогін з file://
  // (HTTP-наявність сторінки окремо тримає смок ADR-0062).
  expect([200, 0]).toContain(response?.status() ?? -1);

  await expect(page).toHaveTitle(/Рубіж/);
  // П9.1: перший візит — «Як грати» поверх стартового екрана; закриваємо його
  const helpClose = page.locator('#btn-help-close');
  if (await helpClose.isVisible()) await helpClose.click();
  // П12.2 (ADR-0065): стартовий екран → діалог нової партії → ігровий екран
  await expect(page.locator('#start-logo')).toBeVisible();
  await page.locator('#btn-start-new').click();
  await expect(page.locator('#new-game-dialog')).toBeVisible();
  await page.locator('#btn-new-game-start').click();
  await expect(page.locator('canvas').first()).toBeVisible();

  expect(errors, `помилки сторінки: ${errors.join(' | ')}`).toEqual([]);
});
