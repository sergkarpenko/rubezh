// src/core/intercept.ts
// П7.2 (ADR-0032): ядро перехоплення НЛО у повітрі — винищувач, погоня, раундовий бій.
// ADR-0002: чисте ядро без DOM/Canvas.
// ADR-0003: детермінізм через ін'єктований RNG — окремо від geo.rng: траєкторія
// геосцени не витягається і не зсувається, перехоплення байт-у-байт не змінює світ.
// ADR-0006: запуск — лише на виявлений НЛО у стані «летить» (невиявлені невидимі).
//
// Патерн ізоляції шарів (як economy.ts, ADR-0008/0021): geo.ts нічого не знає про
// винищувача; стан перехоплення живе в InterceptState поруч із GeoState.
// Погоня триває на тіках геосцени: винищувач швидший за НЛО (рух за Чебишевим
// з замиканням по X, як радар), геосцена живе своїм життям — час не «заморожений».
// Раунди не споживають тіки геосцени (як у тактичному бою — час «заморожений»
// на час бою). Винищувач не знищується — MVP-спрощення (ADR-0032): HP до нуля →
// вимушене переривання бою.
//
// Числа (швидкості, HP, шанси за дистанціями, ремонт) — константи; підбір масивними
// симуляціями — П7.6, тут початкові MVP-значення.

import { mulberry32, type RNG, type StatefulRng, type Vec2 } from './combat';
import { creditShotDownBonus, spend, type EconomyState } from './economy';
import { WORLD_W, chebyshevWrap, type GeoEvent, type GeoState } from './geo';
import { DEFAULT_PRESET, type DifficultyPreset } from './campaign';

export const FIGHTER_MAX_HP = 4; // MVP: один винищувач, без озброєння/досліджень
export const FIGHTER_STEPS_PER_TICK = 2; // до 2 клітин за тік — швидший за будь-який НЛО (1 кл./тік)
export const FIGHTER_REPAIR_TICKS = 16; // ремонт: 16 тіків (8 год) — гроші + тіки (П7.4)
export const FIGHTER_REPAIR_COST = 50; // MVP-значення; фіналізація — П7.6

// Шанси та урон за дистанціями (ADR-0032): впритул — максимальна ефективність
// винищувача і максимальна небезпека у відповідь; далека — безпечно, але шанси низькі.
export type InterceptRange = 'далека' | 'середня' | 'впритул';

export interface RangeProfile {
  fighterHitChance: number;
  fighterDamage: [number, number];
  ufoHitChance: number;
  ufoDamage: [number, number];
}

export const RANGE_PROFILES: Record<InterceptRange, RangeProfile> = {
  далека: { fighterHitChance: 0.25, fighterDamage: [1, 1], ufoHitChance: 0.1, ufoDamage: [1, 1] },
  середня: { fighterHitChance: 0.45, fighterDamage: [1, 2], ufoHitChance: 0.3, ufoDamage: [1, 2] },
  впритул: { fighterHitChance: 0.7, fighterDamage: [2, 3], ufoHitChance: 0.55, ufoDamage: [1, 3] },
};

export const UFO_INTERCEPT_HP = { розвідник: 3, збирач: 5 } as const; // HP НЛО у повітряному бою

export type FighterStatus = 'на базі' | 'погоня' | 'бій' | 'ремонт';

export interface Fighter {
  hp: number;
  pos: Vec2;
  status: FighterStatus;
  targetId: string | null; // НЛО погоні (стан «погоня»)
  repairTicksLeft?: number; // тики ремонту, що залишилися (стан «ремонт»)
}

export type InterceptChoice = InterceptRange | 'відступ';

export type InterceptEvent =
  | { type: 'intercept_start'; ufoId: string; pos: Vec2; minute: number }
  | { type: 'intercept_move'; from: Vec2; to: Vec2; minute: number }
  | { type: 'intercept_engage'; ufoId: string; pos: Vec2; minute: number }
  | {
      type: 'intercept_round';
      round: number;
      choice: InterceptChoice;
      fighterHit: boolean;
      fighterDamage: number;
      ufoHit: boolean;
      ufoDamage: number;
      minute: number;
    }
  | { type: 'intercept_break_off'; ufoId: string; minute: number } // винищувач відступив
  | { type: 'intercept_aborted'; ufoId: string; reason: 'ufo_lost' | 'ufo_landed' | 'fighter_damaged'; pos: Vec2; minute: number }
  | { type: 'ufo_shot_down'; ufoId: string; pos: Vec2; minute: number }
  | { type: 'fighter_returned'; pos: Vec2; minute: number }
  | { type: 'fighter_repair_start'; minute: number }
  | { type: 'fighter_repair_done'; minute: number };

