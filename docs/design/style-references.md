# Референси стилю «Рубіжу» (Фази 12/13)

**Дата:** 2026-10-18
**Джерело:** скетчі власника 2026-10-18 — IMG_0141.JPG (логотип «РУБІЖ»), IMG_0140.JPG (наброски кнопок з фігурками). Стиль зафіксовано тут текстом; самі скетчі власник додає до `docs/design/references/` (через GitHub web «Add file → Upload files» або локальний клон — **Work-канал бінарні пуші не підтримує**, текстові канали ламають байти; див. урок про подвійне кодування workflow.md 2026-10-18).
**Зв'язки:** ADR-0064 (тематика Розриву), ADR-0065 (стартовий екран), ADR-0066 (тулбар), ADR-0067 (авто-бій), ADR-0068 (ассети і масштаб).

## Палітра (орієнтовні значення з аналізу скетчів; точні значення підбирує П12.7/П13.5 через прев'ю)

| Роль | Орієнтовний HEX |
|------|-----------------|
| Фон (синьо-чорний) | `#14141E` … `#0A0A12` |
| Неоновий блакитний («Рубіж»/гравець) | `#00E5FF` |
| Неоновий рожевий/пурпур (Розрив/акценти) | `#FF2E88` |
| Фіолетовий (глітч-акценти) | `#8A2BE2` |
| Текст/деталі | білий `#FFFFFF`, чорний `#0A0A12` |

## Геометрія (зі скетчу кнопок)

- Квадратні кнопки з заокругленими кутами; темно-сірий фон кнопок.
- Яскраві неонові акцентні лінії (блакитний + рожевий), білий текст/підписи.
- Фігури — піксельні силуети, центровані, обмежена палітра (5–7 кольорів).
- Логотип: центральний текст «РУБІЖ» футуристичним кутним шрифтом, світлові лінії, технічні деталі, електронні схеми на темному тлі.

## Інструкції для Vibe Code

**П13.2 — іконки тулбара (ADR-0066).** Малюються як піксель-арт матриці кодом (ADR-0031; механізм без змін) у стилі скетчу: темно-сірі квадратні плитки з неоновими акцентами, білі силуети фігурок. Перелік іконок — за чинними діями бою (`src/ui/battle.ts`) плюс нові «Авто»/«Стоп» (ADR-0067). Стиль — за цим документом; ітеративно узгоджується через прев'ю гілок (ADR-0060) з власником.

**П13.4 — лого стартового екрана (ADR-0065/0068).** Файл `assets/logo.png` (додає власник; див. промпти нижче). Інтеграція: ліниве завантаження, при недоступності ассета (headless/офлайн) — текстовий логотип кодом (фолбек обов'язковий: тести від ассета не залежать). Сумарний ліміт ассетів ≤ 500 КБ (ADR-0068).

**Бінарні файли в репо:** тільки через git (локальний клон Vibe Code) або GitHub web. Коміт ассетів — разом з відповідним кроком (П13.4/П13.5); exact-байти бінарних файлів — за git blob-hash (скрипт `scripts/verify-exact-bytes.sh`).

## Що генерує власник (Gemini або іншим генератором)

| Файл | Що це | Куди покласти |
|------|-------|---------------|
| `logo.png` | Логотип «РУБІЖ» (варіант з текстом або емблема) | `assets/logo.png` |
| `logo-emblem.png` | Емблема без тексту (фолбек/альтернатива) | `assets/logo-emblem.png` |
| `start-bg.png` (опційно) | Фон стартового екрана | `assets/start-bg.png` |
| `favicon.png` (опційно) | Іконка вкладки браузера 512×512 | `assets/favicon.png` |

Вимоги до кожного: PNG; темний фон (прозорий — якщо генератор підтримує); обмежена палітра з таблиці вище; сумарно ≤ 500 КБ (якщо більше — згенерувати меншим розміром або стиснути); без водяних знаків; перевірити кожну кириличну літеру у «РУБІЖ» (генератори часто ламають кирилицю — якщо літери спотворені, використати промпт «без тексту» і накласти слово кодом шрифтом).

## Промпти генерації (англійською — генератори так надійніші)

**1. Лого з текстом:**
Logo for a cyberpunk tactical strategy video game. The Ukrainian word «РУБІЖ» in bold futuristic angular Cyrillic capital letters with neon cyan glow (#00E5FF) and magenta accents (#FF2E88), on a dark blue-black background (#14141E) with faint circuit-board traces and thin light lines. Clean flat vector style, high contrast, centered composition, no additional text, no watermark, no English letters. The text must read exactly «РУБІЖ» — every Cyrillic letter must be correct.

**2. Лого-емблема без тексту:**
Angular shield emblem for a cyberpunk tactical game: a glowing rift crack of neon cyan and magenta light splitting the shield, thin circuit traces, dark blue-black palette (#14141E) with neon accents (#00E5FF, #FF2E88). Flat vector logo style, minimal, centered, no text, no watermark.

**3. Фон стартового екрана (опційно):**
Dark cyberpunk background for a game menu screen: deep blue-black (#0A0A12) with faint neon circuit-board traces, subtle hexagonal grid, distant city skyline silhouette with dim neon cyan and magenta lights. Very dark, low contrast, flat vector style, no text, no characters, no watermark.

**4. Favicon (опційно):**
Simple game favicon: angular dark shield with a neon cyan rift crack, flat vector, minimal, readable at 32×32 pixels, no text.

Після генерації: власник обирає варіант → зберігає PNG у `assets/` (GitHub web або через Vibe Code) → валідація через прев'ю гілки (ADR-0060) у кроці П13.4 до мержу (ADR-0068).
