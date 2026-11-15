// @vitest-environment jsdom
// src/ui/next-step.test.ts
// Т.43: рядок «Наступний крок». Тексти — дослівно з рішення власника
// 15.11.2026; стан готується правкою партії createParty(42).

import { describe, expect, it } from 'vitest';
import type { Ufo, UfoStatus } from '../core/geo';
import { createParty, type Party } from '../core/save';
import { nextStepText } from './next-step';

const GEO = { inBattle: false, gameOver: false };
const text = (p: Party): string | null => nextStepText(p, GEO);

function addUfo(p: Party, status: UfoStatus, detected = true, landedTicksLeft = 8): void {
  const id = 'u' + p.geo.ufos.length;
  p.geo.ufos.push({ id, kind: 'розвідник', pos: { x: 1, y: 1 }, target: { x: 1, y: 1 }, status, detected, landedTicksLeft } as Ufo);
}
function woundAll(p: Party): void {
  for (const s of p.roster.soldiers) p.roster.hospital[s.id] = 10;
}

describe('Т.43: вісім рядків «Наступний крок» — дослівно', () => {
  it('8. нова партія: рухайте час', () => {
    expect(text(createParty(42))).toBe('Наступний крок: рухайте час — сенсорна сітка шукає зонди');
  });

  it('1. зонд приземлився: вікно в годинах — з ядра, найменше з кількох', () => {
    const p = createParty(42);
    addUfo(p, 'приземлився', true, 5);
    expect(text(p)).toBe('Наступний крок: зонд приземлився — запустіть місію (вікно 2.5 год)');
    addUfo(p, 'приземлився', true, 2);
    expect(text(p)).toBe('Наступний крок: зонд приземлився — запустіть місію (вікно 1 год)');
  });

  it('2. збитий зонд чекає', () => {
    const p = createParty(42);
    addUfo(p, 'збитий');
    expect(text(p)).toBe('Наступний крок: збитий зонд чекає — запустіть місію');
  });

  it('3. зонд у повітрі, перехоплювач на базі з повним HP', () => {
    const p = createParty(42);
    addUfo(p, 'летить');
    expect(text(p)).toBe('Наступний крок: зонд у повітрі — перехопіть або чекайте приземлення');
  });

  it('4. немає боєготових', () => {
    const p = createParty(42);
    woundAll(p);
    expect(text(p)).toBe('Наступний крок: немає боєготових — вербуйте або чекайте одужання');
  });

  it('5. протокол завершено, предмета ще немає, кредитів вистачає (ціна пресета)', () => {
    const p = createParty(42, 'легкий'); // броня 60 × 0,5 = 30
    p.research.completed.push('armor');
    p.econ.money = 30;
    expect(text(p)).toBe('Наступний крок: протокол завершено — замовте предмет у «Кузні»');
    p.econ.money = 29;
    expect(text(p)).toBe('Наступний крок: рухайте час — сенсорна сітка шукає зонди');
  });

  it('6. на складі є спорядження', () => {
    const p = createParty(42);
    p.workshop.store.armor = 1;
    expect(text(p)).toBe('Наступний крок: на складі є спорядження — видайте оперативникам');
  });

  it('7. перехоплювач пошкоджений і кредитів на ремонт вистачає (50); без кредитів — рядок 8', () => {
    const p = createParty(42);
    p.intercept.fighter.hp = 1;
    p.econ.money = 50;
    expect(text(p)).toBe('Наступний крок: перехоплювач пошкоджений — замовте ремонт');
    p.econ.money = 49;
    expect(text(p)).toBe('Наступний крок: рухайте час — сенсорна сітка шукає зонди');
  });
});

