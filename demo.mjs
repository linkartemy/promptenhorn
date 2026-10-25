// Simulates a few Claude Code chats so you can watch the builders without real sessions.
// Usage: node demo.mjs [minutes]   (bridge must be running)
const URL = process.env.ALPS_URL || 'http://127.0.0.1:7777/event';
const minutes = Number(process.argv[2] ?? 3);

const chats = [
  { session_id: 'demo-aaaa-0001', cwd: 'C:/demo/Demodorf', prompt: 'Добавить авторизацию через OAuth' },
  { session_id: 'demo-bbbb-0002', cwd: 'C:/demo/Demodorf', prompt: 'Починить flaky тесты в CI' },
  { session_id: 'demo-cccc-0003', cwd: 'C:/demo/Demodorf', prompt: 'Рефакторинг модуля платежей' },
];
const tools = ['Read', 'Grep', 'Edit', 'Edit', 'Bash', 'Write'];

const send = (ev) =>
  fetch(URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ev) }).catch(() => {});

for (const c of chats) {
  await send({ ...c, hook_event_name: 'SessionStart', source: 'startup' });
  await send({ ...c, hook_event_name: 'UserPromptSubmit' });
}
console.log(`Demo: ${chats.length} chats working for ${minutes} min`);

const end = Date.now() + minutes * 60000;
const timer = setInterval(async () => {
  if (Date.now() > end) {
    clearInterval(timer);
    for (const c of chats) await send({ ...c, hook_event_name: 'Stop' });
    console.log('Demo finished: builders are now idle (Stop sent).');
    return;
  }
  const c = chats[Math.floor(Math.random() * chats.length)];
  await send({ ...c, hook_event_name: 'PostToolUse', tool_name: tools[Math.floor(Math.random() * tools.length)] });
}, 700);
