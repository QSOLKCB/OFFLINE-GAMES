// SPDX-License-Identifier: Apache-2.0
// Original story built on the native freight, rescue and broadside contract loop.
export const CHAPTERS = [
 {title:'A debt in the dark',contact:'Mara Vale, your former quartermaster',station:'anchorage',kind:'delivery',dest:'tinder',cargo:4,reward:2200,
 text:'Your old captain disappeared with the relief fleet. Mara has found his sealed ledger in a pawnshop. Tinder Works can decrypt it, if you bring four crates of replacement power cells. Take ordinary contracts and trade whenever you need repair money.',done:'The ledger names a relief convoy that never reached Coldharbor. Someone sold its route to the Black Pennant.'},
 {title:'The missing convoy',contact:'Chief engineer Senn',station:'tinder',kind:'defend',pos:[-11000,-14000],threat:1,reward:4200,
 text:'Senn has picked up the convoy transponder. Reach the distress beacon, break the raiders and keep a hauler alive. Its surviving navigator may know where your captain went.',done:'Navigator Iona survives. She saw a Watch cipher aboard a pirate cutter. The betrayal reaches beyond the raiders.'},
 {title:'Honest work',contact:'Navigator Iona',station:'coldharbor',kind:'delivery',dest:'lantern',cargo:6,reward:6500,trade:8,mined:3,
 text:'Iona needs a legitimate manifest to slip the evidence past the patrols. Sell eight units of ordinary cargo and crack three rocks, then carry her survey equipment to Lantern Rock. Ore can be sold; contracts and fittings remain available between story jobs.',done:'The manifest clears. Lantern Rock identifies the cipher as belonging to the missing relief commander, Orin Voss.'},
 {title:'The broker’s price',contact:'Archivist Rook',station:'lantern',kind:'bounty',pos:[11000,18000],threat:2,boss:'The Ledger Broker',vessel:'cutter',reward:11000,
 text:'Rook traced the stolen relief supplies to a broker. Defeat his cutter and escorts. Fit shields and a battery at the dockyard before you sail if the last fight was close.',done:'The broker’s black box proves Voss sold the convoy to buy protection for his own station. Mara wants the evidence made public.'},
 {title:'No safe harbour',contact:'Mara Vale',station:'anchorage',kind:'defend',pos:[4500,-6000],threat:2,reward:16000,
 text:'Voss has sent ships to silence Iona. Her witnesses are aboard League haulers outside Anchorage. Protect at least one hauler and destroy the attackers.',done:'Iona broadcasts the ledger. Independent captains rally, but the Pennant is massing at the edge of the Long Dark.'},
 {title:'The long refit',contact:'Dockmaster Pell',station:'tinder',kind:'delivery',dest:'coldharbor',cargo:10,reward:24000,rank:3,
 text:'The relief fleet needs shield regulators. Build your trade and contract earnings to rank three, refit as you see fit, then carry ten bonded crates to Coldharbor. The fleet will wait; the frontier stays open.',done:'Coldharbor’s relief ships are ready. A captured signal reveals Voss’s flagship and the escort protecting it.'},
 {title:'A captain’s account',contact:'Navigator Iona',station:'coldharbor',kind:'bounty',pos:[-3000,26000],threat:3,boss:'Commander Orin Voss',vessel:'corvette',reward:38000,
 text:'Voss is waiting in the Long Dark. He offers silence and a cut of the stolen cargo. Your crew has chosen the relief fleet. Break his escort and bring his flagship down.',done:'Voss’s ship goes dark. His final transmission gives you the Pennant blockade codes. Your old captain used his last hours to keep the relief crews alive.'},
 {title:'A light on the Banks',contact:'Mara Vale',station:'lantern',kind:'defend',pos:[17000,19000],threat:4,reward:65000,
 text:'One last convoy must reach the outer settlements. Hold off the blockade squadron and keep a relief hauler alive. Trade, mine and upgrade first if you need a stronger ship; this is a fleet action.',done:'Relief ships reach the settlements. Lanterns return to the Banks. Mara takes the quartermaster’s chair again: “Where next, captain?” Free sailing, contracts and the Most Wanted hunt continue.'},
];
export const newCampaign=()=>({chapter:0,tradeUnits:0,minedAtStart:0});
export function validCampaign(c){return c===undefined||c===null||typeof c==='object'&&Number.isInteger(c.chapter)&&c.chapter>=0&&c.chapter<=CHAPTERS.length&&Number.isSafeInteger(c.tradeUnits)&&c.tradeUnits>=0&&Number.isSafeInteger(c.minedAtStart)&&c.minedAtStart>=0;}
export function campaignJob(p,station,rank){
 const c=p.campaign;if(!c)return null;const ch=CHAPTERS[c.chapter];if(!ch||station!==ch.station)return null;
 const locked=ch.rank&&rank<ch.rank?`Reach rank ${ch.rank} through trade, contracts and upgrades.`:ch.trade&&c.tradeUnits<ch.trade?`Sell ordinary cargo: ${c.tradeUnits}/${ch.trade} units.`:ch.mined&&p.stats.mined-c.minedAtStart<ch.mined?`Crack rocks: ${Math.max(0,p.stats.mined-c.minedAtStart)}/${ch.mined}.`:null;
 return {...ch,id:`campaign-${c.chapter}`,campaignChapter:c.chapter,giver:'league',title:`Story ${c.chapter+1}: ${ch.title}`,text:`${ch.contact}: ${ch.text}`,locked};
}
export function advanceCampaign(p,m){if(p.campaign&&m.campaignChapter===p.campaign.chapter&&m.id===`campaign-${p.campaign.chapter}`)p.campaign.chapter++;}
