# Т.71 — кнопка «Евакуація» в бою: план для Vibe Code

**Хто що робить (рішення власника 15.11.2026: код кроку гри пише Mistral Vibe Code).** План, прототип коду і тестів підготувала сесія Claude (Opus 5.5). Код, тести, звіт, запис кроку і PR робить агент **Mistral Vibe Code** — код і тести вставляє готовими латками з цього плану. Знахідки аудиту виправляє Vibe Code у тій самій сесії. PR класу `approve` (зміна `src/` і `index.html`): мерж — **лише після «схвалюю» власника**, мержить планувальник; **виконавець PR не мержить**.

**Джерело:** кандидат 76 документа стану сесій Claude (евакуація є в ядрі — `evacuate` у `src/core/combat.ts`, ADR-0075, — а зі сторінки недосяжна) і крок П15.4 блоку Фази 15 у `docs/workflow.md` (частина: плитка, клавіша V, причини). Правила гри і `src/core/` не міняються: дія `evacuate`, її ціна 2 AP і результат «евакуйовано» — з ядра без змін.

**Перед роботою прочитати:** `AGENTS.md`, `docs/agents/common.md`, `docs/agents/ui.md` (розділи «Лише для хмарної сесії Claude» пропустити; розділ «Лише для Mistral Vibe Code» у `docs/agents/common.md` — прочитати). Блок Фази 15 і запис Т.70: `grep -n 'П15.4\|Т.70' docs/workflow.md | cut -c1-200`.

**Готові блоки.** Усі нові рядки цього плану — блоки з позначкою `<!-- блок: ім'я -->`. Руками їх не набирати: спершу `node scripts/vibe-plan-blocks.mjs docs/plans/t71-evac-button.md /tmp/blocks`, далі брати вміст із `/tmp/blocks/<ім'я>.txt`. Код і тести — латками (`git apply`), документи — скриптом `scripts/vibe-step.py`. Текст поза блоками — вказівки: у код, документи й опис PR його не переносити.

Код і тести перевірено на `main` = `fdc4f79` (Т.70): латки накладаються чисто, чекліст зелений, `npm test` — 47 файлів, 1195 тестів.

## Терміни гри (писати саме так)

Вивід інструментів у середовищі виконавця екранує кирилицю, тому слова легко переплутати. Файли з кирилицею читати через `python3`. У коді, тестах і документах:

- **зонд** (не «зона»), **сід** (не «сид», не «seed» у тексті), **перехоплювач** (не «перехоплюач»);
- **клітинка висадки** — синя клітинка старту загону на мапі місії (у ядрі — `evacZone`, у місії — `SQUAD_SPAWN`); **евакуація**, **евакуйовано**, **оперативник**;
- **немає** (не «не має»): «розбіжностей немає», «рядка немає»; слова «немає» і «нічого» в документи ставить скрипт `vibe-step.py docs` — руками їх у місця не вписувати;
- **наскрізний тест на сторінці** — тест vitest у `src/main.ui.test.ts`, що клікає сторінку в jsdom; це не сценарій e2e (`npm run test:e2e`, Playwright, тека `e2e/`).

## Відповідь власника (18.11.2026, до реалізації)

