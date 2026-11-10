# VAGRANT STARS notices

VAGRANT STARS is original QSOL-IMC work: the Tessel Reach setting, its factions,
systems, ports, ships, equipment, goods, contract and storyline text, rules,
interface, procedural geometry and synthesized sound.

It is a game in the open-space trading-and-combat genre. It contains no names,
characters, text, data, art, audio or code from any commercial game, and is not
affiliated with or endorsed by any game publisher. In particular, no code from
the FreeSpace 2 source release is used: that release is under a noncommercial
licence that cannot be combined with this repository's Apache-2.0 licence, and
the game here was written from scratch on the VANILLAJS engine instead.

## QSOLKCB/VANILLAJS (Apache License 2.0)

`vendor/vanillajs/` holds unmodified copies of the modules `math`, `collision`,
`flight`, `time`, `input`, `projectiles`, `render-webgl`, `lead-solver`,
`interactions` and `audio2d` from commit
`6b07c63aca143a34f0d3cf29bb2a7c8bc03e0e5e`, Copyright 2026 QSOL–IMC / Trent Slade
and contributors, with that project's `LICENSE` and `NOTICE`.
`vendor/vanillajs/PROVENANCE.json` records the commit and a SHA-256 for every
file; `tests/sim.test.js` checks them.

## QSOLKCB/OPT (Apache License 2.0)

Optimization patterns from commit `7556dd36acd53ed3ed538fd03b1db44e5c1ec869`
are applied as design ideas: OPT-REDUCE-001 (early working-set reduction: the
static-collider grid, asteroid distance culling and level of detail) and
OPT-INV-001 (invariant-driven reuse: cached tinted hull, station and planet
meshes). Patterns only; no OPT source is copied.

## QSOLKCB/SONIFICATION, ARCADE and GAMES

Consulted as references for deterministic synthesized audio, vendoring records,
test layout and the Pages workflow. No source files are copied from them.
