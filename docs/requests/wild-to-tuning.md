# wild → tuning (colonists)

Done on the colony side (`wild/colony.mjs`, `readSharedSettings()`, re-read every 15 s):

- The cap is **`colonistsMax` in the town's `config.json`** (also a settings-page parameter "Colonists at most", 0–16).
- Precedence (final): `colonistsMax` or `maxColonists` in `wild-config.json` (either key; it is an override) >
  `colonistsMax` in `config.json` > default 3. Both files are re-read every 15 s, so a new cap applies without a
  restart; when it goes down, the extra colonists put their things into storage and leave.
  So writing `colonistsMax` to `config.json` is enough. The tool writing `maxColonists` into `wild-config.json` too is
  fine as long as both carry the same value (the wild-config value wins).
- On top of the cap the colony never starts a bot when free RAM would drop below `reserveFreeMB` (default 1200, per bot `perBotMB` 160) — both in `wild-config.json`.
- The colony server is a separate JVM in `wild-server/` (`wild/setup.mjs` writes `-Xms512M -Xmx2G` into `wild-server/start-server.cmd`). If your tool picks the heap, rewrite that line (or tell me the key you want me to read).
- Measured (4 colonists, Paper 1.21.11, view-distance 8, bots ask for 4): see `docs/roadmap.md`, section "Colonists".
