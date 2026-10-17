// src/core/save.test.ts
// Тести збереження/відновлення партії (П5.2, ADR-0026).
// Критерії приймання: (1) детермінізм байт-у-байт після save→load;
// (2) пошкоджений JSON / невідома версія — throw українською, без часткового
// стану; (3) покриття ядра ≥ 80% (ADR-0017).

import { describe, expect, it } from 'vitest';
import { advanceTime } from './geo';
import { economyTick } from './economy';
import { hireSoldier, hospitalTick } from './squad';
import { mulberry32, type StatefulRng } from './combat';
import { createResearch, hireScientist, researchTick, startProject } from './research';
import { createWorkshop, equipItem, orderItem, workshopTick, WORKSHOP_CATALOG } from './workshop';
import {
  SAVE_SLOTS,
  SAVE_VERSION,
  claimHint,
  createParty,
  defaultHints,
  deserializeParty,
  eraseSlot,
  loadFromSlot,
  saveToSlot,
  serializeParty,
  slotIsEmpty,
  slotMeta,
  type Party,
  type SlotStore,
} from './save';

// Один «партійний» тік: геосцена + економіка + лікарня (як partyTick у main.ts).
// П8.4a: дотація — з пресетом партії (campaign.preset), як у шарі застосунку.
function partyTick(p: Party): void {
  advanceTime(p.geo, 1);
  economyTick(p.econ, p.geo, p.campaign.preset);
  hospitalTick(p.roster);
}

// Мок сховища (ADR-0026: тести ядра — на моках, без localStorage).
function memoryStore(): SlotStore & { dump: Map<number, string> } {
  const dump = new Map<number, string>();
  return {
    dump,
    read: (slot) => dump.get(slot) ?? null,
    write: (slot, data) => dump.set(slot, data),
    remove: (slot) => dump.delete(slot),
  };
}

// Порівняння «без функції rng»: усе, що серіалізується, має збігатися.
function snapshot(p: Party): string {
  return JSON.stringify({
    minute: p.geo.minute,
    base: p.geo.base,
    ufos: p.geo.ufos,
    log: p.geo.log,
    spawnChance: p.geo.spawnChance,
    maxUfos: p.geo.maxUfos,
    nextId: p.geo.nextId,
    soldiers: p.roster.soldiers,
    hired: p.roster.hired,
    hospital: p.roster.hospital,
    money: p.econ.money,
    lastAllowanceDay: p.econ.lastAllowanceDay,
    econLog: p.econ.log,
    research: p.research,
    workshop: p.workshop,
  });
}

describe('save: формат', () => {
  it('round-trip: збереження → завантаження відтворює стан повністю', () => {
    const p = createParty(42);
    for (let i = 0; i < 120; i++) partyTick(p);
    hireSoldier(p.econ, p.roster); // змінити економіку й ростер
    const restored = deserializeParty(serializeParty(p, '2026-10-14T00:00:00Z'));
    expect(snapshot(restored)).toBe(snapshot(p));
    // стабільність формату: load → save того самого стану — ідентичний рядок
    expect(serializeParty(restored, '2026-10-14T00:00:00Z')).toBe(serializeParty(p, '2026-10-14T00:00:00Z'));
  });

  it('той самий стан і savedAt — той самий JSON-рядок (стабільний формат)', () => {
    const p = createParty(7);
    for (let i = 0; i < 10; i++) partyTick(p);
    const a = serializeParty(p, 'T0');
    const b = serializeParty(p, 'T0');
    expect(a).toBe(b);
    const data = JSON.parse(a) as { version: number; seed: number; savedAt: string };
    expect(data.version).toBe(SAVE_VERSION);
    expect(data.seed).toBe(7);
    expect(data.savedAt).toBe('T0');
  });

  it('savedAt за замовчуванням — порожній рядок (мітку ставить шар застосунку)', () => {
    const data = JSON.parse(serializeParty(createParty(1))) as { savedAt: string };
    expect(data.savedAt).toBe('');
  });
});

