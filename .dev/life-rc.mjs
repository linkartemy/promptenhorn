// Life agent's RCON helper for the shared test server (full output, one line per command).
// Usage: node .dev/life-rc.mjs "cmd1" "cmd2" ...
import fs from 'node:fs';
import { Rcon } from '../bridge/rcon.mjs';
const pw = fs.readFileSync(new URL('./test-server/server.properties', import.meta.url), 'utf8').match(/rcon.password=(.*)/)[1].trim();
const r = new Rcon({ port: 25576, password: pw });
await r.connect();
for (const c of process.argv.slice(2)) console.log('>', c, '\n ', await r.command(c));
r.close();
