#!/usr/bin/env python3
# Напрямок погляду демона: (1) вогонь-кадр високим розділом; (2) асиметрія маси/сяйва
# по кадрах; (3) IoU нового idle проти старого (відомо: натив вліво) прямого і дзеркального.
from collections import deque
from pathlib import Path
from PIL import Image
import numpy as np

ROOT = Path(__file__).resolve().parents[2]  # корінь репозиторію (scripts/assets/ -> ../..)
SRC = ROOT / 'assets-src'  # сирці зображень власника, поза git

def chess(a, b):
    return np.max(np.abs(a.astype(int) - b.astype(int)), axis=-1)

def keep_mask(arr, th=15, fill_holes=True, max_hole=40000):
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
    if fill_holes:
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
    return keep, bg

def norm_mask(mask, size=64):
    ys, xs = np.nonzero(mask)
    m = mask[ys.min():ys.max()+1, xs.min():xs.max()+1]
    im = Image.fromarray((m*255).astype(np.uint8)).resize((size,size), Image.NEAREST)
    return np.array(im) > 127

def iou(a, b):
    return (a & b).sum() / max(1, (a | b).sum())

# старий демон idle — еталон напрямку (натив вліво за П14.3)
old = np.array(Image.open(SRC/'Демон - Стій (idle).jpg').convert('RGB'))
ok, _ = keep_mask(old)
old_idle = norm_mask(ok)
old_idle_m = old_idle[:, ::-1]

new = np.array(Image.open(SRC/'демон атлас.jpg').convert('RGB'))
nk, nbg = keep_mask(new)

FR = {'D-F1 idle': (50,369,128,471), 'D-F2 крок1': (455,759,125,449), 'D-F3 крок2': (840,1157,127,382),
      'D-F4 вогонь?': (154,526,508,825), 'D-F5 смерть?': (673,1158,601,830)}
print('демон атлас: асиметрія та IoU проти старого idle (вліво)')
for tag, (x0,x1,y0,y1) in FR.items():
    sub = nk[y0:y1+1, x0:x1+1]
    ys, xs = np.nonzero(sub)
    cx = (xs.min()+xs.max())/2
    # маса: частка пікселів ліворуч/праворуч від центру bbox
    left_mass = (xs < cx).mean(); right_mass = (xs > cx).mean()
    lum = new[y0:y1+1, x0:x1+1].mean(axis=2)
    gl = lum >= np.percentile(lum[sub], 90)
    gys, gxs = np.nonzero(gl & sub)
    gcx = (gxs.min()+gxs.max())/2
    left_glow = (gxs < gcx).mean(); right_glow = (gxs > gcx).mean()
    nm = norm_mask(sub)
    print(f'{tag}: маса L/R {left_mass:.2f}/{right_mass:.2f}, сяйво L/R {left_glow:.2f}/{right_glow:.2f}, '
          f'Iou-прямо {iou(nm, old_idle):.3f}, IoU-дзеркало {iou(nm, old_idle_m):.3f}')

# вогонь-кадр демона: де спалах відносно фігури
sub = nk[508:826, 154:527]
lum = new[508:826, 154:527].mean(axis=2)
gl = lum >= np.percentile(lum[sub], 92)
print('\nD-F4: топ-5 яскравих зон (центроїди сяйва у відсотках ширини кадру):')
gys, gxs = np.nonzero(gl & sub)
print(f'  всі сяйва: x-центроїд {100*gxs.mean()/sub.shape[1]:.0f}% ширини, min {100*gxs.min()/sub.shape[1]:.0f}% max {100*gxs.max()/sub.shape[1]:.0f}%')
mass_x = np.nonzero(sub.any(axis=0))[0]
print(f'  маса кадру: x[{mass_x.min()}..{mass_x.max()}] з {sub.shape[1]}')

# те саме для солдата (контроль методу: має вийти вправо)
sold = np.array(Image.open(SRC/'солдат атлас.jpg').convert('RGB'))
sk, _ = keep_mask(sold)
sub = sk[86:470, 852:1180]
lum = sold[86:470, 852:1180].mean(axis=2)
gl = lum >= np.percentile(lum[sub], 92)
gys, gxs = np.nonzero(gl & sub)
print(f'\nS-F4 (вогонь солдата): сяйво x-центроїд {100*gxs.mean()/sub.shape[1]:.0f}%, min {100*gxs.min()/sub.shape[1]:.0f}% max {100*gxs.max()/sub.shape[1]:.0f}%')
