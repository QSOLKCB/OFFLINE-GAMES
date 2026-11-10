// SPDX-License-Identifier: Apache-2.0
// Original procedural presentation, layered onto VANILLAJS render-webgl.
// OPT-INV-001: bake deterministic surfaces once per system, retain GPU geometry.
// This file is mirrored in both games so each folder remains independently runnable.
export function noise(x, y, z, seed = 17) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const smooth = v => v * v * (3 - 2 * v), a = smooth(x - ix), b = smooth(y - iy), c = smooth(z - iz);
  const h = (i, j, k) => { let n = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k, 2147483647) ^ seed; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967295; };
  const mix = (u, v, t) => u + (v - u) * t;
  return mix(mix(mix(h(ix, iy, iz), h(ix + 1, iy, iz), a), mix(h(ix, iy + 1, iz), h(ix + 1, iy + 1, iz), a), b),
    mix(mix(h(ix, iy, iz + 1), h(ix + 1, iy, iz + 1), a), mix(h(ix, iy + 1, iz + 1), h(ix + 1, iy + 1, iz + 1), a), b), c);
}
const fbm = (x, y, z, seed) => noise(x, y, z, seed) * 0.55 + noise(x * 2.07, y * 2.07, z * 2.07, seed) * 0.27 + noise(x * 4.13, y * 4.13, z * 4.13, seed) * 0.13 + noise(x * 8.3, y * 8.3, z * 8.3, seed) * 0.05;
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const clamp = v => Math.max(0, Math.min(1, v));
export function surfaceColor(kind, x, y, z, seed, colors) {
  const n = fbm(x * 3 + 7, y * 3, z * 3, seed);
  if (kind === 'sky') {
    const band = Math.exp(-((y + x * 0.38 + Math.sin(z * 3) * 0.18) ** 2) * 7);
    const wisps = Math.max(0, n - 0.33) ** 1.5 * 2.8;
    const dust = clamp((noise(x * 6 + 9, y * 6, z * 6, seed + 19) - 0.47) * 4);
    const col = mix(colors[0], colors[1], clamp(n * 1.6 - 0.25));
    return col.map((v, i) => [0.004, 0.007, 0.016][i] + v * band * wisps * (1 - dust * 0.86));
  }
  if (kind === 'gas' || kind === 'violet') {
    const bands = Math.sin(y * 68 + n * 14 + Math.sin(x * 8 + z * 4) * 2) * 0.5 + 0.5;
    return kind === 'gas' ? mix([0.24, 0.14, 0.12], [0.9, 0.7, 0.47], bands * 0.72 + n * 0.28) : mix([0.16, 0.07, 0.3], [0.63, 0.36, 0.8], bands * 0.65 + n * 0.35);
  }
  if (kind === 'ice') return mix([0.16, 0.35, 0.48], [0.87, 0.95, 1], clamp(n * 1.6));
  if (kind === 'rust') return mix([0.2, 0.08, 0.045], [0.78, 0.43, 0.22], n);
  const land = clamp((n - (kind === 'garden' ? 0.44 : 0.51)) * 18);
  let col = mix([0.018, 0.09, 0.23], mix([0.1, 0.26, 0.13], [0.42, 0.37, 0.2], clamp(n * 2 - 0.6)), land);
  const ice = clamp((Math.abs(y) - 0.83 + n * 0.08) * 16);
  col = mix(col, [0.86, 0.92, 0.95], ice);
  const cloud = clamp((fbm(x * 8 - y * 2, y * 6 + 9, z * 8, seed + 51) - 0.57) * 5);
  return mix(col, [0.82, 0.87, 0.92], cloud * 0.85);
}
/** Pixel centres sample a sphere, so longitude wraps without a noise seam. */
export function bakeSurface(kind, seed = 17, colors = [[0.12, 0.25, 0.5], [0.4, 0.15, 0.3]], width = 512, height = 256) {
  const pixels = new Uint8Array(width * height * 4);
  for (let j = 0; j < height; j++) {
    const lat = (j + 0.5) / height * Math.PI, y = Math.cos(lat), r = Math.sin(lat);
    for (let i = 0; i < width; i++) {
      const a = (i + 0.5) / width * Math.PI * 2;
      const col = surfaceColor(kind, Math.cos(a) * r, y, Math.sin(a) * r, seed, colors), at = (j * width + i) * 4;
      for (let k = 0; k < 3; k++) pixels[at + k] = Math.round(clamp(col[k]) * 255);
      pixels[at + 3] = 255;
    }
  }
  return {pixels, width, height};
}
export function sphereVertices(longitudes = 64, latitudes = 32) {
  const out = new Float32Array(longitudes * latitudes * 6 * 5); let at = 0;
  const put = (i, j) => { const u = i / longitudes, v = j / latitudes, a = u * Math.PI * 2, b = v * Math.PI; out.set([Math.cos(a) * Math.sin(b), Math.cos(b), Math.sin(a) * Math.sin(b), u, v], at); at += 5; };
  for (let j = 0; j < latitudes; j++) for (let i = 0; i < longitudes; i++) {
    put(i, j); put(i, j + 1); put(i + 1, j + 1); put(i, j); put(i + 1, j + 1); put(i + 1, j);
  }
  return out;
}
const vertex = `attribute vec3 position; attribute vec2 uv;
uniform mat4 vp; uniform vec3 centre; uniform float radius;
varying vec2 texcoord; varying vec3 normal; varying vec3 eye;
void main(){normal=position; texcoord=uv; vec3 p=centre+position*radius; eye=-p; gl_Position=vp*vec4(p,1.0);}`;
const fragment = `precision mediump float;
uniform sampler2D surface; uniform vec3 light; uniform vec3 atmosphere; uniform float sky; uniform float shell;
varying vec2 texcoord; varying vec3 normal; varying vec3 eye;
void main(){vec3 n=normalize(normal); vec3 v=normalize(eye); float facing=dot(n,v);
if(shell>0.5 && facing<0.0) discard;
vec3 base=texture2D(surface,texcoord).rgb;
float day=max(0.0,dot(n,light)); float rim=pow(1.0-max(0.0,facing),3.0);
vec3 col=base*(0.055+day*1.15)+atmosphere*rim*(0.12+day*0.5);
if(shell>0.5) col=atmosphere*pow(1.0-max(0.0,facing),4.0)*(0.12+day*0.35);
gl_FragColor=vec4(sky>0.5?base:col,1.0);}`;

