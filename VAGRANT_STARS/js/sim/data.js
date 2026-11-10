// SPDX-License-Identifier: Apache-2.0
// VAGRANT STARS — static universe data. Original setting: the Tessel Reach.
// Units: distance in metres-ish "u", speed u/s, +Y up, -Z forward (VANILLAJS frame).

export const FACTIONS = {
  wardens: {name: 'Concord Wardens', short: 'Wardens', color: [0.42, 0.68, 1.0], start: 0.15, lawful: true},
  halcyon: {name: 'Halcyon Freight Combine', short: 'Halcyon', color: [0.96, 0.8, 0.36], start: 0.1},
  ember: {name: 'Ember Syndics', short: 'Syndics', color: [1.0, 0.56, 0.24], start: 0.05},
  driftborn: {name: 'Driftborn', short: 'Driftborn', color: [0.45, 0.9, 0.68], start: 0.0},
  reavers: {name: 'Ashen Reavers', short: 'Reavers', color: [0.92, 0.26, 0.2], start: -0.7, outlaw: true},
  choir: {name: 'Null Choir', short: 'Choir', color: [0.76, 0.42, 0.98], start: -0.8, outlaw: true},
};

const FEUDS = [
  ['wardens', 'reavers'], ['wardens', 'choir'], ['halcyon', 'reavers'], ['halcyon', 'choir'],
  ['ember', 'reavers'], ['ember', 'choir'], ['driftborn', 'choir'], ['reavers', 'choir'],
];
const feudKeys = new Set(FEUDS.flatMap(([a, b]) => [a + '|' + b, b + '|' + a]));
export const factionsAtWar = (a, b) => feudKeys.has(a + '|' + b);
export const enemiesOf = id => FEUDS.filter(f => f.includes(id)).map(f => (f[0] === id ? f[1] : f[0]));

export const HOSTILE_REP = -0.35; // ships of a faction open fire below this
export const REFUSE_REP = -0.6;   // its ports refuse docking below this

export const HULLS = {
  sparrow: {name: 'Sparrow', cls: 'Light Fighter', price: 4200, hp: 380, cargo: 18, guns: 2, gunClass: 2, launchers: 1,
    shieldClass: 2, energy: 260, regen: 55, speed: 78, accel: 62, turn: 1.55, burn: 150, cruise: 340, radius: 6,
    kits: 6, level: 1, blurb: 'A cheap, honest two-gun courier hull. Every captain in the Reach started in one.'},
  mule: {name: 'Mule', cls: 'Light Freighter', price: 14500, hp: 820, cargo: 85, guns: 3, gunClass: 2, launchers: 0,
    shieldClass: 3, energy: 300, regen: 60, speed: 64, accel: 44, turn: 1.05, burn: 122, cruise: 320, radius: 9,
    kits: 10, level: 2, blurb: 'Boxy, stubborn and profitable. Carries nearly five Sparrow-loads.'},
  kite: {name: 'Kite', cls: 'Fighter', price: 33000, hp: 640, cargo: 28, guns: 3, gunClass: 3, launchers: 1,
    shieldClass: 3, energy: 380, regen: 82, speed: 84, accel: 72, turn: 1.75, burn: 162, cruise: 350, radius: 7,
    kits: 8, level: 4, blurb: 'Swept wings and a quick nose. The Wardens\' favourite patrol craft.'},
  bastion: {name: 'Bastion', cls: 'Heavy Fighter', price: 79000, hp: 1150, cargo: 42, guns: 4, gunClass: 4, launchers: 1,
    shieldClass: 4, energy: 520, regen: 105, speed: 76, accel: 58, turn: 1.4, burn: 148, cruise: 340, radius: 8.5,
    kits: 12, level: 6, blurb: 'Four hardpoints behind slab armour. Trades grace for staying power.'},
  caravel: {name: 'Caravel', cls: 'Heavy Freighter', price: 98000, hp: 1900, cargo: 240, guns: 4, gunClass: 3, launchers: 0,
    shieldClass: 4, energy: 480, regen: 90, speed: 58, accel: 36, turn: 0.85, burn: 112, cruise: 310, radius: 13,
    kits: 16, level: 6, blurb: 'A long-haul bulk carrier. Slow to turn, slower to kill.'},
  wraith: {name: 'Wraith', cls: 'Elite Interceptor', price: 215000, hp: 1500, cargo: 55, guns: 6, gunClass: 5, launchers: 1,
    shieldClass: 5, energy: 760, regen: 150, speed: 90, accel: 80, turn: 1.7, burn: 172, cruise: 360, radius: 8,
    kits: 14, level: 9, blurb: 'Six-gun frontier interceptor built at Last Light. Nothing in the Reach outfights it.'},
};

