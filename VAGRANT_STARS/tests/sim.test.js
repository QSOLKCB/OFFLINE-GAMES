// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {SYSTEMS, BASES, HULLS, GUNS, SHIELDS, LAUNCHERS, GOODS, FACTIONS, priceAt, stocks, routeBetween, factionsAtWar} from '../js/sim/data.js';
import {newPlayer, buyGood, sellGood, cargoUsed, cargoFree, buyGun, buyShield, buyLauncher, buyAmmo, buyConsumable, buyHull, hullQuote, repair, levelOf, netWorth, sanitizeSave, adjustRep} from '../js/sim/player.js';
import {jobsAt, acceptJob, abandonMission, missionOnDock, STORY} from '../js/sim/missions.js';
import {World, buildSector, lookQuat, CRUISE_CHARGE, JUMP_TIME} from '../js/sim/world.js';
import {shipModel, stationModel, stationBoxes, STATION_RADIUS, rockModels, planetModel, gateModel, laneRingModel} from '../js/sim/models.js';
import {SOUNDS, renderSound} from '../js/audio.js';

const DT = 1 / 60;
const quiet = (seed = 5, edit = () => {}) => { const p = newPlayer(seed); edit(p); return {p, w: new World(p, {traffic: false})}; };
const run = (w, seconds, cmd = {}) => { const events = []; for (let i = 0; i < Math.round(seconds / DT); i++) { w.step(DT, typeof cmd === 'function' ? cmd(i) : cmd); events.push(...w.events); w.events.length = 0; } return events; };
const speedOf = s => Math.hypot(...s.body.velocity);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const ahead = (w, d) => w.toWorld(w.playerShip, [0, 0, -d]);

test('universe data is internally consistent', () => {
  for (const [id, sys] of Object.entries(SYSTEMS)) {
    const places = new Set([...sys.bases.map(b => b.id), ...sys.gates.map(g => g.id)]);
    for (const gate of sys.gates) assert.ok(SYSTEMS[gate.to].gates.some(g => g.to === id), `${id} -> ${gate.to} has a return gate`);
    for (const lane of sys.lanes) for (const end of lane) assert.ok(places.has(end), `${id} lane end ${end}`);
    for (const faction of Object.keys(sys.traffic)) assert.ok(FACTIONS[faction]);
    for (const other of Object.keys(SYSTEMS)) assert.ok(routeBetween(id, other), `${id} reaches ${other}`);
    assert.ok(sys.star.pos.every(Number.isFinite) && Math.hypot(...sys.star.pos) > 60000, 'star sits outside the play area');
  }
  for (const base of Object.values(BASES)) {
    assert.ok(FACTIONS[base.faction] && STATION_RADIUS[base.kind]);
    for (const item of base.outfit) assert.ok(GUNS[item] || SHIELDS[item] || LAUNCHERS[item], item);
    for (const hull of base.ships) assert.ok(HULLS[hull]);
    for (const good of [...Object.keys(base.sells), ...Object.keys(base.pays)]) assert.ok(GOODS[good], good);
  }
  const sold = new Set(Object.values(BASES).flatMap(b => [...b.outfit, ...b.ships]));
  for (const id of [...Object.keys(GUNS), ...Object.keys(SHIELDS), ...Object.keys(LAUNCHERS), ...Object.keys(HULLS)]) assert.ok(sold.has(id), `${id} is sold somewhere`);
  assert.equal(factionsAtWar('wardens', 'reavers'), true); assert.equal(factionsAtWar('wardens', 'halcyon'), false);
});

test('every trade good has a profitable route', () => {
  for (const id of Object.keys(GOODS)) {
    const buy = Object.values(BASES).filter(b => stocks(b, id)).map(b => priceAt(b, id)), sell = Object.values(BASES).map(b => priceAt(b, id)).filter(p => p !== null);
    assert.ok(buy.length, `${id} is stocked somewhere`);
    assert.ok(Math.max(...sell) > Math.min(...buy) * 1.2, `${id} can be sold at a profit`);
  }
  assert.equal(priceAt(BASES.tollard, 'glint'), null, 'lawful ports do not trade contraband');
});

