// SPDX-License-Identifier: Apache-2.0
// Shared with the damage boundaries in World so advertised routes stay clear of hazards.
export const ATMOSPHERE_SCALE = 1.03, STELLAR_HEAT_SCALE = 1.7;

/** The straight approach, swept by the encounter's full formation radius, must be safe. */
export function hazardFreeApproach(system, from, to, clearance) {
  const delta = to.map((v, i) => v - from[i]);
  const length2 = delta.reduce((sum, v) => sum + v * v, 0);
  const clear = (body, scale) => {
    const projection = delta.reduce((sum, v, i) => sum + (body.pos[i] - from[i]) * v, 0);
    const t = length2 > 0 ? Math.max(0, Math.min(1, projection / length2)) : 0;
    const distance2 = from.reduce((sum, v, i) => sum + (v + t * delta[i] - body.pos[i]) ** 2, 0);
    return distance2 > (body.radius * scale + clearance) ** 2;
  };
  return clear(system.star, STELLAR_HEAT_SCALE) && system.planets.every(p => clear(p, ATMOSPHERE_SCALE));
}

/** Bounded, deterministic visibility route around the same volumes that deal damage.
 * Circumscribed 16-sided rings supply detours; every connecting chord is checked
 * against every body. Return null rather than advertise an unsafe route.
 */
export function hazardRoute(system, from, to, clearance = 650) {
  if (!hazardFreeApproach(system, from, from, clearance) || !hazardFreeApproach(system, to, to, clearance)) return null;
  if (hazardFreeApproach(system, from, to, clearance)) return [[...from], [...to]];
  const dot = (a, b) => a.reduce((n, v, i) => n + v * b[i], 0);
  const sub = (a, b) => a.map((v, i) => v - b[i]);
  const unit = a => { const n = Math.hypot(...a); return a.map(v => v / n); };
  const nodes = [[...from], [...to]];
  for (const [body, scale] of [[system.star, STELLAR_HEAT_SCALE], ...system.planets.map(p => [p, ATMOSPHERE_SCALE])]) {
    const u = unit(sub(from, body.pos)), toward = sub(to, body.pos), projection = dot(toward, u);
    let side = toward.map((v, i) => v - u[i] * projection);
    if (Math.hypot(...side) < 1e-6) {
      // A diametrical crossing has no preferred plane. Pick a stable perpendicular.
      const axis = u.map(Math.abs).indexOf(Math.min(...u.map(Math.abs)));
      side = u.map((v, i) => (i === axis ? 1 : 0) - v * u[axis]);
    }
    const v = unit(side), radius = (body.radius * scale + clearance + 1) / Math.cos(Math.PI / 16);
    for (let i = 0; i < 16; i++) {
      const angle = i * Math.PI / 8;
      const point = body.pos.map((c, j) => c + radius * (u[j] * Math.cos(angle) + v[j] * Math.sin(angle)));
      if (hazardFreeApproach(system, point, point, clearance)) nodes.push(point);
    }
  }
  const costs = nodes.map(() => Infinity), previous = nodes.map(() => -1), visited = new Set();
  costs[0] = 0;
  while (visited.size < nodes.length) {
    let best = -1;
    for (let i = 0; i < nodes.length; i++) if (!visited.has(i) && (best < 0 || costs[i] < costs[best])) best = i;
    if (best < 0 || !Number.isFinite(costs[best])) return null;
    if (best === 1) {
      const route = [];
      for (let i = 1; i !== -1; i = previous[i]) route.push(nodes[i]);
      return route.reverse();
    }
    visited.add(best);
    for (let i = 0; i < nodes.length; i++) {
      if (visited.has(i)) continue;
      const cost = costs[best] + Math.hypot(...sub(nodes[i], nodes[best]));
      if (cost < costs[i] && hazardFreeApproach(system, nodes[best], nodes[i], clearance)) {
        costs[i] = cost; previous[i] = best;
      }
    }
  }
  return null;
}
