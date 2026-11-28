// п22.5 (ADR-0187): техноманти зі спеціалізацією й рівнем, модулі бази, казан алхіміка,
// «Стимулятор» і «Щит» у бою, сейв v5 з необов'язковими полями (EARS 4, 5, 7).
import { describe, expect, it } from 'vitest';
import {
  RIFLE,
  STIM_AP_BONUS,
  createGame,
  endTurn,
  makeUnit,
  resolveAttack,
  stimBlock,
  throwGrenade,
  useStim,
  type GameMap,
  type GameState,
  type RNG,
  type Unit,
} from './combat';
import { makeEnemy } from './enemies';
import { createEconomy, type EconomyState } from './economy';
import { advanceTime, createGeoGame } from './geo';
import {
  BASE_LAB_SLOTS,
  LEVEL_THRESHOLDS,
  bestLevel,
  createResearch,
  hireScientist,
  researchTick,
  scientistLevel,
  scientistPoints,
  startProject,
  type ResearchState,
  type Scientist,
} from './research';
import { MODULES, buyModule, createModules, forgeTicks, modulePrice, type BaseModules } from './base';
import {
  BREW_IDS,
  WORKSHOP_CATALOG,
  brewItem,
  canBrew,
  createWorkshop,
  deployConsumables,
  equipItem,
  orderInterceptor,
  orderItem,
  removeLostEquipment,
  settleConsumables,
  unequipItem,
  workshopTick,
  INTERCEPTOR_TICKS,
} from './workshop';
import { createIntercept } from './intercept';
import { makeSoldier } from './mission';
import { createParty, deserializeParty, serializeParty } from './save';

const rich = (money = 10_000): EconomyState => ({ ...createEconomy('норма'), money });
const openMap = (w = 12, h = 12): GameMap => ({ width: w, height: h, blocked: new Set() });
function seq(...xs: number[]): RNG {
  let i = 0;
  return () => xs[i++ % xs.length];
}
const sci = (spec: Scientist['spec'], done = 0, id = 'в1'): Scientist => ({ id, name: 'Зінаїда', spec, done });
function staff(...list: Scientist[]): ResearchState {
  const r = createResearch();
  r.scientists.push(...list);
  return r;
}

describe('п22.5: техноманти — спеціалізація при наймі й рівень (EARS 4)', () => {
  it('найм зі спеціалізацією; без аргументу — «Дослідник»; невідома — throw без оплати', () => {
    const econ = rich();
    const r = createResearch();
    expect(hireScientist(econ, r, 'норма', 'alchemist')).toEqual({ id: 'в1', name: 'Зінаїда', spec: 'alchemist', done: 0 });
    expect(hireScientist(econ, r).spec).toBe('researcher');
    const money = econ.money;
    expect(() => hireScientist(econ, r, 'норма', 'bard' as never)).toThrow('Невідома спеціалізація техноманта: bard');
    expect(econ.money).toBe(money);
    expect(r.scientists).toHaveLength(2);
  });

  it('рівень 1–3 за протоколи в штаті: 0–1 → 1, 2–4 → 2, від 5 → 3', () => {
    expect(LEVEL_THRESHOLDS).toEqual([0, 2, 5]);
    expect([0, 1, 2, 4, 5, 9].map((done) => scientistLevel({ done }))).toEqual([1, 1, 2, 2, 3, 3]);
  });

  it('очки за добу: дослідник — за рівнем, алхімік і механік — по 1', () => {
    expect([0, 2, 5].map((d) => scientistPoints(sci('researcher', d)))).toEqual([1, 2, 3]);
    expect([0, 5].map((d) => scientistPoints(sci('alchemist', d)))).toEqual([1, 1]);
    expect(scientistPoints(sci('mechanic', 5))).toBe(1);
  });

  it('завершений протокол — +1 done усьому штату; найнятий пізніше починає з 0', () => {
    const econ = rich();
    const r = staff(sci('researcher', 1, 'в1'), sci('mechanic', 0, 'в2'));
    r.hired = 2;
    r.pool = 14;
    startProject(econ, r, 'armor'); // 14 очок — завершується одразу з пулу
    expect(r.scientists.map((s) => s.done)).toEqual([2, 1]);
    expect(scientistLevel(r.scientists[0])).toBe(2);
    expect(hireScientist(econ, r).done).toBe(0);
  });

  it('researchTick: потік — сума очок штату (дослідник рівня 3 + алхімік = 4)', () => {
    const econ = rich();
    const r = staff(sci('researcher', 5, 'в1'), sci('alchemist', 0, 'в2'));
    const geo = createGeoGame({ seed: 1 });
    advanceTime(geo, 48);
    researchTick(r, econ, geo);
    expect(r.log.filter((e) => e.type === 'points')).toEqual([{ type: 'points', day: 1, amount: 4 }]);
    expect(r.pool).toBe(4);
  });

  it('bestLevel — найвищий рівень спеціалізації, 0 без неї', () => {
    const r = staff(sci('mechanic', 0, 'в1'), sci('mechanic', 5, 'в2'), sci('alchemist', 2, 'в3'));
    expect([bestLevel(r, 'mechanic'), bestLevel(r, 'alchemist'), bestLevel(r, 'researcher')]).toEqual([3, 2, 0]);
  });
});

