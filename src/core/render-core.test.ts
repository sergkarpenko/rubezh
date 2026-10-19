// src/core/render-core.test.ts
// пR.3 (ADR-0038): чисті тести логіки кадрів/анімацій, перенесені з
// src/render.test.ts без зміни тверджень — прогрес і позиція анімацій,
// черга AnimEngine з ін'єктованим планувальником (idle → 0 перерисовок),
// перетворювач подій логу (лог байт-у-байт незмінний — критерій П6.8) і
// тряска канвасу при влучанні (детермінована, без RNG — ADR-0003).
// Canvas-виклики (draw*) тестуються в src/render.test.ts через мок-контексти.

import { describe, expect, it } from 'vitest';
import {
  AnimEngine,
  BOOM_MS,
  BOOM_PARTICLES,
  BOOM_SHAKE_PX,
  DNUM_MS,
  IMPACT_MS,
  MOVE_MS_PER_CELL,
  OW_FLASH_MS,
  SHAKE_PX,
  TRACER_MS,
  animT,
  animsFromEvents,
  boomParticleOffset,
  makeBoomAnim,
  makeDeathAnim,
  makeMoveAnim,
  makeOwFlashAnim,
  makeTracerAnim,
  moveAnimPos,
  shakeOffset,
  type Anim,
} from './render-core';
import { makeUnit, type GameEvent, type Unit } from './combat';

const unit = (id: string, side: 'player' | 'alien', x: number, y: number): Unit => makeUnit({ id, side, pos: { x, y } });

describe('анімаційний рушій: прогрес і позиція (П6.8)', () => {
  it('animT: start === null → 0; у межах — частка; після dur — 1 (клімпиться)', () => {
    const a = makeOwFlashAnim(unit('s1', 'player', 2, 2));
    expect(a.dur).toBe(OW_FLASH_MS);
    expect(animT(a, 1000)).toBe(0); // ще не почалась
    a.start = 100;
    expect(animT(a, 100 + OW_FLASH_MS / 2)).toBe(0.5);
    expect(animT(a, 100 + OW_FLASH_MS * 10)).toBe(1);
  });

  it('makeMoveAnim: тривалість — 90 мс на клітинку шляху', () => {
    const u = unit('s1', 'player', 0, 0);
    const a = makeMoveAnim(
      u,
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
      ],
      false
    );
    expect(a.dur).toBe(2 * MOVE_MS_PER_CELL);
  });

  it('moveAnimPos: t=0 → центр першої клітинки, t=1 → останньої, середина — на ламаній', () => {
    const a = makeMoveAnim(
      unit('s1', 'player', 0, 0),
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
      ],
      false
    );
    expect(moveAnimPos(a, 0, 26)).toEqual({ cx: 13, cy: 13 });
    expect(moveAnimPos(a, 1, 26)).toEqual({ cx: 39, cy: 39 });
    expect(moveAnimPos(a, 0.25, 26)).toEqual({ cx: 26, cy: 13 }); // середина першого сегмента (0,0)→(1,0)
    expect(moveAnimPos(a, 0.5, 26)).toEqual({ cx: 39, cy: 13 }); // кут повороту (1,0)
  });
});

