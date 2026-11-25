// src/core/ai-kinds.test.ts
// п17.3 (ADR-0149 п. 6, п. 13; EARS 6): ШІ за типом — гончак, голем, око; дозор лише
// по видимих стороні (рішення власника «А. Лише по видимих»).

import { describe, expect, it } from 'vitest';
import {
  VISION_RANGE,
  createGame,
  distance,
  endTurn,
  makeUnit,
  moveUnit,
  setOverwatch,
  sideSees,
  type GameMap,
  type GameState,
  type RNG,
  type Unit,
  type Vec2,
} from './combat';
import { VISION_RANGE as MAP_VISION_RANGE } from './map';
import { EYE_KEEP_DISTANCE, aiStep } from './ai';
import { makeEnemy } from './enemies';

const alwaysHit: RNG = () => 0;
const alwaysMiss: RNG = () => 0.99;

const openMap = (w = 30, h = 30, blocked: string[] = []): GameMap => ({ width: w, height: h, blocked: new Set(blocked) });

const op = (id: string, pos: Vec2, hp = 10): Unit => makeUnit({ id, side: 'player', pos, hp, maxHp: hp });

function battle(units: Unit[], map = openMap(), rng: RNG = alwaysMiss): GameState {
  return createGame({ map, units, rng, startingSide: 'alien' });
}

function playAlienTurn(state: GameState, patrol?: Vec2[]): number {
  let steps = 0;
  while (steps < 100 && aiStep(state, patrol)) steps++;
  return steps;
}

const moves = (st: GameState, id: string) => st.log.filter((e) => e.type === 'move' && e.unitId === id);
const shots = (st: GameState, id: string) => st.log.filter((e) => e.type === 'shot' && e.shooterId === id);

describe('п17.3: дозор — лише по видимих стороні (рішення власника «А»)', () => {
  it('VISION_RANGE — одна константа для огляду і дозору', () => {
    expect(VISION_RANGE).toBe(12);
    expect(MAP_VISION_RANGE).toBe(VISION_RANGE);
  });

  it('око в дозорі не б’є на 14 клітинок по цілі, якої не бачить жоден ворог', () => {
    const e = makeEnemy('eye', 'a1', 0, { x: 0, y: 0 });
    const st = battle([e, op('s1', { x: 14, y: 1 })], openMap(), alwaysHit);
    setOverwatch(st, 'a1');
    endTurn(st);
    moveUnit(st, 's1', [{ x: 14, y: 0 }]);
    expect(shots(st, 'a1')).toHaveLength(0);
    expect(e.overwatch).toBe(true); // дозор не розряджено
  });

  it('ту саму ціль бачить інший ворог — око в дозорі б’є на 14', () => {
    const e = makeEnemy('eye', 'a1', 0, { x: 0, y: 0 });
    const spotter = makeEnemy('demon', 'a2', 0, { x: 20, y: 0 });
    const st = battle([e, spotter, op('s1', { x: 14, y: 1 })], openMap(), alwaysHit);
    setOverwatch(st, 'a1');
    endTurn(st);
    moveUnit(st, 's1', [{ x: 14, y: 0 }]);
    expect(shots(st, 'a1')).toHaveLength(1);
    expect(shots(st, 'a1')[0]).toMatchObject({ targetId: 's1', mode: 'aimed', hit: true });
  });

  it('у межах огляду — як раніше: дозор б’є за дальністю і лінією', () => {
    const e = makeEnemy('eye', 'a1', 0, { x: 0, y: 0 });
    const st = battle([e, op('s1', { x: 12, y: 1 })], openMap(), alwaysHit);
    setOverwatch(st, 'a1');
    endTurn(st);
    moveUnit(st, 's1', [{ x: 12, y: 0 }]);
    expect(shots(st, 'a1')).toHaveLength(1);
  });

  it('sideSees: огляд 12, лінія по рельєфу, лише живі юніти сторони', () => {
    const d = makeEnemy('demon', 'a1', 0, { x: 0, y: 0 });
    const st = battle([d, op('s1', { x: 20, y: 20 })], openMap(30, 30, ['3,0']));
    expect(sideSees(st, 'alien', { x: 12, y: 5 })).toBe(true);
    expect(sideSees(st, 'alien', { x: 13, y: 5 })).toBe(false); // далі огляду
    expect(sideSees(st, 'alien', { x: 6, y: 0 })).toBe(false); // за стіною
    d.alive = false;
    expect(sideSees(st, 'alien', { x: 2, y: 2 })).toBe(false);
    expect(sideSees(st, 'player', { x: 20, y: 15 })).toBe(true);
  });
});

