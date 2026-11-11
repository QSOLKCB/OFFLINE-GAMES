// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {createStaticServer} from '../scripts/serve.mjs';
import {root} from '../scripts/site.mjs';
const server=createStaticServer(root);await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const hardware=process.env.TEST_HARDWARE_GPU==='1';
const browser=await chromium.launch({headless:!hardware,args:hardware?['--enable-unsafe-webgpu','--ignore-gpu-blocklist']:['--disable-gpu']});
const report={browser:browser.version(),hardwareRequested:hardware,games:[]};
await mkdir('evidence/overhaul',{recursive:true});
try{
for(const [folder,handle] of [['IRONWAKE','__ironwake'],['VAGRANT_STARS','__vagrant']]){
 const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.stack);});
 if(!hardware)await page.addInitScript(()=>{Object.defineProperty(navigator,'gpu',{value:undefined});const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){if(type!=='2d')throw new Error('GPU context requested on CPU path');return original.call(this,type,...args);};});
 await page.goto(`${base}/${folder}/`);await page.waitForFunction(h=>globalThis[h]?.scene.vp,handle);
 await page.screenshot({path:`evidence/overhaul/${folder}-title.png`});
 assert.equal(await page.evaluate(h=>globalThis[h].scene.renderer.backend,handle),'cpu');
 let gpu=null;
 if(hardware){gpu=await page.evaluate(async()=>{const a=await navigator.gpu?.requestAdapter();return a?{vendor:a.info?.vendor,architecture:a.info?.architecture,device:a.info?.device,description:a.info?.description,fallback:a.info?.isFallbackAdapter}:null;});
   if(gpu&&!gpu.fallback){await page.locator('[data-gpu]').click();await page.waitForFunction(h=>globalThis[h].scene.renderer.backend==='webgpu+wasm',handle);}}
 await page.click('#btn-new');await page.waitForSelector('[data-act="launch"]');
 await page.screenshot({path:`evidence/overhaul/${folder}-station.png`});
 await page.click('[data-act="launch"]');await page.waitForFunction(h=>globalThis[h].mode==='flight',handle);
 await page.waitForTimeout(750);await page.screenshot({path:`evidence/overhaul/${folder}-flight${hardware?'-gpu':''}.png`});
 const perf=await page.evaluate(async h=>{const g=globalThis[h],draw=g.scene.draw.bind(g.scene),times=[];g.scene.draw=(...args)=>{const t=performance.now();draw(...args);times.push(performance.now()-t);};for(let i=0;i<120;i++)await new Promise(requestAnimationFrame);g.scene.draw=draw;times.sort((a,b)=>a-b);return {backend:g.scene.renderer.backend,medianDrawMs:times[Math.floor(times.length*.5)],p95DrawMs:times[Math.floor(times.length*.95)],triangles:(g.scene.far.n+g.scene.near.n)/18};},handle);
 if(hardware&&gpu&&!gpu.fallback){await page.evaluate(h=>globalThis[h].scene.renderer.gpu.device.destroy(),handle);await page.waitForFunction(h=>globalThis[h].scene.renderer.backend==='cpu',handle);assert.equal(await page.evaluate(h=>globalThis[h].mode,handle),'flight');}
 assert.deepEqual(errors,[]);report.games.push({folder,gpu,...perf});await page.close();
}
const page=await browser.newPage();await page.goto(`${base}/IRONWAKE/?campaign=1`);await page.click('#btn-new');await page.waitForSelector('[data-act="launch"]');
assert.equal(await page.evaluate(()=>__ironwake.player.campaign.chapter),0);
await page.click('[data-tab="contracts"]');await page.locator('[data-job="campaign-0"]').click();
assert.equal(await page.evaluate(()=>__ironwake.player.mission.campaignChapter),0);
await page.evaluate(async()=>{await navigator.serviceWorker.register('../sw.js');await navigator.serviceWorker.ready;});
await page.waitForFunction(()=>navigator.serviceWorker.controller);await page.context().setOffline(true);
await page.reload();await page.click('#btn-continue');await page.waitForSelector('[data-act="launch"]');assert.equal(await page.evaluate(()=>__ironwake.player.mission.campaignChapter),0);
await page.context().setOffline(false);await page.goto(`${base}/IRONWAKE/?campaign=1`);await page.click('#btn-mods');await page.locator('[data-profile="vanilla/campaign"]').click();await page.waitForURL(url=>!url.searchParams.has('campaign'));assert.equal(await page.locator('#btn-continue').isVisible(),false);await page.close();
console.log(JSON.stringify(report,null,2));await writeFile(`evidence/overhaul/${hardware?'hardware':'cpu'}-report.json`,JSON.stringify(report,null,2)+'\n');
}finally{await browser.close();await new Promise(r=>server.close(r));}
