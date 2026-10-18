// src/core/save-compat.test.ts
// П12.6 (Фаза 12, ADR-0064/0026): сейв-сумісність партій ≤0.3.0 — критерії 1 і 3
// кроку. Фікстура — РЕАЛЬНИЙ serializeParty кодом ДО перейменувань П12.6 (сід 42,
// «норма»): українські значення ProjectId/ItemId виступають ключами у сейві
// (completed/store/queue/логи). Після П12.6 ключі каталогів англійські, назви —
// відображувані значення; сейви ≤0.3.0 мігруються при завантаженні (save.ts,
// LEGACY_PROJECT_KEYS), version 1 не зростає (ADR-0026).
//
// Генерація фікстури (детермінований сценарій, код до серії П12.6):
// createParty(42) → 60 тіків → 2 техноманти, старт «аптечки» і «оптичного
// прицілу» (пул +47 — завершуються обидва) → 96 тіків → 2 замовлення «аптечки»
// (перше домотоване до 1 тіка) → екіпірування s1 → старт «осколкової гранати»
// (Т2) → замовлення «оптичного прицілу» → найм s7 → 24 тіки → serializeParty.
//
// Критерій 3: продовження партії (96 тіків у контурі partyTick шару застосунку)
// — послідовність ВИДІВ подій і rng.state байт-у-байт як до перейменувань
// (golden знято з коду до серії); payloads з перейменованими ключами —
// відображувані тексти, порядок і rng — незмінні (EARS П12.6).

import { describe, expect, it } from 'vitest';
import { advanceTime } from './geo';
import { economyTick } from './economy';
import { researchTick } from './research';
import { workshopTick } from './workshop';
import { hospitalTick } from './squad';
import { interceptTick, repairTick } from './intercept';
import { campaignTick } from './campaign';
import { deserializeParty, serializeParty, type Party } from './save';

