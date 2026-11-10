// SPDX-License-Identifier: Apache-2.0
// The battle plane: sailing, broadsides, turrets, deflectors, warp, traffic and contracts.
// Pure simulation on VANILLAJS flight / weapons / adaptive-circles / range2d / lead-solver.
// Ships are held to the X/Z plane (y = 0). Heading h turns left as it grows.
import {createBody, flightConfig, stepFlight} from '../../vendor/vanillajs/modules/flight/index.js';
import {clamp, seededRandom} from '../../vendor/vanillajs/modules/math/index.js';
import {WeaponTimer} from '../../vendor/vanillajs/modules/weapons/index.js';
import {AdaptiveCircleQueries} from '../../vendor/vanillajs/modules/adaptive-circles/index.js';
import {withinRange2D} from '../../vendor/vanillajs/modules/range2d/index.js';
import {leadIntercept} from '../../vendor/vanillajs/modules/lead-solver/index.js';
import {FACTIONS, SECTOR, STATIONS, HULLS, BROADSIDES, TURRETS, SHIELDS, DEFLECTORS, ENGINES, ARMORS, TORPEDO, GOODS, VESSELS, SQUADRONS, HOSTILE_REP, REFUSE_REP, atWar, captainName} from './data.js';
import {vesselModel, stationBoxes, STATION_RADIUS, scatterField} from './models.js';
import {cargoFree, adjustRep, maxHull, shieldCap, levelOf} from './player.js';
import {completeMission, failMission, missionOnDock} from './missions.js';
import {thinkNpc} from './ai.js';

export const AIM_TIME = 1.3, WARP_SPOOL = 2.2, WARP_SPEED = 2400, SENSOR = 5000, DOCK_SPEED = 80, WIDE_CONE = 0.26;
export const FORE = 0, STARBOARD = 1, AFT = 2, PORT = 3;
const AMMO = 2 ** 40, WHITE = [1, 1, 1];
const hashText = text => { let h = 2166136261; for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619); return h >>> 0; };
export const yawQuat = h => [0, Math.sin(h / 2), 0, Math.cos(h / 2)];
export const headingOf = ship => 2 * Math.atan2(ship.body.orientation[1], ship.body.orientation[3]);
export const forward2 = h => [-Math.sin(h), -Math.cos(h)];
const left2 = h => [-Math.cos(h), Math.sin(h)];
const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// OPT-REDUCE-001: static colliders are bucketed once so each hull only meets its neighbours.
class SolidGrid {
  constructor(cell = 600) { this.cell = cell; this.map = new Map(); this.stamp = 0; }
  add(solid) {
    const c = this.cell;
    for (let i = Math.floor(solid.box.min[0] / c); i <= Math.floor(solid.box.max[0] / c); i++) for (let k = Math.floor(solid.box.min[2] / c); k <= Math.floor(solid.box.max[2] / c); k++) {
      const key = (i + 512) * 1024 + (k + 512);
      if (!this.map.has(key)) this.map.set(key, []);
      this.map.get(key).push(solid);
    }
  }
  query(x, z, r, out = []) {
    const c = this.cell, stamp = ++this.stamp;
    for (let i = Math.floor((x - r) / c); i <= Math.floor((x + r) / c); i++) for (let k = Math.floor((z - r) / c); k <= Math.floor((z + r) / c); k++) {
      const list = this.map.get((i + 512) * 1024 + (k + 512));
      if (list) for (const s of list) if (s.stamp !== stamp && !s.dead) { s.stamp = stamp; out.push(s); }
    }
    return out;
  }
}

/** Static content of the sector: stations, rock and wreck fields, and their colliders. */
export function buildSector() {
  const stations = [], solids = [], grid = new SolidGrid();
  const solid = (centre, size) => {
    const h = size.map(v => v / 2), s = {box: {min: centre.map((v, i) => v - h[i]), max: centre.map((v, i) => v + h[i])}, x: centre[0], z: centre[2], r: Math.hypot(h[0], h[2]), stamp: 0, dead: false};
    solids.push(s); grid.add(s); return s;
  };
  SECTOR.stations.forEach((def, i) => {
    const radius = STATION_RADIUS[def.kind], pos = [def.pos[0], 0, def.pos[1]];
    stations.push({id: def.id, index: i, name: def.name, faction: def.faction, def, pos, xz: def.pos, radius, useRange: radius + 520});
    // Only parts that cross the battle plane can be run into.
    for (const b of stationBoxes(def.kind)) if (b.c[1] - b.s[1] / 2 < 6 && b.c[1] + b.s[1] / 2 > -6) solid([b.c[0] + pos[0], 0, b.c[2] + pos[2]], [b.s[0], 60, b.s[2]]);
  });
  const rocks = [], wrecks = [];
  for (const field of SECTOR.fields) {
    for (const item of scatterField(field, hashText(field.name))) {
      if (stations.some(s => Math.hypot(s.pos[0] - item.pos[0], s.pos[2] - item.pos[2]) < s.radius + item.radius + 420)) continue;
      const d = item.radius * (item.wreck ? 1.0 : 1.4), box = solid([item.pos[0], 0, item.pos[2]], [d, 60, d]);
      if (item.wreck) wrecks.push({...item, solid: box});
      else rocks.push({...item, solid: box, rich: !!field.rich, hp: item.radius <= 46 ? Math.round(item.radius * 9) : Infinity, dead: false});
    }
  }
  return {stations, byId: new Map(stations.map(s => [s.id, s])), solids, grid, rocks, wrecks};
}

