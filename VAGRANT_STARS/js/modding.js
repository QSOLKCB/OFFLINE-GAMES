// SPDX-License-Identifier: Apache-2.0
import {mods, activateRegistry, validModState} from './mod-api.js';
import {packs} from '../mods/registry.js';
import * as D from './sim/data.js';
export {mods, packs};
const require = (ok, message) => { if (!ok) throw new TypeError(`Mod data: ${message}`); };
const point = (p, n) => Array.isArray(p) && p.length === n && p.every(v => Number.isFinite(v) && Math.abs(v) <= 1000000);
const integer = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const has = (catalog, id) => typeof id === 'string' && Object.hasOwn(catalog, id);
import {hazardFreeApproach} from './sim/hazards.js';
export const catalogs = {hulls: D.HULLS, guns: D.GUNS, launchers: D.LAUNCHERS, shields: D.SHIELDS, goods: D.GOODS, factions: D.FACTIONS, ports: D.BASES, systems: D.SYSTEMS};
export function validateMission(m, custom) {
  require(has(D.BASES, m.at) && has(D.FACTIONS, m.giver) && has(D.SYSTEMS, m.system), 'mission needs valid at, giver and system');
  require(typeof m.title === 'string' && typeof m.done === 'string' && integer(m.reward, 0, 10000000), 'invalid saved mission reward/text');
  require(m.story === undefined, 'mod board jobs cannot change the original story counter');
  if (m.kind === 'courier') require(has(D.BASES, m.base) && D.BASES[m.base].system === m.system && integer(m.cargo, 1, 100000), 'invalid courier destination/cargo');
  else {
    require(custom || m.kind === 'bounty', 'unknown mission kind');
    require(point(m.waypoint, 3), 'waypoint must be [x,y,z]');
    const system = D.SYSTEMS[m.system], clearance = custom ? 100 : 1200;
    require(hazardFreeApproach(system, m.waypoint, m.waypoint, clearance), 'mission formation overlaps a planet or star');
    if (!custom) {
      require(has(D.FACTIONS, m.foe) && integer(m.count, 1, 12) && integer(m.tier, 1, 5), 'invalid bounty foe/count/tier');
      if (m.boss) require(has(D.HULLS, m.boss.hull) && has(D.GUNS, m.boss.gun) && has(D.SHIELDS, m.boss.shield) && typeof m.boss.name === 'string', 'invalid bounty boss');
    }
  }
}
export const adapter = {game: 'vagrant', catalogs, validateMission, validate};

function validate() {
  for (const [name, catalog] of Object.entries(catalogs)) {
    // World topology is source data; deep edits require the modder's own play tests.
    if (['systems', 'sector'].includes(name)) continue;
    require(validModState(catalog), `${name} must contain finite JSON data`);
  }
  for (const hull of Object.values(D.HULLS)) {
    for (const key of ['hp', 'speed', 'accel', 'turn', 'radius']) require(Number.isFinite(hull[key]) && hull[key] > 0, `hull ${key} must be positive`);
    require(integer(hull.cargo, 0, 100000) && integer(hull.level, 1, 100), 'invalid hull cargo/rank');
  }
}
export function activateMods(search = '') { return activateRegistry(packs, adapter, search); }
