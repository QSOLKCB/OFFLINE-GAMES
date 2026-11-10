// SPDX-License-Identifier: Apache-2.0
// Flight HUD and navigation map, drawn on a 2D canvas above the WebGL view.
import {FACTIONS, SYSTEMS, GOODS, routeBetween} from './sim/data.js';
import {cargoUsed, levelOf} from './sim/player.js';
import {missionObjective} from './sim/missions.js';
import {CRUISE_CHARGE} from './sim/world.js';

const C = {hostile: '#ff5a4a', neutral: '#d5e0ee', friendly: '#5fe08a', poi: '#7fc8ff', way: '#c58cff', loot: '#ffd24a', dim: 'rgba(160,190,220,.55)', panel: 'rgba(6,14,24,.62)', line: 'rgba(120,190,255,.5)'};
const FONT = '"Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';
export const fmtDist = d => (d < 1000 ? `${Math.round(d)} m` : `${(d / 1000).toFixed(d < 10000 ? 1 : 0)} km`);
export const fmtCr = n => `${Math.round(n).toLocaleString('en-US')} cr`;
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function bracket(ctx, x, y, r, color, width = 1.5) {
  const k = r * 0.45;
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath();
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { ctx.moveTo(x + sx * r, y + sy * (r - k)); ctx.lineTo(x + sx * r, y + sy * r); ctx.lineTo(x + sx * (r - k), y + sy * r); }
  ctx.stroke();
}
function diamond(ctx, x, y, r, color, fill = false) {
  ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath();
  if (fill) { ctx.fillStyle = color; ctx.fill(); } else { ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke(); }
}
function label(ctx, text, x, y, color, size = 11, align = 'center') {
  ctx.font = `${size}px ${FONT}`; ctx.textAlign = align; ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillText(text, x + 1, y + 1); ctx.fillStyle = color; ctx.fillText(text, x, y);
}
function bar(ctx, x, y, w, h, frac, color, title, value) {
  ctx.fillStyle = 'rgba(10,20,34,.7)'; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = color; ctx.fillRect(x, y, w * Math.max(0, Math.min(1, frac)), h);
  ctx.strokeStyle = 'rgba(150,200,255,.35)'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.font = `600 10px ${FONT}`; ctx.textAlign = 'left'; ctx.fillStyle = '#e8f1fb'; ctx.fillText(title, x + 5, y + h - 4);
  ctx.textAlign = 'right'; ctx.fillText(value, x + w - 5, y + h - 4);
}
/** Arrow on the screen edge pointing at something off-screen. */
function edgeArrow(ctx, w, h, p, behind, color) {
  let dx = p.x - w / 2, dy = p.y - h / 2;
  if (behind) { dx = -dx; dy = -dy; }
  const l = Math.hypot(dx, dy) || 1, m = 44, k = Math.min((w / 2 - m) / Math.abs(dx / l || 1e-6), (h / 2 - m) / Math.abs(dy / l || 1e-6));
  const x = w / 2 + dx / l * k, y = h / 2 + dy / l * k, a = Math.atan2(dy, dx);
  ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(-7, -7); ctx.lineTo(-3, 0); ctx.lineTo(-7, 7); ctx.closePath(); ctx.fill(); ctx.restore();
  return {x, y};
}
const onScreen = (p, w, h) => p && p.x > 0 && p.x < w && p.y > 0 && p.y < h;
function projectAny(scene, pos, w, h) {
  const p = scene.project(pos, w, h);
  if (p) return {p, behind: false};
  const c = scene.cam.pos, mirror = [2 * c[0] - pos[0], 2 * c[1] - pos[1], 2 * c[2] - pos[2]];
  return {p: scene.project(mirror, w, h) ?? {x: w / 2, y: h}, behind: true};
}

