// SPDX-License-Identifier: Apache-2.0
/** Simulation-time magazine/cooldown/reload state. Owns no input, geometry or damage.
 * Consumers send fire edges for single-shot or held requests for automatic fire. */
export class WeaponTimer {
  #ammo; #reserve; #magazineSize; #interval; #reloadTime; #cooldown=0; #remaining=0; #nextShot=1;
  constructor({magazineSize=8,ammo=magazineSize,reserve=32,interval=.2,reloadTime=1.2}={}) {
    if(!Number.isSafeInteger(magazineSize) || magazineSize<1 || !Number.isSafeInteger(ammo) || ammo<0 || ammo>magazineSize ||
       !Number.isSafeInteger(reserve) || reserve<0)throw new RangeError('invalid magazine or reserve');
    if(!Number.isFinite(interval) || interval<.05 || !Number.isFinite(reloadTime) || reloadTime<.05)throw new RangeError('timings must be at least .05 seconds');
    this.#magazineSize=magazineSize;this.#ammo=ammo;this.#reserve=reserve;this.#interval=interval;this.#reloadTime=reloadTime;
  }
  snapshot() {
    return {ammo:this.#ammo,reserve:this.#reserve,magazineSize:this.#magazineSize,cooldown:this.#cooldown,reloadRemaining:this.#remaining,
      phase:this.#remaining>0?'reloading':this.#cooldown>0?'cooldown':this.#ammo===0?'empty':'ready'};
  }
  /** At most one shot per tick, at t=0. Requests blocked by cooldown/reload are
   * discarded, not queued. Reload takes priority and finishes at its within-tick time. */
  step(dt,{fire=false,reload=false}={}) {
    if(!Number.isFinite(dt) || dt<0 || dt>.05)throw new RangeError('weapon dt must be 0..0.05 seconds');
    if(dt===0)return [];
    const events=[];
    if(reload && this.#remaining===0 && this.#ammo<this.#magazineSize && this.#reserve>0) {
      this.#remaining=this.#reloadTime;events.push({type:'reload-start',time:0});
    }
    if(this.#remaining>0) {
      const before=this.#remaining;this.#remaining=Math.max(0,before-dt);
      if(this.#remaining<1e-12) {
        this.#remaining=0;const rounds=Math.min(this.#magazineSize-this.#ammo,this.#reserve);
        this.#ammo+=rounds;this.#reserve-=rounds;events.push({type:'reload-complete',time:Math.min(dt,before),rounds});
      }
    } else if(fire && this.#cooldown<=1e-12 && this.#ammo>0) {
      if(!Number.isSafeInteger(this.#nextShot))throw new RangeError('shot id space exhausted');
      this.#ammo--;this.#cooldown=this.#interval;events.push({type:'shot',time:0,id:this.#nextShot++});
    }
    this.#cooldown=Math.max(0,this.#cooldown-dt);
    if(this.#cooldown<1e-12)this.#cooldown=0;
    return events;
  }
}
