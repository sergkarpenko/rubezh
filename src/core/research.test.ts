// src/core/research.test.ts
// П11.2 (Фаза 11): тести ядра «Вчені та дослідження» (ADR-0058).
// ADR-0003: детермінізм — жодного RNG в науці; тести з фіксованою геосценою.
// Інваріант ізоляції: researchTick не витягує geo.rng — траєкторія геосцени
// з наукою і без неї байт-у-байт однакова (критерій П11.2).
// Числа балансу — кандидати П11.8: тести фіксують механіку, не твердження
// про баланс. Інтеграція стану у Party/сейв — у save.test.ts (критерій 2).

import { describe, expect, it } from 'vitest';
import { advanceTime, geoTick, createGeoGame, geoDay, type GeoState } from './geo';
import { type EconomyState } from './economy';
import type { StatefulRng } from './combat';
import {
  BASE_LAB_SLOTS,
  createResearch,
  fireScientist,
  hireScientist,
  HIRE_SCIENTIST_PRICE,
  MAX_LAB_SLOTS,
  PROJECT_CATALOG,
  researchTick,
  SCIENTIST_SALARY,
  startProject,
  type ProjectId,
  type ResearchState,
} from './research';

// Геосцена без НЛО, щоб тести не залежали від спавну (прецедент economy.test.ts).
function geoNoUfo(seed = 7): GeoState {
  return createGeoGame({ seed, spawnChance: 0, maxUfos: 0 });
}

// Економіка з великим балансом — тести стартів проєктів не про банкрутство.
function richEcon(money = 5000): EconomyState {
  return { money, lastAllowanceDay: 0, log: [] };
}

describe('createResearch', () => {
  it('порожня наука: 0 вчених, 2 слоти, порожні проєкти і пул', () => {
    const research = createResearch();
    expect(research.scientists).toEqual([]);
    expect(research.hired).toBe(0);
    expect(research.slots).toBe(BASE_LAB_SLOTS);
    expect(research.active).toEqual([]);
    expect(research.completed).toEqual([]);
    expect(research.pool).toBe(0);
    expect(research.lastSalaryDay).toBe(0);
    expect(research.log).toEqual([]);
  });
});

describe('найм і звільнення вчених (ADR-0058)', () => {
  it('найм списує ціну, додає вченого в кінець штату, подія в журналі', () => {
    const econ = richEcon();
    const research = createResearch();
    const s = hireScientist(econ, research);
    expect(econ.money).toBe(5000 - HIRE_SCIENTIST_PRICE);
    expect(s).toEqual({ id: 'в1', name: 'Зінаїда' });
    expect(research.scientists).toEqual([s]);
    expect(research.hired).toBe(1);
    expect(research.log).toEqual([{ type: 'hire', name: 'Зінаїда' }]);
    expect(econ.log).toEqual([{ type: 'spend', amount: HIRE_SCIENTIST_PRICE }]);
  });

  it('ід/імена унікальні за лічильником; пул циклічний з суфіксом номера', () => {
    const econ = richEcon(5000);
    const research = createResearch();
    hireScientist(econ, research);
    expect(hireScientist(econ, research)).toEqual({ id: 'в2', name: 'Ярослав' });
    // 12 імен у пулі: 13-й найм — перше ім’я з суфіксом « 2» (прецедент ростеру)
    const big = createResearch();
    for (let i = 0; i < 13; i++) hireScientist(econ, big);
    expect(big.scientists[12]).toEqual({ id: 'в13', name: 'Зінаїда 2' });
  });

  it('недостатньо грошей → throw, штат не змінюється', () => {
    const econ = richEcon(HIRE_SCIENTIST_PRICE - 1);
    const research = createResearch();
    expect(() => hireScientist(econ, research)).toThrow('Недостатньо грошей');
    expect(research.scientists).toEqual([]);
    expect(research.hired).toBe(0);
  });

  it('звільнення вилучає за id з подією; без повернення коштів; невідомий id → throw', () => {
    const econ = richEcon();
    const research = createResearch();
    hireScientist(econ, research);
    const money = econ.money;
    expect(fireScientist(research, 'в1').name).toBe('Зінаїда');
    expect(research.scientists).toEqual([]);
    expect(econ.money).toBe(money);
    expect(() => fireScientist(research, 'в9')).toThrow('Вченого немає в штаті: в9');
  });
});

