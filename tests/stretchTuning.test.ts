import { describe, it, expect } from 'vitest';
import {
  getStretchCents,
  getTargetFrequency,
  estimatePianoCalibration
} from '../src/utils/stretchTuning';
import { midiToFrequency } from '../src/utils/pianoNotes';

describe('Stretch Tuning & Railsback Curve', () => {
  it('returns 0 cents stretch for pure equal temperament across all keys', () => {
    // Pure equal mode must have zero stretch
    expect(getStretchCents(21, 'pure')).toBe(0); // A0
    expect(getStretchCents(60, 'pure')).toBe(0); // C4
    expect(getStretchCents(69, 'pure')).toBe(0); // A4
    expect(getStretchCents(108, 'pure')).toBe(0); // C8
  });

  it('correctly flattens bass and sharpens treble in stretch mode', () => {
    // Upright Railsback curve: bass notes are flat (negative cents)
    const a0Stretch = getStretchCents(21, 'stretch');
    const c1Stretch = getStretchCents(24, 'stretch');
    const c2Stretch = getStretchCents(36, 'stretch');
    expect(a0Stretch).toBeLessThan(-20.0);
    expect(c1Stretch).toBeLessThan(-15.0);
    expect(c2Stretch).toBeLessThan(-5.0);

    // Mid-range notes are close to 0 cents
    const c4Stretch = getStretchCents(60, 'stretch');
    const a4Stretch = getStretchCents(69, 'stretch');
    expect(Math.abs(c4Stretch)).toBeLessThan(1.0);
    expect(Math.abs(a4Stretch)).toBe(0);

    // Treble notes are sharp (positive cents)
    const c6Stretch = getStretchCents(84, 'stretch');
    const c7Stretch = getStretchCents(96, 'stretch');
    const c8Stretch = getStretchCents(108, 'stretch');
    expect(c6Stretch).toBeGreaterThan(5.0);
    expect(c7Stretch).toBeGreaterThan(12.0);
    expect(c8Stretch).toBeGreaterThan(25.0);
  });

  it('scales stretch factor correctly', () => {
    const baseA0 = getStretchCents(21, 'stretch', 1.0);
    const halfA0 = getStretchCents(21, 'stretch', 0.5);
    const doubleA0 = getStretchCents(21, 'stretch', 2.0);
    const zeroA0 = getStretchCents(21, 'stretch', 0.0);

    expect(halfA0).toBeCloseTo(baseA0 * 0.5, 3);
    expect(doubleA0).toBeCloseTo(baseA0 * 2.0, 3);
    expect(zeroA0).toBe(0);
  });

  it('calculates target frequencies matching stretch cents', () => {
    const pureA0 = getTargetFrequency(21, 440, 'pure');
    expect(pureA0).toBeCloseTo(27.5, 3);

    const stretchedA0 = getTargetFrequency(21, 440, 'stretch', 1.0);
    // Because bass is flat, target frequency must be lower than 27.5 Hz
    expect(stretchedA0).toBeLessThan(27.5);
    const expectedA0 = 27.5 * Math.pow(2, getStretchCents(21, 'stretch', 1.0) / 1200);
    expect(stretchedA0).toBeCloseTo(expectedA0, 4);

    const stretchedC8 = getTargetFrequency(108, 440, 'stretch', 1.0);
    // Treble is sharp, target frequency must be higher than pure C8
    const pureC8 = midiToFrequency(108, 440);
    expect(stretchedC8).toBeGreaterThan(pureC8);
  });

  it('calibrates estimated A4 reference from sample note measurements', () => {
    // Simulate an old piano that has dropped in pitch to A4 = 437.5 Hz
    const targetA4 = 437.5;
    const samples = [
      {
        midi: 33, // A1
        measuredFreq: midiToFrequency(33, targetA4),
        centsOffset: 0,
        timestamp: Date.now()
      },
      {
        midi: 45, // A2
        measuredFreq: midiToFrequency(45, targetA4),
        centsOffset: 0,
        timestamp: Date.now()
      },
      {
        midi: 69, // A4
        measuredFreq: midiToFrequency(69, targetA4),
        centsOffset: 0,
        timestamp: Date.now()
      },
      {
        midi: 81, // A5
        measuredFreq: midiToFrequency(81, targetA4),
        centsOffset: 0,
        timestamp: Date.now()
      }
    ];

    const result = estimatePianoCalibration(samples);
    expect(result.estimatedA4).toBeCloseTo(437.5, 1);
  });
});
