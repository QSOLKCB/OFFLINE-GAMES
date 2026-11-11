// SPDX-License-Identifier: Apache-2.0
// A bounded free-roam arc, separate from port contracts and ordinary traffic.
import {seededRandom} from '../../vendor/vanillajs/modules/math/index.js';

export const AMBIENT_LIMIT = 18, ENCOUNTER_RESERVE = 4, MAX_AMBIENT_GROUP = 9;
export const PATROL_TITLES = ['Break the Pennant picket', 'League relief ship in distress', "Captain Redwake's challenge"];
export const FORMATION_RADIUS = 850;
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Reject an approach crossing a solid's X/Z box, expanded by hull clearance. */
function crossesBox(from, to, box, margin) {
  let lo = 0, hi = 1;
  for (const [axis, index] of [[0, 0], [1, 2]]) {
    const d = to[axis] - from[axis], min = box.min[index] - margin, max = box.max[index] + margin;
    if (d === 0) { if (from[axis] < min || from[axis] > max) return false; }
    else {
      let a = (min - from[axis]) / d, b = (max - from[axis]) / d;
      if (a > b) [a, b] = [b, a];
      lo = Math.max(lo, a); hi = Math.min(hi, b);
      if (lo > hi) return false;
    }
  }
  return true;
}

export function clearSignalApproach(world, pos) {
  const w = world, me = w.playerShip, from = [me.body.position[0], me.body.position[2]], margin = me.radius + 80;
  if (w.sector.stations.some(s => distance(pos, s.xz) <= s.radius + 1100)) return false;
  if (w.sector.grid.query(pos[0], pos[1], FORMATION_RADIUS).length) return false;
  const mid = [(from[0] + pos[0]) / 2, (from[1] + pos[1]) / 2], reach = distance(from, pos) / 2 + margin;
  return !w.sector.grid.query(mid[0], mid[1], reach).some(s => crossesBox(from, pos, s.box, margin));
}

export class EncounterDirector {
  constructor(world) {
    this.world = world; this.active = null; this.wait = 10; this.scan = 0;
    this.rng = seededRandom((world.player.seed ^ (world.player.patrols ?? 0) ^ 0x63a2fb19) >>> 0);
    this.status = 'Listening to the shipping channel';
  }
  get stage() { return (this.world.player.patrols ?? 0) % PATROL_TITLES.length; }
  waypoint() { const e = this.active; return e ? {pos: e.pos, label: e.title, signal: true} : null; }
  objective() {
    const e = this.active;
    if (!e) return `${this.status} · ${this.world.player.patrols ?? 0} patrols resolved`;
    if (!e.enemies) return `${e.title} · contacts in ${Math.ceil(e.warning)}s · [V] plot signal`;
    const alive = e.enemies.filter(s => s.alive && !s.gone).length;
    const ward = e.wards[0];
    return `${e.title} · ${alive} hostiles${ward ? ` · relief hull ${Math.ceil(100 * ward.hp / ward.maxHp)}%` : ''} · ${e.reward} cr`;
  }
  #beacon() {
    const w = this.world, p = w.playerShip.body.position, q = w.playerShip.body.orientation;
    const heading = 2 * Math.atan2(q[1], q[3]);
    const start = -heading - Math.PI / 2 + (this.rng() - 0.5) * 0.7;
    for (let i = 0; i < 24; i++) {
      const a = start + i * Math.PI / 8, r = 1800 + Math.floor(i / 8) * 500;
      const pos = [p[0] + Math.cos(a) * r, p[2] + Math.sin(a) * r];
      if (clearSignalApproach(w, pos)) return pos;
    }
    return null;
  }
  step(dt) {
    const w = this.world, me = w.playerShip;
    if (w.over || w.docked) return;
    if (!w.traffic || w.player.mission) { if (this.active) this.#finish(false, 'The Watch has taken over this signal.'); return; }
    const p = [me.body.position[0], me.body.position[2]];
    if (this.active) {
      const e = this.active; e.ttl -= dt;
      if (e.ttl <= 0 || distance(p, e.pos) > 7000) return this.#finish(false, 'Signal lost. The next call will follow after regrouping.');
      if (!e.enemies) {
        if (me.warp.state !== 'off' && w.dest !== 'signal') return this.#finish(false, 'Passing signal handed to the Watch.');
        e.warning -= dt;
        if (e.warning > 0 || w.ships.filter(s => !s.isPlayer && s.alive && !s.gone).length > AMBIENT_LIMIT) return;
        Object.assign(e, w.startEncounter(e.stage, e.pos));
        for (const s of [...e.enemies, ...e.wards]) s.encounter = true;
        w.say(e.wards.length ? 'League relief ship' : 'Harbor Watch', e.wards.length ? 'Engines disabled! Keep those gunboats off us, captain.' : e.stage === 2 ? 'Redwake is bringing a full broadside. Turn a fresh shield toward her guns.' : 'Pennant picket on the plot. Bring your broadside to bear!', 'warn');
      }
      if (e.wards.some(s => !s.alive || s.gone || s.byPlayer)) return this.#finish(false, 'Relief operation failed. The League will not pay.');
      if (e.enemies.some(s => s.gone)) return this.#finish(false, 'The Pennant ships escaped. Signal closed.');
      if (e.enemies.every(s => !s.alive)) {
        const involved = e.enemies.some(s => s.encounterHit);
        this.#finish(involved, involved ? 'Shipping lane secured.' : 'The Watch cleared the signal.');
      }
      return;
    }
    if (me.warp.state !== 'off') return;
    this.wait = Math.max(0, this.wait - dt); this.scan -= dt;
    if (this.wait > 0 || this.scan > 0) return;
    this.scan = 0.5;
    if (me.hp < me.maxHp * 0.4) { this.status = 'Hull critical — return to port for repairs'; return; }
    if (w.ships.filter(s => !s.isPlayer && s.alive && !s.gone).length > AMBIENT_LIMIT || w.nearestHostile(2400)) { this.status = 'Local combat — clear the area'; return; }
    const pos = this.#beacon();
    if (!pos) { this.status = 'Leave the port or debris field to receive signals'; return; }
    this.active = {stage: this.stage, title: PATROL_TITLES[this.stage], pos, warning: 7, ttl: 300, enemies: null, wards: [], reward: 0};
    w.say('Shipping channel', `${this.active.title}. Beacon marked; contacts arriving in seven seconds. V plots the signal.`, 'warn');
  }
  #finish(success, message) {
    const w = this.world, e = this.active;
    if (success) {
      w.player.credits += e.reward; w.player.stats.earned += e.reward; w.player.patrols = (w.player.patrols ?? 0) + 1;
      w.events.push({type: 'encounterDone', reward: e.reward});
      message += ` +${e.reward} cr. Next: ${PATROL_TITLES[this.stage]}.`;
    }
    for (const s of [...(e.enemies ?? []), ...e.wards]) { s.encounter = false; s.encounterWard = false; }
    this.active = null;
    if (w.dest === 'signal') w.dest = null;
    this.wait = success ? 55 : 40; this.status = success ? 'Lane secure — recover shields and salvage' : 'Regrouping on the shipping channel';
    w.note(message, success ? 'good' : 'comm');
  }
}
