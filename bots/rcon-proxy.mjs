// Dev: a switchable TCP proxy in front of the TEST server's RCON, to test the offline builder engine
// without stopping the shared server. "up" forwards 127.0.0.1:<listen> to the test server's RCON port;
// "down" closes the listener and cuts every connection (to the bridge it looks like the server stopped).
//   node bots/rcon-proxy.mjs [--listen 25579] [--target 25576] [--state .dev/rcon-proxy.state]
// controlled over the state file ("up" / "down" / "quit"), checked every 500 ms. Works for the game port too
// (plain TCP), which lets bots see a "server restart".
import net from 'node:net';
import fs from 'node:fs';

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(`--${k}`) ? Number(args[args.indexOf(`--${k}`) + 1]) : d);
const LISTEN = opt('listen', 25579);
const TARGET = opt('target', 25576);
if ([25565, 25575].includes(LISTEN) || [25565, 25575].includes(TARGET)) throw new Error('never the live server');
const STATE = args.includes('--state') ? args[args.indexOf('--state') + 1] : '.dev/rcon-proxy.state';
let server = null;
const sockets = new Set();

function up() {
  if (server) return;
  server = net.createServer((client) => {
    const upstream = net.connect(TARGET, '127.0.0.1');
    sockets.add(client).add(upstream);
    const end = () => {
      client.destroy();
      upstream.destroy();
      sockets.delete(client);
      sockets.delete(upstream);
    };
    client.pipe(upstream).pipe(client);
    client.on('error', end).on('close', end);
    upstream.on('error', end).on('close', end);
  });
  server.listen(LISTEN, '127.0.0.1', () => console.log(new Date().toLocaleTimeString(), `up: ${LISTEN} -> ${TARGET}`));
}
function down() {
  if (!server) return;
  server.close();
  server = null;
  for (const s of sockets) s.destroy();
  sockets.clear();
  console.log(new Date().toLocaleTimeString(), 'down');
}

let last = null;
setInterval(() => {
  let want = null;
  try {
    want = fs.readFileSync(STATE, 'utf8').trim();
  } catch {}
  if (want && want !== last) {
    last = want;
    if (want === 'up') up();
    else if (want === 'down') down();
    else if (want === 'quit') process.exit(0);
  }
}, 500);
if (!fs.existsSync(STATE)) fs.writeFileSync(STATE, 'up');
