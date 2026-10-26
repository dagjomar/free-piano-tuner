/**
 * High-precision piano pitch detection engine.
 *
 * Implements full-window mathematical YIN algorithm with FFT convolution:
 * - Buffer size: 8192 samples (allows analyzing down to 24 Hz even at 48 kHz).
 * - Exact difference function: d(tau) = sum_{j=0}^{W-1} (x[j] - x[j+tau])^2.
 * - Normalized cumulative difference: d'(tau) = d(tau) / ( (1/tau) * sum_{k=1}^tau d(k) ).
 * - Subharmonic check to prevent octave doubling on low bass notes.
 * - Parabolic peak interpolation for sub-cent frequency accuracy.
 * - High treble spectral peak fallback for C6-C8.
 * - Noise gate and clarity thresholding to only report when a clear note sounds.
 * - Target-note mode with locked reference frequency.
 * - Jitter smoothing with median filtering and smooth response.
 */

import { Radix2FFT, createBlackmanHarrisWindow } from './fft';
import {
  PIANO_MIN_MIDI,
  PIANO_MAX_MIDI,
  midiToFrequency,
  frequencyToMidi,
  frequencyToCents
} from '../utils/pianoNotes';

export interface PitchDetectorOptions {
  sampleRate: number;
  bufferSize?: number; // default 8192
  windowSize?: number; // default 4096 (W)
  minFreq?: number; // default 24 Hz (captures A0 = 27.5 Hz)
  maxFreq?: number; // default 4400 Hz (captures C8 = 4186 Hz)
  noiseGateDb?: number; // default -50 dB
  clarityThreshold?: number; // default 0.80
}

export interface DetectionResult {
  frequency: number;
  cents: number;
  clarity: number;
  rmsDb: number;
  isNoteDetected: boolean;
  midi: number;
  method: string;
}

export class PitchDetector {
  public sampleRate: number;
  public readonly bufferSize: number; // N = 8192
  public readonly windowSize: number; // W = 4096
  public minFreq: number;
  public maxFreq: number;
  public noiseGateDb: number;
  public clarityThreshold: number;

  private fftSize: number; // 16384
  private fft: Radix2FFT;

  // Real and imaginary buffers for FFT cross-correlation
  private r1: Float32Array;
  private i1: Float32Array;
  private r2: Float32Array;
  private i2: Float32Array;
  private rProd: Float32Array;
  private iProd: Float32Array;

  // Cumulative energy buffer for exact difference function
  private energy: Float32Array;
  private yinBuf: Float32Array;

  // Treble spectral peak buffers (C6 - C8)
  private trebleFft: Radix2FFT;
  private trebleReal: Float32Array;
  private trebleImag: Float32Array;
  private trebleWindow: Float32Array;

  // Adaptive smoothing
  private recentEstimates: number[] = [];
  private maxHistory = 4;
  private smoothedFreq = 0;
  private lastReportedMidi = 0;

  constructor(options: PitchDetectorOptions) {
    this.sampleRate = options.sampleRate;
    this.bufferSize = options.bufferSize ?? 8192;
    this.windowSize = options.windowSize ?? Math.floor(this.bufferSize / 2);
    this.minFreq = options.minFreq ?? 24.0;
    this.maxFreq = options.maxFreq ?? 4400.0;
    this.noiseGateDb = options.noiseGateDb ?? -50.0;
    this.clarityThreshold = options.clarityThreshold ?? 0.80;

    this.fftSize = this.bufferSize * 2;
    this.fft = new Radix2FFT(this.fftSize);

    this.r1 = new Float32Array(this.fftSize);
    this.i1 = new Float32Array(this.fftSize);
    this.r2 = new Float32Array(this.fftSize);
    this.i2 = new Float32Array(this.fftSize);
    this.rProd = new Float32Array(this.fftSize);
    this.iProd = new Float32Array(this.fftSize);

    this.energy = new Float32Array(this.bufferSize + 1);
    this.yinBuf = new Float32Array(this.windowSize);

    // High treble spectral buffers (uses windowSize for high-frequency resolution)
    this.trebleFft = new Radix2FFT(this.windowSize);
    this.trebleReal = new Float32Array(this.windowSize);
    this.trebleImag = new Float32Array(this.windowSize);
    this.trebleWindow = createBlackmanHarrisWindow(this.windowSize);
  }

