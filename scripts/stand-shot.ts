// scripts/stand-shot.ts — знімок стенда терену (scripts/stand.ts; Т.146, кандидат процесу 124, Т.163).
// Стенд піднімати окремо: `npx vite --port 4180` з кореня клону. Запуск:
//   E2E_CHROME=/шлях/до/chrome node scripts/run-ts.mjs scripts/stand-shot.ts <файл.png> ['seed=1&density=0.2&fog=10'] [масштаб]
// масштаб — deviceScaleFactor (типово 1: канва 960 × 960 буфера = 960 CSS px).
import { chromium } from '@playwright/test';

const args = process.argv.slice(process.argv.findIndex((a) => a.endsWith('.ts')) + 1).filter((a) => a !== '--');
const [out, query = '', scale = '1'] = args;
if (!out) {
  console.error("Використання: node scripts/run-ts.mjs scripts/stand-shot.ts <файл.png> ['seed=1&density=0.08&fog=0'] [масштаб]");
  process.exit(2);
}
const port = process.env.PORT ?? '4180';
const browser = await chromium.launch({ executablePath: process.env.E2E_CHROME });
const page = await browser.newPage({ viewport: { width: 960, height: 960 }, deviceScaleFactor: Number(scale) });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`http://localhost:${port}/rubezh/scripts/stand.html?${query}`);
// помилки сторінки друкуються й тоді, коли стенд не дійшов до готовності
try {
  await page.waitForSelector('body[data-ready="1"], body[data-error]', { timeout: 15000 });
  const failed = await page.evaluate(() => document.body.dataset.error);
  if (failed !== undefined) errors.push('ассет не завантажився: ' + failed);
  else await page.locator('#stand').screenshot({ path: out });
} catch (e) {
  errors.push(String(e));
}
await browser.close();
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(out);
