// пR.2 (ADR-0037): ввід тактичного бою — винесено з main.ts без зміни
// поведінки (П6.4/П6.14/П6.16). Тут — клік/hover/leave бойовища (вибір
// солдата, тап-патерн руху і пострілу, туман і лінія вогню), зведення режимів
// пострілу, дозор, кінець ходу (синхронний хід прибульців), гарячі клавіші
// 1/2/3/O/E/Esc і чиста клік-математика (cellFromPoint, samePath, sameCell).
// Стан бою — спільний об'єкт BattleUIState (модуль battle), дії бою —
// інтерфейс BattleUI; демо-драйвер і повне перемалювання — через Deps.

import {
  OVERWATCH_AP_COST,
  calculateHitChance,
  distance,
  endTurn,
  hasLineOfSight,
  moveUnit,
  resolveAttack,
  setOverwatch,
  type ShotMode,
  type Vec2,
} from '../core/combat';
import { findPath, pathApCost } from '../core/map';
import { aliensTurn } from '../bot';
import { el } from './dom';
import { BCELL } from './grid';
import { MODE_LABEL } from './journal';
import type { BattleUI, BattleUIState } from './battle';

// П7: чиста частина cellFromEvent — координати вікна (CSS) → клітинка бойовища
// (buffer-розмір канви / BCELL); rect — getBoundingClientRect канви.
export function cellFromPoint(
  cx: number,
  cy: number,
  rect: { left: number; top: number; width: number; height: number },
  canvas: { width: number; height: number }
): Vec2 {
  return {
    x: Math.floor((((cx - rect.left) / rect.width) * canvas.width) / BCELL),
    y: Math.floor((((cy - rect.top) / rect.height) * canvas.height) / BCELL),
  };
}

// П7: той самий шлях під курсором? (без перерисовки на кожен піксель)
export function samePath(a: Vec2[] | null, b: Vec2[] | null): boolean {
  if (a === null || b === null) return false;
  return a.length === b.length && a.every((p, i) => p.x === b[i].x && p.y === b[i].y);
}

// П6.14: та сама клітинка? (порівняння nullable-клітинок без перерисовок)
export function sameCell(a: Vec2 | null, b: Vec2 | null): boolean {
  if (a === null || b === null) return a === b;
  return a.x === b.x && a.y === b.y;
}

// Залежності від шару застосунку (main.ts).
export interface InputDeps {
  renderAll(): void;
  demoBusy(): boolean; // П6.16: триває демо — керування заблоковано
}

export interface InputUI {
  battleCanvasClick(ev: MouseEvent): void;
  battleCanvasHover(ev: MouseEvent): void;
  battleCanvasLeave(): void;
  armFire(mode: ShotMode): void;
  armOverwatch(): void;
  endPlayerTurn(): void;
  onKeyDown(ev: KeyboardEvent): void;
}

