// SPDX-License-Identifier: Apache-2.0
// Captain state, trade and fitting-out. Pure: no DOM, clock or storage.
import {FACTIONS, HULLS, BROADSIDES, TURRETS, UPGRADES, ARMORS, SHIELDS, TORPEDO, GOODS, STATIONS, RESALE, START, MARKET_DAY, priceAt, stocks} from './data.js';

export const SAVE_VERSION = 1;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ok = text => ({ok: true, text}), no = text => ({ok: false, text});
const tradeIn = price => Math.round(price * RESALE);

export function newPlayer(seed = 1) {
  return {v: SAVE_VERSION, seed: seed >>> 0, credits: 4000, hull: 'cutter', hp: HULLS.cutter.hp, battery: 'culverin', turret: 'pulse',
    shield: 1, deflector: 1, engine: 1, armor: 1, torps: 2, cargo: {}, rep: Object.fromEntries(Object.entries(FACTIONS).map(([id, f]) => [id, f.start])),
    station: START, mission: null, wanted: 0, board: 0, stats: {kills: 0, capitals: 0, missions: 0, earned: 0, losses: 0, mined: 0}, time: 0};
}
export const maxHull = p => Math.round(HULLS[p.hull].hp * ARMORS[p.armor].mult);
export const shieldCap = p => Math.round(HULLS[p.hull].shield * SHIELDS[p.shield].mult);
export const dayOf = p => Math.floor(p.time / MARKET_DAY);
export const cargoUsed = p => Object.values(p.cargo).reduce((s, n) => s + n, 0) + (p.mission?.kind === 'delivery' ? p.mission.cargo : 0);
export const cargoFree = p => HULLS[p.hull].cargo - cargoUsed(p);
export const batteryValue = p => BROADSIDES[p.battery].price * HULLS[p.hull].cannons * 2;
export const turretValue = p => TURRETS[p.turret].price * HULLS[p.hull].turrets;
export function netWorth(p) {
  const gear = HULLS[p.hull].price + batteryValue(p) + turretValue(p) + Object.entries(UPGRADES).reduce((s, [kind, tiers]) => s + tiers[p[kind]].price, 0);
  return Math.round(p.credits + gear * RESALE + Object.entries(p.cargo).reduce((s, [id, n]) => s + GOODS[id].price * n, 0));
}
const LEVELS = [0, 30000, 60000, 110000, 180000, 290000, 450000, 680000, 1000000, 1500000];
export function levelOf(p) { const worth = netWorth(p); let level = 1; while (level < LEVELS.length && worth >= LEVELS[level]) level++; return level; }
export const nextLevelAt = p => LEVELS[levelOf(p)] ?? null;
export function adjustRep(p, faction, delta) { if (FACTIONS[faction]) p.rep[faction] = clamp(p.rep[faction] + delta, -1, 1); }
export const standing = rep => (rep <= -0.6 ? 'Hunted' : rep <= -0.35 ? 'Hostile' : rep < -0.1 ? 'Wary' : rep < 0.3 ? 'Neutral' : rep < 0.65 ? 'Friendly' : 'Trusted');

// Trade ---------------------------------------------------------------------------------------
export const priceFor = (p, stationId, goodId) => priceAt(STATIONS[stationId], goodId, p.seed, dayOf(p));
export function buyGood(p, stationId, goodId, qty) {
  const price = priceFor(p, stationId, goodId);
  if (!Number.isInteger(qty) || qty < 1) return no('Choose a quantity.');
  if (!stocks(STATIONS[stationId], goodId)) return no(`${STATIONS[stationId].name} has no ${GOODS[goodId].name} to sell.`);
  if (qty > cargoFree(p)) return no('Not enough hold space.');
  if (price * qty > p.credits) return no('Not enough credits.');
  p.credits -= price * qty; p.cargo[goodId] = (p.cargo[goodId] ?? 0) + qty;
  return ok(`Bought ${qty} ${GOODS[goodId].name} for ${price * qty} cr.`);
}
export function sellGood(p, stationId, goodId, qty) {
  const price = priceFor(p, stationId, goodId), held = p.cargo[goodId] ?? 0;
  if (!Number.isInteger(qty) || qty < 1 || qty > held) return no('You do not hold that much.');
  p.credits += price * qty; p.stats.earned += price * qty; p.cargo[goodId] = held - qty;
  if (!p.cargo[goodId]) delete p.cargo[goodId];
  return ok(`Sold ${qty} ${GOODS[goodId].name} for ${price * qty} cr.`);
}
export const maxBuy = (p, stationId, goodId) => (stocks(STATIONS[stationId], goodId) ? Math.max(0, Math.min(cargoFree(p), Math.floor(p.credits / priceFor(p, stationId, goodId)))) : 0);

