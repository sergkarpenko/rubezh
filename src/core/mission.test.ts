// src/core/mission.test.ts
// Юніт-тести зв'язку шарів (ітерація 5.0). Запуск: npx vitest
// Логіка всіх сценаріїв попередньо перевірена в пісочниці.

import { describe, expect, it } from 'vitest';
import { isBlocked, evacuate, makeUnit } from './combat';
import { advanceTime, createGeoGame, missionTargets, type GeoState, type Ufo } from './geo';
import {
  ALIEN_SPAWN,
  SQUAD_SPAWN,
  completeMission,
  createMission,
  makeSoldier,
  missionOutcome,
  missionSeed,
  type Mission,
} from './mission';

// Геопартія з вручну «посадженим» НЛО (спавн вимкнено) — для точкових сценаріїв.
function mkGeo(ufoId: string, detected = true, status: Ufo['status'] = 'приземлився'): GeoState {
  const g = createGeoGame({ seed: 9, spawnChance: 0 });
  g.ufos.push({
    id: ufoId,
    kind: 'розвідник',
    pos: { ...g.base },
    target: { ...g.base },
    detected,
    status,
    landedTicksLeft: 8,
  });
  return g;
}

// BFS (4 напрямки): клітинки, досяжні з from по вільних клітинках.
function reachableCells(state: Mission['state'], from: { x: number; y: number }): Set<string> {
  const seen = new Set<string>([from.x + ',' + from.y]);
  const queue = [{ ...from }];
  while (queue.length > 0) {
    const p = queue.shift()!;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const n = { x: p.x + dx, y: p.y + dy };
      const k = n.x + ',' + n.y;
      if (n.x < 0 || n.y < 0 || n.x >= state.map.width || n.y >= state.map.height) continue;
      if (state.map.blocked.has(k) || seen.has(k)) continue;
      seen.add(k);
      queue.push(n);
    }
  }
  return seen;
}

describe('mission: валідація запуску', () => {
  it('неіснуючий НЛО → помилка', () => {
    expect(() => createMission(mkGeo('uX'), 'нема')).toThrow();
  });

  it('невиявлений НЛО → помилка', () => {
    expect(() => createMission(mkGeo('u1', false), 'u1')).toThrow();
  });

  it('НЛО у повітрі → помилка', () => {
    expect(() => createMission(mkGeo('u2', true, 'летить'), 'u2')).toThrow();
  });
});

describe('mission: структура', () => {
  it('розвідник: брифінг і 2 прибульці; солдати у зоні висадки з повними AP', () => {
    const m = createMission(mkGeo('uA'), 'uA');
    expect(m.briefing).toMatchObject({ ufoId: 'uA', kind: 'розвідник', aliens: 2 });
    const squad = m.state.units.filter((u) => u.side === 'player');
    expect(squad.length).toBe(3);
    expect(squad.every((u) => u.ap === 10)).toBe(true);
    expect(squad.map((u) => u.pos.x + ',' + u.pos.y).sort()).toEqual(SQUAD_SPAWN.map((p) => p.x + ',' + p.y).sort());
  });

  it('збирач: 3 прибульці з «Імпульсним різаком», точність .50/.45/.40', () => {
    const g = mkGeo('uB');
    g.ufos[0].kind = 'збирач';
    g.ufos[0].landedTicksLeft = 16;
    const m = createMission(g, 'uB');
    const aliens = m.state.units.filter((u) => u.side === 'alien');
    expect(aliens.length).toBe(3);
    expect(aliens.every((u) => u.weapon.name === 'Фазовий різак')).toBe(true);
    expect(aliens.map((u) => u.firingAccuracy)).toEqual([0.5, 0.45, 0.4]);
  });

  it('усі позиції унікальні, без перешкод, мапа 20×20', () => {
    const m = createMission(mkGeo('uC'), 'uC');
    const cells = m.state.units.map((u) => u.pos.x + ',' + u.pos.y);
    expect(new Set(cells).size).toBe(cells.length);
    expect(m.state.units.every((u) => !isBlocked(m.state.map, u.pos))).toBe(true);
    expect(m.state.map.width).toBe(20);
    expect(m.state.map.height).toBe(20);
  });

  it("бойовище зв'язне: точки висадки і НЛО досяжні з першої точки висадки", () => {
    const m = createMission(mkGeo('uD'), 'uD');
    const seen = reachableCells(m.state, SQUAD_SPAWN[0]);
    for (const t of [...SQUAD_SPAWN, ...ALIEN_SPAWN]) {
      expect(seen.has(t.x + ',' + t.y)).toBe(true);
    }
  });
});

