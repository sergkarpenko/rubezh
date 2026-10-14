// src/main.test.ts
// П7: юніт-тести «візуальної логіки» main.ts — лише чисті функції без DOM
// (node-середовище vitest; DOM-ініціалізація в main.ts стоїть за typeof document).

import { describe, expect, it } from 'vitest';
import { battleEventText, cellFromPoint, economyEventText, geoEventText, hpColor, samePath, validFireTargets } from './main';
import { createGame, makeUnit, type GameState, type Unit } from './core/combat';
import type { GeoEvent } from './core/geo';
import type { GameEvent } from './core/combat';
import type { EconomyEvent } from './core/economy';

describe('cellFromPoint: клік (CSS-пікселі) → клітинка бойовища', () => {
  // канва 520×520 buffer (20×20 клітинок по 26px — BCELL), розташована на сторінці
  const rect = { left: 10, top: 20, width: 520, height: 520 };
  const canvas = { width: 520, height: 520 };

  it('центр клітинки (3,2)', () => {
    expect(cellFromPoint(10 + 3 * 26 + 13, 20 + 2 * 26 + 13, rect, canvas)).toEqual({ x: 3, y: 2 });
  });

  it('межа клітинки — floor у нижчу', () => {
    expect(cellFromPoint(10 + 4 * 26, 20 + 5 * 26, rect, canvas)).toEqual({ x: 4, y: 5 });
  });

  it('CSS-масштабування канви (2×) не міняє клітинку', () => {
    const scaled = { left: 0, top: 0, width: 1040, height: 1040 };
    expect(cellFromPoint(2 * (5 * 26 + 12), 2 * (1 * 26 + 12), scaled, canvas)).toEqual({ x: 5, y: 1 });
  });

  it('клік поза канвою зліва — відʼємна клітинка (межі перевіряє обробник)', () => {
    const c = cellFromPoint(10 - 5, 20 + 3, rect, canvas);
    expect(c.x).toBeLessThan(0);
  });
});

describe('samePath: дедуплікація превʼю шляху під курсором', () => {
  it('null проти null — не той самий (тригер перерисовки)', () => {
    expect(samePath(null, null)).toBe(false);
  });

  it('null проти шляху — false', () => {
    expect(samePath(null, [{ x: 1, y: 1 }])).toBe(false);
    expect(samePath([{ x: 1, y: 1 }], null)).toBe(false);
  });

  it('ідентичні шляхи — true', () => {
    const a = [
      { x: 1, y: 2 },
      { x: 2, y: 2 },
    ];
    expect(
      samePath(a, [
        { x: 1, y: 2 },
        { x: 2, y: 2 },
      ])
    ).toBe(true);
  });

  it('різна довжина / інша клітинка — false', () => {
    expect(
      samePath(
        [{ x: 1, y: 1 }],
        [
          { x: 1, y: 1 },
          { x: 2, y: 1 },
        ]
      )
    ).toBe(false);
    expect(samePath([{ x: 1, y: 1 }], [{ x: 2, y: 1 }])).toBe(false);
  });
});

describe('hpColor: колір HP у ростері', () => {
  it('повне HP — зелений, понад половину — жовтий', () => {
    expect(hpColor(10, 10)).toBe('#7fbf7f');
    expect(hpColor(9, 10)).toBe('#d8b25a');
  });

  it('рівно половина і нижче — червоний (строга межа > maxHp/2)', () => {
    expect(hpColor(5, 10)).toBe('#ff9c9c');
    expect(hpColor(1, 10)).toBe('#ff9c9c');
  });
});

describe('geoEventText: фільтр туману стратегічного журналу (4.2)', () => {
  const known = new Set(['u1']);

  const ev = (e: Partial<GeoEvent> & { type: GeoEvent['type'] }): GeoEvent => e as GeoEvent;

  it('доба і виявлення — видно завжди', () => {
    expect(geoEventText(ev({ type: 'day', day: 2, minute: 0 }), known)).toEqual({ text: '— Доба 2 —', cls: '' });
    expect(geoEventText(ev({ type: 'ufo_detected', ufoId: 'u2', pos: { x: 1, y: 1 }, minute: 5 }), known)).toEqual({
      text: 'Виявлено НЛО: u2',
      cls: '',
    });
  });

  it('приземлення/відліт видно лише для раніше виявлених НЛО', () => {
    expect(geoEventText(ev({ type: 'ufo_landed', ufoId: 'u1', pos: { x: 2, y: 2 }, minute: 9 }), known)?.text).toContain('приземлився');
    expect(geoEventText(ev({ type: 'ufo_landed', ufoId: 'uX', pos: { x: 2, y: 2 }, minute: 9 }), known)).toBe(null);
    expect(geoEventText(ev({ type: 'ufo_left', ufoId: 'u1', minute: 30 }), known)?.text).toContain('відлетів');
    expect(geoEventText(ev({ type: 'ufo_left', ufoId: 'uX', minute: 30 }), known)).toBe(null);
  });

  it('спавн і рух НЛО приховано туманом; результати місій з класами win/lose', () => {
    expect(geoEventText(ev({ type: 'ufo_spawned', ufoId: 'u3', kind: 'розвідник', pos: { x: 0, y: 0 }, minute: 1 }), known)).toBe(null);
    expect(geoEventText(ev({ type: 'ufo_move', ufoId: 'u1', from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, minute: 2 }), known)).toBe(null);
    expect(geoEventText(ev({ type: 'mission_won', ufoId: 'u1', minute: 60 }), known)).toEqual({ text: 'Місію зачищено ✓', cls: 'win' });
    expect(geoEventText(ev({ type: 'mission_lost', ufoId: 'u1', minute: 60 }), known)).toEqual({ text: 'Загін втрачено ✗', cls: 'lose' });
  });
});

