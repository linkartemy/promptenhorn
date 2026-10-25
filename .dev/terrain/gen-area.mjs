// Dev helper (terrain agent): force-generate an area of the shared test server so the region files can be scanned.
// node .dev/terrain/gen-area.mjs x1 z1 x2 z2
import fs from 'node:fs';
import { Rcon } from '../../bridge/rcon.mjs';
const [x1, z1, x2, z2] = process.argv.slice(2).map(Number);
const pw = fs.readFileSync('.dev/test-server/server.properties', 'utf8').match(/rcon.password=(.*)/)[1].trim();
const r = new Rcon({ port: 25576, password: pw });
await r.connect();
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const step = 160; // 10x10 chunks per batch
for (let x = x1; x <= x2; x += step)
  for (let z = z1; z <= z2; z += step) {
    const bx2 = Math.min(x + step - 1, x2), bz2 = Math.min(z + step - 1, z2);
    console.log('forceload', x, z, bx2, bz2, (await r.command(`forceload add ${x} ${z} ${bx2} ${bz2}`)).slice(0, 80));
    for (let i = 0; i < 120; i++) {
      const a = await r.command(`execute if loaded ${x} 0 ${z} if loaded ${bx2} 0 ${bz2} if loaded ${x} 0 ${bz2} if loaded ${bx2} 0 ${z}`);
      if (a.includes('passed')) break;
      await sleep(500);
    }
    await r.command(`forceload remove ${x} ${z} ${bx2} ${bz2}`);
  }
console.log(await r.command('save-all flush'));
r.close();
