# ADR-0038: Розділення core/UI для render.ts та bot.ts

**Статус:** accepted  
**Дата:** 2026-10-15  
**Автор:** Vibe Code  
**Заміняє:** -  
**Суперечить:** -  

---

## Контекст

Файли `src/render.ts` (911 рядків) та `src/bot.ts` (322 рядки) містять як чисту логіку (core), так і UI-специфічний код. Це порушує:
- **ADR-0002:** "Чисте ядро без DOM" — `src/core/` не повинен містити DOM/Canvas залежностей
- **ADR-0036:** Обмеження розміру файлів до 500 рядків

Поточний стан:
- `render.ts`: 911 рядків (малювання, анімація, логіка бою)
- `bot.ts`: 322 рядки (AI-бот, логіка прийняття рішень, UI-інтеграція)

---

## Рішення

### Для `render.ts`

Розділити на два файли:

#### 1. `src/core/render-core.ts` (≤400 рядків)
**Відповідальність:**
- Чиста логіка малювання (без Canvas API)
- Обчислення позицій та розмірів
- Логіка анімації (тимчасові змінні, стан анімації)
- Генерація спрайтів (масиви пікселів)

**Експорт:**
```typescript
export interface Sprite { width: number; height: number; pixels: Uint8ClampedArray }
export interface AnimationFrame { sprite: Sprite; offsetX: number; offsetY: number }
export interface RenderState { /* ... */ }

export function createSprite(width: number, height: number): Sprite
export function calculateSpritePosition(unit: Unit, x: number, y: number): { x: number; y: number }
export function getAnimationFrame(animation: Animation, tick: number): AnimationFrame
export function createRenderState(): RenderState
export function updateRenderState(state: RenderState, gameState: GameState): RenderState
```

**Залежності:**
- `src/core/geo.ts` (позиції одиниць)
- `src/core/squad.ts` (стан одиниць)
- `src/core/combat.ts` (стан бою)

#### 2. `src/render.ts` (≤400 рядків)
**Відповідальність:**
- Взаємодія з Canvas API
- Малювання спрайтів на екран
- Керування контекстом малювання

**Експорт:**
```typescript
export function drawSprite(ctx: CanvasRenderingContext2D, sprite: Sprite, x: number, y: number): void
export function drawUnit(ctx: CanvasRenderingContext2D, unit: Unit, state: RenderState): void
export function drawBattle(ctx: CanvasRenderingContext2D, state: RenderState): void
export function drawGeo(ctx: CanvasRenderingContext2D, state: RenderState): void
```

**Залежності:**
- `src/core/render-core.ts` (логіка малювання)
- `src/core/*` (стан гри)

### Для `bot.ts`

Розділити на два файли:

#### 1. `src/core/ai-bot.ts` (≤300 рядків)
**Відповідальність:**
- Чиста логіка AI (без DOM/Canvas)
- Прийняття рішень бота
- Обчислення оптимальних дій

**Експорт:**
```typescript
export interface BotDecision { action: BotAction; target?: Unit; coordinates?: Coordinates }
export interface BotState { /* ... */ }

export function createBotState(game: GameState): BotState
export function makeBotDecision(state: BotState, game: GameState): BotDecision
export function executeBotAction(decision: BotDecision, game: GameState): GameState
```

**Залежності:**
- `src/core/geo.ts`
- `src/core/squad.ts`
- `src/core/combat.ts`
- `src/core/economy.ts`

#### 2. `src/bot.ts` (≤200 рядків)
**Відповідальність:**
- Інтеграція з UI
- Керування станом бота в грі
- Синхронізація з ігровим циклом

**Експорт:**
```typescript
export function setupBot(game: GameState): void
export function tickBot(game: GameState): void
export function renderBotUI(ctx: CanvasRenderingContext2D, state: BotState): void
```

**Залежності:**
- `src/core/ai-bot.ts` (чиста логіка)
- `src/core/*` (стан гри)

---

## Наслідки

### Переваги

