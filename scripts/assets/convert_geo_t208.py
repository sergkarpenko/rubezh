#!/usr/bin/env python3
"""п19.5 (Т.208, ADR-0163): картина світу і аркуш значків геосцени з сирців Gemini.

Сирці — у теці (аргумент; типово assets-src/):
  t208-world.jpg — картина світу 16 : 9 (1376 × 768), чотири частини суші під регіони
                   розкладу REGION_OF (src/core/regions.ts);
  t208-icons.jpg — аркуш шести значків на хромакеї #00FF00 (зліва направо: зонд-розвідник,
                   зонд-збирач, перехоплювач, вузол «Рубіж», ангар, Брама Розриву).
Результат:
  assets/geo-map.webp   — 1120 × 630 (16 : 9, вирізано по центру з 1376 × 768 до 1365 × 768);
  assets/geo-icons.png  — 576 × 96, шість клітинок 96 × 96 у порядку аркуша, плавна альфа;
  scripts/assets/geo-t208-report.json — розклад суші GEO_LAYOUT (16 × 9) і рамки значків.
Розклад суші: пікселі розмитої картини ділить поріг Отсу за ознакою r + g - b (темний
синій океан — від'ємна, суша — додатна); клітинка 16 × 9 — суша, якщо суша займає ≥ 50 % її площі. Перевірки (помилка —
вихід із кодом 1): клітинки вузла (8, 4), ангарів (2, 4), (13, 4), (8, 7) — суша; кожен
регіон має сушу; зелений відблиск на значках (g - max(r, b) > 8 при альфі > 0) — немає.
Матування і зменшення — з convert_units_t133.py (потрібен scipy); напівпрозоре всередині
силуету значка — непрозоре поверх темної основи (solid_inside). Запуск з кореня
репозиторію: python3 scripts/assets/convert_geo_t208.py [тека сирців]
"""

from pathlib import Path
import json
import re
import sys

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

from convert_units_t133 import matte, resize, split_figures

ROOT = Path(__file__).resolve().parents[2]
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'assets-src'
MAP_OUT = ROOT / 'assets/geo-map.webp'
ICONS_OUT = ROOT / 'assets/geo-icons.png'
REPORT = Path(__file__).resolve().parent / 'geo-t208-report.json'

MAP_W, MAP_H = 1120, 630
GW, GH = 16, 9
LAND_SHARE = 0.5
MUST_LAND = {'вузол': (8, 4), 'ангар «Захід»': (2, 4), 'ангар «Схід»': (13, 4), 'ангар «Південь»': (8, 7)}
REGION_OF = lambda x, y: 'west' if x <= 4 else 'east' if x >= 12 else 'north' if y <= 4 else 'south'  # noqa: E731
ICON = 96
ICON_MAX = 92  # поле 2 px з боків
ICON_NAMES = ['scout', 'harvester', 'interceptor', 'node', 'hangar', 'gate']
GREEN_MAX = 8
# аудит PR #524: вир Брами і тінь у воротах ангара Gemini малює напівпрозорими до хромакею — після
# прибирання зеленого крізь них видно мапу. Усередині силуету (на INNER px від краю) альфа — 255,
# колір — поверх темної основи значка (Брама — фіолетова, решта — графітова); край лишається м'яким.
INNER = 4
BASE = {'gate': (42, 18, 66)}
BASE_DEFAULT = (14, 18, 26)


def otsu(v):
    hist, edges = np.histogram(v, bins=256, range=(0, 256))
    p = hist / hist.sum()
    w = np.cumsum(p)
    mu = np.cumsum(p * np.arange(256))
    between = (mu[-1] * w - mu) ** 2 / np.maximum(w * (1 - w), 1e-12)
    return float(edges[int(np.argmax(between))])


