/**
 * Application Entry Point.
 * Integrates:
 * - AudioEngine (Web Audio mic detection & ref tone)
 * - TuningStore (88-key checklist & measured cents tracking)
 * - PianoRoll (88-key interactive keyboard canvas)
 * - StaffVisualizer (Musical Grand Staff with priority warning markers)
 * - TunerDialRenderer (Cents needle visualizer)
 * - One Curve EQ plugin aesthetic
 */

import { AudioEngine, TunerState } from './audio/audioEngine';
import { TuningStore } from './utils/tuningStore';
import { PianoRoll } from './ui/pianoRoll';
import { StaffVisualizer } from './ui/staffVisualizer';
import { TunerDialRenderer } from './ui/tunerDial';
import { getAllPianoNotes, getPianoNoteByMidi } from './utils/pianoNotes';
import { TuningMode } from './utils/stretchTuning';

// DOM Elements
const btnListen = document.getElementById('btnListen') as HTMLButtonElement;
const listenIcon = document.getElementById('listenIcon') as HTMLSpanElement;
const listenText = document.getElementById('listenText') as HTMLSpanElement;

const btnTone = document.getElementById('btnTone') as HTMLButtonElement;
const toneIcon = document.getElementById('toneIcon') as HTMLSpanElement;
const toneText = document.getElementById('toneText') as HTMLSpanElement;

const btnMarkTuned = document.getElementById('btnMarkTuned') as HTMLButtonElement;
const markTunedText = document.getElementById('markTunedText') as HTMLElement;
const btnClearTuned = document.getElementById('btnClearTuned') as HTMLButtonElement;
const tunedCountText = document.getElementById('tunedCountText') as HTMLElement;
const progressFill = document.getElementById('progressFill') as HTMLElement;
const hoverKeyInfo = document.getElementById('hoverKeyInfo') as HTMLElement;
const worstNotesList = document.getElementById('worstNotesList') as HTMLElement;

const micStatusBanner = document.getElementById('micStatusBanner') as HTMLDivElement;
const bannerText = document.getElementById('bannerText') as HTMLSpanElement;

const noteNameEl = document.getElementById('noteName') as HTMLDivElement;
const noteOctaveEl = document.getElementById('noteOctave') as HTMLDivElement;
const noteAltEl = document.getElementById('noteAlt') as HTMLDivElement;

const guidanceBadge = document.getElementById('guidanceBadge') as HTMLDivElement;
const targetFreqVal = document.getElementById('targetFreqVal') as HTMLSpanElement;
const detectedFreqVal = document.getElementById('detectedFreqVal') as HTMLSpanElement;
const centsValueEl = document.getElementById('centsValue') as HTMLSpanElement;

const modeAutoBtn = document.getElementById('modeAuto') as HTMLButtonElement;
const modeTargetBtn = document.getElementById('modeTarget') as HTMLButtonElement;
const btnPrevNote = document.getElementById('btnPrevNote') as HTMLButtonElement;
const btnNextNote = document.getElementById('btnNextNote') as HTMLButtonElement;
const selectTargetNote = document.getElementById('selectTargetNote') as HTMLSelectElement;

const selectTuningMode = document.getElementById('selectTuningMode') as HTMLSelectElement;
const stretchExplanation = document.getElementById('stretchExplanation') as HTMLElement;
const stretchFactorRow = document.getElementById('stretchFactorRow') as HTMLElement;
const rangeStretchFactor = document.getElementById('rangeStretchFactor') as HTMLInputElement;
const valStretchFactor = document.getElementById('valStretchFactor') as HTMLSpanElement;

const rangeA4 = document.getElementById('rangeA4') as HTMLInputElement;
const valA4 = document.getElementById('valA4') as HTMLSpanElement;

const rangeTolerance = document.getElementById('rangeTolerance') as HTMLInputElement;
const valTolerance = document.getElementById('valTolerance') as HTMLSpanElement;

// Canvases
const pianoRollCanvas = document.getElementById('pianoRollCanvas') as HTMLCanvasElement;
const staffCanvas = document.getElementById('staffCanvas') as HTMLCanvasElement;
const tunerDialCanvas = document.getElementById('tunerDialCanvas') as HTMLCanvasElement;

// Instantiate Stores and Engines
const store = new TuningStore('upright_piano_tuner_session');
const engine = new AudioEngine();
const pianoRoll = new PianoRoll(pianoRollCanvas, store);
const staffVisualizer = new StaffVisualizer(staffCanvas, store);
const dialRenderer = new TunerDialRenderer(tunerDialCanvas);

