// Samples the colony's load: server MSPT/TPS (RCON), RAM and CPU of the colony server (java) and the
// colony process (node), plus the colony's own metrics (/status). Windows (uses PowerShell).
//   WILD_CONFIG=.dev/wild-config.json node wild/measure.mjs [minutes=25] [intervalSec=60] > out.jsonl
import { execFileSync } from 'node:child_process';
import { Rcon } from '../bridge/rcon.mjs';
import { loadConfig } from './config.mjs';

const cfg = loadConfig();
const minutes = Number(process.argv[2] ?? 25);
const every = Number(process.argv[3] ?? 60) * 1000;
const r = new Rcon({ host: '127.0.0.1', port: cfg.rconPort, password: cfg.rconPassword });
await r.connect();

function procs() {
  // java listening on the colony port, node running colony.mjs
  const ps = `
$j = (Get-NetTCPConnection -LocalPort ${cfg.mcPort} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess
$n = (Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*colony.mjs*' } | Select-Object -First 1).ProcessId
$out = @{}
foreach ($p in @(@('java',$j),@('node',$n))) { if ($p[1]) { $x = Get-Process -Id $p[1]; $out[$p[0]] = @{ wsMB = [int]($x.WorkingSet64/1MB); cpuSec = [math]::Round($x.CPU,1) } } }
$out['freeMB'] = [int]((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1024)
$out | ConvertTo-Json -Compress`;
  try {
    return JSON.parse(execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8', timeout: 20000 }));
  } catch {
    return {};
  }
}

const end = Date.now() + minutes * 60000;
let last = null;
while (Date.now() < end) {
  const mspt = (await r.command('mspt').catch(() => '')).replace(/§./g, '').replace(/\s+/g, ' ').trim();
  const tps = (await r.command('tps').catch(() => '')).replace(/§./g, '').replace(/\s+/g, ' ').trim();
  const p = procs();
  let status = null;
  try {
    status = await (await fetch(`http://127.0.0.1:${cfg.port}/status`, { signal: AbortSignal.timeout(3000) })).json();
  } catch {}
  const now = Date.now();
  const cpu = last && p.java && p.node ? { javaPctCore: +((100 * (p.java.cpuSec - last.p.java.cpuSec)) / ((now - last.t) / 1000)).toFixed(1), nodePctCore: +((100 * (p.node.cpuSec - last.p.node.cpuSec)) / ((now - last.t) / 1000)).toFixed(1) } : null;
  console.log(JSON.stringify({ t: new Date(now).toISOString(), mspt, tps, procs: p, cpu, colonists: status?.colonists?.length ?? null, metrics: status?.metrics ?? null, treasury: status?.treasury?.credits ?? null, projects: status?.projects ?? null }));
  last = { t: now, p };
  await new Promise((res) => setTimeout(res, every));
}
r.close();
