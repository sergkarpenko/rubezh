# Скрипти конвеєра ассетів

Python-скрипти, якими агенти аналізували згенеровані сирці і збирали з них ассети шару відображення (ADR-0072). До Т.6b (2026-11-10) вони лежали поза git у `assets-src/` з абсолютними шляхами; тут — ті самі скрипти зі шляхами від розташування файла.

**Сирці зображень лишаються поза git** — у `assets-src/` на машині власника (прецедент `scripts/geo-layout.py`). Без них скрипти не запускаються.

## Запуск

```bash
pip install pillow numpy scipy    # перевірено: Pillow 12.3, numpy 2.2, Python 3.10; scipy — лише для convert_units_t133.py
python3 scripts/assets/convert_units_t133.py   # чинний атлас юнітів (Т.133); з кореня репозиторію
# convert_units.py — історичний (П14.3): пише в той самий assets/units-atlas.png і поверне старий піксель-арт
python3 scripts/assets/convert_terrain_t135.py  # чинні тайли терену (Т.135); теку сирців можна дати аргументом
# metro-step2-convert.py — історичний: пише в той самий assets/metro-tiles.png і поверне піксельні тайли
python3 scripts/assets/metro-step2-convert.py  # з кореня репозиторію
```

Скрипти `metro-step2-*` читають шляхи відносно поточного каталогу — запускати з кореня репозиторію. Решта визначає корінь сама.

## Конвертери (пишуть у `assets/`)

| Скрипт | Сирці | Результат |
| --- | --- | --- |
| `convert_units.py` (П14.3; чинний атлас із Т.133 дає `convert_units_t133.py`) | `assets-src/солдат атлас.jpg`, `assets-src/демон атлас.jpg` | `assets/units-atlas.png` 480×192 + звіт `assets-src/units-gemini-report.json` |
| `convert_units_t133.py` (Т.133, ADR-0122) | `assets-src/t133-soldier-sheet.jpg`, `assets-src/t133-demon-sheet.jpg` (аркуші Gemini на хромакеї; теку сирців можна дати аргументом) | `assets/units-atlas.png` 480×192 з плавною альфою + звіт `units-t133-report.json` (з Т.134 — і `walkIoU`, `weaponPx`: кадри кроку зі збігом масок > 0,75 чи без зброї — помилка); потрібен ще `scipy`. Чинні сирці — аркуші Т.134 |
| `metro-step2-convert.py` (чинні тайли з Т.135 дає `convert_terrain_t135.py`) | `assets-src/metro-bg.jpg`, `metro-wall.jpg`, `metro-decor-*.jpg` | `assets/metro-tiles.png` 192×48; контроль якості фону проти JPG-оригіналу |
| `convert_terrain_t135.py` (Т.135, ADR-0123) | `assets-src/t135-terrain-sheet.jpg` (аркуш Gemini: 4 об'єкти на хромакеї) | `assets/metro-tiles.png` 192×48 з плавною альфою (стіна на всю клітинку, декори по центру, ореол плями світла кодом) + звіт `terrain-t135-report.json`; матування і зменшення — з `convert_units_t133.py`, потрібен `scipy`; зелений відблиск чи стіна < 0,9 клітинки — помилка. Сирець у власника — `~/Downloads/Gemini_Generated_Image_cwbtykcwbtykcwbt.jpeg` |

**Відтворюваність:** `convert_units_t133.py` із сирців Т.134 (у власника — `~/Downloads/Gemini_Generated_Image_dnq3w0dnq3w0dnq3.jpeg`, оперативник, і `…k1rfqzk1rfqzk1rf.jpeg`, демон) дає атлас, піксель у піксель тотожний закоміченому (перевірено 2026-11-23, Т.134); із сирців Т.133 він давав атлас, піксель у піксель тотожний закоміченому `assets/units-atlas.png`, і той самий звіт (перевірено 2026-11-23 аудитом PR #446). Перевірка 2026-11-10 на `639fd14`: `convert_units.py` і `metro-step2-convert.py` давали атласи, тотожні тодішнім `assets/units-atlas.png` (до Т.133) і `assets/metro-tiles.png`. Байти PNG можуть відрізнятися залежно від версії Pillow — порівнювати пікселі, не файли. `units-gemini-report.json` у цьому каталозі — еталонний звіт конвертації юнітів (PR #241); повторний прогін дає той самий звіт байт у байт.

## Аналіз і звірка (нічого не пишуть у `assets/`)

| Скрипт | Що перевіряє |
| --- | --- |
| `analysis.py` | розміри сирців юнітів, тло, маска flood-fill, кластери |
| `sheets.py`, `sheets_ascii.py`, `sheets_ascii2.py` | розбір листів-атласів Gemini: компоненти, кластери кадрів, ASCII-рендер |
| `captions.py`, `captions_inv.py`, `captions_text.py` | підписи на листах: гістограми, рендер тексту плашок |
| `geometry.py` | геометрія чинного атласа і дрейф масштабу нових сирців |
| `match.py` | звірка 10 нових кадрів зі старими (IoU прямий проти дзеркального) |
| `facing.py`, `demon_check.py` | напрямок погляду і орієнтація кадрів демона |
| `metro-step2-analyze.py`, `metro-step2-ascii.py`, `metro-step2-wallprobe.py`, `metro-step2-tiles-ascii.py` | сирці й готові тайли «Мегаполіса»: яскравість, пороги, ASCII-контроль |

Це разові скрипти сесій, збережені як слід рішень (уроки П14.2, П14.3, позафазна лінія «візуальні порівняння»); поза скоупом ESLint/Prettier і CI.