export class World {
  /** traffic:false keeps ambient ships out (contract targets still appear); used by tests. */
  constructor(player, {seed = player.seed, traffic = true} = {}) {
    this.player = player; this.traffic = traffic; this.rng = seededRandom((seed ^ 0x2f6b8d41) >>> 0);
    this.sector = buildSector(); this.time = 0; this.events = []; this.nextId = 1; this.over = false;
    this.#reset(); this.launch(true);
  }
  #reset() {
    this.ships = []; this.byId = new Map(); this.shells = []; this.torpedoes = []; this.pickups = [];
    this.target = null; this.dest = null; this.docked = null; this.spawnT = 3; this.groupId = 0; this.ambushT = 6; this.staticDirty = true; this.aim = {side: null, t: 0};
    if (this.player.mission) { this.player.mission.spawned = false; this.player.mission.kills = 0; }
  }

  // Setup ------------------------------------------------------------------------------------
  /** Put to sea from the captain's current port. */
  launch(initial = false) {
    if (this.over) return;
    const p = this.player, port = this.sector.byId.get(p.station), hull = HULLS[p.hull];
    this.#reset();
    const a = ((port.index * 1.9) % (Math.PI * 2)) + 0.6, pos = [port.pos[0] + Math.cos(a) * (port.radius + 330), port.pos[2] + Math.sin(a) * (port.radius + 330)];
    this.playerShip = this.#makeShip({cls: p.hull, kind: 'capital', name: 'You', faction: 'player', isPlayer: true, pos, heading: Math.atan2(-Math.cos(a), -Math.sin(a)),
      hp: maxHull(p), shield: shieldCap(p), shieldRegen: SHIELDS[p.shield].regen, cannons: hull.cannons, turrets: hull.turrets, battery: p.battery, turret: p.turret,
      speed: hull.speed * ENGINES[p.engine].mult, accel: hull.accel * ENGINES[p.engine].mult, turn: hull.turn, radius: hull.radius, soak: ARMORS[p.armor].soak,
      deflector: DEFLECTORS[p.deflector], torps: p.torps, skill: 1});
    this.playerShip.hp = clamp(p.hp, 1, maxHull(p));
    if (this.traffic) for (let i = 0; i < 2; i++) this.#spawnTraffic(2000 + this.rng() * 1500, true);
    if (!initial) this.events.push({type: 'launch'});
  }
  #makeShip({cls, kind, name, faction, isPlayer = false, pos, heading, hp, shield, shieldRegen = 0.05, cannons = 0, turrets = 0, battery = null, turret = null,
    speed, accel, turn, radius, soak = 0, deflector = null, torps = 0, gun = null, skill = 0.5, ai = null, bounty = 0}) {
    const base = {assisted: true, response: 1.2, angularAcceleration: turn * 2.4, turnSpeed: turn, angularResponse: 3, brake: 1};
    const geometry = vesselModel(cls, cannons, turrets, WHITE);
    const timer = () => new WeaponTimer({magazineSize: cannons, reserve: AMMO, interval: 0.06, reloadTime: BROADSIDES[battery].reload});
    const ship = {
      id: this.nextId++, cls, kind, name, faction, isPlayer, alive: true, radius, skill, bounty, geometry,
      body: createBody({position: [pos[0], 0, pos[1]], orientation: yawQuat(heading), halfSize: radius * 0.55}),
      cfg: {normal: flightConfig({...base, acceleration: accel, maxSpeed: speed}), boost: flightConfig({...base, acceleration: accel * 2.6, maxSpeed: speed * 1.9}),
        warp: flightConfig({...base, acceleration: 1100, maxSpeed: WARP_SPEED, turnSpeed: 0.14})},
      speed, maxHp: hp, hp, sh: [shield, shield, shield, shield], shMax: shield, shRegen: shieldRegen, shSince: [9, 9, 9, 9], sinceHit: 99, soak,
      battery: battery && cannons ? {id: battery, def: BROADSIDES[battery], cannons, port: timer(), star: timer(), volley: {port: null, star: null}, fired: {port: 0, star: 0}} : null,
      turrets: turret ? Array.from({length: turrets}, (_, i) => ({def: TURRETS[turret], cd: 0.3 + i * 0.17})) : [], turretScan: 0, turretTargets: {light: null, heavy: null},
      gun, gunCd: 0, deflect: deflector ? {charge: 1, active: false, idle: 9, seconds: deflector.seconds, cut: deflector.cut} : null,
      torps, torpCd: 0, throttle: 0, boost: 1, boosting: false, warp: {state: 'off', t: 0}, heel: 0, flash: 0, provoked: false, ai,
      prevPos: [pos[0], 0, pos[1]], prevQ: yawQuat(heading),
    };
    this.ships.push(ship); this.byId.set(ship.id, ship);
    return ship;
  }

  // Queries ----------------------------------------------------------------------------------
  shipById(id) { return this.byId.get(id) ?? null; }
  distance(a, b) { return Math.hypot(a.body.position[0] - b.body.position[0], a.body.position[2] - b.body.position[2]); }
  say(from, text, tone = 'comm') { this.events.push({type: 'msg', from, text, tone}); }
  note(text, tone = 'info') { this.events.push({type: 'msg', text, tone}); }
  /** Signed angle from the bow to a plane direction; positive is to port. */
  bearingTo(ship, dir) { const h = headingOf(ship), f = forward2(h), l = left2(h); return Math.atan2(dir[0] * l[0] + dir[1] * l[1], dir[0] * f[0] + dir[1] * f[1]); }
  /** Plane position [x,z] of a ship-local point (x starboard, z astern). */
  localPoint(ship, local) { const h = headingOf(ship), f = forward2(h), l = left2(h), p = ship.body.position; return [p[0] - l[0] * local[0] - f[0] * local[2], p[2] - l[1] * local[0] - f[1] * local[2]]; }
  hostile(a, b) {
    if (a === b || a.isPlayer) return false;
    if (b.isPlayer) return a.provoked || ((this.player.rep[a.faction] ?? 0) < HOSTILE_REP && a.kind !== 'hauler');
    return atWar(a.faction, b.faction);
  }
  attitude(ship) { return this.hostile(ship, this.playerShip) ? 'hostile' : (this.player.rep[ship.faction] ?? 0) >= 0.3 ? 'friendly' : 'neutral'; }
  stationHostile(station) { return (this.player.rep[station.faction] ?? 0) <= REFUSE_REP; }
  fieldAt(x, z) { return SECTOR.fields.find(f => Math.hypot(x - f.pos[0], z - f.pos[1]) < f.radius) ?? null; }
  /** Bend a plane heading away from nearby solids. */
  avoid(ship, dir) {
    const p = ship.body.position, near = this.sector.grid.query(p[0] + dir[0] * 160, p[2] + dir[1] * 160, 300);
    let x = dir[0], z = dir[1];
    for (const s of near) {
      const tx = s.x - p[0], tz = s.z - p[2], ahead = tx * dir[0] + tz * dir[1];
      if (ahead < -s.r || ahead > 420 + s.r) continue;
      const lx = tx - dir[0] * ahead, lz = tz - dir[1] * ahead, d = Math.hypot(lx, lz), clear = s.r + ship.radius + 50;
      if (d >= clear) continue;
      const k = (clear - d) / clear * 2.4;
      if (d > 1) { x -= lx / d * k; z -= lz / d * k; } else { x -= dir[1] * k; z += dir[0] * k; }
    }
    const l = Math.hypot(x, z) || 1;
    return [x / l, z / l];
  }
  batteryReady(ship, side) { const s = ship.battery?.[side].snapshot(); return !!s && s.phase === 'ready' && s.ammo === s.magazineSize && !ship.battery.volley[side]; }
  /** 0..1 readiness of a broadside for the HUD. */
  batteryState(ship, side) {
    const b = ship.battery; if (!b) return 0;
    const s = b[side].snapshot();
    return s.phase === 'reloading' ? 1 - s.reloadRemaining / b.def.reload : s.ammo / s.magazineSize;
  }
  /** Which broadside bears on a plane direction: 'port', 'star' or null. */
  sideFor(ship, dir) { const b = this.bearingTo(ship, dir), a = Math.abs(b); return a > 0.52 && a < 2.62 ? (b > 0 ? 'port' : 'star') : null; }
  targetObject() { const s = this.target ? this.byId.get(this.target) : null; return s?.alive ? s : null; }
  leadFor(ship) {
    const me = this.playerShip, gun = me.battery.def;
    return leadIntercept({shooterPosition: me.body.position, targetPosition: ship.body.position, targetVelocity: ship.body.velocity, projectileSpeed: gun.speed, maxTime: 5})?.interceptPoint ?? null;
  }
  contacts() {
    const out = [];
    for (const s of this.ships) if (!s.isPlayer && s.alive) { const d = this.distance(s, this.playerShip); if (d < SENSOR) out.push({ship: s, dist: d, attitude: this.attitude(s)}); }
    return out.sort((a, b) => a.dist - b.dist);
  }
  /** Where the active contract points: {pos:[x,z], label}. */
  waypoint() {
    const m = this.player.mission;
    if (!m) return null;
    return m.kind === 'delivery' ? {pos: STATIONS[m.dest].pos, label: STATIONS[m.dest].name, station: m.dest} : {pos: m.pos, label: m.kind === 'defend' ? 'Distress beacon' : m.boss};
  }
  /** The selected destination for warp and the HUD: a station or the contract marker. */
  destination() {
    if (this.dest === 'contract') { const w = this.waypoint(); return w ? {pos: w.pos, label: w.label, radius: 300} : null; }
    const s = this.dest ? this.sector.byId.get(this.dest) : null;
    return s ? {pos: s.xz, label: s.name, radius: s.radius, station: s} : null;
  }

  // Player verbs -----------------------------------------------------------------------------
  targetNearestHostile() { const c = this.contacts().find(k => k.attitude === 'hostile'); if (c) this.target = c.ship.id; else this.note('No hostiles on the plot.'); return c?.ship ?? null; }
  cycleTarget() {
    const list = this.contacts(); if (!list.length) { this.target = null; return null; }
    const at = list.findIndex(c => c.ship.id === this.target), next = list[(at + 1) % list.length].ship;
    this.target = next.id; return next;
  }
  cycleDest() {
    const me = this.playerShip.body.position, list = [...(this.waypoint() ? ['contract'] : []), ...[...this.sector.stations].sort((a, b) => dist2(a.xz, [me[0], me[2]]) - dist2(b.xz, [me[0], me[2]])).map(s => s.id)];
    this.dest = list[(list.indexOf(this.dest) + 1) % list.length];
    this.note(`Course plotted: ${this.destination().label}.`);
  }
  selectDest(id) { if (id === 'contract' ? this.waypoint() : this.sector.byId.has(id)) this.dest = id; }
  toggleWarp() {
    const ship = this.playerShip;
    if (this.over || this.docked) return;
    if (ship.warp.state !== 'off') return this.#dropWarp('Warp drive disengaged.');
    if (this.contacts().some(c => c.attitude === 'hostile' && c.dist < 1700)) return this.note('Hostiles too close to spool the warp drive.', 'warn');
    ship.warp = {state: 'spool', t: 0}; this.events.push({type: 'warp', state: 'spool'});
    this.note(this.destination() ? `Warp drive spooling: ${this.destination().label}.` : 'Warp drive spooling. No course plotted: holding this heading.');
  }
  #dropWarp(text, tone = 'info') {
    const ship = this.playerShip;
    if (ship.warp.state === 'off') return;
    // Leaving warp sheds the drive's speed at once; the hull keeps only ordinary way.
    const v = ship.body.velocity, speed = Math.hypot(v[0], v[2]), keep = Math.min(1, ship.speed * 0.6 / (speed || 1));
    ship.body.velocity = [v[0] * keep, 0, v[2] * keep];
    ship.warp = {state: 'off', t: 0}; ship.throttle = 0.5; this.events.push({type: 'warp', state: 'off'});
    if (text) this.note(text, tone);
  }
  fireTorpedo() {
    const ship = this.playerShip, target = this.targetObject();
    if (this.over || this.docked) return false;
    if (!target) { this.note('Select a target first (R or T).'); return false; }
    if (ship.torps < 1) { this.note('Torpedo tubes empty.', 'warn'); return false; }
    if (ship.torpCd > 0 || ship.warp.state !== 'off') return false;
    ship.torps--; ship.torpCd = TORPEDO.cooldown;
    const h = headingOf(ship), f = forward2(h), p = ship.body.position;
    this.torpedoes.push({id: this.nextId++, x: p[0] + f[0] * ship.radius, z: p[2] + f[1] * ship.radius, dir: f, target: target.id, owner: ship.id, life: TORPEDO.life});
    this.events.push({type: 'torpedo', pos: [...p]});
    return true;
  }
  /** Dock at the nearest port when close and slow enough. */
  use() {
    if (this.over || this.docked) return;
    const ship = this.playerShip, p = ship.body.position, speed = Math.hypot(ship.body.velocity[0], ship.body.velocity[2]);
    const port = this.sector.stations.map(s => ({s, d: Math.hypot(s.pos[0] - p[0], s.pos[2] - p[2])})).sort((a, b) => a.d - b.d)[0];
    if (port.d > port.s.useRange) return this.note(`No port in range. ${port.s.name} is ${Math.round(port.d - port.s.useRange)} m short of docking range.`);
    if (this.stationHostile(port.s)) return this.note(`${port.s.name} refuses you. This port lists you as hostile.`, 'warn');
    if (speed > DOCK_SPEED) return this.note('Too fast to dock. Slow below 80 m/s.', 'warn');
    this.syncPlayer();
    const player = this.player; player.station = port.s.id; player.board++; this.docked = port.s.id;
    this.events.push({type: 'dock', station: port.s.id, result: missionOnDock(player, port.s.id)});
  }
  syncPlayer() { const p = this.player, s = this.playerShip; p.hp = Math.max(1, Math.ceil(s.hp)); p.torps = s.torps; }

  // Simulation -------------------------------------------------------------------------------
  /** cmd: {rudder:-1..1 (+ = port), throttle:-1..1, boost, deflect, hold, aim:[x,z], torpedo} */
  step(dt, cmd = {}) {
    if (this.over || this.docked) return;
    this.time += dt; this.player.time += dt;
    const me = this.playerShip;
    for (const s of this.ships) { s.prevPos = [...s.body.position]; s.prevQ = [...s.body.orientation]; }
    if (cmd.throttle) me.throttle = clamp(me.throttle + cmd.throttle * dt * 0.7, 0, 1);
    const ctl = {rudder: clamp(cmd.rudder ?? 0, -1, 1), boost: !!cmd.boost, deflect: !!cmd.deflect, volley: null};
    this.#stepWarp(me, ctl, cmd, dt);
    this.#stepAim(me, ctl, cmd, dt);
    this.#control(me, ctl, dt);
    if (cmd.torpedo) this.fireTorpedo();
    for (const s of this.ships) {
      if (s.isPlayer || !s.alive) continue;
      const npc = thinkNpc(this, s, dt);
      if (s.alive && !s.gone) this.#control(s, npc, dt);
    }
    this.#stepShells(dt);
    this.#stepTorpedoes(dt);
    this.#stepPickups(dt);
    this.#stepMission();
    this.#spawner(dt);
    if (this.ships.some(s => !s.alive || s.gone)) {
      for (const s of this.ships) if (!s.alive || s.gone) this.byId.delete(s.id);
      this.ships = this.ships.filter(s => s.alive && !s.gone);
    }
    if (this.target && !this.targetObject()) this.target = null;
  }

  #stepWarp(ship, ctl, cmd, dt) {
    const w = ship.warp;
    if (w.state === 'off') return;
    const dest = this.destination(), p = ship.body.position;
    if (dest) {
      const dx = dest.pos[0] - p[0], dz = dest.pos[1] - p[2], d = Math.hypot(dx, dz);
      if (d < dest.radius + 1300) return this.#dropWarp(`Dropped out of warp off ${dest.label}.`, 'good');
      if (!cmd.rudder) ctl.rudder = clamp(this.bearingTo(ship, this.avoid(ship, [dx / d, dz / d])) * 3, -1, 1);
    }
    if (w.state === 'spool') {
      w.t += dt; ship.throttle = Math.max(ship.throttle, 0.4);
      if (w.t >= WARP_SPOOL) { w.state = 'on'; this.events.push({type: 'warp', state: 'on'}); }
      return;
    }
    if (this.contacts().some(c => c.attitude === 'hostile' && c.dist < 1500)) return this.#dropWarp('Interdicted! Hostiles have pulled you out of warp.', 'warn');
    if (!this.traffic) return;
    this.ambushT -= dt;
    if (this.ambushT > 0) return;
    this.ambushT = 5 + this.rng() * 5;
    const field = this.fieldAt(p[0], p[2]);
    if (this.rng() < (field?.kind === 'wrecks' ? 0.4 : 0.07)) {
      const f = forward2(headingOf(ship)), threat = clamp(Math.round((field?.threat ?? 1) + levelOf(this.player) * 0.3 + this.rng() * 0.8), 1, 6);
      this.spawnSquadron({faction: 'pennant', threat, pos: [p[0] + f[0] * 2400, p[2] + f[1] * 2400], dest: [p[0] + f[0] * 1200, p[2] + f[1] * 1200]});
      this.#dropWarp('Ambush! A Pennant squadron has dragged you out of warp.', 'warn');
    }
  }

  #stepAim(ship, ctl, cmd, dt) {
    const aim = this.aim, dir = cmd.aim ?? forward2(headingOf(ship)), side = this.sideFor(ship, dir), gun = ship.battery.def;
    if (ship.warp.state !== 'off') { aim.side = null; aim.t = 0; return; }
    if (cmd.hold) {
      if (side && this.batteryReady(ship, side)) { if (aim.side !== side) { aim.side = side; aim.t = 0; } aim.t = Math.min(1, aim.t + dt / AIM_TIME); }
      else if (aim.side && side !== aim.side) { aim.side = null; aim.t = 0; }
      aim.dir = dir;
    } else if (aim.side) {
      if (side === aim.side) ctl.volley = {side, dir, cone: this.aimCone()};
      aim.side = null; aim.t = 0;
    }
    aim.bearing = side; aim.gun = gun;
  }
  /** Current spread of the player's steadied broadside, in radians. */
  aimCone() { const gun = this.playerShip.battery.def; return WIDE_CONE + (gun.cone - WIDE_CONE) * this.aim.t ** 0.7; }

  #control(ship, c, dt) {
    const body = ship.body;
    ship.sinceHit += dt; ship.flash = Math.max(0, ship.flash - dt); ship.gunCd -= dt; ship.torpCd -= dt;
    for (let q = 0; q < 4; q++) { ship.shSince[q] += dt; if (ship.shSince[q] > 5 && ship.sh[q] < ship.shMax) ship.sh[q] = Math.min(ship.shMax, ship.sh[q] + ship.shMax * ship.shRegen * dt); }
    const d = ship.deflect;
    if (d) {
      const was = d.active;
      d.active = c.deflect && d.charge > 0 && (was || d.charge > 0.15);
      if (d.active) { d.charge = Math.max(0, d.charge - dt / d.seconds); d.idle = 0; if (!was) this.events.push({type: 'deflect', pos: [...body.position], mine: ship.isPlayer}); }
      else { d.idle += dt; if (d.idle > 1.5) d.charge = Math.min(1, d.charge + dt / 9); }
    }
    let cfg = ship.cfg.normal, thrust = ship.throttle;
    ship.boosting = false;
    if (ship.warp.state === 'on') { cfg = ship.cfg.warp; thrust = 1; }
    else if (c.boost && ship.boost > 0.02 && ship.throttle > 0.05) { cfg = ship.cfg.boost; thrust = 1; ship.boost -= dt / 6; ship.boosting = true; }
    if (!ship.boosting) ship.boost = Math.min(1, ship.boost + dt / 11);
    const speed = Math.hypot(body.velocity[0], body.velocity[2]), near = this.sector.grid.query(body.position[0], body.position[2], 90 + ship.radius + speed * dt);
    const result = stepFlight(body, {thrust: [0, 0, -thrust], turn: [0, c.rudder, 0], brake: false}, dt, cfg, near.length ? near.map(s => s.box) : []);
    // Hold the hull to the battle plane: yaw only.
    body.position[1] = 0; body.velocity[1] = 0; body.angularVelocity[0] = 0; body.angularVelocity[2] = 0;
    const q = body.orientation, n = Math.hypot(q[1], q[3]) || 1; body.orientation = [0, q[1] / n, 0, q[3] / n];
    ship.heel += (clamp(body.angularVelocity[1] * (ship.kind === 'craft' ? 0.5 : 0.28), -0.8, 0.8) - ship.heel) * Math.min(1, dt * 4);
    if (result.contacts.length) {
      const lost = speed - Math.hypot(body.velocity[0], body.velocity[2]);
      if (lost > 16) {
        if (ship.isPlayer) { this.#dropWarp('Collision! Warp drive tripped.', 'warn'); this.events.push({type: 'bump'}); }
        this.damage(ship, Math.min(ship.maxHp * 0.25, (lost - 16) * 3), body.position[0] + body.velocity[0], body.position[2] + body.velocity[2], null);
      }
    }
    if (!ship.alive) return;
    if (ship.battery) this.#stepBattery(ship, c.volley, dt);
    if (ship.turrets.length && ship.warp.state === 'off') this.#stepTurrets(ship, dt);
    if (c.craftFire && ship.gun && ship.gunCd <= 0) {
      const h = headingOf(ship), f = forward2(h), p = body.position;
      ship.gunCd = 1 / ship.gun.rate;
      this.#shell(ship, p[0] + f[0] * ship.radius, p[2] + f[1] * ship.radius, [f[0] + (this.rng() - 0.5) * 0.06, f[1] + (this.rng() - 0.5) * 0.06], ship.gun, [1, 0.5, 0.4], 'craft');
    }
  }

  #stepBattery(ship, order, dt) {
    const b = ship.battery;
    if (order && this.batteryReady(ship, order.side)) { b.volley[order.side] = {dir: order.dir, cone: order.cone}; b.fired[order.side] = 0; }
    for (const side of ['port', 'star']) {
      const timer = b[side], volley = b.volley[side], snap = timer.snapshot();
      for (const e of timer.step(dt, {fire: !!volley, reload: snap.ammo === 0})) {
        if (e.type !== 'shot') continue;
        const port = ship.geometry.ports[side][b.fired[side] % ship.geometry.ports[side].length], origin = this.localPoint(ship, port);
        const spread = (this.rng() - 0.5) * 2 * volley.cone, cos = Math.cos(spread), sin = Math.sin(spread);
        this.#shell(ship, origin[0], origin[1], [volley.dir[0] * cos - volley.dir[1] * sin, volley.dir[0] * sin + volley.dir[1] * cos], b.def, b.def.color, 'broadside');
        if (++b.fired[side] >= b.cannons) b.volley[side] = null;
      }
    }
  }

  #stepTurrets(ship, dt) {
    ship.turretScan -= dt;
    if (ship.turretScan <= 0) {
      ship.turretScan = 0.3;
      const p = ship.body.position, origin = {x: p[0], y: p[2]}, reach = ship.turrets[0].def.range + 40;
      let light = null, heavy = null, lightD = Infinity, heavyD = Infinity;
      for (const other of this.ships) {
        if (other === ship || !other.alive) continue;
        if (ship.isPlayer ? !this.hostile(other, ship) : !this.hostile(ship, other)) continue;
        const o = other.body.position;
        // OPT-REDUCE-001 through the engine's exact axis-reject range check.
        if (!withinRange2D(origin, {x: o[0], y: o[2]}, reach + other.radius)) continue;
        const d = Math.hypot(o[0] - p[0], o[2] - p[2]);
        if (other.kind === 'craft') { if (d < lightD) { lightD = d; light = other; } } else if (d < heavyD) { heavyD = d; heavy = other; }
      }
      ship.turretTargets = {light: light ?? heavy, heavy: heavy ?? light};
    }
    const mounts = ship.geometry.mounts;
    ship.turrets.forEach((t, i) => {
      t.cd -= dt;
      const target = t.def.blast || t.def.rate > 3 ? ship.turretTargets.light : ship.turretTargets.heavy;
      if (t.cd > 0 || !target?.alive) return;
      const mount = mounts[i % mounts.length], origin = this.localPoint(ship, [mount[0], 0, mount[2]]);
      const s = leadIntercept({shooterPosition: [origin[0], 0, origin[1]], targetPosition: target.body.position, targetVelocity: target.body.velocity, projectileSpeed: t.def.speed, maxTime: 2.5});
      if (!s || s.time * t.def.speed > t.def.range) { t.cd = 0.15; return; }
      const wobble = (1 - ship.skill) * 0.12 + 0.02;
      t.cd = 1 / t.def.rate;
      this.#shell(ship, origin[0], origin[1], [s.direction[0] + (this.rng() - 0.5) * wobble, s.direction[2] + (this.rng() - 0.5) * wobble], t.def, t.def.color, 'turret');
    });
  }

  #shell(ship, x, z, dir, def, color, kind) {
    const l = Math.hypot(dir[0], dir[1]) || 1;
    this.shells.push({x, z, vx: dir[0] / l * def.speed, vz: dir[1] / l * def.speed, life: def.range / def.speed, dmg: def.dmg, blast: def.blast ?? 0, owner: ship.id,
      faction: ship.faction, vsPlayer: !ship.isPlayer && this.hostile(ship, this.playerShip), mine: ship.isPlayer, color, kind});
    if (kind !== 'turret' || this.shells.length % 3 === 0) this.events.push({type: 'shot', kind, pos: [x, 0, z], mine: ship.isPlayer});
  }

  #staticQueries() {
    if (!this.staticDirty) return this.statics;
    const circles = [], core = {citadel: 75, exchange: 335, works: 165, reef: 135};
    for (const s of this.sector.stations) circles.push({id: 1 + s.index, x: s.pos[0], y: s.pos[2], radius: core[s.def.kind]});
    this.sector.rocks.forEach((r, i) => { if (!r.dead) circles.push({id: 1000 + i, x: r.pos[0], y: r.pos[2], radius: r.radius * 0.8}); });
    this.sector.wrecks.forEach((w, i) => circles.push({id: 200000 + i, x: w.pos[0], y: w.pos[2], radius: w.radius * 0.6}));
    this.staticDirty = false;
    return (this.statics = new AdaptiveCircleQueries(circles, {cellSize: 400}));
  }
  #stepShells(dt) {
    if (!this.shells.length) return;
    // One immutable snapshot of every hull this tick, queried by each shell (engine adaptive-circles).
    const hulls = new AdaptiveCircleQueries(this.ships.filter(s => s.alive).map(s => ({id: s.id, x: s.body.position[0], y: s.body.position[2], radius: s.radius * 0.82})));
    const statics = this.#staticQueries(), ignore = new Map(), me = this.playerShip;
    const friends = shell => {
      if (shell.mine) return [shell.owner];
      const key = shell.faction + (shell.vsPlayer ? '!' : '');
      if (!ignore.has(key)) ignore.set(key, this.ships.filter(s => s.alive && (s.isPlayer ? !shell.vsPlayer : !atWar(shell.faction, s.faction))).map(s => s.id));
      return ignore.get(key);
    };
    for (const sh of this.shells) {
      const dx = sh.vx * dt, dz = sh.vz * dt, hull = hulls.castSegment([sh.x, sh.z], [dx, dz], {ignoreIds: friends(sh)}).hit;
      const near = Math.abs(sh.x - me.body.position[0]) < 4000 && Math.abs(sh.z - me.body.position[2]) < 4000;
      const rock = near ? statics.castSegment([sh.x, sh.z], [dx, dz]).hit : null;
      sh.life -= dt;
      if (!hull && !rock) { sh.x += dx; sh.z += dz; continue; }
      const t = hull && (!rock || hull.time <= rock.time) ? hull.time : rock.time, hx = sh.x + dx * t, hz = sh.z + dz * t;
      sh.life = 0;
      if (hull && (!rock || hull.time <= rock.time)) {
        const victim = this.byId.get(hull.id), owner = this.byId.get(sh.owner) ?? null, k = sh.mine ? 1 : victim.isPlayer ? 0.75 : 0.8;
        this.damage(victim, sh.dmg * k, sh.x, sh.z, owner, [hx, hz]);
        if (sh.blast) for (const other of this.ships) {
          if (other === victim || !other.alive || other.id === sh.owner || Math.hypot(other.body.position[0] - hx, other.body.position[2] - hz) > sh.blast + other.radius) continue;
          if (sh.mine ? this.hostile(other, me) : owner && this.hostile(owner, other)) this.damage(other, sh.dmg * k * 0.7, hx, hz, owner);
        }
      } else {
        this.events.push({type: 'spark', pos: [hx, 0, hz], big: sh.kind === 'broadside'});
        if (sh.mine && rock.id >= 1000 && rock.id < 200000) this.#mine(this.sector.rocks[rock.id - 1000], sh.dmg);
      }
    }
    this.shells = this.shells.filter(s => s.life > 0);
  }
  #mine(rock, dmg) {
    if (rock.dead || rock.hp === Infinity) return;
    rock.hp -= dmg;
    if (rock.hp > 0) return;
    rock.dead = true; rock.solid.dead = true; this.staticDirty = true; this.player.stats.mined++;
    this.events.push({type: 'explode', pos: [...rock.pos], size: rock.radius * 0.5, rock: true});
    const r = this.rng, count = 1 + Math.floor(rock.radius / 16 + r() * 1.5);
    for (let i = 0; i < count; i++) this.#drop(rock.pos[0], rock.pos[2], rock.rich && r() < 0.45 ? 'crystal' : 'ore', 1 + Math.floor(r() * 3));
  }
  #drop(x, z, good, qty) {
    const r = this.rng, a = r() * Math.PI * 2, v = 10 + r() * 22;
    this.pickups.push({id: this.nextId++, x, z, vx: Math.cos(a) * v, vz: Math.sin(a) * v, good, qty, life: 140});
  }

  /** Apply damage arriving from plane point (fromX, fromZ). The facing shield screen takes it first. */
  damage(victim, amount, fromX, fromZ, source, at = null) {
    if (!victim.alive) return;
    const p = victim.body.position, h = headingOf(victim), f = forward2(h), l = left2(h), dx = fromX - p[0], dz = fromZ - p[2];
    const fore = dx * f[0] + dz * f[1], port = dx * l[0] + dz * l[1], q = Math.abs(fore) >= Math.abs(port) ? (fore > 0 ? FORE : AFT) : (port > 0 ? PORT : STARBOARD);
    const deflected = victim.deflect?.active;
    if (deflected) amount *= 1 - victim.deflect.cut;
    victim.sinceHit = 0; victim.shSince[q] = 0;
    const screened = victim.sh[q] > 0;
    if (screened) { victim.sh[q] -= amount; amount = victim.sh[q] < 0 ? -victim.sh[q] : 0; victim.sh[q] = Math.max(0, victim.sh[q]); }
    if (amount > 0) { victim.hp -= Math.max(1, amount - victim.soak); victim.flash = 0.25; }
    this.events.push({type: 'hit', pos: at ? [at[0], 0, at[1]] : [p[0], 0, p[2]], shield: screened || deflected, deflected, onPlayer: victim.isPlayer, quadrant: q});
    if (source) {
      if (victim.ai) victim.ai.attacker = source.id;
      if (source.isPlayer && !victim.isPlayer) { victim.byPlayer = true; this.#provoke(victim); }
    }
    if (victim.isPlayer) { this.events.push({type: 'playerHit', shield: screened, quadrant: q}); if (victim.warp.state === 'spool') this.#dropWarp('Warp spool broken by enemy fire.', 'warn'); }
    if (victim.hp <= 0) this.#destroy(victim, source);
  }
  #provoke(victim) {
    if (this.hostile(victim, this.playerShip)) return;
    adjustRep(this.player, victim.faction, -0.06);
    for (const s of this.ships) if (!s.isPlayer && !atWar(s.faction, victim.faction) && this.distance(s, victim) < 3500) s.provoked = true;
    if (victim.kind === 'hauler') this.say(`${FACTIONS[victim.faction].short} ${victim.name}`, 'Mayday! We are being fired upon!', 'warn');
  }
  #destroy(victim, source) {
    victim.alive = false; victim.hp = 0;
    const p = this.player, pos = [...victim.body.position];
    this.events.push({type: 'explode', pos, size: victim.radius, vel: [...victim.body.velocity]});
    if (victim.isPlayer) { this.over = true; p.stats.losses++; this.events.push({type: 'playerDead'}); return; }
    if (source?.isPlayer || victim.byPlayer) {
      p.stats.kills++; if (victim.kind !== 'craft') p.stats.capitals++;
      if (FACTIONS[victim.faction].outlaw) {
        adjustRep(p, 'pennant', -0.03); adjustRep(p, 'watch', 0.015); adjustRep(p, 'league', 0.01);
        if (p.rep.watch > HOSTILE_REP && victim.bounty) { p.credits += victim.bounty; p.stats.earned += victim.bounty; if (victim.kind !== 'craft') this.note(`${victim.name} destroyed. Watch bounty: ${victim.bounty} cr.`, 'good'); }
      } else { adjustRep(p, victim.faction, -0.1); adjustRep(p, victim.faction === 'watch' ? 'league' : 'watch', -0.05); adjustRep(p, 'pennant', 0.04); this.note(`${FACTIONS[victim.faction].short} ${victim.name} destroyed.`); }
    }
    const m = p.mission;
    if (m && victim.tag === m.id) m.kills++;
    if (this.distance(victim, this.playerShip) < 4000 && victim.kind !== 'craft') {
      const r = this.rng, table = victim.kind === 'hauler' ? ['grain', 'alloys', 'tools', 'medicine', 'spirits'] : victim.faction === 'pennant' ? ['salvage', 'salvage', 'arms', 'spirits'] : ['salvage', 'alloys'];
      for (let i = 0, n = 1 + Math.floor(victim.radius / 12 + r() * 1.5); i < n; i++) this.#drop(pos[0], pos[2], table[Math.floor(r() * table.length)], 1 + Math.floor(r() * (victim.kind === 'hauler' ? 6 : 3)));
    }
  }

  #stepTorpedoes(dt) {
    for (const t of this.torpedoes) {
      const target = this.byId.get(t.target); t.life -= dt;
      if (target?.alive) {
        const lead = Math.min(2, Math.hypot(target.body.position[0] - t.x, target.body.position[2] - t.z) / TORPEDO.speed);
        const wx = target.body.position[0] + target.body.velocity[0] * lead - t.x, wz = target.body.position[2] + target.body.velocity[2] * lead - t.z, wl = Math.hypot(wx, wz) || 1;
        const cross = t.dir[0] * wz / wl - t.dir[1] * wx / wl;
        const dot = t.dir[0] * wx / wl + t.dir[1] * wz / wl;
        const turn = clamp(Math.atan2(cross, dot), -TORPEDO.turn * dt, TORPEDO.turn * dt), c = Math.cos(turn), s = Math.sin(turn);
        t.dir = [t.dir[0] * c - t.dir[1] * s, t.dir[0] * s + t.dir[1] * c];
      }
      t.x += t.dir[0] * TORPEDO.speed * dt; t.z += t.dir[1] * TORPEDO.speed * dt;
      const hit = target?.alive && Math.hypot(target.body.position[0] - t.x, target.body.position[2] - t.z) < target.radius;
      if (!hit && t.life > 0) continue;
      t.dead = true; this.events.push({type: 'explode', pos: [t.x, 0, t.z], size: hit ? 9 : 3});
      if (!hit) continue;
      const owner = this.byId.get(t.owner) ?? null;
      for (const s of [...this.ships]) {
        const d = Math.hypot(s.body.position[0] - t.x, s.body.position[2] - t.z) - s.radius;
        if (s.alive && s.id !== t.owner && d < TORPEDO.blast && (s === target || this.hostile(s, this.playerShip))) this.damage(s, TORPEDO.dmg * (s === target ? 1 : 0.5), t.x - t.dir[0] * 5, t.z - t.dir[1] * 5, owner);
      }
    }
    if (this.torpedoes.some(t => t.dead)) this.torpedoes = this.torpedoes.filter(t => !t.dead);
  }

  #stepPickups(dt) {
    if (!this.pickups.length) return;
    const ship = this.playerShip, p = ship.body.position, cap = this.player;
    for (const k of this.pickups) {
      k.life -= dt;
      const dx = p[0] - k.x, dz = p[2] - k.z, d = Math.hypot(dx, dz) || 1;
      if (d < 420 && ship.warp.state === 'off' && cargoFree(cap) > 0) { // the tractor is always on
        const pull = 130 + Math.hypot(ship.body.velocity[0], ship.body.velocity[2]);
        k.vx += (dx / d * pull - k.vx) * Math.min(1, dt * 4); k.vz += (dz / d * pull - k.vz) * Math.min(1, dt * 4);
      } else { k.vx *= Math.exp(-dt * 0.4); k.vz *= Math.exp(-dt * 0.4); }
      k.x += k.vx * dt; k.z += k.vz * dt;
      if (d > ship.radius + 10) continue;
      const take = Math.min(k.qty, cargoFree(cap));
      if (take < 1) { if (!k.warned) { k.warned = true; this.note('Hold full.', 'warn'); } continue; }
      cap.cargo[k.good] = (cap.cargo[k.good] ?? 0) + take; k.life = 0;
      this.note(`Recovered ${take} ${GOODS[k.good].name}.`, 'good'); this.events.push({type: 'pickup'});
    }
    if (this.pickups.some(k => k.life <= 0)) this.pickups = this.pickups.filter(k => k.life > 0);
  }

  #stepMission() {
    const p = this.player, m = p.mission, me = this.playerShip.body.position;
    if (!m || m.kind === 'delivery') return;
    if (!m.spawned && Math.hypot(me[0] - m.pos[0], me[2] - m.pos[1]) < 3600) {
      m.spawned = true; m.kills = 0;
      if (m.kind === 'defend') {
        const wards = this.#spawnGroup({faction: 'league', list: [['drover', 1 + (m.threat > 2 ? 1 : 0)]], pos: m.pos, dest: STATIONS.coldharbor.pos, tag: m.id + ':ward'});
        const raiders = this.spawnSquadron({faction: 'pennant', threat: m.threat, pos: [m.pos[0] + 900, m.pos[1] + 500], dest: m.pos, tag: m.id});
        for (const s of raiders) s.ai.prey = m.id + ':ward';
        m.total = raiders.length; m.wards = wards.length;
        this.say('League convoy', 'Thank the stars. They are all over us, captain!', 'warn');
      } else {
        const squad = this.spawnSquadron({faction: 'pennant', threat: m.threat, pos: m.pos, dest: m.pos, tag: m.id, boss: {name: m.boss, vessel: m.vessel}});
        m.total = squad.length; this.note(`${m.boss}'s squadron is on the plot.`, 'warn');
      }
    }
    if (!m.spawned) return;
    if (m.kind === 'defend' && !this.ships.some(s => s.alive && s.tag === m.id + ':ward')) return void this.events.push({type: 'missionFailed', result: failMission(p, 'The convoy was lost with all hands.')});
    if (m.kills >= m.total) {
      const result = completeMission(p);
      this.events.push({type: 'missionDone', result});
      if (result.victory) this.events.push({type: 'victory'});
    }
  }

  // Traffic ----------------------------------------------------------------------------------
  #spawner(dt) {
    const me = this.playerShip;
    for (const s of this.ships) if (!s.isPlayer && !s.tag && this.distance(s, me) > 9000) s.gone = true;
    this.spawnT -= dt;
    if (this.spawnT > 0 || !this.traffic || me.warp.state === 'on') return;
    this.spawnT = 5 + this.rng() * 5;
    if (new Set(this.ships.filter(s => s.ai && !s.tag).map(s => s.ai.group)).size >= 3) return;
    this.#spawnTraffic(3400 + this.rng() * 900);
  }
  #spawnTraffic(range, calm = false) {
    const r = this.rng, p = this.playerShip.body.position, field = this.fieldAt(p[0], p[2]), level = levelOf(this.player);
    const a = r() * Math.PI * 2, pos = [p[0] + Math.cos(a) * range, p[2] + Math.sin(a) * range];
    const ports = this.sector.stations, port = () => ports[Math.floor(r() * ports.length)];
    const guarded = ports.some(s => !FACTIONS[s.faction].outlaw && Math.hypot(s.pos[0] - p[0], s.pos[2] - p[2]) < 5500);
    const roll = r(), raiders = field?.kind === 'wrecks' ? 0.7 : guarded || calm ? 0.04 : 0.3;
    if (roll < raiders) return this.spawnSquadron({faction: 'pennant', threat: clamp(Math.round((field?.threat ?? 1) * 0.6 + level * 0.4 + r() * 0.9), 1, 6), pos, dest: [p[0], p[2]]});
    if (roll < raiders + (1 - raiders) * 0.45) return this.#spawnGroup({faction: 'watch', list: [[level > 5 ? 'corvette' : 'cutter', 1], ['barracuda', level > 3 ? 2 : 1]], pos, dest: port().xz});
    const dest = port();
    return this.#spawnGroup({faction: 'league', list: [['drover', 1 + Math.floor(r() * 1.6)], ...(r() < 0.4 ? [['barracuda', 1]] : [])], pos, dest: dest.xz, arrive: dest.radius + 500});
  }
  /** A Pennant (or other) squadron of the given threat 1..6. boss: {name, vessel} leads it. */
  spawnSquadron({faction, threat, pos, dest = pos, tag = null, boss = null}) {
    const list = SQUADRONS[clamp(threat, 1, 6)].map(pair => [...pair]);
    if (boss) { if (boss.vessel) list[0][0] = boss.vessel; else if (VESSELS[list[0][0]].kind === 'craft') list.unshift(['barracuda', 1]); }
    const ships = this.#spawnGroup({faction, list, pos, dest, tag});
    if (boss) { const lead = ships[0]; lead.name = boss.name; lead.boss = true; lead.maxHp = lead.hp = Math.round(lead.hp * 1.4); lead.bounty *= 2; lead.skill = Math.min(0.95, lead.skill + 0.15); }
    return ships;
  }
  #spawnGroup({faction, list, pos, dest, arrive, tag = null}) {
    const group = ++this.groupId, out = [], r = this.rng, heading = Math.atan2(-(dest[0] - pos[0]), -(dest[1] - pos[1])) || 0;
    let leader = null, n = 0;
    for (const [cls, count] of list) for (let i = 0; i < count; i++, n++) {
      const def = VESSELS[cls], row = Math.ceil(n / 2), offset = [(n % 2 ? 1 : -1) * (60 + def.radius * 2) * row, 0, 70 * row];
      const ai = {group, leader, dest: [...dest], arrive, offset, target: null, attacker: null, scanT: r(), sense: def.kind === 'craft' ? 2400 : 3000, breakT: 0, breakDir: [1, 0], deflectT: 0, anchor: [...dest]};
      const ship = this.#makeShip({cls, kind: def.kind, name: def.kind === 'craft' ? def.name : captainName(r), faction, pos: [pos[0] + offset[0], pos[1] + offset[2]], heading,
        hp: def.hp, shield: def.shield, cannons: def.cannons ?? 0, turrets: def.turrets ?? 0, battery: def.battery ?? null, turret: def.turret ?? null, speed: def.speed, accel: def.accel, turn: def.turn,
        radius: def.radius, gun: def.gun ?? null, skill: 0.45 + r() * 0.2, ai, bounty: def.bounty, deflector: def.cannons >= 5 ? DEFLECTORS[1] : null});
      if (leader === null) leader = ship.id;
      ai.leader = leader; ship.throttle = 0.7;
      if (tag) { ship.tag = tag; if (!tag.endsWith(':ward')) { ship.provoked = true; ai.sense = 4200; } }
      out.push(ship);
    }
    return out;
  }
  /** Called by the AI when a travelling ship reaches its destination. */
  npcArrived(ship) {
    const ai = ship.ai, r = this.rng;
    if (ship.kind === 'hauler' && !ship.tag) { ship.gone = true; return; }
    if (ship.faction === 'watch') { const ports = this.sector.stations; ai.dest = [...ports[Math.floor(r() * ports.length)].xz]; ai.arrive = 900; }
    else ai.dest = [ai.anchor[0] + (r() - 0.5) * 2600, ai.anchor[1] + (r() - 0.5) * 2600];
  }
}
