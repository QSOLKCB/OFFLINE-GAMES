# Visual overhaul and optional acceleration

The existing VANILLAJS fixed-step simulations, ship data, collision models,
weapon hardpoints, original modes and mod packs remain intact. This change adds
presentation adapters and an opt-in, separately saved native IRONWAKE campaign.
No mod guide or mod hooks implement the campaign.

## Rendering

- Canvas 2D is the default. No GPU context or WASM module is created on this path.
  The browser may internally accelerate Canvas, but the game does not require it;
  Playwright explicitly disables GPU use and rejects non-2D context requests.
- Both scenes retain their packed VANILLAJS XYZ/RGB streams and camera math.
  The software renderer clips triangles crossing the camera plane, rejects
  offscreen primitives, sorts opaque triangles within each distance pass, and
  combines glow-disc fans into smooth radial gradients.
- Near models receive cached surface-detail meshes keyed by the immutable base
  model and station/ship treatment. Hardpoints and radius are retained, and the
  original arrays never change. Fine detail is skipped below the projected-size
  threshold. Outward opaque back faces are rejected before vertex transforms
  when the camera is outside the model's bounding sphere.
- Mesh detail adds at most approximately 96 ship or 160 station triangles per
  cached model. The same mechanism can decorate other large near objects.
- Planet textures are 256×256 procedural images. Palette identifies each cached
  image; lighting is currently a fixed artistic direction, not a physical
  day/night simulation. At most eight palettes remain cached. A 960×540 GALAXY
  backdrop is baked only when its full system identity changes.
- CPU scene resolution is capped at 960 pixels wide, independent of display
  pixel ratio. Optional GPU resolution is capped at 1920 pixels wide / 1.5 scale.
  The HUD retains its existing resolution and input coordinates.

## WebGPU and WASM

The title screen probes `requestAdapter` and rejects a reported fallback adapter.
It offers acceleration only when an adapter and WebAssembly support exist.
Detection does not start rendering or create a device. Each Enable attempt
requests a fresh adapter, including retries after device loss. Clicking Enable lazily
imports the backend, creates its device and instantiates the bundled WASM bytes.
Neither acceleration nor its consent is persisted across reloads.

WASM projects the bounded packed streams into clip-space XYZ/W/RGB; WebGPU
rasterizes triangles, lines and points with depth and additive passes. The CPU
canvas supplies the procedural sky and planet background. A final opaque GPU
composition combines that background with an offscreen scene texture. Additive
effects add RGB without changing scene coverage; black glow rims leave the
background intact. Both textures are reused and released on resize/disposal. The background
retains the 960-pixel CPU cap while geometry keeps its independent GPU resolution,
limiting the CPU-to-GPU upload cost. This adds one background upload and one full-screen pass. Sixteen MiB of fixed
WASM memory bounds staging; GPU buffers grow only to each bounded stream's size
and are reused. System-change sky buffers are released. Initialization errors,
uncaptured device errors, synchronous draw errors and device loss return to the
running CPU game. Simulation state is never copied into the renderer.

`shared/wasm/project.wat`, `project.wasm` and `project-bytes.js` are reproducible:
install `wabt@1.0.39` as a development-only dependency, then run `npm run build:wasm`.
The JavaScript byte payload avoids a runtime fetch and works from the offline
cache. The Node parity test compares 1,000 projected vertices against JavaScript
within 0.00003 absolute clip-coordinate error; RGB is preserved exactly.

WebGPU API source: https://www.w3.org/TR/webgpu/ . GPU availability is a browser
capability check, not a claim that every installed physical GPU supports WebGPU.
Local testing used Playwright 1.65.0 and Chromium 158.0.8127.18 on an
RTX 5060 Ti exposed as a non-fallback NVIDIA Blackwell adapter.
The real-GPU browser test records the adapter actually returned by Chromium.

## Performance contract and evidence

OPT source: QSOLKCB/OPT at `7556dd36acd53ed3ed538fd03b1db44e5c1ec869`.
Mechanisms: OPT-INV-001 bounded invariant reuse, OPT-REDUCE-001 early invisible
working-set rejection. These records do not confer a speedup or formal proof on
this implementation.

Target contract:

