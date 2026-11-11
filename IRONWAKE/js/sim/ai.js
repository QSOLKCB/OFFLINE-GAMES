// SPDX-License-Identifier: Apache-2.0
// NPC captains. Warships manoeuvre to bring a broadside to bear; skates make strafing runs.
import {leadIntercept} from '../../vendor/vanillajs/modules/lead-solver/index.js';
import {clamp} from '../../vendor/vanillajs/modules/math/index.js';
import {FACTIONS} from './data.js';

const HALF_PI = Math.PI / 2;
const TAUNTS = {
  pennant: ['Strike your colours and we may leave you the lifeboats.', 'Run out the guns! That hold is ours.', 'No Watch out here, captain. Only us.'],
  watch: ['Harbor Watch! Heave to or be fired upon!', 'You were warned. All batteries, fire as you bear.'],
  league: ['League escort engaging! Keep off our convoy!'],
};

export function thinkNpc(world, ship, dt) {
  const ai = ship.ai, ctl = {rudder: 0, boost: false, deflect: false, volley: null, craftFire: false};
  if (ship.encounterWard) { ship.throttle = 0; return ctl; } // disabled relief ship; turrets still defend it
  ai.scanT -= dt;
  if (ai.scanT <= 0) { ai.scanT = 0.5 + (ship.id % 7) * 0.03; acquire(world, ship); }
  let target = ai.target ? world.shipById(ai.target) : null;
  if (target && (!target.alive || world.distance(ship, target) > 5200 || !world.hostile(ship, target))) { target = null; ai.target = null; }
  if (target && ship.kind !== 'hauler') {
    if (!ai.engaged) {
      ai.engaged = true;
      if (target.isPlayer && ship.kind === 'capital' && !ai.taunted && world.rng() < 0.7) {
        const lines = TAUNTS[ship.faction]; world.say(`${FACTIONS[ship.faction].short} ${ship.name}`, lines[Math.floor(world.rng() * lines.length)], 'warn');
        for (const mate of world.ships) if (mate.ai?.group === ai.group) mate.ai.taunted = true;
      }
    }
    return ship.kind === 'craft' ? strafe(world, ship, target, ctl, dt) : duel(world, ship, target, ctl, dt);
  }
  ai.engaged = false;
  // Travel in loose formation behind the group leader, or toward the destination.
  const leader = ai.leader !== ship.id ? world.shipById(ai.leader) : null;
  let point = ai.dest, slot = false;
  if (leader?.alive && !leader.ai.engaged) { point = world.localPoint(leader, ai.offset); slot = true; }
  const me = ship.body.position, dx = point[0] - me[0], dz = point[1] - me[2], d = Math.hypot(dx, dz);
  if (!slot && d < (ai.arrive ?? 400)) { world.npcArrived(ship); return ctl; }
  ctl.rudder = clamp(world.bearingTo(ship, world.avoid(ship, [dx / (d || 1), dz / (d || 1)])) * 2.2, -1, 1);
  ship.throttle = slot ? (d > 300 ? 1 : d > 80 ? 0.7 : 0.4) : ship.kind === 'craft' ? 0.6 : 0.8;
  ctl.boost = ship.kind === 'hauler' && ship.sinceHit < 6;
  return ctl;
}

function acquire(world, ship) {
  const ai = ship.ai;
  if (ship.kind === 'hauler') return;
  const current = ai.target ? world.shipById(ai.target) : null;
  if (current?.alive && world.distance(ship, current) < 1200) return;
  let best = null, bestD = ai.sense;
  for (const other of world.ships) {
    if (other === ship || !other.alive || !world.hostile(ship, other)) continue;
    let d = world.distance(ship, other);
    if (other.id === ai.attacker) d *= 0.5;
    if (ai.prey && other.tag === ai.prey) d *= 0.6;                    // raiders go for the convoy
    if (ai.preyId === other.id) d *= 0.6;
    if (ship.kind === 'craft' ? other.kind === 'craft' : other.kind !== 'craft') d *= 0.8; // like fights like
    if (d < bestD) { bestD = d; best = other; }
  }
  if (best) ai.target = best.id;
}

