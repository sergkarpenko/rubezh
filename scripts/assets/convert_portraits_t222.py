#!/usr/bin/env python3
"""п21.4 (Т.222, ADR-0178): портрети оперативників і техномантів з аркушів Gemini.

Сирці — у теці (аргумент; типово assets-src/, поза git), 1376 × 768, по чотири бюсти в ряд на хромакеї #00FF00:
  t222-ops-m.jpg   — оперативники-чоловіки;    t222-ops-f.jpg  — оперативниці;
  t222-tech-m.jpg  — техноманти-чоловіки;      t222-tech-f.jpg — техномантки.
Результат:
  assets/portraits.png — 768 × 192, клітинки 96 × 96: ряд 0 — оперативники, ряд 1 — техноманти;
                         стовпці 0–3 — чоловіки, 4–7 — жінки (порядок бюстів на аркуші зліва направо);
                         клітинка непрозора — бюст на темному тлі аватара #0F1A2E (його округлює CSS);
  scripts/assets/portraits-t222-report.json — межі поділу, рамки кадрування, зелений відблиск.
Поділ: бюсти можуть торкатися плечима, тож межа — стовпець з найменшою кількістю пікселів фігури
в околі ±SPLIT_WIN від чверті ширини. Кадр — квадрат зі стороною CROP_K × висоти бюста, верх — на
TOP_PAD сторони над маківкою, центр x — центр маси верхніх 40 % бюста (голова). Матування і зменшення —
з convert_units_t133.py (ADR-0122; потрібен scipy). Перевірка (помилка — код 1): зелений відблиск
(g - max(r, b) > GREEN_MAX на пікселях бюста). Запуск з кореня репозиторію:
python3 scripts/assets/convert_portraits_t222.py [тека сирців]
"""

from pathlib import Path
import json
import sys

import numpy as np
from PIL import Image

from convert_units_t133 import matte, resize

ROOT = Path(__file__).resolve().parents[2]
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'assets-src'
OUT = ROOT / 'assets/portraits.png'
REPORT = Path(__file__).resolve().parent / 'portraits-t222-report.json'

CELL = 96
SHEETS = [('t222-ops-m.jpg', 0, 0), ('t222-ops-f.jpg', 0, 4), ('t222-tech-m.jpg', 1, 0), ('t222-tech-f.jpg', 1, 4)]
PER_SHEET = 4
SPLIT_WIN = 120
CROP_K = 0.82
TOP_PAD = 0.05
HEAD_BAND = 0.4
BG = (15, 26, 46)  # #0F1A2E — тло аватара «шолом» (src/ui/avatar.ts)
GREEN_MAX = 8


def cuts_of(mask):
    col = mask.sum(axis=0)
    w = mask.shape[1]
    cuts = [0]
    for q in range(1, PER_SHEET):
        c = w * q // PER_SHEET
        lo = c - SPLIT_WIN
        cuts.append(lo + int(np.argmin(col[lo : c + SPLIT_WIN])))
    return cuts + [w]


def crop_bust(sub):
    m = sub[..., 3] > 128
    ys = np.where(m.any(axis=1))[0]
    y0, y1 = int(ys.min()), int(ys.max())
    h = y1 - y0
    xs = np.where(m[y0 : y0 + int(HEAD_BAND * h)])[1]
    cx = int(xs.mean())
    s = int(CROP_K * h)
    top = y0 - int(TOP_PAD * s)
    x0 = cx - s // 2
    out = np.zeros((s, s, 4), np.float32)
    sy0, sy1 = max(0, top), min(sub.shape[0], top + s)
    sx0, sx1 = max(0, x0), min(sub.shape[1], x0 + s)
    out[sy0 - top : sy1 - top, sx0 - x0 : sx1 - x0] = sub[sy0:sy1, sx0:sx1]
    return out, {'headTop': y0, 'bustH': h, 'centerX': cx, 'side': s}


def flatten(sp):
    a = sp[..., 3:4].astype(np.float32) / 255.0
    rgb = sp[..., :3] * a + np.array(BG, np.float32) * (1 - a)
    return rgb.clip(0, 255).astype(np.uint8)


def main():
    atlas = np.zeros((CELL * 2, CELL * 8, 3), np.uint8)
    report = []
    for name, row, col0 in SHEETS:
        img = matte(SRC / name)
        cuts = cuts_of(img[..., 3] > 128)
        for i in range(PER_SHEET):
            bust, info = crop_bust(img[:, cuts[i] : cuts[i + 1]])
            sp = resize(bust, CELL / bust.shape[0])[:CELL, :CELL]
            g = sp[..., 1].astype(int) - np.maximum(sp[..., 0], sp[..., 2]).astype(int)
            green = int(g[sp[..., 3] > 0].max())
            if green > GREEN_MAX:
                raise SystemExit(f'{name} бюст {i + 1}: зелений відблиск {green} > {GREEN_MAX}')
            x = (col0 + i) * CELL
            atlas[row * CELL : (row + 1) * CELL, x : x + CELL] = flatten(sp)
            report.append({'sheet': name, 'cell': [col0 + i, row], 'split': cuts[i : i + 2], **info, 'greenMax': green})
    Image.fromarray(atlas, 'RGB').save(OUT, optimize=True)
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=1) + '\n')
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    main()
