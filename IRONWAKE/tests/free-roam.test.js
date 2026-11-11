// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {World, SENSOR, forward2, headingOf, yawQuat} from '../js/sim/world.js';
import {newPlayer, sanitizeSave} from '../js/sim/player.js';
import {SQUADRONS} from '../js/sim/data.js';
import {AMBIENT_LIMIT, ENCOUNTER_RESERVE, MAX_AMBIENT_GROUP, FORMATION_RADIUS, clearSignalApproach} from '../js/sim/encounters.js';
import {CaptainGamepad} from '../js/controller.js';

const run = (w, seconds, command = {}) => { for (let i = 0; i < Math.ceil(seconds * 60); i++) { w.step(1 / 60, command); w.events.length = 0; } };
const kill = (w, s, source = w.playerShip) => w.damage(s, 1e7, s.body.position[0] + 100, s.body.position[2], source);
const population = w => w.ships.filter(s => !s.isPlayer && s.alive && !s.gone).length;
function encounter(stage = 0, seed = 1) {
  const p = newPlayer(seed); p.patrols = stage;
  const w = new World(p); run(w, 18);
  assert.ok(w.encounters.active?.enemies, w.encounters.status);
  return w;
}
const pad = (buttons = [], axes = [0, 0, 0, 0], id = 'test pad') => ({index: 0, id, mapping: 'standard', connected: true, axes, buttons: Array.from({length: 17}, (_, i) => ({value: buttons.includes(i) ? 1 : 0, pressed: buttons.includes(i)}))});

test('sixteen starting seeds provide a capital-ship encounter with a warning and marked signal', () => {
  for (let seed = 1; seed <= 16; seed++) {
    const w = new World(newPlayer(seed)); run(w, 11);
    assert.ok(w.encounters.active); assert.equal(w.encounters.active.enemies, null);
    assert.equal(w.waypoint().signal, true);
    run(w, 7);
    const e = w.encounters.active;
    assert.equal(e.enemies.length, 3);
    assert.equal(e.enemies.filter(s => s.kind === 'capital').length, 1);
    assert.ok(e.enemies.every(s => w.hostile(s, w.playerShip)));
    assert.ok(w.contacts().some(c => c.attitude === 'hostile'));
    assert.ok(population(w) <= AMBIENT_LIMIT + ENCOUNTER_RESERVE);
    assert.ok(e.enemies.every(s => w.distance(s, w.playerShip) > 900));
  }
});

test('picket, rescue and flagship advance only once and preserve optional save progression', () => {
  for (let stage = 0; stage < 3; stage++) {
    const w = encounter(stage), e = w.encounters.active, p = w.player;
    assert.equal(e.wards.length, stage === 1 ? 1 : 0);
    assert.equal(e.enemies.some(s => s.boss), stage === 2);
    if (stage === 1) {
      assert.ok(e.wards[0].encounterWard);
      assert.equal(e.wards[0].throttle, 0);
      assert.ok(e.enemies.every(s => s.ai.preyId === e.wards[0].id));
    }
    w.damage(e.enemies[0], 1, 0, 0, w.playerShip);
    for (const s of e.enemies) kill(w, s, null); // the Watch may finish ships the player fought
    const credits = p.credits, earned = p.stats.earned;
    w.targetSignal(); run(w, 1 / 60);
    assert.equal(p.patrols, stage + 1); assert.equal(p.credits - credits, e.reward); assert.equal(p.stats.earned - earned, e.reward);
    assert.equal(w.encounters.active, null); assert.equal(w.dest, null);
    assert.ok(e.wards.every(s => !s.encounterWard && !s.encounter));
    run(w, 1); assert.equal(p.credits - credits, e.reward);
    assert.equal(sanitizeSave(JSON.stringify(p)).patrols, stage + 1);
  }
});

test('NPC-only victories, lost relief ships, friendly fire and escaped attackers cannot earn patrol bonuses', () => {
  for (const failure of ['npc', 'ward', 'friendly', 'escape']) {
    const w = encounter(failure === 'ward' || failure === 'friendly' ? 1 : 0), e = w.encounters.active;
    if (failure === 'ward') kill(w, e.wards[0], null);
    if (failure === 'friendly') w.damage(e.wards[0], 1, 0, 0, w.playerShip);
    for (const s of e.enemies) if (failure === 'escape') s.gone = true; else kill(w, s, failure === 'npc' ? null : w.playerShip);
    const before = w.player.credits, stage = w.player.patrols;
    run(w, 1 / 60);
    assert.equal(w.player.credits, before); assert.equal(w.player.patrols, stage); assert.equal(w.encounters.active, null);
  }
});

