// Dev: load figures while live builders work — server MSPT/TPS (Paper /mspt, /tps), loaded chunks,
// players, Java and bot-runner memory, and the bridge's own view (/status). TEST server only.
//   node measure.mjs [--bridge http://127.0.0.1:7781] [--samples 6] [--every 10]
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Rcon } from '../bridge/rcon.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const props = Object.fromEntries(fs.readFileSync(path.join(here, '..', '.dev', 'test-server', 'server.properties'), 'utf8').split(/\r?\n/).filter((l) => /^[^#].*=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
if (props['rcon.port'] !== '25576') throw new Error('not the test server');
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const bridge = opt('bridge', 'http://127.0.0.1:7781');
const rcon = new Rcon({ port: 25576, password: props['rcon.password'] });
await rcon.connect();
const strip = (s) => s.replace(/§./g, '');
const pidOn = (port) => execSync('netstat -ano').toString().split(/\r?\n/).find((l) => l.includes(`127.0.0.1:${port} `) && l.includes('LISTENING'))?.trim().split(/\s+/).pop();
const memMB = (pid) => {
  if (!pid) return null;
  const ws = execSync(`powershell -NoProfile -Command "(Get-Process -Id ${pid}).WorkingSet64"`).toString().trim();
  return Number(ws) ? Math.round(Number(ws) / 1048576) : null;
};
const javaPid = pidOn(25576);
for (let i = 0; i < Number(opt('samples', 6)); i++) {
  const mspt = strip(await rcon.command('mspt')).replace(/\s+/g, ' ').trim();
  const tps = strip(await rcon.command('tps')).replace(/\s+/g, ' ').trim();
  const list = strip(await rcon.command('list')).trim();
  let st = null;
  try {
    st = await (await fetch(`${bridge}/status`)).json();
  } catch {}
  const bots = st?.builders?.stats;
  console.log(JSON.stringify({
    t: new Date().toLocaleTimeString(), mspt, tps, players: list, javaMB: memMB(javaPid), runnerMB: bots?.rssMB ?? null, runnerCpuPct: bots?.cpuPct ?? null,
    bots: bots?.bots?.map((b) => `${b.name}:${b.job}@${b.blocksPerMin ?? '-'}/min stuck=${b.stats.stuck} hand=${b.stats.hand} rcon=${b.stats.rcon}`),
  }));
  await new Promise((r) => setTimeout(r, Number(opt('every', 10)) * 1000));
}
rcon.close();
process.exit(0);
