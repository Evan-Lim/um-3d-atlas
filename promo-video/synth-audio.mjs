import fs from 'node:fs';
import path from 'node:path';

/**
 * Procedural 48kHz 16-bit stereo soundtrack synthesizer for UM 3D Atlas 35s 9:16 Reel.
 * Style: Crisp, upbeat Google product-reveal groove (126 BPM) — warm marimba/tech plucks,
 * tight electronic kick/hats/claps, rounded bass, airy major-9th pads, and subtle
 * beat-locked transition sparkles on every act cut. Zero external copyright assets.
 */

const SAMPLE_RATE = 48000;
export const DURATION_S = 35.0;
const BPM = 126;
const BEAT_S = 60 / BPM; // ~0.47619s
const STEP_S = BEAT_S / 4; // 16th note
const TOTAL_SAMPLES = Math.floor(SAMPLE_RATE * DURATION_S);

// Exact 10-act cut timestamps (seconds)
export const SCENE_CUTS = [0.0, 3.0, 6.5, 10.2, 13.4, 16.6, 20.4, 25.0, 28.2, 31.4];

function midiToHz(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

let rngState = 0x51a7b3c9;
function rand() {
  rngState = (rngState * 1664525 + 1013904223) >>> 0;
  return (rngState / 0xffffffff) * 2 - 1;
}

function writeWav(filePath, left, right) {
  const numSamples = left.length;
  const blockAlign = 4;
  const byteRate = SAMPLE_RATE * blockAlign;
  const dataSize = numSamples * blockAlign;
  const buf = Buffer.alloc(44 + dataSize);

  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const l = Math.tanh(left[i] * 0.94);
    const r = Math.tanh(right[i] * 0.94);
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

  function addPluck(startS, midi, amp, pan = 0, decayS = 0.26) {
    const freq = midiToHz(midi);
    const startIdx = Math.floor(startS * SAMPLE_RATE);
    const len = Math.floor(decayS * 3.4 * SAMPLE_RATE);
    const panL = Math.cos(((pan + 1) * Math.PI) / 4);
    const panR = Math.sin(((pan + 1) * Math.PI) / 4);

    for (let i = 0; i < len; i++) {
      const idx = startIdx + i;
      if (idx >= TOTAL_SAMPLES) break;
      const t = i / SAMPLE_RATE;
      const attack = Math.min(1, t / 0.003);
      const env = attack * Math.exp(-t / decayS);
      const brightEnv = attack * Math.exp(-t / (decayS * 0.32));
      const clickEnv = Math.exp(-t / 0.006);

      const s =
        Math.sin(2 * Math.PI * freq * t) * 0.72 +
        Math.sin(2 * Math.PI * freq * 2 * t) * 0.24 * brightEnv +
        Math.sin(2 * Math.PI * freq * 3 * t) * 0.1 * brightEnv +
        Math.sin(2 * Math.PI * freq * 4 * t) * 0.07 * clickEnv;

      const sample = s * env * amp;
      addSample(idx, sample * panL, sample * panR);
    }
  }

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
      const sample = s * env * amp;
      addSample(idx, sample, sample);
    }
  }

  function addPad(startS, chordMidis, durS, amp) {
    const startIdx = Math.floor(startS * SAMPLE_RATE);
    const len = Math.floor((durS + 0.3) * SAMPLE_RATE);
    const freqs = chordMidis.map(midiToHz);
    const inv = 1 / Math.sqrt(freqs.length);

    for (let i = 0; i < len; i++) {
      const idx = startIdx + i;
      if (idx >= TOTAL_SAMPLES) break;
      const t = i / SAMPLE_RATE;
      const fadeIn = Math.min(1, t / 0.14);
      const fadeOut = t > durS ? Math.exp(-(t - durS) / 0.12) : 1;
      const env = fadeIn * fadeOut * amp * inv;
      let l = 0;
      let r = 0;
      for (let k = 0; k < freqs.length; k++) {
        const f = freqs[k];
        const detune = k % 2 === 0 ? 1.0018 : 0.9982;
        l += Math.sin(2 * Math.PI * f * t) * 0.7 + Math.sin(2 * Math.PI * f * 2 * t) * 0.12;
        r += Math.sin(2 * Math.PI * f * detune * t) * 0.7 + Math.sin(2 * Math.PI * f * 2 * detune * t) * 0.12;
      }
      addSample(idx, l * env, r * env);
    }
  }

  function addKick(startS, amp) {
    const startIdx = Math.floor(startS * SAMPLE_RATE);
    const len = Math.floor(0.16 * SAMPLE_RATE);
    let phase = 0;
    for (let i = 0; i < len; i++) {
      const idx = startIdx + i;
      if (idx >= TOTAL_SAMPLES) break;
      const t = i / SAMPLE_RATE;
      const freq = 48 + 115 * Math.exp(-t / 0.022);
      phase += (2 * Math.PI * freq) / SAMPLE_RATE;
      const env = Math.exp(-t / 0.048);
      const click = Math.exp(-t / 0.004) * 0.22;
      const sample = (Math.sin(phase) * env + click) * amp;
      addSample(idx, sample, sample);
    }
  }

  function addClap(startS, amp) {
    const startIdx = Math.floor(startS * SAMPLE_RATE);
    const len = Math.floor(0.11 * SAMPLE_RATE);
    let prev = 0;
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const idx = startIdx + i;
      if (idx >= TOTAL_SAMPLES) break;
      const t = i / SAMPLE_RATE;
      const burst =
        Math.exp(-t / 0.012) * 0.7 +
        (t > 0.011 ? Math.exp(-(t - 0.011) / 0.014) * 0.65 : 0) +
        (t > 0.022 ? Math.exp(-(t - 0.022) / 0.038) * 0.9 : 0);
      const n = rand();
      const hp = n - prev * 0.7;
      prev = n;
      lp = lp * 0.45 + hp * 0.55;
      const sample = lp * burst * amp * 0.45;
      addSample(idx, sample * 0.96, sample * 1.04);
    }
  }

  function addHat(startS, amp, open = false, pan = 0.2) {
    const startIdx = Math.floor(startS * SAMPLE_RATE);
    const decay = open ? 0.085 : 0.024;
    const len = Math.floor(decay * 3.5 * SAMPLE_RATE);
    const panL = Math.cos(((pan + 1) * Math.PI) / 4);
    const panR = Math.sin(((pan + 1) * Math.PI) / 4);
    let prev1 = 0;
    let prev2 = 0;
    for (let i = 0; i < len; i++) {
      const idx = startIdx + i;
      if (idx >= TOTAL_SAMPLES) break;
      const t = i / SAMPLE_RATE;
      const n = rand();
      const hp = n - 1.5 * prev1 + 0.6 * prev2;
      prev2 = prev1;
      prev1 = n;
      const sample = hp * Math.exp(-t / decay) * amp;
      addSample(idx, sample * panL, sample * panR);
    }
  }

  function addTransitionChime(cutS, chordRootMidi, amp = 0.12) {
    addPluck(cutS, chordRootMidi + 24, amp * 0.7, -0.35, 0.32);
    addPluck(cutS + 0.045, chordRootMidi + 31, amp * 0.58, 0.35, 0.38);
    const whooshDur = 0.16;
    const startIdx = Math.floor((cutS - whooshDur) * SAMPLE_RATE);
    const len = Math.floor((whooshDur + 0.07) * SAMPLE_RATE);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const idx = startIdx + i;
      if (idx < 0 || idx >= TOTAL_SAMPLES) continue;
      const t = i / SAMPLE_RATE;
      const norm = t / (whooshDur + 0.07);
      const env = Math.sin(norm * Math.PI) * 0.048;
      const n = rand();
      lp = lp * 0.88 + n * 0.12;
      addSample(idx, lp * env, lp * env);
    }
  }

  const PROGRESSION = [
    { root: 41, bass: 41, chord: [65, 69, 72, 76, 79], arp: [65, 72, 76, 79, 76, 72, 74, 72] }, // Fmaj9
    { root: 40, bass: 40, chord: [64, 67, 72, 74, 79], arp: [64, 67, 72, 74, 79, 74, 72, 67] }, // Csus2/E
    { root: 38, bass: 38, chord: [62, 65, 69, 72, 76], arp: [62, 69, 72, 76, 72, 69, 72, 74] }, // Dm9
    { root: 34, bass: 46, chord: [58, 62, 65, 69, 72], arp: [62, 65, 69, 72, 77, 72, 69, 65] }, // Bbmaj9
  ];

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
    const isClimax = bar >= 5 && bar <= 15;
    const isOutro = barStart >= 31.1;

    if (!isOutro) {
      addPad(barStart, prog.chord.slice(0, 4), BEAT_S * 3.9, isClimax ? 0.08 : 0.055);
    } else {
      addPad(barStart, [65, 69, 72, 76, 81], Math.max(0.5, DURATION_S - barStart - 0.4), 0.095);
    }

    for (let p = 0; p < PLUCK_STEPS.length; p++) {
      const step = PLUCK_STEPS[p];
      const t = barStart + step * STEP_S;
      if (t >= 32.2) break;
      const note = prog.arp[p % prog.arp.length] + (isClimax && p % 3 === 0 ? 12 : 0);
      const pan = p % 2 === 0 ? -0.32 : 0.32;
      const vel = step % 4 === 0 ? 0.22 : 0.16;
      addPluck(t, note, vel, pan, isOutro ? 0.48 : 0.24);
      if (t + STEP_S * 3 < 32.8) {
        addPluck(t + STEP_S * 3, note, vel * 0.28, -pan * 0.85, 0.22);
      }
    }

    if (!isOutro) {
      for (const b of BASS_PATTERN) {
        const t = barStart + b.step * STEP_S;
        if (isIntro && b.step < 8) continue;
        if (t >= 31.3) break;
        addBass(t, prog.bass, b.dur * STEP_S, isClimax ? 0.28 : 0.22);
      }
    } else {
      addBass(barStart, 41, 2.2, 0.26);
    }

    if (!isOutro) {
      for (let s = 0; s < 16; s++) {
        const t = barStart + s * STEP_S;
        if (t >= 31.35) break;
        if (s === 0 || s === 8 || (!isIntro && s === 10 && bar % 2 === 1)) {
          if (!(isIntro && s < 4)) addKick(t, isClimax ? 0.56 : 0.46);
        }
        if (!isIntro && (s === 4 || s === 12)) {
          addClap(t, isClimax ? 0.22 : 0.16);
        }
        if (!isIntro || s >= 8) {
          const isOffbeat = s % 4 === 2;
          const hatAmp = isOffbeat ? 0.095 : s % 2 === 0 ? 0.055 : 0.032;
          addHat(t, hatAmp * (isClimax ? 1.15 : 0.9), isOffbeat && s === 14, s % 2 === 0 ? 0.24 : -0.18);
        }
      }
    }
  }

  // Final resolve chime at 31.4s (End Card reveal)
  addPluck(31.4, 65, 0.24, -0.25, 0.95);
  addPluck(31.46, 72, 0.22, 0.25, 1.0);
  addPluck(31.52, 76, 0.22, -0.15, 1.1);
  addPluck(31.58, 81, 0.24, 0.2, 1.25);

  for (let i = 1; i < SCENE_CUTS.length - 1; i++) {
    const cutS = SCENE_CUTS[i];
    const barIdx = Math.floor(cutS / (BEAT_S * 4));
    const prog = PROGRESSION[barIdx % PROGRESSION.length];
    addTransitionChime(cutS, prog.root, 0.13);
  }

  const fadeInSamples = Math.floor(0.12 * SAMPLE_RATE);
  const fadeOutSamples = Math.floor(0.75 * SAMPLE_RATE);
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
  console.log('Generated 35s soundtrack:', out);
}