// Fitting out ---------------------------------------------------------------------------------
export const batteryQuote = (p, id) => BROADSIDES[id].price * HULLS[p.hull].cannons * 2 - tradeIn(batteryValue(p));
export function buyBattery(p, stationId, id) {
  if (!BROADSIDES[id] || !STATIONS[stationId].batteries.includes(id)) return no('Not sold here.');
  if (id === p.battery) return no('Already mounted.');
  const cost = batteryQuote(p, id);
  if (cost > p.credits) return no('Not enough credits.');
  p.credits -= cost; p.battery = id;
  return ok(`${BROADSIDES[id].name} mounted on both broadsides.`);
}
export const turretQuote = (p, id) => TURRETS[id].price * HULLS[p.hull].turrets - tradeIn(turretValue(p));
export function buyTurrets(p, stationId, id) {
  if (!TURRETS[id] || !STATIONS[stationId].turrets.includes(id)) return no('Not sold here.');
  if (id === p.turret) return no('Already mounted.');
  const cost = turretQuote(p, id);
  if (cost > p.credits) return no('Not enough credits.');
  p.credits -= cost; p.turret = id;
  return ok(`${TURRETS[id].name} fitted to every mount.`);
}
export const upgradeQuote = (p, kind, tier) => UPGRADES[kind][tier].price - tradeIn(UPGRADES[kind][p[kind]].price);
export function buyUpgrade(p, stationId, kind, tier) {
  const tiers = UPGRADES[kind];
  if (!tiers || !tiers[tier]) return no('No such fitting.');
  if (tier > STATIONS[stationId].tier) return no('This yard cannot fit that. Try a bigger port.');
  if (tier === p[kind]) return no('Already fitted.');
  const cost = upgradeQuote(p, kind, tier);
  if (cost > p.credits) return no('Not enough credits.');
  const ratio = p.hp / maxHull(p);
  p.credits -= cost; p[kind] = tier;
  if (kind === 'armor') p.hp = Math.max(1, Math.round(maxHull(p) * ratio));
  return ok(`${tiers[tier].name} fitted.`);
}
export function buyTorpedoes(p, qty) {
  qty = Math.min(qty, HULLS[p.hull].torps - p.torps, Math.floor(p.credits / TORPEDO.price));
  if (qty < 1) return no(p.torps >= HULLS[p.hull].torps ? 'Tubes are full.' : 'Not enough credits.');
  p.credits -= qty * TORPEDO.price; p.torps += qty;
  return ok(`Loaded ${qty} torpedo${qty > 1 ? 'es' : ''}.`);
}
export const repairCost = p => Math.ceil((maxHull(p) - p.hp) * 1.1);
export function repair(p) {
  const cost = repairCost(p);
  if (cost <= 0) return no('The hull is sound.');
  if (cost > p.credits) { const points = Math.floor(p.credits / 1.1); if (points < 1) return no('Not enough credits.'); p.hp += points; p.credits -= Math.ceil(points * 1.1); return ok('Partial repairs. You could not afford the rest.'); }
  p.credits -= cost; p.hp = maxHull(p);
  return ok('Hull fully repaired.');
}
/** Price of changing hull: guns and turrets move across; extra mounts are bought, spare ones traded in. */
export function hullQuote(p, hullId) {
  const next = HULLS[hullId], now = HULLS[p.hull];
  const guns = (next.cannons - now.cannons) * 2 * BROADSIDES[p.battery].price, turrets = (next.turrets - now.turrets) * TURRETS[p.turret].price;
  return next.price - tradeIn(now.price) + (guns >= 0 ? guns : tradeIn(guns)) + (turrets >= 0 ? turrets : tradeIn(turrets));
}
export function buyHull(p, stationId, hullId) {
  const next = HULLS[hullId];
  if (!next || !STATIONS[stationId].yard.includes(hullId)) return no('Not built here.');
  if (hullId === p.hull) return no('You already command one.');
  if (levelOf(p) < next.level) return no(`The yard wants a rank ${next.level} captain for this hull.`);
  if (cargoUsed(p) > next.cargo) return no('Your cargo will not fit. Sell some first.');
  const cost = hullQuote(p, hullId);
  if (cost > p.credits) return no('Not enough credits.');
  p.credits -= cost; p.hull = hullId; p.hp = maxHull(p); p.torps = Math.min(p.torps, next.torps);
  return ok(`The ${next.name} is yours. Guns and turrets have been moved across.`);
}

/** Returns a validated deep copy, or null when the data is not a usable save. */
export function sanitizeSave(raw) {
  try {
    const s = typeof raw === 'string' ? JSON.parse(raw) : structuredClone(raw), int = v => Number.isSafeInteger(v) && v >= 0, num = v => typeof v === 'number' && Number.isFinite(v);
    if (!s || s.v !== SAVE_VERSION || !HULLS[s.hull] || !BROADSIDES[s.battery] || !TURRETS[s.turret] || !STATIONS[s.station]) return null;
    for (const [kind, tiers] of Object.entries(UPGRADES)) if (!Number.isInteger(s[kind]) || s[kind] < 1 || !tiers[s[kind]]) return null;
    if (!int(s.credits) || !int(s.seed) || !int(s.board) || !int(s.wanted) || !int(s.torps) || s.torps > HULLS[s.hull].torps || !num(s.time) || s.time < 0) return null;
    if (!num(s.hp) || s.hp <= 0 || s.hp > maxHull(s)) return null;
    if (!s.cargo || !Object.entries(s.cargo).every(([id, n]) => GOODS[id] && int(n) && n > 0)) return null;
    if (!s.rep || !Object.keys(FACTIONS).every(id => num(s.rep[id]) && Math.abs(s.rep[id]) <= 1)) return null;
    if (!s.stats || !Object.keys(newPlayer().stats).every(key => num(s.stats[key]))) return null;
    if (s.mission !== null && (typeof s.mission !== 'object' || !['bounty', 'wanted', 'defend', 'delivery'].includes(s.mission.kind))) return null;
    if (cargoUsed(s) > HULLS[s.hull].cargo) return null;
    return s;
  } catch { return null; }
}
