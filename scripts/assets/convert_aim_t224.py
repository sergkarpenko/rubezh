#!/usr/bin/env python3
"""п21.6 (Т.224, ADR-0180): кадри пострілу вгору / вниз атласа бійців з аркушів Gemini.

Сирці — у теці (аргумент; типово assets-src/, поза git), 1376 × 768, хромакей #00FF00, три фігури в ряд
обличчям ПРАВОРУЧ: «стій» (еталон масштабу), «постріл угору», «постріл униз»:
  t224-soldier.jpg, t224-demon.jpg (п21.6); t224-golem.jpg, t224-eye.jpg — коли будуть (рішення власника
  «Два зараз, два пізніше»): вигляд без сирця лишає свої клітинки порожніми, рендер — промінь з центру.
Результат:
  assets/units-atlas.png — 672 × 480: стовпці 0–4 — без змін, байт у байт (перевірка); стовпець 5 —
                           «постріл угору», 6 — «постріл униз»; ряди — як ATLAS_ROW (гончак — без кадрів);
  scripts/assets/aim-t224-report.json — масштаб, рамки, якорі дула (поле muzzle — для MUZZLE_AIM у render.ts).
Масштаб — висота фігури «стій» стовпця 0 чинного атласа (рядки з альфою > 128) до висоти «стій» аркуша;
ступні (feet_x) — у колонці ступнів чинного «стій», низ — BOTTOM. Кадр, що не вміщується в 96 × 96 (ствол
угору над головою), зменшено окремо (поле scale кадру у звіті). Дуло — найдальший у напрямку пострілу
непрозорий піксель (проєкція на вектор під 55° від горизонталі в бік погляду), середнє чотирьох найдальших;
ступні (FEET_BAND рядків над BOTTOM) — лише за переднім краєм «стій» (аудит PR #543: носок чобота).
Вигляд без сирця переносить свої стовпці 5–6 з чинного атласа, якщо той уже 672 завширшки (аудит PR #543).
Перевірки (код 1): зелений відблиск, незмінність стовпців 0–4, ствол кадру «угору» вище плечей «стій»,
«униз» — нижче, дуло — за переднім краєм «стій» у бік погляду. Запуск з кореня репозиторію: python3 scripts/assets/convert_aim_t224.py [тека сирців]
"""

from pathlib import Path
import json
import math
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from convert_units_t133 import BOTTOM, FR, MAX_W, feet_x, matte, resize, split_figures  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'assets-src'
UNITS = ROOT / 'assets/units-atlas.png'
REPORT = Path(__file__).resolve().parent / 'aim-t224-report.json'

# вигляд: (ряд атласа = ATLAS_ROW у src/render.ts, натив погляду: +1 праворуч, -1 ліворуч)
KINDS = {'soldier': (0, 1), 'demon': (1, -1), 'golem': (3, -1), 'eye': (4, -1)}
COLS = 7  # 0–4 — idle, walk1, walk2, fire, death; 5 — постріл угору; 6 — постріл униз
AIM_COL = {'up': 5, 'down': 6}
GREEN_MAX = 24  # як convert_portraits_t222.py: зелений над max(r, b) на непрозорих пікселях
ANGLE = math.radians(55)
# Т.226 (голем і око, ADR-0183): око в чинному атласі вужче за аркуш (щупальця аркуша розкинуті) — масштаб за
# шириною «стій», інакше кадр пострілу «роздувався» б на ≈ 30 %; голем у «стій» тримає гармату перед собою
# (передній край «стій» — дуло), тож дуло кадру звіряємо не з краєм, а з колонкою ступнів: попереду на
# чверть ширини «стій»
FIT_WIDTH = {'eye'}
FRONT_FROM_FEET = {'golem'}
FEET_BAND = 8  # рядки ступнів над BOTTOM


def opaque_box(fr):
    ys, xs = np.where(fr[..., 3] > 128)
    return [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1]


def muzzle(fr, facing, aim, ib):
    ys, xs = np.where(fr[..., 3] > 128)
    # ступні під корпусом «стій» не дуло (аудит PR #543: носок чобота оперативника в кадрі «униз»
    # висунувся далі за ствол під 55°): смуга FEET_BAND над BOTTOM — лише за переднім краєм «стій»
    front = ib[2] if facing > 0 else ib[0]
    keep = (ys < BOTTOM - FEET_BAND) | (facing * xs > facing * front)
    ys, xs = ys[keep], xs[keep]
    vy = -1 if aim == 'up' else 1
    proj = facing * xs * math.cos(ANGLE) + vy * ys * math.sin(ANGLE)
    top = np.argsort(proj)[-4:]
    return {'x': int(round(xs[top].mean())), 'y': int(round(ys[top].mean()))}


