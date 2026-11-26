// src/core/ai-bot.test.ts
// пR.3 (ADR-0038): тести демо-бота гравця й авто-бою, перенесені з
// src/bot.test.ts без зміни тверджень (логіка попередньо перевірена в пісочниці).
// Покроковий драйвер: лог DemoSteps байт-у-байт ідентичний миттєвому autoBattle.

import { describe, expect, it } from 'vitest';
import {
  createGame,
  evacuate,
  makeUnit,
  mulberry32,
  GRENADE_AP_COST,
  GRENADE_RANGE,
  HEAL_AP_COST,
  OVERWATCH_AP_COST,
  type GameEvent,
  type GameState,
  type Unit,
  type UnitItems,
} from './combat';
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

// --- Т.142 (кандидат 2): живі мутанти ai-bot.ts поза кодом Т.76 ---
// Межі умов soldierStep і grenadeTarget, запобіжники циклів aliensTurn і
// DemoSteps, ліміт півходів autoBattle/DemoSteps і точна форма результатів
// DemoSteps. Еквівалентні мутанти (повторна перевірка перед soldierStep,
// масиви, що перезаписуються до читання) — у записі Т.142 docs/workflow.md.

// Чи діяв юніт id у події (постріл, рух, кидок тощо).
const actedBy = (e: GameEvent, id: string) =>
  ('shooterId' in e && e.shooterId === id) || ('unitId' in e && e.unitId === id) || ('throwerId' in e && e.throwerId === id);
// Дії-черги юніта id: у запобіжниках циклів ціль за 3 клітинки, і кожна дія —
// автоматична черга з трьох подій shot (тому дій = пострілів / 3).
const burstsBy = (g: GameState, id: string) => g.log.filter((e) => e.type === 'shot' && e.shooterId === id && e.mode === 'auto').length / 3;

function open(units: Unit[], opts: { side?: 'player' | 'alien'; items?: Record<string, UnitItems>; blocked?: string[] } = {}) {
  return createGame({
    map: { width: 20, height: 20, blocked: new Set(opts.blocked ?? []) },
    rng: mulberry32(42),
    startingSide: opts.side ?? 'player',
    items: opts.items,
    units,
  });
}

describe('Т.142: межі витратників у soldierStep', () => {
  it(`аптечка: рівно ${HEAL_AP_COST} AP — лікує; на 1 AP менше — ні, без помилки`, () => {
    const g = itemsBotGame({ s1: { medkit: true, grenade: false } });
    g.units[0].hp = 5;
    g.units[0].ap = HEAL_AP_COST;
    botTurn(g);
    expect(g.log[0]).toEqual({ type: 'heal', unitId: 's1', targetId: 's1', healed: 3 });

    const h = itemsBotGame({ s1: { medkit: true, grenade: false } });
    h.units[0].hp = 5;
    h.units[0].ap = HEAL_AP_COST - 1;
    expect(() => botTurn(h)).not.toThrow();
    expect(h.log.some((e) => e.type === 'heal')).toBe(false);
    expect(h.items?.s1.medkit).toBe(true);
  });

  it('після лікування солдат діє далі в тому ж ході', () => {
    const g = itemsBotGame({ s1: { medkit: true, grenade: false } });
    g.units[0].hp = 5;
    botTurn(g);
    expect(g.log[0].type).toBe('heal');
    expect(g.log.slice(1).some((e) => actedBy(e, 's1'))).toBe(true);
  });

  it(`граната: рівно ${GRENADE_AP_COST} AP — кидок; на 1 AP менше — ні, без помилки`, () => {
    const g = itemsBotGame({ s1: { medkit: false, grenade: true } });
    g.units[0].pos = { x: 7, y: 5 };
    g.units[0].ap = GRENADE_AP_COST;
    botTurn(g);
    expect(g.log[0].type).toBe('grenade');

    const h = itemsBotGame({ s1: { medkit: false, grenade: true } });
    h.units[0].pos = { x: 7, y: 5 };
    h.units[0].ap = GRENADE_AP_COST - 1;
    expect(() => botTurn(h)).not.toThrow();
    expect(h.log.some((e) => e.type === 'grenade')).toBe(false);
    expect(h.items?.s1.grenade).toBe(true);
  });

  it('після кидка гранати солдат діє далі в тому ж ході', () => {
    const g = itemsBotGame({ s1: { medkit: false, grenade: true } });
    g.units[0].pos = { x: 7, y: 5 };
    botTurn(g);
    expect(g.log[0].type).toBe('grenade');
    expect(g.log.slice(1).some((e) => actedBy(e, 's1'))).toBe(true);
  });
});

