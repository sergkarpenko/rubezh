// @vitest-environment jsdom
// П11.7 (ADR-0059): синтез за моком SoundContext (jsdom без WebAudio),
// детермінізм шумового буфера і критерій 1 — байт-у-байт інваріант:
// дрен журналу зі звуком «увімкненим» (мок-контекст) не міняє лог бою,
// rng.state і DOM-журнал (патерн ізоляції П11.2/П11.4).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createGame,
  endTurn,
  makeUnit,
  moveUnit,
  mulberry32,
  resolveAttack,
  type GameMap,
  type GameState,
  type StatefulRng,
} from '../core/combat';
import { createParty } from '../core/save';
import { createJournal, type JournalDeps } from './journal';
import { createSound, type SoundBufferSource, type SoundContext, type SoundStore } from './audio';

// --- Мок SoundContext: записує осцилятори/шум і параметри обвідних ---

interface MockRec {
  osc: { type: string; freq: { v: number; t: number }[]; start: number; stop: number }[];
  src: { start: number; stop: number; len: number }[];
  gain: { v: number; t: number }[][];
  buffers: { ch: number; len: number; data: Float32Array }[];
  resume: ReturnType<typeof vi.fn>;
}

function mockContext(state = 'running'): { ctx: SoundContext; rec: MockRec } {
  const rec: MockRec = { osc: [], src: [], gain: [], buffers: [], resume: vi.fn() };
  const param = (r: { v: number; t: number }[]) => ({
    value: 0,
    setValueAtTime(v: number, t: number) {
      r.push({ v, t });
    },
    exponentialRampToValueAtTime(v: number, t: number) {
      r.push({ v, t });
    },
  });
  const ctx: SoundContext = {
    currentTime: 0,
    sampleRate: 44100,
    state,
    destination: 'dest',
    resume: rec.resume,
    createOscillator: () => {
      const o = { type: '', freq: [] as { v: number; t: number }[], start: -1, stop: -1 };
      rec.osc.push(o);
      return {
        get type() {
          return o.type;
        },
        set type(v: string) {
          o.type = v;
        },
        frequency: param(o.freq),
        connect: () => ({}),
        start: (t: number) => (o.start = t),
        stop: (t: number) => (o.stop = t),
      };
    },
    createGain: () => {
      const env: { v: number; t: number }[] = [];
      rec.gain.push(env);
      return { gain: param(env), connect: () => ({}) };
    },
    createBuffer: (ch: number, len: number) => {
      const data = new Float32Array(len);
      rec.buffers.push({ ch, len, data }); // один канал — ch = 1 (ADR-0059)
      return { getChannelData: () => data };
    },
    createBufferSource: () => {
      const s = { start: -1, stop: -1, len: 0 };
      rec.src.push(s);
      let buf: { getChannelData(ch: number): Float32Array } | null = null;
      return {
        connect: () => ({}),
        start: (t: number) => (s.start = t),
        stop: (t: number) => (s.stop = t),
        get buffer() {
          return buf;
        },
        set buffer(b: unknown) {
          buf = b as { getChannelData(ch: number): Float32Array };
          s.len = buf ? buf.getChannelData(0).length : 0;
        },
      } as SoundBufferSource;
    },
  };
  return { ctx, rec };
}

const memStore = (initial: string | null = null): SoundStore => {
  const s = { value: initial };
  return {
    read: () => s.value,
    write: (v) => (s.value = v),
  };
};

// --- Синтез: рецепти (детерміновані константи ADR-0059) ---

describe('Синтез: рецепти за моком SoundContext', () => {
  const sound = (m = mockContext()) => ({ s: createSound({ makeContext: () => m.ctx, store: memStore() }), m });

  it('click: один square-осцилятор 660→440, 0.05с', () => {
    const { s, m } = sound();
    s.play('click');
    expect(m.rec.osc).toHaveLength(1);
    expect(m.rec.osc[0].type).toBe('square');
    expect(m.rec.osc[0].freq).toEqual([
      { v: 660, t: 0 },
      { v: 440, t: 0.05 },
    ]);
    expect(m.rec.osc[0]).toMatchObject({ start: 0, stop: 0.07 });
    expect(m.rec.gain[0]).toEqual([
      { v: 0.04, t: 0 },
      { v: 0.0001, t: 0.05 },
    ]);
  });

  it('сигнатури режимів різні: snap — шум+квадрат, aimed — свист sawtooth, auto — коротший', () => {
    const mk = (name: Parameters<ReturnType<typeof createSound>['play']>[0]) => {
      const { s, m } = sound();
      s.play(name);
      return m.rec;
    };
    const snap = mk('shot-snap');
    expect(snap.src).toHaveLength(1); // шумовий спалах
    expect(snap.src[0].len).toBe(11025); // floor(44100 * 0.25)
    expect(snap.osc[0].type).toBe('square');
    expect(snap.osc[0].start).toBe(0);
    expect(snap.osc[0].stop).toBeCloseTo(0.14);
    const aimed = mk('shot-aimed');
    expect(aimed.src).toHaveLength(0); // без шуму
    expect(aimed.osc[0].type).toBe('sawtooth');
    expect(aimed.osc[0].freq).toEqual([
      { v: 900, t: 0 },
      { v: 240, t: 0.18 },
    ]);
    const auto = mk('shot-auto');
    expect(auto.osc[0].stop).toBeCloseTo(0.09); // коротший імпульс
  });

  it('багатонотні: detect — 2 ноти, win — 3 висхідні; події мапляться у рецепти', () => {
    const { s, m } = sound();
    s.geoEvent({ type: 'mission_won' } as never);
    expect(m.rec.osc).toHaveLength(3);
    expect(m.rec.osc.map((o) => o.freq[0].v)).toEqual([523.25, 659.25, 783.99]);
    expect(m.rec.osc.map((o) => o.start)).toEqual([0, 0.12, 0.24]);
    const m2 = mockContext();
    const s2 = createSound({ makeContext: () => m2.ctx, store: memStore() });
    s2.geoEvent({ type: 'ufo_detected' } as never);
    expect(m2.rec.osc.map((o) => o.freq[0].v)).toEqual([440, 660]);
    // бій: постріл auto з влучанням — звук режиму + «удар» (2 ноти + шум)
    const m3 = mockContext();
    const s3 = createSound({ makeContext: () => m3.ctx, store: memStore() });
    s3.battleEvent({ type: 'shot', shooterId: 's1', targetId: 'a1', mode: 'auto', hit: true, damage: 2 } as never);
    expect(m3.rec.osc.map((o) => o.type)).toEqual(['square', 'triangle']);
    expect(m3.rec.src).toHaveLength(1);
  });

  it('підвислий контекст — тихий resume; робочий — без resume (autoplay policy)', () => {
    const m = mockContext('suspended');
    const s = createSound({ makeContext: () => m.ctx, store: memStore() });
    s.play('hit');
    expect(m.rec.resume).toHaveBeenCalledTimes(1);
    const m2 = mockContext('running');
    createSound({ makeContext: () => m2.ctx, store: memStore() }).play('hit');
    expect(m2.rec.resume).not.toHaveBeenCalled();
  });
});