describe('startProject — слоти і правила старту (ADR-0058)', () => {
  it('оплату списано одразу, проєкт активний з нуля вкладених точок', () => {
    const econ = richEcon();
    const research = createResearch();
    const p = startProject(econ, research, 'оптичний приціл');
    expect(p).toEqual({ id: 'оптичний приціл', invested: 0 });
    expect(econ.money).toBe(5000 - PROJECT_CATALOG['оптичний приціл'].cost);
    expect(research.active).toEqual([p]);
    expect(research.log).toEqual([{ type: 'project_started', id: 'оптичний приціл' }]);
  });

  it('порушення правил → throw українською, стан і гроші не змінюються', () => {
    const econ = richEcon();
    const research = createResearch();
    startProject(econ, research, 'легка броня');
    startProject(econ, research, 'аптечка');
    const money = econ.money;
    expect(() => startProject(econ, research, 'оптичний приціл')).toThrow('Немає вільного слота лабораторії (2)');
    expect(() => startProject(econ, research, 'аптечка')).toThrow('Проєкт уже триває: аптечка');
    expect(() => startProject(econ, research, 'осколкова граната')).toThrow('Передумову не завершено: аптечка');
    expect(() => startProject(econ, research, 'гарматний модуль')).toThrow('Передумову не завершено: оптичний приціл');
    expect(() => startProject(econ, research, 'телепорт' as ProjectId)).toThrow('Невідомий проєкт: телепорт');
    research.completed.push('легка броня');
    expect(() => startProject(econ, research, 'легка броня')).toThrow('Проєкт уже завершено: легка броня');
    expect(research.active.length).toBe(2);
    expect(econ.money).toBe(money);
  });

  it('недостатньо коштів → throw, слот не зайнято', () => {
    const econ = richEcon(PROJECT_CATALOG['легка броня'].cost - 1);
    const research = createResearch();
    expect(() => startProject(econ, research, 'легка броня')).toThrow('Недостатньо грошей');
    expect(research.active).toEqual([]);
  });

  it('після завершення передумови Т2 стартує', () => {
    const econ = richEcon();
    const research = createResearch();
    research.completed.push('аптечка');
    expect(() => startProject(econ, research, 'осколкова граната')).not.toThrow();
  });

  it('пресет множить ціну старту: «складний» ×0.9 → 81 за оптику', () => {
    const econ = richEcon();
    const research = createResearch();
    startProject(econ, research, 'оптичний приціл', 'складний');
    expect(econ.money).toBe(5000 - Math.round(PROJECT_CATALOG['оптичний приціл'].cost * 0.9));
  });
});

