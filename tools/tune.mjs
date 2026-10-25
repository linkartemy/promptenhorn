#!/usr/bin/env node
// Tuning: measures this machine (and, read-only, the running city server) and prints a plan for the JVM,
// server.properties, the Paper/Spigot/Bukkit configs, the bridge (config.json) and the start scripts.
// Deterministic: the same machine, the same files and the same measurements give the same plan.
//
//   node tools/tune.mjs                    dry run: print the plan, write nothing (default)
//   node tools/tune.mjs --apply            write the plan; every changed file is backed up first
//                                          (backups/tune/<time>/...). Restart the server (and the bridge) after.
// Options:
//   --profile low|medium|high              force a profile (default: from the total RAM)
//   --set <id>=<value>                     pin one plan item for this run (profile becomes "custom"); repeatable,
//                                          e.g. --set server.view-distance=16 --set config.builderBotsMax=2
//   --no-measure                           don't ask the running server (RCON) for TPS, chunks, entities
//   --no-client                            the Minecraft client runs on another computer (no RAM reserved for it)
//   --json                                 print the plan as JSON (for scripts and the Claude skill)
//   --lang <code>                          output language (default: "language" in config.json)
//   --root <dir>                           project root to tune (default: this checkout)
//
// Items the user pinned by hand are never changed: config.json { "tuning": { "lock": ["server.view-distance",
// "builderBotsMax", "spigot.*"] } } (an id, a config key without "config.", or a prefix ending in "*").
// RCON: only read-only commands from READ_ONLY below are sent (tps, mspt, list, forceload query, chunk and entity
// counts). Nothing in the world changes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { t, setLanguage, LANGUAGES, DEFAULT_LANGUAGE, htmlLang } from '../bridge/i18n.mjs';
import { Rcon, readProperties } from '../bridge/rcon.mjs';

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ------------------------------------------------------------------ arguments

function parseArgs(argv) {
  const o = { apply: false, measure: true, client: true, json: false, set: {}, profile: null, lang: null, root: HERE };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--apply') o.apply = true;
    else if (a === '--dry-run') o.apply = false;
    else if (a === '--no-measure') o.measure = false;
    else if (a === '--no-client') o.client = false;
    else if (a === '--json') o.json = true;
    else if (a === '--profile') o.profile = next();
    else if (a === '--lang') o.lang = next();
    else if (a === '--root') o.root = path.resolve(next());
    else if (a === '--set') {
      const [k, ...v] = String(next() ?? '').split('=');
      if (k && v.length) o.set[k] = v.join('=');
    } else if (a === '--help' || a === '-h') o.help = true;
    else o.unknown = a;
  }
  return o;
}

// ------------------------------------------------------------------ profiles and cost model

/**
 * Profiles: what a machine of that size should run. Memory in MB. Gameplay knobs (renovate, maxBlocksPerTick,
 * lifeDensity) are ceilings: a lower value the user chose is kept. Bot maxima are capacities (set as computed).
 */
export const PROFILES = {
  low: { // laptop with 8 GB: client + Claude + server leave ~1.5–3 GB for the city
    xmx: 1536, xms: 1024, view: 6, sim: 4, builders: 1, colonists: 1,
    renovate: 2, maxBlocksPerTick: 6, lifeDensity: 'low', villagerAI: false,
    villagerRange: 16, animalRange: 16, playerTracking: 64, wakeVillagers: 1, autoSaveChunks: 8,
  },
  medium: { // 16 GB
    xmx: 2560, xms: 1024, view: 12, sim: 6, builders: 4, colonists: 3,
    renovate: 6, maxBlocksPerTick: 8, lifeDensity: 'medium', villagerAI: null,
    villagerRange: 24, animalRange: 24, playerTracking: 96, wakeVillagers: 2, autoSaveChunks: 12,
  },
  high: { // 32 GB and more
    xmx: 4096, xms: 2048, view: 16, sim: 8, builders: 8, colonists: 6,
    renovate: 12, maxBlocksPerTick: 12, lifeDensity: 'high', villagerAI: null,
    villagerRange: 32, animalRange: 32, playerTracking: 128, wakeVillagers: 4, autoSaveChunks: 24,
  },
};
export const profileFor = (totalMB) => (totalMB < 12 * 1024 ? 'low' : totalMB < 24 * 1024 ? 'medium' : 'high');

/** Measured on the reference machine (docs/performance.md); worst-case planning numbers in MB. */
export const COST = {
  jvmOverhead: 500, // metaspace ~160, code cache ~120, GC structures, threads: process size above the heap
  bridge: 150,
  runnerBase: 200, // bots/runner.mjs or wild/colony.mjs with its first bot (minecraft-data, registry)
  builderBot: 70, // per extra bot: ~25 node + ~40 server side (chunks around it, player object)
  colonist: 90, // colonists spread out: more chunks of their own
  wildServerXmx: { low: 1024, medium: 1536, high: 2048 },
  minXmx: 1536,
};
const LIFE = ['low', 'medium', 'high'];

/** Fixed reserves (MB) when nothing is measured: the OS, the Minecraft client (+ launcher), Claude. */
export function reserves(totalMB, { client = true } = {}) {
  return {
    os: Math.min(3072, Math.max(1536, Math.round(totalMB * 0.15))),
    client: client ? (totalMB < 12 * 1024 ? 2048 : 2560) : 0,
    claude: totalMB < 12 * 1024 ? 1024 : totalMB < 24 * 1024 ? 1536 : 2048,
  };
}

// ------------------------------------------------------------------ small file helpers

const readText = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);
const readJson = (file) => {
  const s = readText(file);
  return s == null ? null : JSON.parse(s);
};

/** Lines with their own endings: Paper writes CRLF headers over LF bodies, and a rewrite must keep both. */
const splitLines = (text) => text.split('\n').map((l) => (l.endsWith('\r') ? { s: l.slice(0, -1), cr: '\r' } : { s: l, cr: '' }));
const joinLines = (lines) => lines.map((l) => l.s + l.cr).join('\n');

/** server.properties: replace `key=value` in place (or append), keep everything else. */
export function setProperty(text, key, value) {
  const lines = splitLines(text);
  const cr = lines[0]?.cr ?? '';
  const i = lines.findIndex((l) => l.s.startsWith(`${key}=`));
  if (i >= 0) lines[i].s = `${key}=${value}`;
  else if (lines.length && lines[lines.length - 1].s === '') lines.splice(lines.length - 1, 0, { s: `${key}=${value}`, cr });
  else lines.push({ s: `${key}=${value}`, cr });
  return joinLines(lines);
}

