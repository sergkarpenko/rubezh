// e2e/acceptance.scenario.ts
// Сценарій приймання (ADR-0080): стандартний smoke-сценарій валідації
// (ADR-0030, крок 7 циклу) як автоматичний прохід у браузері. Кроки ті самі,
// що їх робив власник очима: вибрати юніта → рух (тап-тап) → дозор → кінець
// ходу (хід демонів) → постріл у видиму ціль → до результату бою; геосцена:
// +1 тік, +1 доба, сейв → лоад; консоль без помилок. Порядок бойових кроків
// підлаштований під гру: ціль стає видимою, коли демони підійдуть, тож постріл
// іде після першого кінця ходу.
//
// Сценарій не знає мапи наперед: куди клікати і що має показати сторінка,
// каже дзеркало ядра (e2e/mirror.ts) — друга партія з тим самим сідом у Node.
// Суфікс *.scenario.ts — поза глобом vitest і поза testMatch домен-смоку
// прев'ю (ADR-0063): `npm test` і `npm run test:smoke` цей файл не тягнуть.

import { expect, test, type Page } from '@playwright/test';
import { TICK_MINUTES } from '../src/core/geo';
import { MISSION_MAP_H, MISSION_MAP_W } from '../src/core/mission';
import type { Vec2 } from '../src/core/combat';
import {
  FIGHTER_COLORS,
  HP_BAR_Y,
  PATH_LABEL_CHAR_W,
  RING_DY,
  RING_RX,
  cellHash,
  fighterLook,
  fogHatchStep,
  pathLabelBox,
  pathLabelScale,
  zoneOutlineSegments,
} from '../src/core/render-core';
import { CoreMirror, enemyLine, unitLine } from './mirror';

const SEED = 42;
const PRESET = 'норма';
const TICKS_PER_DAY = 1440 / TICK_MINUTES;
const MAX_TICKS_TO_MISSION = 2 * TICKS_PER_DAY; // зонд має приземлитись за дві доби
const MAX_TURNS_TO_TARGET = 6; // демони мають вийти на лінію вогню за кілька ходів
const AUTO_BATTLE_TIMEOUT_MS = 120_000; // авто-бій іде з анімаціями і паузами

// Помилки сторінки і консолі за весь прохід. 404 на /favicon.ico — запит
// браузера до кореня хоста, якого гра не обслуговує, а не дефект гри.
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico')) errors.push(message.text());
  });
  return errors;
}

// Тап по центру клітинки бойовища: CSS-розмір канви → клітинка (обернена
// математика до cellFromPoint у src/ui/input.ts).
async function tap(page: Page, cell: Vec2): Promise<void> {
  const canvas = page.locator('#battle');
  const box = await canvas.boundingBox();
  if (box === null) throw new Error('Канва бою не відображається');
  await canvas.click({
    position: { x: ((cell.x + 0.5) * box.width) / MISSION_MAP_W, y: ((cell.y + 0.5) * box.height) / MISSION_MAP_H },
  });
}

// Т.137: прев'ю шляху на пікселях канви — колір лінії і плашка ціни «<число> AP» там, де її ставить
// pathLabelBox (Т.119: збоку від цілі, розмір × pathLabelScale за масштабом показу канви). Перевірки:
// центр цілі (коло) — колір шляху; лівий і правий край рамки плашки на її середній висоті — колір
// шляху (піксель x рамки strokeRect при будь-якій товщині покрито повністю), так само верхній і нижній рядок
// рамки; два протилежні кути всередині плашки — темне тло; під плашкою немає юнітів. Від шрифту не залежить (текст по центру, кут і краї — поза ним). Масштаб — з clientWidth.
type PathColor = 'ok' | 'short';
async function expectPathPreview(
  page: Page,
  from: Vec2,
  path: Vec2[],
  cost: number,
  color: PathColor,
  label: string,
  units: Vec2[]
): Promise<void> {
  const goal = path[path.length - 1]!;
  const prev = path.length > 1 ? path[path.length - 2]! : from;
  const text = cost + ' AP';
  const probe = async (): Promise<string> => {
    const px = await page.evaluate(() => {
      const cv = document.getElementById('battle') as HTMLCanvasElement;
      return cv.clientWidth > 0 ? cv.width / cv.clientWidth : 1;
    });
    const k = pathLabelScale(px);
    const box = pathLabelBox(goal, 48, text.length * PATH_LABEL_CHAR_W * k, 960, k, prev.x > goal.x);
    const lw = Math.max(1, Math.round(k));
    const mid = box.y + Math.floor(box.h / 2);
    // юніти малюються поверх прев'ю — під плашкою їх бути не має (інакше гейт хибно червоний; аудит PR #450)
    const under = units.filter(
      (u) =>
        u.x >= Math.floor(box.x / 48) &&
        u.x <= Math.floor((box.x + box.w - 1) / 48) &&
        u.y >= Math.floor(box.y / 48) &&
        u.y <= Math.floor((box.y + box.h - 1) / 48)
    );
    if (under.length > 0) return 'під плашкою юніт: ' + JSON.stringify(under);
    // чотири сторони рамки — стовпці і рядки strokeRect покрито повністю за будь-якої товщини: місце і розмір
    // плашки по обох осях (аудит PR #450: лише лівий і правий край не бачили зсуву по вертикалі)
    const pts = {
      goal: { x: goal.x * 48 + 24, y: goal.y * 48 + 24 },
      left: { x: box.x, y: mid },
      right: { x: box.x + box.w - 1, y: mid },
      top: { x: box.x + lw + 2, y: box.y },
      bottom: { x: box.x + lw + 2, y: box.y + box.h - 1 },
      inner: { x: box.x + lw + 1, y: box.y + lw + 1 },
      inner2: { x: box.x + box.w - lw - 2, y: box.y + box.h - lw - 2 },
    };
    const rgb = await page.evaluate((ps) => {
      const cx = (document.getElementById('battle') as HTMLCanvasElement).getContext('2d')!;
      return Object.fromEntries(Object.entries(ps).map(([n, p]) => [n, [...cx.getImageData(p.x, p.y, 1, 1).data.slice(0, 3)]]));
    }, pts);
    const isColor = (c: number[]): boolean =>
      color === 'ok' ? c[1]! - c[0]! > 40 && c[1]! - c[2]! > 25 : c[0]! - c[1]! > 40 && c[0]! - c[2]! > 40;
    const ok =
      ['goal', 'left', 'right', 'top', 'bottom'].every((n) => isColor(rgb[n]!)) &&
      Math.max(...rgb.inner!) < 70 &&
      Math.max(...rgb.inner2!) < 70;
    return ok ? 'ok' : JSON.stringify({ k, box, rgb });
  };
  await expect.poll(probe, { message: label }).toBe('ok');
}

// Т.124 (ADR-0115): вигляд набору інтерфейсу — властивості обчисленого стилю, а не пікселі
// (від шрифту не залежить): головна дія бурштинова з темним текстом, звичайна кнопка — об'ємна,
// панель — скло з розмиттям, активна вкладка і плашка — з рискою (тінь усередині, не рамка),
// рядок «Наступний крок» — без вигляду кнопки, вимкнена головна дія — без світіння. Курсор — убік:
// стан наведення інший (аудит PR #439). Розміри перевіряє скрипт вимірів кроку, не гейт.
async function expectLook(page: Page): Promise<void> {
  await page.mouse.move(0, 0);
  const look = await page.evaluate(() => {
    const cs = (sel: string): CSSStyleDeclaration => getComputedStyle(document.querySelector(sel)!);
    const ev = document.querySelector<HTMLButtonElement>('#btn-event')!;
    const was = ev.disabled;
    ev.style.transition = 'none'; // без переходу тіні: інакше обчислений стиль — ще стара тінь
    ev.disabled = true;
    const off = getComputedStyle(ev).boxShadow;
    ev.disabled = was;
    ev.style.transition = '';
    const panel = [...document.querySelectorAll<HTMLElement>('section.panel')].find((e) => e.offsetParent !== null)!;
    return {
      event: [cs('#btn-event').backgroundImage.includes('linear-gradient'), cs('#btn-event').color],
      mission: [cs('#ufos button.mission').backgroundImage.includes('linear-gradient'), cs('#ufos button.mission').color],
      plain: [cs('#btn-menu').backgroundImage.includes('linear-gradient'), cs('#btn-menu').boxShadow],
      glass: getComputedStyle(panel).backdropFilter,
      tab: cs('#status-tabs button.active').boxShadow.includes('inset'),
      chip: cs('#topbar .chip').boxShadow.includes('rgb(0, 229, 255) 3px 0px 0px 0px inset'),
      off,
      next: [cs('#next-step').boxShadow, cs('#next-step').backgroundImage],
      // Т.126: кнопка картки зонда — окремим рядком з відступом від тексту (ідея власника в Т.125);
      // панель на вкладці «Вузол» тут прихована (активна «Загін») — обчислений стиль, не рамки
      ufoGap: [cs('#ufos button.mission').display, parseFloat(cs('#ufos button.mission').marginTop) >= 6],
    };
  });
  expect(look).toEqual({
    event: [true, 'rgb(26, 18, 4)'],
    mission: [true, 'rgb(26, 18, 4)'],
    plain: [true, 'rgba(255, 255, 255, 0.1) 0px 1px 0px 0px inset, rgba(0, 0, 0, 0.45) 0px 2px 4px 0px'],
    glass: 'blur(8px)',
    tab: true,
    chip: true,
    off: 'none',
    next: ['none', 'none'],
    ufoGap: ['block', true],
  });
}

// Т.128 (ADR-0117): вікно «Збереження» — пункт «Меню» (раніше вкладка «Система»)
async function openSave(page: Page): Promise<void> {
  await page.locator('#btn-menu').click();
  await expectIcons(page, '#btn-menu-save svg.btn-icon', 16, 1, 'y');
  await page.locator('#btn-menu-save').click();
  await expect(page.locator('#save-dialog')).toBeVisible();
}

// Т.123 (ADR-0114): векторні іконки — svg заданого розміру в межах своєї кнопки і по її центру (іконка
// над підписом, як канва на main: у рядку з підписом кнопка вкладки ширшає на 16 px); малюнок у сітці
// 24 × 24 з запасом на половину лінії (getBBox — справжні межі з дугами й відносними відрізками).
// Розмір і місце задає CSS (без правила svg має 300 × 150 і розпирає кнопку) — від шрифту не залежить.
// Т.128 (ADR-0117): іконка в рядку перед текстом (заголовок панелі, кнопка) — по центру своєї рамки
// по вертикалі (axis 'y'), а не по горизонталі.
async function expectIcons(page: Page, selector: string, size: number, count: number, axis: 'x' | 'y' = 'x'): Promise<void> {
  const icons = await page.evaluate(
    ([sel, ax]) =>
      [...document.querySelectorAll<SVGSVGElement>(sel)].map((i) => {
        const r = i.getBoundingClientRect();
        const b = i.parentElement!.getBoundingClientRect();
        const box = i.getBBox();
        return {
          w: r.width,
          h: r.height,
          inside: r.left >= b.left && r.right <= b.right && r.top >= b.top && r.bottom <= b.bottom,
          offCentre:
            ax === 'x'
              ? Math.abs((r.left + r.right) / 2 - (b.left + b.right) / 2)
              : Math.abs((r.top + r.bottom) / 2 - (b.top + b.bottom) / 2),
          drawn: [box.x, box.y, box.x + box.width, box.y + box.height],
        };
      }),
    [selector, axis] as const
  );
  expect(icons.length, selector).toBe(count);
  for (const i of icons) {
    expect([i.w, i.h, i.inside], selector).toEqual([size, size, true]);
    expect(i.offCentre, selector).toBeLessThanOrEqual(axis === 'x' ? 1 : 2); // Т.128: у рядку центр залежить від шрифту (CI — 1,2 px)
    const [x0, y0, x1, y1] = i.drawn as [number, number, number, number];
    expect(
      x0 >= 1 && y0 >= 1 && x1 <= 23 && y1 <= 23 && Math.max(x1 - x0, y1 - y0) >= 12 && Math.min(x1 - x0, y1 - y0) >= 6,
      selector + ': межі малюнка ' + i.drawn.join(' ')
    ).toBe(true);
  }
}

// Т.120 (кандидат 115): бій на телефоні. Вертикально — плитки під полем, поле з плитками вміщується
// у вікно; горизонтально — поле у висоту вікна, плитки поруч; шапка в бою не липне.
async function expectPhoneBattle(page: Page, label: string, minField: number, portrait: boolean): Promise<void> {
  const m = await page.evaluate(() => {
    const box = (id: string) => document.getElementById(id)!.getBoundingClientRect();
    const field = box('battle');
    const tb = box('btoolbar');
    const tiles = [...document.querySelectorAll<HTMLElement>('#btoolbar button')].filter((b) => !b.hidden);
    return {
      win: window.innerHeight,
      winW: window.innerWidth,
      panelRight: box('battle-panel').right,
      page: document.documentElement.scrollWidth,
      researchW: box('research').width,
      // Т.122: панель «Дослідження» (у бою — під полем) — нічого за її правим краєм
      research: Math.max(
        0,
        ...[...document.querySelectorAll('#research *')].map((e) => e.getBoundingClientRect().right - box('research').right)
      ),
      topbar: getComputedStyle(document.getElementById('topbar')!).position,
      field: field.width,
      fieldH: field.height,
      below: tb.top - field.bottom,
      beside: tb.left - field.right,
      inside: Math.min(tb.left - field.left, field.right - tb.right),
      both: tb.bottom - field.top,
      tbH: tb.height,
      tbRight: tb.right,
      minTile: Math.min(...tiles.map((b) => b.getBoundingClientRect().width)),
      capOver: Math.max(
        ...tiles.map((b) => {
          const c = b.querySelector<HTMLElement>('.tb-cap');
          return c ? c.getBoundingClientRect().width - b.clientWidth : 0;
        })
      ),
    };
  });
  expect(m.topbar, label + ': шапка в бою липне').toBe('static');
  expect(m.panelRight, label + ': панель бою за правим краєм').toBeLessThanOrEqual(m.winW);
  // Т.122: прокрутку 10 px на 320 px у CI давала панель «Дослідження» (шрифт CI ширший) — гейт знову на всю сторінку
  // панель має бути видимою (вкладка «Вузол»), інакше гейт порожній (аудит PR #437); межу @container (269 px)
  // з усіх чотирьох розмірів перетинає лише 320 × 568 (панель 198 px), решта — рядок кроків
  expect(m.researchW, label + ': панель «Дослідження» не видно').toBeGreaterThan(0);
  expect(m.research, label + ': вміст «Дослідження» за правим краєм панелі').toBeLessThanOrEqual(0.5);
  expect(m.page, label + ': сторінка ширша за вікно').toBeLessThanOrEqual(m.winW);
  expect(m.field, label + ': поле менше за межу').toBeGreaterThanOrEqual(minField);
  expect(Math.abs(m.field - m.fieldH), label + ': поле не квадратне').toBeLessThanOrEqual(1);
  expect(m.tbRight, label + ': плитки за правим краєм').toBeLessThanOrEqual(m.winW);
  expect(m.minTile, label + ': плитка вужча за 60 px').toBeGreaterThanOrEqual(60);
  expect(m.capOver, label + ': підпис плитки ширший за плитку').toBeLessThanOrEqual(0);
  if (portrait) {
    expect(m.below, label + ': плитки не під полем').toBeGreaterThanOrEqual(0);
    expect(m.inside, label + ': плитки ширші за поле').toBeGreaterThanOrEqual(-1);
    expect(m.both, label + ': поле з плитками вище за вікно').toBeLessThanOrEqual(m.win);
  } else {
    expect(m.beside, label + ': плитки не поруч із полем').toBeGreaterThanOrEqual(0);
    expect(m.fieldH, label + ': поле вище за вікно').toBeLessThanOrEqual(m.win);
    expect(m.tbH, label + ': плитки вищі за вікно').toBeLessThanOrEqual(m.win);
  }
  await expectSquadStrip(page, label, false); // Т.130: ряд над полем
}

