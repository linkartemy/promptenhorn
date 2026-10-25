// Promptenhorn bridge: receives Claude Code hook events over HTTP and turns every chat into a
// builder constructing a Swiss city in a Minecraft server (via RCON). One project = one district.
// Optional extras (status under the name, bells for commits, night lights…) live in features/*.mjs
// and are switched on and off from the settings page (http://127.0.0.1:7777/) or configure.mjs.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Rcon, RconDisconnected, readProperties } from './rcon.mjs';
import { rngFrom } from './blueprint.mjs';
import { PLOT, Terrain, ChunkLoader, grow } from './terrain.mjs';
import { STREETS, cellKey, plotRect, districtSeed, nextCell, pickType, zoneOf, labelOf, useBuildings } from './city.mjs';
import { Generators, stagedList as stagedListOf } from './generators.mjs';
import { Renovator, diffLists } from './renovate.mjs';
import { Effects, sweepCommand } from './fx.mjs';
import { plotMeta } from './plotmeta.mjs';
import { FORMS, formList, formSize, summitList } from './smallforms.mjs';
import { Settings, readConfigFile } from './settings.mjs';
import { FEATURES, FeatureHost } from './features/index.mjs';
import { PeakSurvey } from './peaks.mjs';
import { MapPage } from './map-page.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ------------------------------------------------------------------ config

const DEFAULTS = {
  port: 7777,
  serverDir: path.join(ROOT, 'server'),
  stateFile: path.join(ROOT, 'state.json'),
  heartbeatFile: path.join(ROOT, '.alps-heartbeat'),
  generatorDir: path.join(ROOT, 'bridge'), // where the current buildings.mjs + blueprint.mjs live
  archiveDir: path.join(ROOT, 'bridge', 'archive'), // every generator version ever run (for renovation)
  cityName: 'Promptenhorn',
  blocksPerSecond: 3, // build speed while a chat is working
  toolBurst: { Edit: 10, MultiEdit: 12, Write: 12, NotebookEdit: 10, Bash: 5, Agent: 8, Task: 8, default: 3 },
  subagentBurst: 20,
  maxBlocksPerTick: 8,
  effectsPerTick: 6, // RCON commands per 250 ms tick for effects (sounds, particles, displays…)
  renovateBlocksPerSecond: 2, // renovation crew speed while any chat is working
  renovateHelperBlocksPerSecond: 3, // extra speed per idle builder of the district helping out
  maxRenovatePerTick: 6,
  houseAfterActions: 20, // chat economy: a chat earns its own house after this many tool actions…
  stageActions: [80, 200], // …and grows it to stage 2 and 3 at these totals (then it does public works)
  maxVillagersPerDistrict: 12, // finished houses beyond this get no new villager (tick load)
  villagerAI: false, // villagers stand still (NoAI): a hundred wandering villagers cost real tick time
  idleAfterMinutes: 10, // no events for this long -> builder stops working
  sleepAfterMinutes: 30, // idle this long -> builder lies down
  retireAfterHours: 72, // silent this long -> builder goes home (the house stays)
  scratchDistrictName: 'Alpweide',
  searchOrigin: [0, 0], // where to start looking for the city's valley
  resetForceloadsOnStart: true, // the world should only keep force-loads this bridge needs
  debugClockOffsetMinutes: 0, // testing only: shifts the bridge's idea of "now" (night shift, holidays, clocks)
};
const configPath = process.env.ALPS_CONFIG || path.join(ROOT, 'config.json');
const userConfig = readConfigFile(configPath);
const config = { ...DEFAULTS, ...userConfig, toolBurst: { ...DEFAULTS.toolBurst, ...userConfig.toolBurst } };
const props = readProperties(fs.readFileSync(path.join(config.serverDir, 'server.properties'), 'utf8'));

const log = (...args) => console.log(new Date().toLocaleTimeString(), ...args);

// ------------------------------------------------------------------ generators

const gens = new Generators({ sourceDir: config.generatorDir, archiveDir: config.archiveDir, log });
const { B: Buildings } = await gens.init();
useBuildings(Buildings);
log(`Generator version ${gens.current}${gens.legacy ? ` (legacy plots: ${gens.legacy})` : ''}`);

// ------------------------------------------------------------------ state

const SKINS = ['steve', 'alex', 'ari', 'efe', 'kai', 'makena', 'noor', 'sunny', 'zuri'];
const PROFESSIONS = ['mason', 'farmer', 'librarian', 'cartographer', 'shepherd', 'toolsmith', 'cleric', 'butcher', 'fletcher'];

const freshState = () => ({ version: 2, city: null, cells: {}, districts: {}, districtCount: 0, plots: {}, sessions: {} });
let state = freshState();
if (fs.existsSync(config.stateFile)) {
  const loaded = JSON.parse(fs.readFileSync(config.stateFile, 'utf8'));
  if (loaded.version === 2) state = loaded;
  else {
    fs.renameSync(config.stateFile, config.stateFile.replace(/\.json$/, '.v1.json'));
    log('Old state format found: moved aside, starting a new city. Reset the world too (delete server/world*) for a clean start.');
  }
}

/** Undo half-finished work left by a crash or Ctrl+C in the middle of a slow operation. */
function repairState() {
  for (const [key, plotKey] of Object.entries(state.cells)) {
    if (state.plots[plotKey]) continue;
    const isPendingPlaza = Object.values(state.districts).some((d) => d.pending && cellKey(d.seed) === key);
    if (isPendingPlaza) continue; // ensureDistrict() resumes it
    delete state.cells[key]; // reserved but never created
    for (const d of Object.values(state.districts)) d.cells = d.cells.filter((c) => c !== key);
  }
  for (const plot of Object.values(state.plots)) {
    if (plot.sessionId && state.sessions[plot.sessionId]?.plotKey !== plot.key) plot.sessionId = null;
    // Plots from before generator versioning were built with the legacy snapshot (archive/legacy.txt).
    if (!plot.gen) plot.gen = gens.legacy ?? gens.current;
    if (!plot.street) plot.street = STREET_VERSION;
    if (!plot.stage) plot.stage = 2; // houses from before growth stages are full houses
    if (plot.done) plot.everDone = true;
  }
  state.objects ??= {};
  for (const s of Object.values(state.sessions)) {
    if (s.plotKey && !state.plots[s.plotKey]) s.plotKey = null;
    // Sessions from before sites: the job is the house being built, the builder stands there.
    if (s.job === undefined) {
      const p = s.plotKey && state.plots[s.plotKey];
      s.job = p && !p.done ? `plot:${p.key}` : null;
      s.at = s.job;
    }
    s.pose = null;
    s.scoreKey = null;
  }
  state.totals ??= { houses: 0, commits: 0, prs: 0, pushes: 0, testsOk: 0, testsFail: 0, actions: 0, tokens: 0 };
  if (!state.totals.houses) state.totals.houses = Object.values(state.districts).reduce((n, d) => n + (d.buildingsDone ?? 0), 0);
}

let saveTimer = null;
function writeState() {
  try {
    fs.writeFileSync(config.stateFile + '.tmp', JSON.stringify(state, null, 1));
    fs.renameSync(config.stateFile + '.tmp', config.stateFile);
  } catch (err) {
    log('could not save state (will retry):', err.code ?? err.message);
    save();
  }
}
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    writeState();
  }, 1500);
}

// ------------------------------------------------------------------ RCON

const rcon = new Rcon({ host: '127.0.0.1', port: Number(props['rcon.port'] || 25575), password: props['rcon.password'] });

/** Runs a command; throws RconDisconnected when the server is unreachable, so callers never mistake that for success. */
async function cmd(command) {
  try {
    return await rcon.command(command);
  } catch (err) {
    throw err instanceof RconDisconnected ? err : new RconDisconnected(err.message);
  }
}

const chunks = new ChunkLoader(cmd);
const terrain = new Terrain(cmd, log, chunks);
const fx = new Effects(cmd, log);

// Releasing a plot's chunks right after killing its builder freezes the death animation (the chunk stays
// loaded but stops ticking), leaving a corpse that also blocks the UUID. So releases wait a few seconds,
// and holding the same owner again cancels a pending release.
const pendingRelease = new Map();
async function holdOwner(owner, r) {
  clearTimeout(pendingRelease.get(owner));
  pendingRelease.delete(owner);
  await chunks.hold(owner, r);
}
function releaseLater(owner, ms = 4000) {
  clearTimeout(pendingRelease.get(owner));
  pendingRelease.set(owner, setTimeout(() => {
    pendingRelease.delete(owner);
    chunks.release(owner).catch(() => {});
  }, ms));
}
/** Force-loads `r` for `ms` (e.g. while a temporary mob plays or a builder's death animation runs). */
async function holdArea(owner, r, ms) {
  await holdOwner(owner, r);
  releaseLater(owner, ms);
}

const snbt = (text) => JSON.stringify(String(text)); // JSON string quoting is valid SNBT
const textJson = (text, color) => `{text:${snbt(text)}${color ? `,color:"${color}"` : ''}}`;

/** Display-safe text: no control chars or § formatting codes, cut on whole characters. */
function cleanText(text, max) {
  const chars = Array.from(String(text).replace(/[\u0000-\u001f\u007f§]/g, ' ').replace(/\s+/g, ' ').trim());
  return chars.length <= max ? chars.join('') : chars.slice(0, max - 1).join('').trimEnd() + '…';
}

let everConnected = false;
let lastConnectAttempt = 0;
let connections = 0;
async function connect() {
  if (Date.now() - lastConnectAttempt < 3000) return false;
  lastConnectAttempt = Date.now();
  try {
    await rcon.connect();
    log('Connected to Minecraft server via RCON');
    connections++;
    await setupWorld(!everConnected);
    everConnected = true;
    return true;
  } catch (err) {
    if (err instanceof RconDisconnected || /ECONNREFUSED|timeout|auth/i.test(err.message)) rcon.close();
    else log('setup failed:', err.stack ?? err.message);
    rcon.close();
    return false;
  }
}