// Synchronize Target selection across Canvas and Stepper
function handleTargetSelect(midi: number) {
  engine.setTargetMidi(midi);
  pianoRoll.setTargetMidi(midi);
  staffVisualizer.setTargetMidi(midi);
  selectTargetNote.value = midi.toString();
  updateMarkTunedButton();
}

pianoRoll.setOnKeySelect(handleTargetSelect);
staffVisualizer.setOnNoteSelect(handleTargetSelect);

pianoRoll.setOnKeyHover((midi) => {
  if (midi === null) {
    hoverKeyInfo.textContent = 'Hover or click keys to inspect';
    return;
  }
  const note = getPianoNoteByMidi(midi, engine.getState().a4Ref);
  const state = store.getKeyState(midi);
  let statusText = 'Untuned';
  if (state?.isTuned) {
    statusText = '✓ Tuned';
  } else if (state && state.lastMeasuredCents !== null) {
    statusText = `${state.lastMeasuredCents > 0 ? '+' : ''}${state.lastMeasuredCents}¢`;
  }
  const alt = note.altName ? ` (${note.altName})` : '';
  hoverKeyInfo.textContent = `Key ${note.keyNumber}: ${note.fullName}${alt} • ${note.frequency.toFixed(1)} Hz • [${statusText}]`;
});

// Populate 88-Key dropdown options
function populatePianoNotesDropdown(a4: number) {
  const currentVal = selectTargetNote.value;
  selectTargetNote.innerHTML = '';
  const notes = getAllPianoNotes(a4);

  for (const n of notes) {
    const opt = document.createElement('option');
    opt.value = n.midi.toString();
    const alt = n.altName ? ` / ${n.altName}` : '';
    opt.textContent = `${n.fullName}${alt} (Key ${n.keyNumber}) — ${n.frequency.toFixed(1)} Hz`;
    selectTargetNote.appendChild(opt);
  }

  if (currentVal) {
    selectTargetNote.value = currentVal;
  } else {
    selectTargetNote.value = '69'; // A4
  }
}
populatePianoNotesDropdown(440);

// Update progress bar and worst notes priority list
function updateChecklistUi() {
  const tunedCount = store.getTunedCount();
  const total = store.getTotalKeys();
  const pct = Math.round((tunedCount / total) * 100);

  tunedCountText.textContent = `${tunedCount} / ${total} keys (${pct}%)`;
  progressFill.style.width = `${pct}%`;

  updateWorstNotesList();
  updateMarkTunedButton();
}

function updateMarkTunedButton() {
  const currentMidi = engine.getState().targetMidi;
  const isTuned = store.isKeyTuned(currentMidi);
  const label = isTuned ? 'Tuned (OK)' : 'Mark Tuned';
  // The tuner publishes state on every animation frame. Rewriting innerHTML
  // each time destroys the node under the pointer, so the click never completes.
  if (markTunedText.textContent !== label) {
    markTunedText.textContent = label;
  }
  btnMarkTuned.classList.toggle('is-active', isTuned);
}

function updateWorstNotesList() {
  const worst = store.getWorstNotes(6, /* onlyUntuned */ true);
  worstNotesList.innerHTML = '';

  if (worst.length === 0) {
    const emptyMsg = document.createElement('div');
    emptyMsg.className = 'meta';
    emptyMsg.style.padding = '0.75rem';
    emptyMsg.style.textAlign = 'center';
    emptyMsg.textContent = store.getTunedCount() === 88
      ? '🎉 All 88 keys tuned!'
      : 'Play keys across piano to measure and prioritize.';
    worstNotesList.appendChild(emptyMsg);
    return;
  }

  const currentTargetMidi = engine.getState().targetMidi;

  worst.forEach((item, index) => {
    const card = document.createElement('div');
    card.className = 'worst-card';
    if (item.midi === currentTargetMidi) {
      card.classList.add('active-target');
    }

    const cents = item.lastMeasuredCents ?? 0;
    const isFlat = cents < 0;
    const centsClass = isFlat ? 'flat' : 'sharp';
    const sign = cents > 0 ? '+' : '';

    card.innerHTML = `
      <span class="worst-rank">#${index + 1}</span>
      <span class="worst-note-name">${item.note.fullName}</span>
      <span class="worst-cents ${centsClass}">${sign}${cents.toFixed(1)}¢</span>
      <button class="worst-action-btn" data-midi="${item.midi}">Tune</button>
    `;

    const tuneBtn = card.querySelector('button');
    tuneBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      handleTargetSelect(item.midi);
    });

    card.addEventListener('click', () => {
      handleTargetSelect(item.midi);
    });

    worstNotesList.appendChild(card);
  });
}

