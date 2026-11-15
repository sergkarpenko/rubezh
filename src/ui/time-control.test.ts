// @vitest-environment jsdom
// src/ui/time-control.test.ts
// Т.43: зупинки кнопок часу. Стан готується правкою партії (createParty(42) +
// події в журналах), а не пошуком «щасливого» сіду: модуль лише порівнює стан
// до і після тіку, тож тік тут — функція, що дописує потрібну подію.

import { describe, expect, it } from 'vitest';
import type { Ufo } from '../core/geo';
import { createParty, type Party } from '../core/save';
import { isSpaceForEvent, runTime, shouldStop, stopEvents, takeSnapshot, type RunMode, type StopEvent } from './time-control';

function ufo(id: string, detected: boolean): Ufo {
  return { id, kind: 'розвідник', pos: { x: 1, y: 1 }, target: { x: 1, y: 1 }, status: 'приземлився', detected, landedTicksLeft: 8 } as Ufo;
}

// Дії «одного тіку», кожна дає рівно одну подію зупинки (або жодної).
const TICKS: Record<StopEvent | 'landed_hidden' | 'nothing' | 'died_in_hospital', (p: Party) => void> = {
  ufo_detected: (p) => {
    p.geo.ufos.push(ufo('u1', true));
    p.geo.log.push({ type: 'ufo_detected', ufoId: 'u1', pos: { x: 1, y: 1 }, minute: 0 });
  },
  ufo_landed: (p) => {
    p.geo.ufos.push(ufo('u2', true));
    p.geo.log.push({ type: 'ufo_landed', ufoId: 'u2', pos: { x: 1, y: 1 }, minute: 0 });
  },
  landed_hidden: (p) => {
    p.geo.ufos.push(ufo('u3', false));
    p.geo.log.push({ type: 'ufo_landed', ufoId: 'u3', pos: { x: 1, y: 1 }, minute: 0 });
  },
  project_completed: (p) => void p.research.log.push({ type: 'project_completed', id: 'armor' }),
  produced: (p) => void p.workshop.log.push({ type: 'produced', id: 'armor' }),
  recovered: (p) => {
    delete p.roster.hospital[p.roster.soldiers[0].id];
  },
  repair_done: (p) => void p.geo.log.push({ type: 'fighter_repair_done', minute: 0 }),
  nothing: (p) => void p.geo.log.push({ type: 'day', day: 2, minute: 0 }),
  // поранений зник із лікарні, бо його прибрали з ростеру, — це не одужання
  died_in_hospital: (p) => {
    const id = p.roster.soldiers[0].id;
    delete p.roster.hospital[id];
    p.roster.soldiers = p.roster.soldiers.filter((s) => s.id !== id);
  },
};

function eventsAfter(kind: keyof typeof TICKS): StopEvent[] {
  const p = createParty(42);
  p.roster.hospital[p.roster.soldiers[0].id] = 5;
  const before = takeSnapshot(p);
  TICKS[kind](p);
  return stopEvents(p, before);
}

// Прогін: подія `kind` стається на тіку `at` (рахунок з 1); решта тіків порожні.
function run(mode: RunMode, kind: keyof typeof TICKS, at: number, halted: () => boolean = () => false): number {
  const p = createParty(42);
  p.roster.hospital[p.roster.soldiers[0].id] = 5;
  let n = 0;
  return runTime(
    mode,
    p,
    () => {
      n++;
      if (n === at) TICKS[kind](p);
    },
    halted
  );
}

const SIX: StopEvent[] = ['ufo_detected', 'ufo_landed', 'project_completed', 'produced', 'recovered', 'repair_done'];

