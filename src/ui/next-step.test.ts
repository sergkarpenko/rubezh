// @vitest-environment jsdom
// src/ui/next-step.test.ts
// Т.43: рядок «Наступний крок». Тексти — дослівно з рішення власника
// 15.11.2026; стан готується правкою партії createParty(42).

import { describe, expect, it, vi } from 'vitest';
import { TICK_MINUTES, type Ufo, type UfoStatus } from '../core/geo';
import { FIGHTER_MAX_HP } from '../core/intercept';
import { createParty, type Party } from '../core/save';
import { NEXT_STEP, NEXT_STEP_PREFIX, nextStep, nextStepText, renderNextStep, showStepTarget } from './next-step';

const GEO = { inBattle: false, gameOver: false };
const text = (p: Party): string | null => nextStepText(p, GEO);

function addUfo(p: Party, status: UfoStatus, detected = true, landedTicksLeft = 8): void {
  const id = 'u' + p.geo.ufos.length;
  p.geo.ufos.push({ id, kind: 'розвідник', pos: { x: 1, y: 1 }, target: { x: 1, y: 1 }, status, detected, landedTicksLeft } as Ufo);
}
function woundAll(p: Party): void {
  for (const s of p.roster.soldiers) p.roster.hospital[s.id] = 10;
}

describe('Т.43: вісім рядків «Наступний крок» — дослівно', () => {
  it('8. нова партія: рухайте час', () => {
    expect(text(createParty(42))).toBe('Наступний крок: рухайте час — сенсорна сітка шукає зонди');
  });

  it('1. зонд приземлився: вікно в годинах — з ядра, найменше з кількох', () => {
    const p = createParty(42);
    addUfo(p, 'приземлився', true, 5);
    expect(text(p)).toBe('Наступний крок: зонд приземлився — запустіть місію (вікно 2.5 год)');
    addUfo(p, 'приземлився', true, 2);
    expect(text(p)).toBe('Наступний крок: зонд приземлився — запустіть місію (вікно 1 год)');
  });

  it('2. збитий зонд чекає', () => {
    const p = createParty(42);
    addUfo(p, 'збитий');
    expect(text(p)).toBe('Наступний крок: збитий зонд чекає — запустіть місію');
  });

  it('3. зонд у повітрі, перехоплювач на базі з повним HP', () => {
    const p = createParty(42);
    addUfo(p, 'летить');
    expect(text(p)).toBe('Наступний крок: зонд у повітрі — перехопіть або чекайте приземлення');
  });

  it('4. немає боєготових', () => {
    const p = createParty(42);
    woundAll(p);
    expect(text(p)).toBe('Наступний крок: немає боєготових — вербуйте або чекайте одужання');
  });

  it('5. протокол завершено, предмета ще немає, кредитів вистачає (ціна пресета)', () => {
    const p = createParty(42, 'легкий'); // броня 60 × 0,5 = 30
    p.research.completed.push('armor');
    p.econ.money = 30;
    expect(text(p)).toBe('Наступний крок: протокол завершено — замовте предмет у «Кузні»');
    p.econ.money = 29;
    expect(text(p)).toBe('Наступний крок: рухайте час — сенсорна сітка шукає зонди');
  });

  it('6. на складі є спорядження', () => {
    const p = createParty(42);
    p.workshop.store.armor = 1;
    expect(text(p)).toBe('Наступний крок: на складі є спорядження — видайте оперативникам');
  });

  it('7. перехоплювач пошкоджений і кредитів на ремонт вистачає (50); без кредитів — рядок 8', () => {
    const p = createParty(42);
    p.intercept.fighters[0].hp = 1;
    p.econ.money = 50;
    expect(text(p)).toBe('Наступний крок: перехоплювач пошкоджений — замовте ремонт');
    p.econ.money = 49;
    expect(text(p)).toBe('Наступний крок: рухайте час — сенсорна сітка шукає зонди');
  });
});

