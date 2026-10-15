// пR.2 (ADR-0037): покроковий драйвер демо-бою — винесено з main.ts без зміни
// поведінки (П6.16). Дії ботів виконуються по одній (DemoSteps — та сама
// послідовність, що й autoBattle), кожна відтворюється анімацією
// (animsFromEvents → AnimEngine), між діями — коротка пауза на таймері.
// Під час паузи черга анімацій порожня → 0 перерисовок (idle, ADR-0029).
// Стан і лог бою від анімації не залежать — критерій «байт-у-байт».

import { DemoSteps } from '../bot';
import { type Anim, animsFromEvents } from '../core/render-core';
import { missionOutcome, type Mission } from '../core/mission';

// Залежності драйвера від шару застосунку (main.ts): читання стану і зворотні
// виклики відображення. Драйвер не знає про DOM — лише про місію й анімації.
export interface DemoDeps {
  getMission(): Mission | null;
  battleFinished(): boolean; // результат бою зафіксовано — демо не запускається
  renderBattle(): void;
  renderAll(): void;
  binfo(text: string): void;
  finishBattle(outcome: 'перемога' | 'поразка'): void;
  pushAnims(anims: readonly Anim[]): void; // ставимо анімації дії в чергу AnimEngine
  hasRaf: boolean; // без rAF (тестове середовище) анімації не ставляться (П6.8)
}

const DEMO_PAUSE_MS = 160;

export class DemoDriver {
  private steps: DemoSteps | null = null; // не null — триває покрокове демо
  private timer: ReturnType<typeof setTimeout> | null = null;
  private waitIdle = false; // черга анімацій дії відтворюється — пауза після onIdle

  constructor(private readonly deps: DemoDeps) {}

  get busy(): boolean {
    return this.steps !== null;
  }

  // П6.16: анімації дії демо відтворені (onIdle AnimEngine) — коротка пауза
  // і наступна дія.
  onAnimIdle(): void {
    if (this.waitIdle) {
      this.waitIdle = false;
      this.pause();
    }
  }

  // П6.16: зупинка демо — таймер і прапорці скидаємо (чергу анімацій скидає
  // anim.cancel() викликаючого — closeBattle/launchMission, як і раніше).
  stop(): void {
    this.steps = null;
    this.waitIdle = false;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  battle(): void {
    const mission = this.deps.getMission();
    if (!mission || this.deps.battleFinished() || this.steps !== null) return;
    // П6.16: замість миттєвого autoBattle — покрокове відтворення: дії по одній,
    // лог байт-у-байт ідентичний (DemoSteps), дивитись приємніше.
    this.steps = new DemoSteps(240);
    this.deps.binfo('Демо: покрокове відтворення бою…');
    this.next();
  }

  // П6.16: наступна дія демо — DemoSteps виконує одну дію ботів, анімації її
  // подій ставляться в чергу; коли відтворяться (onIdle) або анімацій нема
  // (endTurn) — коротка пауза і далі. renderBattle після кожної дії тримає
  // стрічку/кнопки/журнал бою в актуальному стані.
  private next(): void {
    const mission = this.deps.getMission();
    if (!mission || !this.steps) return;
    const prevLen = mission.state.log.length;
    const r = this.steps.step(mission.state);
    this.deps.renderBattle();
    if (r.over) {
      const outcome = missionOutcome(mission.state);
      this.stop();
      // фінальний банер — без змін (П6.16): finishBattle той самий, що в звичайному бою
      if (outcome === 'перемога' || outcome === 'поразка') this.deps.finishBattle(outcome);
      else {
        this.deps.binfo('Демо: бій не завершився за ліміт півходів.');
        this.deps.renderAll();
      }
      return;
    }
    // Патерн enqueueBattleAnims, але тут власний гейт hasRaf: без rAF (тести)
    // анімації не ставляться — демо крокує лише паузами таймера.
    const anims = this.deps.hasRaf ? animsFromEvents(mission.state.log.slice(prevLen), mission.state.units) : [];
    if (anims.length > 0) {
      this.waitIdle = true; // пауза — після відтворення черги (onIdle)
      this.deps.pushAnims(anims);
    } else {
      this.pause(); // turn-події не анімуються — пауза одразу
    }
  }

  private pause(): void {
    this.timer = setTimeout(() => this.next(), DEMO_PAUSE_MS);
  }
}
