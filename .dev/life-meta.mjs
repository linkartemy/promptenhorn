// Life agent: prints plotmeta + generator markers of a test plot (world coordinates).
// Usage: node .dev/life-meta.mjs <plotKey> [stateFile]
import fs from 'node:fs';
import * as B from '../bridge/buildings.mjs';
import { rngFrom } from '../bridge/blueprint.mjs';
import { stagedList } from '../bridge/generators.mjs';
import { plotMeta } from '../bridge/plotmeta.mjs';
const [key, file = '.dev/test-state-life.json'] = process.argv.slice(2);
const st = JSON.parse(fs.readFileSync(file, 'utf8'));
const p = st.plots[key];
const mod = { B, rngFrom };
const list = stagedList(mod, p, { size: 21 });
const m = plotMeta(list);
const w = (o) => [p.x0 + o.x, p.y + o.y, p.z0 + o.z];
console.log(p.type, 'stage', p.stage, 'turns', p.turns, 'origin', p.x0, p.y, p.z0, 'done', p.done);
console.log('banners', m.banners.map((b) => [...w(b), b.block].join(' ')));
console.log('doors', m.doors.map((d) => [...w(d), d.dir].join(' ')), 'lectern', m.lectern && w(m.lectern), m.lectern?.facing);
console.log('bells', m.bells.map(w), 'clockFaces', m.clockFaces.map((d) => [...w(d), d.normal].join(' ')));
let bp;
if (p.type === 'plaza') bp = B.plaza(rngFrom(p.seed));
else if (p.type === 'square') bp = B.square(rngFrom(p.seed));
else if (B.BUILDINGS[p.type]) bp = B.generate(p.type, p.seed, { stage: p.stage });
if (bp?.toMarkerList) {
  const ms = bp.toMarkerList({ turns: p.turns, size: 21, offset: 2, clipMin: 0, clipMax: 20 });
  const by = {};
  for (const mk of ms) (by[mk.kind] ??= []).push(`${w(mk).join(',')}${mk.facing ? ' ' + mk.facing : ''}${mk.data ? ' ' + JSON.stringify(mk.data) : ''}`);
  for (const [k, v] of Object.entries(by)) console.log('marker', k, v.length, v.slice(0, 8).join(' | '));
}
