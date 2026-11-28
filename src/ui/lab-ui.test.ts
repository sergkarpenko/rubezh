// @vitest-environment jsdom
// п22.7 (ADR-0189; рішення власника «А. У чинних панелях», «А. «Еліксир чемпіона»», «А. Плитка «Стимул»», «А. Вкладки»):
// UI лабораторії — найм за спеціалізацією, рядок штату, «Модулі бази», «Казан алхіміка», витратники казана у вікні
// спорядження і смузі загону, вкладки «Як грати».
import { beforeEach, describe, expect, it, vi } from 'vitest';
import htmlRaw from '../../index.html?raw';
import { createParty, type Party } from '../core/save';
import { HIRE_SCIENTIST_PRICE, LAB_EXTENSION_PROJECT, LEVEL_THRESHOLDS } from '../core/research';
import { MODULES } from '../core/base';
import { STIM_AP_BONUS, makeUnit, type GameState } from '../core/combat';
import { missionSquad } from '../core/squad';
import { createResearchPanel, moduleEffectText, nextLevelText, specEffectText, type ResearchPanelDeps } from './research-panel';
import { brewBlockReason, createWorkshopPanel, trophyListText, type WorkshopPanelDeps } from './workshop-panel';
import { loadoutHtml } from './loadout';
import { squadCardLabel, squadCards, squadStripHtml } from './squad-strip';
import { createHelp } from './help';

let party: Party;
const btn = (id: string): HTMLButtonElement => document.getElementById(id) as HTMLButtonElement;
const sci = (spec: 'researcher' | 'alchemist' | 'mechanic', done: number, id = 'в1') => ({ id, name: 'Зінаїда', spec, done });

function researchDeps(): ResearchPanelDeps {
  return {
    getParty: () => party,
    inBattle: () => false,
    isGameOver: () => false,
    journal: vi.fn(),
    drainResearch: vi.fn(),
    renderAll: vi.fn(),
    scrollToResearch: vi.fn(),
    scrollToWorkshop: vi.fn(),
    showSquadTab: vi.fn(),
  };
}
function workshopDeps(): WorkshopPanelDeps {
  return {
    getParty: () => party,
    inBattle: () => false,
    isGameOver: () => false,
    journal: vi.fn(),
    drainWorkshop: vi.fn(),
    renderAll: vi.fn(),
  };
}

beforeEach(() => {
  party = createParty(42);
});

describe('п22.7: «Дослідження» — найм і штат', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="research"></div>';
  });

  it('три кнопки найму — «Дослідник / Алхімік / Механік (100)»; клік наймає свою спеціалізацію', () => {
    createResearchPanel(researchDeps()).render();
    expect(['btn-hire-scientist', 'btn-hire-alchemist', 'btn-hire-mechanic'].map((id) => btn(id).textContent)).toEqual([
      'Дослідник (' + HIRE_SCIENTIST_PRICE + ')',
      'Алхімік (' + HIRE_SCIENTIST_PRICE + ')',
      'Механік (' + HIRE_SCIENTIST_PRICE + ')',
    ]);
    party.econ.money = 1000;
    btn('btn-hire-alchemist').click();
    btn('btn-hire-mechanic').click();
    expect(party.research.scientists.map((s) => s.spec)).toEqual(['alchemist', 'mechanic']);
  });

  it('рядок штату: «Алхімік 2 · варить «Стимулятор», «Щит» · до рівня 3 — ще 3 протоколи»', () => {
    party.research.scientists.push(sci('alchemist', LEVEL_THRESHOLDS[1]));
    party.modules.cauldron = 1;
    createResearchPanel(researchDeps()).render();
    expect(document.getElementById('sci-spec-в1')!.textContent).toBe(
      'Алхімік 2 · варить «Стимулятор», «Щит» · до рівня 3 — ще 3 протоколи'
    );
    party.modules.cauldron = 0; // аудит PR #553: без казана — примітка
    createResearchPanel(researchDeps()).render();
    expect(document.getElementById('sci-spec-в1')!.textContent).toContain('«Щит» (потрібен «Казан алхіміка») ·');
  });

  it('ефекти й шлях до рівня — з констант ядра', () => {
    expect(specEffectText(sci('researcher', 0))).toBe('+1 очко за добу');
    expect(specEffectText(sci('researcher', 5))).toBe('+3 очки за добу');
    expect(specEffectText(sci('mechanic', 2))).toBe('«Кузня» −20 % часу');
    expect(specEffectText(sci('alchemist', 0))).toBe('варить «Стимулятор»');
    expect(specEffectText(sci('alchemist', 5))).toBe('варить «Стимулятор», «Щит», «Еліксир чемпіона», удвічі швидше');
    expect(nextLevelText(sci('researcher', 1))).toBe('до рівня 2 — ще 1 протокол');
    expect(nextLevelText(sci('researcher', 5))).toBe('найвищий рівень');
  });
});

