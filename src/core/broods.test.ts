// src/core/broods.test.ts
// п22.6 (ADR-0188): виводки Розриву і чемпіони — ядро. EARS 6 (ADR-0182, docs/workflow.md).

import { describe, expect, it } from 'vitest';
import { RIFLE, calculateHitChance, createGame, makeUnit, mulberry32, resolveAttack, type Unit } from './combat';
import {
  ASSAULT_BROOD,
  BROOD_IDS,
  CHAMPION_BROOD_MULT,
  CHAMPION_HP_MULT,
  CHAMPION_NAMES,
  CHAMPION_ORDER,
  CHAMPION_THREAT,
  ENEMY_BROODS,
  REGION_BROODS,
  applyBroods,
  broodName,
  broodOfRule,
  broodCarrier,
  broodEffect,
  championNameIndex,
  missionBrood,
} from './broods';
import { ENEMY_KINDS, enemyKind, makeEnemies } from './enemies';
import { createGeoGame, type GeoState } from './geo';
import { connectedMap, createMission, missionSeed } from './mission';
import { REGION_IDS, regionOf } from './regions';
import { awardTrophies, createResearch } from './research';
import { createAssault, createGateMission } from './assault';
import { campaignTick } from './campaign';
import { readySoldiers } from './squad';
import { createParty, deserializeParty, serializeParty, type Party } from './save';

// Геосцена з одним приземленим виявленим зондом у клітинці pos.
function geoWithProbe(pos: { x: number; y: number }, id = 'probe1'): GeoState {
  const g = createGeoGame({ seed: 9, spawnChance: 0 });
  g.probes.push({ id, kind: 'розвідник', pos: { ...pos }, target: { ...pos }, detected: true, status: 'приземлився', landedTicksLeft: 8 });
  return g;
}
const CELL: Record<string, { x: number; y: number }> = {
  west: { x: 1, y: 4 },
  east: { x: 14, y: 4 },
  north: { x: 8, y: 1 },
  south: { x: 8, y: 7 },
};
const aliensOf = (u: readonly Unit[]): Unit[] => u.filter((x) => x.side === 'alien');

describe('п22.6: каталог виводків і райони', () => {
  it('три виводки з одною особливістю кожен; Шпилі — за сідом, решта районів — свій виводок', () => {
    expect(BROOD_IDS.map((b) => ENEMY_BROODS[b].name)).toEqual(['Попіл', 'Іржа', 'Тінь']);
    expect(ENEMY_BROODS.ash).toMatchObject({ damage: 1, armor: 0, evade: 1 });
    expect(ENEMY_BROODS.rust).toMatchObject({ damage: 0, armor: 1, evade: 1 });
    expect(ENEMY_BROODS.shadow).toMatchObject({ damage: 0, armor: 0, evade: 0.8 });
    expect(REGION_BROODS).toEqual({ west: 'rust', east: 'ash', south: 'shadow', north: 'seed' });
    for (const id of REGION_IDS) expect(regionOf(CELL[id])).toBe(id);
    expect(missionBrood('west', 1)).toBe('rust');
    expect(missionBrood('east', 1)).toBe('ash');
    expect(missionBrood('south', 1)).toBe('shadow');
    const north = new Set(Array.from({ length: 60 }, (_, s) => missionBrood('north', s)));
    expect([...north].sort()).toEqual([...BROOD_IDS].sort()); // за сідом — усі три
    expect(missionBrood('north', 77)).toBe(missionBrood('north', 77)); // детерміновано
    expect(ASSAULT_BROOD).toBe('seed');
    expect(broodOfRule('ash', 5)).toBe('ash');
  });
});

