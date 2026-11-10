// SPDX-License-Identifier: Apache-2.0
// Captain state, trading, outfitting and save validation. Pure: no DOM, clock or storage.
import {FACTIONS, HULLS, GUNS, LAUNCHERS, SHIELDS, CONSUMABLES, GOODS, BASES, SYSTEMS, RESALE, START, priceAt, stocks} from './data.js';

export const SAVE_VERSION = 1;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ok = (text = '') => ({ok: true, text});
const no = text => ({ok: false, text});

export function newPlayer(seed = 1) {
  return {
    v: SAVE_VERSION, seed: seed >>> 0, credits: 2500, hull: 'sparrow', hp: HULLS.sparrow.hp,
    guns: ['pulse1', 'pulse1'], launcher: null, ammo: 0, shield: 's1', kits: 3, cells: 3, cargo: {},
    rep: Object.fromEntries(Object.entries(FACTIONS).map(([id, f]) => [id, f.start])),
    system: START.system, base: START.base, mission: null, story: 0, board: 0,
    stats: {kills: 0, jumps: 0, trades: 0, missions: 0, earned: 0, losses: 0}, visited: {[START.system]: true}, time: 0,
  };
}

export const cargoUsed = p => Object.values(p.cargo).reduce((s, n) => s + n, 0) + (p.mission?.kind === 'courier' && p.mission.loaded ? p.mission.cargo : 0);
export const cargoFree = p => HULLS[p.hull].cargo - cargoUsed(p);
export const hasContraband = p => Object.keys(p.cargo).some(id => GOODS[id].contraband && p.cargo[id] > 0);

export function equipmentValue(p) {
  return p.guns.reduce((s, id) => s + (id ? GUNS[id].price : 0), 0) + SHIELDS[p.shield].price + (p.launcher ? LAUNCHERS[p.launcher].price : 0);
}
export function netWorth(p) {
  const cargo = Object.entries(p.cargo).reduce((s, [id, n]) => s + GOODS[id].price * n, 0);
  return Math.round(p.credits + (HULLS[p.hull].price + equipmentValue(p)) * RESALE + cargo);
}
const LEVELS = [0, 9000, 16000, 28000, 46000, 72000, 110000, 160000, 230000, 330000, 470000, 680000];
export function levelOf(p) {
  const worth = netWorth(p);
  let level = 1;
  while (level < LEVELS.length && worth >= LEVELS[level]) level++;
  return level;
}
export const nextLevelAt = p => LEVELS[levelOf(p)] ?? null;

export function adjustRep(p, faction, delta) { p.rep[faction] = clamp((p.rep[faction] ?? 0) + delta, -1, 1); }
export function standing(rep) {
  return rep <= -0.6 ? 'Hunted' : rep <= -0.35 ? 'Hostile' : rep < -0.1 ? 'Wary' : rep < 0.3 ? 'Neutral' : rep < 0.65 ? 'Friendly' : 'Trusted';
}

// Commodities --------------------------------------------------------------------------------
export function buyGood(p, baseId, goodId, qty) {
  const base = BASES[baseId], price = priceAt(base, goodId);
  if (!Number.isInteger(qty) || qty < 1) return no('Choose a quantity.');
  if (price === null || !stocks(base, goodId)) return no(`${base.name} does not sell ${GOODS[goodId].name}.`);
  if (qty > cargoFree(p)) return no('Not enough cargo space.');
  if (price * qty > p.credits) return no('Not enough credits.');
  p.credits -= price * qty; p.cargo[goodId] = (p.cargo[goodId] ?? 0) + qty;
  return ok(`Bought ${qty} ${GOODS[goodId].name} for ${price * qty} cr.`);
}
export function sellGood(p, baseId, goodId, qty) {
  const base = BASES[baseId], price = priceAt(base, goodId), held = p.cargo[goodId] ?? 0;
  if (!Number.isInteger(qty) || qty < 1 || qty > held) return no('You do not hold that much.');
  if (price === null) return no(`Nobody at ${base.name} will touch ${GOODS[goodId].name}.`);
  p.credits += price * qty; p.cargo[goodId] = held - qty;
  if (!p.cargo[goodId]) delete p.cargo[goodId];
  p.stats.trades += qty; p.stats.earned += price * qty;
  return ok(`Sold ${qty} ${GOODS[goodId].name} for ${price * qty} cr.`);
}
export function maxBuy(p, baseId, goodId) {
  const price = priceAt(BASES[baseId], goodId);
  return price === null || !stocks(BASES[baseId], goodId) ? 0 : Math.max(0, Math.min(cargoFree(p), Math.floor(p.credits / price)));
}

// Outfitting ---------------------------------------------------------------------------------
const tradeIn = price => Math.round(price * RESALE);
export function buyGun(p, baseId, slot, gunId) {
  const hull = HULLS[p.hull], gun = GUNS[gunId];
  if (!gun || !BASES[baseId].outfit.includes(gunId)) return no('Not sold here.');
  if (!Number.isInteger(slot) || slot < 0 || slot >= hull.guns) return no('No such hardpoint.');
  if (gun.cls > hull.gunClass) return no(`The ${hull.name} mounts class ${hull.gunClass} guns at most.`);
  const cost = gun.price - (p.guns[slot] ? tradeIn(GUNS[p.guns[slot]].price) : 0);
  if (cost > p.credits) return no('Not enough credits.');
  p.credits -= cost; p.guns[slot] = gunId;
  return ok(`${gun.name} mounted on hardpoint ${slot + 1}.`);
}
export function sellGun(p, slot) {
  if (!p.guns[slot]) return no('That hardpoint is empty.');
  p.credits += tradeIn(GUNS[p.guns[slot]].price); p.guns[slot] = null;
  return ok('Gun sold.');
}
export function buyShield(p, baseId, shieldId) {
  const hull = HULLS[p.hull], shield = SHIELDS[shieldId];
  if (!shield || !BASES[baseId].outfit.includes(shieldId)) return no('Not sold here.');
  if (shield.cls > hull.shieldClass) return no(`The ${hull.name} carries class ${hull.shieldClass} shields at most.`);
  if (shieldId === p.shield) return no('Already fitted.');
  const cost = shield.price - tradeIn(SHIELDS[p.shield].price);
  if (cost > p.credits) return no('Not enough credits.');
  p.credits -= cost; p.shield = shieldId;
  return ok(`${shield.name} fitted.`);
}
export function buyLauncher(p, baseId, launcherId) {
  const hull = HULLS[p.hull], launcher = LAUNCHERS[launcherId];
  if (!launcher || !BASES[baseId].outfit.includes(launcherId)) return no('Not sold here.');
  if (!hull.launchers) return no(`The ${hull.name} has no missile rack mount.`);
  if (launcherId === p.launcher) return no('Already fitted.');
  const refund = p.launcher ? tradeIn(LAUNCHERS[p.launcher].price) + tradeIn(LAUNCHERS[p.launcher].ammoPrice * p.ammo) : 0;
  if (launcher.price - refund > p.credits) return no('Not enough credits.');
  p.credits -= launcher.price - refund; p.launcher = launcherId; p.ammo = 0;
  return ok(`${launcher.name} fitted. Buy missiles to arm it.`);
}
export function buyAmmo(p, qty) {
  const launcher = LAUNCHERS[p.launcher];
  if (!launcher) return no('No missile rack fitted.');
  qty = Math.min(qty, launcher.ammoMax - p.ammo, Math.floor(p.credits / launcher.ammoPrice));
  if (qty < 1) return no(p.ammo >= launcher.ammoMax ? 'Rack is full.' : 'Not enough credits.');
  p.credits -= qty * launcher.ammoPrice; p.ammo += qty;
  return ok(`Loaded ${qty} missiles.`);
}
export function buyConsumable(p, kind, qty) {
  const item = CONSUMABLES[kind], field = kind === 'kit' ? 'kits' : 'cells', cap = HULLS[p.hull].kits;
  qty = Math.min(qty, cap - p[field], Math.floor(p.credits / item.price));
  if (qty < 1) return no(p[field] >= cap ? 'Locker is full.' : 'Not enough credits.');
  p.credits -= qty * item.price; p[field] += qty;
  return ok(`Bought ${qty} ${item.name}${qty > 1 ? (kind === 'kit' ? 'es' : 's') : ''}.`);
}
export const repairCost = p => Math.ceil((HULLS[p.hull].hp - p.hp) * 0.9);
export function repair(p) {
  const cost = repairCost(p);
  if (cost <= 0) return no('Hull is already sound.');
  if (cost > p.credits) {
    const points = Math.floor(p.credits / 0.9);
    if (points < 1) return no('Not enough credits.');
    p.hp += points; p.credits -= Math.ceil(points * 0.9);
    return ok('Partial repairs done. You could not afford the rest.');
  }
  p.credits -= cost; p.hp = HULLS[p.hull].hp;
  return ok('Hull fully repaired.');
}

/** Net price of swapping to a hull here, after trading in the old hull and gear that will not fit. */
export function hullQuote(p, hullId) {
  const next = HULLS[hullId];
  let refund = tradeIn(HULLS[p.hull].price);
  p.guns.forEach((id, slot) => { if (id && (slot >= next.guns || GUNS[id].cls > next.gunClass)) refund += tradeIn(GUNS[id].price); });
  if (SHIELDS[p.shield].cls > next.shieldClass) refund += tradeIn(SHIELDS[p.shield].price);
  if (p.launcher && !next.launchers) refund += tradeIn(LAUNCHERS[p.launcher].price) + tradeIn(LAUNCHERS[p.launcher].ammoPrice * p.ammo);
  return next.price - refund;
}
export function buyHull(p, baseId, hullId) {
  const next = HULLS[hullId];
  if (!next || !BASES[baseId].ships.includes(hullId)) return no('Not sold here.');
  if (hullId === p.hull) return no('You already fly one.');
  if (levelOf(p) < next.level) return no(`The broker wants a rank ${next.level} captain for this hull.`);
  if (cargoUsed(p) > next.cargo) return no('Your cargo will not fit. Sell some first.');
  const cost = hullQuote(p, hullId);
  if (cost > p.credits) return no('Not enough credits.');
  p.credits -= cost;
  p.guns = Array.from({length: next.guns}, (_, slot) => (p.guns[slot] && GUNS[p.guns[slot]].cls <= next.gunClass ? p.guns[slot] : null));
  if (SHIELDS[p.shield].cls > next.shieldClass) p.shield = 's1';
  if (!next.launchers) { p.launcher = null; p.ammo = 0; }
  p.hull = hullId; p.hp = next.hp; p.kits = Math.min(p.kits, next.kits); p.cells = Math.min(p.cells, next.kits);
  return ok(`The ${next.name} is yours. Fly her well.`);
}

// Saves --------------------------------------------------------------------------------------
/** Returns a validated deep copy, or null when the data is not a usable save. */
export function sanitizeSave(raw) {
  try {
    const s = typeof raw === 'string' ? JSON.parse(raw) : structuredClone(raw);
    const int = v => Number.isSafeInteger(v) && v >= 0, num = v => typeof v === 'number' && Number.isFinite(v);
    if (!s || s.v !== SAVE_VERSION || !HULLS[s.hull] || !SHIELDS[s.shield] || !SYSTEMS[s.system] || BASES[s.base]?.system !== s.system) return null;
    const hull = HULLS[s.hull];
    if (!int(s.credits) || !num(s.hp) || s.hp <= 0 || s.hp > hull.hp || !int(s.ammo) || !int(s.kits) || !int(s.cells) || !int(s.story) || !int(s.board) || !int(s.seed)) return null;
    if (!Array.isArray(s.guns) || s.guns.length !== hull.guns || !s.guns.every(g => g === null || GUNS[g])) return null;
    if (s.launcher !== null && !LAUNCHERS[s.launcher]) return null;
    if (!s.cargo || !Object.entries(s.cargo).every(([id, n]) => GOODS[id] && int(n) && n > 0)) return null;
    if (!s.rep || !Object.keys(FACTIONS).every(id => num(s.rep[id]) && Math.abs(s.rep[id]) <= 1)) return null;
    if (!s.stats || !s.visited || !num(s.time)) return null;
    for (const key of Object.keys(newPlayer().stats)) if (!num(s.stats[key])) return null;
    if (s.mission !== null && (typeof s.mission !== 'object' || !['bounty', 'courier'].includes(s.mission.kind) || !SYSTEMS[s.mission.system])) return null;
    if (cargoUsed(s) > hull.cargo) return null;
    return s;
  } catch { return null; }
}
