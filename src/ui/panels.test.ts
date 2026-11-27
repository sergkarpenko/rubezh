// @vitest-environment jsdom
// пR.2: юніт-тести панелей стану і топбара (src/ui/panels.ts, ADR-0037).
// hpColor перенесено з main.test.ts без ослаблення тверджень; тут же —
// гілки рендерів (геосцена, сканери, винищувач, фінанси, ростер, кампанія).
// DOM-флоу застосунку лишається у main.ui.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { advanceTime, detectedProbes, geoClock, missionTargets } from '../core/geo';
import { FIGHTER_MAX_HP, startIntercept } from '../core/intercept';
import type { DifficultyPreset } from '../core/campaign';
import { createParty, type Party } from '../core/save';
import { ARMOR_MAX_HP_BONUS, OPTICS_ACCURACY_BONUS } from '../core/workshop';
import { GRENADE_DAMAGE, GRENADE_RANGE, HEAL_AMOUNT, HIT_CHANCE_CAP } from '../core/combat';
import { initPixelSprites } from '../render';
import { fighterLook } from '../core/render-core';
import {
  ROSTER_AVATAR,
  ROSTER_WEAPON_W,
  createPanels,
  gateCell,
  gunModuleReady,
  hpColor,
  inAirCombat,
  readyToIssue,
  type PanelsDeps,
} from './panels';
import { portraitCell } from './portrait';
import { SNIPER_RIFLE } from '../core/weapons';

// Піксельний рушій (ADR-0031): тестовий мок фабрики offscreen-канвасів —
// той самий патерн, що й у main.ui.test.ts (jsdom без пакета canvas).
const noopCtx = new Proxy(
  {},
  {
    get: (_t, p) => {
      if (p === 'canvas') return undefined;
      return (...args: unknown[]) => String(args.map((a) => String(a)).join(','));
    },
    set: () => true,
  }
) as unknown as CanvasRenderingContext2D;

function setupDom(): void {
  // Мінімальна розмітка index.html: топбар, геосцена, ictx, колонка стану, перемога.
  document.body.innerHTML = `
    <span id="clock">—</span>
    <span id="threat">—</span>
    <div id="campaign-goal"></div>
    <span id="campaign-progress">—</span>
    <span id="money">—</span>
    <span id="ready">—</span>
    <button id="btn-tick">+1 тік</button>
    <button id="btn-day">+1 доба</button>
    <button id="btn-event">До події</button>
    <span id="econ-rates"></span>
    <button id="btn-hire">Вербувати оперативника</button>
    <section id="geo-panel"><canvas id="geo" width="768" height="432"></canvas></section>
    <div id="ictx" class="hidden">
      <span><b id="ictx-target">—</b></span>
      <span><b id="ictx-status">—</b></span>
      <span><b id="ictx-round">—</b></span>
      <span><b id="ictx-fighter">—</b></span>
      <span><b id="ictx-probe">—</b></span>
    </div>
    <div id="probes"></div>
    <div id="fighter"></div>
    <span id="money-card">—</span>
    <div id="roster"></div>
    <section id="campaign-victory" class="hidden"><p id="campaign-victory-text"></p><span id="campaign-score">—</span><div id="campaign-score-lines"></div></section>
    <section id="campaign-defeat" class="hidden"><p id="campaign-defeat-text"></p><span id="campaign-defeat-score">—</span><div id="campaign-defeat-lines"></div></section>`;
  const proto = HTMLCanvasElement.prototype as unknown as { getContext: () => CanvasRenderingContext2D };
  proto.getContext = () => noopCtx;
}

interface Fixture {
  party: Party;
  deps: PanelsDeps;
  panels: ReturnType<typeof createPanels>;
}

function makeFixture(over: Partial<PanelsDeps> = {}): Fixture {
  const party = createParty(42);
  const deps: PanelsDeps = {
    getParty: () => party,
    inBattle: () => false,
    isGameOver: () => false,
    journal: vi.fn(),
    renderAll: vi.fn(),
    launchMission: vi.fn(),
    launchGate: vi.fn(),
    drainGeo: vi.fn(),
    drainEcon: vi.fn(),
    activeGeoAnim: () => null,
    geoAnimNow: () => 0,
    victoryDismissed: () => false,
    ambient: { paintGeo: vi.fn() }, // П14.8: ambient no-op (гейти в модулі)
    ...over,
  };
  return { party, deps, panels: createPanels(deps) };
}

// Детерміновано (сід 42): тікати до першого виявленого НЛО у заданому стані.
function tickUntil(party: Party, pred: () => boolean, limit = 3000): boolean {
  for (let i = 0; i < limit && !pred(); i++) advanceTime(party.geo, 1);
  return pred();
}

beforeEach(() => {
  setupDom();
  initPixelSprites((w, h) => ({
    width: w,
    height: h,
    getContext: () => noopCtx,
  }));
});

describe('hpColor: колір HP (перенесено з main.test.ts)', () => {
  it('повне HP — зелений, понад половину — жовтий', () => {
    expect(hpColor(10, 10)).toBe('#7fbf7f');
    expect(hpColor(9, 10)).toBe('#d8b25a');
  });

  it('рівно половина і нижче — червоний (строга межа > maxHp/2)', () => {
    expect(hpColor(5, 10)).toBe('#ff9c9c');
    expect(hpColor(1, 10)).toBe('#ff9c9c');
  });
});

describe('renderGeo: годинник, кнопки часу, анімаційний шар', () => {
  it('годинник оновлено, кнопки часу активні; drainGeo викликано', () => {
    const f = makeFixture();
    f.panels.renderGeo();
    expect(f.deps.drainGeo).toHaveBeenCalled();
    expect(document.getElementById('clock')!.textContent).toBe(geoClock(f.party.geo));
    expect((document.getElementById('btn-tick') as HTMLButtonElement).disabled).toBe(false);
    expect((document.getElementById('btn-day') as HTMLButtonElement).disabled).toBe(false);
  });

  it('у бою і при банкрутстві кнопки часу вимкнені; активна анімація геосцени читається', () => {
    const f = makeFixture({ inBattle: () => true, isGameOver: () => true, activeGeoAnim: vi.fn(() => null) });
    f.panels.renderGeo();
    expect((document.getElementById('btn-tick') as HTMLButtonElement).disabled).toBe(true);
    expect((document.getElementById('btn-day') as HTMLButtonElement).disabled).toBe(true);
    expect((document.getElementById('btn-event') as HTMLButtonElement).disabled).toBe(true); // Т.43
    expect(f.deps.activeGeoAnim).toHaveBeenCalled();
  });
});

describe('Т.16: повітряний бій заморожує час геосцени', () => {
  it('перехоплювач у бою — кнопки часу вимкнені; у погоні й на базі — активні', () => {
    const f = makeFixture();
    const fighter = f.party.intercept.fighters[0];
    const buttons = (): boolean[] => ['btn-tick', 'btn-day'].map((id) => (document.getElementById(id) as HTMLButtonElement).disabled);
    fighter.status = 'бій';
    expect(inAirCombat(f.party)).toBe(true);
    f.panels.renderGeo();
    expect(buttons()).toEqual([true, true]);
    for (const status of ['погоня', 'ремонт', 'на базі'] as const) {
      fighter.status = status;
      expect(inAirCombat(f.party)).toBe(false);
      f.panels.renderGeo();
      expect(buttons(), status).toEqual([false, false]);
    }
  });
});

