// @vitest-environment jsdom
// пR.2: юніт-тести бойовища і флоу бою (src/ui/battle.ts, ADR-0037).
// validFireTargets перенесено з main.test.ts без ослаблення тверджень;
// тут же — гілки флоу (запуск/закриття/завершення, перевірка результату) на
// детермінованій партії (сід 42). DOM-флоу застосунку — у main.ui.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { advanceTime, missionTargets } from '../core/geo';
import { createGame, makeUnit, type GameState, type Unit } from '../core/combat';
import { createParty, type Party } from '../core/save';
import { initPixelSprites } from '../render';
import { createBattleUI, validFireTargets, type BattleDeps, type BattleUIState } from './battle';

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
  // Мінімальна розмітка index.html: фокусна зона бою і панель керування.
  document.body.innerHTML = `
    <section id="battle-panel">
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
      </div>
    </section>`;
  const proto = HTMLCanvasElement.prototype as unknown as { getContext: () => CanvasRenderingContext2D };
  proto.getContext = () => noopCtx;
}

interface Fixture {
  party: Party;
  ui: BattleUIState;
  deps: BattleDeps;
  battle: ReturnType<typeof createBattleUI>;
}

function makeFixture(over: Partial<BattleDeps> = {}): Fixture {
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
  const deps: BattleDeps = {
    getParty: () => party,
    journal: vi.fn(),
    drainBattle: vi.fn(),
    resetBattleLog: vi.fn(),
    renderAll: vi.fn(),
    anim: {
      active: () => null,
      now: 0,
      push: vi.fn(),
      cancel: vi.fn(),
    },
    hasRaf: () => false, // node-середовище: анімації не ставляться в чергу
    stopDemo: vi.fn(),
    cancelGeoAnim: vi.fn(),
    ...over,
  };
  return { party, ui, deps, battle: createBattleUI(ui, deps) };
}

// Детерміновано (сід 42): тікати до першої цілі місії (приземлений НЛО).
function firstTarget(f: Fixture): string {
  for (let i = 0; i < 3000 && missionTargets(f.party.geo).length === 0; i++) advanceTime(f.party.geo, 1);
  const t = missionTargets(f.party.geo)[0];
  expect(t).toBeDefined();
  return t.id;
}

beforeEach(() => {
  setupDom();
  initPixelSprites((w, h) => ({
    width: w,
    height: h,
    getContext: () => noopCtx,
  }));
});

describe('validFireTargets: валідні цілі зведеного режиму пострілу (П6.14)', () => {
  // Чиста мапа 20×20 з однією стіною на лінії (5,5)→(9,5); стрілець «p» у (5,5).
  const shooter = makeUnit({ id: 'p', side: 'player', pos: { x: 5, y: 5 } });
  const mk = (id: string, x: number, y: number, alive = true): Unit => makeUnit({ id, side: 'alien', pos: { x, y }, alive });
  const state = (units: Unit[]): GameState =>
    createGame({
      map: { width: 20, height: 20, blocked: new Set(['7,5']) },
      units: [shooter, ...units],
    });
  const vis = (keys: string[]): ReadonlySet<string> => new Set(keys);

  it('видимий прибулець у дальності з лінією вогню — валідна ціль', () => {
    const diag = mk('a1', 6, 6); // дистанція 1, Брезенхем (5,5)→(6,6) стіни (7,5) не перетинає
    const st = state([diag]);
    expect(validFireTargets(st, shooter, vis(['6,6']))).toEqual([diag]);
  });

  it('туман: невидима ціль не підсвічується (ADR-0006)', () => {
    const a = mk('a1', 6, 6);
    expect(validFireTargets(state([a]), shooter, vis([]))).toEqual([]);
  });

  it('поза дальністю зброї (12) — не валідна', () => {
    const far = mk('a1', 18, 5); // дистанція 13 > 12
    expect(validFireTargets(state([far]), shooter, vis(['18,5']))).toEqual([]);
  });

  it('немає лінії вогню (стіна на прямій) — не валідна', () => {
    const behind = mk('a1', 9, 5); // стіна (7,5) на прямій (5,5)→(9,5)
    expect(validFireTargets(state([behind]), shooter, vis(['9,5']))).toEqual([]);
  });

  it('мертвий прибулець і свій юніт — не цілі', () => {
    const dead = mk('a1', 6, 6, false);
    const st = state([dead]);
    expect(validFireTargets(st, shooter, vis(['6,6']))).toEqual([]);
    expect(validFireTargets(st, shooter, vis(['5,5']))).toEqual([]); // стрілець — не ціль
  });
});

