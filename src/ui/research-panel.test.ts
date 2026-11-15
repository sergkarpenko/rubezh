// @vitest-environment jsdom
// P11.6 (Faza 11, ADR-0058/0013): DOM-testy paneli «Дослідження»
// (src/ui/research-panel.ts). Patern save-panel.test.ts: minimalna rozmitka
// index.html (#research) + spravzhnye yadro (createParty/hireScientist/...) —
// panel pokryvaye DOM-mekhaniku: naym/zvilnennya, sloty, kataloh proyektiv,
// pidkazky prychyn, vymknenist u boyu (pretsedent zberezhennya, kryteriy 1).
// T.39 «Zrozumila nauka»: smuha krokiv, kartka protokolu (plashka, «Tsina», «Chas"),
// knopka «Zamovyty v «Kuzni»» (btn-forge-…), tsiny za presetom.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createParty, type Party } from '../core/save';
import { BASE_LAB_SLOTS, HIRE_SCIENTIST_PRICE, PROJECTS, SCIENTIST_SALARY } from '../core/research';
import { GRENADE_DAMAGE, GRENADE_RANGE, HEAL_AMOUNT, HEAL_AP_COST, HIT_CHANCE_CAP } from '../core/combat';
import { GUN_MODULE_DAMAGE } from '../core/intercept';
import { ARMOR_MAX_HP_BONUS, OPTICS_ACCURACY_BONUS, WORKSHOP_CATALOG } from '../core/workshop';
import { sciencePrice } from '../core/campaign';
import { createResearchPanel, type ResearchPanelDeps } from './research-panel';
import { el } from './dom';
import { daysText, ticksText } from './text';

let party: Party;

function makeDeps(over: Partial<ResearchPanelDeps> = {}): ResearchPanelDeps {
  return {
    getParty: () => party,
    inBattle: () => false,
    isGameOver: () => false,
    journal: vi.fn(),
    drainResearch: vi.fn(),
    renderAll: vi.fn(),
    scrollToResearch: vi.fn(),
    scrollToWorkshop: vi.fn(),
    showSquadTab: vi.fn(),
    ...over,
  };
}

beforeEach(() => {
  document.body.innerHTML = '<div id="research"></div>';
  party = createParty(42);
});

// Kartka protokolu za nazvoyu (T.39: .sci-card).
const card = (name: string): HTMLElement =>
  [...document.querySelectorAll<HTMLElement>('#research .sci-card')].find((c) => c.textContent!.includes(name))!;

describe('ResearchPanel: shtat vchenykh', () => {
  it('naym - vchenyy u paneli, hroshi spysani, renderAll vyklykano, knopka «Verbuvaty tekhnomanta — H kr.»', () => {
    const deps = makeDeps();
    const panel = createResearchPanel(deps);
    panel.render();
    expect(el('btn-hire-scientist').textContent).toBe('Вербувати техноманта — ' + HIRE_SCIENTIST_PRICE + ' кр.'); // «norma» ×1
    const before = party.econ.money;
    (el('btn-hire-scientist') as HTMLButtonElement).click();
    expect(party.research.scientists).toHaveLength(1);
    expect(party.econ.money).toBe(before - HIRE_SCIENTIST_PRICE);
    expect(deps.renderAll).toHaveBeenCalledTimes(1);
    panel.render();
    expect(el('research').textContent).toContain('Зінаїда');
    expect((el('btn-fire-в1') as HTMLButtonElement).textContent).toBe('Звільнити');
  });

  it('naym bez hroshey - knopka vymknena, shtat ne zminyuyetsya', () => {
    party.econ.money = HIRE_SCIENTIST_PRICE - 1;
    const panel = createResearchPanel(makeDeps());
    panel.render();
    expect((el('btn-hire-scientist') as HTMLButtonElement).disabled).toBe(true);
    expect(party.research.scientists).toHaveLength(0);
  });

  it('zvilnennya - vchenoho nemaye v shtati, hroshi naymu ne povertyayutsya', () => {
    const deps = makeDeps();
    const panel = createResearchPanel(deps);
    panel.render();
    (el('btn-hire-scientist') as HTMLButtonElement).click();
    const afterHire = party.econ.money;
    panel.render();
    (el('btn-fire-в1') as HTMLButtonElement).click();
    expect(party.research.scientists).toHaveLength(0);
    expect(party.econ.money).toBe(afterHire); // bez povernennya koshtiv (ADR-0058)
  });

  it('T.39 shapka: try ryadky - «Tekhnomantiv: K · utrymannya S kr. za dobu», potik, «Protokoliv u roboti: A z N»', () => {
    const panel = createResearchPanel(makeDeps());
    panel.render();
    const head = el('research').querySelector('.sci-head')!.textContent!;
    expect(head).toContain('Техномантів: 0');
    expect(head).toContain('утримання ' + SCIENTIST_SALARY + ' кр. за добу');
    expect(head).toContain('Кожен техномант дає 1 очко потоку за добу');
    expect(head).toContain('Протоколів у роботі: 0 з ' + BASE_LAB_SLOTS);
  });
});

