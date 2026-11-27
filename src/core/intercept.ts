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
import { creditShotDownBonus, hirePrice, spend, type EconomyState } from './economy';
import { WORLD_W, chebyshevWrap, type GeoEvent, type GeoState } from './geo';
import { DEFAULT_PRESET, type DifficultyPreset } from './campaign';
import { readySoldiers, type Roster } from './squad';
import { REGION_NAMES, type RegionId } from './regions';

export const FIGHTER_MAX_HP = 4; // MVP: один винищувач, без озброєння/досліджень
export const FIGHTER_STEPS_PER_TICK = 2; // до 2 клітин за тік — швидший за будь-який НЛО (1 кл./тік)
export const FIGHTER_REPAIR_TICKS = 16; // ремонт: 16 тіків (8 год) — гроші + тіки (П7.4)
export const FIGHTER_REPAIR_COST = 50; // MVP-значення; фіналізація — П7.6
// П11.3 (ADR-0058): гарматний модуль (виробництво цеху, екіпірування на
// геосцені) — +2 пошкодлення за раунд ПОВІТРЯНОГО БОЮ, доки встановлено.
// Додається до урону влучання (промах не«дограє» бонусом); на шанси і
// споживання rng не впливає — бої без модуля байт-у-байт незмінні.
export const GUN_MODULE_DAMAGE = 2;

// Шанси та урон за дистанціями (ADR-0032): впритул — максимальна ефективність
// винищувача і максимальна небезпека у відповідь; далека — безпечно, але шанси низькі.
export type InterceptRange = 'далека' | 'середня' | 'впритул';

export interface RangeProfile {
  fighterHitChance: number;
  fighterDamage: [number, number];
  probeHitChance: number;
  probeDamage: [number, number];
}

export const RANGE_PROFILES: Record<InterceptRange, RangeProfile> = {
  далека: { fighterHitChance: 0.25, fighterDamage: [1, 1], probeHitChance: 0.1, probeDamage: [1, 1] },
  середня: { fighterHitChance: 0.45, fighterDamage: [1, 2], probeHitChance: 0.3, probeDamage: [1, 2] },
  впритул: { fighterHitChance: 0.7, fighterDamage: [2, 3], probeHitChance: 0.55, probeDamage: [1, 3] },
};

export const PROBE_INTERCEPT_HP = { розвідник: 3, збирач: 5 } as const; // HP НЛО у повітряному бою

// п19.3 (ADR-0159 п. 4, 13; ADR-0161): до трьох перехоплювачів, кожен — в ангарі свого регіону.
// Перший (id 1) — безкоштовний, регіон «Північ», ангар — вузол «Рубіж» (`geo.base`), тож без
// купівлі погоні, бої й журнал перехоплень — байт-у-байт як у v0.10.0. Ангари решти регіонів —
// константи (власні числа, без імпорту regions.ts — цикл імпортів, урок Т.205).
export const MAX_FIGHTERS = 3;
export const HANGARS: Record<RegionId, Vec2> = {
  west: { x: 2, y: 4 },
  north: { x: 8, y: 4 }, // = вузол «Рубіж» (geo.base) — тест звіряє
  east: { x: 13, y: 4 },
  south: { x: 8, y: 7 },
};

// п19.3 (аудит PR #522): де стоїть перехоплювач — для текстів відмов: «Північ» — «у вузлі «Рубіж»»
// (як до п19.3), решта — «в ангарі «Схід»».
export function baseWhere(f: Pick<Fighter, 'region'>): string {
  return f.region === 'north' ? 'у вузлі «Рубіж»' : 'в ангарі «' + REGION_NAMES[f.region] + '»';
}

// Клітинка ангара регіону: «Північ» — вузол «Рубіж» (geo.base), решта — HANGARS.
export function hangarPos(region: RegionId, geo: GeoState): Vec2 {
  return region === 'north' ? { ...geo.base } : { ...HANGARS[region] };
}

export type FighterStatus = 'на базі' | 'погоня' | 'бій' | 'ремонт';

export interface Fighter {
  id: number; // п19.3: 1..3, порядок кидків RNG і обробки в тіку — за id
  region: RegionId; // п19.3: регіон ангара (погоня стартує з ангара, повернення — туди)
  hp: number;
  pos: Vec2;
  status: FighterStatus;
  targetId: string | null; // НЛО погоні (стан «погоня»)
  repairTicksLeft?: number; // тики ремонту, що залишилися (стан «ремонт»)
  gunModule?: boolean; // П11.3 (ADR-0058): встановлений гарматний модуль (+2 урону за раунд)
}

