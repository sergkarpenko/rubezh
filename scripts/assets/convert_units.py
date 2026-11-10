#!/usr/bin/env python3
# Конвертація альтернативних юніт-атласів Gemini (листи «солдат атлас.jpg»,
# «демон атлас.jpg») -> assets/units-atlas.png 480x192 (кадр 96x96, сітка 5x2).
# Уроки П14.2/П14.3: хромакей flood-fill d<=15 від фактичного тла + глухі отвори,
# нормалізація висоти тіла за інваріантом idle (спільний масштаб лише для сумісних
# сирців), якір x — медіана (смерть: центр bbox), y — базова лінія (ряд 92),
# nearest-neighbor, альфа бінарна. ВЕСЬ ряд демона у сирцях дивиться вправо ->
# фліп усіх 5 кадрів (натив демона — вліво, battle.ts без змін).
from collections import deque
from pathlib import Path
from PIL import Image
import numpy as np
import json

ROOT = Path(__file__).resolve().parents[2]  # корінь репозиторію (scripts/assets/ -> ../..)
SRC = ROOT / 'assets-src'  # сирці зображень власника, поза git
OUT = ROOT/'assets/units-atlas.png'

ATLAS_W, ATLAS_H, FR = 480, 192, 96
BASELINE_ROW = 92   # чинна базова лінія всіх кадрів атласа
MEDIAN_X = 48       # якір x стоячих кадрів
DEATH_CENTER_X = 48 # якір x кадрів смерті (центр bbox)

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
    # глухі отвори ( enclosed bg ), що не більше max_hole — замикаємо
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

def components(keep, min_area=500):
    h, w = keep.shape
    lbl = np.zeros((h,w), dtype=int); out=[]; cur=0
    for y in range(h):
        for x in range(w):
            if keep[y,x] and lbl[y,x]==0:
                cur += 1
                q = deque([(y,x)]); lbl[y,x]=cur; pts=[]
                while q:
                    cy,cx = q.popleft(); pts.append((cy,cx))
                    for ny,nx in ((cy-1,cx),(cy+1,cx),(cy,cx-1),(cy,cx+1)):
                        if 0<=ny<h and 0<=nx<w and keep[ny,nx] and lbl[ny,nx]==0:
                            lbl[ny,nx]=cur; q.append((ny,nx))
                if len(pts) >= min_area:
                    ys=[p[0] for p in pts]; xs=[p[1] for p in pts]
                    out.append({'area':len(pts),'x0':min(xs),'x1':max(xs),'y0':min(ys),'y1':max(ys),'pts':pts})
    return out

FRAMES = {
 'солдат атлас.jpg': [
   ('idle',  (75,283,85,469),  False, None),
   ('walk1', (340,547,88,462), False, None),
   ('walk2', (589,795,86,464), False, None),
   ('fire',  (852,1179,86,469),False, None),
   ('death', (556,961,643,823),False, 'w95'),
 ],
 'демон атлас.jpg': [
   # ВЕСЬ лист демона згенерований вправо (спалах вогню вправо, смерть дзеркальна
   # до чинної, сяйво рушниці праворуч голови) -> фліп усіх кадрів: натив вліво
   # (battle.ts без змін), «лицем по ходу» — демон наступає зліва-направо... зправа наліво
   ('idle',  (50,369,128,471), True,  None),
   ('walk1', (455,759,125,449),True,  None),
   ('walk2', (840,1157,127,382),True, None),   # блоб-завихрія під ногою виключено (окремий компонент)
   ('fire',  (154,526,508,825),True,  None),
   ('death', (673,1158,601,830),True, 'w93'),
 ],
}
# цільові інваріанти (чинний атлас): солдат тіло 59px, демон 61px; смерть: ширина 95/93
TARGETS = {'солдат атлас.jpg': {'idle_h': 59, 'death_w': 95},
           'демон атлас.jpg':  {'idle_h': 61, 'death_w': 93}}

report = {}
atlas = np.zeros((ATLAS_H, ATLAS_W, 4), dtype=np.uint8)

