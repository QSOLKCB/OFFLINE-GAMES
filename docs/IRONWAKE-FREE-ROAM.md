# IRONWAKE: the living shipping channel

IRONWAKE keeps its Rebel Galaxy-inspired capital-ship combat: sail on the battle
plane, bring a broadside to bear, steady it, fire, then turn a fresh shield screen
toward incoming fire. This pass adds encounters and controllers to that loop.

## Patrol arc

With no active contract, ordinary flight opens a nearby signal after ten seconds.
The HUD, radar and sector chart mark it, followed by a seven-second arrival warning.
**V** or right-stick click plots the signal; **J** or RB/R1 engages warp toward it.
On the chart, click the beacon or use the controller's course selector.

| Stage | Encounter | Bonus, in addition to bounties and salvage |
| --- | --- | --- |
| Picket | Gunboat and two strike craft | 900 cr |
| Rescue | Protect the disabled League Relief — Mercy from three attackers | 1,600 cr |
| Flagship | Captain Redwake's cutter and two strike craft | 2,400 cr |

A completed circuit repeats with stronger capital ships and larger bonuses only
as both completed circuits and captain rank increase. The player must damage an
attacker and finish the encounter nearby to earn the bonus. NPC-only victories do
not advance the arc. Losing or firing on the relief ship fails the rescue. Her
turrets defend her while her engines are disabled; survivors resume travel after
the signal closes.

Success gives 55 seconds to recover shields and collect salvage. Failure gives
40 seconds to regroup. Signals expire after five minutes or when left 7 km behind.
New calls wait during contracts, warp, nearby combat, crowding, or hull damage below
40%. Taking a different warp course during the warning hands the signal to the
Watch. Warp toward the selected signal keeps it active.

Beacons are 1.8–2.8 km away. Placement reserves an 850-unit formation radius outside
port approaches and solid geometry, and rejects straight approaches through debris.
If no candidate is clear, the director waits instead of advertising a blocked route.
IRONWAKE's background planets sit outside the battle plane and are decorative.

Ordinary traffic and warp ambushes share an 18-NPC budget; encounter formations
reserve at most four more. Contract fleets are separate. All ambient insertion
paths reserve capacity before spawning, and active encounters do not consume the
three ordinary traffic-group slots. Searches run at most twice per simulation second.

`patrols` is an optional nonnegative safe integer in the existing v1 save. Older
saves migrate to zero. Docking saves progress; relaunching clears the current
encounter and starts a fresh signal clock. Pausing, chart viewing and docking freeze
the simulation. The wardroom shows completed patrols and the next stage.

## Controller

Use a browser controller with the standard Gamepad API mapping. Release all controls
after connecting, changing screens or reconnecting. Unmapped devices are ignored.

| Control | Action |
| --- | --- |
| Left stick up/down; left/right | Throttle; rudder |
| Right stick | Orbit the view and aim |
| RT / R2 | Hold to steady the selected broadside; release to fire |
| LT / L2 | Raise the deflector |
| A / Cross; B / Circle | Dock; brake and drop warp |
| X / Square; Y / Triangle | Torpedo; nearest hostile |
| LB / L1; RB / R1 | Next ship; warp |
| Left-stick click; right-stick click | Bow view; plot signal |
| D-pad left/right | Snap to port/starboard broadside |
| D-pad up/down | Boost while held; stop throttle |
| View / Share; Menu / Options | Chart; pause |

On the chart, D-pad up/down cycles courses, A/Cross or RB/R1 engages warp and
B/Circle closes. In menus, D-pad up/down navigates, A/Cross activates and B/Circle
goes back. Left/right changes dock tabs or the focused volume slider. New-captain
confirmation is an in-page dialog that supports the same controls.

Disconnecting during controller flight pauses. Screen changes cancel a charged
broadside, and a held trigger cannot fire on resume before controls return to
neutral. Torpedo edges stay queued until a simulation tick consumes them. Keyboard
**X** now also brakes and disengages warp for a slow docking approach.

Some browsers require a physical click or keypress to unlock audio. Automated
gamepad samples verify application behavior, not a physical controller or driver.

## VANILLAJS and OPT

The pinned, unmodified VANILLAJS modules supply analog deadzones, deterministic RNG,
the fixed clock, flight, weapon timers, adaptive circle queries and lead solving.
Provenance remains in `IRONWAKE/vendor/vanillajs/PROVENANCE.json`.

Following OPT-REDUCE-001, nearest-hostile queries scan once without allocating and
sorting a full contact list. Target selection, warp inhibition/interdiction and
combat audio use this query. Tests compare exact ship identities against the former
sorted reference, including ties and strict sensor/range boundaries. Existing
`range2d` turret rejection and adaptive-circle shell collision remain in use.
This is a bounded-work change, not a claimed whole-engine speedup.

## Verification

```sh
node --test VAGRANT_STARS/tests/*.test.js IRONWAKE/tests/*.test.js tests/*.test.js
node IRONWAKE/tests/controller-browser.mjs
node scripts/site.mjs build _site validation
```

CI also runs both existing game smoke tests, the VAGRANT STARS controller suite and
the shared presentation/audio suite. Browser receipts distinguish synthetic gamepad
input from physical hardware testing.
