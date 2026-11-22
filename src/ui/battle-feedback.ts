// Т.33 (огляд Т.30, знахідки 12 і 11): підсумок ходу демонів Розриву і картка результату бою — чисті функції
// шару відображення (ADR-0037). Туман (ADR-0006): у підсумку лише те, що гравець бачить сам.

import type { GameEvent, Unit } from '../core/combat';
import { byGender } from './text';

export const TURN_PLATE_MIN_MS = 1000; // плашка ходу демонів: поки грають анімації, і не менше цього часу
export const TURN_PLATE_ACTING = ['ХІД ДЕМОНІВ РОЗРИВУ…', 'Демони діють. Зачекайте.'] as const;
export const TURN_PLATE_DONE = 'ХІД ДЕМОНІВ РОЗРИВУ — ПІДСУМОК';
// Т.117 (рішення власника): у ручному бою клік по полю, пробіл або Esc пропускають анімації ходу демонів
export const TURN_PLATE_SKIP = 'Клік / пробіл / Esc — пропустити';

// Рядки підсумку за подіями ходу демонів (події від endTurn до кінця aliensTurn).
export function summarizeAlienTurn(events: readonly GameEvent[], units: readonly Unit[], visible: ReadonlySet<string>): string[] {
  const byId = new Map(units.map((u) => [u.id, u]));
  let shots = 0;
  let hits = 0;
  const damage = new Map<string, number>(); // втрати HP оперативників, у порядку влучань
  const dead: Unit[] = [];
  const watch: string[] = [];
  for (const e of events) {
    if (e.type === 'death') {
      const u = byId.get(e.unitId);
      if (u?.side === 'player') dead.push(u);
    }
    if (e.type !== 'shot') continue;
    const shooter = byId.get(e.shooterId);
    const target = byId.get(e.targetId);
    if (!shooter || !target) continue;
    if (shooter.side === 'alien') {
      shots++;
      if (e.hit) {
        hits++;
        damage.set(target.id, (damage.get(target.id) ?? 0) + e.damage);
      }
    } else {
      // реакційний вогонь дозору (ADR-0005): один постріл оперативника в хід демонів
      const killed = events.some((d) => d.type === 'death' && d.unitId === target.id && d.killerId === shooter.id);
      watch.push('Дозор: ' + shooter.name + ' — ' + (e.hit ? 'влучання' + (killed ? ', демона знищено' : '') : 'промах'));
    }
  }
  const lines: string[] = [];
  lines.push(shots === 0 ? 'Демони не атакували.' : 'Пострілів по загону: ' + shots + ', влучань: ' + hits);
  for (const [id, hp] of damage) {
    const u = byId.get(id) as Unit;
    if (u.alive) lines.push(u.name + ': −' + hp + ' HP');
  }
  for (const u of dead) lines.push('✝ ' + u.name + ' ' + byGender(u.name, 'загинув', 'загинула'));
  lines.push(...watch);
  const seen = units.filter((u) => u.side === 'alien' && u.alive && visible.has(u.pos.x + ',' + u.pos.y)).length;
  lines.push('Демонів у полі зору: ' + seen);
  return lines;
}

export interface ResultCard {
  turns: number;
  killed: number;
  aliens: number;
  bonus: number | null; // null — премії немає (поразка, евакуація)
  wounded: readonly string[]; // «Ім'я — лікарня: 8 тіків»
  lost: readonly string[]; // «Ім'я — загинув»
}

export function resultCardHtml(c: ResultCard): string {
  const row = (k: string, v: string): string => '<div class="rrow"><span>' + k + '</span><b>' + v + '</b></div>';
  return (
    '<div class="rcard">' +
    row('Ходів', String(c.turns)) +
    row('Демонів знищено', c.killed + ' з ' + c.aliens) +
    row('Премія', c.bonus === null ? 'немає' : '+' + c.bonus + ' кр.') +
    c.wounded.map((t) => '<div class="rwound">✚ ' + t + '</div>').join('') +
    c.lost.map((t) => '<div class="lose">✝ ' + t + '</div>').join('') +
    '</div>'
  );
}
