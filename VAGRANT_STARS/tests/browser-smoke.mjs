// SPDX-License-Identifier: Apache-2.0
// Plays VAGRANT STARS through its interface in Chromium, from the staged site served under a
// project subpath exactly as GitHub Pages serves it. Needs Playwright: `npm run test:browser`.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {rmSync} from 'node:fs';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {createStaticServer} from '../../scripts/serve.mjs';
import {root} from '../../scripts/site.mjs';

const {chromium} = createRequire(import.meta.url)('playwright');
const stage = '_site_smoke';
execFileSync(process.execPath, [join(root, 'scripts/site.mjs'), 'build', `${stage}/OFFLINE-GAMES`, 'smoke'], {cwd: root});
const server = createStaticServer(join(root, stage));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const home = `http://127.0.0.1:${server.address().port}/OFFLINE-GAMES/`;
const browser = await chromium.launch({args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']});
try {
  const page = await browser.newPage({viewport: {width: 1280, height: 720}});
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
  const until = async (label, check, seconds = 40) => {
    for (let i = 0; i < seconds * 5; i++) { const state = await game(); if (check(state)) return state; await page.waitForTimeout(200); }
    assert.fail(`timed out waiting for: ${label} (${JSON.stringify(await game())})`);
  };

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
  await page.keyboard.down('KeyW'); await page.waitForTimeout(2500); await page.keyboard.up('KeyW');
  assert.ok((await game()).speed > 30, 'W opens the throttle');
  await page.mouse.down(); await page.waitForTimeout(400); await page.mouse.up();
  assert.ok(await page.evaluate(() => __vagrant.world.playerShip.energy < __vagrant.world.playerShip.maxEnergy), 'left mouse fires');

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

  assert.deepEqual(problems, []);
  console.log('browser smoke: PASS');
} finally {
  await browser.close(); server.close(); rmSync(join(root, stage), {recursive: true, force: true});
}
