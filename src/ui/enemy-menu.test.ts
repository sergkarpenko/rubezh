// Т.131 (ADR-0120): меню на ворогові — дані картки, HTML і місце біля клітинки демона.
import { describe, expect, it } from 'vitest';
import { GRENADE_AP_COST, GRENADE_RANGE, calculateHitChance, createGame, makeUnit, type GameState, type Unit } from '../core/combat';
import { FACE_SCALE, MENU_SHOTS, enemyFaceStyle, enemyMenuHtml, enemyMenuPlace, enemyMenuView } from './enemy-menu';
import { makeEnemy } from '../core/enemies';

function game(shooterAt: { x: number; y: number }, alienAt: { x: number; y: number }, blocked: string[] = []): GameState {
  const map = { width: 20, height: 20, blocked: new Set(blocked) };
  const s = makeUnit({ id: 's1', name: 'Олена', side: 'player', pos: shooterAt, firingAccuracy: 0.65 });
  const a = makeUnit({ id: 'a1', name: 'Демон 1', side: 'alien', pos: alienAt, hp: 4 });
  return createGame({ map, units: [s, a], items: { s1: { medkit: false, grenade: true } } });
}
const unit = (st: GameState, id: string): Unit => st.units.find((u) => u.id === id)!;

describe('п17.2: меню на ворогові — типи ворогів (рішення власника «А. Окремий рядок»)', () => {
  const view = (kind: 'demon' | 'hound' | 'golem' | 'eye'): string => {
    const st = game({ x: 2, y: 2 }, { x: 5, y: 2 });
    const e = makeEnemy(kind, 'a2', 0, { x: 6, y: 6 });
    st.units.push(e);
    return enemyMenuHtml(enemyMenuView(st, e, undefined));
  };
  it('п17.5 (рішення власника «А. Мініатюра типу»): у шапці — кадр «стій» свого ряду атласа', () => {
    for (const [kind, row] of [
      ['demon', 1],
      ['hound', 2],
      ['golem', 3],
      ['eye', 4],
    ] as const) {
      const h = view(kind);
      expect(h).toContain('<span class="em-face" data-kind="' + kind + '"');
      const y = -Math.round((row * 96 + 33) * FACE_SCALE);
      expect(enemyFaceStyle(kind)).toContain('background-position:-5px ' + y + 'px');
      expect(h.indexOf('em-face')).toBeLessThan(h.indexOf('em-name')); // мініатюра — перед назвою
    }
    // ворог без поля `kind` (демон ядра) — ряд демона
    const st = game({ x: 2, y: 2 }, { x: 5, y: 2 });
    expect(enemyMenuView(st, unit(st, 'a1'), undefined).kind).toBe('demon');
  });

  it('демон — як раніше: шкода й дальність, без нових рядків', () => {
    const h = view('demon');
    expect(h).toContain('>Шкода 2–5 · дальність 12</div>');
    expect(h).not.toContain('Лише');
    expect(h).not.toContain('Броня');
    expect(enemyMenuView(game({ x: 2, y: 2 }, { x: 5, y: 2 }), makeEnemy('demon', 'a1', 0, { x: 1, y: 1 }), undefined)).toMatchObject({
      only: null,
      armor: 0,
    });
  });
  it('гончак — «впритул» замість дальності', () => {
    const h = view('hound');
    expect(h).toContain('Гончак 1');
    expect(h).toContain('>Шкода 3–6 · впритул</div>');
    expect(h).not.toContain('Лише');
  });
  it('голем — рядок броні', () => {
    const h = view('golem');
    expect(h).toContain('>Шкода 3–6 · дальність 8</div>');
    expect(h).toContain('<div class="em-line">Броня 2: −2 від влучання</div>');
  });
  it('око — рядок «Лише прицільний»', () => {
    const h = view('eye');
    expect(h).toContain('>Шкода 3–7 · дальність 16</div>');
    expect(h).toContain('<div class="em-line">Лише прицільний</div>');
    expect(h).not.toContain('Броня');
  });
});