describe('п22.7: «Модулі бази»', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="research"></div>';
  });

  it('рядок на модуль; «Стенд» — причина без «Розширення лабораторії»; купівля — рівень і наступна ціна', () => {
    party.econ.money = 1000;
    createResearchPanel(researchDeps()).render();
    expect(btn('btn-module-stand').disabled).toBe(true);
    expect(btn('btn-module-stand').title).toBe('Спершу протокол «Розширення лабораторії»');
    expect(btn('btn-module-boiler').textContent).toBe('Купити — ' + MODULES.boiler.prices[0] + ' кр.');
    btn('btn-module-boiler').click();
    expect(party.modules.boiler).toBe(1);
    createResearchPanel(researchDeps()).render();
    expect(btn('btn-module-boiler').textContent).toBe('Рівень II — ' + MODULES.boiler.prices[1] + ' кр.');
    expect(btn('btn-module-boiler').title).toContain('«Кузня» −40 % часу замовлення');
    party.modules.boiler = 2;
    party.research.completed.push(LAB_EXTENSION_PROJECT);
    createResearchPanel(researchDeps()).render();
    expect([btn('btn-module-boiler').textContent, btn('btn-module-boiler').disabled]).toEqual(['Найвищий рівень', true]);
    btn('btn-module-stand').click();
    expect(party.research.slots).toBe(3); // +1 слот (протокол тут лише позначено завершеним, без свого +1)
    createResearchPanel(researchDeps()).render();
    expect(btn('btn-module-stand').textContent).toBe('Встановлено');
    expect(moduleEffectText('cauldron', 2)).toBe('дві порції за раз');
  });
});

describe('п22.7: «Казан алхіміка» у «Кузні»', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="workshop"></div>';
  });

  it('без модуля — причина; з алхіміком і трофеями — «Зварити» ставить варіння', () => {
    createWorkshopPanel(workshopDeps()).render();
    expect(document.getElementById('cauldron')!.textContent).toContain('модуля немає');
    expect(btn('btn-brew-stim').title).toBe('Немає модуля «Казан алхіміка» — купіть у «Модулях бази»');
    party.modules.cauldron = 1;
    expect(brewBlockReason(party, 'stim')).toBe('Немає алхіміка в штаті');
    party.research.scientists.push(sci('alchemist', 0));
    expect(brewBlockReason(party, 'shield')).toBe('«Щит» варить алхімік рівня 2');
    expect(brewBlockReason(party, 'stim')).toBe('Бракує трофеїв: демон 0 з 1');
    party.research.trophies.demon = 1;
    expect(brewBlockReason(party, 'stim')).toBeNull();
    createWorkshopPanel(workshopDeps()).render();
    btn('btn-brew-stim').click();
    expect(party.workshop.brew).toEqual([{ id: 'stim', ticksLeft: 12 }]);
    createWorkshopPanel(workshopDeps()).render();
    expect(document.getElementById('cauldron')!.textContent).toContain('варіння: Стимулятор — ');
    expect(trophyListText({ champion: 1, demon: 2 })).toBe('демон 2, чемпіон 1');
  });
});

