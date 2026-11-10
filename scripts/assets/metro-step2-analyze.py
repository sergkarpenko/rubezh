# Чисельний аналіз сирців «Мегаполіс» крок 2 (уроки П14.2/П14.3: звіряти ФАКТ)
from PIL import Image
import statistics

def luma(p):  # BT.709
    return 0.2126*p[0] + 0.7152*p[1] + 0.0722*p[2]

def dist(a, b):
    return max(abs(a[i]-b[i]) for i in range(3))

def analyze(path, name):
    im = Image.open(path).convert('RGB')
    w, h = im.size
    px = im.load()
    print(f"== {name}: {w}x{h}")
    # тло: кути 12x12
    corner = []
    for (cx, cy) in [(0,0),(w-12,0),(0,h-12),(w-12,h-12)]:
        for y in range(cy, cy+12):
            for x in range(cx, cx+12):
                corner.append(px[x, y])
    rs = [c[0] for c in corner]; gs=[c[1] for c in corner]; bs=[c[2] for c in corner]
    bg = (round(statistics.median(rs)), round(statistics.median(gs)), round(statistics.median(bs)))
    print(f"  тло (медіана кутів 12x12): RGB{bg}, max comp: {max(rs+gs+bs)}")
    # відстані всіх пікселів до тла
    ds = []
    for y in range(0, h, 2):
        for x in range(0, w, 2):
            ds.append(dist(px[x, y], bg))
    ds.sort()
    print(f"  d до тла: p50={ds[len(ds)//2]}, p90={ds[int(len(ds)*0.9)]}, p99={ds[int(len(ds)*0.99)]}, max={ds[-1]}")
    # bbox об'єкта за порогами
    for thr in (15, 25, 40):
        minx, miny, maxx, maxy = w, h, -1, -1
        for y in range(0, h, 2):
            for x in range(0, w, 2):
                if dist(px[x, y], bg) > thr:
                    if x < minx: minx = x
                    if y < miny: miny = y
                    if x > maxx: maxx = x
                    if y > maxy: maxy = y
        print(f"  bbox d>{thr}: {minx}..{maxx} x {miny}..{maxy} ({maxx-minx}x{maxy-miny})" if maxx >= 0 else f"  bbox d>{thr}: порожньо")
    return bg

analyze('assets-src/metro-wall.jpg', 'metro-wall')
analyze('assets-src/metro-decor-lamp.jpg', 'decor-lamp')
analyze('assets-src/metro-decor-holo.jpg', 'decor-holo')
analyze('assets-src/metro-decor-wreck.jpg', 'decor-wreck')

# фон бою: медіана яскравості (контрольна точка контрасту <= 45/255)
im = Image.open('assets-src/metro-bg.jpg').convert('RGB')
w, h = im.size
px = im.load()
ls = [luma(px[x, y]) for y in range(0, h, 2) for x in range(0, w, 2)]
ls.sort()
med = ls[len(ls)//2]
over90 = sum(1 for v in ls if v > 90) / len(ls) * 100
print(f"== metro-bg: {w}x{h}, медіана luma={med:.1f}, >90 luma: {over90:.1f}%, max={ls[-1]:.0f}")
