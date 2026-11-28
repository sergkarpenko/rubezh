// п22.4 (ADR-0186, EARS 3 Фази 22): розмір загону 3 → 4 → 5 протоколами «Тактична мережа I / II» —
// зона висадки й евакуації, надбавка ворогів у місії, штурмі й фіналі, бот партії.
import { describe, expect, it } from 'vitest';
import { advanceTime, missionTargets } from './geo';
import { createEconomy } from './economy';
import {
  BASE_SQUAD_SIZE,
  MAX_SQUAD_SIZE,
  PROJECT_CATALOG,
  SQUAD_PROJECTS,
  createResearch,
  researchTick,
  squadSize,
  startProject,
} from './research';
import {
  ALIENS_PER_KIND,
  ALIEN_EXTRA_CELLS,
  ALIEN_SPAWN,
  SPAWN_CELLS,
  SQUAD_SPAWN,
  connectedMap,
  createMission,
  extraEnemies,
  missionSeed,
  squadZone,
} from './mission';
import {
  ASSAULT_ENEMIES,
  ASSAULT_SPAWN,
  GATE_ENEMIES,
  GATE_SPAWN,
  TURRET_SPAWN,
  createAssault,
  createGateMission,
  gateMix,
} from './assault';
import { enemyKind, kindsForThreat } from './enemies';
import { missionSquad, readySoldiers } from './squad';
import { createParty, type Party } from './save';
import { DEFAULT_PARTY_POLICY, MISSION_SQUAD_SIZE, botHireUpTo, botSquadSize, partyBotHireStep, partyBotMissionStep } from './party-bot';
import type { GameState } from './combat';

// Детерміновано: тікати до першої цілі місії (приземлений виявлений зонд).
function withTarget(seed = 42): { party: Party; probeId: string } {
  const party = createParty(seed);
  for (let i = 0; i < 3000 && missionTargets(party.geo).length === 0; i++) advanceTime(party.geo, 1);
  const t = missionTargets(party.geo)[0];
  expect(t).toBeDefined();
  return { party, probeId: t.id };
}

const key = (c: { x: number; y: number }): string => c.x + ',' + c.y;

// Жоден юніт не стоїть на перешкоді і двоє не ділять клітинку.
function placementOk(st: GameState): void {
  const cells = st.units.map((u) => key(u.pos));
  expect(new Set(cells).size).toBe(cells.length);
  for (const c of cells) {
    expect(st.map.blocked.has(c)).toBe(false);
    expect(st.map.low?.has(c) ?? false).toBe(false);
  }
}

describe('п22.4: squadSize і протоколи «Тактична мережа I / II»', () => {
  it('3 без протоколів, 4 з I, 5 з I і II; II — після I; ціни й очки — кандидати', () => {
    const r = createResearch();
    expect(squadSize(r)).toBe(BASE_SQUAD_SIZE);
    expect(BASE_SQUAD_SIZE).toBe(3);
    expect(MAX_SQUAD_SIZE).toBe(5);
    r.completed.push('tac-net-1');
    expect(squadSize(r)).toBe(4);
    r.completed.push('tac-net-2');
    expect(squadSize(r)).toBe(5);
    expect(SQUAD_PROJECTS.map((p) => [p.name, p.cost, p.points, p.prerequisite])).toEqual([
      ['Тактична мережа I', 120, 24, undefined],
      ['Тактична мережа II', 180, 36, 'tac-net-1'],
    ]);
    expect(PROJECT_CATALOG['tac-net-2'].name).toBe('Тактична мережа II');
  });

  it('II без I не стартує; I стартує, завершується потоком очок і дає загін 4', () => {
    const econ = createEconomy();
    const r = createResearch();
    expect(() => startProject(econ, r, 'tac-net-2')).toThrow();
    const money = econ.money;
    startProject(econ, r, 'tac-net-1');
    expect(econ.money).toBe(money - 120);
    r.scientists.push(
      { id: 'sc1', name: 'Зінаїда', spec: 'researcher', done: 0 },
      { id: 'sc2', name: 'Ярослав', spec: 'researcher', done: 0 },
      { id: 'sc3', name: 'Меланія', spec: 'researcher', done: 0 }
    );
    econ.money = 10_000; // платня штату не обриває протокол
    const geo = createParty(42).geo; // лише годинник доби: 3 техноманти × 8 діб = 24 очки
    for (let i = 0; i < 9 * 24 && !r.completed.includes('tac-net-1'); i++) {
      advanceTime(geo, 60);
      researchTick(r, econ, geo);
    }
    expect(r.completed).toContain('tac-net-1');
    expect(squadSize(r)).toBe(4);
  });
});

