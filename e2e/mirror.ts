// e2e/mirror.ts
// Дзеркало ядра для сценарію приймання (ADR-0080). Сторінка стану гри назовні
// не віддає (канва, модульні змінні main.ts), тож сценарій веде в Node другу
// партію тим самим сідом і тими самими викликами ядра, що їх робить шар
// відображення на кожен клік (ADR-0003: один сід + послідовність дій = той
// самий результат). Дзеркало відповідає на два питання: «куди клікати»
// (позиції юнітів, вільна клітинка, видима ціль) і «що має показати сторінка»
// (рядок юніта, годинник, результат бою). Розбіжність сторінки з дзеркалом —
// дефект зв'язування UI з ядром або порушений детермінізм.
//
// Лише ядро (src/core, ADR-0002): модулі src/ui тягнуть DOM і сюди не
// імпортуються. Тік партії тут — геосцена і лікарня (advanceTime +
// hospitalTick); решта контуру partyTick у main.ts (економіка, наука, цех,
// перехоплення) на них не впливає, поки сценарій цих дій не робить, і
// сценарієм не звіряється.

import {
  calculateHitChance,
  distance,
  endTurn,
  hasLineOfSight,
  moveUnit,
  resolveAttack,
  setOverwatch,
  type GameState,
  type ShotMode,
  type Unit,
  type Vec2,
} from '../src/core/combat';
import { DemoSteps, aliensTurn } from '../src/core/ai-bot';
import type { DifficultyPreset } from '../src/core/campaign';
import { advanceTime, detectedUfos, geoClock, missionTargets, type Ufo } from '../src/core/geo';
import { computeVisibleCells, findPath, pathApCost } from '../src/core/map';
import { completeMission, createMission, missionOutcome, type Mission, type MissionOutcome } from '../src/core/mission';
import { createParty, type Party } from '../src/core/save';
import { applyMissionResult, hospitalTick, missionSquad, readySoldiers } from '../src/core/squad';
import { deployConsumables } from '../src/core/workshop';

export interface MoveOption {
  cell: Vec2;
  path: Vec2[];
  cost: number;
}

export interface ShotOption {
  shooter: Unit;
  target: Unit;
  chancePct: number; // те саме округлення, що в підказці бою («~48%»)
}

// Рядок юніта в контекст-стрічці бою (#bctx-unit, battle.ts renderBattle).
export function unitLine(u: Unit): string {
  return u.name + ': HP ' + u.hp + '/' + u.maxHp + ' · AP ' + u.ap + '/' + u.maxAp;
}

// Початок підказки бою після тапу по видимому демону без зведеного режиму
// (#binfo, input.ts battleCanvasClick).
export function enemyLine(u: Unit): string {
  return u.name + ': HP ' + u.hp + '/' + u.maxHp + ' · зброя';
}

export class CoreMirror {
  readonly party: Party;
  private mission: Mission | null = null;

  constructor(seed: number, preset: DifficultyPreset) {
    this.party = createParty(seed, preset);
  }

  // --- геосцена ---

  tick(ticks = 1): void {
    for (let i = 0; i < ticks; i++) {
      advanceTime(this.party.geo, 1);
      hospitalTick(this.party.roster);
    }
  }

  clock(): string {
    return geoClock(this.party.geo);
  }

  detected(): Ufo[] {
    return detectedUfos(this.party.geo);
  }

  targets(): Ufo[] {
    return missionTargets(this.party.geo);
  }

  // Чип «Боєготові» топбара (#ready, panels.ts renderRoster).
  readyChip(): string {
    return readySoldiers(this.party.roster).length + '/' + this.party.roster.soldiers.length;
  }

  // Картки ростеру (#roster .soldier): ім'я, HP і лічильник убивств кожного
  // оперативника — відбиток усього бою (хто вижив, кого поранено, хто влучав).
  rosterRows(): RegExp[] {
    return this.party.roster.soldiers.map(
      (s) => new RegExp('^' + s.name + '\\s*HP ' + s.hp + '/' + s.maxHp + '(?!\\d).*⚔ ' + s.kills + '$')
    );
  }

  // --- бій: ті самі виклики ядра, що в src/ui/battle.ts та src/ui/input.ts ---

  launch(ufoId: string): Mission {
    const squad = missionSquad(this.party.roster);
    this.mission = createMission(this.party.geo, ufoId, { squad, items: deployConsumables(this.party.workshop, squad) });
    return this.mission;
  }

  get state(): GameState {
    if (this.mission === null) throw new Error('Дзеркало: місію не запущено');
    return this.mission.state;
  }

  outcome(): MissionOutcome {
    return missionOutcome(this.state);
  }

  squad(): Unit[] {
    return this.state.units.filter((u) => u.side === 'player' && u.alive);
  }

