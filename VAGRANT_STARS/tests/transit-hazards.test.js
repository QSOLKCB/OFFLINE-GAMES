// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {World, buildSector, lookQuat} from '../js/sim/world.js';
import {newPlayer} from '../js/sim/player.js';
import {SYSTEMS, HULLS} from '../js/sim/data.js';
import {ATMOSPHERE_SCALE, STELLAR_HEAT_SCALE, hazardFreeApproach, hazardRoute} from '../js/sim/hazards.js';

const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
function world(system = 'meridian', hull = 'sparrow') {
  const p = newPlayer(1); p.system = system; p.base = SYSTEMS[system].bases[0].id;
  p.hull = hull; p.hp = HULLS[hull].hp;
  for (const faction in p.rep) p.rep[faction] = 1;
  return new World(p, {traffic: false});
}
function tickSafe(w, dt = 1 / 60) {
  const oldSystem = w.system, before = [...w.playerShip.body.position];
  w.step(dt);
  const me = w.playerShip;
  assert.equal(w.over, false);
  assert.equal(me.hp, me.maxHp, 'transit must not damage the hull');
  assert.equal(me.shield, me.maxShield, 'transit must not damage shields');
  assert.ok(!w.events.some(e => e.type === 'playerHit' || /Atmospheric burn|temperature critical/.test(e.text ?? '')));
  assert.ok(me.body.position.every(Number.isFinite));
  assert.ok(hazardFreeApproach(w.system, me.body.position, me.body.position, me.radius));
  if (w.system === oldSystem) assert.ok(hazardFreeApproach(w.system, before, me.body.position, me.radius), 'the swept flight segment clears hazards');
  w.events.length = 0;
}
function finish(w, done, seconds = 240, dt = 1 / 60) {
  for (let i = 0; i < seconds / dt && !done(); i++) tickSafe(w, dt);
  assert.ok(done(), `did not arrive: ${w.system.id}/${w.target?.id} at ${w.playerShip.body.position}`);
}
function depart(w, from) {
  if (from.startsWith('g-')) {
    const gate = w.system.gates.find(g => g.id === from);
    w.enterSystem(w.system.id, {fromSystem: gate.to});
  } else w.enterSystem(w.system.id, {base: from});
}

test('Calder slingway approaches, both rides, docking and fold jump stay clear in every stock hull', () => {
  for (const hull of Object.keys(HULLS)) for (const reverse of [false, true]) {
    const w = world('meridian', hull), lane = w.sector.lanes.find(l => l.to.id === 'g-ostrava');
    assert.ok(lane.points.length > 2, 'the original straight rail crosses Calder');
    const from = reverse ? 'g-ostrava' : 'calder', destination = reverse ? 'calder' : 'g-ostrava';
    depart(w, from);
    const liveLane = w.sector.lanes.find(l => l.to.id === 'g-ostrava');
    w.targetPoi(liveLane.rings[reverse ? liveLane.rings.length - 1 : 0].id); w.use();
    finish(w, () => !!w.playerShip.lane);
    finish(w, () => !w.playerShip.lane);
    assert.equal(w.target.id, destination, 'arrival keeps the intended docking/jump target');
    w.use();
    finish(w, () => reverse ? w.docked === 'calder' : w.system.id === 'ostrava');
    assert.equal(w.auto, null);
  }
});

test('all authored slingways clear hazards in both directions, including their exits and destination use', () => {
  for (const system of Object.values(SYSTEMS)) {
    const sector = buildSector(system);
    assert.equal(sector.lanes.length, system.lanes.length, 'no stock route disappears');
    for (const lane of sector.lanes) for (const reverse of [false, true]) {
      const w = world(system.id), live = w.sector.lanes.find(l => l.id === lane.id);
      const ring = reverse ? live.rings.at(-1) : live.rings[0], destination = reverse ? live.from : live.to;
      w.playerShip.body.position = [...ring.pos]; w.targetPoi(ring.id); w.use();
      assert.ok(w.playerShip.lane);
      // A coarse tick also checks swept chords across bends, not just sampled positions.
      finish(w, () => !w.playerShip.lane, 60, 1 / 20);
      assert.equal(w.target.id, destination.id);
      w.use();
      finish(w, () => destination.type === 'base' ? w.docked === destination.id : w.system.id === destination.def.to);
    }
  }
});