describe('Т.142: вибір епіцентру гранати (grenadeTarget)', () => {
  const pair = (x: number, y: number) => [
    makeUnit({ id: 'a1', side: 'alien', pos: { x, y }, hp: 100, maxHp: 100 }),
    makeUnit({ id: 'a2', side: 'alien', pos: { x, y: y + 1 }, hp: 100, maxHp: 100 }),
  ];

  it(`ворог рівно на дальності ${GRENADE_RANGE} — кидок; на ${GRENADE_RANGE + 1} — ні`, () => {
    const g = open([makeUnit({ id: 's1', side: 'player', pos: { x: 2, y: 2 }, ap: GRENADE_AP_COST }), ...pair(2 + GRENADE_RANGE, 2)], {
      items: { s1: { medkit: false, grenade: true } },
    });
    botTurn(g);
    expect(g.log[0].type).toBe('grenade');

    const far = 2 + GRENADE_RANGE + 1;
    const h = open([makeUnit({ id: 's1', side: 'player', pos: { x: 2, y: 2 }, ap: GRENADE_AP_COST }), ...pair(far, 2)], {
      items: { s1: { medkit: false, grenade: true } },
    });
    expect(() => botTurn(h)).not.toThrow();
    expect(h.log.some((e) => e.type === 'grenade')).toBe(false);
  });

  it('скупчення видно лише іншому солдатові, кидач без лінії — кидка немає', () => {
    // s1 у кільці стін: жодної лінії, жодного руху; s2 бачить пару ворогів.
    const ring = ['3,4', '4,4', '5,4', '3,5', '5,5', '3,6', '4,6', '5,6'];
    const g = open(
      [
        makeUnit({ id: 's1', side: 'player', pos: { x: 4, y: 5 }, ap: GRENADE_AP_COST }),
        makeUnit({ id: 's2', side: 'player', pos: { x: 8, y: 9 }, ap: 0 }),
        ...pair(8, 5),
      ],
      { items: { s1: { medkit: false, grenade: true } }, blocked: ring }
    );
    expect(() => botTurn(g)).not.toThrow();
    expect(g.log.some((e) => e.type === 'grenade')).toBe(false);
    expect(g.items?.s1.grenade).toBe(true);
  });

  it('союзник у зоні кожного кандидата — кидка немає; той самий союзник мертвий — кидок є', () => {
    const play = (alliesAlive: boolean) => {
      const g = open(
        [
          makeUnit({ id: 's1', side: 'player', pos: { x: 2, y: 2 }, ap: GRENADE_AP_COST }),
          makeUnit({ id: 's2', side: 'player', pos: { x: 7, y: 2 }, alive: alliesAlive, ap: 0 }), // у хресті a1
          makeUnit({ id: 's3', side: 'player', pos: { x: 7, y: 3 }, alive: alliesAlive, ap: 0 }), // у хресті a2
          ...pair(6, 2),
        ],
        { items: { s1: { medkit: false, grenade: true } } }
      );
      botTurn(g);
      return g.log.filter((e) => e.type === 'grenade').length;
    };
    expect(play(true)).toBe(0);
    expect(play(false)).toBe(1);
  });
});

