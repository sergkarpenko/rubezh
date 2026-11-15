import { chromium } from '@playwright/test';
const b = await chromium.launch({ executablePath: process.env.E2E_CHROME });
for (const [name, w, h] of [['d1366', 1366, 768], ['ipad', 1024, 768]]) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.goto('http://localhost:4175/rubezh/'); await p.waitForTimeout(500);
  await p.locator('#btn-help-close').click(); await p.locator('#btn-start-new').click();
  await p.locator('#new-game-seed').fill('42'); await p.locator('#btn-new-game-start').click(); await p.waitForTimeout(200);
  for (let i = 0; i < 30; i++) await p.locator('#btn-tick').click();
  await p.locator('#status-tab-base').click(); await p.locator('#ufos button.mission').first().click(); await p.waitForTimeout(600);
  const cv = p.locator('#battle');
  const box = await cv.boundingBox();
  console.log(name, 'canvas', Math.round(box.width), Math.round(box.height), 'cell', (box.width / 20).toFixed(1));
  const pt = (x, y) => [box.x + (x + 0.5) * box.width / 20, box.y + (y + 0.5) * box.height / 20];
  const unit = () => p.locator('#bctx-unit').textContent();
  let at = null;
  for (let y = 0; y < 20 && at === null; y++) for (let x = 0; x < 4 && at === null; x++) { await p.mouse.click(...pt(x, y)); if ((await unit()) !== 'не вибраний') at = [x, y]; }
  console.log(name, 'unit at', at, await unit());
  const shot = async (v, tag, hover) => {
    await p.evaluate((v) => { globalThis.__v = v; }, v);
    await p.mouse.move(...pt(at[0] + hover[0] + 1, at[1] + hover[1])); await p.mouse.move(...pt(at[0] + hover[0], at[1] + hover[1])); await p.waitForTimeout(150);
    await cv.screenshot({ path: `out/${name}-${tag}.png` });
    console.log(name, tag, 'reach', await p.evaluate(() => globalThis.__reachN), await p.locator('#binfo').textContent());
  };
  const H = [4, 3];
  await shot({}, 'base', H);
  for (const k of ['a', 'b', 'c']) { await shot({ decor: k }, 'decor-' + k, H); await shot({ reach: k }, 'reach-' + k, H); await shot({ fog: k }, 'fog-' + k, H); }
  await shot({ reach: 'a' }, 'reach-far', [9, 6]);
  await shot({ decor: 'c', reach: 'c', fog: 'a' }, 'all', H);
  await p.close();
}
await b.close();
