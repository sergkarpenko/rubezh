// п20.5 (ADR-0169; EARS 4 Фази 20): укриття в UI бою — щиток у прев'ю ходу і рядок у меню на ворогові.
// Чисті функції: стан бою → рівень укриття / текст; малювання щитка — drawCoverShield у src/render.ts.
import { COVER_MULT, type CoverLevel, type GameState, type Unit, type Vec2 } from '../core/combat';
import { COVER_SCORE, coverRank } from '../core/ai-utils';

// Щиток на клітинці цілі ходу (рішення власника «А. Найслабше»): найгірше укриття клітинки goal
// від видимих гравцеві ворогів, що дістають її (дальність і лінія огляду — як у ШІ, coverRank);
// фланг хоч від одного — без щитка; жоден видимий не дістає — теж без щитка (укриття не діє).
// Бій без опції `cover` (демо) — без щитка.
export function previewCover(state: GameState, sel: Unit, goal: Vec2, visible: ReadonlySet<string>): 'half' | 'full' | null {
  if (!state.cover) return null;
  const enemies = state.units.filter((u) => u.alive && u.side !== sel.side && visible.has(u.pos.x + ',' + u.pos.y));
  const rank = coverRank(state, sel, goal, enemies);
  return rank === COVER_SCORE.full ? 'full' : rank === COVER_SCORE.half ? 'half' : null;
}

// Рядок меню на ворогові (рішення власника «А. З множником»): укриття цілі від обраного бійця.
// undefined — укриття не діє (бій без `cover`, удар впритул) — рядка немає.
export function coverMenuLine(cover: CoverLevel | undefined): string | null {
  if (cover === undefined) return null;
  const k = '×' + String(COVER_MULT[cover]).replace('.', ',');
  if (cover === 'full') return 'Укриття: повне · шанс ' + k;
  if (cover === 'half') return 'Укриття: пів · шанс ' + k;
  return 'Фланг: шанс ' + k;
}