describe('Т.43: пріоритети і межі умов', () => {
  it('приземлений зонд без боєготових — рядок 4, не 1; невиявлений зонд не рахується', () => {
    const p = createParty(42);
    addUfo(p, 'приземлився', false);
    addUfo(p, 'летить', false);
    expect(text(p)).toContain('рухайте час');
    addUfo(p, 'приземлився');
    woundAll(p);
    expect(text(p)).toContain('немає боєготових');
  });

  it('порядок: приземлився → збитий → у повітрі', () => {
    const p = createParty(42);
    addUfo(p, 'летить');
    addUfo(p, 'збитий');
    expect(text(p)).toContain('збитий зонд чекає');
    addUfo(p, 'приземлився');
    expect(text(p)).toContain('зонд приземлився');
  });

  it('зонд у повітрі з пошкодженим або зайнятим перехоплювачем — не рядок 3', () => {
    const p = createParty(42);
    addUfo(p, 'летить');
    p.intercept.fighter.hp = 1;
    expect(text(p)).toContain('замовте ремонт');
    p.intercept.fighter.status = 'ремонт';
    expect(text(p)).toContain('рухайте час');
    p.intercept.fighter.status = 'погоня';
    p.intercept.fighter.hp = 4; // повний HP, але перехоплювач не на базі
    expect(text(p)).toContain('рухайте час');
  });

  it('зонд у повітрі без боєготових — рядок 3 раніше за рядок 4', () => {
    const p = createParty(42);
    addUfo(p, 'летить');
    woundAll(p);
    expect(text(p)).toContain('зонд у повітрі');
  });

  it('порядок: замовити → видати → ремонт', () => {
    const p = createParty(42);
    p.intercept.fighter.hp = 1;
    p.workshop.store.armor = 1;
    expect(text(p)).toContain('видайте оперативникам');
    p.research.completed.push('medkit');
    p.econ.money = 10_000;
    expect(text(p)).toContain('замовте предмет');
  });

  it('«замовте» не показується, коли предмет уже на складі, в черзі, в оперативника чи на перехоплювачі', () => {
    const p = createParty(42);
    p.econ.money = 10_000;
    p.research.completed.push('lab-extension'); // не предмет — замовляти нічого
    expect(text(p)).toContain('рухайте час');
    p.research.completed.push('optics', 'gun-module');
    expect(text(p)).toContain('замовте предмет');
    p.workshop.queue.push({ id: 'optics', ticksLeft: 5 });
    p.intercept.fighter.gunModule = true;
    expect(text(p)).toContain('рухайте час');
    p.workshop.queue = [];
    p.workshop.equipped[p.roster.soldiers[0].id] = { armor: false, optics: true, medkit: false, grenade: false };
    expect(text(p)).toContain('рухайте час');
    p.intercept.fighter.gunModule = false;
    expect(text(p)).toContain('замовте предмет');
  });

  it('без боєготових рядок 4 — раніше за 5, 6 і 7; збитий зонд без боєготових — теж рядок 4', () => {
    const p = createParty(42);
    woundAll(p);
    p.econ.money = 10_000;
    p.intercept.fighter.hp = 1;
    p.workshop.store.armor = 1;
    p.research.completed.push('medkit');
    addUfo(p, 'збитий');
    expect(text(p)).toContain('немає боєготових');
  });

  it('предмет уже на складі — не «замовте», а «видайте»', () => {
    const p = createParty(42);
    p.econ.money = 10_000;
    p.research.completed.push('armor');
    expect(text(p)).toContain('замовте предмет');
    p.workshop.store.armor = 1;
    expect(text(p)).toContain('видайте оперативникам');
  });

  it('банкрутство ще до тіку (боєготових немає, на вербування бракує) — рядок прихований, а не «вербуйте»', () => {
    const p = createParty(42);
    woundAll(p);
    p.econ.money = 100; // вербування на «нормі» — 100
    expect(text(p)).toContain('немає боєготових');
    p.econ.money = 99;
    expect(text(p)).toBeNull();
  });

  it('рядок прихований: бій, банкрутство, повітряний бій, кампанію завершено', () => {
    const p = createParty(42);
    expect(nextStepText(p, { inBattle: true, gameOver: false })).toBeNull();
    expect(nextStepText(p, { inBattle: false, gameOver: true })).toBeNull();
    p.intercept.fighter.status = 'бій';
    expect(text(p)).toBeNull();
    p.intercept.fighter.status = 'на базі';
    p.campaign.status = 'перемога';
    expect(text(p)).toBeNull();
  });
});
