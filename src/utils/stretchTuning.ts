/**
 * Piano stretch tuning (Railsback curve) and inharmonicity calibration.
 *
 * Upright piano strings are stiff, which causes higher partials (harmonics) to be
 * slightly sharp relative to true integer harmonics: f_n = n * f_0 * sqrt(1 + B * n^2).
 * To prevent audible beats between the partials of octaves and fifths, piano tuners
 * stretch the tuning: bass notes are tuned flatter than pure equal temperament,
 * and treble notes are tuned sharper.
 */

import { PIANO_MIN_MIDI, PIANO_MAX_MIDI, midiToFrequency } from './pianoNotes';

export type TuningMode = 'pure' | 'stretch';

export interface CalibrationSample {
  midi: number;
  measuredFreq: number;
  centsOffset: number;
  timestamp: number;
}

// Empirical anchor points for standard upright piano Railsback curve (in cents offset vs equal temperament)
const RAILSBACK_ANCHORS: { midi: number; cents: number }[] = [
  { midi: 21, cents: -28.0 }, // A0
  { midi: 24, cents: -22.0 }, // C1
  { midi: 36, cents: -11.0 }, // C2
  { midi: 48, cents: -4.0 },  // C3
  { midi: 60, cents: 0.0 },   // C4
  { midi: 69, cents: 0.0 },   // A4 (reference)
  { midi: 72, cents: 2.5 },   // C5
  { midi: 84, cents: 7.5 },   // C6
  { midi: 96, cents: 16.0 },  // C7
  { midi: 108, cents: 32.0 }  // C8
];

/**
 * Linear interpolation between anchors for baseline curve.
 */
function interpolateCents(midi: number): number {
  if (midi <= RAILSBACK_ANCHORS[0].midi) {
    return RAILSBACK_ANCHORS[0].cents;
  }
  const last = RAILSBACK_ANCHORS[RAILSBACK_ANCHORS.length - 1];
  if (midi >= last.midi) {
    return last.cents;
  }

  for (let i = 0; i < RAILSBACK_ANCHORS.length - 1; i++) {
    const a = RAILSBACK_ANCHORS[i];
    const b = RAILSBACK_ANCHORS[i + 1];
    if (midi >= a.midi && midi <= b.midi) {
      const t = (midi - a.midi) / (b.midi - a.midi);
      // Smooth Hermite cubic interpolation for seamless transition
      const smoothT = t * t * (3 - 2 * t);
      return a.cents + (b.cents - a.cents) * smoothT;
    }
  }

  return 0;
}

// Precalculated baseline table for all 88 keys
const BASELINE_STRETCH_TABLE: Float32Array = new Float32Array(PIANO_MAX_MIDI - PIANO_MIN_MIDI + 1);
for (let midi = PIANO_MIN_MIDI; midi <= PIANO_MAX_MIDI; midi++) {
  BASELINE_STRETCH_TABLE[midi - PIANO_MIN_MIDI] = interpolateCents(midi);
}

/**
 * Returns the stretch offset in cents for a given MIDI note number.
 * @param midi MIDI note number (21-108)
 * @param mode 'pure' (0 stretch) or 'stretch' (Railsback curve)
 * @param stretchFactor Multiplier for the stretch curve (0.0 to 2.0, default 1.0)
 */
export function getStretchCents(
  midi: number,
  mode: TuningMode = 'pure',
  stretchFactor: number = 1.0
): number {
  if (mode === 'pure' || stretchFactor <= 0) {
    return 0;
  }

  const clampedMidi = Math.max(PIANO_MIN_MIDI, Math.min(PIANO_MAX_MIDI, midi));
  const baseOffset = BASELINE_STRETCH_TABLE[clampedMidi - PIANO_MIN_MIDI];
  return baseOffset * stretchFactor;
}

/**
 * Computes the target frequency for a MIDI note, incorporating A4 reference,
 * tuning mode (pure vs stretch), and stretch scale factor.
 */
export function getTargetFrequency(
  midi: number,
  a4: number = 440.0,
  mode: TuningMode = 'pure',
  stretchFactor: number = 1.0
): number {
  const equalFreq = midiToFrequency(midi, a4);
  const stretchCents = getStretchCents(midi, mode, stretchFactor);
  return equalFreq * Math.pow(2, stretchCents / 1200);
}

/**
 * Calibration helper: analyzes a set of played notes on an existing piano
 * to estimate the piano's current overall pitch reference (A4) and stretch factor.
 * Useful for older uprights where tuning straight to A4=440 may risk string breakage.
 */
export function estimatePianoCalibration(
  samples: CalibrationSample[]
): { estimatedA4: number; suggestedStretchFactor: number } {
  if (samples.length === 0) {
    return { estimatedA4: 440.0, suggestedStretchFactor: 1.0 };
  }

  // Calculate estimated A4 for each sample
  const a4Estimates: number[] = [];
  for (const sample of samples) {
    // f = A4 * 2^((midi - 69) / 12)  =>  A4 = f / 2^((midi - 69) / 12)
    const factor = Math.pow(2, (sample.midi - 69) / 12);
    if (factor > 0 && sample.measuredFreq > 0) {
      a4Estimates.push(sample.measuredFreq / factor);
    }
  }

  // Robust median A4 estimate
  a4Estimates.sort((a, b) => a - b);
  const medianA4 = a4Estimates[Math.floor(a4Estimates.length / 2)];

  // Estimate stretch if samples span bass and treble
  let suggestedStretch = 1.0;
  const bassSamples = samples.filter((s) => s.midi < 48);
  const trebleSamples = samples.filter((s) => s.midi > 72);

  if (bassSamples.length > 0 && trebleSamples.length > 0) {
    const bassCentsSum = bassSamples.reduce((sum, s) => {
      const eq = midiToFrequency(s.midi, medianA4);
      return sum + 1200 * Math.log2(s.measuredFreq / eq);
    }, 0);
    const avgBassCents = bassCentsSum / bassSamples.length;

    const trebleCentsSum = trebleSamples.reduce((sum, s) => {
      const eq = midiToFrequency(s.midi, medianA4);
      return sum + 1200 * Math.log2(s.measuredFreq / eq);
    }, 0);
    const avgTrebleCents = trebleCentsSum / trebleSamples.length;

    // Compare with baseline expected bass (-15) and treble (+10)
    const observedSpread = avgTrebleCents - avgBassCents;
    const baselineSpread = 25.0; // typical upright spread between outer zones
    if (observedSpread > 5) {
      suggestedStretch = Math.max(0.5, Math.min(2.0, observedSpread / baselineSpread));
    }
  }

  return {
    estimatedA4: Math.round(medianA4 * 10) / 10,
    suggestedStretchFactor: Math.round(suggestedStretch * 10) / 10
  };
}
