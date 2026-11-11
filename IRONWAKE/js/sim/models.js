// SPDX-License-Identifier: Apache-2.0
import {mods} from '../mod-api.js';
// Procedural geometry for IRONWAKE. Pure data: no DOM, no WebGL.
// Models are flat-shaded triangles in local space: -Z is the bow, +Y is up, +X is starboard.
import {seededRandom} from '../../vendor/vanillajs/modules/math/index.js';

export class Builder {
  constructor() { this.p = []; this.n = []; this.c = []; this.g = []; }
  tri(a, b, c, color, glow = 0, centre = null) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-9) return;
    nx /= len; ny /= len; nz /= len;
    if (centre) {
      const mx = (a[0] + b[0] + c[0]) / 3 - centre[0], my = (a[1] + b[1] + c[1]) / 3 - centre[1], mz = (a[2] + b[2] + c[2]) / 3 - centre[2];
      if (nx * mx + ny * my + nz * mz < 0) { nx = -nx; ny = -ny; nz = -nz; }
    }
    this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    this.n.push(nx, ny, nz); this.c.push(color[0], color[1], color[2]); this.g.push(glow);
  }
  quad(a, b, c, d, color, glow = 0, centre = null) { this.tri(a, b, c, color, glow, centre); this.tri(a, c, d, color, glow, centre); }
  /** Eight corners: p[0..3] one face in order, p[4..7] the matching opposite face. */
  hexa(p, color, glow = 0) {
    const centre = [0, 1, 2].map(i => p.reduce((s, v) => s + v[i], 0) / 8);
    this.quad(p[0], p[1], p[2], p[3], color, glow, centre); this.quad(p[4], p[5], p[6], p[7], color, glow, centre);
    for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; this.quad(p[i], p[j], p[4 + j], p[4 + i], color, glow, centre); }
  }
  box(c, s, color, glow = 0) {
    const [x, y, z] = c, [a, b, d] = [s[0] / 2, s[1] / 2, s[2] / 2];
    this.hexa([[x - a, y - b, z - d], [x + a, y - b, z - d], [x + a, y + b, z - d], [x - a, y + b, z - d],
      [x - a, y - b, z + d], [x + a, y - b, z + d], [x + a, y + b, z + d], [x - a, y + b, z + d]], color, glow);
  }
  /** Skin a row of cross-sections {z,w,h,y?,x?}. Sides >= 3; flat-shaded. */
  loft(sections, sides, color, {capGlow = 0, capColor = null} = {}) {
    const ring = s => {
      const out = [];
      for (let k = 0; k < sides; k++) {
        const a = (k + 0.5) / sides * Math.PI * 2;
        out.push([(s.x ?? 0) + Math.cos(a) * s.w / 2, (s.y ?? 0) + Math.sin(a) * s.h / 2, s.z]);
      }
      return out;
    };
    const rings = sections.map(ring);
    for (let i = 0; i < rings.length - 1; i++) {
      const a = rings[i], b = rings[i + 1];
      const centre = [((sections[i].x ?? 0) + (sections[i + 1].x ?? 0)) / 2, ((sections[i].y ?? 0) + (sections[i + 1].y ?? 0)) / 2, (sections[i].z + sections[i + 1].z) / 2];
      const col = typeof color === 'function' ? color(i) : color;
      for (let k = 0; k < sides; k++) { const j = (k + 1) % sides; this.quad(a[k], a[j], b[j], b[k], col, 0, centre); }
    }
    const cap = (pts, s, zdir, glow) => {
      const centre = [s.x ?? 0, s.y ?? 0, s.z];
      for (let k = 0; k < sides; k++) this.tri(centre, pts[k], pts[(k + 1) % sides], capColor ?? (typeof color === 'function' ? color(0) : color), glow, [centre[0], centre[1], centre[2] - zdir]);
    };
    cap(rings[0], sections[0], -1, 0); cap(rings[rings.length - 1], sections[sections.length - 1], 1, capGlow);
  }
  /** Mirrored tapered slab wing. Root/tip chords are [zFront,zBack]. */
  wing(xRoot, xTip, root, tip, yRoot, yTip, thick, color, mirror = true) {
    for (const m of mirror ? [1, -1] : [1]) {
      const t = thick / 2, tt = thick / 4;
      this.hexa([[m * xRoot, yRoot - t, root[0]], [m * xRoot, yRoot + t, root[0]], [m * xRoot, yRoot + t, root[1]], [m * xRoot, yRoot - t, root[1]],
        [m * xTip, yTip - tt, tip[0]], [m * xTip, yTip + tt, tip[0]], [m * xTip, yTip + tt, tip[1]], [m * xTip, yTip - tt, tip[1]]], color);
    }
  }
  /** Vertical fin in the YZ plane at x. */
  fin(x, yBase, yTop, base, top, thick, color) {
    const t = thick / 2;
    this.hexa([[x - t, yBase, base[0]], [x + t, yBase, base[0]], [x + t, yBase, base[1]], [x - t, yBase, base[1]],
      [x - t / 2, yTop, top[0]], [x + t / 2, yTop, top[0]], [x + t / 2, yTop, top[1]], [x - t / 2, yTop, top[1]]], color);
  }
  cylinder(c, r, h, axis, color, sides = 12, glow = 0) {
    const pt = (a, k) => {
      const u = Math.cos(a) * r, v = Math.sin(a) * r, w = k * h / 2;
      return axis === 1 ? [c[0] + u, c[1] + w, c[2] + v] : axis === 0 ? [c[0] + w, c[1] + u, c[2] + v] : [c[0] + u, c[1] + v, c[2] + w];
    };
    const top = [...c], bottom = [...c]; top[axis] += h / 2; bottom[axis] -= h / 2;
    for (let k = 0; k < sides; k++) {
      const a = k / sides * Math.PI * 2, b = (k + 1) / sides * Math.PI * 2;
      this.quad(pt(a, -1), pt(b, -1), pt(b, 1), pt(a, 1), color, glow, c);
      this.tri(top, pt(a, 1), pt(b, 1), color, glow, c); this.tri(bottom, pt(a, -1), pt(b, -1), color, glow, c);
    }
  }
  /** Torus around `axis` through c. */
  torus(c, R, r, axis, color, segments = 24, sides = 6, colorB = null) {
    const pt = (i, k) => {
      const a = i / segments * Math.PI * 2, b = k / sides * Math.PI * 2, d = R + Math.cos(b) * r, w = Math.sin(b) * r;
      const u = Math.cos(a) * d, v = Math.sin(a) * d;
      return axis === 1 ? [c[0] + u, c[1] + w, c[2] + v] : axis === 0 ? [c[0] + w, c[1] + u, c[2] + v] : [c[0] + u, c[1] + v, c[2] + w];
    };
    for (let i = 0; i < segments; i++) {
      const a = (i + 0.5) / segments * Math.PI * 2, u = Math.cos(a) * R, v = Math.sin(a) * R;
      const centre = axis === 1 ? [c[0] + u, c[1], c[2] + v] : axis === 0 ? [c[0], c[1] + u, c[2] + v] : [c[0] + u, c[1] + v, c[2]];
      const col = colorB && i % 2 ? colorB : color;
      for (let k = 0; k < sides; k++) this.quad(pt(i, k), pt(i + 1, k), pt(i + 1, k + 1), pt(i, k + 1), col, 0, centre);
    }
  }
  sphere(c, r, level, colorAt, displace = null) {
    for (const [a, b, d] of icosphere(level)) {
      const m = v => { const k = r * (displace ? displace(v) : 1); return [c[0] + v[0] * k, c[1] + v[1] * k, c[2] + v[2] * k]; };
      const mid = [(a[0] + b[0] + d[0]) / 3, (a[1] + b[1] + d[1]) / 3, (a[2] + b[2] + d[2]) / 3];
      this.tri(m(a), m(b), m(d), typeof colorAt === 'function' ? colorAt(mid) : colorAt, 0, c);
    }
  }
  build(extra = {}) {
    let radius = 0;
    for (let i = 0; i < this.p.length; i += 3) radius = Math.max(radius, Math.hypot(this.p[i], this.p[i + 1], this.p[i + 2]));
    return {tris: new Float32Array(this.p), normals: new Float32Array(this.n), colors: new Float32Array(this.c),
      glow: new Float32Array(this.g), count: this.g.length, radius, ...extra};
  }
}

