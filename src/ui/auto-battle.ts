// П13.3 (ADR-0067): покроковий драйвер авто-бою — переробка демо-драйвера
// пR.2 (П6.16); режим ботів-проти-ботів вилучено з UI. Загін гравця веде
// чинна ядерна політика party-bot: DemoSteps (ai-bot.ts) — розгортка
// autoBattle, тієї самої політики, що у симуляціях П8.5/П11.8; власного RNG
// у драйвері нема (ADR-0003) — усі кидки лишаються в ін'єктованому RNG стану.
// Дії виконуються по одній (одна дія → анімації подій → коротка пауза),
// ворог відповідає чинним ШІ ядра (ai.ts) — ті самі публічні функції бою,
// що й ручні дії: події логу тих самих типів, порядок викликів rng
// детермінований (критерій 2 П13.3). «Стоп» завершує поточну дію і
// зупиняє авто-бій — далі гравець діє вручну з досягнутого стану; «Авто»
// вмикається знову з будь-якого моменту (критерій 1 П13.3).
// Під час паузи черга анімацій порожня → 0 перерисовок (idle, ADR-0029).
// Стан і лог бою від анімації не залежать — критерій «байт-у-байт».

import { DemoSteps } from '../core/ai-bot';
import { type Anim, animsFromEvents } from '../core/render-core';
import { missionOutcome, type Mission } from '../core/mission';

// Залежності драйвера від шару застосунку (main.ts): читання стану і зворотні
// виклики відображення. Драйвер не знає про DOM — лише про місію й анімації.
export interface AutoBattleDeps {
  getMission(): Mission | null;
  battleFinished(): boolean; // результат бою зафіксовано — авто-бій не запускається
  renderBattle(): void;
  renderAll(): void;
  binfo(text: string): void;
  finishBattle(outcome: 'перемога' | 'поразка'): void;
  pushAnims(anims: readonly Anim[]): void; // ставимо анімації дії в чергу AnimEngine
  hasRaf: boolean; // без rAF (тестове середовище) анімації не ставляться (П6.8)
  visibleCells?: () => ReadonlySet<string>; // П14.4: туман для чисел пошкоджень (без нього — без фільтра)
  maxHalfTurns?: number; // ліміт півходів (прецедент демо 240; тести звужують)
}

const AUTO_PAUSE_MS = 160;

export class AutoBattleDriver {
  private steps: DemoSteps | null = null; // не null — триває авто-бій
  private timer: ReturnType<typeof setTimeout> | null = null;
  private waitIdle = false; // черга анімацій дії відтворюється — пауза після onIdle

  constructor(private readonly deps: AutoBattleDeps) {}

  get busy(): boolean {
    return this.steps !== null;
  }

  // П13.3 (ADR-0067): анімації дії відтворені (onIdle AnimEngine) — коротка
  // пауза і наступна дія.
  onAnimIdle(): void {
    if (this.waitIdle) {
      this.waitIdle = false;
      this.pause();
    }
  }

  // П13.3: «Стоп» — завершити поточну дію (кроки атомарні: до виклику стопу
  // поточна дія вже у стані) і зупинити авто-бій. Таймер і прапорці скидаємо
  // (чергу анімацій скидає anim.cancel() викликаючого — closeBattle/
  // launchMission, як і раніше).
  stop(): void {
    this.steps = null;
    this.waitIdle = false;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  // П13.3: плитка «Авто»/«Стоп» — єдиний перемикач: триває — зупинити,
  // інакше — запустити (події логу і стан від перемикача не залежать).
  toggle(): void {
    if (this.steps !== null) this.stop();
    else this.start();
  }

  // П13.3: старт авто-бою з будь-якого моменту — DemoSteps продовжує з
  // досягнутого стану (живі солдати з AP, півхід фіксується на старті —
  // той самий порядок дій, що й autoBattle). Гейти: без місії, з результатом
  // або під час активного авто-бою — no-op.
  start(): void {
    const mission = this.deps.getMission();
    if (!mission || this.deps.battleFinished() || this.steps !== null) return;
    this.steps = new DemoSteps(this.deps.maxHalfTurns ?? 240);
    this.deps.binfo('Авто-бій: загін веде політика ядра. «Стоп» — керування вручну.');
    this.next();
  }

  // П13.3: наступна дія авто-бою — DemoSteps виконує одну дію (солдат
  // загону або реакцію ШІ демонів Розриву), анімації її подій ставляться в
  // чергу; коли відтворяться (onIdle) або анімацій нема (endTurn) — коротка
  // пауза і далі. renderBattle після кожної дії тримає стрічку/тулбар/
  // журнал бою в актуальному стані.
  private next(): void {
    const mission = this.deps.getMission();
    if (!mission || !this.steps) return;
    const prevLen = mission.state.log.length;
    const r = this.steps.step(mission.state);
    this.deps.renderBattle();
    // Фідбек власника (П13.3): результат вирішено ПОСЕРЕД півходу — останній
    // демон Розриву вбитий (чи загін загинув у хід демонів) — авто-бій
    // зупиняється одразу, як у ручному бою (checkOutcome після кожної дії):
    // солдати не добігають залишок AP до кінця ходу. Дзеркало ручного флоу —
    // анімації фінальної дії відтворюються, банер поверх фінального стану.
    const mid = missionOutcome(mission.state);
    if (mid === 'перемога' || mid === 'поразка') {
      this.stop();
      if (this.deps.hasRaf)
        this.deps.pushAnims(animsFromEvents(mission.state.log.slice(prevLen), mission.state.units, this.deps.visibleCells?.()));
      this.deps.finishBattle(mid);
      return;
    }
    if (r.over) {
      const outcome = missionOutcome(mission.state);
      this.stop();
      // фінальний банер — без змін (П6.16): finishBattle той самий, що в
      // звичайному бою; результат фіксується так само, як після ручного бою.
      if (outcome === 'перемога' || outcome === 'поразка') this.deps.finishBattle(outcome);
      else {
        this.deps.binfo('Авто-бій: бій не завершився за ліміт півходів.');
        this.deps.renderAll();
      }
      return;
    }
    // Патерн enqueueBattleAnims, але тут власний гейт hasRaf: без rAF (тести)
    // анімації не ставляться — авто-бій крокує лише паузами таймера.
    const anims = this.deps.hasRaf
      ? animsFromEvents(mission.state.log.slice(prevLen), mission.state.units, this.deps.visibleCells?.())
      : [];
    if (anims.length > 0) {
      this.waitIdle = true; // пауза — після відтворення черги (onIdle)
      this.deps.pushAnims(anims);
    } else {
      this.pause(); // turn-події не анімуються — пауза одразу
    }
  }

  private pause(): void {
    this.timer = setTimeout(() => this.next(), AUTO_PAUSE_MS);
  }
}