describe('Т.43: пріоритети і межі умов', () => {
  it('приземлений зонд без боєготових — рядок 4, не 1; невиявлений зонд не рахується', () => {
    const p = createParty(42);
    addUfo(p, 'приземлився', false);
    addUfo(p, 'летить', false);
    expect(text(p)).toContain('рухайте час');
    addUfo(p, 'приземлився');
    woundAll(p);
    expect(text(p)).toContain('немає боєготових');
  });

  it('порядок: приземлився → збитий → у повітрі', () => {
    const p = createParty(42);
    addUfo(p, 'летить');
    addUfo(p, 'збитий');
    expect(text(p)).toContain('збитий зонд чекає');
    addUfo(p, 'приземлився');
    expect(text(p)).toContain('зонд приземлився');
  });

  it('зонд у повітрі з пошкодженим або зайнятим перехоплювачем — не рядок 3', () => {
    const p = createParty(42);
    addUfo(p, 'летить');
    p.intercept.fighters[0].hp = 1;
    expect(text(p)).toContain('замовте ремонт');
    p.intercept.fighters[0].status = 'ремонт';
    expect(text(p)).toContain('рухайте час');
    p.intercept.fighters[0].status = 'погоня';
    p.intercept.fighters[0].hp = 4; // повний HP, але перехоплювач не на базі
    expect(text(p)).toContain('рухайте час');
  });

  it('зонд у повітрі без боєготових — рядок 3 раніше за рядок 4', () => {
    const p = createParty(42);
    addUfo(p, 'летить');
    woundAll(p);
    expect(text(p)).toContain('зонд у повітрі');
  });

  it('порядок: замовити → видати → ремонт', () => {
    const p = createParty(42);
    p.intercept.fighters[0].hp = 1;
    p.workshop.store.armor = 1;
    expect(text(p)).toContain('видайте оперативникам');
    p.research.completed.push('medkit');
    p.econ.money = 10_000;
    expect(text(p)).toContain('замовте предмет');
  });

  it('«замовте» не показується, коли предмет уже на складі, в черзі, в оперативника чи на перехоплювачі', () => {
    const p = createParty(42);
    p.econ.money = 10_000;
    p.research.completed.push('lab-extension'); // не предмет — замовляти нічого
    expect(text(p)).toContain('рухайте час');
    p.research.completed.push('optics', 'gun-module');
    expect(text(p)).toContain('замовте предмет');
    p.workshop.queue.push({ id: 'optics', ticksLeft: 5 });
    p.intercept.fighters[0].gunModule = true;
    expect(text(p)).toContain('рухайте час');
    p.workshop.queue = [];
    p.workshop.equipped[p.roster.soldiers[0].id] = { armor: false, optics: true, medkit: false, grenade: false };
    expect(text(p)).toContain('рухайте час');
    p.intercept.fighters[0].gunModule = false;
    expect(text(p)).toContain('замовте предмет');
  });

  it('без боєготових рядок 4 — раніше за 5, 6 і 7; збитий зонд без боєготових — теж рядок 4', () => {
    const p = createParty(42);
    woundAll(p);
    p.econ.money = 10_000;
    p.intercept.fighters[0].hp = 1;
    p.workshop.store.armor = 1;
    p.research.completed.push('medkit');
    addUfo(p, 'збитий');
    expect(text(p)).toContain('немає боєготових');
  });

  it('предмет уже на складі — не «замовте», а «видайте»', () => {
    const p = createParty(42);
    p.econ.money = 10_000;
    p.research.completed.push('armor');
    expect(text(p)).toContain('замовте предмет');
    p.workshop.store.armor = 1;
    expect(text(p)).toContain('видайте оперативникам');
  });

  it('банкрутство ще до тіку (боєготових немає, на вербування бракує) — рядок прихований, а не «вербуйте»', () => {
    const p = createParty(42);
    woundAll(p);
    p.econ.money = 100; // вербування на «нормі» — 100
    expect(text(p)).toContain('немає боєготових');
    p.econ.money = 99;
    expect(text(p)).toBeNull();
  });

  it('рядок прихований: бій, банкрутство, повітряний бій, кампанію завершено', () => {
    const p = createParty(42);
    expect(nextStepText(p, { inBattle: true, gameOver: false })).toBeNull();
    expect(nextStepText(p, { inBattle: false, gameOver: true })).toBeNull();
    p.intercept.fighters[0].status = 'бій';
    expect(text(p)).toBeNull();
    p.intercept.fighters[0].status = 'на базі';
    p.campaign.status = 'перемога';
    expect(text(p)).toBeNull();
  });
});

