#!/usr/bin/env python3
# Т.135: аркуш тайлів терену Gemini «мальований» стиль -> assets/metro-tiles.png 192x48
# (тайли 48x48: кол. 0 стіна, 1 пляма світла, 2 решітка, 3 уламки — геометрія атласа і
# розклад METRO_* у src/render.ts без змін).
# Сирець — assets-src/t135-terrain-sheet.jpg (поза git): один ряд із 4 об'єктів на хромакеї
# #00FF00 (довкола кожного Gemini лишає квадрат темнішого зеленого — його теж знімає матування).
# Матування і зменшення — ті самі, що в атласі бійців (convert_units_t133.py, ADR-0122):
# плавна альфа за «зеленістю», LANCZOS по премножених каналах, без зеленого відблиску.
# Стіна (¾ згори: верх і передня грань) заповнює клітинку повністю; декори — пласкі деталі
# підлоги, по центру клітинки (стіна — непрозора, край на темній основі WALL_BASE), розмір — DECOR_PX; пляма світла — лампа + м'який бурштиновий
# ореол кодом (генератор ореол на хромакеї не дає — просили без нього).
from pathlib import Path
import json
import sys

import numpy as np
from PIL import Image

from convert_units_t133 import matte, resize, split_figures

ROOT = Path(__file__).resolve().parents[2]
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'assets-src'
OUT = ROOT / 'assets/metro-tiles.png'
REPORT = Path(__file__).resolve().parent / 'terrain-t135-report.json'

T = 48
DECOR_PX = {'світло': 18, 'решітка': 30, 'уламки': 44}  # більша сторона декору, px
HALO = (255, 179, 71)  # бурштин #FFB347
HALO_R, HALO_A = 20.0, 0.32  # радіус і найбільша непрозорість ореолу плями світла
GREEN_MAX = 8  # g - max(r, b) пікселів об'єкта з альфою > 0 (до накладання на ореол) — понад це зелений відблиск
WALL_BASE = (20, 26, 34)  # аудит Т.135: напівпрозорий край стіни давав шви — край кладемо на темну основу, стіна непрозора


def fit(fig, side):
    h, w = fig.shape[:2]
    return resize(fig, side / max(h, w))


def place(tile, s):
    h, w = s.shape[:2]
    y, x = (T - h) // 2, (T - w) // 2
    a = s[..., 3:4] / 255.0
    region = tile[y : y + h, x : x + w].astype(np.float32)
    ra = region[..., 3:4] / 255.0
    out_a = a + ra * (1 - a)
    rgb = (s[..., :3] * a + region[..., :3] * ra * (1 - a)) / np.maximum(out_a, 1e-6)
    tile[y : y + h, x : x + w] = np.dstack([rgb, out_a * 255]).clip(0, 255).astype(np.uint8)


def halo():
    yy, xx = np.mgrid[0:T, 0:T].astype(np.float32) + 0.5
    d = np.hypot(xx - T / 2, yy - T / 2) / HALO_R
    a = np.clip(1 - d, 0, 1) ** 2 * HALO_A
    t = np.zeros((T, T, 4), np.uint8)
    t[..., :3] = HALO
    t[..., 3] = (a * 255).astype(np.uint8)
    return t


def main():
    figs = split_figures(matte(SRC / 't135-terrain-sheet.jpg'), parts=4)
    wall, lamp, grate, wreck = figs
    tiles = []
    # стіна: уся клітинка (крок ресайзу окремо по осях — сирець майже квадратний)
    h, w = wall.shape[:2]
    a = wall[..., 3:4] / 255.0
    pre = np.dstack([wall[..., :3] * a, wall[..., 3:4]]).clip(0, 255).astype(np.uint8)
    small = np.asarray(Image.fromarray(pre, 'RGBA').resize((T, T), Image.LANCZOS)).astype(np.float32)
    sa = small[..., 3:4] / 255.0
    rgb = np.where(sa > 0, small[..., :3] / np.maximum(sa, 1e-6), 0)
    rgb[..., 1] = np.minimum(rgb[..., 1], np.maximum(rgb[..., 0], rgb[..., 2]))
    wall_t = np.dstack([rgb, small[..., 3:4]]).clip(0, 255).astype(np.uint8)
    sprites = [wall_t] + [fit(f, DECOR_PX[k]) for f, k in ((lamp, 'світло'), (grate, 'решітка'), (wreck, 'уламки'))]
    green = []
    for i, sp in enumerate(sprites):
        g = sp[..., 1].astype(int) - np.maximum(sp[..., 0], sp[..., 2]).astype(int)
        green.append(int(g[sp[..., 3] > 0].max()))
        if green[-1] > GREEN_MAX:
            raise SystemExit(f'тайл {i}: зелений відблиск {green[-1]} > {GREEN_MAX} — перевірити матування')
    base = np.zeros((T, T, 4), np.uint8)
    base[..., :3], base[..., 3] = WALL_BASE, 255
    place(base, wall_t)
    tiles.append(base)
    light = halo()
    place(light, sprites[1])
    tiles.append(light)
    for sp in sprites[2:]:
        t = np.zeros((T, T, 4), np.uint8)
        place(t, sp)
        tiles.append(t)
    atlas = np.concatenate(tiles, axis=1)
    atlas[atlas[..., 3] == 0] = 0
    report = {'srcFigureWH': [[int(f.shape[1]), int(f.shape[0])] for f in figs], 'tiles': []}
    for i, t in enumerate(tiles):
        op = t[..., 3] > 128
        ys, xs = np.where(op)
        info = {
            'col': i,
            'bbox': [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1],
            'opaque': round(float(op.mean()), 3),
            'greenMax': green[i],
        }
        report['tiles'].append(info)
    if report['tiles'][0]['opaque'] < 0.9:
        raise SystemExit(f'стіна займає {report["tiles"][0]["opaque"]} клітинки (< 0,9) — блок має заповнювати клітинку')
    Image.fromarray(atlas, 'RGBA').save(OUT, optimize=True)
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=1) + '\n')
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    main()