describe('researchTick — зарплата і наукові точки на межі доби', () => {
  it('упродовж доби 1 і повторний виклик без нової доби — no-op', () => {
    const econ = richEcon();
    const research = createResearch();
    const geo = geoNoUfo();
    hireScientist(econ, research);
    advanceTime(geo, 47);
    researchTick(research, econ, geo);
    // доба ще не завершена: у журналі лише найм — без зарплати і точок
    expect(research.log).toEqual([{ type: 'hire', name: 'Зінаїда' }]);
    advanceTime(geo, 1);
    researchTick(research, econ, geo);
    const money = econ.money;
    researchTick(research, econ, geo);
    expect(econ.money).toBe(money);
    expect(research.pool).toBe(1);
  });

  it('межа доби: зарплата списана, точки нараховані в пул, обидві події в журналі', () => {
    const econ = richEcon();
    const research = createResearch();
    const geo = geoNoUfo();
    hireScientist(econ, research);
    hireScientist(econ, research);
    const money = econ.money;
    advanceTime(geo, 48);
    researchTick(research, econ, geo);
    expect(research.lastSalaryDay).toBe(1);
    expect(econ.money).toBe(money - 2 * SCIENTIST_SALARY);
    expect(research.pool).toBe(2);
    expect(research.log).toContainEqual({ type: 'salary', day: 1, amount: 2 * SCIENTIST_SALARY });
    expect(research.log).toContainEqual({ type: 'points', day: 1, amount: 2 });
  });

  it('тик-у-тик і одним викликом після 96 тіків — однаковий стан (детермінізм)', () => {
    const step = createResearch();
    const econStep = richEcon();
    const geoStep = geoNoUfo();
    hireScientist(econStep, step);
    hireScientist(econStep, step);
    for (let i = 0; i < 96; i++) {
      geoTick(geoStep);
      researchTick(step, econStep, geoStep);
    }
    const bulk = createResearch();
    const econBulk = richEcon();
    const geoBulk = geoNoUfo();
    hireScientist(econBulk, bulk);
    hireScientist(econBulk, bulk);
    advanceTime(geoBulk, 96);
    researchTick(bulk, econBulk, geoBulk);
    expect(bulk).toEqual(step);
    expect(econBulk.money).toBe(econStep.money);
  });

  it('бракує на зарплату всім → штат звільнено повністю, у мінус не йдемо', () => {
    const econ = richEcon(HIRE_SCIENTIST_PRICE); // на найм хватило, на зарплату — ні
    const research = createResearch();
    const geo = geoNoUfo();
    hireScientist(econ, research);
    advanceTime(geo, 48);
    researchTick(research, econ, geo);
    expect(research.scientists).toEqual([]);
    expect(econ.money).toBe(0);
    expect(research.pool).toBe(0);
    expect(research.log).toEqual([
      { type: 'hire', name: 'Зінаїда' },
      { type: 'salary_shortfall', day: 1, fired: ['Зінаїда'] },
    ]);
  });

  it('бракує на частину штату → звільняє з кінця: лишається найдавніший', () => {
    const econ = richEcon(2 * HIRE_SCIENTIST_PRICE + SCIENTIST_SALARY); // після найму — рівно на одного
    const research = createResearch();
    const geo = geoNoUfo();
    hireScientist(econ, research); // Зінаїда
    hireScientist(econ, research); // Ярослав — на двох грошей немає
    advanceTime(geo, 48);
    researchTick(research, econ, geo);
    expect(research.scientists.map((s) => s.name)).toEqual(['Зінаїда']);
    expect(econ.money).toBe(0);
    expect(research.pool).toBe(1); // один вчений = одна точка
    expect(research.log).toContainEqual({ type: 'salary_shortfall', day: 1, fired: ['Ярослав'] });
    expect(research.log).toContainEqual({ type: 'salary', day: 1, amount: SCIENTIST_SALARY });
  });

  it('порожній штат — тік no-op: без зарплати, без точок, без подій', () => {
    const econ = richEcon();
    const research = createResearch();
    const geo = geoNoUfo();
    advanceTime(geo, 48);
    researchTick(research, econ, geo);
    expect(research.lastSalaryDay).toBe(1);
    expect(research.log).toEqual([]);
    expect(econ.money).toBe(5000);
  });

  it('пресет множить лише кошти: найм ×1.2, зарплата 24; точки — без множника', () => {
    const econ = richEcon();
    const research = createResearch();
    const geo = geoNoUfo();
    hireScientist(econ, research, 'легкий');
    expect(econ.money).toBe(5000 - Math.round(HIRE_SCIENTIST_PRICE * 1.2));
    advanceTime(geo, 48);
    researchTick(research, econ, geo, 'легкий');
    expect(econ.log).toContainEqual({ type: 'spend', amount: 24 });
    expect(research.pool).toBe(1);
  });
});