export interface InterceptState {
  rng: RNG; // окремий від geo.rng (ADR-0003/0032)
  fighter: Fighter;
  ufoHp: Record<string, number>; // HP НЛО у повітряному бою (погоня не змінює geo)
  activeUfoId: string | null; // НЛО активного бою (стан «бій»)
  round: number; // номер раунду активного бою (1..)
  log: InterceptEvent[];
}

export interface InterceptOptions {
  seed?: number;
  rng?: RNG;
}

export function createIntercept(seedOrOpts: number | { seed?: number; rng?: RNG } = 4242): InterceptState {
  const opts = typeof seedOrOpts === 'number' ? { seed: seedOrOpts } : seedOrOpts;
  return {
    rng: opts.rng ?? mulberry32(opts.seed ?? 4242),
    fighter: { hp: FIGHTER_MAX_HP, pos: { x: 0, y: 0 }, status: 'на базі', targetId: null },
    ufoHp: {},
    activeUfoId: null,
    round: 0,
    log: [],
  };
}

// П7.3 (ADR-0032): подія перехоплення в журнал геосцени. Туман (ADR-0006):
// перехоплення можливе лише на виявлений НЛО, тож усі події — про виявлених;
// шар застосунку фільтрує журнал як завжди (невиявлені НЛО у подіях не трапляються).
function geoLog(state: InterceptState, geo: GeoState, e: InterceptEvent): void {
  state.log.push(e);
  geo.log.push(e as GeoEvent);
}

// Позначити збитий НЛО у геосцені (П7.3, ADR-0032): НЛО сідає на місці падіння
// зі статусом «збитий» і стає місією через missionTargets (правила mission.ts
// не змінюються — воно, як і раніше, шукає приземлених/збитих за статусом).
function markShotDown(geo: GeoState, ufoId: string): void {
  const ufo = geo.ufos.find((u) => u.id === ufoId);
  if (ufo) {
    ufo.status = 'збитий';
    ufo.landedTicksLeft = 0; // не зникає сам — чекає тактичної місії
  }
}

// Запуск перехоплення: лише виявлений НЛО у стані «летить» (ADR-0006); винищувач
// боєготовий (на базі, повний HP — ремонт блокує запуск, П7.4).
export function startIntercept(state: InterceptState, geo: GeoState, ufoId: string): void {
  if (state.fighter.status !== 'на базі') {
    throw new Error('Винищувач не на базі: перехоплення неможливе');
  }
  if (state.fighter.hp < FIGHTER_MAX_HP) {
    throw new Error('Винищувач пошкоджений: спочатку ремонт');
  }
  const ufo = geo.ufos.find((u) => u.id === ufoId);
  if (!ufo || !ufo.detected || ufo.status !== 'летить') {
    throw new Error('Перехоплення можливе лише на виявлений НЛО у повітрі');
  }
  state.fighter.status = 'погоня';
  state.fighter.targetId = ufoId;
  state.fighter.pos = { ...geo.base };
  state.ufoHp[ufoId] = state.ufoHp[ufoId] ?? UFO_INTERCEPT_HP[ufo.kind];
  geoLog(state, geo, { type: 'intercept_start', ufoId, pos: { ...ufo.pos }, minute: geo.minute });
}

// Крок погоні до НЛО за Чебишевим з замиканням по X (куля по горизонталі, як радар).
function stepTowardWrap(pos: Vec2, target: Vec2): Vec2 {
  let dx = target.x - pos.x;
  if (dx > WORLD_W / 2) dx -= WORLD_W;
  if (dx < -WORLD_W / 2) dx += WORLD_W;
  const dy = target.y - pos.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return { x: (pos.x + Math.sign(dx) + WORLD_W) % WORLD_W, y: pos.y };
  }
  return { x: pos.x, y: pos.y + Math.sign(dy) };
}

