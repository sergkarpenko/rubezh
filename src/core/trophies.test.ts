// src/core/trophies.test.ts
// п18.2 (ADR-0153 п. 9–12, ADR-0154; EARS 1–3 Фази 18): трофеї за тип убитого ворога,
// три ключові протоколи з трофеями на вході, «Пробивний заряд», ширший радар.

import { describe, expect, it } from 'vitest';
import {
  RIFLE,
  createGame,
  endTurn,
  makeUnit,
  moveUnit,
  preciseShot,
  resolveAttack,
  setOverwatch,
  type GameMap,
  type GameState,
  type RNG,
  type StatefulRng,
  type Unit,
} from './combat';
import { makeEnemy } from './enemies';
import { createEconomy, type EconomyState } from './economy';
import { advanceTime, createGeoGame, type Ufo } from './geo';
import {
  KEY_PROJECTS,
  PROJECTS,
  PROJECT_CATALOG,
  RADAR_RANGE_BASE,
  RADAR_RANGE_WIDE,
  awardTrophies,
  createResearch,
  emptyTrophies,
  missingTrophies,
  radarRange,
  startProject,
  type ResearchState,
} from './research';
import {
  ITEM_IDS,
  WORKSHOP_CATALOG,
  createWorkshop,
  deployConsumables,
  equipItem,
  equipKeyItem,
  itemUnlocked,
  orderItem,
  removeLostEquipment,
  settleConsumables,
  unequipItem,
  workshopTick,
} from './workshop';
import { makeSoldier } from './mission';
import { createParty, deserializeParty, serializeParty } from './save';

const openMap = (w = 12, h = 12): GameMap => ({ width: w, height: h, blocked: new Set() });
function seq(...xs: number[]): RNG {
  let i = 0;
  return () => xs[i++ % xs.length];
}
const rich = (money = 10_000): EconomyState => ({ ...createEconomy('норма'), money });

function dead(u: Unit): Unit {
  u.alive = false;
  u.hp = 0;
  return u;
}

describe('п18.2: трофеї за виграну місію (ADR-0153 п. 9; EARS 1)', () => {
  const battle = (): Pick<GameState, 'units'> => ({
    units: [
      makeSoldier('s1', 'А'),
      dead(makeEnemy('demon', 'a1', 0, { x: 1, y: 1 })),
      dead(makeEnemy('demon', 'a2', 1, { x: 2, y: 1 })),
      dead(makeEnemy('hound', 'a3', 0, { x: 3, y: 1 })),
      dead(makeEnemy('golem', 'a4', 0, { x: 4, y: 1 })),
      dead(makeSoldier('s2', 'Б')),
    ],
  });

  it('нова наука — нуль трофеїв кожного типу', () => {
    expect(createResearch().trophies).toEqual({ demon: 0, hound: 0, golem: 0, eye: 0 });
    expect(emptyTrophies()).toEqual(createResearch().trophies);
  });

  it('перемога — по трофею за кожного загиблого ворога за типом; свої загиблі не рахуються; подія журналу', () => {
    const r = createResearch();
    expect(awardTrophies(r, battle(), 'перемога')).toEqual({ demon: 2, hound: 1, golem: 1 });
    expect(r.trophies).toEqual({ demon: 2, hound: 1, golem: 1, eye: 0 });
    expect(r.log).toEqual([{ type: 'trophies', gained: { demon: 2, hound: 1, golem: 1 } }]);
    awardTrophies(r, battle(), 'перемога');
    expect(r.trophies).toEqual({ demon: 4, hound: 2, golem: 2, eye: 0 });
  });

  it('поразка й евакуація трофеїв не дають і подій не пишуть', () => {
    for (const outcome of ['поразка', 'евакуйовано', 'триває']) {
      const r = createResearch();
      expect(awardTrophies(r, battle(), outcome)).toEqual({});
      expect(r.trophies).toEqual(emptyTrophies());
      expect(r.log).toEqual([]);
    }
  });

  it('ворог без kind — демон; живий ворог трофея не дає; без загиблих — без події', () => {
    const r = createResearch();
    const plain = dead(makeUnit({ id: 'x1', side: 'alien', pos: { x: 0, y: 0 } }));
    const alive = makeEnemy('eye', 'x2', 0, { x: 1, y: 0 });
    expect(awardTrophies(r, { units: [plain, alive] }, 'перемога')).toEqual({ demon: 1 });
    expect(awardTrophies(r, { units: [alive] }, 'перемога')).toEqual({});
    expect(r.log).toHaveLength(1);
  });
});

