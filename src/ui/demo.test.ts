// пR.2: юніт-тести покрокового драйвера демо-бою (src/ui/demo.ts, П6.16).
// Механіка драйвера не залежить від бойових правил — співробітники
// (DemoSteps, missionOutcome, animsFromEvents) стабляться; еквівалентність
// DemoSteps ↔ autoBattle байт-у-байт покрита в bot.test.ts (П6.16), DOM-флоу
// кнопки «Демо» — у main.ui.test.ts. Тут — паузи, onIdle-зв'язування, зупинка
// і гейти запуску (детермінізм: фейк-таймери, ADR-0003).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mission } from '../core/mission';

const { stepMock, animsMock, outcomeMock } = vi.hoisted(() => ({
  stepMock: vi.fn(),
  animsMock: vi.fn(),
  outcomeMock: vi.fn(),
}));

// Стаби: DemoSteps — клас з одним step, перетворювач анімацій і вихід місії —
// функції під контролем тесту (типові імпорти demo.ts не потребують real-модулів).
vi.mock('../bot', () => ({
  DemoSteps: class {
    step(...args: unknown[]) {
      return stepMock(...args);
    }
  },
}));
vi.mock('../core/render-core', () => ({
  animsFromEvents: (...args: unknown[]) => animsMock(...args),
}));
vi.mock('../core/mission', () => ({
  missionOutcome: (state: unknown) => outcomeMock(state),
}));

import { DemoDriver, type DemoDeps } from './demo';
import type { Anim } from '../core/render-core';

// Мінімальна «місія»: драйвер лише передає state у стаби і читає log/units.
function fakeMission(): Mission {
  return { state: { log: [], units: [] } } as unknown as Mission;
}

function makeDeps(over: Partial<DemoDeps> = {}): DemoDeps {
  return {
    getMission: vi.fn(() => fakeMission()),
    battleFinished: vi.fn(() => false),
    renderBattle: vi.fn(),
    renderAll: vi.fn(),
    binfo: vi.fn(),
    finishBattle: vi.fn(),
    pushAnims: vi.fn(),
    hasRaf: true,
    ...over,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  stepMock.mockReset();
  animsMock.mockReset();
  outcomeMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('DemoDriver: гейти запуску', () => {
  it('без місії battle — no-op', () => {
    const deps = makeDeps({ getMission: () => null });
    const d = new DemoDriver(deps);
    d.battle();
    expect(stepMock).not.toHaveBeenCalled();
    expect(deps.binfo).not.toHaveBeenCalled();
  });

  it('бойовий результат зафіксовано — battle не запускається', () => {
    const deps = makeDeps({ battleFinished: () => true });
    const d = new DemoDriver(deps);
    d.battle();
    expect(stepMock).not.toHaveBeenCalled();
  });

  it('повторний battle під час демо — no-op', () => {
    stepMock.mockReturnValue({ over: false });
    animsMock.mockReturnValue([]);
    const d = new DemoDriver(makeDeps());
    d.battle();
    d.battle(); // демо вже триває
    expect(stepMock).toHaveBeenCalledTimes(1);
  });
});

describe('DemoDriver: покроковий цикл', () => {
  it('дії крокують паузами таймера; перемога веде у finishBattle', () => {
    stepMock.mockReturnValueOnce({ over: false }).mockReturnValueOnce({ over: false }).mockReturnValueOnce({ over: true });
    animsMock.mockReturnValue([]); // turn-події — пауза одразу
    outcomeMock.mockReturnValue('перемога');
    const deps = makeDeps();
    const d = new DemoDriver(deps);
    d.battle();
    expect(stepMock).toHaveBeenCalledTimes(1);
    expect(deps.renderBattle).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(160);
    expect(stepMock).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(160);
    expect(stepMock).toHaveBeenCalledTimes(3);
    expect(deps.finishBattle).toHaveBeenCalledWith('перемога');
    expect(d.busy).toBe(false); // демо зупинено
  });

  it('анімації дії — pushAnims і пауза після onIdle', () => {
    stepMock.mockReturnValueOnce({ over: false }).mockReturnValueOnce({ over: true });
    animsMock.mockReturnValueOnce([{} as unknown as Anim]); // дія має анімації
    outcomeMock.mockReturnValue('поразка');
    const deps = makeDeps();
    const d = new DemoDriver(deps);
    d.battle();
    expect(deps.pushAnims).toHaveBeenCalledTimes(1);
    // черга анімацій відтворена (onIdle AnimEngine) — пауза і наступна дія
    d.onAnimIdle();
    vi.advanceTimersByTime(160);
    expect(stepMock).toHaveBeenCalledTimes(2);
    expect(deps.finishBattle).toHaveBeenCalledWith('поразка');
  });

  it('onIdle без активної дії — no-op (не крокує поза таймером)', () => {
    stepMock.mockReturnValue({ over: false });
    animsMock.mockReturnValue([]);
    const d = new DemoDriver(makeDeps());
    d.onAnimIdle();
    expect(stepMock).not.toHaveBeenCalled();
  });

  it('бій не завершився за ліміт — binfo + renderAll, без finishBattle', () => {
    stepMock.mockReturnValue({ over: true });
    outcomeMock.mockReturnValue('триває');
    const deps = makeDeps();
    const d = new DemoDriver(deps);
    d.battle();
    expect(deps.binfo).toHaveBeenCalledWith('Демо: бій не завершився за ліміт півходів.');
    expect(deps.renderAll).toHaveBeenCalledTimes(1);
    expect(deps.finishBattle).not.toHaveBeenCalled();
    expect(d.busy).toBe(false);
  });

  it('hasRaf=false (тести) — анімації не збираються, крокує лише таймером', () => {
    stepMock.mockReturnValue({ over: false });
    const deps = makeDeps({ hasRaf: false });
    const d = new DemoDriver(deps);
    d.battle();
    expect(animsMock).not.toHaveBeenCalled();
    expect(deps.pushAnims).not.toHaveBeenCalled();
    vi.advanceTimersByTime(160);
    expect(stepMock).toHaveBeenCalledTimes(2);
  });
});

describe('DemoDriver: зупинка', () => {
  it('stop скидає драйвер і таймер — таймер більше не крокує', () => {
    stepMock.mockReturnValue({ over: false });
    animsMock.mockReturnValue([]);
    const d = new DemoDriver(makeDeps());
    d.battle();
    expect(d.busy).toBe(true);
    d.stop();
    expect(d.busy).toBe(false);
    vi.advanceTimersByTime(10_000);
    expect(stepMock).toHaveBeenCalledTimes(1); // лише перший крок — далі тиша
  });

  it('next без місії — no-op (місія закрилась під час паузи)', () => {
    stepMock.mockReturnValue({ over: false });
    animsMock.mockReturnValue([]);
    // перші два виклики — battle і перший next; далі (після паузи) місії вже нема
    const mission = fakeMission();
    const getMission = vi.fn().mockReturnValueOnce(mission).mockReturnValueOnce(mission).mockReturnValue(null);
    const deps = makeDeps({ getMission: () => getMission() });
    const d = new DemoDriver(deps);
    d.battle();
    expect(stepMock).toHaveBeenCalledTimes(1); // перший крок відбувся
    vi.advanceTimersByTime(160); // пауза → next: місії вже нема — no-op
    expect(stepMock).toHaveBeenCalledTimes(1);
  });
});
