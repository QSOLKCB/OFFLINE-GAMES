// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {World} from '../js/sim/world.js';
import {newPlayer} from '../js/sim/player.js';
import {FixedClock} from '../vendor/vanillajs/modules/time/index.js';
import {waitForState} from '../../tests/browser-wait.mjs';

function approach() {
  const world = new World(newPlayer(1), {traffic: false});
  const clock = new FixedClock({step: 1 / 60, maxSteps: 6}); // production app limits
  const ring = world.sector.pois.find(p => p.type === 'ring' && !p.minor && p.name.includes('Tollard'));
  world.targetPoi(ring.id); world.use();
  return {world, frame: seconds => clock.advance(Math.min(seconds, 0.25), dt => world.step(dt))};
}

test('slow frames reproduce the wall-time slingway timeout with only eight seconds of flight', () => {
  const {world, frame} = approach();
  for (let wall = 0; wall < 40; wall += 0.5) frame(0.5);
  assert.ok(Math.abs(world.time - 8) < 1e-9);
  assert.equal(world.playerShip.lane, null);
  assert.ok(world.auto, 'the ship is still approaching, not stuck or dead');
  assert.ok(Math.abs(Math.hypot(...world.playerShip.body.velocity) - 46.8) < 0.1);
});

test('delivering every animation frame reaches the slingway within the same 40-second budget', async () => {
  const {world, frame} = approach();
  let browserMs = 0, nextFrame = 16;
  await waitForState('slingway', async () => ({lane: !!world.playerShip.lane}), state => state.lane, 40, async ms => {
    browserMs += ms;
    while (nextFrame <= browserMs) { frame(0.016); nextFrame += 16; }
  });
  assert.ok(world.playerShip.lane);
  assert.ok(world.time < 10);
  assert.equal(world.playerShip.hp, world.playerShip.maxHp);
});