describe('п22.6: виводок місії зонда — за районом посадки', () => {
  it.each(['west', 'east', 'south'] as const)('%s: усі вороги — виводку району; назва — для меню й журналу', (region) => {
    const m = createMission(geoWithProbe(CELL[region]), 'probe1', { threat: 30 });
    const aliens = aliensOf(m.state.units);
    expect(aliens.length).toBeGreaterThan(0);
    for (const a of aliens) expect(a.brood).toBe(REGION_BROODS[region]);
    expect(broodName(aliens[0])).toBe(ENEMY_BROODS[REGION_BROODS[region] as 'ash'].name);
    expect(broodName({})).toBeUndefined();
  });

  it('бойовий RNG, мапа і склад не зсуваються: перші числа rng = mulberry32(сід місії)', () => {
    const g = geoWithProbe(CELL.east);
    const seed = missionSeed(g, 'probe1');
    const m = createMission(g, 'probe1', { threat: 45 });
    const ref = mulberry32(seed);
    for (let i = 0; i < 5; i++) expect(m.state.rng()).toBe(ref());
    expect([...m.state.map.blocked].sort()).toEqual([...connectedMap(seed).blocked].sort());
    const kinds = aliensOf(m.state.units).map((u) => enemyKind(u));
    expect(kinds[0]).toBe('demon');
  });

  it('«Попіл» — +1 шкоди; «Іржа» — +1 броні (гончак 1, голем 3); «Тінь» — шанс ×0,8; демон — лише вигляд', () => {
    const [demon, ash] = makeEnemies(
      ['demon', 'hound'],
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      1
    );
    applyBroods([demon, ash], 1, { brood: 'ash', threat: 0, champion: false });
    expect(ash.dmgBonus).toBe(1);
    expect(ash.armor).toBeUndefined();
    expect(demon.brood).toBe('ash'); // рішення власника «А. Лише не-демонам»: аура й назва є
    expect(demon.dmgBonus).toBeUndefined();
    expect(broodCarrier(demon)).toBe(false);
    expect(broodEffect(demon)).toBeUndefined();
    expect(broodEffect(ash)).toBe('+1 шкоди');
    const rust = makeEnemies(
      ['demon', 'hound', 'golem'],
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
      ],
      1
    );
    applyBroods(rust, 1, { brood: 'rust', threat: 0, champion: false });
    expect(rust.map((u) => u.armor)).toEqual([undefined, 1, ENEMY_KINDS.golem.armor + 1]);
    expect(broodEffect(rust[1])).toBe('+1 броні');
    const [, shadow] = makeEnemies(
      ['demon', 'eye'],
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      1
    );
    applyBroods([shadow], 1, { brood: 'shadow', threat: 0, champion: false });
    expect(broodEffect(shadow)).toBe('−20 % до влучання');
    expect(shadow.evade).toBe(0.8);
    expect(shadow.dmgBonus).toBeUndefined();
    const soldier = makeUnit({ id: 's1', side: 'player', name: 'І', pos: { x: 0, y: 0 }, firingAccuracy: 0.6 });
    expect(calculateHitChance(soldier, 'snap', undefined, shadow.evade)).toBeCloseTo(calculateHitChance(soldier, 'snap') * 0.8, 10);
    expect(calculateHitChance(soldier, 'snap', undefined, undefined)).toBe(calculateHitChance(soldier, 'snap'));
  });

  it('шкода «Попелу» в бою: те саме RNG — на 1 більше, ніж без виводку', () => {
    const fire = (bonus?: number): number => {
      const a = makeUnit({ id: 'a1', side: 'alien', name: 'Демон', pos: { x: 0, y: 0 }, firingAccuracy: 1, weapon: RIFLE });
      if (bonus !== undefined) a.dmgBonus = bonus;
      const t = makeUnit({ id: 's1', side: 'player', name: 'І', pos: { x: 3, y: 0 }, firingAccuracy: 0.6 });
      t.hp = 99;
      t.maxHp = 99;
      const st = createGame({ map: { width: 6, height: 1, blocked: new Set() }, units: [a, t], rng: mulberry32(3) });
      st.activeSide = 'alien';
      resolveAttack(st, 'a1', 's1', 'aimed');
      return 99 - t.hp;
    };
    expect(fire(1)).toBe(fire() + 1);
  });

  it('«Тінь» у бою: той самий кидок, що влучає з шансом p, при p × 0,8 може промахнутись', () => {
    const shot = (evade?: number): boolean => {
      const s = makeUnit({ id: 's1', side: 'player', name: 'І', pos: { x: 0, y: 0 }, firingAccuracy: 0.6 });
      const a = makeUnit({ id: 'a1', side: 'alien', name: 'Демон', pos: { x: 3, y: 0 }, firingAccuracy: 0.5 });
      if (evade !== undefined) a.evade = evade;
      // кидок 0,6: менший за шанс прицільного (0,69) — влучання; не менший за 0,69 × 0,8 — промах
      const st = createGame({ map: { width: 6, height: 1, blocked: new Set() }, units: [s, a], rng: () => 0.6 });
      return resolveAttack(st, 's1', 'a1', 'aimed').shots[0].hit;
    };
    const p = calculateHitChance(makeUnit({ id: 'x', side: 'player', name: 'x', pos: { x: 0, y: 0 }, firingAccuracy: 0.6 }), 'aimed');
    expect(p).toBeGreaterThan(0.6);
    expect(p * 0.8).toBeLessThanOrEqual(0.6);
    expect(shot()).toBe(true);
    expect(shot(0.8)).toBe(false);
  });
});

