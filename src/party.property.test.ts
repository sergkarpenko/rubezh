// src/party.property.test.ts
// Т.15 (ADR-0085): property-тести партії. fast-check генерує послідовність команд
// гравця на геосцені — тіки часу, вербування, наука, цех, екіпірування,
// перехоплення, місії авто-боєм, сейв і лоад посеред партії — і після кожної
// команди перевіряються твердження про стан партії. Сід фіксований (ADR-0003).

import { REGION_IDS, TRUST_MAX } from './core/regions';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Vec2 } from './core/combat';
import { WORLD_H, WORLD_W, advanceTime, geoDay, missionTargets, type Ufo } from './core/geo';
import { createEconomy, creditMissionBonus, economyTick } from './core/economy';
import {
  applyMissionResult,
  assignBotRoles,
  deployRoles,
  hireSoldier,
  hospitalTick,
  isBankrupt,
  missionSquad,
  readySoldiers,
} from './core/squad';
import {
  KEY_PROJECTS,
  WEAPON_PROJECTS,
  PROJECTS,
  PROJECT_CATALOG,
  awardTrophies,
  fireScientist,
  hireScientist,
  radarRange,
  researchTick,
  startProject,
} from './core/research';
import { ENEMY_ORDER, enemyKind, kindsForThreat, makeEnemy } from './core/enemies';
import {
  ARMOR_MAX_HP_BONUS,
  ITEM_IDS,
  OPTICS_ACCURACY_BONUS,
  WORKSHOP_CATALOG,
  deployConsumables,
  equipItem,
  installGunModule,
  itemUnlocked,
  orderItem,
  removeGunModule,
  removeLostEquipment,
  interceptorCount,
  orderInterceptor,
  settleConsumables,
  unequipItem,
  workshopTick,
  type ItemId,
  type ItemSlot,
} from './core/workshop';
import {
  FIGHTER_MAX_HP,
  FIGHTER_REPAIR_TICKS,
  MAX_FIGHTERS,
  assignFighter,
  fighterInBattle,
  hangarPos,
  interceptRound,
  interceptTick,
  repairTick,
  startIntercept,
  startRepair,
} from './core/intercept';
import { ASSAULT_THRESHOLDS, DIFFICULTY_MULTIPLIERS, THREAT_MAX, campaignTick, threatDelta, type DifficultyPreset } from './core/campaign';
import { GATE_RETRY_MINUTES, completeAssault, completeGate, createAssault, createGateMission, gateKeyDone } from './core/assault';
import { completeMission, createMission } from './core/mission';
import { FORGE_WEAPONS, isForgeWeapon, WEAPONS } from './core/weapons';
import { autoBattle } from './core/ai-bot';
import { createParty, deserializeParty, serializeParty, type Party } from './core/save';
import { awaitingRole, KILL_XP, MISSION_XP, RANK_ACCURACY_BONUS, RANK_HP_BONUS, rankOf, ROLE_RANK } from './core/career';

const RUN = { seed: 20261111, numRuns: 100 };
// п18.2: генератор бере й ключові протоколи та «Пробивний заряд» (у панелях до п18.5 сховані).
// п20.4 (ADR-0168): і протоколи та виріб зброї; видача зброї — equipItem (делегує equipWeapon)
const ALL_PROJECTS = [...PROJECTS, ...KEY_PROJECTS, ...WEAPON_PROJECTS];
const ALL_ITEMS: ItemId[] = [...ITEM_IDS, 'breach-charge', ...FORGE_WEAPONS];
const CHOICES = ['далека', 'середня', 'впритул', 'відступ'] as const;

// Команда: тип і два «сирі» числа — скільки часу минає або який за порядком об'єкт.
// Вага — як часто команда трапляється: часу більше за решту, бо наука, цех і зонди
// живуть добами, а до екіпірування партія доходить лише через науку і цех.
const WEIGHTS = {
  tick: 2,
  days: 3,
  wait: 3,
  hire: 1,
  scientist: 3,
  dismiss: 1,
  project: 3,
  order: 3,
  equip: 3,
  unequip: 2,
  loot: 2,
  key: 1,
  unlock: 0, // лише в дебюті OPENING_GATE
} as const;
// п19.3: buy — замовлення перехоплювача в «Кузні», assign — перепризначення ангара.
const WEIGHTS_AIR = { gun: 1, intercept: 3, round: 1, repair: 2, mission: 3, reload: 2, gate: 2, buy: 1, assign: 1 } as const;
type Kind = keyof typeof WEIGHTS | keyof typeof WEIGHTS_AIR;
const cmdArb = fc.record({
  t: fc.constantFrom(...Object.entries({ ...WEIGHTS, ...WEIGHTS_AIR }).flatMap(([kind, weight]) => Array<Kind>(weight).fill(kind as Kind))),
  n: fc.nat(95),
  i: fc.nat(11),
});
type Cmd = typeof cmdArb extends fc.Arbitrary<infer T> ? T : never;

