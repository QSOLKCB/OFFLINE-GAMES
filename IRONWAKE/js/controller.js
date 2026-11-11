// SPDX-License-Identifier: Apache-2.0
// Game-specific controls using VANILLAJS's finite, rescaled analog deadzone.
import {deadzone} from '../vendor/vanillajs/modules/input/index.js';

const BUTTONS = ['use', 'brake', 'torpedo', 'hostile', 'next', 'warp', 'deflect', 'fire', 'map', 'pause', 'recenter', 'signal', 'boost', 'stop', 'portView', 'starView'];
export const idlePad = () => ({connected: false, active: false, look: [0, 0], throttle: 0, rudder: 0, held: new Set(), pressed: new Set(), nav: 0, horizontal: 0});
export class CaptainGamepad {
  constructor() { this.identity = ''; this.context = ''; this.reset(); }
  reset() { this.armed = false; this.previous = new Set(); this.navHeld = 0; this.repeatAt = 0; }
  sample(pads = [], context = 'flight', now = 0) {
    const out = idlePad();
    const pad = Array.from(pads).find(p => p && p.connected !== false && p.mapping === 'standard');
    if (!pad) { this.identity = ''; this.reset(); return out; }
    out.connected = true;
    const identity = `${pad.index}:${pad.id}`;
    if (identity !== this.identity || context !== this.context) { this.identity = identity; this.context = context; this.reset(); }
    const axis = i => deadzone(pad.axes[i] ?? 0, 0.18);
    const value = i => { const b = pad.buttons[i]; return Number.isFinite(b?.value) ? Math.max(0, Math.min(1, b.value)) : Number(!!b?.pressed); };
    const held = new Set(BUTTONS.filter((_, i) => value(i) > 0.5));
    if (!this.armed) {
      this.armed = !pad.buttons.some((_, i) => value(i) > 0.1) && pad.axes.every(v => deadzone(v, 0.18) === 0);
      return out;
    }
    out.held = held; out.pressed = new Set([...held].filter(k => !this.previous.has(k))); this.previous = held;
    out.look = [-axis(2) || 0, -axis(3) || 0]; out.throttle = -axis(1) || 0; out.rudder = -axis(0) || 0;
    out.active = held.size > 0 || [0, 1, 2, 3].some(i => axis(i) !== 0);
    const nav = value(13) > 0.5 || axis(1) > 0.5 ? 1 : value(12) > 0.5 || axis(1) < -0.5 ? -1 : 0;
    if (nav && (nav !== this.navHeld || now >= this.repeatAt)) { out.nav = nav; this.repeatAt = now + (nav !== this.navHeld ? 400 : 150); }
    this.navHeld = nav;
    out.horizontal = out.pressed.has('starView') ? 1 : out.pressed.has('portView') ? -1 : 0;
    return out;
  }
}

/** DOM menus remain ordinary focusable controls; gamepad invokes the same click handlers. */
export class ControllerMenu {
  constructor() { this.index = 0; this.root = null; }
  step(sample, root, back) {
    if (!root) return;
    if (root !== this.root) { this.root = root; this.index = 0; }
    const items = [...root.querySelectorAll('button:not(:disabled), input[type="range"], a[href]')].filter(e => e.getClientRects().length && !e.closest('[hidden]'));
    if (!items.length) return;
    let at = items.indexOf(document.activeElement);
    if (at < 0) at = Math.min(this.index, items.length - 1);
    if (sample.nav) at = (at + sample.nav + items.length) % items.length;
    const focus = items[at]; this.index = at;
    if (sample.active) { focus.focus({preventScroll: true}); focus.scrollIntoView({block: 'nearest'}); }
    if (sample.horizontal && focus.matches('input[type="range"]')) {
      focus.value = Math.max(Number(focus.min), Math.min(Number(focus.max), Number(focus.value) + sample.horizontal * Number(focus.step || 0.05)));
      focus.dispatchEvent(new Event('input', {bubbles: true}));
    } else if (sample.horizontal) {
      const tabs = [...root.querySelectorAll('[data-tab]')];
      if (tabs.length) tabs[(tabs.findIndex(e => e.classList.contains('on')) + sample.horizontal + tabs.length) % tabs.length].click();
    }
    if (sample.pressed.has('use')) focus.click();
    if (sample.pressed.has('brake') || sample.pressed.has('pause')) back();
  }
}

/** Browser-native confirm dialogs cannot be navigated through the Gamepad API. */
export function confirmNewCaptain(start) {
  const dialog = document.createElement('dialog'); dialog.className = 'captain-confirm';
  dialog.innerHTML = '<h2>Start a new captain?</h2><p>Your saved captain will be replaced.</p><button data-cancel>Keep current captain</button> <button data-start>Start new captain</button>';
  document.body.append(dialog);
  dialog.querySelector('[data-cancel]').onclick = () => dialog.close();
  dialog.querySelector('[data-start]').onclick = () => { dialog.close(); start(); };
  dialog.addEventListener('close', () => dialog.remove(), {once: true}); dialog.showModal();
  dialog.querySelector('[data-cancel]').focus();
}
