// п22.8 (ADR-0190; ADR-0182 п. 17): бот партії з механіками Фази 22 — склад штату за спеціалізацією,
// модулі бази, варіння казана, видача витратників казана загону, поріг фіналу під загін 4–5,
// «Стимулятор» в авто-бою. Політика без нових полів — як до п22.8.
import { describe, expect, it } from 'vitest';
import { createParty, type Party } from './save';
import { readySoldiers } from './squad';
import { MODULES, modulePrice } from './base';
import { WORKSHOP_CATALOG } from './workshop';
import { sciencePrice } from './campaign';
import { createGame, makeUnit, type GameState, type RNG } from './combat';
import { botTurn } from './ai-bot';
import { gateOpen } from './assault';
import { RANK_THRESHOLDS } from './career';
import {
  CAMPAIGN_POLICY,
  DEFAULT_PARTY_POLICY,
  partyBotBrewStep,
  partyBotGateStep,
  partyBotModuleStep,
  partyBotScienceStep,
  simulateParty,
  type PartyBotPolicy,
} from './party-bot';

const LAB: PartyBotPolicy = {
  ...DEFAULT_PARTY_POLICY,
  name: 'lab',
  scientistSpecs: ['researcher', 'alchemist'],
  modules: { cauldron: 2 },
  brew: ['elixir', 'stim', 'shield'],
};

function rich(seed = 42): Party {
  const p = createParty(seed, 'норма');
  p.econ.money = 5000;
  p.research.trophies.demon = 9; // «Стимулятор» — трофей демона, «Щит» — гончака
  p.research.trophies.hound = 9;
  return p;
}

// Алхімік рівня level у штаті (рівень — за завершеними протоколами в штаті, LEVEL_THRESHOLDS 0 / 2 / 5).
function withAlchemist(p: Party, level: 1 | 2 | 3): void {
  p.research.scientists.push({ id: 'в9', name: 'Тест', spec: 'alchemist', done: [0, 2, 5][level - 1] });
}

describe('п22.8: штат за спеціалізацією (scientistSpecs)', () => {
  it('найм — перша спеціалізація переліку, якої бракує; понад перелік — «Дослідник»; без поля — усі «Дослідники»', () => {
    const p = rich();
    partyBotScienceStep(p, { ...LAB, scientistsUpTo: 3, modules: undefined, brew: undefined });
    expect(p.research.scientists.map((s) => s.spec)).toEqual(['researcher', 'alchemist', 'researcher']);
    const q = rich();
    q.research.scientists.push({ id: 'в9', name: 'Тест', spec: 'alchemist', done: 0 }); // алхімік уже є — першим дослідник
    partyBotScienceStep(q, { ...LAB, scientistsUpTo: 2, modules: undefined, brew: undefined });
    expect(q.research.scientists.map((s) => s.spec)).toEqual(['alchemist', 'researcher']);
    const r = rich();
    partyBotScienceStep(r, { ...DEFAULT_PARTY_POLICY, scientistsUpTo: 2 });
    expect(r.research.scientists.map((s) => s.spec)).toEqual(['researcher', 'researcher']);
  });

  it('усі протоколи завершено: з казаном (`brew`) алхімік лишається, решта — звільнені; без `brew` — усі', () => {
    const p = rich();
    p.research.completed.push('armor');
    p.research.scientists.push({ id: 'в1', name: 'А', spec: 'researcher', done: 0 }, { id: 'в2', name: 'Б', spec: 'alchemist', done: 0 });
    const pol: PartyBotPolicy = { ...LAB, projects: ['armor'], fireScientistsWhenDone: true, scientistsUpTo: 2, modules: undefined };
    partyBotScienceStep(p, pol);
    expect(p.research.scientists.map((s) => s.id)).toEqual(['в2']);
    const q = rich();
    q.research.completed.push('armor');
    q.research.scientists.push({ id: 'в2', name: 'Б', spec: 'alchemist', done: 0 });
    partyBotScienceStep(q, { ...pol, brew: undefined });
    expect(q.research.scientists).toEqual([]);
  });

  it('політика лише з `modules` чи `brew` — крок науки не пропускається', () => {
    const p = rich();
    withAlchemist(p, 1);
    partyBotScienceStep(p, { ...DEFAULT_PARTY_POLICY, modules: { cauldron: 1 } });
    expect(p.modules.cauldron).toBe(1);
    const q = rich();
    withAlchemist(q, 1);
    q.modules.cauldron = 1;
    partyBotScienceStep(q, { ...DEFAULT_PARTY_POLICY, brew: ['stim'] });
    expect(q.workshop.brew.map((o) => o.id)).toEqual(['stim']);
  });
});

