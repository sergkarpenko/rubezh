// src/core/career-tree.test.ts
// п22.2 (ADR-0182 п. 1, 7, 8; ADR-0183; EARS 1, 7): дерево розвитку бійця — каталог розвилок
// «Сержанта» і «Ветерана», вибір і прирости, ефекти спеціалізацій у бою, правило бота,
// сейв v5 з гілками і сейв v4 без них.

import { describe, expect, it } from 'vitest';
import {
  calculateHitChance,
  createGame,
  endTurn,
  fieldAid,
  makeUnit,
  moveUnit,
  preciseShot,
  resolveAttack,
  setOverwatch,
  useDash,
  type GameState,
  type RNG,
  type UnitRole,
} from './combat';
import {
  applyBranchBonus,
  awaitingBranch,
  BRANCH_EFFECTS,
  BRANCH_NAMES,
  branchOptions,
  CAREER_TREE,
  newCareer,
  RANK_THRESHOLDS,
  SERGEANT_RANK,
  VETERAN_RANK,
  type CareerBranch,
} from './career';
import { assignBotBranches, botBranch, chooseBranch, createRoster, deployRoles, type Roster } from './squad';
import { createParty, deserializeParty, SAVE_VERSION, SAVE_VERSION_V4, serializeParty } from './save';

const alwaysHit: RNG = () => 0;

function duel(roles: Record<string, UnitRole>, rng: RNG = alwaysHit): GameState {
  return createGame({
    map: { width: 12, height: 6, blocked: new Set() },
    rng,
    roles,
    units: [
      makeUnit({ id: 's1', side: 'player', pos: { x: 2, y: 2 } }),
      makeUnit({ id: 's2', side: 'player', pos: { x: 3, y: 3 }, hp: 1, maxHp: 10 }),
      makeUnit({ id: 'a1', side: 'alien', pos: { x: 8, y: 2 }, hp: 10, maxHp: 10 }),
    ],
  });
}

// Ростер: перші троє — з роллю і досвідом звання `rank`.
function ranked(rank: number): Roster {
  const r = createRoster();
  const roles = ['assault', 'sniper', 'medic'] as const;
  r.soldiers.slice(0, 3).forEach((s, i) => {
    r.careers[s.id].xp = RANK_THRESHOLDS[rank];
    r.careers[s.id].role = roles[i];
  });
  return r;
}

describe('п22.2: каталог розвилок (ADR-0183)', () => {
  it('на роль — дві спеціалізації «Сержанта», на «Ветерана» — дві навички; у кожної гілки назва й ефект', () => {
    expect(CAREER_TREE.sergeant).toEqual({
      assault: ['breakthrough', 'plating'],
      sniper: ['hunter', 'sentinel'],
      medic: ['surgeon', 'rescuer'],
    });
    expect(CAREER_TREE.veteran).toEqual(['hardened', 'tactician']);
    expect(Object.values(BRANCH_NAMES)).toEqual([
      'Прорив',
      'Панцир',
      'Мисливець',
      'Вартовий',
      'Хірург',
      'Рятівник',
      'Загартований',
      'Тактик',
    ]);
    for (const b of Object.keys(BRANCH_NAMES) as CareerBranch[]) expect(BRANCH_EFFECTS[b].length).toBeGreaterThan(0);
    expect([SERGEANT_RANK, VETERAN_RANK]).toEqual([2, 3]);
    expect(RANK_THRESHOLDS).toEqual([0, 2, 5, 9]); // EARS 1: пороги як на main d6d9b8c
  });

  it('awaitingBranch: спершу роль, далі «Сержант», далі «Ветеран»; перескок — по черзі', () => {
    const c = newCareer(0);
    c.xp = RANK_THRESHOLDS[3];
    expect(awaitingBranch(c)).toBeNull(); // без ролі — чекає ролі, а не гілки
    c.role = 'sniper';
    expect(awaitingBranch(c)).toBe('sergeant');
    expect(branchOptions(c, 'sergeant')).toEqual(['hunter', 'sentinel']);
    c.branches = { sergeant: 'hunter' };
    expect(awaitingBranch(c)).toBe('veteran');
    expect(branchOptions(c, 'veteran')).toEqual(['hardened', 'tactician']);
    c.branches.veteran = 'tactician';
    expect(awaitingBranch(c)).toBeNull();
    c.xp = RANK_THRESHOLDS[2] - 1; // «Боєць»
    c.branches = undefined;
    expect(awaitingBranch(c)).toBeNull();
    expect(branchOptions({ ...c, role: null }, 'sergeant')).toEqual([]);
  });

  it('прирости гілки в запис юніта: «Панцир» — броня 1, «Загартований» — +2 HP, «Тактик» — +1 AP; решта — без змін', () => {
    const u = makeUnit({ id: 's1', side: 'player', pos: { x: 0, y: 0 } });
    const before = JSON.stringify(u);
    for (const b of ['breakthrough', 'hunter', 'sentinel', 'surgeon', 'rescuer'] as const) applyBranchBonus(u, b);
    expect(JSON.stringify(u)).toBe(before);
    applyBranchBonus(u, 'plating');
    applyBranchBonus(u, 'hardened');
    applyBranchBonus(u, 'tactician');
    expect([u.armor, u.maxHp, u.hp, u.maxAp, u.ap]).toEqual([1, 12, 12, 11, 11]);
  });
});

