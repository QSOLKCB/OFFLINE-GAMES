// SPDX-License-Identifier: Apache-2.0
// Cosmetic meshes only: never return these to collision or hardpoint code.
const cache=new WeakMap();
export function detailedModel(model,station=false){
  let pair=cache.get(model);if(!pair){pair=[];cache.set(model,pair);}const slot=station?1:0;if(pair[slot])return pair[slot];
  const tris=Array.from(model.tris),normals=Array.from(model.normals),colors=Array.from(model.colors),glow=Array.from(model.glow);
  const limit=station?160:96;let added=0;
  for(let i=0;i<model.count&&added<limit;i++){
    if(model.glow[i])continue;
    const n=i*3,v=i*9, a=Array.from(model.tris.subarray(v,v+3)),b=Array.from(model.tris.subarray(v+3,v+6)),c=Array.from(model.tris.subarray(v+6,v+9));
    const cross=[(b[1]-a[1])*(c[2]-a[2])-(b[2]-a[2])*(c[1]-a[1]),(b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]),(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])];
    if(Math.hypot(...cross)<model.radius*model.radius*(station?.002:.001))continue;
    const normal=Array.from(model.normals.subarray(n,n+3)),offset=model.radius*.0004;
    const paired=i+1<model.count && [0,1,2].every(j=>model.tris[v+9+j]===a[j]&&model.tris[v+12+j]===c[j]&&Math.abs(model.normals[n+3+j]-normal[j])<.001);
    const points=paired?[a,b,c,Array.from(model.tris.subarray(v+15,v+18))]:[a,b,c];
    const center=a.map((_,j)=>points.reduce((sum,p)=>sum+p[j],0)/points.length);
    const shade=.88+((i*37)%17)/100;
    for(let j=0;j<(paired?6:3);j++)colors[n+j]*=.68;
    const plate=points.map(point=>point.map((x,j)=>center[j]+(x-center[j])*.94+normal[j]*offset));
    for(const t of paired?[[0,1,2],[0,2,3]]:[[0,1,2]]){
      for(const k of t)tris.push(...plate[k]);
      normals.push(...normal);colors.push(...Array.from(model.colors.subarray(n,n+3),x=>x*shade));glow.push(0);added++;
    }
    if(station&&added<limit-2&&i%4===0){
      const at=(u,v)=>a.map((x,j)=>x+(b[j]-x)*u+(c[j]-x)*v+normal[j]*offset*2);
      const p=[at(.18,.28),at(.62,.28),at(.58,.31),at(.18,.31)];
      for(const t of [[0,1,2],[0,2,3]]){for(const k of t)tris.push(...p[k]);normals.push(...normal);colors.push(.3,.68,.82);glow.push(1);}added+=2;
    }
    if(paired)i++;
  }
  return pair[slot]={...model,tris:new Float32Array(tris),normals:new Float32Array(normals),colors:new Float32Array(colors),glow:new Float32Array(glow),count:glow.length};
}
// Planet texture is baked once per palette + light, at a fixed bounded resolution.
export function bakePlanet(palette='gas',light=[-.55,.45,.7]){
  const canvas=document.createElement('canvas');canvas.width=canvas.height=256;
  const ctx=canvas.getContext('2d'),img=ctx.createImageData(256,256),len=Math.hypot(...light)||1,L=light.map(x=>x/len);
  for(let y=0;y<256;y++)for(let x=0;x<256;x++){
    const nx=(x-127.5)/126,ny=(127.5-y)/126,r2=nx*nx+ny*ny;if(r2>1)continue;const nz=Math.sqrt(1-r2);
    const swirl=Math.sin(nx*11+Math.sin(ny*17)*1.8+nz*7),fine=Math.sin(nx*91+ny*47+nz*33)*Math.sin(ny*83-nx*23);
    let c;
    if(palette==='gas'){
      const bands=.5+.5*Math.sin(ny*49+swirl*1.4),storm=Math.exp(-((nx-.32)**2*85+(ny+.22)**2*250));
      c=[.52+bands*.28+storm*.15,.38+bands*.28-storm*.16,.29+bands*.24-storm*.13];
    }else if(palette==='ice')c=[.42+swirl*.12,.63+swirl*.13,.72+swirl*.15];
    else {const land=Math.sin(nx*9+nz*8)+Math.sin(ny*13-nx*3)+swirl*.6;c=land>.35?[.18,.35,.23]:[.05,.2,.36];const cloud=Math.max(0,Math.sin(ny*29+swirl*3+nz*11)-.55)*.6;c=c.map(v=>v+cloud);}
    const sun=Math.max(0,nx*L[0]+ny*L[1]+nz*L[2]),shade=.055+sun*.95,rim=Math.pow(1-nz,4)*Math.max(.2,sun);
    const i=(y*256+x)*4;for(let j=0;j<3;j++)img.data[i+j]=Math.min(255,(c[j]*(shade+fine*.025)+rim*[.1,.3,.5][j])*255);img.data[i+3]=Math.min(255,(1-r2)*126*255);
  }
  ctx.putImageData(img,0,0);return canvas;
}
