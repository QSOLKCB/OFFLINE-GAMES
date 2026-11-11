// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {World, SENSOR} from '../js/sim/world.js';
import {newPlayer, sanitizeSave} from '../js/sim/player.js';
import {SYSTEMS} from '../js/sim/data.js';
import {AMBIENT_LIMIT, ENCOUNTER_RESERVE, nearestHostile} from '../js/sim/encounters.js';
import {PilotGamepad} from '../js/controller.js';

const run = (w, seconds, command = {}) => { for (let i = 0; i < Math.ceil(seconds * 60); i++) { w.step(1 / 60, command); w.events.length = 0; } };
const kill = (w, s, source = w.playerShip) => w.damage(s, 1e7, 1e7, source);
const pad = (buttons = [], axes = [0, 0, 0, 0], id = 'test pad') => ({index: 0, id, mapping: 'standard', connected: true, axes, buttons: Array.from({length: 17}, (_, i) => ({value: buttons.includes(i) ? 1 : 0, pressed: buttons.includes(i)}))});
function encounter(stage = 0, seed = 1) {
  const p = newPlayer(seed); p.patrols = stage;
  const w = new World(p); w.playerShip.invuln = true;
  run(w, 15); assert.ok(w.encounters.active?.enemies, w.encounters.status);
  return w;
}

