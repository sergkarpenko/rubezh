#!/usr/bin/env python3
"""п21.3 (Т.221, ADR-0177): тло стартового екрана і неоновий логотип «РУБІЖ» з сирців Gemini.

Сирці — у теці (перший аргумент; типово assets-src/):
  t221-bg.jpg   — картина нічного мегаполіса з Розривом 16 : 9 (1376 × 768), без хромакею;
  t221-logo.jpg — логотип «РУБІЖ» на темному тлі 4 : 3 (1200 × 896).
Другий аргумент (необов'язковий) — тека результату замість assets/ (аркуш варіантів збирає кожен
варіант у свою теку). Результат — ті самі файли й геометрія, що досі (ADR-0072, ADR-0116):
  start-bg.webp — 1376 × 768 (якість 82);
  logo.webp     — 1024 × 768 RGBA: літери ≈ 70 % ширини по центру, тло сирця прозоре (альфа за яскравістю,
                  щілини в літерах закрито), по краю вставки — рампа альфи, по периметру полотна альфа 0;
  scripts/assets/start-t221-report.json — рамка літер у сирці, масштаб, колір тла.
Рамка літер — стовпчики й рядки, де понад 3 пікселі яскравіші за 120 (сірий). Лапки «» обабіч слова (Gemini додав їх в одному з
варіантів) прибирає `--drop-side`: крайня група стовпчиків вужча за 110 px з проміжком від слова ≥ 8 px
відкидається з рамки і заливається кольором тла зовнішнього боку (до краю + 20 px, до слова — половина
проміжку; м'який край 24 px — лише назовні, літер не зачіпає).
Запуск з кореня репозиторію:
python3 scripts/assets/convert_start_t221.py [тека сирців] [тека результату] [--drop-side]
"""

from pathlib import Path
import json
import sys

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
ARGS = [a for a in sys.argv[1:] if not a.startswith('--')]
SRC = Path(ARGS[0]) if ARGS else ROOT / 'assets-src'
OUT = Path(ARGS[1]) if len(ARGS) > 1 else ROOT / 'assets'
DROP_SIDE = '--drop-side' in sys.argv
# аудит PR #540: невідомий прапорець (друкарська помилка) — помилка, а не мовчазний пропуск
UNKNOWN = [a for a in sys.argv[1:] if a.startswith('--') and a != '--drop-side']
if UNKNOWN:
    sys.exit(f'невідомі прапорці: {UNKNOWN}; є лише --drop-side')
REPORT = Path(__file__).resolve().parent / 'start-t221-report.json'
BG_SIZE = (1376, 768)
LOGO_SIZE = (1024, 768)
LETTERS_SHARE = 0.70  # частка ширини логотипа під літерами: розмір на екрані ≈ як у логотипа main; маска-еліпс ADR-0116 тримає їх у світлі
BRIGHT = 120


def runs(mask: np.ndarray) -> list[tuple[int, int]]:
    """Суцільні відрізки True: [(початок, кінець)) у порядку зростання."""
    out, start = [], None
    for i, v in enumerate(mask):
        if v and start is None:
            start = i
        if not v and start is not None:
            out.append((start, i))
            start = None
    if start is not None:
        out.append((start, len(mask)))
    return out


def letters_box(gray: np.ndarray) -> tuple[tuple[int, int, int, int], list[tuple[int, int]]]:
    """Рамка слова (x0, y0, x1, y1) і відкинуті бічні смуги (лапки) — для --drop-side."""
    hot = gray > BRIGHT
    cols = hot.sum(0) > 3
    # проміжки до 4 px — усередині літери (неонові трубки з розривами); ширші — між літерами чи плямами
    groups: list[list[int]] = []
    for a, b in runs(cols):
        if groups and a - groups[-1][1] <= 4:
            groups[-1][1] = b
        else:
            groups.append([a, b])
    dropped: list[tuple[int, int]] = []
    if DROP_SIDE:
        # лапки — крайня група вужча за 110 px з проміжком від слова не менше 8 px (у літер — до 6 px)
        while len(groups) > 1 and groups[0][1] - groups[0][0] < 110 and groups[1][0] - groups[0][1] >= 8:
            dropped.append(tuple(groups.pop(0)))
        while len(groups) > 1 and groups[-1][1] - groups[-1][0] < 110 and groups[-1][0] - groups[-2][1] >= 8:
            dropped.append(tuple(groups.pop()))
    x0, x1 = groups[0][0], groups[-1][1]
    # рядки літер — понад 3 % ширини слова яскравих пікселів: розлам Розриву крізь слово (на «Б» — 11–17 пікселів
    # у рядку, аудит PR #540) і тонка тріщина «А» порога не проходять; найдовший відрізок — літери
    rows = hot[:, x0:x1].sum(1) > 0.03 * (x1 - x0)
    rs = runs(rows)
    y0, y1 = max(rs, key=lambda r: r[1] - r[0])
    return (x0, y0, x1, y1), dropped


