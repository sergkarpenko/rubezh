// Т.94: замір розкладки стартового екрана — перетин рамок (min(низ) − max(верх)) > 0 = накриття.
// Використання (з теки поза репозиторієм із посиланням node_modules, див. docs/agents/ui.md):
// URL=http://localhost:4174/rubezh/ E2E_CHROME=… node measure.mjs <мітка> [css-файл або -] [тека знімків]
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const label = process.argv[2] ?? 'до';
const cssFile = process.argv[3];
const shots = process.argv[4];
const css = cssFile && cssFile !== '-' ? fs.readFileSync(cssFile, 'utf8') : '';
const SIZES = [
  [568, 270], [740, 280], [320, 480], [800, 600], [1280, 720], [1280, 721],
  [320, 568], [375, 667], [390, 844], [568, 320], [640, 360], [667, 375], [1024, 768], [1366, 768],
];
const URL = process.env.URL ?? 'http://localhost:4174/rubezh/';
const browser = await chromium.launch({ executablePath: process.env.E2E_CHROME });
const out = [];
for (const note of [false, true]) {
  for (const [w, h] of SIZES) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    await page.addInitScript(() => localStorage.setItem('rubezh.helpSeen', '1'));
    await page.goto(URL);
    const hc = page.locator('#btn-help-close');
    if (await hc.isVisible()) await hc.click();
    if (css) await page.addStyleTag({ content: css });
    await page.waitForFunction(() => document.querySelector('#start-logo')?.classList.contains('logo-loaded'), null, { timeout: 5000 }).catch(() => {});
    if (note)
      await page.evaluate(() => {
        const n = document.getElementById('start-note');
        n.textContent = 'Не вдалося завантажити збереження. Почніть нову гру.';
        n.classList.remove('hidden');
      });
    const r = await page.evaluate(() => {
      const box = (s) => {
        const e = document.querySelector(s);
        if (!e || e.classList.contains('hidden')) return null;
        const b = e.getBoundingClientRect();
        return { t: Math.round(b.top), b: Math.round(b.bottom), l: Math.round(b.left), r: Math.round(b.right) };
      };
      const sc = document.getElementById('start-screen');
      return {
        note: box('#start-note'), logo: box('#start-logo'), tag: box('.start-tagline'),
        menu: box('#start-screen .start-menu'), ver: box('.start-version'),
        scroll: sc.scrollHeight > sc.clientHeight + 1,
      };
    });
    // без перетину по ширині (колонки) — не накриття: −999
const ov = (a, b) => (a && b ? (Math.min(a.r, b.r) <= Math.max(a.l, b.l) ? -999 : 0) + Math.min(a.b, b.b) - Math.max(a.t, b.t) : null);
    const f = (v) => (v === null ? '—' : v > 0 ? 'НАКРИТТЯ ' + v : 'ok(' + v + ')');
    const off = Object.entries(r).filter(([k, v]) => v && typeof v === 'object' && (v.t < 0 || v.b > h || v.l < 0 || v.r > w)).map(([k]) => k);
    out.push(
      `${label} ${note ? 'з банером' : 'без банера'} ${w}×${h}: лого ${r.logo.t}–${r.logo.b}, підпис ${r.tag.t}–${r.tag.b}, меню ${r.menu.t}–${r.menu.b}` +
        (r.note ? `, банер ${r.note.t}–${r.note.b}` : '') +
        ` | меню∩підпис ${f(ov(r.menu, r.tag))}, меню∩лого ${f(ov(r.menu, r.logo))}` +
        (r.note ? `, банер∩лого ${f(ov(r.note, r.logo))}, банер∩меню ${f(ov(r.note, r.menu))}` : '') +
        `, меню∩версія ${f(ov(r.menu, r.ver))}` + (off.length ? ' | поза вікном: ' + off.join(',') : '') + (r.scroll ? ' | прокрутка' : ''),
    );
    if (shots) {
      fs.mkdirSync(shots, { recursive: true });
      await page.screenshot({ path: `${shots}/${label}-${note ? 'note' : 'plain'}-${w}x${h}.png` });
    }
    await ctx.close();
  }
}
await browser.close();
console.log(out.join('\n'));
