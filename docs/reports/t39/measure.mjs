// docs/reports/t39/measure.mjs — виміри розкладки «до»/«після» Т.39 (план: 1366×768 і 1024×768,
// getBoundingClientRect панелі «Дослідження», колонки стану і екрана «Як грати»).
// Запуск з кореня репо: node docs/reports/t39/measure.mjs <url> <label> [outDir]
//   напр.: node docs/reports/t39/measure.mjs http://localhost:4174/rubezh/ do /tmp/t39-do
//   після: node docs/reports/t39/measure.mjs http://localhost:4173/rubezh/ pislya docs/reports/t39
// Браузер: E2E_CHROME=<шлях до chrome> (як у playwright.e2e.config.ts), інакше — bundled chromium.
// Знімки пишуться у outDir (якщо заданий); «після» — архівуються в docs/reports/t39/.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const [url, label, out] = process.argv.slice(2);
if (!url || !label) {
  console.error('usage: node docs/reports/t39/measure.mjs <url> <label> [outDir]');
  process.exit(2);
}
if (out) mkdirSync(out, { recursive: true });
const browser = await chromium.launch(process.env.E2E_CHROME ? { executablePath: process.env.E2E_CHROME } : {});
for (const [name, w, h] of [
  ['1366x768', 1366, 768],
  ['1024x768', 1024, 768],
]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto(url);
  const helpClose = page.locator('#btn-help-close');
  if (await helpClose.isVisible()) await helpClose.click();
  await page.locator('#btn-start-new').click();
  await page.locator('#new-game-seed').fill('42');
  await page.locator('#btn-new-game-start').click();
  await page.locator('#status-tab-base').click();
  await page.waitForTimeout(300);
  const m = await page.evaluate(() => {
    const r = (sel) => {
      const e = document.querySelector(sel);
      if (!e) return null;
      const b = e.getBoundingClientRect();
      return { w: Math.round(b.width), h: Math.round(b.height), bottom: Math.round(b.bottom) };
    };
    return {
      page: document.documentElement.scrollHeight,
      win: window.innerHeight,
      winW: window.innerWidth,
      status: r('#status'),
      researchPanel: r('section.panel:has(#research)'),
      research: r('#research'),
      workshopPanel: r('section.panel:has(#workshop)'),
    };
  });
  await page.locator('#btn-menu').click();
  await page.locator('#btn-menu-help').click();
  await page.waitForTimeout(200);
  const hm = await page.evaluate(() => {
    const box = document.querySelector('#help-screen .help-box').getBoundingClientRect();
    const cols = getComputedStyle(document.querySelector('.help-cols')).gridTemplateColumns.split(' ').length;
    return { helpBox: { w: Math.round(box.width), h: Math.round(box.height) }, cols, win: window.innerHeight, page: document.documentElement.scrollHeight };
  });
  if (out) await page.screenshot({ path: `${out}/${label}-help-${name}.png` });
  await page.locator('#btn-help-close').click();
  if (out) await page.screenshot({ path: `${out}/${label}-base-${name}.png` });
  console.log(label, name, JSON.stringify({ ...m, ...hm }));
  await page.close();
}
await browser.close();
