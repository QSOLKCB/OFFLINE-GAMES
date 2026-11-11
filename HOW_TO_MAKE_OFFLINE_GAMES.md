# How to make offline games

**This is not a product. This is INDEPENDENCE.**

[INDEPENDENCE](https://github.com/QSOLKCB/INDEPENDENCE) · [VANILLAJS](https://github.com/QSOLKCB/VANILLAJS) · [Mod these games](MOD_GUIDE.md)

A game can be a directory of files you own. HTML provides the screen, JavaScript runs the rules, WebGL draws the world, Web Audio makes the sound, and a local server supplies the files. An internet connection, account system, cloud database and subscription are not requirements for play.

VAGRANT STARS and IRONWAKE are working examples. They include their engine modules and content source. You can modify them, study them, distribute a compatible mod, or build another game with the same approach.

## 1. Start with a complete local copy

Clone/download OFFLINE-GAMES. Preserve `LICENSE`, `NOTICE` and the vendored engine licence/provenance files. Serve the repository root:

```sh
uv run --no-project python -m http.server 8080 --bind 127.0.0.1
```

If Python is already installed, `python3 -m http.server 8080 --bind 127.0.0.1` also works. Open `http://127.0.0.1:8080/`. This is a file server on your own machine; the game runs in the browser. No NPM installation is required. A `file://` double-click is unreliable for module imports, so use HTTP even while disconnected from the internet.

Play a few minutes, visit a port, buy something, accept a contract, fight, dock and reload. Then switch to an example pack through **Mods & modes**. Understanding one complete player loop is more useful than changing every system at once.

## 2. Choose the smallest starting point

| Goal | Starting point |
| --- | --- |
| More missions, equipment, models or a new mode | Copy a pack as described in [MOD_GUIDE.md](MOD_GUIDE.md) |
| A spaceflight game with 3D steering | Copy `VAGRANT_STARS/` |
| A naval/broadside game with movement on a plane | Copy `IRONWAKE/` |
| A different genre | Keep only the VANILLAJS modules you need and build a new simulation |

For another game in this collection, copy a game folder to `MY_GAME/`, add it to `GAMES` in `scripts/site.mjs`, and add a matching Play card in the root `index.html`. Change the document title, menu title, setting, starting state and **both save/settings prefixes** in `js/app.js`. Otherwise two games on the same origin can share storage accidentally. Keep the relative links to the collection assets, manifest and worker, or update them if distributing separately.

The shipped game folders carry their own code and engine. For a completely separate site, provide your own root page, manifest, icons and service worker (or omit installation support and serve the folder locally). Remove/update collection-relative links and the `../sw.js` registration. A downloaded local game does not need a service worker to be playable through a local server.

## 3. Build a tiny playable loop first

Write the rules in plain terms: what the player does, how the world reacts, what counts as success, and what changes after failure. For a space trader that might be: accept cargo → travel → evade or fight → deliver → repair/upgrade → choose a harder job.

Implement one instance of each part before generating a thousand missions. Give actions consequences the player can see: a merchant arrives, an enemy retreats, cargo consumes space, a damaged ship needs repair, and a completed contract changes the balance. Add recovery time between fights. The encounter directors in these games demonstrate finite NPC budgets, warning signals, escalation and cooldowns.

Keep the simulation independent from the browser. `js/sim/world.js` accepts captain state and commands; `step(dt, command)` advances the world and emits events. `player.js` owns trading, equipment and save validation. Those files can be exercised without a window or GPU.

## 4. Separate time, rules and presentation

| Layer | Responsibility | Example |
| --- | --- | --- |
| Input | Translate device state into commands | Keyboard/mouse adapters and `controller.js` |
| Simulation | Move ships, resolve hits, update objectives | `sim/world.js` |
| Events | Describe things that happened | Shot, hit, pickup, dock, mission completion |
| Presentation | Render/interpolate and play sounds | `render.js`, `audio.js`, `app.js` |
| Persistence | Validate and save a deliberate checkpoint | `sim/player.js`, docking in `app.js` |

Use a fixed simulation step, such as 1/60 second, and interpolate rendering between previous/current poses. VANILLAJS `FixedClock` supplies this pattern. A render frame can contain zero or several simulation ticks. Keep one-shot input pending until a tick consumes it; otherwise torpedoes or missiles disappear on fast displays. Pause the clock when the page loses focus, a menu opens or a controller disconnects.

Use the seeded simulation RNG for world generation and AI choices. Keep decorative randomness separate from game decisions. Reproduce bugs with a seed, initial captain, command sequence, timestep and exact source revision. These games use floating-point simulation; using the engine does not itself prove cross-browser bit-for-bit determinism. If you need exact arithmetic, choose the relevant VANILLAJS module, define its bounds and test that contract explicitly.

## 5. Build assets you can inspect

The current ships, stations and rocks are geometry generated by code. Sound effects are scored locally using VANILLAJS audio2d, with additional Web Audio ambience. This makes the source small and editable, without a runtime download pipeline.

You can also use your own artwork, recordings or meshes. Put files inside the game, use relative paths and retain their licences. For position-only ship meshes, `scripts/obj-to-mod.py` converts a triangulated OBJ into an importable JS asset; the [mod guide](MOD_GUIDE.md) shows how to attach hardpoints. The existing renderer uses flat colours and glow. Texture maps, skeletal animation, glTF and sampled music need an explicit rendering/audio integration; the converter does not invent one.

Make geometry and collision agree. If you enlarge a ship, update its collision radius and weapon/engine positions. If you move a station, update its docking and solid volumes. A visually clear corridor is not enough if autopilot is following a segment through a planet. Test both the destination and the full approach, including room for an entire spawned formation.

## 6. Design menus and controllers with the game

Keep menus usable with ordinary focusable buttons. Share the same game commands between keyboard and controller. Use dead zones, edge detection, neutral-input arming on screen changes, and held input only where it makes sense. A held fire button must not also accept a destructive menu choice after a screen transition.

Both games already include controller menu navigation, input reset, disconnect pause and new-captain confirmation. Copy the behaviour as well as the key mapping. Test new overlays with D-pad/A/B, keyboard, mouse, small viewports and reduced-motion settings. Put modder implementation details in documentation; keep the player's screen focused on actions and objectives.

## 7. Make progress portable and predictable

Store a small versioned captain object rather than serializing the entire live world. Validate every field you depend on before continuing: hull/equipment IDs, counts, finite numbers, cargo limits, destination references and mission state. Do not silently replace a failed save with a new captain.

Choose checkpoint semantics and tell the player what they are. These games save at ports, so dying returns to the last docking record. The mod API gives each pack version/mode a separate storage key. When you change save structure, implement and test a migration or deliberately start a new versioned profile. Browser storage belongs to that browser/origin and can be cleared; it is not a cloud backup. A future export/import button should run the same validation as Continue.

## 8. Package the whole game

The browser must be able to find every module and asset locally. Avoid runtime CDN imports, remote fonts and analytics requirements. Keep a written file inventory; here, `scripts/site.mjs` is the source of truth for the published collection and service-worker cache.

```sh
node scripts/site.mjs sync-sw
node scripts/site.mjs build _site my-game-1.0.0
```

`_site/` is the complete static distribution. Host it on any suitable static server or copy it to another machine and serve it locally. Node is a development tool for this repository's scripts; it is not part of the game runtime. No bundler or package manager is necessary to play or edit the source.

A service worker adds cached navigation after the first successful installation on HTTPS (or trustworthy localhost). Give releases distinct cache versions and test an offline reload, not just play with an already-open tab. After adding a module or asset, update the inventory. Keep local development caches from masking edited files. GitHub Pages is an optional distribution convenience; it is not the simulation server.

## 9. Test behaviour and keep evidence

Run the existing simulation/site tests after changes:

```sh
node --test VAGRANT_STARS/tests/*.test.js IRONWAKE/tests/*.test.js tests/*.test.js
```

The tests include game rules, collisions, encounter boundaries, controller state, save validation, real mod mission completion, mode lifecycle, model/sound data, OBJ conversion, module resolution and complete offline inventory. A simulation test can create a `World`, apply commands, step time and assert outcomes. For a regression, first build a reproduction that fails on the broken code, then retain it after the fix.

The GitHub workflow also runs pinned Chromium/Playwright browser checks against the staged site. These exercise actual WebGL, Web Audio, DOM menus, synthetic controller input and offline reloads. Browser automation tooling is a development dependency only. Preserve screenshots, test results, the exact commit SHA and environment versions when they explain a change. Distinguish an automated simulation fixture from a human play test; neither replaces the other.

Try a complete new-captain → objective → reward → dock → reload loop yourself. Try losing, leaving an objective, choosing another mode, and removing the network. Spend time watching NPCs when the player does nothing. An active world needs routines and outcomes, not merely more spawn calls.

## 10. Share source, not dependency on you

Ship the game, mod registry, editable content, instructions, licence and notices. Include the commands needed to reproduce a build and tests. Use versioned releases so players know which source they have. Keep backward compatibility promises specific; a stable mission API and documented save format are useful promises, while “every future mod works forever” is not.

The ideas and engine are available here:

- [INDEPENDENCE](https://github.com/QSOLKCB/INDEPENDENCE) — the principles behind owning your software.
- [VANILLAJS](https://github.com/QSOLKCB/VANILLAJS) — the engine and reusable web modules.
- [OFFLINE-GAMES](https://github.com/QSOLKCB/OFFLINE-GAMES) — these games, examples and tests.
- [MOD_GUIDE.md](MOD_GUIDE.md) — the API, runnable packs and extension recipes.

**This is not a product. This is INDEPENDENCE.**