export function drawHud(ctx, w, h, world, scene, ui) {
  ctx.clearRect(0, 0, w, h);
  const p = world.player, me = world.playerShip, mePos = me.body.position, target = world.targetObject();
  ctx.textBaseline = 'alphabetic';

  // Places.
  for (const poi of world.sector.pois) {
    const selected = target === poi, d = dist3(mePos, poi.pos);
    if (poi.minor && !selected) continue;
    if (poi.type === 'ring' && !selected && d > 7000) continue;
    const s = scene.project(poi.pos, w, h);
    if (!onScreen(s, w, h)) continue;
    const color = poi.type === 'base' && world.baseHostile(poi) ? C.hostile : C.poi;
    diamond(ctx, s.x, s.y, selected ? 9 : 5, color);
    if (selected) bracket(ctx, s.x, s.y, 16, color, 2);
    if (poi.type !== 'ring' || selected || d < 3500) label(ctx, `${poi.name}  ${fmtDist(d)}`, s.x, s.y - 14, color, selected ? 12 : 11);
  }
  // Contract waypoint.
  const way = world.waypoint();
  if (way) {
    const {p: s, behind} = projectAny(scene, way.pos, w, h), d = dist3(mePos, way.pos);
    if (!behind && onScreen(s, w, h)) { diamond(ctx, s.x, s.y, 8, C.way, true); label(ctx, `${way.label}  ${fmtDist(d)}`, s.x, s.y + 24, C.way, 12); }
    else { const e = edgeArrow(ctx, w, h, s, behind, C.way); label(ctx, fmtDist(d), e.x, e.y + 22, C.way, 11); }
  }
  // Loot.
  for (const l of world.loot) { const s = scene.project(l.pos, w, h); if (onScreen(s, w, h)) { ctx.strokeStyle = C.loot; ctx.lineWidth = 1.5; ctx.strokeRect(s.x - 5, s.y - 5, 10, 10); } }
  // Ships.
  const contacts = world.contacts();
  for (const c of contacts) {
    const ship = c.ship, selected = target === ship, color = C[c.attitude];
    const {p: s, behind} = projectAny(scene, ui.poses.get(ship.id)?.pos ?? ship.body.position, w, h);
    if (!behind && onScreen(s, w, h)) {
      const r = Math.max(selected ? 14 : 8, ship.radius / s.w * h * 0.9);
      bracket(ctx, s.x, s.y, r, color, selected ? 2 : 1.2);
      if (selected) {
        label(ctx, `${FACTIONS[ship.faction].short} ${ship.name}`, s.x, s.y - r - 8, color, 12); label(ctx, fmtDist(c.dist), s.x, s.y + r + 15, color, 11);
        const bw = Math.max(34, r * 2);
        ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(s.x - bw / 2, s.y + r + 19, bw, 7);
        ctx.fillStyle = '#5aa8ff'; ctx.fillRect(s.x - bw / 2, s.y + r + 19, bw * ship.shield / ship.maxShield, 3);
        ctx.fillStyle = '#6fe08a'; ctx.fillRect(s.x - bw / 2, s.y + r + 23, bw * ship.hp / ship.maxHp, 3);
      }
    } else if (selected || (c.attitude === 'hostile' && c.dist < 2500)) edgeArrow(ctx, w, h, s, behind, color);
  }
  // Lead marker for the selected ship.
  if (target?.body && dist3(mePos, target.body.position) < 1400) {
    const lead = world.leadFor(target), s = lead && scene.project(lead, w, h);
    if (onScreen(s, w, h)) { ctx.strokeStyle = '#ff7b6b'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(s.x, s.y, 9, 0, 7); ctx.moveTo(s.x - 14, s.y); ctx.lineTo(s.x - 4, s.y); ctx.moveTo(s.x + 4, s.y); ctx.lineTo(s.x + 14, s.y); ctx.moveTo(s.x, s.y - 14); ctx.lineTo(s.x, s.y - 4); ctx.moveTo(s.x, s.y + 4); ctx.lineTo(s.x, s.y + 14); ctx.stroke(); }
  }
  // Nose marker and cursor reticle.
  const nose = scene.project(world.toWorld(me, [0, 0, -500]), w, h);
  if (onScreen(nose, w, h)) { ctx.strokeStyle = 'rgba(180,220,255,.7)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(nose.x, nose.y, 4, 0, 7); ctx.stroke(); }
  if (ui.cursor) {
    const {x, y} = ui.cursor, hot = ui.firing ? '#ffd9a0' : '#bfe6ff';
    ctx.strokeStyle = ui.mouseFlight ? hot : 'rgba(190,230,255,.45)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, 12, 0, 7);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { ctx.moveTo(x + dx * 7, y + dy * 7); ctx.lineTo(x + dx * 18, y + dy * 18); }
    ctx.stroke();
    if (ui.mouseFlight && onScreen(nose, w, h)) { ctx.strokeStyle = 'rgba(150,200,255,.18)'; ctx.beginPath(); ctx.moveTo(nose.x, nose.y); ctx.lineTo(x, y); ctx.stroke(); }
  }

  // Status cluster (bottom left).
  const bx = 18, by = h - 96, bw = 230;
  bar(ctx, bx, by, bw, 16, me.shield / me.maxShield, 'rgba(70,140,255,.85)', 'SHIELD', `${Math.round(me.shield)}`);
  bar(ctx, bx, by + 20, bw, 16, me.hp / me.maxHp, me.hp / me.maxHp < 0.3 ? 'rgba(255,80,60,.9)' : 'rgba(70,200,120,.85)', 'HULL', `${Math.round(me.hp)}`);
  bar(ctx, bx, by + 40, bw, 16, me.energy / me.maxEnergy, 'rgba(240,190,60,.85)', 'ENERGY', `${Math.round(me.energy)}`);
  label(ctx, `[H] Patches ${p.kits}   [J] Cells ${p.cells}${me.launcher ? `   [Q] Missiles ${me.ammo}` : ''}`, bx, by + 76, C.neutral, 11, 'left');

  // Speed and drive state (bottom centre).
  const speed = Math.hypot(...me.body.velocity), cx = w / 2, cy = h - 54;
  ctx.fillStyle = C.panel; ctx.fillRect(cx - 118, cy - 30, 236, 66); ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.strokeRect(cx - 117.5, cy - 29.5, 235, 65);
  ctx.font = `600 26px ${FONT}`; ctx.textAlign = 'center'; ctx.fillStyle = '#eaf4ff'; ctx.fillText(`${Math.round(speed)}`, cx, cy + 2);
  label(ctx, 'm/s', cx + 42, cy + 2, C.dim, 11);
  const mode = world.jump ? 'FOLD JUMP' : me.lane ? 'SLINGWAY' : me.cruise.state === 'on' ? 'CRUISE' : me.cruise.state === 'charging' ? `CRUISE ${Math.round(me.cruise.t / CRUISE_CHARGE * 100)}%`
    : me.drift ? 'DRIFT' : me.burning ? 'AFTERBURN' : world.auto ? 'AUTOPILOT' : ui.mouseFlight ? 'MANUAL' : 'FREE CURSOR';
  label(ctx, mode, cx, cy + 20, me.cruise.state !== 'off' || me.lane ? '#8fd8ff' : me.burning ? '#ffc27a' : C.dim, 11);
  ctx.fillStyle = 'rgba(10,20,34,.7)'; ctx.fillRect(cx - 104, cy + 26, 208, 5); ctx.fillStyle = '#7fc8ff'; ctx.fillRect(cx - 104, cy + 26, 208 * me.throttle, 5);
  ctx.fillStyle = 'rgba(10,20,34,.7)'; ctx.fillRect(cx - 104, cy - 26, 208, 3); ctx.fillStyle = '#ffb45a'; ctx.fillRect(cx - 104, cy - 26, 208 * me.boost, 3);

  // Captain strip (top left).
  ctx.font = `600 14px ${FONT}`; ctx.textAlign = 'left';
  label(ctx, `${world.system.name.toUpperCase()} SYSTEM`, 18, 26, '#eaf4ff', 14, 'left');
  const zone = world.zoneAt(mePos, 'nebula') ?? world.zoneAt(mePos, 'rocks');
  label(ctx, `${fmtCr(p.credits)}   Cargo ${cargoUsed(p)}/${me.hull.cargo}   Rank ${levelOf(p)}${zone ? `   ${zone.name}` : ''}`, 18, 44, C.neutral, 12, 'left');
  const objective = missionObjective(p);
  if (objective) label(ctx, `◆ ${objective}`, 18, 64, C.way, 12, 'left');

  // Contacts list (top right).
  let ly = 26;
  label(ctx, 'CONTACTS', w - 18, ly, C.dim, 10, 'right');
  for (const c of contacts.slice(0, 8)) {
    ly += 16; const selected = target === c.ship;
    label(ctx, `${selected ? '▶ ' : ''}${FACTIONS[c.ship.faction].short} ${c.ship.hull.name}  ${fmtDist(c.dist)}`, w - 18, ly, C[c.attitude], selected ? 12 : 11, 'right');
  }
  // Target panel (bottom right).
  if (target) {
    const tx = w - 258, ty = h - 96;
    ctx.fillStyle = C.panel; ctx.fillRect(tx, ty, 240, 78); ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.strokeRect(tx + 0.5, ty + 0.5, 239, 77);
    if (target.body) {
      const att = world.attitude(target);
      label(ctx, `${target.name}`, tx + 10, ty + 18, C[att], 13, 'left');
      label(ctx, `${FACTIONS[target.faction].name} · ${target.hull.name} · ${att}`, tx + 10, ty + 34, C.dim, 10, 'left');
      bar(ctx, tx + 10, ty + 42, 220, 12, target.shield / target.maxShield, 'rgba(70,140,255,.85)', '', ''); bar(ctx, tx + 10, ty + 57, 220, 12, target.hp / target.maxHp, 'rgba(70,200,120,.85)', '', '');
    } else {
      const d = dist3(mePos, target.pos), near = d <= target.useRange;
      label(ctx, target.name, tx + 10, ty + 18, C.poi, 13, 'left');
      label(ctx, target.type === 'base' ? `${FACTIONS[target.faction].name}` : target.type === 'gate' ? 'Fold gate' : 'Slingway ring', tx + 10, ty + 34, C.dim, 10, 'left');
      label(ctx, `Range ${fmtDist(d)}`, tx + 10, ty + 52, C.neutral, 11, 'left');
      label(ctx, near ? `[F] ${target.type === 'base' ? 'Dock' : target.type === 'gate' ? 'Jump' : 'Ride'}` : '[F] Approach and use   [G] Go to', tx + 10, ty + 68, near ? C.friendly : C.dim, 11, 'left');
    }
  }
  // Messages.
  let my = h * 0.3;
  for (const m of ui.messages) {
    const alpha = Math.min(1, m.ttl / 1.2), color = m.tone === 'warn' ? '#ff9c7a' : m.tone === 'good' ? '#8ff0a8' : m.tone === 'comm' ? '#ffe6a0' : '#cfe3f7';
    ctx.globalAlpha = alpha; label(ctx, m.from ? `${m.from}: “${m.text}”` : m.text, 18, my, color, 12, 'left'); ctx.globalAlpha = 1; my += 17;
  }
  if (ui.hint) { label(ctx, ui.hint, w / 2, h - 110, '#bfe6ff', 12); }
}

// Navigation map -----------------------------------------------------------------------------
function mapLayout(w, h) {
  const size = Math.min(w - 380, h - 120), ox = 40 + size / 2, oy = 70 + size / 2, scale = size / 62000;
  return {size, ox, oy, scale, gx: w - 300, gy: 90, gw: 260, gh: 260};
}
const toMap = (L, pos) => ({x: L.ox + pos[0] * L.scale, y: L.oy + pos[2] * L.scale});

export function drawMap(ctx, w, h, world, ui) {
  const L = mapLayout(w, h), sys = world.system, p = world.player, me = world.playerShip;
  ctx.fillStyle = 'rgba(3,8,16,.9)'; ctx.fillRect(0, 0, w, h);
  label(ctx, `${sys.name.toUpperCase()} SYSTEM`, 40, 40, '#eaf4ff', 18, 'left');
  label(ctx, `${sys.blurb}   Click a place to target it. [M] close · [G] go to · [F] approach and use`, 40, 58, C.dim, 11, 'left');
  ctx.strokeStyle = 'rgba(120,190,255,.25)'; ctx.lineWidth = 1; ctx.strokeRect(L.ox - L.size / 2, L.oy - L.size / 2, L.size, L.size);
  ctx.save(); ctx.beginPath(); ctx.rect(L.ox - L.size / 2, L.oy - L.size / 2, L.size, L.size); ctx.clip();
  for (let g = -30000; g <= 30000; g += 10000) {
    ctx.strokeStyle = 'rgba(120,190,255,.07)'; ctx.beginPath(); const a = toMap(L, [g, 0, -31000]), b = toMap(L, [g, 0, 31000]); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    const c = toMap(L, [-31000, 0, g]), d = toMap(L, [31000, 0, g]); ctx.moveTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.stroke();
  }
  for (const z of sys.zones) {
    const c = toMap(L, z.pos); ctx.beginPath(); ctx.arc(c.x, c.y, z.radius * L.scale, 0, 7);
    ctx.fillStyle = z.kind === 'nebula' ? 'rgba(150,90,220,.14)' : 'rgba(190,160,120,.12)'; ctx.fill();
    label(ctx, z.name, c.x, c.y + z.radius * L.scale + 12, 'rgba(200,190,220,.6)', 10);
  }
  for (const pl of sys.planets) { const c = toMap(L, pl.pos); ctx.beginPath(); ctx.arc(c.x, c.y, Math.max(4, pl.radius * L.scale), 0, 7); ctx.fillStyle = 'rgba(90,130,170,.5)'; ctx.fill(); label(ctx, pl.name, c.x, c.y - pl.radius * L.scale - 5, 'rgba(160,190,220,.7)', 10); }
  for (const lane of world.sector.lanes) { const a = toMap(L, lane.a), b = toMap(L, lane.b); ctx.strokeStyle = 'rgba(80,220,240,.55)'; ctx.lineWidth = 2; ctx.setLineDash([6, 5]); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]); }
  const target = world.targetObject();
  for (const poi of world.sector.pois) {
    if (poi.type === 'ring') continue;
    const c = toMap(L, poi.pos), color = poi.type === 'base' ? (world.baseHostile(poi) ? C.hostile : FACTIONS[poi.faction].color.map(v => Math.round(v * 255)).join(',')) : null;
    if (poi.type === 'base') { ctx.fillStyle = color.startsWith('#') ? color : `rgb(${color})`; ctx.fillRect(c.x - 5, c.y - 5, 10, 10); }
    else { ctx.strokeStyle = '#9fd0ff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(c.x, c.y, 7, 0, 7); ctx.stroke(); }
    if (target === poi) bracket(ctx, c.x, c.y, 13, '#ffffff', 2);
    label(ctx, poi.name, c.x, c.y - 12, '#dbe9f7', 11);
  }
  const way = world.waypoint();
  if (way) { const c = toMap(L, way.pos); diamond(ctx, c.x, c.y, 8, C.way, true); if (!way.poi) label(ctx, way.label, c.x, c.y + 20, C.way, 11); }
  for (const c of world.contacts()) { const s = toMap(L, c.ship.body.position); ctx.fillStyle = C[c.attitude]; ctx.fillRect(s.x - 1.5, s.y - 1.5, 3, 3); }
  const pm = toMap(L, me.body.position), f = world.forward(me), a = Math.atan2(f[2], f[0]);
  ctx.save(); ctx.translate(pm.x, pm.y); ctx.rotate(a); ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(-6, -6); ctx.lineTo(-3, 0); ctx.lineTo(-6, 6); ctx.closePath(); ctx.fill(); ctx.restore();
  ctx.restore();

  // The Reach: gate network.
  label(ctx, 'THE TESSEL REACH', L.gx, L.gy - 20, '#eaf4ff', 13, 'left');
  const node = id => ({x: L.gx + L.gw / 2 + SYSTEMS[id].map[0] * 52, y: L.gy + L.gh / 2 - 20 + SYSTEMS[id].map[1] * 52});
  const route = p.mission && p.mission.system !== sys.id ? [sys.id, ...routeBetween(sys.id, p.mission.system)] : [];
  for (const [id, s] of Object.entries(SYSTEMS)) for (const g of s.gates) if (id < g.to) {
    const a = node(id), b = node(g.to), onRoute = route.some((r, i) => (r === id && route[i + 1] === g.to) || (r === g.to && route[i + 1] === id));
    ctx.strokeStyle = onRoute ? C.way : 'rgba(120,190,255,.35)'; ctx.lineWidth = onRoute ? 2.5 : 1.2; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  for (const [id, s] of Object.entries(SYSTEMS)) {
    const n = node(id), here = id === sys.id, known = p.visited[id];
    ctx.beginPath(); ctx.arc(n.x, n.y, here ? 9 : 6, 0, 7); ctx.fillStyle = `rgb(${s.star.color.map(v => Math.round(v * (known ? 255 : 110))).join(',')})`; ctx.fill();
    if (here) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(n.x, n.y, 13, 0, 7); ctx.stroke(); }
    if (p.mission?.system === id) diamond(ctx, n.x + 16, n.y - 12, 5, C.way, true);
    label(ctx, s.name, n.x, n.y + 24, known ? '#dbe9f7' : 'rgba(160,180,200,.6)', 11);
    label(ctx, `threat ${s.danger}`, n.x, n.y + 36, 'rgba(160,180,200,.5)', 9);
  }
  // Hold summary.
  let y = L.gy + L.gh + 40;
  label(ctx, 'HOLD', L.gx, y, '#eaf4ff', 13, 'left');
  const cargo = Object.entries(p.cargo);
  if (!cargo.length) { y += 18; label(ctx, 'Empty', L.gx, y, C.dim, 11, 'left'); }
  for (const [id, n] of cargo) { y += 18; label(ctx, `${n} × ${GOODS[id].name}`, L.gx, y, GOODS[id].contraband ? '#ff9c7a' : C.neutral, 11, 'left'); }
  if (p.mission?.kind === 'courier') { y += 18; label(ctx, `${p.mission.cargo} × Sealed crates (contract)`, L.gx, y, C.way, 11, 'left'); }
  if (ui.cursor) { ctx.strokeStyle = '#bfe6ff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(ui.cursor.x, ui.cursor.y, 6, 0, 7); ctx.stroke(); }
}
/** The place under a map click, if any. */
export function mapPick(w, h, world, x, y) {
  const L = mapLayout(w, h);
  let best = null, bestD = 22;
  for (const poi of world.sector.pois) {
    if (poi.type === 'ring') continue;
    const c = toMap(L, poi.pos), d = Math.hypot(c.x - x, c.y - y);
    if (d < bestD) { bestD = d; best = poi; }
  }
  return best;
}