export type InterceptChoice = InterceptRange | 'відступ';

// п19.3: поле `fighter` (id перехоплювача) — лише коли перехоплювачів два і більше на момент
// події (з одним журнал байт-у-байт як у v0.10.0); `region` — ангар у рядках вильоту й повернення.
export interface FighterTag {
  fighter?: number;
  region?: RegionId;
}

export type InterceptEvent = (
  | { type: 'intercept_start'; probeId: string; pos: Vec2; minute: number }
  | { type: 'intercept_move'; from: Vec2; to: Vec2; minute: number }
  | { type: 'intercept_engage'; probeId: string; pos: Vec2; minute: number }
  | {
      type: 'intercept_round';
      round: number;
      choice: InterceptChoice;
      fighterHit: boolean;
      fighterDamage: number;
      probeHit: boolean;
      probeDamage: number;
      minute: number;
    }
  | { type: 'intercept_break_off'; probeId: string; minute: number } // винищувач відступив
  | { type: 'intercept_aborted'; probeId: string; reason: 'probe_lost' | 'probe_landed' | 'fighter_damaged'; pos: Vec2; minute: number }
  | { type: 'probe_shot_down'; probeId: string; pos: Vec2; minute: number }
  | { type: 'fighter_returned'; pos: Vec2; minute: number }
  | { type: 'fighter_repair_start'; minute: number }
  | { type: 'fighter_repair_done'; minute: number }
  | { type: 'fighter_assigned'; from: RegionId; to: RegionId; minute: number } // п19.3: перепризначення
) &
  FighterTag;

