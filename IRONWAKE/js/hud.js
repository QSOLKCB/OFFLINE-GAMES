// SPDX-License-Identifier: Apache-2.0
// Bridge display and sector chart for IRONWAKE, drawn on a 2D canvas above the WebGL view.
import {FACTIONS, SECTOR, GOODS, HULLS, marketEvent} from './sim/data.js';
import {cargoUsed, levelOf, dayOf} from './sim/player.js';
import {missionObjective} from './sim/missions.js';
import {headingOf, WARP_SPOOL, DOCK_SPEED} from './sim/world.js';

const C = {hostile: '#ff5a4a', neutral: '#d5e0ee', friendly: '#5fe08a', port: '#7fc8ff', way: '#c58cff', loot: '#ffd24a', dim: 'rgba(160,190,220,.6)', panel: 'rgba(6,14,24,.64)', line: 'rgba(120,190,255,.5)', gold: '#ffd27a'};
const FONT = '"Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';
export const fmtDist = d => (d < 1000 ? `${Math.round(d)} m` : `${(d / 1000).toFixed(d < 10000 ? 1 : 0)} km`);
export const fmtCr = n => `${Math.round(n).toLocaleString('en-US')} cr`;

function label(ctx, text, x, y, color, size = 11, align = 'center', weight = '') {
  ctx.font = `${weight} ${size}px ${FONT}`; ctx.textAlign = align; ctx.fillStyle = 'rgba(0,0,0,.65)'; ctx.fillText(text, x + 1, y + 1); ctx.fillStyle = color; ctx.fillText(text, x, y);
}
function bracket(ctx, x, y, r, color, width = 1.5) {
  const k = r * 0.45; ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath();
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { ctx.moveTo(x + sx * r, y + sy * (r - k)); ctx.lineTo(x + sx * r, y + sy * r); ctx.lineTo(x + sx * (r - k), y + sy * r); }
  ctx.stroke();
}
function diamond(ctx, x, y, r, color, fill = false) {
  ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath();
  if (fill) { ctx.fillStyle = color; ctx.fill(); } else { ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke(); }
}
function bar(ctx, x, y, w, h, frac, color, title = '', value = '') {
  ctx.fillStyle = 'rgba(10,20,34,.72)'; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = color; ctx.fillRect(x, y, w * Math.max(0, Math.min(1, frac)), h);
  ctx.strokeStyle = 'rgba(150,200,255,.35)'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  if (title) { ctx.font = `600 10px ${FONT}`; ctx.textAlign = 'left'; ctx.fillStyle = '#e8f1fb'; ctx.fillText(title, x + 5, y + h - 4); ctx.textAlign = 'right'; ctx.fillText(value, x + w - 5, y + h - 4); }
}
/** Four shield screens as arcs around a hull glyph; `turn` rotates the bow away from straight up. */
function screens(ctx, x, y, r, ship, turn = 0) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(turn);
  const hull = ship.hp / ship.maxHp;
  ctx.fillStyle = hull > 0.6 ? 'rgba(110,220,140,.9)' : hull > 0.3 ? 'rgba(240,190,70,.9)' : 'rgba(255,90,70,.95)';
  ctx.beginPath(); ctx.moveTo(0, -r * 0.62); ctx.lineTo(r * 0.24, -r * 0.2); ctx.lineTo(r * 0.24, r * 0.5); ctx.lineTo(-r * 0.24, r * 0.5); ctx.lineTo(-r * 0.24, -r * 0.2); ctx.closePath(); ctx.fill();
  const centre = [-Math.PI / 2, 0, Math.PI / 2, Math.PI]; // fore, starboard, aft, port
  for (let q = 0; q < 4; q++) {
    const k = ship.shMax ? ship.sh[q] / ship.shMax : 0;
    ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(40,60,90,.8)'; ctx.beginPath(); ctx.arc(0, 0, r, centre[q] - 0.68, centre[q] + 0.68); ctx.stroke();
    if (k > 0.01) { ctx.strokeStyle = `rgba(${Math.round(90 + (1 - k) * 160)},${Math.round(120 + k * 60)},255,${0.35 + k * 0.65})`; ctx.beginPath(); ctx.arc(0, 0, r, centre[q] - 0.68 * k, centre[q] + 0.68 * k); ctx.stroke(); }
  }
  if (ship.deflect?.active) { ctx.strokeStyle = 'rgba(110,255,230,.9)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, r + 6, 0, 7); ctx.stroke(); }
  ctx.restore();
}
function edgeArrow(ctx, w, h, p, behind, color) {
  let dx = p.x - w / 2, dy = p.y - h / 2; if (behind) { dx = -dx; dy = -dy; }
  const l = Math.hypot(dx, dy) || 1, m = 46, k = Math.min((w / 2 - m) / Math.abs(dx / l || 1e-6), (h / 2 - m) / Math.abs(dy / l || 1e-6)), x = w / 2 + dx / l * k, y = h / 2 + dy / l * k;
  ctx.save(); ctx.translate(x, y); ctx.rotate(Math.atan2(dy, dx)); ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(-7, -7); ctx.lineTo(-3, 0); ctx.lineTo(-7, 7); ctx.closePath(); ctx.fill(); ctx.restore();
  return {x, y};
}
const onScreen = (p, w, h) => p && p.x > 0 && p.x < w && p.y > 0 && p.y < h;
function projectAny(scene, pos, w, h) {
  const p = scene.project(pos, w, h); if (p) return {p, behind: false};
  const c = scene.cam.pos; return {p: scene.project([2 * c[0] - pos[0], 2 * c[1] - pos[1], 2 * c[2] - pos[2]], w, h) ?? {x: w / 2, y: h}, behind: true};
}

