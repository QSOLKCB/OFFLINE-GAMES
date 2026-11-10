// SPDX-License-Identifier: Apache-2.0
// VAGRANT STARS application shell: input, fixed-step loop, camera, sound and screens.
import {Actions, attachKeyboard} from '../vendor/vanillajs/modules/input/index.js';
import {FixedClock} from '../vendor/vanillajs/modules/time/index.js';
import {quatInterpolate, rotate} from '../vendor/vanillajs/modules/math/index.js';
import {Scene} from './render.js';
import {drawHud, drawMap, mapPick} from './hud.js';
import {StationUI} from './ui.js';
import {GameAudio} from './audio.js';
import {pickEnemy} from './selection.js';
import {World, lookQuat} from './sim/world.js';
import {newPlayer, sanitizeSave} from './sim/player.js';
import {BASES} from './sim/data.js';

const SAVE_KEY = 'vagrant-stars.save.v1', SETTINGS_KEY = 'vagrant-stars.settings.v1', STEP = 1 / 60;
const $ = id => document.getElementById(id);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const view = $('view'), hud = $('hud'), flash = $('flash'), ctx = hud.getContext('2d');
const overlays = {menu: $('menu'), help: $('help'), pause: $('pause'), dead: $('dead'), station: $('station'), fail: $('fail')};
const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); return true; } catch { return false; } },
};

let scene;
try { scene = new Scene(view); } catch (error) {
  $('fail-text').textContent = `${error.message} VAGRANT STARS needs WebGL.`;
  overlays.menu.hidden = true; overlays.fail.hidden = false;
  throw error;
}
const audio = new GameAudio();
const settings = {sfx: 0.7, music: 0.5, tips: false, ...(() => { try { return JSON.parse(store.get(SETTINGS_KEY)) ?? {}; } catch { return {}; } })()};
audio.setVolumes(settings.sfx, settings.music);
const saveSettings = () => store.set(SETTINGS_KEY, JSON.stringify(settings));

const bindings = {KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right', ShiftLeft: 'burn', ShiftRight: 'burn', KeyX: 'brake',
  ArrowUp: 'pitchUp', ArrowDown: 'pitchDown', ArrowLeft: 'yawLeft', ArrowRight: 'yawRight', KeyC: 'cruise', KeyZ: 'drift', KeyF: 'use', KeyG: 'goto',
  KeyR: 'hostile', KeyT: 'next', Tab: 'next', KeyN: 'poi', KeyY: 'pick', KeyB: 'tractor', KeyH: 'kit', KeyJ: 'cell', KeyQ: 'missile', KeyM: 'map',
  Space: 'cursor', KeyP: 'pause', Escape: 'pause'};
const actions = new Actions(), clock = new FixedClock({step: STEP, maxSteps: 6});
let mode = 'menu', world = null, player = null, backdrop = null, last = null, helpFrom = 'menu';
let cursor = null, firing = false, pendingMissile = false, mouseFlight = true, shake = 0, lastAlert = 0, tipAt = 0, tipIndex = 0;
const keyboard = attachKeyboard(window, actions, {bindings, enabled: () => mode === 'flight' || mode === 'map'});
const cam = {pos: [0, 0, 0], q: [0, 0, 0, 1]}, poses = new Map(), messages = [];
const TIPS = ['Move the mouse to steer. Hold W to open the throttle; the wheel works too.', 'Press N to select a place, then F to fly there and dock, jump or ride.',
  'Left mouse fires at the cursor. R targets the nearest hostile; aim at the red lead marker.', 'C engages the cruise drive for long hauls. M opens the navigation map.',
  'Slingway rings fling you across a system. Fold gates lead to other stars.'];

