// src/ui/broods-ui.test.ts
// п22.6 (ADR-0188): тексти виводків і чемпіона — журнал старту бою, трофеї, меню на ворогові (рішення власника).

import { describe, expect, it } from 'vitest';
import { createGame, makeUnit, mulberry32, type Unit } from '../core/combat';
import { applyBroods } from '../core/broods';
import { makeEnemies } from '../core/enemies';
import { awardTrophies, createResearch } from '../core/research';
import { broodLines, researchEventText } from './journal';
import { enemyMenuHtml, enemyMenuView } from './enemy-menu';

describe('п22.6: рядок трофеїв', () => {
  it('убитий чемпіон — «чемпіон +1» після типів', () => {
    const r = createResearch();
    const u = makeUnit({ id: 'a1', side: 'alien', name: 'Демон', pos: { x: 0, y: 0 }, firingAccuracy: 0.5 });
    u.alive = false;
    u.champion = true;
    awardTrophies(r, { units: [u] }, 'перемога');
    expect(researchEventText(r.log.at(-1)!)?.text).toBe('⚑ Трофеї: демон +1, чемпіон +1');
  });
});

describe('п22.6: тексти — журнал старту бою і меню на ворогові', () => {
  const mk = (
    kinds: ('demon' | 'hound' | 'golem' | 'eye')[],
    brood: 'ash' | 'rust' | 'shadow' | 'mixed',
    seed = 1,
    champion = false
  ): Unit[] => {
    const al = makeEnemies(
      kinds,
      kinds.map((_, i) => ({ x: i, y: 0 })),
      seed
    );
    applyBroods(al, seed, { brood, threat: champion ? 99 : 0, champion });
    return al;
  };

  it('один виводок — з особливістю, лише демони — без неї; без виводку — нічого', () => {
    expect(broodLines(mk(['demon', 'hound'], 'ash'))).toEqual(['☠ Виводок «Попіл»: +1 шкоди']);
    expect(broodLines(mk(['demon', 'demon'], 'rust'))).toEqual(['☠ Виводок «Іржа»']);
    expect(broodLines(makeEnemies(['demon'], [{ x: 0, y: 0 }], 1))).toEqual([]);
  });

  it('Брама — перелік виводків порядком каталогу; чемпіон — окремий рядок', () => {
    for (let seed = 0; seed < 200; seed++) {
      const al = mk(['demon', 'hound', 'golem', 'eye', 'hound', 'eye'], 'mixed', seed);
      const ids = new Set(al.filter((u) => u.kind !== undefined).map((u) => u.brood));
      if (ids.size !== 3) continue;
      expect(broodLines(al)).toEqual(['☠ Виводки: «Попіл» +1 шкоди, «Іржа» +1 броні, «Тінь» −20 % до влучання']);
      break;
    }
    for (let seed = 0; seed < 200; seed++) {
      const al = mk(['demon', 'golem'], 'ash', seed, true);
      const c = al.find((u) => u.champion);
      if (!c) continue;
      expect(broodLines(al)).toEqual(['☠ Виводок «Попіл»', '♛ Чемпіон: ' + c.name + ' — HP 24, «Попіл» +2 шкоди']);
      return;
    }
    throw new Error('сід не знайдено');
  });

  it('меню: рядок виводку, шкода з бонусом «Попелу», кільце й вінець бюста; демон — без особливості', () => {
    const st = createGame({ map: { width: 6, height: 1, blocked: new Set() }, units: mk(['demon', 'hound'], 'ash'), rng: mulberry32(1) });
    const [demon, hound] = st.units;
    const hv = enemyMenuView(st, hound, undefined);
    expect(hv.brood).toEqual({ id: 'ash', name: 'Попіл', effect: '+1 шкоди' });
    const h = enemyMenuHtml(hv);
    expect(h).toContain('<div class="em-line em-brood" data-brood="ash">Виводок «Попіл»: +1 шкоди</div>');
    expect(h).toContain('Шкода ' + (hound.weapon.damage[0] + 1) + '–' + (hound.weapon.damage[1] + 1));
    expect(h).toContain('data-brood="ash" style=');
    expect(enemyMenuHtml(enemyMenuView(st, demon, undefined))).toContain('>Виводок «Попіл»</div>');
    hound.champion = true;
    const ch = enemyMenuHtml(enemyMenuView(st, hound, undefined));
    expect(ch).toContain('♛ Чемпіон · Виводок «Попіл»');
    expect(ch).toContain('data-champion="1"');
    const plain = makeEnemies(['demon'], [{ x: 0, y: 0 }], 1)[0];
    expect(enemyMenuHtml(enemyMenuView(st, plain, undefined))).not.toContain('em-brood');
  });
});
