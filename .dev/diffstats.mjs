// Diff statistics between two archived generator versions for the plots of a test state (dev only).
import fs from 'node:fs';
import path from 'node:path';
import { Generators, stagedList } from '../bridge/generators.mjs';
import { diffLists } from '../bridge/renovate.mjs';
const [stateFile, from, to] = process.argv.slice(2);
const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
const gens = new Generators({ sourceDir: path.resolve('bridge'), archiveDir: path.resolve('.dev/test-archive'), log: () => {}, archive: false });
await gens.init();
const a = await gens.load(from), b = await gens.load(to);
for (const p of Object.values(state.plots)) {
  if (!p.done) continue;
  const o = stagedList(a, p, { size: 21 }), n = stagedList(b, p, { size: 21 });
  const d = diffLists(o, n);
  console.log(`${p.key} ${p.type}: old ${o.length}, new ${n.length}, untouched ${d.same.size}, removed ${d.remove.length}, placed ${d.place.length}, ops ${d.remove.length + d.place.length}`);
}
