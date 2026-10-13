// src/core/squad.test.ts
// Юніт-тести ростеру загону (ітерація 5.2). Запуск: npx vitest
// Логіка всіх сценаріїв попередньо перевірена в пісочниці.

import { describe, expect, it } from 'vitest';
import type { Side } from './combat';
import { advanceTime, createGeoGame, type GeoState } from './geo';
import { completeMission, createMission, makeSoldier, missionOutcome, type Mission } from './mission';
import { applyMissionResult, createRoster, fireSoldier, hireSoldier, missionSquad, type Roster } from './squad';
import { createEconomy, HIRE_PRICE, spend } from './economy';

// Геопартія з вручну «посадженим» НЛО (спавн вимкнено) — для точкових сценаріїв.
function mkGeo(ufoId: string): GeoState {
  const g = createGeoGame({ seed: 9, spawnChance: 0 });
  g.ufos.push({
    id: ufoId,
    kind: 'розвідник',
    pos: { ...g.base },
    target: { ...g.base },
    detected: true,
    status: 'приземлився',
    landedTicksLeft: 8,
  });
  return g;
}

// «Зачистити» сторону вручну — у тестах ростеру важливий результат, а не процес бою.
function killSide(m: Mission, side: Side): void {
  for (const u of m.state.units.filter((x) => x.side === side)) {
    u.alive = false;
    u.hp = 0;
  }
}

describe('squad: стартовий ростер', () => {
  it('за замовчуванням 6 солдатів: унікальні id, фіксовані імена, повне HP', () => {
    const r = createRoster();
    expect(r.hired).toBe(6);
    expect(r.soldiers.map((s) => s.id)).toEqual(['s1', 's2', 's3', 's4', 's5', 's6']);
    expect(r.soldiers.map((s) => s.name)).toEqual(['Іван', 'Олена', 'Тарас', 'Марія', 'Богдан', 'Софія']);
    expect(r.soldiers.every((s) => s.side === 'player' && s.hp === 10 && s.ap === 10 && s.alive)).toBe(true);
    expect(r.soldiers.every((s) => s.weapon.name === 'АР-14 «Гарт»' && s.firingAccuracy === 0.6)).toBe(true);
  });

  it('валідація розміру: 0 і неціле → помилка; імена циклічні з номером', () => {
    expect(() => createRoster(0)).toThrow();
    expect(() => createRoster(2.5)).toThrow();
    const r13 = createRoster(13);
    expect(r13.soldiers.length).toBe(13);
    expect(r13.soldiers[12].name).toBe('Іван 2');
  });

  it('стартовий ростер детермінований', () => {
    expect(JSON.stringify(createRoster())).toBe(JSON.stringify(createRoster()));
  });
});

describe('squad: підбір загону', () => {
  it('перші солдати ростеру; менше наявних, ніж просили — ок', () => {
    const r = createRoster();
    expect(missionSquad(r).map((s) => s.id)).toEqual(['s1', 's2', 's3']);
    expect(missionSquad(r, 2).map((s) => s.id)).toEqual(['s1', 's2']);
    expect(missionSquad(createRoster(2), 3).map((s) => s.id)).toEqual(['s1', 's2']);
  });

  it('невалідний розмір або порожній ростер → помилка', () => {
    const r = createRoster();
    expect(() => missionSquad(r, 0)).toThrow();
    expect(() => missionSquad(r, 4)).toThrow();
    expect(() => missionSquad({ soldiers: [], hired: 0 })).toThrow();
  });
});

