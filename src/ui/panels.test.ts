// @vitest-environment jsdom
// пR.2: юніт-тести панелей стану і топбара (src/ui/panels.ts, ADR-0037).
// hpColor перенесено з main.test.ts без ослаблення тверджень; тут же —
// гілки рендерів (геосцена, сканери, винищувач, фінанси, ростер, кампанія).
// DOM-флоу застосунку лишається у main.ui.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { advanceTime, detectedUfos, geoClock, missionTargets } from '../core/geo';
import { FIGHTER_MAX_HP, startIntercept } from '../core/intercept';
import { createParty, type Party } from '../core/save';
import { ARMOR_MAX_HP_BONUS, OPTICS_ACCURACY_BONUS } from '../core/workshop';
import { GRENADE_DAMAGE, GRENADE_RANGE, HEAL_AMOUNT, HIT_CHANCE_CAP } from '../core/combat';
import { initPixelSprites } from '../render';
import { createPanels, hpColor, type PanelsDeps } from './panels';

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
    <button id="btn-hire">Найм солдата (100)</button>
    <section id="geo-panel"><canvas id="geo" width="576" height="288"></canvas></section>
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
    expect(f.deps.activeGeoAnim).toHaveBeenCalled();
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
    expect(btn2.title).toContain('Усі солдати поранені');
    btn2.onclick = null;
  });

  it('кнопка місії веде до launchMission (застосунок)', () => {
    const f = makeFixture();
    expect(tickUntil(f.party, () => missionTargets(f.party.geo).length > 0)).toBe(true);
    f.panels.renderUfos();
    (document.querySelector('button.mission') as HTMLButtonElement).click();
    expect(f.deps.launchMission).toHaveBeenCalledWith(f.party.geo.ufos.find((u) => u.id !== undefined)!.id);
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

  it('ремонт — статус з тіками, кнопки дій нема', () => {
    const f = makeFixture();
    f.party.intercept.fighter.status = 'ремонт';
    f.party.intercept.fighter.repairTicksLeft = 2;
    f.panels.renderFighter();
    expect(document.getElementById('fighter')!.textContent).toContain('ремонт: 2 тік(и)');
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
    expect(box.textContent).toContain('6 солдатів (5 боєготових)');
    expect(box.innerHTML).toContain('лікарня: 3 тик(и)');
    expect(box.innerHTML).toContain('#ff9c9c'); // hpColor(4, 10) — поранений
  });

  it('порожній ростер — «Загін втрачено» і підказка щодо найму', () => {
    const f = makeFixture();
    f.party.roster.soldiers.length = 0;
    f.party.econ.money = 300;
    f.panels.renderRoster();
    expect(document.getElementById('roster')!.textContent).toContain('Загін втрачено');
    expect(document.getElementById('roster')!.textContent).toContain('Найм доступний');
    f.party.econ.money = 10;
    f.panels.renderRoster();
    expect(document.getElementById('roster')!.textContent).toContain('Грошей на найм немає');
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
    f.party.campaign.score = { total: 1234 };
    f.panels.renderCampaign();
    expect(document.getElementById('campaign-victory')!.classList.contains('hidden')).toBe(false);
    expect(document.getElementById('campaign-score')!.textContent).toBe('1234');
  });

  // П8.3a: endless (рішення власника 2026-10-15) — «Грати далі» ховає екран
  it('перемога + «Грати далі» (endless) — екран приховано, рахунок лишився', () => {
    const f = makeFixture({ victoryDismissed: () => true });
    f.party.campaign.status = 'перемога';
    f.party.campaign.score = { total: 1234 };
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
    f.party.workshop.store['легка броня'] = 1;
    f.party.workshop.store['оптичний приціл'] = 1;
    f.party.workshop.store['аптечка'] = 1;
    f.party.workshop.store['осколкова граната'] = 1;
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
    f.party.workshop.store['легка броня'] = 1;
    f.panels.renderRoster();
    const beforeHp = s.hp;
    const beforeMax = s.maxHp;
    (document.getElementById('btn-equip-' + s.id + '-armor') as HTMLButtonElement).click();
    expect(f.party.workshop.equipped[s.id]!.armor).toBe(true);
    expect(f.party.workshop.store['легка броня']).toBe(0);
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
    f.party.workshop.store['легка броня'] = 1;
    f.panels.renderRoster();
    (document.getElementById('btn-equip-' + s.id + '-armor') as HTMLButtonElement).click();
    s.hp = s.maxHp; // повне здоров'я у броні
    f.panels.renderRoster();
    (document.getElementById('btn-equip-' + s.id + '-armor') as HTMLButtonElement).click();
    expect(f.party.workshop.store['легка броня']).toBe(1);
    expect(s.maxHp).toBe(10);
    expect(s.hp).toBe(10); // hp min(hp, maxHp) — «оздоровлення» нема
    expect(f.party.workshop.equipped[s.id]).toBeUndefined(); // порожній запис вилучено
  });

  it('оптика — +0.05 точності; витратники — по одному на солдата', () => {
    const f = makeFixture();
    const s = f.party.roster.soldiers[0]!;
    f.party.workshop.store['оптичний приціл'] = 1;
    f.party.workshop.store['аптечка'] = 1;
    f.party.workshop.equipped[s.id] = { armor: false, optics: false, medkit: true, grenade: false };
    const accBefore = s.firingAccuracy;
    f.panels.renderRoster();
    (document.getElementById('btn-equip-' + s.id + '-optics') as HTMLButtonElement).click();
    expect(s.firingAccuracy).toBeCloseTo(accBefore + 0.05, 10);
    f.panels.renderRoster();
    const medkitBtn = document.getElementById('btn-equip-' + s.id + '-medkit') as HTMLButtonElement;
    expect(medkitBtn.textContent).toContain('аптечка ✓'); // уже при солдатові
    expect(medkitBtn.disabled).toBe(false); // зняти можна
    (document.getElementById('btn-equip-' + s.id + '-medkit') as HTMLButtonElement).click();
    expect(f.party.workshop.store['аптечка']).toBe(2); // 1 + повернуто
  });

  it('критерій 1: у бою кнопки екіпірування вимкнені (лише геосцена)', () => {
    const f = makeFixture({ inBattle: () => true });
    const s = f.party.roster.soldiers[0]!;
    f.party.workshop.store['аптечка'] = 2;
    f.panels.renderRoster();
    expect((document.getElementById('btn-equip-' + s.id + '-medkit') as HTMLButtonElement).disabled).toBe(true);
  });

  it('помилка ядра (зняття неспорядженого — стан змінився поза панеллю) — у журнал', () => {
    const f = makeFixture();
    const s = f.party.roster.soldiers[0]!;
    f.party.workshop.store['аптечка'] = 1;
    f.panels.renderRoster();
    (document.getElementById('btn-equip-' + s.id + '-medkit') as HTMLButtonElement).click();
    // предмет зняли напряму через ядро — панель ще не перемальована
    f.party.workshop.equipped[s.id]!.medkit = false;
    (document.getElementById('btn-equip-' + s.id + '-medkit') as HTMLButtonElement).click(); // «зняти» ще раз
    expect(f.deps.journal).toHaveBeenCalledWith(expect.stringContaining('Предмета немає'), 'lose', 'base');
    expect(f.party.workshop.store['аптечка']).toBe(0); // помилка ядра — склад не змінився
  });
});