async function setupWorld(firstConnect) {
  for (const rule of ['mob_griefing false', 'fire_spread_radius_around_player 0', 'spawn_phantoms false', 'log_admin_commands false', 'spawn_monsters false']) {
    await cmd(`gamerule ${rule}`);
  }
  await cmd(`scoreboard objectives add alps dummy ${textJson(config.cityName, 'gold')}`);
  await cmd(`scoreboard objectives modify alps displayname ${textJson(config.cityName, 'gold')}`);
  await cmd('scoreboard objectives setdisplay sidebar alps');
  // Re-establish exactly the force-loads that unfinished plots need.
  await chunks.reset(config.resetForceloadsOnStart && firstConnect);
  pendingRelease.forEach(clearTimeout);
  pendingRelease.clear();
  // Each live builder keeps the chunks it stands in loaded (so it can be found and moved, never duplicated).
  for (const s of Object.values(state.sessions)) {
    s.pose = null;
    s.scoreKey = null;
    rt(s).hand = null;
    rt(s).siteHeld = null;
    const site = !s.retired && siteOf(s.at);
    if (site) {
      await chunks.hold(`builder:${s.id}`, site.rect);
      rt(s).siteHeld = site.key;
    }
  }
  fx.clear();
  renovator.reset();
  if (!config.villagerAI) await cmd('execute as @e[type=minecraft:villager,tag=alps] run data merge entity @s {NoAI:1b}');
  await features.emit('setup', firstConnect);
}

// ------------------------------------------------------------------ geometry

/** Plot-local coords (0..20) -> world x/z, honouring the plot's rotation. */
function plotToWorld(plot, lx, lz) {
  let x = lx;
  let z = lz;
  for (let i = 0; i < plot.turns; i++) [x, z] = [PLOT - 1 - z, x];
  return [plot.x0 + x, plot.z0 + z];
}

/** Rotation so the building's front faces the city centre. */
function facingTurns([i, j]) {
  if (Math.abs(i) > Math.abs(j)) return i > 0 ? 1 : 3; // east of centre -> faces west, else east
  return j > 0 ? 2 : 0; // south of centre -> faces north, else south
}

const stagedList = (mod, plot, stage) => stagedListOf(mod, plot, { size: PLOT, stage });

/** Plot-local build list with the current generators. */
function blueprintOf(plot) {
  const list = stagedList(gens.currentModule, plot);
  if (!list) throw new Error(`no generator for ${plot.type}`);
  return list;
}

/** Fingerprint of a blueprint, so a plot notices when the generators changed under a half-built house. */
function hashList(list) {
  let h = 2166136261;
  for (const b of list) {
    const s = `${b.x},${b.y},${b.z},${b.block};`;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return (h >>> 0).toString(36) + ':' + list.length;
}

const buildCache = new Map();
function buildList(plot) {
  if (!buildCache.has(plot.key)) {
    const local = blueprintOf(plot);
    buildCache.set(plot.key, {
      hash: hashList(local),
      local,
      list: local.map((b) => ({ x: plot.x0 + b.x, y: plot.y + b.y, z: plot.z0 + b.z, block: b.block })),
    });
  }
  return buildCache.get(plot.key);
}

// Metadata (bells, chimneys, light slots…) of finished plots is small and asked for often: keep it.
const metaCache = new Map();
function metaOf(plot) {
  const k = `${plot.key}:${plot.bp}`;
  if (!metaCache.has(k)) metaCache.set(k, plotMeta(buildCache.get(plot.key)?.local ?? blueprintOf(plot)));
  return metaCache.get(k);
}

// ------------------------------------------------------------------ plots

/** Plot ground: probed, then kept within ±1 of its neighbours so streets run continuously. */
async function plotGround(cell) {
  const r = plotRect(state.city, cell);
  const ground = await terrain.plotGround(r.x1 + 10, r.z1 + 10, state.city.baseY);
  let y = ground.y;
  const hs = [];
  for (let a = -1; a <= 1; a++)
    for (let b = -1; b <= 1; b++) {
      const p = (a || b) && state.plots[state.cells[cellKey([cell[0] + a, cell[1] + b])]];
      if (p) hs.push(p.y);
    }
  if (hs.length) {
    const lo = Math.max(...hs) - 1;
    const hi = Math.min(...hs) + 1;
    y = lo <= hi ? Math.min(Math.max(y, lo), hi) : Math.round((Math.max(...hs) + Math.min(...hs)) / 2);
  }
  return { y: Math.min(Math.max(y, state.city.baseY - 12), state.city.baseY + 12), top: ground.top };
}

/** The street paving of a plot: main material plus deterministic texture stones. */
function streetTexture(key, r, type, zone) {
  const rng = rngFrom(`${key}:street`);
  const street = STREETS[type === 'square' ? 'core' : zone];
  const texture = [];
  for (let n = 0; n < 50; n++) {
    const along = rng.int(0, PLOT - 1);
    const off = rng.int(0, 1);
    const [sx, sz] = rng.pick([[r.x1 + along, r.z1 + off], [r.x1 + along, r.z2 - off], [r.x1 + off, r.z1 + along], [r.x2 - off, r.z1 + along]]);
    texture.push([sx, sz, rng.pick(street.alts)]);
  }
  return { main: street.main, texture };
}

const newChron = () => ({ start: Date.now(), sessions: {} });

/** Creates a plot on a cell: picks height, terraces the ground, lays the street. Throws (after cleanup) on failure. */
async function createPlot(cell, { type, district, sessionId, seed, stage = 2, isPublic = false }) {
  const key = cellKey(cell);
  const r = plotRect(state.city, cell);
  const zone = zoneOf(cell);
  const ground = key === '0,0' ? { y: state.city.baseY, top: state.city.baseY } : await plotGround(cell);
  const plot = { key, cell, district, zone, x0: r.x1, z0: r.z1, y: ground.y, type, seed, turns: facingTurns(cell), placed: 0, done: false, sessionId, gen: gens.current, street: STREET_VERSION, stage };
  if (isPublic) plot.public = true;
  const { hash, list } = buildList(plot); // generate before touching the world: a broken generator must not leave an empty lot
  plot.bp = hash;
  plot.total = list.length;
  plot.chron = newChron();

  const obstacles = Object.values(state.plots).map((p) => plotRect(state.city, p.cell));
  const owner = `plot:${key}`;
  try {
    await chunks.hold(owner, grow(r, 8));
    await terrain.preparePlot(r, ground.y, { obstacles, street: streetTexture(key, r, type, zone), top: ground.top });
    await lampPost(plot);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = state.plots[state.cells[cellKey([cell[0] + dx, cell[1] + dz])]];
      if (n) await stitchSeam(plot, n, [dx, dz]);
    }
  } catch (err) {
    buildCache.delete(key);
    await chunks.release(owner).catch(() => {});
    throw err;
  }
  await chunks.release(owner); // the builder holds the plot from here on
  state.plots[key] = plot;
  state.cells[key] = key;
  save();
  log(`Plot ${key} (${zone}): ${type}${isPublic ? ' (public)' : ''}, ${plot.total} blocks, y=${plot.y}`);
  return plot;
}

/** Commands for a seam between two plots (see stitchSeam). */
function seamCommands(plot, neighbour, [dx, dz]) {
  const out = [];
  const diff = neighbour.y - plot.y;
  if (!diff) return out;
  const [low, high] = diff > 0 ? [plot, neighbour] : [neighbour, plot];
  const dir = diff > 0 ? [dx, dz] : [-dx, -dz]; // from the low plot towards the high one
  const h = Math.abs(diff);
  const facing = dir[0] === 1 ? 'east' : dir[0] === -1 ? 'west' : dir[1] === 1 ? 'south' : 'north';
  const rural = low.zone === 'outer' || low.zone === 'rural';
  const stairs = `${rural ? 'cobblestone' : 'stone_brick'}_stairs[facing=${facing},half=bottom]`;
  const full = rural ? 'cobblestone' : 'stone_bricks';
  // Row k of `p`'s street along the shared edge (k = 0 is the boundary row), corners excluded.
  const row = (p, k, toward) => {
    if (toward[0] === 1) return [p.x0 + PLOT - 1 - k, p.z0 + 1, p.x0 + PLOT - 1 - k, p.z0 + PLOT - 2];
    if (toward[0] === -1) return [p.x0 + k, p.z0 + 1, p.x0 + k, p.z0 + PLOT - 2];
    if (toward[1] === 1) return [p.x0 + 1, p.z0 + PLOT - 1 - k, p.x0 + PLOT - 2, p.z0 + PLOT - 1 - k];
    return [p.x0 + 1, p.z0 + k, p.x0 + PLOT - 2, p.z0 + k];
  };
  const put = ([x1, z1, x2, z2], y, block) => out.push(`fill ${x1} ${y} ${z1} ${x2} ${y} ${z2} ${block}`);
  if (h === 1) {
    put(row(low, 0, dir), low.y + 1, stairs);
    return out;
  }
  put(row(low, 0, dir), low.y + 1, full);
  put(row(low, 0, dir), low.y + 2, stairs);
  put(row(low, 1, dir), low.y + 1, stairs);
  if (h > 2) {
    const [x1, z1, x2, z2] = row(high, 0, [-dir[0], -dir[1]]);
    out.push(`fill ${x1} ${low.y + 1} ${z1} ${x2} ${high.y - 1} ${z2} stone_bricks`);
  }
  return out;
}

/**
 * Where two neighbouring plots differ in height, turn the step between their streets into stairs
 * (one or two rows on the lower street) and face anything taller with a stone retaining wall.
 */
async function stitchSeam(plot, neighbour, dir) {
  for (const c of seamCommands(plot, neighbour, dir)) await cmd(c);
}

const lampPostCommands = (plot) => [
  ...[1, 2, 3].map((h) => `setblock ${plot.x0} ${plot.y + h} ${plot.z0} spruce_fence`),
  `setblock ${plot.x0} ${plot.y + 4} ${plot.z0} lantern`,
];
async function lampPost(plot) {
  for (const c of lampPostCommands(plot)) await cmd(c);
}

