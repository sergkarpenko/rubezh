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
import { awaitingRole, newCareer, RANK_NAMES, rankOf, type SoldierRole } from '../src/core/career';
import type { DifficultyPreset } from '../src/core/campaign';
import { advanceTime, detectedUfos, geoClock, missionTargets, type Ufo } from '../src/core/geo';
import { findPath, pathApCost, sideVisibleCells } from '../src/core/map';
import { completeMission, createMission, missionOutcome, type Mission, type MissionOutcome } from '../src/core/mission';
import { awardTrophies, radarRange } from '../src/core/research';
import { createParty, type Party } from '../src/core/save';
import { applyMissionResult, chooseRole, deployRoles, hospitalTick, missionSquad, readySoldiers } from '../src/core/squad';
import { deployConsumables } from '../src/core/workshop';
import { TURN_PLATE_DONE } from '../src/ui/battle-feedback';
import { byGender } from '../src/ui/text';

// Т.116: знімок загону на початку ходу демонів — для оракула підсумку, незалежного від summarizeAlienTurn.
interface SquadSnapshot {
  from: number; // індекс логу до передачі ходу демонам
  hp: Map<string, number>; // HP живих оперативників
}

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

// Рядок юніта — підпис вибраної картки смуги загону (Т.130: `aria-label`, src/ui/squad-strip.ts; до Т.130 — #bctx-unit).
// п16.4 (ADR-0147 п. 6): «Іван «Крук»» — позивний оперативника з пулу за номером найму (id «sN»); сценарій
// грає свіжим ростером, тож позивний — newCareer(N − 1).
export function unitLine(u: Unit): string {
  const n = /^s(\d+)$/.exec(u.id);
  const who = n === null ? u.name : u.name + ' «' + newCareer(Number(n[1]) - 1).callsign + '»';
  return who + ': HP ' + u.hp + '/' + u.maxHp + ' · AP ' + u.ap + '/' + u.maxAp;
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
      advanceTime(this.party.geo, 1, radarRange(this.party.research));
      hospitalTick(this.party.roster);
    }
  }

  // Т.43: кнопки «+1 доба» і «До події» зупиняються на подіях. Правило записане
  // тут окремо від src/ui/time-control.ts — дзеркало лишається незалежним
  // оракулом. Дзеркало веде лише геосцену і лікарню, тож із шести подій тут
  // можливі три: зонд виявлено, виявлений зонд приземлився, оперативник одужав
  // (наука, «Кузня» і ремонт у сценарії не запускаються). Технічних зупинок UI
  // (повітряний бій, банкрутство, завершення кампанії) дзеркало не моделює, а
  // одужання рахує без перевірки, що оперативник лишився в ростері: сценарій до
  // цих станів не доходить. Повертає число тіків.
  private runWithStops(stopOnRecovery: boolean): number {
    const geo = this.party.geo;
    for (let done = 1; done <= 48; done++) {
      const seen = geo.log.length;
      const wounded = Object.keys(this.party.roster.hospital);
      this.tick();
      const probe = geo.log
        .slice(seen)
        .some((e) => e.type === 'ufo_detected' || (e.type === 'ufo_landed' && geo.ufos.some((u) => u.id === e.ufoId && u.detected)));
      const recovered = wounded.some((id) => this.party.roster.hospital[id] === undefined);
      if (probe || (stopOnRecovery && recovered)) return done;
    }
    return 48;
  }

  // клік «+1 доба»: до 48 тіків, зупинка на виявленні чи приземленні виявленого зонда
  dayWithStops(): number {
    return this.runWithStops(false);
  }

  // клік «До події»: до 48 тіків, зупинка на першій події
  toEvent(): number {
    return this.runWithStops(true);
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
  // п16.4: рядок ростера — ім'я «позивний», далі звання, біографія, HP і вбивства, досвід
  rosterRows(): RegExp[] {
    return this.party.roster.soldiers.map(
      (s) =>
        new RegExp(
          '^' +
            s.name +
            ' «' +
            this.party.roster.careers[s.id].callsign +
            '».*HP ' +
            s.hp +
            '/' +
            s.maxHp +
            '(?!\\d).*⚔ ' +
            s.kills +
            '(?!\\d)'
        )
    );
  }

  // п16.4 (EARS 4): заголовки вікон вибору ролі по черзі ростеру (хто чекає ролі)
  awaitingRoleTitles(): { id: string; title: string }[] {
    return this.party.roster.soldiers
      .filter((s) => awaitingRole(this.party.roster.careers[s.id]))
      .map((s) => {
        const c = this.party.roster.careers[s.id];
        return { id: s.id, title: 'Підвищення: «' + c.callsign + '» — ' + RANK_NAMES[rankOf(c.xp)] + '. Оберіть роль' };
      });
  }

  chooseRole(id: string, role: SoldierRole): void {
    chooseRole(this.party.roster, id, role);
  }

  // --- бій: ті самі виклики ядра, що в src/ui/battle.ts та src/ui/input.ts ---

  launch(ufoId: string): Mission {
    const squad = missionSquad(this.party.roster);
    const roles = deployRoles(this.party.roster, squad); // п16.4: як launch у src/ui/battle.ts
    this.mission = createMission(this.party.geo, ufoId, {
      squad,
      items: deployConsumables(this.party.workshop, squad),
      ...(roles !== null ? { roles } : {}),
    });
    return this.mission;
  }

  turnSummary = ''; // Т.33: підсумок останнього ходу демонів

  private snapshot(): SquadSnapshot {
    return { from: this.state.log.length, hp: new Map(this.squad().map((u) => [u.id, u.hp])) };
  }

  // Т.116 (кандидат 20): текст #bturn після ходу демонів — власний розрахунок, а не summarizeAlienTurn:
  // втрати HP — різниця зі знімком загону (порядок — за першим влучанням); постріли, загиблі й дозор — з логу.
  private summaryText(snap: SquadSnapshot): string {
    const events = this.state.log.slice(snap.from);
    const unit = (id: string): Unit => this.state.units.find((u) => u.id === id) as Unit;
    const alienShots = events.filter((e) => e.type === 'shot' && unit(e.shooterId).side === 'alien');
    const hits = alienShots.filter((e) => e.type === 'shot' && e.hit);
    const lines = [
      alienShots.length === 0 ? 'Демони не атакували.' : 'Пострілів по загону: ' + alienShots.length + ', влучань: ' + hits.length,
    ];
    const firstHit = (id: string): number => hits.findIndex((e) => e.type === 'shot' && e.targetId === id);
    const hurt = [...snap.hp.keys()]
      .map(unit)
      .filter((u) => u.alive && u.hp < (snap.hp.get(u.id) as number))
      .sort((a, b) => firstHit(a.id) - firstHit(b.id));
    for (const u of hurt) lines.push(u.name + ': −' + ((snap.hp.get(u.id) as number) - u.hp) + ' HP');
    for (const e of events)
      if (e.type === 'death' && snap.hp.has(e.unitId)) {
        const u = unit(e.unitId);
        lines.push('✝ ' + u.name + ' ' + byGender(u.name, 'загинув', 'загинула'));
      }
    for (const e of events) {
      if (e.type !== 'shot' || unit(e.shooterId).side !== 'player') continue;
      const killed = events.some((d) => d.type === 'death' && d.unitId === e.targetId && d.killerId === e.shooterId);
      lines.push('Дозор: ' + unit(e.shooterId).name + ' — ' + (e.hit ? 'влучання' + (killed ? ', демона знищено' : '') : 'промах'));
    }
    const seen = this.seen();
    lines.push(
      'Демонів у полі зору: ' + this.state.units.filter((u) => u.side === 'alien' && u.alive && seen.has(u.pos.x + ',' + u.pos.y)).length
    );
    return TURN_PLATE_DONE + lines.join('');
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

  // Т.137: найближча (за ціною) клітинка, до якої шлях за видимим є, але дорожчий за AP юніта —
  // перший тап дає червоне прев'ю «Не вистачає AP». Обхід мапи рядками — детерміновано; клітинки
  // з видимими юнітами пропущено (тап по них — вибір чи ціль, не прев'ю шляху)
  farOption(u: Unit): MoveOption {
    const seen = this.seen();
    let best: MoveOption | null = null;
    for (let y = 0; y < this.state.map.height; y++)
      for (let x = 0; x < this.state.map.width; x++) {
        if (this.state.units.some((o) => o.alive && o.pos.x === x && o.pos.y === y && seen.has(x + ',' + y))) continue;
        const path = findPath(this.state, u.pos, { x, y }, undefined, seen);
        if (path === null || path.length === 0) continue;
        const cost = pathApCost(path);
        if (cost > u.ap && (best === null || cost < best.cost)) best = { cell: { x, y }, path, cost };
      }
    if (best === null) throw new Error('Дзеркало: немає клітинки, дорожчої за AP ' + u.name);
    return best;
  }

  // Т.44: зона ходу юніта — клітинки, до яких findPath за видимим дає шлях не
  // дорожчий за його AP. Порахована окремо від reachableCells ядра (пошук шляху
  // до кожної клітинки) — дзеркало лишається незалежним оракулом для сторінки.
  reach(u: Unit): Set<string> {
    const seen = this.seen();
    const zone = new Set<string>();
    for (let y = 0; y < this.state.map.height; y++)
      for (let x = 0; x < this.state.map.width; x++) {
        const path = findPath(this.state, u.pos, { x, y }, undefined, seen);
        if (path !== null && path.length > 0 && pathApCost(path) <= u.ap) zone.add(x + ',' + y);
      }
    return zone;
  }

  move(u: Unit, option: MoveOption): void {
    moveUnit(this.state, u.id, option.path, true);
  }

  // Клітинки, які бачить загін (battle.ts visibleCells) — за ними ввід бою
  // планує шлях: юніт у тумані шляху не перекриває (ADR-0081).
  seen(): Set<string> {
    return sideVisibleCells(this.state, 'player'); // п17.4: туман сторони, як battle.ts
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
    const snap = this.snapshot();
    endTurn(this.state);
    const actions = aliensTurn(this.state);
    // Т.33: текст підсумку ходу демонів (#bturn) — за подіями цього ходу і туманом (Т.116: незалежний розрахунок)
    this.turnSummary = this.summaryText(snap);
    return actions;
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
        if (!hasLineOfSight(this.state, shooter.pos, target.pos, shooter.side)) continue;
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
    awardTrophies(this.party.research, mission.state, outcome); // п18.2: дзеркало finish у battle.ts
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
