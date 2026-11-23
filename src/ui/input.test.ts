// @vitest-environment jsdom
// пR.2: юніт-тести вводу тактичного бою (src/ui/input.ts, ADR-0037).
// cellFromPoint/samePath перенесено з main.test.ts без ослаблення тверджень;
// тут же — sameCell і гілки обробників (вибір солдата, зведення режимів,
// дозор, скасування, гарячі клавіші) на детермінованій партії (сід 42).
// DOM-флоу застосунку — у main.ui.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { advanceTime, missionTargets } from '../core/geo';
import { distance, hasLineOfSight, type Unit } from '../core/combat';
import { findPath } from '../core/map';
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
    </div>
    <div id="bsquad"></div>
    <div id="benemy" class="hidden"></div>
    <div id="bresult"></div>
    <canvas id="battle" width="960" height="960"></canvas>
    <div id="binfo">—</div>
    <div id="bturn" class="hidden"></div>
    <div id="bcontrols">
      <button id="btn-snap">Швидкий</button>
      <button id="btn-aimed">Прицільний</button>
      <button id="btn-auto">Черга</button>
      <button id="btn-ow">Дозор</button>
      <button id="btn-medkit">Лікування</button>
      <button id="btn-grenade">Граната</button>
      <button id="btn-evac">Евакуація</button>
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
  deps: InputDeps & { autoBusy: ReturnType<typeof vi.fn>; confirmLastEvac: ReturnType<typeof vi.fn> };
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
    menuId: null, // Т.131
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
    ambient: { paintBattle: vi.fn() }, // П14.8: ambient no-op (гейти в модулі)
  };
  const battle = createBattleUI(ui, battleDeps);
  const busy = vi.fn(() => autoBusy);
  const confirmLastEvac = vi.fn(); // Т.71: вікно підтвердження — у тестах лише виклик
  const input = createInput(ui, battle, { renderAll: vi.fn(), autoBusy: busy, confirmLastEvac, overlayOpen: () => false });
  return {
    party,
    ui,
    battle,
    input,
    deps: { renderAll: vi.fn(), autoBusy: busy, confirmLastEvac, overlayOpen: () => false },
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
    expect(f.binfo()).toBe('Спершу виберіть свого оперативника — на полі або карткою загону.');
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

  it('Т.117: пробіл і Esc під час плашки «діють» лише пропускають її; без плашки Esc — як раніше', () => {
    const f = makeFixture();
    launchMission(f);
    const s = f.ui.mission!.state.units.find((u) => u.side === 'player')!;
    f.ui.selectedId = s.id;
    let acting = true;
    f.battle.skipAlienTurn = () => {
      const was = acting;
      acting = false;
      return was;
    };
    const prevented: string[] = [];
    const key = (k: string): void =>
      f.input.onKeyDown({ key: k, code: k, preventDefault: () => prevented.push(k) } as unknown as KeyboardEvent);
    key(' ');
    expect(prevented).toEqual([' ']);
    acting = true;
    key('Escape');
    expect(f.ui.selectedId).toBe(s.id); // Esc пропустив плашку, вибір не знято
    key('Escape');
    expect(f.ui.selectedId).toBeNull();
    expect(prevented).toEqual([' ', 'Escape']);
  });

  it('Т.117 (аудит): автоповтор пробілу після пропуску підсумок не прибирає; фокус з кнопки знято', () => {
    const f = makeFixture();
    launchMission(f);
    let acting = true;
    f.battle.skipAlienTurn = () => {
      const was = acting;
      acting = false;
      return was;
    };
    const dismiss = vi.fn();
    f.battle.dismissTurnPlate = dismiss;
    const b = document.createElement('button');
    document.body.append(b);
    b.focus();
    const key = (repeat: boolean): void =>
      f.input.onKeyDown({ key: ' ', code: 'Space', repeat, preventDefault: () => {} } as unknown as KeyboardEvent);
    key(false);
    expect(document.activeElement).not.toBe(b);
    key(true);
    key(true);
    expect(dismiss).not.toHaveBeenCalled();
    b.remove();
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
    expect(f.binfo()).toContain('гелю немає');
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
    expect(f.ui.menuId).toBe(alien.id); // Т.131: і меню на ворогові
    // той самий демон у тумані — характеристики не розкриваються (ADR-0006): перший клік лише
    // закриває меню (клік повз, Т.131), другий — порожня клітинка
    alien.pos = home;
    expect(f.battle.visibleCells().has(home.x + ',' + home.y)).toBe(false);
    clickAt(f, home.x, home.y);
    expect(f.ui.menuId).toBe(null);
    clickAt(f, home.x, home.y);
    expect(f.ui.menuId).toBe(null);
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
    expect(f.ui.menuId).toBeNull(); // аудит PR #444: фактично демон у тумані — меню на ворогові не відкривається
    // бойові гілки незмінні: фактична позиція демона — у тумані, постріл у
    // відображувану клітинку з недієвою зброєю не приводить до дії
  });
});

