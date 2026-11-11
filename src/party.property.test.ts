// src/party.property.test.ts
// Т.15 (ADR-0085): property-тести партії. fast-check генерує послідовність команд
// гравця на геосцені — тіки часу, вербування, наука, цех, екіпірування,
// перехоплення, місії авто-боєм, сейв і лоад посеред партії — і після кожної
// команди перевіряються твердження про стан партії. Сід фіксований (ADR-0003).

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Vec2 } from './core/combat';
import { WORLD_H, WORLD_W, advanceTime, geoDay, missionTargets, type Ufo } from './core/geo';
import { createEconomy, creditMissionBonus, economyTick } from './core/economy';
import { applyMissionResult, hireSoldier, hospitalTick, missionSquad } from './core/squad';
import { PROJECTS, PROJECT_CATALOG, fireScientist, hireScientist, researchTick, startProject } from './core/research';
import {
  ARMOR_MAX_HP_BONUS,
  ITEM_IDS,
  OPTICS_ACCURACY_BONUS,
  deployConsumables,
  equipItem,
  installGunModule,
  orderItem,
  removeGunModule,
  removeLostEquipment,
  settleConsumables,
  unequipItem,
  workshopTick,
  type ItemId,
  type SoldierEquipment,
} from './core/workshop';
import {
  FIGHTER_MAX_HP,
  FIGHTER_REPAIR_TICKS,
  interceptRound,
  interceptTick,
  repairTick,
  startIntercept,
  startRepair,
} from './core/intercept';
import { DIFFICULTY_MULTIPLIERS, VICTORY_DAY, campaignTick, type DifficultyPreset } from './core/campaign';
import { completeMission, createMission } from './core/mission';
import { autoBattle } from './core/ai-bot';
import { createParty, deserializeParty, serializeParty, type Party } from './core/save';

const RUN = { seed: 20261111, numRuns: 100 };
const CHOICES = ['далека', 'середня', 'впритул', 'відступ'] as const;

// Команда: тип і два «сирі» числа — скільки часу минає або який за порядком об'єкт.
// Вага — як часто команда трапляється: часу більше за решту, бо наука, цех і зонди
// живуть добами, а до екіпірування партія доходить лише через науку і цех.
const WEIGHTS = { tick: 2, days: 3, wait: 3, hire: 1, scientist: 3, dismiss: 1, project: 3, order: 3, equip: 3, unequip: 2 } as const;
const WEIGHTS_AIR = { gun: 1, intercept: 3, round: 1, repair: 2, mission: 3, reload: 2 } as const;
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

// Один тік партії — у тому порядку, що й partyTick шару відображення (src/main.ts).
// Т.16: у повітряному бою час заморожено — тік нічого не робить, як і в partyTick.
function tick(p: Party): void {
  if (p.intercept.fighter.status === 'бій') return;
  const preset = p.campaign.preset;
  advanceTime(p.geo, 1);
  economyTick(p.econ, p.geo, preset);
  researchTick(p.research, p.econ, p.geo, preset);
  workshopTick(p.workshop);
  hospitalTick(p.roster);
  interceptTick(p.intercept, p.geo);
  repairTick(p.intercept, p.geo);
  campaignTick({ geo: p.geo, roster: p.roster, econ: p.econ }, p.campaign);
}