Питання: «Т.70 змержено о 14:43 (PR #372, тег iter-T.70), але документ стану в проєкті ще «після Т.69», і Т.71 там не обрано. Що робимо як Т.71?». Відповідь: **«Кандидат 76: евакуація»**.

Питання: «Т.71 = евакуація в бою (план П15.4). Ядро готове: 2 ОД, солдат у синій клітинці старту знімається з поля. Що входить у крок?». Відповідь: **«Кнопка + V + причини (Recommended)»**.

Питання: «Якщо евакуйовується останній солдат на полі (бій одразу закінчується без премії, зонд лишається) — питати підтвердження?». Відповідь: **«Так, вікно підтвердження (Recommended)»**.

Питання: «Де кнопка видна?». Відповідь: **«Завжди в бою місії (Recommended)»**.

Питання: «Бот авто-бою евакуюється?». Відповідь: **«Ні, як зараз (Recommended)»**.

Тексти плитки, причин, рядків `#binfo` і вікна підтвердження — рішення планувальника (власник їх не формулював); власник побачить їх на прев'ю перед «схвалюю».

У звіті, записі кроку й описі PR рішення власника цитувати **лише з цього розділу, дослівно**. Іншого власник не казав: нових цитат не складати, слова не переставляти.

## Що зробити

### 1. Код: `src/ui/toolbar.ts`, `src/ui/battle.ts`, `src/ui/input.ts`, `src/main.ts`, `index.html`

Що є зараз (перевірено по коду на `main` = `fdc4f79`): у ядрі `evacuate(state, unitId)` (2 AP, оперативник на клітинці `state.evacZone`) і результат «евакуйовано» з банером «ЗАГІН ЕВАКУЙОВАНО» в `src/ui/battle.ts`; плитки, клавіші і виклику `evacuate` на сторінці немає.

Що додає латка `code-patch`:

- `src/ui/toolbar.ts` — дія `evac`: плитка «Евакуація» (`btn-evac`) між «Граната» і «Кінець», іконка — стрілка вгору з рамки, у кутках «2 AP» і «V», підказка «2 AP · оперативник на синій клітинці висадки покидає бій; премії за місію немає · клавіша V» (число — з `EVAC_AP_COST`);
- `src/ui/battle.ts` — чиста функція `evacBlockReason` (ті самі перевірки, що в `evacuate`: клітинка висадки, потім AP) і стан плитки в `renderBattle`: у бою без клітинок висадки прихована; оперативник не на синій клітинці — неактивна, на плитці «не на висадці»; без AP — неактивна, «мало AP» (патерн П6.14, як у «Дозор»);
- `src/ui/input.ts` — `evacuateSelected` (плитка і клавіша V): без вибору — «Спершу клікніть свого оперативника.»; причина — рядком `#binfo`; останній живий оперативник на полі — лише через вікно підтвердження (`deps.confirmLastEvac`); після евакуації вибір знято, у `#binfo` — «… евакуйовано на базу. На полі лишилось оперативників: N.»; під авто-боєм нічого не робить; поки вікно відкрите, клавіші бою не діють (`deps.evacConfirmOpen`);
- `src/main.ts` — `confirmLastEvac`: вікно `#evac-confirm` «Евакуювати останнього?» з кнопками «Евакуювати» (`btn-evac-yes`) і «Скасувати» (`btn-evac-no`); `#evac-confirm` — у переліку вікон, під якими пробіл час не рухає (`OVERLAY_IDS`); плитка `evac` → `input.evacuateSelected()`;
- `index.html` — секція `#evac-confirm` поруч із `#exit-confirm` і той самий стиль модального вікна.

Застосувати латку з кореня репозиторію і закомітити назвою з блоку `commit-code`:

```
{ cat /tmp/blocks/code-patch.txt; echo; } | git apply
git add index.html src/main.ts src/ui/battle.ts src/ui/input.ts src/ui/toolbar.ts && git commit -F /tmp/blocks/commit-code.txt
```

(вирізач пише блок без кінцевого переносу рядка — `echo` його повертає, без нього `git apply` каже «corrupt patch»). Якщо `git apply` відмовляє — нічого не правити руками, а написати в сесії вивід команди. Після коміту `git diff HEAD~1 --stat` — п'ять файлів, 151 доданих рядків і 5 вилучених (хук pre-commit код не переформатовує: латку знято з уже відформатованих файлів).

<!-- блок: commit-code -->
```text
feat(ui): Т.71 — плитка «Евакуація», клавіша V і вікно для останнього оперативника
```

<!-- блок: code-patch -->
```diff
diff --git a/index.html b/index.html
index c2f78cf..cb753c4 100644
--- a/index.html
+++ b/index.html
@@ -762,4 +762,5 @@
       #game-menu,
       #exit-confirm,
+      #evac-confirm,
       #settings-dialog {
         position: fixed;
@@ -1266,4 +1267,6 @@
     <section class="hidden" id="game-menu"></section>
     <section class="hidden" id="exit-confirm"></section>
+    <!-- Т.71 (ADR-0075): підтвердження евакуації останнього оперативника — контент генерує src/main.ts -->
+    <section class="hidden" id="evac-confirm"></section>
     <!-- П12.3 (ADR-0065/0059): скелет вікна «Налаштування» — контент генерує
          src/ui/settings.ts; тумблер звуку мігрував сюди з топбара (П11.7) -->
diff --git a/src/main.ts b/src/main.ts
index 782cb86..37dd11d 100644
--- a/src/main.ts
+++ b/src/main.ts
@@ -195,5 +195,5 @@ const journal = journalUI.add; // виклики journal(text, cls, cat) у ша
 
 // Т.43: вікна поверх гри — поки хоч одне відкрите, пробіл час не рухає.
-const OVERLAY_IDS = ['help-screen', 'game-menu', 'settings-dialog', 'new-game-dialog', 'exit-confirm', 'campaign-victory'];
+const OVERLAY_IDS = ['help-screen', 'game-menu', 'settings-dialog', 'new-game-dialog', 'exit-confirm', 'campaign-victory', 'evac-confirm'];
 let gameOver = false; // банкрутство (ADR-0021): боєготових немає і грошей на найм немає
 let partyOnScreen = false; // Т.58: партію показано (не стартовий екран) — лише тоді ambient-цикл стартує
@@ -270,6 +270,27 @@ const input = createInput(ui, battle, {
   renderAll,
   autoBusy: () => autoBattle.busy,
+  confirmLastEvac,
+  evacConfirmOpen: () => !el('evac-confirm').classList.contains('hidden'),
 });
 
+// Т.71 (ADR-0075, рішення власника 18.11.2026): вікно підтвердження евакуації останнього оперативника на
+// полі — після неї бій закінчиться без премії. Розмітка — як у «Незбережені зміни» (screens.ts).
+function confirmLastEvac(name: string, yes: () => void): void {
+  const box = el('evac-confirm');
+  box.innerHTML =
+    '<div class="panel screen-dialog"><h2>Евакуювати останнього?</h2><p id="evac-confirm-text"></p>' +
+    '<div class="dialog-actions"><button id="btn-evac-yes">Евакуювати</button><button id="btn-evac-no">Скасувати</button></div></div>';
+  el('evac-confirm-text').textContent =
+    name + ' — останній оперативник на полі. Місію буде завершено без премії, зонд Розриву лишиться активним.';
+  box.classList.remove('hidden');
+  const close = (go: boolean): void => {
+    box.classList.add('hidden');
+    box.innerHTML = '';
+    if (go) yes();
+  };
+  el('btn-evac-yes').onclick = () => close(true);
+  el('btn-evac-no').onclick = () => close(false);
+}
+
 // П6.8 (ADR-0029): анімаційний рушій — черга анімацій, rAF-цикл живе лише
 // поки черга непорожня (idle → 0 перерисовок; батарея iPad). Кожен кадр —
@@ -637,4 +658,6 @@ if (typeof document !== 'undefined') {
       else if (id === 'medkit') input.armMedkit();
       else if (id === 'grenade') input.armGrenade();
+      else if (id === 'evac')
+        input.evacuateSelected(); // Т.71 (ADR-0075)
       else if (id === 'end') input.endPlayerTurn();
       // П13.3 (ADR-0067): «Авто»/«Стоп» — після зупинки драйвера плитка
diff --git a/src/ui/battle.ts b/src/ui/battle.ts
index ea85cfc..b32f65e 100644
--- a/src/ui/battle.ts
+++ b/src/ui/battle.ts
@@ -15,4 +15,5 @@ import { deployConsumables, removeLostEquipment, settleConsumables } from '../co
 import { creditMissionBonus, missionBonus } from '../core/economy';
 import {
+  EVAC_AP_COST,
   GRENADE_AP_COST,
   HEAL_AP_COST,
@@ -152,4 +153,11 @@ export function validHealTargets(state: GameState, healer: Unit): Unit[] {
 }
 
+// Т.71 (ADR-0075): чому оперативник не може евакуюватись — ті самі перевірки, що й evacuate
+// у ядрі (клітинка висадки, потім AP); null — може. Чиста функція: стан лише читається, без RNG.
+export function evacBlockReason(state: GameState, u: Unit): 'cell' | 'ap' | null {
+  if (!state.evacZone?.some((c) => c.x === u.pos.x && c.y === u.pos.y)) return 'cell';
+  return u.ap < EVAC_AP_COST ? 'ap' : null;
+}
+
 export function createBattleUI(ui: BattleUIState, deps: BattleDeps): BattleUI {
   // П14.3 (фідбек П14.2): напрямок погляду юнітів — суто відображення,
@@ -560,4 +568,20 @@ export function createBattleUI(ui: BattleUIState, deps: BattleDeps): BattleUI {
       b.classList.toggle('armed', ui.itemMode === mode);
     }
+
+    // Т.71 (ADR-0075, рішення власника 18.11.2026): плитка «Евакуація» — завжди в бою місії;
+    // оперативник не на синій клітинці висадки чи без AP — неактивна з причиною (патерн П6.14).
+    const ev = el<HTMLButtonElement>('btn-evac');
+    ev.hidden = !st.evacZone?.length;
+    const evWhy = sel === undefined ? null : evacBlockReason(st, sel);
+    ev.disabled = busy || evWhy !== null;
+    const evHint = ev.dataset.hint || ev.title;
+    ev.dataset.hint = evHint;
+    ev.title =
+      evWhy === 'cell'
+        ? evHint + ' — оперативник не на синій клітинці висадки'
+        : evWhy === 'ap'
+          ? evHint + ' — не вистачає AP (потрібно ' + EVAC_AP_COST + ')'
+          : evHint;
+    tileReason(ev, evWhy === 'cell' ? 'не на висадці' : evWhy === 'ap' ? 'мало AP' : null);
   }
 
diff --git a/src/ui/input.ts b/src/ui/input.ts
index 6380be6..ce71716 100644
--- a/src/ui/input.ts
+++ b/src/ui/input.ts
@@ -8,4 +8,5 @@
 
 import {
+  EVAC_AP_COST,
   GRENADE_AP_COST,
   GRENADE_RANGE,
@@ -16,4 +17,5 @@ import {
   distance,
   endTurn,
+  evacuate,
   hasLineOfSight,
   moveUnit,
@@ -31,5 +33,5 @@ import { BCELL } from './grid';
 import { MODE_LABEL } from './journal';
 import { byGender } from './text';
-import type { BattleUI, BattleUIState } from './battle';
+import { evacBlockReason, type BattleUI, type BattleUIState } from './battle';
 
 // П7: чиста частина cellFromEvent — координати вікна (CSS) → клітинка бойовища
@@ -63,4 +65,7 @@ export interface InputDeps {
   renderAll(): void;
   autoBusy(): boolean; // П13.3 (ADR-0067): триває авто-бій — керування заблоковано
+  // Т.71: вікно підтвердження евакуації останнього оперативника; yes — після «Евакуювати»
+  confirmLastEvac(name: string, yes: () => void): void;
+  evacConfirmOpen(): boolean; // Т.71: вікно відкрите — клавіші бою не діють
 }
 
@@ -73,4 +78,5 @@ export interface InputUI {
   armMedkit(): void; // П11.6 (ADR-0058): зведення аптечки (клавіша M)
   armGrenade(): void; // П11.6 (ADR-0058): зведення гранати (клавіша G)
+  evacuateSelected(): void; // Т.71 (ADR-0075): евакуація вибраного (клавіша V)
   disarm(): void; // Т.46: старт авто-бою знімає зведений постріл і витратник
   endPlayerTurn(): void;
@@ -575,4 +581,48 @@ export function createInput(ui: BattleUIState, battle: BattleUI, deps: InputDeps
   }
 
+  // Т.71 (ADR-0075, рішення власника 18.11.2026): «Евакуація» — плитка тулбара і клавіша V.
+  // Останнього оперативника на полі — лише після вікна підтвердження: бій закінчиться без премії.
+  function evacuateSelected(): void {
+    if (!battle.playerTurnActive() || !ui.mission) return;
+    if (deps.autoBusy()) return; // П13.3: триває авто-бій — керування заблоковано
+    const sel = battle.selectedUnit();
+    if (!sel) {
+      battle.binfo('Спершу клікніть свого оперативника.');
+      return;
+    }
+    const why = evacBlockReason(ui.mission.state, sel);
+    if (why !== null) {
+      battle.binfo(
+        why === 'cell'
+          ? 'Евакуація — лише з синьої клітинки висадки.'
+          : 'Не вистачає AP: евакуація коштує ' + EVAC_AP_COST + ', є ' + sel.ap + '.'
+      );
+      return;
+    }
+    const onField = ui.mission.state.units.filter((u) => u.side === 'player' && u.alive).length;
+    if (onField === 1) deps.confirmLastEvac(sel.name, () => evacuateNow(sel.id));
+    else evacuateNow(sel.id);
+  }
+
+  function evacuateNow(id: string): void {
+    if (!battle.playerTurnActive() || !ui.mission) return;
+    const state = ui.mission.state;
+    try {
+      const prevLen = state.log.length;
+      const { unit } = evacuate(state, id);
+      ui.selectedId = null;
+      ui.hoverPath = null;
+      disarm();
+      battle.enqueueAnims(prevLen);
+      if (!battle.checkOutcome()) {
+        const left = state.units.filter((u) => u.side === 'player' && u.alive).length;
+        battle.binfo(unit.name + ' евакуйовано на базу. На полі лишилось оперативників: ' + left + '.');
+      }
+    } catch (e) {
+      battle.binfo('✗ ' + (e as Error).message);
+    }
+    deps.renderAll();
+  }
+
   // ADR-0027 (П6.4): гарячі клавіші керування боєм — 1/2/3 (режими пострілу),
   // O (дозор), E (кінець ходу), Esc (скасувати). Ключ — за ev.code
@@ -586,4 +636,5 @@ export function createInput(ui: BattleUIState, battle: BattleUI, deps: InputDeps
   function onKeyDown(ev: KeyboardEvent): void {
     if (isTypingTarget(ev.target)) return;
+    if (deps.evacConfirmOpen()) return; // Т.71: під вікном підтвердження клавіші бою не діють
     battle.dismissTurnPlate(); // Т.33: клавіша дії прибирає підсумок ходу демонів
     if (ev.code === 'Digit1' || ev.key === '1') armFire('snap');
@@ -593,4 +644,6 @@ export function createInput(ui: BattleUIState, battle: BattleUI, deps: InputDeps
     else if (ev.code === 'KeyM') armMedkit();
     else if (ev.code === 'KeyG') armGrenade();
+    else if (ev.code === 'KeyV')
+      evacuateSelected(); // Т.71 (ADR-0075)
     else if (ev.code === 'KeyE') endPlayerTurn();
     else if (ev.key === 'Escape') cancelSelection();
@@ -605,4 +658,5 @@ export function createInput(ui: BattleUIState, battle: BattleUI, deps: InputDeps
     armMedkit,
     armGrenade,
+    evacuateSelected,
     disarm,
     endPlayerTurn,
diff --git a/src/ui/toolbar.ts b/src/ui/toolbar.ts
index e2297a5..b397b97 100644
--- a/src/ui/toolbar.ts
+++ b/src/ui/toolbar.ts
@@ -8,9 +8,19 @@
 
 import type { PixelSprite } from '../core/sprites';
-import { GRENADE_AP_COST, GRENADE_DAMAGE, GRENADE_RANGE, HEAL_AP_COST, HEAL_AMOUNT, OVERWATCH_AP_COST, RIFLE } from '../core/combat';
+import {
+  EVAC_AP_COST,
+  GRENADE_AP_COST,
+  GRENADE_DAMAGE,
+  GRENADE_RANGE,
+  HEAL_AP_COST,
+  HEAL_AMOUNT,
+  OVERWATCH_AP_COST,
+  RIFLE,
+} from '../core/combat';
 
 // Ідентифікатори дій тулбара — чинні дії бою (src/ui/battle.ts + input/
 // auto-battle); «Авто»/«Стоп» — перемикач авто-бою (П13.3, ADR-0067).
-export type ToolbarActionId = 'snap' | 'aimed' | 'auto' | 'ow' | 'medkit' | 'grenade' | 'end' | 'auto-battle';
+// Т.71 (ADR-0075): «Евакуація» — між гранатою і кінцем ходу.
+export type ToolbarActionId = 'snap' | 'aimed' | 'auto' | 'ow' | 'medkit' | 'grenade' | 'evac' | 'end' | 'auto-battle';
 
 // Палітра іконок (ігровий трек, style-references): білі силуети фігурок,
@@ -180,4 +190,23 @@ const ICON_AUTO_BATTLE: PixelSprite = {
 };
 
+// Т.71 (ADR-0075): евакуація — блакитна стрілка вгору з білої рамки (клітинки висадки).
+const ICON_EVAC: PixelSprite = {
+  rows: [
+    '.....CC.....',
+    '....CCCC....',
+    '...CCCCCC...',
+    '..CC.CC.CC..',
+    '.....CC.....',
+    '.....CC.....',
+    'WWW..CC..WWW',
+    'W....CC....W',
+    'W..........W',
+    'W..........W',
+    'W..........W',
+    'WWWWWWWWWWWW',
+  ],
+  palette: ICON_PALETTE,
+};
+
 export interface ToolbarAction {
   id: ToolbarActionId;
@@ -233,4 +262,11 @@ export const TOOLBAR_ACTIONS: readonly ToolbarAction[] = [
     icon: ICON_GRENADE,
   },
+  {
+    id: 'evac',
+    btnId: 'btn-evac',
+    label: 'Евакуація',
+    hint: EVAC_AP_COST + ' AP · оперативник на синій клітинці висадки покидає бій; премії за місію немає · клавіша V',
+    icon: ICON_EVAC,
+  },
   { id: 'end', btnId: 'btn-end', label: 'Кінець', hint: 'клавіша E', icon: ICON_END },
   {
@@ -251,7 +287,13 @@ const TILE_KEY: Partial<Record<ToolbarActionId, string>> = {
   medkit: 'M',
   grenade: 'G',
+  evac: 'V',
   end: 'E',
 };
-const ITEM_AP: Partial<Record<ToolbarActionId, number>> = { ow: OVERWATCH_AP_COST, medkit: HEAL_AP_COST, grenade: GRENADE_AP_COST };
+const ITEM_AP: Partial<Record<ToolbarActionId, number>> = {
+  ow: OVERWATCH_AP_COST,
+  medkit: HEAL_AP_COST,
+  grenade: GRENADE_AP_COST,
+  evac: EVAC_AP_COST,
+};
 
 export interface ToolbarDeps {
```

### 2. Тести модулів: `src/ui/input.test.ts`, `src/ui/toolbar.test.ts`; сценарій e2e: `e2e/acceptance.scenario.ts`

Латка `test-patch` змінює наявні тести лише там, де їх зачіпає нова плитка, нічого не послаблюючи:

- `src/ui/toolbar.test.ts` — у переліках плиток (id, підписи, ціна і клавіша в кутках) додано «Евакуація» / `btn-evac` / «2 AP» / «V» між «Граната» і «Кінець»; новий тест «Т.71: евакуація — AP з константи, синя клітинка висадки, без премії, клавіша V» — підказка плитки дослівно;
- `src/ui/input.test.ts` — у розмітці фікстури кнопка `btn-evac`, у залежностях вводу — `confirmLastEvac` (`vi.fn()`) і `evacConfirmOpen`; у кінці файла новий блок `describe('Т.71: евакуація (плитка і клавіша V)', …)` — три тести, він же блок `test-t71` нижче (скрипт поломок шукає його у файлі дослівно);
- `e2e/acceptance.scenario.ts` — у кроці «запуск місії» в переліках клавіш і цін плиток додано «V» і «2 AP».

Наявні тести **не послаблювати і не видаляти з них перевірок**; жодного `it.skip`, `it.only`.

Нові тести модуля перевіряють:

1. без вибору — «Спершу клікніть свого оперативника.»; оперативник не на синій клітинці — «Евакуація — лише з синьої клітинки висадки.» і на плитці «не на висадці», плитка неактивна; 1 AP — «Не вистачає AP: евакуація коштує 2, є 1.» і на плитці «мало AP»; з поля ніхто не знятий;
2. клавіша V на синій клітинці — оперативник покидає поле (у `evacuated`), AP −2, вибір знято, `#binfo` — «… евакуйовано на базу. На полі лишилось оперативників: N.», вікна немає; під авто-боєм V нічого не робить;
3. останній живий на полі — лише через вікно (`confirmLastEvac` з його іменем), до «Евакуювати» він на полі і бій триває; після — банер «ЗАГІН ЕВАКУЙОВАНО — врятовані на базі, зонд Розриву лишається активним».

### 3. Наскрізний тест на сторінці: `src/main.ui.test.ts`

У кінці файла новий блок `describe('Т.71: евакуація на сторінці — плитка, клавіша V і вікно підтвердження', …)` — він теж у латці `test-patch`. Сід 42, пресет «норма»; перевірено планувальником на прототипі: на `main` плитки `btn-evac` немає (червоний), з латкою коду — зелений. Сценарій: місія на першому зонді; плитка видна, підказка дослівно; оперативник на клітинці (2, 2) — плиткою, на (3, 2) — клавішею V, у `#binfo` лишилось 2, потім 1; на (2, 3) — V відкриває вікно з текстом «… — останній оперативник на полі. Місію буде завершено без премії, зонд Розриву лишиться активним.»; клавіша E під вікном хід не завершує; «Скасувати» закриває вікно, бій триває; знову V і «Евакуювати» — банер «ЗАГІН ЕВАКУЙОВАНО — врятовані на базі, зонд Розриву лишається активним».

Застосувати латку тестів і закомітити назвою з блоку `commit-test`:

```
{ cat /tmp/blocks/test-patch.txt; echo; } | git apply
git add e2e/acceptance.scenario.ts src/main.ui.test.ts src/ui/input.test.ts src/ui/toolbar.test.ts && git commit -F /tmp/blocks/commit-test.txt
```

Якщо латка не накладається або тест не проходить — не переписувати, а написати в сесії, що саме падає.

<!-- блок: commit-test -->
```text
test(ui): Т.71 — евакуація: плитка, клавіша V, причини і вікно підтвердження
```

<!-- блок: test-patch -->
```diff
diff --git a/e2e/acceptance.scenario.ts b/e2e/acceptance.scenario.ts
index 737ae44..c3542ae 100644
--- a/e2e/acceptance.scenario.ts
+++ b/e2e/acceptance.scenario.ts
@@ -370,6 +370,7 @@ test('сценарій приймання ADR-0030: партія → місія
     // Т.32: розкладка бою на трьох розмірах вікна (журнал збоку / смугою)
     // Т.33: ціна в AP і клавіша — у кутках плиток дій
-    await expect(page.locator('#btoolbar .tb-key')).toHaveText(['1', '2', '3', 'O', 'M', 'G', 'E']);
-    await expect(page.locator('#btoolbar .tb-ap')).toHaveText(['3 AP', '5 AP', '4 AP', '3 AP', '4 AP', '4 AP']); // snap, aimed, auto, дозор, гель, граната
+    // Т.71: плитка «Евакуація» — 2 AP, клавіша V
+    await expect(page.locator('#btoolbar .tb-key')).toHaveText(['1', '2', '3', 'O', 'M', 'G', 'V', 'E']);
+    await expect(page.locator('#btoolbar .tb-ap')).toHaveText(['3 AP', '5 AP', '4 AP', '3 AP', '4 AP', '4 AP', '2 AP']); // snap, aimed, auto, дозор, гель, граната, евакуація
     // Т.44: туман знебарвлено — у клітинках туману (без стіни, декору, юніта і м'якого краю) середній розкид
     // каналів max(R,G,B) − min(R,G,B) у центральній ділянці 24 × 24 px не більший за 9 (до Т.44 — 13,6–18,3);
diff --git a/src/main.ui.test.ts b/src/main.ui.test.ts
index 2c5833f..62b0fe0 100644
--- a/src/main.ui.test.ts
+++ b/src/main.ui.test.ts
@@ -1994,2 +1994,42 @@ describe('Т.69: рядок #fighter-last лишається після прог
   });
 });
+
+// Т.71 (ADR-0075, рішення власника 18.11.2026): вікно підтвердження евакуації останнього оперативника на сторінці.
+describe('Т.71: евакуація на сторінці — плитка, клавіша V і вікно підтвердження', () => {
+  it('Т.71: сід 42, пресет «норма»: загін покидає поле з синіх клітинок; останнього — через вікно, «Скасувати» його лишає', () => {
+    const key = (code: string): void => {
+      document.dispatchEvent(new KeyboardEvent('keydown', { key: code.slice(3).toLowerCase(), code, bubbles: true }));
+    };
+    const tap = (x: number, y: number): void => {
+      $('battle').dispatchEvent(new MouseEvent('click', { clientX: x * 48 + 24, clientY: y * 48 + 24 }));
+    };
+    startParty('42');
+    for (let i = 0; i < 1500 && document.querySelector('button.mission') === null; i++) btn('btn-tick').click();
+    (document.querySelector('button.mission') as HTMLButtonElement).click();
+    expect($('battle-panel').classList.contains('hidden')).toBe(false);
+    expect(btn('btn-evac').hidden).toBe(false);
+    expect(btn('btn-evac').title).toBe('2 AP · оперативник на синій клітинці висадки покидає бій; премії за місію немає · клавіша V');
+    tap(2, 2);
+    btn('btn-evac').click();
+    expect($('binfo').textContent).toMatch(/ евакуйовано на базу\. На полі лишилось оперативників: 2\.$/);
+    tap(3, 2);
+    key('KeyV');
+    expect($('binfo').textContent).toMatch(/ евакуйовано на базу\. На полі лишилось оперативників: 1\.$/);
+    tap(2, 3);
+    key('KeyV');
+    expect($('evac-confirm').classList.contains('hidden')).toBe(false);
+    expect($('evac-confirm-text').textContent).toMatch(
+      / — останній оперативник на полі\. Місію буде завершено без премії, зонд Розриву лишиться активним\.$/
+    );
+    const turn = $('bctx-turn').textContent;
+    key('KeyE'); // під вікном клавіші бою не діють
+    expect($('bctx-turn').textContent).toBe(turn);
+    btn('btn-evac-no').click();
+    expect($('evac-confirm').classList.contains('hidden')).toBe(true);
+    expect($('bresult').textContent).toBe('');
+    key('KeyV');
+    btn('btn-evac-yes').click();
+    expect($('evac-confirm').classList.contains('hidden')).toBe(true);
+    expect($('bresult').textContent).toContain('ЗАГІН ЕВАКУЙОВАНО — врятовані на базі, зонд Розриву лишається активним');
+  });
+});
diff --git a/src/ui/toolbar.test.ts b/src/ui/toolbar.test.ts
index 1e667a4..0c507dd 100644
--- a/src/ui/toolbar.test.ts
+++ b/src/ui/toolbar.test.ts
@@ -7,5 +7,14 @@
 // П13.3 (ADR-0067): остання плитка — перемикач авто-бою «Авто»/«Стоп».
 import { beforeEach, describe, expect, it, vi } from 'vitest';
-import { GRENADE_AP_COST, GRENADE_DAMAGE, GRENADE_RANGE, HEAL_AP_COST, HEAL_AMOUNT, OVERWATCH_AP_COST, RIFLE } from '../core/combat';
+import {
+  EVAC_AP_COST,
+  GRENADE_AP_COST,
+  GRENADE_DAMAGE,
+  GRENADE_RANGE,
+  HEAL_AP_COST,
+  HEAL_AMOUNT,
+  OVERWATCH_AP_COST,
+  RIFLE,
+} from '../core/combat';
 import { ICON_SIZE, TOOLBAR_ACTIONS, createToolbar, drawToolbarIcon, type ToolbarActionId } from './toolbar';
 
@@ -50,4 +59,5 @@ describe('Т.33: ціна в AP і клавіша в кутках плитки',
       ['btn-medkit', HEAL_AP_COST + ' AP', 'M'],
       ['btn-grenade', GRENADE_AP_COST + ' AP', 'G'],
+      ['btn-evac', EVAC_AP_COST + ' AP', 'V'],
       ['btn-end', null, 'E'],
       ['btn-auto-battle', null, null],
@@ -62,5 +72,5 @@ describe('тулбар: перелік дій (П13.2, ADR-0066)', () => {
     const buttons = [...document.querySelectorAll<HTMLButtonElement>('#btoolbar button')];
     expect(buttons.map((b) => b.id)).toEqual(TOOLBAR_ACTIONS.map((a) => a.btnId)); // той самий порядок
-    expect(TOOLBAR_ACTIONS.map((a) => a.id)).toEqual(['snap', 'aimed', 'auto', 'ow', 'medkit', 'grenade', 'end', 'auto-battle']);
+    expect(TOOLBAR_ACTIONS.map((a) => a.id)).toEqual(['snap', 'aimed', 'auto', 'ow', 'medkit', 'grenade', 'evac', 'end', 'auto-battle']);
     expect(TOOLBAR_ACTIONS.map((a) => a.label)).toEqual([
       'Швидкий',
@@ -70,4 +80,5 @@ describe('тулбар: перелік дій (П13.2, ADR-0066)', () => {
       'Лікування',
       'Граната',
+      'Евакуація',
       'Кінець',
       'Авто',
@@ -123,3 +134,7 @@ describe('тулбар: числові підказки механіки з ко
     expect(g).toContain('уражає і своїх');
   });
+
+  it('Т.71: евакуація — AP з константи, синя клітинка висадки, без премії, клавіша V', () => {
+    expect(hint('evac')).toBe(EVAC_AP_COST + ' AP · оперативник на синій клітинці висадки покидає бій; премії за місію немає · клавіша V');
+  });
 });
diff --git a/src/ui/input.test.ts b/src/ui/input.test.ts
index 1254b96..e23e338 100644
--- a/src/ui/input.test.ts
+++ b/src/ui/input.test.ts
@@ -49,4 +49,5 @@ function setupDom(): void {
       <button id="btn-medkit">Лікування</button>
       <button id="btn-grenade">Граната</button>
+      <button id="btn-evac">Евакуація</button>
       <button id="btn-end">Кінець ходу</button>
       <button id="btn-auto-battle"><span class="tb-cap">Авто</span></button>
@@ -78,5 +79,5 @@ interface Fixture {
   battle: ReturnType<typeof createBattleUI>;
   input: ReturnType<typeof createInput>;
-  deps: InputDeps & { autoBusy: ReturnType<typeof vi.fn> };
+  deps: InputDeps & { autoBusy: ReturnType<typeof vi.fn>; confirmLastEvac: ReturnType<typeof vi.fn> };
   binfo(): string;
 }
@@ -110,5 +111,6 @@ function makeFixture(autoBusy = false, queue: Anim[] = []): Fixture {
   const battle = createBattleUI(ui, battleDeps);
   const busy = vi.fn(() => autoBusy);
-  const input = createInput(ui, battle, { renderAll: vi.fn(), autoBusy: busy });
+  const confirmLastEvac = vi.fn(); // Т.71: вікно підтвердження — у тестах лише виклик
+  const input = createInput(ui, battle, { renderAll: vi.fn(), autoBusy: busy, confirmLastEvac, evacConfirmOpen: () => false });
   return {
     party,
@@ -116,5 +118,5 @@ function makeFixture(autoBusy = false, queue: Anim[] = []): Fixture {
     battle,
     input,
-    deps: { renderAll: vi.fn(), autoBusy: busy },
+    deps: { renderAll: vi.fn(), autoBusy: busy, confirmLastEvac, evacConfirmOpen: () => false },
     binfo: () => document.getElementById('binfo')!.textContent ?? '',
   };
@@ -701,2 +703,74 @@ describe('Т.46: старт авто-бою знімає зведений реж
   });
 });
+
+// Т.71 (ADR-0075, рішення власника 18.11.2026): «Евакуація» — плитка тулбара і клавіша V; оперативник
+// на синій клітинці висадки покидає поле; останнього — лише через вікно підтвердження.
+describe('Т.71: евакуація (плитка і клавіша V)', () => {
+  const keyV = (f: Fixture): void => f.input.onKeyDown(new KeyboardEvent('keydown', { key: 'v', code: 'KeyV' }));
+  const squad = (f: Fixture): Unit[] => f.ui.mission!.state.units.filter((u) => u.side === 'player' && u.alive);
+  const cap = (): string => document.querySelector('#btn-evac .tb-cap')?.textContent ?? '';
+
+  it('Т.71: без вибору — підказка; не на висадці і без AP — причина в підказці й на плитці', () => {
+    const f = makeFixture();
+    launchMission(f);
+    document.getElementById('btn-evac')!.innerHTML = '<span class="tb-cap">Евакуація</span>';
+    keyV(f);
+    expect(f.binfo()).toBe('Спершу клікніть свого оперативника.');
+    const [s] = squad(f);
+    f.ui.selectedId = s!.id;
+    s!.pos = { x: 10, y: 10 };
+    keyV(f);
+    expect(f.binfo()).toBe('Евакуація — лише з синьої клітинки висадки.');
+    f.battle.renderBattle();
+    expect(cap()).toBe('не на висадці');
+    expect((document.getElementById('btn-evac') as HTMLButtonElement).disabled).toBe(true);
+    s!.pos = { x: 2, y: 2 };
+    s!.ap = 1;
+    keyV(f);
+    expect(f.binfo()).toBe('Не вистачає AP: евакуація коштує 2, є 1.');
+    f.battle.renderBattle();
+    expect(cap()).toBe('мало AP');
+  });
+
+  it('Т.71: клавіша V на синій клітинці — оперативник покидає поле, вибір знято; під авто-боєм V не діє', () => {
+    const f = makeFixture();
+    launchMission(f);
+    const [s, t] = squad(f);
+    const n = squad(f).length;
+    expect(n).toBeGreaterThan(1);
+    f.ui.selectedId = t!.id;
+    f.deps.autoBusy.mockReturnValue(true);
+    keyV(f);
+    expect(squad(f)).toHaveLength(n);
+    f.deps.autoBusy.mockReturnValue(false);
+    f.ui.selectedId = s!.id;
+    keyV(f);
+    expect(squad(f).map((u) => u.id)).not.toContain(s!.id);
+    expect(f.ui.mission!.state.evacuated!.map((u) => u.id)).toEqual([s!.id]);
+    expect(f.ui.selectedId).toBeNull();
+    expect(f.binfo()).toBe(s!.name + ' евакуйовано на базу. На полі лишилось оперативників: ' + (n - 1) + '.');
+    expect(f.deps.confirmLastEvac).not.toHaveBeenCalled();
+  });
+
+  it('Т.71: останній на полі — лише через вікно підтвердження; без «Евакуювати» він лишається, після — бій «евакуйовано»', () => {
+    const f = makeFixture();
+    launchMission(f);
+    const all = squad(f);
+    for (const u of all.slice(0, -1)) {
+      f.ui.selectedId = u.id;
+      keyV(f);
+    }
+    const last = all[all.length - 1]!;
+    f.ui.selectedId = last.id;
+    keyV(f);
+    expect(f.deps.confirmLastEvac).toHaveBeenCalledTimes(1);
+    expect(f.deps.confirmLastEvac.mock.calls[0]![0]).toBe(last.name);
+    expect(squad(f).map((u) => u.id)).toEqual([last.id]);
+    expect(f.ui.battleResult).toBeNull();
+    (f.deps.confirmLastEvac.mock.calls[0]![1] as () => void)();
+    expect(squad(f)).toEqual([]);
+    expect(document.getElementById('bresult')!.textContent).toContain(
+      'ЗАГІН ЕВАКУЙОВАНО — врятовані на базі, зонд Розриву лишається активним'
+    );
+  });
+});
```

Блок нових тестів модуля — для скрипта поломок (у файл його вже вставила латка; окремо не вставляти):

<!-- блок: test-t71 -->
```ts
// Т.71 (ADR-0075, рішення власника 18.11.2026): «Евакуація» — плитка тулбара і клавіша V; оперативник
// на синій клітинці висадки покидає поле; останнього — лише через вікно підтвердження.
describe('Т.71: евакуація (плитка і клавіша V)', () => {
  const keyV = (f: Fixture): void => f.input.onKeyDown(new KeyboardEvent('keydown', { key: 'v', code: 'KeyV' }));
  const squad = (f: Fixture): Unit[] => f.ui.mission!.state.units.filter((u) => u.side === 'player' && u.alive);
  const cap = (): string => document.querySelector('#btn-evac .tb-cap')?.textContent ?? '';

  it('Т.71: без вибору — підказка; не на висадці і без AP — причина в підказці й на плитці', () => {
    const f = makeFixture();
    launchMission(f);
    document.getElementById('btn-evac')!.innerHTML = '<span class="tb-cap">Евакуація</span>';
    keyV(f);
    expect(f.binfo()).toBe('Спершу клікніть свого оперативника.');
    const [s] = squad(f);
    f.ui.selectedId = s!.id;
    s!.pos = { x: 10, y: 10 };
    keyV(f);
    expect(f.binfo()).toBe('Евакуація — лише з синьої клітинки висадки.');
    f.battle.renderBattle();
    expect(cap()).toBe('не на висадці');
    expect((document.getElementById('btn-evac') as HTMLButtonElement).disabled).toBe(true);
    s!.pos = { x: 2, y: 2 };
    s!.ap = 1;
    keyV(f);
    expect(f.binfo()).toBe('Не вистачає AP: евакуація коштує 2, є 1.');
    f.battle.renderBattle();
    expect(cap()).toBe('мало AP');
  });

  it('Т.71: клавіша V на синій клітинці — оперативник покидає поле, вибір знято; під авто-боєм V не діє', () => {
    const f = makeFixture();
    launchMission(f);
    const [s, t] = squad(f);
    const n = squad(f).length;
    expect(n).toBeGreaterThan(1);
    f.ui.selectedId = t!.id;
    f.deps.autoBusy.mockReturnValue(true);
    keyV(f);
    expect(squad(f)).toHaveLength(n);
    f.deps.autoBusy.mockReturnValue(false);
    f.ui.selectedId = s!.id;
    keyV(f);
    expect(squad(f).map((u) => u.id)).not.toContain(s!.id);
    expect(f.ui.mission!.state.evacuated!.map((u) => u.id)).toEqual([s!.id]);
    expect(f.ui.selectedId).toBeNull();
    expect(f.binfo()).toBe(s!.name + ' евакуйовано на базу. На полі лишилось оперативників: ' + (n - 1) + '.');
    expect(f.deps.confirmLastEvac).not.toHaveBeenCalled();
  });

  it('Т.71: останній на полі — лише через вікно підтвердження; без «Евакуювати» він лишається, після — бій «евакуйовано»', () => {
    const f = makeFixture();
    launchMission(f);
    const all = squad(f);
    for (const u of all.slice(0, -1)) {
      f.ui.selectedId = u.id;
      keyV(f);
    }
    const last = all[all.length - 1]!;
    f.ui.selectedId = last.id;
    keyV(f);
    expect(f.deps.confirmLastEvac).toHaveBeenCalledTimes(1);
    expect(f.deps.confirmLastEvac.mock.calls[0]![0]).toBe(last.name);
    expect(squad(f).map((u) => u.id)).toEqual([last.id]);
    expect(f.ui.battleResult).toBeNull();
    (f.deps.confirmLastEvac.mock.calls[0]![1] as () => void)();
    expect(squad(f)).toEqual([]);
    expect(document.getElementById('bresult')!.textContent).toContain(
      'ЗАГІН ЕВАКУЙОВАНО — врятовані на базі, зонд Розриву лишається активним'
    );
  });
});
```

### 4. Навмисні поломки (до PR, результати — у звіт)

Код і тести спершу закомітити (назвами з блоків `commit-code` і `commit-test`). Поломки робить скрипт: `python3 scripts/vibe-step.py mutations` з кореня репозиторію (дані — блок `step` нижче). Він по одній робить поломку, проганяє кожен із трьох нових тестів модуля окремо і файли `src/main.ui.test.ts` та `src/ui/toolbar.test.ts` цілком, повертає файл, пише таблицю у `/tmp/t71/table.md` і підсумок реченням у `/tmp/t71/summary.md` — у звіт обидва йдуть цими файлами, без правок руками (розділ 5). Третій файл, `/tmp/t71/expects.md`, — для планувальника: у документи кроку він не йде. Прогін — ≈ 4 хв на прототипі. Що побачив планувальник на прототипі (після останньої правки прототипу, повний вивід прогону) — блоком `table-plan`: з ним `vibe-step.py docs` звіряє таблицю виконавця і сам пише у звіт «немає» або номери розбіжних рядків (розділ 5).

<!-- блок: table-plan -->
```text
| № | Поломка | Т.71 причини (окремо) | Т.71 клавіша V (окремо) | Т.71 останній (окремо) | Т.71 на сторінці | Т.71 підказка плитки |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | вікна підтвердження немає: останній покидає поле одразу | зелений | зелений | червоний | червоний | зелений |
| 2 | «Скасувати» у вікні евакуює | зелений | зелений | зелений | червоний | зелений |
| 3 | під вікном підтвердження клавіші бою діють | зелений | зелений | зелений | червоний | зелений |
| 4 | `evacBlockReason` не перевіряє клітинку висадки | червоний | зелений | зелений | зелений | зелений |
| 5 | `evacBlockReason` не перевіряє AP | червоний | зелений | зелений | зелений | зелений |
| 6 | клавіша V не прив’язана (KeyB замість KeyV) | червоний | червоний | червоний | червоний | зелений |
| 7 | після евакуації вибір не знято | зелений | червоний | зелений | зелений | зелений |
| 8 | під авто-боєм евакуація діє | зелений | червоний | зелений | зелений | зелений |
| 9 | плитка «Евакуація» лишається активною з причиною | червоний | зелений | зелений | зелений | зелений |
| 10 | змінити слово в причині на плитці в `src/ui/battle.ts` («висадці» → «посадці») | червоний | зелений | зелений | зелений | зелений |
| 11 | змінити слово в рядку `#binfo` в `src/ui/input.ts` («синьої» → «зеленої») | червоний | зелений | зелений | зелений | зелений |
| 12 | змінити слово в тексті вікна в `src/main.ts` («останній» → «крайній») | зелений | зелений | зелений | червоний | зелений |
| 13 | змінити слово в підказці плитки в `src/ui/toolbar.ts` («премії» → «нагороди») | зелений | зелений | зелений | червоний | червоний |
| 14 | змінити причину нестачі AP на плитці в `src/ui/battle.ts` («мало AP» → «мало ОД») | червоний | зелений | зелений | зелений | зелений |
| 15 | змінити слово в рядку `#binfo` після евакуації в `src/ui/input.ts` («на базу» → «додому») | зелений | червоний | зелений | червоний | зелений |
| 16 | у вікно підтвердження йде id, а не ім’я оперативника | зелений | зелений | червоний | зелений | зелений |
| 17 | «Евакуювати» у вікні нікого не евакуює | зелений | зелений | червоний | червоний | зелений |
```

Підсумок, який надрукував скрипт на прототипі: «Навмисних поломок — 17; хоча б один новий тест ловить 13 з 17.». Перевірки `expect` без поломки на прототипі (файл `expects.md`): шість рядків. `expect(n).toBeGreaterThan(1)` — крок сценарію (на полі більше одного оперативника). Решта п'ять — перевірки після сильнішої в тому ж тесті: `evacuated` дорівнює `[s.id]` і `confirmLastEvac` не викликано (тест «клавіша V») — після «оперативника на полі немає»; на полі лише останній, `battleResult` ще `null` (тест «останній») — після «вікно викликано один раз»; банер у `#bresult` — після «на полі нікого». Поломки, що зламали б їх (1, 6, 17), першою ловить перевірка вище, окремої поломки на них немає.

Розбіжність із таблицею плану виконавець не пояснює і не домислює: розбіжні рядки назве `vibe-step.py docs`.

<!-- блок: step -->
```text
{'step': 'Т.71',
 'plan': 'docs/plans/t71-evac-button.md',
 'report': 'docs/reports/t71-evac-button.md',
 'anchor': '    - Звіт — `docs/reports/t70-vibe-step-scripts.md`\n',
 'new_file': 'src/ui/input.test.ts',
 'test_block': 'test-t71',
 'files': ['src/main.ui.test.ts', 'src/ui/toolbar.test.ts'],
 'alone': [('Т.71 причини (окремо)', 'Т.71: без вибору — підказка; не на висадці і без AP — причина в підказці й на плитці'),
           ('Т.71 клавіша V (окремо)', 'Т.71: клавіша V на синій клітинці — оперативник покидає поле, вибір знято; під авто-боєм V не діє'),
           ('Т.71 останній (окремо)', 'Т.71: останній на полі — лише через вікно підтвердження; без «Евакуювати» він лишається, після — бій «евакуйовано»')],
 'whole': [('Т.71 на сторінці', 'Т.71: сід 42, пресет «норма»: загін покидає поле з синіх клітинок; останнього — через вікно, «Скасувати» його лишає'),
           ('Т.71 підказка плитки', 'Т.71: евакуація — AP з константи, синя клітинка висадки, без премії, клавіша V')],
 'mutations': [('вікна підтвердження немає: останній покидає поле одразу', 'src/ui/input.ts',
                '    if (onField === 1) deps.confirmLastEvac(sel.name, () => evacuateNow(sel.id));',
                '    if (onField === 0) deps.confirmLastEvac(sel.name, () => evacuateNow(sel.id));'),
               ('«Скасувати» у вікні евакуює', 'src/main.ts',
                "  el('btn-evac-no').onclick = () => close(false);", "  el('btn-evac-no').onclick = () => close(true);"),
               ('під вікном підтвердження клавіші бою діють', 'src/ui/input.ts',
                '    if (deps.evacConfirmOpen()) return; // Т.71: під вікном підтвердження клавіші бою не діють\n', ''),
               ('`evacBlockReason` не перевіряє клітинку висадки', 'src/ui/battle.ts',
                "  if (!state.evacZone?.some((c) => c.x === u.pos.x && c.y === u.pos.y)) return 'cell';\n", ''),
               ('`evacBlockReason` не перевіряє AP', 'src/ui/battle.ts',
                "  return u.ap < EVAC_AP_COST ? 'ap' : null;", '  return null;'),
               ('клавіша V не прив’язана (KeyB замість KeyV)', 'src/ui/input.ts', "ev.code === 'KeyV'", "ev.code === 'KeyB'"),
               ('після евакуації вибір не знято', 'src/ui/input.ts',
                '      ui.selectedId = null;\n      ui.hoverPath = null;\n      disarm();', '      ui.hoverPath = null;\n      disarm();'),
               ('під авто-боєм евакуація діє', 'src/ui/input.ts',
                '    if (deps.autoBusy()) return; // П13.3: триває авто-бій — керування заблоковано\n    const sel = battle.selectedUnit();\n    if (!sel) {\n      battle.binfo(\'Спершу клікніть свого оперативника.\');\n      return;\n    }\n    const why',
                "    const sel = battle.selectedUnit();\n    if (!sel) {\n      battle.binfo('Спершу клікніть свого оперативника.');\n      return;\n    }\n    const why"),
               ('плитка «Евакуація» лишається активною з причиною', 'src/ui/battle.ts',
                '    ev.disabled = busy || evWhy !== null;', '    ev.disabled = busy;'),
               ('змінити слово в причині на плитці в `src/ui/battle.ts` («висадці» → «посадці»)', 'src/ui/battle.ts',
                "'не на висадці'", "'не на посадці'"),
               ('змінити слово в рядку `#binfo` в `src/ui/input.ts` («синьої» → «зеленої»)', 'src/ui/input.ts',
                "'Евакуація — лише з синьої клітинки висадки.'", "'Евакуація — лише з зеленої клітинки висадки.'"),
               ('змінити слово в тексті вікна в `src/main.ts` («останній» → «крайній»)', 'src/main.ts',
                "' — останній оперативник на полі.", "' — крайній оперативник на полі."),
               ('змінити слово в підказці плитки в `src/ui/toolbar.ts` («премії» → «нагороди»)', 'src/ui/toolbar.ts',
                'премії за місію немає', 'нагороди за місію немає'),
               ('змінити причину нестачі AP на плитці в `src/ui/battle.ts` («мало AP» → «мало ОД»)', 'src/ui/battle.ts',
                "evWhy === 'ap' ? 'мало AP' : null", "evWhy === 'ap' ? 'мало ОД' : null"),
               ('змінити слово в рядку `#binfo` після евакуації в `src/ui/input.ts` («на базу» → «додому»)', 'src/ui/input.ts',
                "' евакуйовано на базу.", "' евакуйовано додому."),
               ('у вікно підтвердження йде id, а не ім’я оперативника', 'src/ui/input.ts',
                'deps.confirmLastEvac(sel.name,', 'deps.confirmLastEvac(sel.id,'),
               ('«Евакуювати» у вікні нікого не евакуює', 'src/ui/input.ts',
                '() => evacuateNow(sel.id));', '() => undefined);')]}