test('trading respects credits, stock and cargo space', () => {
  const p = newPlayer(1);
  assert.equal(buyGood(p, 'calder', 'rawore', 1).ok, false, 'not stocked here');
  assert.equal(buyGood(p, 'calder', 'medgel', 99).ok, false, 'no room');
  assert.equal(buyGood(p, 'calder', 'medgel', 10).ok, true);
  assert.equal(cargoUsed(p), 10); assert.equal(p.credits, 2500 - 10 * priceAt(BASES.calder, 'medgel'));
  assert.equal(sellGood(p, 'cinder', 'medgel', 11).ok, false);
  const before = p.credits;
  assert.equal(sellGood(p, 'cinder', 'medgel', 10).ok, true);
  assert.ok(p.credits - before === 10 * priceAt(BASES.cinder, 'medgel') && p.credits > 2500, 'the Calder -> Cinder Rock run pays');
  assert.deepEqual(p.cargo, {});
  p.cargo.glint = 2;
  assert.equal(sellGood(p, 'tollard', 'glint', 2).ok, false);
});

test('outfitting and ship purchases enforce hull limits and trade-ins', () => {
  const p = newPlayer(2); p.credits = 500000;
  assert.equal(buyGun(p, 'brightwater', 0, 'pulse3').ok, false, 'class 3 gun on a class 2 mount');
  assert.equal(buyGun(p, 'calder', 0, 'pulse2').ok, true);
  assert.equal(p.credits, 500000 - GUNS.pulse2.price + Math.round(GUNS.pulse1.price * 0.7));
  assert.equal(buyShield(p, 'calder', 's2').ok, true);
  assert.equal(buyLauncher(p, 'calder', 'wasp').ok, true); assert.equal(buyAmmo(p, 99).ok, true); assert.equal(p.ammo, LAUNCHERS.wasp.ammoMax);
  assert.equal(buyConsumable(p, 'kit', 99).ok, true); assert.equal(p.kits, HULLS.sparrow.kits);
  assert.equal(buyHull(p, 'calder', 'kite').ok, false, 'not sold at Calder');
  const quote = hullQuote(p, 'mule'), credits = p.credits;
  assert.equal(buyHull(p, 'calder', 'mule').ok, true);
  assert.equal(p.credits, credits - quote); assert.equal(p.hull, 'mule'); assert.equal(p.guns.length, HULLS.mule.guns);
  assert.equal(p.launcher, null, 'the Mule has no rack, so it was traded in'); assert.equal(p.guns[0], 'pulse2');
  p.hp = 100; assert.equal(repair(p).ok, true); assert.equal(p.hp, HULLS.mule.hp);
  const poor = newPlayer(3); assert.equal(buyHull(poor, 'calder', 'mule').ok, false);
  assert.ok(levelOf(p) > levelOf(poor) && netWorth(p) > netWorth(poor));
});

test('saves survive a round trip and reject tampering', () => {
  const p = newPlayer(9); buyGood(p, 'calder', 'medgel', 3); acceptJob(p, jobsAt(p, 'calder').find(j => !j.locked));
  const copy = sanitizeSave(JSON.stringify(p));
  assert.deepEqual(copy, JSON.parse(JSON.stringify(p)));
  for (const edit of [s => { s.hull = 'titan'; }, s => { s.credits = -5; }, s => { s.guns.push('lance'); }, s => { s.cargo.water = 9999; }, s => { s.base = 'cinder'; }, s => { s.v = 0; }, s => { s.rep.wardens = 7; }]) {
    const bad = JSON.parse(JSON.stringify(p)); edit(bad);
    assert.equal(sanitizeSave(JSON.stringify(bad)), null);
  }
  assert.equal(sanitizeSave('not json'), null); assert.equal(sanitizeSave(null), null);
});

test('job boards are deterministic and the storyline starts at Tollard', () => {
  const p = newPlayer(4);
  assert.deepEqual(jobsAt(p, 'tollard'), jobsAt(newPlayer(4), 'tollard'));
  const jobs = jobsAt(p, 'tollard');
  assert.equal(jobs[0].story, 0); assert.ok(jobs.length >= 4);
  assert.equal(jobsAt(p, 'calder').some(j => Number.isInteger(j.story)), false);
  p.board++; assert.notDeepEqual(jobsAt(p, 'tollard').slice(1), jobs.slice(1), 'the board changes after each docking');
  const kinds = new Set(); for (let i = 0; i < 12; i++) { p.board = i; for (const b of Object.keys(BASES)) for (const j of jobsAt(p, b)) { kinds.add(j.kind); assert.ok(j.reward > 0 && SYSTEMS[j.system]); } }
  assert.deepEqual([...kinds].sort(), ['bounty', 'courier']);
  for (const step of STORY) assert.ok(BASES[step.at] && (step.kind === 'bounty' ? SYSTEMS[step.system].zones.length : BASES[step.base]));
});