export function drawHud(ctx, w, h, world, scene, ui) {
  ctx.clearRect(0, 0, w, h); ctx.textBaseline = 'alphabetic';
  const p = world.player, me = world.playerShip, at = me.body.position, target = world.targetObject(), dest = world.destination(), way = world.waypoint();
  const range = (x, z) => Math.hypot(x - at[0], z - at[2]);

  // Ports, course and contract markers.
  for (const s of world.sector.stations) {
    const pt = scene.project(s.pos, w, h), d = range(s.pos[0], s.pos[2]), chosen = dest?.station === s;
    if (!onScreen(pt, w, h)) { if (chosen) { const e = edgeArrow(ctx, w, h, projectAny(scene, s.pos, w, h).p, !pt, C.port); label(ctx, fmtDist(d), e.x, e.y + 22, C.port, 11); } continue; }
    const color = world.stationHostile(s) ? C.hostile : C.port;
    diamond(ctx, pt.x, pt.y, chosen ? 9 : 5, color); if (chosen) bracket(ctx, pt.x, pt.y, 16, color, 2);
    label(ctx, `${s.name}  ${fmtDist(d)}`, pt.x, pt.y - 14, color, chosen ? 12 : 11);
  }
  if (way && !way.station) {
    const pos = [way.pos[0], 0, way.pos[1]], {p: pt, behind} = projectAny(scene, pos, w, h), d = range(way.pos[0], way.pos[1]);
    if (!behind && onScreen(pt, w, h)) { diamond(ctx, pt.x, pt.y, 8, C.way, true); label(ctx, `${way.label}  ${fmtDist(d)}`, pt.x, pt.y + 24, C.way, 12); }
    else { const e = edgeArrow(ctx, w, h, pt, behind, C.way); label(ctx, fmtDist(d), e.x, e.y + 22, C.way, 11); }
  }
  for (const k of world.pickups) { const pt = scene.project([k.x, 0, k.z], w, h); if (onScreen(pt, w, h)) { ctx.strokeStyle = k.good === 'crystal' ? '#7fe0ff' : C.loot; ctx.lineWidth = 1.5; ctx.strokeRect(pt.x - 5, pt.y - 5, 10, 10); } }

  // Ships.
  const contacts = world.contacts();
  for (const c of contacts) {
    const ship = c.ship, selected = target === ship, color = C[c.attitude], {p: pt, behind} = projectAny(scene, ui.poses.get(ship.id)?.pos ?? ship.body.position, w, h);
    if (!behind && onScreen(pt, w, h)) {
      const r = Math.max(selected ? 14 : ship.kind === 'craft' ? 5 : 9, ship.radius / pt.w * h * 0.95);
      if (ship.kind === 'craft' && !selected) { ctx.strokeStyle = color; ctx.lineWidth = 1.2; ctx.strokeRect(pt.x - r, pt.y - r, r * 2, r * 2); } else bracket(ctx, pt.x, pt.y, r, color, selected ? 2 : 1.3);
      if (selected) { label(ctx, `${FACTIONS[ship.faction].short} ${ship.name}`, pt.x, pt.y - r - 8, color, 12); label(ctx, fmtDist(c.dist), pt.x, pt.y + r + 15, color, 11); }
    } else if (selected || (c.attitude === 'hostile' && ship.kind !== 'craft' && c.dist < 3000)) edgeArrow(ctx, w, h, pt, behind, color);
  }
  if (target) {
    const lead = world.leadFor(target), pt = lead && scene.project(lead, w, h);
    if (onScreen(pt, w, h) && contacts.find(c => c.ship === target)?.dist < me.battery.def.range * 1.4) {
      ctx.strokeStyle = '#ff7b6b'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(pt.x, pt.y, 9, 0, 7);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { ctx.moveTo(pt.x + dx * 4, pt.y + dy * 4); ctx.lineTo(pt.x + dx * 14, pt.y + dy * 14); }
      ctx.stroke();
    }
  }

  // Gunnery prompt at the view centre.
  const aim = world.aim, cx = w / 2, cy = h / 2, side = aim.bearing;
  ctx.strokeStyle = aim.side ? (aim.t >= 1 ? '#fff2a8' : '#ffc27a') : 'rgba(190,230,255,.6)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx, cy, aim.side ? 18 - aim.t * 10 : 6, 0, 7); ctx.stroke();
  if (me.warp.state === 'off') {
    const sideName = side === 'port' ? 'PORT' : side === 'star' ? 'STARBOARD' : null;
    const text = aim.side ? `${sideName} BATTERY ${aim.t >= 1 ? '— STEADY, RELEASE TO FIRE' : `STEADYING ${Math.round(aim.t * 100)}%`}`
      : !sideName ? 'NO BEARING — look to port or starboard' : world.batteryReady(me, side) ? `${sideName} BATTERY READY` : `${sideName} BATTERY RELOADING`;
    label(ctx, text, cx, cy - 34, aim.side ? C.gold : sideName && world.batteryReady(me, side) ? '#bfe6ff' : C.dim, 11, 'center', '600');
  }

  // Own ship: screens, hull, batteries, drive (bottom centre).
  const speed = Math.hypot(me.body.velocity[0], me.body.velocity[2]), bx = cx - 200, by = h - 112;
  ctx.fillStyle = C.panel; ctx.fillRect(bx, by, 400, 100); ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.strokeRect(bx + 0.5, by + 0.5, 399, 99);
  screens(ctx, cx, by + 46, 30, me);
  bar(ctx, bx + 12, by + 12, 130, 15, world.batteryState(me, 'port'), world.batteryReady(me, 'port') ? 'rgba(255,190,90,.9)' : 'rgba(150,110,60,.8)', 'PORT GUNS', world.batteryReady(me, 'port') ? 'READY' : '');
  bar(ctx, bx + 258, by + 12, 130, 15, world.batteryState(me, 'star'), world.batteryReady(me, 'star') ? 'rgba(255,190,90,.9)' : 'rgba(150,110,60,.8)', 'STBD GUNS', world.batteryReady(me, 'star') ? 'READY' : '');
  bar(ctx, bx + 12, by + 32, 130, 15, me.hp / me.maxHp, me.hp / me.maxHp < 0.3 ? 'rgba(255,80,60,.9)' : 'rgba(70,200,120,.85)', 'HULL', `${Math.round(me.hp)}`);
  bar(ctx, bx + 258, by + 32, 130, 15, me.deflect.charge, me.deflect.active ? 'rgba(110,255,230,.95)' : 'rgba(60,170,160,.85)', 'DEFLECTOR', me.deflect.active ? 'UP' : '');
  bar(ctx, bx + 12, by + 52, 130, 15, me.throttle, 'rgba(110,170,255,.85)', 'THROTTLE', `${Math.round(speed)} m/s`);
  bar(ctx, bx + 258, by + 52, 130, 15, me.boost, 'rgba(255,170,80,.85)', 'BOOST', '');
  const mode = me.warp.state === 'on' ? 'WARP' : me.warp.state === 'spool' ? (me.warp.t >= WARP_SPOOL ? 'ALIGNING FOR WARP' : `WARP SPOOLING ${Math.round(me.warp.t / WARP_SPOOL * 100)}%`) : me.boosting ? 'BOOSTING' : me.deflect.active ? 'DEFLECTOR UP' : '';
  label(ctx, mode || `${me.geometry ? HULLS[p.hull].name : ''}-class ${HULLS[p.hull].cls}`, cx, by + 92, mode ? '#8fd8ff' : C.dim, 11, 'center', '600');
  label(ctx, `[${ui.controller ? 'X / Square' : 'Q'}] Torpedoes ${me.torps}`, bx + 12, by + 88, C.neutral, 11, 'left'); label(ctx, `${me.turrets.length} turrets: auto`, bx + 388, by + 88, C.dim, 11, 'right');

  // Captain strip (top left).
  label(ctx, SECTOR.name.toUpperCase(), 18, 26, '#eaf4ff', 14, 'left', '600');
  const field = world.fieldAt(at[0], at[2]);
  label(ctx, `${fmtCr(p.credits)}   Hold ${cargoUsed(p)}/${HULLS[p.hull].cargo}   Rank ${levelOf(p)}${field ? `   ${field.name}` : ''}`, 18, 44, C.neutral, 12, 'left');
  const objective = missionObjective(p) ?? world.mod?.objective ?? world.encounters.objective(); let ty = 64;
  if (objective) { label(ctx, `◆ ${objective}`, 18, ty, C.way, 12, 'left'); ty += 18; }
  if (dest) label(ctx, `➤ Course: ${dest.label}  ${fmtDist(range(dest.pos[0], dest.pos[1]))}   [${ui.controller ? 'RB / R1' : 'J'}] warp`, 18, ty, C.port, 12, 'left');

  // Radar (top right): view-up, so what you see ahead is at the top.
  const rx = w - 104, ry = 104, rr = 84, scale = rr / 2400, cosv = Math.cos(ui.camYaw), sinv = Math.sin(ui.camYaw);
  const toRadar = (x, z) => { const dx = x - at[0], dz = z - at[2]; return [(dx * cosv - dz * sinv) * scale, (dx * sinv + dz * cosv) * scale]; };
  ctx.fillStyle = C.panel; ctx.beginPath(); ctx.arc(rx, ry, rr + 4, 0, 7); ctx.fill(); ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.stroke();
  ctx.strokeStyle = 'rgba(120,190,255,.2)'; ctx.beginPath(); ctx.arc(rx, ry, rr * 0.5, 0, 7); ctx.moveTo(rx - rr, ry); ctx.lineTo(rx + rr, ry); ctx.moveTo(rx, ry - rr); ctx.lineTo(rx, ry + rr); ctx.stroke();
  const blip = (x, z, draw, pin = false) => { let [dx, dy] = toRadar(x, z); const l = Math.hypot(dx, dy); if (l > rr) { if (!pin) return; dx *= rr / l; dy *= rr / l; } draw(rx + dx, ry + dy); };
  for (const s of world.sector.stations) blip(s.pos[0], s.pos[2], (x, y) => { ctx.fillStyle = dest?.station === s ? '#fff' : C.port; ctx.fillRect(x - 3, y - 3, 6, 6); }, dest?.station === s);
  if (way && !way.station) blip(way.pos[0], way.pos[1], (x, y) => diamond(ctx, x, y, 4, C.way, true), true);
  for (const c of contacts) blip(c.ship.body.position[0], c.ship.body.position[2], (x, y) => { const r = c.ship.kind === 'craft' ? 1.5 : 3; ctx.fillStyle = C[c.attitude]; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); if (target === c.ship) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.strokeRect(x - 5, y - 5, 10, 10); } });
  ctx.save(); ctx.translate(rx, ry); ctx.rotate(ui.camYaw - headingOf(me)); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5, 6); ctx.closePath(); ctx.fill(); ctx.restore();
  label(ctx, '2.4 km', rx, ry + rr + 18, C.dim, 10);

  // Target panel (below the radar).
  if (target) {
    const tx = w - 258, tyy = ry + rr + 28, att = world.attitude(target), d = contacts.find(c => c.ship === target)?.dist ?? 0;
    ctx.fillStyle = C.panel; ctx.fillRect(tx, tyy, 240, 76); ctx.strokeStyle = C.line; ctx.strokeRect(tx + 0.5, tyy + 0.5, 239, 75);
    label(ctx, target.name, tx + 10, tyy + 18, C[att], 13, 'left', '600');
    label(ctx, `${FACTIONS[target.faction].name}`, tx + 10, tyy + 34, C.dim, 10, 'left');
    label(ctx, `${target.kind === 'craft' ? 'Strike craft' : target.kind === 'hauler' ? 'Hauler' : 'Warship'} · ${fmtDist(d)}`, tx + 10, tyy + 48, C.neutral, 10, 'left');
    bar(ctx, tx + 10, tyy + 56, 150, 11, target.hp / target.maxHp, 'rgba(70,200,120,.85)');
    screens(ctx, tx + 200, tyy + 38, 24, target, headingOf(me) - headingOf(target));
  }
  // Messages.
  let my = h * 0.3;
  for (const m of ui.messages) {
    ctx.globalAlpha = Math.min(1, m.ttl / 1.2);
    label(ctx, m.from ? `${m.from}: “${m.text}”` : m.text, 18, my, m.tone === 'warn' ? '#ff9c7a' : m.tone === 'good' ? '#8ff0a8' : m.tone === 'comm' ? '#ffe6a0' : '#cfe3f7', 12, 'left');
    ctx.globalAlpha = 1; my += 17;
  }
  const port = world.sector.stations.find(s => range(s.pos[0], s.pos[2]) <= s.useRange);
  if (port && me.warp.state === 'off') label(ctx, world.stationHostile(port) ? `${port.name} will not receive you` : speed > DOCK_SPEED ? `Slow below ${DOCK_SPEED} m/s to dock at ${port.name}` : `Press ${ui.controller ? 'A / Cross' : 'F'} to dock at ${port.name}`, cx, by - 14, '#bfe6ff', 12, 'center', '600');
  if (ui.hint) label(ctx, ui.hint, cx, 28, '#bfe6ff', 12);
}

