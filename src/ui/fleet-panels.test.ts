// @vitest-environment jsdom
// п19.4 (ADR-0159 п. 15; аудит PR #522): панелі середньої колонки з кількома перехоплювачами —
// картки «Перехоплювачі» (погоня, дистанції бою у того, хто в бою, ремонт і модуль за id,
// «Призначити»), «Перехопити» в «Сенсорній сітці» найближчим, контекст-стрічка, «Регіони»
// і шар мапи, рядок купівлі в «Кузні», порада «Наступний крок». Один перехоплювач — як до п19.4.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { advanceTime, detectedProbes, type Probe } from '../core/geo';
import { FIGHTER_MAX_HP, addFighter, fighterInBattle, startIntercept } from '../core/intercept';
import { REGION_IDS, REGION_OF, type RegionId } from '../core/regions';
import { createParty, type Party } from '../core/save';
import { INTERCEPTOR_COST } from '../core/workshop';
import { initPixelSprites } from '../render';
import { activeFighter, createPanels, fighterBtnId, gunModuleReady, nearestReady, type PanelsDeps } from './panels';
import { drawRegionsLayer, fightersIn, regionRect, regionShare, renderRegions, trustColor } from './regions-panel';
import { createWorkshopPanel } from './workshop-panel';
import { NEXT_STEP, nextStep } from './next-step';

const ops: string[] = [];
const recCtx = new Proxy(
  {},
  {
    get: (_t, p) => {
      if (p === 'canvas') return undefined;
      return (...args: unknown[]) => {
        ops.push(String(p) + '(' + args.map((a) => String(a)).join(',') + ')');
        return undefined;
      };
    },
    set: (_t, p, v) => {
      ops.push(String(p) + '=' + String(v));
      return true;
    },
  }
) as unknown as CanvasRenderingContext2D;

function setupDom(): void {
  document.body.innerHTML = `
    <span id="clock">—</span><span id="threat">—</span><div id="campaign-goal"></div><span id="campaign-progress">—</span>
    <span id="money">—</span><span id="ready">—</span>
    <button id="btn-tick"></button><button id="btn-day"></button><button id="btn-event"></button>
    <span id="econ-rates"></span><button id="btn-hire"></button>
    <section id="geo-panel"><canvas id="geo" width="768" height="432"></canvas></section>
    <div id="ictx" class="hidden"><b id="ictx-target"></b><b id="ictx-status"></b><b id="ictx-round"></b><b id="ictx-fighter"></b><b id="ictx-probe"></b></div>
    <div id="probes"></div><div id="fighter"></div><div id="regions"></div><div id="workshop"></div>
    <span id="money-card">—</span><div id="roster"></div>
    <section id="campaign-victory" class="hidden"><p id="campaign-victory-text"></p><span id="campaign-score"></span><div id="campaign-score-lines"></div></section>
    <section id="campaign-defeat" class="hidden"><p id="campaign-defeat-text"></p><span id="campaign-defeat-score"></span><div id="campaign-defeat-lines"></div></section>`;
  (HTMLCanvasElement.prototype as unknown as { getContext: () => CanvasRenderingContext2D }).getContext = () => recCtx;
}

function makeFixture(party: Party, over: Partial<PanelsDeps> = {}) {
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
    ambient: { paintGeo: vi.fn() },
    ...over,
  };
  return { deps, panels: createPanels(deps) };
}

// сід 42: тіки до першого виявленого зонда в повітрі
function flyingParty(): { party: Party; probe: Probe } {
  const party = createParty(42);
  for (let i = 0; i < 3000 && !detectedProbes(party.geo).some((u) => u.status === 'летить'); i++) advanceTime(party.geo, 1);
  const probe = detectedProbes(party.geo).find((u) => u.status === 'летить')!;
  expect(probe).toBeDefined();
  return { party, probe };
}

const btn = (id: string): HTMLButtonElement => {
  const b = document.getElementById(id);
  if (!(b instanceof HTMLButtonElement)) throw new Error('немає кнопки ' + id);
  return b;
};

beforeEach(() => {
  ops.length = 0;
  setupDom();
  initPixelSprites((w, h) => ({ width: w, height: h, getContext: () => recCtx }));
});

