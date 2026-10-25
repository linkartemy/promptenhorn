import fs from 'node:fs';
import { TerrainPlanner } from '../../bridge/terrain.mjs';
import { frame } from '../../bridge/infra.mjs';
const state = JSON.parse(fs.readFileSync('.dev/test-state-terrain.json', 'utf8'));
const planner = new TerrainPlanner({ cmd: async () => '', log: () => {}, chunks: null, worldDir: '.dev/test-server/world' });
planner.setOrigin(state.city.cx, state.city.cz);
planner.cover(Object.values(state.plots).map((p) => p.cell), 3);
for (const [a, n, b] of [['-2,0', [-3, 0], '-4,0'], ['-2,1', [-3, 1], '-4,1'], ['-2,-1', [-3, -1], '-4,-1']]) {
  const A = state.plots[a], B = state.plots[b];
  const f = frame(planner.cellRect(n), 'E');
  const row = [];
  for (let u = 0; u <= 20; u++) { const c = planner.col(...f.at(u, 10)); row.push(c ? (c.wet ? `~${c.W}/${c.G}` : c.G) : '?'); }
  console.log(a, A.y, '->', b, B.y, planner.cell(n).cls, planner.cell(n).relief, row.join(' '));
}
