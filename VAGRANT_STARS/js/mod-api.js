// SPDX-License-Identifier: Apache-2.0
// Offline Mod API v1. Kept byte-identical in both standalone game folders.
export const MOD_API_VERSION = 1;
const ID = /^[a-z][a-z0-9-]{0,47}$/;
const validId = v => typeof v === 'string' && ID.test(v) && !['constructor', 'prototype'].includes(v);
const own = (o, k) => Object.hasOwn(o, k);
const check = (ok, message) => { if (!ok) throw new TypeError(`Mod API: ${message}`); };
const text = (v, max = 200) => typeof v === 'string' && v.length > 0 && v.length <= max;
export function validatePack(pack) {
  check(pack?.api === MOD_API_VERSION, 'unsupported API version');
  check(validId(pack.id) && pack.id !== 'vanilla', 'invalid/reserved pack id');
  check(/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(pack.version), 'version must be major.minor.patch');
  check(text(pack.title) && text(pack.description, 600) && typeof pack.install === 'function', 'pack needs title, description and install(api)');
  const ids = new Set(['campaign']);
  check(Array.isArray(pack.modes ?? []) && (pack.modes ?? []).length <= 16, 'at most 16 modes');
  for (const mode of pack.modes ?? []) {
    check(validId(mode.id) && !ids.has(mode.id) && text(mode.title) && text(mode.description, 600), 'invalid/duplicate mode'); ids.add(mode.id);
    for (const hook of ['newPlayer', 'onWorld', 'onStep']) check(mode[hook] === undefined || typeof mode[hook] === 'function', `invalid ${hook} hook`);
  }
  return pack;
}

/** JSON-only persistent extension state: no prototypes, non-finite numbers or huge payloads. */
export function validModState(value) {
  try {
    let nodes = 0;
    const visit = (v, depth) => {
      if (++nodes > 8192 || depth > 12) return false;
      if (v === null || typeof v === 'boolean') return true;
      if (typeof v === 'number') return Number.isFinite(v);
      if (typeof v === 'string') return v.length <= 8192;
      if (Array.isArray(v)) return v.length <= 1024 && v.every(x => visit(x, depth + 1));
      return v && Object.getPrototypeOf(v) === Object.prototype && Object.entries(v).every(([k, x]) => !['__proto__', 'prototype', 'constructor'].includes(k) && visit(x, depth + 1));
    };
    return !!visit(value, 0) && JSON.stringify(value).length <= 65536;
  } catch { return false; }
}

export function validateSound(lanes) {
  check(Array.isArray(lanes) && lanes.length > 0 && lanes.length <= 4, 'sound needs 1–4 lanes');
  for (const lane of lanes) {
    check(Array.isArray(lane) && lane.length > 0 && lane.length <= 128, 'invalid sound lane');
    let duration = 0, events = 0;
    for (const segment of lane) {
      check(Array.isArray(segment) && (segment.length === 5 || segment.length === 6), 'invalid sound segment');
      const [wave, from, to, ms, gain, steps = 1] = segment;
      check(['square', 'triangle', 'saw', 'noise', 'rest'].includes(wave), 'unknown sound waveform');
      check([from, to, ms, gain, steps].every(Number.isFinite) && from >= 0 && from <= 20000 && to >= 0 && to <= 20000 && ms >= 1 && gain >= 0 && gain <= 12000 && Number.isInteger(steps) && steps >= 1 && steps <= 128, 'invalid sound values');
      duration += ms; events += steps;
    }
    check(duration <= 10000 && events <= 512, 'sound exceeds 10 seconds / 512 events per lane');
  }
  return structuredClone(lanes);
}