// Street-level work is versioned by its own source: when this code changes, finished plots get their
// lamp post, seams and paving re-applied (idempotently) by the renovation crew.
const STREET_VERSION = (() => {
  let h = 2166136261;
  const src = [seamCommands, lampPostCommands, streetTexture, rngFrom].map(String).join('\n') + JSON.stringify(STREETS);
  for (let i = 0; i < src.length; i++) h = Math.imul(h ^ src.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
})();
repairState();

/** Idempotent street renovation: paving of the street ring (not under the house), lamp post, seams. */
function streetCommands(plot) {
  const r = plotRect(state.city, plot.cell);
  const { main, texture } = streetTexture(plot.key, r, plot.type, plot.zone);
  const local = new Set(blueprintOf(plot).filter((b) => b.y === 0).map((b) => `${b.x},${b.z}`));
  const out = [];
  const onHouse = (x, z) => local.has(`${x - plot.x0},${z - plot.z0}`);
  for (let x = r.x1; x <= r.x2; x++)
    for (let z = r.z1; z <= r.z2; z++) {
      const ring = x - r.x1 < 2 || r.x2 - x < 2 || z - r.z1 < 2 || r.z2 - z < 2;
      if (ring && !onHouse(x, z)) out.push(`setblock ${x} ${plot.y} ${z} ${main}`);
    }
  for (const [sx, sz, block] of texture) if (!onHouse(sx, sz)) out.push(`setblock ${sx} ${plot.y} ${sz} ${block}`);
  out.push(...lampPostCommands(plot));
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const n = state.plots[state.cells[cellKey([plot.cell[0] + dx, plot.cell[1] + dz])]];
    if (n) out.push(...seamCommands(plot, n, [dx, dz]));
  }
  return out;
}

/** Commands that clear a lot down to the lawn (used when a house has to be rebuilt from scratch). */
function clearCommands(plot) {
  const r = plotRect(state.city, plot.cell);
  return [
    `fill ${r.x1} ${plot.y + 1} ${r.z1} ${r.x2} ${plot.y + 40} ${r.z2} air`,
    `fill ${r.x1 + 2} ${plot.y - 1} ${r.z1 + 2} ${r.x2 - 2} ${plot.y - 1} ${r.z2 - 2} dirt`,
    `fill ${r.x1 + 2} ${plot.y} ${r.z1 + 2} ${r.x2 - 2} ${plot.y} ${r.z2 - 2} grass_block`,
    `kill @e[type=minecraft:item,x=${r.x1},y=${plot.y},z=${r.z1},dx=${PLOT},dy=48,dz=${PLOT}]`,
    ...lampPostCommands(plot),
  ];
}

/** Places a whole plot at once (city square, district plazas). Safe to repeat. */
async function buildInstantly(plot) {
  await chunks.hold(`plot:${plot.key}`, plotRect(state.city, plot.cell));
  for (const b of buildList(plot).list) await cmd(`setblock ${b.x} ${b.y} ${b.z} ${b.block}`);
  plot.placed = plot.total;
  plot.done = true;
  await chunks.release(`plot:${plot.key}`);
  buildCache.delete(plot.key);
}

/** Last resort when the old generator version is unknown: clear the lot and start the house again. */
async function restartPlot(plot) {
  log(`Blueprint of ${plot.key} changed and the old one is not archived: restarting the ${plot.type}`);
  for (const c of clearCommands(plot)) await cmd(c);
  buildCache.delete(plot.key);
  const { hash, list } = buildList(plot);
  plot.bp = hash;
  plot.gen = gens.current;
  plot.total = list.length;
  plot.placed = 0;
  delete plot.skip;
  save();
}

/**
 * Moves a plot from what is standing now (`from`: generator version, stage and how many blocks of that
 * list were placed) to the current generators at `toStage`: removes what no longer belongs and lets
 * the builder carry on with the new list, skipping blocks that are already right. Used both when the
 * generators changed under a half-built house and when a finished house grows a stage.
 * Returns false to retry next tick (chunk not loaded yet).
 */
async function migratePlot(plot, from, toStage = plot.stage) {
  const mod = await gens.load(from.gen);
  const oldList = mod && stagedList(mod, plot, from.stage);
  if (!oldList || (from.bp && hashList(oldList) !== from.bp)) {
    plot.stage = toStage;
    await restartPlot(plot);
    return true;
  }
  plot.stage = toStage;
  buildCache.delete(plot.key);
  const next = buildList(plot);
  const diff = diffLists(oldList, next.local, from.placed);
  for (const b of diff.remove) {
    const out = await cmd(`setblock ${plot.x0 + b.x} ${plot.y + b.y} ${plot.z0 + b.z} air`);
    if (out.includes('not loaded')) {
      plot.stage = from.stage; // nothing committed yet: redo the whole step next tick
      buildCache.delete(plot.key);
      return false;
    }
  }
  if (diff.remove.length) await cmd(`kill @e[type=minecraft:item,x=${plot.x0},y=${plot.y},z=${plot.z0},dx=${PLOT},dy=48,dz=${PLOT}]`);
  log(`Plot ${plot.key}: ${from.gen === gens.current ? `stage ${from.stage} -> ${toStage}` : `generators ${from.gen} -> ${gens.current}`}: removed ${diff.remove.length}, ${diff.same.size} already right, ${diff.place.length} to place`);
  plot.skip = { gen: from.gen, stage: from.stage, placed: from.placed };
  next.skip = diff.same;
  plot.gen = gens.current;
  plot.bp = next.hash;
  plot.total = next.list.length;
  plot.placed = 0;
  plot.done = false;
  save();
  return true;
}

/** Blocks of a migrated plot that are already right (recomputed after a restart). */
async function skipSet(plot, built) {
  if (!plot.skip) return null;
  if (!built.skip) {
    const mod = await gens.load(plot.skip.gen);
    const oldList = mod && stagedList(mod, plot, plot.skip.stage ?? plot.stage);
    built.skip = oldList ? diffLists(oldList, built.local, plot.skip.placed).same : new Set();
  }
  return built.skip;
}

async function nameplate(tag, plot, text, color, scale, height) {
  const [x, z] = plotToWorld(plot, 10, 10);
  await cmd(`kill @e[type=minecraft:text_display,tag=${tag}]`);
  await cmd(`summon minecraft:text_display ${x + 0.5} ${plot.y + height} ${z + 0.5} {Tags:["alps","${tag}"],billboard:"center",shadow:1b,text:${textJson(text, color)},transformation:{left_rotation:[0f,0f,0f,1f],right_rotation:[0f,0f,0f,1f],translation:[0f,0f,0f],scale:[${scale}f,${scale}f,${scale}f]}}`);
}

// ------------------------------------------------------------------ city & districts

async function ensureCity() {
  if (state.city && !state.city.pending) return state.city;
  if (!state.city) {
    await announce([{ text: 'Ищу долину для города…', color: 'gray' }]);
    const site = await terrain.findValley(config.searchOrigin);
    log(`City site: ${site.x}, ${site.z} (ground y=${site.y})`);
    state.city = { name: config.cityName, cx: site.x, cz: site.z, baseY: site.y, pending: true };
    save();
  }
  const plot = state.plots['0,0'] ?? (await createPlot([0, 0], { type: 'square', district: null, sessionId: null, seed: 'city-square' }));
  await buildInstantly(plot);
  await chunks.hold(`plot:${plot.key}`, plotRect(state.city, plot.cell));
  await nameplate('alps_name_city', plot, config.cityName, 'gold', 4, 8);
  await chunks.release(`plot:${plot.key}`);
  await cmd(`setworldspawn ${state.city.cx} ${plot.y + 1} ${state.city.cz + 7}`);
  delete state.city.pending;
  save();
  await announce([{ text: 'Основан город ' }, { text: config.cityName, color: 'gold' }], state.city.cx, plot.y + 2, state.city.cz + 7);
  return state.city;
}

function districtFor(cwd) {
  if (!cwd) return { key: 'scratch', name: config.scratchDistrictName };
  let p = cwd.replace(/\\/g, '/').replace(/\/+$/, '');
  const tmp = os.tmpdir().replace(/\\/g, '/').toLowerCase();
  if (/scratch-workspaces/i.test(p) || p.toLowerCase().startsWith(tmp)) return { key: 'scratch', name: config.scratchDistrictName };
  p = p.replace(/\/\.claude\/worktrees\/.*$/i, '').replace(/\/\.worktrees\/.*$/i, '');
  const base = cleanText(p.split('/').pop() || 'Projekt', 32);
  return { key: p.toLowerCase(), name: base.charAt(0).toUpperCase() + base.slice(1) };
}

async function ensureDistrict(key, name) {
  await ensureCity();
  let district = state.districts[key];
  if (district && !district.pending) return district;
  if (!district) {
    const seed = districtSeed(state, state.districtCount);
    district = { key, name, index: state.districtCount, seed, cells: [cellKey(seed)], buildingsStarted: 0, buildingsDone: 0, typeCounts: {}, recentTypes: [], pending: true };
    state.cells[cellKey(seed)] = cellKey(seed); // reserved; resumed by ensureDistrict() after a crash
    state.districts[key] = district;
    state.districtCount++;
  }
  const plotKey = cellKey(district.seed);
  const plot = state.plots[plotKey] ?? (await createPlot(district.seed, { type: 'plaza', district: key, sessionId: null, seed: `plaza:${key}` }));
  await buildInstantly(plot);
  await chunks.hold(`plot:${plot.key}`, plotRect(state.city, plot.cell));
  await nameplate(`alps_name_${district.index}`, plot, district.name, 'yellow', 2.5, 6);
  await chunks.release(`plot:${plot.key}`);
  delete district.pending;
  save();
  log(`District "${district.name}" founded at cell ${plotKey}`);
  await announce([{ text: 'Новый квартал: ' }, { text: district.name, color: 'yellow' }], plot.x0 + 10, plot.y + 2, plot.z0 + 10);
  features.emitSync('onDistrict', district);
  return district;
}

/** A new plot for the district. `type` forces the building (public works, parks); else the zone decides. */
async function newPlot(district, sessionId, { type: forced, stage, isPublic } = {}) {
  const cell = nextCell(state, district);
  const key = cellKey(cell);
  const seed = `${key}:${sessionId}`;
  const type = forced ?? pickType(state, district, cell, seed);
  const before = { cells: [...district.cells], started: district.buildingsStarted, counts: { ...district.typeCounts }, recent: [...district.recentTypes] };
  district.cells.push(key);
  if (type !== 'park') {
    district.buildingsStarted++;
    district.typeCounts[type] = (district.typeCounts[type] ?? 0) + 1;
    district.recentTypes = [...district.recentTypes, type].slice(-3);
  }
  state.cells[key] = key; // reserve before the slow terrain work
  try {
    return await createPlot(cell, { type, district: district.key, sessionId, seed, stage, isPublic });
  } catch (err) {
    delete state.cells[key];
    district.cells = before.cells;
    district.buildingsStarted = before.started;
    district.typeCounts = before.counts;
    district.recentTypes = before.recent;
    throw err;
  }
}

// ------------------------------------------------------------------ builders

