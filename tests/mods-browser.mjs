// SPDX-License-Identifier: Apache-2.0
// Test the staged distribution, including local pack selection and a cold offline reload.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {createStaticServer} from '../scripts/serve.mjs';
import {root} from '../scripts/site.mjs';
const {chromium} = createRequire(import.meta.url)('playwright');
const stage = '_site_mods', out = join(root, 'evidence/browser'); mkdirSync(out, {recursive: true});
execFileSync(process.execPath, ['scripts/site.mjs', 'build', `${stage}/OFFLINE-GAMES`, 'mods-browser']);
const server = createStaticServer(join(root, stage)); await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/OFFLINE-GAMES/`;
let browser; const report = [];
try {
  browser = await chromium.launch({executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']});
  for (const [folder, h, key] of [['VAGRANT_STARS', '__vagrant', 'vagrant-stars.save.v1'], ['IRONWAKE', '__ironwake', 'ironwake.save.v1']]) {
    const context = await browser.newContext({viewport: {width: 1280, height: 800}, reducedMotion: 'reduce'}), page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { assert.ok(r.url().startsWith(base), `non-local request ${r.url()}`); });
    await page.addInitScript(() => {
      window.testPad = {index: 0, id: 'Mod menu controller', connected: true, mapping: 'standard', axes: [0,0,0,0], buttons: Array.from({length: 17}, () => ({pressed: false, value: 0}))};
      Object.defineProperty(navigator, 'getGamepads', {value: () => {
        const sample = {...testPad, buttons: testPad.buttons.map(b => ({...b}))};
        if (window.testPulse) { window.testPulse = false; testPad.buttons = testPad.buttons.map(() => ({pressed: false, value: 0})); }
        return [sample];
      }});
    });
    const frames = (n = 5) => page.evaluate(n => new Promise(resolve => { const next = () => --n ? requestAnimationFrame(next) : resolve(); requestAnimationFrame(next); }), n);
    const press = async i => { await page.evaluate(i => { testPad.buttons[i] = {pressed: true, value: 1}; window.testPulse = true; }, i); await frames(6); };
    const ready = () => page.waitForFunction(h => !!globalThis[h]?.scene.vp, h);
    const mode = m => page.waitForFunction(({h,m}) => globalThis[h]?.mode === m, {h,m});
    const dock = async () => {
      await page.evaluate(h => {
        const w = globalThis[h].world, port = w.sector.byId.get(h === '__vagrant' ? 'calder' : 'anchorage');
        w.playerShip.body.position = [...port.pos]; w.playerShip.body.velocity = [0,0,0]; w.playerShip.throttle = 0;
        if (h === '__vagrant') w.targetPoi('calder'); w.use();
      }, h);
      await mode('docked');
    };
    await page.goto(`${base}${folder}/`); await ready(); await page.click('#btn-new'); await mode('docked');
    const original = await page.evaluate(key => localStorage.getItem(key), key); assert.ok(original);
    await page.goto(`${base}${folder}/`); await ready(); await page.click('#btn-mods'); await mode('workshop'); await frames();
    await page.screenshot({path: join(out, `${folder}-mods.png`)});
    await press(1); await mode('menu'); // B leaves the workshop.
    await page.click('#btn-mods'); await frames(); await press(13); await press(13);
    assert.equal(await page.evaluate(() => document.activeElement.dataset.profile), 'independence-kit/explorer');
    // Click is dispatched by A through the production ControllerMenu; reload resets all input.
    await Promise.all([page.waitForURL(/mode=explorer/), page.evaluate(() => { testPad.buttons[0] = {pressed: true, value: 1}; window.testPulse = true; })]);
    await ready(); assert.equal(await page.locator('#btn-continue').isVisible(), false);
    await page.click('#btn-new'); await mode('docked');
    assert.equal(await page.evaluate(h => globalThis[h].player.hull, h), 'liberty');
    await page.click('[data-tab="contracts"]'); await page.click('[data-job="mod:independence-kit:first-survey"]');
    await page.click('[data-act="launch"]'); await mode('flight'); await frames();
    const played = await page.evaluate(h => {
      const g = globalThis[h], w = g.world, m = g.player.mission, before = g.player.credits;
      if (!m) throw new Error('survey not accepted');
      w.playerShip.body.position = h === '__vagrant' ? [...m.waypoint] : [m.pos[0], 0, m.pos[1]];
      w.playerShip.body.velocity = [0,0,0]; w.playerShip.throttle = 0;
      for (let i = 0; i < 500; i++) w.step(1/60, {});
      return {mission: g.player.mission, reward: g.player.credits - before, gl: g.scene.gl.getError(), soundFrames: g.audio.buffers.get('dock').length};
    }, h);
    assert.equal(played.mission, null); assert.equal(played.reward, 1500); assert.equal(played.gl, 0); assert.ok(played.soundFrames >= 18000 && played.soundFrames <= 20000);
    await frames(); await page.screenshot({path: join(out, `${folder}-liberty.png`)}); await dock();
    const explorerKey = `${key}.mod.independence-kit@1.0.0/explorer`;
    assert.equal(await page.evaluate(key => localStorage.getItem(key), key), original);
    assert.ok(JSON.parse(await page.evaluate(key => localStorage.getItem(key), explorerKey)).modState.completed.includes('first-survey'));
    // Wait for the complete precache, then reload the profile without any network.
    await page.evaluate(async () => {
      await navigator.serviceWorker.register('../sw.js'); await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, {once: true}));
    });
    await context.setOffline(true); await page.reload(); await ready(); await page.click('#btn-continue'); await mode('docked');
    assert.ok(await page.evaluate(h => globalThis[h].player.modState.completed.includes('first-survey'), h));
    await page.goto(`${base}${folder}/?mod=independence-kit&mode=arena`); await ready();
    assert.equal(await page.locator('#btn-continue').isVisible(), false); await page.click('#btn-new'); await mode('docked'); await page.click('[data-act="launch"]'); await mode('flight');
    const arena = await page.evaluate(h => {
      const g = globalThis[h], w = g.world, before = g.player.credits;
      for (let wave = 0; wave < 3; wave++) {
        for (let i = 0; i < 600 && !w.mod.enemies; i++) w.step(1/60, {});
        if (!w.mod.enemies) throw new Error('arena did not spawn');
        for (const ship of w.mod.enemies) ship.alive = false;
        w.step(1/60, {});
      }
      return {won: g.player.modState.mode.won, reward: g.player.credits - before, profile: g.modProfile};
    }, h);
    assert.equal(arena.won, true); assert.equal(arena.reward, 6000); await frames(); await dock();
    await page.goto(`${base}${folder}/`); await ready(); await page.click('#btn-continue'); await mode('docked');
    assert.equal(await page.evaluate(h => globalThis[h].player.modProfile, h), undefined);
    assert.equal(await page.evaluate(key => localStorage.getItem(key), key), original);
    assert.deepEqual(errors, []);
    // Unknown profiles stop boot visibly, while every valid save remains intact.
    await page.goto(`${base}${folder}/?mod=missing-pack`); await page.waitForSelector('#fail:not([hidden])');
    assert.match(await page.locator('#fail-text').textContent(), /unknown installed pack/);
    assert.equal(await page.evaluate(key => localStorage.getItem(key), key), original);
    assert.equal(errors.length, 1); assert.match(errors[0], /unknown installed pack/);
    report.push({folder, ...played, ...arena, offlineReload: true, originalSaveUnchanged: true, controllerWorkshop: true});
    await context.close();
  }
  writeFileSync(join(out, 'mods.json'), JSON.stringify({browser: browser.version(), games: report}, null, 2) + '\n');
  console.log(JSON.stringify(report));
} finally { await browser?.close(); await new Promise(r => server.close(r)); rmSync(join(root, stage), {recursive: true, force: true}); }