const icoCache = new Map();
function icosphere(level) {
  if (icoCache.has(level)) return icoCache.get(level);
  const t = (1 + Math.sqrt(5)) / 2, norm = v => { const l = Math.hypot(...v); return [v[0] / l, v[1] / l, v[2] / l]; };
  const v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(norm);
  let faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]].map(f => f.map(i => v[i]));
  for (let l = 0; l < level; l++) {
    const next = [];
    for (const [a, b, c] of faces) {
      const ab = norm([a[0] + b[0], a[1] + b[1], a[2] + b[2]]), bc = norm([b[0] + c[0], b[1] + c[1], b[2] + c[2]]), ca = norm([c[0] + a[0], c[1] + a[1], c[2] + a[2]]);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = next;
  }
  icoCache.set(level, faces);
  return faces;
}

/** Smooth-ish deterministic lattice noise on a direction/position, in 0..1. */
export function noise3(x, y, z, seed = 0) {
  const h = (i, j, k) => {
    let n = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k, 2147483647) ^ Math.imul(seed + 1, 1274126177);
    n = Math.imul(n ^ n >>> 13, 1274126177); return ((n ^ n >>> 16) >>> 0) / 4294967296;
  };
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), fx = x - xi, fy = y - yi, fz = z - zi;
  const s = t => t * t * (3 - 2 * t), u = s(fx), v = s(fy), w = s(fz), l = (a, b, t) => a + (b - a) * t;
  return l(l(l(h(xi, yi, zi), h(xi + 1, yi, zi), u), l(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), u), v),
    l(l(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), u), l(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), u), v), w);
}

