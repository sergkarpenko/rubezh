// @vitest-environment jsdom
// пR.2: юніт-тести журналу подій (src/ui/journal.ts, ADR-0027/ADR-0037).
// Перетворювачі EventText перенесено з main.test.ts без ослаблення тверджень;
// тут же — гілки DOM-механіки журналу (кеп 80, фільтри-вкладки, seen-трекінг
// drain*, adopt/resetBattle). DOM-флоу застосунку лишається у main.ui.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GeoEvent } from '../core/geo';
import type { GameEvent } from '../core/combat';
import type { EconomyEvent } from '../core/economy';
import type { ResearchEvent } from '../core/research';
import type { WorkshopEvent } from '../core/workshop';
import { createParty } from '../core/save';
import {
  battleEventText,
  createJournal,
  economyEventText,
  geoEventText,
  researchEventText,
  workshopEventText,
  type JournalDeps,
} from './journal';

const evGeo = (e: Partial<GeoEvent> & { type: GeoEvent['type'] }): GeoEvent => e as GeoEvent;
const evBattle = (e: Partial<GameEvent> & { type: GameEvent['type'] }): GameEvent => e as GameEvent;
const evResearch = (e: Partial<ResearchEvent> & { type: ResearchEvent['type'] }): ResearchEvent => e as ResearchEvent;
const evWorkshop = (e: Partial<WorkshopEvent> & { type: WorkshopEvent['type'] }): WorkshopEvent => e as WorkshopEvent;

function setupDom(): void {
  // Мінімальна розмітка журналу (index.html): вкладки фільтрів і список записів.
  document.body.innerHTML = `
    <div id="log-tabs">
      <button class="active" data-filter="all">Усе</button>
      <button data-filter="geo">Геосцена</button>
      <button data-filter="econ">Економіка</button>
      <button data-filter="battle">Бій</button>
      <button data-filter="base">База</button>
    </div>
    <ul id="log"></ul>`;
}

function makeDeps(over: Partial<JournalDeps> = {}): JournalDeps {
  return {
    geoLog: () => [],
    econLog: () => [],
    battleLog: () => null,
    researchLog: () => [],
    workshopLog: () => [],
    unitName: (id) => id,
    onGeoEvent: vi.fn(),
    party: () => createParty(42),
    ...over,
  };
}

beforeEach(() => {
  setupDom();
});