describe('п22.2: вибір гілки і бот партії (EARS 1, ADR-0182 п. 7)', () => {
  it('chooseBranch: варіант розвилки, назавжди, прирости — у юніт ростеру', () => {
    const r = ranked(3);
    chooseBranch(r, 's1', 'plating');
    expect(r.careers.s1.branches).toEqual({ sergeant: 'plating' });
    expect(r.soldiers[0].armor).toBe(1);
    chooseBranch(r, 's1', 'hardened');
    expect(r.careers.s1.branches).toEqual({ sergeant: 'plating', veteran: 'hardened' });
    expect(() => chooseBranch(r, 's1', 'tactician')).toThrow('Розвилки, що чекає вибору, немає: s1');
  });

  it('відмови: чужа спеціалізація, без звання, чужий id — стан без змін', () => {
    const r = ranked(2);
    const before = JSON.stringify(r);
    expect(() => chooseBranch(r, 's1', 'hunter')).toThrow('Гілка не з цієї розвилки: hunter');
    expect(() => chooseBranch(r, 's1', 'hardened')).toThrow('Гілка не з цієї розвилки: hardened');
    expect(() => chooseBranch(r, 's4', 'plating')).toThrow('Розвилки, що чекає вибору, немає: s4');
    expect(() => chooseBranch(r, 's99', 'plating')).toThrow('Оперативника немає в ростері: s99');
    expect(JSON.stringify(r)).toBe(before);
  });

  it('botBranch: якої найменше в ростері, рівність — порядок каталогу', () => {
    const r = ranked(3);
    r.careers.s4.xp = RANK_THRESHOLDS[2];
    r.careers.s4.role = 'assault';
    expect(botBranch(r, r.careers.s1, 'sergeant')).toBe('breakthrough');
    chooseBranch(r, 's1', 'breakthrough');
    expect(botBranch(r, r.careers.s4, 'sergeant')).toBe('plating');
    expect(botBranch(r, r.careers.s1, 'veteran')).toBe('hardened');
  });

  it('assignBotBranches: обидві розвилки за перескок, по черзі ростеру; роль не обирає', () => {
    const r = ranked(3);
    r.careers.s4.xp = RANK_THRESHOLDS[3]; // без ролі — чекає ролі
    expect(assignBotBranches(r)).toEqual(['s1', 's2', 's3']);
    expect([r.careers.s1.branches, r.careers.s2.branches, r.careers.s3.branches]).toEqual([
      { sergeant: 'breakthrough', veteran: 'hardened' },
      { sergeant: 'hunter', veteran: 'tactician' },
      { sergeant: 'surgeon', veteran: 'hardened' },
    ]);
    expect(r.careers.s4.branches).toBeUndefined();
    expect(assignBotBranches(r)).toEqual([]);
  });

  it('deployRoles: спеціалізація — у ролі бою, «Рятівник» — з додатковим використанням; без гілки — як до п22.2', () => {
    const r = ranked(2);
    chooseBranch(r, 's1', 'breakthrough');
    chooseBranch(r, 's3', 'rescuer');
    expect(deployRoles(r, r.soldiers.slice(0, 3))).toEqual({
      s1: { role: 'assault', used: false, spec: 'breakthrough' },
      s2: { role: 'sniper', used: false },
      s3: { role: 'medic', used: false, spec: 'rescuer', extraUses: 1 },
    });
  });
});