describe('п22.4: зона висадки й евакуації (ADR-0186 п. 4)', () => {
  it('до трьох — SQUAD_SPAWN; четверта і п’ята — (1, 2) і (2, 1), не на турелях штурму', () => {
    for (const n of [1, 2, 3]) expect(squadZone(n)).toEqual(SQUAD_SPAWN);
    expect(squadZone(4)).toEqual([...SQUAD_SPAWN, { x: 1, y: 2 }]);
    expect(squadZone(5)).toEqual([...SQUAD_SPAWN, { x: 1, y: 2 }, { x: 2, y: 1 }]);
    expect(SPAWN_CELLS).toHaveLength(5);
    for (const t of TURRET_SPAWN) expect(SPAWN_CELLS.map(key)).not.toContain(key(t));
    // уся зона — у чистій зоні 3 × 3 навколо (2, 2), надбавка ворогів — навколо (17, 2)
    for (const c of SPAWN_CELLS) expect(Math.max(Math.abs(c.x - 2), Math.abs(c.y - 2))).toBe(c.x === 2 && c.y === 2 ? 0 : 1);
    for (const c of ALIEN_EXTRA_CELLS) expect(Math.max(Math.abs(c.x - 17), Math.abs(c.y - 2))).toBe(1);
    expect(new Set([...ALIEN_SPAWN, ...ALIEN_EXTRA_CELLS].map(key)).size).toBe(6);
  });

  it('надбавка ворогів: 0 до трьох, +1 і +2 для 4 і 5 (рішення власника «За бійців у загоні»)', () => {
    expect([1, 2, 3, 4, 5].map(extraEnemies)).toEqual([0, 0, 0, 1, 2]);
  });

  it('зона клітинок 4–5 завжди вільна: мапи місій 200 сідів — без перешкод і низьких перешкод на SPAWN_CELLS', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const map = connectedMap(seed);
      for (const c of [...SPAWN_CELLS, ...ALIEN_SPAWN, ...ALIEN_EXTRA_CELLS]) {
        expect(map.blocked.has(key(c))).toBe(false);
        expect(map.low?.has(key(c)) ?? false).toBe(false);
      }
    }
  });
});

describe('п22.4: місія зонда із загоном 4–5 (createMission)', () => {
  it('загін 3 — як до п22.4: зона SQUAD_SPAWN, ворогів за типом зонда', () => {
    const { party, probeId } = withTarget();
    const m = createMission(party.geo, probeId, { squad: missionSquad(party.roster) });
    expect(m.state.evacZone).toEqual(SQUAD_SPAWN);
    const kind = missionTargets(party.geo)[0].kind;
    expect(m.state.units.filter((u) => u.side === 'alien')).toHaveLength(ALIENS_PER_KIND[kind]);
    expect(m.briefing.aliens).toBe(ALIENS_PER_KIND[kind]);
  });

  it('загін 4 і 5: позиції — перші клітинки SPAWN_CELLS, зона евакуації — ті самі, +1 / +2 ворогів; мапа та сама', () => {
    const { party, probeId } = withTarget();
    const kind = missionTargets(party.geo)[0].kind;
    const base = createMission(party.geo, probeId, { squad: missionSquad(party.roster, 3), threat: 50 });
    for (const n of [4, 5]) {
      const { party: p2 } = withTarget();
      const m = createMission(p2.geo, probeId, { squad: missionSquad(p2.roster, n), threat: 50 });
      const players = m.state.units.filter((u) => u.side === 'player');
      expect(players.map((u) => u.pos)).toEqual(SPAWN_CELLS.slice(0, n));
      expect(m.state.evacZone).toEqual(squadZone(n));
      const aliens = m.state.units.filter((u) => u.side === 'alien');
      expect(aliens).toHaveLength(ALIENS_PER_KIND[kind] + n - 3);
      expect(m.briefing.aliens).toBe(aliens.length);
      // мапа і перші вороги — ті самі, що в загону 3 (склад — той самий генератор, довший ряд)
      expect([...m.state.map.blocked].sort()).toEqual([...base.state.map.blocked].sort());
      expect([...(m.state.map.low ?? [])].sort()).toEqual([...(base.state.map.low ?? [])].sort());
      const baseAliens = base.state.units.filter((u) => u.side === 'alien');
      expect(aliens.slice(0, baseAliens.length).map((u) => [enemyKind(u), u.pos])).toEqual(baseAliens.map((u) => [enemyKind(u), u.pos]));
      placementOk(m.state);
    }
    expect(missionSeed(party.geo, probeId)).toBeGreaterThanOrEqual(0);
  });
});

