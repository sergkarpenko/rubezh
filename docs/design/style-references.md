# Референси стилю «Рубіжу» (Фази 12/13)

**Дата:** 2026-10-18 (оновлено після демо-ітерацій лого/панелей того ж дня)
**Джерело:** скетчі власника 2026-10-18 — IMG_0141.JPG (логотип «РУБІЖ»), IMG_0140.JPG (наброски кнопок з фігурками). Стиль зафіксовано тут текстом; самі скетчі власник додає до `docs/design/references/` (через GitHub web «Add file → Upload files» або локальний клон — **Work-канал бінарні пуші не підтримує**, текстові канали ламають байти; див. урок про подвійне кодування workflow.md 2026-10-18).
**Зв'язки:** ADR-0064 (тематика Розриву), ADR-0065 (стартовий екран), ADR-0066 (тулбар), ADR-0067 (авто-бій), ADR-0068 (ассети і масштаб), ADR-0069 (розмір ассетів не обмежено).

## Два треки стилю (рішення власника 2026-10-18)

| Трек | Що вкриває | Стиль |
|------|------------|-------|
| Ігровий шар | тайли, юніти, іконки тулбара, бойові ефекти | плоский піксель-арт, обмежена палітра 5–7 кольорів (статус-кво ADR-0031) |
| Оформлення/брендинг | лого, стартовий екран, рамки панелей і вікон | багатий 3D: градієнти, об'ємне neon-сяйво, матеріали (хром/скло), cinematic lighting, висока деталізація (стиль генерації типу Gemini Nano Banana) |

Палітра спільна для обох треків (таблиця нижче) — треки відрізняються складністю шейдінгу, а не кольорами. Робочий поділ (рішення власника 2026-10-18): фінальні ассети оформлення генерує **Vibe Work** (власнику сподобався 3D-стиль демо, варіанти прийняті як робочі); Gemini/Nano Banana — опційна альтернатива, якщо знадобиться вища деталізація. Vibe Code генерації зображень не має (це можливість Work); роль Vibe Code — прийняти PNG у `assets/` і закомітити бінарні байти локально (Work-канал бінарні пуші не підтримує).

## Обрані варіанти (рішення власника 2026-10-18)

| Ассет | Варіант | Використання |
|-------|---------|---------------|
| `assets/logo.png` | «Лого 3D з текстом» (промпт 1) | велике лого: стартовий екран, великий розмір — там 3D-деталі і кирилиця читаються. Обов'язкова перевірка кожної літери «РУБІЖ» перед комітом |
| `assets/logo-emblem.png` | «3D-емблема» (промпт 2) | мала форма лого: кути панелей, заголовки, навігація. Масштабується вниз добре (текст у малому розмірі не читається — тому емблема без тексту). Кандидат на favicon — тест читабельності в 32×32 у прев'ю; якщо «блюриться», favicon лишається плоским (промпт 5) |
| `assets/panel-frame.png` | «Рамка панелі» (промпт 4) | рамки вікон/панелей, компонування 9-slice у коді поверх кодового фону |

Демо-зображення цих трьох варіантів власник зберігає з чату Work-сесії і завантажує в репо (робочий цикл нижче); за потреби — перегенерація фінальних версій у Work-сесії за тими ж промптами.

## Палітра (орієнтовні значення з аналізу скетчів; точні значення підбирає П12.7/П13.5 через прев'ю)

| Роль | Орієнтовний HEX |
|------|-----------------|
| Фон (синьо-чорний) | `#14141E` … `#0A0A12` |
| Неоновий блакитний («Рубіж»/гравець) | `#00E5FF` |
| Неоновий рожевий/пурпур (Розрив/акценти) | `#FF2E88` |
| Фіолетовий (глітч-акценти) | `#8A2BE2` |
| Текст/деталі | білий `#FFFFFF`, чорний `#0A0A12` |

## Геометрія (зі скетчу кнопок; ігровий трек)

- Квадратні кнопки з заокругленими кутами; темно-сірий фон кнопок.
- Яскраві неонові акцентні лінії (блакитний + рожевий), білий текст/підписи.
- Фігури — піксельні силуети, центровані, обмежена палітра (5–7 кольорів).
- Логотип: центральний текст «РУБІЖ» футуристичним кутним шрифтом, світлові лінії, технічні деталі, електронні схеми на темному тлі.

## Інструкції для Vibe Code

**П13.2 — іконки тулбара (ADR-0066).** Малюються як піксель-арт матриці кодом (ADR-0031; механізм без змін) у стилі скетчу: темно-сірі квадратні плитки з неоновими акцентами, білі силуети фігурок. Перелік іконок — за чинними діями бою (`src/ui/battle.ts`) плюс нові «Авто»/«Стоп» (ADR-0067). Стиль — за цим документом (ігровий трек); ітеративно узгоджується через прев'ю гілок (ADR-0060) з власником.