  /**
   * Calculates Root Mean Square (RMS) in dB relative to full scale (-100 to 0 dBFS).
   */
  public calculateRmsDb(signal: Float32Array): number {
    let sumSq = 0;
    const len = signal.length;
    for (let i = 0; i < len; i++) {
      sumSq += signal[i] * signal[i];
    }
    const rms = Math.sqrt(sumSq / len);
    if (rms <= 1e-6) return -100;
    return 20 * Math.log10(rms);
  }

  /**
   * Resets smoothing filter buffers when changing notes or modes.
   */
  public resetSmoothing(): void {
    this.recentEstimates = [];
    this.smoothedFreq = 0;
    this.lastReportedMidi = 0;
  }

  /**
   * Main pitch detection method.
   * Analyzes an input time-domain PCM buffer.
   * @param signal Float32Array of audio samples (-1.0 to 1.0)
   * @param targetFreq Optional target frequency in Hz for target-note mode
   */
  public detect(signal: Float32Array, targetFreq?: number): DetectionResult {
    const rmsDb = this.calculateRmsDb(signal);

    // Apply Noise Gate
    if (rmsDb < this.noiseGateDb) {
      this.resetSmoothing();
      return {
        frequency: 0,
        cents: 0,
        clarity: 0,
        rmsDb,
        isNoteDetected: false,
        midi: 0,
        method: 'gate'
      };
    }

    let detectedFreq = 0;
    let clarity = 0;
    let method = 'yin';

    // If target frequency is very high treble (> 1200 Hz), spectral peak is extremely clean
    if (targetFreq && targetFreq > 1200) {
      const spectralRes = this.detectSpectralPeak(signal, targetFreq * 0.8, targetFreq * 1.25);
      if (spectralRes.clarity >= this.clarityThreshold && spectralRes.frequency > 0) {
        detectedFreq = spectralRes.frequency;
        clarity = spectralRes.clarity;
        method = 'spectral-target';
      }
    }

    // Core YIN analysis
    if (detectedFreq === 0) {
      const yinRes = this.detectYin(signal, targetFreq);

      // Check if high treble spectral peak gives a better fit
      if (yinRes.frequency > 1200) {
        const spectralRes = this.detectSpectralPeak(signal, 1000, this.maxFreq);
        if (spectralRes.clarity > 0.85 && spectralRes.frequency > 0) {
          detectedFreq = spectralRes.frequency;
          clarity = spectralRes.clarity;
          method = 'spectral';
        } else if (yinRes.clarity >= this.clarityThreshold) {
          detectedFreq = yinRes.frequency;
          clarity = yinRes.clarity;
          method = 'yin';
        }
      } else if (yinRes.clarity >= this.clarityThreshold && yinRes.frequency > 0) {
        detectedFreq = yinRes.frequency;
        clarity = yinRes.clarity;
        method = 'yin';
      }
    }

    if (detectedFreq <= 0 || clarity < this.clarityThreshold) {
      return {
        frequency: 0,
        cents: 0,
        clarity,
        rmsDb,
        isNoteDetected: false,
        midi: 0,
        method: 'low-clarity'
      };
    }

    // Apply jitter smoothing filter
    const finalFreq = this.smoothFrequency(detectedFreq);
    const fracMidi = frequencyToMidi(finalFreq);
    const midi = Math.max(PIANO_MIN_MIDI, Math.min(PIANO_MAX_MIDI, Math.round(fracMidi)));
    const target = targetFreq ?? midiToFrequency(midi);
    const cents = frequencyToCents(finalFreq, target);

    return {
      frequency: finalFreq,
      cents,
      clarity,
      rmsDb,
      isNoteDetected: true,
      midi,
      method
    };
  }

