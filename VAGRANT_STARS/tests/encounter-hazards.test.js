// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {World, lookQuat} from '../js/sim/world.js';
import {newPlayer} from '../js/sim/player.js';
import {SYSTEMS} from '../js/sim/data.js';
import {hazardFreeApproach} from '../js/sim/hazards.js';

const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
function placePlayer(w, pos) {
  const me = w.playerShip;
  w.ships = [me]; w.byId = new Map([[me.id, me]]); w.spawnT = Infinity;
  me.body.position = [...pos]; me.body.velocity = [0, 0, 0];
  me.body.orientation = lookQuat([0, 0, -1]); me.throttle = 0;
}

test('Calder reproduction: signal and formation clear the atmosphere; autopilot arrives without damage', () => {
  const w = new World(newPlayer(1)), me = w.playerShip, planet = w.system.planets[0];
  placePlayer(w, [16500, -500, 10100]);
  for (let i = 0; i < 540; i++) w.step(1 / 60);
  const e = w.encounters.active;
  assert.ok(e);
  assert.ok(distance(e.pos, planet.pos) > planet.radius * 1.03 + 650, 'the whole formation must clear the atmosphere');

  // Isolate navigation from combat damage without making the player invulnerable.
  const startEncounter = w.startEncounter.bind(w);
  w.startEncounter = (...args) => {
    const formation = startEncounter(...args);
    for (const ship of [...formation.enemies, ...formation.wards]) {
      assert.ok(distance(ship.body.position, planet.pos) > planet.radius * 1.03 + ship.radius);
      ship.guns = []; ship.launcher = null;
    }
    return formation;
  };
  w.targetSignal(); w.use(); assert.ok(w.auto);
  const hp = me.hp, shield = me.shield;
  w.events.length = 0;
  for (let i = 0; i < 3600 && w.auto && !w.over; i++) {
    w.step(1 / 60);
    assert.ok(distance(me.body.position, planet.pos) > planet.radius * 1.03);
    assert.ok(!w.events.some(event => event.type === 'playerHit'));
    w.events.length = 0;
  }
  assert.ok(e.enemies, 'the actual encounter must spawn during approach');
  assert.equal(w.over, false); assert.equal(w.auto, null);
  assert.equal(me.hp, hp); assert.equal(me.shield, shield);
  assert.ok(distance(me.body.position, e.pos) <= 510);
});

test('planetary approach rejects crossing and tangent paths, including the formation footprint', () => {
  const system = {star: {pos: [1e6, 0, 0], radius: 100}, planets: [{pos: [0, 0, 0], radius: 2600}]};
  // Both endpoints are outside the atmosphere, but the route crosses the planet.
  assert.equal(hazardFreeApproach(system, [-5000, 0, 0], [5000, 0, 0], 650), false);
  // Calder's atmosphere ends at 2678; the 650-unit formation reaches 3328.
  for (const y of [2679, 3327, 3328]) {
    assert.equal(hazardFreeApproach(system, [-2000, y, 0], [2000, y, 0], 650), false);
  }
  assert.equal(hazardFreeApproach(system, [-2000, 3329, 0], [2000, 3329, 0], 650), true);
  assert.equal(hazardFreeApproach(system, [0, 3329, 0], [0, 3329, 0], 650), true);
  assert.equal(hazardFreeApproach(system, [0, 0, 0], [0, 0, 0], 650), false);
});

test('stellar heat uses its damage boundary plus formation clearance', () => {
  const system = {star: {pos: [0, 0, 0], radius: 100}, planets: []};
  for (const y of [171, 819, 820]) {
    assert.equal(hazardFreeApproach(system, [-2000, y, 0], [2000, y, 0], 650), false);
  }
  assert.equal(hazardFreeApproach(system, [-2000, 821, 0], [2000, 821, 0], 650), true);
});

test('all systems offer clear planetary signals and keep the rescue formation outside hazards', () => {
  for (const system of Object.values(SYSTEMS)) for (const planet of system.planets) {
    for (let seed = 1; seed <= 4; seed++) {
      const p = newPlayer(seed); p.patrols = 1;
      const w = new World(p); w.enterSystem(system.id);
      placePlayer(w, [planet.pos[0], planet.pos[1], planet.pos[2] + planet.radius * 1.03 + 900]);
      w.encounters.step(9);
      const e = w.encounters.active;
      assert.ok(e, `${system.id}/${planet.name}/${seed}`);
      for (const body of system.planets) assert.ok(distance(e.pos, body.pos) > body.radius * 1.03 + 650);
      assert.ok(distance(e.pos, system.star.pos) > system.star.radius * 1.7 + 650);
      w.encounters.step(6);
      assert.equal(e.wards.length, 1);
      for (const ship of [...e.enemies, ...e.wards]) {
        for (const body of system.planets) assert.ok(distance(ship.body.position, body.pos) > body.radius * 1.03 + ship.radius);
        assert.ok(distance(ship.body.position, system.star.pos) > system.star.radius * 1.7 + ship.radius);
      }
    }
  }
});

test('hazard proximity defers a signal until a clear approach is available', () => {
  const w = new World(newPlayer(1)), planet = w.system.planets[0];
  // Outside the damaging atmosphere, but too close to fit a formation safely.
  placePlayer(w, [planet.pos[0], planet.pos[1], planet.pos[2] + planet.radius * 1.03 + 100]);
  w.encounters.step(9); assert.equal(w.encounters.active, null);
  assert.match(w.encounters.status, /hazard/);
  placePlayer(w, [16500, -500, 10100]);
  w.encounters.step(1);
  assert.ok(w.encounters.active);
});