describe('черга анімацій: rAF лише під час активних анімацій (ADR-0029)', () => {
  // Фейковий планувальник: кадри виконує тест («пропускаємо час»), рахує
  // заплановані кадри, перемальовки та скасування.
  function fakeDeps() {
    const st = { schedules: 0, draws: 0, canceled: 0, idles: 0, frames: [] as Array<(now: number) => void> };
    const run = (now: number): void => {
      const batch = st.frames.splice(0);
      for (const cb of batch) cb(now);
    };
    const deps = {
      schedule: (cb: (now: number) => void): number => {
        st.schedules++;
        st.frames.push(cb);
        return st.frames.length;
      },
      cancel: (): void => {
        st.canceled++;
      },
      draw: (): void => {
        st.draws++;
      },
      onIdle: (): void => {
        st.idles++; // П6.16: черга спорожніла після відтворення
      },
    };
    return { st, run, deps };
  }

  it('idle → 0 перерисовок: без анімацій рушій не планує жодного кадру', () => {
    const { st, run, deps } = fakeDeps();
    const eng = new AnimEngine(deps); // черга порожня
    expect(eng.busy).toBe(false);
    expect(eng.active()).toBeNull();
    run(0);
    run(1000);
    expect(st.schedules).toBe(0);
    expect(st.draws).toBe(0);
  });

  it('послідовне відтворення і зупинка: останній кадр статичний, далі 0 перерисовок', () => {
    const { st, run, deps } = fakeDeps();
    const eng = new AnimEngine(deps);
    const a = makeOwFlashAnim(unit('s1', 'player', 0, 0)); // dur 300
    const b = makeDeathAnim(unit('a1', 'alien', 1, 1)); // dur 350
    eng.push(a, b);
    expect(st.schedules).toBe(1); // один rAF на push
    expect(eng.active()).toBe(a);

    run(0); // кадр 1: a почалась
    expect(st.draws).toBe(1);
    expect(st.schedules).toBe(2); // черга непорожня → наступний кадр
    expect(a.start).toBe(0);

    run(150); // кадр 2: a триває
    expect(animT(eng.active() as Anim, 150)).toBeCloseTo(0.5, 5);

    run(300); // кадр 3: a завершена → b почалась
    expect(eng.active()).toBe(b);
    expect(b.start).toBe(300);
    expect(st.schedules).toBe(4);

    run(650); // кадр 4: b завершена → черга порожня
    expect(eng.busy).toBe(false);
    expect(eng.active()).toBeNull();
    expect(st.draws).toBe(4); // останній кадр — фінальна перемальовка (статика)

    run(1000); // після idle: жодного нового кадру
    expect(st.schedules).toBe(4);
    expect(st.draws).toBe(4);
  });

  it('cancel: черга скидається, запланований кадр скасовується', () => {
    const { st, deps } = fakeDeps();
    const eng = new AnimEngine(deps);
    eng.push(makeOwFlashAnim(unit('s1', 'player', 0, 0)));
    expect(st.schedules).toBe(1);
    eng.cancel();
    expect(eng.busy).toBe(false);
    expect(st.canceled).toBe(1);
    expect(st.draws).toBe(0);
    eng.cancel(); // повторний cancel — безпомилковий (handle null)
    expect(st.canceled).toBe(1);
  });

  it('П6.16: onIdle — раз на випорожнення черги; без push не викликається', () => {
    const { st, run, deps } = fakeDeps();
    const eng = new AnimEngine(deps);
    run(0);
    expect(st.idles).toBe(0); // без анімацій (idle з початку) — без виклику
    eng.push(makeOwFlashAnim(unit('s1', 'player', 0, 0))); // dur 300
    run(0);
    run(150);
    expect(st.idles).toBe(0); // черга ще відтворюється
    run(300); // черга спорожніла
    expect(st.idles).toBe(1);
    run(1000); // далі idle — без нових кадрів і викликів
    expect(st.idles).toBe(1);
    expect(st.schedules).toBe(3); // після idle рушій не планує кадрів
    eng.push(makeDeathAnim(unit('a1', 'alien', 1, 1))); // dur 350 — нова серія
    run(1000);
    run(1350);
    expect(st.idles).toBe(2); // друга серія — ще один виклик
  });
});

