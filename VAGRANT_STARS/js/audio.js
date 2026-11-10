// SPDX-License-Identifier: Apache-2.0
// Sound for VAGRANT STARS. Effects are scored as VANILLAJS audio2d events (integer-sample,
// four lanes, 48 kHz) and baked once into AudioBuffers; the engine hum and the ambient score
// are live Web Audio voices. Each star system has its own root note, so every sky has a key.
import {Soundstage, masterPCM, MAX_EFFECT_VOICES} from './soundscape.js';
import {createSound2D, AUDIO2D_RATE} from '../vendor/vanillajs/modules/audio2d/index.js';

const ms = t => Math.max(1, Math.round(t * AUDIO2D_RATE / 1000));
/** Build an audio2d score from lanes of [wave, fromHz, toHz, milliseconds, gain, steps]. */
function score(lanes) {
  const events = []; let id = 1, frames = 1;
  lanes.forEach((segments, channel) => {
    let at = 0;
    for (const [wave, from, to, length, gain, steps = 1] of segments) {
      for (let i = 0; i < steps; i++) {
        const duration = ms(length / steps), k = steps > 1 ? i / (steps - 1) : 0;
        if (wave !== 'rest') events.push({id: id++, sample: at, duration, channel, wave, frequency: Math.round(from + (to - from) * k), gain: Math.round(gain * (steps > 1 ? 1 - k * 0.5 : 1)), seed: id * 7919});
        at += duration;
      }
    }
    frames = Math.max(frames, at);
  });
  return createSound2D({frames, events});
}
export const SOUNDS = {
  pulse: [[['saw', 1500, 420, 130, 5200, 7]], [['triangle', 2400, 900, 90, 3000, 4]]],
  plasma: [[['square', 340, 90, 260, 5200, 9]], [['noise', 200, 200, 180, 3600, 3]]],
  ion: [[['triangle', 2100, 700, 150, 5200, 8]], [['noise', 900, 900, 60, 2000, 2]]],
  lance: [[['saw', 700, 1900, 110, 5000, 6]], [['square', 180, 90, 160, 3200, 4]]],
  hit: [[['noise', 400, 400, 90, 6000, 2]], [['square', 190, 70, 110, 4000, 4]]],
  shield: [[['triangle', 1300, 500, 140, 5200, 6]], [['saw', 2600, 1900, 60, 1800, 2]]],
  explode: [[['noise', 300, 300, 1100, 9000, 6]], [['square', 90, 34, 800, 7000, 10]], [['saw', 160, 40, 500, 4200, 6]]],
  missile: [[['noise', 600, 600, 420, 4200, 5]], [['saw', 220, 520, 420, 3800, 10]]],
  click: [[['square', 880, 880, 34, 2600]]],
  buy: [[['triangle', 660, 660, 70, 4200], ['triangle', 990, 990, 110, 4200]]],
  error: [[['square', 170, 130, 170, 3800, 2]]],
  dock: [[['triangle', 392, 392, 110, 4200], ['triangle', 523, 523, 110, 4200], ['triangle', 659, 659, 220, 4200]], [['rest', 0, 0, 220, 0], ['saw', 196, 196, 240, 1600]]],
  jump: [[['saw', 90, 1700, 1500, 5200, 30]], [['noise', 500, 500, 1600, 5200, 8]], [['triangle', 60, 240, 1500, 5200, 20]]],
  cruise: [[['triangle', 180, 760, 3300, 3200, 33]], [['saw', 90, 380, 3300, 1500, 33]]],
  alert: [[['square', 1040, 1040, 90, 3400], ['rest', 0, 0, 50, 0], ['square', 820, 820, 120, 3400]]],
  pickup: [[['triangle', 880, 1320, 130, 4200, 3]]],
  sling: [[['saw', 240, 1300, 600, 4200, 14]], [['noise', 800, 800, 500, 2600, 4]]],
  tractor: [[['triangle', 300, 520, 400, 3000, 8]]],
};
/** Rendered PCM for a named effect; pure and deterministic (used by tests). */
export const renderSound = name => score(SOUNDS[name]).renderAll();

const SCALE = [0, 2, 3, 5, 7, 8, 10]; // natural minor
const CHORDS = [[0, 2, 4], [5, 0, 2], [3, 5, 0], [4, 6, 1]];
const note = (root, degree, octave = 0) => root * 2 ** (octave + (SCALE[((degree % 7) + 7) % 7] + 12 * Math.floor(degree / 7)) / 12);

