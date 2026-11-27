// п20.3 (ADR-0167; EARS 5 Фази 20): ШІ ворогів, авто-бій і бот загону з укриттям.
// Гейти байт-у-байт: бій без опції `cover` — жадібний шлях як до п20.3 (coverStep повертає його ж).
import { describe, expect, it } from 'vitest';
import {
  OVERWATCH_AP_COST as OW,
  RIFLE,
  createGame,
  endTurn,
  makeUnit,
  moveUnit,
  mulberry32,
  type GameMap,
  type GameState,
  type Unit,
  type Vec2,
} from './combat';
import { EYE_BEAM, makeEnemy } from './enemies';
import { COVER_SCORE, COVER_SLACK, cheapestShotAp, coverRank, coverStep, movedThisTurn, pathToward, reachable } from './ai-utils';
import { aiStep } from './ai';
import { bestModeAp, botTurn } from './ai-bot';

const k = (p: Vec2): string => p.x + ',' + p.y;
const mapOf = (walls: Vec2[], low: Vec2[] = [], w = 20, h = 12): GameMap => ({
  width: w,
  height: h,
  blocked: new Set(walls.map(k)),
  low: new Set(low.map(k)),
});
const game = (map: GameMap, units: Unit[], cover: boolean, side: 'player' | 'alien' = 'alien'): GameState =>
  createGame({ map, units, rng: mulberry32(7), startingSide: side, cover });
const soldier = (id: string, pos: Vec2, range = 12): Unit => makeUnit({ id, side: 'player', pos, weapon: { ...RIFLE, range } });
// Кінець першого ходу юніта id (останній `move` у журналі), або його позиція.
const endOf = (st: GameState, id: string): Vec2 => {
  const moves = st.log.filter((e) => e.type === 'move' && e.unitId === id);
  const last = moves[moves.length - 1];
  return last && last.type === 'move' ? last.to : st.units.find((u) => u.id === id)!.pos;
};

describe('coverRank: найгірше укриття клітинки від видимих супротивників', () => {
  const T: Vec2 = { x: 5, y: 5 };
  const me = soldier('s1', T);
  const shooter = (pos: Vec2): Unit => makeEnemy('demon', 'a1', 0, pos);

  it('стіна з боку стрільця — повне (2), низька перешкода — пів (1), відкрито — фланг (0), нікого — поза вогнем (3)', () => {
    const e = shooter({ x: 10, y: 5 });
    // стіна на діагоналі (кут рівно 45°) не закриває лінію вогню — укриття повне
    expect(coverRank(game(mapOf([{ x: 6, y: 4 }]), [me, e], true), me, T, [e])).toBe(COVER_SCORE.full);
    expect(coverRank(game(mapOf([], [{ x: 6, y: 4 }]), [me, e], true), me, T, [e])).toBe(COVER_SCORE.half);
    expect(coverRank(game(mapOf([]), [me, e], true), me, T, [e])).toBe(COVER_SCORE.none);
    expect(coverRank(game(mapOf([]), [me, e], true), me, T, [])).toBe(COVER_SCORE.out);
  });

  it('стрілець поза дальністю, за стіною на лінії чи з «Кігтями» — не рахується; з кількох — найгірше', () => {
    const far = shooter({ x: 18, y: 5 }); // 13 клітинок > дальності 12
    expect(coverRank(game(mapOf([]), [me, far], true), me, T, [far])).toBe(COVER_SCORE.out);
    const behind = shooter({ x: 10, y: 5 });
    expect(coverRank(game(mapOf([{ x: 7, y: 5 }]), [me, behind], true), me, T, [behind])).toBe(COVER_SCORE.out);
    const hound = makeEnemy('hound', 'a2', 0, { x: 6, y: 5 });
    expect(coverRank(game(mapOf([]), [me, hound], true), me, T, [hound])).toBe(COVER_SCORE.out);
    const east = shooter({ x: 10, y: 5 });
    const west = makeEnemy('demon', 'a3', 1, { x: 0, y: 5 });
    const st = game(mapOf([{ x: 6, y: 4 }]), [me, east, west], true);
    expect(coverRank(st, me, T, [east])).toBe(COVER_SCORE.full);
    expect(coverRank(st, me, T, [east, west])).toBe(COVER_SCORE.none); // із заходу — фланг
    expect(coverRank(st, me, T, [west, east])).toBe(COVER_SCORE.none); // найгірше — незалежно від порядку
  });

  it('власна клітинка юніта лінію не закриває (він піде з неї)', () => {
    const u = soldier('s1', { x: 7, y: 5 }); // стоїть на лінії стрільця до клітинки T
    const e = shooter({ x: 10, y: 5 });
    expect(coverRank(game(mapOf([]), [u, e], true), u, T, [e])).toBe(COVER_SCORE.none);
  });
});