describe('Детермінізм шумового буфера (ADR-0003: без Math.random)', () => {
  it('буфер кешується на контекст і байт-у-байт однаковий між контекстами', () => {
    const m1 = mockContext();
    const s1 = createSound({ makeContext: () => m1.ctx, store: memStore() });
    s1.play('shot-snap');
    s1.play('shot-auto');
    expect(m1.rec.buffers).toHaveLength(1); // кеш: два постріли — один буфер
    const m2 = mockContext();
    createSound({ makeContext: () => m2.ctx, store: memStore() }).play('shot-snap');
    expect(Array.from(m2.rec.buffers[0].data.slice(0, 64))).toEqual(Array.from(m1.rec.buffers[0].data.slice(0, 64)));
  });
});

// --- Критерій 1: звук не міняє бій (байт-у-байт інваріант) ---

const jDeps = (over: Partial<JournalDeps> = {}): JournalDeps => ({
  geoLog: () => [],
  econLog: () => [],
  battleLog: () => null,
  researchLog: () => [],
  workshopLog: () => [],
  unitName: (id) => id,
  onGeoEvent: () => {},
  party: () => createParty(42),
  ...over,
});

// Скриптований бій (сід 42, детерміновано): рух + постріли обох сторін.
function battleGame(): GameState {
  const g = createGame({
    map: { width: 20, height: 20, blocked: new Set<string>() } as GameMap,
    rng: mulberry32(42),
    units: [
      makeUnit({ id: 's1', side: 'player', name: 'Гарт', pos: { x: 2, y: 2 } }),
      makeUnit({ id: 's2', side: 'player', name: 'Ліс', pos: { x: 3, y: 2 } }),
      makeUnit({ id: 'a1', side: 'alien', name: 'Морок', pos: { x: 8, y: 2 }, hp: 10, maxHp: 10 }),
      makeUnit({ id: 'a2', side: 'alien', name: 'Ірж', pos: { x: 8, y: 3 }, hp: 10, maxHp: 10 }),
    ],
  });
  moveUnit(g, 's1', [{ x: 2, y: 3 }]);
  resolveAttack(g, 's1', 'a1', 'auto');
  resolveAttack(g, 's1', 'a2', 'snap');
  endTurn(g);
  resolveAttack(g, 'a1', 's1', 'aimed');
  return g;
}

beforeEach(() => {
  document.body.innerHTML = '<ul id="log"></ul>';
});

describe('П11.7 критерій 1: зі звуком і без — бій байт-у-байт', () => {
  it('дрен журналу зі звуком не міняє лог бою, rng.state і DOM-журнал', () => {
    const m = mockContext();
    const sound = createSound({ makeContext: () => m.ctx, store: memStore() }); // увімкнено
    const g = battleGame();
    const before = JSON.stringify(g.log) + '|' + (g.rng as StatefulRng).state;
    createJournal(jDeps({ battleLog: () => g.log, onBattleSound: (e) => sound.battleEvent(e) })).drainBattle();
    // стан ядра не змінений дреном зі звуком
    expect(JSON.stringify(g.log) + '|' + (g.rng as StatefulRng).state).toBe(before);
    const domWith = document.querySelector('#log')!.textContent;
    expect(m.rec.osc.length).toBeGreaterThan(0); // звук реально програвався
    // той самий бій без звуку — той самий DOM-журнал і той самий лог
    const g2 = battleGame();
    document.body.innerHTML = '<ul id="log"></ul>';
    createJournal(jDeps({ battleLog: () => g2.log })).drainBattle();
    expect(document.querySelector('#log')!.textContent).toBe(domWith);
    expect(JSON.stringify(g2.log) + '|' + (g2.rng as StatefulRng).state).toBe(before);
  });
});
