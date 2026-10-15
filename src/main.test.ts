// src/main.test.ts
// П7: юніт-тести «візуальної логіки» main.ts — лише чисті функції без DOM
// (node-середовище vitest; DOM-ініціалізація в main.ts стоїть за typeof document).

import { describe, expect, it } from 'vitest';
// пR.2 (ADR-0037): тести перетворювачів подій (geoEventText/battleEventText/
// economyEventText) перенесено до src/ui/journal.test.ts; тести hpColor —
// до src/ui/panels.test.ts (разом із кодом, без ослаблення тверджень).
import { cellFromPoint, samePath } from './main';

describe('cellFromPoint: клік (CSS-пікселі) → клітинка бойовища', () => {
  // канва 520×520 buffer (20×20 клітинок по 26px — BCELL), розташована на сторінці
  const rect = { left: 10, top: 20, width: 520, height: 520 };
  const canvas = { width: 520, height: 520 };

  it('центр клітинки (3,2)', () => {
    expect(cellFromPoint(10 + 3 * 26 + 13, 20 + 2 * 26 + 13, rect, canvas)).toEqual({ x: 3, y: 2 });
  });

  it('межа клітинки — floor у нижчу', () => {
    expect(cellFromPoint(10 + 4 * 26, 20 + 5 * 26, rect, canvas)).toEqual({ x: 4, y: 5 });
  });

  it('CSS-масштабування канви (2×) не міняє клітинку', () => {
    const scaled = { left: 0, top: 0, width: 1040, height: 1040 };
    expect(cellFromPoint(2 * (5 * 26 + 12), 2 * (1 * 26 + 12), scaled, canvas)).toEqual({ x: 5, y: 1 });
  });

  it('клік поза канвою зліва — відʼємна клітинка (межі перевіряє обробник)', () => {
    const c = cellFromPoint(10 - 5, 20 + 3, rect, canvas);
    expect(c.x).toBeLessThan(0);
  });
});

describe('samePath: дедуплікація превʼю шляху під курсором', () => {
  it('null проти null — не той самий (тригер перерисовки)', () => {
    expect(samePath(null, null)).toBe(false);
  });

  it('null проти шляху — false', () => {
    expect(samePath(null, [{ x: 1, y: 1 }])).toBe(false);
    expect(samePath([{ x: 1, y: 1 }], null)).toBe(false);
  });

  it('ідентичні шляхи — true', () => {
    const a = [
      { x: 1, y: 2 },
      { x: 2, y: 2 },
    ];
    expect(
      samePath(a, [
        { x: 1, y: 2 },
        { x: 2, y: 2 },
      ])
    ).toBe(true);
  });

  it('різна довжина / інша клітинка — false', () => {
    expect(
      samePath(
        [{ x: 1, y: 1 }],
        [
          { x: 1, y: 1 },
          { x: 2, y: 1 },
        ]
      )
    ).toBe(false);
    expect(samePath([{ x: 1, y: 1 }], [{ x: 2, y: 1 }])).toBe(false);
  });
});

// пR.2 (ADR-0037): describe('hpColor') перенесено до src/ui/panels.test.ts;
// describe('validFireTargets') — до src/ui/battle.test.ts (разом із кодом,
// без ослаблення тверджень).