describe('п18.2: ключові протоколи (ADR-0153 п. 1, 10; EARS 2)', () => {
  const withTrophies = (t: Partial<ResearchState['trophies']>): ResearchState => {
    const r = createResearch();
    r.trophies = { ...r.trophies, ...t };
    return r;
  };

  it('каталог: три протоколи ланцюжком, ціни, точки й трофеї — кандидати ADR-0153 п. 10', () => {
    expect(KEY_PROJECTS).toEqual([
      { id: 'rift-anatomy', name: 'Анатомія Розриву', cost: 120, points: 20, trophies: { demon: 6, hound: 3 } },
      { id: 'gate-bearing', name: 'Пеленг брами', cost: 160, points: 30, prerequisite: 'rift-anatomy', trophies: { golem: 2, eye: 2 } },
      {
        id: 'gate-key',
        name: 'Ключ брами',
        cost: 200,
        points: 40,
        prerequisite: 'gate-bearing',
        trophies: { demon: 4, hound: 2, golem: 1, eye: 2 },
      },
    ]);
    for (const p of KEY_PROJECTS) expect(PROJECT_CATALOG[p.id]).toBe(p);
    // рішення власника «А. Сховати до п18.5»: панель «Дослідження» ітерує PROJECTS — ключових там немає
    expect(PROJECTS.map((p) => p.id)).toEqual(['armor', 'optics', 'medkit', 'lab-extension', 'grenade', 'gun-module']);
  });

  it('бракує трофеїв — відмова з переліком типів, стан і кредити без змін', () => {
    const econ = rich();
    const r = withTrophies({ demon: 6, hound: 1 });
    expect(() => startProject(econ, r, 'rift-anatomy')).toThrow('Бракує трофеїв: гончак 1 з 3');
    expect(econ.money).toBe(10_000);
    expect(r.trophies).toEqual({ demon: 6, hound: 1, golem: 0, eye: 0 });
    expect(r.active).toEqual([]);
    expect(missingTrophies(emptyTrophies(), PROJECT_CATALOG['gate-key'].trophies)).toBe(
      'Бракує трофеїв: демон 0 з 4, гончак 0 з 2, голем 0 з 1, око 0 з 2'
    );
    expect(missingTrophies(emptyTrophies(), undefined)).toBeUndefined();
  });

  it('старт списує кредити й трофеї разом; надлишок лишається', () => {
    const econ = rich();
    const r = withTrophies({ demon: 7, hound: 3, eye: 1 });
    startProject(econ, r, 'rift-anatomy');
    expect(econ.money).toBe(10_000 - 120);
    expect(r.trophies).toEqual({ demon: 1, hound: 0, golem: 0, eye: 1 });
    expect(r.active).toEqual([{ id: 'rift-anatomy', invested: 0 }]);
  });

  it('бракує кредитів — трофеї не списано', () => {
    const econ = rich(50);
    const r = withTrophies({ demon: 6, hound: 3 });
    expect(() => startProject(econ, r, 'rift-anatomy')).toThrow();
    expect(r.trophies).toEqual({ demon: 6, hound: 3, golem: 0, eye: 0 });
  });

  it('передумова — раніше за трофеї: «Пеленг брами» без «Анатомії Розриву»', () => {
    const r = withTrophies({ golem: 2, eye: 2 });
    expect(() => startProject(rich(), r, 'gate-bearing')).toThrow('Передумову не завершено: Анатомія Розриву');
    r.completed.push('rift-anatomy');
    startProject(rich(), r, 'gate-bearing');
    expect(r.trophies).toEqual(emptyTrophies());
  });

  it('чинні протоколи — без трофеїв, старт як до п18.2', () => {
    const r = createResearch();
    for (const p of PROJECTS) expect(p.trophies).toBeUndefined();
    startProject(rich(), r, 'armor');
    expect(r.trophies).toEqual(emptyTrophies());
  });
});