describe('squad: результат місії', () => {
  it('перемога: виживші повністю лікуються, kills збережено, розмір ростеру той самий', () => {
    const r = createRoster();
    const g = mkGeo('uW');
    const m = createMission(g, 'uW', { squad: missionSquad(r) });
    killSide(m, 'alien');
    expect(missionOutcome(m.state)).toBe('перемога');
    const s1 = m.state.units.find((u) => u.id === 's1')!;
    s1.hp = 4;
    s1.ap = 1;
    s1.overwatch = true;
    s1.kills = 2; // «поранений ветеран» після бою
    const af = applyMissionResult(r, m.state);
    expect(af.lost).toEqual([]);
    expect(af.survivors.map((s) => s.id)).toEqual(['s1', 's2', 's3']);
    expect(r.soldiers.length).toBe(6);
    expect(r.soldiers[0].hp).toBe(10);
    expect(r.soldiers[0].ap).toBe(10);
    expect(r.soldiers[0].overwatch).toBe(false);
    expect(r.soldiers[0].kills).toBe(2); // стаж ветерана зберігається
    // geo-бік циклу: порядок з completeMission не важливий
    completeMission(g, 'uW', 'перемога');
    expect(g.log.some((e) => e.type === 'mission_won' && e.ufoId === 'uW')).toBe(true);
  });

  it('поразка: увесь загін вилучено; наступна місія бере наступних солдатів', () => {
    const r = createRoster();
    const m = createMission(mkGeo('uL'), 'uL', { squad: missionSquad(r) });
    killSide(m, 'player');
    const af = applyMissionResult(r, m.state);
    expect(af.lost.map((s) => s.id)).toEqual(['s1', 's2', 's3']);
    expect(af.survivors).toEqual([]);
    expect(r.soldiers.map((s) => s.id)).toEqual(['s4', 's5', 's6']);
    expect(missionSquad(r).map((s) => s.id)).toEqual(['s4', 's5', 's6']);
  });

  it('часткова втрата: загиблий зникає назавжди, поранений лікується', () => {
    const r = createRoster();
    const m = createMission(mkGeo('uP'), 'uP', { squad: missionSquad(r) });
    const s2 = m.state.units.find((u) => u.id === 's2')!;
    s2.alive = false;
    s2.hp = 0;
    m.state.units.find((u) => u.id === 's3')!.hp = 5;
    killSide(m, 'alien');
    const af = applyMissionResult(r, m.state);
    expect(af.lost.map((s) => s.id)).toEqual(['s2']);
    expect(af.survivors.map((s) => s.id)).toEqual(['s1', 's3']);
    expect(r.soldiers.map((s) => s.id)).toEqual(['s1', 's3', 's4', 's5', 's6']);
    expect(r.soldiers.find((s) => s.id === 's3')!.hp).toBe(10);
  });

  it('чужий солдат у стані місії або повторний виклик → помилка', () => {
    const r = createRoster();
    const alien = createMission(mkGeo('uX'), 'uX', { squad: [makeSoldier('vet1', 'Марко')] });
    expect(() => applyMissionResult(r, alien.state)).toThrow();
    const m = createMission(mkGeo('uY'), 'uY', { squad: missionSquad(r) });
    killSide(m, 'player');
    applyMissionResult(r, m.state);
    expect(() => applyMissionResult(r, m.state)).toThrow(); // загін уже вилучено
    expect(r.soldiers.map((s) => s.id)).toEqual(['s4', 's5', 's6']);
  });
});

describe('squad: наскрізний цикл', () => {
  it('дві місії підряд одним ростером: ветерани + нові, втрати накопичуються', () => {
    const r = createRoster();
    const g1 = mkGeo('u1');
    const m1 = createMission(g1, 'u1', { squad: missionSquad(r) });
    const s2 = m1.state.units.find((u) => u.id === 's2')!;
    s2.alive = false;
    s2.hp = 0;
    killSide(m1, 'alien');
    applyMissionResult(r, m1.state);
    completeMission(g1, 'u1', 'перемога');
    const g2 = mkGeo('u2');
    const m2 = createMission(g2, 'u2', { squad: missionSquad(r) });
    expect(m2.state.units.filter((u) => u.side === 'player').map((u) => u.id)).toEqual(['s1', 's3', 's4']);
    killSide(m2, 'alien');
    applyMissionResult(r, m2.state);
    completeMission(g2, 'u2', 'перемога');
    expect(r.soldiers.map((s) => s.id)).toEqual(['s1', 's3', 's4', 's5', 's6']);
  });

  it('місія з ростером не витягає geo.rng: траєкторія геосцени та сама', () => {
    const run = (useRoster: boolean): string => {
      const g = createGeoGame({ seed: 5, spawnChance: 0 });
      advanceTime(g, 10);
      g.ufos.push({
        id: 'ufoM',
        kind: 'розвідник',
        pos: { ...g.base },
        target: { ...g.base },
        detected: true,
        status: 'приземлився',
        landedTicksLeft: 8,
      });
      if (useRoster) {
        const r: Roster = createRoster();
        createMission(g, 'ufoM', { squad: missionSquad(r) });
      } else {
        createMission(g, 'ufoM');
      }
      advanceTime(g, 100);
      return JSON.stringify(g.log);
    };
    expect(run(true)).toBe(run(false));
  });
});