describe('п22.8: модулі бази (partyBotModuleStep)', () => {
  it('без поля — нічого; «Казан» — лише з алхіміком; по одному рівню за крок до рівня політики', () => {
    const p = rich();
    partyBotModuleStep(p, DEFAULT_PARTY_POLICY);
    partyBotModuleStep(p, LAB);
    expect(p.modules.cauldron).toBe(0); // алхіміка немає
    withAlchemist(p, 1);
    const money = p.econ.money;
    partyBotModuleStep(p, LAB);
    expect(p.modules.cauldron).toBe(1);
    expect(money - p.econ.money).toBe(sciencePrice(MODULES.cauldron.prices[0], 'норма'));
    partyBotModuleStep(p, LAB);
    partyBotModuleStep(p, LAB);
    expect(p.modules.cauldron).toBe(2); // рівень політики — далі не купує
    expect(p.research.log.filter((e) => e.type === 'module')).toHaveLength(2);
  });

  it('«Стенд» — лише після «Розширення лабораторії»; найвищий рівень — не купує; гроші — з резервом найму повного загону', () => {
    const p = rich();
    const pol: PartyBotPolicy = { ...DEFAULT_PARTY_POLICY, modules: { stand: 1, boiler: 3 } };
    partyBotModuleStep(p, pol);
    expect([p.modules.stand, p.modules.boiler]).toEqual([0, 1]); // стенд пропущено, котел — першим доступним
    p.research.completed.push('lab-extension');
    partyBotModuleStep(p, pol);
    expect(p.modules.stand).toBe(1);
    partyBotModuleStep(p, pol);
    partyBotModuleStep(p, pol);
    expect(p.modules.boiler).toBe(2); // рівень 3 політики — понад найвищий, без помилки
    const poor = createParty(42, 'норма');
    const price = modulePrice(poor.modules, 'boiler', 'норма') ?? 0;
    poor.econ.money = price + 300 + DEFAULT_PARTY_POLICY.hireReserve - 1; // резерв: 3 × 100 + ремонт
    partyBotModuleStep(poor, { ...DEFAULT_PARTY_POLICY, modules: { boiler: 1 } });
    expect(poor.modules.boiler).toBe(0);
    poor.econ.money += 1;
    partyBotModuleStep(poor, { ...DEFAULT_PARTY_POLICY, modules: { boiler: 1 } });
    expect(poor.modules.boiler).toBe(1);
  });
});

describe('п22.8: варіння казана (partyBotBrewStep) і видача загону', () => {
  it('без поля чи з варінням у казані — нічого; алхімік 1 — «Стимулятор» (еліксир і щит недоступні)', () => {
    const p = rich();
    withAlchemist(p, 1);
    p.modules.cauldron = 1;
    partyBotBrewStep(p, DEFAULT_PARTY_POLICY);
    expect(p.workshop.brew).toEqual([]);
    partyBotBrewStep(p, LAB);
    expect(p.workshop.brew.map((o) => o.id)).toEqual(['stim']);
    partyBotBrewStep(p, LAB); // одне активне варіння
    expect(p.workshop.brew).toHaveLength(1);
  });

  it('«Еліксир» — з трофеєм «чемпіон» (без нього — стимулятор); дефіцит рахує склад і порції в казані', () => {
    const p = rich();
    withAlchemist(p, 3);
    p.modules.cauldron = 2;
    partyBotBrewStep(p, LAB);
    expect(p.workshop.brew.map((o) => [o.id, o.count])).toEqual([['stim', 2]]); // чемпіона немає
    p.workshop.brew = [];
    p.research.trophies.champion = 1;
    partyBotBrewStep(p, LAB);
    expect(p.workshop.brew.map((o) => o.id)).toEqual(['elixir']);
    expect(p.research.trophies.champion).toBe(0);
    const q = rich();
    withAlchemist(q, 3);
    q.modules.cauldron = 1;
    q.workshop.store.stim = 3; // стимуляторів на загін досить — далі щит
    partyBotBrewStep(q, LAB);
    expect(q.workshop.brew.map((o) => o.id)).toEqual(['shield']);
  });

  it('гроші — з резервом hireReserve; трофеї незапущених ключових протоколів не витрачаються (reserveTrophies)', () => {
    const p = rich();
    withAlchemist(p, 1);
    p.modules.cauldron = 1;
    p.econ.money = sciencePrice(WORKSHOP_CATALOG.stim.cost, 'норма') + LAB.hireReserve - 1;
    partyBotBrewStep(p, LAB);
    expect(p.workshop.brew).toEqual([]);
    p.econ.money += 1;
    partyBotBrewStep(p, LAB);
    expect(p.workshop.brew.map((o) => o.id)).toEqual(['stim']);
    const q = rich();
    withAlchemist(q, 1);
    q.modules.cauldron = 1;
    q.research.trophies.demon = 2; // «Анатомія Розриву» просить демонів — резерв
    partyBotBrewStep(q, { ...LAB, reserveTrophies: true, projects: ['rift-anatomy'] });
    expect(q.workshop.brew).toEqual([]);
  });

  it('видача: «Еліксир» — бійцеві без стимулятора й щита, далі стимулятор і щит; лише першим бійцям загону', () => {
    const p = rich();
    const [s1, s2, s3, s4] = readySoldiers(p.roster);
    expect(s4).toBeDefined(); // ростер старту — більше за загін
    p.workshop.store.elixir = 1;
    p.workshop.store.stim = 5;
    p.workshop.store.shield = 1;
    p.workshop.equipped[s1.id] = { armor: false, optics: false, medkit: false, grenade: false, stim: true };
    partyBotScienceStep(p, { ...LAB, modules: undefined, brew: ['elixir', 'stim', 'shield'] });
    expect(p.workshop.equipped[s1.id]).toMatchObject({ stim: true, shield: true }); // з стимулятором — еліксир не дати, щит — так
    expect(p.workshop.equipped[s1.id].elixir).toBeUndefined();
    expect(p.workshop.equipped[s2.id]).toMatchObject({ elixir: true });
    expect(p.workshop.equipped[s2.id].stim).toBeUndefined();
    expect(p.workshop.equipped[s3.id]).toMatchObject({ stim: true });
    expect(p.workshop.equipped[s4.id]?.stim).toBeUndefined(); // четвертий — поза загоном 3
    expect([p.workshop.store.elixir, p.workshop.store.stim, p.workshop.store.shield]).toEqual([0, 4, 0]);
  });
});