// dmg: hull damage per bolt; sh: shield damage per bolt; rate: shots/s; en: energy per shot.
export const GUNS = {
  pulse1: {name: 'Tern Pulse Laser', cls: 1, dmg: 14, sh: 14, rate: 4, en: 6, speed: 620, range: 620, color: [0.35, 0.9, 1.0], price: 600, sfx: 'pulse'},
  pulse2: {name: 'Heron Pulse Laser', cls: 2, dmg: 21, sh: 21, rate: 4, en: 9, speed: 640, range: 640, color: [0.35, 1.0, 0.75], price: 2400, sfx: 'pulse'},
  plasma1: {name: 'Kiln Plasma Caster', cls: 2, dmg: 46, sh: 34, rate: 1.6, en: 22, speed: 470, range: 700, color: [1.0, 0.55, 0.15], price: 3200, sfx: 'plasma'},
  ion1: {name: 'Static Ion Scatter', cls: 2, dmg: 8, sh: 36, rate: 3, en: 10, speed: 560, range: 560, color: [0.7, 0.45, 1.0], price: 2800, sfx: 'ion'},
  pulse3: {name: 'Osprey Pulse Laser', cls: 3, dmg: 31, sh: 31, rate: 4.2, en: 13, speed: 660, range: 660, color: [0.5, 1.0, 0.4], price: 7800, sfx: 'pulse'},
  plasma2: {name: 'Forge Plasma Caster', cls: 3, dmg: 72, sh: 52, rate: 1.6, en: 32, speed: 480, range: 720, color: [1.0, 0.42, 0.12], price: 9600, sfx: 'plasma'},
  ion2: {name: 'Tempest Ion Scatter', cls: 4, dmg: 14, sh: 64, rate: 3, en: 15, speed: 580, range: 580, color: [0.82, 0.5, 1.0], price: 16000, sfx: 'ion'},
  pulse4: {name: 'Condor Pulse Laser', cls: 4, dmg: 44, sh: 44, rate: 4.4, en: 18, speed: 680, range: 680, color: [1.0, 0.95, 0.4], price: 21000, sfx: 'pulse'},
  plasma3: {name: 'Crucible Plasma Caster', cls: 4, dmg: 108, sh: 78, rate: 1.5, en: 46, speed: 490, range: 740, color: [1.0, 0.3, 0.2], price: 26000, sfx: 'plasma'},
  lance: {name: 'Solar Lance', cls: 5, dmg: 70, sh: 70, rate: 3.6, en: 30, speed: 760, range: 800, color: [1.0, 0.92, 0.75], price: 58000, sfx: 'lance'},
};

export const LAUNCHERS = {
  wasp: {name: 'Wasp Seeker Rack', price: 3500, ammoPrice: 120, dmg: 170, blast: 30, speed: 235, turn: 1.9, life: 9, cooldown: 1.4, ammoMax: 20},
  hornet: {name: 'Hornet Heavy Rack', price: 18000, ammoPrice: 420, dmg: 430, blast: 42, speed: 215, turn: 1.5, life: 10, cooldown: 2.2, ammoMax: 12},
};

