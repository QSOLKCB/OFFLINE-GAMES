// SPDX-License-Identifier: Apache-2.0
// Free-roam signals are separate from contracts. All clocks use simulation time.
import {rotate, seededRandom} from '../../vendor/vanillajs/modules/math/index.js';
import {hazardFreeApproach} from './hazards.js';

export const AMBIENT_LIMIT = 18, ENCOUNTER_RESERVE = 4;
const FORMATION_CLEARANCE = 650;
export const ARCS = {
  flight: ['Raiders on the trade lane', 'Mayday from a stranded freighter', 'Reaver flight leader'],
};
const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));

// OPT-REDUCE-001: nearest-only queries need neither contact objects nor sorting.
// Retain the first ship on equal distance, exactly like the stable contacts sort.
export function nearestHostile(world, range) {
  let best = null, bestD = range;
  for (const ship of world.ships) {
    if (ship.isPlayer || !ship.alive) continue;
    const d = world.distance(ship, world.playerShip);
    if (d < bestD && world.attitude(ship) === 'hostile') { best = ship; bestD = d; }
  }
  return best;
}

/** Bounded work: one scan every half-second; at most one announced encounter. */
export class EncounterDirector {
  constructor(world) {
    this.world = world; this.active = null; this.wait = 8; this.scan = 0;
    this.rng = seededRandom((world.player.seed ^ (world.player.patrols ?? 0) ^ 0x79ab36d1) >>> 0);
    this.status = 'Listening for distress calls';
  }
  get titles() { return ARCS.flight; }
  get stage() { return (this.world.player.patrols ?? 0) % 3; }
  waypoint() {
    const e = this.active;
    return e ? {pos: e.pos, label: e.title} : null;
  }
  objective() {
    const e = this.active, done = this.world.player.patrols ?? 0;
    if (!e) return `Free roam · ${done} signals cleared · ${this.status}`;
    const left = e.enemies?.filter(s => s.alive).length;
    return `${e.title} · ${e.enemies ? `${left} hostiles${e.wards.length ? ' · protect the freighter' : ''}` : 'contact inbound'} · ${Math.ceil(e.ttl)}s`;
  }
  // Place a fixed beacon ahead, outside port approaches and collision geometry.
  // Failed placements defer; never insert a formation inside a rock or station.
  #beacon() {
    const w = this.world, me = w.playerShip, forward = rotate(me.body.orientation, [0, 0, -1]);
    const ports = w.sector.pois.filter(p => p.type === 'base');
    const start = Math.atan2(forward[2], forward[0]) + (this.rng() - 0.5) * 0.6;
    for (let i = 0; i < 16; i++) {
      const a = start + i * Math.PI / 8, r = 1800 + Math.floor(i / 8) * 700;
      const pos = [me.body.position[0] + Math.cos(a) * r, me.body.position[1], me.body.position[2] + Math.sin(a) * r];
      if (ports.some(p => distance(pos, p.pos) < p.radius + 1500)) continue;
      // Planets and stellar heat are not in the static collision grid. Sweep the
      // formation along the approach too: a safe endpoint can be across a planet.
      if (!hazardFreeApproach(w.system, me.body.position, pos, FORMATION_CLEARANCE)) continue;
      if (w.sector.grid.query(pos, FORMATION_CLEARANCE).some(s => !s.dead)) continue;
      return pos;
    }
    return null;
  }
  step(dt) {
    const w = this.world, me = w.playerShip;
    if (w.over || w.docked) return;
    if (!w.traffic || w.player.mission) { if (this.active) this.#finish(false, 'Signal released to local patrols.'); return; }
    const travelling = me.lane || w.jump || me.cruise.state !== 'off';
    if (this.active) {
      const e = this.active; e.ttl -= dt;
      if (distance(me.body.position, e.pos) > 7000 || e.ttl <= 0) return this.#finish(false, 'Signal lost. Resume course; another call will follow.');
      if (!e.enemies) {
        if (travelling) return this.#finish(false, 'Passing signal handed to local patrols.');
        e.warning -= dt;
        if (e.warning > 0) return;
        const ships = w.ships.filter(s => s.alive && !s.gone && !s.isPlayer).length;
        if (ships > AMBIENT_LIMIT) return;
        Object.assign(e, w.startEncounter(e.stage, e.pos));
        for (const s of [...e.enemies, ...e.wards]) s.encounter = true;
        w.note(`${e.title}. ${e.wards.length ? 'Keep the freighter alive. ' : ''}Clear the attackers for ${e.reward} cr.`, 'warn');
      }
      if (e.wards.some(s => !s.alive || s.gone)) return this.#finish(false, 'The freighter was lost. No rescue payment.');
      if (e.enemies.some(s => s.gone)) return this.#finish(false, 'Attackers escaped. Signal closed.');
      if (e.enemies.every(s => !s.alive)) {
        const involved = e.enemies.some(s => s.encounterHit);
        return this.#finish(involved, involved ? 'Signal cleared.' : 'Local patrols cleared the signal.');
      }
      return;
    }
    if (travelling) return;
    this.wait = Math.max(0, this.wait - dt); this.scan -= dt;
    if (this.wait > 0 || this.scan > 0) return;
    this.scan = 0.5;
    if (me.hp < me.maxHp * 0.35) { this.status = 'Hull critical — repair or return to port'; return; }
    let hostiles = 0, population = 0;
    for (const s of w.ships) if (!s.isPlayer && s.alive && !s.gone) {
      population++;
      if (w.distance(s, me) < 2200 && w.hostile(s, me)) hostiles++;
    }
    if (hostiles > 2 || population > AMBIENT_LIMIT) { this.status = 'Local combat — clear the area'; return; }
    const pos = this.#beacon();
    if (!pos) { this.status = 'Leave the port or hazard approach to find signals'; return; }
    this.active = {stage: this.stage, title: this.titles[this.stage], pos, warning: 6, ttl: 240, enemies: null, wards: [], reward: 0};
    w.say('Reach traffic control', `${this.active.title}. Beacon marked; contacts arriving in six seconds.`, 'warn');
  }
  #finish(success, message) {
    const w = this.world, e = this.active;
    if (success) {
      w.player.credits += e.reward; w.player.stats.earned += e.reward; w.player.patrols = (w.player.patrols ?? 0) + 1;
      w.events.push({type: 'encounterDone', reward: e.reward});
      message += ` +${e.reward} cr. ${this.stage === 0 ? 'Trade route secured. A new patrol circuit will follow.' : `Next signal: ${this.titles[this.stage]}.`}`;
    }
    // Keep visible survivors in the world; release their reservation for ordinary cleanup.
    for (const s of [...(e.enemies ?? []), ...e.wards]) { s.encounter = false; s.encounterWard = false; }
    this.active = null; this.wait = success ? 45 : 35;
    this.status = success ? 'Route quiet — collect salvage and refit' : 'Listening for the next signal';
    w.note(message, success ? 'good' : 'comm');
  }
}
