// src/core/ai-bot.test.ts
// пR.3 (ADR-0038): тести демо-бота гравця й авто-бою, перенесені з
// src/bot.test.ts без зміни тверджень (логіка попередньо перевірена в пісочниці).
// Покроковий драйвер: лог DemoSteps байт-у-байт ідентичний миттєвому autoBattle.

import { describe, expect, it } from 'vitest';
import { createGame, evacuate, makeUnit, mulberry32, type GameEvent, type GameState, type UnitItems } from './combat';
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

// --- П11.4 (ADR-0058/0038): синхронізація бота з витратниками ---

// Гра з солдатом (2,2), сусідом (3,2) і парою прибульців поруч (8,2)/(8,3).
function itemsBotGame(items?: Record<string, UnitItems>): GameState {
  return createGame({
    map: { width: 20, height: 20, blocked: new Set() },
    rng: mulberry32(42),
    items,
    units: [
      makeUnit({ id: 's1', side: 'player', pos: { x: 2, y: 2 } }),
      makeUnit({ id: 's2', side: 'player', pos: { x: 3, y: 2 } }),
      makeUnit({ id: 'a1', side: 'alien', pos: { x: 8, y: 2 } }),
      makeUnit({ id: 'a2', side: 'alien', pos: { x: 8, y: 3 } }),
    ],
  });
}

describe('bot: лікування при пораненні (П11.4)', () => {
  it('поранений солдат з аптечкою лікує собі до стрільби; витратник списано', () => {
    const g = itemsBotGame({ s1: { medkit: true, grenade: false } });
    g.units[0].hp = 5;
    const actions = botTurn(g);
    expect(g.log[0]).toEqual({ type: 'heal', unitId: 's1', targetId: 's1', healed: 3 });
    expect(g.units[0].hp).toBe(8);
    expect(g.items?.s1.medkit).toBe(false);
    expect(actions).toBeGreaterThan(0);
  });

  it('здоровий солдат аптечку не витрачає', () => {
    const g = itemsBotGame({ s1: { medkit: true, grenade: false } });
    botTurn(g);
    expect(g.items?.s1.medkit).toBe(true);
    expect(g.log.some((e) => e.type === 'heal')).toBe(false);
  });
});

describe('bot: граната при скупченні ворогів (П11.4)', () => {
  it('двоє ворогів поруч і без союзників у зоні — кидок по епіцентру', () => {
    const g = itemsBotGame({ s1: { medkit: false, grenade: true } });
    // сунемо кидача ближче: (7,2) — обидва вороги в дальності ≤6 і видимі
    g.units[0].pos = { x: 7, y: 5 };
    const actions = botTurn(g);
    const ev = g.log.find((e) => e.type === 'grenade');
    expect(ev).toBeDefined();
    expect(g.items?.s1.grenade).toBe(false);
    expect(actions).toBeGreaterThan(0);
    // обидва вороги в зоні вибуху — обидва уражені
    const gren = g.log.find((e) => e.type === 'grenade');
    if (gren?.type === 'grenade') expect(gren.hits.map((h) => h.unitId).sort()).toEqual(['a1', 'a2']);
  });

  it('союзник у зоні — бот не кидає (не платить дружнім вогнем)', () => {
    const g = itemsBotGame({ s2: { medkit: false, grenade: true } });
    g.units[1].pos = { x: 7, y: 5 };
    g.units[0].pos = { x: 8, y: 2 }; // с1 в епіцентрі біля обох ворогів
    g.units[2].pos = { x: 8, y: 2 };
    botTurn(g);
    expect(g.log.some((e) => e.type === 'grenade')).toBe(false);
    expect(g.items?.s2.grenade).toBe(true);
  });

  it('одиничний ворог — граната не витрачається, далі звичайна логіка', () => {
    const g = itemsBotGame({ s1: { medkit: false, grenade: true } });
    g.units[3].pos = { x: 17, y: 17 }; // a2 далеко — скупчення немає
    g.units[2].pos = { x: 6, y: 2 }; // a1 поруч із s1
    botTurn(g);
    expect(g.items?.s1.grenade).toBe(true);
    expect(g.log.some((e) => e.type === 'shot')).toBe(true);
  });
});