export const SHIELDS = {
  s1: {name: 'Bulwark Mk I', cls: 1, cap: 180, regen: 14, price: 900},
  s2: {name: 'Bulwark Mk II', cls: 2, cap: 380, regen: 24, price: 3600},
  s3: {name: 'Rampart Screen', cls: 3, cap: 640, regen: 38, price: 11000},
  s4: {name: 'Citadel Screen', cls: 4, cap: 1000, regen: 55, price: 29000},
  s5: {name: 'Aegis Lattice', cls: 5, cap: 1500, regen: 80, price: 68000},
};

export const CONSUMABLES = {
  kit: {name: 'Hull Patch', price: 140, restore: 0.35},
  cell: {name: 'Shield Cell', price: 110, restore: 0.6},
};

export const GOODS = {
  water: {name: 'Water Ice', price: 22},
  provisions: {name: 'Provisions', price: 48},
  rawore: {name: 'Raw Ore', price: 60},
  fuel: {name: 'Fuel Cells', price: 95},
  alloys: {name: 'Hull Alloys', price: 130},
  medgel: {name: 'Med Gel', price: 210},
  machinery: {name: 'Machine Parts', price: 260},
  textiles: {name: 'Loomsilk', price: 330},
  optics: {name: 'Lattice Optics', price: 420},
  cores: {name: 'Reactor Cores', price: 880},
  glint: {name: 'Glint', price: 640, contraband: true},
  relics: {name: 'Choir Relics', price: 1150, contraband: true},
};

export const RESALE = 0.7; // equipment and hull trade-in fraction

// NPC loadouts by threat tier.
export const TIERS = [
  null,
  {hull: 'sparrow', gun: 'pulse1', shield: 's1', skill: 0.35},
  {hull: 'kite', gun: 'pulse2', shield: 's2', skill: 0.5},
  {hull: 'kite', gun: 'pulse3', shield: 's3', skill: 0.62},
  {hull: 'bastion', gun: 'pulse4', shield: 's4', skill: 0.74},
  {hull: 'wraith', gun: 'lance', shield: 's5', skill: 0.85},
];

const PILOT_A = ['Ash', 'Bren', 'Cale', 'Dara', 'Esk', 'Fenn', 'Garr', 'Hale', 'Ilse', 'Joss', 'Kell', 'Lorn', 'Mara', 'Nix', 'Oda', 'Pell', 'Quill', 'Rhea', 'Sable', 'Tov', 'Una', 'Vex', 'Wynn', 'Yara', 'Zeph'];
const PILOT_B = ['Arrow', 'Brand', 'Cinder', 'Dusk', 'Ember', 'Frost', 'Gale', 'Hollow', 'Iron', 'Jade', 'Kestrel', 'Lark', 'Moth', 'North', 'Onyx', 'Pike', 'Quarry', 'Rook', 'Slate', 'Thorn', 'Umber', 'Vane', 'Wick', 'Yew'];
export const pilotName = rng => PILOT_A[Math.floor(rng() * PILOT_A.length)] + ' ' + PILOT_B[Math.floor(rng() * PILOT_B.length)];

const base = (id, name, faction, kind, pos, extra) => ({id, name, faction, kind, pos, ...extra});

