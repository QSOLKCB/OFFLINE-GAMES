// SPDX-License-Identifier: Apache-2.0
// NPC pilots. Each tick an NPC produces the same control record the player does.
import {rotate, quatConjugate, normalize, clamp} from '../../vendor/vanillajs/modules/math/index.js';
import {leadIntercept} from '../../vendor/vanillajs/modules/lead-solver/index.js';
import {FACTIONS} from './data.js';
import {hasContraband, adjustRep} from './player.js';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = v => Math.hypot(v[0], v[1], v[2]);

const TAUNTS = {
  reavers: ['Cut your engines and dump the hold!', 'Fresh salvage, boys. Mind the cargo.', 'Nobody patrols this far out, captain.'],
  choir: ['You are a wrong note. We will correct it.', 'Be still. Be silent. Be ash.', 'The song has no verse for you.'],
  wardens: ['Concord Wardens! Power down and prepare to be boarded!', 'You were warned, captain. Weapons free.'],
  halcyon: ['Halcyon security, engaging hostile!'], ember: ['Syndic guns hot! Get off our claim!'], driftborn: ['You picked the wrong family, stranger.'],
};

/** Body-space pitch/yaw commands that swing the nose onto a world direction. */
export function steerToward(ship, dir) {
  const local = rotate(quatConjugate(ship.body.orientation), dir);
  if (local[2] > 0) return [clamp(local[1] * 2, -0.5, 0.5), local[0] > 0 ? -1 : 1];
  return [clamp(local[1] * 3.2, -1, 1), clamp(-local[0] * 3.2, -1, 1)];
}

export function thinkNpc(world, ship, dt) {
  const ai = ship.ai, body = ship.body, pos = body.position, ctl = {turn: [0, 0], strafe: 0, burn: false, brake: false, fire: false, aim: null, travel: false};
  ai.scanT -= dt;
  if (ai.scanT <= 0) { ai.scanT = 0.5 + (ship.id % 5) * 0.03; acquire(world, ship); }
  let target = ai.target ? world.shipById(ai.target) : null;
  if (target && (!target.alive || target.lane || world.distance(ship, target) > 4800 || !world.hostile(ship, target))) { target = null; ai.target = null; }

  if (ai.state === 'flee') {
    ai.fleeT -= dt;
    const from = world.shipById(ai.attacker);
    if (!from || !from.alive || ai.fleeT <= 0 || world.distance(ship, from) > 3600) ai.state = 'travel';
    else {
      const dir = world.avoid(ship, normalize(sub(pos, from.body.position)));
      ctl.turn = steerToward(ship, dir); ship.throttle = 1; ctl.burn = true;
      return ctl;
    }
  }
  if (target && ai.role !== 'trader') {
    if (ai.state !== 'attack') {
      ai.state = 'attack';
      if (target.isPlayer && !ai.taunted && world.rng() < 0.6) {
        const lines = TAUNTS[ship.faction];
        world.say(`${FACTIONS[ship.faction].short} ${ship.name}`, lines[Math.floor(world.rng() * lines.length)], 'warn');
        for (const mate of world.ships) if (mate.ai?.group === ai.group) mate.ai.taunted = true;
      }
    }
    return attack(world, ship, target, ctl, dt);
  }
  if (ai.state === 'attack') ai.state = 'travel';

  // Travel, formation keeping and loitering.
  const leader = ai.leader && ai.leader !== ship.id ? world.shipById(ai.leader) : null;
  let point = ai.dest, slot = false;
  if (leader && leader.alive && leader.ai.state !== 'attack') { point = world.toWorld(leader, ai.offset); slot = true; }
  const to = sub(point, pos), dist = len(to);
  if (!slot && dist < (ai.arrive ?? 320)) { world.npcArrived(ship); return ctl; }
  const dir = world.avoid(ship, dist > 1 ? [to[0] / dist, to[1] / dist, to[2] / dist] : rotate(body.orientation, [0, 0, -1]));
  ctl.turn = steerToward(ship, dir);
  ship.throttle = slot ? (dist > 260 ? 1 : dist > 60 ? 0.75 : 0.45) : 0.8;
  ctl.travel = !slot || dist > 260;
  if (ai.role === 'patrol' && FACTIONS[ship.faction].lawful) customs(world, ship, dt);
  return ctl;
}