def place(fig, scale, anchor):
    s = resize(fig, scale)
    if s.shape[0] > BOTTOM - 1 or s.shape[1] > MAX_W:  # не вміщується — менший масштаб саме цього кадру
        k = min((BOTTOM - 1) / s.shape[0], MAX_W / s.shape[1])
        scale *= k
        s = resize(fig, scale)
    fr = np.zeros((FR, FR, 4), np.uint8)
    x = min(max(int(round(anchor - feet_x(s))), 1), FR - 1 - s.shape[1])
    fr[BOTTOM - s.shape[0] : BOTTOM, x : x + s.shape[1]] = s
    return fr, round(scale, 4)


def build(name, old):
    row, facing = KINDS[name]
    figs = split_figures(matte(SRC / f't224-{name}.jpg'), parts=3)
    if facing < 0:
        figs = [f[:, ::-1].copy() for f in figs]  # аркуш — праворуч, натив ворога — ліворуч
    idle = old[row * FR : (row + 1) * FR, 0:FR]
    ib = opaque_box(idle)
    scale = (ib[3] - ib[1]) / figs[0].shape[0]  # висота «стій» чинного атласа
    if name in FIT_WIDTH:
        scale = min(scale, (ib[2] - ib[0]) / figs[0].shape[1])
    anchor = feet_x(idle[ib[1] : ib[3], ib[0] : ib[2]]) + ib[0]
    frames, info = {}, {'row': row, 'scale': round(scale, 4), 'anchorX': round(anchor, 1), 'idleBox': ib}
    for aim, fig in (('up', figs[1]), ('down', figs[2])):
        fr, sc = place(fig, scale, anchor)
        g = fr[..., 1].astype(int) - np.maximum(fr[..., 0], fr[..., 2]).astype(int)
        green = int(g[fr[..., 3] > 0].max())
        if green > GREEN_MAX:
            raise SystemExit(f'{name} {aim}: зелений відблиск {green} > {GREEN_MAX}')
        m = muzzle(fr, facing, aim, ib)
        front = ib[2] if facing > 0 else ib[0]
        if name in FRONT_FROM_FEET:
            front = round(anchor + facing * (ib[2] - ib[0]) / 4)
        if facing * m['x'] <= facing * front:
            raise SystemExit(f'{name} {aim}: дуло {m} не за переднім краєм «стій» (x {front}) — ступня чи корпус, не ствол')
        shoulder = ib[1] + (ib[3] - ib[1]) // 3  # плечі «стій» — третина висоти від маківки
        if (aim == 'up' and m['y'] >= shoulder) or (aim == 'down' and m['y'] <= shoulder):
            raise SystemExit(f'{name} {aim}: дуло {m} не {"вище" if aim == "up" else "нижче"} плечей (рядок {shoulder})')
        frames[aim] = fr
        info[aim] = {'scale': sc, 'bbox': opaque_box(fr), 'muzzle': m, 'greenMax': green}
    return frames, info


def main():
    old = np.asarray(Image.open(UNITS).convert('RGBA'))
    atlas = np.zeros((old.shape[0], FR * COLS, 4), np.uint8)
    atlas[:, : FR * 5] = old[:, : FR * 5]
    prev = json.loads(REPORT.read_text()) if REPORT.exists() and old.shape[1] == FR * COLS else {}
    report = {}
    for name, (row, _) in KINDS.items():
        if not (SRC / f't224-{name}.jpg').exists():
            # сирця немає: готові кадри чинного атласа лишаються (наступний PR — голем і око без сирців
            # оперативника й демона), інакше — порожньо
            if prev.get(name) is not None:
                atlas[row * FR : (row + 1) * FR, FR * 5 :] = old[row * FR : (row + 1) * FR, FR * 5 :]
            report[name] = prev.get(name)
            continue
        frames, report[name] = build(name, old)
        for aim, fr in frames.items():
            c = AIM_COL[aim]
            atlas[row * FR : (row + 1) * FR, c * FR : (c + 1) * FR] = fr
    atlas[atlas[..., 3] == 0] = 0
    if not np.array_equal(atlas[:, : FR * 5], old[:, : FR * 5]):
        raise SystemExit('змінились стовпці 0–4 атласа бійців')
    Image.fromarray(atlas, 'RGBA').save(UNITS, optimize=True)
    # запис — рядком на вигляд (багаторядковий звіт роздував би диф)
    lines = [f' "{k}": ' + json.dumps(v, ensure_ascii=False) for k, v in report.items()]
    REPORT.write_text('{\n' + ',\n'.join(lines) + '\n}\n')
    print(json.dumps({k: v and {a: v[a]['muzzle'] for a in ('up', 'down')} for k, v in report.items()}, ensure_ascii=False))


if __name__ == '__main__':
    main()
