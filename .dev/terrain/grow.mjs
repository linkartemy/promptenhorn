// Keeps simulated chats working against the terrain test bridge so the town grows.
// node .dev/terrain/grow.mjs <minutes> [projects=3] [chatsPerProject=3]
const URL = process.env.ALPS_URL || 'http://127.0.0.1:7782/event';
const minutes = Number(process.argv[2] ?? 10);
const projects = ['seeufer', 'bergdorf', 'altstadt', 'hafen'].slice(0, Number(process.argv[3] ?? 3));
const per = Number(process.argv[4] ?? 3);
const chats = projects.flatMap((p, i) => Array.from({ length: per }, (_, k) => ({ session_id: `t${i}${k}terr-${p}-0000`, cwd: 'C:/Users/linka/Desktop/projects/' + p })));
const send = (c, ev) => fetch(URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...c, t: Date.now(), ...ev }) }).catch(() => {});
for (const c of chats) {
  await send(c, { hook_event_name: 'SessionStart', source: 'startup', model: 'opus' });
  await send(c, { hook_event_name: 'UserPromptSubmit', prompt: `Task for ${c.cwd.split('/').pop()}` });
}
const end = Date.now() + minutes * 60000;
while (Date.now() < end) {
  for (const c of chats) await send(c, { hook_event_name: 'PostToolUse', tool: 'Edit', ok: true });
  await new Promise((r) => setTimeout(r, 4000));
}
console.log('grow done');
