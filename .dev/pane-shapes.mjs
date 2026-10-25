// Classifies every pane/bars block of a building already placed at 21000,150,21000 by .dev/pane-check.mjs.
import fs from 'node:fs';
import { Rcon } from '../bridge/rcon.mjs';
import { BUILDINGS } from '../bridge/buildings.mjs';
import { rngFrom } from '../bridge/blueprint.mjs';
const props = fs.readFileSync(new URL('./test-server/server.properties', import.meta.url), 'utf8');
const rcon = new Rcon({ port: 25576, password: props.match(/^rcon\.password=(.*)$/m)[1].trim() });
await rcon.connect();
const [type = 'hotel', seed = 'p0', turns = '0'] = process.argv.slice(2);
const list = BUILDINGS[type](rngFrom(`${seed}:${type}`)).toBuildList({ turns: Number(turns), size: 21, offset: 2, clipMin: 0, clipMax: 20 });
const map = new Map(list.map((b) => [`${b.x},${b.y},${b.z}`, b.block]));
const x0 = 21000, z0 = 21000, Y = 150;
const counts = {};
const samples = {};
for (const b of list) {
  const m = b.block.match(/^minecraft:([a-z_]*(glass_pane|iron_bars|_bars))\b/);
  if (!m) continue;
  const dirs = [];
  for (const [d, dx, dz] of [['north', 0, -1], ['east', 1, 0], ['south', 0, 1], ['west', -1, 0]])
    if (/passed/.test(await rcon.command(`execute if block ${x0 + b.x} ${Y + b.y} ${z0 + b.z} ${m[1]}[${d}=true]`))) dirs.push(d);
  const ns = dirs.includes('north') || dirs.includes('south');
  const ew = dirs.includes('east') || dirs.includes('west');
  const kind = dirs.length === 0 ? 'post' : ns && ew ? `cross/T(${dirs.length})` : dirs.length === 1 ? 'half' : 'straight';
  counts[kind] = (counts[kind] ?? 0) + 1;
  if (kind !== 'straight' && (samples[kind] ??= []).length < 4) {
    const nb = dirs.concat(['|']).concat([[0, -1], [1, 0], [0, 1], [-1, 0]].map(([dx, dz]) => (map.get(`${b.x + dx},${b.y},${b.z + dz}`) ?? 'air').replace('minecraft:', '').replace(/[[{].*/, '')));
    samples[kind].push(`${m[1]}@${b.x},${b.y},${b.z} conn=${nb.join(' ')}`);
  }
}
console.log(counts);
for (const [k, v] of Object.entries(samples)) for (const s of v) console.log(k, s);
rcon.close();
process.exit(0);
