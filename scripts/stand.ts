/// <reference types="vite/client" />
// scripts/stand.ts — стенд терену бою (Т.146, кандидат процесу 124, Т.163): `drawNightTerrain` справжніми
// ассетами (`assets/metro-bg.webp`, `assets/metro-tiles.png`) на мапі `makeTestMap` без решти гри — варіант
// малювання канви перевіряти тут правкою `src/render.ts` чи `src/core/render-core.ts` у гілці (docs/agents/ui.md).
// Поза збіркою гри: `npx vite --port 4180` з кореня клону, сторінка
//   http://localhost:4180/rubezh/scripts/stand.html?seed=1&density=0.08&fog=0
// seed і density — аргументи `makeTestMap` (поле 20 × 20); fog — стовпчик, з якого клітинки в тумані (0 — без
// туману). Готовність — `data-ready="1"` на `body`; знімок — scripts/stand-shot.ts.
import { drawNightTerrain, initMetroMap, initMetroTiles, isMetroTerrainReady } from '../src/render';
import { makeTestMap } from '../src/core/map';
import type { TerrainCell } from '../src/core/render-core';
import { BCELL } from '../src/ui/grid';

const q = new URLSearchParams(location.search);
const num = (k: string, d: number): number => {
  const v = Number(q.get(k));
  return q.has(k) && Number.isFinite(v) ? v : d;
};
const map = makeTestMap(num('seed', 1), 20, 20, num('density', 0.08));
const fog = num('fog', 0);
const cells: TerrainCell[] = [];
for (let y = 0; y < map.height; y++)
  for (let x = 0; x < map.width; x++) cells.push({ x, y, blocked: map.blocked.has(x + ',' + y), visible: fog <= 0 || x < fog });

const load = (url: string, onLoad: (img: CanvasImageSource) => void): void => {
  const img = new Image();
  img.onload = () => onLoad(img);
  img.src = url;
};
initMetroMap(load);
initMetroTiles(load);

const canvas = document.getElementById('stand') as HTMLCanvasElement;
const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
const draw = (): void => {
  if (!isMetroTerrainReady()) {
    requestAnimationFrame(draw);
    return;
  }
  drawNightTerrain(ctx, canvas.width, canvas.height, cells, BCELL);
  document.body.dataset.ready = '1';
};
draw();
