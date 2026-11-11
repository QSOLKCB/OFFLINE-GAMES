// SPDX-License-Identifier: Apache-2.0
import {bakePlanet} from './surface-detail.js';
// VANILLAJS packed XYZ/RGB scene adapter. Simulation never depends on this module.
import {perspective, viewMatrix, multiplyMatrices, rotate} from '../VAGRANT_STARS/vendor/vanillajs/modules/math/index.js';
import './vendor/galaxy/data/uff-demo.js';
import './vendor/galaxy/uff-physics.js';
import './vendor/galaxy/galaxy-core.js';
const color = (r,g,b) => `rgb(${Math.min(255,Math.max(0,r*255))|0},${Math.min(255,Math.max(0,g*255))|0},${Math.min(255,Math.max(0,b*255))|0})`;
export function projectVertex(m,x,y,z) {
  return [m[0]*x+m[4]*y+m[8]*z+m[12], m[1]*x+m[5]*y+m[9]*z+m[13], m[2]*x+m[6]*y+m[10]*z+m[14], m[3]*x+m[7]*y+m[11]*z+m[15]];
}
// Clip to the camera near plane before division, including triangles crossing it.
export function clipNear(points, near = 0.1) {
  const out = [];
  for (let i=0;i<points.length;i++) {
    const a=points[i], b=points[(i+1)%points.length], inside=a[3]>=near;
    if (inside) out.push(a);
    if (inside !== (b[3]>=near)) {const t=(near-a[3])/(b[3]-a[3]); out.push(a.map((v,j)=>v+(b[j]-v)*t));}
  }
  return out;
}
// Camera-space unit sphere; rays have direction (dx,dy,-1). Null means no
// forward surface intersection. Taking the exit root also handles entry inside.
export function planetRayHit(center,dx,dy){
  const a=dx*dx+dy*dy+1,b=dx*center[0]+dy*center[1]-center[2];
  const c=center[0]*center[0]+center[1]*center[1]+center[2]*center[2]-1;
  const disc=b*b-a*c;if(disc<0)return null;
  const root=Math.sqrt(disc),near=(b-root)/a,far=(b+root)/a;
  return near>0?near:far>0?far:null;
}
export async function detectGPU(nav = globalThis.navigator) {
  try {
    if (!nav?.gpu || typeof WebAssembly === 'undefined') return null;
    const adapter = await nav.gpu.requestAdapter({powerPreference:'low-power'});
    return adapter && !adapter.isFallbackAdapter && !adapter.info?.isFallbackAdapter ? adapter : null;
  } catch { return null; }
}
export class Renderer {
  constructor(canvas) {
    this.canvas=canvas; this.ctx=canvas.getContext('2d',{alpha:false});
    if (!this.ctx) throw new Error('Canvas 2D is unavailable');
    this.meshes=new Set(); this.backend='cpu'; this.fog='fog'; this.pointSize='pointSize'; this.fogValue=0; this.additive=false; this.writeDepth=true;
    // Compatibility bridge for the existing scene's pass controls; no WebGL context requested.
    this.gl={BLEND:1, DEPTH_BUFFER_BIT:2, ONE:1,
      deleteBuffer: mesh=>{this.gpu?.release(mesh);}, useProgram:()=>{}, blendFunc:()=>{},
      enable:()=>{this.additive=true;}, disable:()=>{this.additive=false;},
      depthMask: v=>{this.writeDepth=v;}, clear:()=>{this.gpu?.clearDepth();},
      uniform1f:(name,value)=>{if(name==='fog')this.fogValue=value;}};
  }
  mesh(data,mode='triangles') {const m={data:new Float32Array(data),mode};m.buffer=m;this.meshes.add(m);return m;}
  update(mesh,data) {mesh.data=data;}
  begin(position,orientation) {
    const rect=this.canvas.getBoundingClientRect(), scale=Math.min(1,960/Math.max(1,rect.width));
    const w=Math.max(1,Math.round(rect.width*scale)),h=Math.max(1,Math.round(rect.height*scale));
    if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;}
    this.vp=multiplyMatrices(perspective(Math.PI/2.6,w/h),viewMatrix(position,orientation));
    this.ctx.globalCompositeOperation='source-over';this.ctx.fillStyle='#030711';this.ctx.fillRect(0,0,w,h);
    try {
      if(this.gpu){
        const gpuScale=Math.min(1.5,1920/Math.max(1,rect.width));
        this.gpu.begin(Math.max(1,Math.round(rect.width*gpuScale)),Math.max(1,Math.round(rect.height*gpuScale)),this.vp);
      }
    } catch { this.useCPU(); }
  }
  draw(mesh) {
    if(this.gpu){try {this.gpu.draw(mesh,this.additive,this.writeDepth,this.fogValue);return;} catch {this.useCPU();}}
    const d=mesh.data, m=this.vp,ctx=this.ctx,w=this.canvas.width,h=this.canvas.height;
    ctx.globalCompositeOperation=this.additive?'lighter':'source-over';
    const stride=mesh.mode==='triangles'?18:mesh.mode==='lines'?12:6, faces=[];
    for(let i=0;i<d.length;i+=stride){
      // Disc fans share one bright centre and black rim. Paint the entire fan
      // with one smooth radial gradient instead of flat, opaque triangles.
      if(this.additive&&stride===18&&d[i+9]===0&&d[i+10]===0&&d[i+11]===0&&d[i+15]===0&&d[i+16]===0&&d[i+17]===0){
        let end=i+18;
        while(end<d.length&&d[end]===d[i]&&d[end+1]===d[i+1]&&d[end+2]===d[i+2]&&d[end+3]===d[i+3]&&d[end+4]===d[i+4]&&d[end+5]===d[i+5]&&d[end+9]===0&&d[end+10]===0&&d[end+11]===0&&d[end+15]===0&&d[end+16]===0&&d[end+17]===0)end+=18;
        const center=projectVertex(m,d[i],d[i+1],d[i+2]);
        if(center[3]>.1){
          const x=(center[0]/center[3]*.5+.5)*w,y=(.5-center[1]/center[3]*.5)*h;let radius=0;
          for(let k=i;k<end;k+=18){const p=projectVertex(m,d[k+6],d[k+7],d[k+8]);if(p[3]>.1)radius=Math.max(radius,Math.hypot((p[0]/p[3]*.5+.5)*w-x,(.5-p[1]/p[3]*.5)*h-y));}
          if(radius>0&&radius<Math.max(w,h)*8){const g=ctx.createRadialGradient(x,y,0,x,y,radius);g.addColorStop(0,color(d[i+3],d[i+4],d[i+5]));g.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=g;ctx.fillRect(x-radius,y-radius,radius*2,radius*2);}
        }
        i=end-stride;continue;
      }
      let points=[];let depth=0;
      for(let j=0;j<stride;j+=6){const p=projectVertex(m,d[i+j],d[i+j+1],d[i+j+2]);points.push(p);depth+=p[3];}
      if(mesh.mode==='triangles')points=clipNear(points);
      else if(points.some(p=>p[3]<0.1))continue;
      if(!points.length)continue;
      const xy=points.map(p=>[(p[0]/p[3]*.5+.5)*w,(.5-p[1]/p[3]*.5)*h]);
      if(xy.every(p=>p[0]<0)||xy.every(p=>p[0]>w)||xy.every(p=>p[1]<0)||xy.every(p=>p[1]>h))continue;
      const fog=Math.exp(-Math.max(0,depth/(stride/6))*this.fogValue);
      faces.push({xy,depth,fill:color(d[i+3]*fog,d[i+4]*fog,d[i+5]*fog)});
    }
    if(mesh.mode==='triangles'&&!this.additive)faces.sort((a,b)=>b.depth-a.depth);
    for(const f of faces){
      ctx.fillStyle=ctx.strokeStyle=f.fill;
      if(mesh.mode==='points'){ctx.fillRect(f.xy[0][0],f.xy[0][1],1.3,1.3);continue;}
      ctx.beginPath();ctx.moveTo(...f.xy[0]);for(let i=1;i<f.xy.length;i++)ctx.lineTo(...f.xy[i]);
      if(mesh.mode==='lines'){ctx.lineWidth=1;ctx.stroke();}else{ctx.closePath();ctx.fill();}
    }
    ctx.globalCompositeOperation='source-over';
  }
  end(){try {this.gpu?.end();} catch {this.useCPU();}}
  async enableGPU(adapter){
    const {GPUBackend}=await import('./webgpu.js');
    const backend=await GPUBackend.create(this.canvas,adapter,()=>this.useCPU());
    this.gpu=backend;this.backend='webgpu+wasm';this.onBackend?.();
  }
  useCPU(){const gpu=this.gpu;this.gpu=null;this.backend='cpu';gpu?.dispose();this.onBackend?.();}
  dispose(){this.useCPU();this.meshes.clear();}
}
export class Environment {
  constructor(renderer){this.renderer=renderer;this.bakes=0;this.key=null;this.sky=null;this.planetTextures=new Map();this.planetPixels=new WeakMap();this.nearPlanet=null;}
  configure(seed,sky,planets){
    const key=JSON.stringify([seed,sky,planets]);if(this.key===key)return;this.key=key;this.bakes++;
    const c=document.createElement('canvas');c.width=960;c.height=540;const ctx=c.getContext('2d');
    ctx.fillStyle='#030711';ctx.fillRect(0,0,960,540);
    for(const [x,y,r,col] of [[240,180,370,'#143653'],[720,310,310,'#34223d'],[460,420,210,'#103943']]){
      const g=ctx.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,col);g.addColorStop(1,'#03071100');ctx.fillStyle=g;ctx.fillRect(0,0,960,540);
    }
    const core=globalThis.GalaxyCore, settings={...core.defaults(),seed,inclination:72,rotation:-24,dynamics:'legacy'};
    const sample=core.buildSample(16384,1024,seed), star={};
    // OPT-INV-001: seed/settings are the complete identity of this one cached sky.
    for(let i=0;i<1024;i++){core.starAt(sample,i,settings,0,star);ctx.fillStyle=star.bulge?'#f8d9a2':'#9ec9ef';ctx.globalAlpha=star.light*.65;ctx.fillRect(480+star.x*420,270+star.y*420,star.size,star.size);}
    ctx.globalAlpha=1;this.sky=c;
  }
  drawSky(){if(this.sky)this.renderer.ctx.drawImage(this.sky,0,0,this.renderer.canvas.width,this.renderer.canvas.height);}
  drawPlanets(vp,planets,cam){
    const r=this.renderer,ctx=r.ctx,w=r.canvas.width,h=r.canvas.height;
    for(const planet of planets){
      const relative=planet.pos.map((v,i)=>v-cam.pos[i]);
      const p=projectVertex(vp,...relative);
      if(p[3]+planet.radius<=0)continue; // only reject a sphere wholly behind us
      const key=planet.palette||'terrestrial';let texture=this.planetTextures.get(key);
      if(!texture){texture=bakePlanet(key);if(this.planetTextures.size>=8)this.planetTextures.clear();this.planetTextures.set(key,texture);this.bakes++;}
      if(Math.hypot(...relative)<planet.radius*4 || p[3]<=planet.radius){
        const q=cam.q,center=rotate([-q[0],-q[1],-q[2],q[3]],relative).map(v=>v/planet.radius);
        this.drawNearbyPlanet(center,texture,w,h);continue;
      }
      const x=(p[0]/p[3]*.5+.5)*w,y=(.5-p[1]/p[3]*.5)*h,rad=planet.radius/p[3]*h/(2*Math.tan(Math.PI/5.2));
      if(x+rad<0||x-rad>w||y+rad<0||y-rad>h)continue;
      const glow=ctx.createRadialGradient(x,y,rad*.96,x,y,rad*1.09);glow.addColorStop(0,'#67b6de90');glow.addColorStop(1,'#67b6de00');ctx.fillStyle=glow;ctx.beginPath();ctx.arc(x,y,rad*1.09,0,Math.PI*2);ctx.fill();
      ctx.drawImage(texture,x-rad,y-rad,rad*2,rad*2);
    }
  }
  drawNearbyPlanet(center,texture,w,h){
    // A bounded ray/sphere surface pass handles grazing views, camera-plane
    // crossings and atmospheric entry without projecting a singular centre.
    const scale=Math.min(1,320/Math.max(w,h));
    const width=Math.max(1,Math.round(w*scale)),height=Math.max(1,Math.round(h*scale));
    if(!this.nearPlanet){this.nearPlanet=document.createElement('canvas');}
    const canvas=this.nearPlanet;
    if(!this.nearPixels||canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;this.nearPixels=canvas.getContext('2d').createImageData(width,height);}
    let source=this.planetPixels.get(texture);
    if(!source){source=texture.getContext('2d').getImageData(0,0,256,256).data;this.planetPixels.set(texture,source);}
    const data=this.nearPixels.data;data.fill(0);
    const tan=Math.tan(Math.PI/5.2),aspect=w/h;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const dx=(2*(x+.5)/width-1)*aspect*tan,dy=(1-2*(y+.5)/height)*tan;
      const t=planetRayHit(center,dx,dy);if(t===null)continue;
      const nx=t*dx-center[0],ny=t*dy-center[1];
      const tx=Math.max(0,Math.min(255,Math.round(127.5+nx*126))),ty=Math.max(0,Math.min(255,Math.round(127.5-ny*126)));
      const i=(y*width+x)*4,j=(ty*256+tx)*4;
      data[i]=source[j];data[i+1]=source[j+1];data[i+2]=source[j+2];data[i+3]=255;
    }
    canvas.getContext('2d').putImageData(this.nearPixels,0,0);
    this.renderer.ctx.drawImage(canvas,0,0,w,h);
  }
  dispose(){this.sky=null;this.nearPlanet=null;this.nearPixels=null;this.planetTextures.clear();}
}
export function mountGraphics(renderer){
  const panel=document.createElement('div');panel.className='graphics-controls';
  panel.innerHTML='<span data-status>CPU · software rendering</span><button type="button" data-gpu disabled>Checking GPU…</button><button type="button" data-cpu hidden>Use CPU</button>';
  document.querySelector('#menu .menu-card').append(panel);
  const gpu=panel.querySelector('[data-gpu]'),cpu=panel.querySelector('[data-cpu]'),status=panel.querySelector('[data-status]');
  renderer.onBackend=()=>{status.textContent=renderer.backend==='cpu'?'CPU · software rendering':'WebGPU + WASM · enabled';cpu.hidden=renderer.backend==='cpu';gpu.hidden=!cpu.hidden;};
  cpu.onclick=()=>renderer.useCPU();
  detectGPU().then(adapter=>{
    gpu.textContent=adapter?'Enable WebGPU + WASM':'CPU mode · no compatible GPU';gpu.disabled=!adapter;
    gpu.onclick=async()=>{gpu.disabled=true;try{const fresh=await detectGPU();if(!fresh)throw new Error('No compatible GPU');await renderer.enableGPU(fresh);}catch{renderer.useCPU();status.textContent='GPU unavailable · continuing on CPU';}finally{gpu.disabled=false;}};
  });
}
