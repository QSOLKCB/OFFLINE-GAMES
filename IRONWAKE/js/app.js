// SPDX-License-Identifier: Apache-2.0
// IRONWAKE application shell: input, fixed-step loop, orbit camera, sound and screens.
import {Actions, attachKeyboard, attachMouseLook} from '../vendor/vanillajs/modules/input/index.js';
import {FixedClock} from '../vendor/vanillajs/modules/time/index.js';
import {quatInterpolate, quatMultiply, clamp} from '../vendor/vanillajs/modules/math/index.js';
import {Scene} from './render.js';
import {drawHud, drawMap, mapPick} from './hud.js';
import {StationUI} from './ui.js';
import {GameAudio} from './audio.js';
import {World, headingOf} from './sim/world.js';
import {newPlayer, sanitizeSave} from './sim/player.js';
import {STATIONS} from './sim/data.js';

const SAVE_KEY = 'ironwake.save.v1', SETTINGS_KEY = 'ironwake.settings.v1', STEP = 1 / 60;
const $ = id => document.getElementById(id);
const view = $('view'), hud = $('hud'), flash = $('flash'), ctx = hud.getContext('2d');
const overlays = {menu: $('menu'), help: $('help'), pause: $('pause'), dead: $('dead'), station: $('station'), fail: $('fail')};
const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); return true; } catch { return false; } },
};

let scene;
try { scene = new Scene(view); scene.setSky(); } catch (error) {
  $('fail-text').textContent = `${error.message} IRONWAKE needs WebGL.`;
  overlays.menu.hidden = true; overlays.fail.hidden = false;
  throw error;
}
const audio = new GameAudio();
const settings = {sfx: 0.7, music: 0.5, tips: false, ...(() => { try { return JSON.parse(store.get(SETTINGS_KEY)) ?? {}; } catch { return {}; } })()};
audio.setVolumes(settings.sfx, settings.music);
const saveSettings = () => store.set(SETTINGS_KEY, JSON.stringify(settings));

const bindings = {KeyW: 'up', KeyS: 'down', KeyA: 'port', KeyD: 'starboard', ShiftLeft: 'boost', ShiftRight: 'boost', Space: 'fire', KeyE: 'deflect', KeyQ: 'torpedo',
  KeyR: 'hostile', KeyT: 'next', Tab: 'next', KeyN: 'course', KeyJ: 'warp', KeyF: 'use', KeyM: 'map', KeyP: 'pause', Escape: 'pause',
  ArrowLeft: 'lookLeft', ArrowRight: 'lookRight', ArrowUp: 'lookUp', ArrowDown: 'lookDown'};
const actions = new Actions(), clock = new FixedClock({step: STEP, maxSteps: 6});
let mode = 'menu', world = null, player = null, backdrop = null, last = null, helpFrom = 'menu';
let castOff = 0, cursor = null, pendingTorpedo = false, deflectHeld = false, triggerHeld = false, shake = 0, lastAlert = 0, tipAt = 0, tipIndex = 0, banner = null;
const view3 = {rel: 0, pitch: 0.42, zoom: 1}; // camera yaw relative to the bow, look-down angle, distance factor
const sailing = () => mode === 'flight';
const keyboard = attachKeyboard(window, actions, {bindings, enabled: () => mode === 'flight' || mode === 'map'});
// Pointer lock ends when the player presses Esc, which is the pause gesture.
const look = attachMouseLook(hud, {enabled: sailing, onUnlock: () => { if (mode === 'flight') setMode('paused'); }});
const cam = {pos: [0, 0, 0], q: [0, 0, 0, 1]}, poses = new Map(), messages = [];
const TIPS = ['Move the mouse to look around. W and S set the throttle; A and D work the rudder.', 'Look to port or starboard, hold the left button (or Space) to steady the guns, and release to fire.',
  'Hold the right button (or E) to raise the deflector when a salvo comes in. It must recharge after.', 'Press N to plot a course to a port and J to warp there. F docks when you are close and slow.',
  'Small rocks crack under a broadside. Ore and cargo drift into your hold on their own.'];

