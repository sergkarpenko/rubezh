// src/cycle.test.ts
// Фаза 2, П8: інтеграційні тести повного циклу гри — як у шарі застосунку (main.ts):
//   геосцена (geo.ts) → місія (mission.ts) → бій (combat.ts через bot.autoBattle)
//   → результат (squad.applyMissionResult + mission.completeMission) → геосцена.
// ADR-0002: ядро чисте — тест іде лише через публічне API, без DOM.
// ADR-0003: детермінізм — фіксовані сіди; geo.rng не витягається місією.
// ADR-0008: ростер персистентний між місіями, перма-смерть наскрізна.
// Тест не дублює юніт-тести модулів: він перевіряє зв'язки шарів,
// інваріанти циклу (заморожений час, цілісність ростеру, події геосцени).

import { describe, expect, it } from 'vitest';
import {
  advanceTime,
  createGeoGame,
  geoTick,
  missionTargets,
  type GeoEvent,
  type GeoState,
  type Ufo,
} from './core/geo';
import { completeMission, createMission, missionOutcome, type Mission } from './core/mission';
import { applyMissionResult, createRoster, missionSquad, type Roster } from './core/squad';
import { autoBattle } from './bot';

// Геопартія, де перший НЛО вже приземлився в зоні радара (кандидат на місію).
// Спавн кожен тік (spawnChance: 1) — ціль не довго чекати; сід фіксований → детермінізм.
function geoWithTarget(seed = 11, ticks = 48 * 20): { geo: GeoState; ufo: Ufo } {
  const geo = createGeoGame({ seed, spawnChance: 1 });
  for (let t = 0; t < ticks; t++) {
    geoTick(geo);
    const target = missionTargets(geo)[0];
    if (target) return { geo, ufo: target };
  }
  throw new Error('за ' + ticks + ' тіків жодного НЛО в зоні радара (seed ' + seed + ')');
}

// Загін із ростеру, посилений до практично гарантованої перемоги:
// точність під стелею ADR-0004 (HIT_CHANCE_CAP) і запас HP — звичайні поля Unit.
function strongSquad(roster: Roster): Mission['state']['units'] {
  const squad = missionSquad(roster);
  for (const u of squad) { u.firingAccuracy = 0.95; u.maxHp = 30; u.hp = 30; }
  return squad;
}

// Приречений загін: 1 HP і мінімальна точність — практично гарантована поразка.
function doomedSquad(roster: Roster): Mission['state']['units'] {
  const squad = missionSquad(roster);
  for (const u of squad) { u.firingAccuracy = 0.02; u.maxHp = 1; u.hp = 1; }
  return squad;
}

// Звуження результату бою до фінального ('триває' — це помилка сценарію, бій мав завершитись).
function finalOutcome(outcome: ReturnType<typeof missionOutcome>): 'перемога' | 'поразка' {
  if (outcome === 'триває') throw new Error('бій не завершився за ліміт півходів');
  return outcome;
}

// Зняти події місії з логу геосцени (порівняння траєкторій різних партій).
function withoutMissionEvents(log: GeoEvent[]): GeoEvent[] {
  return log.filter(e => e.type !== 'mission_won' && e.type !== 'mission_lost');
}

