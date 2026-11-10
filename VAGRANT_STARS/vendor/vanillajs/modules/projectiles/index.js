// SPDX-License-Identifier: Apache-2.0
import {finiteVector,add,scale} from '../math/index.js';
import {castSegment,castMovingSegment} from '../collision/index.js';

/** Straight, constant-velocity point/cube projectiles against AABBs.
 * Owns motion/lifetime only. Consumers resolve the returned hit events.
 */
export class ProjectileSystem {
  #shots=new Map();
  #nextId=1;
  #capacity;
  constructor({capacity=128}={}) {
    if (!Number.isSafeInteger(capacity) || capacity<1) throw new RangeError('capacity must be a positive integer');
    this.#capacity=capacity;
  }
  get size() {return this.#shots.size;}
  get capacity() {return this.#capacity;}
  snapshots() {return structuredClone([...this.#shots.values()]);}
  clear() {this.#shots.clear();} // Never reuse ids during this instance's lifetime.
  spawn({position,velocity,lifetime=3,halfSize=0,ignoreIds=[],data=null}={}) {
    position=finiteVector(position,3,'position');velocity=finiteVector(velocity,3,'velocity');
    if (!Number.isFinite(lifetime) || lifetime<=0 || !Number.isFinite(halfSize) || halfSize<0) {
      throw new RangeError('invalid projectile lifetime or halfSize');
    }
    if (!Array.isArray(ignoreIds) || !ignoreIds.every(id=>typeof id==='string')) throw new TypeError('invalid ignoreIds');
    data=structuredClone(data);
    if (this.size>=this.#capacity) return {accepted:false,id:null,reason:'capacity'};
    if (!Number.isSafeInteger(this.#nextId)) throw new RangeError('projectile id space exhausted');
    const id=this.#nextId++;
    this.#shots.set(id,{id,position,velocity,remaining:lifetime,halfSize,ignoreIds:[...ignoreIds],data});
    return {accepted:true,id,reason:null};
  }
  step(dt,colliders=[]) {
    return this.#step(dt,colliders,false);
  }
  /** Boxes are at tick start; displacement spans all dt, even when a shot
   * expires earlier. Translation only; split ticks at discontinuities. */
  stepMoving(dt,colliders=[]) {
    return this.#step(dt,colliders,true);
  }
  #step(dt,colliders,moving) {
    if (!Number.isFinite(dt) || dt<0) throw new RangeError('dt must be finite and nonnegative');
    if (dt===0) return [];
    // Stage changes so a rejected query cannot leave half the projectiles advanced.
    const next=new Map(), events=[];
    for (const shot of this.#shots.values()) {
      const travel=Math.min(dt,shot.remaining), delta=scale(shot.velocity,travel);
      const targets=moving?colliders.map(c=>({...c,displacement:scale(finiteVector(c.displacement??[0,0,0],3,'collider displacement'),travel/dt)})):colliders;
      const hit=(moving?castMovingSegment:castSegment)(shot.position,delta,targets,{halfSize:shot.halfSize,ignoreIds:shot.ignoreIds});
      if (hit) {
        events.push({type:'hit',projectileId:shot.id,time:travel*hit.time,hit,data:structuredClone(shot.data)});
      } else if (shot.remaining<=dt) {
        events.push({type:'expired',projectileId:shot.id,time:travel,position:add(shot.position,delta),data:structuredClone(shot.data)});
      } else {
        next.set(shot.id,{...shot,position:add(shot.position,delta),remaining:shot.remaining-dt});
      }
    }
    // Chronological within the tick; stable id breaks exact-time ties.
    events.sort((a,b)=>a.time-b.time || a.projectileId-b.projectileId);
    this.#shots=next;
    return events;
  }
}