  // Найближча вільна клітинка для ходу тап-тап: обхід околу у фіксованому
  // порядку (детерміновано), шлях і ціна — тими самими findPath/pathApCost,
  // що рахує ввід бою для прев'ю шляху.
  moveOption(u: Unit, maxCost = 3): MoveOption {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const cell = { x: u.pos.x + dx, y: u.pos.y + dy };
        if (this.state.units.some((o) => o.alive && o.pos.x === cell.x && o.pos.y === cell.y)) continue;
        const path = findPath(this.state, u.pos, cell, undefined, this.seen());
        if (path === null || path.length === 0) continue;
        const cost = pathApCost(path);
        if (cost <= maxCost && cost <= u.ap) return { cell, path, cost };
      }
    }
    throw new Error('Дзеркало: біля ' + u.name + ' немає вільної клітинки для ходу');
  }

  move(u: Unit, option: MoveOption): void {
    moveUnit(this.state, u.id, option.path, true);
  }

  // Клітинки, які бачить загін (battle.ts visibleCells) — за ними ввід бою
  // планує шлях: юніт у тумані шляху не перекриває (ADR-0081).
  seen(): Set<string> {
    const cells = new Set<string>();
    for (const s of this.squad()) for (const k of computeVisibleCells(this.state, s.pos)) cells.add(k);
    return cells;
  }

  // Туман не видає демона (ADR-0081): клітинка першого невидимого демона і
  // підказка, яку дає тап по ній, — те саме прев'ю шляху, що й по порожній.
  fogProbe(u: Unit): { cell: Vec2; hint: string } {
    const seen = this.seen();
    const hidden = this.state.units.find((a) => a.side === 'alien' && a.alive && !seen.has(a.pos.x + ',' + a.pos.y));
    const path = hidden === undefined ? null : findPath(this.state, u.pos, hidden.pos, undefined, seen);
    if (hidden === undefined || path === null) throw new Error('Дзеркало: немає досяжного демона в тумані');
    const cost = pathApCost(path);
    return { cell: hidden.pos, hint: cost > u.ap ? 'Не вистачає AP: шлях ' + cost + ' проти ' + u.ap : 'Шлях: ' + cost + ' AP' };
  }

  overwatch(u: Unit): void {
    setOverwatch(this.state, u.id);
  }

  // Кінець ходу гравця: передача ходу і синхронний хід демонів (input.ts
  // endPlayerTurn). Повертає кількість дій демонів — її показує підказка бою.
  endPlayerTurn(): number {
    endTurn(this.state);
    return aliensTurn(this.state);
  }

  // Чи бачить загін клітинку юніта (туман війни, battle.ts visibleCells).
  sees(u: Unit): boolean {
    return this.seen().has(u.pos.x + ',' + u.pos.y);
  }

  // Перша пара «стрілець → видима ціль»: ті самі перевірки, що у
  // validFireTargets (battle.ts) — туман, дальність зброї, лінія вогню — плюс
  // запас AP на режим пострілу.
  shotOption(mode: ShotMode): ShotOption | null {
    for (const shooter of this.squad()) {
      if (shooter.ap < shooter.weapon.modes[mode].apCost) continue;
      for (const target of this.state.units) {
        if (target.side !== 'alien' || !target.alive || !this.sees(target)) continue;
        if (distance(shooter.pos, target.pos) > shooter.weapon.range) continue;
        if (!hasLineOfSight(this.state, shooter.pos, target.pos)) continue;
        return { shooter, target, chancePct: Math.round(calculateHitChance(shooter, mode) * 100) };
      }
    }
    return null;
  }

  shoot(shot: ShotOption, mode: ShotMode): void {
    resolveAttack(this.state, shot.shooter.id, shot.target.id, mode);
  }

  // Авто-бій до результату: розгортка DemoSteps із зупинкою посеред півходу,
  // щойно результат вирішено — дзеркало AutoBattleDriver.next (auto-battle.ts).
  autoBattle(): MissionOutcome {
    const steps = new DemoSteps();
    for (;;) {
      const r = steps.step(this.state);
      const mid = this.outcome();
      if (mid === 'перемога' || mid === 'поразка' || r.over) return mid;
    }
  }

  // Завершення місії (battle.ts finish): наслідки для ростеру і геосцени.
  // Повертає текст банера результату (#bresult .banner).
  finish(): string {
    const mission = this.mission;
    const outcome = this.outcome();
    if (mission === null || outcome === 'триває') throw new Error('Дзеркало: бій ще триває');
    const aftermath = applyMissionResult(this.party.roster, mission.state);
    completeMission(this.party.geo, mission.briefing.ufoId, outcome);
    this.mission = null;
    if (outcome === 'перемога') {
      const wounded = aftermath.wounded.length > 0 ? ' · поранених: ' + aftermath.wounded.length : '';
      return 'ЗАЧИЩЕНО ✓ — загін повернувся на базу (' + aftermath.survivors.length + ' уцілілих' + wounded + ')';
    }
    return outcome === 'евакуйовано'
      ? 'ЗАГІН ЕВАКУЙОВАНО — врятовані на базі, зонд Розриву лишається активним'
      : 'ЗАГІН ВТРАЧЕНО ✗ — зонд Розриву лишається активним';
  }
}