describe('coverStep: хід з укриттям замість жадібного шляху', () => {
  it('бій без `cover`, без шляху чи з порожнім шляхом — той самий масив (байт-у-байт як до п20.3)', () => {
    const me = makeEnemy('demon', 'a1', 0, { x: 18, y: 5 });
    const t = soldier('s1', { x: 1, y: 5 });
    const st = game(mapOf([{ x: 8, y: 4 }]), [me, t], false);
    const greedy = pathToward(st, me, t);
    expect(coverStep(st, me, t, [t], greedy, me.ap)).toBe(greedy);
    const on = game(mapOf([]), [me, t], true);
    expect(coverStep(on, me, t, [t], null, me.ap)).toBeNull();
    const empty: Vec2[] = [];
    expect(coverStep(on, me, t, [t], empty, me.ap)).toBe(empty);
  });

  it('кандидати ближчі до цілі, ніж юніт, і не далі за кінець жадібного шляху + COVER_SLACK', () => {
    expect(COVER_SLACK).toBe(1);
    const me = makeEnemy('demon', 'a1', 0, { x: 18, y: 5 });
    const t = soldier('s1', { x: 1, y: 5 });
    const st = game(mapOf([{ x: 8, y: 4 }]), [me, t], true);
    const greedy = pathToward(st, me, t) as Vec2[];
    const dEnd = Math.max(Math.abs(greedy[greedy.length - 1].x - 1), Math.abs(greedy[greedy.length - 1].y - 5));
    const step = coverStep(st, me, t, [t], greedy, me.ap) as Vec2[];
    const end = step[step.length - 1];
    const d = Math.max(Math.abs(end.x - 1), Math.abs(end.y - 5));
    expect(d).toBeLessThanOrEqual(dEnd + COVER_SLACK);
    expect(d).toBeLessThan(17);
    expect(step.length).toBeLessThanOrEqual(me.ap);
    expect(coverRank(st, me, end, [t])).toBeGreaterThan(coverRank(st, me, greedy[greedy.length - 1], [t]));
  });

  it('краще укриття за межею кінець шляху + COVER_SLACK відкидається; при рівному укритті — ближче до цілі', () => {
    // стіна (9,4) дає повне укриття клітинці (10,5) — 9 клітинок до цілі, а кінець шляху (8,5) — 7: за межею 7 + 1
    const me = makeEnemy('demon', 'a1', 0, { x: 18, y: 5 });
    const t = soldier('s1', { x: 1, y: 5 });
    const st = game(mapOf([{ x: 9, y: 4 }]), [me, t], true);
    const greedy = pathToward(st, me, t) as Vec2[];
    expect(greedy[greedy.length - 1]).toEqual({ x: 8, y: 5 });
    expect(coverRank(st, me, { x: 10, y: 5 }, [t])).toBe(COVER_SCORE.full);
    const step = coverStep(st, me, t, [t], greedy, me.ap) as Vec2[];
    expect(step[step.length - 1]).toEqual({ x: 8, y: 5 }); // решта — фланг, з них найближча до цілі
  });

  it('при рівному укритті — клітинка з пострілом по цілі із залишком AP, а не ближча', () => {
    // ціль бʼє лише на 3 — усі кандидати поза її вогнем (ранг 3); демон бʼє на 8, AP 9: постріл (3 AP) лишається
    // з клітинки за 6 кроків — (6,5) за 5 до цілі; ближча (5,5) — за 7 кроків, без залишку на постріл
    const me = makeEnemy('demon', 'a1', 0, { x: 12, y: 5 });
    me.weapon = { ...me.weapon, range: 8 };
    const t = soldier('s1', { x: 1, y: 5 }, 3);
    const st = game(mapOf([]), [me, t], true);
    me.ap = 9; // після createGame
    const greedy = [
      { x: 11, y: 5 },
      { x: 10, y: 5 },
      { x: 9, y: 5 },
    ];
    const step = coverStep(st, me, t, [t], greedy, me.ap) as Vec2[];
    expect(step[step.length - 1]).toEqual({ x: 6, y: 5 });
    expect(step).toHaveLength(6);
  });

  it('кандидат лише ближчий до цілі, ніж юніт: укриття на тій самій відстані — ні', () => {
    // стіна (17,4) дає укриття клітинці (18,4) — 17 до цілі, як і клітинка юніта; бюджет 1 — крок до (17,5)
    const me = makeEnemy('demon', 'a1', 0, { x: 18, y: 5 });
    const t = soldier('s1', { x: 1, y: 5 }, 20); // дальність 20 — клітинки біля юніта під вогнем
    const st = game(mapOf([{ x: 17, y: 4 }]), [me, t], true);
    expect(coverRank(st, me, { x: 18, y: 4 }, [t])).toBeGreaterThan(COVER_SCORE.none);
    expect(coverStep(st, me, t, [t], [{ x: 17, y: 5 }], 1)).toEqual([{ x: 17, y: 5 }]);
  });

  it('умова типу keep відкидає клітинки, що їй не відповідають', () => {
    const me = makeEnemy('demon', 'a1', 0, { x: 18, y: 5 });
    const t = soldier('s1', { x: 1, y: 5 });
    const st = game(mapOf([{ x: 8, y: 4 }]), [me, t], true);
    const greedy = pathToward(st, me, t) as Vec2[];
    const free = coverStep(st, me, t, [t], greedy, me.ap) as Vec2[];
    const bad = free[free.length - 1];
    const kept = coverStep(st, me, t, [t], greedy, me.ap, (p) => k(p) !== k(bad)) as Vec2[];
    expect(k(kept[kept.length - 1])).not.toBe(k(bad));
  });

  it('юніт, що вже ходив цього півходу, далі не йде (null); після кінця ходу — знову йде', () => {
    const me = makeEnemy('demon', 'a1', 0, { x: 18, y: 5 });
    const t = soldier('s1', { x: 1, y: 5 });
    const st = game(mapOf([]), [me, t], true);
    expect(movedThisTurn(st, me)).toBe(false);
    st.log.push({ type: 'move', unitId: 'a1', from: { x: 18, y: 5 }, to: { x: 17, y: 5 } });
    expect(movedThisTurn(st, me)).toBe(true);
    expect(movedThisTurn(st, t)).toBe(false);
    expect(coverStep(st, me, t, [t], pathToward(st, me, t), me.ap)).toBeNull();
    endTurn(st);
    expect(movedThisTurn(st, me)).toBe(false);
  });

  it('reachable: 4 напрямки, без непрохідних і зайнятих клітинок; cheapestShotAp — найдешевший режим зброї', () => {
    const me = soldier('s1', { x: 0, y: 0 });
    const st = game(mapOf([{ x: 1, y: 0 }], [{ x: 0, y: 2 }], 4, 4), [me, soldier('s2', { x: 1, y: 1 })], true);
    expect(reachable(st, me.pos, 2).map((r) => k(r.pos))).toEqual(['0,1']);
    expect(cheapestShotAp(RIFLE)).toBe(3);
    expect(cheapestShotAp(EYE_BEAM)).toBe(EYE_BEAM.modes.aimed.apCost);
  });
});

