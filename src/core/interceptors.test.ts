// src/core/interceptors.test.ts
// п19.3 (ADR-0159 п. 4, 13–14; ADR-0161): кілька перехоплювачів — купівля в «Кузні», ангари
// регіонів, вибір перехоплювача для погоні, перепризначення, ремонт і модуль на кожен окремо,
// один повітряний бій одночасно, сейв v4 з переліком і міграція одного перехоплювача.

import { describe, expect, it } from 'vitest';
import { createEconomy } from './economy';
import { createGeoGame, type GeoState, type Probe } from './geo';
import {
  FIGHTER_MAX_HP,
  FIGHTER_REPAIR_TICKS,
  HANGARS,
  MAX_FIGHTERS,
  addFighter,
  assignFighter,
  createIntercept,
  fighterById,
  fighterInBattle,
  hangarPos,
  interceptRound,
  interceptTick,
  repairTick,
  startIntercept,
  startRepair,
  type InterceptState,
} from './intercept';
import {
  INTERCEPTOR_COST,
  INTERCEPTOR_TICKS,
  createWorkshop,
  installGunModule,
  interceptorCount,
  orderInterceptor,
  orderName,
  removeGunModule,
  workshopTick,
} from './workshop';
import { sciencePrice } from './campaign';
import { createParty, deserializeParty, serializeParty } from './save';
import { simulateParty } from './party-bot';

function mkProbe(id: string, pos: { x: number; y: number }, target = pos): Probe {
  return { id, kind: 'розвідник', pos: { ...pos }, target: { ...target }, detected: true, status: 'летить', landedTicksLeft: 8 };
}

function geoWith(...probes: Probe[]): GeoState {
  const geo = createGeoGame({ seed: 1, spawnChance: 0 });
  geo.probes.push(...probes);
  return geo;
}

// Перехоплення з другим перехоплювачем у регіоні region (без «Кузні»).
function twoFighters(geo: GeoState, region: 'west' | 'north' | 'east' | 'south' = 'east'): InterceptState {
  const ic = createIntercept(7);
  addFighter(ic, geo, region);
  return ic;
}

describe('п19.3: ангари і перший перехоплювач', () => {
  it('ангар «Північ» — вузол «Рубіж»; решта — окремі клітинки (ADR-0159 п. 13)', () => {
    const geo = createGeoGame({ seed: 1 });
    expect(HANGARS.north).toEqual(geo.base);
    expect(hangarPos('north', geo)).toEqual(geo.base);
    expect([HANGARS.west, HANGARS.east, HANGARS.south]).toEqual([
      { x: 2, y: 4 },
      { x: 13, y: 4 },
      { x: 8, y: 7 },
    ]);
  });

  it('перший перехоплювач — id 1, регіон «Північ»; MAX_FIGHTERS = 3', () => {
    const ic = createIntercept();
    expect(ic.fighters).toHaveLength(1);
    expect(ic.fighters[0]).toMatchObject({ id: 1, region: 'north', hp: FIGHTER_MAX_HP, status: 'на базі' });
    expect(MAX_FIGHTERS).toBe(3);
  });

  it('без купівлі — у журналах партії бота немає позначок перехоплювача, повернення — у вузол', () => {
    // EARS 5: байт-у-байт як у v0.10.0 — поле fighter/region з'являється лише з двома перехоплювачами
    let tagged = 0;
    const r = simulateParty(42, 'норма', {
      maxDays: 20,
      onTick: (party) => {
        tagged += party.intercept.log.filter((e) => 'fighter' in e || 'region' in e).length;
        tagged += party.workshop.log.filter((e) => 'fighter' in e).length;
      },
    });
    expect(r.launches).toBeGreaterThan(0);
    expect(tagged).toBe(0);
    const p = createParty(42);
    const geo = p.geo;
    const ic = p.intercept;
    geo.probes.push(mkProbe('u1', { x: 10, y: 4 }, { x: 15, y: 4 }));
    startIntercept(ic, geo, 'u1');
    interceptTick(ic, geo);
    interceptRound(ic, geo, 'відступ');
    for (const e of ic.log) expect('fighter' in e || 'region' in e, e.type).toBe(false);
    expect(ic.log.at(-1)).toEqual({ type: 'fighter_returned', pos: geo.base, minute: geo.minute });
  });
});