describe('bot: ізоляція без предметів (критерій 1 П11.4)', () => {
  it('наявність невикористаних предметів не міняє хід бота: лог байт-у-байт', () => {
    const play = (items?: Record<string, UnitItems>) => {
      const g = itemsBotGame(items);
      g.units[2].pos = { x: 6, y: 2 }; // a1 біля s1: стрільба відразу
      botTurn(g); // botTurn сам завершує хід (endTurn усередині)
      g.units.forEach((u) => (u.ap = u.maxAp));
      return JSON.stringify(g.log) + '|' + g.units.map((u) => u.hp + ':' + u.ap).join(',');
    };
    // аптечка у здорового і граната без скупчення — жодна не спрацює
    expect(play()).toBe(play({ s1: { medkit: true, grenade: true }, s2: { medkit: true, grenade: false } }));
  });
});

// --- П15.3 (ADR-0075): бот і евакуйований (EARS 5) ---
// Евакуйований поза units: бот діє лише по state.units (botTurn/soldierStep),
// граната уражає лише юнітів у units (throwGrenade) — евакуйований
// не лікується, не витрачає витратники і не уражений вибухом.

describe('П15.3: бот не діє щодо евакуйованого (ADR-0075, EARS 5)', () => {
  it('евакуйований не лікується і не витрачає витратники — жодної дії бота щодо нього', () => {
    const m = mkMission('uV1');
    const u = m.state.units.find((x) => x.side === 'player')!;
    u.hp = 4; // поранений до евакуації
    m.state.items = { [u.id]: { medkit: true, grenade: true } };
    evacuate(m.state, u.id); // знімається з поля у списку evacuated
    botTurn(m.state);
    // жодна подія ходу бота не стосується евакуйованого (окрім його evac_unit)
    const touching = m.state.log.filter((e) => JSON.stringify(e).includes(u.id));
    expect(touching.map((e) => e.type)).toEqual(['evac_unit']);
    expect(m.state.items![u.id]).toEqual({ medkit: true, grenade: true }); // витратники не списані
  });

  it('евакуйований у клітинці зони вибуху гранати бота — не уражений, вибух лише по ворогах', () => {
    const g = createGame({
      map: { width: 20, height: 20, blocked: new Set() },
      rng: mulberry32(7),
      startingSide: 'player',
      units: [
        makeUnit({ id: 's1', side: 'player', pos: { x: 4, y: 4 } }), // кидач з гранатою
        makeUnit({ id: 's2', side: 'player', pos: { x: 5, y: 4 } }), // майбутній евакуйований — у хресті вибуху
        makeUnit({ id: 'a1', side: 'alien', pos: { x: 6, y: 4 }, hp: 100, maxHp: 100 }),
        makeUnit({ id: 'a2', side: 'alien', pos: { x: 6, y: 5 }, hp: 100, maxHp: 100 }),
      ],
      items: { s1: { medkit: false, grenade: true } },
      evacZone: [{ x: 5, y: 4 }],
    });
    evacuate(g, 's2'); // його колишня клітинка залишиться у зоні вибуху — він поза полем
    botTurn(g);
    const grenade = g.log.find((e) => e.type === 'grenade') as Extract<GameEvent, { type: 'grenade' }>;
    expect(grenade).toBeDefined(); // кидок по скупченню ворогів відбувся
    expect(grenade.hits.map((h) => h.unitId).sort()).toEqual(['a1', 'a2']); // уражені лише вороги
    expect(g.evacuated![0].hp).toBe(10); // EARS 5: евакуйований у зоні вибуху не уражений
    expect(g.evacuated![0].alive).toBe(true);
  });
});