describe('п22.5: модулі бази (EARS 5; рішення власника «А. Протокол + три модулі»)', () => {
  it('ціни рівнів і множник пресета; найвищий рівень — throw без оплати', () => {
    const m = createModules();
    expect(MODULES.stand.prices).toEqual([160]);
    expect(MODULES.boiler.prices).toEqual([120, 200]);
    expect(MODULES.cauldron.prices).toEqual([100, 180]);
    expect(modulePrice(m, 'boiler', 'легкий')).toBe(60); // науковий множник «легкого» ×0,5
    const econ = rich(1000);
    const r = createResearch();
    expect(buyModule(econ, r, m, 'boiler')).toBe(1);
    expect(buyModule(econ, r, m, 'boiler')).toBe(2);
    expect(econ.money).toBe(1000 - 120 - 200);
    expect(modulePrice(m, 'boiler')).toBeUndefined();
    expect(() => buyModule(econ, r, m, 'boiler')).toThrow('Модуль уже на найвищому рівні: Паровий котел');
    expect(econ.money).toBe(680);
    expect(r.log).toEqual([
      { type: 'module', id: 'boiler', level: 1 },
      { type: 'module', id: 'boiler', level: 2 },
    ]);
  });

  it('бракує кредитів чи невідомий модуль — throw, стан не змінюється', () => {
    const m = createModules();
    const econ = rich(50);
    const r = createResearch();
    expect(() => buyModule(econ, r, m, 'cauldron')).toThrow();
    expect(() => buyModule(econ, r, m, 'lab' as never)).toThrow('Невідомий модуль бази: lab');
    expect(m).toEqual(createModules());
    expect(econ.money).toBe(50);
  });

  it('«Стенд» — четвертий слот: лише після «Розширення лабораторії» (2 → 3 → 4)', () => {
    const econ = rich();
    const r = createResearch();
    const m = createModules();
    expect(() => buyModule(econ, r, m, 'stand')).toThrow('спершу протокол «Розширення лабораторії»');
    expect([m.stand, econ.money]).toEqual([0, 10_000]);
    r.pool = 33;
    startProject(econ, r, 'lab-extension');
    expect(r.slots).toBe(BASE_LAB_SLOTS + 1);
    buyModule(econ, r, m, 'stand');
    expect(r.slots).toBe(BASE_LAB_SLOTS + 2);
  });

  it('forgeTicks: котел −20 % за рівень, механік −10 % за рівень, вгору, не менше 1', () => {
    const m: BaseModules = { ...createModules(), boiler: 2 };
    expect(forgeTicks(24)).toBe(24);
    expect(forgeTicks(24, createResearch(), createModules())).toBe(24);
    expect(forgeTicks(24, undefined, m)).toBe(15); // 24 × 0,6 = 14,4 → 15
    expect(forgeTicks(24, staff(sci('mechanic', 5)))).toBe(17); // × 0,7 = 16,8 → 17
    expect(forgeTicks(48, staff(sci('mechanic', 5)), m)).toBe(15); // × 0,3 = 14,4 → 15
    expect(forgeTicks(1, staff(sci('mechanic', 5)), m)).toBe(1);
    expect(forgeTicks(24, staff(sci('alchemist', 5)))).toBe(24); // лише механік
  });

  it('orderItem і orderInterceptor беруть тики з котлом і механіком', () => {
    const econ = rich();
    const w = createWorkshop();
    const r = staff(sci('mechanic', 2));
    r.completed.push('armor');
    const m: BaseModules = { ...createModules(), boiler: 1 };
    expect(orderItem(econ, w, r, 'armor', 'норма', m).ticksLeft).toBe(15); // котел I + механік рівня 2: 24 × 0,6 = 14,4
    expect(w.log.at(-1)).toEqual({ type: 'order', id: 'armor', ticks: 15 });
    const ic = createIntercept(1);
    expect(orderInterceptor(econ, w, ic, 'north', 'норма', r, m).ticksLeft).toBe(29); // 48 × 0,6 = 28,8
    expect(orderInterceptor(econ, w, ic, 'north').ticksLeft).toBe(INTERCEPTOR_TICKS);
  });
});

