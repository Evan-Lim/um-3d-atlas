import fs from 'node:fs';
import path from 'node:path';

/**
 * Procedural 48kHz 16-bit stereo soundtrack synthesizer for UM 3D Atlas 9:16 Reel.
 * Style: Upbeat Google product reveal — bright warm marimba/tech plucks, clean
 * electronic beat (124 BPM), warm sub-bass, airy major-9th pads, and subtle
 * beat-locked transition chimes. Zero external assets or copyright issues.
 */

const SAMPLE_RATE = 48000;
const DURATION_S = 24.0;
const BPM = 124;
const BEAT_S = 60 / BPM; // ~0.483871s
const STEP_S = BEAT_S / 4; // 16th note (~0.120968s)
const TOTAL_SAMPLES = Math.floor(SAMPLE_RATE * DURATION_S);

// Exact scene cut timestamps (seconds) — chimes/risers lock to these cuts
export const SCENE_CUTS = [0.0, 2.8, 5.8, 9.0, 12.2, 15.6, 18.8, 21.4];

function midiToHz(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// Deterministic pseudo-random for crisp hi-hat/clap noise textures
let rngState = 0x51a7b3c9;
function rand() {
  rngState = (rngState * 1664525 + 1013904223) >>> 0;
  return (rngState / 0xffffffff) * 2 - 1;
}

// Write a stereo WAV buffer from Float32 left/right arrays
function writeWav(filePath, left, right) {
  const numSamples = left.length;
  const blockAlign = 4; // 2 channels * 2 bytes
  const byteRate = SAMPLE_RATE * blockAlign;
  const dataSize = numSamples * blockAlign;
  const buf = Buffer.alloc(44 + dataSize);

  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); // PCM
  buf.writeUInt16LE(1, 20); // Linear PCM
  buf.writeUInt16LE(2, 22); // Stereo
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    // Gentle analog-style soft clip limiter
    const l = Math.tanh(left[i] * 0.92);
    const r = Math.tanh(right[i] * 0.92);
    buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(l * 32000))), offset);
    buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(r * 32000))), offset + 2);
    offset += 4;
  }

  fs.writeFileSync(filePath, buf);
}

