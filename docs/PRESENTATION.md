# OFFLINE-GAMES presentation pass

This pass changes the worlds you see and hear in both games. It also fixes the two
review findings in PR #2 and assigns right mouse to hostile selection.

## Player-facing changes

- Seeded nebula skies with filament/dust structure and each system's colour palette.
- Smooth shaded planets with baked oceans, continents, ice caps, clouds or gas bands,
  plus a thin additive atmosphere. The production camera and depth buffer render them.
- Animated port approach beacons and a live orbital view behind the docked concourse.
- Layered engine bass/harmonics, port and field ambience, stereo musical voices,
  a seeded room tail, filtered echoes and a compressor to control combat peaks.
- VANILLAJS `audio2d` remains the deterministic effect source. Playback adds DC removal,
  gentle filtering, soft saturation and onset/release tapers. Effects have a 32-voice
  limit, and completed sound/music nodes disconnect explicitly.
- Right-click selects a hostile contact under the visible cursor. With IRONWAKE's
  pointer lock it uses the centre of the screen. Empty space keeps the selection;
  friends, dead contacts and contacts behind the camera are excluded. Q still fires
  missiles/torpedoes; E still controls the deflector. The help screens document this.
- Torpedo steering uses `atan2(cross, dot)` before the existing turn-rate clamp, so
  astern and overshot targets no longer suffer the `asin` ambiguity. Browser smoke
  predicates are awaited in both games.

The docked overview changes presentation only; it does not advance the simulation,
markets or mission timers. Reduced-motion preference fixes its camera in place.
Approach lights are navigation decoration, not new collision objects or trade routes.

## VANILLAJS and provenance

The existing unmodified vendored engine modules remain the foundation: fixed-step
simulation, input, flight, collision, gunnery, rendering and synthesized effect scores.
The existing PROVENANCE.json digests and licences remain intact and are checked by tests.
The new texture/planet pass is original game-side WebGL code on the engine's context;
it does not claim to be a released VANILLAJS API. There are no downloaded textures,
recordings, CDN imports or runtime package dependencies.

The three small presentation helpers are mirrored in both self-contained game
folders; the test suite enforces equality. New files are included in the offline
manifest and the deployment allowlist. Test dependencies and evidence are excluded.

## OPT contract and measured boundary

Source: QSOLKCB/OPT at `7556dd36acd53ed3ed538fd03b1db44e5c1ec869`,
`README4AI.md`, `OPTIMIZATION-PROBLEM.md`,
`optimizations/OPT-INV-001-invariant-driven-reuse.md` and
`optimizations/OPT-REDUCE-001-early-working-set-reduction.md`.
The latter's source note is `sources/JAZCO.md`; no donor implementation was copied.

- **X/F:** retain or recompute immutable presentation data; feasible choices preserve
  exact glow-disc numeric outputs and complete input identity for textures.
- **Objective/direction:** reduce repeated CPU trigonometry and surface generation.
- **C:** fixed-step gameplay and engine source remain unchanged except the stated
  torpedo correction. Static samples are binary64 and preserve the original operation
  order. Sky identity includes seed, colours and active palettes. No gameplay RNG is used.
- **B/S:** nine alternating-order timing trials after warm-up; stop after the declared
  trials and parity checks. No adaptive thresholds or quality reduction are introduced.
- **Classification:** categorical local choice; noisy wall-time objective, deterministic
  equivalence; derivative-free, moderate evaluation cost, sequential execution; exact
  for disc reuse. New artwork is an intentional visual change, not reference-image parity.

`node scripts/benchmark-presentation.mjs` records raw repeated measurements and the
host in `evidence/presentation-benchmark.json`. It compares the actual trigonometric
work of 2,000 glow discs, with exact Float64 output parity. This is a **kernel
measurement, not an FPS or end-to-end speedup claim**. The one-time sky bake is also
charged separately; richer presentation has an additional creation/rendering cost.

The immutable circle table is 2,544 bytes. A scene retains one sphere vertex buffer
(245,760 bytes), one 1024×512 RGBA sky texture and at most two 512×256 planet textures
(3 MiB total without mipmaps). Texture changes delete the old set; a matching signature
reuses the existing set. Port effects are distance-limited before vertex emission,
with no simulation side effects. Existing stream capacity limits remain in force.

Rollback criteria: any disc parity failure, stale texture identity, texture retention
across repeated system changes, WebGL error, non-finite audio or regression in existing
gameplay tests. Later device benchmarks may warrant a separate quality setting;
this pass does not claim validation on the owner's RTX GPU or all browsers.

## Verification

Run `node --test VAGRANT_STARS/tests/*.test.js IRONWAKE/tests/*.test.js tests/*.test.js`.
The browser command additionally runs both complete existing play-throughs and
`tests/presentation-browser.mjs`, which exercises real WebGL, mouse picking, system
texture replacement and OfflineAudioContext rendering. It saves screenshots and a
JSON receipt in `evidence/browser/`. CI installs pinned Playwright 1.62.1 solely for
these tests and uploads that directory as a workflow artifact. Screenshots are actual
runtime captures, not concept art.
