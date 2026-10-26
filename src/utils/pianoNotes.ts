/**
 * Piano notes, frequency math, cents calculation, and 88-key piano specifications.
 */

export interface PianoNote {
  midi: number;
  name: string;
  octave: number;
  fullName: string; // e.g. "A0", "C4", "F#5"
  altName?: string; // e.g. "Bb0", "Db4", "Gb5"
  frequency: number;
  keyNumber: number; // 1 to 88 (1 = A0, 88 = C8)
}

const NOTE_NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOTE_NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

export const PIANO_MIN_MIDI = 21; // A0
export const PIANO_MAX_MIDI = 108; // C8
export const PIANO_TOTAL_KEYS = 88;
export const DEFAULT_A4_FREQ = 440.0;

/**
 * Calculates equal temperament frequency for a MIDI note number.
 */
export function midiToFrequency(midi: number, a4: number = DEFAULT_A4_FREQ): number {
  return a4 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Calculates fractional MIDI note number from frequency.
 */
export function frequencyToMidi(frequency: number, a4: number = DEFAULT_A4_FREQ): number {
  if (frequency <= 0) return 0;
  return 69 + 12 * Math.log2(frequency / a4);
}

/**
 * Computes cents difference between a measured frequency and target frequency.
 * Returns positive if measured is sharp (higher than target), negative if flat.
 */
export function frequencyToCents(frequency: number, targetFrequency: number): number {
  if (frequency <= 0 || targetFrequency <= 0) return 0;
  return 1200 * Math.log2(frequency / targetFrequency);
}

/**
 * Converts a cents deviation to a frequency multiplier ratio.
 */
export function centsToRatio(cents: number): number {
  return Math.pow(2, cents / 1200);
}

/**
 * Creates PianoNote data structure for a given MIDI number.
 */
export function getPianoNoteByMidi(midi: number, a4: number = DEFAULT_A4_FREQ): PianoNote {
  const noteIndex = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  const sharpName = NOTE_NAMES_SHARP[noteIndex];
  const flatName = NOTE_NAMES_FLAT[noteIndex];
  const isAccidental = sharpName.includes('#');

  const fullName = `${sharpName}${octave}`;
  const altName = isAccidental ? `${flatName}${octave}` : undefined;
  const keyNumber = midi - PIANO_MIN_MIDI + 1;
  const frequency = midiToFrequency(midi, a4);

  return {
    midi,
    name: sharpName,
    octave,
    fullName,
    altName,
    frequency,
    keyNumber
  };
}

/**
 * Generates array of all 88 piano notes (A0 to C8).
 */
export function getAllPianoNotes(a4: number = DEFAULT_A4_FREQ): PianoNote[] {
  const notes: PianoNote[] = [];
  for (let midi = PIANO_MIN_MIDI; midi <= PIANO_MAX_MIDI; midi++) {
    notes.push(getPianoNoteByMidi(midi, a4));
  }
  return notes;
}

/**
 * Finds the nearest piano note for a measured frequency within equal temperament.
 */
export function getNearestPianoNote(frequency: number, a4: number = DEFAULT_A4_FREQ): PianoNote {
  if (frequency <= 0) {
    return getPianoNoteByMidi(69, a4); // default A4
  }

  const fracMidi = frequencyToMidi(frequency, a4);
  const roundedMidi = Math.round(fracMidi);
  const clampedMidi = Math.max(PIANO_MIN_MIDI, Math.min(PIANO_MAX_MIDI, roundedMidi));

  return getPianoNoteByMidi(clampedMidi, a4);
}
