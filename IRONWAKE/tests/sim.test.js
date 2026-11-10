// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {FACTIONS, SECTOR, STATIONS, HULLS, BROADSIDES, TURRETS, UPGRADES, GOODS, VESSELS, SQUADRONS, TORPEDO, marketEvent, priceAt, stocks, atWar} from '../js/sim/data.js';
import {newPlayer, buyGood, sellGood, cargoUsed, cargoFree, priceFor, buyBattery, batteryQuote, buyTurrets, buyUpgrade, buyTorpedoes, buyHull, hullQuote, repair, maxHull, shieldCap, levelOf, netWorth, sanitizeSave, adjustRep} from '../js/sim/player.js';
import {jobsAt, acceptJob, abandonMission, missionOnDock, WANTED} from '../js/sim/missions.js';
import {World, buildSector, headingOf, forward2, AIM_TIME, WIDE_CONE, WARP_SPOOL, FORE, STARBOARD, AFT, PORT} from '../js/sim/world.js';
import {capitalModel, vesselModel, stationModel, stationBoxes, STATION_RADIUS, rockModels, wreckModel, planetModel} from '../js/sim/models.js';
import {SOUNDS, renderSound} from '../js/audio.js';

const DT = 1 / 60;
const quiet = (seed = 5, edit = () => {}) => { const p = newPlayer(seed); edit(p); return {p, w: new World(p, {traffic: false})}; };
const run = (w, seconds, cmd = {}) => { const events = []; for (let i = 0; i < Math.round(seconds / DT); i++) { w.step(DT, typeof cmd === 'function' ? cmd(i) : cmd); events.push(...w.events); w.events.length = 0; } return events; };
const speedOf = s => Math.hypot(s.body.velocity[0], s.body.velocity[2]);
const beam = (w, side) => { const h = headingOf(w.playerShip) + (side === 'port' ? Math.PI / 2 : -Math.PI / 2); return forward2(h); };
const place = (w, local) => w.localPoint(w.playerShip, local);

test('sector data is internally consistent', () => {
  const yards = new Set(), guns = new Set(), mounts = new Set();
  for (const s of SECTOR.stations) {
    assert.ok(FACTIONS[s.faction] && STATION_RADIUS[s.kind] && s.rumors.length);
    for (const h of s.yard) { assert.ok(HULLS[h]); yards.add(h); }
    for (const b of s.batteries) { assert.ok(BROADSIDES[b]); guns.add(b); }
    for (const t of s.turrets) { assert.ok(TURRETS[t]); mounts.add(t); }
    for (const g of [...Object.keys(s.makes), ...Object.keys(s.wants)]) assert.ok(GOODS[g], g);
  }
  assert.deepEqual([...yards].sort(), Object.keys(HULLS).sort()); assert.deepEqual([...guns].sort(), Object.keys(BROADSIDES).sort()); assert.deepEqual([...mounts].sort(), Object.keys(TURRETS).sort());
  for (const tiers of Object.values(UPGRADES)) assert.ok(tiers.length - 1 <= Math.max(...SECTOR.stations.map(s => s.tier)), 'every fitting tier is sold somewhere');
  for (const list of SQUADRONS.slice(1)) for (const [cls, n] of list) assert.ok(VESSELS[cls] && n > 0);
  for (const v of Object.values(VESSELS)) if (v.kind === 'capital') assert.ok(BROADSIDES[v.battery] && TURRETS[v.turret]);
  for (const m of WANTED) assert.ok(VESSELS[m.vessel] && SECTOR.fields.some(f => f.name === m.field));
  assert.equal(atWar('watch', 'pennant'), true); assert.equal(atWar('watch', 'league'), false);
});

