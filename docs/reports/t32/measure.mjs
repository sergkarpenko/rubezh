// Т.32 (docs/reports/t32-battle-fit.md): виміри розкладки бою і знімки на шести розмірах вікна; на 1366 × 768 і iPad — ще й стан «результат бою».
// Запуск із кореня: E2E_CHROME=/шлях/до/chrome [PORT=4173] node docs/reports/t32/measure.mjs <мітка>; знімки — у теку out/ поруч із місцем запуску.
import { chromium } from '@playwright/test';
import fs from 'fs';
const sizes = { d1366x680: [1366, 680, false], d1280x1024: [1280, 1024, false], d1440: [1440, 900, false], d1366: [1366, 768, false], d1920: [1920, 1080, false], ipad: [1024, 768, true] };
const b = await chromium.launch({ executablePath: process.env.E2E_CHROME });
const r = (p, id) => p.evaluate((id) => { const x = document.querySelector(id).getBoundingClientRect(); return [x.left, x.top, x.width, x.height, x.bottom].map(Math.round).join(','); }, id);
for (const v of process.argv.slice(2)) for (const [name, [w, h, touch]] of Object.entries(sizes)) {
  const p = await b.newPage({ viewport: { width: w, height: h }, hasTouch: touch });
  await p.goto(`http://localhost:${process.env.PORT ?? 4173}/rubezh/`); await p.waitForTimeout(500);
  await p.locator('#btn-help-close').click(); await p.locator('#btn-start-new').click();
  await p.locator('#new-game-seed').fill('42'); await p.locator('#btn-new-game-start').click();
  await p.waitForTimeout(300);
  for (let i = 0; i < 30; i++) await p.locator('#btn-tick').click();
  await p.locator('#status-tab-base').click();
  await p.locator('#ufos button.mission').first().click(); await p.waitForTimeout(400);
  
  await p.waitForTimeout(300);
  const bt = await p.evaluate(() => document.getElementById('battle').getBoundingClientRect().width);
  console.log(v, name, 'cell', (bt / 20).toFixed(1), 'battle', await r(p, '#battle'), 'tb', await r(p, '#btoolbar'), 'binfo', await r(p, '#binfo'), 'journal', await r(p, '#journal'), 'focusScroll', await p.evaluate(() => { const f = document.getElementById('focus'); return f.scrollHeight + '/' + f.clientHeight; }), 'page', await p.evaluate(() => document.documentElement.scrollHeight));
  await p.screenshot({ path: `out/${v}-${name}.png` });
  if (name === 'd1366' || name === 'ipad') { await p.locator('#btn-auto-battle').click(); await p.locator('#bresult .banner').waitFor({ timeout: 120000 }); await p.waitForTimeout(300);
    console.log(v, name, 'RESULT battle', await r(p, '#battle'), 'bresult', await r(p, '#bresult'), 'binfo', await r(p, '#binfo'), 'focusScroll', await p.evaluate(() => { const f = document.getElementById('focus'); return f.scrollHeight + '/' + f.clientHeight; }));
    await p.screenshot({ path: `out/${v}-result-${name}.png` }); }
  await p.close();
}
await b.close();
