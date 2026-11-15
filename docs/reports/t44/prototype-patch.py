"""Т.44: прототип для ескізів власникові — НЕ код гри. Переписує src/render.ts і src/ui/battle.ts
варіантами за прапорцем globalThis.__v, тому працює лише в копії репозиторію:
    python3 docs/reports/t44/prototype-patch.py /шлях/до/копії
Без аргументу або в теці з .git — відмова (щоб не зіпсувати робоче дерево)."""
import os, sys
if len(sys.argv) != 2 or os.path.exists(os.path.join(sys.argv[1], '.git')):
    sys.exit('Потрібна копія репозиторію без .git: python3 prototype-patch.py /шлях/до/копії')
os.chdir(sys.argv[1])
p='src/render.ts'; s=open(p).read()
a="""      const dcol = decorCol(c.x, c.y);
      if (dcol === null) continue;
      ctx.drawImage(metroTilesImg, dcol * METRO_TILE, 0, METRO_TILE, METRO_TILE, c.x * cell, c.y * cell, cell, cell);
    }"""
assert s.count(a)==1
b="""      const dcol = decorCol(c.x, c.y);
      if (dcol === null) continue;
      const V = (globalThis as any).__v ?? {};
      const px = c.x * cell, py = c.y * cell;
      if (dcol !== 3 && V.decor === 'b') continue;
      if (dcol !== 3 && V.decor === 'c') {
        ctx.save();
        if (dcol === 1) {
          const g = ctx.createRadialGradient(px + 24, py + 24, 2, px + 24, py + 24, 20);
          g.addColorStop(0, 'rgba(255,190,90,0.55)'); g.addColorStop(0.35, 'rgba(255,170,70,0.22)'); g.addColorStop(1, 'rgba(255,170,70,0)');
          ctx.fillStyle = g; ctx.fillRect(px, py, cell, cell);
          ctx.fillStyle = 'rgba(255,214,140,0.9)'; ctx.fillRect(px + 22, py + 22, 4, 4);
        } else {
          ctx.fillStyle = 'rgba(14,22,34,0.85)'; ctx.fillRect(px + 10, py + 10, 28, 28);
          ctx.strokeStyle = 'rgba(70,200,220,0.55)'; ctx.lineWidth = 1; ctx.strokeRect(px + 10.5, py + 10.5, 27, 27);
          ctx.fillStyle = 'rgba(70,200,220,0.35)';
          for (let i = 0; i < 4; i++) ctx.fillRect(px + 14, py + 15 + i * 5, 20, 2);
        }
        ctx.restore();
        continue;
      }
      if (dcol !== 3 && V.decor === 'a') ctx.globalAlpha = 0.35;
      ctx.drawImage(metroTilesImg, dcol * METRO_TILE, 0, METRO_TILE, METRO_TILE, px, py, cell, cell);
      ctx.globalAlpha = 1;
    }"""
s=s.replace(a,b)
a="""    ctx.fillStyle = TILE_FOG;
    for (const c of cells) {
      if (!c.visible) ctx.fillRect(c.x * cell, c.y * cell, cell, cell);
    }"""
assert s.count(a)==1
b="""    const VF = (globalThis as any).__v ?? {};
    if (VF.fog === 'a') {
      ctx.save();
      ctx.globalCompositeOperation = 'saturation';
      ctx.fillStyle = '#808080';
      for (const c of cells) if (!c.visible) ctx.fillRect(c.x * cell, c.y * cell, cell, cell);
      ctx.restore();
    }
    ctx.fillStyle = VF.fog === 'b' ? 'rgba(5,8,15,0.78)' : TILE_FOG;
    for (const c of cells) {
      if (!c.visible) ctx.fillRect(c.x * cell, c.y * cell, cell, cell);
    }
    if (VF.fog === 'a') {
      ctx.save();
      ctx.strokeStyle = 'rgba(150,170,190,0.16)'; ctx.lineWidth = 1;
      for (const c of cells) {
        if (c.visible) continue;
        const x0 = c.x * cell, y0 = c.y * cell;
        ctx.beginPath();
        for (let d = 0; d < 2 * cell; d += 8) {
          ctx.moveTo(x0 + Math.max(0, d - cell), y0 + Math.min(d, cell));
          ctx.lineTo(x0 + Math.min(d, cell), y0 + Math.max(0, d - cell));
        }
        ctx.stroke();
      }
      ctx.restore();
    }"""
