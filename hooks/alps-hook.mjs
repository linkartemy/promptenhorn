// Claude Code hook: forwards a hook event (stdin JSON) to the local Promptenhorn bridge.
// Prints nothing and always exits 0, so it never adds tokens to the conversation, never makes a
// decision for Claude and never blocks it (install-hooks.mjs registers it as an async hook).
// Privacy: the event is reduced here to small derived signals ({kind: "test", ok: false}, the tool
// name, the notification type…); commands, file contents and tool output never leave this process.
// The only text forwarded is the start of the first prompt (it names the builder).
import fs from 'node:fs';

const started = Date.now(); // events are ordered by this (async hooks can arrive out of order)
const url = process.env.CLAUDE_ALPS_URL || 'http://127.0.0.1:7777/event';
const heartbeat = new URL('../.alps-heartbeat', import.meta.url);

// The bridge touches this file every 3 seconds. If it is stale the bridge is not running:
// exit at once instead of waiting for a refused connection (which takes ~1s on Windows).
try {
  if (Date.now() - fs.statSync(heartbeat).mtimeMs > 8000) process.exit(0);
} catch {
  process.exit(0);
}

const word = (v, max = 48) => (typeof v === 'string' && /^[\w.:-]+$/.test(v) ? v.slice(0, max) : undefined);

/** What a shell command is about, by pattern only. Several kinds are possible ("git commit && git push"). */
export function classify(command) {
  if (typeof command !== 'string') return [];
  const c = command.slice(0, 4000);
  const kinds = [];
  if (/\b(npm|pnpm|yarn|bun)\s+(run\s+)?test\b|\b(pytest|vitest|jest|mocha|phpunit|rspec|ctest|tox|nox)\b|\b(cargo|go|dotnet|deno|swift|mix|zig)\s+test\b|\bnode\s+--test\b|\b(mvn|gradlew?)\b[^\n|;&]*\btest\b|\bmake\s+(test|check)\b|\bya\s+make\b[^\n|;&]*\s-t\b|\bunittest\b/.test(c)) kinds.push('test');
  if (/\b(git|arc|hg|jj)\b[^\n|;&]*\bcommit\b/.test(c)) kinds.push('commit');
  if (/\b(git|arc|hg|jj)\b[^\n|;&]*\bpush\b/.test(c)) kinds.push('push');
  if (/\b(gh|arc)\s+pr\s+create\b|\bglab\s+mr\s+create\b/.test(c)) kinds.push('pr');
  if (/\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r|-r\s+-f|-f\s+-r)\b|\bRemove-Item\b[^\n]*-Recurse/i.test(c)) kinds.push('rmrf');
  return kinds;
}

/** Model family only (opus / sonnet / haiku / fable), never the full id. */
function family(model) {
  const m = typeof model === 'string' ? model : model?.id ?? model?.display_name;
  return String(m ?? '').toLowerCase().match(/opus|sonnet|haiku|fable/)?.[0];
}

/** The small payload the bridge actually uses. */
export function reduce(ev) {
  const name = ev.hook_event_name;
  const out = { session_id: ev.session_id, hook_event_name: name, cwd: ev.cwd, t: started };
  const mode = word(ev.permission_mode);
  if (mode) out.mode = mode;
  const tool = typeof ev.tool_name === 'string' ? (ev.tool_name.startsWith('mcp__') ? 'mcp' : word(ev.tool_name)) : undefined;
  switch (name) {
    case 'SessionStart':
      out.source = word(ev.source);
      out.model = family(ev.model);
      break;
    case 'UserPromptSubmit':
      if (typeof ev.prompt === 'string') out.prompt = ev.prompt.slice(0, 300);
      break;
    case 'PostToolUse':
    case 'PostToolUseFailure':
      out.tool = tool;
      out.ok = name === 'PostToolUse';
      if (ev.agent_id) out.sub = true; // a tool call made inside a subagent
      if (tool === 'Bash' || tool === 'PowerShell') {
        const kinds = classify(ev.tool_input?.command);
        if (kinds.length) out.kinds = kinds;
      }
      if (name === 'PostToolUseFailure') {
        if (ev.is_interrupt === true) out.interrupt = true;
        const exit = typeof ev.error === 'string' && ev.error.match(/^Exit code (\d+)/);
        if (exit) out.exit = Number(exit[1]);
      }
      break;
    case 'PermissionRequest':
      out.tool = tool;
      break;
    case 'Notification':
      out.ntype = word(ev.notification_type);
      break;
    case 'SubagentStart':
    case 'SubagentStop':
      out.agent_id = word(ev.agent_id, 64);
      out.agent_type = word(ev.agent_type, 40);
      if (name === 'SubagentStop' && typeof ev.agent_transcript_path === 'string') out.transcript = ev.agent_transcript_path;
      break;
    case 'PreCompact':
      out.trigger = word(ev.trigger);
      break;
    case 'StopFailure':
      out.error = word(ev.error);
      if (typeof ev.transcript_path === 'string') out.transcript = ev.transcript_path;
      break;
    case 'PostModelSwitch':
      out.model = family(ev.to_model ?? ev.model);
      break;
    case 'Stop':
    case 'SessionEnd':
      out.reason = word(ev.reason);
      // Local path only: the bridge reads the token counts ("usage") from it, nothing else.
      if (typeof ev.transcript_path === 'string') out.transcript = ev.transcript_path;
      break;
  }
  return out;
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
  if (input.length > 8 * 1024 * 1024) process.exit(0); // never buffer a huge tool payload
});
process.stdin.on('end', async () => {
  try {
    const body = JSON.stringify(reduce(JSON.parse(input)));
    await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(800) });
  } catch {
    // Bridge went away or bad input: ignore.
  }
  process.exit(0);
});
setTimeout(() => process.exit(0), 1500);
