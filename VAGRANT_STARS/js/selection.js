// SPDX-License-Identifier: Apache-2.0
/** Select a visible hostile's projected hull, with a small mouse-friendly margin.
 * Stable tie-break: nearest centre, then nearest depth. Empty space preserves selection.
 * Uses rendered poses, including IRONWAKE strike-craft bob, not a different simulation pose. */
export function pickEnemy(world, scene, poses, x, y, width, height) {
  let best = null, score = Infinity, depth = Infinity;
  for (const {ship, attitude} of world.contacts()) {
    if (attitude !== 'hostile' || !ship.alive || ship.gone) continue;
    const pos = poses.get(ship.id)?.pos ?? ship.body.position;
    const p = scene.project(pos, width, height);
    if (!p || p.x < 0 || p.x > width || p.y < 0 || p.y > height) continue;
    const radius = Math.max(16, ship.radius * height / (2 * Math.tan(Math.PI / 5.2) * p.w));
    const d = Math.hypot(p.x - x, p.y - y);
    if (d > radius + 8) continue;
    if (d < score || (d === score && p.w < depth)) { best = ship; score = d; depth = p.w; }
  }
  return best;
}
