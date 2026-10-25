# Rules for agents working on Promptenhorn in parallel

Five agents work at the same time in this checkout. Read this before touching anything.

## Never
- Never touch the LIVE city: Minecraft server in `server/` (ports 25565 / RCON 25575), the live bridge on port 7777, `state.json`, `config.json`, `bridge.log`, `backups/`. The user is playing right now. No RCON to 25575, no restarts, no file edits there. Reading `server/world` region files read-only is OK.
- Never run git commands (the main engineer commits).
- Never edit files owned by another agent (see ownership below). If you need a change there, write the request into `docs/requests/<your-name>-to-<owner>.md` and mention it in your report.
- Never reformat or rewrite whole files you share (`bridge/bridge.mjs`): make small, local edits with the Edit tool and re-read the file right before each edit (others change it too).

## Shared test infrastructure
- Test server: `.dev/test-server` (game 25566, RCON 25576, password in its `server.properties`). Shared by several agents. If it isn't running (`netstat -ano | findstr 25576`), start it from that directory with `java -Xms1G -Xmx2G -jar paper.jar nogui` (background). Do NOT stop it — others use it. RAM is tight (~4 GB free): don't start extra servers except where your brief says so.
- Wild server: `.dev/wild-server` (25567 / 25577) — only the wild-mode agent uses it.
- Your own test bridge: copy `.dev/test-config.json` to `.dev/test-config-<you>.json` and set your own `port`, `stateFile` (`.dev/test-state-<you>.json`), `heartbeatFile` (`.dev/test-heartbeat-<you>`) and a far-away `searchOrigin` so your test city doesn't overlap others:
  - bots: port 7781, searchOrigin [40000, 0]
  - terrain: port 7782, searchOrigin [0, 40000]
  - architect: (no bridge needed; in-game checks at x≈20000+, z≈20000+)
  - life: port 7784, searchOrigin [-40000, 0]
  - wild: own server, port 7785
- Run with `ALPS_CONFIG=.dev/test-config-<you>.json node bridge/bridge.mjs`. Simulate chats with `.dev/sim.mjs` / `.dev/sim2.mjs` (set `ALPS_URL=http://127.0.0.1:<port>/event`; POST JSON with `Content-Type: application/json`).
- Tools: `node tools/validate-blocks.mjs`, `node tools/walkcheck.mjs all 5`, `node .dev/ingame-check.mjs`, `node tools/map.mjs --help` (region-file renderer), `node tools/terrain-report.mjs`, the web map of your test bridge at `http://127.0.0.1:<port>/map`.

## File ownership
| Agent | Owns |
|---|---|
| bots (realistic mode) | `bots/` (except `bots/wild/`), `bridge/builders/` (new), builder spawn/move/place code in `bridge/bridge.mjs` (ensureBuilder, moveBuilderToFront, setPose, the block-placing loop in `work()`), builder-mode setting |
| wild | `wild/` (new), `bots/wild/` (new), `.dev/wild-server/`, wild-mode settings entries |
| terrain | `bridge/terrain.mjs`, `bridge/terrain-scan.mjs`, `bridge/city.mjs`, new `bridge/infra.mjs` (piers, quays, promenades, beaches, bridges, breakwaters), plot creation code in `bridge/bridge.mjs` (plotGround, createPlot, stitchSeam, lampPost, streetTexture), `tools/terrain-report.mjs` |
| architect | `.dev/parts/*` → `bridge/buildings.mjs` (via `node .dev/assemble.mjs`), `bridge/blueprint.mjs`, `tools/walkcheck.mjs`, `tools/validate-blocks.mjs`, `tools/preview.mjs`, `docs/building-standards.md`, `docs/generator-contract.md` |
| life | `bridge/features/life.mjs`, `bridge/smallforms.mjs`, `bridge/features/chronicle.mjs`, economy/stage logic, new `bridge/features/*` files for life/economy, and the strings of all other `bridge/features/*.mjs` you verify |
| i18n | `bridge/i18n.mjs`, `locales/*.json`, `README*.md`, `docs/i18n.md`, `bridge/settings-page.mjs`, `bridge/map-page.mjs`, `bridge/settings.mjs` (labels), `configure.mjs`, `datapack/`, user-visible strings in the core of `bridge/bridge.mjs` (announce/welcome/scoreboard labels) |

## Localization (applies to everyone)
English is now the default language everywhere. Read `docs/i18n.md`. Every user-visible string you write or touch goes through `t()` from `bridge/i18n.mjs`; add the key with English text to `locales/en.json` and the Russian text to `locales/ru.json` (edit these two JSON files with small, careful edits — several agents add keys; re-read right before editing, keep keys sorted by module prefix, keep valid JSON). Before you finish, convert the remaining Russian/hard-coded user-visible strings in the files you own. Logs, comments and Swiss shop signs stay as they are.

Shared, edit carefully and only small parts: `bridge/bridge.mjs`, `bridge/features/index.mjs`, `bridge/settings.mjs`, `README.md`, `docs/roadmap.md` (append your section; don't rewrite others').

## Quality bar
- Realism + beauty (see `docs/building-standards.md`), zero tokens, hooks never slow Claude, bounded RCON/entity cost.
- Every feature behind a toggle; when it's verified on the test server, add its id to `TESTED` in `bridge/features/index.mjs` so presets include it.
- `node --check` every file you touch. Don't leave test servers/bridges/bot processes of yours running when you finish (except the shared test server).
- Final report: what's done, test evidence, what the main engineer must do to deploy, open issues.