export function validateModel(model, context) {
  const n = model?.tris?.length / 9;
  check(Number.isInteger(n) && n > 0 && n <= 20000, 'model needs 1–20000 triangles');
  check(model.count === n && Number.isFinite(model.radius) && model.radius > 0 && model.radius <= 100000, 'invalid model count/radius');
  for (const [key, length] of [['tris', n * 9], ['normals', n * 3], ['colors', n * 3], ['glow', n]]) {
    check(model[key]?.length === length && Array.from(model[key]).every(Number.isFinite), `invalid model ${key}`);
  }
  check(Array.from(model.tris).every(v => Math.abs(v) <= 100000) && Array.from(model.colors).every(v => v >= 0 && v <= 1) && Array.from(model.glow).every(v => v >= 0 && v <= 1), 'model coordinates/colours out of range');
  const points = (p, size, min) => Array.isArray(p) && p.length >= min && p.length <= 128 && p.every(a => Array.isArray(a) && a.length === size && a.every(Number.isFinite));
  check(points(model.engines, 4, 1) && model.engines.every(p => p[3] > 0), 'ship needs engine hardpoints [x,y,z,radius]');
  if (context.game === 'vagrant') check(points(model.muzzles, 3, context.guns ?? 1), 'ship needs enough muzzle hardpoints');
  else {
    check(points(model.ports?.port, 3, context.cannons) && points(model.ports?.star, 3, context.cannons), 'ship needs both broadside hardpoint arrays');
    check(points(model.mounts, 3, context.turrets), 'ship needs turret mounts');
  }
  return model;
}

