// SPDX-License-Identifier: Apache-2.0
// Plays VAGRANT STARS through its interface in Chromium, from the staged site served under a
// project subpath exactly as GitHub Pages serves it. Needs Playwright: `npm run test:browser`.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync, rmSync} from 'node:fs';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {createStaticServer} from '../../scripts/serve.mjs';
import {root} from '../../scripts/site.mjs';
import {waitForState} from '../../tests/browser-wait.mjs';

const {chromium} = createRequire(import.meta.url)('playwright');
const stage = '_site_smoke';
execFileSync(process.execPath, [join(root, 'scripts/site.mjs'), 'build', `${stage}/OFFLINE-GAMES`, 'smoke'], {cwd: root});
const server = createStaticServer(join(root, stage));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const home = `http://127.0.0.1:${server.address().port}/OFFLINE-GAMES/`;
const browser = await chromium.launch({executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']});
try {
  const page = await browser.newPage({viewport: {width: 1280, height: 720}});
  // SMOKE_CPU_THROTTLE=6 slows the page sixfold, to rehearse a loaded CI runner locally.
  if (process.env.SMOKE_CPU_THROTTLE) await (await page.context().newCDPSession(page)).send('Emulation.setCPUThrottlingRate', {rate: Number(process.env.SMOKE_CPU_THROTTLE)});
  const problems = [];
  page.on('pageerror', error => problems.push(`error: ${error.message}`));
  page.on('console', message => { if (message.type() === 'error') problems.push(`console: ${message.text()}`); });
  page.on('response', response => { if (response.status() >= 400) problems.push(`${response.status()} ${response.url()}`); });
  page.on('request', request => { if (!request.url().startsWith(home) && !request.url().startsWith('data:')) problems.push(`left the site: ${request.url()}`); });
  const game = () => page.evaluate(() => {
    const g = globalThis.__vagrant, w = g.world, s = w?.playerShip;
    return {mode: g.mode, system: w?.system.id, docked: w?.docked ?? null, speed: s ? Math.hypot(...s.body.velocity) : 0, lane: !!s?.lane, ships: w?.ships.length ?? 0,
      credits: g.player?.credits, cargo: g.player?.cargo, drawn: g.scene.far.n + g.scene.near.n};
  });
  const until = (label, check, seconds = 40) => waitForState(label, game, check, seconds, ms => page.waitForTimeout(ms));

  // Collection page -> game.
  await page.goto(home);
  assert.match(await page.title(), /OFFLINE GAMES/);
  assert.ok(await page.locator('#vagrant-stars .shot img').evaluate(img => img.complete && img.naturalWidth > 0), 'the screenshot loads');
  await page.click('a.button[href="VAGRANT_STARS/"]');
  await page.waitForSelector('#btn-new');
  await page.waitForTimeout(600);
  assert.ok((await game()).drawn > 0, 'the title backdrop is rendering');
  assert.equal(await page.locator('#btn-continue').isHidden(), true);

  // New captain: trade at the station, then launch.
  await page.click('#btn-new');
  await page.waitForSelector('.st-shell');
  assert.match(await page.locator('.st-head h1').innerText(), /Calder Orbital Dock/);
  await page.click('[data-tab="market"]');
  await page.click('[data-act="buy"][data-good="medgel"][data-n="10"]');
  assert.equal((await game()).cargo.medgel, 10);
  for (const tab of ['outfitter', 'shipyard', 'contracts']) { await page.click(`[data-tab="${tab}"]`); assert.ok(await page.locator('.st-body .card').count() > 0, tab); }
  await page.click('[data-act="launch"]');
  await until('flight', s => s.mode === 'flight');
  await page.mouse.move(700, 340);
  // Observe each effect while the input is still held: a slow machine must not turn a fixed
  // sleep into a failure (gun energy recharges within half a second of releasing the trigger).
  await page.keyboard.down('KeyW'); await until('W opens the throttle', s => s.speed > 30, 30); await page.keyboard.up('KeyW');
  await page.mouse.down();
  await until('left mouse fires', () => page.evaluate(() => __vagrant.world.bolts.size > 0 || __vagrant.world.playerShip.energy < __vagrant.world.playerShip.maxEnergy), 15);
  await page.mouse.up();

  // Map, pause and resume.
  await page.keyboard.press('KeyM'); await until('map', s => s.mode === 'map', 5);
  await page.keyboard.press('KeyM'); await until('map closed', s => s.mode === 'flight', 5);
  await page.keyboard.press('Escape'); await until('pause', s => s.mode === 'paused', 5);
  await page.click('#btn-resume'); await until('resume', s => s.mode === 'flight', 5);

  // Ride the slingway to Tollard and dock there.
  await page.evaluate(() => { const w = __vagrant.world; w.targetPoi(w.sector.pois.find(p => p.type === 'ring' && !p.minor && p.name.includes('Tollard')).id); });
  await page.keyboard.press('KeyF');
  await until('slingway', s => s.lane);
  await until('slingway exit', s => !s.lane);
  await page.evaluate(() => __vagrant.world.targetPoi('tollard'));
  await page.keyboard.press('KeyF');
  await until('docked at Tollard', s => s.mode === 'docked' && s.docked === 'tollard', 60);
  assert.match(await page.locator('.st-head h1').innerText(), /Tollard Station/);
  await page.click('[data-tab="contracts"]');
  assert.match(await page.locator('.job.story h2').innerText(), /Quiet Signal/);
  await page.click('.job.story [data-act="accept"]');

  // The docked state is saved: reload and continue.
  await page.reload(); await page.waitForSelector('#btn-continue:not([hidden])');
  await page.click('#btn-continue'); await page.waitForSelector('.st-shell');
  assert.match(await page.locator('.st-head h1').innerText(), /Tollard Station/);
  assert.equal((await game()).cargo.medgel, 10);
  assert.ok(await page.evaluate(() => __vagrant.player.mission?.story === 0), 'the accepted contract survived the reload');

  // Jump to Kessa, then lose the ship and return to the last port.
  await page.click('[data-act="launch"]'); await until('flight again', s => s.mode === 'flight');
  await page.evaluate(() => { const w = __vagrant.world, g = w.sector.byId.get('g-kessa'); w.playerShip.body.position = [g.pos[0] + 400, g.pos[1], g.pos[2]]; w.targetPoi('g-kessa'); });
  await page.keyboard.press('KeyF');
  await until('arrival in Kessa', s => s.system === 'kessa');
  await page.evaluate(() => __vagrant.world.damage(__vagrant.world.playerShip, 1e6, 1e6, null));
  await until('ship lost screen', s => s.mode === 'dead');
  await page.click('#btn-restore'); await page.waitForSelector('.st-shell');
  assert.match(await page.locator('.st-head h1').innerText(), /Tollard Station/);

  // Regression: Calder's original straight slingway crossed the atmosphere.
  // Exercise the rendered map, both directions, destination selection and F use.
  await page.click('[data-act="launch"]'); await until('transit regression flight', s => s.mode === 'flight');
  await page.evaluate(() => {
    const w = __vagrant.world;
    w.traffic = false; w.player.mission = null; w.enterSystem('meridian', {base: 'calder'});
    const lane = w.sector.lanes.find(l => l.to.id === 'g-ostrava');
    w.playerShip.body.position = [...lane.rings[0].pos]; w.targetPoi(lane.rings[0].id);
    globalThis.transitHits = 0;
    const damage = w.damage.bind(w);
    w.damage = (ship, ...args) => { if (ship.isPlayer) globalThis.transitHits++; return damage(ship, ...args); };
  });
  await page.keyboard.press('KeyM'); await until('safe transit map', s => s.mode === 'map', 5);
  mkdirSync(join(root, 'evidence/browser'), {recursive: true});
  await page.screenshot({path: join(root, 'evidence/browser/VAGRANT_STARS-safe-transit-map.png')});
  await page.keyboard.press('KeyM'); await until('safe transit flight', s => s.mode === 'flight', 5);
  await page.keyboard.press('KeyF'); await until('Calder slingway', s => s.lane);
  await until('Ostrava gate slingway exit', s => !s.lane);
  assert.equal(await page.evaluate(() => __vagrant.world.target.id), 'g-ostrava');
  await page.keyboard.press('KeyF'); await until('safe arrival in Ostrava', s => s.system === 'ostrava');
  await page.evaluate(() => __vagrant.world.targetPoi('g-meridian'));
  await page.keyboard.press('KeyF'); await until('return to Meridian', s => s.system === 'meridian');
  await page.evaluate(() => {
    const w = __vagrant.world, lane = w.sector.lanes.find(l => l.to.id === 'g-ostrava');
    w.targetPoi(lane.rings.at(-1).id);
  });
  await page.keyboard.press('KeyF'); await until('return slingway', s => s.lane);
  await until('Calder slingway exit', s => !s.lane);
  assert.equal(await page.evaluate(() => __vagrant.world.target.id), 'calder');
  await page.keyboard.press('KeyF'); await until('safe Calder docking', s => s.mode === 'docked' && s.docked === 'calder');
  assert.equal(await page.evaluate(() => globalThis.transitHits), 0, 'the full gate round trip must not cause damage');

  assert.deepEqual(problems, []);
  console.log('browser smoke: PASS');
} finally {
  await browser.close(); server.close(); rmSync(join(root, stage), {recursive: true, force: true});
}