test('markets: profitable routes, and daily shortages and gluts move prices', () => {
  for (const id of Object.keys(GOODS)) {
    const sell = SECTOR.stations.map(s => priceAt(s, id)), buy = SECTOR.stations.filter(s => stocks(s, id)).map(s => priceAt(s, id));
    if (!GOODS[id].found || buy.length) assert.ok(Math.max(...sell) > Math.min(...buy) * 1.2, `${id} has a paying route`);
  }
  let events = 0;
  for (let day = 0; day < 40; day++) for (const s of SECTOR.stations) {
    const e = marketEvent(9, s.id, day);
    assert.deepEqual(e, marketEvent(9, s.id, day));
    if (e) {
      events++; assert.ok(e.mult === 1.75 || e.mult === 0.55);
      assert.equal(priceAt(s, e.good, 9, day), Math.round(GOODS[e.good].price * (s.makes[e.good] ?? s.wants[e.good] ?? 1) * e.mult));
      const other = Object.keys(GOODS).find(g => g !== e.good); assert.equal(priceAt(s, other, 9, day), Math.round(GOODS[other].price * (s.makes[other] ?? s.wants[other] ?? 1)));
    }
  }
  assert.ok(events > 40 && events < 160, `${events} upsets in 40 days`);
});

test('trading respects credits, stock and hold space', () => {
  const p = newPlayer(1);
  assert.equal(buyGood(p, 'anchorage', 'salvage', 1).ok, false, 'salvage is only found, never sold at Anchorage');
  assert.equal(buyGood(p, 'tinder', 'ore', 99).ok, false);
  assert.equal(buyGood(p, 'tinder', 'ore', 20).ok, true); assert.equal(cargoUsed(p), 20);
  const before = p.credits, price = priceFor(p, 'coldharbor', 'ore');
  assert.equal(sellGood(p, 'coldharbor', 'ore', 21).ok, false); assert.equal(sellGood(p, 'coldharbor', 'ore', 20).ok, true);
  assert.equal(p.credits, before + 20 * price); assert.ok(p.credits > 4000, 'the ore run pays'); assert.deepEqual(p.cargo, {});
});

test('fitting out: batteries, turrets, yard tiers and hull changes', () => {
  const p = newPlayer(2); p.credits = 2000000;
  assert.equal(buyBattery(p, 'anchorage', 'stormlance').ok, false, 'not sold at Anchorage');
  const quote = batteryQuote(p, 'longnine'), credits = p.credits;
  assert.equal(quote, BROADSIDES.longnine.price * 6 - Math.round(BROADSIDES.culverin.price * 6 * 0.7));
  assert.equal(buyBattery(p, 'anchorage', 'longnine').ok, true); assert.equal(p.credits, credits - quote);
  assert.equal(buyTurrets(p, 'anchorage', 'flak').ok, true);
  assert.equal(buyUpgrade(p, 'anchorage', 'shield', 3).ok, false, 'Anchorage is a tier 2 yard'); assert.equal(buyUpgrade(p, 'anchorage', 'shield', 2).ok, true);
  assert.equal(shieldCap(p), Math.round(HULLS.cutter.shield * 1.4));
  p.hp = 450; assert.equal(buyUpgrade(p, 'anchorage', 'armor', 2).ok, true); assert.equal(maxHull(p), 1125); assert.equal(p.hp, 563, 'hull damage keeps its proportion');
  assert.equal(buyTorpedoes(p, 99).ok, true); assert.equal(p.torps, HULLS.cutter.torps);
  assert.equal(repair(p).ok, true); assert.equal(p.hp, maxHull(p));
  assert.equal(buyHull(p, 'anchorage', 'frigate').ok, false);
  const cost = hullQuote(p, 'corvette'), had = p.credits;
  assert.equal(cost, HULLS.corvette.price - Math.round(HULLS.cutter.price * 0.7) + 4 * BROADSIDES.longnine.price + TURRETS.flak.price);
  assert.equal(buyHull(p, 'anchorage', 'corvette').ok, true); assert.equal(p.credits, had - cost); assert.equal(p.battery, 'longnine'); assert.equal(p.hp, maxHull(p));
  const poor = newPlayer(3); assert.equal(buyHull(poor, 'anchorage', 'corvette').ok, false); assert.ok(levelOf(p) > levelOf(poor) && netWorth(p) > netWorth(poor));
});