test('courier contracts take cargo space and pay on delivery', () => {
  const p = newPlayer(6); p.story = 1;
  const job = jobsAt(p, 'tollard')[0];
  assert.equal(job.kind, 'courier');
  assert.equal(acceptJob(p, job).ok, true); assert.equal(cargoUsed(p), job.cargo); assert.equal(acceptJob(p, job).ok, false);
  assert.equal(missionOnDock(p, 'vesper'), null);
  const credits = p.credits, result = missionOnDock(p, 'cinder');
  assert.equal(result.reward, job.reward); assert.equal(p.credits, credits + job.reward); assert.equal(p.mission, null); assert.equal(p.story, 2); assert.equal(cargoUsed(p), 0);
  acceptJob(p, jobsAt(p, 'calder').find(j => !j.locked)); const rep = p.rep.halcyon;
  assert.equal(abandonMission(p).ok, true); assert.ok(p.rep.halcyon < rep);
});

test('sectors are built with slingways, gates and collidable stations', () => {
  for (const sys of Object.values(SYSTEMS)) {
    const sector = buildSector(sys);
    assert.equal(sector.lanes.length, sys.lanes.length);
    for (const lane of sector.lanes) { assert.ok(lane.length > 3000 && lane.rings.length >= 2); assert.equal(lane.rings.filter(r => !r.minor).length, 2); }
    for (const s of sector.solids) assert.ok(s.box.min.every((v, i) => v < s.box.max[i]));
    for (const rock of sector.rocks) for (const poi of sector.pois) if (poi.type !== 'ring') assert.ok(dist(rock.pos, poi.pos) > poi.radius + rock.radius, 'rocks keep clear of ports and gates');
    for (const poi of sector.pois) if (poi.type === 'base') assert.ok(sector.grid.query(poi.pos, 400).length > 0);
  }
});

test('the simulation is deterministic for a seed and command tape', () => {
  const play = () => {
    const p = newPlayer(77), w = new World(p);
    run(w, 20, i => ({turn: [Math.sin(i / 40) * 0.5, Math.cos(i / 55) * 0.6], throttle: 1, fire: i % 4 === 0, burn: i % 300 < 60}));
    return JSON.stringify([w.playerShip.body, w.ships.map(s => [s.id, s.faction, s.body.position, s.hp]), w.shots.size, p.rep]);
  };
  assert.equal(play(), play());
});

test('throttle, afterburner, cruise and drift fly as advertised', () => {
  const {w} = quiet(), me = w.playerShip;
  run(w, 6, {throttle: 1});
  assert.ok(Math.abs(speedOf(me) - me.hull.speed) < 2, `reaches hull speed, got ${speedOf(me)}`);
  run(w, 3, {burn: true}); assert.ok(speedOf(me) > me.hull.speed * 1.5); assert.ok(me.boost < 1);
  w.toggleCruise(); run(w, CRUISE_CHARGE - 0.5); assert.equal(me.cruise.state, 'charging');
  run(w, 8); assert.equal(me.cruise.state, 'on'); assert.ok(speedOf(me) > me.hull.cruise * 0.95);
  const before = me.energy; run(w, 0.5, {fire: true}); assert.equal(w.shots.size, 0, 'guns are locked out in cruise'); assert.ok(me.energy >= before);
  w.toggleDrift(); assert.equal(me.cruise.state, 'off'); const v = [...me.body.velocity];
  run(w, 2, {turn: [0, 1]});
  assert.ok(dist(v, me.body.velocity) < 3, 'drifting keeps the velocity while the nose swings');
  assert.ok(Math.abs(w.forward(me)[1]) < 0.05 && dist(w.forward(me), v.map(x => x / Math.hypot(...v))) > 0.5, 'a level turn away from the flight path');
  w.toggleDrift(); run(w, 5, {brake: true, throttle: -1}); assert.ok(speedOf(me) < 3);
});