```

### 5. Документи кроку (у гілці до відкриття PR)

Звіт, запис кроку, рядок довідника і чернетку опису PR збирає скрипт `vibe-step.py docs` з блоків цього плану — `report`, `limits`, `record`, `handbook`, `pr-body`, `table-plan` — і з файлів скриптів поломок і чекліста. Виконавець у цих документах руками нічого не набирає і не править: ні чисел, ні слів «немає» чи «нічого». Порядок: коміт коду → коміт тестів → `vibe-step.py mutations` → `vibe-step.py checklist` (розділ «Чекліст перед PR») → `vibe-step.py docs` → коміт документів → `vibe-step.py check` (розділ «PR»). Після будь-якого нового коміту з кодом чи тестами — знову `vibe-step.py mutations`, `vibe-step.py checklist` з усіма ключами і зведенням, `vibe-step.py docs`: застарілих результатів `vibe-step.py docs` не візьме — відмовить і назве, що перезапустити.

- Звіт `docs/reports/t71-evac-button.md` з розділами: «Що зроблено», «Навмисні поломки», «Межі», «Чекліст перед PR», «Метрики», «Що з чекліста не вдалося». Усі вони є в блоці `report`. Власного підсумку таблиці поломок не писати: лише речення зі скрипта.
- Межі — блок `limits`, **словами плану, без переказу**; у звіт його вставляє скрипт. Межу, знайдену під час роботи, виконавець пише в сесії, а не у звіт.

<!-- блок: limits -->
```text
- (а) Звуку події евакуації і разової підказки «Можна евакуюватись» (решта кроку П15.4) немає: за відповіддю власника в крок увійшли кнопка, клавіша V і причини.
- (б) Бот авто-бою не евакуюється (відповідь власника «Ні, як зараз»); політика евакуації бота — крок П15.5 із симуляціями балансу.
- (в) Рядка про евакуацію в журналі бою немає: `battleEventText` подію `evac_unit` не показує; про евакуацію каже лише рядок `#binfo`.
- (г) Заборона клавіш бою — лише під вікном евакуації (рішення планувальника): під вікнами «Меню» і «Як грати» клавіші бою діють, як і до кроку.
- (д) Плитка прихована лише в бою без клітинок висадки; на сторінці таких боїв немає (кожен бій — місія), тож гілку `hidden` тест на сторінці не перевіряє.
- (е) Наскрізний тест на сторінці не бачить, що оперативник зник з канви (канва в jsdom — заглушка): це видно лише на прев'ю.
```

<!-- блок: report -->
````text
# Т.71 — кнопка «Евакуація» в бою: звіт

План — `docs/plans/t71-evac-button.md`. Код і тести — готовими латками плану, поломки, чекліст, звіт, запис кроку і PR — Mistral Vibe Code; план, прототип коду і тестів — сесія Claude (Opus 5.5).

## Що зроблено

- Плитка тулбара «Евакуація» (`btn-evac`, 2 AP, клавіша V) між «Граната» і «Кінець»: оперативник на синій клітинці висадки покидає бій через `evacuate` ядра (ADR-0075, ядро без змін).
- Причини неактивності на плитці — «не на висадці» і «мало AP» (ті самі перевірки, що в ядрі, — `evacBlockReason` у `src/ui/battle.ts`); причини — і рядком `#binfo` на клавішу V.
- Останній живий оперативник на полі — лише через вікно «Евакуювати останнього?» (`#evac-confirm`, кнопки «Евакуювати» і «Скасувати»); під вікном клавіші бою і пробіл не діють.
- Тести: три нові тести модуля вводу, тест підказки плитки, наскрізний тест на сторінці (сід 42, пресет «норма»); переліки плиток у тесті тулбара і в сценарії e2e доповнено новою плиткою.

