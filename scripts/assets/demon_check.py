#!/usr/bin/env python3
# Візуальна звірка орієнтації: демон вогонь/смерть — нові листи проти старих сирців.
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

def frame(arr, keep, box, tag, W=72):
    x0,x1,y0,y1 = box
    kw = x1-x0+1; kh = y1-y0+1
    H = max(8, round(W*kh/kw/2))
    print(f'\n--- {tag} {kw}x{kh}')
    for r in range(H):
        yy0 = y0 + r*kh//H; yy1 = y0 + max(yy0+1-y0, (r+1)*kh//H)
        line = ''
        for c in range(W):
            xx0 = x0 + c*kw//W; xx1 = x0 + max(xx0+1-x0, (c+1)*kw//W)
            blk = keep[yy0:yy1, xx0:xx1]
            if not blk.any(): line += '.'; continue
            px = arr[yy0:yy1, xx0:xx1][blk]
            lum = px.mean()
            line += '#' if lum>200 else ('O' if lum>150 else ('o' if lum>100 else ('+' if lum>60 else ':')))
        print(line)

# старий демон: атака і смерть
for nm, box in [('Демон - Атака.png', None), ('Демон - Смерть.png', None)]:
    arr = np.array(Image.open(SRC/nm).convert('RGB'))
    k = keep_mask(arr)
    ys, xs = np.nonzero(k)
    frame(arr, k, (xs.min(), xs.max(), ys.min(), ys.max()), f'СТАРИЙ {nm}')

# нові кадри
arr = np.array(Image.open(SRC/'демон атлас.jpg').convert('RGB'))
k = keep_mask(arr)
frame(arr, k, (154,526,508,825), 'НОВИЙ D-F4 (ПОСТРІЛ)')
frame(arr, k, (673,1158,601,830), 'НОВИЙ D-F5 (смерть)')
# D-C1 повністю
lum = arr.mean(axis=2)
sub = (lum[461:516, 120:248] >= 200)
cols_any = sub.any(axis=0)
segs = []
c = 0
while c < len(cols_any):
    if cols_any[c]:
        a = c
        while c < len(cols_any) and cols_any[c]: c += 1
        segs.append((a, c))
    else:
        c += 1
print('\n--- D-C1 глифів:', len(segs))
for (a,b) in segs:
    g = [ ''.join('#' if v else '.' for v in sub[r][a:b]) for r in range(sub.shape[0]) ]
    while g and set(g[0]) == {'.'}: g.pop(0)
    while g and set(g[-1]) == {'.'}: g.pop()
    for line in g: print(line)
    print()
