// Adds (or with --uninstall removes) the Promptenhorn hooks in ~/.claude/settings.json.
// Safe to run again: our entries are recognised by the script name and replaced, everything else in
// settings.json (other hooks included) is kept. A timestamped backup is written first.
//
// All hooks except SessionEnd are `"async": true` (Claude Code then starts them in the background and
// never waits for them); the hook prints nothing, so nothing reaches the conversation. PreToolUse is
// never subscribed (it would sit in front of every tool call).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MARKER = 'alps-hook.mjs';
export const EVENTS = [
  { event: 'SessionStart', async: true },
  { event: 'UserPromptSubmit', async: true },
  { event: 'PostToolUse', async: true },
  { event: 'PostToolUseFailure', async: true },
  { event: 'PermissionRequest', async: true },
  { event: 'Notification', async: true, matcher: 'permission_prompt|idle_prompt|elicitation_dialog|agent_needs_input' },
  { event: 'SubagentStart', async: true },
  { event: 'SubagentStop', async: true },
  { event: 'PreCompact', async: true },
  { event: 'Stop', async: true },
  { event: 'StopFailure', async: true },
  { event: 'PostModelSwitch', async: true },
  // Synchronous on purpose: Claude Code may be exiting, and the "chat closed" signal must arrive.
  { event: 'SessionEnd', async: false },
];

const uninstall = process.argv.includes('--uninstall');
const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
const hookScript = path.join(path.dirname(fileURLToPath(import.meta.url)), 'hooks', 'alps-hook.mjs');

const settings = fs.existsSync(settingsPath) ? JSON.parse(fs.readFileSync(settingsPath, 'utf8')) : {};
if (fs.existsSync(settingsPath)) {
  const backup = `${settingsPath}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.copyFileSync(settingsPath, backup);
  console.log(`Backup: ${backup}`);
}

settings.hooks ??= {};
// Remove our entries from every event (also from events this version no longer uses).
for (const event of Object.keys(settings.hooks)) {
  const groups = (settings.hooks[event] ?? [])
    .map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => !String(h.command ?? '').includes(MARKER)) }))
    .filter((g) => g.hooks.length > 0);
  if (groups.length) settings.hooks[event] = groups;
  else delete settings.hooks[event];
}
if (!uninstall) {
  for (const { event, async, matcher } of EVENTS) {
    const hook = { type: 'command', command: `node "${hookScript}"`, timeout: 3 };
    if (async) hook.async = true;
    (settings.hooks[event] ??= []).push({ ...(matcher ? { matcher } : {}), hooks: [hook] });
  }
}
if (!Object.keys(settings.hooks).length) delete settings.hooks;

fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
console.log(uninstall ? 'Promptenhorn hooks removed.' : `Promptenhorn hooks installed for: ${EVENTS.map((e) => e.event).join(', ')}`);
console.log('New Claude Code sessions will pick them up.');