const builderTag = (s) => `alps_b_${s.id.slice(0, 8)}`;
const holder = (s) => `b_${s.id.slice(0, 8)}`;

// Per-session runtime signals (not persisted): what the chat is doing right now.
const runtime = new Map();
function rt(s) {
  let r = runtime.get(s.id);
  if (!r) runtime.set(s.id, (r = { waiting: null, toolCat: null, compactUntil: 0, limitUntil: 0, agents: new Map(), hand: null, siteHeld: null }));
  return r;
}

/** Stable entity UUID per session and site: the game refuses a second entity with the same UUID, so a builder can't be duplicated. */
function builderUuid(s, plot, salt = '') {
  const ints = [];
  let h = 2166136261;
  for (let k = 0; k < 4; k++) {
    for (const ch of `${s.id}:${plot.key}:${salt}${k}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    ints.push(h | 0);
  }
  return `[I;${ints.join(',')}]`;
}

function itemFor(block) {
  let id = block.replace(/^minecraft:/, '').replace(/[[{].*$/, '');
  if (id.startsWith('potted_')) return 'minecraft:flower_pot';
  if (id === 'water') return 'minecraft:water_bucket';
  if (id === 'air') return 'minecraft:air';
  id = id.replace('_wall_banner', '_banner').replace('wall_torch', 'torch').replace('_wall_hanging_sign', '_hanging_sign').replace('_wall_sign', '_sign');
  return `minecraft:${id}`;
}

function soundFor(block) {
  if (/glass|pane/.test(block)) return 'block.glass.place';
  if (/stone|brick|andesite|cobble|calcite|quartz|concrete|terracotta|deepslate|tile/.test(block)) return 'block.stone.place';
  if (/copper/.test(block)) return 'block.copper.place';
  if (/leaves|azalea|grass|flower|tulip|poppy|hay|wool|carpet/.test(block)) return 'block.grass.place';
  return 'block.wood.place';
}

// ------------------------------------------------------------------ sites
//
// A site is whatever a builder is working on: its house (or a public building) on a plot, or a small
// object — a bench, tree or fountain on a plaza or park, a fir on the slopes, the summit viewpoint.
// Sites are addressed by key ("plot:3,-2", "obj:17"); `session.job` holds the current one.

const objCache = new Map();
function objList(o) {
  if (!objCache.has(o.id)) {
    const local = o.type === 'summit' ? summitList() : formList(o.type, o.seed, o.turns);
    objCache.set(o.id, { local, list: local.map((b) => ({ x: o.x0 + b.x, y: o.y0 + b.y, z: o.z0 + b.z, block: b.block })) });
  }
  return objCache.get(o.id);
}
const objLabel = (o) => (o.type === 'summit' ? 'Смотровая на вершине' : FORMS[o.type]?.label ?? o.type);

function siteOf(key) {
  if (!key) return null;
  if (key.startsWith('plot:')) {
    const plot = state.plots[key.slice(5)];
    if (!plot) return null;
    const [fx, fz] = plotToWorld(plot, 10, 19);
    const [hx, hz] = plotToWorld(plot, 10, 10);
    return {
      key, plot, rec: plot, kind: plot.public ? 'public' : plot.type === 'park' ? 'park' : 'house',
      rect: plotRect(state.city, plot.cell), front: [fx, plot.y + 1, fz], look: [hx, hz],
      label: (plot.type === 'park' ? 'Парк' : labelOf(plot.type)) + (plot.public && plot.type !== 'park' ? ' · для квартала' : ''),
    };
  }
  const o = state.objects?.[key.slice(4)];
  if (!o) return null;
  const host = o.plotKey ? state.plots[o.plotKey] : null;
  const size = o.type === 'summit' ? 5 : formSize(o.type);
  const fx = o.x0 + Math.floor(size / 2);
  const fz = o.z0 + size + 1;
  return {
    key, obj: o, rec: o, plot: host, kind: o.kind,
    rect: host ? plotRect(state.city, host.cell) : { x1: o.x0 - 3, z1: o.z0 - 3, x2: o.x0 + size + 3, z2: o.z0 + size + 3 },
    front: [fx, o.y0 + 1, fz], look: [o.x0 + size / 2, o.z0 + size / 2],
    label: objLabel(o) + (o.public ? ' · общее' : ''),
  };
}

/** Build list (world coords) of a site plus its skip set (blocks already right). */
async function siteBuilt(site) {
  if (site.obj) return { ...objList(site.obj), skip: null };
  const built = buildList(site.plot);
  return { ...built, skip: await skipSet(site.plot, built) };
}

/** Contribution record of `s` on a site (chronicle); bounded per site. */
function contribution(rec, s) {
  rec.chron ??= newChron();
  const c = rec.chron.sessions;
  if (!c[s.id]) {
    const ids = Object.keys(c);
    if (ids.length >= 30) delete c[ids.sort((a, b) => (c[a].blocks ?? 0) - (c[b].blocks ?? 0))[0]];
    c[s.id] = { name: s.name, district: s.districtName, start: Date.now(), blocks: 0, activeSec: 0, actions: {}, commits: 0, pushes: 0, prs: 0, testsOk: 0, testsFail: 0, agents: 0 };
  }
  const e = c[s.id];
  e.name = s.name;
  if (s.model) e.model = s.model;
  e.last = Date.now();
  return e;
}

async function ensureBuilder(session, site) {
  const tag = builderTag(session);
  if ((await cmd(`execute if entity @e[tag=${tag}]`)).includes('passed')) return;
  const [wx, wy, wz] = site.front;
  const out = await cmd(`summon minecraft:mannequin ${wx + 0.5} ${wy} ${wz + 0.5} {UUID:${builderUuid(session, { key: site.key })},Tags:["alps","${tag}"],Invulnerable:1b,PersistenceRequired:1b,immovable:1b,hide_description:1b,CustomNameVisible:1b,CustomName:${textJson(session.name)},profile:{texture:"entity/player/wide/${session.skin}"}}`);
  await cmd(`particle minecraft:poof ${wx + 0.5} ${wy + 1} ${wz + 0.5} 0.3 0.5 0.3 0.02 20`);
  if (out.includes('Summoned')) {
    rt(session).hand = null;
    await features.emit('onBuilderSpawn', session, site);
  }
}

async function setPose(session, pose) {
  await cmd(`data merge entity @e[tag=${builderTag(session)},limit=1] {pose:"${pose}"}`);
}

/** Puts `item` in the builder's hand, unless it already holds it. */
async function setHand(session, item) {
  const r = rt(session);
  if (r.hand === item) return;
  r.hand = item;
  await cmd(`item replace entity @e[tag=${builderTag(session)},limit=1] weapon.mainhand with ${item}`);
}
const refreshHand = (session) => setHand(session, features.first('handItem', session, null) ?? 'minecraft:air');

async function moveBuilderToFront(session, site) {
  const [wx, wy, wz] = site.front;
  const [hx, hz] = site.look;
  const yaw = Math.round((Math.atan2(-(hx - wx), hz - wz) * 180) / Math.PI);
  await cmd(`tp @e[tag=${builderTag(session)},limit=1] ${wx + 0.5} ${wy} ${wz + 0.5} ${yaw} 0`);
  Object.assign(rt(session), { pos: [wx + 0.5, wy, wz + 0.5], posAt: site.key }); // for the web map
  await refreshHand(session);
}

/** The builder walks over to another site: poof here, hold the new area, appear there. */
async function moveTo(session, site) {
  const r = rt(session);
  const tag = builderTag(session);
  // session.at (persisted) is where the builder entity stands; its chunks stay loaded while it is there,
  // so it can always be found and removed before it re-appears elsewhere (no duplicate builders).
  if (session.at && session.at !== site.key) {
    const old = siteOf(session.at);
    if (old) await holdOwner(`builder:${session.id}`, old.rect);
    await features.emit('onBuilderLeave', session, old);
    await cmd(`execute at @e[tag=${tag},limit=1] run particle minecraft:poof ~ ~1 ~ 0.3 0.5 0.3 0.02 20`);
    await cmd(`kill @e[tag=${tag}]`);
    r.hand = null;
    if (old) await holdArea(`leaving:${session.id}:${old.key}`, old.rect, 4000); // let the death animation finish
  }
  await holdOwner(`builder:${session.id}`, site.rect);
  r.siteHeld = site.key;
  session.at = site.key;
  session.pose = null;
  save();
  await ensureBuilder(session, site);
}

/** Classic mode: the builder leaves a finished house (it re-appears at its next plot). */
async function sendBuilderHome(session) {
  const tag = builderTag(session);
  await cmd(`execute at @e[tag=${tag},limit=1] run particle minecraft:poof ~ ~1 ~ 0.3 0.5 0.3 0.02 20`);
  await cmd(`kill @e[tag=${tag}]`);
  rt(session).hand = null;
  rt(session).siteHeld = null;
  session.at = null;
  releaseLater(`builder:${session.id}`);
}

async function updateScore(session, site, built) {
  const rec = site?.rec;
  const pct = rec ? Math.min(100, Math.floor((100 * rec.placed) / Math.max(1, rec.total))) : 0;
  const label = site ? `${site.label} ${pct}%` : 'ищет участок';
  const color = String(session.pose).includes('sleeping') ? 'gray' : session.active ? 'green' : 'yellow';
  const key = `${label}|${session.name}|${color}`;
  if (session.scoreKey === key) return;
  const h = holder(session);
  await cmd(`scoreboard players set ${h} alps ${pct}`);
  await cmd(`scoreboard players display name ${h} alps ${textJson(session.name, 'white')}`);
  await cmd(`scoreboard players display numberformat ${h} alps fixed ${textJson(label, color)}`);
  session.scoreKey = key;
}

async function announce(parts, x, y, z) {
  const tp = x == null ? [] : [{ text: '  [телепорт]', color: 'aqua', click_event: { action: 'run_command', command: `/tp @s ${x} ${y} ${z}` } }];
  await cmd(`tellraw @a ${JSON.stringify([{ text: '' }, { text: '⛰ ', color: 'gold' }, ...parts, ...tp])}`);
}

const economy = () => settings.on('economy');

/** A house, public building or park on a plot is complete (or reached its current stage). */
async function finishPlot(session, plot) {
  // Commit first, effects after: a crash in between must not finish the plot twice.
  const district = state.districts[plot.district];
  const firstTime = !plot.everDone;
  plot.done = true;
  plot.everDone = true;
  if (plot.chron) plot.chron.end = Date.now();
  delete plot.skip;
  if (district && firstTime && plot.type !== 'park') district.buildingsDone++;
  if (firstTime && plot.type !== 'park') state.totals.houses++;
  const keepHome = economy() && plot.key === session.plotKey;
  if (!keepHome && plot.key === session.plotKey) session.plotKey = null;
  session.job = null;
  session.pose = null;
  if (firstTime && !plot.public && plot.type !== 'park') session.housesBuilt = (session.housesBuilt ?? 0) + 1;
  const { list, local } = buildList(plot);
  const meta = metaOf(plot);
  buildCache.delete(plot.key);
  save();
  log(`Finished ${plot.type} at ${plot.key}${plot.type !== 'park' && plot.public ? ' (public)' : ''}${economy() && plot.type !== 'park' && !plot.public ? ` (stage ${plot.stage})` : ''}`);

  const [cx, cz] = plotToWorld(plot, 10, 10);
  const top = list.reduce((m, b) => Math.max(m, b.y), plot.y);
  await features.emit('onFinish', session, plot, { list, local, meta, top, firstTime });
  for (let k = 0; k < 3; k++) {
    await cmd(`summon minecraft:firework_rocket ${cx + k - 1} ${top + 2} ${cz} {LifeTime:${20 + k * 8},FireworksItem:{id:"minecraft:firework_rocket",count:1,components:{"minecraft:fireworks":{flight_duration:1,explosions:[{shape:"star",colors:[I;16711680,16777215],has_twinkle:true}]}}}}`);
  }
  // A villager moves in (bounded per district: hundreds of villagers would slow the server's ticks).
  if (firstTime && plot.type !== 'park' && district && (district.villagers ?? 0) < config.maxVillagersPerDistrict && !features.first('replacesVillager', plot)) {
    const rng = rngFrom(plot.key + ':villager');
    const [vx, vz] = plotToWorld(plot, 8, 17);
    const profession = features.first('villagerProfession', plot) ?? rng.pick(PROFESSIONS);
    const out = await cmd(`summon minecraft:villager ${vx + 0.5} ${plot.y + 1} ${vz + 0.5} {Tags:["alps"],PersistenceRequired:1b,${config.villagerAI ? '' : 'NoAI:1b,'}VillagerData:{profession:"minecraft:${profession}",level:2,type:"minecraft:${rng.pick(['snow', 'taiga', 'plains'])}"}}`);
    if (out.includes('Summoned')) district.villagers = (district.villagers ?? 0) + 1;
  }
  const what = labelOf(plot.type);
  if (plot.public) await announce([{ text: session.name, color: 'yellow' }, { text: ` построил(а) для квартала ` }, { text: district?.name ?? '?', color: 'gold' }, { text: `: ${what}` }], cx, top + 3, cz);
  else if (plot.type === 'park') await announce([{ text: 'В квартале ' }, { text: district?.name ?? '?', color: 'gold' }, { text: ' разбит парк' }], cx, plot.y + 2, cz);
  else if (firstTime) await announce([{ text: session.name, color: 'yellow' }, { text: ` достроил(а): ${what} в квартале ` }, { text: district?.name ?? '?', color: 'gold' }], cx, top + 3, cz);
  else await announce([{ text: session.name, color: 'yellow' }, { text: ` расширил(а) дом: ${what}, этап ${plot.stage}` }], cx, top + 3, cz);
  if (economy()) await moveBuilderToFront(session, siteOf(`plot:${plot.key}`));
  else await sendBuilderHome(session);
  features.emitSync('afterFinish', session, plot);
}

/** A small object (bench, tree, fountain…) is complete. */
async function finishObject(session, o) {
  o.done = true;
  if (o.chron) o.chron.end = Date.now();
  session.job = null;
  session.pose = null;
  objCache.delete(o.id);
  save();
  const size = o.type === 'summit' ? 5 : formSize(o.type);
  await cmd(`particle minecraft:happy_villager ${o.x0 + size / 2} ${o.y0 + 2} ${o.z0 + size / 2} ${size / 3} 0.6 ${size / 3} 0 15`);
  const site = siteOf(`obj:${o.id}`);
  if (site) await moveBuilderToFront(session, site);
  if (o.type === 'summit') await announce([{ text: session.name, color: 'yellow' }, { text: ' поставил(а) смотровую и крест на вершине' }], o.x0 + 2, o.y0 + 2, o.z0 + 6);
  features.emitSync('onObjectDone', session, o);
}

async function retire(session) {
  const tag = builderTag(session);
  const site = siteOf(session.job);
  const plot = session.plotKey && state.plots[session.plotKey];
  await features.emit('onRetire', session, plot || null, site);
  await cmd(`execute at @e[tag=${tag},limit=1] run particle minecraft:poof ~ ~1 ~ 0.3 0.5 0.3 0.02 20`);
  await cmd(`kill @e[tag=${tag}]`);
  await cmd(`scoreboard players reset ${holder(session)} alps`);
  // Unfinished work goes back to the pool: another chat of this project can finish it.
  if (plot && !plot.done) plot.sessionId = null;
  if (site?.plot && site.plot.sessionId === session.id && !site.plot.done) site.plot.sessionId = null;
  if (site?.obj && !site.obj.done) site.obj.sessionId = null;
  releaseLater(`builder:${session.id}`);
  session.at = null;
  if (!economy() || (plot && !plot.done)) session.plotKey = null;
  session.job = null;
  session.retired = true;
  session.scoreKey = null;
  session.pose = null;
  rt(session).hand = null;
  rt(session).siteHeld = null;
  save();
}

/** Gives the session a house plot: an orphaned half-built house of its district, or a new one. */
async function assignPlot(session) {
  const district = await ensureDistrict(session.districtKey, session.districtName);
  const orphan = Object.values(state.plots).find((p) => p.district === district.key && !['plaza', 'square', 'park'].includes(p.type) && !p.public && !p.done && !p.sessionId);
  let plot;
  if (orphan) {
    plot = orphan;
    orphan.sessionId = session.id;
  } else plot = await newPlot(district, session.id, { stage: economy() ? 1 : 2 });
  session.plotKey = plot.key;
  save();
  return plot;
}

// --- chat economy: small forms for short chats, growing houses, public works for long ones

/** Stage a house should be at for this much work (actions so far). */
function targetStage(session) {
  const n = session.actions ?? 0;
  const [s2, s3] = config.stageActions;
  return n >= s3 ? 3 : n >= s2 ? 2 : 1;
}

/** Free footprint spots for a small form on a plaza or park (plot-local, top-left corners). */
function formSpots(host, size) {
  const occupied = new Set();
  const mark = (x, z) => {
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) occupied.add(`${x + a},${z + b}`); // one cell of air around
  };
  for (const b of buildList(host).local) if (b.y >= 1) mark(b.x, b.z);
  for (const o of Object.values(state.objects ?? {})) {
    if (o.plotKey !== host.key) continue;
    const s = o.type === 'summit' ? 5 : formSize(o.type);
    for (let x = 0; x < s; x++) for (let z = 0; z < s; z++) mark(o.x0 - host.x0 + x, o.z0 - host.z0 + z);
  }
  const out = [];
  for (let x = 3; x + size - 1 <= 17; x++)
    for (let z = 3; z + size - 1 <= 17; z++) {
      let ok = true;
      for (let a = 0; a < size && ok; a++)
        for (let b = 0; b < size && ok; b++) {
          const cx = x + a;
          const cz = z + b;
          if (occupied.has(`${cx},${cz}`) || (cx >= 9 && cx <= 11) || (cz >= 9 && cz <= 11)) ok = false; // keep the cross walkway clear
        }
      if (ok) out.push([x, z]);
    }
  return out;
}

function newObject(fields) {
  state.objects ??= {};
  state.nextObjectId = (state.nextObjectId ?? 0) + 1;
  const o = { id: String(state.nextObjectId), placed: 0, done: false, chron: newChron(), ...fields };
  o.total = objList(o).list.length;
  state.objects[o.id] = o;
  save();
  return o;
}

/** A small form for the session on its district's plaza or one of its parks (a new park if all are full). */
async function formJob(session, { isPublic = false } = {}) {
  const district = await ensureDistrict(session.districtKey, session.districtName);
  const own = Object.values(state.objects ?? {}).find((o) => !o.done && o.kind === 'form' && (o.sessionId === session.id || (!o.sessionId && o.district === district.key)));
  if (own) {
    own.sessionId = session.id;
    return `obj:${own.id}`;
  }
  // A short chat leaves one small form, a few more if it keeps going (but not a park full of benches).
  if (!isPublic) {
    const made = Object.values(state.objects ?? {}).filter((o) => o.by === session.id).length;
    if (made >= Math.min(3, 1 + Math.floor((session.actions ?? 0) / 8))) return null;
  }
  const rng = rngFrom(`${session.id}:${state.nextObjectId ?? 0}:form`);
  const type = rng.weighted([['bench', 3], ['linden', 2], ['fir', 1.5], ['flowerbed', 3], ['lamp', 2], ['well', 0.7], ['fountain', 0.7], ['bikestand', 1]]);
  const size = formSize(type);
  const hosts = [state.plots[cellKey(district.seed)], ...district.cells.map((k) => state.plots[k]).filter((p) => p?.type === 'park' && p.done)].filter(Boolean);
  for (const host of hosts) {
    const spots = formSpots(host, size);
    if (!spots.length) continue;
    const [lx, lz] = spots[rng.int(0, spots.length - 1)];
    const o = newObject({ kind: 'form', type, district: district.key, plotKey: host.key, x0: host.x0 + lx, y0: host.y, z0: host.z0 + lz, turns: rng.int(0, 3), seed: `${session.id}:${state.nextObjectId}`, sessionId: session.id, by: session.id, public: isPublic });
    log(`Small form ${o.id}: ${type} on ${host.type} ${host.key} for ${session.name}`);
    return `obj:${o.id}`;
  }
  // Every plaza and park of the district is full: lay out a new park (the session builds its paths first).
  const pending = Object.values(state.plots).find((p) => p.district === district.key && p.type === 'park' && !p.done);
  if (pending) {
    if (pending.sessionId && pending.sessionId !== session.id) return null; // someone is laying it out: wait
    pending.sessionId = session.id;
    return `plot:${pending.key}`;
  }
  const park = await newPlot(district, session.id, { type: 'park', isPublic: true });
  return `plot:${park.key}`;
}

const PUBLIC_TYPES = ['church', 'clocktower', 'cafe'];

/** Public works for a session whose own house is complete: district buildings, the park, then city projects. */
async function publicJob(session) {
  const district = await ensureDistrict(session.districtKey, session.districtName);
  const mine = Object.values(state.plots).find((p) => p.public && !p.done && p.sessionId === session.id);
  if (mine) return `plot:${mine.key}`;
  for (const type of PUBLIC_TYPES) {
    if (!Buildings.BUILDINGS?.[type]) continue;
    const existing = Object.values(state.plots).filter((p) => p.district === district.key && p.type === type);
    const open = existing.find((p) => p.public && !p.done && !p.sessionId);
    if (open) {
      open.sessionId = session.id;
      return `plot:${open.key}`;
    }
    if (!existing.length) {
      const plot = await newPlot(district, session.id, { type, stage: 2, isPublic: true });
      return `plot:${plot.key}`;
    }
  }
  // The district park: lay it out once, then fill it with trees, benches and fountains.
  const parks = Object.values(state.plots).filter((p) => p.district === district.key && p.type === 'park');
  const open = parks.find((p) => !p.done && (!p.sessionId || p.sessionId === session.id));
  if (open) {
    open.sessionId = session.id;
    return `plot:${open.key}`;
  }
  if (!parks.length) return `plot:${(await newPlot(district, session.id, { type: 'park', isPublic: true })).key}`;
  const rng = rngFrom(`${session.id}:${state.nextObjectId ?? 0}:park`);
  const type = rng.weighted([['linden', 3], ['fir', 2], ['bench', 2], ['flowerbed', 2], ['fountain', 1], ['lamp', 1.5]]);
  for (const park of parks.filter((p) => p.done)) {
    const spots = formSpots(park, formSize(type));
    if (!spots.length) continue;
    const [lx, lz] = spots[rng.int(0, spots.length - 1)];
    const o = newObject({ kind: 'form', type, district: district.key, plotKey: park.key, x0: park.x0 + lx, y0: park.y, z0: park.z0 + lz, turns: rng.int(0, 3), seed: `${session.id}:${state.nextObjectId}`, sessionId: session.id, public: true });
    return `obj:${o.id}`;
  }
  return cityJob(session);
}

/** Surface height at (x, z) via a heightmap probe; null when the chunk will not load or it is not ground. */
async function surfaceAt(x, z) {
  await holdOwner('probe:surface', { x1: x, z1: z, x2: x, z2: z });
  try {
    for (let i = 0; i < 20; i++) {
      const out = await cmd(`execute positioned ${x} 0 ${z} positioned over motion_blocking_no_leaves run summon minecraft:marker ~ ~ ~ {Tags:["alps","alps_fx","alps_surface"]}`);
      if (out.includes('Summoned')) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    const pos = (await cmd('data get entity @e[tag=alps_surface,limit=1] Pos')).match(/\[(-?[\d.]+)d, (-?[\d.]+)d, (-?[\d.]+)d\]/);
    const soil = pos && (await cmd(`execute if block ${x} ${Math.floor(Number(pos[2])) - 1} ${z} #minecraft:dirt`)).includes('passed');
    await cmd('kill @e[tag=alps_surface]');
    return pos && soil ? Math.floor(Number(pos[2])) : null;
  } finally {
    releaseLater('probe:surface', 500);
  }
}

/** City projects: the summit viewpoint once, then an endless forest of firs (and a bench now and then) on the slopes. */
async function cityJob(session) {
  const mine = Object.values(state.objects ?? {}).find((o) => !o.done && (o.kind === 'tree' || o.kind === 'summit') && (o.sessionId === session.id || !o.sessionId));
  if (mine) {
    mine.sessionId = session.id;
    return `obj:${mine.id}`;
  }
  const peak = state.city.peaks?.[0];
  if (peak && !Object.values(state.objects ?? {}).some((o) => o.type === 'summit')) {
    const o = newObject({ kind: 'summit', type: 'summit', district: null, plotKey: null, x0: peak.x - 2, y0: peak.y - 1, z0: peak.z - 2, turns: 0, seed: 'summit', sessionId: session.id, public: true });
    return `obj:${o.id}`;
  }
  if (!peak) peakSurvey.request();
  const radius = Math.max(40, ...Object.values(state.plots).map((p) => Math.hypot(p.cell[0], p.cell[1]) * PLOT + 15));
  const rng = rngFrom(`${session.id}:${state.nextObjectId ?? 0}:forest`);
  for (let attempt = 0; attempt < 6; attempt++) {
    const a = rng.next() * Math.PI * 2;
    const r = radius + 12 + rng.next() * 100;
    const x = Math.round(state.city.cx + Math.cos(a) * r);
    const z = Math.round(state.city.cz + Math.sin(a) * r);
    const y = await surfaceAt(x, z);
    if (y == null || y < state.city.baseY - 15 || y > state.city.baseY + 70) continue;
    const type = rng.chance(0.08) ? 'bench' : rng.chance(0.15) ? 'linden' : 'fir';
    const o = newObject({ kind: 'tree', type, district: null, plotKey: null, x0: x - 2, y0: y - 1, z0: z - 2, turns: rng.int(0, 3), seed: `${session.id}:${state.nextObjectId}`, sessionId: session.id, public: true });
    return `obj:${o.id}`;
  }
  return null;
}

/** What the session should be working on now (economy off: one house after another, as always). */
async function chooseJob(session) {
  if (!economy()) {
    if (!session.plotKey || state.plots[session.plotKey]?.done) await assignPlot(session);
    return `plot:${session.plotKey}`;
  }
  const home = session.plotKey ? state.plots[session.plotKey] : null;
  if (!home && (session.actions ?? 0) < config.houseAfterActions) return formJob(session);
  if (!home) return `plot:${(await assignPlot(session)).key}`;
  if (!home.done) return `plot:${home.key}`;
  const target = targetStage(session);
  if ((home.stage ?? 2) < target) {
    // Grow the house by diff: old stage -> new stage, nothing is demolished.
    await holdArea(`upgrade:${session.id}`, plotRect(state.city, home.cell), 10000);
    if (await migratePlot(home, { gen: home.gen, stage: home.stage ?? 2, placed: home.total, bp: home.bp }, target)) return `plot:${home.key}`;
    return null;
  }
  return publicJob(session);
}

/** A higher-priority job became available (the chat earned a house or the next stage): drop the current one. */
function preempted(session, site) {
  if (!economy() || site.kind === 'house') return false;
  const home = session.plotKey ? state.plots[session.plotKey] : null;
  if (!home) return site.kind !== 'park' && (session.actions ?? 0) >= config.houseAfterActions && site.rec.placed === 0;
  return home.done && (home.stage ?? 2) < targetStage(session);
}

/** One building step for one session. */
async function work(session, dt) {
  const silentMin = (Date.now() - session.lastEvent) / 60000;
  if (session.ended || silentMin > config.retireAfterHours * 60) {
    if (!session.retired) await retire(session);
    return;
  }
  if (session.active && silentMin > config.idleAfterMinutes) session.active = false;
  if (!session.job) {
    if (!session.active) return; // a chat gets work with its first real prompt
    session.job = await chooseJob(session);
    if (!session.job) return;
    save();
  }
  let site = siteOf(session.job);
  if (!site || site.rec.done) {
    session.job = null;
    return;
  }
  if (site.rec.sessionId !== session.id && !site.rec.done) site.rec.sessionId = session.id;
  if (preempted(session, site)) {
    if (site.rec.sessionId === session.id) site.rec.sessionId = null; // someone else may continue it
    session.job = null;
    return;
  }
  if (session.at !== site.key || rt(session).siteHeld !== site.key) await moveTo(session, site);
  const plot = site.plot && !site.obj ? site.plot : null;
  if (plot && plot.type !== 'park' && (plot.gen !== gens.current || plot.bp !== buildList(plot).hash)) {
    if (!(await migratePlot(plot, { gen: plot.gen, stage: plot.stage, placed: plot.placed, bp: plot.bp }))) return;
  }
  const built = await siteBuilt(site);
  const rec = site.rec;
  if (session.active) contribution(rec, session).activeSec += dt;

  if (!session.active) {
    session.credit = Math.min(session.credit, 40);
    const want = silentMin > config.sleepAfterMinutes ? 'idle-sleeping' : 'idle-standing';
    if (session.pose !== want && !(session.pose === 'renovating' && renovator.helping(session))) {
      await ensureBuilder(session, site);
      await moveBuilderToFront(session, site);
      await setPose(session, want.slice(5));
      session.pose = want;
    }
    await updateScore(session, site);
    await features.emit('onWork', session, site, dt);
    return;
  }

  if (session.pose !== 'standing') {
    await ensureBuilder(session, site);
    await setPose(session, 'standing');
    session.pose = 'standing';
  }
  session.credit = Math.min(session.credit + config.blocksPerSecond * dt, 200);
  const { list, skip } = built;
  const tag = builderTag(session);
  const mine = contribution(rec, session);
  let n = features.every('canBuild', session, site) ? Math.min(Math.floor(session.credit), config.maxBlocksPerTick) : 0;
  let freeSkips = 400; // blocks that are already right cost nothing, but keep one tick bounded
  while (n-- > 0 && rec.placed < list.length) {
    if (skip?.has(rec.placed)) {
      rec.placed++; // already standing from before the generators (or the stage) changed
      n++;
      continue;
    }
    const b = list[rec.placed];
    const out = await cmd(`setblock ${b.x} ${b.y} ${b.z} ${b.block}`);
    if (out.includes('not loaded')) break; // chunk still loading: retry next tick
    if (out.startsWith('Could not set') && freeSkips-- > 0) {
      // Identical block already there (lawn, ground, parts kept from before): no walk, no time spent.
      rec.placed++;
      n++;
      continue;
    }
    rec.placed++;
    session.credit -= 1;
    session.blocks = (session.blocks ?? 0) + 1;
    mine.blocks++;
    if (rec.placed % 3 === 0) {
      await cmd(`tp @e[tag=${tag},limit=1] ${b.x + 0.5} ${b.y + 1} ${b.z + 0.5} ${[0, 90, 180, 270][rec.placed % 4]} 20`);
      Object.assign(rt(session), { pos: [b.x + 0.5, b.y + 1, b.z + 0.5], posAt: site.key }); // for the web map
      await cmd(`particle minecraft:happy_villager ${b.x + 0.5} ${b.y + 0.7} ${b.z + 0.5} 0.3 0.3 0.3 0 2`);
      await cmd(`playsound minecraft:${soundFor(b.block)} block @a ${b.x} ${b.y} ${b.z} 0.5 1`);
    }
    if (rec.placed % 12 === 1) await setHand(session, features.first('handItem', session, b) ?? itemFor(b.block));
  }
  save();
  if (rec.placed >= list.length) {
    if (site.obj) await finishObject(session, site.obj);
    else await finishPlot(session, site.plot);
  } else {
    await updateScore(session, site);
    await features.emit('onWork', session, site, dt);
  }
}

// ------------------------------------------------------------------ renovation

const renovator = new Renovator({
  state: () => state,
  gens, cmd, log, save, chunks, PLOT, hashList, textJson, labelOf, releaseLater, builderTag,
  plotRect: (cell) => plotRect(state.city, cell),
  listWith: (mod, plot) => stagedList(mod, plot),
  newList: (plot) => {
    const local = blueprintOf(plot);
    return { hash: hashList(local), local };
  },
  streetVersion: STREET_VERSION,
  streetOps: streetCommands,
  clearOps: clearCommands,
  enabled: () => settings.on('renovation') && !!state.city && !state.city.pending,
  // An idle (awake) builder of the district walks over and helps (any district's for the main square);
  // otherwise the crew works while any chat does.
  helper: (district) =>
    Object.values(state.sessions).find((s) => !s.retired && !s.active && s.at && (!district || s.districtKey === district.key) && (s.pose === 'idle-standing' || s.pose === 'renovating') && Date.now() - s.lastEvent < config.sleepAfterMinutes * 60000) ?? null,
  rate: (district, helper) => (Object.values(state.sessions).some((s) => s.active && !s.retired) ? config.renovateBlocksPerSecond : 0) + (helper ? config.renovateHelperBlocksPerSecond : 0),
  announce,
});

const peakSurvey = new PeakSurvey({ state: () => state, cmd, log, save, holdOwner, releaseLater, PLOT });

// ------------------------------------------------------------------ players

const knownPlayers = new Set();
async function pollPlayers() {
  const out = await cmd('list');
  const names = (out.split(':')[1] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  for (const name of names) {
    if (knownPlayers.has(name) || !/^\w{1,16}$/.test(name)) continue;
    knownPlayers.add(name);
    await cmd(`op ${name}`);
    await cmd(`tellraw ${name} ${JSON.stringify({ text: `Добро пожаловать в ${config.cityName}! Каждый чат с Claude — строитель в твоём городе.`, color: 'gold' })}`);
    const url = `http://127.0.0.1:${config.port}/`;
    await cmd(`tellraw ${name} ${JSON.stringify([{ text: '  ⚙ ', color: 'gray' }, { text: '[настройки]', color: 'aqua', click_event: { action: 'open_url', url }, hover_event: { action: 'show_text', value: url } }, { text: '  что показывать в мире: пресеты и переключатели', color: 'gray' }])}`);
    if (state.city && !state.city.pending) {
      const go = (label, color, x, y, z, note) =>
        cmd(`tellraw ${name} ${JSON.stringify([{ text: '  → ', color: 'gray' }, { text: label, color, click_event: { action: 'run_command', command: `/tp @s ${x} ${y} ${z}` } }, { text: note, color: 'gray' }])}`);
      const centre = state.plots['0,0'];
      await go(config.cityName, 'gold', state.city.cx, (centre?.y ?? state.city.baseY) + 2, state.city.cz + 7, '  (центр)');
      for (const d of Object.values(state.districts)) {
        const p = state.plots[d.cells[0]];
        if (!p || d.pending) continue;
        await go(d.name, 'yellow', p.x0 + 10, p.y + 2, p.z0 + 10, `  (${d.buildingsDone} домов)`);
      }
    }
    await features.emit('onPlayerJoin', name);
  }
  for (const name of [...knownPlayers]) {
    if (names.includes(name)) continue;
    knownPlayers.delete(name);
    features.emitSync('onPlayerLeave', name);
  }
  features.emitSync('onPlayers', names.filter((n) => knownPlayers.has(n)));
}

// ------------------------------------------------------------------ hook events

// Prompts the app sends on its own (session bootstrap, injected context) — not good builder names.
const SYSTEM_PROMPT = /^(the user |you are |<|\[|caveman|claude code|# |system:)/i;
const SESSION_ID = /^[0-9A-Za-z-]{8,64}$/;
const WORD = /^[\w.:-]{1,64}$/; // shape of the small derived fields the hook sends

function nameFromPrompt(prompt) {
  const raw = String(prompt);
  if (SYSTEM_PROMPT.test(raw.trim()) || /system-reminder|<command-/i.test(raw)) return null;
  const clean = cleanText(raw.replace(/<[^>]+>/g, ' '), 26);
  return clean || null;
}

/** Tool family, for the item in hand and the status line. */
function toolCategory(tool) {
  if (/^(Read|Grep|Glob|LS|NotebookRead)$/.test(tool)) return 'read';
  if (/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(tool)) return 'edit';
  if (/^(Bash|PowerShell|BashOutput|KillShell)$/.test(tool)) return 'bash';
  if (/^(WebSearch|WebFetch)$/.test(tool)) return 'web';
  if (/^(Agent|Task)$/.test(tool)) return 'agent';
  if (/^(TodoWrite|TaskCreate|TaskUpdate|TaskList)$/.test(tool)) return 'plan';
  if (tool === 'mcp' || tool.startsWith('mcp__')) return 'mcp';
  return 'other';
}

/** Normalizes an incoming event: old hooks sent `tool_name`, new ones send small derived fields. */
function normalize(ev) {
  const word = (v) => (typeof v === 'string' && WORD.test(v) ? v : undefined);
  const tool = word(ev.tool) ?? (typeof ev.tool_name === 'string' ? (ev.tool_name.startsWith('mcp__') ? 'mcp' : word(ev.tool_name)) : undefined);
  return {
    kind: ev.hook_event_name,
    t: Number.isFinite(ev.t) ? Math.min(ev.t, Date.now()) : Date.now(),
    tool,
    kinds: Array.isArray(ev.kinds) ? ev.kinds.filter((k) => ['test', 'commit', 'push', 'pr', 'rmrf'].includes(k)) : [],
    ok: ev.ok !== false,
    interrupt: ev.interrupt === true,
    mode: word(ev.mode),
    agentId: word(ev.agent_id),
    agentType: word(ev.agent_type),
    sub: ev.sub === true,
    ntype: word(ev.ntype),
    error: word(ev.error),
    trigger: word(ev.trigger),
    model: word(ev.model),
    transcript: typeof ev.transcript === 'string' && ev.transcript.endsWith('.jsonl') ? ev.transcript : undefined,
  };
}

const CLEARS_WAIT = new Set(['PostToolUse', 'PostToolUseFailure', 'UserPromptSubmit', 'Stop', 'StopFailure', 'SessionEnd', 'SubagentStart']);

function onEvent(raw) {
  const id = raw?.session_id;
  if (typeof id !== 'string' || !SESSION_ID.test(id)) return;
  const ev = normalize(raw);
  const { kind, t } = ev;
  let s = Object.hasOwn(state.sessions, id) ? state.sessions[id] : null;
  if (!s) {
    const where = districtFor(typeof raw.cwd === 'string' ? raw.cwd : '');
    s = state.sessions[id] = {
      id, name: `Чат ${id.slice(0, 4)}`, named: false, districtKey: where.key, districtName: where.name,
      skin: SKINS[parseInt(id.replace(/[^0-9a-f]/gi, '').slice(0, 6) || '0', 16) % SKINS.length],
      active: false, ended: false, retired: false, credit: 0, plotKey: null, createdAt: Date.now(), lastEvent: Date.now(),
    };
    log(`New session ${id.slice(0, 8)} in ${where.name}`);
  }
  if (!s.plotKey && typeof raw.cwd === 'string' && raw.cwd) {
    const where = districtFor(raw.cwd); // the chat may have moved into a project folder before building started
    s.districtKey = where.key;
    s.districtName = where.name;
  }
  // A late Stop/SubagentStop after SessionEnd must not bring the builder back; a new prompt or resume does.
  if (s.retired || s.ended) {
    if (kind !== 'SessionStart' && kind !== 'UserPromptSubmit') return;
    s.retired = false;
    s.ended = false;
  }
  s.lastEvent = Date.now();
  // Hooks run in the background, so events can arrive slightly out of order: a tool event that started
  // before the last Stop belongs to the finished turn and must not wake the builder again.
  const late = t < (s.stopT ?? 0);
  const r = rt(s);
  if (ev.mode) s.planMode = ev.mode === 'plan';
  if (r.waiting && CLEARS_WAIT.has(kind) && t >= r.waiting.t) r.waiting = null;
  const site = siteOf(s.job);
  const chron = site ? contribution(site.rec, s) : null;
  switch (kind) {
    case 'SessionStart':
      if (ev.model) s.model = ev.model;
      break;
    case 'PostModelSwitch':
      if (ev.model) s.model = ev.model;
      break;
    case 'UserPromptSubmit':
      if (!s.named && raw.prompt) {
        const n = nameFromPrompt(raw.prompt);
        if (!n) break; // app-generated prompt: neither a name nor a reason to start building
        s.name = n;
        s.named = true;
        s.scoreKey = null;
        if (settings.on('chronicleWithPrompt')) s.task = cleanText(String(raw.prompt).replace(/<[^>]+>/g, ' '), 200);
        fx.push(`data merge entity @e[tag=${builderTag(s)},limit=1] {CustomName:${textJson(n)}}`, { key: `name:${s.id}` });
      }
      s.active = true;
      s.promptT = t;
      break;
    case 'PostToolUse':
    case 'PostToolUseFailure': {
      if (!late) s.active = true;
      const tool = ev.tool && Object.hasOwn(config.toolBurst, ev.tool) ? ev.tool : 'default';
      s.credit = (Number(s.credit) || 0) + Number(config.toolBurst[tool]);
      if (ev.tool && !ev.sub) {
        r.toolCat = toolCategory(ev.tool);
        r.toolAt = Date.now();
      }
      state.totals.actions++;
      s.actions = (s.actions ?? 0) + 1;
      if (chron && ev.tool) {
        const cat = toolCategory(ev.tool);
        chron.actions[cat] = (chron.actions[cat] ?? 0) + 1;
      }
      const ok = kind === 'PostToolUse' && ev.ok;
      for (const k of ev.kinds) {
        if (k === 'test') {
          state.totals[ok ? 'testsOk' : 'testsFail']++;
          if (chron) chron[ok ? 'testsOk' : 'testsFail']++;
          s.testPrevStreak = s.testFailStreak ?? 0;
          s.testFailStreak = ok ? 0 : s.testPrevStreak + 1;
        } else if (ok && (k === 'commit' || k === 'push' || k === 'pr')) {
          const field = { commit: 'commits', push: 'pushes', pr: 'prs' }[k];
          state.totals[field]++;
          if (chron) chron[field]++;
        }
      }
      break;
    }
    case 'PermissionRequest':
      r.waiting = { kind: 'permission', t, since: Date.now(), tool: ev.tool };
      break;
    case 'Notification':
      if (ev.ntype === 'permission_prompt') r.waiting = r.waiting?.kind === 'permission' ? r.waiting : { kind: 'permission', t, since: Date.now() };
      else if (ev.ntype === 'elicitation_dialog' || ev.ntype === 'agent_needs_input') r.waiting = { kind: 'question', t, since: Date.now() };
      else if (ev.ntype === 'idle_prompt' && !r.waiting && t >= (s.promptT ?? 0)) r.waiting = { kind: 'idle', t, since: Date.now() };
      break;
    case 'SubagentStart':
      if (!late) s.active = true;
      if (ev.agentId) r.agents.set(ev.agentId, { type: ev.agentType ?? 'agent', since: Date.now() });
      if (chron) chron.agents++;
      break;
    case 'SubagentStop':
      s.credit = (Number(s.credit) || 0) + config.subagentBurst;
      if (ev.agentId) r.agents.delete(ev.agentId);
      break;
    case 'PreCompact':
      r.compactUntil = Date.now() + 6000;
      break;
    case 'Stop':
      s.active = false;
      s.stopT = t;
      break;
    case 'StopFailure':
      s.active = false;
      s.stopT = t;
      if (ev.error === 'rate_limit' || ev.error === 'overloaded') r.limitUntil = Date.now() + 120000;
      break;
    case 'SessionEnd':
      s.ended = true;
      s.active = false;
      r.waiting = null;
      break;
  }
  features.emitSync('onEvent', s, ev, { late });
  save();
}

// ------------------------------------------------------------------ features & settings

function now() {
  return new Date(Date.now() + Number(config.debugClockOffsetMinutes || 0) * 60000);
}

const ctx = {
  config, log, cmd, fx, save, chunks, PLOT, SKINS,
  get state() {
    return state;
  },
  get gens() {
    return gens;
  },
  on: (id) => settings.on(id),
  rt,
  now,
  sessions: () => Object.values(state.sessions).filter((s) => !s.retired),
  sessionPlot: (s) => (s.plotKey ? state.plots[s.plotKey] : null),
  builderTag,
  builderSel: (s) => `@e[tag=${builderTag(s)},limit=1]`,
  builderUuid,
  plotRect: (cell) => plotRect(state.city, cell),
  plotToWorld,
  /** World coordinates of a plot-local list entry. */
  local: (plot, b) => [plot.x0 + b.x, plot.y + b.y, plot.z0 + b.z],
  front: (plot) => {
    const [x, z] = plotToWorld(plot, 10, 19);
    return [x + 0.5, plot.y + 1, z + 0.5];
  },
  buildList,
  meta: metaOf,
  district: (key) => (key ? state.districts[key] : null),
  plazaOf: (district) => (district ? state.plots[cellKey(district.seed)] : null),
  square: () => state.plots['0,0'],
  textJson, snbt, cleanText, announce, itemFor, labelOf,
  tellraw: (target, parts) => cmd(`tellraw ${target} ${JSON.stringify([{ text: '' }, ...parts])}`),
  /** Force-loads `r` for `ms` (e.g. while a temporary mob plays), then lets it go. */
  holdArea, holdOwner, releaseLater,
  setHand, refreshHand, nameplate, siteOf, contribution, metaOf,
  worldDir: () => path.join(config.serverDir, props['level-name'] || 'world'),
  root: ROOT,
  economy,
  needPeaks: () => peakSurvey.request(),
  weather: { base: null }, // what the weather returns to after a storm (holidays set it)
  connection: () => connections,
  achieve: (id) => features.emitSync('achieve', id),
  toolCategory,
  players: () => [...knownPlayers],
  port: () => config.port,
};

const features = new FeatureHost(FEATURES, ctx, log);
const PARAMS = [
  { key: 'houseAfterActions', label: 'Действий до своего дома', description: 'Экономика чатов: до этого числа действий чат ставит скамейки, деревья и фонтаны на площади квартала.', min: 0, max: 1000 },
  { key: 'stageActions.0', label: 'Действий до 2-го этапа дома', description: 'Дом растёт: маленький дом → полный дом.', min: 1, max: 5000 },
  { key: 'stageActions.1', label: 'Действий до 3-го этапа дома', description: 'Полный дом → пристройка и двор; после этого чат строит общественное.', min: 1, max: 10000 },
  { key: 'blocksPerSecond', label: 'Скорость стройки, блоков/с', description: 'Пока чат работает (плюс бонус за каждое действие).', min: 0.5, max: 40, step: 0.5 },
  { key: 'renovateBlocksPerSecond', label: 'Скорость ремонта, блоков/с', description: 'Бригада ремонта, пока работает хоть один чат.', min: 0, max: 40, step: 0.5 },
];
const routes = {};
for (const f of FEATURES) for (const [k, fn] of Object.entries(f.routes ?? {})) routes[k] = (body) => fn(ctx, body);
const settings = new Settings({
  file: configPath,
  registry: FEATURES,
  log,
  initial: userConfig,
  params: PARAMS,
  config,
  routes,
  onChange: (changes) => {
    log(`Features: ${changes.map((c) => `${c.id} ${c.on ? 'on' : 'off'}`).join(', ')}`);
    for (const c of changes) features.toggle(c.id, c.on);
  },
});
features.settings = settings;
settings.watch();
log(`Preset ${settings.preset}: ${FEATURES.filter((f) => settings.on(f.id)).map((f) => f.id).join(', ') || 'no extras'}`);

// Live web map at /map (bridge state only; RCON just for its teleport / follow buttons).
const mapPage = new MapPage({
  state: () => state, config, rt, siteOf, labelOf, cmd, builderSel: ctx.builderSel, gens, renovator, log,
  players: () => [...knownPlayers],
  connected: () => rcon.connected,
});

// ------------------------------------------------------------------ main loop

let lastTick = Date.now();
let lastPoll = 0;
let lastSweep = 0;
let busy = false;

async function tick() {
  if (busy) return;
  busy = true;
  try {
    if (!rcon.connected && !(await connect())) return;
    const now = Date.now();
    const dt = Math.min((now - lastTick) / 1000, 2);
    lastTick = now;
    for (const session of Object.values(state.sessions)) {
      if (session.retired) continue;
      try {
        await work(session, dt);
      } catch (err) {
        if (err instanceof RconDisconnected) throw err;
        log(`session ${session.id.slice(0, 8)}: ${err.stack ?? err.message}`); // one broken session must not stop the others
      }
    }
    try {
      await renovator.step(dt, config.maxRenovatePerTick);
      await peakSurvey.step();
    } catch (err) {
      if (err instanceof RconDisconnected) throw err;
      log(`renovation/survey: ${err.stack ?? err.message}`);
    }
    await features.emit('onTick', now, dt);
    await fx.drain(config.effectsPerTick);
    if (now - lastSweep > 30000) {
      lastSweep = now;
      await cmd(sweepCommand());
    }
    if (now - lastPoll > 5000) {
      lastPoll = now;
      await pollPlayers();
    }
  } catch (err) {
    if (err instanceof RconDisconnected) log('Lost connection to the Minecraft server; reconnecting…');
    else log('tick error:', err.stack ?? err.message);
  } finally {
    busy = false;
  }
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/event') {
    // Only local tools may post: browsers always send Origin, and the hook sends JSON.
    if (req.headers.origin || !String(req.headers['content-type']).startsWith('application/json')) {
      res.writeHead(403).end();
      req.resume();
      return;
    }
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c) => {
      body += c;
      if (body.length > 256 * 1024) req.destroy();
    });
    req.on('end', () => {
      res.writeHead(204).end();
      try {
        onEvent(JSON.parse(body));
      } catch (err) {
        if (!(err instanceof SyntaxError)) log('event error:', err.stack ?? err.message);
      }
    });
    return;
  }
  if (req.method === 'GET' && req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      connected: rcon.connected,
      city: state.city,
      generators: { current: gens.current, legacy: gens.legacy ?? null, outdatedPlots: Object.values(state.plots).filter((p) => p.gen !== gens.current).length, renovation: state.renovation ?? null },
      preset: settings.preset,
      features: settings.enabled,
      districts: Object.values(state.districts).map(({ name, cells, buildingsStarted, buildingsDone }) => ({ name, plots: cells.length, buildingsStarted, buildingsDone })),
      sessions: Object.values(state.sessions).filter((s) => !s.retired).map((s) => {
        const p = s.plotKey && state.plots[s.plotKey];
        return { name: s.name, district: s.districtName, active: s.active, waiting: rt(s).waiting?.kind ?? null, building: p ? `${p.type} ${p.placed}/${p.total} @${p.key}` : null };
      }),
      effectsQueued: fx.items.size,
    }, null, 2));
    return;
  }
  if (mapPage.handle(req, res, config.port)) return;
  if (settings.handle(req, res, config.port)) return;
  res.writeHead(404).end();
});

// Hooks skip the HTTP call entirely when this file is stale (bridge not running).
const beat = () => {
  try {
    fs.writeFileSync(config.heartbeatFile, String(Date.now()));
  } catch {}
};

server.listen(config.port, '127.0.0.1', () => {
  log(`${config.cityName} bridge listening on http://127.0.0.1:${config.port}  (settings: http://127.0.0.1:${config.port}/)`);
  beat();
  setInterval(beat, 3000);
});
setInterval(tick, 250);

function shutdown() {
  if (saveTimer) clearTimeout(saveTimer);
  writeState();
  try {
    fs.unlinkSync(config.heartbeatFile);
  } catch {}
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGBREAK', shutdown); // closing the console window on Windows