describe('T.39: smuha krokiv «1. Doslidyty → 2. Vyhotovyty → 3. Vydaty»', () => {
  it('tekty knopok za planom; kliki vyzyvayut vidpovidni diyi navihatsiyi (bez renderAll/zminy stanu)', () => {
    const deps = makeDeps();
    createResearchPanel(deps).render();
    const steps = el('research').textContent!;
    expect(steps).toContain('1. Дослідити');
    expect(steps).toContain('протоколи тут');
    expect(steps).toContain('2. Виготовити');
    expect(steps).toContain('у «Кузні»');
    expect(steps).toContain('3. Видати');
    expect(steps).toContain('вкладка «Загін»');
    (el('btn-sci-step-1') as HTMLButtonElement).click();
    (el('btn-sci-step-2') as HTMLButtonElement).click();
    (el('btn-sci-step-3') as HTMLButtonElement).click();
    expect(deps.scrollToResearch).toHaveBeenCalledTimes(1);
    expect(deps.scrollToWorkshop).toHaveBeenCalledTimes(1);
    expect(deps.showSquadTab).toHaveBeenCalledTimes(1);
    expect(deps.renderAll).not.toHaveBeenCalled(); // chysta navihatsiya
  });

  it('u boyu vsi knopky smilian vymkneni', () => {
    createResearchPanel(makeDeps({ inBattle: () => true })).render();
    for (const id of ['btn-sci-step-1', 'btn-sci-step-2', 'btn-sci-step-3']) {
      expect((el(id) as HTMLButtonElement).disabled).toBe(true);
    }
  });
});

