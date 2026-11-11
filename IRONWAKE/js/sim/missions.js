// SPDX-License-Identifier: Apache-2.0
import {campaignJob, advanceCampaign} from './campaign.js';
import {mods} from '../mod-api.js';
// Contract boards and the Most Wanted list. Pure and deterministic for a given captain state.
import {seededRandom} from '../../vendor/vanillajs/modules/math/index.js';
import {FACTIONS, SECTOR, STATIONS, HULLS, REFUSE_REP, captainName} from './data.js';
import {levelOf, cargoFree, adjustRep} from './player.js';

/** The four Black Pennant captains whose defeat ends the corsair threat. */
export const WANTED = [
  {name: 'Captain Sorrel Vane', vessel: 'cutter', threat: 2, field: 'Drowned Fleet', reward: 9000, minLevel: 1,
    text: 'Vane works the Drowned Fleet with a fast cutter and a wing of skates, picking off ore barges bound for Tinder Works. The Watch wants the lane open.',
    done: 'Vane\'s cutter folds amidships. The ore barges sail tonight for the first time in a season.'},
  {name: '"Deacon" Hale Mott', vessel: 'corvette', threat: 3, field: 'Widow\'s Teeth', reward: 28000, minLevel: 3,
    text: 'Mott preaches to his crews before every raid, then burns the prize. His corvette lairs in the Widow\'s Teeth, south of Coldharbor.',
    done: 'The Deacon\'s last sermon is cut short by your broadside. Coldharbor rings its bells.'},
  {name: 'Commodore Ysolde Crane', vessel: 'frigate', threat: 4, field: 'The Long Dark', reward: 75000, minLevel: 5,
    text: 'Crane was Watch once, and fights like it: a frigate handled by the book, with a disciplined escort. She holds the near edge of the Long Dark.',
    done: 'Crane strikes her colours too late. The Pennant has lost the only captain who could have made it a navy.'},
  {name: 'The Tide-Admiral', vessel: 'dreadnought', threat: 5, field: 'The Long Dark', reward: 220000, minLevel: 7,
    text: 'Nobody living has seen the Tide-Admiral\'s face, only the dreadnought. Break it, and the Black Pennant breaks with it.',
    done: 'The dreadnought\'s back breaks in a line of fire a mile long. The Black Pennant is a rabble again, and the Sundered Banks are yours to sail.'},
];

const hash = text => { let h = 2166136261; for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619); return h >>> 0; };
const round50 = v => Math.round(v / 50) * 50, clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fieldNamed = name => SECTOR.fields.find(f => f.name === name);
function pointIn(field, rng) { const a = rng() * Math.PI * 2, d = field.radius * (0.2 + rng() * 0.45); return [Math.round(field.pos[0] + Math.cos(a) * d), Math.round(field.pos[1] + Math.sin(a) * d)]; }
function pointNear(station, rng, min, max) { const a = rng() * Math.PI * 2, d = min + rng() * (max - min); return [Math.round(station.pos[0] + Math.cos(a) * d), Math.round(station.pos[1] + Math.sin(a) * d)]; }

function bounty(p, station, rng, n) {
  const lairs = SECTOR.fields.filter(f => f.kind === 'wrecks'), lair = rng() < 0.6 ? lairs[Math.floor(rng() * lairs.length)] : null;
  const threat = clamp(Math.round(levelOf(p) * 0.5 + rng() * 1.3 + (lair ? lair.threat * 0.25 : 0)), 1, 6), name = captainName(rng);
  return {id: `b${p.board}-${n}`, kind: 'bounty', giver: station.faction === 'pennant' ? 'league' : station.faction, threat, boss: name,
    pos: lair ? pointIn(lair, rng) : pointNear(station, rng, 5000, 9000), reward: round50(900 * threat ** 1.7 + 600),
    title: `Bounty: ${name}, Black Pennant${lair ? ` — ${lair.name}` : ''}`,
    text: `${name} and a threat-${threat} Pennant squadron ${lair ? `are sheltering in ${lair.name}` : `have been sighted off ${station.name}`}. Destroy every ship. Payment on the last kill.`,
    done: `${name}'s squadron is scrap. Payment wired.`};
}
function defend(p, station, rng, n) {
  const threat = clamp(Math.round(levelOf(p) * 0.45 + rng() * 1.2), 1, 5);
  return {id: `d${p.board}-${n}`, kind: 'defend', giver: 'league', threat, pos: pointNear(station, rng, 4500, 8000), reward: round50(1100 * threat ** 1.6 + 900),
    title: `Distress: League haulers under attack off ${station.name}`,
    text: `A League convoy is calling for help. Reach the beacon, destroy the threat-${threat} raiders and keep at least one hauler alive.`,
    done: 'The haulers limp on toward port. The League remembers its friends.'};
}
function delivery(p, station, rng, n) {
  const pool = SECTOR.stations.filter(s => s.id !== station.id && (p.rep[s.faction] ?? 0) > REFUSE_REP);
  if (!pool.length) return null;
  const dest = pool[Math.floor(rng() * pool.length)], dist = Math.hypot(dest.pos[0] - station.pos[0], dest.pos[1] - station.pos[1]);
  const cargo = Math.min(4 + Math.floor(rng() * 10), Math.max(3, Math.floor(HULLS[p.hull].cargo / 2)));
  return {id: `c${p.board}-${n}`, kind: 'delivery', giver: station.faction, dest: dest.id, cargo, reward: round50(500 + dist / 1000 * 60 + cargo * 45),
    title: `Freight: ${cargo} bonded crates to ${dest.name}`,
    text: `Carry ${cargo} bonded crates to ${dest.name}. They take ${cargo} hold units. Payment on delivery.`, done: `${dest.name} signs for the crates. Payment wired.`};
}

