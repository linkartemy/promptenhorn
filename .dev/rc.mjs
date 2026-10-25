import fs from 'node:fs';
import { Rcon } from '../bridge/rcon.mjs';
const pw = fs.readFileSync('.dev/test-server/server.properties', 'utf8').match(/rcon.password=(.*)/)[1].trim();
const r = new Rcon({ port: 25576, password: pw }); await r.connect();
for (const c of process.argv.slice(2)) console.log('>', c, '\n ', (await r.command(c)).slice(0, 200));
r.close();