describe('Т.79: витратник закінчився — окремий текст', () => {
  const produced = (p: Party, id: 'medkit' | 'grenade'): void => {
    p.workshop.log.push({ type: 'produced', id });
  };
  it('гель уже виготовляли і його ніде немає — «поповніть запас»; ще не виготовляли — «замовте»', () => {
    const p = createParty(42);
    p.research.completed.push('medkit');
    p.econ.money = 10_000;
    expect(text(p)).toBe('Наступний крок: протокол завершено — замовте предмет у «Кузні»');
    produced(p, 'medkit');
    expect(text(p)).toBe('Наступний крок: витратник закінчився — поповніть запас у «Кузні»');
    expect(nextStep(p, GEO)?.target).toEqual({ tab: 'base', id: 'btn-order-medkit' });
    p.workshop.store.medkit = 1; // гель на складі — уже не «поповніть», а «видайте»
    expect(text(p)).toBe(NEXT_STEP.issue);
  });
  it('граната закінчилась — так само; без кредитів — «рухайте час»', () => {
    const p = createParty(42);
    p.research.completed.push('grenade');
    produced(p, 'grenade');
    p.econ.money = 59;
    expect(text(p)).toBe(NEXT_STEP.time);
    p.econ.money = 60;
    expect(text(p)).toBe(NEXT_STEP.refill);
  });
  it('новий предмет — раніше за «видайте»; «поповніть» — нижче за «видайте» і «ремонт»', () => {
    const p = createParty(42);
    p.econ.money = 10_000;
    p.research.completed.push('medkit', 'armor');
    produced(p, 'medkit');
    p.workshop.store.optics = 1;
    expect(text(p)).toBe(NEXT_STEP.order); // броня ще не виготовлялась
    p.research.completed = ['medkit'];
    expect(text(p)).toBe(NEXT_STEP.issue);
    p.workshop.store.optics = 0;
    p.intercept.fighters[0].hp = 1;
    expect(text(p)).toBe(NEXT_STEP.repair);
    p.intercept.fighters[0].hp = FIGHTER_MAX_HP;
    expect(text(p)).toBe(NEXT_STEP.refill);
  });
  it('модуль і постійні предмети «поповніть» не дають навіть після виготовлення', () => {
    const p = createParty(42);
    p.econ.money = 10_000;
    p.research.completed.push('armor');
    p.workshop.log.push({ type: 'produced', id: 'armor' });
    expect(text(p)).toBe(NEXT_STEP.order);
    p.research.completed = ['medkit'];
    p.workshop.log.push({ type: 'produced', id: 'grenade' }); // виготовляли гранату, не гель
    expect(text(p)).toBe(NEXT_STEP.order);
  });
});

describe('Т.80: гарматний модуль на складі — «встановіть»', () => {
  it('текст дослівно; лише коли модуль на складі, не встановлено і перехоплювач на базі', () => {
    const p = createParty(42);
    p.workshop.store['gun-module'] = 1;
    expect(text(p)).toBe('Наступний крок: гарматний модуль на складі — встановіть на перехоплювач');
    expect(nextStep(p, GEO)?.target).toEqual({ tab: null, id: 'btn-gun-install' }); // п19.4: середня колонка
    p.intercept.fighters[0].status = 'ремонт';
    expect(text(p)).toBe(NEXT_STEP.time);
    p.intercept.fighters[0].status = 'на базі';
    p.intercept.fighters[0].gunModule = true;
    expect(text(p)).toBe(NEXT_STEP.time);
  });
  it('порядок: «видайте» → «встановіть» → «ремонт» → «поповніть»', () => {
    const p = createParty(42);
    p.econ.money = 10_000;
    p.workshop.store['gun-module'] = 1;
    p.workshop.store.optics = 1;
    expect(text(p)).toBe(NEXT_STEP.issue);
    p.workshop.store.optics = 0;
    p.intercept.fighters[0].hp = 1;
    p.research.completed.push('medkit');
    p.workshop.log.push({ type: 'produced', id: 'medkit' });
    expect(text(p)).toBe(NEXT_STEP.install);
    p.workshop.store['gun-module'] = 0;
    expect(text(p)).toBe(NEXT_STEP.repair);
    p.intercept.fighters[0].hp = FIGHTER_MAX_HP;
    expect(text(p)).toBe(NEXT_STEP.refill);
  });
  it('новий протокол («замовте») — раніше за «встановіть»', () => {
    const p = createParty(42);
    p.econ.money = 10_000;
    p.workshop.store['gun-module'] = 1;
    p.research.completed.push('armor');
    expect(text(p)).toBe(NEXT_STEP.order);
  });
});

