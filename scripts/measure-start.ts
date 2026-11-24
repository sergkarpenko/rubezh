// scripts/measure-start.ts — виміри стартового екрана (Т.94, розвиток Т.126; кандидат процесу 124, Т.163):
// рамки логотипа, підпису, меню, версії й банера Т.93, перетин рамок (min(низ) − max(верх) > 0 — накриття,
// без перетину по ширині — не накриття), вихід за вікно, прокрутка по висоті й убік. Рядок на вікно × банер / без.
// Поза npm test і test:e2e. Запуск із кореня клону (збірка — `npx vite preview --port 4175 --strictPort`):
//   E2E_CHROME=/шлях/до/chrome node scripts/run-ts.mjs scripts/measure-start.ts <адреса> <мітка> [dj] [nologo] [css=<файл>] [shots=<тека>]
// dj — шрифт DejaVu Sans; nologo — запит логотипа `**/logo*.webp` перервано (текстовий логотип вищий,
// docs/agents/ui.md); css — варіант-прототип стилями поверх сторінки; shots — знімки кожного вікна.
// Межу `@media` міряти з сусідніми розмірами (межа ± 1 і ± 20 px) — додати їх у SIZES свого кроку.
import { chromium } from '@playwright/test';
import fs from 'node:fs';

type Box = { t: number; b: number; l: number; r: number };

const args = process.argv.slice(process.argv.findIndex((a) => a.endsWith('.ts')) + 1).filter((a) => a !== '--');
const [url, label] = args;
if (!url || !label) {
  console.error(
    'Використання: node scripts/run-ts.mjs scripts/measure-start.ts <адреса> <мітка> [dj] [nologo] [css=<файл>] [shots=<тека>]'
  );
  process.exit(2);
}
const opt = (name: string): string | undefined => args.find((a) => a.startsWith(name + '='))?.slice(name.length + 1);
const dj = args.includes('dj');
const nologo = args.includes('nologo');
const cssFile = opt('css');
const css = cssFile ? fs.readFileSync(cssFile, 'utf8') : '';
const shots = opt('shots');
// 14 вікон Т.94 і 5 низьких вікон Т.126 (прокрутка з банером на `main` до Т.126)
const SIZES: [number, number][] = [
  [568, 270], [740, 280], [320, 480], [800, 600], [1280, 720], [1280, 721], [320, 568],
  [375, 667], [390, 844], [568, 320], [640, 360], [667, 375], [1024, 768], [1366, 768],
  [320, 420], [320, 460], [720, 481], [800, 500], [900, 515],
]; // prettier-ignore

const browser = await chromium.launch({ executablePath: process.env.E2E_CHROME });
const out: string[] = [];
for (const note of [false, true]) {
  for (const [w, h] of SIZES) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    if (nologo) await page.route('**/logo*.webp', (r) => r.abort());
    await page.addInitScript(() => localStorage.setItem('rubezh.helpSeen', '1'));
    await page.goto(url);
    const hc = page.locator('#btn-help-close');
    if (await hc.isVisible()) await hc.click();
    if (dj) await page.addStyleTag({ content: 'body, button { font-family: "DejaVu Sans" !important }' });
    if (css) await page.addStyleTag({ content: css });
    if (!nologo)
      await page
        .waitForFunction(() => document.querySelector('#start-logo')?.classList.contains('logo-loaded'), null, { timeout: 5000 })
        .catch(() => {});
    if (note)
      await page.evaluate(() => {
        const n = document.getElementById('start-note');
        if (!n) return;
        n.textContent = 'Не вдалося завантажити збереження. Почніть нову гру.';
        n.classList.remove('hidden');
      });
    const r = await page.evaluate(() => {
      const box = (s: string): Box | null => {
        const e = document.querySelector(s);
        if (!e || e.classList.contains('hidden')) return null;
        const b = e.getBoundingClientRect();
        return { t: Math.round(b.top), b: Math.round(b.bottom), l: Math.round(b.left), r: Math.round(b.right) };
      };
      const sc = document.getElementById('start-screen');
      return {
        boxes: {
          note: box('#start-note'),
          logo: box('#start-logo'),
          tag: box('.start-tagline'),
          menu: box('#start-screen .start-menu'),
          ver: box('.start-version'),
        },
        scroll: sc !== null && sc.scrollHeight > sc.clientHeight + 1,
        scrollX: sc !== null && sc.scrollWidth > sc.clientWidth + 1,
      };
    });
    const { note: nb, logo, tag, menu, ver } = r.boxes;
    // без перетину по ширині (колонки) — не накриття: −999
    const ov = (a: Box | null, b: Box | null): number | null =>
      a && b ? (Math.min(a.r, b.r) <= Math.max(a.l, b.l) ? -999 : 0) + Math.min(a.b, b.b) - Math.max(a.t, b.t) : null;
    const f = (v: number | null): string => (v === null ? '—' : v > 0 ? 'НАКРИТТЯ ' + v : 'ok(' + v + ')');
    const span = (b: Box | null): string => (b ? b.t + '–' + b.b : '—');
    const off = Object.entries(r.boxes)
      .filter(([, v]) => v !== null && (v.t < 0 || v.b > h || v.l < 0 || v.r > w))
      .map(([k]) => k);
    out.push(
      `${label} ${note ? 'з банером' : 'без банера'} ${w}×${h}: лого ${span(logo)}, підпис ${span(tag)}, меню ${span(menu)}` +
        (nb ? `, банер ${span(nb)}` : '') +
        ` | меню∩підпис ${f(ov(menu, tag))}, меню∩лого ${f(ov(menu, logo))}` +
        (nb ? `, банер∩лого ${f(ov(nb, logo))}, банер∩меню ${f(ov(nb, menu))}` : '') +
        `, меню∩версія ${f(ov(menu, ver))}` +
        (off.length ? ' | поза вікном: ' + off.join(',') : '') +
        (r.scroll ? ' | прокрутка' : '') +
        (r.scrollX ? ' | прокрутка вбік' : '')
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
