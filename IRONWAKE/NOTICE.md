# IRONWAKE notices

IRONWAKE is original QSOL-IMC work: the Sundered Banks setting, its factions,
ports, ships, weapons, goods, contract and warrant text, rules, interface,
procedural geometry and synthesized sound.

It is a game in the capital-ship space combat genre: warships held to a plane,
fighting with broadsides. It contains no names, characters, text, data, art,
music or code from any commercial game, and is not affiliated with or endorsed
by any game publisher.

## QSOLKCB/VANILLAJS (Apache License 2.0)

`vendor/vanillajs/` holds unmodified copies of the modules `math`, `collision`,
`flight`, `time`, `input`, `weapons`, `adaptive-circles`, `range2d`,
`lead-solver`, `render-webgl` and `audio2d` from commit
`6b07c63aca143a34f0d3cf29bb2a7c8bc03e0e5e`, Copyright 2026 QSOL–IMC / Trent Slade
and contributors, with that project's `LICENSE` and `NOTICE`.
`vendor/vanillajs/PROVENANCE.json` records the commit and a SHA-256 for every
file; `tests/sim.test.js` checks them.

## QSOLKCB/OPT (Apache License 2.0)

Optimization patterns from commit `7556dd36acd53ed3ed538fd03b1db44e5c1ec869`
are applied as design ideas: OPT-REDUCE-001 (the static-collider grid, the
engine's axis-reject range checks for turret targeting, distance culling and
level of detail for rock fields) and OPT-INV-001 (cached tinted hull, station
and planet meshes; one hull snapshot per tick shared by every shell). Patterns
only; no OPT source is copied.

## Within this repository

The geometry builder, scene emitters and audio scoring helper began as copies
of the ones written for VAGRANT STARS in this repository and are kept in this
folder so each game stands alone.