describe('Т.142: ходи, ліміти і запобіжники циклів', () => {
  it('aliensTurn у хід гравця — помилка з повідомленням', () => {
    const m = mkMission('u142a');
    expect(() => aliensTurn(m.state)).toThrow('aliensTurn: зараз не хід демонів Розриву');
  });

  it('botTurn у хід прибульців — помилка з повідомленням', () => {
    const m = mkMission('u142a');
    botTurn(m.state);
    expect(() => botTurn(m.state)).toThrow('botTurn: зараз не хід гравця');
  });

  it('DemoSteps після over не діє і на іншому стані (контракт «після over — без дій»)', () => {
    const drv = new DemoSteps(240);
    const done = mkMission('u142d', 'збирач', 7);
    let guard = 0;
    while (!drv.step(done.state).over) if (guard++ > 100000) throw new Error('не завершується');
    const fresh = mkMission('u1');
    const before = JSON.stringify(fresh.state);
    expect(drv.step(fresh.state)).toEqual({ acted: false, over: true });
    expect(drv.step(fresh.state)).toEqual({ acted: false, over: true });
    expect(JSON.stringify(fresh.state)).toBe(before);
  });

  // Прибулець із штучним запасом AP і ціль, якої не вбити: кожен aiStep — постріл.
  function alienGuard(): GameState {
    const g = open(
      [
        makeUnit({ id: 's1', side: 'player', pos: { x: 9, y: 6 }, hp: 1_000_000, maxHp: 1_000_000 }),
        makeUnit({ id: 'a1', side: 'alien', pos: { x: 6, y: 6 } }),
      ],
      { side: 'alien' }
    );
    g.units[1].ap = 1000;
    return g;
  }

  it('aliensTurn: рівно 60 дій, кожна — справжня дія ядра; хід переходить гравцю', () => {
    const g = alienGuard();
    expect(aliensTurn(g)).toBe(60);
    expect(burstsBy(g, 'a1')).toBe(60);
    expect(g.activeSide).toBe('player');
  });

  it('autoBattle зупиняється рівно на ліміті півходів', () => {
    // u142b без ліміту — перемога на 3-му півході; ліміт 2 зупиняє бій раніше
    const r = autoBattle(mkMission('u142b').state, 2);
    expect(r).toEqual({ outcome: 'триває', halfTurns: 2 });
  });

  it('DemoSteps зупиняється рівно на ліміті півходів', () => {
    const m = mkMission('u142c');
    const drv = new DemoSteps(2); // п17.4: на u142c бій закінчується на 3-му півході
    let guard = 0;
    while (!drv.step(m.state).over) if (guard++ > 10000) throw new Error('не завершується');
    expect(drv.halfTurnsDone).toBe(2);
    expect(missionOutcome(m.state)).toBe('триває');
  });

  it('DemoSteps: точна форма кожного результату; дії і півходи — як у botTurn/aliensTurn', () => {
    const instant = mkMission('u142d', 'збирач', 7);
    const stepped = mkMission('u142d', 'збирач', 7);
    let actions = 0;
    let halfTurns = 0;
    while (missionOutcome(instant.state) === 'триває' && halfTurns < 240) {
      actions += instant.state.activeSide === 'player' ? botTurn(instant.state) : aliensTurn(instant.state);
      halfTurns++;
    }
    const drv = new DemoSteps(240);
    const seen: Record<string, number> = {};
    let guard = 0;
    for (;;) {
      const r = drv.step(stepped.state);
      const k = JSON.stringify(r);
      seen[k] = (seen[k] ?? 0) + 1;
      if (r.over) break;
      if (guard++ > 100000) throw new Error('не завершується');
    }
    expect(seen).toEqual({
      [JSON.stringify({ acted: true, over: false })]: actions,
      [JSON.stringify({ acted: false, over: false })]: halfTurns,
      [JSON.stringify({ acted: false, over: true })]: 1,
    });
  });

  it('DemoSteps: солдат — не більше 60 дій за півхід, далі хід переходить', () => {
    const g = open([
      makeUnit({ id: 's1', side: 'player', pos: { x: 6, y: 6 } }),
      makeUnit({ id: 'a1', side: 'alien', pos: { x: 9, y: 6 }, hp: 1_000_000, maxHp: 1_000_000 }),
    ]);
    g.units[0].ap = 1000;
    const drv = new DemoSteps(240);
    const acted = Array.from({ length: 61 }, () => drv.step(g).acted);
    expect(acted.filter(Boolean).length).toBe(60);
    expect(acted[60]).toBe(false);
    expect(g.activeSide).toBe('alien');
    expect(burstsBy(g, 's1')).toBe(60);
  });

  it('DemoSteps: прибулець — не більше 60 дій за півхід, далі хід переходить', () => {
    const g = alienGuard();
    const drv = new DemoSteps(240);
    const acted = Array.from({ length: 61 }, () => drv.step(g).acted);
    expect(acted.filter(Boolean).length).toBe(60);
    expect(acted[60]).toBe(false);
    expect(g.activeSide).toBe('player');
    expect(burstsBy(g, 'a1')).toBe(60);
  });
});

