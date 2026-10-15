// @vitest-environment jsdom
// пR.2: юніт-тести вводу тактичного бою (src/ui/input.ts, ADR-0037).
// cellFromPoint/samePath перенесено з main.test.ts без ослаблення тверджень;
// тут же — sameCell і гілки обробників (вибір солдата, зведення режимів,
// дозор, скасування, гарячі клавіші) на детермінованій партії (сід 42).
// DOM-флоу застосунку — у main.ui.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { advanceTime, missionTargets } from '../core/geo';
import { createParty, type Party } from '../core/save';
import { initPixelSprites } from '../render';
import { createBattleUI, type BattleDeps, type BattleUIState } from './battle';
import { cellFromPoint, createInput, sameCell, samePath, type InputDeps } from './input';

// Піксельний рушій (ADR-0031): тестовий мок фабрики offscreen-канвасів —
// той самий патерн, що й у main.ui.test.ts (jsdom без пакета canvas).
const noopCtx = new Proxy(
  {},
  {
    get: (_t, p) => {
      if (p === 'canvas') return undefined;
      return (...args: unknown[]) => String(args.map((a) => String(a)).join(','));
    },
    set: () => true,
  }
) as unknown as CanvasRenderingContext2D;

function setupDom(): void {
  // Мінімальна розмітка index.html: бойовище, підказка, контекст-стрічка і кнопки
  // (renderBattle чіпає усі ці елементи — armFire/Esc малюють кадр).
  document.body.innerHTML = `
    <div id="bctx">
      <span><b id="bctx-kind">—</b></span>
      <span><b id="bctx-time">—</b></span>
      <span><b id="bctx-turn">—</b></span>
      <span><b id="bctx-unit">—</b></span>
    </div>
    <div id="bresult"></div>
    <canvas id="battle" width="520" height="520"></canvas>
    <div id="binfo">—</div>
    <div id="bcontrols">
      <button id="btn-snap">Швидкий</button>
      <button id="btn-aimed">Прицільний</button>
      <button id="btn-auto">Черга</button>
      <button id="btn-ow">Дозор</button>
      <button id="btn-end">Кінець ходу</button>
      <button id="btn-demo">Демо-бій</button>
    </div>`;
  const proto = HTMLCanvasElement.prototype as unknown as {
    getContext: () => CanvasRenderingContext2D;
    getBoundingClientRect: (this: HTMLCanvasElement) => DOMRect;
  };
  proto.getContext = () => noopCtx;
  // Клік-математика: канва розтягнута 1:1, клітинка = width/20 (BCELL).
  proto.getBoundingClientRect = function (this: HTMLCanvasElement): DOMRect {
    return {
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      width: this.width,
      height: this.height,
      right: this.width,
      bottom: this.height,
      toJSON: () => '',
    } as DOMRect;
  };
}

interface Fixture {
  party: Party;
  ui: BattleUIState;
  battle: ReturnType<typeof createBattleUI>;
  input: ReturnType<typeof createInput>;
  deps: InputDeps & { demoBusy: ReturnType<typeof vi.fn> };
  binfo(): string;
}

function makeFixture(demoBusy = false): Fixture {
  const party = createParty(42);
  const ui: BattleUIState = {
    mission: null,
    battleResult: null,
    selectedId: null,
    fireMode: null,
    hoverPath: null,
    hoverAp: 0,
    tapCell: null,
    aimCell: null,
  };
  const battleDeps: BattleDeps = {
    getParty: () => party,
    journal: vi.fn(),
    drainBattle: vi.fn(),
    resetBattleLog: vi.fn(),
    renderAll: vi.fn(),
    anim: { active: () => null, now: 0, push: vi.fn(), cancel: vi.fn() },
    hasRaf: () => false,
    stopDemo: vi.fn(),
    cancelGeoAnim: vi.fn(),
  };
  const battle = createBattleUI(ui, battleDeps);
  const busy = vi.fn(() => demoBusy);
  const input = createInput(ui, battle, { renderAll: vi.fn(), demoBusy: busy });
  return {
    party,
    ui,
    battle,
    input,
    deps: { renderAll: vi.fn(), demoBusy: busy },
    binfo: () => document.getElementById('binfo')!.textContent ?? '',
  };
}

// Детерміновано (сід 42): тікати до першої цілі місії, запустити бій.
function launchMission(f: Fixture): void {
  for (let i = 0; i < 3000 && missionTargets(f.party.geo).length === 0; i++) advanceTime(f.party.geo, 1);
  f.battle.launch(missionTargets(f.party.geo)[0]!.id);
  expect(f.ui.mission).not.toBeNull();
}

// Клік у клітинку бойовища (канва 520×520, BCELL 26 — як у index.html).
function clickAt(f: Fixture, x: number, y: number): void {
  f.input.battleCanvasClick({ clientX: x * 26 + 13, clientY: y * 26 + 13 } as MouseEvent);
}