describe('п19.3: купівля в «Кузні» (EARS 5)', () => {
  it('замовлення — 200 × множник науки, 48 тіків, у кінці черги; подія з ангаром', () => {
    for (const preset of ['легкий', 'норма', 'складний'] as const) {
      const econ = createEconomy();
      const w = createWorkshop();
      const ic = createIntercept();
      const before = econ.money;
      const o = orderInterceptor(econ, w, ic, 'east', preset);
      expect(before - econ.money).toBe(sciencePrice(INTERCEPTOR_COST, preset));
      expect(o).toEqual({ id: 'interceptor', ticksLeft: INTERCEPTOR_TICKS, region: 'east' });
      expect(w.log.at(-1)).toEqual({ type: 'interceptor_order', region: 'east', ticks: 48 });
      expect(orderName(o)).toBe('Перехоплювач');
    }
    expect(sciencePrice(INTERCEPTOR_COST, 'легкий')).toBe(100);
  });

  it('усього до трьох разом із замовленими; без грошей — відмова без змін', () => {
    const econ = createEconomy();
    econ.money = 10_000;
    const w = createWorkshop();
    const ic = createIntercept();
    orderInterceptor(econ, w, ic, 'west');
    orderInterceptor(econ, w, ic, 'west'); // кілька в одному ангарі — можна (рішення власника)
    expect(interceptorCount(w, ic)).toBe(3);
    expect(() => orderInterceptor(econ, w, ic, 'south')).toThrow('уже 3');
    const poor = createEconomy();
    poor.money = 199;
    const w2 = createWorkshop();
    expect(() => orderInterceptor(poor, w2, createIntercept(), 'south')).toThrow();
    expect(w2.queue).toEqual([]);
    expect(poor.money).toBe(199);
  });

  it('після 48 тіків — перехоплювач 2 в ангарі регіону, не на складі; черга йде далі', () => {
    const econ = createEconomy();
    econ.money = 10_000;
    const geo = createGeoGame({ seed: 1 });
    const w = createWorkshop();
    const ic = createIntercept();
    orderInterceptor(econ, w, ic, 'south');
    for (let t = 0; t < INTERCEPTOR_TICKS - 1; t++) workshopTick(w, ic, geo);
    expect(ic.fighters).toHaveLength(1);
    workshopTick(w, ic, geo);
    expect(ic.fighters[1]).toMatchObject({ id: 2, region: 'south', pos: HANGARS.south, status: 'на базі', hp: FIGHTER_MAX_HP });
    expect(w.queue).toEqual([]);
    expect(w.log.at(-1)).toEqual({ type: 'interceptor_produced', fighter: 2, region: 'south' });
    expect(Object.values(w.store).every((n) => n === 0)).toBe(true);
  });

  it('готовий перехоплювач без стану перехоплення — помилка (виклик до п19.3)', () => {
    const w = createWorkshop();
    w.queue.push({ id: 'interceptor', ticksLeft: 1, region: 'east' });
    expect(() => workshopTick(w)).toThrow('потрібні');
    expect(w.queue).toEqual([{ id: 'interceptor', ticksLeft: 1, region: 'east' }]); // аудит PR #522: не губиться
  });

  it('addFighter понад три — відмова', () => {
    const geo = createGeoGame({ seed: 1 });
    const ic = createIntercept();
    addFighter(ic, geo, 'east');
    addFighter(ic, geo, 'east');
    expect(ic.fighters.map((f) => f.id)).toEqual([1, 2, 3]);
    expect(() => addFighter(ic, geo, 'west')).toThrow();
  });
});