describe('п22.7: вікно спорядження — витратники казана', () => {
  it('«+ видати: стимулятор / щит / еліксир»; з еліксиром стимулятора і щита не видати', () => {
    const squad = missionSquad(party.roster);
    const s = squad[0];
    party.workshop.store.stim = 1;
    party.workshop.store.shield = 1;
    party.workshop.store.elixir = 1;
    document.body.innerHTML = loadoutHtml(party, squad);
    for (const id of ['stim', 'shield', 'elixir']) expect(btn('btn-lo-i-' + s.id + '-' + id).textContent).toMatch(/^\+ видати: /);
    party.workshop.equipped[s.id] = { armor: false, optics: false, medkit: false, grenade: false, elixir: true };
    party.workshop.store.elixir = 0;
    document.body.innerHTML = loadoutHtml(party, squad);
    expect(btn('btn-lo-i-' + s.id + '-elixir').textContent).toBe('− зняти: еліксир');
    expect(btn('btn-lo-i-' + s.id + '-stim')).toBeNull();
    expect(btn('btn-lo-i-' + s.id + '-shield')).toBeNull();
  });
});

describe('п22.7: смуга загону — значки ⚡ і ◈', () => {
  it('є — яскравий, витрачено — приглушений, не було — без значка; підпис для диктора', () => {
    const a = makeUnit({ id: 's1', side: 'player', name: 'Іван', pos: { x: 0, y: 0 } });
    const b = makeUnit({ id: 's2', side: 'player', name: 'Ольга', pos: { x: 1, y: 0 } });
    const st = { units: [a, b], items: { s1: { medkit: false, grenade: false, stim: true, shield: false } } } as unknown as GameState;
    const cards = squadCards(st, ['s1', 's2'], null);
    expect([cards[0].stim, cards[0].shield, cards[1].stim]).toEqual([true, false, undefined]);
    const box = document.createElement('div');
    box.innerHTML = squadStripHtml(cards);
    const its = [...box.querySelectorAll('[data-unit="s1"] .sq-it')].map((i) => i.className + ':' + i.textContent);
    expect(its).toEqual(['sq-it stim on:⚡', 'sq-it shield:◈']);
    expect(box.querySelectorAll('[data-unit="s2"] .sq-items').length).toBe(0);
    expect(squadCardLabel(cards[0])).toContain('· стимулятор · щит витрачено');
  });
});

describe('п22.7: «Як грати» — вкладки «Основи» / «Розвиток»', () => {
  it('«Розвиток» сховано до кліку; рядки Фази 22 з числами ядра; відкриття — знову «Основи»', () => {
    document.body.innerHTML = htmlRaw.match(/<body[^>]*>([\s\S]*)<\/body>/)![1];
    const help = createHelp({ storageOk: () => true, slotsEmpty: () => true });
    help.open();
    const growth = document.getElementById('help-growth')!;
    expect(growth.classList.contains('hidden')).toBe(true);
    btn('btn-help-tab-growth').click();
    expect(growth.classList.contains('hidden')).toBe(false);
    expect(document.getElementById('help-basics')!.classList.contains('hidden')).toBe(true);
    expect(btn('btn-help-tab-growth').getAttribute('aria-selected')).toBe('true');
    const text = growth.textContent ?? '';
    for (const s of ['Шлях бійця', 'Розмір загону', 'Техноманти', 'Модулі бази', 'Казан', 'Виводки', 'Чемпіони']) expect(text).toContain(s);
    expect(text).toContain('+' + STIM_AP_BONUS + ' AP за 0 AP, клавіша S');
    expect(text).toContain('«Тінь» — шанс по ній ×0,8');
    expect(text).toContain('із загрози 40 — у 50 % місій зонда (не на штурмі й не в Брамі)');
    expect(text).toContain('(у «Тіні» шанс по ньому ×0,6)');
    expect(text).toContain('(демон — лише аурою)');
    help.close();
    help.open();
    expect(growth.classList.contains('hidden')).toBe(true);
  });
});