s=s.replace(a,b)
a="""    if (hasVisibleNeighbor(vis, c.x, c.y)) ctx.fillRect(c.x * cell, c.y * cell, cell - 1, cell - 1);
  }
}"""
assert s.count(a)==1
b="""    if (hasVisibleNeighbor(vis, c.x, c.y)) ctx.fillRect(c.x * cell, c.y * cell, cell - 1, cell - 1);
  }
  const VB = (globalThis as any).__v ?? {};
  if (VB.fog) {
    const all = new Set(cells.map((c) => c.x + ',' + c.y));
    ctx.save();
    ctx.strokeStyle = 'rgba(125,215,255,0.6)'; ctx.lineWidth = 2;
    ctx.beginPath();
    for (const c of cells) {
      if (!c.visible) continue;
      const x0 = c.x * cell, y0 = c.y * cell;
      const fog = (x: number, y: number) => all.has(x + ',' + y) && !vis.has(x + ',' + y);
      if (fog(c.x + 1, c.y)) { ctx.moveTo(x0 + cell, y0); ctx.lineTo(x0 + cell, y0 + cell); }
      if (fog(c.x - 1, c.y)) { ctx.moveTo(x0, y0); ctx.lineTo(x0, y0 + cell); }
      if (fog(c.x, c.y + 1)) { ctx.moveTo(x0, y0 + cell); ctx.lineTo(x0 + cell, y0 + cell); }
      if (fog(c.x, c.y - 1)) { ctx.moveTo(x0, y0); ctx.lineTo(x0 + cell, y0); }
    }
    ctx.stroke();
    ctx.restore();
  }
}"""
s=s.replace(a,b); open(p,'w').write(s)
p='src/ui/battle.ts'; s=open(p).read()
i=s.index("    // прев'ю шляху під курсором: зелені крапки"); j=s.index("    // П6.14: у зведеному режимі пострілу")
b="""    const sel = selectedUnit();
    const VR = (globalThis as any).__v ?? {};
    if (VR.reach && sel && playerTurnActive() && ui.fireMode === null) {
      const reach = new Set<string>();
      for (let y = 0; y < st.map.height; y++) for (let x = 0; x < st.map.width; x++) {
        if (Math.abs(x - sel.pos.x) + Math.abs(y - sel.pos.y) > sel.ap || (x === sel.pos.x && y === sel.pos.y)) continue;
        const pp = __fp(st, sel.pos, { x, y }, undefined, vis);
        if (pp && __pc(pp) <= sel.ap) reach.add(x + ',' + y);
      }
      (globalThis as any).__reachN = reach.size;
      ctx.save();
      if (VR.reach === 'a' || VR.reach === 'c') {
        ctx.fillStyle = VR.reach === 'a' ? 'rgba(127,226,160,0.16)' : 'rgba(127,226,160,0.09)';
        for (const k of reach) { const [x, y] = k.split(',').map(Number); ctx.fillRect(x * BCELL + 1, y * BCELL + 1, BCELL - 2, BCELL - 2); }
      }
      if (VR.reach === 'b' || VR.reach === 'c') {
        const inz = (x: number, y: number) => reach.has(x + ',' + y) || (x === sel.pos.x && y === sel.pos.y);
        ctx.strokeStyle = 'rgba(127,226,160,0.75)'; ctx.lineWidth = 2; ctx.beginPath();
        for (const k of [...reach, sel.pos.x + ',' + sel.pos.y]) {
          const [x, y] = k.split(',').map(Number); const x0 = x * BCELL, y0 = y * BCELL;
          if (!inz(x + 1, y)) { ctx.moveTo(x0 + BCELL - 1, y0); ctx.lineTo(x0 + BCELL - 1, y0 + BCELL); }
          if (!inz(x - 1, y)) { ctx.moveTo(x0 + 1, y0); ctx.lineTo(x0 + 1, y0 + BCELL); }
          if (!inz(x, y + 1)) { ctx.moveTo(x0, y0 + BCELL - 1); ctx.lineTo(x0 + BCELL, y0 + BCELL - 1); }
          if (!inz(x, y - 1)) { ctx.moveTo(x0, y0 + 1); ctx.lineTo(x0 + BCELL, y0 + 1); }
        }
        ctx.stroke();
      }
      ctx.restore();
    }
    if (ui.hoverPath && sel && playerTurnActive()) {
      const affordable = ui.hoverAp <= sel.ap;
      const col = affordable ? 'rgba(127,226,160,0.95)' : 'rgba(255,156,156,0.95)';
      if (VR.reach) {
        const c = (p: { x: number; y: number }) => [p.x * BCELL + BCELL / 2, p.y * BCELL + BCELL / 2] as const;
        ctx.save();
        ctx.strokeStyle = col; ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(...c(sel.pos));
        for (const p of ui.hoverPath) ctx.lineTo(...c(p));
        ctx.stroke();
        const last = ui.hoverPath[ui.hoverPath.length - 1];
        if (last) {
          const [lx, ly] = c(last);
          ctx.fillStyle = col; ctx.beginPath(); ctx.arc(lx, ly, 7, 0, Math.PI * 2); ctx.fill();
          const txt = ui.hoverAp + ' AP';
          ctx.font = 'bold 15px monospace';
          const tw = ctx.measureText(txt).width + 10;
          const bx = Math.min(Math.max(lx - tw / 2, 2), cv.width - tw - 2), by = ly - 34 < 2 ? ly + 12 : ly - 34;
          ctx.fillStyle = 'rgba(6,10,20,0.9)'; ctx.fillRect(bx, by, tw, 21);
          ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.strokeRect(bx + 0.5, by + 0.5, tw - 1, 20);
          ctx.fillStyle = col; ctx.textBaseline = 'middle'; ctx.fillText(txt, bx + 5, by + 11);
        }
        ctx.restore();
      } else {
        ctx.fillStyle = col;
        for (const p of ui.hoverPath) { ctx.beginPath(); ctx.arc(p.x * BCELL + BCELL / 2, p.y * BCELL + BCELL / 2, 3, 0, Math.PI * 2); ctx.fill(); }
      }
    }

"""
s=s[:i]+b+s[j:]
a="import { BCELL } from './grid';"
assert s.count(a)==1
s=s.replace(a,a+"\nimport { findPath as __fp, pathApCost as __pc } from '../core/map';")
open(p,'w').write(s)
