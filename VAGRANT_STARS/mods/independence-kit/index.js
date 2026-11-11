// SPDX-License-Identifier: Apache-2.0
// Copy this folder, change the id, then add its import to ../registry.js.
import {makeModes} from './modes.js';
import {hazardFreeApproach} from '../../js/sim/hazards.js';
const iron = false, home = 'calder', giver = 'halcyon', parent = 'sparrow';
const safe = (w, pos) => hazardFreeApproach(w.system, w.playerShip.body.position, pos, 850) && !w.sector.grid.query(pos, 850).some(s => !s.dead);

export default {
  api: 1, id: 'independence-kit', version: '1.0.0', title: 'Independence Kit',
  description: 'A working mod: Liberty hull and mesh, a new sound, freight and survey jobs, exploration and combat modes.',
  modes: makeModes(iron, safe),
  install(api) {
    api.extend('hulls', 'liberty', parent, {name: 'Liberty', price: 1800, level: 1, blurb: 'Built in a shed. Owned by its captain. A survey vessel you can reshape.', hp: iron ? 1250 : 500, radius: iron ? 27 : 10});
    const port = api.catalogs.ports[home]; (iron ? port.yard : port.ships).push('liberty');
    // New geometry built from boxes. Copy hardpoints from the parent so weapons and engines align.
    api.assets.ship('liberty', ({Builder, base}) => {
      const old = base(parent), b = new Builder(), scale = iron ? 1.7 : 1;
      b.box([0, 0, 0], [5 * scale, 3 * scale, 12 * scale], [0.12, 0.48, 0.56]);
      for (const side of [-1, 1]) b.box([side * 4 * scale, 0, 2 * scale], [2 * scale, 2 * scale, 8 * scale], [0.85, 0.67, 0.25]);
      b.box([0, 1.7 * scale, -2 * scale], [2 * scale, 0.6 * scale, 3 * scale], [0.3, 0.9, 1], 0.6);
      return b.build(iron ? {ports: old.ports, mounts: old.mounts, engines: old.engines} : {muzzles: old.muzzles, engines: old.engines});
    });
    // Existing event names can be replaced; new names can be used by weapons or custom app code.
    api.assets.sound('dock', [[['triangle', 330, 660, 180, 4000, 6], ['triangle', 880, 880, 220, 2500]]]);
    const kind = api.missions.type('survey', {
      validate(m) { return Number.isFinite(m.scanSeconds) && m.scanSeconds >= 1 && m.scanSeconds <= 60 && Number.isFinite(m.scanned ?? 0) && (m.scanned ?? 0) >= 0 && (m.scanned ?? 0) <= m.scanSeconds; },
      objective(p, m) { return `Survey beacon · hold within 250u · ${Math.floor(m.scanned ?? 0)}/${m.scanSeconds}s`; },
      step(w, dt, m) {
        if (!iron && w.system.id !== m.system) return;
        const p = w.playerShip.body.position, target = iron ? [m.pos[0], 0, m.pos[1]] : m.waypoint;
        const near = Math.hypot(...p.map((v, i) => v - target[i])) <= 250;
        m.scanned = near ? Math.min(m.scanSeconds, (m.scanned ?? 0) + dt) : 0;
        if (m.scanned >= m.scanSeconds) return 'complete';
      },
    });
    api.missions.add({id: 'first-survey', kind, at: home, giver, title: 'Independent cartographers: first survey',
      text: 'Reach the marked beacon and remain within 250u for eight seconds. Leaving the area resets the scan. This is a custom mission type implemented in the pack.',
      done: 'Your survey is now part of an open star chart. Payment wired.', reward: 1500, scanSeconds: 8,
      ...(iron ? {pos: [2200, -1800]} : {system: 'meridian', waypoint: [10000, 0, 2500]})});
    api.missions.add({id: 'open-freight', kind: iron ? 'delivery' : 'courier', at: home, giver, repeatable: true,
      title: 'Open hardware delivery', text: 'Take four crates of workshop tools to the destination port. Uses the original freight rules.',
      done: 'The dockside workshop is open for business.', cargo: 4, reward: 2200,
      ...(iron ? {dest: 'tinder'} : {system: 'meridian', base: 'tollard'})});
  },
};
