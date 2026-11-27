#!/usr/bin/env python3
"""п21.5 (Т.223, ADR-0179): бюсти ворогів і паровий латунний голем на полі з аркушів Gemini.

Сирці — у теці (аргумент; типово assets-src/, поза git), 1376 × 768, хромакей #00FF00:
  t223-demon.jpg, t223-hound.jpg, t223-golem.jpg, t223-eye.jpg — по чотири бюсти в ряд;
  t223-golem-units.jpg — п'ять поз латунного голема в ряд (idle, walk1, walk2, fire, death), обличчям праворуч.
Результат:
  assets/enemy-portraits.png — 384 × 384, клітинки 96 × 96: ряд — тип (демон, гончак, голем, око,
                               порядок ENEMY_ORDER), стовпець — обличчя 0–3 (порядок на аркуші зліва направо);
                               клітинка непрозора — бюст на темно-пурпуровому тлі #1E0F24 (округлює CSS);
  assets/units-atlas.png     — ряд 3 (голем) з нового аркуша; решта рядів — без змін, байт у байт;
  scripts/assets/enemies-t223-report.json — поділ і кадрування бюстів, рамки й дуло голема.
Поділ і кадрування бюстів — як convert_portraits_t222.py; рядки, де фігура займає понад LINE_FRAC ширини
аркуша (на аркуші гончаків Gemini провів лінію основи), — прозорі. Ряд голема — build_row з
convert_units_t194.py (дзеркало в натив ворога, висота 59 px, перевірка кроку). Перевірки (код 1):
зелений відблиск бюста, незмінність рядів 0–2 і 4 атласа бійців. Запуск з кореня репозиторію:
python3 scripts/assets/convert_enemies_t223.py [тека сирців]
"""

from pathlib import Path
import json
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from convert_portraits_t222 import CELL, GREEN_MAX, PER_SHEET, crop_bust, cuts_of  # noqa: E402
from convert_units_t133 import FR, matte, resize  # noqa: E402
from convert_units_t194 import build_row  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'assets-src'
OUT = ROOT / 'assets/enemy-portraits.png'
UNITS = ROOT / 'assets/units-atlas.png'
REPORT = Path(__file__).resolve().parent / 'enemies-t223-report.json'

KINDS = ('demon', 'hound', 'golem', 'eye')  # = ENEMY_ORDER (src/core/enemies.ts)
GOLEM_ROW = 3  # ATLAS_ROW.golem (src/render.ts)
LINE_FRAC = 0.92
BG = (30, 15, 36)  # #1E0F24 — тло бюста ворога


def flatten(sp):
    a = sp[..., 3:4].astype(np.float32) / 255.0
    rgb = sp[..., :3] * a + np.array(BG, np.float32) * (1 - a)
    return rgb.clip(0, 255).astype(np.uint8)


def busts():
    atlas = np.zeros((CELL * len(KINDS), CELL * PER_SHEET, 3), np.uint8)
    report = []
    for row, kind in enumerate(KINDS):
        img = matte(SRC / f't223-{kind}.jpg')
        lines = np.where((img[..., 3] > 128).sum(axis=1) > LINE_FRAC * img.shape[1])[0]
        img[lines, :, 3] = 0
        cuts = cuts_of(img[..., 3] > 128)
        for i in range(PER_SHEET):
            bust, info = crop_bust(img[:, cuts[i] : cuts[i + 1]])
            sp = resize(bust, CELL / bust.shape[0])[:CELL, :CELL]
            g = sp[..., 1].astype(int) - np.maximum(sp[..., 0], sp[..., 2]).astype(int)
            green = int(g[sp[..., 3] > 0].max())
            if green > GREEN_MAX:
                raise SystemExit(f'{kind} бюст {i + 1}: зелений відблиск {green} > {GREEN_MAX}')
            atlas[row * CELL : (row + 1) * CELL, i * CELL : (i + 1) * CELL] = flatten(sp)
            report.append({'kind': kind, 'cell': [i, row], 'split': cuts[i : i + 2], **info, 'lineRows': len(lines), 'greenMax': green})
    Image.fromarray(atlas, 'RGB').save(OUT, optimize=True)
    return report


def golem():
    old = np.asarray(Image.open(UNITS).convert('RGBA'))
    frames, info = build_row(SRC / 't223-golem-units.jpg', 'golem')
    atlas = old.copy()
    for col, fr in enumerate(frames):
        atlas[GOLEM_ROW * FR : (GOLEM_ROW + 1) * FR, col * FR : (col + 1) * FR] = fr
    atlas[atlas[..., 3] == 0] = 0
    keep = np.ones(atlas.shape[0], bool)
    keep[GOLEM_ROW * FR : (GOLEM_ROW + 1) * FR] = False
    if not np.array_equal(atlas[keep], old[keep]):
        raise SystemExit('змінились ряди атласа бійців, крім голема')
    Image.fromarray(atlas, 'RGBA').save(UNITS, optimize=True)
    return info


def main():
    report = {'portraits': busts(), 'golem': golem()}
    # запис — рядком (як units-t194-report.json: багаторядковий звіт роздував би диф)
    lines = [' ' + json.dumps(p, ensure_ascii=False) for p in report['portraits']]
    REPORT.write_text('{\n "portraits": [\n' + ',\n'.join(lines) + '\n ],\n "golem": ' + json.dumps(report['golem'], ensure_ascii=False) + '\n}\n')
    print(json.dumps({'golem': {k: report['golem'][k] for k in ('muzzle', 'walkIoU', 'scale')}}, ensure_ascii=False))


if __name__ == '__main__':
    main()
