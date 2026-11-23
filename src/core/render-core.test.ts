// src/core/render-core.test.ts
// пR.3 (ADR-0038): чисті тести логіки кадрів/анімацій, перенесені з
// src/render.test.ts без зміни тверджень — прогрес і позиція анімацій,
// черга AnimEngine з ін'єктованим планувальником (idle → 0 перерисовок),
// перетворювач подій логу (лог байт-у-байт незмінний — критерій П6.8) і
// тряска канвасу при влучанні (детермінована, без RNG — ADR-0003).
// Canvas-виклики (draw*) тестуються в src/render.test.ts через мок-контексти.

import { describe, expect, it } from 'vitest';
import {
  FIGHTER_COLORS,
  HELMET_SHAPES,
  fighterLook,
  fogBorderSegments,
  pathLabelBox,
  pathLabelScale,
  PATH_LABEL_MIN_CSS,
  zoneOutlineSegments,
  type TerrainCell,
  AnimEngine,
  BOOM_MS,
  BOOM_PARTICLES,
  BOOM_SHAKE_PX,
  DNUM_MS,
  type GeoLayout,
  GEO_TRAIL_MS,
  GEO_TRAIL_POINTS,
  IMPACT_MS,
  MOVE_MS_PER_CELL,
  OW_FLASH_MS,
  RADAR_PULSE_MS,
  SHAKE_PX,
  TRACER_MS,
  animT,
  animsFromEvents,
  boomParticleOffset,
  geoIsLand,
  GEO_LAND_ROWS,
  GEO_LAYOUT,
  geoTrailPoints,
  makeBoomAnim,
  makeDeathAnim,
  makeGeoScanAnim,
  makeGeoTrailAnim,
  makeMoveAnim,
  makeOwFlashAnim,
  makeTracerAnim,
  moveAnimPos,
  pendingAlienMoveStarts,
  pendingDeathStarts,
  shakeOffset,
  type Anim,
  DISSOLVE_STRIP,
  RECOIL_PX,
  SPARKS,
  UNIT_DRAW,
  UNIT_FEET_DY,
  ATLAS_FEET_ROW,
  HP_BAR_H,
  HP_BAR_Y,
  cellHash,
  dissolveKept,
  recoilPx,
  sparkOffset,
  unitFrameOrigin,
} from './render-core';
import { makeUnit, type GameEvent, type Unit } from './combat';
import { createGeoGame, type GeoEvent } from './geo';

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
    expect(a.hpMax).toBe(u.maxHp); // П14.4: знімок для смуги HP у русі
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
    expect(eng.queued()).toHaveLength(0); // П14.4: знімок порожній після cancel
    eng.cancel(); // повторний cancel — безпомилковий (handle null)
    expect(st.canceled).toBe(1);
  });

  it('П14.4: queued — знімок черги у порядку відтворення, спорожніє по мірі відтворення', () => {
    const { run, deps } = fakeDeps();
    const eng = new AnimEngine(deps);
    expect(eng.queued()).toHaveLength(0); // idle — порожній знімок
    const a = makeOwFlashAnim(unit('s1', 'player', 0, 0)); // dur 300
    const b = makeDeathAnim(unit('a1', 'alien', 1, 1)); // dur 350
    eng.push(a, b);
    expect(eng.queued().map((x) => x.kind)).toEqual(['owflash', 'death']);
    run(0);
    run(300); // a завершена
    expect(eng.queued().map((x) => x.kind)).toEqual(['death']);
    run(650); // b завершена — idle
    expect(eng.queued()).toHaveLength(0);
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
    expect(anims[0].kind === 'death' && anims[0].hpMax).toBe(a1.maxHp); // П14.4: знімок для смуги HP
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

describe('П14.4: стартові клітинки невідтворених ходів демонів (фідбек прев’ю)', () => {
  it('pendingAlienMoveStarts: перший хід демона в черзі — старт шляху; ходи гравця і не-ходи ігноруються', () => {
    const d1 = makeMoveAnim(
      unit('a1', 'alien', 0, 0),
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
      ],
      false
    );
    const d1b = makeMoveAnim(
      unit('a1', 'alien', 2, 0),
      [
        { x: 2, y: 0 },
        { x: 3, y: 0 },
      ],
      false
    ); // другий хід — далі в черзі
    const s1 = makeMoveAnim(
      unit('s1', 'player', 5, 5),
      [
        { x: 5, y: 5 },
        { x: 6, y: 5 },
      ],
      false
    );
    const ow = makeOwFlashAnim(unit('a2', 'alien', 7, 7));
    const map = pendingAlienMoveStarts([d1, s1, ow, d1b]);
    expect(map.get('a1')).toEqual({ x: 0, y: 0 }); // «теперішня» позиція — перший невідтворений хід
    expect(map.has('s1')).toBe(false); // солдати рухаються в реальному часі — не приховується
    expect(map.has('a2')).toBe(false); // owflash — не хід
    expect(pendingAlienMoveStarts([])).toEqual(new Map()); // порожня черга
  });

  it('pendingDeathStarts (фікс П14.8): перша смерть юніта в черзі — його позиція; активний кадр ігнорується', () => {
    // «старий баг» блимання: ядро застосував смерть миттєво, кадр згасання
    // ще в черзі — статичний прохід тримає загиблого на полі до його кадру
    const active = makeDeathAnim(unit('a1', 'alien', 1, 1)); // queue[0] — малює анімаційний шар
    const tr = makeTracerAnim('player', { x: 0, y: 0 }, { x: 1, y: 1 }, true);
    const s1 = makeDeathAnim(unit('s1', 'player', 2, 3));
    const a2 = makeDeathAnim(unit('a2', 'alien', 4, 5));
    const s1b = makeDeathAnim(unit('s1', 'player', 2, 3)); // дублікат — перша смерть головна
    const map = pendingDeathStarts([active, tr, s1, a2, s1b]);
    expect(map.has('a1')).toBe(false); // активний кадр — не утримується статикою (без двійника)
    expect(map.get('s1')).toEqual({ x: 2, y: 3 });
    expect(map.get('a2')).toEqual({ x: 4, y: 5 });
    expect(map.size).toBe(2); // трасер і не-смерті ігноруються
    expect(pendingDeathStarts([])).toEqual(new Map());
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

describe('позафазна лінія «візуальні порівняння» (кандидат А «нічний супутник», 2026-10-22; скориговано 2026-10-23 ×2): розклад 9×16 ВИВЕДЕНО З КАРТИНИ — константа, без geo.rng', () => {
  // Розклад виведено скриптом scripts/geo-layout.py з assets-src/geo-map2.jpg
  // (медіани яскравості клітинок 70×70 вікна «сюди», поріг 16.5;
  // фідбек власника 2026-10-23 ×4: вказівка «сюди» — клітинка бази на
  // яскравому мисі-«острові» південного узбережжя материка, медіана
  // бази 35.6 — без відхилень). Байти фіксуються тут: L — суша, B — база.
  const MAP = [
    '......LLLLLL....',
    '...LLLLLLLLLLL..',
    '..LLLLLLLLLLLL..',
    '...LLLLLLLLLLL..',
    '......LLBL......',
    '................',
    '................',
    '...........L....',
    '.........L......',
  ];
  const layout = GEO_LAND_ROWS;

  // кількість суші в розкладі
  const landCount = (l: GeoLayout): number => {
    let n = 0;
    for (let y = 0; y < 9; y++) for (let x = 0; x < 16; x++) if (geoIsLand(l, x, y)) n++;
    return n;
  };
  // розміри компонентів зв'язності суші (4-напр., wrap по X)
  const components = (l: GeoLayout): number[] => {
    const seen = new Set<string>();
    const out: number[] = [];
    for (let y = 0; y < 9; y++)
      for (let x = 0; x < 16; x++) {
        if (!geoIsLand(l, x, y) || seen.has(x + ',' + y)) continue;
        const stack: Array<[number, number]> = [[x, y]];
        let size = 0;
        while (stack.length > 0) {
          const [cx, cy] = stack.pop()!;
          const k = cx + ',' + cy;
          if (seen.has(k) || !geoIsLand(l, cx, cy)) continue;
          seen.add(k);
          size++;
          stack.push([(cx + 1) % 16, cy], [(cx + 15) % 16, cy], [cx, cy - 1], [cx, cy + 1]);
        }
        out.push(size);
      }
    return out;
  };

  it('байти розкладу фіксуються: GEO_LAYOUT = рядки 9×16, похідні GEO_LAND_ROWS збігаються (константа, ADR-0003)', () => {
    expect(GEO_LAYOUT.length).toBe(9); // WORLD_H
    expect(GEO_LAYOUT).toEqual(MAP);
    for (const row of GEO_LAYOUT) expect(row.length).toBe(16); // WORLD_W
    // рядки — лише три символи; кожен рядок рівно 16
    for (const row of GEO_LAYOUT) expect([...row].every((c) => c === 'L' || c === 'B' || c === '.')).toBe(true);
    expect(layout.length).toBe(9);
    expect(layout[0]?.length).toBe(16);
    for (let y = 0; y < 9; y++) {
      for (let x = 0; x < 16; x++) {
        expect(geoIsLand(layout, x, y)).toBe(MAP[y]?.[x] !== '.'); // L і B — суша
      }
    }
  });

  it('geo.rng не витягується: розклад — константа, потік ядра не зсувається', () => {
    let calls = 0;
    const rng = (): number => {
      calls++;
      return 0.5;
    };
    createGeoGame({ rng }); // стан ядра з підміненим rng
    const before = calls;
    expect(geoIsLand(GEO_LAND_ROWS, 8, 4)).toBe(true); // читання фіксованого розкладу
    expect(calls).toBe(before); // 0 викликів geo.rng (критерій фідбеку)
  });

  it('пропорції: суша 46/144 (31.9%) — в орієнтирі 30–40%; материк з мисом бази + південні острови (фідбек «сюди» 2026-10-23)', () => {
    expect(landCount(layout)).toBe(46); // 31.9% (WORLD_H 9: 16×9)
    const comps = components(layout).sort((a, b) => b - a);
    // материк 44 (рядки 0..4: північний масив + південне узбережжя з
    // мисом-«островом» бази), південні острови (11,7) і (9,8) — поодинокі
    // (розклад виведено з картини, не рукотворний)
    expect(comps).toEqual([44, 1, 1]);
  });

  it('жорстка перевірка (а): клітинка бази (8,4) — суша (яскравий мис-«острів» під радаром, медіана 35.6; геометрія радара без змін)', () => {
    expect(geoIsLand(layout, 8, 4)).toBe(true); // база-радар — на мисі
  });

  it('жорстка перевірка (б): суша не торкається лівого/правого краю — суцільний океан, wrap без шва', () => {
    for (let y = 0; y < 9; y++) {
      expect(geoIsLand(layout, 0, y)).toBe(false); // лівий край — океан (темна рамка сирця)
      expect(geoIsLand(layout, 15, y)).toBe(false); // правий край — океан (паддінг-рамка)
      // циліндр по X: клітинки за краєм (wrap) — океан, шва зшивання нема
      expect(geoIsLand(layout, -1, y)).toBe(false);
      expect(geoIsLand(layout, 16, y)).toBe(false);
      for (let x = 0; x < 16; x++) {
        expect(geoIsLand(layout, x + 16, y)).toBe(geoIsLand(layout, x, y)); // wrap-ідентичність
      }
    }
  });
});

describe('П14.5: хвіст перехоплення — точки з подій intercept_move у логу', () => {
  const mv = (fx: number, fy: number, tx: number, ty: number): GeoEvent => ({
    type: 'intercept_move',
    from: { x: fx, y: fy },
    to: { x: tx, y: ty },
    minute: 30,
  });

  it('послідовні кроки → ламана [from, to…]; хвіст не-рухів після — пропускається', () => {
    const log: GeoEvent[] = [mv(0, 0, 1, 0), mv(1, 0, 2, 0), { type: 'intercept_engage', ufoId: 'u1', pos: { x: 2, y: 0 }, minute: 30 }];
    expect(geoTrailPoints(log)).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ]);
  });

  it('будь-яка інша подія обриває ланцюжок — лишається свіжий сегмент польоту', () => {
    const log: GeoEvent[] = [
      mv(0, 0, 1, 0),
      { type: 'intercept_round', round: 1, choice: 'далека', fighterHit: true, fighterDamage: 1, ufoHit: false, ufoDamage: 0, minute: 30 },
      mv(1, 0, 2, 0),
    ];
    expect(geoTrailPoints(log)).toEqual([
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ]);
  });

  it('капа GEO_TRAIL_POINTS: довший політ — лише останні позиції (новіші)', () => {
    const log: GeoEvent[] = [];
    for (let i = 0; i < 10; i++) log.push(mv(i, 0, i + 1, 0));
    const pts = geoTrailPoints(log);
    expect(pts.length).toBe(GEO_TRAIL_POINTS); // 8
    expect(pts[0]).toEqual({ x: 3, y: 0 }); // старша з вікон 10-крокового польоту
    expect(pts[pts.length - 1]).toEqual({ x: 10, y: 0 }); // новіша — поточна позиція
  });

  it('без рухів — порожній хвіст; лог читається, не змінюється', () => {
    expect(geoTrailPoints([])).toEqual([]);
    const log: GeoEvent[] = [
      { type: 'ufo_spawned', ufoId: 'u1', kind: 'розвідник', pos: { x: 3, y: 3 }, minute: 30 },
      { type: 'day', day: 1, minute: 1440 },
    ];
    expect(geoTrailPoints(log)).toEqual([]);
    expect(log.length).toBe(2); // байт-у-байт: події на місці
    expect(geoTrailPoints(log)).toEqual(geoTrailPoints(log)); // детермінізм
  });

  it('фабрика makeGeoTrailAnim: GEO_TRAIL_MS, start null, точки — копії (вхід незалежний)', () => {
    const pts = [
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ];
    const a = makeGeoTrailAnim(pts);
    expect(a.kind).toBe('gtrail');
    expect(a.dur).toBe(GEO_TRAIL_MS);
    expect(a.start).toBeNull();
    expect(a.points).toEqual(pts);
    pts[0]!.x = 99; // мутація входу не тягне анімацію
    expect(a.points[0]).toEqual({ x: 1, y: 2 });
  });

  it('фабрика makeGeoScanAnim: тривалість пульсу RADAR_PULSE_MS, start null', () => {
    const a = makeGeoScanAnim(384, 192, 216);
    expect(a.kind).toBe('gscan');
    expect(a.dur).toBe(RADAR_PULSE_MS);
    expect(a.maxR).toBe(216);
    expect(a.start).toBeNull();
  });
});

// Т.44: межа зору — відрізки між видимою клітинкою і туманом
describe('Т.44: fogBorderSegments — межа зору', () => {
  const field = (w: number, h: number, visible: (x: number, y: number) => boolean): TerrainCell[] =>
    Array.from({ length: w * h }, (_v, i) => ({
      x: i % w,
      y: Math.floor(i / w),
      blocked: false,
      visible: visible(i % w, Math.floor(i / w)),
    }));

  it('усе видно або все в тумані — межі немає; край поля межею не є', () => {
    expect(fogBorderSegments(field(3, 3, () => true))).toEqual([]);
    expect(fogBorderSegments(field(3, 3, () => false))).toEqual([]);
    expect(fogBorderSegments([])).toEqual([]);
  });

  it('видимий лівий стовпець поля 3×2 — два вертикальні відрізки на x = 1', () => {
    expect(fogBorderSegments(field(3, 2, (x) => x === 0))).toEqual([
      { x1: 1, y1: 0, x2: 1, y2: 1 },
      { x1: 1, y1: 1, x2: 1, y2: 2 },
    ]);
  });

  it('видима клітинка в центрі 3×3 — чотири сторони: права, ліва, нижня, верхня', () => {
    expect(fogBorderSegments(field(3, 3, (x, y) => x === 1 && y === 1))).toEqual([
      { x1: 2, y1: 1, x2: 2, y2: 2 },
      { x1: 1, y1: 1, x2: 1, y2: 2 },
      { x1: 1, y1: 2, x2: 2, y2: 2 },
      { x1: 1, y1: 1, x2: 2, y2: 1 },
    ]);
  });

  it('видима клітинка в куті — лише дві сторони всередину поля; стіна в тумані теж дає межу', () => {
    const cells = field(3, 3, (x, y) => x === 0 && y === 0);
    cells[1]!.blocked = true;
    expect(fogBorderSegments(cells)).toEqual([
      { x1: 1, y1: 0, x2: 1, y2: 1 },
      { x1: 0, y1: 1, x2: 1, y2: 1 },
    ]);
  });

  it('кожен відрізок одиничної довжини і лежить між видимою і невидимою клітинкою', () => {
    const cells = field(6, 5, (x, y) => (x * 7 + y * 3) % 4 < 2);
    const vis = new Set(cells.filter((c) => c.visible).map((c) => c.x + ',' + c.y));
    const fog = new Set(cells.filter((c) => !c.visible).map((c) => c.x + ',' + c.y));
    const segs = fogBorderSegments(cells);
    let pairs = 0;
    for (const c of cells) {
      if (!c.visible) continue;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const)
        if (fog.has(c.x + dx + ',' + (c.y + dy))) pairs++;
    }
    expect(segs.length).toBe(pairs);
    for (const e of segs) {
      expect(Math.abs(e.x2 - e.x1) + Math.abs(e.y2 - e.y1)).toBe(1);
      const sides = e.x1 === e.x2 ? [e.x1 - 1 + ',' + e.y1, e.x1 + ',' + e.y1] : [e.x1 + ',' + (e.y1 - 1), e.x1 + ',' + e.y1];
      expect(sides.filter((k) => vis.has(k)).length).toBe(1);
      expect(sides.filter((k) => fog.has(k)).length).toBe(1);
    }
  });
});

describe('Т.44: zoneOutlineSegments — контур зони ходу', () => {
  it('порожня множина — без відрізків; одна клітинка — чотири сторони зі зсувом усередину', () => {
    expect(zoneOutlineSegments(new Set())).toEqual([]);
    expect(zoneOutlineSegments(new Set(['3,5']))).toEqual([
      { x1: 4, y1: 5, x2: 4, y2: 6, nx: -1, ny: 0, e1: 0, e2: 0 },
      { x1: 3, y1: 5, x2: 3, y2: 6, nx: 1, ny: 0, e1: 0, e2: 0 },
      { x1: 3, y1: 6, x2: 4, y2: 6, nx: 0, ny: -1, e1: 0, e2: 0 },
      { x1: 3, y1: 5, x2: 4, y2: 5, nx: 0, ny: 1, e1: 0, e2: 0 },
    ]);
  });

  it('дві сусідні клітинки — шість сторін, спільної сторони немає; край поля (x = 0) — теж контур', () => {
    const edges = zoneOutlineSegments(new Set(['0,0', '1,0']));
    expect(edges).toHaveLength(6);
    expect(edges.some((e) => e.x1 === 1 && e.x2 === 1)).toBe(false);
    expect(edges).toContainEqual({ x1: 0, y1: 0, x2: 0, y2: 1, nx: 1, ny: 0, e1: 0, e2: 0 });
  });

  it('кожен відрізок лежить між клітинкою множини і клітинкою поза нею; зсув показує в бік множини', () => {
    const keys = new Set(['2,2', '3,2', '4,2', '2,3', '4,3', '2,4', '3,4', '4,4', '6,2']); // кільце з діркою (3,3) і окрема клітинка
    const edges = zoneOutlineSegments(keys);
    expect(edges).toHaveLength(12 + 4 + 4); // зовнішній контур кільця, дірка, окрема клітинка
    for (const e of edges) {
      const vertical = e.x1 === e.x2;
      const a = vertical ? e.x1 - 1 + ',' + e.y1 : e.x1 + ',' + (e.y1 - 1);
      const b = e.x1 + ',' + e.y1;
      expect(keys.has(a)).not.toBe(keys.has(b));
      // нормаль: +1 — множина праворуч чи знизу від лінії (клітинка b), −1 — ліворуч чи згори (клітинка a)
      expect(vertical ? [e.nx, e.ny] : [e.ny, e.nx]).toEqual([keys.has(b) ? 1 : -1, 0]);
    }
  });

  it('увігнутий кут: вертикальний відрізок подовжено на 2 px у бік кута, опуклі кути й горизонтальні відрізки — без подовження', () => {
    // «Г»: (0,0), (0,1), (1,1) — увігнутий кут у точці (1,1) між правою стороною (0,0) і верхом (1,1)
    const edges = zoneOutlineSegments(new Set(['0,0', '0,1', '1,1']));
    const ext = edges.filter((e) => e.e1 !== 0 || e.e2 !== 0);
    expect(ext).toEqual([{ x1: 1, y1: 0, x2: 1, y2: 1, nx: -1, ny: 0, e1: 0, e2: 2 }]);
    // дзеркально: (1,0), (0,1), (1,1) — ліва сторона (1,0) подовжена вниз; (0,0), (1,0), (1,1) — ліва сторона (1,1) вгору
    expect(zoneOutlineSegments(new Set(['1,0', '0,1', '1,1'])).filter((e) => e.e1 + e.e2 > 0)).toEqual([
      { x1: 1, y1: 0, x2: 1, y2: 1, nx: 1, ny: 0, e1: 0, e2: 2 },
    ]);
    expect(zoneOutlineSegments(new Set(['0,0', '1,0', '1,1'])).filter((e) => e.e1 + e.e2 > 0)).toEqual([
      { x1: 1, y1: 1, x2: 1, y2: 2, nx: 1, ny: 0, e1: 2, e2: 0 },
    ]);
    expect(zoneOutlineSegments(new Set(['0,0', '1,0', '0,1'])).filter((e) => e.e1 + e.e2 > 0)).toEqual([
      { x1: 1, y1: 1, x2: 1, y2: 2, nx: -1, ny: 0, e1: 2, e2: 0 },
    ]);
    // квадрат 2 × 2 і пряма смуга — увігнутих кутів немає
    expect(zoneOutlineSegments(new Set(['0,0', '1,0', '0,1', '1,1'])).every((e) => e.e1 === 0 && e.e2 === 0)).toBe(true);
    expect(zoneOutlineSegments(new Set(['0,0', '0,1', '0,2'])).every((e) => e.e1 === 0 && e.e2 === 0)).toBe(true);
  });
});

describe('Т.119: pathLabelBox — плашка ціни шляху збоку від цілі', () => {
  it('праворуч від клітинки: відступ 2, ширина — текст + 10, висота 21, по центру клітинки по вертикалі', () => {
    // ціль (5,4), клітинка 48: правий край 288, центр по вертикалі 216; «9 AP» — 36 px
    expect(pathLabelBox({ x: 5, y: 4 }, 48, 36, 960)).toEqual({ x: 290, y: 206, w: 46, h: 21 });
    // дробова ширина тексту округлюється вгору
    expect(pathLabelBox({ x: 5, y: 4 }, 48, 36.2, 960).w).toBe(47);
    // клітинку над ціллю (рядок 3: 144–192) і саму ціль плашка не перекриває
    const b = pathLabelBox({ x: 5, y: 4 }, 48, 36, 960);
    expect(b.y).toBeGreaterThanOrEqual(192);
    expect(b.x).toBeGreaterThanOrEqual(288);
  });

  it('праворуч не вміщується — ліворуч від клітинки; межа — 2 px до краю канви', () => {
    expect(pathLabelBox({ x: 19, y: 3 }, 48, 36, 960).x).toBe(864); // 912 − 2 − 46
    // ціль (18,3): праворуч 914 + 46 = 960 > 958 — ліворуч; ціль (17,3): 866 + 46 = 912 — праворуч
    expect(pathLabelBox({ x: 18, y: 3 }, 48, 36, 960).x).toBe(816);
    expect(pathLabelBox({ x: 17, y: 3 }, 48, 36, 960).x).toBe(866);
  });

  it('шлях приходить справа — плашка ліворуч від цілі; ліворуч не вміщується — праворуч', () => {
    expect(pathLabelBox({ x: 5, y: 4 }, 48, 36, 960, 1, true)).toEqual({ x: 192, y: 206, w: 46, h: 21 }); // 240 − 2 − 46
    expect(pathLabelBox({ x: 0, y: 4 }, 48, 36, 960, 1, true).x).toBe(50);
    expect(pathLabelBox({ x: 1, y: 4 }, 48, 36, 960, 1, true).x).toBe(98); // 48 − 2 − 46 = 0 < 2 — праворуч
  });

  it('по вертикалі притиснута в межі канви з відступом 2 px (верхній і нижній рядок при великому k)', () => {
    expect(pathLabelBox({ x: 5, y: 0 }, 48, 36, 960, 4).y).toBe(2); // висота 84 > клітинки
    const low = pathLabelBox({ x: 5, y: 19 }, 48, 36, 960, 4);
    expect(low.y + low.h).toBe(958);
  });

  it('k множить висоту, запас ширини і відступ від клітинки', () => {
    expect(pathLabelBox({ x: 5, y: 4 }, 48, 72, 960, 2)).toEqual({ x: 292, y: 195, w: 92, h: 42 });
  });
});

describe('Т.119: pathLabelScale — множник плашки за масштабом канви', () => {
  it('текст не дрібніший за 12 CSS px; на канві без зменшення — 1', () => {
    expect(PATH_LABEL_MIN_CSS).toBe(12);
    expect(pathLabelScale(1)).toBe(1);
    expect(pathLabelScale(1.25)).toBe(1); // 15 / 1,25 = 12 — рівно межа
    expect(pathLabelScale(2.5)).toBe(2); // 15 × 2 / 2,5 = 12 CSS px
    expect(pathLabelScale(0.5)).toBe(1); // збільшена канва — без зменшення
  });
});

// Т.129 (ADR-0118): колір і форма шолома бійця — за id ростера назавжди
describe('fighterLook: колір і форма шолома за id', () => {
  it('перші шість — шість різних кольорів, форма 0; сьомий — колір першого, інша форма', () => {
    const six = ['s1', 's2', 's3', 's4', 's5', 's6'].map(fighterLook);
    expect(six.map((l) => l.color)).toEqual([...FIGHTER_COLORS]);
    expect(six.every((l) => l.shape === 0)).toBe(true);
    expect(fighterLook('s7')).toEqual({ index: 6, color: FIGHTER_COLORS[0], shape: 1 });
    expect(fighterLook('s13').shape).toBe(2);
    expect(fighterLook('s19')).toEqual({ index: 18, color: FIGHTER_COLORS[0], shape: 0 });
  });

  it('18 перших бійців — 18 різних комбінацій; той самий id — той самий вигляд', () => {
    const combos = new Set<string>();
    for (let i = 1; i <= FIGHTER_COLORS.length * HELMET_SHAPES; i++) {
      const l = fighterLook('s' + i);
      combos.add(l.color + '/' + l.shape);
    }
    expect(combos.size).toBe(18);
    expect(fighterLook('s4')).toEqual(fighterLook('s4'));
  });

  it('id не з ростера — перший колір (без винятку)', () => {
    expect(fighterLook('a1').color).toBe(FIGHTER_COLORS[0]);
    expect(fighterLook('s0').index).toBe(0);
  });
});

// Т.132 (ADR-0121): геометрія бійця 68 px і чисті функції ефектів
describe('Т.132: бієць на полі і ефекти', () => {
  it('кадр 68 px: ноги на UNIT_FEET_DY нижче центру, фігура (рядки 34..93) — у межах клітинки 48', () => {
    for (const c of [24, 264, 936]) {
      const o = unitFrameOrigin(c, c);
      expect(o.x).toBe(c - UNIT_DRAW / 2);
      const feet = o.y + (UNIT_DRAW * ATLAS_FEET_ROW) / 96;
      expect(Math.abs(feet - (c + UNIT_FEET_DY))).toBeLessThanOrEqual(0.5);
      expect(o.y + (UNIT_DRAW * 34) / 96).toBeGreaterThanOrEqual(c - 24);
      expect(feet).toBeLessThanOrEqual(c + 24);
    }
    // смуга HP з підкладкою (±1 px) — під ногами і в межах клітинки
    expect(HP_BAR_Y - 1).toBeGreaterThanOrEqual(UNIT_FEET_DY);
    expect(HP_BAR_Y + HP_BAR_H + 1).toBeLessThanOrEqual(24);
  });

  it('recoilPx: лише на початку кулі; без частки трасера — 0', () => {
    expect(recoilPx(0.01, 0.2)).toBe(RECOIL_PX);
    expect(recoilPx(0.07, 0.2)).toBe(1);
    expect(recoilPx(0.1, 0.2)).toBe(0);
    expect(recoilPx(0.5, 0)).toBe(0);
  });

  it('sparkOffset: детерміновано, у межах 22 px по горизонталі, на f = 0 — у точці', () => {
    expect(sparkOffset({ x: 3, y: 4 }, 2, 0)).toEqual({ dx: 0, dy: 0 });
    const a = Array.from({ length: SPARKS }, (_, i) => sparkOffset({ x: 3, y: 4 }, i, 0.6));
    expect(a).toEqual(Array.from({ length: SPARKS }, (_, i) => sparkOffset({ x: 3, y: 4 }, i, 0.6)));
    for (const o of a) expect(Math.abs(o.dx)).toBeLessThanOrEqual(22);
    expect(new Set(a.map((o) => o.dx + ',' + o.dy)).size).toBeGreaterThan(SPARKS / 2); // розліт, не купа
    const end = Array.from({ length: SPARKS }, (_, i) => sparkOffset({ x: 3, y: 4 }, i, 1));
    for (const o of end) expect(o.dy).toBeLessThanOrEqual(22 * 0.8 + 10 + 1);
  });

  // Траєкторія іскри (Т.139; 20 живих мутантів `sparkOffset`, звіт Т.136): кут, дальність,
  // ease-out і падіння. Числа клітинки (0, 0) — з формули ADR-0121, решта — геометрія з допуском
  // округлення 0,5 px.
  it('sparkOffset: опорні точки на клітинці без зсуву кута (0, 0)', () => {
    const o = (i: number, f: number): { dx: number; dy: number } => sparkOffset({ x: 0, y: 0 }, i, f);
    expect(cellHash(0, 0) % 60).toBe(0);
    expect(o(0, 1)).toEqual({ dx: 14, dy: 10 }); // кут 0, коротка іскра, падіння 10
    expect(o(2, 1)).toEqual({ dx: 7, dy: 27 }); // 72°, довга
    expect(o(5, 1)).toEqual({ dx: -22, dy: 10 }); // 180°, довга
    expect(o(7, 1)).toEqual({ dx: -7, dy: -7 }); // 252°, довга, вгору
    expect(o(0, 0.5)).toEqual({ dx: 11, dy: 3 }); // ease-out 0,75 і падіння 2,5
    expect(o(5, 0.5)).toEqual({ dx: -16, dy: 3 });
  });

  it('sparkOffset: кут — i / SPARKS кола зі зсувом за клітинкою, дальність 14 / 22, ease-out, падіння 10 · f²', () => {
    for (const at of [
      { x: 3, y: 4 },
      { x: 5, y: 2 },
    ]) {
      const shift = (cellHash(at.x, at.y) % 60) / 100;
      for (let i = 0; i < SPARKS; i++) {
        const reach = i % 3 === 0 ? 14 : 22;
        const ang = (i / SPARKS) * Math.PI * 2 + shift;
        for (const f of [0.25, 0.5, 1]) {
          const r = reach * (1 - (1 - f) * (1 - f));
          const { dx, dy } = sparkOffset(at, i, f);
          expect(Math.abs(dx - Math.cos(ang) * r)).toBeLessThanOrEqual(0.5);
          expect(Math.abs(dy - (Math.sin(ang) * r * 0.8 + 10 * f * f))).toBeLessThanOrEqual(0.5);
        }
      }
    }
    // зсув кута за клітинкою справді різний — інакше «за клітинкою» нічого не тримає
    expect(cellHash(3, 4) % 60).not.toBe(cellHash(5, 2) % 60);
  });

  it('sparkOffset: ease-out — уже на половині шляху ¾ відльоту; f ≤ 0 — у точці; без −0', () => {
    for (let i = 0; i < SPARKS; i++) {
      const half = sparkOffset({ x: 0, y: 0 }, i, 0.5);
      const end = sparkOffset({ x: 0, y: 0 }, i, 1);
      // горизонталь без падіння: |dx(½)| ≈ ¾ · |dx(1)|
      expect(Math.abs(Math.abs(half.dx) - 0.75 * Math.abs(end.dx))).toBeLessThanOrEqual(1);
      expect(sparkOffset({ x: 3, y: 4 }, i, -0.5)).toEqual({ dx: 0, dy: 0 });
      // малий f: зсув < 0,5 px округлюється до +0, а не −0 (координата канви)
      const tiny = sparkOffset({ x: 3, y: 4 }, i, 0.01);
      expect(Object.is(tiny.dx, 0) && Object.is(tiny.dy, 0)).toBe(true);
    }
  });

  it('dissolveKept: на початку — усі смуги, наприкінці — жодної, між — частина', () => {
    const n = 48 / DISSOLVE_STRIP;
    const kept = (t: number): number => Array.from({ length: n }, (_, k) => dissolveKept(k, t)).filter(Boolean).length;
    expect(kept(0)).toBe(n);
    expect(kept(1)).toBe(0);
    expect(kept(0.5)).toBeGreaterThan(0);
    expect(kept(0.5)).toBeLessThan(n);
    expect(kept(0.3)).toBeGreaterThanOrEqual(kept(0.6)); // монотонно
  });
});