function acquire(world, ship) {
  const ai = ship.ai;
  if (ai.role === 'trader') return;
  const current = ai.target ? world.shipById(ai.target) : null;
  if (current && current.alive && world.distance(ship, current) < 1400) return;
  let best = null, bestD = ai.sense;
  for (const other of world.ships) {
    if (other === ship || !other.alive || other.lane || !world.hostile(ship, other)) continue;
    const d = world.distance(ship, other) * (other.id === ai.attacker ? 0.5 : 1);
    if (d < bestD) { bestD = d; best = other; }
  }
  if (best) ai.target = best.id;
}

function attack(world, ship, target, ctl, dt) {
  const ai = ship.ai, body = ship.body, pos = body.position, to = sub(target.body.position, pos), dist = len(to) || 1;
  const gun = ship.guns[0]?.def;
  const solution = gun ? leadIntercept({shooterPosition: pos, targetPosition: target.body.position, targetVelocity: target.body.velocity, projectileSpeed: gun.speed, maxTime: 4}) : null;
  const lead = solution?.direction ?? [to[0] / dist, to[1] / dist, to[2] / dist];
  if (ship.hp < ship.maxHp * 0.22 && !ai.brave) { ai.state = 'flee'; ai.fleeT = 14; ai.attacker = target.id; ai.target = null; return ctl; }
  if (ai.evadeT > 0) {
    ai.evadeT -= dt;
    ctl.turn = steerToward(ship, world.avoid(ship, ai.evadeDir)); ship.throttle = 1; ctl.burn = ai.evadeT > 0.6;
    return ctl;
  }
  if (dist < 90 + ship.radius + target.radius) {
    const r = world.rng, side = normalize([r() - 0.5, (r() - 0.5) * 0.8, r() - 0.5]);
    ai.evadeT = 1.3 + r() * 1.2;
    ai.evadeDir = normalize([side[0] - to[0] / dist * 0.35, side[1] - to[1] / dist * 0.35, side[2] - to[2] / dist * 0.35]);
    return ctl;
  }
  const aimAt = dist < 800 ? lead : [to[0] / dist, to[1] / dist, to[2] / dist];
  ctl.turn = steerToward(ship, world.avoid(ship, aimAt));
  ship.throttle = dist > 420 ? 1 : 0.6; ctl.burn = dist > 1100;
  if (dist < 650) ctl.strafe = Math.sin(world.time * 1.7 + ship.id * 2.1) * 0.8;
  if (gun && dist < gun.range * 0.95) {
    const forward = rotate(body.orientation, [0, 0, -1]), align = forward[0] * lead[0] + forward[1] * lead[1] + forward[2] * lead[2];
    if (align > 0.992 && (world.time + ship.id * 0.37) % 2.4 < 1.5) { // fire in bursts
      const spread = (1 - ship.skill) * 0.07, r = world.rng;
      ctl.fire = true; ctl.converge = dist;
      ctl.aim = normalize([lead[0] + (r() - 0.5) * spread, lead[1] + (r() - 0.5) * spread, lead[2] + (r() - 0.5) * spread]);
    }
    if (ship.launcher && ship.ammo > 0 && ship.launcher.cd <= 0 && dist > 260 && dist < 950 && align > 0.95 && world.rng() < dt * 0.5) world.launchMissile(ship, target);
  }
  return ctl;
}

/** Lawful patrols scan a nearby captain's hold and impound contraband. */
function customs(world, ship, dt) {
  const ai = ship.ai, player = world.playerShip, p = world.player;
  if (!player || !player.alive || player.lane || world.hostile(ship, player) || !hasContraband(p) || world.distance(ship, player) > 650) { ai.customsT = 0; return; }
  if (!ai.customsT) world.say(`Warden ${ship.name}`, 'Hold your course, captain. Scanning your manifest.', 'warn');
  ai.customsT = (ai.customsT ?? 0) + dt;
  if (ai.customsT < 6) return;
  let value = 0;
  for (const id of Object.keys(p.cargo)) if (world.goods[id].contraband) { value += world.goods[id].price * p.cargo[id]; delete p.cargo[id]; }
  const fine = Math.min(p.credits, Math.round(value * 0.4));
  p.credits -= fine; adjustRep(p, ship.faction, -0.05); ai.customsT = 0;
  world.say(`Warden ${ship.name}`, `Contraband impounded. You are fined ${fine} cr. Fly clean, captain.`, 'warn');
}
