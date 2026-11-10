// SPDX-License-Identifier: Apache-2.0
// General-purpose conservative 2-D range prefilter, based on the mathematical
// OPT-REDUCE-001 principle used in QSOLKCB/CorpoWars3d v1.2.0
// (merge 5701949e4ef7047b715db808b777450c3bf49d53, PR #10).
// No donor game simulation or AI source is copied.
const point=(x,label)=>{
  if(!x||typeof x!=='object'||typeof x.x!=='number'||typeof x.y!=='number'||
     !Number.isFinite(x.x)||!Number.isFinite(x.y))
    throw new TypeError(label+' must provide finite x and y numbers');
  return x;
};
const limitValue=x=>{
  if(typeof x!=='number'||!Number.isFinite(x)||x<0)
    throw new RangeError('range must be a finite nonnegative number');
  return x;
};
/** Bound-preserving, exact reject for finite Euclidean distances.
 * If |dx| or |dy| exceeds a finite limit, hypot(dx,dy) cannot be within
 * that range. Borderline values always go through Math.hypot.
 * Callers must not substitute squared norms: they can overflow. */
export function distanceCheck2D(a,b,range,{inclusive=true}={}){
  point(a,'a');point(b,'b');limitValue(range);
  if(typeof inclusive!=='boolean')throw new TypeError('inclusive must be boolean');
  const dx=a.x-b.x,dy=a.y-b.y;
  if(Math.abs(dx)>range||Math.abs(dy)>range)
    return {within:false,distance:null,axisRejected:true};
  const distance=Math.hypot(dx,dy);
  return {within:inclusive?distance<=range:distance<range,distance,axisRejected:false};
}
/** A guarded, short-circuit replacement for condition
 * Math.hypot(dx,dy) <= range && expensivePredicate().
 * The callback is never evaluated for an out-of-range target. */
export function withinRange2D(a,b,range,predicate=()=>true){
  if(typeof predicate!=='function')throw new TypeError('predicate must be a function');
  const checked=distanceCheck2D(a,b,range);
  return checked.within&&Boolean(predicate(a,b));
}