describe('п22.4: штурм бази і Брама із загоном 5', () => {
  it('штурм: 4 + 2 ворогів, турелі на своїх місцях, ніхто не ділить клітинку; мапа — за ASSAULT_SPAWN', () => {
    const p = createParty(42);
    p.campaign.assaultPending = true;
    p.research.completed.push('gate-key'); // турелі
    const m3 = createAssault(p, { squad: readySoldiers(p.roster).slice(0, 3) });
    expect(m3.state.units.filter((u) => u.side === 'alien')).toHaveLength(ASSAULT_ENEMIES);
    const m5 = createAssault(p, { squad: readySoldiers(p.roster).slice(0, 5) });
    expect(m5.state.units.filter((u) => u.side === 'alien')).toHaveLength(ASSAULT_ENEMIES + 2);
    expect(m5.state.units.filter((u) => u.turret === true).map((u) => u.pos)).toEqual(TURRET_SPAWN);
    expect(m5.state.evacZone).toBeUndefined(); // штурм — без евакуації, як і досі
    expect([...m5.state.map.blocked].sort()).toEqual([...m3.state.map.blocked].sort());
    expect(ASSAULT_SPAWN).toHaveLength(4);
    placementOk(m5.state);
  });

  it('Брама: 6 + 2 ворогів (gateMix з n — продовження того самого ряду), зона евакуації 5 клітинок', () => {
    const p = createParty(42);
    p.research.completed.push('gate-key');
    const m = createGateMission(p, { squad: readySoldiers(p.roster).slice(0, 5) });
    const aliens = m.state.units.filter((u) => u.side === 'alien');
    expect(aliens).toHaveLength(GATE_ENEMIES + 2);
    const avail = kindsForThreat(p.campaign.threat);
    const seed = 7;
    expect(gateMix(avail, seed, GATE_ENEMIES + 2).slice(0, GATE_ENEMIES)).toEqual(gateMix(avail, seed));
    expect(m.state.evacZone).toEqual(squadZone(5));
    expect(aliens.slice(0, GATE_SPAWN.length).map((u) => u.pos)).toEqual(GATE_SPAWN);
    placementOk(m.state);
  });
});

describe('п22.4: бот партії — розмір загону й найм від squadSize', () => {
  it('без протоколів — MISSION_SQUAD_SIZE і hireUpTo політики; з I і II — +1 і +2', () => {
    const p = createParty(42);
    expect(botSquadSize(p, DEFAULT_PARTY_POLICY)).toBe(MISSION_SQUAD_SIZE);
    expect(botHireUpTo(p, DEFAULT_PARTY_POLICY)).toBe(DEFAULT_PARTY_POLICY.hireUpTo);
    p.research.completed.push('tac-net-1');
    expect(botSquadSize(p, DEFAULT_PARTY_POLICY)).toBe(4);
    expect(botHireUpTo(p, DEFAULT_PARTY_POLICY)).toBe(DEFAULT_PARTY_POLICY.hireUpTo + 1);
    p.research.completed.push('tac-net-2');
    expect(botSquadSize(p, DEFAULT_PARTY_POLICY)).toBe(5);
    expect(botSquadSize(p, { ...DEFAULT_PARTY_POLICY, missionSquadSize: 5 })).toBe(5); // не понад зону
    expect(botHireUpTo(p, { ...DEFAULT_PARTY_POLICY, hireUpTo: 0 })).toBe(0); // «не наймати» лишається
  });

  it('бот з «Тактичною мережею II» іде в місію вп’ятьох і наймає до п’яти боєготових', () => {
    const { party } = withTarget();
    party.research.completed.push('tac-net-1', 'tac-net-2');
    party.econ.money = 10_000;
    const before = new Map(readySoldiers(party.roster).map((u) => [u.id, party.roster.careers[u.id].missions]));
    const info = partyBotMissionStep(party, DEFAULT_PARTY_POLICY);
    expect(info.launched).toBe(true);
    // у бою були п'ятеро: місія зарахована п'ятьом (уцілілим) чи вони в рядку втрат
    const fought = [...before.keys()].filter((id) => (party.roster.careers[id]?.missions ?? Infinity) !== before.get(id));
    expect(fought).toHaveLength(5);
    const p2 = createParty(42);
    p2.research.completed.push('tac-net-1', 'tac-net-2');
    p2.roster.soldiers.splice(2); // лишилось двоє
    p2.econ.money = 10_000;
    expect(partyBotHireStep(p2, DEFAULT_PARTY_POLICY)).toBe(DEFAULT_PARTY_POLICY.hireUpTo + 2 - 2);
    expect(readySoldiers(p2.roster)).toHaveLength(DEFAULT_PARTY_POLICY.hireUpTo + 2);
  });
});
