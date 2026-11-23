# Референси стилю «Рубіжу» (Фази 12/13)

**Дата:** 2026-10-18 (оновлено після демо-ітерацій лого/панелей того ж дня)
**Джерело:** скетчі власника 2026-10-18 — IMG_0141.JPG (логотип «РУБІЖ»), IMG_0140.JPG (наброски кнопок з фігурками). Стиль зафіксовано тут текстом; самі скетчі власник додає до `docs/design/references/` (через GitHub web «Add file → Upload files» або локальний клон — **Work-канал бінарні пуші не підтримує**, текстові канали ламають байти; див. урок про подвійне кодування workflow.md 2026-10-18).
**Зв'язки:** ADR-0064 (тематика Розриву), ADR-0065 (стартовий екран), ADR-0066 (тулбар), ADR-0067 (авто-бій), ADR-0068 (ассети і масштаб), ADR-0069 (розмір ассетів не обмежено).

## Два треки стилю (рішення власника 2026-10-18)

| Трек | Що вкриває | Стиль |
|------|------------|-------|
| Ігровий шар | тайли, юніти, іконки тулбара, бойові ефекти | плоский піксель-арт, обмежена палітра 5–7 кольорів (статус-кво ADR-0031); іконки кнопок з Т.123 — вектор (ADR-0114, рішення власника 22.11.2026) |
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