const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const GLASS = [0.3, 0.65, 0.9], DARK = [0.15, 0.16, 0.19], STEEL = [0.44, 0.47, 0.52], HULL = [0.58, 0.6, 0.64], NOZZLE = [0.1, 0.1, 0.12];

// Capital hull proportions by class: length, beam, height.
const FRAMES = {barracuda: [28, 8, 5], cutter: [38, 11, 7], corvette: [52, 14, 9], frigate: [70, 19, 12], dreadnought: [94, 26, 16]};
const cache = new Map();
const cached = (key, make) => { if (!cache.has(key)) cache.set(key, make()); return cache.get(key); };
const tintKey = trim => trim.map(v => v.toFixed(2)).join(',');

/** A broadside warship. Returns the model plus gunports {port, star}, turret mounts and engines. */
export function capitalModel(cls, cannons, turrets, trim) {
  return cached(`cap:${cls}:${cannons}:${turrets}:${tintKey(trim)}`, () => {
    const [L, B, H] = FRAMES[cls], b = new Builder(), t2 = mul(trim, 0.7), z0 = -L / 2;
    b.loft([{z: z0, w: B * 0.08, h: H * 0.2, y: H * 0.1}, {z: z0 + L * 0.16, w: B * 0.55, h: H * 0.7}, {z: z0 + L * 0.36, w: B, h: H}, {z: z0 + L * 0.8, w: B, h: H},
      {z: z0 + L * 0.94, w: B * 0.8, h: H * 0.85}, {z: z0 + L, w: B * 0.6, h: H * 0.6}], 8, i => (i === 1 ? trim : i === 3 ? STEEL : HULL));
    b.box([0, -H * 0.55, L * 0.05], [B * 0.16, H * 0.5, L * 0.5], DARK); // keel
    b.box([0, H * 0.56, L * 0.12], [B * 0.62, H * 0.2, L * 0.46], STEEL); // deckhouse
    b.box([0, H * 0.86, L * 0.2], [B * 0.36, H * 0.44, L * 0.16], HULL); b.box([0, H * 1.0, L * 0.165], [B * 0.4, H * 0.14, L * 0.1], GLASS); // bridge
    b.box([0, H * 1.22, L * 0.24], [B * 0.05, H * 0.36, B * 0.05], DARK); // mast
    const ports = {port: [], star: []}, span = L * 0.5, zs = Array.from({length: cannons}, (_, i) => z0 + L * 0.3 + (cannons > 1 ? span * i / (cannons - 1) : span / 2));
    for (const m of [1, -1]) {
      b.box([m * B * 0.52, -H * 0.05, z0 + L * 0.55], [B * 0.14, H * 0.42, span + L * 0.1], t2); // gun deck sponson
      for (const z of zs) { b.box([m * (B * 0.6 + 0.6), -H * 0.05, z], [1.6, H * 0.14, H * 0.14], DARK); (m > 0 ? ports.star : ports.port).push([m * (B * 0.6 + 1.6), -H * 0.05, z]); }
    }
    const mounts = [];
    for (let i = 0; i < turrets; i++) {
      const fore = i % 2 === 0, k = Math.floor(i / 2), z = fore ? z0 + L * (0.3 - k * 0.07) : z0 + L * (0.72 + k * 0.06), y = H * (fore ? 0.5 : 0.56), r = Math.max(0.9, B * 0.085);
      const x = k % 2 ? (fore ? B * 0.2 : -B * 0.2) : 0;
      b.cylinder([x, y + r * 0.5, z], r, r, 1, trim, 8); b.box([x, y + r * 0.6, z - r * 1.3], [r * 0.3, r * 0.3, r * 1.8], DARK);
      mounts.push([x, y + r, z]);
    }
    const engines = [], n = cls === 'barracuda' || cls === 'cutter' ? 2 : cls === 'dreadnought' ? 4 : 3, r = H * (n > 3 ? 0.2 : 0.24);
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * B * (n > 3 ? 0.2 : 0.26), z = z0 + L;
      b.loft([{x, z: z - r * 2, w: r * 1.7, h: r * 1.7}, {x, z: z + r, w: r * 2.1, h: r * 2.1}], 8, NOZZLE, {capGlow: 1, capColor: [0.6, 0.85, 1]});
      engines.push([x, 0, z + r, r]);
    }
    return b.build({ports, mounts, engines});
  });
}
export function craftModel(trim) {
  return cached(`craft:${tintKey(trim)}`, () => {
    const b = new Builder();
    b.loft([{z: -6, w: 0.3, h: 0.25}, {z: -3, w: 1.6, h: 1.1}, {z: 2.6, w: 2.0, h: 1.3}, {z: 4.2, w: 1.2, h: 0.9}], 6, i => (i === 1 ? trim : HULL), {capGlow: 1, capColor: [0.6, 0.85, 1]});
    b.wing(0.8, 5.4, [-0.6, 3.4], [2.2, 3.8], 0, -0.3, 0.3, mul(trim, 0.7)); b.fin(0, 0.5, 2.2, [1.4, 3.8], [3, 4], 0.2, trim);
    b.loft([{z: -3, w: 0.7, h: 0.5, y: 0.5}, {z: -1.6, w: 1.0, h: 0.8, y: 0.75}, {z: 0, w: 0.7, h: 0.4, y: 0.7}], 5, GLASS);
    return b.build({engines: [[0, 0, 4.4, 0.6]], ports: {port: [], star: []}, mounts: [[0, 0, -5]]});
  });
}
export function haulerModel(trim) {
  return cached(`hauler:${tintKey(trim)}`, () => {
    const b = new Builder(), L = 58;
    b.loft([{z: -L / 2, w: 5, h: 4, y: 1}, {z: -L / 2 + 8, w: 10, h: 8}, {z: -L / 2 + 13, w: 6, h: 5}, {z: L / 2 - 8, w: 6, h: 5}, {z: L / 2, w: 11, h: 9}], 6, i => (i === 0 || i === 3 ? HULL : STEEL));
    b.box([0, 5.4, -L / 2 + 9], [6, 2.4, 5], GLASS);
    for (let k = 0; k < 4; k++) { const z = -L / 2 + 19 + k * 9; b.box([0, 0, z], [20, 13, 7.6], k % 2 ? mul(trim, 0.75) : trim); b.box([0, 0, z], [21, 2, 6], DARK); b.box([0, 0, z], [2.4, 14, 6], DARK); }
    const engines = [[-3.2, 2, L / 2 + 2, 1.9], [3.2, 2, L / 2 + 2, 1.9], [-3.2, -2, L / 2 + 2, 1.9], [3.2, -2, L / 2 + 2, 1.9]];
    for (const [x, y, z, r] of engines) b.loft([{x, y, z: z - 4, w: r * 1.7, h: r * 1.7}, {x, y, z, w: r * 2.1, h: r * 2.1}], 8, NOZZLE, {capGlow: 1, capColor: [0.6, 0.85, 1]});
    b.cylinder([0, 5.4, -L / 2 + 15], 1.3, 1.3, 1, trim, 8); b.cylinder([0, 5.6, L / 2 - 5], 1.3, 1.3, 1, trim, 8);
    return b.build({engines, ports: {port: [], star: []}, mounts: [[0, 6.4, -L / 2 + 15], [0, 6.6, L / 2 - 5]]});
  });
}
/** Model for any vessel class in data.js. */
export function vesselModel(cls, cannons, turrets, trim) {
  return mods.model(cls, {Builder, trim, cannons, turrets, base: (id, color = trim) => builtinVesselModel(id, cannons, turrets, color)}, () => builtinVesselModel(cls, cannons, turrets, trim));
}
function builtinVesselModel(cls, cannons, turrets, trim) {
  return cls === 'skate' ? craftModel(trim) : cls === 'drover' ? haulerModel(trim) : capitalModel(cls, cannons, turrets, trim);
}
/** A dead hulk for wreck fields. */
export function wreckModel(variant) {
  return cached(`wreck:${variant}`, () => {
    const b = new Builder(), L = 60 + variant * 14, B = 16 + variant * 3, H = 10 + variant * 2, rust = [0.3, 0.24, 0.2], char = [0.13, 0.12, 0.12];
    b.loft([{z: -L / 2, w: B * 0.2, h: H * 0.3}, {z: -L * 0.2, w: B, h: H}, {z: L * 0.12, w: B * 0.9, h: H * 0.9}], 7, i => (i ? rust : char));
    b.loft([{z: L * 0.2, w: B * 0.85, h: H * 0.8, x: B * 0.3, y: -H * 0.2}, {z: L / 2, w: B * 0.6, h: H * 0.6, x: B * 0.5, y: -H * 0.5}], 7, char);
    b.box([0, H * 0.6, -L * 0.05], [B * 0.4, H * 0.5, L * 0.14], rust); b.box([B * 0.7, 0, L * 0.02], [B * 0.5, 1, L * 0.2], char);
    return b.build();
  });
}

