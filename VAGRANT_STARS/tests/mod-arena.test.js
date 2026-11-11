// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {mods, activateMods} from '../js/modding.js';
import {newPlayer, sanitizeSave} from '../js/sim/player.js';
import {jobsAt} from '../js/sim/missions.js';
import {World} from '../js/sim/world.js';
activateMods('?mod=independence-kit&mode=arena');
test('arena has three bounded waves, repairs and exactly one persistent prize', () => {
  const p = mods.newPlayer(newPlayer(7)), w = new World(p), credits = p.credits;
  assert.deepEqual(jobsAt(p, "calder"), []);
  for (let wave = 1; wave <= 3; wave++) {
    for (let t = 0; t < 600 && !w.mod.enemies; t++) w.step(1/60, {});
    assert.equal(w.mod.wave, wave); assert.ok(w.mod.enemies.length <= 4);
    // Fixture removes each actual spawned wave; combat weapons are covered by the existing tests.
    for (const s of w.mod.enemies) s.alive = false;
    w.step(1/60, {});
  }
  assert.equal(w.mod.finished, true); assert.equal(p.modState.mode.won, true); assert.equal(p.credits, credits + 6000); assert.ok(sanitizeSave(p));
  for (let i = 0; i < 60; i++) w.step(1/60, {});
  assert.equal(p.credits, credits + 6000);
  w.launch(); assert.equal(w.mod.finished, true); assert.equal(w.ships.length, 1);
});
test('unfinished mode restarts cleanly and title backdrop does not run mode hooks', () => {
  const p = mods.newPlayer(newPlayer(2)), w = new World(p); w.step(1/60, {}); w.launch(); assert.equal(w.mod.wave, 0);
  const backdrop = new World(newPlayer(11), {modded: false, traffic: false}); assert.equal(backdrop.mod, undefined);
});
