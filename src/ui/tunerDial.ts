/**
 * High-performance Canvas renderer for the tuner cents meter / dial.
 * Styled with professional audio-plugin aesthetics:
 * - Color palette borrowed from One Curve EQ (--sum: #f0c36a, --success: #3ddc84, --warn: #e2b15a, --line: #2a2a30)
 * - Clear in-tune target zone (+/- N cents)
 * - Graduated tick marks from -50 to +50 cents
 * - Needle / bar with smooth animation and glowing indicator
 */

export class TunerDialRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private currentCents = 0;
  private targetCents = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) {
      throw new Error('Canvas 2D context not available');
    }
    this.ctx = ctx;
    this.handleResize();
  }

  public handleResize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.floor(rect.width * dpr);
    const height = Math.floor(rect.height * dpr);

    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  /**
   * Updates display needle position.
   * @param cents Target cents offset (-50 to +50)
   * @param toleranceCents In-tune threshold (e.g. 5 cents)
   * @param hasSignal Whether active note audio is detected
   */
  public render(cents: number, toleranceCents: number, hasSignal: boolean): void {
    this.handleResize();
    const ctx = this.ctx;
    const width = this.canvas.width;
    const height = this.canvas.height;
    if (width === 0 || height === 0) return;

    this.targetCents = hasSignal ? Math.max(-50, Math.min(50, cents)) : 0;
    // Fast exponential smooth towards target cents
    this.currentCents += (this.targetCents - this.currentCents) * 0.45;
    if (!hasSignal && Math.abs(this.currentCents) < 0.2) {
      this.currentCents = 0;
    }

    // Audio plugin dark background
    ctx.fillStyle = '#101114';
    ctx.fillRect(0, 0, width, height);

    const centerX = width / 2;
    const centerY = height * 0.72;
    const meterWidth = width * 0.88;
    const halfMeter = meterWidth / 2;

    const centsToX = (c: number) => centerX + (c / 50) * halfMeter;

    // 1. Draw In-Tune Green Target Zone
    const greenLeftX = centsToX(-toleranceCents);
    const greenRightX = centsToX(toleranceCents);
    const zoneHeight = height * 0.50;
    const zoneTopY = centerY - zoneHeight * 0.55;

    const isInTune = hasSignal && Math.abs(this.currentCents) <= toleranceCents;

    ctx.fillStyle = isInTune
      ? 'rgba(61, 220, 132, 0.28)'
      : 'rgba(61, 220, 132, 0.10)';
    ctx.fillRect(greenLeftX, zoneTopY, greenRightX - greenLeftX, zoneHeight);

    // Green zone boundaries
    ctx.strokeStyle = isInTune ? '#3ddc84' : 'rgba(61, 220, 132, 0.45)';
    ctx.lineWidth = Math.max(1, width * 0.003);
    ctx.beginPath();
    ctx.moveTo(greenLeftX, zoneTopY);
    ctx.lineTo(greenLeftX, zoneTopY + zoneHeight);
    ctx.moveTo(greenRightX, zoneTopY);
    ctx.lineTo(greenRightX, zoneTopY + zoneHeight);
    ctx.stroke();

    // 2. Base Horizontal Scale Line
    ctx.strokeStyle = '#2a2a30';
    ctx.lineWidth = Math.max(2, width * 0.004);
    ctx.beginPath();
    ctx.moveTo(centerX - halfMeter, centerY);
    ctx.lineTo(centerX + halfMeter, centerY);
    ctx.stroke();

    // 3. Graduated Tick Marks
    const ticks = [-50, -40, -30, -20, -10, -5, 0, 5, 10, 20, 30, 40, 50];
    const fontSize = Math.max(10, Math.floor(height * 0.15));
    ctx.font = `600 ${fontSize}px Inter, "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    for (const tick of ticks) {
      const x = centsToX(tick);
      const isMajor = tick % 10 === 0;
      const isZero = tick === 0;
      const tickLength = isZero ? height * 0.36 : isMajor ? height * 0.22 : height * 0.14;

      ctx.beginPath();
      ctx.moveTo(x, centerY - tickLength / 2);
      ctx.lineTo(x, centerY + tickLength / 2);

      if (isZero) {
        ctx.strokeStyle = '#3ddc84';
        ctx.lineWidth = Math.max(2, width * 0.005);
      } else if (Math.abs(tick) <= toleranceCents) {
        ctx.strokeStyle = '#3ddc84';
        ctx.lineWidth = Math.max(1.5, width * 0.003);
      } else {
        ctx.strokeStyle = '#3a3a42';
        ctx.lineWidth = Math.max(1, width * 0.002);
      }
      ctx.stroke();

      if (isMajor || tick === -50 || tick === 50) {
        ctx.fillStyle = isZero ? '#3ddc84' : '#6a6a72';
        const labelText = tick === 0 ? '0' : tick > 0 ? `+${tick}` : `${tick}`;
        ctx.fillText(labelText, x, centerY + tickLength / 2 + 4);
      }
    }

    // 4. FLAT and SHARP labels
    const edgeFontSize = Math.max(11, Math.floor(height * 0.16));
    ctx.font = `600 ${edgeFontSize}px Inter, sans-serif`;
    ctx.fillStyle = '#e2b15a';
    ctx.fillText('FLAT ♭', centsToX(-38), zoneTopY - edgeFontSize - 2);

    ctx.fillStyle = '#5b9dff';
    ctx.fillText('SHARP ♯', centsToX(38), zoneTopY - edgeFontSize - 2);

    // 5. Animated Needle with audio plugin glow
    if (hasSignal) {
      const needleX = centsToX(this.currentCents);
      const needleTopY = centerY - height * 0.48;
      const needleBottomY = centerY + height * 0.32;

      let needleColor = '#e2b15a'; // amber warn
      let glowColor = 'rgba(226, 177, 90, 0.5)';

      if (isInTune) {
        needleColor = '#3ddc84'; // green success
        glowColor = 'rgba(61, 220, 132, 0.7)';
      } else if (this.currentCents > toleranceCents) {
        needleColor = '#5b9dff'; // blue sharp
        glowColor = 'rgba(91, 157, 255, 0.6)';
      }

      ctx.save();
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = Math.max(10, width * 0.02);

      ctx.strokeStyle = needleColor;
      ctx.lineWidth = Math.max(3.5, width * 0.007);
      ctx.beginPath();
      ctx.moveTo(needleX, needleTopY);
      ctx.lineTo(needleX, needleBottomY);
      ctx.stroke();

      // Needle pointer cap
      ctx.fillStyle = needleColor;
      ctx.beginPath();
      ctx.moveTo(needleX, needleTopY - 4);
      ctx.lineTo(needleX - 7, needleTopY + 8);
      ctx.lineTo(needleX + 7, needleTopY + 8);
      ctx.closePath();
      ctx.fill();

      // Pivot dot
      ctx.beginPath();
      ctx.arc(needleX, centerY, Math.max(4, width * 0.007), 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    } else {
      ctx.strokeStyle = '#2a2a30';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(centerX, centerY - height * 0.25);
      ctx.lineTo(centerX, centerY + height * 0.25);
      ctx.stroke();
    }
  }
}
