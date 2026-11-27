// п20.4 (ADR-0165 п. 5–8, 12–13; ADR-0168; EARS 6, 8): каталог зброї, протоколи, вироби «Кузні»,
// склад і видача зброї, зброя загиблого, сейв, режими зброї в бою і «Точний постріл».
import { describe, expect, it } from 'vitest';
import {
  RIFLE,
  calculateHitChance,
  createGame,
  makeUnit,
  mulberry32,
  resolveAttack,
  roleActionBlock,
  setOverwatch,
  weaponHasMode,
  type GameState,
  type Unit,
  type Weapon,
} from './combat';
import { FORGE_WEAPONS, MACHINE_GUN, SHOTGUN, SNIPER_RIFLE, WEAPONS, WEAPON_IDS, isForgeWeapon } from './weapons';
import { PROJECTS, PROJECT_CATALOG, WEAPON_PROJECTS, startProject, type ResearchState } from './research';
import {
  ITEM_IDS,
  WORKSHOP_CATALOG,
  emptyStore,
  equipItem,
  equipWeapon,
  orderItem,
  removeLostEquipment,
  settleConsumables,
  unequipItem,
  workshopTick,
  type WorkshopState,
} from './workshop';
import { SAVE_VERSION, createParty, deserializeParty, serializeParty, type Party } from './save';

const rich = (p: Party): Party => {
  p.econ.money = 10_000;
  return p;
};
const done = (r: ResearchState, ...ids: (typeof r.completed)[number][]): void => {
  r.completed.push(...ids);
};
const stock = (w: WorkshopState, id: (typeof FORGE_WEAPONS)[number], n = 1): void => {
  w.store[id] += n;
};

describe('каталог зброї (ADR-0165 п. 5; назви — рішення власника п20.4 «А. Тип + назва»)', () => {
  it('чотири види: «Гарт» — чинний RIFLE, решта — числа плану фази, один режим (`only`)', () => {
    expect(WEAPON_IDS).toEqual(['rifle', 'shotgun', 'sniper', 'mg']);
    expect(FORGE_WEAPONS).toEqual(['shotgun', 'sniper', 'mg']);
    expect(WEAPONS.rifle).toBe(RIFLE);
    expect(RIFLE.name).toBe('АР-14 «Гарт»');
    const row = (w: Weapon) => [w.name, w.damage, w.range, w.only, w.modes[w.only![0]]];
    expect(row(SHOTGUN)).toEqual(['Дробовик «Шквал»', [4, 8], 6, ['snap'], { apCost: 3, accuracyMod: 1, shots: 1 }]);
    expect(row(SNIPER_RIFLE)).toEqual(['Гвинтівка «Голка»', [4, 7], 18, ['aimed'], { apCost: 6, accuracyMod: 1.3, shots: 1 }]);
    expect(row(MACHINE_GUN)).toEqual(['Кулемет «Град»', [3, 5], 12, ['auto'], { apCost: 5, accuracyMod: 0.45, shots: 4 }]);
  });

  it('профілі недоступних режимів дорівнюють дозволеному — дозор (`modes.snap`) бере профіль зброї', () => {
    for (const w of [SHOTGUN, SNIPER_RIFLE, MACHINE_GUN]) {
      const p = w.modes[w.only![0]];
      expect(w.modes.snap).toEqual(p);
      expect(w.modes.aimed).toEqual(p);
      expect(w.modes.auto).toEqual(p);
      expect(['snap', 'aimed', 'auto'].filter((m) => weaponHasMode(w, m as 'snap'))).toEqual(w.only);
    }
  });

  it('isForgeWeapon — лише зброя «Кузні»', () => {
    expect(FORGE_WEAPONS.every(isForgeWeapon)).toBe(true);
    expect(isForgeWeapon('rifle')).toBe(false);
    expect(isForgeWeapon('armor')).toBe(false);
  });
});