describe('п18.2: «Пробивний заряд» у «Кузні» (ADR-0153 п. 11; EARS 3)', () => {
  const unlocked = (hound: number): ResearchState => {
    const r = createResearch();
    r.completed.push('rift-anatomy');
    r.trophies.hound = hound;
    return r;
  };

  it('відкриває «Анатомія Розриву»; у панелях до п18.5 не показується', () => {
    expect(itemUnlocked(createResearch(), 'breach-charge')).toBe(false);
    expect(itemUnlocked(unlocked(0), 'breach-charge')).toBe(true);
    expect(itemUnlocked({ completed: ['armor'] }, 'armor')).toBe(true);
    expect(ITEM_IDS).not.toContain('breach-charge');
    expect(() => orderItem(rich(), createWorkshop(), createResearch(), 'breach-charge')).toThrow(
      'Предмет ще не досліджено: Пробивний заряд'
    );
  });

  it('замовлення: кредити й трофей гончака; бракує трофея — відмова без оплати', () => {
    const econ = rich();
    const w = createWorkshop();
    const r0 = unlocked(0);
    expect(() => orderItem(econ, w, r0, 'breach-charge')).toThrow('Бракує трофеїв: гончак 0 з 1');
    expect(econ.money).toBe(10_000);
    expect(w.queue).toEqual([]);
    const r = unlocked(2);
    orderItem(econ, w, r, 'breach-charge');
    expect(econ.money).toBe(10_000 - WORKSHOP_CATALOG['breach-charge'].cost);
    expect(r.trophies.hound).toBe(1);
    for (let i = 0; i < 16; i++) workshopTick(w);
    expect(w.store['breach-charge']).toBe(1);
  });

  it('екіпірування, бій і розрахунок: невитрачений лишається, витрачений зникає, із загиблим — втрачено', () => {
    const w = createWorkshop();
    w.store['breach-charge'] = 3;
    const a = makeSoldier('s1', 'А');
    const b = makeSoldier('s2', 'Б');
    const c = makeSoldier('s3', 'В');
    for (const s of [a, b, c]) equipItem(w, s, 'breach-charge');
    expect(w.equipped.s1).toEqual({ armor: false, optics: false, medkit: false, grenade: false, charge: true });
    const items = deployConsumables(w, [a, b, c]);
    expect(items.s1).toEqual({ medkit: false, grenade: false, charge: true });
    items.s2.charge = false; // витратив у бою
    settleConsumables(w, [a, b], items);
    removeLostEquipment(w, [c]);
    expect(w.equipped).toEqual({ s1: { armor: false, optics: false, medkit: false, grenade: false, charge: true } });
    expect(w.log.at(-1)).toEqual({ type: 'equipment_lost', soldierId: 's3', items: ['charge'] });
    expect(equipKeyItem('charge')).toBe('breach-charge');
    unequipItem(w, a, 'breach-charge');
    expect(w.equipped).toEqual({});
    expect(w.store['breach-charge']).toBe(1);
  });

  it('без заряду запис екіпірування і копія в бій — без поля charge (байт-у-байт як до п18.2)', () => {
    const w = createWorkshop();
    w.store.medkit = 1;
    const a = makeSoldier('s1', 'А');
    equipItem(w, a, 'medkit');
    const items = deployConsumables(w, [a]);
    expect(items).toEqual({ s1: { medkit: true, grenade: false } });
    expect('charge' in items.s1).toBe(false);
    settleConsumables(w, [a], items);
    expect('charge' in w.equipped.s1).toBe(false);
  });
});

describe('п18.2: заряд у бою — «А. Сам на броні» (ADR-0154)', () => {
  const soldier = (): Unit => makeUnit({ id: 's1', side: 'player', pos: { x: 1, y: 1 }, firingAccuracy: 0.9, weapon: RIFLE });
  const fight = (target: Unit, rng: RNG, charge = true): GameState =>
    createGame({ map: openMap(), units: [soldier(), target], rng, items: { s1: { medkit: false, grenade: false, charge } } });

  it('перша атака по голему — без броні, заряд витрачено; друга — з бронею', () => {
    const g = makeEnemy('golem', 'a1', 0, { x: 4, y: 1 });
    const st = fight(g, seq(0, 0.99));
    expect(resolveAttack(st, 's1', 'a1', 'snap').shots).toEqual([{ hit: true, damage: 6 }]);
    expect(st.items?.s1.charge).toBe(false);
    expect(resolveAttack(st, 's1', 'a1', 'snap').shots).toEqual([{ hit: true, damage: 4 }]);
    expect(g.hp).toBe(16 - 6 - 4);
  });

  it('черга — усі кулі без броні; промах теж витрачає заряд', () => {
    const g = makeEnemy('golem', 'a1', 0, { x: 4, y: 1 });
    const st = fight(g, seq(0, 0));
    const shots = resolveAttack(st, 's1', 'a1', 'auto').shots;
    expect(shots.every((s) => s.hit && s.damage === 3)).toBe(true);
    const g2 = makeEnemy('golem', 'a1', 0, { x: 4, y: 1 });
    const st2 = fight(g2, seq(0.99));
    expect(resolveAttack(st2, 's1', 'a1', 'snap').shots).toEqual([{ hit: false, damage: 0 }]);
    expect(st2.items?.s1.charge).toBe(false);
  });

  it('по цілі без броні заряд не витрачається', () => {
    const d = makeEnemy('demon', 'a1', 0, { x: 4, y: 1 });
    const st = fight(d, seq(0, 0.99));
    resolveAttack(st, 's1', 'a1', 'snap');
    expect(st.items?.s1.charge).toBe(true);
  });

  it('без заряду — броня, як у п17.2; RNG той самий', () => {
    const g = makeEnemy('golem', 'a1', 0, { x: 4, y: 1 });
    const st = fight(g, seq(0, 0.99), false);
    expect(resolveAttack(st, 's1', 'a1', 'snap').shots).toEqual([{ hit: true, damage: 4 }]);
  });

  it('«Точний постріл» по голему із зарядом — 6 × 1,5 = 9 без броні', () => {
    const g = makeEnemy('golem', 'a1', 0, { x: 4, y: 1 });
    const st = createGame({
      map: openMap(),
      units: [soldier(), g],
      rng: seq(0, 0.99),
      items: { s1: { medkit: false, grenade: false, charge: true } },
      roles: { s1: { role: 'sniper', used: false } },
    });
    expect(preciseShot(st, 's1', 'a1').shots[0]).toEqual({ hit: true, damage: 9 });
    expect(st.items?.s1.charge).toBe(false);
  });

  it('дозор заряду не бере', () => {
    const g = makeEnemy('golem', 'a1', 0, { x: 4, y: 1 });
    const st = fight(g, seq(0, 0.99));
    setOverwatch(st, 's1');
    endTurn(st);
    moveUnit(st, 'a1', [{ x: 4, y: 2 }]);
    expect(st.log.find((e) => e.type === 'shot')).toMatchObject({ shooterId: 's1', hit: true, damage: 4 });
    expect(st.items?.s1.charge).toBe(true);
  });
});