// Сейс-фікстура ≤0.3.0 (див. шапку; відображувані назви — ДО мапи ADR-0064).
const FIXTURE = `{"version":1,"seed":42,"savedAt":"2026-10-18T12:00:00.000Z","state":{"geo":{"rngState":1177001285,"minute":5460,"base":{"x":8,"y":4},"ufos":[],"log":[{"type":"ufo_spawned","ufoId":"ufo1","kind":"розвідник","pos":{"x":13,"y":0},"minute":570},{"type":"ufo_move","ufoId":"ufo1","from":{"x":13,"y":0},"to":{"x":12,"y":0},"minute":570},{"type":"ufo_detected","ufoId":"ufo1","pos":{"x":12,"y":0},"minute":570},{"type":"ufo_move","ufoId":"ufo1","from":{"x":12,"y":0},"to":{"x":11,"y":0},"minute":600},{"type":"ufo_move","ufoId":"ufo1","from":{"x":11,"y":0},"to":{"x":10,"y":0},"minute":630},{"type":"ufo_move","ufoId":"ufo1","from":{"x":10,"y":0},"to":{"x":9,"y":0},"minute":660},{"type":"ufo_landed","ufoId":"ufo1","pos":{"x":9,"y":0},"minute":660},{"type":"ufo_spawned","ufoId":"ufo2","kind":"розвідник","pos":{"x":13,"y":3},"minute":750},{"type":"ufo_move","ufoId":"ufo2","from":{"x":13,"y":3},"to":{"x":12,"y":3},"minute":750},{"type":"ufo_detected","ufoId":"ufo2","pos":{"x":12,"y":3},"minute":750},{"type":"ufo_move","ufoId":"ufo2","from":{"x":12,"y":3},"to":{"x":12,"y":2},"minute":780},{"type":"ufo_landed","ufoId":"ufo2","pos":{"x":12,"y":2},"minute":780},{"type":"ufo_left","ufoId":"ufo1","minute":900},{"type":"ufo_left","ufoId":"ufo2","minute":1020},{"type":"day","day":2,"minute":1440},{"type":"ufo_spawned","ufoId":"ufo3","kind":"розвідник","pos":{"x":7,"y":4},"minute":1560},{"type":"ufo_move","ufoId":"ufo3","from":{"x":7,"y":4},"to":{"x":8,"y":4},"minute":1560},{"type":"ufo_detected","ufoId":"ufo3","pos":{"x":8,"y":4},"minute":1560},{"type":"ufo_move","ufoId":"ufo3","from":{"x":8,"y":4},"to":{"x":9,"y":4},"minute":1590},{"type":"ufo_move","ufoId":"ufo3","from":{"x":9,"y":4},"to":{"x":10,"y":4},"minute":1620},{"type":"ufo_move","ufoId":"ufo3","from":{"x":10,"y":4},"to":{"x":11,"y":4},"minute":1650},{"type":"ufo_move","ufoId":"ufo3","from":{"x":11,"y":4},"to":{"x":11,"y":3},"minute":1680},{"type":"ufo_move","ufoId":"ufo3","from":{"x":11,"y":3},"to":{"x":12,"y":3},"minute":1710},{"type":"ufo_move","ufoId":"ufo3","from":{"x":12,"y":3},"to":{"x":12,"y":2},"minute":1740},{"type":"ufo_move","ufoId":"ufo3","from":{"x":12,"y":2},"to":{"x":13,"y":2},"minute":1770},{"type":"ufo_move","ufoId":"ufo3","from":{"x":13,"y":2},"to":{"x":13,"y":1},"minute":1800},{"type":"ufo_move","ufoId":"ufo3","from":{"x":13,"y":1},"to":{"x":14,"y":1},"minute":1830},{"type":"ufo_move","ufoId":"ufo3","from":{"x":14,"y":1},"to":{"x":14,"y":0},"minute":1860},{"type":"ufo_landed","ufoId":"ufo3","pos":{"x":14,"y":0},"minute":1860},{"type":"ufo_left","ufoId":"ufo3","minute":2100},{"type":"day","day":3,"minute":2880},{"type":"ufo_spawned","ufoId":"ufo4","kind":"збирач","pos":{"x":10,"y":7},"minute":3180},{"type":"ufo_move","ufoId":"ufo4","from":{"x":10,"y":7},"to":{"x":10,"y":6},"minute":3180},{"type":"ufo_detected","ufoId":"ufo4","pos":{"x":10,"y":6},"minute":3180},{"type":"ufo_move","ufoId":"ufo4","from":{"x":10,"y":6},"to":{"x":10,"y":5},"minute":3240},{"type":"ufo_move","ufoId":"ufo4","from":{"x":10,"y":5},"to":{"x":11,"y":5},"minute":3300},{"type":"ufo_move","ufoId":"ufo4","from":{"x":11,"y":5},"to":{"x":11,"y":4},"minute":3360},{"type":"ufo_move","ufoId":"ufo4","from":{"x":11,"y":4},"to":{"x":12,"y":4},"minute":3420},{"type":"ufo_spawned","ufoId":"ufo5","kind":"розвідник","pos":{"x":15,"y":4},"minute":3480},{"type":"ufo_move","ufoId":"ufo4","from":{"x":12,"y":4},"to":{"x":12,"y":3},"minute":3480},{"type":"ufo_move","ufoId":"ufo5","from":{"x":15,"y":4},"to":{"x":15,"y":3},"minute":3480},{"type":"ufo_move","ufoId":"ufo5","from":{"x":15,"y":3},"to":{"x":15,"y":2},"minute":3510},{"type":"ufo_move","ufoId":"ufo4","from":{"x":12,"y":3},"to":{"x":13,"y":3},"minute":3540},{"type":"ufo_move","ufoId":"ufo5","from":{"x":15,"y":2},"to":{"x":15,"y":1},"minute":3540},{"type":"ufo_landed","ufoId":"ufo5","pos":{"x":15,"y":1},"minute":3540},{"type":"ufo_move","ufoId":"ufo4","from":{"x":13,"y":3},"to":{"x":13,"y":2},"minute":3600},{"type":"ufo_move","ufoId":"ufo4","from":{"x":13,"y":2},"to":{"x":14,"y":2},"minute":3660},{"type":"ufo_move","ufoId":"ufo4","from":{"x":14,"y":2},"to":{"x":14,"y":1},"minute":3720},{"type":"ufo_landed","ufoId":"ufo4","pos":{"x":14,"y":1},"minute":3720},{"type":"ufo_left","ufoId":"ufo5","minute":3780},{"type":"ufo_left","ufoId":"ufo4","minute":4200},{"type":"day","day":4,"minute":4320}],"spawnChance":0.03,"maxUfos":3,"nextId":6},"roster":{"soldiers":[{"name":"Іван","hp":10,"maxHp":10,"ap":10,"maxAp":10,"firingAccuracy":0.6,"weapon":{"name":"АР-14 «Гарт»","damage":[3,6],"range":12,"modes":{"auto":{"apCost":4,"accuracyMod":0.5,"shots":3},"snap":{"apCost":3,"accuracyMod":0.8,"shots":1},"aimed":{"apCost":5,"accuracyMod":1.15,"shots":1}}},"alive":true,"kills":0,"overwatch":false,"id":"s1","side":"player","pos":{"x":0,"y":0}},{"name":"Олена","hp":10,"maxHp":10,"ap":10,"maxAp":10,"firingAccuracy":0.6,"weapon":{"name":"АР-14 «Гарт»","damage":[3,6],"range":12,"modes":{"auto":{"apCost":4,"accuracyMod":0.5,"shots":3},"snap":{"apCost":3,"accuracyMod":0.8,"shots":1},"aimed":{"apCost":5,"accuracyMod":1.15,"shots":1}}},"alive":true,"kills":0,"overwatch":false,"id":"s2","side":"player","pos":{"x":0,"y":0}},{"name":"Тарас","hp":10,"maxHp":10,"ap":10,"maxAp":10,"firingAccuracy":0.6,"weapon":{"name":"АР-14 «Гарт»","damage":[3,6],"range":12,"modes":{"auto":{"apCost":4,"accuracyMod":0.5,"shots":3},"snap":{"apCost":3,"accuracyMod":0.8,"shots":1},"aimed":{"apCost":5,"accuracyMod":1.15,"shots":1}}},"alive":true,"kills":0,"overwatch":false,"id":"s3","side":"player","pos":{"x":0,"y":0}},{"name":"Марія","hp":10,"maxHp":10,"ap":10,"maxAp":10,"firingAccuracy":0.6,"weapon":{"name":"АР-14 «Гарт»","damage":[3,6],"range":12,"modes":{"auto":{"apCost":4,"accuracyMod":0.5,"shots":3},"snap":{"apCost":3,"accuracyMod":0.8,"shots":1},"aimed":{"apCost":5,"accuracyMod":1.15,"shots":1}}},"alive":true,"kills":0,"overwatch":false,"id":"s4","side":"player","pos":{"x":0,"y":0}},{"name":"Богдан","hp":10,"maxHp":10,"ap":10,"maxAp":10,"firingAccuracy":0.6,"weapon":{"name":"АР-14 «Гарт»","damage":[3,6],"range":12,"modes":{"auto":{"apCost":4,"accuracyMod":0.5,"shots":3},"snap":{"apCost":3,"accuracyMod":0.8,"shots":1},"aimed":{"apCost":5,"accuracyMod":1.15,"shots":1}}},"alive":true,"kills":0,"overwatch":false,"id":"s5","side":"player","pos":{"x":0,"y":0}},{"name":"Софія","hp":10,"maxHp":10,"ap":10,"maxAp":10,"firingAccuracy":0.6,"weapon":{"name":"АР-14 «Гарт»","damage":[3,6],"range":12,"modes":{"auto":{"apCost":4,"accuracyMod":0.5,"shots":3},"snap":{"apCost":3,"accuracyMod":0.8,"shots":1},"aimed":{"apCost":5,"accuracyMod":1.15,"shots":1}}},"alive":true,"kills":0,"overwatch":false,"id":"s6","side":"player","pos":{"x":0,"y":0}},{"name":"Дмитро","hp":10,"maxHp":10,"ap":10,"maxAp":10,"firingAccuracy":0.6,"weapon":{"name":"АР-14 «Гарт»","damage":[3,6],"range":12,"modes":{"auto":{"apCost":4,"accuracyMod":0.5,"shots":3},"snap":{"apCost":3,"accuracyMod":0.8,"shots":1},"aimed":{"apCost":5,"accuracyMod":1.15,"shots":1}}},"alive":true,"kills":0,"overwatch":false,"id":"s7","side":"player","pos":{"x":0,"y":0}}],"hired":7,"hospital":{}},"econ":{"money":3685,"lastAllowanceDay":3,"log":[{"type":"allowance","day":1,"amount":75},{"type":"spend","amount":100},{"type":"spend","amount":100},{"type":"spend","amount":100},{"type":"spend","amount":90},{"type":"allowance","day":2,"amount":75},{"type":"spend","amount":40},{"type":"allowance","day":3,"amount":75},{"type":"spend","amount":40},{"type":"spend","amount":40},{"type":"spend","amount":40},{"type":"spend","amount":140},{"type":"spend","amount":50},{"type":"spend","amount":100}]},"intercept":{"rngState":42,"fighter":{"hp":4,"pos":{"x":0,"y":0},"status":"на базі","targetId":null},"ufoHp":{},"activeUfoId":null,"round":0,"log":[]},"campaign":{"status":"триває","preset":"норма","score":null,"victoryDay":null},"hints":{"intercept":false,"mission":false,"repair":false},"research":{"scientists":[{"id":"в1","name":"Зінаїда"},{"id":"в2","name":"Ярослав"}],"hired":2,"slots":2,"active":[{"id":"осколкова граната","invested":4}],"completed":["оптичний приціл","аптечка"],"pool":0,"lastSalaryDay":3,"log":[{"type":"hire","name":"Зінаїда"},{"type":"hire","name":"Ярослав"},{"type":"project_started","id":"аптечка"},{"type":"project_started","id":"оптичний приціл"},{"type":"salary","day":2,"amount":40},{"type":"points","day":2,"amount":2},{"type":"project_completed","id":"оптичний приціл"},{"type":"project_completed","id":"аптечка"},{"type":"salary","day":3,"amount":40},{"type":"points","day":3,"amount":2},{"type":"project_started","id":"осколкова граната"}]},"workshop":{"queue":[{"id":"оптичний приціл","ticksLeft":7}],"store":{"аптечка":1,"осколкова граната":0,"оптичний приціл":0,"легка броня":0,"гарматний модуль":0},"equipped":{"s1":{"armor":false,"optics":false,"medkit":true,"grenade":false}},"log":[{"type":"order","id":"аптечка","ticks":12},{"type":"order","id":"аптечка","ticks":12},{"type":"produced","id":"аптечка"},{"type":"equip","soldierId":"s1","id":"аптечка"},{"type":"order","id":"оптичний приціл","ticks":20},{"type":"produced","id":"аптечка"}]}}}`;