describe('п22.2: спеціалізації в бою', () => {
  it('«Прорив»: «Ривок» +6 AP', () => {
    const g = duel({ s1: { role: 'assault', used: false, spec: 'breakthrough' } });
    expect(useDash(g, 's1')).toEqual({ ap: 16 });
    expect(g.log).toEqual([{ type: 'dash', unitId: 's1', bonus: 6 }]);
  });

  it('«Мисливець»: «Точний постріл» — шкода ×2 (кидок 0,5 → 5 → 10)', () => {
    const rolls = [0, 0.5];
    const g = duel({ s1: { role: 'sniper', used: false, spec: 'hunter' } }, () => rolls.shift() ?? 0);
    expect(preciseShot(g, 's1', 'a1')).toEqual({ shots: [{ hit: true, damage: 10 }], targetDown: true });
  });

  it('«Хірург»: «Польова допомога» +5 HP; «Рятівник» — двічі за бій', () => {
    const g = duel({ s1: { role: 'medic', used: false, spec: 'surgeon' } });
    expect(fieldAid(g, 's1', 's2')).toEqual({ healed: 5 });
    expect(() => fieldAid(g, 's1', 's2')).toThrow('«Польова допомога» вже використано в цьому бою');
    const h = duel({ s1: { role: 'medic', used: false, spec: 'rescuer', extraUses: 1 } });
    expect(fieldAid(h, 's1', 's2')).toEqual({ healed: 3 });
    expect(h.roles?.s1).toEqual({ role: 'medic', used: false, spec: 'rescuer', extraUses: 0 });
    expect(fieldAid(h, 's1', 's2')).toEqual({ healed: 3 });
    expect(h.roles?.s1.used).toBe(true);
    expect(() => fieldAid(h, 's1', 's2')).toThrow('«Польова допомога» вже використано в цьому бою');
  });

  it('«Вартовий»: дозор без штрафу ×0,7 — кидок між шансами влучає лише у «Вартового»', () => {
    const fire = (spec?: 'sentinel'): boolean => {
      let roll = 0;
      const g = duel(spec ? { s1: { role: 'sniper', used: false, spec } } : {}, () => roll);
      roll = calculateHitChance(g.units[0], 'snap') * 0.85; // вище ×0,7, нижче ×1
      g.units[2].pos = { x: 8, y: 1 };
      setOverwatch(g, 's1');
      endTurn(g);
      moveUnit(g, 'a1', [{ x: 7, y: 1 }]);
      const shot = g.log.find((e) => e.type === 'shot');
      return shot?.type === 'shot' && shot.hit;
    };
    expect(fire('sentinel')).toBe(true);
    expect(fire()).toBe(false);
  });

  it('«Панцир» у бою: влучання «Швидким» по броні 1 — мінус 1 шкоди', () => {
    const rolls = [0, 0]; // влучання, найменша шкода гвинтівки 3 → 2
    const g = duel({}, () => rolls.shift() ?? 0);
    g.units[0].armor = 1;
    endTurn(g);
    expect(resolveAttack(g, 'a1', 's1', 'snap').shots).toEqual([{ hit: true, damage: 2 }]);
    expect(g.units[0].hp).toBe(8);
  });
});

