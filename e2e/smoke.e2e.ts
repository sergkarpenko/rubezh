// e2e/smoke.spec.ts
// Домен-смок прев'ю (ADR-0063): сторінка жива як документ, а не лише HTTP 200
// (ADR-0062). Одна сторона = один смок-прогін; твердження — «відкривається,
// заголовок проекту, канвас видимий, нуль помилок сторінки». Візуальну
// коректність далі валідує власник у браузері — смок її не замінює.
import { expect, test } from '@playwright/test';

test('сторінка відкривається: заголовок, канвас, без помилок сторінки', async ({ page }) => {
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
  await expect(page.locator('canvas').first()).toBeVisible();

  expect(errors, `помилки сторінки: ${errors.join(' | ')}`).toEqual([]);
});
