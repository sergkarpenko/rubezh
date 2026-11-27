#!/usr/bin/env python3
"""п21.2 (Т.220, ADR-0176): картина мегаполіса і аркуш значків геосцени з сирців Gemini.

Сирці — у теці (аргумент; типово assets-src/):
  t220-city.jpg  — картина нічного мегаполіса згори 16 : 9 (1376 × 768), чотири райони під
                   розклад REGION_OF (src/core/regions.ts): Порт (захід), Шпилі (північ, вузол),
                   Промзона (схід), Нетрі (південь), між ними — ріки й канали;
  t220-icons.jpg — аркуш шести значків на хромакеї #00FF00 (зліва направо: дрон-розвідник,
                   дрон-збирач, паровий гравідирижабль, вузол «Рубіж», ангар, Брама Розриву).
Результат — ті самі файли й геометрія, що в п19.5 (convert_geo_t208.py):
  assets/geo-map.webp   — 1120 × 630;
  assets/geo-icons.png  — 576 × 96, шість клітинок 96 × 96 у порядку аркуша, плавна альфа;
  scripts/assets/geo-t220-report.json — розклад суші GEO_LAYOUT (16 × 9) і рамки значків.
Розклад «суші» (кварталів) — той самий поріг Отсу за ознакою r + g - b: вода рік і каналів темно-синя
(від'ємна), дахи — теплі темні (додатна). Перевірки, матування, зменшення і solid_inside — з
convert_geo_t208.py і convert_units_t133.py (потрібен scipy). Запуск з кореня репозиторію:
python3 scripts/assets/convert_geo_t220.py [тека сирців]
"""

from pathlib import Path
import json
import re
import sys

import numpy as np
from PIL import Image, ImageFilter

import convert_geo_t208 as t208
from convert_units_t133 import matte, resize, split_figures

ROOT = Path(__file__).resolve().parents[2]
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'assets-src'
REPORT = Path(__file__).resolve().parent / 'geo-t220-report.json'
# назви районів у повідомленнях перевірок (ADR-0175 п. 3); клітинки ангарів — HANGARS (src/core/intercept.ts)
MUST_LAND = {'вузол': (8, 4), 'ангар «Порт»': (2, 4), 'ангар «Промзона»': (13, 4), 'ангар «Нетрі»': (8, 7)}
# аркуш Т.220: пара за кормою дирижабля і шлейф дрона — окремі дрібні плями; розширення маски 9
# пришиває їх до свого значка (між значками — понад 60 px хромакею)
GROW = 9


def city():
    im = Image.open(SRC / 't220-city.jpg').convert('RGB')
    w, h = im.size
    cw = round(h * 16 / 9)
    x0 = (w - cw) // 2
    crop = im.crop((x0, 0, x0 + cw, h)).resize((t208.MAP_W, t208.MAP_H), Image.LANCZOS)
    crop.save(t208.MAP_OUT, 'WEBP', quality=86, method=6)
    a = np.asarray(crop.filter(ImageFilter.GaussianBlur(4))).astype(np.float32)
    feat = np.clip(a[..., 0] + a[..., 1] - a[..., 2] + 128, 0, 255)
    th = t208.otsu(feat)
    land = feat > th
    gw, gh, mw, mh = t208.GW, t208.GH, t208.MAP_W, t208.MAP_H
    rows, share = [], []
    for gy in range(gh):
        y0, y1 = round(gy * mh / gh), round((gy + 1) * mh / gh)
        row, srow = '', []
        for gx in range(gw):
            xa, xb = round(gx * mw / gw), round((gx + 1) * mw / gw)
            s = float(land[y0:y1, xa:xb].mean())
            srow.append(round(s, 2))
            row += ('B' if (gx, gy) == (8, 4) else 'L') if s >= t208.LAND_SHARE else '.'
        rows.append(row)
        share.append(srow)
    errs = [f'{k} {c} — не квартал ({share[c[1]][c[0]]})' for k, c in MUST_LAND.items() if share[c[1]][c[0]] < t208.LAND_SHARE]
    for r in ('west', 'north', 'east', 'south'):
        if not any(rows[y][x] != '.' for y in range(gh) for x in range(gw) if t208.REGION_OF(x, y) == r):
            errs.append(f'район {r} без кварталів')
    return {'size': [mw, mh], 'crop': [x0, 0, x0 + cw, h], 'threshold': round(th, 1), 'layout': rows, 'landShare': share}, errs


def icons():
    names, cell = t208.ICON_NAMES, t208.ICON
    figs = split_figures(matte(SRC / 't220-icons.jpg'), parts=len(names), grow=GROW)
    atlas = np.zeros((cell, cell * len(names), 4), np.uint8)
    boxes, errs = {}, []
    for i, (name, fig) in enumerate(zip(names, figs)):
        fig = t208.solid_inside(fig, t208.BASE.get(name, t208.BASE_DEFAULT))
        h, w = fig.shape[:2]
        s = resize(fig, t208.ICON_MAX / max(h, w))
        sh, sw = s.shape[:2]
        y, x = (cell - sh) // 2, i * cell + (cell - sw) // 2
        atlas[y : y + sh, x : x + sw] = s
        boxes[name] = {'x': x, 'y': y, 'w': sw, 'h': sh, 'src': [w, h]}
        rgb = s[..., :3].astype(np.int16)
        g = rgb[..., 1] - np.maximum(rgb[..., 0], rgb[..., 2])
        if int(g[s[..., 3] > 0].max(initial=0)) > t208.GREEN_MAX:
            errs.append(f'зелений відблиск на значку {name}')
    Image.fromarray(atlas, 'RGBA').save(t208.ICONS_OUT)
    return {'size': [cell * len(names), cell], 'cell': cell, 'order': names, 'boxes': boxes}, errs


def main():
    m, e1 = city()
    ic, e2 = icons()
    text = json.dumps({'map': m, 'icons': ic}, ensure_ascii=False, indent=1)
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
