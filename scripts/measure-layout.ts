// scripts/measure-layout.ts — виміри «`main` проти гілки» (Т.123–Т.132, кандидат процесу 124, Т.163):
// прямокутники кнопок і панелей на кількох розмірах вікна → JSON у stdout; дві збірки — два файли, `diff`.
// Поза npm test і test:e2e. Збірки піднімати окремо (docs/agents/ui.md, «Крок вигляду»):
//   npx vite preview --port 4175 --strictPort --outDir /tmp/dist-main   (копія dist main)   і   npx vite preview --port 4176 --strictPort (гілка)
// Запуск із кореня клону:
//   E2E_CHROME=/шлях/до/chrome node scripts/run-ts.mjs scripts/measure-layout.ts <адреса> [inter] [--sizes 1366x768,390x844] > main.json
//   diff main.json branch.json
// Шрифт — як у e2e: DejaVu Sans через e2e/fonts.conf (Т.175, scripts/launch-chrome.ts); inter — шрифт системи
// без конфіга (у контейнері — Inter; варіант, де ширшає текст, міряти з обома). Колишній прапорець dj
// (до Т.175: DejaVu стилем поверх сторінки) нічого не змінює — DejaVu тепер типово. Стани: стартовий екран, геосцена (сід 42,
// вкладка «Вузол», зонд з кнопкою місії), розгорнутий журнал, бій. Число кнопок вкладок чи карток змінюється
// навмисно лише тоді, коли крок їх міняє; решта різниці — розміри, які крок міняти не мав (ADR-0115).
import type { Page } from '@playwright/test';
import { launchChrome, warnDj } from './launch-chrome';

// під run-ts.mjs аргументи йдуть після шляху до скрипта; «--» пропускається
const args = process.argv.slice(process.argv.findIndex((a) => a.endsWith('.ts')) + 1).filter((a) => a !== '--');
const sizesAt = args.indexOf('--sizes');
const sizesArg = sizesAt >= 0 ? args[sizesAt + 1] : undefined;
const pos = args.filter((a, i) => !a.startsWith('--') && (sizesAt < 0 || i !== sizesAt + 1));
const [url, font] = pos;
if (!url) {
  console.error('Використання: node scripts/run-ts.mjs scripts/measure-layout.ts <адреса> [inter] [--sizes WxH,…]');
  process.exit(2);
}
const DEFAULT_SIZES = '1366x768,1024x768,390x844,320x568,844x390,568x320';
const sizes = (sizesArg ?? DEFAULT_SIZES).split(',').map((s) => s.split('x').map(Number) as [number, number]);

// рядок «мітка x y w h»: мітка — id, інакше data-tab чи клас і номер серед знайдених
const rects = (p: Page, sel: string): Promise<string[]> =>
  p.evaluate(
    (sel) =>
      [...document.querySelectorAll(sel)]
        .map((e, i) => {
          const r = e.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) return null;
          const tab = e.getAttribute('data-tab') ?? e.getAttribute('data-unit');
          const label = e.id || (tab ? tab + '#' + i : e.tagName.toLowerCase() + '.' + (e.classList[0] ?? '') + '#' + i);
          return [label, r.x.toFixed(2), r.y.toFixed(2), r.width.toFixed(2), r.height.toFixed(2)].join(' ');
        })
        .filter((s): s is string => s !== null),
    sel
  );
const pageSize = (p: Page): Promise<string> =>
  p.evaluate(() => document.documentElement.scrollWidth + 'x' + document.documentElement.scrollHeight);

warnDj(args);
const browser = await launchChrome({ inter: font === 'inter' });
const out: Record<string, Record<string, string[] | string>> = {};
for (const [w, h] of sizes) {
  const touch = w < 900;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: touch, hasTouch: touch, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  await p.goto(url);
  const hc = p.locator('#btn-help-close');
  if (await hc.isVisible()) await hc.click();
  const k = w + 'x' + h;
  out[k + ' start'] = { menu: await rects(p, '#start-screen .start-menu button'), page: await pageSize(p) };
  await p.locator('#btn-start-new').click();
  await p.locator('#new-game-more').evaluate((d) => ((d as HTMLDetailsElement).open = true)); // Т.218: сід — у «Додатково»
  await p.locator('#new-game-seed').fill('42');
  await p.locator('#btn-new-game-start').click();
  await p.locator('#status-tab-base').click();
  const m = p.locator('#probes button.mission').first();
  for (let i = 0; i < 200 && !(await m.isVisible()); i++) await p.locator('#btn-tick').click();
  if (!(await m.isVisible()))
    throw new Error(`${w}x${h}: за 200 тіків (сід 42) кнопки місії немає — стан геосцени інший, ніж чекає скрипт`);
  out[k + ' geo'] = {
    topbar: await rects(p, '#topbar button'),
    tabs: await rects(p, '#status-tabs button'),
    panels: await rects(p, 'section.panel'),
    mission: await rects(p, '#probes button.mission'),
    page: await pageSize(p),
  };
  const ex = p.locator('#btn-log-expand');
  if (await ex.isVisible()) await ex.click();
  out[k + ' log'] = { tabs: await rects(p, '#log-tabs button'), page: await pageSize(p) };
  if (await ex.isVisible()) await ex.click();
  await m.click();
  await p.waitForTimeout(700);
  out[k + ' battle'] = {
    tiles: await rects(p, '#btoolbar button'),
    caps: await rects(p, '#btoolbar .tb-cap'),
    field: await rects(p, '#battle'),
    squad: await rects(p, '#bsquad .sq-card'),
    page: await pageSize(p),
  };
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(out, null, 1));
