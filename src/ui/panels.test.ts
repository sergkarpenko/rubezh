// @vitest-environment jsdom
// пR.2: юніт-тести панелей стану і топбара (src/ui/panels.ts, ADR-0037).
// hpColor перенесено з main.test.ts без ослаблення тверджень; тут же —
// гілки рендерів (геосцена, сканери, винищувач, фінанси, ростер, кампанія).
// DOM-флоу застосунку лишається у main.ui.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { advanceTime, detectedUfos, geoClock, missionTargets } from '../core/geo';
import { FIGHTER_MAX_HP, FIGHTER_REPAIR_COST, startIntercept } from '../core/intercept';
import { hirePrice } from '../core/economy';
import type { DifficultyPreset } from '../core/campaign';
import { createParty, type Party } from '../core/save';
import { ARMOR_MAX_HP_BONUS, OPTICS_ACCURACY_BONUS } from '../core/workshop';
import { GRENADE_DAMAGE, GRENADE_RANGE, HEAL_AMOUNT, HIT_CHANCE_CAP } from '../core/combat';
import { initPixelSprites } from '../render';
import { createPanels, hpColor, inAirCombat, readyToIssue, type PanelsDeps } from './panels';

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
    <span id="campaign-status">—</span>
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
      <span><b id="ictx-ufo">—</b></span>
    </div>
    <div id="ufos"></div>
    <div id="fighter"></div>
    <span id="money-card">—</span>
    <div id="roster"></div>
    <section id="campaign-victory" class="hidden"><span id="campaign-score">—</span></section>`;
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
    const fighter = f.party.intercept.fighter;
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

describe('renderUfos: сканери НЛО', () => {
  it('нічого не виявлено — підказка рухати час', () => {
    const f = makeFixture();
    f.panels.renderUfos();
    expect(document.getElementById('ufos')!.textContent).toContain('Нічого не виявлено');
  });

  it('виявлений НЛО у повітрі — кнопка перехоплення; клік стартує погоню (ядро) і renderAll', () => {
    const f = makeFixture();
    expect(tickUntil(f.party, () => detectedUfos(f.party.geo).some((u) => u.status === 'летить'))).toBe(true);
    f.panels.renderUfos();
    const ib = document.querySelector('button.intercept') as HTMLButtonElement;
    expect(ib).not.toBeNull();
    ib.click();
    expect(f.party.intercept.fighter.status).toBe('погоня');
    expect(f.deps.renderAll).toHaveBeenCalled();
  });

  it('пошкоджений винищувач — перехоплення недоступне (підказка про ремонт)', () => {
    const f = makeFixture();
    expect(tickUntil(f.party, () => detectedUfos(f.party.geo).some((u) => u.status === 'летить'))).toBe(true);
    f.party.intercept.fighter.hp = 2;
    f.panels.renderUfos();
    const ib = document.querySelector('button.intercept') as HTMLButtonElement;
    expect(ib.disabled).toBe(true);
    expect(ib.title).toContain('пошкоджений');
  });

  it('приземлений НЛО — кнопка місії; без боєготових — вимкнена з причиною', () => {
    const f = makeFixture();
    expect(tickUntil(f.party, () => missionTargets(f.party.geo).length > 0)).toBe(true);
    f.panels.renderUfos();
    const btn = document.querySelector('button.mission') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.disabled).toBe(false);
    for (const s of f.party.roster.soldiers) f.party.roster.hospital[s.id] = 3; // усі в лікарні — нікого в бій
    f.panels.renderUfos();
    const btn2 = document.querySelector('button.mission') as HTMLButtonElement;
    expect(btn2.disabled).toBe(true);
    expect(btn2.title).toContain('Усі оперативники поранені');
    btn2.onclick = null;
  });

  it('Т.24: останній загін без грошей на вербування — рядок-попередження, кнопка активна', () => {
    const f = makeFixture();
    expect(tickUntil(f.party, () => missionTargets(f.party.geo).length > 0)).toBe(true);
    f.panels.renderUfos();
    expect(document.querySelector('.mission-warn')).toBeNull(); // старт: 300 кредитів — запас є
    f.party.econ.money = 99; // «норма»: вербування 100
    f.panels.renderUfos();
    expect(f.party.roster.soldiers.length).toBeGreaterThan(3);
    expect(document.querySelector('.mission-warn')).toBeNull(); // боєготових більше за загін (3) — резерв є
    for (const s of f.party.roster.soldiers.slice(3)) f.party.roster.hospital[s.id] = 3; // боєготових троє — увесь загін іде в бій
    f.panels.renderUfos();
    const warn = document.querySelector('.ufo .mission-warn');
    expect(warn!.textContent).toBe('⚠ Останній загін, а на вербування бракує (99 з 100): загине — банкрутство.');
    const btn = document.querySelector('button.mission') as HTMLButtonElement;
    expect(btn.disabled).toBe(false); // запуск лишається в один клік
    btn.click();
    expect(f.deps.launchMission).toHaveBeenCalledTimes(1);
    f.party.econ.money = 100; // на вербування вистачає — без попередження
    f.panels.renderUfos();
    expect(document.querySelector('.mission-warn')).toBeNull();
    f.party.econ.money = 0;
    for (const s of f.party.roster.soldiers) f.party.roster.hospital[s.id] = 3; // кнопка вимкнена — рядка нема
    f.panels.renderUfos();
    expect(document.querySelector('.mission-warn')).toBeNull();
  });

  it('кнопка місії веде до launchMission (застосунок)', () => {
    const f = makeFixture();
    expect(tickUntil(f.party, () => missionTargets(f.party.geo).length > 0)).toBe(true);
    f.panels.renderUfos();
    (document.querySelector('button.mission') as HTMLButtonElement).click();
    expect(f.deps.launchMission).toHaveBeenCalledWith(f.party.geo.ufos.find((u) => u.id !== undefined)!.id);
  });
});

describe('Т.7: nodeActions — дії, що чекають на вкладці «Вузол» (сигнал вкладки)', () => {
  it('нічого не виявлено — 0; зонд у повітрі і перехоплювач на базі — 1; погоня — 0', () => {
    const f = makeFixture();
    expect(f.panels.nodeActions()).toBe(0);
    expect(tickUntil(f.party, () => detectedUfos(f.party.geo).some((u) => u.status === 'летить'))).toBe(true);
    const flying = detectedUfos(f.party.geo).filter((u) => u.status === 'летить');
    expect(f.panels.nodeActions()).toBe(flying.length + missionTargets(f.party.geo).length);
    expect(f.panels.nodeActions()).toBeGreaterThan(0);
    startIntercept(f.party.intercept, f.party.geo, flying[0]!.id);
    expect(f.panels.nodeActions()).toBe(missionTargets(f.party.geo).length); // перехоплювач у погоні — кнопки «Перехопити» нема
  });

  it('приземлений зонд — місія рахується; повітряний бій — +1 (рішення про дистанцію)', () => {
    const f = makeFixture();
    expect(tickUntil(f.party, () => missionTargets(f.party.geo).length > 0)).toBe(true);
    const base = f.panels.nodeActions();
    expect(base).toBeGreaterThanOrEqual(missionTargets(f.party.geo).length);
    f.party.intercept.fighter.status = 'бій';
    const flying = detectedUfos(f.party.geo).filter((u) => u.status === 'летить').length;
    expect(f.panels.nodeActions()).toBe(base - flying + 1);
  });

  it('у тактичному бою і після банкрутства — 0 (колонка неактивна)', () => {
    for (const over of [{ inBattle: () => true }, { isGameOver: () => true }]) {
      const f = makeFixture(over);
      expect(tickUntil(f.party, () => missionTargets(f.party.geo).length > 0)).toBe(true);
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
    expect(tickUntil(f.party, () => detectedUfos(f.party.geo).some((u) => u.status === 'летить'))).toBe(true);
    const ufo = detectedUfos(f.party.geo).find((u) => u.status === 'летить')!;
    startIntercept(f.party.intercept, f.party.geo, ufo.id);
    f.panels.renderInterceptCtx();
    expect(document.getElementById('ictx')!.classList.contains('hidden')).toBe(false);
    expect(document.getElementById('ictx-target')!.textContent).toBe(ufo.id);
    expect(document.getElementById('ictx-round')!.textContent).toBe('—');
    // штучний стан «бій» (гілка раунду і HP) — відображення, ядро не викликаємо
    f.party.intercept.fighter.status = 'бій';
    f.party.intercept.activeUfoId = ufo.id;
    f.party.intercept.round = 3;
    f.party.intercept.ufoHp[ufo.id] = 5;
    f.panels.renderInterceptCtx();
    expect(document.getElementById('ictx-round')!.textContent).toBe('3');
    expect(document.getElementById('ictx-fighter')!.textContent).toBe('HP ' + FIGHTER_MAX_HP + '/' + FIGHTER_MAX_HP);
    expect(document.getElementById('ictx-ufo')!.textContent).toBe('HP 5');
  });
});

describe('renderFighter: панель винищувача (П7.4)', () => {
  it('боєготовий на базі — статус і повний HP', () => {
    const f = makeFixture();
    f.panels.renderFighter();
    expect(document.getElementById('fighter')!.textContent).toContain('боєготовий');
    expect(document.getElementById('fighter')!.textContent).toContain('HP');
    expect(document.getElementById('btn-repair')).toBeNull();
  });

  it('пошкоджений на базі — кнопка ремонту; клік стартує ремонт (ядро) і renderAll', () => {
    const f = makeFixture();
    f.party.intercept.fighter.hp = 3;
    f.panels.renderFighter();
    const b = document.getElementById('btn-repair') as HTMLButtonElement;
    expect(b).not.toBeNull();
    expect(b.disabled).toBe(false);
    b.click();
    expect(f.party.intercept.fighter.status).toBe('ремонт');
    expect(f.deps.renderAll).toHaveBeenCalled();
  });

  it('Т.26: боєготових немає, після ремонту бракує на вербування — рядок-попередження, кнопка активна', () => {
    const f = makeFixture();
    f.party.intercept.fighter.hp = 0;
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
    expect(f.party.intercept.fighter.status).toBe('ремонт');
    f.panels.renderFighter();
    expect(document.getElementById('repair-warn')).toBeNull();
  });

  it('ремонт — статус з тіками, кнопки дій нема', () => {
    const f = makeFixture();
    f.party.intercept.fighter.status = 'ремонт';
    f.party.intercept.fighter.repairTicksLeft = 2;
    f.panels.renderFighter();
    expect(document.getElementById('fighter')!.textContent).toContain('ремонт: 2 тіки');
    expect(document.getElementById('fighter')!.querySelectorAll('button').length).toBe(0);
  });

  it('стан «бій» — рядок дистанцій (вимкнений у тактичній місії), клік рішення — ядро', () => {
    const f = makeFixture({ inBattle: () => true });
    expect(tickUntil(f.party, () => detectedUfos(f.party.geo).length > 0)).toBe(true);
    const ufo = detectedUfos(f.party.geo)[0]!;
    f.party.intercept.fighter.status = 'бій';
    f.party.intercept.activeUfoId = ufo.id;
    f.party.intercept.ufoHp[ufo.id] = 7;
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
    expect(document.getElementById('campaign-status')!.textContent).toBe('кампанія: триває');
    expect(document.getElementById('campaign-progress')!.textContent).toBe('Д1/30');
    expect(document.getElementById('campaign-progress')!.classList.contains('hidden')).toBe(true);
    expect(document.getElementById('campaign-victory')!.classList.contains('hidden')).toBe(true);
  });

  it('перемога — екран з підсумковим рахунком', () => {
    const f = makeFixture();
    f.party.campaign.status = 'перемога';
    f.party.campaign.score = { ufosShotDown: 0, missionsWon: 0, veteransAlive: 0, moneyLeft: 0, total: 1234 };
    f.panels.renderCampaign();
    expect(document.getElementById('campaign-victory')!.classList.contains('hidden')).toBe(false);
    expect(document.getElementById('campaign-score')!.textContent).toBe('1234');
  });

  // П8.3a: endless (рішення власника 2026-10-15) — «Грати далі» ховає екран
  it('перемога + «Грати далі» (endless) — екран приховано, рахунок лишився', () => {
    const f = makeFixture({ victoryDismissed: () => true });
    f.party.campaign.status = 'перемога';
    f.party.campaign.score = { ufosShotDown: 0, missionsWon: 0, veteransAlive: 0, moneyLeft: 0, total: 1234 };
    f.panels.renderCampaign();
    expect(document.getElementById('campaign-status')!.textContent).toBe('кампанія: перемога');
    expect(document.getElementById('campaign-victory')!.classList.contains('hidden')).toBe(true);
    expect(document.getElementById('campaign-score')!.textContent).toBe('1234');
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
    const mission = (): HTMLButtonElement => document.querySelector('#ufos button.mission') as HTMLButtonElement;
    f.panels.renderUfos();
    expect(mission().disabled).toBe(false);
    expect(why(mission())).toBeNull();
    woundAll(f.party);
    f.panels.renderUfos();
    expect(mission().disabled).toBe(true);
    expect(why(mission())).toBe('Усі оперативники поранені — чекайте одужання або вербуйте');
    expect(why(mission())).toBe(mission().title);
    const battle = easy({ inBattle: () => true });
    tickUntil(battle.party, () => missionTargets(battle.party.geo).length > 0);
    battle.panels.renderUfos();
    expect(mission().disabled).toBe(true);
    expect(why(mission())).toBeNull();
  });

  it('«Перехопити»: пошкоджений перехоплювач — рядок = title; справний — рядка немає', () => {
    const f = easy();
    expect(tickUntil(f.party, () => detectedUfos(f.party.geo).some((u) => u.status === 'летить'))).toBe(true);
    const ib = (): HTMLButtonElement => document.querySelector('#ufos button.intercept') as HTMLButtonElement;
    f.panels.renderUfos();
    expect(ib().title).toBe('Підняти перехоплювач на перехоплення');
    expect(why(ib())).toBeNull();
    f.party.intercept.fighter.hp = 1;
    f.panels.renderUfos();
    expect(ib().disabled).toBe(true);
    expect(why(ib())).toBe('Перехоплювач пошкоджений — спочатку ремонт');
    expect(why(ib())).toBe(ib().title);
  });

  it('«Ремонт»: без кредитів — рядок = title; з кредитами — рядка немає', () => {
    const f = easy();
    const rb = (): HTMLButtonElement => document.getElementById('btn-repair') as HTMLButtonElement;
    f.party.intercept.fighter.hp = 1;
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
    over.panels.renderUfos();
    const mission = document.querySelector('#ufos button.mission') as HTMLButtonElement;
    expect(mission.disabled).toBe(true);
    expect(why(mission)).toBe('Партію програно — банкрутство');
    const battle = easy({ inBattle: () => true });
    expect(tickUntil(battle.party, () => detectedUfos(battle.party.geo).some((u) => u.status === 'летить'))).toBe(true);
    battle.panels.renderUfos();
    const ib = document.querySelector('#ufos button.intercept') as HTMLButtonElement;
    expect(ib.disabled).toBe(true);
    expect(why(ib)).toBeNull();
  });

  it('#fighter-last: текст журналу після перерваного перехоплення; зникає після нового старту і після розриву контакту', () => {
    const f = easy();
    const last = (): string | null => document.getElementById('fighter-last')?.textContent ?? null;
    // Т.51: зонди подій мають бути в geo.ufos, інакше рядок не показується (перевірка за id зонда)
    expect(tickUntil(f.party, () => f.party.geo.ufos.length > 0)).toBe(true);
    f.party.geo.ufos.push({ ...f.party.geo.ufos[0], id: 'ufo2' }, { ...f.party.geo.ufos[0], id: 'ufo4' });
    f.panels.renderFighter();
    expect(last()).toBeNull();
    const pos = { x: 1, y: 1 };
    f.party.geo.log.push({ type: 'intercept_start', ufoId: 'ufo2', pos, minute: 0 });
    f.party.geo.log.push({ type: 'intercept_aborted', ufoId: 'ufo2', reason: 'ufo_lost', pos, minute: 30 });
    f.party.geo.log.push({ type: 'fighter_returned', pos, minute: 60 });
    f.panels.renderFighter();
    expect(last()).toBe('✦ Зонд Розриву ufo2 зник з трекінгу — перехоплення перервано');
    f.party.geo.log.push({ type: 'intercept_start', ufoId: 'ufo3', pos, minute: 90 });
    f.panels.renderFighter();
    expect(last()).toBeNull();
    f.party.geo.log.push({ type: 'intercept_aborted', ufoId: 'ufo3', reason: 'fighter_damaged', pos, minute: 120 });
    f.party.intercept.fighter.hp = 1;
    f.panels.renderFighter();
    expect(last()).toBe('✦ Перехоплювач пошкоджений — вимушене переривання бою');
    f.party.intercept.fighter.hp = FIGHTER_MAX_HP; // пошкодження вже відремонтовано — рядок застарів
    f.panels.renderFighter();
    expect(last()).toBeNull();
    f.party.intercept.fighter.hp = 1;
    f.party.geo.log.push({ type: 'intercept_break_off', ufoId: 'ufo3', minute: 150 });
    f.panels.renderFighter();
    expect(last()).toBeNull();
    // Т.49: зонд приземлився під час погоні — власний текст журналу, без «зник з трекінгу»
    f.party.geo.log.push({ type: 'intercept_start', ufoId: 'ufo4', pos, minute: 180 });
    f.panels.renderFighter();
    expect(last()).toBeNull();
    f.party.geo.log.push({ type: 'intercept_aborted', ufoId: 'ufo4', reason: 'ufo_landed', pos, minute: 210 });
    f.panels.renderFighter();
    expect(last()).toBe('✦ Зонд Розриву ufo4 приземлився — перехоплення перервано');
  });
});

// Т.51: рядок #fighter-last не показується, якщо зонд події вже не в geo.ufos (виліт ufo_left / місія).
describe('Т.51: #fighter-last при відсутньому зонді події в geo.ufos', () => {
  const pos = { x: 1, y: 1 };
  const last = (): string | null => document.getElementById('fighter-last')?.textContent ?? null;
  // об'єкт зонда — копія створеної ядром, зі зміненим id
  const addProbe = (f: Fixture, id: string): void => {
    expect(tickUntil(f.party, () => f.party.geo.ufos.length > 0)).toBe(true);
    f.party.geo.ufos = [{ ...f.party.geo.ufos[0], id }]; // копія створеного ядром зонда зі зміненим id
  };
  const dropProbe = (f: Fixture, id: string): void => {
    f.party.geo.ufos = f.party.geo.ufos.filter((u) => u.id !== id);
  };

  it('Т.51.1: ufo_landed, зонд є в geo.ufos — рядок показується', () => {
    const f = makeFixture();
    addProbe(f, 'ufo5');
    f.party.geo.log.push({ type: 'intercept_aborted', ufoId: 'ufo5', reason: 'ufo_landed', pos, minute: 10 });
    f.panels.renderFighter();
    expect(last()).toBe('✦ Зонд Розриву ufo5 приземлився — перехоплення перервано');
  });

  it('Т.51.2: ufo_landed, зонд прибрано з geo.ufos — після renderFighter рядка немає', () => {
    const f = makeFixture();
    addProbe(f, 'ufo5');
    f.party.geo.log.push({ type: 'intercept_aborted', ufoId: 'ufo5', reason: 'ufo_landed', pos, minute: 10 });
    dropProbe(f, 'ufo5');
    f.panels.renderFighter();
    expect(last()).toBeNull();
  });

  it('Т.51.3: ufo_lost — зонд є: рядок; зонда немає: рядка немає', () => {
    const f = makeFixture();
    addProbe(f, 'ufo6');
    f.party.geo.log.push({ type: 'intercept_aborted', ufoId: 'ufo6', reason: 'ufo_lost', pos, minute: 20 });
    f.panels.renderFighter();
    expect(last()).toBe('✦ Зонд Розриву ufo6 зник з трекінгу — перехоплення перервано');
    dropProbe(f, 'ufo6');
    f.panels.renderFighter();
    expect(last()).toBeNull();
  });

  it('Т.51.4: fighter_damaged при HP < FIGHTER_MAX_HP і відсутньому зонді — рядок є', () => {
    const f = makeFixture();
    f.party.intercept.fighter.hp = 1;
    f.party.geo.log.push({ type: 'intercept_aborted', ufoId: 'ufo7', reason: 'fighter_damaged', pos, minute: 30 });
    f.panels.renderFighter();
    expect(last()).toBe('✦ Перехоплювач пошкоджений — вимушене переривання бою');
  });

  it('Т.51.5: у geo.ufos є лише інший зонд (інший id) — рядка немає (перевірка за id, а не за наявністю будь-якого зонда)', () => {
    const f = makeFixture();
    addProbe(f, 'ufo9');
    f.party.geo.log.push({ type: 'intercept_aborted', ufoId: 'ufo5', reason: 'ufo_landed', pos, minute: 40 });
    f.panels.renderFighter();
    expect(last()).toBeNull();
  });
});

// issue #385 (кандидат 16): три структурні рядки-попередження в panels.ts мають показувати
// hirePrice(preset) пресету партії, а не hirePrice() «норми» (100). Параметричні тести для
// пресетів «легкий» (120) і «складний» (90); грошей — 90 і 120, щоб відповіді на цих пресетах
// різнилися між собою і не збігалися з «нормою».
describe('issue #385: hirePrice(preset) у попередженнях — пресети «легкий»/«складний»', () => {
  const withPreset = (preset: DifficultyPreset, over: Partial<PanelsDeps> = {}): Fixture => {
    const party = createParty(42, preset);
    const f = makeFixture({ getParty: () => party, ...over });
    return { ...f, party };
  };
  const presets: DifficultyPreset[] = ['легкий', 'складний'];

  it.each(presets)('Т.24: .mission-warn — ціна найму пресету %s (грошей 90 і 120)', (preset) => {
    const f = withPreset(preset);
    expect(tickUntil(f.party, () => missionTargets(f.party.geo).length > 0)).toBe(true);
    for (const s of f.party.roster.soldiers.slice(3)) f.party.roster.hospital[s.id] = 3; // ready = 3 = SQUAD_SPAWN.length
    for (const money of [90, 120]) {
      f.party.econ.money = money;
      f.panels.renderUfos();
      const warn = document.querySelector('.ufo .mission-warn');
      if (money < hirePrice(preset)) {
        expect(warn!.textContent).toBe(
          '⚠ Останній загін, а на вербування бракує (' + money + ' з ' + hirePrice(preset) + '): загине — банкрутство.'
        );
      } else {
        expect(warn).toBeNull();
      }
    }
  });

  it.each(presets)('Т.26: #repair-warn — repair + hirePrice(preset) для пресету %s (грошей 90 і 120)', (preset) => {
    const f = withPreset(preset);
    f.party.intercept.fighter.hp = 0;
    for (const s of f.party.roster.soldiers) f.party.roster.hospital[s.id] = 3; // ready = 0
    for (const money of [90, 120]) {
      f.party.econ.money = money;
      f.panels.renderFighter();
      const warn = document.getElementById('repair-warn');
      if (money - FIGHTER_REPAIR_COST < hirePrice(preset)) {
        expect(warn!.textContent).toBe(
          '⚠ Ремонт не почався сам: боєготових немає, а після ремонту не лишиться на вербування (' +
            money +
            ' з ' +
            (FIGHTER_REPAIR_COST + hirePrice(preset)) +
            ').'
        );
      } else {
        expect(warn).toBeNull();
      }
    }
  });

  it.each(presets)('порожній ростер: hirePrice(party.campaign.preset) для пресету %s (грошей 90 і 120)', (preset) => {
    const f = withPreset(preset);
    f.party.roster.soldiers.length = 0;
    for (const money of [90, 120]) {
      f.party.econ.money = money;
      f.panels.renderRoster();
      const box = document.getElementById('roster')!;
      if (money >= hirePrice(preset)) expect(box.textContent).toContain('Вербування доступне');
      else expect(box.textContent).toContain('Кредитів на вербування немає.');
    }
  });
});
