// SPDX-License-Identifier: Apache-2.0
// Plays IRONWAKE through its interface in Chromium, from the staged site served under a
// project subpath exactly as GitHub Pages serves it. Needs Playwright: `npm run test:browser`.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {rmSync} from 'node:fs';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {createStaticServer} from '../../scripts/serve.mjs';
import {root} from '../../scripts/site.mjs';

const {chromium} = createRequire(import.meta.url)('playwright');
const stage = '_site_smoke_ironwake';
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
    const g = globalThis.__ironwake, w = g.world, s = w?.playerShip;
    return {mode: g.mode, docked: w?.docked ?? null, speed: s ? Math.hypot(s.body.velocity[0], s.body.velocity[2]) : 0, warp: s?.warp.state, shells: w?.shells.length ?? 0, ships: w?.ships.length ?? 0,
      cargo: g.player?.cargo, credits: g.player?.credits, drawn: g.scene.far.n + g.scene.near.n, rel: g.view.rel};
  });
  const until = async (label, check, seconds = 40) => {
    for (let i = 0; i < seconds * 5; i++) { const state = await game(); if (check(state)) return state; await page.waitForTimeout(200); }
    assert.fail(`timed out waiting for: ${label} (${JSON.stringify(await game())})`);
  };

  // Collection page: both games are offered, and the IRONWAKE link opens it.
  await page.goto(home);
  assert.deepEqual(await page.locator('a.button').evaluateAll(links => links.map(a => a.getAttribute('href'))), ['VAGRANT_STARS/', 'IRONWAKE/']);
  assert.ok(await page.locator('.shot img').evaluateAll(images => images.every(img => img.complete && img.naturalWidth > 0)), 'both screenshots load');
  await page.click('a.button[href="IRONWAKE/"]');
  await page.waitForSelector('#btn-new'); await page.waitForTimeout(600);
  assert.match(await page.title(), /IRONWAKE/); assert.ok((await game()).drawn > 0, 'the title backdrop is rendering');

  // New captain: trade, look over the dockyard, cast off.
  await page.click('#btn-new'); await page.waitForSelector('.st-shell');
  assert.match(await page.locator('.st-head h1').innerText(), /Anchorage Prime/);
  await page.click('[data-tab="market"]'); await page.click('[data-act="buy"][data-good="water"][data-n="10"]');
  assert.equal((await game()).cargo.water, 10);
  for (const tab of ['dockyard', 'contracts']) { await page.click(`[data-tab="${tab}"]`); assert.ok(await page.locator('.st-body .card').count() > 0, tab); }
  assert.match(await page.locator('.job.story h2').innerText(), /Most Wanted I/);
  await page.click('[data-act="launch"]'); await until('at sea', s => s.mode === 'flight');
  await page.keyboard.down('KeyW'); await page.waitForTimeout(2500); await page.keyboard.up('KeyW');
  assert.ok((await game()).speed > 15, 'W opens the throttle');

  // Look to starboard with the arrow keys, steady and fire a broadside with Space.
  await page.keyboard.down('ArrowRight'); await until('looking to starboard', s => s.rel < -1.2, 10); await page.keyboard.up('ArrowRight');
  await page.keyboard.down('Space'); await until('guns steadying', () => page.evaluate(() => __ironwake.world.aim.side === 'star' && __ironwake.world.aim.t > 0.5), 10);
  await page.keyboard.up('Space'); await until('broadside fired', s => s.shells >= 2, 5);
  // Dragging the view also turns the camera.
  const before = (await game()).rel; await page.mouse.move(640, 300); await page.mouse.down(); await page.mouse.move(520, 300, {steps: 6}); await page.mouse.up();
  await until('drag look', s => Math.abs(s.rel - before) > 0.1, 5);

  // Chart, pause and resume.
  await page.keyboard.press('KeyM'); await until('chart', s => s.mode === 'map', 5);
  await page.keyboard.press('KeyM'); await until('chart closed', s => s.mode === 'flight', 5);
  await page.keyboard.press('KeyP'); await until('pause', s => s.mode === 'paused', 5);
  await page.click('#btn-resume'); await until('resume', s => s.mode === 'flight', 5);

  // Plot a course, warp to Coldharbor, sail in and dock.
  await page.evaluate(() => { const w = __ironwake.world; w.traffic = false; for (const s of w.ships) if (!s.isPlayer) s.gone = true; w.selectDest('coldharbor'); });
  await page.keyboard.press('KeyJ'); await until('warp', s => s.warp === 'on', 10); await until('warp exit', s => s.warp === 'off', 60);
  await page.evaluate(() => { const w = __ironwake.world, port = w.sector.byId.get('coldharbor'), me = w.playerShip; me.body.position = [port.pos[0] + port.radius + 300, 0, port.pos[2]]; me.body.velocity = [0, 0, 0]; me.throttle = 0; });
  await page.keyboard.press('KeyF'); await until('docked at Coldharbor', s => s.mode === 'docked' && s.docked === 'coldharbor', 10);
  assert.match(await page.locator('.st-head h1').innerText(), /Coldharbor Exchange/);

  // The docked state is saved: reload and continue. Then lose the ship and return to port.
  await page.reload(); await page.waitForSelector('#btn-continue:not([hidden])'); await page.click('#btn-continue'); await page.waitForSelector('.st-shell');
  assert.match(await page.locator('.st-head h1').innerText(), /Coldharbor Exchange/); assert.equal((await game()).cargo.water, 10);
  await page.click('[data-act="launch"]'); await until('at sea again', s => s.mode === 'flight');
  await page.evaluate(() => __ironwake.world.damage(__ironwake.world.playerShip, 1e7, 0, 0, null));
  await until('ship lost screen', s => s.mode === 'dead'); await page.click('#btn-restore'); await page.waitForSelector('.st-shell');
  assert.match(await page.locator('.st-head h1').innerText(), /Coldharbor Exchange/);

  assert.deepEqual(problems, []);
  console.log('ironwake browser smoke: PASS');
} finally {
  await browser.close(); server.close(); rmSync(join(root, stage), {recursive: true, force: true});
}