describe('п22.6: чемпіон', () => {
  // Сіди місій на загрозі 45 у районі «Промзона», доки не знайдеться з чемпіоном і без.
  function missionAt(threat: number, want: boolean): Unit[] {
    for (let minute = 0; minute < 400; minute++) {
      const g = geoWithProbe(CELL.east);
      g.minute = minute;
      const aliens = aliensOf(createMission(g, 'probe1', { threat }).state.units);
      if (aliens.some((u) => u.champion) === want) return aliens;
    }
    throw new Error('сід не знайдено');
  }

  it("з порогу загрози — один чемпіон найсильнішого типу: HP ×1,5 угору, виводок ×2, ім'я з пулу", () => {
    const aliens = missionAt(CHAMPION_THREAT + 5, true);
    const champs = aliens.filter((u) => u.champion);
    expect(champs).toHaveLength(1);
    const c = champs[0];
    const kind = enemyKind(c);
    expect(kind).toBe(CHAMPION_ORDER.find((k) => aliens.some((u) => enemyKind(u) === k))); // голем, око, гончак, демон
    expect(aliens.find((u) => enemyKind(u) === kind)).toBe(c); // перший такий
    expect(c.maxHp).toBe(Math.ceil(ENEMY_KINDS[kind].hp * CHAMPION_HP_MULT));
    expect(c.hp).toBe(c.maxHp);
    expect(c.dmgBonus).toBe(ENEMY_BROODS.ash.damage * CHAMPION_BROOD_MULT);
    expect(CHAMPION_NAMES).toContain(c.name.split(' ')[1]);
    expect(c.name.split(' ')[0]).toBe(ENEMY_KINDS[kind].name); // рід — за назвою типу
    for (const u of aliens) if (u !== c) expect(u.dmgBonus).toBe(enemyKind(u) === 'demon' ? undefined : 1);
    missionAt(CHAMPION_THREAT + 5, false); // імовірність — не кожна місія
  });

  it('нижче порогу загрози — чемпіона немає', () => {
    for (let minute = 0; minute < 60; minute++) {
      const g = geoWithProbe(CELL.east);
      g.minute = minute;
      expect(aliensOf(createMission(g, 'probe1', { threat: CHAMPION_THREAT - 1 }).state.units).some((u) => u.champion)).toBe(false);
    }
  });

  it("ухил чемпіона «Тіні» — 0,6; броня чемпіона «Іржі» — +2; ім'я — ціла арифметика від сіду", () => {
    for (let seed = 0; seed < 200; seed++) {
      const al = makeEnemies(
        ['demon', 'hound'],
        [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ],
        seed
      );
      const c = applyBroods(al, seed, { brood: 'shadow', threat: 50, champion: true });
      if (!c) continue;
      expect(c.kind).toBe('hound');
      expect(c.evade).toBeCloseTo(0.6, 10);
      expect(al[0].evade).toBeUndefined(); // демон — лише вигляд
      expect(c.name).toBe('Гончак ' + CHAMPION_NAMES[championNameIndex(seed)]);
      const rl = makeEnemies(['demon'], [{ x: 0, y: 0 }], seed);
      const rc = applyBroods(rl, seed, { brood: 'rust', threat: 50, champion: true });
      expect(rc?.armor).toBe(2); // чемпіон-демон — з особливістю ×2
      expect(broodEffect(rc!)).toBe('+2 броні');
      return;
    }
    throw new Error('сід не знайдено');
  });

  it('убитий чемпіон — трофей `champion` і рядок журналу «чемпіон +1»; без чемпіона — поля немає', () => {
    const r = createResearch();
    const dead = (champion: boolean): Unit => {
      const u = makeUnit({ id: 'a1', side: 'alien', name: 'Демон', pos: { x: 0, y: 0 }, firingAccuracy: 0.5 });
      u.alive = false;
      if (champion) u.champion = true;
      return u;
    };
    expect(awardTrophies(r, { units: [dead(false)] }, 'перемога')).toEqual({ demon: 1 });
    expect(r.trophies.champion).toBeUndefined();
    expect(awardTrophies(r, { units: [dead(true)] }, 'перемога')).toEqual({ demon: 1, champion: 1 });
    expect(r.trophies.champion).toBe(1);
    expect(r.log.at(-1)).toEqual({ type: 'trophies', gained: { demon: 1, champion: 1 } });
    expect(awardTrophies(r, { units: [dead(true)] }, 'поразка')).toEqual({});
  });

  it('трофей чемпіона переживає сейв; сейв без нього — без поля', () => {
    const p = createParty(42);
    const json0 = serializeParty(p);
    expect(json0).not.toContain('champion');
    p.research.trophies.champion = 2;
    expect(deserializeParty(serializeParty(p)).research.trophies.champion).toBe(2);
    expect(() => deserializeParty(serializeParty(p).replace('"champion":2', '"champion":-1'))).toThrow();
  });
});

