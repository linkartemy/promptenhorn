// Creates the wild-mode server in wild-server/ (next to server/): copies Paper and its libraries from
// server/ (read-only; the city server is not touched and may keep running), writes its own
// server.properties (127.0.0.1:25567, RCON 25577 with a new random password, survival, normal difficulty),
// accepts the EULA the same way server/ did, and adds a start script. Safe to run again: existing files
// and the world are kept unless --force is given for server.properties. Also writes an empty
// wild-config.json. Everything it creates is git-ignored (world, RCON password, colony state).
//
//   node wild/setup.mjs [--port 25567] [--rcon-port 25577] [--force]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT, FORBIDDEN_PORTS } from './config.mjs';
import { t, setLanguage } from '../bridge/i18n.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const port = Number(opt('port', 25567));
const rconPort = Number(opt('rcon-port', 25577));
const force = args.includes('--force');
if (FORBIDDEN_PORTS.has(port) || FORBIDDEN_PORTS.has(rconPort)) throw new Error(`port ${port}/${rconPort} is used by the city or the test server`);

const src = path.join(ROOT, 'server');
const dst = path.join(ROOT, 'wild-server');
if (!fs.existsSync(path.join(src, 'paper.jar'))) throw new Error(`${src}/paper.jar not found: set up the city server first`);
fs.mkdirSync(dst, { recursive: true });

// jars and caches only — never the city world, its ops, whitelist or properties
for (const item of ['paper.jar', 'libraries', 'cache', 'versions', 'bukkit.yml', 'spigot.yml', 'commands.yml', 'help.yml', 'permissions.yml', 'version_history.json']) {
  const from = path.join(src, item);
  const to = path.join(dst, item);
  if (!fs.existsSync(from) || fs.existsSync(to)) continue;
  fs.cpSync(from, to, { recursive: true });
  console.log(`copied ${item}`);
}
const eula = path.join(src, 'eula.txt');
if (fs.existsSync(eula) && !fs.existsSync(path.join(dst, 'eula.txt'))) fs.copyFileSync(eula, path.join(dst, 'eula.txt'));

const propsFile = path.join(dst, 'server.properties');
if (!fs.existsSync(propsFile) || force) {
  const password = crypto.randomBytes(18).toString('base64url');
  const props = {
    'server-ip': '127.0.0.1', 'server-port': port, 'query.port': port, 'enable-rcon': true, 'rcon.port': rconPort, 'rcon.password': password,
    'online-mode': false, 'enforce-secure-profile': false, 'gamemode': 'survival', 'difficulty': 'normal', 'spawn-monsters': true,
    'level-name': 'colony', 'level-seed': 'promptenhorn-wild', 'motd': 'Promptenhorn Wildnis', 'max-players': 16, 'view-distance': 8,
    'simulation-distance': 6, 'spawn-protection': 0, 'pause-when-empty-seconds': -1, 'allow-flight': true, 'broadcast-rcon-to-ops': false,
  };
  fs.writeFileSync(propsFile, Object.entries(props).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
  console.log(`wrote server.properties (port ${port}, RCON ${rconPort})`);
}
fs.writeFileSync(path.join(dst, 'start-server.cmd'), '@echo off\r\ncd /d "%~dp0"\r\njava -Xms512M -Xmx2G -jar paper.jar nogui\r\n');
fs.writeFileSync(path.join(dst, 'start-server.sh'), '#!/bin/sh\ncd "$(dirname "$0")"\nexec java -Xms512M -Xmx2G -jar paper.jar nogui\n');
try {
  fs.chmodSync(path.join(dst, 'start-server.sh'), 0o755);
} catch {}

// wild-config.json (optional, git-ignored): colony-only settings. The colonist cap normally comes from the
// town's config.json (colonistsMax: settings page, tools/tune.mjs); a value here overrides it.
const wildCfg = path.join(ROOT, 'wild-config.json');
if (!fs.existsSync(wildCfg)) {
  fs.writeFileSync(wildCfg, JSON.stringify({ port: 7785, spectators: [], seedSite: null }, null, 2) + '\n');
  console.log('wrote wild-config.json');
}

let language = 'en';
try {
  language = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8')).language ?? 'en';
} catch {}
setLanguage(language);
console.log(`\n${t('wild.setup.done', { dir: dst, port })}\n`);