export interface InterceptState {
  rng: RNG; // окремий від geo.rng (ADR-0003/0032); спільний для всіх перехоплювачів (п19.3)
  fighters: Fighter[]; // п19.3: 1..MAX_FIGHTERS за зростанням id; [0] — перший (id 1)
  probeHp: Record<string, number>; // HP НЛО у повітряному бою (погоня не змінює geo)
  activeProbeId: string | null; // НЛО активного бою (стан «бій»; бій одночасно — один, п19.3)
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
    fighters: [{ id: 1, region: 'north', hp: FIGHTER_MAX_HP, pos: { x: 0, y: 0 }, status: 'на базі', targetId: null }],
    probeHp: {},
    activeProbeId: null,
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

// п19.3: позначка перехоплювача в події — лише коли їх два і більше (з одним — байт-у-байт).
function tag(state: InterceptState, f: Fighter, withRegion = false): FighterTag {
  if (state.fighters.length < 2) return {};
  return withRegion ? { fighter: f.id, region: f.region } : { fighter: f.id };
}

// п19.3: перехоплювач за id; без id — перший (виклики до п19.3 без змін).
export function fighterById(state: InterceptState, fighterId?: number): Fighter {
  const f = fighterId === undefined ? state.fighters[0] : state.fighters.find((x) => x.id === fighterId);
  if (!f) throw new Error('Немає перехоплювача ' + String(fighterId));
  return f;
}

// п19.3: перехоплювач у повітряному бою (бій одночасно — один) або null.
export function fighterInBattle(state: InterceptState): Fighter | null {
  return state.fighters.find((f) => f.status === 'бій') ?? null;
}

// п19.3: перехоплювач, що вже веде погоню чи бій за цим зондом (двоє на один зонд — ні).
function chaserOf(state: InterceptState, probeId: string): Fighter | null {
  return state.fighters.find((f) => (f.status === 'погоня' || f.status === 'бій') && f.targetId === probeId) ?? null;
}

// п19.3 (ADR-0161): новий перехоплювач (після виготовлення в «Кузні») — у стані «на базі»
// в ангарі регіону, повний HP, без модуля; id — наступний за найбільшим.
export function addFighter(state: InterceptState, geo: GeoState, region: RegionId): Fighter {
  if (state.fighters.length >= MAX_FIGHTERS) {
    throw new Error('Перехоплювачів уже ' + MAX_FIGHTERS + ': більше не буває');
  }
  const id = Math.max(...state.fighters.map((f) => f.id)) + 1;
  const f: Fighter = { id, region, hp: FIGHTER_MAX_HP, pos: hangarPos(region, geo), status: 'на базі', targetId: null };
  state.fighters.push(f);
  return f;
}

// п19.3 (ADR-0159 п. 4; рішення власника «А. Кілька в одному»): перепризначення — лише «на базі»,
// миттєве, у будь-який регіон (і той, що вийшов); у ангарі може стояти кілька перехоплювачів.
export function assignFighter(state: InterceptState, geo: GeoState, fighterId: number, region: RegionId): void {
  const f = fighterById(state, fighterId);
  if (f.status !== 'на базі') {
    throw new Error('Перепризначити можна лише перехоплювач на базі');
  }
  if (f.region === region) {
    throw new Error('Перехоплювач уже в цьому ангарі');
  }
  const from = f.region;
  f.region = region;
  f.pos = hangarPos(region, geo);
  geoLog(state, geo, { type: 'fighter_assigned', from, to: region, minute: geo.minute, ...tag(state, f) });
}

// Позначити збитий НЛО у геосцені (П7.3, ADR-0032): НЛО сідає на місці падіння
// зі статусом «збитий» і стає місією через missionTargets (правила mission.ts
// не змінюються — воно, як і раніше, шукає приземлених/збитих за статусом).
function markShotDown(geo: GeoState, probeId: string): void {
  const probe = geo.probes.find((u) => u.id === probeId);
  if (probe) {
    probe.status = 'збитий';
    probe.landedTicksLeft = 0; // не зникає сам — чекає тактичної місії
  }
}

// Запуск перехоплення: лише виявлений НЛО у стані «летить» (ADR-0006); винищувач
// боєготовий (на базі, повний HP — ремонт блокує запуск, П7.4).
// п19.3: fighterId — обраний перехоплювач (без нього — перший); погоня стартує з його ангара.
export function startIntercept(state: InterceptState, geo: GeoState, probeId: string, fighterId?: number): void {
  const f = fighterById(state, fighterId);
  if (f.status !== 'на базі') {
    throw new Error('Перехоплювач не ' + baseWhere(f) + ': перехоплення неможливе');
  }
  if (f.hp < FIGHTER_MAX_HP) {
    throw new Error('Перехоплювач пошкоджений: спочатку ремонт');
  }
  const probe = geo.probes.find((u) => u.id === probeId);
  if (!probe || !probe.detected || probe.status !== 'летить') {
    throw new Error('Перехоплення можливе лише на виявлений зонд Розриву у повітрі');
  }
  if (chaserOf(state, probeId)) {
    throw new Error('Цей зонд уже переслідує інший перехоплювач');
  }
  f.status = 'погоня';
  f.targetId = probeId;
  f.pos = hangarPos(f.region, geo);
  state.probeHp[probeId] = state.probeHp[probeId] ?? PROBE_INTERCEPT_HP[probe.kind];
  geoLog(state, geo, { type: 'intercept_start', probeId, pos: { ...probe.pos }, minute: geo.minute, ...tag(state, f, true) });
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
// п19.3: перехоплювачі — за зростанням id; бій одночасно — один: поки хтось у бою, решта погонь
// цього і наступних тіків чекає на місці (без руху й переривань), доки бій не скінчиться.
export function interceptTick(state: InterceptState, geo: GeoState): void {
  for (const f of state.fighters) {
    if (f.status !== 'погоня') continue;
    if (fighterInBattle(state)) return;
    chaseTick(state, geo, f);
  }
}

function chaseTick(state: InterceptState, geo: GeoState, f: Fighter): void {
  const probe = geo.probes.find((u) => u.id === f.targetId);
  if (!probe || !probe.detected || probe.status !== 'летить') {
    const reason = !probe || !probe.detected ? 'probe_lost' : 'probe_landed';
    geoLog(state, geo, {
      type: 'intercept_aborted',
      probeId: f.targetId!,
      reason,
      pos: { ...f.pos },
      minute: geo.minute,
      ...tag(state, f),
    });
    returnToBase(state, geo, f);
    return;
  }
  for (let step = 0; step < FIGHTER_STEPS_PER_TICK; step++) {
    if (chebyshevWrap(f.pos, probe.pos) === 0) {
      f.status = 'бій';
      state.activeProbeId = probe.id;
      state.round = 0;
      geoLog(state, geo, { type: 'intercept_engage', probeId: probe.id, pos: { ...probe.pos }, minute: geo.minute, ...tag(state, f) });
      return;
    }
    const from = { ...f.pos };
    f.pos = stepTowardWrap(f.pos, probe.pos);
    geoLog(state, geo, { type: 'intercept_move', from, to: { ...f.pos }, minute: geo.minute, ...tag(state, f) });
  }
  // фінальна перевірка: другим кроком досягли клітинки НЛО — бій з цього ж тіку
  if (chebyshevWrap(f.pos, probe.pos) === 0) {
    f.status = 'бій';
    state.activeProbeId = probe.id;
    state.round = 0;
    geoLog(state, geo, { type: 'intercept_engage', probeId: probe.id, pos: { ...probe.pos }, minute: geo.minute, ...tag(state, f) });
  }
}

// Раунд бою — рішення гравця (дистанція або відступ); тіки геосцени не споживає.
// Відступ: розрив контакту, винищувач повертається на базу (НЛО продовжує цикл).
// П8.4a: пресет (борг П8.4) — для множника премії за збиття (campaign.ts) і,
// з Т.26, для ціни найму в умові авторемонту; дефолт «норма» — старі виклики без змін.
// Т.26 (ADR-0090): roster — для умови авторемонту (repairRisksBankruptcy); без
// ростера ремонт стартує за самими грошима, як до Т.26 (виклики без партії).
export function interceptRound(
  state: InterceptState,
  geo: GeoState,
  choice: InterceptChoice,
  econ?: EconomyState,
  preset: DifficultyPreset = DEFAULT_PRESET,
  roster?: Roster
): void {
  const f = fighterInBattle(state); // п19.3: бій одночасно — один
  if (!f) {
    throw new Error('Активний бій відсутній: раунд неможливий');
  }
  const probe = geo.probes.find((u) => u.id === state.activeProbeId);
  if (!probe) {
    geoLog(state, geo, {
      type: 'intercept_aborted',
      probeId: state.activeProbeId!,
      reason: 'probe_lost',
      pos: { ...f.pos },
      minute: geo.minute,
      ...tag(state, f),
    });
    returnToBase(state, geo, f);
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
      probeHit: false,
      probeDamage: 0,
      minute: geo.minute,
      ...tag(state, f),
    });
    geoLog(state, geo, { type: 'intercept_break_off', probeId: probe.id, minute: geo.minute, ...tag(state, f) });
    returnToBase(state, geo, f);
    return;
  }
  const p = RANGE_PROFILES[choice];
  const fighterHit = state.rng() < p.fighterHitChance;
  const probeHit = state.rng() < p.probeHitChance;
  // П11.3 (ADR-0058): бонус модуля додається ПІСЛЯ кидка урону — споживання
  // rng те саме, що й без модуля (промах — 0, як і раніше).
  const fighterDamage = fighterHit
    ? p.fighterDamage[0] + Math.floor(state.rng() * (p.fighterDamage[1] - p.fighterDamage[0] + 1)) + (f.gunModule ? GUN_MODULE_DAMAGE : 0)
    : 0;
  const probeDamage = probeHit ? p.probeDamage[0] + Math.floor(state.rng() * (p.probeDamage[1] - p.probeDamage[0] + 1)) : 0;
  state.probeHp[probe.id] = Math.max(0, (state.probeHp[probe.id] ?? 0) - fighterDamage);
  f.hp = Math.max(0, f.hp - probeDamage);
  geoLog(state, geo, {
    type: 'intercept_round',
    round: state.round,
    choice,
    fighterHit,
    fighterDamage,
    probeHit,
    probeDamage,
    minute: geo.minute,
    ...tag(state, f),
  });
  if (state.probeHp[probe.id] === 0) {
    geoLog(state, geo, { type: 'probe_shot_down', probeId: probe.id, pos: { ...probe.pos }, minute: geo.minute, ...tag(state, f) });
    markShotDown(geo, probe.id);
    returnToBase(state, geo, f);
    // П7.6: премія за збиття у повітрі — одразу після бою (економічна крива П7.6, ADR-0021).
    if (econ) creditShotDownBonus(econ, probe.kind, preset);
    return;
  }
  if (f.hp === 0) {
    geoLog(state, geo, {
      type: 'intercept_aborted',
      probeId: probe.id,
      reason: 'fighter_damaged',
      pos: { ...f.pos },
      minute: geo.minute,
      ...tag(state, f),
    });
    returnToBase(state, geo, f);
    // П7.4: ремонт платний; за наявності грошей стартує автоматично (досвід X-COM),
    // без грошей — винищувач чекає пошкоджений, ремонт можна оплатити пізніше.
    // Неспроможність перехоплення — не провал (ADR-0021).
    // Т.26 (ADR-0090): ремонт не стартує сам, якщо боєготових немає і після оплати
    // не лишиться на найм — інакше ядро саме доводить партію до банкрутства
    // (третій шлях Т.22). Пізніше сам не стартує: оплата кнопкою або ботом.
    if (econ && econ.money >= FIGHTER_REPAIR_COST && !(roster && repairRisksBankruptcy(econ, roster, preset))) {
      startRepair(state, geo, econ, f.id);
    }
  }
}

