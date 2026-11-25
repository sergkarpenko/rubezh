// src/core/roles.test.ts
// п16.3 (ADR-0147 п. 3, 11, 12; EARS 5, 6, 9): ролі оперативників — дії ролей
// у бою («Ривок», «Точний постріл», «Польова допомога»), копія ролей на місію,
// вибір ролі, правило бота партії і дії ролей у бота бою.

import { describe, expect, it } from 'vitest';
import {
  calculateHitChance,
  createGame,
  DASH_AP_BONUS,
  endTurn,
  evacuate,
  fieldAid,
  FIELD_AID_AP_COST,
  makeUnit,
  mulberry32,
  preciseShot,
  PRECISE_AP_COST,
  roleActionBlock,
  useDash,
  type GameState,
  type RNG,
  type StatefulRng,
  type UnitRole,
} from './combat';
import { autoBattle, botTurn, DemoSteps } from './ai-bot';
import { createGeoGame, type GeoState } from './geo';
import { createMission } from './mission';
import { assignBotRoles, botRole, chooseRole, createRoster, deployRoles, missionSquad, type Roster } from './squad';
import { RANK_THRESHOLDS } from './career';

const alwaysHit: RNG = () => 0;

// Два оперативники поруч і два демони в лінії вогню на відкритому полі 12 × 6.
function roleGame(roles?: Record<string, UnitRole>, rng: RNG = alwaysHit): GameState {
  return createGame({
    map: { width: 12, height: 6, blocked: new Set() },
    rng,
    roles,
    units: [
      makeUnit({ id: 's1', side: 'player', pos: { x: 2, y: 2 } }),
      makeUnit({ id: 's2', side: 'player', pos: { x: 3, y: 2 }, hp: 4, maxHp: 10 }),
      makeUnit({ id: 'a1', side: 'alien', pos: { x: 8, y: 2 }, hp: 10, maxHp: 10 }),
      makeUnit({ id: 'a2', side: 'alien', pos: { x: 8, y: 3 }, hp: 10, maxHp: 10 }),
    ],
  });
}
const slot = (role: UnitRole['role']): UnitRole => ({ role, used: false });
const snap = (g: GameState): string => JSON.stringify([g.units, g.roles, g.log, (g.rng as StatefulRng).state ?? null]);

describe('п16.3: «Ривок» штурмовика', () => {
  it('+4 AP цього ходу за 0 AP, понад максимум; прапорець і подія dash', () => {
    const g = roleGame({ s1: slot('assault') });
    expect(useDash(g, 's1')).toEqual({ ap: 14 });
    expect(g.units[0].ap).toBe(10 + DASH_AP_BONUS);
    expect(g.roles?.s1.used).toBe(true);
    expect(g.log).toEqual([{ type: 'dash', unitId: 's1', ap: 4 }]);
  });

  it('з нулем AP теж працює; наступний хід — знову максимум', () => {
    const g = roleGame({ s1: slot('assault') });
    g.units[0].ap = 0;
    useDash(g, 's1');
    expect(g.units[0].ap).toBe(4);
    endTurn(g);
    endTurn(g);
    expect(g.units[0].ap).toBe(10);
  });

  it('раз за бій: повтор — відмова з причиною, стан без змін', () => {
    const g = roleGame({ s1: slot('assault') });
    useDash(g, 's1');
    const before = snap(g);
    expect(() => useDash(g, 's1')).toThrow('«Ривок» вже використано в цьому бою');
    expect(snap(g)).toBe(before);
  });
});