describe('Т.45: прев\u2019ю шляху під курсором у режимах', () => {
  const PATH_HINT = /^(Шлях: \d+ AP|Не вистачає AP: шлях \d+)/;
  // Вибраний оперативник і порожня клітинка поруч, до якої є шлях.
  function hoverFixture(autoBusy = false): { f: Fixture; s: Unit; hover: () => void } {
    const f = makeFixture(autoBusy);
    launchMission(f);
    const st = f.ui.mission!.state;
    const s = st.units.find((u) => u.side === 'player' && u.alive)!;
    f.ui.selectedId = s.id;
    const to = [1, 2, 3, 4, 5, 6]
      .flatMap((d) => [
        { x: s.pos.x + d, y: s.pos.y },
        { x: s.pos.x, y: s.pos.y + d },
        { x: s.pos.x - d, y: s.pos.y },
        { x: s.pos.x, y: s.pos.y - d },
      ])
      .find((c) => !st.units.some((u) => u.alive && u.pos.x === c.x && u.pos.y === c.y) && findPath(st, s.pos, c) !== null)!;
    const hover = (): void => f.input.battleCanvasHover({ clientX: to.x * 48 + 24, clientY: to.y * 48 + 24 } as MouseEvent);
    return { f, s, hover };
  }

  it('без режиму наведення дає шлях, ціну і підказку в #binfo', () => {
    const { f, hover } = hoverFixture();
    hover();
    expect(f.ui.hoverPath).not.toBeNull();
    expect(f.ui.hoverAp).toBeGreaterThan(0);
    expect(f.binfo()).toMatch(PATH_HINT);
  });

  it('зведений постріл: наведення на порожню клітинку шляху не дає і підказку режиму не переписує', () => {
    for (const mode of ['snap', 'aimed', 'auto'] as const) {
      const { f, hover } = hoverFixture();
      f.input.armFire(mode);
      expect(f.ui.fireMode).toBe(mode);
      const hint = f.binfo();
      hover();
      expect(f.ui.hoverPath).toBeNull();
      expect(f.binfo()).toBe(hint);
      expect(hint).not.toMatch(PATH_HINT);
    }
  });

  it('граната і гель: наведення шляху не дає, підказка режиму лишається', () => {
    for (const mode of ['grenade', 'medkit'] as const) {
      const { f, s, hover } = hoverFixture();
      f.ui.mission!.state.items = { [s.id]: { medkit: true, grenade: true } };
      if (mode === 'grenade') f.input.armGrenade();
      else f.input.armMedkit();
      expect(f.ui.itemMode).toBe(mode);
      const hint = f.binfo();
      hover();
      expect(f.ui.hoverPath).toBeNull();
      expect(f.binfo()).toBe(hint);
    }
  });

  it('шлях, наведений до зведення, наведення в режимі прибирає і перемальовує поле', () => {
    for (const arm of [(f: Fixture) => f.input.armFire('snap'), (f: Fixture) => f.input.armGrenade()]) {
      const { f, s, hover } = hoverFixture();
      f.ui.mission!.state.items = { [s.id]: { medkit: false, grenade: true } };
      hover();
      expect(f.ui.hoverPath).not.toBeNull();
      arm(f);
      const spy = vi.spyOn(f.battle, 'renderBattle');
      hover();
      expect(f.ui.hoverPath).toBeNull();
      expect(spy).toHaveBeenCalledTimes(1);
      hover(); // шляху вже немає — зайвої перемальовки теж
      expect(spy).toHaveBeenCalledTimes(1);
    }
  });

  it('авто-бій: наведення малює шлях, але #binfo не переписує', () => {
    const { f, hover } = hoverFixture(true);
    f.battle.binfo('Авто-бій триває.');
    hover();
    expect(f.ui.hoverPath).not.toBeNull();
    expect(f.binfo()).toBe('Авто-бій триває.');
  });

  it('авто-бій: і коли AP на шлях не вистачає, #binfo не переписується', () => {
    const { f, s, hover } = hoverFixture(true);
    s.ap = 0;
    f.battle.binfo('Авто-бій триває.');
    hover();
    expect(f.ui.hoverAp).toBeGreaterThan(s.ap);
    expect(f.binfo()).toBe('Авто-бій триває.');
  });
});

