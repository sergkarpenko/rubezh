import { chromium } from '@playwright/test';
const CSS = `
.sk-steps{display:flex;gap:4px;margin:0 0 8px;align-items:stretch}
.sk-steps button{flex:1;padding:5px 4px;font-size:11px;line-height:1.25;text-align:left;margin:0}
.sk-steps button b{display:block;font-size:12px}
.sk-steps .arr{align-self:center;color:#7d8794;font-size:12px}
.sk-head{font-size:12px;color:#aab3bf;margin-bottom:6px;line-height:1.5}
.sk-card{margin:6px 0;padding:8px;border:1px solid #232a36;border-radius:6px}
.sk-top{display:flex;justify-content:space-between;gap:6px;align-items:baseline}
.sk-name{font-size:14px;color:#e6e9ee;font-weight:600}
.sk-badge{font-size:11px;padding:1px 6px;border-radius:9px;white-space:nowrap;border:1px solid #3a4352;color:#aab3bf}
.sk-badge.ok{border-color:#2f7d4a;color:#7fd69b;background:#12301d}
.sk-badge.run{border-color:#8a6d1d;color:#e0a63a;background:#2a220c}
.sk-badge.lock{border-color:#3a4352;color:#7d8794}
.sk-eff{font-size:13px;color:#c8ced6;margin:4px 0}
.sk-row{font-size:12px;color:#aab3bf;line-height:1.5}
.sk-row b{color:#e6e9ee}
.sk-bar{height:8px;border-radius:4px;background:#1a202b;border:1px solid #232a36;margin:5px 0 2px;overflow:hidden}
.sk-bar i{display:block;height:100%;background:#e0a63a}
.sk-card button{margin-top:6px}
.sk-card button.wide{width:100%}
.sk-grid{display:grid;grid-template-columns:auto 1fr;gap:1px 8px;font-size:12px;margin-top:4px}
.sk-grid span:nth-child(odd){color:#7d8794;text-transform:uppercase;font-size:10px;letter-spacing:.04em;padding-top:2px}
.sk-grid span:nth-child(even){color:#c8ced6}
.sk-grid b{color:#e6e9ee}
.sk-b-foot{display:flex;justify-content:flex-end}
`;
const P = [
 ['Композитна броня','Оперативник у броні має 12 HP замість 10',96,14,'done'],
 ['Кібернетичне око','Точність оперативника з оком — 65 % замість 60 %',72,23,'run',3],
 ['Регенеративний гель','Лікує 3 HP за 4 AP; одна штука на місію',80,24,'free'],
 ['Розширення лабораторії','Три протоколи в роботі одночасно замість двох',64,33,'nostaff'],
 ['Імпульсна граната','Пошкодження 3–5 у зоні хреста, дальність 6; зачіпає і своїх',112,30,'lock','Регенеративний гель'],
];
const days = (pts) => `≈ ${pts} діб з одним техномантом, ${Math.ceil(pts/2)} — з двома`;
const badge = (s, x) => s==='done' ? '<span class="sk-badge ok">завершено</span>' : s==='run' ? '<span class="sk-badge run">у роботі</span>' : s==='free' ? '<span class="sk-badge">доступний</span>' : s==='nostaff' ? '<span class="sk-badge lock">бракує кредитів</span>' : `<span class="sk-badge lock">після «${x}»</span>`;
const steps = `<div class="sk-steps"><button><b>1. Дослідити</b>протокол тут</button><span class="arr">→</span><button><b>2. Виготовити</b>у «Кузні»</button><span class="arr">→</span><button><b>3. Видати</b>вкладка «Загін»</button></div>`;
const head = `<div class="sk-head">Техномантів: <b>1</b> · утримання 10 кр. за добу<br>Кожен техномант дає 1 очко потоку за добу<br>Протоколів у роботі: <b>1 з 2</b></div><button>Вербувати техноманта — 100 кр.</button>`;
function cardA([n,e,c,p,s,x]){
  let body = `<div class="sk-top"><span class="sk-name">${n}</span>${badge(s,x)}</div><div class="sk-eff">${e}</div>`;
  if(s==='done') body += `<button class="research wide">Замовити в «Кузні» — 60 кр.</button>`;
  else if(s==='run') body += `<div class="sk-bar"><i style="width:${x/p*100}%"></i></div><div class="sk-row"><b>${x} з ${p}</b> очок потоку · ще ≈ ${p-x} діб</div>`;
  else body += `<div class="sk-row">Ціна <b>${c} кр.</b></div><div class="sk-row">Час ${days(p)}</div><button class="research wide" ${s==='free'?'':'disabled'}>Дослідити — ${c} кр.</button>`;
  return `<div class="sk-card">${body}</div>`;
}
function cardB([n,e,c,p,s,x]){
  let g = `<span>Дає</span><span>${e}</span>`;
  if(s==='run') g += `<span>Стан</span><span><b>${x} з ${p}</b> очок потоку · ще ≈ ${p-x} діб<div class="sk-bar"><i style="width:${x/p*100}%"></i></div></span>`;
  else if(s!=='done') g += `<span>Ціна</span><span><b>${c} кр.</b></span><span>Час</span><span>${days(p)}</span>`;
  let btn = s==='done' ? `<button class="research">Замовити в «Кузні» — 60 кр.</button>` : s==='run' ? '' : `<button class="research" ${s==='free'?'':'disabled'}>Дослідити</button>`;
  return `<div class="sk-card"><div class="sk-top"><span class="sk-name">${n}</span>${badge(s,x)}</div><div class="sk-grid">${g}</div><div class="sk-b-foot">${btn}</div></div>`;
}
const b = await chromium.launch({ executablePath: process.env.E2E_CHROME });
for (const [name, w, h] of [['d1366',1366,768],['ipad',1024,768]]) {
  const p = await b.newPage({ viewport: { width: w, height: 2400 } });
  await p.goto('http://localhost:4173/rubezh/'); await p.waitForTimeout(500);
  await p.locator('#btn-help-close').click(); await p.locator('#btn-start-new').click();
  await p.locator('#new-game-seed').fill('42'); await p.locator('#btn-new-game-start').click(); await p.waitForTimeout(400);
  await p.locator('#status-tab-base').click();
  await p.locator('#btn-hire-scientist').click();
  if (await p.locator('#btn-start-1').isEnabled()) await p.locator('#btn-start-1').click();
  for (let i=0;i<3*48;i++) await p.locator('#btn-tick').click();
  const sec = p.locator('section.panel:has(#research)');
  const m = async (tag) => console.log(name, tag, await p.evaluate(() => { const r=document.getElementById('research').getBoundingClientRect(); const s=document.getElementById('status').getBoundingClientRect(); return 'research '+Math.round(r.width)+'x'+Math.round(r.height)+' status w '+Math.round(s.width); }));
  await m('before'); await sec.screenshot({ path: `out/${name}-before.png` });
  await p.addStyleTag({ content: CSS });
  for (const [v, f] of [['A', cardA], ['B', cardB]]) {
    await p.evaluate((html) => { document.getElementById('research').innerHTML = html; }, steps + head + P.map(f).join(''));
    await m(v); await sec.screenshot({ path: `out/${name}-${v}.png` });
  }
  if (name==='d1366') {
    await p.setViewportSize({width:1366,height:768});
    await p.locator('#btn-menu').click().catch(()=>{}); await p.locator('#btn-menu-help').click().catch(()=>{}); await p.waitForTimeout(200);
    await p.evaluate(() => { const c=document.querySelector('.help-cols'); const d=document.createElement('div'); d.innerHTML='<h3>Наука і спорядження</h3><ul><li><b>Техноманти</b> досліджують протоколи: кожен дає 1 очко потоку за добу і коштує 10 кр. за добу.</li><li><b>Протокол</b> оплачується кредитами на старті й завершується, коли набере свої очки потоку; у роботі — до 2 протоколів одночасно.</li><li><b>«Кузня»</b>: завершений протокол відкриває предмет — замовте його за кредити й дочекайтесь виготовлення.</li><li><b>Видача</b>: готовий предмет видайте оперативнику на вкладці «Загін». Гель і граната витрачаються в бою, броня й око — ні.</li></ul>'; c.appendChild(d); });
    console.log('help', await p.evaluate(() => { const r=document.querySelector('.help-box').getBoundingClientRect(); return Math.round(r.width)+'x'+Math.round(r.height)+' cols '+getComputedStyle(document.querySelector('.help-cols')).gridTemplateColumns; }));
    await p.screenshot({ path: 'out/help.png' });
  }
  await p.close();
}
await b.close();
