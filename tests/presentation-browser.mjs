// SPDX-License-Identifier: Apache-2.0
// Chromium evidence for the real WebGL/Web Audio paths and mouse remapping.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {createStaticServer} from '../scripts/serve.mjs';
import {root} from '../scripts/site.mjs';
const {chromium} = createRequire(import.meta.url)('playwright');
const stage = '_site_presentation', out = join(root, 'evidence/browser'); mkdirSync(out, {recursive: true});
execFileSync(process.execPath, [join(root, 'scripts/site.mjs'), 'build', `${stage}/OFFLINE-GAMES`, 'presentation']);
const server = createStaticServer(join(root, stage)); await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/OFFLINE-GAMES/`;
const browser = await chromium.launch({executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']});
const report = {browser: browser.version(), games: []};
try {
  for (const [folder, handle] of [['IRONWAKE', '__ironwake'], ['VAGRANT_STARS', '__vagrant']]) {
    const context = await browser.newContext({viewport: {width: 1440, height: 900}, reducedMotion: 'reduce'}), page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
    page.on('request', r => { if (!r.url().startsWith(base)) errors.push(`external request ${r.url()}`); });
    await page.goto(`${base}${folder}/?renderer=webgl`); await page.waitForSelector('#btn-new'); await page.waitForFunction(h => globalThis[h]?.scene.vp, handle);
    await page.screenshot({path: join(out, `${folder}-title.png`)});
    await page.click('#btn-new'); await page.waitForSelector('.st-shell');
    await page.screenshot({path: join(out, `${folder}-port.png`)});
    await page.click('[data-act="launch"]');
    await page.waitForFunction(h => globalThis[h].mode === 'flight', handle);
    await page.screenshot({path: join(out, `${folder}-flight.png`)});
    // Place one stationary hostile in the view; freeze simulation while exercising selection.
    const target = await page.evaluate(h => {
      const g = globalThis[h], w = g.world, s = g.scene, iron = h === '__ironwake';
      const direction = s.ray(0.32, 0.1, innerWidth / innerHeight), origin = s.cam.pos;
      const distance = iron ? -origin[1] / direction[1] : 500;
      const pos = origin.map((v, i) => v + direction[i] * distance);
      const group = iron ? w.spawnSquadron({faction: 'pennant', threat: 2, pos: [pos[0], pos[2]]}) : w.spawnGroup({faction: 'reavers', role: 'raider', count: 1, tier: 1, pos});
      const ship = iron ? group[0] : w.ships.find(ship => ship.ai?.group === group.id); ship.body.position = pos; ship.prevPos = [...pos]; ship.body.velocity = [0,0,0];
      for (const other of w.ships) if (!other.isPlayer && other !== ship) { other.gone = true; other.alive = false; }
      w.target = null; w.step = () => {}; // isolates the UI from combat and camera shake
      const p = s.project(pos, innerWidth, innerHeight);
      return {id: ship.id, x: p.x, y: p.y};
    }, handle);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    await page.mouse.click(target.x, target.y, {button: 'right'});
    const selected = await page.evaluate(h => {const w = globalThis[h].world; return h === '__ironwake' ? w.target : w.target?.id;}, handle);
    assert.equal(selected, target.id, `${folder}: right click selects the hostile`);
    await page.mouse.click(20, 80, {button: 'right'});
    assert.equal(await page.evaluate(h => {const w = globalThis[h].world; return h === '__ironwake' ? w.target : w.target?.id;}, handle), target.id, 'empty space preserves selection');
    const evidence = await page.evaluate(async h => {
      const g = globalThis[h], gl = g.scene.gl, audio = g.audio, before = g.scene.environment.bakes;
      for (let i = 0; i < 200; i++) audio.play('hit');
      const voices = audio.voices.size;
      // Render actual audio graphs offline, including mastering, stereo room and compressor.
      const {GameAudio} = await import('./js/audio.js');
      const Offline = globalThis.OfflineAudioContext;
      const ctx = new Offline(2, 48000 * 4, 48000);
      const Original = globalThis.AudioContext; globalThis.AudioContext = function () { return ctx; };
      let probe;
      try { probe = new GameAudio(); probe.unlock(); } finally { globalThis.AudioContext = Original; }
      // Offline contexts start suspended; directly schedule the already baked buffer through its bus.
      const src = ctx.createBufferSource(); src.buffer = probe.buffers.get(h === '__ironwake' ? 'broadside' : 'pulse'); src.connect(probe.sfx); src.start(0.05);
      const rendered = await ctx.startRendering(); let peak = 0, sum = 0, finite = true;
      for (let ch = 0; ch < 2; ch++) for (const x of rendered.getChannelData(ch)) { finite &&= Number.isFinite(x); peak = Math.max(peak, Math.abs(x)); sum += x*x; }
      await new Promise(resolve => requestAnimationFrame(resolve));
      return {textures: g.scene.environment.textures.size, bakes: before, afterBakes: g.scene.environment.bakes, glError: gl.getError(), voices, audio: {finite, peak, energy: sum}};
    }, handle);
    assert.equal(evidence.glError, 0); assert.equal(evidence.bakes, evidence.afterBakes); assert.ok(evidence.voices <= 32);
    assert.ok(evidence.audio.finite && evidence.audio.peak > 0.01 && evidence.audio.peak <= 1 && evidence.audio.energy > 0);
    assert.deepEqual(errors, []); report.games.push({folder, ...evidence});
    await page.screenshot({path: join(out, `${folder}-target.png`)});
    // Frame the planets through the production renderer; no screenshot-only artwork.
    const known = await page.evaluate(async h => {
      const data = await import('./js/sim/data.js'); return h === '__ironwake' ? ['banks'] : Object.keys(data.SYSTEMS);
    }, handle);
    for (const system of known) {
      await page.evaluate(async ({h, system}) => {
        const g = globalThis[h], w = g.world, scene = g.scene, data = await import('./js/sim/data.js');
        if (h === '__vagrant') { w.enterSystem(system); scene.setSystem(w.system); }
        const planet = (h === '__ironwake' ? data.SECTOR : w.system).planets[0];
        const cam = {pos: [planet.pos[0], planet.pos[1] + planet.radius * 0.15, planet.pos[2] + planet.radius * 3.1], q: [0,0,0,1]};
        scene.originalDraw ??= scene.draw.bind(scene);
        scene.draw = () => scene.originalDraw(w, cam, new Map(), 0, 0);
        document.querySelector('#hud').style.visibility = 'hidden';
      }, {h: handle, system});
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
      await page.screenshot({path: join(out, `${folder}-${system}-planet.png`)});
      assert.equal(await page.evaluate(h => globalThis[h].scene.gl.getError(), handle), 0);
      assert.ok(await page.evaluate(h => globalThis[h].scene.environment.textures.size <= 3, handle), 'system transitions retain only current textures');
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('presentation browser: PASS', JSON.stringify(report));
} finally { await browser.close(); server.close(); rmSync(join(root, stage), {recursive: true, force: true}); }

// Keep the established CI entry point covering the default CPU path as well as
// the explicit legacy WebGL presentation checks above.
await import('./visual-overhaul-browser.mjs');

await import('./render-regressions-browser.mjs');
