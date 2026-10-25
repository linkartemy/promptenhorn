import fs from 'node:fs';
import { TerrainPlanner } from '../../bridge/terrain.mjs';
import { harbourSites } from '../../bridge/terrain-scan.mjs';
import { frame } from '../../bridge/infra.mjs';
const [stateFile, world] = process.argv.slice(2);
const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
const planner = new TerrainPlanner({ cmd: async () => '', log: () => {}, chunks: null, worldDir: world });
planner.setOrigin(state.city.cx, state.city.cz);
planner.cover(Object.values(state.plots).map((p) => p.cell), 3);
const town = Object.values(state.plots).map((p) => p.cell);
const cheb = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
for (const site of harbourSites(planner.cells, { count: 10, spacing: 3 })) {
  const near = town.some((t) => cheb(t, [site.i, site.j]) <= 2);
  const out = [];
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const n = planner.cell([site.i + dx, site.j + dz]);
    if (!n || n.cls !== 'water') continue;
    const from = dx === 1 ? 'W' : dx === -1 ? 'E' : dz === 1 ? 'N' : 'S';
    const f = frame(planner.cellRect([n.i, n.j]), from);
    const body = planner.bodyAt(...f.at(10, 10));
    let wet = 0, mouth = 0, dry = 0;
    for (let u = 0; u <= 20; u++) for (let v = 0; v <= 20; v++) if (planner.col(...f.at(u, v))?.wet) wet++;
    for (let u = 12; u <= 20; u++) for (let v = 15; v <= 20; v++) if (planner.col(...f.at(u, v))?.wet) mouth++;
    for (let u = 0; u <= 14; u++) if (!planner.col(...f.at(u, 1))?.wet) dry++;
    out.push(`${from}: ${n.waterType} wet ${wet} body ${body?.type}/${body?.area} mouth ${mouth}/54 dry ${dry}`);
  }
  console.log(`[${site.i},${site.j}] near ${near}: ${out.join(' | ')}`);
}