for sheet, frames in FRAMES.items():
    arr = np.array(Image.open(SRC/sheet).convert('RGB'))
    keep, bg = keep_mask(arr)
    comps = components(keep, min_area=500)
    tgt = TARGETS[sheet]
    # коефіцієнт рядка: спільний для сумісних сирців (солдат), за висотою idle
    idle_box = frames[0][1]
    idle_comp = [c for c in comps if abs(c['x0']-idle_box[0])<8 and abs(c['y0']-idle_box[2])<8][0]
    idle_h_src = idle_comp['y1'] - idle_comp['y0'] + 1
    common_s = tgt['idle_h'] / idle_h_src
    # зум кадрів дії демона: за walk1 (walk2 — присід того ж зуму: голова 128≈132,
    # сяйво очей 180≈152; fire — та сама серія; висота walk1-пози ~= стоячій)
    act_s = None
    if sheet == 'демон атлас.jpg':
        w1_box = frames[1][1]
        w1 = [c for c in comps if abs(c['x0']-w1_box[0])<8 and abs(c['y0']-w1_box[2])<8][0]
        act_s = tgt['idle_h'] / (w1['y1'] - w1['y0'] + 1)
    report[sheet] = {'bg': [int(v) for v in bg], 'idle_h_src': idle_h_src, 'frames': {}}
    print(f"\n{sheet}: тло bg=({bg[0]:.0f},{bg[1]:.0f},{bg[2]:.0f}), idle {idle_h_src}px -> ціль {tgt['idle_h']}px, спільний коеф. {common_s:.4f}"
          + (f", коеф. кадрів дії {act_s:.4f}" if act_s else ""))

    for col, (pose, box, flip, death_mode) in enumerate(frames):
        x0,x1,y0,y1 = box
        # компонент кадру: той, чий bbox збігається з очікуваним
        cand = [c for c in comps if c['x0']>=x0-2 and c['x1']<=x1+2 and c['y0']>=y0-2 and c['y1']<=y1+2 and c['y1'] < y1+90]
        # беремо найбільший (блоб walk2 демона виключається: його y1> y1+... не проходить за y1<=... ні)
        cand = [c for c in cand if c['area'] > 3000]
        c = max(cand, key=lambda c: c['area'])
        # маска кадру: пікселі компонента, обрізані по bbox компонента
        m = np.zeros((c['y1']-c['y0']+1, c['x1']-c['x0']+1), dtype=bool)
        for (py,px) in c['pts']:
            if c['x0'] <= px <= c['x1'] and c['y0'] <= py <= c['y1']:
                m[py-c['y0'], px-c['x0']] = True
        rgb = arr[c['y0']:c['y1']+1, c['x0']:c['x1']+1]
        if flip:
            m = m[:, ::-1]
            rgb = rgb[:, ::-1]
        h_src, w_src = m.shape
        ys, xs = np.nonzero(m)
        h_body = ys.max()-ys.min()+1
        w_body = xs.max()-xs.min()+1
        if death_mode == 'w95' or death_mode == 'w93':
            s = tgt['death_w'] / w_body
            norm_kind = f"смерть: ширина {tgt['death_w']}px"
        elif pose == 'idle':
            s = tgt['idle_h'] / h_body
            norm_kind = 'idle: інваріант'
        elif sheet == 'солдат атлас.jpg':
            s = common_s
            norm_kind = 'спільний коеф. (сирці сумісні, розкид висот <=2.6%)'
        else:
            # демон: idle зсунутий на ~5-8% (дрейф) -> кадри дії одним коеф. walk1;
            # walk2 — присід того ж зуму (голова 128~=132 walk1), висота пози зберігається
            s = act_s
            norm_kind = 'зум кадрів дії = walk1 -> висота idle (дрейф), присід walk2 збережено'
        # nearest-neighbor масштабування
        im_rgb = Image.fromarray(rgb).resize((max(1,round(w_src*s)), max(1,round(h_src*s))), Image.NEAREST)
        im_m = Image.fromarray((m*255).astype(np.uint8)).resize((max(1,round(w_src*s)), max(1,round(h_src*s))), Image.NEAREST)
        rgb_s = np.array(im_rgb); m_s = np.array(im_m) > 127
        ys2, xs2 = np.nonzero(m_s)
        base2 = ys2.max(); med2 = int(np.median(xs2))
        if death_mode:
            anchor_x = int((xs2.min()+xs2.max())/2)  # смерть: центр bbox
            ax = DEATH_CENTER_X
        else:
            anchor_x = med2  # стоячі: медіана (стійка до спалаху)
            ax = MEDIAN_X
        xoff = ax - anchor_x
        yoff = BASELINE_ROW - base2
        cell = np.zeros((FR, FR, 4), dtype=np.uint8)
        placed = 0; clipped = 0
        for yy in range(m_s.shape[0]):
            for xx in range(m_s.shape[1]):
                if not m_s[yy,xx]: continue
                ty, tx = yy+yoff, xx+xoff
                if 0 <= ty < FR and 0 <= tx < FR:
                    cell[ty,tx,:3] = rgb_s[yy,xx]; cell[ty,tx,3] = 255
                    placed += 1
                else:
                    clipped += 1
        # чисельний звіт кадру
        bb_ys, bb_xs = np.nonzero(cell[...,3]>0)
        dens = placed / max(1, (bb_ys.max()-bb_ys.min()+1)*(bb_xs.max()-bb_xs.min()+1)) if placed else 0
        row = 0 if sheet == 'солдат атлас.jpg' else 1
        atlas[row*FR:(row+1)*FR, col*FR:(col+1)*FR] = cell
        rep = {
            'bbox_джерела': [int(c['x0']),int(c['y0']),int(c['x1']),int(c['y1'])],
            'висота_тіла_джерела': int(h_body), 'ширина_джерела': int(w_body),
            'масштаб': round(s,4), 'нормалізація': norm_kind, 'фліп': flip,
            'розмір_у_кадрі': [int(bb_xs.max()-bb_xs.min()+1), int(bb_ys.max()-bb_ys.min()+1)] if placed else None,
            'y_у_кадрі': [int(bb_ys.min()), int(bb_ys.max())] if placed else None,
            'непрозорих': placed, 'обрізано_поза_кадром': clipped,
            'щільність_bbox': round(100*dens,1),
        }
        report[sheet]['frames'][pose] = rep
        print(f"  {pose}: тіло {h_body}px, s={s:.4f} ({norm_kind}{' + ФЛІП' if flip else ''}), "
              f"у кадрі y[{rep['y_у_кадрі'][0]}..{rep['y_у_кадрі'][1]}] {rep['розмір_у_кадрі'][0]}x{rep['розмір_у_кадрі'][1]}, "
              f"щільність {rep['щільність_bbox']}%, обрізано {clipped}")

Image.fromarray(atlas).save(OUT)
print(f"\nЗбережено: {OUT} ({OUT.stat().st_size} байт)")
with open(SRC/'units-gemini-report.json', 'w') as f:
    json.dump(report, f, ensure_ascii=False, indent=2)
print('Звіт: assets-src/units-gemini-report.json')
