// Runs RCON commands on the WILD server only (ports checked in config.mjs).
//   node wild/rc.mjs "time query daytime" "list"
import { Rcon } from '../bridge/rcon.mjs';
import { loadConfig } from './config.mjs';

const cfg = loadConfig();
const r = new Rcon({ host: '127.0.0.1', port: cfg.rconPort, password: cfg.rconPassword });
await r.connect();
for (const c of process.argv.slice(2)) console.log(`> ${c}\n${await r.command(c)}`);
r.close();
