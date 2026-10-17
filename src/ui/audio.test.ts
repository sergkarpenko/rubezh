// П11.7 (ADR-0059): тести аудіо-модуля на моках — середовище без WebAudio
// (jsdom/node): чисті перетворювачі подій, no-op без API (typeof-гейт),
// тумблер з гілками сховища (ADR-0026: поза сейвом, тихо при помилках).
// Синтез за моком SoundContext і байт-у-байт інваріант (критерій 1) — у
// src/ui/audio-synth.test.ts разом з wiring (критерій 2 повністю).
import { describe, expect, it, vi } from 'vitest';
import type { GameEvent } from '../core/combat';
import type { GeoEvent } from '../core/geo';
import { battleSounds, createSound, geoSounds, type SoundStore } from './audio';

const evB = (e: Partial<GameEvent> & { type: GameEvent['type'] }): GameEvent => e as GameEvent;
const evG = (e: Partial<GeoEvent> & { type: GeoEvent['type'] }): GeoEvent => e as GeoEvent;

const memStore = (initial: string | null = null): SoundStore & { written: string[] } => {
  const s = { value: initial, written: [] as string[] };
  return {
    read: () => s.value,
    write: (v) => {
      s.written.push(v);
      s.value = v;
    },
    get written() {
      return s.written;
    },
  };
};

describe('battleSounds/geoSounds: подія → набір звуків (ADR-0059)', () => {
  it('постріл: звук режиму; влучання — додатковий «удар»', () => {
    expect(battleSounds(evB({ type: 'shot', mode: 'snap', hit: true }))).toEqual(['shot-snap', 'hit']);
    expect(battleSounds(evB({ type: 'shot', mode: 'aimed', hit: false }))).toEqual(['shot-aimed']);
    expect(battleSounds(evB({ type: 'shot', mode: 'auto', hit: true }))).toEqual(['shot-auto', 'hit']);
  });
  it('смерть і рух — звук; інші події бою — без звуку', () => {
    expect(battleSounds(evB({ type: 'death' }))).toEqual(['death']);
    expect(battleSounds(evB({ type: 'move' }))).toEqual(['move']);
    expect(battleSounds(evB({ type: 'turn' }))).toEqual([]);
    expect(battleSounds(evB({ type: 'turn' }))).toEqual([]);
    expect(battleSounds(evB({ type: 'overwatch' }))).toEqual([]);
    expect(battleSounds(evB({ type: 'heal' }))).toEqual([]);
    expect(battleSounds(evB({ type: 'grenade' }))).toEqual([]);
  });
  it('геосцена: виявлення НЛО, перемога/поразка місії; туман — тихо', () => {
    expect(geoSounds(evG({ type: 'ufo_detected' }))).toEqual(['detect']);
    expect(geoSounds(evG({ type: 'mission_won' }))).toEqual(['win']);
    expect(geoSounds(evG({ type: 'mission_lost' }))).toEqual(['lose']);
    expect(geoSounds(evG({ type: 'day' }))).toEqual([]);
    expect(geoSounds(evG({ type: 'ufo_spawned' }))).toEqual([]);
    expect(geoSounds(evG({ type: 'ufo_move' }))).toEqual([]);
  });
});

describe('typeof-гейт: без WebAudio — no-op без винятків (ADR-0063: headless)', () => {
  it('без API: play/battleEvent/geoEvent не кидають; гейт спрацьовує один раз', () => {
    const makeContext = vi.fn(() => null);
    const s = createSound({ makeContext, store: memStore() });
    expect(() => {
      s.play('click');
      s.play('shot-snap');
      s.battleEvent(evB({ type: 'shot', mode: 'auto', hit: true }));
      s.geoEvent(evG({ type: 'ufo_detected' }));
    }).not.toThrow();
    expect(makeContext).toHaveBeenCalledTimes(1);
  });
  it('дефолтна фабрика в середовищі тесту (без AudioContext) — no-op', () => {
    const s = createSound();
    expect(s.enabled()).toBe(true); // сховище недоступне/порожнє — тихо, дефолт «увімкнено»
    expect(() => s.play('click')).not.toThrow();
  });
  it('вимкнений тумблер: контекст не створюється взагалі', () => {
    const makeContext = vi.fn(() => null);
    const s = createSound({ makeContext, store: memStore('0') });
    expect(s.enabled()).toBe(false);
    s.play('click');
    expect(makeContext).not.toHaveBeenCalled();
  });
});

describe('тумблер і сховище (ADR-0026: localStorage поза сейвом, тихо)', () => {
  it('дефолт — увімкнено; toggle перемикає і персистить rubezh.sound', () => {
    const store = memStore();
    const s = createSound({ makeContext: () => null, store });
    expect(s.enabled()).toBe(true);
    expect(s.toggle()).toBe(false);
    expect(store.written).toEqual(['0']);
    expect(s.toggle()).toBe(true);
    expect(store.written).toEqual(['0', '1']);
  });
  it('збережений вимкнений стан читається при створенні', () => {
    const s = createSound({ makeContext: () => null, store: memStore('0') });
    expect(s.enabled()).toBe(false);
    const s2 = createSound({ makeContext: () => null, store: memStore('1') });
    expect(s2.enabled()).toBe(true);
  });
  it('сховище кидає — тихо: створення і toggle не падають (без повідомлень)', () => {
    const boom = () => {
      throw new Error('storage blocked');
    };
    const s = createSound({ makeContext: () => null, store: { read: boom, write: boom } });
    expect(s.enabled()).toBe(true); // помилка читання — тихо, дефолт
    expect(() => s.toggle()).not.toThrow();
    expect(s.enabled()).toBe(false); // у сесії тумблер працює, персист мовчки пропущено
  });
});

// Синтез (рецепти за моком SoundContext) і байт-у-байт інваріант —
// audio-synth.test.ts у коміті wiring: тести йдуть разом із точками викликів.
