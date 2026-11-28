// src/core/assault.ts
// п18.4 (ADR-0153 п. 16–17, ADR-0156): бої кампанії без зонда — штурм бази «Рубіж» і фінальна
// місія «Брама Розриву». ADR-0002: чисте ядро без DOM; ADR-0003: сід бойовища — FNV-1a рядка
// (textSeed), geo.rng не викликається, склад ворогів — окремим генератором від сіду бою.
//
// Штурм: поріг загрози 60 / 75 / 90 спрацьовує в campaignTick (assaultPending); бій — на
// окремій мапі бази, загін до 3 боєготових, 4 вороги за загрозою, після «Ключа брами» — дві
// турелі (нерухомі юніти загону, поза ростером). Евакуації немає (рішення власника «А»);
// бій триває, поки живий хоч один боєць чи турель. Програний штурм — подія assault_lost
// (+10 загрози через threatDelta), −30 % кредитів і половина кожного предмета складу
// (округлення вниз); виграний — трофеї (викликач, awardTrophies), загроза без змін.
// Без боєготових штурм програно без бою.
//
// Брама: відкрита завершенням «Ключа брами», з хвилини gateReadyAt; мапа 24 × 24, загін 3
// (рішення власника «А»), 6 ворогів — по одному кожного типу і ще два з доступних за
// загрозою (голем ≤ 2), зона ворогів — протилежний кут. Перемога — «перемога» партії
// з рахунком і подією campaign_victory; поразка чи евакуація — gate_lost (+10) і повтор
// через добу (1440 хв).

import { RIFLE, createGame, makeUnit, mulberry32, type Unit, type UnitItems, type UnitRole, type Vec2 } from './combat';
import { ALIEN_SPAWN, connectedMap, extraEnemies, placeSquad, squadZone, textSeed, type Mission } from './mission';
import { ENEMY_MIX_SALT, ENEMY_ORDER, enemyMix, kindsForThreat, makeEnemies, type EnemyKind } from './enemies';
import { campaignScore } from './campaign';
import { geoDay } from './geo';
import type { ItemId } from './workshop';
import type { Party } from './save';

export const ASSAULT_ENEMIES = 4; // ворогів у штурмі (ADR-0153 п. 16)
export const ASSAULT_SPAWN: Vec2[] = [...ALIEN_SPAWN, { x: 16, y: 3 }]; // четверта — у чистій зоні (17,2)
// п22.4 (ADR-0186): клітинки надбавки (+1 ворог за бійця понад три) — у тій самій чистій зоні;
// мапа перевіряє досяжність лише ASSAULT_SPAWN, тож мапи тих самих сідів не міняються.
export const ASSAULT_EXTRA_CELLS: Vec2[] = [
  { x: 18, y: 2 },
  { x: 18, y: 3 },
];
export const ASSAULT_MONEY_LOSS = 0.3; // частка кредитів, втрачена в програному штурмі
// Турелі (кандидати ADR-0156 п. 3): гвинтівка, 12 HP, 10 AP, точність 0,6; біля зони загону.
export const TURRET_SPAWN: Vec2[] = [
  { x: 3, y: 3 },
  { x: 3, y: 1 },
];
export const TURRET_HP = 12;
export const GATE_PROJECT = 'gate-key'; // «Ключ брами» відкриває браму і турелі
export const GATE_MAP = 24; // мапа фіналу 24 × 24 (рішення власника «А»)
export const GATE_ENEMIES = 6;
export const GATE_GOLEM_LIMIT = 2;
export const GATE_RETRY_MINUTES = 1440; // повтор фіналу через добу
export const GATE_ZONE_CENTER: Vec2 = { x: 21, y: 21 };
export const GATE_SPAWN: Vec2[] = [
  { x: 21, y: 21 },
  { x: 20, y: 21 },
  { x: 21, y: 20 },
  { x: 20, y: 20 },
  { x: 22, y: 21 },
  { x: 21, y: 22 },
];
// п22.4 (ADR-0186): надбавка фіналу — у чистій зоні 3 × 3 навколо GATE_ZONE_CENTER.
export const GATE_EXTRA_CELLS: Vec2[] = [
  { x: 22, y: 22 },
  { x: 22, y: 20 },
];

export interface CampaignBattleOptions {
  squad: Unit[]; // боєготові оперативники (до 5 — squadSize, п22.4)
  items?: Record<string, UnitItems>;
  roles?: Record<string, UnitRole>;
}

// «Ключ брами» завершено — турелі на базі і брама на геосцені.
export function gateKeyDone(party: Pick<Party, 'research'>): boolean {
  return party.research.completed.includes(GATE_PROJECT);
}

// Турель бази: юніт сторони загону з прапорцем turret (рух ядро відхиляє).
export function makeTurret(i: number): Unit {
  return makeUnit({
    id: 't' + (i + 1),
    side: 'player',
    name: 'Турель ' + (i + 1),
    pos: { ...TURRET_SPAWN[i] },
    hp: TURRET_HP,
    maxHp: TURRET_HP,
    firingAccuracy: 0.6,
    weapon: RIFLE,
    turret: true,
  });
}