describe('п19.3: погоня обраним перехоплювачем (EARS 6)', () => {
  it('погоня стартує з ангара обраного, повернення — туди; події з номером і ангаром', () => {
    const geo = geoWith(mkProbe('u1', { x: 15, y: 4 }, { x: 15, y: 0 }));
    const ic = twoFighters(geo, 'east');
    startIntercept(ic, geo, 'u1', 2);
    const f2 = fighterById(ic, 2);
    expect(f2.status).toBe('погоня');
    expect(ic.fighters[0].status).toBe('на базі');
    expect(ic.log[0]).toMatchObject({ type: 'intercept_start', fighter: 2, region: 'east' });
    interceptTick(ic, geo);
    expect(ic.log[1]).toMatchObject({ type: 'intercept_move', from: HANGARS.east, fighter: 2 });
    expect(f2.status).toBe('бій');
    interceptRound(ic, geo, 'відступ');
    expect(f2.pos).toEqual(HANGARS.east);
    expect(ic.log.at(-1)).toEqual({ type: 'fighter_returned', pos: HANGARS.east, minute: geo.minute, fighter: 2, region: 'east' });
  });

  it('на один зонд — один перехоплювач; невідомий перехоплювач — помилка', () => {
    const geo = geoWith(mkProbe('u1', { x: 3, y: 3 }));
    const ic = twoFighters(geo);
    startIntercept(ic, geo, 'u1', 1);
    expect(() => startIntercept(ic, geo, 'u1', 2)).toThrow('інший перехоплювач');
    expect(() => startIntercept(ic, geo, 'u1', 9)).toThrow('Немає перехоплювача');
  });

  it('бій одночасно — один: друга погоня чекає на місці, доки бій не скінчиться', () => {
    // перехоплювач 1 з вузла (8, 4) до (9, 4) — бій з першого тіку; 2 з (13, 4) до (2, 4) — далеко
    const geo = geoWith(mkProbe('near', { x: 9, y: 4 }), mkProbe('far', { x: 2, y: 4 }));
    const ic = twoFighters(geo);
    startIntercept(ic, geo, 'near', 1);
    startIntercept(ic, geo, 'far', 2);
    interceptTick(ic, geo);
    expect(fighterInBattle(ic)?.id).toBe(1);
    const at = { ...fighterById(ic, 2).pos };
    const moves = ic.log.filter((e) => e.type === 'intercept_move' && e.fighter === 2).length;
    interceptTick(ic, geo);
    interceptTick(ic, geo);
    expect(fighterById(ic, 2).pos).toEqual(at); // чекає
    expect(ic.log.filter((e) => e.type === 'intercept_move' && e.fighter === 2).length).toBe(moves);
    interceptRound(ic, geo, 'відступ'); // бій 1 скінчився
    expect(ic.activeProbeId).toBeNull();
    expect(fighterById(ic, 2).status).toBe('погоня');
    interceptTick(ic, geo);
    expect(fighterById(ic, 2).pos).not.toEqual(at);
  });

  it('другий у тому ж тіку не входить у бій, поки триває перший', () => {
    const geo = geoWith(mkProbe('a', { x: 9, y: 4 }), mkProbe('b', { x: 14, y: 4 }));
    const ic = twoFighters(geo);
    startIntercept(ic, geo, 'a', 1);
    startIntercept(ic, geo, 'b', 2);
    interceptTick(ic, geo);
    expect(ic.fighters.filter((f) => f.status === 'бій').map((f) => f.id)).toEqual([1]);
    expect(ic.activeProbeId).toBe('a');
  });

  it('раунд — перехоплювача в бою: його HP і його модуль', () => {
    const geo = geoWith(mkProbe('u1', { x: 14, y: 4 }));
    const ic = twoFighters(geo);
    const w = createWorkshop();
    w.store['gun-module'] = 1;
    installGunModule(w, ic, 2);
    expect(w.log.at(-1)).toEqual({ type: 'gun_module_installed', fighter: 2 });
    expect(ic.fighters[0].gunModule).toBeUndefined();
    ic.rng = () => 0; // влучають обидва, урон — мінімальний
    startIntercept(ic, geo, 'u1', 2);
    interceptTick(ic, geo);
    expect(() => installGunModule(w, ic, 2)).toThrow('лише в ангарі «Схід»: перехоплювач у польоті'); // аудит PR #522
    interceptRound(ic, geo, 'впритул');
    const round = ic.log.find((e) => e.type === 'intercept_round');
    expect(round).toMatchObject({ fighterDamage: 4, probeDamage: 1, fighter: 2 }); // 2 + модуль 2
    expect(fighterById(ic, 2).hp).toBe(FIGHTER_MAX_HP - 1);
    expect(ic.fighters[0].hp).toBe(FIGHTER_MAX_HP);
    expect(() => removeGunModule(w, ic, 1)).toThrow('не встановлено');
  });

  it('пошкоджений до нуля — авторемонт саме цього перехоплювача', () => {
    const geo = geoWith({ ...mkProbe('u1', { x: 14, y: 4 }), kind: 'збирач' }); // HP 5 — не збити одним раундом
    const ic = twoFighters(geo);
    const econ = createEconomy();
    startIntercept(ic, geo, 'u1', 2);
    interceptTick(ic, geo);
    fighterById(ic, 2).hp = 1;
    ic.rng = () => 0.5; // впритул: обидва влучають; зонд 5 − 3 > 0, перехоплювач 1 − 2 → 0
    interceptRound(ic, geo, 'впритул', econ);
    expect(fighterById(ic, 2).status).toBe('ремонт');
    expect(ic.fighters[0].status).toBe('на базі');
    expect(ic.log.filter((e) => e.type === 'fighter_repair_start')).toEqual([
      { type: 'fighter_repair_start', minute: geo.minute, fighter: 2 },
    ]);
  });
});