export const SYSTEMS = {
  meridian: {
    name: 'Meridian', danger: 1, blurb: 'The settled heart of the Reach. Warden patrols keep the rails safe.',
    star: {color: [1.0, 0.92, 0.72], radius: 9000, pos: [-62000, 14000, -78000]}, sky: [[0.12, 0.2, 0.5], [0.3, 0.12, 0.4], [0.05, 0.3, 0.35]], root: 110,
    map: [0, 0],
    planets: [{name: 'Calder', pos: [16500, -500, 6500], radius: 2600, palette: 'ocean'},
      {name: 'Vane', pos: [-26000, 2500, -24000], radius: 1500, palette: 'rust'}],
    bases: [
      base('calder', 'Calder Orbital Dock', 'halcyon', 'dockring', [12400, 0, 4700], {
        about: 'The busiest dock in the Reach hangs over blue Calder. Halcyon brokers will sell you a hull and a dream.',
        sells: {medgel: 0.75, machinery: 0.85, provisions: 0.95, water: 1.0}, pays: {alloys: 1.3, optics: 1.25, textiles: 1.4},
        outfit: ['pulse1', 'pulse2', 's1', 's2', 'wasp'], ships: ['sparrow', 'mule'],
        rumors: ['Med Gel from the Calder clinics fetches a fine price out at Cinder Rock.', 'Brightwater Yard pays well for raw ore. They are always building.']}),
      base('tollard', 'Tollard Station', 'wardens', 'ring', [9000, 300, -9000], {
        about: 'Warden headquarters for the inner Reach. Clean decks, strict customs, steady contracts.',
        sells: {fuel: 1.05, provisions: 1.05}, pays: {provisions: 1.25, fuel: 1.3, optics: 1.3, cores: 1.25},
        outfit: ['pulse2', 'ion1', 's2', 's3', 'wasp'], ships: ['kite'],
        rumors: ['Wardens pay a standing bounty on every Reaver you burn down.', 'Carry Glint past a patrol and they will impound the lot.']}),
      base('brightwater', 'Brightwater Yard', 'halcyon', 'yard', [-7000, -200, 14000], {
        about: 'Halcyon\'s shipyard. Half-built freighters drift in the gantries like whale bones.',
        sells: {machinery: 0.7, alloys: 0.8, cores: 0.85}, pays: {rawore: 1.5, optics: 1.35},
        outfit: ['pulse2', 'plasma1', 'pulse3', 's3'], ships: ['mule', 'kite', 'caravel', 'bastion'],
        rumors: ['Machine Parts are cheap here and dear on any farm world.', 'Lantern Deep grinds the best optics in the Reach, if you can reach it.']}),
    ],
    gates: [{id: 'g-kessa', to: 'kessa', pos: [-20000, 0, -6000]}, {id: 'g-ostrava', to: 'ostrava', pos: [22000, 0, 20000]}],
    lanes: [['tollard', 'calder'], ['calder', 'g-ostrava'], ['tollard', 'g-kessa'], ['calder', 'brightwater']],
    zones: [{name: 'Shepherd Rocks', kind: 'rocks', pos: [-6000, 0, -1000], radius: 3600, density: 0.45}],
    traffic: {halcyon: 5, wardens: 4, driftborn: 1, reavers: 1},
  },
  kessa: {
    name: 'Kessa', danger: 2, blurb: 'An orange star over two rich belts. Syndic miners, Halcyon haulers and Reaver jackals.',
    star: {color: [1.0, 0.68, 0.4], radius: 11000, pos: [70000, 9000, 66000]}, sky: [[0.5, 0.22, 0.08], [0.35, 0.1, 0.12], [0.15, 0.15, 0.4]], root: 98,
    map: [-1.1, -0.5],
    planets: [{name: 'Kessa II', pos: [21000, 1600, -17000], radius: 4200, palette: 'gas'}],
    bases: [
      base('cinder', 'Cinder Rock', 'ember', 'rockbase', [-4200, 200, 11200], {
        about: 'A hollowed asteroid smelter deep in the Grindstone. It smells of hot metal and cheap stew.',
        sells: {rawore: 0.55, alloys: 0.9}, pays: {water: 1.6, provisions: 1.5, medgel: 1.4, machinery: 1.4},
        outfit: ['plasma1', 'plasma2', 's2'], ships: [],
        rumors: ['Raw Ore is nearly free here. Haul it anywhere with a foundry.', 'Reavers nest in Slagfall, west of the Vesper rail.']}),
      base('vesper', 'Port Vesper', 'halcyon', 'spindle', [10000, 0, -5000], {
        about: 'A Halcyon refinery spindle skimming fuel from Kessa II. The crossroads of the middle Reach.',
        sells: {fuel: 0.7, alloys: 0.7}, pays: {water: 1.2, rawore: 1.25, textiles: 1.3},
        outfit: ['plasma1', 'ion1', 'pulse3', 's3'], ships: ['mule'],
        rumors: ['Vesper fuel sells high at every frontier post.', 'The gate to Thule is quiet lately. Too quiet.']}),
    ],
    gates: [{id: 'g-meridian', to: 'meridian', pos: [18500, 0, 8500]}, {id: 'g-thule', to: 'thule', pos: [-19000, 0, -9500]},
      {id: 'g-ostrava', to: 'ostrava', pos: [2500, 0, 22500]}],
    lanes: [['vesper', 'g-meridian'], ['vesper', 'g-thule'], ['vesper', 'cinder'], ['cinder', 'g-ostrava']],
    zones: [{name: 'The Grindstone', kind: 'rocks', pos: [-5200, 0, 12200], radius: 5200, density: 0.9},
      {name: 'Slagfall', kind: 'rocks', pos: [-12500, 0, -2500], radius: 4000, density: 0.7, lair: 'reavers'}],
    traffic: {halcyon: 3, ember: 3, wardens: 2, reavers: 4},
  },
  ostrava: {
    name: 'Ostrava', danger: 1.5, blurb: 'Green Ostrava Prime feeds half the Reach. Its granaries are worth raiding.',
    star: {color: [0.85, 0.92, 1.0], radius: 8000, pos: [58000, 22000, -80000]}, sky: [[0.08, 0.3, 0.22], [0.1, 0.18, 0.45], [0.3, 0.3, 0.1]], root: 123,
    map: [0.9, 0.95],
    planets: [{name: 'Ostrava Prime', pos: [-14500, -600, -8500], radius: 3000, palette: 'garden'}],
    bases: [
      base('prime', 'Ostrava Landing', 'driftborn', 'dockring', [-10600, 0, -6400], {
        about: 'A farmers\' co-op dock above the green world. Driftborn families have run it for six generations.',
        sells: {provisions: 0.6, water: 0.7, textiles: 0.7}, pays: {machinery: 1.35, fuel: 1.25},
        outfit: ['pulse1', 'pulse2', 's2'], ships: ['sparrow', 'mule'],
        rumors: ['Loomsilk from Prime sells for a small fortune on Calder.', 'The Hollow gate is watched. Fly armed.']}),
      base('granary', 'Granary Nine', 'halcyon', 'depot', [8000, 0, 9000], {
        about: 'A Halcyon bulk depot. Silo after silo of grain, and a quiet arms counter in the back.',
        sells: {provisions: 0.65}, pays: {rawore: 1.2, machinery: 1.3},
        outfit: ['pulse3', 'plasma2', 's3', 's4'], ships: ['caravel'],
        rumors: ['Provisions bought here double in price by the time they reach Last Light.']}),
    ],
    gates: [{id: 'g-meridian', to: 'meridian', pos: [-21500, 0, 12500]}, {id: 'g-kessa', to: 'kessa', pos: [5000, 0, -21500]},
      {id: 'g-hollow', to: 'hollow', pos: [23000, 0, -2000]}],
    lanes: [['prime', 'g-meridian'], ['prime', 'granary'], ['granary', 'g-hollow'], ['prime', 'g-kessa']],
    zones: [{name: 'Chaff Belt', kind: 'rocks', pos: [14500, 0, -10500], radius: 4400, density: 0.55, lair: 'reavers'}],
    traffic: {halcyon: 5, driftborn: 3, wardens: 3, reavers: 2},
  },
  thule: {
    name: 'Thule', danger: 3, blurb: 'A cold blue star and a frozen world. The Shroud nebula hides the Reavers\' den.',
    star: {color: [0.7, 0.85, 1.0], radius: 6500, pos: [-80000, 16000, 60000]}, sky: [[0.1, 0.25, 0.55], [0.2, 0.4, 0.5], [0.3, 0.15, 0.45]], root: 87,
    map: [-2.2, 0.35],
    planets: [{name: 'Thule', pos: [15500, 900, 16500], radius: 3400, palette: 'ice'}],
    bases: [
      base('frostline', 'Frostline Outpost', 'driftborn', 'outpost', [6000, 0, 7000], {
        about: 'Ice cutters and drifters share one cramped ring. Nobody asks what is in your hold.',
        sells: {water: 0.5}, pays: {provisions: 1.5, fuel: 1.4, alloys: 1.35, medgel: 1.4, glint: 1.4},
        outfit: ['ion1', 'ion2', 'plasma2', 's3', 'hornet'], ships: [],
        rumors: ['Water Ice costs nothing here. Cinder Rock is always thirsty.', 'There is a Reaver port in the Shroud that will trade with anyone they have not sworn to kill.']}),
      base('wren', 'Wren\'s Hollow', 'reavers', 'rockbase', [-13200, -600, -11200], {
        about: 'The Ashen Reavers\' den, welded into a dead comet. Leave your principles at the lock.',
        sells: {glint: 0.55}, pays: {provisions: 1.6, medgel: 1.7, textiles: 1.3, relics: 1.4},
        outfit: ['plasma2', 'plasma3', 'ion2', 's4', 'hornet'], ships: ['bastion'],
        rumors: ['Glint is cheap at the source. Scrapline and Frostline pay for it without questions.']}),
    ],
    gates: [{id: 'g-kessa', to: 'kessa', pos: [20500, 0, -4500]}, {id: 'g-veil', to: 'veil', pos: [-6000, 0, 21500]}],
    lanes: [['frostline', 'g-kessa'], ['frostline', 'g-veil']],
    zones: [{name: 'The Shroud', kind: 'nebula', pos: [-12500, 0, -10500], radius: 7000, density: 0.5, lair: 'reavers'},
      {name: 'Shroud Rocks', kind: 'rocks', pos: [-12800, 0, -10800], radius: 3200, density: 0.6, lair: 'reavers'}],
    traffic: {driftborn: 3, halcyon: 1, wardens: 1, reavers: 6},
  },
  hollow: {
    name: 'Hollow', danger: 3.5, blurb: 'A dim red ember ringed by the wreckage of an older war. Salvagers and stranger things.',
    star: {color: [1.0, 0.42, 0.3], radius: 7000, pos: [84000, -12000, 52000]}, sky: [[0.4, 0.08, 0.08], [0.25, 0.1, 0.3], [0.1, 0.1, 0.2]], root: 82,
    map: [2.1, 0.2],
    planets: [{name: 'Cairn', pos: [-20000, -1200, -19000], radius: 2200, palette: 'rust'}],
    bases: [
      base('lantern', 'Lantern Deep', 'halcyon', 'spindle', [11000, -200, -8000], {
        about: 'A Halcyon research spindle listening to the dark. Its optics lab is the finest in the Reach.',
        sells: {optics: 0.65, medgel: 0.8, cores: 0.8}, pays: {alloys: 1.45, provisions: 1.4, relics: 1.6},
        outfit: ['pulse4', 'ion2', 's4', 's5'], ships: [],
        rumors: ['The researchers pay absurd sums for Choir Relics, and pretend they do not.', 'Lattice Optics from this lab sell well at Brightwater and Tollard.']}),
      base('scrapline', 'Scrapline', 'driftborn', 'yard', [-9000, 300, 9000], {
        about: 'A salvage yard strung through the Boneyard. Everything here has been owned before.',
        sells: {rawore: 0.7, alloys: 0.85}, pays: {water: 1.5, fuel: 1.45, machinery: 1.3, glint: 1.5, relics: 1.35},
        outfit: ['plasma3', 'pulse4', 's4', 'wasp', 'hornet'], ships: ['bastion'],
        rumors: ['Choir ships carry relics. Burn one down and sweep up what is left.']}),
    ],
    gates: [{id: 'g-ostrava', to: 'ostrava', pos: [-22500, 0, -5000]}, {id: 'g-veil', to: 'veil', pos: [16500, 0, 18500]}],
    lanes: [['lantern', 'g-ostrava'], ['lantern', 'g-veil']],
    zones: [{name: 'The Boneyard', kind: 'rocks', pos: [-9200, 0, 8600], radius: 5000, density: 0.75, lair: 'reavers'},
      {name: 'Emberhaze', kind: 'nebula', pos: [3000, 0, 14000], radius: 6000, density: 0.35, lair: 'choir'}],
    traffic: {driftborn: 2, halcyon: 2, wardens: 1, reavers: 4, choir: 3},
  },
  veil: {
    name: 'Veil', danger: 5, blurb: 'The edge of the charts. The Null Choir sings here, and the Wardens hold one last light.',
    star: {color: [0.85, 0.7, 1.0], radius: 5500, pos: [60000, 26000, 82000]}, sky: [[0.35, 0.12, 0.55], [0.12, 0.1, 0.5], [0.5, 0.15, 0.35]], root: 73,
    map: [0.2, 2.1],
    planets: [{name: 'Hush', pos: [-23000, 1500, 4000], radius: 3600, palette: 'violet'}],
    bases: [
      base('lastlight', 'Last Light', 'wardens', 'ring', [5000, 0, -6000], {
        about: 'The Wardens\' forward bastion. Everything is rationed except ammunition.',
        sells: {}, pays: {provisions: 1.8, water: 1.7, alloys: 1.6, fuel: 1.5, medgel: 1.55, cores: 1.4},
        outfit: ['pulse4', 'plasma3', 'lance', 's5', 'hornet'], ships: ['wraith'],
        rumors: ['Anything you can haul out here sells. The garrison is starving for supply.']}),
      base('reliquary', 'The Reliquary', 'choir', 'spindle', [-15000, 500, 12000], {
        about: 'The Null Choir\'s cathedral-station. Its halls hum with a note just below hearing.',
        sells: {relics: 0.5}, pays: {cores: 1.5, glint: 1.3},
        outfit: ['lance', 's5'], ships: [],
        rumors: ['The Choir trades with those it has not yet judged.']}),
    ],
    gates: [{id: 'g-thule', to: 'thule', pos: [20500, 0, -14500]}, {id: 'g-hollow', to: 'hollow', pos: [18500, 0, 14500]}],
    lanes: [['lastlight', 'g-thule'], ['lastlight', 'g-hollow']],
    zones: [{name: 'The Hush', kind: 'nebula', pos: [-12500, 0, 10500], radius: 9000, density: 0.45, lair: 'choir'},
      {name: 'Psalm Stones', kind: 'rocks', pos: [-6000, 0, 3000], radius: 3600, density: 0.5, lair: 'choir'}],
    traffic: {wardens: 2, halcyon: 1, reavers: 2, choir: 7},
  },
};