// Розгін: дебют, що доводить партію до науки, цеху й екіпірування — випадкові команди
// самі доходять до них рідко. Генератор бере довільний початок дебюту (може й порожній)
// і номер протоколу: броня, око, гель або розширення лабораторії.
const OPENING = ['scientist', 'project', 'days', 'scientist', 'days', 'scientist', 'wait', 'order', 'wait', 'equip'] as const;
// п18.2 (аудит PR #513): номер протоколу 4 — дебют із трофеями: два «loot» по 4 трофеї кожного
// типу, далі той самий дебют — п'ятий відкритий протокол «Анатомія Розриву», замовлення і
// видача — «Пробивний заряд» (єдиний відкритий предмет).
const OPENING_CHARGE = ['loot', 'loot', ...OPENING] as const;
// п18.4: номер протоколу 5 — дебют із відкритою брамою. Ланцюжок ключових протоколів командами
// не встигає до загрози 100 (вимір: 90 точок — ≈ 30 діб трьох техномантів, партія без місій
// програє на ≈ 12-й добі), тож «unlock» записує ланцюжок узгоджено з обліком (точки і трофеї —
// подіями журналу науки); далі — атака брами і випадкові команди (штурми — з турелями).
const OPENING_GATE = ['unlock', 'gate', 'days', 'gate'] as const;

// Один тік партії — у тому порядку, що й partyTick шару відображення (src/main.ts).
// Т.16: у повітряному бою час заморожено — тік нічого не робить, як і в partyTick.
// п18.4 (ADR-0156): штурм, що чекає бою, — бій замість тіку; поріг на цьому тіку — бій одразу.
function tick(p: Party): void {
  if (fighterInBattle(p.intercept)) return; // п19.3: бій будь-якого перехоплювача
  if (assault(p)) return;
  const preset = p.campaign.preset;
  advanceTime(p.geo, 1, radarRange(p.research)); // п18.2
  economyTick(p.econ, p.geo, preset);
  researchTick(p.research, p.econ, p.geo, preset);
  workshopTick(p.workshop, p.intercept, p.geo);
  hospitalTick(p.roster);
  interceptTick(p.intercept, p.geo);
  repairTick(p.intercept, p.geo);
  campaignTick({ geo: p.geo, roster: p.roster, econ: p.econ }, p.campaign);
  assault(p);
}

// п18.4: бій кампанії від запуску до підсумку — у тому порядку, що й src/ui/battle.ts (finish).
// п18.6 (ADR-0158): hold — бот тримає позицію в дозорі, як політика кампанії бота партії.
function campaignBattle(p: Party, op: 'штурм' | 'брама', hold = false): void {
  const squad = missionSquad(p.roster);
  const roles = deployRoles(p.roster, squad) ?? undefined;
  const opts = { squad, items: deployConsumables(p.workshop, squad), ...(roles ? { roles } : {}) };
  const m = op === 'штурм' ? createAssault(p, opts) : createGateMission(p, opts);
  if (op === 'штурм') expect(m.state.units.filter((u) => u.turret).length, 'турелі штурму').toBe(gateKeyDone(p) ? 2 : 0);
  const fought = autoBattle(m.state, undefined, undefined, hold).outcome;
  const outcome = fought === 'триває' ? 'поразка' : fought;
  const aftermath = applyMissionResult(p.roster, m.state);
  assignBotRoles(p.roster);
  removeLostEquipment(p.workshop, aftermath.lost);
  settleConsumables(p.workshop, aftermath.survivors, m.state.items);
  if (op === 'штурм') completeAssault(p, outcome === 'перемога' ? 'перемога' : 'поразка');
  else completeGate(p, outcome);
  awardTrophies(p.research, m.state, outcome);
}

// Штурм бази одразу, як startPendingAssault у src/main.ts; без боєготових — програно без бою. true — бій був.
function assault(p: Party): boolean {
  if (p.campaign.status !== 'триває' || !p.campaign.assaultPending || fighterInBattle(p.intercept)) return false;
  if (readySoldiers(p.roster).length === 0) {
    completeAssault(p, 'поразка');
    return false;
  }
  campaignBattle(p, 'штурм');
  return true;
}