describe('squad: кадрування (П4.3, ADR-0021)', () => {
  it('найм: списує HIRE_PRICE, додає солдата в кінець ростеру, hired зростає', () => {
    const econ = createEconomy();
    const r = createRoster(); // s1..s6, hired 6
    const hired = hireSoldier(econ, r);
    expect(econ.money).toBe(300 - HIRE_PRICE);
    expect(hired.id).toBe('s7');
    expect(hired.name).toBe('Дмитро');
    expect(r.hired).toBe(7);
    expect(r.soldiers.map((s) => s.id)).toEqual(['s1', 's2', 's3', 's4', 's5', 's6', 's7']);
    expect(hired.side).toBe('player');
    expect(hired.hp).toBe(10);
    expect(hired.alive).toBe(true);
  });

  it('імена циклічні: після вичерпання пулу — ім’я з номером, id унікальний', () => {
    const econ = createEconomy();
    const r = createRoster(12); // увесь пул імен
    const first = hireSoldier(econ, r);
    expect(first.id).toBe('s13');
    expect(first.name).toBe('Іван 2');
    const second = hireSoldier(econ, r);
    expect(second.id).toBe('s14');
    expect(second.name).toBe('Олена 2');
  });

  it('недостатньо грошей — помилка, ростер і лічильник не змінюються', () => {
    const econ = createEconomy();
    spend(econ, 250); // лишається 50 < HIRE_PRICE
    const r = createRoster();
    expect(() => hireSoldier(econ, r)).toThrow('Недостатньо грошей');
    expect(r.soldiers).toHaveLength(6);
    expect(r.hired).toBe(6);
  });

  it('найм детермінований: однакова послідовність — ті самі id та імена', () => {
    const run = () => {
      const econ = createEconomy();
      const r = createRoster();
      const hired = [hireSoldier(econ, r), hireSoldier(econ, r)];
      return JSON.stringify({ hired: hired.map((s) => s.id + ':' + s.name), money: econ.money, roster: r.soldiers.map((s) => s.id) });
    };
    expect(run()).toBe(run());
  });

  it('звільнення: вилучає за id і повертає солдата, решта ростеру без змін', () => {
    const r = createRoster();
    const fired = fireSoldier(r, 's2');
    expect(fired.id).toBe('s2');
    expect(r.soldiers.map((s) => s.id)).toEqual(['s1', 's3', 's4', 's5', 's6']);
    expect(() => fireSoldier(r, 's2')).toThrow('Солдата немає в ростері');
  });

  it('ветерани йдуть у бій першими: найм додає в кінець, missionSquad не чіпає новобранця', () => {
    const econ = createEconomy();
    const r = createRoster();
    fireSoldier(r, 's1');
    fireSoldier(r, 's2');
    hireSoldier(econ, r); // s7 у кінці
    expect(missionSquad(r).map((s) => s.id)).toEqual(['s3', 's4', 's5']);
  });

  it('звільнення останнього солдата — ростер порожній, місія неможлива', () => {
    const r = createRoster(1);
    fireSoldier(r, 's1');
    expect(r.soldiers).toEqual([]);
    expect(() => missionSquad(r)).toThrow('Ростер порожній');
  });
});
