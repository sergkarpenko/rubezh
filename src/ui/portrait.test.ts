// @vitest-environment jsdom
// п21.4 (Т.222, ADR-0178; EARS 4 Фази 21): мальований бюст оперативника й техноманта (ростер і штат — panels.test.ts,
// research-panel.test.ts; смуга загону — тут).
import { describe, expect, it } from 'vitest';
import { makeUnit, type GameState } from '../core/combat';
import { SOLDIER_NAMES } from '../core/squad';
import { createResearch, hireScientist } from '../core/research';
import { createEconomy } from '../core/economy';
import { isFeminineName } from './text';
import { PORTRAITS_PER_GENDER, PORTRAIT_INSET, portraitCell, portraitHtml } from './portrait';
import { helmetSvg } from './avatar';
import { SQUAD_AVATAR, SQUAD_CLIP_PREFIX, squadCards, squadStripHtml } from './squad-strip';

const dom = (html: string): HTMLElement => {
  const box = document.createElement('div');
  box.innerHTML = html;
  return box;
};

describe('portraitCell', () => {
  it('оперативник s<N>: ряд 0, стать — за іменем пулу, обличчя — по колу в пулі своєї статі', () => {
    SOLDIER_NAMES.forEach((name, i) => {
      const c = portraitCell('s' + (i + 1))!;
      expect(c.row).toBe(0);
      expect(c.col >= PORTRAITS_PER_GENDER).toBe(isFeminineName(name));
    });
    expect(['s1', 's3', 's5', 's7', 's9'].map((id) => portraitCell(id)!.col)).toEqual([0, 1, 2, 3, 0]);
    expect(['s2', 's4', 's6', 's8', 's10'].map((id) => portraitCell(id)!.col)).toEqual([4, 5, 6, 7, 4]);
    expect(portraitCell('s13')).toEqual(portraitCell('s5')); // друге коло пулу імен (Іван 2) — те саме правило
  });

  it('техномант в<N>: ряд 1, стать — за іменем штату (Зінаїда, Ярослав, …; «Микола» і «Любов» — явним переліком)', () => {
    const female = ['Зінаїда', 'Меланія', 'Дарія', 'Оксана', 'Ірина', 'Любов'];
    const econ = createEconomy();
    econ.money = 10_000;
    const r = createResearch();
    for (let i = 0; i < 12; i++) hireScientist(econ, r);
    for (const s of r.scientists) {
      const c = portraitCell(s.id)!;
      expect(c.row).toBe(1);
      expect(c.col >= PORTRAITS_PER_GENDER).toBe(female.includes(s.name));
    }
  });

  it('турель, ворог, порожній чи нульовий номер — без бюста', () => {
    for (const id of ['t1', 'd1', 'x', 's0', 'в0', 'sx']) expect(portraitCell(id)).toBeNull();
  });
});

describe('portraitHtml', () => {
  it('шолом кодом під бюстом (запасний вигляд), кліп і колір — як у helmetSvg; спрайт атласа зі зсувом клітинки', () => {
    const box = dom(portraitHtml('s4', 24, 'p-'));
    const pt = box.querySelector<HTMLElement>('.pt')!;
    expect(pt.dataset.portrait).toBe('5,0');
    expect(pt.style.width).toBe('24px');
    expect(pt.querySelector('svg.avatar')!.outerHTML).toBe(dom(helmetSvg('s4', 24, 'p-')).innerHTML);
    const i = pt.querySelector<HTMLElement>('i')!;
    const inner = 24 - 2 * PORTRAIT_INSET;
    expect(i.style.inset).toBe(PORTRAIT_INSET + 'px');
    expect(i.style.backgroundSize).toBe(inner * 8 + 'px ' + inner * 2 + 'px');
    expect(i.style.backgroundPosition).toBe(-5 * inner + 'px 0px');
    expect(dom(portraitHtml('в2', 32)).querySelector<HTMLElement>('.pt i')!.style.backgroundPosition).toBe('0px -28px');
  });

  it('без клітинки (турель) — лише шолом', () => {
    expect(portraitHtml('t1')).toBe(helmetSvg('t1'));
  });
});

describe('смуга загону', () => {
  it('картка оперативника — бюст SQUAD_AVATAR px з кліпом смуги', () => {
    const s = { units: [makeUnit({ id: 's2', side: 'player', name: 'Олена', pos: { x: 0, y: 0 } })] } as unknown as GameState;
    const box = dom(squadStripHtml(squadCards(s, ['s2'], null)));
    const pt = box.querySelector<HTMLElement>('.pt')!;
    expect(pt.dataset.portrait).toBe('4,0');
    expect(pt.style.width).toBe(SQUAD_AVATAR + 'px');
    expect(pt.querySelector('clipPath')!.id).toBe(SQUAD_CLIP_PREFIX + 's2');
  });
});