// Місія від запуску до підсумку — у тому порядку, що й src/ui/battle.ts; бій веде авто-бій.
function mission(p: Party, i: number): void {
  const targets = missionTargets(p.geo);
  const squad = missionSquad(p.roster);
  const roles = deployRoles(p.roster, squad) ?? undefined; // п16.3: ролі загону — як у бота партії
  const m = createMission(p.geo, targets[i % (targets.length || 1)]?.id ?? '', {
    squad,
    items: deployConsumables(p.workshop, squad),
    roles,
    threat: p.campaign.threat, // п18.3: склад ворогів за загрозою — як src/ui/battle.ts
  });
  // п18.3: склад ворогів — лише з типів, доступних на загрозі партії
  const avail = kindsForThreat(p.campaign.threat);
  for (const u of m.state.units)
    if (u.side === 'alien') expect(avail.includes(enemyKind(u)), 'склад за загрозою ' + p.campaign.threat).toBe(true);
  const fought = autoBattle(m.state, undefined, undefined, i % 2 === 1).outcome; // п18.6: непарний i — дозор бота
  const outcome = fought === 'триває' ? 'поразка' : fought;
  const aftermath = applyMissionResult(p.roster, m.state);
  assignBotRoles(p.roster);
  removeLostEquipment(p.workshop, aftermath.lost);
  settleConsumables(p.workshop, aftermath.survivors, m.state.items);
  completeMission(p.geo, m.briefing.ufoId, outcome);
  awardTrophies(p.research, m.state, outcome); // п18.2
  if (outcome === 'перемога') creditMissionBonus(p.econ, m.briefing.kind, p.campaign.preset);
}

// Ключ запису екіпірування за предметом (п18.2: заряд — «charge»).
const slotOf = (id: ItemId): ItemSlot => (id === 'breach-charge' ? 'charge' : (id as ItemSlot));

