/**
 * High-performance Radix-2 FFT and windowing utilities.
 * Precomputes twiddle factors and bit reversals to avoid GC churn in real-time loops.
 */

export class Radix2FFT {
  public readonly size: number;
  private readonly cosTable: Float32Array;
  private readonly sinTable: Float32Array;
  private readonly bitReversal: Uint32Array;

  constructor(size: number) {
    if ((size & (size - 1)) !== 0 || size < 2) {
      throw new Error(`FFT size must be a power of 2, received ${size}`);
    }
    this.size = size;

    // Bit reversal permutation table
    this.bitReversal = new Uint32Array(size);
    const bits = Math.round(Math.log2(size));
    for (let i = 0; i < size; i++) {
      let rev = 0;
      for (let j = 0; j < bits; j++) {
        rev = (rev << 1) | ((i >> j) & 1);
      }
      this.bitReversal[i] = rev;
    }

    // Twiddle factors
    const half = size / 2;
    this.cosTable = new Float32Array(half);
    this.sinTable = new Float32Array(half);
    for (let i = 0; i < half; i++) {
      const angle = (-2 * Math.PI * i) / size;
      this.cosTable[i] = Math.cos(angle);
      this.sinTable[i] = Math.sin(angle);
    }
  }

  /**
   * In-place Radix-2 Cooley-Tukey complex FFT.
   * If inverse is true, computes the inverse FFT (scaled by 1/N).
   */
  public transform(real: Float32Array, imag: Float32Array, inverse = false): void {
    const n = this.size;
    const bitRev = this.bitReversal;

    // Bit-reversal permutation
    for (let i = 0; i < n; i++) {
      const j = bitRev[i];
      if (j > i) {
        const tr = real[i];
        real[i] = real[j];
        real[j] = tr;

        const ti = imag[i];
        imag[i] = imag[j];
        imag[j] = ti;
      }
    }

    // Cooley-Tukey butterflies
    for (let len = 2; len <= n; len <<= 1) {
      const halfLen = len >> 1;
      const step = n / len;

      for (let i = 0; i < n; i += len) {
        for (let j = 0; j < halfLen; j++) {
          const tableIdx = j * step;
          const c = this.cosTable[tableIdx];
          const s = inverse ? -this.sinTable[tableIdx] : this.sinTable[tableIdx];

          const k = i + j;
          const kHalf = k + halfLen;

          const uReal = real[k];
          const uImag = imag[k];

          const vReal = real[kHalf] * c - imag[kHalf] * s;
          const vImag = real[kHalf] * s + imag[kHalf] * c;

          real[k] = uReal + vReal;
          imag[k] = uImag + vImag;

          real[kHalf] = uReal - vReal;
          imag[kHalf] = uImag - vImag;
        }
      }
    }

    // Scale inverse transform
    if (inverse) {
      const invN = 1 / n;
      for (let i = 0; i < n; i++) {
        real[i] *= invN;
        imag[i] *= invN;
      }
    }
  }
}

/**
 * Creates a Hann window for smoothing time-domain buffers.
 */
export function createHannWindow(size: number): Float32Array {
  const window = new Float32Array(size);
  const factor = (2 * Math.PI) / (size - 1);
  for (let i = 0; i < size; i++) {
    window[i] = 0.5 * (1 - Math.cos(factor * i));
  }
  return window;
}

/**
 * Creates a 4-term Blackman-Harris window for high-dynamic-range spectral analysis.
 */
export function createBlackmanHarrisWindow(size: number): Float32Array {
  const window = new Float32Array(size);
  const a0 = 0.35875;
  const a1 = 0.48829;
  const a2 = 0.14128;
  const a3 = 0.01168;
  const factor = (2 * Math.PI) / (size - 1);

  for (let i = 0; i < size; i++) {
    const angle = factor * i;
    window[i] =
      a0 -
      a1 * Math.cos(angle) +
      a2 * Math.cos(2 * angle) -
      a3 * Math.cos(3 * angle);
  }
  return window;
}