function setMode(next) {
  mode = next;
  for (const [name, node] of Object.entries(overlays)) node.hidden = !((name === 'menu' && next === 'menu') || (name === 'help' && next === 'help') || (name === 'pause' && next === 'paused')
    || (name === 'dead' && next === 'dead') || (name === 'station' && next === 'docked'));
  clock.setPaused(next !== 'flight'); keyboard.clear(); pendingTorpedo = false; deflectHeld = false; triggerHeld = false; last = null;
  if (next !== 'flight') look.release();
  hud.style.visibility = next === 'flight' || next === 'map' ? 'visible' : 'hidden';
  hud.style.cursor = next === 'map' ? 'default' : 'none';
  if (next === 'flight' || next === 'map') hud.focus({preventScroll: true}); else if (document.activeElement === hud) hud.blur();
}
function say(text, tone = 'info', from = null) { messages.push({text, tone, from, ttl: 7}); while (messages.length > 7) messages.shift(); }
const save = () => { if (player) store.set(SAVE_KEY, JSON.stringify(player)); };
const loadSave = () => sanitizeSave(store.get(SAVE_KEY));

const station = new StationUI(overlays.station, {
  onChange: save, sound: name => audio.play(name, {gain: 0.6}),
  onLaunch() {
    save(); world.launch(); drainEvents(); messages.length = 0; view3.rel = 0; view3.pitch = 0.42;
    setMode('flight'); castOff = world.time;
    if (!settings.tips) { tipIndex = 0; tipAt = world.time + 1.5; }
    say(`Cast off from ${STATIONS[player.station].name}.`, 'good');
  },
});
function openStation(result = null, welcome = false) { save(); station.open(player, player.station, result, welcome); setMode('docked'); }
function begin(state, welcome) {
  player = state; world = new World(player); world.events.length = 0; world.docked = player.station; backdrop = null;
  openStation(null, welcome);
}