describe('п22.5: казан алхіміка — «Стимулятор» і «Щит» (EARS 5)', () => {
  const ready = (level: number, cauldron = 1): { econ: EconomyState; r: ResearchState; m: BaseModules } => {
    const r = staff(sci('alchemist', LEVEL_THRESHOLDS[level - 1]));
    r.trophies.demon = 5;
    r.trophies.hound = 5;
    return { econ: rich(), r, m: { ...createModules(), cauldron } };
  };

  it('каталог: ціна, тики, трофеї; «Кузня» їх не замовляє', () => {
    expect(BREW_IDS).toEqual(['stim', 'shield', 'elixir']); // п22.7: + «Еліксир чемпіона»
    expect(WORKSHOP_CATALOG.stim).toMatchObject({ name: 'Стимулятор', cost: 30, ticks: 12, trophies: { demon: 1 } });
    expect(WORKSHOP_CATALOG.shield).toMatchObject({ name: 'Щит', cost: 40, ticks: 16, trophies: { hound: 1 } });
    expect(() => orderItem(rich(), createWorkshop(), createResearch(), 'stim')).toThrow(
      '«Стимулятор» варить «Казан алхіміка», а не «Кузня»'
    );
  });

  it('без казана, без алхіміка, рівень для «Щита» — throw без оплати', () => {
    const w = createWorkshop();
    const a = ready(1, 0);
    expect(() => brewItem(a.econ, w, a.r, a.m, 'stim')).toThrow('Немає модуля «Казан алхіміка»');
    const b = ready(1);
    b.r.scientists[0].spec = 'mechanic';
    expect(() => brewItem(b.econ, w, b.r, b.m, 'stim')).toThrow('Немає алхіміка в штаті');
    const c = ready(1);
    expect(canBrew(c.r, c.m, 'shield')).toBe(false);
    expect(() => brewItem(c.econ, w, c.r, c.m, 'shield')).toThrow('«Щит» варить алхімік рівня 2');
    c.r.trophies.demon = 0;
    expect(() => brewItem(c.econ, w, c.r, c.m, 'stim')).toThrow('Бракує трофеїв: демон 0 з 1');
    expect(c.econ.money).toBe(10_000);
    expect(w.brew).toEqual([]);
    expect(() => brewItem(c.econ, w, c.r, c.m, 'medkit' as never)).toThrow('Невідомий рецепт казана: medkit');
  });

  it('варіння: оплата й трофеї одразу, окрема черга від «Кузні», готове — на склад', () => {
    const { econ, r, m } = ready(2);
    const w = createWorkshop();
    expect(canBrew(r, m, 'shield')).toBe(true);
    r.completed.push('armor');
    orderItem(econ, w, r, 'armor');
    brewItem(econ, w, r, m, 'shield');
    expect(econ.money).toBe(10_000 - 60 - 40);
    expect(r.trophies.hound).toBe(4);
    expect(w.log.at(-1)).toEqual({ type: 'brew', id: 'shield', ticks: 16, count: 1 });
    for (let k = 0; k < 16; k++) workshopTick(w);
    expect(w.store.shield).toBe(1);
    expect(w.queue).toHaveLength(1); // «Кузня» йде своєю чергою
    expect(w.log.at(-1)).toEqual({ type: 'brewed', id: 'shield', count: 1 });
  });

  it('алхімік рівня 3 — удвічі менше тиків; казан II — дві порції', () => {
    const { econ, r, m } = ready(3, 2);
    const w = createWorkshop();
    expect(brewItem(econ, w, r, m, 'stim')).toEqual({ id: 'stim', ticksLeft: 6, count: 2 });
    for (let k = 0; k < 6; k++) workshopTick(w);
    expect(w.store.stim).toBe(2);
    expect(w.brew).toEqual([]);
  });

  it('спорядження: на бійця, у бій, невикористаний лишається, використаний зникає, загиблий — втрачено', () => {
    const w = createWorkshop();
    w.store.stim = 2;
    w.store.shield = 2;
    const a = makeSoldier('s1', 'А');
    const b = makeSoldier('s2', 'Б');
    for (const s of [a, b]) {
      equipItem(w, s, 'stim');
      equipItem(w, s, 'shield');
    }
    expect(() => equipItem(w, a, 'stim')).toThrow();
    const items = deployConsumables(w, [a, b]);
    expect(items.s1).toEqual({ medkit: false, grenade: false, stim: true, shield: true });
    items.s1.stim = false; // використав
    settleConsumables(w, [a], items);
    expect(w.equipped.s1).toEqual({ armor: false, optics: false, medkit: false, grenade: false, shield: true });
    removeLostEquipment(w, [b]);
    expect(w.log.at(-1)).toEqual({ type: 'equipment_lost', soldierId: 's2', items: ['stim', 'shield'] });
    unequipItem(w, a, 'shield');
    expect(w.equipped.s1).toBeUndefined();
    expect(w.store.shield).toBe(1);
  });
});