describe('save: детермінізм (критерій П5.2)', () => {
  it('save → load → подальші тики: лог байт-у-байт оригіналу', () => {
    const p = createParty(42);
    for (let i = 0; i < 200; i++) partyTick(p);
    const restored = deserializeParty(serializeParty(p, 'T'));
    for (let i = 0; i < 300; i++) {
      partyTick(p);
      partyTick(restored);
    }
    expect(snapshot(restored)).toBe(snapshot(p));
  });

  it('відновлений rng дає ті самі значення, що оригінальний', () => {
    const rng = mulberry32(42);
    for (let i = 0; i < 1234; i++) rng();
    const resumed = mulberry32(rng.state);
    for (let i = 0; i < 100; i++) {
      expect(resumed()).toBe(rng());
    }
  });

  it('geo.rng не викликається під час збереження — траєкторія не зсувається', () => {
    const p = createParty(42);
    const stateBefore = (p.geo.rng as StatefulRng).state;
    serializeParty(p, 'T');
    expect((p.geo.rng as StatefulRng).state).toBe(stateBefore);
  });

  it('rng без стану — явна українська помилка', () => {
    const p = createParty(42);
    p.geo.rng = () => 0.5;
    expect(() => serializeParty(p, 'T')).toThrow('geo.rng не має стану');
  });
});

describe('save: зіпсовані дані (критерій П5.2)', () => {
  it('некоректний JSON — throw українською', () => {
    expect(() => deserializeParty('{не json')).toThrow('Пошкоджені дані збереження');
    expect(() => deserializeParty('')).toThrow('Пошкоджені дані збереження');
  });

  it('не об’єкт (число, масив, null) — throw українською', () => {
    expect(() => deserializeParty('42')).toThrow('очікувався об’єкт');
    expect(() => deserializeParty('[1,2]')).toThrow('очікувався об’єкт');
    expect(() => deserializeParty('null')).toThrow('очікувався об’єкт');
  });

  it('невідома/майбутня версія — throw українською', () => {
    const p = createParty(42);
    const json = serializeParty(p, 'T');
    const v2 = JSON.stringify({ ...JSON.parse(json), version: 2 });
    expect(() => deserializeParty(v2)).toThrow('Невідома версія збереження: 2');
    const vStr = JSON.stringify({ ...JSON.parse(json), version: '1' });
    expect(() => deserializeParty(vStr)).toThrow('Невідома версія збереження');
  });

  it('відсутні/пошкоджені поля стану — throw, без часткового стану', () => {
    const p = createParty(42);
    const json = JSON.parse(serializeParty(p, 'T')) as Record<string, unknown>;
    const broken = (mutate: (d: Record<string, unknown>) => void): string => {
      const d = JSON.parse(JSON.stringify(json)) as Record<string, unknown>;
      mutate(d);
      return JSON.stringify(d);
    };
    expect(() => deserializeParty(broken((d) => delete d.seed))).toThrow('seed');
    expect(() => deserializeParty(broken((d) => delete d.savedAt))).toThrow('savedAt');
    expect(() => deserializeParty(broken((d) => delete d.state))).toThrow('state');
    expect(() => deserializeParty(broken((d) => delete (d.state as Record<string, unknown>).geo))).toThrow('гео-стан');
    expect(() => deserializeParty(broken((d) => delete (d.state as Record<string, unknown>).roster))).toThrow('ростер');
    expect(() => deserializeParty(broken((d) => delete (d.state as Record<string, unknown>).econ))).toThrow('економіка');
    // П7.4 (ADR-0032): поле intercept опційне (старі сейви) — але якщо є, мусить бути цілим:
    // пошкоджений rngState або fighter — throw українською без часткового стану
    expect(() =>
      deserializeParty(broken((d) => ((d.state as Record<string, unknown>).intercept = { rngState: 'x', fighter: {} })))
    ).toThrow('перехоплення');
    expect(() => deserializeParty(broken((d) => ((d.state as Record<string, unknown>).intercept = { rngState: 7 })))).toThrow(
      'перехоплення'
    );
  });
  it('П7.4: старий сейв без поля intercept — боєготовий винищувач на базі (зворотна сумісність)', () => {
    const p = createParty(42);
    for (let i = 0; i < 10; i++) partyTick(p);
    const legacy = JSON.parse(serializeParty(p, 'T')) as Record<string, unknown>;
    delete (legacy.state as Record<string, unknown>).intercept; // сейв до П7.4
    const restored = deserializeParty(JSON.stringify(legacy));
    expect(restored.intercept.fighter.status).toBe('на базі');
    expect(restored.intercept.fighter.hp).toBe(4);
    expect(restored.intercept.activeUfoId).toBeNull();
  });
});

