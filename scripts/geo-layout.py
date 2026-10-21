#!/usr/bin/env python3
"""Разовий скрипт виведення розкладу суші GEO_LAYOUT з картини світу.

Позафазна лінія «візуальні порівняння», кандидат А «нічний супутник»
(Work-сесія 2026-10-21, виконано 2026-10-22).

Джерело: assets-src/geo-map2.jpg (1024x768, сирець власника, поза git).
Ассет рантайму: assets/geo-map.webp — кроп видимого вікна cover
(рядки 96..672 => 1024x576, точний аспект 16:9 канви 768x432).

Правило класифікації (доручення Work): клітинка 16x9 = суша, якщо медіана
яскравості її 64x64-піксельної ділянки видимого вікна вище порогу.
Поріг за фактичним джерелом: 14.5 — центр розриву у розподілі медіан
клітинок (океан плоско 13.0; острів бази 15.8; розрив 14.0 -> 14.8).

Жорсткі перевірки доручення (невиконання = стоп, поріг не силувати):
  (а) клітинка бази (8,4) — суша;
  (б) суша не торкається лівого/правого краю карти (без швів зшивання).
Орієнтири: суша ~30-40% клітинок, острів у центрі.

Результат комітується константою GEO_LAYOUT у src/core/render-core.ts;
рантайм від ассета і цього скрипта НЕ залежить (розклад — константа).

Запуск: python3 scripts/geo-layout.py  (з кореня репо; залежність: Pillow)
"""

from PIL import Image
import numpy as np

SRC = 'assets-src/geo-map2.jpg'
TH = 14.5  # поріг за фактичним джерелом (див. docstring)

im = Image.open(SRC).convert('RGB')
a = np.asarray(im).astype(float)
lum = 0.2126 * a[:, :, 0] + 0.7152 * a[:, :, 1] + 0.0722 * a[:, :, 2]
H, W = lum.shape
crop_h = round(W * 9 / 16)  # 576 — видиме вікно cover на канві 16:9
y0 = (H - crop_h) // 2      # 96 — центрований cover

med = np.zeros((9, 16))
for gy in range(9):
    for gx in range(16):
        win = lum[y0 + gy * 64:y0 + (gy + 1) * 64, gx * 64:(gx + 1) * 64]
        med[gy, gx] = np.median(win)

land = med > TH
base_ok = bool(land[4, 8])
edges_ok = not land[:, 0].any() and not land[:, 15].any()
frac = land.mean() * 100

rows = []
for gy in range(9):
    rows.append(''.join('B' if (gx, gy) == (8, 4) else 'L' if land[gy, gx] else '.' for gx in range(16)))

print('джерело %dx%d, вікно cover рядки %d..%d, поріг %.1f' % (W, H, y0, y0 + crop_h, TH))
print('медіана клітинки бази (8,4): %.2f' % med[4, 8])
print(' суша: %d/144 (%.1f%%)' % (land.sum(), frac))
print(' (а) база (8,4) — суша: %s' % ('OK' if base_ok else 'FAIL'))
print(' (б) краї X — океан:     %s' % ('OK' if edges_ok else 'FAIL'))
print('GEO_LAYOUT:')
for r in rows:
    print("  '%s'," % r)
assert base_ok and edges_ok and 30 <= frac <= 40, 'жорсткі перевірки не пройдено — стоп'