describe('п18.2: ширший радар (ADR-0153 п. 12; EARS 3)', () => {
  const mk = (id: string, pos: { x: number; y: number }): Ufo => ({
    id,
    kind: 'розвідник',
    detected: false,
    status: 'летить',
    landedTicksLeft: 8,
    pos,
    target: pos,
  });

  it('radarRange: 4, після «Пеленгу брами» — 6', () => {
    expect(RADAR_RANGE_BASE).toBe(4);
    expect(RADAR_RANGE_WIDE).toBe(6);
    expect(radarRange(createResearch())).toBe(4);
    expect(radarRange({ completed: ['rift-anatomy', 'gate-bearing'] })).toBe(6);
  });

  it('зонд за 6 клітинок від бази: радіус 4 — не виявлено, радіус 6 — виявлено', () => {
    for (const [radar, seen] of [
      [4, false],
      [6, true],
    ] as const) {
      const s = createGeoGame({ seed: 1, spawnChance: 0 });
      s.ufos.push(mk('b', { x: s.base.x - 6, y: 0 }));
      advanceTime(s, 1, radar);
      expect(s.ufos[0].detected).toBe(seen);
    }
  });

  it('типовий радіус — байт-у-байт як явні 4; радіус не зсуває geo.rng', () => {
    const a = createGeoGame({ seed: 42 });
    const b = createGeoGame({ seed: 42 });
    const c = createGeoGame({ seed: 42 });
    advanceTime(a, 48 * 12);
    advanceTime(b, 48 * 12, 4);
    advanceTime(c, 48 * 12, 6);
    expect(JSON.stringify(b.log)).toBe(JSON.stringify(a.log));
    expect((a.rng as StatefulRng).state).toBe((c.rng as StatefulRng).state);
    const strip = (log: typeof a.log) => log.filter((e) => e.type !== 'ufo_detected');
    expect(JSON.stringify(strip(c.log))).toBe(JSON.stringify(strip(a.log)));
  });
});

describe('п18.2: сейв — трофеї й заряд (ADR-0154)', () => {
  it('трофеї й заряд на оперативникові — туди й назад', () => {
    const p = createParty(7);
    p.research.trophies = { demon: 3, hound: 1, golem: 0, eye: 2 };
    p.workshop.store['breach-charge'] = 2;
    p.workshop.equipped[p.roster.soldiers[0].id] = { armor: false, optics: false, medkit: false, grenade: false, charge: true };
    const q = deserializeParty(serializeParty(p));
    expect(q.research.trophies).toEqual({ demon: 3, hound: 1, golem: 0, eye: 2 });
    expect(q.workshop.store['breach-charge']).toBe(2);
    expect(q.workshop.equipped[p.roster.soldiers[0].id].charge).toBe(true);
  });

  it('сейв без трофеїв (до п18.2) — нулі; пошкоджені трофеї — відмова', () => {
    const data = JSON.parse(serializeParty(createParty(7)));
    delete data.state.research.trophies;
    delete data.state.workshop.store['breach-charge'];
    const q = deserializeParty(JSON.stringify(data));
    expect(q.research.trophies).toEqual(emptyTrophies());
    expect(q.workshop.store['breach-charge']).toBe(0);
    for (const bad of [{ demon: -1 }, { dragon: 1 }, { hound: 1.5 }, [1], null]) {
      data.state.research.trophies = bad;
      expect(() => deserializeParty(JSON.stringify(data))).toThrow('Пошкоджені дані збереження: наука');
    }
  });
});