/**
 * Block-style YAML as Bukkit/Paper write it: reads or sets the scalar at a dotted path, keeping every other
 * line (comments and line endings included). A missing key is added under its parent when the parent map
 * exists. Returns { text, found, old, added }.
 */
export function yamlPath(text, dotted, value) {
  const want = dotted.split('.');
  const lines = splitLines(text);
  const stack = []; // [indent, key]
  let parentLine = -1;
  let parentIndent = -1;
  let childIndent = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].s;
    const m = /^(\s*)((?:[^\s#'"]|'[^']*'|"[^"]*")(?:[^:]|:(?=\S))*?):(?:\s+(.*?))?\s*$/.exec(line);
    if (!m || line.trimStart().startsWith('- ')) continue;
    const indent = m[1].length;
    const key = m[2].replace(/^['"]|['"]$/g, '');
    while (stack.length && stack[stack.length - 1][0] >= indent) stack.pop();
    const p = [...stack.map((x) => x[1]), key];
    if (p.length === want.length && p.every((k, j) => k === want[j])) {
      const raw = (m[3] ?? '').replace(/\s+#.*$/, '');
      const old = raw === '' ? null : raw.replace(/^['"]|['"]$/g, '');
      if (value !== undefined && raw !== '') lines[i].s = `${m[1]}${m[2]}: ${value}`;
      return { text: joinLines(lines), found: true, old };
    }
    if (p.length === want.length - 1 && p.every((k, j) => k === want[j])) {
      parentLine = i;
      parentIndent = indent;
    } else if (parentLine >= 0 && childIndent < 0 && indent > parentIndent && p.length === want.length) childIndent = indent;
    stack.push([indent, key]);
  }
  if (value !== undefined && parentLine >= 0) {
    const pad = ' '.repeat(childIndent > 0 ? childIndent : parentIndent + 2);
    lines.splice(parentLine + 1, 0, { s: `${pad}${want[want.length - 1]}: ${value}`, cr: lines[parentLine].cr });
    return { text: joinLines(lines), found: false, old: null, added: true };
  }
  return { text, found: false, old: null };
}

// ------------------------------------------------------------------ hardware and processes

function run(cmd, args, opts = {}) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000, windowsHide: true, ...opts });
  } catch (err) {
    if (opts.stderr) return String(err.stderr ?? '') + String(err.stdout ?? '');
    return null;
  }
}

/** Processes that matter (java, javaw, node, claude) with memory in MB, plus the PIDs listening on `ports`. */
function processes(ports) {
  if (process.platform === 'win32') return winProcesses(ports);
  if (process.platform === 'linux') return linuxProcesses(ports);
  return macProcesses(ports);
}

function winProcesses(ports) {
  const ps = `
$ErrorActionPreference='SilentlyContinue'
[Console]::OutputEncoding=[Text.Encoding]::UTF8
$titles=@{}; Get-Process | Where-Object { $_.MainWindowTitle } | ForEach-Object { $titles[[int]$_.Id]=$_.MainWindowTitle }
$procs=@(Get-CimInstance Win32_Process -Filter "Name='java.exe' or Name='javaw.exe' or Name='node.exe' or Name='claude.exe'" | ForEach-Object {
  [pscustomobject]@{pid=[int]$_.ProcessId;ppid=[int]$_.ParentProcessId;name=$_.Name;mem=[int64]$_.PrivatePageCount;cmd=$_.CommandLine;title=$titles[[int]$_.ProcessId]} })
$ports=@(${ports.map(Number).filter(Boolean).join(',') || '0'} | ForEach-Object { $p=$_; $c=Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue | Select-Object -First 1; if ($c) { [pscustomobject]@{port=$p;pid=[int]$c.OwningProcess} } })
$load=(Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
[pscustomobject]@{procs=$procs;ports=$ports;load=$load} | ConvertTo-Json -Depth 4 -Compress`;
  const out = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')]);
  if (out) {
    try {
      const j = JSON.parse(out.trim());
      const arr = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
      return {
        source: 'powershell',
        procs: arr(j.procs).map((p) => ({ pid: p.pid, ppid: p.ppid, name: String(p.name).toLowerCase(), mb: Math.round(p.mem / 1048576), cmd: p.cmd ?? '', title: p.title ?? '' })),
        listen: Object.fromEntries(arr(j.ports).map((p) => [p.port, p.pid])),
        load: j.load == null ? null : Number(j.load),
      };
    } catch {}
  }
  // Fallback for machines without PowerShell: WMIC (deprecated, but present on older Windows).
  const w = run('wmic', ['process', 'where', "name='java.exe' or name='javaw.exe' or name='node.exe' or name='claude.exe'", 'get', 'ProcessId,ParentProcessId,Name,PrivatePageCount,CommandLine', '/format:csv']);
  if (!w) return { source: 'none', procs: [], listen: {}, load: null };
  const rows = w.split(/\r?\n/).filter((l) => l.trim()).map((l) => l.split(','));
  const head = rows.shift() ?? [];
  const col = (n) => head.findIndex((h) => h.trim() === n);
  const procs = rows.map((r) => ({
    pid: Number(r[col('ProcessId')]), ppid: Number(r[col('ParentProcessId')]), name: String(r[col('Name')]).toLowerCase(),
    mb: Math.round(Number(r[col('PrivatePageCount')]) / 1048576), cmd: r.slice(col('CommandLine'), col('Name')).join(','), title: '',
  }));
  return { source: 'wmic', procs, listen: {}, load: null };
}

function linuxProcesses(ports) {
  const procs = [];
  const want = /^(java|node|claude)$/;
  for (const d of fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x))) {
    try {
      const comm = fs.readFileSync(`/proc/${d}/comm`, 'utf8').trim();
      if (!want.test(comm)) continue;
      const status = fs.readFileSync(`/proc/${d}/status`, 'utf8');
      const rss = Number(/VmRSS:\s+(\d+)/.exec(status)?.[1] ?? 0);
      const ppid = Number(/PPid:\s+(\d+)/.exec(status)?.[1] ?? 0);
      const cmd = fs.readFileSync(`/proc/${d}/cmdline`, 'utf8').split('\0').join(' ').trim();
      let cwd = '';
      try {
        cwd = fs.readlinkSync(`/proc/${d}/cwd`);
      } catch {}
      procs.push({ pid: Number(d), ppid, name: comm, mb: Math.round(rss / 1024), cmd, cwd, title: '' });
    } catch {}
  }
  // Listening ports -> socket inode (/proc/net/tcp*) -> pid (fd links of the candidates only).
  const listen = {};
  const inodes = {};
  for (const f of ['/proc/net/tcp', '/proc/net/tcp6']) {
    for (const l of (readText(f) ?? '').split('\n').slice(1)) {
      const c = l.trim().split(/\s+/);
      if (c.length < 10 || c[3] !== '0A') continue;
      const port = parseInt(c[1].split(':').pop(), 16);
      if (ports.includes(port)) inodes[c[9]] = port;
    }
  }
  for (const p of procs) {
    try {
      for (const fd of fs.readdirSync(`/proc/${p.pid}/fd`)) {
        const m = /socket:\[(\d+)\]/.exec(fs.readlinkSync(`/proc/${p.pid}/fd/${fd}`));
        if (m && inodes[m[1]]) listen[inodes[m[1]]] = p.pid;
      }
    } catch {}
  }
  const load = (os.loadavg()[0] / os.cpus().length) * 100;
  return { source: 'proc', procs, listen, load: Math.round(load) };
}