describe('geoEventText: фільтр туману стратегічного журналу (4.2)', () => {
  const known = new Set(['u1']);

  it('доба і виявлення — видно завжди', () => {
    expect(geoEventText(evGeo({ type: 'day', day: 2, minute: 0 }), known)).toEqual({ text: '— Доба 2 —', cls: '' });
    expect(geoEventText(evGeo({ type: 'ufo_detected', ufoId: 'u2', pos: { x: 1, y: 1 }, minute: 5 }), known)).toEqual({
      text: 'Виявлено НЛО: u2',
      cls: '',
    });
  });

  it('приземлення/відліт видно лише для раніше виявлених НЛО', () => {
    expect(geoEventText(evGeo({ type: 'ufo_landed', ufoId: 'u1', pos: { x: 2, y: 2 }, minute: 9 }), known)?.text).toContain('приземлився');
    expect(geoEventText(evGeo({ type: 'ufo_landed', ufoId: 'uX', pos: { x: 2, y: 2 }, minute: 9 }), known)).toBe(null);
    expect(geoEventText(evGeo({ type: 'ufo_left', ufoId: 'u1', minute: 30 }), known)?.text).toContain('відлетів');
    expect(geoEventText(evGeo({ type: 'ufo_left', ufoId: 'uX', minute: 30 }), known)).toBe(null);
  });

  it('спавн і рух НЛО приховано туманом; результати місій з класами win/lose', () => {
    expect(geoEventText(evGeo({ type: 'ufo_spawned', ufoId: 'u3', kind: 'розвідник', pos: { x: 0, y: 0 }, minute: 1 }), known)).toBe(null);
    expect(geoEventText(evGeo({ type: 'ufo_move', ufoId: 'u1', from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, minute: 2 }), known)).toBe(null);
    expect(geoEventText(evGeo({ type: 'mission_won', ufoId: 'u1', minute: 60 }), known)).toEqual({ text: 'Місію зачищено ✓', cls: 'win' });
    expect(geoEventText(evGeo({ type: 'mission_lost', ufoId: 'u1', minute: 60 }), known)).toEqual({
      text: 'Загін втрачено ✗',
      cls: 'lose',
    });
  });

  it('події перехоплення: старт/зближення/розрив/збиття/ремонт/повернення', () => {
    expect(geoEventText(evGeo({ type: 'intercept_start', ufoId: 'u1', minute: 1 }), known)?.text).toContain('Перехоплення');
    expect(geoEventText(evGeo({ type: 'intercept_engage', ufoId: 'u1', minute: 2 }), known)?.text).toContain('повітряний бій');
    expect(geoEventText(evGeo({ type: 'intercept_break_off', minute: 3 }), known)?.text).toContain('Розрив контакту');
    expect(geoEventText(evGeo({ type: 'ufo_shot_down', ufoId: 'u1', minute: 4 }), known)).toEqual({
      text: '✦ НЛО u1 збитий! На місці падіння — місія',
      cls: 'win',
    });
    expect(geoEventText(evGeo({ type: 'fighter_returned', minute: 5 }), known)?.text).toContain('повернувся на базу');
    expect(geoEventText(evGeo({ type: 'fighter_repair_start', minute: 6 }), known)).toEqual({
      text: '✦ Ремонт винищувача оплачено (−50)',
      cls: 'lose',
    });
    expect(geoEventText(evGeo({ type: 'fighter_repair_done', minute: 7 }), known)).toEqual({
      text: '✦ Ремонт винищувача завершено — знову боєготовий',
      cls: 'win',
    });
  });

  it('переривання перехоплення: пошкодження — lose, зникнення НЛО — нейтральний', () => {
    expect(geoEventText(evGeo({ type: 'intercept_aborted', reason: 'fighter_damaged', minute: 1 }), known)).toEqual({
      text: '✦ Винищувач пошкоджений — вимушене переривання бою',
      cls: 'lose',
    });
    expect(geoEventText(evGeo({ type: 'intercept_aborted', reason: 'ufo_lost', ufoId: 'u1', minute: 2 }), known)).toEqual({
      text: '✦ НЛО u1 зник з трекінгу — перехоплення перервано',
      cls: '',
    });
  });
});

describe('battleEventText: події бою → журнал', () => {
  const name = (id: string): string => (id === 's1' ? 'Гарт' : 'Морок');

  it('постріл: влучання з пошкодженням / промах', () => {
    expect(battleEventText(evBattle({ type: 'shot', shooterId: 's1', targetId: 'a1', mode: 'aimed', hit: true, damage: 4 }), name)).toEqual(
      {
        text: 'Гарт → Морок (прицільний): −4',
        cls: '',
      }
    );
    expect(
      battleEventText(evBattle({ type: 'shot', shooterId: 's1', targetId: 'a1', mode: 'auto', hit: false, damage: 0 }), name)?.text
    ).toContain('промах');
  });

  it('П11.4: лікування — клас win; граната — ураження списком, порожня зона — «нікого»', () => {
    expect(battleEventText(evBattle({ type: 'heal', unitId: 's1', targetId: 's1', healed: 3 }), name)).toEqual({
      text: '✚ Гарт лікує Гарт: +3 HP',
      cls: 'win',
    });
    expect(
      battleEventText(
        evBattle({
          type: 'grenade',
          unitId: 's1',
          center: { x: 8, y: 2 },
          hits: [
            { unitId: 'a1', damage: 4 },
            { unitId: 's1', damage: 4 },
          ],
        }),
        name
      )?.text
    ).toBe('✦ Гарт кидає гранату в (8, 2): −4 Морок, −4 Гарт');
    expect(battleEventText(evBattle({ type: 'grenade', unitId: 's1', center: { x: 5, y: 6 }, hits: [] }), name)?.text).toBe(
      '✦ Гарт кидає гранату в (5, 6): у зоні нікого'
    );
  });

  it('смерть — клас lose; рух/хід/дозор — не для журналу', () => {
    expect(battleEventText(evBattle({ type: 'death', unitId: 'a1', killerId: 's1' }), name)).toEqual({
      text: '✝ Морок загинув',
      cls: 'lose',
    });
    expect(battleEventText(evBattle({ type: 'move', unitId: 's1', from: { x: 0, y: 0 }, to: { x: 1, y: 0 } }), name)).toBe(null);
    expect(battleEventText(evBattle({ type: 'turn', turn: 2, side: 'alien' }), name)).toBe(null);
    expect(battleEventText(evBattle({ type: 'overwatch', unitId: 's1', armed: true }), name)).toBe(null);
  });
});