describe('п16.3: «Точний постріл» снайпера', () => {
  it('6 AP, шанс прицільного, шкода ×1,5 вниз; мітка precise_shot перед shot', () => {
    // rng: 0 — влучання, далі кидок шкоди 0,5 → 3 + floor(0,5 × 4) = 5 → ×1,5 = 7,5 → 7
    const rolls = [0, 0.5];
    const g = roleGame({ s1: slot('sniper') }, () => rolls.shift() ?? 0);
    const r = preciseShot(g, 's1', 'a1');
    expect(r).toEqual({ shots: [{ hit: true, damage: 7 }], targetDown: false });
    expect(g.units[0].ap).toBe(10 - PRECISE_AP_COST);
    expect(g.units[2].hp).toBe(3);
    expect(g.roles?.s1.used).toBe(true);
    expect(g.log).toEqual([
      { type: 'precise_shot', shooterId: 's1', targetId: 'a1' },
      { type: 'shot', shooterId: 's1', targetId: 'a1', mode: 'aimed', hit: true, damage: 7 },
    ]);
  });

  it('шанс — як у прицільного: кидок на межі шансу — промах', () => {
    const g = roleGame({ s1: slot('sniper') }, () => calculateHitChance(g.units[0], 'aimed'));
    const r = preciseShot(g, 's1', 'a1');
    expect(r.shots).toEqual([{ hit: false, damage: 0 }]);
    expect(g.roles?.s1.used).toBe(true); // промах — дію теж використано
  });

  it('найбільша шкода 6 × 1,5 = 9; вбивство зараховується снайперові', () => {
    const rolls = [0, 0.99];
    const g = roleGame({ s1: slot('sniper') }, () => rolls.shift() ?? 0);
    g.units[2].hp = 9;
    expect(preciseShot(g, 's1', 'a1').targetDown).toBe(true);
    expect(g.units[2].alive).toBe(false);
    expect(g.units[0].kills).toBe(1);
    expect(g.log.map((e) => e.type)).toEqual(['precise_shot', 'death', 'shot']);
  });

  it('відмови: бракує AP, поза дальністю, по своїх — стан і rng без змін', () => {
    const g = roleGame({ s1: slot('sniper') }, mulberry32(7));
    const before = snap(g);
    g.units[0].ap = 5;
    expect(() => preciseShot(g, 's1', 'a1')).toThrow('Недостатньо очок дій: «Точний постріл» — 6 AP');
    g.units[0].ap = 10;
    expect(() => preciseShot(g, 's1', 's2')).toThrow('Вогонь по своїх заборонений');
    g.units[2].pos = { x: 11, y: 5 };
    g.units[0].weapon = { ...g.units[0].weapon, range: 3 };
    expect(() => preciseShot(g, 's1', 'a1')).toThrow('Ціль поза дальністю зброї');
    g.units[2].pos = { x: 8, y: 2 };
    g.units[0].weapon = g.units[1].weapon;
    expect(snap(g)).toBe(before);
  });
});

describe('п16.3: «Польова допомога» медика', () => {
  it('сусідові: +3 HP за 2 AP, без гелю; подія field_aid', () => {
    const g = roleGame({ s1: slot('medic') });
    expect(fieldAid(g, 's1', 's2')).toEqual({ healed: 3 });
    expect(g.units[1].hp).toBe(7);
    expect(g.units[0].ap).toBe(10 - FIELD_AID_AP_COST);
    expect(g.items).toBeUndefined();
    expect(g.log).toEqual([{ type: 'field_aid', unitId: 's1', targetId: 's2', healed: 3 }]);
  });

  it('собі і з капом maxHp — за правилом гелю', () => {
    const g = roleGame({ s2: slot('medic') });
    g.units[1].hp = 9;
    expect(fieldAid(g, 's2', 's2')).toEqual({ healed: 1 });
    expect(g.units[1].hp).toBe(10);
  });

  it('відмови: ворог, відстань 2, здорова ціль, мертва, бракує AP — стан без змін', () => {
    const g = roleGame({ s1: slot('medic') });
    const before = snap(g);
    expect(() => fieldAid(g, 's1', 'a1')).toThrow('Допомога можлива лише своїм');
    g.units[1].pos = { x: 4, y: 2 };
    expect(() => fieldAid(g, 's1', 's2')).toThrow('Ціль поза межами допомоги (відстань ≤1)');
    g.units[1].pos = { x: 3, y: 3 }; // діагональ — сусід
    expect(() => fieldAid(g, 's1', 's1')).toThrow('Ціль не поранена');
    g.units[1].alive = false;
    expect(() => fieldAid(g, 's1', 's2')).toThrow('Ціль уже мертва');
    g.units[1].alive = true;
    g.units[0].ap = 1;
    expect(() => fieldAid(g, 's1', 's2')).toThrow('Недостатньо очок дій: «Польова допомога» — 2 AP');
    g.units[0].ap = 10;
    g.units[1].pos = { x: 3, y: 2 };
    expect(snap(g)).toBe(before);
    fieldAid(g, 's1', 's2');
    expect(() => fieldAid(g, 's1', 's2')).toThrow('«Польова допомога» вже використано в цьому бою');
  });
});

