// Scenario simulator for the test bridge: posts hook events in the reduced shape alps-hook.mjs sends.
// Usage: node .dev/sim2.mjs <scenario> [args]   (ALPS_URL defaults to the test bridge on 7778)
//   chats N project        N chats prompt and work a bit (Edit/Read/Bash)
//   work id n [tool]       n PostToolUse events for chat `id`
//   tests id fail|pass     a failing / passing test run
//   commit id | push id | pr id | rmrf id | interrupt id
//   wait id [ms]           PermissionRequest, then (after ms) the tool runs
//   question id | idle id  Notification elicitation_dialog / idle_prompt
//   agents id n [ms]       n subagents start, stop after ms
//   compact id | limit id | plan id on|off | model id opus | stop id | end id
const URL = process.env.ALPS_URL || 'http://127.0.0.1:7778/event';
const [scenario, ...args] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sid = (id) => (id.length >= 12 ? id : `${id.padEnd(4, '0')}sim-${id}-0000`); // the first 8 chars name the builder
const cwd = (project = 'testproj') => String.raw`C:\Users\linka\Desktop\projects` + '\\' + project;
async function send(id, ev, project) {
  const body = { session_id: sid(id), cwd: cwd(project), t: Date.now(), ...ev };
  const res = await fetch(URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (res.status !== 204) console.log('status', res.status);
}
const tool = (id, name, extra = {}) => send(id, { hook_event_name: 'PostToolUse', tool: name, ok: true, ...extra });

switch (scenario) {
  case 'chats': {
    const n = Number(args[0] ?? 2);
    const project = args[1] ?? 'testproj';
    for (let i = 0; i < n; i++) {
      await send(`c${i}`, { hook_event_name: 'SessionStart', source: 'startup', model: ['opus', 'sonnet', 'haiku'][i % 3] }, project);
      await send(`c${i}`, { hook_event_name: 'UserPromptSubmit', prompt: `Задача ${i}: починить ${project}` }, project);
    }
    for (let k = 0; k < Number(args[2] ?? 10); k++) for (let i = 0; i < n; i++) await tool(`c${i}`, ['Edit', 'Read', 'Bash', 'Grep', 'Write'][k % 5]);
    break;
  }
  case 'work':
    for (let k = 0; k < Number(args[1] ?? 10); k++) await tool(args[0], args[2] ?? 'Edit');
    break;
  case 'tests':
    if (args[1] === 'pass') await tool(args[0], 'Bash', { kinds: ['test'] });
    else await send(args[0], { hook_event_name: 'PostToolUseFailure', tool: 'Bash', ok: false, kinds: ['test'], exit: 1 });
    break;
  case 'commit':
  case 'push':
  case 'pr':
  case 'rmrf':
    await tool(args[0], 'Bash', { kinds: [scenario] });
    break;
  case 'interrupt':
    await send(args[0], { hook_event_name: 'PostToolUseFailure', tool: 'Bash', ok: false, interrupt: true });
    break;
  case 'wait':
    await send(args[0], { hook_event_name: 'PermissionRequest', tool: 'Bash' });
    await sleep(Number(args[1] ?? 0));
    if (args[1]) await tool(args[0], 'Bash');
    break;
  case 'question':
    await send(args[0], { hook_event_name: 'Notification', ntype: 'elicitation_dialog' });
    break;
  case 'idle':
    await send(args[0], { hook_event_name: 'Stop' });
    await sleep(200);
    await send(args[0], { hook_event_name: 'Notification', ntype: 'idle_prompt' });
    break;
  case 'agents': {
    const n = Number(args[1] ?? 2);
    const types = ['Explore', 'Plan', 'general-purpose', 'Explore', 'Plan'];
    for (let i = 0; i < n; i++) await send(args[0], { hook_event_name: 'SubagentStart', agent_id: `agent${i}x${Date.now() % 1000}`, agent_type: types[i % 5] });
    if (args[2]) {
      await sleep(Number(args[2]));
      // stop them again (ids are needed: re-list via /status is overkill for a dev tool, so stop by type order)
    }
    break;
  }
  case 'agentstop':
    await send(args[0], { hook_event_name: 'SubagentStop', agent_id: args[1], agent_type: 'Explore' });
    break;
  case 'compact':
    await send(args[0], { hook_event_name: 'PreCompact', trigger: 'auto' });
    break;
  case 'limit':
    await send(args[0], { hook_event_name: 'StopFailure', error: 'rate_limit' });
    break;
  case 'plan':
    await tool(args[0], 'Read', { mode: args[1] === 'off' ? 'default' : 'plan' });
    break;
  case 'model':
    await send(args[0], { hook_event_name: 'PostModelSwitch', model: args[1] });
    break;
  case 'stop':
    await send(args[0], { hook_event_name: 'Stop', transcript: args[1] });
    break;
  case 'end':
    await send(args[0], { hook_event_name: 'SessionEnd', reason: 'other' });
    break;
  default:
    console.log('unknown scenario; see the header of this file');
}