// Місія від запуску до підсумку — у тому порядку, що й src/ui/battle.ts; бій веде авто-бій.
function mission(p: Party, i: number): void {
  const targets = missionTargets(p.geo);
  const squad = missionSquad(p.roster);
  const m = createMission(p.geo, targets[i % (targets.length || 1)]?.id ?? '', { squad, items: deployConsumables(p.workshop, squad) });
  const fought = autoBattle(m.state).outcome;
  const outcome = fought === 'триває' ? 'поразка' : fought;
  const aftermath = applyMissionResult(p.roster, m.state);
  removeLostEquipment(p.workshop, aftermath.lost);
  settleConsumables(p.workshop, aftermath.survivors, m.state.items);
  completeMission(p.geo, m.briefing.ufoId, outcome);
  if (outcome === 'перемога') creditMissionBonus(p.econ, m.briefing.kind, p.campaign.preset);
}

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
  const item = (fit: (id: ItemId) => boolean): ItemId => pick(ITEM_IDS.filter(fit), ITEM_IDS)!;
  // екіпірують найчастіше тих, хто піде в бій (перші троє боєготових), знімають — з тих, хто щось носить
  const soldiers = p.roster.soldiers;
  const fighter = pick(soldiers.slice(0, 3), soldiers, c.n);
  const equipped = pick(
    soldiers.filter((s) => workshop.equipped[s.id]),
    soldiers,
    c.n
  );
  const researched = (id: ItemId): boolean => research.completed.includes(id);
  const inStore = (id: ItemId): boolean => workshop.store[id] > 0;
  const wears = (id: ItemId): boolean => workshop.equipped[equipped?.id ?? '']?.[id as keyof SoldierEquipment] === true;
  const flying = (): Ufo[] => geo.ufos.filter((u) => u.detected && u.status === 'летить');
  const open = PROJECTS.filter(
    (d) => !research.completed.includes(d.id) && (!d.prerequisite || research.completed.includes(d.prerequisite))
  );
  const ticks = (count: number, until: () => boolean = () => false): void => {
    for (let k = 0; k < count && !until(); k++) tick(p);
  };
  const finished = research.completed.length + workshop.queue.length;
  const commands: Record<Exclude<Kind, 'reload'>, () => void> = {
    tick: () => ticks(1 + (c.n % 12)),
    days: () => ticks(48 * (1 + (c.n % 3))),
    // «+1 доба», доки не завершиться протокол або замовлення цеху (не довше 10 діб)
    wait: () => ticks(480, () => research.completed.length + workshop.queue.length !== finished),
    hire: () => hireSoldier(econ, p.roster, preset),
    scientist: () => hireScientist(econ, research, preset),
    dismiss: () => fireScientist(research, pick([], research.scientists)?.id ?? ''),
    project: () => startProject(econ, research, pick(open, PROJECTS)!.id, preset),
    order: () => orderItem(econ, workshop, research, item(researched), preset),
    equip: () => fighter && equipItem(workshop, fighter, item(inStore)),
    unequip: () => equipped && unequipItem(workshop, equipped, item(wears)),
    gun: () => (intercept.fighter.gunModule ? removeGunModule : installGunModule)(workshop, intercept),
    // три рази з чотирьох — «полювання»: «+1 тік», доки радар не покаже зонд у повітрі
    // (не довше двох діб), запуск, погоня до зустрічі і до п'яти раундів бою
    intercept: () => {
      const f = intercept.fighter;
      const hunt = c.n % 4 !== 3 && f.status === 'на базі' && f.hp === FIGHTER_MAX_HP;
      if (hunt) ticks(96, () => flying().length > 0);
      if (hunt && flying().length === 0) return;
      startIntercept(intercept, geo, (hunt ? flying()[0] : pick(flying(), geo.ufos))?.id ?? '');
      if (hunt) ticks(12, () => f.status !== 'погоня');
      for (let k = c.n % 6; hunt && k > 0 && f.status === 'бій'; k--) interceptRound(intercept, geo, CHOICES[c.i % 3], econ, preset);
    },
    round: () => interceptRound(intercept, geo, CHOICES[c.i % CHOICES.length], econ, preset),
    repair: () => startRepair(intercept, geo, econ),
    mission: () => mission(p, c.i),
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
    const maxHp = Math.round(10 * DIFFICULTY_MULTIPLIERS[campaign.preset].hpBonusMultiplier) + (eq?.armor ? ARMOR_MAX_HP_BONUS : 0);
    const accuracy = 0.6 + (eq?.optics ? OPTICS_ACCURACY_BONUS : 0);
    must(s.maxHp === maxHp && Math.abs(s.firingAccuracy - accuracy) < 1e-9, s.id + ': характеристики не відповідають екіпіруванню');
  }
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
  // або втрачений із загиблим; витратники ще й витрачаються в бою.
  for (const id of ITEM_IDS) {
    const made = workshop.log.filter((e) => e.type === 'produced' && e.id === id).length;
    const slot = id as keyof SoldierEquipment;
    const worn =
      id === 'gun-module'
        ? Number(p.intercept.fighter.gunModule ?? false)
        : Object.values(workshop.equipped).filter((eq) => eq[slot]).length;
    const lost = workshop.log.filter((e) => e.type === 'equipment_lost' && e.items.includes(slot)).length;
    const kept = workshop.store[id] + worn + lost;
    const usedUp = id === 'medkit' || id === 'grenade';
    must(workshop.store[id] >= 0 && (usedUp ? kept <= made : kept === made), id + ': виготовлено ' + made + ', на обліку ' + kept);
  }
  must(
    workshop.queue.every((o) => o.ticksLeft >= 1),
    'замовлення цеху з нулем тіків'
  );
  must(
    Object.entries(workshop.equipped).every(([id, eq]) => ids.has(id) && (eq.armor || eq.optics || eq.medkit || eq.grenade)),
    'екіпірування без власника або порожнє'
  );

  // Перехоплювач: статус, ціль і ремонт узгоджені.
  const f = p.intercept.fighter;
  must(f.hp >= 0 && f.hp <= FIGHTER_MAX_HP && inWorld(f.pos), 'перехоплювач: hp ' + f.hp);
  const inAir = f.status === 'погоня' || f.status === 'бій';
  must(inAir === (f.targetId !== null) && (f.status === 'бій') === (p.intercept.activeUfoId !== null), 'перехоплювач: ' + f.status);
  const left = f.repairTicksLeft;
  must(f.status === 'ремонт' ? left !== undefined && left >= 1 && left <= FIGHTER_REPAIR_TICKS : left === undefined, 'ремонт: ' + left);
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

  // Кампанія: перемога — рівно з 31-ї доби, рахунок є лише з перемогою.
  must(
    (campaign.status === 'перемога') === day > VICTORY_DAY && (campaign.score !== null) === day > VICTORY_DAY,
    'кампанія на добу ' + day
  );
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
    fc.nat(OPENING.length),
    fc.nat(3),
    fc.array(cmdArb, { maxLength: 80, size: 'max' })
  )
  .map(([seed, preset, length, protocol, cmds]): [number, DifficultyPreset, Cmd[]] => {
    const opening = OPENING.slice(0, length).map((t) => ({ t, n: 0, i: protocol }));
    return [seed, preset, [...opening, ...cmds]];
  });

describe('property: партія під випадковими командами', () => {
  it('жодна послідовність команд не ламає стан партії; відмова нічого не змінює', () => {
    fc.assert(
      fc.property(partyArb, ([seed, preset, cmds]) => void play(seed, preset, cmds, true)),
      RUN
    );
  });

  it('сейв і лоад у будь-який момент не змінюють подальшої партії (ADR-0003/0026)', () => {
    fc.assert(
      fc.property(partyArb, ([seed, preset, cmds]) => {
        const json = serializeParty(play(seed, preset, cmds, false));
        const straight = cmds.filter((c) => c.t !== 'reload');
        expect(serializeParty(play(seed, preset, straight, false))).toBe(json);
        expect(serializeParty(deserializeParty(json))).toBe(json);
      }),
      RUN
    );
  });
});