describe('п16.3: недоступна дія ролі — українська причина (EARS 6)', () => {
  it('roleActionBlock: немає ролі, чужа роль, використано, AP; null — доступна', () => {
    const g = roleGame({ s1: slot('sniper'), s2: { role: 'medic', used: true } });
    expect(roleActionBlock(roleGame(), 's1', 'assault')).toBe('Немає ролі: дія «Ривок» недоступна');
    expect(roleActionBlock(g, 'a1', 'sniper')).toBe('Немає ролі: дія «Точний постріл» недоступна');
    expect(roleActionBlock(g, 's1', 'assault')).toBe('«Ривок» — дія ролі штурмовика');
    expect(roleActionBlock(g, 's1', 'medic')).toBe('«Польова допомога» — дія ролі медика');
    expect(roleActionBlock(g, 's2', 'sniper')).toBe('«Точний постріл» — дія ролі снайпера');
    expect(roleActionBlock(g, 's2', 'medic')).toBe('«Польова допомога» вже використано в цьому бою');
    expect(roleActionBlock(g, 's1', 'sniper')).toBeNull();
    g.units[0].ap = PRECISE_AP_COST - 1;
    expect(roleActionBlock(g, 's1', 'sniper')).toBe('Недостатньо очок дій: «Точний постріл» — 6 AP');
    g.units[0].ap = PRECISE_AP_COST; // точна межа — доступна
    expect(roleActionBlock(g, 's1', 'sniper')).toBeNull();
  });

  it('команда без ролі, чужою роллю чи не в свій хід — throw тим самим текстом', () => {
    const g = roleGame({ s1: slot('sniper') });
    expect(() => useDash(g, 's2')).toThrow('Немає ролі: дія «Ривок» недоступна');
    expect(() => useDash(g, 's1')).toThrow('«Ривок» — дія ролі штурмовика');
    expect(() => fieldAid(g, 's1', 's2')).toThrow('«Польова допомога» — дія ролі медика');
    endTurn(g);
    expect(() => preciseShot(g, 's1', 'a1')).toThrow('Зараз хід не сторони player');
    expect(g.roles?.s1.used).toBe(false);
  });

  it('евакуйований і хід демонів: дія ролі недоступна', () => {
    const g = createGame({
      map: { width: 12, height: 6, blocked: new Set() },
      rng: alwaysHit,
      roles: { s1: slot('assault') },
      evacZone: [{ x: 2, y: 2 }],
      units: [makeUnit({ id: 's1', side: 'player', pos: { x: 2, y: 2 } }), makeUnit({ id: 'a1', side: 'alien', pos: { x: 8, y: 2 } })],
    });
    endTurn(g);
    expect(() => useDash(g, 's1')).toThrow('Зараз хід не сторони player');
    endTurn(g);
    evacuate(g, 's1');
    expect(roleActionBlock(g, 's1', 'assault')).toBe('Оперативника немає на полі бою');
    expect(() => useDash(g, 's1')).toThrow('Невідомий юніт: s1');
    expect(g.roles?.s1.used).toBe(false);
  });

  it('бій без ролей — у стані немає поля roles (байт-у-байт як до п16.3)', () => {
    expect('roles' in roleGame()).toBe(false);
  });
});