function macProcesses(ports) {
  const out = run('ps', ['-axo', 'pid=,ppid=,rss=,comm=,args=']) ?? '';
  const procs = [];
  for (const l of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(l);
    if (!m) continue;
    const name = path.basename(m[4]).toLowerCase();
    if (!/^(java|node|claude)$/.test(name)) continue;
    procs.push({ pid: Number(m[1]), ppid: Number(m[2]), name, mb: Math.round(Number(m[3]) / 1024), cmd: m[5], title: '' });
  }
  const listen = {};
  for (const port of ports) {
    const pid = Number((run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']) ?? '').trim().split('\n')[0]);
    if (pid) listen[port] = pid;
  }
  const load = (os.loadavg()[0] / os.cpus().length) * 100;
  return { source: 'ps', procs, listen, load: Math.round(load) };
}

/** Available RAM in MB. macOS counts inactive and purgeable pages as available (os.freemem() does not). */
function availableMB() {
  if (process.platform === 'darwin') {
    const v = run('vm_stat', []);
    if (v) {
      const page = Number(/page size of (\d+)/.exec(v)?.[1] ?? 4096);
      const n = (k) => Number(new RegExp(`${k}:\\s+(\\d+)`).exec(v)?.[1] ?? 0);
      return Math.round(((n('Pages free') + n('Pages inactive') + n('Pages speculative') + n('Pages purgeable')) * page) / 1048576);
    }
  }
  if (process.platform === 'linux') {
    const m = /MemAvailable:\s+(\d+)/.exec(readText('/proc/meminfo') ?? '');
    if (m) return Math.round(Number(m[1]) / 1024);
  }
  return Math.round(os.freemem() / 1048576);
}

/** Groups processes into roles: the city server and bridge, its bots, the client, Claude, everything else. */
function classify(ps, { serverPort, bridgePort, serverDir, wildServer }) {
  const serverPid = ps.listen[serverPort];
  const bridgePid = ps.listen[bridgePort];
  const roles = {};
  for (const p of [...ps.procs].sort((a, b) => a.pid - b.pid)) {
    const cmd = p.cmd ?? '';
    const java = p.name.startsWith('java');
    if (java && p.mb < 16) continue; // the Windows javapath launcher shim in front of the real JVM
    let role;
    if (p.pid === serverPid || (!serverPid && p.cwd && path.resolve(p.cwd) === path.resolve(serverDir) && java)) role = 'server';
    else if (p.pid === bridgePid) role = 'bridge';
    else if (java && /paper|spigot|purpur|server\.jar/i.test(cmd)) role = 'otherServers';
    else if (java && (/minecraft/i.test(p.title) || /net\.minecraft|--gameDir|--assetsDir|minecraft\.client/i.test(cmd))) role = 'client';
    else if (java && /tlauncher|launcher/i.test(cmd)) role = 'client';
    else if (p.name === 'javaw.exe' || p.name === 'javaw') role = 'client';
    else if (java && !cmd) role = 'client'; // Windows hides the command line of the launcher / client
    else if (java) role = 'otherJava';
    else if (p.name.startsWith('claude')) role = 'claude';
    else if (/bots[\\/]runner\.mjs/.test(cmd)) role = p.ppid === bridgePid ? 'bots' : 'otherNode';
    else if (/wild[\\/]colony\.mjs/.test(cmd)) role = p.ppid === bridgePid || wildServer ? 'colony' : 'otherNode';
    else role = 'otherNode';
    (roles[role] ??= { mb: 0, n: 0, pids: [] }).mb += p.mb;
    roles[role].n++;
    roles[role].pids.push(p.pid);
  }
  return { roles, serverPid, bridgePid };
}

/** stdout + stderr of a command, whatever its exit code (java -version prints to stderr). */
function runAll(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 20000, windowsHide: true });
  if (r.error) return null;
  return String(r.stdout ?? '') + String(r.stderr ?? '');
}

function javaInfo(javaCmd) {
  const out = runAll(javaCmd, ['-version']) ?? '';
  const m = /version "(\d+)(?:\.(\d+))?/.exec(out);
  if (!m) return null;
  const major = m[1] === '1' ? Number(m[2]) : Number(m[1]);
  return { major, text: out.split(/\r?\n/)[0] };
}

/** Drops the flags this JVM does not know (newer JDKs retire G1 tuning flags), so the server always starts. */
function validateFlags(javaCmd, flags) {
  let keep = [...flags];
  for (let i = 0; i < 6; i++) {
    const out = runAll(javaCmd, [...keep, '-version']);
    if (out == null) return { flags: keep, checked: false };
    const m = /Unrecognized VM option '([^']+)'|Unrecognized option: (\S+)/.exec(out);
    if (!m) return { flags: keep, checked: /version/.test(out) };
    const bad = (m[1] ?? m[2]).replace(/^[+-]/, '');
    keep = keep.filter((f) => !f.includes(bad));
  }
  return { flags: keep, checked: true };
}

// ------------------------------------------------------------------ server measurement (read-only RCON)

/** The only commands this tool sends. None of them changes the world. */
const READ_ONLY = {
  tps: 'tps',
  mspt: 'mspt',
  list: 'list',
  forceload: 'forceload query',
  chunks: 'paper chunkinfo *',
  entities: 'execute if entity @e',
  villagers: 'execute if entity @e[type=minecraft:villager]',
  villagersNoAI: 'execute if entity @e[type=minecraft:villager,nbt={NoAI:1b}]',
  mannequins: 'execute if entity @e[type=minecraft:mannequin]',
  items: 'execute if entity @e[type=minecraft:item]',
  tagged: 'execute if entity @e[tag=alps]',
  life: 'execute if entity @e[tag=alps_life]',
};
const num = (s) => Number(String(s).replace(',', '.'));
const count = (s) => (/Count: (\d+)/i.exec(s ?? '') ? Number(/Count: (\d+)/i.exec(s)[1]) : /failed/i.test(s ?? '') ? 0 : null);

