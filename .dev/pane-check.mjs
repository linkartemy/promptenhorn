// Places one building on the test server in build-list order and reports panes/bars/fences left as isolated posts.
// Usage: node .dev/pane-check.mjs <type> [seed] [turns]
import fs from 'node:fs';
import { Rcon } from '../bridge/rcon.mjs';
import { BUILDINGS, square, plaza } from '../bridge/buildings.mjs';
import { rngFrom } from '../bridge/blueprint.mjs';

const props = fs.readFileSync(new URL('./test-server/server.properties', import.meta.url), 'utf8');
const rcon = new Rcon({ port: 25576, password: props.match(/^rcon\.password=(.*)$/m)[1].trim() });
await rcon.connect();
const cmd = (c) => rcon.command(c);
const [type = 'hotel', seed = 'p0', turns = '0'] = process.argv.slice(2);
const gens = { ...BUILDINGS, square, plaza };
const bp = type === 'square' || type === 'plaza' ? gens[type](rngFrom(seed)) : gens[type](rngFrom(`${seed}:${type}`));
const list = bp.toBuildList({ turns: Number(turns), size: 21, offset: 2, clipMin: 0, clipMax: 20 });
const x0 = 21000, z0 = 21000, Y = 150;
await cmd(`forceload add ${x0 - 4} ${z0 - 4} ${x0 + 24} ${z0 + 24}`);
await new Promise((r) => setTimeout(r, 1500));
await cmd(`fill ${x0 - 2} ${Y + 1} ${z0 - 2} ${x0 + 22} ${Y + 44} ${z0 + 22} air`);
await cmd(`fill ${x0 - 2} ${Y} ${z0 - 2} ${x0 + 22} ${Y} ${z0 + 22} stone_bricks`);
await cmd(`fill ${x0 + 2} ${Y} ${z0 + 2} ${x0 + 18} ${Y} ${z0 + 18} grass_block`);
for (const b of list) await cmd(`setblock ${x0 + b.x} ${Y + b.y} ${z0 + b.z} ${b.block}`);
const map = new Map(list.map((b) => [`${b.x},${b.y},${b.z}`, b.block]));
let posts = 0, total = 0, mismatch = 0;
for (const b of list) {
  const m = b.block.match(/^minecraft:([a-z_]*(glass_pane|_bars|fence|_wall))\b/);
  if (!m || /fence_gate|wall_(sign|banner|hanging)/.test(b.block)) continue;
  total++;
  const name = m[1];
  const isPost = /passed/i.test(await cmd(`execute if block ${x0 + b.x} ${Y + b.y} ${z0 + b.z} ${name}[north=${/_wall$/.test(name) ? 'none' : 'false'},east=${/_wall$/.test(name) ? 'none' : 'false'},south=${/_wall$/.test(name) ? 'none' : 'false'},west=${/_wall$/.test(name) ? 'none' : 'false'}]`));
  // Expected state from the build list itself (if toBuildList emits connection props).
  const exp = b.block.match(/\[([^\]]*)\]/)?.[1];
  if (exp && /north=/.test(exp)) {
    const ok = /passed/i.test(await cmd(`execute if block ${x0 + b.x} ${Y + b.y} ${z0 + b.z} ${b.block.replace(/\{.*$/, '')}`));
    if (!ok) mismatch++;
  }
  if (isPost) {
    posts++;
    const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => (map.get(`${b.x + dx},${b.y},${b.z + dz}`) ?? 'air').replace(/^minecraft:/, '').slice(0, 30));
    if (posts <= 15) console.log(`post ${name} @${b.x},${b.y},${b.z}  E/W/S/N: ${nb.join(' | ')}`);
  }
}
console.log(`${type}: ${total} connectable blocks, ${posts} isolated posts, ${mismatch} differ from emitted state`);
rcon.close();
process.exit(0);