describe('economyEventText: події економіки → журнал (П4.5, ADR-0021)', () => {
  it('дотація, премія і витрати — рядки з класами кольорів журналу', () => {
    expect(economyEventText({ type: 'allowance', day: 3, amount: 100 } as EconomyEvent)).toEqual({
      text: 'Дотація за добу 3: +100',
      cls: '',
    });
    expect(economyEventText({ type: 'mission_bonus', kind: 'розвідник', amount: 150 } as EconomyEvent)).toEqual({
      text: 'Премія за місію (розвідник): +150',
      cls: 'win',
    });
    expect(economyEventText({ type: 'spend', amount: 100 } as EconomyEvent)).toEqual({ text: 'Витрати: −100', cls: 'lose' });
  });

  it('премія за збиття у повітрі (П7.6, ADR-0032) — клас win', () => {
    expect(economyEventText({ type: 'shot_down_bonus', kind: 'розвідник', amount: 200 } as EconomyEvent)).toEqual({
      text: 'Збиття у повітрі (розвідник): +200',
      cls: 'win',
    });
  });
});

describe('Journal (createJournal): запис і кеп журналу', () => {
  it('add: нові записи догори (prepend), категорія у dataset.cat, клас кольору', () => {
    const j = createJournal(makeDeps());
    j.add('перший');
    j.add('другий', 'lose', 'battle');
    const items = document.querySelectorAll('#log li');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toBe('другий'); // prepend: найновіші догори
    expect(items[0].className).toBe('lose');
    expect(items[0].dataset.cat).toBe('battle');
    expect(items[1].dataset.cat).toBe('geo'); // дефолтна категорія
  });

  it('add: кеп 80 записів — найстаріші (у кінці) видаляються', () => {
    const j = createJournal(makeDeps());
    for (let i = 1; i <= 82; i++) j.add('запис ' + i);
    const log = document.getElementById('log')!;
    expect(log.childElementCount).toBe(80);
    expect(log.firstElementChild!.textContent).toBe('запис 82');
    expect(log.lastElementChild!.textContent).toBe('запис 3'); // 1 і 2 відпали
  });
});

describe('Journal: фільтри-вкладки (ADR-0027)', () => {
  it('setFilter: активна вкладка підсвічується, невідповідні записи ховаються', () => {
    const j = createJournal(makeDeps());
    j.add('гео-запис', '', 'geo');
    j.add('економ-запис', '', 'econ');
    j.setFilter('econ');
    const tabs = document.querySelectorAll<HTMLButtonElement>('#log-tabs button');
    expect(tabs[0].classList.contains('active')).toBe(false); // «Усе»
    expect(tabs[2].classList.contains('active')).toBe(true); // «Економіка»
    const items = document.querySelectorAll<HTMLLIElement>('#log li');
    expect(items[0].style.display).toBe(''); // econ видно (prepend: він догори)
    expect(items[1].style.display).toBe('none'); // geo приховано
  });

  it('setFilter("all"): усі вкладки деактивовані крім «Усе», усі записи видно; новий запис під активним фільтром ховається', () => {
    const j = createJournal(makeDeps());
    j.add('гео', '', 'geo');
    j.setFilter('battle');
    j.add('бій', '', 'battle');
    j.add('гео-новий', '', 'geo');
    const items = document.querySelectorAll<HTMLLIElement>('#log li');
    expect(items[0].style.display).toBe('none'); // «гео-новий» — приховано одразу
    expect(items[1].style.display).toBe(''); // «бій» — видно (prepend: він другий)
    j.setFilter('all');
    expect(document.querySelector('#log-tabs button.active')!.dataset.filter).toBe('all');
    for (const li of document.querySelectorAll<HTMLLIElement>('#log li')) expect(li.style.display).toBe('');
  });
});