test('saves survive a round trip and reject tampering', () => {
  const p = newPlayer(9); buyGood(p, 'anchorage', 'water', 3); acceptJob(p, jobsAt(p, 'anchorage').find(j => !j.locked));
  assert.deepEqual(sanitizeSave(JSON.stringify(p)), JSON.parse(JSON.stringify(p)));
  for (const edit of [s => { s.hull = 'galleon'; }, s => { s.credits = -1; }, s => { s.shield = 9; }, s => { s.cargo.ore = 9999; }, s => { s.station = 'nowhere'; }, s => { s.v = 0; }, s => { s.rep.watch = 3; }, s => { s.hp = 1e6; }, s => { s.torps = 99; }]) {
    const bad = JSON.parse(JSON.stringify(p)); edit(bad); assert.equal(sanitizeSave(JSON.stringify(bad)), null);
  }
  assert.equal(sanitizeSave('{'), null); assert.equal(sanitizeSave(null), null);
});

test('contract boards are deterministic; the Most Wanted list is posted at Watch ports', () => {
  const p = newPlayer(4);
  assert.deepEqual(jobsAt(p, 'anchorage'), jobsAt(newPlayer(4), 'anchorage'));
  assert.equal(jobsAt(p, 'anchorage')[0].kind, 'wanted'); assert.equal(jobsAt(p, 'lantern')[0].wanted, 0);
  assert.equal(jobsAt(p, 'coldharbor').some(j => j.kind === 'wanted'), false);
  const kinds = new Set(); for (let i = 0; i < 12; i++) { p.board = i; for (const id of Object.keys(STATIONS)) for (const j of jobsAt(p, id)) { kinds.add(j.kind); assert.ok(j.reward > 0); } }
  assert.deepEqual([...kinds].sort(), ['bounty', 'defend', 'delivery', 'wanted']);
  p.board = 0; p.wanted = 1; assert.ok(jobsAt(p, 'anchorage')[0].locked, 'the second warrant needs rank');
  p.wanted = WANTED.length; assert.equal(jobsAt(p, 'anchorage').some(j => j.kind === 'wanted'), false);
});

test('deliveries take hold space and pay on docking', () => {
  const p = newPlayer(6); let job = null;
  for (let b = 0; !job; b++) { p.board = b; job = jobsAt(p, 'gallows').find(j => j.kind === 'delivery'); }
  assert.equal(acceptJob(p, job).ok, true); assert.equal(cargoUsed(p), job.cargo); assert.equal(acceptJob(p, job).ok, false);
  assert.equal(missionOnDock(p, job.dest === 'tinder' ? 'lantern' : 'tinder'), null);
  const credits = p.credits; assert.equal(missionOnDock(p, job.dest).reward, job.reward); assert.equal(p.credits, credits + job.reward); assert.equal(cargoUsed(p), 0);
  acceptJob(p, jobsAt(p, 'anchorage').find(j => !j.locked)); const rep = p.rep[p.mission.giver]; const giver = p.mission.giver;
  assert.equal(abandonMission(p).ok, true); assert.ok(p.rep[giver] < rep);
});

test('the sector has ports, minable rocks and wreck fields, all on the battle plane', () => {
  const sector = buildSector();
  assert.equal(sector.stations.length, 5); assert.ok(sector.rocks.length > 100 && sector.wrecks.length > 30);
  assert.ok(sector.rocks.some(r => r.hp !== Infinity) && sector.rocks.some(r => r.hp === Infinity) && sector.rocks.some(r => r.rich));
  for (const s of sector.solids) assert.ok(s.box.min[1] < 0 && s.box.max[1] > 0 && s.box.min[0] < s.box.max[0]);
  for (const st of sector.stations) { assert.ok(sector.grid.query(st.pos[0], st.pos[2], 500).length > 0); for (const r of sector.rocks) assert.ok(Math.hypot(r.pos[0] - st.pos[0], r.pos[2] - st.pos[2]) > st.radius + r.radius); }
});

