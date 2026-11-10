#!/usr/bin/env python3
# Аналіз сирців юнітів: розміри, тло (кути), маска flood-fill, кластери.
# Сирці поза git (assets-src/), чисельний звіт у сесію.
import sys
from pathlib import Path
from PIL import Image
import numpy as np

ROOT = Path(__file__).resolve().parents[2]  # корінь репозиторію (scripts/assets/ -> ../..)
SRC = ROOT / 'assets-src'  # сирці зображень власника, поза git

FILES = [
    'Солдат - Стій (idle).jpg',
    'Солдат - Хода кадр 1.png',
    'Солдат - Хода кадр 2.png',
    'Солдат - Атака.png',
    'Солдат - Смерть.png',
    'Демон - Стій (idle).jpg',
    'Демон - Хода кадр 1.png',
    'Демон - Хода кадр 2.png',
    'Демон - Атака.png',
    'Демон - Смерть.png',
    'солдат атлас.jpg',
    'демон атлас.jpg',
]

def chess(a, b):
    return np.max(np.abs(a.astype(int) - b.astype(int)), axis=-1)

def corner_bg(arr):
    h, w = arr.shape[:2]
    corners = np.stack([
        arr[0, 0], arr[0, w-1], arr[h-1, 0], arr[h-1, w-1],
        arr[0, w//2], arr[h-1, w//2],
    ])
    return np.median(corners, axis=0)

def flood_mask(arr, thresh):
    # flood-fill від країв за chess-відстанню до кольору тла (контекстний поріг)
    h, w = arr.shape[:2]
    bg = corner_bg(arr)
    d = chess(arr, bg)
    close = d <= thresh
    from collections import deque
    visited = np.zeros((h, w), dtype=bool)
    q = deque()
    for x in range(w):
        for y in (0, h-1):
            if close[y, x] and not visited[y, x]:
                visited[y, x] = True; q.append((y, x))
    for y in range(h):
        for x in (0, w-1):
            if close[y, x] and not visited[y, x]:
                visited[y, x] = True; q.append((y, x))
    while q:
        y, x = q.popleft()
        for ny, nx in ((y-1,x),(y+1,x),(y,x-1),(y,x+1)):
            if 0 <= ny < h and 0 <= nx < w and close[ny, nx] and not visited[ny, nx]:
                visited[ny, nx] = True; q.append((ny, nx))
    return visited, bg

for name in FILES:
    p = SRC / name
    img = Image.open(p)
    arr = np.array(img.convert('RGB'))
    h, w = arr.shape[:2]
    bg = corner_bg(arr)
    print(f'\n=== {name}: {w}x{h}, mode={img.mode}, bg(медіана кутів)=({bg[0]:.0f},{bg[1]:.0f},{bg[2]:.0f})')
    # поріг: чинний П14.3 d<=15 та м'якший d<=40 для порівняння
    for th in (15, 40):
        vis, _ = flood_mask(arr, th)
        keep = ~vis
        ys, xs = np.nonzero(keep)
        if len(ys) == 0:
            print(f'  d<={th}: маска порожня')
            continue
        n = len(ys)
        print(f'  d<={th}: непрозорих {n} ({100.0*n/(h*w):.1f}%), bbox x[{xs.min()}..{xs.max()}] y[{ys.min()}..{ys.max()}], '
              f'щільність bbox {100.0*n/((xs.max()-xs.min()+1)*(ys.max()-ys.min()+1)):.1f}%')
