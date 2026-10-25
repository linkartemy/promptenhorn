// Debug: run the connection pass offline on a copy of the test state and write it to .dev/terrain/conn-state.json.
import fs from 'node:fs';
import { TerrainPlanner } from '../../bridge/terrain.mjs';
import { planAfterPlot, terrainState } from '../../bridge/infra.mjs';
const state = JSON.parse(fs.readFileSync('.dev/test-state-terrain.json', 'utf8'));
const planner = new TerrainPlanner({ cmd: async () => '', log: () => {}, chunks: null, worldDir: '.dev/test-server/world' });
planner.setOrigin(state.city.cx, state.city.cz);
planner.cover(Object.values(state.plots).map((p) => p.cell), 3);
const before = Object.keys(terrainState(state).infra).length;
for (let k = 0; k < 6; k++) planAfterPlot({ planner, state, on: (id) => id !== 'waterfront', log: console.log }, Object.values(state.plots)[0]);
const T = terrainState(state);
for (const r of Object.values(T.infra).slice(before)) console.log(r.type, r.cell, r.params.kind ?? '', 'blocks', r.total, 'rect', JSON.stringify(r.rect), r.params.deckY ?? '', r.params.span ?? '');
fs.writeFileSync('.dev/terrain/conn-state.json', JSON.stringify(state));