// Бій штурму: окрема мапа бази (сід — номер штурму і хвилина), 4 вороги за загрозою,
// турелі — після «Ключа брами»; без зони евакуації.
export function createAssault(party: Party, opts: CampaignBattleOptions): Mission {
  if (!party.campaign.assaultPending) throw new Error('Штурму бази зараз немає');
  const seed = textSeed('штурм:' + (party.campaign.assaults ?? 0) + ':' + party.geo.minute);
  const map = connectedMap(seed, undefined, undefined, ASSAULT_SPAWN);
  placeSquad(opts.squad);
  const turrets = gateKeyDone(party) ? TURRET_SPAWN.map((_, i) => makeTurret(i)) : [];
  const n = ASSAULT_ENEMIES + extraEnemies(opts.squad.length); // п22.4: +1 за бійця понад три
  const aliens = makeEnemies(enemyMix(kindsForThreat(party.campaign.threat), n, seed), [...ASSAULT_SPAWN, ...ASSAULT_EXTRA_CELLS], seed);
  const state = createGame({
    map,
    units: [...opts.squad, ...turrets, ...aliens],
    rng: mulberry32(seed),
    items: opts.items,
    roles: opts.roles,
    cover: true, // п20.2 (ADR-0165 п. 10)
  });
  return { briefing: { probeId: 'база', kind: 'збирач', aliens: aliens.length, minute: party.geo.minute, op: 'штурм' }, state };
}

// Наслідки штурму. Перемога — подія assault_won; поразка — assault_lost з утраченими
// кредитами (+10 загрози), −30 % кредитів і половина складу. Трофеї й ростер — викликач.
export function completeAssault(party: Party, outcome: 'перемога' | 'поразка'): number {
  if (!party.campaign.assaultPending) throw new Error('Штурму бази зараз немає');
  party.campaign.assaultPending = false;
  const minute = party.geo.minute;
  if (outcome === 'перемога') {
    party.geo.log.push({ type: 'assault_won', minute });
    return 0;
  }
  const money = Math.floor(party.econ.money * ASSAULT_MONEY_LOSS);
  party.econ.money -= money;
  if (money > 0) party.econ.log.push({ type: 'spend', amount: money });
  const store = party.workshop.store;
  const lost: Partial<Record<ItemId, number>> = {};
  for (const id of Object.keys(store) as ItemId[]) {
    const n = Math.floor(store[id] / 2); // і «Пробивний заряд»
    if (n === 0) continue;
    store[id] -= n;
    lost[id] = n;
  }
  if (Object.keys(lost).length > 0) party.workshop.log.push({ type: 'store_lost', lost }); // облік складу (property-тест)
  party.geo.log.push({ type: 'assault_lost', money, minute });
  return money;
}

// Брама доступна: «Ключ брами» завершено, партія триває, минула пауза після поразки.
export function gateOpen(party: Pick<Party, 'research' | 'campaign' | 'geo'>): boolean {
  return party.campaign.status === 'триває' && gateKeyDone(party) && party.geo.minute >= (party.campaign.gateReadyAt ?? 0);
}

// Склад фіналу: по одному кожного типу, далі ще два з доступних (голем ≤ 2) — окремий генератор.
// п22.4: n — з надбавкою за загін (типово GATE_ENEMIES — склад як до п22.4).
export function gateMix(avail: readonly EnemyKind[], seed: number, n = GATE_ENEMIES): EnemyKind[] {
  const kinds: EnemyKind[] = [...ENEMY_ORDER];
  const rng = mulberry32((seed ^ ENEMY_MIX_SALT) >>> 0);
  while (kinds.length < n) {
    const golems = kinds.filter((k) => k === 'golem').length;
    const pool = golems >= GATE_GOLEM_LIMIT ? avail.filter((k) => k !== 'golem') : avail;
    kinds.push(pool[Math.floor(rng() * pool.length)]);
  }
  return kinds;
}

// Бій фіналу: мапа 24 × 24 із зоною ворогів у протилежному куті, евакуація — як у місії.
export function createGateMission(party: Party, opts: CampaignBattleOptions): Mission {
  if (!gateOpen(party)) throw new Error('Брама Розриву зараз недоступна');
  const seed = textSeed('брама:' + party.geo.minute);
  const map = connectedMap(seed, GATE_MAP, GATE_MAP, GATE_SPAWN, GATE_ZONE_CENTER);
  placeSquad(opts.squad);
  const n = GATE_ENEMIES + extraEnemies(opts.squad.length); // п22.4: +1 за бійця понад три
  const aliens = makeEnemies(gateMix(kindsForThreat(party.campaign.threat), seed, n), [...GATE_SPAWN, ...GATE_EXTRA_CELLS], seed);
  const state = createGame({
    map,
    units: [...opts.squad, ...aliens],
    rng: mulberry32(seed),
    items: opts.items,
    roles: opts.roles,
    evacZone: squadZone(opts.squad.length), // п22.4: зона — за розміром загону
    enemyZone: GATE_SPAWN,
    cover: true, // п20.2 (ADR-0165 п. 10)
  });
  return { briefing: { probeId: 'брама', kind: 'збирач', aliens: aliens.length, minute: party.geo.minute, op: 'брама' }, state };
}

// Наслідки фіналу: перемога — «перемога» партії (рахунок один раз, campaign_victory);
// поразка чи евакуація — gate_lost (+10 загрози) і брама знову через добу.
export function completeGate(party: Party, outcome: 'перемога' | 'поразка' | 'евакуйовано'): void {
  const c = party.campaign;
  const minute = party.geo.minute;
  if (outcome !== 'перемога') {
    c.gateReadyAt = minute + GATE_RETRY_MINUTES;
    party.geo.log.push({ type: 'gate_lost', minute });
    return;
  }
  const score = campaignScore(party.geo, party.roster, party.econ);
  c.status = 'перемога';
  c.score = score;
  c.victoryDay = geoDay(party.geo);
  party.geo.log.push({ type: 'campaign_victory', day: c.victoryDay, score: score.total, minute });
}
