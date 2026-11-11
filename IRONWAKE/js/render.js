// SPDX-License-Identifier: Apache-2.0
import {detailedModel} from '../../shared/surface-detail.js';
// Scene presentation for IRONWAKE on the VANILLAJS render-webgl module.
// The module draws world-space coloured vertices with one camera, so every object is
// transformed and flat-lit on the CPU each frame and streamed into a few dynamic meshes.
// Distant objects are drawn first in a uniformly shrunken "far" pass (same image, far better
// depth precision), then the depth buffer is cleared and nearby objects are drawn at 1:1.
import {Environment as WebGLEnvironment, unitCircle} from './environment.js';
import {Renderer as SoftwareRenderer, Environment as SoftwareEnvironment, mountGraphics} from '../../shared/presentation.js';
import {Renderer} from '../vendor/vanillajs/modules/render-webgl/index.js';
import {rotate, perspective, viewMatrix, multiplyMatrices, seededRandom} from '../vendor/vanillajs/modules/math/index.js';
import {FACTIONS, SECTOR} from './sim/data.js';
import {vesselModel, stationModel, stationLights, rockModels, wreckModel, crateModel, torpedoModel} from './sim/models.js';

export const FOV = Math.PI / 2.6;
const FAR_SCALE = 1 / 130, NEAR_LIMIT = 1150;
const IDENTITY = [0, 0, 0, 1], PLAYER_TRIM = [0.86, 0.88, 0.93];

class Stream {
  constructor(renderer, maxVertices, primitive = 'triangles') {
    this.renderer = renderer; this.data = new Float32Array(maxVertices * 6); this.n = 0; this.mesh = renderer.mesh([], primitive);
  }
  reset() { this.n = 0; }
  room(vertices) { return this.n + vertices * 6 <= this.data.length; }
  flush() { this.renderer.update(this.mesh, this.data.subarray(0, this.n)); if (this.n) this.renderer.draw(this.mesh); }
}

export class Scene {
  constructor(canvas) {
    const legacy = new URLSearchParams(location.search).get("renderer") === "webgl";
    const r = this.renderer = legacy ? new Renderer(canvas) : new SoftwareRenderer(canvas);
    this.gl = r.gl; this.canvas = canvas; this.environment = legacy ? new WebGLEnvironment(r.gl) : new SoftwareEnvironment(r);
    if (!legacy) mountGraphics(r);
    this.far = new Stream(r, 150000); this.near = new Stream(r, 60000);
    this.farGlow = new Stream(r, 30000); this.nearGlow = new Stream(r, 45000); this.lines = new Stream(r, 9000, 'lines');
    this.sky = null; this.fx = []; this.sparks = [];
    const rng = seededRandom(99);
    this.dust = Array.from({length: 150}, () => [rng() * 300, rng() * 300, rng() * 300]);
    this.cam = {pos: [0, 0, 0], q: [0, 0, 0, 1]}; this.right = [1, 0, 0]; this.up = [0, 1, 0]; this.vp = null; this.light = [0, 1, 0];
    this.tint = [1, 1, 1]; this.time = 0;
  }

  /** Build the static sky: stars and nebula clouds. */
  setSky() {
    const r = this.renderer, rng = seededRandom(20261110);
    if (this.sky) for (const m of Object.values(this.sky)) { this.gl.deleteBuffer(m.buffer); r.meshes.delete(m); }
    const dirOnSphere = () => { const z = rng() * 2 - 1, a = rng() * Math.PI * 2, s = Math.sqrt(1 - z * z); return [Math.cos(a) * s, z, Math.sin(a) * s]; };
    const small = [], big = [], R = 900;
    const tilt = [rng() - 0.5, rng() - 0.5, rng() - 0.5];
    for (let i = 0; i < 2600; i++) {
      let d = dirOnSphere();
      if (i > 1300) { // a denser band of stars across the sky
        const k = d[0] * tilt[0] + d[1] * tilt[1] + d[2] * tilt[2]; d = d.map((v, j) => v - tilt[j] * k * 1.6); const l = Math.hypot(...d) || 1; d = d.map(v => v / l);
      }
      const b = 0.25 + rng() * rng() * 0.75, hue = rng(), c = hue < 0.2 ? [1, 0.8, 0.6] : hue < 0.4 ? [0.7, 0.8, 1] : [1, 1, 1];
      (b > 0.72 ? big : small).push(d[0] * R, d[1] * R, d[2] * R, c[0] * b, c[1] * b, c[2] * b);
    }
    this.sky = {small: r.mesh(small, 'points'), big: r.mesh(big, 'points')};
    this.environment.configure(20261110, SECTOR.sky, SECTOR.planets);
    this.tint = SECTOR.sun.color.map(v => 0.55 + v * 0.45);
    this.fx = []; this.sparks = [];
  }

