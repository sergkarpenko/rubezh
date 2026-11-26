#!/usr/bin/env python3
# п17.5 (Т.194, ADR-0152): атлас бійців п'яти рядів -> assets/units-atlas.png 480x480
# (кадр 96x96, сітка 5x5: idle, walk1, walk2, fire, death; ряди — оперативник, демон,
# гончак, голем, око). Ряд оперативника береться з чинного атласа (рядок 0, Т.134) —
# його сирці поза git; ряди ворогів — з аркушів Gemini у теці сирців (поза git):
# t194-<тип>-sheet.jpg, один ряд із 5 фігур на хромакеї, 1376x768, JPEG.
# Аркуші намальовані обличчям ПРАВОРУЧ (генератор тримає цей бік надійніше); натив ворогів —
# ліворуч, тому ряд дзеркалиться. Матування, поділ на фігури, зменшення — convert_units_t133.py.
# Висота фігури за типом (BODY): гончак нижчий, око менше; ноги (нижній край) — над ATLAS_FEET_ROW.
from pathlib import Path
import json
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from convert_units_t133 import BOTTOM, FR, MAX_W, feet_x, matte, resize, split_figures, walk_iou, weapon_px  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'assets-src'
OUT = ROOT / 'assets/units-atlas.png'
REPORT = Path(__file__).resolve().parent / 'units-t194-report.json'

# тип: (висота стоячої фігури, px; поріг збігу масок кроку; чи перевіряти зброю демона;
# розширення маски при поділі на фігури — у гончака хвіст майже торкається сусіда, тому 5)
KINDS = {
    'demon': (59, 0.75, True, 9),
    'hound': (44, 0.8, False, 5),
    'golem': (59, 0.8, False, 9),
    'eye': (46, 0.85, False, 9),
}
ROWS = ('soldier', 'demon', 'hound', 'golem', 'eye')


def build_row(path, name):
    body_h, iou_max, weapon_check, grow = KINDS[name]
    figs = [f[:, ::-1].copy() for f in split_figures(matte(path), grow=grow)]  # натив ворога — ліворуч
    stand, death = figs[:4], figs[4]
    scale = body_h / stand[0].shape[0]  # інваріант — висота idle
    widest = max(f.shape[1] for f in stand) * scale
    if widest > MAX_W:
        scale *= MAX_W / widest
    small = [resize(f, scale) for f in stand]
    fx = [feet_x(s) for s in small]
    lo = max(fx)
    hi = max(s.shape[1] - f for s, f in zip(small, fx))
    anchor = round(min(max(48, lo + 1), FR - 1 - hi)) if lo + hi + 2 <= FR else round(lo + 1)
    frames = []
    for s, f in zip(small, fx):
        fr = np.zeros((FR, FR, 4), np.uint8)
        x = min(max(int(round(anchor - f)), 0), FR - s.shape[1])
        h = min(s.shape[0], BOTTOM)
        fr[BOTTOM - h : BOTTOM, x : x + s.shape[1]] = s[s.shape[0] - h :]
        frames.append(fr)
    dscale = min(scale, MAX_W / death.shape[1])
    d = resize(death, dscale)
    fr = np.zeros((FR, FR, 4), np.uint8)
    x = (FR - d.shape[1]) // 2
    fr[BOTTOM - d.shape[0] : BOTTOM, x : x + d.shape[1]] = d
    frames.append(fr)
    bbox = []
    for f in frames:
        ys, xs = np.where(f[..., 3] > 128)
        bbox.append([int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1])
    # дуло: край спалаху кадру fire ліворуч (натив), y — центр маси крайніх 4 колонок
    fire = frames[3][..., 3] > 128
    edge = int(np.where(fire.any(axis=0))[0].min())
    ys = np.where(fire[:, edge : edge + 4].any(axis=1))[0]
    muzzle = {'x': edge + 2, 'y': int(round(ys.mean()))}
    iou = walk_iou(frames)
    if max(iou) > iou_max:
        raise SystemExit(f'{path.name}: кадри кроку надто схожі (збіг масок {iou} > {iou_max}) — перегенерувати аркуш')
    info = {'scale': round(scale, 4), 'deathScale': round(dscale, 4), 'anchorX': anchor, 'bbox': bbox, 'muzzle': muzzle, 'walkIoU': iou}
    if weapon_check:
        weapon = [weapon_px(f, 'demon') for f in frames]
        if min(weapon[1:4]) < 0.5 * weapon[0]:
            raise SystemExit(f'{path.name}: у кадрі кроку чи вогню немає зброї (пікселі зброї {weapon}) — перегенерувати аркуш')
        info['weaponPx'] = weapon
    return frames, info


def main():
    old = np.asarray(Image.open(OUT).convert('RGBA'))
    if old.shape[0] not in (FR * 2, FR * len(ROWS)):
        raise SystemExit(f'несподіваний розмір чинного атласа: {old.shape}')
    atlas = np.zeros((FR * len(ROWS), FR * 5, 4), np.uint8)
    atlas[:FR] = old[:FR]  # ряд оперативника без змін (Т.134)
    report = {}
    for row, name in enumerate(ROWS[1:], start=1):
        frames, info = build_row(SRC / f't194-{name}-sheet.jpg', name)
        for col, fr in enumerate(frames):
            atlas[row * FR : (row + 1) * FR, col * FR : (col + 1) * FR] = fr
        report[name] = info
    atlas[atlas[..., 3] == 0] = 0
    Image.fromarray(atlas, 'RGBA').save(OUT, optimize=True)
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=1) + '\n')
    print(json.dumps({k: {'muzzle': v['muzzle'], 'walkIoU': v['walkIoU'], 'scale': v['scale']} for k, v in report.items()}, ensure_ascii=False))


if __name__ == '__main__':
    main()