- Квадратні кнопки з заокругленими кутами; темно-сірий фон кнопок. [З Т.124 вигляд кнопок, плиток, вкладок і панелей — ADR-0115: об'ємні кнопки, скло, бурштинова головна дія; геометрія без змін.]
- Яскраві неонові акцентні лінії (блакитний + рожевий), білий текст/підписи.
- Фігури — піксельні силуети, центровані, обмежена палітра (5–7 кольорів).
- Логотип: центральний текст «РУБІЖ» футуристичним кутним шрифтом, світлові лінії, технічні деталі, електронні схеми на темному тлі.

## Інструкції для Vibe Code

**П13.2 — іконки тулбара (ADR-0066).** [З Т.123 іконки векторні — ADR-0114, `src/ui/icons.ts`; далі — опис П13.2, що діяв до Т.123.] Малюються як піксель-арт матриці кодом (ADR-0031; механізм без змін) у стилі скетчу: темно-сірі квадратні плитки з неоновими акцентами, білі силуети фігурок. Перелік іконок — за чинними діями бою (`src/ui/battle.ts`) плюс нові «Авто»/«Стоп» (ADR-0067). Стиль — за цим документом (ігровий трек); ітеративно узгоджується через прев'ю гілок (ADR-0060) з власником.

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

**Увага (Т.133, ADR-0122):** стиль і робочий цикл спрайтів юнітів замінено — див. розділ «Т.133» у кінці файла; малювання кадру — 68 × 68 зі згладжуванням (ADR-0121). Абзац нижче — історія Фази 14; чинними лишаються розміри атласа і порядок кадрів.

**Формат спрайт-атласів:** прозоре тло, PNG; кадр ≥ 96×96 (≥ 3× від чинного 32px — читабельність після nearest-neighbor масштабування); сітка атласу рівна, без проміжків між кадрами; малювання — nearest-neighbor. Робочий цикл — той самий, що й для ассетів оформлення (вище): генерація у Work-сесії → вибір власника → бінарний коміт Vibe Code → прев’ю гілки ДО мержу (ADR-0060). Числа П14.2 (узгоджено сесією планування 2026-10-19): кадр 96×96; атлас 2×5 кадрів = 480×192; порядок кадрів у кожному ряду idle → walk1 → walk2 → fire → death (ряд 1 — оперативник, ряд 2 — демон Розриву); відображення 32×32 у BCELL 36 (nearest-neighbor ÷3); файл `assets/units-atlas.png`. Числа П14.3 (узгоджено Work-сесією 2026-10-19, ДО генерації — урок iter-13.5): клітинка BCELL 48 (канва бойовища 960×960, CSS-кап #battle 960px — 1:1 при контейнері 960); юніт 44×44 у клітинці 48 (масштаб кадру 96→44 спільний для всіх кадрів, nearest-neighbor); тайтли терену малюються під клітинку 48 (16×16 @3× або 24×24 @2×); орієнтація юнітів — фліп кодом у шарі відображення (дзеркальні ряди в атласі НЕ потрібні); юніт-атлас оновлюється кадром walk2 (5 різних кадрів на ряд). Дизайн-вимога контрасту (фідбек П14.2): тайли підлоги — темні й ненасичені, без яскравих локальних плям; неонове свічення юнітів — найяскравіший акцент клітинки.

**6. Атлас юнітів бою (ігровий трек, плоский піксель-арт):**
Sprite sheet, flat pixel art, two rows of five frames each on a fully transparent background. Row 1: a hooded human operative with a glowing neon cyan (#00E5FF) visor and a white plasma rifle — frames: idle stance, two-frame walk cycle (left foot, right foot), firing pose with muzzle flash, death collapse. Row 2: a purple (#A32EFF) rift demon with glowing pink (#FFD9F2) energy cracks and magenta (#FF2E88) blade arms — the same five frames: idle, two-frame walk cycle, attack pose with energy flash, death dissolve. Consistent scale and perspective across all frames, top-down three-quarter view, limited palette, crisp pixel edges, grid-aligned frames, no text, no watermark.

ПРИМІТКА (П14.3, урок П14.2): у наступній генерації атлас юнітів — 5 РІЗНИХ кадрів на ряд (двокадрова ходьба: крок лівою/правою ногою — окремі пози); при конвертації звіряти 5 кластерів кадрів на ряд — генератор може дати один кадр ходьби всупереч власному промпту.

**7. Тайли терену бою (ігровий трек):**
Tileset for a top-down tactical grid, flat pixel art on a dark floor: four variants of dark techno-floor tiles with subtle circuit traces, one wall block with neon cyan (#00E5FF) edge highlights, and three small decor sprites (rubble, cracked pipe, glowing vent). Seamless tileable edges, consistent lighting, limited palette matching the game units, crisp pixel edges, very dark desaturated floor with no bright local highlights — the neon glow of game units must remain the brightest element in any cell, no text, no watermark.

**8. Тайли геосцени (ігровий трек):**
Tileset for a top-down tactical world map, flat pixel art: a dark ocean tile (#0A0A12) with subtle wave pixels, land plate tiles with angular continent plates, a coastline tile with neon cyan (#00E5FF) glow, small amber (#FFB347) city lights dots, and a radar tower sprite with a cyan blinking beacon. Seamless tiling, limited palette, crisp pixel edges, no text, no watermark.

**Примітка (П14.7).** Фон стартового екрана — два кандидати: генерація за промптом 3 (вище, трек оформлення) або суцільний неон кодом; вибір — за прев’ю разом із композицією редизайну.

## Т.133 — атлас бійців «мальований»: як користуватися генераторами (ADR-0122)

Перевірено 23.11.2026 сесією Claude у Chrome власника. Числа лімітів і поведінка інтерфейсів змінюються — перед серією генерацій зробити одну пробу.

**Що вміє кожен генератор**

| | Gemini (університетський акаунт, «Створити зображення») | Vibe Work (Flux, вбудований генератор) |
| --- | --- | --- |
| Аркуш із 5 поз одним зображенням | так: один персонаж, рівний масштаб, чисте тло | ні: 4 фігури з 5, бліде зелене тло |
| Одна поза на зображення | так | так, якість добра |
| Правка попереднього зображення | в тому самому чаті відмовив («tool call limit») | так: «Edit the previous image: …» тримає персонажа, масштаб і місце |
| Формат | 16:9 слухає; файл — JPEG 1376 × 768 | просили 16:9 і 1:1 — дав 4:3 (прев'ю 800 × 600) |
| Прозоре тло | ні — хромакей | ні — хромакей |
| Ліміт | у інтерфейсі не показано | за словами власника — близько 40 генерацій на добу |

**Порядок у Gemini (спрацював тричі з трьох):** новий чат → «+» → «Створити зображення» → модель швидка («4 Hydrogen», не «Thinking») → надіслати повний промпт. Перша відповідь — текст («I cannot generate…» і «оптимізований промпт»); другим повідомленням: `Generate this image now with your image generation tool (Nano Banana), using exactly the optimized prompt above. Output the picture, not text. Aspect ratio 16:9.` — картинка за ≈ 30 с. Один чат — одне зображення: на аркуш демона — новий чат. Не клацати по плитках стилів над полем вводу (стиль чіпляється до запиту). Запит одним повідомленням («Generate an image… use the image generation tool») двічі завис на 3–4 хв і закінчився відмовою; з моделлю «Thinking» перша відповідь ішла ≈ 4 хв. У промптах нижче слова м'якші («knocked-out pose», «action pose», «energy blaster» замість «dead», «firing», «rifle») — чи впливає це на відмови, окремо не перевірено.

**Порядок у Vibe Work:** чат поза проєктом (інструкції проєкту генерації не потрібні); `Generate a NEW image (not an edit), with this prompt as is: …` — одна поза «стій»; далі в тому самому чаті `Edit the previous image: the same character with exactly the same design, colours, size and position in the image, same green background, but …` — по одній позі на правку (5 генерацій на бійця).

**Правила промпту (спільні):** одна фігура чи один ряд — без сітки з кількох рядів; `flat solid pure chroma green #00FF00`, окремо «no floor, no ground line, no shadows, no text»; «No green on the character»; явний напрямок погляду і «identical scale, feet on the same baseline»; перелік кадрів зліва направо; «holds the SAME weapon in ALL frames» (у першій пробі Gemini загубив зброю в кадрі кроку); розмір на полі («optimized for small 60px in-game display») — щоб форми були великі. Напрямок погляду генератор може проігнорувати (демона намалював праворуч) — дзеркалить конвертер.

**Кадри кроку (Т.134).** Промпт Т.133 («left leg forward» / «right leg forward») дав два майже однакові кроки (збіг масок 0,89; у демона другий крок — як «стій», 0,86): у профіль генератор малює ту саму ногу попереду. Робить різними — дві різні фази ходи: «contact» (широкий крок, ноги перевернутою V) і «passing» (опора на одну ногу, коліно другої вгору), плюс «feet together» у «стій» і окреме речення про різні силуети ніг. Промпти нижче — уже з цими фазами (збіг 0,47–0,58). Пастка: у позі «passing» Gemini загубив гармату демона — у промпті зброю названо в описі кожного кадру кроку і додано «never empty-handed»; з цим — з другої спроби. Конвертер перевіряє обидва сам: звіт `walkIoU` (збіг > 0,75 — помилка) і `weaponPx` (зброї в кадрі кроку чи вогню менше половини від «стій» — помилка). Пастка Т.134: після «Створити зображення» над полем вводу з'являються плитки стилів, і клік по місцю колишнього поля вводу чіпляє стиль (так прикріпився «М'який портрет»; на цей раз результат не зіпсував) — після вибору інструмента спершу знімок, потім клік у поле внизу.

**Промпт аркуша оперативника (Gemini):**
2D game character sprite sheet, aspect ratio 16:9: exactly 5 separate full-body poses of the exact same character in a single horizontal row, evenly spaced, wide empty gaps between figures. Character: a futuristic sci-fi operative in an armored suit, slightly stocky heroic proportions (3.5 heads tall), bold readable silhouette, large simple shapes optimized for small 60px in-game display. Matte dark gunmetal armor, a rounded hood-like helmet with a glowing neon cyan (#00E5FF) visor, small cyan indicator lights, and a sleek white sci-fi energy blaster with cyan accents. Art style: modern high-resolution 2D digital painting with crisp cel-shaded shapes, clean smooth edges, soft even lighting from the top-left, subtle cyan rim light; strictly NOT pixel art. Side view with a slight three-quarter turn, facing RIGHT in all 5 frames, identical scale, feet on the same baseline. Frames left to right: 1) idle stance, feet together, blaster held low across the body; 2) walking CONTACT pose: a long wide stride, front leg stepping far forward with the heel on the ground, back leg stretched far behind on its toes, the legs form a wide upside-down V, blaster held low across the body; 3) walking PASSING pose: standing on one straight leg directly under the body, the other knee lifted high in front up to hip height with the foot off the ground, legs NOT apart, blaster held low across the body; 4) action pose, blaster raised to the shoulder, horizontal, pointing right, short cyan energy flash at the tip; 5) knocked-out pose: lying flat on the back on the ground, head to the right, blaster lying beside him. Frames 1, 2 and 3 must have clearly different leg silhouettes. The character holds the SAME white blaster in ALL frames, including both walking frames. Background: flat solid pure chroma green #00FF00, perfectly uniform edge to edge. No floor, no ground line, no shadows under the feet or under the lying body, no gradients, no borders, no dividing lines, no text, no numbers. No green on the character.

**Промпт аркуша демона (Gemini):**
2D game character sprite sheet, aspect ratio 16:9: exactly 5 separate full-body poses of the exact same creature in a single horizontal row, evenly spaced, wide empty gaps between figures. Creature: an alien rift monster for a sci-fi tactical game, hunched and bulky, about as tall as a human, dark purple (#5A2A8A) rocky hide with jagged spikes on the back and shoulders, glowing hot magenta-pink (#FF2E88) energy cracks across the chest and a glowing pink core, two glowing pink eyes, clawed feet; it carries a long heavy dark-brown organic energy cannon gripped firmly in both hands. Bold readable silhouette, large simple shapes optimized for small 60px in-game display. Art style: modern high-resolution 2D digital painting with crisp cel-shaded shapes, clean smooth edges, soft even lighting from the top-left, subtle magenta rim light; strictly NOT pixel art. Side view with a slight three-quarter turn, facing LEFT in all 5 frames, identical scale, feet on the same baseline. Frames left to right: 1) idle stance, feet together, cannon held low in both hands pointing left; 2) walking CONTACT pose: a long wide stride, front leg stepping far forward to the left with the heel on the ground, back leg stretched far behind on its claws, the legs form a wide upside-down V, the long cannon still held low in both hands, clearly visible in front of the body; 3) walking PASSING pose: standing on one straight leg directly under the body, the other knee lifted high in front up to hip height with the clawed foot off the ground, legs NOT apart, the long dark-brown cannon still held low in both hands across the body above the raised knee, clearly visible; 4) action pose, cannon raised horizontal, pointing left, short magenta energy flash at the tip; 5) knocked-out pose: collapsed flat on the ground on its belly, head to the left, cannon lying beside it, glow dimmed. Frames 1, 2 and 3 must have clearly different leg silhouettes. IMPORTANT: the creature holds the SAME long cannon in ALL 5 frames, including BOTH walking frames — never empty-handed. Background: flat solid pure chroma green #00FF00, perfectly uniform edge to edge. No floor, no ground line, no shadows under the feet or under the lying body, no gradients, no borders, no dividing lines, no text, no numbers. No green on the creature.

**Від зображення до атласа:** «Завантажити» в Gemini (файл `Gemini_Generated_Image_*.jpeg` у теці завантажень; з Т.134 власник може й сам прикріпити файл у Gemini, якщо потрібен еталон — попросити) → `assets-src/t133-soldier-sheet.jpg`, `t133-demon-sheet.jpg` → `python3 scripts/assets/convert_units_t133.py [тека сирців]` → `assets/units-atlas.png` і звіт `scripts/assets/units-t133-report.json` (рамки кадрів, масштаб, якір дула для `MUZZLE_ANCHOR`).

## Т.135 — тайли терену «мальовані» (ADR-0123)

Аркуш тайлів — той самий порядок у Gemini, що в розділі «Т.133», але **з першого повідомлення**: «+» → «Створити зображення» → знімок → клік у поле внизу → повний промпт; картинка прийшла за ≈ 30 с без текстової відповіді. Під полем вводу тепер є перемикач «Співвідношення сторін» — не чіпали, 16:9 дав сам промпт (файл JPEG 1376 × 768). Довкола кожного об'єкта Gemini лишає квадрат темнішого зеленого — матування за «зеленістю» його знімає. Ореол світла на хромакеї просити не варто (зелений відблиск) — ореол плями світла малює конвертер. Від зображення до атласа: «Завантажити» → `assets-src/t135-terrain-sheet.jpg` → `python3 scripts/assets/convert_terrain_t135.py [тека сирців]` → `assets/metro-tiles.png` і звіт `scripts/assets/terrain-t135-report.json`.

**Промпт аркуша тайлів (Gemini):**
2D game tile sheet for a top-down sci-fi tactical game, aspect ratio 16:9: exactly 4 separate objects in a single horizontal row, evenly spaced, wide empty gaps between them, each object fits a square of the same size. Setting: a dark cyberpunk megacity street at night. Art style: modern high-resolution 2D digital painting with crisp cel-shaded shapes, clean smooth edges, soft even lighting from the top-left; strictly NOT pixel art, NOT photorealistic. Bold readable shapes optimized for small 48px in-game tiles. Muted dark palette (charcoal, dark blue-grey concrete, gunmetal) with small accents of neon cyan (#00E5FF) and warm amber (#FFB347). Objects left to right: 1) a solid square concrete barrier block, seen from above at a three-quarter top-down angle: the flat top face fills the upper three quarters of the square and the front vertical face is visible as a darker band at the bottom; a thin glowing neon cyan strip runs along the top edge; worn, scratched concrete; the block fills its whole square footprint edge to edge; 2) a small round flush floor lamp seen strictly from above: a dark metal ring with a warm amber glowing lens in the middle, flat, no light halo around it; 3) a square metal floor drain grate seen strictly from above: dark steel frame with parallel slots and a thin cyan trim line, flat; 4) a burned-out wrecked compact car seen strictly from above, dark charred body, broken windows, flat top-down view. Background: flat solid pure chroma green #00FF00, perfectly uniform edge to edge. No floor, no ground, no shadows, no glow halos, no gradients, no borders, no dividing lines, no text, no numbers. No green on the objects.