describe('перетворювач подій логу → анімації (критерій: лог байт-у-байт незмінний)', () => {
  it('смерть без пострілу після неї (остання подія) — лише анімація смерті; смерть невідомого юніта — без анімації', () => {
    const a1 = unit('a1', 'alien', 5, 2);
    const anims = animsFromEvents([{ type: 'death', unitId: 'a1', killerId: 's1' }], [a1]);
    expect(anims.map((x) => x.kind)).toEqual(['death']);
    expect(anims[0].kind === 'death' && anims[0].at).toEqual({ x: 5, y: 2 });
    expect(animsFromEvents([{ type: 'death', unitId: 'ghost', killerId: 's1' }], [a1])).toEqual([]);
  });
  it("кроки руху об'єднуються в один хід; смерть-перед-пострілом → трасер потім смерть", () => {
    const s1 = unit('s1', 'player', 2, 2);
    const a1 = unit('a1', 'alien', 5, 2);
    const events: GameEvent[] = [
      { type: 'overwatch', unitId: 's1', armed: true },
      { type: 'move', unitId: 'a1', from: { x: 3, y: 2 }, to: { x: 4, y: 2 } },
      { type: 'move', unitId: 'a1', from: { x: 4, y: 2 }, to: { x: 5, y: 2 } },
      { type: 'death', unitId: 'a1', killerId: 's1' }, // fireOnce пише смерть РАНІШЕ пострілу
      { type: 'shot', shooterId: 's1', targetId: 'a1', mode: 'snap', hit: true, damage: 10 },
      { type: 'turn', turn: 2, side: 'player' },
    ];
    const before = JSON.stringify(events);
    const unitsBefore = JSON.stringify([s1, a1]);
    const anims = animsFromEvents(events, [s1, a1]);
    // П14.4: фатальне влучання тепер породжує й число пошкодження (після смерті)
    expect(anims.map((x) => x.kind)).toEqual(['owflash', 'move', 'tracer', 'death', 'dnum']);
    expect(anims[1].kind === 'move' && anims[1].path).toEqual([
      { x: 3, y: 2 },
      { x: 4, y: 2 },
      { x: 5, y: 2 },
    ]);
    expect(anims[2].kind === 'tracer' && anims[2].hit).toBe(true);
    expect(anims[3].kind === 'death' && anims[3].at).toEqual({ x: 5, y: 2 });
    // лог і юніти лише читались — байт-у-байт незмінні
    expect(JSON.stringify(events)).toBe(before);
    expect(JSON.stringify([s1, a1])).toBe(unitsBefore);
  });

  it('реакційний вогонь перериває рух: постріл між кроками розбиває хід на два', () => {
    const s1 = unit('s1', 'player', 2, 2);
    const a1 = unit('a1', 'alien', 5, 2);
    const events: GameEvent[] = [
      { type: 'move', unitId: 'a1', from: { x: 3, y: 2 }, to: { x: 4, y: 2 } },
      { type: 'shot', shooterId: 's1', targetId: 'a1', mode: 'snap', hit: false, damage: 0 },
      { type: 'move', unitId: 'a1', from: { x: 4, y: 2 }, to: { x: 5, y: 2 } },
    ];
    const anims = animsFromEvents(events, [s1, a1]);
    expect(anims.map((x) => x.kind)).toEqual(['move', 'tracer', 'move']);
    expect(anims[1].kind === 'tracer' && anims[1].hit).toBe(false);
  });

  it('події без анімації (turn) і невідомі юніти пропускаються', () => {
    const events: GameEvent[] = [
      { type: 'turn', turn: 2, side: 'alien' },
      { type: 'move', unitId: 'ghost', from: { x: 0, y: 0 }, to: { x: 1, y: 0 } },
    ];
    expect(animsFromEvents(events, [unit('s1', 'player', 0, 0)])).toEqual([]);
  });
});

describe('П6.13: тряска канвасу при влучанні (через AnimEngine, без RNG)', () => {
  it('без анімації, промах, фаза польоту і після завершення — нульовий зсув', () => {
    expect(shakeOffset(null, 100)).toEqual({ dx: 0, dy: 0 });
    const miss = makeTracerAnim('player', { x: 1, y: 1 }, { x: 3, y: 1 }, false);
    miss.start = 0;
    expect(shakeOffset(miss, 50)).toEqual({ dx: 0, dy: 0 });
    const hit = makeTracerAnim('player', { x: 1, y: 1 }, { x: 3, y: 1 }, true);
    expect(shakeOffset(hit, 100)).toEqual({ dx: 0, dy: 0 }); // start === null
    hit.start = 0;
    expect(shakeOffset(hit, TRACER_MS / 2)).toEqual({ dx: 0, dy: 0 }); // куля ще летить
    expect(shakeOffset(hit, TRACER_MS + IMPACT_MS + 10)).toEqual({ dx: 0, dy: 0 }); // спалах завершено
  });

  it('фаза спалаху: зсув у межах SHAKE_PX, гасне до кінця спалаху, детермінований', () => {
    const hit = makeTracerAnim('alien', { x: 5, y: 5 }, { x: 3, y: 5 }, true);
    hit.start = 0;
    const at = (frac: number) => shakeOffset(hit, TRACER_MS + IMPACT_MS * frac);
    const first = at(0.125); // амплітуда максимальна: sin(π/2) = 1
    expect(Math.abs(first.dx) + Math.abs(first.dy)).toBeGreaterThan(0);
    for (let k = 1; k <= 40; k++) {
      const o = at(k / 40);
      expect(Math.abs(o.dx)).toBeLessThanOrEqual(SHAKE_PX);
      expect(Math.abs(o.dy)).toBeLessThanOrEqual(SHAKE_PX);
    }
    expect(at(0.99)).toEqual({ dx: 0, dy: 0 }); // амплітуда спала до нуля
    expect(at(0.125)).toEqual(first); // той самий вхід → той самий зсув
  });
});

