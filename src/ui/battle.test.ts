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
import { makeDeathAnim, makeTracerAnim } from '../core/render-core';
import { createBattleUI, validFireTargets, validHealTargets, type BattleDeps, type BattleUIState } from './battle';
import { createToolbar } from './toolbar';

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
      <canvas id="battle" width="960" height="960"></canvas>
      <div id="binfo">—</div>
      <!-- П13.2 (ADR-0066): плитки дій генерує createToolbar (як в застосунку) -->
      <div id="btoolbar"></div>
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
    itemMode: null, // П11.6
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
      queued: () => [], // П14.4: черга порожня — невідтворених ходів демонів нема
    },
    hasRaf: () => false, // node-середовище: анімації не ставляться в чергу
    stopAuto: vi.fn(),
    autoBusy: () => false, // П13.3: авто-бій не триває
    cancelGeoAnim: vi.fn(),
    ambient: { paintBattle: vi.fn() }, // П14.8: ambient no-op (гейти в модулі)
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
  // П13.2 (ADR-0066): плитки дій — з тулбара (як в застосунку; у бойових
  // тестах кліки не потрібні — лише стани/тултіпи).
  createToolbar(document.getElementById('btoolbar')!, { onAction: () => {} });
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
    expect(f.deps.journal).toHaveBeenCalledWith('▶ Місія: загін висаджено біля зонду Розриву ' + ufoId, '', 'battle');
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
    expect((document.getElementById('btn-auto-battle') as HTMLButtonElement).disabled).toBe(false);
    expect(f.deps.drainBattle).toHaveBeenCalled();
  });

  it('П13.3 (ADR-0067): плитка авто-бою — «Стоп» і підсвітка під час драйвера, «Авто» після зупинки', () => {
    const busy = vi.fn(() => true);
    const f = makeFixture({ autoBusy: busy });
    f.battle.launch(firstTarget(f));
    f.battle.renderBattle();
    const ab = document.getElementById('btn-auto-battle') as HTMLButtonElement;
    expect(ab.disabled).toBe(false); // «Стоп» доступний будь-коли без результату
    expect((ab.querySelector('.tb-cap') as HTMLElement).textContent).toBe('Стоп');
    expect(ab.classList.contains('armed')).toBe(true);
    busy.mockReturnValue(false); // «Стоп» натиснуто — драйвер зупинився
    f.battle.renderBattle();
    expect((ab.querySelector('.tb-cap') as HTMLElement).textContent).toBe('Авто');
    expect(ab.classList.contains('armed')).toBe(false);
  });

  it('закриття бою: стан скинуто, авто-бій і анімації зупинено, bresult очищено', () => {
    const f = makeFixture();
    f.battle.launch(firstTarget(f));
    f.battle.close();
    expect(f.ui.mission).toBeNull();
    expect(f.ui.battleResult).toBeNull();
    expect(f.deps.stopAuto).toHaveBeenCalled();
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

  it('П15.2 (ADR-0075): «евакуйовано» — банер, без премії, НЛО лишається активним', () => {
    const f = makeFixture();
    const ufoId = firstTarget(f);
    f.battle.launch(ufoId);
    const moneyBefore = f.party.econ.money;
    f.battle.finish('евакуйовано');
    expect(f.ui.battleResult).toBe('евакуйовано');
    expect(document.getElementById('bresult')!.innerHTML).toContain('ЕВАКУЙОВАНО');
    expect(f.party.econ.money).toBe(moneyBefore); // премія не нараховується (creditMissionBonus не викликається)
    expect(f.party.geo.ufos.some((u) => u.id === ufoId)).toBe(true); // НЛО лишається приземленим
    expect(f.party.geo.log.some((e) => e.type === 'mission_evacuated' && e.ufoId === ufoId)).toBe(true);
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

// П11.6 (Фаза 11, ADR-0058): валідні цілі аптечки і стан кнопок витратників.
describe('validHealTargets: цілі аптечки (П11.6, ADR-0058)', () => {
  const healer = makeUnit({ id: 'med', side: 'player', pos: { x: 5, y: 5 } });
  const mk = (id: string, x: number, y: number, hp = 10, alive = true): Unit => makeUnit({ id, side: 'player', pos: { x, y }, hp, alive });
  const state = (units: Unit[]): GameState => createGame({ map: { width: 20, height: 20, blocked: new Set() }, units: [healer, ...units] });

  it('поранений сусід поруч — валідна ціль; здоровий/далеко/мертвий/прибулець — ні', () => {
    const mate = mk('w1', 6, 5, 7); // поранений сусід
    const st = state([mate, mk('w2', 6, 6, 10), mk('w3', 10, 10, 3), mk('w4', 5, 6, 0, false)]);
    expect(validHealTargets(st, healer)).toEqual([mate]);
    healer.hp = 4; // лікар поранений — собі теж ціль (відстань 0)
    expect(validHealTargets(st, healer).map((t) => t.id)).toEqual(['med', 'w1']);
    healer.hp = 10;
    const alien = makeUnit({ id: 'a1', side: 'alien', pos: { x: 5, y: 6 }, hp: 5 });
    expect(validHealTargets(state([alien]), healer)).toEqual([]);
  });
});

describe('renderBattle: кнопки витратників (П11.6, ADR-0058)', () => {
  it('без вибору — вимкнені з причиною; з предметом — активні, armed у зведеному режимі', () => {
    const f = makeFixture();
    f.battle.launch(firstTarget(f));
    f.battle.renderBattle();
    const med = document.getElementById('btn-medkit') as HTMLButtonElement;
    const gren = document.getElementById('btn-grenade') as HTMLButtonElement;
    expect(med.disabled).toBe(true);
    expect(gren.disabled).toBe(true);
    expect(med.title).toContain('гелю немає');
    expect(gren.title).toContain('гранати немає');
    const s = f.ui.mission!.state.units.find((u) => u.side === 'player')!;
    f.ui.selectedId = s.id;
    f.ui.mission!.state.items = { [s.id]: { medkit: true, grenade: true } };
    f.battle.renderBattle();
    expect(med.disabled).toBe(false);
    expect(gren.disabled).toBe(false);
    f.ui.itemMode = 'medkit';
    f.battle.renderBattle();
    expect(med.classList.contains('armed')).toBe(true);
    expect(gren.classList.contains('armed')).toBe(false);
  });
});

// П13.2 (ADR-0066): тулбар бойових дій — критерії кроку: причини блокування
// дій на плитках (П6.14) та іконки без повторного малювання (idle → 0 перерисовок).
describe('тулбар: причини блокування дій (П13.2, критерій 1)', () => {
  it('без AP — постріл з причиною; хід прибульців — приглушено; зведення — .armed (без вибору — див. тест витратників вище)', () => {
    const f = makeFixture();
    f.battle.launch(firstTarget(f));
    const s = f.ui.mission!.state.units.find((u) => u.side === 'player')!;
    f.ui.selectedId = s.id;
    s.ap = 0;
    f.battle.renderBattle();
    const snap = document.getElementById('btn-snap') as HTMLButtonElement;
    expect(snap.disabled).toBe(true); // AP не вистачає
    expect(snap.title).toContain('не вистачає AP (потрібно ' + s.weapon.modes.snap.apCost + ')');
    s.ap = s.maxAp;
    f.ui.fireMode = 'snap';
    f.battle.renderBattle();
    expect(snap.classList.contains('armed')).toBe(true); // зведений режим — плитка .armed
    f.ui.mission!.state.activeSide = 'alien';
    f.battle.renderBattle();
    expect((document.getElementById('btn-end') as HTMLButtonElement).disabled).toBe(true); // хід прибульців
    expect(snap.disabled).toBe(true);
  });

  it('renderBattle не перемальовує іконки плиток (idle → 0 перерисовок, ADR-0029)', () => {
    let iconCtxCalls = 0;
    for (const icon of [...document.querySelectorAll<HTMLCanvasElement>('#btoolbar canvas')]) {
      const orig = icon.getContext.bind(icon);
      icon.getContext = ((type: string) => {
        iconCtxCalls++;
        return orig(type as '2d');
      }) as HTMLCanvasElement['getContext'];
    }
    const f = makeFixture();
    f.battle.launch(firstTarget(f));
    f.battle.renderBattle(); // стан плиток — DOM, іконки не чіпаються
    f.battle.renderBattle();
    expect(iconCtxCalls).toBe(0);
  });
});

describe('Фікс П14.8 (фідбек валідації): смерть у черзі ще не відтворена', () => {
  // «старий баг» блимання: ядро застосовує смерть миттєво (alive=false), а
  // кадр згасання відтворюється лише після трасера — загиблий має лишатися
  // на полі до свого кадру (поза «зник → з'явився → зник»).
  const recCtx = (ops: string[]): CanvasRenderingContext2D =>
    new Proxy(
      {},
      {
        get:
          (_t, p) =>
          (...args: unknown[]) => {
            ops.push(String(p) + '(' + args.map(String).join(',') + ')');
            return undefined;
          },
        set: (_t, p) => {
          ops.push('set:' + String(p));
          return true;
        },
      }
    ) as unknown as CanvasRenderingContext2D;

  const withRecCtx = (render: () => void): string[] => {
    const ops: string[] = [];
    const proto = HTMLCanvasElement.prototype as unknown as { getContext: () => CanvasRenderingContext2D };
    const prev = proto.getContext;
    proto.getContext = () => recCtx(ops);
    try {
      render();
    } finally {
      proto.getContext = prev;
    }
    return ops;
  };

  it('загиблий з невідтвореною смертю в черзі малюється статично; без смерті в черзі — ні', () => {
    const f = makeFixture();
    f.battle.launch(firstTarget(f));
    // керований бій: сусіди, смерть застосована, черга — активний трасер + смерть
    const g = createGame({
      map: { width: 20, height: 20, blocked: new Set<string>() },
      units: [
        makeUnit({ id: 's1', side: 'player', name: 'Гарт', pos: { x: 2, y: 2 }, hp: 10, maxHp: 10 }),
        makeUnit({ id: 'a1', side: 'alien', name: 'Морок', pos: { x: 3, y: 2 }, hp: 10, maxHp: 10 }),
      ],
    });
    const victim = g.units[1]!;
    victim.alive = false; // стан ядра фінальний
    f.ui.mission!.state = g;
    const tracer = makeTracerAnim('player', { x: 2, y: 2 }, { x: 3, y: 2 }, true);
    const death = makeDeathAnim(victim);
    f.deps.anim.active = () => tracer;
    f.deps.anim.queued = () => [tracer, death];
    const ops = withRecCtx(() => f.battle.renderBattle());
    // силует загиблого на полі: його плашка HP малює число 0 (живий солдат — «10»)
    expect(ops.some((o) => o.startsWith('fillText(0,'))).toBe(true);
    expect(ops.some((o) => o.startsWith('fillText(10,'))).toBe(true);
    // смерті в черзі нема (кадр відтворено/скасовано) — загиблий зникає одразу
    f.deps.anim.queued = () => [tracer];
    const ops2 = withRecCtx(() => f.battle.renderBattle());
    expect(ops2.some((o) => o.startsWith('fillText(0,'))).toBe(false);
  });

  // Фідбек власника 2026-10-22: трасер бою стартує з ДУЛА стрільця (якір
  // MUZZLE_ANCHOR у render.ts), фліп — фактичний facing кадру: демон у нативі
  // (вліво) — дуло лівого краю (+2 від осі); постріл по солдату праворуч від
  // демона — дзеркальний якір. renderBattle передає підказку в drawAnimFrame.
  it('трасер демона: старт з дула (натив вліво), постріл вправо — дзеркальний якір', () => {
    const f = makeFixture();
    f.battle.launch(firstTarget(f));
    const g = createGame({
      map: { width: 20, height: 20, blocked: new Set<string>() },
      units: [
        makeUnit({ id: 's1', side: 'player', name: 'Гарт', pos: { x: 3, y: 5 }, hp: 10, maxHp: 10 }),
        makeUnit({ id: 'a1', side: 'alien', name: 'Морок', pos: { x: 5, y: 5 }, hp: 10, maxHp: 10 }),
      ],
    });
    f.ui.mission!.state = g;
    // натив: демон (5,5) стріляє вліво по солдату (3,5) — facing −1, без дзеркала
    const left = makeTracerAnim('alien', { x: 5, y: 5 }, { x: 3, y: 5 }, false);
    left.start = 0;
    f.deps.anim.active = () => left;
    f.deps.anim.queued = () => [left];
    const ops = withRecCtx(() => f.battle.renderBattle());
    // дуло: round(264−22)+5 = 247, round(264−22)+24 = 266 (центр був би 264,264)
    expect(ops).toContain('moveTo(247,266)');
    // дзеркало: той самий демон стріляє вправо (5,5)→(7,5) — facing +1, дзеркало
    const right = makeTracerAnim('alien', { x: 5, y: 5 }, { x: 7, y: 5 }, false);
    right.start = 0;
    f.deps.anim.active = () => right;
    f.deps.anim.queued = () => [right];
    const ops2 = withRecCtx(() => f.battle.renderBattle());
    // віддзеркалене дуло: round(264−22)+(44−1−5) = 280
    expect(ops2).toContain('moveTo(280,266)');
  });
});
