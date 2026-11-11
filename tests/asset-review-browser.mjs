// SPDX-License-Identifier: Apache-2.0
// Fixed scene comparison; timings include scene submission, not GPU completion.
import {chromium} from 'playwright';
import {writeFile,mkdir} from 'node:fs/promises';
import {createStaticServer} from '../scripts/serve.mjs';
import {root} from '../scripts/site.mjs';
const server=createStaticServer(root);await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({args:['--disable-gpu']});const report=[];
await mkdir('evidence/overhaul',{recursive:true});
try{for(const [folder,handle] of [['IRONWAKE','__ironwake'],['VAGRANT_STARS','__vagrant']]){
 const page=await browser.newPage({viewport:{width:1280,height:800}});page.on('pageerror',e=>{throw e;});
 await page.goto(`http://127.0.0.1:${server.address().port}/${folder}/`);await page.click('#btn-new');await page.click('[data-act="launch"]');await page.waitForTimeout(500);await page.keyboard.press('Escape');
 for(const subject of ['ship','station','planet']){
  const stats=await page.evaluate(async({handle,subject})=>{
   const g=globalThis[handle],world=g.world,scene=g.scene,iron=handle==='__ironwake';
   const {lookQuat}=await import('/VAGRANT_STARS/js/sim/world.js');
   const model=subject==='ship'?world.playerShip:subject==='station'?(iron?world.sector.stations[0]:world.sector.pois.find(p=>p.type==='base')):(iron?(await import('/IRONWAKE/js/sim/data.js')).SECTOR.planets[0]:world.system.planets[0]);
   const target=model.pos??model.body.position,r=model.radius??300;
   const pos=target.map((v,i)=>v+[r*2.2,r*1.2,r*2.2][i]);const d=target.map((v,i)=>v-pos[i]),length=Math.hypot(...d),cam={pos,q:lookQuat(d.map(v=>v/length))};
   const poses=new Map(world.ships.map(s=>[s.id,{pos:s.body.position,q:s.body.orientation}]));
   const draw=scene._reviewDraw??scene.draw.bind(scene);scene._reviewDraw=draw;
   scene.draw=()=>draw(world,cam,poses,0,0);document.querySelectorAll('.overlay,#hud,#pad-status').forEach(e=>e.style.visibility='hidden');
   const trials=[];
   for(let trial=0;trial<6;trial++){
    const row={};for(const detail of trial%2?[true,false]:[false,true]){
     scene.detail=detail;for(let i=0;i<4;i++)scene.draw();const start=performance.now();for(let i=0;i<24;i++)scene.draw();row[detail?'detailedMs':'baseMeshMs']=(performance.now()-start)/24;
    }trials.push(row);
   }
   scene.detail=true;scene.draw();return {triangles:(scene.far.n+scene.near.n)/18,trials};
  },{handle,subject});
  await page.screenshot({path:`evidence/overhaul/${folder}-${subject}-detail.png`});report.push({folder,subject,...stats});
 }
 await page.close();
}await writeFile('evidence/overhaul/asset-comparison.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));}finally{await browser.close();await new Promise(r=>server.close(r));}
