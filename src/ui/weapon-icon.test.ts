// @vitest-environment jsdom
// п20.5 (ADR-0169; EARS 9 Фази 20): мальована іконка зброї — смуга загону, вікно спорядження (ростер — panels.test.ts).
import { describe, expect, it } from 'vitest';
import { RIFLE, makeUnit, type GameState } from '../core/combat';
import { makeEnemy } from '../core/enemies';
import { MACHINE_GUN, SHOTGUN, SNIPER_RIFLE, WEAPON_IDS } from '../core/weapons';
import { createParty } from '../core/save';
import { missionSquad } from '../core/squad';
import { WEAPON_ICON_H, WEAPON_ICON_W, weaponIconHtml, weaponIdOf } from './weapon-icon';
import { SQUAD_WEAPON_W, squadCards, squadStripHtml } from './squad-strip';
import { LOADOUT_WEAPON_W, loadoutHtml } from './loadout';

const dom = (html: string): HTMLElement => {
  const box = document.createElement('div');
  box.innerHTML = html;
  return box;
};

describe('weaponIdOf і weaponIconHtml', () => {
  it('зброя каталогу → id за назвою (і копія профілю зі стану бою); зброя ворога — null', () => {
    expect([RIFLE, SHOTGUN, SNIPER_RIFLE, MACHINE_GUN].map(weaponIdOf)).toEqual(['rifle', 'shotgun', 'sniper', 'mg']);
    expect(weaponIdOf(JSON.parse(JSON.stringify(SHOTGUN)))).toBe('shotgun');
    expect(weaponIdOf(makeEnemy('demon', 'a1', 0, { x: 0, y: 0 }).weapon)).toBe(null);
  });

  it('спрайт аркуша: клітинка за порядком WEAPON_IDS, розмір за шириною (3 : 1), підпис — назва зброї', () => {
    expect([WEAPON_ICON_W, WEAPON_ICON_H]).toEqual([96, 32]);
    for (const [i, id] of WEAPON_IDS.entries()) {
      const s = dom(weaponIconHtml(id, 48)).firstElementChild as HTMLElement;
      expect(s.dataset.weapon).toBe(id);
      expect(s.className).toBe('wpn-icon');
      expect(s.style.width).toBe('48px');
      expect(s.style.height).toBe('16px');
      expect(s.style.backgroundSize).toBe('192px 16px');
      expect(s.style.backgroundPosition).toBe(-i * 48 + 'px 0px');
      expect(s.style.backgroundImage).toContain('weapon-icons');
      expect(s.getAttribute('role')).toBe('img');
      expect(s.getAttribute('aria-label')).toBe(s.title);
    }
    expect((dom(weaponIconHtml('sniper', 42)).firstElementChild as HTMLElement).title).toBe('Гвинтівка «Голка»');
    const deco = dom(weaponIconHtml('mg', 48, 'wpn-icon', true)).firstElementChild as HTMLElement;
    expect(deco.getAttribute('aria-hidden')).toBe('true');
    expect(deco.hasAttribute('title')).toBe(false);
    expect(deco.hasAttribute('role')).toBe(false);
  });
});

describe('іконка зброї на картці смуги загону і в вікні спорядження', () => {
  it('картка: іконка зброї бійця в рядку імені перед числом HP; ворожа зброя — без іконки', () => {
    const s1 = makeUnit({ id: 's1', side: 'player', name: 's1', pos: { x: 0, y: 0 }, weapon: SNIPER_RIFLE });
    const s2 = makeUnit({ id: 's2', side: 'player', name: 's2', pos: { x: 1, y: 0 } });
    const odd = makeUnit({ id: 's3', side: 'player', name: 's3', pos: { x: 2, y: 0 }, weapon: { ...RIFLE, name: 'Інша' } });
    const st = { units: [s1, s2, odd], evacuated: [] } as unknown as GameState;
    const cards = squadCards(st, ['s1', 's2', 's3'], null);
    expect(cards.map((c) => c.weapon)).toEqual(['sniper', 'rifle', undefined]);
    const box = dom(squadStripHtml(cards));
    const icons = [...box.querySelectorAll<HTMLElement>('.sq-card .sq-head .sq-wpn')];
    expect(icons.map((i) => i.dataset.weapon)).toEqual(['sniper', 'rifle']);
    expect(icons[0]!.style.width).toBe(SQUAD_WEAPON_W + 'px');
    expect(icons[0]!.nextElementSibling!.className).toBe('sq-hpn');
  });

  it('вікно: кнопка кожної зброї — декоративна іконка перед назвою (назва — текст кнопки)', () => {
    const party = createParty(42);
    party.workshop.store.shotgun = 1;
    const squad = missionSquad(party.roster);
    const box = dom(loadoutHtml(party, squad));
    const s = squad[0]!;
    for (const w of ['rifle', 'shotgun'] as const) {
      const b = box.querySelector<HTMLElement>('#btn-lo-w-' + s.id + '-' + w)!;
      const icon = b.firstElementChild as HTMLElement;
      expect(icon.dataset.weapon).toBe(w);
      expect(icon.getAttribute('aria-hidden')).toBe('true');
      expect(icon.style.width).toBe(LOADOUT_WEAPON_W + 'px');
    }
    expect(box.querySelector('#btn-lo-w-' + s.id + '-shotgun')!.textContent).toBe('Дробовик «Шквал»');
  });
});
