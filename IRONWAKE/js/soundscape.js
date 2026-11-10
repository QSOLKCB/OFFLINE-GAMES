// SPDX-License-Identifier: Apache-2.0
// Original Web Audio presentation around VANILLAJS's deterministic audio2d scores.
export const MAX_EFFECT_VOICES = 32;
/** Remove DC, soften the brittle top end, and taper the outer edges of a baked score. */
export function masterPCM(pcm, rate = 48000) {
  const out = new Float32Array(pcm.length), attack = Math.round(rate * 0.004), release = Math.round(rate * 0.045);
  let previous = 0, high = 0, low = 0;
  for (let i = 0; i < pcm.length; i++) {
    const x = pcm[i] / 32768;
    high = x - previous + 0.995 * high; previous = x; low += (high - low) * 0.55;
    out[i] = Math.tanh(low * 1.2) * 0.82 * Math.min(1, i / attack, (pcm.length - 1 - i) / release);
  }
  return out;
}
/** Seeded stereo room tail, built once per audio context; no runtime downloads. */
export function roomImpulse(rate, seconds = 1.6) {
  let seed = 0x514f4c;
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296 * 2 - 1; };
  const frames = Math.floor(rate * seconds), channels = [new Float32Array(frames), new Float32Array(frames)];
  for (const data of channels) {
    let low = 0;
    for (let i = 0; i < frames; i++) { low += (random() - low) * 0.3; data[i] = low * (1 - i / frames) ** 3 * Math.min(1, i / (rate * 0.008)); }
  }
  return channels;
}
export function environmentAt(world) {
  if (!world) return 'space';
  if (world.docked) return 'port';
  const pos = world.playerShip.body.position;
  const ports = world.sector.stations ?? world.sector.pois.filter(p => p.type === 'base');
  if (ports.some(p => Math.hypot(...p.pos.map((v, i) => v - pos[i])) < (p.radius ?? 300) + 1400)) return 'port';
  if (world.zoneAt?.(pos, 'nebula')) return 'nebula';
  const rocks = world.sector.rocks;
  if (rocks.some(p => !p.dead && Math.hypot(...p.pos.map((v, i) => v - pos[i])) < 500 + p.radius)) return 'field';
  return 'space';
}
export class Soundstage {
  constructor(ctx, sfx, music) {
    this.ctx = ctx; this.nextControl = 0; this.place = 'space';
    const master = ctx.createDynamicsCompressor(); master.threshold.value = -15; master.knee.value = 18; master.ratio.value = 5; master.attack.value = 0.006; master.release.value = 0.22; master.connect(ctx.destination);
    sfx.connect(master); music.connect(master);
    const room = ctx.createConvolver(), channels = roomImpulse(ctx.sampleRate), buffer = ctx.createBuffer(2, channels[0].length, ctx.sampleRate);
    channels.forEach((data, i) => buffer.getChannelData(i).set(data)); room.buffer = buffer;
    this.wet = ctx.createGain(); this.wet.gain.value = 0.2; music.connect(room); room.connect(this.wet); this.wet.connect(master);
    const echo = ctx.createDelay(1), feedback = ctx.createGain(), filter = ctx.createBiquadFilter();
    echo.delayTime.value = 0.375; feedback.gain.value = 0.28; filter.type = 'lowpass'; filter.frequency.value = 1800;
    music.connect(echo); echo.connect(filter); filter.connect(feedback); feedback.connect(echo); filter.connect(this.wet);
    // A low mechanical bed becomes brighter around ports, granular in rock fields.
    const noise = ctx.createBufferSource(), noiseBuffer = ctx.createBuffer(1, channels[0].length, ctx.sampleRate);
    noiseBuffer.getChannelData(0).set(channels[0]); noise.buffer = noiseBuffer; noise.loop = true;
    this.airFilter = ctx.createBiquadFilter(); this.airFilter.type = 'bandpass'; this.airFilter.Q.value = 0.65;
    this.air = ctx.createGain(); this.air.gain.value = 0; noise.connect(this.airFilter); this.airFilter.connect(this.air); this.air.connect(sfx); noise.start();
    this.sub = ctx.createOscillator(); this.sub.type = 'sine'; this.subGain = ctx.createGain(); this.subGain.gain.value = 0;
    this.sub.connect(this.subGain); this.subGain.connect(sfx); this.sub.start();
    this.harmonic = ctx.createOscillator(); this.harmonic.type = 'triangle'; this.harmonic.detune.value = -7;
    this.harmonicGain = ctx.createGain(); this.harmonicGain.gain.value = 0; this.harmonic.connect(this.harmonicGain); this.harmonicGain.connect(sfx); this.harmonic.start();
  }
  update(active, power, world) {
    const t = this.ctx.currentTime;
    if (t < this.nextControl) return; // OPT: environment/control state at 4 Hz, never per audio sample.
    this.nextControl = t + 0.25; this.place = environmentAt(world);
    const moving = active ? Math.max(0, Math.min(3, power)) : 0;
    this.sub.frequency.setTargetAtTime(28 + moving * 16, t, 0.15); this.subGain.gain.setTargetAtTime(active ? 0.035 + moving * 0.012 : 0, t, 0.2);
    this.harmonic.frequency.setTargetAtTime(74 + moving * 48, t, 0.18); this.harmonicGain.gain.setTargetAtTime(active ? 0.012 + moving * 0.008 : 0, t, 0.2);
    this.airFilter.frequency.setTargetAtTime(this.place === 'port' ? 260 : this.place === 'field' ? 750 : 1400, t, 0.4);
    this.air.gain.setTargetAtTime(world && (active || world.docked) ? (this.place === 'space' ? 0.035 : 0.14) : 0, t, 0.5);
  }
}