describe('mission: детермінізм', () => {
  it('сід місії залежить від НЛО та хвилини геосцени', () => {
    const a = mkGeo('uA');
    a.minute = 600;
    const b = mkGeo('uA');
    b.minute = 630;
    const c = mkGeo('uB');
    c.minute = 600;
    expect(missionSeed(a, 'uA')).not.toBe(missionSeed(b, 'uA'));
    expect(missionSeed(a, 'uA')).not.toBe(missionSeed(c, 'uB'));
  });

  it('та сама траєкторія → ідентична місія (стан, мапа, брифінг)', () => {
    const a = mkGeo('uA');
    a.minute = 600;
    const b = mkGeo('uA');
    b.minute = 600;
    const snap = (m: Mission) =>
      JSON.stringify({
        briefing: m.briefing,
        units: m.state.units,
        blocked: [...m.state.map.blocked].sort(),
      });
    expect(snap(createMission(a, 'uA'))).toBe(snap(createMission(b, 'uA')));
  });

  it('запуск місії не витягає geo.rng: траєкторія геосцени не змінюється', () => {
    const run = (launch: boolean): string => {
      const g = createGeoGame({ seed: 5, spawnChance: 0 });
      advanceTime(g, 10);
      g.ufos.push({
        id: 'ufoM',
        kind: 'розвідник',
        pos: { ...g.base },
        target: { ...g.base },
        detected: true,
        status: 'приземлився',
        landedTicksLeft: 8,
      });
      if (launch) createMission(g, 'ufoM');
      advanceTime(g, 100);
      return JSON.stringify(g.log);
    };
    expect(run(true)).toBe(run(false));
  });
});

describe('mission: результати', () => {
  it('перемога: усі прибульці мертві → НЛО вилучено, подія mission_won', () => {
    const g = mkGeo('uW');
    const m = createMission(g, 'uW');
    for (const a of m.state.units.filter((u) => u.side === 'alien')) {
      a.alive = false;
      a.hp = 0;
    }
    expect(missionOutcome(m.state)).toBe('перемога');
    completeMission(g, 'uW', 'перемога');
    expect(g.ufos.some((u) => u.id === 'uW')).toBe(false);
    const won = g.log.find((e) => e.type === 'mission_won');
    expect(won).toMatchObject({ ufoId: 'uW', minute: g.minute });
    expect(() => completeMission(g, 'uW', 'перемога')).toThrow(); // НЛО вже нема
  });

  it('поразка: загін мертвий → НЛО лишається, вікно тече далі', () => {
    const g = mkGeo('uL');
    const m = createMission(g, 'uL');
    for (const s of m.state.units.filter((u) => u.side === 'player')) {
      s.alive = false;
      s.hp = 0;
    }
    expect(missionOutcome(m.state)).toBe('поразка');
    completeMission(g, 'uL', 'поразка');
    expect(g.ufos.some((u) => u.id === 'uL')).toBe(true);
    expect(g.log.some((e) => e.type === 'mission_lost' && e.ufoId === 'uL')).toBe(true);
    advanceTime(g, 8); // вікно розвідника — 8 тіків
    expect(g.ufos.some((u) => u.id === 'uL')).toBe(false);
    expect(g.log.some((e) => e.type === 'ufo_left' && e.ufoId === 'uL')).toBe(true);
  });

  it('бій не завершено → «триває»', () => {
    const m = createMission(mkGeo('uT'), 'uT');
    expect(missionOutcome(m.state)).toBe('триває');
  });
});

describe('mission: власний загін', () => {
  it('свій загін розміщується на перших точках висадки', () => {
    const g = mkGeo('uC');
    const sq = [makeSoldier('vet1', 'Марко'), makeSoldier('vet2', 'Дана')];
    const m = createMission(g, 'uC', { squad: sq });
    expect(m.state.units.filter((u) => u.side === 'player').length).toBe(2);
    expect(sq.map((u) => u.pos)).toEqual([
      { x: 2, y: 2 },
      { x: 3, y: 2 },
    ]);
  });

  it('порожній, перевеликий або ворожий загін → помилка', () => {
    expect(() => createMission(mkGeo('uD'), 'uD', { squad: [] })).toThrow();
    expect(() =>
      createMission(mkGeo('uE'), 'uE', {
        squad: [makeSoldier('a', '1'), makeSoldier('b', '2'), makeSoldier('c', '3'), makeSoldier('d', '4')],
      })
    ).toThrow();
    const spy = makeUnit({ id: 'spy', side: 'alien', pos: { x: 0, y: 0 } });
    expect(() => createMission(mkGeo('uF'), 'uF', { squad: [makeSoldier('x', 'Іван'), spy] })).toThrow();
  });
});

describe('mission: наскрізний цикл', () => {
  it('НЛО летить до бази → виявлений → ціль місії; після перемоги НЛО нема на радарі', () => {
    const g = createGeoGame({ seed: 11, spawnChance: 0 });
    g.ufos.push({
      id: 'ufo8',
      kind: 'збирач',
      pos: { x: 3, y: 3 },
      target: { ...g.base },
      detected: false,
      status: 'летить',
      landedTicksLeft: 16,
    });
    let ticks = 0;
    while (missionTargets(g).length === 0 && ticks < 100) {
      advanceTime(g, 1);
      ticks++;
    }
    expect(missionTargets(g).map((u) => u.id)).toEqual(['ufo8']);
    const m = createMission(g, 'ufo8');
    // швидка перемога: прибульці «зачищені»
    for (const a of m.state.units.filter((u) => u.side === 'alien')) {
      a.alive = false;
      a.hp = 0;
    }
    expect(missionOutcome(m.state)).toBe('перемога');
    completeMission(g, 'ufo8', 'перемога');
    expect(g.ufos.length).toBe(0);
    expect(g.log.some((e) => e.type === 'mission_won' && e.ufoId === 'ufo8')).toBe(true);
  });
});

