import { describe, it, expect } from 'vitest';
import { PitchDetector } from '../src/audio/pitchDetector';
import { frequencyToCents, midiToFrequency } from '../src/utils/pianoNotes';

/**
 * Helper to generate synthetic audio buffers at specified sample rate.
 */
function generateSineWave(
  freq: number,
  sampleRate: number,
  numSamples: number,
  amplitude = 0.8
): Float32Array {
  const buffer = new Float32Array(numSamples);
  const phaseStep = (2 * Math.PI * freq) / sampleRate;
  for (let i = 0; i < numSamples; i++) {
    buffer[i] = amplitude * Math.sin(phaseStep * i);
  }
  return buffer;
}

/**
 * Helper to generate synthetic piano tone with harmonics.
 */
function generatePianoTone(
  f0: number,
  sampleRate: number,
  numSamples: number,
  harmonics: number[] = [1.0, 0.5, 0.25, 0.125]
): Float32Array {
  const buffer = new Float32Array(numSamples);
  for (let h = 0; h < harmonics.length; h++) {
    const k = h + 1;
    const amp = harmonics[h];
    if (amp <= 0) continue;
    const phaseStep = (2 * Math.PI * k * f0) / sampleRate;
    for (let i = 0; i < numSamples; i++) {
      buffer[i] += amp * Math.sin(phaseStep * i);
    }
  }

  // Normalize peak amplitude to ~0.85
  let max = 0;
  for (let i = 0; i < numSamples; i++) {
    if (Math.abs(buffer[i]) > max) max = Math.abs(buffer[i]);
  }
  if (max > 0) {
    const norm = 0.85 / max;
    for (let i = 0; i < numSamples; i++) {
      buffer[i] *= norm;
    }
  }

  return buffer;
}