describe('Journal: drain* — seen-трекінг подій', () => {
  it('drainGeo: події → журнал; ufo_detected поповнює туман ДО перевірки landed того ж batch; onGeoEvent для кожної', () => {
    const onGeoEvent = vi.fn();
    const geoLog: GeoEvent[] = [
      evGeo({ type: 'ufo_detected', ufoId: 'u1', pos: { x: 1, y: 1 }, minute: 5 }),
      evGeo({ type: 'ufo_landed', ufoId: 'u1', pos: { x: 2, y: 2 }, minute: 9 }),
      evGeo({ type: 'ufo_landed', ufoId: 'uX', pos: { x: 3, y: 3 }, minute: 10 }), // невиявлений — туман
    ];
    const j = createJournal(makeDeps({ geoLog: () => geoLog, onGeoEvent }));
    j.drainGeo();
    const items = document.querySelectorAll('#log li');
    expect(items).toHaveLength(2); // detected + landed(u1); landed(uX) приховано туманом
    expect(items[0].textContent).toContain('приземлився'); // prepend: остання подія догори
    expect(onGeoEvent).toHaveBeenCalledTimes(3); // анімації читають усі події, не лише журнал
    j.drainGeo(); // повторний виклик — без нових подій (seen-трекінг)
    expect(document.querySelectorAll('#log li')).toHaveLength(2);
  });

  it('drainEcon: події економіки → журнал з категорією econ', () => {
    const econLog: EconomyEvent[] = [
      { type: 'allowance', day: 1, amount: 100 } as EconomyEvent,
      { type: 'spend', amount: 50 } as EconomyEvent,
    ];
    const j = createJournal(makeDeps({ econLog: () => econLog }));
    j.drainEcon();
    const items = document.querySelectorAll('#log li');
    expect(items).toHaveLength(2);
    expect(items[0].dataset.cat).toBe('econ');
    expect(items[0].textContent).toBe('Витрати: −50');
  });

  it('drainBattle: null — нічого; події бою з іменами юнітів, move пропускається', () => {
    const j = createJournal(makeDeps());
    j.drainBattle();
    expect(document.querySelectorAll('#log li')).toHaveLength(0);
    const battleLog: GameEvent[] = [
      evBattle({ type: 'move', unitId: 's1', from: { x: 0, y: 0 }, to: { x: 1, y: 0 } }),
      evBattle({ type: 'shot', shooterId: 's1', targetId: 'a1', mode: 'snap', hit: true, damage: 3 }),
    ];
    const j2 = createJournal(makeDeps({ battleLog: () => battleLog, unitName: (id) => (id === 's1' ? 'Гарт' : 'Морок') }));
    j2.drainBattle();
    const items = document.querySelectorAll('#log li');
    expect(items).toHaveLength(1); // move — не для журналу, але seen просунуто
    expect(items[0].dataset.cat).toBe('battle');
    expect(items[0].textContent).toContain('Гарт → Морок');
    j2.drainBattle(); // seen-трекінг: другий виклик нічого не додає
    expect(document.querySelectorAll('#log li')).toHaveLength(1);
  });

  it('П11.7 (ADR-0059): drain викликає хуки звуку для кожної події один раз (seen-трекінг)', () => {
    const onBattleSound = vi.fn();
    const onGeoSound = vi.fn();
    const battleLog: GameEvent[] = [
      evBattle({ type: 'move', unitId: 's1', from: { x: 0, y: 0 }, to: { x: 1, y: 0 } }),
      evBattle({ type: 'shot', shooterId: 's1', targetId: 'a1', mode: 'snap', hit: true, damage: 3 }),
    ];
    const geoLog: GeoEvent[] = [evGeo({ type: 'ufo_detected', ufoId: 'u1', pos: { x: 1, y: 1 }, minute: 5 })];
    const j = createJournal(makeDeps({ battleLog: () => battleLog, geoLog: () => geoLog, onBattleSound, onGeoSound }));
    j.drainBattle();
    j.drainGeo();
    // звук бачить усі події (move включно) — фільтрує мапінг у аудіо-модулі
    expect(onBattleSound.mock.calls.map((c) => c[0].type)).toEqual(['move', 'shot']);
    expect(onGeoSound).toHaveBeenCalledTimes(1);
    j.drainBattle(); // другий дрен — без повторних звуків
    j.drainGeo();
    expect(onBattleSound).toHaveBeenCalledTimes(2);
    expect(onGeoSound).toHaveBeenCalledTimes(1);
  });
});