describe('п22.8: поріг фіналу під загін 4–5 (gateMinRanked)', () => {
  it('з «Тактичною мережею I» — потрібно на одного бійця зі званням більше', () => {
    const p = rich();
    p.research.completed.push('gate-key', 'tac-net-1');
    expect(gateOpen(p)).toBe(true);
    const squad = readySoldiers(p.roster).slice(0, 4);
    for (const u of squad.slice(0, 3)) p.roster.careers[u.id].xp = RANK_THRESHOLDS[1];
    const pol: PartyBotPolicy = { ...DEFAULT_PARTY_POLICY, gateMinRanked: 3 };
    expect(partyBotGateStep(p, pol).fought).toBe(false); // троє зі званням із чотирьох — мало
    p.roster.careers[squad[3].id].xp = RANK_THRESHOLDS[1];
    expect(partyBotGateStep(p, pol).fought).toBe(true);
  });
});

describe('п22.8: «Стимулятор» в авто-бою (ai-bot)', () => {
  const alwaysMiss: RNG = () => 0.99;
  function game(items: GameState['items']): GameState {
    return createGame({
      map: { width: 12, height: 6, blocked: new Set() },
      rng: alwaysMiss,
      items,
      units: [
        makeUnit({ id: 's1', side: 'player', pos: { x: 2, y: 2 } }),
        makeUnit({ id: 'a1', side: 'alien', pos: { x: 8, y: 2 }, hp: 10, maxHp: 10 }),
      ],
    });
  }

  it('ворога видно, а на чергу AP бракує — «Стимулятор» (+3 AP), далі постріл; без витратника — без нього', () => {
    const g = game({ s1: { medkit: false, grenade: false, stim: true } });
    botTurn(g);
    const i = g.log.findIndex((e) => e.type === 'stim');
    expect(i).toBeGreaterThan(0); // спершу постріли, стимулятор — коли AP < 4
    expect(g.log.slice(i + 1).some((e) => e.type === 'shot')).toBe(true);
    expect(g.log.filter((e) => e.type === 'stim')).toHaveLength(1);
    const plain = game(undefined);
    botTurn(plain);
    expect(plain.log.some((e) => e.type === 'stim')).toBe(false);
  });
});

describe('п22.8: повна партія політики кампанії', () => {
  it('сід 7 «норма»: бот вчить обидві «Тактичні мережі», купує казан II, варить і вживає витратники', () => {
    let last: Party | null = null;
    const r = simulateParty(7, 'норма', { policy: CAMPAIGN_POLICY, onTick: (p) => (last = p as Party) });
    const fin = last as unknown as Party;
    expect(r.outcome).toBe('перемога');
    expect(r.completedProjects).toEqual(expect.arrayContaining(['tac-net-1', 'tac-net-2']));
    expect(fin.modules.cauldron).toBe(2);
    expect(fin.research.scientists.map((s) => s.spec)).toEqual(['alchemist']); // протоколи завершено — алхімік лишився
    expect(fin.workshop.log.filter((e) => e.type === 'brew').length).toBeGreaterThan(0);
  }, 30_000);
});