export class GameAudio {
  constructor() { this.ctx = null; this.voices = new Set(); this.buffers = new Map(); this.sfxVolume = 0.7; this.musicVolume = 0.5; this.root = 110; this.bar = 0; this.nextBar = 0; this.tension = 0; }
  /** Call from a user gesture. */
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const Ctx = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!Ctx) return;
    const ctx = this.ctx = new Ctx();
    this.sfx = ctx.createGain(); this.music = ctx.createGain();
    this.stage = new Soundstage(ctx, this.sfx, this.music);
    this.engineOsc = ctx.createOscillator(); this.engineOsc.type = 'sawtooth'; this.engineFilter = ctx.createBiquadFilter(); this.engineFilter.type = 'lowpass';
    this.engineGain = ctx.createGain(); this.engineGain.gain.value = 0;
    this.engineOsc.connect(this.engineFilter); this.engineFilter.connect(this.engineGain); this.engineGain.connect(this.sfx); this.engineOsc.start();
    this.setVolumes(this.sfxVolume, this.musicVolume);
    for (const name of Object.keys(SOUNDS)) {
      const pcm = renderSound(name), buffer = ctx.createBuffer(1, pcm.length, AUDIO2D_RATE), out = buffer.getChannelData(0);
      out.set(masterPCM(pcm, AUDIO2D_RATE));
      this.buffers.set(name, buffer);
    }
  }
  setVolumes(sfx, music) {
    this.sfxVolume = sfx; this.musicVolume = music;
    if (this.ctx) { this.sfx.gain.value = sfx; this.music.gain.value = music * 0.5; this.stage.wet.gain.value = music * 0.4; }
  }
  play(name, {gain = 1, pan = 0, rate = 1} = {}) {
    const ctx = this.ctx, buffer = this.buffers.get(name);
    if (!ctx || !buffer || ctx.state !== 'running' || gain <= 0.01 || this.voices.size >= MAX_EFFECT_VOICES) return;
    const source = ctx.createBufferSource(), g = ctx.createGain();
    source.buffer = buffer; source.playbackRate.value = rate; g.gain.value = Math.min(1, gain);
    const p = ctx.createStereoPanner?.();
    source.connect(g);
    if (p) { p.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(p); p.connect(this.sfx); } else g.connect(this.sfx);
    this.voices.add(source);
    source.onended = () => { source.disconnect(); g.disconnect(); p?.disconnect(); this.voices.delete(source); };
    source.start();
  }
  setSystem(root) { this.root = root; this.bar = 0; }
  /** power 0..3 drives the engine hum; tension 0..1 thickens the score. Pass active=false to idle. */
  update(active, power = 0, tension = 0, world = null) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    this.stage.update(active, power, world);
    this.engineGain.gain.setTargetAtTime(active ? 0.035 + power * 0.04 : 0, t, 0.15);
    this.engineOsc.frequency.setTargetAtTime(46 + power * 44, t, 0.2); this.engineFilter.frequency.setTargetAtTime(160 + power * 420, t, 0.2);
    this.tension += (tension - this.tension) * 0.05;
    if (t < this.nextBar || this.musicVolume === 0) return;
    this.nextBar = Math.max(t, this.nextBar) + 4.2;
    const chord = CHORDS[this.bar % CHORDS.length], start = this.nextBar - 4.1;
    chord.forEach((degree, i) => this.#pad(note(this.root, degree, i === 0 ? 0 : 1), start + i * 0.12, 5.4, 0.05));
    this.#pad(note(this.root, chord[0], -1), start, 5.4, 0.07, 'triangle');
    if (this.bar % 2 === 0) this.#pad(note(this.root, chord[(this.bar >> 1) % 3] + 7, 2), start + 2.1, 2.4, 0.022, 'sine', 0.05);
    if (this.tension > 0.3) for (let i = 0; i < 8; i++) this.#pad(note(this.root, chord[0], -1) * (i % 4 === 3 ? 1.5 : 1), start + i * 0.525, 0.3, 0.06 * this.tension, 'square', 0.01, 420);
    if (this.tension < 0.3 && this.bar % 2 === 1) for (let i = 0; i < 3; i++)
      this.#pad(note(this.root, chord[i] + 7, 1), start + 1.1 + i * 0.7, 1.5, 0.018, 'sine', 0.015);
    this.bar++;
  }
  #pad(frequency, start, length, gain, type = 'sine', attack = 1.4, cutoff = 0) {
    const ctx = this.ctx, osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = type; osc.frequency.value = frequency; osc.detune.value = (frequency % 7) - 3;
    g.gain.setValueAtTime(0, start); g.gain.linearRampToValueAtTime(gain, start + attack); g.gain.linearRampToValueAtTime(0, start + length);
    const f = cutoff ? ctx.createBiquadFilter() : null, p = ctx.createStereoPanner?.();
    if (f) { f.type = 'lowpass'; f.frequency.value = cutoff; osc.connect(f); f.connect(g); } else osc.connect(g);
    if (p) { p.pan.value = Math.sin(frequency * 0.037) * 0.65; g.connect(p); p.connect(this.music); } else g.connect(this.music);
    osc.onended = () => { osc.disconnect(); g.disconnect(); f?.disconnect(); p?.disconnect(); };
    osc.start(start); osc.stop(start + length + 0.05);
  }
}