// Т.32: бій у межах вікна — поле, плитки дій, підказка і журнал видно без
// прокрутки; minField — найменша сторона поля для цього розміру вікна.
async function expectBattleFits(page: Page, label: string, minField: number): Promise<void> {
  const m = await page.evaluate(() => {
    const box = (id: string) => document.getElementById(id)!.getBoundingClientRect();
    const focus = document.getElementById('focus')!;
    return {
      win: window.innerHeight,
      winW: window.innerWidth,
      page: document.documentElement.scrollHeight,
      field: box('battle').width,
      fieldH: box('battle').height,
      bottoms: [box('battle').bottom, box('btoolbar').bottom, box('binfo').bottom, box('journal').bottom],
      rights: [box('btoolbar').right, box('binfo').right, box('journal').right],
      overlap: box('btoolbar').left - box('battle').right,
      side: box('binfo').left - box('btoolbar').right,
      log: box('log').height,
      scroll: focus.scrollHeight - focus.clientHeight,
    };
  });
  expect(m.page, label + ': сторінка вища за вікно').toBeLessThanOrEqual(m.win);
  expect(Math.max(...m.bottoms), label + ': поле, плитки, підказка або журнал нижче вікна').toBeLessThanOrEqual(m.win);
  expect(Math.max(...m.rights), label + ': плитки, підказка або журнал за правим краєм').toBeLessThanOrEqual(m.winW);
  expect(m.scroll, label + ': фокусна зона прокручується').toBeLessThanOrEqual(0);
  expect(m.field, label + ': поле менше за межу').toBeGreaterThanOrEqual(minField);
  expect(Math.abs(m.field - m.fieldH), label + ': поле не квадратне').toBeLessThanOrEqual(1);
  expect(m.overlap, label + ': плитки дій накладаються на поле').toBeGreaterThanOrEqual(0);
  expect(m.side, label + ': плитки дій накладаються на підказку').toBeGreaterThanOrEqual(0);
  expect(m.log, label + ': у журналі менше двох рядків').toBeGreaterThanOrEqual(40);
  await expectSquadStrip(page, label, true); // Т.130
}

// Т.131 (ADR-0120): меню на ворогові — видно, у межах поля, не на клітинці демона, кнопки ≥ 40 px
// заввишки, шанс швидкого пострілу — як у дзеркалі (обчислені рамки, від шрифту не залежить)
async function expectEnemyMenu(page: Page, mirror: CoreMirror, shot: NonNullable<ReturnType<CoreMirror['shotOption']>>): Promise<void> {
  const menu = page.locator('#benemy');
  await expect(menu).toBeVisible();
  await expect(menu.locator('.em-name')).toHaveText(shot.target.name);
  await expect(menu.locator('.em-hpn')).toHaveText('HP ' + shot.target.hp + '/' + shot.target.maxHp);
  await expect(menu.locator('[data-act="snap"] .em-meta')).toHaveText(
    shot.shooter.weapon.modes.snap.apCost + ' AP · ~' + mirror.shotOption('snap')!.chancePct + '%'
  );
  const check = async (label: string): Promise<void> => {
    const m = await page.evaluate(
      ([cell, w]) => {
        const f = document.getElementById('battle')!.getBoundingClientRect();
        const b = document.getElementById('benemy')!.getBoundingClientRect();
        const k = f.width / w;
        const c = {
          left: f.left + cell.x * k,
          top: f.top + cell.y * k,
          right: f.left + (cell.x + 1) * k,
          bottom: f.top + (cell.y + 1) * k,
        };
        const all = [...document.querySelectorAll('#benemy button')];
        const btns = all.map((x) => x.getBoundingClientRect().height);
        // текст ширший за кнопку (вузька кнопка, шрифт CI ширший — Т.122)
        const wide = Math.max(...all.map((x) => x.scrollWidth - x.clientWidth));
        const over = Math.min(b.right, c.right) - Math.max(b.left, c.left) > 0 && Math.min(b.bottom, c.bottom) - Math.max(b.top, c.top) > 0;
        return { out: Math.max(f.left - b.left, f.top - b.top, b.right - f.right, b.bottom - f.bottom), over, btns, wide };
      },
      [shot.target.pos, MISSION_MAP_W] as const
    );
    expect(m.out, label + ': меню на ворогові за межами поля').toBeLessThanOrEqual(1);
    expect(m.over, label + ': меню на ворогові накриває клітинку демона').toBe(false);
    expect(m.btns, label + ': кнопки меню — три постріли і граната').toHaveLength(4);
    expect(Math.min(...m.btns), label + ': кнопка меню нижча за 40 px').toBeGreaterThanOrEqual(40);
    expect(m.wide, label + ': текст кнопки меню ширший за кнопку').toBeLessThanOrEqual(0);
  };
  await check('1440 × 900');
  // низьке вікно сітки і телефон: поле менше — картка біля демона, а не на ньому (виміри Т.131)
  const vp = page.viewportSize()!;
  for (const [w, h] of [
    [1100, 540],
    [390, 844],
  ]) {
    // картка лишається відкритою: слухач resize переставляє її на новому полі (аудит PR #444)
    await page.setViewportSize({ width: w, height: h });
    await page.locator('#battle').scrollIntoViewIfNeeded();
    await expect(menu).toBeVisible();
    await check(w + ' × ' + h);
  }
  await page.keyboard.press('Escape');
  await page.setViewportSize(vp);
  await tap(page, shot.target.pos);
  await expect(menu).toBeVisible();
}

// Стан загону на сторінці = стан у дзеркалі: вибираємо кожного живого
// оперативника і звіряємо його рядок HP/AP. Після ходу демонів це ловить
// розбіжність у їхніх пострілах і реакційному вогні дозору.
// Т.33: «Кінець» → плашка ходу демонів (хід гравця ще не починається) → підсумок ходу в правій частині панелі.
// Т.117: skip — пропуск плашки тапом по оперативнику (тап до поля не доходить: вибір не змінюється) або пробілом.
async function endTurnOnPage(page: Page, mirror: CoreMirror, skip: 'tap' | 'space' | null = null): Promise<number> {
  await page.locator('#btn-end').click();
  const actions = mirror.endPlayerTurn();
  if (mirror.outcome() !== 'триває') return actions;
  const plate = page.locator('#bturn');
  await expect(plate).toHaveText('ХІД ДЕМОНІВ РОЗРИВУ…Демони діють. Зачекайте.Клік / пробіл / Esc — пропустити');
  await expect(page.locator('#btn-end')).toBeDisabled();
  await expect(page.locator('#bctx-turn')).toHaveText('хід демонів Розриву');
  await expect(page.locator('#binfo')).toHaveText('');
  const selCard = page.locator('#bsquad .sq-card.sel');
  const unitBefore = await page.evaluate(() => document.querySelector('#bsquad .sq-card.sel')?.getAttribute('aria-label') ?? null);
  if (skip === 'tap') await tap(page, mirror.squad()[0].pos);
  if (skip === 'space') await page.keyboard.press('Space');
  // без пропуску плашка тримається ≥ 1 с; пропуск дає підсумок одразу
  await expect(plate).toHaveClass('done', skip === null ? {} : { timeout: 500 });
  if (unitBefore === null) await expect(selCard).toHaveCount(0);
  else await expect(selCard).toHaveAttribute('aria-label', unitBefore);
  await expect(plate).toHaveText(mirror.turnSummary);
  return actions;
}

// Т.130: вибір бійця — тапом на полі, карткою смуги загону і клавішею Q (наступний по колу);
// вибрана картка несе рядок юніта (колишня плашка «Юніт»)
async function expectSquad(page: Page, mirror: CoreMirror): Promise<void> {
  const squad = mirror.squad();
  const sel = page.locator('#bsquad .sq-card.sel');
  // аудит PR #443: картка — іншого бійця, ніж щойно вибраний тапом (інакше поломка кліку не видна)
  for (const [i, soldier] of squad.entries()) {
    await tap(page, soldier.pos);
    await expect(sel).toHaveAttribute('aria-label', unitLine(soldier));
    const other = squad[(i + 1) % squad.length];
    await page.locator(`#bsquad .sq-card[data-unit="${other.id}"]`).click();
    await expect(sel).toHaveAttribute('aria-label', unitLine(other));
  }
  // Q — з першого на наступного і з останнього по колу на першого
  await tap(page, squad[0].pos);
  await page.keyboard.press('KeyQ');
  await expect(sel).toHaveAttribute('aria-label', unitLine(squad[1 % squad.length]));
  await tap(page, squad[squad.length - 1].pos);
  await page.keyboard.press('KeyQ');
  await expect(sel).toHaveAttribute('aria-label', unitLine(squad[0]));
  await expect(sel).toHaveCount(1);
}

// Т.130: смуга загону — стовпчик праворуч від поля (сітка бою) або ряд над полем (телефон, вужче за 900 px);
// картки у вікні, ім'я не обрізане
async function expectSquadStrip(page: Page, label: string, column: boolean): Promise<void> {
  const m = await page.evaluate(() => {
    const field = document.getElementById('battle')!.getBoundingClientRect();
    const cards = [...document.querySelectorAll<HTMLElement>('#bsquad .sq-card')].map((c) => {
      const r = c.getBoundingClientRect();
      const n = c.querySelector<HTMLElement>('.sq-name')!;
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, cut: n.scrollWidth - n.clientWidth };
    });
    return { field: { left: field.left, right: field.right, top: field.top }, cards, winW: window.innerWidth };
  });
  expect(m.cards.length, label + ': смуги загону немає').toBeGreaterThan(0);
  for (const c of m.cards) {
    expect(c.right, label + ': картка за правим краєм').toBeLessThanOrEqual(m.winW);
    expect(c.cut, label + ': ім’я на картці обрізане').toBeLessThanOrEqual(0);
    if (column) expect(c.left, label + ': картка не праворуч від поля').toBeGreaterThan(m.field.right);
    else expect(c.bottom, label + ': картка не над полем').toBeLessThanOrEqual(m.field.top);
  }
  const tops = new Set(m.cards.map((c) => Math.round(c.top)));
  // стовпчик — кожна картка своїм рядком; ряд — один рядок (загін до трьох)
  expect(tops.size, label + ': розкладка карток').toBe(column ? m.cards.length : 1);
}