describe('Journal: adopt/resetBattle', () => {
  it('adopt: seen-трекінг до кінця логів (без відтворення історії), knownDetected перебудовується', () => {
    const party = createParty(42);
    party.geo.log.push(evGeo({ type: 'ufo_detected', ufoId: 'uA', pos: { x: 1, y: 1 }, minute: 1 }));
    party.econ.log.push({ type: 'spend', amount: 10 } as EconomyEvent);
    const j = createJournal(makeDeps({ geoLog: () => party.geo.log, econLog: () => party.econ.log }));
    j.adopt(party);
    j.drainGeo();
    j.drainEcon();
    expect(document.querySelectorAll('#log li')).toHaveLength(0); // історію не відтворюємо
    // нові події після adopt — у журнал; knownDetected з логу: landed(uA) видно
    party.geo.log.push(evGeo({ type: 'ufo_landed', ufoId: 'uA', pos: { x: 2, y: 2 }, minute: 2 }));
    party.econ.log.push({ type: 'allowance', day: 1, amount: 100 } as EconomyEvent);
    j.drainGeo();
    j.drainEcon();
    const items = document.querySelectorAll('#log li');
    expect(items).toHaveLength(2);
    expect(items[1].textContent).toContain('приземлився');
  });

  it('resetBattle: наступний бій (новий лог) дренується з початку', () => {
    const log1: GameEvent[] = [evBattle({ type: 'shot', shooterId: 's1', targetId: 'a1', mode: 'snap', hit: true, damage: 3 })];
    const j = createJournal(makeDeps({ battleLog: () => log1 }));
    j.drainBattle();
    expect(document.querySelectorAll('#log li')).toHaveLength(1);
    j.resetBattle();
    j.drainBattle();
    expect(document.querySelectorAll('#log li')).toHaveLength(2); // той самий лог знову
  });
});

describe('Journal: підказки по ходу (П9.2, один раз за партію)', () => {
  // Виявлений НЛО у стані «летить» у geo-стані партії (туман: detected = true).
  function flyingUfo(p: ReturnType<typeof createParty>, id: string): void {
    p.geo.ufos.push({
      id,
      kind: 'розвідник',
      pos: { x: 1, y: 1 },
      target: { x: 2, y: 2 },
      detected: true,
      status: 'летить',
      landedTicksLeft: 0,
    });
  }

  it('«Можна перехопити»: виявлений НЛО у повітрі + боєготовий винищувач — підказка один раз', () => {
    const p = createParty(42);
    flyingUfo(p, 'u1');
    const j = createJournal(makeDeps({ party: () => p, geoLog: () => p.geo.log }));
    j.drainGeo();
    const hints = [...document.querySelectorAll('#log li')].filter((li) => li.textContent?.startsWith('Підказка'));
    expect(hints).toHaveLength(1);
    expect(hints[0].textContent).toContain('Перехопити');
    j.drainGeo(); // другий дрен — підказка не дублюється (прапорець у Party)
    expect([...document.querySelectorAll('#log li')].filter((li) => li.textContent?.startsWith('Підказка'))).toHaveLength(1);
    expect(p.hints.intercept).toBe(true);
  });

  it('«Можна перехопити» не показується, поки винищувач не боєготовий', () => {
    const p = createParty(42);
    p.intercept.fighter.hp = 2; // пошкоджений — перехоплення недоступне
    flyingUfo(p, 'u1');
    const j = createJournal(makeDeps({ party: () => p, geoLog: () => p.geo.log }));
    j.drainGeo();
    expect([...document.querySelectorAll('#log li')].filter((li) => li.textContent?.startsWith('Підказка'))).toHaveLength(0);
    expect(p.hints.intercept).toBe(false);
  });

  it('«Доступна місія»: приземлений виявлений НЛО — підказка один раз', () => {
    const p = createParty(42);
    p.geo.ufos.push({
      id: 'u2',
      kind: 'збирач',
      pos: { x: 3, y: 3 },
      target: { x: 3, y: 3 },
      detected: true,
      status: 'приземлився',
      landedTicksLeft: 8,
    });
    const j = createJournal(makeDeps({ party: () => p, geoLog: () => p.geo.log }));
    j.drainGeo();
    const hints = [...document.querySelectorAll('#log li')].filter((li) => li.textContent?.startsWith('Підказка'));
    expect(hints).toHaveLength(1);
    expect(hints[0].textContent).toContain('Запустити місію');
    j.drainGeo();
    expect([...document.querySelectorAll('#log li')].filter((li) => li.textContent?.startsWith('Підказка'))).toHaveLength(1);
  });

  it('невиявлений НЛО — підказок немає (туман стратегічного шару)', () => {
    const p = createParty(42);
    p.geo.ufos.push({
      id: 'u3',
      kind: 'розвідник',
      pos: { x: 1, y: 1 },
      target: { x: 2, y: 2 },
      detected: false,
      status: 'летить',
      landedTicksLeft: 0,
    });
    const j = createJournal(makeDeps({ party: () => p, geoLog: () => p.geo.log }));
    j.drainGeo();
    expect(document.querySelectorAll('#log li')).toHaveLength(0);
  });

  it('«Ремонт завершено»: подія fighter_repair_done — підказка один раз за партію', () => {
    const p = createParty(42);
    const geoLog: GeoEvent[] = [
      evGeo({ type: 'ufo_detected', ufoId: 'u1', pos: { x: 1, y: 1 }, minute: 5 }),
      evGeo({ type: 'fighter_repair_done', minute: 60 }),
    ];
    // виявленого НЛО немає — лише подія ремонту веде до підказки про ремонт
    const j = createJournal(makeDeps({ party: () => p, geoLog: () => geoLog }));
    j.drainGeo();
    const hints = [...document.querySelectorAll('#log li')].filter((li) => li.textContent?.startsWith('Підказка'));
    expect(hints).toHaveLength(1);
    expect(hints[0].textContent).toContain('ремонтований');
    expect(p.hints.repair).toBe(true);
    geoLog.push(evGeo({ type: 'fighter_repair_done', minute: 120 })); // другий ремонт
    j.drainGeo();
    expect([...document.querySelectorAll('#log li')].filter((li) => li.textContent?.startsWith('Підказка'))).toHaveLength(1);
  });

  it('adopt: прапорці підказок ідуть із партією — завантажена партія підказку не дублює', () => {
    const p = createParty(42);
    flyingUfo(p, 'u1');
    p.hints.intercept = true; // у сейві підказку вже показано
    const j = createJournal(makeDeps({ party: () => p, geoLog: () => p.geo.log }));
    j.adopt(p);
    j.drainGeo();
    expect([...document.querySelectorAll('#log li')].filter((li) => li.textContent?.startsWith('Підказка'))).toHaveLength(0);
  });
});

