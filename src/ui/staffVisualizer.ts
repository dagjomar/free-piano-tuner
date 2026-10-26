/**
 * Musical Grand Staff & Deviation Visualizer
 * Renders Treble and Bass staves showing:
 * - Real-time note positions from A0 to C8
 * - Visual markers for measured notes
 * - Highlighting and ranking for the worst out-of-tune notes
 * - Click to tune note directly from staff
 */

import { TuningStore } from '../utils/tuningStore';
import { PIANO_MIN_MIDI, PIANO_MAX_MIDI, getPianoNoteByMidi } from '../utils/pianoNotes';

export type StaffSelectCallback = (midi: number) => void;

export class StaffVisualizer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private store: TuningStore;

  private activeMidi: number | null = null;
  private targetMidi: number = 69;
  private onNoteSelect: StaffSelectCallback | null = null;

  constructor(canvas: HTMLCanvasElement, store: TuningStore) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Cannot get 2D canvas context for StaffVisualizer');
    this.ctx = ctx;
    this.store = store;

    this.initEvents();
    this.store.subscribe(() => this.render());
  }

  public setOnNoteSelect(cb: StaffSelectCallback): void {
    this.onNoteSelect = cb;
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
    const width = Math.max(860, Math.floor(rect.width));
    const height = Math.max(160, Math.floor(rect.height || 180));

    if (this.canvas.width !== width * dpr || this.canvas.height !== height * dpr) {
      this.canvas.width = width * dpr;
      this.canvas.height = height * dpr;
    }
    this.render();
  }

  /**
   * Maps diatonic note pitch to vertical staff step (0 = Middle C4).
   * Positive = higher on staff, negative = lower.
   */
  private getDiatonicStep(midi: number): number {
    // Diatonic steps from C4 (MIDI 60)
    // C=0, D=1, E=2, F=3, G=4, A=5, B=6
    const semitoneToStep = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
    const oct = Math.floor(midi / 12) - 1;
    const semi = midi % 12;
    const stepInOct = semitoneToStep[semi];
    return (oct - 4) * 7 + stepInOct;
  }

  public render(): void {
    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    const width = this.canvas.width / dpr;
    const height = this.canvas.height / dpr;

    ctx.save();
    ctx.scale(dpr, dpr);

    // Dark audio plugin panel background
    ctx.fillStyle = '#101114';
    ctx.fillRect(0, 0, width, height);

    // Geometry layout
    const marginX = 54;
    const staffWidth = width - marginX * 2;
    const centerY = height * 0.50;
    const lineSpacing = 8; // distance between staff lines

    // Bass staff (5 lines): centered at centerY + 32
    // Treble staff (5 lines): centered at centerY - 32
    const trebleCenterY = centerY - 34;
    const bassCenterY = centerY + 34;

    // Staff lines color
    ctx.strokeStyle = '#2a2a32';
    ctx.lineWidth = 1;

    // 1. Draw Treble Staff Lines (5 lines)
    for (let i = -2; i <= 2; i++) {
      const y = trebleCenterY + i * lineSpacing;
      ctx.beginPath();
      ctx.moveTo(marginX, y);
      ctx.lineTo(marginX + staffWidth, y);
      ctx.stroke();
    }

    // 2. Draw Bass Staff Lines (5 lines)
    for (let i = -2; i <= 2; i++) {
      const y = bassCenterY + i * lineSpacing;
      ctx.beginPath();
      ctx.moveTo(marginX, y);
      ctx.lineTo(marginX + staffWidth, y);
      ctx.stroke();
    }

    // Clef labels
    ctx.font = '600 11px Inter, sans-serif';
    ctx.fillStyle = '#9a9aa3';
    ctx.textAlign = 'right';
    ctx.fillText('𝄞 Treble', marginX - 10, trebleCenterY + 4);
    ctx.fillText('𝄢 Bass', marginX - 10, bassCenterY + 4);

    // Middle C guide dashed line
    ctx.strokeStyle = '#1e1e24';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(marginX, centerY);
    ctx.lineTo(marginX + staffWidth, centerY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#5c5c66';
    ctx.fillText('C4', marginX - 10, centerY + 3);

    // 3. Draw All 88 Piano Notes along horizontal axis
    // Horizontal position X maps proportionally across the 88 piano keys
    const worstNotes = this.store.getWorstNotes(8, /* onlyUntuned */ true);
    const worstMidiSet = new Set(worstNotes.map((n) => n.midi));
    const stepX = staffWidth / (PIANO_MAX_MIDI - PIANO_MIN_MIDI);

    for (let midi = PIANO_MIN_MIDI; midi <= PIANO_MAX_MIDI; midi++) {
      const x = marginX + (midi - PIANO_MIN_MIDI) * stepX;
      const diatonicStep = this.getDiatonicStep(midi);

      // Vertical position Y from diatonic step (1 step = lineSpacing / 2)
      // Middle C (diatonicStep = 0) is at centerY
      const noteY = centerY - diatonicStep * (lineSpacing * 0.5);

      const keyState = this.store.getKeyState(midi);
      const isTarget = midi === this.targetMidi;
      const isActive = midi === this.activeMidi;
      const isWorst = worstMidiSet.has(midi);
      const isTuned = keyState?.isTuned ?? false;
      const hasMeasurement = keyState?.lastMeasuredCents !== null;

      // Draw ledger lines if outside standard staff bounds
      this.drawLedgerLines(ctx, x, noteY, trebleCenterY, bassCenterY, lineSpacing);

      // Notehead styling
      if (isActive) {
        // Sounding active note - glowing gold aura
        ctx.save();
        ctx.shadowColor = 'rgba(240, 195, 106, 0.8)';
        ctx.shadowBlur = 10;
        ctx.fillStyle = '#f0c36a';
        ctx.beginPath();
        ctx.arc(x, noteY, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else if (isWorst) {
        // Worst out of tune: prominent warning ring
        const rank = worstNotes.findIndex((n) => n.midi === midi) + 1;
        const err = keyState?.lastMeasuredCents ?? 0;
        const ringColor = Math.abs(err) > 15 ? '#e28b7a' : '#e2b15a';

        ctx.strokeStyle = ringColor;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, noteY, 7, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = ringColor;
        ctx.beginPath();
        ctx.arc(x, noteY, 4, 0, Math.PI * 2);
        ctx.fill();

        // Priority Rank label badge above or below note
        ctx.fillStyle = ringColor;
        ctx.font = '700 8px Inter, sans-serif';
        ctx.textAlign = 'center';
        const badgeY = noteY < centerY ? noteY - 10 : noteY + 14;
        ctx.fillText(`! #${rank}`, x, badgeY);
      } else if (isTuned) {
        // Tuned green notehead
        ctx.fillStyle = '#3ddc84';
        ctx.beginPath();
        ctx.arc(x, noteY, 4, 0, Math.PI * 2);
        ctx.fill();
      } else if (hasMeasurement) {
        // Measured notehead with error color
        const err = keyState!.lastMeasuredCents!;
        const color = Math.abs(err) <= 5 ? '#3ddc84' : err < 0 ? '#e2b15a' : '#5b9dff';
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, noteY, 3.5, 0, Math.PI * 2);
        ctx.fill();
      } else if (isTarget) {
        // Target note dot
        ctx.fillStyle = '#2f6fed';
        ctx.beginPath();
        ctx.arc(x, noteY, 4, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Subtle octave dots (e.g. C notes)
        const note = getPianoNoteByMidi(midi);
        if (note.name === 'C') {
          ctx.fillStyle = '#3a3a44';
          ctx.beginPath();
          ctx.arc(x, noteY, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // Legend on bottom right
    ctx.font = '500 10px Inter, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillStyle = '#9a9aa3';
    ctx.fillText('● Measured In-Tune   ▲ / ▼ Out-of-tune   ! # Priority to Tune', width - marginX, height - 8);

    ctx.restore();
  }

  private drawLedgerLines(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    trebleCenterY: number,
    bassCenterY: number,
    spacing: number
  ): void {
    const trebleTop = trebleCenterY - 2 * spacing;
    const bassBottom = bassCenterY + 2 * spacing;
    const ledgerWidth = 12;

    ctx.strokeStyle = '#3a3a44';
    ctx.lineWidth = 1;

    // Above treble staff
    if (y < trebleTop - 2) {
      for (let cur = trebleTop - spacing; cur >= y - 1; cur -= spacing) {
        ctx.beginPath();
        ctx.moveTo(x - ledgerWidth / 2, cur);
        ctx.lineTo(x + ledgerWidth / 2, cur);
        ctx.stroke();
      }
    }

    // Below bass staff
    if (y > bassBottom + 2) {
      for (let cur = bassBottom + spacing; cur <= y + 1; cur += spacing) {
        ctx.beginPath();
        ctx.moveTo(x - ledgerWidth / 2, cur);
        ctx.lineTo(x + ledgerWidth / 2, cur);
        ctx.stroke();
      }
    }
  }

  private initEvents(): void {
    this.canvas.addEventListener('click', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const scaleX = (this.canvas.width / dpr) / rect.width;
      const clickX = (e.clientX - rect.left) * scaleX;

      const marginX = 54;
      const staffWidth = (this.canvas.width / dpr) - marginX * 2;
      const stepX = staffWidth / (PIANO_MAX_MIDI - PIANO_MIN_MIDI);

      // Find nearest MIDI note by horizontal proximity
      const relativeX = clickX - marginX;
      const nearestMidi = Math.round(relativeX / stepX) + PIANO_MIN_MIDI;

      if (nearestMidi >= PIANO_MIN_MIDI && nearestMidi <= PIANO_MAX_MIDI) {
        this.targetMidi = nearestMidi;
        if (this.onNoteSelect) {
          this.onNoteSelect(nearestMidi);
        }
        this.render();
      }
    });
  }
}