// Т.26 (ADR-0090): чи доведе оплата ремонту партію до банкрутства — боєготових
// немає, а після ремонту грошей менше за ціну найму (тобто одразу настане
// isBankrupt, squad.ts). Одна умова для авторемонту в interceptRound і для
// рядка-попередження біля кнопки «Ремонт» в UI.
export function repairRisksBankruptcy(econ: EconomyState, roster: Roster, preset: DifficultyPreset = DEFAULT_PRESET): boolean {
  return readySoldiers(roster).length === 0 && econ.money - FIGHTER_REPAIR_COST < hirePrice(preset);
}

// Повернення на базу: миттєве (MVP-спрощення ADR-0032: без окремої фази дороги додому).
// п19.3: в ангар свого регіону; бій скидається, лише якщо повертається той, хто бився.
function returnToBase(state: InterceptState, geo: GeoState, f: Fighter): void {
  const wasInBattle = f.status === 'бій';
  f.status = 'на базі';
  f.pos = hangarPos(f.region, geo);
  f.targetId = null;
  if (wasInBattle) {
    state.activeProbeId = null;
    state.round = 0;
  }
  geoLog(state, geo, { type: 'fighter_returned', pos: hangarPos(f.region, geo), minute: geo.minute, ...tag(state, f, true) });
}

