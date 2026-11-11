// SPDX-License-Identifier: Apache-2.0
import {mods} from './mod-api.js';
// Sound for IRONWAKE. Effects are scored as VANILLAJS audio2d events (integer-sample,
// four lanes, 48 kHz) and baked once into AudioBuffers; the engine hum and the ambient score
// are live Web Audio voices: a low drone with a sparse plucked line that tightens in battle.
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
  broadside: [[['square', 150, 42, 320, 7000, 8]], [['noise', 300, 300, 260, 6500, 4]], [['saw', 90, 40, 380, 4200, 6]]],
  turret: [[['saw', 1300, 500, 90, 3600, 5]], [['triangle', 2000, 900, 60, 2000, 3]]],
  flak: [[['noise', 700, 700, 120, 4200, 3]], [['square', 240, 110, 140, 3200, 4]]],
  craft: [[['triangle', 1700, 800, 80, 3200, 4]]],
  hit: [[['noise', 400, 400, 110, 6000, 2]], [['square', 170, 60, 130, 4200, 4]]],
  shield: [[['triangle', 1200, 460, 150, 5000, 6]], [['saw', 2400, 1800, 60, 1700, 2]]],
  deflect: [[['triangle', 300, 1200, 260, 4200, 8]], [['saw', 600, 2400, 200, 1800, 6]]],
  explode: [[['noise', 300, 300, 900, 8000, 6]], [['square', 100, 36, 700, 6000, 9]]],
  wreck: [[['noise', 260, 260, 2400, 10000, 10]], [['square', 80, 30, 2000, 8000, 16]], [['saw', 140, 34, 1500, 5000, 10]], [['rest', 0, 0, 500, 0], ['noise', 500, 500, 900, 6000, 5]]],
  torpedo: [[['noise', 600, 600, 500, 4200, 5]], [['saw', 160, 420, 500, 3600, 10]]],
  spool: [[['triangle', 140, 900, 2100, 3400, 30]], [['saw', 70, 450, 2100, 1700, 30]]],
  warp: [[['saw', 900, 200, 500, 4200, 10]], [['noise', 900, 900, 400, 3600, 4]]],
  click: [[['square', 880, 880, 34, 2600]]],
  buy: [[['triangle', 660, 660, 70, 4200], ['triangle', 990, 990, 110, 4200]]],
  error: [[['square', 170, 130, 170, 3800, 2]]],
  dock: [[['triangle', 330, 330, 120, 4200], ['triangle', 440, 440, 120, 4200], ['triangle', 660, 660, 240, 4200]], [['rest', 0, 0, 240, 0], ['saw', 165, 165, 260, 1600]]],
  alert: [[['square', 940, 940, 90, 3400], ['rest', 0, 0, 50, 0], ['square', 700, 700, 130, 3400]]],
  pickup: [[['triangle', 880, 1320, 130, 4200, 3]]],
  rock: [[['noise', 200, 200, 500, 6000, 5]], [['square', 130, 60, 300, 3600, 5]]],
};
/** Rendered PCM for a named effect; pure and deterministic (used by tests). */
export const renderSound = name => score(mods.sounds.get(name) ?? SOUNDS[name]).renderAll();

const SCALE = [0, 3, 5, 7, 10]; // minor pentatonic
const RIFFS = [[0, 2, 3, 2], [0, 3, 4, 3], [1, 3, 2, 0], [0, 2, 4, 5]];
const note = (root, degree, octave = 0) => root * 2 ** (octave + (SCALE[((degree % 5) + 5) % 5] + 12 * Math.floor(degree / 5)) / 12);

export class GameAudio {
  constructor() { this.ctx = null; this.voices = new Set(); this.buffers = new Map(); this.sfxVolume = 0.7; this.musicVolume = 0.5; this.root = 98; this.bar = 0; this.nextBar = 0; this.tension = 0; }
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
    for (const name of new Set([...Object.keys(SOUNDS), ...mods.sounds.keys()])) {
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
    const riff = RIFFS[(this.bar >> 1) % RIFFS.length], start = this.nextBar - 4.1, tense = this.tension > 0.3;
    this.#pad(this.root / 2, start, 5.2, 0.075, 'triangle'); this.#pad(this.root * 0.75, start, 5.2, 0.03, 'sine');
    // A plucked line: sparse at peace, doubled and driven in battle.
    const steps = tense ? 8 : 4;
    for (let i = 0; i < steps; i++) {
      if (!tense && (this.bar + i) % 3 === 2) continue;
      this.#pad(note(this.root, riff[i % 4] + (tense && i % 4 === 3 ? 5 : 0), 1), start + i * 4.2 / steps, tense ? 0.5 : 1.6, tense ? 0.05 : 0.04, 'sawtooth', 0.012, tense ? 1400 : 900);
    }
    if (tense) for (let i = 0; i < 8; i++) this.#pad(this.root / 2, start + i * 0.525, 0.22, 0.07 * this.tension, 'square', 0.008, 300);
    if (tense) for (let i = 0; i < 4; i++) this.#pad(52 + (i % 2) * 13, start + i * 1.05, 0.24, 0.1 * this.tension, 'sine', 0.005);
    if (this.stage.place === 'port' && this.bar % 3 === 0) this.#pad(this.root * 4, start + 2.6, 1.4, 0.025, 'sine', 0.01);
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
