// SPDX-License-Identifier: Apache-2.0
// Station screens: concourse, market, outfitter, shipyard and contract board (plain DOM).
import {FACTIONS, SYSTEMS, BASES, HULLS, GUNS, LAUNCHERS, SHIELDS, CONSUMABLES, GOODS, priceAt, stocks} from './sim/data.js';
import {cargoUsed, cargoFree, levelOf, netWorth, nextLevelAt, standing, buyGood, sellGood, maxBuy, buyGun, sellGun, buyShield, buyLauncher,
  buyAmmo, buyConsumable, repair, repairCost, buyHull, hullQuote} from './sim/player.js';
import {jobsAt, acceptJob, abandonMission, missionObjective, STORY} from './sim/missions.js';

const esc = text => String(text).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const cr = n => `${Math.round(n).toLocaleString('en-US')} cr`;
const rgb = c => `rgb(${c.map(v => Math.round(v * 255)).join(',')})`;
const TABS = [['concourse', 'Concourse'], ['market', 'Market'], ['outfitter', 'Outfitter'], ['shipyard', 'Shipyard'], ['contracts', 'Contracts']];

export class StationUI {
  constructor(root, {onLaunch, onChange, sound}) {
    this.root = root; this.onLaunch = onLaunch; this.onChange = onChange; this.sound = sound; this.tab = 'concourse'; this.toast = null; this.notice = null;
    root.addEventListener('click', event => {
      const button = event.target.closest('[data-act]');
      if (button && !button.disabled) this.#act(button.dataset);
    });
  }
  open(player, baseId, result = null, welcome = false) {
    this.player = player; this.base = BASES[baseId]; this.tab = 'concourse'; this.toast = null;
    this.notice = result ? {title: result.story ? 'Storyline complete' : 'Contract complete', text: `${result.text} (+${cr(result.reward)})`} : welcome
      ? {title: 'Welcome to the Tessel Reach, Captain', text: 'You own one Sparrow, two pulse lasers and 2,500 credits. Buy low, sell high, take contracts, and keep your shields up. Lieutenant Rook at Tollard Station is hiring. Check the Contracts tab anywhere for work, and press Launch when you are ready.'} : null;
    this.root.hidden = false; this.render();
  }
  close() { this.root.hidden = true; }
  #done(result, good = 'buy') {
    this.toast = result; this.sound(result.ok ? good : 'error');
    if (result.ok) this.onChange();
    this.render();
  }
  #act(d) {
    const p = this.player, id = this.base.id, n = Number(d.n);
    switch (d.act) {
      case 'tab': this.tab = d.tab; this.toast = null; this.sound('click'); return this.render();
      case 'launch': this.sound('click'); return this.onLaunch();
      case 'repair': return this.#done(repair(p));
      case 'buy': return this.#done(buyGood(p, id, d.good, d.n === 'max' ? Math.max(1, maxBuy(p, id, d.good)) : n));
      case 'sell': return this.#done(sellGood(p, id, d.good, d.n === 'all' ? p.cargo[d.good] ?? 0 : Math.min(n, p.cargo[d.good] ?? 0)));
      case 'gun': return this.#done(buyGun(p, id, Number(d.slot), d.item));
      case 'sellgun': return this.#done(sellGun(p, Number(d.slot)));
      case 'shield': return this.#done(buyShield(p, id, d.item));
      case 'launcher': return this.#done(buyLauncher(p, id, d.item));
      case 'ammo': return this.#done(buyAmmo(p, n));
      case 'kit': return this.#done(buyConsumable(p, d.kind, n));
      case 'hull': return this.#done(buyHull(p, id, d.item));
      case 'accept': return this.#done(acceptJob(p, this.jobs.find(j => j.id === d.job)), 'dock');
      case 'abandon': return this.#done(abandonMission(p), 'click');
    }
  }

  render() {
    const p = this.player, b = this.base, hull = HULLS[p.hull], cost = repairCost(p), faction = FACTIONS[b.faction];
    const body = {concourse: () => this.#concourse(), market: () => this.#market(), outfitter: () => this.#outfitter(), shipyard: () => this.#shipyard(), contracts: () => this.#contracts()}[this.tab]();
    this.root.innerHTML = `
      <div class="st-shell">
        <header class="st-head">
          <div><h1>${esc(b.name)}</h1><p><span class="dot" style="background:${rgb(faction.color)}"></span>${esc(faction.name)} · ${esc(SYSTEMS[b.system].name)} system</p></div>
          <div class="st-wallet"><strong>${cr(p.credits)}</strong><span>${esc(hull.name)} · cargo ${cargoUsed(p)}/${hull.cargo} · hull ${Math.round(p.hp)}/${hull.hp}</span></div>
        </header>
        <nav class="st-tabs">${TABS.map(([id, name]) => `<button data-act="tab" data-tab="${id}" class="${id === this.tab ? 'on' : ''}">${name}</button>`).join('')}</nav>
        ${this.toast ? `<div class="st-toast ${this.toast.ok ? 'ok' : 'bad'}">${esc(this.toast.text)}</div>` : ''}
        <main class="st-body">${body}</main>
        <footer class="st-foot">
          <button data-act="repair" ${cost <= 0 ? 'disabled' : ''}>${cost > 0 ? `Repair hull (${cr(cost)})` : 'Hull is sound'}</button>
          <span class="st-saved">Progress is saved while docked.</span>
          <button class="primary" data-act="launch">Launch ▸</button>
        </footer>
      </div>`;
  }

  #concourse() {
    const p = this.player, b = this.base, next = nextLevelAt(p), rumor = b.rumors[(p.board + p.stats.jumps) % b.rumors.length];
    const reps = Object.entries(FACTIONS).map(([id, f]) => {
      const v = p.rep[id];
      return `<tr><td><span class="dot" style="background:${rgb(f.color)}"></span>${esc(f.name)}</td><td class="${v <= -0.35 ? 'neg' : v >= 0.3 ? 'pos' : ''}">${standing(v)}</td>
        <td><div class="meter"><i style="left:${(v + 1) * 50}%"></i></div></td></tr>`;
    }).join('');
    return `
      ${this.notice ? `<section class="card notice"><h2>${esc(this.notice.title)}</h2><p>${esc(this.notice.text)}</p></section>` : ''}
      <div class="cols">
        <section class="card"><h2>The concourse</h2><p>${esc(b.about)}</p><p class="rumor">Overheard: “${esc(rumor)}”</p>
          <h3>Captain's log</h3>
          <p>Rank ${levelOf(p)} · net worth ${cr(netWorth(p))}${next ? ` · next rank at ${cr(next)}` : ''}</p>
          <p>${p.stats.kills} ships destroyed · ${p.stats.missions} contracts · ${p.stats.jumps} jumps · storyline ${Math.min(p.story, STORY.length)}/${STORY.length}</p>
          <p>${p.mission ? `Active contract: ${esc(missionObjective(p))}` : 'No active contract. See the Contracts tab.'}</p></section>
        <section class="card"><h2>Standing</h2><table class="grid">${reps}</table>
          <p class="small">Factions open fire when you are Hostile and close their ports when you are Hunted. Destroying a faction's enemies improves your name with it.</p></section>
      </div>`;
  }

  #market() {
    const p = this.player, b = this.base;
    const rows = Object.entries(GOODS).map(([id, g]) => {
      const price = priceAt(b, id), held = p.cargo[id] ?? 0, sold = stocks(b, id);
      if (price === null && !held) return '';
      const ratio = price === null ? 0 : price / g.price, trend = price === null ? '<span class="neg">not traded</span>' : ratio <= 0.9 ? `<span class="pos">▼ ${Math.round((1 - ratio) * 100)}% cheap</span>` : ratio >= 1.1 ? `<span class="gold">▲ ${Math.round((ratio - 1) * 100)}% dear</span>` : '<span class="dim">average</span>';
      const can = sold ? maxBuy(p, b.id, id) : 0;
      return `<tr><td>${esc(g.name)}${g.contraband ? ' <span class="tag neg">contraband</span>' : ''}</td><td>${price === null ? '—' : cr(price)}</td><td>${trend}</td><td>${held || ''}</td>
        <td class="acts">${sold ? `<button data-act="buy" data-good="${id}" data-n="1" ${can < 1 ? 'disabled' : ''}>Buy 1</button><button data-act="buy" data-good="${id}" data-n="10" ${can < 10 ? 'disabled' : ''}>10</button><button data-act="buy" data-good="${id}" data-n="max" ${can < 1 ? 'disabled' : ''}>Max ${can || ''}</button>` : '<span class="dim">not sold here</span>'}</td>
        <td class="acts"><button data-act="sell" data-good="${id}" data-n="1" ${!held || price === null ? 'disabled' : ''}>Sell 1</button><button data-act="sell" data-good="${id}" data-n="all" ${!held || price === null ? 'disabled' : ''}>All</button></td></tr>`;
    }).join('');
    return `<section class="card"><h2>Commodity exchange</h2>
      <p class="small">Free cargo space: ${cargoFree(p)} of ${HULLS[p.hull].cargo}. Prices are per unit; “cheap” and “dear” compare with the Reach average.</p>
      <table class="grid wide"><thead><tr><th>Good</th><th>Price</th><th>Here</th><th>Hold</th><th>Buy</th><th>Sell</th></tr></thead><tbody>${rows}</tbody></table></section>`;
  }

  #outfitter() {
    const p = this.player, b = this.base, hull = HULLS[p.hull], launcher = p.launcher ? LAUNCHERS[p.launcher] : null;
    const slots = p.guns.map((id, i) => `<tr><td>Hardpoint ${i + 1}</td><td>${id ? esc(GUNS[id].name) : '<span class="dim">empty</span>'}</td><td class="acts">${id ? `<button data-act="sellgun" data-slot="${i}">Sell (${cr(GUNS[id].price * 0.7)})</button>` : ''}</td></tr>`).join('');
    const guns = b.outfit.filter(id => GUNS[id]).map(id => {
      const g = GUNS[id], fits = g.cls <= hull.gunClass;
      return `<tr><td>${esc(g.name)} <span class="tag">class ${g.cls}</span></td><td>${g.dmg} hull / ${g.sh} shield · ${g.rate}/s · ${g.en} energy · ${g.range} m</td><td>${cr(g.price)}</td>
        <td class="acts">${fits ? p.guns.map((_, i) => `<button data-act="gun" data-item="${id}" data-slot="${i}" title="Mount on hardpoint ${i + 1}">▸${i + 1}</button>`).join('') : `<span class="neg">needs class ${g.cls} mounts</span>`}</td></tr>`;
    }).join('');
    const shields = b.outfit.filter(id => SHIELDS[id]).map(id => {
      const s = SHIELDS[id], fits = s.cls <= hull.shieldClass;
      return `<tr><td>${esc(s.name)} <span class="tag">class ${s.cls}</span></td><td>${s.cap} capacity · ${s.regen}/s recharge</td><td>${cr(s.price)}</td>
        <td class="acts">${id === p.shield ? '<span class="pos">fitted</span>' : fits ? `<button data-act="shield" data-item="${id}">Fit</button>` : `<span class="neg">needs class ${s.cls} generator</span>`}</td></tr>`;
    }).join('');
    const racks = b.outfit.filter(id => LAUNCHERS[id]).map(id => {
      const l = LAUNCHERS[id];
      return `<tr><td>${esc(l.name)}</td><td>${l.dmg} blast · holds ${l.ammoMax} · ${cr(l.ammoPrice)} per missile</td><td>${cr(l.price)}</td>
        <td class="acts">${id === p.launcher ? '<span class="pos">fitted</span>' : hull.launchers ? `<button data-act="launcher" data-item="${id}">Fit</button>` : '<span class="neg">no rack mount</span>'}</td></tr>`;
    }).join('');
    return `<div class="cols">
      <section class="card"><h2>Your ${esc(hull.name)}</h2>
        <table class="grid">${slots}
          <tr><td>Shield</td><td>${esc(SHIELDS[p.shield].name)}</td><td></td></tr>
          <tr><td>Missile rack</td><td>${launcher ? `${esc(launcher.name)} · ${p.ammo}/${launcher.ammoMax}` : hull.launchers ? '<span class="dim">empty mount</span>' : '<span class="dim">none</span>'}</td>
            <td class="acts">${launcher ? `<button data-act="ammo" data-n="1">+1</button><button data-act="ammo" data-n="${launcher.ammoMax}">Fill</button>` : ''}</td></tr>
          <tr><td>${CONSUMABLES.kit.name}es</td><td>${p.kits}/${hull.kits} · ${cr(CONSUMABLES.kit.price)} each</td><td class="acts"><button data-act="kit" data-kind="kit" data-n="1">+1</button><button data-act="kit" data-kind="kit" data-n="${hull.kits}">Fill</button></td></tr>
          <tr><td>${CONSUMABLES.cell.name}s</td><td>${p.cells}/${hull.kits} · ${cr(CONSUMABLES.cell.price)} each</td><td class="acts"><button data-act="kit" data-kind="cell" data-n="1">+1</button><button data-act="kit" data-kind="cell" data-n="${hull.kits}">Fill</button></td></tr>
        </table>
        <p class="small">Gun mounts: class ${hull.gunClass}. Shield generator: class ${hull.shieldClass}. Old gear is traded in at 70% when you replace it.</p></section>
      <section class="card"><h2>For sale</h2><table class="grid wide"><tbody>${guns}${shields}${racks}</tbody></table>
        ${guns || shields || racks ? '' : '<p class="dim">This port has no outfitter.</p>'}</section></div>`;
  }

  #shipyard() {
    const p = this.player, b = this.base, mine = HULLS[p.hull], level = levelOf(p);
    if (!b.ships.length) return '<section class="card"><h2>Shipyard</h2><p class="dim">No hulls are sold at this port. Try Calder, Brightwater Yard or the frontier yards.</p></section>';
    const stat = (name, value, base, suffix = '') => `<tr><td>${name}</td><td>${value}${suffix}</td><td class="${value > base ? 'pos' : value < base ? 'neg' : 'dim'}">${value === base ? '=' : `${value > base ? '+' : ''}${Math.round((value - base) * 100) / 100}`}</td></tr>`;
    const cards = b.ships.map(id => {
      const h = HULLS[id], owned = id === p.hull, quote = owned ? 0 : hullQuote(p, id);
      const reason = owned ? 'You fly this hull' : level < h.level ? `Requires rank ${h.level}` : cargoUsed(p) > h.cargo ? 'Cargo will not fit' : quote > p.credits ? `Short by ${cr(quote - p.credits)}` : null;
      return `<section class="card ship"><h2>${esc(h.name)} <span class="tag">${esc(h.cls)}</span></h2><p>${esc(h.blurb)}</p>
        <table class="grid">${stat('Hull', h.hp, mine.hp)}${stat('Cargo', h.cargo, mine.cargo)}${stat('Guns', h.guns, mine.guns)}${stat('Gun class', h.gunClass, mine.gunClass)}
          ${stat('Shield class', h.shieldClass, mine.shieldClass)}${stat('Speed', h.speed, mine.speed, ' m/s')}${stat('Turn rate', h.turn, mine.turn)}${stat('Energy', h.energy, mine.energy)}</table>
        <p>List price ${cr(h.price)}${owned ? '' : ` · <strong>${cr(quote)}</strong> after trade-in`}</p>
        <button class="primary" data-act="hull" data-item="${id}" ${reason ? 'disabled' : ''}>${reason ?? `Buy the ${esc(h.name)}`}</button></section>`;
    }).join('');
    return `<div class="cols three">${cards}</div>`;
  }

  #contracts() {
    const p = this.player;
    this.jobs = jobsAt(p, this.base.id);
    const active = p.mission ? `<section class="card notice"><h2>Active contract</h2><p><strong>${esc(p.mission.title)}</strong></p><p>${esc(missionObjective(p))} · pays ${cr(p.mission.reward)}</p>
      <button data-act="abandon">Abandon contract</button></section>` : '';
    const list = this.jobs.map(j => `<section class="card job ${Number.isInteger(j.story) ? 'story' : ''}"><h2>${Number.isInteger(j.story) ? '★ ' : ''}${esc(j.title)}</h2><p>${esc(j.text)}</p>
      <p><span class="dot" style="background:${rgb(FACTIONS[j.giver].color)}"></span>${esc(FACTIONS[j.giver].name)} · pays <strong>${cr(j.reward)}</strong></p>
      <button class="primary" data-act="accept" data-job="${j.id}" ${p.mission || j.locked ? 'disabled' : ''}>${j.locked ?? (p.mission ? 'Finish your current contract first' : 'Accept')}</button></section>`).join('');
    return `${active}<div class="cols">${list || '<section class="card"><p class="dim">The board is empty today.</p></section>'}</div>`;
  }
}
