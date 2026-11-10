#!/usr/bin/env python3
# Геометрія чинного атласа + дрейф масштабу нових сирців (оптимум IoU відносно idle).
from collections import deque
from pathlib import Path
from PIL import Image
import numpy as np

ROOT = Path(__file__).resolve().parents[2]  # корінь репозиторію (scripts/assets/ -> ../..)
SRC = ROOT / 'assets-src'  # сирці зображень власника, поза git

# --- 1. Чинний атлас: геометрія кадрів ---
cur = np.array(Image.open(ROOT/'assets/units-atlas.png').convert('RGBA'))
alpha = cur[..., 3] > 127
print('ЧИННИЙ АТЛАС:', cur.shape[1], 'x', cur.shape[0])
for row, who in ((0, 'солдат'), (1, 'демон')):
    for col, pose in ((0,'idle'),(1,'walk1'),(2,'walk2'),(3,'fire'),(4,'death')):
        f = alpha[row*96:(row+1)*96, col*96:(col+1)*96]
        ys, xs = np.nonzero(f)
        if len(ys) == 0:
            print(f'  {who} {pose}: порожній'); continue
        print(f'  {who} {pose}: y[{ys.min()}..{ys.max()}] h={ys.max()-ys.min()+1}, '
              f'медіана x={int(np.median(xs))}, x[{xs.min()}..{xs.max()}], пікс={len(ys)}, '
              f'щільність bbox {100*len(ys)/((ys.max()-ys.min()+1)*(xs.max()-xs.min()+1)):.0f}%')

# --- 2. Дрейф масштабу нових сирців ---
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
    lbl = np.zeros((h,w), dtype=int); cur2 = 0
    for y in range(h):
        for x in range(w):
            if vis[y,x] and lbl[y,x]==0:
                cur2 += 1
                q2 = deque([(y,x)]); lbl[y,x]=cur2; pts=[]
                while q2:
                    cy,cx = q2.popleft(); pts.append((cy,cx))
                    for ny,nx in ((cy-1,cx),(cy+1,cx),(cy,cx-1),(cy,cx+1)):
                        if 0<=ny<h and 0<=nx<w and vis[ny,nx] and lbl[ny,nx]==0:
                            lbl[ny,nx]=cur2; q2.append((ny,nx))
                if len(pts) <= max_hole:
                    for (py,px) in pts: keep[py,px]=True
    return keep

def frame_mask(sheet_keep, box, flip=False, exclude=()):
    x0,x1,y0,y1 = box
    m = sheet_keep[y0:y1+1, x0:x1+1].copy()
    for (ex0,ex1,ey0,ey1) in exclude:
        m[max(0,ey0-y0):ey1-y0+1, max(0,ex0-x0):ex1-x0+1] = False
    if flip: m = m[:, ::-1]
    return m

def scaled(m, s):
    h, w = m.shape
    im = Image.fromarray((m*255).astype(np.uint8))
    return np.array(im.resize((max(1, round(w*s)), max(1, round(h*s))), Image.NEAREST)) > 127

def iou_at_scale(m_idle, m_pose, s):
    # канва 1: idle; канва 2: pose*scale; вирівнювання: низ маски + медіана x
    H = max(m_idle.shape[0], round(m_pose.shape[0]*s)) + 4
    Wd = max(m_idle.shape[1], round(m_pose.shape[1]*s)) + 8
    def put(m, anchor_x):
        ys, xs = np.nonzero(m)
        c = np.zeros((H, Wd), dtype=bool)
        xoff = anchor_x - int(np.median(xs))
        yoff = H - 1 - ys.max()
        y0, y1 = max(0, yoff), min(H, yoff + m.shape[0])
        x0, x1 = max(0, xoff), min(Wd, xoff + m.shape[1])
        c[y0:y1, x0:x1] |= m[y0-yoff:y1-yoff, x0-xoff:x1-xoff]
        return c
    ai = Wd // 2
    a = put(m_idle, ai)
    ms = scaled(m_pose, s)
    b = put(ms, ai)
    return (a & b).sum() / max(1, (a | b).sum())

NEW = {
 'солдат атлас.jpg': {'idle': (75,283,85,469), 'walk1': (340,547,88,462), 'walk2': (589,795,86,464),
                      'fire': (852,1179,86,469), 'death': (556,961,643,823)},
 'демон атлас.jpg': {'idle': (50,369,128,471), 'walk1': (455,759,125,449), 'walk2': (840,1157,127,382),
                     'fire': (154,526,508,825), 'death': (673,1158,601,830)},
}
EXCL = {
 'демон атлас.jpg': [(135,231,469,510), (518,623,469,510), (886,991,469,508), (209,383,832,872), (791,968,832,872)],
 'солдат атлас.jpg': [(111,220,490,527), (353,474,490,527), (609,730,490,527), (864,1064,490,527), (639,852,831,869)],
}
DEMON_WALK2_BLOB = (840, 926, 376, 454)  # приєднуємо до walk2 демона

print('\nДРЕЙФ МАСШТАБУ НОВИХ СИРЦІВ (оптимум IoU, вирівнювання низ+медіана):')
for sheet, frames in NEW.items():
    arr = np.array(Image.open(SRC/sheet).convert('RGB'))
    k = keep_mask(arr)
    m_idle = frame_mask(k, frames['idle'], exclude=EXCL[sheet])
    print(f'\n{sheet}: idle {m_idle.shape[1]}x{m_idle.shape[0]}')
    for pose in ('walk1', 'walk2', 'fire'):
        box = frames[pose]
        if sheet == 'демон атлас.jpg' and pose == 'walk2':
            box = (box[0], box[1], box[2], 454)  # включно з відірваним блобом
        m = frame_mask(k, box, exclude=EXCL[sheet])
        ys, xs = np.nonzero(m)
        base_h = ys.max()-ys.min()+1
        base_i = None
        ysi, xsi = np.nonzero(m_idle)
        base_i = ysi.max()-ysi.min()+1
        best = (0.0, 1.0)
        for s100 in range(88, 114, 2):
            s = s100/100
            v = iou_at_scale(m_idle, m, s)
            if v > best[0]: best = (v, s)
        print(f'  {pose}: bbox {m.shape[1]}x{m.shape[0]}, висота маски {base_h} (idle {base_i}, відношення {base_h/base_i:.3f}), '
              f'оптимум s={best[1]:.2f} (IoU {best[0]:.3f})')