test('hulls stay on the plane, answer the helm and boost', () => {
  const {w} = quiet(), me = w.playerShip, h0 = headingOf(me);
  run(w, 12, {throttle: 1});
  assert.ok(Math.abs(speedOf(me) - me.speed) < 2, `reaches hull speed, got ${speedOf(me)}`);
  run(w, 2, {rudder: 1}); assert.ok(headingOf(me) > h0 + 0.5, 'positive rudder comes to port'); assert.ok(me.heel > 0.05, 'and the hull heels into the turn');
  run(w, 3, {boost: true}); assert.ok(speedOf(me) > me.speed * 1.4); assert.ok(me.boost < 1);
  run(w, 10, {throttle: -1, rudder: -1}); assert.ok(speedOf(me) < 3);
  for (const s of w.ships) { assert.equal(s.body.position[1], 0); assert.equal(s.body.velocity[1], 0); assert.equal(s.body.orientation[0], 0); assert.equal(s.body.orientation[2], 0); }
});

test('a broadside needs a bearing, steadies as it is held and fires every gun', () => {
  const {w} = quiet(), me = w.playerShip, bow = forward2(headingOf(me)), gun = me.battery.def;
  assert.equal(w.sideFor(me, bow), null); assert.equal(w.sideFor(me, beam(w, 'port')), 'port'); assert.equal(w.sideFor(me, beam(w, 'star')), 'star');
  run(w, 0.5, {hold: true, aim: bow}); run(w, 0.1, {aim: bow}); assert.equal(w.shells.length, 0, 'no bearing over the bow');
  run(w, AIM_TIME / 2, {hold: true, aim: beam(w, 'star')});
  assert.equal(w.aim.side, 'star'); assert.ok(w.aimCone() < WIDE_CONE * 0.6 && w.aimCone() > gun.cone, 'half steady');
  run(w, AIM_TIME, {hold: true, aim: beam(w, 'star')}); assert.ok(Math.abs(w.aimCone() - gun.cone) < 1e-9, 'fully steady');
  const events = run(w, 0.5, {aim: beam(w, 'star')});
  assert.equal(events.filter(e => e.type === 'shot' && e.kind === 'broadside').length, me.battery.cannons, 'the whole battery fires in a ripple');
  const out = beam(w, 'star'); for (const s of w.shells) assert.ok((s.vx * out[0] + s.vz * out[1]) / gun.speed > Math.cos(gun.cone + 1e-6), 'inside the steadied cone');
  assert.equal(w.batteryReady(me, 'star'), false); assert.equal(w.batteryReady(me, 'port'), true, 'the other side is untouched');
  run(w, gun.reload - 0.6, {}); assert.equal(w.batteryReady(me, 'star'), false);
  run(w, 0.4, {}); assert.equal(w.batteryReady(me, 'star'), true, 'reloaded');
});

test('damage lands on the shield screen facing it, then the hull', () => {
  const {w} = quiet(), me = w.playerShip, at = me.body.position;
  const from = (side, k) => { const d = side === 'fore' ? forward2(headingOf(me)) : side === 'aft' ? forward2(headingOf(me) + Math.PI) : beam(w, side); return [at[0] + d[0] * k, at[2] + d[1] * k]; };
  w.damage(me, 100, ...from('port', 300), null); assert.deepEqual(me.sh.map(Math.round), [230, 230, 230, 130]);
  w.damage(me, 50, ...from('star', 300), null); w.damage(me, 30, ...from('fore', 300), null); w.damage(me, 20, ...from('aft', 300), null);
  assert.equal(me.sh[STARBOARD], 180); assert.equal(me.sh[FORE], 200); assert.equal(me.sh[AFT], 210); assert.equal(me.hp, me.maxHp);
  w.damage(me, 200, ...from('port', 300), null);
  assert.equal(me.sh[PORT], 0); assert.equal(me.hp, me.maxHp - 70, 'the overflow reaches the hull');
  run(w, 4, {}); assert.equal(me.sh[PORT], 0, 'a struck screen stays down for a while');
  run(w, 4, {}); assert.ok(me.sh[PORT] > 20, 'then recharges');
});