// Simulation events -> sound, effects and screens ---------------------------------------------
function heard(pos, name, base = 1, range = 2600, rate = 1) {
  const rel = [pos[0] - cam.pos[0], pos[1] - cam.pos[1], pos[2] - cam.pos[2]], d = Math.hypot(...rel) || 1, right = scene.right;
  audio.play(name, {gain: base * Math.max(0, 1 - d / range) ** 1.5, pan: (rel[0] * right[0] + rel[1] * right[1] + rel[2] * right[2]) / d, rate});
}
function drainEvents() {
  for (const e of world.events) {
    switch (e.type) {
      case 'msg':
        say(e.text, e.tone, e.from ?? null);
        if (e.tone === 'warn' && performance.now() - lastAlert > 1500) { lastAlert = performance.now(); audio.play('alert', {gain: 0.5}); }
        break;
      case 'shot':
        scene.onEvent(e);
        if (e.kind === 'broadside') heard(e.pos, 'broadside', e.mine ? 0.75 : 0.6, 3400, 0.9 + Math.random() * 0.2);
        else heard(e.pos, e.kind === 'craft' ? 'craft' : 'turret', e.mine ? 0.3 : 0.28, 1600, 0.9 + Math.random() * 0.2);
        break;
      case 'hit': scene.onEvent(e); if (e.onPlayer) audio.play(e.shield ? 'shield' : 'hit', {gain: 0.5}); else heard(e.pos, e.shield ? 'shield' : 'hit', 0.4, 1900); break;
      case 'spark': scene.onEvent(e); heard(e.pos, 'hit', 0.25, 1200, 1.4); break;
      case 'explode': scene.onEvent(e); heard(e.pos, e.rock ? 'rock' : e.size > 10 ? 'wreck' : 'explode', Math.min(1, 0.5 + e.size * 0.03), 6000); if (e.size > 10 && !e.rock) shake = Math.min(1, shake + 0.4); break;
      case 'torpedo': heard(e.pos, 'torpedo', 0.7); break;
      case 'deflect': heard(e.pos, 'deflect', e.mine ? 0.6 : 0.4, 2000); break;
      case 'playerHit': shake = Math.min(1, shake + (e.shield ? 0.12 : 0.4)); if (!e.shield) { flash.className = 'hurt'; flash.style.opacity = '0.7'; setTimeout(() => { flash.style.opacity = '0'; }, 120); } break;
      case 'bump': shake = 1; audio.play('hit', {gain: 0.8, rate: 0.6}); break;
      case 'warp': audio.play(e.state === 'spool' ? 'spool' : 'warp', {gain: 0.55, rate: e.state === 'off' ? 0.7 : 1}); break;
      case 'pickup': audio.play('pickup', {gain: 0.5}); break;
      case 'missionDone': audio.play('dock', {gain: 0.7}); say(`Contract complete: +${e.result.reward.toLocaleString('en-US')} cr`, 'good'); say(e.result.text, 'comm'); break;
      case 'missionFailed': audio.play('error', {gain: 0.7}); say(`Contract failed. ${e.result.text}`, 'warn'); break;
      case 'victory': banner = {text: 'THE BLACK PENNANT IS BROKEN — the Sundered Banks are yours', until: performance.now() + 12000}; break;
      case 'dock': audio.play('dock', {gain: 0.7}); world.events.length = 0; openStation(e.result); return;
      case 'playerDead': {
        const saved = loadSave();
        $('dead-text').textContent = saved ? `She goes down with her colours flying. Your last docking record at ${STATIONS[saved.station].name} is intact.` : 'She goes down with her colours flying.';
        setTimeout(() => { if (world?.over) setMode('dead'); }, 2200);
        break;
      }
    }
  }
  world.events.length = 0;
}

// Input --------------------------------------------------------------------------------------
function edges() {
  if (actions.consume('pause')) return mode === 'map' ? setMode('flight') : setMode('paused');
  if (actions.consume('map')) return setMode(mode === 'map' ? 'flight' : 'map');
  const w = world;
  if (w.over) { actions.edges.clear(); return; } // a destroyed ship takes no orders
  if (actions.consume('course')) w.cycleDest();
  if (actions.consume('warp')) { w.toggleWarp(); if (mode === 'map') setMode('flight'); }
  if (mode === 'map') return;
  if (actions.consume('use')) w.use();
  if (actions.consume('hostile')) w.targetNearestHostile();
  if (actions.consume('next')) w.cycleTarget();
  if (actions.consume('torpedo')) pendingTorpedo = true;
}
const viewYaw = () => headingOf(world.playerShip) + view3.rel;
function command() {
  const yaw = viewYaw();
  return {rudder: actions.axis('starboard', 'port'), throttle: actions.axis('down', 'up'), boost: !!actions.value('boost'), deflect: deflectHeld || !!actions.value('deflect'),
    hold: triggerHeld || !!actions.value('fire'), aim: [-Math.sin(yaw), -Math.cos(yaw)], torpedo: false};
}
hud.addEventListener('pointermove', e => { cursor = {x: e.clientX, y: e.clientY}; });
hud.addEventListener('pointerdown', e => {
  audio.unlock(); cursor = {x: e.clientX, y: e.clientY};
  if (mode === 'map') { const port = mapPick(hud.clientWidth, hud.clientHeight, world, e.clientX, e.clientY); if (port) { world.selectDest(port.id); audio.play('click', {gain: 0.5}); } }
});
// The right button raises the deflector whether or not the pointer is captured.
document.addEventListener('mousedown', e => { if (e.button === 2 && mode === 'flight') { deflectHeld = true; e.preventDefault(); } });
document.addEventListener('mouseup', e => { if (e.button === 2) deflectHeld = false; });
document.addEventListener('contextmenu', e => { if (mode === 'flight' || mode === 'map') e.preventDefault(); });
document.addEventListener('wheel', e => { if (mode === 'flight') view3.zoom = clamp(view3.zoom + Math.sign(e.deltaY) * 0.12, 0.6, 2.4); }, {passive: true});
window.addEventListener('blur', () => { if (mode === 'flight' || mode === 'map') setMode('paused'); });
document.addEventListener('visibilitychange', () => { if (document.hidden && (mode === 'flight' || mode === 'map')) setMode('paused'); });
document.addEventListener('keydown', e => { if (e.code === 'Escape' && mode === 'paused') { e.preventDefault(); setMode('flight'); } else if (e.code === 'Escape' && mode === 'help') closeHelp(); });

