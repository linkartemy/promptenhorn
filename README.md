**English** · [Русский](README.ru.md) · [Español](README.es.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Italiano](README.it.md) · [Português](README.pt.md) · [中文](README.zh.md) · [日本語](README.ja.md)

# Promptenhorn

*A Matterhorn built out of prompts.* Inside the game, the world is called Claude Alps.

Every Claude Code chat becomes a builder in Minecraft. While Claude works, the builder (Steve, Alex, Kai…) puts up a house. The houses grow into a little Swiss town: first a village of chalets, then an old town with arcades, a church and a hotel, then modern districts.

It costs no tokens: the hooks are plain local commands. They print nothing to the chat, make no decisions for Claude and run in the background (`async`), so Claude never waits for them.

![The town by day: the clock tower, a district square, old-town houses by the lake. On the right, the list of chat builders and their builds](docs/screenshots/city-day.webp)

![At night: the builder of the chat "some houses are missing rea…" plants a spruce for the district's public works](docs/screenshots/builder-night.webp)

## How it works

```
Claude Code ──hook──▶ hooks/alps-hook.mjs ──HTTP──▶ bridge/bridge.mjs ──RCON──▶ Minecraft (Paper 1.21.11)
                                                        │
                                                        ├── http://127.0.0.1:7777/     settings page
                                                        └── http://127.0.0.1:7777/map  live town map
```

| Claude Code event | What happens in the world |
|---|---|
| New chat | A builder appears |
| Your message | The builder gets a name (the first words of your prompt) and a plot |
| Claude edits files, runs commands | Construction goes on (~3 blocks/s) plus a bonus for every action |
| Claude finishes its reply | The builder waits by the house; after 30 minutes it goes to sleep |
| House finished | Fireworks, a villager moves in, the builder heads to the next plot |
| Chat closed | The builder leaves; the next chat finishes any half-built house |

- One project (folder) = one district. The town is placed in an Alpine valley among the mountains.
- A sidebar on the right lists every active chat with its progress in percent.
- When you join the game, the chat shows the list of districts (click to teleport) and a link to the settings.

## Privacy

The hook boils each event down to small signals and sends only those to the bridge: the tool name, the notification type, "that was a test and it failed", "that was a commit". Commands, file contents, tool output and Claude's replies never leave the hook. The one exception is the first words of the first message: they become the builder's name. The prompt text goes into the chronicle book only when the "Prompt text in the chronicle" option is on (it is off in every preset).

## Getting started

You need Java 21+ and Node.js 18+.

1. Install the hooks once:
   ```
   node install-hooks.mjs
   ```
   The script adds the hooks to `~/.claude/settings.json` and writes a backup next to it. Other hooks are left alone, and running it again is safe. Only new chats pick the hooks up.
2. Put a Paper 1.21.11 server at `server/paper.jar`. The repository ships no game files: you download the server yourself and, by running it, accept the [Minecraft EULA](https://aka.ms/MinecraftEULA) (see [NOTICE.md](NOTICE.md)).
3. Start the server and the bridge: double-click `start.cmd` (two minimized windows open).
4. In TLauncher pick version **1.21.11** → "Multiplayer" → server `localhost`.
5. Work with Claude as usual and watch the town grow. Fly around in creative or with `/gamemode spectator`.

To try it without real chats: with the bridge running, run `node demo.mjs 3`.

## Live map

**http://127.0.0.1:7777/map** shows the town right in your browser: plots, districts and builders as moving dots, along with what each chat is doing right now (editing, running commands, waiting for your permission, sleeping…). The "Teleport" and "Follow" buttons take you to a builder in the game (you need to be on the server). The map reads only the bridge's state: no world files, no client mods. There is a link to it at the top of the settings page.

## Language

By default everything you see in the world and on the bridge's pages is in English. The language switches live, without a restart: use the drop-down on the settings page or the terminal:

```
node configure.mjs language ru     # en | ru | es | de | fr | it | pt | zh | ja
```

Supported: English, Русский, Español, Deutsch, Français, Italiano, Português, 中文 and 日本語. The value is stored in `config.json` as `"language"`; any string that has no translation yet is shown in English. Swiss shop signs on the buildings (e.g. `BAECKEREI`) stay in Swiss German on purpose. How localization works: `docs/i18n.md`.

## Settings: presets and features

Open **http://127.0.0.1:7777/** (there is also a "[settings]" link in the in-game chat when you join). Changes apply immediately, without a restart, and are saved to `config.json` (`preset` + `features`).

| Preset | What is on |
|---|---|
| Minimal | Builders and houses, like the first version |
| Basic (default) | Tested features that don't make noise |
| Max | Every tested feature |

On top of a preset you can switch any feature on or off. Features marked "experimental" are written but not yet fully tested in the world: they are not part of any preset and can only be turned on by hand. The status of every feature is in `docs/roadmap.md`.

The same from the terminal:

```
node configure.mjs                 # preset and all features
node configure.mjs basic           # choose a preset (minimal | basic | max)
node configure.mjs tests on        # switch one feature on on top of the preset
node configure.mjs tests reset     # back to what the preset says
node configure.mjs language de     # change the language
```

A running bridge picks up changes to `config.json` within a couple of seconds.

### Features

| Group | Features |
|---|---|
| Claude at work | The builder calls you (waiting for permission or an answer: "!", a bell, a red bar), yellow "waiting for a task" bar, tests (sparks, a flag, a rain cloud), commit = bell, push = PostAuto bus, PR = canton flag, web search = mail allay, compaction = coffee break, API limit = thunderstorm in the mountains, plan mode = architect |
| Builders | Status under the name, tool in hand, subagent apprentices |
| Town | Real day and night, lights in the windows, smoke from the chimney, chat economy, **renovation instead of demolition**, villagers by profession, scaffolding, the Zytglogge strikes the hours |
| Progress | Advancements, house chronicle, settlement rank (Weiler → Dorf → Städtli → Stadt), francs for tokens (a "Kasse: CHF …" board), Matterhorn progress bar |
| Information | Town hall (a window with every builder), builders on the locator bar, "while you were away" |
| Easter eggs | Alphorn when a house is finished, little touches (TNT on rm -rf, hard hat by model), SBB clocks, 1 August and Christmas |
| Life of the city | Residents with routines (beds at night, workstations by day, the bell), people at café tables, in church on Sunday and at the family table, the builders' day (work clothes, Feierabend at the café, their own bed, a cheer when a house is done), animals in their places, a cable car to the nearest peak, a little red train, paragliders, a lake steamer, builders chatting in the chat |
| Privacy | Prompt text in the chronicle (manual only) |

The house chronicle adds a "Town chronicle" section to the settings page: every building with its project, builders and date, a project filter, search and teleport to the house.

### Parameters

The same page lets you set how many actions a chat needs before its own house and before the next stages (chat economy), the build speed and the renovation speed. Other values can be set in `config.json`:

```json
{
  "preset": "basic",
  "features": { "status": true },
  "language": "en",
  "blocksPerSecond": 3,
  "toolBurst": { "Edit": 10, "Write": 12, "Bash": 5, "default": 3 },
  "houseAfterActions": 20,
  "stageActions": [80, 200],
  "idleAfterMinutes": 10,
  "sleepAfterMinutes": 30,
  "retireAfterHours": 72,
  "renovateBlocksPerSecond": 2,
  "maxVillagersPerDistrict": 12,
  "villagerAI": false,
  "lifeDensity": "medium",
  "chatterFrequency": "normal",
  "scratchDistrictName": "Alpweide"
}
```

`lifeDensity` (low / medium / high) sets the strict caps of the life of the city per district and for the whole town (at medium about 30 residents, 14 seated people and 20 animals at most); its entities only appear where a player is near. `chatterFrequency` (rare / normal / often) is how often builders say something in the chat.

Chats without a project folder build the shared "Alpweide" district. By default villagers stand still (`villagerAI: false`) and there are at most 12 per district: a hundred wandering villagers put a noticeable load on the server.

## Renovation instead of demolition

When the building generators change, the town is not rebuilt from scratch. The bridge remembers which version built each plot (the version archive is in `bridge/archive/`) and repairs houses by diff: it removes what is gone, places what is new and leaves matching blocks alone.

- A half-built house is finished using the new blueprint.
- Finished houses, district squares and the main square are repaired by a crew: 2 blocks/s while at least one chat is working, plus any awake, free builder of the district comes to help. The sidebar shows a line like "Renovation: Chalet 40%", and when a district is done, a message appears in the chat.
- Lanterns, seams between plots and the pavement are versioned separately and updated the same way.

Details for generator authors: `docs/generator-contract.md`.

## Builders: fast, realistic or offline

The **Builders** setting on the settings page (`builderMode` in `config.json`) picks how a chat's builder works:

| Mode | What you see | Cost |
|---|---|---|
| `fast` (default) | A mannequin teleports along the house and the blocks appear by RCON, ~3 blocks/s plus bursts. With the feature "Smooth motion" the mannequin glides instead of jumping | almost nothing |
| `realistic` | One real player (a bot) per active chat walks over from the district square, carries the block it is about to place, places it by hand with the right facing, half and axis, builds a dirt tower where it cannot reach and takes it down again. Blocks a player cannot place in one click (signs and banners with text, potted plants, filled cauldrons, unsupported overhangs, doors with the wrong hinge) are set by RCON while the bot looks at the spot and swings. When the house is done the whole list is read back and anything off is fixed, so the house matches the blueprint exactly. The bot waits at the door when the chat is idle, bobs and looks at you when the chat waits for your permission, says a short line now and then, and goes in to sleep (a sleeping mannequin lies in its bed) when the chat has been quiet for `sleepAfterMinutes`. Its chat lines go through the shared builder chat (feature "Builders chat") | one Node process for all bots: ~230 MB with 3 bots, ~10–35 % of one CPU core, ~1.3 ms server tick time per bot; each bot takes a player slot |
| `offline` | Like `fast` while the Minecraft server runs. While it is off, the bridge keeps taking the chats' events and every chat earns its blocks as a backlog (kept in `state.json`, at most `offlineMaxBacklog`, default 20000, per chat); the live map shows that progress hatched. When the server is back the backlog is built: plots that need the terrain are created as their turn comes, houses get finished with their fireworks and villagers. `offlineCatchUp`: `timelapse` (default; over about `offlineTimelapseSeconds`, default 120, the mannequins move as usual) or `instant` | nothing extra; only the bridge (~50 MB) runs while you work |

Realistic mode needs the bot libraries once:

```
cd bots
npm install
```

The bridge starts the bot runner (`bots/runner.mjs`) by itself when the mode is `realistic`, restarts it if it dies, and stops it when you switch back; `start.cmd` needs no change. The runner talks to the bridge only over the IPC channel of `child_process.fork` (no port) and has its own RCON connection.

- `builderBotsMax` (default 3): at most this many bots at once; the other chats keep a mannequin until a bot is free (new bots also wait when the machine has less than `botMinFreeMemMB`, default 600 MB, free). Mind the server's `max-players`: every bot is a player.
- `botSpeed`: `calm` (pauses between blocks, walks more), `normal`, `fast` (when a bot is far behind, blocks out of reach are set from where it stands while it swings).
- Progress is still the bridge's build list and `plot.placed`: switching modes in the middle of a house carries on from the same block, progress % and renovation work as before, and a bot that was interrupted re-checks the last blocks. Bot names look like `Maurer_Noor` (a trade plus the chat's skin; offline-mode players get the default skin their name hashes to, and the name is chosen so it is the chat's skin); the chat's name is the nametag prefix and the status line its suffix. Bots never get op, welcome lines, advancements messages or a place in the map's player list.
- Without `npm install` in `bots/`, or if a bot cannot join, the chat simply keeps its mannequin.

## Advancements and the town hall

For advancements and the "Town hall" button in the pause menu, the bridge installs the `datapack/promptenhorn` data pack into `server/world/datapacks/` by itself and reloads data packs. The pause-menu button appears after the next server restart (dialogs are only loaded at startup); the "[Town hall]" link in the chat works right away. The town hall window can also open the live map in your browser.

## Tuning

`node tools/tune.mjs` looks at your computer (RAM, CPU, what is running) and, read-only, at the running server (TPS, MSPT, chunks, entities), then prints a plan: Java memory and flags for the start scripts, `view-distance` / `simulation-distance`, Paper/Spigot/Bukkit tick savings, and the bridge limits `builderBotsMax`, `colonistsMax`, renovation speed and life density. It changes nothing until you add `--apply`; then every file it touches is backed up to `backups/tune/<time>/`, and you restart the server and the bridge.

```
node tools/tune.mjs            # dry run
node tools/tune.mjs --apply    # write the plan, then restart
```

Rough guide: 8 GB laptop: `-Xmx1536M`, view distance 6, fast builders. 16 GB: `-Xmx2560M`, view distance 12, up to 4 live builders and 3 colonists. 32 GB: `-Xmx4G`, view distance 16, up to 8 bots. Keep a value of your own with `"tuning": { "lock": ["server.view-distance"] }` in `config.json`. In Claude Code you can simply ask "tune the server" (the `promptenhorn-tune` skill). Measurements and every setting explained: [docs/performance.md](docs/performance.md).

## Colonists (experimental survival colony)

Besides the builders of the town there is a second mode: **Colonists**. Every active chat also gets a colonist in a survival colony on its **own** Minecraft server. Colonists are real player bots (Mineflayer) with a scripted utility AI, no LLM and zero tokens: they chop wood, dig their own mine, craft and upgrade tools and armour (wood → stone → iron), smelt, fight monsters, farm wheat, hunt and cook, sleep in beds at night, die, come back for their things, keep a shared storage and sell surplus at the market. With the money the colony buys building blocks (calcite, copper, glass, terracotta…) and builds cabins by hand. The town is not affected: it keeps building as before.

| Chat | Colonist |
|---|---|
| New chat with activity | A colonist joins the colony (name tag: colonist name · chat name) |
| Claude works (tool calls) | The colonist works; bursts of tool calls give Haste (digs faster) |
| Chat idle for 4 min | The colonist stays home and guards the plaza; after 30 min it goes to rest (disconnects) |
| Failing tests | Bad luck: Unluck and a short Slowness, a grumpy line |
| Commit / push | Celebration (fireworks, jumping), a bonus for the colony till |
| Subagent | A temporary helper colonist (if the pool allows) |
| Edit/Write, Bash, Read/Grep | Preferred job: builder, miner, lumberjack |

### Start

```
node wild/setup.mjs        # once: creates wild-server/ (copies Paper from server/, new RCON password, port 25567)
wild\start-wild.cmd        # starts the colony server and the colony (or: node wild/colony.mjs)
```

Then switch **Colonists** on at http://127.0.0.1:7777/ (parameter "Colonists": on) so the bridge forwards chat events to the colony; the bridge must be running, the colony only receives what the bridge already gets. Join the colony in Minecraft 1.21.11 at `127.0.0.1:25567` (survival; colonists greet you and send a clickable list with **[tp]** and **[follow]**; the sidebar shows every colonist with role, health, food and task). Colony status page: http://127.0.0.1:7785/ (JSON at `/status`). Stop the colony with `node wild/stop.mjs` (colonists leave, state is saved) and the server with `stop` in its window.

### Settings

| Key (config.json of the town, or `wild-config.json`) | Default | What it does |
|---|---|---|
| `colonists` | `off` | Forward chat events to the colony (settings page: "Colonists") |
| `colonistsMax` | `3` | Colonists at most: one per active chat, extra chats wait. Each costs ~160 MB of RAM. The colony also never starts a bot when free RAM would drop below `reserveFreeMB` |
| `colonistsCaretaker` | `off` | `on`: one caretaker colonist keeps working while no chat is active |
| `chatter`, `chatterFrequency` | on, `normal` | The shared chat-line switch and frequency (`rare` / `normal` / `often`) also apply to colonists |
| `language` | `en` | Colonists speak the town's language |

Colony-only keys go to `wild-config.json` at the project root: `port` (7785), `serverDir`, `stateFile`, `brain` (`utility` or `naive` for comparisons), `creditMultiplier`, `projects`, `worldBorder` (640), `seedSite` ([x, z]). See `wild/config.mjs`.

### Memory and load

Plan for: the colony server (Paper, `-Xmx2G`, typically 1.2–1.8 GB in use), the colony process (Node, ~200 MB for the first colonist plus ~30–60 MB per extra colonist), and the town as before. With 16 GB and the town running, 3–4 colonists are comfortable. Measured numbers are in `docs/roadmap.md` (section "Colonists").

### How the colony works

- **Utility AI** (`bots/wild/brain.mjs`): candidate actions score their urgency from the colonist's needs (drowning 100, creeper without shield 95, low health 92, outnumbered 88, combat 80, hunger 55–85, recover items 75, kit 70, full bag 68, night 60–65, tool repair 52, upgrades 42–47, role work 30–40); the best one runs for a bounded time, then everything is re-evaluated. A reflex layer interrupts on danger and drowning, a watchdog on stuck actions.
- **Roles** come from the colony's needs every 10 s: one builder while a house is affordable, a farmer (and a hunter with 3+ colonists) when food runs short, lumberjacks when wood is short, miners otherwise.
- **Survival**: retreat to the lit plaza at low health and eat there; creepers are never fought without a shield (walled off in tunnels, fled from outside); eating starts at food ≤ 14; a standard kit (pickaxe, sword, axe, food, torches, blocks, armour) is refilled from storage; worn tools are replaced before they break; no swimming (frozen ponds), no digging next to water or lava, no digging straight down; stuck detection re-paths, re-centres and, as a last resort, calls the colonist home.
- **Mines**: each colonist digs its own 1-wide staircase down from the plaza edge, levels out at ore depth, mines ores it sees and lights the tunnel with torches.
- **Storage**: five chests by category (ores, food, wood, stone, misc; marker block behind each) are the single source of truth; surplus above the colony reserve goes to the **market chest** next to Märt the merchant and becomes credits ("Fr.").
- **Economy**: sale prices reflect effort (log 1, cobblestone 0.25, coal 2, raw iron 3, diamond 25); a block costs its raw materials times 1.2, imported blocks have their own price (calcite 0.8, glass pane 0.25, cut copper 1.6, terracotta 1.2, lantern 2.5, bed 2.5). Iron is not sold while anyone still lacks iron gear. Prices: `wild/economy.mjs`.
- **Construction**: the builder buys the next batch of 40 blocks, the merchant hands them over, and the builder places them by hand in survival (standing on the ground, inside the house, or on the attic floor reached by the ladder). What cannot be placed by hand (no support, tricky blocks, unreachable spots, wrong orientation) is set by the "crew" with RCON while the builder looks at it and swings. The first projects are colonist's cabins (`wild/houses.mjs`, 342 blocks); city generators need 21×21 plots and are not used yet.

## Stopping and uninstalling

- To stop: type `stop` in the server window and close the bridge window.
- If the bridge is not running, the hook sees a stale heartbeat file and exits immediately.
- To remove the hooks: `node install-hooks.mjs --uninstall`.

## Files

| Path | What it is |
|---|---|
| `bridge/bridge.mjs` | The daemon: events, sessions, plots and objects, construction, renovation |
| `bridge/features/*.mjs` | Features you switch in the settings (registry and dispatcher in `index.mjs`); life of the city in `citylife.mjs` (residents, seated people, the builders' day, animals), `landscape.mjs` (cable car, train, paragliders, steamer), `chatter.mjs` (builders' chat lines, `say()` API), `markers.mjs` (generator markers in world coordinates) |
| `bridge/settings.mjs`, `bridge/settings-page.mjs` | Presets, switches, parameters; the settings page and its API |
| `bridge/map-page.mjs` | Live town map (`/map`) |
| `bridge/i18n.mjs`, `locales/` | Localization: `t()` and per-language string catalogs (`en.json` is the source) |
| `bridge/generators.mjs`, `bridge/archive/` | Generator versions and their archive |
| `bridge/renovate.mjs` | Renovation by diff |
| `bridge/fx.mjs` | Effect queue with a per-tick RCON budget |
| `bridge/plotmeta.mjs` | Bells, chimneys, doors, windows, clock faces found in a blueprint |
| `bridge/smallforms.mjs` | Benches, trees, flower beds, fountains, the park, the lookout |
| `bridge/buildings.mjs`, `bridge/blueprint.mjs` | Building generators (assembled from `.dev/parts`) |
| `hooks/alps-hook.mjs` | The Claude Code hook |
| `install-hooks.mjs`, `configure.mjs` | Hook installer; settings from the terminal |
| `datapack/` | Advancements and town hall data pack (`node datapack/build.mjs` rebuilds it) |
| `bridge/builders/` | Builder backends: mannequin (fast), bot (realistic), the router between them, bot names |
| `wild/` | Colonists: the colony daemon (`colony.mjs`), setup and start scripts, economy, houses, chat lines, status page; dev tools `rc.mjs`, `sim.mjs`, `stop.mjs` |
| `bots/wild/` | The colonist bot: utility brain, skills, combat, mine, construction, physics fix |
| `bots/` | Realistic builders: the bot runner (`runner.mjs`, `worker.mjs`, `place.mjs`, physics fix) and dev tools (`physics-test.mjs`, `measure.mjs`, `verify.mjs`); separate `package.json` |
| `docs/` | Generator contract, building standards, localization, roadmap |
| `server/` | Paper 1.21.11: localhost only, offline-mode, peaceful, creative |
| `state.json` | The town's state |

To start the town over: stop everything, delete `server/world*` and `state.json`.

## License

- [LICENSE](LICENSE) — MIT, © 2026 linkartemy.
- [NOTICE.md](NOTICE.md) — an independent fan project, not affiliated with Mojang, Microsoft or Anthropic; no game files are redistributed, and you accept the Minecraft EULA yourself.
