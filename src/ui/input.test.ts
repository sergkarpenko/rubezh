// @vitest-environment jsdom
// пR.2: юніт-тести вводу тактичного бою (src/ui/input.ts, ADR-0037).
// cellFromPoint/samePath перенесено з main.test.ts без ослаблення тверджень;
// тут же — sameCell і гілки обробників (вибір солдата, зведення режимів,
// дозор, скасування, гарячі клавіші) на детермінованій партії (сід 42).
// DOM-флоу застосунку — у main.ui.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { advanceTime, missionTargets } from '../core/geo';
import { distance, hasLineOfSight } from '../core/combat';
import { makeMoveAnim, type Anim } from '../core/render-core';
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
    <canvas id="battle" width="960" height="960"></canvas>
    <div id="binfo">—</div>
    <div id="bcontrols">
      <button id="btn-snap">Швидкий</button>
      <button id="btn-aimed">Прицільний</button>
      <button id="btn-auto">Черга</button>
      <button id="btn-ow">Дозор</button>
      <button id="btn-medkit">Лікування</button>
      <button id="btn-grenade">Граната</button>
      <button id="btn-end">Кінець ходу</button>
      <button id="btn-auto-battle"><span class="tb-cap">Авто</span></button>
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
  deps: InputDeps & { autoBusy: ReturnType<typeof vi.fn> };
  binfo(): string;
}

function makeFixture(autoBusy = false, queue: Anim[] = []): Fixture {
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
    itemMode: null, // П11.6
  };
  const battleDeps: BattleDeps = {
    getParty: () => party,
    journal: vi.fn(),
    drainBattle: vi.fn(),
    resetBattleLog: vi.fn(),
    renderAll: vi.fn(),
    anim: { active: () => queue[0] ?? null, now: 0, push: vi.fn(), cancel: vi.fn(), queued: () => queue }, // П14.4: черга анімацій
    hasRaf: () => false,
    stopAuto: vi.fn(),
    autoBusy: () => false, // П13.3: авто-бій не триває
    cancelGeoAnim: vi.fn(),
  };
  const battle = createBattleUI(ui, battleDeps);
  const busy = vi.fn(() => autoBusy);
  const input = createInput(ui, battle, { renderAll: vi.fn(), autoBusy: busy });
  return {
    party,
    ui,
    battle,
    input,
    deps: { renderAll: vi.fn(), autoBusy: busy },
    binfo: () => document.getElementById('binfo')!.textContent ?? '',
  };
}

// Детерміновано (сід 42): тікати до першої цілі місії, запустити бій.
function launchMission(f: Fixture): void {
  for (let i = 0; i < 3000 && missionTargets(f.party.geo).length === 0; i++) advanceTime(f.party.geo, 1);
  f.battle.launch(missionTargets(f.party.geo)[0]!.id);
  expect(f.ui.mission).not.toBeNull();
}

// Клік у клітинку бойовища (канва 960×960, BCELL 48 — як у index.html; П14.3).
function clickAt(f: Fixture, x: number, y: number): void {
  f.input.battleCanvasClick({ clientX: x * 48 + 24, clientY: y * 48 + 24 } as MouseEvent);
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
  // канва 960×960 buffer (20×20 клітинок по 48px — BCELL, П14.3), розташована на сторінці
  const rect = { left: 10, top: 20, width: 960, height: 960 };
  const canvas = { width: 960, height: 960 };

  it('центр клітинки (3,2)', () => {
    expect(cellFromPoint(10 + 3 * 48 + 24, 20 + 2 * 48 + 24, rect, canvas)).toEqual({ x: 3, y: 2 });
  });

  it('межа клітинки — floor у нижчу', () => {
    expect(cellFromPoint(10 + 4 * 48, 20 + 5 * 48, rect, canvas)).toEqual({ x: 4, y: 5 });
  });

  it('CSS-масштабування канви (2×) не міняє клітинку', () => {
    const scaled = { left: 0, top: 0, width: 1920, height: 1920 };
    expect(cellFromPoint(2 * (5 * 48 + 24), 2 * (1 * 48 + 24), scaled, canvas)).toEqual({ x: 5, y: 1 });
  });

  it('клік поза канвою зліва — від’ємна клітинка (межі перевіряє обробник)', () => {
    const c = cellFromPoint(10 - 5, 20 + 3, rect, canvas);
    expect(c.x).toBeLessThan(0);
  });
});

