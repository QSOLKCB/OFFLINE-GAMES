// SPDX-License-Identifier: Apache-2.0
// Synthetic standard Gamepad API input through the real bridge and DOM menus.
// This is an application integration test, not a physical controller test.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync, writeFileSync} from 'node:fs';
import {createStaticServer} from '../../scripts/serve.mjs';
import {root} from '../../scripts/site.mjs';
const {chromium} = createRequire(import.meta.url)('playwright');
const server = createStaticServer(root);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const home = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']});
  const page = await browser.newPage({viewport: {width: 1280, height: 720}}), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
  await page.addInitScript(() => {
    window.testPad = {index: 0, id: 'Synthetic standard controller', connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({length: 17}, () => ({value: 0, pressed: false}))};
    Object.defineProperty(navigator, 'getGamepads', {value: () => window.testPad ? [window.testPad] : []});
  });
  const frames = (n = 5) => page.evaluate(n => new Promise(resolve => { const next = () => --n ? requestAnimationFrame(next) : resolve(); requestAnimationFrame(next); }), n);
  const hold = async buttons => { await page.evaluate(buttons => { for (let i = 0; i < testPad.buttons.length; i++) testPad.buttons[i] = {pressed: buttons.includes(i), value: buttons.includes(i) ? 1 : 0}; }, buttons); await frames(); };
  const press = async i => { await hold([i]); await hold([]); };
  const mode = expected => page.waitForFunction(expected => __ironwake.mode === expected, expected);
  await page.goto(`${home}/IRONWAKE/`); await page.waitForFunction(() => !!window.__ironwake); await frames();
  await press(0); await mode('docked');
  await press(15); assert.ok(await page.locator('[data-tab="market"].on').count());
  await press(14); assert.ok(await page.locator('[data-tab="wardroom"].on').count());
  await press(12); assert.equal(await page.evaluate(() => document.activeElement.dataset.act), 'launch');
  await press(0); await mode('flight');
  // Isolate input checks before restoring the live encounter director below.
  await page.evaluate(() => {
    const w = __ironwake.world; w.traffic = false; w.ships = [w.playerShip]; w.byId = new Map([[w.playerShip.id, w.playerShip]]);
    window.initialHeading = [...w.playerShip.body.orientation]; testPad.axes = [0.7, -1, 0.5, -0.3];
  });
  await page.waitForFunction(() => __ironwake.world.playerShip.throttle > 0.2);
  assert.ok(await page.evaluate(() => __ironwake.world.playerShip.body.orientation.some((v, i) => Math.abs(v - initialHeading[i]) > 0.01)));
  assert.ok(await page.evaluate(() => Math.abs(__ironwake.view.rel) > 0.1));
  await page.evaluate(() => { testPad.axes = [0, 0, 0, 0]; });
  await hold([1]); assert.equal(await page.evaluate(() => __ironwake.world.playerShip.throttle), 0); await hold([]);
  await press(14); assert.equal(await page.evaluate(() => __ironwake.view.rel), Math.PI / 2);
  await hold([7]); await page.waitForFunction(() => __ironwake.world.aim.t > 0.7);
  assert.equal(await page.evaluate(() => __ironwake.world.playerShip.battery.fired.port), 0, 'holding steadies but does not shoot');
  await hold([]); await page.waitForFunction(() => __ironwake.world.playerShip.battery.fired.port === 3);
  await hold([6]); assert.equal(await page.evaluate(() => __ironwake.world.playerShip.deflect.active), true); await hold([]);
  // A paused, charged broadside must be cancelled, even when resume is pressed with RT held.
  await press(15); await hold([7]); await page.waitForFunction(() => __ironwake.world.aim.t > 0.5);
  await hold([7, 9]); await mode('paused'); await hold([]);
  const paused = await page.evaluate(() => __ironwake.world.time); await frames(10);
  assert.equal(await page.evaluate(() => __ironwake.world.time), paused);
  await hold([7, 1]); await mode('flight'); await hold([7]); await frames(10);
  assert.equal(await page.evaluate(() => __ironwake.world.aim.t), 0);
  assert.equal(await page.evaluate(() => __ironwake.world.playerShip.battery.fired.star), 0);
  await hold([]); await hold([7]); await page.waitForFunction(() => __ironwake.world.aim.t > 0.5);
  await hold([]); await page.waitForFunction(() => __ironwake.world.playerShip.battery.fired.star === 3);

  await press(8); await mode('map');
  await press(13); await press(13); assert.ok(await page.evaluate(() => __ironwake.world.destination()?.station));
  await press(0); await mode('flight');
  assert.notEqual(await page.evaluate(() => __ironwake.world.playerShip.warp.state), 'off');
  await hold([1]); assert.equal(await page.evaluate(() => __ironwake.world.playerShip.warp.state), 'off'); await hold([]);
  await press(8); await mode('map'); await press(1); await mode('flight');
  // A deterministic live signal: fixtures position the ship, then ordinary simulation spawns the fleet.
  await page.evaluate(() => {
    const w = __ironwake.world; w.traffic = true; w.spawnT = Infinity;
    w.playerShip.body.position = [5000, 0, 5000]; w.playerShip.body.velocity = [0, 0, 0]; w.playerShip.throttle = 0;
    w.encounters.wait = 0; w.encounters.scan = 0;
    for (let i = 0; i < 540; i++) w.step(1 / 60);
  });
  assert.equal(await page.evaluate(() => __ironwake.world.encounters.active?.enemies?.length), 3);
  await press(11); assert.equal(await page.evaluate(() => __ironwake.world.dest), 'signal');
  await press(3); assert.ok(await page.evaluate(() => __ironwake.world.targetObject()?.faction === 'pennant'));
  const torps = await page.evaluate(() => __ironwake.world.playerShip.torps);
  await hold([2]);
  const firedAt = await page.evaluate(() => __ironwake.world.time);
  await page.waitForFunction(t => __ironwake.world.time > t + 2.6, firedAt);
  assert.equal(await page.evaluate(() => __ironwake.world.playerShip.torps), torps - 1, 'held X launches one torpedo'); await hold([]);
  mkdirSync(`${root}/evidence/browser`, {recursive: true});
  await page.screenshot({path: `${root}/evidence/browser/ironwake-free-roam.png`});
  await page.evaluate(() => {
    const w = __ironwake.world;
    for (const s of w.encounters.active.enemies) if (s.alive) w.damage(s, 1e7, 0, 0, w.playerShip);
  });
  await page.waitForFunction(() => __ironwake.player.patrols === 1);
  // Disconnect and neutral reconnect through the menu.
  await page.evaluate(() => { window.savedTestPad = testPad; window.testPad = null; }); await mode('paused');
  await page.evaluate(() => { window.testPad = savedTestPad; testPad.buttons[0] = {value: 1, pressed: true}; }); await frames(10); await mode('paused');
  await hold([]); await press(1); await mode('flight');
  // Dock with the controller and reload the saved patrol count.
  await page.evaluate(() => {
    const w = __ironwake.world, port = w.sector.stations[0]; w.traffic = false;
    w.playerShip.body.position = [port.pos[0] + port.radius + 300, 0, port.pos[2]];
    w.playerShip.body.velocity = [0, 0, 100]; w.playerShip.throttle = 0;
  });
  await hold([1]); await page.waitForFunction(() => Math.hypot(...__ironwake.world.playerShip.body.velocity) < 80); await hold([]);
  await press(0); await mode('docked');
  assert.ok((await page.locator('.st-body').innerText()).includes('1 shipping patrols resolved'));
  await page.reload(); await frames(10); await press(0); await mode('docked');
  assert.equal(await page.evaluate(() => __ironwake.player.patrols), 1);
  // A new captain's confirmation is also accessible without a native browser dialog.
  await page.reload(); await frames(10); await press(13); await press(0);
  assert.equal(await page.locator('dialog[open]').count(), 1);
  await press(0); assert.equal(await page.locator('dialog[open]').count(), 0);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('ironwake.save.v1')).patrols), 1);
  assert.deepEqual(errors, []);
  writeFileSync(`${root}/evidence/browser/ironwake-controller.json`, JSON.stringify({result: 'PASS', browser: browser.version(), input: 'synthetic standard Gamepad API', physicalControllerTested: false, checks: ['controller menu launch', 'station tabs', 'analog helm and aim', 'port and starboard volleys on release', 'deflector', 'pause cancels charged volley', 'neutral resume', 'chart course and warp', 'brake drops warp', 'live signal', 'hostile targeting', 'edge-only torpedoes', 'patrol reward', 'disconnect and neutral reconnect', 'brake and dock', 'save and continue', 'new-captain confirmation']}, null, 2) + '\n');
  console.log('IRONWAKE controller + free-roam browser: PASS');
} finally { await browser?.close(); server.close(); }
