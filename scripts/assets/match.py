#!/usr/bin/env python3
# Повна звірка: 10 нових кадрів (листи) проти 10 старих окремих файлів (відомі пози і
# напрямки: солдат вправо, демон вліво). IoU прямий vs дзеркальний після нормалізації bbox.
from collections import deque
from pathlib import Path
from PIL import Image
import numpy as np

ROOT = Path(__file__).resolve().parents[2]  # корінь репозиторію (scripts/assets/ -> ../..)
SRC = ROOT / 'assets-src'  # сирці зображень власника, поза git

def chess(a, b):
    return np.max(np.abs(a.astype(int) - b.astype(int)), axis=-1)

def keep_mask(arr, th=15, max_hole=40000):
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
    keep = ~vis
    lbl = np.zeros((h,w), dtype=int); cur = 0
    for y in range(h):
        for x in range(w):
            if vis[y,x] and lbl[y,x]==0:
                cur += 1
                q2 = deque([(y,x)]); lbl[y,x]=cur; pts=[]
                while q2:
                    cy,cx = q2.popleft(); pts.append((cy,cx))
                    for ny,nx in ((cy-1,cx),(cy+1,cx),(cy,cx-1),(cy,cx+1)):
                        if 0<=ny<h and 0<=nx<w and vis[ny,nx] and lbl[ny,nx]==0:
                            lbl[ny,nx]=cur; q2.append((ny,nx))
                if len(pts) <= max_hole:
                    for (py,px) in pts: keep[py,px]=True
    return keep

def norm_mask(mask, size=64):
    ys, xs = np.nonzero(mask)
    m = mask[ys.min():ys.max()+1, xs.min():xs.max()+1]
    im = Image.fromarray((m*255).astype(np.uint8)).resize((size,size), Image.NEAREST)
    return np.array(im) > 127

def iou(a, b):
    return (a & b).sum() / max(1, (a | b).sum())

NEW = {
 'солдат атлас.jpg': {
   'idle': (75,283,85,469), 'walk1': (340,547,88,462), 'walk2': (589,795,86,464),
   'fire': (852,1179,86,469), 'death': (556,961,643,823)},
 'демон атлас.jpg': {
   'idle': (50,369,128,471), 'walk1': (455,759,125,449), 'walk2': (840,1157,127,382),
   'fire': (154,526,508,825), 'death': (673,1158,601,830)},
}
OLD = {
 'солдат атлас.jpg': {
   'idle': 'Солдат - Стій (idle).jpg', 'walk1': 'Солдат - Хода кадр 1.png', 'walk2': 'Солдат - Хода кадр 2.png',
   'fire': 'Солдат - Атака.png', 'death': 'Солдат - Смерть.png'},
 'демон атлас.jpg': {
   'idle': 'Демон - Стій (idle).jpg', 'walk1': 'Демон - Хода кадр 1.png', 'walk2': 'Демон - Хода кадр 2.png',
   'fire': 'Демон - Атака.png', 'death': 'Демон - Смерть.png'},
}

sheets = {n: np.array(Image.open(SRC/n).convert('RGB')) for n in NEW}
for sheet, frames in NEW.items():
    arr = sheets[sheet]
    keep = keep_mask(arr)
    print(f'\n##### {sheet}')
    for pose, (x0,x1,y0,y1) in frames.items():
        nm = norm_mask(keep[y0:y1+1, x0:x1+1])
        oarr = np.array(Image.open(SRC/OLD[sheet][pose]).convert('RGB'))
        ok = keep_mask(oarr)
        om = norm_mask(ok)
        d, m = iou(nm, om), iou(nm, om[:, ::-1])
        verdict = 'ПРЯМО (натив)' if d >= m else 'ДЗЕРКАЛО'
        print(f'  {pose}: IoU прямий {d:.3f} / дзеркальний {m:.3f} -> {verdict}')