describe('renderProbes: сканери НЛО', () => {
  it('нічого не виявлено — підказка рухати час', () => {
    const f = makeFixture();
    f.panels.renderProbes();
    expect(document.getElementById('probes')!.textContent).toContain('Нічого не виявлено');
  });

  it('виявлений НЛО у повітрі — кнопка перехоплення; клік стартує погоню (ядро) і renderAll', () => {
    const f = makeFixture();
    expect(tickUntil(f.party, () => detectedProbes(f.party.geo).some((u) => u.status === 'летить'))).toBe(true);
    f.panels.renderProbes();
    const ib = document.querySelector('button.intercept') as HTMLButtonElement;
    expect(ib).not.toBeNull();
    ib.click();
    expect(f.party.intercept.fighters[0].status).toBe('погоня');
    expect(f.deps.renderAll).toHaveBeenCalled();
  });

  it('пошкоджений винищувач — перехоплення недоступне (підказка про ремонт)', () => {
    const f = makeFixture();
    expect(tickUntil(f.party, () => detectedProbes(f.party.geo).some((u) => u.status === 'летить'))).toBe(true);
    f.party.intercept.fighters[0].hp = 2;
    f.panels.renderProbes();
    const ib = document.querySelector('button.intercept') as HTMLButtonElement;
    expect(ib.disabled).toBe(true);
    expect(ib.title).toContain('пошкоджений');
  });

  it('приземлений НЛО — кнопка місії; без боєготових — вимкнена з причиною', () => {
    const f = makeFixture();
    expect(tickUntil(f.party, () => missionTargets(f.party.geo).length > 0)).toBe(true);
    f.panels.renderProbes();
    const btn = document.querySelector('button.mission') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.disabled).toBe(false);
    for (const s of f.party.roster.soldiers) f.party.roster.hospital[s.id] = 3; // усі в лікарні — нікого в бій
    f.panels.renderProbes();
    const btn2 = document.querySelector('button.mission') as HTMLButtonElement;
    expect(btn2.disabled).toBe(true);
    expect(btn2.title).toContain('Усі оперативники поранені');
    btn2.onclick = null;
  });

  it('Т.24: останній загін без грошей на вербування — рядок-попередження, кнопка активна', () => {
    const f = makeFixture();
    expect(tickUntil(f.party, () => missionTargets(f.party.geo).length > 0)).toBe(true);
    f.panels.renderProbes();
    expect(document.querySelector('.mission-warn')).toBeNull(); // старт: 300 кредитів — запас є
    f.party.econ.money = 99; // «норма»: вербування 100
    f.panels.renderProbes();
    expect(f.party.roster.soldiers.length).toBeGreaterThan(3);
    expect(document.querySelector('.mission-warn')).toBeNull(); // боєготових більше за загін (3) — резерв є
    for (const s of f.party.roster.soldiers.slice(3)) f.party.roster.hospital[s.id] = 3; // боєготових троє — увесь загін іде в бій
    f.panels.renderProbes();
    const warn = document.querySelector('.probe .mission-warn');
    expect(warn!.textContent).toBe('⚠ Останній загін, а на вербування бракує (99 з 100): загине — банкрутство.');
    const btn = document.querySelector('button.mission') as HTMLButtonElement;
    expect(btn.disabled).toBe(false); // запуск лишається в один клік
    btn.click();
    expect(f.deps.launchMission).toHaveBeenCalledTimes(1);
    f.party.econ.money = 100; // на вербування вистачає — без попередження
    f.panels.renderProbes();
    expect(document.querySelector('.mission-warn')).toBeNull();
    f.party.econ.money = 0;
    for (const s of f.party.roster.soldiers) f.party.roster.hospital[s.id] = 3; // кнопка вимкнена — рядка нема
    f.panels.renderProbes();
    expect(document.querySelector('.mission-warn')).toBeNull();
  });

  it('кнопка місії веде до launchMission (застосунок)', () => {
    const f = makeFixture();
    expect(tickUntil(f.party, () => missionTargets(f.party.geo).length > 0)).toBe(true);
    f.panels.renderProbes();
    (document.querySelector('button.mission') as HTMLButtonElement).click();
    expect(f.deps.launchMission).toHaveBeenCalledWith(f.party.geo.probes.find((u) => u.id !== undefined)!.id);
  });
});

// п18.4 (ADR-0156; рішення власника «А. Мінімум»): рядок фіналу «Брама Розриву» в панелі зондів
describe('п18.4: renderProbes — рядок «Брама Розриву»', () => {
  it('до «Ключа брами» рядка немає; після — кнопка над зондами, клік — launchGate; nodeActions +1', () => {
    const f = makeFixture();
    f.panels.renderProbes();
    expect(document.getElementById('btn-gate')).toBeNull();
    const before = f.panels.nodeActions();
    f.party.research.completed.push('gate-key');
    f.panels.renderProbes();
    const box = document.getElementById('probes')!;
    expect(box.textContent).not.toContain('Нічого не виявлено'); // рядок брами замість підказки
    expect(box.firstElementChild!.textContent).toContain('Брама Розриву');
    const b = document.getElementById('btn-gate') as HTMLButtonElement;
    expect(b.textContent).toBe('▶ Атакувати Браму Розриву');
    expect(b.disabled).toBe(false);
    b.click();
    expect(f.deps.launchGate).toHaveBeenCalledTimes(1);
    expect(f.panels.nodeActions()).toBe(before + 1);
    // і з виявленими зондами — брама першим рядком
    expect(tickUntil(f.party, () => detectedProbes(f.party.geo).length > 0)).toBe(true);
    f.panels.renderProbes();
    expect(box.firstElementChild!.querySelector('#btn-gate')).not.toBeNull();
    expect(box.children.length).toBe(1 + detectedProbes(f.party.geo).length);
  });

  it('без боєготових — вимкнена з причиною (і без дії на вкладці); пауза після поразки — рядка немає', () => {
    const f = makeFixture();
    f.party.research.completed.push('gate-key');
    for (const s of f.party.roster.soldiers) f.party.roster.hospital[s.id] = 3;
    f.panels.renderProbes();
    const b = document.getElementById('btn-gate') as HTMLButtonElement;
    expect(b.disabled).toBe(true);
    expect(b.title).toContain('Немає боєготових');
    expect(f.panels.nodeActions()).toBe(0);
    f.party.campaign.gateReadyAt = f.party.geo.minute + 1440;
    f.panels.renderProbes();
    expect(document.getElementById('btn-gate')).toBeNull();
    expect(document.getElementById('probes')!.textContent).toContain('Нічого не виявлено');
  });

  it('у бою і після кінця гри — вимкнена', () => {
    for (const over of [{ inBattle: () => true }, { isGameOver: () => true }]) {
      const f = makeFixture(over);
      f.party.research.completed.push('gate-key');
      f.panels.renderProbes();
      expect((document.getElementById('btn-gate') as HTMLButtonElement).disabled).toBe(true);
    }
  });
});

describe('Т.7: nodeActions — дії, що чекають на вкладці «Вузол» (сигнал вкладки)', () => {
  it('нічого не виявлено — 0; зонд у повітрі і перехоплювач на базі — 1; погоня — 0', () => {
    const f = makeFixture();
    expect(f.panels.nodeActions()).toBe(0);
    expect(tickUntil(f.party, () => detectedProbes(f.party.geo).some((u) => u.status === 'летить'))).toBe(true);
    const flying = detectedProbes(f.party.geo).filter((u) => u.status === 'летить');
    expect(f.panels.nodeActions()).toBe(flying.length + missionTargets(f.party.geo).length);
    expect(f.panels.nodeActions()).toBeGreaterThan(0);
    startIntercept(f.party.intercept, f.party.geo, flying[0]!.id);
    expect(f.panels.nodeActions()).toBe(missionTargets(f.party.geo).length); // перехоплювач у погоні — кнопки «Перехопити» нема
  });

  // п19.4: дистанції повітряного бою — у середній колонці «Перехоплювачі» (без вкладки), сигнал «Вузла» їх не рахує
  it('приземлений зонд — місія рахується; повітряний бій — не рахується (середня колонка, п19.4)', () => {
    const f = makeFixture();
    expect(tickUntil(f.party, () => missionTargets(f.party.geo).length > 0)).toBe(true);
    const base = f.panels.nodeActions();
    expect(base).toBeGreaterThanOrEqual(missionTargets(f.party.geo).length);
    f.party.intercept.fighters[0].status = 'бій';
    const flying = detectedProbes(f.party.geo).filter((u) => u.status === 'летить').length;
    expect(f.panels.nodeActions()).toBe(base - flying);
  });

  it('у тактичному бою і після банкрутства — 0 (колонка неактивна)', () => {
    for (const over of [{ inBattle: () => true }, { isGameOver: () => true }]) {
      const f = makeFixture(over);
      expect(tickUntil(f.party, () => missionTargets(f.party.geo).length > 0)).toBe(true);
      expect(f.panels.nodeActions()).toBe(0);
    }
  });
});

