// Dev: validate every block state emitted by bridge/infra.mjs (all records of both test towns) and by the
// adaptive lot preparation / seams (commands of a sample of lots) against the vanilla block report.
import fs from 'node:fs';
import { infraList } from '../../bridge/infra.mjs';
import { TerrainPlanner } from '../../bridge/terrain.mjs';
const blocks = JSON.parse(fs.readFileSync('.dev/out/reports/blocks.json', 'utf8'));
const problems = new Map();
function check(block, where) {
  const m = block.replace(/^minecraft:/, '').match(/^([^[{]+)(?:\[([^\]]*)\])?(\{.*\})?$/);
  if (!m) return problems.set(block, `unparseable (${where})`);
  const def = blocks['minecraft:' + m[1]];
  if (!def) return problems.set(block, `unknown block ${m[1]} (${where})`);
  for (const kv of (m[2] ?? '').split(',').filter(Boolean)) {
    const [k, v] = kv.split('=');
    if (!def.properties?.[k]) problems.set(block, `${m[1]} has no property ${k} (${where})`);
    else if (!def.properties[k].includes(v)) problems.set(block, `${m[1]}.${k}=${v} (${where})`);
  }
}
let n = 0;
for (const f of ['.dev/test-state-terrain.json', '.dev/test-state-terrain2.json']) {
  const s = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const r of Object.values(s.terrain?.infra ?? {})) for (const b of infraList(r)) if (b.block) { check(b.block, r.type); n++; }
}
// Lot preparation commands: block ids after fill/setblock coordinates.
const planner = new TerrainPlanner({ cmd: async () => '', log: () => {}, chunks: null, worldDir: '.dev/test-server/world' });
planner.setOrigin(-1030, 39100);
planner.cover([[-4, -4], [4, 4]], 0);
for (const c of planner.cells.values()) {
  const p = planner.lotPlan([c.i, c.j]);
  if (!p) continue;
  for (const cmd of planner.adaptiveOps(planner.cellRect([c.i, c.j]), p, { street: { main: 'cobblestone', texture: [] } }).cmds) {
    const m = cmd.match(/^(?:fill(?: -?\d+){6}|setblock(?: -?\d+){3}) (\S+)/);
    if (m) { check(m[1], 'lot'); n++; }
  }
}
console.log(`${n} block strings checked, ${problems.size} problems`);
for (const [b, why] of problems) console.log(' ', why, b.slice(0, 120));
