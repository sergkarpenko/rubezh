// п19.6 (ADR-0159 п. 17): бот партії з кількома перехоплювачами — купівля в «Кузні» політикою
// кампанії, ангар у регіоні з найнижчою довірою, погоня найближчим вільним, ремонт і модуль на кожен.
// З одним перехоплювачем і без купівлі — байт-у-байт як до п19.6 (повні партії нижче).

import { describe, expect, it } from 'vitest';
import { createParty } from './save';
import type { Party } from './save';
import type { Probe } from './geo';
import { addFighter, FIGHTER_MAX_HP, hangarPos } from './intercept';
import { BALANCED_POLICY, CAUTIOUS_POLICY } from './intercept-bot';
import {
  AIR_BATTLE_MAX_ROUNDS,
  CAMPAIGN_INTERCEPTORS,
  CAMPAIGN_POLICY,
  DEFAULT_PARTY_POLICY,
  partyBotAirBattle,
  partyBotFleetStep,
  partyBotInterceptStep,
  partyBotScienceStep,
  simulateParty,
  weakestRegion,
} from './party-bot';

function probe(id: string, x: number, y: number, kind: Probe['kind'] = 'розвідник'): Probe {
  return { id, kind, pos: { x, y }, target: { x, y }, detected: true, status: 'летить', landedTicksLeft: 8 };
}

function twoFighters(): Party {
  const p = createParty(42, 'норма');
  p.geo.probes = [];
  p.intercept.fighters[0].pos = hangarPos('north', p.geo);
  addFighter(p.intercept, p.geo, 'east');
  return p;
}

