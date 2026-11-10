#!/usr/bin/env python3
# ASCII-рендер кадрів (поза, напрямок) та підписів (піксельний розділ) з листів.
from collections import deque
from pathlib import Path
from PIL import Image
import numpy as np

ROOT = Path(__file__).resolve().parents[2]  # корінь репозиторію (scripts/assets/ -> ../..)
SRC = ROOT / 'assets-src'  # сирці зображень власника, поза git

def chess(a, b):
    return np.max(np.abs(a.astype(int) - b.astype(int)), axis=-1)

def keep_mask(arr, th=15):
    h, w = arr.shape[:2]
    corners = np.stack([arr[0,0], arr[0,w-1], arr[h-1,0], arr[h-1,w-1],
                        arr[0,w//2], arr[h-1,w//2], arr[h//2,0], arr[h//2,w-1]])
    bg = np.median(corners, axis=0)
    d = chess(arr, bg)
    close = d <= th
    vis = np.zeros((h, w), dtype=bool)
    q = deque()
    for x in range(w):
        for y in (0, h-1):
            if close[y,x] and not vis[y,x]: vis[y,x]=True; q.append((y,x))
    for y in range(h):
        for x in (0, w-1):
            if close[y,x] and not vis[y,x]: vis[y,x]=True; q.append((y,x))
    while q:
        y,x = q.popleft()
        for ny,nx in ((y-1,x),(y+1,x),(y,x-1),(y,x+1)):
            if 0<=ny<h and 0<=nx<w and close[ny,nx] and not vis[ny,nx]:
                vis[ny,nx]=True; q.append((ny,nx))
    return ~vis, bg

def ascii_frame(arr, keep, box, W=56):
    x0,x1,y0,y1 = box
    kw = x1-x0+1; kh = y1-y0+1
    H = max(8, round(W*kh/kw/2))  # символи ~2:1
    rows = []
    for r in range(H):
        yy0 = y0 + r*kh//H; yy1 = y0 + max(yy0+1-y0, (r+1)*kh//H)
        line = ''
        for c in range(W):
            xx0 = x0 + c*kw//W; xx1 = x0 + max(xx0+1-x0, (c+1)*kw//W)
            blk = keep[yy0:yy1, xx0:xx1]
            if not blk.any():
                line += '.'; continue
            px = arr[yy0:yy1, xx0:xx1][blk]
            lum = px.mean()
            ch = '#' if lum > 200 else ('O' if lum > 150 else ('o' if lum > 100 else ('+' if lum > 60 else ':')))
            line += ch
        rows.append(line)
    return '\n'.join(rows)

def ascii_caption(arr, keep, box):
    # підпис: піксельний розділ, поріг яскравості (текст яскравий на темному тлі)
    x0,x1,y0,y1 = box
    lum = arr[y0:y1+1, x0:x1+1].mean(axis=2)
    k = keep[y0:y1+1, x0:x1+1]
    out = []
    for r in range(lum.shape[0]):
        line = ''
        for c in range(lum.shape[1]):
            if k[r,c] and lum[r,c] > 110: line += '#'
            elif k[r,c]: line += 'o'
            else: line += '.'
        out.append(line)
    return '\n'.join(out)

FRAMES = {
 'солдат атлас.jpg': [
   ('F1', (75,283,85,469)), ('F2', (340,547,88,462)), ('F3', (589,795,86,464)),
   ('F4', (852,1179,86,469)), ('F5', (556,961,643,823)),
 ],
 'демон атлас.jpg': [
   ('F1', (50,369,128,471)), ('F2', (455,759,125,449)), ('F3', (840,1157,127,382)),
   ('F4', (154,526,508,825)), ('F5', (673,1158,601,830)),
 ],
}
CAPS = {
 'солдат атлас.jpg': [
   ('C1', (100,231,486,531)), ('C2', (342,485,486,531)), ('C3', (598,741,486,531)),
   ('C4', (853,1075,486,531)), ('C5', (628,863,827,873)),
 ],
 'демон атлас.jpg': [
   ('C1', (124,242,465,514)), ('C2', (507,634,465,514)), ('C3', (875,1002,465,514)),
   ('C4', (198,394,828,876)), ('C5', (780,979,828,876)),
 ],
}

for name in FRAMES:
    arr = np.array(Image.open(SRC/name).convert('RGB'))
    keep, bg = keep_mask(arr)
    print(f'\n################ {name}')
    for tag, box in FRAMES[name]:
        x0,x1,y0,y1 = box
        w = x1-x0+1; h = y1-y0+1
        m = keep[y0:y1+1, x0:x1+1]
        print(f'\n--- {tag} bbox x[{x0}..{x1}] y[{y0}..{y1}] {w}x{h} dens={100*m.mean():.0f}%')
        print(ascii_frame(arr, keep, box))
    for tag, box in CAPS[name]:
        print(f'\n--- підпис {tag}')
        print(ascii_caption(arr, keep, box))