describe('enemyMenuView', () => {
  it('без бійця — картка лише з інформацією про демона', () => {
    const st = game({ x: 2, y: 2 }, { x: 5, y: 2 });
    const a = unit(st, 'a1');
    const v = enemyMenuView(st, a, undefined);
    expect(v).toMatchObject({ id: 'a1', name: 'Демон 1', hp: 4, maxHp: 10, weapon: a.weapon.name, weaponRange: a.weapon.range });
    expect(v.shooter).toBeNull();
    expect(enemyMenuHtml(v)).toContain('Виберіть бійця');
    expect(enemyMenuHtml(v)).not.toContain('<button');
  });

  it('п20.2 (ADR-0166): бій з укриттям — шанс кнопок з укриттям цілі (низька перешкода між ними — пів ×0,75)', () => {
    const st = game({ x: 2, y: 2 }, { x: 5, y: 2 });
    st.cover = true;
    st.map = { ...st.map, low: new Set(['4,2']) };
    const s = unit(st, 's1');
    const v = enemyMenuView(st, unit(st, 'a1'), s);
    for (const shot of v.shooter!.shots) expect(shot.chancePct).toBe(Math.round(calculateHitChance(s, shot.mode, 'half') * 100));
    expect(enemyMenuHtml(v)).toContain('>Швидкий</span><span class="em-meta">3 AP · ~39%<'); // 0,65 × 0,8 × 0,75
  });

  it('постріли — у порядку плиток 1–3, AP і шанс з ядра; доступна граната', () => {
    const st = game({ x: 2, y: 2 }, { x: 5, y: 2 });
    const s = unit(st, 's1');
    const v = enemyMenuView(st, unit(st, 'a1'), s);
    expect(v.shooter!.dist).toBe(3);
    expect(v.shooter!.shots.map((x) => x.mode)).toEqual([...MENU_SHOTS]);
    for (const shot of v.shooter!.shots) {
      expect(shot.ap).toBe(s.weapon.modes[shot.mode].apCost);
      expect(shot.shots).toBe(s.weapon.modes[shot.mode].shots);
      expect(shot.chancePct).toBe(Math.round(calculateHitChance(s, shot.mode) * 100));
      expect(shot.block).toBeNull();
    }
    expect(v.shooter!.grenade).toBeNull();
    const html = enemyMenuHtml(v);
    expect(html).not.toContain('disabled');
    expect(html).toContain('>Швидкий</span><span class="em-meta">3 AP · ~52%<');
    expect(html).toContain('>Черга</span><span class="em-meta">4 AP · 3×~33%<');
    expect(html).toContain('>Граната</span><span class="em-meta">' + GRENADE_AP_COST + ' AP · зона<');
    expect(html).toContain('HP 4/10');
    expect(html).toContain('width:40%');
  });

  it('причини: мало AP — для кожного режиму окремо; без гранати — «без гранат»', () => {
    const st = game({ x: 2, y: 2 }, { x: 5, y: 2 });
    const s = unit(st, 's1');
    s.ap = 4; // швидкий 3 і черга 4 — так, прицільний 5 — ні
    st.items!.s1.grenade = false;
    const v = enemyMenuView(st, unit(st, 'a1'), s);
    expect(v.shooter!.shots.map((x) => x.block)).toEqual([null, 'ap', null]);
    expect(v.shooter!.grenade).toBe('none');
    s.ap = 3;
    st.items!.s1.grenade = true;
    expect(enemyMenuView(st, unit(st, 'a1'), s).shooter!.grenade).toBe('ap'); // граната 4 AP
    const html = enemyMenuHtml(enemyMenuView(st, unit(st, 'a1'), s));
    expect(html).toContain('data-act="aimed" disabled><span class="em-lbl">Прицільний</span><span class="em-meta">мало AP<');
    expect(html).toContain('data-act="snap"><span');
  });

  it('далеко і немає лінії — для пострілів і гранати; дальність гранати менша за дальність зброї', () => {
    const far = game({ x: 0, y: 0 }, { x: 19, y: 0 });
    const s = unit(far, 's1');
    expect(19).toBeGreaterThan(s.weapon.range);
    const v = enemyMenuView(far, unit(far, 'a1'), s);
    expect(v.shooter!.shots.every((x) => x.block === 'range')).toBe(true);
    expect(v.shooter!.grenade).toBe('range');
    // у дальності зброї, але далі за кидок
    const mid = game({ x: 0, y: 0 }, { x: GRENADE_RANGE + 1, y: 0 });
    const vm = enemyMenuView(mid, unit(mid, 'a1'), unit(mid, 's1'));
    expect(vm.shooter!.shots.every((x) => x.block === null)).toBe(true);
    expect(vm.shooter!.grenade).toBe('range');
    // стіна між бійцем і демоном
    const wall = game({ x: 2, y: 2 }, { x: 6, y: 2 }, ['4,2']);
    const vw = enemyMenuView(wall, unit(wall, 'a1'), unit(wall, 's1'));
    expect(vw.shooter!.shots.every((x) => x.block === 'los')).toBe(true);
    expect(vw.shooter!.grenade).toBe('los');
    expect(enemyMenuHtml(vw)).toContain('немає лінії');
  });

  it('назва демона в HTML екранується', () => {
    const st = game({ x: 2, y: 2 }, { x: 5, y: 2 });
    unit(st, 'a1').name = '<b>"x"&';
    expect(enemyMenuHtml(enemyMenuView(st, unit(st, 'a1'), undefined))).toContain('&lt;b&gt;&quot;x&quot;&amp;');
  });
});