describe('save: слоти (абстракція сховища)', () => {
  it('зберегти → завантажити: round-trip через слот', () => {
    const store = memoryStore();
    const p = createParty(42);
    for (let i = 0; i < 50; i++) partyTick(p);
    saveToSlot(store, 2, p, '2026-10-14T01:00:00Z');
    expect(slotIsEmpty(store, 2)).toBe(false);
    const restored = loadFromSlot(store, 2);
    expect(snapshot(restored)).toBe(snapshot(p));
  });

  it('слоти ізольовані; видалення звільняє слот', () => {
    const store = memoryStore();
    const a = createParty(1);
    const b = createParty(2);
    saveToSlot(store, 1, a, 'A');
    saveToSlot(store, 3, b, 'B');
    expect(loadFromSlot(store, 3).seed).toBe(2);
    eraseSlot(store, 1);
    expect(slotIsEmpty(store, 1)).toBe(true);
    expect(slotIsEmpty(store, 3)).toBe(false);
  });

  it('завантаження порожнього слота — українська помилка', () => {
    const store = memoryStore();
    expect(() => loadFromSlot(store, 1)).toThrow('Слот 1 порожній');
  });

  it('номер слота поза 1..' + SAVE_SLOTS + ' — помилка', () => {
    const store = memoryStore();
    const p = createParty(1);
    expect(() => saveToSlot(store, 0, p)).toThrow('Номер слоту');
    expect(() => saveToSlot(store, 4, p)).toThrow('Номер слоту');
    expect(() => loadFromSlot(store, 1.5)).toThrow('Номер слоту');
    expect(() => eraseSlot(store, -1)).toThrow('Номер слоту');
    expect(() => slotIsEmpty(store, 99)).toThrow('Номер слоту');
  });

  it('метадані слоту — похідні від стану (ADR-0026)', () => {
    const store = memoryStore();
    const p = createParty(42);
    for (let i = 0; i < 96; i++) partyTick(p); // 48 тіків = доба
    hireSoldier(p.econ, p.roster); // -100 грошей, +1 солдат
    saveToSlot(store, 1, p, '2026-10-14T02:00:00Z');
    const meta = slotMeta(store.read(1) as string);
    expect(meta.savedAt).toBe('2026-10-14T02:00:00Z');
    expect(meta.seed).toBe(42);
    expect(meta.day).toBe(3); // 96 тіків × 30 хв = 2880 хв = початок 3-ї доби
    expect(meta.minute).toBe(2880);
    expect(meta.money).toBe(p.econ.money);
    expect(meta.aliveSoldiers).toBe(p.roster.soldiers.length);
  });

  it('метадані з пошкодженого JSON — throw українською', () => {
    expect(() => slotMeta('[]')).toThrow();
  });
});