test('сценарій приймання ADR-0030: партія → місія → бій до результату → геосцена → сейв/лоад', async ({ page }) => {
  const errors = watchErrors(page);
  const mirror = new CoreMirror(SEED, PRESET);
  const clock = page.locator('#clock');
  const unit = page.locator('#bsquad .sq-card.sel'); // Т.130: вибрана картка смуги загону
  const info = page.locator('#binfo');

  await test.step('старт: стартовий екран → нова партія', async () => {
    await page.goto('./');
    await expect(page).toHaveTitle(/Рубіж/);
    const helpClose = page.locator('#btn-help-close'); // перший візит — «Як грати» поверх стартового екрана
    if (await helpClose.isVisible()) await helpClose.click();
    await page.locator('#btn-start-new').click();
    await page.locator('#new-game-seed').fill(String(SEED));
    await page.locator('#new-game-preset').selectOption(PRESET);
    await page.locator('#btn-new-game-start').click();
    await expect(page.locator('#geo')).toBeVisible();
    await expect(page.locator('#log')).toContainText('Нова партія (сід ' + SEED + ', складність «' + PRESET + '»)');
    await expect(clock).toHaveText(mirror.clock());
  });

  await test.step('геосцена: тіки до приземлення зонда', async () => {
    for (let i = 0; i < MAX_TICKS_TO_MISSION && mirror.targets().length === 0; i++) {
      await page.locator('#btn-tick').click();
      mirror.tick();
    }
    expect(mirror.targets().length, 'на сіді ' + SEED + ' зонд не приземлився за дві доби').toBeGreaterThan(0);
    await expect(clock).toHaveText(mirror.clock());
    await expect(page.locator('#ufos .ufo')).toHaveCount(mirror.detected().length);
    await expect(page.locator('#ufos button.mission')).toHaveCount(mirror.targets().length);
    // Т.7: дія чекає на вкладці «Вузол» — лічильник видно з вкладки «Загін»
    await expect(page.locator('#status-tab-base .tab-badge')).toBeVisible();
    await expectIcons(page, '#status-tabs button svg.tab-icon', 16, 2); // Т.123: іконки вкладок колонки стану (Т.128: без «Системи»)
    // Т.128 (ADR-0117): іконки заголовків панелей колонки і кнопки вербування — у рядку перед текстом
    await expectIcons(page, '#status section.panel:not(.hidden) h2 svg.h-icon', 16, 2, 'y');
    await expectIcons(page, '#btn-hire svg.btn-icon', 16, 1, 'y');
    await page.locator('#status-tab-base').click();
    await expectIcons(page, '#status section.panel:not(.hidden) h2 svg.h-icon', 16, 3, 'y'); // п19.4: «Мета кампанії» і перехоплювачі — у #mid
    await expectIcons(page, '#mid section.panel h2 svg.h-icon', 16, 3, 'y'); // п19.4: середня колонка — три панелі
    await expectIcons(page, '#btn-hire-scientist svg.btn-icon', 16, 1, 'y');
    // заголовок «Сенсорна сітка» з іконкою — в один рядок (рішення власника Т.128; від шрифту — запас ≈ 100 px)
    expect(
      await page
        .locator('#status section.panel h2')
        .first()
        .evaluate((h) => h.getBoundingClientRect().height)
    ).toBeLessThan(24);
    await page.locator('#status-tab-squad').click();
    await expectLook(page); // Т.124: вигляд набору інтерфейсу
    // Т.129 (ADR-0118): аватар «шолом» у кожному рядку ростера — колір бійця за id
    const avatars = page.locator('#roster .soldier svg.avatar');
    await expect(avatars).toHaveCount(FIGHTER_COLORS.length);
    expect(await avatars.evaluateAll((a) => a.map((s) => s.getAttribute('data-color')))).toEqual([...FIGHTER_COLORS]);
  });

  // п19.4 (ADR-0159 п. 5, 15; EARS 8): на 1366 × 768 мапа — ≈ половина ширини ліворуч, журнал під нею,
  // середня колонка («Мета кампанії», «Регіони», «Перехоплювачі») між мапою і вкладками; на 1024 × 768 —
  // одна права колонка (середні панелі над вкладками); на телефоні — мапа зверху, середня колонка під нею
  await test.step('п19.4: компоновка «Мапа + дві колонки»', async () => {
    const vp = page.viewportSize()!;
    const geom = () =>
      page.evaluate(() => {
        const r = (id: string) => document.getElementById(id)!.getBoundingClientRect();
        return {
          map: r('geo'),
          journal: r('journal'),
          mid: r('mid'),
          status: r('status'),
          regions: document.querySelectorAll('#regions .region').length,
        };
      });
    await page.setViewportSize({ width: 1366, height: 768 });
    const g = await geom();
    expect(g.regions, 'рядків «Регіони»').toBe(4);
    expect(g.map.width / 1366, 'частка ширини мапи на 1366 × 768').toBeGreaterThan(0.45);
    expect(g.map.width / 1366, 'частка ширини мапи на 1366 × 768').toBeLessThan(0.6);
    expect(g.journal.top, 'журнал — під мапою').toBeGreaterThanOrEqual(g.map.bottom);
    expect(g.mid.left, 'середня колонка — праворуч від мапи').toBeGreaterThanOrEqual(g.map.right);
    expect(g.status.left, 'вкладки — праворуч від середньої колонки').toBeGreaterThanOrEqual(g.mid.right);
    expect(Math.abs(g.mid.top - g.status.top), 'середня колонка і вкладки — від одного верху').toBeLessThanOrEqual(1);
    await page.setViewportSize({ width: 1024, height: 768 });
    const ipad = await geom();
    expect(ipad.mid.left, '1024: середня колонка — над вкладками, у правій колонці').toBe(ipad.status.left);
    expect(ipad.status.top, '1024: вкладки — під середньою колонкою').toBeGreaterThanOrEqual(ipad.mid.bottom);
    expect(ipad.map.width, '1024: мапа — як до п19.4 (≈ 640 px)').toBeGreaterThan(600);
    await page.setViewportSize({ width: 390, height: 844 });
    const phone = await geom();
    expect(phone.mid.top, '390: середня колонка — під мапою').toBeGreaterThanOrEqual(phone.map.bottom);
    expect(phone.journal.top, '390: журнал — під середньою колонкою').toBeGreaterThanOrEqual(phone.mid.bottom);
    await page.setViewportSize(vp);
  });

  // Т.31: геосцена, журнал і колонка стану — в одному екрані; сторінка не
  // прокручується на жодній вкладці, журнал видно і він розгортається в межах вікна.
  await test.step('геосцена: екран без прокрутки, журнал у вікні', async () => {
    const fits = (): Promise<{ page: number; journal: number; log: number; win: number; map: number; gap: number }> =>
      page.evaluate(() => ({
        page: document.documentElement.scrollHeight,
        journal: document.getElementById('journal')!.getBoundingClientRect().bottom,
        log: document.getElementById('log')!.getBoundingClientRect().height,
        win: window.innerHeight,
        map: document.getElementById('geo')!.getBoundingClientRect().height,
        gap:
          document.getElementById('journal')!.getBoundingClientRect().top -
          document.getElementById('geo-panel')!.getBoundingClientRect().bottom,
      }));
    for (const tab of ['squad', 'base']) {
      await page.locator('#status-tab-' + tab).click();
      const m = await fits();
      expect(m.page, 'вкладка ' + tab + ': сторінка вища за вікно').toBeLessThanOrEqual(m.win);
      expect(m.journal, 'вкладка ' + tab + ': журнал нижче вікна').toBeLessThanOrEqual(m.win);
      expect(m.log, 'вкладка ' + tab + ': у журналі менше двох рядків').toBeGreaterThanOrEqual(40);
      // п19.4 (ADR-0159 п. 5, рішення власника «А. Мапа + дві колонки»): мапа — ≈ половина ширини, тож нижча за
      // половину вікна (на 1440 × 900 — ≈ 0,48); межа Т.31 «≥ ½ висоти» — тепер ≥ 0,45
      expect(m.map, 'вкладка ' + tab + ': карта нижча за 0,45 вікна').toBeGreaterThanOrEqual(m.win * 0.45);
      expect(m.gap, 'вкладка ' + tab + ': порожнеча між картою і журналом').toBeLessThanOrEqual(16);
    }
    await page.locator('#btn-log-expand').click();
    await expect(page.locator('#log-tab-econ')).toBeVisible();
    await expectIcons(page, '#log-tabs button svg.tab-icon', 16, 5); // Т.123: іконки фільтрів журналу
    const open = await fits();
    expect(open.page).toBeLessThanOrEqual(open.win);
    expect(open.journal).toBeLessThanOrEqual(open.win);
    expect(open.log).toBeGreaterThanOrEqual(200);
    await page.locator('#btn-log-expand').click();
    await expect(page.locator('#log-tab-econ')).toBeHidden();
    await page.locator('#status-tab-squad').click();
  });

  // T.39 «Зрозуміла наука»: картка протоколу (назва, плашка, «Час ≈»; Т.100 — без «Ціна», згорнуті картки), смуга кроків
  // («3. Видати» перемикає на «Загін»), лічильник на вкладці «Загін», розмір «Як грати» на 1366 × 768 і 1024 × 768.
  await test.step('T.39: панель «Дослідження», крок «3. Видати», довідка на 1366 × 768', async () => {
    await page.locator('#status-tab-base').click();
    const cards = page.locator('#research .sci-card');
    await expect(cards).toHaveCount(9); // п18.5 (ADR-0157): + три ключові протоколи
    const armor = cards.first();
    await expect(armor.locator('.sci-name')).toHaveText('Композитна броня');
    await expect(armor.locator('.sci-badge')).toHaveText('потрібен техномант'); // техномантів 0, кредитів вистачає
    await expect(armor).not.toContainText('Ціна'); // Т.100: ціна — лише на кнопці
    await expect(armor).toContainText('Час ≈ 14 діб, з двома — 7'); // K = 0 (Т.100, варіант В)
    // Т.100: картки з невиконаною передумовою згорнуті до кнопки-назви з плашкою; панель на новій партії
    // вікно сценарію тут 1440 × 900 (колонка тієї ж ширини): локально 1048 px, як на 1366 × 768 (до кроку 1516;
    // docs/reports/t100/measure.mjs); межа з запасом на шрифти CI
    await expect(page.locator('#research .sci-card.folded')).toHaveCount(5); // п18.5: + три ключові (без трофеїв — згорнуті)
    // у згорнутій картці — лише кнопка-назва; тап показує рядок ефекту
    await expect(page.locator('#research .sci-card.folded button:not(.sci-toggle)')).toHaveCount(0);
    await page.locator('#btn-sci-eff-grenade').click();
    await expect(page.locator('#research .sci-card.folded .sci-eff')).toContainText('зачіпає і своїх');
    await page.locator('#btn-sci-eff-grenade').click();
    await expect(page.locator('#research .sci-card.folded .sci-eff')).toHaveCount(0);
    const researchH = await page.evaluate(() =>
      Math.round(document.getElementById('research')!.closest('section')!.getBoundingClientRect().height)
    );
    // п18.5 (ADR-0157): блок ключових протоколів (заголовок і три згорнуті картки) міряється окремо —
    // гейт Т.100 стоїть на частині до нього; блок на новій партії — локально ≈ 290 px
    const keyH = await page.evaluate(() => {
      const head = document.querySelector('#research .sci-key-head')!.getBoundingClientRect();
      return Math.round(document.getElementById('research')!.closest('section')!.getBoundingClientRect().bottom - head.top);
    });
    expect(researchH - keyH, 'висота панелі «Дослідження» без ключових протоколів').toBeLessThanOrEqual(1150); // варіант Б без А — 1193
    expect(keyH, 'висота блоку ключових протоколів').toBeLessThanOrEqual(340);
    await expect(armor.locator('#btn-start-0')).toHaveText('Дослідити — 96 кр.');
    await expect(page.locator('#btn-hire-scientist')).toHaveText('Вербувати техноманта (100)'); // Т.128
    // смуга кроків: три кнопки; «3. Видати» перемикає вкладку на «Загін»
    await expect(page.locator('#btn-sci-step-1')).toBeEnabled();
    await expect(page.locator('#btn-sci-step-2')).toBeEnabled();
    await page.locator('#btn-sci-step-2').click();
    // крок 2: панель «Кузня» (#workshop) відображається всередині колонки #status
    await expect(page.locator('#workshop')).toBeVisible();
    const workshopInView = await page.evaluate(() => {
      const col = document.querySelector<HTMLElement>('#status')!.getBoundingClientRect();
      const w = document.querySelector<HTMLElement>('#workshop')!.getBoundingClientRect();
      // п19.4: з рядком купівлі перехоплювача «Кузня» (≈ 950 px) вища за колонку (≈ 825 px на 1440 × 900) —
      // у видимій частині мають бути верх панелі і перший рядок каталогу, а не вся панель
      const first = document.querySelector<HTMLElement>('#workshop .ufo')!.getBoundingClientRect();
      return w.height > col.height
        ? w.top >= col.top - 1 && first.bottom <= col.bottom + 1
        : w.top >= col.top - 1 && w.bottom <= col.bottom + 1;
    });
    expect(workshopInView, '#workshop має бути у видимій частині колонки після кроку 2').toBe(true);
    // Т.43: причина неактивної кнопки — рядком під нею (на iPad підказки title не видно)
    await expect(page.locator('#btn-order-armor + .btn-why')).toHaveText('Ще не досліджено');
    // у «Кузні» причина — поруч із кнопкою (панель не росте на рядок за кожну кнопку),
    // кольором попередження Т.24. Т.80: кнопка й причина — одна рядкова flex-група
    // .order-line, тому причина на лінії кнопки за будь-якого шрифту (у CI раніше
    // переносилась під кнопку): центри по вертикалі збігаються, причина праворуч.
    const whyBox = await page.evaluate(() => {
      const w = document.querySelector<HTMLElement>('#btn-order-armor + .btn-why')!;
      const b = document.getElementById('btn-order-armor')!.getBoundingClientRect();
      const r = w.getBoundingClientRect();
      const line = w.parentElement!;
      return {
        line: line.className,
        display: getComputedStyle(line).display,
        dy: Math.abs((r.top + r.bottom) / 2 - (b.top + b.bottom) / 2),
        right: r.left >= b.right,
        color: getComputedStyle(w).color,
      };
    });
    expect(whyBox.line, 'причина в «Кузні» має бути в групі з кнопкою «Замовити»').toBe('order-line');
    expect(whyBox.display, 'група кнопки й причини в «Кузні» — рядкова flex-група').toBe('inline-flex');
    expect(whyBox.dy, 'причина в «Кузні» з’їхала з лінії кнопки «Замовити»').toBeLessThanOrEqual(1);
    expect(whyBox.right, 'причина в «Кузні» має стояти праворуч від кнопки').toBe(true);
    // довга причина («Недостатньо кредитів (ціна N)») ламається поруч із кнопкою, а не під неї
    // (аудит PR #394: коротка причина вміщується за будь-якого правила)
    const longWhy = await page.evaluate(() => {
      const w = document.querySelector<HTMLElement>('#btn-order-armor + .btn-why')!;
      const keep = w.textContent;
      w.textContent = 'Недостатньо кредитів (ціна 128)';
      const b = document.getElementById('btn-order-armor')!.getBoundingClientRect();
      const r = w.getBoundingClientRect();
      const row = w.closest('.ufo')!.getBoundingClientRect();
      w.textContent = keep;
      return { dy: Math.abs((r.top + r.bottom) / 2 - (b.top + b.bottom) / 2), right: r.left >= b.right, inRow: r.right <= row.right };
    });
    expect(longWhy.dy, 'довга причина в «Кузні» з’їхала з лінії кнопки').toBeLessThanOrEqual(1);
    expect(longWhy.right, 'довга причина в «Кузні» має стояти праворуч від кнопки').toBe(true);
    expect(longWhy.inRow, 'довга причина в «Кузні» виходить за рядок каталогу').toBe(true);
    expect(whyBox.color, 'колір рядка-причини — як у попередження .mission-warn').toBe('rgb(224, 166, 58)');
    await page.locator('#btn-sci-step-3').click();
    await expect(page.locator('#status-tab-squad')).toHaveClass(/active/);
    // лічильник «Загін»: склад порожній — бейджа нема
    await expect(page.locator('#status-tab-squad .tab-badge')).toHaveCount(0);
    await page.locator('#status-tab-base').click();
    // «Як грати» на 1366 × 768: блок «Наука і спорядження» вміщується без прокрутки
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.locator('#btn-menu').click();
    await page.locator('#btn-menu-help').click();
    await expect(page.locator('#help-screen')).toBeVisible();
    await expect(page.locator('#help-screen')).toContainText('Наука і спорядження');
    const help = await page.evaluate(() => {
      const r = document.querySelector<HTMLElement>('#help-screen .help-box')!.getBoundingClientRect();
      return { h: Math.round(r.height), w: Math.round(r.width), win: window.innerHeight, page: document.documentElement.scrollHeight };
    });
    expect(help.h, 'екран «Як грати» вищий за вікно на 1366×768').toBeLessThanOrEqual(help.win - 32);
    expect(help.page, 'сторінка з довідкою довша за вікно на 1366×768').toBeLessThanOrEqual(help.win);
    await page.locator('#btn-help-close').click();
    // та сама перевірка довідки на 1024 × 768
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.locator('#btn-menu').click();
    await page.locator('#btn-menu-help').click();
    await expect(page.locator('#help-screen')).toBeVisible();
    await expect(page.locator('#help-screen')).toContainText('Наука і спорядження');
    const helpSmall = await page.evaluate(() => {
      const r = document.querySelector<HTMLElement>('#help-screen .help-box')!.getBoundingClientRect();
      return { h: Math.round(r.height), win: window.innerHeight, page: document.documentElement.scrollHeight };
    });
    expect(helpSmall.h, 'екран «Як грати» вищий за вікно на 1024×768').toBeLessThanOrEqual(helpSmall.win - 32);
    expect(helpSmall.page, 'сторінка з довідкою довша за вікно на 1024×768').toBeLessThanOrEqual(helpSmall.win);
    await page.locator('#btn-help-close').click();
    // Т.43: з третьою кнопкою часу шапка на 1024 × 768 лишається в один рядок
    // (кнопки часу на одній висоті з чипами), сторінка — у вікні
    const bar = await page.evaluate(() => {
      const top = (sel: string): number => Math.round(document.querySelector(sel)!.getBoundingClientRect().top);
      return {
        chips: top('#topbar .chips'),
        event: top('#btn-event'),
        page: document.documentElement.scrollHeight,
        win: window.innerHeight,
      };
    });
    expect(Math.abs(bar.event - bar.chips), 'кнопки часу з’їхали в другий рядок шапки на 1024×768').toBeLessThanOrEqual(8);
    // рядок «Наступний крок» на 1024 × 768: видимий, у заголовку «Геосцени» (Т.80), не обрізаний;
    // шапка — один ряд: низ шапки не нижчий за низ кнопок часу більш ніж на рамку з полем
    const stepSmall = await page.evaluate(() => {
      const s = document.getElementById('next-step')!;
      const r = s.getBoundingClientRect();
      const h2 = document.querySelector('#geo-head h2')!.getBoundingClientRect();
      const bar = document.getElementById('topbar')!.getBoundingClientRect();
      const acts = document.querySelector('#topbar .actions')!.getBoundingClientRect();
      return {
        h: r.height,
        row: r.top < h2.bottom && r.bottom > h2.top && r.left >= h2.right,
        fits: s.scrollWidth <= s.clientWidth,
        barTail: bar.bottom - acts.bottom,
        headTail: document.getElementById('geo-head')!.getBoundingClientRect().bottom - h2.bottom,
      };
    });
    expect(stepSmall.h, 'рядок «Наступний крок» не видно на 1024×768').toBeGreaterThan(0);
    expect(stepSmall.row, 'рядок «Наступний крок» — праворуч від «Геосцена», в одному ряду').toBe(true);
    expect(stepSmall.fits, 'текст рядка «Наступний крок» обрізано на 1024×768').toBe(true);
    expect(stepSmall.barTail, 'шапка на 1024×768 має другий ряд під кнопками').toBeLessThanOrEqual(16);
    // виграш висоти не має зникнути в заголовку «Геосцени»: під h2 — лише його поле 8 px
    expect(stepSmall.headTail, 'заголовок «Геосцени» вищий за назву на 1024×768').toBeLessThanOrEqual(9);
    expect(bar.page, 'сторінка довша за вікно на 1024×768').toBeLessThanOrEqual(bar.win);
    // Т.97 (варіант В власника 21.11.2026): до 940 px префікс «Наступний крок:» заміняє стрілка;
    // на 920 × 800 найдовша порада (решта підставлена в span тимчасово) — в одному ряду з «Геосцена»
    await page.setViewportSize({ width: 920, height: 800 });
    const LONGEST = 'гарматний модуль на складі — встановіть на перехоплювач';
    const narrow = await page.evaluate((longest) => {
      const s = document.getElementById('next-step')!;
      const rest = s.querySelector<HTMLElement>('.ns-rest')!;
      const was = rest.textContent;
      const full = s.textContent ?? '';
      rest.textContent = longest;
      const r = s.getBoundingClientRect();
      const h2 = document.querySelector('#geo-head h2')!.getBoundingClientRect();
      const out = {
        prefix: getComputedStyle(s.querySelector('.ns-prefix')!).display,
        arrow: getComputedStyle(rest, '::before').content,
        label: s.getAttribute('aria-label') === full && full.startsWith('Наступний крок: '),
        row: r.top < h2.bottom && r.bottom > h2.top && r.left >= h2.right,
        fits: s.scrollWidth <= s.clientWidth,
        headTail: document.getElementById('geo-head')!.getBoundingClientRect().bottom - h2.bottom,
      };
      rest.textContent = was;
      return out;
    }, LONGEST);
    expect(narrow.prefix, 'префікс «Наступний крок:» видно на 920 px').toBe('none');
    expect(narrow.arrow, 'стрілки перед порадою немає на 920 px').toBe('"→ "');
    expect(narrow.label, 'aria-label — не повний текст поради з префіксом').toBe(true);
    expect(narrow.row, 'найдовша порада на 920 px — не в одному ряду з «Геосцена»').toBe(true);
    expect(narrow.fits, 'найдовшу пораду обрізано на 920 px').toBe(true);
    expect(narrow.headTail, 'заголовок «Геосцени» вищий за назву на 920 px').toBeLessThanOrEqual(9);
    // межа @media: 940 px — префікс сховано, 941 px — видно (аудит Vibe PR #412)
    const prefixAt = async (width: number): Promise<string> => {
      await page.setViewportSize({ width, height: 800 });
      return page.evaluate(() => getComputedStyle(document.querySelector('#next-step .ns-prefix')!).display);
    };
    expect(await prefixAt(940), 'префікс «Наступний крок:» видно на 940 px').toBe('none');
    expect(await prefixAt(941), 'префікс «Наступний крок:» сховано на 941 px').not.toBe('none');
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  await test.step('Т.47: «Продовжити» після виходу з бою — сейв завантажено, старого бою немає', async () => {
    const saved = mirror.clock();
    await openSave(page); // Т.128: «Збереження» — вікно з «Меню»
    await page.locator('#btn-save-1').click();
    await expect(page.locator('#log')).toContainText('Збережено: слот 1.');
    await page.locator('#btn-save-close').click();
    // тік і бій — лише на сторінці: дзеркало лишається на точці сейву, а годинник покинутої партії йде далі
    await page.locator('#btn-tick').click();
    await expect(clock).not.toHaveText(saved);
    await page.locator('#status-tab-base').click();
    await page.locator('#ufos button.mission').first().click();
    await expect(page.locator('#battle-panel')).toBeVisible();
    // Т.48: авто-бій запущено до виходу і справді йде — у журналі з'явились його рядки
    const logBeforeAuto = await page.locator('#log').innerHTML();
    await page.locator('#btn-auto-battle').click();
    await expect.poll(() => page.locator('#log').innerHTML(), { timeout: 15_000 }).not.toBe(logBeforeAuto);
    // Т.116 (варіант Б): і в авто-бої хід демонів — плашка, далі підсумок (бій без дзеркала — лише вигляд і заголовок)
    const plate = page.locator('#bturn');
    await expect(plate).toHaveText('ХІД ДЕМОНІВ РОЗРИВУ…Демони діють. Зачекайте.', { timeout: AUTO_BATTLE_TIMEOUT_MS });
    await expect(page.locator('#bctx-turn')).toHaveText('хід демонів Розриву');
    await expect(plate).toHaveClass('done', { timeout: AUTO_BATTLE_TIMEOUT_MS });
    await expect(plate).toContainText(/^ХІД ДЕМОНІВ РОЗРИВУ — ПІДСУМОК.*Демонів у полі зору: \d+$/);
    await expect(page.locator('#btn-auto-battle')).toContainText('Стоп'); // підсумок авто-бій не зупиняє
    await page.locator('#btn-menu').click();
    await page.locator('#btn-menu-exit').click();
    await page.locator('#btn-exit-yes').click();
    await expect(page.locator('#start-screen')).toBeVisible();
    // Т.48: вихід зупиняє все — бій закрито вже на стартовому екрані, авто-бій далі не йде
    await expect(page.locator('#battle-panel')).toHaveClass(/hidden/);
    await expect(page.locator('#layout')).not.toHaveClass(/in-battle/);
    // три секунди на стартовому екрані (рядки авто-бою йдуть щонайрідше раз на ≈ 2 с): журнал
    // не змінюється і жоден цикл анімації (бій, геосцена, ambient) не планує кадрів
    const logAtExit = await page.locator('#log').innerHTML();
    const frames = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          let n = 0;
          const orig = window.requestAnimationFrame;
          window.requestAnimationFrame = (cb) => {
            n++;
            return orig.call(window, cb);
          };
          setTimeout(() => {
            window.requestAnimationFrame = orig;
            resolve(n);
          }, 3000);
        })
    );
    expect(frames, 'після виходу на стартовий екран хтось планує кадри анімації').toBe(0);
    expect(await page.locator('#log').innerHTML(), 'журнал змінився після виходу на стартовий екран').toBe(logAtExit);
    await page.locator('#btn-start-continue').click();
    await expect(page.locator('#start-screen')).toBeHidden();
    await expect(page.locator('#battle-panel')).toBeHidden();
    await expect(page.locator('#geo-panel')).toBeVisible();
    await expect(page.locator('#next-step')).toBeVisible();
    await expect(clock).toHaveText(saved);
    await expect(page.locator('#log')).toContainText('Завантажено: слот 1 — ' + saved);
  });

  await test.step('Т.58: стартовий екран після виходу з геосцени — кадрів ніхто не планує', async () => {
    const saved = mirror.clock();
    // тік — лише на сторінці (стан повертає «Продовжити»): запускає скан-радар геосцени на 1,2 с
    await page.locator('#btn-tick').click();
    await expect(clock).not.toHaveText(saved);
    await page.locator('#btn-menu').click();
    await page.locator('#btn-menu-exit').click();
    await page.locator('#btn-exit-yes').click();
    await expect(page.locator('#start-screen')).toBeVisible();
    await page.evaluate(() => {
      const w = window as unknown as { t58Frames: number };
      const orig = window.requestAnimationFrame;
      w.t58Frames = 0;
      window.requestAnimationFrame = (cb) => {
        w.t58Frames++;
        return orig.call(window, cb);
      };
    });
    // повернення вкладки з фону і тумблер «Анімація» (вимк → увімк) ambient на стартовому екрані не будять
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.locator('#btn-start-settings').click();
    await page.locator('#settings-ambient').click();
    await expect(page.locator('#settings-ambient')).toHaveText('Анімація: вимк');
    await page.locator('#settings-ambient').click();
    await expect(page.locator('#settings-ambient')).toHaveText('Анімація: увімк');
    await page.locator('#settings-close').click();
    await page.waitForTimeout(1500);
    const frames = await page.evaluate(() => (window as unknown as { t58Frames: number }).t58Frames);
    expect(frames, 'на стартовому екрані хтось планує кадри анімації').toBe(0);
    await page.locator('#btn-start-continue').click();
    await expect(page.locator('#start-screen')).toBeHidden();
    await expect(clock).toHaveText(saved);
    // у грі ambient знову працює: цикл планує кадри
    await expect.poll(() => page.evaluate(() => (window as unknown as { t58Frames: number }).t58Frames)).toBeGreaterThan(0);
  });

  await test.step('запуск місії', async () => {
    const mission = mirror.launch(mirror.targets()[0].id);
    await page.locator('#status-tab-base').click();
    await page.locator('#ufos button.mission').first().click();
    await expect(page.locator('#battle-panel')).toBeVisible();
    await expect(page.locator('#bctx-kind')).toHaveText(mission.briefing.kind);
    await expect(page.locator('#next-step')).toBeHidden(); // Т.43: у бою рядка «Наступний крок» немає
    await expect(page.locator('#bctx-turn')).toHaveText('хід 1 · загін');
    await expect(unit).toHaveCount(0);
    // Т.32: розкладка бою на трьох розмірах вікна (журнал збоку / смугою)
    // Т.33: ціна в AP і клавіша — у кутках плиток дій
    // Т.71: плитка «Евакуація» — 2 AP, клавіша V
    // п16.4 (ADR-0147): плитка «Роль» — клавіша R, ціна за роллю вибраного (у новобранців ролі немає — порожньо)
    await expect(page.locator('#btoolbar .tb-key')).toHaveText(['1', '2', '3', 'O', 'M', 'G', 'R', 'V', 'E']);
    await expect(page.locator('#btoolbar .tb-ap')).toHaveText(['3 AP', '5 AP', '4 AP', '3 AP', '4 AP', '4 AP', '', '2 AP']); // snap, aimed, auto, дозор, гель, граната, роль, евакуація
    await expectIcons(page, '#btoolbar button svg.tb-icon', 36, 10); // Т.123: іконки плиток дій
    // Т.44: туман знебарвлено — у клітинках туману (без стіни, декору, юніта і м'якого краю) середній розкид
    // каналів max(R,G,B) − min(R,G,B) у центральній ділянці 24 × 24 px не більший за 9 (до Т.44 — 13,6–18,3);
    // видимі клітинки кольорові. Пікселі канви від шрифту машини не залежать.
    const seen = mirror.seen();
    const st = mirror.state;
    const plain = (x: number, y: number): boolean =>
      !st.map.blocked.has(x + ',' + y) && cellHash(x, y) % 37 > 2 && !st.units.some((u) => u.pos.x === x && u.pos.y === y);
    const inSeen = (x: number, y: number): boolean => seen.has(x + ',' + y);
    const fogCells: Vec2[] = [];
    const seenCells: Vec2[] = [];
    for (let y = 0; y < MISSION_MAP_H; y++)
      for (let x = 0; x < MISSION_MAP_W; x++) {
        if (!plain(x, y)) continue;
        if (inSeen(x, y)) seenCells.push({ x, y });
        else if (!inSeen(x - 1, y) && !inSeen(x + 1, y) && !inSeen(x, y - 1) && !inSeen(x, y + 1)) fogCells.push({ x, y });
      }
    expect(fogCells.length).toBeGreaterThan(20);
    expect(seenCells.length).toBeGreaterThan(20);
    const spread = (cells: Vec2[]): Promise<number[]> =>
      page.evaluate((cs) => {
        const cv = document.getElementById('battle') as HTMLCanvasElement;
        const d = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height).data;
        return cs.map((c) => {
          let sum = 0;
          for (let y = c.y * 48 + 12; y < c.y * 48 + 36; y++)
            for (let x = c.x * 48 + 12; x < c.x * 48 + 36; x++) {
              const i = (y * cv.width + x) * 4;
              sum += Math.max(d[i]!, d[i + 1]!, d[i + 2]!) - Math.min(d[i]!, d[i + 1]!, d[i + 2]!);
            }
          return sum / (24 * 24);
        });
      }, cells);
    await expect.poll(async () => Math.max(...(await spread(fogCells))), { message: 'Т.44: туман знебарвлено' }).toBeLessThanOrEqual(9);
    const seenSpread = await spread(seenCells);
    expect(seenSpread.reduce((a, v) => a + v, 0) / seenSpread.length, 'Т.44: видимі клітинки кольорові').toBeGreaterThan(12);
    // Т.129 (ADR-0118): кільце кольору бійця під ногами — пікселі на лівому і правому краї еліпса
    // мають колір бійця за id (відстань у RGB < 90); пікселі канви від шрифту не залежать
    const rings = st.units
      .filter((u) => u.side === 'player' && u.alive)
      .map((u) => ({ x: u.pos.x * 48 + 24, y: u.pos.y * 48 + 24 + RING_DY, rx: RING_RX, hex: fighterLook(u.id).color }));
    expect(rings.length).toBeGreaterThan(0);
    const ringDist = (): Promise<number[]> =>
      page.evaluate((rs) => {
        const cx = (document.getElementById('battle') as HTMLCanvasElement).getContext('2d')!;
        return rs.flatMap((r) =>
          [-r.rx, r.rx].map((dx) => {
            const d = cx.getImageData(r.x + dx, r.y, 1, 1).data;
            const c = [1, 3, 5].map((i) => parseInt(r.hex.slice(i, i + 2), 16));
            return Math.round(Math.hypot(d[0]! - c[0]!, d[1]! - c[1]!, d[2]! - c[2]!));
          })
        );
      }, rings);
    await expect
      .poll(async () => Math.max(...(await ringDist())), { message: 'Т.129: кільця кольору бійців ' + JSON.stringify(rings) })
      .toBeLessThan(90);
    // Т.132 (ADR-0121): смуга HP — під ногами (у живого бійця на старті HP повне — зелений #7fe2a0
    // на середині смуги), а у верхньому краї клітинки, де смуга була до Т.132, зеленого немає
    const bars = rings.map((r) => ({ x: r.x, y: r.y - RING_DY + HP_BAR_Y + 1 }));
    const greenAt = (pts: { x: number; y: number }[]): Promise<number[]> =>
      page.evaluate((ps) => {
        const cx = (document.getElementById('battle') as HTMLCanvasElement).getContext('2d')!;
        return ps.map((p) => {
          const d = cx.getImageData(p.x, p.y, 1, 1).data;
          return Math.round(Math.hypot(d[0]! - 0x7f, d[1]! - 0xe2, d[2]! - 0xa0));
        });
      }, pts);
    await expect
      .poll(async () => Math.max(...(await greenAt(bars))), { message: 'Т.132: смуга HP під ногами ' + JSON.stringify(bars) })
      .toBeLessThan(40);
    const oldBars = rings.map((r) => ({ x: r.x - 12, y: r.y - RING_DY - 22 }));
    expect(Math.min(...(await greenAt(oldBars))), 'Т.132: у верхньому краї клітинки смуги HP немає').toBeGreaterThan(40);
    await expectBattleFits(page, '1440 × 900', 740);
    await page.setViewportSize({ width: 1366, height: 768 });
    await expectBattleFits(page, '1366 × 768', 640);
    await page.setViewportSize({ width: 1024, height: 768 });
    await expectBattleFits(page, '1024 × 768', 540);
    const toolbarWidth = () => page.evaluate(() => Math.round(document.getElementById('btoolbar')!.getBoundingClientRect().width));
    expect(await toolbarWidth(), 'Т.118: на 1024 × 768 плитки — один стовпчик').toBe(64);
    // Т.118 (кандидат 19): низькі вікна — плитки у два стовпчики, поле вписується у висоту без прокрутки
    for (const [width, height, minField] of [
      [1024, 600, 380],
      [1366, 600, 480],
      [900, 700, 390], // ширина контейнера < висота + 144: поле обмежене шириною (аудит PR #433)
      [1100, 540, 320], // Т.130 (аудит PR #443): картки загону в колонці не розтягують низьку панель
    ] as const) {
      await page.setViewportSize({ width, height });
      await expectBattleFits(page, `${width} × ${height}`, minField);
      expect(await toolbarWidth(), `Т.118: на ${width} × ${height} плитки — два стовпчики`).toBe(134);
    }
    // Т.120 (кандидат 115): телефон вертикально і горизонтально
    for (const [width, height, minField, portrait] of [
      [390, 844, 330, true],
      [320, 568, 260, true],
      [844, 390, 340, false],
      [568, 320, 280, false], // і в блоці до 599 px завширшки (аудит PR #435)
    ] as const) {
      await page.setViewportSize({ width, height });
      await expectPhoneBattle(page, `${width} × ${height}`, minField, portrait);
      if (width === 844) {
        // Т.143: на горизонтальному телефоні тап по бійцю на канві вибирає його (cellFromPoint за масштабом показу)
        const first = mirror.squad()[0]!;
        await tap(page, first.pos);
        await expect(unit, 'Т.143: тап на 844 × 390 вибирає оперативника').toHaveAttribute('aria-label', unitLine(first));
        await page.keyboard.press('Escape');
        await expect(unit, 'Т.143: Esc знімає вибір').toHaveCount(0);
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  await test.step('бій: вибрати юніта → рух (тап-тап)', async () => {
    const soldier = mirror.squad()[0];
    // Т.44: зона ходу — на пікселях канви. Середній зелений канал центральної ділянки 24 × 24 px кожної клітинки
    // до і після вибору оперативника: заливка зони rgba(127,226,160,0.09) піднімає його щонайменше на 2 (на сіді сценарію — від 9,2),
    // поза зоною він не міняється. Множина таких клітинок дорівнює зоні з дзеркала (findPath до кожної клітинки).
    const greens = (): Promise<number[]> =>
      page.evaluate(() => {
        const cv = document.getElementById('battle') as HTMLCanvasElement;
        const d = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height).data;
        const out: number[] = [];
        for (let cy = 0; cy < cv.height / 48; cy++)
          for (let cx = 0; cx < cv.width / 48; cx++) {
            let sum = 0;
            for (let y = cy * 48 + 12; y < cy * 48 + 36; y++)
              for (let x = cx * 48 + 12; x < cx * 48 + 36; x++) sum += d[(y * cv.width + x) * 4 + 1]!;
            out.push(sum / (24 * 24));
          }
        return out;
      });
    const before = await greens();
    const reach = mirror.reach(soldier);
    // Т.143: контур зони — лінія 2 px на сторонах клітинок зони, зсунута всередину (REACH_OUTLINE
    // rgba(127,226,160,0.75), drawReachZone). Точки — середини відрізків контуру зони з клітинкою оперативника,
    // піксель під лінією; відрізки між клітинками з юнітами пропущено (спрайти, кільця, дужки вибору).
    // До вибору ці точки не зелені, після — зелені (G помітно більший за R і B, як лінія шляху)
    const occupiedAt = (x: number, y: number): boolean => mirror.state.units.some((u) => u.alive && u.pos.x === x && u.pos.y === y);
    const outline = zoneOutlineSegments(new Set(reach).add(soldier.pos.x + ',' + soldier.pos.y))
      .filter(
        (e) =>
          !occupiedAt(e.x1 - (e.nx < 0 ? 1 : 0), e.y1 - (e.ny < 0 ? 1 : 0)) &&
          !occupiedAt(e.x1 - (e.nx > 0 ? 1 : 0), e.y1 - (e.ny > 0 ? 1 : 0))
      )
      .map((e) =>
        e.x1 === e.x2
          ? { x: e.x1 * 48 + (e.nx > 0 ? 0 : -1), y: e.y1 * 48 + 24 }
          : { x: e.x1 * 48 + 24, y: e.y1 * 48 + (e.ny > 0 ? 0 : -1) }
      );
    expect(outline.length, 'Т.143: відрізки контуру зони без юнітів поруч').toBeGreaterThan(10);
    const outlineGreen = (): Promise<boolean[]> =>
      page.evaluate((ps) => {
        const cx = (document.getElementById('battle') as HTMLCanvasElement).getContext('2d')!;
        return ps.map((p) => {
          const d = cx.getImageData(p.x, p.y, 1, 1).data;
          return d[1]! - d[0]! > 40 && d[1]! - d[2]! > 25;
        });
      }, outline);
    expect((await outlineGreen()).filter(Boolean).length, 'Т.143: до вибору контуру немає').toBeLessThan(outline.length / 4);
    await tap(page, soldier.pos);
    await expect(unit).toHaveAttribute('aria-label', unitLine(soldier));
    expect(reach.size, 'Т.44: зона першого оперативника на старті (сід сценарію, 10 AP)').toBeGreaterThan(40);
    const drawn = async (): Promise<string> => {
      const after = await greens();
      const cells: string[] = [];
      after.forEach((g, i) => {
        const x = i % MISSION_MAP_W;
        const y = Math.floor(i / MISSION_MAP_W);
        // клітинки загону не рахуються: рамка вибору і спрайт міняють їхні пікселі, у зоні їх немає
        if (g - before[i]! >= 2 && !mirror.squad().some((u) => u.pos.x === x && u.pos.y === y)) cells.push(x + ',' + y);
      });
      return cells.sort().join(' ');
    };
    await expect.poll(drawn, { message: 'Т.44: зона ходу на канві = зона з дзеркала' }).toBe([...reach].sort().join(' '));
    await expect.poll(outlineGreen, { message: 'Т.143: контур зони — точки ' + JSON.stringify(outline) }).toEqual(outline.map(() => true));
    // Т.143: штрих туману — діагоналі x + y = d з кроком fogHatchStep (render.ts). Середня яскравість пікселів
    // на діагоналях вища, ніж посередині між ними, у клітинках туману без стін і юнітів (поле 4..43 px клітинки — без контуру зони)
    const fogCells: Vec2[] = [];
    const seenStart = mirror.seen();
    for (let y = 0; y < MISSION_MAP_H; y++)
      for (let x = 0; x < MISSION_MAP_W; x++)
        if (!seenStart.has(x + ',' + y) && !mirror.state.map.blocked.has(x + ',' + y) && !occupiedAt(x, y)) fogCells.push({ x, y });
    expect(fogCells.length, 'Т.143: клітинки туману на старті').toBeGreaterThan(20);
    const hatch = await page.evaluate(
      ({ cells, step }) => {
        const cx = (document.getElementById('battle') as HTMLCanvasElement).getContext('2d')!;
        let on = 0;
        let nOn = 0;
        let off = 0;
        let nOff = 0;
        for (const c of cells) {
          const d = cx.getImageData(c.x * 48, c.y * 48, 48, 48).data;
          for (let j = 4; j < 44; j++)
            for (let i = 4; i < 44; i++) {
              const k = (j * 48 + i) * 4;
              const lum = 0.299 * d[k]! + 0.587 * d[k + 1]! + 0.114 * d[k + 2]!;
              const r = (i + j + 1) % step; // зсув u + v центру пікселя від діагоналі u + v = n·step
              if (Math.min(r, step - r) < 0.5) {
                on += lum;
                nOn++;
              } else if (Math.abs(r - step / 2) < 0.5) {
                off += lum;
                nOff++;
              }
            }
        }
        return { on: on / nOn, off: off / nOff };
      },
      {
        cells: fogCells,
        step: fogHatchStep(
          await page.evaluate(() => {
            const cv = document.getElementById('battle') as HTMLCanvasElement;
            return cv.clientWidth > 0 ? cv.width / cv.clientWidth : 1;
          })
        ),
      }
    );
    expect(hatch.on - hatch.off, 'Т.143: штрих туману ' + JSON.stringify(hatch)).toBeGreaterThan(3);
    // Т.143 (ADR-0124): системне «менше руху» зупиняє JS-цикл ambient (пульс стін, дихання) за увімкненої «Анімації»:
    // за 400 мс спокою бою — жодного requestAnimationFrame; знято — цикл знову планує кадри
    const rafCalls = (): Promise<number> =>
      page.evaluate(
        () =>
          new Promise<number>((done) => {
            const raf = window.requestAnimationFrame;
            let n = 0;
            window.requestAnimationFrame = (cb) => {
              n++;
              return raf(cb);
            };
            setTimeout(() => {
              window.requestAnimationFrame = raf;
              done(n);
            }, 400);
          })
      );
    expect(await rafCalls(), 'Т.143: ambient бою планує кадри').toBeGreaterThan(0);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await rafCalls(), 'Т.143: «менше руху» — 0 кадрів ambient').toBe(0);
    await page.emulateMedia({ reducedMotion: null });
    expect(await rafCalls(), 'Т.143: «менше руху» знято — цикл знову планує кадри').toBeGreaterThan(0);
    // Т.33: причина під неактивною плиткою — у загоні на старті немає гелю
    await expect(page.locator('#btn-medkit .tb-cap')).toHaveText('без гелю');
    // ADR-0081: демон у тумані не видає себе — тап по його клітинці дає те
    // саме прев'ю шляху, що й по порожній невидимій
    const probe = mirror.fogProbe(soldier);
    await tap(page, probe.cell);
    await expect(info).toContainText(probe.hint);
    // Т.137: шлях, дорожчий за AP, — червоний (лінія, коло цілі і плашка ціни); ходу немає
    const far = mirror.farOption(soldier);
    await tap(page, far.cell);
    await expect(info).toContainText('Не вистачає AP: шлях ' + far.cost + ' проти ' + soldier.ap);
    await expectPathPreview(
      page,
      soldier.pos,
      far.path,
      far.cost,
      'short',
      'Т.137: червоний шлях і плашка ціни',
      mirror.state.units.filter((u) => u.alive).map((u) => u.pos)
    );
    const option = mirror.moveOption(soldier);
    await tap(page, option.cell); // перший тап — прев'ю шляху
    await expect(info).toContainText('Шлях: ' + option.cost + ' AP');
    await expectPathPreview(
      page,
      soldier.pos,
      option.path,
      option.cost,
      'ok',
      'Т.137: зелений шлях і плашка ціни',
      mirror.state.units.filter((u) => u.alive).map((u) => u.pos)
    );
    // Т.44: шлях — лінією на пікселях канви. Зелені (G помітно більший за R і B; колір лінії rgba(127,226,160,0.95)):
    // центр цілі (коло) і середина кожного відрізка від оперативника через клітинки шляху — крім точок під плашкою ціни
    // (Т.137, аудит PR #450: з Т.119 плашка збоку від цілі — місце з pathLabelBox, з запасом 2 px). Від шрифту не залежить.
    const centers = [soldier.pos, ...option.path].map((c) => ({ x: c.x * 48 + 24, y: c.y * 48 + 24 }));
    const goal = centers[centers.length - 1]!;
    const shownPx = await page.evaluate(() => {
      const cv = document.getElementById('battle') as HTMLCanvasElement;
      return cv.clientWidth > 0 ? cv.width / cv.clientWidth : 1;
    });
    const kLabel = pathLabelScale(shownPx);
    const labelCell = option.path[option.path.length - 1]!;
    const prevCell = option.path.length > 1 ? option.path[option.path.length - 2]! : soldier.pos;
    const label = pathLabelBox(
      labelCell,
      48,
      (option.cost + ' AP').length * PATH_LABEL_CHAR_W * kLabel,
      960,
      kLabel,
      prevCell.x > labelCell.x
    );
    const underLabel = (p: { x: number; y: number }): boolean =>
      p.x >= label.x - 2 && p.x <= label.x + label.w + 2 && p.y >= label.y - 2 && p.y <= label.y + label.h + 2;
    const points = [goal];
    for (let i = 1; i < centers.length; i++) {
      const m = { x: (centers[i - 1]!.x + centers[i]!.x) / 2, y: (centers[i - 1]!.y + centers[i]!.y) / 2 };
      if (!underLabel(m)) points.push(m);
    }
    const greenAt = (): Promise<boolean[]> =>
      page.evaluate((ps) => {
        const cv = document.getElementById('battle') as HTMLCanvasElement;
        const cx = cv.getContext('2d')!;
        return ps.map((p) => {
          const d = cx.getImageData(p.x, p.y, 1, 1).data;
          return d[1]! - d[0]! > 40 && d[1]! - d[2]! > 25;
        });
      }, points);
    await expect.poll(greenAt, { message: 'Т.44: шлях лінією — точки ' + JSON.stringify(points) }).toEqual(points.map(() => true));
    // Т.137: зміна вікна одразу перемальовує канву за новим масштабом показу: межа зору (Т.119:
    // max(2, 1,4 px buffer'а на CSS px)) на телефоні товща. Без кадрів ambient — rAF підмінено, чинний
    // кадр дограв за 300 мс; курсор — поза канвою до зміни (Esc знімає прев'ю, тож mouseleave не перемальовує),
    // інакше перемальовку дав би обробник миші, а не resize. Товщина — медіана числа блакитних пікселів
    // поперек вертикальних відрізків межі (клітинки без юнітів, рядки 2–17)
    const seenNow = mirror.seen();
    const occupied = (x: number, y: number): boolean => mirror.state.units.some((u) => u.alive && u.pos.x === x && u.pos.y === y);
    const edges: Vec2[] = [];
    for (let y = 2; y < MISSION_MAP_H - 2; y++)
      for (let x = 1; x < MISSION_MAP_W - 1; x++) {
        const a = seenNow.has(x - 1 + ',' + y);
        const b = seenNow.has(x + ',' + y);
        const rowSame = (dy: number): boolean => seenNow.has(x - 1 + ',' + (y + dy)) === a && seenNow.has(x + ',' + (y + dy)) === b;
        if (a !== b && rowSame(-1) && rowSame(1) && !occupied(x - 1, y) && !occupied(x, y)) edges.push({ x: x * 48, y: y * 48 + 24 });
      }
    expect(edges.length, 'Т.137: вертикальні відрізки межі зору на старті').toBeGreaterThan(2);
    const borderPx = (): Promise<number> =>
      page.evaluate((es) => {
        const cx = (document.getElementById('battle') as HTMLCanvasElement).getContext('2d')!;
        const counts = es.map((e) => {
          const d = cx.getImageData(e.x - 10, e.y, 21, 1).data;
          let n = 0;
          for (let i = 0; i < 21; i++) if (d[i * 4 + 2]! - d[i * 4]! > 55 && d[i * 4 + 2]! > 120) n++;
          return n;
        });
        counts.sort((p, q) => p - q);
        return counts[Math.floor(counts.length / 2)]!;
      }, edges);
    await page.keyboard.press('Escape');
    await page.mouse.move(0, 0);
    const vp = page.viewportSize()!;
    // заглушка не губить колбеки: ambient тримає хендл кадру і сам цикл не відновить (аудит PR #450) —
    // після вимірів кожен відкладений колбек іде в справжній rAF
    await page.evaluate(() => {
      const w = window as unknown as { t137Raf?: typeof requestAnimationFrame; t137Q?: FrameRequestCallback[] };
      w.t137Raf = window.requestAnimationFrame;
      w.t137Q = [];
      window.requestAnimationFrame = (cb) => {
        w.t137Q!.push(cb);
        return 0;
      };
    });
    await page.waitForTimeout(300);
    const wide = await borderPx();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(borderPx, { message: 'Т.137: resize до 390 × 844 — межа зору товща (було ' + wide + ' px)' }).toBeGreaterThan(wide);
    await page.setViewportSize(vp);
    await expect.poll(borderPx, { message: 'Т.137: resize назад — межа зору як була' }).toBe(wide);
    const waiting = await page.evaluate(() => {
      const w = window as unknown as { t137Raf?: typeof requestAnimationFrame; t137Q?: FrameRequestCallback[] };
      if (w.t137Raf !== undefined) window.requestAnimationFrame = w.t137Raf;
      const q = w.t137Q ?? [];
      for (const cb of q) window.requestAnimationFrame(cb);
      return q.length;
    });
    expect(waiting, 'Т.137: цикл ambient чекав кадру під заглушкою — і знову планується').toBeGreaterThan(0);
    await tap(page, soldier.pos); // Esc зняв вибір і прев'ю — вибрати знову
    await expect(unit).toHaveAttribute('aria-label', unitLine(soldier));
    await tap(page, option.cell);
    await expect(info).toContainText('Шлях: ' + option.cost + ' AP');
    // Т.45: зведений постріл ховає прев'ю шляху — ті самі точки більше не зелені, наведення на ціль
    // його не повертає і підказку режиму не переписує; Esc знімає режим, тап знову дає прев'ю
    await page.keyboard.press('Digit1');
    await expect(page.locator('#btn-snap')).toHaveClass(/armed/);
    const armedHint = await info.textContent();
    // миша ще стоїть на цілі після тапу: шлях ховає сама умова малювання, без жодного наведення
    await expect.poll(greenAt, { message: 'Т.45: одразу після зведення шляху немає' }).toEqual(points.map(() => false));
    await page.locator('#battle').hover({ position: { x: 3, y: 3 } });
    const box = (await page.locator('#battle').boundingBox())!;
    const goalCell = option.path[option.path.length - 1]!;
    await page.locator('#battle').hover({
      position: { x: ((goalCell.x + 0.5) * box.width) / MISSION_MAP_W, y: ((goalCell.y + 0.5) * box.height) / MISSION_MAP_H },
    });
    await expect.poll(greenAt, { message: 'Т.45: у режимі пострілу шляху немає' }).toEqual(points.map(() => false));
    await expect(info).toHaveText(armedHint ?? '');
    await page.keyboard.press('Escape');
    await tap(page, option.cell); // режим знято: перший тап — знову прев'ю
    await expect(info).toContainText('Шлях: ' + option.cost + ' AP');
    await expect.poll(greenAt, { message: 'Т.45: після Esc шлях повернувся' }).toEqual(points.map(() => true));
    await tap(page, option.cell); // повторний тап — хід
    mirror.move(soldier, option);
    await expect(info).toContainText(soldier.name + ': рух.');
    await expect(unit).toHaveAttribute('aria-label', unitLine(soldier));
  });

  await test.step('бій: дозор → кінець ходу (хід демонів)', async () => {
    const guard = mirror.squad()[1];
    await tap(page, guard.pos);
    await expect(unit).toHaveAttribute('aria-label', unitLine(guard));
    await page.locator('#btn-ow').click();
    mirror.overwatch(guard);
    await expect(info).toContainText(guard.name + ' у дозорі');
    await expect(unit).toHaveAttribute('aria-label', unitLine(guard));

    const actions = await endTurnOnPage(page, mirror, 'tap');
    expect(mirror.outcome(), 'бій скінчився в перший хід демонів').toBe('триває');
    await expectBattleFits(page, 'підсумок ходу демонів', 740);
    await expect(info).toContainText('Хід демонів Розриву відпрацьовано (' + actions + ' дій)');
    await expect(page.locator('#bctx-turn')).toHaveText('хід ' + mirror.state.turn + ' · загін');
    // Т.130 (vibe-audit PR #443): клік по картці — перша дія гравця, прибирає підсумок, як тап по полю
    await page.locator(`#bsquad .sq-card[data-unit="${mirror.squad()[0].id}"]`).click();
    await expect(page.locator('#bturn')).toBeHidden();
    await expectSquad(page, mirror);
  });

  await test.step('бій: постріл у видиму ціль (тап-тап)', async () => {
    let shot = mirror.shotOption('snap');
    for (let i = 0; i < MAX_TURNS_TO_TARGET && shot === null; i++) {
      await endTurnOnPage(page, mirror, 'space');
      expect(mirror.outcome(), 'бій скінчився до першого пострілу загону').toBe('триває');
      await expectSquad(page, mirror);
      shot = mirror.shotOption('snap');
    }
    if (shot === null) throw new Error('За ' + MAX_TURNS_TO_TARGET + ' ходів жоден демон не вийшов на лінію вогню');
    await tap(page, shot.shooter.pos);
    await expect(unit).toHaveAttribute('aria-label', unitLine(shot.shooter));
    await page.locator('#btn-snap').click();
    await expect(info).toContainText('~' + shot.chancePct + '%');
    await tap(page, shot.target.pos); // перший тап — шанс влучання
    await expect(info).toContainText('повторний тап у цю саму ціль — постріл');
    await tap(page, shot.target.pos); // повторний тап — постріл
    mirror.shoot(shot, 'snap');
    if (mirror.outcome() !== 'триває') return;
    await expect(unit).toHaveAttribute('aria-label', unitLine(shot.shooter));
    if (shot.target.alive && mirror.sees(shot.target)) {
      await tap(page, shot.target.pos); // без зведеного режиму — характеристики демона: HP після пострілу
      await expect(info).toContainText(enemyLine(shot.target));
      await expectEnemyMenu(page, mirror, shot); // Т.131: і меню на ворогові
      await page.keyboard.press('Escape'); // Esc закриває меню, вибір бійця лишається
      await expect(page.locator('#benemy')).toBeHidden();
      await expect(unit).toHaveAttribute('aria-label', unitLine(shot.shooter));
      // кнопка меню стріляє одразу — AP і результат, як у дзеркалі
      if (shot.shooter.ap >= shot.shooter.weapon.modes.snap.apCost) {
        await tap(page, shot.target.pos);
        await page.locator('#benemy [data-act="snap"]').click();
        await expect(page.locator('#benemy')).toBeHidden();
        await expect(info).toContainText('(швидкий). AP');
        mirror.shoot(shot, 'snap');
        if (mirror.outcome() !== 'триває') return;
        await expect(unit).toHaveAttribute('aria-label', unitLine(shot.shooter));
      }
    }
  });

  await test.step('бій: авто-бій до результату → повернення на геосцену', async () => {
    if (mirror.outcome() === 'триває') {
      // Т.46: зведений постріл авто-бій знімає — плитка не лишається зведеною (стан бою зведення не міняє)
      await page.keyboard.press('Digit1');
      await expect(page.locator('#btn-snap')).toHaveClass(/armed/);
      await page.locator('#btn-auto-battle').click();
      await expect(page.locator('#btn-snap')).not.toHaveClass(/armed/);
      mirror.autoBattle();
    }
    const turns = mirror.state.turn;
    const aliens = mirror.state.units.filter((u) => u.side === 'alien');
    const banner = mirror.finish();
    await expect(page.locator('#bresult .banner')).toHaveText(banner, { timeout: AUTO_BATTLE_TIMEOUT_MS });
    // Т.33: картка результату — хід і знищені демони, як у дзеркалі
    await expect(page.locator('#bresult .rrow').nth(0)).toHaveText('Ходів' + turns);
    await expect(page.locator('#bresult .rrow').nth(1)).toHaveText(
      'Демонів знищено' + aliens.filter((u) => !u.alive).length + ' з ' + aliens.length
    );
    await expectBattleFits(page, 'результат бою', 740);
    await page.locator('#btn-close').click();
    await expect(page.locator('#geo-panel')).toBeVisible();
    await expect(page.locator('#battle-panel')).toBeHidden();
    // п16.4 (EARS 4): підвищені до «Боєць» без ролі — вікно вибору ролі по черзі; сценарій обирає снайпера, дзеркало — теж
    for (const { id, title } of mirror.awaitingRoleTitles()) {
      await expect(page.locator('#role-dialog-title')).toHaveText(title);
      await page.locator('#btn-role-sniper').click();
      mirror.chooseRole(id, 'sniper');
    }
    await expect(page.locator('#role-dialog')).toBeHidden();
    // відбиток бою в ростері: хто вижив, HP і вбивства кожного — як у дзеркалі
    await expect(page.locator('#roster .soldier')).toHaveText(mirror.rosterRows());
    await expect(page.locator('#ready')).toHaveText(mirror.readyChip());
  });

  await test.step('геосцена: +1 тік, +1 доба', async () => {
    // Т.144 (ADR-0125, рішення власника «А. Спокійно»): за «менше руху» скан-радар тіку — спокійна копія
    // ≈ ½ тривалості (ambient за «менше руху» кадрів не планує, Т.143): останній кадр rAF — раніше 900 мс,
    // повна розгортка — 1200 мс; кадри є (анімація не вимкнена зовсім)
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const scan = await page.evaluate(
      () =>
        new Promise<{ n: number; last: number }>((done) => {
          const raf = window.requestAnimationFrame;
          const t0 = performance.now();
          let n = 0;
          let last = 0;
          window.requestAnimationFrame = (cb) => {
            n++;
            last = performance.now() - t0;
            return raf(cb);
          };
          document.getElementById('btn-tick')!.click();
          setTimeout(() => {
            window.requestAnimationFrame = raf;
            done({ n, last: Math.round(last) });
          }, 1600);
        })
    );
    await page.emulateMedia({ reducedMotion: null });
    mirror.tick();
    await expect(clock).toHaveText(mirror.clock());
    expect(scan.n, 'Т.144: спокійний скан-радар грає ' + JSON.stringify(scan)).toBeGreaterThan(3);
    expect(scan.last, 'Т.144: спокійний скан-радар коротший за повний ' + JSON.stringify(scan)).toBeLessThan(900);
    await page.locator('#btn-tick').click();
    mirror.tick();
    await expect(clock).toHaveText(mirror.clock());
    // Т.43: «+1 доба» зупиняється на виявленні й приземленні зонда, «До події» —
    // на першій події; дзеркало рухається за тим самим правилом (mirror.ts).
    // Т.43: рядок «Наступний крок» — текст за станом дзеркала (цілі місії, зонди в повітрі)
    const stepText = (): string => {
      const landed = mirror.targets().filter((u) => u.status === 'приземлився');
      if (landed.length > 0) {
        const hours = (Math.min(...landed.map((u) => u.landedTicksLeft)) * TICK_MINUTES) / 60;
        return 'Наступний крок: зонд приземлився — запустіть місію (вікно ' + hours + ' год)';
      }
      if (mirror.detected().some((u) => u.status === 'летить'))
        return 'Наступний крок: зонд у повітрі — перехопіть або чекайте приземлення';
      return 'Наступний крок: рухайте час — сенсорна сітка шукає зонди';
    };
    await expect(page.locator('#next-step')).toHaveText(stepText());
    // Т.80: рядок — у заголовку «Геосцени» праворуч від назви, не в шапці; текст не обрізано
    const stepBox = await page.evaluate(() => {
      const s = document.getElementById('next-step')!;
      const r = s.getBoundingClientRect();
      const h2 = document.querySelector('#geo-head h2')!.getBoundingClientRect();
      return {
        inBar: s.closest('#topbar') !== null,
        row: r.top < h2.bottom && r.bottom > h2.top && r.left >= h2.right,
        fits: s.scrollWidth <= s.clientWidth,
        headTail: document.getElementById('geo-head')!.getBoundingClientRect().bottom - h2.bottom,
      };
    });
    expect(stepBox.inBar, 'рядок «Наступний крок» не має бути в шапці').toBe(false);
    expect(stepBox.row, 'рядок «Наступний крок» — праворуч від «Геосцена», в одному ряду').toBe(true);
    expect(stepBox.fits, 'текст рядка «Наступний крок» обрізано').toBe(true);
    expect(stepBox.headTail, 'заголовок «Геосцени» вищий за назву').toBeLessThanOrEqual(9);
    // Т.79: клік по рядку веде до кнопки дії: фокус і підсвітка на ній
    await page.locator('#next-step').click();
    const focused = await page.evaluate(() => {
      const a = document.activeElement as HTMLElement | null;
      return { id: a?.id ?? '', cls: a?.className ?? '', tag: a?.tagName ?? '' };
    });
    expect(focused.tag, 'клік по «Наступний крок» не дав фокус кнопці дії').toBe('BUTTON');
    expect(focused.cls, 'кнопка дії не підсвічена').toContain('step-target');
    expect(focused.id, 'фокус лишився на самому рядку').not.toBe('next-step');
    await page.locator('#btn-day').click();
    const dayTicks = mirror.dayWithStops();
    await expect(page.locator('#next-step')).toHaveText(stepText());
    await expect(clock).toHaveText(mirror.clock());
    await expect(page.locator('#btn-event')).toHaveText('До події');
    await page.locator('#btn-event').click();
    const eventTicks = mirror.toEvent();
    await expect(clock).toHaveText(mirror.clock());
    // пробіл на геосцені — завжди «До події»: і з фокусом на «До події» (один раз, не двічі),
    // і після кліку «+1 тік», коли фокус лишився на ній (не ще один тік)
    await page.keyboard.press('Space');
    mirror.toEvent();
    await expect(clock).toHaveText(mirror.clock());
    await page.locator('#btn-tick').click();
    mirror.tick();
    await page.keyboard.press('Space');
    const spaceTicks = mirror.toEvent();
    await expect(clock).toHaveText(mirror.clock());
    expect(spaceTicks, 'пробіл після «+1 тік» має пройти більше одного тіку — інакше крок не відрізняє його від кнопки').toBeGreaterThan(1);
    // Т.98: кнопку, вибрану клавішею Tab (рамка фокусу), пробіл натискає сам — «+1 тік», а не «До події»;
    // T / D — «+1 тік» / «+1 доба», N — «Наступний крок» (фокус на кнопці дії)
    await page.locator('#btn-event').click();
    mirror.toEvent();
    await expect(clock).toHaveText(mirror.clock());
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('#btn-tick')).toBeFocused();
    await page.keyboard.press('Space');
    mirror.tick();
    await expect(clock).toHaveText(mirror.clock());
    await page.keyboard.press('t');
    mirror.tick();
    await expect(clock).toHaveText(mirror.clock());
    await page.keyboard.press('d');
    mirror.dayWithStops();
    await expect(clock).toHaveText(mirror.clock());
    await expect(page.locator('#next-step')).toHaveText(stepText());
    await page.keyboard.press('n');
    await expect(page.locator(':focus'), 'N не дав фокус кнопці дії').toHaveClass(/step-target/);
    // на сіді сценарію хоч одна з двох кнопок стає раніше за добу — інакше крок нічого не перевіряє
    expect(Math.min(dayTicks, eventTicks), 'зупинка на події раніше за 48 тіків').toBeLessThan(TICKS_PER_DAY);
    await expect(page.locator('#ufos .ufo')).toHaveCount(mirror.detected().length);
    await expect(page.locator('#ready')).toHaveText(mirror.readyChip()); // лікарня тікає разом з геосценою
  });

  await test.step('сейв → лоад', async () => {
    const saved = mirror.clock();
    await openSave(page); // Т.128: «Збереження» — вікно з «Меню»; фокус на «Закрити»
    await expect(page.locator('#btn-save-close')).toBeFocused();
    await expectIcons(page, '#save-dialog h2 svg.h-icon', 16, 1, 'y'); // Т.128: іконка заголовка вікна
    await page.locator('#btn-save-1').click();
    await expect(page.locator('#log')).toContainText('Збережено: слот 1.');
    await expect(page.locator('#save-dialog')).toBeVisible(); // «Зберегти» вікно не закриває
    await page.keyboard.press('Escape');
    await expect(page.locator('#save-dialog')).toBeHidden();
    await expect(page.locator('#btn-menu')).toBeFocused();
    await page.locator('#btn-tick').click();
    mirror.tick();
    await expect(clock).toHaveText(mirror.clock());
    await openSave(page);
    await page.locator('#btn-load-1').click();
    await expect(page.locator('#save-dialog')).toBeHidden(); // вдале «Завантажити» закриває вікно
    await expect(clock).toHaveText(saved);
    await expect(page.locator('#log')).toContainText('Завантажено: слот 1 — ' + saved);
  });

  expect(errors, 'помилки сторінки: ' + errors.join(' | ')).toEqual([]);
});