function setMode(next) {
  mode = next;
  for (const [name, node] of Object.entries(overlays)) node.hidden = !((name === 'menu' && next === 'menu') || (name === 'help' && next === 'help') || (name === 'pause' && next === 'paused')
    || (name === 'dead' && next === 'dead') || (name === 'station' && next === 'docked'));
  clock.setPaused(next !== 'flight'); keyboard.clear(); firing = false; pendingMissile = false; last = null;
  hud.style.visibility = next === 'flight' || next === 'map' ? 'visible' : 'hidden';
  if (next === 'flight' || next === 'map') hud.focus({preventScroll: true});
  else if (document.activeElement === hud) hud.blur();
}
function say(text, tone = 'info', from = null) {
  messages.push({text, tone, from, ttl: 7});
  while (messages.length > 7) messages.shift();
}
const save = () => { if (player) store.set(SAVE_KEY, JSON.stringify(player)); };
const loadSave = () => sanitizeSave(store.get(SAVE_KEY));

const station = new StationUI(overlays.station, {
  onChange: save, sound: name => audio.play(name, {gain: 0.6}),
  onLaunch() {
    save(); world.launch(); drainEvents(); messages.length = 0;
    cam.q = [...world.playerShip.body.orientation]; mouseFlight = true;
    setMode('flight');
    if (!settings.tips) { tipIndex = 0; tipAt = world.time + 1.5; }
    say(`Launched from ${BASES[player.base].name}.`, 'good');
  },
});
function openStation(result = null, welcome = false) {
  save(); station.open(player, player.base, result, welcome); setMode('docked');
}
function begin(state, welcome) {
  player = state; world = new World(player); world.events.length = 0; world.docked = player.base; backdrop = null;
  scene.setSystem(world.system); audio.setSystem(world.system.root);
  openStation(null, welcome);
}

// Simulation events -> sound, effects and screens ---------------------------------------------
function heard(pos, name, base = 1, range = 1900, rate = 1) {
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
      case 'shot': if (e.mine) audio.play(e.sfx, {gain: 0.42, rate: 0.96 + Math.random() * 0.08}); else heard(e.pos, e.sfx, 0.5); break;
      case 'hit': scene.onEvent(e); if (e.onPlayer) audio.play(e.shield ? 'shield' : 'hit', {gain: 0.6}); else heard(e.pos, e.shield ? 'shield' : 'hit', 0.45, 1500); break;
      case 'spark': scene.onEvent(e); heard(e.pos, 'hit', 0.25, 900, 1.4); break;
      case 'explode': scene.onEvent(e); heard(e.pos, 'explode', Math.min(1, 0.4 + e.size * 0.08), 4200, e.size < 4 ? 1.5 : 1); break;
      case 'missile': heard(e.pos, 'missile', 0.7, 2400); break;
      case 'playerHit': shake = Math.min(1, shake + (e.shield ? 0.2 : 0.45)); if (!e.shield) { flash.className = 'hurt'; flash.style.opacity = '0.8'; setTimeout(() => { if (flash.className === 'hurt') flash.style.opacity = '0'; }, 120); } break;
      case 'bump': shake = 1; audio.play('hit', {gain: 0.8, rate: 0.6}); break;
      case 'cruise': if (e.state === 'charging') audio.play('cruise', {gain: 0.5}); break;
      case 'laneEnter': audio.play('sling', {gain: 0.7}); break;
      case 'laneExit': audio.play('sling', {gain: 0.5, rate: 0.7}); break;
      case 'pickup': audio.play('pickup', {gain: 0.6}); break;
      case 'tractor': audio.play('tractor', {gain: 0.5}); break;
      case 'repair': audio.play('buy', {gain: 0.5}); break;
      case 'jumpStart': audio.play('jump', {gain: 0.8}); flash.className = ''; flash.style.transition = 'opacity 1.5s ease-in'; flash.style.opacity = '1'; break;
      case 'jumped': flash.style.transition = 'opacity .9s ease-out'; flash.style.opacity = '0'; cam.q = [...world.playerShip.body.orientation]; break;
      case 'system': scene.setSystem(world.system); audio.setSystem(world.system.root); break;
      case 'missionDone':
        audio.play('dock', {gain: 0.7});
        say(`Contract complete: +${e.result.reward.toLocaleString('en-US')} cr`, 'good'); say(e.result.text, 'comm');
        break;
      case 'dock': audio.play('dock', {gain: 0.7}); world.events.length = 0; openStation(e.result); return;
      case 'playerDead':
        $('dead-text').textContent = loadSave() ? `Your ${world.playerShip.hull.name} breaks up in silence. Your last docking record at ${BASES[loadSave().base].name} is intact.` : 'Your hull breaks up in silence.';
        setTimeout(() => { if (world?.over) setMode('dead'); }, 1600);
        break;
    }
  }
  world.events.length = 0;
}