// п19.4: кнопка модуля — у середній колонці «Перехоплювачі», сигнал вкладки «Вузол» її не рахує
describe('Т.80: гарматний модуль на складі — gunModuleReady (з п19.4 — поза сигналом «Вузла»)', () => {
  it('модуль на складі, не встановлено, перехоплювач на базі — готовий; nodeActions — 0', () => {
    const f = makeFixture();
    expect(f.panels.nodeActions()).toBe(0);
    f.party.workshop.store['gun-module'] = 1;
    expect(gunModuleReady(f.party)).toBe(true);
    expect(f.panels.nodeActions()).toBe(0);
    f.party.intercept.fighters[0].status = 'ремонт';
    expect(gunModuleReady(f.party)).toBe(false); // не «на базі» — кнопка неактивна
    expect(f.panels.nodeActions()).toBe(0);
    f.party.intercept.fighters[0].status = 'на базі';
    f.party.intercept.fighters[0].gunModule = true; // уже встановлено (другий на складі не ставиться)
    expect(gunModuleReady(f.party)).toBe(false);
    expect(f.panels.nodeActions()).toBe(0);
    f.party.intercept.fighters[0].gunModule = false;
    f.party.workshop.store['gun-module'] = 0;
    expect(gunModuleReady(f.party)).toBe(false);
  });

  it('у тактичному бою і після банкрутства — 0, хоч модуль і чекає', () => {
    for (const over of [{ inBattle: () => true }, { isGameOver: () => true }]) {
      const f = makeFixture(over);
      f.party.workshop.store['gun-module'] = 1;
      expect(f.panels.nodeActions()).toBe(0);
    }
  });
});

describe('renderFinances: чип балансу і кнопка найму', () => {
  it('баланс у чипі і картці (дублювання свідоме, ADR-0027); найм доступний', () => {
    const f = makeFixture();
    f.party.econ.money = 300;
    f.panels.renderFinances();
    expect(document.getElementById('money')!.textContent).toBe('300');
    expect(document.getElementById('money-card')!.textContent).toBe('300');
    expect((document.getElementById('btn-hire') as HTMLButtonElement).disabled).toBe(false);
  });

  it('Т.7: ставки і ціна вербування — з ядра за пресетом партії, не з розмітки', () => {
    const f = makeFixture();
    f.panels.renderFinances();
    expect(document.getElementById('econ-rates')!.textContent).toBe('· дотація 75/добу · премії за місію 110/170');
    expect(document.getElementById('btn-hire')!.textContent).toBe('Вербувати оперативника (100)');
    f.party.campaign.preset = 'легкий';
    f.panels.renderFinances();
    expect(document.getElementById('econ-rates')!.textContent).toBe('· дотація 90/добу · премії за місію 132/204');
    expect(document.getElementById('btn-hire')!.textContent).toBe('Вербувати оперативника (120)');
  });

  // п20.3: гейт аудиту PR #521 (ставка — з поточної Σ довір) раніше тримав флоу економіки `main.ui.test.ts`
  // на сіді 42; на сіді 7 у добу 1 довіра повна — неповну довіру ставимо тут напряму.
  it('п19.2: ставка дотації — з поточної Σ довір регіонів (370 з 400 — 69/добу)', () => {
    const f = makeFixture();
    f.party.campaign.regions.east.trust = 70;
    f.panels.renderFinances();
    expect(document.getElementById('econ-rates')!.textContent).toBe('· дотація 69/добу · премії за місію 110/170');
  });

  it('мало грошей — найм вимкнений з причиною; банкрутство — БАНКРУТ', () => {
    const f = makeFixture({ isGameOver: () => true });
    f.party.econ.money = 50;
    f.panels.renderFinances();
    expect((document.getElementById('btn-hire') as HTMLButtonElement).disabled).toBe(true);
    expect(document.getElementById('money')!.textContent).toBe('БАНКРУТ');
    expect(document.getElementById('money-card')!.textContent).toBe('БАНКРУТ');
  });
});

describe('renderInterceptCtx: контекст-стрічка повітряного бою (П7.5)', () => {
  it('на базі — стрічка прихована', () => {
    const f = makeFixture();
    f.panels.renderInterceptCtx();
    expect(document.getElementById('ictx')!.classList.contains('hidden')).toBe(true);
  });

  it('погоня — ціль і статус, раунд «—»; бій — раунд і HP обох', () => {
    const f = makeFixture();
    expect(tickUntil(f.party, () => detectedProbes(f.party.geo).some((u) => u.status === 'летить'))).toBe(true);
    const probe = detectedProbes(f.party.geo).find((u) => u.status === 'летить')!;
    startIntercept(f.party.intercept, f.party.geo, probe.id);
    f.panels.renderInterceptCtx();
    expect(document.getElementById('ictx')!.classList.contains('hidden')).toBe(false);
    expect(document.getElementById('ictx-target')!.textContent).toBe('№' + probe.id.replace('probe', ''));
    expect(document.getElementById('ictx-round')!.textContent).toBe('—');
    // штучний стан «бій» (гілка раунду і HP) — відображення, ядро не викликаємо
    f.party.intercept.fighters[0].status = 'бій';
    f.party.intercept.activeProbeId = probe.id;
    f.party.intercept.round = 3;
    f.party.intercept.probeHp[probe.id] = 5;
    f.panels.renderInterceptCtx();
    expect(document.getElementById('ictx-round')!.textContent).toBe('3');
    expect(document.getElementById('ictx-fighter')!.textContent).toBe('HP ' + FIGHTER_MAX_HP + '/' + FIGHTER_MAX_HP);
    expect(document.getElementById('ictx-probe')!.textContent).toBe('HP 5');
  });
});