// Виконати команду. Три рази з чотирьох вона бере придатний об'єкт (досліджений
// предмет, протокол із виконаною передумовою, зонд у повітрі), раз — будь-який, тож
// серед команд є й недозволені: така кидає помилку. Повертає партію (після лоаду — нову).
function apply(p: Party, c: Cmd): Party {
  if (c.t === 'reload') return deserializeParty(serializeParty(p));
  const { econ, research, workshop, intercept, geo } = p;
  const preset = p.campaign.preset;
  const pick = <T>(fit: T[], any: readonly T[], n = c.i): T | undefined => {
    const from = fit.length > 0 && n % 4 !== 3 ? fit : any;
    return from[n % (from.length || 1)];
  };
  const item = (fit: (id: ItemId) => boolean): ItemId => pick(ALL_ITEMS.filter(fit), ALL_ITEMS)!;
  // екіпірують найчастіше тих, хто піде в бій (перші троє боєготових), знімають — з тих, хто щось носить
  const soldiers = p.roster.soldiers;
  const fighter = pick(soldiers.slice(0, 3), soldiers, c.n);
  const equipped = pick(
    soldiers.filter((s) => workshop.equipped[s.id]),
    soldiers,
    c.n
  );
  const researched = (id: ItemId): boolean => itemUnlocked(research, id);
  const inStore = (id: ItemId): boolean => workshop.store[id] > 0;
  const wears = (id: ItemId): boolean => {
    const eq = workshop.equipped[equipped?.id ?? ''];
    return isForgeWeapon(id) ? eq?.weapon === id : eq?.[slotOf(id)] === true;
  };
  const flying = (): Ufo[] => geo.ufos.filter((u) => u.detected && u.status === 'летить');
  const open = ALL_PROJECTS.filter(
    (d) => !research.completed.includes(d.id) && (!d.prerequisite || research.completed.includes(d.prerequisite))
  );
  const ticks = (count: number, until: () => boolean = () => false): void => {
    for (let k = 0; k < count && !until(); k++) tick(p);
  };
  const finished = research.completed.length + workshop.queue.length;
  const started = [...research.active.map((a) => a.id), ...research.completed];
  // Раунд повітряного бою з ростером партії (як panels.ts і бот). Т.26 (ADR-0090):
  // ремонт, що стартував сам у цьому раунді, не робить партію банкрутом.
  const round = (choice: (typeof CHOICES)[number]): void => {
    const starts = intercept.log.filter((e) => e.type === 'fighter_repair_start').length;
    const solvent = !isBankrupt(econ, p.roster, preset);
    interceptRound(intercept, geo, choice, econ, preset, p.roster);
    const auto = intercept.log.filter((e) => e.type === 'fighter_repair_start').length > starts;
    if (solvent && auto) expect(isBankrupt(econ, p.roster, preset), 'авторемонт довів до банкрутства').toBe(false);
  };
  const commands: Record<Exclude<Kind, 'reload'>, () => void> = {
    tick: () => ticks(1 + (c.n % 12)),
    days: () => ticks(48 * (1 + (c.n % 3))),
    // «+1 доба», доки не завершиться протокол або замовлення цеху (не довше 10 діб)
    wait: () => ticks(480, () => research.completed.length + workshop.queue.length !== finished),
    hire: () => hireSoldier(econ, p.roster, preset),
    scientist: () => hireScientist(econ, research, preset),
    dismiss: () => fireScientist(research, pick([], research.scientists)?.id ?? ''),
    project: () => startProject(econ, research, pick(open, ALL_PROJECTS)!.id, preset),
    order: () => orderItem(econ, workshop, research, item(researched), preset),
    equip: () => fighter && equipItem(workshop, fighter, item(inStore)),
    unequip: () => equipped && unequipItem(workshop, equipped, item(wears)),
    gun: () => {
      const f = pick(intercept.fighters, intercept.fighters, c.n)!; // п19.3: модуль — на обраний перехоплювач
      (f.gunModule ? removeGunModule : installGunModule)(workshop, intercept, f.id);
    },
    buy: () => orderInterceptor(econ, workshop, intercept, REGION_IDS[c.n % REGION_IDS.length], preset),
    assign: () => assignFighter(intercept, geo, pick(intercept.fighters, intercept.fighters, c.n)!.id, REGION_IDS[c.i % REGION_IDS.length]),
    // три рази з чотирьох — «полювання»: «+1 тік», доки радар не покаже зонд у повітрі
    // (не довше двох діб), запуск, погоня до зустрічі і до п'яти раундів бою
    intercept: () => {
      // п19.3: перехоплювач — за номером команди; полюють на зонд, за яким ще ніхто не летить
      const f = pick(intercept.fighters, intercept.fighters, c.n)!;
      const free = (): Ufo[] => flying().filter((u) => !intercept.fighters.some((x) => x.targetId === u.id));
      const hunt = c.n % 4 !== 3 && f.status === 'на базі' && f.hp === FIGHTER_MAX_HP;
      // п19.3 (аудит PR #522): за c.i % 3 === 2 і вільного другого — чекати двох зондів і підняти обидва
      const g = intercept.fighters.find((x) => x !== f && x.status === 'на базі' && x.hp === FIGHTER_MAX_HP);
      const pair = hunt && c.i % 3 === 2 && g !== undefined;
      if (hunt) ticks(96, () => free().length > (pair ? 1 : 0));
      if (hunt && free().length === 0) return;
      const second = pair ? free()[1] : undefined;
      startIntercept(intercept, geo, (hunt ? free()[0] : pick(flying(), geo.ufos))?.id ?? '', f.id);
      if (second && g) {
        startIntercept(intercept, geo, second.id, g.id);
        ticks(6); // обидва в повітрі: бій одного — погоня другого чекає
      }
      // за c.i % 3 === 2 погоня лишається в повітрі — наступні команди йдуть під час неї
      if (hunt && c.i % 3 !== 2) ticks(12, () => f.status !== 'погоня');
      for (let k = c.n % 6; hunt && c.i % 3 !== 2 && k > 0 && f.status === 'бій'; k--) round(CHOICES[c.i % 3]);
    },
    round: () => round(CHOICES[c.i % CHOICES.length]),
    repair: () => startRepair(intercept, geo, econ, pick(intercept.fighters, intercept.fighters, c.n)!.id),
    mission: () => mission(p, c.i),
    gate: () => campaignBattle(p, 'брама', c.i % 2 === 1), // п18.4: фінал; брама закрита — відмова ядра; п18.6: непарний i — дозор
    unlock: () => {
      for (const d of KEY_PROJECTS) {
        research.completed.push(d.id);
        research.log.push({ type: 'points', day: geoDay(geo), amount: d.points }, { type: 'trophies', gained: { ...d.trophies } });
      }
    },
    // п18.4: наступний ключовий протокол ланцюжка (гравець обирає його в панелі «Дослідження»)
    key: () => startProject(econ, research, (KEY_PROJECTS.find((d) => !started.includes(d.id)) ?? KEY_PROJECTS[0]).id, preset),
    // п18.2 (аудит PR #513): трофеї з випадкових місій рідко доходять до ключових протоколів —
    // команда нараховує їх тим самим awardTrophies, як за виграний бій з 1–4 ворогами кожного типу
    loot: () =>
      void awardTrophies(
        research,
        {
          units: ENEMY_ORDER.flatMap((k) =>
            Array.from({ length: 1 + ((c.n + c.i) % 4) }, (_, j) => ({ ...makeEnemy(k, k + j, j, { x: 0, y: 0 }), alive: false }))
          ),
        },
        'перемога'
      ),
  };
  commands[c.t]();
  return p;
}