test('contracts, critical hull, docking, death, warp and disabled traffic gate new calls', () => {
  for (const state of ['contract', 'hull', 'docked', 'dead', 'warp', 'quiet']) {
    const w = new World(newPlayer());
    if (state === 'contract') w.player.mission = {kind: 'delivery', dest: 'tinder'};
    if (state === 'hull') w.playerShip.hp = w.playerShip.maxHp * 0.39;
    if (state === 'docked') w.docked = 'anchorage';
    if (state === 'dead') w.over = true;
    if (state === 'warp') w.playerShip.warp = {state: 'on', t: 0};
    if (state === 'quiet') w.traffic = false;
    for (let i = 0; i < 1800; i++) w.encounters.step(1 / 60);
    assert.equal(w.encounters.active, null, state);
  }
  const w = encounter(), e = w.encounters.active;
  w.player.mission = {kind: 'delivery', dest: 'tinder'}; w.encounters.step(1 / 60);
  assert.equal(w.encounters.active, null); assert.ok(e.enemies.every(s => !s.encounter));
});

test('signals survive warp toward their beacon, expire on departure, and leave recovery time', () => {
  const w = new World(newPlayer()); run(w, 11);
  const e = w.encounters.active;
  w.targetSignal(); assert.equal(w.destination().signal, true);
  w.toggleWarp(); w.encounters.step(1);
  assert.equal(w.encounters.active, e, 'intentional signal approach is retained');
  w.stop(); run(w, 7);
  assert.ok(e.enemies);
  for (const s of e.enemies) kill(w, s);
  run(w, 1 / 60); assert.equal(w.encounters.active, null);
  run(w, 45); assert.equal(w.encounters.active, null, '55-second recovery');
  const b = encounter(); b.playerShip.body.position = [50000, 0, 50000];
  b.encounters.step(1 / 60); assert.equal(b.encounters.active, null); assert.equal(b.player.patrols, 0);
  const c = new World(newPlayer()); run(c, 11); c.selectDest('coldharbor'); c.toggleWarp();
  c.encounters.step(1); assert.equal(c.encounters.active, null, 'unrelated warp hands off the warning');
  const d = encounter(); d.encounters.active.ttl = 0; d.encounters.step(1 / 60);
  assert.equal(d.encounters.active, null);
});

test('beacons keep the full rescue formation out of solids and reject obstructed approaches', () => {
  const w = new World(newPlayer());
  w.playerShip.body.position = [6000, 0, 6000];
  const pos = [8800, 6000];
  assert.equal(clearSignalApproach(w, pos), true);
  const solid = {box: {min: [6480, -30, 5980], max: [6520, 30, 6020]}, x: 6500, z: 6000, r: 29, stamp: 0, dead: false};
  w.sector.grid.add(solid);
  assert.equal(w.sector.grid.query(...pos, FORMATION_RADIUS).length, 0, 'endpoint itself is clear');
  assert.equal(clearSignalApproach(w, pos), false, 'route crosses the solid');
  solid.dead = true; assert.equal(clearSignalApproach(w, pos), true, 'destroyed rocks release the route');
  for (const station of w.sector.stations) assert.equal(clearSignalApproach(w, station.xz), false);
  const rescue = encounter(1), e = rescue.encounters.active;
  for (const s of [...e.enemies, ...e.wards]) {
    assert.ok(rescue.sector.grid.query(s.body.position[0], s.body.position[2], s.radius).length === 0);
    assert.ok(Math.hypot(s.body.position[0] - e.pos[0], s.body.position[2] - e.pos[1]) + s.radius < FORMATION_RADIUS);
  }
  const blocked = new World(newPlayer()); blocked.sector.grid.query = () => [{box: solid.box}];
  blocked.encounters.step(20); assert.equal(blocked.encounters.active, null);
  assert.match(blocked.encounters.status, /debris/);
});

test('completed contract courses cannot silently become new shipping-signal courses', () => {
  const w = new World(newPlayer());
  w.player.mission = {kind: 'delivery', dest: 'tinder'}; w.selectDest('contract');
  assert.equal(w.destination().label, 'Tinder Works');
  w.player.mission = null; w.encounters.active = {pos: [6000, 6000], title: 'New signal'};
  assert.equal(w.destination(), null);
  w.cycleDest(); assert.equal(w.dest, 'signal'); assert.equal(w.destination().signal, true);
  w.cycleDest(-1); assert.ok(w.destination().station);
  w.cycleDest(); assert.equal(w.dest, 'signal');
  w.selectDest('contract'); assert.equal(w.dest, 'signal', 'a missing contract cannot be selected');
});

