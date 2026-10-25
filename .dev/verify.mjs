// Verifies, block by block, that what stands in the TEST world matches what the test bridge's state says
// should be there (plots at their generator version + stage, small forms, trees). Dev only.
// Usage: node .dev/verify.mjs [plot key | obj:id | all] [--current]   (--current: compare against the
// current generators instead of each plot's recorded version)
import fs from 'node:fs';
import path from 'node:path';
import { Rcon } from '../bridge/rcon.mjs';
import { Generators, stagedList } from '../bridge/generators.mjs';
import { formList, summitList } from '../bridge/smallforms.mjs';

const cfg = JSON.parse(fs.readFileSync('.dev/test-config.json', 'utf8'));
const state = JSON.parse(fs.readFileSync(cfg.stateFile, 'utf8'));
const props = fs.readFileSync(path.join(cfg.serverDir, 'server.properties'), 'utf8');
const rcon = new Rcon({ port: Number(props.match(/rcon\.port=(\d+)/)[1]), password: props.match(/rcon\.password=(.*)/)[1].trim() });
await rcon.connect();
const cmd = (c) => rcon.command(c);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gens = new Generators({ sourceDir: path.resolve('bridge'), archiveDir: cfg.archiveDir, log: () => {}, archive: false });
await gens.init();
const [which = 'all'] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const current = process.argv.includes('--current');

async function check(label, list, rect) {
  await cmd(`forceload add ${rect[0]} ${rect[1]} ${rect[2]} ${rect[3]}`);
  for (let i = 0; i < 40; i++) {
    if ((await cmd(`execute if loaded ${rect[0]} 64 ${rect[1]}`)).includes('passed') && (await cmd(`execute if loaded ${rect[2]} 64 ${rect[3]}`)).includes('passed')) break;
    await sleep(250);
  }
  const bad = [];
  for (const b of list) {
    const out = await cmd(`execute if block ${b.x} ${b.y} ${b.z} ${b.block}`);
    if (!out.includes('passed')) bad.push(b);
  }
  await cmd(`forceload remove ${rect[0]} ${rect[1]} ${rect[2]} ${rect[3]}`);
  console.log(`${label}: ${list.length} blocks, ${bad.length} mismatches`);
  for (const b of bad.slice(0, Number(process.env.SHOW ?? 6))) console.log(`   ${b.x} ${b.y} ${b.z} want ${b.block.slice(0, 110)}`);
  return bad.length;
}

let total = 0;
for (const p of Object.values(state.plots)) {
  if (which !== 'all' && which !== p.key) continue;
  const mod = await gens.load(current ? gens.current : p.gen);
  if (!mod) {
    console.log(`${p.key}: generator ${p.gen} not archived`);
    continue;
  }
  const local = stagedList(mod, p, { size: 21 });
  const n = p.done ? local.length : p.skip ? 0 : p.placed; // half-built after a migration: skip the check
  const list = local.slice(0, n).map((b) => ({ ...b, x: p.x0 + b.x, y: p.y + b.y, z: p.z0 + b.z }));
  total += await check(`plot ${p.key} ${p.type}${p.stage ? ` s${p.stage}` : ''} @${p.gen}${p.done ? '' : ` (${p.placed}/${p.total})`}`, list, [p.x0, p.z0, p.x0 + 20, p.z0 + 20]);
}
for (const o of Object.values(state.objects ?? {})) {
  if (which !== 'all' && which !== `obj:${o.id}`) continue;
  const local = o.type === 'summit' ? summitList() : formList(o.type, o.seed, o.turns);
  const list = local.slice(0, o.done ? local.length : o.placed).map((b) => ({ ...b, x: o.x0 + b.x, y: o.y0 + b.y, z: o.z0 + b.z }));
  total += await check(`obj ${o.id} ${o.type}`, list, [o.x0, o.z0, o.x0 + 5, o.z0 + 5]);
}
console.log(`total mismatches: ${total}`);
rcon.close();
process.exit(0);