// П11.6 (ADR-0058): події науки → журнал (категорія «База», seen-трекінг).
describe('researchEventText: перетворювач подій науки (П11.6)', () => {
  it('найм/звільнення/точки/завершення — з прапорцем ⚑', () => {
    expect(researchEventText(evResearch({ type: 'hire', name: 'Зінаїда' }))).toEqual({
      text: '⚑ Техноманта вербовано: Зінаїда',
      cls: 'win',
    });
    expect(researchEventText(evResearch({ type: 'fire', name: 'Ярослав' }))).toEqual({
      text: '⚑ Техноманта звільнено: Ярослав',
      cls: '',
    });
    expect(researchEventText(evResearch({ type: 'points', day: 3, amount: 2 }))).toEqual({
      text: '⚑ Потік: +2 (доба 3)',
      cls: 'win',
    });
    expect(researchEventText(evResearch({ type: 'project_completed', id: 'medkit' }))).toEqual({
      text: '⚑ Протокол завершено: Регенеративний гель ✓',
      cls: 'win',
    });
  });

  it('зарплата і невиплата — клас lose (гроші й втрати)', () => {
    expect(researchEventText(evResearch({ type: 'salary', day: 2, amount: 40 }))).toEqual({
      text: '⚑ Утримання техномантів (доба 2): −40',
      cls: 'lose',
    });
    expect(researchEventText(evResearch({ type: 'salary_shortfall', day: 4, fired: ['Оксана', 'Левко'] }))?.text).toContain(
      'звільнено Оксана, Левко'
    );
  });
});