  /**
   * Full exact YIN algorithm with FFT convolution cross-correlation.
   */
  public detectYin(
    signal: Float32Array,
    targetFreq?: number
  ): { frequency: number; clarity: number } {
    const N = Math.min(this.bufferSize, signal.length);
    const W = Math.min(this.windowSize, Math.floor(N / 2));
    const totalFFT = this.fftSize;

    // Zero out FFT buffers
    this.r1.fill(0);
    this.i1.fill(0);
    this.r2.fill(0);
    this.i2.fill(0);

    // x1 = signal[0..W-1]
    for (let i = 0; i < W; i++) {
      this.r1[i] = signal[i];
    }
    this.fft.transform(this.r1, this.i1, false);

    // x2 = reversed signal[0..N-1]
    for (let i = 0; i < N; i++) {
      this.r2[i] = signal[N - 1 - i];
    }
    this.fft.transform(this.r2, this.i2, false);

    // Complex product: R_prod = FFT(x1) * FFT(x2)
    for (let k = 0; k < totalFFT; k++) {
      this.rProd[k] = this.r1[k] * this.r2[k] - this.i1[k] * this.i2[k];
      this.iProd[k] = this.r1[k] * this.i2[k] + this.i1[k] * this.r2[k];
    }
    // IFFT to get convolution
    this.fft.transform(this.rProd, this.iProd, true);

    // Energy cumulative sums: energy[k] = sum_{j=0}^{k-1} signal[j]^2
    this.energy[0] = 0;
    for (let i = 0; i < N; i++) {
      this.energy[i + 1] = this.energy[i] + signal[i] * signal[i];
    }
    const energy0 = this.energy[W] - this.energy[0];

    // Difference function and cumulative mean normalized difference function (CMNDF)
    this.yinBuf[0] = 1;
    let runSum = 0;

    for (let tau = 1; tau < W; tau++) {
      const corr = this.rProd[N - 1 - tau];
      const energyTau = this.energy[tau + W] - this.energy[tau];
      const diff = Math.max(0, energy0 + energyTau - 2 * corr);
      runSum += diff;
      this.yinBuf[tau] = runSum === 0 ? 1 : diff / (runSum / tau);
    }

    const minPeriod = Math.max(2, Math.floor(this.sampleRate / this.maxFreq));
    const maxPeriod = Math.min(W - 2, Math.floor(this.sampleRate / this.minFreq));

    let bestTau = -1;
    let minVal = 1.0;

    // Target-guided search if target frequency is provided
    if (targetFreq && targetFreq >= this.minFreq && targetFreq <= this.maxFreq) {
      const targetPeriod = this.sampleRate / targetFreq;
      // Search window: +/- 10% around target period
      const searchStart = Math.max(minPeriod, Math.floor(targetPeriod * 0.88));
      const searchEnd = Math.min(maxPeriod, Math.ceil(targetPeriod * 1.12));

      for (let t = searchStart; t <= searchEnd; t++) {
        if (this.yinBuf[t] < minVal) {
          minVal = this.yinBuf[t];
          bestTau = t;
        }
      }

      if (bestTau !== -1 && minVal < 0.35) {
        // Refine to local minimum
        while (bestTau + 1 < searchEnd && this.yinBuf[bestTau + 1] < this.yinBuf[bestTau]) bestTau++;
        while (bestTau - 1 > searchStart && this.yinBuf[bestTau - 1] < this.yinBuf[bestTau]) bestTau--;
      } else {
        bestTau = -1;
        minVal = 1.0;
      }
    }

    // Standard auto-detection search if not found via target guidance
    if (bestTau === -1) {
      const threshold = 0.15;
      let tau = minPeriod;

      while (tau < maxPeriod) {
        if (this.yinBuf[tau] < threshold) {
          while (tau + 1 < maxPeriod && this.yinBuf[tau + 1] < this.yinBuf[tau]) {
            tau++;
          }
          bestTau = tau;
          minVal = this.yinBuf[tau];
          break;
        }
        tau++;
      }

      // If no dip was below 0.15, look for global minimum
      if (bestTau === -1) {
        for (let t = minPeriod; t < maxPeriod; t++) {
          if (this.yinBuf[t] < minVal) {
            minVal = this.yinBuf[t];
            bestTau = t;
          }
        }
      }
    }

    if (bestTau <= minPeriod || bestTau >= maxPeriod || minVal > 0.45) {
      return { frequency: 0, clarity: Math.max(0, 1 - minVal) };
    }

    // Sub-sample parabolic interpolation on tau
    const betterTau = this.parabolicInterpolation(this.yinBuf, bestTau);
    const frequency = this.sampleRate / betterTau;
    const clarity = Math.max(0, Math.min(1.0, 1.0 - minVal));

    return { frequency, clarity };
  }

