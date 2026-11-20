// @vitest-environment jsdom
// П13.2 (ADR-0066): юніт-тести вертикального тулбара (src/ui/toolbar.ts).
// Критерій П13.2 (1): перелік дій — усі чинні дії бою у плитках (id, підписи,
// іконки-канви), клік → onAction з id дії. Причини блокування та
// «renderBattle не чіпає іконки» (idle → 0 перерисовок) — у src/ui/battle.test.ts
// (там готова фікстура бою); іконки малюються матрицями один раз при створенні.
// П13.3 (ADR-0067): остання плитка — перемикач авто-бою «Авто»/«Стоп».
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EVAC_AP_COST,
  GRENADE_AP_COST,
  GRENADE_DAMAGE,
  GRENADE_RANGE,
  HEAL_AP_COST,
  HEAL_AMOUNT,
  OVERWATCH_AP_COST,
  RIFLE,
} from '../core/combat';
import { ICON_SIZE, TOOLBAR_ACTIONS, createToolbar, drawToolbarIcon, type ToolbarActionId } from './toolbar';

// No-op контекст малювання — той самий патерн, що й у battle.test.ts (jsdom
// без пакета canvas); журнал операцій ловить малювання іконок.
const canvasOps: string[] = [];
const noopCtx = new Proxy(
  {},
  {
    get: (_t, p) => {
      if (p === 'canvas') return undefined;
      return (...args: unknown[]) => {
        canvasOps.push(String(p) + '(' + args.map((a) => String(a)).join(',') + ')');
        return undefined;
      };
    },
    set: (_t, p, v) => {
      canvasOps.push('set:' + String(p) + '=' + String(v));
      return true;
    },
  }
) as unknown as CanvasRenderingContext2D;

beforeEach(() => {
  // Плитки генерує createToolbar — як і в застосунку (контейнер #btoolbar).
  document.body.innerHTML = '<div id="btoolbar"></div>';
  canvasOps.length = 0;
  const proto = HTMLCanvasElement.prototype as unknown as { getContext: () => CanvasRenderingContext2D };
  proto.getContext = () => noopCtx;
});

describe('Т.33: ціна в AP і клавіша в кутках плитки', () => {
  it('ціна — з констант ядра, клавіша — як у обробнику клавіш; «Кінець» без ціни, «Авто» без обох', () => {
    createToolbar(document.getElementById('btoolbar')!, { onAction: () => {} });
    const corner = (id: string, cls: string): string | null => document.querySelector('#' + id + ' .' + cls)?.textContent ?? null;
    const got = TOOLBAR_ACTIONS.map((a) => [a.btnId, corner(a.btnId, 'tb-ap'), corner(a.btnId, 'tb-key')]);
    expect(got).toEqual([
      ['btn-snap', RIFLE.modes.snap.apCost + ' AP', '1'],
      ['btn-aimed', RIFLE.modes.aimed.apCost + ' AP', '2'],
      ['btn-auto', RIFLE.modes.auto.apCost + ' AP', '3'],
      ['btn-ow', OVERWATCH_AP_COST + ' AP', 'O'],
      ['btn-medkit', HEAL_AP_COST + ' AP', 'M'],
      ['btn-grenade', GRENADE_AP_COST + ' AP', 'G'],
      ['btn-evac', EVAC_AP_COST + ' AP', 'V'],
      ['btn-end', null, 'E'],
      ['btn-auto-battle', null, null],
    ]);
  });
});

