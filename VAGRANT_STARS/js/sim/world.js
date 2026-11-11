// SPDX-License-Identifier: Apache-2.0
// The live star system: flight, combat, traffic, gates and slingways. Pure simulation.
// Built on VANILLAJS flight / collision / projectiles / lead-solver / interactions.
import {createBody, flightConfig, stepFlight} from '../../vendor/vanillajs/modules/flight/index.js';
import {rotate, quatConjugate, quatMultiply, quatInterpolate, normalize, clamp, seededRandom} from '../../vendor/vanillajs/modules/math/index.js';
import {ProjectileSystem} from '../../vendor/vanillajs/modules/projectiles/index.js';
import {leadIntercept} from '../../vendor/vanillajs/modules/lead-solver/index.js';
import {createInteractionResolver} from '../../vendor/vanillajs/modules/interactions/index.js';
import {FACTIONS, SYSTEMS, HULLS, GUNS, LAUNCHERS, SHIELDS, CONSUMABLES, GOODS, TIERS, HOSTILE_REP, REFUSE_REP, factionsAtWar, enemiesOf, pilotName, routeBetween} from './data.js';
import {shipModel, stationBoxes, STATION_RADIUS, scatterRocks} from './models.js';
import {cargoFree, adjustRep, levelOf} from './player.js';
import {completeMission, missionOnDock} from './missions.js';
import {EncounterDirector, AMBIENT_LIMIT, nearestHostile} from './encounters.js';
import {ATMOSPHERE_SCALE, STELLAR_HEAT_SCALE} from './hazards.js';
import {thinkNpc, steerToward} from './ai.js';

export const CRUISE_CHARGE = 3.5, BOOST_TIME = 5, BOOST_RECHARGE = 9, LANE_SPEED = 2600, SENSOR = 6000, JUMP_TIME = 1.7;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const addScaled = (a, b, k) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const len = v => Math.hypot(v[0], v[1], v[2]);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const hashText = text => { let h = 2166136261; for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619); return h >>> 0; };

/** Orientation whose nose (-Z) points along dir with wings level. */
export function lookQuat(dir) {
  const heading = Math.atan2(-dir[0], -dir[2]) / 2, elevation = Math.asin(clamp(dir[1], -1, 1)) / 2;
  return quatMultiply([0, Math.sin(heading), 0, Math.cos(heading)], [Math.sin(elevation), 0, 0, Math.cos(elevation)]);
}

// OPT-REDUCE-001: static colliders are bucketed once so each ship and volley only meets its neighbours.
class SolidGrid {
  constructor(cell = 600) { this.cell = cell; this.map = new Map(); this.stamp = 0; }
  #key(i, j, k) { return ((i + 512) * 1024 + (j + 512)) * 1024 + (k + 512); }
  add(solid) {
    const c = this.cell, lo = solid.box.min.map(v => Math.floor(v / c)), hi = solid.box.max.map(v => Math.floor(v / c));
    for (let i = lo[0]; i <= hi[0]; i++) for (let j = lo[1]; j <= hi[1]; j++) for (let k = lo[2]; k <= hi[2]; k++) {
      const key = this.#key(i, j, k);
      if (!this.map.has(key)) this.map.set(key, []);
      this.map.get(key).push(solid);
    }
  }
  query(pos, r, out = []) {
    const c = this.cell, stamp = ++this.stamp;
    for (let i = Math.floor((pos[0] - r) / c); i <= Math.floor((pos[0] + r) / c); i++)
      for (let j = Math.floor((pos[1] - r) / c); j <= Math.floor((pos[1] + r) / c); j++)
        for (let k = Math.floor((pos[2] - r) / c); k <= Math.floor((pos[2] + r) / c); k++) {
          const list = this.map.get(this.#key(i, j, k));
          if (list) for (const s of list) if (s.stamp !== stamp) { s.stamp = stamp; out.push(s); }
        }
    return out;
  }
}

function segmentDistance(p, a, b) {
  const ab = sub(b, a), t = clamp(dot3(sub(p, a), ab) / dot3(ab, ab), 0, 1);
  return dist(p, addScaled(a, ab, t));
}

/** Static content of one star system: points of interest, slingways, rocks and colliders. */
export function buildSector(system) {
  const pois = [], byId = new Map(), solids = [], grid = new SolidGrid();
  const solid = (centre, size) => {
    const h = size.map(v => v / 2), s = {id: 'x' + solids.length, box: {min: centre.map((v, i) => v - h[i]), max: centre.map((v, i) => v + h[i])}, centre, r: Math.hypot(...h), stamp: 0};
    solids.push(s); grid.add(s);
  };
  for (const def of system.bases) {
    const radius = STATION_RADIUS[def.kind];
    pois.push({id: def.id, type: 'base', name: def.name, pos: def.pos, radius, useRange: radius + 420, faction: def.faction, def});
    for (const b of stationBoxes(def.kind)) solid(b.c.map((v, i) => v + def.pos[i]), b.s);
  }
  for (const def of system.gates) {
    const inward = normalize([-def.pos[0], 0, -def.pos[2]]);
    pois.push({id: def.id, type: 'gate', name: def.name, pos: def.pos, radius: 200, useRange: 560, def, forward: inward, q: lookQuat(inward)});
  }
  for (const p of pois) byId.set(p.id, p);
  const lanes = system.lanes.map(([from, to], n) => {
    const a = byId.get(from), b = byId.get(to), d = normalize(sub(b.pos, a.pos));
    const start = addScaled(a.pos, d, a.radius + 520), end = addScaled(b.pos, d, -(b.radius + 520)), length = dist(start, end);
    const count = Math.max(2, Math.round(length / 2200) + 1), lane = {id: 'lane' + n, a: start, b: end, dir: d, length, from: a, to: b, q: lookQuat(d), rings: []};
    for (let i = 0; i < count; i++) {
      const s = length * i / (count - 1), end0 = i === 0, end1 = i === count - 1;
      const ring = {id: `${lane.id}:${i}`, type: 'ring', pos: addScaled(start, d, s), radius: 50, useRange: 340, lane, s, minor: !end0 && !end1,
        name: end0 ? `Slingway to ${b.name}` : end1 ? `Slingway to ${a.name}` : 'Slingway ring'};
      lane.rings.push(ring); pois.push(ring); byId.set(ring.id, ring);
    }
    return lane;
  });
  const rocks = [];
  for (const zone of system.zones) {
    if (zone.kind !== 'rocks') continue;
    for (const rock of scatterRocks(zone, hashText(system.id + zone.name))) {
      if (pois.some(p => p.type !== 'ring' && dist(p.pos, rock.pos) < p.radius + rock.radius + 300)) continue;
      if (lanes.some(l => segmentDistance(rock.pos, l.a, l.b) < rock.radius + 170)) continue;
      rocks.push(rock); const d = rock.radius * 1.44; solid(rock.pos, [d, d, d]);
    }
  }
  return {system, pois, byId, lanes, rocks, solids, grid};
}

const USE_RULES = [
  {id: 'dock', match: {source: 'pilot', target: 'base'}, effects: [{type: 'dock'}], reason: {code: 'dock', message: 'Docking clearance granted.'},
    requires: [{scope: 'target', key: 'hostile', equals: false, code: 'hostile', message: 'Docking refused. This port lists you as hostile.'},
      {scope: 'context', key: 'inRange', equals: true, code: 'range', message: 'Outside docking range.'}]},
  {id: 'jump', match: {source: 'pilot', target: 'gate'}, effects: [{type: 'jump'}], reason: {code: 'jump', message: 'Fold gate aligned. Jumping.'},
    requires: [{scope: 'context', key: 'inRange', equals: true, code: 'range', message: 'Outside gate range.'}]},
  {id: 'sling', match: {source: 'pilot', target: 'ring'}, effects: [{type: 'sling'}], reason: {code: 'sling', message: 'Slingway engaged.'},
    requires: [{scope: 'context', key: 'inRange', equals: true, code: 'range', message: 'Outside ring range.'}]},
];

export class World {
  /** traffic:false keeps ambient ships out (contract targets still appear); used by tests. */
  constructor(player, {seed = player.seed, traffic = true} = {}) {
    this.player = player; this.traffic = traffic; this.rng = seededRandom((seed ^ 0x51ed270b) >>> 0); this.goods = GOODS;
    this.time = 0; this.events = []; this.nextId = 1; this.rules = createInteractionResolver(USE_RULES); this.over = false;
    this.enterSystem(player.system, {base: player.base});
  }

