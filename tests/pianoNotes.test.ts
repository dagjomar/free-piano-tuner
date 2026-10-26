import { describe, it, expect } from 'vitest';
import {
  midiToFrequency,
  frequencyToMidi,
  frequencyToCents,
  centsToRatio,
  getPianoNoteByMidi,
  getAllPianoNotes,
  getNearestPianoNote,
  PIANO_MIN_MIDI,
  PIANO_MAX_MIDI
} from '../src/utils/pianoNotes';

describe('Piano Notes & Frequencies Math', () => {
  it('correctly maps standard piano range MIDI numbers', () => {
    expect(PIANO_MIN_MIDI).toBe(21); // A0
    expect(PIANO_MAX_MIDI).toBe(108); // C8

    const allNotes = getAllPianoNotes();
    expect(allNotes.length).toBe(88);
    expect(allNotes[0].fullName).toBe('A0');
    expect(allNotes[0].midi).toBe(21);
    expect(allNotes[allNotes.length - 1].fullName).toBe('C8');
    expect(allNotes[allNotes.length - 1].midi).toBe(108);
  });

  it('computes exact equal temperament frequencies at A4=440', () => {
    // A4 (MIDI 69) = 440.0 Hz
    expect(midiToFrequency(69, 440)).toBeCloseTo(440.0, 3);

    // A0 (MIDI 21) = 27.5 Hz
    expect(midiToFrequency(21, 440)).toBeCloseTo(27.5, 3);

    // Middle C (C4, MIDI 60) ≈ 261.626 Hz
    expect(midiToFrequency(60, 440)).toBeCloseTo(261.626, 2);

    // C8 (MIDI 108) ≈ 4186.009 Hz
    expect(midiToFrequency(108, 440)).toBeCloseTo(4186.009, 1);
  });

  it('supports adjustable A4 reference pitch (e.g. 435 to 445 Hz)', () => {
    expect(midiToFrequency(69, 442)).toBeCloseTo(442.0, 3);
    expect(midiToFrequency(21, 442)).toBeCloseTo(27.625, 3);
    expect(midiToFrequency(69, 438)).toBeCloseTo(438.0, 3);
  });

  it('calculates frequency to MIDI accurately', () => {
    expect(frequencyToMidi(440, 440)).toBeCloseTo(69.0, 4);
    expect(frequencyToMidi(27.5, 440)).toBeCloseTo(21.0, 4);
    expect(frequencyToMidi(261.6256, 440)).toBeCloseTo(60.0, 4);
  });

  it('calculates cents difference correctly', () => {
    // Exact match = 0 cents
    expect(frequencyToCents(440, 440)).toBeCloseTo(0, 4);

    // 1 semitone up = 100 cents
    const aSharp4 = midiToFrequency(70, 440);
    expect(frequencyToCents(aSharp4, 440)).toBeCloseTo(100.0, 2);

    // +5 cents sharp
    const sharp5Cents = 440 * Math.pow(2, 5 / 1200);
    expect(frequencyToCents(sharp5Cents, 440)).toBeCloseTo(5.0, 3);

    // -10 cents flat
    const flat10Cents = 440 * Math.pow(2, -10 / 1200);
    expect(frequencyToCents(flat10Cents, 440)).toBeCloseTo(-10.0, 3);
  });

  it('converts cents to frequency ratios accurately', () => {
    expect(centsToRatio(0)).toBe(1.0);
    expect(centsToRatio(1200)).toBeCloseTo(2.0, 5);
    expect(centsToRatio(-1200)).toBeCloseTo(0.5, 5);
  });

  it('identifies nearest piano note', () => {
    const note1 = getNearestPianoNote(441.2, 440);
    expect(note1.fullName).toBe('A4');

    const note2 = getNearestPianoNote(260.0, 440);
    expect(note2.fullName).toBe('C4');

    const note3 = getNearestPianoNote(27.8, 440);
    expect(note3.fullName).toBe('A0');
  });

  it('provides enharmonic alternative names', () => {
    const cSharp = getPianoNoteByMidi(61, 440);
    expect(cSharp.fullName).toBe('C#4');
    expect(cSharp.altName).toBe('Db4');

    const aNote = getPianoNoteByMidi(69, 440);
    expect(aNote.fullName).toBe('A4');
    expect(aNote.altName).toBeUndefined();
  });
});
