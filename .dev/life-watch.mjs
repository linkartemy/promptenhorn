// Life agent: polls an entity selector's Pos (and optional extra NBT path) every `ms` for `n` samples.
// Usage: node .dev/life-watch.mjs "<selector>" [n=20] [ms=300] [path]
import fs from 'node:fs';
import { Rcon } from '../bridge/rcon.mjs';
const [sel, n = 20, ms = 300, extra] = process.argv.slice(2);
const pw = fs.readFileSync(new URL('./test-server/server.properties', import.meta.url), 'utf8').match(/rcon.password=(.*)/)[1].trim();
const r = new Rcon({ port: 25576, password: pw });
await r.connect();
const t0 = Date.now();
for (let i = 0; i < Number(n); i++) {
  const out = await r.command(`data get entity ${sel} ${extra ?? 'Pos'}`);
  console.log(((Date.now() - t0) / 1000).toFixed(1), out.replace(/^.*entity data: /, ''));
  await new Promise((res) => setTimeout(res, Number(ms)));
}
r.close();
