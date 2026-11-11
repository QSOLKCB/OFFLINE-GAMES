// SPDX-License-Identifier: Apache-2.0
import {mods} from '../mod-api.js';
// Job boards and the "Quiet Signal" storyline. Pure and deterministic for a given captain state.
import {seededRandom} from '../../vendor/vanillajs/modules/math/index.js';
import {FACTIONS, SYSTEMS, BASES, HULLS, enemiesOf, routeBetween, REFUSE_REP} from './data.js';
import {levelOf, cargoFree, adjustRep} from './player.js';

export const STORY = [
  {at: 'tollard', minLevel: 1, kind: 'bounty', title: 'A Quiet Signal I: Jackals at the Door', giver: 'wardens',
    text: 'Lieutenant Oda Rook slides a slate across the desk. "Reaver scouts are loitering in the Shepherd Rocks, counting our convoys. Burn them out, Captain, and we will talk about something stranger."',
    done: 'Rook nods at the gun-camera footage. "Clean work. One of those scouts was carrying a recorder full of noise. Come and see me."',
    system: 'meridian', waypoint: [-3400, 150, -2600], foe: 'reavers', count: 2, tier: 1, reward: 2200},
  {at: 'tollard', minLevel: 1, kind: 'courier', title: 'A Quiet Signal II: Sealed Drives', giver: 'wardens',
    text: '"The noise is a signal. Somebody is broadcasting from past the charts, and the Reavers are listening." Rook hands you a sealed case. "The Syndic assayers at Cinder Rock own the only decoder I trust. Take the Kessa gate."',
    done: 'The assayer cracks the case seals. "Layered carrier, very old cipher. Give me an hour and a favour."',
    base: 'cinder', cargo: 6, reward: 3800},
  {at: 'cinder', minLevel: 2, kind: 'bounty', title: 'A Quiet Signal III: Marrow', giver: 'ember',
    text: '"The favour. A Reaver captain called Marrow has been stripping our ore barges in Slagfall, and he flies with a relay pod bolted to his hull. Kill him, bring me the pod logs, and I will finish your decode."',
    done: '"Marrow was relaying the signal inward, hop by hop." The assayer goes pale. "It is not Reaver code at all. It is a hymn."',
    system: 'kessa', waypoint: [-11400, 120, -3600], foe: 'reavers', count: 3, tier: 2, reward: 9000,
    boss: {name: 'Marrow', hull: 'bastion', gun: 'plasma2', shield: 's3'}},
  {at: 'cinder', minLevel: 3, kind: 'courier', title: 'A Quiet Signal IV: The Listener', giver: 'ember',
    text: '"Lantern Deep in the Hollow has spent ten years listening to the dark. Take them the decode. Go through Ostrava, and go armed: the Hollow gate is not friendly."',
    done: 'Dr. Ilse Vane reads the decode twice. "The Null Choir is calling something home. The source is a relay in the Psalm Stones. Somebody has to silence it."',
    base: 'lantern', cargo: 8, reward: 12000},
  {at: 'lantern', minLevel: 5, kind: 'bounty', title: 'A Quiet Signal V: The Cantor', giver: 'halcyon',
    text: '"The relay is guarded by the Choir\'s own Cantor, in the Psalm Stones of the Veil. Nothing we own can reach it. You can. End the song, Captain."',
    done: 'The carrier wave dies mid-note. Across the Reach, six stars\' worth of listeners hear only static. The Wardens call it a victory. Dr. Vane calls it a pause.',
    system: 'veil', waypoint: [-6800, 220, 4400], foe: 'choir', count: 4, tier: 4, reward: 60000,
    boss: {name: 'The Cantor', hull: 'wraith', gun: 'lance', shield: 's5'}},
];

const hash = text => { let h = 2166136261; for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619); return h >>> 0; };
const round50 = v => Math.round(v / 50) * 50;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function bounty(p, base, rng, n) {
  const level = levelOf(p), here = SYSTEMS[base.system];
  const system = rng() < 0.7 ? here : SYSTEMS[here.gates[Math.floor(rng() * here.gates.length)].to];
  const present = Object.keys(system.traffic);
  let foes = enemiesOf(base.faction).filter(f => present.includes(f));
  if (!foes.length) foes = present.filter(f => FACTIONS[f].outlaw && f !== base.faction);
  if (!foes.length) return null;
  const foe = foes[Math.floor(rng() * foes.length)];
  const lairs = system.zones.filter(z => z.lair === foe), zone = lairs.length ? lairs[Math.floor(rng() * lairs.length)] : null;
  let waypoint, place;
  if (zone) {
    const a = rng() * Math.PI * 2, d = zone.radius * (0.25 + rng() * 0.4);
    waypoint = [zone.pos[0] + Math.cos(a) * d, zone.pos[1] + (rng() - 0.5) * 300, zone.pos[2] + Math.sin(a) * d]; place = zone.name;
  } else {
    const anchor = system.bases[Math.floor(rng() * system.bases.length)], a = rng() * Math.PI * 2, d = 4200 + rng() * 2800;
    waypoint = [anchor.pos[0] + Math.cos(a) * d, anchor.pos[1] + (rng() - 0.5) * 500, anchor.pos[2] + Math.sin(a) * d]; place = `off ${anchor.name}`;
  }
  const tier = clamp(Math.round(system.danger * 0.55 + level * 0.3 + rng() * 0.6), 1, 5);
  const count = clamp(2 + Math.floor(level / 3) + (rng() < 0.4 ? 1 : 0), 2, 5);
  const hops = routeBetween(base.system, system.id).length;
  return {id: `b${p.board}-${n}`, kind: 'bounty', giver: base.faction, system: system.id, waypoint: waypoint.map(Math.round), foe, count, tier,
    reward: round50((700 + 650 * tier ** 1.5) * count ** 0.85 * (1 + 0.3 * hops)),
    title: `Clear ${FACTIONS[foe].short} ships: ${place}, ${system.name}`,
    text: `${FACTIONS[base.faction].name} will pay for ${count} ${FACTIONS[foe].name} ships destroyed ${place} in ${system.name}. Threat class ${tier}. Payment is wired the moment the last one burns.`,
    done: `${FACTIONS[base.faction].short} confirm the kills. Payment wired.`};
}