describe('battleEventText: події бою → журнал', () => {
  const name = (id: string): string => (id === 's1' ? 'Гарт' : 'Морок');
  const ev = (e: Partial<GameEvent> & { type: GameEvent['type'] }): GameEvent => e as GameEvent;

  it('постріл: влучання з пошкодженням / промах', () => {
    expect(battleEventText(ev({ type: 'shot', shooterId: 's1', targetId: 'a1', mode: 'aimed', hit: true, damage: 4 }), name)).toEqual({
      text: 'Гарт → Морок (прицільний): −4',
      cls: '',
    });
    expect(
      battleEventText(ev({ type: 'shot', shooterId: 's1', targetId: 'a1', mode: 'auto', hit: false, damage: 0 }), name)?.text
    ).toContain('промах');
  });

  it('смерть — клас lose; рух/хід/заступа — не для журналу', () => {
    expect(battleEventText(ev({ type: 'death', unitId: 'a1', killerId: 's1' }), name)).toEqual({ text: '✝ Морок загинув', cls: 'lose' });
    expect(battleEventText(ev({ type: 'move', unitId: 's1', from: { x: 0, y: 0 }, to: { x: 1, y: 0 } }), name)).toBe(null);
    expect(battleEventText(ev({ type: 'turn', turn: 2, side: 'alien' }), name)).toBe(null);
    expect(battleEventText(ev({ type: 'overwatch', unitId: 's1', armed: true }), name)).toBe(null);
  });
});

describe('economyEventText: події економіки → журнал (П4.5, ADR-0021)', () => {
  it('дотація, премія і витрати — рядки з класами кольорів журналу', () => {
    expect(economyEventText({ type: 'allowance', day: 3, amount: 100 } as EconomyEvent)).toEqual({
      text: 'Дотація за добу 3: +100',
      cls: '',
    });
    expect(economyEventText({ type: 'mission_bonus', kind: 'розвідник', amount: 150 } as EconomyEvent)).toEqual({
      text: 'Премія за місію (розвідник): +150',
      cls: 'win',
    });
    expect(economyEventText({ type: 'spend', amount: 100 } as EconomyEvent)).toEqual({ text: 'Витрати: −100', cls: 'lose' });
  });
});

describe('validFireTargets: валідні цілі зведеного режиму пострілу (П6.14)', () => {
  // Чиста мапа 20×20 з однією стіною на лінії (5,5)→(9,5); стрілець «p» у (5,5).
  const shooter = makeUnit({ id: 'p', side: 'player', pos: { x: 5, y: 5 } });
  const mk = (id: string, x: number, y: number, alive = true): Unit => makeUnit({ id, side: 'alien', pos: { x, y }, alive });
  const state = (units: Unit[]): GameState =>
    createGame({
      map: { width: 20, height: 20, blocked: new Set(['7,5']) },
      units: [shooter, ...units],
    });
  const vis = (keys: string[]): ReadonlySet<string> => new Set(keys);

  it('видимий прибульець у дальності з лінією вогню — валідна ціль', () => {
    const diag = mk('a1', 6, 6); // дистанція 1, Брезенхем (5,5)→(6,6) стіни (7,5) не перетинає
    const st = state([diag]);
    expect(validFireTargets(st, shooter, vis(['6,6']))).toEqual([diag]);
  });

  it('туман: невидима ціль не підсвічується (ADR-0006)', () => {
    const a = mk('a1', 6, 6);
    expect(validFireTargets(state([a]), shooter, vis([]))).toEqual([]);
  });

  it('поза дальністю зброї (12) — не валідна', () => {
    const far = mk('a1', 18, 5); // дистанція 13 > 12
    expect(validFireTargets(state([far]), shooter, vis(['18,5']))).toEqual([]);
  });

  it('немає лінії вогню (стіна на прямій) — не валідна', () => {
    const behind = mk('a1', 9, 5); // стіна (7,5) на прямій (5,5)→(9,5)
    expect(validFireTargets(state([behind]), shooter, vis(['9,5']))).toEqual([]);
  });

  it('мертвий прибульець і свій юніт — не цілі', () => {
    const dead = mk('a1', 6, 6, false);
    const st = state([dead]);
    expect(validFireTargets(st, shooter, vis(['6,6']))).toEqual([]);
    expect(validFireTargets(st, shooter, vis(['5,5']))).toEqual([]); // стрілець — не ціль
  });
});