store.subscribe(updateChecklistUi);
updateChecklistUi();

// Animation Rendering Loop for Cents Dial
function startMeterLoop() {
  function render() {
    const st = engine.getState();
    const res = st.detectedResult;
    const hasSignal = !!(st.isListening && res && res.isNoteDetected);
    const cents = hasSignal ? res!.cents : 0;

    dialRenderer.render(cents, st.toleranceCents, hasSignal);
    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);
}
startMeterLoop();

// State subscription and UI updates
engine.subscribe((state: TunerState) => {
  // Listen Button
  if (state.isListening) {
    btnListen.classList.add('is-listening');
    listenIcon.textContent = '⏹️';
    listenText.textContent = 'Stop Listening';
    micStatusBanner.style.display = 'none';
  } else {
    btnListen.classList.remove('is-listening');
    listenIcon.textContent = '🎙️';
    listenText.textContent = 'Start Listening';
    micStatusBanner.style.display = 'flex';
  }

  // Ref Tone Button
  if (state.isPlayingTone) {
    btnTone.classList.add('is-active');
    toneIcon.textContent = '⏹️';
    toneText.textContent = 'Stop Tone';
  } else {
    btnTone.classList.remove('is-active');
    toneIcon.textContent = '🔊';
    toneText.textContent = 'Ref Tone';
  }

  // Tuner Mode Buttons
  if (state.tunerMode === 'auto') {
    modeAutoBtn.classList.add('is-selected');
    modeTargetBtn.classList.remove('is-selected');
  } else {
    modeAutoBtn.classList.remove('is-selected');
    modeTargetBtn.classList.add('is-selected');
  }

  // Sync Select Dropdown
  if (selectTargetNote.value !== state.targetMidi.toString()) {
    selectTargetNote.value = state.targetMidi.toString();
  }

  targetFreqVal.textContent = state.activeTargetFreq.toFixed(2);

  // Sync Canvases Target
  pianoRoll.setTargetMidi(state.targetMidi);
  staffVisualizer.setTargetMidi(state.targetMidi);

  // Active Detection & Real-time measurement recording
  const res = state.detectedResult;
  const isDetected = !!(state.isListening && res && res.isNoteDetected);

  if (isDetected && res) {
    // Record measurement in TuningStore
    store.recordMeasurement(res.midi, res.cents, res.frequency);

    // Active sounding keys on PianoRoll and Staff
    pianoRoll.setActiveMidi(res.midi);
    staffVisualizer.setActiveMidi(res.midi);

    detectedFreqVal.textContent = res.frequency.toFixed(2);
    const signPrefix = res.cents > 0 ? '+' : '';
    centsValueEl.textContent = `${signPrefix}${res.cents.toFixed(1)}`;

    const absCents = Math.abs(res.cents);
    const isInTune = absCents <= state.toleranceCents;

    centsValueEl.className = 'cents-display';
    guidanceBadge.className = 'guidance-tag';

    if (isInTune) {
      centsValueEl.classList.add('in-tune');
      guidanceBadge.classList.add('in-tune');
      guidanceBadge.textContent = '✓ IN TUNE';
    } else if (res.cents < -state.toleranceCents) {
      centsValueEl.classList.add('negative');
      guidanceBadge.classList.add('tighten');
      guidanceBadge.textContent = '▲ TIGHTEN (FLAT)';
    } else {
      centsValueEl.classList.add('positive');
      guidanceBadge.classList.add('loosen');
      guidanceBadge.textContent = '▼ LOOSEN (SHARP)';
    }
  } else {
    pianoRoll.setActiveMidi(null);
    staffVisualizer.setActiveMidi(null);

    detectedFreqVal.textContent = '--';
    centsValueEl.textContent = '0.0';
    centsValueEl.className = 'cents-display';
    guidanceBadge.className = 'guidance-tag';
    guidanceBadge.textContent = state.isListening ? 'Play note...' : 'Waiting for note...';
  }

  const activeNote = getPianoNoteByMidi(state.targetMidi, state.a4Ref);
  noteNameEl.textContent = activeNote.name;
  noteOctaveEl.textContent = activeNote.octave.toString();
  noteAltEl.textContent = activeNote.altName ? `(${activeNote.altName})` : '';

  updateMarkTunedButton();
});