export class ModRuntime {
  constructor() {
    this.pack = null; this.mode = null; this.profile = ''; this.game = '';
    this.missions = []; this.types = new Map(); this.models = new Map(); this.aliases = new Map(); this.sounds = new Map(); this.cache = new Map();
    this.worldHooks = []; this.stepHooks = [];
  }
  activate(pack, adapter, modeId = 'campaign') {
    check(!this.pack, 'activate once per page; reload to switch profiles');
    validatePack(pack);
    const mode = modeId === 'campaign' ? {id: 'campaign', title: 'Campaign', description: 'Original campaign with this pack.'} : pack.modes?.find(m => m.id === modeId);
    check(mode, `unknown mode ${modeId}`);
    this.pack = pack; this.mode = mode; this.game = adapter.game; this.adapter = adapter;
    this.profile = `${pack.id}@${pack.version}/${mode.id}`;
    const unique = (map, id, value) => { check(validId(id) && !map.has(id), `invalid/duplicate asset ${id}`); map.set(id, value); };
    const api = {
      version: MOD_API_VERSION, game: this.game, catalogs: adapter.catalogs,
      extend: (table, id, parent, patch) => {
        const catalog = adapter.catalogs[table];
        check(catalog && validId(id) && own(catalog, parent) && validModState(patch) && !Array.isArray(patch) && patch !== null, 'invalid catalog extension');
        const record = {...structuredClone(catalog[parent]), ...structuredClone(patch)};
        if (own(catalog, id)) Object.assign(catalog[id], record); else catalog[id] = record;
        if (['hulls', 'vessels'].includes(table) && id !== parent) this.aliases.set(id, this.aliases.get(parent) ?? parent);
        return record;
      },
      missions: {
        type: (id, handler) => {
          check(validId(id) && typeof handler?.validate === 'function' && typeof handler.objective === 'function' && typeof handler.step === 'function', 'mission type needs validate, objective and step');
          const kind = `mod:${pack.id}:${id}`; check(!this.types.has(kind), 'duplicate mission type'); this.types.set(kind, handler); return kind;
        },
        add: mission => {
          check(this.missions.length < 128 && validId(mission?.id) && !this.missions.some(m => m.id === mission.id), 'invalid/duplicate mission id');
          check(validModState(mission), 'mission must be bounded JSON data');
          this.missions.push(structuredClone(mission));
        },
      },
      assets: {
        ship: (id, factory) => { check(typeof factory === 'function', 'model needs a factory'); unique(this.models, id, factory); },
        sound: (id, lanes) => { check(this.sounds.size < 32, 'at most 32 custom sounds'); unique(this.sounds, id, validateSound(lanes)); },
      },
      onWorld: fn => { check(typeof fn === 'function', 'onWorld needs a function'); this.worldHooks.push(fn); },
      onStep: fn => { check(typeof fn === 'function', 'onStep needs a function'); this.stepHooks.push(fn); },
    };
    pack.install(api);
    for (const m of this.missions) {
      check(text(m.title) && text(m.text, 4000) && text(m.done, 4000) && Number.isSafeInteger(m.reward) && m.reward >= 0 && m.reward <= 1e7, 'invalid mission text/reward');
      check(m.repeatable === undefined || typeof m.repeatable === 'boolean', 'repeatable must be boolean');
      check(m.minLevel === undefined || Number.isInteger(m.minLevel) && m.minLevel >= 1 && m.minLevel <= 100, 'invalid mission rank');
      adapter.validateMission(m, this.types.get(m.kind));
      if (this.types.has(m.kind)) check(this.types.get(m.kind).validate(m), `invalid custom mission ${m.id}`);
    }
    adapter.validate?.(this);
    return this;
  }
  saveKey(base) { return this.pack ? `${base}.mod.${this.profile}` : base; }
  newPlayer(player) {
    if (!this.pack) return player;
    player.modProfile = this.profile; player.modState = {completed: [], mode: {}};
    this.mode.newPlayer?.(player, this.adapter.catalogs);
    check(this.validSave(player), 'mode produced invalid extension save state');
    return player;
  }
  validSave(player) {
    if (!this.pack) return player.modProfile === undefined && player.modState === undefined;
    const state = player.modState;
    return player.modProfile === this.profile && validModState(state) && Array.isArray(state?.completed) && state.completed.length <= 128 && state.completed.every(id => this.missions.some(m => m.id === id)) && state.mode && typeof state.mode === 'object' && !Array.isArray(state.mode);
  }
  jobsAt(player, port, level) {
    return this.missions.filter(m => m.at === port && (m.repeatable || !player.modState?.completed?.includes(m.id))).map(m => ({...structuredClone(m), id: `mod:${this.pack.id}:${m.id}`, modMission: m.id, locked: level < (m.minLevel ?? 1) ? `Requires rank ${m.minLevel}.` : null}));
  }
  completed(player, mission) {
    if (!mission.modMission || !this.pack) return;
    player.modState ??= {completed: [], mode: {}};
    if (!player.modState.completed.includes(mission.modMission)) player.modState.completed.push(mission.modMission);
  }
  validMission(mission) {
    if (!mission) return true;
    const handler = this.custom(mission.kind);
    if (!mission.modMission && !handler) return true;
    try {
      if (!this.pack || !validModState(mission) || !this.missions.some(m => m.id === mission.modMission && m.kind === mission.kind)) return false;
      this.adapter.validateMission(mission, handler);
      return !handler || handler.validate(mission) === true;
    } catch { return false; }
  }
  custom(kind) { return this.types.get(kind); }
  startWorld(world) {
    if (!this.pack || world.modded === false) return;
    for (const fn of this.worldHooks) fn(world);
    this.mode.onWorld?.(world);
  }
  step(world, dt) {
    if (!this.pack || world.modded === false || world.over || world.docked) return;
    for (const fn of this.stepHooks) fn(world, dt);
    this.mode.onStep?.(world, dt);
  }
  model(id, context, fallback) {
    const factory = this.models.get(id), alias = this.aliases.get(id);
    if (!factory && !alias) return fallback();
    const key = JSON.stringify([id, context.trim, context.cannons, context.turrets, context.guns]);
    if (!this.cache.has(key)) this.cache.set(key, validateModel(factory ? factory(context) : context.base(alias), {...context, game: this.game}));
    return this.cache.get(key);
  }
}
export const mods = new ModRuntime();

/** Registry is an explicit local allowlist. Unknown profiles stop boot, never fall back to a save. */
export function activateRegistry(registry, adapter, search, runtime = mods) {
  const ids = new Set();
  for (const pack of registry) { validatePack(pack); check(!ids.has(pack.id), 'duplicate pack id'); ids.add(pack.id); }
  const params = new URLSearchParams(search), id = params.get('mod'), mode = params.get('mode') ?? 'campaign';
  if (!id || id === 'vanilla') { check(mode === 'campaign', 'custom mode needs a pack'); return runtime; }
  const pack = registry.find(p => p.id === id); check(pack, `unknown installed pack ${id}`);
  return runtime.activate(pack, adapter, mode);
}
