// SPDX-License-Identifier: Apache-2.0
// Exact OPT-INV-001 comparison of the changed glow-disc emitter's trig work.
// Kernel measurement only; not an end-to-end FPS claim.
import {performance} from 'node:perf_hooks';
import {cpus, platform, arch} from 'node:os';
import {writeFileSync, mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
import {unitCircle, bakeSurface} from '../IRONWAKE/js/environment.js';
const sizes = [8, 10, 12, 14, 16, 18, 20, 24, 28], data = new Float64Array(2000 * 28 * 4);
function frame(cached) {
  let n = 0;
  for (let j = 0; j < 2000; j++) {
    const segments = sizes[j % sizes.length], radius = 1.7 + j * 0.013, circle = cached ? unitCircle(segments) : null;
    for (let i = 0; i < segments; i++) {
      const a = i / segments * Math.PI * 2, b = (i + 1) / segments * Math.PI * 2;
      data[n++] = (cached ? circle[i * 2] : Math.cos(a)) * radius;
      data[n++] = (cached ? circle[i * 2 + 1] : Math.sin(a)) * radius;
      data[n++] = (cached ? circle[i * 2 + 2] : Math.cos(b)) * radius;
      data[n++] = (cached ? circle[i * 2 + 3] : Math.sin(b)) * radius;
    }
  }
  return n;
}
const n = frame(false), reference = data.slice(0, n); assert.equal(frame(true), n); assert.deepEqual(data.slice(0, n), reference);
for (let i = 0; i < 20; i++) { frame(false); frame(true); }
const samples = [];
for (let i = 0; i < 9; i++) {
  const row = {};
  for (const cached of i % 2 ? [true, false] : [false, true]) { const t = performance.now(); for (let j = 0; j < 60; j++) frame(cached); row[cached ? 'cached_ms' : 'reference_ms'] = performance.now() - t; }
  samples.push(row);
}
const start = performance.now(); bakeSurface('sky', 42, undefined, 1024, 512); const sky_bake_ms = performance.now() - start;
const report = {node: process.version, cpu: cpus()[0].model, platform: platform(), arch: arch(), frames_per_trial: 60, discs_per_frame: 2000, exact_float64_parity: true, cache_bytes: sizes.reduce((sum, n) => sum + (n + 1) * 16, 0), sky_bake_ms, samples,
  scope: 'Glow-disc trigonometry kernel only. Texture generation is a new presentation cost, paid per system change. No GPU/FPS claim.'};
mkdirSync('evidence', {recursive: true}); writeFileSync('evidence/presentation-benchmark.json', JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