describe('тулбар: перелік дій (П13.2, ADR-0066)', () => {
  it('плитки — усі чинні дії бою (id, підписи, іконки); клік → onAction; «Авто»/«Стоп» — перемикач авто-бою (П13.3)', () => {
    const onAction = vi.fn();
    createToolbar(document.getElementById('btoolbar')!, { onAction });
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('#btoolbar button')];
    expect(buttons.map((b) => b.id)).toEqual(TOOLBAR_ACTIONS.map((a) => a.btnId)); // той самий порядок
    expect(TOOLBAR_ACTIONS.map((a) => a.id)).toEqual(['snap', 'aimed', 'auto', 'ow', 'medkit', 'grenade', 'evac', 'end', 'auto-battle']);
    expect(TOOLBAR_ACTIONS.map((a) => a.label)).toEqual([
      'Швидкий',
      'Прицільний',
      'Черга',
      'Дозор',
      'Лікування',
      'Граната',
      'Евакуація',
      'Кінець',
      'Авто',
    ]);
    for (const b of buttons) {
      const icon = b.querySelector('canvas.tb-icon') as HTMLCanvasElement;
      expect(icon).not.toBeNull(); // іконка на кожній плитці
      expect(icon.width).toBe(ICON_SIZE); // 12×12 @2× = 24px (ADR-0031: ціле кратне)
      expect(icon.height).toBe(ICON_SIZE);
      expect((b.querySelector('.tb-cap') as HTMLElement).textContent).toBe(b.getAttribute('aria-label')); // підпис = aria-label
      expect(b.dataset.action).toBe(b.id.replace('btn-', '')); // семантичний ід дії
    }
    for (const b of document.querySelectorAll<HTMLButtonElement>('#btoolbar button')) b.click();
    expect(onAction.mock.calls.map((c) => c[0] as ToolbarActionId)).toEqual(TOOLBAR_ACTIONS.map((a) => a.id));
  });

  it('іконки малюються матрицями при створенні (fillRect пікселів, без RNG)', () => {
    createToolbar(document.getElementById('btoolbar')!, { onAction: vi.fn() });
    expect(canvasOps.some((op) => op.startsWith('fillRect('))).toBe(true);
  });

  it('headless без 2d-контексту — без винятку (тести від канви не залежать)', () => {
    const bare = { getContext: () => null } as unknown as HTMLCanvasElement;
    expect(() => drawToolbarIcon(bare, TOOLBAR_ACTIONS[0]!.icon)).not.toThrow();
  });
});

// П12.5 (ADR-0065): числові підписи механіки на плитках — числа ТІЛЬКИ з
// констант каталогу combat.ts (одне місце правди, не дублі руками).
describe('тулбар: числові підказки механіки з констант (П12.5, ADR-0065)', () => {
  const hint = (id: ToolbarActionId): string => TOOLBAR_ACTIONS.find((a) => a.id === id)!.hint;

  it('режими пострілу: AP, множник, кулі — з RIFLE.modes', () => {
    for (const mode of ['snap', 'aimed', 'auto'] as const) {
      const m = RIFLE.modes[mode];
      expect(hint(mode)).toContain(m.apCost + ' AP');
      expect(hint(mode)).toContain('×' + m.accuracyMod);
      expect(hint(mode)).toContain(m.shots + (m.shots === 1 ? ' куля' : ' кулі'));
    }
  });

  it('дозор і лікування: AP з констант, +N HP лікування', () => {
    expect(hint('ow')).toContain(OVERWATCH_AP_COST + ' AP');
    expect(hint('medkit')).toContain(HEAL_AP_COST + ' AP');
    expect(hint('medkit')).toContain('+' + HEAL_AMOUNT + ' HP');
  });

  it('граната: AP, пошкодження 3–5, дальність, уражає і своїх — з констант', () => {
    const g = hint('grenade');
    expect(g).toContain(GRENADE_AP_COST + ' AP');
    expect(g).toContain('пошкодження ' + GRENADE_DAMAGE[0] + '–' + GRENADE_DAMAGE[1]);
    expect(g).toContain('≤' + GRENADE_RANGE);
    expect(g).toContain('уражає і своїх');
  });

  it('Т.71: евакуація — AP з константи, синя клітинка висадки, без премії, клавіша V', () => {
    expect(hint('evac')).toBe(
      EVAC_AP_COST +
        ' AP · оперативник на синій клітинці висадки покидає бій; якщо евакуювати весь загін, премії за місію немає · клавіша V'
    );
  });
});