describe('PitchDetector Algorithm', () => {
  const sampleRate = 44100;
  const bufferSize = 8192;

  it('accurately detects pure sine waves across piano range within +/- 1.5 cents', () => {
    const detector = new PitchDetector({ sampleRate, bufferSize });

    // Test across octaves: A1, C2, A2, C4, A4, C6, A6, C7, C8
    const testFrequencies = [
      { name: 'A1', f: 55.0 },
      { name: 'C2', f: 65.406 },
      { name: 'A2', f: 110.0 },
      { name: 'C4 (Middle C)', f: 261.626 },
      { name: 'A4', f: 440.0 },
      { name: 'C6', f: 1046.502 },
      { name: 'A6', f: 1760.0 },
      { name: 'C7', f: 2093.005 },
      { name: 'C8 (Top note)', f: 4186.009 }
    ];

    for (const test of testFrequencies) {
      const buffer = generateSineWave(test.f, sampleRate, bufferSize);
      detector.resetSmoothing();
      const res = detector.detect(buffer);

      expect(res.isNoteDetected).toBe(true);
      expect(res.frequency).toBeGreaterThan(0);

      const centsError = Math.abs(frequencyToCents(res.frequency, test.f));
      expect(
        centsError,
        `Expected ${test.name} (${test.f} Hz) within 1.5 cents, got ${res.frequency} Hz (error ${centsError.toFixed(2)} cents)`
      ).toBeLessThan(1.5);
    }
  });

  it('detects low bass notes (A0 = 27.5 Hz, C1 = 32.7 Hz) accurately', () => {
    const detector = new PitchDetector({ sampleRate, bufferSize });

    // A0 = 27.5 Hz
    const a0Buf = generateSineWave(27.5, sampleRate, bufferSize);
    detector.resetSmoothing();
    const a0Res = detector.detect(a0Buf, 27.5); // Target guided
    expect(a0Res.isNoteDetected).toBe(true);
    const a0CentsError = Math.abs(frequencyToCents(a0Res.frequency, 27.5));
    expect(a0CentsError).toBeLessThan(1.5);

    // C1 = 32.703 Hz
    const c1Freq = midiToFrequency(24, 440);
    const c1Buf = generateSineWave(c1Freq, sampleRate, bufferSize);
    detector.resetSmoothing();
    const c1Res = detector.detect(c1Buf, c1Freq);
    expect(c1Res.isNoteDetected).toBe(true);
    const c1CentsError = Math.abs(frequencyToCents(c1Res.frequency, c1Freq));
    expect(c1CentsError).toBeLessThan(1.5);
  });

  it('handles upright piano low notes with weak fundamental and strong 2nd/3rd harmonics', () => {
    const detector = new PitchDetector({ sampleRate, bufferSize });

    // Typical upright piano A0 (27.5 Hz) spectrum:
    // Fundamental is weak (0.25), 2nd harmonic (55 Hz) and 3rd harmonic (82.5 Hz) are loudest!
    const a0Harmonics = [0.25, 1.0, 0.85, 0.6, 0.4, 0.2];
    const complexA0 = generatePianoTone(27.5, sampleRate, bufferSize, a0Harmonics);

    detector.resetSmoothing();
    const resTarget = detector.detect(complexA0, 27.5);
    expect(resTarget.isNoteDetected).toBe(true);
    const centsErrorTarget = Math.abs(frequencyToCents(resTarget.frequency, 27.5));
    expect(centsErrorTarget).toBeLessThan(1.5);

    // Also test C2 (65.4 Hz) with strong harmonics in auto-detect mode
    const c2Freq = midiToFrequency(36, 440);
    const c2Harmonics = [0.35, 1.0, 0.7, 0.4, 0.2];
    const complexC2 = generatePianoTone(c2Freq, sampleRate, bufferSize, c2Harmonics);

    detector.resetSmoothing();
    const resC2 = detector.detect(complexC2);
    expect(resC2.isNoteDetected).toBe(true);
    const centsErrorC2 = Math.abs(frequencyToCents(resC2.frequency, c2Freq));
    expect(centsErrorC2).toBeLessThan(1.5);
  });

  it('handles mid and treble complex piano tones with harmonics', () => {
    const detector = new PitchDetector({ sampleRate, bufferSize });

    // A4 (440 Hz) with piano harmonic decay profile
    const a4Harmonics = [1.0, 0.6, 0.35, 0.18, 0.08];
    const complexA4 = generatePianoTone(440.0, sampleRate, bufferSize, a4Harmonics);

    detector.resetSmoothing();
    const resA4 = detector.detect(complexA4);
    expect(resA4.isNoteDetected).toBe(true);
    const centsErrorA4 = Math.abs(frequencyToCents(resA4.frequency, 440.0));
    expect(centsErrorA4).toBeLessThan(1.5);
    expect(resA4.midi).toBe(69);

    // C6 (1046.5 Hz) with harmonics
    const c6Freq = midiToFrequency(84, 440);
    const c6Harmonics = [1.0, 0.3, 0.1];
    const complexC6 = generatePianoTone(c6Freq, sampleRate, bufferSize, c6Harmonics);

    detector.resetSmoothing();
    const resC6 = detector.detect(complexC6);
    expect(resC6.isNoteDetected).toBe(true);
    const centsErrorC6 = Math.abs(frequencyToCents(resC6.frequency, c6Freq));
    expect(centsErrorC6).toBeLessThan(1.5);
    expect(resC6.midi).toBe(84);
  });

  it('rejects signals below the noise gate threshold', () => {
    const detector = new PitchDetector({ sampleRate, bufferSize, noiseGateDb: -40 });

    // Very quiet signal (-60 dBFS)
    const quietBuffer = generateSineWave(440, sampleRate, bufferSize, 0.001);
    const res = detector.detect(quietBuffer);

    expect(res.isNoteDetected).toBe(false);
    expect(res.frequency).toBe(0);
    expect(res.method).toBe('gate');
  });

  it('rejects pure silence and near-zero buffers', () => {
    const detector = new PitchDetector({ sampleRate, bufferSize });
    const silentBuffer = new Float32Array(bufferSize);

    const res = detector.detect(silentBuffer);
    expect(res.isNoteDetected).toBe(false);
    expect(res.frequency).toBe(0);
  });

  it('accurately computes cents offset in target-note mode', () => {
    const detector = new PitchDetector({ sampleRate, bufferSize });

    // Piano string tuned 4.5 cents sharp of A4
    const sharpA4Freq = 440 * Math.pow(2, 4.5 / 1200);
    const sharpBuffer = generateSineWave(sharpA4Freq, sampleRate, bufferSize);

    detector.resetSmoothing();
    const res = detector.detect(sharpBuffer, 440.0);
    expect(res.isNoteDetected).toBe(true);
    expect(res.cents).toBeCloseTo(4.5, 0);

    // Piano string tuned 8 cents flat of A4
    const flatA4Freq = 440 * Math.pow(2, -8.0 / 1200);
    const flatBuffer = generateSineWave(flatA4Freq, sampleRate, bufferSize);

    detector.resetSmoothing();
    const resFlat = detector.detect(flatBuffer, 440.0);
    expect(resFlat.isNoteDetected).toBe(true);
    expect(resFlat.cents).toBeCloseTo(-8.0, 0);
  });
});
