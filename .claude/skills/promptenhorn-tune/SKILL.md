---
name: promptenhorn-tune
description: Tune the Promptenhorn Minecraft town for this computer. Use when the user wants to tune or optimize the server, asks how many bots, live builders or colonists their PC can handle, says the server or game is laggy, slow, low TPS or out of memory, or asks what Java memory / view distance to use.
---

# Tune Promptenhorn for this machine

`tools/tune.mjs` (no dependencies) measures the computer and, read-only over RCON, the running town server, then
prints a plan: JVM heap and flags, `server.properties`, Paper/Spigot/Bukkit values, bridge limits in `config.json`
(`builderBotsMax`, `colonistsMax`, speeds, life density) and the start scripts. Background: `docs/performance.md`.

## Steps

1. Run the dry run from the project root (writes nothing):
   ```
   node tools/tune.mjs
   ```
   Add `--json` if you want to read the plan programmatically, `--no-client` if the user plays Minecraft on another
   computer. The output is already in the language set in `config.json`.
2. Explain the plan to the user in their language, briefly:
   - the profile (low / medium / high) and why (total RAM, what else is using memory now);
   - the few changes that matter most: heap (`-Xmx`), `view-distance` / `simulation-distance`, `builderBotsMax`,
     `colonistsMax`; group the Paper/Spigot/Bukkit lines as "server tick savings";
   - any `!` warnings, e.g. "right now X GB would be missing" with the biggest other programs (test servers,
     the launcher, Claude) and what closing them would free.
   If the user wants to keep a value (say a far view distance), add it to `config.json`
   `"tuning": { "lock": ["server.view-distance"] }` (ids as printed: `server.*`, `jvm.xmx`, `paper-world.*`,
   `spigot.*`, `bukkit.*`, `builderBotsMax`…) or pass `--set <id>=<value>`, and run the dry run again.
3. Ask before applying. Only after a clear yes:
   ```
   node tools/tune.mjs --apply
   ```
   It backs up every file it changes to `backups/tune/<time>/`. Never restart the server or the bridge yourself.
4. Tell the user how to restart: type `stop` in the server window, close the bridge window, start `start.cmd`
   again (macOS / Linux: `./start.sh`). `builderBotsMax`, `renovateBlocksPerSecond` and `lifeDensity` apply live;
   everything else needs the restart.
5. Verify afterwards: in the server console `tps` (should be 20) and `mspt` (well under 50 ms; the town idles at
   2–5 ms), or run `node tools/tune.mjs` again — it should report nothing left to change. To undo, copy the files
   back from the backup folder.