test('the deflector soaks a salvo, drains and recharges', () => {
  const {w} = quiet(), me = w.playerShip, src = [me.body.position[0] + 200, me.body.position[2]];
  run(w, 0.1, {deflect: true}); assert.equal(me.deflect.active, true);
  w.damage(me, 1000, ...src, null);
  assert.ok(me.sh.reduce((a, b) => a + b) > 4 * 230 - 201 && me.hp === me.maxHp, 'only a fifth gets through');
  run(w, me.deflect.seconds + 0.2, {deflect: true}); assert.equal(me.deflect.active, false); assert.ok(me.deflect.charge < 0.05, 'spent');
  run(w, 4, {}); assert.ok(me.deflect.charge > 0.2 && me.deflect.charge < 0.5); run(w, 12, {}); assert.equal(me.deflect.charge, 1);
});

test('broadsides and turrets destroy a raider squadron and the Watch pays', () => {
  const {p, w} = quiet(), me = w.playerShip;
  const foes = w.spawnSquadron({faction: 'pennant', threat: 2, pos: place(w, [300, 0, 0])});
  assert.ok(foes.every(f => w.attitude(f) === 'hostile')); assert.equal(w.targetNearestHostile().alive, true);
  const credits = p.credits, watch = p.rep.watch, events = [];
  for (let i = 0; i < 60 * 240 && foes.some(f => f.alive); i++) {
    const boat = foes.find(f => f.alive && f.kind === 'capital') ?? foes.find(f => f.alive), lead = w.leadFor(boat) ?? boat.body.position;
    const d = [lead[0] - me.body.position[0], lead[2] - me.body.position[2]], l = Math.hypot(...d), aim = [d[0] / l, d[1] / l], side = w.sideFor(me, aim);
    w.step(DT, {aim, hold: !!side && w.batteryReady(me, side) && w.aim.t < 1 && l < 640, rudder: side ? 0 : 1, throttle: 1});
    events.push(...w.events); w.events.length = 0; me.hp = me.maxHp;
  }
  assert.equal(foes.some(f => f.alive), false, 'squadron destroyed');
  assert.ok(events.some(e => e.type === 'shot' && e.kind === 'turret' && e.mine), 'turrets fired on their own');
  assert.ok(events.some(e => e.type === 'shot' && e.kind === 'broadside' && !e.mine), 'the gunboat fired back');
  assert.equal(p.stats.kills, 4); assert.equal(p.stats.capitals, 1); assert.ok(p.credits >= credits + VESSELS.barracuda.bounty + 3 * VESSELS.skate.bounty); assert.ok(p.rep.watch > watch);
  assert.ok(w.pickups.length + cargoUsed(p) > 0, 'the wreck left salvage');
});

test('firing on a neutral provokes its friends', () => {
  const {p, w} = quiet(), me = w.playerShip, rep = p.rep.watch;
  w.spawnSquadron({faction: 'watch', threat: 3, pos: place(w, [-300, 0, 0])});
  const ships = w.ships.filter(s => !s.isPlayer); assert.ok(ships.every(s => w.attitude(s) === 'neutral'));
  w.damage(ships[0], 5, me.body.position[0], me.body.position[2], me);
  assert.ok(ships.every(s => w.attitude(s) === 'hostile')); assert.ok(p.rep.watch < rep);
  assert.ok(run(w, 30).some(e => e.type === 'playerHit'), 'they return fire');
});