describe('розподіл точок і завершення проєктів (ADR-0058)', () => {
  // Активні проєкти вручну — тести розподілу не чекають 30 діб точок.
  function withActive(research: ResearchState, active: { id: ProjectId; invested: number }[]): ResearchState {
    research.active = active;
    return research;
  }

  it('порівну між активними, остача — першим за порядком запуску', () => {
    const econ = richEcon();
    const research = withActive(createResearch(), [
      { id: 'легка броня', invested: 0 },
      { id: 'аптечка', invested: 0 },
    ]);
    research.pool = 3;
    const geo = geoNoUfo();
    advanceTime(geo, 48);
    researchTick(research, econ, geo);
    expect(research.active.map((p) => p.invested)).toEqual([2, 1]);
    expect(research.pool).toBe(0);
  });

  it('пул спільний: без проєктів накопичується, при старті одразу лягає в проєкт', () => {
    const econ = richEcon();
    const research = createResearch();
    const geo = geoNoUfo();
    hireScientist(econ, research);
    advanceTime(geo, 48);
    researchTick(research, econ, geo);
    expect(research.pool).toBe(1);
    expect(startProject(econ, research, 'оптичний приціл').invested).toBe(1);
    expect(research.pool).toBe(0);
  });

  it('заповнений проєкт завершується: слот звільнено, лишок лишається в пулі', () => {
    const econ = richEcon();
    // П11.8: «оптичний приціл» — 23 точки (тунінг ×0.75), бракує однієї
    const research = withActive(createResearch(), [{ id: 'оптичний приціл', invested: 22 }]);
    research.pool = 2;
    const geo = geoNoUfo();
    advanceTime(geo, 48);
    researchTick(research, econ, geo);
    expect(research.active).toEqual([]);
    expect(research.completed).toEqual(['оптичний приціл']);
    expect(research.pool).toBe(1);
    expect(research.log).toContainEqual({ type: 'project_completed', id: 'оптичний приціл' });
  });

  it('кілька проєктів можуть завершитися за одну добу з великого пулу', () => {
    const econ = richEcon();
    const research = withActive(createResearch(), [
      { id: 'оптичний приціл', invested: 22 },
      { id: 'легка броня', invested: 26 },
    ]);
    research.pool = 3;
    const geo = geoNoUfo();
    advanceTime(geo, 48);
    researchTick(research, econ, geo);
    expect(research.completed).toEqual(['оптичний приціл', 'легка броня']);
    // обом бракувало по 1 точці — з 3 у пулі одна лишилась (пул спільний)
    expect(research.pool).toBe(1);
  });

  it('«Розширення лабораторії» відкриває третій слот — стартує третій проєкт', () => {
    const econ = richEcon();
    const research = withActive(createResearch(), [
      { id: 'розширення лабораторії', invested: 32 },
      { id: 'легка броня', invested: 0 },
    ]);
    research.pool = 1;
    const geo = geoNoUfo();
    advanceTime(geo, 48);
    researchTick(research, econ, geo);
    expect(research.slots).toBe(MAX_LAB_SLOTS);
    expect(() => startProject(econ, research, 'аптечка')).not.toThrow();
    expect(research.active.length).toBe(2);
  });
});

describe('ізоляція від геосцени (критерій П11.2: geo.rng не витягується)', () => {
  it('траєкторія геосцени з наукою і без неї — байт-у-байт однакова', () => {
    const withScience = geoNoUfo(42);
    const withoutScience = geoNoUfo(42);
    const econ = richEcon();
    const research = createResearch();
    hireScientist(econ, research);
    for (let i = 0; i < 120; i++) {
      geoTick(withScience);
      geoTick(withoutScience);
      researchTick(research, econ, withScience);
    }
    expect(JSON.stringify(withScience.log)).toBe(JSON.stringify(withoutScience.log));
    expect(withScience.minute).toBe(withoutScience.minute);
    expect((withScience.rng as StatefulRng).state).toBe((withoutScience.rng as StatefulRng).state);
    // 120 тіків = 2.5 доби: 2 завершені доби → 2 точки
    expect(research.pool).toBe(2);
    expect(geoDay(withScience)).toBe(3);
  });
});
