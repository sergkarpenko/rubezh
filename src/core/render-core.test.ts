// src/core/render-core.test.ts
// пR.3 (ADR-0038): чисті тести логіки кадрів/анімацій, перенесені з
// src/render.test.ts без зміни тверджень — прогрес і позиція анімацій,
// черга AnimEngine з ін'єктованим планувальником (idle → 0 перерисовок),
// перетворювач подій логу (лог байт-у-байт незмінний — критерій П6.8) і
// тряска канвасу при влучанні (детермінована, без RNG — ADR-0003).
// Canvas-виклики (draw*) тестуються в src/render.test.ts через мок-контексти.

import { describe, expect, it } from 'vitest';
import {
  ALIEN_RING,
  ENEMY_LOOK,
  FIGHTER_COLORS,
  HELMET_SHAPES,
  fighterLook,
  fogBorderSegments,
  fogHatchStep,
  FOG_HATCH_STEP,
  pathLabelBox,
  pathLabelScale,
  PATH_LABEL_MIN_CSS,
  zoneOutlineSegments,
  wallQuads,
  WALL_FACE_Y0,
  WALL_FACE_Y1,
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
  GEO_CELL_A,
  GEO_CELL_B,
  GEO_GRID_COLOR,
  NIGHT_BG,
  hasVisibleNeighbor,
  terrainShade,
  GEO_LAND_ROWS,
  GEO_LAYOUT,
  geoTrailPoints,
  makeBoomAnim,
  makeDNumAnim,
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
  calmAnim,
  tracerShare,
  CALM_DUR_K,
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
import { WORLD_H, WORLD_W, createGeoGame, type GeoEvent } from './geo';

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

describe('Т.143: fogHatchStep — крок штриха туману', () => {
  it("8 px buffer'а, поки 5,5 CSS px не більші; на зменшеній канві — 5,5 CSS px", () => {
    expect(FOG_HATCH_STEP).toBe(8);
    expect(fogHatchStep(1)).toBe(8);
    expect(fogHatchStep(8 / 5.5)).toBe(8);
    expect(fogHatchStep(2)).toBe(11);
    expect(fogHatchStep(4)).toBe(22);
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
    // f = ¾ (не ½: там значення рівно на x,5 — межа округлення): ease-out 0,9375, падіння 5,625
    expect(o(0, 0.75)).toEqual({ dx: 13, dy: 6 });
    expect(o(5, 0.75)).toEqual({ dx: -21, dy: 6 });
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
      expect(sparkOffset({ x: 3, y: 4 }, i, 0)).toEqual({ dx: 0, dy: 0 });
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

// Т.144 (ADR-0125, рішення власника «А. Спокійно»): «менше руху» — спокійні копії подієвих анімацій
describe('спокійні анімації за «менше руху» (Т.144)', () => {
  const u = makeUnit({ id: 's1', side: 'player', pos: { x: 2, y: 0 } });
  it('calmAnim — копія з прапорцем calm і тривалістю ≈ ½; оригінал не змінюється', () => {
    const a = makeTracerAnim('player', { x: 0, y: 0 }, { x: 3, y: 0 }, true);
    const c = calmAnim(a);
    expect(c).toEqual({ ...a, calm: true, dur: Math.round((TRACER_MS + IMPACT_MS) * CALM_DUR_K) });
    expect(a.calm).toBeUndefined();
    expect(a.dur).toBe(TRACER_MS + IMPACT_MS);
    expect(calmAnim(makeDNumAnim({ x: 0, y: 0 }, 1, false)).dur).toBe(Math.round(DNUM_MS * CALM_DUR_K));
    expect(calmAnim({ ...makeOwFlashAnim(u), dur: 1 }).dur).toBe(1); // не коротше за 1 мс
  });
  it('tracerShare — частка польоту від пропорції: та сама для повної і спокійної копії', () => {
    const hit = makeTracerAnim('player', { x: 0, y: 0 }, { x: 3, y: 0 }, true);
    expect(tracerShare(hit)).toBe(TRACER_MS / hit.dur);
    expect(tracerShare(calmAnim(hit) as typeof hit)).toBe(TRACER_MS / hit.dur);
    expect(tracerShare(makeTracerAnim('alien', { x: 0, y: 0 }, { x: 3, y: 0 }, false))).toBe(1);
  });
  it('спокійний хід — одразу в цілі на будь-якому кадрі', () => {
    const path = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ];
    const c = calmAnim(makeMoveAnim(u, path, false)) as ReturnType<typeof makeMoveAnim>;
    for (const t of [0, 0.3, 1]) expect(moveAnimPos(c, t, 48)).toEqual({ cx: 2 * 48 + 24, cy: 24 });
    expect(moveAnimPos(makeMoveAnim(u, path, false), 0, 48)).toEqual({ cx: 24, cy: 24 });
  });
  it('без тряски: спокійні влучання і вибух не зсувають кадр', () => {
    const hit = calmAnim(makeTracerAnim('player', { x: 0, y: 0 }, { x: 3, y: 0 }, true));
    hit.start = 0;
    const boom = calmAnim(makeBoomAnim({ x: 1, y: 1 }));
    boom.start = 0;
    for (const now of [1, hit.dur * 0.8, boom.dur / 3]) {
      expect(shakeOffset(hit, now)).toEqual({ dx: 0, dy: 0 });
      expect(shakeOffset(boom, now)).toEqual({ dx: 0, dy: 0 });
    }
    const full = makeBoomAnim({ x: 1, y: 1 });
    full.start = 0;
    expect(shakeOffset(full, BOOM_MS / 8)).not.toEqual({ dx: 0, dy: 0 }); // повний вибух трясе
  });
});

describe('Т.146: wallQuads — стик сусідніх стін (ADR-0127)', () => {
  const T = 48;
  const of =
    (keys: string[]) =>
    (x: number, y: number): boolean =>
      keys.includes(x + ',' + y);
  // чверть за зсувом у клітинці: (0,0) ліва верхня … (½,½) права нижня
  const at = (qs: ReturnType<typeof wallQuads>, dx: number, dy: number) => qs!.find((q) => q.dx === dx && q.dy === dy)!;

  it('одиночна стіна (сусідки лише по діагоналі) — null: тайл цілком, як до Т.146', () => {
    expect(wallQuads(of(['5,5']), 5, 5, T)).toBeNull();
    expect(wallQuads(of(['5,5', '4,4', '6,6', '4,6', '6,4']), 5, 5, T)).toBeNull();
  });

  it('межі грані: рядки 8..24 тайла 48 px — під кантом і над передньою гранню', () => {
    expect(T * WALL_FACE_Y0).toBe(8);
    expect(T * WALL_FACE_Y1).toBe(24);
  });

  it('сусідка праворуч: праві чверті — середина тайла по X (без бічної рамки), рядки — як у тайла; ліві — кути тайла', () => {
    const qs = wallQuads(of(['5,5', '6,5']), 5, 5, T)!;
    expect(qs).toHaveLength(4);
    expect(at(qs, 0, 0)).toEqual({ sx: 0, sy: 0, sw: 24, sh: 24, dx: 0, dy: 0 });
    expect(at(qs, 0, 0.5)).toEqual({ sx: 0, sy: 24, sw: 24, sh: 24, dx: 0, dy: 0.5 });
    expect(at(qs, 0.5, 0)).toEqual({ sx: 12, sy: 0, sw: 24, sh: 24, dx: 0.5, dy: 0 }); // кант лишається
    expect(at(qs, 0.5, 0.5)).toEqual({ sx: 12, sy: 24, sw: 24, sh: 24, dx: 0.5, dy: 0.5 }); // передня грань лишається
  });

  it('сусідка ліворуч — дзеркально: ліві чверті з середини, праві — кути', () => {
    const qs = wallQuads(of(['5,5', '4,5']), 5, 5, T)!;
    expect(at(qs, 0, 0).sx).toBe(12);
    expect(at(qs, 0, 0.5).sx).toBe(12);
    expect(at(qs, 0.5, 0).sx).toBe(24);
    expect(at(qs, 0.5, 0.5).sx).toBe(24);
  });

  it('сусідка знизу: нижні чверті — верхня грань (8..24) замість передньої грані; верхні — з кантом', () => {
    const qs = wallQuads(of(['5,5', '5,6']), 5, 5, T)!;
    expect(at(qs, 0, 0)).toEqual({ sx: 0, sy: 0, sw: 24, sh: 24, dx: 0, dy: 0 });
    expect(at(qs, 0.5, 0)).toEqual({ sx: 24, sy: 0, sw: 24, sh: 24, dx: 0.5, dy: 0 });
    expect(at(qs, 0, 0.5)).toEqual({ sx: 0, sy: 8, sw: 24, sh: 16, dx: 0, dy: 0.5 });
    expect(at(qs, 0.5, 0.5)).toEqual({ sx: 24, sy: 8, sw: 24, sh: 16, dx: 0.5, dy: 0.5 });
  });

  it('сусідка згори: верхні чверті без канта (8..24), нижні — з передньою гранню', () => {
    const qs = wallQuads(of(['5,5', '5,4']), 5, 5, T)!;
    expect(at(qs, 0, 0)).toEqual({ sx: 0, sy: 8, sw: 24, sh: 16, dx: 0, dy: 0 });
    expect(at(qs, 0.5, 0)).toEqual({ sx: 24, sy: 8, sw: 24, sh: 16, dx: 0.5, dy: 0 });
    expect(at(qs, 0, 0.5)).toEqual({ sx: 0, sy: 24, sw: 24, sh: 24, dx: 0, dy: 0.5 });
  });

  it('усі чотири сусідки — усі чверті з середини тайла (12..36 × 8..24)', () => {
    const qs = wallQuads(of(['5,5', '4,5', '6,5', '5,4', '5,6']), 5, 5, T)!;
    for (const q of qs) expect({ sx: q.sx, sy: q.sy, sw: q.sw, sh: q.sh }).toEqual({ sx: 12, sy: 8, sw: 24, sh: 16 });
    expect(qs.map((q) => [q.dx, q.dy])).toEqual([
      [0, 0],
      [0.5, 0],
      [0, 0.5],
      [0.5, 0.5],
    ]);
  });

  it('кут «Г»: сусідки праворуч і знизу — права нижня з середини, ліва верхня — кут тайла', () => {
    const qs = wallQuads(of(['5,5', '6,5', '5,6']), 5, 5, T)!;
    expect(at(qs, 0, 0)).toEqual({ sx: 0, sy: 0, sw: 24, sh: 24, dx: 0, dy: 0 });
    expect(at(qs, 0.5, 0)).toEqual({ sx: 12, sy: 0, sw: 24, sh: 24, dx: 0.5, dy: 0 });
    expect(at(qs, 0, 0.5)).toEqual({ sx: 0, sy: 8, sw: 24, sh: 16, dx: 0, dy: 0.5 });
    expect(at(qs, 0.5, 0.5)).toEqual({ sx: 12, sy: 8, sw: 24, sh: 16, dx: 0.5, dy: 0.5 });
  });

  it('масштаб тайла: межі — частки сторони (тайл 96 px — удвічі)', () => {
    const qs = wallQuads(of(['5,5', '6,5', '5,6']), 5, 5, 96)!;
    expect(at(qs, 0.5, 0.5)).toEqual({ sx: 24, sy: 16, sw: 48, sh: 32, dx: 0.5, dy: 0.5 });
  });
});

// Т.147: живі мутанти прицільного прогону Stryker по render-core.ts у коді Т.119–Т.146 —
// межі умов, які тримали лише сусідні гілки. Еквівалентні мутанти — у записі Т.147 (docs/workflow.md).
describe('Т.147: межі гілок render-core (живі мутанти Т.119–Т.146)', () => {
  it('pathLabelBox: рівно 2 px до краю канви — бік ще вміщується', () => {
    // клітинка 40, k = 1: відступ 2, ширина плашки ceil(26 + 10) = 36
    expect(pathLabelBox({ x: 1, y: 0 }, 40, 26, 400, 1, true).x).toBe(2); // ліворуч: 40 − 2 − 36 = 2
    expect(pathLabelBox({ x: 0, y: 0 }, 40, 26, 80, 1).x).toBe(42); // праворуч: 42 + 36 = 80 − 2
  });
  it('moveAnimPos: старт не з (0, 0), шлях з однієї клітинки, t поза 0..1', () => {
    const path = [
      { x: 2, y: 3 },
      { x: 3, y: 3 },
    ];
    const a = makeMoveAnim(unit('s1', 'player', 2, 3), path, false);
    const start = { cx: 2 * 26 + 13, cy: 3 * 26 + 13 };
    expect(moveAnimPos(a, 0, 26)).toEqual(start);
    expect(moveAnimPos(a, -0.5, 26)).toEqual(start);
    expect(moveAnimPos(a, 1.5, 26)).toEqual({ cx: 3 * 26 + 13, cy: 3 * 26 + 13 }); // не далі за ціль
    const one = makeMoveAnim(unit('s1', 'player', 2, 3), [{ x: 2, y: 3 }], false);
    for (const t of [0, 0.5, 1]) expect(moveAnimPos(one, t, 26)).toEqual(start);
  });
  it('fighterLook: id лише цілком «s<число>» — інакше перший колір', () => {
    expect(fighterLook('xs3').index).toBe(0);
    expect(fighterLook('s3x').index).toBe(0);
    expect(fighterLook('s3').index).toBe(2);
  });
  it('ALIEN_RING — колір #rrggbb, відмінний від кольорів бійців', () => {
    expect(ALIEN_RING).toMatch(/^#[0-9a-f]{6}$/);
    expect(FIGHTER_COLORS as readonly string[]).not.toContain(ALIEN_RING);
  });
  it('п17.2: ENEMY_LOOK — демон пурпур «Д»; чотири різні кольори, жоден не колір бійця; літери різні', () => {
    expect(ENEMY_LOOK.demon).toEqual({ ring: ALIEN_RING, letter: 'Д' });
    expect(ENEMY_LOOK.hound).toEqual({ ring: '#ff3b30', letter: 'Гн' });
    expect(ENEMY_LOOK.golem).toEqual({ ring: '#8fa3b8', letter: 'Гл' });
    expect(ENEMY_LOOK.eye).toEqual({ ring: '#2ee6d6', letter: 'О' });
    const looks = Object.values(ENEMY_LOOK);
    expect(new Set(looks.map((l) => l.ring)).size).toBe(4);
    expect(new Set(looks.map((l) => l.letter)).size).toBe(4);
    for (const l of looks) {
      expect(l.ring).toMatch(/^#[0-9a-f]{6}$/);
      expect(FIGHTER_COLORS as readonly string[]).not.toContain(l.ring);
      expect(l.letter.length).toBeLessThanOrEqual(2); // плашка ≤ 15 px — не заходить на число HP
    }
  });
  it('п17.2: makeMoveAnim несе тип ворога; демон і оперативник — без поля', () => {
    const d = unit('a1', 'alien', 1, 1);
    expect('enemyKind' in makeMoveAnim(d, [{ x: 1, y: 1 }], false)).toBe(false);
    expect('enemyKind' in makeMoveAnim(unit('s1', 'player', 1, 1), [{ x: 1, y: 1 }], false)).toBe(false);
    expect(makeMoveAnim({ ...d, kind: 'golem' }, [{ x: 1, y: 1 }], false).enemyKind).toBe('golem');
  });
  it('recoilPx: рівно чверть польоту — уже 1 px; частка ≤ 0 — без віддачі', () => {
    expect(recoilPx(0.25, 1)).toBe(1);
    expect(recoilPx(0.24, 1)).toBe(RECOIL_PX);
    expect(recoilPx(0.1, -0.5)).toBe(0);
    expect(recoilPx(0.1, 0)).toBe(0);
  });
  it('dissolveKept: смуга лишається, поки t не перейшов її поріг (поріг = t — ще видно)', () => {
    // смуга 1: поріг (37 % 11) / 11 = 4/11
    expect(dissolveKept(1, 4 / 11)).toBe(true);
    expect(dissolveKept(1, 4 / 11 + 1e-9)).toBe(false);
  });
});

// Т.160: живі мутанти прицільного прогону Stryker по render-core.ts у старому коді (до Т.119):
// перетворювач подій логу, частинки й тряска вибуху, інтерполяція ходу. Зафіксовані числа —
// значення чинних формул П6.13 / П14.4 (детермінізм без RNG, ADR-0003); еквівалентні мутанти —
// у записі Т.160 (docs/workflow.md).
describe('Т.160: старий код render-core (живі мутанти до Т.119)', () => {
  const kinds = (anims: readonly Anim[]): string[] => anims.map((x) => x.kind);

  it('moveAnimPos: діагональний шлях не з (0, 0) — точка на сегменті за обома осями', () => {
    const path = [
      { x: 1, y: 2 },
      { x: 2, y: 4 },
      { x: 4, y: 5 },
    ];
    const a = makeMoveAnim(unit('s1', 'player', 1, 2), path, false);
    expect(moveAnimPos(a, 0.25, 10)).toEqual({ cx: 20, cy: 35 }); // середина (1,2)→(2,4): (1,5; 3)
    expect(moveAnimPos(a, 0.75, 10)).toEqual({ cx: 35, cy: 50 }); // середина (2,4)→(4,5): (3; 4,5)
  });

  it('boomParticleOffset: зафіксовані зсуви формули; t < 0 — епіцентр', () => {
    const cases: [{ x: number; y: number }, number, number, number, number][] = [
      [{ x: 5, y: 2 }, 3, 0.5, -0.5345816606536976, -0.15328882450372835],
      [{ x: 7, y: 4 }, 0, 1, -0.7827354427557445, -0.23930624031556005],
      [{ x: 2, y: 9 }, 11, 0.25, 0.2353391512474356, -0.004107860165175618],
    ];
    for (const [at, i, t, dx, dy] of cases) {
      const o = boomParticleOffset(at, i, t);
      expect(o.dx).toBeCloseTo(dx, 12);
      expect(o.dy).toBeCloseTo(dy, 12);
    }
    expect(boomParticleOffset({ x: 5, y: 2 }, 3, -0.5)).toEqual({ dx: 0, dy: 0 }); // без «зворотного» розльоту
    // t ≈ 1e-17: 1 − t округлюється до 1, відстань 0 — від'ємні cos / sin дали б −0 без «+ 0»
    expect(boomParticleOffset({ x: 5, y: 2 }, 3, 1e-17)).toEqual({ dx: 0, dy: 0 });
  });

  it('shakeOffset вибуху: перший кадр (t = 0) без зсуву; зафіксовані зсуви; без −0', () => {
    const boom = makeBoomAnim({ x: 5, y: 2 });
    boom.start = 100;
    expect(shakeOffset(boom, 100)).toEqual({ dx: 0, dy: 0 }); // t = 0: cos 0 = 1 дав би dy = 4
    expect(shakeOffset(boom, 50)).toEqual({ dx: 0, dy: 0 }); // кадр до старту (t обрізано до 0)
    boom.start = 0;
    expect(shakeOffset(boom, 0.1 * BOOM_MS)).toEqual({ dx: 3, dy: 1 });
    expect(shakeOffset(boom, 0.3 * BOOM_MS)).toEqual({ dx: -2, dy: -2 });
    expect(shakeOffset(boom, 0.6 * BOOM_MS)).toEqual({ dx: 2, dy: 0 });
    for (let k = 1; k < 1000; k++) {
      const o = shakeOffset(boom, (k / 1000) * BOOM_MS);
      expect(Object.is(o.dx, -0) || Object.is(o.dy, -0)).toBe(false);
    }
  });

  it('shakeOffset влучання: рівно кінець польоту кулі — ще без зсуву; зафіксовані зсуви; без −0', () => {
    const hit = makeTracerAnim('player', { x: 1, y: 1 }, { x: 3, y: 1 }, true);
    hit.start = 0;
    expect(shakeOffset(hit, TRACER_MS)).toEqual({ dx: 0, dy: 0 }); // t = частка польоту: cos 0 дав би dy = 2
    expect(shakeOffset(hit, TRACER_MS + IMPACT_MS * 0.05)).toEqual({ dx: 1, dy: 2 });
    expect(shakeOffset(hit, TRACER_MS + IMPACT_MS * 0.2)).toEqual({ dx: 1, dy: -1 });
    expect(shakeOffset(hit, TRACER_MS + IMPACT_MS * 0.4)).toEqual({ dx: -1, dy: 0 });
    for (let k = 1; k < 1000; k++) {
      const o = shakeOffset(hit, TRACER_MS + (IMPACT_MS * k) / 1000);
      expect(Object.is(o.dx, -0) || Object.is(o.dy, -0)).toBe(false);
    }
  });

  it('animsFromEvents: кроки різних юнітів поспіль — два ходи; хід із логу не «вибраний»', () => {
    const events: GameEvent[] = [
      { type: 'move', unitId: 'a1', from: { x: 3, y: 2 }, to: { x: 4, y: 2 } },
      { type: 'move', unitId: 'a2', from: { x: 6, y: 2 }, to: { x: 7, y: 2 } },
    ];
    const anims = animsFromEvents(events, [unit('a1', 'alien', 4, 2), unit('a2', 'alien', 7, 2)]);
    expect(kinds(anims)).toEqual(['move', 'move']);
    expect(anims[0].kind === 'move' && anims[0].path).toEqual([
      { x: 3, y: 2 },
      { x: 4, y: 2 },
    ]);
    expect(anims[1].kind === 'move' && anims[1].unitId).toBe('a2');
    expect(anims[0].kind === 'move' && anims[0].selected).toBe(false);
  });

  it('animsFromEvents: смерть, за якою не постріл по ній, — окремо від наступної події', () => {
    const s1 = unit('s1', 'player', 2, 2);
    const a1 = unit('a1', 'alien', 5, 2);
    const a2 = unit('a2', 'alien', 6, 2);
    const shotOther: GameEvent[] = [
      { type: 'death', unitId: 'a1', killerId: 's1' },
      { type: 'shot', shooterId: 's1', targetId: 'a2', mode: 'snap', hit: false, damage: 0 },
    ];
    const anims = animsFromEvents(shotOther, [s1, a1, a2]);
    expect(kinds(anims)).toEqual(['death', 'tracer']);
    expect(anims[1].kind === 'tracer' && anims[1].to).toEqual({ x: 6, y: 2 });
    // подія з targetId, але не постріл, — не «постріл, що вбив»
    const healNext: GameEvent[] = [
      { type: 'death', unitId: 'a1', killerId: 's1' },
      { type: 'heal', unitId: 's1', targetId: 'a1', healed: 0 },
    ];
    expect(kinds(animsFromEvents(healNext, [s1, a1]))).toEqual(['death']);
    // подія кидача, але не граната, — не «вибух, що вбив»
    const moveNext: GameEvent[] = [
      { type: 'death', unitId: 'a1', killerId: 's1' },
      { type: 'move', unitId: 's1', from: { x: 2, y: 2 }, to: { x: 3, y: 2 } },
    ];
    expect(kinds(animsFromEvents(moveNext, [s1, a1]))).toEqual(['death', 'move']);
    // граната іншого кидача — вибух окремо, після смерті
    const otherGrenade: GameEvent[] = [
      { type: 'death', unitId: 'a1', killerId: 's1' },
      { type: 'grenade', unitId: 's2', center: { x: 8, y: 8 }, hits: [] },
    ];
    expect(kinds(animsFromEvents(otherGrenade, [s1, a1]))).toEqual(['death', 'boom']);
  });

  it('animsFromEvents: фатальний постріл — трасер від стрільця до жертви, число лише за влучання з шкодою у видимій клітинці', () => {
    const s1 = unit('s1', 'player', 2, 2);
    const a1 = unit('a1', 'alien', 5, 3);
    const fatal = (hit: boolean, damage: number): GameEvent[] => [
      { type: 'death', unitId: 'a1', killerId: 's1' },
      { type: 'shot', shooterId: 's1', targetId: 'a1', mode: 'snap', hit, damage },
    ];
    const vis = new Set(['5,3']);
    const full = animsFromEvents(fatal(true, 6), [s1, a1], vis);
    expect(kinds(full)).toEqual(['tracer', 'death', 'dnum']);
    expect(full[0].kind === 'tracer' && [full[0].from, full[0].to]).toEqual([
      { x: 2, y: 2 },
      { x: 5, y: 3 },
    ]);
    expect(full[2].kind === 'dnum' && full[2].heal).toBe(false);
    expect(kinds(animsFromEvents(fatal(true, 0), [s1, a1], vis))).toEqual(['tracer', 'death']);
    expect(kinds(animsFromEvents(fatal(false, 6), [s1, a1], vis))).toEqual(['tracer', 'death']);
    expect(kinds(animsFromEvents(fatal(false, 0), [s1, a1], vis))).toEqual(['tracer', 'death']);
    expect(kinds(animsFromEvents(fatal(true, 6), [s1, a1], new Set()))).toEqual(['tracer', 'death']); // туман
    // невідомий стрілець або жертва — без анімацій (і без збою)
    expect(animsFromEvents(fatal(true, 6), [a1])).toEqual([]);
    expect(animsFromEvents(fatal(true, 6), [s1])).toEqual([]);
  });

  it('animsFromEvents: постріл — трасер між позиціями; число лише за влучання з шкодою; невідомі юніти пропускаються', () => {
    const s1 = unit('s1', 'player', 1, 4);
    const a1 = unit('a1', 'alien', 6, 2);
    const shot = (hit: boolean, damage: number): GameEvent[] => [
      { type: 'shot', shooterId: 's1', targetId: 'a1', mode: 'aimed', hit, damage },
    ];
    const anims = animsFromEvents(shot(true, 3), [s1, a1]);
    expect(kinds(anims)).toEqual(['tracer', 'dnum']);
    expect(anims[0].kind === 'tracer' && [anims[0].from, anims[0].to]).toEqual([
      { x: 1, y: 4 },
      { x: 6, y: 2 },
    ]);
    expect(anims[1].kind === 'dnum' && anims[1].heal).toBe(false);
    expect(kinds(animsFromEvents(shot(true, 0), [s1, a1]))).toEqual(['tracer']);
    expect(kinds(animsFromEvents(shot(false, 3), [s1, a1]))).toEqual(['tracer']);
    expect(animsFromEvents(shot(true, 3), [a1])).toEqual([]);
    expect(animsFromEvents(shot(true, 3), [s1])).toEqual([]);
  });

  it('animsFromEvents: граната — невідомі загиблі й уражені пропускаються; події після вибуху — окремо', () => {
    const s1 = unit('s1', 'player', 2, 2);
    const a1 = unit('a1', 'alien', 5, 2);
    const withDeath: GameEvent[] = [
      { type: 'death', unitId: 'ghost', killerId: 's1' },
      {
        type: 'grenade',
        unitId: 's1',
        center: { x: 5, y: 2 },
        hits: [
          { unitId: 'ghost', damage: 4 },
          { unitId: 'a1', damage: 4 },
        ],
      },
      { type: 'turn', turn: 2, side: 'alien' },
    ];
    const anims = animsFromEvents(withDeath, [s1, a1]);
    expect(kinds(anims)).toEqual(['boom', 'dnum']); // кидач s1 — не загиблий
    expect(anims[1].kind === 'dnum' && anims[1].heal).toBe(false);
    const noDeath: GameEvent[] = [
      {
        type: 'grenade',
        unitId: 's1',
        center: { x: 5, y: 2 },
        hits: [
          { unitId: 'ghost', damage: 4 },
          { unitId: 'a1', damage: 4 },
        ],
      },
    ];
    const plain = animsFromEvents(noDeath, [s1, a1]);
    expect(kinds(plain)).toEqual(['boom', 'dnum']);
    expect(plain[1].kind === 'dnum' && plain[1].heal).toBe(false);
  });

  it('animsFromEvents: граната вбила кількох — спершу вибух, потім усі смерті серії (і кидача), потім числа', () => {
    const s1 = unit('s1', 'player', 4, 2);
    const a1 = unit('a1', 'alien', 5, 2);
    const a2 = unit('a2', 'alien', 6, 2);
    const events: GameEvent[] = [
      { type: 'death', unitId: 's1', killerId: 's1' }, // кидач у зоні — friendly fire
      { type: 'death', unitId: 'a1', killerId: 's1' },
      { type: 'death', unitId: 'a2', killerId: 's1' },
      {
        type: 'grenade',
        unitId: 's1',
        center: { x: 5, y: 2 },
        hits: [
          { unitId: 's1', damage: 5 },
          { unitId: 'a1', damage: 5 },
          { unitId: 'a2', damage: 5 },
        ],
      },
      { type: 'turn', turn: 2, side: 'alien' },
    ];
    const anims = animsFromEvents(events, [s1, a1, a2]);
    expect(kinds(anims)).toEqual(['boom', 'death', 'death', 'death', 'dnum', 'dnum', 'dnum']);
    expect(anims.slice(1, 4).map((x) => x.kind === 'death' && x.unitId)).toEqual(['s1', 'a1', 'a2']);
    // серія смертей від одного вбивці без гранати за нею — кожна смерть окремо, як і досі
    const noGrenade: GameEvent[] = [
      { type: 'death', unitId: 'a1', killerId: 's1' },
      { type: 'death', unitId: 'a2', killerId: 's1' },
      { type: 'turn', turn: 2, side: 'alien' },
    ];
    expect(kinds(animsFromEvents(noGrenade, [s1, a1, a2]))).toEqual(['death', 'death']);
    // смерть від іншого вбивці перериває серію: граната — лише за своїми смертями
    const mixed: GameEvent[] = [
      { type: 'death', unitId: 'a1', killerId: 's2' },
      { type: 'death', unitId: 'a2', killerId: 's1' },
      { type: 'grenade', unitId: 's1', center: { x: 6, y: 2 }, hits: [{ unitId: 'a2', damage: 5 }] },
    ];
    expect(kinds(animsFromEvents(mixed, [s1, a1, a2]))).toEqual(['death', 'boom', 'death', 'dnum']);
    const otherInside: GameEvent[] = [
      { type: 'death', unitId: 'a1', killerId: 's1' },
      { type: 'death', unitId: 'a2', killerId: 's2' },
      { type: 'grenade', unitId: 's1', center: { x: 5, y: 2 }, hits: [{ unitId: 'a1', damage: 5 }] },
    ];
    expect(kinds(animsFromEvents(otherInside, [s1, a1, a2]))).toEqual(['death', 'death', 'boom', 'dnum']);
  });

  it('animsFromEvents: зцілення лише відомої цілі з healed > 0; дозор — лише озброєння відомого юніта', () => {
    const s1 = unit('s1', 'player', 2, 2);
    const heal = (targetId: string, healed: number): GameEvent[] => [{ type: 'heal', unitId: 's1', targetId, healed }];
    expect(kinds(animsFromEvents(heal('s1', 2), [s1]))).toEqual(['dnum']);
    expect(animsFromEvents(heal('s1', 0), [s1])).toEqual([]);
    expect(animsFromEvents(heal('ghost', 2), [s1])).toEqual([]);
    expect(kinds(animsFromEvents([{ type: 'overwatch', unitId: 's1', armed: true }], [s1]))).toEqual(['owflash']);
    expect(animsFromEvents([{ type: 'overwatch', unitId: 's1', armed: false }], [s1])).toEqual([]);
    expect(animsFromEvents([{ type: 'overwatch', unitId: 'ghost', armed: true }], [s1])).toEqual([]);
  });
});

describe('Т.161: решта старого коду render-core (палітра, геосцена, туман, рушій, черга)', () => {
  // Порожній рядок у fillStyle канва ігнорує мовчки — клітинка взяла б колір попередньої.
  const HEX = /^#[0-9a-f]{6}$/;

  it('палітра терену: у кожному з чотирьох наборів — чотири різні кольори #rrggbb, набори не перетинаються', () => {
    const all = new Set<string>();
    for (const blocked of [false, true])
      for (const visible of [false, true]) {
        const set = new Set<string>();
        for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) set.add(terrainShade(x, y, blocked, visible));
        expect(set.size).toBe(4);
        for (const c of set) {
          expect(c).toMatch(HEX);
          all.add(c);
        }
      }
    expect(all.size).toBe(16);
  });

  it('фон і тони геосцени — кольори #rrggbb, суша й океан різні; сітка — напівпрозорий rgba', () => {
    for (const c of [NIGHT_BG, GEO_CELL_A, GEO_CELL_B]) expect(c).toMatch(HEX);
    expect(GEO_CELL_A).not.toBe(GEO_CELL_B);
    expect(GEO_GRID_COLOR).toMatch(/^rgba\(\d+,\d+,\d+,0\.\d+\)$/);
  });

  it('geoIsLand: рядок y = WORLD_H — океан і для довшого розкладу; коротший розклад не падає', () => {
    const tall: GeoLayout = Array.from({ length: WORLD_H + 1 }, () => Array.from({ length: WORLD_W }, () => true));
    expect(geoIsLand(tall, 3, WORLD_H - 1)).toBe(true);
    expect(geoIsLand(tall, 3, WORLD_H)).toBe(false); // межа: y = WORLD_H — поза світом
    expect(geoIsLand([], 3, 0)).toBe(false);
    expect(geoIsLand(tall.slice(0, 2), 3, 5)).toBe(false);
  });

  it('hasVisibleNeighbor: кожен із чотирьох сусідів окремо — так; діагональ і сама клітинка — ні', () => {
    for (const k of ['4,3', '6,3', '5,2', '5,4']) expect(hasVisibleNeighbor(new Set([k]), 5, 3)).toBe(true);
    for (const k of ['4,2', '6,4', '4,4', '6,2', '5,3', '43', '53']) expect(hasVisibleNeighbor(new Set([k]), 5, 3)).toBe(false);
  });

  it('AnimEngine: busy і now; повторний push до кадру планує один кадр; push() без анімацій — один кадр до idle', () => {
    let schedules = 0;
    let draws = 0;
    let idles = 0;
    const frames: Array<(now: number) => void> = [];
    const eng = new AnimEngine({
      schedule: (cb) => {
        schedules++;
        frames.push(cb);
        return schedules;
      },
      cancel: () => {},
      draw: () => {
        draws++;
      },
      onIdle: () => {
        idles++;
      },
    });
    expect(eng.busy).toBe(false);
    eng.push(makeOwFlashAnim(unit('s1', 'player', 1, 1)));
    eng.push(makeOwFlashAnim(unit('s1', 'player', 1, 1)));
    expect(eng.busy).toBe(true);
    expect(schedules).toBe(1); // кадр уже заплановано — другий push лише додає в чергу
    frames.shift()!(1000);
    expect(eng.now).toBe(1000);
    // відлік — від старту анімації (1000), а не від нуля: через половину тривалості кадр ще той самий
    frames.shift()!(1000 + OW_FLASH_MS / 2);
    expect(eng.queued().length).toBe(2);
    expect(eng.now).toBe(1000 + OW_FLASH_MS / 2);
    eng.cancel();
    frames.length = 0;
    const before = { schedules, draws, idles };
    eng.push();
    expect(schedules).toBe(before.schedules + 1);
    frames.shift()!(5000);
    expect(draws).toBe(before.draws + 1);
    expect(idles).toBe(before.idles + 1);
    expect(frames.length).toBe(0);
  });

  it('AnimEngine без onIdle: черга спорожніла — кадр без помилки, далі не планується', () => {
    const frames: Array<(now: number) => void> = [];
    const eng = new AnimEngine({ schedule: (cb) => frames.push(cb), cancel: () => {}, draw: () => {} });
    eng.push(makeOwFlashAnim(unit('s1', 'player', 1, 1)));
    frames.shift()!(0);
    expect(() => frames.shift()!(OW_FLASH_MS)).not.toThrow();
    expect(eng.busy).toBe(false);
    expect(frames.length).toBe(0);
  });

  it('pendingAlienMoveStarts: хід із порожнім шляхом позиції не дає; pendingDeathStarts: перша смерть, а не остання', () => {
    const empty = makeMoveAnim(unit('a1', 'alien', 0, 0), [], false);
    expect(pendingAlienMoveStarts([empty]).has('a1')).toBe(false);
    const tr = makeTracerAnim('player', { x: 0, y: 0 }, { x: 1, y: 1 }, true);
    const first = makeDeathAnim(unit('a1', 'alien', 2, 3));
    const second = makeDeathAnim(unit('a1', 'alien', 7, 7));
    expect(pendingDeathStarts([tr, first, second]).get('a1')).toEqual({ x: 2, y: 3 });
  });
});

describe('п17.3: трасер стрільця з туману — від краю туману (рішення власника «А»)', () => {
  const eye = unit('a1', 'alien', 0, 0);
  const s1 = unit('s1', 'player', 15, 0);
  const shot = (hit: boolean): GameEvent => ({ type: 'shot', shooterId: 'a1', targetId: 's1', mode: 'aimed', hit, damage: hit ? 4 : 0 });
  // гравець бачить x ≥ 3 рядка y = 0
  const vis = new Set(Array.from({ length: 13 }, (_, i) => i + 3 + ',0'));

  it('стрілець у тумані: from — перша видима клітинка лінії, позначка fog', () => {
    const [tr] = animsFromEvents([shot(false)], [eye, s1], vis);
    expect(tr).toMatchObject({ kind: 'tracer', side: 'alien', from: { x: 3, y: 0 }, to: { x: 15, y: 0 }, fog: true });
  });

  it('стрілець видимий або набору немає — від стрільця, без позначки', () => {
    const [a] = animsFromEvents([shot(true)], [eye, s1]);
    expect(a).toMatchObject({ kind: 'tracer', from: { x: 0, y: 0 } });
    expect('fog' in a).toBe(false);
    const [b] = animsFromEvents([shot(true)], [eye, s1], new Set([...vis, '0,0']));
    expect('fog' in b).toBe(false);
  });

  it('фатальний постріл з туману — той самий край, далі згасання', () => {
    const anims = animsFromEvents([{ type: 'death', unitId: 's1', killerId: 'a1' }, shot(true)], [eye, s1], vis);
    expect(anims[0]).toMatchObject({ kind: 'tracer', from: { x: 3, y: 0 }, fog: true });
    expect(anims[1]).toMatchObject({ kind: 'death', unitId: 's1' });
  });

  it('на лінії немає видимої клітинки — трасер лише в клітинці цілі (хід, де гине весь загін)', () => {
    const [tr] = animsFromEvents([shot(false)], [eye, s1], new Set());
    expect(tr).toMatchObject({ kind: 'tracer', from: { x: 15, y: 0 }, to: { x: 15, y: 0 }, fog: true });
  });

  // аудит PR #508: units і vis — стан після всієї пачки (ходу), позиція стрільця — на момент пострілу
  it('постріл, потім рух: туман — за клітинкою пострілу, а не фінальною', () => {
    const far = unit('a1', 'alien', 0, 1); // фінальна клітинка, видима
    const target = unit('s1', 'player', 15, 0);
    const ev: GameEvent[] = [shot(false), { type: 'move', unitId: 'a1', from: { x: 0, y: 0 }, to: { x: 0, y: 1 } }];
    const view = new Set([...vis, '0,1']);
    expect(animsFromEvents(ev, [far, target], view)[0]).toMatchObject({ from: { x: 3, y: 0 }, fog: true });
    // з видимої клітинки (3,0) у туман (2,0): постріл не з туману — від стрільця, без позначки
    const hid = unit('a1', 'alien', 2, 0);
    const ev2: GameEvent[] = [shot(false), { type: 'move', unitId: 'a1', from: { x: 3, y: 0 }, to: { x: 2, y: 0 } }];
    expect('fog' in animsFromEvents(ev2, [hid, target], vis)[0]).toBe(false);
  });

  it('у межах огляду 12 туману немає (ціль бачить стрільця сама) — демон як раніше', () => {
    const d = unit('a1', 'alien', 0, 0);
    const near = unit('s1', 'player', 12, 0);
    const [tr] = animsFromEvents([shot(false)], [d, near], new Set());
    expect(tr).toMatchObject({ kind: 'tracer', from: { x: 0, y: 0 }, to: { x: 12, y: 0 } });
    expect('fog' in tr).toBe(false);
  });
});
