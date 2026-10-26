/**
 * Web Audio Engine for Piano Tuner.
 * Manages microphone stream, ScriptProcessor/AudioWorklet node,
 * noise gating, and synthesis tone generator for ear-checking.
 */

import { PitchDetector, DetectionResult } from './pitchDetector';
import { PIANO_MIN_MIDI, PIANO_MAX_MIDI } from '../utils/pianoNotes';
import { getTargetFrequency, TuningMode } from '../utils/stretchTuning';

export type TunerMode = 'auto' | 'target';

export interface TunerState {
  isListening: boolean;
  isPlayingTone: boolean;
  tunerMode: TunerMode;
  targetMidi: number;
  a4Ref: number;
  toleranceCents: number;
  tuningMode: TuningMode;
  stretchFactor: number;
  noiseGateDb: number;
  detectedResult: DetectionResult | null;
  activeTargetFreq: number;
}

export type StateListener = (state: TunerState) => void;

export class AudioEngine {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private scriptNode: ScriptProcessorNode | null = null;
  private detector: PitchDetector | null = null;

  // Reference tone generator
  private toneOscillator: OscillatorNode | null = null;
  private toneGainNode: GainNode | null = null;

  // Audio buffer accumulator
  private readonly bufferSize = 8192;
  private inputAccumulator: Float32Array = new Float32Array(this.bufferSize);

  // Current State
  private state: TunerState = {
    isListening: false,
    isPlayingTone: false,
    tunerMode: 'auto',
    targetMidi: 69, // A4 by default
    a4Ref: 440.0,
    toleranceCents: 5.0,
    tuningMode: 'pure',
    stretchFactor: 1.0,
    noiseGateDb: -48.0,
    detectedResult: null,
    activeTargetFreq: 440.0
  };

  private listeners: Set<StateListener> = new Set();
  private animFrameId: number | null = null;
  private latestResult: DetectionResult | null = null;

  constructor() {
    this.updateActiveTargetFreq();
  }