test('steering turns the nose and banks, then levels out', () => {
  const {w} = quiet(), me = w.playerShip, f0 = w.forward(me);
  run(w, 1, {turn: [0, 1]});
  const f1 = w.forward(me), wing = q => w.toWorld({body: {orientation: q, position: [0, 0, 0]}}, [1, 0, 0])[1];
  assert.ok(f0[0] * f1[2] - f0[2] * f1[0] < -0.5, 'positive yaw turns left'); assert.ok(Math.abs(f1[1]) < 0.02, 'the turn stays level');
  assert.ok(wing(w.visualQuat(me)) > 0.3, 'the hull visibly banks into the turn'); assert.ok(Math.abs(wing(me.body.orientation)) < 0.02, 'while the flight attitude stays wings-level');
  run(w, 3); assert.ok(Math.abs(wing(w.visualQuat(me))) < 0.03, 'and rolls level again');
  run(w, 1, {turn: [1, 0]}); assert.ok(w.forward(me)[1] > 0.5, 'positive pitch raises the nose');
});

test('ships cannot fly through a station', () => {
  const {w} = quiet(), me = w.playerShip, hub = [...BASES.calder.pos]; hub[1] -= 230;
  me.body.position = [hub[0], hub[1], hub[2] + 400]; me.body.orientation = lookQuat([0, 0, -1]); me.body.velocity = [0, 0, 0];
  const events = run(w, 8, {throttle: 1});
  assert.ok(me.body.position[2] > hub[2] + 60 + me.body.halfSize - 0.01, `stopped at the hull plating, z=${me.body.position[2] - hub[2]}`);
  assert.ok(events.some(e => e.type === 'bump')); assert.ok(me.shield < me.maxShield, 'the impact cost some shield');
});

test('gunfire strips shields, then hull, and kills pay out', () => {
  const {p, w} = quiet(), me = w.playerShip;
  w.spawnGroup({faction: 'reavers', role: 'raider', count: 1, tier: 1, pos: ahead(w, 240)});
  const foe = w.ships.find(s => !s.isPlayer); foe.ai.brave = true;
  assert.equal(w.attitude(foe), 'hostile'); assert.equal(w.targetNearestHostile(), foe);
  const shield = foe.shield, credits = p.credits, wardens = p.rep.wardens, reavers = p.rep.reavers;
  let events = run(w, 0.6, () => ({fire: true, aim: (() => { const t = w.leadFor(foe); const d = t.map((v, i) => v - me.body.position[i]); const l = Math.hypot(...d); return d.map(v => v / l); })()}));
  assert.ok(events.some(e => e.type === 'shot' && e.mine)); assert.ok(foe.shield < shield, 'bolts land on the target');
  assert.ok(me.energy < me.maxEnergy);
  for (let i = 0; i < 60 * 40 && foe.alive; i++) {
    const t = w.leadFor(foe) ?? foe.body.position, d = t.map((v, k) => v - me.body.position[k]), l = Math.hypot(...d);
    w.step(DT, {fire: true, aim: d.map(v => v / l), turn: [0, 0]}); events.push(...w.events); w.events.length = 0; me.hp = me.maxHp; me.shield = me.maxShield;
    me.body.orientation = lookQuat(d.map(v => v / l));
  }
  assert.equal(foe.alive, false); assert.ok(events.some(e => e.type === 'explode'));
  assert.equal(p.stats.kills, 1); assert.ok(p.credits > credits, 'Warden bounty'); assert.ok(p.rep.wardens > wardens && p.rep.reavers < reavers);
  assert.equal(w.ships.includes(foe), false); assert.ok(w.loot.length >= 1);
});

test('attacking a neutral provokes its faction; enemies shoot back', () => {
  const {p, w} = quiet(), me = w.playerShip;
  w.spawnGroup({faction: 'wardens', role: 'patrol', count: 2, tier: 2, pos: ahead(w, 200), dest: ahead(w, 9000)});
  const [a, b] = w.ships.filter(s => !s.isPlayer), rep = p.rep.wardens;
  assert.equal(w.attitude(a), 'neutral');
  w.damage(a, 5, 5, me);
  assert.equal(w.attitude(a), 'hostile'); assert.equal(w.attitude(b), 'hostile'); assert.ok(p.rep.wardens < rep);
  const events = run(w, 25);
  assert.ok(events.some(e => e.type === 'playerHit'), 'the patrol returns fire');
});