describe('Т.79: куди веде клік по рядку', () => {
  // Т.97 (аудит Т.79): таблиця — по рядку на кожен ключ NEXT_STEP; новий ключ без
  // рядка таблиці валить тест «таблиця покриває всі ключі»
  type Key = keyof typeof NEXT_STEP;
  const ready = (): Party => {
    const p = createParty(42);
    p.econ.money = 10_000;
    return p;
  };
  const CASES: Record<Key, { party: () => Party; target: (p: Party) => object }> = {
    landed: {
      party: () => {
        const p = ready();
        addUfo(p, 'приземлився');
        return p;
      },
      target: (p) => ({ tab: 'base', id: 'btn-mission-' + p.geo.ufos[0].id }),
    },
    shotDown: {
      party: () => {
        const p = ready();
        addUfo(p, 'збитий');
        return p;
      },
      target: (p) => ({ tab: 'base', id: 'btn-mission-' + p.geo.ufos[0].id }),
    },
    inAir: {
      party: () => {
        const p = ready();
        addUfo(p, 'летить');
        return p;
      },
      target: () => ({ tab: 'base', selector: '#ufos button.intercept' }),
    },
    noReady: {
      party: () => {
        const p = ready();
        woundAll(p);
        return p;
      },
      target: () => ({ tab: 'squad', id: 'btn-hire' }),
    },
    order: {
      party: () => {
        const p = ready();
        p.research.completed.push('optics');
        return p;
      },
      target: () => ({ tab: 'base', id: 'btn-order-optics' }),
    },
    issue: {
      party: () => {
        const p = ready();
        p.workshop.store.grenade = 1;
        const a = p.roster.soldiers[0];
        p.workshop.equipped[a.id] = { armor: false, optics: false, medkit: false, grenade: true };
        return p;
      },
      target: (p) => ({ tab: 'squad', id: 'btn-equip-' + p.roster.soldiers[1].id + '-grenade' }), // перший без гранати
    },
    install: {
      party: () => {
        const p = ready();
        p.workshop.store['gun-module'] = 1;
        return p;
      },
      target: () => ({ tab: null, id: 'btn-gun-install' }),
    },
    repair: {
      party: () => {
        const p = ready();
        p.intercept.fighters[0].hp = 1;
        return p;
      },
      target: () => ({ tab: null, id: 'btn-repair' }),
    },
    time: { party: () => createParty(42), target: () => ({ tab: null, id: 'btn-event' }) },
    refill: {
      party: () => {
        const p = ready();
        p.research.completed.push('medkit');
        p.workshop.log.push({ type: 'produced', id: 'medkit' });
        return p;
      },
      target: () => ({ tab: 'base', id: 'btn-order-medkit' }),
    },
  };
  it('таблиця покриває всі ключі NEXT_STEP', () => {
    expect(Object.keys(CASES).sort()).toEqual(Object.keys(NEXT_STEP).sort());
  });
  for (const key of Object.keys(CASES) as Key[]) {
    it('ціль рядка «' + key + '»', () => {
      const p = CASES[key].party();
      const step = nextStep(p, GEO)!;
      const want = NEXT_STEP[key];
      expect(step.text).toBe(typeof want === 'string' ? want : want((8 * TICK_MINUTES) / 60)); // addUfo: вікно 8 тіків
      expect(step.target).toEqual(CASES[key].target(p));
    });
  }
  it('Т.97: «запустіть місію» веде до зонда з найменшим вікном, а не до першого', () => {
    const p = createParty(42);
    addUfo(p, 'приземлився', true, 12);
    addUfo(p, 'збитий');
    addUfo(p, 'приземлився', true, 4);
    addUfo(p, 'приземлився', true, 4); // рівне вікно — перший з рівних
    const step = nextStep(p, GEO)!;
    expect(step.text).toBe(NEXT_STEP.landed((4 * TICK_MINUTES) / 60));
    expect(step.target).toEqual({ tab: 'base', id: 'btn-mission-u2' });
  });
  it('Т.97: збитий зонд — перший збитий серед цілей місій; невиявлений не рахується', () => {
    const p = createParty(42);
    addUfo(p, 'летить', false);
    addUfo(p, 'збитий', false);
    addUfo(p, 'збитий');
    expect(nextStep(p, GEO)?.target).toEqual({ tab: 'base', id: 'btn-mission-u2' });
  });
  it('без рядка — без цілі', () => {
    expect(nextStep(createParty(42), { inBattle: true, gameOver: false })).toBeNull();
  });
});