describe('renderFighter: панель винищувача (П7.4)', () => {
  // Т.78 (кандидат 21): гарматний модуль вручну — встановити / зняти, безкоштовно й одразу, лише «на базі»
  it('Т.78: модуля немає ні на складі, ні на перехоплювачі — ні кнопки, ні рядка', () => {
    const f = makeFixture();
    f.panels.renderFighter();
    expect(document.getElementById('btn-gun-install')).toBeNull();
    expect(document.getElementById('btn-gun-remove')).toBeNull();
    expect(document.getElementById('gun-module-state')).toBeNull();
  });

  it('Т.78: модуль на складі — «Встановити модуль (+2 пошк.)»; клік ставить його безкоштовно, склад −1, renderAll', () => {
    const f = makeFixture();
    f.party.workshop.store['gun-module'] = 1;
    const money = f.party.econ.money;
    f.panels.renderFighter();
    const b = document.getElementById('btn-gun-install') as HTMLButtonElement;
    expect(b.textContent).toBe('Встановити модуль (+2 пошк.)');
    expect(b.disabled).toBe(false);
    b.click();
    expect(f.party.intercept.fighters[0].gunModule).toBe(true);
    expect(f.party.workshop.store['gun-module']).toBe(0);
    expect(f.party.econ.money).toBe(money);
    expect(f.party.workshop.log.at(-1)?.type).toBe('gun_module_installed');
    expect(f.deps.journal).not.toHaveBeenCalled();
    expect(f.deps.renderAll).toHaveBeenCalled();
    f.panels.renderFighter();
    expect(document.getElementById('gun-module-state')!.textContent).toBe('Гарматний модуль: встановлено');
    expect(document.getElementById('btn-gun-install')).toBeNull();
  });

  it('Т.78: модуль встановлено — «Зняти модуль» повертає його на склад', () => {
    const f = makeFixture();
    f.party.intercept.fighters[0].gunModule = true;
    f.panels.renderFighter();
    const b = document.getElementById('btn-gun-remove') as HTMLButtonElement;
    expect(b.textContent).toBe('Зняти модуль');
    expect(b.disabled).toBe(false);
    b.click();
    expect(f.party.intercept.fighters[0].gunModule).toBe(false);
    expect(f.party.workshop.store['gun-module']).toBe(1);
    expect(f.party.workshop.log.at(-1)?.type).toBe('gun_module_removed');
  });

  it('Т.78: перехоплювач не на базі (погоня, бій, ремонт) — кнопка неактивна з причиною рядком; модуль лишається', () => {
    for (const status of ['погоня', 'бій', 'ремонт'] as const) {
      const f = makeFixture();
      f.party.intercept.fighters[0].gunModule = true;
      f.party.intercept.fighters[0].status = status;
      f.party.intercept.fighters[0].repairTicksLeft = 3;
      f.panels.renderFighter();
      const b = document.getElementById('btn-gun-remove') as HTMLButtonElement;
      expect(b.disabled).toBe(true);
      expect(b.nextElementSibling?.textContent).toBe('Лише у вузлі «Рубіж»: перехоплювач зараз — ' + status);
      expect(document.getElementById('gun-module-state')!.textContent).toBe('Гарматний модуль: встановлено');
    }
  });

  it('Т.78: і бій, і банкрутство — причина «Партію програно»; на базі — title з ефектом і кількістю на складі', () => {
    const f = makeFixture({ inBattle: () => true, isGameOver: () => true });
    f.party.workshop.store['gun-module'] = 2;
    f.panels.renderFighter();
    expect((document.getElementById('btn-gun-install') as HTMLButtonElement).nextElementSibling?.textContent).toBe('Партію програно');
    const g = makeFixture();
    g.party.workshop.store['gun-module'] = 2;
    g.panels.renderFighter();
    expect((document.getElementById('btn-gun-install') as HTMLButtonElement).title).toBe(
      '+2 пошкодження за раунд повітряного бою · зі складу: 2'
    );
  });

  it('Т.78: у бою і після банкрутства — кнопка неактивна з причиною', () => {
    for (const [over, why] of [
      [{ inBattle: () => true }, 'Під час бою недоступно'],
      [{ isGameOver: () => true }, 'Партію програно'],
    ] as const) {
      const f = makeFixture(over);
      f.party.workshop.store['gun-module'] = 1;
      f.panels.renderFighter();
      const b = document.getElementById('btn-gun-install') as HTMLButtonElement;
      expect(b.disabled).toBe(true);
      expect(b.nextElementSibling?.textContent).toBe(why);
    }
  });

  it('боєготовий на базі — статус і повний HP', () => {
    const f = makeFixture();
    f.panels.renderFighter();
    expect(document.getElementById('fighter')!.textContent).toContain('боєготовий');
    expect(document.getElementById('fighter')!.textContent).toContain('HP');
    expect(document.getElementById('btn-repair')).toBeNull();
  });

  it('пошкоджений на базі — кнопка ремонту; клік стартує ремонт (ядро) і renderAll', () => {
    const f = makeFixture();
    f.party.intercept.fighters[0].hp = 3;
    f.panels.renderFighter();
    const b = document.getElementById('btn-repair') as HTMLButtonElement;
    expect(b).not.toBeNull();
    expect(b.disabled).toBe(false);
    b.click();
    expect(f.party.intercept.fighters[0].status).toBe('ремонт');
    expect(f.deps.renderAll).toHaveBeenCalled();
  });

  it('Т.26: боєготових немає, після ремонту бракує на вербування — рядок-попередження, кнопка активна', () => {
    const f = makeFixture();
    f.party.intercept.fighters[0].hp = 0;
    f.party.econ.money = 149; // «норма»: ремонт 50 + вербування 100
    f.panels.renderFighter();
    expect(document.getElementById('repair-warn')).toBeNull(); // боєготові є — авторемонт не відкладається
    for (const s of f.party.roster.soldiers) f.party.roster.hospital[s.id] = 3;
    f.panels.renderFighter();
    const warn = document.querySelector('#fighter .mission-warn');
    expect(warn!.textContent).toBe('⚠ Ремонт не почався сам: боєготових немає, а після ремонту не лишиться на вербування (149 з 150).');
    const b = document.getElementById('btn-repair') as HTMLButtonElement;
    expect(b.disabled).toBe(false); // ручна оплата лишається в один клік
    f.party.econ.money = 150; // на ремонт і вербування вистачає — без попередження
    f.panels.renderFighter();
    expect(document.getElementById('repair-warn')).toBeNull();
    f.party.econ.money = 49; // кнопка вимкнена (на ремонт бракує) — рядка нема
    f.panels.renderFighter();
    expect(document.getElementById('repair-warn')).toBeNull();
    f.party.econ.money = 149;
    f.panels.renderFighter();
    (document.getElementById('btn-repair') as HTMLButtonElement).click();
    expect(f.party.intercept.fighters[0].status).toBe('ремонт');
    f.panels.renderFighter();
    expect(document.getElementById('repair-warn')).toBeNull();
  });

  it('ремонт — статус з тіками, кнопки дій нема', () => {
    const f = makeFixture();
    f.party.intercept.fighters[0].status = 'ремонт';
    f.party.intercept.fighters[0].repairTicksLeft = 2;
    f.panels.renderFighter();
    expect(document.getElementById('fighter')!.textContent).toContain('ремонт: 2 тіки');
    expect(document.getElementById('fighter')!.querySelectorAll('button').length).toBe(0);
  });

  it('стан «бій» — рядок дистанцій (вимкнений у тактичній місії), клік рішення — ядро', () => {
    const f = makeFixture({ inBattle: () => true });
    expect(tickUntil(f.party, () => detectedProbes(f.party.geo).length > 0)).toBe(true);
    const probe = detectedProbes(f.party.geo)[0]!;
    f.party.intercept.fighters[0].status = 'бій';
    f.party.intercept.activeProbeId = probe.id;
    f.party.intercept.probeHp[probe.id] = 7;
    f.party.intercept.round = 1;
    f.panels.renderFighter();
    const btns = [...document.querySelectorAll<HTMLButtonElement>('.intercept-range')];
    expect(btns.map((b) => b.dataset.choice)).toEqual(['далека', 'середня', 'впритул', 'відступ']);
    for (const b of btns) expect(b.disabled).toBe(true); // тактичний бій — час заморожено
  });
});

describe('renderRoster: ростер і чип боєготових (ADR-0027)', () => {
  it('солдати з HP-кольором і лікарнею; чип у топбарі', () => {
    const f = makeFixture();
    f.party.roster.soldiers[0]!.hp = 4;
    f.party.roster.hospital[f.party.roster.soldiers[0]!.id] = 3;
    f.panels.renderRoster();
    expect(document.getElementById('ready')!.textContent).toBe('5/6');
    const box = document.getElementById('roster')!;
    expect(box.textContent).toContain('6 оперативників (5 боєготових)');
    expect(box.innerHTML).toContain('лікарня: 3 тіки');
    expect(box.innerHTML).toContain('#ff9c9c'); // hpColor(4, 10) — поранений
  });

  it('Т.129 (ADR-0118): у кожному рядку — аватар «шолом» кольору бійця, кліп із власним id', () => {
    const f = makeFixture();
    f.panels.renderRoster();
    const svgs = [...document.querySelectorAll('#roster .soldier > .pt > svg.avatar')];
    expect(svgs.length).toBe(f.party.roster.soldiers.length);
    expect(svgs.map((s) => s.getAttribute('data-color'))).toEqual(f.party.roster.soldiers.map((s) => fighterLook(s.id).color));
    const clips = [...document.querySelectorAll('#roster clipPath')].map((c) => c.id);
    expect(new Set(clips).size).toBe(clips.length);
    expect(svgs[0]!.querySelector('g')!.getAttribute('clip-path')).toBe('url(#' + clips[0] + ')');
  });

  it('п21.4 (ADR-0178): у кожному рядку — мальований бюст поверх шолома, клітинка атласа — за id', () => {
    const f = makeFixture();
    f.panels.renderRoster();
    const pts = [...document.querySelectorAll<HTMLElement>('#roster .soldier > .pt')];
    expect(pts.map((p) => p.dataset.portrait)).toEqual(
      f.party.roster.soldiers.map((s) => {
        const c = portraitCell(s.id)!;
        return c.col + ',' + c.row;
      })
    );
    expect(pts[0]!.style.width).toBe(ROSTER_AVATAR + 'px');
    expect(pts.map((p) => p.querySelector('svg.avatar')!.getAttribute('data-color'))).toEqual(
      f.party.roster.soldiers.map((s) => fighterLook(s.id).color)
    );
    expect(pts.every((p) => p.parentElement!.classList.contains('with-pt'))).toBe(true);
    expect(pts[0]!.querySelector('i')!.style.backgroundImage).toContain('portraits');
  });

  it('п20.5 (ADR-0169; рішення власника «Б. + ростер «Загін»»): у третьому рядку — іконка зброї бійця', () => {
    const f = makeFixture();
    f.party.roster.soldiers[0]!.weapon = SNIPER_RIFLE;
    f.panels.renderRoster();
    const icons = [...document.querySelectorAll<HTMLElement>('#roster .soldier .s-wpn')];
    expect(icons.map((i) => i.dataset.weapon)).toEqual(f.party.roster.soldiers.map((_, i) => (i === 0 ? 'sniper' : 'rifle')));
    expect(icons[0]!.title).toBe('Гвинтівка «Голка»');
    expect(icons[0]!.style.width).toBe(ROSTER_WEAPON_W + 'px');
    // зброя поза каталогом (не мала б траплятись) — «Гарт»
    f.party.roster.soldiers[1]!.weapon = { ...SNIPER_RIFLE, name: 'Інша' };
    f.panels.renderRoster();
    expect(document.querySelectorAll<HTMLElement>('#roster .soldier .s-wpn')[1]!.dataset.weapon).toBe('rifle');
  });

  it('порожній ростер — «Загін втрачено» і підказка щодо найму', () => {
    const f = makeFixture();
    f.party.roster.soldiers.length = 0;
    f.party.econ.money = 300;
    f.panels.renderRoster();
    expect(document.getElementById('roster')!.textContent).toContain('Загін втрачено');
    expect(document.getElementById('roster')!.textContent).toContain('Вербування доступне');
    f.party.econ.money = 10;
    f.panels.renderRoster();
    expect(document.getElementById('roster')!.textContent).toContain('Кредитів на вербування немає');
  });
});