test('warp aligns before accelerating toward nearby beam or astern signals', () => {
  for (const angle of [Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const w = new World(newPlayer(), {traffic: false}); w.traffic = true; w.spawnT = Infinity;
    const me = w.playerShip, pos = [5000 + Math.sin(angle) * 1800, 5000 - Math.cos(angle) * 1800];
    me.body.position = [5000, 0, 5000]; me.body.orientation = yawQuat(0);
    w.encounters.active = {stage: 0, title: 'Nearby signal', pos, warning: 7, ttl: 300, enemies: null, wards: [], reward: 0};
    const e = w.encounters.active; w.targetSignal(); w.toggleWarp();
    let peak = 0;
    for (let i = 0; i < 1800 && me.warp.state !== 'off'; i++) {
      w.step(1 / 60); w.events.length = 0;
      peak = Math.max(peak, Math.hypot(me.body.position[0] - pos[0], me.body.position[2] - pos[1]));
    }
    assert.equal(me.warp.state, 'off'); assert.equal(w.encounters.active, e);
    assert.ok(peak < 2200, `approach strayed ${peak} units`);
    assert.ok(Math.hypot(me.body.position[0] - pos[0], me.body.position[2] - pos[1]) < 1700);
  }
});

test('ambient and warp insertion share a reserved budget; ten-minute free roam remains bounded', () => {
  assert.equal(Math.max(...SQUADRONS.filter(Boolean).map(list => list.reduce((sum, [, n]) => sum + n, 0))), MAX_AMBIENT_GROUP);
  const full = new World(newPlayer()); full.ships = [full.playerShip]; full.byId = new Map([[full.playerShip.id, full.playerShip]]);
  for (let i = 0; i < 2; i++) full.spawnSquadron({faction: 'watch', threat: 6, pos: [6000 + i * 1000, 6000], dest: [8000, 8000]});
  full.rng = () => 0; full.ambushT = 0; full.playerShip.warp = {state: 'on', t: 0};
  run(full, 1 / 60); assert.equal(population(full), AMBIENT_LIMIT);
  assert.equal(full.playerShip.warp.state, 'on', 'a full budget cannot insert a warp ambush');
  const w = encounter(); w.playerShip.hp = w.playerShip.maxHp = 1e9; // keep the population witness running through combat
  let peak = 0;
  for (let i = 0; i < 600 * 60; i++) {
    w.step(1 / 60); w.events.length = 0; peak = Math.max(peak, population(w));
    assert.ok(population(w) <= AMBIENT_LIMIT + ENCOUNTER_RESERVE);
    assert.ok(w.ships.every(s => s.body.position.every(Number.isFinite) && s.body.position[1] === 0));
  }
  assert.ok(w.time > 617); assert.ok(peak >= 7);
});

test('replays are deterministic and progression scales only with both rank and circuits', () => {
  const a = encounter(1, 9), b = encounter(1, 9); run(a, 12); run(b, 12);
  const snapshot = w => [w.encounters.active?.pos, w.ships.map(s => [s.id, s.name, s.body.position, s.hp])];
  assert.deepEqual(snapshot(a), snapshot(b));
  const low = newPlayer(); low.patrols = 11;
  const w = new World(low); assert.equal(w.startEncounter(2, [6000, 6000]).enemies[0].cls, 'cutter');
  const high = newPlayer(); high.patrols = 11; high.credits = 2e6;
  const h = new World(high), formation = h.startEncounter(2, [6000, 6000]);
  assert.equal(formation.enemies[0].cls, 'dreadnought'); assert.equal(formation.enemies.length, 3);
  assert.equal(formation.reward, 9600);
  const old = newPlayer(); delete old.patrols; assert.equal(sanitizeSave(old).patrols, 0);
  for (const bad of [-1, 0.5, null, '3', Infinity, 2 ** 53]) assert.equal(sanitizeSave({...old, patrols: bad}), null);
});

test('nearest-hostile reduction matches sorted contacts including ties and strict boundaries', () => {
  const w = encounter(), me = w.playerShip;
  for (let i = 0; i < 100; i++) {
    for (const [j, s] of w.ships.entries()) if (!s.isPlayer) s.body.position = [i * 53 - j * 79, 0, i * 31];
    for (const range of [1500, 1700, 3000, SENSOR]) assert.equal(w.nearestHostile(range), w.contacts().find(c => c.attitude === 'hostile' && c.dist < range)?.ship ?? null);
  }
  const foes = w.encounters.active.enemies; me.body.position = [0, 0, 0];
  for (const s of w.ships) if (!s.isPlayer) s.body.position = [1e6, 0, 0];
  foes[0].body.position = [SENSOR, 0, 0]; assert.equal(w.nearestHostile(), null);
  foes[0].body.position = [100, 0, 0]; foes[1].body.position = [-100, 0, 0];
  assert.equal(w.nearestHostile(), foes[0]); assert.equal(w.targetNearestHostile(), foes[0]);
  assert.equal(w.nearestHostile(100), null);
});

test('braking drops warp and enables docking; cancelled aim cannot release a ghost volley', () => {
  const w = new World(newPlayer(), {traffic: false}), me = w.playerShip, f = forward2(headingOf(me));
  me.warp = {state: 'on', t: 0}; me.body.velocity = [f[0] * 2400, 0, f[1] * 2400];
  run(w, 1 / 60, {brake: true, throttle: 1});
  assert.equal(me.warp.state, 'off'); assert.equal(me.throttle, 0);
  assert.ok(Math.hypot(...me.body.velocity) < 80);
  const aim = [-f[1], f[0]];
  run(w, 2, {hold: true, aim}); assert.ok(w.aim.side);
  w.cancelAim(); run(w, 1, {hold: false, aim});
  assert.equal(me.battery.fired.port + me.battery.fired.star, 0);
  const port = w.sector.stations[0]; me.body.position = [port.pos[0] + port.radius + 300, 0, port.pos[2]];
  run(w, 1, {brake: true}); w.use(); assert.equal(w.docked, port.id);
  w.player.patrols = 2; w.launch(); assert.equal(w.encounters.stage, 2); assert.equal(w.encounters.active, null);
});

test('captain gamepad maps helm, aim and every button, with finite deadzones and edge-only torpedoes', () => {
  const g = new CaptainGamepad(); assert.equal(g.sample([pad([7])]).held.size, 0);
  g.sample([pad()]); const s = g.sample([pad([2, 7], [1, -1, 1, -1])]);
  assert.deepEqual(s.look, [-1, 1]); assert.equal(s.rudder, -1); assert.equal(s.throttle, 1);
  assert.ok(s.held.has('fire')); assert.ok(s.pressed.has('torpedo'));
  assert.equal(g.sample([pad([2, 7])]).pressed.size, 0);
  const wanted = ['use', 'brake', 'torpedo', 'hostile', 'next', 'warp', 'deflect', 'fire', 'map', 'pause', 'recenter', 'signal', 'boost', 'stop', 'portView', 'starView'];
  for (let i = 0; i < wanted.length; i++) { g.sample([pad()]); assert.ok(g.sample([pad([i])]).pressed.has(wanted[i])); }
  const finite = g.sample([pad([], [NaN, Infinity, NaN, -Infinity])]);
  assert.deepEqual(finite.look, [0, 0]); assert.equal(finite.rudder, 0); assert.equal(finite.throttle, 0);
});

test('controller screen changes, replacement and disconnect require neutral rearming; menu repeat is bounded', () => {
  const g = new CaptainGamepad(); g.sample([pad()]);
  assert.equal(g.sample([pad([7])], 'paused').held.size, 0);
  g.sample([pad()], 'paused'); assert.ok(g.sample([pad([1])], 'paused').pressed.has('brake'));
  assert.equal(g.sample([pad([7])], 'flight').held.size, 0);
  g.sample([pad()]); assert.ok(g.sample([pad([7])]).held.has('fire'));
  assert.equal(g.sample([]).connected, false); assert.equal(g.sample([pad([7])]).held.size, 0);
  g.sample([pad()]); assert.equal(g.sample([pad([7], undefined, 'replacement')]).held.size, 0);
  assert.equal(g.sample([{...pad(), mapping: ''}]).connected, false);
  g.sample([pad()], 'menu', 0); assert.equal(g.sample([pad([13])], 'menu', 1).nav, 1);
  assert.equal(g.sample([pad([13])], 'menu', 100).nav, 0); assert.equal(g.sample([pad([13])], 'menu', 402).nav, 1);
});