async function measureServer(props) {
  if (props['enable-rcon'] !== 'true' || !props['rcon.password']) return { error: 'rcon-off' };
  const rcon = new Rcon({ host: '127.0.0.1', port: Number(props['rcon.port'] ?? 25575), password: props['rcon.password'], timeoutMs: 8000 });
  try {
    await rcon.connect();
  } catch {
    return { error: 'offline' };
  }
  const raw = {};
  try {
    for (const [k, c] of Object.entries(READ_ONLY)) {
      try {
        raw[k] = (await rcon.command(c)).replace(/§./g, '');
      } catch {
        raw[k] = null;
      }
    }
  } finally {
    rcon.close();
  }
  const tps = [...(raw.tps ?? '').replace(/^[^:]*:/, '').matchAll(/(\d+[.,]\d+)/g)].map((m) => num(m[1]));
  const mspt = [...(raw.mspt ?? '').matchAll(/(\d+[.,]\d+)\/(\d+[.,]\d+)\/(\d+[.,]\d+)/g)].map((m) => ({ avg: num(m[1]), min: num(m[2]), max: num(m[3]) }));
  const chunk = /Chunks in all listed worlds:\s*Total: (\d+) Inactive: (\d+) Full: (\d+) Block Ticking: (\d+) Entity Ticking: (\d+)/.exec((raw.chunks ?? '').replace(/\s+/g, ' '));
  const villagers = count(raw.villagers);
  const noAI = count(raw.villagersNoAI);
  return {
    tps1m: tps[0] ?? null,
    msptAvg: mspt[2]?.avg ?? mspt[0]?.avg ?? null, // last 1m
    msptMax: mspt[2]?.max ?? mspt[0]?.max ?? null,
    players: Number(/There are (\d+)/.exec(raw.list ?? '')?.[1] ?? NaN),
    forceloaded: /No force loaded/i.test(raw.forceload ?? '') ? 0 : Number(/(\d+) force loaded/.exec(raw.forceload ?? '')?.[1] ?? NaN),
    chunks: chunk ? { total: +chunk[1], inactive: +chunk[2], full: +chunk[3], blockTicking: +chunk[4], entityTicking: +chunk[5] } : null,
    entities: count(raw.entities),
    villagers,
    villagersAI: villagers != null && noAI != null ? villagers - noAI : null,
    mannequins: count(raw.mannequins),
    items: count(raw.items),
    tagged: count(raw.tagged),
    life: count(raw.life),
  };
}

// ------------------------------------------------------------------ the plan

/** Current -Xms/-Xmx and extra JVM flags from a start script line `java ... -jar paper.jar`. */
export function parseJavaLine(text) {
  const m = /java(?:\.exe)?"?\s+(.*?)-jar\s+paper\.jar/i.exec(text ?? '');
  if (!m) return null;
  const parts = m[1].trim().split(/\s+/).filter(Boolean);
  const size = (f) => {
    const s = parts.find((p) => p.startsWith(f))?.slice(f.length);
    if (!s) return null;
    const v = parseFloat(s);
    return /g/i.test(s) ? Math.round(v * 1024) : /m/i.test(s) ? Math.round(v) : /k/i.test(s) ? Math.round(v / 1024) : Math.round(v / 1048576);
  };
  return { xms: size('-Xms'), xmx: size('-Xmx'), flags: parts.filter((p) => !/^-Xm[sx]/.test(p)) };
}
const fmtSize = (mb) => (mb % 1024 === 0 ? `${mb / 1024}G` : `${mb}M`);
/** "2560M", "3G", "2.5g" or a plain number of MB -> MB. */
function parseSize(v) {
  const s = String(v).trim();
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return NaN;
  return /g$/i.test(s) ? Math.round(n * 1024) : /k$/i.test(s) ? Math.round(n / 1024) : Math.round(n);
}
const num0 = (v) => (v == null || v === '' ? null : Number(v));

/** Aikar's G1 flags (mcflags.emc.gs) for heaps under 12 GB, without -XX:+AlwaysPreTouch (a desktop shares its RAM). */
export const AIKAR = [
  '-XX:+UseG1GC', '-XX:+ParallelRefProcEnabled', '-XX:MaxGCPauseMillis=200', '-XX:+UnlockExperimentalVMOptions',
  '-XX:+DisableExplicitGC', '-XX:G1NewSizePercent=30', '-XX:G1MaxNewSizePercent=40', '-XX:G1HeapRegionSize=8M',
  '-XX:G1ReservePercent=20', '-XX:G1HeapWastePercent=5', '-XX:G1MixedGCCountTarget=4', '-XX:InitiatingHeapOccupancyPercent=15',
  '-XX:G1MixedGCLiveThresholdPercent=90', '-XX:G1RSetUpdatingPauseTimePercent=5', '-XX:SurvivorRatio=32',
  '-XX:+PerfDisableSharedMem', '-XX:MaxTenuringThreshold=1', '-Dusing.aikars.flags=https://mcflags.emc.gs', '-Daikars.new.flags=true',
];

function lockedBy(locks, id) {
  const short = id.startsWith('config.') ? id.slice(7) : null;
  return locks.find((l) => l === id || (short && l === short) || (l.endsWith('*') && id.startsWith(l.slice(0, -1)))) ?? null;
}

/**
 * Computes the plan. Pure: everything it needs comes in `input` (files, measurements), so the same input
 * always gives the same plan.
 */
