// src/core/ai-bot.test.ts
// пR.3 (ADR-0038): тести демо-бота гравця й авто-бою, перенесені з
// src/bot.test.ts без зміни тверджень (логіка попередньо перевірена в пісочниці).
// Покроковий драйвер: лог DemoSteps байт-у-байт ідентичний миттєвому autoBattle.

import { describe, expect, it } from 'vitest';
import { createGame, makeUnit, mulberry32, type GameState } from './combat';
import { advanceTime, createGeoGame, type GeoState } from './geo';
import { aliensTurn, autoBattle, botTurn, DemoSteps } from './ai-bot';
import { createMission, missionOutcome, type Mission } from './mission';
import { createRoster, missionSquad } from './squad';

// Геопартія з вручну «посадженим» НЛО (спавн вимкнено) — для точкових сценаріїв.
function mkGeo(ufoId: string, kind: 'розвідник' | 'збирач' = 'розвідник', ticks = 0): GeoState {
  const g = createGeoGame({ seed: 9, spawnChance: 0 });
  if (ticks > 0) advanceTime(g, ticks);
  g.ufos.push({
    id: ufoId,
    kind,
    pos: { ...g.base },
    target: { ...g.base },
    detected: true,
    status: 'приземлився',
    landedTicksLeft: 16,
  });
  return g;
}

function mkMission(ufoId: string, kind?: 'розвідник' | 'збирач', ticks = 0): Mission {
  return createMission(mkGeo(ufoId, kind, ticks), ufoId, { squad: missionSquad(createRoster()) });
}

describe('bot: хід гравця', () => {
  it('без видимих цілей солдати висуваються до зони НЛО і передають хід', () => {
    const m = mkMission('u1');
    const before = JSON.stringify(m.state.units.filter((u) => u.side === 'player').map((u) => u.pos));
    const actions = botTurn(m.state);
    const after = JSON.stringify(m.state.units.filter((u) => u.side === 'player').map((u) => u.pos));
    expect(actions).toBeGreaterThan(0);
    expect(m.state.activeSide).toBe('alien');
    expect(after).not.toBe(before);
  });

  it('не в хід гравця → помилка', () => {
    const m = mkMission('u2');
    botTurn(m.state);
    expect(() => botTurn(m.state)).toThrow();
  });
});

describe('bot: хід прибульців', () => {
  it('aliensTurn діє і повертає хід гравцю; не в свій хід → помилка', () => {
    const m = mkMission('u3');
    botTurn(m.state);
    aliensTurn(m.state);
    expect(m.state.activeSide).toBe('player');
    expect(() => aliensTurn(m.state)).toThrow();
  });
});

describe('bot: авто-бій', () => {
  it('авто-бій завершується перемогою або поразкою, без зависань', () => {
    for (const [id, kind, ticks] of [
      ['uA', 'розвідник', 0],
      ['uB', 'збирач', 7],
      ['uC', 'розвідник', 14],
      ['uD', 'збирач', 21],
      ['uE', 'розвідник', 28],
    ] as const) {
      const r = autoBattle(mkMission(id, kind as 'розвідник' | 'збирач', ticks).state);
      expect(['перемога', 'поразка']).toContain(r.outcome);
      expect(r.halfTurns).toBeGreaterThan(0);
      expect(r.halfTurns).toBeLessThan(240);
    }
  });

  it('авто-бій детермінований: та сама місія → той самий лог', () => {
    const a = mkMission('uX', 'збирач', 21);
    const b = mkMission('uX', 'збирач', 21);
    autoBattle(a.state);
    autoBattle(b.state);
    expect(JSON.stringify(a.state.log)).toBe(JSON.stringify(b.state.log));
  });
});

describe('П6.16: покроковий драйвер демо (DemoSteps)', () => {
  it('лог байт-у-байт ідентичний миттєвому autoBattle; результат і півходи збігаються', () => {
    for (const [id, kind, ticks] of [
      ['uS', 'розвідник', 0],
      ['uT', 'збирач', 7],
      ['uU', 'розвідник', 21],
    ] as const) {
      const instant = mkMission(id, kind, ticks);
      const stepped = mkMission(id, kind, ticks);
      const res = autoBattle(instant.state, 240);
      const drv = new DemoSteps(240);
      let acted = 0;
      let guard = 0;
      for (;;) {
        const r = drv.step(stepped.state);
        if (r.acted) acted++;
        if (r.over) break;
        if (guard++ > 100000) throw new Error('покрокове демо не завершується');
      }
      expect(JSON.stringify(stepped.state.log)).toBe(JSON.stringify(instant.state.log));
      expect(missionOutcome(stepped.state)).toBe(res.outcome);
      expect(drv.halfTurnsDone).toBe(res.halfTurns);
      expect(acted).toBeGreaterThan(0);
    }
  });

  it('over — термінальний: після завершення step більше нічого не робить', () => {
    const m = mkMission('uV', 'розвідник', 0);
    const drv = new DemoSteps(240);
    let guard = 0;
    for (;;) {
      const r = drv.step(m.state);
      if (r.over) break;
      if (guard++ > 100000) throw new Error('покрокове демо не завершується');
    }
    const len = m.state.log.length;
    expect(drv.step(m.state)).toEqual({ acted: false, over: true });
    expect(m.state.log.length).toBe(len); // стан не рухається
  });
});

// пR.3 (гейт codecov/patch): глухі кути soldierStep — солдат у «замкненій кишені»:
// 4 сусідні клітинки заблоковані → рух неможливий, але діагональний LOS з (2,2)
// до (5,5) вільний ((3,3), (4,4) не заблоковані). Обидва без-дієві виходи:
// без видимих цілей нема шляху до зони НЛО; із видимою ціллю — AP замало на
// постріл (мін. snap = 3 AP при ap = 2) і шляху до цілі нема.
describe('bot: глухий кут — солдат без ходу', () => {
  function pocket(): GameState {
    return createGame({
      map: { width: 20, height: 20, blocked: new Set(['1,2', '2,1', '2,3', '3,2']) },
      rng: mulberry32(42),
      startingSide: 'player',
      units: [makeUnit({ id: 's1', side: 'player', pos: { x: 2, y: 2 }, ap: 2, maxAp: 2 })],
    });
  }

  it('без видимих цілей і без шляху до зони НЛО — 0 дій, хід передано', () => {
    const g = pocket();
    expect(botTurn(g)).toBe(0);
    expect(g.activeSide).toBe('alien');
    expect(g.log.filter((e) => e.type === 'move')).toHaveLength(0);
  });

  it('ціль видима, AP замало на постріл, шляху нема — 0 дій, без пострілів', () => {
    const g = pocket();
    g.units.push(makeUnit({ id: 'a1', side: 'alien', pos: { x: 5, y: 5 } }));
    expect(botTurn(g)).toBe(0);
    expect(g.log.filter((e) => e.type === 'shot' || e.type === 'move')).toHaveLength(0);
    expect(g.activeSide).toBe('alien');
  });
});
