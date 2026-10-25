// Dev: find river crossings in a scanned area and (with --build) build one bridge of the given kind via RCON.
// node .dev/terrain/bridgetest.mjs <cx>,<cz> [--build arch|viaduct|any] [--pick N]
import fs from 'node:fs';
import { TerrainPlanner } from '../../bridge/terrain.mjs';
import { _test, infraList } from '../../bridge/infra.mjs';
import { Rcon } from '../../bridge/rcon.mjs';
const [cx, cz] = process.argv[2].split(',').map(Number);
const want = process.argv.includes('--build') ? process.argv[process.argv.indexOf('--build') + 1] : null;
const pick = process.argv.includes('--pick') ? Number(process.argv[process.argv.indexOf('--pick') + 1]) : 0;
const planner = new TerrainPlanner({ cmd: async () => '', log: () => {}, chunks: null, worldDir: '.dev/test-server/world' });
planner.setOrigin(cx, cz);
planner.cover([[-6, -6], [6, 6]], 0);
const found = [];
for (const c of planner.cells.values()) {
  if (c.cls !== 'river_crossing') continue;
  for (const [a, b] of [[1, 0], [0, 1]]) {
    const A = [c.i - a, c.j - b], B = [c.i + a, c.j + b];
    const pa = planner.lotPlan(A), pb = planner.lotPlan(B);
    if (!pa || !pb) continue;
    const p = _test.bridgeParams(planner, [c.i, c.j], { key: A.join(), cell: A, y: pa.y }, { key: B.join(), cell: B, y: pb.y });
    if (p) found.push({ c, p });
  }
}
for (const [k, f] of found.entries()) console.log(k, f.p.kind, 'cell', f.c.i, f.c.j, 'span', f.p.span, 'deck', f.p.deckY, 'water', f.p.waterY, 'relief', f.c.relief);
const chosen = found.filter((f) => !want || want === 'any' || f.p.kind === want)[pick];
if (want && chosen) {
  const rec = { id: `test-${chosen.p.kind}`, type: 'bridge', seed: 'bridgetest', params: chosen.p };
  const list = infraList(rec);
  const pw = fs.readFileSync('.dev/test-server/server.properties', 'utf8').match(/rcon.password=(.*)/)[1].trim();
  const r = new Rcon({ port: 25576, password: pw });
  await r.connect();
  const R = chosen.p.rect;
  await r.command(`forceload add ${R.x1 - 2} ${R.z1 - 2} ${R.x2 + 2} ${R.z2 + 2}`);
  await new Promise((res) => setTimeout(res, 3000));
  let ok = 0, bad = 0;
  for (const b of list) {
    const out = b.cmd ? await r.command(b.cmd) : await r.command(`setblock ${b.x} ${b.y} ${b.z} ${b.block}`);
    if (/Changed|Summoned|Could not set/.test(out)) ok++; else { bad++; if (bad < 5) console.log('!', out.slice(0, 120), b.block); }
  }
  await r.command(`forceload remove ${R.x1 - 2} ${R.z1 - 2} ${R.x2 + 2} ${R.z2 + 2}`);
  console.log(`built ${chosen.p.kind} at ${JSON.stringify(R)}: ${ok} ok, ${bad} errors`);
  r.close();
}