describe('samePath: дедуплікація прев’ю шляху під курсором', () => {
  it('null проти null — не той самий (тригер перемальовки)', () => {
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
  it('null і null — той самий (без перемальовки)', () => {
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
    expect(f.binfo()).toBe('Спершу клікніть свого оперативника (синє коло).');
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
    expect(f.binfo()).toBe('Спершу клікніть свого оперативника.');
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

  it('дозор без AP — причина; під час авто-бою — керування заблоковано', () => {
    const f = makeFixture();
    launchMission(f);
    const s = f.ui.mission!.state.units.find((u) => u.side === 'player')!;
    f.ui.selectedId = s.id;
    s.ap = 1;
    f.input.armOverwatch();
    expect(f.binfo()).toContain('дозор коштує 3');
    const autoF = makeFixture(true); // П13.3 (ADR-0067): триває авто-бій
    launchMission(autoF);
    const d = autoF.ui.mission!.state.units.find((u) => u.side === 'player')!;
    autoF.ui.selectedId = d.id;
    autoF.input.armFire('snap');
    autoF.input.endPlayerTurn();
    expect(autoF.ui.fireMode).toBeNull(); // авто-бій — мовчки без дій
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

// П11.6 (Фаза 11, ADR-0058/0013): витратники в бою — аптечка і граната.
// Зведення (кнопка/клавіша M, G), тап-тап, валідації цілі, списання витратника.
describe('input: витратники бою — аптечка і граната (П11.6)', () => {
  it('armMedkit без предмета — підказка; без AP — причина; з предметом — зведено (клавіша M)', () => {
    const f = makeFixture();
    launchMission(f);
    const s = f.ui.mission!.state.units.find((u) => u.side === 'player')!;
    f.ui.selectedId = s.id;
    f.input.armMedkit();
    expect(f.binfo()).toContain('Гелю немає');
    f.ui.mission!.state.items = { [s.id]: { medkit: true, grenade: false } };
    s.ap = 2;
    f.input.onKeyDown({ code: 'KeyM' } as KeyboardEvent);
    expect(f.binfo()).toContain('Не вистачає AP');
    expect(f.ui.itemMode).toBeNull();
    s.ap = 10;
    f.input.onKeyDown({ code: 'KeyM' } as KeyboardEvent);
    expect(f.ui.itemMode).toBe('medkit');
    expect(f.binfo()).toContain('Гель');
  });

  it('аптечка: тап-тап по пораненому союзнику поруч — лікування, витратник списано', () => {
    const f = makeFixture();
    launchMission(f);
    const st = f.ui.mission!.state;
    const squad = st.units.filter((u) => u.side === 'player');
    const medic = squad[0]!;
    const mate = squad[1]!; // сусід по зоні висадки (≤1)
    st.items = { [medic.id]: { medkit: true, grenade: false } };
    mate.hp = mate.maxHp - 4; // поранений сусід
    f.ui.selectedId = medic.id;
    f.input.armMedkit();
    clickAt(f, mate.pos.x, mate.pos.y); // перший тап — підказка
    expect(f.binfo()).toContain('повторний клік');
    expect(mate.hp).toBe(mate.maxHp - 4); // дії ще не було
    clickAt(f, mate.pos.x, mate.pos.y); // повторний тап — лікування
    expect(mate.hp).toBe(mate.maxHp - 1); // +3 HP (HEAL_AMOUNT, кап maxHp)
    expect(medic.ap).toBe(10 - 4);
    expect(st.items[medic.id]!.medkit).toBe(false); // витратник списано
    expect(f.ui.itemMode).toBeNull();
    expect(f.binfo()).toContain('лікує');
  });

  it('аптечка: непоранена ціль — відмова без марнотратства; свій солдат у режимі — ціль, не вибір', () => {
    const f = makeFixture();
    launchMission(f);
    const st = f.ui.mission!.state;
    const squad = st.units.filter((u) => u.side === 'player');
    const medic = squad[0]!;
    st.items = { [medic.id]: { medkit: true, grenade: false } };
    f.ui.selectedId = medic.id;
    f.input.armMedkit();
    clickAt(f, squad[1]!.pos.x, squad[1]!.pos.y); // здоровий сусід
    expect(f.binfo()).toContain('не поранена');
    expect(f.ui.selectedId).toBe(medic.id); // вибір не перемкнувся
    expect(st.items[medic.id]!.medkit).toBe(true); // аптечка не витрачена
  });

  it('граната: зведення (клавіша G), тап-тап епіцентру — кидок, зона уражає', () => {
    const f = makeFixture();
    launchMission(f);
    const st = f.ui.mission!.state;
    const thrower = st.units.find((u) => u.side === 'player')!;
    st.items = { [thrower.id]: { medkit: false, grenade: true } };
    f.ui.selectedId = thrower.id;
    f.input.onKeyDown({ code: 'KeyG' } as KeyboardEvent);
    expect(f.ui.itemMode).toBe('grenade');
    // валідний епіцентр поруч: порожня клітинка в дальності з лінією кидка
    // (клітинка з юнітом — перевибір солдата, як у режимі пострілу)
    let target: { x: number; y: number } | null = null;
    for (let dx = -2; dx <= 2 && target === null; dx++) {
      for (let dy = -2; dy <= 2 && target === null; dy++) {
        const c = { x: thrower.pos.x + dx, y: thrower.pos.y + dy };
        if (st.units.some((u) => u.alive && u.pos.x === c.x && u.pos.y === c.y)) continue;
        if (distance(thrower.pos, c) > 6) continue;
        if (!hasLineOfSight(st, thrower.pos, c)) continue;
        target = c;
      }
    }
    expect(target).not.toBeNull();
    clickAt(f, target!.x, target!.y); // перший тап — прев'ю зони
    expect(f.binfo()).toContain('Зона вибуху');
    clickAt(f, target!.x, target!.y); // повторний тап — кидок
    expect(st.items[thrower.id]!.grenade).toBe(false); // витратник списано
    expect(thrower.ap).toBe(10 - 4);
    expect(f.ui.itemMode).toBeNull();
    expect(st.log.some((e) => e.type === 'grenade')).toBe(true);
  });

  it('граната: епіцентр поза дальністю — відмова; Esc — скасування режиму витратника', () => {
    const f = makeFixture();
    launchMission(f);
    const st = f.ui.mission!.state;
    const thrower = st.units.find((u) => u.side === 'player')!;
    st.items = { [thrower.id]: { medkit: false, grenade: true } };
    f.ui.selectedId = thrower.id;
    f.input.armGrenade();
    clickAt(f, thrower.pos.x + 7, thrower.pos.y); // >6 клітинок
    expect(f.binfo()).toContain('поза дальністю');
    expect(st.items[thrower.id]!.grenade).toBe(true);
    f.input.onKeyDown({ code: 'Escape', key: 'Escape' } as KeyboardEvent);
    expect(f.ui.itemMode).toBeNull();
    expect(f.binfo()).toBe('Режим витратника скасовано.');
  });
});

describe('П14.4: характеристики демона Розриву по тапу (фідбек прев’ю)', () => {
  it('тап по ВИДИМОМУ демону без зведених режимів — HP і зброя у binfo', () => {
    const f = makeFixture();
    launchMission(f);
    const st = f.ui.mission!.state;
    const alien = st.units.find((u) => u.side === 'alien' && u.alive)!;
    const soldier = st.units.find((u) => u.side === 'player' && u.alive)!;
    const home = { ...alien.pos }; // рідна клітинка — далеко у тумані
    // ставимо демона поруч із солдатом (видима клітинка; детерміновано — без RNG)
    let placed = false;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ]) {
      const p = { x: soldier.pos.x + dx, y: soldier.pos.y + dy };
      if (st.units.some((u) => u.alive && u.pos.x === p.x && u.pos.y === p.y)) continue; // не на юніта
      alien.pos = p;
      if (f.battle.visibleCells().has(p.x + ',' + p.y)) {
        placed = true;
        break;
      }
    }
    expect(placed).toBe(true);
    clickAt(f, alien.pos.x, alien.pos.y);
    expect(f.binfo()).toContain('HP ' + alien.hp + '/' + alien.maxHp);
    expect(f.binfo()).toContain(alien.weapon.name);
    expect(f.binfo()).toContain('дальність ' + alien.weapon.range);
    expect(f.binfo()).toContain('режим пострілу'); // підказка атаки лишається
    // той самий демон у тумані — характеристики не розкриваються (ADR-0006)
    alien.pos = home;
    expect(f.battle.visibleCells().has(home.x + ',' + home.y)).toBe(false);
    clickAt(f, home.x, home.y);
    expect(f.binfo()).not.toContain('зброя');
  });

  it('П14.4: під час відтворення ходу ШІ клік у відображувану клітинку демона (старт шляху) — характеристики', () => {
    const queue: Anim[] = [];
    const f = makeFixture(false, queue);
    launchMission(f);
    const st = f.ui.mission!.state;
    const alien = st.units.find((u) => u.side === 'alien' && u.alive)!;
    const soldier = st.units.find((u) => u.side === 'player' && u.alive)!;
    // видима вільна клітинка біля солдата — «відображувана» позиція демона:
    // демон фактично стоїть удома (у тумані), але черга анімацій тримає
    // його на початку шляху (фікс рваного ходу демонів)
    let spot: { x: number; y: number } | null = null;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ]) {
      const p = { x: soldier.pos.x + dx, y: soldier.pos.y + dy };
      if (st.units.some((u) => u.alive && u.pos.x === p.x && u.pos.y === p.y)) continue;
      if (f.battle.visibleCells().has(p.x + ',' + p.y)) {
        spot = p;
        break;
      }
    }
    expect(spot).not.toBeNull();
    queue.push(makeMoveAnim(alien, [spot!, { ...alien.pos }], false));
    clickAt(f, spot!.x, spot!.y);
    expect(f.binfo()).toContain('зброя «' + alien.weapon.name + '»'); // клік знаходить відображуваного демона
    // бойові гілки незмінні: фактична позиція демона — у тумані, постріл у
    // відображувану клітинку з недієвою зброєю не приводить до дії
  });
});
