// п20.6 (ADR-0170; ADR-0165 п. 14): бот партії зі зброєю «Кузні» — виріб за дефіцитом за роллю, видача
// зі складу («Голка» снайперові, «Шквал» штурмовикові, «Град» решті); без поля `weapons` — як до п20.6.

import { describe, expect, it } from 'vitest';
import { createParty, type Party } from './save';
import { readySoldiers } from './squad';
import { CAMPAIGN_POLICY, DEFAULT_PARTY_POLICY, botWeapon, partyBotScienceStep, type PartyBotPolicy } from './party-bot';
import { WEAPONS } from './weapons';
import { removeLostEquipment } from './workshop';

// Лише зброя: без найму вчених, протоколів, предметів і перехоплювачів (ізоляція кроку).
const W: PartyBotPolicy = { ...DEFAULT_PARTY_POLICY, name: 'w', weapons: true };

function party(roles: (null | 'assault' | 'sniper' | 'medic')[], done: string[] = ['shotgun', 'mg', 'sniper']): Party {
  const p = createParty(42, 'норма');
  p.econ.money = 5000;
  p.roster.soldiers = p.roster.soldiers.slice(0, 3); // троє — по одному на роль
  p.research.completed.push(...(done as Party['research']['completed']));
  p.roster.soldiers.forEach((s, i) => (p.roster.careers[s.id].role = roles[i] ?? null));
  return p;
}
const weaponOf = (p: Party, i: number) => p.workshop.equipped[p.roster.soldiers[i].id]?.weapon ?? 'rifle';

describe('botWeapon: зброя за роллю', () => {
  it('снайпер — «Голка», штурмовик — «Шквал», медик і без ролі — «Град»', () => {
    const p = party(['sniper', 'assault', 'medic']);
    const s = p.roster.soldiers;
    expect([botWeapon(p, s[0]), botWeapon(p, s[1]), botWeapon(p, s[2])]).toEqual(['sniper', 'shotgun', 'mg']);
    p.roster.careers[s[2].id].role = null;
    expect(botWeapon(p, s[2])).toBe('mg');
  });

  it('протокол не завершено — null (лишається чинна зброя)', () => {
    const p = party(['sniper', 'assault', null], ['mg']);
    const s = p.roster.soldiers;
    expect([botWeapon(p, s[0]), botWeapon(p, s[1]), botWeapon(p, s[2])]).toEqual([null, null, 'mg']);
  });
});

describe('partyBotScienceStep: виріб і видача зброї', () => {
  it('черга порожня — одне замовлення за дефіцитом у порядку FORGE_WEAPONS; ціна — з резервом', () => {
    const p = party(['sniper', 'assault', null]);
    partyBotScienceStep(p, W);
    expect(p.workshop.queue.map((o) => o.id)).toEqual(['shotgun']);
    expect(p.econ.money).toBe(5000 - 60);
    partyBotScienceStep(p, W); // черга зайнята — нового замовлення немає
    expect(p.workshop.queue).toHaveLength(1);
  });

  it('склад покриває дефіцит — не замовляє; видає за роллю зі складу', () => {
    const p = party(['sniper', 'assault', null]);
    p.workshop.store.shotgun = 1;
    p.workshop.store.sniper = 1;
    p.workshop.store.mg = 1;
    partyBotScienceStep(p, W);
    expect(p.workshop.queue).toEqual([]);
    expect([weaponOf(p, 0), weaponOf(p, 1), weaponOf(p, 2)]).toEqual(['sniper', 'shotgun', 'mg']);
    expect(p.roster.soldiers.map((s) => s.weapon)).toEqual([WEAPONS.sniper, WEAPONS.shotgun, WEAPONS.mg]);
    expect([p.workshop.store.shotgun, p.workshop.store.sniper, p.workshop.store.mg]).toEqual([0, 0, 0]);
  });

  it('роль змінила потребу: «Град» повертається на склад, коли новобранець стає снайпером', () => {
    const p = party([null, null, null]);
    p.workshop.store.mg = 1;
    partyBotScienceStep(p, W);
    expect(weaponOf(p, 0)).toBe('mg');
    p.roster.careers[p.roster.soldiers[0].id].role = 'sniper';
    p.workshop.store.sniper = 1;
    partyBotScienceStep(p, W);
    expect(weaponOf(p, 0)).toBe('sniper');
    // «Град» на складі — і видано тому, кому він за роллю (другому новобранцеві)
    expect([weaponOf(p, 1), p.workshop.store.mg]).toEqual(['mg', 0]);
  });

  it('озброєний за роллю — не в дефіциті (аудит PR #533): склад порожній, замовлення немає', () => {
    const p = party([null, null, null], ['mg']);
    p.workshop.store.mg = 3;
    partyBotScienceStep(p, W);
    expect([weaponOf(p, 0), weaponOf(p, 1), weaponOf(p, 2), p.workshop.store.mg]).toEqual(['mg', 'mg', 'mg', 0]);
    partyBotScienceStep(p, W);
    expect(p.workshop.queue).toEqual([]);
  });

  it('гроші нижче резерву — без замовлення; протокол не завершено — без замовлення і видачі', () => {
    const p = party(['sniper', 'assault', null]);
    p.econ.money = W.hireReserve + 59; // «Шквал» 60 — після оплати лишилось би менше резерву
    partyBotScienceStep(p, W);
    expect(p.workshop.queue.map((o) => o.id)).not.toContain('shotgun');
    const q = party(['sniper', 'assault', null], []);
    q.workshop.store.mg = 1;
    partyBotScienceStep(q, W);
    expect(q.workshop.queue).toEqual([]);
    expect([weaponOf(q, 0), weaponOf(q, 1), weaponOf(q, 2)]).toEqual(['rifle', 'rifle', 'rifle']);
  });

  it('у лікарні — не рахується в дефіцит і не отримує; зброя загиблого — на склад і далі іншому', () => {
    const p = party([null, null, null]);
    const [a, b] = p.roster.soldiers;
    p.roster.hospital[b.id] = 10;
    p.roster.hospital[p.roster.soldiers[2].id] = 10;
    expect(readySoldiers(p.roster)).toHaveLength(1);
    partyBotScienceStep(p, W);
    expect(p.workshop.queue.map((o) => o.id)).toEqual(['mg']); // дефіцит 1 — лише боєготовий
    p.workshop.queue = [];
    p.workshop.store.mg = 1;
    partyBotScienceStep(p, W);
    expect([weaponOf(p, 0), weaponOf(p, 1)]).toEqual(['mg', 'rifle']);
    removeLostEquipment(p.workshop, [a]);
    expect(p.workshop.store.mg).toBe(1);
  });

  it('без поля `weapons` — зброю не замовляє і не видає (політики до п20.6)', () => {
    const p = party(['sniper', 'assault', null]);
    p.workshop.store.mg = 1;
    partyBotScienceStep(p, { ...W, weapons: undefined });
    expect(p.workshop.queue).toEqual([]);
    expect(weaponOf(p, 2)).toBe('rifle');
    expect(CAMPAIGN_POLICY.weapons).toBe(true);
    expect(DEFAULT_PARTY_POLICY.weapons).toBeUndefined();
  });
});
