// SPDX-License-Identifier: Apache-2.0
import {clamp} from '../math/index.js';
export class Actions {
  constructor() { this.held=new Set(); this.edges=new Set(); }
  set(action, down) {
    if (down && !this.held.has(action)) this.edges.add(action);
    if (down) this.held.add(action); else this.held.delete(action);
  }
  value(action) { return this.held.has(action) ? 1 : 0; }
  axis(negative, positive) { return this.value(positive)-this.value(negative); }
  consume(action) { const pressed=this.edges.has(action); this.edges.delete(action); return pressed; }
  clear() { this.held.clear(); this.edges.clear(); }
  flight() {
    return {thrust:[this.axis('left','right'),this.axis('down','up'),this.axis('forward','backward')],
      turn:[this.axis('pitchDown','pitchUp'),this.axis('yawRight','yawLeft'),this.axis('rollRight','rollLeft')],brake:Boolean(this.value('brake'))};
  }
}
export const flightBindings={KeyW:'forward',KeyS:'backward',KeyA:'left',KeyD:'right',Space:'up',ControlLeft:'down',ControlRight:'down',
  ArrowUp:'pitchUp',ArrowDown:'pitchDown',ArrowLeft:'yawLeft',ArrowRight:'yawRight',KeyQ:'rollLeft',KeyE:'rollRight',KeyX:'brake',KeyB:'slow'};
export const fpsBindings={KeyW:'forward',KeyS:'backward',KeyA:'left',KeyD:'right',Space:'jump',ShiftLeft:'sprint',ShiftRight:'sprint',KeyC:'crouch',
  ArrowUp:'pitchUp',ArrowDown:'pitchDown',ArrowLeft:'yawLeft',ArrowRight:'yawRight',KeyF:'fire',KeyR:'reload'};
export function attachKeyboard(target, actions, {bindings=flightBindings, enabled=()=>true}={}) {
  const keys=new Set();
  const editable=event=>event.target?.closest?.('input,select,textarea,button');
  const change=(event,down)=>{
    const action=bindings[event.code];
    if (!action) return;
    if (down && (!enabled() || editable(event))) return;
    // Clearing input cancels held keys. OS auto-repeat must not re-arm them.
    if (down && event.repeat && !keys.has(event.code)) {
      event.preventDefault();
      return;
    }
    if (down) keys.add(event.code); else keys.delete(event.code);
    actions.set(action,[...keys].some(code=>bindings[code]===action));
    if (enabled() && !editable(event)) event.preventDefault();
  };
  const down=e=>change(e,true), up=e=>change(e,false);
  const clear=()=>{keys.clear();actions.clear();};
  target.addEventListener('keydown',down);target.addEventListener('keyup',up);target.addEventListener('blur',clear);
  return {clear,dispose(){clear();target.removeEventListener('keydown',down);target.removeEventListener('keyup',up);target.removeEventListener('blur',clear);}};
}
/** Relative mouse-look in radians; click to capture, drag as a touch/failure fallback.
 * Consume on a simulation tick (not every render). Call release on pause/focus loss. */