describe('п22.6: штурм бази і Брама', () => {
  const tick = (p: Party): void => campaignTick({ geo: p.geo, roster: p.roster, econ: p.econ }, p.campaign);
  function atThreat(p: Party, t: number): void {
    p.campaign.threat = t;
    p.campaign.threatCursor = p.geo.log.length;
  }

  it('штурм: один виводок на всіх за сідом, без чемпіона навіть на високій загрозі', () => {
    const p = createParty(42);
    atThreat(p, 60);
    tick(p);
    const aliens = aliensOf(createAssault(p, { squad: readySoldiers(p.roster).slice(0, 3) }).state.units);
    const b = aliens[0].brood;
    expect(BROOD_IDS).toContain(b);
    for (const a of aliens) expect(a.brood).toBe(b);
    expect(aliens.some((u) => u.champion)).toBe(false);
  });

  it('Брама: усі три виводки з особливістю на кожному сіді (носії — перестановка), склад 6 і 4', () => {
    for (let seed = 0; seed < 300; seed++) {
      for (const kinds of [
        ['demon', 'hound', 'golem', 'eye', 'hound', 'eye'],
        ['demon', 'hound', 'golem', 'eye'],
      ] as const) {
        const al = makeEnemies(
          [...kinds],
          kinds.map((_, i) => ({ x: i, y: 0 })),
          seed
        );
        applyBroods(al, seed, { brood: 'mixed', threat: 70, champion: false });
        const carried = new Set(al.filter((u) => broodCarrier(u)).map((u) => u.brood));
        expect(carried.size).toBe(3);
      }
    }
  });

  it('Брама: кожен ворог свого виводку за сідом, без чемпіона', () => {
    const seen = new Set<string>();
    for (let minute = 0; minute < 6; minute++) {
      const p = createParty(42);
      p.research.completed.push('gate-key');
      p.campaign.threat = 70;
      p.geo.minute = minute;
      const aliens = aliensOf(createGateMission(p, { squad: readySoldiers(p.roster).slice(0, 3) }).state.units);
      for (const a of aliens) {
        expect(BROOD_IDS).toContain(a.brood);
        seen.add(a.brood!);
      }
      expect(aliens.some((u) => u.champion)).toBe(false);
    }
    expect(seen.size).toBe(3);
  });
});