// П8.4a (борг П8.4): пресет у партії — передається в geo/roster/econ/campaign;
// критерії: (1) сід + пресет + дії = детермінований лог; (2) тести обох пресетів.
describe('save: пресети партії (П8.4a)', () => {
  it('createParty(seed, "легкий") — множники у geo/roster/econ + пресет у campaign', () => {
    const p = createParty(42, 'легкий');
    expect(p.campaign.preset).toBe('легкий');
    // частота НЛО 0.7: spawnChance 0.03×0.7, maxUfos Math.round(3×0.7)
    expect(p.geo.spawnChance).toBeCloseTo(0.03 * 0.7, 12);
    expect(p.geo.maxUfos).toBe(2);
    // HP солдатів 1.2: стартовий ростер 10 → 12
    expect(p.roster.soldiers.length).toBe(6);
    expect(p.roster.soldiers.every((s) => s.maxHp === 12)).toBe(true);
    // економіка 1.2: стартовий баланс 300 → 360
    expect(p.econ.money).toBe(360);
  });

  it('createParty без пресета — дефолт «норма» (сумісність старих викликів)', () => {
    const p = createParty(42);
    expect(p.campaign.preset).toBe('норма');
    expect(p.geo.spawnChance).toBeCloseTo(0.03, 12);
    expect(p.geo.maxUfos).toBe(3);
    expect(p.roster.soldiers.every((s) => s.maxHp === 10)).toBe(true);
    expect(p.econ.money).toBe(300);
  });

  it('сід + пресет + дії = детермінований лог; дотація йде з множником пресета', () => {
    const a = createParty(7, 'легкий');
    const b = createParty(7, 'легкий');
    const c = createParty(7); // «норма»
    for (let i = 0; i < 96; i++) {
      // 96 тіків = 2 добі: дотація за кожну завершену добу
      partyTick(a);
      partyTick(b);
      partyTick(c);
    }
    // критерій 1: однакові сід + пресет + дії — ідентичні журнал і гроші
    expect(JSON.stringify(a.geo.log)).toBe(JSON.stringify(b.geo.log));
    expect(a.geo.minute).toBe(b.geo.minute);
    expect(a.econ.money).toBe(b.econ.money);
    // легкий: 360 + 2×90 дотації (П8.6: 75 × 1.2); норма: 300 + 2×75 — економіка розходиться
    expect(a.econ.money).toBe(540);
    expect(c.econ.money).toBe(450);
    expect(a.geo.spawnChance).not.toBe(c.geo.spawnChance); // партії різні
  });

  // П10.3: третій пресет «складний» — каркас + початкові числа за probe П8.6
  // (спавн — не ручка тиску); числа затверджено П10.4 (×0.9/×0.9, 120 сідів).
  it('П10.3/П10.4: createParty(seed, "складний") — geo як у «нормі», HP ×0.9, кошти ×0.9', () => {
    const p = createParty(42, 'складний');
    expect(p.campaign.preset).toBe('складний');
    // спавн — не ручка тиску (probe П8.6): частота НЛО як у «нормі»
    expect(p.geo.spawnChance).toBeCloseTo(0.03, 12);
    expect(p.geo.maxUfos).toBe(3);
    // HP солдатів 0.9: стартовий ростер 10 → 9 (Math.round, ручка дискретна)
    expect(p.roster.soldiers.every((s) => s.maxHp === 9)).toBe(true);
    // економіка 0.9: стартовий баланс 300 → 270
    expect(p.econ.money).toBe(270);
  });

  it('П10.3: сейв зберігає пресет «складний»; сейв до Фази 10 — без змін (ADR-0026)', () => {
    const p = createParty(42, 'складний');
    const restored = deserializeParty(serializeParty(p));
    expect(restored.campaign.preset).toBe('складний');
    // прецедент П9.2: старий сейв без поля campaign — пресет «норма», версія формату не зросла
    const json = JSON.parse(serializeParty(createParty(12)));
    delete json.state.campaign; // сейв до П8.2 (прецедент сейв-сумісності Фази 10)
    const old = deserializeParty(JSON.stringify(json));
    expect(old.campaign.preset).toBe('норма');
  });

  it('П10.3: три пресети — різні траєкторії; «складний» не тягне geo.rng', () => {
    const a = createParty(7, 'легкий');
    const b = createParty(7); // «норма»
    const c = createParty(7, 'складний');
    for (let i = 0; i < 96; i++) {
      partyTick(a);
      partyTick(b);
      partyTick(c);
    }
    // економіка розходиться за всіма трьома: 540 / 450 / 406 (дотація з множником)
    expect(a.econ.money).toBe(540);
    expect(b.econ.money).toBe(450);
    expect(c.econ.money).toBe(406); // 270 + 2×68 (75 × 0.9 = 67.5 → Math.round 68)
    // критерій П10.3.2: geo.rng не викликається — конфіг спавну «складного»
    // як у «норми», тож траєкторія геоцени байт-у-байт та сама (тиск — не спавн)
    expect(JSON.stringify(c.geo.log)).toBe(JSON.stringify(b.geo.log));
  });
});