describe('п17.3: гончак (ADR-0149 п. 13)', () => {
  it('біжить до найслабшого видимого, а не до найближчого, і б’є', () => {
    const h = makeEnemy('hound', 'a1', 0, { x: 5, y: 5 });
    const st = battle([h, op('s1', { x: 5, y: 7 }, 10), op('s2', { x: 10, y: 5 }, 4)]);
    aiStep(st);
    const to = moves(st, 'a1').at(-1);
    expect(to?.type === 'move' && distance(to.to, { x: 10, y: 5 })).toBe(1);
    aiStep(st);
    expect(shots(st, 'a1')[0]).toMatchObject({ targetId: 's2', mode: 'snap' });
  });

  it('рівність HP — найближчий', () => {
    const h = makeEnemy('hound', 'a1', 0, { x: 5, y: 5 });
    const st = battle([h, op('s1', { x: 12, y: 5 }, 6), op('s2', { x: 5, y: 9 }, 6)]);
    playAlienTurn(st);
    expect(shots(st, 'a1').every((s) => s.type === 'shot' && s.targetId === 's2')).toBe(true);
    expect(shots(st, 'a1').length).toBeGreaterThan(0);
  });

  it('дійде цього ходу — лишає AP на удар; удари до кінця AP', () => {
    const h = makeEnemy('hound', 'a1', 0, { x: 0, y: 5 });
    const st = battle([h, op('s1', { x: 12, y: 5 }, 30)]);
    playAlienTurn(st);
    expect(moves(st, 'a1')).toHaveLength(11); // 14 AP − 11 = 3 на удар
    expect(shots(st, 'a1')).toHaveLength(1);
    expect(h.ap).toBe(0);
  });

  it('не дійде — біжить на всі AP, без дозору', () => {
    const h = makeEnemy('hound', 'a1', 0, { x: 0, y: 5 });
    const spotter = makeEnemy('demon', 'a2', 0, { x: 22, y: 14 });
    const st = battle([h, spotter, op('s1', { x: 20, y: 5 })]);
    spotter.ap = 0;
    playAlienTurn(st);
    expect(moves(st, 'a1')).toHaveLength(14);
    expect(shots(st, 'a1')).toHaveLength(0);
    expect(h.overwatch).toBe(false);
  });

  it('впритул по діагоналі — коротший шлях, удар по діагоналі', () => {
    const h = makeEnemy('hound', 'a1', 0, { x: 0, y: 0 });
    const st = battle([h, op('s1', { x: 3, y: 3 }, 30)]);
    aiStep(st);
    expect(moves(st, 'a1')).toHaveLength(4); // до (2,2) — 4 кроки, до 4-сусіда — 5
    expect(h.pos).toEqual({ x: 2, y: 2 });
  });

  it('найслабший недосяжний — наступний за порядком', () => {
    // s2 (найслабший) замурований стінами з усіх боків
    const walls = ['14,4', '15,4', '16,4', '14,5', '16,5', '14,6', '15,6', '16,6'];
    const h = makeEnemy('hound', 'a1', 0, { x: 5, y: 5 });
    const st = battle([h, op('s1', { x: 5, y: 9 }, 10), op('s2', { x: 15, y: 5 }, 2)], openMap(30, 30, walls));
    aiStep(st);
    const to = moves(st, 'a1').at(-1);
    expect(to?.type === 'move' && distance(to.to, { x: 5, y: 9 })).toBe(1);
    // єдина видима ціль недосяжна (сусідні клітинки зайняті) — гончак не діє (дозору не тримає)
    const guards = [
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ].map((p, k) => makeEnemy('demon', 'g' + k, k, p));
    const h2 = makeEnemy('hound', 'a1', 0, { x: 5, y: 5 });
    const st2 = battle([h2, ...guards, op('s2', { x: 0, y: 0 }, 2)]);
    for (const g of guards) g.ap = 0;
    expect(aiStep(st2)).toBe(false);
  });

  it('впритул до своєї цілі без AP на удар — чекає, а не біжить до іншої', () => {
    const h = makeEnemy('hound', 'a1', 0, { x: 5, y: 5 });
    const st = battle([h, op('s1', { x: 5, y: 6 }, 3), op('s2', { x: 9, y: 5 }, 9)]);
    h.ap = 2; // createGame відновлює AP — після нього
    expect(aiStep(st)).toBe(false);
    expect(st.log).toHaveLength(0);
  });

  it('нікого не видно: патруль без резерву і без дозору', () => {
    const h = makeEnemy('hound', 'a1', 0, { x: 0, y: 0 });
    const st = battle([h, op('s1', { x: 25, y: 25 })]);
    playAlienTurn(st, [{ x: 25, y: 25 }]);
    expect(moves(st, 'a1')).toHaveLength(14);
    expect(h.overwatch).toBe(false);
    const st2 = battle([makeEnemy('hound', 'a1', 0, { x: 0, y: 0 }), op('s1', { x: 25, y: 25 })]);
    expect(aiStep(st2)).toBe(false); // без зони патруля — нічого
  });
});

