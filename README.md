# 🎹 Piano Tuner — Upright Piano Pitch Tuner

A high-accuracy, static, no-backend Web Audio application designed for tuning upright pianos using a Mac's built-in microphone or external USB interface. It runs completely client-side in modern browsers (Safari, Chrome, Firefox) and is deployable to GitHub Pages.

Designed with a professional audio plugin look and feel inspired by [One Curve EQ](https://github.com/dagjomar/one-curve-eq).

---

## 🌟 Key Features

### 1. Wide 88-Key Piano Roll & Tuning Checklist (Primary UI)
- **Physical Keyboard Simulation:** Interactive 88-key piano keyboard (A0 to C8) with proportional white and black keys matching your physical piano.
- **Real-Time Sounding Key Highlight:** When a string is played or selected, the corresponding key on the keyboard lights up in real time with a luminous golden indicator.
- **Tuning Progress Checklist:**
  - Check off keys as tuned or OK (`✓`) by clicking the **Mark Tuned** button, pressing <kbd>Enter</kbd>, or Shift-clicking any key.
  - Visual checkmark badges on tuned keys and an 88-key progress bar (e.g. `34 / 88 keys tuned (39%)`).
  - Measured deviation dots on untuned keys (green for in-tune, amber for flat, blue for sharp).
  - Quick **Reset Checklist** button to start a fresh tuning pass.

### 2. Musical Grand Staff & Deviation Priority Inspector
- **Grand Staff Position:** Classical 5-line Treble (𝄞) and Bass (𝄢) staves with middle C ledger line plotting all 88 piano notes in pitch space.
- **Priority Warnings on Staff:** Highlights notes that are furthest from pitch with prominent warning rings and priority indicators.
- **Worst Out-of-Tune Notes Priority Deck:**
  - Ranks the most severely out-of-tune notes by absolute cents error (e.g. `#1 F#3 (+18.4¢) [Tune]`, `#2 A0 (-15.2¢) [Tune]`).
  - Helps the piano technician prioritize which strings to balance and pull up first before fine-tuning.
  - Clicking any note in the priority deck immediately focuses the tuner on that key.

### 3. High-Accuracy Pitch Detection Engine (A0 to C8)
- **Exact FFT-Accelerated YIN Algorithm:** Uses cumulative mean normalized difference function (CMNDF) and parabolic interpolation for sub-cent accuracy (within ±1-2 cents on clean tones).
- **Piano Harmonics & Subharmonics Handling:** Piano bass strings feature weak fundamentals and prominent 2nd/3rd harmonics. The detection engine uses subharmonic verification and target-note locking to eliminate octave doubling errors.
- **High Treble Spectral Peak Interpolation:** Blackman-Harris windowed FFT with parabolic log-magnitude peak interpolation for short-period treble notes (C6–C8).
- **Noise Gate & Level Gate:** Rejects room ambient noise and only triggers when a string is actively struck.
- **Adaptive Jitter Smoothing:** Median filtering followed by exponential smoothing to stabilize the needle while preserving responsiveness.

### 4. Standard Equal Temperament & Railsback Stretch Tuning
- **Pure Equal Temperament:** Mathematically exact 12-TET frequencies (A4 = 440.0 Hz).
- **Stretch Tuning (Railsback Upright Curve):** Stiff upright piano wire causes overtones to be sharp relative to theoretical harmonics. The stretch curve flattens bass notes (down to -28 cents) and sharpens treble notes (up to +32 cents) to eliminate audible beating between partials.
- **Adjustable Reference Pitch:** Slider from 435.0 Hz to 445.0 Hz to accommodate older uprights that cannot handle full 440 Hz tension.
- **Adjustable In-Tune Green Tolerance:** Configurable from ±2.0 to ±10.0 cents (default ±5.0 cents).

### 5. Large, Readable Plugin Meter
- High-contrast cents dial (-50 to +50 cents) with tick marks and clear green in-tune target zone.
- Direction hint badges: **TIGHTEN (FLAT)** vs **LOOSEN (SHARP)** vs **IN TUNE**.
- Note name, octave, measured frequency in Hz, and target frequency.

### 6. Reference Tone Generator
- Generates a synthesized reference tone (triangle wave with smooth ramp) for the active target note for ear-checking and beating verification.
- Toggle with the **Ref Tone** button or <kbd>Spacebar</kbd>.

---

## 🛠️ Upright Piano Tuning Technique

Tuning an upright piano requires care and the proper tools:

1. **Mute Unisons with Felt:**
   - Upright notes have 2 or 3 strings per note (unisons).
   - Insert rubber wedges or a felt temper strip to silence side strings, tuning **one string at a time**.
2. **Prioritize Worst Notes:**
   - Check the **Tuning Priorities** deck to address strings with large pitch deviations (>10-15 cents) first, distributing soundboard tension evenly before fine-tuning unisons.
3. **Setting the Pin:**
   - Piano tuning pins are seated in a laminated wooden pinblock.
   - If a string is sharp, slightly loosen it first (quarter turn counter-clockwise), then slowly raise it up to pitch.
   - "Set the pin" with a slight downward settling torque so the pin does not slip under string tension when played firmly.
4. **Older Uprights (Pitch Caution):**
   - If your piano has dropped significantly below concert pitch (e.g., A4 is currently around 435–437 Hz), raising it all at once to 440 Hz puts extreme stress on the plate and can snap older strings.
   - Adjust the **A4 Reference Pitch** slider to match the piano's current average pitch for an initial pass.

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| <kbd>→</kbd> or <kbd>↑</kbd> | Next target note |
| <kbd>←</kbd> or <kbd>↓</kbd> | Previous target note |
| <kbd>Enter</kbd> | Toggle "Mark Tuned" (✓) for current note |
| <kbd>Space</kbd> | Toggle reference tone on / off |
| <kbd>Shift</kbd> + Click | Click any piano key to toggle its tuned status |

---

## 🚀 Running Locally

Requirements: Node.js 18+ and npm.

```bash
# Clone the repository
git clone <repo-url>
cd piano-tuner

# Install dependencies
npm install

# Start development server
npm run dev
```

Open `http://localhost:4173` (or the port Vite outputs) in your browser.

> **Note on Microphone Permissions:** Modern browsers (Safari, Chrome) require **HTTPS** or **localhost** to grant microphone access via `navigator.mediaDevices.getUserMedia`.

---

## 🧪 Running Unit Tests

The test suite runs with [Vitest](https://vitest.dev/) and validates pitch detection accuracy, octave handling, cents math, Railsback stretch curves, tuning store checklist tracking, and synthetic sine waves with piano harmonics.

```bash
npm run test
```

---

## 🚢 GitHub Pages Deployment

A GitHub Actions workflow is provided at `.github/workflows/deploy.yml`.

### Enabling GitHub Pages:
1. Push this repository to GitHub on branch `main`.
2. In your GitHub repository, navigate to **Settings** → **Pages**.
3. Under **Build and deployment** → **Source**, select **GitHub Actions**.
4. Pushing to `main` will automatically build the static assets and deploy the app to `https://<your-username>.github.io/<repo-name>/`.