// Input --------------------------------------------------------------------------------------
function edges() {
  if (actions.consume('pause')) return mode === 'map' ? setMode('flight') : setMode('paused');
  if (actions.consume('map')) return setMode(mode === 'map' ? 'flight' : 'map');
  const w = world, inMap = mode === 'map';
  if (w.over) { actions.edges.clear(); return; } // a destroyed ship takes no orders
  if (actions.consume('poi')) w.cyclePoi();
  if (actions.consume('use')) { w.use(); if (inMap) setMode('flight'); }
  if (actions.consume('goto')) { w.goTo(); if (inMap) setMode('flight'); }
  if (inMap) return;
  if (actions.consume('cruise')) w.toggleCruise();
  if (actions.consume('drift')) w.toggleDrift();
  if (actions.consume('hostile')) w.targetNearestHostile();
  if (actions.consume('next')) w.targetShip();
  if (actions.consume('pick') && cursor) w.targetAlong(cam.pos, cursorRay());
  if (actions.consume('tractor')) w.tractor();
  if (actions.consume('kit')) w.useKit();
  if (actions.consume('cell')) w.useCell();
  if (actions.consume('missile')) pendingMissile = true;
  if (actions.consume('cursor')) { mouseFlight = !mouseFlight; say(mouseFlight ? 'Mouse steering on.' : 'Cursor freed. Arrow keys steer.'); }
}
const cursorRay = () => scene.ray(cursor.x / hud.clientWidth * 2 - 1, 1 - cursor.y / hud.clientHeight * 2, hud.clientWidth / hud.clientHeight);
function command() {
  const w = hud.clientWidth, h = hud.clientHeight, turn = [actions.axis('pitchDown', 'pitchUp'), actions.axis('yawRight', 'yawLeft')];
  let aim = null;
  if (cursor) {
    aim = cursorRay();
    const mx = (cursor.x - w / 2) / (h / 2), my = (h / 2 - cursor.y) / (h / 2), r = Math.hypot(mx, my);
    if (mouseFlight && r > 0.05) { const k = Math.min(1, (r - 0.05) * 1.5) / r; turn[0] += my * k; turn[1] -= mx * k; }
  }
  return {turn, throttle: actions.axis('down', 'up'), strafe: actions.axis('left', 'right'), burn: !!actions.value('burn'), brake: !!actions.value('brake'), fire: firing, aim, missile: false};
}
hud.addEventListener('pointermove', e => { cursor = {x: e.clientX, y: e.clientY}; });
hud.addEventListener('pointerdown', e => {
  audio.unlock(); cursor = {x: e.clientX, y: e.clientY}; hud.focus({preventScroll: true});
  if (mode === 'map') { const poi = mapPick(hud.clientWidth, hud.clientHeight, world, e.clientX, e.clientY); if (poi) { world.targetPoi(poi.id); audio.play('click', {gain: 0.5}); } return; }
  if (mode !== 'flight' || world.over) return;
  if (e.button === 0) { firing = true; hud.setPointerCapture?.(e.pointerId); } else if (e.button === 2) {
    const rect = hud.getBoundingClientRect();
    const ship = pickEnemy(world, scene, poses, e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height);
    if (ship) { world.target = {kind: 'ship', id: ship.id}; audio.play('click', {gain: 0.45}); }
  }
  e.preventDefault();
});
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) hud.addEventListener(name, e => { if (name !== 'pointerup' || e.button === 0) firing = false; });
hud.addEventListener('contextmenu', e => e.preventDefault());
hud.addEventListener('wheel', e => {
  if (mode !== 'flight' || !world) return;
  e.preventDefault(); const s = world.playerShip; s.throttle = Math.max(0, Math.min(1, s.throttle - Math.sign(e.deltaY) * 0.1)); if (world.auto) world.stopAuto();
}, {passive: false});
window.addEventListener('blur', () => { if (mode === 'flight' || mode === 'map') setMode('paused'); });
document.addEventListener('visibilitychange', () => { if (document.hidden && (mode === 'flight' || mode === 'map')) setMode('paused'); });
document.addEventListener('keydown', e => { if (e.code === 'Escape' && mode === 'paused') { e.preventDefault(); setMode('flight'); } else if (e.code === 'Escape' && mode === 'help') closeHelp(); });