// Що в стані партії порушено (порожній список — усе гаразд).
function broken(p: Party): string[] {
  const { geo, econ, roster, research, workshop, campaign } = p;
  const bad: string[] = [];
  const must = (ok: boolean, what: string): void => void (ok || bad.push(what));
  const inWorld = (c: Vec2): boolean => c.x >= 0 && c.y >= 0 && c.x < WORLD_W && c.y < WORLD_H;
  const day = geoDay(geo);

  // Геосцена: зонди в межах світу й ліміту, журнал іде за часом.
  must(
    geo.ufos.filter((u) => u.status !== 'збитий').length <= geo.maxUfos && new Set(geo.ufos.map((u) => u.id)).size === geo.ufos.length,
    'зонди: ліміт або повтор id'
  );
  for (const u of geo.ufos) must(inWorld(u.pos) && inWorld(u.target) && u.landedTicksLeft >= 0, 'зонд ' + u.id + ' поза світом');
  const cleared = new Set(geo.log.map((e) => (e.type === 'mission_won' ? e.ufoId : '')));
  must(!geo.ufos.some((u) => cleared.has(u.id)), 'зонд лишився після виграної місії');
  must(
    geo.log.every((e, i) => i === 0 || geo.log[i - 1].minute <= e.minute),
    'журнал геосцени не за часом'
  );

  // Гроші: баланс дорівнює стартовій сумі плюс усе, що записано в журналі економіки.
  const ledger = econ.log.reduce((sum, e) => sum + (e.type === 'spend' ? -e.amount : e.amount), createEconomy(campaign.preset).money);
  must(econ.money === ledger && econ.money >= 0 && Number.isInteger(econ.money), 'кредити ' + econ.money + ', за журналом ' + ledger);
  must(econ.lastAllowanceDay === day - 1 && research.lastSalaryDay === day - 1, 'дотація або зарплата не за добу ' + day);

  // Ростер: поранений — лише в лікарні; характеристики — база плюс те, що надягнуто.
  const ids = new Set(roster.soldiers.map((s) => s.id));
  must(ids.size === roster.soldiers.length, 'повтор id оперативника');
  for (const s of roster.soldiers) {
    const eq = workshop.equipped[s.id];
    must(s.alive && s.hp > 0 && s.hp <= s.maxHp, s.id + ': hp ' + s.hp + '/' + s.maxHp);
    must(s.hp === s.maxHp || roster.hospital[s.id] !== undefined, s.id + ': поранений поза лікарнею');
    // п16.2 (ADR-0147): кар'єра є в кожного; досвід — місії й зараховані вбивства;
    // прирости звання — поверх бази й екіпірування.
    const career = roster.careers[s.id];
    must(career !== undefined, s.id + ": без кар'єри");
    if (career === undefined) continue;
    must(
      career.killsCounted === s.kills && career.xp === career.missions * MISSION_XP + career.killsCounted * KILL_XP,
      s.id + ': досвід ' + career.xp + ' не з місій і вбивств'
    );
    const rank = rankOf(career.xp);
    // п16.3 (ADR-0147 п. 12): роль — лише зі звання «Боєць»; після місії ніхто не чекає ролі
    must(career.role === null || rank >= ROLE_RANK, s.id + ': роль у рекрута');
    must(!awaitingRole(career), s.id + ': чекає ролі після місії');
    const maxHp =
      Math.round(10 * DIFFICULTY_MULTIPLIERS[campaign.preset].hpBonusMultiplier) +
      (eq?.armor ? ARMOR_MAX_HP_BONUS : 0) +
      rank * RANK_HP_BONUS;
    const accuracy = 0.6 + (eq?.optics ? OPTICS_ACCURACY_BONUS : 0) + rank * RANK_ACCURACY_BONUS;
    // п20.4 (ADR-0168): зброя ростеру — об'єкт каталогу за слотом екіпірування (без слоту — «Гарт»)
    must(JSON.stringify(s.weapon) === JSON.stringify(WEAPONS[eq?.weapon ?? 'rifle']), s.id + ': зброя ' + s.weapon.name);
    must(
      s.maxHp === maxHp && Math.abs(s.firingAccuracy - accuracy) < 1e-9,
      s.id + ': характеристики не відповідають екіпіруванню і званню'
    );
  }
  must(Object.keys(roster.careers).length === ids.size, "кар'єра без оперативника");
  must(
    Object.entries(roster.hospital).every(([id, left]) => ids.has(id) && left >= 1),
    'лікарня: чужий запис або нуль тіків'
  );

  // Наука: слоти, передумови, і жодна наукова точка не зникає й не береться нізвідки.
  const started = [...research.active.map((a) => a.id), ...research.completed];
  must(research.active.length <= research.slots && new Set(started).size === started.length, 'протоколи: слоти або повтор');
  must(research.slots === (research.completed.includes('lab-extension') ? 3 : 2), 'слоти лабораторії: ' + research.slots);
  for (const id of started) {
    const before = PROJECT_CATALOG[id].prerequisite;
    must(before === undefined || research.completed.includes(before), 'протокол ' + id + ' без передумови');
  }
  must(
    research.active.every((a) => a.invested >= 0 && a.invested < PROJECT_CATALOG[a.id].points),
    'активний протокол уже заповнено'
  );
  must(research.pool === 0 || research.active.length === 0, 'потік лежить без діла при активному протоколі');
  const earned = research.log.reduce((sum, e) => sum + (e.type === 'points' ? e.amount : 0), 0);
  const placed =
    research.pool +
    research.active.reduce((sum, a) => sum + a.invested, 0) +
    research.completed.reduce((sum, id) => sum + PROJECT_CATALOG[id].points, 0);
  must(earned === placed, 'наукові точки: нараховано ' + earned + ', на обліку ' + placed);

  // Цех: кожен виготовлений предмет — на складі, на оперативникові, на перехоплювачі
  // або (лише витратник) втрачений із загиблим; витратники ще й витрачаються в бою.
  for (const id of ALL_ITEMS) {
    const made = workshop.log.filter((e) => e.type === 'produced' && e.id === id).length;
    const slot = slotOf(id);
    const worn =
      id === 'gun-module'
        ? p.intercept.fighters.filter((f) => f.gunModule).length
        : isForgeWeapon(id) // п20.4: зброя — свій слот; із загиблим повертається на склад
          ? Object.values(workshop.equipped).filter((eq) => eq.weapon === id).length
          : Object.values(workshop.equipped).filter((eq) => eq[slot]).length;
    const lost = workshop.log.filter((e) => e.type === 'equipment_lost' && e.items.includes(slot)).length;
    // п18.4: програний штурм бази забирає половину складу — подія store_lost
    const raided = workshop.log.reduce((sum, e) => sum + (e.type === 'store_lost' ? (e.lost[id] ?? 0) : 0), 0);
    const kept = workshop.store[id] + worn + lost + raided;
    const usedUp = id === 'medkit' || id === 'grenade' || id === 'breach-charge';
    must(workshop.store[id] >= 0 && (usedUp ? kept <= made : kept === made), id + ': виготовлено ' + made + ', на обліку ' + kept);
  }
  // Т.28 (ADR-0091): броня й око із загиблим не гинуть — у подіях втрати лише витратники.
  must(
    workshop.log.every((e) => e.type !== 'equipment_lost' || e.items.every((k) => k === 'medkit' || k === 'grenade' || k === 'charge')),
    'броня чи око загинули разом з оперативником'
  );
  must(
    workshop.queue.every((o) => o.ticksLeft >= 1),
    'замовлення цеху з нулем тіків'
  );
  must(
    Object.entries(workshop.equipped).every(
      ([id, eq]) => ids.has(id) && (eq.armor || eq.optics || eq.medkit || eq.grenade || eq.charge || eq.weapon !== undefined)
    ),
    'екіпірування без власника або порожнє'
  );

  // п18.2 (ADR-0153 п. 9–11): трофеї — нараховане за перемоги мінус списане стартами
  // протоколів і замовленнями цеху; не менше нуля.
  for (const k of ENEMY_ORDER) {
    const gained = research.log.reduce((sum, e) => sum + (e.type === 'trophies' ? (e.gained[k] ?? 0) : 0), 0);
    const spentP = started.reduce((sum, id) => sum + (PROJECT_CATALOG[id].trophies?.[k] ?? 0), 0);
    const spentW = workshop.log.reduce((sum, e) => sum + (e.type === 'order' ? (WORKSHOP_CATALOG[e.id].trophies?.[k] ?? 0) : 0), 0);
    must(research.trophies[k] >= 0 && research.trophies[k] === gained - spentP - spentW, 'трофеї ' + k + ': ' + research.trophies[k]);
  }

  // п19.3: перехоплювачі — 1..3 разом із замовленими, id за зростанням, у бою — не більше одного,
  // на один зонд — один; на базі й у ремонті — в клітинці ангара свого регіону.
  const fs = p.intercept.fighters;
  must(
    fs.length >= 1 && interceptorCount(workshop, p.intercept) <= MAX_FIGHTERS && fs.every((x, i) => i === 0 || x.id > fs[i - 1].id),
    'перехоплювачі: ' + fs.map((x) => x.id).join(',')
  );
  const battling = fs.filter((x) => x.status === 'бій');
  const chased = fs.filter((x) => x.targetId !== null).map((x) => x.targetId);
  must(battling.length <= 1 && new Set(chased).size === chased.length, 'перехоплювачі: бій або ціль удвох');
  must(
    workshop.log.filter((e) => e.type === 'interceptor_produced').length === fs.length - 1,
    'перехоплювачі: виготовлено ' + workshop.log.filter((e) => e.type === 'interceptor_produced').length
  );
  for (const x of fs) {
    const home = hangarPos(x.region, geo);
    if (x.status === 'на базі' || x.status === 'ремонт')
      must(
        (x.pos.x === home.x && x.pos.y === home.y) || (x.id === 1 && x.pos.x === 0 && x.pos.y === 0),
        'перехоплювач ' + x.id + ' не в ангарі'
      );
  }
  // Перехоплювач: статус, ціль і ремонт узгоджені.
  const f = battling[0] ?? fs[0];
  for (const x of fs) {
    must(x.hp >= 0 && x.hp <= FIGHTER_MAX_HP && inWorld(x.pos), 'перехоплювач: hp ' + x.hp);
    const inAir = x.status === 'погоня' || x.status === 'бій';
    must(inAir === (x.targetId !== null), 'перехоплювач ' + x.id + ': ' + x.status);
    const left = x.repairTicksLeft;
    must(x.status === 'ремонт' ? left !== undefined && left >= 1 && left <= FIGHTER_REPAIR_TICKS : left === undefined, 'ремонт: ' + left);
  }
  must((battling.length === 1) === (p.intercept.activeUfoId !== null), 'перехоплювач у бою і активний зонд');
  for (const u of geo.ufos) must((u.status === 'збитий') === (p.intercept.ufoHp[u.id] === 0), 'зонд ' + u.id + ': статус і HP у повітрі');
  // Т.16: бій іде там, де зустрілись, — перехоплювач у клітинці зонда, зонд у повітрі.
  const target = geo.ufos.find((u) => u.id === p.intercept.activeUfoId);
  must(
    f.status !== 'бій' || (target !== undefined && target.status === 'летить' && target.pos.x === f.pos.x && target.pos.y === f.pos.y),
    'повітряний бій: зонд ' +
      (target ? target.status + ' у ' + target.pos.x + ',' + target.pos.y : 'зник') +
      ', перехоплювач у ' +
      f.pos.x +
      ',' +
      f.pos.y
  );

  // п18.4 (ADR-0156): штурм відбувся одразу (жодного очікування між командами), порогів не більше трьох
  // і в порядку 60 / 75 / 90; турель — поза ростером; пауза брами — не довше доби; перемога — лише
  // з подією фіналу після «Ключа брами».
  const assaults = geo.log.filter((e) => e.type === 'base_assault').map((e) => (e as { threshold: number }).threshold);
  must(
    campaign.assaultPending !== true &&
      (campaign.assaults ?? 0) === assaults.length &&
      assaults.every((t, i) => t === ASSAULT_THRESHOLDS[i]) &&
      geo.log.filter((e) => e.type === 'assault_won' || e.type === 'assault_lost').length === assaults.length,
    'штурми: ' + JSON.stringify(assaults) + ', очікує ' + campaign.assaultPending
  );
  must(!roster.soldiers.some((s) => /^t\d+$/.test(s.id)), 'турель у ростері');
  const gateLost = geo.log.filter((e) => e.type === 'gate_lost').at(-1);
  must((campaign.gateReadyAt ?? 0) === (gateLost ? gateLost.minute + GATE_RETRY_MINUTES : 0), 'пауза брами — не доба після gate_lost');
  must(
    (campaign.status === 'перемога') === geo.log.some((e) => e.type === 'campaign_victory') &&
      (campaign.status !== 'перемога' || (gateKeyDone(p) && campaign.victoryDay !== null)),
    'перемога без фіналу'
  );

  // п18.3 (ADR-0153 п. 13, 15): перемоги до фінальної місії (п18.4) немає; загроза — ціле 0–100 і
  // дорівнює повтору threatDelta по врахованих подіях журналу (межі 0 і 100, зупинка на 100);
  // поразка — рівно на 100; рахунок і доба поразки — лише з кінцем партії.
  let replay = 0;
  for (let i = 0; i < campaign.threatCursor && replay < THREAT_MAX; i++)
    replay = Math.max(0, Math.min(THREAT_MAX, replay + threatDelta(geo.log, i)));
  must(
    Number.isInteger(campaign.threat) &&
      campaign.threat === replay &&
      campaign.threatCursor <= geo.log.length &&
      (campaign.status === 'поразка') === (campaign.threat === THREAT_MAX) &&
      (campaign.score !== null) === (campaign.status !== 'триває') &&
      (campaign.defeatDay !== null) === (campaign.status === 'поразка') &&
      (campaign.defeatDay === null || campaign.defeatDay <= day),
    'кампанія на добу ' + day + ': загроза ' + campaign.threat + ' (повтор ' + replay + '), ' + campaign.status
  );

  // п19.2 (ADR-0159 п. 11): довіра регіону — ціле 0–100, дорівнює 100 + Σ змін 'region_trust' у журналі;
  // «вийшов» ⇔ довіра 0 ⇔ рівно одна подія 'region_out'; курсор довіри — у межах журналу.
  for (const id of REGION_IDS) {
    const r = campaign.regions[id];
    let t = TRUST_MAX;
    for (const e of geo.log) if (e.type === 'region_trust' && e.region === id) t += e.delta;
    const outs = geo.log.filter((e) => e.type === 'region_out' && e.region === id).length;
    must(
      Number.isInteger(r.trust) &&
        r.trust >= 0 &&
        r.trust <= TRUST_MAX &&
        r.trust === t &&
        r.out === (r.trust === 0) &&
        outs === (r.out ? 1 : 0),
      'регіон ' + id + ': довіра ' + r.trust + ' (повтор ' + t + '), вийшов ' + r.out + ', подій виходу ' + outs
    );
  }
  must(campaign.trustCursor <= geo.log.length, 'курсор довіри поза журналом');
  return bad;
}

