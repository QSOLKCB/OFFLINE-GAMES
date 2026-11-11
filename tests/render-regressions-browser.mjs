// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createStaticServer} from '../scripts/serve.mjs';
import {root} from '../scripts/site.mjs';
const server=createStaticServer(root);await new Promise(r=>server.listen(0,'127.0.0.1',r));
const hardware=process.env.TEST_HARDWARE_GPU==='1';
const browser=await chromium.launch({headless:!hardware,args:hardware?['--enable-unsafe-webgpu','--ignore-gpu-blocklist']:['--disable-gpu']});
const base=`http://127.0.0.1:${server.address().port}`;
async function installReadback(page){
  await page.addInitScript(()=>{
    window.captureGPU=async(backend,draw)=>{
      const device=backend.device,w=backend.canvas.width,h=backend.canvas.height;
      const pitch=Math.ceil(w*4/256)*256;
      backend.context.configure({device,format:backend.format,alphaMode:'opaque',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
      const buffer=device.createBuffer({size:pitch*h,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
      const submit=device.queue.submit.bind(device.queue);let submissions=0;
      device.queue.submit=commands=>{
        submissions++;const copy=device.createCommandEncoder();
        copy.copyTextureToBuffer({texture:backend.context.getCurrentTexture()},{buffer,bytesPerRow:pitch},[w,h]);
        submit([...commands,copy.finish()]);
      };
      try{
        draw();if(submissions!==1)throw Error(`Expected one GPU submission, got ${submissions}`);
      }finally{device.queue.submit=submit;}
      await buffer.mapAsync(GPUMapMode.READ);
      const raw=new Uint8Array(buffer.getMappedRange()),pixels=new Uint8Array(w*h*4),bgra=backend.format.startsWith('bgra');
      for(let y=0;y<h;y++)for(let x=0;x<w;x++){
        const src=y*pitch+x*4,dst=(y*w+x)*4;
        pixels[dst]=raw[src+(bgra?2:0)];pixels[dst+1]=raw[src+1];pixels[dst+2]=raw[src+(bgra?0:2)];pixels[dst+3]=raw[src+3];
      }
      buffer.unmap();buffer.destroy();return {pixels,submissions};
    };
  });
}
try {
  const probe=await browser.newPage();await installReadback(probe);await probe.goto(`${base}/IRONWAKE/`);
  const planets=await probe.evaluate(async()=>{
    const {Environment}=await import('/shared/presentation.js');
    const {perspective}=await import('/VAGRANT_STARS/vendor/vanillajs/modules/math/index.js');
    const canvas=document.createElement('canvas');canvas.width=320;canvas.height=200;
    const ctx=canvas.getContext('2d'),env=new Environment({canvas,ctx});
    const samples=[];
    for(const z of [1.05,1,.99,.9,.2,0,-.2]){
      // Constant distance of 1.3 radii, including the review's grazing fixture.
      ctx.clearRect(0,0,320,200);const x=Math.sqrt(1.3**2-z*z);
      env.drawPlanets(perspective(Math.PI/2.6,1.6),[{pos:[x,0,-z],radius:1,palette:'gas'}],{pos:[0,0,0],q:[0,0,0,1]});
      const a=ctx.getImageData(0,0,320,200).data;let covered=0;for(let i=3;i<a.length;i+=4)if(a[i])covered++;
      samples.push({z,covered,center:a[(100*320+160)*4+3]});
    }
    return samples;
  });
  assert.ok(planets.find(p=>p.z===.9).center>0,'nearby visible surface covers the centre');
  assert.ok(planets.filter(p=>p.z>=.2).every(p=>p.covered>0),'surface stays visible across the old cutoff');
  assert.ok(Math.abs(planets[1].covered-planets[2].covered)<1000,'no discontinuity at forward depth = radius');
  console.log('nearby planet pixels:',planets);
  if(!hardware){
    await probe.close();
    for(const [folder,handle] of [['IRONWAKE','__ironwake'],['VAGRANT_STARS','__vagrant']]){
      const page=await browser.newPage();await page.goto(`${base}/${folder}/`);await page.waitForFunction(h=>globalThis[h]?.scene.vp,handle);
      const frame=await page.evaluate(h=>new Promise(resolve=>{
        const scene=globalThis[h].scene,renderer=scene.renderer,original=scene.draw.bind(scene),counts={begin:0,draw:0,end:0};
        renderer.gpu={begin(){counts.begin++;},draw(){counts.draw++;},end(){counts.end++;},clearDepth(){}};
        scene.draw=(...args)=>{original(...args);scene.draw=original;renderer.gpu=null;resolve(counts);};
      }),handle);
      assert.equal(frame.begin,1);assert.equal(frame.end,1);assert.ok(frame.draw>0);await page.close();
    }
    const menu=await browser.newPage();await menu.goto(base);
    const activations=await menu.evaluate(async()=>{
      document.body.innerHTML='<section id="menu"><div class="menu-card"></div></section>';
      let requests=0,devices=0;
      Object.defineProperty(navigator,'gpu',{value:{async requestAdapter(){requests++;let used=false;return {async requestDevice(){if(used)throw Error('consumed adapter');used=true;devices++;}};}}});
      const renderer={backend:'cpu',async enableGPU(adapter){await adapter.requestDevice();this.backend='webgpu+wasm';this.onBackend();},useCPU(){this.backend='cpu';this.onBackend();}};
      const {mountGraphics}=await import('/shared/presentation.js');mountGraphics(renderer);
      await new Promise(resolve=>setTimeout(resolve,0));
      for(let i=0;i<3;i++){await document.querySelector('[data-gpu]').onclick();if(renderer.backend!=='webgpu+wasm')throw Error('activation failed');document.querySelector('[data-cpu]').click();}
      return {requests,devices};
    });
    assert.deepEqual(activations,{requests:4,devices:3});await menu.close();
    console.log('CPU planet, frame finalization and fresh-adapter regressions PASS');
  }else{
  // GPU pixels are read back on a real adapter, not inferred from backend flags.
  const compositing=await probe.evaluate(async hardware=>{
    const adapter=await navigator.gpu?.requestAdapter();if(!adapter)return null;
    if(hardware&&adapter.info.isFallbackAdapter)throw Error('Hardware test got fallback GPU');
    const {GPUBackend}=await import('/shared/webgpu.js');
    const canvas=document.createElement('canvas');canvas.width=canvas.height=64;document.body.append(canvas);
    const ctx=canvas.getContext('2d');ctx.fillStyle='rgb(40,64,80)';ctx.fillRect(0,0,64,64);
    const backend=await GPUBackend.create(canvas,adapter,()=>{}),errors=[];backend.device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
    const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
    const quad=(rgb,xmax=1)=>({mode:'triangles',data:new Float32Array([[-1,-1],[xmax,-1],[xmax,1],[-1,-1],[xmax,1],[-1,1]].flatMap(([x,y])=>[x,y,0,...rgb]))});
    const samples=[];
    for(const glow of [[0,0,0],[.1,.2,.3]]){
      backend.canvas.width=backend.canvas.height=64;
      const {pixels}=await captureGPU(backend,()=>{
        backend.begin(64,64,identity);backend.draw(quad([.2,.2,.2],0),false,true,0);backend.draw(quad(glow),true,false,0);backend.end();
      });
      const pixel=x=>Array.from(pixels.slice((32*64+x)*4,(32*64+x)*4+4));
      samples.push({left:pixel(16),right:pixel(48)});
    }
    canvas.width=canvas.height=32;ctx.fillStyle='rgb(40,64,80)';ctx.fillRect(0,0,32,32);
    const resized=await captureGPU(backend,()=>{backend.begin(64,64,identity);backend.draw(quad([0,0,0]),true,false,0);backend.end();});
    samples.push({resized:Array.from(resized.pixels.slice((32*64+32)*4,(32*64+32)*4+4))});
    backend.dispose();canvas.remove();return {samples,errors};
  },hardware);
  assert.ok(compositing,'a WebGPU adapter is required for pixel regressions');assert.deepEqual(compositing.errors,[]);
  const close=(got,want)=>got.forEach((v,i)=>assert.ok(Math.abs(v-want[i])<=2,`${got} differs from ${want}`));
  close(compositing.samples[0].right,[40,64,80,255]);close(compositing.samples[0].left,[51,51,51,255]);
  close(compositing.samples[1].right,[66,115,157,255]);close(compositing.samples[1].left,[77,102,128,255]);
  close(compositing.samples[2].resized,[40,64,80,255]);
  console.log('GPU compositing pixels:',compositing.samples);await probe.close();
  for(const [folder,handle] of [['IRONWAKE','__ironwake'],['VAGRANT_STARS','__vagrant']]){
    const page=await browser.newPage({viewport:{width:960,height:600}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await installReadback(page);
    // Model the specified single-use adapter lifecycle even on permissive drivers.
    await page.addInitScript(()=>{
      const request=navigator.gpu.requestAdapter.bind(navigator.gpu);window.adapterRequests=0;
      navigator.gpu.requestAdapter=async(...args)=>{window.adapterRequests++;const a=await request(...args);if(!a)return a;
        const device=a.requestDevice.bind(a);let used=false;
        a.requestDevice=async(...args)=>{if(used)throw Error('Adapter reused');used=true;return device(...args);};return a;};
    });
    await page.goto(`${base}/${folder}/`);await page.waitForFunction(h=>globalThis[h]?.scene.vp,handle);
    if(!hardware){
      // Exercise real game draw loops with a software GPU without bypassing the
      // production UI's hardware gate. The low-level backend is injectable here.
      await page.evaluate(async h=>{await globalThis[h].scene.renderer.enableGPU(await navigator.gpu.requestAdapter());},handle);
    }else{await page.locator('[data-gpu]').click();await page.waitForFunction(h=>globalThis[h].scene.renderer.backend==='webgpu+wasm',handle);}
    await page.waitForFunction(h=>globalThis[h].scene.renderer.gpu?.depth,handle);
    const pixels=await page.evaluate(async h=>{
      const scene=globalThis[h].scene,renderer=scene.renderer,gpu=renderer.gpu,original=scene.draw.bind(scene);
      return await new Promise((resolve,reject)=>{scene.draw=(...args)=>{
        scene.draw=original;
        captureGPU(gpu,()=>original(...args)).then(({pixels:a,submissions})=>{
          const bg=document.createElement('canvas');bg.width=gpu.canvas.width;bg.height=gpu.canvas.height;const bc=bg.getContext('2d');bc.drawImage(renderer.canvas,0,0,bg.width,bg.height);
          const b=bc.getImageData(0,0,bg.width,bg.height).data;let opaque=0,geometry=0;
          for(let i=0;i<a.length;i+=4){if(a[i+3]===255)opaque++;if(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])>40)geometry++;}
          resolve({submissions,opaque,geometry,total:a.length/4});
        },reject);
      };});
    },handle);
    assert.equal(pixels.submissions,1,`${folder} submits the rendered frame`);assert.equal(pixels.opaque,pixels.total);assert.ok(pixels.geometry>100,`${folder} contains rendered geometry`);
    if(hardware){
      for(let i=0;i<2;i++){await page.locator('[data-cpu]').click();await page.locator('[data-gpu]').click();await page.waitForFunction(h=>globalThis[h].scene.renderer.backend==='webgpu+wasm',handle);}
      await page.evaluate(h=>globalThis[h].scene.renderer.gpu.device.destroy(),handle);await page.waitForFunction(h=>globalThis[h].scene.renderer.backend==='cpu',handle);
      await page.locator('[data-gpu]').click();await page.waitForFunction(h=>globalThis[h].scene.renderer.backend==='webgpu+wasm',handle);
      assert.ok(await page.evaluate(()=>adapterRequests)>=5);
      // Initialization fails after consuming a device; retry must still work.
      await page.locator('[data-cpu]').click();await page.evaluate(()=>{const original=WebAssembly.instantiate;WebAssembly.instantiate=(...args)=>{WebAssembly.instantiate=original;return Promise.reject(Error('test initialization failure'));};});
      await page.locator('[data-gpu]').click();await page.waitForFunction(()=>document.querySelector('[data-status]').textContent.includes('unavailable'));
      await page.locator('[data-gpu]').click();await page.waitForFunction(h=>globalThis[h].scene.renderer.backend==='webgpu+wasm',handle);
    }
    assert.deepEqual(errors,[]);console.log(folder,pixels,'activation/recovery PASS');await page.close();
  }
  }
}finally{await browser.close();await new Promise(r=>server.close(r));}
