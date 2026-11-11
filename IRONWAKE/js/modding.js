// SPDX-License-Identifier: Apache-2.0
import {mods, activateRegistry, validModState} from './mod-api.js';
import {packs} from '../mods/registry.js';
import * as D from './sim/data.js';
export {mods, packs};
const require = (ok, message) => { if (!ok) throw new TypeError(`Mod data: ${message}`); };
const point = (p, n) => Array.isArray(p) && p.length === n && p.every(v => Number.isFinite(v) && Math.abs(v) <= 1000000);
const integer = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const has = (catalog, id) => typeof id === 'string' && Object.hasOwn(catalog, id);
export const catalogs = {hulls: D.HULLS, vessels: D.VESSELS, batteries: D.BROADSIDES, turrets: D.TURRETS, upgrades: D.UPGRADES, goods: D.GOODS, factions: D.FACTIONS, ports: D.STATIONS, sector: D.SECTOR};
export function validateMission(m, custom) {
  require(has(D.STATIONS, m.at) && has(D.FACTIONS, m.giver), 'mission needs valid at and giver');
  require(typeof m.title === 'string' && typeof m.done === 'string' && integer(m.reward, 0, 10000000), 'invalid saved mission reward/text');
  require(m.wanted === undefined && m.kind !== 'wanted', 'mod board jobs cannot change the original wanted counter');
  if (m.kind === 'delivery') require(has(D.STATIONS, m.dest) && integer(m.cargo, 1, 100000), 'invalid delivery destination/cargo');
  else {
    require(custom || ['bounty', 'defend'].includes(m.kind), 'unknown mission kind');
    require(point(m.pos, 2), 'pos must be [x,z]');
    if (!custom) {
      require(integer(m.threat, 1, 6), 'invalid threat');
      if (m.kind === 'bounty') require(typeof m.boss === 'string' && (!m.vessel || has(D.VESSELS, m.vessel)), 'invalid bounty boss/vessel');
    }
  }
}
export const adapter = {game: 'ironwake', catalogs, validateMission, validate};

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