// Menus --------------------------------------------------------------------------------------
const refreshMenu = () => { $('btn-continue').hidden = !loadSave(); };
const closeHelp = () => setMode(helpFrom);
$('btn-new').addEventListener('click', () => {
  audio.unlock();
  if (loadSave() && !confirm('Start a new captain? Your saved game will be replaced.')) return;
  begin(newPlayer((Date.now() & 0x7fffffff) || 1), true);
});
$('btn-continue').addEventListener('click', () => { audio.unlock(); const state = loadSave(); if (state) begin(state, false); else refreshMenu(); });
$('btn-help').addEventListener('click', () => { helpFrom = 'menu'; setMode('help'); });
$('btn-pause-help').addEventListener('click', () => { helpFrom = 'paused'; setMode('help'); });
overlays.help.querySelector('[data-close]').addEventListener('click', closeHelp);
$('btn-resume').addEventListener('click', () => { audio.unlock(); setMode('flight'); });
const quit = () => { world = null; player = null; refreshMenu(); setMode('menu'); };
$('btn-quit').addEventListener('click', quit); $('btn-dead-quit').addEventListener('click', quit);
$('btn-restore').addEventListener('click', () => { const state = loadSave(); if (state) begin(state, false); else begin(newPlayer((Date.now() & 0x7fffffff) || 1), true); });
for (const [id, key] of [['vol-sfx', 'sfx'], ['vol-music', 'music']]) {
  $(id).value = settings[key];
  $(id).addEventListener('input', e => { settings[key] = Number(e.target.value); audio.setVolumes(settings.sfx, settings.music); saveSettings(); });
}