// Т.121 (рішення власника 22.11.2026, варіант А; кандидат 116, аудит PR #434): поки грає анімація,
// порожня клітинка мовчить — тап і наведення не пишуть «Шлях: N AP» і не ходять наосліп;
// вибір свого оперативника працює, як і раніше.
describe('Т.121: порожня клітинка поля під час анімації', () => {
  function animFixture(): { f: Fixture; s: Unit; queue: Anim[]; to: { x: number; y: number }; tap: () => void; hover: () => void } {
    const queue: Anim[] = [];
    const f = makeFixture(false, queue);
    launchMission(f);
    const st = f.ui.mission!.state;
    const s = st.units.find((u) => u.side === 'player' && u.alive)!;
    clickAt(f, s.pos.x, s.pos.y); // вибір
    const to = [2, 3, 1]
      .flatMap((d) => [
        { x: s.pos.x + d, y: s.pos.y },
        { x: s.pos.x, y: s.pos.y + d },
      ])
      .find((c) => !st.units.some((u) => u.alive && u.pos.x === c.x && u.pos.y === c.y) && findPath(st, s.pos, c) !== null)!;
    const ev = { clientX: to.x * 48 + 24, clientY: to.y * 48 + 24 } as MouseEvent;
    return { f, s, queue, to, tap: () => f.input.battleCanvasClick(ev), hover: () => f.input.battleCanvasHover(ev) };
  }

  it('тап-тап під час анімації: ні підказки, ні прев\u2019ю, ні ходу; після анімації — як завжди', () => {
    const { f, s, queue, to, tap } = animFixture();
    const before = f.binfo();
    const pos = { ...s.pos };
    queue.push(makeMoveAnim(s, [pos], true));
    expect(f.battle.animating()).toBe(true);
    tap();
    tap();
    expect(f.binfo()).toBe(before);
    expect(f.ui.tapCell).toBeNull();
    expect(f.ui.hoverPath).toBeNull();
    expect(s.pos).toEqual(pos);
    expect(s.ap).toBe(s.maxAp);
    queue.length = 0; // анімація скінчилась
    expect(f.battle.animating()).toBe(false);
    tap();
    expect(f.binfo()).toMatch(/^Шлях: \d+ AP — повторний тап/);
    expect(s.pos).toEqual(pos);
    tap();
    expect(s.pos).toEqual(to);
  });

  it('перший тап до анімації, другий — під час неї: ходу немає, прев\u2019ю і перший тап лишаються', () => {
    const { f, s, queue, tap } = animFixture();
    tap();
    const hint = f.binfo();
    const pos = { ...s.pos };
    queue.push(makeMoveAnim(s, [pos], true));
    const path = f.ui.hoverPath;
    const tapCell = f.ui.tapCell;
    tap();
    expect(s.pos).toEqual(pos);
    expect(f.binfo()).toBe(hint);
    expect(f.ui.hoverPath).toBe(path);
    expect(f.ui.tapCell).toBe(tapCell);
  });

  it('наведення під час анімації нічого не міняє; після — шлях і ціна', () => {
    const { f, s, queue, hover } = animFixture();
    queue.push(makeMoveAnim(s, [{ ...s.pos }], true));
    f.battle.binfo('мітка');
    hover();
    expect(f.ui.hoverPath).toBeNull();
    expect(f.binfo()).toBe('мітка');
    queue.length = 0;
    hover();
    const path = f.ui.hoverPath;
    expect(path).not.toBeNull();
    expect(f.binfo()).toMatch(/^Шлях: \d+ AP/);
    queue.push(makeMoveAnim(s, [{ ...s.pos }], true));
    f.battle.binfo('мітка');
    hover();
    expect(f.ui.hoverPath).toBe(path); // шлях, наведений до анімації, лишається — з'явиться з її кінцем
    expect(f.binfo()).toBe('мітка');
    f.input.battleCanvasHover({ clientX: s.pos.x * 48 + 24, clientY: s.pos.y * 48 + 24 } as MouseEvent);
    expect(f.ui.hoverPath).toBe(path); // і наведення на свого оперативника (знахідка Vibe)
  });

  it('зведений постріл: тап у порожню клітинку під час анімації режим не знімає; після — знімає, як і раніше', () => {
    const { f, s, queue, tap } = animFixture();
    f.input.armFire('snap');
    expect(f.ui.fireMode).toBe('snap');
    const hint = f.binfo();
    queue.push(makeMoveAnim(s, [{ ...s.pos }], true));
    tap();
    expect(f.ui.fireMode).toBe('snap');
    expect(f.binfo()).toBe(hint);
    queue.length = 0;
    tap();
    expect(f.ui.fireMode).toBeNull();
    expect(f.binfo()).toMatch(/^Шлях: \d+ AP/);
  });

  it('зведений постріл по видимому демону під час анімації — як і раніше (постріл чи причина)', () => {
    const { f, s, queue, to, tap } = animFixture();
    const alien = f.ui.mission!.state.units.find((u) => u.side === 'alien' && u.alive)!;
    alien.pos = { ...to }; // демон поруч із загоном — видимий
    expect(f.battle.visibleCells().has(to.x + ',' + to.y)).toBe(true);
    f.input.armFire('snap');
    const hint = f.binfo();
    queue.push(makeMoveAnim(s, [{ ...s.pos }], true));
    tap();
    expect(f.binfo()).not.toBe(hint);
    expect(f.ui.aimCell).toEqual(to); // перший тап тап-тапу пострілу — ціль зведено
    tap();
    expect(s.ap).toBeLessThan(s.maxAp); // другий — постріл
  });

  it('граната: тап-тап у порожню клітинку під час анімації — ні прев\u2019ю зони, ні кидка; після — прев\u2019ю', () => {
    const { f, s, queue, tap } = animFixture();
    f.ui.mission!.state.items = { [s.id]: { medkit: false, grenade: true } };
    f.input.armGrenade();
    expect(f.ui.itemMode).toBe('grenade');
    const hint = f.binfo();
    queue.push(makeMoveAnim(s, [{ ...s.pos }], true));
    tap();
    tap();
    expect(f.ui.tapCell).toBeNull();
    expect(f.binfo()).toBe(hint);
    expect(s.ap).toBe(s.maxAp);
    queue.length = 0;
    tap();
    expect(f.ui.tapCell).not.toBeNull();
    expect(f.binfo()).toMatch(/^Зона вибуху/);
  });

  it('вибір свого оперативника під час анімації — як і раніше', () => {
    const { f, s, queue } = animFixture();
    const other = f.ui.mission!.state.units.find((u) => u.side === 'player' && u.alive && u.id !== s.id)!;
    queue.push(makeMoveAnim(s, [{ ...s.pos }], true));
    clickAt(f, other.pos.x, other.pos.y);
    expect(f.ui.selectedId).toBe(other.id);
    expect(f.binfo()).toContain(other.name + ': HP');
  });
});

