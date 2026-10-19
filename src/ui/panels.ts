// пR.2 (ADR-0037): панелі стану і топбара — винесено з main.ts без зміни
// поведінки. Тут — рендери колонки стану (сканери НЛО, винищувач, фінанси,
// ростер), чипи топбара (годинник, баланс, боєготові, кампанія), контекст-
// стрічка повітряного бою (П7.5) і екран перемоги кампанії (П8.3). Стан
// застосунку (party/mission/gameOver) модуль знає лише через Deps-інтерфейс;
// логіка ядра — виклики src/core, DOM — через хелпер el (src/ui/dom.ts).

import { RADAR_RANGE, TICK_MINUTES, detectedUfos, geoClock, geoDay, missionTargets } from '../core/geo';
import {
  FIGHTER_MAX_HP,
  FIGHTER_REPAIR_COST,
  RANGE_PROFILES,
  interceptRound,
  startIntercept,
  startRepair,
  type InterceptChoice,
} from '../core/intercept';
import { hirePrice } from '../core/economy';
// П11.6 (ADR-0058): екіпірування в картці солдата ростеру — броня/оптика
// (постійні), аптечка/граната (витратні); дії — лише на геосцені.
import { equipItem, unequipItem, itemName, type SoldierEquipment, type SoldierItemId } from '../core/workshop';
import { readySoldiers } from '../core/squad';
import type { Party } from '../core/save';
import { itemEffect } from './effects';
import { drawAnimFrame, drawBaseSprite, drawFighterSprite, drawGeoTerrain, drawUfoSprite } from '../render';
import type { Anim } from '../core/render-core';
import { el } from './dom';
import { GCELL } from './grid';
import type { LogCat } from './journal';

// П7: колір HP (чиста функція): повне — зелений, понад половину — жовтий, інакше — червоний.
export function hpColor(hp: number, maxHp: number): string {
  return hp >= maxHp ? '#7fbf7f' : hp > maxHp / 2 ? '#d8b25a' : '#ff9c9c';
}

// П11.6 (ADR-0058): предмети спорядження у картці оперативника — коротка мітка,
// ключ екіпірування і предмет каталогу «Кузні». Порядок фіксований (детермінізм).
// П12.6 (ADR-0064): ключі каталогу англійські; назви — з каталогу (WORKSHOP_CATALOG).
const EQUIP_ITEMS: [SoldierItemId, keyof SoldierEquipment, string][] = [
  ['armor', 'armor', 'броня'],
  ['optics', 'optics', 'око'],
  ['medkit', 'medkit', 'гель'],
  ['grenade', 'grenade', 'граната'],
];

// Залежності від шару застосунку (main.ts): читання стану і дії панелей.
// Панелі не знають, як стан зберігається у застосунку.
export interface PanelsDeps {
  getParty(): Party;
  inBattle(): boolean; // тактичний бій триває (час геосцени заморожено, ADR-0026)
  isGameOver(): boolean; // банкрутство (ADR-0021)
  journal(text: string, cls?: string, cat?: LogCat): void;
  renderAll(): void;
  launchMission(ufoId: string): void;
  drainGeo(): void; // нові geo-події → журнал (seen-трекінг у src/ui/journal.ts)
  drainEcon(): void; // нові події економіки → журнал
  activeGeoAnim(): Anim | null; // активна анімація геосцени (пульс радара, П6.9)
  geoAnimNow(): number; // час активної анімації геосцени
  victoryDismissed(): boolean; // П8.3a: гравець закрив екран перемоги і продовжує гру (endless)
}

export interface Panels {
  renderGeo(): void;
  renderUfos(): void;
  renderFighter(): void;
  renderFinances(): void;
  renderRoster(): void;
  renderInterceptCtx(): void;
  renderCampaign(): void; // П8.3: чипи кампанії + екран перемоги
}

