// In-game check on the disposable test server (.dev/test-server, RCON 25576): places every generator's
// blocks with plain setblock in build-list order, then verifies each block is still there.
// Usage: node .dev/ingame-check.mjs [type,type,...] [seeds=2] [rotations=0,1]
import fs from 'node:fs';
import { Rcon } from '../bridge/rcon.mjs';
import { BUILDINGS, square, plaza } from '../bridge/buildings.mjs';
import { rngFrom } from '../bridge/blueprint.mjs';

const props = fs.readFileSync(new URL('./test-server/server.properties', import.meta.url), 'utf8');
const password = props.match(/^rcon\.password=(.*)$/m)[1].trim();
const port = Number(props.match(/^rcon\.port=(.*)$/m)[1]);
const [typesArg, seedsArg = '2', rotArg = '0,1'] = process.argv.slice(2);
const gens = { ...BUILDINGS, square, plaza };
const types = typesArg && typesArg !== 'all' ? typesArg.split(',') : Object.keys(gens);
const seeds = Number(seedsArg);
const rots = rotArg.split(',').map(Number);

const rcon = new Rcon({ port, password });
await rcon.connect();
const cmd = (c) => rcon.command(c);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const g of ['log_admin_commands false', 'send_command_feedback false', 'do_tile_drops false', 'do_daylight_cycle false']) await cmd(`gamerule ${g}`);
await cmd('time set noon');

const Y = 150;
let caseNo = 0;
const report = [];
for (const type of types) {
  for (let s = Number(process.env.SEED0 ?? 0); s < Number(process.env.SEED0 ?? 0) + seeds; s++) {
    for (const turns of rots) {
      const x0 = Number(process.env.X0 ?? 20000) + (caseNo % 8) * 32;
      const z0 = Number(process.env.Z0 ?? 20000) + Math.floor(caseNo / 8) * 32;
      caseNo++;
      const seed = `ingame${s}`;
      const opts = { ...(process.env.STAGE ? { stage: Number(process.env.STAGE) } : {}), ...(process.env.TERRAIN ? { terrain: JSON.parse(process.env.TERRAIN) } : {}) };
      const bp = type === 'square' || type === 'plaza' ? gens[type](rngFrom(seed)) : gens[type](rngFrom(`${seed}:${type}`), opts);
      const list = bp.toBuildList({ turns, size: 21, offset: 2, clipMin: 0, clipMax: 20 });
      await cmd(`forceload add ${x0 - 4} ${z0 - 4} ${x0 + 24} ${z0 + 24}`);
      for (let i = 0; i < 40; i++) {
        const r = await cmd(`setblock ${x0} ${Y - 4} ${z0} stone`);
        if (!/not loaded|position is not loaded/i.test(r)) break;
        await sleep(250);
      }
      await cmd(`fill ${x0 - 2} ${Y + 1} ${z0 - 2} ${x0 + 22} ${Y + 44} ${z0 + 22} air`);
      await cmd(`fill ${x0 - 2} ${Y - 4} ${z0 - 2} ${x0 + 22} ${Y - 1} ${z0 + 22} dirt`);
      await cmd(`fill ${x0 - 2} ${Y} ${z0 - 2} ${x0 + 22} ${Y} ${z0 + 22} stone_bricks`);
      await cmd(`fill ${x0 + 2} ${Y} ${z0 + 2} ${x0 + 18} ${Y} ${z0 + 18} grass_block`);
      const failedSet = [];
      for (const b of list) {
        const r = await cmd(`setblock ${x0 + b.x} ${Y + b.y} ${z0 + b.z} ${b.block}`);
        if (!/Changed the block|Could not set the block/i.test(r) && r.trim()) failedSet.push(`${b.block} @${b.x},${b.y},${b.z}: ${r.trim().slice(0, 120)}`);
      }
      await sleep(2500);
      const popped = [];
      for (const b of list) {
        const name = b.block.replace(/[[{].*$/, '');
        const r = await cmd(`execute if block ${x0 + b.x} ${Y + b.y} ${z0 + b.z} ${name}`);
        if (!/passed/i.test(r) && !(name === 'minecraft:water' && /passed/i.test(await cmd(`execute if block ${x0 + b.x} ${Y + b.y} ${z0 + b.z} ice`)))) popped.push(`${b.block.slice(0, 80)} @${b.x},${b.y},${b.z}`);
      }
      // Connection states (standard 1.4): the emitted state must be what the game shows, and re-placing the bare
      // block (which recomputes connections from the neighbours, like a player placing it) must change nothing.
      const badConn = [];
      for (const b of list) {
        const name = b.block.replace(/[[{].*$/, '');
        if (!/glass_pane|_bars|_fence$|_wall$/.test(name) || /wall_(sign|banner|hanging)/.test(name)) continue;
        const full = b.block.replace(/\{.*$/, '');
        if (/north=/.test(full) && !/passed/i.test(await cmd(`execute if block ${x0 + b.x} ${Y + b.y} ${z0 + b.z} ${full}`))) badConn.push(`emitted≠actual ${full.slice(10, 90)} @${b.x},${b.y},${b.z}`);
        const r = await cmd(`setblock ${x0 + b.x} ${Y + b.y} ${z0 + b.z} ${name}`);
        if (!/Could not set/i.test(r)) badConn.push(`not vanilla-stable ${name} @${b.x},${b.y},${b.z}: ${r.trim().slice(0, 60)}`);
      }
      const line = `${type} seed ${s} turns ${turns}: ${list.length} blocks, ${failedSet.length} setblock errors, ${popped.length} missing, ${badConn.length} connection mismatches`;
      console.log(line);
      for (const f of failedSet.slice(0, 8)) console.log('   set! ' + f);
      for (const p of popped.slice(0, 12)) console.log('   gone ' + p);
      for (const p of badConn.slice(0, 8)) console.log('   conn ' + p);
      report.push({ type, s, turns, n: list.length, failedSet, popped, badConn });
    }
  }
}
const bad = report.filter((r) => r.failedSet.length || r.popped.length || r.badConn.length);
console.log(`\n${report.length} builds, ${bad.length} with problems`);
rcon.close?.();
process.exit(0);