describe('renderCampaign: чипи кампанії і екран перемоги (П8.3)', () => {
  it('чипи статусу і доби; у бою прогрес приховано', () => {
    const f = makeFixture({ inBattle: () => true });
    f.panels.renderCampaign();
    expect(document.getElementById('threat-num')!.textContent).toBe('0'); // п18.5: чип загрози замість «кампанія: …»
    expect(document.getElementById('campaign-progress')!.textContent).toBe('Д1'); // п18.3: без «/30»
    expect(document.getElementById('campaign-progress')!.classList.contains('hidden')).toBe(true);
    expect(document.getElementById('campaign-victory')!.classList.contains('hidden')).toBe(true);
  });

  it('перемога — екран з підсумковим рахунком', () => {
    const f = makeFixture();
    f.party.campaign.status = 'перемога';
    f.party.campaign.score = { probesShotDown: 0, missionsWon: 0, veteransAlive: 0, moneyLeft: 0, total: 1234 };
    f.panels.renderCampaign();
    expect(document.getElementById('campaign-victory')!.classList.contains('hidden')).toBe(false);
    expect(document.getElementById('campaign-score')!.textContent).toBe('1\u00a0234'); // п18.5: пробіл розрядів
  });

  // П8.3a: endless (рішення власника 2026-10-15) — «Грати далі» ховає екран
  it('перемога + «Грати далі» (endless) — екран приховано, рахунок лишився', () => {
    const f = makeFixture({ victoryDismissed: () => true });
    f.party.campaign.status = 'перемога';
    f.party.campaign.score = { probesShotDown: 0, missionsWon: 0, veteransAlive: 0, moneyLeft: 0, total: 1234 };
    f.panels.renderCampaign();
    expect(document.getElementById('campaign-goal')!.textContent).toContain('Браму Розриву зачинено'); // п18.5
    expect(document.getElementById('campaign-victory')!.classList.contains('hidden')).toBe(true);
    expect(document.getElementById('campaign-score')!.textContent).toBe('1\u00a0234'); // п18.5: пробіл розрядів
  });
});

// П11.6 (Фаза 11, ADR-0058/0013): екіпірування в картці солдата ростеру.
describe('renderRoster: екіпірування (П11.6, ADR-0058)', () => {
  it('кнопки чотирьох предметів у кожного солдата; без предмета на складі — вимкнені', () => {
    const f = makeFixture();
    f.panels.renderRoster();
    const s = f.party.roster.soldiers[0]!;
    const armor = document.getElementById('btn-equip-' + s.id + '-armor') as HTMLButtonElement;
    const optics = document.getElementById('btn-equip-' + s.id + '-optics') as HTMLButtonElement;
    const medkit = document.getElementById('btn-equip-' + s.id + '-medkit') as HTMLButtonElement;
    const grenade = document.getElementById('btn-equip-' + s.id + '-grenade') as HTMLButtonElement;
    expect(armor && optics && medkit && grenade).toBeTruthy();
    expect(armor.disabled).toBe(true); // склад порожній
    expect(armor.title).toContain('немає на складі');
  });

  // П12.5 (ADR-0065): підказка спорядження несе числовий ефект ДО дії —
  // «зараз → стане» цього солдата; числа з констант (не дублі руками).
  it('критерій 1 (П12.5): підказки спорядження показують числовий ефект до дії', () => {
    const f = makeFixture();
    const s = f.party.roster.soldiers[0]!;
    f.party.workshop.store['armor'] = 1;
    f.party.workshop.store['optics'] = 1;
    f.party.workshop.store['medkit'] = 1;
    f.party.workshop.store['grenade'] = 1;
    f.panels.renderRoster();
    const armor = document.getElementById('btn-equip-' + s.id + '-armor') as HTMLButtonElement;
    expect(armor.title).toContain('+' + ARMOR_MAX_HP_BONUS + ' макс. HP (' + s.maxHp + ' → ' + (s.maxHp + ARMOR_MAX_HP_BONUS) + ')');
    const optics = document.getElementById('btn-equip-' + s.id + '-optics') as HTMLButtonElement;
    expect(optics.title).toContain('+' + OPTICS_ACCURACY_BONUS * 100 + '% точності');
    expect(optics.title).toContain('(' + Math.round(s.firingAccuracy * 100) + '% → ');
    expect(optics.title).toContain('кап ' + HIT_CHANCE_CAP * 100 + '%');
    const medkit = document.getElementById('btn-equip-' + s.id + '-medkit') as HTMLButtonElement;
    expect(medkit.title).toContain('+' + HEAL_AMOUNT + ' HP');
    expect(medkit.title).toContain('по одній на місію');
    const grenade = document.getElementById('btn-equip-' + s.id + '-grenade') as HTMLButtonElement;
    expect(grenade.title).toContain(GRENADE_DAMAGE[0] + '–' + GRENADE_DAMAGE[1]);
    expect(grenade.title).toContain('дальність ' + GRENADE_RANGE);
    expect(grenade.title).toContain('уражає і своїх');
  });

  it('спорядження брони зі складу — +2 maxHp/hp, предмет ✓, склад порожнішає', () => {
    const f = makeFixture();
    const s = f.party.roster.soldiers[0]!;
    f.party.workshop.store['armor'] = 1;
    f.panels.renderRoster();
    const beforeHp = s.hp;
    const beforeMax = s.maxHp;
    (document.getElementById('btn-equip-' + s.id + '-armor') as HTMLButtonElement).click();
    expect(f.party.workshop.equipped[s.id]!.armor).toBe(true);
    expect(f.party.workshop.store['armor']).toBe(0);
    expect(s.maxHp).toBe(beforeMax + 2);
    expect(s.hp).toBe(beforeHp + 2);
    f.panels.renderRoster();
    const armorBtn = document.getElementById('btn-equip-' + s.id + '-armor') as HTMLButtonElement;
    expect(armorBtn.textContent).toContain('броня ✓');
    expect(armorBtn.disabled).toBe(false); // тепер це кнопка «зняти»
  });

  it('зняття броні — назад на склад, hp клемується новим maxHp', () => {
    const f = makeFixture();
    const s = f.party.roster.soldiers[0]!;
    f.party.workshop.store['armor'] = 1;
    f.panels.renderRoster();
    (document.getElementById('btn-equip-' + s.id + '-armor') as HTMLButtonElement).click();
    s.hp = s.maxHp; // повне здоров'я у броні
    f.panels.renderRoster();
    (document.getElementById('btn-equip-' + s.id + '-armor') as HTMLButtonElement).click();
    expect(f.party.workshop.store['armor']).toBe(1);
    expect(s.maxHp).toBe(10);
    expect(s.hp).toBe(10); // hp min(hp, maxHp) — «оздоровлення» нема
    expect(f.party.workshop.equipped[s.id]).toBeUndefined(); // порожній запис вилучено
  });

  it('оптика — +0.05 точності; витратники — по одному на солдата', () => {
    const f = makeFixture();
    const s = f.party.roster.soldiers[0]!;
    f.party.workshop.store['optics'] = 1;
    f.party.workshop.store['medkit'] = 1;
    f.party.workshop.equipped[s.id] = { armor: false, optics: false, medkit: true, grenade: false };
    const accBefore = s.firingAccuracy;
    f.panels.renderRoster();
    (document.getElementById('btn-equip-' + s.id + '-optics') as HTMLButtonElement).click();
    expect(s.firingAccuracy).toBeCloseTo(accBefore + 0.05, 10);
    f.panels.renderRoster();
    const medkitBtn = document.getElementById('btn-equip-' + s.id + '-medkit') as HTMLButtonElement;
    expect(medkitBtn.textContent).toContain('гель ✓'); // уже при оперативникові
    expect(medkitBtn.disabled).toBe(false); // зняти можна
    (document.getElementById('btn-equip-' + s.id + '-medkit') as HTMLButtonElement).click();
    expect(f.party.workshop.store['medkit']).toBe(2); // 1 + повернуто
  });

  it('критерій 1: у бою кнопки екіпірування вимкнені (лише геосцена)', () => {
    const f = makeFixture({ inBattle: () => true });
    const s = f.party.roster.soldiers[0]!;
    f.party.workshop.store['medkit'] = 2;
    f.panels.renderRoster();
    expect((document.getElementById('btn-equip-' + s.id + '-medkit') as HTMLButtonElement).disabled).toBe(true);
  });

  it('помилка ядра (зняття неспорядженого — стан змінився поза панеллю) — у журнал', () => {
    const f = makeFixture();
    const s = f.party.roster.soldiers[0]!;
    f.party.workshop.store['medkit'] = 1;
    f.panels.renderRoster();
    (document.getElementById('btn-equip-' + s.id + '-medkit') as HTMLButtonElement).click();
    // предмет зняли напряму через ядро — панель ще не перемальована
    f.party.workshop.equipped[s.id]!.medkit = false;
    (document.getElementById('btn-equip-' + s.id + '-medkit') as HTMLButtonElement).click(); // «зняти» ще раз
    expect(f.deps.journal).toHaveBeenCalledWith(expect.stringContaining('Предмета немає'), 'lose', 'base');
    expect(f.party.workshop.store['medkit']).toBe(0); // помилка ядра — склад не змінився
  });
});