function courier(p, base, rng, n) {
  const all = Object.values(BASES).filter(b => b.id !== base.id && (p.rep[b.faction] ?? 0) > REFUSE_REP);
  const near = all.filter(b => routeBetween(base.system, b.system).length <= 1), pool = rng() < 0.6 && near.length ? near : all;
  if (!pool.length) return null;
  const dest = pool[Math.floor(rng() * pool.length)], hops = routeBetween(base.system, dest.system).length;
  const cargo = Math.min(3 + Math.floor(rng() * 8), Math.max(2, Math.floor(HULLS[p.hull].cargo / 2)));
  return {id: `c${p.board}-${n}`, kind: 'courier', giver: base.faction, system: dest.system, base: dest.id, cargo,
    reward: round50(500 + 950 * hops + 60 * cargo + SYSTEMS[dest.system].danger * 320),
    title: `Courier: ${cargo} sealed crates to ${dest.name}, ${SYSTEMS[dest.system].name}`,
    text: `Carry ${cargo} sealed crates to ${dest.name} in the ${SYSTEMS[dest.system].name} system${hops ? ` (${hops} jump${hops > 1 ? 's' : ''})` : ''}. Payment on delivery. The crates occupy ${cargo} cargo units.`,
    done: `The dockmaster at ${dest.name} signs for the crates. Payment wired.`};
}

/** Jobs offered at a base right now. The list changes each time the captain docks. */
export function jobsAt(p, baseId) {
  if (mods.mode?.contracts === false) return [];
  const base = BASES[baseId], rng = seededRandom(hash(`${p.seed}:${p.board}:${baseId}`)), jobs = [];
  const step = STORY[p.story];
  if (step && step.at === baseId) {
    jobs.push({...structuredClone(step), id: `story${p.story}`, story: p.story, system: step.system ?? BASES[step.base].system,
      locked: levelOf(p) < step.minLevel ? `Requires rank ${step.minLevel}.` : null});
  }
  const count = 3 + (rng() < 0.5 ? 1 : 0);
  for (let n = 0; n < count; n++) {
    const job = (rng() < 0.55 ? bounty : courier)(p, base, rng, n) ?? courier(p, base, rng, n);
    if (job) jobs.push(job);
  }
  return [...jobs, ...mods.jobsAt(p, baseId, levelOf(p))];
}

export function acceptJob(p, job) {
  if (p.mission) return {ok: false, text: 'Finish or abandon your current contract first.'};
  if (job.locked) return {ok: false, text: job.locked};
  if (job.kind === 'courier' && job.cargo > cargoFree(p)) return {ok: false, text: `You need ${job.cargo} free cargo units.`};
  p.mission = {...structuredClone(job), state: 'active', loaded: job.kind === 'courier', spawned: false, kills: 0};
  return {ok: true, text: `Contract accepted: ${job.title}`};
}
export function abandonMission(p) {
  if (!p.mission) return {ok: false, text: 'No active contract.'};
  adjustRep(p, p.mission.giver, -0.03);
  p.mission = null;
  return {ok: true, text: 'Contract abandoned.'};
}
/** Pays out the active mission. Callers decide when its goal has been met. */
export function completeMission(p) {
  const m = p.mission;
  if (!m) return null;
  p.credits += m.reward; p.stats.earned += m.reward; p.stats.missions++;
  adjustRep(p, m.giver, 0.06);
  if (Number.isInteger(m.story)) p.story = m.story + 1;
  mods.completed(p, m); p.mission = null;
  return {title: m.title, text: m.done, reward: m.reward, story: Number.isInteger(m.story)};
}
/** Courier deliveries complete on docking at the destination. */
export function missionOnDock(p, baseId) {
  const m = p.mission;
  if (m && mods.custom(m.kind)?.onDock?.(p, m, baseId) === 'complete') return completeMission(p);
  return m && m.kind === 'courier' && m.base === baseId ? completeMission(p) : null;
}
export function missionObjective(p) {
  const m = p.mission;
  if (!m) return null;
  if (mods.custom(m.kind)) return mods.custom(m.kind).objective(p, m);
  if (m.kind === 'courier') return `Deliver ${m.cargo} crates to ${BASES[m.base].name}, ${SYSTEMS[m.system].name}`;
  const left = (m.total ?? m.count + (m.boss ? 1 : 0)) - m.kills;
  return `Destroy ${left} ${FACTIONS[m.foe].short} ship${left === 1 ? '' : 's'} at the marked position in ${SYSTEMS[m.system].name}`;
}
