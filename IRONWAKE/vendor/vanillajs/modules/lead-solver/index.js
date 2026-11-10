// SPDX-License-Identifier: Apache-2.0
// Independent constant-velocity lead solution. Concepts referenced from
// QSOLKCB/Ski-Shooter v0.2.0 and QSOLKCB/AFTER-ZERO (not code transplants).
// A diagnostic aiming aid, NOT a ballistics, collision or target-AI oracle.
const MAX_POSITION=1e9,MAX_SPEED=1e9;
const vector=(value,name)=>{
  if(!Array.isArray(value)||value.length!==3||
    ![0,1,2].every(i=>Object.hasOwn(value,i)&&typeof value[i]==='number'&&
      Number.isFinite(value[i])&&Math.abs(value[i])<=MAX_POSITION))
    throw new TypeError(name+' must contain three finite bounded coordinates');
  return value.map(x=>x===0?0:x);
};
const number=(v,name,min,max)=>{
  if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)
    throw new RangeError(name+' must be finite within ['+min+', '+max+']');
  return v;
};
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
/**
 * Earliest nonnegative intercept under linear motion, instantaneous launch
 * and a constant-speed projectile. No gravity, obstacles or acceleration.
 * Returns null when no finite intercept occurs within maxTime.
 * Units are caller-owned but must agree (metres, metres/sec, seconds).
 * inheritance is the fraction of shooter velocity added to launch velocity.
 */
export function leadIntercept({
  shooterPosition,shooterVelocity=[0,0,0],targetPosition,targetVelocity=[0,0,0],
  projectileSpeed,inheritance=0,maxTime=30
}={}){
  const origin=vector(shooterPosition,'shooterPosition'),
    shooter=vector(shooterVelocity,'shooterVelocity'),
    target=vector(targetPosition,'targetPosition'),
    velocity=vector(targetVelocity,'targetVelocity');
  number(projectileSpeed,'projectileSpeed',Number.MIN_VALUE,1e6);
  number(inheritance,'inheritance',0,1);number(maxTime,'maxTime',0,3600);
  const r=target.map((x,i)=>x-origin[i]),
    relative=velocity.map((x,i)=>x-inheritance*shooter[i]);
  const c=dot(r,r);
  if(c===0)return null; // Coincident centres have no unique initial direction.
  const relativeSquared=dot(relative,relative);
  const squared=projectileSpeed*projectileSpeed;
  const a=relativeSquared-squared,b=2*dot(r,relative);
  let roots;
  // Guard the near-linear limit to avoid catastrophic time cancellation.
  if(Math.abs(a)<=32*Number.EPSILON*Math.max(1,relativeSquared,squared)){
    roots=b<0?[-c/b]:[];
  }else{
    const disc=b*b-4*a*c;
    if(!Number.isFinite(disc)||disc<0)return null;
    const s=Math.sqrt(disc),q=-.5*(b+(b>=0?s:-s));
    roots=q===0?[-b/(2*a)]:[q/a,c/q];
  }
  const time=roots.filter(t=>Number.isFinite(t)&&t>=0&&t<=maxTime)
    .reduce((best,t)=>Math.min(best,t),Infinity);
  if(!Number.isFinite(time))return null;
  const flight=r.map((x,i)=>x+relative[i]*time),norm=Math.hypot(...flight);
  if(!(norm>0))return null;
  const direction=flight.map(x=>x/norm),
    launchVelocity=direction.map((x,i)=>x*projectileSpeed+inheritance*shooter[i]),
    interceptPoint=target.map((x,i)=>x+velocity[i]*time);
  if(![...direction,...launchVelocity,...interceptPoint].every(Number.isFinite))
    return null;
  return {time,direction,launchVelocity,interceptPoint};
}