describe('drainResearch: seen-трекінг подій науки (П11.6)', () => {
  it('нові події → журнал категорією «base»; повторний дрен — без дублів', () => {
    const p = createParty(42);
    p.research.log.push(evResearch({ type: 'hire', name: 'Зінаїда' }), evResearch({ type: 'project_started', id: 'medkit' }));
    const j = createJournal(makeDeps({ researchLog: () => p.research.log }));
    j.drainResearch();
    const lis = [...document.querySelectorAll('#log li')];
    expect(lis).toHaveLength(2);
    expect(lis.every((li) => li.dataset.cat === 'base')).toBe(true);
    expect(lis[0].textContent).toContain('Протокол розпочато');
    j.drainResearch(); // повторний дрен — нових подій нема
    expect(document.querySelectorAll('#log li')).toHaveLength(2);
  });

  it('adopt: seen підвинуто до кінця логу науки — історію не відтворюємо', () => {
    const p = createParty(42);
    p.research.log.push(evResearch({ type: 'hire', name: 'Меланія' }));
    const j = createJournal(makeDeps({ researchLog: () => p.research.log }));
    j.adopt(p);
    j.drainResearch();
    expect(document.querySelectorAll('#log li')).toHaveLength(0); // старі події — не в журнал
    p.research.log.push(evResearch({ type: 'fire', name: 'Меланія' }));
    j.drainResearch();
    expect(document.querySelectorAll('#log li')).toHaveLength(1);
    expect(document.querySelector('#log li')!.textContent).toContain('звільнено');
  });

  it('фільтр «base» ховає чужі категорії (вкладка «База»)', () => {
    const p = createParty(42);
    p.research.log.push(evResearch({ type: 'points', day: 1, amount: 1 }));
    const j = createJournal(makeDeps({ researchLog: () => p.research.log }));
    j.drainResearch();
    j.add('Дотація за добу 1: +75', '', 'econ');
    j.setFilter('base');
    const lis = [...document.querySelectorAll('#log li')] as HTMLLIElement[];
    expect(lis.find((li) => li.textContent?.includes('Потік'))!.style.display).toBe('');
    expect(lis.find((li) => li.textContent?.includes('Дотація'))!.style.display).toBe('none');
  });
});

// П11.6 (ADR-0058): події цеху → журнал (категорія «База», seen-трекінг).
describe('workshopEventText: перетворювач подій цеху (П11.6)', () => {
  it('замовлення/виготовлення/екіпірування — з прапорцем ⚑', () => {
    expect(workshopEventText(evWorkshop({ type: 'order', id: 'medkit', ticks: 12 }))).toEqual({
      text: '⚑ Кузня: замовлено «Регенеративний гель» — 12 тік(и)',
      cls: '',
    });
    expect(workshopEventText(evWorkshop({ type: 'produced', id: 'armor' }))).toEqual({
      text: '⚑ Кузня: виготовлено «Композитна броня» → склад ✓',
      cls: 'win',
    });
    expect(workshopEventText(evWorkshop({ type: 'equip', soldierId: 'с1', id: 'optics' }))?.text).toContain(
      'с1 споряджено «Кібернетичне око»'
    );
    expect(workshopEventText(evWorkshop({ type: 'unequip', soldierId: 'с1', id: 'medkit' }))?.text).toContain(
      'з с1 знято «Регенеративний гель»'
    );
  });

  it('втрата екіпірування загиблого — клас lose (перма-смерть)', () => {
    expect(workshopEventText(evWorkshop({ type: 'equipment_lost', soldierId: 'с2', items: ['armor', 'medkit'] }))).toEqual({
      text: '✗ Екіпірування с2 зникло разом із оперативником (armor, medkit)',
      cls: 'lose',
    });
  });
});

describe('drainWorkshop: seen-трекінг подій цеху (П11.6)', () => {
  it('нові події → журнал категорією «base»; adopt ховає історію', () => {
    const p = createParty(42);
    let current = p; // застосунок перемкнувся на нову партію (як adoptParty в main.ts)
    p.workshop.log.push(evWorkshop({ type: 'order', id: 'medkit', ticks: 12 }));
    const j = createJournal(makeDeps({ workshopLog: () => current.workshop.log }));
    j.drainWorkshop();
    expect(document.querySelectorAll('#log li[data-cat="base"]')).toHaveLength(1);
    p.workshop.log.push(evWorkshop({ type: 'produced', id: 'medkit' }));
    j.drainWorkshop();
    expect(document.querySelectorAll('#log li[data-cat="base"]')).toHaveLength(2);
    const fresh = createParty(7);
    current = fresh;
    j.adopt(fresh); // нова партія — seen до кінця її (порожнього) логу
    fresh.workshop.log.push(evWorkshop({ type: 'order', id: 'armor', ticks: 24 }));
    j.drainWorkshop();
    expect(document.querySelectorAll('#log li[data-cat="base"]')).toHaveLength(3);
    expect(document.querySelector('#log li')!.textContent).toContain('Композитна броня');
  });
});