def world():
    im = Image.open(SRC / 't208-world.jpg').convert('RGB')
    w, h = im.size
    cw = round(h * 16 / 9)
    x0 = (w - cw) // 2
    crop = im.crop((x0, 0, x0 + cw, h)).resize((MAP_W, MAP_H), Image.LANCZOS)
    crop.save(MAP_OUT, 'WEBP', quality=86, method=6)
    # ознака суші — r + g - b: темний синій океан від'ємний, суша (сіра, бірюзова, зелена) — додатна;
    # розмиття прибирає вогні міст і дороги, поріг — Отсу (зсув +128 — у діапазон гістограми)
    a = np.asarray(crop.filter(ImageFilter.GaussianBlur(4))).astype(np.float32)
    feat = np.clip(a[..., 0] + a[..., 1] - a[..., 2] + 128, 0, 255)
    th = otsu(feat)
    land = feat > th
    rows, share = [], []
    for gy in range(GH):
        y0, y1 = round(gy * MAP_H / GH), round((gy + 1) * MAP_H / GH)
        row, srow = '', []
        for gx in range(GW):
            xa, xb = round(gx * MAP_W / GW), round((gx + 1) * MAP_W / GW)
            s = float(land[y0:y1, xa:xb].mean())
            srow.append(round(s, 2))
            row += ('B' if (gx, gy) == (8, 4) else 'L') if s >= LAND_SHARE else '.'
        rows.append(row)
        share.append(srow)
    errs = [f'{k} {c} — не суша ({share[c[1]][c[0]]})' for k, c in MUST_LAND.items() if share[c[1]][c[0]] < LAND_SHARE]
    for r in ('west', 'north', 'east', 'south'):
        if not any(rows[y][x] != '.' for y in range(GH) for x in range(GW) if REGION_OF(x, y) == r):
            errs.append(f'регіон {r} без суші')
    return {'size': [MAP_W, MAP_H], 'crop': [x0, 0, x0 + cw, h], 'threshold': round(th, 1), 'layout': rows, 'landShare': share}, errs


def solid_inside(fig, base):
    a = fig[..., 3] / 255.0
    inner = ndimage.binary_erosion(ndimage.binary_fill_holes(a > 0.06), iterations=INNER)
    soft = inner & (a < 1.0)
    out = fig.copy()
    k = a[soft][:, None]
    out[..., :3][soft] = fig[..., :3][soft] * k + np.array(base, np.float32) * (1 - k)
    out[..., 3][soft] = 255.0
    return out


def icons():
    figs = split_figures(matte(SRC / 't208-icons.jpg'), parts=len(ICON_NAMES), grow=5)
    atlas = np.zeros((ICON, ICON * len(ICON_NAMES), 4), np.uint8)
    boxes, errs = {}, []
    for i, (name, fig) in enumerate(zip(ICON_NAMES, figs)):
        fig = solid_inside(fig, BASE.get(name, BASE_DEFAULT))
        h, w = fig.shape[:2]
        s = resize(fig, ICON_MAX / max(h, w))
        sh, sw = s.shape[:2]
        y, x = (ICON - sh) // 2, i * ICON + (ICON - sw) // 2
        atlas[y : y + sh, x : x + sw] = s
        boxes[name] = {'x': x, 'y': y, 'w': sw, 'h': sh, 'src': [w, h]}
        rgb = s[..., :3].astype(np.int16)
        g = rgb[..., 1] - np.maximum(rgb[..., 0], rgb[..., 2])
        if int(g[s[..., 3] > 0].max(initial=0)) > GREEN_MAX:
            errs.append(f'зелений відблиск на значку {name}')
    Image.fromarray(atlas, 'RGBA').save(ICONS_OUT)
    return {'size': [ICON * len(ICON_NAMES), ICON], 'cell': ICON, 'order': ICON_NAMES, 'boxes': boxes}, errs


def main():
    m, e1 = world()
    ic, e2 = icons()
    text = json.dumps({'map': m, 'icons': ic}, ensure_ascii=False, indent=1)
    # числові масиви — в один рядок (частки суші — рядок сітки на рядок звіту)
    text = re.sub(r'\[\s*([-0-9.,\s]+?)\s*\]', lambda mt: '[' + ', '.join(mt.group(1).split()).replace(',,', ',') + ']', text)
    REPORT.write_text(text + '\n', encoding='utf-8')
    print('поріг', m['threshold'])
    for r in m['layout']:
        print("  '" + r + "',")
    for e in e1 + e2:
        print('ПОМИЛКА:', e)
    if e1 or e2:
        sys.exit(1)


if __name__ == '__main__':
    main()
