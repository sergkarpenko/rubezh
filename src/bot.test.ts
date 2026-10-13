// src/bot.test.ts
// Тести демо-бота гравця й авто-бою (UI-шар). Логіка попередньо перевірена в пісочниці.

import { describe, expect, it } from 'vitest';
import { advanceTime, createGeoGame, type GeoState } from './core/geo';
import { createMission, type Mission } from './core/mission';
import { createRoster, missionSquad } from './core/squad';
import { aliensTurn, autoBattle, botTurn } from './bot';

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
