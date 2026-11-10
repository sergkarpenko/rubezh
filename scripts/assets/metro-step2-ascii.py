# ASCII-профілі сирців (48x36): зрозуміти фактичну структуру кадру
from PIL import Image

CH = " .:-=+*#%@"  # темне -> світле

def ascii_img(path, name, wchars=48):
    im = Image.open(path).convert('RGB')
    w, h = im.size
    hh = max(1, round(h * (wchars / w) * 0.5))
    small = im.resize((wchars, hh), Image.BILINEAR)
    px = small.load()
    print(f"== {name}")
    for y in range(hh):
        row = ""
        for x in range(wchars):
            p = px[x, y]
            l = int(0.2126*p[0] + 0.7152*p[1] + 0.0722*p[2])
            row += CH[min(9, l * 10 // 256)]
        print(row)

ascii_img('assets-src/metro-wall.jpg', 'metro-wall')
ascii_img('assets-src/metro-decor-lamp.jpg', 'decor-lamp')
ascii_img('assets-src/metro-decor-holo.jpg', 'decor-holo')
ascii_img('assets-src/metro-decor-wreck.jpg', 'decor-wreck')
ascii_img('assets-src/metro-bg.jpg', 'metro-bg', 64)
