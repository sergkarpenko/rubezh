// @vitest-environment jsdom
// п18.5 (ADR-0157; EARS 10 Фази 18): мета кампанії в UI — чип загрози, панель «Мета кампанії»,
// екрани перемоги й поразки. Тексти — рішення власника дослівно; числа — з констант ядра.
import { beforeEach, describe, expect, it } from 'vitest';
import { ASSAULT_THRESHOLDS } from '../core/campaign';
import { GATE_RETRY_MINUTES } from '../core/assault';
import { createParty, type Party } from '../core/save';
import {
  assaultsText,
  defeatText,
  endScore,
  goalChain,
  goalNextText,
  nextKeyProject,
  renderEndScreens,
  renderGoalPanel,
  renderThreatChip,
  scoreLinesText,
  threatLevel,
  threatTitle,
  trophiesText,
  victoryText,
} from './campaign-panel';

function dom(): void {
  document.body.innerHTML = `
    <span id="threat"></span>
    <div id="campaign-goal"></div>
    <section id="campaign-victory" class="hidden"><p id="campaign-victory-text"></p><span id="campaign-score"></span><div id="campaign-score-lines"></div></section>
    <section id="campaign-defeat" class="hidden"><p id="campaign-defeat-text"></p><span id="campaign-defeat-score"></span><div id="campaign-defeat-lines"></div></section>`;
}

const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
let p: Party;
beforeEach(() => {
  dom();
  p = createParty(42);
});

describe('п18.5: чип загрози (рішення власника «А. Шапка + панель»)', () => {
  it('рівень кольору — від першого і від останнього порога штурму', () => {
    expect(threatLevel(0)).toBe('');
    expect(threatLevel(ASSAULT_THRESHOLDS[0] - 1)).toBe('');
    expect(threatLevel(ASSAULT_THRESHOLDS[0])).toBe('warn');
    expect(threatLevel(ASSAULT_THRESHOLDS[2] - 1)).toBe('warn');
    expect(threatLevel(ASSAULT_THRESHOLDS[2])).toBe('crit');
    expect(threatLevel(100)).toBe('crit');
  });

  it('число, смужка з шириною за загрозою, три риски порогів, клас і підказка', () => {
    p.campaign.threat = 34;
    renderThreatChip(p);
    expect($('threat-num').textContent).toBe('34');
    expect($('threat').querySelector<HTMLElement>('.tbar i')!.style.width).toBe('34%');
    expect([...$('threat').querySelectorAll<HTMLElement>('.tbar s')].map((s) => s.style.left)).toEqual(['60%', '75%', '90%']);
    expect($('threat').className).toBe('chip');
    expect($('threat').title).toBe(threatTitle(34));
    expect(threatTitle(34)).toBe('Загроза Розриву 34 з 100: на 60, 75, 90 — штурм вузла, на 100 — поразка');
    p.campaign.threat = 75;
    renderThreatChip(p);
    expect($('threat').className).toBe('chip warn');
    p.campaign.threat = 100;
    renderThreatChip(p);
    expect($('threat').className).toBe('chip crit');
    expect($('threat').querySelector<HTMLElement>('.tbar i')!.style.width).toBe('100%');
  });
});