describe('п19.6: купівля перехоплювача політикою кампанії', () => {
  // «норма»: ціна 200, резерв найму — 3 × 100 + 50 = 350 → купівля від 550 кредитів
  it('політика кампанії тримає два перехоплювачі; без поля — не купує', () => {
    expect(CAMPAIGN_INTERCEPTORS).toBe(2);
    expect(CAMPAIGN_POLICY.interceptorsUpTo).toBe(2);
    expect(DEFAULT_PARTY_POLICY.interceptorsUpTo).toBeUndefined();
    const p = createParty(42, 'норма');
    p.econ.money = 5000;
    partyBotFleetStep(p, DEFAULT_PARTY_POLICY);
    expect(p.workshop.queue).toEqual([]);
  });

  it('межа грошей: 550 — замовлення з оплатою 200, 549 — ні', () => {
    const p = createParty(42, 'норма');
    p.econ.money = 549;
    partyBotFleetStep(p, CAMPAIGN_POLICY);
    expect(p.workshop.queue).toEqual([]);
    p.econ.money = 550;
    partyBotFleetStep(p, CAMPAIGN_POLICY);
    expect(p.econ.money).toBe(350);
    expect(p.workshop.queue).toEqual([{ id: 'interceptor', ticksLeft: 48, region: 'west' }]);
  });

  it('резерв за пресетом: «легкий» — найм 120 × 3 + 50 і ціна 100 (наука ×0,5)', () => {
    const p = createParty(42, 'легкий');
    p.econ.money = 509;
    partyBotFleetStep(p, CAMPAIGN_POLICY);
    expect(p.workshop.queue).toEqual([]);
    p.econ.money = 510;
    partyBotFleetStep(p, CAMPAIGN_POLICY);
    expect(p.econ.money).toBe(410);
  });

  it('черга «Кузні» не порожня чи ліміт разом із замовленими — не купує', () => {
    const p = createParty(42, 'норма');
    p.econ.money = 5000;
    p.workshop.queue.push({ id: 'armor', ticksLeft: 10 });
    partyBotFleetStep(p, CAMPAIGN_POLICY);
    expect(p.workshop.queue).toHaveLength(1);
    p.workshop.queue = [];
    partyBotFleetStep(p, CAMPAIGN_POLICY);
    p.workshop.queue = [];
    addFighter(p.intercept, p.geo, 'west'); // уже два
    partyBotFleetStep(p, CAMPAIGN_POLICY);
    expect(p.workshop.queue).toEqual([]);
    partyBotFleetStep(p, { ...CAMPAIGN_POLICY, interceptorsUpTo: 3 });
    expect(p.workshop.queue).toHaveLength(1);
    partyBotFleetStep(p, { ...CAMPAIGN_POLICY, interceptorsUpTo: 3 }); // разом із замовленим — уже три
    expect(p.workshop.queue).toHaveLength(1);
    p.workshop.queue = [];
    addFighter(p.intercept, p.geo, 'south'); // три — понад ліміт політика не замовляє і не кидає
    expect(() => partyBotFleetStep(p, { ...CAMPAIGN_POLICY, interceptorsUpTo: 4 })).not.toThrow();
    expect(p.workshop.queue).toEqual([]);
  });

  it('купівля — у кроці науки після предметів цеху, коли черга й далі порожня', () => {
    const p = createParty(42, 'норма');
    p.econ.money = 5000;
    partyBotScienceStep(p, { ...CAMPAIGN_POLICY, scientistsUpTo: 0, projects: [], equip: false });
    expect(p.workshop.queue.map((o) => o.id)).toEqual(['interceptor']);
    const q = createParty(42, 'норма');
    q.econ.money = 5000;
    q.research.completed.push('armor');
    partyBotScienceStep(q, { ...CAMPAIGN_POLICY, scientistsUpTo: 0, projects: [], equip: false });
    expect(q.workshop.queue.map((o) => o.id)).toEqual(['armor']); // броня першою
  });

  it('регіон ангара — найнижча довіра серед тих, що не вийшли; рівні — без перехоплювача, далі порядок', () => {
    const p = createParty(42, 'норма');
    expect(weakestRegion(p)).toBe('west'); // усі 100, «Шпилі» з перехоплювачем
    p.campaign.regions.east.trust = 70;
    expect(weakestRegion(p)).toBe('east');
    p.campaign.regions.north.trust = 70;
    expect(weakestRegion(p)).toBe('east'); // рівні 70 — «Шпилі» з перехоплювачем далі
    p.campaign.regions.west.trust = 0;
    p.campaign.regions.west.out = true;
    p.campaign.regions.south.trust = 40;
    expect(weakestRegion(p)).toBe('south'); // «Порт» вийшов — не рахується
    for (const id of ['north', 'east', 'south'] as const) p.campaign.regions[id] = { trust: 0, out: true };
    expect(weakestRegion(p)).toBe('north');
  });
});