// п18.6 (ADR-0158): дозор бота партії — тримати позицію в дозорі замість наступу (hold).
describe('п18.6: дозор бота (hold)', () => {
  function holdGame(alienPos: { x: number; y: number }, blocked: string[] = []): GameState {
    return createGame({
      map: { width: 20, height: 20, blocked: new Set(blocked) },
      rng: mulberry32(42),
      units: [
        makeUnit({ id: 's1', side: 'player', pos: { x: 2, y: 2 } }),
        makeUnit({ id: 's2', side: 'player', pos: { x: 2, y: 6 } }),
        makeUnit({ id: 'a1', side: 'alien', pos: alienPos }),
      ],
    });
  }
  const players = (g: GameState) => g.units.filter((u) => u.side === 'player');

  it('ворога не видно: кожен стає в дозор і лишається на місці; без hold — іде назустріч', () => {
    const g = holdGame({ x: 19, y: 19 });
    const acts = botTurn(g, undefined, true);
    expect(acts).toBe(2);
    expect(players(g).map((u) => [u.id, u.pos.x, u.pos.y, u.overwatch, u.maxAp - u.ap])).toEqual([
      ['s1', 2, 2, true, OVERWATCH_AP_COST],
      ['s2', 2, 6, true, OVERWATCH_AP_COST],
    ]);
    expect(g.activeSide).toBe('alien');
    const h = holdGame({ x: 19, y: 19 });
    botTurn(h);
    expect(h.log.some((e) => e.type === 'move')).toBe(true);
    expect(h.log.some((e) => e.type === 'overwatch')).toBe(false);
  });

  it(`AP менше за ${OVERWATCH_AP_COST} — без дії і без помилки; рівно ${OVERWATCH_AP_COST} — дозор`, () => {
    const g = holdGame({ x: 19, y: 19 });
    players(g)[0].ap = OVERWATCH_AP_COST - 1;
    players(g)[1].ap = OVERWATCH_AP_COST;
    expect(botTurn(g, undefined, true)).toBe(1);
    expect(players(g).map((u) => u.overwatch)).toEqual([false, true]);
    expect(g.log.some((e) => e.type === 'move')).toBe(false);
  });

  it('ціль на лінії вогню — стріляє, як без hold', () => {
    const g = holdGame({ x: 8, y: 2 });
    const h = holdGame({ x: 8, y: 2 });
    botTurn(g, undefined, true);
    botTurn(h);
    expect(g.log[0]).toMatchObject({ type: 'shot', shooterId: 's1', targetId: 'a1' });
    expect(g.log[0]).toEqual(h.log[0]);
  });

  it('ворога бачить сторона, а в бійця лінії немає — дозор замість руху до цілі', () => {
    // стіна закриває a1 від s1; s2 бачить a1 і стріляє, s1 без hold пішов би до цілі
    const wall = ['5,1', '5,2', '5,3'];
    const g = holdGame({ x: 8, y: 2 }, wall);
    const h = holdGame({ x: 8, y: 2 }, wall);
    botTurn(g, undefined, true);
    botTurn(h);
    expect(h.log.some((e) => e.type === 'move' && e.unitId === 's1')).toBe(true);
    expect(g.log.some((e) => e.type === 'move' && e.unitId === 's1')).toBe(false);
    expect(players(g)[0].overwatch).toBe(true);
  });

  it('без hold авто-бій байт-у-байт як до п18.6; з hold бій закінчується — ворог іде до зони висадки', () => {
    const a = mkMission('h1');
    const b = mkMission('h1');
    expect(autoBattle(a.state)).toEqual(autoBattle(b.state, 240, undefined, false));
    expect(JSON.stringify(a.state.log)).toBe(JSON.stringify(b.state.log));
    const c = mkMission('h1');
    const r = autoBattle(c.state, 240, undefined, true);
    expect(r.outcome).not.toBe('триває');
    expect(c.state.log.some((e) => e.type === 'overwatch')).toBe(true);
  });
});