describe('enemyMenuPlace', () => {
  const field = { left: 10, top: 20, width: 400, height: 400 };
  const cellAt = (x: number, y: number) => ({ left: 10 + x * 20, top: 20 + y * 20, width: 20, height: 20 });

  it('праворуч від клітинки, центр по висоті', () => {
    expect(enemyMenuPlace(cellAt(2, 10), field, 200, 100)).toEqual({ left: 76, top: 180, side: 'right', covers: false });
  });
  it('біля правого краю — ліворуч; біля верху і низу — притиснута до меж поля', () => {
    expect(enemyMenuPlace(cellAt(15, 0), field, 200, 100)).toEqual({ left: 104, top: 20, side: 'left', covers: false });
    expect(enemyMenuPlace(cellAt(15, 19), field, 200, 100)).toEqual({ left: 104, top: 320, side: 'left', covers: false });
  });
  it('ні праворуч, ні ліворуч — під клітинкою, а внизу поля — над нею', () => {
    expect(enemyMenuPlace(cellAt(9, 2), field, 250, 100)).toEqual({ left: 75, top: 86, side: 'below', covers: false });
    expect(enemyMenuPlace(cellAt(9, 17), field, 250, 100)).toEqual({ left: 75, top: 254, side: 'above', covers: false });
  });
  it('ніде цілком — на ширшому боці, у межах поля', () => {
    const p = enemyMenuPlace(cellAt(12, 9), field, 250, 250);
    expect(p.side).toBe('left');
    expect(p.covers).toBe(true); // накриває клітинку демона — battle.ts пробує компактну картку
    expect(p.left).toBe(10);
    expect(p.top).toBe(85);
  });

  it('аудит PR #444: компактна картка на полях 330–400 px (вікно 1100 × 540, телефон) не накриває демона в жодній клітинці', () => {
    let covers = 0;
    for (let size = 330; size <= 400; size++) {
      const f = { left: 0, top: 0, width: size, height: size };
      const k = size / 20;
      for (let y = 0; y < 20; y++)
        for (let x = 0; x < 20; x++) {
          const cell = { left: x * k, top: y * k, width: k, height: k };
          // 224 × 167 — повна картка, 224 × 121 — компактна (виміри Т.131 у Chrome, Inter і DejaVu Sans)
          if (enemyMenuPlace(cell, f, 224, 167).covers && enemyMenuPlace(cell, f, 224, 121).covers) covers++;
        }
    }
    expect(covers).toBe(0);
  });
});
