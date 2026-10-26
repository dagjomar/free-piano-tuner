/**
 * Interactive 88-Key Piano Roll Canvas Component
 * Provides a wide piano keyboard visualization matching physical piano keys (A0 to C8).
 * Features:
 * - Real-time active key highlight when played or selected
 * - Tuned / OK checkmarks on each key
 * - Measured cents deviation indicator dots
 * - Click to select target note or toggle tuned status
 * - Professional audio-plugin styling (dark ebony & ivory aesthetics)
 */

import { TuningStore, KeyTuningState } from '../utils/tuningStore';
import { PIANO_MIN_MIDI, PIANO_MAX_MIDI } from '../utils/pianoNotes';

export interface KeyLayout {
  midi: number;
  isBlack: boolean;
  name: string;
  octave: number;
  fullName: string;
  whiteIndex: number; // 0 to 51
  x: number;
  y: number;
  width: number;
  height: number;
}

export type KeySelectCallback = (midi: number) => void;
export type KeyHoverCallback = (midi: number | null) => void;

export class PianoRoll {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private store: TuningStore;
  private keyLayouts: Map<number, KeyLayout> = new Map();

  private activeMidi: number | null = null;
  private targetMidi: number = 69; // A4 default
  private hoveredMidi: number | null = null;
  private onKeySelect: KeySelectCallback | null = null;
  private onKeyHover: KeyHoverCallback | null = null;

  // Visual layout dimensions
  private totalWhiteKeys = 52;
  private whiteKeyWidth = 24;
  private whiteKeyHeight = 120;
  private blackKeyWidth = 14;
  private blackKeyHeight = 74;

  constructor(canvas: HTMLCanvasElement, store: TuningStore) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Cannot get 2D canvas context for PianoRoll');
    this.ctx = ctx;
    this.store = store;

