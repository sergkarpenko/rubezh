#!/usr/bin/env python3
# Розбір листів «солдат атлас.jpg» / «демон атлас.jpg» (1195x896):
# flood-fill маска (d<=15 + глухі отвори d<=15, П14.3), компоненти,
# кластери кадрів, ASCII-рендер для аналізу композиції.
from collections import deque
from pathlib import Path
from PIL import Image
import numpy as np

ROOT = Path(__file__).resolve().parents[2]  # корінь репозиторію (scripts/assets/ -> ../..)
SRC = ROOT / 'assets-src'  # сирці зображень власника, поза git
ATLAS_FRAME = 96
ATLAS_COLS = 5

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
    keep = ~vis
    # глухі отвори: компоненти фону, недосяжні з країв (d<=th), замикаємо
    inv = vis
    lbl = np.zeros((h,w), dtype=int)
    cur = 0
    holes = np.zeros((h,w), dtype=bool)
    for y in range(h):
        for x in range(w):
            if inv[y,x] and lbl[y,x]==0:
                cur += 1
                q2 = deque([(y,x)]); lbl[y,x]=cur; pts=[]
                while q2:
                    cy,cx = q2.popleft(); pts.append((cy,cx))
                    for ny,nx in ((cy-1,cx),(cy+1,cx),(cy,nx-1) if False else (cy,cx-1),(cy,cx+1)):
                        if 0<=ny<h and 0<=nx<w and inv[ny,nx] and lbl[ny,nx]==0:
                            lbl[ny,nx]=cur; q2.append((ny,nx))
                area = len(pts)
                if area <= 40000:  # глухі отвори — невеликі
                    for (py,px) in pts: holes[py,px]=True
    keep = keep | holes
    return keep, bg

def components(mask, min_area=1500):
    h, w = mask.shape
    lbl = np.zeros((h,w), dtype=int)
    out = []
    cur = 0
    for y in range(h):
        for x in range(w):
            if mask[y,x] and lbl[y,x]==0:
                cur += 1
                q = deque([(y,x)]); lbl[y,x]=cur; pts=[]
                while q:
                    cy,cx = q.popleft(); pts.append((cy,cx))
                    for ny,nx in ((cy-1,cx),(cy+1,cx),(cy,cx-1),(cy,cx+1)):
                        if 0<=ny<h and 0<=nx<w and mask[ny,nx] and lbl[ny,nx]==0:
                            lbl[ny,nx]=cur; q.append((ny,nx))
                if len(pts) >= min_area:
                    ys = [p[0] for p in pts]; xs = [p[1] for p in pts]
                    out.append({'area': len(pts), 'x0': min(xs), 'x1': max(xs),
                                'y0': min(ys), 'y1': max(ys), 'pts': pts, 'id': cur})
    return out, lbl

def ascii_render(arr, keep, box, W=64, H=30):
    x0,x1,y0,y1 = box
    sub_k = keep[y0:y1+1, x0:x1+1]
    sub_a = arr[y0:y1+1, x0:x1+1]
    kh, kw = sub_k.shape
    # nearest-neighbor даунскейл
    rows = []
    for r in range(H):
        yy0 = r*kh//H; yy1 = max(yy0+1, (r+1)*kh//H)
        line = ''
        for c in range(W):
            xx0 = c*kw//W; xx1 = max(xx0+1, (c+1)*kw//W)
            blk = sub_k[yy0:yy1, xx0:xx1]
            if not blk.any():
                line += '.'
                continue
            px = sub_a[yy0:yy1, xx0:xx1][blk]
            lum = px.mean()
            sat = (px.max(axis=0) - px.min(axis=0)).mean()
            ch = '#' if lum > 200 else ('O' if lum > 150 else ('o' if lum > 100 else ('+' if lum > 60 else ':')))
            line += ch
        rows.append(line)
    return '\n'.join(rows)

for name in ['солдат атлас.jpg', 'демон атлас.jpg']:
    arr = np.array(Image.open(SRC/name).convert('RGB'))
    keep, bg = keep_mask(arr)
    print(f'\n##### {name} bg=({bg[0]:.0f},{bg[1]:.0f},{bg[2]:.0f}) keep={keep.sum()} ({100*keep.mean():.1f}%)')
    comps, _ = components(keep, min_area=1500)
    comps.sort(key=lambda c: -c['area'])
    for c in comps[:12]:
        w = c['x1']-c['x0']+1; h = c['y1']-c['y0']+1
        print(f"  comp id={c['id']} area={c['area']} bbox x[{c['x0']}..{c['x1']}] y[{c['y0']}..{c['y1']}] {w}x{h} dens={100*c['area']/(w*h):.0f}%")