describe('п17.3: голем (ADR-0149 п. 13)', () => {
  it('рух лишає AP на постріл: 5 кроків, потім швидкий постріл', () => {
    const g = makeEnemy('golem', 'a1', 0, { x: 0, y: 5 });
    const st = battle([g, op('s1', { x: 12, y: 5 })]);
    playAlienTurn(st);
    expect(moves(st, 'a1')).toHaveLength(5);
    expect(shots(st, 'a1')).toHaveLength(1);
    expect(shots(st, 'a1')[0]).toMatchObject({ mode: 'snap' });
    expect(g.ap).toBe(0);
  });

  it('не дістав і після руху — решта AP у дозор', () => {
    const g = makeEnemy('golem', 'a1', 0, { x: 0, y: 5 });
    const spotter = makeEnemy('demon', 'a2', 0, { x: 22, y: 14 });
    const st = battle([g, spotter, op('s1', { x: 20, y: 5 })]);
    spotter.ap = 0;
    playAlienTurn(st);
    expect(moves(st, 'a1')).toHaveLength(5);
    expect(shots(st, 'a1')).toHaveLength(0);
    expect(g.overwatch).toBe(true);
  });

  it('нікого не видно — патруль і дозор, як демон', () => {
    const g = makeEnemy('golem', 'a1', 0, { x: 0, y: 0 });
    const st = battle([g, op('s1', { x: 25, y: 25 })]);
    playAlienTurn(st);
    expect(g.overwatch).toBe(true);
    expect(moves(st, 'a1')).toHaveLength(0);
  });
});