  // Setup ------------------------------------------------------------------------------------
  enterSystem(systemId, {base = null, fromSystem = null} = {}) {
    const p = this.player;
    this.system = SYSTEMS[systemId]; this.sector = buildSector(this.system);
    this.ships = []; this.byId = new Map(); this.shots = new ProjectileSystem({capacity: 320}); this.bolts = new Map();
    this.missiles = []; this.loot = []; this.target = null; this.auto = null; this.jump = null; this.docked = null;
    this.encounters = new EncounterDirector(this);
    this.spawnT = 2; this.tractorT = 0; this.groupId = 0; this.hazardT = 0;
    p.system = systemId; p.visited[systemId] = true;
    if (p.mission) p.mission.spawned = false;
    let pos, forward, speed = 0;
    if (base) {
      const poi = this.sector.byId.get(base), away = normalize([-poi.pos[0], 0, -poi.pos[2]]);
      forward = away; pos = addScaled(poi.pos, away, poi.radius + 300); pos[1] += 40;
    } else {
      const gate = this.sector.pois.find(g => g.type === 'gate' && g.def.to === fromSystem) ?? this.sector.pois.find(g => g.type === 'gate');
      forward = gate.forward; pos = addScaled(gate.pos, forward, 460); speed = 70;
    }
    const hull = HULLS[p.hull];
    this.playerShip = this.#makeShip({hullId: p.hull, faction: 'player', name: 'You', guns: p.guns.filter(Boolean), shield: p.shield,
      launcher: p.launcher, ammo: p.ammo, pos, q: lookQuat(forward), isPlayer: true, skill: 1, tier: 0});
    this.playerShip.hp = clamp(p.hp, 1, hull.hp); this.playerShip.body.velocity = forward.map(v => v * speed); this.playerShip.throttle = speed ? 0.8 : 0;
    this.events.push({type: 'system', id: systemId});
    if (this.traffic) for (let i = 0; i < 2; i++) this.#spawnTraffic(1400 + this.rng() * 1600);
  }

  #makeShip({hullId, faction, name, guns, shield, launcher = null, ammo = 0, pos, q, isPlayer = false, skill = 0.5, tier = 1, ai = null}) {
    const hull = HULLS[hullId], sh = SHIELDS[shield];
    const base = {assisted: true, response: 2.2, angularAcceleration: hull.turn * 5, turnSpeed: hull.turn, angularResponse: 6, brake: 1.8};
    const ship = {
      id: this.nextId++, hullId, hull, faction, name, isPlayer, skill, tier, alive: true, radius: hull.radius,
      body: createBody({position: pos, orientation: q, halfSize: hull.radius * 0.6}),
      cfg: {
        normal: flightConfig({...base, acceleration: hull.accel, maxSpeed: hull.speed}),
        burn: flightConfig({...base, acceleration: hull.accel * 1.9, maxSpeed: hull.burn}),
        cruise: flightConfig({...base, acceleration: hull.accel * 2.4, maxSpeed: hull.cruise, turnSpeed: hull.turn * 0.55}),
        drift: flightConfig({...base, acceleration: hull.accel, maxSpeed: hull.cruise}),
      },
      maxHp: hull.hp, hp: hull.hp, maxShield: sh.cap, shield: sh.cap, shieldRegen: sh.regen, sinceHit: 99,
      maxEnergy: hull.energy, energy: hull.energy, energyRegen: hull.regen, boost: 1, burning: false,
      guns: guns.map(id => ({id, def: GUNS[id], cd: 0})), launcher: launcher ? {id: launcher, def: LAUNCHERS[launcher], cd: 0} : null, ammo,
      throttle: 0, cruise: {state: 'off', t: 0}, drift: false, lane: null, invuln: false, provoked: false, ai,
      prevPos: [...pos], prevQ: [...q], flash: 0, bank: 0,
    };
    this.ships.push(ship); this.byId.set(ship.id, ship);
    return ship;
  }

  // Queries ----------------------------------------------------------------------------------
  shipById(id) { return this.byId.get(id) ?? null; }
  distance(a, b) { return dist(a.body.position, b.body.position); }
  toWorld(ship, local) { const r = rotate(ship.body.orientation, local), p = ship.body.position; return [p[0] + r[0], p[1] + r[1], p[2] + r[2]]; }
  /** The orientation the hull is drawn with: flight attitude plus the cosmetic bank. */
  visualQuat(ship, q = ship.body.orientation) { return quatMultiply(q, [0, 0, Math.sin(ship.bank / 2), Math.cos(ship.bank / 2)]); }
  forward(ship) { return rotate(ship.body.orientation, [0, 0, -1]); }
  say(from, text, tone = 'comm') { this.events.push({type: 'msg', from, text, tone}); }
  note(text, tone = 'info') { this.events.push({type: 'msg', text, tone}); }

  /** Would `a` open fire on `b`? */
  hostile(a, b) {
    if (a === b || a.isPlayer) return false;
    if (b.isPlayer) return a.provoked || ((this.player.rep[a.faction] ?? 0) < HOSTILE_REP && a.ai.role !== 'trader');
    if (a.missionTag && b.missionTag) return false;
    return factionsAtWar(a.faction, b.faction);
  }
  attitude(ship) {
    if (this.hostile(ship, this.playerShip)) return 'hostile';
    return (this.player.rep[ship.faction] ?? 0) >= 0.3 ? 'friendly' : 'neutral';
  }
  baseHostile(poi) { return (this.player.rep[poi.faction] ?? 0) <= REFUSE_REP; }
  zoneAt(pos, kind) {
    for (const z of this.system.zones) if (z.kind === kind && dist(pos, z.pos) < z.radius) return z;
    return null;
  }
  /** Bend a desired heading away from nearby solids. */
  avoid(ship, dir) {
    const pos = ship.body.position, probe = addScaled(pos, dir, 140);
    const near = this.sector.grid.query(probe, 240);
    if (!near.length) return dir;
    let out = dir;
    for (const s of near) {
      const to = sub(s.centre, pos), ahead = dot3(to, dir);
      if (ahead < -s.r || ahead > 320 + s.r) continue;
      const lat = addScaled(to, dir, -ahead), d = len(lat), clear = s.r + ship.radius + 34;
      if (d >= clear) continue;
      const k = (clear - d) / clear * 2.2, away = d > 1 ? lat.map(v => -v / d) : [0, 1, 0];
      out = addScaled(out, away, k);
    }
    return out === dir ? dir : normalize(out);
  }
  targetObject() {
    const t = this.target;
    if (!t) return null;
    if (t.kind === 'signal') { const e = this.encounters.active; return e ? {id: 'signal', type: 'signal', name: e.title, pos: e.pos, radius: 50, useRange: 400} : null; }
    if (t.kind === 'ship') { const s = this.byId.get(t.id); return s && s.alive ? s : null; }
    return this.sector.byId.get(t.id) ?? null;
  }
  targetPos() {
    const o = this.targetObject();
    return o ? (o.body ? o.body.position : o.pos) : null;
  }
  /** Where to aim so the player's bolts meet a moving ship. */
  leadFor(ship) {
    const me = this.playerShip, gun = me.guns[0]?.def;
    if (!gun) return null;
    return leadIntercept({shooterPosition: me.body.position, targetPosition: ship.body.position, targetVelocity: ship.body.velocity,
      projectileSpeed: gun.speed, maxTime: 3})?.interceptPoint ?? null;
  }
  /** The marker the active contract points at inside this system. */
  waypoint() {
    const m = this.player.mission;
    if (!m) return this.encounters.waypoint();
    if (m.system === this.system.id) {
      if (m.kind === 'bounty') return {pos: m.waypoint, label: 'Contract target'};
      const poi = this.sector.byId.get(m.base);
      return {pos: poi.pos, label: poi.name, poi};
    }
    const route = routeBetween(this.system.id, m.system), gate = this.sector.pois.find(g => g.type === 'gate' && g.def.to === route[0]);
    return {pos: gate.pos, label: gate.name, poi: gate};
  }
  contacts() {
    const me = this.playerShip.body.position, out = [];
    for (const s of this.ships) if (!s.isPlayer && s.alive) { const d = dist(me, s.body.position); if (d < SENSOR) out.push({ship: s, dist: d, attitude: this.attitude(s)}); }
    return out.sort((a, b) => a.dist - b.dist);
  }

  // Player verbs -----------------------------------------------------------------------------
  targetShip(filter) {
    const list = this.contacts().filter(filter ?? (() => true));
    if (!list.length) { this.target = null; return null; }
    const at = this.target?.kind === 'ship' ? list.findIndex(c => c.ship.id === this.target.id) : -1;
    const next = list[(at + 1) % list.length].ship;
    this.target = {kind: 'ship', id: next.id};
    return next;
  }
  targetNearestHostile() {
    const hostile = nearestHostile(this, SENSOR);
    this.target = hostile ? {kind: 'ship', id: hostile.id} : this.target;
    if (!hostile) this.note('No hostiles on scope.');
    return hostile;
  }
  targetSignal() {
    if (!this.encounters.active) return this.note('No active free-roam signal. Watch the traffic-control channel.');
    this.target = {kind: 'signal', id: 'signal'};
    this.note('Signal selected. Press F to approach, or steer toward the purple beacon.');
  }
  targetPoi(id) { if (this.sector.byId.has(id)) this.target = {kind: 'poi', id}; }
  /** Select the ship or place nearest to a view ray (the cursor). */
  targetAlong(origin, dir) {
    let best = null, bestScore = 0.994;
    const consider = (pos, target, bias) => {
      const to = sub(pos, origin), d = len(to);
      if (d < 1) return;
      const score = dot3(to, dir) / d + bias;
      if (score > bestScore) { bestScore = score; best = target; }
    };
    for (const s of this.ships) if (!s.isPlayer && s.alive) consider(s.body.position, {kind: 'ship', id: s.id}, 0.002);
    for (const p of this.sector.pois) if (!p.minor) consider(p.pos, {kind: 'poi', id: p.id}, 0);
    if (best) this.target = best;
    return best;
  }
  cyclePoi() {
    const me = this.playerShip.body.position, list = this.sector.pois.filter(p => !p.minor).sort((a, b) => dist(me, a.pos) - dist(me, b.pos));
    const at = this.target?.kind === 'poi' ? list.findIndex(p => p.id === this.target.id) : -1;
    this.target = {kind: 'poi', id: list[(at + 1) % list.length].id};
  }
  toggleCruise() {
    const s = this.playerShip;
    if (s.lane || this.jump || this.over) return;
    if (s.cruise.state === 'off') { s.cruise = {state: 'charging', t: 0}; s.drift = false; this.events.push({type: 'cruise', state: 'charging'}); }
    else this.#dropCruise(s);
  }
  #dropCruise(ship) {
    if (ship.cruise.state === 'off') return;
    ship.cruise = {state: 'off', t: 0};
    if (ship.isPlayer) this.events.push({type: 'cruise', state: 'off'});
  }
  toggleDrift() {
    const s = this.playerShip;
    if (s.lane || this.over) return;
    s.drift = !s.drift; this.#dropCruise(s);
    this.note(s.drift ? 'Engines cut. Drifting.' : 'Engines re-lit.');
  }
  useKit() {
    const p = this.player, s = this.playerShip;
    if (this.over) return;
    if (p.kits < 1) return this.note('No hull patches aboard.', 'warn');
    if (s.hp >= s.maxHp) return this.note('Hull is intact.');
    p.kits--; s.hp = Math.min(s.maxHp, s.hp + s.maxHp * CONSUMABLES.kit.restore);
    this.events.push({type: 'repair'}); this.note(`Hull patch applied. ${p.kits} left.`, 'good');
  }
  useCell() {
    const p = this.player, s = this.playerShip;
    if (this.over) return;
    if (p.cells < 1) return this.note('No shield cells aboard.', 'warn');
    if (s.shield >= s.maxShield) return this.note('Shields are full.');
    p.cells--; s.shield = Math.min(s.maxShield, s.shield + s.maxShield * CONSUMABLES.cell.restore);
    this.events.push({type: 'repair'}); this.note(`Shield cell discharged. ${p.cells} left.`, 'good');
  }
  tractor() { this.tractorT = 5; this.events.push({type: 'tractor'}); if (!this.loot.length) this.note('Tractor beam: nothing in range.'); }
  goTo() {
    if (this.over) return;
    const o = this.targetObject();
    if (!o) return this.note('Select a target first (T, R, N or the map).');
    this.auto = {mode: 'goto', target: {...this.target}};
    this.note(`Autopilot: flying to ${o.name}.`);
  }
  stopAuto(quiet = false) { if (this.auto && !quiet) this.note('Autopilot off.'); this.auto = null; }

  /** Dock, jump or ride: act on the targeted place, or the nearest usable one. */
  use() {
    if (this.over || this.docked || this.jump) return;
    const ship = this.playerShip, me = ship.body.position;
    if (ship.lane) {
      const selected = this.targetObject();
      this.#exitLane(ship, true);
      // An explicit station/gate order survives leaving the lane.
      if (!selected || selected.body || selected.type === 'ring') return;
    }
    if (this.target?.kind === 'signal') return this.goTo();
    let poi = this.target?.kind === 'poi' ? this.sector.byId.get(this.target.id) : null;
    if (!poi) {
      const dockable = this.sector.pois.filter(p => p.type === 'base' && dist(me, p.pos) <= p.useRange);
      poi = (dockable.length ? dockable : this.sector.pois.filter(p => dist(me, p.pos) < p.useRange + 1800)).sort((a, b) => dist(me, a.pos) - a.useRange - dist(me, b.pos) + b.useRange)[0] ?? null;
      if (!poi) return this.note('Nothing to dock with nearby. Select a station, gate or ring.');
      this.target = {kind: 'poi', id: poi.id};
    }
    const result = this.rules.evaluate({source: {kind: 'pilot'}, target: {kind: poi.type, hostile: poi.type === 'base' && this.baseHostile(poi)},
      context: {inRange: dist(me, poi.pos) <= poi.useRange}});
    if (result.status === 'blocked') {
      const codes = result.reasons.map(r => r.code);
      if (codes.includes('hostile')) return this.note(result.reasons.find(r => r.code === 'hostile').message, 'warn');
      this.auto = {mode: 'use', target: {kind: 'poi', id: poi.id}};
      return this.note(`Autopilot: approaching ${poi.name}.`);
    }
    this.auto = null;
    for (const effect of result.effects) {
      if (effect.type === 'dock') this.#dock(poi);
      else if (effect.type === 'jump') { this.jump = {to: poi.def.to, t: 0, gate: poi}; ship.invuln = true; this.#dropCruise(ship); this.events.push({type: 'jumpStart', to: poi.def.to}); }
      else if (effect.type === 'sling') this.#enterLane(ship, poi);
    }
  }
  syncPlayer() {
    const p = this.player, s = this.playerShip;
    p.hp = Math.max(1, Math.ceil(s.hp)); p.ammo = s.ammo;
  }
  #dock(poi) {
    const p = this.player;
    this.syncPlayer(); p.base = poi.id; p.board++; this.docked = poi.id;
    this.events.push({type: 'dock', base: poi.id, result: missionOnDock(p, poi.id)});
  }
  launch() { if (this.over) return; this.enterSystem(this.player.system, {base: this.player.base}); this.events.push({type: 'launch'}); }

  #enterLane(ship, ring) {
    const lane = ring.lane, last = lane.rings.length - 1, index = lane.rings.indexOf(ring);
    const dir = index === 0 ? 1 : index === last ? -1 : (dot3(this.forward(ship), lane.dir) >= 0 ? 1 : -1);
    ship.lane = {lane, dir, s: ring.s, v: Math.max(180, len(ship.body.velocity))};
    this.#dropCruise(ship); ship.drift = false;
    this.events.push({type: 'laneEnter'}); this.note(`Slingway engaged: ${dir > 0 ? lane.to.name : lane.from.name}.`);
  }
  #exitLane(ship, early = false) {
    const {lane, dir} = ship.lane, d = lane.dir.map(v => v * dir);
    ship.body.velocity = d.map(v => v * (early ? 200 : 140)); ship.body.angularVelocity = [0, 0, 0];
    ship.throttle = 0.6; ship.lane = null;
    this.events.push({type: 'laneExit'});
    if (early) this.note('Slingway released.');
    else if (ship.isPlayer) {
      const selected = this.targetObject();
      // The boarding ring is stale after arrival: F should approach the destination,
      // not turn around and board that same lane again. Preserve other explicit targets.
      if (!selected || selected.type === 'ring' && selected.lane === lane) {
        const destination = dir > 0 ? lane.to : lane.from;
        this.target = {kind: 'poi', id: destination.id};
        this.note(`Arrived off ${destination.name}. Press F to approach and ${destination.type === 'base' ? 'dock' : 'jump'}.`, 'good');
      }
    }
  }

  launchMissile(ship, target) {
    const l = ship.launcher;
    if (!l || ship.ammo < 1 || l.cd > 0 || !target?.alive) return false;
    ship.ammo--; l.cd = l.def.cooldown;
    const dir = this.forward(ship);
    this.missiles.push({id: this.nextId++, pos: addScaled(ship.body.position, dir, ship.radius + 3), dir, speed: l.def.speed, target: target.id, owner: ship.id,
      life: l.def.life, def: l.def});
    this.events.push({type: 'missile', pos: [...ship.body.position], mine: ship.isPlayer});
    if (target.isPlayer) this.note('Missile inbound!', 'warn');
    return true;
  }

  // Simulation -------------------------------------------------------------------------------
  /** cmd: {turn:[pitch,yaw], throttle:-1..1, strafe, burn, brake, fire, missile, aim:[x,y,z]|null} */
  step(dt, cmd = {}) {
    if (this.over || this.docked) return;
    this.time += dt; this.player.time += dt;
    const me = this.playerShip;
    if (this.jump) return this.#stepJump(dt);
    for (const s of this.ships) { s.prevPos = [...s.body.position]; s.prevQ = [...s.body.orientation]; }

    // Player controls.
    const control = {turn: [clamp(cmd.turn?.[0] ?? 0, -1, 1), clamp(cmd.turn?.[1] ?? 0, -1, 1)], strafe: cmd.strafe ?? 0, burn: !!cmd.burn, brake: !!cmd.brake,
      fire: !!cmd.fire, aim: cmd.aim ?? null};
    if (cmd.throttle) { me.throttle = clamp(me.throttle + cmd.throttle * dt * 0.9, 0, 1); if (cmd.throttle < 0) this.#dropCruise(me); }
    if (this.auto && (cmd.throttle || cmd.brake)) this.stopAuto();
    if (this.auto) this.#autopilot(control);
    if (control.fire && me.cruise.state === 'charging') this.#dropCruise(me);
    if (control.brake) this.#dropCruise(me);
    const target = this.targetObject();
    if (control.fire) {
      control.converge = 420;
      if (target?.body) {
        // Gunnery assist: a cursor held close to the lead marker snaps the guns onto it.
        const lead = this.leadFor(target) ?? target.body.position, to = sub(lead, me.body.position), d = len(to) || 1, dir = to.map(v => v / d);
        control.converge = clamp(d, 120, 900);
        if (control.aim && d < 1000 && dot3(control.aim, dir) > 0.9962) control.aim = dir;
      }
    }
    this.#control(me, control, dt);
    if (cmd.missile && this.target?.kind === 'ship' && target) {
      if (!me.launcher) this.note('No missile rack fitted.', 'warn');
      else if (me.ammo < 1) this.note('Missile rack empty.', 'warn');
      else this.launchMissile(me, target);
    }

    // NPCs.
    for (const s of this.ships) {
      if (s.isPlayer || !s.alive) continue;
      const ctl = thinkNpc(this, s, dt);
      if (s.alive && !s.gone) this.#control(s, ctl, dt);
    }

    this.#stepShots(dt);
    this.#stepMissiles(dt);
    this.#stepLoot(dt);
    this.#stepMission();
    this.#hazards(dt);
    this.encounters.step(dt);
    this.#spawner(dt);
    if (this.ships.some(s => !s.alive || s.gone)) {
      for (const s of this.ships) if (!s.alive || s.gone) this.byId.delete(s.id);
      this.ships = this.ships.filter(s => s.alive && !s.gone);
    }
    if (this.target && !this.targetObject()) this.target = null;
  }

  #control(ship, c, dt) {
    const body = ship.body;
    ship.sinceHit += dt; ship.flash = Math.max(0, ship.flash - dt);
    ship.energy = Math.min(ship.maxEnergy, ship.energy + ship.energyRegen * dt);
    if (ship.sinceHit > 4 && ship.shield < ship.maxShield) ship.shield = Math.min(ship.maxShield, ship.shield + ship.shieldRegen * dt);
    for (const g of ship.guns) g.cd -= dt;
    if (ship.launcher) ship.launcher.cd -= dt;
    if (ship.lane) {
      if (!c.brake) return this.#stepLane(ship, dt);
      this.#exitLane(ship, true); // braking releases the slingway, then flies on as normal
    }
    if (ship.cruise.state === 'charging') {
      ship.cruise.t += dt;
      if (ship.cruise.t >= CRUISE_CHARGE) { ship.cruise.state = 'on'; if (ship.isPlayer) this.events.push({type: 'cruise', state: 'on'}); }
    }
    let cfg = ship.cfg.normal, thrust;
    const strafe = clamp(c.strafe || 0, -1, 1);
    ship.burning = false;
    if (ship.cruise.state === 'on') { cfg = ship.cfg.cruise; thrust = [0, 0, -1]; }
    else if (ship.drift) {
      cfg = ship.cfg.drift;
      thrust = rotate(quatConjugate(body.orientation), body.velocity).map(v => clamp(v / cfg.maxSpeed, -1, 1));
    } else if (c.travel) { cfg = ship.cfg.burn; thrust = [0, 0, -ship.throttle]; }
    else if (c.burn && ship.boost > 0.02) { cfg = ship.cfg.burn; thrust = [strafe * 0.4, 0, -1]; ship.boost -= dt / BOOST_TIME; ship.burning = true; }
    else thrust = [strafe * 0.55, 0, -ship.throttle];
    if (!ship.burning) ship.boost = Math.min(1, ship.boost + dt / BOOST_RECHARGE);
    // Flight keeps the wings level so turns stay in the system plane; the visible bank is cosmetic.
    const roll = clamp(-Math.asin(clamp(rotate(body.orientation, [1, 0, 0])[1], -1, 1)) * 2.6, -1, 1);
    ship.bank += (clamp(body.angularVelocity[1] * 0.42, -0.7, 0.7) - ship.bank) * Math.min(1, dt * 6);
    const speed = len(body.velocity), near = this.sector.grid.query(body.position, 70 + speed * dt);
    const result = stepFlight(body, {thrust, turn: [c.turn[0], c.turn[1], roll], brake: c.brake}, dt, cfg, near.length ? near.map(s => s.box) : []);
    if (result.contacts.length) {
      const lost = speed - len(body.velocity);
      if (lost > 18) { this.#dropCruise(ship); this.damage(ship, (lost - 18) * 1.1, (lost - 18) * 1.6, null); if (ship.isPlayer) this.events.push({type: 'bump'}); }
    }
    if (c.fire && ship.alive && ship.cruise.state !== 'on') this.#fire(ship, c.aim, c.converge ?? 420);
  }

  #fire(ship, aim, converge) {
    const body = ship.body, forward = this.forward(ship), muzzles = shipModel(ship.hullId).muzzles;
    let dir = aim ?? forward;
    const align = dot3(dir, forward);
    if (align < 0.86) { // keep fire inside the gimbal cone
      const side = normalize(addScaled(dir, forward, -align));
      dir = normalize(addScaled(forward.map(v => v * 0.86), side, 0.51));
    }
    const point = addScaled(body.position, dir, converge), visual = this.visualQuat(ship);
    let fired = null;
    ship.guns.forEach((gun, i) => {
      if (gun.cd > 0 || ship.energy < gun.def.en) return;
      const offset = rotate(visual, muzzles[i % muzzles.length]), muzzle = [body.position[0] + offset[0], body.position[1] + offset[1], body.position[2] + offset[2]], d = normalize(sub(point, muzzle));
      const velocity = d.map(v => v * gun.def.speed), life = gun.def.range / gun.def.speed;
      const shot = this.shots.spawn({position: muzzle, velocity, lifetime: life, halfSize: 0.7, ignoreIds: ['s' + ship.id], data: {o: ship.id, g: gun.id}});
      if (!shot.accepted) return;
      ship.energy -= gun.def.en; gun.cd = 1 / gun.def.rate;
      this.bolts.set(shot.id, {id: shot.id, pos: muzzle, vel: velocity, t0: this.time, color: gun.def.color, heavy: gun.def.dmg > 40});
      fired = gun.def;
    });
    if (fired) this.events.push({type: 'shot', sfx: fired.sfx, pos: [...body.position], mine: ship.isPlayer});
  }

  #stepShots(dt) {
    if (!this.shots.size) return;
    const colliders = [];
    for (const s of this.ships) {
      if (!s.alive) continue;
      const h = s.radius * 0.72, p = s.prevPos;
      colliders.push({id: 's' + s.id, box: {min: [p[0] - h, p[1] - h, p[2] - h], max: [p[0] + h, p[1] + h, p[2] + h]}, displacement: sub(s.body.position, p)});
    }
    for (const s of this.sector.grid.query(this.playerShip.body.position, 900)) colliders.push({id: s.id, box: s.box});
    for (const e of this.shots.stepMoving(dt, colliders)) {
      const bolt = this.bolts.get(e.projectileId);
      this.bolts.delete(e.projectileId);
      if (e.type !== 'hit') continue;
      if (e.hit.id[0] !== 's') { this.events.push({type: 'spark', pos: e.hit.point}); continue; }
      const victim = this.byId.get(Number(e.hit.id.slice(1))), owner = this.byId.get(e.data.o), gun = GUNS[e.data.g];
      if (!victim || !victim.alive) continue;
      this.events.push({type: 'hit', pos: e.hit.point, shield: victim.shield > 0, color: bolt?.color ?? [1, 1, 1], onPlayer: victim.isPlayer});
      if (owner && !owner.isPlayer && !victim.isPlayer && owner.faction === victim.faction) continue;
      const k = owner?.isPlayer ? 1 : victim.isPlayer ? 0.45 : 0.8;
      this.damage(victim, gun.dmg * k, gun.sh * k, owner ?? null);
    }
  }

  damage(victim, hullDamage, shieldDamage, source) {
    if (!victim.alive || victim.invuln) return;
    victim.sinceHit = 0; victim.flash = 0.25;
    if (victim.shield > 0) {
      victim.shield -= shieldDamage;
      if (victim.shield <= 0) { victim.hp += victim.shield * (hullDamage / Math.max(1, shieldDamage)); victim.shield = 0; if (victim.isPlayer) this.note('Shields down!', 'warn'); }
    } else victim.hp -= hullDamage;
    if (source?.isPlayer && victim.encounter) victim.encounterHit = true;
    if (source) {
      victim.lastHitBy = source.id;
      if (victim.ai) { victim.ai.attacker = source.id; if (victim.ai.role === 'trader' && victim.ai.state !== 'flee') { victim.ai.state = 'flee'; victim.ai.fleeT = 16; } }
      if (source.isPlayer && !victim.isPlayer) this.#provoke(victim);
    }
    if (victim.isPlayer) this.events.push({type: 'playerHit', shield: victim.shield > 0});
    if (victim.hp <= 0) this.#destroy(victim, source);
  }
  #provoke(victim) {
    if (this.hostile(victim, this.playerShip)) return;
    adjustRep(this.player, victim.faction, -0.05);
    for (const s of this.ships) if (!s.isPlayer && s.faction === victim.faction && this.distance(s, victim) < 3000) s.provoked = true;
    if (victim.ai.role === 'trader') this.say(`${FACTIONS[victim.faction].short} ${victim.name}`, 'Mayday! We are under attack!', 'warn');
  }
  #destroy(victim, source) {
    victim.alive = false; victim.hp = 0;
    const pos = [...victim.body.position], p = this.player;
    this.events.push({type: 'explode', pos, size: victim.radius, vel: [...victim.body.velocity]});
    if (victim.isPlayer) { this.over = true; p.stats.losses++; this.events.push({type: 'playerDead'}); return; }
    const byPlayer = source?.isPlayer || victim.lastHitBy === this.playerShip.id;
    if (byPlayer) {
      p.stats.kills++;
      adjustRep(p, victim.faction, -0.08);
      for (const foe of enemiesOf(victim.faction)) adjustRep(p, foe, 0.02);
      if (FACTIONS[victim.faction].outlaw && p.rep.wardens > HOSTILE_REP) {
        const bounty = 120 + 130 * victim.tier;
        p.credits += bounty; p.stats.earned += bounty;
        this.note(`${FACTIONS[victim.faction].short} ${victim.name} destroyed. Warden bounty: ${bounty} cr.`, 'good');
      } else this.note(`${FACTIONS[victim.faction].short} ${victim.name} destroyed.`);
    }
    const m = p.mission;
    if (m && victim.missionTag === m.id) { m.kills++; if (victim.boss) m.bossDead = true; }
    if (this.distance(victim, this.playerShip) < 3500) this.#dropLoot(victim, pos);
  }
  #dropLoot(victim, pos) {
    const r = this.rng, table = victim.ai?.role === 'trader' ? ['provisions', 'alloys', 'machinery', 'fuel', 'textiles', 'medgel']
      : victim.faction === 'choir' ? ['relics', 'optics', 'cores', 'relics'] : victim.faction === 'reavers' ? ['glint', 'rawore', 'alloys', 'fuel']
        : ['fuel', 'alloys', 'provisions'];
    const count = victim.boss ? 4 : 1 + Math.floor(r() * 2.4);
    for (let i = 0; i < count; i++) {
      const roll = r(), vel = [(r() - 0.5) * 24, (r() - 0.5) * 24, (r() - 0.5) * 24];
      const item = roll < 0.12 ? {kind: 'kit', qty: 1} : roll < 0.24 ? {kind: 'cell', qty: 1} : roll < 0.32 ? {kind: 'ammo', qty: 2}
        : {kind: 'good', good: table[Math.floor(r() * table.length)], qty: 1 + Math.floor(r() * (victim.ai?.role === 'trader' ? 7 : 3) * (victim.boss ? 2 : 1))};
      this.loot.push({id: this.nextId++, pos: addScaled(pos, vel, 0.3), vel, life: 150, ...item});
    }
  }

  #stepMissiles(dt) {
    for (const m of this.missiles) {
      const target = this.byId.get(m.target);
      m.life -= dt;
      if (target?.alive) {
        const to = sub(addScaled(target.body.position, target.body.velocity, Math.min(1.5, dist(target.body.position, m.pos) / m.speed)), m.pos), d = len(to) || 1;
        const want = [to[0] / d, to[1] / d, to[2] / d], cos = clamp(dot3(m.dir, want), -1, 1), angle = Math.acos(cos);
        const k = angle > 1e-4 ? Math.min(1, m.def.turn * dt / angle) : 1;
        m.dir = normalize([m.dir[0] + (want[0] - m.dir[0]) * k, m.dir[1] + (want[1] - m.dir[1]) * k, m.dir[2] + (want[2] - m.dir[2]) * k]);
      }
      m.pos = addScaled(m.pos, m.dir, m.speed * dt);
      const hit = target?.alive && dist(m.pos, target.body.position) < target.radius + 7;
      if (hit || m.life <= 0) {
        m.dead = true;
        this.events.push({type: 'explode', pos: [...m.pos], size: hit ? 3.5 : 1.5, vel: [0, 0, 0]});
        if (!hit) continue;
        const owner = this.byId.get(m.owner) ?? null;
        for (const s of [...this.ships]) {
          const d = dist(m.pos, s.body.position) - s.radius;
          if (!s.alive || d > m.def.blast || s.id === m.owner) continue;
          const k = (1 - clamp(d / m.def.blast, 0, 1) * 0.6) * (owner?.isPlayer ? 1 : 0.5);
          this.damage(s, m.def.dmg * k, m.def.dmg * 0.8 * k, owner);
        }
      }
    }
    if (this.missiles.some(m => m.dead)) this.missiles = this.missiles.filter(m => !m.dead);
  }

  #stepLoot(dt) {
    if (this.tractorT > 0) this.tractorT -= dt;
    if (!this.loot.length) return;
    const ship = this.playerShip, me = ship.body.position, p = this.player;
    for (const l of this.loot) {
      l.life -= dt;
      const d = dist(l.pos, me);
      if (this.tractorT > 0 && d < 520) {
        const pull = sub(me, l.pos).map(v => v / (d || 1) * (150 + len(ship.body.velocity)));
        l.vel = l.vel.map((v, i) => v + (pull[i] - v) * Math.min(1, dt * 4));
      } else l.vel = l.vel.map(v => v * Math.exp(-dt * 0.3));
      l.pos = addScaled(l.pos, l.vel, dt);
      if (d > ship.radius + 9) continue;
      if (l.kind === 'good') {
        const take = Math.min(l.qty, cargoFree(p));
        if (take < 1) { if (!l.warned) { l.warned = true; this.note('Cargo hold full.', 'warn'); } continue; }
        p.cargo[l.good] = (p.cargo[l.good] ?? 0) + take; l.life = 0;
        this.note(`Recovered ${take} ${GOODS[l.good].name}.`, 'good');
      } else if (l.kind === 'kit' || l.kind === 'cell') {
        const field = l.kind === 'kit' ? 'kits' : 'cells';
        if (p[field] < ship.hull.kits) { p[field]++; this.note(`Recovered a ${CONSUMABLES[l.kind].name}.`, 'good'); }
        l.life = 0;
      } else {
        if (ship.launcher && ship.ammo < ship.launcher.def.ammoMax) { ship.ammo = Math.min(ship.launcher.def.ammoMax, ship.ammo + l.qty); this.note('Recovered missiles.', 'good'); }
        l.life = 0;
      }
      this.events.push({type: 'pickup'});
    }
    if (this.loot.some(l => l.life <= 0)) this.loot = this.loot.filter(l => l.life > 0);
  }

  #stepLane(ship, dt) {
    const ride = ship.lane, {lane, dir} = ride, body = ship.body;
    ride.v = Math.min(LANE_SPEED, ride.v + 1100 * dt);
    ride.s += dir * ride.v * dt;
    const d = lane.dir.map(v => v * dir);
    body.position = addScaled(lane.a, lane.dir, clamp(ride.s, -160, lane.length + 160));
    body.velocity = d.map(v => v * ride.v); body.angularVelocity = [0, 0, 0];
    body.orientation = quatInterpolate(body.orientation, lookQuat(d), Math.min(1, dt * 5));
    if ((dir > 0 && ride.s >= lane.length + 150) || (dir < 0 && ride.s <= -150)) this.#exitLane(ship);
  }

  #stepJump(dt) {
    const ship = this.playerShip, j = this.jump, body = ship.body;
    ship.prevPos = [...body.position]; ship.prevQ = [...body.orientation];
    j.t += dt;
    const to = sub(j.gate.pos, body.position), d = len(to);
    const dir = d > 30 ? to.map(v => v / d) : this.forward(ship);
    body.orientation = quatInterpolate(body.orientation, lookQuat(dir), Math.min(1, dt * 6));
    body.velocity = dir.map(v => v * (120 + 700 * j.t)); body.position = addScaled(body.position, body.velocity, dt);
    if (j.t < JUMP_TIME) return;
    const from = this.system.id;
    this.syncPlayer(); this.player.stats.jumps++;
    this.enterSystem(j.to, {fromSystem: from});
    this.events.push({type: 'jumped', system: j.to});
    this.note(`Arrived in the ${this.system.name} system.`, 'good');
  }

  #autopilot(control) {
    const ship = this.playerShip, auto = this.auto, t = auto.target;
    const obj = t.kind === 'signal' ? this.encounters.active && {pos: this.encounters.active.pos, radius: 250} : t.kind === 'ship' ? this.byId.get(t.id) : this.sector.byId.get(t.id);
    if (!obj || (obj.body && !obj.alive)) return this.stopAuto();
    if (ship.lane) return;
    const pos = obj.body ? obj.body.position : obj.pos, to = sub(pos, ship.body.position), d = len(to);
    const stop = auto.mode === 'use' ? obj.useRange * 0.7 : (obj.radius ?? 10) + (obj.body ? 140 : 260);
    if (auto.mode === 'use' && d <= obj.useRange * 0.97) { this.auto = null; this.target = {...t}; this.use(); return; }
    if (auto.mode === 'goto' && d <= stop) { this.auto = null; ship.throttle = 0; this.#dropCruise(ship); this.note('Autopilot: arrived.', 'good'); return; }
    const dir = this.avoid(ship, to.map(v => v / d));
    control.turn = steerToward(ship, dir);
    const aligned = dot3(this.forward(ship), dir) > 0.97, speed = len(ship.body.velocity);
    if (d - stop > 2600 && aligned && ship.cruise.state === 'off') { ship.cruise = {state: 'charging', t: 0}; this.events.push({type: 'cruise', state: 'charging'}); }
    if (d - stop < 700 + speed * 2.4) this.#dropCruise(ship);
    ship.throttle = clamp((d - stop) / 400, auto.mode === 'use' ? 0.6 : 0.2, 1); ship.drift = false;
    control.brake = ship.cruise.state === 'off' && speed > ship.hull.speed * 1.25 && d - stop < 900;
  }

  #stepMission() {
    const p = this.player, m = p.mission, me = this.playerShip;
    if (!m || m.kind !== 'bounty' || m.system !== this.system.id) return;
    m.total ??= m.count + (m.boss ? 1 : 0);
    if (!m.spawned && dist(me.body.position, m.waypoint) < 3200) {
      m.spawned = true;
      const left = m.total - m.kills, boss = m.boss && !m.bossDead ? 1 : 0;
      const group = this.spawnGroup({faction: m.foe, role: 'raider', count: left - boss, tier: m.tier, pos: m.waypoint, dest: m.waypoint, tag: m.id});
      if (boss) {
        const s = this.#spawnNpc({faction: m.foe, role: 'raider', tier: Math.min(5, m.tier + 1), pos: addScaled(m.waypoint, [0, 60, 0], 1), dest: m.waypoint, group, hull: m.boss.hull, gun: m.boss.gun, shield: m.boss.shield, name: m.boss.name});
        s.boss = true; s.missionTag = m.id; s.provoked = true; s.ai.brave = true; s.maxHp *= 1.5; s.hp = s.maxHp;
      }
      this.note('Contract targets on scope.', 'warn');
    }
    if (m.kills >= m.total) this.events.push({type: 'missionDone', result: completeMission(p)});
  }

  #hazards(dt) {
    const ship = this.playerShip, pos = ship.body.position, star = this.system.star, d = dist(pos, star.pos);
    this.hazardT -= dt;
    if (d < star.radius * STELLAR_HEAT_SCALE) {
      this.damage(ship, 90 * dt * (STELLAR_HEAT_SCALE - d / star.radius) * 3, 140 * dt, null);
      if (this.hazardT <= 0) { this.hazardT = 4; this.note('Hull temperature critical. Pull away from the star!', 'warn'); }
    }
    for (const planet of this.system.planets) {
      const to = sub(pos, planet.pos), r = len(to);
      if (r > planet.radius * ATMOSPHERE_SCALE) continue;
      ship.body.position = addScaled(planet.pos, to.map(v => v / r), planet.radius * ATMOSPHERE_SCALE);
      this.#dropCruise(ship); if (ship.lane) this.#exitLane(ship, true);
      this.damage(ship, 160 * dt, 240 * dt, null);
      if (this.hazardT <= 0) { this.hazardT = 4; this.note('Atmospheric burn! Climb out!', 'warn'); }
    }
  }

  /** Free-roam pilot arc: dogfight, rescue, then a named ace and wingmen. */
  startEncounter(stage, pos) {
    const rank = Math.min(4, Math.floor((this.player.patrols ?? 0) / 3), Math.floor((levelOf(this.player) - 1) / 2));
    const tier = Math.min(5, 1 + rank + (this.system.danger >= 3 ? 1 : 0));
    const wards = [];
    if (stage === 1) {
      const group = this.spawnGroup({faction: 'halcyon', role: 'trader', count: 1, tier: 1, pos: [pos[0] + 420, pos[1], pos[2]], dest: pos});
      const ward = this.shipById(group.leader); ward.encounterWard = true; ward.name = 'Halcyon Relief Flight'; wards.push(ward);
    }
    const group = this.spawnGroup({faction: 'reavers', role: 'raider', count: stage === 0 ? 2 : 3, tier, pos, dest: [...this.playerShip.body.position]});
    const enemies = this.ships.filter(s => s.ai?.group === group.id);
    for (const s of enemies) { s.provoked = true; s.ai.sense = 3600; s.ai.brave = true; if (wards.length) s.ai.target = wards[0].id; }
    if (stage === 2) { const ace = enemies[0]; ace.name = 'Reaver Lane Reaper'; ace.boss = true; ace.hp = ace.maxHp = Math.round(ace.maxHp * 1.4); }
    return {enemies, wards, reward: (stage === 2 ? 1500 : stage === 1 ? 1000 : 600) * (rank + 1)};
  }

  // Traffic ----------------------------------------------------------------------------------
  #spawner(dt) {
    const me = this.playerShip;
    for (const s of this.ships) if (!s.isPlayer && !s.missionTag && !s.encounter && this.distance(s, me) > 8000) s.gone = true;
    this.spawnT -= dt;
    if (this.spawnT > 0) return;
    this.spawnT = 3.5 + this.rng() * 3.5;
    if (me.lane || !this.traffic) return;
    const ambient = this.ships.filter(s => s.ai && s.alive && !s.gone && !s.missionTag && !s.encounter);
    if (ambient.length >= AMBIENT_LIMIT - 5 || new Set(ambient.map(s => s.ai.group)).size >= 4) return;
    this.#spawnTraffic(2800 + this.rng() * 800);
  }
  #spawnTraffic(range) {
    const r = this.rng, me = this.playerShip.body.position, sys = this.system;
    // Outlaws keep clear of patrolled ports and gather in their lairs.
    const patrolled = this.sector.pois.some(p => p.type === 'base' && !FACTIONS[p.faction].outlaw && dist(me, p.pos) < 4800);
    const weights = Object.entries(sys.traffic).map(([f, w]) => [f, w * (sys.zones.some(z => z.lair === f && dist(me, z.pos) < z.radius) ? 4
      : FACTIONS[f].outlaw && patrolled ? (sys.danger < 3 ? 0.08 : 0.35) : 1)]);
    let roll = r() * weights.reduce((s, [, w]) => s + w, 0), faction = weights[0][0];
    for (const [f, w] of weights) { roll -= w; if (roll <= 0) { faction = f; break; } }
    const a = r() * Math.PI * 2, pos = [me[0] + Math.cos(a) * range, me[1] + (r() - 0.5) * 500, me[2] + Math.sin(a) * range];
    const places = this.sector.pois.filter(p => p.type !== 'ring'), place = () => places[Math.floor(r() * places.length)];
    const tierFor = bias => clamp(Math.round(sys.danger * 0.8 + bias + r() * 0.9 - 0.3), 1, 5);
    if (FACTIONS[faction].outlaw) {
      const count = sys.danger < 1.6 ? 1 + Math.floor(r() * 2) : 2 + Math.floor(r() * 2.4);
      return this.spawnGroup({faction, role: 'raider', count, tier: tierFor(-0.3), pos, dest: addScaled(me, [r() - 0.5, 0, r() - 0.5], 900)});
    }
    if (FACTIONS[faction].lawful) return this.spawnGroup({faction, role: 'patrol', count: 2 + Math.floor(r() * 1.6), tier: tierFor(0.6), pos, dest: place().pos});
    const dest = place();
    const group = this.spawnGroup({faction, role: 'trader', count: 1 + Math.floor(r() * 1.5), tier: tierFor(0), pos, dest: dest.pos, arrive: dest.radius + 330});
    if (r() < 0.25 + sys.danger * 0.12) this.#spawnNpc({faction, role: 'patrol', tier: tierFor(0.2), pos: addScaled(pos, [0, 70, 0], 1), dest: dest.pos, group, follow: true});
  }
  /** Place a formation of NPC ships. role: 'raider' | 'patrol' | 'trader'. Returns the group record. */
  spawnGroup({faction, role, count, tier, pos, dest = pos, arrive, tag = null}) {
    const group = {id: ++this.groupId, leader: null};
    for (let i = 0; i < count; i++) {
      const offset = i ? [(i % 2 ? 1 : -1) * 45 * Math.ceil(i / 2), 8 * i, 40 * Math.ceil(i / 2)] : [0, 0, 0];
      const s = this.#spawnNpc({faction, role, tier, pos: addScaled(pos, offset, 1), dest, group, arrive});
      if (tag) { s.missionTag = tag; s.provoked = true; s.ai.sense = 3400; s.ai.brave = true; }
    }
    return group;
  }
  #spawnNpc({faction, role, tier, pos, dest, group, arrive, follow = false, hull = null, gun = null, shield = null, name = null}) {
    const r = this.rng, t = TIERS[tier], trader = role === 'trader';
    const hullId = hull ?? (trader ? (tier >= 3 && r() < 0.5 ? 'caravel' : 'mule') : t.hull), gunId = gun ?? (trader ? TIERS[Math.max(1, tier - 1)].gun : t.gun);
    const count = Math.min(HULLS[hullId].guns, trader ? 2 : 2 + Math.floor(tier / 2));
    const to = normalize(sub(dest, pos).map((v, i) => v + (i === 1 ? 0 : 0.001)));
    const index = this.ships.filter(s => s.ai?.group === group.id).length;
    const ai = {role, state: 'travel', dest: [...dest], arrive, target: null, attacker: null, scanT: r(), evadeT: 0, evadeDir: [0, 1, 0], fleeT: 0,
      group: group.id, leader: group.leader, offset: [(index % 2 ? 1 : -1) * 42 * Math.ceil(index / 2), 6 * index, 46 * Math.ceil(index / 2)],
      sense: role === 'raider' ? 2400 : 2000, anchor: [...dest]};
    const s = this.#makeShip({hullId, faction, name: name ?? pilotName(r), guns: Array(count).fill(gunId), shield: shield ?? (trader ? TIERS[Math.max(1, tier - 1)].shield : t.shield),
      launcher: !trader && tier >= 3 && r() < 0.3 ? 'wasp' : null, ammo: 3, pos, q: lookQuat(to), skill: t.skill, tier, ai});
    s.maxHp = s.hp = Math.round(s.maxHp * 0.6); s.maxShield = s.shield = Math.round(s.maxShield * 0.6); // NPCs are frailer than captains
    if (group.leader === null && !follow) { group.leader = s.id; ai.leader = s.id; }
    s.throttle = 0.8; s.body.velocity = to.map(v => v * s.hull.speed * 0.6);
    return s;
  }
  /** Called by the AI when a travelling ship reaches its destination. */
  npcArrived(ship) {
    const ai = ship.ai, r = this.rng;
    if (ai.role === 'trader' && !ship.encounterWard) { ship.gone = true; return; }
    if (ai.role === 'patrol') {
      const places = this.sector.pois.filter(p => p.type !== 'ring');
      ai.dest = [...places[Math.floor(r() * places.length)].pos]; ai.arrive = 700;
    } else ai.dest = [ai.anchor[0] + (r() - 0.5) * 2400, ai.anchor[1] + (r() - 0.5) * 400, ai.anchor[2] + (r() - 0.5) * 2400];
  }
}