// Stations: parts are axis-aligned so their solid boxes double as colliders. Docking is on the plane (y = 0).
const stationSpecs = {
  citadel: [
    {t: 'cyl', c: [0, 0, 0], r: 80, h: 520, axis: 1, col: 'hull', solid: 0.76},
    {t: 'cyl', c: [0, 190, 0], r: 250, h: 44, axis: 1, col: 'trim'}, {t: 'cyl', c: [0, 232, 0], r: 150, h: 40, axis: 1, col: 'hull'},
    {t: 'cyl', c: [0, -180, 0], r: 210, h: 40, axis: 1, col: 'steel'}, {t: 'cyl', c: [0, -300, 0], r: 30, h: 120, axis: 1, col: 'dark'},
    {t: 'box', c: [0, 0, 0], s: [560, 26, 40], col: 'steel', solid: true}, {t: 'box', c: [0, 0, 0], s: [40, 26, 560], col: 'steel', solid: true},
    {t: 'box', c: [300, 0, 0], s: [70, 50, 110], col: 'trim', solid: true}, {t: 'box', c: [-300, 0, 0], s: [70, 50, 110], col: 'trim', solid: true},
    {t: 'box', c: [0, 0, 300], s: [110, 50, 70], col: 'trim', solid: true}, {t: 'box', c: [0, 0, -300], s: [110, 50, 70], col: 'trim', solid: true},
    {t: 'box', c: [0, 300, 0], s: [10, 110, 10], col: 'dark'},
    {t: 'light', c: [344, 0, 0], col: [0.3, 1, 0.5]}, {t: 'light', c: [-344, 0, 0], col: [0.3, 1, 0.5]}, {t: 'light', c: [0, 0, 344], col: [0.3, 1, 0.5]}, {t: 'light', c: [0, 0, -344], col: [0.3, 1, 0.5]},
    {t: 'light', c: [0, 360, 0], col: [1, 0.3, 0.3]},
  ],
  exchange: [
    {t: 'torus', c: [0, 0, 0], R: 300, r: 34, axis: 1, col: 'hull', colB: 'trim', solid: true},
    {t: 'cyl', c: [0, 0, 0], r: 70, h: 260, axis: 1, col: 'steel', solid: 0.76}, {t: 'cyl', c: [0, 150, 0], r: 110, h: 40, axis: 1, col: 'trim'},
    {t: 'box', c: [0, 60, 0], s: [600, 14, 22], col: 'dark'}, {t: 'box', c: [0, 60, 0], s: [22, 14, 600], col: 'dark'},
    {t: 'box', c: [0, -150, 0], s: [14, 80, 14], col: 'dark'}, {t: 'box', c: [370, 0, 0], s: [80, 40, 60], col: 'trim', solid: true}, {t: 'box', c: [-370, 0, 0], s: [80, 40, 60], col: 'trim', solid: true},
    {t: 'light', c: [416, 0, 0], col: [0.3, 1, 0.5]}, {t: 'light', c: [-416, 0, 0], col: [0.3, 1, 0.5]}, {t: 'light', c: [0, 180, 0], col: [1, 0.85, 0.4]}, {t: 'light', c: [0, -196, 0], col: [1, 0.3, 0.3]},
  ],
  works: [
    {t: 'rock', c: [0, -40, 0], r: 250, seed: 7, solid: 0.6},
    {t: 'box', c: [210, 20, 60], s: [200, 90, 130], col: 'hull', solid: true}, {t: 'cyl', c: [230, 110, 60], r: 40, h: 100, axis: 1, col: 'trim'}, {t: 'cyl', c: [160, 100, 90], r: 22, h: 150, axis: 1, col: 'dark'},
    {t: 'box', c: [-60, 230, -40], s: [80, 120, 80], col: 'steel'}, {t: 'box', c: [-60, 300, -40], s: [8, 60, 8], col: 'dark'},
    {t: 'box', c: [40, 0, 290], s: [110, 60, 110], col: 'trim', solid: true}, {t: 'box', c: [40, 0, 366], s: [60, 30, 50], col: 'dark', solid: true},
    {t: 'light', c: [40, 0, 398], col: [0.3, 1, 0.5]}, {t: 'light', c: [-60, 336, -40], col: [1, 0.3, 0.3]}, {t: 'light', c: [316, 20, 60], col: [1, 0.85, 0.4]},
  ],
  reef: [
    {t: 'rock', c: [0, 30, 0], r: 200, seed: 23, solid: 0.6},
    {t: 'box', c: [-250, 0, 60], s: [150, 60, 320], col: 'dark', solid: true}, {t: 'box', c: [-250, 44, 120], s: [70, 40, 90], col: 'hull'},
    {t: 'box', c: [240, -10, -80], s: [130, 50, 280], col: 'steel', solid: true}, {t: 'box', c: [240, 30, -30], s: [60, 40, 70], col: 'trim'},
    {t: 'box', c: [0, 0, -280], s: [300, 30, 60], col: 'trim', solid: true}, {t: 'box', c: [0, 220, 0], s: [60, 90, 60], col: 'steel'}, {t: 'box', c: [0, 280, 0], s: [8, 60, 8], col: 'dark'},
    {t: 'light', c: [0, 0, -316], col: [0.3, 1, 0.5]}, {t: 'light', c: [0, 316, 0], col: [1, 0.3, 0.3]}, {t: 'light', c: [-250, 70, 120], col: [1, 0.5, 0.2]}, {t: 'light', c: [240, 56, -30], col: [1, 0.5, 0.2]},
  ],
};
export const STATION_RADIUS = {citadel: 380, exchange: 430, works: 420, reef: 400};