describe('ResearchPanel: kataloh proyektiv (kartky T.39)', () => {
  it('usi 6 proyektiv katalohu - kartky z knopkamy startu; nazvy z katalohu', () => {
    const panel = createResearchPanel(makeDeps());
    panel.render();
    expect(document.querySelectorAll('#research .sci-card')).toHaveLength(6);
    expect(document.querySelectorAll<HTMLButtonElement>('[id^="btn-start-"]')).toHaveLength(6);
    expect(el('research').textContent).toContain('Композитна броня');
    expect(el('research').textContent).toContain('Імпульсна граната');
    expect(el('research').textContent).toContain('Гарматний модуль перехоплювача');
    // ne rozpochato: «Tsina C kr.», «Chas ≈ …», knopka «Doslidyty — C kr.» na vsyu shyrynu
    const armor = card('Композитна броня');
    expect(armor.textContent).toContain('Ціна');
    expect(armor.textContent).toContain('96 кр.');
    expect(armor.textContent).toContain('Час ≈');
    const start = el<HTMLButtonElement>('btn-start-0');
    expect(start.textContent).toBe('Дослідити — 96 кр.');
    expect(start.classList.contains('wide')).toBe(true);
    expect(el('research').textContent).not.toContain('14 очок'); // ryadka «96 · 14 ochok potoku» bilshe nemaye (kryteriy 1)
  });

  it('start proyektu - kartka u roboti: smuha prohresu + «X z P ochok potoku»; sloty 2/2; tretiy start zablokovanyy', () => {
    const deps = makeDeps();
    const panel = createResearchPanel(deps);
    panel.render();
    (el('btn-start-0') as HTMLButtonElement).click(); // «Kompozytna bronya»
    panel.render();
    const armor = card('Композитна броня');
    expect(armor.querySelector('.sci-bar')).not.toBeNull();
    expect(armor.textContent).toContain('0 з ' + PROJECTS[0].points + ' очок потоку');
    expect(armor.textContent).toContain('зупинено: немає техномантів'); // K = 0
    (el('btn-start-1') as HTMLButtonElement).click(); // «Kibernetychne oko»
    panel.render();
    expect(el('research').querySelector('.sci-head')!.textContent).toContain('Протоколів у роботі: 2 з ' + BASE_LAB_SLOTS);
    const third = el<HTMLButtonElement>('btn-start-3'); // «Rozshyrennya laboratoriyi»
    expect(third.disabled).toBe(true); // sloty vycherpano
    expect(third.title).toContain('немає вільного слота');
  });

  it('T2 z nevykonanoyu peredumovoyu - knopka vymknena z pidkazkoyu (title yak zaraz)', () => {
    const panel = createResearchPanel(makeDeps());
    panel.render();
    const grenade = el<HTMLButtonElement>('btn-start-4'); // «Impulsna hranata» pislya «Reheneratyvnoho helu»
    expect(grenade.disabled).toBe(true);
    expect(grenade.title).toContain('спершу: «Регенеративний гель»');
  });

  it('zavershenyy protokol-predmet - plashka «zaversheno» + knopka «Zamovyty v «Kuzni»»; «Rozshyrennya laboratoriyi» - lyshe plashka', () => {
    party.research.completed.push('medkit');
    party.research.completed.push('lab-extension');
    const panel = createResearchPanel(makeDeps());
    panel.render();
    const medkit = card('Регенеративний гель');
    expect(medkit.querySelector('.sci-badge')!.textContent).toBe('завершено');
    expect(medkit.querySelector('.sci-badge')!.classList.contains('ok')).toBe(true);
    expect(medkit.querySelector('#btn-forge-medkit')).not.toBeNull();
    expect(card('Розширення лабораторії').querySelector('button')).toBeNull(); // lyshe plashka
  });

  it('nedostatno koshtiv - knopka vymknena z tsinoyu v pidkaztsi (title yak zaraz)', () => {
    party.econ.money = 10;
    const panel = createResearchPanel(makeDeps());
    panel.render();
    const start = el<HTMLButtonElement>('btn-start-0');
    expect(start.disabled).toBe(true);
    expect(start.title).toContain('недостатньо кредитів');
  });
});

describe('T.39: plashky stanu kartky (persha umova zvershu)', () => {
  it('bez tekhnomantiv i z hroshamy - «potriben tekhnomant»; bez hroshey - «brakuye kredytiv»', () => {
    const panel = createResearchPanel(makeDeps());
    panel.render();
    expect(card('Композитна броня').querySelector('.sci-badge')!.textContent).toBe('потрібен техномант');
    party.econ.money = 10;
    panel.render();
    expect(card('Композитна броня').querySelector('.sci-badge')!.textContent).toBe('бракує кредитів');
  });

  it('peredumova — «після «…»»; zaynuti sloty — «немає вільного слота»; aktyvnyy — «у роботі» (klas run)', () => {
    const panel = createResearchPanel(makeDeps());
    panel.render();
    expect(card('Імпульсна граната').querySelector('.sci-badge')!.textContent).toBe('після «Регенеративний гель»');
    (el('btn-start-0') as HTMLButtonElement).click();
    (el('btn-start-1') as HTMLButtonElement).click();
    panel.render();
    expect(card('Розширення лабораторії').querySelector('.sci-badge')!.textContent).toBe('немає вільного слота');
    const runBadge = card('Композитна броня').querySelector('.sci-badge')!;
    expect(runBadge.textContent).toBe('у роботі');
    expect(runBadge.classList.contains('run')).toBe(true);
  });

  it('z tekhnomantom i hroshamy ne rozpochanyi protokol - «доступний» (neytralna plashka)', () => {
    const panel = createResearchPanel(makeDeps());
    panel.render();
    (el('btn-hire-scientist') as HTMLButtonElement).click(); // 300 − 100 = 200 ≥ 96
    panel.render();
    const badge = card('Композитна броня').querySelector('.sci-badge')!;
    expect(badge.textContent).toBe('доступний');
    expect(badge.className).toBe('sci-badge'); // bez dodatkovykh klasiv
  });
});