describe('save: прапорці підказок (П9.2, ADR-0026)', () => {
  it('createParty: нова партія — усі підказки ще не показано (false)', () => {
    const p = createParty(42);
    expect(p.hints).toEqual({ intercept: false, mission: false, repair: false });
  });

  it('claimHint: перший виклик — true, повторні — false; ключі незалежні', () => {
    const h = defaultHints();
    expect(claimHint(h, 'intercept')).toBe(true);
    expect(claimHint(h, 'intercept')).toBe(false); // один раз за партію
    expect(claimHint(h, 'mission')).toBe(true); // інші ключі не зачіпаються
    expect(h).toEqual({ intercept: true, mission: true, repair: false });
  });

  it('round-trip: показані підказки зберігаються і відновлюються (стабільний формат)', () => {
    const p = createParty(42);
    for (let i = 0; i < 30; i++) partyTick(p);
    claimHint(p.hints, 'intercept');
    claimHint(p.hints, 'repair');
    const restored = deserializeParty(serializeParty(p, 'T'));
    expect(restored.hints).toEqual({ intercept: true, mission: false, repair: true });
    // load → save того самого стану — ідентичний рядок (прапорці в форматі)
    expect(serializeParty(restored, 'T')).toBe(serializeParty(p, 'T'));
  });

  it('старий сейв без поля hints — усі підказки ще не показано (зворотна сумісність)', () => {
    const p = createParty(42);
    for (let i = 0; i < 10; i++) partyTick(p);
    const legacy = JSON.parse(serializeParty(p, 'T')) as Record<string, unknown>;
    delete (legacy.state as Record<string, unknown>).hints; // сейв до П9.2
    const restored = deserializeParty(JSON.stringify(legacy));
    expect(restored.hints).toEqual({ intercept: false, mission: false, repair: false });
  });

  it('поле hints не об’єкт — throw українською, без часткового стану', () => {
    const p = createParty(42);
    const broken = JSON.parse(serializeParty(p, 'T')) as Record<string, unknown>;
    (broken.state as Record<string, unknown>).hints = 5;
    expect(() => deserializeParty(JSON.stringify(broken))).toThrow('підказки');
  });
});

describe('save: наука (П11.2, ADR-0026)', () => {
  it('createParty: нова партія — порожня наука (без вчених, 2 слоти)', () => {
    const p = createParty(42);
    expect(p.research).toEqual(createResearch());
  });

  it('round-trip: штат, активні і завершені проєкти, пул відновлюються; стабільний формат', () => {
    const p = createParty(42);
    hireScientist(p.econ, p.research);
    hireScientist(p.econ, p.research);
    startProject(p.econ, p.research, 'оптичний приціл');
    for (let i = 0; i < 48; i++) {
      advanceTime(p.geo, 1);
      economyTick(p.econ, p.geo, p.campaign.preset);
      researchTick(p.research, p.econ, p.geo, p.campaign.preset);
    }
    // одна завершена доба: 2 точки з потоку пішли у проєкт, зарплата списана
    expect(p.research.active[0].invested).toBe(2);
    const restored = deserializeParty(serializeParty(p, 'T'));
    expect(restored.research).toEqual(p.research);
    expect(serializeParty(restored, 'T')).toBe(serializeParty(p, 'T'));
  });

  it('старий сейв без поля research — порожня наука (сейв до Фази 11, версія формату не зросла)', () => {
    const p = createParty(42);
    for (let i = 0; i < 10; i++) partyTick(p);
    const legacy = JSON.parse(serializeParty(p, 'T')) as Record<string, unknown>;
    delete (legacy.state as Record<string, unknown>).research; // сейв до П11.2
    const restored = deserializeParty(JSON.stringify(legacy));
    expect(restored.research).toEqual(createResearch());
    // і траєкторія далі без науки: тік після завантаження — no-op у науці
    const before = JSON.stringify(restored.research);
    advanceTime(restored.geo, 48);
    economyTick(restored.econ, restored.geo, restored.campaign.preset);
    researchTick(restored.research, restored.econ, restored.geo, restored.campaign.preset);
    expect(restored.research.log).toEqual([]);
    expect(JSON.stringify(restored.research)).not.toBe(before); // лише lastSalaryDay рушив
    expect(restored.research.lastSalaryDay).toBe(1);
  });

  it('поле research пошкоджене — throw українською, без часткового стану', () => {
    const p = createParty(42);
    const broken = JSON.parse(serializeParty(p, 'T')) as Record<string, unknown>;
    (broken.state as Record<string, unknown>).research = { scientists: 'хмарина' };
    expect(() => deserializeParty(JSON.stringify(broken))).toThrow('наука');
  });
});

