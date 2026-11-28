// п22.7 (ADR-0189, рішення власника «А. «Еліксир чемпіона»»): рецепт із трофеєм «чемпіон» — «Стимулятор» і «Щит»
// в одному витратнику; `missingTrophies` / `spendTrophies` з ключем `champion`.
import { describe, expect, it } from 'vitest';
import { createEconomy, type EconomyState } from './economy';
import { CHAMPION_TROPHY_NAME, LEVEL_THRESHOLDS, createResearch, missingTrophies, spendTrophies, type ResearchState } from './research';
import { createModules, type BaseModules } from './base';
import {
  BREW_LEVEL,
  WORKSHOP_CATALOG,
  brewItem,
  canBrew,
  createWorkshop,
  deployConsumables,
  emptyStore,
  equipItem,
  removeLostEquipment,
  settleConsumables,
  unequipItem,
  workshopTick,
} from './workshop';
import { makeSoldier } from './mission';

const rich = (money = 10_000): EconomyState => ({ ...createEconomy('норма'), money });
function alchemist(level: number, champion?: number): { econ: EconomyState; r: ResearchState; m: BaseModules } {
  const r = createResearch();
  r.scientists.push({ id: 'в1', name: 'Зінаїда', spec: 'alchemist', done: LEVEL_THRESHOLDS[level - 1] });
  if (champion !== undefined) r.trophies.champion = champion;
  return { econ: rich(), r, m: { ...createModules(), cauldron: 1 } };
}

describe('п22.7: трофей «чемпіон» у ціні', () => {
  it('missingTrophies: «чемпіон N з M» — останнім; без поля в складі — 0', () => {
    const r = createResearch();
    expect(missingTrophies(r.trophies, { champion: 1 })).toBe('Бракує трофеїв: ' + CHAMPION_TROPHY_NAME + ' 0 з 1');
    expect(missingTrophies(r.trophies, { demon: 2, champion: 1 })).toBe('Бракує трофеїв: демон 0 з 2, чемпіон 0 з 1');
    r.trophies.champion = 1;
    expect(missingTrophies(r.trophies, { champion: 1 })).toBeUndefined();
  });

  it('spendTrophies списує «чемпіон» лише за ціною з ним; без нього поле не з’являється', () => {
    const r = createResearch();
    r.trophies.demon = 3;
    spendTrophies(r.trophies, { demon: 1 });
    expect('champion' in r.trophies).toBe(false); // сейв без поля — байт-у-байт
    r.trophies.champion = 2;
    spendTrophies(r.trophies, { champion: 1 });
    expect(r.trophies.champion).toBe(1);
  });
});

describe('п22.7: «Еліксир чемпіона» — казан', () => {
  it('каталог: 1 трофей «чемпіон» + 60 кр., алхімік рівня 3; склад має ключ', () => {
    expect(WORKSHOP_CATALOG.elixir).toEqual({ name: 'Еліксир чемпіона', cost: 60, ticks: 16, trophies: { champion: 1 }, brewed: true });
    expect(BREW_LEVEL.elixir).toBe(3);
    expect(emptyStore().elixir).toBe(0);
  });

  it('алхімік 2 — throw; без трофея — throw; рівень 3 з трофеєм — варить, трофей списано, удвічі швидше', () => {
    const w = createWorkshop();
    const a2 = alchemist(2, 1);
    expect(canBrew(a2.r, a2.m, 'elixir')).toBe(false);
    expect(() => brewItem(a2.econ, w, a2.r, a2.m, 'elixir')).toThrow('«Еліксир чемпіона» варить алхімік рівня 3');
    const a0 = alchemist(3);
    expect(() => brewItem(a0.econ, w, a0.r, a0.m, 'elixir')).toThrow('Бракує трофеїв: чемпіон 0 з 1');
    expect(a0.econ.money).toBe(10_000);
    const a = alchemist(3, 1);
    expect(canBrew(a.r, a.m, 'elixir')).toBe(true);
    const order = brewItem(a.econ, w, a.r, a.m, 'elixir');
    expect(order.ticksLeft).toBe(8); // рівень 3 — удвічі менше тиків
    expect(a.r.trophies.champion).toBe(0);
    expect(a.econ.money).toBe(10_000 - 60);
    for (let i = 0; i < 8; i++) workshopTick(w);
    expect(w.store.elixir).toBe(1);
  });
});

describe('п22.7: «Еліксир чемпіона» — видача, бій, після бою', () => {
  const setup = () => {
    const w = createWorkshop();
    w.store.elixir = 2;
    w.store.stim = 1;
    w.store.shield = 1;
    return { w, s: makeSoldier('о1', 'Іван') };
  };

  it('разом зі «Стимулятором» чи «Щитом» не видається (в обидва боки), склад без змін', () => {
    const { w, s } = setup();
    equipItem(w, s, 'stim');
    expect(() => equipItem(w, s, 'elixir')).toThrow('«Еліксир чемпіона» вже містить «Стимулятор» і «Щит» — разом їх не видати');
    expect(w.store.elixir).toBe(2);
    unequipItem(w, s, 'stim');
    equipItem(w, s, 'elixir');
    expect(() => equipItem(w, s, 'shield')).toThrow('разом їх не видати');
    expect(w.equipped[s.id]).toEqual({ armor: false, optics: false, medkit: false, grenade: false, elixir: true });
    unequipItem(w, s, 'elixir');
    expect(w.equipped[s.id]).toBeUndefined();
    expect(w.store.elixir).toBe(2);
  });

  it('у бою — стимулятор і щит разом; не витрачено нічого — еліксир лишається, щось витрачено — зникає', () => {
    const { w, s } = setup();
    equipItem(w, s, 'elixir');
    const items = deployConsumables(w, [s]);
    expect(items[s.id]).toEqual({ medkit: false, grenade: false, stim: true, shield: true, elixir: true });
    settleConsumables(w, [s], items);
    expect(w.equipped[s.id]?.elixir).toBe(true);
    const used = deployConsumables(w, [s]);
    used[s.id].stim = false; // «Стимулятор» з еліксиру вжито
    settleConsumables(w, [s], used);
    expect(w.equipped[s.id]).toBeUndefined();
  });

  it('загиблий — еліксир зникає з рядком втрати', () => {
    const { w, s } = setup();
    equipItem(w, s, 'elixir');
    removeLostEquipment(w, [s]);
    expect(w.log.at(-1)).toEqual({ type: 'equipment_lost', soldierId: s.id, items: ['elixir'] });
    expect(w.store.elixir).toBe(1);
  });
});