describe('п22.2: сейв v5 (ADR-0182 п. 8, EARS 7)', () => {
  it('v5 зберігає гілки і прирости; save → load → save — байт-у-байт', () => {
    const p = createParty(7);
    const r = p.roster;
    const s = r.soldiers[0];
    r.careers[s.id].xp = RANK_THRESHOLDS[3];
    r.careers[s.id].role = 'assault';
    chooseBranch(r, s.id, 'plating');
    chooseBranch(r, s.id, 'tactician');
    const json = serializeParty(p, 'T');
    expect(JSON.parse(json).version).toBe(SAVE_VERSION);
    expect(SAVE_VERSION).toBe(5);
    const q = deserializeParty(json);
    expect(q.roster.careers[s.id].branches).toEqual({ sergeant: 'plating', veteran: 'tactician' });
    expect([q.roster.soldiers[0].armor, q.roster.soldiers[0].maxAp]).toEqual([1, 11]);
    q.roster.careers[s.id].branches!.veteran = 'hardened'; // копія, а не спільний об'єкт
    expect(r.careers[s.id].branches?.veteran).toBe('tactician');
    expect(serializeParty(deserializeParty(json), 'T')).toBe(json);
  });

  it('v4 відкривається без гілок і зберігається як v5; гілки в v4 — пошкоджений сейв', () => {
    const p = createParty(7);
    p.roster.careers.s1.xp = RANK_THRESHOLDS[2];
    p.roster.careers.s1.role = 'medic';
    const v4 = JSON.parse(serializeParty(p, 'T'));
    v4.version = SAVE_VERSION_V4;
    const q = deserializeParty(JSON.stringify(v4));
    expect(q.roster.careers.s1.branches).toBeUndefined();
    expect(awaitingBranch(q.roster.careers.s1)).toBe('sergeant');
    expect(JSON.parse(serializeParty(q, 'T')).version).toBe(5);
    v4.state.roster.careers.s1.branches = { sergeant: 'surgeon' };
    expect(() => deserializeParty(JSON.stringify(v4))).toThrow("Пошкоджені дані збереження: кар'єри оперативників");
  });

  it('v5: гілка не своєї ролі, без звання, «Ветеран» без «Сержанта», зайве поле — пошкоджений сейв', () => {
    const p = createParty(7);
    p.roster.careers.s1.xp = RANK_THRESHOLDS[2];
    p.roster.careers.s1.role = 'medic';
    const base = JSON.parse(serializeParty(p, 'T'));
    const bad = (branches: unknown, xp: number = RANK_THRESHOLDS[2]): string => {
      const d = structuredClone(base);
      d.state.roster.careers.s1.branches = branches;
      d.state.roster.careers.s1.xp = xp;
      return JSON.stringify(d);
    };
    expect(deserializeParty(bad({ sergeant: 'surgeon' })).roster.careers.s1.branches).toEqual({ sergeant: 'surgeon' });
    for (const b of [{ sergeant: 'hunter' }, { veteran: 'hardened' }, { sergeant: 'surgeon', x: 1 }, null, ['surgeon']]) {
      expect(() => deserializeParty(bad(b, RANK_THRESHOLDS[3]))).toThrow("Пошкоджені дані збереження: кар'єри оперативників");
    }
    expect(() => deserializeParty(bad({ sergeant: 'surgeon' }, RANK_THRESHOLDS[1]))).toThrow("кар'єри оперативників");
    expect(() => deserializeParty(bad({ sergeant: 'surgeon', veteran: 'hardened' }))).toThrow("кар'єри оперативників");
  });
});