describe('п19.6: перехоплення кількома перехоплювачами', () => {
  it('дві цілі — дві погоні: кожна найближчим вільним від ангара', () => {
    const p = twoFighters();
    p.geo.probes.push(probe('a', 14, 4), probe('b', 7, 4)); // «a» біля «Сходу», «b» біля вузла
    partyBotInterceptStep(p, BALANCED_POLICY);
    const [f1, f2] = p.intercept.fighters;
    expect([f1.status, f1.targetId, f2.status, f2.targetId]).toEqual(['погоня', 'b', 'погоня', 'a']);
  });

  it('одна ціль — найближчий; рівна відстань — менший id', () => {
    const p = twoFighters();
    p.geo.probes.push(probe('a', 12, 4));
    partyBotInterceptStep(p, BALANCED_POLICY);
    expect(p.intercept.fighters.map((f) => f.status)).toEqual(['на базі', 'погоня']);
    const q = twoFighters();
    q.intercept.fighters[1].region = 'south'; // ангар (8, 7): до (8, 1) — 6, вузол (8, 4) — 3
    q.geo.probes.push(probe('c', 11, 1)); // вузол — 3, «Нетрі» — 6
    partyBotInterceptStep(q, BALANCED_POLICY);
    expect(q.intercept.fighters.map((f) => f.status)).toEqual(['погоня', 'на базі']);
    const r = twoFighters();
    r.intercept.fighters[1].region = 'north'; // обидва у вузлі — рівно
    r.geo.probes.push(probe('d', 10, 4));
    partyBotInterceptStep(r, BALANCED_POLICY);
    expect(r.intercept.fighters.map((f) => f.status)).toEqual(['погоня', 'на базі']);
  });

  it('ціль уже переслідують — не друга погоня; вільна — найближчим із вільних', () => {
    const p = twoFighters();
    p.geo.probes.push(probe('a', 14, 4));
    partyBotInterceptStep(p, BALANCED_POLICY);
    partyBotInterceptStep(p, BALANCED_POLICY);
    expect(p.intercept.fighters.map((f) => f.status)).toEqual(['на базі', 'погоня']);
    p.geo.probes.push(probe('b', 15, 4)); // ближче до «Сходу», але той зайнятий
    partyBotInterceptStep(p, BALANCED_POLICY);
    expect([p.intercept.fighters[0].status, p.intercept.fighters[0].targetId]).toEqual(['погоня', 'b']);
  });

  it('перша ціль, на яку політика не запускає, зупиняє запуски кроку (як з одним)', () => {
    const p = twoFighters();
    p.geo.probes.push(probe('a', 9, 4, 'збирач'), probe('b', 14, 4));
    partyBotInterceptStep(p, CAUTIOUS_POLICY);
    expect(p.intercept.fighters.map((f) => f.status)).toEqual(['на базі', 'на базі']);
  });

  it('пошкоджені — ремонт кожного за id, поки є гроші й боєготові', () => {
    const p = twoFighters();
    for (const f of p.intercept.fighters) f.hp = 1;
    p.econ.money = 120;
    partyBotInterceptStep(p, BALANCED_POLICY);
    expect(p.intercept.fighters.map((f) => f.status)).toEqual(['ремонт', 'ремонт']);
    expect(p.econ.money).toBe(20);
    const q = twoFighters();
    for (const f of q.intercept.fighters) f.hp = 1;
    q.econ.money = 70;
    partyBotInterceptStep(q, BALANCED_POLICY);
    expect(q.intercept.fighters.map((f) => f.status)).toEqual(['ремонт', 'на базі']);
  });

  it('один у бою — раунд, другий боєготовий тим самим кроком іде на іншу ціль; той, що вийшов із бою, — ні', () => {
    const p = twoFighters();
    p.geo.probes.push(probe('a', 8, 4));
    partyBotInterceptStep(p, BALANCED_POLICY); // перший — погоня; він уже на клітинці цілі
    const ic = p.intercept;
    ic.fighters[0].status = 'бій';
    ic.activeProbeId = 'a';
    ic.round = 0;
    p.geo.probes.push(probe('b', 14, 4));
    const rounds = ic.log.filter((e) => e.type === 'intercept_round').length;
    partyBotInterceptStep(p, BALANCED_POLICY);
    expect(ic.log.filter((e) => e.type === 'intercept_round').length).toBe(rounds + 1);
    expect([ic.fighters[1].status, ic.fighters[1].targetId]).toEqual(['погоня', 'b']);
    // запуск — лише з тих, хто був боєготовим на початку кроку: у бою й у ремонті — ні
    const q = twoFighters();
    q.geo.probes.push(probe('a', 8, 4));
    partyBotInterceptStep(q, BALANCED_POLICY);
    Object.assign(q.intercept.fighters[0], { status: 'бій', hp: FIGHTER_MAX_HP });
    q.intercept.activeProbeId = 'a';
    q.intercept.fighters[1].hp = 1;
    q.intercept.fighters[1].repairTicksLeft = 5;
    q.intercept.fighters[1].status = 'ремонт';
    q.geo.probes.push(probe('c', 9, 4));
    partyBotInterceptStep(q, { ...BALANCED_POLICY, chooseRange: () => 'далека' });
    expect(q.intercept.log.filter((e) => e.type === 'intercept_start').length).toBe(1);
  });

  it('гарматний модуль — на кожен перехоплювач у ангарі за id, поки є на складі', () => {
    const p = twoFighters();
    p.workshop.store['gun-module'] = 1;
    partyBotScienceStep(p, { ...DEFAULT_PARTY_POLICY, equip: true });
    expect(p.intercept.fighters.map((f) => !!f.gunModule)).toEqual([true, false]);
    p.workshop.store['gun-module'] = 2;
    partyBotScienceStep(p, { ...DEFAULT_PARTY_POLICY, equip: true });
    expect(p.intercept.fighters.map((f) => !!f.gunModule)).toEqual([true, true]);
    expect(p.workshop.store['gun-module']).toBe(1);
  });

  it('дефіцит модуля — за кількістю перехоплювачів без модуля', () => {
    const p = twoFighters();
    p.econ.money = 5000;
    p.research.completed.push('gun-module');
    const pol = { ...DEFAULT_PARTY_POLICY, workshopOrders: ['gun-module' as const] };
    p.intercept.fighters[0].gunModule = true;
    partyBotScienceStep(p, pol);
    expect(p.workshop.queue.map((o) => o.id)).toEqual(['gun-module']); // другому бракує
    p.workshop.queue = [];
    p.workshop.store['gun-module'] = 1; // другий у польоті — модуль уже на складі, не замовляти ще
    p.intercept.fighters[1].status = 'погоня';
    partyBotScienceStep(p, pol);
    expect(p.workshop.queue).toEqual([]);
    p.workshop.store['gun-module'] = 0;
    p.intercept.fighters[1].gunModule = true;
    partyBotScienceStep(p, pol);
    expect(p.workshop.queue).toEqual([]);
  });

  it('політика лише з interceptorsUpTo — крок науки не виходить раніше і купує', () => {
    const p = createParty(42, 'норма');
    p.econ.money = 5000;
    partyBotScienceStep(p, { ...DEFAULT_PARTY_POLICY, interceptorsUpTo: 2 });
    expect(p.workshop.queue.map((o) => o.id)).toEqual(['interceptor']);
  });

  it('той, хто вийшов із бою цим кроком (відступ), не злітає тим самим кроком на вільну ціль', () => {
    const p = createParty(42, 'норма');
    p.geo.probes = [probe('a', 8, 4), probe('b', 10, 4)];
    partyBotInterceptStep(p, BALANCED_POLICY); // погоня на «a»
    const ic = p.intercept;
    ic.fighters[0].status = 'бій';
    ic.activeProbeId = 'a';
    const retreat = { ...BALANCED_POLICY, chooseRange: () => 'відступ' as unknown as 'далека' };
    partyBotInterceptStep(p, retreat);
    expect([ic.fighters[0].status, ic.fighters[0].targetId]).toEqual(['на базі', null]);
    expect(ic.log.filter((e) => e.type === 'intercept_start')).toHaveLength(1);
    partyBotInterceptStep(p, BALANCED_POLICY); // наступним кроком — так
    expect(ic.fighters[0].status).toBe('погоня');
  });
});