/** Solid AABBs ({c,s}) of a station archetype in local space. */
export function stationBoxes(kind) {
  const out = [];
  for (const part of stationSpecs[kind]) {
    if (!part.solid) continue;
    if (part.t === 'box') out.push({c: part.c, s: part.s});
    else if (part.t === 'cyl') { const d = part.r * 2 * part.solid, s = [d, d, d]; s[part.axis] = part.h; out.push({c: part.c, s}); }
    else if (part.t === 'rock') { const d = part.r * 2 * part.solid; out.push({c: part.c, s: [d, d, d]}); }
    else if (part.t === 'torus') {
      const n = 14, d = part.r * 1.7;
      for (let i = 0; i < n; i++) {
        const a = (i + 0.5) / n * Math.PI * 2, w = 2 * Math.PI * part.R / n * 0.9, s = [w, d, w];
        out.push({c: [part.c[0] + Math.cos(a) * part.R, part.c[1], part.c[2] + Math.sin(a) * part.R], s});
      }
    }
  }
  return out;
}
export const stationLights = kind => stationSpecs[kind].filter(p => p.t === 'light');
export function stationModel(kind, trim) {
  return cached(`station:${kind}:${tintKey(trim)}`, () => {
    const b = new Builder(), palette = {hull: [0.6, 0.62, 0.66], steel: [0.42, 0.45, 0.5], dark: [0.2, 0.21, 0.25], trim: mul(trim, 0.85)};
    for (const part of stationSpecs[kind]) {
      const col = palette[part.col];
      if (part.t === 'box') b.box(part.c, part.s, col);
      else if (part.t === 'cyl') b.cylinder(part.c, part.r, part.h, part.axis, col, 16);
      else if (part.t === 'torus') b.torus(part.c, part.R, part.r, part.axis, col, 32, 6, part.colB ? palette[part.colB] : null);
      else if (part.t === 'rock') rock(b, part.c, part.r, part.seed, 2, 0);
    }
    return b.build();
  });
}