// Frame --------------------------------------------------------------------------------------
function updatePoses(w, alpha) {
  poses.clear();
  for (const s of w.ships) {
    const a = s.prevPos, b = s.body.position;
    const attitude = quatInterpolate(s.prevQ, s.body.orientation, alpha);
    poses.set(s.id, {pos: [a[0] + (b[0] - a[0]) * alpha, a[1] + (b[1] - a[1]) * alpha, a[2] + (b[2] - a[2]) * alpha], q: w.visualQuat(s, attitude), attitude});
  }
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
  if (mode === 'docked') {
    const port = world.sector.byId.get(world.docked), a = 2.2 + (reducedMotion ? 0 : now / 1000 * 0.012), distance = port.radius * 3.8;
    updatePoses(world, 1);
    cam.pos = [port.pos[0] + Math.cos(a) * distance, port.pos[1] + distance * 0.2, port.pos[2] + Math.sin(a) * distance];
    const to = port.pos.map((v, i) => v - cam.pos[i]), len = Math.hypot(...to); cam.q = lookQuat(to.map(v => v / len));
    scene.draw(world, cam, poses, 0, reducedMotion ? 0 : seconds);
    audio.update(false, 0, 0, world); return;
  }
  if (!world) { // title backdrop: a live corner of Meridian
    backdrop ??= (() => { const w = new World(newPlayer(11)); scene.setSystem(w.system); return w; })();
    backdrop.step(Math.min(seconds, 0.05), {}); backdrop.events.length = 0;
    updatePoses(backdrop, 1);
    const a = 2.2 + now / 1000 * 0.04, base = backdrop.sector.byId.get('calder').pos;
    cam.pos = [base[0] + Math.cos(a) * 980, base[1] + 150, base[2] + Math.sin(a) * 980];
    const to = [base[0] - cam.pos[0] + Math.sin(a) * 420, base[1] - 130 - cam.pos[1], base[2] - cam.pos[2] - Math.cos(a) * 420], l = Math.hypot(...to);
    cam.q = lookQuat(to.map(v => v / l));
    scene.draw(backdrop, cam, poses, 0, seconds);
    audio.update(false);
    return;
  }
  let alpha = 1;
  if (mode === 'flight' || mode === 'map') edges();
  if (mode === 'flight') {
    // A frame can run zero simulation ticks (displays faster than 60 Hz), so a missile request
    // stays pending until a tick has actually consumed it.
    const cmd = command(); cmd.missile = pendingMissile;
    alpha = clock.advance(seconds, dt => { world.step(dt, cmd); cmd.missile = false; pendingMissile = false; drainEvents(); }).alpha;
    if (mode === 'docked') return;
  }
  const me = world.playerShip;
  updatePoses(world, alpha);
  const pose = poses.get(me.id) ?? {pos: me.body.position, attitude: me.body.orientation}, speed = Math.hypot(...me.body.velocity);
  cam.q = quatInterpolate(cam.q, pose.attitude, 1 - Math.exp(-seconds * 5.5));
  shake = Math.max(0, shake - seconds * 2.5);
  const offset = rotate(cam.q, [(Math.random() - 0.5) * shake * 1.2, me.radius * 0.62 + 1.8 + (Math.random() - 0.5) * shake * 1.2, me.radius * 3.3 + 9 + Math.min(10, speed / 45)]);
  cam.pos = [pose.pos[0] + offset[0], pose.pos[1] + offset[1], pose.pos[2] + offset[2]];
  scene.draw(world, cam, poses, mode === 'flight' ? (alpha - 1) * STEP : 0, mode === 'flight' ? seconds : 0);

  for (const m of messages) m.ttl -= seconds;
  while (messages.length && messages[0].ttl <= 0) messages.shift();
  if (mode === 'flight' && !settings.tips && tipIndex < TIPS.length && world.time >= tipAt) {
    say(TIPS[tipIndex++], 'comm', 'Flight school'); tipAt = world.time + 9;
    if (tipIndex >= TIPS.length) { settings.tips = true; saveSettings(); }
  }
  sizeHud();
  const target = world.targetObject();
  const hint = target && !target.body && !me.lane && !world.jump && Math.hypot(...target.pos.map((v, i) => v - me.body.position[i])) <= target.useRange
    ? `Press F to ${target.type === 'base' ? 'dock' : target.type === 'gate' ? 'jump' : 'ride the slingway'}` : me.lane ? 'Press F or X to leave the slingway' : null;
  const ui = {cursor, mouseFlight, firing, messages, poses, hint};
  if (mode === 'map') drawMap(ctx, hud.clientWidth, hud.clientHeight, world, ui); else drawHud(ctx, hud.clientWidth, hud.clientHeight, world, scene, ui);
  const power = me.lane ? 3 : me.cruise.state === 'on' ? 2.4 : me.burning ? 1.7 : me.throttle;
  audio.update(mode === 'flight', power, world.contacts().some(c => c.attitude === 'hostile' && c.dist < 2600) ? 1 : 0, world);
}

refreshMenu(); setMode('menu');
requestAnimationFrame(frame);
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('../sw.js').catch(() => {});
// Read-only handle for automated smoke tests and the curious.
globalThis.__vagrant = {get world() { return world; }, get player() { return player; }, get mode() { return mode; }, scene, audio};