describe('інтеграція: повний цикл (геосцена → місія → бій → результат)', () => {
  it('вікно місії: НЛО виявляється радаром і приземляється', () => {
    const { geo, ufo } = geoWithTarget();
    expect(ufo.detected).toBe(true);
    expect(ufo.status).toBe('приземлився');
    expect(geo.log.some(e => e.type === 'ufo_detected' && e.ufoId === ufo.id)).toBe(true);
    expect(geo.log.some(e => e.type === 'ufo_landed' && e.ufoId === ufo.id)).toBe(true);
  });

  it('перемога: НЛО зачищено, загін лікується, час геосцени заморожено під час бою', () => {
    const { geo, ufo } = geoWithTarget(11);
    const roster = createRoster();
    const mission = createMission(geo, ufo.id, { squad: strongSquad(roster) });
    expect(mission.briefing.ufoId).toBe(ufo.id);
    expect(mission.briefing.minute).toBe(geo.minute);

    const minuteBefore = geo.minute;
    const res = autoBattle(mission.state, 240);
    const outcome = finalOutcome(res.outcome);
    expect(outcome).toBe('перемога');
    expect(res.halfTurns).toBeGreaterThan(0);
    expect(geo.minute).toBe(minuteBefore); // геосцена не тікає, поки триває бій

    const aftermath = applyMissionResult(roster, mission.state);
    completeMission(geo, mission.briefing.ufoId, outcome);

    // наслідки для геосцени: НЛО зник, подія «зачищено»
    expect(geo.ufos.find(u => u.id === ufo.id)).toBeUndefined();
    expect(geo.log.at(-1)).toMatchObject({ type: 'mission_won', ufoId: ufo.id, minute: geo.minute });

    // наслідки для ростеру: загиблих немає, виживші повністю лікувані на базі
    expect(aftermath.lost).toHaveLength(0);
    expect(aftermath.survivors).toHaveLength(3);
    for (const s of aftermath.survivors) {
      expect(s.hp).toBe(s.maxHp);
      expect(s.overwatch).toBe(false);
      expect(roster.soldiers).toContain(s);
    }
    // бій справді був: хтось із солдатів мав убивства (стаж ветерана, ADR-0008)
    expect(mission.state.units.some(u => u.side === 'player' && u.kills > 0)).toBe(true);
  });

  it('поразка: перма-смерть у ростері, НЛО лишається, місію можна повторити', () => {
    const { geo, ufo } = geoWithTarget(23);
    const roster = createRoster();
    const mission = createMission(geo, ufo.id, { squad: doomedSquad(roster) });
    const res = autoBattle(mission.state, 240);
    const outcome = finalOutcome(res.outcome);
    expect(outcome).toBe('поразка');

    const aftermath = applyMissionResult(roster, mission.state);
    completeMission(geo, mission.briefing.ufoId, outcome);

    // перма-смерть: весь загін вилучено, ростер порідів
    expect(aftermath.lost).toHaveLength(3);
    expect(aftermath.survivors).toHaveLength(0);
    expect(roster.soldiers.map(s => s.id)).toEqual(['s4', 's5', 's6']);

    // НЛО лишається активним до кінця вікна
    expect(geo.ufos.find(u => u.id === ufo.id)).toBeDefined();
    expect(geo.log.at(-1)).toMatchObject({ type: 'mission_lost', ufoId: ufo.id });

    // повторна місія тим самим НЛО — з решти ростеру
    const second = createMission(geo, ufo.id, { squad: doomedSquad(roster) });
    expect(second.briefing.ufoId).toBe(ufo.id);
    expect(second.state.units.filter(u => u.side === 'player').map(u => u.id)).toEqual(['s4', 's5', 's6']);

    // вікно закінчується — НЛО відлітає, місія більше недоступна
    advanceTime(geo, 48 * 20);
    expect(geo.ufos.find(u => u.id === ufo.id)).toBeUndefined();
    expect(geo.log.some(e => e.type === 'ufo_left' && e.ufoId === ufo.id)).toBe(true);
    expect(() => createMission(geo, ufo.id)).toThrow();
  });
});

describe('інтеграція: детермінізм і ізоляція шарів', () => {
  it('той самий хід гри — байт-у-байт той самий бій', () => {
    const run = () => {
      const { geo, ufo } = geoWithTarget(11);
      const mission = createMission(geo, ufo.id, { squad: strongSquad(createRoster()) });
      const res = autoBattle(mission.state, 240);
      return {
        outcome: res.outcome,
        halfTurns: res.halfTurns,
        units: mission.state.units.map(u => ({ id: u.id, hp: u.hp, ap: u.ap, pos: u.pos, alive: u.alive, kills: u.kills })),
        log: mission.state.log,
      };
    };
    const a = run();
    const b = run();
    expect(b.outcome).toBe(a.outcome);
    expect(b.halfTurns).toBe(a.halfTurns);
    expect(JSON.stringify(b.units)).toBe(JSON.stringify(a.units));
    expect(JSON.stringify(b.log)).toBe(JSON.stringify(a.log));
  });

  it('місія не витягає geo.rng: траєкторія геосцени не залежить від бою', () => {
    const a = geoWithTarget(11).geo;
    const b = geoWithTarget(11).geo;
    const target = missionTargets(a)[0];

    // партія A: повний цикл (поразка — НЛО лишається, тож траєкторії можна порівнювати)
    const mission = createMission(a, target.id, { squad: doomedSquad(createRoster()) });
    const res = autoBattle(mission.state, 240);
    const outcome = finalOutcome(res.outcome);
    expect(outcome).toBe('поразка');
    completeMission(a, target.id, outcome);

    // обидві партії йдуть далі однаковим ходом
    advanceTime(a, 96);
    advanceTime(b, 96);

    expect(a.minute).toBe(b.minute);
    expect(JSON.stringify(a.ufos)).toBe(JSON.stringify(b.ufos));
    expect(JSON.stringify(withoutMissionEvents(a.log))).toBe(JSON.stringify(withoutMissionEvents(b.log)));
  });
});
