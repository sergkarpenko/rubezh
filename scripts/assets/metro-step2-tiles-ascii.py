# ASCII-контроль готових тайлів (щільність/силуети чисельно вже в конвертері)
from PIL import Image
CH = " .:-=+*#%@"
im = Image.open('assets/metro-tiles.png')
px = im.load()
for row in range(4):  # кожен тайл — 24 символи (2px/симв)
    print(f"-- кол. {row}")
    for y in range(0, 48, 2):
        line = ""
        for x in range(row*48, row*48+48, 2):
            r, g, b, a = px[x, y]
            if a == 0:
                line += " "
            else:
                l = int(0.2126*r + 0.7152*g + 0.0722*b)
                line += CH[min(9, l*10//256)]
        print("|" + line + "|")
