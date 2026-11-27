// п21.4 (Т.222, ADR-0178; EARS 4 Фази 21): мальований бюст оперативника чи техноманта з атласа
// assets/portraits.png (768 × 192, клітинки 96 × 96; ряд 0 — оперативники, ряд 1 — техноманти;
// стовпці 0–3 — чоловіки, 4–7 — жінки). Клітинка — за id назавжди (як `fighterLook`, ADR-0118):
// стать — за парністю порядкового номера, бо пули імен чергуються (SOLDIER_NAMES — чоловік, жінка, …;
// SCIENTIST_NAMES — жінка, чоловік, …), обличчя — наступне в пулі своєї статі по колу.
// Бюст лягає поверх шолома кодом: якщо картинка не завантажилась — видно шолом (запасний вигляд).
import { helmetSvg } from './avatar';
import portraitsUrl from '../../assets/portraits.png';

export const PORTRAIT_CELL = 96;
export const PORTRAIT_COLS = 8;
export const PORTRAIT_ROWS = 2;
export const PORTRAITS_PER_GENDER = 4;
export const PORTRAIT_INSET = 2; // кільце кольору шолома (stroke 2) лишається видимим довкола бюста
// Кільце техноманта — фіолет техномагії (`docs/design/setting.md`, «Палітра»): у штату немає кольору бійця
export const TECHNOMANCER_RING = '#8A2BE2';

export interface PortraitCell {
  col: number;
  row: number;
}

// Оперативник `s<N>` (ростер, `rosterSoldier`) — ряд 0, перший у пулі — чоловік;
// техномант `в<N>` (`hireScientist`) — ряд 1, перший у пулі — жінка. Інше (турелі `t<N>`) — без бюста.
export function portraitCell(id: string): PortraitCell | null {
  const m = /^(s|в)(\d+)$/.exec(id);
  if (m === null || Number(m[2]) < 1) return null;
  const index = Number(m[2]) - 1;
  const operative = m[1] === 's';
  const female = operative ? index % 2 === 1 : index % 2 === 0;
  const face = Math.floor(index / 2) % PORTRAITS_PER_GENDER;
  return { col: (female ? PORTRAITS_PER_GENDER : 0) + face, row: operative ? 0 : 1 };
}

// Аватар size × size CSS px: шолом кодом (кільце кольору бійця) і поверх нього — бюст у колі.
export function portraitHtml(id: string, size = 24, clipPrefix?: string): string {
  const helmet = helmetSvg(id, size, clipPrefix, id.startsWith('в') ? TECHNOMANCER_RING : undefined);
  const cell = portraitCell(id);
  if (cell === null) return helmet;
  const inner = size - 2 * PORTRAIT_INSET;
  const k = inner / PORTRAIT_CELL;
  return (
    '<span class="pt" data-portrait="' +
    cell.col +
    ',' +
    cell.row +
    '" style="width:' +
    size +
    'px;height:' +
    size +
    'px">' +
    helmet +
    '<i style="inset:' +
    PORTRAIT_INSET +
    'px;background-image:url(' +
    portraitsUrl +
    ');background-size:' +
    +(PORTRAIT_CELL * PORTRAIT_COLS * k).toFixed(2) +
    'px ' +
    +(PORTRAIT_CELL * PORTRAIT_ROWS * k).toFixed(2) +
    'px;background-position:' +
    -+(cell.col * inner).toFixed(2) +
    'px ' +
    -+(cell.row * inner).toFixed(2) +
    'px"></i></span>'
  );
}