beforeEach(() => {
  setupDom();
  initPixelSprites((w, h) => ({
    width: w,
    height: h,
    getContext: () => noopCtx,
  }));
});

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
        [
          { x: 1, y: 1 },
          { x: 2, y: 1 },
        ],
        [{ x: 1, y: 1 }]
      )
    ).toBe(false);
    expect(samePath([{ x: 1, y: 1 }], [{ x: 2, y: 1 }])).toBe(false);
  });
});

describe('sameCell: порівняння nullable-клітинок (П6.14)', () => {
  it('null і null — той самий (без перерисовки)', () => {
    expect(sameCell(null, null)).toBe(true);
  });

  it('null проти клітинки — false', () => {
    expect(sameCell(null, { x: 1, y: 1 })).toBe(false);
    expect(sameCell({ x: 1, y: 1 }, null)).toBe(false);
  });

  it('та сама клітинка — true, інша — false', () => {
    expect(sameCell({ x: 2, y: 3 }, { x: 2, y: 3 })).toBe(true);
    expect(sameCell({ x: 2, y: 3 }, { x: 3, y: 3 })).toBe(false);
  });
});

describe('input: обробники вводу бою (тап-тап, зведення, дозор, клавіші)', () => {
  it('клік без вибору — підказка спершу вибрати солдата', () => {
    const f = makeFixture();
    launchMission(f);
    clickAt(f, 10, 10); // порожня клітинка, вибору нема
    expect(f.binfo()).toBe('Спершу клікніть свого солдата (синє коло).');
  });

  it('клік по своєму солдату — вибір і стан скинуто', () => {
    const f = makeFixture();
    launchMission(f);
    const s = f.ui.mission!.state.units.find((u) => u.side === 'player')!;
    clickAt(f, s.pos.x, s.pos.y);
    expect(f.ui.selectedId).toBe(s.id);
    expect(f.binfo()).toContain(s.name);
  });

  it('armFire без вибору — підказка; з вибором але без AP — причина', () => {
    const f = makeFixture();
    launchMission(f);
    f.input.armFire('snap');
    expect(f.binfo()).toBe('Спершу клікніть свого солдата.');
    const s = f.ui.mission!.state.units.find((u) => u.side === 'player')!;
    f.ui.selectedId = s.id;
    s.ap = 0; // не вистачає на швидкий постріл (3 AP)
    f.input.armFire('snap');
    expect(f.binfo()).toContain('Не вистачає AP');
    expect(f.ui.fireMode).toBeNull(); // режим не зведено
  });

  it('armFire з AP — зведений режим і підказка шансу', () => {
    const f = makeFixture();
    launchMission(f);
    const s = f.ui.mission!.state.units.find((u) => u.side === 'player')!;
    f.ui.selectedId = s.id;
    f.input.armFire('snap');
    expect(f.ui.fireMode).toBe('snap');
    expect(f.binfo()).toContain('постріл: 3 AP');
  });

  it('дозор без AP — причина; під час демо — керування заблоковано', () => {
    const f = makeFixture();
    launchMission(f);
    const s = f.ui.mission!.state.units.find((u) => u.side === 'player')!;
    f.ui.selectedId = s.id;
    s.ap = 1;
    f.input.armOverwatch();
    expect(f.binfo()).toContain('дозор коштує 3');
    const demoF = makeFixture(true); // П6.16: триває демо
    launchMission(demoF);
    const d = demoF.ui.mission!.state.units.find((u) => u.side === 'player')!;
    demoF.ui.selectedId = d.id;
    demoF.input.armFire('snap');
    demoF.input.endPlayerTurn();
    expect(demoF.ui.fireMode).toBeNull(); // демо — мовчки без дій
  });

  it('клавіша Esc: скасовує зведений режим, потім вибір (ADR-0027)', () => {
    const f = makeFixture();
    launchMission(f);
    const s = f.ui.mission!.state.units.find((u) => u.side === 'player')!;
    f.ui.selectedId = s.id;
    f.input.armFire('snap');
    f.input.onKeyDown({ code: 'Escape', key: 'Escape' } as KeyboardEvent);
    expect(f.ui.fireMode).toBeNull();
    expect(f.binfo()).toBe('Режим пострілу скасовано.');
    f.input.onKeyDown({ code: 'Escape', key: 'Escape' } as KeyboardEvent);
    expect(f.ui.selectedId).toBeNull();
    expect(f.binfo()).toBe('Вибір знято.');
  });

  it('гарячі клавіші ігноруються у полях вводу (сід)', () => {
    const f = makeFixture();
    launchMission(f);
    const inp = document.createElement('input');
    f.input.onKeyDown({ code: 'Digit1', key: '1', target: inp } as unknown as KeyboardEvent);
    expect(f.ui.fireMode).toBeNull(); // подія з поля вводу проігнорована
  });
});
