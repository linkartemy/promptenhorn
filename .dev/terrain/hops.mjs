// Debug: which crossings (bridge / stair lane) could each district take right now?
import { TerrainPlanner } from '../../bridge/terrain.mjs';
import { parseCell, cellKey } from '../../bridge/city.mjs';
const state = JSON.parse((await import('node:fs')).readFileSync('.dev/test-state-terrain.json', 'utf8'));
const planner = new TerrainPlanner({ cmd: async () => '', log: () => {}, chunks: null, worldDir: '.dev/test-server/world' });
planner.setOrigin(state.city.cx, state.city.cz);
planner.cover(Object.values(state.plots).map((p) => p.cell), 3);
const T = state.terrain;
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const free = (c) => !state.cells[cellKey(c)] && !T.reserved[cellKey(c)];
const stats = {};
for (const d of Object.values(state.districts)) {
  let open = 0;
  const hops = [];
  for (const [i, j] of d.cells.map(parseCell)) for (const [a, b] of N4) {
    const n = [i + a, j + b];
    if (!free(n)) continue;
    const c = planner.cell(n);
    const k = planner.houseCost(n);
    if (Number.isFinite(k)) { open++; continue; }
    const h = planner.hop(n);
    stats[c?.cls] = (stats[c?.cls] ?? 0) + 1;
    if (!h) continue;
    const m = [i + 2 * a, j + 2 * b];
    hops.push(`${h} via ${n} -> ${m} ${free(m) ? 'free' : 'taken'} cost ${planner.houseCost(m)} (${planner.cell(m)?.cls})`);
  }
  console.log(d.name, 'open', open, '\n  ' + hops.join('\n  '));
}
console.log('blocked neighbour classes', stats);