test('autopilot routes every stock port/gate pair safely from real launch and gate-arrival positions', () => {
  for (const system of Object.values(SYSTEMS)) {
    const places = [...system.bases, ...system.gates];
    for (const from of places) for (const to of places) if (from !== to) {
      const w = world(system.id); depart(w, from.id);
      w.targetPoi(to.id); w.use();
      finish(w, () => to.to ? w.system.id === to.to : w.docked === to.id, 360, 1 / 30);
    }
  }
});

test('previously fatal direct approaches and go-to work with the slowest-turning freighter', () => {
  for (const [from, to] of [['tollard', 'g-ostrava'], ['g-ostrava', 'calder'], ['g-ostrava', 'tollard']]) {
    for (const use of [false, true]) {
      const w = world('meridian', 'caravel'); depart(w, from); w.targetPoi(to);
      if (use) w.use(); else w.goTo();
      finish(w, () => use ? !!w.docked || w.system.id === 'ostrava' : !w.auto, 360);
      if (!use) {
        const target = w.targetObject();
        assert.ok(distance(w.playerShip.body.position, target.pos) <= target.radius + 265);
      }
    }
  }
});

test('leaving a bent slingway early preserves its local travel direction', () => {
  for (const reverse of [false, true]) {
    const w = world(), lane = w.sector.lanes.find(l => l.to.id === 'g-ostrava');
    const ring = lane.rings.find(r => r.minor && r.s > lane.distances[1] + 10);
    const me = w.playerShip;
    me.body.position = [...ring.pos];
    me.body.orientation = [...ring.q];
    if (reverse) me.body.orientation = lookQuat(w.forward(me).map(v => -v));
    w.targetPoi(ring.id); w.use(); assert.equal(me.lane.dir, reverse ? -1 : 1);
    tickSafe(w);
    const velocity = [...me.body.velocity], speed = Math.hypot(...velocity);
    w.use(); assert.equal(me.lane, null);
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(me.body.velocity[i] / 200 - velocity[i] / speed) < 1e-9);
  }
});

test('route planner handles diameter crossings, stellar heat and multiple bodies; invalid endpoints fail closed', () => {
  const system = {star: {pos: [1e6, 0, 0], radius: 100}, planets: [{pos: [0, 0, 0], radius: 2600}]};
  for (const sample of [system, {...system, planets: [...system.planets, {pos: [9000, 0, 0], radius: 2200}]},
    {star: {pos: [0, 0, 0], radius: 2600}, planets: []}]) {
    const route = hazardRoute(sample, [-12000, 0, 0], [18000, 0, 0]);
    assert.ok(route && route.length > 2);
    assert.deepEqual(route, hazardRoute(sample, [-12000, 0, 0], [18000, 0, 0]), 'deterministic detour');
    for (let i = 1; i < route.length; i++) assert.ok(hazardFreeApproach(sample, route[i - 1], route[i], 650));
  }
  assert.equal(hazardRoute(system, [-6000, 0, 0], [0, 0, 0]), null);
  assert.equal(hazardRoute(system, [0, 0, 0], [6000, 0, 0]), null);
  const clear = [-6000, 9000, 0];
  assert.deepEqual(hazardRoute(system, clear, clear), [clear, clear]);
});

test('unsafe autopilot targets disengage and brake; manual atmospheric and stellar damage remain active', () => {
  const w = world(), me = w.playerShip, gate = w.sector.byId.get('g-ostrava');
  gate.pos = [...w.system.planets[0].pos];
  w.targetPoi(gate.id); w.use(); w.step(1 / 60);
  assert.equal(w.auto, null); assert.equal(me.throttle, 0); assert.equal(me.cruise.state, 'off');
  assert.ok(w.events.some(e => /no safe approach/.test(e.text ?? '')));
  for (const [body, scale] of [[w.system.planets[0], ATMOSPHERE_SCALE], [w.system.star, STELLAR_HEAT_SCALE]]) {
    const fresh = world(), ship = fresh.playerShip;
    ship.body.position = body.pos.map((v, i) => v + (i === 0 ? body.radius * scale - 10 : 0));
    fresh.step(1 / 60);
    assert.ok(ship.shield < ship.maxShield, 'manual flight into hazards still causes damage');
  }
});
