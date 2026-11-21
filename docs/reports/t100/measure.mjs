// Т.100 (кандидат 22): виміри панелі «Дослідження» — висота панелі, кожної картки і вкладки «База».
// Поза npm test і test:e2e. Збірку піднімати окремо: npm run build && npx vite preview --port 4173 --strictPort.
// Запуск із кореня: E2E_CHROME=/шлях/до/chrome node docs/reports/t100/measure.mjs <мітка> [shots] [js-файл]
// js-файл — варіант-прототип: правка DOM панелі на живій сторінці (page.evaluate); стани — правкою сейва в слоті 1 (docs/agents/ui.md).
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
const [tag, shotsArg, jsFile] = process.argv.slice(2);
const shots = shotsArg === 'shots';
const js = jsFile ? readFileSync(jsFile, 'utf8') : null;
const sizes = { d1366: [1366, 768, false], ipad: [1024, 768, true], phone: [390, 844, true] };
// знімки — у високому вікні тієї ж ширини, щоб панель влізла цілком
if (shots) { sizes.d1366[1] = 2400; delete sizes.ipad; delete sizes.phone; }
// стани: нова партія; без кредитів; середина гри (2 техноманти, 3 завершено, 1 у роботі)
const states = {
  new: null,
  broke: (s) => { s.econ.money = 0; },
  mid: (s) => {
    s.research.scientists = [{ id: 'в1', name: 'Т-1' }, { id: 'в2', name: 'Т-2' }]; s.research.hired = 2;
    s.research.completed = ['armor', 'medkit', 'lab-extension']; s.research.slots = 2;
    s.research.active = [{ id: 'optics', invested: 9 }];
  },
};
const b = await chromium.launch({ executablePath: process.env.E2E_CHROME });
for (const [name, [w, h, touch]] of Object.entries(sizes)) {
  for (const [st, edit] of Object.entries(states)) {
    const p = await b.newPage({ viewport: { width: w, height: h }, hasTouch: touch });
    const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
    await p.goto(`http://localhost:${process.env.PORT ?? 4173}/rubezh/`); await p.waitForTimeout(400);
    await p.locator('#btn-help-close').click(); await p.locator('#btn-start-new').click();
    await p.locator('#new-game-seed').fill('42'); await p.locator('#btn-new-game-start').click();
    await p.waitForTimeout(300);
    if (edit) {
      await p.locator('#status-tab-system').click();
      await p.locator('#btn-save-1').click();
      await p.evaluate((src) => {
        const s = JSON.parse(localStorage.getItem('rubezh.save.1'));
        new Function('s', src)(s.state);
        localStorage.setItem('rubezh.save.1', JSON.stringify(s));
      }, `(${edit.toString()})(s)`);
      await p.locator('#btn-load-1').click(); await p.waitForTimeout(200);
    }
    await p.locator('#status-tab-base').click(); await p.waitForTimeout(150);
    if (js) { await p.evaluate(js); await p.waitForTimeout(100); }
    const m = await p.evaluate(() => {
      const H = (e) => Math.round(e.getBoundingClientRect().height);
      const panel = document.getElementById('research').closest('section');
      const cards = [...document.querySelectorAll('#research .sci-card')].map((c) => c.querySelector('.sci-badge').textContent + ':' + H(c));
      const st = document.getElementById('status');
      return { panel: H(panel), status: st.scrollHeight, page: document.documentElement.scrollHeight, cards };
    });
    console.log(name, st, 'panel', m.panel, 'status', m.status, 'page', m.page, '|', m.cards.join(' '), errs.length ? 'ERR ' + errs : '');
    if (shots) {
      const sec = p.locator('#research').locator('xpath=..');
      await sec.screenshot({ path: `/tmp/t100/${tag}-${st}-${name}.png` });
    }
    await p.close();
  }
}
await b.close();