export function attachMouseLook(target, {enabled=()=>true,sensitivity=.0025,onLock=()=>{},onUnlock=()=>{},onError=()=>{}}={}) {
  if (!Number.isFinite(sensitivity) || sensitivity<=0) throw new RangeError('sensitivity must be positive');
  const doc=target.ownerDocument;
  let pitch=0,yaw=0,primary=false,pressed=false,drag=null,locked=false,wanted=false,disposed=false,suppressPrimary=false;
  let request=0,capturing=false;
  const reset=()=>{pitch=0;yaw=0;primary=false;pressed=false;drag=null;};
  const move=(x,y)=>{
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    // Bound a queued sample even if a device supplies pathological movement.
    yaw=clamp(yaw-x*sensitivity,-Math.PI,Math.PI);
    pitch=clamp(pitch-y*sensitivity,-Math.PI,Math.PI);
  };
  const fail=(id,error)=>{
    if (id!==request || !capturing) return;
    capturing=false;const report=wanted && !disposed;wanted=false;
    if (disposed) removeListeners();
    if (report) onError(error);
  };
  const down=event=>{
    if (disposed || !enabled() || locked || drag || event.button!==0) return;
    target.focus({preventScroll:true});
    drag={id:event.pointerId,x:event.clientX,y:event.clientY};
    target.setPointerCapture?.(event.pointerId);
    if (event.pointerType==='mouse' && !capturing) {
      wanted=true;capturing=true;suppressPrimary=true;const id=++request;
      try {
        if (!target.requestPointerLock) throw new Error('Pointer lock unavailable');
        const pending=target.requestPointerLock();
        pending?.catch(error=>fail(id,error)); // Older implementations return void.
      } catch(error) { fail(id,error); }
    }
  };
  const dragMove=event=>{
    if (locked || !enabled() || drag?.id!==event.pointerId) return;
    move(event.clientX-drag.x,event.clientY-drag.y);drag.x=event.clientX;drag.y=event.clientY;
  };
  const dragEnd=event=>{if (drag?.id===event.pointerId) drag=null;};
  const dragCancel=event=>{if (drag?.id===event.pointerId) reset();};
  const mouseMove=event=>{if (locked && enabled()) move(event.movementX,event.movementY);};
  const mouseDown=event=>{
    if (locked && enabled() && event.button===0 && !suppressPrimary) {
      if (!primary) pressed=true;primary=true;event.preventDefault();
    }
  };
  const mouseUp=event=>{if (event.button===0) {primary=false;suppressPrimary=false;}};
  const lockChange=event=>{
    if (doc.pointerLockElement===target) {
      capturing=false;
      if (disposed || !wanted || !enabled()) {doc.exitPointerLock();if(disposed)removeListeners();return;}
      if (!locked) {
        locked=true;reset();onLock(event);
      }
    } else if (locked) {
      locked=false;wanted=false;reset();onUnlock(event);
    }
  };
  const lockError=event=>fail(request,event);
  const contextMenu=event=>{if (locked) event.preventDefault();};
  const listeners=[[target,'pointerdown',down],[target,'pointermove',dragMove],
    [target,'pointerup',dragEnd],[target,'pointercancel',dragCancel],[target,'lostpointercapture',dragCancel],
    [doc,'mousemove',mouseMove],[doc,'mousedown',mouseDown],[doc,'mouseup',mouseUp],
    [doc,'pointerlockchange',lockChange],[doc,'pointerlockerror',lockError],[target,'contextmenu',contextMenu]];
  for (const [node,name,handler] of listeners) node.addEventListener(name,handler);
  function removeListeners(){
    for (const [node,name,handler] of listeners) {
      // A legacy request returning void can still acquire after disposal.
      if (capturing && (name==='pointerlockchange' || name==='pointerlockerror')) continue;
      node.removeEventListener(name,handler);
    }
  }
  const release=()=>{
    wanted=false;locked=false;reset();suppressPrimary=true;
    if (doc.pointerLockElement===target) doc.exitPointerLock();
  };
  return {
    get locked(){return locked;},
    consume(){
      if (!enabled()) {reset();return {pitch:0,yaw:0,primary:false,pressed:false};}
      const sample={pitch,yaw,primary,pressed};pitch=0;yaw=0;pressed=false;return sample;
    },
    release,
    dispose(){disposed=true;release();removeListeners();}
  };
}
export function deadzone(value, zone=0.16) {
  if (!Number.isFinite(value) || !Number.isFinite(zone) || zone<0 || zone>=1) return 0;
  return Math.sign(value)*clamp((Math.abs(value)-zone)/(1-zone),0,1);
}
export class FlightGamepad {
  constructor() { this.reset(); this.identity=''; }
  reset() { this.armed=false; this.previousPause=false; }
  sample(pads=[]) {
    const out={thrust:[0,0,0],turn:[0,0,0],brake:false,pause:false,connected:false};
    const pad=Array.from(pads).find(p=>p && p.connected!==false && p.mapping==='standard');
    if (!pad) { this.identity='';this.reset();return out; }
    out.connected=true;
    const identity=`${pad.index}:${pad.id}`;
    if (identity!==this.identity) { this.identity=identity;this.reset(); }
    const button=i=>{
      const value=pad.buttons[i]?.value ?? Number(Boolean(pad.buttons[i]?.pressed));
      return Number.isFinite(value)?clamp(value,0,1):0;
    };
    const axis=i=>deadzone(pad.axes[i] ?? 0);
    if (!this.armed) {
      this.armed=!pad.buttons.some((_,i)=>button(i)>0.1) && pad.axes.every(x=>Math.abs(deadzone(x))===0);
      return out;
    }
    out.thrust=[axis(0),button(7)-button(6),axis(1)];
    out.turn=[-axis(3),-axis(2),button(4)-button(5)];out.brake=button(0)>0.5;
    out.pause=button(9)>0.5 && !this.previousPause;this.previousPause=button(9)>0.5;
    return out;
  }
}