test('missiles home on their target and need a rack and ammunition', () => {
  const {p, w} = quiet(8, s => { s.launcher = 'wasp'; s.ammo = 2; });
  const me = w.playerShip;
  w.spawnGroup({faction: 'reavers', role: 'raider', count: 1, tier: 1, pos: ahead(w, 500)});
  const foe = w.ships.find(s => !s.isPlayer), total = foe.hp + foe.shield;
  w.targetNearestHostile();
  w.step(DT, {missile: true}); assert.equal(me.ammo, 1); assert.equal(w.missiles.length, 1);
  w.step(DT, {missile: true}); assert.equal(me.ammo, 1, 'the rack is still cycling');
  const events = run(w, 6); me.hp = me.maxHp;
  assert.ok(events.filter(e => e.type === 'explode').length >= 1); assert.ok(!foe.alive || foe.hp + foe.shield < total - 60, 'the warhead connected');
  w.syncPlayer(); assert.equal(p.ammo, 1);
});

test('the tractor beam recovers cargo up to the hold limit', () => {
  const {p, w} = quiet(), me = w.playerShip;
  w.loot.push({id: 9001, pos: ahead(w, 300), vel: [0, 0, 0], life: 100, kind: 'good', good: 'alloys', qty: 30});
  run(w, 2); assert.equal(cargoUsed(p), 0, 'nothing happens without the beam');
  w.tractor(); const events = run(w, 6);
  assert.equal(p.cargo.alloys, me.hull.cargo); assert.equal(cargoFree(p), 0); assert.ok(events.some(e => e.type === 'pickup'));
});

test('docking: range, autopilot approach, hostile ports and saved state', () => {
  const {p, w} = quiet(), me = w.playerShip;
  w.targetPoi('calder'); me.hp = 200;
  w.use(); assert.equal(w.docked, 'calder', 'launch position is inside docking range');
  const dock = w.events.find(e => e.type === 'dock'); assert.equal(dock.base, 'calder'); assert.equal(p.hp, 200); assert.equal(p.board, 1);
  w.events.length = 0; w.launch(); assert.equal(w.docked, null); assert.equal(w.playerShip.hp, 200);
  w.targetPoi('tollard'); w.use(); assert.ok(w.auto, 'too far: the autopilot takes over');
  adjustRep(p, 'wardens', -1);
  w.playerShip.body.position = [...BASES.tollard.pos].map((v, i) => v + (i === 0 ? 500 : 0));
  w.stopAuto(true); w.events.length = 0; w.use();
  assert.equal(w.docked, null); assert.ok(w.events.some(e => e.type === 'msg' && /hostile/.test(e.text)));
});

test('autopilot flies to a place and docks without hitting it', () => {
  const {p, w} = quiet(), me = w.playerShip, ring = w.sector.pois.find(q => q.type === 'ring' && !q.minor && q.lane.to.id === 'brightwater' && q.s === 0);
  w.targetPoi(ring.id); w.use();
  const events = run(w, 40);
  assert.ok(events.some(e => e.type === 'laneEnter'), 'reached and entered the slingway');
  assert.ok(events.some(e => e.type === 'laneExit'), 'and rode it to the far end');
  assert.ok(dist(me.body.position, BASES.brightwater.pos) < 1800, `near Brightwater, at ${Math.round(dist(me.body.position, BASES.brightwater.pos))}`);
  w.targetPoi('brightwater'); w.use();
  for (let i = 0; i < 60 * 60 && !w.docked; i++) { w.step(DT, {}); w.events.length = 0; }
  assert.equal(w.docked, 'brightwater'); assert.equal(p.base, 'brightwater'); assert.equal(me.hp, me.maxHp, 'no collision damage on approach');
});

test('fold gates carry the ship to the linked system', () => {
  const {p, w} = quiet(), gate = w.sector.byId.get('g-kessa');
  w.playerShip.body.position = [gate.pos[0] + 300, gate.pos[1], gate.pos[2]];
  w.targetPoi('g-kessa'); w.use(); assert.ok(w.jump);
  const events = run(w, JUMP_TIME + 0.2);
  assert.equal(w.system.id, 'kessa'); assert.equal(p.system, 'kessa'); assert.equal(p.visited.kessa, true); assert.equal(p.stats.jumps, 1);
  assert.ok(events.some(e => e.type === 'jumped'));
  const arrival = w.sector.byId.get('g-meridian'); assert.ok(dist(w.playerShip.body.position, arrival.pos) < 700, 'arrives at the return gate');
});