// Спостерігач: ще один юніт тієї ж сторони біля цілі — сторона бачить ціль, хоч ходець і далі огляду 12.
describe('ШІ ворогів за типом (aiStep) з укриттям', () => {
  const run = (kind: 'demon' | 'golem' | 'hound', cover: boolean, walls: Vec2[]): GameState => {
    const me = makeEnemy(kind, 'a1', 0, { x: 18, y: 5 });
    const spotter = makeEnemy('demon', 'a2', 1, { x: 2, y: 9 });
    const st = game(mapOf(walls), [me, spotter, soldier('s1', { x: 1, y: 5 })], cover);
    aiStep(st);
    return st;
  };

  for (const kind of ['demon', 'golem'] as const) {
    it(kind + ': з `cover` — клітинка з кращим укриттям біля кінця жадібного шляху; без — жадібний шлях', () => {
      const open = endOf(run(kind, false, []), 'a1');
      const wall = { x: open.x, y: 4 }; // стіна біля кінця шляху, по діагоналі до цілі — не на лінії
      const plain = run(kind, false, [wall]);
      expect(endOf(plain, 'a1')).toEqual(open);
      const st = run(kind, true, [wall]);
      const end = endOf(st, 'a1');
      const me = st.units[0];
      const foes = [st.units[2]];
      expect(end).not.toEqual(open);
      expect(coverRank(st, me, end, foes)).toBeGreaterThan(coverRank(st, me, open, foes));
      const moved = st.log.filter((e) => e.type === 'move' && e.unitId === 'a1').length;
      // голем лишає AP на постріл (ADR-0149 п. 13) і з укриттям
      if (kind === 'golem') expect(moved).toBeLessThanOrEqual(me.maxAp - cheapestShotAp(me.weapon));
    });
  }

  it('голем: укриття за межею бюджету (AP мінус постріл) — недосяжне, запас AP лишається', () => {
    const golem = (cover: boolean, walls: Vec2[]): GameState => run('golem', cover, walls);
    const open = endOf(golem(false, []), 'a1');
    const budget = 8 - cheapestShotAp(makeEnemy('golem', 'x', 0, { x: 0, y: 0 }).weapon);
    expect(open).toEqual({ x: 18 - budget, y: 5 });
    // стіна дає повне укриття клітинці на крок далі за бюджет
    const wall = { x: open.x - 2, y: 4 };
    const st = golem(true, [wall]);
    expect(coverRank(st, st.units[0], { x: open.x - 1, y: 5 }, [st.units[2]])).toBe(COVER_SCORE.full);
    expect(st.log.filter((e) => e.type === 'move' && e.unitId === 'a1').length).toBeLessThanOrEqual(budget);
    expect(endOf(st, 'a1')).not.toEqual({ x: open.x - 1, y: 5 });
  });

  it('око: відхід — у клітинку з укриттям (пів за низькою перешкодою), а не найдальшу', () => {
    const go = (cover: boolean): GameState => {
      const eye = makeEnemy('eye', 'a1', 0, { x: 6, y: 5 });
      const st = game(mapOf([], [{ x: 7, y: 5 }]), [eye, soldier('s1', { x: 1, y: 5 }, 16)], cover);
      aiStep(st);
      return st;
    };
    const plain = go(false);
    expect(coverRank(plain, plain.units[0], endOf(plain, 'a1'), [plain.units[1]])).toBe(COVER_SCORE.none);
    const st = go(true);
    expect(coverRank(st, st.units[0], endOf(st, 'a1'), [st.units[1]])).toBe(COVER_SCORE.half);
  });

  it('око: рух до цілі з укриттям — не ближче за EYE_KEEP_DISTANCE, хоч ближче й є пів-укриття', () => {
    // стіна (9,5) закриває постріл з (10,5); AP 5 — на позицію пострілу цього ходу не вистачає (бюджет 0)
    const eye = makeEnemy('eye', 'a1', 0, { x: 10, y: 5 });
    const spotter = makeEnemy('demon', 'a2', 1, { x: 2, y: 9 });
    const st = game(mapOf([{ x: 9, y: 5 }], [{ x: 5, y: 4 }]), [eye, spotter, soldier('s1', { x: 1, y: 5 }, 16)], true);
    eye.ap = 5;
    expect(coverRank(st, eye, { x: 6, y: 4 }, [st.units[2]])).toBe(COVER_SCORE.half); // за 5 до цілі — ближче за 6
    aiStep(st);
    const end = endOf(st, 'a1');
    expect(end).not.toEqual({ x: 10, y: 5 });
    expect(Math.max(Math.abs(end.x - 1), Math.abs(end.y - 5))).toBeGreaterThanOrEqual(6);
  });

  it('гончак укриття не шукає: хід той самий з `cover` і без', () => {
    const wall = [{ x: 9, y: 4 }];
    const a = run('hound', false, wall).log.filter((e) => e.type === 'move');
    const b = run('hound', true, wall).log.filter((e) => e.type === 'move');
    expect(a.length).toBeGreaterThan(0);
    expect(b).toEqual(a);
  });

  it('демон, що вже ходив цього півходу і не дістає пострілом, з `cover` стає в дозор, а не йде далі', () => {
    const go = (cover: boolean): GameState => {
      const me = makeEnemy('demon', 'a1', 0, { x: 18, y: 5 });
      const spotter = makeEnemy('demon', 'a2', 1, { x: 2, y: 9 });
      const st = game(mapOf([]), [me, spotter, soldier('s1', { x: 1, y: 5 })], cover);
      st.log.push({ type: 'move', unitId: 'a1', from: { x: 19, y: 5 }, to: { x: 18, y: 5 } }); // хід цього півходу
      aiStep(st);
      return st;
    };
    expect(go(true).log.at(-1)).toEqual({ type: 'overwatch', unitId: 'a1', armed: true });
    expect(go(false).log.at(-1)?.type).toBe('move'); // без `cover` — як до п20.3: далі до цілі
  });

  it('око: позиція пострілу з укриттям (пів за низькою перешкодою), хоч і на крок довше', () => {
    const go = (cover: boolean): GameState => {
      const eye = makeEnemy('eye', 'a1', 0, { x: 18, y: 5 });
      const spotter = makeEnemy('demon', 'a2', 1, { x: 2, y: 9 });
      const st = game(mapOf([], [{ x: 15, y: 4 }]), [eye, spotter, soldier('s1', { x: 1, y: 5 }, 16)], cover); // дальність 16 — позиції ока під вогнем
      aiStep(st);
      return st;
    };
    expect(endOf(go(false), 'a1')).toEqual({ x: 17, y: 5 }); // найкоротший шлях на позицію пострілу (16 клітинок)
    const st = go(true);
    const end = endOf(st, 'a1');
    expect(coverRank(st, st.units[0], end, [st.units[2]])).toBe(COVER_SCORE.half);
    expect(st.log.filter((e) => e.type === 'move' && e.unitId === 'a1')).toHaveLength(2); // на крок довше
  });
});

