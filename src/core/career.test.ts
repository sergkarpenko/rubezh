// src/core/career.test.ts
// п16.2 (ADR-0147): кар'єра оперативника — пули, звання, прирости, рядок втрати
// (EARS 1–3, 7 плану Фази 16).

import { describe, expect, it } from 'vitest';
import {
  BIOGRAPHIES,
  CALLSIGNS,
  RANK_NAMES,
  RANK_THRESHOLDS,
  applyRankBonus,
  awaitingRole,
  lossLine,
  newCareer,
  pluralUk,
  rankOf,
  settleCareer,
  xpToNextRank,
} from './career';
import { makeSoldier } from './mission';

describe('career: пули позивних і біографій (EARS 1)', () => {
  it('12 позивних і 12 біографій, без повторів', () => {
    expect(CALLSIGNS).toHaveLength(12);
    expect(BIOGRAPHIES).toHaveLength(12);
    expect(new Set(CALLSIGNS).size).toBe(12);
    expect(new Set(BIOGRAPHIES).size).toBe(12);
  });

  it('за порядковим номером; з 13-го — позивний з номером кола, біографія по колу', () => {
    expect(newCareer(0)).toEqual({ callsign: 'Крук', bio: BIOGRAPHIES[0], xp: 0, missions: 0, killsCounted: 0, role: null });
    expect(newCareer(11).callsign).toBe('Оса');
    expect(newCareer(12).callsign).toBe('Крук 2');
    expect(newCareer(12).bio).toBe(BIOGRAPHIES[0]);
    expect(newCareer(25).callsign).toBe('Шрам 3');
    expect(newCareer(25).bio).toBe(BIOGRAPHIES[1]);
  });
});

describe('career: звання за досвідом (EARS 3)', () => {
  it('пороги 2 / 5 / 9: Рекрут → Боєць → Сержант → Ветеран', () => {
    expect(RANK_NAMES).toEqual(['Рекрут', 'Боєць', 'Сержант', 'Ветеран']);
    expect(RANK_THRESHOLDS).toEqual([0, 2, 5, 9]);
    expect([0, 1, 2, 4, 5, 8, 9, 40].map(rankOf)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
  });

  it('досвід до наступного звання; на найвищому — null', () => {
    expect(xpToNextRank(0)).toBe(2);
    expect(xpToNextRank(3)).toBe(2);
    expect(xpToNextRank(8)).toBe(1);
    expect(xpToNextRank(9)).toBeNull();
  });

  it('приріст за звання: +1 maxHp і hp, +0,03 точності до сотих; 0 кроків — без змін', () => {
    const s = makeSoldier('s1', 'Іван');
    s.hp = 6;
    applyRankBonus(s, 0);
    expect([s.maxHp, s.hp, s.firingAccuracy]).toEqual([10, 6, 0.6]);
    applyRankBonus(s, 1);
    expect([s.maxHp, s.hp, s.firingAccuracy]).toEqual([11, 7, 0.63]);
    applyRankBonus(s, 2);
    expect([s.maxHp, s.hp, s.firingAccuracy]).toEqual([13, 9, 0.69]);
  });
});

describe('career: підсумок місії (EARS 2–3)', () => {
  it('місія +1, вбивства місії — різниця з зарахованими; лічильники ростуть', () => {
    const s = makeSoldier('s1', 'Іван');
    const c = newCareer(0);
    s.kills = 1;
    expect(settleCareer(s, c)).toBe(1); // 1 + 1 = 2 → «Боєць»
    expect(c).toMatchObject({ xp: 2, missions: 1, killsCounted: 1 });
    expect([s.maxHp, s.hp, s.firingAccuracy]).toEqual([11, 11, 0.63]);
    // наступна місія без вбивств: накопичувальний kills не зараховується вдруге
    expect(settleCareer(s, c)).toBe(0);
    expect(c).toMatchObject({ xp: 3, missions: 2, killsCounted: 1 });
    expect(s.maxHp).toBe(11);
  });

  it('перескок звань за одну місію — прирости за кожне звання', () => {
    const s = makeSoldier('s1', 'Іван');
    const c = newCareer(0);
    s.kills = 8; // 1 + 8 = 9 → «Ветеран»
    expect(settleCareer(s, c)).toBe(3);
    expect(rankOf(c.xp)).toBe(3);
    expect([s.maxHp, s.hp, s.firingAccuracy]).toEqual([13, 13, 0.69]);
  });

  it('вибір ролі чекає оперативник від «Боєць» без ролі', () => {
    const c = newCareer(0);
    expect(awaitingRole(c)).toBe(false);
    c.xp = 2;
    expect(awaitingRole(c)).toBe(true);
    c.role = 'medic';
    expect(awaitingRole(c)).toBe(false);
  });
});

describe('career: рядок втрати (EARS 7)', () => {
  it('відмінки після числівника', () => {
    const f = (n: number): string => pluralUk(n, 'місія', 'місії', 'місій');
    expect([0, 1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 101, 111].map(f)).toEqual([
      'місій',
      'місія',
      'місії',
      'місії',
      'місій',
      'місій',
      'місій',
      'місій',
      'місія',
      'місії',
      'місій',
      'місія',
      'місій',
    ]);
  });

  it("без роду, звання з малої; фатальна місія — у лічильнику, вбивства — за кар'єру", () => {
    const s = makeSoldier('s1', 'Олена');
    const c = newCareer(0);
    c.xp = 6;
    c.missions = 3;
    s.kills = 4;
    expect(lossLine(s, c)).toBe('✝ Втрата: сержант «Крук» — 4 місії, 4 вбивства');
    const r = newCareer(12);
    s.kills = 1;
    expect(lossLine(s, r)).toBe('✝ Втрата: рекрут «Крук 2» — 1 місія, 1 вбивство');
    s.kills = 0;
    expect(lossLine(s, r)).toBe('✝ Втрата: рекрут «Крук 2» — 1 місія, 0 вбивств');
  });
});