// Т.61: екран перемоги і рядок-пояснення невдалого «Продовжити» — на сторінці, а не лише класом hidden.
// Наскрізні тести на сторінці (jsdom) розкладки не мають: кнопка з display:none чи рядок без стилів їх проходять.
// Екран перемоги — правкою сейву (campaign.status = 'перемога'), як у наскрізному тесті Т.58; невдале
// «Продовжити» — зіпсованим списком зондів (ufos = [null]).
const T61_VIEWPORTS = [
  { width: 1366, height: 768 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
];

// Т.61: що бачить гравець у центрі елемента — сам елемент (не перекритий), повна непрозорість з предками,
// непрозорий текст не меншого за 12 px кегля, текст не обрізано по ширині
const t61Look = (page: Page, id: string) =>
  page.evaluate((elId) => {
    const el = document.getElementById(elId)!;
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    let opacity = 1;
    for (let e: Element | null = el; e !== null; e = e.parentElement) opacity *= Number(getComputedStyle(e).opacity);
    const s = getComputedStyle(el);
    const rgba = (c: string): number[] => (c.match(/[\d.]+/g) ?? []).map(Number);
    return {
      top: r.top,
      bottom: r.bottom,
      h: r.height,
      w: r.width,
      onTop: hit !== null && el.contains(hit),
      opacity,
      color: rgba(s.color),
      background: rgba(s.backgroundColor),
      fontSize: parseFloat(s.fontSize),
      fits: el.scrollWidth <= el.clientWidth,
    };
  }, id);

const t61Visible = (b: Awaited<ReturnType<typeof t61Look>>, label: string): void => {
  expect(b.onTop, label + ': елемент перекрито').toBe(true);
  expect(b.opacity, label + ': елемент прозорий').toBe(1);
  expect(b.color[3] ?? 1, label + ': текст прозорий').toBeGreaterThanOrEqual(0.9);
  expect(b.fontSize, label + ': кегль тексту менший за 12 px').toBeGreaterThanOrEqual(12);
  expect(b.fits, label + ': текст обрізано').toBe(true);
};

// Т.94 (рішення власника 21.11.2026, варіант А): вікна до 760 px заввишки — стовпчик, альбомні до 480 px
// (з Т.126 — до 560 px) — дві колонки; перетин рамок (і по висоті, і по ширині) — накриття
const T94_VIEWPORTS = [
  { width: 1280, height: 740 },
  { width: 800, height: 600 },
  { width: 568, height: 270 },
  { width: 320, height: 568 },
  { width: 320, height: 480 }, // Т.96: з банером тут була прокрутка 32 px
  { width: 320, height: 512 },
  { width: 375, height: 667 },
  { width: 568, height: 320 },
  { width: 640, height: 360 },
  { width: 667, height: 375 },
  // Т.126 (залишок кандидата 102): з банером тут була прокрутка 42 / 7 px і 12–31 px на альбомних 481–515 px
  { width: 320, height: 420 },
  { width: 320, height: 460 },
  { width: 720, height: 481 },
  { width: 800, height: 500 },
  { width: 900, height: 515 },
  // Т.126 (аудит PR #440): нова межа двох колонок — альбомні до 560 px і перші вікна над нею
  { width: 1024, height: 540 },
  { width: 700, height: 560 },
  { width: 1000, height: 561 },
];
const t94Layout = async (page: Page, label: string): Promise<void> => {
  const m = await page.evaluate(() => {
    const sels = ['#start-note', '#start-logo', '.start-tagline', '#start-screen .start-menu', '.start-version'];
    const boxes = sels
      .map((sel) => [sel, document.querySelector(sel)] as const)
      .filter(([, e]) => e !== null && !e.classList.contains('hidden'))
      .map(([sel, e]) => {
        const r = e!.getBoundingClientRect();
        return { sel, t: r.top, b: r.bottom, l: r.left, r: r.right };
      });
    const sc = document.getElementById('start-screen')!;
    return {
      boxes,
      w: innerWidth,
      h: innerHeight,
      scroll: sc.scrollHeight - sc.clientHeight,
      hscroll: sc.scrollWidth - sc.clientWidth,
    };
  });
  expect(m.scroll, label + ': стартовий екран прокручується').toBeLessThanOrEqual(1);
  // Т.126: кільце героя (::before / ::after) і збільшений логотип не дають прокрутки вбік
  expect(m.hscroll, label + ': стартовий екран прокручується вбік').toBeLessThanOrEqual(1);
  for (const x of m.boxes) {
    expect(x.t >= 0 && x.l >= 0 && x.b <= m.h && x.r <= m.w, label + ': ' + x.sel + ' за краєм вікна').toBe(true);
  }
  for (const [i, a] of m.boxes.entries())
    for (const b of m.boxes.slice(i + 1)) {
      const cross = Math.min(a.b, b.b) - Math.max(a.t, b.t) > 0 && Math.min(a.r, b.r) - Math.max(a.l, b.l) > 0;
      expect(cross, label + ': ' + a.sel + ' накриває ' + b.sel).toBe(false);
    }
  for (const id of ['btn-start-new', 'btn-start-continue', 'btn-start-settings', 'btn-start-help']) {
    const b = await t61Look(page, id);
    expect(b.onTop, label + ': #' + id + ' перекрито').toBe(true);
    expect(b.h, label + ': #' + id + ' нижча за тач-ціль 44 px').toBeGreaterThanOrEqual(44);
  }
};

test('Т.61: екран перемоги і рядок-пояснення стартового екрана — видно на трьох розмірах вікна', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./');
  const helpClose = page.locator('#btn-help-close'); // перший візит — «Як грати» поверх стартового екрана
  if (await helpClose.isVisible()) await helpClose.click();
  await page.locator('#btn-start-new').click();
  await page.locator('#new-game-seed').fill(String(SEED));
  await page.locator('#new-game-preset').selectOption(PRESET);
  await page.locator('#btn-new-game-start').click();
  await expect(page.locator('#geo')).toBeVisible();
  await openSave(page); // Т.128: «Збереження» — вікно з «Меню»
  await page.locator('#btn-save-1').click();
  await expect(page.locator('#log')).toContainText('Збережено: слот 1.'); // вікно лишається — далі «Завантажити»
  const good = await page.evaluate(() => localStorage.getItem('rubezh.save.1')!);
  const won = JSON.parse(good) as { state: { campaign: { status: string } } };
  won.state.campaign.status = 'перемога';
  const bad = JSON.parse(good) as { state: { geo: { ufos: unknown } } };
  bad.state.geo.ufos = [null]; // метадані читаються, розбір партії падає

  await test.step('екран перемоги: три кнопки видно в межах вікна, одна під одною', async () => {
    await page.evaluate((s) => localStorage.setItem('rubezh.save.1', s), JSON.stringify(won));
    await page.locator('#btn-load-1').click();
    await expect(page.locator('#campaign-victory')).toBeVisible();
    const ids = ['btn-continue', 'btn-play-again', 'btn-victory-exit'];
    await expect(page.locator('#campaign-victory button')).toHaveText(['Грати далі', 'Грати знов', 'На стартовий екран']);
    for (const size of T61_VIEWPORTS) {
      await page.setViewportSize(size);
      const label = size.width + ' × ' + size.height;
      for (const id of ids) {
        await expect(page.locator('#' + id), label + ': #' + id).toBeVisible();
        await expect(page.locator('#' + id), label + ': #' + id).toBeInViewport({ ratio: 1 });
      }
      const boxes = [];
      for (const id of ids) boxes.push(await t61Look(page, id));
      for (const [i, b] of boxes.entries()) {
        t61Visible(b, label + ': #' + ids[i]);
        expect(b.h, label + ': кнопка нижча за тач-ціль 44 px').toBeGreaterThanOrEqual(44);
        expect(b.w, label + ': кнопка вужча за 44 px').toBeGreaterThanOrEqual(44);
      }
      for (let i = 1; i < boxes.length; i++)
        expect(boxes[i]!.top, label + ': кнопки накладаються').toBeGreaterThanOrEqual(boxes[i - 1]!.bottom);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('#btn-victory-exit').click(); // одразу після завантаження незбережених дій немає
    await expect(page.locator('#start-screen')).toBeVisible();
    await expect(page.locator('#campaign-victory')).toBeHidden();
  });

  await test.step('Т.126 (ADR-0116): вигляд стартового екрана і анімація — тумблер «Анімація», «менше руху»', async () => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.mouse.move(0, 0);
    const look = (): Promise<Record<string, unknown>> =>
      page.evaluate(() => {
        const sc = document.getElementById('start-screen')!;
        const hero = document.querySelector('.start-hero')!;
        const logo = document.querySelector('#start-logo-img');
        const nb = getComputedStyle(document.getElementById('btn-start-new')!);
        const help = getComputedStyle(document.getElementById('btn-start-help')!);
        return {
          sparks: getComputedStyle(sc, '::before').animationName,
          ring: getComputedStyle(hero, '::before').animationName,
          sweep: [getComputedStyle(hero, '::after').display, getComputedStyle(hero, '::after').animationName],
          mask: logo !== null && getComputedStyle(logo).maskImage.startsWith('radial-gradient'), // ассет є у збірці
          main: [nb.backgroundImage.includes('linear-gradient'), nb.color],
          menu: [help.clipPath.startsWith('polygon'), help.textTransform],
        };
      });
    const on = { sparks: 'start-sparks', ring: 'start-ring', sweep: ['block', 'start-sweep'], mask: true };
    const still = { sparks: 'none', ring: 'none', sweep: ['none', 'none'], mask: true };
    const kit = { main: [true, 'rgb(26, 18, 4)'], menu: [true, 'uppercase'] };
    expect(await look()).toEqual({ ...on, ...kit });
    await page.locator('#btn-start-settings').click();
    await page.locator('#settings-ambient').click();
    await page.locator('#settings-close').click();
    expect(await look(), 'тумблер «Анімація: вимк»').toEqual({ ...still, ...kit });
    await page.locator('#btn-start-settings').click();
    await page.locator('#settings-ambient').click();
    await page.locator('#settings-close').click();
    expect(await look()).toEqual({ ...on, ...kit });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await look(), 'системне «менше руху»').toEqual({ ...still, ...kit });
    // Т.145 (рішення власника «А»): рядок-пояснення під тумблером лише за «менше руху»; підпис кнопки — вибір гравця
    const note = page.locator('#settings-motion-note');
    await page.locator('#btn-start-settings').click();
    await expect(page.locator('#settings-ambient')).toHaveText('Анімація: увімк');
    await expect(note).toBeVisible();
    await expect(note).toHaveText('Увімкнено системне «менше руху»: живі ефекти вимкнено, анімації бою — спокійні.');
    await page.emulateMedia({ reducedMotion: null });
    await expect(note, 'знято «менше руху» при відкритому вікні').toBeHidden();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(note, 'увімкнено «менше руху» при відкритому вікні').toBeVisible();
    await page.locator('#settings-close').click();
    await page.emulateMedia({ reducedMotion: null });
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  await test.step('Т.94: малі й низькі вікна без банера — нічого не накрито, усе у вікні, без прокрутки', async () => {
    // вище за 760 px — розкладка П14.7 без змін: меню на 48 px над низом екрана з відступом 16 px
    await page.setViewportSize({ width: 1366, height: 768 });
    const menuBottom = await page.locator('#start-screen .start-menu').evaluate((e) => e.getBoundingClientRect().bottom);
    expect(menuBottom, '1366 × 768: меню не на місці П14.7').toBe(768 - 64);
    for (const size of T94_VIEWPORTS) {
      await page.setViewportSize(size);
      await t94Layout(page, 'Т.94 ' + size.width + ' × ' + size.height);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  await test.step('невдале «Продовжити»: рядок-пояснення — банер угорі екрана (Т.93), нічого не накриває, кольором помилки на непрозорій підкладці', async () => {
    await expect(page.locator('#start-note')).toBeHidden();
    await page.evaluate((s) => localStorage.setItem('rubezh.save.1', s), JSON.stringify(bad));
    await page.locator('#btn-start-continue').click();
    const note = page.locator('#start-note');
    await expect(note).toHaveText('Не вдалося завантажити збереження. Почніть нову гру.');
    for (const size of T61_VIEWPORTS) {
      await page.setViewportSize(size);
      const label = size.width + ' × ' + size.height;
      await expect(note, label + ': рядок-пояснення').toBeVisible();
      await expect(note, label + ': рядок-пояснення').toBeInViewport({ ratio: 1 });
      const m = await t61Look(page, 'start-note');
      const first = await t61Look(page, 'btn-start-new');
      t61Visible(m, label + ': рядок-пояснення');
      // Т.93 (рішення власника 21.11.2026): банер угорі екрана — над логотипом, не накриває ні його, ні підпис, ні меню
      expect(m.top, label + ': рядок-пояснення не вгорі екрана').toBeLessThanOrEqual(24);
      for (const sel of ['#start-logo', '.start-tagline', '#btn-start-new']) {
        const top = await page.locator(sel).evaluate((e) => e.getBoundingClientRect().top);
        expect(top, label + ': рядок-пояснення накриває ' + sel).toBeGreaterThanOrEqual(m.bottom);
      }
      expect(Math.abs(m.w - first.w), label + ': рядок вужчий чи ширший за кнопки меню').toBeLessThanOrEqual(1);
      const [r, g, b] = m.color as [number, number, number];
      expect(r - Math.max(g, b), label + ': колір тексту — не колір помилки').toBeGreaterThanOrEqual(80);
      expect(m.background[3] ?? 1, label + ': підкладка рядка прозора').toBeGreaterThanOrEqual(0.9);
    }
    for (const size of T94_VIEWPORTS) {
      await page.setViewportSize(size);
      const label = 'Т.94 з банером ' + size.width + ' × ' + size.height;
      await t94Layout(page, label);
      const m = await t61Look(page, 'start-note');
      t61Visible(m, label + ': рядок-пояснення');
      expect(m.top, label + ': рядок-пояснення не вгорі екрана').toBeLessThanOrEqual(24);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate((s) => localStorage.setItem('rubezh.save.1', s), good);
    await page.locator('#btn-start-continue').click(); // цілий слот вантажиться
    await expect(page.locator('#start-screen')).toBeHidden();
  });

  expect(errors, 'помилки сторінки: ' + errors.join(' | ')).toEqual([]);
});

// Т.164 (кандидат 153, рішення власника «А. По центру»): без ассета логотипа (офлайн, збій запиту) лишається
// текстовий «РУБІЖ», ширший за рамку логотипа; виступав праворуч — прокрутка вбік на 320 × 568, на 568 × 270 — під
// меню. Тут запит картинки логотипа перервано (лише `image` — модульні імпорти `vite` не чіпати, урок Т.163).
test('Т.164: стартовий екран без ассета логотипа — текстовий логотип по центру, без прокрутки вбік', async ({ page }) => {
  const errors = watchErrors(page); // перерваний логотип теж дає «Failed to load resource» — звірка нижче
  const failed: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && /\/logo[^/]*\.webp$/.test(m.location().url)) failed.push(m.location().url);
  });
  await page.route('**/logo*.webp', (r) => (r.request().resourceType() === 'image' ? r.abort() : r.continue()));
  await page.goto('./');
  const helpClose = page.locator('#btn-help-close'); // перший візит — «Як грати» поверх стартового екрана
  if (await helpClose.isVisible()) await helpClose.click();
  await expect(page.locator('#start-logo .start-logo-text')).toBeVisible();
  // T94_VIEWPORTS і вікна, де виступ був лише з DejaVu Sans (360 × 640, 340 × 568), та 1366 × 768 (П14.7)
  const sizes = [...T94_VIEWPORTS, { width: 360, height: 640 }, { width: 340, height: 568 }, { width: 1366, height: 768 }];
  for (const size of sizes) {
    await page.setViewportSize(size);
    const label = 'Т.164 без ассета ' + size.width + ' × ' + size.height;
    const m = await page.evaluate(() => {
      const text = document.querySelector('#start-logo .start-logo-text')!;
      const range = document.createRange();
      range.selectNodeContents(text); // рамка Range містить хвостовий letter-spacing — нижче віднімаємо ls
      const g = range.getBoundingClientRect();
      const box = document.getElementById('start-logo')!.getBoundingClientRect();
      const menu = document.querySelector('#start-screen .start-menu')!.getBoundingClientRect();
      const sc = document.getElementById('start-screen')!;
      const ls = parseFloat(getComputedStyle(text).letterSpacing) || 0;
      return {
        l: g.left,
        r: g.right - ls,
        t: g.top,
        b: g.bottom,
        mid: (box.left + box.right) / 2,
        menu: { l: menu.left, r: menu.right, t: menu.top, b: menu.bottom },
        w: innerWidth,
        hscroll: sc.scrollWidth - sc.clientWidth,
      };
    });
    expect(m.hscroll, label + ': стартовий екран прокручується вбік').toBeLessThanOrEqual(1);
    expect(m.l >= 0 && m.r <= m.w, label + ': текстовий логотип за краєм вікна').toBe(true);
    expect(Math.abs((m.l + m.r) / 2 - m.mid), label + ': текстовий логотип не по центру рамки').toBeLessThanOrEqual(2);
    const cross = Math.min(m.b, m.menu.b) - Math.max(m.t, m.menu.t) > 0 && Math.min(m.r, m.menu.r) - Math.max(m.l, m.menu.l) > 0;
    expect(cross, label + ': текстовий логотип накриває меню').toBe(false);
  }
  expect(failed.length, 'запит логотипа не перервано').toBeGreaterThan(0);
  expect(errors.length, 'помилки сторінки поза перерваним логотипом: ' + errors.join(' | ')).toBe(failed.length);
});

// Т.71 (рішення власника 18.11.2026; в описі обраного варіанта — e2e до банера): загін покидає бій з синіх клітинок висадки —
// плиткою, клавішею V і, для останнього, через вікно підтвердження — до банера «ЗАГІН ЕВАКУЙОВАНО».
test('Т.71: евакуація — плитка, клавіша V і вікно для останнього до банера «ЗАГІН ЕВАКУЙОВАНО»', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./');
  const helpClose = page.locator('#btn-help-close'); // перший візит — «Як грати» поверх стартового екрана
  if (await helpClose.isVisible()) await helpClose.click();
  await page.locator('#btn-start-new').click();
  await page.locator('#new-game-seed').fill(String(SEED));
  await page.locator('#new-game-preset').selectOption(PRESET);
  await page.locator('#btn-new-game-start').click();
  await page.locator('#status-tab-base').click();
  const mission = page.locator('#ufos button.mission').first();
  for (let i = 0; i < MAX_TICKS_TO_MISSION && !(await mission.isVisible()); i++) await page.locator('#btn-tick').click();
  await mission.click();
  await expect(page.locator('#battle-panel')).toBeVisible();
  const box = (await page.locator('#battle').boundingBox())!;
  const k = box.width / (MISSION_MAP_W * 48);
  const tap = (x: number, y: number): Promise<void> => page.mouse.click(box.x + (x * 48 + 24) * k, box.y + (y * 48 + 24) * k);
  const info = page.locator('#binfo');
  await tap(2, 2);
  await page.locator('#btn-evac').click();
  await expect(info).toHaveText(/^Евакуйовано: .+\. На полі лишилось оперативників: 2\.$/);
  await tap(3, 2);
  await page.keyboard.press('v');
  await expect(info).toHaveText(/^Евакуйовано: .+\. На полі лишилось оперативників: 1\.$/);
  await tap(2, 3);
  await page.keyboard.press('v');
  await expect(page.locator('#evac-confirm')).toBeVisible();
  await expect(page.locator('#btn-evac-no')).toBeFocused();
  await page.locator('#btn-evac-yes').click();
  await expect(page.locator('#evac-confirm')).toBeHidden();
  await expect(page.locator('#bresult')).toContainText('ЗАГІН ЕВАКУЙОВАНО — врятовані на базі, зонд Розриву лишається активним');
  expect(errors, 'помилки сторінки: ' + errors.join(' | ')).toEqual([]);
});

// п16.4 (ADR-0147 п. 5–8, 13, 15; EARS 4, 6, 8, 10; рішення власника Т.186 «А»): сейв v1 з вбивствами →
// вікно вибору ролі (Esc не закриває, кілька — по черзі) → ростер у три рядки → у бою картка з позивним,
// шевроном і значком ролі, плитка «Роль» за роллю вибраного; «Ривок» — клавішею R.
test('п16.4: вікно ролі після сейву v1, ростер, картка смуги загону і плитка «Роль»', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./');
  const helpClose = page.locator('#btn-help-close');
  if (await helpClose.isVisible()) await helpClose.click();
  await page.locator('#btn-start-new').click();
  await page.locator('#new-game-seed').fill(String(SEED));
  await page.locator('#new-game-preset').selectOption(PRESET);
  await page.locator('#btn-new-game-start').click();
  await openSave(page);
  await page.locator('#btn-save-1').click();
  await expect(page.locator('#log')).toContainText('Збережено: слот 1.');
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('rubezh.save.1')!) as {
      version: number;
      state: { roster: { soldiers: { kills: number }[]; careers?: unknown } };
    };
    d.version = 1; // сейв v0.7.0: кар'єр немає, досвід — з kills (міграція п16.2)
    delete d.state.roster.careers;
    d.state.roster.soldiers[0].kills = 2; // «Крук» — Боєць
    d.state.roster.soldiers[1].kills = 5; // «Шрам» — Сержант
    localStorage.setItem('rubezh.save.1', JSON.stringify(d));
  });
  await page.locator('#btn-load-1').click();
  const dialog = page.locator('#role-dialog');
  await expect(dialog).toBeVisible();
  await expect(page.locator('#role-dialog-title')).toHaveText('Підвищення: «Крук» — Боєць. Оберіть роль');
  await expect(page.locator('#role-dialog .role-pick')).toHaveCount(3);
  await expect(page.locator('#role-dialog-title')).toBeFocused(); // аудит PR #501: фокус на заголовку, не на кнопці
  await page.keyboard.press('Escape');
  await page.mouse.click(5, 5); // клік поза панеллю вікна
  await expect(dialog, 'п16.4: Esc і клік поза вікном його не закривають').toBeVisible();
  await page.locator('#btn-role-assault').click();
  await expect(page.locator('#role-dialog-title')).toHaveText('Підвищення: «Шрам» — Сержант. Оберіть роль');
  await page.locator('#btn-role-medic').click();
  await expect(dialog).toBeHidden();
  await page.locator('#status-tab-squad').click();
  const first = page.locator('#roster .soldier').first();
  await expect(first).toContainText('Іван «Крук»');
  await expect(first).toContainText('» штурмовик');
  await expect(first).toContainText('Роки в диспетчерській метро');
  await expect(first).toContainText('досвід 2 · до «Сержант» 3');
  await expect(first.locator('.chev i')).toHaveCount(2);

  await page.locator('#status-tab-base').click();
  const mission = page.locator('#ufos button.mission').first();
  for (let i = 0; i < MAX_TICKS_TO_MISSION && !(await mission.isVisible()); i++) await page.locator('#btn-tick').click();
  await mission.click();
  await expect(page.locator('#battle-panel')).toBeVisible();
  const card = page.locator('#bsquad .sq-card').first();
  await expect(card.locator('.sq-name')).toHaveText('»Крук');
  await expect(card.locator('.chev i')).toHaveCount(2);
  await card.click();
  const tile = page.locator('#btn-role');
  await expect(tile).toBeEnabled();
  await expect(tile.locator('.tb-cap')).toHaveText('Ривок');
  await expect(tile.locator('.tb-ap')).toHaveText('0 AP');
  await page.keyboard.press('r');
  await expect(page.locator('#binfo')).toHaveText('Іван: «Ривок» — AP 14/10 цього ходу.');
  await expect(tile.locator('.tb-cap')).toHaveText('вже було');
  await expect(tile).toBeDisabled();
  await expect(page.locator('#log')).toContainText('» Іван: «Ривок» +4 AP');
  await page.locator('#bsquad .sq-card').nth(1).click();
  await expect(tile.locator('.tb-cap')).toHaveText('Допомога');
  await page.locator('#bsquad .sq-card').nth(2).click();
  await expect(tile.locator('.tb-cap')).toHaveText('без ролі');
  expect(errors, 'помилки сторінки: ' + errors.join(' | ')).toEqual([]);
});