describe('протоколи і вироби зброї (ADR-0165 п. 6, 12; EARS 6)', () => {
  it('свій протокол на кожну: назва — назва зброї, числа-кандидати, передумови; PROJECTS без змін', () => {
    expect(WEAPON_PROJECTS.map((p) => [p.id, p.name, p.cost, p.points, p.prerequisite])).toEqual([
      ['shotgun', 'Дробовик «Шквал»', 80, 20, undefined],
      ['sniper', 'Гвинтівка «Голка»', 96, 24, 'optics'],
      ['mg', 'Кулемет «Град»', 110, 28, 'armor'],
    ]);
    for (const p of WEAPON_PROJECTS) expect(PROJECT_CATALOG[p.id]).toBe(p);
    expect(PROJECTS.map((p) => p.id)).toEqual(['armor', 'optics', 'medkit', 'lab-extension', 'grenade', 'gun-module']);
    expect(ITEM_IDS).toEqual(['medkit', 'grenade', 'optics', 'armor', 'gun-module']); // бот і скрипти — без зброї (п20.6)
    expect([WORKSHOP_CATALOG.shotgun, WORKSHOP_CATALOG.sniper, WORKSHOP_CATALOG.mg].map((d) => [d.name, d.cost, d.ticks])).toEqual([
      ['Дробовик «Шквал»', 60, 16],
      ['Гвинтівка «Голка»', 70, 20],
      ['Кулемет «Град»', 80, 24],
    ]);
    expect(emptyStore()).toMatchObject({ shotgun: 0, sniper: 0, mg: 0 });
  });

  it('«Голка» — після «Кібернетичного ока», «Град» — після «Композитної броні»; виріб — лише після протоколу', () => {
    const p = rich(createParty(42));
    expect(() => startProject(p.econ, p.research, 'sniper')).toThrow('Передумову не завершено: Кібернетичне око');
    expect(() => startProject(p.econ, p.research, 'mg')).toThrow('Передумову не завершено: Композитна броня');
    expect(() => orderItem(p.econ, p.workshop, p.research, 'shotgun')).toThrow('Предмет ще не досліджено: Дробовик «Шквал»');
    startProject(p.econ, p.research, 'shotgun');
    expect(p.econ.money).toBe(10_000 - 80);
    done(p.research, 'shotgun');
    orderItem(p.econ, p.workshop, p.research, 'shotgun');
    expect(p.econ.money).toBe(10_000 - 80 - 60);
    for (let i = 0; i < 16; i++) workshopTick(p.workshop);
    expect(p.workshop.store.shotgun).toBe(1);
    expect(p.workshop.log.at(-1)).toEqual({ type: 'produced', id: 'shotgun' });
  });

  it('ціни — з множником науки пресета («легкий» ×0,5)', () => {
    const p = rich(createParty(42, 'легкий'));
    startProject(p.econ, p.research, 'shotgun', 'легкий');
    done(p.research, 'shotgun');
    orderItem(p.econ, p.workshop, p.research, 'shotgun', 'легкий');
    expect(p.econ.money).toBe(10_000 - 40 - 30);
  });
});