describe('п19.4: «Перехоплювачі» — картки', () => {
  it('один перехоплювач: картка без номера, ангар «Шпилі», id кнопок без суфікса', () => {
    const { party, probe } = flyingParty();
    const f = makeFixture(party);
    f.panels.renderFighter();
    const cards = document.querySelectorAll('#fighter .fighter-card');
    expect(cards).toHaveLength(1);
    expect(cards[0]!.querySelector('.fc-title')!.textContent).toBe('ангар «Шпилі»');
    expect($text()).toContain('Статус: боєготовий');
    expect(btn('btn-chase-1-' + probe.id).textContent).toBe('✦ Погоня: ' + probe.kind + ' №' + probe.id.replace('probe', ''));
    expect(btn('btn-assign-1').getAttribute('aria-expanded')).toBe('false');
    expect(fighterBtnId('btn-repair', { id: 1 })).toBe('btn-repair');
    expect(fighterBtnId('btn-repair', { id: 3 })).toBe('btn-repair-3');
  });

  it('два: номер і ангар у заголовку; «Погоня» другим — startIntercept з його id, у першого кнопки на цей зонд більше нема', () => {
    const { party, probe } = flyingParty();
    addFighter(party.intercept, party.geo, 'east');
    const f = makeFixture(party);
    f.panels.renderFighter();
    const titles = [...document.querySelectorAll('#fighter .fc-title')].map((e) => e.textContent);
    expect(titles).toEqual(['Перехоплювач 1 · ангар «Шпилі»', 'Перехоплювач 2 · ангар «Промзона»']);
    btn('btn-chase-2-' + probe.id).click();
    expect(party.intercept.fighters[1]!.status).toBe('погоня');
    expect(party.intercept.fighters[1]!.targetId).toBe(probe.id);
    expect(party.intercept.fighters[0]!.status).toBe('на базі');
    expect(f.deps.renderAll).toHaveBeenCalled();
    f.panels.renderFighter();
    expect(document.getElementById('btn-chase-1-' + probe.id)).toBeNull(); // на зонд — один
    expect($text()).toContain('погоня: №' + probe.id.replace('probe', ''));
  });

  it('бій другого: дистанції — у його картці, контекст-стрічка показує його номер; раунд іде', () => {
    const { party, probe } = flyingParty();
    addFighter(party.intercept, party.geo, 'east');
    startIntercept(party.intercept, party.geo, probe.id, 2);
    // зближення погонею залежить від траєкторії (сід 42: зонд сідає раніше) — стан бою ставимо так, як його ставить chaseTick
    const two = party.intercept.fighters[1]!;
    two.status = 'бій';
    two.pos = { ...probe.pos };
    party.intercept.activeProbeId = probe.id;
    party.intercept.round = 0;
    const fighter = fighterInBattle(party.intercept);
    expect(fighter?.id).toBe(2);
    const f = makeFixture(party);
    f.panels.renderFighter();
    expect(document.querySelectorAll('#fighter-card-1 button.intercept-range')).toHaveLength(0);
    const ranges = document.querySelectorAll<HTMLButtonElement>('#fighter-card-2 button.intercept-range');
    expect([...ranges].map((b) => b.dataset.choice)).toEqual(['далека', 'середня', 'впритул', 'відступ']);
    expect(activeFighter(party)?.id).toBe(2);
    expect(document.getElementById('ictx')!.classList.contains('hidden')).toBe(false);
    expect(document.getElementById('ictx-fighter')!.textContent).toBe('2 · HP ' + FIGHTER_MAX_HP + '/' + FIGHTER_MAX_HP);
    expect(document.getElementById('ictx-status')!.textContent).toBe('бій');
    const before = party.intercept.log.length;
    ranges[3]!.click(); // відступ
    expect(party.intercept.log.length).toBeGreaterThan(before);
    expect(fighterInBattle(party.intercept)).toBeNull(); // бій другого не зависає
  });

  it('ремонт і модуль — на картці свого перехоплювача, з суфіксом id', () => {
    const party = createParty(42);
    addFighter(party.intercept, party.geo, 'south');
    party.intercept.fighters[1]!.hp = 2;
    party.intercept.fighters[0]!.gunModule = true;
    party.workshop.store['gun-module'] = 1;
    const f = makeFixture(party);
    f.panels.renderFighter();
    expect(document.getElementById('btn-repair')).toBeNull();
    const money = party.econ.money;
    btn('btn-repair-2').click();
    expect(party.intercept.fighters[1]!.status).toBe('ремонт');
    expect(party.econ.money).toBeLessThan(money);
    expect(document.getElementById('btn-gun-remove')).not.toBeNull(); // у першого — «Зняти»
    expect(gunModuleReady(party)).toBe(false); // другий у ремонті — не на базі
    party.intercept.fighters[1]!.status = 'на базі';
    expect(gunModuleReady(party)).toBe(true);
    f.panels.renderFighter();
    btn('btn-gun-install-2').click();
    expect(party.intercept.fighters[1]!.gunModule).toBe(true);
    expect(party.workshop.store['gun-module']).toBe(0);
  });

  it('«Призначити»: клік розгортає три інші регіони, клік по регіону — перебазування і згортання', () => {
    const party = createParty(42);
    addFighter(party.intercept, party.geo, 'east');
    party.campaign.regions.west.out = true;
    party.campaign.regions.west.trust = 0;
    const f = makeFixture(party);
    f.panels.renderFighter();
    btn('btn-assign-2').click();
    f.panels.renderFighter();
    expect(btn('btn-assign-2').getAttribute('aria-expanded')).toBe('true');
    const opts = [...document.querySelectorAll('#fighter-card-2 .assign-row button')].map((b) => b.textContent);
    expect(opts).toEqual(['→ Порт (район вийшов)', '→ Шпилі', '→ Нетрі']);
    btn('btn-assign-2-south').click();
    expect(party.intercept.fighters[1]!.region).toBe('south');
    f.panels.renderFighter();
    expect(document.querySelector('#fighter-card-2 .assign-row')).toBeNull();
    expect(document.querySelector('#fighter-card-2 .fc-title')!.textContent).toBe('Перехоплювач 2 · ангар «Нетрі»');
  });

  it('у погоні «Призначити» немає; у тактичному бою кнопки вимкнені', () => {
    const { party, probe } = flyingParty();
    addFighter(party.intercept, party.geo, 'east');
    startIntercept(party.intercept, party.geo, probe.id, 1);
    makeFixture(party).panels.renderFighter();
    expect(document.getElementById('btn-assign-1')).toBeNull();
    expect(btn('btn-assign-2').disabled).toBe(false);
    setupDom();
    makeFixture(party, { inBattle: () => true }).panels.renderFighter();
    expect(btn('btn-assign-2').disabled).toBe(true);
  });
});