// Sector chart --------------------------------------------------------------------------------
function chart(w, h) { const size = Math.min(w - 380, h - 120); return {size, ox: 40 + size / 2, oy: 70 + size / 2, scale: size / 92000}; }
const toChart = (L, x, z) => ({x: L.ox + x * L.scale, y: L.oy + z * L.scale});

export function drawMap(ctx, w, h, world, ui) {
  const L = chart(w, h), p = world.player, me = world.playerShip, dest = world.destination(), way = world.waypoint();
  ctx.fillStyle = 'rgba(3,8,16,.92)'; ctx.fillRect(0, 0, w, h); ctx.textBaseline = 'alphabetic';
  label(ctx, SECTOR.name.toUpperCase(), 40, 40, '#eaf4ff', 18, 'left', '600');
  label(ctx, ui.controller ? 'D-pad up/down: course · RS: signal · A / RB: warp · B / View: close' : 'Click a port or beacon. [V] signal · [J] warp there · [M] close', 40, 58, C.dim, 11, 'left');
  ctx.strokeStyle = 'rgba(120,190,255,.25)'; ctx.lineWidth = 1; ctx.strokeRect(L.ox - L.size / 2, L.oy - L.size / 2, L.size, L.size);
  ctx.save(); ctx.beginPath(); ctx.rect(L.ox - L.size / 2, L.oy - L.size / 2, L.size, L.size); ctx.clip();
  for (let g = -40000; g <= 40000; g += 10000) { ctx.strokeStyle = 'rgba(120,190,255,.07)'; ctx.beginPath(); const a = toChart(L, g, -46000), b = toChart(L, g, 46000), c = toChart(L, -46000, g), d = toChart(L, 46000, g); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.moveTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.stroke(); }
  for (const f of SECTOR.fields) {
    const c = toChart(L, f.pos[0], f.pos[1]); ctx.beginPath(); ctx.arc(c.x, c.y, f.radius * L.scale, 0, 7);
    ctx.fillStyle = f.kind === 'wrecks' ? 'rgba(220,80,70,.13)' : 'rgba(190,160,120,.14)'; ctx.fill();
    label(ctx, f.name + (f.kind === 'wrecks' ? ` (threat ${f.threat})` : f.rich ? ' (crystal)' : ' (ore)'), c.x, c.y + f.radius * L.scale + 12, 'rgba(210,195,200,.65)', 10);
  }
  if (dest) { const a = toChart(L, me.body.position[0], me.body.position[2]), b = toChart(L, dest.pos[0], dest.pos[1]); ctx.strokeStyle = 'rgba(127,200,255,.6)'; ctx.setLineDash([6, 5]); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]); }
  for (const s of world.sector.stations) {
    const c = toChart(L, s.pos[0], s.pos[2]); ctx.fillStyle = world.stationHostile(s) ? C.hostile : `rgb(${FACTIONS[s.faction].color.map(v => Math.round(v * 255)).join(',')})`; ctx.fillRect(c.x - 5, c.y - 5, 10, 10);
    if (dest?.station === s) bracket(ctx, c.x, c.y, 13, '#fff', 2);
    label(ctx, s.name, c.x, c.y - 12, '#dbe9f7', 11);
  }
  if (way && !way.station) { const c = toChart(L, way.pos[0], way.pos[1]); diamond(ctx, c.x, c.y, 8, C.way, true); label(ctx, way.label, c.x, c.y + 20, C.way, 11); }
  for (const c of world.contacts()) { const s = toChart(L, c.ship.body.position[0], c.ship.body.position[2]); ctx.fillStyle = C[c.attitude]; ctx.fillRect(s.x - 1.5, s.y - 1.5, 3, 3); }
  const pm = toChart(L, me.body.position[0], me.body.position[2]);
  ctx.save(); ctx.translate(pm.x, pm.y); ctx.rotate(-headingOf(me)); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(6, 6); ctx.lineTo(0, 3); ctx.lineTo(-6, 6); ctx.closePath(); ctx.fill(); ctx.restore();
  ctx.restore();
  // Market board and hold.
  const gx = w - 300; let y = 70;
  label(ctx, 'MARKET BOARD', gx, y, '#eaf4ff', 13, 'left', '600');
  for (const s of SECTOR.stations) { const e = marketEvent(p.seed, s.id, dayOf(p)); y += 18; label(ctx, `${s.name}: ${e ? e.text : 'steady'}`, gx, y, e ? (e.mult > 1 ? C.gold : '#8ff0a8') : C.dim, 11, 'left'); }
  y += 34; label(ctx, 'HOLD', gx, y, '#eaf4ff', 13, 'left', '600');
  const cargo = Object.entries(p.cargo);
  if (!cargo.length) { y += 18; label(ctx, 'Empty', gx, y, C.dim, 11, 'left'); }
  for (const [id, n] of cargo) { y += 18; label(ctx, `${n} × ${GOODS[id].name}`, gx, y, C.neutral, 11, 'left'); }
  if (p.mission?.kind === 'delivery') { y += 18; label(ctx, `${p.mission.cargo} × Bonded crates (contract)`, gx, y, C.way, 11, 'left'); }
  y += 34; label(ctx, `PATROLS RESOLVED: ${p.patrols ?? 0}`, gx, y, C.gold, 12, 'left', '600');
  if (world.encounters.active) { y += 20; label(ctx, world.encounters.active.title, gx, y, C.way, 11, 'left'); }
  if (ui.cursor) { ctx.strokeStyle = '#bfe6ff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(ui.cursor.x, ui.cursor.y, 6, 0, 7); ctx.stroke(); }
}
/** The port under a chart click, if any. */
export function mapPick(w, h, world, x, y) {
  const L = chart(w, h); let best = null, bestD = 24;
  for (const s of world.sector.stations) { const c = toChart(L, s.pos[0], s.pos[2]), d = Math.hypot(c.x - x, c.y - y); if (d < bestD) { bestD = d; best = s; } }
  const way = world.waypoint();
  if (way && !way.station) { const c = toChart(L, way.pos[0], way.pos[1]); if (Math.hypot(c.x - x, c.y - y) < bestD) best = {id: way.signal ? 'signal' : 'contract'}; }
  return best;
}
