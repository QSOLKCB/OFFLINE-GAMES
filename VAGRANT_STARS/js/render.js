// SPDX-License-Identifier: Apache-2.0
import {detailedModel} from '../../shared/surface-detail.js';
// Scene presentation for VAGRANT STARS on the VANILLAJS render-webgl module.
// The module draws world-space coloured vertices with one camera, so every object is
// transformed and flat-lit on the CPU each frame and streamed into a few dynamic meshes.
// Distant objects are drawn first in a uniformly shrunken "far" pass (same image, far better
// depth precision), then the depth buffer is cleared and nearby objects are drawn at 1:1.
import {Environment as WebGLEnvironment, unitCircle} from './environment.js';
import {Renderer as SoftwareRenderer, Environment as SoftwareEnvironment, mountGraphics} from '../../shared/presentation.js';
import {Renderer} from '../vendor/vanillajs/modules/render-webgl/index.js';
import {rotate, perspective, viewMatrix, multiplyMatrices, seededRandom} from '../vendor/vanillajs/modules/math/index.js';
import {FACTIONS} from './sim/data.js';
import {shipModel, stationModel, stationLights, rockModels, gateModel, laneRingModel, podModel, missileModel} from './sim/models.js';

export const FOV = Math.PI / 2.6;
const FAR_SCALE = 1 / 130, NEAR_LIMIT = 1150;
const IDENTITY = [0, 0, 0, 1];
const hashText = text => { let h = 2166136261; for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619); return h >>> 0; };

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
    this.sky = null; this.fx = []; this.sparks = []; this.trails = new Map();
    const rng = seededRandom(99);
    this.dust = Array.from({length: 150}, () => [rng() * 300, rng() * 300, rng() * 300]);
    this.cam = {pos: [0, 0, 0], q: [0, 0, 0, 1]}; this.right = [1, 0, 0]; this.up = [0, 1, 0]; this.vp = null; this.light = [0, 1, 0];
    this.tint = [1, 1, 1]; this.time = 0;
  }

  /** Rebuild the static sky for a star system. */
  setSystem(system) {
    const r = this.renderer, rng = seededRandom(hashText(system.id) || 1);
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
    this.environment.configure(hashText(system.id), system.sky, system.planets);
    this.tint = system.star.color.map(v => 0.55 + v * 0.45);
    this.fx = []; this.sparks = []; this.trails.clear();
  }

  /** Visual-only reactions to simulation events. */
  onEvent(e) {
    if (e.type === 'explode') {
      this.fx.push({kind: 'boom', pos: [...e.pos], vel: e.vel ?? [0, 0, 0], t: 0, life: 0.9 + e.size * 0.08, size: e.size});
      const rng = seededRandom((this.time * 1000) | 1), n = Math.min(40, 10 + e.size * 3);
      for (let i = 0; i < n; i++) {
        const v = [rng() - 0.5, rng() - 0.5, rng() - 0.5], l = Math.hypot(...v) || 1, sp = (30 + rng() * 120) * (0.5 + e.size * 0.08);
        this.sparks.push({pos: [...e.pos], vel: v.map((x, j) => x / l * sp + (e.vel?.[j] ?? 0)), t: 0, life: 0.5 + rng() * 1.1, color: [1, 0.6 + rng() * 0.3, 0.25]});
      }
    } else if (e.type === 'hit') this.fx.push({kind: 'flash', pos: [...e.pos], t: 0, life: 0.16, size: e.shield ? 3.2 : 2.2, color: e.shield ? [0.35, 0.6, 1] : e.color});
    else if (e.type === 'spark') this.fx.push({kind: 'flash', pos: [...e.pos], t: 0, life: 0.14, size: 1.8, color: [1, 0.8, 0.5]});
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
    const r = this.renderer, gl = this.gl, sys = world.system, sector = world.sector;
    this.time += dt; this.cam = cam;
    this.right = rotate(cam.q, [1, 0, 0]); this.up = rotate(cam.q, [0, 1, 0]); this.fwd = rotate(cam.q, [0, 0, -1]);
    const toStar = [sys.star.pos[0] - cam.pos[0], sys.star.pos[1] - cam.pos[1], sys.star.pos[2] - cam.pos[2]], sl = Math.hypot(...toStar);
    this.light = toStar.map(v => v / sl);
    const nebula = world.zoneAt(cam.pos, 'nebula');
    let haze = 0;
    if (nebula) { const d = Math.hypot(cam.pos[0] - nebula.pos[0], cam.pos[1] - nebula.pos[1], cam.pos[2] - nebula.pos[2]); haze = nebula.density * Math.min(1, (nebula.radius - d) / 1500); }
    const fogNear = 0.000012 + haze * 0.0011;
    for (const s of [this.far, this.near, this.farGlow, this.nearGlow, this.lines]) s.reset();
    const blink = 0.55 + 0.45 * Math.sin(this.time * 4), t = world.time;

    // Planets, star, stations, gates, rings, rocks.
    const sc = sys.star.color;
    this.#disc(sys.star.pos, sys.star.radius * 5.5, sc.map(v => v * 0.5), true, 28);
    this.#disc(sys.star.pos, sys.star.radius * 1.5, [1, 1, 1], true, 28, 2.2);
    for (const poi of sector.pois) {
      if (poi.type === 'base') {
        this.#model(stationModel(poi.def.kind, FACTIONS[poi.faction].color), poi.pos, IDENTITY, 1);
        for (const light of stationLights(poi.def.kind)) this.#disc([poi.pos[0] + light.c[0], poi.pos[1] + light.c[1], poi.pos[2] + light.c[2]], 16, light.col.map(v => v * blink));
      } else if (poi.type === 'gate') {
        this.#model(gateModel(), poi.pos, poi.q, 1);
        const pulse = 0.6 + 0.25 * Math.sin(this.time * 2.2);
        this.#disc(poi.pos, 160, [0.25 * pulse, 0.55 * pulse, 1.0 * pulse], null, 20, 1.4);
        this.#disc(poi.pos, 60, [0.8, 0.9, 1], null, 12);
      } else {
        this.#model(laneRingModel(), poi.pos, poi.lane.q, 1);
        this.#disc(poi.pos, 30, [0.15 * blink, 0.7 * blink, 0.9 * blink]);
      }
    }
    // Lit port approaches give nearby stations scale and a clear arrival corridor.
    for (const port of sector.pois.filter(p => p.type === 'base')) {
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
    // OPT-REDUCE-001: cull rocks by distance before any vertex work, and thin distant ones.
    const rocks = rockModels(1), rocksFar = rockModels(0), cp = cam.pos;
    for (const rock of sector.rocks) {
      const dx = rock.pos[0] - cp[0], dy = rock.pos[1] - cp[1], dz = rock.pos[2] - cp[2], d2 = dx * dx + dy * dy + dz * dz, reach = 5600 + rock.radius * 60;
      if (d2 > reach * reach) continue;
      this.#model((d2 > 1800 * 1800 ? rocksFar : rocks)[rock.variant], rock.pos, rock.q, rock.radius);
    }

    // Ships and their engines.
    for (const ship of world.ships) {
      if (!ship.alive) continue;
      const pose = poses.get(ship.id); if (!pose) continue;
      const model = shipModel(ship.hullId, ship.isPlayer ? [0.85, 0.87, 0.92] : FACTIONS[ship.faction].color);
      this.#model(model, pose.pos, pose.q, 1, ship.flash > 0 && ship.shield <= 0 ? ship.flash * 1.6 : 0);
      const speed = Math.hypot(...ship.body.velocity), power = ship.lane ? 3 : ship.cruise.state === 'on' ? 2.4 : ship.burning ? 1.7 : 0.25 + Math.min(1, speed / ship.hull.speed) * 0.8;
      const flick = 0.85 + 0.15 * Math.sin(this.time * 40 + ship.id);
      for (const e of model.engines) {
        const a = rotate(pose.q, [e[0], e[1], e[2]]).map((v, i) => v + pose.pos[i]), b = rotate(pose.q, [e[0], e[1], e[2] + e[3] * 7 * power * flick]).map((v, i) => v + pose.pos[i]);
        const hot = ship.cruise.state === 'on' || ship.lane ? [0.5, 0.75, 1] : ship.burning ? [1, 0.75, 0.45] : [0.45, 0.7, 1];
        this.#beam(a, b, e[3] * 0.9, hot, [0, 0, 0]); this.#disc(a, e[3] * 1.8, hot.map(v => v * 0.8));
      }
      if (ship.flash > 0 && ship.shield > 0) this.#ring(pose.pos, ship.radius * 1.9, [0.12, 0.35, 0.8].map(v => v * ship.flash * 3));
      if (ship.cruise.state === 'charging') this.#ring(pose.pos, ship.radius * (3.4 - ship.cruise.t * 0.5), [0.2, 0.5, 0.9].map(v => v * 0.5));
    }
    // Bolts, missiles, loot.
    for (const bolt of world.bolts.values()) {
      const age = t - bolt.t0 + extra, a = [bolt.pos[0] + bolt.vel[0] * age, bolt.pos[1] + bolt.vel[1] * age, bolt.pos[2] + bolt.vel[2] * age];
      const k = (bolt.heavy ? 0.034 : 0.028), b = [a[0] - bolt.vel[0] * k, a[1] - bolt.vel[1] * k, a[2] - bolt.vel[2] * k];
      this.#beam(a, b, bolt.heavy ? 1.3 : 0.8, bolt.color, bolt.color.map(v => v * 0.25)); this.#disc(a, bolt.heavy ? 3.6 : 2.4, bolt.color, null, 8, 1.6);
    }
    for (const m of world.missiles) {
      const pos = [m.pos[0] + m.dir[0] * m.speed * extra, m.pos[1] + m.dir[1] * m.speed * extra, m.pos[2] + m.dir[2] * m.speed * extra];
      const heading = Math.atan2(-m.dir[0], -m.dir[2]) / 2, pitch = Math.asin(Math.max(-1, Math.min(1, m.dir[1]))) / 2;
      const qy = [0, Math.sin(heading), 0, Math.cos(heading)], qx = [Math.sin(pitch), 0, 0, Math.cos(pitch)];
      const q = [qy[3] * qx[0], qy[1] * qx[3], -qy[1] * qx[0], qy[3] * qx[3]];
      this.#model(missileModel(), pos, q, 1.4);
      this.#beam(pos, [pos[0] - m.dir[0] * 26, pos[1] - m.dir[1] * 26, pos[2] - m.dir[2] * 26], 0.8, [1, 0.7, 0.3], [0, 0, 0]); this.#disc(pos, 3, [1, 0.6, 0.2]);
    }
    for (const l of world.loot) {
      const a = this.time * 1.3 + l.id;
      this.#model(podModel(), l.pos, [Math.sin(a) * 0.5, Math.cos(a * 0.7) * 0.5, 0.3, 0.64], 1);
      this.#disc(l.pos, 5, [0.9 * blink, 0.75 * blink, 0.2 * blink]);
    }
    // Explosions, flashes and sparks.
    for (const f of this.fx) {
      f.t += dt; const k = f.t / f.life;
      if (f.kind === 'boom') {
        f.pos = f.pos.map((v, i) => v + f.vel[i] * dt * 0.4);
        const fade = Math.max(0, 1 - k), radius = f.size * (2 + k * 9);
        this.#disc(f.pos, radius, [1.6 * fade, (1.1 - k * 0.7) * fade, (0.7 - k * 0.7) * Math.max(0, fade)], null, 16, 1.3);
        this.#disc(f.pos, radius * 2.2, [0.5 * fade * fade, 0.25 * fade * fade, 0.1 * fade * fade], null, 16);
      } else this.#disc(f.pos, f.size * (1 + k * 2), f.color.map(v => v * (1 - k) * 1.5));
    }
    this.fx = this.fx.filter(f => f.t < f.life);
    for (const s of this.sparks) {
      s.t += dt; s.pos = s.pos.map((v, i) => v + s.vel[i] * dt);
      const fade = Math.max(0, 1 - s.t / s.life), tail = s.pos.map((v, i) => v - s.vel[i] * 0.05);
      this.#line(s.pos, tail, s.color.map(v => v * fade), [0, 0, 0]);
    }
    this.sparks = this.sparks.filter(s => s.t < s.life);
    // Dust streaks give a sense of speed.
    const me = world.playerShip, v = me.body.velocity, speed = Math.hypot(...v), streak = Math.min(0.05, 46 / Math.max(1, speed));
    for (const d of this.dust) {
      const p = [0, 1, 2].map(i => cp[i] + ((((d[i] - cp[i]) % 300) + 300) % 300) - 150);
      const tail = speed > 4 ? [p[0] - v[0] * streak, p[1] - v[1] * streak, p[2] - v[2] * streak] : [p[0] + 0.25, p[1], p[2]];
      const b = Math.min(0.5, 0.16 + speed / 900);
      this.#line(p, tail, [b, b, b * 1.2], [0, 0, 0]);
    }
    // Slingway ride tunnel.
    if (me.lane && poses.has(me.id)) for (let i = 0; i < 6; i++) {
      const pose = poses.get(me.id), a = this.time * 9 + i * 1.05, off = rotate(pose.q, [Math.cos(a) * 14, Math.sin(a) * 14, -20]);
      const p = pose.pos.map((x, j) => x + off[j]), q = p.map((x, j) => x - v[j] * 0.035);
      this.#line(p, q, [0.3, 0.8, 1], [0, 0, 0]);
    }

    // Draw passes.
    r.begin([0, 0, 0], cam.q, {fog: haze * 0.0028});
    this.vp = multiplyMatrices(perspective(FOV, this.canvas.width / this.canvas.height), viewMatrix([0, 0, 0], cam.q));
    gl.depthMask(false);
    this.environment.drawSky(this.vp); gl.useProgram(r.program);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    r.draw(this.sky.small);
    gl.uniform1f(r.pointSize, Math.max(2, (globalThis.devicePixelRatio || 1) * 2.4)); r.draw(this.sky.big);
    gl.disable(gl.BLEND); gl.depthMask(true);
    this.environment.drawPlanets(this.vp, sys.planets, cam, sys.star, FAR_SCALE); gl.useProgram(r.program);
    gl.uniform1f(r.fog, fogNear / FAR_SCALE); this.far.flush();
    gl.depthMask(false); gl.enable(gl.BLEND); gl.uniform1f(r.fog, 0); this.farGlow.flush();
    gl.disable(gl.BLEND); gl.depthMask(true); gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.uniform1f(r.fog, fogNear); this.near.flush();
    gl.depthMask(false); gl.enable(gl.BLEND); gl.uniform1f(r.fog, 0); this.nearGlow.flush(); this.lines.flush();
    gl.disable(gl.BLEND); gl.depthMask(true);
    return haze;
  }
  dispose() { this.environment.dispose(); this.renderer.dispose(); }
}