// Event Listeners

btnListen.addEventListener('click', async () => {
  const currentState = engine.getState();
  if (currentState.isListening) {
    engine.stopListening();
  } else {
    try {
      bannerText.textContent = 'Requesting microphone permission...';
      await engine.startListening();
    } catch (err: unknown) {
      console.error(err);
      micStatusBanner.className = 'status-banner error';
      micStatusBanner.style.display = 'flex';
      const errMsg = err instanceof Error ? err.message : String(err);
      bannerText.innerHTML = `⚠️ <strong>Microphone Error:</strong> ${errMsg}. Modern browsers require HTTPS or localhost.`;
    }
  }
});

btnTone.addEventListener('click', () => {
  if (engine.getState().isPlayingTone) {
    engine.stopTone();
  } else {
    engine.playTone();
  }
});

// Mark Tuned button
btnMarkTuned.addEventListener('click', () => {
  const currentMidi = engine.getState().targetMidi;
  store.toggleTuned(currentMidi);
});

// Clear all checklist
btnClearTuned.addEventListener('click', () => {
  if (confirm('Reset all 88 key checkboxes and measurements?')) {
    store.clearAll();
  }
});

// Mode buttons
modeAutoBtn.addEventListener('click', () => {
  engine.setTunerMode('auto');
});

modeTargetBtn.addEventListener('click', () => {
  engine.setTunerMode('target');
});

btnPrevNote.addEventListener('click', () => {
  engine.prevTargetNote();
});

btnNextNote.addEventListener('click', () => {
  engine.nextTargetNote();
});

selectTargetNote.addEventListener('change', () => {
  const midi = parseInt(selectTargetNote.value, 10);
  if (!isNaN(midi)) {
    handleTargetSelect(midi);
  }
});

// Tuning mode selector (Pure vs Stretch)
selectTuningMode.addEventListener('change', () => {
  const mode = selectTuningMode.value as TuningMode;
  engine.setTuningMode(mode);

  if (mode === 'stretch') {
    stretchFactorRow.style.display = 'flex';
    stretchExplanation.innerHTML =
      '<strong>Stretch Tuning (Railsback):</strong> Inharmonicity compensation. Bass is tuned flatter and treble sharper to match string stiff partials.';
  } else {
    stretchFactorRow.style.display = 'none';
    stretchExplanation.innerHTML =
      '<strong>Pure Equal:</strong> Mathematically exact 12-TET frequencies (A4=440).';
  }
});

rangeStretchFactor.addEventListener('input', () => {
  const val = parseFloat(rangeStretchFactor.value);
  valStretchFactor.textContent = `${val.toFixed(1)}x`;
  engine.setStretchFactor(val);
});

rangeA4.addEventListener('input', () => {
  const val = parseFloat(rangeA4.value);
  valA4.textContent = `${val.toFixed(1)} Hz`;
  engine.setA4(val);
  populatePianoNotesDropdown(val);
});

rangeTolerance.addEventListener('input', () => {
  const val = parseFloat(rangeTolerance.value);
  valTolerance.textContent = `±${val.toFixed(1)} cents`;
  engine.setToleranceCents(val);
});

// Keyboard Navigation
window.addEventListener('keydown', (e) => {
  if (
    document.activeElement instanceof HTMLInputElement ||
    document.activeElement instanceof HTMLSelectElement
  ) {
    return;
  }

  if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
    e.preventDefault();
    engine.nextTargetNote();
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
    e.preventDefault();
    engine.prevTargetNote();
  } else if (e.key === ' ' || e.code === 'Space') {
    e.preventDefault();
    if (engine.getState().isPlayingTone) {
      engine.stopTone();
    } else {
      engine.playTone();
    }
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const currentMidi = engine.getState().targetMidi;
    store.toggleTuned(currentMidi);
  }
});

// Responsive resize
function handleResizeAll() {
  pianoRoll.resize();
  staffVisualizer.resize();
  dialRenderer.handleResize();
}

window.addEventListener('resize', handleResizeAll);
window.addEventListener('DOMContentLoaded', handleResizeAll);
setTimeout(handleResizeAll, 100);
