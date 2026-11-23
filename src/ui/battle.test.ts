// @vitest-environment jsdom
// пR.2: юніт-тести бойовища і флоу бою (src/ui/battle.ts, ADR-0037).
// validFireTargets перенесено з main.test.ts без ослаблення тверджень;
// тут же — гілки флоу (запуск/закриття/завершення, перевірка результату) на
// детермінованій партії (сід 42). DOM-флоу застосунку — у main.ui.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { advanceTime, missionTargets } from '../core/geo';
import { createGame, makeUnit, moveUnit, type GameState, type Unit } from '../core/combat';
import { createParty, type Party } from '../core/save';
import { initPixelSprites } from '../render';
import { ALIEN_RING, RING_DY, fighterLook, makeDeathAnim, makeMoveAnim, makeTracerAnim } from '../core/render-core';
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
      </div>
      <div id="bsquad"></div>
      <div id="benemy" class="hidden"></div>
      <div id="bresult"></div>
      <canvas id="battle" width="960" height="960"></canvas>
      <div id="binfo">—</div>
      <div id="bturn" class="hidden"></div>
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
    menuId: null, // Т.131
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

  it('Т.130: смуга загону не перемальовується без змін (клік між натисканням і відпусканням не губиться)', () => {
    const f = makeFixture();
    f.battle.launch(firstTarget(f));
    f.battle.renderBattle();
    const first = document.querySelector('#bsquad .sq-card');
    f.battle.renderBattle();
    expect(document.querySelector('#bsquad .sq-card')).toBe(first);
    const s = f.ui.mission!.state.units.find((u) => u.side === 'player')!;
    f.ui.selectedId = s.id;
    f.battle.renderBattle();
    const sel = document.querySelector<HTMLElement>('#bsquad .sq-card.sel')!;
    expect(sel.dataset.unit).toBe(s.id);
    expect(sel).not.toBe(first);
    // аудит PR #443: фокус клавіатури на картці після перемальовки — на ту саму картку
    sel.focus();
    f.ui.selectedId = null;
    f.battle.renderBattle();
    const again = document.querySelector<HTMLElement>('#bsquad .sq-card[data-unit="' + s.id + '"]')!;
    expect(again).not.toBe(sel);
    expect(document.activeElement).toBe(again);
  });

  it('renderBattle: контекст-стрічка бою і кнопки керування (хід гравця)', () => {
    const f = makeFixture();
    f.battle.launch(firstTarget(f));
    f.battle.renderBattle();
    expect(document.getElementById('bctx-kind')!.textContent).toBe(f.ui.mission!.briefing.kind);
    expect(document.getElementById('bctx-turn')!.textContent).toContain('хід 1');
    // Т.130: смуга загону — картка на кожного бійця, без вибору — жодна не вибрана
    expect(document.querySelectorAll('#bsquad .sq-card')).toHaveLength(f.ui.mission!.state.units.filter((u) => u.side === 'player').length);
    expect(document.querySelectorAll('#bsquad .sq-card.sel')).toHaveLength(0);
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

  it('Т.7: журнал втрат і поранених — рід за іменем, «тіків» узгоджено з числом', () => {
    // загін місії — перші боєготові ростеру: Іван, Олена, …; лікарня — 2 тіки на HP
    const run = (dead: string, wounded: string, lostHp: number): string[] => {
      const f = makeFixture();
      f.battle.launch(firstTarget(f));
      const st = f.ui.mission!.state;
      for (const u of st.units) if (u.side === 'alien') u.alive = false;
      const byName = (n: string) => st.units.find((u) => u.name === n)!;
      byName(dead).alive = false;
      byName(wounded).hp = byName(wounded).maxHp - lostHp;
      f.battle.finish('перемога');
      return vi.mocked(f.deps.journal).mock.calls.map((c) => c[0]);
    };
    const a = run('Олена', 'Іван', 4);
    expect(a).toContain('✝ Олена загинула в бою');
    expect(a).toContain('✚ Іван поранений — лікарня: 8 тіків');
    const b = run('Іван', 'Олена', 1);
    expect(b).toContain('✝ Іван загинув у бою');
    expect(b).toContain('✚ Олена поранена — лікарня: 2 тіки');
  });

  it('Т.33: картка результату — хід, демони, премія, поранені й загиблі поіменно', () => {
    const f = makeFixture();
    f.battle.launch(firstTarget(f));
    const st = f.ui.mission!.state;
    const aliens = st.units.filter((u) => u.side === 'alien');
    for (const u of aliens) u.alive = false;
    const byName = (n: string) => st.units.find((u) => u.name === n)!;
    byName('Олена').alive = false;
    byName('Іван').hp = byName('Іван').maxHp - 4;
    f.battle.finish('перемога');
    const text = document.querySelector('#bresult .rcard')!.textContent;
    expect(text).toContain('Ходів' + st.turn);
    expect(text).toContain('Демонів знищено' + aliens.length + ' з ' + aliens.length);
    expect(text).toMatch(/Премія\+\d+ кр\./);
    expect(text).toContain('✚ Іван — лікарня: 8 тіків');
    expect(text).toContain('✝ Олена — загинула');
    const g = makeFixture();
    g.battle.launch(firstTarget(g));
    g.battle.finish('поразка');
    const lostCard = document.querySelector('#bresult .rcard')!.textContent;
    expect(lostCard).toContain('Преміянемає');
    expect(lostCard).toContain('Демонів знищено0 з ' + g.ui.mission!.state.units.filter((u) => u.side === 'alien').length);
  });

  it('Т.33: плашка ходу демонів — поки грають анімації і не менше секунди; далі підсумок до першої дії', () => {
    vi.useFakeTimers();
    let queue: unknown[] = [{}];
    const f = makeFixture({ hasRaf: () => true });
    f.deps.anim.queued = () => queue as never;
    f.battle.launch(firstTarget(f));
    const plate = document.getElementById('bturn')!;
    f.battle.alienTurnDone(f.ui.mission!.state.log.length, 'Ваш хід.');
    f.battle.renderBattle();
    expect(document.getElementById('binfo')!.textContent).toBe('');
    expect(document.getElementById('bctx-turn')!.textContent).toBe('хід демонів Розриву');
    expect(plate.classList.contains('hidden')).toBe(false);
    expect(plate.classList.contains('done')).toBe(false);
    expect(plate.textContent).toBe('ХІД ДЕМОНІВ РОЗРИВУ…Демони діють. Зачекайте.Клік / пробіл / Esc — пропустити');
    expect(f.battle.playerTurnActive()).toBe(false); // хід гравця не починається
    expect((document.getElementById('btn-end') as HTMLButtonElement).disabled).toBe(true);
    f.battle.dismissTurnPlate(); // дія гравця плашку ходу не прибирає
    vi.advanceTimersByTime(1000); // секунда минула, анімації ще в черзі
    expect(f.battle.playerTurnActive()).toBe(false);
    queue = [];
    vi.advanceTimersByTime(100);
    f.battle.renderBattle();
    expect(f.battle.playerTurnActive()).toBe(true);
    expect(plate.classList.contains('done')).toBe(true);
    expect(document.getElementById('binfo')!.textContent).toBe('Ваш хід.');
    expect(document.getElementById('bctx-turn')!.textContent).toMatch(/^хід \d+ · загін$/);
    expect(plate.textContent).toBe('ХІД ДЕМОНІВ РОЗРИВУ — ПІДСУМОКДемони не атакували.Демонів у полі зору: 0');
    f.battle.dismissTurnPlate();
    expect(plate.classList.contains('hidden')).toBe(true);
    f.battle.alienTurnDone(f.ui.mission!.state.log.length, '');
    f.battle.dismissTurnPlate(true);
    expect(f.battle.playerTurnActive()).toBe(true);
    f.battle.alienTurnDone(f.ui.mission!.state.log.length, '');
    f.battle.close();
    vi.advanceTimersByTime(5000);
    f.battle.alienTurnDone(0, ''); // без місії — нічого
    vi.useRealTimers();
  });

  it('Т.117: пропуск плашки «діють» — черга анімацій скидається, одразу підсумок; без плашки і в авто-бої пропуску немає', () => {
    vi.useFakeTimers();
    try {
      const f = makeFixture({ hasRaf: () => true });
      f.deps.anim.queued = () => [{}] as never; // анімації ходу ще грають
      const cancel = vi.fn();
      f.deps.anim.cancel = cancel;
      f.battle.launch(firstTarget(f));
      cancel.mockClear();
      const plate = document.getElementById('bturn')!;
      expect(f.battle.skipAlienTurn()).toBe(false); // плашки немає
      f.battle.alienTurnDone(f.ui.mission!.state.log.length, 'Ваш хід.');
      f.battle.renderBattle();
      expect(plate.querySelector('.bturn-skip')!.textContent).toBe('Клік / пробіл / Esc — пропустити');
      expect(f.battle.skipAlienTurn()).toBe(true);
      f.battle.renderBattle(); // у фікстурі renderAll — заглушка
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0); // таймер плашки знято
      expect(f.battle.playerTurnActive()).toBe(true);
      expect(plate.classList.contains('done')).toBe(true);
      expect(document.getElementById('binfo')!.textContent).toBe('Ваш хід.');
      expect(f.battle.skipAlienTurn()).toBe(false); // підсумок пропуском не прибирається
      expect(plate.classList.contains('done')).toBe(true);
      f.battle.autoAlienTurn(null); // авто-бій: плашка без пропуску
      f.battle.renderBattle();
      expect(plate.textContent).toBe('ХІД ДЕМОНІВ РОЗРИВУ…Демони діють. Зачекайте.');
      expect(f.battle.skipAlienTurn()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('Т.48: закриття бою посеред ходу демонів знімає таймер плашки', () => {
    vi.useFakeTimers();
    try {
      const f = makeFixture({ hasRaf: () => true });
      f.deps.anim.queued = () => [{}] as never; // анімації ходу ще грають
      f.battle.launch(firstTarget(f));
      f.battle.alienTurnDone(f.ui.mission!.state.log.length, 'Ваш хід.');
      expect(vi.getTimerCount()).toBe(1); // плашка чекає анімацій
      f.battle.close();
      expect(vi.getTimerCount()).toBe(0);
      expect(document.getElementById('bturn')!.classList.contains('hidden')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('Т.33: причина під неактивною плиткою — замість підпису; повертається з причиною', () => {
    const f = makeFixture();
    f.battle.launch(firstTarget(f));
    const sel = f.ui.mission!.state.units.find((u) => u.side === 'player')!;
    f.ui.selectedId = sel.id;
    sel.ap = 0;
    f.battle.renderBattle();
    const cap = (id: string): HTMLElement => document.querySelector<HTMLElement>('#' + id + ' .tb-cap')!;
    for (const id of ['btn-snap', 'btn-aimed', 'btn-auto', 'btn-ow']) {
      expect(cap(id).textContent, id).toBe('мало AP');
      expect(cap(id).classList.contains('tb-why')).toBe(true);
    }
    expect(cap('btn-medkit').textContent).toBe('без гелю');
    expect(cap('btn-grenade').textContent).toBe('без гранат');
    f.ui.mission!.state.items = { [sel.id]: { medkit: true, grenade: true } };
    f.battle.renderBattle();
    expect(cap('btn-medkit').textContent).toBe('мало AP');
    sel.ap = sel.maxAp;
    f.battle.renderBattle();
    expect(cap('btn-snap').textContent).toBe('Швидкий');
    expect(cap('btn-snap').classList.contains('tb-why')).toBe(false);
    expect(cap('btn-grenade').textContent).toBe('Граната');
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

  it('renderBattle не чіпає іконки плиток (idle → 0 перерисовок, ADR-0029; Т.123 — іконки svg)', () => {
    const f = makeFixture();
    f.battle.launch(firstTarget(f));
    const icons = (): Element[] => [...document.querySelectorAll('#btoolbar svg.tb-icon')];
    const before = icons();
    const drawn = before.map((i) => i.outerHTML);
    expect(before.length).toBe(9);
    f.battle.renderBattle(); // стан плиток — DOM, іконки не чіпаються
    f.battle.renderBattle();
    const after = icons();
    expect(after.length).toBe(9);
    after.forEach((icon, i) => expect(icon).toBe(before[i])); // ті самі вузли, не перестворені
    expect(after.map((i) => i.outerHTML)).toEqual(drawn);
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

describe('Т.44: зона ходу вибраного оперативника на канві бою', () => {
  // журнал операцій з кольором заливки й обведення: клітинка зони — fillRect(x·48+1, y·48+1, 46, 46)
  const render = (f: Fixture): string[] => {
    const ops: string[] = [];
    const ctx = new Proxy(
      {},
      {
        get:
          (_t, p) =>
          (...args: unknown[]) => {
            ops.push(String(p) + '(' + args.map(String).join(',') + ')');
            return undefined;
          },
        set: (_t, p, v) => {
          ops.push('set:' + String(p) + '=' + String(v));
          return true;
        },
      }
    ) as unknown as CanvasRenderingContext2D;
    const proto = HTMLCanvasElement.prototype as unknown as { getContext: () => CanvasRenderingContext2D };
    const prev = proto.getContext;
    proto.getContext = () => ctx;
    try {
      f.battle.renderBattle();
    } finally {
      proto.getContext = prev;
    }
    return ops;
  };
  // клітинки зони в порядку малювання: заливки кольором зони
  const zone = (ops: string[]): string[] => {
    const out: string[] = [];
    let fill = '';
    for (const o of ops) {
      if (o.startsWith('set:fillStyle=')) fill = o.slice(14);
      const m = /^fillRect\((\d+),(\d+),46,46\)$/.exec(o);
      if (m && fill === 'rgba(127,226,160,0.09)') out.push((Number(m[1]) - 1) / 48 + ',' + (Number(m[2]) - 1) / 48);
    }
    return out;
  };
  const outlined = (ops: string[]): boolean => ops.includes('set:strokeStyle=rgba(127,226,160,0.75)');

  // керований бій: відкрита мапа зі стіною (6,5); оперативник (5,5) з 2 AP, демон далеко
  function setup(ap = 2, alien = { x: 15, y: 15 }, over: Partial<BattleDeps> = {}): { f: Fixture; g: GameState } {
    const f = makeFixture(over);
    f.battle.launch(firstTarget(f));
    const g = createGame({
      map: { width: 20, height: 20, blocked: new Set(['6,5']) },
      units: [
        makeUnit({ id: 's1', side: 'player', name: 'Гарт', pos: { x: 5, y: 5 }, ap, maxAp: ap }), // createGame видає стороні, що ходить, maxAp
        makeUnit({ id: 'a1', side: 'alien', name: 'Морок', pos: alien }),
      ],
    });
    f.ui.mission!.state = g;
    f.ui.selectedId = 's1';
    return { f, g };
  }

  it('після вибору оперативника — зона за його AP і контур; стіна в зону не входить', () => {
    const { f } = setup();
    const ops = render(f);
    // ромб на 2 AP — 12 клітинок, мінус стіна (6,5) і клітинка (7,5) за нею
    expect(zone(ops).sort()).toEqual(['3,5', '4,4', '4,5', '4,6', '5,3', '5,4', '5,6', '5,7', '6,4', '6,6']);
    expect(outlined(ops)).toBe(true);
  });

  it('зони немає: без вибору, у зведеному режимі пострілу, у режимі витратника, під час ходу демонів, після бою, при 0 AP', () => {
    const none = (prep: (f: Fixture, g: GameState) => void, ap = 2): void => {
      const { f, g } = setup(ap);
      prep(f, g);
      const ops = render(f);
      expect(zone(ops)).toEqual([]);
      expect(outlined(ops)).toBe(false);
    };
    none((f) => (f.ui.selectedId = null));
    none((f) => (f.ui.fireMode = 'snap'));
    none((f) => (f.ui.itemMode = 'grenade'));
    none((f) => (f.ui.itemMode = 'medkit'));
    none((_f, g) => (g.activeSide = 'alien'));
    none((f) => (f.ui.battleResult = 'перемога'));
    none(() => {}, 0);
  });

  it('шар зони — після синіх квадратів висадки, до лінії шляху і під юнітами', () => {
    const { f } = setup();
    f.ui.hoverPath = [{ x: 5, y: 4 }];
    f.ui.hoverAp = 1;
    const ops = render(f);
    const fills = ops.map((o, i) => (/^fillRect\(\d+,\d+,46,46\)$/.test(o) ? i : -1)).filter((i) => i >= 0);
    expect(fills).toHaveLength(10);
    const squares = ops.indexOf('set:strokeStyle=rgba(110,168,255,0.5)');
    const outline = ops.indexOf('set:strokeStyle=rgba(127,226,160,0.75)');
    const path = ops.indexOf('set:strokeStyle=rgba(127,226,160,0.95)'); // лінія прев'ю шляху до клітинки (5,4)
    expect(ops.slice(path, path + 8)).toContain('lineTo(264,216)');
    const label = ops.findIndex((o) => o.startsWith('fillText(1 AP,')); // плашка ціни шляху
    const unitHp = ops.findIndex((o) => o.startsWith('fillText(10,')); // плашка HP юніта
    expect(squares).toBeGreaterThan(-1);
    expect(fills[0]).toBeGreaterThan(squares);
    expect(outline).toBeGreaterThan(fills[9]!);
    expect(path).toBeGreaterThan(outline);
    expect(label).toBeGreaterThan(path);
    expect(unitHp).toBeGreaterThan(label);
  });

  it('прев\u2019ю шляху — лінія від оперативника і ціна «N AP» біля цілі; крапок радіусом 3 немає', () => {
    const { f } = setup();
    f.ui.hoverPath = [
      { x: 5, y: 4 },
      { x: 5, y: 3 },
    ];
    f.ui.hoverAp = 2;
    const ops = render(f);
    const at = ops.indexOf('set:strokeStyle=rgba(127,226,160,0.95)');
    expect(at).toBeGreaterThan(-1);
    // від клітинки оперативника (5,5) через (5,4) до (5,3), коло в цілі, ціна над нею
    const line = ops.slice(at).filter((o) => /^(moveTo|lineTo|arc)\(/.test(o));
    expect(line.slice(0, 4)).toEqual([
      'moveTo(264,264)',
      'lineTo(264,216)',
      'lineTo(264,168)',
      'arc(264,168,7,0,' + String(Math.PI * 2) + ')',
    ]);
    expect(ops).toContain('fillText(2 AP,313,169)'); // Т.119: праворуч від цілі (5,3)
    expect(ops.some((o) => /^arc\(\d+,\d+,3,/.test(o))).toBe(false);
    expect(ops).not.toContain('set:strokeStyle=rgba(255,156,156,0.95)');
  });

  it('Т.129 (ADR-0118): кільце кожного бійця — колір за id, а не за місцем у загоні; ворог — пурпур', () => {
    const { f } = setup();
    f.ui.mission!.state = createGame({
      map: { width: 20, height: 20, blocked: new Set() },
      units: [
        makeUnit({ id: 's1', side: 'player', name: 'А', pos: { x: 5, y: 5 } }),
        makeUnit({ id: 's7', side: 'player', name: 'Б', pos: { x: 7, y: 5 } }),
        makeUnit({ id: 's4', side: 'player', name: 'В', pos: { x: 5, y: 7 } }),
        makeUnit({ id: 'a1', side: 'alien', name: 'Морок', pos: { x: 8, y: 7 } }),
      ],
    });
    const ops = render(f);
    const ringColor = (x: number, y: number): string | undefined => {
      const at = ops.findIndex((o) => o.startsWith('ellipse(' + (x * 48 + 24) + ',' + (y * 48 + 24 + RING_DY) + ','));
      if (at < 0) return undefined;
      const set = ops
        .slice(0, at)
        .reverse()
        .find((o) => o.startsWith('set:strokeStyle='));
      return set?.slice('set:strokeStyle='.length);
    };
    expect(ringColor(5, 5)).toBe(fighterLook('s1').color);
    expect(ringColor(7, 5)).toBe(fighterLook('s7').color);
    expect(ringColor(5, 7)).toBe(fighterLook('s4').color);
    expect(ringColor(8, 7)).toBe(ALIEN_RING);
  });

  it('шлях дорожчий за AP оперативника — лінія і ціна червоні; рівно стільки, скільки є, — зелені', () => {
    const { f } = setup();
    f.ui.hoverPath = [
      { x: 5, y: 4 },
      { x: 5, y: 3 },
      { x: 5, y: 2 },
    ];
    f.ui.hoverAp = 5; // проти 2 AP; число на плашці — ціна шляху, а не число клітинок (їх три)
    const red = render(f);
    expect(red).toContain('set:strokeStyle=rgba(255,156,156,0.95)');
    expect(red).not.toContain('set:strokeStyle=rgba(127,226,160,0.95)');
    expect(red.some((o) => o.startsWith('fillText(5 AP,'))).toBe(true);
    f.ui.hoverAp = 2;
    const green = render(f);
    expect(green).toContain('set:strokeStyle=rgba(127,226,160,0.95)');
    expect(green).not.toContain('set:strokeStyle=rgba(255,156,156,0.95)');
  });

  it('«вистачає» рахується від поточного AP, а не від максимального: після витрати AP той самий шлях червоний', () => {
    const { f, g } = setup(3);
    f.ui.hoverPath = [
      { x: 5, y: 4 },
      { x: 5, y: 3 },
    ];
    f.ui.hoverAp = 2;
    expect(render(f)).toContain('set:strokeStyle=rgba(127,226,160,0.95)'); // 2 з 3 AP
    g.units.find((u) => u.id === 's1')!.ap = 1; // maxAp лишився 3
    const ops = render(f);
    expect(ops).toContain('set:strokeStyle=rgba(255,156,156,0.95)');
    expect(ops).not.toContain('set:strokeStyle=rgba(127,226,160,0.95)');
  });

  it('прев\u2019ю шляху немає: без шляху, з порожнім шляхом, без вибору, під час ходу демонів', () => {
    const none = (prep: (f: Fixture, g: GameState) => void): void => {
      const { f, g } = setup();
      f.ui.hoverPath = [{ x: 5, y: 4 }];
      f.ui.hoverAp = 1;
      prep(f, g);
      const ops = render(f);
      expect(ops.some((o) => o.includes(' AP,'))).toBe(false);
      expect(ops).not.toContain('set:strokeStyle=rgba(127,226,160,0.95)');
    };
    none((f) => (f.ui.hoverPath = null));
    none((f) => (f.ui.hoverPath = []));
    none((f) => (f.ui.selectedId = null));
    none((_f, g) => (g.activeSide = 'alien'));
  });

  it('Т.45: прев\u2019ю шляху немає у зведеному режимі пострілу, гранати і гелю; без режиму — є', () => {
    const draw = (prep: (f: Fixture) => void, over: Partial<BattleDeps> = {}): string[] => {
      const { f } = setup(2, { x: 15, y: 15 }, over);
      f.ui.hoverPath = [{ x: 5, y: 4 }];
      f.ui.hoverAp = 1;
      prep(f);
      return render(f);
    };
    const drawn = (ops: string[]): boolean => ops.some((o) => o.includes(' AP,')) || ops.includes('set:strokeStyle=rgba(127,226,160,0.95)');
    expect(drawn(draw(() => undefined))).toBe(true); // контроль: та сама фікстура без режиму малює
    for (const mode of ['snap', 'aimed', 'auto'] as const) expect(drawn(draw((f) => (f.ui.fireMode = mode)))).toBe(false);
    expect(drawn(draw((f) => (f.ui.itemMode = 'grenade')))).toBe(false);
    expect(drawn(draw((f) => (f.ui.itemMode = 'medkit')))).toBe(false);
    // Т.119 (рішення власника, замість Т.45 «в авто-бої прев'ю лишається»): в авто-бої прев'ю немає
    expect(drawn(draw(() => undefined, { autoBusy: () => true }))).toBe(false);
  });

  it('поки грає плашка ходу демонів (хід уже гравця, анімації ще йдуть), зони немає; після неї — є', () => {
    vi.useFakeTimers();
    try {
      const { f, g } = setup(2, { x: 15, y: 15 }, { hasRaf: () => true });
      f.battle.alienTurnDone(g.log.length, '');
      expect(g.activeSide).toBe('player');
      expect(f.battle.playerTurnActive()).toBe(false);
      expect(zone(render(f))).toEqual([]);
      f.battle.dismissTurnPlate(true);
      expect(f.battle.playerTurnActive()).toBe(true);
      expect(zone(render(f))).toHaveLength(10);
    } finally {
      vi.useRealTimers();
    }
  });

  it('Т.119: в авто-бої і поки грає анімація (рух, постріл) — ні зони, ні прев\u2019ю шляху; після анімації — є', () => {
    const draw = (over: Partial<BattleDeps>): string[] => {
      const { f } = setup(2, { x: 15, y: 15 }, over);
      f.ui.hoverPath = [{ x: 5, y: 4 }];
      f.ui.hoverAp = 1;
      return render(f);
    };
    const shown = (ops: string[]): { zone: number; path: boolean } => ({
      zone: zone(ops).length,
      path: ops.some((o) => o.includes(' AP,')) || ops.includes('set:strokeStyle=rgba(127,226,160,0.95)'),
    });
    expect(shown(draw({}))).toEqual({ zone: 10, path: true }); // контроль
    expect(shown(draw({ autoBusy: () => true }))).toEqual({ zone: 0, path: false });
    const move = makeMoveAnim(makeUnit({ id: 's1', side: 'player', pos: { x: 5, y: 5 } }), [{ x: 5, y: 4 }], true);
    move.start = 0;
    const tracer = makeTracerAnim('player', { x: 5, y: 5 }, { x: 15, y: 15 }, false);
    tracer.start = 0;
    for (const a of [move, tracer]) {
      const base = makeFixture().deps.anim;
      expect(shown(draw({ anim: { ...base, active: () => a, queued: () => [a] } }))).toEqual({ zone: 0, path: false });
    }
  });

  it('Т.119: px канви — buffer / CSS-ширина: на зменшеній канві плашка і межа туману товщі', () => {
    const { f } = setup();
    f.ui.hoverPath = [{ x: 5, y: 4 }];
    f.ui.hoverAp = 1;
    const cv = document.getElementById('battle') as HTMLCanvasElement;
    const before = render(f);
    expect(before.some((o) => o === 'set:font=bold 15px monospace')).toBe(true); // jsdom: clientWidth 0 → px 1
    Object.defineProperty(cv, 'clientWidth', { configurable: true, value: cv.width / 2.5 });
    try {
      const ops = render(f);
      expect(ops.some((o) => o === 'set:font=bold 30px monospace')).toBe(true); // 12 CSS px
      // межа туману: 1,4 CSS px × 2,5 = 3,5 px buffer'а (аудит PR #434: px у drawNightTerrain тест не тримав)
      const border = (o: string[]): string | undefined => o[o.indexOf('set:strokeStyle=rgba(125,215,255,0.6)') + 1];
      expect(border(before)).toBe('set:lineWidth=2');
      expect(border(ops)).toBe('set:lineWidth=3.5');
    } finally {
      delete (cv as unknown as { clientWidth?: number }).clientWidth;
    }
  });

  it('після руху зона перерахована від нової клітинки з новим AP', () => {
    const { f, g } = setup();
    moveUnit(g, 's1', [{ x: 5, y: 4 }]);
    expect(zone(render(f)).sort()).toEqual(['4,4', '5,3', '5,5', '6,4']); // 1 AP від (5,4)
  });

  it('видимий демон обрізає зону, демон у тумані — ні (ADR-0081)', () => {
    expect(zone(render(setup(1, { x: 5, y: 4 }).f)).sort()).toEqual(['4,5', '5,6']);
    // демон (7,5) за стіною (6,5) — у тумані; з 4 AP його клітинка в зоні (обхід 5,4 → 6,4 → 7,4 → 7,5)
    const { f, g } = setup(4, { x: 7, y: 5 });
    expect(zone(render(f))).toContain('7,5');
    (g.map.blocked as Set<string>).delete('6,5'); // стіни немає — демона видно, клітинка зайнята
    expect(zone(render(f))).not.toContain('7,5');
  });
});
