// пR.2 (ADR-0037): панель збереження (П5.3, ADR-0026) — винесено з main.ts без
// зміни поведінки. Ядро бачить лише абстракцію SlotStore (save.ts); тут —
// браузерний адаптер (localStorage, ключі rubezh.save.1..3), стан доступності
// сховища і DOM панелі слотів. Збереження вимкнене у тактичному бою
// (патерн П6.3, ADR-0026) і в повітряному бою перехоплення (П7.5).

import { SAVE_SLOTS, eraseSlot, loadFromSlot, saveToSlot, slotMeta, type Party, type SlotStore } from '../core/save';
import { geoClock } from '../core/geo';
import { el } from './dom';

// Залежності від шару застосунку (main.ts): читання стану і дії при збереженні/
// завантаженні. Панель не знає, як саме стан зберігається в застосунку.
export interface SavePanelDeps {
  getParty(): Party;
  adoptLoaded(p: Party): void; // прийняти завантажену партію у стан застосунку (adoptParty)
  inBattle(): boolean; // тактичний бій триває
  interceptBusy(): boolean; // перехоплення: погоня/бій
  isGameOver(): boolean; // банкрутство (ADR-0021)
  journal(text: string, cls?: string): void;
  renderAll(): void;
  // П12.2 (ADR-0065): успішне збереження — шар застосунку фіксує точку
  // «без незбережених змін» (підтвердження виходу, ADR-0026).
  onSaved?(slot: number): void;
}

export interface SavePanel {
  render(): void;
  save(slot: number): void;
  load(slot: number): void;
  del(slot: number): void;
  detectStorage(): void;
  isStorageOk(): boolean;
  slotsEmpty(): boolean; // П9.1: усі 3 слоти порожні — перший візит (EARS Фази 9)
  latestSlot(): number | null; // П12.2 (ADR-0065): останній активний слот для «Продовжити»
}

// ADR-0026: сховище — localStorage, ключі rubezh.save.1..3. Ядро бачить лише
// абстракцію SlotStore (save.ts); тут — конкретний браузерний адаптер.
const store: SlotStore = {
  read: (slot) => {
    try {
      return localStorage.getItem('rubezh.save.' + slot);
    } catch {
      return null;
    }
  },
  write: (slot, data) => localStorage.setItem('rubezh.save.' + slot, data),
  remove: (slot) => localStorage.removeItem('rubezh.save.' + slot),
};

