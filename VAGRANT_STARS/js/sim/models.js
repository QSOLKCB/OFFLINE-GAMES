// SPDX-License-Identifier: Apache-2.0
// Procedural geometry for VAGRANT STARS. Pure data: no DOM, no WebGL.
// A model is flat-shaded triangles in local space: -Z is the nose, +Y is up.
// Station layouts are shared with the simulation, which collides against their solid boxes.
import {seededRandom} from '../../vendor/vanillajs/modules/math/index.js';

class Builder {
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
const GLASS = [0.25, 0.6, 0.85], DARK = [0.16, 0.17, 0.2], STEEL = [0.5, 0.53, 0.58], NOZZLE = [0.1, 0.1, 0.12];

const shipCache = new Map();
/** Ship hull tinted with a faction trim colour. Returns model + engines/muzzles hardpoints. */
export function shipModel(hullId, trim = [0.8, 0.8, 0.85]) {
  const key = hullId + ':' + trim.map(v => v.toFixed(2)).join(',');
  if (shipCache.has(key)) return shipCache.get(key);
  const b = new Builder(), hull = [0.62, 0.65, 0.7], t2 = mul(trim, 0.75);
  let engines = [], muzzles = [];
  const engine = (x, y, z, r, len = 2.2) => {
    b.loft([{x, y, z: z - len, w: r * 1.7, h: r * 1.7}, {x, y, z, w: r * 2.1, h: r * 2.1}], 8, NOZZLE, {capGlow: 1, capColor: [0.6, 0.85, 1]});
    engines.push([x, y, z, r]);
  };
  const barrel = (x, y, z, len = 2.4) => { b.box([x, y, z - len / 2], [0.28, 0.28, len], DARK); muzzles.push([x, y, z - len]); };
  if (hullId === 'sparrow') {
    b.loft([{z: -6.2, w: 0.3, h: 0.25}, {z: -3.6, w: 1.5, h: 1.1}, {z: -0.5, w: 2.3, h: 1.7, y: 0.1}, {z: 3.2, w: 2.0, h: 1.5}, {z: 4.6, w: 1.3, h: 1.1}], 6,
      i => (i === 1 ? trim : hull));
    b.loft([{z: -3.4, w: 0.8, h: 0.5, y: 0.55}, {z: -1.9, w: 1.2, h: 0.9, y: 0.85}, {z: 0.2, w: 0.9, h: 0.5, y: 0.8}], 5, GLASS);
    b.wing(0.9, 5.2, [-1.2, 3.6], [1.6, 3.4], 0, -0.25, 0.32, t2);
    b.fin(0, 0.6, 2.4, [1.6, 4.2], [3.2, 4.4], 0.22, trim);
    engine(0, 0, 5.6, 0.62);
    barrel(2.6, -0.2, -0.4); barrel(-2.6, -0.2, -0.4);
  } else if (hullId === 'mule') {
    b.loft([{z: -8, w: 2.6, h: 2.2, y: 0.4}, {z: -5.5, w: 5.2, h: 4.2}, {z: 5.5, w: 5.6, h: 4.6}, {z: 8, w: 4.2, h: 3.6}], 4, i => (i === 1 ? hull : STEEL));
    b.box([0, 2.5, -4.2], [2.6, 1.2, 3], GLASS);
    for (const m of [1, -1]) {
      b.box([m * 4.3, -0.4, 0.5], [2.4, 3.2, 9.5], t2); b.box([m * 4.3, -0.4, -5.2], [2.0, 2.6, 1.6], trim);
      b.box([m * 4.3, 1.5, 0.5], [1.6, 0.5, 8], DARK);
    }
    engine(2.2, 0, 9.4, 1.0, 1.8); engine(-2.2, 0, 9.4, 1.0, 1.8);
    barrel(4.3, -1.6, -5.8); barrel(-4.3, -1.6, -5.8); barrel(0, 2.6, -6.4, 2);
  } else if (hullId === 'kite') {
    b.loft([{z: -7.4, w: 0.25, h: 0.2}, {z: -4.4, w: 1.3, h: 1.0}, {z: -0.6, w: 2.0, h: 1.6, y: 0.1}, {z: 3.6, w: 1.8, h: 1.3}, {z: 5.2, w: 1.0, h: 0.9}], 6,
      i => (i === 2 ? trim : hull));
    b.loft([{z: -4.2, w: 0.7, h: 0.4, y: 0.5}, {z: -2.4, w: 1.1, h: 0.9, y: 0.82}, {z: -0.4, w: 0.8, h: 0.4, y: 0.8}], 5, GLASS);
    b.wing(0.8, 6.6, [0.4, 4.0], [-2.6, -1.0], 0, 0.5, 0.3, t2);
    b.wing(0.6, 2.6, [3.2, 5.0], [4.6, 5.6], 0.2, 1.5, 0.2, trim);
    engine(1.5, -0.1, 5.8, 0.55); engine(-1.5, -0.1, 5.8, 0.55);
    barrel(6.4, 0.5, -1.4, 2); barrel(-6.4, 0.5, -1.4, 2); barrel(0, -0.7, -4.4, 2.6);
  } else if (hullId === 'bastion') {
    b.loft([{z: -7.5, w: 1.6, h: 0.9}, {z: -4.5, w: 4.2, h: 2.0}, {z: 1.5, w: 5.4, h: 2.8, y: 0.15}, {z: 6.0, w: 4.6, h: 2.4}, {z: 7.4, w: 3.4, h: 1.8}], 8,
      i => (i === 1 ? trim : i === 2 ? hull : STEEL));
    b.loft([{z: -4.6, w: 1.0, h: 0.5, y: 0.9}, {z: -2.6, w: 1.6, h: 1.1, y: 1.25}, {z: -0.2, w: 1.2, h: 0.6, y: 1.3}], 5, GLASS);
    for (const m of [1, -1]) {
      b.box([m * 4.4, -0.2, 1.2], [2.0, 1.6, 8.4], t2); b.box([m * 4.4, 0.75, 1.6], [1.2, 0.4, 6.4], DARK);
      b.box([m * 5.9, -0.2, 3.2], [1.2, 0.5, 3.6], trim);
    }
    engine(0, 0.1, 8.6, 0.85); engine(4.4, -0.2, 6.6, 0.7); engine(-4.4, -0.2, 6.6, 0.7);
    barrel(4.9, -0.8, -3); barrel(-4.9, -0.8, -3); barrel(3.9, 0.5, -3); barrel(-3.9, 0.5, -3);
  } else if (hullId === 'caravel') {
    b.loft([{z: -13, w: 2.4, h: 2.0, y: 0.6}, {z: -10, w: 4.4, h: 3.6, y: 0.3}, {z: -7, w: 3.0, h: 2.6}, {z: 9, w: 3.0, h: 2.6}, {z: 12.5, w: 5.2, h: 4.2}], 6,
      i => (i === 0 || i === 3 ? hull : STEEL));
    b.box([0, 2.5, -9.6], [2.8, 1.1, 2.6], GLASS);
    for (let k = 0; k < 3; k++) {
      const z = -4.4 + k * 5.2;
      b.box([0, 0, z], [9.5, 6.4, 4.2], k % 2 ? t2 : trim); b.box([0, 0, z], [10.1, 1.0, 3.2], DARK); b.box([0, 0, z], [1.2, 7.0, 3.2], DARK);
    }
    engine(1.7, 1.2, 14.2, 0.95, 1.8); engine(-1.7, 1.2, 14.2, 0.95, 1.8); engine(1.7, -1.2, 14.2, 0.95, 1.8); engine(-1.7, -1.2, 14.2, 0.95, 1.8);
    barrel(2.4, -1.4, -11); barrel(-2.4, -1.4, -11); barrel(4.9, 3.3, -4.4, 2); barrel(-4.9, 3.3, -4.4, 2);
  } else { // wraith
    b.loft([{z: -9.2, w: 0.2, h: 0.15}, {z: -5.6, w: 1.2, h: 0.8}, {z: -1.0, w: 2.2, h: 1.5, y: 0.1}, {z: 4.2, w: 2.6, h: 1.6}, {z: 6.2, w: 1.6, h: 1.2}], 8,
      i => (i === 2 ? DARK : i === 1 ? trim : hull));
    b.loft([{z: -5.4, w: 0.6, h: 0.4, y: 0.45}, {z: -3.2, w: 1.0, h: 0.9, y: 0.75}, {z: -0.8, w: 0.8, h: 0.4, y: 0.75}], 5, GLASS);
    b.wing(1.0, 7.4, [-0.6, 4.8], [4.2, 6.6], 0.1, 1.9, 0.3, t2);
    b.wing(1.0, 6.2, [0.6, 4.8], [4.4, 6.4], -0.1, -1.7, 0.3, trim);
    engine(1.9, 0, 7.4, 0.8, 2.6); engine(-1.9, 0, 7.4, 0.8, 2.6);
    barrel(7.2, 1.9, 2.2, 2.8); barrel(-7.2, 1.9, 2.2, 2.8); barrel(6.0, -1.7, 2.4, 2.8); barrel(-6.0, -1.7, 2.4, 2.8);
    barrel(1.3, -0.5, -4.2, 2.6); barrel(-1.3, -0.5, -4.2, 2.6);
  }
  const model = b.build({engines, muzzles});
  shipCache.set(key, model);
  return model;
}

// Stations ---------------------------------------------------------------------------------
// Parts are axis-aligned so the simulation can reuse solid boxes as AABB colliders.
const stationSpecs = {
  ring: [
    {t: 'cyl', c: [0, 0, 0], r: 46, h: 190, axis: 1, col: 'hull', solid: 0.75},
    {t: 'cyl', c: [0, 110, 0], r: 26, h: 40, axis: 1, col: 'trim'}, {t: 'cyl', c: [0, -118, 0], r: 12, h: 60, axis: 1, col: 'dark'},
    {t: 'torus', c: [0, 0, 0], R: 230, r: 26, axis: 1, col: 'hull', colB: 'steel', solid: true},
    {t: 'box', c: [0, 0, 0], s: [460, 14, 18], col: 'steel', solid: true}, {t: 'box', c: [0, 0, 0], s: [18, 14, 460], col: 'steel', solid: true},
    {t: 'box', c: [0, 62, 0], s: [70, 10, 70], col: 'trim'}, {t: 'box', c: [0, -40, 300], s: [36, 22, 90], col: 'trim', solid: true},
    {t: 'light', c: [0, -40, 350], col: [0.3, 1, 0.5]}, {t: 'light', c: [0, 150, 0], col: [1, 0.3, 0.3]},
    {t: 'light', c: [256, 0, 0], col: [1, 0.9, 0.5]}, {t: 'light', c: [-256, 0, 0], col: [1, 0.9, 0.5]},
  ],
  dockring: [
    {t: 'torus', c: [0, 0, 0], R: 190, r: 18, axis: 2, col: 'trim', colB: 'hull', solid: true},
    {t: 'box', c: [0, -230, 0], s: [220, 60, 120], col: 'hull', solid: true}, {t: 'box', c: [0, -280, 0], s: [120, 50, 80], col: 'steel', solid: true},
    {t: 'box', c: [0, -196, 0], s: [150, 10, 150], col: 'dark'}, {t: 'cyl', c: [150, -230, 0], r: 34, h: 90, axis: 1, col: 'steel', solid: 0.8},
    {t: 'cyl', c: [-150, -230, 0], r: 34, h: 90, axis: 1, col: 'steel', solid: 0.8}, {t: 'box', c: [0, -330, 0], s: [14, 60, 14], col: 'dark'},
    {t: 'light', c: [0, 212, 0], col: [0.3, 1, 0.5]}, {t: 'light', c: [212, 0, 0], col: [0.3, 1, 0.5]}, {t: 'light', c: [-212, 0, 0], col: [0.3, 1, 0.5]},
    {t: 'light', c: [0, -370, 0], col: [1, 0.3, 0.3]},
  ],
  spindle: [
    {t: 'cyl', c: [0, 0, 0], r: 30, h: 460, axis: 1, col: 'steel', solid: 0.8},
    {t: 'cyl', c: [0, 120, 0], r: 130, h: 34, axis: 1, col: 'hull', solid: 0.72}, {t: 'cyl', c: [0, 30, 0], r: 96, h: 26, axis: 1, col: 'trim', solid: 0.72},
    {t: 'cyl', c: [0, -70, 0], r: 150, h: 40, axis: 1, col: 'hull', solid: 0.72}, {t: 'cyl', c: [0, -160, 0], r: 70, h: 30, axis: 1, col: 'dark', solid: 0.72},
    {t: 'box', c: [0, 262, 0], s: [8, 70, 8], col: 'dark'}, {t: 'box', c: [190, -70, 0], s: [90, 20, 34], col: 'trim', solid: true},
    {t: 'light', c: [240, -70, 0], col: [0.3, 1, 0.5]}, {t: 'light', c: [0, 300, 0], col: [1, 0.3, 0.3]}, {t: 'light', c: [0, -236, 0], col: [1, 0.9, 0.5]},
  ],
  yard: [
    {t: 'box', c: [-90, 70, 0], s: [22, 22, 620], col: 'steel', solid: true}, {t: 'box', c: [90, 70, 0], s: [22, 22, 620], col: 'steel', solid: true},
    {t: 'box', c: [-90, -70, 0], s: [22, 22, 620], col: 'steel', solid: true}, {t: 'box', c: [90, -70, 0], s: [22, 22, 620], col: 'steel', solid: true},
    {t: 'box', c: [0, 70, -300], s: [202, 16, 16], col: 'trim'}, {t: 'box', c: [0, 70, 0], s: [202, 16, 16], col: 'trim'}, {t: 'box', c: [0, 70, 300], s: [202, 16, 16], col: 'trim'},
    {t: 'box', c: [-90, 0, -300], s: [16, 160, 16], col: 'trim'}, {t: 'box', c: [90, 0, -300], s: [16, 160, 16], col: 'trim'},
    {t: 'box', c: [-90, 0, 300], s: [16, 160, 16], col: 'trim'}, {t: 'box', c: [90, 0, 300], s: [16, 160, 16], col: 'trim'},
    {t: 'box', c: [0, -10, -60], s: [70, 50, 300], col: 'dark', solid: true}, {t: 'box', c: [0, 14, -150], s: [40, 30, 80], col: 'hull'},
    {t: 'box', c: [210, 0, 240], s: [150, 120, 110], col: 'hull', solid: true}, {t: 'box', c: [140, 0, 240], s: [80, 20, 30], col: 'steel', solid: true},
    {t: 'cyl', c: [210, 90, 240], r: 40, h: 60, axis: 1, col: 'trim'},
    {t: 'light', c: [210, 130, 240], col: [1, 0.3, 0.3]}, {t: 'light', c: [0, 86, -310], col: [0.3, 1, 0.5]}, {t: 'light', c: [0, 86, 310], col: [1, 0.9, 0.5]},
  ],
  depot: [
    {t: 'box', c: [0, -70, 0], s: [300, 24, 220], col: 'steel', solid: true},
    ...[-1, 0, 1].flatMap(i => [-1, 1].map(j => ({t: 'cyl', c: [i * 96, 30, j * 60], r: 40, h: 180, axis: 1, col: i ? 'hull' : 'trim', solid: 0.78}))),
    {t: 'box', c: [200, 0, 0], s: [70, 170, 70], col: 'hull', solid: true}, {t: 'box', c: [200, 96, 0], s: [90, 14, 90], col: 'trim'},
    {t: 'box', c: [-190, -70, 0], s: [80, 16, 30], col: 'trim', solid: true},
    {t: 'light', c: [-236, -70, 0], col: [0.3, 1, 0.5]}, {t: 'light', c: [200, 112, 0], col: [1, 0.3, 0.3]},
  ],
  outpost: [
    {t: 'cyl', c: [0, 0, 0], r: 60, h: 70, axis: 1, col: 'hull', solid: 0.75}, {t: 'cyl', c: [0, 50, 0], r: 30, h: 34, axis: 1, col: 'trim'},
    {t: 'torus', c: [0, -6, 0], R: 120, r: 12, axis: 1, col: 'steel', colB: 'hull', solid: true},
    {t: 'box', c: [0, -6, 0], s: [240, 8, 10], col: 'dark'}, {t: 'box', c: [0, -6, 0], s: [10, 8, 240], col: 'dark'},
    {t: 'box', c: [0, 30, -210], s: [150, 3, 110], col: 'panel', solid: true}, {t: 'box', c: [0, 30, 210], s: [150, 3, 110], col: 'panel', solid: true},
    {t: 'box', c: [0, 30, 0], s: [6, 6, 330], col: 'dark'},
    {t: 'light', c: [0, 76, 0], col: [1, 0.3, 0.3]}, {t: 'light', c: [136, -6, 0], col: [0.3, 1, 0.5]}, {t: 'light', c: [-136, -6, 0], col: [0.3, 1, 0.5]},
  ],
  rockbase: [
    {t: 'rock', c: [0, 0, 0], r: 230, seed: 7, solid: 0.62},
    {t: 'box', c: [150, 60, 60], s: [140, 60, 90], col: 'hull', solid: true}, {t: 'cyl', c: [150, 110, 60], r: 36, h: 44, axis: 1, col: 'trim'},
    {t: 'box', c: [-60, 190, -40], s: [70, 90, 70], col: 'steel', solid: true}, {t: 'box', c: [-60, 250, -40], s: [8, 50, 8], col: 'dark'},
    {t: 'box', c: [40, -30, 232], s: [90, 50, 80], col: 'trim', solid: true}, {t: 'box', c: [40, -30, 290], s: [50, 24, 50], col: 'dark', solid: true},
    {t: 'light', c: [40, -30, 322], col: [0.3, 1, 0.5]}, {t: 'light', c: [-60, 280, -40], col: [1, 0.3, 0.3]}, {t: 'light', c: [226, 60, 60], col: [1, 0.9, 0.5]},
  ],
};
export const STATION_RADIUS = {ring: 360, dockring: 380, spindle: 310, yard: 430, depot: 260, outpost: 280, rockbase: 340};

/** Solid AABBs ({c,s}) of a station archetype in local space. */
export function stationBoxes(kind) {
  const out = [];
  for (const part of stationSpecs[kind]) {
    if (!part.solid) continue;
    if (part.t === 'box') out.push({c: part.c, s: part.s});
    else if (part.t === 'cyl') {
      const d = part.r * 2 * part.solid, s = [d, d, d]; s[part.axis] = part.h;
      out.push({c: part.c, s});
    } else if (part.t === 'rock') { const d = part.r * 2 * part.solid; out.push({c: part.c, s: [d, d, d]}); }
    else if (part.t === 'torus') {
      const n = 12, d = part.r * 1.7;
      for (let i = 0; i < n; i++) {
        const a = (i + 0.5) / n * Math.PI * 2, u = Math.cos(a) * part.R, v = Math.sin(a) * part.R, w = 2 * Math.PI * part.R / n * 0.9;
        const c = part.axis === 1 ? [part.c[0] + u, part.c[1], part.c[2] + v] : part.axis === 0 ? [part.c[0], part.c[1] + u, part.c[2] + v] : [part.c[0] + u, part.c[1] + v, part.c[2]];
        const s = [w, w, w]; s[part.axis] = d;
        out.push({c, s});
      }
    }
  }
  return out;
}
export const stationLights = kind => stationSpecs[kind].filter(p => p.t === 'light');

const stationCache = new Map();
export function stationModel(kind, trim) {
  const key = kind + ':' + trim.join(',');
  if (stationCache.has(key)) return stationCache.get(key);
  const b = new Builder(), palette = {hull: [0.6, 0.62, 0.66], steel: [0.42, 0.45, 0.5], dark: [0.2, 0.21, 0.25], trim: mul(trim, 0.85), panel: [0.12, 0.2, 0.5]};
  for (const part of stationSpecs[kind]) {
    const col = palette[part.col];
    if (part.t === 'box') b.box(part.c, part.s, col);
    else if (part.t === 'cyl') b.cylinder(part.c, part.r, part.h, part.axis, col, 14);
    else if (part.t === 'torus') b.torus(part.c, part.R, part.r, part.axis, col, 28, 6, part.colB ? palette[part.colB] : null);
    else if (part.t === 'rock') rock(b, part.c, part.r, part.seed, 2);
  }
  const model = b.build();
  stationCache.set(key, model);
  return model;
}

function rock(b, c, r, seed, level) {
  const tone = 0.75 + (seed % 5) * 0.05;
  b.sphere(c, r, level, v => {
    const k = 0.26 + 0.2 * noise3(v[0] * 3 + 9, v[1] * 3, v[2] * 3, seed);
    return [k * tone * 1.12, k * tone, k * tone * 0.9];
  }, v => 0.72 + 0.5 * noise3(v[0] * 1.6, v[1] * 1.6 + 5, v[2] * 1.6, seed));
}
const rocks = [null, null];
/** Six unit-radius asteroid variants; detail 1 for nearby rocks, 0 for distant ones. */
export function rockModels(detail = 1) {
  rocks[detail] ??= [11, 23, 37, 41, 59, 67].map(seed => { const b = new Builder(); rock(b, [0, 0, 0], 1, seed, detail); return b.build(); });
  return rocks[detail];
}

const PALETTES = {
  ocean: v => { const n = noise3(v[0] * 2.2, v[1] * 2.2, v[2] * 2.2, 3), p = Math.abs(v[1]); return p > 0.88 ? [0.9, 0.93, 0.96] : n > 0.56 ? [0.25, 0.5 + n * 0.2, 0.25] : [0.1, 0.3 + n * 0.25, 0.7]; },
  garden: v => { const n = noise3(v[0] * 2.6, v[1] * 2.6, v[2] * 2.6, 5); return n > 0.45 ? [0.2 + n * 0.3, 0.55, 0.22] : [0.12, 0.35, 0.6]; },
  rust: v => { const n = noise3(v[0] * 3, v[1] * 3, v[2] * 3, 8); return [0.5 + n * 0.3, 0.26 + n * 0.16, 0.16]; },
  ice: v => { const n = noise3(v[0] * 3, v[1] * 3, v[2] * 3, 13); return [0.62 + n * 0.3, 0.76 + n * 0.2, 0.92]; },
  gas: v => { const n = noise3(v[0] * 0.8, v[1] * 7, v[2] * 0.8, 21); return n > 0.5 ? [0.85, 0.62, 0.36] : [0.66, 0.4 + n * 0.2, 0.26]; },
  violet: v => { const n = noise3(v[0] * 1.4, v[1] * 5, v[2] * 1.4, 34); return [0.42 + n * 0.25, 0.26, 0.6 + n * 0.25]; },
};
const planetCache = new Map();
export function planetModel(palette) {
  if (!planetCache.has(palette)) { const b = new Builder(); b.sphere([0, 0, 0], 1, 3, PALETTES[palette]); planetCache.set(palette, b.build()); }
  return planetCache.get(palette);
}

let gate = null, laneRing = null, pod = null, missile = null;
export function gateModel() {
  if (!gate) {
    const b = new Builder();
    b.torus([0, 0, 0], 170, 15, 2, [0.5, 0.53, 0.6], 32, 6, [0.3, 0.32, 0.4]);
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4, x = Math.cos(a) * 190, y = Math.sin(a) * 190;
      b.box([x, y, 0], [44, 44, 70], [0.35, 0.5, 0.75]); b.box([x * 1.14, y * 1.14, 0], [18, 18, 110], [0.2, 0.22, 0.28]);
    }
    gate = b.build();
  }
  return gate;
}
export function laneRingModel() {
  if (!laneRing) {
    const b = new Builder();
    b.torus([0, 0, 0], 46, 4, 2, [0.55, 0.6, 0.7], 20, 5, [0.25, 0.4, 0.55]);
    for (let i = 0; i < 3; i++) { const a = i * Math.PI * 2 / 3 + Math.PI / 2; b.box([Math.cos(a) * 52, Math.sin(a) * 52, 0], [12, 12, 20], [0.3, 0.33, 0.4]); }
    laneRing = b.build();
  }
  return laneRing;
}
export function podModel() {
  if (!pod) { const b = new Builder(); b.box([0, 0, 0], [2.2, 2.2, 3.2], [0.7, 0.6, 0.3]); b.box([0, 0, 0], [2.5, 0.5, 2.2], [0.25, 0.25, 0.3]); pod = b.build(); }
  return pod;
}
export function missileModel() {
  if (!missile) {
    const b = new Builder();
    b.loft([{z: -2.2, w: 0.1, h: 0.1}, {z: -1.2, w: 0.6, h: 0.6}, {z: 1.8, w: 0.6, h: 0.6}], 5, [0.85, 0.85, 0.8], {capGlow: 1, capColor: [1, 0.7, 0.3]});
    b.wing(0.2, 1.0, [0.8, 1.8], [1.4, 1.9], 0, 0, 0.1, [0.8, 0.2, 0.2]);
    missile = b.build();
  }
  return missile;
}

/** Deterministic asteroid placement for a rock zone: [{pos,radius,variant,q}]. */
export function scatterRocks(zone, seed) {
  const rng = seededRandom(seed), out = [], count = Math.round(zone.density * (zone.radius / 1000) ** 2 * 26);
  for (let i = 0; i < count; i++) {
    const a = rng() * Math.PI * 2, d = Math.sqrt(rng()) * zone.radius, y = (rng() - 0.5) * 2 * Math.min(900, zone.radius * 0.22) * (1 - d / zone.radius * 0.5);
    const radius = 14 + rng() * rng() * 110;
    const q = [rng() - 0.5, rng() - 0.5, rng() - 0.5, rng() - 0.5], l = Math.hypot(...q) || 1;
    out.push({pos: [zone.pos[0] + Math.cos(a) * d, zone.pos[1] + y, zone.pos[2] + Math.sin(a) * d], radius, variant: Math.floor(rng() * 6), q: q.map(v => v / l)});
  }
  return out;
}