describe('п19.6: повітряний бій бота — до кінця, поки час стоїть (рішення власника «А. Бій як у грі»)', () => {
  function engaged(): Party {
    const p = createParty(42, 'норма');
    p.geo.probes = [probe('a', 8, 4)];
    partyBotInterceptStep(p, BALANCED_POLICY);
    const ic = p.intercept;
    Object.assign(ic.fighters[0], { status: 'бій', pos: { x: 8, y: 4 } });
    ic.activeProbeId = 'a';
    return p;
  }

  it('бій, що почався, бот доводить до кінця одним викликом; без бою — нуль раундів', () => {
    const p = engaged();
    const rounds = partyBotAirBattle(p, BALANCED_POLICY);
    expect(rounds).toBeGreaterThan(0);
    expect(p.intercept.log.filter((e) => e.type === 'intercept_round')).toHaveLength(rounds);
    expect(p.intercept.fighters[0].status).not.toBe('бій');
    expect(p.intercept.activeProbeId).toBeNull();
    expect(partyBotAirBattle(p, BALANCED_POLICY)).toBe(0);
  });

  it('зонд бою зник (бот виграв на ньому місію) — бій переривається «probe_lost», а не застрягає', () => {
    const p = engaged();
    p.geo.probes = [];
    partyBotInterceptStep(p, BALANCED_POLICY);
    const last = p.intercept.log[p.intercept.log.length - 2];
    expect(last).toMatchObject({ type: 'intercept_aborted', probeId: 'a', reason: 'probe_lost' });
    expect(p.intercept.fighters[0].status).toBe('на базі');
    const q = engaged();
    q.geo.probes = [];
    expect(partyBotAirBattle(q, BALANCED_POLICY)).toBe(1);
    expect(q.intercept.fighters[0].status).toBe('на базі');
  });

  it('запобіжник: бій без влучань — не довше AIR_BATTLE_MAX_ROUNDS раундів за виклик', () => {
    const p = engaged();
    p.intercept.rng = () => 0.999; // ніхто не влучає
    expect(partyBotAirBattle(p, BALANCED_POLICY)).toBe(AIR_BATTLE_MAX_ROUNDS);
    expect(p.intercept.fighters[0].status).toBe('бій');
  });
});

