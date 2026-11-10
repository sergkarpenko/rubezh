# Конвертація «Мегаполіс» крок 2: цілісна підлога + згенеровані об'єкти
# Уроки П14.2/П14.3/П14.6: поріг за ФАКТИЧНИМ тлом, flood-fill від країв,
# глухі отвори замикаються, зачистка ореолу (ерозія 1px), nearest-neighbor,
# один цикл стиснення WebP q90, якість проти JPG-оригіналу (PSNR).
from PIL import Image
from collections import deque
import statistics, math

def dist(a, b): return max(abs(a[i]-b[i]) for i in range(3))

def luma(p): return 0.2126*p[0] + 0.7152*p[1] + 0.0722*p[2]

def corner_bg(im):
    w, h = im.size
    px = im.load()
    cs = []
    for (cx, cy) in [(0,0),(w-12,0),(0,h-12),(w-12,h-12)]:
        for y in range(cy, cy+12):
            for x in range(cx, cx+12):
                cs.append(px[x, y])
    return (round(statistics.median([c[0] for c in cs])),
            round(statistics.median([c[1] for c in cs])),
            round(statistics.median([c[2] for c in cs])))

def alpha_mask(im, bg, thr, hole_thr):
    # flood-fill від країв: прозоре все, що з'єднане з краєм і d<=thr
    w, h = im.size
    px = im.load()
    trans = [[False]*w for _ in range(h)]
    q = deque()
    def try_push(x, y):
        if not trans[y][x] and dist(px[x, y], bg) <= thr:
            trans[y][x] = True
            q.append((x, y))
    for x in range(w): try_push(x, 0); try_push(x, h-1)
    for y in range(h): try_push(0, y); try_push(w-1, y)
    while q:
        x, y = q.popleft()
        if x > 0: try_push(x-1, y)
        if x < w-1: try_push(x+1, y)
        if y > 0: try_push(x, y-1)
        if y < h-1: try_push(x, y+1)
    # глухі отвори: незамкнені до краю кишені з d<=hole_thr -> непрозорі (тіло)
    for y in range(h):
        for x in range(w):
            if not trans[y][x] and dist(px[x, y], bg) <= hole_thr:
                trans[y][x] = False  # вже непрозорий
    # (кишені, з'єднані з краєм, уже прозорі; решта лишається тілом)
    # зачистка ореолу: ерозія 1px прозорої межі (слабкий JPEG-ореол навколо силуету)
    solid = [[not t for t in row] for row in trans]
    eroded = [row[:] for row in solid]
    for y in range(h):
        for x in range(w):
            if solid[y][x]:
                for dx, dy in ((1,0),(-1,0),(0,1),(0,-1)):
                    nx, ny = x+dx, y+dy
                    if 0 <= nx < w and 0 <= ny < h and not solid[ny][nx]:
                        # крайовий піксель: прибрати, якщо він слабкий (d<=thr*2)
                        if dist(px[x, y], bg) <= thr*2:
                            eroded[y][x] = False
                        break
    return eroded

def sprite_tile(src_path, thr, hole_thr, name):
    im = Image.open(src_path).convert('RGB')
    w, h = im.size
    bg = corner_bg(im)
    mask = alpha_mask(im, bg, thr, hole_thr)
    ys = [y for y in range(h) if any(mask[y][x] for x in range(w))]
    xs = [x for x in range(w) if any(mask[y][x] for x in [x] for y in range(h))]
    minx, maxx = min(xs), max(xs); miny, maxy = min(ys), max(ys)
    bw, bh = maxx-minx+1, maxy-miny+1
    density = sum(1 for y in range(miny, maxy+1) for x in range(minx, maxx+1) if mask[y][x]) / (bw*bh)
    crop = im.crop((minx, miny, maxx+1, maxy+1))
    m = Image.new('L', (bw, bh), 0)
    mp = m.load()
    for y in range(bh):
        for x in range(bw):
            if mask[miny+y][minx+x]: mp[x, y] = 255
    scale = min(48/bw, 48/bh)
    tw, th = max(1, round(bw*scale)), max(1, round(bh*scale))
    rgb = crop.resize((tw, th), Image.NEAREST)
    a = m.resize((tw, th), Image.NEAREST)
    tile = Image.new('RGBA', (48, 48), (0, 0, 0, 0))
    # якір: по центру, низ спрайта — низ клітинки мінус 1px (м'який край туману/сітки)
    ox = (48 - tw) // 2
    oy = 48 - th if th >= 48 else 48 - th - 1
    tile.paste(rgb, (ox, oy), a)
    occ = sum(1 for p in tile.getdata() if p[3] > 0) / (48*48)
    print(f"{name}: тло RGB{bg}, bbox {bw}x{bh}, щільність маски bbox {density*100:.1f}%, "
          f"тайл {tw}x{th}@({ox},{oy}), зайнятість тайла {occ*100:.1f}%")
    return tile

# --- фон: metro-bg.jpg -> metro-bg.webp, один цикл q90 ---
src = Image.open('assets-src/metro-bg.jpg').convert('RGB')
src.save('/tmp/metro-bg-q90.webp', 'WEBP', quality=90, method=6)
w, h = src.size
spx = src.load(); wpx = Image.open('/tmp/metro-bg-q90.webp').convert('RGB').load()
mse = sum((spx[x,y][i]-wpx[x,y][i])**2 for y in range(h) for x in range(w) for i in range(3)) / (w*h*3)
psnr = 10*math.log10(255*255/mse) if mse > 0 else float('inf')
ls = sorted(luma(wpx[x, y]) for y in range(0, h, 2) for x in range(0, w, 2))
med = ls[len(ls)//2]
over90 = sum(1 for v in ls if v > 90)/len(ls)*100
print(f"metro-bg.webp: {w}x{h}, PSNR(q90 vs JPG-оригінал)={psnr:.2f} dB, "
      f"медіана luma={med:.1f} (орієнтир <=45), >90 luma: {over90:.2f}%, max={ls[-1]:.0f}")

# --- атлас: стіна + 3 декори (192x48, 4 тайли) ---
atlas = Image.new('RGBA', (192, 48), (0, 0, 0, 0))
atlas.paste(sprite_tile('assets-src/metro-wall.jpg', 8, 18, 'стіна (metro-wall, THR d<=8)'), (0, 0))
atlas.paste(sprite_tile('assets-src/metro-decor-lamp.jpg', 15, 15, 'лампа (decor-lamp, THR d<=15)'), (48, 0))
atlas.paste(sprite_tile('assets-src/metro-decor-holo.jpg', 15, 15, 'голограма (decor-holo, THR d<=15)'), (96, 0))
atlas.paste(sprite_tile('assets-src/metro-decor-wreck.jpg', 15, 15, 'уламки (decor-wreck, THR d<=15)'), (144, 0))
atlas.save('assets/metro-tiles.png')
print("assets/metro-tiles.png: 192x48 (кол. 0 стіна, 1 лампа, 2 голограма, 3 уламки)")
