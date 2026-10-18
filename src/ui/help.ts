// П9.1 (Фаза 9, EARS): екран «Як грати» — онбординг нового гравця без README:
// легенда геосцени, мета кампанії (ADR-0033), керування (тап-тап, гарячі
// клавіші). Числа економіки і ваги рахунку читаються з констант ядра
// (economy.ts/campaign.ts) — єдине джерело правди, без дублювання у тексті
// (урок П8.6: числа балансу мінялись тунінгом, статичні тексти дрейфують).
// Показ: перший візит (усі слоти сейвів порожні або сховище недоступне) —
// автоматично; кнопка «?» у топбарі — будь-коли. Ядро src/core не
// змінюється (ADR-0002) — модуль лише імпортує його константи.

import { DAILY_ALLOWANCE, HIRE_PRICE, MISSION_BONUS } from '../core/economy';
import { FIGHTER_REPAIR_COST } from '../core/intercept';
import { SCORE_PER_MISSION_WON, SCORE_PER_MONEY, SCORE_PER_UFO_SHOT_DOWN, SCORE_PER_VETERAN_ALIVE, VICTORY_DAY } from '../core/campaign';
import { el } from './dom';

// Залежності від шару застосунку (main.ts): стан слотів і сховища від панелі
// збереження (ADR-0026). Екран не знає, як саме зберігаються сейви.
export interface HelpDeps {
  storageOk(): boolean; // localStorage доступний
  slotsEmpty(): boolean; // усі 3 слоти сейвів порожні
}

export interface Help {
  open(): void;
  close(): void;
  isOpen(): boolean;
  maybeShowOnFirstVisit(): void; // EARS Фази 9: перший візит — показати
}

// EARS Фази 9: «якщо гравець уперше відкриває прев'ю (немає сейвів у слотах),
// то показується екран "Як грати"». Недоступне сховище — сейвів теж немає.
export function isFirstVisit(storageOk: boolean, slotsEmpty: boolean): boolean {
  return !storageOk || slotsEmpty;
}

// Контент екрана (конкатенація рядків — стиль шару відображення, панель —
// клас .panel з index.html; клавіші — за ev.code, друковані як латиниця).
function helpHtml(): string {
  const bonusScout = MISSION_BONUS['розвідник'];
  const bonusHarvester = MISSION_BONUS['збирач'];
  return (
    '<div class="panel help-box">' +
    '<h2>Як грати</h2>' +
    '<div class="help-cols">' +
    '<div><h3>Легенда</h3><ul>' +
    '<li><b>Вузол «Рубіж»</b> — ваш штаб: перехоплюач і загін живуть у ньому.</li>' +
    '<li><b>Сенсорна сітка</b> (пунктирна рамка навколо вузла) — зона виявлення: зонди Розриву видно лише всередині неї.</li>' +
    '<li><b>Зонди Розриву</b> — «розвідник» і «збирач»: у повітрі їх можна перехопити, приземлений відкриває вікно місії.</li>' +
    '<li><b>Перехоплення</b> — перехоплюач атакує зонд у повітрі; дистанцію бою вибираєте кожен раунд, можна відступити.</li>' +
    '<li><b>Місії</b> — загін оперативників висаджується до приземленого зонду; перемога дає премію, поразка — рани.</li>' +
    '</ul></div>' +
    '<div><h3>Мета кампанії</h3><ul>' +
    '<li>Вистояти <b>' +
    VICTORY_DAY +
    ' діб</b>: на межі 30-ї доби фіксується перемога і підсумковий рахунок.</li>' +
    '<li>Рахунок: ' +
    SCORE_PER_UFO_SHOT_DOWN +
    ' за збитий зонд Розриву · ' +
    SCORE_PER_MISSION_WON +
    ' за переможну місію · ' +
    SCORE_PER_VETERAN_ALIVE +
    ' за живого ветерана · ' +
    SCORE_PER_MONEY +
    ' за кожен кредит на фініші.</li>' +
    '<li>Кредити: дотація ' +
    DAILY_ALLOWANCE +
    '/добу · премії за місію ' +
    bonusScout +
    ' (розвідник) / ' +
    bonusHarvester +
    ' (збирач) · вербування оперативника ' +
    HIRE_PRICE +
    ' · ремонт перехоплюача ' +
    FIGHTER_REPAIR_COST +
    '.</li>' +
    '<li>Поразка — банкрутство: немає боєготових оперативників і кредитів на вербування.</li>' +
    '</ul></div>' +
    '<div><h3>Керування</h3><ul>' +
    '<li>Час: «+1 тік (30 хв)» і «+1 доба» — сенсорна сітка шукає зонди лише під час руху часу.</li>' +
    '<li>Бій: бойові дії — плитки тулбара збоку; тап — вибрати клітинку (прев’ю ходу), повторний тап у ту саму клітинку — хід; мишка і дотик працюють однаково.</li>' +
    '<li>Гарячі клавіші: <b>1</b> — швидкий постріл · <b>2</b> — прицільний · <b>3</b> — черга · <b>O</b> — дозор · <b>M</b> — гель · <b>G</b> — граната · <b>E</b> — кінець ходу · <b>Esc</b> — скасувати вибір.</li>' +
    '</ul></div>' +
    '</div>' +
    // П10.2: версія гри — константа __APP_VERSION__ зі зборки (vite define з
    // package.json, vite.config.ts); число не дублюється у тексті (урок П9.1).
    '<p class="help-version">Версія ' +
    __APP_VERSION__ +
    '</p>' +
    '<button id="btn-help-close">Грати</button>' +
    '</div>'
  );
}

export function createHelp(deps: HelpDeps): Help {
  const screen = el('help-screen');
  screen.innerHTML = helpHtml();

  function open(): void {
    screen.classList.remove('hidden');
  }
  function close(): void {
    screen.classList.add('hidden');
  }
  // Кнопка «Грати» — створюється контентом вище, зв'язує її сам модуль
  // (патерн динамічних кнопок панелей); статичну «?» у топбарі зв'язує main.ts.
  el('btn-help-close').onclick = close;

  return {
    open,
    close,
    isOpen: () => !screen.classList.contains('hidden'),
    maybeShowOnFirstVisit: () => {
      if (isFirstVisit(deps.storageOk(), deps.slotsEmpty())) open();
    },
  };
}