  /** Visual-only reactions to simulation events. */
  onEvent(e) {
    if (e.type === 'explode') {
      const rng = seededRandom((this.time * 1000) | 1), big = e.size > 10 && !e.rock, vel = e.vel ?? [0, 0, 0];
      this.fx.push({kind: 'boom', pos: [...e.pos], vel, t: 0, life: 0.9 + Math.min(1.6, e.size * 0.05), size: Math.min(e.size, 26)});
      if (big) for (let i = 0; i < Math.min(6, e.size / 6); i++) // a dying warship breaks up in a chain of blasts
        this.fx.push({kind: 'boom', pos: e.pos.map(v => v + (rng() - 0.5) * e.size * 1.8), vel, t: -0.12 - i * 0.16 - rng() * 0.1, life: 0.8, size: e.size * (0.25 + rng() * 0.3)});
      for (let i = 0, n = Math.min(60, 10 + e.size * 2); i < n; i++) {
        const v = [rng() - 0.5, (rng() - 0.5) * 0.6, rng() - 0.5], l = Math.hypot(...v) || 1, sp = (30 + rng() * 130) * (0.6 + Math.min(2, e.size * 0.05));
        this.sparks.push({pos: [...e.pos], vel: v.map((x, j) => x / l * sp + vel[j]), t: 0, life: 0.6 + rng() * 1.4, color: e.rock ? [0.7, 0.6, 0.5] : [1, 0.6 + rng() * 0.3, 0.25]});
      }
    } else if (e.type === 'hit') this.fx.push({kind: 'flash', pos: [...e.pos], t: 0, life: 0.2, size: e.shield ? 5 : 4, color: e.deflected ? [0.4, 1, 0.9] : e.shield ? [0.35, 0.6, 1] : [1, 0.7, 0.35]});
    else if (e.type === 'spark') this.fx.push({kind: 'flash', pos: [...e.pos], t: 0, life: 0.18, size: e.big ? 5 : 2.5, color: [1, 0.8, 0.5]});
    else if (e.type === 'shot' && e.kind === 'broadside') this.fx.push({kind: 'flash', pos: [...e.pos], t: 0, life: 0.12, size: 4.5, color: [1, 0.85, 0.55]});
  }

  /** Screen position (CSS pixels) of a world point, or null when behind the camera. */
  project(pos, width, height) {
    const m = this.vp, c = this.cam.pos, x = pos[0] - c[0], y = pos[1] - c[1], z = pos[2] - c[2];
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (w <= 0.01) return null;
    return {x: ((m[0] * x + m[4] * y + m[8] * z + m[12]) / w * 0.5 + 0.5) * width, y: (0.5 - (m[1] * x + m[5] * y + m[9] * z + m[13]) / w * 0.5) * height, w};
  }
  /** World direction through a screen point (normalized device coordinates, +Y up). */
  ray(nx, ny, aspect) {
    const t = Math.tan(FOV / 2), d = [nx * aspect * t, ny * t, -1], l = Math.hypot(...d);
    return rotate(this.cam.q, d.map(v => v / l));
  }