describe('аудит PR #523: стан панелі і прокрутка до бою', () => {
  it('розгорнутий «Призначити» скидається з новою партією і після вильоту', () => {
    const { party, probe } = flyingParty();
    const f = makeFixture(party);
    f.panels.renderFighter();
    btn('btn-assign-1').click();
    f.panels.renderFighter();
    expect(document.querySelector('#fighter-card-1 .assign-row')).not.toBeNull();
    startIntercept(party.intercept, party.geo, probe.id);
    f.panels.renderFighter();
    party.intercept.fighters[0]!.status = 'на базі'; // повернувся — ряд не розгортається сам
    f.panels.renderFighter();
    expect(document.querySelector('#fighter-card-1 .assign-row')).toBeNull();
    btn('btn-assign-1').click();
    let current = party;
    const g = makeFixture(party, { getParty: () => current });
    g.panels.renderFighter();
    btn('btn-assign-1').click();
    g.panels.renderFighter();
    expect(document.querySelector('#fighter-card-1 .assign-row')).not.toBeNull();
    current = createParty(7); // нова партія — той самий id перехоплювача
    g.panels.renderFighter();
    expect(document.querySelector('#fighter-card-1 .assign-row')).toBeNull();
  });

  it("початок повітряного бою — картка того, хто б'ється, прокручується у видиму частину (раз на бій)", () => {
    const { party, probe } = flyingParty();
    addFighter(party.intercept, party.geo, 'east');
    const spy = vi.fn();
    (HTMLElement.prototype as unknown as { scrollIntoView: unknown }).scrollIntoView = spy;
    const f = makeFixture(party);
    f.panels.renderFighter();
    expect(spy).not.toHaveBeenCalled();
    startIntercept(party.intercept, party.geo, probe.id, 2);
    party.intercept.fighters[1]!.status = 'бій';
    party.intercept.activeProbeId = probe.id;
    f.panels.renderFighter();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.contexts[0]).toBe(document.getElementById('fighter-card-2'));
    f.panels.renderFighter(); // наступні раунди — без прокрутки
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('аудит PR #524: зонд, що сів на клітинку ангара, малюється поверх ангара', () => {
    const { party, probe } = flyingParty();
    addFighter(party.intercept, party.geo, 'south');
    probe.pos = { x: 8, y: 7 }; // клітинка ангара «Нетрі»
    probe.status = 'приземлився';
    const f = makeFixture(party);
    f.panels.renderGeo();
    ops.length = 0;
    f.panels.renderGeo();
    const hangar = ops.indexOf('arc(408,368,15,' + Math.PI + ',0)');
    const probeOp = ops.findIndex(
      (o) => o.startsWith('drawImage(') && o.includes(',' + (8 * 48 + 24 - 12) + ',' + (7 * 48 + 24 - 12) + ',')
    );
    expect(hangar).toBeGreaterThanOrEqual(0);
    expect(probeOp).toBeGreaterThan(hangar);
  });

  it('маркер мапи — і в погоні другого (крило в клітинці погоні; ангар «Нетрі» лишається)', () => {
    const { party, probe } = flyingParty();
    const f = makeFixture(party);
    const wings = (): string[] => {
      f.panels.renderGeo();
      ops.length = 0;
      f.panels.renderGeo();
      return ops.filter((o) => o.startsWith('drawImage('));
    };
    const hangars = (): string[] => ops.filter((o) => o.startsWith('arc(')); // ангар кодом — склепіння (без аркуша значків)
    const base = wings().length;
    addFighter(party.intercept, party.geo, 'south');
    expect(wings().length).toBe(base); // п19.5: на базі — «в ангарі», крила немає
    expect(hangars()).toEqual(['arc(408,368,15,' + Math.PI + ',0)']); // ангар «Нетрі» (8, 7)
    startIntercept(party.intercept, party.geo, probe.id, 2);
    party.intercept.fighters[1]!.pos = { x: 3, y: 3 };
    const chase = wings();
    expect(chase.length).toBe(base + 1);
    expect(chase.some((o) => o.includes(',' + (3 * 48 + 24 - 12) + ','))).toBe(true); // центр клітинки (3, 3), спрайт 24 px
    expect(hangars()).toHaveLength(1); // ангар на місці й під час погоні
  });
});

describe('п19.4: «Перехопити» в «Сенсорній сітці» — найближчий боєготовий', () => {
  // аудит PR #523: зонд ставимо явно ближче до ангара «Порт» (2, 4), ніж до вузла (8, 4) — інакше нічия
  it('ангар, ближчий до зонда, піднімається; за рівної відстані — менший id', () => {
    const { party, probe } = flyingParty();
    addFighter(party.intercept, party.geo, 'west');
    probe.pos = { x: 1, y: 4 };
    const pick = nearestReady(party, probe)!;
    expect(pick.id).toBe(2);
    probe.pos = { x: 5, y: 4 }; // 3 від обох ангарів
    expect(nearestReady(party, probe)!.id).toBe(1);
    probe.pos = { x: 1, y: 4 };
    const f = makeFixture(party);
    f.panels.renderProbes();
    const ib = document.querySelector<HTMLButtonElement>('#probes button.intercept')!;
    expect(ib.disabled).toBe(false);
    expect(ib.title).toBe('Підняти перехоплювач ' + pick.id + ' з ангара «' + nameOf(pick.region) + '» на перехоплення');
    ib.click();
    expect(party.intercept.fighters.find((x) => x.id === pick.id)!.status).toBe('погоня');
  });

  it('усі пошкоджені — кнопка вимкнена з причиною; один у погоні на інший зонд — інший бере', () => {
    const { party, probe } = flyingParty();
    addFighter(party.intercept, party.geo, 'east');
    for (const x of party.intercept.fighters) x.hp = 1;
    expect(nearestReady(party, probe)).toBeNull();
    makeFixture(party).panels.renderProbes();
    const ib = document.querySelector<HTMLButtonElement>('#probes button.intercept')!;
    expect(ib.disabled).toBe(true);
    expect(ib.title).toBe('Перехоплювач пошкоджений — спочатку ремонт');
    party.intercept.fighters[1]!.hp = FIGHTER_MAX_HP;
    party.intercept.fighters[0]!.status = 'погоня';
    party.intercept.fighters[0]!.targetId = 'інший';
    setupDom();
    makeFixture(party).panels.renderProbes();
    expect(document.querySelector<HTMLButtonElement>('#probes button.intercept')!.disabled).toBe(false); // аудит PR #522: не лише [0]
  });
});

describe('п19.4: «Регіони» і шар мапи', () => {
  it('рядок на регіон: смуга, довіра, частка дотації, ангар; вийшов — «✗» і «вийшов»; сума — дотація ядра', () => {
    const party = createParty(42);
    addFighter(party.intercept, party.geo, 'east');
    addFighter(party.intercept, party.geo, 'east');
    party.campaign.regions.north.trust = 55;
    party.campaign.regions.south.trust = 0;
    party.campaign.regions.south.out = true;
    renderRegions(party);
    const rows = [...document.querySelectorAll('#regions .region')];
    expect(rows.map((r) => r.id)).toEqual(REGION_IDS.map((id) => 'region-' + id));
    expect(document.querySelector('#region-north .rg-trust')!.textContent).toBe('55');
    expect(document.querySelector('#region-north .rg-share')!.textContent).toBe(regionShare(party, 'north') + '/добу');
    expect(regionShare(party, 'north')).toBe(10); // 75 × 55 / 400 = 10,3
    expect(document.querySelector<HTMLElement>('#region-north .rg-bar i')!.style.width).toBe('55%');
    expect(document.querySelector('#region-east .rg-hangar')!.textContent).toBe('✈2');
    expect(document.querySelector('#region-north .rg-hangar')!.textContent).toBe('✈');
    expect(document.querySelector('#region-west .rg-hangar')).toBeNull();
    expect(fightersIn(party, 'east')).toBe(2);
    expect(document.getElementById('region-south')!.classList.contains('out')).toBe(true);
    expect(document.querySelector('#region-south .rg-trust')!.textContent).toBe('✗');
    expect(document.querySelector('#region-south .rg-share')!.textContent).toBe('вийшов');
    expect(regionShare(party, 'south')).toBe(0);
    expect(document.getElementById('regions-total')!.textContent).toBe('Дотація разом: 48/добу'); // 75 × 255 / 400 = 47,8
  });

  it('колір довіри — межі 70 і 40', () => {
    expect([100, 70, 69, 40, 39, 0].map(trustColor)).toEqual(['#00e5ff', '#00e5ff', '#ffb454', '#ffb454', '#ff6b6b', '#ff6b6b']);
  });

  it('regionRect — прямокутник, у якому кожна клітинка свого регіону', () => {
    let cells = 0;
    for (const id of REGION_IDS) {
      const r = regionRect(id);
      for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) expect(REGION_OF[y]![x]).toBe(id);
      cells += (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1);
    }
    expect(cells).toBe(16 * 9);
  });

  it('шар мапи: пунктир меж, підписи з довірою, затемнення регіону, що вийшов', () => {
    const party = createParty(42);
    party.campaign.regions.east.trust = 0;
    party.campaign.regions.east.out = true;
    party.campaign.regions.west.trust = 30;
    drawRegionsLayer(recCtx, party, 48);
    expect(ops).toContain('setLineDash(6,5)');
    expect(ops.filter((o) => o.startsWith('fillText('))).toEqual([
      'fillText(Порт 30,6,6)',
      'fillText(Шпилі 100,246,6)',
      'fillText(Промзона ✗,582,6)',
      'fillText(Нетрі 100,246,246)',
    ]);
    expect(ops).toContain('fillRect(576,0,192,432)'); // «Промзона» вийшов — затемнено
    // межа Захід | Північ — вертикаль x = 5 × 48 на кожному рядку
    for (let y = 0; y < 9; y++) expect(ops).toContain('moveTo(240,' + y * 48 + ')');
  });

  it('renderGeo (п19.5): перехоплювач в ангарі не «Шпилі» — значок ангара на його клітинці, крила немає; у вузлі — ні того, ні того', () => {
    const party = createParty(42);
    const f = makeFixture(party);
    const draws = (): { images: number; hangars: string[] } => {
      f.panels.renderGeo(); // перший кадр гріє кеш спрайтів — рахуємо другий
      ops.length = 0;
      f.panels.renderGeo();
      return { images: ops.filter((o) => o.startsWith('drawImage(')).length, hangars: ops.filter((o) => o.startsWith('arc(')) };
    };
    const one = draws();
    expect(one.hangars).toEqual([]);
    addFighter(party.intercept, party.geo, 'east');
    expect(draws()).toEqual({ images: one.images, hangars: ['arc(648,224,15,' + Math.PI + ',0)'] }); // ангар «Промзона» (13, 4)
    party.intercept.fighters[1]!.status = 'ремонт';
    party.intercept.fighters[1]!.repairTicksLeft = 4;
    expect(draws()).toEqual({ images: one.images, hangars: ['arc(648,224,15,' + Math.PI + ',0)'] }); // у ремонті — теж «в ангарі», без крила
    party.intercept.fighters[1]!.status = 'на базі';
    delete party.intercept.fighters[1]!.repairTicksLeft;
    addFighter(party.intercept, party.geo, 'east');
    expect(draws().hangars).toHaveLength(1); // два в одному ангарі — один значок
    party.intercept.fighters[1]!.region = 'north';
    party.intercept.fighters[2]!.region = 'north';
    expect(draws()).toEqual(one); // в ангарі вузла — у спрайті вузла
  });
});

