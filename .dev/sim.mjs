// Simulated chats across several projects, against the test bridge.
const URL = process.env.ALPS_URL || 'http://127.0.0.1:7778/event';
const seconds = Number(process.argv[2] ?? 60);
const projects = ['newpoint', 'newpoint-backend', 'coaas', 'sre-hw-grafana'];
const chats = projects.flatMap((p, i) => [0, 1].map((k) => ({ session_id: `sim${i}${k}-${p}`, cwd: String.raw`C:\Users\linka\Desktop\projects` + '\\' + p, project: p })));
const send = (ev) => fetch(URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ev) }).catch(() => {});
await send({ ...chats[0], hook_event_name: 'UserPromptSubmit', prompt: 'The user started this session from the desktop app' });
for (const c of chats) await send({ ...c, hook_event_name: 'UserPromptSubmit', prompt: `Задача для ${c.project} номер ${c.session_id.slice(3, 5)}` });
const end = Date.now() + seconds * 1000;
while (Date.now() < end) {
  for (const c of chats) await send({ ...c, hook_event_name: 'PostToolUse', tool_name: 'Edit' });
  await new Promise((r) => setTimeout(r, 2000));
}
for (const c of chats) await send({ ...c, hook_event_name: 'Stop' });
console.log('sim done');