  // Emitters ---------------------------------------------------------------------------------
  #model(model, pos, q, scale, flash = 0, forceFar = false) {
    const c = this.cam.pos, px = pos[0] - c[0], py = pos[1] - c[1], pz = pos[2] - c[2], d = Math.hypot(px, py, pz), radius = model.radius * scale;
    if (d > radius * 1.2) { // cheap view-cone rejection
      const f = this.fwd, along = px * f[0] + py * f[1] + pz * f[2];
      if (along < -radius || Math.acos(Math.max(-1, Math.min(1, along / d))) - Math.asin(Math.min(1, radius / d)) > 1.12) return;
    }
    const far = forceFar || d + radius > NEAR_LIMIT, stream = far ? this.far : this.near, k = far ? FAR_SCALE : 1;
    if (!stream.room(model.count * 3)) return;
    const [x, y, z, w] = q, m00 = 1 - 2 * (y * y + z * z), m01 = 2 * (x * y - z * w), m02 = 2 * (x * z + y * w), m10 = 2 * (x * y + z * w), m11 = 1 - 2 * (x * x + z * z),
      m12 = 2 * (y * z - x * w), m20 = 2 * (x * z - y * w), m21 = 2 * (y * z + x * w), m22 = 1 - 2 * (x * x + y * y);
    const L = this.light, lx = m00 * L[0] + m10 * L[1] + m20 * L[2], ly = m01 * L[0] + m11 * L[1] + m21 * L[2], lz = m02 * L[0] + m12 * L[1] + m22 * L[2];
    if (this.detail !== false && radius / Math.max(1,d) > 0.035) model = detailedModel(model, radius > 100);
    if (!stream.room(model.count * 3)) return;
    const T = this.tint, out = stream.data, tris = model.tris, normals = model.normals, colors = model.colors, glow = model.glow, s = scale * k, ox = px * k, oy = py * k, oz = pz * k;
    const vxCamera = -(m00 * px + m10 * py + m20 * pz) / scale;
    const vyCamera = -(m01 * px + m11 * py + m21 * pz) / scale;
    const vzCamera = -(m02 * px + m12 * py + m22 * pz) / scale;
    let n = stream.n;
    for (let i = 0, count = model.count; i < count; i++) {
      const i3 = i * 3, i9 = i * 9;
      // Outward normals are baked by Builder. Opaque back faces cannot be
      // seen from outside the model; avoid transforming/uploading them.
      if (d > radius && !glow[i] && normals[i3] * (vxCamera - tris[i9]) + normals[i3 + 1] * (vyCamera - tris[i9 + 1]) + normals[i3 + 2] * (vzCamera - tris[i9 + 2]) <= 0) continue;
      let r = colors[i3], g = colors[i3 + 1], b = colors[i3 + 2];
      if (!glow[i]) {
        const lit = normals[i3] * lx + normals[i3 + 1] * ly + normals[i3 + 2] * lz, shade = 0.26 + (lit > 0 ? lit * 0.86 : lit * -0.07) + Math.pow(1 - Math.abs(normals[i3] * (m00 * px + m10 * py + m20 * pz) / Math.max(1,d) + normals[i3 + 1] * (m01 * px + m11 * py + m21 * pz) / Math.max(1,d) + normals[i3 + 2] * (m02 * px + m12 * py + m22 * pz) / Math.max(1,d)), 3) * 0.13;
        r = r * shade * T[0] + flash; g = g * shade * T[1] + flash; b = b * shade * T[2] + flash * 1.4;
      }
      for (let v = 0; v < 9; v += 3) {
        const vx = tris[i9 + v], vy = tris[i9 + v + 1], vz = tris[i9 + v + 2];
        out[n] = (m00 * vx + m01 * vy + m02 * vz) * s + ox; out[n + 1] = (m10 * vx + m11 * vy + m12 * vz) * s + oy; out[n + 2] = (m20 * vx + m21 * vy + m22 * vz) * s + oz;
        out[n + 3] = r; out[n + 4] = g; out[n + 5] = b; n += 6;
      }
    }
    stream.n = n;
  }
  /** Camera-facing additive disc: bright centre fading to black. */
  #disc(pos, radius, color, far = null, segs = 10, core = 1) {
    const c = this.cam.pos, px = pos[0] - c[0], py = pos[1] - c[1], pz = pos[2] - c[2], d = Math.hypot(px, py, pz);
    const f = this.fwd; if (px * f[0] + py * f[1] + pz * f[2] < -radius) return;
    const isFar = far ?? d + radius > NEAR_LIMIT, stream = isFar ? this.farGlow : this.nearGlow, k = isFar ? FAR_SCALE : 1;
    if (!stream.room(segs * 3)) return;
    const R = this.right, U = this.up, out = stream.data, r = radius * k, ox = px * k, oy = py * k, oz = pz * k;
    let n = stream.n;
    const circle = unitCircle(segs);
    for (let i = 0; i < segs; i++) {
      const ca = circle[i * 2] * r, sa = circle[i * 2 + 1] * r, cb = circle[i * 2 + 2] * r, sb = circle[i * 2 + 3] * r;
      out[n] = ox; out[n + 1] = oy; out[n + 2] = oz; out[n + 3] = color[0] * core; out[n + 4] = color[1] * core; out[n + 5] = color[2] * core;
      out[n + 6] = ox + R[0] * ca + U[0] * sa; out[n + 7] = oy + R[1] * ca + U[1] * sa; out[n + 8] = oz + R[2] * ca + U[2] * sa; out[n + 9] = 0; out[n + 10] = 0; out[n + 11] = 0;
      out[n + 12] = ox + R[0] * cb + U[0] * sb; out[n + 13] = oy + R[1] * cb + U[1] * sb; out[n + 14] = oz + R[2] * cb + U[2] * sb; out[n + 15] = 0; out[n + 16] = 0; out[n + 17] = 0;
      n += 18;
    }
    stream.n = n;
  }
  /** Camera-facing additive halo: dark centre, bright band, dark rim. */
  #ring(pos, radius, color, segs = 14) {
    const c = this.cam.pos, ox = pos[0] - c[0], oy = pos[1] - c[1], oz = pos[2] - c[2], stream = this.nearGlow;
    if (!stream.room(segs * 12) || Math.hypot(ox, oy, oz) + radius > NEAR_LIMIT) return;
    const R = this.right, U = this.up, out = stream.data; let n = stream.n;
    const put = (a, k, lit) => {
      const x = Math.cos(a) * radius * k, y = Math.sin(a) * radius * k;
      out[n] = ox + R[0] * x + U[0] * y; out[n + 1] = oy + R[1] * x + U[1] * y; out[n + 2] = oz + R[2] * x + U[2] * y;
      out[n + 3] = lit ? color[0] : 0; out[n + 4] = lit ? color[1] : 0; out[n + 5] = lit ? color[2] : 0; n += 6;
    };
    for (let i = 0; i < segs; i++) {
      const a = i / segs * Math.PI * 2, b = (i + 1) / segs * Math.PI * 2;
      put(a, 0.45, false); put(a, 0.86, true); put(b, 0.86, true); put(a, 0.45, false); put(b, 0.86, true); put(b, 0.45, false);
      put(a, 0.86, true); put(a, 1, false); put(b, 1, false); put(a, 0.86, true); put(b, 1, false); put(b, 0.86, true);
    }
    stream.n = n;
  }
  /** Camera-facing additive streak from a (colour ca) to b (colour cb). */
  #beam(a, b, width, ca, cb, stream = this.nearGlow, k = 1) {
    if (!stream.room(6)) return;
    const c = this.cam.pos, ax = (a[0] - c[0]) * k, ay = (a[1] - c[1]) * k, az = (a[2] - c[2]) * k, bx = (b[0] - c[0]) * k, by = (b[1] - c[1]) * k, bz = (b[2] - c[2]) * k;
    const dx = bx - ax, dy = by - ay, dz = bz - az, mx = (ax + bx) / 2, my = (ay + by) / 2, mz = (az + bz) / 2;
    let sx = dy * mz - dz * my, sy = dz * mx - dx * mz, sz = dx * my - dy * mx; const sl = Math.hypot(sx, sy, sz);
    if (sl < 1e-9) return;
    const w = width * k / sl; sx *= w; sy *= w; sz *= w;
    const out = stream.data; let n = stream.n;
    const put = (x, y, z, col) => { out[n] = x; out[n + 1] = y; out[n + 2] = z; out[n + 3] = col[0]; out[n + 4] = col[1]; out[n + 5] = col[2]; n += 6; };
    put(ax - sx, ay - sy, az - sz, ca); put(ax + sx, ay + sy, az + sz, ca); put(bx + sx, by + sy, bz + sz, cb);
    put(ax - sx, ay - sy, az - sz, ca); put(bx + sx, by + sy, bz + sz, cb); put(bx - sx, by - sy, bz - sz, cb);
    stream.n = n;
  }
  #line(a, b, ca, cb) {
    const s = this.lines; if (!s.room(2)) return;
    const c = this.cam.pos, out = s.data, n = s.n;
    out[n] = a[0] - c[0]; out[n + 1] = a[1] - c[1]; out[n + 2] = a[2] - c[2]; out[n + 3] = ca[0]; out[n + 4] = ca[1]; out[n + 5] = ca[2];
    out[n + 6] = b[0] - c[0]; out[n + 7] = b[1] - c[1]; out[n + 8] = b[2] - c[2]; out[n + 9] = cb[0]; out[n + 10] = cb[1]; out[n + 11] = cb[2];
    s.n = n + 12;
  }

  // Frame ------------------------------------------------------------------------------------
  /** poses: Map(ship id -> {pos,q}) interpolated by the caller. extra: seconds past the last tick. */
  draw(world, cam, poses, extra, dt) {
    const r = this.renderer, gl = this.gl, sector = world.sector, cp = cam.pos;
    this.time += dt; this.cam = cam;
    this.right = rotate(cam.q, [1, 0, 0]); this.up = rotate(cam.q, [0, 1, 0]); this.fwd = rotate(cam.q, [0, 0, -1]);
    const sd = SECTOR.sun.dir, sl = Math.hypot(...sd); this.light = sd.map(v => v / sl);
    for (const s of [this.far, this.near, this.farGlow, this.nearGlow, this.lines]) s.reset();
    const blink = 0.55 + 0.45 * Math.sin(this.time * 4);

    // Sun, planets, stations, rocks and wrecks.
    const sun = this.light.map((v, i) => cp[i] + v * 110000), sc = SECTOR.sun.color;
    this.#disc(sun, 46000, sc.map(v => v * 0.45), true, 28); this.#disc(sun, 11000, [1, 1, 1], true, 28, 2.2);
    for (const s of sector.stations) {
      this.#model(stationModel(s.def.kind, FACTIONS[s.faction].color), s.pos, IDENTITY, 1);
      for (const light of stationLights(s.def.kind)) this.#disc([s.pos[0] + light.c[0], s.pos[1] + light.c[1], s.pos[2] + light.c[2]], 18, light.col.map(v => v * blink));
    }
    // Lit port approaches give nearby stations scale and a clear arrival corridor.
    for (const port of sector.stations) {
      const d = Math.hypot(...port.pos.map((v, i) => v - cam.pos[i]));
      if (d > 7000) continue;
      const radius = port.radius ?? 320;
      for (let i = 0; i < 7; i++) {
        const z = port.pos[2] + radius + 100 + i * 90;
        const pulse = 0.25 + 0.65 * Math.max(0, Math.sin(this.time * 2.8 - i * 0.65));
        for (const side of [-1, 1]) {
          const pos = [port.pos[0] + side * 70, port.pos[1] - 25, z];
          this.#disc(pos, 7, [0.12 * pulse, 0.65 * pulse, pulse], null, 8);
        }
      }
      const beacon = [port.pos[0], port.pos[1] + radius * 0.6, port.pos[2]];
      this.#disc(beacon, 32, [0.55, 0.18, 0.035].map(v => v * (0.5 + 0.5 * Math.sin(this.time * 1.8))));
    }
    // OPT-REDUCE-001: cull field objects by distance before any vertex work, and thin distant rocks.
    const near = [rockModels(1, false), rockModels(1, true)], far = [rockModels(0, false), rockModels(0, true)];
    for (const rock of sector.rocks) {
      if (rock.dead) continue;
      const dx = rock.pos[0] - cp[0], dz = rock.pos[2] - cp[2], d2 = dx * dx + dz * dz, reach = 5600 + rock.radius * 60;
      if (d2 > reach * reach) continue;
      this.#model((d2 > 1800 * 1800 ? far : near)[rock.rich ? 1 : 0][rock.variant], rock.pos, rock.q, rock.radius);
    }
    for (const w of sector.wrecks) {
      const dx = w.pos[0] - cp[0], dz = w.pos[2] - cp[2];
      if (dx * dx + dz * dz < 7000 * 7000) this.#model(wreckModel(w.variant), w.pos, w.q, w.radius / 45);
    }

    // Ships, engines, shields and deflectors.
    for (const ship of world.ships) {
      const pose = ship.alive && poses.get(ship.id); if (!pose) continue;
      const model = vesselModel(ship.cls, ship.battery?.cannons ?? 0, ship.turrets.length, ship.isPlayer ? PLAYER_TRIM : FACTIONS[ship.faction].color);
      this.#model(model, pose.pos, pose.q, 1, ship.flash * 1.4);
      const speed = Math.hypot(ship.body.velocity[0], ship.body.velocity[2]), power = ship.warp.state === 'on' ? 3.2 : ship.boosting ? 1.9 : 0.25 + Math.min(1, speed / ship.speed) * 0.85;
      const flick = 0.86 + 0.14 * Math.sin(this.time * 38 + ship.id), hot = ship.warp.state !== 'off' ? [0.55, 0.8, 1] : ship.boosting ? [1, 0.75, 0.45] : [0.45, 0.7, 1];
      for (const e of model.engines) {
        const a = rotate(pose.q, [e[0], e[1], e[2]]).map((v, i) => v + pose.pos[i]), b = rotate(pose.q, [e[0], e[1], e[2] + e[3] * 6.5 * power * flick]).map((v, i) => v + pose.pos[i]);
        this.#beam(a, b, e[3] * 0.9, hot, [0, 0, 0]); this.#disc(a, e[3] * 1.9, hot.map(v => v * 0.8));
      }
      if (ship.deflect?.active) { const k = 0.5 + 0.2 * Math.sin(this.time * 22); this.#ring(pose.pos, ship.radius * 1.75, [0.2 * k, 0.75 * k, 0.66 * k], 28); this.#disc(pose.pos, ship.radius * 1.5, [0.02, 0.1, 0.09], null, 20); }
      else if (ship.sinceHit < 0.3 && ship.flash <= 0) this.#ring(pose.pos, ship.radius * 1.5, [0.1, 0.24, 0.6].map(v => v * (0.3 - ship.sinceHit) * 2.4), 24);
      if (ship.warp.state === 'spool') this.#ring(pose.pos, ship.radius * (3.2 - ship.warp.t), [0.2, 0.5, 0.9], 18);
    }
    // Shells, torpedoes and floating cargo.
    for (const sh of world.shells) {
      const a = [sh.x + sh.vx * extra, 0, sh.z + sh.vz * extra], heavy = sh.kind === 'broadside', k = heavy ? 0.045 : 0.028, b = [a[0] - sh.vx * k, 0, a[2] - sh.vz * k];
      this.#beam(a, b, heavy ? 1.5 : 0.7, sh.color, sh.color.map(v => v * 0.2)); this.#disc(a, heavy ? 4.2 : 2.2, sh.color, null, 8, 1.6);
    }
    for (const t of world.torpedoes) {
      const pos = [t.x, 0, t.z], h = Math.atan2(-t.dir[0], -t.dir[1]);
      this.#model(torpedoModel(), pos, [0, Math.sin(h / 2), 0, Math.cos(h / 2)], 1.6);
      this.#beam(pos, [t.x - t.dir[0] * 40, 0, t.z - t.dir[1] * 40], 1.2, [1, 0.7, 0.3], [0, 0, 0]); this.#disc(pos, 5, [1, 0.6, 0.2]);
    }
    for (const k of world.pickups) {
      const a = this.time * 1.3 + k.id, pos = [k.x, 0, k.z];
      this.#model(crateModel(), pos, [Math.sin(a) * 0.5, Math.cos(a * 0.7) * 0.5, 0.3, 0.64], 1.3);
      this.#disc(pos, 7, k.good === 'crystal' ? [0.3 * blink, 0.8 * blink, 1 * blink] : [0.9 * blink, 0.75 * blink, 0.2 * blink]);
    }
    // Explosions, flashes and sparks.
    for (const f of this.fx) {
      f.t += dt; if (f.t < 0) continue;
      const k = f.t / f.life;
      if (f.kind === 'boom') {
        f.pos = f.pos.map((v, i) => v + f.vel[i] * dt * 0.4);
        const fade = Math.max(0, 1 - k), radius = f.size * (2 + k * 8);
        this.#disc(f.pos, radius, [1.6 * fade, (1.1 - k * 0.7) * fade, Math.max(0, 0.7 - k * 0.7) * fade], null, 16, 1.3);
        this.#disc(f.pos, radius * 2.2, [0.5 * fade * fade, 0.25 * fade * fade, 0.1 * fade * fade], null, 16);
      } else this.#disc(f.pos, f.size * (1 + k * 2), f.color.map(v => v * (1 - k) * 1.5));
    }
    this.fx = this.fx.filter(f => f.t < f.life);
    for (const s of this.sparks) {
      s.t += dt; s.pos = s.pos.map((v, i) => v + s.vel[i] * dt);
      const fade = Math.max(0, 1 - s.t / s.life);
      this.#line(s.pos, s.pos.map((v, i) => v - s.vel[i] * 0.06), s.color.map(v => v * fade), [0, 0, 0]);
    }
    this.sparks = this.sparks.filter(s => s.t < s.life);

    // The gunnery fan: two edges and an arc that close in as the broadside steadies.
    const me = world.playerShip, aim = world.aim, at = poses.get(me.id)?.pos ?? me.body.position;
    if (aim.side && aim.dir) {
      const cone = world.aimCone(), range = me.battery.def.range, base = Math.atan2(aim.dir[1], aim.dir[0]), steady = aim.t >= 1;
      const col = steady ? [1, 0.95, 0.6] : [0.9 * (0.4 + aim.t * 0.5), 0.6 * (0.4 + aim.t * 0.5), 0.2], dim = col.map(v => v * 0.15);
      const pt = (a, d) => [at[0] + Math.cos(a) * d, 0, at[2] + Math.sin(a) * d];
      this.#line(pt(base - cone, me.radius), pt(base - cone, range), dim, col); this.#line(pt(base + cone, me.radius), pt(base + cone, range), dim, col);
      for (let i = 0; i < 12; i++) { const a = base - cone + cone * 2 * i / 12, b = base - cone + cone * 2 * (i + 1) / 12; this.#line(pt(a, range), pt(b, range), col, col); this.#line(pt(a, range * 0.5), pt(b, range * 0.5), dim, dim); }
    }
    // Dust streaks give a sense of speed; warp stretches them.
    const v = me.body.velocity, speed = Math.hypot(v[0], v[2]), streak = Math.min(0.06, 60 / Math.max(1, speed));
    for (const d of this.dust) {
      const p = [0, 1, 2].map(i => cp[i] + ((((d[i] - cp[i]) % 300) + 300) % 300) - 150);
      const tail = speed > 4 ? [p[0] - v[0] * streak, p[1], p[2] - v[2] * streak] : [p[0] + 0.25, p[1], p[2]], b = Math.min(0.6, 0.16 + speed / 900);
      this.#line(p, tail, me.warp.state === 'on' ? [0.3, 0.6, 0.9] : [b, b, b * 1.2], [0, 0, 0]);
    }

    // Draw passes.
    r.begin([0, 0, 0], cam.q, {fog: 0});
    this.vp = multiplyMatrices(perspective(FOV, this.canvas.width / this.canvas.height), viewMatrix([0, 0, 0], cam.q));
    gl.depthMask(false);
    this.environment.drawSky(this.vp); gl.useProgram(r.program);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    r.draw(this.sky.small);
    gl.uniform1f(r.pointSize, Math.max(2, (globalThis.devicePixelRatio || 1) * 2.4)); r.draw(this.sky.big);
    gl.disable(gl.BLEND); gl.depthMask(true);
    this.environment.drawPlanets(this.vp, SECTOR.planets, cam, SECTOR.sun, FAR_SCALE); gl.useProgram(r.program);
    gl.uniform1f(r.fog, 0.000012 / FAR_SCALE); this.far.flush();
    gl.depthMask(false); gl.enable(gl.BLEND); gl.uniform1f(r.fog, 0); this.farGlow.flush();
    gl.disable(gl.BLEND); gl.depthMask(true); gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.uniform1f(r.fog, 0.000012); this.near.flush();
    gl.depthMask(false); gl.enable(gl.BLEND); gl.uniform1f(r.fog, 0); this.nearGlow.flush(); this.lines.flush();
    gl.disable(gl.BLEND); gl.depthMask(true);
    r.end?.();
  }
  dispose() { this.environment.dispose(); this.renderer.dispose(); }
}