describe('п19.4: «Кузня» — купівля перехоплювача з вибором ангара', () => {
  function render(party: Party, over: { inBattle?: boolean } = {}) {
    createWorkshopPanel({
      getParty: () => party,
      inBattle: () => over.inBattle === true,
      isGameOver: () => false,
      journal: vi.fn(),
      drainWorkshop: vi.fn(),
      renderAll: vi.fn(),
    }).render();
  }
  it('кнопка на кожен регіон; клік — замовлення в черзі з регіоном, оплата одразу', () => {
    const party = createParty(42);
    render(party);
    const ids = [...document.querySelectorAll('#interceptor-order button')].map((b) => b.id);
    expect(ids).toEqual(REGION_IDS.map((r) => 'btn-order-interceptor-' + r));
    expect(document.getElementById('interceptor-order')!.textContent).toContain('є 1 з 3');
    btn('btn-order-interceptor-west').click();
    expect(party.workshop.queue.at(-1)).toMatchObject({ id: 'interceptor', region: 'west' });
    expect(party.econ.money).toBe(300 - INTERCEPTOR_COST);
  });

  it('трьох (разом із замовленими) — кнопки вимкнені з причиною; бракує кредитів — теж; вийшов — «✗»', () => {
    const party = createParty(42);
    party.campaign.regions.west.out = true;
    party.econ.money = 100;
    render(party);
    expect(btn('btn-order-interceptor-north').disabled).toBe(true);
    expect(document.querySelector('#interceptor-order .btn-why')!.textContent).toBe('Недостатньо кредитів (ціна 200)');
    expect(btn('btn-order-interceptor-west').textContent).toBe('Порт ✗');
    party.econ.money = 1000;
    addFighter(party.intercept, party.geo, 'east');
    party.workshop.queue.push({ id: 'interceptor', ticksLeft: 48, region: 'south' });
    setupDom();
    render(party);
    expect(btn('btn-order-interceptor-north').disabled).toBe(true);
    expect(document.querySelector('#interceptor-order .btn-why')!.textContent).toBe('Перехоплювачів уже 3 разом із замовленими');
  });
});