test('free roam supplies a marked hostile encounter near the starting port across seeds', () => {
  for (let seed = 1; seed <= 16; seed++) {
    const w = encounter(0, seed), e = w.encounters.active;
    assert.equal(e.enemies.length, 2);
    assert.ok(e.enemies.every(s => w.hostile(s, w.playerShip)));
    assert.ok(w.contacts().some(c => c.attitude === 'hostile'));
    assert.ok(e.enemies.every(s => w.distance(s, w.playerShip) > 500));
    assert.equal(w.waypoint().label, e.title);
    assert.ok(w.ships.length <= 1 + AMBIENT_LIMIT + ENCOUNTER_RESERVE);
  }
});
test('scouts, rescue and ace produce distinct formations and advance only after player participation', () => {
  for (let stage = 0; stage < 3; stage++) {
    const w = encounter(stage), e = w.encounters.active, p = w.player;
    assert.equal(e.wards.length, stage === 1 ? 1 : 0);
    assert.equal(e.enemies.some(s => s.boss), stage === 2);
    assert.equal(e.enemies.length, stage === 0 ? 2 : 3);
    // A single player hit counts when a patrol lands the finishing shot.
    w.damage(e.enemies[0], 1, 1, w.playerShip);
    for (const s of e.enemies) kill(w, s, null);
    const before = p.credits, earned = p.stats.earned;
    run(w, 1 / 60);
    assert.equal(p.patrols, stage + 1); assert.equal(p.credits - before, e.reward); assert.equal(p.stats.earned - earned, e.reward);
    assert.equal(w.encounters.active, null); assert.equal(w.encounters.stage, (stage + 1) % 3);
    run(w, 3); assert.equal(p.credits - before, e.reward, 'no duplicate completion');
    assert.ok(e.wards.every(s => !s.encounter && !s.encounterWard));
    assert.equal(sanitizeSave(JSON.stringify(p)).patrols, stage + 1);
  }
});
test('NPC-only victories and lost rescue wards do not pay or advance the arc', () => {
  for (const mode of ['npc', 'ward']) {
    const w = encounter(mode === 'ward' ? 1 : 0), e = w.encounters.active, before = w.player.patrols;
    for (const s of e.enemies) kill(w, s, mode === 'npc' ? null : w.playerShip);
    if (mode === 'ward') kill(w, e.wards[0], null);
    const credits = w.player.credits; run(w, 1 / 60);
    assert.equal(w.player.patrols, before); assert.equal(w.player.credits, credits);
    assert.equal(w.encounters.active, null);
  }
});
test('contracts, cruise, traffic:false, docking and death gate the director; fleeing expires a signal', () => {
  const quiet = new World(newPlayer(), {traffic: false}); run(quiet, 30); assert.equal(quiet.encounters.active, null);
  for (const state of ['contract', 'cruise', 'docked', 'dead']) {
    const w = new World(newPlayer());
    if (state === 'contract') w.player.mission = {kind: 'courier', system: 'meridian', base: 'brightwater'};
    if (state === 'cruise') w.playerShip.cruise = {state: 'on', t: 0};
    if (state === 'docked') w.docked = w.player.base;
    if (state === 'dead') w.over = true;
    // Test the director gate directly, without flight collisions dropping cruise.
    for (let i = 0; i < 2000; i++) w.encounters.step(1 / 60);
    assert.equal(w.encounters.active, null, state);
  }
  const w = encounter(), e = w.encounters.active; w.playerShip.body.position = [50000, 0, 50000];
  run(w, 1 / 60); assert.equal(w.encounters.active, null); assert.equal(w.player.patrols, 0);
  assert.ok(e.enemies.every(s => !s.encounter));
});
test('old saves migrate, invalid progression is rejected and quiet periods do not immediately refill combat', () => {
  const old = newPlayer(); delete old.patrols; assert.equal(sanitizeSave(old).patrols, 0);
  for (const value of [-1, 1.5, null, '2', Infinity, 2 ** 53]) assert.equal(sanitizeSave({...old, patrols: value}), null);
  const w = encounter(), e = w.encounters.active;
  for (const s of e.enemies) kill(w, s);
  run(w, 1); assert.equal(w.encounters.active, null); run(w, 30); assert.equal(w.encounters.active, null);
});
test('nearest hostile reduction agrees with the sorted reference, including ties and sensor boundary', () => {
  const w = encounter();
  const ref = () => w.contacts().find(c => c.attitude === 'hostile')?.ship ?? null;
  for (let i = 0; i < 200; i++) {
    for (const [j, s] of w.ships.entries()) if (!s.isPlayer) s.body.position = [i * 53 - j * 74, j * 13, i * 19];
    assert.equal(nearestHostile(w, SENSOR), ref());
  }
  const enemies = w.encounters.active.enemies;
  for (const s of w.ships) if (!s.isPlayer) s.body.position = [1e6, 0, 0];
  w.playerShip.body.position = [0, 0, 0]; enemies[0].body.position = [SENSOR, 0, 0];
  assert.equal(nearestHostile(w, SENSOR), null);
  enemies[0].body.position = [100, 0, 0]; enemies[1].body.position = [-100, 0, 0];
  assert.equal(nearestHostile(w, SENSOR), enemies[0]); assert.equal(nearestHostile(w, SENSOR), ref());
});
test('seeded encounter replay is stable and ten minutes of roaming stays bounded', () => {
  const snapshot = w => [w.player.patrols, w.encounters.active?.title, w.ships.map(s => [s.id, s.name, s.body.position, s.hp])];
  const a = encounter(0, 9), b = encounter(0, 9); run(a, 30); run(b, 30); assert.deepEqual(snapshot(a), snapshot(b));
  let maximum = 0;
  for (let i = 0; i < 600 * 60; i++) {
    a.step(1 / 60); a.events.length = 0;
    maximum = Math.max(maximum, a.ships.filter(s => !s.isPlayer && s.alive && !s.gone).length);
    assert.ok(a.ships.every(s => s.body.position.every(Number.isFinite)));
  }
  assert.ok(maximum <= AMBIENT_LIMIT + ENCOUNTER_RESERVE, `peak ${maximum}`);
});
test('signals can be selected and approached without selecting a trade ring', () => {
  const w = encounter(); w.targetSignal(); w.use();
  assert.equal(w.target.kind, 'signal'); assert.equal(w.auto.target.kind, 'signal');
  run(w, 3); assert.equal(w.playerShip.lane, null); assert.equal(w.targetObject().type, 'signal');
});
test('automatic lane arrival selects its destination; the next use docks instead of boarding again', () => {
  for (const reverse of [false, true]) {
    const w = new World(newPlayer(), {traffic: false}), me = w.playerShip;
    const lane = w.sector.lanes.find(l => l.to.type === 'base' && l.from.type === 'base');
    const ring = lane.rings[reverse ? lane.rings.length - 1 : 0], destination = reverse ? lane.from : lane.to;
    me.body.position = [...ring.pos]; w.targetPoi(ring.id); w.use(); assert.ok(me.lane);
    for (let i = 0; i < 3600 && me.lane; i++) w.step(1 / 60);
    assert.equal(me.lane, null); assert.equal(w.target.id, destination.id);
    w.use();
    for (let i = 0; i < 3600 && !w.docked; i++) { w.step(1 / 60); assert.equal(me.lane, null); }
    assert.equal(w.docked, destination.id);
  }
});
test('explicit destination survives lane exit and an unselected usable port outranks its ring', () => {
  const w = new World(newPlayer(), {traffic: false}), me = w.playerShip, lane = w.sector.lanes.find(l => l.to.type === 'base');
  me.body.position = [...lane.rings[0].pos]; w.targetPoi(lane.rings[0].id); w.use();
  w.targetPoi(lane.to.id); w.use(); assert.equal(me.lane, null); assert.equal(w.auto?.target.id, lane.to.id);
  const port = lane.to; me.body.position = port.pos.map((v, i) => v + (i === 0 ? port.radius + 390 : 0));
  w.target = null; w.auto = null; w.use(); assert.equal(w.docked, port.id);
});
test('gamepad uses neutral arming, edges, finite deadzones and no repeated missile fire', () => {
  const g = new PilotGamepad();
  assert.equal(g.sample([pad([7])]).held.size, 0);
  g.sample([pad()]); const fire = g.sample([pad([7, 2], [0.5, -1, 1, -0.5])]);
  assert.ok(fire.held.has('fire')); assert.ok(fire.pressed.has('missile')); assert.equal(fire.throttle, 1); assert.equal(fire.turn[1], -1);
  assert.equal(g.sample([pad([7, 2])]).pressed.size, 0);
  g.sample([pad([], [NaN, Infinity, 0.1, -0.1])]); assert.deepEqual(g.sample([pad([], [NaN, Infinity, 0.1, -0.1])]).turn, [0, 0]);
  assert.equal(g.sample([pad([7])], 'map').held.size, 0);
  g.sample([pad()], 'map'); assert.ok(g.sample([pad([8])], 'map').pressed.has('map'));
  assert.equal(g.sample([]).connected, false); assert.equal(g.sample([pad([7])]).held.size, 0);
  g.sample([pad()]); assert.equal(g.sample([pad([7], undefined, 'replacement')]).held.size, 0);
  assert.equal(g.sample([{...pad(), mapping: ''}]).connected, false);
});
test('all gamepad verbs are reachable and menu repeat is bounded', () => {
  const g = new PilotGamepad();g.sample([pad()]);
  const wanted = ['use','brake','missile','hostile','next','cruise','burn','fire','map','pause','drift','signal','kit','cell','poi','tractor'];
  for (let i = 0; i < wanted.length; i++) { g.sample([pad()]); assert.ok(g.sample([pad([i])]).pressed.has(wanted[i])); }
  g.sample([pad()], 'menu', 0); assert.equal(g.sample([pad([13])], 'menu', 1).nav, 1);
  assert.equal(g.sample([pad([13])], 'menu', 100).nav, 0); assert.equal(g.sample([pad([13])], 'menu', 402).nav, 1);
});