describe('T.39: readyToIssue — лічильник на вкладці «Загін»', () => {
  it('порожній склад — 0; далі min(склад, оперативників без предмета); модуль не враховується', () => {
    const { party } = makeFixture();
    expect(readyToIssue(party)).toBe(0);
    const soldiers = party.roster.soldiers.length;
    party.workshop.store.armor = soldiers + 5; // більше, ніж оперативників
    party.workshop.store.medkit = 1;
    expect(readyToIssue(party)).toBe(soldiers + 1);
    // один оперативник уже в броні — він не видається вдруге
    party.workshop.equipped[party.roster.soldiers[0].id] = { armor: true, optics: false, medkit: false, grenade: false };
    expect(readyToIssue(party)).toBe(soldiers);
    // гарматний модуль на складі не видається оперативникам
    party.workshop.store['gun-module'] = 3;
    expect(readyToIssue(party)).toBe(soldiers); // без зміни від модуля
  });
});

// Т.43 (знахідка 14): причина неактивної кнопки — рядком під нею, текст = title.
describe('Т.43: причини під неактивними кнопками і остання подія перехоплювача', () => {
  const why = (b: Element | null): string | null => {
    const n = b?.nextElementSibling;
    return n?.classList.contains('btn-why') ? n.textContent : null;
  };
  // пресет «легкий»: вербування 120 (множник не 1 — урок Т.29)
  function easy(over: Partial<PanelsDeps> = {}): Fixture {
    const party = createParty(42, 'легкий');
    const f = makeFixture({ getParty: () => party, ...over });
    return { ...f, party };
  }
  const woundAll = (p: Party): void => p.roster.soldiers.forEach((s) => (p.roster.hospital[s.id] = 10));

  it('«Вербувати оперативника»: рядок = title без кредитів; з кредитами рядка немає; повторний рендер не дублює', () => {
    const f = easy();
    const b = document.getElementById('btn-hire') as HTMLButtonElement;
    f.party.econ.money = 119;
    f.panels.renderFinances();
    f.panels.renderFinances();
    expect(why(b)).toBe('Недостатньо кредитів (ціна вербування 120)');
    expect(why(b)).toBe(b.title);
    expect(document.querySelectorAll('.btn-why').length).toBe(1);
    f.party.econ.money = 120;
    f.panels.renderFinances();
    expect(b.disabled).toBe(false);
    expect(why(b)).toBeNull();
  });

  it('«Запустити місію»: поранені — рядок = title; боєготові — рядка немає; у бою з боєготовими — неактивна без рядка', () => {
    const f = easy();
    expect(tickUntil(f.party, () => missionTargets(f.party.geo).length > 0)).toBe(true);
    const mission = (): HTMLButtonElement => document.querySelector('#probes button.mission') as HTMLButtonElement;
    f.panels.renderProbes();
    expect(mission().disabled).toBe(false);
    expect(why(mission())).toBeNull();
    woundAll(f.party);
    f.panels.renderProbes();
    expect(mission().disabled).toBe(true);
    expect(why(mission())).toBe('Усі оперативники поранені — чекайте одужання або вербуйте');
    expect(why(mission())).toBe(mission().title);
    const battle = easy({ inBattle: () => true });
    tickUntil(battle.party, () => missionTargets(battle.party.geo).length > 0);
    battle.panels.renderProbes();
    expect(mission().disabled).toBe(true);
    expect(why(mission())).toBeNull();
  });

  it('«Перехопити»: пошкоджений перехоплювач — рядок = title; справний — рядка немає', () => {
    const f = easy();
    expect(tickUntil(f.party, () => detectedProbes(f.party.geo).some((u) => u.status === 'летить'))).toBe(true);
    const ib = (): HTMLButtonElement => document.querySelector('#probes button.intercept') as HTMLButtonElement;
    f.panels.renderProbes();
    expect(ib().title).toBe('Підняти перехоплювач на перехоплення');
    expect(why(ib())).toBeNull();
    f.party.intercept.fighters[0].hp = 1;
    f.panels.renderProbes();
    expect(ib().disabled).toBe(true);
    expect(why(ib())).toBe('Перехоплювач пошкоджений — спочатку ремонт');
    expect(why(ib())).toBe(ib().title);
  });

  it('«Ремонт»: без кредитів — рядок = title; з кредитами — рядка немає', () => {
    const f = easy();
    const rb = (): HTMLButtonElement => document.getElementById('btn-repair') as HTMLButtonElement;
    f.party.intercept.fighters[0].hp = 1;
    f.party.econ.money = 49;
    f.panels.renderFighter();
    expect(why(rb())).toBe('Недостатньо кредитів (ціна ремонту 50)');
    expect(why(rb())).toBe(rb().title);
    f.party.econ.money = 50; // рівно ціна — кнопка активна, рядка немає
    f.panels.renderFighter();
    expect(rb().disabled).toBe(false);
    expect(why(rb())).toBeNull();
  });

  it('банкрутство: під «Запустити місію» — «Партію програно — банкрутство»; у бою під справною «Перехопити» рядка немає', () => {
    const over = easy({ isGameOver: () => true });
    expect(tickUntil(over.party, () => missionTargets(over.party.geo).length > 0)).toBe(true);
    over.panels.renderProbes();
    const mission = document.querySelector('#probes button.mission') as HTMLButtonElement;
    expect(mission.disabled).toBe(true);
    expect(why(mission)).toBe('Партію програно — банкрутство');
    const battle = easy({ inBattle: () => true });
    expect(tickUntil(battle.party, () => detectedProbes(battle.party.geo).some((u) => u.status === 'летить'))).toBe(true);
    battle.panels.renderProbes();
    const ib = document.querySelector('#probes button.intercept') as HTMLButtonElement;
    expect(ib.disabled).toBe(true);
    expect(why(ib)).toBeNull();
  });

  it('#fighter-last: текст журналу після перерваного перехоплення; зникає після нового старту і після розриву контакту', () => {
    const f = easy();
    const last = (): string | null => document.getElementById('fighter-last')?.textContent ?? null;
    // Т.51: зонди подій мають бути в geo.probes, інакше рядок не показується (перевірка за id зонда)
    expect(tickUntil(f.party, () => f.party.geo.probes.length > 0)).toBe(true);
    f.party.geo.probes.push({ ...f.party.geo.probes[0], id: 'probe2' }, { ...f.party.geo.probes[0], id: 'probe4' });
    f.panels.renderFighter();
    expect(last()).toBeNull();
    const pos = { x: 1, y: 1 };
    f.party.geo.log.push({ type: 'intercept_start', probeId: 'probe2', pos, minute: 0 });
    f.party.geo.log.push({ type: 'intercept_aborted', probeId: 'probe2', reason: 'probe_lost', pos, minute: 30 });
    f.party.geo.log.push({ type: 'fighter_returned', pos, minute: 60 });
    f.panels.renderFighter();
    expect(last()).toBe('✦ Зонд Розриву №2 зник з трекінгу — перехоплення перервано');
    f.party.geo.log.push({ type: 'intercept_start', probeId: 'probe3', pos, minute: 90 });
    f.panels.renderFighter();
    expect(last()).toBeNull();
    f.party.geo.log.push({ type: 'intercept_aborted', probeId: 'probe3', reason: 'fighter_damaged', pos, minute: 120 });
    f.party.intercept.fighters[0].hp = 1;
    f.panels.renderFighter();
    expect(last()).toBe('✦ Перехоплювач пошкоджений — вимушене переривання бою');
    f.party.intercept.fighters[0].hp = FIGHTER_MAX_HP; // пошкодження вже відремонтовано — рядок застарів
    f.panels.renderFighter();
    expect(last()).toBeNull();
    f.party.intercept.fighters[0].hp = 1;
    f.party.geo.log.push({ type: 'intercept_break_off', probeId: 'probe3', minute: 150 });
    f.panels.renderFighter();
    expect(last()).toBeNull();
    // Т.49: зонд приземлився під час погоні — власний текст журналу, без «зник з трекінгу»
    f.party.geo.log.push({ type: 'intercept_start', probeId: 'probe4', pos, minute: 180 });
    f.panels.renderFighter();
    expect(last()).toBeNull();
    f.party.geo.log.push({ type: 'intercept_aborted', probeId: 'probe4', reason: 'probe_landed', pos, minute: 210 });
    f.panels.renderFighter();
    expect(last()).toBe('✦ Зонд Розриву №4 приземлився — перехоплення перервано');
  });
});

