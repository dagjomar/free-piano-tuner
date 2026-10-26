/**
 * TuningStore
 * Manages per-key tuning completion checklist and measured deviation history
 * across the 88 piano keys (A0 to C8).
 * Persists to localStorage when available.
 */

import { PIANO_MIN_MIDI, PIANO_MAX_MIDI, getPianoNoteByMidi, PianoNote } from './pianoNotes';

export interface KeyTuningState {
  midi: number;
  note: PianoNote;
  isTuned: boolean;
  lastMeasuredCents: number | null;
  lastMeasuredFreq: number | null;
  measuredAt: number | null;
}

export type StoreChangeListener = () => void;

export class TuningStore {
  private keyStates: Map<number, KeyTuningState> = new Map();
  private storageKey: string;
  private listeners: Set<StoreChangeListener> = new Set();

  constructor(storageKeyPrefix: string = 'piano_tuner_session') {
    this.storageKey = storageKeyPrefix;
    this.initKeys();
    this.loadFromStorage();
  }

  private initKeys(): void {
    this.keyStates.clear();
    for (let midi = PIANO_MIN_MIDI; midi <= PIANO_MAX_MIDI; midi++) {
      this.keyStates.set(midi, {
        midi,
        note: getPianoNoteByMidi(midi),
        isTuned: false,
        lastMeasuredCents: null,
        lastMeasuredFreq: null,
        measuredAt: null
      });
    }
  }

  public subscribe(listener: StoreChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.saveToStorage();
    for (const listener of this.listeners) {
      listener();
    }
  }

  public getAllKeyStates(): KeyTuningState[] {
    return Array.from(this.keyStates.values());
  }

  public getKeyState(midi: number): KeyTuningState | undefined {
    return this.keyStates.get(midi);
  }

  public isKeyTuned(midi: number): boolean {
    return this.keyStates.get(midi)?.isTuned ?? false;
  }

  public markTuned(midi: number, isTuned: boolean): void {
    const state = this.keyStates.get(midi);
    if (state && state.isTuned !== isTuned) {
      state.isTuned = isTuned;
      this.notify();
    }
  }

  public toggleTuned(midi: number): boolean {
    const state = this.keyStates.get(midi);
    if (state) {
      state.isTuned = !state.isTuned;
      this.notify();
      return state.isTuned;
    }
    return false;
  }

  public recordMeasurement(midi: number, cents: number, freq: number): void {
    const state = this.keyStates.get(midi);
    if (state) {
      state.lastMeasuredCents = Math.round(cents * 10) / 10;
      state.lastMeasuredFreq = Math.round(freq * 100) / 100;
      state.measuredAt = Date.now();
      this.notify();
    }
  }

  /** Drop one key's saved pitch reading. The tuned mark stays. */
  public clearMeasurement(midi: number): void {
    const state = this.keyStates.get(midi);
    if (!state) return;
    if (
      state.lastMeasuredCents === null &&
      state.lastMeasuredFreq === null &&
      state.measuredAt === null
    ) {
      return;
    }
    state.lastMeasuredCents = null;
    state.lastMeasuredFreq = null;
    state.measuredAt = null;
    this.notify();
  }

  /**
   * Drop saved pitch readings for keys that are not marked tuned.
   * Tuned keys keep both their checkmark and their last reading.
   */
  public clearSuggestions(): void {
    let changed = false;
    for (const state of this.keyStates.values()) {
      if (state.isTuned) continue;
      if (state.lastMeasuredCents === null && state.lastMeasuredFreq === null && state.measuredAt === null) {
        continue;
      }
      state.lastMeasuredCents = null;
      state.lastMeasuredFreq = null;
      state.measuredAt = null;
      changed = true;
    }
    if (changed) this.notify();
  }

  public getTunedCount(): number {
    let count = 0;
    for (const state of this.keyStates.values()) {
      if (state.isTuned) count++;
    }
    return count;
  }

  public getTotalKeys(): number {
    return this.keyStates.size;
  }

  /**
   * Returns keys with measurements, sorted by absolute cents error descending.
   * Enables the user to quickly identify the worst out-of-tune notes.
   */
  public getWorstNotes(limit: number = 8, onlyUntuned: boolean = false): KeyTuningState[] {
    const measured: KeyTuningState[] = [];
    for (const state of this.keyStates.values()) {
      if (state.lastMeasuredCents !== null) {
        if (!onlyUntuned || !state.isTuned) {
          measured.push(state);
        }
      }
    }

    measured.sort((a, b) => {
      const errA = Math.abs(a.lastMeasuredCents ?? 0);
      const errB = Math.abs(b.lastMeasuredCents ?? 0);
      return errB - errA;
    });

    return measured.slice(0, limit);
  }

  public clearAll(): void {
    for (const state of this.keyStates.values()) {
      state.isTuned = false;
      state.lastMeasuredCents = null;
      state.lastMeasuredFreq = null;
      state.measuredAt = null;
    }
    this.notify();
  }

  private saveToStorage(): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const serialized = Array.from(this.keyStates.entries()).map(([midi, s]) => ({
          midi,
          t: s.isTuned ? 1 : 0,
          c: s.lastMeasuredCents,
          f: s.lastMeasuredFreq,
          a: s.measuredAt
        }));
        window.localStorage.setItem(this.storageKey, JSON.stringify(serialized));
      }
    } catch {
      // Storage unavailable or disabled
    }
  }

  private loadFromStorage(): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const raw = window.localStorage.getItem(this.storageKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            for (const item of parsed) {
              const state = this.keyStates.get(item.midi);
              if (state) {
                state.isTuned = item.t === 1;
                state.lastMeasuredCents = item.c ?? null;
                state.lastMeasuredFreq = item.f ?? null;
                state.measuredAt = item.a ?? null;
              }
            }
          }
        }
      }
    } catch {
      // Storage unavailable or corrupted
    }
  }
}