describe('видача зброї (ADR-0165 п. 13; EARS 6)', () => {
  it('equipWeapon: зі складу на оперативника, попередня — на склад, «Гарт» — без складу; Unit.weapon — з каталогу', () => {
    const p = createParty(42);
    const s = p.roster.soldiers[0];
    stock(p.workshop, 'shotgun');
    stock(p.workshop, 'sniper');
    equipWeapon(p.workshop, s, 'shotgun');
    expect(s.weapon).toBe(SHOTGUN);
    expect(p.workshop.equipped[s.id]).toEqual({ armor: false, optics: false, medkit: false, grenade: false, weapon: 'shotgun' });
    expect(p.workshop.store.shotgun).toBe(0);
    equipWeapon(p.workshop, s, 'sniper');
    expect(s.weapon).toBe(SNIPER_RIFLE);
    expect([p.workshop.store.shotgun, p.workshop.store.sniper]).toEqual([1, 0]);
    equipWeapon(p.workshop, s, 'rifle');
    expect(s.weapon).toBe(RIFLE);
    expect(p.workshop.store.sniper).toBe(1);
    expect(p.workshop.equipped[s.id]).toBeUndefined(); // порожній запис не тримаємо
    expect(p.workshop.log).toEqual([
      { type: 'equip', soldierId: s.id, id: 'shotgun' },
      { type: 'unequip', soldierId: s.id, id: 'shotgun' },
      { type: 'equip', soldierId: s.id, id: 'sniper' },
      { type: 'unequip', soldierId: s.id, id: 'sniper' },
    ]);
  });

  it('відмови — стан без змін: та сама зброя, немає на складі, невідома', () => {
    const p = createParty(42);
    const s = p.roster.soldiers[0];
    expect(() => equipWeapon(p.workshop, s, 'rifle')).toThrow('Ця зброя вже в оперативника: АР-14 «Гарт»');
    expect(() => equipWeapon(p.workshop, s, 'mg')).toThrow('Зброї немає на складі: Кулемет «Град»');
    expect(() => equipWeapon(p.workshop, s, 'laser' as 'mg')).toThrow('Невідома зброя: laser');
    stock(p.workshop, 'mg');
    equipWeapon(p.workshop, s, 'mg');
    expect(() => equipWeapon(p.workshop, s, 'mg')).toThrow('Ця зброя вже в оперативника: Кулемет «Град»');
    expect(p.workshop.store.mg).toBe(0);
    expect(s.weapon).toBe(MACHINE_GUN);
  });

  it('equipItem / unequipItem зі зброєю — той самий слот; запис з іншими предметами лишається', () => {
    const p = createParty(42);
    const s = p.roster.soldiers[0];
    stock(p.workshop, 'shotgun');
    p.workshop.store.medkit = 1;
    equipItem(p.workshop, s, 'medkit');
    equipItem(p.workshop, s, 'shotgun');
    expect(p.workshop.equipped[s.id]?.weapon).toBe('shotgun');
    expect(() => unequipItem(p.workshop, s, 'mg')).toThrow('Зброї немає в оперативника: Кулемет «Град»');
    expect(() => unequipItem(p.workshop, p.roster.soldiers[1], 'mg')).toThrow('Зброї немає в оперативника'); // без запису
    unequipItem(p.workshop, s, 'shotgun');
    expect(s.weapon).toBe(RIFLE);
    expect(p.workshop.store.shotgun).toBe(1);
    expect(p.workshop.equipped[s.id]).toEqual({ armor: false, optics: false, medkit: true, grenade: false });
  });

  it('загиблий: зброя з «Кузні» — на склад разом з бронею (equipment_returned); витратники — втрачено', () => {
    const p = createParty(42);
    const s = p.roster.soldiers[0];
    stock(p.workshop, 'sniper');
    p.workshop.store.armor = 1;
    p.workshop.store.grenade = 1;
    equipItem(p.workshop, s, 'armor');
    equipItem(p.workshop, s, 'grenade');
    equipWeapon(p.workshop, s, 'sniper');
    removeLostEquipment(p.workshop, [s]);
    expect(p.workshop.equipped[s.id]).toBeUndefined();
    expect([p.workshop.store.sniper, p.workshop.store.armor, p.workshop.store.grenade]).toEqual([1, 1, 0]);
    expect(p.workshop.log.slice(-2)).toEqual([
      { type: 'equipment_returned', soldierId: s.id, items: ['armor', 'sniper'] },
      { type: 'equipment_lost', soldierId: s.id, items: ['grenade'] },
    ]);
  });

  it('після місії зброя лишається при уцілілому (settleConsumables); запис лише зі зброєю не зникає', () => {
    const p = createParty(42);
    const s = p.roster.soldiers[0];
    stock(p.workshop, 'mg');
    equipWeapon(p.workshop, s, 'mg');
    settleConsumables(p.workshop, [s], {});
    expect(p.workshop.equipped[s.id]?.weapon).toBe('mg');
  });
});

describe('сейв (ADR-0165 п. 13; EARS 8): v4 з необов’язковими полями', () => {
  it('новий сейв зберігає склад зброї, зброю кожного і протоколи; версія — v4', () => {
    const p = createParty(42);
    const s = p.roster.soldiers[1];
    done(p.research, 'shotgun');
    stock(p.workshop, 'shotgun', 2);
    equipWeapon(p.workshop, s, 'shotgun');
    const json = serializeParty(p);
    expect(JSON.parse(json).version).toBe(SAVE_VERSION);
    expect(SAVE_VERSION).toBe(4);
    const q = deserializeParty(json);
    expect(q.research.completed).toContain('shotgun');
    expect(q.workshop.store.shotgun).toBe(1);
    expect(q.workshop.equipped[s.id]?.weapon).toBe('shotgun');
    expect(q.roster.soldiers[1].weapon).toEqual(SHOTGUN);
    expect(serializeParty(q)).toBe(json);
  });

  it('сейв v4 без полів зброї: у кожного «Гарт», склад зброї порожній, протоколи зброї не досліджено', () => {
    const p = createParty(42);
    const data = JSON.parse(serializeParty(p));
    for (const k of FORGE_WEAPONS) delete data.state.workshop.store[k]; // сейв v0.11.0 цих ключів не мав
    const q = deserializeParty(JSON.stringify(data));
    expect(q.roster.soldiers.every((u) => u.weapon.name === RIFLE.name && u.weapon.only === undefined)).toBe(true);
    expect(FORGE_WEAPONS.map((k) => q.workshop.store[k])).toEqual([0, 0, 0]);
    expect(q.research.completed.some(isForgeWeapon)).toBe(false);
    expect(Object.values(q.workshop.equipped).every((eq) => eq.weapon === undefined)).toBe(true);
  });
});

