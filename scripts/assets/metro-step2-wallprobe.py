# Стіна: розділення поля (margin) і тіла блоку — поріг flood-fill за фактом
from PIL import Image
import statistics

im = Image.open('assets-src/metro-wall.jpg').convert('RGB')
w, h = im.size
px = im.load()
bg = (23, 22, 22)

def dist(a, b): return max(abs(a[i]-b[i]) for i in range(3))

# профіль по горизонталі y=384 (середина): x -> d до тла
row = [(x, dist(px[x, 384], bg)) for x in range(0, w, 8)]
print("y=384, d по x (крок 8):")
print(", ".join(f"{x}:{d}" for x, d in row))
# профіль по вертикалі x=512
col = [(y, dist(px[512, y], bg)) for y in range(0, h, 8)]
print("x=512, d по y (крок 8):")
print(", ".join(f"{y}:{d}" for y, d in col))

# поля: зона x<100 (ліве поле) — розподіл d
margin = [dist(px[x, y], bg) for y in range(0, h, 4) for x in range(0, 100, 2)]
margin.sort()
print(f"поле x<100: p50={margin[len(margin)//2]} p95={margin[int(len(margin)*0.95)]} max={margin[-1]}")
# тіло: зона x 400..600, y 300..500
body = [dist(px[x, y], bg) for y in range(300, 500, 2) for x in range(400, 600, 2)]
body.sort()
print(f"тіло (400-600,300-500): p5={body[int(len(body)*0.05)]} p50={body[len(body)//2]} min={body[0]}")
# ціановий кант: пікселі g-r>40 і b-r>40
cy = [(x, y, px[x, y]) for y in range(0, h, 6) for x in range(0, w, 6)
      if px[x, y][1] - px[x, y][0] > 40 and px[x, y][2] - px[x, y][0] > 40]
print(f"ціанових пікселів (крок 6): {len(cy)}; приклади: {cy[:5]}")
if cy:
    xs = [c[0] for c in cy]; ys = [c[1] for c in cy]
    print(f"  кант bbox: {min(xs)}..{max(xs)} x {min(ys)}..{max(ys)}")
    print(f"  яскравість канту: luma max={max(0.2126*c[2][0]+0.7152*c[2][1]+0.0722*c[2][2] for c in cy):.0f}")