// Т.51: рядок #fighter-last не показується, якщо зонд події вже не в geo.probes (виліт probe_left / місія).
describe('Т.51: #fighter-last при відсутньому зонді події в geo.probes', () => {
  const pos = { x: 1, y: 1 };
  const last = (): string | null => document.getElementById('fighter-last')?.textContent ?? null;
  // об'єкт зонда — копія створеної ядром, зі зміненим id
  const addProbe = (f: Fixture, id: string): void => {
    expect(tickUntil(f.party, () => f.party.geo.probes.length > 0)).toBe(true);
    f.party.geo.probes = [{ ...f.party.geo.probes[0], id }]; // копія створеного ядром зонда зі зміненим id
  };
  const dropProbe = (f: Fixture, id: string): void => {
    f.party.geo.probes = f.party.geo.probes.filter((u) => u.id !== id);
  };

  it('Т.51.1: probe_landed, зонд є в geo.probes — рядок показується', () => {
    const f = makeFixture();
    addProbe(f, 'probe5');
    f.party.geo.log.push({ type: 'intercept_aborted', probeId: 'probe5', reason: 'probe_landed', pos, minute: 10 });
    f.panels.renderFighter();
    expect(last()).toBe('✦ Зонд Розриву №5 приземлився — перехоплення перервано');
  });

  it('Т.51.2: probe_landed, зонд прибрано з geo.probes — після renderFighter рядка немає', () => {
    const f = makeFixture();
    addProbe(f, 'probe5');
    f.party.geo.log.push({ type: 'intercept_aborted', probeId: 'probe5', reason: 'probe_landed', pos, minute: 10 });
    dropProbe(f, 'probe5');
    f.panels.renderFighter();
    expect(last()).toBeNull();
  });

  it('Т.51.3: probe_lost — зонд є: рядок; зонда немає: рядка немає', () => {
    const f = makeFixture();
    addProbe(f, 'probe6');
    f.party.geo.log.push({ type: 'intercept_aborted', probeId: 'probe6', reason: 'probe_lost', pos, minute: 20 });
    f.panels.renderFighter();
    expect(last()).toBe('✦ Зонд Розриву №6 зник з трекінгу — перехоплення перервано');
    dropProbe(f, 'probe6');
    f.panels.renderFighter();
    expect(last()).toBeNull();
  });

  it('Т.51.4: fighter_damaged при HP < FIGHTER_MAX_HP і відсутньому зонді — рядок є', () => {
    const f = makeFixture();
    f.party.intercept.fighters[0].hp = 1;
    f.party.geo.log.push({ type: 'intercept_aborted', probeId: 'probe7', reason: 'fighter_damaged', pos, minute: 30 });
    f.panels.renderFighter();
    expect(last()).toBe('✦ Перехоплювач пошкоджений — вимушене переривання бою');
  });

  it('Т.51.5: у geo.probes є лише інший зонд (інший id) — рядка немає (перевірка за id, а не за наявністю будь-якого зонда)', () => {
    const f = makeFixture();
    addProbe(f, 'probe9');
    f.party.geo.log.push({ type: 'intercept_aborted', probeId: 'probe5', reason: 'probe_landed', pos, minute: 40 });
    f.panels.renderFighter();
    expect(last()).toBeNull();
  });
});

