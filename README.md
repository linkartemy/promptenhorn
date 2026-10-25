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
  "scratchDistrictName": "Alpweide"
}
```

Chats without a project folder build the shared "Alpweide" district. By default villagers stand still (`villagerAI: false`) and there are at most 12 per district: a hundred wandering villagers put a noticeable load on the server.

## Renovation instead of demolition

When the building generators change, the town is not rebuilt from scratch. The bridge remembers which version built each plot (the version archive is in `bridge/archive/`) and repairs houses by diff: it removes what is gone, places what is new and leaves matching blocks alone.

- A half-built house is finished using the new blueprint.
- Finished houses, district squares and the main square are repaired by a crew: 2 blocks/s while at least one chat is working, plus any awake, free builder of the district comes to help. The sidebar shows a line like "Renovation: Chalet 40%", and when a district is done, a message appears in the chat.
- Lanterns, seams between plots and the pavement are versioned separately and updated the same way.

Details for generator authors: `docs/generator-contract.md`.

## Builders: fast or realistic

The **Builders** setting on the settings page (`builderMode` in `config.json`) picks how a chat's builder works:

| Mode | What you see | Cost |
|---|---|---|
| `fast` (default) | A mannequin teleports along the house and the blocks appear by RCON, ~3 blocks/s plus bursts. With the feature "Smooth motion" the mannequin glides instead of jumping | almost nothing |
| `realistic` | One real player (a bot) per active chat walks over from the district square, carries the block it is about to place, places it by hand with the right facing, half and axis, builds a dirt tower where it cannot reach and takes it down again. Blocks a player cannot place in one click (signs and banners with text, potted plants, filled cauldrons, unsupported overhangs, doors with the wrong hinge) are set by RCON while the bot looks at the spot and swings. When the house is done the whole list is read back and anything off is fixed, so the house matches the blueprint exactly. The bot waits at the door when the chat is idle, bobs and looks at you when the chat waits for your permission, says a short line now and then, and goes in to sleep (a sleeping mannequin lies in its bed) when the chat has been quiet for `sleepAfterMinutes` | one Node process for all bots: ~230 MB with 3 bots, ~10–35 % of one CPU core; each bot takes a player slot |

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

## Stopping and uninstalling

- To stop: type `stop` in the server window and close the bridge window.
- If the bridge is not running, the hook sees a stale heartbeat file and exits immediately.
- To remove the hooks: `node install-hooks.mjs --uninstall`.

## Files

| Path | What it is |
|---|---|
| `bridge/bridge.mjs` | The daemon: events, sessions, plots and objects, construction, renovation |
| `bridge/features/*.mjs` | Features you switch in the settings (registry and dispatcher in `index.mjs`) |
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
| `bots/` | Realistic builders: the bot runner (`runner.mjs`, `worker.mjs`, `place.mjs`, physics fix) and dev tools (`physics-test.mjs`, `measure.mjs`, `verify.mjs`); separate `package.json` |
| `docs/` | Generator contract, building standards, localization, roadmap |
| `server/` | Paper 1.21.11: localhost only, offline-mode, peaceful, creative |
| `state.json` | The town's state |

To start the town over: stop everything, delete `server/world*` and `state.json`.

## License

- [LICENSE](LICENSE) — MIT, © 2026 linkartemy.
- [NOTICE.md](NOTICE.md) — an independent fan project, not affiliated with Mojang, Microsoft or Anthropic; no game files are redistributed, and you accept the Minecraft EULA yourself.