describe('зброя в бою (EARS 6; рішення власника п20.4 «А. Вимкнена з причиною», «А. Як є»)', () => {
  const open = { width: 20, height: 20, blocked: new Set<string>() };
  function duel(weapon: Weapon, gap = 4, role?: 'sniper'): { s: GameState; me: Unit; foe: Unit } {
    const me = makeUnit({ id: 'p', side: 'player', pos: { x: 2, y: 2 }, weapon, firingAccuracy: 0.6 });
    const foe = makeUnit({ id: 'a', side: 'alien', pos: { x: 2 + gap, y: 2 }, hp: 40, maxHp: 40 });
    const s = createGame({ map: open, units: [me, foe], rng: mulberry32(7), ...(role ? { roles: { p: { role, used: false } } } : {}) });
    return { s, me, foe };
  }

  it('режим, якого зброя не має, — відмова ядра; єдиний — стріляє своїм профілем', () => {
    const { s } = duel(SHOTGUN);
    expect(() => resolveAttack(s, 'p', 'a', 'aimed')).toThrow('не має режиму «Прицільний»');
    expect(resolveAttack(s, 'p', 'a', 'snap').shots).toHaveLength(1);
    const g = duel(MACHINE_GUN);
    expect(g.me.ap).toBe(g.me.maxAp);
    expect(resolveAttack(g.s, 'p', 'a', 'auto').shots).toHaveLength(4);
    expect(g.me.ap).toBe(g.me.maxAp - 5);
  });

  it('дальність за зброєю: «Шквал» — 6, «Голка» — 18 (далі огляду — лише по цілі, яку бачить сторона)', () => {
    expect(() => resolveAttack(duel(SHOTGUN, 7).s, 'p', 'a', 'snap')).toThrow();
    expect(resolveAttack(duel(SHOTGUN, 6).s, 'p', 'a', 'snap').shots).toHaveLength(1);
    expect(resolveAttack(duel(SNIPER_RIFLE, 12).s, 'p', 'a', 'aimed').shots).toHaveLength(1);
  });

  it('шанс новобранця: «Шквал» 60 %, «Голка» 78 %, «Град» 27 % за кулю; дозор — ×0,7 профілю (34 / 42 / 55 / 19 %)', () => {
    const u = (w: Weapon): Unit => makeUnit({ id: 'p', side: 'player', pos: { x: 0, y: 0 }, weapon: w, firingAccuracy: 0.6 });
    expect(calculateHitChance(u(SHOTGUN), 'snap')).toBeCloseTo(0.6, 10);
    expect(calculateHitChance(u(SNIPER_RIFLE), 'aimed')).toBeCloseTo(0.78, 10);
    expect(calculateHitChance(u(MACHINE_GUN), 'auto')).toBeCloseTo(0.27, 10);
    const ow = (w: Weapon): number => Math.round(0.6 * w.modes.snap.accuracyMod * 0.7 * 100);
    expect([RIFLE, SHOTGUN, SNIPER_RIFLE, MACHINE_GUN].map(ow)).toEqual([34, 42, 55, 19]);
    const { s } = duel(SNIPER_RIFLE);
    setOverwatch(s, 'p'); // дозор — 3 AP і для «Голки»
    expect(s.units[0].ap).toBe(s.units[0].maxAp - 3);
  });

  it('«Точний постріл»: зі «Шквалом» і «Градом» — причина «не має прицільного режиму»; з «Гартом» і «Голкою» — доступний', () => {
    expect(roleActionBlock(duel(SHOTGUN, 4, 'sniper').s, 'p', 'sniper')).toBe(
      '«Точний постріл»: зброя «Дробовик «Шквал»» не має прицільного режиму'
    );
    expect(roleActionBlock(duel(MACHINE_GUN, 4, 'sniper').s, 'p', 'sniper')).toContain('не має прицільного режиму');
    expect(roleActionBlock(duel(RIFLE, 4, 'sniper').s, 'p', 'sniper')).toBeNull();
    expect(roleActionBlock(duel(SNIPER_RIFLE, 4, 'sniper').s, 'p', 'sniper')).toBeNull();
    // інші ролі зброя не обмежує
    const role = (r: 'assault' | 'medic'): string | null => {
      const { s } = duel(SHOTGUN);
      s.roles = { p: { role: r, used: false } };
      return roleActionBlock(s, 'p', r);
    };
    expect([role('assault'), role('medic')]).toEqual([null, null]);
  });
});
