// Т.30: рідкісні стани Т.24 і Т.26 для знімків — правка сейва в localStorage, код гри не змінюється.
// Запуск із кореня репозиторію, збірка піднята на порту 4173:
//   T30_OUT=/tmp/t30-shots/ E2E_CHROME=/шлях/до/chrome node docs/reports/t30/rare.mjs
import { chromium } from '@playwright/test';
const OUT = process.env.T30_OUT ?? '/tmp/t30-shots/';
const URL = process.env.E2E_URL ?? 'http://localhost:4173/rubezh/';
const sizes = { d1366: [1366, 768], d1920: [1920, 1080], ipad: [1024, 768] };
const browser = await chromium.launch(process.env.E2E_CHROME ? { executablePath: process.env.E2E_CHROME } : {});
for (const [proj, [w, h]] of Object.entries(sizes)) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: proj === 'ipad' });
  const page = await ctx.newPage();
  await page.goto(URL);
  await page.locator('#btn-help-close').click();
  await page.locator('#btn-start-new').click();
  await page.locator('#new-game-seed').fill('42');
  await page.locator('#new-game-preset').selectOption('норма');
  await page.locator('#btn-new-game-start').click();
  for (let i = 0; i < 96 && (await page.locator('#ufos button.mission').count()) === 0; i++) await page.locator('#btn-tick').click();
  await page.locator('#status-tab-system').click();
  await page.locator('#btn-save-1').click();
  const key = await page.evaluate(() => Object.keys(localStorage).find((k) => k.startsWith('rubezh.save')));
  const raw = await page.evaluate((k) => localStorage.getItem(k), key);
  const save = JSON.parse(raw);
  // Т.24: останній загін (троє), грошей менше за ціну вербування
  const s24 = JSON.parse(raw);
  const p24 = s24.state;
  p24.econ.money = 60;
  p24.roster.soldiers = p24.roster.soldiers.slice(0, 3);
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [key, JSON.stringify(s24)]);
  await page.locator('#btn-load-1').click();
  await page.locator('#status-tab-base').click();
  await page.waitForTimeout(300);
  console.log(proj, 'T24', await page.locator('.mission-warn').allInnerTexts());
  await page.screenshot({ path: OUT + '41-warn-last-squad-' + proj + '.png' });
  // Т.26: перехоплювач пошкоджений на базі, боєготових немає, грошей на ремонт є, на ремонт + найм — ні
  const s26 = JSON.parse(raw);
  const p26 = s26.state;
  p26.econ.money = 120;
  p26.intercept.fighter.hp = 2;
  for (const sld of p26.roster.soldiers) { sld.hp = 3; p26.roster.hospital[sld.id] = 40; }
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [key, JSON.stringify(s26)]);
  await page.locator('#status-tab-system').click();
  await page.locator('#btn-load-1').click();
  await page.locator('#status-tab-base').click();
  await page.waitForTimeout(300);
  console.log(proj, 'T26', await page.locator('.mission-warn').allInnerTexts(), await page.locator('#ready').innerText());
  await page.screenshot({ path: OUT + '42-warn-repair-' + proj + '.png' });
  await ctx.close();
}
await browser.close();
