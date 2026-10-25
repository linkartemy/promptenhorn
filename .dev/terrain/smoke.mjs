// Offline smoke test of the terrain planner + infra builders on the scanned test world (no RCON).
import { TerrainPlanner } from '../../bridge/terrain.mjs';
import { laneWalk, infraList, planAfterPlot, terrainState } from '../../bridge/infra.mjs';
const [cx, cz] = (process.argv[2] ?? '-960,38950').split(',').map(Number);
const planner = new TerrainPlanner({ cmd: async () => '', log: console.log, chunks: null, worldDir: '.dev/test-server/world' });
planner.setOrigin(cx, cz);
const t0 = Date.now();
planner.cover([[-6, -6], [6, 6]], 1);
console.log('cover ms', Date.now() - t0, 'cells', planner.cells.size);
const modes = {};
let n = 0, cut = 0, fill = 0, wall = 0, cmds = 0;
for (let i = -5; i <= 5; i++) for (let j = -5; j <= 5; j++) {
  const p = planner.lotPlan([i, j]);
  const c = planner.cell([i, j]);
  const k = p ? p.mode : 'none:' + c?.cls;
  modes[k] = (modes[k] ?? 0) + 1;
  if (p) {
    const { stats } = planner.adaptiveOps(planner.cellRect([i, j]), p, { street: { main: 'cobblestone', texture: [] }, seed: `${i},${j}` });
    n++; cut += stats.cut; fill += stats.fill; wall += stats.wall; cmds += stats.cmds;
  }
}
console.log(modes);
console.log({ n, cut, fill, wall, cmdsPerLot: (cmds / n).toFixed(0) });
for (const [a, b] of [[64, 64], [64, 70], [64, 78], [64, 90], [64, 105]]) {
  const w = laneWalk(a, b);
  console.log(`lane ${a}->${b}:`, w ? `${w.length} pts, v=${[...new Set(w.map((p) => p.v))]}` : 'null');
}
// simulated plot + infra planning
const state = { city: { cx, cz, name: 'T' }, plots: {}, cells: {} };
let made = 0;
for (let i = -5; i <= 5; i++) for (let j = -5; j <= 5; j++) {
  const p = planner.lotPlan([i, j]);
  if (!p || planner.houseCost([i, j]) === Infinity) continue;
  const key = `${i},${j}`;
  const plot = { key, cell: [i, j], y: p.y, done: true, terrain: { mode: p.mode } };
  state.plots[key] = plot; state.cells[key] = key;
  made += planAfterPlot({ planner, state, on: () => true, log: () => {} }, plot).length;
}
const T = terrainState(state);
const types = {};
for (const r of Object.values(T.infra)) types[r.type] = (types[r.type] ?? 0) + 1;
console.log('plots', Object.keys(state.plots).length, 'infra', types);
for (const r of Object.values(T.infra).slice(0, 50)) {
  const list = infraList(r);
  if (list.some((b) => !b.cmd && (b.y < -64 || b.y > 320 || !Number.isFinite(b.x)))) console.log('BAD', r.type, r.id);
}