    this.initEvents();
    this.computeLayout();
    this.store.subscribe(() => this.render());
  }

  public setOnKeySelect(cb: KeySelectCallback): void {
    this.onKeySelect = cb;
  }

  public setOnKeyHover(cb: KeyHoverCallback): void {
    this.onKeyHover = cb;
  }

  public setActiveMidi(midi: number | null): void {
    if (this.activeMidi !== midi) {
      this.activeMidi = midi;
      this.render();
    }
  }

  public setTargetMidi(midi: number): void {
    if (this.targetMidi !== midi) {
      this.targetMidi = midi;
      this.render();
    }
  }

  public resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(320, Math.floor(rect.width));
    const height = Math.max(64, Math.floor(rect.height || 160));

    if (this.canvas.width !== width * dpr || this.canvas.height !== height * dpr) {
      this.canvas.width = width * dpr;
      this.canvas.height = height * dpr;
    }

    this.computeLayout();
    this.render();
  }

  private computeLayout(): void {
    const dpr = window.devicePixelRatio || 1;
    const totalWidth = this.canvas.width / dpr;
    const totalHeight = this.canvas.height / dpr;

    this.whiteKeyWidth = totalWidth / this.totalWhiteKeys;
    this.whiteKeyHeight = totalHeight - 6;
    this.blackKeyWidth = this.whiteKeyWidth * 0.62;
    this.blackKeyHeight = this.whiteKeyHeight * 0.62;

    this.keyLayouts.clear();
    let currentWhiteIndex = 0;

    // A0 (21), Bb0 (22), B0 (23)
    this.keyLayouts.set(21, {
      midi: 21,
      isBlack: false,
      name: 'A',
      octave: 0,
      fullName: 'A0',
      whiteIndex: currentWhiteIndex,
      x: currentWhiteIndex * this.whiteKeyWidth,
      y: 0,
      width: this.whiteKeyWidth,
      height: this.whiteKeyHeight
    });
    currentWhiteIndex++;

    this.keyLayouts.set(23, {
      midi: 23,
      isBlack: false,
      name: 'B',
      octave: 0,
      fullName: 'B0',
      whiteIndex: currentWhiteIndex,
      x: currentWhiteIndex * this.whiteKeyWidth,
      y: 0,
      width: this.whiteKeyWidth,
      height: this.whiteKeyHeight
    });
    currentWhiteIndex++;

    // Bb0 between white 0 and 1
    this.keyLayouts.set(22, {
      midi: 22,
      isBlack: true,
      name: 'Bb',
      octave: 0,
      fullName: 'Bb0',
      whiteIndex: 0,
      x: 1 * this.whiteKeyWidth - this.blackKeyWidth * 0.5,
      y: 0,
      width: this.blackKeyWidth,
      height: this.blackKeyHeight
    });

    // C1–B7. C1 is MIDI 24. (The previous formula started at C2 and then
    // parked C8 seven white keys past B7, which left the gap before key 88.)
    const semitoneNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const isSemitoneBlack = [false, true, false, true, false, false, true, false, true, false, true, false];

    for (let oct = 1; oct <= 7; oct++) {
      const baseMidi = (oct + 1) * 12;

      // First pass: white keys in octave
      const octaveWhiteStartIndex = currentWhiteIndex;
      for (let s = 0; s < 12; s++) {
        if (!isSemitoneBlack[s]) {
          const midi = baseMidi + s;
          const name = semitoneNames[s];
          this.keyLayouts.set(midi, {
            midi,
            isBlack: false,
            name,
            octave: oct,
            fullName: `${name}${oct}`,
            whiteIndex: currentWhiteIndex,
            x: currentWhiteIndex * this.whiteKeyWidth,
            y: 0,
            width: this.whiteKeyWidth,
            height: this.whiteKeyHeight
          });
          currentWhiteIndex++;
        }
      }

      // Second pass: black keys in octave
      // C# is between C and D (seam at octaveWhiteStartIndex + 1)
      // D# is between D and E (seam at octaveWhiteStartIndex + 2)
      // F# is between F and G (seam at octaveWhiteStartIndex + 4)
      // G# is between G and A (seam at octaveWhiteStartIndex + 5)
      // A# is between A and B (seam at octaveWhiteStartIndex + 6)
      const blackSeamOffsets = [
        { semi: 1, seam: 1 },
        { semi: 3, seam: 2 },
        { semi: 6, seam: 4 },
        { semi: 8, seam: 5 },
        { semi: 10, seam: 6 }
      ];

      for (const item of blackSeamOffsets) {
        const midi = baseMidi + item.semi;
        const name = semitoneNames[item.semi];
        const seamX = (octaveWhiteStartIndex + item.seam) * this.whiteKeyWidth;
        this.keyLayouts.set(midi, {
          midi,
          isBlack: true,
          name,
          octave: oct,
          fullName: `${name}${oct}`,
          whiteIndex: octaveWhiteStartIndex + item.seam - 1,
          x: seamX - this.blackKeyWidth * 0.5,
          y: 0,
          width: this.blackKeyWidth,
          height: this.blackKeyHeight
        });
      }
    }

    // C8 (MIDI 108) - top single white key
    this.keyLayouts.set(108, {
      midi: 108,
      isBlack: false,
      name: 'C',
      octave: 8,
      fullName: 'C8',
      whiteIndex: currentWhiteIndex,
      x: currentWhiteIndex * this.whiteKeyWidth,
      y: 0,
      width: this.whiteKeyWidth,
      height: this.whiteKeyHeight
    });
  }

  public render(): void {
    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    const width = this.canvas.width / dpr;
    const height = this.canvas.height / dpr;

    ctx.save();
    ctx.scale(dpr, dpr);

    // Dark chassis background
    ctx.fillStyle = '#0c0c0e';
    ctx.fillRect(0, 0, width, height);

    // 1. Draw All White Keys First
    for (let midi = PIANO_MIN_MIDI; midi <= PIANO_MAX_MIDI; midi++) {
      const layout = this.keyLayouts.get(midi);
      if (layout && !layout.isBlack) {
        this.drawWhiteKey(ctx, layout);
      }
    }

    // 2. Draw All Black Keys Over White Keys
    for (let midi = PIANO_MIN_MIDI; midi <= PIANO_MAX_MIDI; midi++) {
      const layout = this.keyLayouts.get(midi);
      if (layout && layout.isBlack) {
        this.drawBlackKey(ctx, layout);
      }
    }

    // Top border rail
    ctx.fillStyle = '#222228';
    ctx.fillRect(0, 0, width, 4);

    ctx.restore();
  }

  private drawWhiteKey(ctx: CanvasRenderingContext2D, layout: KeyLayout): void {
    const keyState = this.store.getKeyState(layout.midi);
    const isTarget = layout.midi === this.targetMidi;
    const isActive = layout.midi === this.activeMidi;
    const isHovered = layout.midi === this.hoveredMidi;
    const isTuned = keyState?.isTuned ?? false;

    const x = layout.x;
    const y = layout.y + 4;
    const w = layout.width;
    const h = layout.height - 4;

    // Key base color
    let fill = '#f2f2f4'; // ivory
    if (isActive) {
      fill = '#f0c36a'; // warm gold when sounding
    } else if (isTarget) {
      fill = '#e6dfce'; // selected target
    } else if (isHovered) {
      fill = '#fafafc';
    }

    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w, h);

    // Subtle 3D bottom bevel
    ctx.fillStyle = isActive ? '#d4a84f' : '#d8d8de';
    ctx.fillRect(x, y + h - 5, w, 5);

    // White key separation line
    ctx.strokeStyle = '#2a2a30';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);

    // C octave labels at bottom of C keys
    if (layout.name === 'C' || layout.midi === 21) {
      ctx.fillStyle = isActive ? '#141416' : '#6a6a72';
      ctx.font = '600 9px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(layout.fullName, x + w / 2, y + h - 8);
    }

    // Tuned checkmark or deviation indicator badge at bottom
    this.drawKeyBadge(ctx, layout, keyState, x + w / 2, y + h - 22, isTuned, isActive);
  }

  private drawBlackKey(ctx: CanvasRenderingContext2D, layout: KeyLayout): void {
    const keyState = this.store.getKeyState(layout.midi);
    const isTarget = layout.midi === this.targetMidi;
    const isActive = layout.midi === this.activeMidi;
    const isHovered = layout.midi === this.hoveredMidi;
    const isTuned = keyState?.isTuned ?? false;

    const x = layout.x;
    const y = layout.y + 4;
    const w = layout.width;
    const h = layout.height - 4;

    // Black key drop shadow onto white keys
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(x + w, y, 3, h + 2);

    // Key body
    let fill = '#16161a';
    if (isActive) {
      fill = '#e2b15a';
    } else if (isTarget) {
      fill = '#2c2c36';
    } else if (isHovered) {
      fill = '#222228';
    }

    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w, h);

    // Black key bevel top highlight
    ctx.fillStyle = isActive ? '#f0c36a' : '#2a2a32';
    ctx.fillRect(x + 1, y, w - 2, h - 6);

    ctx.strokeStyle = '#08080a';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);

    // Tuned badge on black key
    this.drawKeyBadge(ctx, layout, keyState, x + w / 2, y + h - 14, isTuned, isActive, true);
  }

  private drawKeyBadge(
    ctx: CanvasRenderingContext2D,
    layout: KeyLayout,
    keyState: KeyTuningState | undefined,
    cx: number,
    cy: number,
    isTuned: boolean,
    isActive: boolean,
    isBlack = false
  ): void {
    if (isTuned) {
      // Emerald Green checkmark circle
      ctx.fillStyle = '#3ddc84';
      ctx.beginPath();
      ctx.arc(cx, cy, isBlack ? 4 : 5, 0, Math.PI * 2);
      ctx.fill();

      // Checkmark icon
      ctx.strokeStyle = '#082f1b';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(cx - 2, cy);
      ctx.lineTo(cx - 0.5, cy + 2);
      ctx.lineTo(cx + 2.5, cy - 1.5);
      ctx.stroke();
    } else if (keyState && keyState.lastMeasuredCents !== null) {
      // Measured but not marked tuned: show colored deviation dot
      const err = keyState.lastMeasuredCents;
      const absErr = Math.abs(err);
      const dotColor = absErr <= 5 ? '#3ddc84' : err < 0 ? '#e2b15a' : '#5b9dff';

      ctx.fillStyle = dotColor;
      ctx.beginPath();
      ctx.arc(cx, cy, isBlack ? 3 : 3.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (layout.midi === this.targetMidi) {
      // Small focus dot for target key
      ctx.fillStyle = isActive ? '#141416' : '#2f6fed';
      ctx.beginPath();
      ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private initEvents(): void {
    const getPos = (e: MouseEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const scaleX = (this.canvas.width / dpr) / rect.width;
      const scaleY = (this.canvas.height / dpr) / rect.height;
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY
      };
    };

    const findKeyAt = (x: number, y: number): number | null => {
      // Check black keys first (they sit on top)
      for (let midi = PIANO_MIN_MIDI; midi <= PIANO_MAX_MIDI; midi++) {
        const layout = this.keyLayouts.get(midi);
        if (layout && layout.isBlack) {
          if (
            x >= layout.x &&
            x <= layout.x + layout.width &&
            y >= layout.y &&
            y <= layout.y + layout.height
          ) {
            return midi;
          }
        }
      }

      // Check white keys
      for (let midi = PIANO_MIN_MIDI; midi <= PIANO_MAX_MIDI; midi++) {
        const layout = this.keyLayouts.get(midi);
        if (layout && !layout.isBlack) {
          if (
            x >= layout.x &&
            x <= layout.x + layout.width &&
            y >= layout.y &&
            y <= layout.y + layout.height
          ) {
            return midi;
          }
        }
      }
      return null;
    };

    this.canvas.addEventListener('mousemove', (e) => {
      const pos = getPos(e);
      const midi = findKeyAt(pos.x, pos.y);
      if (this.hoveredMidi !== midi) {
        this.hoveredMidi = midi;
        if (this.onKeyHover) {
          this.onKeyHover(midi);
        }
        this.render();
      }
    });

    this.canvas.addEventListener('mouseleave', () => {
      if (this.hoveredMidi !== null) {
        this.hoveredMidi = null;
        if (this.onKeyHover) {
          this.onKeyHover(null);
        }
        this.render();
      }
    });

    this.canvas.addEventListener('click', (e) => {
      const pos = getPos(e);
      const midi = findKeyAt(pos.x, pos.y);
      if (midi !== null) {
        if (e.shiftKey) {
          // Shift+click toggles tuned status directly on the key
          this.store.toggleTuned(midi);
        } else {
          this.targetMidi = midi;
          if (this.onKeySelect) {
            this.onKeySelect(midi);
          }
        }
        this.render();
      }
    });
  }
}