describe('П14.4: подієві ефекти 2.0 — тригери подій логу (критерій 1)', () => {
  it('grenade → boom; смерті уражених (раніші за подію) — після вибуху; числа лише видимих цілей', () => {
    const s1 = unit('s1', 'player', 2, 2);
    const a1 = unit('a1', 'alien', 5, 2);
    const a2 = unit('a2', 'alien', 6, 2);
    const events: GameEvent[] = [
      // throwGrenade пише смерті РАНІШЕ за grenade (цикл пошкоджень зони)
      { type: 'death', unitId: 'a1', killerId: 's1' },
      {
        type: 'grenade',
        unitId: 's1',
        center: { x: 5, y: 2 },
        hits: [
          { unitId: 'a1', damage: 4 },
          { unitId: 'a2', damage: 4 },
        ],
      },
    ];
    const before = JSON.stringify(events);
    const anims = animsFromEvents(events, [s1, a1, a2], new Set(['5,2'])); // a2 — у тумані
    expect(anims.map((x) => x.kind)).toEqual(['boom', 'death', 'dnum']);
    expect(anims[0].kind === 'boom' && anims[0].at).toEqual({ x: 5, y: 2 });
    expect(anims[0].kind === 'boom' && anims[0].dur).toBe(BOOM_MS);
    expect(anims[1].kind === 'death' && anims[1].at).toEqual({ x: 5, y: 2 });
    expect(anims[2].kind === 'dnum' && anims[2].amount).toBe(4); // лише видима a1
    expect(anims[2].kind === 'dnum' && anims[2].heal).toBe(false);
    expect(JSON.stringify(events)).toBe(before); // лог байт-у-байт не змінюється
  });

  it('grenade без смертей — boom + числа всіх уражених; без набору видимості — усе видиме (сумісність)', () => {
    const a1 = unit('a1', 'alien', 5, 2);
    const events: GameEvent[] = [{ type: 'grenade', unitId: 's1', center: { x: 5, y: 2 }, hits: [{ unitId: 'a1', damage: 5 }] }];
    expect(animsFromEvents(events, [a1]).map((x) => x.kind)).toEqual(['boom', 'dnum']);
  });

  it('grenade з порожньою зоною уражень — лише вибух', () => {
    const s1 = unit('s1', 'player', 2, 2);
    const events: GameEvent[] = [{ type: 'grenade', unitId: 's1', center: { x: 8, y: 8 }, hits: [] }];
    expect(animsFromEvents(events, [s1]).map((x) => x.kind)).toEqual(['boom']);
  });

  it('shot: влучання → трасер + число; промах (damage 0) — лише трасер; невидима ціль — числа немає', () => {
    const s1 = unit('s1', 'player', 2, 2);
    const a1 = unit('a1', 'alien', 5, 2);
    const hit: GameEvent[] = [{ type: 'shot', shooterId: 's1', targetId: 'a1', mode: 'snap', hit: true, damage: 4 }];
    const anims = animsFromEvents(hit, [s1, a1], new Set(['5,2']));
    expect(anims.map((x) => x.kind)).toEqual(['tracer', 'dnum']);
    expect(anims[1].kind === 'dnum' && anims[1].at).toEqual({ x: 5, y: 2 });
    expect(anims[1].kind === 'dnum' && anims[1].dur).toBe(DNUM_MS);
    const miss: GameEvent[] = [{ type: 'shot', shooterId: 's1', targetId: 'a1', mode: 'snap', hit: false, damage: 0 }];
    expect(animsFromEvents(miss, [s1, a1], new Set(['5,2'])).map((x) => x.kind)).toEqual(['tracer']);
    const fog: GameEvent[] = [{ type: 'shot', shooterId: 's1', targetId: 'a1', mode: 'snap', hit: true, damage: 4 }];
    expect(animsFromEvents(fog, [s1, a1], new Set()).map((x) => x.kind)).toEqual(['tracer']); // туман
  });

  it('смерть-перед-пострілом (фатальне влучання): трасер → смерть → число', () => {
    const s1 = unit('s1', 'player', 2, 2);
    const a1 = unit('a1', 'alien', 5, 2);
    const events: GameEvent[] = [
      { type: 'death', unitId: 'a1', killerId: 's1' },
      { type: 'shot', shooterId: 's1', targetId: 'a1', mode: 'snap', hit: true, damage: 10 },
    ];
    expect(animsFromEvents(events, [s1, a1]).map((x) => x.kind)).toEqual(['tracer', 'death', 'dnum']);
  });

  it('heal → число «+N» зцілення над ціллю; невидима ціль — числа немає', () => {
    const s1 = unit('s1', 'player', 2, 2);
    const events: GameEvent[] = [{ type: 'heal', unitId: 's1', targetId: 's1', healed: 3 }];
    const anims = animsFromEvents(events, [s1], new Set(['2,2']));
    expect(anims.map((x) => x.kind)).toEqual(['dnum']);
    expect(anims[0].kind === 'dnum' && anims[0].amount).toBe(3);
    expect(anims[0].kind === 'dnum' && anims[0].heal).toBe(true);
    expect(animsFromEvents(events, [s1], new Set()).map((x) => x.kind)).toEqual([]); // туман
  });
});