// Ремонт (гроші — П7.4, тут тіки): пошкоджений винищувач йде в ремонт і не може
// стартувати нове перехоплення до завершення (EARS, ADR-0032).
// п19.3: ремонт — на кожен перехоплювач окремо, в його ангарі; без fighterId — перший.
export function startRepair(state: InterceptState, geo: GeoState, econ: EconomyState, fighterId?: number): void {
  const f = fighterById(state, fighterId);
  if (f.status !== 'на базі') {
    throw new Error('Ремонт можливий лише ' + baseWhere(f));
  }
  if (f.hp >= FIGHTER_MAX_HP) {
    throw new Error('Перехоплювач не потребує ремонту');
  }
  spend(econ, FIGHTER_REPAIR_COST); // П7.4: гроші + тіки, патерн лікарні (ADR-0021)
  f.status = 'ремонт';
  f.pos = hangarPos(f.region, geo);
  f.repairTicksLeft = FIGHTER_REPAIR_TICKS;
  geoLog(state, geo, { type: 'fighter_repair_start', minute: geo.minute, ...tag(state, f) });
}

// п19.3: ремонт усіх перехоплювачів — за зростанням id.
export function repairTick(state: InterceptState, geo: GeoState): void {
  for (const f of state.fighters) {
    if (f.status !== 'ремонт') continue;
    f.repairTicksLeft! -= 1;
    if (f.repairTicksLeft! <= 0) {
      f.hp = FIGHTER_MAX_HP;
      f.status = 'на базі';
      delete f.repairTicksLeft;
      geoLog(state, geo, { type: 'fighter_repair_done', minute: geo.minute, ...tag(state, f) });
    }
  }
}

// Збите НЛО для шару geo/mission (П7.3): подія probe_shot_down — джерело місії падіння.
export function shotDownProbes(state: InterceptState): string[] {
  return state.log.filter((e) => e.type === 'probe_shot_down').map((e) => (e as { probeId: string }).probeId);
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