export const START = {system: 'meridian', base: 'calder'};

// Resolved lookups -------------------------------------------------------------------------
export const BASES = {};
for (const [sid, sys] of Object.entries(SYSTEMS)) {
  sys.id = sid;
  for (const b of sys.bases) { b.system = sid; BASES[b.id] = b; }
  for (const g of sys.gates) { g.system = sid; g.name = `Fold Gate: ${SYSTEMS[g.to].name}`; }
}

/** Price of one unit at a base, or null when that port does not trade the good. */
export function priceAt(baseDef, goodId) {
  const good = GOODS[goodId];
  const mult = baseDef.sells?.[goodId] ?? baseDef.pays?.[goodId] ?? (good.contraband ? null : 1);
  return mult === null ? null : Math.max(1, Math.round(good.price * mult));
}
export const stocks = (baseDef, goodId) => Object.hasOwn(baseDef.sells ?? {}, goodId);

/** Breadth-first gate route between systems; returns the list of system ids after `from`. */
export function routeBetween(from, to) {
  if (from === to) return [];
  const prev = new Map([[from, null]]), queue = [from];
  while (queue.length) {
    const at = queue.shift();
    for (const g of SYSTEMS[at].gates) {
      if (prev.has(g.to)) continue;
      prev.set(g.to, at);
      if (g.to === to) {
        const path = [to];
        for (let p = at; p !== from; p = prev.get(p)) path.unshift(p);
        return path;
      }
      queue.push(g.to);
    }
  }
  return null;
}