describe('mission: витратники загону (П11.4, ADR-0058)', () => {
  it('opts.items проходить у стан бою; без opts.items — поля items немає', () => {
    const squad = [makeSoldier('s1', 'Іван'), makeSoldier('s2', 'Олена')];
    const withItems = createMission(mkGeo('uI1'), 'uI1', {
      squad,
      items: { s1: { medkit: true, grenade: true } },
    });
    expect(withItems.state.items).toEqual({ s1: { medkit: true, grenade: true } });
    const bare = createMission(mkGeo('uI2'), 'uI2', { squad: [makeSoldier('s9', 'Тарас')] });
    expect(bare.state.items).toBeUndefined();
  });
});

// --- П15.2 (ADR-0075): третій результат місії «евакуйовано» ---

describe('mission: П15.2 — третій результат (ADR-0075)', () => {
  function killSide(state: Mission['state'], side: 'player' | 'alien'): void {
    for (const u of state.units.filter((x) => x.side === side)) {
      u.alive = false;
      u.hp = 0;
    }
  }

  it('EARS 3: часткова евакуація + загін загинув → «евакуйовано», НЛО лишається', () => {
    const g = mkGeo('uP1');
    const m = createMission(g, 'uP1');
    evacuate(m.state, 's1');
    killSide(m.state, 'player');
    expect(missionOutcome(m.state)).toBe('евакуйовано'); // не «поразка»: 1 евакуйований
    completeMission(g, 'uP1', 'евакуйовано');
    expect(g.log.filter((e) => e.type === 'mission_evacuated')).toEqual([{ type: 'mission_evacuated', ufoId: 'uP1', minute: g.minute }]);
    expect(g.log.some((e) => e.type === 'mission_won' || e.type === 'mission_lost')).toBe(false); // без премій/поразки
    expect(g.ufos.some((u) => u.id === 'uP1')).toBe(true); // НЛО лишається приземленим
  });

  it('EARS 3: повна евакуація → «евакуйовано» (порожнє поле ≠ поразка)', () => {
    const g = mkGeo('uP2');
    const m = createMission(g, 'uP2');
    evacuate(m.state, 's1');
    evacuate(m.state, 's2');
    evacuate(m.state, 's3');
    expect(missionOutcome(m.state)).toBe('евакуйовано');
    completeMission(g, 'uP2', 'евакуйовано');
    expect(g.log.filter((e) => e.type === 'mission_evacuated')).toHaveLength(1);
  });

  it('EARS 8: вікно посадки тікає чинною логікою; місію можна повторити новим загоном', () => {
    const g = mkGeo('uP3');
    const m = createMission(g, 'uP3');
    evacuate(m.state, 's1');
    killSide(m.state, 'player');
    completeMission(g, 'uP3', 'евакуйовано');
    expect(missionTargets(g).map((u) => u.id)).toEqual(['uP3']); // кандидат на повторну місію
    const m2 = createMission(g, 'uP3'); // новий загін за замовчуванням
    expect(m2.state.units.filter((u) => u.side === 'player')).toHaveLength(3);
    expect(m2.state.evacuated).toEqual([]); // новий бій — без евакуйованих
    advanceTime(g, 8); // вікно розвідника — 8 тіків; після евакуації тікає далі
    expect(g.ufos.some((u) => u.id === 'uP3')).toBe(false);
    expect(g.log.some((e) => e.type === 'ufo_left' && e.ufoId === 'uP3')).toBe(true);
  });

  it('кутовий випадок (рішення власника №5): часткова евакуація + зачистка прибульців → ПЕРЕМОГА з пріоритетом', () => {
    const g = mkGeo('uP4');
    const m = createMission(g, 'uP4');
    evacuate(m.state, 's1');
    killSide(m.state, 'alien'); // останній солдат на полі знищив усіх прибульців
    expect(missionOutcome(m.state)).toBe('перемога'); // перемога має пріоритет над «евакуйовано»
    completeMission(g, 'uP4', 'перемога');
    expect(g.ufos.some((u) => u.id === 'uP4')).toBe(false); // зачищено
    expect(g.log.some((e) => e.type === 'mission_won' && e.ufoId === 'uP4')).toBe(true);
    expect(g.log.some((e) => e.type === 'mission_evacuated')).toBe(false);
  });

  it('часткова евакуація, бій триває → «триває»; EARS 4: без евакуйованих — чинна поразка', () => {
    const m = createMission(mkGeo('uP5'), 'uP5');
    evacuate(m.state, 's1');
    expect(missionOutcome(m.state)).toBe('триває'); // 2 живих на полі
    const m2 = createMission(mkGeo('uP6'), 'uP6');
    killSide(m2.state, 'player');
    expect(m2.state.evacuated?.length ?? 0).toBe(0);
    expect(missionOutcome(m2.state)).toBe('поразка'); // 0 евакуйованих — поразка 5.0 без змін
  });
});