describe('п19.4: «Наступний крок» з кількома перехоплювачами', () => {
  const GEO = { inBattle: false, gameOver: false };
  it('перший у погоні, другий боєготовий, інший зонд у повітрі — «перехопіть»', () => {
    const { party, probe } = flyingParty();
    addFighter(party.intercept, party.geo, 'east');
    party.intercept.fighters[0]!.status = 'погоня';
    party.intercept.fighters[0]!.targetId = 'інший';
    expect(nextStep(party, GEO)?.text).toBe(NEXT_STEP.inAir);
    party.intercept.fighters[1]!.status = 'погоня';
    party.intercept.fighters[1]!.targetId = probe.id; // зонд уже переслідують
    expect(nextStep(party, GEO)?.text).not.toBe(NEXT_STEP.inAir);
  });

  it('ремонт і модуль другого — ціль з його суфіксом, без вкладки', () => {
    const party = createParty(42);
    addFighter(party.intercept, party.geo, 'east');
    party.intercept.fighters[1]!.hp = 1;
    expect(nextStep(party, GEO)?.target).toEqual({ tab: null, id: 'btn-repair-2' });
    party.intercept.fighters[0]!.gunModule = true;
    party.workshop.store['gun-module'] = 1;
    expect(nextStep(party, GEO)?.target).toEqual({ tab: null, id: 'btn-gun-install-2' });
  });
});

function $text(): string {
  return document.getElementById('fighter')!.textContent ?? '';
}
function nameOf(r: RegionId): string {
  return { west: 'Порт', north: 'Шпилі', east: 'Промзона', south: 'Нетрі' }[r];
}
