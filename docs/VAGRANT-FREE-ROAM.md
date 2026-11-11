# VAGRANT STARS: living trade routes and controller support

This pass develops the Freelancer-inspired game. IRONWAKE remains for a separate pass.

## Free-roam arc

Without a contract, traffic control announces a nearby signal after eight seconds
of ordinary flight, followed by a six-second warning before the formation arrives.
The beacon is fixed in space, 1.8–2.5 km away, clear of port approaches and solids.
It appears on the HUD and map. **V** (controller right-stick click) selects it;
**F / A / Cross** approaches it. **R / Y / Triangle** selects the nearest enemy.

| Stage | Encounter | Starting bonus, in addition to normal bounties/salvage |
| --- | --- | --- |
| 1 | Two Reaver scouts attacking the route | 600 cr |
| 2 | Three raiders and a stranded Halcyon freighter to protect | 1,000 cr |
| 3 | Lane Reaper ace with two wingmen | 1,500 cr |

Clearing the ace begins another circuit. Difficulty and bonuses rise with both
completed circuits and captain rank; dangerous systems add one enemy tier. A player
must hit an attacker and finish the encounter nearby to earn its bonus. NPC-only
victories do not advance the arc. Losing the freighter fails a rescue even if all
attackers also die. Signals time out after four minutes or when left 7 km behind.
Surviving ships remain in the world and return to normal traffic cleanup.

Successful encounters provide a 45-second recovery window before the next signal;
failed/abandoned signals wait 35 seconds. New signals wait during cruise, slingway
travel, contracts, critical hull damage, or an already crowded nearby fight.
Docking and pausing freeze simulation time. Existing contracts, trading, faction
standing, weapons, loot and the story campaign retain their separate progression.
`patrols` is an optional nonnegative safe integer added to v1 saves; old saves
migrate to zero. As before, progress is saved while docked.

Ambient groups have a separate budget from the encounter formation. Ambient
spawns reserve five slots before insertion and count only living, present,
non-contract, non-encounter ships. One encounter reserves at most four NPCs.
The free-roam bound is 22 NPCs; contract targets are separate. `traffic:false`
still suppresses all ambient/director activity for simulation fixtures.

## Controller

A standard-mapped browser Gamepad API controller works with either Xbox or
PlayStation labels. Press a controller button after the page loads, then release
all controls to arm it. Unmapped devices are ignored rather than guessed.

| Control | Action |
| --- | --- |
| Left stick up/down; left/right | Increase/decrease throttle; strafe |
| Right stick | Pitch/yaw; forward gun aim |
| RT / R2; LT / L2 | Guns; afterburner |
| A / Cross; B / Circle | Interact; brake |
| X / Square; Y / Triangle | Missile; nearest hostile |
| LB / L1; RB / R1 | Next ship; cruise |
| Left-stick click; right-stick click | Drift; select signal |
| D-pad up/down | Hull patch / shield cell |
| D-pad left/right | Next place / tractor |
| View / Share; Menu / Options | Map; pause |

Menus use D-pad up/down, A/Cross to activate, and B/Circle to go back. Left/right
switches dock tabs or adjusts a focused volume slider. New-captain confirmation
uses an in-page dialog, so it also supports controllers. Disconnecting while using
the controller pauses flight. Reconnects, screen changes and focus loss require
neutral controls before input resumes. One-shot actions use button edges; missile
requests remain queued until a simulation tick consumes them. Mouse/keyboard
remain available; moving the controller replaces stale mouse steering/aim.

Audio autoplay rules vary: a physical click or keypress may be needed once to
unlock sound. Browser simulation tests do not certify a physical controller,
Bluetooth connection, controller driver or browser-specific mapping.

## Docking correction

A completed slingway ride previously left the boarding ring selected. Pressing F
then flew back to that ring. Arrival now selects the destination port/gate unless
the pilot explicitly selected something else. An explicit docking order while
riding releases the lane and continues the station approach. With no selected
place, an already usable port takes priority over a nearby ring. An explicitly
selected ring still boards normally.

## VANILLAJS and OPT

- VANILLAJS vendored source remains unchanged at the commits recorded in each
  game's `vendor/vanillajs/PROVENANCE.json`. New controller code uses `input.deadzone`;
  encounters use `math.seededRandom`, orientation math, the existing fixed clock,
  flight, projectiles, lead solver and interaction resolver.
- OPT source inspected: QSOLKCB/OPT commit
  `7556dd36acd53ed3ed538fd03b1db44e5c1ec869`,
  `optimizations/OPT-REDUCE-001-early-working-set-reduction.md`.
- The nearest-hostile query now scans once without building and sorting all
  contact records. Sensor boundary and first-in-order tie behavior match the
  existing stable sorted reference; tests compare exact ship identity.
- Director placement/population searches run at most twice per simulation second.
  Active encounter membership is bounded and no live combat simulation is skipped.
  No portable speedup or whole-engine performance claim is made.

## Validation

```sh
node --test VAGRANT_STARS/tests/*.test.js IRONWAKE/tests/*.test.js tests/*.test.js
node VAGRANT_STARS/tests/browser-smoke.mjs
node VAGRANT_STARS/tests/controller-browser.mjs
node tests/presentation-browser.mjs
node scripts/site.mjs build _site validation
```

Browser tests use the existing pinned Playwright CI setup. Set
`CHROMIUM_EXECUTABLE_PATH` to use an existing Chromium installation. The new browser
suite feeds synthetic standard Gamepad API samples into the real application and
writes its receipt and screenshot under `evidence/browser/` for CI artifacts.
The simulation suite covers 16 initial seeds, a ten-minute bounded replay, rewards,
rescue loss, nonparticipation, controller lifecycle, and docking in both directions.
