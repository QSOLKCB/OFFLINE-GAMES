// SPDX-License-Identifier: Apache-2.0
// Source-inspired by QSOLKCB/GAMES LATTICE_CORSAIR/flight.js at
// 7e0a9019d07b491cffc9b698fa51acdb843c49cc (Apache-2.0).
// Static-snapshot, adaptive 2D swept-circle broadphase. No game state or clock.
const MAX_ITEMS=16384, LIMIT=1e9, EPS=Number.EPSILON;
const point=(value,name)=>{
  if(!Array.isArray(value)||value.length!==2||
     ![0,1].every(i=>Object.hasOwn(value,i)&&
       typeof value[i]==='number'&&Number.isFinite(value[i])&&Math.abs(value[i])<=LIMIT))
    throw new TypeError(name+' must be two finite coordinates within +/-1e9');
  return [value[0]===0?0:value[0],value[1]===0?0:value[1]];
};
const integer=(value,name)=>{
  if(!Number.isSafeInteger(value)||value<1)throw new RangeError(name+' must be a positive safe integer');
  return value;
};
const circle=(item,i)=>{
  if(!item||typeof item!=='object')throw new TypeError('circle '+i+' must be an object');
  const id=integer(item.id,'circle id');
  const center=point([item.x,item.y],'circle center');
  if(typeof item.radius!=='number'||!Number.isFinite(item.radius)||
    item.radius<=0||item.radius>LIMIT)throw new RangeError('invalid circle radius');
  if(center.some(x=>Math.abs(x)+item.radius>LIMIT))
    throw new RangeError('circle bounds exceed coordinate domain');
  return Object.freeze({id,x:center[0],y:center[1],radius:item.radius,index:i});
};
/** Shared narrowphase for both broadphases. First entry into a closed circle.
 * The quadratic discriminant b*b-4*a*c loses the small clearance term when
 * the segment is very long relative to the radius, creating false contacts.
 * Instead resolve along-track distance and perpendicular clearance in a
 * unit-length segment frame; compute the half-chord without subtracting
 * nearly equal squared distances. Start-inside remains time zero. */
function intersection(start,delta,c){
  const dx=delta[0],dy=delta[1],fx=start[0]-c.x,fy=start[1]-c.y;
  const radius=c.radius;
  if(Math.hypot(fx,fy)<=radius)return 0;
  const length=Math.hypot(dx,dy);
  if(length===0)return null;
  const ux=dx/length,uy=dy/length;
  const forward=-(fx*ux+fy*uy);
  if(forward<=0)return null; // Closest point on the forward ray is its origin.
  const clearance=Math.abs(fx*uy-fy*ux);
  if(clearance>radius)return null;
  const halfChord=Math.sqrt((radius-clearance)*(radius+clearance));
  const t=(forward-halfChord)/length;
  return t>=0&&t<=1?t:null;
}
const choose=(best,c,t)=>t!==null &&
 (!best||t<best.time||(t===best.time&&c.id<best.id))?
 {id:c.id,index:c.index,time:t}:best;

/** Bounded immutable snapshot of live circles. Rebuild explicitly after motion.
 * A grid is used only above a declared item threshold; long/wide queries
 * fall back to the all-pairs oracle, never to lossy approximate answers. */
export class AdaptiveCircleQueries {
  #circles;#grid;#radius;#cell;#minGrid;#maxVisits;
  constructor(circles,{cellSize=256,gridMin=32,maxCellVisits=16384}={}){
    if(!Array.isArray(circles)||circles.length>MAX_ITEMS)
      throw new RangeError('circles must be an array of at most 16384 entries');
    if(!Number.isFinite(cellSize)||cellSize<1||cellSize>LIMIT)
      throw new RangeError('cellSize must be within [1, 1e9]');
    if(!Number.isSafeInteger(gridMin)||gridMin<1||gridMin>MAX_ITEMS)
      throw new RangeError('gridMin must be within [1, 16384]');
    if(!Number.isSafeInteger(maxCellVisits)||maxCellVisits<1||maxCellVisits>65536)
      throw new RangeError('maxCellVisits must be within [1, 65536]');
    const rows=circles.map(circle),ids=new Set();
    for(const c of rows){if(ids.has(c.id))throw new RangeError('duplicate circle id');ids.add(c.id);}
    this.#circles=Object.freeze(rows);
    this.#radius=rows.reduce((a,c)=>Math.max(a,c.radius),0);
    this.#cell=cellSize;this.#minGrid=gridMin;this.#maxVisits=maxCellVisits;
    this.#grid=new Map();
    if(rows.length>=gridMin)for(const c of rows){
      const key=Math.floor(c.x/cellSize)+','+Math.floor(c.y/cellSize);
      let list=this.#grid.get(key);
      if(!list){list=[];this.#grid.set(key,list);}
      list.push(c);
    }
  }
  get size(){return this.#circles.length;}
  get indexed(){return this.#grid.size>0;}
  /** Returns {hit,mode,tested} with stable ID-then-source-index metadata.
   * Any ignored IDs are validated before a no-hit or early-hit outcome.
   * Grid iteration may reorder candidates; nearest t then lowest id wins. */
  castSegment(origin,displacement,{ignoreIds=[]}={}){
    const start=point(origin,'origin'),delta=point(displacement,'displacement');
    const end=start.map((x,i)=>x+delta[i]);
    if(end.some(x=>!Number.isFinite(x)||Math.abs(x)>LIMIT))
      throw new RangeError('segment endpoint exceeds coordinate domain');
    if(!Array.isArray(ignoreIds)||ignoreIds.length>MAX_ITEMS)
      throw new TypeError('ignoreIds must be a bounded array');
    const ignored=new Set();
    for(const id of ignoreIds)ignored.add(integer(id,'ignored circle id'));
    let candidates=this.#circles,mode='brute';
    if(this.#grid.size){
      // Margin includes IEEE-754 error in the segment AABB and cell division.
      // If grid math is uncertain/too wide, the reference is always safe.
      const extent=Math.max(...start.map(Math.abs),...end.map(Math.abs),
        ...delta.map(Math.abs),this.#radius,1);
      const margin=128*EPS*extent;
      const pad=this.#radius+margin;
      const ax=Math.floor((Math.min(start[0],end[0])-pad)/this.#cell);
      const bx=Math.floor((Math.max(start[0],end[0])+pad)/this.#cell);
      const ay=Math.floor((Math.min(start[1],end[1])-pad)/this.#cell);
      const by=Math.floor((Math.max(start[1],end[1])+pad)/this.#cell);
      const nx=bx-ax+1,ny=by-ay+1;
      if([ax,bx,ay,by,nx,ny,pad].every(Number.isFinite)&&
        nx>=1&&ny>=1&&nx<=this.#maxVisits&&ny<=this.#maxVisits&&
        nx*ny<=this.#maxVisits){
        const seen=[];
        for(let x=ax;x<=bx;x++)for(let y=ay;y<=by;y++){
          const row=this.#grid.get(x+','+y);
          if(row)seen.push(...row);
        }
        candidates=seen;mode='grid';
      }
    }
    let hit=null,tested=0;
    for(const c of candidates){
      if(ignored.has(c.id))continue;
      tested++;
      hit=choose(hit,c,intersection(start,delta,c));
    }
    return {hit,mode,tested,total:this.#circles.length};
  }
}
