// SPDX-License-Identifier: Apache-2.0
// Right-handed world: +Y up, -Z forward. Quaternions are [x,y,z,w].
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const length = v => Math.hypot(...v);
export const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0);
export const add = (a, b) => a.map((x, i) => x + b[i]);
export const subtract = (a, b) => a.map((x, i) => x - b[i]);
export const scale = (v, s) => v.map(x => x * s);
export const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
export function normalize(v) {
  const n = length(v);
  return n > 1e-12 ? scale(v, 1/n) : v.map(() => 0);
}
export const mix = (a, b, t) => a.map((x, i) => x + (b[i]-x)*t);
export function finiteVector(value, size, name = 'vector') {
  if (!value || value.length !== size || !Array.from(value).every(Number.isFinite)) {
    throw new TypeError(`${name} must contain ${size} finite numbers`);
  }
  return Array.from(value);
}
export function quatNormalize(q) {
  const n = length(q);
  if (n < 1e-12) throw new RangeError('zero quaternion');
  return scale(q, 1/n);
}
export const quatConjugate = q => [-q[0], -q[1], -q[2], q[3]];
export function quatMultiply(a, b) {
  const [x,y,z,w] = a, [X,Y,Z,W] = b;
  return [w*X+x*W+y*Z-z*Y, w*Y-x*Z+y*W+z*X, w*Z+x*Y-y*X+z*W, w*W-x*X-y*Y-z*Z];
}
export function rotate(q, v) {
  const t = scale(cross(q.slice(0,3), v), 2);
  return add(v, add(scale(t, q[3]), cross(q.slice(0,3), t)));
}
export function integrateOrientation(q, angularVelocity, dt) {
  const speed = length(angularVelocity), half = speed * dt / 2;
  const s = speed > 1e-12 ? Math.sin(half) / speed : dt / 2;
  return quatNormalize(quatMultiply(q, [...scale(angularVelocity, s), Math.cos(half)]));
}
export function quatInterpolate(a, b, t) {
  // Shortest-arc normalized interpolation; sufficient between adjacent physics ticks.
  return quatNormalize(mix(a, dot(a,b) < 0 ? scale(b,-1) : b, t));
}
export function perspective(fov, aspect, near = 0.1, far = 1200) {
  const f = 1 / Math.tan(fov / 2), n = 1 / (near - far);
  return new Float32Array([f/aspect,0,0,0, 0,f,0,0, 0,0,(far+near)*n,-1, 0,0,2*far*near*n,0]);
}
export function viewMatrix(position, orientation) {
  const right = rotate(orientation,[1,0,0]), up = rotate(orientation,[0,1,0]), back = rotate(orientation,[0,0,1]);
  return new Float32Array([right[0],up[0],back[0],0, right[1],up[1],back[1],0, right[2],up[2],back[2],0,
    -dot(right,position),-dot(up,position),-dot(back,position),1]);
}
export function multiplyMatrices(a, b) {
  const out = new Float32Array(16);
  for (let c=0;c<4;c++) for (let r=0;r<4;r++) {
    out[c*4+r] = a[r]*b[c*4]+a[4+r]*b[c*4+1]+a[8+r]*b[c*4+2]+a[12+r]*b[c*4+3];
  }
  return out;
}
export function seededRandom(seed = 1) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ state >>> 15, state | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
