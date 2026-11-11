# OFFLINE-GAMES

A collection of gaming experiences on pure web standards. No accounts, no
trackers, no installs: once a game has loaded it keeps working without a
connection.

**Play:** <https://qsolkcb.github.io/OFFLINE-GAMES/>

## Games

| Game | What it is |
| --- | --- |
| [VAGRANT STARS](VAGRANT_STARS/) | 3D open-space trading and combat across six star systems: [play](https://qsolkcb.github.io/OFFLINE-GAMES/VAGRANT_STARS/) |
| [IRONWAKE](IRONWAKE/) | Capital-ship broadside combat, trading and mining on a battle plane: [play](https://qsolkcb.github.io/OFFLINE-GAMES/IRONWAKE/) |

Both are built on the [VANILLAJS](https://github.com/QSOLKCB/VANILLAJS) engine. Each game is a
self-contained folder with its own tests and its own pinned copy of the engine modules it uses.

## Presentation and controls

Both games now have procedural nebula skies, textured planets and atmospheres,
animated port approaches, live dockside views and a fuller stereo soundscape.
Right-click selects an enemy; Q fires missiles/torpedoes and IRONWAKE uses E for
its deflector. See [the presentation notes](docs/PRESENTATION.md) for the changes,
VANILLAJS/OPT provenance, resource bounds and validation commands.

## VAGRANT STARS free roam and controllers

VAGRANT STARS now follows a recurring scout patrol → freighter rescue → ace
encounter arc, with marked signals, payouts and time to salvage/refit. Standard
Xbox/PlayStation-mapped controllers support flight, combat, navigation and menus.
Slingway arrival selects the destination port so docking no longer sends you back
to the boarding ring. See [controls and gameplay notes](docs/VAGRANT-FREE-ROAM.md).

## Run locally

```bash
npm start
```

serves the repository at `http://127.0.0.1:8080/` with a zero-dependency Node
server. Any static file server works; the games use ES modules, which browsers
do not load from `file://`.

## Test

```bash
npm test
```

needs only Node 20 or newer. `npm run test:browser` additionally drives the
game in Chromium when Playwright is installed.

## Deploy to GitHub Pages

`.github/workflows/pages.yml` tests every game and publishes them together as one site:
the collection page at the root with a Play link to each game, and each game in its own folder.

1. One time: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Merge to `main`. The workflow runs the tests, stages the site and deploys it.
3. To redeploy by hand: **Actions → Publish offline games → Run workflow**.

Pull requests run the tests and staging step but do not deploy. The deployed
service worker is stamped with the commit, so each release replaces the cached
copy on players' devices.

The repository root is also a complete static site, so Pages' "Deploy from a
branch" mode serves it too, without the test gate.

## Layout

| Path | Contents |
| --- | --- |
| `index.html`, `styles.css` | The collection page |
| `sw.js`, `manifest.webmanifest`, `assets/` | Offline support and icons |
| `VAGRANT_STARS/`, `IRONWAKE/` | One folder per game: the game, its tests and its vendored engine modules |
| `scripts/site.mjs` | The published file list: stages the Pages artifact and keeps `sw.js` in step |
| `scripts/serve.mjs` | Local static server |
| `tests/` | Site-level tests |

After adding or removing a published file, run `node scripts/site.mjs sync-sw`.

## Adding a game

1. Put it in its own folder with `index.html`, `style.css`, `README.md`, `NOTICE.md`, `js/` and `vendor/`.
2. Add the folder to `GAMES` in `scripts/site.mjs` and run `node scripts/site.mjs sync-sw`.
3. Add a card with a `Play` link to `index.html`, and its tests to the `test` script in `package.json` and the workflow.

The site tests fail if a published game has no link on the collection page.

## Licence

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

## Make it yours

**This is not a product. This is INDEPENDENCE.**

Both games have a local **Mods & modes** workshop, versioned pack API, isolated saves, custom missions, modes, geometry and procedural sounds. Try the included Independence Kit or copy its source to create your own.

- [MOD_GUIDE.md](MOD_GUIDE.md): install packs, write missions/modes, import meshes and replace sounds.
- [HOW_TO_MAKE_OFFLINE_GAMES.md](HOW_TO_MAKE_OFFLINE_GAMES.md): build and distribute a game you own.
- [INDEPENDENCE](https://github.com/QSOLKCB/INDEPENDENCE) · [VANILLAJS](https://github.com/QSOLKCB/VANILLAJS)
