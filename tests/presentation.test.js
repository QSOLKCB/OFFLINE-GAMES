// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {bakeSurface, surfaceColor, sphereVertices, unitCircle, Environment} from '../IRONWAKE/js/environment.js';
import {masterPCM, roomImpulse, environmentAt} from '../IRONWAKE/js/soundscape.js';
import {pickEnemy} from '../IRONWAKE/js/selection.js';
import {SOUNDS, renderSound} from '../IRONWAKE/js/audio.js';

test('self-contained games ship identical presentation helpers', () => {
  for (const file of ['environment.js', 'selection.js', 'soundscape.js']) assert.equal(readFileSync(new URL(`../IRONWAKE/js/${file}`, import.meta.url), 'utf8'), readFileSync(new URL(`../VAGRANT_STARS/js/${file}`, import.meta.url), 'utf8'));
});
test('sphere mesh has finite unit normals and closed longitude seam', () => {
  const a = sphereVertices(); assert.equal(a.length, 64 * 32 * 6 * 5);
  for (let i = 0; i < a.length; i += 5) { assert.ok(Math.abs(Math.hypot(...a.subarray(i, i + 3)) - 1) < 1e-6); assert.ok(a[i + 3] >= 0 && a[i + 3] <= 1 && a[i + 4] >= 0 && a[i + 4] <= 1); }
});
test('procedural environments are deterministic, bounded, distinct and wrap in world direction', () => {
  const palettes = ['sky', 'ocean', 'garden', 'gas', 'rust', 'ice', 'violet']; const images = [];
  for (const palette of palettes) {
    const a = bakeSurface(palette, 42, undefined, 32, 16); assert.deepEqual(a, bakeSurface(palette, 42, undefined, 32, 16));
    assert.equal(a.pixels.length, 32 * 16 * 4); images.push(Buffer.from(a.pixels).toString('base64'));
    for (let i = 3; i < a.pixels.length; i += 4) assert.equal(a.pixels[i], 255);
    if (palette !== 'sky') assert.deepEqual(surfaceColor(palette, 1, 0, 0, 42).map(v => Math.round(v * 255)), surfaceColor(palette, 1, 0, Math.sin(Math.PI * 2), 42).map(v => Math.round(v * 255))); 
  }
  assert.equal(new Set(images).size, palettes.length);
});
test('circle reuse is exactly equal to the former per-disc trig for all shipped sizes', () => {
  for (const segments of [8, 10, 12, 14, 16, 18, 20, 24, 28]) {
    const a = unitCircle(segments); assert.equal(a, unitCircle(segments));
    for (let i = 0; i <= segments; i++) for (const radius of [0.01, 5, 37.2, 46000]) {
      const angle = i / segments * Math.PI * 2;
      assert.equal(a[i * 2] * radius, Math.cos(angle) * radius); assert.equal(a[i * 2 + 1] * radius, Math.sin(angle) * radius);
    }
  }
  assert.throws(() => unitCircle(999999), RangeError);
});
test('right-click picking ignores friends, dead contacts, behind-camera and empty space', () => {
  const ships = [1, 2, 3, 4].map(id => ({id, radius: 5, alive: id !== 4, body: {position: [id, 0, 0]}}));
  const world = {contacts: () => ships.map(ship => ({ship, attitude: ship.id === 1 ? 'neutral' : 'hostile'}))};
  const scene = {project: pos => pos[0] === 3 ? null : {x: 100, y: 100, w: 100}};
  assert.equal(pickEnemy(world, scene, new Map(), 100, 100, 1280, 720)?.id, 2);
  assert.equal(pickEnemy(world, scene, new Map(), 800, 500, 1280, 720), null);
  const poses = new Map([[2, {pos: [3, 0, 0]}]]); assert.equal(pickEnemy(world, scene, poses, 100, 100, 1280, 720), null);
});
test('mastered VANILLAJS effects have finite headroom, tapered edges and deterministic PCM', () => {
  for (const name of Object.keys(SOUNDS)) {
    const pcm = renderSound(name), a = masterPCM(pcm); assert.deepEqual(a, masterPCM(pcm)); assert.equal(a.length, pcm.length);
    assert.equal(Math.abs(a[0]), 0); assert.equal(Math.abs(a.at(-1)), 0);
    assert.ok(a.some(v => Math.abs(v) > 0.001)); assert.ok(a.every(v => Number.isFinite(v) && Math.abs(v) < 0.83));
  }
  const a = roomImpulse(8000); assert.deepEqual(a, roomImpulse(8000)); assert.notDeepEqual(a[0], a[1]);
  assert.equal(a[0].length, 12800); assert.ok(a[0].every(Number.isFinite));
});
test('soundscape follows docking, port distance, nebula and nearby rock state', () => {
  const w = {docked: 'home', playerShip: {body: {position: [0,0,0]}}, sector: {stations: [], rocks: []}};
  assert.equal(environmentAt(w), 'port'); w.docked = null; assert.equal(environmentAt(w), 'space');
  w.sector.stations.push({pos: [100,0,0], radius: 20}); assert.equal(environmentAt(w), 'port');
  w.sector.stations.length = 0; w.zoneAt = () => true; assert.equal(environmentAt(w), 'nebula');
  w.zoneAt = () => null; w.sector.rocks.push({pos: [20,0,0], radius: 4}); assert.equal(environmentAt(w), 'field');
  w.sector.rocks[0].dead = true; assert.equal(environmentAt(w), 'space');
});