export function computePlan(input) {
  const { totalMB, threads, opts, files, measured, procs } = input;
  const cfg = files.config ?? {};
  const locks = [...(cfg.tuning?.lock ?? [])].map(String);
  const profileId = opts.profile && PROFILES[opts.profile] ? opts.profile : profileFor(totalMB);
  const label = Object.keys(opts.set).length ? `custom:${profileId}` : profileId;
  const prof = { ...PROFILES[profileId] };
  const notes = [];

  // Values pinned by a lock (the current value stays) or by --set: they feed the cost model and the fit
  // below never changes them.
  const sp0 = files.serverProps ?? {};
  const cur0 = files.javaLine ?? {};
  const PIN = {
    xmx: ['jvm.xmx', cur0.xmx, parseSize],
    xms: ['jvm.xms', cur0.xms, parseSize],
    view: ['server.view-distance', num0(sp0['view-distance']), Number],
    sim: ['server.simulation-distance', num0(sp0['simulation-distance']), Number],
    builders: ['config.builderBotsMax', cfg.builderBotsMax ?? 3, Number],
    colonists: ['config.colonistsMax', cfg.colonistsMax, Number],
  };
  const pinned = new Set();
  for (const [field, [id, current, conv]] of Object.entries(PIN)) {
    const forced = opts.set[id] ?? opts.set[id.replace(/^config\./, '')];
    if (forced !== undefined && Number.isFinite(conv(forced))) {
      prof[field] = conv(forced);
      pinned.add(field);
    } else if (lockedBy(locks, id) && current != null && Number.isFinite(Number(current))) {
      prof[field] = Number(current);
      pinned.add(field);
    }
  }

  // Reserves: measured when the process is running, otherwise the defaults for this RAM size.
  const def = reserves(totalMB, { client: opts.client });
  const roles = procs?.roles ?? {};
  const res = {
    os: def.os,
    client: opts.client ? Math.max(def.client, roles.client?.mb ?? 0) : 0,
    claude: Math.max(def.claude, roles.claude?.mb ?? 0),
  };
  const budget = totalMB - res.os - res.client - res.claude;

  // A separate wild server (its own JVM) or colonists in a world of this server.
  const wildSeparate = files.wildServer;
  const cost = (p) => {
    const server = p.xmx + COST.jvmOverhead;
    const bots = p.builders > 0 ? COST.runnerBase + (p.builders - 1) * COST.builderBot + COST.builderBot : 0;
    const col = p.colonists > 0 ? COST.runnerBase + p.colonists * COST.colonist + (wildSeparate ? COST.wildServerXmx[profileId] + COST.jvmOverhead : 0) : 0;
    return { server, bridge: COST.bridge, bots, colonists: col, total: server + COST.bridge + bots + col };
  };

  // CPU: a bot is ~5–10 % of a core in node plus ~0.5–1.5 ms of server tick time.
  const cpuCap = Math.max(0, Math.floor(threads / 2) - 1);
  if (!pinned.has('builders') && prof.builders > cpuCap) prof.builders = cpuCap;
  if (!pinned.has('colonists') && prof.colonists > cpuCap) prof.colonists = cpuCap;
  if (!pinned.has('colonists') && prof.builders + prof.colonists > Math.floor(threads / 2)) prof.colonists = Math.max(0, Math.floor(threads / 2) - prof.builders);

  // Fit into the budget: colonists first, then bots, then heap, then view distance (pinned values stay).
  let guard = 0;
  while (cost(prof).total > budget && guard++ < 64) {
    if (!pinned.has('colonists') && prof.colonists > 0) prof.colonists--;
    else if (!pinned.has('builders') && prof.builders > 0) prof.builders--;
    else if (!pinned.has('xmx') && prof.xmx > COST.minXmx) prof.xmx = Math.max(COST.minXmx, prof.xmx - 256);
    else if (!pinned.has('view') && prof.view > 6) prof.view -= 2;
    else break;
  }
  if (cost(prof).total > budget) notes.push({ level: 'warn', key: 'tune.note.tooSmall', params: { need: gb(cost(prof).total), have: gb(budget) } });
  if (prof.xms > prof.xmx) prof.xms = prof.xmx;

  // Measurements: an overloaded server gets the gameplay knobs of the profile below; a healthy one keeps
  // the user's faster values.
  const m = measured && !measured.error ? measured : null;
  const overloaded = m && ((m.tps1m != null && m.tps1m < 19) || (m.msptAvg != null && m.msptAvg > 40));
  const healthy = m && m.tps1m != null && m.tps1m >= 19.8 && m.msptAvg != null && m.msptAvg < 15;
  let knobs = { ...PROFILES[profileId] };
  if (overloaded) {
    const lower = profileId === 'high' ? 'medium' : 'low';
    knobs = { ...PROFILES[lower] };
    notes.push({ level: 'warn', key: 'tune.note.overloaded', params: { tps: m.tps1m, mspt: m.msptAvg } });
  } else if (m && m.msptAvg > 25) notes.push({ level: 'info', key: 'tune.note.busy', params: { mspt: m.msptAvg } });
  if (m?.forceloaded > 64) notes.push({ level: 'info', key: 'tune.note.forceloads', params: { n: m.forceloaded } });
  if (m?.villagersAI > 40) notes.push({ level: 'info', key: 'tune.note.villagers', params: { n: m.villagersAI } });
  if (m?.items > 500) notes.push({ level: 'info', key: 'tune.note.items', params: { n: m.items } });

  // Ceiling: a value above the profile's cap comes down on a small machine, or when the server is measured
  // busy; otherwise the user's choice stays (no evidence that it hurts). Lower values always stay. An unset
  // key is judged by the bridge default and stays unset when the default is fine.
  const ceiling = (current, def, cap, order) => {
    const v = current ?? def;
    const higher = order ? order.indexOf(v) > order.indexOf(cap) : Number(v) > cap;
    const busy = m && !healthy;
    const keep = !higher || (profileId !== 'low' && !busy);
    if (keep) return current ?? null;
    return cap;
  };

  const items = [];
  const add = (id, file, current, target, restart, extra = {}) => {
    const lock = lockedBy(locks, id);
    const forced = opts.set[id] ?? (id.startsWith('config.') ? opts.set[id.slice(7)] : undefined);
    let to = forced !== undefined ? coerce(forced, current ?? target) : target;
    if (to === null || to === undefined) to = current;
    const same = String(current) === String(to);
    items.push({ id, file, from: current ?? null, to, restart, locked: lock, change: !lock && !same && to !== undefined, ...extra });
  };
  /** YAML items only when the key exists or its parent map does (otherwise Paper would not read it). */
  const addYaml = (prefix, fileKey, yamlKey, value) => {
    const text = files.yaml[fileKey];
    if (text == null) return;
    const probe = yamlPath(text, yamlKey, value);
    if (!probe.found && !probe.added) return;
    add(`${prefix}.${yamlKey.replace(/^world-settings\.default\./, '')}`, fileKey, yamlPath(text, yamlKey).old, value, 'server', { yamlKey });
  };

  // JVM (start scripts)
  const cur = files.javaLine ?? { xms: null, xmx: null, flags: [] };
  add('jvm.xms', 'start', cur.xms != null ? fmtSize(cur.xms) : null, fmtSize(Math.min(prof.xms, prof.xmx)), 'server');
  add('jvm.xmx', 'start', cur.xmx != null ? fmtSize(cur.xmx) : null, fmtSize(prof.xmx), 'server');
  const hasAikar = (cur.flags ?? []).some((f) => f.includes('aikars'));
  add('jvm.flags', 'start', hasAikar ? 'aikar' : cur.flags?.length ? 'custom' : 'none', 'aikar', 'server');

  // server.properties
  const sp = files.serverProps;
  if (sp) {
    const players = 1 + prof.builders + (wildSeparate ? 0 : prof.colonists) + 2;
    add('server.view-distance', 'server.properties', sp['view-distance'] ?? null, String(prof.view), 'server');
    add('server.simulation-distance', 'server.properties', sp['simulation-distance'] ?? null, String(Math.min(prof.sim, prof.view)), 'server');
    add('server.max-players', 'server.properties', sp['max-players'] ?? null, String(Math.max(Number(sp['max-players'] ?? 0), players)), 'server');
    add('server.sync-chunk-writes', 'server.properties', sp['sync-chunk-writes'] ?? null, 'false', 'server');
    // Compression only costs CPU on both ends when the server is reachable from this computer only.
    if (['127.0.0.1', 'localhost', '::1'].includes(sp['server-ip'])) add('server.network-compression-threshold', 'server.properties', sp['network-compression-threshold'] ?? null, '-1', 'server');
  }

  // Paper per-world defaults
  for (const [k, v] of [
    ['chunks.max-auto-save-chunks-per-tick', String(prof.autoSaveChunks)],
    ['collisions.max-entity-collisions', '2'],
    ['entities.armor-stands.tick', 'false'],
    ['entities.markers.tick', 'false'],
    ['environment.optimize-explosions', 'true'],
    ['misc.update-pathfinding-on-block-update', 'false'],
    ['tick-rates.behavior.villager.validatenearbypoi', '60'],
    ['tick-rates.behavior.villager.acquirepoi', '120'],
    ['tick-rates.sensor.villager.secondarypoisensor', '80'],
    ['tick-rates.sensor.villager.nearestbedsensor', '80'],
  ]) addYaml('paper-world', 'paper-world', k, v);
  // Spigot (world-settings.default)
  for (const [k, v] of [
    ['entity-activation-range.villagers', String(prof.villagerRange)],
    ['entity-activation-range.animals', String(prof.animalRange)],
    ['entity-activation-range.tick-inactive-villagers', 'false'],
    ['entity-activation-range.wake-up-inactive.villagers-max-per-tick', String(prof.wakeVillagers)],
    ['entity-tracking-range.players', String(prof.playerTracking)],
    ['merge-radius.item', '2.5'],
    ['merge-radius.exp', '3.0'],
  ]) addYaml('spigot', 'spigot', `world-settings.default.${k}`, v);
  // Bukkit: monsters are off in the city, so only ambient mobs; the monster limit stays for a colony world.
  for (const [k, v] of [['spawn-limits.ambient', '2'], ['spawn-limits.water-ambient', '5'], ['chunk-gc.period-in-ticks', '400']]) addYaml('bukkit', 'bukkit', k, v);

  // Bridge (config.json). Bot maxima are capacities; speed and density are ceilings.
  add('config.builderBotsMax', 'config', cfg.builderBotsMax ?? null, prof.builders, 'live');
  add('config.colonistsMax', 'config', cfg.colonistsMax ?? null, prof.colonists, 'bridge');
  if (files.wildConfig) add('wild.maxColonists', 'wild-config', files.wildConfig.maxColonists ?? null, prof.colonists, 'colony');
  add('config.renovateBlocksPerSecond', 'config', cfg.renovateBlocksPerSecond ?? null, ceiling(cfg.renovateBlocksPerSecond, 2, knobs.renovate), 'live');
  add('config.maxBlocksPerTick', 'config', cfg.maxBlocksPerTick ?? null, ceiling(cfg.maxBlocksPerTick, 8, knobs.maxBlocksPerTick), 'bridge');
  add('config.lifeDensity', 'config', cfg.lifeDensity ?? null, ceiling(cfg.lifeDensity, 'medium', knobs.lifeDensity, LIFE), 'live');
  if (knobs.villagerAI === false) add('config.villagerAI', 'config', cfg.villagerAI ?? null, cfg.villagerAI === true ? false : null, 'bridge');

  // Start scripts carry the JVM line.
  for (const f of ['start.cmd', 'start.sh', 'server/start-server.cmd']) {
    if (f === 'server/start-server.cmd' && !files.has[f]) continue;
    add(f, 'script', files.has[f] ? 'exists' : null, 'generated', 'server', { script: true });
  }

  return { profile: label, budget, reserves: res, cost: cost(prof), prof, items, notes, wildSeparate, cpuCap, healthy: !!healthy, overloaded: !!overloaded };
}

