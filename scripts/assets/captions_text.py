#!/usr/bin/env python3
# Текст підписів: отвори ВНУТРІШНІ компонентів плашок (не з'єднані з краєм bbox).
from collections import deque
from pathlib import Path
from PIL import Image
import numpy as np

ROOT = Path(__file__).resolve().parents[2]  # корінь репозиторію (scripts/assets/ -> ../..)
SRC = ROOT / 'assets-src'  # сирці зображень власника, поза git

def chess(a, b):
    return np.max(np.abs(a.astype(int) - b.astype(int)), axis=-1)

def edge_keep(arr, th=15):
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
    return ~vis

CAPS = {
 'солдат атлас.jpg': [
   ('C1', (111,220,490,527)), ('C2', (353,474,490,527)), ('C3', (609,730,490,527)),
   ('C4', (864,1064,490,527)), ('C5', (639,852,831,869)),
 ],
 'демон атлас.jpg': [
   ('C1', (135,231,469,510)), ('C2', (518,623,469,510)), ('C3', (886,991,469,508)),
   ('C4', (209,383,832,872)), ('C5', (791,968,832,872)),
 ],
}
for name, caps in CAPS.items():
    arr = np.array(Image.open(SRC/name).convert('RGB'))
    keep = edge_keep(arr)
    lum = arr.mean(axis=2)
    print(f'\n##### {name}')
    for tag, box in caps:
        x0,x1,y0,y1 = box
        k = keep[y0:y1+1, x0:x1+1]
        h, w = k.shape
        # не-keep пікселі, з'єднані з краєм bbox = зовнішнє тло; решта = текст
        vis = np.zeros((h, w), dtype=bool)
        q = deque()
        for x in range(w):
            for y in (0, h-1):
                if not k[y,x] and not vis[y,x]: vis[y,x]=True; q.append((y,x))
        for y in range(h):
            for x in (0, w-1):
                if not k[y,x] and not vis[y,x]: vis[y,x]=True; q.append((y,x))
        while q:
            cy,cx = q.popleft()
            for ny,nx in ((cy-1,cx),(cy+1,cx),(cy,cx-1),(cy,cx+1)):
                if 0<=ny<h and 0<=nx<w and not k[ny,nx] and not vis[ny,nx]:
                    vis[ny,nx]=True; q.append((ny,nx))
        text = (~k) & (~vis)
        print(f'\n--- {tag} текст-пікселів: {text.sum()}')
        for r in range(h):
            line = ''
            for c in range(w):
                if text[r,c]: line += '#'
                elif k[r,c]: line += '.'
                else: line += ' '
            print(line)