// Т.121 (рішення власника 22.11.2026, варіант А; кандидат 116): поки грає анімація ходу, порожня
// клітинка мовчить — тап не пише «Шлях: N AP» і другий тап не ходить наосліп. Тапи під час анімації —
// подіями в одному page.evaluate з тапом ходу: rAF між ними не встигає, анімація гарантовано триває.
test('Т.121: тап по порожній клітинці під час анімації ходу — ні підказки, ні ходу', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./');
  const helpClose = page.locator('#btn-help-close');
  if (await helpClose.isVisible()) await helpClose.click();
  await page.locator('#btn-start-new').click();
  await page.locator('#new-game-seed').fill(String(SEED));
  await page.locator('#new-game-preset').selectOption(PRESET);
  await page.locator('#btn-new-game-start').click();
  await page.locator('#status-tab-base').click();
  const mission = page.locator('#ufos button.mission').first();
  for (let i = 0; i < MAX_TICKS_TO_MISSION && !(await mission.isVisible()); i++) await page.locator('#btn-tick').click();
  await mission.click();
  await expect(page.locator('#battle-panel')).toBeVisible();
  const info = page.locator('#binfo');
  const taps = (cells: [number, number][]): Promise<string[]> =>
    page.evaluate((cs) => {
      const cv = document.getElementById('battle') as HTMLCanvasElement;
      const r = cv.getBoundingClientRect();
      const k = r.width / cv.width;
      const out: string[] = [];
      for (const [x, y] of cs) {
        const o = { bubbles: true, clientX: r.left + (x * 48 + 24) * k, clientY: r.top + (y * 48 + 24) * k };
        cv.dispatchEvent(new MouseEvent('mousemove', o));
        cv.dispatchEvent(new MouseEvent('click', o));
        out.push(document.getElementById('binfo')!.textContent ?? '');
      }
      return out;
    }, cells);
  await taps([[2, 2]]); // вибір
  await taps([[6, 2]]); // прев'ю ходу на 4 клітинки (≈ 0,36 с анімації)
  const t = await taps([
    [6, 2], // хід
    [6, 5], // тап під час анімації
    [6, 5], // другий тап — був би хід наосліп
  ]);
  expect(t[0], 'хід').toMatch(/: рух\. AP \d+\/\d+\.$/);
  expect(t[1], 'тап під час анімації підказки не пише').toBe(t[0]);
  expect(t[2], 'другий тап під час анімації не ходить').toBe(t[0]);
  // після анімації — тап-тап як завжди: перший тап — прев'ю, другий — хід
  await expect.poll(async () => (await taps([[6, 5]]))[0], { timeout: 5000 }).toMatch(/^Шлях: \d+ AP — повторний тап/);
  const ap = Number(/AP (\d+)\//.exec(t[0])![1]);
  const moved = (await taps([[6, 5]]))[0];
  expect(moved).toMatch(/: рух\. AP \d+\/\d+\.$/);
  expect(Number(/AP (\d+)\//.exec(moved)![1]), 'хід після анімації витрачає AP').toBeLessThan(ap);
  await expect(info).toHaveText(moved);
  expect(errors, 'помилки сторінки: ' + errors.join(' | ')).toEqual([]);
});

// Т.179 (кандидат 52, рішення власника 25.11.2026; ADR-0145): телефон пальцем. Гейт Т.143 на 844 × 390 тапає
// мишею (canvas.click) у контексті без тачу — сторінка бачить мишу з наведенням. Тут — окремий контекст телефона
// (hasTouch, isMobile, 844 × 390): тап — подіями дотику (locator.tap → touchstart / touchend і сумісні події
// миші, які браузер шле після дотику), сторінка бачить «(hover: none)» і «(pointer: coarse)».
// Перевірки: вибір бійця пальцем; перший тап по клітинці — лише прев'ю шляху (сумісний mousemove перед кліком
// не робить перший тап ходом); другий тап — хід; смуга загону пальцем вибирає бійця.
test.describe('Т.179: телефон пальцем (hasTouch, isMobile)', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } });

  test('Т.179: тап пальцем на 844 × 390 — вибір бійця, тап-тап ходу, картка смуги загону', async ({ page }) => {
    const errors = watchErrors(page);
    const mirror = new CoreMirror(SEED, PRESET);
    await page.goto('./');
    const media = await page.evaluate(() => ({
      touch: navigator.maxTouchPoints,
      hoverNone: matchMedia('(hover: none)').matches,
      coarse: matchMedia('(pointer: coarse)').matches,
      width: window.innerWidth,
    }));
    expect(media, 'Т.179: сторінка бачить телефон із тачем, а не мишу').toEqual({
      touch: expect.any(Number),
      hoverNone: true,
      coarse: true,
      width: 844,
    });
    expect(media.touch, 'Т.179: navigator.maxTouchPoints').toBeGreaterThan(0);
    const helpClose = page.locator('#btn-help-close');
    if (await helpClose.isVisible()) await helpClose.tap();
    await page.locator('#btn-start-new').tap();
    await page.locator('#new-game-seed').fill(String(SEED));
    await page.locator('#new-game-preset').selectOption(PRESET);
    await page.locator('#btn-new-game-start').tap();
    for (let i = 0; i < MAX_TICKS_TO_MISSION && mirror.targets().length === 0; i++) {
      await page.locator('#btn-tick').tap();
      mirror.tick();
    }
    expect(mirror.targets().length, 'на сіді ' + SEED + ' зонд не приземлився за дві доби').toBeGreaterThan(0);
    mirror.launch(mirror.targets()[0]!.id);
    await page.locator('#status-tab-base').tap();
    await page.locator('#ufos button.mission').first().tap();
    await expect(page.locator('#battle-panel')).toBeVisible();
    await expect(page.locator('#bctx-turn')).toHaveText('хід 1 · загін');

    const canvas = page.locator('#battle');
    const fingerTap = async (cell: Vec2): Promise<void> => {
      await canvas.scrollIntoViewIfNeeded();
      const box = await canvas.boundingBox();
      if (box === null) throw new Error('Канва бою не відображається');
      await canvas.tap({
        position: { x: ((cell.x + 0.5) * box.width) / MISSION_MAP_W, y: ((cell.y + 0.5) * box.height) / MISSION_MAP_H },
      });
    };
    const unit = page.locator('#bsquad .sq-card.sel');
    const info = page.locator('#binfo');
    const [soldier, other] = mirror.squad();
    await fingerTap(soldier!.pos);
    await expect(unit, 'Т.179: тап пальцем по бійцю вибирає його').toHaveAttribute('aria-label', unitLine(soldier!));
    const option = mirror.moveOption(soldier!);
    await fingerTap(option.cell);
    await expect(info, "Т.179: перший тап пальцем — прев'ю шляху, не хід").toContainText(
      'Шлях: ' + option.cost + ' AP — повторний тап у ту саму клітинку — хід.'
    );
    await fingerTap(option.cell);
    mirror.move(soldier!, option);
    await expect(info, 'Т.179: другий тап пальцем — хід').toHaveText(/: рух\. AP \d+\/\d+\.$/);
    await expect(unit, 'Т.179: після ходу AP бійця — як у дзеркалі').toHaveAttribute('aria-label', unitLine(soldier!));
    // Т.130: картка смуги загону пальцем — вибір іншого бійця
    await page.locator(`#bsquad .sq-card[data-unit="${other!.id}"]`).tap();
    await expect(unit, 'Т.179: тап пальцем по картці смуги загону вибирає бійця').toHaveAttribute('aria-label', unitLine(other!));
    expect(errors, 'помилки сторінки: ' + errors.join(' | ')).toEqual([]);
  });
});