// Контур тіка партії — дзеркало partyTick у main.ts (порядок викликів фіксований,
// ADR-0003: жоден виклик не витягує geo.rng, траєкторія не залежить від перейменувань).
function tickAll(p: Party): void {
  advanceTime(p.geo, 1);
  economyTick(p.econ, p.geo, p.campaign.preset);
  researchTick(p.research, p.econ, p.geo, p.campaign.preset);
  workshopTick(p.workshop);
  hospitalTick(p.roster);
  interceptTick(p.intercept, p.geo);
  repairTick(p.intercept, p.geo);
  campaignTick({ geo: p.geo, roster: p.roster, econ: p.econ }, p.campaign);
}

const kinds = (arr: ReadonlyArray<{ type: string }>): string[] => arr.map((e) => e.type);

describe('П12.6: сейви ≤0.3.0 вантажаться (критерій 1)', () => {
  it('ключі каталогів мігруються: протоколи/предмети/склад/черга/логи — стан у памʼяті як у нової партії', () => {
    const p = deserializeParty(FIXTURE);
    // наука: завершені протоколи — англійські ключі, порядок збережено
    expect(p.research.completed).toEqual(['optics', 'medkit']);
    expect(p.research.active).toEqual([{ id: 'grenade', invested: 4 }]);
    expect(p.research.scientists).toHaveLength(2);
    expect(p.research.pool).toBe(0);
    expect(p.research.lastSalaryDay).toBe(3);
    // лог подій науки: id подій project_* — мігровані ключі, види і порядок — ті самі
    expect(kinds(p.research.log)).toEqual([
      'hire',
      'hire',
      'project_started',
      'project_started',
      'salary',
      'points',
      'project_completed',
      'project_completed',
      'salary',
      'points',
      'project_started',
    ]);
    expect(p.research.log[2]).toEqual({ type: 'project_started', id: 'medkit' });
    expect(p.research.log[6]).toEqual({ type: 'project_completed', id: 'optics' });
    expect(p.research.log[10]).toEqual({ type: 'project_started', id: 'grenade' });
    // «Кузня»: черга, склад (нулі мержаться з emptyStore), екіпірування
    expect(p.workshop.queue).toEqual([{ id: 'optics', ticksLeft: 7 }]);
    expect(p.workshop.store).toEqual({ medkit: 1, grenade: 0, optics: 0, armor: 0, 'gun-module': 0 });
    expect(p.workshop.equipped).toEqual({ s1: { armor: false, optics: false, medkit: true, grenade: false } });
    expect(kinds(p.workshop.log)).toEqual(['order', 'order', 'produced', 'equip', 'order', 'produced']);
    expect(p.workshop.log[0]).toEqual({ type: 'order', id: 'medkit', ticks: 12 });
    expect(p.workshop.log[3]).toEqual({ type: 'equip', soldierId: 's1', id: 'medkit' });
    expect(p.workshop.log[4]).toEqual({ type: 'order', id: 'optics', ticks: 20 });
    // решта партії — без змін (сід, кампанія, економіка)
    expect(p.seed).toBe(42);
    expect(p.campaign.status).toBe('триває');
    expect(p.econ.money).toBe(3685);
  });

  it('завантажена партія зберігається в новому форматі і вантажиться повторно (round-trip)', () => {
    const p = deserializeParty(FIXTURE);
    const json = serializeParty(p, 'T');
    expect(json).toContain('"completed":["optics","medkit"]');
    expect(json).toContain('"store":{"medkit":1');
    expect(json).not.toContain('аптечка');
    const again = deserializeParty(json);
    expect(again.research).toEqual(p.research);
    expect(again.workshop.store).toEqual(p.workshop.store);
    expect(again.workshop.queue).toEqual(p.workshop.queue);
  });
});

