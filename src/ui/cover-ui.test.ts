// п20.5 (ADR-0169; EARS 4 Фази 20): щиток укриття в прев'ю ходу і рядок укриття в меню на ворогові.
import { describe, expect, it } from 'vitest';
import { RIFLE, createGame, makeUnit, mulberry32, type GameMap, type GameState, type Unit, type Vec2 } from '../core/combat';
import { makeEnemy } from '../core/enemies';
import { coverMenuLine, previewCover } from './cover-ui';
import { enemyMenuHtml, enemyMenuView } from './enemy-menu';

const k = (p: Vec2): string => p.x + ',' + p.y;
const mapOf = (walls: Vec2[], low: Vec2[] = []): GameMap => ({
  width: 20,
  height: 12,
  blocked: new Set(walls.map(k)),
  low: new Set(low.map(k)),
});
const game = (map: GameMap, units: Unit[], cover: boolean): GameState =>
  createGame({ map, units, rng: mulberry32(7), startingSide: 'player', cover });
const all = (st: GameState): Set<string> => new Set(st.units.map((u) => k(u.pos)));

describe('previewCover: щиток на клітинці цілі ходу — найслабше від видимих ворогів', () => {
  const me = makeUnit({ id: 's1', side: 'player', pos: { x: 2, y: 5 }, weapon: RIFLE });
  const T: Vec2 = { x: 5, y: 5 };
  const east = makeEnemy('demon', 'a1', 0, { x: 10, y: 5 });

  it('стіна з боку ворога — повне, низька перешкода — пів, відкрито — без щитка', () => {
    let st = game(mapOf([{ x: 6, y: 4 }]), [me, east], true);
    expect(previewCover(st, me, T, all(st))).toBe('full');
    st = game(mapOf([], [{ x: 6, y: 4 }]), [me, east], true);
    expect(previewCover(st, me, T, all(st))).toBe('half');
    st = game(mapOf([]), [me, east], true);
    expect(previewCover(st, me, T, all(st))).toBe(null);
  });

  it('фланг хоч від одного видимого — без щитка; невидимий ворог не рахується', () => {
    const west = makeEnemy('demon', 'a2', 1, { x: 9, y: 9 });
    const st = game(mapOf([{ x: 6, y: 4 }]), [me, east, west], true);
    expect(previewCover(st, me, T, all(st))).toBe(null); // з (9,9) — відкрито
    expect(previewCover(st, me, T, new Set([k(me.pos), k(east.pos)]))).toBe('full'); // (9,9) у тумані
  });

  it('жоден видимий не дістає (поза вогнем), бій без опції cover, загиблий ворог — без щитка', () => {
    let st = game(mapOf([{ x: 6, y: 4 }]), [me, east], true);
    expect(previewCover(st, me, T, new Set([k(me.pos)]))).toBe(null);
    st = game(mapOf([{ x: 6, y: 4 }]), [me, east], false);
    expect(previewCover(st, me, T, all(st))).toBe(null);
    const dead = { ...makeEnemy('demon', 'a3', 0, { x: 10, y: 5 }), alive: false };
    st = game(mapOf([{ x: 6, y: 4 }]), [me, dead], true);
    expect(previewCover(st, me, T, all(st))).toBe(null);
  });
});

describe('coverMenuLine і рядок укриття в меню на ворогові (рішення власника «А. З множником»)', () => {
  it('тексти — з множником COVER_MULT, з комою; без укриття — рядка немає', () => {
    expect(coverMenuLine('full')).toBe('Укриття: повне · шанс ×0,5');
    expect(coverMenuLine('half')).toBe('Укриття: пів · шанс ×0,75');
    expect(coverMenuLine('none')).toBe('Фланг: шанс ×1,2');
    expect(coverMenuLine(undefined)).toBe(null);
  });

  it('меню: рядок укриття цілі від обраного бійця під відстанню; бій без cover — без рядка', () => {
    const me = makeUnit({ id: 's1', side: 'player', pos: { x: 10, y: 5 }, weapon: RIFLE });
    const foe = makeEnemy('demon', 'a1', 0, { x: 5, y: 5 });
    let st = game(mapOf([{ x: 6, y: 4 }]), [me, foe], true);
    let v = enemyMenuView(st, foe, me);
    expect(v.shooter!.cover).toBe('full');
    const html = enemyMenuHtml(v);
    expect(html).toContain('<div class="em-line em-cover" data-cover="full">Укриття: повне · шанс ×0,5</div>');
    expect(html.indexOf('Відстань 5')).toBeLessThan(html.indexOf('em-cover'));
    st = game(mapOf([{ x: 6, y: 4 }]), [me, foe], false);
    v = enemyMenuView(st, foe, me);
    expect(v.shooter!.cover).toBe(undefined);
    expect(enemyMenuHtml(v)).not.toContain('em-cover');
    // без обраного бійця — картка лише з інформацією, рядка укриття немає
    expect(enemyMenuHtml(enemyMenuView(st, foe, undefined))).not.toContain('em-cover');
  });
});