describe('п19.6: повні партії політики кампанії з купівлею', () => {
  // п20.2 (укриття і низькі перешкоди, ADR-0166): сід 6 — 24 погоні з 56, перемога на 43-й (було 22 з 53, 41-ша)
  // п20.3 (ШІ ворогів з укриттям, ADR-0167; бот кампанії в дозорі, з місця не йде): 21 погоня з 50, перемога на 38-й у другому фіналі
  // п20.6 (бот зі зброєю, ADR-0170): сід 6 купує в «Промзона» — сід 10: «Порт», 13 погонь з 50, перемога на 42-й у першому фіналі
  // п22.2 (гілки «Сержанта» й «Ветерана» в бота, ADR-0183): 12 погонь з 49, перемога — та сама 42-га
  // п22.6 (виводки й чемпіони, ADR-0188): 9 погонь з 33, перемога на 27-й з першої спроби
  it('сід 10 «норма»: другий перехоплювач в ангарі «Порт», 9 погонь з 33; перемога на 27-й', () => {
    let last: Readonly<Party> | null = null;
    const r = simulateParty(10, 'норма', { policy: CAMPAIGN_POLICY, onTick: (p) => (last = p) });
    expect([r.outcome, r.endDay, r.gateAttempts, r.launches, r.shotDown]).toEqual(['перемога', 27, 1, 33, 28]); // п22.5 (ADR-0187): 29-та, 4 спроби, 37 і 32; до п22.5 — 42-га, 1 спроба, 49 і 36
    const fin = last as unknown as Party;
    expect(fin.intercept.fighters.map((f) => f.id + ':' + f.region)).toEqual(['1:north', '2:west']);
    const starts = fin.intercept.log.filter((e) => e.type === 'intercept_start').map((e) => e.fighter ?? 1);
    expect([starts.length, starts.filter((id) => id === 2).length]).toEqual([33, 9]);
    expect(fin.intercept.fighters.every((f) => f.status !== 'бій')).toBe(true); // бій не переживає тік
  }, 30_000);

  it('без купівлі (interceptorsUpTo 1) — сід 7 байт-у-байт як політика без поля; бій до кінця — 38 погонь, 29 збито', () => {
    const a = simulateParty(7, 'норма', { policy: { ...CAMPAIGN_POLICY, interceptorsUpTo: 1 } });
    const b = simulateParty(7, 'норма', { policy: { ...CAMPAIGN_POLICY, interceptorsUpTo: undefined } });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // до п19.6 — 3 і 1: перехоплювач застрягав у «бою»; п20.2 — 41 і 31 → 38 і 29; п20.3 (ШІ ворогів з укриттям) — 43 і 33;
    // п20.6 (бот зі зброєю, ADR-0170) — 39 і 31; п22.5 (дослідники за рівнем, партія коротша, ADR-0187) — 25 і 20;
    // п22.6 (виводки й чемпіони, ADR-0188) — 38 і 29
    expect([a.launches, a.shotDown]).toEqual([38, 29]);
  }, 30_000);
});