describe('п19.3: ремонт на кожен окремо', () => {
  it('ремонт двох — кожен своїм лічильником, подія з номером; без id — перший', () => {
    const geo = createGeoGame({ seed: 1, spawnChance: 0 });
    const ic = twoFighters(geo, 'west');
    const econ = createEconomy();
    ic.fighters[0].hp = 1;
    fighterById(ic, 2).hp = 2;
    startRepair(ic, geo, econ);
    for (let t = 0; t < 5; t++) repairTick(ic, geo);
    startRepair(ic, geo, econ, 2);
    expect(fighterById(ic, 2).pos).toEqual(HANGARS.west);
    for (let t = 0; t < FIGHTER_REPAIR_TICKS - 5; t++) repairTick(ic, geo);
    expect(ic.fighters[0]).toMatchObject({ status: 'на базі', hp: FIGHTER_MAX_HP });
    expect(fighterById(ic, 2)).toMatchObject({ status: 'ремонт', repairTicksLeft: 5 });
    for (let t = 0; t < 5; t++) repairTick(ic, geo);
    expect(fighterById(ic, 2)).toMatchObject({ status: 'на базі', hp: FIGHTER_MAX_HP });
    expect(ic.log.filter((e) => e.type === 'fighter_repair_done').map((e) => e.fighter)).toEqual([1, 2]);
  });
});

describe('п19.3: перепризначення (EARS 6)', () => {
  it('лише «на базі», миттєве, у будь-який регіон; подія з напрямком', () => {
    const geo = geoWith(mkProbe('u1', { x: 3, y: 3 }));
    const ic = createIntercept();
    assignFighter(ic, geo, 1, 'south');
    expect(ic.fighters[0]).toMatchObject({ region: 'south', pos: HANGARS.south });
    expect(ic.log.at(-1)).toEqual({ type: 'fighter_assigned', from: 'north', to: 'south', minute: geo.minute }); // один — без номера
    expect(() => assignFighter(ic, geo, 1, 'south')).toThrow('уже в цьому ангарі');
    startIntercept(ic, geo, 'u1');
    expect(ic.log.at(-1)).toMatchObject({ type: 'intercept_start' });
    expect(ic.fighters[0].pos).toEqual(HANGARS.south);
    expect(() => assignFighter(ic, geo, 1, 'east')).toThrow('лише перехоплювач на базі');
    expect(() => startIntercept(ic, geo, 'u1')).toThrow('не в ангарі «Південь»'); // аудит PR #522
    expect(() => startRepair(ic, geo, createEconomy())).toThrow('лише в ангарі «Південь»');
    ic.fighters[0].status = 'ремонт';
    expect(() => assignFighter(ic, geo, 1, 'east')).toThrow('лише перехоплювач на базі');
  });

  it('кілька в одному ангарі; з двома — подія з номером; повернення в «Північ» — у вузол', () => {
    const geo = createGeoGame({ seed: 1, spawnChance: 0 });
    const ic = twoFighters(geo, 'east');
    assignFighter(ic, geo, 1, 'east');
    expect(ic.fighters.map((f) => f.region)).toEqual(['east', 'east']);
    expect(ic.log.at(-1)).toMatchObject({ fighter: 1, from: 'north', to: 'east' });
    assignFighter(ic, geo, 2, 'north');
    expect(fighterById(ic, 2).pos).toEqual(geo.base);
  });
});

