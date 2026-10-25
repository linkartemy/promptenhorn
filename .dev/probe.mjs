import fs from 'node:fs';
import { Rcon } from '../bridge/rcon.mjs';
const props = fs.readFileSync(new URL('./test-server/server.properties', import.meta.url), 'utf8');
const rcon = new Rcon({ port: 25576, password: props.match(/^rcon\.password=(.*)$/m)[1].trim() });
await rcon.connect();
for (const c of process.argv.slice(2)) console.log(c, '=>', await rcon.command(c));
rcon.close(); process.exit(0);