// Ростер, де перші троє вже «Бійці» (досвід на порозі) без ролі.
function veterans(): Roster {
  const r = createRoster();
  for (const s of r.soldiers.slice(0, 3)) r.careers[s.id].xp = RANK_THRESHOLDS[1];
  return r;
}

describe('п16.3: ролі в ростері — копія на місію, вибір, бот партії (EARS 9)', () => {
  it('deployRoles: лише оперативники загону з роллю, used скинуто; без ролей — null', () => {
    const r = veterans();
    const squad = missionSquad(r);
    expect(deployRoles(r, squad)).toBeNull();
    chooseRole(r, 's2', 'medic');
    chooseRole(r, 's3', 'sniper');
    r.careers.s4.role = 'assault'; // не в загоні
    expect(deployRoles(r, squad)).toEqual({ s2: { role: 'medic', used: false }, s3: { role: 'sniper', used: false } });
    // чужий юніт без кар'єри — без ролі, без винятку
    expect(deployRoles(r, [makeUnit({ id: 'x1', side: 'player', pos: { x: 0, y: 0 } })])).toBeNull();
  });

  it('chooseRole: лише «Боєць» і вище без ролі; невідома роль і чужий id — відмова', () => {
    const r = veterans();
    expect(() => chooseRole(r, 's4', 'assault')).toThrow('Роль обирається зі звання «Боєць»: s4');
    expect(() => chooseRole(r, 's99', 'assault')).toThrow('Оперативника немає в ростері: s99');
    const gone = veterans();
    gone.soldiers = gone.soldiers.filter((s) => s.id !== 's1'); // кар'єра без оперативника
    expect(() => chooseRole(gone, 's1', 'assault')).toThrow('Оперативника немає в ростері: s1');
    expect(() => chooseRole(r, 's1', 'pilot' as never)).toThrow('Невідома роль: pilot');
    chooseRole(r, 's1', 'sniper');
    expect(r.careers.s1.role).toBe('sniper');
    expect(() => chooseRole(r, 's1', 'medic')).toThrow('Роль уже обрано: s1');
  });

  it('botRole: найменше серед оперативників зі званням; рівність — штурмовик → снайпер → медик', () => {
    const r = veterans();
    expect(botRole(r)).toBe('assault');
    chooseRole(r, 's1', 'assault');
    expect(botRole(r)).toBe('sniper');
    chooseRole(r, 's2', 'sniper');
    expect(botRole(r)).toBe('medic');
    chooseRole(r, 's3', 'medic');
    expect(botRole(r)).toBe('assault');
    // роль рекрута (лише з сейву чи тесту) не рахується
    r.careers.s4.role = 'assault';
    r.careers.s5.role = 'assault';
    expect(botRole(r)).toBe('assault');
    delete r.careers.s6; // оперативник без кар'єри не рахується і не ламає правило
    expect(botRole(r)).toBe('assault');
  });

  it('assignBotRoles: по черзі ростеру, кожен бачить ролі попередніх; повтор — нічого', () => {
    const r = veterans();
    expect(assignBotRoles(r)).toEqual(['s1', 's2', 's3']);
    expect(['s1', 's2', 's3'].map((id) => r.careers[id].role)).toEqual(['assault', 'sniper', 'medic']);
    expect(r.careers.s4.role).toBeNull(); // рекрут чекає звання
    expect(assignBotRoles(r)).toEqual([]);
  });
});