describe('П14.4: детерміновані частинки вибуху (без RNG — ADR-0003)', () => {
  it('той самий (епіцентр, i) → той самий зсув; t=0 — епіцентр; зсув у межах однієї клітинки', () => {
    const at = { x: 5, y: 2 };
    expect(boomParticleOffset(at, 3, 0.5)).toEqual(boomParticleOffset({ x: 5, y: 2 }, 3, 0.5));
    expect(boomParticleOffset(at, 3, 0)).toEqual({ dx: 0, dy: 0 }); // без -0
    let spread = 0;
    for (let i = 0; i < BOOM_PARTICLES; i++) {
      for (let k = 0; k <= 10; k++) {
        const o = boomParticleOffset(at, i, k / 10);
        expect(Math.abs(o.dx)).toBeLessThanOrEqual(1);
        expect(Math.abs(o.dy)).toBeLessThanOrEqual(1);
        expect(o.dx).not.toBe(-0);
        expect(o.dy).not.toBe(-0);
      }
      if (boomParticleOffset(at, i, 1).dx !== boomParticleOffset(at, 0, 1).dx) spread++;
    }
    expect(spread).toBeGreaterThan(0); // частинки розлітаються різними курсами
  });

  it('політ сповільнюється: приріст зсуву на першій половині більш за другу', () => {
    const at = { x: 3, y: 7 };
    const d = (t: number): number => {
      const o = boomParticleOffset(at, 5, t);
      return Math.hypot(o.dx, o.dy);
    };
    expect(d(0.5) - d(0.25)).toBeGreaterThan(d(0.75) - d(0.5));
  });
});

describe('П14.4: тряска вибуху — амплітуда ×2 від пострілу', () => {
  it('boom: у межах BOOM_SHAKE_PX = 2×SHAKE_PX, сягає амплітуди пострілу і гасне; поза вибухом — нуль', () => {
    expect(BOOM_SHAKE_PX).toBe(2 * SHAKE_PX);
    const boom = makeBoomAnim({ x: 5, y: 2 });
    expect(boom.dur).toBe(BOOM_MS);
    expect(shakeOffset(boom, 100)).toEqual({ dx: 0, dy: 0 }); // start === null
    boom.start = 0;
    expect(shakeOffset(boom, BOOM_MS + 10)).toEqual({ dx: 0, dy: 0 }); // завершено
    let maxAmp = 0;
    for (let k = 1; k < 100; k++) {
      const o = shakeOffset(boom, (k / 100) * BOOM_MS);
      expect(Math.abs(o.dx)).toBeLessThanOrEqual(BOOM_SHAKE_PX);
      expect(Math.abs(o.dy)).toBeLessThanOrEqual(BOOM_SHAKE_PX);
      maxAmp = Math.max(maxAmp, Math.abs(o.dx) + Math.abs(o.dy));
    }
    expect(maxAmp).toBeGreaterThanOrEqual(SHAKE_PX); // ≥ амплітуда пострілу (критерій)
    expect(shakeOffset(boom, BOOM_MS / 2)).toEqual(shakeOffset(boom, BOOM_MS / 2)); // детерміновано
    // інші види анімацій тряску не дають (крім влучання трасера)
    expect(shakeOffset(makeDeathAnim(unit('a1', 'alien', 1, 1)), 10)).toEqual({ dx: 0, dy: 0 });
  });
});
