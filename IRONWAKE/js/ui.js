// SPDX-License-Identifier: Apache-2.0
// Port screens: wardroom, market, dockyard and contract board (plain DOM).
import {FACTIONS, SECTOR, STATIONS, HULLS, BROADSIDES, TURRETS, UPGRADES, TORPEDO, GOODS, marketEvent, stocks} from './sim/data.js';
import {cargoUsed, cargoFree, levelOf, netWorth, nextLevelAt, standing, dayOf, maxHull, shieldCap, priceFor, buyGood, sellGood, maxBuy, buyBattery, batteryQuote, buyTurrets, turretQuote,
  buyUpgrade, upgradeQuote, buyTorpedoes, repair, repairCost, buyHull, hullQuote} from './sim/player.js';
import {jobsAt, acceptJob, abandonMission, missionObjective, WANTED} from './sim/missions.js';

const esc = text => String(text).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const cr = n => `${Math.round(n).toLocaleString('en-US')} cr`;
const rgb = c => `rgb(${c.map(v => Math.round(v * 255)).join(',')})`;
const TABS = [['wardroom', 'Wardroom'], ['market', 'Market'], ['dockyard', 'Dockyard'], ['contracts', 'Contracts']];
const KINDS = {shield: 'Shield screens', deflector: 'Deflector', engine: 'Drive', armor: 'Armour'};