**П13.4 — лого стартового екрана (ADR-0065/0068/0071).** Файл `assets/logo.webp` (джерело — генерація власника; див. промпти нижче, трек оформлення; формат за доцільністю — ADR-0071). Інтеграція: ліниве завантаження, при недоступності ассета (headless/офлайн) — текстовий логотип кодом (фолбек обов'язковий: тести від ассета не залежать). Розмір ассетів не обмежено (ADR-0069), але фото-подібні рендери за замовчуванням оптимізуються на кроці інтеграції (розмір під щільність відображення, WebP — ADR-0071): лого стартового екрана — 840×630 (2× від 420 CSS-px), ~82 КБ.

**П13.5 — рамки панелей і вікон (ADR-0065/0068).** Стиль оформлення — багатий 3D, але компонування кодове (див. інструкцію нижче). Фолбек без ассета — рамка кодом, тести від ассета не залежать.

**Бінарні файли в репо:** тільки через git (локальний клон Vibe Code) або GitHub web. Коміт ассетів — разом з відповідним кроком (П13.4/П13.5); exact-байти бінарних файлів — за git blob-hash (скрипт `scripts/verify-exact-bytes.sh`).

## Оформлення: рамки панелей і вікон (важлива інструкція)

Панелі/вікна НЕ генерувати як повні зображення-фон: текст «пливе» при скейлі, читається гірше, а розмір файлу зростає. Замість цього:
1. Генерувати РАМКУ — орнаментальні кути + краї, PNG з прозорим тлом і прозорою серцевиною.
2. Компонувати в коді як 9-slice поверх кодового фону (градієнт/напівпрозорість кодом; механізм шару відображення без змін).
3. Фолбек: відсутній ассет → рамка кодом, тести від ассета не залежать.

## Ассети оформлення: робочий цикл

1. **Генерація — у Work-сесії** (генератор Vibe Work, моделі Black Forest Labs) за промптами нижче. Обмеження: денні ліміти генерації залежать від плану; кирилиця — головний ризик, перевіряти кожну літеру «РУБІЖ».
2. **Вибір і збереження:** власник обирає варіант у чаті і зберігає PNG локально (Work не пушить бінарні байти в репо).
3. **Завантаження в репо:** GitHub web («Add file → Upload files») або локальний клон через Vibe Code (git-коміт бінарного файла). За бажанням власник може згенерувати варіант у Gemini за тими ж промптами — цикл той самий.
4. **Валідація:** прев'ю гілки (ADR-0060) у кроці П13.4/П13.5 до мержу (ADR-0068). Якщо генератор віддасть рамку з непрозорим тлом — зачистка/хромакей кодом на етапі інтеграції (Vibe Code).

**Файли-ассети:**

| Файл | Що це | Трек | Куди покласти |
|------|-------|------|---------------|
| `logo.webp` | Логотип «РУБІЖ» (багатий 3D, варіант з текстом) | оформлення | `assets/logo.webp` |
| `logo-emblem.png` | Емблема без тексту (фолбек/альтернатива) | оформлення | `assets/logo-emblem.png` |
| `start-bg.png` (опційно) | Фон стартового екрана | оформлення | `assets/start-bg.png` |
| `panel-frame.png` (опційно) | Рамка панелі/вікна, прозоре тло і серцевина | оформлення | `assets/panel-frame.png` |
| `favicon.png` (опційно) | Іконка вкладки браузера 512×512 | ігровий (плоский, читається в 32×32) | `assets/favicon.png` |

Вимоги до кожного: формат за доцільністю — WebP для фото-подібних 3D-рендерів, PNG для плоских/палітрових, JPEG без прозорості (ADR-0071); прозоре тло де зазначено (інакше темний фон); розмір не обмежено (ADR-0069), фото-подібні — оптимізувати на кроці інтеграції (ADR-0071); генерувати в 1024–2048 px; без водяних знаків; перевірити кожну кириличну літеру у «РУБІЖ» (генератори часто ламають кирилицю — якщо літери спотворені, використати варіант без тексту і накласти слово кодом шрифтом).

## Промпти генерації (англійською — так надійніше)

**1. Лого з текстом (оформлення, багатий 3D):**
Premium 3D game logo for a cyberpunk tactical strategy game. The Ukrainian word «РУБІЖ» in bold futuristic angular Cyrillic capital letters, polished chrome-metal letters with neon cyan (#00E5FF) and magenta (#FF2E88) volumetric glow, electric energy arcs, cracks of rift energy, faint circuit-board traces on a dark blue-black background (#14141E), cinematic lighting, depth of field, high detail, centered composition, no additional text, no watermark, no English letters. The text must read exactly «РУБІЖ» — every Cyrillic letter must be correct.

**2. Емблема без тексту (оформлення, багатий 3D):**
3D emblem badge for a cyberpunk tactical game: an angular shield in dark gunmetal with a glowing rift crack of neon cyan and magenta energy splitting it, volumetric neon glow, chrome and glass materials, thin etched circuit traces, floating energy particles, dark blue-black background (#14141E), cinematic lighting, high detail, centered, no text, no watermark.

**3. Фон стартового екрана (опційно, оформлення):**
Immersive cyberpunk background for a game title screen: deep blue-black space (#0A0A12), a huge glowing rift tear of neon cyan and magenta energy in the sky, distant futuristic city skyline silhouette with volumetric neon lights, faint holographic circuit grid on the ground, atmospheric haze, cinematic lighting, very dark and low contrast in the lower half (for UI readability), no text, no characters, no watermark.

**4. Рамка панелі (опційно, оформлення):**
Sci-fi UI panel frame ornament, 3D beveled metal edges with neon cyan (#00E5FF) edge lighting and subtle magenta (#FF2E88) accents, ornate cyberpunk corner details, circuit-line etching, on a fully transparent background — the frame is an empty border ornament, the inside and outside are transparent, high detail, no text, no watermark.

**5. Favicon (опційно, ігровий трек — плоский для читабельності в 32×32):**
Simple game favicon: angular dark shield with a neon cyan rift crack, flat vector style, minimal, readable at 32×32 pixels, no text.

## Фаза 14 — ігровий шар: промпти генерації (ADR-0072, П14.1)

**Формат спрайт-атласів:** прозоре тло, PNG; кадр ≥ 96×96 (≥ 3× від чинного 32px — читабельність після nearest-neighbor масштабування); сітка атласу рівна, без проміжків між кадрами; малювання — nearest-neighbor. Робочий цикл — той самий, що й для ассетів оформлення (вище): генерація у Work-сесії → вибір власника → бінарний коміт Vibe Code → прев’ю гілки ДО мержу (ADR-0060). Числа П14.2 (узгоджено сесією планування 2026-10-19): кадр 96×96; атлас 2×5 кадрів = 480×192; порядок кадрів у кожному ряду idle → walk1 → walk2 → fire → death (ряд 1 — оперативник, ряд 2 — демон Розриву); відображення 32×32 у BCELL 36 (nearest-neighbor ÷3); файл `assets/units-atlas.png`. Числа П14.3 (узгоджено Work-сесією 2026-10-19, ДО генерації — урок iter-13.5): клітинка BCELL 48 (канва бойовища 960×960, CSS-кап #battle 960px — 1:1 при контейнері 960); юніт 44×44 у клітинці 48 (масштаб кадру 96→44 спільний для всіх кадрів, nearest-neighbor); тайтли терену малюються під клітинку 48 (16×16 @3× або 24×24 @2×); орієнтація юнітів — фліп кодом у шарі відображення (дзеркальні ряди в атласі НЕ потрібні); юніт-атлас оновлюється кадром walk2 (5 різних кадрів на ряд). Дизайн-вимога контрасту (фідбек П14.2): тайли підлоги — темні й ненасичені, без яскравих локальних плям; неонове свічення юнітів — найяскравіший акцент клітинки.

**6. Атлас юнітів бою (ігровий трек, плоский піксель-арт):**
Sprite sheet, flat pixel art, two rows of five frames each on a fully transparent background. Row 1: a hooded human operative with a glowing neon cyan (#00E5FF) visor and a white plasma rifle — frames: idle stance, two-frame walk cycle (left foot, right foot), firing pose with muzzle flash, death collapse. Row 2: a purple (#A32EFF) rift demon with glowing pink (#FFD9F2) energy cracks and magenta (#FF2E88) blade arms — the same five frames: idle, two-frame walk cycle, attack pose with energy flash, death dissolve. Consistent scale and perspective across all frames, top-down three-quarter view, limited palette, crisp pixel edges, grid-aligned frames, no text, no watermark.

ПРИМІТКА (П14.3, урок П14.2): у наступній генерації атлас юнітів — 5 РІЗНИХ кадрів на ряд (двокадрова ходьба: крок лівою/правою ногою — окремі пози); при конвертації звіряти 5 кластерів кадрів на ряд — генератор може дати один кадр ходьби всупереч власному промпту.

**7. Тайли терену бою (ігровий трек):**
Tileset for a top-down tactical grid, flat pixel art on a dark floor: four variants of dark techno-floor tiles with subtle circuit traces, one wall block with neon cyan (#00E5FF) edge highlights, and three small decor sprites (rubble, cracked pipe, glowing vent). Seamless tileable edges, consistent lighting, limited palette matching the game units, crisp pixel edges, very dark desaturated floor with no bright local highlights — the neon glow of game units must remain the brightest element in any cell, no text, no watermark.

**8. Тайли геосцени (ігровий трек):**
Tileset for a top-down tactical world map, flat pixel art: a dark ocean tile (#0A0A12) with subtle wave pixels, land plate tiles with angular continent plates, a coastline tile with neon cyan (#00E5FF) glow, small amber (#FFB347) city lights dots, and a radar tower sprite with a cyan blinking beacon. Seamless tiling, limited palette, crisp pixel edges, no text, no watermark.

**Примітка (П14.7).** Фон стартового екрана — два кандидати: генерація за промптом 3 (вище, трек оформлення) або суцільний неон кодом; вибір — за прев’ю разом із композицією редизайну.
