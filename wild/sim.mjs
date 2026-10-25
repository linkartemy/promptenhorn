// Development: simulates Claude Code chats against the colony (POST /event), like the bridge would forward.
//   node wild/sim.mjs [chats=2] [minutes=25] [--port 7785] [--sessions id1,id2,...]
// --sessions continues existing chats (their colonists keep their names and inventories) instead of new ones.
// Each chat: SessionStart, a prompt, then bursts of tool calls with pauses; sometimes failing tests,
// commits and a subagent (helper colonist). Chat 2 goes idle for a while in the middle.
const args = process.argv.slice(2);
const port = args.includes('--port') ? Number(args[args.indexOf('--port') + 1]) : 7785;
const nums = args.filter((a) => /^\d+$/.test(a) && a !== String(port)).map(Number);
const given = args.includes('--sessions') ? args[args.indexOf('--sessions') + 1].split(',').filter(Boolean) : null;
const chats = given ? given.length : nums[0] ?? 2;
const minutes = nums[1] ?? 25;
const url = `http://127.0.0.1:${port}/event`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (ev) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ t: Date.now(), cwd: 'C:/work/demo', ...ev }) }).catch((e) => console.log('post failed', e.message));
const PROMPTS = ['Fix the login form validation', 'Refactor the payment service', 'Write docs for the API', 'Add dark mode to settings'];
const TOOLS = ['Read', 'Grep', 'Edit', 'Bash', 'Edit', 'Write', 'Read', 'Bash', 'Glob'];
const end = Date.now() + minutes * 60000;

async function chat(i) {
  const id = given?.[i] ?? `sim-wild-${i}-${Math.random().toString(16).slice(2, 10)}`;
  await post({ session_id: id, hook_event_name: 'SessionStart', source: 'startup' });
  await post({ session_id: id, hook_event_name: 'UserPromptSubmit', prompt: PROMPTS[i % PROMPTS.length] });
  let n = 0;
  while (Date.now() < end) {
    // a burst of work
    const burst = 5 + Math.floor(Math.random() * 15);
    for (let k = 0; k < burst && Date.now() < end; k++) {
      const tool = TOOLS[Math.floor(Math.random() * TOOLS.length)];
      const ev = { session_id: id, hook_event_name: 'PostToolUse', tool, ok: true };
      if (tool === 'Bash' && Math.random() < 0.25) {
        ev.kinds = ['test'];
        if (Math.random() < 0.4) {
          ev.hook_event_name = 'PostToolUseFailure';
          ev.ok = false;
          ev.exit = 1;
        }
      }
      if (tool === 'Bash' && Math.random() < 0.06) ev.kinds = ['commit'];
      await post(ev);
      n++;
      await sleep(2000 + Math.random() * 5000);
    }
    if (Math.random() < 0.15) {
      const agent = `agent${n}`;
      await post({ session_id: id, hook_event_name: 'SubagentStart', agent_id: agent, agent_type: 'Explore' });
      setTimeout(() => post({ session_id: id, hook_event_name: 'SubagentStop', agent_id: agent }), 120000);
    }
    await post({ session_id: id, hook_event_name: 'Stop' });
    // chat 1 takes a long break once (its colonist goes home and guards)
    const pause = i === 1 && n > 40 && n < 70 ? 6 * 60000 : 15000 + Math.random() * 45000;
    await sleep(pause);
    await post({ session_id: id, hook_event_name: 'UserPromptSubmit', prompt: 'continue' });
  }
  await post({ session_id: id, hook_event_name: 'SessionEnd', reason: 'exit' });
  console.log(`chat ${i} done after ${n} tool calls`);
}

await Promise.all(Array.from({ length: chats }, (_, i) => sleep(i * 8000).then(() => chat(i))));