export function createPanels(deps: PanelsDeps): Panels {
  function renderGeo(): void {
    const party = deps.getParty();
    deps.drainGeo();
    const cv = el<HTMLCanvasElement>('geo');
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, cv.width, cv.height);

    // П12.7 (ADR-0064): терен геосцени — двотоновий синьо-чорний з неоновою
    // сіткою (ціан «Рубіжу»); кадр малюється з нуля (урок П6.6).
    drawGeoTerrain(ctx, cv.width, cv.height, GCELL);

    const b = party.geo.base;
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = 'rgba(0,229,255,0.25)'; // П12.7: межа сенсорної сітки — приглушений неоновий ціан
    ctx.strokeRect((b.x - RADAR_RANGE) * GCELL, (b.y - RADAR_RANGE) * GCELL, (2 * RADAR_RANGE + 1) * GCELL, (2 * RADAR_RANGE + 1) * GCELL);
    ctx.setLineDash([]);

    // П6.7 (ADR-0029): статичні спрайти геосцени — база і позначки НЛО (туман:
    // detectedUfos повертає лише виявлені — невиявлені в малювання не потрапляють).
    drawBaseSprite(ctx, { cx: b.x * GCELL + GCELL / 2, cy: b.y * GCELL + GCELL / 2, size: GCELL });

    for (const u of detectedUfos(party.geo)) {
      drawUfoSprite(ctx, {
        cx: u.pos.x * GCELL + GCELL / 2,
        cy: u.pos.y * GCELL + GCELL / 2,
        landed: u.status === 'приземлився',
        kind: u.kind,
      });
    }
    // П7.5 (ADR-0032): маркер винищувача на геосцені — лише поза базою (на базі він у
    // спрайті бази; погоня/бій — дельта-крило поруч із позначкою НЛО).
    const fgt = party.intercept.fighter;
    if (fgt.status === 'погоня' || fgt.status === 'бій') {
      drawFighterSprite(ctx, { cx: fgt.pos.x * GCELL + GCELL / 2, cy: fgt.pos.y * GCELL + GCELL / 2 });
    }

    // П6.9 (ADR-0029): анімаційний шар геосцени — пульс радара поверх статичного
    // кадру (кадр малюється з нуля — clearRect вище; урок П6.6). П14.5: cw/ch —
    // розміри buffer'а (скан-зона замикається по X — зсунуті копії; клімп хвоста).
    const ga = deps.activeGeoAnim();
    if (ga !== null) drawAnimFrame(ctx, ga, deps.geoAnimNow(), GCELL, 0, cv.width, cv.height);

    el('clock').textContent = geoClock(party.geo);
    const busy = deps.inBattle();
    (el('btn-tick') as HTMLButtonElement).disabled = busy || deps.isGameOver();
    (el('btn-day') as HTMLButtonElement).disabled = busy || deps.isGameOver();
  }

  function renderUfos(): void {
    const party = deps.getParty();
    const box = el('ufos');
    box.innerHTML = '';
    const detected = detectedUfos(party.geo);
    const targets = new Set(missionTargets(party.geo).map((u) => u.id));
    if (detected.length === 0) {
      box.innerHTML = '<div class="meta">Нічого не виявлено — рухайте час.</div>';
      return;
    }
    for (const u of detected) {
      const div = document.createElement('div');
      div.className = 'ufo';
      const info = u.status === 'приземлився' ? 'вікно ' + (u.landedTicksLeft * TICK_MINUTES) / 60 + ' год' : 'у повітрі';
      div.innerHTML =
        '<b>' + u.kind + '</b> · ' + u.status + '<br><span class="meta">(' + u.pos.x + ',' + u.pos.y + ') · ' + info + '</span>';
      // П7.4 (ADR-0032): «Перехопити» — лише для виявленого НЛО в повітрі; під час ремонту
      // або погоні запуск заблокований (пошкоджений винищувач не стартує)
      if (u.status === 'летить' && party.intercept.fighter.status === 'на базі') {
        const ib = document.createElement('button');
        ib.className = 'intercept';
        ib.textContent = '✦ Перехопити';
        const readyFighter = party.intercept.fighter.hp === FIGHTER_MAX_HP;
        ib.disabled = deps.inBattle() || deps.isGameOver() || !readyFighter;
        ib.title = !readyFighter ? 'Перехоплювач пошкоджений — спочатку ремонт' : 'Підняти перехоплюач на перехоплення';
        ib.onclick = () => {
          if (deps.inBattle()) return;
          try {
            startIntercept(party.intercept, party.geo, u.id);
          } catch (e) {
            deps.journal('✗ ' + (e as Error).message, 'lose');
          }
          deps.renderAll();
        };
        div.appendChild(ib);
      }
      if (targets.has(u.id)) {
        const btn = document.createElement('button');
        btn.className = 'mission';
        btn.textContent = '▶ Запустити місію';
        // П4.5 (ADR-0021): поранені в лікарні не боєготові — місію запускати ніким
        const ready = readySoldiers(party.roster).length;
        btn.disabled = deps.inBattle() || deps.isGameOver() || ready === 0;
        if (deps.isGameOver()) btn.title = 'Партію програно — банкрутство';
        else if (ready === 0)
          btn.title =
            party.roster.soldiers.length === 0
              ? 'Ростер порожній — вербування оперативника за кредити'
              : 'Усі оперативники поранені — чекайте одужання або вербуйте';
        btn.onclick = () => deps.launchMission(u.id);
        div.appendChild(btn);
      }
      box.appendChild(div);
    }
  }

  // П4.5 (ADR-0021): панель фінансів — баланс, кнопка найму, надходження в журнал.
  function renderFinances(): void {
    const party = deps.getParty();
    deps.drainEcon();
    // ADR-0027: баланс у двох місцях — чип топбару і картка «Фінанси» (дублювання свідоме)
    const moneyText = deps.isGameOver() ? 'БАНКРУТ' : String(party.econ.money);
    el('money').textContent = moneyText;
    el('money-card').textContent = moneyText;
    const hire = el<HTMLButtonElement>('btn-hire');
    // П11.8: ціна найму за пресетом (ADR-0058 — «легкий» 120, «норма» 100, «складний» 90).
    const hireCost = hirePrice(party.campaign.preset);
    hire.disabled = deps.isGameOver() || party.econ.money < hireCost;
    hire.title = hire.disabled
      ? 'Недостатньо кредитів (ціна вербування ' + hireCost + ')'
      : 'Новий оперативник у кінець ростеру (−' + hireCost + ')';
  }

  // П7.5 (ADR-0032/0027): контекст-стрічка повітряного бою у фокусній зоні — видима лише
  // під час погоні/бою (на базі/ремонті джерело правди — панель «Винищувач» у колонці стану).
  function renderInterceptCtx(): void {
    const party = deps.getParty();
    const f = party.intercept.fighter;
    const active = f.status === 'погоня' || f.status === 'бій';
    el('ictx').classList.toggle('hidden', !active);
    if (!active) return;
    el('ictx-target').textContent = f.targetId ?? '—';
    el('ictx-status').textContent = f.status;
    el('ictx-round').textContent = f.status === 'бій' ? String(party.intercept.round) : '—';
    el('ictx-fighter').textContent = 'HP ' + f.hp + '/' + FIGHTER_MAX_HP;
    const ufo = party.geo.ufos.find((u) => u.id === party.intercept.activeUfoId);
    el('ictx-ufo').textContent = ufo ? 'HP ' + party.intercept.ufoHp[ufo.id] : '—';
  }

  // П7.4 (ADR-0032): панель винищувача — статус/HP у колонці стану; кнопки дій залежно
  // від стану: «Перехопити» (боєготовий + виявлений НЛО в повітрі), «Ремонт (50)»
  // (пошкоджений на базі), дистанції бою (стан «бій» — рішення гравця кожен раунд).
  function renderFighter(): void {
    const party = deps.getParty();
    const box = el('fighter');
    box.innerHTML = '';
    const f = party.intercept.fighter;
    renderInterceptCtx(); // П7.5: контекст-стрічка повітряного бою у фокусній зоні
    const statusText =
      f.status === 'ремонт'
        ? 'ремонт: ' + f.repairTicksLeft + ' тік(и)'
        : f.status === 'на базі'
          ? f.hp < FIGHTER_MAX_HP
            ? 'на базі · пошкоджений'
            : 'боєготовий'
          : f.status;
    const head = document.createElement('div');
    head.className = 'meta';
    head.style.marginBottom = '4px';
    head.innerHTML =
      'Статус: <b>' +
      statusText +
      '</b> · HP <span style="color:' +
      hpColor(f.hp, FIGHTER_MAX_HP) +
      '">' +
      f.hp +
      '/' +
      FIGHTER_MAX_HP +
      '</span>';
    box.appendChild(head);
    if (f.status === 'бій') {
      const ufo = party.geo.ufos.find((u) => u.id === party.intercept.activeUfoId);
      const ctx = document.createElement('div');
      ctx.className = 'meta';
      ctx.style.marginBottom = '4px';
      ctx.textContent =
        'Бій з ' + (ufo ? ufo.id : '?') + ' · раунд ' + party.intercept.round + ' · зонд HP ' + (ufo ? party.intercept.ufoHp[ufo.id] : '?');
      box.appendChild(ctx);
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:4px';
      for (const c of ['далека', 'середня', 'впритул', 'відступ'] as const) {
        const b = document.createElement('button');
        b.className = 'intercept-range';
        b.dataset.choice = c;
        b.textContent = c + (c !== 'відступ' ? ' (~' + Math.round(RANGE_PROFILES[c].fighterHitChance * 100) + '%)' : '');
        b.disabled = deps.inBattle();
        b.onclick = () => {
          try {
            interceptRound(party.intercept, party.geo, c as InterceptChoice, party.econ, party.campaign.preset);
          } catch (e) {
            deps.journal('✗ ' + (e as Error).message, 'lose');
          }
          deps.renderAll();
        };
        row.appendChild(b);
      }
      box.appendChild(row);
    }
    if (f.status === 'на базі' && f.hp < FIGHTER_MAX_HP) {
      const b = document.createElement('button');
      b.id = 'btn-repair';
      b.textContent = 'Ремонт (' + FIGHTER_REPAIR_COST + ')';
      b.disabled = deps.isGameOver() || party.econ.money < FIGHTER_REPAIR_COST;
      b.title = b.disabled
        ? 'Недостатньо кредитів (ціна ремонту ' + FIGHTER_REPAIR_COST + ')'
        : 'Повний HP після ремонту (−' + FIGHTER_REPAIR_COST + ')';
      b.onclick = () => {
        try {
          startRepair(party.intercept, party.geo, party.econ);
        } catch (e) {
          deps.journal('✗ ' + (e as Error).message, 'lose', 'econ');
        }
        deps.renderAll();
      };
      box.appendChild(b);
    }
  }

  function renderRoster(): void {
    const party = deps.getParty();
    const box = el('roster');
    box.innerHTML = '';
    const soldiers = party.roster.soldiers;
    // П11.6: екіпірування — лише на геосцені; у бою/банкрутстві кнопки вимкнені
    const busy = deps.inBattle() || deps.isGameOver();
    // ADR-0027: чип боєготових у топбарі — завжди видний стан партії
    const readyN = readySoldiers(party.roster).length;
    el('ready').textContent = readyN + '/' + soldiers.length;
    if (soldiers.length === 0) {
      box.innerHTML =
        '<div style="color:#ff9c9c">Загін втрачено.</div>' +
        (party.econ.money >= hirePrice(party.campaign.preset)
          ? '<div class="meta">Вербування доступне — кнопка «Вербувати оперативника».</div>'
          : '<div class="meta">Кредитів на вербування немає.</div>');
      return;
    }
    const head = document.createElement('div');
    head.className = 'meta';
    head.style.marginBottom = '4px';
    head.textContent = soldiers.length + ' оперативників (' + readyN + ' боєготових)';
    box.appendChild(head);
    for (const s of soldiers) {
      const heal = party.roster.hospital[s.id];
      const row = document.createElement('div');
      row.className = 'soldier';
      row.innerHTML =
        '<span style="min-width:64px">' +
        s.name +
        '</span>' +
        '<span style="color:' +
        hpColor(s.hp, s.maxHp) +
        '">HP ' +
        s.hp +
        '/' +
        s.maxHp +
        '</span>' +
        (heal !== undefined ? '<span class="meta">лікарня: ' + heal + ' тик(и)</span>' : '') +
        '<span class="kills">⚔ ' +
        s.kills +
        '</span>';
      box.appendChild(row);
      // П11.6 (ADR-0058): екіпірування в картці оперативника — кнопки
      // «спорядити» зі складу / «зняти» назад на склад; лише на геосцені
      // (прецедент збереження). Предмет на оперативникові — мітка ✓.
      // П12.5 (ADR-0065): підказка спорядження несе числовий ефект ДО дії —
      // «зараз → стане» цього оперативника, числа з констант (effects.ts).
      // П12.6: назви предметів — з каталогу (ідентифікатор — не відображення).
      const eq = party.workshop.equipped[s.id];
      const eqRow = document.createElement('div');
      eqRow.className = 'meta';
      eqRow.style.marginBottom = '4px';
      for (const [itemId, slot, label] of EQUIP_ITEMS) {
        const on = eq?.[slot] === true;
        const b = document.createElement('button');
        b.id = 'btn-equip-' + s.id + '-' + slot;
        b.textContent = on ? label + ' ✓' : label;
        b.disabled = busy || (!on && party.workshop.store[itemId] <= 0);
        b.title = on
          ? 'Зняти «' + itemName(itemId) + '» — назад на склад'
          : party.workshop.store[itemId] > 0
            ? 'Спорядити «' + itemName(itemId) + '» зі складу — ' + itemEffect(itemId, s)
            : '«' + itemName(itemId) + '» немає на складі — замовте в «Кузні»';
        b.onclick = () => {
          try {
            if (on) unequipItem(party.workshop, s, itemId);
            else equipItem(party.workshop, s, itemId);
          } catch (e) {
            deps.journal('✗ ' + (e as Error).message, 'lose', 'base');
          }
          deps.renderAll();
        };
        eqRow.appendChild(b);
      }
      box.appendChild(eqRow);
    }
  }

  // П8.3: чипи кампанії у топбарі + екран перемоги (статус кампанії, доба N/30).
  function renderCampaign(): void {
    const party = deps.getParty();
    el('campaign-status').textContent = 'кампанія: ' + party.campaign.status;
    el('campaign-progress').textContent = 'Д' + geoDay(party.geo) + '/30';
    el('campaign-progress').classList.toggle('hidden', deps.inBattle());
    // П8.3: відображення екрану перемоги кампанії
    const victoryPanel = el('campaign-victory');
    const isVictory = party.campaign.status === 'перемога';
    // П8.3a: endless (рішення власника 2026-10-15) — «Грати далі» ховає екран,
    // але статус «перемога» і зафіксований рахунок лишаються (EARS Фази 8)
    victoryPanel.classList.toggle('hidden', !isVictory || deps.victoryDismissed());
    if (isVictory && party.campaign.score) {
      el('campaign-score').textContent = String(party.campaign.score.total);
    }
  }

  return {
    renderGeo,
    renderUfos,
    renderFighter,
    renderFinances,
    renderRoster,
    renderInterceptCtx,
    renderCampaign,
  };
}