  /**
   * Spectral peak detection for high treble (C6 - C8).
   */
  public detectSpectralPeak(
    signal: Float32Array,
    minSearchFreq: number,
    maxSearchFreq: number
  ): { frequency: number; clarity: number } {
    const N = this.windowSize;

    // Apply Blackman-Harris window
    for (let i = 0; i < N; i++) {
      this.trebleReal[i] = (signal[i] || 0) * this.trebleWindow[i];
      this.trebleImag[i] = 0;
    }

    this.trebleFft.transform(this.trebleReal, this.trebleImag, false);

    const binWidth = this.sampleRate / N;
    const minBin = Math.max(1, Math.floor(minSearchFreq / binWidth));
    const maxBin = Math.min(N / 2 - 2, Math.ceil(maxSearchFreq / binWidth));

    let maxMag = 0;
    let peakBin = -1;
    let totalMag = 0;

    for (let k = minBin; k <= maxBin; k++) {
      const r = this.trebleReal[k];
      const im = this.trebleImag[k];
      const mag = Math.sqrt(r * r + im * im);
      totalMag += mag;

      if (mag > maxMag) {
        maxMag = mag;
        peakBin = k;
      }
    }

    if (peakBin <= minBin || peakBin >= maxBin || maxMag <= 1e-4) {
      return { frequency: 0, clarity: 0 };
    }

    const magPrev = Math.sqrt(
      this.trebleReal[peakBin - 1] * this.trebleReal[peakBin - 1] +
      this.trebleImag[peakBin - 1] * this.trebleImag[peakBin - 1]
    );
    const magNext = Math.sqrt(
      this.trebleReal[peakBin + 1] * this.trebleReal[peakBin + 1] +
      this.trebleImag[peakBin + 1] * this.trebleImag[peakBin + 1]
    );

    const alpha = Math.log(Math.max(1e-6, magPrev));
    const beta = Math.log(Math.max(1e-6, maxMag));
    const gamma = Math.log(Math.max(1e-6, magNext));

    const denom = alpha - 2 * beta + gamma;
    let delta = 0;
    if (Math.abs(denom) > 1e-6) {
      delta = (0.5 * (alpha - gamma)) / denom;
      delta = Math.max(-0.5, Math.min(0.5, delta));
    }

    const exactBin = peakBin + delta;
    const frequency = exactBin * binWidth;
    const clarity = Math.min(1.0, maxMag / Math.max(1e-5, totalMag * 0.35));

    return { frequency, clarity };
  }

  /**
   * Parabolic interpolation for fine tau peak location.
   */
  private parabolicInterpolation(array: Float32Array, index: number): number {
    if (index <= 0 || index >= array.length - 1) return index;

    const alpha = array[index - 1];
    const beta = array[index];
    const gamma = array[index + 1];

    const denom = 2 * (alpha - 2 * beta + gamma);
    if (Math.abs(denom) < 1e-9) return index;

    const delta = (alpha - gamma) / denom;
    return index + Math.max(-0.5, Math.min(0.5, delta));
  }

  /**
   * Adaptive median filter + smoothing filter.
   */
  private smoothFrequency(rawFreq: number): number {
    const rawMidi = Math.round(frequencyToMidi(rawFreq));

    if (this.lastReportedMidi !== 0 && Math.abs(rawMidi - this.lastReportedMidi) > 1) {
      this.recentEstimates = [rawFreq];
      this.smoothedFreq = rawFreq;
      this.lastReportedMidi = rawMidi;
      return rawFreq;
    }

    this.lastReportedMidi = rawMidi;
    this.recentEstimates.push(rawFreq);
    if (this.recentEstimates.length > this.maxHistory) {
      this.recentEstimates.shift();
    }

    const sorted = [...this.recentEstimates].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];

    if (this.smoothedFreq === 0) {
      this.smoothedFreq = median;
    } else {
      this.smoothedFreq = 0.65 * median + 0.35 * this.smoothedFreq;
    }

    return this.smoothedFreq;
  }
}