test('torpedoes home on the selected ship', () => {
  const {p, w} = quiet(), me = w.playerShip;
  const [boat] = w.spawnSquadron({faction: 'pennant', threat: 2, pos: place(w, [0, 0, -600])}), total = boat.hp + boat.sh[0] * 4;
  w.step(DT, {torpedo: true}); assert.equal(w.torpedoes.length, 0, 'needs a target');
  w.target = boat.id; w.step(DT, {torpedo: true}); assert.equal(me.torps, 1); assert.equal(w.torpedoes.length, 1);
  w.step(DT, {torpedo: true}); assert.equal(me.torps, 1, 'the tube is still cycling');
  run(w, 9, {}); me.hp = me.maxHp;
  assert.ok(!boat.alive || boat.hp + boat.sh.reduce((a, b) => a + b) < total - TORPEDO.dmg * 0.8, 'the warhead connected');
  w.syncPlayer(); assert.equal(p.torps, 1);
});

test('small rocks crack into ore that drifts into the hold', () => {
  const {p, w} = quiet(), me = w.playerShip, rock = w.sector.rocks.find(r => r.hp !== Infinity && r.radius > 25);
  me.body.position = [rock.pos[0] - 260, 0, rock.pos[2]]; me.body.velocity = [0, 0, 0];
  const aim = [1, 0], events = [];
  for (let i = 0; i < 60 * 40 && !rock.dead; i++) { const side = w.sideFor(me, aim); w.step(DT, {aim, hold: !!side && w.batteryReady(me, side) && w.aim.t < 1, rudder: side ? 0 : 1}); events.push(...w.events); w.events.length = 0; }
  assert.equal(rock.dead, true); assert.ok(events.some(e => e.type === 'explode' && e.rock)); assert.equal(p.stats.mined, 1); assert.ok(w.pickups.length > 0);
  events.push(...run(w, 25, {}));
  assert.ok((p.cargo.ore ?? 0) + (p.cargo.crystal ?? 0) > 0, 'ore recovered'); assert.ok(events.some(e => e.type === 'pickup'));
  const big = w.sector.rocks.find(r => r.hp === Infinity); assert.ok(big.radius > 46);
});

test('the warp drive carries the ship to a plotted port and refuses near hostiles', () => {
  const {w} = quiet(), me = w.playerShip, port = STATIONS.coldharbor;
  w.selectDest('coldharbor'); w.toggleWarp(); assert.equal(me.warp.state, 'spool');
  run(w, WARP_SPOOL + 0.1); assert.equal(me.warp.state, 'on');
  const events = run(w, 30); assert.equal(me.warp.state, 'off');
  const d = Math.hypot(me.body.position[0] - port.pos[0], me.body.position[2] - port.pos[1]);
  assert.ok(d < 2600 && d > 500, `dropped out ${Math.round(d)} m off the port`); assert.ok(events.some(e => e.type === 'warp' && e.state === 'off'));
  w.spawnSquadron({faction: 'pennant', threat: 1, pos: place(w, [600, 0, 0])}); w.events.length = 0; w.toggleWarp();
  assert.equal(me.warp.state, 'off'); assert.ok(w.events.some(e => e.type === 'msg' && /Hostiles too close/.test(e.text)));
});

test('docking needs range and a slow approach, and hostile ports refuse', () => {
  const {p, w} = quiet(), me = w.playerShip;
  me.hp = 500; w.use(); assert.equal(w.docked, 'anchorage', 'cast-off position is inside docking range');
  assert.equal(p.hp, 500); assert.equal(p.board, 1); assert.equal(w.events.find(e => e.type === 'dock').station, 'anchorage');
  w.events.length = 0; w.launch(); assert.equal(w.docked, null); assert.equal(w.playerShip.hp, 500);
  run(w, 6, {throttle: 1, boost: true}); w.events.length = 0; w.use();
  assert.equal(w.docked, null); assert.ok(w.events.some(e => /Too fast|No port in range/.test(e.text ?? '')));
  const port = w.sector.byId.get('lantern'); w.playerShip.body.position = [port.pos[0] + port.radius + 300, 0, port.pos[2]]; w.playerShip.body.velocity = [0, 0, 0];
  adjustRep(p, 'watch', -1); w.events.length = 0; w.use(); assert.equal(w.docked, null); assert.ok(w.events.some(e => /refuses you/.test(e.text ?? '')));
});