describe('battle: флоу місії (запуск/закриття/завершення)', () => {
  it('binfo — текст підказки у #binfo', () => {
    const f = makeFixture();
    f.battle.binfo('тест');
    expect(document.getElementById('binfo')!.textContent).toBe('тест');
  });

  it('checkOutcome без місії — true (бій скінчився); playerTurnActive — false', () => {
    const f = makeFixture();
    expect(f.battle.checkOutcome()).toBe(true);
    expect(f.battle.playerTurnActive()).toBe(false);
    expect(f.battle.selectedUnit()).toBeUndefined();
    expect(f.battle.visibleCells().size).toBe(0);
  });

  it('запуск місії: стан скинуто, журнал і підказка, renderAll; повторний launch — no-op', () => {
    const f = makeFixture();
    const ufoId = firstTarget(f);
    f.ui.selectedId = 'x'; // брудний стан попереднього бою — має скидатись
    f.battle.launch(ufoId);
    expect(f.ui.mission).not.toBeNull();
    expect(f.ui.selectedId).toBeNull();
    expect(f.deps.resetBattleLog).toHaveBeenCalled();
    expect(f.deps.journal).toHaveBeenCalledWith('▶ Місія: загін висаджено біля НЛО ' + ufoId, '', 'battle');
    expect(document.getElementById('binfo')!.textContent).toContain('Ваш хід');
    expect(f.deps.renderAll).toHaveBeenCalled();
    const first = f.ui.mission;
    f.battle.launch(ufoId); // бій уже триває — ігнор
    expect(f.ui.mission).toBe(first);
  });

  it('запуск з неіснуючим НЛО — помилка ядра в журнал, місії нема', () => {
    const f = makeFixture();
    f.battle.launch('нло-нема');
    expect(f.ui.mission).toBeNull();
    expect(f.deps.journal).toHaveBeenCalledWith(expect.stringContaining('✗'), 'lose');
  });

  it('renderBattle: контекст-стрічка бою і кнопки керування (хід гравця)', () => {
    const f = makeFixture();
    f.battle.launch(firstTarget(f));
    f.battle.renderBattle();
    expect(document.getElementById('bctx-kind')!.textContent).toBe(f.ui.mission!.briefing.kind);
    expect(document.getElementById('bctx-turn')!.textContent).toContain('хід 1');
    expect(document.getElementById('bctx-unit')!.textContent).toBe('не вибраний');
    expect((document.getElementById('btn-end') as HTMLButtonElement).disabled).toBe(false);
    expect((document.getElementById('btn-demo') as HTMLButtonElement).disabled).toBe(false);
    expect(f.deps.drainBattle).toHaveBeenCalled();
  });

  it('закриття бою: стан скинуто, демо і анімації зупинено, bresult очищено', () => {
    const f = makeFixture();
    f.battle.launch(firstTarget(f));
    f.battle.close();
    expect(f.ui.mission).toBeNull();
    expect(f.ui.battleResult).toBeNull();
    expect(f.deps.stopDemo).toHaveBeenCalled();
    expect(f.deps.anim.cancel).toHaveBeenCalled();
    expect(f.deps.resetBattleLog).toHaveBeenCalled();
    expect(document.getElementById('bresult')!.innerHTML).toBe('');
  });

  it('перемога: банер, журнал втрат/поранених, премія, кнопка повернення закриває', () => {
    const f = makeFixture();
    const ufoId = firstTarget(f);
    f.battle.launch(ufoId);
    const st = f.ui.mission!.state;
    for (const u of st.units) if (u.side === 'alien') u.alive = false; // зачищено
    const moneyBefore = f.party.econ.money;
    f.battle.finish('перемога');
    expect(f.ui.battleResult).toBe('перемога');
    expect(document.getElementById('bresult')!.innerHTML).toContain('ЗАЧИЩЕНО');
    expect(f.party.econ.money).toBeGreaterThan(moneyBefore); // премія (ADR-0021)
    expect(f.deps.renderAll).toHaveBeenCalled();
    (document.getElementById('btn-close') as HTMLButtonElement).click();
    expect(f.ui.mission).toBeNull(); // кнопка повернення закрила бій
  });

  it('поразка: банер «загін втрачено», НЛО лишається активним', () => {
    const f = makeFixture();
    f.battle.launch(firstTarget(f));
    f.battle.finish('поразка');
    expect(f.ui.battleResult).toBe('поразка');
    expect(document.getElementById('bresult')!.innerHTML).toContain('ЗАГІН ВТРАЧЕНО');
  });

  it('checkOutcome: усі прибульці мертві → перемога і фініш (одним викликом)', () => {
    const f = makeFixture();
    f.battle.launch(firstTarget(f));
    const st = f.ui.mission!.state;
    for (const u of st.units) if (u.side === 'alien') u.alive = false;
    expect(f.battle.checkOutcome()).toBe(true);
    expect(f.ui.battleResult).toBe('перемога');
  });
});
