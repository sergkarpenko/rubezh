// Т.33: підсумок ходу демонів Розриву і картка результату бою (src/ui/battle-feedback.ts).
import { describe, expect, it } from 'vitest';
import { makeUnit, type GameEvent } from '../core/combat';
import { resultCardHtml, summarizeAlienTurn } from './battle-feedback';

const ivan = makeUnit({ id: 'p1', name: 'Іван', side: 'player', pos: { x: 1, y: 1 } });
const olena = makeUnit({ id: 'p2', name: 'Олена', side: 'player', pos: { x: 2, y: 1 }, alive: false });
const near = makeUnit({ id: 'a1', side: 'alien', pos: { x: 5, y: 1 } });
const far = makeUnit({ id: 'a2', side: 'alien', pos: { x: 15, y: 15 } });
const gone = makeUnit({ id: 'a3', side: 'alien', pos: { x: 6, y: 1 }, alive: false });
const units = [ivan, olena, near, far, gone];
const shot = (shooterId: string, targetId: string, hit: boolean, damage = 0): GameEvent => ({
  type: 'shot',
  shooterId,
  targetId,
  mode: 'snap',
  hit,
  damage,
});

describe('summarizeAlienTurn: підсумок ходу демонів Розриву', () => {
  it('без пострілів — «Демони не атакували», у полі зору лише живі демони видимих клітинок', () => {
    const events: GameEvent[] = [{ type: 'move', unitId: 'a2', from: { x: 16, y: 15 }, to: { x: 15, y: 15 } }];
    expect(summarizeAlienTurn(events, units, new Set(['5,1', '6,1']))).toEqual(['Демони не атакували.', 'Демонів у полі зору: 1']);
  });

  it('постріли, втрати HP поіменно, загиблі за родом, дозор із результатом', () => {
    const events: GameEvent[] = [
      shot('p1', 'a3', true, 5), // дозор: влучання і знищення
      { type: 'death', unitId: 'a3', killerId: 'p1' },
      shot('p1', 'a1', false), // дозор: промах
      shot('p1', 'a1', true, 2), // дозор: влучання без знищення
      shot('a1', 'p1', true, 3),
      shot('a1', 'p1', true, 1),
      shot('a2', 'p1', false),
      shot('a2', 'p2', true, 9),
      { type: 'death', unitId: 'p2', killerId: 'a2' },
      shot('zz', 'p1', true, 1), // невідомий стрілець — пропускається
    ];
    expect(summarizeAlienTurn(events, units, new Set())).toEqual([
      'Пострілів по загону: 4, влучань: 3',
      'Іван: −4 HP',
      '✝ Олена загинула',
      'Дозор: Іван — влучання, демона знищено',
      'Дозор: Іван — промах',
      'Дозор: Іван — влучання',
      'Демонів у полі зору: 0',
    ]);
  });
});

describe('resultCardHtml: картка результату бою', () => {
  it('перемога: хід, демони, премія, поранені й загиблі', () => {
    const html = resultCardHtml({
      turns: 7,
      killed: 4,
      aliens: 4,
      bonus: 300,
      wounded: ['Іван — лікарня: 8 тіків'],
      lost: ['Олена — загинула'],
    });
    expect(html).toContain('<span>Ходів</span><b>7</b>');
    expect(html).toContain('<span>Демонів знищено</span><b>4 з 4</b>');
    expect(html).toContain('<span>Премія</span><b>+300 кр.</b>');
    expect(html).toContain('<div class="rwound">✚ Іван — лікарня: 8 тіків</div>');
    expect(html).toContain('<div class="lose">✝ Олена — загинула</div>');
  });

  it('без премії — «немає»', () => {
    expect(resultCardHtml({ turns: 2, killed: 1, aliens: 4, bonus: null, wounded: [], lost: [] })).toContain('<b>немає</b>');
  });
});
