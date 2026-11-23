#!/usr/bin/env python3
# Т.133 (ADR-0122): аркуші Gemini «мальований» стиль -> assets/units-atlas.png 480x192
# (кадр 96x96, сітка 5x2: idle, walk1, walk2, fire, death; ряд 0 — оперативник, ряд 1 — демон).
# Сирці — assets-src/t133-soldier-sheet.jpg і assets-src/t133-demon-sheet.jpg (поза git):
# один ряд із 5 фігур на хромакеї #00FF00, 1376x768, JPEG.
# Відмінності від convert_units.py (П14.3): фігури не піксель-арт, тому альфа плавна
# (матування за «зеленістю» g - max(r, b)), зменшення — LANCZOS по премножених каналах,
# зелений відблиск на краях прибирається (g <= max(r, b)) до і після зменшення.
# Геометрія атласа не змінюється (ADR-0121): фігура стоячих кадрів — рядки 34..92,
# ноги — рядок 92 (ATLAS_FEET_ROW = 93 — перший рядок під ногами), якір x спільний для ряду.
from pathlib import Path
import json
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[2]
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'assets-src'
OUT = ROOT / 'assets/units-atlas.png'
REPORT = Path(__file__).resolve().parent / 'units-t133-report.json'

FR = 96
TOP, BOTTOM = 34, 93  # фігура стоячого кадру: рядки TOP..BOTTOM-1
BODY_H = BOTTOM - TOP
MAX_W = 94  # найширший кадр — з полем 1 px з боків
K0, K1 = 20.0, 90.0  # «зеленість»: <= K0 — фігура, >= K1 — тло


def matte(path):
    rgb = np.asarray(Image.open(path).convert('RGB')).astype(np.float32)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    green = g - np.maximum(r, b)
    alpha = np.clip((K1 - green) / (K1 - K0), 0.0, 1.0)
    g2 = np.minimum(g, np.maximum(r, b))  # без зеленого відблиску
    out = np.dstack([r, g2, b, alpha * 255.0])
    return out


def split_figures(img, parts=5, grow=9):
    # Фігури перекриваються по колонках (спалах кадру fire над лежачим), тому ділимо
    # зв'язними компонентами розширеної маски: гвинтівка поруч із лежачим і спалах
    # лишаються зі своєю фігурою; дрібне (водяний знак) відпадає.
    mask = img[..., 3] > 128
    lbl, n = ndimage.label(ndimage.binary_dilation(mask, iterations=grow))
    sizes = ndimage.sum(mask, lbl, range(1, n + 1))
    keep = sorted(np.argsort(sizes)[-parts:] + 1, key=lambda k: ndimage.center_of_mass(lbl == k)[1])
    if len(keep) != parts:
        raise SystemExit(f'очікував {parts} фігур, знайшов {len(keep)}')
    figs = []
    for k in keep:
        own = lbl == k
        ys, xs = np.where(own & mask)
        fig = img[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1].copy()
        fig[..., 3] *= own[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1]
        figs.append(fig)
    return figs


def resize(fig, scale):
    h, w = fig.shape[:2]
    nw, nh = max(1, round(w * scale)), max(1, round(h * scale))
    a = fig[..., 3:4] / 255.0
    pre = np.dstack([fig[..., :3] * a, fig[..., 3:4]]).clip(0, 255).astype(np.uint8)
    small = np.asarray(Image.fromarray(pre, 'RGBA').resize((nw, nh), Image.LANCZOS)).astype(np.float32)
    sa = small[..., 3:4] / 255.0
    rgb = np.where(sa > 0, small[..., :3] / np.maximum(sa, 1e-6), 0)
    # LANCZOS і ділення на малу альфу повертають зелений на краях — прибираємо ще раз
    rgb[..., 1] = np.minimum(rgb[..., 1], np.maximum(rgb[..., 0], rgb[..., 2]))
    return np.dstack([rgb, small[..., 3:4]]).clip(0, 255).astype(np.uint8)


def feet_x(fig):
    h = fig.shape[0]
    band = fig[int(h * 0.85) :, :, 3].astype(np.float32)
    xs = np.arange(band.shape[1], dtype=np.float32)
    return float((band.sum(axis=0) * xs).sum() / band.sum())


def build_row(path, facing, mirror):
    img = matte(path)
    figs = split_figures(img)
    if mirror:  # аркуш демона Gemini намалював обличчям праворуч усупереч промпту; натив демона — ліворуч
        figs = [f[:, ::-1].copy() for f in figs]
    stand, death = figs[:4], figs[4]
    scale = BODY_H / stand[0].shape[0]  # інваріант — висота idle
    widest = max(f.shape[1] for f in stand) * scale
    if widest > MAX_W:
        scale *= MAX_W / widest
    small = [resize(f, scale) for f in stand]
    # спільний якір x: ступні кожного кадру — в одній колонці, найширший кадр у межах 96
    fx = [feet_x(s) for s in small]
    lo = max(fx[i] for i in range(4))  # найбільший виступ ліворуч від ступнів
    hi = max(small[i].shape[1] - fx[i] for i in range(4))
    anchor = round(min(max(48, lo + 1), FR - 1 - hi)) if lo + hi + 2 <= FR else round(lo + 1)
    frames, info = [], []
    for s, f in zip(small, fx):
        fr = np.zeros((FR, FR, 4), np.uint8)
        x = int(round(anchor - f))
        x = min(max(x, 0), FR - s.shape[1])
        y = BOTTOM - s.shape[0]
        fr[y : y + s.shape[0], x : x + s.shape[1]] = s
        frames.append(fr)
    dscale = min(scale, MAX_W / death.shape[1])
    d = resize(death, dscale)
    fr = np.zeros((FR, FR, 4), np.uint8)
    x = (FR - d.shape[1]) // 2
    fr[BOTTOM - d.shape[0] : BOTTOM, x : x + d.shape[1]] = d
    frames.append(fr)
    for fr in frames:
        ys, xs = np.where(fr[..., 3] > 128)
        info.append([int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1])
    # дуло: край спалаху кадру fire з боку погляду (2 px углиб), y — центр маси крайніх 4 колонок
    fire = frames[3][..., 3] > 128
    xs = np.where(fire.any(axis=0))[0]
    edge = xs.max() if facing > 0 else xs.min()
    cols = slice(edge - 3, edge + 1) if facing > 0 else slice(edge, edge + 4)
    ys = np.where(fire[:, cols].any(axis=1))[0]
    muzzle = {'x': int(edge - 2 * facing), 'y': int(round(ys.mean()))}
    return frames, {'scale': round(scale, 4), 'deathScale': round(dscale, 4), 'anchorX': anchor, 'bbox': info, 'muzzle': muzzle}


def main():
    atlas = np.zeros((FR * 2, FR * 5, 4), np.uint8)
    report = {}
    for row, (name, facing, mirror) in enumerate((('soldier', 1, False), ('demon', -1, True))):
        frames, info = build_row(SRC / f't133-{name}-sheet.jpg', facing, mirror)
        for col, fr in enumerate(frames):
            atlas[row * FR : (row + 1) * FR, col * FR : (col + 1) * FR] = fr
        report[name] = info
    atlas[atlas[..., 3] == 0] = 0
    Image.fromarray(atlas, 'RGBA').save(OUT, optimize=True)
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=1) + '\n')
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    main()