export function generateSoundtrack(outputWavPath) {
  const left = new Float32Array(TOTAL_SAMPLES);
  const right = new Float32Array(TOTAL_SAMPLES);

  function addSample(idx, valL, valR) {
    if (idx >= 0 && idx < TOTAL_SAMPLES) {
      left[idx] += valL;
      right[idx] += valR;
    }
  }

  // Warm Google-keynote tech pluck (marimba + crystal harmonic transient)
  function addPluck(startS, midi, amp, pan = 0, decayS = 0.28) {
    const freq = midiToHz(midi);
    const startIdx = Math.floor(startS * SAMPLE_RATE);
    const len = Math.floor((decayS * 3.4) * SAMPLE_RATE);
    const panL = Math.cos(((pan + 1) * Math.PI) / 4);
    const panR = Math.sin(((pan + 1) * Math.PI) / 4);

    for (let i = 0; i < len; i++) {
      const idx = startIdx + i;
      if (idx >= TOTAL_SAMPLES) break;
      const t = i / SAMPLE_RATE;
      const attack = Math.min(1, t / 0.0035);
      const env = attack * Math.exp(-t / decayS);
      const brightEnv = attack * Math.exp(-t / (decayS * 0.34));
      const clickEnv = Math.exp(-t / 0.007);

      const s =
        Math.sin(2 * Math.PI * freq * t) * 0.72 +
        Math.sin(2 * Math.PI * freq * 2 * t) * 0.24 * brightEnv +
        Math.sin(2 * Math.PI * freq * 3 * t) * 0.1 * brightEnv +
        Math.sin(2 * Math.PI * freq * 4 * t) * 0.07 * clickEnv;

      const sample = s * env * amp;
      addSample(idx, sample * panL, sample * panR);
    }
  }

  // Warm rounded bass note
  function addBass(startS, midi, durS, amp) {
    const freq = midiToHz(midi);
    const startIdx = Math.floor(startS * SAMPLE_RATE);
    const len = Math.floor((durS + 0.08) * SAMPLE_RATE);

    for (let i = 0; i < len; i++) {
      const idx = startIdx + i;
      if (idx >= TOTAL_SAMPLES) break;
      const t = i / SAMPLE_RATE;
      const attack = Math.min(1, t / 0.008);
      const release = t > durS ? Math.exp(-(t - durS) / 0.025) : 1;
      const env = attack * release * Math.exp(-t / (durS * 1.6 + 0.2));
      const s =
        Math.sin(2 * Math.PI * freq * t) * 0.8 +
        Math.sin(2 * Math.PI * freq * 2 * t) * 0.2 * Math.exp(-t / 0.14);
      const val = s * env * amp;
      addSample(idx, val * 0.72, val * 0.72);
    }
  }

  // Airy soft chord pad bloom
  function addPad(startS, midiNotes, durS, amp) {
    const startIdx = Math.floor(startS * SAMPLE_RATE);
    const len = Math.floor((durS + 0.5) * SAMPLE_RATE);
    const freqs = midiNotes.map(midiToHz);

    for (let i = 0; i < len; i++) {
      const idx = startIdx + i;
      if (idx >= TOTAL_SAMPLES) break;
      const t = i / SAMPLE_RATE;
      const attack = Math.min(1, t / 0.32);
      const rel = t > durS ? Math.exp(-(t - durS) / 0.24) : 1;
      const env = attack * rel * amp;
      let sumL = 0;
      let sumR = 0;
      for (let n = 0; n < freqs.length; n++) {
        const f = freqs[n];
        const detune = (n % 2 === 0 ? 1 : -1) * 0.0022;
        sumL += Math.sin(2 * Math.PI * f * (1 + detune) * t);
        sumR += Math.sin(2 * Math.PI * f * (1 - detune) * t);
      }
      const norm = 1 / Math.sqrt(freqs.length);
      addSample(idx, sumL * norm * env, sumR * norm * env);
    }
  }

  // Tight modern electronic kick
  function addKick(startS, amp = 0.56) {
    const startIdx = Math.floor(startS * SAMPLE_RATE);
    const len = Math.floor(0.24 * SAMPLE_RATE);
    let phase = 0;
    for (let i = 0; i < len; i++) {
      const idx = startIdx + i;
      if (idx >= TOTAL_SAMPLES) break;
      const t = i / SAMPLE_RATE;
      const freq = 46 + 118 * Math.exp(-t / 0.028);
      phase += (2 * Math.PI * freq) / SAMPLE_RATE;
      const env = Math.min(1, t / 0.002) * Math.exp(-t / 0.088);
      const click = Math.sin(2 * Math.PI * 1600 * t) * Math.exp(-t / 0.004) * 0.14;
      const val = (Math.sin(phase) * env + click) * amp;
      addSample(idx, val * 0.72, val * 0.72);
    }
  }

  // Crisp light tech hi-hat / shaker
  function addHat(startS, amp = 0.1, open = false, pan = 0.15) {
    const startIdx = Math.floor(startS * SAMPLE_RATE);
    const decay = open ? 0.11 : 0.032;
    const len = Math.floor(decay * 4 * SAMPLE_RATE);
    const panL = Math.cos(((pan + 1) * Math.PI) / 4);
    const panR = Math.sin(((pan + 1) * Math.PI) / 4);
    let prev = 0;
    for (let i = 0; i < len; i++) {
      const idx = startIdx + i;
      if (idx >= TOTAL_SAMPLES) break;
      const t = i / SAMPLE_RATE;
      const n = rand();
      // Simple high-pass difference filter for silky metallic crispness
      const hp = n - prev * 0.84;
      prev = n;
      const env = Math.min(1, t / 0.0015) * Math.exp(-t / decay);
      const val = hp * env * amp;
      addSample(idx, val * panL, val * panR);
    }
  }

  // Snappy soft finger-snap / tech clap
  function addClap(startS, amp = 0.22) {
    const taps = [0, 0.009, 0.017];
    for (const offsetS of taps) {
      const startIdx = Math.floor((startS + offsetS) * SAMPLE_RATE);
      const len = Math.floor(0.11 * SAMPLE_RATE);
      let lp = 0;
      let prev = 0;
      for (let i = 0; i < len; i++) {
        const idx = startIdx + i;
        if (idx >= TOTAL_SAMPLES) break;
        const t = i / SAMPLE_RATE;
        const n = rand();
        // Bandpass-ish crisp handclap texture
        lp = lp * 0.65 + n * 0.35;
        const bp = lp - prev * 0.7;
        prev = lp;
        const env = Math.exp(-t / 0.034);
        const val = bp * env * amp * (offsetS === 0.017 ? 1.15 : 0.65);
        addSample(idx, val * 0.76, val * 0.68);
      }
    }
  }

  // Subtle crystalline UI chime + airy sweep on scene transitions
  function addTransitionChime(cutS, chordRootMidi, amp = 0.14) {
    if (cutS <= 0.1 || cutS >= DURATION_S - 0.4) return;
    // Soft upward sparkle triad
    addPluck(cutS, chordRootMidi + 24, amp * 0.72, -0.35, 0.36);
    addPluck(cutS + 0.045, chordRootMidi + 31, amp * 0.6, 0.35, 0.42);
    // Gentle filtered air whoosh leading into the cut
    const whooshDur = 0.18;
    const startIdx = Math.floor((cutS - whooshDur) * SAMPLE_RATE);
    const len = Math.floor((whooshDur + 0.08) * SAMPLE_RATE);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const idx = startIdx + i;
      if (idx < 0 || idx >= TOTAL_SAMPLES) continue;
      const t = i / SAMPLE_RATE;
      const norm = t / (whooshDur + 0.08);
      const env = Math.sin(norm * Math.PI) * 0.055;
      const n = rand();
      lp = lp * 0.88 + n * 0.12;
      addSample(idx, lp * env, lp * env);
    }
  }

  // Uplifting Google-style 4-chord progression (Fmaj9 -> Csus2/E -> Dm9 -> Bbmaj9)
  const PROGRESSION = [
    { root: 41, bass: 41, chord: [65, 69, 72, 76, 79], arp: [65, 72, 76, 79, 76, 72, 74, 72] }, // Fmaj9
    { root: 40, bass: 40, chord: [64, 67, 72, 74, 79], arp: [64, 67, 72, 74, 79, 74, 72, 67] }, // Csus2/E
    { root: 38, bass: 38, chord: [62, 65, 69, 72, 76], arp: [62, 69, 72, 76, 72, 69, 72, 74] }, // Dm9
    { root: 34, bass: 46, chord: [58, 62, 65, 69, 72], arp: [62, 65, 69, 72, 77, 72, 69, 65] }, // Bbmaj9
  ];

  // Syncopated 16th-step pluck pattern (16 steps per bar)
  const PLUCK_STEPS = [0, 2, 3, 6, 8, 10, 11, 14];
  const BASS_PATTERN = [
    { step: 0, dur: 2.8 },
    { step: 6, dur: 1.8 },
    { step: 10, dur: 2.5 },
    { step: 14, dur: 1.6 },
  ];

  const totalBars = Math.ceil(DURATION_S / (BEAT_S * 4));
  for (let bar = 0; bar < totalBars; bar++) {
    const barStart = bar * BEAT_S * 4;
    if (barStart >= DURATION_S - 0.5) break;

    const prog = PROGRESSION[bar % PROGRESSION.length];
    const isIntro = bar === 0;
    const isClimax = bar >= 4 && bar <= 10;
    const isOutro = barStart >= 21.0;

    // Warm airy pad per bar
    if (!isOutro) {
      addPad(barStart, prog.chord.slice(0, 4), BEAT_S * 3.9, isClimax ? 0.08 : 0.055);
    } else {
      // Final resolved Fmaj9 warm swell on the end card
      addPad(barStart, [65, 69, 72, 76, 81], Math.max(0.5, DURATION_S - barStart - 0.4), 0.095);
    }

    // Bright tech plucks with ping-pong stereo spacing
    for (let p = 0; p < PLUCK_STEPS.length; p++) {
      const step = PLUCK_STEPS[p];
      const t = barStart + step * STEP_S;
      if (t >= 22.1) break;
      const note = prog.arp[p % prog.arp.length] + (isClimax && p % 3 === 0 ? 12 : 0);
      const pan = p % 2 === 0 ? -0.32 : 0.32;
      const vel = step % 4 === 0 ? 0.22 : 0.16;
      addPluck(t, note, vel, pan, isOutro ? 0.48 : 0.24);
      // Soft stereo echo 3/16ths later
      if (t + STEP_S * 3 < 22.6) {
        addPluck(t + STEP_S * 3, note, vel * 0.28, -pan * 0.85, 0.22);
      }
    }

    // Bass groove (enters after beat 2 of bar 0, resolves on outro)
    if (!isOutro) {
      for (const b of BASS_PATTERN) {
        const t = barStart + b.step * STEP_S;
        if (isIntro && b.step < 8) continue;
        if (t >= 21.3) break;
        addBass(t, prog.bass, b.dur * STEP_S, isClimax ? 0.28 : 0.22);
      }
    } else {
      addBass(barStart, 41, 1.8, 0.26); // Final root F
    }

    // Electronic drum groove (clean Google-style light punchy groove)
    if (!isOutro) {
      for (let s = 0; s < 16; s++) {
        const t = barStart + s * STEP_S;
        if (t >= 21.35) break;

        // Kick on 0, 8, and playful syncopated 10/14
        if (s === 0 || s === 8 || (!isIntro && s === 10 && bar % 2 === 1)) {
          if (!(isIntro && s < 4)) {
            addKick(t, isClimax ? 0.56 : 0.46);
          }
        }

        // Clap on 4 & 12 (beats 2 & 4)
        if (!isIntro && (s === 4 || s === 12)) {
          addClap(t, isClimax ? 0.22 : 0.16);
        }

        // Crisp 16th shaker / hi-hat groove with velocity accenting
        if (!isIntro || s >= 8) {
          const isOffbeat = s % 4 === 2;
          const hatAmp = isOffbeat ? 0.095 : s % 2 === 0 ? 0.055 : 0.032;
          addHat(t, hatAmp * (isClimax ? 1.15 : 0.9), isOffbeat && s === 14, s % 2 === 0 ? 0.24 : -0.18);
        }
      }
    }
  }

  // Iconic final crystal resolve chord chime at 21.4s (End Card reveal)
  addPluck(21.4, 65, 0.24, -0.25, 0.95);
  addPluck(21.46, 72, 0.22, 0.25, 1.0);
  addPluck(21.52, 76, 0.22, -0.15, 1.1);
  addPluck(21.58, 81, 0.24, 0.2, 1.25);

  // Beat-synced transition sparkles on all scene cuts
  for (let i = 1; i < SCENE_CUTS.length - 1; i++) {
    const cutS = SCENE_CUTS[i];
    const barIdx = Math.floor(cutS / (BEAT_S * 4));
    const prog = PROGRESSION[barIdx % PROGRESSION.length];
    addTransitionChime(cutS, prog.root, 0.14);
  }

  // Smooth master fade-in (120ms) and gentle final tail fade-out (650ms)
  const fadeInSamples = Math.floor(0.12 * SAMPLE_RATE);
  const fadeOutSamples = Math.floor(0.65 * SAMPLE_RATE);
  for (let i = 0; i < fadeInSamples; i++) {
    const g = i / fadeInSamples;
    left[i] *= g;
    right[i] *= g;
  }
  for (let i = 0; i < fadeOutSamples; i++) {
    const idx = TOTAL_SAMPLES - fadeOutSamples + i;
    const g = 1 - i / fadeOutSamples;
    const smooth = g * g;
    left[idx] *= smooth;
    right[idx] *= smooth;
  }

  fs.mkdirSync(path.dirname(outputWavPath), { recursive: true });
  writeWav(outputWavPath, left, right);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = process.argv[2] || path.resolve('promo-video/.tmp/soundtrack.wav');
  generateSoundtrack(out);
  console.log('Generated soundtrack:', out);
}