describe('Т.43: події зупинки (stopEvents)', () => {
  it.each(SIX)('подія %s розпізнається після тіку', (kind) => {
    expect(eventsAfter(kind)).toEqual([kind]);
  });

  it('приземлення невиявленого зонда — не подія (туман)', () => {
    expect(eventsAfter('landed_hidden')).toEqual([]);
  });

  it('тік без подій і зникнення пораненого з ростеру — не події', () => {
    expect(eventsAfter('nothing')).toEqual([]);
    expect(eventsAfter('died_in_hospital')).toEqual([]);
  });

  it('події до відбитка не рахуються', () => {
    const p = createParty(42);
    TICKS.ufo_detected(p);
    TICKS.produced(p);
    expect(stopEvents(p, takeSnapshot(p))).toEqual([]);
  });
});

describe('Т.43: правило режиму (shouldStop)', () => {
  it('«До події» зупиняється на кожній із шести подій, «+1 доба» — лише на двох подіях зондів', () => {
    for (const kind of SIX) {
      expect(shouldStop('event', [kind])).toBe(true);
      expect(shouldStop('day', [kind])).toBe(kind === 'ufo_detected' || kind === 'ufo_landed');
    }
    expect(shouldStop('event', [])).toBe(false);
    expect(shouldStop('day', [])).toBe(false);
  });
});

describe('Т.43: прогін часу (runTime)', () => {
  it.each(SIX)('«До події» зупиняється після тіку з подією %s', (kind) => {
    expect(run('event', kind, 7)).toBe(7);
  });

  it('«+1 доба» зупиняється на виявленні й приземленні, решту подій проходить', () => {
    expect(run('day', 'ufo_detected', 7)).toBe(7);
    expect(run('day', 'ufo_landed', 7)).toBe(7);
    for (const kind of ['project_completed', 'produced', 'recovered', 'repair_done'] as const) {
      expect(run('day', kind, 7)).toBe(48);
    }
  });

  it('без подій — рівно 48 тіків (1 доба) в обох режимах', () => {
    expect(run('event', 'nothing', 3)).toBe(48);
    expect(run('day', 'nothing', 3)).toBe(48);
    expect(run('event', 'landed_hidden', 3)).toBe(48);
  });

  it('подія на 48-му тіку — зупинка на ньому, на 49-й прогін не йде', () => {
    expect(run('event', 'produced', 48)).toBe(48);
    expect(run('event', 'produced', 49)).toBe(48);
  });

  it('технічна зупинка: час не йде (бій, повітряний бій, банкрутство) — тіків немає або цикл обривається', () => {
    expect(run('event', 'nothing', 1, () => true)).toBe(0);
    let calls = 0;
    expect(run('day', 'nothing', 1, () => ++calls > 5)).toBe(5);
  });

  it('кампанію завершено цим тіком — зупинка одразу', () => {
    const p = createParty(42);
    let n = 0;
    const done = runTime(
      'day',
      p,
      () => {
        if (++n === 4) p.campaign.status = 'перемога';
      },
      () => false
    );
    expect(done).toBe(4);
  });
});

describe('Т.43: пробіл (isSpaceForEvent)', () => {
  const ev = (init: KeyboardEventInit, target?: HTMLElement): KeyboardEvent => {
    const e = new KeyboardEvent('keydown', { bubbles: true, ...init });
    (target ?? document.body).dispatchEvent(e);
    return e;
  };

  it('пробіл поза полями — так; інша клавіша, повтор і модифікатори — ні', () => {
    expect(isSpaceForEvent(ev({ key: ' ', code: 'Space' }))).toBe(true);
    expect(isSpaceForEvent(ev({ key: 'e', code: 'KeyE' }))).toBe(false);
    expect(isSpaceForEvent(ev({ key: ' ', code: 'Space', repeat: true }))).toBe(false);
    expect(isSpaceForEvent(ev({ key: ' ', code: 'Space', ctrlKey: true }))).toBe(false);
  });

  it.each(['input', 'textarea', 'select', 'button'])('пробіл із фокусом на <%s> — ні', (tag) => {
    const t = document.createElement(tag);
    document.body.appendChild(t);
    expect(isSpaceForEvent(ev({ key: ' ', code: 'Space' }, t))).toBe(false);
    t.remove();
  });
});