describe('п19.3: сейв v4 з переліком перехоплювачів (EARS 7)', () => {
  function threeFighters(): ReturnType<typeof createParty> {
    const p = createParty(42);
    p.econ.money = 10_000;
    orderInterceptor(p.econ, p.workshop, p.intercept, 'east');
    for (let t = 0; t < INTERCEPTOR_TICKS; t++) workshopTick(p.workshop, p.intercept, p.geo);
    orderInterceptor(p.econ, p.workshop, p.intercept, 'west');
    workshopTick(p.workshop, p.intercept, p.geo);
    fighterById(p.intercept, 2).gunModule = true;
    return p;
  }

  it('сейв v4 — усі перехоплювачі і замовлення перехоплювача; лоад байт-у-байт', () => {
    const p = threeFighters();
    const json = serializeParty(p);
    const raw = JSON.parse(json);
    expect(raw.state.intercept.fighter).toBeUndefined();
    expect(raw.state.intercept.fighters.map((f: { id: number }) => f.id)).toEqual([1, 2]);
    const q = deserializeParty(json);
    expect(q.intercept.fighters).toEqual(p.intercept.fighters);
    expect(q.workshop.queue).toEqual([{ id: 'interceptor', ticksLeft: INTERCEPTOR_TICKS - 1, region: 'west' }]);
    expect(serializeParty(q)).toBe(json);
    for (let t = 0; t < INTERCEPTOR_TICKS; t++) workshopTick(q.workshop, q.intercept, q.geo);
    expect(q.intercept.fighters.map((f) => [f.id, f.region])).toEqual([
      [1, 'north'],
      [2, 'east'],
      [3, 'west'],
    ]);
  });

  it('один перехоплювач старого вигляду (v1–v3, v4 до п19.3) — id 1, «Північ», чинний стан', () => {
    const p = createParty(42);
    p.intercept.fighters[0].hp = 2;
    p.intercept.fighters[0].gunModule = true;
    const raw = JSON.parse(serializeParty(p));
    const [one] = raw.state.intercept.fighters;
    delete one.id;
    delete one.region;
    raw.state.intercept.fighter = one;
    delete raw.state.intercept.fighters;
    for (const version of [4, 3, 2]) {
      const q = deserializeParty(JSON.stringify({ ...raw, version }));
      expect(q.intercept.fighters).toEqual([{ ...one, id: 1, region: 'north' }]);
    }
  });

  it('перелік у сейві v1–v3 не читається — лише перший запис як один перехоплювач', () => {
    const raw = JSON.parse(serializeParty(threeFighters()));
    raw.state.workshop.queue = [];
    const q = deserializeParty(JSON.stringify({ ...raw, version: 3 }));
    expect(q.intercept.fighters.map((f) => f.id)).toEqual([1]);
  });

  it('зіпсований перелік чи замовлення — відмова', () => {
    const good = JSON.parse(serializeParty(threeFighters()));
    const cases: [string, (s: typeof good) => void, string][] = [
      ['порожній', (s) => (s.state.intercept.fighters = []), 'перехоплення'],
      [
        'чотири',
        (s) => s.state.intercept.fighters.push({ ...s.state.intercept.fighters[1], id: 3 }, { ...s.state.intercept.fighters[1], id: 4 }),
        'перехоплення',
      ],
      ['повтор id', (s) => (s.state.intercept.fighters[1].id = 1), 'перехоплення'],
      ['не за зростанням', (s) => s.state.intercept.fighters.reverse(), 'перехоплення'],
      ['невідомий регіон', (s) => (s.state.intercept.fighters[1].region = 'центр'), 'перехоплення'],
      ['невідомий стан', (s) => (s.state.intercept.fighters[1].status = 'політ'), 'перехоплення'],
      ['HP понад макс.', (s) => (s.state.intercept.fighters[1].hp = 5), 'перехоплення'],
      ['двоє в бою', (s) => s.state.intercept.fighters.forEach((f: { status: string }) => (f.status = 'бій')), 'перехоплення'],
      ['не перелік', (s) => (s.state.intercept.fighters = { 0: 1 }), 'перехоплення'],
      ['id понад 3', (s) => (s.state.intercept.fighters[1].id = 5), 'перехоплення'],
      [
        'двоє на один зонд',
        (s) =>
          s.state.intercept.fighters.forEach((f: { status: string; targetId: string }) => ((f.status = 'погоня'), (f.targetId = 'probe1'))),
        'перехоплення',
      ],
      ['бій без активного зонда', (s) => (s.state.intercept.fighters[1].status = 'бій'), 'перехоплення'],
      ['активний зонд без бою', (s) => (s.state.intercept.activeProbeId = 'probe1'), 'перехоплення'],
      ['клітинка поза світом', (s) => (s.state.intercept.fighters[1].pos = { x: 16, y: 0 }), 'перехоплення'],
      ['ремонт без лічильника', (s) => (s.state.intercept.fighters[1].status = 'ремонт'), 'перехоплення'],
      [
        'лічильник рядком',
        (s) => Object.assign(s.state.intercept.fighters[1], { status: 'ремонт', repairTicksLeft: 'багато' }),
        'перехоплення',
      ],
      ['лічильник без ремонту', (s) => (s.state.intercept.fighters[1].repairTicksLeft = 3), 'перехоплення'],
      ['замовлення без регіону', (s) => delete s.state.workshop.queue[0].region, 'Кузня'],
      ['понад три з замовленими', (s) => s.state.workshop.queue.push({ ...s.state.workshop.queue[0] }), 'Кузня'],
      ['замовлення у v3', (s) => (s.version = 3), 'Кузня'],
    ];
    for (const [name, spoil, what] of cases) {
      const s = structuredClone(good);
      spoil(s);
      expect(() => deserializeParty(JSON.stringify(s)), name).toThrow('Пошкоджені дані збереження: ' + what);
    }
  });
});