describe('save: цех (П11.3, ADR-0026)', () => {
  it('createParty: нова партія — порожній цех', () => {
    const p = createParty(42);
    expect(p.workshop).toEqual(createWorkshop());
  });

  it('round-trip: черга, склад і журнал цеху відновлюються; стабільний формат', () => {
    const p = createParty(42);
    // гейт виробництва: «аптечка» завершена (скорочення — наука не чекається)
    p.research.completed.push('аптечка');
    orderItem(p.econ, p.workshop, p.research, 'аптечка');
    orderItem(p.econ, p.workshop, p.research, 'аптечка');
    const ticks = WORKSHOP_CATALOG['аптечка'].ticks;
    for (let i = 0; i < ticks + 3; i++) {
      advanceTime(p.geo, 1);
      workshopTick(p.workshop);
    }
    // одна аптечка здана, друга в роботі
    expect(p.workshop.store['аптечка']).toBe(1);
    expect(p.workshop.queue.length).toBe(1);
    const restored = deserializeParty(serializeParty(p, 'T'));
    expect(restored.workshop).toEqual(p.workshop);
    expect(serializeParty(restored, 'T')).toBe(serializeParty(p, 'T'));
  });

  it('старий сейв без поля workshop — порожній цех (сейви до П11.3, версія формату не зросла)', () => {
    const p = createParty(42);
    for (let i = 0; i < 10; i++) partyTick(p);
    const legacy = JSON.parse(serializeParty(p, 'T')) as Record<string, unknown>;
    delete (legacy.state as Record<string, unknown>).workshop; // сейв до П11.3
    const restored = deserializeParty(JSON.stringify(legacy));
    expect(restored.workshop).toEqual(createWorkshop());
    // і цех далі no-op: тік після завантаження нічого не міняє
    advanceTime(restored.geo, 48);
    workshopTick(restored.workshop);
    expect(restored.workshop).toEqual(createWorkshop());
  });

  it('поле workshop пошкоджене — throw українською, без часткового стану', () => {
    const p = createParty(42);
    const broken = JSON.parse(serializeParty(p, 'T')) as Record<string, unknown>;
    (broken.state as Record<string, unknown>).workshop = { queue: 'очередь' };
    expect(() => deserializeParty(JSON.stringify(broken))).toThrow('цех');
  });

  it('round-trip: екіпірування ростеру відновлюється разом зі складом (П11.3)', () => {
    const p = createParty(42);
    p.workshop.store['легка броня'] = 1;
    p.workshop.store['аптечка'] = 1;
    equipItem(p.workshop, p.roster.soldiers[0], 'легка броня');
    equipItem(p.workshop, p.roster.soldiers[0], 'аптечка');
    expect(p.roster.soldiers[0].maxHp).toBe(12);
    const restored = deserializeParty(serializeParty(p, 'T'));
    expect(restored.workshop.equipped).toEqual(p.workshop.equipped);
    expect(restored.roster.soldiers[0].maxHp).toBe(12);
    expect(serializeParty(restored, 'T')).toBe(serializeParty(p, 'T'));
  });

  it('сейв без поля equipped (сейв кроку виробництва П11.3) — порожнє екіпірування', () => {
    const p = createParty(42);
    p.workshop.store['аптечка'] = 1;
    const older = JSON.parse(serializeParty(p, 'T')) as Record<string, unknown>;
    delete ((older.state as Record<string, unknown>).workshop as Record<string, unknown>).equipped;
    const restored = deserializeParty(JSON.stringify(older));
    expect(restored.workshop.equipped).toEqual({});
    expect(restored.workshop.store['аптечка']).toBe(1);
  });

  it('поле equipped пошкоджене — throw українською', () => {
    const p = createParty(42);
    const broken = JSON.parse(serializeParty(p, 'T')) as Record<string, unknown>;
    ((broken.state as Record<string, unknown>).workshop as Record<string, unknown>).equipped = 'сумка';
    expect(() => deserializeParty(JSON.stringify(broken))).toThrow('цех');
  });
});