  public subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    const currentState = this.getState();
    for (const listener of this.listeners) {
      listener(currentState);
    }
  }

  public getState(): TunerState {
    return { ...this.state };
  }

  private updateActiveTargetFreq(): void {
    this.state.activeTargetFreq = getTargetFrequency(
      this.state.targetMidi,
      this.state.a4Ref,
      this.state.tuningMode,
      this.state.stretchFactor
    );
  }

  public setA4(a4: number): void {
    this.state.a4Ref = Math.max(420, Math.min(460, a4));
    this.updateActiveTargetFreq();
    if (this.detector) {
      this.detector.resetSmoothing();
    }
    if (this.state.isPlayingTone) {
      this.updateToneFrequency();
    }
    this.notify();
  }

  public setTunerMode(mode: TunerMode): void {
    this.state.tunerMode = mode;
    if (this.detector) {
      this.detector.resetSmoothing();
    }
    this.notify();
  }

  public setTargetMidi(midi: number): void {
    this.state.targetMidi = Math.max(PIANO_MIN_MIDI, Math.min(PIANO_MAX_MIDI, midi));
    this.updateActiveTargetFreq();
    if (this.detector) {
      this.detector.resetSmoothing();
    }
    if (this.state.isPlayingTone) {
      this.updateToneFrequency();
    }
    this.notify();
  }

  public nextTargetNote(): void {
    this.setTargetMidi(this.state.targetMidi + 1);
  }

  public prevTargetNote(): void {
    this.setTargetMidi(this.state.targetMidi - 1);
  }

  public setToleranceCents(tolerance: number): void {
    this.state.toleranceCents = Math.max(2, Math.min(15, tolerance));
    this.notify();
  }

  public setTuningMode(mode: TuningMode): void {
    this.state.tuningMode = mode;
    this.updateActiveTargetFreq();
    if (this.detector) {
      this.detector.resetSmoothing();
    }
    if (this.state.isPlayingTone) {
      this.updateToneFrequency();
    }
    this.notify();
  }

  public setStretchFactor(factor: number): void {
    this.state.stretchFactor = Math.max(0.0, Math.min(2.5, factor));
    this.updateActiveTargetFreq();
    if (this.state.isPlayingTone) {
      this.updateToneFrequency();
    }
    this.notify();
  }

  public setNoiseGateDb(db: number): void {
    this.state.noiseGateDb = Math.max(-65, Math.min(-20, db));
    if (this.detector) {
      this.detector.noiseGateDb = this.state.noiseGateDb;
    }
    this.notify();
  }

  /**
   * Initializes microphone access and starts Web Audio input processing.
   */
  public async startListening(): Promise<void> {
    if (this.state.isListening) return;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error(
        'getUserMedia is not supported on this browser or origin. Make sure you are using HTTPS or localhost.'
      );
    }

    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioContext = new AudioCtx();
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          autoGainControl: false,
          noiseSuppression: false,
          channelCount: 1
        }
      });

      this.detector = new PitchDetector({
        sampleRate: this.audioContext.sampleRate,
        bufferSize: this.bufferSize,
        noiseGateDb: this.state.noiseGateDb,
        clarityThreshold: 0.70
      });

      this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);

      // Use 2048 frame chunking via ScriptProcessor
      // Accumulates into 8192 buffer for high frequency resolution on low piano notes
      this.scriptNode = this.audioContext.createScriptProcessor(2048, 1, 1);
      this.inputAccumulator.fill(0);

      this.scriptNode.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        const chunkLen = inputData.length;

        // Shift existing samples left and append new chunk
        this.inputAccumulator.copyWithin(0, chunkLen);
        this.inputAccumulator.set(inputData, this.bufferSize - chunkLen);

        if (this.detector) {
          const targetFreq =
            this.state.tunerMode === 'target' ? this.state.activeTargetFreq : undefined;

          const res = this.detector.detect(this.inputAccumulator, targetFreq);
          this.latestResult = res;
        }
      };

      this.sourceNode.connect(this.scriptNode);
      this.scriptNode.connect(this.audioContext.destination);

      this.state.isListening = true;
      this.startUiUpdateLoop();
      this.notify();
    } catch (err) {
      this.stopListening();
      throw err;
    }
  }

  public stopListening(): void {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }

    if (this.scriptNode) {
      this.scriptNode.disconnect();
      this.scriptNode.onaudioprocess = null;
      this.scriptNode = null;
    }

    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
      this.audioContext = null;
    }

    this.state.isListening = false;
    this.state.detectedResult = null;
    this.latestResult = null;
    this.notify();
  }

  private startUiUpdateLoop(): void {
    const loop = () => {
      if (!this.state.isListening) return;

      if (this.latestResult) {
        this.state.detectedResult = this.latestResult;

        // In auto-detect mode, update activeTargetFreq and targetMidi to detected note
        if (this.state.tunerMode === 'auto' && this.latestResult.isNoteDetected) {
          this.state.targetMidi = this.latestResult.midi;
          this.updateActiveTargetFreq();
        }

        this.notify();
      }

      this.animFrameId = requestAnimationFrame(loop);
    };

    this.animFrameId = requestAnimationFrame(loop);
  }

  /**
   * Reference tone generator (play target note for ear-checking).
   */
  public async playTone(): Promise<void> {
    if (this.state.isPlayingTone) {
      this.stopTone();
      return;
    }

    try {
      if (!this.audioContext || this.audioContext.state === 'closed') {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.audioContext = new AudioCtx();
      }

      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      this.toneGainNode = this.audioContext.createGain();
      this.toneGainNode.gain.setValueAtTime(0.001, this.audioContext.currentTime);
      this.toneGainNode.gain.exponentialRampToValueAtTime(0.20, this.audioContext.currentTime + 0.05);
      this.toneGainNode.connect(this.audioContext.destination);

      this.toneOscillator = this.audioContext.createOscillator();
      this.toneOscillator.type = 'triangle'; // Richer, warm piano-like tone
      this.toneOscillator.frequency.setValueAtTime(
        this.state.activeTargetFreq,
        this.audioContext.currentTime
      );

      this.toneOscillator.connect(this.toneGainNode);
      this.toneOscillator.start();

      this.state.isPlayingTone = true;
      this.notify();
    } catch (err) {
      console.error('Failed to start reference tone:', err);
    }
  }

  public stopTone(): void {
    if (!this.state.isPlayingTone || !this.toneOscillator || !this.toneGainNode || !this.audioContext) {
      this.state.isPlayingTone = false;
      this.notify();
      return;
    }

    try {
      const now = this.audioContext.currentTime;
      this.toneGainNode.gain.setValueAtTime(this.toneGainNode.gain.value, now);
      this.toneGainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);

      setTimeout(() => {
        if (this.toneOscillator) {
          this.toneOscillator.stop();
          this.toneOscillator.disconnect();
          this.toneOscillator = null;
        }
        if (this.toneGainNode) {
          this.toneGainNode.disconnect();
          this.toneGainNode = null;
        }
        this.state.isPlayingTone = false;
        this.notify();
      }, 60);
    } catch {
      this.state.isPlayingTone = false;
      this.notify();
    }
  }

  private updateToneFrequency(): void {
    if (this.toneOscillator && this.audioContext && this.state.isPlayingTone) {
      this.toneOscillator.frequency.setTargetAtTime(
        this.state.activeTargetFreq,
        this.audioContext.currentTime,
        0.02
      );
    }
  }
}