describe('п22.5: «Стимулятор» і «Щит» у бою (рішення власника «А. Дія + пасивний щит»)', () => {
  const soldier = (): Unit => makeUnit({ id: 's1', side: 'player', pos: { x: 1, y: 1 }, firingAccuracy: 0.9, weapon: RIFLE });
  const fight = (rng: RNG, items = { stim: true, shield: true }, enemyFirst = false): GameState =>
    createGame({
      map: openMap(),
      units: [soldier(), makeEnemy('demon', 'a1', 0, { x: 4, y: 1 })],
      rng,
      items: { s1: { medkit: false, grenade: true, ...items } },
      startingSide: enemyFirst ? 'alien' : 'player',
    });

  it('«Стимулятор»: +3 AP за 0 AP понад максимум, один на бій; RNG не витягає', () => {
    let calls = 0;
    const st = fight(() => (calls++, 0.5));
    expect(stimBlock(st, 's1')).toBeUndefined();
    useStim(st, 's1');
    expect(STIM_AP_BONUS).toBe(3);
    expect(st.units[0].ap).toBe(13);
    expect(calls).toBe(0);
    expect(st.log.at(-1)).toEqual({ type: 'stim', unitId: 's1', bonus: 3 });
    expect(stimBlock(st, 's1')).toBe('Стимулятора немає у юніта');
    expect(() => useStim(st, 's1')).toThrow('Стимулятора немає у юніта: s1');
    endTurn(st);
    expect(stimBlock(st, 's1')).toBe('Зараз не хід цього юніта');
    expect(stimBlock(st, 'nobody')).toBe('Юніта немає в бою');
  });

  it('«Щит»: перше влучання — шкода 0, мітка перед пострілом; друге — повна шкода; кидки ті самі', () => {
    const st = fight(seq(0, 0.5), { stim: false, shield: true }, true);
    const first = resolveAttack(st, 'a1', 's1', 'snap').shots;
    expect(first).toEqual([{ hit: true, damage: 0 }]);
    expect(st.units[0].hp).toBe(10);
    expect(st.items?.s1.shield).toBe(false);
    const at = st.log.findIndex((e) => e.type === 'shield');
    expect(st.log[at]).toEqual({ type: 'shield', unitId: 's1' });
    expect(st.log[at + 1]).toMatchObject({ type: 'shot', targetId: 's1', hit: true, damage: 0 });
    const second = resolveAttack(st, 'a1', 's1', 'snap').shots;
    expect(second[0].damage).toBeGreaterThan(0);
    // без щита — та сама шкода першим пострілом (RNG не зсувається)
    const bare = fight(seq(0, 0.5), { stim: false, shield: false }, true);
    expect(resolveAttack(bare, 'a1', 's1', 'snap').shots[0].damage).toBe(second[0].damage);
  });

  it('промах щита не витрачає; граната (і своя) — поглинає', () => {
    const st = fight(seq(0.99), { stim: false, shield: true }, true);
    resolveAttack(st, 'a1', 's1', 'snap');
    expect(st.items?.s1.shield).toBe(true);
    const g = fight(seq(0.5), { stim: false, shield: true });
    const res = throwGrenade(g, 's1', { x: 1, y: 2 });
    expect(res.affected).toEqual(['s1']);
    expect(g.units[0].hp).toBe(10);
    expect(g.log.at(-1)).toMatchObject({ type: 'grenade', hits: [{ unitId: 's1', damage: 0 }] });
    expect(g.items?.s1.shield).toBe(false);
  });

  it('граната: події щитів — до смертей (серія смертей і вибух рендера не рвуться, аудит PR #551)', () => {
    const g = createGame({
      map: openMap(),
      units: [
        makeUnit({ id: 's1', side: 'player', pos: { x: 1, y: 1 } }),
        makeUnit({ id: 'a1', side: 'alien', pos: { x: 4, y: 4 }, hp: 1, maxHp: 1 }),
        makeUnit({ id: 's2', side: 'player', pos: { x: 4, y: 5 } }),
      ],
      rng: seq(0.5),
      items: { s1: { medkit: false, grenade: true }, s2: { medkit: false, grenade: false, shield: true } },
    });
    throwGrenade(g, 's1', { x: 4, y: 4 });
    expect(g.log.map((e) => e.type)).toEqual(['shield', 'death', 'grenade']);
    expect(g.log.at(-1)).toMatchObject({ hits: [{ unitId: 'a1' }, { unitId: 's2', damage: 0 }] });
  });
});