describe('ADR-0081: демон у тумані для вводу не існує', () => {
  // Сід 42, початок першої місії: демони стоять у своїй зоні, поза оглядом загону.
  function fogFixture(): { f: Fixture; soldier: Unit; alien: Unit } {
    const f = makeFixture();
    launchMission(f);
    const st = f.ui.mission!.state;
    const soldier = st.units.find((u) => u.side === 'player' && u.alive)!;
    const alien = st.units.find((u) => u.side === 'alien' && u.alive)!;
    expect(f.battle.visibleCells().has(alien.pos.x + ',' + alien.pos.y)).toBe(false);
    f.ui.selectedId = soldier.id;
    return { f, soldier, alien };
  }
  const PREVIEW = /^(Шлях: \d+ AP|Не вистачає AP: шлях \d+)/; // підказка порожньої клітинки

  it('клік по невидимій клітинці з демоном — прев’ю шляху, як по порожній (і у зведеному режимі)', () => {
    const { f, alien } = fogFixture();
    clickAt(f, alien.pos.x, alien.pos.y);
    expect(f.binfo()).toMatch(PREVIEW);
    expect(f.binfo()).not.toContain('туман');
    expect(f.ui.hoverPath!.at(-1)).toEqual(alien.pos); // шлях веде у саму клітинку
    f.ui.tapCell = null;
    f.input.armFire('snap');
    clickAt(f, alien.pos.x, alien.pos.y);
    expect(f.binfo()).toMatch(PREVIEW);
    expect(f.ui.fireMode).toBeNull(); // як клік по порожній клітинці: режим знято
  });

  it('наведення на невидиму клітинку з демоном малює шлях', () => {
    const { f, alien } = fogFixture();
    f.input.battleCanvasHover({ clientX: alien.pos.x * 48 + 24, clientY: alien.pos.y * 48 + 24 } as MouseEvent);
    expect(f.ui.hoverPath!.at(-1)).toEqual(alien.pos);
  });

  it('хід у клітинку демона: рух закінчується перед юнітом із туману, AP — за пройдене', () => {
    const { f, soldier, alien } = fogFixture();
    soldier.ap = 99; // вистачає на весь шлях — зупиняє лише демон
    const start = { ...soldier.pos };
    clickAt(f, alien.pos.x, alien.pos.y);
    const path = f.ui.hoverPath!.map((p) => ({ ...p }));
    clickAt(f, alien.pos.x, alien.pos.y); // повторний тап — хід
    const st = f.ui.mission!.state;
    const moved = 99 - soldier.ap;
    expect(moved).toBeLessThan(path.length); // останній крок не зроблено
    expect(soldier.pos).toEqual(moved > 0 ? path[moved - 1] : start);
    const blocker = st.units.find((u) => u.alive && u.pos.x === path[moved]!.x && u.pos.y === path[moved]!.y)!;
    expect(blocker.side).toBe('alien');
    expect(f.binfo()).toBe(soldier.name + ': шлях перекрито — ' + blocker.name + '. AP ' + soldier.ap + '/' + soldier.maxAp + '.');
    expect(st.log.filter((e) => e.type === 'move')).toHaveLength(moved);
  });
});

