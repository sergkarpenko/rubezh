// @vitest-environment jsdom
// пR.2: юніт-тести журналу подій (src/ui/journal.ts, ADR-0027/ADR-0037).
// Перетворювачі EventText перенесено з main.test.ts без ослаблення тверджень;
// тут же — гілки DOM-механіки журналу (кеп 80, фільтри-вкладки, seen-трекінг
// drain*, adopt/resetBattle). DOM-флоу застосунку лишається у main.ui.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GeoEvent } from '../core/geo';
import type { GameEvent } from '../core/combat';
import type { EconomyEvent } from '../core/economy';
import { createParty } from '../core/save';
import { battleEventText, createJournal, economyEventText, geoEventText, type JournalDeps } from './journal';

const evGeo = (e: Partial<GeoEvent> & { type: GeoEvent['type'] }): GeoEvent => e as GeoEvent;
const evBattle = (e: Partial<GameEvent> & { type: GameEvent['type'] }): GameEvent => e as GameEvent;

function setupDom(): void {
  // Мінімальна розмітка журналу (index.html): вкладки фільтрів і список записів.
  document.body.innerHTML = `
    <div id="log-tabs">
      <button class="active" data-filter="all">Усе</button>
      <button data-filter="geo">Геосцена</button>
      <button data-filter="econ">Економіка</button>
      <button data-filter="battle">Бій</button>
    </div>
    <ul id="log"></ul>`;
}

function makeDeps(over: Partial<JournalDeps> = {}): JournalDeps {
  return {
    geoLog: () => [],
    econLog: () => [],
    battleLog: () => null,
    unitName: (id) => id,
    onGeoEvent: vi.fn(),
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