/** Jobs offered at a station now. The board changes every time the captain docks. */
export function jobsAt(p, stationId) {
  if (mods.mode?.contracts === false) return [];
  const station = STATIONS[stationId], rng = seededRandom(hash(`${p.seed}:${p.board}:${stationId}`)), jobs = [], mark = WANTED[p.wanted];
  if (mark && FACTIONS[station.faction].lawful) {
    const field = fieldNamed(mark.field);
    jobs.push({id: `wanted${p.wanted}`, kind: 'wanted', wanted: p.wanted, giver: 'watch', threat: mark.threat, boss: mark.name, vessel: mark.vessel, pos: pointIn(field, seededRandom(hash(mark.name))), reward: mark.reward,
      title: `Most Wanted ${['I', 'II', 'III', 'IV'][p.wanted]}: ${mark.name}`, text: `${mark.text} Last seen in ${mark.field}.`, done: mark.done,
      locked: levelOf(p) < mark.minLevel ? `The Watch offers this warrant to rank ${mark.minLevel} captains.` : null});
  }
  const makers = station.faction === 'pennant' ? [delivery, delivery, bounty] : [bounty, defend, delivery, bounty];
  for (let n = 0; n < 3 + (rng() < 0.5 ? 1 : 0); n++) { const job = makers[Math.floor(rng() * makers.length)](p, station, rng, n) ?? bounty(p, station, rng, n); jobs.push(job); }
  const story = campaignJob(p, stationId, levelOf(p));
  return [...(story ? [story] : []), ...jobs, ...mods.jobsAt(p, stationId, levelOf(p))];
}
export function acceptJob(p, job) {
  if (p.mission) return {ok: false, text: 'Finish or abandon your current contract first.'};
  if (job.locked) return {ok: false, text: job.locked};
  if (job.kind === 'delivery' && job.cargo > cargoFree(p)) return {ok: false, text: `You need ${job.cargo} free hold units.`};
  p.mission = {...structuredClone(job), spawned: false, kills: 0, total: 0};
  return {ok: true, text: `Contract accepted: ${job.title}`};
}
export function abandonMission(p) {
  if (!p.mission) return {ok: false, text: 'No active contract.'};
  adjustRep(p, p.mission.giver, -0.03); p.mission = null;
  return {ok: true, text: 'Contract abandoned.'};
}
export function completeMission(p) {
  const m = p.mission;
  if (!m) return null;
  p.credits += m.reward; p.stats.earned += m.reward; p.stats.missions++; adjustRep(p, m.giver, 0.07);
  if (m.kind === 'wanted') p.wanted = m.wanted + 1;
  advanceCampaign(p, m); mods.completed(p, m); p.mission = null;
  return {title: m.title, text: m.done, reward: m.reward, wanted: m.kind === 'wanted', victory: m.kind === 'wanted' && m.wanted === WANTED.length - 1};
}
export function failMission(p, text) { const m = p.mission; if (!m) return null; adjustRep(p, m.giver, -0.04); p.mission = null; return {title: m.title, text}; }
export function missionOnDock(p, stationId) {
  const m = p.mission;
  if (m && mods.custom(m.kind)?.onDock?.(p, m, stationId) === 'complete') return completeMission(p);
  return m?.kind === 'delivery' && m.dest === stationId ? completeMission(p) : null;
}
export function missionObjective(p) {
  const m = p.mission;
  if (!m) return null;
  if (mods.custom(m.kind)) return mods.custom(m.kind).objective(p, m);
  if (m.kind === 'delivery') return `Deliver ${m.cargo} crates to ${STATIONS[m.dest].name}`;
  if (m.kind === 'defend') return m.spawned ? `Destroy the raiders (${m.total - m.kills} left) and keep a hauler alive` : 'Reach the distress beacon';
  return m.spawned ? `Destroy ${m.boss}'s squadron (${m.total - m.kills} left)` : `Hunt down ${m.boss}`;
}
