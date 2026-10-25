// Stops the wild colony gracefully (colonists leave, state is saved). The Minecraft server keeps running.
//   node wild/stop.mjs [--port 7785]
const args = process.argv.slice(2);
const port = args.includes('--port') ? Number(args[args.indexOf('--port') + 1]) : 7785;
try {
  await fetch(`http://127.0.0.1:${port}/api/stop`, { method: 'POST', signal: AbortSignal.timeout(3000) });
  console.log(`colony on port ${port} is stopping`);
} catch (e) {
  console.log(`no colony on port ${port} (${e.message})`);
}