describe('Т.46: старт авто-бою знімає зведений режим (disarm)', () => {
  // Вибраний оперативник із повним AP у запущеній місії.
  function armedFixture(): { f: Fixture; s: Unit } {
    const f = makeFixture();
    launchMission(f);
    const s = f.ui.mission!.state.units.find((u) => u.side === 'player' && u.alive)!;
    f.ui.selectedId = s.id;
    return { f, s };
  }

  it('зведений постріл (усі три режими) знято разом із ціллю тап-тапу і плашкою шансу; вибір і #binfo — без змін', () => {
    for (const mode of ['snap', 'aimed', 'auto'] as const) {
      const { f, s } = armedFixture();
      f.input.armFire(mode);
      expect(f.ui.fireMode).toBe(mode);
      f.ui.tapCell = { x: 5, y: 5 };
      f.ui.aimCell = { x: 5, y: 5 };
      const hint = f.binfo();
      f.input.disarm();
      expect(f.ui.fireMode).toBeNull();
      expect(f.ui.tapCell).toBeNull();
      expect(f.ui.aimCell).toBeNull();
      expect(f.ui.selectedId).toBe(s.id);
      expect(f.binfo()).toBe(hint);
    }
  });

  it('зведений витратник (граната і гель) знято, вибір оперативника лишається', () => {
    for (const mode of ['grenade', 'medkit'] as const) {
      const { f, s } = armedFixture();
      f.ui.mission!.state.items = { [s.id]: { medkit: true, grenade: true } };
      if (mode === 'grenade') f.input.armGrenade();
      else f.input.armMedkit();
      expect(f.ui.itemMode).toBe(mode);
      f.ui.tapCell = { x: 5, y: 5 };
      f.input.disarm();
      expect(f.ui.itemMode).toBeNull();
      expect(f.ui.fireMode).toBeNull();
      expect(f.ui.tapCell).toBeNull();
      expect(f.ui.selectedId).toBe(s.id);
    }
  });

  it('без зведеного режиму: перший тап ходу і плашка шансу скидаються, шлях під курсором і вибір лишаються', () => {
    const { f, s } = armedFixture();
    const path = [{ x: s.pos.x + 1, y: s.pos.y }];
    f.ui.tapCell = { x: s.pos.x + 1, y: s.pos.y };
    f.ui.aimCell = { x: 5, y: 5 };
    f.ui.hoverPath = path;
    const hint = f.binfo();
    f.input.disarm();
    expect(f.ui.tapCell).toBeNull();
    expect(f.ui.aimCell).toBeNull();
    expect(f.ui.hoverPath).toBe(path);
    expect(f.ui.selectedId).toBe(s.id);
    expect(f.binfo()).toBe(hint);
  });

  it('перший тап ходу → старт авто-бою → один тап у ту саму клітинку ходу не виконує (знову лише прев\u2019ю)', () => {
    const { f, s } = armedFixture();
    const st = f.ui.mission!.state;
    const to = [
      { x: s.pos.x + 1, y: s.pos.y },
      { x: s.pos.x, y: s.pos.y + 1 },
      { x: s.pos.x - 1, y: s.pos.y },
      { x: s.pos.x, y: s.pos.y - 1 },
    ].find((c) => !st.units.some((u) => u.alive && u.pos.x === c.x && u.pos.y === c.y) && findPath(st, s.pos, c) !== null)!;
    clickAt(f, to.x, to.y); // перший тап — прев'ю
    expect(f.ui.tapCell).toEqual(to);
    f.input.disarm(); // старт авто-бою; «Стоп» стану вводу не міняє
    clickAt(f, to.x, to.y);
    expect(s.pos).not.toEqual(to); // хід не виконано
    expect(f.ui.tapCell).toEqual(to); // тап знову перший
    clickAt(f, to.x, to.y);
    expect(s.pos).toEqual(to); // другий тап — хід
  });
});

// Т.71 (ADR-0075, рішення власника 18.11.2026): «Евакуація» — плитка тулбара і клавіша V; оперативник
// на синій клітинці висадки покидає поле; останнього — лише через вікно підтвердження.
describe('Т.71: евакуація (плитка і клавіша V)', () => {
  const keyV = (f: Fixture): void => f.input.onKeyDown(new KeyboardEvent('keydown', { key: 'v', code: 'KeyV' }));
  const squad = (f: Fixture): Unit[] => f.ui.mission!.state.units.filter((u) => u.side === 'player' && u.alive);
  const cap = (): string => document.querySelector('#btn-evac .tb-cap')?.textContent ?? '';

  it('Т.71: без вибору — підказка; не на висадці і без AP — причина в підказці й на плитці', () => {
    const f = makeFixture();
    launchMission(f);
    document.getElementById('btn-evac')!.innerHTML = '<span class="tb-cap">Евакуація</span>';
    keyV(f);
    expect(f.binfo()).toBe('Спершу клікніть свого оперативника.');
    const [s] = squad(f);
    f.ui.selectedId = s!.id;
    s!.pos = { x: 10, y: 10 };
    keyV(f);
    expect(f.binfo()).toBe('Евакуація — лише з синьої клітинки висадки.');
    f.battle.renderBattle();
    expect(cap()).toBe('поза зоною');
    expect((document.getElementById('btn-evac') as HTMLButtonElement).disabled).toBe(true);
    s!.pos = { x: 2, y: 2 };
    s!.ap = 1;
    keyV(f);
    expect(f.binfo()).toBe('Не вистачає AP: евакуація коштує 2, є 1.');
    f.battle.renderBattle();
    expect(cap()).toBe('мало AP');
  });

  it('Т.71: клавіша V на синій клітинці — оперативник покидає поле, вибір знято; під авто-боєм V не діє', () => {
    const f = makeFixture();
    launchMission(f);
    const [s, t] = squad(f);
    const n = squad(f).length;
    expect(n).toBeGreaterThan(1);
    f.ui.selectedId = t!.id;
    f.deps.autoBusy.mockReturnValue(true);
    keyV(f);
    expect(squad(f)).toHaveLength(n);
    f.deps.autoBusy.mockReturnValue(false);
    f.ui.selectedId = s!.id;
    keyV(f);
    expect(squad(f).map((u) => u.id)).not.toContain(s!.id);
    expect(f.ui.mission!.state.evacuated!.map((u) => u.id)).toEqual([s!.id]);
    expect(f.ui.selectedId).toBeNull();
    expect(f.binfo()).toBe('Евакуйовано: ' + s!.name + '. На полі лишилось оперативників: ' + (n - 1) + '.');
    expect(f.deps.confirmLastEvac).not.toHaveBeenCalled();
  });

  it('Т.71: останній на полі — лише через вікно підтвердження; без «Евакуювати» він лишається, після — бій «евакуйовано»', () => {
    const f = makeFixture();
    launchMission(f);
    const all = squad(f);
    for (const u of all.slice(0, -1)) {
      f.ui.selectedId = u.id;
      keyV(f);
    }
    const last = all[all.length - 1]!;
    f.ui.selectedId = last.id;
    keyV(f);
    expect(f.deps.confirmLastEvac).toHaveBeenCalledTimes(1);
    expect(f.deps.confirmLastEvac.mock.calls[0]![0]).toBe(last.name);
    expect(squad(f).map((u) => u.id)).toEqual([last.id]);
    expect(f.ui.battleResult).toBeNull();
    (f.deps.confirmLastEvac.mock.calls[0]![1] as () => void)();
    expect(squad(f)).toEqual([]);
    expect(document.getElementById('bresult')!.textContent).toContain(
      'ЗАГІН ЕВАКУЙОВАНО — врятовані на базі, зонд Розриву лишається активним'
    );
  });

  it('Т.71: «Евакуювати» у вікні ще раз перевіряє клітинку, AP і авто-бій — інакше нікого не знімає', () => {
    const f = makeFixture();
    launchMission(f);
    const all = squad(f);
    for (const u of all.slice(0, -1)) {
      f.ui.selectedId = u.id;
      keyV(f);
    }
    const last = all[all.length - 1]!;
    f.ui.selectedId = last.id;
    keyV(f);
    const yes = f.deps.confirmLastEvac.mock.calls[0]![1] as () => void;
    const pos = last.pos;
    last.pos = { x: 10, y: 10 };
    yes();
    expect(f.binfo()).toBe('Евакуація — лише з синьої клітинки висадки.');
    last.pos = pos;
    last.ap = 1;
    yes();
    expect(f.binfo()).toBe('Не вистачає AP: евакуація коштує 2, є 1.');
    last.ap = 2;
    f.deps.autoBusy.mockReturnValue(true);
    yes();
    expect(squad(f).map((u) => u.id)).toEqual([last.id]);
    f.deps.autoBusy.mockReturnValue(false);
    yes();
    expect(squad(f)).toEqual([]);
  });
});