describe('авто-бій і бот загону (botTurn) з укриттям', () => {
  const run = (cover: boolean, walls: Vec2[]): GameState => {
    const me = soldier('s1', { x: 16, y: 5 }, 5); // дальність 5 — ціль видно, а стріляти ще далеко
    const spotter = soldier('s2', { x: 2, y: 9 }, 1);
    const st = game(mapOf(walls), [me, spotter, makeEnemy('demon', 'a1', 0, { x: 1, y: 5 })], cover, 'player');
    me.ap = 4; // після createGame (він ставить AP активної сторони)
    spotter.ap = 0;
    botTurn(st);
    return st;
  };

  it('хід солдата — у краще укриття, як у ШІ ворогів; без `cover` — жадібний шлях', () => {
    const open = endOf(run(false, []), 's1');
    expect(open).toEqual({ x: 12, y: 5 }); // у дальності демона (12) — фланг
    const wall = { x: 12, y: 4 };
    expect(endOf(run(false, [wall]), 's1')).toEqual(open);
    const st = run(true, [wall]);
    const end = endOf(st, 's1');
    expect(end).not.toEqual(open);
    expect(coverRank(st, st.units[0], end, [st.units[2]])).toBeGreaterThan(COVER_SCORE.none);
  });

  it('штурмовик, що зайняв укриття без пострілу, ривок не витрачає (аудит PR #530); без `cover` — як до п20.3', () => {
    const go = (cover: boolean): GameState => {
      const me = soldier('s1', { x: 12, y: 5 }, 5);
      const spotter = soldier('s2', { x: 2, y: 9 }, 1);
      const st = createGame({
        map: mapOf([]),
        units: [me, spotter, makeEnemy('demon', 'a1', 0, { x: 1, y: 5 })],
        rng: mulberry32(7),
        startingSide: 'player',
        cover,
        roles: { s1: { role: 'assault', used: false } },
      });
      me.ap = 3;
      spotter.ap = 0;
      st.log.push({ type: 'move', unitId: 's1', from: { x: 13, y: 5 }, to: { x: 12, y: 5 } }); // хід цього півходу
      botTurn(st);
      return st;
    };
    expect(go(true).roles?.s1.used).toBe(false);
    expect(go(false).roles?.s1.used).toBe(true);
  });

  it('bestModeAp: зброя з усіма режимами — «Черга» (як до п20.3); з `only` — найкращий з її режимів (ADR-0165 п. 12)', () => {
    expect(bestModeAp(RIFLE)).toBe(RIFLE.modes.auto.apCost);
    expect(bestModeAp(EYE_BEAM)).toBe(EYE_BEAM.modes.aimed.apCost);
    expect(bestModeAp({ ...RIFLE, only: ['snap'] })).toBe(RIFLE.modes.snap.apCost);
  });
});