describe('T.39: formuly «Час ≈ …» (K tekhnomantiv, P ochok, A protokoliv u roboti)', () => {
  const armorPoints = PROJECTS[0].points; // 14

  it('K = 0: «Час ≈ P dib z odnym tekhnomantom, ⌈P/2⌉ — z dvoma»', () => {
    createResearchPanel(makeDeps()).render();
    expect(card('Композитна броня').textContent).toContain(
      'Час ≈ ' + daysText(armorPoints) + ' з одним техномантом, ' + daysText(Math.ceil(armorPoints / 2)) + ' — з двома'
    );
  });

  it('K = 1: «… z vashym tekhnomantom»; K = 2: «… z vashymy 2 tekhnomantamy» (⌈P/K⌉ діб)', () => {
    const panel = createResearchPanel(makeDeps());
    panel.render();
    (el('btn-hire-scientist') as HTMLButtonElement).click();
    panel.render();
    expect(card('Композитна броня').textContent).toContain('Час ≈ ' + daysText(armorPoints) + ' з вашим техномантом');
    (el('btn-hire-scientist') as HTMLButtonElement).click();
    panel.render();
    expect(card('Композитна броня').textContent).toContain('Час ≈ ' + daysText(Math.ceil(armorPoints / 2)) + ' з вашими 2 техноманти');
  });

  it('u roboti, K ≥ 1: D = ⌈(P − X) · A / K⌉ діб (A = protokoliv u roboti)', () => {
    const panel = createResearchPanel(makeDeps());
    panel.render();
    (el('btn-hire-scientist') as HTMLButtonElement).click(); // K = 1
    (el('btn-start-0') as HTMLButtonElement).click(); // armor aktyvna, X = 0
    (el('btn-start-1') as HTMLButtonElement).click(); // optyka aktyvna, A = 2
    party.research.active.find((p) => p.id === 'armor')!.invested = 6; // X = 6
    panel.render();
    const d = Math.ceil(((armorPoints - 6) * 2) / 1);
    expect(card('Композитна броня').textContent).toContain('6 з ' + armorPoints + ' очок потоку · ще ≈ ' + daysText(d));
  });

  it('u roboti bez tekhnomantiv: «… ochok potoku · zupyneno: nemaye tekhnomantiv» (bez «shche ≈»)', () => {
    const panel = createResearchPanel(makeDeps());
    panel.render();
    (el('btn-start-0') as HTMLButtonElement).click();
    party.research.scientists.push({ id: 'в1', name: 'Зінаїда' });
    panel.render();
    (el('btn-fire-в1') as HTMLButtonElement).click();
    panel.render();
    const armor = card('Композитна броня').textContent!;
    expect(armor).toContain('0 з ' + armorPoints + ' очок потоку · зупинено: немає техномантів');
    expect(armor).not.toContain('ще ≈');
  });
});

