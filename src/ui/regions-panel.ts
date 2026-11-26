// п19.4 (ADR-0159 п. 5, 15; EARS 8): регіони в UI — панель «Регіони» середньої колонки
// (довіра смугою, частка дотації, ангари, «вийшов») і шар мапи геосцени (межі регіонів пунктиром,
// підпис з довірою). Ядро не змінюється (ADR-0002): розклад — REGION_OF / regionOf, довіра —
// party.campaign.regions, частка дотації — dailyAllowance з довірою одного регіону.
// Тексти — рішення власника п19.4 (Т.207, кнопками).

import { REGION_GRID_H, REGION_GRID_W, REGION_IDS, REGION_NAMES, REGION_OF, totalTrust, type RegionId } from '../core/regions';
import { dailyAllowance } from '../core/economy';
import type { Party } from '../core/save';
import { el } from './dom';

// Колір довіри: висока — ціан «Рубіжу», середня — бурштин, низька — червоний (межі — третини шкали).
export function trustColor(trust: number): string {
  return trust >= 70 ? '#00e5ff' : trust >= 40 ? '#ffb454' : '#ff6b6b';
}

// Частка регіону в дотації за добу: та сама формула ядра, що й для суми (75 × множник × довіра / 400,
// округлено); регіон, що вийшов, — 0. Сума часток може відрізнятися від дотації на 1–2 (округлення).
export function regionShare(party: Party, id: RegionId): number {
  const r = party.campaign.regions[id];
  return r.out ? 0 : dailyAllowance(party.campaign.preset, r.trust);
}

// Перехоплювачі в ангарі регіону (на базі, у погоні, бою чи ремонті — ангар той самий).
export function fightersIn(party: Party, id: RegionId): number {
  return party.intercept.fighters.filter((f) => f.region === id).length;
}

export function renderRegions(party: Party): void {
  const box = el('regions');
  box.innerHTML = '';
  for (const id of REGION_IDS) {
    const r = party.campaign.regions[id];
    const row = document.createElement('div');
    row.className = 'region' + (r.out ? ' out' : '');
    row.id = 'region-' + id;
    const trust = r.out ? 0 : r.trust;
    const hangar = fightersIn(party, id);
    // один рядок на регіон: назва (з ангаром — «✈» і число), смуга довіри, довіра, частка дотації
    row.innerHTML =
      '<span class="rg-name">' +
      REGION_NAMES[id] +
      (hangar > 0
        ? ' <span class="rg-hangar" title="Перехоплювачів в ангарі: ' + hangar + '">✈' + (hangar > 1 ? hangar : '') + '</span>'
        : '') +
      '</span><span class="rg-bar"><i style="width:' +
      trust +
      '%;background:' +
      trustColor(trust) +
      '"></i></span><span class="rg-trust">' +
      (r.out ? '✗' : trust) +
      '</span><span class="meta rg-share">' +
      (r.out ? 'вийшов' : regionShare(party, id) + '/добу') +
      '</span>';
    row.title = r.out
      ? REGION_NAMES[id] + ': регіон вийшов — дотації немає'
      : REGION_NAMES[id] + ': довіра ' + trust + ' з 100 · частка дотації ' + regionShare(party, id) + '/добу';
    box.appendChild(row);
  }
  const sum = document.createElement('div');
  sum.className = 'meta';
  sum.id = 'regions-total';
  sum.textContent = 'Дотація разом: ' + dailyAllowance(party.campaign.preset, totalTrust(party.campaign.regions)) + '/добу';
  box.appendChild(sum);
}

// Прямокутник регіону в клітинках (розклад REGION_OF — прямокутники; перевіряє тест).
export function regionRect(id: RegionId): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = REGION_GRID_W;
  let y0 = REGION_GRID_H;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < REGION_GRID_H; y++) {
    for (let x = 0; x < REGION_GRID_W; x++) {
      if (REGION_OF[y]![x] !== id) continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  return { x0, y0, x1, y1 };
}

// Шар мапи: межі між сусідніми клітинками різних регіонів — пунктир; регіон, що вийшов, — темна
// заливка; у верхньому лівому куті регіону — назва і довіра (вийшов — «✗»). Лише відображення.
export function drawRegionsLayer(ctx: CanvasRenderingContext2D, party: Party, cell: number): void {
  ctx.save();
  for (const id of REGION_IDS) {
    if (!party.campaign.regions[id].out) continue;
    const r = regionRect(id);
    ctx.fillStyle = 'rgba(5, 8, 14, 0.55)';
    ctx.fillRect(r.x0 * cell, r.y0 * cell, (r.x1 - r.x0 + 1) * cell, (r.y1 - r.y0 + 1) * cell);
  }
  ctx.setLineDash([6, 5]);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(255, 180, 84, 0.45)';
  ctx.beginPath();
  for (let y = 0; y < REGION_GRID_H; y++) {
    for (let x = 0; x < REGION_GRID_W; x++) {
      const id = REGION_OF[y]![x];
      if (x + 1 < REGION_GRID_W && REGION_OF[y]![x + 1] !== id) {
        ctx.moveTo((x + 1) * cell, y * cell);
        ctx.lineTo((x + 1) * cell, (y + 1) * cell);
      }
      if (y + 1 < REGION_GRID_H && REGION_OF[y + 1]![x] !== id) {
        ctx.moveTo(x * cell, (y + 1) * cell);
        ctx.lineTo((x + 1) * cell, (y + 1) * cell);
      }
    }
  }
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = '600 18px system-ui, sans-serif';
  ctx.textBaseline = 'top';
  for (const id of REGION_IDS) {
    const st = party.campaign.regions[id];
    const r = regionRect(id);
    const text = REGION_NAMES[id] + ' ' + (st.out ? '✗' : st.trust);
    const x = r.x0 * cell + 6;
    const y = r.y0 * cell + 6;
    const w = ctx.measureText(text)?.width ?? text.length * 10; // мок-контексти тестів measureText не мають (jsdom)
    ctx.fillStyle = 'rgba(8, 12, 20, 0.7)';
    ctx.fillRect(x - 3, y - 2, w + 6, 23);
    ctx.fillStyle = st.out ? '#7d8794' : trustColor(st.trust);
    ctx.fillText(text, x, y);
  }
  ctx.restore();
}
