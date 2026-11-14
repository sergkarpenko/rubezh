// Т.31 (docs/reports/t31-no-scroll.md): виміри розкладки і знімки геосцени та бою на трьох розмірах вікна.
// Поза npm test і test:e2e. Збірку піднімати окремо: npm run build && npx vite preview --port 4173 --strictPort.
// Запуск із кореня репозиторію: E2E_CHROME=/шлях/до/chrome node docs/reports/t31/measure.mjs <мітка> [shots]
// (PORT — порт збірки, типово 4173; знімки — у /tmp/t31/).
import { chromium } from '@playwright/test';
const tag = process.argv[2]; const shots = process.argv[3] === 'shots';
const sizes = { d1366: [1366, 768, false], d1920: [1920, 1080, false], ipad: [1024, 768, true] };
const b = await chromium.launch({ executablePath: process.env.E2E_CHROME });
const r = (p, id) => p.evaluate((id) => { const x = document.querySelector(id).getBoundingClientRect(); return [x.left, x.top, x.width, x.height].map(Math.round).join(','); }, id);
for (const [name, [w, h, touch]] of Object.entries(sizes)) {
  const p = await b.newPage({ viewport: { width: w, height: h }, hasTouch: touch });
  const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto(`http://localhost:${process.env.PORT ?? 4173}/rubezh/`); await p.waitForTimeout(500);
  await p.locator('#btn-help-close').click(); await p.locator('#btn-start-new').click();
  await p.locator('#new-game-seed').fill('42'); await p.locator('#btn-new-game-start').click();
  await p.waitForTimeout(400);
  for (let i = 0; i < 30; i++) await p.locator('#btn-tick').click();
  await p.locator('#btn-hire').click();
  for (const tab of ['squad', 'base', 'system']) {
    await p.locator('#status-tab-' + tab).click(); await p.waitForTimeout(150);
    const page = await p.evaluate(() => document.documentElement.scrollHeight);
    const cv = await p.evaluate(() => { const c = document.getElementById('geo'); const b = c.getBoundingClientRect(); const s = Math.min(b.width / c.width, b.height / c.height); return Math.round(c.width * s) + 'x' + Math.round(c.height * s); });
    console.log(name, tab, 'page', page, 'top', await r(p, '#topbar'), 'geoPanel', await r(p, '#geo-panel'), 'geo', await r(p, '#geo'), 'map', cv, 'journal', await r(p, '#journal'), 'log', await r(p, '#log'), 'status', await r(p, '#status'));
    if (shots) await p.screenshot({ path: `/tmp/t31/${tag}-geo-${tab}-${name}.png` });
  }
  if (await p.locator('#btn-log-expand').isVisible()) {
    await p.locator('#btn-log-expand').click(); await p.waitForTimeout(150);
    console.log(name, 'expanded journal', await r(p, '#journal'), 'log', await r(p, '#log'), 'page', await p.evaluate(() => document.documentElement.scrollHeight));
    if (shots) await p.screenshot({ path: `/tmp/t31/${tag}-geo-expanded-${name}.png` });
    await p.locator('#btn-log-expand').click();
  }
  await p.locator('#status-tab-base').click();
  await p.locator('#ufos button.mission').first().click(); await p.waitForTimeout(500);
  console.log(name, 'battle page', await p.evaluate(() => document.documentElement.scrollHeight), 'focus', await r(p, '#focus'), 'focusScroll', await p.evaluate(() => document.getElementById('focus').scrollHeight), 'battle', await r(p, '#battle'), 'journal', await r(p, '#journal'), 'errs', errs.length);
  if (shots) await p.screenshot({ path: `/tmp/t31/${tag}-battle-${name}.png` });
  await p.close();
}
await b.close();
