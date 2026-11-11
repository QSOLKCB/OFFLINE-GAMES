// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {projectVertex,clipNear,detectGPU} from '../shared/presentation.js';
import {detailedModel} from '../shared/surface-detail.js';
import {capitalModel,stationModel} from '../IRONWAKE/js/sim/models.js';
import {newPlayer,sanitizeSave,sellGood} from '../IRONWAKE/js/sim/player.js';
import {campaignJob,newCampaign,CHAPTERS} from '../IRONWAKE/js/sim/campaign.js';
import {acceptJob,completeMission,abandonMission,failMission,missionOnDock} from '../IRONWAKE/js/sim/missions.js';

test('WASM projection agrees with JS for bounded streams, including behind-camera coordinates',async()=>{
 const {instance:{exports:e}}=await WebAssembly.instantiate(await readFile(new URL('../shared/wasm/project.wasm',import.meta.url)));
 const m=new Float32Array([1.1,.2,0,.1,0,2,.3,.1,.4,0,3,-1,3,4,5,1]);new Float32Array(e.memory.buffer,0,16).set(m);
 const data=new Float32Array(6000);for(let i=0;i<data.length;i++)data[i]=Math.sin(i*13)*31;new Float32Array(e.memory.buffer,64,data.length).set(data);
 e.project(64,65536,0,1000);const out=new Float32Array(e.memory.buffer,65536,7000);
 for(let i=0;i<1000;i++){const ref=projectVertex(m,...data.subarray(i*6,i*6+3));for(let j=0;j<4;j++)assert.ok(Math.abs(ref[j]-out[i*7+j])<.00003);for(let j=0;j<3;j++)assert.equal(out[i*7+4+j],data[i*6+3+j]);}
});
test('near plane clipping retains crossing triangles and rejects hidden geometry',()=>{
 assert.equal(clipNear([[0,0,0,-1],[1,0,0,-2],[0,1,0,-3]]).length,0);
 const clipped=clipNear([[0,0,0,-1],[1,0,0,2],[0,1,0,2]]);assert.equal(clipped.length,4);assert.ok(clipped.every(p=>p[3]>=.1-1e-12));
});
test('GPU detection requires an adapter, rejects fallback adapters and handles failures',async()=>{
 assert.equal(await detectGPU({}),null);assert.equal(await detectGPU({gpu:{requestAdapter:async()=>null}}),null);
 assert.equal(await detectGPU({gpu:{requestAdapter:async()=>{throw Error('denied');}}}),null);
 assert.equal(await detectGPU({gpu:{requestAdapter:async()=>({info:{isFallbackAdapter:true}})}}),null);
 const a={info:{isFallbackAdapter:false}};assert.equal(await detectGPU({gpu:{requestAdapter:async()=>a}}),a);
});
test('surface detail is bounded, reused, and leaves collision geometry and hardpoints unchanged',()=>{
 for(const [m,station] of [[capitalModel('cutter',3,2,[.4,.5,.6]),false],[stationModel('citadel',[.4,.5,.6]),true]]){
 const original=m.tris.slice(),d=detailedModel(m,station);assert.strictEqual(d,detailedModel(m,station));assert.deepEqual(m.tris,original);assert.equal(d.radius,m.radius);assert.equal(d.engines,m.engines);assert.ok(d.count>m.count);assert.ok(d.count<=m.count+(station?161:96));assert.ok(d.tris.every(Number.isFinite));}
});
test('original saves retain vanilla state; story saves reject invalid progress',()=>{
 const p=newPlayer();assert.equal(sanitizeSave(p).campaign,undefined);p.campaign=newCampaign();assert.ok(sanitizeSave(p));
 for(const chapter of [-1,1.5,999]){p.campaign.chapter=chapter;assert.equal(sanitizeSave(p),null);}
});
test('campaign uses native mission lifecycle, retries without advancing and pays once',()=>{
 const p=newPlayer();p.campaign=newCampaign();p.campaign.tradeUnits=8;p.stats.mined=3;
 for(let i=0;i<CHAPTERS.length;i++){
 const ch=CHAPTERS[i],job=campaignJob(p,ch.station,10);assert.ok(job);assert.equal(job.locked,null);assert.equal(campaignJob(p,'invalid',10),null);
 if(i===0){acceptJob(p,job);abandonMission(p);assert.equal(p.campaign.chapter,0);acceptJob(p,job);failMission(p,'retry');assert.equal(p.campaign.chapter,0);}
 assert.ok(acceptJob(p,job).ok);const before=p.credits;
 if(job.kind==='delivery'){assert.equal(missionOnDock(p,'invalid'),null);assert.ok(missionOnDock(p,job.dest));}else assert.ok(completeMission(p));
 assert.equal(p.credits,before+job.reward);assert.equal(p.campaign.chapter,i+1);assert.equal(completeMission(p),null);assert.ok(sanitizeSave(p));
 }
 assert.equal(campaignJob(p,'anchorage',10),null);assert.equal(p.wanted,0);
});
test('trade and mining gates are real progression gates, independent of rank',()=>{
 const p=newPlayer();p.campaign=newCampaign();p.campaign.chapter=2;
 assert.match(campaignJob(p,'coldharbor',10).locked,/Sell/);p.campaign.tradeUnits=8;assert.match(campaignJob(p,'coldharbor',10).locked,/Crack/);p.stats.mined=3;assert.equal(campaignJob(p,'coldharbor',10).locked,null);
});

test('story battles spawn native squadrons and finish through world events',async()=>{
 const {World}=await import('../IRONWAKE/js/sim/world.js');
 for(const chapter of [1,3,4,6,7]){
  const p=newPlayer(71);p.campaign=newCampaign();p.campaign.chapter=chapter;
  const job=campaignJob(p,CHAPTERS[chapter].station,10);acceptJob(p,job);
  const w=new World(p);w.launch();w.playerShip.body.position=[job.pos[0]-2500,0,job.pos[1]];
  for(let i=0;i<12;i++)w.step(1/60,{});
  const squad=w.ships.filter(s=>s.tag===job.id);assert.ok(squad.length>0);
  if(job.kind==='defend')assert.ok(w.ships.some(s=>s.alive&&s.tag===job.id+':ward'));
  for(const s of squad)w.damage(s,1e7,0,0,w.playerShip);
  for(let i=0;i<12;i++)w.step(1/60,{});
  assert.equal(p.campaign.chapter,chapter+1);assert.ok(w.events.some(e=>e.type==='missionDone'));assert.equal(p.wanted,0);
 }
});