test('warrants spawn the wanted captain and pay when the squadron is destroyed', () => {
  const {p, w} = quiet(), job = jobsAt(p, 'anchorage')[0];
  acceptJob(p, job); assert.deepEqual(w.waypoint().pos, job.pos);
  w.playerShip.body.position = [job.pos[0] + 2500, 0, job.pos[1]]; run(w, 0.2);
  const squad = w.ships.filter(s => s.tag === job.id), boss = squad.find(s => s.boss);
  assert.equal(boss.name, WANTED[0].name); assert.equal(boss.cls, 'cutter'); assert.equal(p.mission.total, squad.length);
  const credits = p.credits; for (const s of squad) w.damage(s, 1e6, 0, 0, w.playerShip);
  const events = run(w, 0.2);
  assert.equal(p.mission, null); assert.equal(p.wanted, 1); assert.ok(p.credits >= credits + WANTED[0].reward); assert.ok(events.some(e => e.type === 'missionDone' && e.result.wanted));
  p.wanted = 3; p.credits = 5e6; const last = jobsAt(p, 'lantern')[0]; assert.equal(last.locked, null); acceptJob(p, last);
  w.playerShip.body.position = [last.pos[0] + 2500, 0, last.pos[1]]; run(w, 0.2);
  assert.equal(w.ships.find(s => s.boss).cls, 'dreadnought');
  for (const s of w.ships.filter(x => x.tag === last.id)) w.damage(s, 1e7, 0, 0, w.playerShip);
  assert.ok(run(w, 0.2).some(e => e.type === 'victory')); assert.equal(p.wanted, WANTED.length);
});

test('convoy contracts fail if every hauler is lost', () => {
  const {p, w} = quiet(); let job = null;
  for (let b = 0; !job; b++) { p.board = b; job = jobsAt(p, 'anchorage').find(j => j.kind === 'defend'); }
  acceptJob(p, job); w.playerShip.body.position = [job.pos[0] - 2600, 0, job.pos[1]]; run(w, 0.2);
  const wards = w.ships.filter(s => s.tag === job.id + ':ward'), raiders = w.ships.filter(s => s.tag === job.id);
  assert.ok(wards.length >= 1 && raiders.length >= 3); assert.ok(wards.every(s => w.attitude(s) !== 'hostile'));
  const rep = p.rep.league; for (const s of wards) w.damage(s, 1e6, 0, 0, raiders[0]);
  assert.ok(run(w, 0.2).some(e => e.type === 'missionFailed')); assert.equal(p.mission, null); assert.ok(p.rep.league < rep);
});

test('a destroyed ship takes no orders', () => {
  const {p, w} = quiet(); p.hp = 400; w.playerShip.hp = 400;
  w.damage(w.playerShip, 1e6, 0, 0, null); w.events.length = 0;
  assert.equal(w.over, true); assert.equal(p.stats.losses, 1);
  w.use(); w.toggleWarp(); w.launch(); assert.equal(w.fireTorpedo(), false);
  assert.equal(w.docked, null); assert.equal(p.hp, 400, 'the last docking record is untouched'); assert.equal(w.events.length, 0);
  const t = w.time; w.step(DT, {}); assert.equal(w.time, t);
});

test('the simulation is deterministic for a seed and command tape', () => {
  const play = () => {
    const p = newPlayer(77), w = new World(p);
    run(w, 25, i => ({rudder: Math.sin(i / 90), throttle: 1, hold: i % 240 < 120, aim: [Math.cos(i / 300), Math.sin(i / 300)], deflect: i % 500 < 60}));
    return JSON.stringify([w.playerShip.body, w.playerShip.sh, w.ships.map(s => [s.id, s.cls, s.body.position, s.hp]), w.shells.length, p.rep]);
  };
  assert.equal(play(), play());
});

