// Shared helpers for the bot spike. Talks ONLY to the experimental wild server (.dev/wild-server).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mineflayer from 'mineflayer';
import { Rcon } from '../bridge/rcon.mjs'; // read-only import of the project's RCON client

const here = path.dirname(fileURLToPath(import.meta.url));
export const WILD_DIR = path.resolve(here, '..', '.dev', 'wild-server');

const FORBIDDEN_PORTS = new Set([25565, 25566, 25575, 25576, 7777, 7778]);

function readProps(file) {
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^([^#=][^=]*)=(.*)$/.exec(line);
    if (m) out[m[1].trim()] = m[2].trim();
  }
  return out;
}

export const props = readProps(path.join(WILD_DIR, 'server.properties'));
export const HOST = '127.0.0.1';
export const PORT = Number(props['server-port']);
export const RCON_PORT = Number(props['rcon.port']);
if (FORBIDDEN_PORTS.has(PORT) || FORBIDDEN_PORTS.has(RCON_PORT)) {
  throw new Error(`Refusing to connect: port ${PORT}/${RCON_PORT} belongs to the live or test server`);
}

export async function rcon() {
  const r = new Rcon({ host: HOST, port: RCON_PORT, password: props['rcon.password'] });
  await r.connect();
  return r;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Creates a bot and resolves once it has spawned. */
export function makeBot(username, extra = {}) {
  return new Promise((resolve, reject) => {
    const bot = mineflayer.createBot({ host: HOST, port: PORT, username, auth: 'offline', version: '1.21.11', ...extra });
    const t = setTimeout(() => reject(new Error(`${username}: spawn timeout`)), 60000);
    bot.once('spawn', () => {
      clearTimeout(t);
      resolve(bot);
    });
    bot.once('kicked', (r) => reject(new Error(`${username} kicked: ${JSON.stringify(r)}`)));
    bot.once('error', reject);
  });
}

/** Parses "minecraft:oak_stairs[facing=east,half=bottom]{nbt}" -> { name, props, nbt }. */
export function parseBlock(s) {
  const m = /^(?:minecraft:)?([a-z0-9_]+)(?:\[([^\]]*)\])?(\{.*\})?$/.exec(s);
  if (!m) return { name: s, props: {}, nbt: '' };
  const props = {};
  if (m[2]) for (const kv of m[2].split(',')) {
    const [k, v] = kv.split('=');
    props[k] = v;
  }
  return { name: m[1], props, nbt: m[3] ?? '' };
}

/** Item that places a given block (mirrors bridge.mjs itemFor). */
export function itemFor(name) {
  if (name.startsWith('potted_')) return 'flower_pot';
  if (name === 'water_cauldron') return 'cauldron';
  if (name === 'water') return 'water_bucket';
  return name.replace('_wall_banner', '_banner').replace('wall_torch', 'torch').replace('_wall_hanging_sign', '_hanging_sign').replace('_wall_sign', '_sign');
}

export function log(...a) {
  console.log(new Date().toISOString().slice(11, 19), ...a);
}
