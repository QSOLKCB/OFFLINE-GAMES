// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {mods, activateMods, validateMission} from '../js/modding.js';
import {newPlayer, sanitizeSave} from '../js/sim/player.js';
import {jobsAt, acceptJob, missionOnDock, missionObjective} from '../js/sim/missions.js';
import {World} from '../js/sim/world.js';
import {renderSound} from '../js/audio.js';
import * as D from '../js/sim/data.js';
import * as Models from '../js/sim/models.js';
const iron = false, home = iron ? 'anchorage' : 'calder';
const original = newPlayer(41);
activateMods('?mod=independence-kit&mode=explorer');
const fresh = () => mods.newPlayer(newPlayer(41));

test('mod captain, inherited stats and custom assets run through real world and renderer data', () => {
  const p = fresh(); assert.equal(p.hull, 'liberty'); assert.ok(sanitizeSave(p)); assert.equal(sanitizeSave(original), null);
  assert.ok(!mods.saveKey('save').endsWith('campaign'));
  const w = new World(p); assert.equal(w.ships.length, 1); assert.equal(w.traffic, false);
  const hull = D.HULLS.liberty;
  const model = iron ? Models.vesselModel('liberty', hull.cannons, hull.turrets, [1,1,1]) : Models.shipModel('liberty');
  assert.ok(model.count > 0); assert.equal(model.count, model.tris.length / 9); assert.ok(model.engines.length);
  for (let i = 0; i < 60; i++) w.step(1 / 60, {});
  assert.ok(w.playerShip.alive); assert.ok(w.playerShip.body.position.every(Number.isFinite));
  const pcm = renderSound('dock'); assert.ok(pcm.length > 1000); assert.ok(Array.from(pcm).some(v => v !== 0));
});
test('a real custom survey advances, resets out of range, pays once and persists completion', () => {
  const p = fresh(), job = jobsAt(p, home).find(j => j.modMission === 'first-survey');
  assert.ok(job); assert.ok(acceptJob(p, job).ok); assert.match(missionObjective(p), /Survey/);
  assert.ok(sanitizeSave(p));
  const w = new World(p), target = iron ? [job.pos[0], 0, job.pos[1]] : job.waypoint;
  w.playerShip.body.position = [...target]; w.playerShip.body.velocity = [0,0,0];
  for (let i = 0; i < 120; i++) w.step(1/60, {});
  assert.ok(p.mission.scanned > 1.9);
  w.playerShip.body.position[0] += 500; w.step(1/60, {}); assert.equal(p.mission.scanned, 0);
  w.playerShip.body.position = [...target];
  const credits = p.credits;
  for (let i = 0; i < 500; i++) w.step(1/60, {});
  assert.equal(p.mission, null); assert.equal(p.credits, credits + job.reward); assert.equal(p.stats.missions, 1);
  assert.deepEqual(p.modState.completed, ['first-survey']); assert.ok(sanitizeSave(p));
  assert.ok(!jobsAt(p, home).some(j => j.modMission === 'first-survey'));
  w.step(1/60, {}); assert.equal(p.credits, credits + job.reward);
});
test('native mod freight obeys destination, payment and repeatability', () => {
  const p = fresh(), job = jobsAt(p, home).find(j => j.modMission === 'open-freight');
  assert.ok(acceptJob(p, job).ok); assert.ok(sanitizeSave(p)); assert.equal(missionOnDock(p, home), null);
  const credits = p.credits; assert.ok(missionOnDock(p, iron ? job.dest : job.base)); assert.equal(p.credits, credits + job.reward);
  assert.ok(jobsAt(p, home).some(j => j.modMission === 'open-freight'));
});
test('bad custom saves and invalid native mission references are rejected', () => {
  const p = fresh(), job = jobsAt(p, home).find(j => j.modMission === 'first-survey'); acceptJob(p, job);
  p.mission.scanSeconds = Infinity; assert.equal(sanitizeSave(p), null);
  assert.throws(() => validateMission({...job, at: 'missing'}, mods.custom(job.kind)));
  if (!iron) assert.throws(() => validateMission({...job, waypoint: [16500, -500, 6500]}, mods.custom(job.kind)), /planet/);
});