describe('п16.3: дії ролей у бота бою (авто-бій і бот партії)', () => {
  it("медик першою дією допомагає найбільш пораненому сусідові і далі б'ється", () => {
    const g = roleGame({ s1: slot('medic') });
    g.units[0].hp = 3; // нестача 7 — більша за 6 у s2: собі
    botTurn(g);
    expect(g.log[0]).toEqual({ type: 'field_aid', unitId: 's1', targetId: 's1', healed: 3 });
    expect(g.log.filter((e) => e.type === 'field_aid')).toHaveLength(1);
    expect(g.log.some((e) => e.type === 'shot' && e.shooterId === 's1')).toBe(true);
    const later = roleGame({ s1: slot('medic') });
    later.units[0].hp = 8; // нестача 2 менша за 6 у s2 — сусідові, хоч він далі в масиві
    botTurn(later);
    expect(later.log[0]).toEqual({ type: 'field_aid', unitId: 's1', targetId: 's2', healed: 3 });
    const tie = roleGame({ s2: slot('medic') });
    tie.units[0].hp = 4; // рівність нестачі — перший за порядком масиву
    botTurn(tie);
    expect(tie.log.find((e) => e.type === 'field_aid')).toEqual({ type: 'field_aid', unitId: 's2', targetId: 's1', healed: 3 });
  });

  it('снайпер стріляє точним пострілом першим, далі — звичайними', () => {
    const g = roleGame({ s1: slot('sniper') });
    botTurn(g);
    const s1shots = g.log.filter((e) => (e.type === 'shot' || e.type === 'precise_shot') && e.shooterId === 's1');
    expect(s1shots[0]).toEqual({ type: 'precise_shot', shooterId: 's1', targetId: 'a1' });
    expect(s1shots.length).toBeGreaterThan(2); // після точного — ще звичайні постріли
    expect(g.log.filter((e) => e.type === 'precise_shot')).toHaveLength(1);
  });

  it('штурмовик робить ривок, коли на чергу бракує AP, і стріляє знову', () => {
    const g = roleGame({ s1: slot('assault') }, () => 0.99); // промахи — ціль жива
    botTurn(g);
    const s1 = g.log.filter((e) => ('unitId' in e && e.unitId === 's1') || ('shooterId' in e && e.shooterId === 's1'));
    const dash = s1.findIndex((e) => e.type === 'dash');
    expect(dash).toBeGreaterThan(0); // спершу черги, ривок — коли AP < 4
    expect(s1.slice(dash + 1).some((e) => e.type === 'shot')).toBe(true);
    expect(g.log.filter((e) => e.type === 'dash')).toHaveLength(1);
    // рівно 4 AP — черга без ривка (межа «AP < ціни черги»)
    const edge = roleGame({ s1: slot('assault') }, () => 0.99);
    edge.units[0].ap = 4;
    botTurn(edge);
    expect(edge.log.find((e) => ('shooterId' in e ? e.shooterId : 'unitId' in e ? e.unitId : '') === 's1')).toMatchObject({
      type: 'shot',
      mode: 'auto',
    });
  });

  it('місія з ролями: autoBattle і DemoSteps дають той самий лог; без ролей — бій без подій ролей', () => {
    const geo: GeoState = createGeoGame({ seed: 9, spawnChance: 0 });
    geo.ufos.push({
      id: 'u1',
      kind: 'збирач',
      pos: { ...geo.base },
      target: { ...geo.base },
      detected: true,
      status: 'приземлився',
      landedTicksLeft: 16,
    });
    const ufo = geo.ufos[0];
    const make = (withRoles: boolean) => {
      const r = veterans();
      if (withRoles) assignBotRoles(r);
      const squad = missionSquad(r);
      return createMission(geo, ufo.id, { squad, roles: deployRoles(r, squad) ?? undefined }).state;
    };
    const a = make(true);
    autoBattle(a);
    const b = make(true);
    const demo = new DemoSteps();
    while (!demo.step(b).over);
    expect(a.log.filter((e) => e.type === 'dash' || e.type === 'precise_shot' || e.type === 'field_aid').length).toBeGreaterThan(0);
    expect(JSON.stringify(b.log)).toBe(JSON.stringify(a.log));
    const plain = make(false);
    autoBattle(plain);
    expect('roles' in plain).toBe(false);
    expect(plain.log.some((e) => e.type === 'dash' || e.type === 'precise_shot' || e.type === 'field_aid')).toBe(false);
  });
});
