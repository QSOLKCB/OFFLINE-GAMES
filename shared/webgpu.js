// SPDX-License-Identifier: Apache-2.0
// Optional, lazy-loaded backend: WASM packs clip-space vertices; WebGPU rasterizes.
import wasmBytes from './wasm/project-bytes.js';
const shader=`struct Out {@builtin(position) p:vec4f,@location(0) c:vec3f};
@vertex fn vs(@location(0) p:vec4f,@location(1) c:vec3f)->Out {
var o:Out;o.p=vec4f(p.xy,(p.z+p.w)*0.5,p.w);o.c=c;return o;}
@fragment fn fs(i:Out)->@location(0) vec4f{return vec4f(i.c,1);}`;
const compositeShader=`
@group(0) @binding(0) var scene:texture_2d<f32>;
@group(0) @binding(1) var background:texture_2d<f32>;
@vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f {
let p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));return vec4f(p[i],0,1);}
@fragment fn fs(@builtin(position) p:vec4f)->@location(0) vec4f {
let xy=vec2i(p.xy);let s=textureLoad(scene,xy,0);
let bgxy=vec2i(p.xy*vec2f(textureDimensions(background))/vec2f(textureDimensions(scene)));
let b=textureLoad(background,bgxy,0);
return vec4f(s.rgb+b.rgb*(1-s.a),1);}`;
export class GPUBackend {
  static async create(canvas,adapter,onLost){
    let backend;
    const device=await adapter.requestDevice();
    try {
      device.pushErrorScope('validation');
      const {instance}=await WebAssembly.instantiate(wasmBytes);
      backend=new GPUBackend(canvas,device,instance,onLost);
      const error=await device.popErrorScope();if(error)throw new Error(error.message);
      return backend;
    }catch(error){backend?.dispose();device.destroy();throw error;}
  }
  constructor(canvas,device,wasm,onLost){
    this.backgroundCanvas=canvas;this.device=device;this.wasm=wasm.exports;this.buffers=new Map();this.pipelines=new Map();this.disposed=false;
    this.canvas=document.createElement('canvas');this.canvas.className='gpu-scene';this.canvas.setAttribute('aria-hidden','true');canvas.after(this.canvas);
    this.context=this.canvas.getContext('webgpu');if(!this.context){this.canvas.remove();throw new Error('WebGPU context unavailable');}
    this.format=navigator.gpu.getPreferredCanvasFormat();this.context.configure({device,format:this.format,alphaMode:'opaque'});
    const module=device.createShaderModule({code:shader});
    const composite=device.createShaderModule({code:compositeShader});
    this.composite=device.createRenderPipeline({layout:'auto',vertex:{module:composite,entryPoint:'vs'},fragment:{module:composite,entryPoint:'fs',targets:[{format:this.format}]}});
    for(const topology of ['triangle-list','line-list','point-list'])for(const additive of [false,true])for(const depth of [false,true]){
      this.pipelines.set(`${topology}:${additive}:${depth}`,device.createRenderPipeline({layout:'auto',
        vertex:{module,entryPoint:'vs',buffers:[{arrayStride:28,attributes:[{shaderLocation:0,offset:0,format:'float32x4'},{shaderLocation:1,offset:16,format:'float32x3'}]}]},
        fragment:{module,entryPoint:'fs',targets:[{format:'rgba8unorm',...(additive?{blend:{color:{srcFactor:'one',dstFactor:'one'},alpha:{srcFactor:'zero',dstFactor:'one'}}}:{})}]},
        primitive:{topology},depthStencil:{format:'depth24plus',depthWriteEnabled:depth,depthCompare:'less-equal'}}));
    }
    device.lost.then(()=>{if(!this.disposed)onLost();});device.addEventListener('uncapturederror',()=>{if(!this.disposed)onLost();});
  }
  begin(w,h,vp){
    if(this.canvas.width!==w||this.canvas.height!==h||!this.depth||this.backgroundTexture.width!==this.backgroundCanvas.width||this.backgroundTexture.height!==this.backgroundCanvas.height){
      this.canvas.width=w;this.canvas.height=h;
      this.depth?.destroy();this.sceneTexture?.destroy();this.backgroundTexture?.destroy();
      this.depth=this.device.createTexture({size:[w,h],format:'depth24plus',usage:GPUTextureUsage.RENDER_ATTACHMENT});
      this.sceneTexture=this.device.createTexture({size:[w,h],format:'rgba8unorm',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});
      this.backgroundTexture=this.device.createTexture({size:[this.backgroundCanvas.width,this.backgroundCanvas.height],format:'rgba8unorm',usage:GPUTextureUsage.COPY_DST|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.RENDER_ATTACHMENT});
      this.compositeGroup=this.device.createBindGroup({layout:this.composite.getBindGroupLayout(0),entries:[{binding:0,resource:this.sceneTexture.createView()},{binding:1,resource:this.backgroundTexture.createView()}]});
    }
    new Float32Array(this.wasm.memory.buffer,0,16).set(vp);
    this.encoder=this.device.createCommandEncoder();this.target=this.sceneTexture.createView();this.startPass('clear');
  }
  startPass(loadOp){this.pass=this.encoder.beginRenderPass({colorAttachments:[{view:this.target,clearValue:[0,0,0,0],loadOp,storeOp:'store'}],depthStencilAttachment:{view:this.depth.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'}});}
  clearDepth(){this.pass.end();this.startPass('load');}
  draw(mesh,additive,depth,fog){
    const count=mesh.data.length/6;if(!count)return;
    const src=64,dst=4*1024*1024;
    if(src+mesh.data.byteLength>dst||dst+count*28>this.wasm.memory.buffer.byteLength)throw new Error('Scene stream exceeds bounded WASM memory');
    new Float32Array(this.wasm.memory.buffer,src,mesh.data.length).set(mesh.data);this.wasm.project(src,dst,0,count);
    const data=new Float32Array(this.wasm.memory.buffer,dst,count*7);
    for(let i=0;i<data.length;i+=7){const k=Math.exp(-Math.max(0,data[i+3])*fog);data[i+4]*=k;data[i+5]*=k;data[i+6]*=k;}
    let buffer=this.buffers.get(mesh);if(!buffer||buffer.size<data.byteLength){buffer?.destroy();buffer=this.device.createBuffer({size:Math.max(28,data.byteLength),usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});this.buffers.set(mesh,buffer);}
    this.device.queue.writeBuffer(buffer,0,data);this.pass.setPipeline(this.pipelines.get(`${mesh.mode==='lines'?'line-list':mesh.mode==='points'?'point-list':'triangle-list'}:${additive}:${depth}`));this.pass.setVertexBuffer(0,buffer);this.pass.draw(count);
  }
  release(mesh){this.buffers.get(mesh)?.destroy();this.buffers.delete(mesh);}
  end(){
    this.pass.end();
    // The CPU finishes the sky/planets after begin(). Composite them explicitly:
    // additive RGB preserves scene coverage, so a black glow rim cannot hide them.
    this.device.queue.copyExternalImageToTexture({source:this.backgroundCanvas},{texture:this.backgroundTexture},[this.backgroundCanvas.width,this.backgroundCanvas.height]);
    const pass=this.encoder.beginRenderPass({colorAttachments:[{view:this.context.getCurrentTexture().createView(),loadOp:'clear',clearValue:[0,0,0,1],storeOp:'store'}]});
    pass.setPipeline(this.composite);pass.setBindGroup(0,this.compositeGroup);pass.draw(3);pass.end();
    this.device.queue.submit([this.encoder.finish()]);
  }
  dispose(){this.disposed=true;for(const b of this.buffers.values())b.destroy();this.depth?.destroy();this.sceneTexture?.destroy();this.backgroundTexture?.destroy();this.context?.unconfigure();this.canvas.remove();this.device.destroy();}
}