test('ambient traffic appears and is hostile only where it should be', () => {
  const p = newPlayer(21), w = new World(p); run(w, 40, {throttle: 1});
  const npcs = w.ships.filter(s => !s.isPlayer);
  assert.ok(npcs.length >= 2 && npcs.length <= 30, `${npcs.length} ships nearby`);
  for (const s of npcs) { assert.ok(FACTIONS[s.faction] && s.body.position.every(Number.isFinite)); if (!FACTIONS[s.faction].outlaw) assert.notEqual(w.attitude(s), 'hostile'); }
});

test('models are finite and warships have a gunport for every cannon', () => {
  for (const [cls, v] of Object.entries(VESSELS)) {
    const m = vesselModel(cls, v.cannons ?? 0, v.turrets ?? 0, [1, 0, 0]);
    assert.ok(m.count > 20 && m.tris.every(Number.isFinite) && m.normals.every(Number.isFinite), cls); assert.ok(m.engines.length >= 1 && m.mounts.length >= 1);
    if (v.kind === 'capital') { assert.equal(m.ports.port.length, v.cannons); assert.equal(m.ports.star.length, v.cannons); assert.ok(m.ports.star.every(p => p[0] > 0) && m.ports.port.every(p => p[0] < 0)); }
  }
  for (const [id, h] of Object.entries(HULLS)) assert.ok(capitalModel(id, h.cannons, h.turrets, [1, 1, 1]).radius < h.radius * 1.6);
  for (const kind of Object.keys(STATION_RADIUS)) { const m = stationModel(kind, [1, 1, 0]); assert.ok(m.tris.every(Number.isFinite)); assert.ok(stationBoxes(kind).some(b => b.c[1] - b.s[1] / 2 < 0 && b.c[1] + b.s[1] / 2 > 0), `${kind} can be run into`); }
  for (const m of [...rockModels(0), ...rockModels(1, true), wreckModel(0), wreckModel(2), planetModel('gas')]) assert.ok(m.count > 0 && m.tris.every(Number.isFinite));
});

test('sound effects render deterministically inside 16-bit range', () => {
  for (const name of Object.keys(SOUNDS)) { const a = renderSound(name); assert.ok(a.length > 400 && a.length <= 8 * 48000); assert.deepEqual(a, renderSound(name)); assert.ok(a.some(v => v !== 0)); }
});

test('vendored VANILLAJS modules match their recorded provenance', () => {
  const dir = new URL('../vendor/vanillajs/', import.meta.url), record = JSON.parse(readFileSync(new URL('PROVENANCE.json', dir)));
  assert.match(record.commit, /^[0-9a-f]{40}$/); assert.deepEqual(record.localChanges, []); assert.equal(Object.keys(record.sha256).length, record.modules.length + 2);
  for (const [file, hash] of Object.entries(record.sha256)) assert.equal(createHash('sha256').update(readFileSync(new URL(file, dir))).digest('hex'), hash, file);
});

test('homing uses the full signed angle for astern, obtuse and overshot targets', () => {
  for (const offset of [[0, 600], [50, 600], [-50, 600], [500, -500]]) {
    const {w} = quiet(), me = w.playerShip;
    const [boat] = w.spawnSquadron({faction: 'pennant', threat: 2, pos: [8000, 0, 8000]});
    boat.body.position = [8000 + offset[0], 0, 8000 + offset[1]]; boat.body.velocity = [0,0,0];
    const t = {x: 8000, z: 8000, dir: [0,-1], target: boat.id, owner: me.id, life: 10};
    w.torpedoes.push(t); w.step(DT, {});
    const angle = Math.atan2(t.dir[0], -t.dir[1]);
    assert.ok(Math.abs(angle) > 0.001, 'even a directly astern target requires a turn');
    assert.ok(Math.abs(angle) <= TORPEDO.turn * DT + 1e-12, 'turn rate remains bounded');
    if (offset[0]) assert.equal(Math.sign(angle), Math.sign(offset[0]), 'shortest signed turn');
    assert.ok(Math.abs(Math.hypot(...t.dir) - 1) < 1e-12);
  }
});
