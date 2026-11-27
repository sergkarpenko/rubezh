#!/usr/bin/env python3
"""п20.5 (Т.216, ADR-0169): тайли низьких перешкод і іконки зброї з аркушів Gemini.

Сирці — у теці (аргумент; типово assets-src/, поза git):
  t216-low.jpg     — три низькі перешкоди на хромакеї #00FF00 (зліва направо: ящики, бетонний
                     відбійник, купа уламків), ¾ згори, як стіна Т.135;
  t216-weapons.jpg — чотири зброї збоку, дуло праворуч (зліва направо: «Гарт», «Шквал», «Голка»,
                     «Град» — порядок WEAPON_ICON_COL у src/render.ts).
Результат:
  assets/low-cover.png    — 144 × 48, три тайли 48 × 48 (= BCELL, 1:1), більша сторона перешкоди — LOW_PX,
                            по центру клітинки, нижній край — на LOW_BOTTOM px від низу;
  assets/weapon-icons.png — 384 × 32, чотири клітинки 96 × 32, зброя вписана в ICON_W × ICON_H по центру;
  scripts/assets/t216-report.json — рамки, частка непрозорого, зелений відблиск.
Матування і зменшення — з convert_units_t133.py (ADR-0122; потрібен scipy). Перевірки (помилка — код 1):
зелений відблиск (g - max(r, b) > GREEN_MAX при альфі > 0), кількість фігур, «Голка» — найдовша,
«Шквал» — найкоротша (відмінність силуетів просили в промпті). Запуск з кореня репозиторію:
python3 scripts/assets/convert_t216.py [тека сирців]
"""

from pathlib import Path
import json
import sys

import numpy as np
from PIL import Image

from convert_units_t133 import matte, resize, split_figures

ROOT = Path(__file__).resolve().parents[2]
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'assets-src'
LOW_OUT = ROOT / 'assets/low-cover.png'
ICONS_OUT = ROOT / 'assets/weapon-icons.png'
REPORT = Path(__file__).resolve().parent / 't216-report.json'

T = 48
LOW_PX = 42  # більша сторона перешкоди: нижча за стіну (та — уся клітинка), більша за ящик кодом (31)
LOW_BOTTOM = 2
ICON_CW, ICON_CH = 96, 32
ICON_W, ICON_H = 92, 28
WEAPONS = ['rifle', 'shotgun', 'sniper', 'mg']
LOWS = ['crates', 'barrier', 'debris']
GREEN_MAX = 8


def green_max(sp):
    g = sp[..., 1].astype(int) - np.maximum(sp[..., 0], sp[..., 2]).astype(int)
    return int(g[sp[..., 3] > 0].max())


def place(cell, s, x, y):
    h, w = s.shape[:2]
    a = s[..., 3:4] / 255.0
    region = cell[y : y + h, x : x + w].astype(np.float32)
    ra = region[..., 3:4] / 255.0
    out_a = a + ra * (1 - a)
    rgb = (s[..., :3] * a + region[..., :3] * ra * (1 - a)) / np.maximum(out_a, 1e-6)
    cell[y : y + h, x : x + w] = np.dstack([rgb, out_a * 255]).clip(0, 255).astype(np.uint8)


def info(cell, name, src, green):
    op = cell[..., 3] > 128
    ys, xs = np.where(op)
    return {
        'name': name,
        'srcWH': [int(src.shape[1]), int(src.shape[0])],
        'bbox': [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1],
        'opaque': round(float(op.mean()), 3),
        'greenMax': green,
    }


def main():
    report = {'low': [], 'weapons': []}
    lows = split_figures(matte(SRC / 't216-low.jpg'), parts=3)
    tiles = []
    for fig, name in zip(lows, LOWS):
        h, w = fig.shape[:2]
        sp = resize(fig, LOW_PX / max(h, w))
        g = green_max(sp)
        if g > GREEN_MAX:
            raise SystemExit(f'перешкода {name}: зелений відблиск {g} > {GREEN_MAX}')
        t = np.zeros((T, T, 4), np.uint8)
        sh, sw = sp.shape[:2]
        place(t, sp, (T - sw) // 2, T - LOW_BOTTOM - sh)
        tiles.append(t)
        report['low'].append(info(t, name, fig, g))
    weapons = split_figures(matte(SRC / 't216-weapons.jpg'), parts=4)
    lengths = [f.shape[1] for f in weapons]
    if lengths.index(max(lengths)) != 2 or lengths.index(min(lengths)) != 1:
        raise SystemExit(f'довжини зброї {lengths}: «Голка» має бути найдовшою, «Шквал» — найкоротшим')
    cells = []
    for fig, name in zip(weapons, WEAPONS):
        h, w = fig.shape[:2]
        sp = resize(fig, min(ICON_W / w, ICON_H / h))
        g = green_max(sp)
        if g > GREEN_MAX:
            raise SystemExit(f'зброя {name}: зелений відблиск {g} > {GREEN_MAX}')
        c = np.zeros((ICON_CH, ICON_CW, 4), np.uint8)
        sh, sw = sp.shape[:2]
        place(c, sp, (ICON_CW - sw) // 2, (ICON_CH - sh) // 2)
        cells.append(c)
        report['weapons'].append(info(c, name, fig, g))
    for arr, out in ((np.concatenate(tiles, axis=1), LOW_OUT), (np.concatenate(cells, axis=1), ICONS_OUT)):
        arr[arr[..., 3] == 0] = 0
        Image.fromarray(arr, 'RGBA').save(out, optimize=True)
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=1) + '\n')
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    main()
