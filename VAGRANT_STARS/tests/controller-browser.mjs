// SPDX-License-Identifier: Apache-2.0
// Synthetic standard Gamepad API samples drive the real application and DOM menus.
// This verifies browser integration, not a physical controller/OS driver.
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
    Object.defineProperty(navigator, 'getGamepads', {value: () => {
      if (!window.testPad) return [];
      const sample = {...testPad, buttons: testPad.buttons.map(b => ({...b}))};
      // A tap is exactly one input sample, even when a slow render frame exceeds menu-repeat time.
      if (window.testPulse) { window.testPulse = false; testPad.buttons = testPad.buttons.map(() => ({value: 0, pressed: false})); }
      return [sample];
    }});
  });
  const frames = (n = 5) => page.evaluate(n => new Promise(resolve => { const next = () => --n ? requestAnimationFrame(next) : resolve(); requestAnimationFrame(next); }), n);
  const hold = async buttons => { await page.evaluate(buttons => { for (let i = 0; i < testPad.buttons.length; i++) testPad.buttons[i] = {pressed: buttons.includes(i), value: buttons.includes(i) ? 1 : 0}; }, buttons); await frames(); };
  const press = async i => {
    await page.evaluate(i => { testPad.buttons = testPad.buttons.map((_, n) => ({value: n === i ? 1 : 0, pressed: n === i})); window.testPulse = true; }, i);
    await frames(6);
  };
  const mode = expected => page.waitForFunction(expected => __vagrant.mode === expected, expected);
  await page.goto(`${home}/VAGRANT_STARS/`); await page.waitForFunction(() => !!window.__vagrant); await frames();
  await press(0); await mode('docked'); // New captain through A, not a DOM click.
  await press(15); assert.ok(await page.locator('[data-tab="market"].on').count(), 'D-pad switches station tabs');
  await press(14); assert.ok(await page.locator('[data-tab="concourse"].on').count());
  // From the first tab, Up wraps to Launch, the final dock button.
  await press(12); assert.equal(await page.evaluate(() => document.activeElement.dataset.act), 'launch');
  await press(0); await mode('flight');
  await page.evaluate(() => { __vagrant.world.playerShip.invuln = true; testPad.axes = [0.4, -1, 0.7, -0.4]; });
  await page.waitForFunction(() => __vagrant.world.playerShip.throttle > 0.15);
  assert.ok(await page.evaluate(() => __vagrant.world.playerShip.body.orientation.some((v, i) => Math.abs(v - [0, 0, 0, 1][i]) > 0.01)));
  await page.evaluate(() => { testPad.axes = [0, 0, 0, 0]; });
  // Pause freezes simulation and a held trigger cannot bleed through resume.
  await press(9); await mode('paused');
  const paused = await page.evaluate(() => __vagrant.world.time); await frames(12);
  assert.equal(await page.evaluate(() => __vagrant.world.time), paused);
  await press(1); await mode('flight');
  await press(8); await mode('map'); await press(1); await mode('flight');
  // Deterministic fixture advances only the simulation clock to the first live signal.
  await page.evaluate(() => { const w = __vagrant.world; w.playerShip.throttle = 0; for (let i = 0; i < 1200; i++) w.step(1 / 60); });
  assert.ok(await page.evaluate(() => __vagrant.world.encounters.active?.enemies?.length === 2));
  await press(11); assert.equal(await page.evaluate(() => __vagrant.world.target.kind), 'signal');
  await press(0); assert.equal(await page.evaluate(() => __vagrant.world.auto?.target.kind), 'signal');
  await press(3); assert.equal(await page.evaluate(() => __vagrant.world.target.kind), 'ship');
  await hold([7]);
  await page.waitForFunction(() => __vagrant.world.playerShip.guns.some(g => g.cd > 0)); await hold([]);
  await press(5); assert.notEqual(await page.evaluate(() => __vagrant.world.playerShip.cruise.state), 'off'); await press(5);
  mkdirSync(`${root}/evidence/browser`, {recursive: true});
  await page.screenshot({path: `${root}/evidence/browser/vagrant-free-roam.png`});
  // Disconnect pauses; a held button on reconnect must first be released.
  await page.evaluate(() => { window.savedTestPad = testPad; window.testPad = null; }); await mode('paused');
  await page.evaluate(() => { window.testPad = savedTestPad; testPad.buttons[0] = {value: 1, pressed: true}; }); await frames(10); await mode('paused');
  await hold([]); await press(1); await mode('flight');
  // Dock at the saved port, then exercise the actual slingway docking regression.
  await page.evaluate(() => {
    const w = __vagrant.world; w.traffic = false; w.auto = null; w.playerShip.throttle = 0;
    for (const s of w.ships) if (!s.isPlayer) s.gone = true;
    const lane = w.sector.lanes.find(l => l.to.type === 'base' && l.from.type === 'base'), ring = lane.rings[0];
    w.playerShip.body.position = [...ring.pos]; w.targetPoi(ring.id); w.use();
    for (let i = 0; i < 3600 && w.playerShip.lane; i++) w.step(1 / 60);
    window.expectedDock = lane.to.id;
  });
  assert.equal(await page.evaluate(() => __vagrant.world.target.id === expectedDock), true);
  await press(0); await mode('docked');
  assert.equal(await page.evaluate(() => __vagrant.world.docked === expectedDock), true);
  await page.reload(); await frames(10); await press(0); await mode('docked');
  assert.ok(await page.locator('.st-shell').count(), 'controller-only Continue loads saved captain');
  assert.deepEqual(errors, []);
  writeFileSync(`${root}/evidence/browser/vagrant-controller.json`, JSON.stringify({result: 'PASS', browser: browser.version(), input: 'synthetic standard Gamepad API', physicalControllerTested: false, checks: ['menu launch', 'station tabs', 'analog flight', 'pause/resume', 'map', 'signal selection and approach', 'enemy selection', 'guns', 'cruise', 'disconnect and neutral reconnect', 'slingway arrival docking', 'save and continue']}, null, 2) + '\n');
  console.log('VAGRANT STARS controller + free-roam browser: PASS');
} finally { await browser?.close(); server.close(); }