describe('Т.97: renderNextStep — префікс окремим span (варіант В власника)', () => {
  it('префікс і решта — два span; textContent і aria-label — повний текст', () => {
    const b = document.createElement('button');
    b.classList.add('hidden');
    renderNextStep(b, NEXT_STEP.install);
    expect(b.classList.contains('hidden')).toBe(false);
    expect(b.textContent).toBe(NEXT_STEP.install);
    expect(b.getAttribute('aria-label')).toBe(NEXT_STEP.install);
    expect(b.querySelector('.ns-prefix')?.textContent).toBe(NEXT_STEP_PREFIX);
    expect(b.querySelector('.ns-rest')?.textContent).toBe('гарматний модуль на складі — встановіть на перехоплювач');
  });
  it('кожна порада починається з префікса', () => {
    for (const v of Object.values(NEXT_STEP)) expect((typeof v === 'string' ? v : v(1)).startsWith(NEXT_STEP_PREFIX)).toBe(true);
  });
  it('null — рядок прихований і порожній; повторний виклик не дублює span', () => {
    const b = document.createElement('button');
    renderNextStep(b, NEXT_STEP.time);
    renderNextStep(b, NEXT_STEP.repair);
    expect(b.querySelectorAll('span')).toHaveLength(2);
    renderNextStep(b, null);
    expect(b.classList.contains('hidden')).toBe(true);
    expect(b.textContent).toBe('');
    expect(b.hasAttribute('aria-label')).toBe(false);
  });
  it('текст без префікса — один span решти', () => {
    const b = document.createElement('button');
    renderNextStep(b, 'інше');
    expect(b.querySelector('.ns-prefix')).toBeNull();
    expect(b.textContent).toBe('інше');
  });
});

describe('Т.79: showStepTarget — вкладка, підсвітка, фокус', () => {
  function setup(html: string): void {
    document.body.innerHTML = html;
  }
  it('id: перемикає вкладку, ставить клас і фокус', () => {
    setup('<button id="x">x</button>');
    const tabs: string[] = [];
    const r = showStepTarget({ tab: 'base', id: 'x' }, (id) => tabs.push(id));
    expect(tabs).toEqual(['base']);
    expect(r?.id).toBe('x');
    expect(document.activeElement?.id).toBe('x');
    expect(r?.classList.contains('step-target')).toBe(true);
  });
  it('селектор: перша активна кнопка, а якщо активних немає — перша; tab null — вкладку не чіпає', () => {
    setup('<div id="u"><button class="m" id="a" disabled>a</button><button class="m" id="b">b</button></div>');
    const tabs: string[] = [];
    expect(showStepTarget({ tab: null, selector: '#u button.m' }, (id) => tabs.push(id))?.id).toBe('b');
    expect(tabs).toEqual([]);
    (document.getElementById('b') as HTMLButtonElement).disabled = true;
    expect(showStepTarget({ tab: null, selector: '#u button.m' }, () => {})?.id).toBe('a');
  });
  it('прокрутка до центру без прокрутки фокусом; клас знімається після анімації і з втратою фокусу', () => {
    setup('<button id="x">x</button><button id="y">y</button>');
    const x = document.getElementById('x')!;
    const scroll = vi.fn();
    x.scrollIntoView = scroll;
    const focus = vi.spyOn(x, 'focus');
    showStepTarget({ tab: null, id: 'x' }, () => {});
    expect(scroll).toHaveBeenCalledWith({ block: 'center' });
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    x.dispatchEvent(new Event('animationend'));
    expect(x.classList.contains('step-target')).toBe(false);
    showStepTarget({ tab: null, id: 'x' }, () => {});
    expect(x.classList.contains('step-target')).toBe(true);
    document.getElementById('y')!.focus(); // фокус пішов — рамки немає
    expect(x.classList.contains('step-target')).toBe(false);
  });
  it('кнопки немає — null, без винятку', () => {
    setup('');
    expect(showStepTarget({ tab: 'squad', id: 'nope' }, () => {})).toBeNull();
    expect(showStepTarget({ tab: 'squad', selector: '#nope' }, () => {})).toBeNull();
  });
});