// Один тік геосцени для перехоплення (викликає шар застосунку після geoTick).
// Погоня: зближення; НЛО сів чи зник з трекінгу до завершення погоні — переривання,
// винищувач повертається на базу (EARS, ADR-0032). Виявлений НЛО продовжує рух
// у geoTick як завжди — траєкторія геосцени не залежить від перехоплення.
export function interceptTick(state: InterceptState, geo: GeoState): void {
  const f = state.fighter;
  if (f.status !== 'погоня') return;
  const ufo = geo.ufos.find((u) => u.id === f.targetId);
  if (!ufo || !ufo.detected || ufo.status !== 'летить') {
    const reason = !ufo || !ufo.detected ? 'ufo_lost' : 'ufo_landed';
    geoLog(state, geo, { type: 'intercept_aborted', ufoId: f.targetId!, reason, pos: { ...f.pos }, minute: geo.minute });
    returnToBase(state, geo);
    return;
  }
  for (let step = 0; step < FIGHTER_STEPS_PER_TICK; step++) {
    if (chebyshevWrap(f.pos, ufo.pos) === 0) {
      f.status = 'бій';
      state.activeUfoId = ufo.id;
      state.round = 0;
      geoLog(state, geo, { type: 'intercept_engage', ufoId: ufo.id, pos: { ...ufo.pos }, minute: geo.minute });
      return;
    }
    const from = { ...f.pos };
    f.pos = stepTowardWrap(f.pos, ufo.pos);
    geoLog(state, geo, { type: 'intercept_move', from, to: { ...f.pos }, minute: geo.minute });
  }
  // фінальна перевірка: другим кроком досягли клітинки НЛО — бій з цього ж тіку
  if (chebyshevWrap(f.pos, ufo.pos) === 0) {
    f.status = 'бій';
    state.activeUfoId = ufo.id;
    state.round = 0;
    geoLog(state, geo, { type: 'intercept_engage', ufoId: ufo.id, pos: { ...ufo.pos }, minute: geo.minute });
  }
}

// Раунд бою — рішення гравця (дистанція або відступ); тіки геосцени не споживає.
// Відступ: розрив контакту, винищувач повертається на базу (НЛО продовжує цикл).
// П8.4a: пресет (борг П8.4) — лише для множника премії за збиття (campaign.ts);
// дефолт «норма» — старі виклики без змін.
export function interceptRound(
  state: InterceptState,
  geo: GeoState,
  choice: InterceptChoice,
  econ?: EconomyState,
  preset: DifficultyPreset = DEFAULT_PRESET
): void {
  const f = state.fighter;
  if (f.status !== 'бій') {
    throw new Error('Активний бій відсутній: раунд неможливий');
  }
  const ufo = geo.ufos.find((u) => u.id === state.activeUfoId);
  if (!ufo) {
    geoLog(state, geo, { type: 'intercept_aborted', ufoId: state.activeUfoId!, reason: 'ufo_lost', pos: { ...f.pos }, minute: geo.minute });
    returnToBase(state, geo);
    return;
  }
  state.round += 1;
  if (choice === 'відступ') {
    geoLog(state, geo, {
      type: 'intercept_round',
      round: state.round,
      choice,
      fighterHit: false,
      fighterDamage: 0,
      ufoHit: false,
      ufoDamage: 0,
      minute: geo.minute,
    });
    geoLog(state, geo, { type: 'intercept_break_off', ufoId: ufo.id, minute: geo.minute });
    returnToBase(state, geo);
    return;
  }
  const p = RANGE_PROFILES[choice];
  const fighterHit = state.rng() < p.fighterHitChance;
  const ufoHit = state.rng() < p.ufoHitChance;
  const fighterDamage = fighterHit ? p.fighterDamage[0] + Math.floor(state.rng() * (p.fighterDamage[1] - p.fighterDamage[0] + 1)) : 0;
  const ufoDamage = ufoHit ? p.ufoDamage[0] + Math.floor(state.rng() * (p.ufoDamage[1] - p.ufoDamage[0] + 1)) : 0;
  state.ufoHp[ufo.id] = Math.max(0, (state.ufoHp[ufo.id] ?? 0) - fighterDamage);
  f.hp = Math.max(0, f.hp - ufoDamage);
  geoLog(state, geo, {
    type: 'intercept_round',
    round: state.round,
    choice,
    fighterHit,
    fighterDamage,
    ufoHit,
    ufoDamage,
    minute: geo.minute,
  });
  if (state.ufoHp[ufo.id] === 0) {
    geoLog(state, geo, { type: 'ufo_shot_down', ufoId: ufo.id, pos: { ...ufo.pos }, minute: geo.minute });
    markShotDown(geo, ufo.id);
    returnToBase(state, geo);
    // П7.6: премія за збиття у повітрі — одразу після бою (економічна крива П7.6, ADR-0021).
    if (econ) creditShotDownBonus(econ, ufo.kind, preset);
    return;
  }
  if (f.hp === 0) {
    geoLog(state, geo, { type: 'intercept_aborted', ufoId: ufo.id, reason: 'fighter_damaged', pos: { ...f.pos }, minute: geo.minute });
    returnToBase(state, geo);
    // П7.4: ремонт платний; за наявності грошей стартує автоматично (досвід X-COM),
    // без грошей — винищувач чекає пошкоджений, ремонт можна оплатити пізніше.
    // Неспроможність перехоплення — не прогараш (ADR-0021).
    if (econ && econ.money >= FIGHTER_REPAIR_COST) {
      startRepair(state, geo, econ);
    }
  }
}