// Т.171 (рішення власника 24.11.2026, «А. DejaVu скрізь»; кандидат 118; ADR-0139): шрифт сторінки в e2e —
// DejaVu Sans і в контейнері сесії, і в CI (e2e/fonts.conf через FONTCONFIG_FILE, playwright.e2e.config.ts);
// без цього гейти ширини і висоти тексту локально міряли з Inter, а в CI — з DejaVu Sans.
test('Т.171: шрифт сторінки в e2e — DejaVu Sans (fonts.conf)', async ({ page }) => {
  await page.goto('./');
  const m = await page.evaluate(() => {
    const c = document.createElement('canvas').getContext('2d')!;
    const s = 'Як грати — РУБІЖ: Наступний крок 0123456789';
    const w = (family: string): number => {
      c.font = '14px ' + family;
      return c.measureText(s).width;
    };
    return {
      body: w(getComputedStyle(document.body).fontFamily),
      dejavu: w('"DejaVu Sans", monospace'),
      mono: w('monospace'),
    };
  });
  // DejaVu Sans є в системі: інакше другий рядок упав би на monospace
  expect(m.dejavu, 'DejaVu Sans не встановлено — шрифт «Як грати» і гейти ширини не ті').not.toBeCloseTo(m.mono, 1);
  expect(
    m.body,
    'system-ui сторінки — не DejaVu Sans: FONTCONFIG_FILE не дійшов до браузера (у CI без нього теж DejaVu — там гейт ловить лише відсутність шрифту)'
  ).toBeCloseTo(m.dejavu, 2);
});
