import { describe, it, expect, beforeEach } from 'vitest';
import { TuningStore } from '../src/utils/tuningStore';

describe('TuningStore', () => {
  let store: TuningStore;

  beforeEach(() => {
    // Clear any storage
    store = new TuningStore(/* storageKeyPrefix */ 'test_piano_tuner');
    store.clearAll();
  });

  it('initializes all 88 piano keys as untuned with no measurements', () => {
    const keys = store.getAllKeyStates();
    expect(keys.length).toBe(88);
    expect(store.getTunedCount()).toBe(0);
    expect(keys[0].midi).toBe(21); // A0
    expect(keys[87].midi).toBe(108); // C8
    expect(keys[0].isTuned).toBe(false);
  });

  it('can mark and unmark keys as tuned', () => {
    store.markTuned(69, true); // A4
    expect(store.isKeyTuned(69)).toBe(true);
    expect(store.getTunedCount()).toBe(1);

    store.markTuned(60, true); // Middle C
    expect(store.getTunedCount()).toBe(2);

    store.markTuned(69, false);
    expect(store.isKeyTuned(69)).toBe(false);
    expect(store.getTunedCount()).toBe(1);
  });

  it('records measurements and tracks worst out-of-tune notes accurately', () => {
    // A4: 1.5 cents off (close)
    store.recordMeasurement(69, 1.5, 440.38);
    // C4: -14.2 cents off (flat)
    store.recordMeasurement(60, -14.2, 259.48);
    // F#3: +22.0 cents off (very sharp)
    store.recordMeasurement(54, 22.0, 187.35);
    // D2: -8.0 cents off
    store.recordMeasurement(38, -8.0, 72.9);

    const worst = store.getWorstNotes(3);
    expect(worst.length).toBe(3);
    // Worst should be F#3 (+22.0 cents)
    expect(worst[0].midi).toBe(54);
    expect(worst[0].lastMeasuredCents).toBeCloseTo(22.0, 1);

    // Second worst should be C4 (-14.2 cents)
    expect(worst[1].midi).toBe(60);
    expect(worst[1].lastMeasuredCents).toBeCloseTo(-14.2, 1);

    // Third worst should be D2 (-8.0 cents)
    expect(worst[2].midi).toBe(38);
  });

  it('excludes already tuned notes from worst notes when requested', () => {
    store.recordMeasurement(54, 22.0, 187.35);
    store.recordMeasurement(60, -14.2, 259.48);
    store.recordMeasurement(38, -8.0, 72.9);

    // Mark the worst note (F#3) as tuned
    store.markTuned(54, true);

    const worstUntuned = store.getWorstNotes(2, /* onlyUntuned */ true);
    expect(worstUntuned.length).toBe(2);
    expect(worstUntuned[0].midi).toBe(60); // C4 is now the worst untuned
    expect(worstUntuned[1].midi).toBe(38);
  });

  it('clears suggestion readings and keeps keys marked tuned', () => {
    store.recordMeasurement(60, -14.2, 259.48);
    store.recordMeasurement(69, 1.5, 440.38);
    store.markTuned(69, true);

    store.clearSuggestions();

    expect(store.isKeyTuned(69)).toBe(true);
    expect(store.getKeyState(69)?.lastMeasuredCents).toBeCloseTo(1.5, 1);
    expect(store.getKeyState(60)?.lastMeasuredCents).toBeNull();
    expect(store.getKeyState(60)?.lastMeasuredFreq).toBeNull();
    expect(store.getWorstNotes(8, true)).toHaveLength(0);
  });

  it('clears one key reading without clearing its tuned mark', () => {
    store.markTuned(60, true);
    store.recordMeasurement(60, 0.5, 261.6);
    store.recordMeasurement(69, 3.2, 440.8);

    store.clearMeasurement(60);

    expect(store.isKeyTuned(60)).toBe(true);
    expect(store.getKeyState(60)?.lastMeasuredCents).toBeNull();
    expect(store.getKeyState(69)?.lastMeasuredCents).toBeCloseTo(3.2, 1);
  });

  it('clears all measurements and tuned statuses on reset', () => {
    store.markTuned(60, true);
    store.recordMeasurement(60, 0.5, 261.6);
    expect(store.getTunedCount()).toBe(1);

    store.clearAll();
    expect(store.getTunedCount()).toBe(0);
    expect(store.getKeyState(60)?.lastMeasuredCents).toBeNull();
  });
});