describe('П12.6: продовження сіда 42 — види подій і rng.state байт-у-байт (критерій 3)', () => {
  it('96 тіків після завантаження: порядок подій, rng і числа — як до перейменувань', () => {
    const p = deserializeParty(FIXTURE);
    const before = {
      geo: p.geo.log.length,
      econ: p.econ.log.length,
      research: p.research.log.length,
      workshop: p.workshop.log.length,
    };
    for (let i = 0; i < 96; i++) tickAll(p);
    // послідовність видів подій геосцени — байт-у-байт golden (код до серії)
    expect(kinds(p.geo.log.slice(before.geo))).toEqual([
      'day',
      'ufo_spawned',
      'ufo_move',
      'ufo_detected',
      'ufo_move',
      'ufo_move',
      'ufo_move',
      'ufo_move',
      'ufo_move',
      'ufo_move',
      'ufo_landed',
      'ufo_left',
      'ufo_spawned',
      'ufo_move',
      'ufo_move',
      'ufo_move',
      'ufo_move',
      'ufo_move',
      'ufo_landed',
      'ufo_left',
      'day',
      'ufo_spawned',
      'ufo_move',
      'ufo_detected',
      'ufo_move',
      'ufo_move',
      'ufo_move',
      'ufo_move',
      'ufo_move',
      'ufo_move',
      'ufo_move',
      'ufo_move',
      'ufo_move',
      'ufo_landed',
      'ufo_left',
    ]);
    expect(kinds(p.econ.log.slice(before.econ))).toEqual(['allowance', 'spend', 'allowance', 'spend']);
    expect(kinds(p.research.log.slice(before.research))).toEqual(['salary', 'points', 'salary', 'points']);
    expect(kinds(p.workshop.log.slice(before.workshop))).toEqual(['produced']);
    // позиції потоку rng — байт-у-байт golden (traєкторія не залежить від перейменувань)
    expect((p.geo.rng as { state: number }).state).toBe(-1677623680);
    expect((p.intercept.rng as unknown as { state: number }).state).toBe(42);
    // числа стану — як до перейменувань
    expect(p.econ.money).toBe(3755);
    expect(p.research.pool).toBe(0);
    expect(p.research.active).toEqual([{ id: 'grenade', invested: 8 }]);
    expect(p.workshop.queue).toEqual([]);
    expect(p.workshop.store).toEqual({ medkit: 1, grenade: 0, optics: 1, armor: 0, 'gun-module': 0 });
  });
});