describe('Т.130: смуга загону — клік по картці і клавіша Q', () => {
  const own = (f: Fixture) => f.ui.mission!.state.units.filter((u) => u.side === 'player');
  const q = (f: Fixture) => f.input.onKeyDown({ code: 'KeyQ', key: 'q' } as KeyboardEvent);

  it('картка вибирає бійця так само, як тап по ньому на полі', () => {
    const a = makeFixture();
    const b = makeFixture();
    launchMission(a);
    launchMission(b);
    const s = own(a)[1]!;
    clickAt(a, s.pos.x, s.pos.y);
    b.input.squadCardClick(s.id);
    expect(b.ui.selectedId).toBe(s.id);
    expect(b.binfo()).toBe(a.binfo());
  });

  it('у зведеному гелі картка пораненого союзника — ціль лікування, як тап (перший — прев’ю)', () => {
    const run = (viaCard: boolean): Fixture => {
      const f = makeFixture();
      launchMission(f);
      const [s0, s1] = own(f);
      s1!.hp -= 3;
      f.ui.selectedId = s0!.id;
      f.ui.itemMode = 'medkit';
      if (viaCard) f.input.squadCardClick(s1!.id);
      else clickAt(f, s1!.pos.x, s1!.pos.y);
      return f;
    };
    const tap = run(false);
    const card = run(true);
    expect(card.ui.tapCell).toEqual(tap.ui.tapCell);
    expect(card.ui.itemMode).toBe('medkit');
    expect(card.binfo()).toBe(tap.binfo());
  });

  it('картка загиблого і клік під час авто-бою — нічого', () => {
    const f = makeFixture();
    launchMission(f);
    const s = own(f)[0]!;
    s.alive = false;
    f.input.squadCardClick(s.id);
    expect(f.ui.selectedId).toBeNull();
    const g = makeFixture(true);
    launchMission(g);
    g.input.squadCardClick(own(g)[0]!.id);
    expect(g.ui.selectedId).toBeNull();
  });

  it('Q — наступний живий боєць по колу (загиблого пропускає), у зведеному гелі — вибір, не лікування', () => {
    const f = makeFixture();
    launchMission(f);
    const [s0, s1, s2] = own(f);
    q(f);
    expect(f.ui.selectedId).toBe(s0!.id); // без вибору — перший
    s1!.alive = false;
    q(f);
    expect(f.ui.selectedId).toBe(s2!.id);
    f.ui.itemMode = 'medkit';
    q(f);
    expect(f.ui.selectedId).toBe(s0!.id); // по колу
    expect(f.ui.itemMode).toBeNull();
    expect(f.binfo()).toContain(s0!.name);
  });

  it('утримана Q і Q з Ctrl / Alt / Meta бійця не перемикають (аудит PR #443)', () => {
    const f = makeFixture();
    launchMission(f);
    for (const mod of [{ repeat: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }])
      f.input.onKeyDown({ code: 'KeyQ', key: 'q', ...mod } as unknown as KeyboardEvent);
    expect(f.ui.selectedId).toBeNull();
    q(f);
    expect(f.ui.selectedId).toBe(own(f)[0]!.id);
  });

  it('Q під час авто-бою — нічого', () => {
    const f = makeFixture(true);
    launchMission(f);
    q(f);
    expect(f.ui.selectedId).toBeNull();
  });
});