describe('п17.3: око (ADR-0149 п. 13)', () => {
  it('найближчий ближче за 6 — відхід із запасом AP, потім прицільний постріл', () => {
    expect(EYE_KEEP_DISTANCE).toBe(6);
    const e = makeEnemy('eye', 'a1', 0, { x: 10, y: 10 });
    const st = battle([e, op('s1', { x: 13, y: 10 })]);
    playAlienTurn(st);
    expect(distance(e.pos, { x: 13, y: 10 })).toBeGreaterThanOrEqual(EYE_KEEP_DISTANCE);
    expect(moves(st, 'a1').length).toBeLessThanOrEqual(5);
    expect(shots(st, 'a1')).toHaveLength(1);
    expect(shots(st, 'a1')[0]).toMatchObject({ mode: 'aimed', targetId: 's1' });
    expect(st.log.findIndex((x) => x.type === 'shot')).toBeGreaterThan(st.log.findIndex((x) => x.type === 'move'));
  });

  it('відходу немає (кут, стіни) — стріляє з місця', () => {
    const e = makeEnemy('eye', 'a1', 0, { x: 0, y: 0 });
    const st = battle([e, op('s1', { x: 2, y: 0 })], openMap(30, 30, ['0,1', '1,1']));
    st.units[1].pos = { x: 1, y: 0 }; // впритул, клітинка (1,0) зайнята — шляху з кута немає
    playAlienTurn(st);
    expect(moves(st, 'a1')).toHaveLength(0);
    expect(shots(st, 'a1')).toHaveLength(2); // 10 AP — два прицільні
  });

  it('на відстані 6–16 — стріляє без руху', () => {
    const e = makeEnemy('eye', 'a1', 0, { x: 0, y: 5 });
    const st = battle([e, op('s1', { x: 10, y: 5 })]);
    playAlienTurn(st);
    expect(moves(st, 'a1')).toHaveLength(0);
    expect(shots(st, 'a1')).toHaveLength(2);
  });

  it('ціль далі 16 (бачить інший ворог) — рух на позицію пострілу, потім постріл', () => {
    const e = makeEnemy('eye', 'a1', 0, { x: 0, y: 5 });
    const spotter = makeEnemy('demon', 'a2', 0, { x: 28, y: 5 });
    const st = battle([e, spotter, op('s1', { x: 20, y: 5 })]);
    spotter.ap = 0;
    playAlienTurn(st);
    expect(moves(st, 'a1')).toHaveLength(4); // до x = 4 — дальність 16
    expect(shots(st, 'a1')).toHaveLength(1);
  });

  it('позиції пострілу цього ходу немає — рух до цілі, не ближче 6', () => {
    const e = makeEnemy('eye', 'a1', 0, { x: 0, y: 5 });
    const spotter = makeEnemy('demon', 'a2', 0, { x: 29, y: 29 });
    const st = battle([e, spotter, op('s1', { x: 28, y: 22 })]);
    spotter.ap = 0;
    playAlienTurn(st);
    expect(moves(st, 'a1')).toHaveLength(10);
    expect(shots(st, 'a1')).toHaveLength(0);
  });

  it('на позиції пострілу без AP на постріл — дозор, а не підхід', () => {
    const e = makeEnemy('eye', 'a1', 0, { x: 0, y: 5 });
    const st = battle([e, op('s1', { x: 10, y: 5 })]);
    e.ap = 4;
    playAlienTurn(st);
    expect(moves(st, 'a1')).toHaveLength(0);
    expect(e.overwatch).toBe(true);
  });

  it('близько, без відходу і без AP на постріл — дозор', () => {
    const e = makeEnemy('eye', 'a1', 0, { x: 0, y: 0 });
    const st = battle([e, op('s1', { x: 1, y: 0 })], openMap(30, 30, ['0,1', '1,1']));
    e.ap = 3;
    playAlienTurn(st);
    expect(moves(st, 'a1')).toHaveLength(0);
    expect(e.overwatch).toBe(true);
  });

  it('нікого не видно — патруль і дозор, як демон', () => {
    const e = makeEnemy('eye', 'a1', 0, { x: 0, y: 0 });
    const st = battle([e, op('s1', { x: 25, y: 25 })]);
    playAlienTurn(st, [{ x: 25, y: 25 }]);
    expect(moves(st, 'a1')).toHaveLength(7); // 10 AP − резерв дозору 3
    expect(e.overwatch).toBe(true);
  });
});

describe('п17.3: демон — без змін', () => {
  it('демон без kind іде до найближчого, а не до найслабшого', () => {
    const d = makeEnemy('demon', 'a1', 0, { x: 5, y: 5 });
    expect(d.kind).toBeUndefined();
    const st = battle([d, op('s1', { x: 5, y: 7 }, 10), op('s2', { x: 9, y: 5 }, 2)], openMap(), alwaysHit);
    aiStep(st);
    expect(shots(st, 'a1')[0]).toMatchObject({ targetId: 's1', mode: 'auto' });
  });
});