describe('п22.5: сейв v5 — техноманти, модулі, казан (EARS 7)', () => {
  it('збереження й завантаження без втрат', () => {
    const p = createParty(7);
    hireScientist(p.econ, p.research, 'норма', 'alchemist');
    p.research.scientists[0].done = 3;
    buyModule(p.econ, p.research, p.modules, 'cauldron');
    p.research.trophies.demon = 1;
    brewItem(p.econ, p.workshop, p.research, p.modules, 'stim');
    const json = serializeParty(p);
    const q = deserializeParty(json);
    expect(q.research.scientists).toEqual([{ id: 'в1', name: 'Зінаїда', spec: 'alchemist', done: 3 }]);
    expect(q.modules).toEqual({ stand: 0, boiler: 0, cauldron: 1 });
    expect(q.workshop.brew).toEqual([{ id: 'stim', ticksLeft: 12 }]);
    expect(serializeParty(q)).toBe(json);
  });

  it('сейв без нових полів (v4): дослідники рівня 1, модулів немає, казан порожній', () => {
    const p = createParty(7);
    hireScientist(p.econ, p.research);
    const data = JSON.parse(serializeParty(p));
    data.version = 4;
    data.state.research.scientists = [{ id: 'в1', name: 'Зінаїда' }];
    delete data.state.modules;
    delete data.state.workshop.brew;
    for (const k of ['stim', 'shield']) delete data.state.workshop.store[k];
    const q = deserializeParty(JSON.stringify(data));
    expect(q.research.scientists).toEqual([{ id: 'в1', name: 'Зінаїда', spec: 'researcher', done: 0 }]);
    expect(scientistLevel(q.research.scientists[0])).toBe(1);
    expect(q.modules).toEqual(createModules());
    expect(q.workshop.brew).toEqual([]);
    expect(q.workshop.store.stim).toBe(0);
  });

  it('пошкоджені поля — відмова', () => {
    type Raw = { state: { research: { scientists: unknown[] }; modules?: unknown; workshop: { brew?: unknown } } };
    const base = (): Raw => JSON.parse(serializeParty(createParty(7))) as Raw;
    const bad = (mut: (d: Raw) => void, msg: string): void => {
      const d = base();
      mut(d);
      expect(() => deserializeParty(JSON.stringify(d))).toThrow(msg);
    };
    bad((d) => (d.state.research.scientists = [{ id: 'в1', name: 'А', spec: 'bard' }]), 'наука');
    bad((d) => (d.state.research.scientists = [{ id: 'в1', name: 'А', done: -1 }]), 'наука');
    bad((d) => (d.state.modules = { boiler: 3 }), 'модулі бази');
    bad((d) => (d.state.modules = { lab: 1 }), 'модулі бази');
    bad((d) => (d.state.modules = []), 'модулі бази');
    bad((d) => (d.state.modules = { stand: 1 }), 'модулі бази'); // «Стенд» без третього слота — слотів 2
    bad((d) => (d.state.workshop.brew = [{ id: 'medkit', ticksLeft: 3 }]), 'Кузня');
  });
});
