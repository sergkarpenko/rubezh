#!/usr/bin/env python3
# Піксельний ASCII підписи + кадри демона.
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

def cap_1to1(arr, keep, box, tag):
    x0,x1,y0,y1 = box
    lum = arr[y0:y1+1, x0:x1+1].mean(axis=2)
    k = keep[y0:y1+1, x0:x1+1]
    print(f'\n--- {tag} ({x1-x0+1}x{y1-y0+1})')
    for r in range(lum.shape[0]):
        line = ''
        for c in range(lum.shape[1]):
            if not k[r,c]: line += '.'
            else:
                l = lum[r,c]
                line += '#' if l>170 else ('+' if l>110 else 'o')
        print(line)

def frame(arr, keep, box, tag, W=64):
    x0,x1,y0,y1 = box
    kw = x1-x0+1; kh = y1-y0+1
    H = max(8, round(W*kh/kw/2))
    print(f'\n--- {tag} bbox x[{x0}..{x1}] y[{y0}..{y1}] {kw}x{kh}')
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

name = 'демон атлас.jpg'
arr = np.array(Image.open(SRC/name).convert('RGB'))
keep, bg = keep_mask(arr)
print(f'##### {name} bg=({bg[0]:.0f},{bg[1]:.0f},{bg[2]:.0f})')
frame(arr, keep, (50,369,128,471), 'D-F1')
frame(arr, keep, (455,759,125,449), 'D-F2')
frame(arr, keep, (840,1157,127,382), 'D-F3 (верх)')
frame(arr, keep, (840,926,376,454), 'D-F3b (низ, відірваний комп)')
frame(arr, keep, (154,526,508,825), 'D-F4')
frame(arr, keep, (673,1158,601,830), 'D-F5')
for tag, box in [('C1',(135,231,469,510)),('C2',(518,623,469,510)),('C3',(886,991,469,508)),
                 ('C4',(209,383,832,872)),('C5',(791,968,832,872))]:
    cap_1to1(arr, keep, box, tag)