export class Environment {
  constructor(gl) {
    this.gl = gl; this.textures = new Map(); this.signature = null; this.bakes = 0;
    const compile = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const vs = compile(gl.VERTEX_SHADER, vertex), fs = compile(gl.FRAGMENT_SHADER, fragment), p = this.program = gl.createProgram();
    gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p); gl.deleteShader(vs); gl.deleteShader(fs);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    this.position = gl.getAttribLocation(p, 'position'); this.uv = gl.getAttribLocation(p, 'uv');
    this.uniforms = Object.fromEntries(['vp', 'centre', 'radius', 'surface', 'light', 'atmosphere', 'sky', 'shell'].map(k => [k, gl.getUniformLocation(p, k)]));
    this.buffer = gl.createBuffer(); const data = sphereVertices(); this.count = data.length / 5;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  }
  configure(seed, colors, planets) {
    // Complete effective input identity; one sky and only the current system's palettes.
    const palettes = [...new Set(planets.map(p => p.palette))].sort();
    const signature = JSON.stringify([seed, colors, palettes]);
    if (signature === this.signature) return;
    const gl = this.gl;
    for (const texture of this.textures.values()) gl.deleteTexture(texture);
    this.textures.clear(); this.signature = signature;
    for (const kind of ['sky', ...palettes]) {
      const image = bakeSurface(kind, seed, colors, kind === 'sky' ? 1024 : 512, kind === 'sky' ? 512 : 256), texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, image.width, image.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, image.pixels);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.textures.set(kind, texture); this.bakes++;
    }
  }
  #bind(vp) {
    const gl = this.gl, u = this.uniforms;
    gl.useProgram(this.program); gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.enableVertexAttribArray(this.position); gl.vertexAttribPointer(this.position, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(this.uv); gl.vertexAttribPointer(this.uv, 2, gl.FLOAT, false, 20, 12);
    gl.uniformMatrix4fv(u.vp, false, vp); gl.activeTexture(gl.TEXTURE0); gl.uniform1i(u.surface, 0);
  }
  drawSky(vp) {
    const gl = this.gl, u = this.uniforms; this.#bind(vp);
    gl.uniform3f(u.centre, 0, 0, 0); gl.uniform1f(u.radius, 900); gl.uniform1f(u.sky, 1); gl.uniform1f(u.shell, 0);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.get('sky')); gl.drawArrays(gl.TRIANGLES, 0, this.count);
  }
  drawPlanets(vp, planets, cam, sun, scale) {
    const gl = this.gl, u = this.uniforms; this.#bind(vp); gl.uniform1f(u.sky, 0);
    for (const p of planets) {
      const pos = p.pos.map((v, i) => (v - cam.pos[i]) * scale), l = sun.dir ?? sun.pos.map((v, i) => v - p.pos[i]), len = Math.hypot(...l);
      const air = p.palette === 'gas' ? [0.7, 0.38, 0.17] : p.palette === 'rust' ? [0.45, 0.18, 0.09] : p.palette === 'violet' ? [0.43, 0.16, 0.7] : [0.13, 0.43, 0.85];
      gl.uniform3fv(u.centre, pos); gl.uniform3fv(u.light, l.map(v => v / len)); gl.uniform3fv(u.atmosphere, air);
      gl.bindTexture(gl.TEXTURE_2D, this.textures.get(p.palette)); gl.uniform1f(u.shell, 0); gl.uniform1f(u.radius, p.radius * scale);
      gl.drawArrays(gl.TRIANGLES, 0, this.count);
    }
    // Keep opaque depth while drawing atmospheric shells; do not write shell depth.
    gl.depthMask(false); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    for (const p of planets) {
      const l = sun.dir ?? sun.pos.map((v, i) => v - p.pos[i]), len = Math.hypot(...l);
      gl.uniform3fv(u.centre, p.pos.map((v, i) => (v - cam.pos[i]) * scale)); gl.uniform3fv(u.light, l.map(v => v / len));
      gl.uniform3fv(u.atmosphere, p.palette === 'gas' ? [0.7, 0.38, 0.17] : [0.13, 0.43, 0.85]);
      gl.uniform1f(u.shell, 1); gl.uniform1f(u.radius, p.radius * scale * 1.025); gl.drawArrays(gl.TRIANGLES, 0, this.count);
    }
    gl.disable(gl.BLEND); gl.depthMask(true);
  }
  dispose() { for (const t of this.textures.values()) this.gl.deleteTexture(t); this.textures.clear(); this.gl.deleteBuffer(this.buffer); this.gl.deleteProgram(this.program); }
}

// Exact binary64 trig values for every shipped glow-disc tessellation. 2,544 bytes.
const circles = new Map([8, 10, 12, 14, 16, 18, 20, 24, 28].map(segments => {
  const values = new Float64Array((segments + 1) * 2);
  for (let i = 0; i <= segments; i++) { const a = i / segments * Math.PI * 2; values[i * 2] = Math.cos(a); values[i * 2 + 1] = Math.sin(a); }
  return [segments, values];
}));
export function unitCircle(segments) {
  const values = circles.get(segments);
  if (!values) throw new RangeError('unsupported glow-disc tessellation');
  return values;
}
