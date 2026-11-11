// SPDX-License-Identifier: Apache-2.0
// The same mode logic runs on both engines; coordinate conversion stays explicit.
export function makeModes(iron, clearApproach) {
  const starter = (p, c) => { p.hull = 'liberty'; p.hp = c.hulls.liberty.hp; p.credits = 5000; };
  const quiet = w => {
    w.traffic = false;
    for (const s of w.ships) if (!s.isPlayer) w.byId.delete(s.id);
    w.ships = [w.playerShip];
  };
  return [
    {id: 'explorer', title: 'Independent explorer', description: 'Fly the Liberty survey hull. No ambient raiders or traffic; board contracts still work.',
      newPlayer: starter, onWorld(w) { quiet(w); w.mod = {objective: 'Explore freely · survey contracts available at your home port'}; }},
    {id: 'arena', title: 'Three-wave proving ground', description: 'Three combat waves, repairs between rounds and a 6,000 cr prize. Dock to save the result. Unfinished runs restart on launch.', contracts: false,
      newPlayer: starter,
      onWorld(w) {
        quiet(w); const s = w.playerShip;
        s.body.position = iron ? [0, 0, -16000] : [0, 4000, 15000]; s.prevPos = [...s.body.position]; s.body.velocity = [0, 0, 0]; s.throttle = 0;
        w.mod = {wave: 0, wait: 4, enemies: null, finished: !!w.player.modState.mode.won, objective: 'Proving ground · first wave in four seconds'};
        if (w.mod.finished) w.mod.objective = 'Proving ground complete · return to port';
      },
      onStep(w, dt) {
        const run = w.mod, me = w.playerShip;
        if (run.finished) return;
        if (run.enemies) {
          if (run.enemies.some(s => s.gone)) { run.finished = true; run.objective = 'Proving ground abandoned · dock and launch to retry'; return; }
          const alive = run.enemies.filter(s => s.alive).length;
          run.objective = `Proving ground ${run.wave}/3 · ${alive} hostiles`;
          if (alive) return;
          run.enemies = null; me.hp = me.maxHp; w.player.hp = me.hp; run.wait = 7;
          if (run.wave === 3) {
            w.player.modState.mode.won = true; w.player.credits += 6000; w.player.stats.earned += 6000;
            run.finished = true; run.objective = 'Proving ground complete · 6,000 cr paid · dock to save';
            w.events.push({type: 'msg', tone: 'good', text: run.objective}); return;
          }
        }
        run.wait -= dt;
        if (run.wait > 0) { run.objective = `Hull repaired · wave ${run.wave + 1} in ${Math.ceil(run.wait)}s`; return; }
        // Only advertise/spawn a wave with a clear full-formation approach.
        let pos = null;
        for (let i = 0; i < 24; i++) {
          const a = i * Math.PI / 12, r = 1800;
          const candidate = iron ? [me.body.position[0] + Math.cos(a) * r, me.body.position[2] + Math.sin(a) * r]
            : [me.body.position[0] + Math.cos(a) * r, me.body.position[1], me.body.position[2] + Math.sin(a) * r];
          if (clearApproach(w, candidate)) { pos = candidate; break; }
        }
        if (!pos) { run.wait = 1; run.objective = 'Move clear of hazards and debris for the next wave'; return; }
        const wave = w.startEncounter(run.wave === 2 ? 2 : 0, pos);
        run.enemies = wave.enemies;
        for (const s of run.enemies) s.encounter = true;
        run.wave++; w.events.push({type: 'msg', tone: 'warn', text: `Proving ground wave ${run.wave}/3. Weapons free.`});
      },
    },
  ];
}