// Т.131 (ADR-0120): меню на ворогові — відкриття, закриття, кнопки
describe('Т.131: меню на ворогові', () => {
  // демон на видимій вільній клітинці за 2 від бійця (у дальності, лінія чиста — поле біля висадки)
  function setup(autoBusy = false, queue: Anim[] = []): { f: Fixture; s: Unit; a: Unit } {
    const f = makeFixture(autoBusy, queue);
    launchMission(f);
    const st = f.ui.mission!.state;
    const s = st.units.find((u) => u.side === 'player' && u.alive)!;
    const a = st.units.find((u) => u.side === 'alien' && u.alive)!;
    for (const [dx, dy] of [
      [2, 0],
      [0, 2],
      [2, 2],
      [-2, 0],
      [0, -2],
    ]) {
      const p = { x: s.pos.x + dx, y: s.pos.y + dy };
      if (st.units.some((u) => u.alive && u.pos.x === p.x && u.pos.y === p.y)) continue;
      if (st.map.blocked.has(p.x + ',' + p.y)) continue;
      a.pos = p;
      if (f.battle.visibleCells().has(p.x + ',' + p.y) && hasLineOfSight(st, s.pos, p)) break;
    }
    expect(f.battle.visibleCells().has(a.pos.x + ',' + a.pos.y)).toBe(true);
    expect(hasLineOfSight(st, s.pos, a.pos)).toBe(true);
    clickAt(f, s.pos.x, s.pos.y); // вибрати бійця
    return { f, s, a };
  }
  const menu = (): HTMLElement => document.getElementById('benemy')!;

  it('тап по демону відкриває меню (картка видна після кадру), повторний тап — закриває', () => {
    const { f, a } = setup();
    clickAt(f, a.pos.x, a.pos.y);
    expect(f.ui.menuId).toBe(a.id);
    expect(f.binfo()).toContain(a.name + ': HP');
    f.battle.renderBattle();
    expect(menu().classList.contains('hidden')).toBe(false);
    expect(menu().dataset.unit).toBe(a.id);
    expect(menu().querySelectorAll('button')).toHaveLength(4);
    const first = menu().querySelector('button');
    f.battle.renderBattle(); // перемальовка кадру не міняє кнопок (клік не губиться)
    expect(menu().querySelector('button')).toBe(first);
    clickAt(f, a.pos.x, a.pos.y);
    expect(f.ui.menuId).toBeNull();
    f.battle.renderBattle();
    expect(menu().classList.contains('hidden')).toBe(true);
  });

  it('Esc закриває меню, вибір бійця лишається; другий Esc знімає вибір', () => {
    const { f, s, a } = setup();
    clickAt(f, a.pos.x, a.pos.y);
    f.input.onKeyDown(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape' }));
    expect(f.ui.menuId).toBeNull();
    expect(menu().classList.contains('hidden')).toBe(true);
    expect(f.ui.selectedId).toBe(s.id);
    f.input.onKeyDown(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape' }));
    expect(f.ui.selectedId).toBeNull();
  });

  it('клік повз (порожня клітинка) лише закриває меню — без прев’ю ходу', () => {
    const { f, s, a } = setup();
    clickAt(f, a.pos.x, a.pos.y);
    const empty = { x: s.pos.x, y: s.pos.y + 1 };
    clickAt(f, empty.x, empty.y);
    expect(f.ui.menuId).toBeNull();
    expect(f.ui.tapCell).toBeNull();
    expect(f.ui.hoverPath).toBeNull();
  });

  it('вибір іншого бійця, Q, зведення режиму (плитка чи клавіша), кінець ходу і старт авто-бою закривають меню', () => {
    const { f, s, a } = setup();
    const other = f.ui.mission!.state.units.find((u) => u.side === 'player' && u.alive && u.id !== s.id)!;
    const open = (): void => {
      if (f.ui.selectedId !== s.id) clickAt(f, s.pos.x, s.pos.y);
      clickAt(f, a.pos.x, a.pos.y);
      expect(f.ui.menuId).toBe(a.id);
    };
    open();
    clickAt(f, other.pos.x, other.pos.y);
    expect(f.ui.menuId).toBeNull();
    open();
    f.input.squadCardClick(other.id);
    expect(f.ui.menuId).toBeNull();
    open();
    f.input.onKeyDown(new KeyboardEvent('keydown', { key: 'q', code: 'KeyQ' }));
    expect(f.ui.menuId).toBeNull();
    for (const key of ['Digit1', 'Digit2', 'Digit3', 'KeyO', 'KeyG']) {
      open();
      f.input.onKeyDown(new KeyboardEvent('keydown', { key: key.slice(-1), code: key }));
      expect(f.ui.menuId, key).toBeNull();
      f.input.onKeyDown(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape' })); // зняти режим
    }
    open();
    f.input.disarm();
    expect(f.ui.menuId).toBeNull();
    open();
    f.input.endPlayerTurn();
    expect(f.ui.menuId).toBeNull();
  });

  it('зі зведеним режимом тап по демону — тап-тап, як раніше, меню не відкривається', () => {
    const { f, a } = setup();
    f.input.armFire('snap');
    clickAt(f, a.pos.x, a.pos.y);
    expect(f.ui.menuId).toBeNull();
    expect(f.binfo()).toContain('повторний тап у цю саму ціль');
  });

  it('кнопки пострілу стріляють одразу (AP і рядок, як тап-тап), меню закривається', () => {
    for (const mode of ['snap', 'aimed', 'auto'] as const) {
      const { f, s, a } = setup();
      clickAt(f, a.pos.x, a.pos.y);
      const ap = s.ap;
      const cost = s.weapon.modes[mode].apCost;
      f.input.enemyMenuAction(mode);
      expect(s.ap, mode).toBe(ap - cost);
      expect(f.ui.menuId).toBeNull();
      expect(f.ui.mission!.state.log.some((e) => e.type === 'shot' && e.mode === mode)).toBe(true);
      if (f.ui.battleResult === null) expect(f.binfo()).toMatch(/вистріл(ив|ила) \(/);
    }
  });

  it('«Граната» зводить гранату з епіцентром на демоні (зона видна), повторний тап по ньому — кидок', () => {
    const { f, s, a } = setup();
    const items = f.ui.mission!.state.items!;
    items[s.id] = { ...(items[s.id] ?? { medkit: false, grenade: false }), grenade: true };
    clickAt(f, a.pos.x, a.pos.y);
    f.input.enemyMenuAction('grenade');
    expect(f.ui.menuId).toBeNull();
    expect(f.ui.itemMode).toBe('grenade');
    expect(f.ui.tapCell).toEqual(a.pos);
    expect(f.binfo()).toContain('Повторний клік у цю клітинку — кидок');
    const ap = s.ap;
    clickAt(f, a.pos.x, a.pos.y);
    expect(s.ap).toBe(ap - 4);
    expect(items[s.id].grenade).toBe(false);
  });

  it('кнопка не діє в авто-бої, під час анімації і без відкритого меню', () => {
    const { f, s } = setup();
    const ap = s.ap;
    f.input.enemyMenuAction('snap'); // меню не відкрите
    expect(s.ap).toBe(ap);
    const busy = setup(true);
    busy.f.ui.menuId = busy.a.id;
    busy.f.input.enemyMenuAction('snap');
    expect(busy.s.ap).toBe(busy.s.maxAp);
  });

  it('під час анімації меню не видно; тап по демону запам’ятовує його — картка з’являється після анімації', () => {
    const queue: Anim[] = [];
    const { f, s, a } = setup(false, queue);
    queue.push(makeMoveAnim(s, [{ x: s.pos.x, y: s.pos.y }], false));
    clickAt(f, a.pos.x, a.pos.y);
    expect(f.ui.menuId).toBe(a.id);
    f.battle.renderBattle();
    expect(menu().classList.contains('hidden')).toBe(true);
    const ap = f.battle.selectedUnit()!.ap;
    f.input.enemyMenuAction('snap'); // під час анімації — нічого
    expect(f.battle.selectedUnit()!.ap).toBe(ap);
    queue.length = 0;
    f.battle.renderBattle();
    expect(menu().classList.contains('hidden')).toBe(false);
  });

  it('демон зник із видимості чи загинув — картка ховається', () => {
    const { f, a } = setup();
    clickAt(f, a.pos.x, a.pos.y);
    f.battle.renderBattle();
    expect(menu().classList.contains('hidden')).toBe(false);
    const at = { ...a.pos };
    a.pos = { x: 19, y: 19 }; // далекий кут — туман (ADR-0081)
    expect(f.battle.visibleCells().has('19,19')).toBe(false);
    f.battle.renderBattle();
    expect(menu().classList.contains('hidden')).toBe(true);
    expect(f.ui.menuId).toBeNull(); // аудит PR #444: закрито, а не лише сховано
    a.pos = at;
    f.battle.renderBattle();
    expect(menu().classList.contains('hidden')).toBe(true);
    clickAt(f, a.pos.x, a.pos.y);
    f.battle.renderBattle();
    expect(menu().classList.contains('hidden')).toBe(false);
    a.alive = false;
    f.battle.renderBattle();
    expect(menu().classList.contains('hidden')).toBe(true);
  });

  it('аудит PR #444: відкрите меню — наведення не малює шлях і не переписує #binfo', () => {
    const { f, s, a } = setup();
    clickAt(f, a.pos.x, a.pos.y);
    const info = f.binfo();
    f.input.battleCanvasHover({ clientX: s.pos.x * 48 + 24, clientY: (s.pos.y + 1) * 48 + 24 } as MouseEvent);
    expect(f.ui.hoverPath).toBeNull();
    expect(f.binfo()).toBe(info);
  });
});