export class StationUI {
  constructor(root, {onLaunch, onChange, sound}) {
    this.root = root; this.onLaunch = onLaunch; this.onChange = onChange; this.sound = sound; this.tab = 'wardroom';
    root.addEventListener('click', event => { const b = event.target.closest('[data-act]'); if (b && !b.disabled) this.#act(b.dataset); });
  }
  open(player, stationId, result = null, welcome = false) {
    this.player = player; this.station = STATIONS[stationId]; this.tab = 'wardroom'; this.toast = null;
    this.notice = result ? {title: result.victory ? 'The Black Pennant is broken' : result.wanted ? 'Warrant served' : 'Contract complete', text: `${result.text} (+${cr(result.reward)})`} : welcome
      ? {title: 'Welcome aboard, Captain', text: 'You command the cutter Tern: three guns a side, two turrets and 4,000 credits. Trade between ports, crack rocks for ore, take contracts, and work down the Watch\'s Most Wanted list. Look to port or starboard, hold the trigger to steady your broadside, and release to fire.'} : null;
    this.root.hidden = false; this.render();
  }
  close() { this.root.hidden = true; }
  #done(result, good = 'buy') { this.toast = result; this.sound(result.ok ? good : 'error'); if (result.ok) this.onChange(); this.render(); }
  #act(d) {
    const p = this.player, id = this.station.id, n = Number(d.n);
    switch (d.act) {
      case 'tab': this.tab = d.tab; this.toast = null; this.sound('click'); return this.render();
      case 'launch': this.sound('click'); return this.onLaunch();
      case 'repair': return this.#done(repair(p));
      case 'buy': return this.#done(buyGood(p, id, d.good, d.n === 'max' ? Math.max(1, maxBuy(p, id, d.good)) : n));
      case 'sell': return this.#done(sellGood(p, id, d.good, d.n === 'all' ? p.cargo[d.good] ?? 0 : Math.min(n, p.cargo[d.good] ?? 0)));
      case 'battery': return this.#done(buyBattery(p, id, d.item));
      case 'turret': return this.#done(buyTurrets(p, id, d.item));
      case 'upgrade': return this.#done(buyUpgrade(p, id, d.kind, n));
      case 'torps': return this.#done(buyTorpedoes(p, n));
      case 'hull': return this.#done(buyHull(p, id, d.item));
      case 'accept': return this.#done(acceptJob(p, this.jobs.find(j => j.id === d.job)), 'dock');
      case 'abandon': return this.#done(abandonMission(p), 'click');
    }
  }
  render() {
    const p = this.player, s = this.station, hull = HULLS[p.hull], cost = repairCost(p), faction = FACTIONS[s.faction];
    const body = {wardroom: () => this.#wardroom(), market: () => this.#market(), dockyard: () => this.#dockyard(), contracts: () => this.#contracts()}[this.tab]();
    this.root.innerHTML = `<div class="st-shell">
      <header class="st-head"><div><h1>${esc(s.name)}</h1><p><span class="dot" style="background:${rgb(faction.color)}"></span>${esc(faction.name)} · ${esc(SECTOR.name)}</p></div>
        <div class="st-wallet"><strong>${cr(p.credits)}</strong><span>${esc(hull.name)}-class ${esc(hull.cls)} · hold ${cargoUsed(p)}/${hull.cargo} · hull ${Math.round(p.hp)}/${maxHull(p)}</span></div></header>
      <nav class="st-tabs">${TABS.map(([id, name]) => `<button data-act="tab" data-tab="${id}" class="${id === this.tab ? 'on' : ''}">${name}</button>`).join('')}</nav>
      ${this.toast ? `<div class="st-toast ${this.toast.ok ? 'ok' : 'bad'}">${esc(this.toast.text)}</div>` : ''}
      <main class="st-body">${body}</main>
      <footer class="st-foot"><button data-act="repair" ${cost <= 0 ? 'disabled' : ''}>${cost > 0 ? `Repair hull (${cr(cost)})` : 'Hull is sound'}</button>
        <span class="st-saved">Progress is saved while docked.</span><button class="primary" data-act="launch">Cast off ▸</button></footer></div>`;
  }
  #wardroom() {
    const p = this.player, s = this.station, next = nextLevelAt(p), day = dayOf(p);
    const reps = Object.entries(FACTIONS).map(([id, f]) => { const v = p.rep[id]; return `<tr><td><span class="dot" style="background:${rgb(f.color)}"></span>${esc(f.name)}</td><td class="${v <= -0.35 ? 'neg' : v >= 0.3 ? 'pos' : ''}">${standing(v)}</td><td><div class="meter"><i style="left:${(v + 1) * 50}%"></i></div></td></tr>`; }).join('');
    const board = SECTOR.stations.map(o => { const e = marketEvent(p.seed, o.id, day); return `<tr><td>${esc(o.name)}</td><td class="${e ? (e.mult > 1 ? 'gold' : 'pos') : 'dim'}">${e ? esc(e.text) : 'Steady trade'}</td></tr>`; }).join('');
    const wanted = WANTED.map((m, i) => `<li class="${i < p.wanted ? 'done' : i === p.wanted ? 'now' : ''}">${i < p.wanted ? '✔' : i === p.wanted ? '➤' : '•'} ${esc(m.name)} <span class="dim">— ${esc(m.field)}, ${cr(m.reward)}</span></li>`).join('');
    return `${this.notice ? `<section class="card notice"><h2>${esc(this.notice.title)}</h2><p>${esc(this.notice.text)}</p></section>` : ''}
      <div class="cols">
        <section class="card"><h2>The wardroom</h2><p>${esc(s.about)}</p><p class="rumor">Overheard: “${esc(s.rumors[(p.board + p.stats.missions) % s.rumors.length])}”</p>
          <h3>Captain's log</h3><p>Rank ${levelOf(p)} · net worth ${cr(netWorth(p))}${next ? ` · next rank at ${cr(next)}` : ''}</p>
          <p>${p.stats.capitals} warships and ${p.stats.kills - p.stats.capitals} skates destroyed · ${p.stats.missions} contracts · ${p.stats.mined} rocks cracked</p>
          <p>${p.mission ? `Active contract: ${esc(missionObjective(p))}` : 'No active contract. See the Contracts tab.'}</p>
          <h3>Most Wanted</h3><ul class="wanted">${wanted}</ul>${p.wanted >= WANTED.length ? '<p class="pos">Every warrant is served. The Banks are yours.</p>' : ''}</section>
        <section class="card"><h2>Market board</h2><table class="grid">${board}</table><p class="small">The board changes as time passes at sea. A shortage is worth sailing for.</p>
          <h3>Standing</h3><table class="grid">${reps}</table><p class="small">Factions fire on you when Hostile and close their ports when Hunted.</p></section>
      </div>`;
  }
  #market() {
    const p = this.player, s = this.station, event = marketEvent(p.seed, s.id, dayOf(p));
    const rows = Object.entries(GOODS).map(([id, g]) => {
      const price = priceFor(p, s.id, id), held = p.cargo[id] ?? 0, sold = stocks(s, id);
      if (g.found && !held && !sold) return '';
      const ratio = price / g.price, trend = ratio <= 0.9 ? `<span class="pos">▼ ${Math.round((1 - ratio) * 100)}% cheap</span>` : ratio >= 1.1 ? `<span class="gold">▲ ${Math.round((ratio - 1) * 100)}% dear</span>` : '<span class="dim">average</span>';
      const can = sold ? maxBuy(p, s.id, id) : 0;
      return `<tr><td>${esc(g.name)}${event?.good === id ? ` <span class="tag gold">${event.mult > 1 ? 'shortage' : 'glut'}</span>` : ''}</td><td>${cr(price)}</td><td>${trend}</td><td>${held || ''}</td>
        <td class="acts">${sold ? `<button data-act="buy" data-good="${id}" data-n="1" ${can < 1 ? 'disabled' : ''}>Buy 1</button><button data-act="buy" data-good="${id}" data-n="10" ${can < 10 ? 'disabled' : ''}>10</button><button data-act="buy" data-good="${id}" data-n="max" ${can < 1 ? 'disabled' : ''}>Max ${can || ''}</button>` : '<span class="dim">not sold here</span>'}</td>
        <td class="acts"><button data-act="sell" data-good="${id}" data-n="1" ${held ? '' : 'disabled'}>Sell 1</button><button data-act="sell" data-good="${id}" data-n="all" ${held ? '' : 'disabled'}>All</button></td></tr>`;
    }).join('');
    return `<section class="card"><h2>Exchange floor</h2><p class="small">Free hold space: ${cargoFree(p)} of ${HULLS[p.hull].cargo}. ${event ? `Today: ${esc(event.text)}.` : 'No upsets on the board today.'}</p>
      <table class="grid wide"><thead><tr><th>Good</th><th>Price</th><th>Here</th><th>Hold</th><th>Buy</th><th>Sell</th></tr></thead><tbody>${rows}</tbody></table></section>`;
  }
  #dockyard() {
    const p = this.player, s = this.station, hull = HULLS[p.hull], level = levelOf(p);
    const quote = (cost, owned) => (owned ? '<span class="pos">fitted</span>' : cost > p.credits ? `<span class="neg">${cr(cost)}</span>` : cr(cost));
    const batteries = s.batteries.map(id => { const b = BROADSIDES[id], own = id === p.battery, cost = batteryQuote(p, id);
      return `<tr><td>${esc(b.name)}<br><span class="small">${esc(b.blurb)}</span></td><td>${b.dmg} per gun · ${b.range} m · ${b.reload}s reload</td><td>${quote(cost, own)}</td><td class="acts">${own ? '' : `<button data-act="battery" data-item="${id}" ${cost > p.credits ? 'disabled' : ''}>Mount</button>`}</td></tr>`; }).join('');
    const turrets = s.turrets.map(id => { const t = TURRETS[id], own = id === p.turret, cost = turretQuote(p, id);
      return `<tr><td>${esc(t.name)}<br><span class="small">${esc(t.blurb)}</span></td><td>${t.dmg} × ${t.rate}/s · ${t.range} m${t.blast ? ' · bursting' : ''}</td><td>${quote(cost, own)}</td><td class="acts">${own ? '' : `<button data-act="turret" data-item="${id}" ${cost > p.credits ? 'disabled' : ''}>Fit</button>`}</td></tr>`; }).join('');
    const upgrades = Object.entries(UPGRADES).map(([kind, tiers]) => tiers.slice(1).map((u, i) => { const tier = i + 1, own = p[kind] === tier, cost = upgradeQuote(p, kind, tier), offered = tier <= s.tier;
      return `<tr><td>${KINDS[kind]}</td><td>${esc(u.name)}</td><td>${own ? '<span class="pos">fitted</span>' : offered ? (cost > p.credits ? `<span class="neg">${cr(cost)}</span>` : cr(cost)) : '<span class="dim">bigger yard</span>'}</td>
        <td class="acts">${own || !offered ? '' : `<button data-act="upgrade" data-kind="${kind}" data-n="${tier}" ${cost > p.credits ? 'disabled' : ''}>Fit</button>`}</td></tr>`; }).join('')).join('');
    const stat = (name, value, base) => `<tr><td>${name}</td><td>${value}</td><td class="${value > base ? 'pos' : value < base ? 'neg' : 'dim'}">${value === base ? '=' : `${value > base ? '+' : ''}${Math.round((value - base) * 100) / 100}`}</td></tr>`;
    const hulls = s.yard.map(id => { const h = HULLS[id], own = id === p.hull, cost = own ? 0 : hullQuote(p, id);
      const reason = own ? 'You command this hull' : level < h.level ? `Requires rank ${h.level}` : cargoUsed(p) > h.cargo ? 'Cargo will not fit' : cost > p.credits ? `Short by ${cr(cost - p.credits)}` : null;
      return `<section class="card ship"><h2>${esc(h.name)} <span class="tag">${esc(h.cls)}</span></h2><p>${esc(h.blurb)}</p>
        <table class="grid">${stat('Hull', h.hp, hull.hp)}${stat('Screens', h.shield, hull.shield)}${stat('Guns per side', h.cannons, hull.cannons)}${stat('Turrets', h.turrets, hull.turrets)}${stat('Hold', h.cargo, hull.cargo)}${stat('Speed', h.speed, hull.speed)}${stat('Helm', h.turn, hull.turn)}</table>
        <p>List ${cr(h.price)}${own ? '' : ` · <strong>${cr(cost)}</strong> with trade-in and refit`}</p><button class="primary" data-act="hull" data-item="${id}" ${reason ? 'disabled' : ''}>${reason ?? `Commission the ${esc(h.name)}`}</button></section>`; }).join('');
    return `<div class="cols">
      <section class="card"><h2>Your ${esc(hull.name)}</h2><p>${hull.cannons} guns a side: <strong>${esc(BROADSIDES[p.battery].name)}</strong> · ${hull.turrets} mounts: <strong>${esc(TURRETS[p.turret].name)}</strong></p>
        <p>Hull ${Math.round(p.hp)}/${maxHull(p)} · screens ${shieldCap(p)} each · torpedoes ${p.torps}/${hull.torps} (${cr(TORPEDO.price)} each)
          <button data-act="torps" data-n="1">+1</button> <button data-act="torps" data-n="${hull.torps}">Fill</button></p>
        <h3>Fittings</h3><table class="grid">${upgrades}</table></section>
      <section class="card"><h2>Broadside batteries</h2><table class="grid">${batteries}</table><h3>Turrets</h3><table class="grid">${turrets}</table>
        <p class="small">Prices cover every gun or mount on your hull, less 70% trade-in for what comes off.</p></section></div>
      ${hulls ? `<div class="cols three">${hulls}</div>` : '<section class="card"><p class="dim">This port has no slipway. Hulls are laid down at Anchorage Prime, Coldharbor and Lantern Rock.</p></section>'}`;
  }
  #contracts() {
    const p = this.player; this.jobs = jobsAt(p, this.station.id);
    const active = p.mission ? `<section class="card notice"><h2>Active contract</h2><p><strong>${esc(p.mission.title)}</strong></p><p>${esc(missionObjective(p))} · pays ${cr(p.mission.reward)}</p><button data-act="abandon">Abandon contract</button></section>` : '';
    const list = this.jobs.map(j => `<section class="card job ${j.kind === 'wanted' ? 'story' : ''}"><h2>${j.kind === 'wanted' ? '★ ' : ''}${esc(j.title)}</h2><p>${esc(j.text)}</p>
      <p><span class="dot" style="background:${rgb(FACTIONS[j.giver].color)}"></span>${esc(FACTIONS[j.giver].name)} · pays <strong>${cr(j.reward)}</strong></p>
      <button class="primary" data-act="accept" data-job="${j.id}" ${p.mission || j.locked ? 'disabled' : ''}>${j.locked ?? (p.mission ? 'Finish your current contract first' : 'Accept')}</button></section>`).join('');
    return `${active}<div class="cols">${list}</div>`;
  }
}
