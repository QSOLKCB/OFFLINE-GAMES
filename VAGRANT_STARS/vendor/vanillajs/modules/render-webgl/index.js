// SPDX-License-Identifier: Apache-2.0
import {perspective,viewMatrix,multiplyMatrices} from '../math/index.js';
const vertex=`attribute vec3 position;attribute vec3 color;uniform mat4 vp;uniform float pointSize;
varying vec3 tint;varying float distanceToCamera;
void main(){gl_Position=vp*vec4(position,1.0);tint=color;distanceToCamera=gl_Position.w;gl_PointSize=pointSize;}`;
const fragment=`precision mediump float;varying vec3 tint;varying float distanceToCamera;uniform float fog;
void main(){float f=exp(-max(0.0,distanceToCamera)*fog);gl_FragColor=vec4(mix(vec3(0.018,0.03,0.05),tint,f),1.0);}`;
// Optional caller-owned output permits several primitives to be streamed into a
// single packed group. No per-object geometry array or spread-copy is required.
// Existing calls still create and return their own arrays; numerical order stays exact.
// OPT-INV-001: face topology is invariant; shade each face once instead of
// mapping the same RGB triplet again for every triangle vertex.
const BOX_FACES=[[0,4,6,2],[1,3,7,5],[0,1,5,4],[2,6,7,3],[0,2,3,1],[4,5,7,6]];
const BOX_SHADES=[.7,.9,.58,1,.8,.65];
const BOX_TRIANGLES=[0,1,2,0,2,3];
export function boxVertices(center,size,color,out=[]) {
  const corners=[];
  for(let i=0;i<8;i++) corners.push(center.map((v,k)=>v+size[k]*((i>>k&1)-.5)));
  const data=out;
  for(let i=0;i<BOX_FACES.length;i++){
    const face=BOX_FACES[i],shade=color.map(x=>x*BOX_SHADES[i]);
    for(let k=0;k<BOX_TRIANGLES.length;k++){
      const xyz=corners[face[BOX_TRIANGLES[k]]];
      data.push(...xyz,...shade);
    }
  }
  return data;
}
// Four known ring tessellations account for the built-in demos. Keep a bounded
// 1,984-byte table of binary64 unit-circle samples, not a world-geometry cache.
// Float64 retains the original trigonometric outputs before radius scaling.
const CACHED_RING_SEGMENTS=new Set([16,24,32,48]);
const ringSamples=new Map();
function circleSamples(segments){
  let samples=ringSamples.get(segments);
  if(!samples){
    samples=new Float64Array((segments+1)*2);
    for(let i=0;i<=segments;i++){
      const a=i/segments*Math.PI*2;
      samples[i*2]=Math.cos(a);samples[i*2+1]=Math.sin(a);
    }
    ringSamples.set(segments,samples);
  }
  return samples;
}
export function ringVertices(position,radius,color,segments=48,out=[]) {
  const data=out;
  if(CACHED_RING_SEGMENTS.has(segments)){
    const circle=circleSamples(segments);
    for(let i=0;i<segments;i++) for(const j of [i,i+1]){
      data.push(position[0]+circle[j*2]*radius,position[1]+circle[j*2+1]*radius,position[2],...color);
    }
  }else{
    // Preserve legacy behaviour for custom, fractional or invalid segment counts.
    for(let i=0;i<segments;i++) for(const j of [i,i+1]){
      const a=j/segments*Math.PI*2;
      data.push(position[0]+Math.cos(a)*radius,position[1]+Math.sin(a)*radius,position[2],...color);
    }
  }
  return data;
}
export class Renderer {
  #capacities=new WeakMap();
  constructor(canvas) {
    this.canvas=canvas;
    const gl=canvas.getContext('webgl',{antialias:true,alpha:false});
    if(!gl) throw new Error('WebGL is unavailable. Enable hardware acceleration or try another browser.');
    this.gl=gl;this.meshes=new Set();
    const shader=(type,source)=>{
      const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);
      if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const vs=shader(gl.VERTEX_SHADER,vertex),fs=shader(gl.FRAGMENT_SHADER,fragment),p=gl.createProgram();
    gl.attachShader(p,vs);gl.attachShader(p,fs);gl.linkProgram(p);gl.deleteShader(vs);gl.deleteShader(fs);
    if(!gl.getProgramParameter(p,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    this.program=p;gl.useProgram(p);
    this.position=gl.getAttribLocation(p,'position');this.color=gl.getAttribLocation(p,'color');
    this.vp=gl.getUniformLocation(p,'vp');this.fog=gl.getUniformLocation(p,'fog');this.pointSize=gl.getUniformLocation(p,'pointSize');
    gl.enable(gl.DEPTH_TEST);gl.clearColor(.018,.03,.05,1);
  }
  mesh(data,primitive='triangles') {
    const gl=this.gl, buffer=gl.createBuffer(),values=new Float32Array(data);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    gl.bufferData(gl.ARRAY_BUFFER,values,gl.STATIC_DRAW);
    const mesh={buffer,count:data.length/6,mode:primitive==='lines'?gl.LINES:primitive==='points'?gl.POINTS:gl.TRIANGLES};
    this.meshes.add(mesh);this.#capacities.set(mesh,values.byteLength);return mesh;
  }
  update(mesh,data) {
    if (!this.meshes.has(mesh)) throw new TypeError('mesh is not owned by this renderer');
    // RUNE / GALAXY: avoid a second CPU copy for caller-owned packed Float32
    // views. WebGL copies upload bytes into its own storage before return.
    const gl=this.gl,values=data instanceof Float32Array?data:new Float32Array(data);
    gl.bindBuffer(gl.ARRAY_BUFFER,mesh.buffer);
    if(values.byteLength>this.#capacities.get(mesh)){
      gl.bufferData(gl.ARRAY_BUFFER,values,gl.DYNAMIC_DRAW);this.#capacities.set(mesh,values.byteLength);
    }else if(values.byteLength){gl.bufferSubData(gl.ARRAY_BUFFER,0,values);}
    mesh.count=data.length/6;
  }
  /** Update complete interleaved XYZ/RGB vertices inside the current draw
   * range, without replacing the rest of the GPU buffer or changing draw count.
   * firstVertex is a vertex index, not a byte offset. This is opt-in; callers
   * must supply their own dirtied ranges and retain their full world state.
   */
  updateRange(mesh,firstVertex,data) {
    if (!this.meshes.has(mesh)) throw new TypeError('mesh is not owned by this renderer');
    if (!Number.isSafeInteger(firstVertex)||firstVertex<0) throw new RangeError('invalid first vertex');
    const values=data instanceof Float32Array?data:new Float32Array(data);
    if(values.length%6!==0 || firstVertex>mesh.count || values.length/6>mesh.count-firstVertex) {
      throw new RangeError('range must contain whole XYZ/RGB vertices inside the live draw count');
    }
    if(values.length){
      const gl=this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER,mesh.buffer);
      gl.bufferSubData(gl.ARRAY_BUFFER,firstVertex*24,values);
    }
  }
  clearMeshes() {for(const m of this.meshes){this.gl.deleteBuffer(m.buffer);this.#capacities.delete(m);}this.meshes.clear();}
  begin(position,orientation,{fog=.003,resolution=1}={}) {
    const gl=this.gl,rect=this.canvas.getBoundingClientRect(),dpr=Math.min(globalThis.devicePixelRatio||1,2)*resolution;
    const width=Math.max(1,Math.floor(rect.width*dpr)),height=Math.max(1,Math.floor(rect.height*dpr));
    if(this.canvas.width!==width||this.canvas.height!==height){this.canvas.width=width;this.canvas.height=height;}
    gl.viewport(0,0,width,height);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.vp,false,multiplyMatrices(perspective(Math.PI/2.6,width/height),viewMatrix(position,orientation)));
    gl.uniform1f(this.fog,fog);gl.uniform1f(this.pointSize,Math.max(1,dpr*1.3));
  }
  draw(mesh) {
    const gl=this.gl;gl.bindBuffer(gl.ARRAY_BUFFER,mesh.buffer);
    gl.enableVertexAttribArray(this.position);gl.vertexAttribPointer(this.position,3,gl.FLOAT,false,24,0);
    gl.enableVertexAttribArray(this.color);gl.vertexAttribPointer(this.color,3,gl.FLOAT,false,24,12);
    gl.drawArrays(mesh.mode,0,mesh.count);
  }
  dispose(){this.clearMeshes();this.gl.deleteProgram(this.program);}
}