/** Capital ship: close, then turn the nearer beam onto the target and fire as it bears. */
function duel(world, ship, target, ctl, dt) {
  const ai = ship.ai, gun = ship.battery?.def, range = gun ? gun.range : 600, d = world.distance(ship, target);
  const me = ship.body.position, to = target.body.position, bearing = world.bearingTo(ship, [(to[0] - me[0]) / (d || 1), (to[2] - me[2]) / (d || 1)]);
  if (d > range * 0.85) {
    const offset = (ship.id % 2 ? 0.35 : -0.35), dir = world.avoid(ship, rotate2([(to[0] - me[0]) / d, (to[2] - me[2]) / d], offset));
    ctl.rudder = clamp(world.bearingTo(ship, dir) * 2.2, -1, 1); ship.throttle = 1; ctl.boost = d > range * 2.2;
  } else {
    ctl.rudder = clamp((bearing >= 0 ? bearing - HALF_PI : bearing + HALF_PI) * 2.4, -1, 1);
    ship.throttle = d < range * 0.3 ? 1 : 0.55;
  }
  if (gun && d < range * 0.95 && Math.abs(Math.abs(bearing) - HALF_PI) < 0.6) {
    const side = bearing > 0 ? 'port' : 'star';
    if (world.batteryReady(ship, side)) {
      const s = leadIntercept({shooterPosition: me, targetPosition: to, targetVelocity: target.body.velocity, projectileSpeed: gun.speed, maxTime: 5});
      const dir = s ? [s.direction[0], s.direction[2]] : [(to[0] - me[0]) / d, (to[2] - me[2]) / d], l = Math.hypot(dir[0], dir[1]) || 1;
      ctl.volley = {side, dir: [dir[0] / l, dir[1] / l], cone: gun.cone + (1 - ship.skill) * 0.16};
    }
  }
  // Raise the deflector when a salvo lands, if it is charged.
  if (ship.deflect) {
    if (ai.deflectT > 0) { ai.deflectT -= dt; ctl.deflect = true; } else if (ship.sinceHit < 0.2 && ship.deflect.charge > 0.9 && world.rng() < 0.5) ai.deflectT = 1.6;
  }
  return ctl;
}

/** Skate: run in on the target's lead, fire when lined up, then break off and come around. */
function strafe(world, ship, target, ctl, dt) {
  const ai = ship.ai, me = ship.body.position, to = target.body.position, d = world.distance(ship, target);
  ship.throttle = 1;
  if (ai.breakT > 0) {
    ai.breakT -= dt; ctl.rudder = clamp(world.bearingTo(ship, world.avoid(ship, ai.breakDir)) * 2.2, -1, 1); ctl.boost = true;
    return ctl;
  }
  if (d < target.radius + 70) {
    const a = Math.atan2(me[2] - to[2], me[0] - to[0]) + (world.rng() - 0.5) * 2.2;
    ai.breakT = 1.6 + world.rng() * 1.2; ai.breakDir = [Math.cos(a), Math.sin(a)];
    return ctl;
  }
  const s = leadIntercept({shooterPosition: me, targetPosition: to, targetVelocity: target.body.velocity, projectileSpeed: ship.gun.speed, maxTime: 4});
  const dir = s ? normal2([s.direction[0], s.direction[2]]) : [(to[0] - me[0]) / d, (to[2] - me[2]) / d], bearing = world.bearingTo(ship, world.avoid(ship, dir));
  ctl.rudder = clamp(bearing * 2.6, -1, 1);
  ctl.craftFire = d < ship.gun.range && Math.abs(world.bearingTo(ship, dir)) < 0.13;
  return ctl;
}
const rotate2 = (v, a) => [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a)];
const normal2 = v => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };
