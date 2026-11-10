// SPDX-License-Identifier: Apache-2.0
// IRONWAKE — static data. Original setting: the Sundered Banks.
// The battle plane is X/Z (y = 0). Heading h turns left as it grows; forward = [-sin h, 0, -cos h].

export const FACTIONS = {
  watch: {name: 'Harbor Watch', short: 'Watch', color: [0.4, 0.68, 1.0], start: 0.15, lawful: true},
  league: {name: 'Chandlers\' League', short: 'League', color: [0.98, 0.8, 0.34], start: 0.1},
  pennant: {name: 'Black Pennant', short: 'Pennant', color: [0.9, 0.22, 0.2], start: -0.7, outlaw: true},
};
export const HOSTILE_REP = -0.35, REFUSE_REP = -0.6, RESALE = 0.7;
export const atWar = (a, b) => (a === 'pennant') !== (b === 'pennant');

// Player hulls. cannons = guns per broadside. shield = strength of each of the four screens.
export const HULLS = {
  cutter: {name: 'Tern', cls: 'Cutter', price: 20000, hp: 900, shield: 230, cannons: 3, turrets: 2, cargo: 24, torps: 4, speed: 80, accel: 22, turn: 0.62, radius: 16, level: 1,
    blurb: 'Three guns a side and a stubborn little reactor. Every captain on the Banks began with one.'},
  corvette: {name: 'Marlin', cls: 'Corvette', price: 90000, hp: 1900, shield: 420, cannons: 5, turrets: 3, cargo: 44, torps: 6, speed: 72, accel: 18, turn: 0.5, radius: 22, level: 3,
    blurb: 'A proper warship in miniature: five-gun broadsides and room for a paying cargo.'},
  frigate: {name: 'Bulwark', cls: 'Frigate', price: 300000, hp: 3600, shield: 720, cannons: 8, turrets: 5, cargo: 70, torps: 8, speed: 64, accel: 15, turn: 0.4, radius: 30, level: 6,
    blurb: 'The Watch\'s line ship. Eight guns a side will settle most arguments.'},
  dreadnought: {name: 'Leviathan', cls: 'Dreadnought', price: 920000, hp: 7000, shield: 1250, cannons: 12, turrets: 7, cargo: 110, torps: 12, speed: 56, accel: 12, turn: 0.31, radius: 40, level: 9,
    blurb: 'Twelve guns a side. Stations lower their lights when one of these comes about.'},
};

// Broadside batteries: per-gun damage, shell speed, range, reload seconds, tightest cone (radians), price per gun.
export const BROADSIDES = {
  culverin: {name: 'Culverin Battery', dmg: 62, speed: 340, range: 660, reload: 3.6, cone: 0.045, price: 1500, color: [1.0, 0.72, 0.3], blurb: 'Honest all-round iron.'},
  longnine: {name: 'Long Nines', dmg: 80, speed: 420, range: 960, reload: 4.4, cone: 0.03, price: 5200, color: [0.6, 0.9, 1.0], blurb: 'Reach out past anything that can answer.'},
  carronade: {name: 'Carronade Battery', dmg: 155, speed: 300, range: 450, reload: 4.2, cone: 0.07, price: 7400, color: [1.0, 0.45, 0.2], blurb: 'Short, ugly and ruinous up close.'},
  stormlance: {name: 'Stormlance Battery', dmg: 128, speed: 500, range: 800, reload: 3.1, cone: 0.035, price: 16500, color: [0.75, 0.6, 1.0], blurb: 'Coil-driven lances. The best the yards build.'},
};
// Turrets fire on their own. blast > 0 bursts near small craft.
export const TURRETS = {
  pulse: {name: 'Pulse Turrets', dmg: 9, rate: 4.5, speed: 480, range: 380, blast: 0, price: 1800, color: [0.4, 0.95, 1.0], blurb: 'Fast point defence. Swats skiffs.'},
  flak: {name: 'Flak Turrets', dmg: 20, rate: 1.3, speed: 380, range: 430, blast: 46, price: 4600, color: [1.0, 0.85, 0.4], blurb: 'Bursting shells that shred whole wings.'},
  autocannon: {name: 'Autocannon Turrets', dmg: 34, rate: 1.7, speed: 420, range: 540, blast: 0, price: 5200, color: [1.0, 0.55, 0.3], blurb: 'Slow, heavy slugs for hulls and screens.'},
  heavypulse: {name: 'Heavy Pulse Turrets', dmg: 19, rate: 4.5, speed: 520, range: 460, blast: 0, price: 12500, color: [0.6, 1.0, 0.6], blurb: 'Twice the bite of the standard mount.'},
};
export const SHIELDS = [null, {name: 'Screen Mk I', mult: 1, regen: 0.05, price: 0}, {name: 'Screen Mk II', mult: 1.4, regen: 0.06, price: 14000},
  {name: 'Screen Mk III', mult: 1.9, regen: 0.07, price: 52000}, {name: 'Aegis Screen', mult: 2.5, regen: 0.085, price: 150000}];
export const DEFLECTORS = [null, {name: 'Deflector Mk I', seconds: 3, cut: 0.8, price: 0}, {name: 'Deflector Mk II', seconds: 4.5, cut: 0.88, price: 22000},
  {name: 'Deflector Mk III', seconds: 6, cut: 0.94, price: 80000}];
export const ENGINES = [null, {name: 'Stock Drive', mult: 1, price: 0}, {name: 'Tuned Drive', mult: 1.13, price: 18000}, {name: 'Racing Drive', mult: 1.27, price: 70000}];
export const ARMORS = [null, {name: 'Standard Plating', mult: 1, soak: 0, price: 0}, {name: 'Laminate Plating', mult: 1.25, soak: 3, price: 26000}, {name: 'Keelsteel Plating', mult: 1.55, soak: 6, price: 95000}];
export const TORPEDO = {name: 'Torpedo', dmg: 460, speed: 190, turn: 1.3, life: 14, blast: 60, price: 650, cooldown: 2.5};
export const UPGRADES = {shield: SHIELDS, deflector: DEFLECTORS, engine: ENGINES, armor: ARMORS};

export const GOODS = {
  water: {name: 'Fresh Water', price: 20}, grain: {name: 'Grain', price: 42}, ore: {name: 'Iron Ore', price: 58}, alloys: {name: 'Plate Alloys', price: 135},
  tools: {name: 'Machine Tools', price: 250}, medicine: {name: 'Medicine', price: 310}, spirits: {name: 'Banks Rum', price: 420}, arms: {name: 'Small Arms', price: 560},
  salvage: {name: 'Salvage', price: 90, found: true}, crystal: {name: 'Keel Crystal', price: 380, found: true},
};

// NPC vessels. kind 'craft' are small fast attackers; 'capital' fight with broadsides; 'hauler' run cargo.
export const VESSELS = {
  skate: {name: 'Skate', kind: 'craft', hp: 75, shield: 0, speed: 150, accel: 90, turn: 2.2, radius: 6, gun: {dmg: 7, rate: 3, speed: 440, range: 330}, bounty: 90},
  barracuda: {name: 'Barracuda Gunboat', kind: 'capital', hp: 430, shield: 95, cannons: 2, turrets: 1, speed: 96, accel: 30, turn: 0.95, radius: 12, battery: 'culverin', turret: 'pulse', bounty: 320},
  cutter: {name: 'Tern Cutter', kind: 'capital', hp: 760, shield: 190, cannons: 3, turrets: 2, speed: 78, accel: 22, turn: 0.6, radius: 16, battery: 'culverin', turret: 'pulse', bounty: 700},
  corvette: {name: 'Marlin Corvette', kind: 'capital', hp: 1550, shield: 340, cannons: 5, turrets: 3, speed: 70, accel: 18, turn: 0.5, radius: 22, battery: 'longnine', turret: 'autocannon', bounty: 1700},
  frigate: {name: 'Bulwark Frigate', kind: 'capital', hp: 2900, shield: 580, cannons: 8, turrets: 5, speed: 62, accel: 15, turn: 0.4, radius: 30, battery: 'carronade', turret: 'autocannon', bounty: 4200},
  dreadnought: {name: 'Leviathan Dreadnought', kind: 'capital', hp: 5600, shield: 1000, cannons: 12, turrets: 7, speed: 54, accel: 12, turn: 0.31, radius: 40, battery: 'stormlance', turret: 'heavypulse', bounty: 11000},
  drover: {name: 'Drover Hauler', kind: 'hauler', hp: 1300, shield: 240, cannons: 0, turrets: 2, speed: 58, accel: 14, turn: 0.4, radius: 26, turret: 'pulse', bounty: 0},
};
// Squadrons by threat 1..6: [vessel, count] pairs.
export const SQUADRONS = [null,
  [['skate', 3]], [['barracuda', 1], ['skate', 3]], [['cutter', 1], ['barracuda', 1], ['skate', 3]],
  [['corvette', 1], ['barracuda', 2], ['skate', 4]], [['frigate', 1], ['cutter', 2], ['skate', 5]], [['dreadnought', 1], ['corvette', 2], ['skate', 6]]];

const PILOT_A = ['Ada', 'Bram', 'Cass', 'Dov', 'Enna', 'Finch', 'Gull', 'Hob', 'Isk', 'Jory', 'Kit', 'Lune', 'Marr', 'Nell', 'Orrin', 'Pim', 'Quay', 'Roe', 'Sten', 'Tam', 'Ula', 'Vey', 'Wren', 'Yann'];
const PILOT_B = ['Ashdown', 'Brack', 'Coil', 'Dredge', 'Eddy', 'Fathom', 'Gaff', 'Harrow', 'Inch', 'Jib', 'Keel', 'Lash', 'Mizzen', 'Nock', 'Oar', 'Pitch', 'Quoin', 'Reef', 'Shoal', 'Tack', 'Undertow', 'Vang', 'Wake', 'Yard'];
export const captainName = rng => PILOT_A[Math.floor(rng() * PILOT_A.length)] + ' ' + PILOT_B[Math.floor(rng() * PILOT_B.length)];

// The Sundered Banks. pos is [x, z].
export const SECTOR = {
  name: 'The Sundered Banks', sun: {dir: [-0.55, 0.42, -0.72], color: [1.0, 0.86, 0.66]}, sky: [[0.55, 0.2, 0.08], [0.1, 0.25, 0.5], [0.35, 0.1, 0.35], [0.05, 0.3, 0.3]], root: 98,
  planets: [{pos: [9000, -11000, -30000], radius: 9000, palette: 'gas'}, {pos: [-42000, 5000, 30000], radius: 3600, palette: 'ice'}],
  stations: [
    {id: 'anchorage', name: 'Anchorage Prime', faction: 'watch', kind: 'citadel', pos: [0, 0], yard: ['cutter', 'corvette'], batteries: ['culverin', 'longnine'], turrets: ['pulse', 'flak'], tier: 2,
      about: 'The Watch flagship port, moored at the calm centre of the Banks. Its gun decks have not fired in anger for a generation.',
      makes: {water: 0.75, medicine: 0.8}, wants: {ore: 1.25, spirits: 1.35, alloys: 1.2},
      rumors: ['The Watch pays for every Pennant keel you break.', 'Tinder Works will sell you ore for nothing. The yards at Coldharbor pay double.']},
    {id: 'coldharbor', name: 'Coldharbor Exchange', faction: 'league', kind: 'exchange', pos: [22000, -14000], yard: ['corvette', 'frigate'], batteries: ['longnine', 'carronade'], turrets: ['autocannon', 'flak'], tier: 3,
      about: 'The League\'s counting-house. Whatever is scarce today is posted on the big board, and somebody is already sailing to sell it.',
      makes: {tools: 0.72, alloys: 0.8, arms: 0.85}, wants: {ore: 1.5, grain: 1.3, crystal: 1.4},
      rumors: ['Watch the shortage board. A famine is a fortune if your hold is full.', 'Keel Crystal grows in the Shatter Line. Crack the small rocks.']},
    {id: 'tinder', name: 'Tinder Works', faction: 'league', kind: 'works', pos: [-18000, -22000], yard: [], batteries: ['carronade'], turrets: ['pulse', 'autocannon'], tier: 2,
      about: 'A smelter chained to the edge of the Tinderbox. Miners here count their fingers after every shift.',
      makes: {ore: 0.5, alloys: 0.9}, wants: {water: 1.6, grain: 1.5, medicine: 1.45, tools: 1.35, spirits: 1.3},
      rumors: ['Your broadsides will crack a small rock as well as any drill.', 'The Drowned Fleet east of here is thick with Pennant ships.']},
    {id: 'lantern', name: 'Lantern Rock', faction: 'watch', kind: 'works', pos: [28000, 24000], yard: ['frigate', 'dreadnought'], batteries: ['stormlance', 'longnine'], turrets: ['heavypulse', 'flak'], tier: 4,
      about: 'The Watch\'s frontier bastion and the only yard that will lay down a dreadnought.',
      makes: {grain: 0.8}, wants: {arms: 1.5, medicine: 1.5, alloys: 1.45, water: 1.4, tools: 1.3},
      rumors: ['Lantern Rock never has enough guns. Arms sell here at a premium.']},
    {id: 'gallows', name: 'Gallows Reef', faction: 'pennant', kind: 'reef', pos: [-26000, 20000], yard: ['corvette'], batteries: ['carronade', 'stormlance'], turrets: ['autocannon', 'heavypulse'], tier: 4,
      about: 'A corsair haven lashed together from prizes. They will trade with anyone they are not presently hunting.',
      makes: {spirits: 0.55, salvage: 0.8}, wants: {arms: 1.6, medicine: 1.6, grain: 1.4, crystal: 1.5},
      rumors: ['Banks Rum is distilled here. Respectable ports pay very well for it.']},
  ],
  fields: [
    {name: 'The Tinderbox', kind: 'rocks', pos: [-13500, -18500], radius: 5200, density: 1},
    {name: 'Shatter Line', kind: 'rocks', pos: [11500, 13500], radius: 4600, density: 0.9, rich: true},
    {name: 'Drowned Fleet', kind: 'wrecks', pos: [-12000, 7000], radius: 6000, threat: 2},
    {name: 'Widow\'s Teeth', kind: 'wrecks', pos: [14000, -30000], radius: 5200, threat: 3},
    {name: 'The Long Dark', kind: 'wrecks', pos: [-2000, 32000], radius: 6500, threat: 4},
  ],
};
export const STATIONS = Object.fromEntries(SECTOR.stations.map(s => [s.id, s]));
export const START = 'anchorage';
export const MARKET_DAY = 420; // seconds of flight between market shifts

const hash = (a, b) => { let h = Math.imul(a + 0x9e3779b9, 2654435761) ^ Math.imul(b + 0x7f4a7c15, 2246822519); h = Math.imul(h ^ h >>> 15, 2246822519); return (h ^ h >>> 13) >>> 0; };
const TRADED = Object.keys(GOODS).filter(id => !GOODS[id].found);
/** The day's market upset at a station, or null. Deterministic for (seed, station, day). */
export function marketEvent(seed, stationId, day) {
  const index = SECTOR.stations.findIndex(s => s.id === stationId), h = hash(seed + day * 7919, index);
  if (h % 5 > 2) return null;
  const good = TRADED[(h >>> 4) % TRADED.length], shortage = (h >>> 9) % 2 === 0;
  return {good, mult: shortage ? 1.75 : 0.55, text: `${shortage ? 'Shortage' : 'Glut'} of ${GOODS[good].name}: prices ${shortage ? 'up 75%' : 'down 45%'}`};
}
/** Unit price at a station on a day, or null if the port does not trade the good. */
export function priceAt(station, goodId, seed = 0, day = 0) {
  const base = station.makes?.[goodId] ?? station.wants?.[goodId] ?? 1, event = marketEvent(seed, station.id, day);
  return Math.max(1, Math.round(GOODS[goodId].price * base * (event?.good === goodId ? event.mult : 1)));
}
export const stocks = (station, goodId) => Object.hasOwn(station.makes ?? {}, goodId) || (!GOODS[goodId].found && !Object.hasOwn(station.wants ?? {}, goodId));