export function createSavePanel(deps: SavePanelDeps): SavePanel {
  // Недоступний localStorage (приватний режим тощо) — повідомлення в UI (ADR-0026).
  let storageOk = true;

  function detectStorage(): void {
    try {
      localStorage.setItem('rubezh.probe', '1');
      localStorage.removeItem('rubezh.probe');
      storageOk = true;
    } catch {
      storageOk = false;
    }
  }

  function renderSavePanel(): void {
    const box = el('save-panel');
    box.innerHTML = '';
    if (!storageOk) {
      box.innerHTML = '<div class="meta">Сховище недоступне (приватний режим?) — збереження вимкнено.</div>';
      return;
    }
    // П7.5 (ADR-0026): збереження вимкнене і в повітряному бою — погоня/бій не переривається
    const busy = deps.inBattle() || deps.interceptBusy();
    for (let slot = 1; slot <= SAVE_SLOTS; slot++) {
      const row = document.createElement('div');
      row.className = 'save-row';
      const meta = document.createElement('span');
      meta.id = 'slot-' + slot;
      meta.className = 'meta';
      const json = store.read(slot);
      const empty = json === null;
      if (json === null) meta.textContent = '—';
      else {
        try {
          const m = slotMeta(json);
          const mnt = m.minute % 1440;
          meta.textContent =
            'Д' +
            m.day +
            ' ' +
            String(Math.floor(mnt / 60)).padStart(2, '0') +
            ':' +
            String(mnt % 60).padStart(2, '0') +
            ' · сід ' +
            m.seed +
            ' · ' +
            m.money +
            ' · ' +
            m.aliveSoldiers +
            ' опер. · ' +
            m.savedAt.slice(0, 16).replace('T', ' ');
        } catch {
          meta.textContent = 'пошкоджений слот';
        }
      }
      const bSave = document.createElement('button');
      bSave.id = 'btn-save-' + slot;
      bSave.textContent = 'Зберегти';
      bSave.disabled = busy || deps.isGameOver();
      bSave.onclick = () => saveSlot(slot);
      const bLoad = document.createElement('button');
      bLoad.id = 'btn-load-' + slot;
      bLoad.textContent = 'Завантажити';
      bLoad.disabled = busy || empty;
      bLoad.onclick = () => loadSlot(slot);
      const bDel = document.createElement('button');
      bDel.id = 'btn-del-' + slot;
      bDel.textContent = 'Видалити';
      bDel.disabled = busy || empty;
      bDel.onclick = () => deleteSlot(slot);
      row.append(meta, bSave, bLoad, bDel);
      box.appendChild(row);
    }
  }

  // ADR-0026: збереження лише на геосцені (місія не переривається).
  function saveSlot(slot: number): void {
    // П7.5 (ADR-0026): під час погоні/бою збереження вимкнене (патерн П6.3 — бій не переривається)
    if (deps.inBattle() || deps.isGameOver() || deps.interceptBusy()) return;
    try {
      saveToSlot(store, slot, deps.getParty(), new Date().toISOString());
      deps.journal('Збережено: слот ' + slot + '.');
      deps.onSaved?.(slot); // П12.2: точка «незбережених змін немає» (ADR-0026)
    } catch (e) {
      deps.journal('✗ Збереження не вдалось: ' + (e as Error).message, 'lose');
    }
    renderSavePanel();
  }

  function loadSlot(slot: number): void {
    if (deps.inBattle()) return;
    try {
      deps.adoptLoaded(loadFromSlot(store, slot));
      const party = deps.getParty();
      deps.journal('Завантажено: слот ' + slot + ' — ' + geoClock(party.geo) + ', баланс ' + party.econ.money + '.');
    } catch (e) {
      deps.journal('✗ Завантаження не вдалось: ' + (e as Error).message, 'lose');
    }
    deps.renderAll();
  }

  function deleteSlot(slot: number): void {
    if (deps.inBattle()) return;
    try {
      eraseSlot(store, slot);
      deps.journal('Слот ' + slot + ' видалено.');
    } catch (e) {
      deps.journal('✗ ' + (e as Error).message, 'lose');
    }
    renderSavePanel();
  }

  // П9.1 (EARS Фази 9): перший візит — немає сейвів у жодному слоті.
  function slotsEmpty(): boolean {
    for (let slot = 1; slot <= SAVE_SLOTS; slot++) {
      if (store.read(slot) !== null) return false;
    }
    return true;
  }

  // П12.2 (ADR-0065): «Продовжити» — останній активний слот (найпізніший
  // savedAt; за рівності — старший номер слота). Пошкоджені слоти пропускаємо
  // (метадані не читаються); без сейвів — null.
  function latestSlot(): number | null {
    let best: number | null = null;
    let bestAt = '';
    for (let slot = 1; slot <= SAVE_SLOTS; slot++) {
      const json = store.read(slot);
      if (json === null) continue;
      try {
        const at = slotMeta(json).savedAt;
        if (best === null || at >= bestAt) {
          best = slot;
          bestAt = at;
        }
      } catch {
        continue; // пошкоджений слот — не кандидат на продовження
      }
    }
    return best;
  }

  return {
    render: renderSavePanel,
    save: saveSlot,
    load: loadSlot,
    del: deleteSlot,
    detectStorage,
    isStorageOk: () => storageOk,
    slotsEmpty,
    latestSlot,
  };
}