// п20.6 (ADR-0170; ADR-0165 EARS 10): бот партії в дозорі ховається в укриття — режим `hold` 'cover'.
describe('п20.6: дозор з укриттям (hold «cover»)', () => {
  // око (дальність 16) на сході бачить і дістає всю мапу 20 × 12, стін немає — «поза вогнем» не буває;
  // низька перешкода (6, 5) дає клітинці (5, 5) пів-укриття від ока; у бійця дальність 3 — пострілу немає
  const eye = (): Unit => makeEnemy('eye', 'a1', 0, { x: 12, y: 5 });
  const setup = (cover: boolean, start: Vec2 = { x: 5, y: 7 }): GameState =>
    game(mapOf([], [{ x: 6, y: 5 }]), [soldier('s1', start, 3), eye()], cover, 'player');
  const s1 = (st: GameState): Unit => st.units.find((u) => u.id === 's1')!;
  const rank = (st: GameState): number => coverRank(st, s1(st), s1(st).pos, [st.units[1]]);
  const moves = (st: GameState): number => st.log.filter((e) => e.type === 'move' && e.unitId === 's1').length;

  it('видимий ворог, пострілу немає: хід у досяжну клітинку з кращим укриттям, потім дозор із залишком AP', () => {
    const st = setup(true);
    expect(rank(st)).toBe(COVER_SCORE.none);
    botTurn(st, undefined, 'cover');
    expect(rank(st)).toBe(COVER_SCORE.half);
    expect(moves(st)).toBeGreaterThan(0);
    expect(s1(st).overwatch).toBe(true);
    expect(s1(st).ap).toBe(s1(st).maxAp - moves(st) - OW); // хід — по 1 AP за клітинку, дозор — 3
  });

  it('true — дозор з місця, як до п20.6; бій без `cover` — режим «cover» теж з місця', () => {
    for (const [st, hold] of [
      [setup(true), true],
      [setup(false), 'cover'],
    ] as const) {
      botTurn(st, undefined, hold);
      expect(moves(st)).toBe(0);
      expect(s1(st).pos).toEqual({ x: 5, y: 7 });
      expect(s1(st).overwatch).toBe(true);
    }
  });

  it('клітинка вже з найкращим досяжним укриттям — дозор з місця; AP лише на дозор — без ходу', () => {
    const here = setup(true, { x: 5, y: 5 });
    botTurn(here, undefined, 'cover');
    expect([moves(here), s1(here).overwatch]).toEqual([0, true]);
    const tight = setup(true);
    s1(tight).ap = OW; // рівно на дозор: на хід AP не лишається
    botTurn(tight, undefined, 'cover');
    expect([moves(tight), s1(tight).overwatch]).toEqual([0, true]);
  });

  it('уже ходив цього півходу (аудит PR #533) — далі не йде, лише дозор', () => {
    const st = setup(true);
    moveUnit(st, 's1', [{ x: 4, y: 7 }]); // крок не в укриття
    botTurn(st, undefined, 'cover');
    expect([moves(st), s1(st).pos, s1(st).overwatch]).toEqual([1, { x: 4, y: 7 }, true]);
  });

  it('найближча клітинка з укриттям: з (4, 5) — один крок у (5, 5)', () => {
    const st = setup(true, { x: 4, y: 5 });
    botTurn(st, undefined, 'cover');
    expect([endOf(st, 's1'), moves(st)]).toEqual([{ x: 5, y: 5 }, 1]);
  });
});