describe('п18.5: панель «Мета кампанії»', () => {
  it('старт: перший протокол — «Анатомія Розриву», бракує трофеїв; ланцюжок ◉ ○ ○ ○; трофеї нулі; штурми 0 з 3', () => {
    expect(nextKeyProject(p)?.id).toBe('rift-anatomy');
    expect(goalNextText(p)).toBe('Наступний крок до Брами: «Анатомія Розриву». Бракує трофеїв: демон 0 з 6, гончак 0 з 3.');
    expect(goalChain(p).map((s) => s.text + ':' + s.cls)).toEqual([
      '◉ Анатомія Розриву:now',
      '○ Пеленг брами:later',
      '○ Ключ брами:later',
      '○ Брама:later',
    ]);
    expect(trophiesText(p)).toBe('демон 0 · гончак 0 · голем 0 · око 0');
    expect(assaultsText(p)).toBe('Штурми вузла: 0 з 3 (наступний — на загрозі 60)');
    renderGoalPanel(p);
    const lines = [...$('campaign-goal').children].map((c) => c.textContent);
    expect(lines).toEqual([
      '◉ Анатомія Розриву○ Пеленг брами○ Ключ брами○ Брама',
      goalNextText(p),
      'Трофеї: демон 0 · гончак 0 · голем 0 · око 0',
      'Штурми вузла: 0 з 3 (наступний — на загрозі 60)',
    ]);
    expect($('campaign-goal').lastElementChild!.classList.contains('meta')).toBe(true);
  });

  it('трофеїв досить — дослідити; у роботі — очки; другий крок після першого', () => {
    p.research.trophies = { demon: 6, hound: 3, golem: 1, eye: 0 };
    expect(goalNextText(p)).toBe('Наступний крок до Брами: «Анатомія Розриву» — трофеїв досить, дослідіть у панелі «Дослідження».');
    p.research.active.push({ id: 'rift-anatomy', invested: 7 });
    expect(goalNextText(p)).toBe('Наступний крок до Брами: «Анатомія Розриву» — у роботі, 7 з 20 очок потоку.');
    p.research.active = [];
    p.research.completed.push('rift-anatomy');
    expect(goalNextText(p)).toBe('Наступний крок до Брами: «Пеленг брами». Бракує трофеїв: голем 1 з 2, око 0 з 2.');
    expect(goalChain(p).map((s) => s.cls)).toEqual(['done', 'now', 'later', 'later']);
  });

  it('усі три протоколи: Брама відкрита; після поразки — пауза до повтору; перемога — зачинено', () => {
    p.research.completed.push('rift-anatomy', 'gate-bearing', 'gate-key');
    expect(nextKeyProject(p)).toBeNull();
    expect(goalChain(p).map((s) => s.text + ':' + s.cls)).toEqual([
      '✓ Анатомія Розриву:done',
      '✓ Пеленг брами:done',
      '✓ Ключ брами:done',
      '◉ Брама:now',
    ]);
    expect(goalNextText(p)).toBe('Брама Розриву відкрита — атакуйте її в «Сенсорній сітці» або тапом по порталу на геосцені.');
    p.campaign.gateReadyAt = p.geo.minute + GATE_RETRY_MINUTES;
    expect(goalNextText(p)).toBe('Брама Розриву — новий штурм через 48 тіків.');
    p.campaign.status = 'перемога';
    expect(goalNextText(p)).toBe('Браму Розриву зачинено — кампанію виграно.');
    expect(goalChain(p).at(-1)).toEqual({ text: '✓ Брама', cls: 'done' });
    p.campaign.status = 'поразка';
    expect(goalNextText(p)).toBe('Брама Розриву недоступна.');
  });

  it('штурми: наступний поріг за лічильником; усі три — без «наступного»', () => {
    p.campaign.assaults = 1;
    expect(assaultsText(p)).toBe('Штурми вузла: 1 з 3 (наступний — на загрозі 75)');
    p.campaign.assaults = 3;
    expect(assaultsText(p)).toBe('Штурми вузла: 3 з 3');
  });
});

describe('п18.5: екрани кінця партії (рішення власника «А. Два вікна + зупинка»)', () => {
  const score = { ufosShotDown: 3, missionsWon: 5, veteransAlive: 4, moneyLeft: 400, total: 1350 };

  it('розклад рахунку дослівно з превʼю власника', () => {
    expect(scoreLinesText(score)).toBe('зонди 3 × 100 · місії 5 × 150 · живі 4 × 50 · кредити 0,25 × 400');
  });

  it('перемога: доба, рахунок і розклад; поразки не видно', () => {
    p.campaign.status = 'перемога';
    p.campaign.victoryDay = 41;
    p.campaign.score = score;
    renderEndScreens(p, true, false);
    expect($('campaign-victory').classList.contains('hidden')).toBe(false);
    expect($('campaign-defeat').classList.contains('hidden')).toBe(true);
    expect($('campaign-victory-text').textContent).toBe('Брама Розриву зачинена на 41-й добі.');
    expect($('campaign-score').textContent).toBe('1350');
    expect($('campaign-score-lines').textContent).toBe(scoreLinesText(score));
    // П8.3a: «Грати далі» сховало екран — рахунок лишається
    renderEndScreens(p, false, false);
    expect($('campaign-victory').classList.contains('hidden')).toBe(true);
    expect($('campaign-score').textContent).toBe('1350');
    expect(victoryText(p)).toBe('Брама Розриву зачинена на 41-й добі.');
  });

  it('поразка за загрозою — доба поразки; банкрутство — поточна доба і рахунок з поточного стану', () => {
    p.campaign.status = 'поразка';
    p.campaign.defeatDay = 38;
    p.campaign.score = score;
    renderEndScreens(p, false, true);
    expect($('campaign-defeat').classList.contains('hidden')).toBe(false);
    expect($('campaign-defeat-text').textContent).toBe('Загроза Розриву досягла 100 на 38-й добі.');
    expect($('campaign-defeat-score').textContent).toBe('1350');
    const b = createParty(42);
    expect(defeatText(b)).toBe('Банкрутство на 1-й добі: немає боєготових оперативників і кредитів на вербування.');
    expect(b.campaign.score).toBeNull();
    expect(endScore(b).total).toBeGreaterThan(0); // ядро рахунку банкрутства не фіксує — рахуємо зараз
    renderEndScreens(b, false, true);
    expect($('campaign-defeat-lines').textContent).toBe(scoreLinesText(endScore(b)));
  });
});
