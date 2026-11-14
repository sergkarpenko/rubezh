// Т.33 (docs/reports/t33-battle-feedback.md): виміри і знімки відповідей гри в бою — плашка ходу демонів, підсумок, плитки, картка результату.
// Запуск із кореня: E2E_CHROME=/шлях/до/chrome [PORT=4173] node docs/reports/t33/measure.mjs; знімки — у теку out/ поруч із місцем запуску.
import { chromium } from '@playwright/test';
const sizes = { d1366: [1366, 768], d1920: [1920, 1080], ipad: [1024, 768], d1366x680: [1366, 680] };
const b = await chromium.launch({ executablePath: process.env.E2E_CHROME });
const m = (p, label) => p.evaluate((label) => {
  const r = (id) => { const e = document.getElementById(id); if (!e || e.classList.contains('hidden')) return id + ':—'; const x = e.getBoundingClientRect(); return id + ':' + [x.left, x.top, x.width, x.height].map(Math.round).join(','); };
  const caps = [...document.querySelectorAll('#btoolbar .tb-cap')].map((c) => c.textContent + '=' + Math.round(c.getBoundingClientRect().width)).join(' ');
  const f = document.getElementById('focus');
  return [label, r('battle'), r('btoolbar'), r('bturn'), r('bresult'), r('binfo'), 'focus ' + f.scrollHeight + '/' + f.clientHeight, 'page ' + document.documentElement.scrollHeight, caps].join(' | ');
}, label);
for (const [name, [w, h]] of Object.entries(sizes)) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.goto(`http://localhost:${process.env.PORT ?? 4173}/rubezh/`); await p.waitForTimeout(400);
  await p.locator('#btn-help-close').click(); await p.locator('#btn-start-new').click();
  await p.locator('#new-game-seed').fill('42'); await p.locator('#btn-new-game-start').click(); await p.waitForTimeout(200);
  for (let i = 0; i < 30; i++) await p.locator('#btn-tick').click();
  await p.locator('#status-tab-base').click(); await p.locator('#ufos button.mission').first().click(); await p.waitForTimeout(400);
  console.log(await m(p, name + ' старт'));
  const t0 = Date.now();
  await p.locator('#btn-end').click();
  console.log(await m(p, name + ' хід демонів')); await p.screenshot({ path: `out/${name}-1-acting.png` });
  await p.locator('#bturn.done').waitFor();
  console.log(name, 'плашка, мс:', Date.now() - t0);
  // вибрати оперативника і відвести його тап-тапом, поки AP не стане менше за ціну пострілу
  const box = await p.locator('#battle').boundingBox();
  const tap = (x, y) => p.mouse.click(box.x + (x + 0.5) * box.width / 20, box.y + (y + 0.5) * box.height / 20);
  const unit = () => p.locator('#bctx-unit').textContent();
  let at = null;
  for (let y = 0; y < 20 && at === null; y++) for (let x = 0; x < 3 && at === null; x++) { await tap(x, y); if ((await unit()) !== 'не вибраний') at = [x, y]; }
  for (let dx = 8; dx > 2 && !/AP [0-2]\//.test(await unit()); dx--) { await tap(at[0] + dx, at[1]); await tap(at[0] + dx, at[1]); }
  console.log(await m(p, name + ' мало AP (' + (await unit()) + ')')); await p.screenshot({ path: `out/${name}-2-low-ap.png` });
  await p.locator('#btn-end').click(); await p.locator('#bturn.done').waitFor();
  console.log(await m(p, name + ' підсумок')); await p.screenshot({ path: `out/${name}-3-summary.png` });
  await p.locator('#btn-auto-battle').click(); await p.locator('#bresult .banner').waitFor({ timeout: 120000 }); await p.waitForTimeout(300);
  console.log(await m(p, name + ' результат')); await p.screenshot({ path: `out/${name}-4-result.png` });
  await p.close();
}
await b.close();
