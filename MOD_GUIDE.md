# Make the Reach and the Banks your own

**This is not a product. This is INDEPENDENCE.**

[INDEPENDENCE](https://github.com/QSOLKCB/INDEPENDENCE) · [VANILLAJS](https://github.com/QSOLKCB/VANILLAJS) · [Build your own offline game](HOW_TO_MAKE_OFFLINE_GAMES.md)

Both games ship their source, engine modules and working local mod packs. You can add missions, write new mission rules, change ships and equipment, replace geometry and effects, create modes, or fork the entire game. There is no account, hosted workshop, paid SDK or build service.

## Try a working pack

1. Download/clone this repository and serve its root over local HTTP. For example, `uv run --no-project python -m http.server 8080 --bind 127.0.0.1` (or use `python3` directly). Open `http://127.0.0.1:8080/`. ES modules need HTTP; double-clicking `index.html` is insufficient.
2. Open either game, choose **Mods & modes**, then **Independence Kit — Campaign**, **Independent explorer**, or **Three-wave proving ground**.
3. Create a captain in that profile. Campaign adds the Liberty to the home shipyard and two jobs to the board. Explorer starts in the Liberty, with ambient traffic disabled but board contracts intact. Arena starts in the Liberty and launches three waves, repairs the hull between rounds and pays 6,000 cr once. Dock to save the prize. Unfinished arena runs restart on launch.
4. The home ports are **Calder Orbital Dock** in VAGRANT STARS and **Anchorage Prime** in IRONWAKE. Accept **Independent cartographers: first survey**, reach the marker, and remain within 250u for eight seconds. Leaving the radius resets the scan. **Open hardware delivery** is a repeatable native freight contract.

The menu supports mouse, keyboard and the existing controller controls: D-pad, A to choose, B to return. Equivalent URLs are `VAGRANT_STARS/?mod=independence-kit&mode=explorer` and `IRONWAKE/?mod=independence-kit&mode=arena`.

## Install or create a pack

Copy `GAME/mods/independence-kit/` to `GAME/mods/my-pack/`, where `GAME` is one of the two game folders. Change its manifest ID and title. Add a static import and registry entry in that game's `mods/registry.js`:

```js
import independenceKit from './independence-kit/index.js';
import myPack from './my-pack/index.js';
export const packs = [independenceKit, myPack];
```

A minimal `mods/my-pack/index.js`:

```js
export default {
  api: 1,
  id: 'my-pack',
  version: '1.0.0',
  title: 'My frontier',
  description: 'My local changes to the game.',
  modes: [],
  install(api) {
    api.catalogs.ports[api.game === 'vagrant' ? 'calder' : 'anchorage']
      .rumors.push('The dockside workshop is recruiting independent captains.');
  },
};
```

Reload and select the pack. The original campaign remains available. One pack is active per page; combine compatible modules inside a pack's `install` function instead of relying on unspecified load order.

Packs are **trusted local JavaScript**, with the same browser privileges as the game. They are not sandboxed data uploads. Read unfamiliar source before installing it. Keep module top levels declarative: the registry imports every manifest to list it, while only the selected pack's `install(api)` runs. Never put game changes or side effects at module top level. URL parameters select registry IDs; they do not import arbitrary URLs. Modules and assets must be local.

## API 1 contract

Manifest IDs and registration IDs use lowercase letters, digits and hyphens, start with a letter, and have at most 48 characters. `vanilla`, `constructor`, `prototype`, and the built-in mode ID `campaign` are reserved where applicable. Versions are numeric `major.minor.patch`. Duplicate packs/modes/assets and unknown API versions stop loading with an error. Use **Return to original campaign** if a pack fails.

| Interface | Meaning |
| --- | --- |
| `api.version`, `api.game` | API number and `vagrant` or `ironwake` |
| `api.catalogs` | Live data tables listed below; edit during installation |
| `api.extend(table, id, parent, patch)` | Deep-copy an existing record, apply a shallow patch, add/replace the ID; new hulls inherit the parent's model unless replaced |
| `api.missions.add(spec)` | Add a job template to its `at` port's board |
| `api.missions.type(id, handler)` | Register custom mission logic; returns `mod:PACK_ID:TYPE_ID` |
| `api.assets.ship(id, factory)` | Replace the geometry for a hull/vessel ID |
| `api.assets.sound(id, lanes)` | Add/replace a procedural sound |
| `api.onWorld(world => {})` | Called after world setup on construction, launch, and VAGRANT system entry |
| `api.onStep((world, dt) => {})` | Called once after each active fixed simulation tick; not while paused, docked or dead |

Registration belongs in `install`. Mode hooks run after the corresponding pack hooks. Title backdrops do not run world/mode hooks. Ship factories run lazily and are cached; never use them to mutate simulation state. There is no `eval`, remote dependency resolution or hidden asset server.

### Data and equipment

| Table | VAGRANT STARS | IRONWAKE |
| --- | --- | --- |
| `hulls` | Player/NPC fighter and freighter stats | Player capital hull stats |
| Weapons | `guns`, `launchers`, `shields` | `batteries`, `turrets`, `upgrades` |
| World | `systems`, `ports` | `sector`, `ports`, `vessels` (NPCs) |
| Shared names | `goods`, `factions` | `goods`, `factions` |

Copy a valid parent so every required stat exists. For example, in VAGRANT STARS:

```js
api.extend('hulls', 'courier-plus', 'sparrow', {
  name: 'Courier Plus', hp: 500, cargo: 24, price: 6000, level: 1,
  blurb: 'A stronger courier built by a local workshop.',
});
api.catalogs.ports.calder.ships.push('courier-plus');
```

In IRONWAKE use parent `cutter` and `api.catalogs.ports.anchorage.yard`. Adding equipment to a table does not automatically stock it: VAGRANT ports use `outfit`; IRONWAKE ports use `batteries`, `turrets`, and upgrade `tier`. Existing faction diplomacy and NPC loadout tables are in `js/sim/data.js`; adding a faction name alone does not add wars or patrol routes.

IRONWAKE upgrade tiers are arrays under `catalogs.upgrades`; edit their entries directly rather than using string-ID `extend`. Existing port records share references with the world, so editing a record updates its live counterpart. Adding new ports/systems requires updating both world topology and the `ports` index, gate destinations, route data and markets. This is a source-level extension: inspect the initialization at the end of `data.js`, and play-test every route. Installation checks common data bounds, not every possible rule a JavaScript mod can change.

### Board missions

Every template needs `id`, `at`, `kind`, `giver`, `title`, `text`, `done`, and integer `reward` (0–10,000,000). `at` and `giver` must name an existing port and faction. Optional `minLevel` gates acceptance. Missions are offered once per captain by default; set `repeatable: true` to offer them again after completion. At most 128 templates can be registered. Mod jobs do not change the original story or Most Wanted counters.

| Kind | Required extra fields |
| --- | --- |
| VAGRANT `courier` | `system` (destination system), `base` (destination port), `cargo` |
| VAGRANT `bounty` | `system`, `waypoint: [x,y,z]`, `foe`, `count` (1–12), `tier` (1–5); optional `boss: {name,hull,gun,shield}` |
| IRONWAKE `delivery` | `dest` (port ID), `cargo` |
| IRONWAKE `bounty` | `pos: [x,z]`, `threat` (1–6), `boss` (name); optional `vessel` |
| IRONWAKE `defend` | `pos: [x,z]`, `threat` (1–6) |
| Custom | VAGRANT `system` + `waypoint`; IRONWAKE `pos`; handler-specific fields |

Example VAGRANT delivery inside `install`:

```js
api.missions.add({
  id: 'workshop-supplies', at: 'calder', kind: 'courier', giver: 'halcyon',
  title: 'Workshop supplies', text: 'Take four crates to Tollard.',
  done: 'The workshop has its tools.', reward: 2000, repeatable: true,
  system: 'meridian', base: 'tollard', cargo: 4,
});
```

The native mission systems handle cargo capacity, docking, reputation and payment. For bounties, leave room for the entire formation. VAGRANT installation rejects placements inside planetary/stellar hazard volumes including a formation margin. That check does not prove every possible approach through rocks or stations is safe. Inspect the map and fly the route. The arena example checks each new wave's approach before spawning.

### New mission logic

The example survey is an implemented custom type, not a hard-coded new kind in the engine. Use its `index.js` as a template:

```js
const kind = api.missions.type('my-objective', {
  validate(m) { return Number.isFinite(m.progress ?? 0); },
  objective(player, mission) { return `Progress: ${mission.progress ?? 0}`; },
  step(world, dt, mission) {
    // Test actual game conditions, then update JSON fields on mission.
    // Return 'complete' to use normal payment, stats and completion tracking.
    // Return 'fail' to abandon without payment, or undefined to keep running.
  },
  onDock(player, mission, portId) {
    // Optional. Return 'complete' for a custom delivery/debriefing condition.
  },
});
```

Register templates with the returned `kind`. `validate` runs for templates and loaded saves: check your own field ranges and types, including partially completed state. The engine validates coordinates, destination references, reward and basic mod state. `objective` supplies HUD text; built-in map markers use the coordinates above. Do not pay credits yourself and also return `'complete'`, or you will pay twice. Do not keep `world`, ship objects or functions in mission/save state.

### New modes

A pack's `modes` list declares `{id,title,description,newPlayer?,onWorld?,onStep?,contracts?}`. `campaign` is provided automatically. `contracts: false` hides board jobs (used by the arena).

- `newPlayer(player, catalogs)` changes the fresh captain's equipment, credits or initial save state. It does not run when continuing. The resulting captain must pass the game's save validator: gun counts, ammunition, shield/upgrade IDs, hull capacity and port/system relationship all matter.
- `onWorld(world)` sets up a freshly created or relaunched world. Make it repeatable; it can run more than once per captain.
- `onStep(world, dt)` drives objectives in simulation seconds, normally `1/60`. Pauses do not advance it. VAGRANT fold-jump transit skips normal simulation hooks.
- `world.mod` is scratch state for the current world. `world.mod.objective` is displayed when no board mission is active. Put persistent mode progress in `world.player.modState.mode` instead.
- Push `{type:'msg',text:'Wave incoming',tone:'warn'}` into `world.events` for radio messages (`good` for success). Use `world.rng()` for seeded variation. Use `world.startEncounter(stage, position)` for the existing bounded combat formations, or the public `spawnGroup` / `spawnSquadron` methods for custom ones.

See `mods/independence-kit/modes.js` for complete wave scheduling, finite spawning, repairs, victory, restart and persistent reward logic. This is also where to start a survival, exploration or race mode. The API exposes the real world; new physics, input schemes, render passes or UI screens can be implemented by editing the source files listed below.

### Ship models and imported assets

`api.assets.ship(id, factory)` receives `{Builder,base,trim,guns}` in VAGRANT or `{Builder,base,trim,cannons,turrets}` in IRONWAKE. `base(id, color = trim)` returns an original model without re-entering the mod hook. Copy its hardpoints or place your own.

The supplied Liberty builds a new mesh with `Builder.box()`. `Builder.tri(a,b,c,color,glow)` accepts a triangle and computes a flat normal; `build(extra)` returns the engine's typed arrays. Coordinates are local **+Y up, -Z forward**. One colour and glow value are stored per triangle.

To use an original model you made in Blender or another editor, export **triangulated OBJ** and convert it without a package manager:

```sh
uv run --no-project python scripts/obj-to-mod.py ship.obj VAGRANT_STARS/mods/my-pack/mesh.js
```

This converter imports positions and triangle winding, including negative OBJ indices. It intentionally ignores UVs, material files and supplied normals. It rejects non-finite coordinates, invalid/degenerate faces, non-triangular faces and meshes over 20,000 triangles. Orient and scale the export before conversion.

```js
import {triangles} from './mesh.js';
// Inside install(api):
api.assets.ship('courier-plus', ({Builder, base}) => {
  const old = base('sparrow'), b = new Builder();
  for (const [a, c, d] of triangles) b.tri(a, c, d, [0.2, 0.65, 0.8]);
  return b.build({muzzles: old.muzzles, engines: old.engines});
});
```

VAGRANT ships need `muzzles: [[x,y,z], ...]`, at least one per gun. IRONWAKE needs `ports: {port:[[x,y,z],...],star:[...]}` (one per cannon per side) and `mounts` (one per turret). Both need `engines: [[x,y,z,radius], ...]`. Keep `hull.radius` large enough for the geometry and hardpoints; simulation collision bounds come from hull stats. Models are checked for finite arrays, counts, colours/glow and sufficient hardpoints. A paint change alone can return `base(parent, [r,g,b])`.

The ship hook accepts this geometry format, **not arbitrary glTF, FBX, textures or skeletons**. Add local PNG/SVG/CSS assets for your own UI through `index.html`, `style.css` or `ui.js`. Textured materials, new station geometry and animation pipelines are source extensions in `render.js` / `sim/models.js`; their collision geometry must be updated alongside visuals. Nothing prevents those changes, but there is no automatic importer for every asset format.

### Sound and music

Sound lanes use VANILLAJS audio2d, rendered locally to 48 kHz PCM:

```js
api.assets.sound('dock', [
  [['triangle', 330, 660, 180, 4000, 6], ['triangle', 880, 880, 220, 2500]],
]);
```

Each segment is `[wave, fromHz, toHz, milliseconds, gain, steps?]`. Waves: `square`, `triangle`, `saw`, `noise`, `rest`. Up to four lanes, 128 segments per lane, 512 events and ten seconds per lane; frequency 0–20,000 Hz and gain 0–12,000. `steps` defaults to 1; use several steps for a sweep. Existing names are in `js/audio.js` (`dock`, `hit`, etc.). A new sound name can be used by VAGRANT gun `sfx`; for other events, wire `audio.play(name)` in the app's event handler. The workshop example replaces a sound heard on completion/docking. Background music, ambient layers and sampled audio can be changed in `audio.js` / `soundscape.js`; those are source edits, not score-segment formats.

## Saves, compatibility and debugging

Original keys remain `vagrant-stars.save.v1` and `ironwake.save.v1`. Mod profiles append `.mod.PACK@VERSION/MODE`. Switching packs/modes never imports the original captain or overwrites another profile. A mod version bump creates a new slot; there is no automatic migration between versions. Keep the version for compatible edits during development; bump it before shipping an incompatible save change. Back up browser storage before experimenting with save migrations.

Extension state is `player.modProfile` plus `player.modState = {completed: [], mode: {}}`. Use bounded JSON only: finite numbers, booleans, strings, arrays and plain objects. Limits are 64 KiB serialized, depth 12, 8,192 nodes, strings 8,192 characters and arrays 1,024 elements. The completion list contains registered mission IDs. These are validation limits, not a sandbox or a general performance proof.

Saves remain docking records, not mid-flight snapshots. Mode win flags survive after docking; world objects and timers do not. Runtime mod exceptions stop the game and display the profile/error instead of continuing a broken loop. Browser developer tools show the stack. Read-only debug handles `__vagrant` / `__ironwake` expose the active `modProfile`, world, player, scene and audio for inspection. An exception while importing a malformed module can occur before the app can display its error screen; fix the syntax/path and reload without the query string.

## Offline packaging and verification

Everything in each game's `mods/`, `js/` and `vendor/` folders is included by `scripts/site.mjs`. The guides are included too. After adding/removing files:

```sh
node scripts/site.mjs sync-sw
node --test VAGRANT_STARS/tests/*.test.js IRONWAKE/tests/*.test.js tests/*.test.js
node scripts/site.mjs build _site my-pack-1.0.0
```

Node is needed for the repository's tests/staging tools, not to play the games. No NPM dependencies are required for runtime. The existing CI installs a pinned browser only for browser tests. `tests/mods-browser.mjs` exercises the actual workshop, mod captain, survey, isolated saves, arena, WebGL/Web Audio and cached offline reloads.

Use a fresh build version when distributing updates. The collection service worker caches the complete staged set, including registered packs. For local source work, disable/unregister the old service worker in browser developer tools if it is serving stale files. The app registers it automatically on HTTPS; the browser test explicitly registers it on trustworthy localhost. The initial installation must finish online before cached offline navigation can work. You can always serve the downloaded folder on localhost with no internet connection.

Before sharing a pack, exercise a new captain and a continued one, finish/fail/abandon its missions, relaunch and change system where applicable, test hazards and formation bounds, and test without a network. Include source, the manifest version, play instructions and licences/attribution for your assets. Preserve the repository's Apache-2.0 licence and vendored engine notices; retain each asset's actual licence.

## Source map for deeper changes

| File within a game | What to change |
| --- | --- |
| `mods/registry.js` | Installed local pack list |
| `js/mod-api.js`, `js/modding.js` | Shared API contract and game-specific adapters |
| `js/sim/data.js` | Universe, factions, equipment, markets, loadout tables |
| `js/sim/missions.js` | Native board generation and campaign progression |
| `js/sim/world.js`, `ai.js`, `encounters.js` | Simulation, combat, NPC behaviour, free-roam events |
| `js/sim/models.js` | Geometry, hardpoints and station collision layouts |
| `js/render.js`, `environment.js` | Rendering, sky and environmental presentation |
| `js/audio.js`, `soundscape.js` | Sound effects, music and spatial mixing |
| `js/hud.js`, `ui.js`, `mod-menu.js` | HUD, chart, stations and workshop |
| `js/controller.js`, `app.js` | Input mappings, menus, fixed-step integration, saves |
| `index.html`, `style.css` | Page structure and visual theme |

The shared API and menu files are intentionally duplicated byte-for-byte so either game folder remains self-contained. Tests enforce that agreement. Upstream engine provenance and notices stay in each `vendor/vanillajs/` directory. For a game of your own, continue with [HOW_TO_MAKE_OFFLINE_GAMES.md](HOW_TO_MAKE_OFFLINE_GAMES.md).