// Menus --------------------------------------------------------------------------------------
const refreshMenu = () => { $('btn-continue').hidden = !loadSave(); };
const closeHelp = () => setMode(helpFrom);
const fresh = () => newPlayer((Date.now() & 0x7fffffff) || 1);
$('btn-new').addEventListener('click', () => { audio.unlock(); if (loadSave() && !confirm('Start a new captain? Your saved game will be replaced.')) return; begin(fresh(), true); });
$('btn-continue').addEventListener('click', () => { audio.unlock(); const state = loadSave(); if (state) begin(state, false); else refreshMenu(); });
$('btn-help').addEventListener('click', () => { helpFrom = 'menu'; setMode('help'); });
$('btn-pause-help').addEventListener('click', () => { helpFrom = 'paused'; setMode('help'); });
overlays.help.querySelector('[data-close]').addEventListener('click', closeHelp);
$('btn-resume').addEventListener('click', () => { audio.unlock(); setMode('flight'); });
const quit = () => { world = null; player = null; refreshMenu(); setMode('menu'); };
$('btn-quit').addEventListener('click', quit); $('btn-dead-quit').addEventListener('click', quit);
$('btn-restore').addEventListener('click', () => { const state = loadSave(); begin(state ?? fresh(), !state); });
for (const [id, key] of [['vol-sfx', 'sfx'], ['vol-music', 'music']]) {
  $(id).value = settings[key];
  $(id).addEventListener('input', e => { settings[key] = Number(e.target.value); audio.setVolumes(settings.sfx, settings.music); saveSettings(); });
}

