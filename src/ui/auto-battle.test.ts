// П13.3 (ADR-0067): юніт-тести драйвера авто-бою (src/ui/auto-battle.ts) —
// міграція demo.test.ts (пR.2, П6.16) з переробкою на РЕАЛЬНЕ ядро: замість
// стабів DemoSteps/animsFromEvents/missionOutcome — справжні модулі на
// мінімальних GameState (createGame/makeUnit, фіксований сід mulberry32,
// ADR-0003). Еквівалентність DemoSteps ↔ autoBattle байт-у-байт покрита в
// bot.test.ts (П6.16); DOM-флоу кнопки «Авто»/«Стоп» — у main.ui.test.ts.
// Тут — паузи, onIdle-зв'язування, перемикач, зупинка, гейти запуску і
// критерій 2 П13.3: події логу тих самих типів, що при ручних діях;
// детермінованість (стоп/старт не міняє траєкторію, порядок викликів rng);
// політика без власного RNG (Math.random не викликається).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  endTurn,
  createGame,
  makeUnit,
  mulberry32,
  moveUnit,
  resolveAttack,
  setOverwatch,
  throwGrenade,
  useMedkit,
  type GameState,
} from '../core/combat';
import { missionOutcome, type Mission } from '../core/mission';
import { AutoBattleDriver, type AutoBattleDeps } from './auto-battle';

// Мінімальна «місія»: драйвер лише читає state (log/units) і передає його
// у DemoSteps; missionOutcome/animsFromEvents працюють зі справжнім станом.
function fakeMission(state: GameState): Mission {
  return { state } as unknown as Mission;
}

function makeDeps(mission: Mission | null, over: Partial<AutoBattleDeps> = {}): AutoBattleDeps {
  return {
    getMission: vi.fn(() => mission),
    battleFinished: vi.fn(() => false),
    renderBattle: vi.fn(),
    renderAll: vi.fn(),
    binfo: vi.fn(),
    finishBattle: vi.fn(),
    pushAnims: vi.fn(),
    hasRaf: false,
    ...over,
  };
}

// Порожня мапа 20×20: оперативник у протилежному кутку від демона Розриву —
// той за межами зору (VISION_RANGE 12), політика рухає загін до зони НЛО.
const emptyMap = { width: 20, height: 20, blocked: new Set<string>() };

function ongoingMission(rng = mulberry32(42)): Mission {
  return fakeMission(
    createGame({
      map: emptyMap,
      rng,
      units: [makeUnit({ id: 'p1', side: 'player', pos: { x: 2, y: 17 } }), makeUnit({ id: 'a1', side: 'alien', pos: { x: 2, y: 2 } })],
    })
  );
}