- X: cached surface details, texture sizes, renderer choice and culling placement.
- F: bounded local/offline renderers; default CPU; user-selected acceleration.
- Objective: keep added visible detail inside an interactive frame budget and
  reduce repeated geometry/texture work. Timings are noisy and environment-specific.
- Correctness: simulation, input, save identity and original model data remain
  unchanged; visual approximation is allowed for software rasterization, texture
  resolution, LOD and decorative background. The old WebGL path remains available.
- Budget: six alternating trials of 24 fixed-scene draws after warmup, for ship,
  station and planet views in each game, plus 120-frame CPU/GPU play samples.
- Stop: complete those trials and browser/conformance checks; do not tune against
  isolated favorable timings or claim a portable speedup.

`evidence/overhaul/asset-comparison.json` compares additional panel detail enabled
and disabled in the same renderer, not the full old release versus the new one.
The captured CPU medians for ship views were 3.24→3.32 ms in IRONWAKE and
6.61→6.65 ms in VAGRANT STARS. The IRONWAKE station sample was 3.00→3.96 ms:
extra detail is not free. These values include CPU scene drawing. GPU samples
measure CPU submission time, **not GPU completion or total frame time**.

CPU-only and physical NVIDIA Blackwell adapter tests also cover launch, save
isolation and forced device loss. Reports identify Chromium's version and backend.
This is not certification on vintage hardware. Software drawing uses painter's
ordering within passes rather than a per-pixel depth buffer, so intersecting
geometry can differ from GPU rendering. The existing application still requires
a browser with ES modules, private fields and other modern JavaScript features.
Old hardware running a suitable browser is the compatibility target.

## Campaign

The Lantern Ledger is a separate native profile at `IRONWAKE/?campaign=1`:
`ironwake.campaign.v1`, compared with the unchanged `ironwake.save.v1`.
The eight chapters offer native delivery, defend and bounty contracts at named
ports, with trade, mining and rank gates that encourage the existing earning and
refit loop. Failed and abandoned missions leave the chapter unchanged. Native
completion pays once, advances the chapter, and updates the journal. Story
progress never advances the separate Most Wanted list. The ending leaves free
play available. New state is validated when loading; old saves need no migration.

Tests cover chapter progression/retries, rewards, gates, save validation and actual
world squadron spawns/completion. Browser tests cover separate saves, profile switching and cold offline reloads.
Full campaign pacing has not been established through an unaided multi-hour playthrough.

## Sources and licensing

VANILLAJS remains pinned to the existing provenance in each game's vendor tree.
GALAXY source is pinned at `f219bb427b3a9b0c93900169d903f48f410ae67a`; vendored
source hashes, MPL-2.0 and Apache-2.0 notices are under `shared/vendor/galaxy/`.
Only decorative sampling is used; no claim of an N-body or astrophysical game
simulation is made. No remote assets, accounts, services or runtime dependencies
were introduced. Shared files are included in the static build and service-worker
inventory. Distribute the complete repository/site, including `shared/`.

## Rendering regression fixes

VAGRANT STARS now finalizes each frame before returning its haze value. Checks
assert one submission and inspect actual GPU pixels, rather than treating an
"enabled" backend label as proof that geometry was drawn.

Nearby planets use ray/sphere surface intersections in a reusable image bounded
to 320 pixels on either axis. This handles the camera-plane crossing and views
inside the atmosphere; only spheres entirely behind the camera are rejected.
Distant planets keep the cached billboard path. Surface texture projection near
a planet is approximate; simulation collisions and damage are unchanged.

`node tests/render-regressions-browser.mjs` runs CPU surface-visibility, frame
finalization and single-use adapter UI fixtures. It runs from the existing CI
presentation entry point. `TEST_HARDWARE_GPU=1 node tests/render-regressions-browser.mjs`
also reads rendered GPU textures back into buffers to verify black and colored
additive pixels over both the background and opaque geometry, visible frames in
both games, repeated CPU/GPU switching, device loss and post-device-creation
initialization failure. These hardware checks passed on the NVIDIA adapter.
Earlier GPU timing samples did not prove VAGRANT STARS submitted geometry;
the hardware play report has been regenerated after this fix.