// Frame --------------------------------------------------------------------------------------
function updatePoses(w, alpha, time) {
  poses.clear();
  for (const s of w.ships) {
    const a = s.prevPos, b = s.body.position, bob = s.kind === 'craft' ? Math.sin(time * 1.3 + s.id) * 5 + ((s.id % 5) - 2) * 4 : 0;
    poses.set(s.id, {pos: [a[0] + (b[0] - a[0]) * alpha, bob, a[2] + (b[2] - a[2]) * alpha], q: quatMultiply(quatInterpolate(s.prevQ, s.body.orientation, alpha), [0, 0, Math.sin(s.heel / 2), Math.cos(s.heel / 2)])});
  }
}
/** Orbit camera: yaw (world), look-down pitch and distance around a point. */
function orbit(target, yaw, pitch, distance) {
  const cp = Math.cos(pitch), dir = [-Math.sin(yaw) * cp, -Math.sin(pitch), -Math.cos(yaw) * cp];
  cam.pos = [target[0] - dir[0] * distance, target[1] - dir[1] * distance, target[2] - dir[2] * distance];
  cam.q = quatMultiply([0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)], [Math.sin(-pitch / 2), 0, 0, Math.cos(-pitch / 2)]);
}
function sizeHud() {
  const dpr = Math.min(globalThis.devicePixelRatio || 1, 2), w = Math.round(hud.clientWidth * dpr), h = Math.round(hud.clientHeight * dpr);
  if (hud.width !== w || hud.height !== h) { hud.width = w; hud.height = h; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
function frame(now) {
  requestAnimationFrame(frame);
  const seconds = last === null ? 0 : Math.min(0.25, (now - last) / 1000);
  last = now;
  if (mode === 'docked') { audio.update(false); return; }
  if (!world) { // title backdrop: Anchorage Prime and whoever is sailing past
    backdrop ??= new World(newPlayer(11));
    backdrop.step(Math.min(seconds, 0.05), {}); backdrop.events.length = 0;
    updatePoses(backdrop, 1, now / 1000);
    orbit([120, 60, 0], 2.3 + now / 1000 * 0.03, 0.2, 1250);
    scene.draw(backdrop, cam, poses, 0, seconds);
    audio.update(false);
    return;
  }
  let alpha = 1;
  if (mode === 'flight' || mode === 'map') edges();
  if (mode === 'flight') {
    const sample = look.consume();
    view3.rel += sample.yaw + actions.axis('lookRight', 'lookLeft') * seconds * 1.8;
    view3.pitch = clamp(view3.pitch - sample.pitch - actions.axis('lookDown', 'lookUp') * seconds * 1.2, 0.1, 1.25);
    triggerHeld = sample.primary;
    // A frame can run zero simulation ticks, so a torpedo request stays pending until a tick consumes it.
    const cmd = command(); cmd.torpedo = pendingTorpedo;
    alpha = clock.advance(seconds, dt => { world.step(dt, cmd); cmd.torpedo = false; pendingTorpedo = false; drainEvents(); }).alpha;
    if (mode === 'docked') return;
  }
  const me = world.playerShip;
  updatePoses(world, alpha, world.time);
  const pose = poses.get(me.id) ?? {pos: me.body.position}, speed = Math.hypot(me.body.velocity[0], me.body.velocity[2]);
  shake = Math.max(0, shake - seconds * 2.2);
  const jolt = () => (Math.random() - 0.5) * shake * 3;
  orbit([pose.pos[0] + jolt(), me.radius * 1.1 + 5 + jolt(), pose.pos[2] + jolt()], viewYaw(), view3.pitch, (me.radius * 3.5 + 26 + Math.min(40, speed / 60)) * view3.zoom);
  scene.draw(world, cam, poses, mode === 'flight' ? (alpha - 1) * STEP : 0, mode === 'flight' ? seconds : 0);

  for (const m of messages) m.ttl -= seconds;
  while (messages.length && messages[0].ttl <= 0) messages.shift();
  if (mode === 'flight' && !settings.tips && tipIndex < TIPS.length && world.time >= tipAt) {
    say(TIPS[tipIndex++], 'comm', 'First mate'); tipAt = world.time + 10;
    if (tipIndex >= TIPS.length) { settings.tips = true; saveSettings(); }
  }
  sizeHud();
  if (banner && now > banner.until) banner = null;
  const ui = {cursor, messages, poses, camYaw: viewYaw(), hint: banner?.text ?? (look.locked || mode !== 'flight' || world.time - castOff > 14 ? null : 'Click the view to capture the mouse — or drag to look; arrow keys also work')};
  if (mode === 'map') drawMap(ctx, hud.clientWidth, hud.clientHeight, world, ui); else drawHud(ctx, hud.clientWidth, hud.clientHeight, world, scene, ui);
  const power = me.warp.state === 'on' ? 3 : me.boosting ? 1.8 : me.throttle;
  audio.update(mode === 'flight', power, world.contacts().some(c => c.attitude === 'hostile' && c.dist < 3000) ? 1 : 0);
}

refreshMenu(); setMode('menu');
requestAnimationFrame(frame);
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('../sw.js').catch(() => {});
// Read-only handle for automated smoke tests and the curious.
globalThis.__ironwake = {get world() { return world; }, get player() { return player; }, get mode() { return mode; }, scene, view: view3};
