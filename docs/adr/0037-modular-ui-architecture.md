# ADR-0037: Модульна архітектура UI

**Статус:** Proposed  
**Дата:** 2026-10-15  
**Автор:** Vibe Code  
**Заміняє:** -  
**Суперечить:** -  

---

## Контекст

На даний момент файл `src/main.ts` містить 1500 рядків коду, що порушує ADR-0036 (обмеження розміру PR до 500 рядків). Файл поєднує в собі:
- Логіку ініціалізації Canvas
- Обробку подій користувача (клавіатура, миша)
- Логіку стану гри
- Вісновок UI на екран
- Логіку оновлення екрану

Така архітектура ускладнює:
- Тестування (ADR-0017 вимагає 80% покриття для core)
- Підтримку та розвиток
- Рев'ю коду (ADR-0023: EARS-критерії)
- Дотримання ADR-0002 (чистий core без DOM)

---

## Рішення

Розділити `src/main.ts` на наступні модулі:

### 1. `src/ui/canvas-setup.ts` (≤300 рядків)
**Відповідальність:**
- Ініціалізація Canvas елемента
- Налаштування контексту малювання
- Керування розмірами полотна

**Експорт:**
```typescript
export function setupCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }
export function resizeCanvas(canvas: HTMLCanvasElement): void
```

### 2. `src/ui/event-handlers.ts` (≤300 рядків)
**Відповідальність:**
- Обробка подій клавіатури
- Обробка подій миші
- Диспетчеризація подій до ігрової логіки

**Експорт:**
```typescript
export function setupKeyboardHandlers(game: GameState): void
export function setupMouseHandlers(canvas: HTMLCanvasElement, game: GameState): void
```

### 3. `src/ui/game-loop.ts` (≤200 рядків)
**Відповідальність:**
- Основний ігровий цикл (requestAnimationFrame)
- Оновлення стану гри
- Вісновок кадрів

**Експорт:**
```typescript
export function startGameLoop(game: GameState, render: RenderFunction): void
export function stopGameLoop(): void
```

### 4. `src/ui/state-manager.ts` (≤200 рядків)
**Відповідальність:**
- Керування станом UI
- Збереження/відновлення стану
- Синхронізація з core-логікою

**Експорт:**
```typescript
export interface UIState { /* ... */ }
export function createUIState(): UIState
export function updateUIState(state: UIState, gameState: GameState): UIState
```

### 5. `src/main.ts` (≤100 рядків)
**Відповідальність:**
- Точка входу додатку
- Ініціалізація всіх модулів
- Зв'язування модулів між собою

**Зміст:**
```typescript
import { setupCanvas } from './ui/canvas-setup';
import { setupKeyboardHandlers, setupMouseHandlers } from './ui/event-handlers';
import { startGameLoop } from './ui/game-loop';
import { createUIState } from './ui/state-manager';
import { createGame } from './core/game';

const { canvas, ctx } = setupCanvas();
const game = createGame();
const uiState = createUIState();

setupKeyboardHandlers(game);
setupMouseHandlers(canvas, game);
startGameLoop(game, render);
```

---

## Наслідки

### Переваги
1. **Дотримання ADR-0036:** Кожен файл буде ≤500 рядків
2. **Краща тестованість:** Модулі можна тестувати ізольовано
3. **Зручніше рев'ю:** Меньші файли простіше аналізувати
4. **Краща підтримка:** Чітке розділення відповідальності
5. **Легше рефакторити:** Модулі можна змінювати незалежно

### Недоліки
1. **Збільшення кількості файлів:** З 1 до 5 файлів
2. **Потреба в рефакторингу:** Иснуючий код потрібно переробляти
3. **Залежності між модулями:** Потрібно чітко визначати інтерфейси

### Ризики
1. **Циклічні залежності:** Потрібно уникати кругових імпортів
2. **Регресії:** Зміни можуть порушити існуючу логіку
3. **Продуктивність:** Завантаження багатьох модулів може уповільнити збірку

---

## Альтернативи

### Альтернатива 1: Злиття в менше модулів
Розділити на 2-3 файли замість 5:
- `src/ui/setup.ts` (canvas + events)
- `src/ui/loop.ts` (game loop + rendering)
- `src/main.ts` (entry point)

**Плюси:** Меньше файлів, простіше керування
**Мінуси:** Все ще великі файли, менш чітке розділення

### Альтернатива 2: Використання класового підходу
Створити класи для кожного компонента:
- `CanvasManager`
- `InputHandler`
- `GameLoop`
- `UIStateManager`

**Плюси:** Краща інкапсуляція, зрозуміліший API
**Мінуси:** Додаткова складність, можливі проблеми з тестуванням

### Альтернатива 3: Винесення в окрему папку без розділення
Просто перемістити `main.ts` в `src/ui/main.ts` без розділення.

**Плюси:** Мінімальні зміни, швидке виконання
**Мінуси:** Не вирішує проблему великого файлу

---

## Реалізація

### Крок 1: Створення нової структури
```bash
mkdir -p src/ui
touch src/ui/canvas-setup.ts
touch src/ui/event-handlers.ts
touch src/ui/game-loop.ts
touch src/ui/state-manager.ts
```

### Крок 2: Поступове перенесення коду
1. Перенести логіку ініціалізації Canvas в `canvas-setup.ts`
2. Перенести обробку подій в `event-handlers.ts`
3. Перенести ігровий цикл в `game-loop.ts`
4. Перенести керування станом в `state-manager.ts`
5. Залишити в `main.ts` тільки точку входу

### Крок 3: Тестування
- Перевірити, що всі тести проходять
- Перевірити візуальну роботу гри
- Перевірити обробку подій

### Крок 4: Документування
- Оновити `AGENTS.md` з новою структурою
- Оновити документацію TypeDoc

---

## Вимоги до тестів

Згідно ADR-0017 (покриття коду):
- `src/ui/canvas-setup.ts`: ≥80% покриття
- `src/ui/event-handlers.ts`: ≥80% покриття
- `src/ui/game-loop.ts`: ≥80% покриття
- `src/ui/state-manager.ts`: ≥80% покриття

---

## Вимоги до комітів

Кожен етап рефакторингу повинен бути в окремому коміті:
```bash
refactor(ui): extract canvas setup to ui/canvas-setup.ts
refactor(ui): extract event handlers to ui/event-handlers.ts
refactor(ui): extract game loop to ui/game-loop.ts
refactor(ui): extract state manager to ui/state-manager.ts
```

---

## Залежності

- **ADR-0002:** Чистий core без DOM (всі UI модулі можуть імпортувати core, але не навпаки)
- **ADR-0010:** Цільовий UI на vanilla TS + Canvas (використовувати ті ж технології)
- **ADR-0017:** Покриття коду ≥80% (для нових модулів)
- **ADR-0036:** Розмір файлів ≤500 рядків
