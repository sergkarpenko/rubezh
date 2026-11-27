// @vitest-environment jsdom
// п20.4 (ADR-0165 п. 7, EARS 7; ADR-0168): вікно «Спорядження перед вильотом» — вміст і контролер.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createParty, type Party } from '../core/save';
import { missionSquad } from '../core/squad';
import { RIFLE } from '../core/combat';
import { SHOTGUN, SNIPER_RIFLE } from '../core/weapons';
import { createLoadout, loadoutHtml, weaponChoices, type LoadoutDeps } from './loadout';

let party: Party;
let deps: LoadoutDeps;
const btn = (id: string): HTMLButtonElement => document.getElementById(id) as HTMLButtonElement;

beforeEach(() => {
  document.body.innerHTML = '<section class="hidden" id="loadout-dialog"></section>';
  party = createParty(42);
  deps = {
    box: document.getElementById('loadout-dialog')!,
    getParty: () => party,
    journal: vi.fn(),
    renderAll: vi.fn(),
    closed: vi.fn(),
  };
});

describe('вміст вікна (рішення власника п20.4 «А. Як запропоновано»)', () => {
  it('заголовок, картка на бійця загону, «Гарт» обрано, кнопки «Висадити загін» і «Скасувати»', () => {
    const squad = missionSquad(party.roster);
    document.body.innerHTML = loadoutHtml(party, squad);
    expect(document.getElementById('loadout-title')!.textContent).toBe('Спорядження перед вильотом');
    expect(document.querySelectorAll('.lo-card')).toHaveLength(squad.length);
    for (const s of squad) {
      const w = btn('btn-lo-w-' + s.id + '-rifle');
      expect(w.textContent).toBe('АР-14 «Гарт»');
      expect(w.getAttribute('aria-pressed')).toBe('true');
      expect(w.title).toBe('Шкода 3–6, дальність 12; усі три режими');
    }
    expect(document.querySelector('.lo-card')!.textContent).toContain('Зброя:');
    expect(document.querySelector('.lo-card')!.textContent).toContain('на складі нічого');
    expect(btn('btn-deploy').textContent).toBe('Висадити загін');
    expect(btn('btn-deploy-cancel').textContent).toBe('Скасувати');
  });

  it('зброя на вибір — «Гарт» і наявна на складі або при бійцеві; предмети — «+ видати» / «− зняти»', () => {
    const s = missionSquad(party.roster)[0];
    expect(weaponChoices(party, s)).toEqual(['rifle']);
    party.workshop.store.sniper = 2;
    party.workshop.store.medkit = 1;
    expect(weaponChoices(party, s)).toEqual(['rifle', 'sniper']);
    document.body.innerHTML = loadoutHtml(party, [s]);
    expect(btn('btn-lo-w-' + s.id + '-sniper').title).toBe('Шкода 4–7, дальність 18; лише «Прицільний» — 6 AP, ×1,3 · на складі 2');
    expect(btn('btn-lo-i-' + s.id + '-medkit').textContent).toBe('+ видати: гель');
    expect(btn('btn-lo-i-' + s.id + '-medkit').title).toBe('Регенеративний гель · на складі 1');
    expect(document.getElementById('btn-lo-i-' + s.id + '-armor')).toBeNull(); // немає на складі і не при бійцеві
  });
});

describe('контролер вікна', () => {
  it('відкрити → видати зброю й предмет → зняти → «Висадити загін» запускає бій і закриває вікно', () => {
    party.workshop.store.shotgun = 1;
    party.workshop.store.grenade = 1;
    const go = vi.fn();
    const lo = createLoadout(deps);
    lo.open(go);
    expect(deps.box.classList.contains('hidden')).toBe(false);
    expect(document.activeElement?.id).toBe('loadout-title');
    const s = missionSquad(party.roster)[0];
    btn('btn-lo-w-' + s.id + '-shotgun').click();
    expect(s.weapon).toBe(SHOTGUN);
    expect(party.workshop.store.shotgun).toBe(0);
    expect(btn('btn-lo-w-' + s.id + '-shotgun').getAttribute('aria-pressed')).toBe('true');
    expect(deps.renderAll).toHaveBeenCalled();
    // інший боєць «Шквалу» вже не бачить — на складі нуль
    expect(document.getElementById('btn-lo-w-' + missionSquad(party.roster)[1].id + '-shotgun')).toBeNull();
    btn('btn-lo-w-' + s.id + '-shotgun').click(); // та сама зброя — нічого
    expect(deps.journal).not.toHaveBeenCalled();
    btn('btn-lo-i-' + s.id + '-grenade').click();
    expect(party.workshop.equipped[s.id]?.grenade).toBe(true);
    expect(btn('btn-lo-i-' + s.id + '-grenade').textContent).toBe('− зняти: граната');
    btn('btn-lo-i-' + s.id + '-grenade').click();
    expect(party.workshop.equipped[s.id]?.grenade).toBe(false);
    btn('btn-lo-w-' + s.id + '-rifle').click();
    expect(s.weapon).toBe(RIFLE);
    expect(go).not.toHaveBeenCalled();
    btn('btn-deploy').click();
    expect(go).toHaveBeenCalledTimes(1);
    expect(deps.box.classList.contains('hidden')).toBe(true);
    expect(deps.box.innerHTML).toBe('');
    expect(deps.closed).not.toHaveBeenCalled();
  });

  it('«Скасувати» — без бою, фокус повертає шар застосунку (closed)', () => {
    const go = vi.fn();
    const lo = createLoadout(deps);
    lo.open(go);
    btn('btn-deploy-cancel').click();
    expect(go).not.toHaveBeenCalled();
    expect(deps.closed).toHaveBeenCalledTimes(1);
    expect(deps.box.classList.contains('hidden')).toBe(true);
  });

  it('боєготових немає — помилка ядра в журнал, вікно не відкривається', () => {
    party.roster.soldiers = [];
    const lo = createLoadout(deps);
    lo.open(vi.fn());
    expect(deps.journal).toHaveBeenCalledWith('✗ Ростер порожній — немає кого відправити на місію', 'lose');
    expect(deps.box.classList.contains('hidden')).toBe(true);
  });

  it('відмова ядра при видачі — у журнал, стан без змін', () => {
    party.workshop.store.sniper = 1;
    const lo = createLoadout(deps);
    lo.open(vi.fn());
    const s = missionSquad(party.roster)[0];
    const b = btn('btn-lo-w-' + s.id + '-sniper');
    party.workshop.store.sniper = 0; // склад змінився після рендеру
    b.click();
    expect(deps.journal).toHaveBeenCalledWith('✗ Зброї немає на складі: Гвинтівка «Голка»', 'lose');
    expect(s.weapon).not.toBe(SNIPER_RIFLE);
  });
});