function coerce(v, like) {
  if (typeof like === 'number') return Number(v);
  if (typeof like === 'boolean') return v === 'true';
  return v;
}
const gb = (mb) => fmtNum(mb / 1024);
let NF = new Intl.NumberFormat('en', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const fmtNum = (n) => NF.format(n);

// ------------------------------------------------------------------ start scripts

function jvmLine(plan, files) {
  const v = (id) => plan.items.find((i) => i.id === id);
  const pick = (id) => (v(id).locked ? v(id).from ?? v(id).to : v(id).to);
  const flagsItem = v('jvm.flags');
  const flags = flagsItem.locked ? files.javaLine?.flags ?? [] : files.validFlags ?? AIKAR;
  return ['java', `-Xms${pick('jvm.xms')}`, `-Xmx${pick('jvm.xmx')}`, ...flags, '-jar', 'paper.jar', 'nogui'].join(' ');
}

function startCmd(line, plan) {
  return [
    '@echo off',
    'rem Starts the Minecraft server and the Claude Alps bridge in two windows.',
    `rem JVM settings from tools/tune.mjs (profile ${plan.profile}); run "node tools/tune.mjs" to retune.`,
    'cd /d "%~dp0"',
    `start "Claude Alps - Minecraft server" /min cmd /k "cd /d server && ${line}"`,
    'start "Claude Alps - bridge" /min cmd /k "node bridge\\bridge.mjs"',
    'echo Claude Alps is starting. In TLauncher: version 1.21.11, Multiplayer, server address: localhost',
    '',
  ].join('\r\n');
}

function startSh(line, plan) {
  return [
    '#!/bin/sh',
    '# Starts the Minecraft server in the background and the Claude Alps bridge in this terminal (macOS / Linux).',
    `# JVM settings from tools/tune.mjs (profile ${plan.profile}); run "node tools/tune.mjs" to retune.`,
    '# Ctrl+C stops the bridge and then the server (it saves the world on the way out).',
    'cd "$(dirname "$0")" || exit 1',
    `(cd server && exec ${line} < /dev/null > /dev/null 2>&1) &`,
    'SERVER=$!',
    'trap \'kill $SERVER 2>/dev/null; wait $SERVER\' INT TERM EXIT',
    'echo "Claude Alps is starting (server log: server/logs/latest.log). Minecraft 1.21.11, Multiplayer, server address: localhost"',
    'node bridge/bridge.mjs',
    '',
  ].join('\n');
}

function serverCmd(line) {
  return ['@echo off', 'cd /d "%~dp0"', line, ''].join('\r\n');
}

/** The start scripts of the plan; a .cmd keeps the line endings of the file it replaces. */
function scriptTexts(plan, files, root) {
  const line = jvmLine(plan, files);
  const out = { 'start.cmd': startCmd(line, plan), 'start.sh': startSh(line, plan), 'server/start-server.cmd': serverCmd(line) };
  for (const id of ['start.cmd', 'server/start-server.cmd']) {
    const before = readText(path.join(root, id));
    if (before != null && !before.includes('\r\n')) out[id] = out[id].replace(/\r\n/g, '\n');
  }
  return out;
}

// ------------------------------------------------------------------ apply

function applyPlan(plan, ctx) {
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
  const backupDir = path.join(ctx.root, 'backups', 'tune', stamp);
  const written = [];
  const backup = (file) => {
    if (!fs.existsSync(file)) return;
    const dest = path.join(backupDir, path.relative(ctx.root, file));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(file, dest);
  };
  const write = (file, text) => {
    const before = readText(file);
    if (before === text) return;
    backup(file);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', text);
    fs.renameSync(file + '.tmp', file);
    written.push(path.relative(ctx.root, file));
  };
  const todo = (pred) => plan.items.filter((i) => i.change && pred(i));

  // server.properties
  let props = readText(ctx.paths.serverProps);
  if (props != null) {
    for (const i of todo((x) => x.file === 'server.properties')) props = setProperty(props, i.id.slice(7), i.to);
    write(ctx.paths.serverProps, props);
  }
  // YAML files
  for (const [key, file] of Object.entries(ctx.paths.yaml)) {
    let text = readText(file);
    if (text == null) continue;
    for (const i of todo((x) => x.file === key)) text = yamlPath(text, i.yamlKey ?? i.id.slice(key.length + 1), i.to).text;
    write(file, text);
  }
  // config.json: only the planned keys, plus tuning.profile; everything else is kept as it is.
  const cfgItems = todo((x) => x.file === 'config');
  const cfg = readJson(ctx.paths.config) ?? {};
  for (const i of cfgItems) cfg[i.id.slice(7)] = i.to;
  cfg.tuning = { ...(cfg.tuning ?? {}), profile: plan.profile, lock: cfg.tuning?.lock ?? [] };
  write(ctx.paths.config, JSON.stringify(cfg, null, 2) + '\n');
  if (ctx.paths.wildConfig) {
    const w = readJson(ctx.paths.wildConfig);
    const it = todo((x) => x.file === 'wild-config')[0];
    if (w && it) {
      w.maxColonists = it.to;
      write(ctx.paths.wildConfig, JSON.stringify(w, null, 2) + '\n');
    }
  }
  // Start scripts
  const scripts = scriptTexts(plan, ctx.files, ctx.root);
  for (const i of plan.items.filter((x) => x.script && x.change)) {
    write(path.join(ctx.root, i.id), scripts[i.id]);
    if (i.id === 'start.sh') {
      try {
        fs.chmodSync(path.join(ctx.root, i.id), 0o755);
      } catch {}
    }
  }
  return { written, backupDir: written.length ? backupDir : null };
}

// ------------------------------------------------------------------ main

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const root = opts.root;
  const configPath = process.env.ALPS_CONFIG && root === HERE ? path.resolve(process.env.ALPS_CONFIG) : path.join(root, 'config.json');
  const config = readJson(configPath) ?? {};
  const lang = setLanguage(opts.lang && Object.hasOwn(LANGUAGES, opts.lang) ? opts.lang : config.language ?? DEFAULT_LANGUAGE);
  NF = new Intl.NumberFormat(htmlLang(lang), { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  if (opts.help || opts.unknown) {
    if (opts.unknown) console.error(t('tune.unknownOption', { option: opts.unknown }));
    console.log(t('tune.usage'));
    process.exit(opts.unknown ? 1 : 0);
  }
  if (opts.profile && !PROFILES[opts.profile]) {
    console.error(t('tune.unknownProfile', { profile: opts.profile }));
    process.exit(1);
  }

  const serverDir = config.serverDir ? path.resolve(root, config.serverDir) : path.join(root, 'server');
  const paths = {
    config: configPath,
    serverProps: path.join(serverDir, 'server.properties'),
    yaml: {
      'paper-world': path.join(serverDir, 'config', 'paper-world-defaults.yml'),
      spigot: path.join(serverDir, 'spigot.yml'),
      bukkit: path.join(serverDir, 'bukkit.yml'),
    },
    wildConfig: fs.existsSync(path.join(root, 'wild-config.json')) ? path.join(root, 'wild-config.json') : null,
  };
  const propsText = readText(paths.serverProps);
  const serverProps = propsText ? readProperties(propsText) : null;
  const startText = readText(path.join(root, 'start.cmd')) ?? readText(path.join(root, 'start.sh'));
  const files = {
    config,
    serverProps,
    yaml: Object.fromEntries(Object.entries(paths.yaml).map(([k, f]) => [k, readText(f)])),
    javaLine: parseJavaLine(startText),
    wildServer: fs.existsSync(path.join(root, 'wild-server', 'server.properties')),
    wildConfig: paths.wildConfig ? readJson(paths.wildConfig) : null,
    has: Object.fromEntries(['start.cmd', 'start.sh', 'server/start-server.cmd'].map((f) => [f, fs.existsSync(path.join(root, f))])),
  };

  // Hardware and what runs right now.
  const totalMB = Math.round(os.totalmem() / 1048576);
  const freeMB = availableMB();
  const cpus = os.cpus();
  const threads = cpus.length;
  const serverPort = Number(serverProps?.['server-port'] ?? 25565);
  const bridgePort = Number(config.port ?? 7777);
  const ps = processes([serverPort, bridgePort]);
  const procs = classify(ps, { serverPort, bridgePort, serverDir, wildServer: files.wildServer });
  const java = javaInfo('java');
  const measured = opts.measure && serverProps ? await measureServer(serverProps) : opts.measure ? { error: 'no-server' } : null;
  const valid = java ? validateFlags('java', AIKAR) : { flags: AIKAR, checked: false };
  files.validFlags = valid.flags;

  const plan = computePlan({ totalMB, threads, opts, files, measured, procs });
  const scripts = scriptTexts(plan, files, root);
  for (const i of plan.items.filter((x) => x.script)) i.change = !i.locked && readText(path.join(root, i.id)) !== scripts[i.id];
  const machine = {
    totalMB, freeMB, threads, cpu: cpus[0]?.model?.trim() ?? '?', platform: process.platform, load: ps.load,
    java: java?.major ?? null, flagsChecked: valid.checked, flagsDropped: AIKAR.filter((f) => !valid.flags.includes(f)),
  };
  // Right now: what's free once our own processes are replaced by the plan's worst case.
  const ours = (procs.roles.server?.mb ?? 0) + (procs.roles.bridge?.mb ?? 0) + (procs.roles.bots?.mb ?? 0) + (procs.roles.colony?.mb ?? 0);
  const nowSpare = freeMB + ours - plan.cost.total;

  if (opts.json && !opts.apply) {
    console.log(JSON.stringify({ machine, processes: procs.roles, measured, plan, nowSpareMB: nowSpare }, null, 2));
    return;
  }

  const out = [];
  const say = (s = '') => out.push(s);
  say(t(opts.apply ? 'tune.title.apply' : 'tune.title.dry'));
  say();
  say(t('tune.machine.head'));
  say('  ' + t('tune.machine.line', { ram: gb(totalMB), free: gb(freeMB), cpu: machine.cpu, threads, os: { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }[process.platform] ?? process.platform, load: ps.load ?? '?' }));
  say('  ' + (java ? t('tune.machine.java', { major: java.major }) : t('tune.machine.noJava')));
  if (java && java.major < 21) say('  ! ' + t('tune.machine.javaOld', { major: java.major }));
  say();
  say(t('tune.mem.head'));
  for (const role of ['server', 'bridge', 'bots', 'colony', 'client', 'claude', 'otherServers', 'otherJava', 'otherNode']) {
    const r = procs.roles[role];
    if (!r) continue;
    say(`  ${t(`tune.role.${role}`, { n: r.n }).padEnd(34)} ${t('tune.gb', { n: gb(r.mb).padStart(5) })}`);
  }
  if (!Object.keys(procs.roles).length) say('  ' + t('tune.mem.none'));
  say();
  say(t('tune.server.head'));
  if (!measured) say('  ' + t('tune.server.skipped'));
  else if (measured.error) say('  ' + t(`tune.server.${measured.error}`));
  else {
    say('  ' + t('tune.server.tick', { tps: fmtNum(measured.tps1m ?? NaN), mspt: fmtNum(measured.msptAvg ?? NaN), max: fmtNum(measured.msptMax ?? NaN), players: measured.players }));
    if (measured.chunks) say('  ' + t('tune.server.chunks', { total: measured.chunks.total, ticking: measured.chunks.entityTicking, forced: measured.forceloaded }));
    say('  ' + t('tune.server.entities', { all: measured.entities ?? '?', villagers: measured.villagers ?? '?', ai: measured.villagersAI ?? '?', mannequins: measured.mannequins ?? '?', items: measured.items ?? '?', tagged: (measured.tagged ?? 0) + (measured.life ?? 0) }));
  }
  say();
  const pName = plan.profile.replace(/^custom:/, '');
  say(t(plan.profile.startsWith('custom') ? 'tune.profile.custom' : 'tune.profile.line', { profile: pName, ram: gb(totalMB) }));
  say('  ' + t('tune.budget', { budget: gb(plan.budget), ram: gb(totalMB), os: gb(plan.reserves.os), client: gb(plan.reserves.client), claude: gb(plan.reserves.claude) }));
  say('  ' + t('tune.cost', { total: gb(plan.cost.total), server: gb(plan.cost.server), bridge: gb(plan.cost.bridge), bots: gb(plan.cost.bots), colonists: gb(plan.cost.colonists), builders: plan.prof.builders, colonistsN: plan.prof.colonists }));
  if (plan.wildSeparate) say('  ' + t('tune.wildSeparate'));
  say();
  say(t('tune.changes.head'));
  const changes = plan.items.filter((i) => i.change);
  // Grouped by file; the item id (what a lock or --set names) is the group prefix + the key.
  const GROUPS = { start: t('tune.group.start'), 'server.properties': 'server/server.properties', 'paper-world': 'server/config/paper-world-defaults.yml', spigot: 'server/spigot.yml (world-settings.default)', bukkit: 'server/bukkit.yml', config: 'config.json', 'wild-config': 'wild-config.json', script: t('tune.group.scripts') };
  let group = null;
  for (const i of plan.items) {
    if (!i.change && !i.locked) continue;
    if (i.file !== group) {
      group = i.file;
      if (GROUPS[group]) say(`  ${GROUPS[group]}`);
    }
    const from = i.from == null ? t('tune.value.default') : String(i.from);
    const to = i.script ? t(i.from == null ? 'tune.value.create' : 'tune.value.rewrite') : String(i.to);
    const tail = i.locked ? t('tune.locked', { lock: i.locked }) : t(`tune.restart.${i.restart}`);
    const key = i.script ? i.id : i.id.replace(/^[^.]+\./, '');
    const value = i.locked ? (i.script ? '' : from) : (i.script ? '' : `${from} → `) + to;
    say(`    ${key.padEnd(i.script ? 24 : 46)} ${value}  (${tail})`);
  }
  if (!changes.length) say('  ' + t('tune.changes.none'));
  if (machine.flagsDropped.length) say('  ' + t('tune.flagsDropped', { flags: machine.flagsDropped.join(' ') }));
  say();
  for (const n of plan.notes) say(`${n.level === 'warn' ? '! ' : '- '}${t(n.key, n.params)}`);
  if (nowSpare < 0) {
    const others = ['otherServers', 'client', 'claude', 'otherNode', 'otherJava'].filter((r) => procs.roles[r]).map((r) => `${t(`tune.role.${r}`, { n: procs.roles[r].n })} ${t('tune.gb', { n: gb(procs.roles[r].mb) })}`);
    say('! ' + t('tune.now.missing', { missing: gb(-nowSpare), list: others.join(', ') }));
  } else say('- ' + t('tune.now.ok', { spare: gb(nowSpare) }));
  say('- ' + t('tune.client'));
  say();

  if (!opts.apply) {
    say(t('tune.next.dry'));
    console.log(out.join('\n'));
    return;
  }
  const res = applyPlan(plan, { root, paths, files });
  if (!res.written.length) say(t('tune.applied.nothing'));
  else {
    say(t('tune.applied.files', { files: res.written.join(', ') }));
    say(t('tune.applied.backup', { dir: path.relative(root, res.backupDir) }));
  }
  say();
  say(t('tune.restart.how'));
  say(t('tune.verify'));
  console.log(out.join('\n'));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.stack ?? err.message);
    process.exit(1);
  });
}
