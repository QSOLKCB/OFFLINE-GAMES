# OFFLINE-GAMES

A collection of gaming experiences on pure web standards. No accounts, no
trackers, no installs: once a game has loaded it keeps working without a
connection.

**Play:** <https://qsolkcb.github.io/OFFLINE-GAMES/>

## Games

| Game | What it is |
| --- | --- |
| [VAGRANT STARS](VAGRANT_STARS/) | 3D open-space trading and combat across six star systems, built on the [VANILLAJS](https://github.com/QSOLKCB/VANILLAJS) engine |

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

`.github/workflows/pages.yml` tests the repository and publishes it.

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
| `VAGRANT_STARS/` | The game, its tests and its vendored engine modules |
| `scripts/site.mjs` | The published file list: stages the Pages artifact and keeps `sw.js` in step |
| `scripts/serve.mjs` | Local static server |
| `tests/` | Site-level tests |

After adding or removing a published file, run `node scripts/site.mjs sync-sw`.

## Licence

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