test('bounty contracts spawn their targets and pay when the last one dies', () => {
  const {p, w} = quiet();
  acceptJob(p, jobsAt(p, 'tollard')[0]);
  const m = p.mission, credits = p.credits;
  assert.deepEqual(w.waypoint().pos, m.waypoint);
  w.playerShip.body.position = [m.waypoint[0] + 2000, m.waypoint[1], m.waypoint[2]];
  run(w, 0.2);
  const foes = w.ships.filter(s => s.missionTag === m.id);
  assert.equal(foes.length, 2); assert.ok(foes.every(f => w.attitude(f) === 'hostile'));
  for (const f of foes) w.damage(f, 1e5, 1e5, w.playerShip);
  const events = run(w, 0.2);
  assert.equal(p.mission, null); assert.equal(p.story, 1); assert.ok(p.credits >= credits + STORY[0].reward);
  assert.ok(events.some(e => e.type === 'missionDone' && e.result.story));
});

test('losing the ship ends the flight', () => {
  const {p, w} = quiet();
  w.damage(w.playerShip, 1e6, 1e6, null);
  assert.equal(w.over, true); assert.ok(w.events.some(e => e.type === 'playerDead')); assert.equal(p.stats.losses, 1);
  const t = w.time; w.step(DT, {}); assert.equal(w.time, t);
});

test('ambient traffic appears, travels and is hostile only where it should be', () => {
  const p = newPlayer(21), w = new World(p);
  run(w, 30, {throttle: 1});
  const npcs = w.ships.filter(s => !s.isPlayer);
  assert.ok(npcs.length >= 2 && npcs.length <= 16, `${npcs.length} ships nearby`);
  for (const s of npcs) { assert.ok(FACTIONS[s.faction] && s.body.position.every(Number.isFinite)); if (!FACTIONS[s.faction].outlaw) assert.notEqual(w.attitude(s), 'hostile'); }
  assert.ok(npcs.some(s => speedOf(s) > 20));
});

test('models are finite and ships have enough muzzles and engines', () => {
  for (const [id, hull] of Object.entries(HULLS)) {
    const m = shipModel(id, [1, 0, 0]);
    assert.ok(m.count > 20 && m.tris.every(Number.isFinite) && m.normals.every(Number.isFinite));
    assert.ok(m.muzzles.length >= hull.guns && m.engines.length >= 1, id); assert.ok(m.radius < hull.radius * 3);
  }
  for (const kind of Object.keys(STATION_RADIUS)) {
    const m = stationModel(kind, [1, 1, 0]); assert.ok(m.count > 50 && m.tris.every(Number.isFinite));
    assert.ok(m.radius <= STATION_RADIUS[kind] + 60, `${kind} radius ${m.radius}`);
    assert.ok(stationBoxes(kind).length >= 3);
  }
  for (const m of [...rockModels(0), ...rockModels(1), planetModel('ocean'), gateModel(), laneRingModel()]) assert.ok(m.count > 0 && m.tris.every(Number.isFinite));
});

test('sound effects render deterministically inside 16-bit range', () => {
  for (const name of Object.keys(SOUNDS)) {
    const a = renderSound(name), b = renderSound(name);
    assert.ok(a.length > 400 && a.length <= 8 * 48000); assert.deepEqual(a, b); assert.ok(a.some(v => v !== 0));
  }
});

test('vendored VANILLAJS modules match their recorded provenance', () => {
  const dir = new URL('../vendor/vanillajs/', import.meta.url), record = JSON.parse(readFileSync(new URL('PROVENANCE.json', dir)));
  assert.match(record.commit, /^[0-9a-f]{40}$/); assert.deepEqual(record.localChanges, []);
  assert.equal(Object.keys(record.sha256).length, record.modules.length + 2);
  for (const [file, hash] of Object.entries(record.sha256)) assert.equal(createHash('sha256').update(readFileSync(new URL(file, dir))).digest('hex'), hash, file);
});
