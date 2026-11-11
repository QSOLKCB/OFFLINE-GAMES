// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ModRuntime, activateRegistry, validatePack, validateModel, validateSound, validModState} from '../VAGRANT_STARS/js/mod-api.js';
const pack = (extra = {}) => ({api: 1, id: 'test-pack', version: '1.0.0', title: 'Test', description: 'Test pack', install() {}, ...extra});
const adapter = {game: 'vagrant', catalogs: {}, validateMission() {}};
test('standalone copies of the API and workshop stay identical', () => {
  for (const f of ['mod-api.js', 'mod-menu.js']) assert.equal(readFileSync(new URL('../VAGRANT_STARS/js/' + f, import.meta.url), 'utf8'), readFileSync(new URL('../IRONWAKE/js/' + f, import.meta.url), 'utf8'));
});
test('manifest rejects bad versions, identities, duplicate modes and registrations', () => {
  for (const p of [pack({api: 9}), pack({id: '../bad'}), pack({id: 'constructor'}), pack({version: 'latest'}), pack({modes: [{id: 'campaign', title: 'x', description: 'x'}]})]) assert.throws(() => validatePack(p));
  assert.throws(() => activateRegistry([pack(), pack()], adapter, '', new ModRuntime()), /duplicate/);
  assert.throws(() => activateRegistry([pack()], adapter, '?mod=missing', new ModRuntime()), /unknown installed/);
  assert.throws(() => activateRegistry([pack()], adapter, '?mode=arena', new ModRuntime()), /needs a pack/);
  const runtime = new ModRuntime(); runtime.activate(pack(), adapter); assert.throws(() => runtime.activate(pack(), adapter), /once/);
});
test('unselected packs never run install; profile state cannot cross save boundaries', () => {
  let calls = 0; const p = pack({install() { calls++; }}), original = activateRegistry([p], adapter, '', new ModRuntime());
  assert.equal(calls, 0); assert.equal(original.saveKey('save'), 'save');
  const r = new ModRuntime().activate(p, adapter), captain = r.newPlayer({});
  assert.equal(calls, 1); assert.equal(r.saveKey('save'), 'save.mod.test-pack@1.0.0/campaign');
  assert.equal(original.validSave(captain), false); assert.equal(r.validSave({}), false);
  assert.equal(r.validSave({...captain, modProfile: 'test-pack@2.0.0/campaign'}), false);
  assert.equal(r.validSave({...captain, modState: {completed: ['missing'], mode: {}}}), false);
});
test('persistent state, sounds and models have finite resource limits', () => {
  for (const v of [NaN, {x: Infinity}, {x: new Date()}, {x: Array(1025).fill(0)}, JSON.parse('{"__proto__":{}}')]) assert.equal(validModState(v), false);
  const cycle = {}; cycle.a = cycle; assert.equal(validModState(cycle), false);
  assert.ok(validModState({mode: {wave: 3}, completed: []}));
  for (const sound of [[], [[['triangle', 200, 300, 11000, 4000]]], [[['wat', 1, 1, 2, 3]]], [[['triangle', Infinity, 300, 20, 4000]]]]) assert.throws(() => validateSound(sound));
  assert.throws(() => validateModel({tris: [0, 0, 0]}, {game: 'vagrant'}));
});

test('derived hulls inherit a custom parent model and invalid inheritance/patches fail clearly', () => {
  const model = {tris: [0,0,0, 1,0,0, 0,1,0], normals: [0,0,1], colors: [0.2,0.4,0.6], glow: [0], count: 1, radius: 1, engines: [[0,0,0,1]], muzzles: [[0,0,0]]};
  const catalogAdapter = {game: 'vagrant', catalogs: {hulls: {base: {hp: 1}}}, validateMission() {}};
  const r = new ModRuntime().activate(pack({install(api) {
    assert.throws(() => api.extend('hulls', 'bad', 'base', 4), /extension/);
    api.extend('hulls', 'parent', 'base', {}); api.assets.ship('parent', () => model);
    api.extend('hulls', 'child', 'parent', {});
    api.extend('hulls', 'loop-one', 'base', {}); api.extend('hulls', 'loop-two', 'loop-one', {});
    api.extend('hulls', 'loop-one', 'loop-two', {});
  }}), catalogAdapter);
  assert.equal(r.model('child', {guns: 1, base() { throw new Error('lost custom parent'); }}, () => null), model);
  assert.throws(() => r.model('loop-one', {}, () => null), /cyclic/);
});