export function createInput(ui: BattleUIState, battle: BattleUI, deps: InputDeps): InputUI {
  function cellFromEvent(ev: MouseEvent): Vec2 {
    const cv = el<HTMLCanvasElement>('battle');
    return cellFromPoint(ev.clientX, ev.clientY, cv.getBoundingClientRect(), cv);
  }

  function battleCanvasClick(ev: MouseEvent): void {
    if (!battle.playerTurnActive() || !ui.mission) return;
    if (deps.demoBusy()) return; // П6.16: триває демо — бойовище не клікається
    const st = ui.mission.state;
    const cell = cellFromEvent(ev);
    const u = st.units.find((x) => x.alive && x.pos.x === cell.x && x.pos.y === cell.y);

    if (u && u.side === 'player') {
      // вибір свого солдата
      ui.selectedId = u.id;
      ui.fireMode = null;
      ui.hoverPath = null;
      ui.tapCell = null;
      ui.aimCell = null; // П6.14
      battle.binfo(
        u.name + ': HP ' + u.hp + '/' + u.maxHp + ' · AP ' + u.ap + '/' + u.maxAp + '. Клікніть клітинку — рух, або кнопку пострілу.'
      );
      deps.renderAll();
      return;
    }

    const sel = battle.selectedUnit();
    if (!sel) {
      battle.binfo('Спершу клікніть свого солдата (синє коло).');
      return;
    }

    if (u && u.side === 'alien') {
      const vis = battle.visibleCells();
      if (!vis.has(cell.x + ',' + cell.y)) {
        battle.binfo('Там нікого не видно (туман війни).');
        return;
      }
      if (!ui.fireMode) {
        battle.binfo('Виберіть режим пострілу (кнопка зліва), потім клікніть видимого прибульця.');
        return;
      }
      // П6.14: причини невалідної цілі — ті самі перевірки, що й assertCanFire ядра
      if (distance(sel.pos, u.pos) > sel.weapon.range) {
        battle.binfo('Ціль поза дальністю зброї (' + sel.weapon.range + ' клітинок).');
        return;
      }
      if (!hasLineOfSight(st, sel.pos, u.pos)) {
        battle.binfo('Немає лінії вогню до цілі.');
        return;
      }
      // П6.14: тап-тап і для пострілу (дзеркало руху П6.4): перший тап — шанс
      // попадання біля клітинки, повторний тап у ту саму ціль — постріл.
      if (ui.tapCell === null || ui.tapCell.x !== cell.x || ui.tapCell.y !== cell.y) {
        ui.tapCell = cell;
        ui.aimCell = cell;
        ui.hoverPath = null;
        battle.binfo(
          '~' +
            Math.round(calculateHitChance(sel, ui.fireMode) * 100) +
            '% · повторний тап у цю саму ціль — постріл (' +
            MODE_LABEL[ui.fireMode] +
            ').'
        );
        battle.renderBattle();
        return;
      }
      const mode = ui.fireMode;
      ui.fireMode = null;
      ui.tapCell = null;
      ui.aimCell = null;
      try {
        const prevLen = st.log.length;
        resolveAttack(st, sel.id, u.id, mode);
        battle.enqueueAnims(prevLen); // П6.8: трасер/спалах/смерть — з подій логу
        if (!battle.checkOutcome()) {
          battle.binfo(sel.name + ' вистрілив (' + MODE_LABEL[mode] + '). AP ' + sel.ap + '/' + sel.maxAp + '.');
          deps.renderAll();
        }
      } catch (e) {
        battle.binfo('✗ ' + (e as Error).message);
        deps.renderAll();
      }
      return;
    }

    // порожня клітинка — тач-патерн (ADR-0027, П6.4): перший тап/клік — прев'ю
    // шляху (зелені крапки, AP вистачає; червоні — ні), повторний тап/клік у ту
    // саму клітинку — хід. Один патерн для тачу і мишки.
    ui.fireMode = null;
    ui.aimCell = null; // П6.14: зведений режим знято — підказки прицілювання теж
    try {
      const path = findPath(st, sel.pos, cell);
      if (path === null) {
        ui.tapCell = null;
        battle.binfo('Туди не дістатись.');
        deps.renderAll();
        return;
      }
      const ap = pathApCost(path);
      ui.hoverPath = path;
      ui.hoverAp = ap;
      if (ui.tapCell === null || ui.tapCell.x !== cell.x || ui.tapCell.y !== cell.y) {
        // перший тап — лише прев'ю (Esc скасовує)
        ui.tapCell = cell;
        battle.binfo(
          ap > sel.ap
            ? 'Не вистачає AP: шлях ' + ap + ' проти ' + sel.ap + ' — ходу не буде.'
            : 'Шлях: ' + ap + ' AP — повторний тап у ту саму клітинку — хід.'
        );
        battle.renderBattle();
        return;
      }
      // повторний тап у ту саму клітинку — хід
      ui.tapCell = null;
      if (ap > sel.ap) {
        battle.binfo('Не вистачає AP: шлях ' + ap + ' проти ' + sel.ap + '.');
        battle.renderBattle();
        return;
      }
      const prevLen = st.log.length;
      moveUnit(st, sel.id, path);
      battle.enqueueAnims(prevLen); // П6.8: хід по шляху (кроки логу об'єднуються)
      ui.hoverPath = null;
      if (!battle.checkOutcome()) {
        battle.binfo(sel.name + ': рух. AP ' + sel.ap + '/' + sel.maxAp + '.');
        deps.renderAll();
      }
    } catch (e) {
      battle.binfo('✗ ' + (e as Error).message);
      deps.renderAll();
    }
  }

  function battleCanvasHover(ev: MouseEvent): void {
    if (!battle.playerTurnActive() || !ui.mission) return;
    const sel = battle.selectedUnit();
    if (!sel) return;
    const cell = cellFromEvent(ev);
    // П6.14: у зведеному режимі наведення на валідну ціль показує шанс біля
    // клітинки (плашка на канві); прев'ю шляху над ціллю не показуємо.
    if (ui.fireMode !== null) {
      const t = ui.mission.state.units.find((x) => x.alive && x.side === 'alien' && x.pos.x === cell.x && x.pos.y === cell.y);
      const valid =
        t !== undefined &&
        battle.visibleCells().has(cell.x + ',' + cell.y) &&
        distance(sel.pos, t.pos) <= sel.weapon.range &&
        hasLineOfSight(ui.mission.state, sel.pos, t.pos);
      const next: Vec2 | null = valid ? cell : null;
      if (!sameCell(next, ui.aimCell)) {
        ui.aimCell = next;
        if (next !== null) ui.hoverPath = null;
        battle.renderBattle();
      }
      if (ui.aimCell !== null) return;
    }
    if (cell.x === sel.pos.x && cell.y === sel.pos.y) {
      if (ui.hoverPath !== null) {
        ui.hoverPath = null;
        battle.renderBattle();
      }
      return;
    }
    const path = findPath(ui.mission.state, sel.pos, cell);
    if (samePath(path, ui.hoverPath)) return; // без перерисовки на кожен піксель
    ui.hoverPath = path;
    ui.hoverAp = path ? pathApCost(path) : 0;
    if (path) {
      if (ui.hoverAp > sel.ap)
        battle.binfo('Не вистачає AP: шлях ' + ui.hoverAp + ' проти ' + sel.ap + ' (клавіша скасує — просто не клікайте).');
      else battle.binfo('Шлях: ' + ui.hoverAp + ' AP — клікніть, щоб рухатись.');
    }
    battle.renderBattle();
  }

  function battleCanvasLeave(): void {
    // П6.14: aimCell — лише наведення; тап-тап тримає підказку у tapCell
    if (ui.hoverPath !== null || ui.aimCell !== null) {
      ui.hoverPath = null;
      ui.aimCell = null;
      battle.renderBattle();
    }
  }

  function armFire(mode: ShotMode): void {
    if (!battle.playerTurnActive() || !ui.mission) return;
    if (deps.demoBusy()) return; // П6.16: триває демо — керування заблоковано
    const sel = battle.selectedUnit();
    if (!sel) {
      battle.binfo('Спершу клікніть свого солдата.');
      return;
    }
    // П6.14: без достатку AP режим не зводиться — кнопка приглушена, гаряча
    // клавіша дає ту саму відмову з причиною (фідбек не розходиться з кнопками).
    const cost = sel.weapon.modes[mode].apCost;
    if (sel.ap < cost) {
      battle.binfo('Не вистачає AP: ' + MODE_LABEL[mode] + ' постріл коштує ' + cost + ', є ' + sel.ap + '.');
      return;
    }
    ui.fireMode = mode;
    ui.tapCell = null; // П6.14: нове зведення — ціль обираємо заново (тап-тап з нуля)
    ui.aimCell = null;
    const chance = Math.round(calculateHitChance(sel, mode) * 100);
    battle.binfo(
      MODE_LABEL[mode] + ' постріл: ' + cost + ' AP · ~' + chance + '% · тапніть обведену ціль — шанс, повторний тап — постріл.'
    );
    battle.renderBattle();
  }

  function armOverwatch(): void {
    if (!battle.playerTurnActive() || !ui.mission) return;
    if (deps.demoBusy()) return; // П6.16: триває демо — керування заблоковано
    const sel = battle.selectedUnit();
    if (!sel) {
      battle.binfo('Спершу клікніть свого солдата.');
      return;
    }
    // П6.14: та сама перевірка AP, що й у кнопки (підказка причини в binfo)
    if (sel.ap < OVERWATCH_AP_COST) {
      battle.binfo('Не вистачає AP: дозор коштує ' + OVERWATCH_AP_COST + ', є ' + sel.ap + '.');
      return;
    }
    try {
      const prevLen = ui.mission.state.log.length;
      setOverwatch(ui.mission.state, sel.id);
      battle.enqueueAnims(prevLen); // П6.8: спалах дозору
      battle.binfo(sel.name + ' у дозорі (реакційний вогонь у хід прибульців). AP ' + sel.ap + '/' + sel.maxAp + '.');
    } catch (e) {
      battle.binfo('✗ ' + (e as Error).message);
    }
    battle.renderBattle();
  }

  function endPlayerTurn(): void {
    if (!battle.playerTurnActive() || !ui.mission) return;
    if (deps.demoBusy()) return; // П6.16: триває демо — хід ведуть боти
    ui.hoverPath = null;
    ui.fireMode = null;
    ui.tapCell = null;
    ui.aimCell = null; // П6.14
    try {
      const prevLen = ui.mission.state.log.length;
      endTurn(ui.mission.state); // передати хід прибульцям (aliensTurn очікує їхній хід)
      const actions = aliensTurn(ui.mission.state); // синхронно, одним кліком (5.1.4)
      battle.enqueueAnims(prevLen); // П6.8: відтворення ходу прибульців поверх фінального стану
      if (!battle.checkOutcome()) {
        battle.binfo('Хід прибульців відпрацьовано (' + actions + ' дій). Ваш хід — хід ' + ui.mission.state.turn + '.');
        deps.renderAll();
      }
    } catch (e) {
      battle.binfo('✗ Помилка ШІ: ' + (e as Error).message);
      deps.renderAll();
    }
  }

  // ADR-0027 (П6.4): Esc — скасовує спершу зведений режим пострілу,
  // за його відсутності — вибір солдата (разом із прев'ю шляху).
  function cancelSelection(): void {
    if (!ui.mission) return;
    if (ui.fireMode !== null) {
      ui.fireMode = null;
      ui.tapCell = null;
      ui.aimCell = null; // П6.14
      battle.binfo('Режим пострілу скасовано.');
      battle.renderBattle();
      return;
    }
    if (ui.selectedId !== null || ui.hoverPath !== null) {
      ui.selectedId = null;
      ui.hoverPath = null;
      ui.tapCell = null;
      ui.aimCell = null; // П6.14
      battle.binfo('Вибір знято.');
      battle.renderBattle();
    }
  }

  // ADR-0027 (П6.4): гарячі клавіші керування боєм — 1/2/3 (режими пострілу),
  // O (дозор), E (кінець ходу), Esc (скасувати). Ключ — за ev.code
  // (фізична клавіша, незалежно від розкладки), цифри — ще й за ev.key.
  // Поля вводу (сід) клавіші не перехоплюють — подія з них ігнорується.
  function isTypingTarget(t: EventTarget | null): boolean {
    return t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }

  function onKeyDown(ev: KeyboardEvent): void {
    if (isTypingTarget(ev.target)) return;
    if (ev.code === 'Digit1' || ev.key === '1') armFire('snap');
    else if (ev.code === 'Digit2' || ev.key === '2') armFire('aimed');
    else if (ev.code === 'Digit3' || ev.key === '3') armFire('auto');
    else if (ev.code === 'KeyO') armOverwatch();
    else if (ev.code === 'KeyE') endPlayerTurn();
    else if (ev.key === 'Escape') cancelSelection();
  }

  return {
    battleCanvasClick,
    battleCanvasHover,
    battleCanvasLeave,
    armFire,
    armOverwatch,
    endPlayerTurn,
    onKeyDown,
  };
}
