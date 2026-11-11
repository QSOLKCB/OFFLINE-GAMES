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