// Бій «один на один» в зоні видимості: швидке завершення (hp 1 у демона —
// перше влучання вирішує), обидві сторони встигають діяти.
function duelMission(rng = mulberry32(42)): Mission {
  return fakeMission(
    createGame({
      map: emptyMap,
      rng,
      units: [
        makeUnit({ id: 'p1', side: 'player', pos: { x: 5, y: 5 }, firingAccuracy: 0.95 }),
        makeUnit({ id: 'a1', side: 'alien', pos: { x: 6, y: 6 }, hp: 1, maxHp: 10 }),
      ],
    })
  );
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// Прогнати авто-бій до зупинки драйвера (результат або ліміт): пауза 160 мс,
// ліміт ітерацій — страховка від зависання.
async function driveToEnd(d: AutoBattleDriver): Promise<void> {
  for (let i = 0; i < 3000 && d.busy; i++) {
    await vi.advanceTimersByTimeAsync(160);
  }
}

describe('AutoBattleDriver: гейти запуску', () => {
  it('без місії start — no-op', () => {
    const deps = makeDeps(null);
    const d = new AutoBattleDriver(deps);
    d.start();
    expect(d.busy).toBe(false);
    expect(deps.binfo).not.toHaveBeenCalled();
    expect(deps.renderBattle).not.toHaveBeenCalled();
  });

  it('бойовий результат зафіксовано — start не запускається', () => {
    const deps = makeDeps(ongoingMission(), { battleFinished: () => true });
    const d = new AutoBattleDriver(deps);
    d.start();
    expect(d.busy).toBe(false);
    expect(deps.binfo).not.toHaveBeenCalled();
  });

  it('повторний start під час авто-бою — no-op', () => {
    const mission = ongoingMission();
    const d = new AutoBattleDriver(makeDeps(mission));
    d.start();
    const afterFirst = mission.state.log.length; // перша дія виконана
    expect(afterFirst).toBeGreaterThan(0);
    d.start(); // авто-бій уже триває
    expect(mission.state.log.length).toBe(afterFirst);
  });
});

describe('AutoBattleDriver: перемикач «Авто»/«Стоп» (критерій 1, механіка)', () => {
  it('toggle: запуск → дія виконана; повторний toggle — стоп, таймер не крокує', () => {
    const mission = ongoingMission();
    const d = new AutoBattleDriver(makeDeps(mission));
    d.toggle();
    expect(d.busy).toBe(true);
    const len = mission.state.log.length;
    expect(len).toBeGreaterThan(0); // перша дія — одразу (крок у start)
    d.toggle(); // «Стоп»
    expect(d.busy).toBe(false);
    vi.advanceTimersByTime(10_000);
    expect(mission.state.log.length).toBe(len); // далі — лише вручну
  });

  it('«Авто» знову з будь-якого моменту — продовжує з досягнутого стану', () => {
    const mission = ongoingMission();
    const d = new AutoBattleDriver(makeDeps(mission));
    d.start();
    vi.advanceTimersByTime(160 * 3); // кілька дій
    const midLen = mission.state.log.length;
    expect(midLen).toBeGreaterThan(1);
    d.stop();
    d.start(); // знову «Авто»
    expect(d.busy).toBe(true);
    vi.advanceTimersByTime(160 * 3);
    expect(mission.state.log.length).toBeGreaterThan(midLen); // бій продовжився
  });
});

describe('AutoBattleDriver: покроковий цикл', () => {
  it('дії крокують паузами таймера; перемога веде у finishBattle', async () => {
    const mission = duelMission();
    const deps = makeDeps(mission);
    const d = new AutoBattleDriver(deps);
    d.start();
    expect(mission.state.log.length).toBeGreaterThan(0); // перша дія — не миттєвий прогін
    expect(deps.renderBattle).toHaveBeenCalled(); // стрічка/тулбар актуальні після кожної дії
    await driveToEnd(d);
    expect(deps.finishBattle).toHaveBeenCalledWith('перемога'); // hp 1 у демона — перше влучання вирішує
    expect(d.busy).toBe(false); // авто-бій зупинено
  });

  it('поразка — finishBattle тим самим шляхом, що й ручний бій', async () => {
    // поранений загін проти живучого демона поруч: загін не пробиває HP,
    // демон вбиває оперативника за свій півхід
    const mission = fakeMission(
      createGame({
        map: emptyMap,
        rng: mulberry32(42),
        units: [
          makeUnit({ id: 'p1', side: 'player', pos: { x: 5, y: 5 }, hp: 1, maxHp: 1 }),
          makeUnit({ id: 'a1', side: 'alien', pos: { x: 6, y: 6 }, hp: 100, firingAccuracy: 0.95 }),
        ],
      })
    );
    const deps = makeDeps(mission);
    const d = new AutoBattleDriver(deps);
    d.start();
    await driveToEnd(d);
    expect(deps.finishBattle).toHaveBeenCalledWith('поразка');
  });

  it('анімації дії — pushAnims і пауза після onIdle', async () => {
    // перша дія — хода (демон за межами зору): move-анімація ставиться в чергу;
    // до onIdle пауза не тікає — далі після відтворення черги.
    const mission = ongoingMission();
    const deps = makeDeps(mission, { hasRaf: true });
    const d = new AutoBattleDriver(deps);
    d.start();
    expect(deps.pushAnims).toHaveBeenCalledTimes(1);
    const len = mission.state.log.length;
    vi.advanceTimersByTime(10_000); // черга ще відтворюється — пауза не почалась
    expect(mission.state.log.length).toBe(len);
    d.onAnimIdle(); // AnimEngine відтворив чергу — пауза і наступна дія
    await vi.advanceTimersByTimeAsync(160);
    expect(mission.state.log.length).toBeGreaterThan(len);
  });

  it('onIdle без активної дії — no-op (не крокує поза таймером)', () => {
    const mission = ongoingMission();
    const d = new AutoBattleDriver(makeDeps(mission));
    d.onAnimIdle();
    expect(mission.state.log.length).toBe(0);
  });

  it('бій не завершився за ліміт — binfo + renderAll, без finishBattle', () => {
    const deps = makeDeps(ongoingMission(), { maxHalfTurns: 0 });
    const d = new AutoBattleDriver(deps);
    d.start();
    expect(deps.binfo).toHaveBeenCalledWith('Авто-бій: бій не завершився за ліміт півходів.');
    expect(deps.renderAll).toHaveBeenCalledTimes(1);
    expect(deps.finishBattle).not.toHaveBeenCalled();
    expect(d.busy).toBe(false);
  });

  it('hasRaf=false (тести) — анімації не збираються, крокує лише таймером', () => {
    const mission = ongoingMission();
    const deps = makeDeps(mission, { hasRaf: false });
    const d = new AutoBattleDriver(deps);
    d.start();
    expect(deps.pushAnims).not.toHaveBeenCalled();
    vi.advanceTimersByTime(160);
    expect(mission.state.log.length).toBeGreaterThan(1); // друга дія — лише паузою таймера
  });

  it('next без місії — no-op (місія закрилась під час паузи)', () => {
    const mission = ongoingMission();
    // перші два виклики — start і перший next; далі (після паузи) місії вже нема
    const getMission = vi.fn().mockReturnValueOnce(mission).mockReturnValueOnce(mission).mockReturnValue(null);
    const deps = makeDeps(null, { getMission: () => getMission() });
    const d = new AutoBattleDriver(deps);
    d.start();
    const afterFirst = mission.state.log.length; // перша дія відбулась (хода — багато подій)
    expect(afterFirst).toBeGreaterThan(0);
    vi.advanceTimersByTime(160); // пауза → next: місії вже нема — no-op
    expect(mission.state.log.length).toBe(afterFirst);
  });
});

describe('критерій 2 П13.3: події логу і детермінованість (реальне ядро)', () => {
  // Базові стани-близнюки: один бій двома способами (безперервно і з
  // «Стоп»/«Авто» посеред) + ручні дії для переліку типів подій.
  function contactMission(rng = mulberry32(7)): Mission {
    return fakeMission(
      createGame({
        map: emptyMap,
        rng,
        items: { p1: { medkit: true, grenade: true } },
        units: [
          makeUnit({ id: 'p1', side: 'player', pos: { x: 5, y: 5 }, firingAccuracy: 0.95 }),
          makeUnit({ id: 'a1', side: 'alien', pos: { x: 6, y: 6 }, hp: 1, maxHp: 10 }),
        ],
      })
    );
  }

  it('події авто-бою — тих самих типів, що ручні дії бою', async () => {
    // Ручний бій: усі чинні дії гравця — постріл, кидок гранати, хід, дозор,
    // лікування, кінець ходу (перелік main.ts/input.ts); смерть — від пострілу.
    const manual = createGame({
      map: emptyMap,
      rng: mulberry32(7),
      items: { p1: { medkit: true, grenade: true } },
      units: [
        makeUnit({ id: 'p1', side: 'player', pos: { x: 5, y: 5 }, hp: 5, maxAp: 200, firingAccuracy: 0.95 }),
        makeUnit({ id: 'a1', side: 'alien', pos: { x: 6, y: 6 }, hp: 100 }),
        makeUnit({ id: 'a2', side: 'alien', pos: { x: 7, y: 7 }, hp: 1 }),
      ],
    });
    resolveAttack(manual, 'p1', 'a1', 'snap'); // постріл по живому
    const a2 = manual.units.find((u) => u.id === 'a2')!;
    for (let i = 0; i < 30 && a2.alive; i++) {
      resolveAttack(manual, 'p1', 'a2', 'snap'); // смерті від пострілів (детерміновано)
    }
    throwGrenade(manual, 'p1', { x: 6, y: 6 }); // кидок гранати
    moveUnit(manual, 'p1', [{ x: 4, y: 5 }]); // хід (шлях — масив клітинок)
    setOverwatch(manual, 'p1'); // дозор
    useMedkit(manual, 'p1', 'p1'); // лікування
    endTurn(manual); // кінець ходу
    const manualTypes = new Set(manual.log.map((e) => e.type));
    expect(manualTypes).toEqual(new Set(['shot', 'death', 'grenade', 'move', 'overwatch', 'heal', 'turn']));

    const mission = contactMission();
    const d = new AutoBattleDriver(makeDeps(mission));
    const randomSpy = vi.spyOn(Math, 'random'); // політика без власного RNG (ADR-0003)
    d.start();
    await driveToEnd(d);
    expect(randomSpy).not.toHaveBeenCalled();
    const autoTypes = new Set(mission.state.log.map((e) => e.type));
    for (const t of autoTypes) {
      expect(manualTypes.has(t), 'нештатний тип події авто-бою: ' + t).toBe(true);
    }
    expect(missionOutcome(mission.state)).toBe('перемога'); // hp 1 у демона — бій вирішується
  });

  it('детермінованість: безперервний прогін = прогін з «Стоп»/«Авто» посеред', async () => {
    // Один бій двома способами: (A) безперервний авто-бій; (B) кілька дій,
    // «Стоп», знову «Авто» — до кінця. Стан і лог байт-у-байт однакові:
    // зупинка/продовження не міняє порядок дій і викликів rng (критерій 2).
    const a = contactMission();
    const continuous = new AutoBattleDriver(makeDeps(a));
    continuous.start();
    await driveToEnd(continuous);

    const b = contactMission();
    const interrupted = new AutoBattleDriver(makeDeps(b));
    interrupted.start();
    await vi.advanceTimersByTimeAsync(160 * 2); // кілька дій автам
    interrupted.toggle(); // «Стоп» — завершити поточну дію і зупинитись
    expect(interrupted.busy).toBe(false);
    interrupted.toggle(); // знову «Авто» — з досягнутого стану
    await driveToEnd(interrupted);
    expect(JSON.stringify(b.state.log)).toBe(JSON.stringify(a.state.log));
    expect(JSON.stringify(b.state.units)).toBe(JSON.stringify(a.state.units));
  });

  it('повторний прогін з тим самим сідом — байт-у-байт той самий лог', async () => {
    const first = contactMission();
    const d1 = new AutoBattleDriver(makeDeps(first));
    d1.start();
    await driveToEnd(d1);
    const second = contactMission();
    const d2 = new AutoBattleDriver(makeDeps(second));
    d2.start();
    await driveToEnd(d2);
    expect(JSON.stringify(second.state.log)).toBe(JSON.stringify(first.state.log));
  });
});