// issue #385 (кандидат 16): три структурні рядки-попередження в panels.ts мають показувати
// hirePrice(preset) пресету партії, а не hirePrice() «норми» (100). Очікування — таблицею
// «пресет × гроші → текст або null» з літералами (ціни найму: «легкий» 120, «складний» 90).
// Гроші 80/95/110: 80 < 90 — текст попередження на «складному»; 95 і 110 лежать між 90 і 120 —
// розрізняють доступність вербування в ростері; жодна із сум не збігається з «нормою» (100),
// тому заміна hirePrice(preset) → hirePrice() у кожному з трьох рядків дає червоним обидва пресети.
describe('issue #385: hirePrice(preset) у попередженнях — пресети «легкий»/«складний»', () => {
  const withPreset = (preset: DifficultyPreset): Fixture => {
    const party = createParty(42, preset);
    const f = makeFixture({ getParty: () => party });
    return { ...f, party };
  };

  // Т.24, .mission-warn: ready = 3 = SQUAD_SPAWN.length, попередження iff money < hirePrice(preset)
  const missionWarn: { preset: DifficultyPreset; money: number; expected: string | null }[] = [
    { preset: 'легкий', money: 80, expected: '⚠ Останній загін, а на вербування бракує (80 з 120): загине — банкрутство.' },
    { preset: 'легкий', money: 95, expected: '⚠ Останній загін, а на вербування бракує (95 з 120): загине — банкрутство.' },
    { preset: 'легкий', money: 110, expected: '⚠ Останній загін, а на вербування бракує (110 з 120): загине — банкрутство.' },
    { preset: 'складний', money: 80, expected: '⚠ Останній загін, а на вербування бракує (80 з 90): загине — банкрутство.' },
    { preset: 'складний', money: 95, expected: null },
    { preset: 'складний', money: 110, expected: null },
  ];
  it.each(missionWarn)('Т.24: .mission-warn — пресет "$preset", грошей $money', ({ preset, money, expected }) => {
    const f = withPreset(preset);
    expect(tickUntil(f.party, () => missionTargets(f.party.geo).length > 0)).toBe(true);
    for (const s of f.party.roster.soldiers.slice(3)) f.party.roster.hospital[s.id] = 3; // ready = 3 = SQUAD_SPAWN.length
    f.party.econ.money = money;
    f.panels.renderProbes();
    const warn = document.querySelector('.probe .mission-warn');
    expect(warn?.textContent ?? null).toBe(expected);
  });

  // Т.26, #repair-warn: ready = 0, попередження iff money - 50 < hirePrice(preset)
  const repairWarn: { preset: DifficultyPreset; money: number; expected: string | null }[] = [
    {
      preset: 'легкий',
      money: 80,
      expected: '⚠ Ремонт не почався сам: боєготових немає, а після ремонту не лишиться на вербування (80 з 170).',
    },
    {
      preset: 'легкий',
      money: 95,
      expected: '⚠ Ремонт не почався сам: боєготових немає, а після ремонту не лишиться на вербування (95 з 170).',
    },
    {
      preset: 'легкий',
      money: 110,
      expected: '⚠ Ремонт не почався сам: боєготових немає, а після ремонту не лишиться на вербування (110 з 170).',
    },
    {
      preset: 'складний',
      money: 80,
      expected: '⚠ Ремонт не почався сам: боєготових немає, а після ремонту не лишиться на вербування (80 з 140).',
    },
    {
      preset: 'складний',
      money: 95,
      expected: '⚠ Ремонт не почався сам: боєготових немає, а після ремонту не лишиться на вербування (95 з 140).',
    },
    {
      preset: 'складний',
      money: 110,
      expected: '⚠ Ремонт не почався сам: боєготових немає, а після ремонту не лишиться на вербування (110 з 140).',
    },
  ];
  it.each(repairWarn)('Т.26: #repair-warn — пресет "$preset", грошей $money', ({ preset, money, expected }) => {
    const f = withPreset(preset);
    f.party.intercept.fighters[0].hp = 0;
    for (const s of f.party.roster.soldiers) f.party.roster.hospital[s.id] = 3; // ready = 0
    f.party.econ.money = money;
    f.panels.renderFighter();
    const warn = document.getElementById('repair-warn');
    expect(warn?.textContent ?? null).toBe(expected);
  });

  // порожній ростер: доступність вербування iff money >= hirePrice(party.campaign.preset)
  const roster: { preset: DifficultyPreset; money: number; expected: string }[] = [
    { preset: 'легкий', money: 80, expected: 'Кредитів на вербування немає.' },
    { preset: 'легкий', money: 95, expected: 'Кредитів на вербування немає.' },
    { preset: 'легкий', money: 110, expected: 'Кредитів на вербування немає.' },
    { preset: 'складний', money: 80, expected: 'Кредитів на вербування немає.' },
    { preset: 'складний', money: 95, expected: 'Вербування доступне — кнопка «Вербувати оперативника».' },
    { preset: 'складний', money: 110, expected: 'Вербування доступне — кнопка «Вербувати оперативника».' },
  ];
  it.each(roster)('порожній ростер — пресет "$preset", грошей $money', ({ preset, money, expected }) => {
    const f = withPreset(preset);
    f.party.roster.soldiers.length = 0;
    f.party.econ.money = money;
    f.panels.renderRoster();
    expect(document.getElementById('roster')!.textContent).toContain(expected);
  });
});

// п18.5 (ADR-0157; рішення власника «А. Кодом»): рамка радара 6, портал Брами, «Пробивний заряд» у ростері.
describe('п18.5: радар 6, Брама на геосцені, заряд у ростері', () => {
  function recordGeo(): string[] {
    const ops: string[] = [];
    const rec = new Proxy(
      {},
      {
        get: (_t, p) => (p === 'canvas' ? undefined : (...a: unknown[]) => void ops.push(String(p) + '(' + a.join(',') + ')')),
        set: () => true,
      }
    ) as unknown as CanvasRenderingContext2D;
    (document.getElementById('geo') as HTMLCanvasElement).getContext = (() => rec) as never;
    return ops;
  }

  it('рамка сенсорної сітки: 4 — як до п18.5; після «Пеленгу брами» — 6, по вертикалі в межах канви', () => {
    const f = makeFixture();
    let ops = recordGeo();
    f.panels.renderGeo();
    expect(ops).toContain('strokeRect(192,0,432,432)');
    f.party.research.completed.push('gate-bearing');
    ops = recordGeo();
    f.panels.renderGeo();
    expect(ops).toContain('strokeRect(96,0,624,432)');
    expect(vi.mocked(f.deps.ambient.paintGeo).mock.calls.at(-1)![1]).toMatchObject({ range: 6 });
  });

  it('Брама: після «Ключа брами» — портал у клітинці праворуч від вузла і пульс ambient; до нього — нічого', () => {
    const f = makeFixture();
    expect(gateCell(f.party)).toEqual({ x: 9, y: 4 });
    let ops = recordGeo();
    f.panels.renderGeo();
    expect(ops.some((o) => o.startsWith('ellipse(456,216'))).toBe(false);
    expect(vi.mocked(f.deps.ambient.paintGeo).mock.calls.at(-1)![1].gate).toBeUndefined();
    f.party.research.completed.push('rift-anatomy', 'gate-bearing', 'gate-key');
    ops = recordGeo();
    f.panels.renderGeo();
    expect(ops.some((o) => o.startsWith('ellipse(456,216'))).toBe(true);
    expect(vi.mocked(f.deps.ambient.paintGeo).mock.calls.at(-1)![1].gate).toEqual({ x: 9, y: 4 });
    // пауза після поразки фіналу: портал приглушений, пульсу немає
    f.party.campaign.gateReadyAt = f.party.geo.minute + 60;
    ops = recordGeo();
    f.panels.renderGeo();
    expect(ops.some((o) => o.startsWith('ellipse(456,216'))).toBe(true);
    expect(vi.mocked(f.deps.ambient.paintGeo).mock.calls.at(-1)![1].gate).toBeUndefined();
  });

  it('екран поразки: gameOver — так; у бою чи без партії на екрані — ні (аудит PR #516)', () => {
    let battle = false;
    let onScreen = true;
    const f = makeFixture({ isGameOver: () => true, inBattle: () => battle, partyOnScreen: () => onScreen });
    f.panels.renderCampaign();
    expect(document.getElementById('campaign-defeat')!.classList.contains('hidden')).toBe(false);
    battle = true;
    f.panels.renderCampaign();
    expect(document.getElementById('campaign-defeat')!.classList.contains('hidden')).toBe(true);
    battle = false;
    onScreen = false;
    f.panels.renderCampaign();
    expect(document.getElementById('campaign-defeat')!.classList.contains('hidden')).toBe(true);
  });

  it('ростер: кнопка «заряд» — видати зі складу і зняти назад', () => {
    const f = makeFixture();
    const s = f.party.roster.soldiers[0]!;
    f.party.workshop.store['breach-charge'] = 1;
    f.panels.renderRoster();
    const b = document.getElementById('btn-equip-' + s.id + '-charge') as HTMLButtonElement;
    expect(b.textContent).toBe('заряд');
    expect(b.title).toBe('Спорядити «Пробивний заряд» зі складу — Атака по броньованій цілі — без броні (один раз)');
    expect(readyToIssue(f.party)).toBeGreaterThan(0);
    b.click();
    expect(f.party.workshop.equipped[s.id]?.charge).toBe(true);
    expect(f.party.workshop.store['breach-charge']).toBe(0);
    f.panels.renderRoster();
    const on = document.getElementById('btn-equip-' + s.id + '-charge') as HTMLButtonElement;
    expect(on.textContent).toBe('заряд ✓');
    on.click();
    expect(f.party.workshop.equipped[s.id]?.charge).toBeUndefined();
    expect(f.party.workshop.store['breach-charge']).toBe(1);
  });
});