function play(seed: number, preset: DifficultyPreset, cmds: Cmd[], check: boolean): Party {
  let p = createParty(seed, preset);
  let score: string | undefined;
  for (const c of cmds) {
    const before = check ? serializeParty(p) : '';
    try {
      p = apply(p, c);
    } catch (e) {
      if ((e as Error).constructor !== Error) throw e; // TypeError тощо — дефект, а не відмова
      if (check) expect(serializeParty(p), 'відмова змінила партію: ' + c.t).toBe(before);
    }
    if (!check) continue;
    expect(broken(p), 'після команди ' + JSON.stringify(c)).toEqual([]);
    if (p.campaign.score !== null)
      expect(JSON.stringify(p.campaign.score), 'рахунок перемоги змінився').toBe((score ??= JSON.stringify(p.campaign.score)));
  }
  return p;
}

const partyArb = fc
  .tuple(
    fc.nat(),
    fc.constantFrom<DifficultyPreset>('легкий', 'норма', 'складний'),
    fc.nat(OPENING_CHARGE.length),
    fc.nat(5),
    fc.array(cmdArb, { maxLength: 80, size: 'max' })
  )
  .map(([seed, preset, length, protocol, cmds]): [number, DifficultyPreset, Cmd[]] => {
    const opening = (protocol === 5 ? OPENING_GATE : protocol === 4 ? OPENING_CHARGE : OPENING)
      .slice(0, protocol === 5 ? OPENING_GATE.length : length)
      .map((t) => ({ t, n: protocol === 4 ? 3 : 0, i: protocol }));
    return [seed, preset, [...opening, ...cmds]];
  });

// Сто партій на тест: локально ≈ 1,5 с, у CI під покриттям — до 6–7 с на повільному
// раннері, понад типові 5 с vitest (PR #293). Ліміт — із запасом, сід фіксований.
const PARTY_TIMEOUT = 30_000;

describe('property: партія під випадковими командами', () => {
  it(
    'жодна послідовність команд не ламає стан партії; відмова нічого не змінює',
    () => {
      fc.assert(
        fc.property(partyArb, ([seed, preset, cmds]) => void play(seed, preset, cmds, true)),
        RUN
      );
    },
    PARTY_TIMEOUT
  );

  it(
    'сейв і лоад у будь-який момент не змінюють подальшої партії (ADR-0003/0026)',
    () => {
      fc.assert(
        fc.property(partyArb, ([seed, preset, cmds]) => {
          const json = serializeParty(play(seed, preset, cmds, false));
          const straight = cmds.filter((c) => c.t !== 'reload');
          expect(serializeParty(play(seed, preset, straight, false))).toBe(json);
          expect(serializeParty(deserializeParty(json))).toBe(json);
        }),
        RUN
      );
    },
    PARTY_TIMEOUT
  );
});