1. **Дотримання ADR-0002:** Вся логіка в `src/core/`, UI-код в `src/*.ts`
2. **Дотримання ADR-0036:** Кожен файл ≤500 рядків
3. **Краща тестованість:** Core-логіку можна тестувати без Canvas
4. **Краща перевикористовуваність:** Core-модулі можна використовувати в інших контекстах
5. **Чіткіше розділення:** Логіка та відображення розділені

### Недоліки

1. **Збільшення кількості файлів:** З 2 до 4 файлів
2. **Потреба в рефакторингу:** Иснуючий код потрібно переробляти
3. **Складність синхронізації:** Потрібно чітко визначати інтерфейси між core та UI

### Ризики

1. **Порушення ADR-0002:** Якщо в core залишаться DOM-залежності
2. **Регресії:** Зміни можуть порушити існуючу логіку
3. **Продуктивність:** Додаткові виклики функцій між модулями

---

## Альтернативи

### Альтернатива 1: Часткове розділення

Розділити тільки найбільш проблемні частини:
- Винести логіку анімації з `render.ts` в `core/animation.ts`
- Винести логіку прийняття рішень з `bot.ts` в `core/ai-decision.ts`

**Плюси:** Меньше змін, швидше виконання
**Мінуси:** Не повне вирішення проблеми

### Альтернатива 2: Використання класового підходу

Створити класи для core-логіки:
- `RenderEngine` (в `src/core/`)
- `AIBot` (в `src/core/`)

**Плюси:** Краща інкапсуляція
**Мінуси:** Додаткова складність, можливі проблеми з серіалізацією

### Альтернатива 3: Винесення в окремі папки без розділення

Просто перемістити файли:
- `src/render.ts` → `src/ui/render.ts`
- `src/bot.ts` → `src/ui/bot.ts`

**Плюси:** Мінімальні зміни
**Мінуси:** Не вирішує проблему великого розміру та змішування логіки

---

## Реалізація

### Крок 1: Створення нової структури
```bash
mkdir -p src/core
# Файли вже існують, потрібно лише розділити
```

### Крок 2: Розділення `render.ts`

1. **Аналіз поточного коду:**
   - Виділити чисту логіку (обчислення, стан)
   - Виділити UI-специфічний код (Canvas API)

2. **Створення `core/render-core.ts`:**
   - Перенести функції обчислення позицій
   - Перенести логіку анімації
   - Перенести генерацію спрайтів

3. **Оновлення `render.ts`:**
   - Залишити тільки функції малювання
   - Імпортувати логіку з `core/render-core.ts`

### Крок 3: Розділення `bot.ts`

1. **Аналіз поточного коду:**
   - Виділити чисту AI-логіку
   - Виділити UI-інтеграцію

2. **Створення `core/ai-bot.ts`:**
   - Перенести функції прийняття рішень
   - Перенести логіку обчислення дій

3. **Оновлення `bot.ts`:**
   - Залишити тільки інтеграцію з UI
   - Імпортувати логіку з `core/ai-bot.ts`

### Крок 4: Тестування

- Перевірити, що всі тести проходять (325 тестів)
- Перевірити візуальну роботу гри
- Перевірити роботу бота

### Крок 5: Документування

- Оновити `AGENTS.md` з новою структурою
- Оновити TypeDoc документацію

---

## Вимоги до тестів

Згідно ADR-0017:
- `src/core/render-core.ts`: ≥80% покриття
- `src/core/ai-bot.ts`: ≥80% покриття

---

## Вимоги до комітів

```bash
refactor(core): extract render logic to core/render-core.ts
refactor(core): extract AI logic to core/ai-bot.ts
refactor(ui): update render.ts to use core/render-core.ts
refactor(ui): update bot.ts to use core/ai-bot.ts
```

---

## Залежності

- **ADR-0002:** Чистий core без DOM (всі нові core-модулі не повинні імпортувати DOM/Canvas)
- **ADR-0003:** Детерміністичний RNG (використовувати існуючу логіку)
- **ADR-0017:** Покриття коду ≥80%
- **ADR-0036:** Розмір файлів ≤500 рядків
