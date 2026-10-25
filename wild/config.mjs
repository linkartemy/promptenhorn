// Wild mode ("Дикий") configuration: a survival colony on its own Paper server, driven by Claude Code chats.
// Defaults are for the user's installation (wild-server/ at the project root, created by wild/setup.mjs).
// Development overrides live in .dev/wild-config.json (WILD_CONFIG=... selects a file).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readProperties } from '../bridge/rcon.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Ports of the live city and the shared test server: the colony never talks to them.
export const FORBIDDEN_PORTS = new Set([25565, 25566, 25575, 25576, 7777, 7778, 7781, 7782, 7784]);

export const DEFAULTS = {
  port: 7785, // colony HTTP: POST /event (from the bridge), GET /status, GET / (status page)
  serverDir: path.join(ROOT, 'wild-server'),
  stateFile: path.join(ROOT, 'wild-state.json'),
  heartbeatFile: path.join(ROOT, '.wild-heartbeat'), // the bridge forwards events only while this is fresh
  // Colonist cap (helpers for subagents count too). Either key works here; `colonistsMax` in the town's
  // config.json (settings page, tools/tune.mjs) is used when wild-config.json sets neither. Re-read live.
  maxColonists: 3,
  reserveFreeMB: 1200, // never spawn a bot when free RAM would drop below this
  perBotMB: 160, // estimated cost per bot (node + server side)
  helperColonists: true, // a subagent brings a temporary helper when the pool allows
  activeMinutes: 4, // a chat with an event in the last N minutes works; after that its colonist stays home
  leaveAfterMinutes: 30, // idle this long -> the colonist goes to sleep in the tavern (disconnects)
  botViewDistance: 4, // chunks; bots only need their surroundings
  worldBorder: 640, // diameter around the colony
  creditMultiplier: 1, // sale prices × this (tuning knob for the economy)
  chatCooldownSec: 4, // global minimum between two colony chat lines
  colonistCooldownSec: 15, // per colonist (urgent lines — help, creeper, death — skip it)
  projects: ['cabin', 'cabin', 'cabin', 'cabin', 'cabin', 'cabin'], // what the colony builds, in order (one per plot; wild/houses.mjs)
  buildBatch: 40, // blocks bought and carried per trip
  builderSpeed: 1, // multiplier on per-block pauses during construction
  seedSite: null, // [x, z] to found the colony near (default: search plains/forest near spawn)
  dev: false,
};

export function loadConfig() {
  const file = process.env.WILD_CONFIG || path.join(ROOT, 'wild-config.json');
  let user = {};
  if (fs.existsSync(file)) user = JSON.parse(fs.readFileSync(file, 'utf8'));
  const cfg = { ...DEFAULTS, ...user, configFile: file, userConfig: user };
  for (const k of ['serverDir', 'stateFile', 'heartbeatFile']) cfg[k] = path.resolve(ROOT, cfg[k]);
  const propsFile = path.join(cfg.serverDir, 'server.properties');
  if (!fs.existsSync(propsFile)) throw new Error(`No wild server at ${cfg.serverDir}. Run: node wild/setup.mjs`);
  const props = readProperties(fs.readFileSync(propsFile, 'utf8'));
  cfg.mcHost = '127.0.0.1';
  cfg.mcPort = Number(props['server-port']);
  cfg.rconPort = Number(props['rcon.port']);
  cfg.rconPassword = props['rcon.password'];
  if (FORBIDDEN_PORTS.has(cfg.mcPort) || FORBIDDEN_PORTS.has(cfg.rconPort) || FORBIDDEN_PORTS.has(cfg.port)) {
    throw new Error(`Refusing to start: port ${cfg.mcPort}/${cfg.rconPort}/${cfg.port} belongs to the city or the shared test server`);
  }
  if (props['enable-rcon'] !== 'true') throw new Error('enable-rcon=true is required in the wild server.properties');
  return cfg;
}