function rock(b, c, r, seed, level, rich) {
  const tone = 0.75 + (seed % 5) * 0.05;
  b.sphere(c, r, level, v => {
    const n = noise3(v[0] * 3 + 9, v[1] * 3, v[2] * 3, seed), k = 0.26 + 0.2 * n;
    return rich && n > 0.62 ? [0.35, 0.75, 0.9] : [k * tone * 1.12, k * tone, k * tone * 0.9];
  }, v => 0.72 + 0.5 * noise3(v[0] * 1.6, v[1] * 1.6 + 5, v[2] * 1.6, seed));
}
/** Six unit-radius asteroid variants. detail 1 near, 0 far; rich rocks show crystal veins. */
export function rockModels(detail = 1, rich = false) {
  return cached(`rocks:${detail}:${rich}`, () => [11, 23, 37, 41, 59, 67].map(seed => { const b = new Builder(); rock(b, [0, 0, 0], 1, seed, detail, rich); return b.build(); }));
}
const PALETTES = {
  gas: v => { const n = noise3(v[0] * 0.8, v[1] * 7, v[2] * 0.8, 21); return n > 0.5 ? [0.82, 0.55, 0.36] : [0.6, 0.34 + n * 0.2, 0.3]; },
  ice: v => { const n = noise3(v[0] * 3, v[1] * 3, v[2] * 3, 13); return [0.6 + n * 0.3, 0.75 + n * 0.2, 0.92]; },
};
export const planetModel = palette => cached(`planet:${palette}`, () => { const b = new Builder(); b.sphere([0, 0, 0], 1, 3, PALETTES[palette]); return b.build(); });
export const crateModel = () => cached('crate', () => { const b = new Builder(); b.box([0, 0, 0], [3.4, 3.4, 4.6], [0.7, 0.6, 0.3]); b.box([0, 0, 0], [3.8, 0.7, 3.2], [0.25, 0.25, 0.3]); return b.build(); });
export const torpedoModel = () => cached('torpedo', () => {
  const b = new Builder();
  b.loft([{z: -4, w: 0.2, h: 0.2}, {z: -2.4, w: 1.2, h: 1.2}, {z: 3.4, w: 1.2, h: 1.2}], 6, [0.85, 0.85, 0.8], {capGlow: 1, capColor: [1, 0.7, 0.3]});
  b.wing(0.4, 1.8, [1.8, 3.4], [2.6, 3.6], 0, 0, 0.16, [0.8, 0.2, 0.2]);
  return b.build();
});

/** Deterministic scatter for a field: [{pos:[x,y,z], radius, variant, q}]. */
export function scatterField(field, seed) {
  const rng = seededRandom(seed), out = [], wrecks = field.kind === 'wrecks', count = Math.round((wrecks ? 0.9 : 5.2 * field.density) * (field.radius / 1000) ** 2);
  for (let i = 0; i < count; i++) {
    const a = rng() * Math.PI * 2, d = Math.sqrt(rng()) * field.radius, radius = wrecks ? 40 + rng() * 26 : 12 + rng() * rng() * 80;
    const q = wrecks ? [(rng() - 0.5) * 0.5, rng() - 0.5, (rng() - 0.5) * 0.5, rng() - 0.5] : [rng() - 0.5, rng() - 0.5, rng() - 0.5, rng() - 0.5], l = Math.hypot(...q) || 1;
    out.push({pos: [field.pos[0] + Math.cos(a) * d, (rng() - 0.5) * radius * 0.5, field.pos[1] + Math.sin(a) * d], radius, variant: Math.floor(rng() * (wrecks ? 3 : 6)), q: q.map(v => v / l), wreck: wrecks});
  }
  return out;
}