## Навмисні поломки

Поломки робив скрипт `python3 scripts/vibe-step.py mutations` за блоком `step` плану: по одній поломці в коді кроку, кожен новий тест модуля — окремим прогоном, `src/main.ui.test.ts` і `src/ui/toolbar.test.ts` — файлами цілком; файл після кожної поломки повернуто.

<таблиця поломок>

<речення з summary.md>

Розбіжності з таблицею плану: <розбіжності з таблицею плану>

## Межі

<межі плану>

## Чекліст перед PR

<рядки чекліста>

## Метрики

- Рядків у підрахунку `./scripts/pr-size.sh origin/main HEAD` — <число рядків>
- Час від запуску сесії до відкриття PR — запише планувальник після аудиту, за своїм годинником

## Що з чекліста не вдалося

<що з чекліста не вдалося>

## Відповідь власника (18.11.2026)

Питання: «Т.70 змержено о 14:43 (PR #372, тег iter-T.70), але документ стану в проєкті ще «після Т.69», і Т.71 там не обрано. Що робимо як Т.71?». Відповідь: «Кандидат 76: евакуація».

Питання: «Т.71 = евакуація в бою (план П15.4). Ядро готове: 2 ОД, солдат у синій клітинці старту знімається з поля. Що входить у крок?». Відповідь: «Кнопка + V + причини (Recommended)».

Питання: «Якщо евакуйовується останній солдат на полі (бій одразу закінчується без премії, зонд лишається) — питати підтвердження?». Відповідь: «Так, вікно підтвердження (Recommended)».

Питання: «Де кнопка видна?». Відповідь: «Завжди в бою місії (Recommended)».

Питання: «Бот авто-бою евакуюється?». Відповідь: «Ні, як зараз (Recommended)».

## Аудит

Аудит ще не проведено.
````

- Число рядків PR скрипт бере з `./scripts/pr-size.sh origin/main HEAD` на коміті тестів (документи в підрахунок не йдуть).
- Запис кроку в `docs/workflow.md`, розділ «Технічні задачі (позафазні)», після запису Т.70 — блок `record`; вставляє скрипт. Місця, які він заповнює: `<число рядків>`, `<речення з summary.md>`, `<урок>`. Урок — лише про те, що справді сталося в цій сесії: тоді один-два рядки записати у файл `/tmp/t71/lesson.md` і запустити `python3 scripts/vibe-step.py docs --lesson-file /tmp/t71/lesson.md`; без уроку — запуск без аргументу, скрипт сам напише «немає». Підпункт «Аудит» і номер PR — після аудиту, порцією планувальника.

<!-- блок: record -->
```text
- [x] **Т.71 (рішення власника 18.11.2026, після Т.70): кнопка «Евакуація» в бою (частина П15.4).** Мета: евакуація з ядра (ADR-0075) досяжна зі сторінки — кандидат 76 документа стану сесій Claude.
    - Зроблено: плитка «Евакуація» (2 AP, клавіша V) між «Граната» і «Кінець»; причини неактивності «не на висадці» і «мало AP» на плитці й рядком `#binfo`; останній оперативник на полі — лише через вікно «Евакуювати останнього?» (`#evac-confirm`), під вікном клавіші бою не діють; ядро без змін. Звуку і разової підказки П15.4 у кроці немає (відповідь власника), бот авто-бою не евакуюється.
    - Виконано: рядків у підрахунку `./scripts/pr-size.sh origin/main HEAD` — <число рядків>. <речення з summary.md>
    - Урок: <урок>
    - Звіт — `docs/reports/t71-evac-button.md`
```

Виконавцеві: `python3 scripts/vibe-step.py docs` з кореня репозиторію (з уроком — `--lesson-file`, пункт вище); блоки плану — у `/tmp/blocks`.

- Коміт документів — назвою з блоку `commit-docs`: `git add docs/ && git commit -F /tmp/blocks/commit-docs.txt`.

<!-- блок: commit-docs -->
```text
docs(workflow): Т.71 — звіт і запис кроку
```

- Рядок довідника виконавця — блоком `handbook`: його вставляє `vibe-step.py docs` останнім рядком розділу «Лише для Mistral Vibe Code» у `docs/agents/common.md`. Свою пораду, знайдену під час роботи, виконавець пише в сесії — у довідник вона піде блоком `handbook-v2`.

<!-- блок: handbook -->
```text
- **Т.71 (18.11.2026):** план `docs/plans/t71-evac-button.md` виконано скриптом `scripts/vibe-step.py` з блоків плану; код і тести кроку гри прийшли готовими латками `git apply` з блоків `code-patch` і `test-patch`, тож руками в код нічого не набиралось.
```

- **Писати лише те, що сам зробив і побачив.** Про секрети репозиторію, налаштування CI і чужі середовища нічого не стверджувати. Про аудит виконавець сам нічого не пише: текст розділів «Аудит» дає планувальник готовими блоками порції після аудиту. Урок — лише про те, що справді сталося в цій сесії; якщо такого немає — запуск `vibe-step.py docs` без `--lesson-file`.

## Обмеження

- **Розмір:** оцінка — 300 рядків у підрахунку `./scripts/pr-size.sh` (код, тести і e2e), один PR. Якщо виходить понад 430 рядків — написати про це в сесії до того, як продовжувати; мітку `size-deviation` не ставити.
- **Не чіпати:** `src/core/`, `package.json`, `.github/`, `AGENTS.md`, ADR, інші плани в `docs/plans/`.
- У доданих рядках (код, коментарі, тести, документи) немає трансліту — лише кирилиця.
- Тести не послаблювати, щоб пройшли.
- Історію не переписувати (без amend, rebase, force-push).
- **Працювати короткими кроками:** одна правка — одна перевірка — коміт.

## Чекліст перед PR

`npx tsc --noEmit`, `npx tsc --noEmit -p tsconfig.core.json`, `npx tsc --noEmit -p tsconfig.e2e.json`, `npm run lint`, `npm run format:check`, `npm test`, `npm run docs`, `npm run test:e2e`.

Команди запускає скрипт `vibe-step.py checklist` — по одній за запуск, на коміті тестів, до `vibe-step.py docs`: `python3 scripts/vibe-step.py checklist tsc`, потім так само з ключами `tsc-core`, `tsc-e2e`, `lint`, `format`, `test`, `docs`, `e2e`, і наостанок без ключа — `python3 scripts/vibe-step.py checklist`: він зводить результати у `/tmp/t71/checklist.md` і `/tmp/t71/failed.md`. У звіт і опис PR обидва файли вставляє `vibe-step.py docs`; результатів руками не писати. Вивід команди, що не пройшла, — у `/tmp/t71/checklist/<ключ>.log`.

Крок зачіпає сценарій e2e (`e2e/acceptance.scenario.ts` — переліки клавіш і цін плиток), тож e2e обов'язковий (`AGENTS.md`): `python3 scripts/vibe-step.py checklist e2e` (≈ 35 с на прототипі; скрипт сам обриває команду на дев'ятій хвилині, а коли браузера ревізії Playwright немає, але є інша ревізія chromium, — сам запускає з обходом `E2E_CHROME` і дописує це в рядок чекліста). Якщо e2e не піднявся або падає так само на чистому `origin/main` — скрипт запише рядок «не пройшла»; написати про причину в сесії і йти далі. Якщо падає лише на гілці — написати в сесії, що саме падає, і не відкривати PR.

Після коміту документів, перед `vibe-step.py check`: `git diff origin/main...HEAD -- . ':(exclude)docs/plans/' | grep -niP '^\+.*(?<!«)не має'` нічого не знаходить. Якщо знайшло в тексті з блоку плану — написати в сесії.

## PR

- Гілка — ця сама: `feat/t71-evac-button` (план уже в ній першим комітом). Комітити в неї. Назву коміту, яку дає план блоком `commit-…`, не набирати: `git commit -F /tmp/blocks/<ім'я блоку>.txt`. **Помилку в коміті виправляти новим комітом, а не `git commit --amend`** — і до пушу теж.
- **Документи кроку закомітити до відкриття PR**: перед `gh pr create` команда `git log --oneline origin/main..HEAD` показує коміт плану, коду, тестів і документів.
- PR у `main`, **не чернеткою**. Назва — **дослівно**: `feat(ui): Т.71 — кнопка «Евакуація» в бою`; не набирати — вона ж у блоці `pr-title`.

<!-- блок: pr-title -->
```text
feat(ui): Т.71 — кнопка «Евакуація» в бою
```

- Опис PR — **увесь** блоком `pr-body`; місця в ньому заповнюють скрипти: `vibe-step.py docs` — `<рядки чекліста>`, `<речення з summary.md>`, `<розбіжності з таблицею плану>`, `<число рядків>` (виходить чернетка `/tmp/t71/pr-body-draft.md`), `vibe-step.py check` — `<рядки vibe-plan-check>` (виходить `/tmp/pr-body.md`). Місць для виконавця в блоці немає; готовий опис руками не правити.

<!-- блок: pr-body -->
```text
### Що змінено і чому

Евакуація з місії є в ядрі (ADR-0075, `evacuate`), але зі сторінки була недосяжна. Тепер у тулбарі бою є плитка «Евакуація» (2 AP, клавіша V): оперативник на синій клітинці висадки покидає бій. Не на клітинці чи без AP — плитка неактивна з причиною «не на висадці» / «мало AP», причина — і рядком `#binfo`. Останнього живого оперативника на полі гра евакуює лише після вікна «Евакуювати останнього?»: бій тоді закінчиться результатом «евакуйовано» без премії. Ядро без змін; звуку, разової підказки і евакуації бота авто-бою в кроці немає.

### Критерії приймання

- Оперативник на синій клітинці висадки з ≥ 2 AP — плитка «Евакуація» чи клавіша V знімає його з поля, AP −2, у `#binfo` — «… евакуйовано на базу. На полі лишилось оперативників: N.».
- Не на клітинці висадки чи < 2 AP — плитка неактивна з причиною на ній і в підказці; клавіша V дає причину в `#binfo` і нікого не знімає.
- Останній живий оперативник на полі — лише після «Евакуювати» у вікні; «Скасувати» лишає його на полі, бій триває; під вікном клавіші бою не діють.
- Під авто-боєм клавіша V нічого не робить.

### Відповідь власника (18.11.2026)

Питання: «Т.70 змержено о 14:43 (PR #372, тег iter-T.70), але документ стану в проєкті ще «після Т.69», і Т.71 там не обрано. Що робимо як Т.71?». Відповідь: «Кандидат 76: евакуація».

Питання: «Т.71 = евакуація в бою (план П15.4). Ядро готове: 2 ОД, солдат у синій клітинці старту знімається з поля. Що входить у крок?». Відповідь: «Кнопка + V + причини (Recommended)».

Питання: «Якщо евакуйовується останній солдат на полі (бій одразу закінчується без премії, зонд лишається) — питати підтвердження?». Відповідь: «Так, вікно підтвердження (Recommended)».

Питання: «Де кнопка видна?». Відповідь: «Завжди в бою місії (Recommended)».

Питання: «Бот авто-бою евакуюється?». Відповідь: «Ні, як зараз (Recommended)».

### Перевірка

<рядки чекліста>

- <речення з summary.md>
- Розбіжності з таблицею плану: <розбіжності з таблицею плану>
- Рядків у підрахунку `./scripts/pr-size.sh origin/main HEAD` — <число рядків>
- `vibe-plan-check.mjs` перед відкриттям PR, рядки «Звірено» і «Знахідок» дослівно:
<рядки vibe-plan-check>

### Аудит

Аудит ще не проведено.

Згадка: кандидат 76, П15.4 (ADR-0075); план — `docs/plans/t71-evac-button.md`.

Iter-Tag: iter-T.71
```

- Перед відкриттям PR, коли документи кроку вже закомічено, — `python3 scripts/vibe-step.py check`: скрипт сам вставляє в опис рядки «Звірено» і «Знахідок» дослівно. Знахідку в коді, тесті чи рядку довідника виконавець не виправляє руками — це текст латок плану: написати про неї в сесії і відкривати PR; виправить планувальник порцією після аудиту.
- Відкрити PR готовими файлами: `gh pr create --base main --title "$(cat /tmp/blocks/pr-title.txt)" --body-file /tmp/pr-body.md` — без `--draft`. Одразу після цього — `gh pr view <номер> --json isDraft`: має бути `{"isDraft":false}`; якщо `true` — `gh pr ready <номер>`.
- Після відкриття — `python3 scripts/vibe-step.py check --pr <номер>`. Якщо рядки звірки інші, ніж в описі, — **нового коміту не робити і опис не правити**, а написати про це в сесії.
- Після відкриття PR — коротко відповісти в сесії: номер PR, вивід `gh pr view <номер> --json isDraft`, останній рядок `vibe-step.py check --pr`, вміст `/tmp/t71/failed.md` і перелік «пункт плану — зроблено / ні» з доказом `grep` на кожен рядок «зроблено». Скільки часу зайняв крок, не писати. **Не мержити.**
- **Після відкриття PR — нічого не пушити, доки планувальник не дасть знахідок.** **Про аудит і результати чеків CI нічого не писати** — ні в документах, ні в описі PR. Розділ «Аудит» лишається «Аудит ще не проведено», доки його текст не дасть планувальник.

## Після аудиту: порції (додано планувальником після аудиту PR #373)

Знахідки обох аудиторів і що з кожною зроблено — готовим текстом у блоках нижче. Код і тести виправлено латками планувальника (прототип із ними пройшов `npm test` — 47 файлів, 1197 тестів — і e2e — 3 сценарії), тож руками в код нічого не набирати. Блоки порцій вирізати в нову теку: `node scripts/vibe-plan-blocks.mjs docs/plans/t71-evac-button.md /tmp/blocks2`. **Спершу `git pull`** — цей розділ плану прийшов новим комітом у гілку.

### Порція 1 — латки коду і тестів (два коміти, без пушу)

1. `git pull`, далі `rm -rf /tmp/blocks2 && node scripts/vibe-plan-blocks.mjs docs/plans/t71-evac-button.md /tmp/blocks2`.
2. Код: `{ cat /tmp/blocks2/code-patch-v2.txt; echo; } | git apply`, потім `git add index.html src/main.ts src/ui/battle.ts src/ui/input.ts && git commit -F /tmp/blocks2/commit-1-v2.txt`.
3. Тести: `{ cat /tmp/blocks2/test-patch-v2.txt; echo; } | git apply`, потім `git add e2e/acceptance.scenario.ts src/main.ui.test.ts src/ui/input.test.ts && git commit -F /tmp/blocks2/commit-2-v2.txt`.
4. Відповісти в сесії: вивід `git log --oneline -3` і `git diff HEAD~2 --stat`. Якщо латка не накладається — нічого не правити руками, написати вивід. Не пушити.

<!-- блок: commit-1-v2 -->
```text
fix(ui): Т.71 — вікно евакуації: плитки під ним, фокус, повторна перевірка, закриття з боєм
```

<!-- блок: code-patch-v2 -->
```diff
diff --git a/index.html b/index.html
index cb753c4..ca55c6b 100644
--- a/index.html
+++ b/index.html
@@ -277,4 +277,7 @@
         border-radius: 10px;
       }
+      #btoolbar button[hidden] {
+        display: none; /* Т.71 (аудит): display: flex вище перекриває атрибут hidden */
+      }
       #btoolbar button canvas {
         background: transparent;