def convert_bg() -> dict:
    img = Image.open(SRC / 't221-bg.jpg').convert('RGB')
    assert img.size[0] * 9 == img.size[1] * 16 or abs(img.size[0] / img.size[1] - 16 / 9) < 0.02, img.size
    img = img.resize(BG_SIZE, Image.LANCZOS)
    OUT.mkdir(parents=True, exist_ok=True)
    img.save(OUT / 'start-bg.webp', 'WEBP', quality=82, method=6)
    return {'size': list(BG_SIZE)}


def convert_logo() -> dict:
    img = Image.open(SRC / 't221-logo.jpg').convert('RGB')
    arr = np.asarray(img).astype(np.float32)
    gray = np.asarray(img.convert('L')).astype(np.int32)
    (x0, y0, x1, y1), dropped = letters_box(gray)
    h, w = gray.shape
    if dropped:
        # заливка рядок за рядком кольором зовнішнього боку смуги (за 12 px від неї, ближче до краю кадру):
        # віньєтка сирця нерівна, одна медіана кутів лишала б темні смуги
        fill = arr.copy()
        m = np.zeros((h, w), np.uint8)
        for a, b in dropped:
            # з боку слова — до половини проміжку (на сирці Т.221 — 17 і 10 px), з боку краю — 20 px
            left = a < x0
            gap = (x0 - b) if left else (a - x1)
            lo, hi = (max(0, a - 20), b + gap // 2) if left else (a - gap // 2, min(w, b + 20))
            outer = max(0, lo - 12) if left else min(w - 1, hi + 12)
            col = np.asarray(Image.fromarray(arr[:, outer : outer + 1].clip(0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(6))).astype(np.float32)
            fill[:, lo:hi] = col
            m[:, lo:hi] = 255
        soft = np.asarray(Image.fromarray(m).filter(ImageFilter.GaussianBlur(24))).astype(np.float32)[..., None] / 255
        soft[:, x0:x1] = 0  # м'який край не заходить на слово
        k = np.maximum(soft, (m > 0)[..., None].astype(np.float32))
        arr = arr * (1 - k) + fill * k
    scale = LETTERS_SHARE * LOGO_SIZE[0] / (x1 - x0)
    src = Image.fromarray(arr.clip(0, 255).astype(np.uint8)).resize((round(w * scale), round(h * scale)), Image.LANCZOS)
    # аудит PR #540: полотно прозоре (RGBA, як логотип П13.4) — на тлі стартового екрана немає прямокутника вставки
    canvas = Image.new('RGBA', LOGO_SIZE, (0, 0, 0, 0))
    # центр слова — у центр полотна
    cx, cy = (x0 + x1) / 2 * scale, (y0 + y1) / 2 * scale
    ox, oy = round(LOGO_SIZE[0] / 2 - cx), round(LOGO_SIZE[1] / 2 - cy)
    # альфа — за яскравістю (літери, світіння й розлам лишаються, темне тло сирця й проміжки між літерами прозорі),
    # по краю вставки — рампа до 96 px, що не заходить на рамку літер
    sw, sh = src.size
    lum = np.asarray(src.convert('L')).astype(np.float32)
    # поріг за яскравістю: тло сирця ≈ 5–10, темний метал граней літер — від ≈ 25; закриття маски (максимум, потім
    # мінімум 9 × 9) затягує дрібні темні щілини всередині літер (руни, заклепки), щоб грані не просвічували
    alpha = np.clip((lum - 10) / 16, 0, 1)
    a8 = Image.fromarray((alpha * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.MinFilter(9))
    alpha = np.maximum(alpha, np.asarray(a8).astype(np.float32) / 255)
    bx0, by0, bx1, by1 = (round(v * scale) for v in (x0, y0, x1, y1))
    margin = min(bx0, by0, sw - bx1, sh - by1) - 20
    assert margin > 24, f'рамка літер надто близько до краю сирця: {margin}'
    edge = np.ones((sh, sw), np.float32)
    ramp = min(96, margin)
    for i in range(ramp):
        t = (i + 1) / (ramp + 1)
        edge[i, :] = np.minimum(edge[i, :], t)
        edge[-1 - i, :] = np.minimum(edge[-1 - i, :], t)
        edge[:, i] = np.minimum(edge[:, i], t)
        edge[:, -1 - i] = np.minimum(edge[:, -1 - i], t)
    canvas.paste(src, (ox, oy), Image.fromarray((edge * alpha * 255).round().astype(np.uint8)))
    a = np.asarray(canvas)[..., 3]
    assert a[0].max() == 0 and a[-1].max() == 0 and a[:, 0].max() == 0 and a[:, -1].max() == 0, 'альфа по периметру не 0'
    OUT.mkdir(parents=True, exist_ok=True)
    canvas.save(OUT / 'logo.webp', 'WEBP', quality=88, method=6)
    return {
        'size': list(LOGO_SIZE),
        'source': [w, h],
        'letters': [x0, y0, x1, y1],
        'dropped': [list(d) for d in dropped],
        'scale': round(scale, 4),
        'offset': [ox, oy],
        'ramp': ramp,
        'alpha_mean': round(float(a.mean()) / 255, 3),
    }


def main() -> None:
    report = {'step': 'Т.221', 'adr': 'ADR-0177', 'bg': convert_bg(), 'logo': convert_logo()}
    if OUT == ROOT / 'assets':
        REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    main()