// Повернення на базу: миттєве (MVP-спрощення ADR-0032: без окремої фази дороги додому).
function returnToBase(state: InterceptState, geo: GeoState): void {
  state.fighter.status = 'на базі';
  state.fighter.pos = { ...geo.base };
  state.fighter.targetId = null;
  state.activeUfoId = null;
  state.round = 0;
  geoLog(state, geo, { type: 'fighter_returned', pos: { ...geo.base }, minute: geo.minute });
}

// Ремонт (гроші — П7.4, тут тіки): пошкоджений винищувач йде в ремонт і не може
// стартувати нове перехоплення до завершення (EARS, ADR-0032).
export function startRepair(state: InterceptState, geo: GeoState, econ: EconomyState): void {
  if (state.fighter.status !== 'на базі') {
    throw new Error('Ремонт можливий лише на базі');
  }
  if (state.fighter.hp >= FIGHTER_MAX_HP) {
    throw new Error('Винищувач не потребує ремонту');
  }
  spend(econ, FIGHTER_REPAIR_COST); // П7.4: гроші + тіки, патерн лікарні (ADR-0021)
  state.fighter.status = 'ремонт';
  state.fighter.pos = { ...geo.base };
  state.fighter.repairTicksLeft = FIGHTER_REPAIR_TICKS;
  geoLog(state, geo, { type: 'fighter_repair_start', minute: geo.minute });
}

export function repairTick(state: InterceptState, geo: GeoState): void {
  if (state.fighter.status !== 'ремонт') return;
  state.fighter.repairTicksLeft! -= 1;
  if (state.fighter.repairTicksLeft! <= 0) {
    state.fighter.hp = FIGHTER_MAX_HP;
    state.fighter.status = 'на базі';
    delete state.fighter.repairTicksLeft;
    geoLog(state, geo, { type: 'fighter_repair_done', minute: geo.minute });
  }
}

// Збите НЛО для шару geo/mission (П7.3): подія ufo_shot_down — джерело місії падіння.
export function shotDownUfos(state: InterceptState): string[] {
  return state.log.filter((e) => e.type === 'ufo_shot_down').map((e) => (e as { ufoId: string }).ufoId);
}

// Стан rng перехоплення для збереження (ADR-0026: функції не серіалізуються —
// зберігається позиція потоку mulberry32; формат сейва — П7.5).
export function interceptRngState(state: InterceptState): number {
  const rng = state.rng as StatefulRng;
  if (typeof rng.state !== 'number') {
    throw new Error('intercept.rng не має стану: потрібен mulberry32 (ADR-0003)');
  }
  return rng.state >>> 0;
}