diff --git a/src/main.ts b/src/main.ts
index 37dd11d..f178078 100644
--- a/src/main.ts
+++ b/src/main.ts
@@ -284,4 +284,5 @@ function confirmLastEvac(name: string, yes: () => void): void {
     name + ' — останній оперативник на полі. Місію буде завершено без премії, зонд Розриву лишиться активним.';
   box.classList.remove('hidden');
+  el('btn-evac-no').focus(); // Т.71 (аудит): фокус у вікні, а не на плитці під ним
   const close = (go: boolean): void => {
     box.classList.add('hidden');
@@ -653,4 +654,5 @@ if (typeof document !== 'undefined') {
   createToolbar(el('btoolbar'), {
     onAction: (id) => {
+      if (!el('evac-confirm').classList.contains('hidden')) return; // Т.71: під вікном евакуації плитки не діють
       battle.dismissTurnPlate(id === 'auto-battle'); // Т.33: дія гравця прибирає підсумок ходу демонів
       if (id === 'snap' || id === 'aimed' || id === 'auto') input.armFire(id);
diff --git a/src/ui/battle.ts b/src/ui/battle.ts
index b32f65e..fd8adc1 100644
--- a/src/ui/battle.ts
+++ b/src/ui/battle.ts
@@ -587,4 +587,5 @@ export function createBattleUI(ui: BattleUIState, deps: BattleDeps): BattleUI {
 
   function close(): void {
+    document.getElementById('evac-confirm')?.classList.add('hidden'); // Т.71 (аудит): вікно евакуації — разом із боєм
     deps.stopAuto(); // П13.3: авто-бій міг тривати — таймер і стан драйвера скидаємо
     deps.anim.cancel(); // П6.8: бій закрито — чергу анімацій скидаємо
diff --git a/src/ui/input.ts b/src/ui/input.ts
index ce71716..cf640bc 100644
--- a/src/ui/input.ts
+++ b/src/ui/input.ts
@@ -593,9 +593,5 @@ export function createInput(ui: BattleUIState, battle: BattleUI, deps: InputDeps
     const why = evacBlockReason(ui.mission.state, sel);
     if (why !== null) {
-      battle.binfo(
-        why === 'cell'
-          ? 'Евакуація — лише з синьої клітинки висадки.'
-          : 'Не вистачає AP: евакуація коштує ' + EVAC_AP_COST + ', є ' + sel.ap + '.'
-      );
+      evacRefused(why, sel.ap);
       return;
     }
@@ -605,7 +601,23 @@ export function createInput(ui: BattleUIState, battle: BattleUI, deps: InputDeps
   }
 
+  function evacRefused(why: 'cell' | 'ap', ap: number): void {
+    battle.binfo(
+      why === 'cell'
+        ? 'Евакуація — лише з синьої клітинки висадки.'
+        : 'Не вистачає AP: евакуація коштує ' + EVAC_AP_COST + ', є ' + ap + '.'
+    );
+  }
+
   function evacuateNow(id: string): void {
-    if (!battle.playerTurnActive() || !ui.mission) return;
+    if (!battle.playerTurnActive() || !ui.mission || deps.autoBusy()) return;
     const state = ui.mission.state;
+    // Т.71 (аудит): між вікном і «Евакуювати» стан міг змінитись — перевірки ще раз
+    const u = state.units.find((x) => x.id === id && x.alive);
+    const why = u === undefined ? null : evacBlockReason(state, u);
+    if (u === undefined || why !== null) {
+      if (u !== undefined && why !== null) evacRefused(why, u.ap);
+      deps.renderAll();
+      return;
+    }
     try {
       const prevLen = state.log.length;
@@ -617,5 +629,5 @@ export function createInput(ui: BattleUIState, battle: BattleUI, deps: InputDeps
       if (!battle.checkOutcome()) {
         const left = state.units.filter((u) => u.side === 'player' && u.alive).length;
-        battle.binfo(unit.name + ' евакуйовано на базу. На полі лишилось оперативників: ' + left + '.');
+        battle.binfo('Евакуйовано: ' + unit.name + '. На полі лишилось оперативників: ' + left + '.');
       }
     } catch (e) {
```

<!-- блок: commit-2-v2 -->
```text
test(ui): Т.71 — вікно евакуації після аудиту і e2e до банера
```

<!-- блок: test-patch-v2 -->
```diff
diff --git a/e2e/acceptance.scenario.ts b/e2e/acceptance.scenario.ts
index c3542ae..ce5d51b 100644
--- a/e2e/acceptance.scenario.ts
+++ b/e2e/acceptance.scenario.ts
@@ -775,2 +775,38 @@ test('Т.61: екран перемоги і рядок-пояснення ста
   expect(errors, 'помилки сторінки: ' + errors.join(' | ')).toEqual([]);
 });
+
+// Т.71 (рішення власника 18.11.2026; в описі обраного варіанта — e2e до банера): загін покидає бій з синіх клітинок висадки —
+// плиткою, клавішею V і, для останнього, через вікно підтвердження — до банера «ЗАГІН ЕВАКУЙОВАНО».
+test('Т.71: евакуація — плитка, клавіша V і вікно для останнього до банера «ЗАГІН ЕВАКУЙОВАНО»', async ({ page }) => {
+  const errors = watchErrors(page);
+  await page.goto('./');
+  const helpClose = page.locator('#btn-help-close'); // перший візит — «Як грати» поверх стартового екрана
+  if (await helpClose.isVisible()) await helpClose.click();
+  await page.locator('#btn-start-new').click();
+  await page.locator('#new-game-seed').fill(String(SEED));
+  await page.locator('#new-game-preset').selectOption(PRESET);
+  await page.locator('#btn-new-game-start').click();
+  await page.locator('#status-tab-base').click();
+  const mission = page.locator('#ufos button.mission').first();
+  for (let i = 0; i < MAX_TICKS_TO_MISSION && !(await mission.isVisible()); i++) await page.locator('#btn-tick').click();
+  await mission.click();
+  await expect(page.locator('#battle-panel')).toBeVisible();
+  const box = (await page.locator('#battle').boundingBox())!;
+  const k = box.width / (MISSION_MAP_W * 48);
+  const tap = (x: number, y: number): Promise<void> => page.mouse.click(box.x + (x * 48 + 24) * k, box.y + (y * 48 + 24) * k);
+  const info = page.locator('#binfo');
+  await tap(2, 2);
+  await page.locator('#btn-evac').click();
+  await expect(info).toHaveText(/^Евакуйовано: .+\. На полі лишилось оперативників: 2\.$/);
+  await tap(3, 2);
+  await page.keyboard.press('v');
+  await expect(info).toHaveText(/^Евакуйовано: .+\. На полі лишилось оперативників: 1\.$/);
+  await tap(2, 3);
+  await page.keyboard.press('v');
+  await expect(page.locator('#evac-confirm')).toBeVisible();
+  await expect(page.locator('#btn-evac-no')).toBeFocused();
+  await page.locator('#btn-evac-yes').click();
+  await expect(page.locator('#evac-confirm')).toBeHidden();
+  await expect(page.locator('#bresult')).toContainText('ЗАГІН ЕВАКУЙОВАНО — врятовані на базі, зонд Розриву лишається активним');
+  expect(errors, 'помилки сторінки: ' + errors.join(' | ')).toEqual([]);
+});
diff --git a/src/main.ui.test.ts b/src/main.ui.test.ts
index 62b0fe0..6a3934b 100644
--- a/src/main.ui.test.ts
+++ b/src/main.ui.test.ts
@@ -2012,8 +2012,8 @@ describe('Т.71: евакуація на сторінці — плитка, кл
     tap(2, 2);
     btn('btn-evac').click();
-    expect($('binfo').textContent).toMatch(/ евакуйовано на базу\. На полі лишилось оперативників: 2\.$/);
+    expect($('binfo').textContent).toMatch(/^Евакуйовано: .+\. На полі лишилось оперативників: 2\.$/);
     tap(3, 2);
     key('KeyV');
-    expect($('binfo').textContent).toMatch(/ евакуйовано на базу\. На полі лишилось оперативників: 1\.$/);
+    expect($('binfo').textContent).toMatch(/^Евакуйовано: .+\. На полі лишилось оперативників: 1\.$/);
     tap(2, 3);
     key('KeyV');
@@ -2022,6 +2022,8 @@ describe('Т.71: евакуація на сторінці — плитка, кл
       / — останній оперативник на полі\. Місію буде завершено без премії, зонд Розриву лишиться активним\.$/
     );
+    expect(document.activeElement?.id).toBe('btn-evac-no'); // фокус у вікні, а не на плитці під ним
     const turn = $('bctx-turn').textContent;
     key('KeyE'); // під вікном клавіші бою не діють
+    btn('btn-end').click(); // і плитки теж
     expect($('bctx-turn').textContent).toBe(turn);
     btn('btn-evac-no').click();
@@ -2033,3 +2035,24 @@ describe('Т.71: евакуація на сторінці — плитка, кл
     expect($('bresult').textContent).toContain('ЗАГІН ЕВАКУЙОВАНО — врятовані на базі, зонд Розриву лишається активним');
   });
+
+  it('Т.71: вихід на стартовий екран з відкритим вікном евакуації — вікно закривається разом із боєм', () => {
+    startParty('42');
+    for (let i = 0; i < 1500 && document.querySelector('button.mission') === null; i++) btn('btn-tick').click();
+    (document.querySelector('button.mission') as HTMLButtonElement).click();
+    const keyV = (): void => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', code: 'KeyV', bubbles: true }));
+    for (const [x, y] of [
+      [2, 2],
+      [3, 2],
+      [2, 3],
+    ] as const) {
+      $('battle').dispatchEvent(new MouseEvent('click', { clientX: x * 48 + 24, clientY: y * 48 + 24 }));
+      keyV();
+    }
+    expect($('evac-confirm').classList.contains('hidden')).toBe(false);
+    btn('btn-menu').click();
+    btn('btn-menu-exit').click();
+    btn('btn-exit-yes').click();
+    expect($('start-screen').classList.contains('hidden')).toBe(false);
+    expect($('evac-confirm').classList.contains('hidden')).toBe(true);
+  });
 });
diff --git a/src/ui/input.test.ts b/src/ui/input.test.ts
index e23e338..7a802ce 100644
--- a/src/ui/input.test.ts
+++ b/src/ui/input.test.ts
@@ -749,5 +749,5 @@ describe('Т.71: евакуація (плитка і клавіша V)', () => {
     expect(f.ui.mission!.state.evacuated!.map((u) => u.id)).toEqual([s!.id]);
     expect(f.ui.selectedId).toBeNull();
-    expect(f.binfo()).toBe(s!.name + ' евакуйовано на базу. На полі лишилось оперативників: ' + (n - 1) + '.');
+    expect(f.binfo()).toBe('Евакуйовано: ' + s!.name + '. На полі лишилось оперативників: ' + (n - 1) + '.');
     expect(f.deps.confirmLastEvac).not.toHaveBeenCalled();
   });
@@ -774,3 +774,32 @@ describe('Т.71: евакуація (плитка і клавіша V)', () => {
     );
   });
+
+  it('Т.71: «Евакуювати» у вікні ще раз перевіряє клітинку, AP і авто-бій — інакше нікого не знімає', () => {
+    const f = makeFixture();
+    launchMission(f);
+    const all = squad(f);
+    for (const u of all.slice(0, -1)) {
+      f.ui.selectedId = u.id;
+      keyV(f);
+    }
+    const last = all[all.length - 1]!;
+    f.ui.selectedId = last.id;
+    keyV(f);
+    const yes = f.deps.confirmLastEvac.mock.calls[0]![1] as () => void;
+    const pos = last.pos;
+    last.pos = { x: 10, y: 10 };
+    yes();
+    expect(f.binfo()).toBe('Евакуація — лише з синьої клітинки висадки.');
+    last.pos = pos;
+    last.ap = 1;
+    yes();
+    expect(f.binfo()).toBe('Не вистачає AP: евакуація коштує 2, є 1.');
+    last.ap = 2;
+    f.deps.autoBusy.mockReturnValue(true);
+    yes();
+    expect(squad(f).map((u) => u.id)).toEqual([last.id]);
+    f.deps.autoBusy.mockReturnValue(false);
+    yes();
+    expect(squad(f)).toEqual([]);
+  });
 });
```

Блок тестів модуля після латки — для скрипта поломок (у файл його вже вставила латка; окремо не вставляти):

<!-- блок: test-t71-v2 -->
```ts
// Т.71 (ADR-0075, рішення власника 18.11.2026): «Евакуація» — плитка тулбара і клавіша V; оперативник
// на синій клітинці висадки покидає поле; останнього — лише через вікно підтвердження.
describe('Т.71: евакуація (плитка і клавіша V)', () => {
  const keyV = (f: Fixture): void => f.input.onKeyDown(new KeyboardEvent('keydown', { key: 'v', code: 'KeyV' }));
  const squad = (f: Fixture): Unit[] => f.ui.mission!.state.units.filter((u) => u.side === 'player' && u.alive);
  const cap = (): string => document.querySelector('#btn-evac .tb-cap')?.textContent ?? '';

  it('Т.71: без вибору — підказка; не на висадці і без AP — причина в підказці й на плитці', () => {
    const f = makeFixture();
    launchMission(f);
    document.getElementById('btn-evac')!.innerHTML = '<span class="tb-cap">Евакуація</span>';
    keyV(f);
    expect(f.binfo()).toBe('Спершу клікніть свого оперативника.');
    const [s] = squad(f);
    f.ui.selectedId = s!.id;
    s!.pos = { x: 10, y: 10 };
    keyV(f);
    expect(f.binfo()).toBe('Евакуація — лише з синьої клітинки висадки.');
    f.battle.renderBattle();
    expect(cap()).toBe('не на висадці');
    expect((document.getElementById('btn-evac') as HTMLButtonElement).disabled).toBe(true);
    s!.pos = { x: 2, y: 2 };
    s!.ap = 1;
    keyV(f);
    expect(f.binfo()).toBe('Не вистачає AP: евакуація коштує 2, є 1.');
    f.battle.renderBattle();
    expect(cap()).toBe('мало AP');
  });

  it('Т.71: клавіша V на синій клітинці — оперативник покидає поле, вибір знято; під авто-боєм V не діє', () => {
    const f = makeFixture();
    launchMission(f);
    const [s, t] = squad(f);
    const n = squad(f).length;
    expect(n).toBeGreaterThan(1);
    f.ui.selectedId = t!.id;
    f.deps.autoBusy.mockReturnValue(true);
    keyV(f);
    expect(squad(f)).toHaveLength(n);
    f.deps.autoBusy.mockReturnValue(false);
    f.ui.selectedId = s!.id;
    keyV(f);
    expect(squad(f).map((u) => u.id)).not.toContain(s!.id);
    expect(f.ui.mission!.state.evacuated!.map((u) => u.id)).toEqual([s!.id]);
    expect(f.ui.selectedId).toBeNull();
    expect(f.binfo()).toBe('Евакуйовано: ' + s!.name + '. На полі лишилось оперативників: ' + (n - 1) + '.');
    expect(f.deps.confirmLastEvac).not.toHaveBeenCalled();
  });

  it('Т.71: останній на полі — лише через вікно підтвердження; без «Евакуювати» він лишається, після — бій «евакуйовано»', () => {
    const f = makeFixture();
    launchMission(f);
    const all = squad(f);
    for (const u of all.slice(0, -1)) {
      f.ui.selectedId = u.id;
      keyV(f);
    }
    const last = all[all.length - 1]!;
    f.ui.selectedId = last.id;
    keyV(f);
    expect(f.deps.confirmLastEvac).toHaveBeenCalledTimes(1);
    expect(f.deps.confirmLastEvac.mock.calls[0]![0]).toBe(last.name);
    expect(squad(f).map((u) => u.id)).toEqual([last.id]);
    expect(f.ui.battleResult).toBeNull();
    (f.deps.confirmLastEvac.mock.calls[0]![1] as () => void)();
    expect(squad(f)).toEqual([]);
    expect(document.getElementById('bresult')!.textContent).toContain(
      'ЗАГІН ЕВАКУЙОВАНО — врятовані на базі, зонд Розриву лишається активним'
    );
  });

  it('Т.71: «Евакуювати» у вікні ще раз перевіряє клітинку, AP і авто-бій — інакше нікого не знімає', () => {
    const f = makeFixture();
    launchMission(f);
    const all = squad(f);
    for (const u of all.slice(0, -1)) {
      f.ui.selectedId = u.id;
      keyV(f);
    }
    const last = all[all.length - 1]!;
    f.ui.selectedId = last.id;
    keyV(f);
    const yes = f.deps.confirmLastEvac.mock.calls[0]![1] as () => void;
    const pos = last.pos;
    last.pos = { x: 10, y: 10 };
    yes();
    expect(f.binfo()).toBe('Евакуація — лише з синьої клітинки висадки.');
    last.pos = pos;
    last.ap = 1;
    yes();
    expect(f.binfo()).toBe('Не вистачає AP: евакуація коштує 2, є 1.');
    last.ap = 2;
    f.deps.autoBusy.mockReturnValue(true);
    yes();
    expect(squad(f).map((u) => u.id)).toEqual([last.id]);
    f.deps.autoBusy.mockReturnValue(false);
    yes();
    expect(squad(f)).toEqual([]);
  });
});
```

### Порція 2 — поломки, чекліст, документи, опис PR, пуш

1. Поломки: `python3 scripts/vibe-step.py mutations --v2` (дані — блок `step-v2`; ≈ 6 хв на прототипі).
2. Чекліст: `python3 scripts/vibe-step.py checklist <ключ>` з ключами `tsc`, `tsc-core`, `tsc-e2e`, `lint`, `format`, `test`, `docs`, `e2e`, і наостанок без ключа. e2e у пісочниці не стартує (рядок довідника нижче) — скрипт запише «не пройшла», це очікувано.
3. Документи: `python3 scripts/vibe-step.py docs --v2 --lesson-file /tmp/blocks2/lesson-v2.txt` — звіт, запис кроку, рядок довідника і чернетку опису збирає скрипт із блоків `-v2`; руками нічого не правити.
4. Коміт: `git add docs/ && git commit -F /tmp/blocks2/commit-3-v2.txt`.
5. Звірка й опис: `python3 scripts/vibe-step.py check --v2` — має надрукувати «Знахідок немає.» і зібрати `/tmp/pr-body-v2.md`. Якщо знахідки є — написати їх у сесії і не пушити.
6. Спершу опис, потім пуш: `gh pr edit 373 --body-file /tmp/pr-body-v2.md` (якщо відмовляє — `gh api -X PATCH repos/sergkarpenko/rubezh/pulls/373 -F body=@/tmp/pr-body-v2.md`), далі `git push`. Нічого не писати про чеки й аудит від себе.
7. Відповісти в сесії: перелік «пункт — зроблено / ні», останній рядок `vibe-step.py check --v2`, вміст `/tmp/t71/failed.md`, вивід `git log --oneline -6`. Не мержити.

<!-- блок: commit-3-v2 -->
```text
docs(workflow): Т.71 — звіт, запис кроку і довідник після аудиту
```

<!-- блок: lesson-v2 -->
```text
вікно поверх бою мусить блокувати й плитки, і закриватись разом із боєм: заборони клавіш в `onKeyDown` для цього мало — плитку у фокусі Enter натискає сам браузер (знахідки 1 і 2 аудиту Opus).
```

<!-- блок: handbook-v2 -->
```text
- **Т.71 (18.11.2026):** план `docs/plans/t71-evac-button.md` виконано скриптом `scripts/vibe-step.py` з блоків плану; код і тести кроку гри прийшли готовими латками `git apply` з блоків `code-patch` і `test-patch` (після аудиту — `-v2`), тож руками в код нічого не набиралось. У пісочниці є `chromium_headless_shell-1255`, але він не стартує без системної бібліотеки `libglib-2.0.so.0` (код 127), а іншої ревізії chromium для обходу `E2E_CHROME` немає: рядок e2e чекліста — «не пройшла (код 1)», сценарії проганяє планувальник.
```

<!-- блок: step-v2 -->
```text
{'step': 'Т.71',
 'plan': 'docs/plans/t71-evac-button.md',
 'report': 'docs/reports/t71-evac-button.md',
 'anchor': '    - Звіт — `docs/reports/t70-vibe-step-scripts.md`\n',
 'new_file': 'src/ui/input.test.ts',
 'test_block': 'test-t71-v2',
 'files': ['src/main.ui.test.ts', 'src/ui/toolbar.test.ts'],
 'alone': [('Т.71 причини (окремо)', 'Т.71: без вибору — підказка; не на висадці і без AP — причина в підказці й на плитці'),
           ('Т.71 клавіша V (окремо)', 'Т.71: клавіша V на синій клітинці — оперативник покидає поле, вибір знято; під авто-боєм V не діє'),
           ('Т.71 останній (окремо)',
            'Т.71: останній на полі — лише через вікно підтвердження; без «Евакуювати» він лишається, після — бій «евакуйовано»'),
           ('Т.71 повторна перевірка (окремо)',
            'Т.71: «Евакуювати» у вікні ще раз перевіряє клітинку, AP і авто-бій — інакше нікого не знімає')],
 'whole': [('Т.71 на сторінці',
            'Т.71: сід 42, пресет «норма»: загін покидає поле з синіх клітинок; останнього — через вікно, «Скасувати» його лишає'),
           ('Т.71 вихід з вікном', 'Т.71: вихід на стартовий екран з відкритим вікном евакуації — вікно закривається разом із боєм'),
           ('Т.71 підказка плитки', 'Т.71: евакуація — AP з константи, синя клітинка висадки, без премії, клавіша V')],
 'mutations': [('вікна підтвердження немає: останній покидає поле одразу',
                'src/ui/input.ts',
                '    if (onField === 1) deps.confirmLastEvac(sel.name, () => evacuateNow(sel.id));',
                '    if (onField === 0) deps.confirmLastEvac(sel.name, () => evacuateNow(sel.id));'),
               ('«Скасувати» у вікні евакуює',
                'src/main.ts',
                "  el('btn-evac-no').onclick = () => close(false);",
                "  el('btn-evac-no').onclick = () => close(true);"),
               ('під вікном підтвердження клавіші бою діють',
                'src/ui/input.ts',
                '    if (deps.evacConfirmOpen()) return; // Т.71: під вікном підтвердження клавіші бою не діють\n',
                ''),
               ('`evacBlockReason` не перевіряє клітинку висадки',
                'src/ui/battle.ts',
                "  if (!state.evacZone?.some((c) => c.x === u.pos.x && c.y === u.pos.y)) return 'cell';\n",
                ''),
               ('`evacBlockReason` не перевіряє AP', 'src/ui/battle.ts', "  return u.ap < EVAC_AP_COST ? 'ap' : null;", '  return null;'),
               ('клавіша V не прив’язана (KeyB замість KeyV)', 'src/ui/input.ts', "ev.code === 'KeyV'", "ev.code === 'KeyB'"),
               ('після евакуації вибір не знято',
                'src/ui/input.ts',
                '      ui.selectedId = null;\n      ui.hoverPath = null;\n      disarm();',
                '      ui.hoverPath = null;\n      disarm();'),
               ('під авто-боєм евакуація діє',
                'src/ui/input.ts',
                '    if (deps.autoBusy()) return; // П13.3: триває авто-бій — керування заблоковано\n'
                '    const sel = battle.selectedUnit();\n'
                '    if (!sel) {\n'
                "      battle.binfo('Спершу клікніть свого оперативника.');\n"
                '      return;\n'
                '    }\n'
                '    const why',
                '    const sel = battle.selectedUnit();\n'
                '    if (!sel) {\n'
                "      battle.binfo('Спершу клікніть свого оперативника.');\n"
                '      return;\n'
                '    }\n'
                '    const why'),
               ('плитка «Евакуація» лишається активною з причиною',
                'src/ui/battle.ts',
                '    ev.disabled = busy || evWhy !== null;',
                '    ev.disabled = busy;'),
               ('змінити слово в причині на плитці в `src/ui/battle.ts` («висадці» → «посадці»)',
                'src/ui/battle.ts',
                "'не на висадці'",
                "'не на посадці'"),
               ('змінити слово в рядку `#binfo` в `src/ui/input.ts` («синьої» → «зеленої»)',
                'src/ui/input.ts',
                "'Евакуація — лише з синьої клітинки висадки.'",
                "'Евакуація — лише з зеленої клітинки висадки.'"),
               ('змінити слово в тексті вікна в `src/main.ts` («останній» → «крайній»)',
                'src/main.ts',
                "' — останній оперативник на полі.",
                "' — крайній оперативник на полі."),
               ('змінити слово в підказці плитки в `src/ui/toolbar.ts` («премії» → «нагороди»)',
                'src/ui/toolbar.ts',
                'премії за місію немає',
                'нагороди за місію немає'),
               ('змінити причину нестачі AP на плитці в `src/ui/battle.ts` («мало AP» → «мало ОД»)',
                'src/ui/battle.ts',
                "evWhy === 'ap' ? 'мало AP' : null",
                "evWhy === 'ap' ? 'мало ОД' : null"),
               ('змінити слово в рядку `#binfo` після евакуації в `src/ui/input.ts` («Евакуйовано» → «Вивезено»)',
                'src/ui/input.ts',
                "'Евакуйовано: '",
                "'Вивезено: '"),
               ('у вікно підтвердження йде id, а не ім’я оперативника',
                'src/ui/input.ts',
                'deps.confirmLastEvac(sel.name,',
                'deps.confirmLastEvac(sel.id,'),
               ('«Евакуювати» у вікні нікого не евакуює', 'src/ui/input.ts', '() => evacuateNow(sel.id));', '() => undefined);'),
               ('«Евакуювати» у вікні не перевіряє клітинку й AP ще раз',
                'src/ui/input.ts',
                '    const why = u === undefined ? null : evacBlockReason(state, u);',
                '    const why = u === undefined ? null : null;'),
               ('«Евакуювати» у вікні діє під авто-боєм',
                'src/ui/input.ts',
                '    if (!battle.playerTurnActive() || !ui.mission || deps.autoBusy()) return;',
                '    if (!battle.playerTurnActive() || !ui.mission) return;'),
               ('під вікном евакуації плитки діють',
                'src/main.ts',
                "      if (!el('evac-confirm').classList.contains('hidden')) return; // Т.71: під вікном евакуації плитки не діють\n",
                ''),
               ('фокус лишається на плитці під вікном',
                'src/main.ts',
                "  el('btn-evac-no').focus(); // Т.71 (аудит): фокус у вікні, а не на плитці під ним\n",
                ''),
               ('`battle.close` не закриває вікно евакуації',
                'src/ui/battle.ts',
                "    document.getElementById('evac-confirm')?.classList.add('hidden'); // Т.71 (аудит): вікно евакуації — разом із боєм\n",
                '')]}
```

<!-- блок: table-plan-v2 -->
```text
| № | Поломка | Т.71 причини (окремо) | Т.71 клавіша V (окремо) | Т.71 останній (окремо) | Т.71 повторна перевірка (окремо) | Т.71 на сторінці | Т.71 вихід з вікном | Т.71 підказка плитки |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | вікна підтвердження немає: останній покидає поле одразу | зелений | зелений | червоний | червоний | червоний | червоний | зелений |
| 2 | «Скасувати» у вікні евакуює | зелений | зелений | зелений | зелений | червоний | зелений | зелений |
| 3 | під вікном підтвердження клавіші бою діють | зелений | зелений | зелений | зелений | червоний | зелений | зелений |
| 4 | `evacBlockReason` не перевіряє клітинку висадки | червоний | зелений | зелений | червоний | зелений | зелений | зелений |
| 5 | `evacBlockReason` не перевіряє AP | червоний | зелений | зелений | червоний | зелений | зелений | зелений |
| 6 | клавіша V не прив’язана (KeyB замість KeyV) | червоний | червоний | червоний | червоний | червоний | червоний | зелений |
| 7 | після евакуації вибір не знято | зелений | червоний | зелений | зелений | зелений | зелений | зелений |
| 8 | під авто-боєм евакуація діє | зелений | зелений | зелений | зелений | зелений | зелений | зелений |
| 9 | плитка «Евакуація» лишається активною з причиною | червоний | зелений | зелений | зелений | зелений | зелений | зелений |
| 10 | змінити слово в причині на плитці в `src/ui/battle.ts` («висадці» → «посадці») | червоний | зелений | зелений | зелений | зелений | зелений | зелений |
| 11 | змінити слово в рядку `#binfo` в `src/ui/input.ts` («синьої» → «зеленої») | червоний | зелений | зелений | червоний | зелений | зелений | зелений |
| 12 | змінити слово в тексті вікна в `src/main.ts` («останній» → «крайній») | зелений | зелений | зелений | зелений | червоний | зелений | зелений |
| 13 | змінити слово в підказці плитки в `src/ui/toolbar.ts` («премії» → «нагороди») | зелений | зелений | зелений | зелений | червоний | зелений | червоний |
| 14 | змінити причину нестачі AP на плитці в `src/ui/battle.ts` («мало AP» → «мало ОД») | червоний | зелений | зелений | зелений | зелений | зелений | зелений |
| 15 | змінити слово в рядку `#binfo` після евакуації в `src/ui/input.ts` («Евакуйовано» → «Вивезено») | зелений | червоний | зелений | зелений | червоний | зелений | зелений |
| 16 | у вікно підтвердження йде id, а не ім’я оперативника | зелений | зелений | червоний | зелений | зелений | зелений | зелений |
| 17 | «Евакуювати» у вікні нікого не евакуює | зелений | зелений | червоний | червоний | червоний | зелений | зелений |
| 18 | «Евакуювати» у вікні не перевіряє клітинку й AP ще раз | зелений | зелений | зелений | червоний | зелений | зелений | зелений |
| 19 | «Евакуювати» у вікні діє під авто-боєм | зелений | зелений | зелений | червоний | зелений | зелений | зелений |
| 20 | під вікном евакуації плитки діють | зелений | зелений | зелений | зелений | червоний | зелений | зелений |
| 21 | фокус лишається на плитці під вікном | зелений | зелений | зелений | зелений | червоний | зелений | зелений |
| 22 | `battle.close` не закриває вікно евакуації | зелений | зелений | зелений | зелений | зелений | червоний | зелений |
```

Перевірки `expect` без поломки на прототипі (`expects.md`): вісім рядків. `expect(n).toBeGreaterThan(1)` — крок сценарію. `expect(squad(f)).toHaveLength(n)` під авто-боєм — поломка 8 її більше не ламає: після аудиту та сама перевірка є й у `evacuateNow` (поломка 19), тож одна поломка поведінки не міняє — поломку 8 не ловить жоден тест. Решта шість — перевірки після сильнішої в тому ж тесті (як у таблиці плану до аудиту).

<!-- блок: limits-v2 -->
```text
- (а) Звуку події евакуації і разової підказки «Можна евакуюватись» (решта кроку П15.4) немає: за відповіддю власника в крок увійшли кнопка, клавіша V і причини.
- (б) Бот авто-бою не евакуюється (відповідь власника «Ні, як зараз»); політика евакуації бота — крок П15.5 із симуляціями балансу.
- (в) Рядка про евакуацію в журналі бою немає: `battleEventText` подію `evac_unit` не показує; про евакуацію каже лише рядок `#binfo`.
- (г) Під вікнами «Меню», «Як грати» і «Незбережені зміни» клавіші бою і плитки діють, як і до кроку: заборона й фокус — лише для вікна евакуації (рішення планувальника; аудитор Opus припускає ту саму ваду з фокусом у «Незбережених змінах», крок її не перевіряв).
- (д) Плитка прихована лише в бою без клітинок висадки; на сторінці таких боїв немає (кожен бій — місія), тож приховування (атрибут `hidden` і правило `#btoolbar button[hidden]`) тести не перевіряють.
- (е) Тест модуля і тест на сторінці не бачать, що оперативник зник з канви (канва в jsdom — заглушка): це видно в сценарії e2e і на прев'ю.
- (є) Поломку 8 («під авто-боєм евакуація діє») не ловить жоден тест: та сама перевірка є і в `evacuateNow` (поломка 19) — тест ловить лише зняття обох.
- (ж) Підсумок поломок рахує лише чотири тести модуля, що йдуть окремо; поломки 12, 13, 20 і 21 ловить лише тест на сторінці, поломку 22 — лише тест виходу з вікном.
```

<!-- блок: report-v2 -->
````text
# Т.71 — кнопка «Евакуація» в бою: звіт

План — `docs/plans/t71-evac-button.md`. Код і тести — готовими латками плану, поломки, чекліст, звіт, запис кроку і PR — Mistral Vibe Code (Mistral Large 4); план, прототип коду і тестів, латки після аудиту — сесія Claude (Opus 5.5).

## Що зроблено

- Плитка тулбара «Евакуація» (`btn-evac`, 2 AP, клавіша V) між «Граната» і «Кінець»: оперативник на синій клітинці висадки покидає бій через `evacuate` ядра (ADR-0075, ядро без змін); у `#binfo` — «Евакуйовано: ім'я. На полі лишилось оперативників: N.».
- Причини неактивності на плитці — «не на висадці» і «мало AP» (ті самі перевірки, що в ядрі, — `evacBlockReason` у `src/ui/battle.ts`); причини — і рядком `#binfo` на клавішу V.
- Останній живий оперативник на полі — лише через вікно «Евакуювати останнього?» (`#evac-confirm`, кнопки «Евакуювати» і «Скасувати», фокус — на «Скасувати»). Під вікном клавіші бою, пробіл і плитки не діють; «Евакуювати» ще раз перевіряє клітинку, AP і авто-бій; вікно закривається разом із боєм.
- Тести: чотири нові тести модуля вводу, тест підказки плитки, два наскрізні тести на сторінці (сід 42, пресет «норма») і сценарій e2e «Т.71» до банера «ЗАГІН ЕВАКУЙОВАНО»; переліки плиток у тесті тулбара і в сценарії приймання доповнено новою плиткою.

## Навмисні поломки

Поломки робив скрипт `python3 scripts/vibe-step.py mutations --v2` за блоком `step-v2` плану: по одній поломці в коді кроку, кожен новий тест модуля — окремим прогоном, `src/main.ui.test.ts` і `src/ui/toolbar.test.ts` — файлами цілком; файл після кожної поломки повернуто. Підсумок рахує лише чотири тести модуля, що йдуть окремо; стовпці тестів на сторінці і тесту тулбара в нього не входять (межа (ж)).

<таблиця поломок>

<речення з summary.md>

Розбіжності з таблицею плану: <розбіжності з таблицею плану>

## Межі

<межі плану>

## Чекліст перед PR

<рядки чекліста>

## Метрики

- Рядків у підрахунку `./scripts/pr-size.sh origin/main HEAD` — <число рядків>
- Час від запуску сесії до відкриття PR — ≈ 25 хв (запуск ≈ 13:27 UTC, PR відкрито 13:52 UTC; за годинником планувальника)

## Що з чекліста не вдалося

<що з чекліста не вдалося>

## Відповідь власника (18.11.2026)

Питання: «Т.70 змержено о 14:43 (PR #372, тег iter-T.70), але документ стану в проєкті ще «після Т.69», і Т.71 там не обрано. Що робимо як Т.71?». Відповідь: «Кандидат 76: евакуація».

Питання: «Т.71 = евакуація в бою (план П15.4). Ядро готове: 2 ОД, солдат у синій клітинці старту знімається з поля. Що входить у крок?». Відповідь: «Кнопка + V + причини (Recommended)».

Питання: «Якщо евакуйовується останній солдат на полі (бій одразу закінчується без премії, зонд лишається) — питати підтвердження?». Відповідь: «Так, вікно підтвердження (Recommended)».

Питання: «Де кнопка видна?». Відповідь: «Завжди в бою місії (Recommended)».

Питання: «Бот авто-бою евакуюється?». Відповідь: «Ні, як зараз (Recommended)».

## Аудит

Аудит PR #373 (ADR-0097), два аудитори, коміт `5e9fba1`.

- Opus, субагент з копією репозиторію — знайдено 7, підтверджено 7 (≈ 6 хв, ≈ 147 тис. токенів); сценарії зіграно в браузері.
- Mistral Large (джоба `mistral-audit`) — знайдено 2, підтверджено 2 (ввід 92,9 тис. токенів).

Знахідки Opus:

1. (висока, підтверджено) Під вікном евакуації плитки діяли: фокус лишався на плитці, Enter на «Кінець» віддавав хід демонам, на «Авто» — запускав авто-бій, а «Евакуювати» не перевіряв стан ще раз. Виправлено: фокус — на «Скасувати», плитки під вікном не діють, `evacuateNow` ще раз перевіряє клітинку, AP і авто-бій; тести модуля і на сторінці.
2. (середня, підтверджено) Вікно лишалось поверх стартового екрана після виходу з бою. Виправлено: `battle.close` закриває вікно; тест на сторінці.
3. (середня, підтверджено) В описі обраного власником варіанта (відповідь «Кнопка + V + причини (Recommended)») ішлося про e2e до банера, а сценарію e2e до банера не було. Виправлено: сценарій e2e «Т.71».
4. (середня–низька, підтверджено) Атрибут `hidden` плитки не діяв: `display: flex` його перекривав. Виправлено правилом `#btoolbar button[hidden]`; тестом не покрито (межа (д)).
5. (низька, підтверджено) «Олена евакуйовано на базу» — неправильна граматика. Виправлено: «Евакуйовано: Олена. …».
6. (низька, підтверджено) Підсумок «ловить 13 з 17» при червоному в кожному рядку таблиці вводив в оману. Виправлено поясненням у звіті й межею (ж); підсумок рахує скрипт.
7. (низька, підтверджено) Прогалини тестів: повторна перевірка, закриття вікна з боєм, плитки під вікном — тести додано; приховування плитки — межа (д).

Знахідки Mistral:

1. (середня, підтверджено) Та сама, що знахідка 6 Opus: підсумок проти таблиці. Виправлено так само.
2. (низька, підтверджено) Критерій приймання «AP −2» новими тестами не перевірено (знімає AP ядро, його тести — у `src/core/`). Виправлено: «AP −2» з критеріїв прибрано.
````

<!-- блок: record-v2 -->
```text
- [x] **Т.71 (рішення власника 18.11.2026, після Т.70): кнопка «Евакуація» в бою (частина П15.4).** Мета: евакуація з ядра (ADR-0075) досяжна зі сторінки — кандидат 76 документа стану сесій Claude.
    - Зроблено: плитка «Евакуація» (2 AP, клавіша V) між «Граната» і «Кінець»; причини неактивності «не на висадці» і «мало AP» на плитці й рядком `#binfo`; останній оперативник на полі — лише через вікно «Евакуювати останнього?» (`#evac-confirm`): фокус у вікні, клавіші й плитки під ним не діють, «Евакуювати» ще раз перевіряє стан, вікно закривається разом із боєм; сценарій e2e до банера «ЗАГІН ЕВАКУЙОВАНО»; ядро без змін. Звуку і разової підказки П15.4 у кроці немає (відповідь власника), бот авто-бою не евакуюється.
    - Виконано: рядків у підрахунку `./scripts/pr-size.sh origin/main HEAD` — <число рядків>. <речення з summary.md>
    - Урок: <урок>
    - Аудит (PR #373, ADR-0097): Opus, субагент з копією репозиторію (коміт `5e9fba1`) — знайдено 7, підтверджено 7 (≈ 6 хв, ≈ 147 тис. токенів): плитки під вікном, вікно після виходу з бою, e2e до банера, `hidden`, граматика рядка, підсумок поломок, прогалини тестів — виправлено латками планувальника. Mistral Large (той самий коміт) — 2 / 2: підсумок поломок, «AP −2» у критеріях.
    - Код і тести — Mistral Vibe Code латками плану; час від запуску до PR — ≈ 25 хв за годинником планувальника.
    - Звіт — `docs/reports/t71-evac-button.md`
```

<!-- блок: pr-body-v2 -->
```text
### Що змінено і чому

Евакуація з місії є в ядрі (ADR-0075, `evacuate`), але зі сторінки була недосяжна. Тепер у тулбарі бою є плитка «Евакуація» (2 AP, клавіша V): оперативник на синій клітинці висадки покидає бій. Не на клітинці чи без AP — плитка неактивна з причиною «не на висадці» / «мало AP», причина — і рядком `#binfo`. Останнього живого оперативника на полі гра евакуює лише після вікна «Евакуювати останнього?»: бій тоді закінчиться результатом «евакуйовано» без премії. Під вікном клавіші й плитки не діють, вікно закривається разом із боєм. Ядро без змін; звуку, разової підказки і евакуації бота авто-бою в кроці немає.

### Критерії приймання

- Оперативник на синій клітинці висадки з ≥ 2 AP — плитка «Евакуація» чи клавіша V знімає його з поля, у `#binfo` — «Евакуйовано: ім'я. На полі лишилось оперативників: N.».
- Не на клітинці висадки чи < 2 AP — плитка неактивна з причиною на ній і в підказці; клавіша V дає причину в `#binfo` і нікого не знімає.
- Останній живий оперативник на полі — лише після «Евакуювати» у вікні; «Скасувати» лишає його на полі, бій триває; під вікном клавіші і плитки бою не діють; «Евакуювати» ще раз перевіряє клітинку, AP і авто-бій.
- Вихід із бою закриває вікно; під авто-боєм клавіша V нічого не робить.
- Сценарій e2e «Т.71» доходить до банера «ЗАГІН ЕВАКУЙОВАНО».

### Відповідь власника (18.11.2026)

Питання: «Т.70 змержено о 14:43 (PR #372, тег iter-T.70), але документ стану в проєкті ще «після Т.69», і Т.71 там не обрано. Що робимо як Т.71?». Відповідь: «Кандидат 76: евакуація».

Питання: «Т.71 = евакуація в бою (план П15.4). Ядро готове: 2 ОД, солдат у синій клітинці старту знімається з поля. Що входить у крок?». Відповідь: «Кнопка + V + причини (Recommended)».

Питання: «Якщо евакуйовується останній солдат на полі (бій одразу закінчується без премії, зонд лишається) — питати підтвердження?». Відповідь: «Так, вікно підтвердження (Recommended)».

Питання: «Де кнопка видна?». Відповідь: «Завжди в бою місії (Recommended)».

Питання: «Бот авто-бою евакуюється?». Відповідь: «Ні, як зараз (Recommended)».

### Перевірка

<рядки чекліста>

- <речення з summary.md> Підсумок рахує лише чотири тести модуля, що йдуть окремо (межа (ж) звіту).
- Розбіжності з таблицею плану: <розбіжності з таблицею плану>
- Рядків у підрахунку `./scripts/pr-size.sh origin/main HEAD` — <число рядків>
- `vibe-plan-check.mjs` перед пушем, рядки «Звірено» і «Знахідок» дослівно:
<рядки vibe-plan-check>

### Аудит

Аудит PR #373 (ADR-0097) на коміті `5e9fba1`: Opus, субагент з копією репозиторію — знайдено 7, підтверджено 7; Mistral Large (джоба `mistral-audit`) — знайдено 2, підтверджено 2. Усі підтверджені виправлено латками планувальника в цьому PR (два коміти після аудиту); відхилених немає. Перелік — у розділі «Аудит» звіту `docs/reports/t71-evac-button.md`.

Згадка: кандидат 76, П15.4 (ADR-0075); план — `docs/plans/t71-evac-button.md`.

Iter-Tag: iter-T.71
```