describe('T.39: knopka «Замовити в «Кузні»» na kartke zavershenoho protokolu (btn-forge-<id>)', () => {
  it('klik — orderItem: hroshi spysani, cherha tsekhu zrosla, renderAll; umova/title — ti sami, shcho u btn-order-<id>', () => {
    party.research.completed.push('medkit');
    const deps = makeDeps();
    const panel = createResearchPanel(deps);
    panel.render();
    const forge = el<HTMLButtonElement>('btn-forge-medkit');
    expect(forge.textContent).toBe('Замовити в «Кузні» — ' + WORKSHOP_CATALOG.medkit.cost + ' кр.');
    expect(forge.title).toContain('готовність через ' + ticksText(WORKSHOP_CATALOG.medkit.ticks));
    const before = party.econ.money;
    forge.click();
    expect(party.econ.money).toBe(before - WORKSHOP_CATALOG.medkit.cost);
    expect(party.workshop.queue).toHaveLength(1);
    expect(deps.renderAll).toHaveBeenCalledTimes(1);
  });

  it('nedostatno hroshey - vymknena, title «Nedostatno kredytiv (tsina N)» (yak u «Kuzni»)', () => {
    party.research.completed.push('medkit');
    party.econ.money = 10;
    createResearchPanel(makeDeps()).render();
    const forge = el<HTMLButtonElement>('btn-forge-medkit');
    expect(forge.disabled).toBe(true);
    expect(forge.title).toBe('Недостатньо кредитів (ціна ' + WORKSHOP_CATALOG.medkit.cost + ')');
  });

  it('pid knopkoyu — «U «Кузні»: vyhotovlyayetsya, shche T» i/abo «Na skladi: N — vydayte na vkladtsi «Zahin»»', () => {
    party.research.completed.push('medkit');
    party.workshop.queue.push({ id: 'medkit', ticksLeft: 12 });
    party.workshop.store.medkit = 2;
    createResearchPanel(makeDeps()).render();
    const c = card('Регенеративний гель').textContent!;
    expect(c).toContain('У «Кузні»: виготовляється, ще ' + ticksText(12));
    expect(c).toContain('На складі: 2 — видайте на вкладці «Загін»');
  });

  it('harmatnyy modul: na skladi — «vstanovit na paneli «Perekhoplyuvach»» (ne «Zahin»)', () => {
    party.research.completed.push('gun-module');
    party.workshop.store['gun-module'] = 1;
    createResearchPanel(makeDeps()).render();
    expect(el('btn-forge-gun-module')).not.toBeNull();
    expect(card('Гарматний модуль перехоплювача').textContent).toContain('На складі: 1 — встановіть на панелі «Перехоплювач»');
  });

  it('u boyu knopka «Zamovyty v «Кузні»» vymknena', () => {
    party.research.completed.push('medkit');
    createResearchPanel(makeDeps({ inBattle: () => true })).render();
    expect((el('btn-forge-medkit') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('T.39: efekty protokoliv prostymy slovamy (chysla z konstant; «zaraz → stane» vid pershoho soldata)', () => {
  it('kozhen protokol na kartke — plain tekst (kryteriy 1: bez «96 · 14 ochok»)', () => {
    const panel = createResearchPanel(makeDeps());
    panel.render();
    const s = party.roster.soldiers[0]!;
    expect(card('Композитна броня').textContent).toContain(s.maxHp + ARMOR_MAX_HP_BONUS + ' HP замість ' + s.maxHp);
    const optics = card('Кібернетичне око').textContent!;
    expect(optics).toContain(
      Math.round(Math.min(HIT_CHANCE_CAP, s.firingAccuracy + OPTICS_ACCURACY_BONUS) * 100) +
        ' % замість ' +
        Math.round(s.firingAccuracy * 100) +
        ' %'
    );
    expect(card('Регенеративний гель').textContent).toContain(
      'Лікує ' + HEAL_AMOUNT + ' HP за ' + HEAL_AP_COST + ' AP; одна штука на місію'
    );
    const grenade = card('Імпульсна граната').textContent!;
    expect(grenade).toContain(
      'Пошкодження ' + GRENADE_DAMAGE[0] + '–' + GRENADE_DAMAGE[1] + ' у зоні хреста, дальність ' + GRENADE_RANGE + '; зачіпає і своїх'
    );
    expect(card('Розширення лабораторії').textContent).toContain('протоколи в роботі одночасно замість');
    expect(card('Гарматний модуль перехоплювача').textContent).toContain('на ' + GUN_MODULE_DAMAGE + ' пошкодження більше за раунд');
    expect(el('research').textContent).toContain('HP'); // chysla ye
    expect(el('research').textContent).not.toContain('->'); // staryy format «zaraz -> stane» v kartkakh vidsutniy
  });

  it('efekt vydymyy i v kartkakh aktyvnoho/zavershenoho protokolu', () => {
    const panel = createResearchPanel(makeDeps());
    panel.render();
    (el('btn-start-0') as HTMLButtonElement).click(); // bronya aktyvna
    party.research.completed.push('medkit'); // hel zaversheno
    panel.render();
    expect(card('Композитна броня').textContent).toContain('HP замість');
    expect(card('Регенеративний гель').textContent).toContain('Лікує ' + HEAL_AMOUNT + ' HP');
  });

  it('bez rosteru — bez porivnyannya «замість» (plan: «bez ростеру — без porivnyannya»)', () => {
    party.roster.soldiers = [];
    const panel = createResearchPanel(makeDeps());
    panel.render();
    const armor = card('Композитна броня').textContent!;
    expect(armor).toContain('+' + ARMOR_MAX_HP_BONUS + ' HP');
    expect(armor).not.toContain('замість');
    expect(card('Кібернетичне око').textContent).not.toContain('замість');
  });
});

describe('ResearchPanel: kryteriy 1 — lyshe na heostseni (pretsedent zberezhennya)', () => {
  it('u boyu vsi knopky vymkneni (naym, zvilnennya, start, kroky)', () => {
    party.research.scientists.push({ id: 'в1', name: 'Зінаїда' });
    const panel = createResearchPanel(makeDeps({ inBattle: () => true }));
    panel.render();
    expect((el('btn-hire-scientist') as HTMLButtonElement).disabled).toBe(true);
    expect((el('btn-fire-в1') as HTMLButtonElement).disabled).toBe(true);
    expect((el('btn-start-0') as HTMLButtonElement).disabled).toBe(true);
    expect((el('btn-sci-step-1') as HTMLButtonElement).disabled).toBe(true);
  });

  it('pislya bankrutstva naym vymknenyy (isGameOver)', () => {
    const panel = createResearchPanel(makeDeps({ isGameOver: () => true }));
    panel.render();
    expect((el('btn-hire-scientist') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('ResearchPanel: pomylky yadra — u zhurnal, bez kydka', () => {
  it('startProject kydaye (stan zminyvsya poza panellyu) — panel zhurnalyuye i ne lamayetsya', () => {
    const deps = makeDeps();
    const panel = createResearchPanel(deps);
    panel.render(); // knopka aktyvna: koshtiv vystachaye, slot vilnyy
    party.econ.money = 0; // hroshi znykly poza panellyu — yadro kyne, panel shche ne peremalovana
    (el('btn-start-0') as HTMLButtonElement).click();
    expect(deps.journal).toHaveBeenCalledWith(expect.stringContaining('Недостатньо кредитів'), 'lose', 'base');
    expect(deps.renderAll).toHaveBeenCalledTimes(1);
    expect(party.research.active).toHaveLength(0); // stan yadra ne zminyvsya
  });
});

describe('ResearchPanel: tsiny za presetom (T.29) — kartky T.39 pokazuyut preseti', () => {
  it('«lehkyy»: naym 50, utrymannya 5, protokol broni 48, «Zamovyty v «Кузні»» 30 — u vsikh місцях', () => {
    party = createParty(42, 'легкий');
    const panel = createResearchPanel(makeDeps());
    panel.render();
    expect(el('btn-hire-scientist').textContent).toBe('Вербувати техноманта — ' + sciencePrice(HIRE_SCIENTIST_PRICE, 'легкий') + ' кр.');
    expect(el('research').querySelector('.sci-head')!.textContent).toContain(
      'утримання ' + sciencePrice(SCIENTIST_SALARY, 'легкий') + ' кр. за добу'
    );
    const price = sciencePrice(PROJECTS[0].cost, 'легкий');
    const armor = card('Композитна броня');
    expect(armor.textContent).toContain('Ціна');
    expect(armor.textContent).toContain(price + ' кр.');
    const start = el('btn-start-0') as HTMLButtonElement;
    expect(start.textContent).toBe('Дослідити — ' + price + ' кр.');
    expect(start.title).toBe('Почати протокол (−' + price + ')');
    const before = party.econ.money;
    start.click();
    expect(party.econ.money).toBe(before - price);
    // zavershenyy protokol-predmet: tsina vyrobnytstva теж za presetom
    party.research.completed.push('armor');
    panel.render();
    const forgePrice = sciencePrice(WORKSHOP_CATALOG.armor.cost, 'легкий');
    expect((el('btn-forge-armor') as HTMLButtonElement).textContent).toBe('Замовити в «Кузні» — ' + forgePrice + ' кр.');
  });
});
