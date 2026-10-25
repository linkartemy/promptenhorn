# Live builders: a Mineflayer spike

Date: 2026-10-25. Status: prototype, not production. Code in `bots/`, experimental server in `.dev/wild-server/`.

Goal of the spike: check whether the mannequin builder (currently a teleported `mannequin` entity plus RCON `setblock`) can be replaced or complemented by real player bots on Mineflayer. The bots should walk, build by hand, and in "wild" mode also survive. No LLM is used, no tokens are spent.

## Verdict

| Mode | Decision | Why |
|---|---|---|
| 1. "Fast" (mannequin + RCON) | Keep as the default | Works, 180 blocks/min, costs almost nothing. Also needed as a fallback when there are not enough bots |
| 2. "Realistic" (bots build by hand in the town) | **GO, as a hybrid** | The bot built a 1269-block chalet with 96.5% of blocks placed by hand on the first try. Final match with the blueprint 99.9%. Speed 76 blocks/min, i.e. roughly 2.4× slower than fast mode. The remaining blocks are placed by RCON while the bot looks at the spot and swings its arm |
| 3. "Wild" (survival colony) | **Conditional GO**: separate server, experimental feature | The scenario is written (`bots/wild.mjs`) but has not been run end to end: the spike was stopped by its timebox. Half a day of running it is needed before deciding. Walking over natural terrain was verified, and it has a known issue (see "Risks") |

## 1. Support for version 1.21.11

- `mineflayer@4.39.0` (2026-09-06): testedVersions in `lib/version.js` go up to `1.21.11` and `26.1`.
- `minecraft-protocol@1.68.0`: supportedVersions includes `1.21.11` (protocol 774). `minecraft-data@3.117.0` contains `pc/1.21.11`.
- Verified in practice: bots join Paper `1.21.11-132` (offline-mode), walk, place and break blocks, read block states.
- **ViaVersion/ViaBackwards are not needed.** A separate server version for wild mode is not needed either.
- Future risk: Paper's log says the latest stable version is already 26.3, while Mineflayer supports at most 26.1. If the server is upgraded before Mineflayer, the bots will drop off. Then ViaBackwards on the server would be needed, or we would have to wait for a Mineflayer release.
- Plugins (versions pinned exactly): `mineflayer-pathfinder@2.4.5` works even though it has not been updated since 2023. `mineflayer-collectblock@1.6.0`, `mineflayer-armor-manager@2.0.1`, `mineflayer-auto-eat@5.0.3` (ESM) install fine. `mineflayer-pvp@1.3.2` (2022) pulls in the old `mineflayer@2.41` via `mineflayer-utils`. It is better replaced with our own ~30-line attack loop.

## 2. Experimental server `.dev/wild-server`

A copy of `server/` without the world: paper.jar, libraries, cache, versions, config, yml. Its own `server.properties`: `server-ip=127.0.0.1`, port 25567, RCON 25577 with a new random password, query 25567, `online-mode=false`, `difficulty=normal`, `spawn-monsters=true`, `view-distance=8`, `simulation-distance=6`. The gamerules `mob_griefing false` and `respawn_radius 0` were set via RCON, and the spawn point was moved onto the ground.

Startup: `start-server.cmd` (`java -Xms1G -Xmx2G`). In 1.21.11 gamerules have new snake_case names: `advance_time`, `send_command_feedback`, `keep_inventory`, `mob_griefing`, `respawn_radius`. The server rejects the old `doDaylightCycle` and similar.

`bots/common.mjs` takes its ports from the experimental server's `server.properties`. It refuses to use ports 25565/25566/25575/25576/7777/7778.

## 3. Mode 2: measurements (`bots/live-builder.mjs`)

Scenario: the bot appears at spawn, walks ~60 blocks with the pathfinder to a 21×21 plot, and builds `generate('chalet', 'spike-1')` from `bridge/buildings.mjs` (the module is imported read-only). It works in creative: items come from the creative inventory (`creative.setInventorySlot`), no `/give`.

How each block is placed: the bot looks at the spot, swings its arm and sends a real `use_item_on` packet. The block state is set as follows:
- `facing` for stairs, doors, beds, chests and furnaces: by turning the head (yaw) before the click;
- `half` and `type` for stairs, slabs and trapdoors: by choosing the face (bottom or top of the neighboring block) or the cursor height on a side face;
- `axis` for logs: by a face along the required axis;
- trapdoors: by clicking a side face (facing then equals that face), `open=true` with a second click;
- `hanging` for lanterns and wall-mounted blocks: by choosing the neighbor.

After each block the bot reads the world back and compares it with the blueprint. Connection properties (north/east/…, shape, waterlogged) are not compared: the world computes them itself. On a mismatch the bot breaks the block and tries again. If that does not help either, RCON `setblock` places the block. If there is nothing to place against, the bot puts a temporary dirt block next to it and digs it out afterwards.

| Metric | Value |
|---|---|
| Blocks in the blueprint | 1269 |
| Walk to the plot (~60 blocks) | 18–25 s |
| Build time | 1004 s (16.7 min) → **76 blocks/min** (fast mode: 180/min, ~7 min) |
| Placed by hand correctly on the first try | 1224 (**96.5%**) |
| RCON: "tricky" blocks (NBT, `potted_*`, `water_cauldron`, banners, signs) | 25 (2.0%) |
| RCON: no support (roof overhangs, hanging trapdoors) | 13 (1.0%) |
| RCON: placed incorrectly by hand | 7 (0.6%; almost all doors, `hinge=right` instead of `left`) |
| Final match with the blueprint | **99.9%** (1 bed) |
| Movements | 77 on foot, 52 flights (creative), 32 teleports (2.5% of blocks, mostly the roof ridge) |
| Where the time went | 75% movement, 7% the placement itself (~60 ms per block), the rest waiting for ticks |
| Physics stalls (see "Risks") | 89 per house, each cost ~1 s |
| node process, 1 bot | ~10% of one core (107 CPU-s over 1030 s), RSS 200–223 MB |
| Server with 1 bot | MSPT avg 1.6–1.8 ms (max 8), TPS 20; 547 chunks, 169 of them entity-ticking; java WS 1.37 GB with `-Xmx2G` |

Conclusions:
- Hand placement of blocks with the correct state is **solved**. Stairs, slabs, logs, trapdoors, lanterns, ladders, glass and fences are placed correctly on the first try. Yaw rules the bot learned: stairs, doors and beds face along the player's view direction; chests, furnaces, barrels and campfires face the player.
- The bottleneck is **movement**, not placement. Speed dropped from 213 blocks/min on the floor to ~90 on walls and ~50 on the roof. To speed up, the bot should pick a standing point for a batch of blocks (the window is currently 40 blocks) and build the roof "from scaffolding".
- Fundamentally impossible to place by hand: blocks with NBT (patterned banners, signs with text), potted flowers, water cauldrons. Doors can be placed, but `hinge` often comes out wrong. RCON remains for all of these.
- The hybrid (the bot walks and swings its arm, RCON does the `setblock`) was **not measured** in this spike: the run was cancelled. The `--mode hybrid` flag is ready. Its speed is limited only by the bot's walking; placement via RCON takes ~2 ms per block.

## 4. Mode 3: status (`bots/wild.mjs`)

The scenario for two bots (Heidi and Ueli) is ready and syntax-checked, but has **not been run** end to end on the server. Steps:
1. Greeting in chat and a reply.
2. Gathering 4 logs (`collectblock`), crafting planks, sticks, a crafting table and a wooden pickaxe. The bot places the crafting table and takes it along.
3. Mining stone, a stone pickaxe and sword.
4. Armor from the shared chest at spawn (`armor-manager`). The chest is filled via RCON `item replace`.
5. Fighting a zombie summoned via `summon zombie {equipment:{head:…}}`. The helmet keeps the zombie from burning in daylight.
6. Food: a hunger effect via RCON, then `auto-eat`.
7. `/kill`, respawn, path to the death location, picking up the drops (items are counted before and after).
8. Depositing resources into the shared chest. The second bot takes the cobblestone and says thanks in chat.

All lines come from templates in `LINES`. Each phase writes `ok`/`sec`/error into the report.

What was verified for this mode: joining in survival, walking over natural terrain (snowy taiga, ~60 blocks in ~15 s with 2–5 stall workarounds), RCON control of entities and gamerules.

To move from conditional GO to GO: run `node wild.mjs`, replace `mineflayer-pvp` with our own attack loop, add a task pause on `forcedMove` inside `collectblock`.

## 5. Load

- Measured only for 1 bot (numbers in the table above). A run for 3 and 6 bots (`bots/load-test.mjs --bots 0,1,3,6 --layout cluster|spread --view N`) is ready but has not been launched.
- Estimate, not a measurement: most of the ~200 MB RSS is `minecraft-data` and the registry, shared by all bots in one process. So bots should be kept **in a single node process**; an additional bot is expected to cost 30–80 MB. CPU-wise a bot uses ~5–10% of a core, so 6 bots are under one core.
- Chunks: a bot loads chunks like a regular player. With view-distance 8 that is up to ~289 chunks around each one if the bots are far apart. In the town plots are close together and the areas overlap. Bots should be given `viewDistance: 4` (a Mineflayer option that Paper respects): that is ~81 chunks, and bots need no more. Wild mode needs a world border (e.g. 512) and a pre-generated region.
- Machine memory is the main constraint: during the test on 16 GB only ~1.3 GB was free, with two other servers running in parallel.

## 6. Recommended architecture: three modes

### Builder backend interface

The bridge remains the sole owner of the plan. It holds the plot, the block list, `plot.placed`, the credit and the poses. The backend only executes:

```js
// bridge/builders/backend.mjs
interface BuilderBackend {
  spawn(session, site)          // appear at the plot (mannequin: summon; bot: connect + walk there)
  despawn(session)              // leave (kill / disconnect)
  setPose(session, pose)        // standing | idle | sleeping
  setHand(session, item)
  work(session, plot, list, budget) // place up to budget blocks starting at plot.placed; return how many were done
  say(session, text)            // templated line
}
```

- `MannequinBackend` is obtained by moving the current code (`ensureBuilder`, `setPose`, `setHand`, `tp` + `setblock` in `work`).
- `BotBackend` is a thin client to the `bots/daemon.mjs` daemon. That is a single node process, a bot pool, JSON over HTTP on 127.0.0.1 with its own port (not 7777/7778). The daemon reports which indices were actually placed, and the bridge saves `plot.placed`. Blocks from the hybrid list are handed back by the daemon to the bridge for `setblock` (or the daemon sends them via RCON itself) while the bot "acts out" the work.
- Mode selection is the `builderMode: fast | realistic | wild` setting plus `maxBots` (default 3) in settings.

### Chat and bot

- One bot per active chat. If there are not enough bots (`maxBots`), bots go to the chats with the most recent activity and the rest build with a mannequin. A freed bot takes the next chat.
- Credit is computed as it is now (`blocksPerSecond`, `toolBurst`). The bot spends credit at its own speed. If it falls behind (especially on the roof), the surplus credit can be delivered by RCON "apprentices" so the house does not stall.
- Idle and sleep: the bot stands by the house. After `sleepAfterMinutes` the bot disconnects and a mannequin plays the sleeper (cheap). A new message reconnects the bot.

### Hybrid placement strategy

- By hand: full blocks, logs and pillars, stairs, slabs, trapdoors, lanterns, ladders, carpets, flowers, glass and fences (the world computes connections itself).
- RCON (the bot looks and swings its arm): NBT blocks, `potted_*`, `water_cauldron`, doors, beds, blocks without support. Doors can be placed by hand with `hinge` corrected via RCON.
- State check after every block. A mismatch is fixed via RCON, without retries: retries are exactly the main time sink.
- Movement: on foot within ~24 blocks over the ground, otherwise a creative flight along an "up, over the house, down" trajectory, teleport only as a last resort. The bot never stands in cells that are still to be built.

### Mode switching and unfinished plots

- Progress is `plot.placed` plus the world itself; the backend stores no state. So switching fast ↔ realistic = `despawn` with the old backend and `spawn` with the new one. Construction continues from the same index, nothing is demolished.
- The bot re-checks the last ~20 blocks before `plot.placed` (modeled on `skipSet`): it may have been disconnected mid-block.
- Switching to wild does not touch the town. The town plots are finished by a mannequin (or, optionally, by a bot in realistic), while the chat simultaneously gets a colonist in the wild world.

### Mode 3 world

- **Separate server** (currently `.dev/wild-server`, in the product `server-wild/`, port 25567). Its own world and its own state `wild-state.json`: colonists, shared chest, storehouse, wallets. It does not touch the town or `state.json`.
- The only link to the town is the economy. Resources from the wild world become session or project points, and points "buy" exotic blocks in the town (copper, quartz, amethyst, stained glass). The bridge reads `wild-state.json` and unlocks blueprint variants. Example prices: log = 1, cobblestone = 1, iron = 5, hostile mob = 3.
- Names and skins match those in the town. One chat — one bot in one world at a time.
- Security: 127.0.0.1 only, which is the sole reason `online-mode=false` is acceptable; bots have no op (creative commands from the town do not go there); `mob_griefing false`; world border; daily backup; kill-switch in settings; bot limit.

## 7. Risks

1. **Physics desync on Paper 1.21.11.** If the bot drops into a 1-block-deep pit while walking, prismarine-physics steps it up right in mid-air. The server silently rejects every step (`forcedMove` every tick) and the bot freezes. Reproduces in both creative and survival. Workaround: `walkTo()` in `bots/common.mjs` detects a series of teleports, releases control, jumps and recomputes the path. In the town with flat streets this is ~1 stall per 15 blocks of construction; in the wild world it is a constant background. The proper fix: a patch or fork of prismarine-physics (step-up only when `onGround`).
2. The plugin ecosystem is not maintained: pathfinder since 2023, pvp since 2022. Mineflayer lags behind server versions (currently 26.1 vs 26.3).
3. Bots are real players: they show up in the player list, take `max-players` slots, receive advancements and death messages, and interfere with skipping the night (configure `players_sleeping_percentage`). In the town a bot must not be allowed to dig (`canDig=false`), otherwise it will damage houses.
4. Memory and CPU on the user's machine, which already runs three servers.
5. Slow roof: teleports and flights are visible. A "construction logic" for the roof is needed (scaffolding, working from the ridge).

## 8. Implementation plan

| # | Work | Estimate |
|---|---|---|
| 1 | Extract a `BuilderBackend` interface in the bridge and move the mannequin there (no behavior change) | 1 day |
| 2 | `bots/daemon.mjs`: pool, IPC, reconnection, report of placed indices, `viewDistance` 4, single process | 1.5 days |
| 3 | Placement based on `live-builder.mjs`: plans, yaw, half, axis, temporary supports, verification, RCON list; run on all 10 building types | 2 days |
| 4 | Movement: standing point for a batch of blocks, roof ordering, physics workaround or patch | 1–2 days |
| 5 | Settings: `builderMode`, `maxBots`; on-the-fly switching; fallback mannequin | 0.5 day |
| 6 | Load run with 1/3/6 bots (`load-test.mjs`) and tuning `maxBots` | 0.5 day |
| | **Total for mode 2** | **~6–7 days** |
| 7 | Wild mode: run `wild.mjs`, own combat, colonist state machine, `wild-state.json`, server install script, world border and backup | 3–4 days |
| 8 | Economy: points, prices, unlocking exotic blocks in the bridge | 1–2 days |
| | **Total for mode 3 (on top of mode 2)** | **~4–6 days + playtest** |

## Spike files

| Path | What it is |
|---|---|
| `bots/package.json` | Mineflayer 4.39.0 and plugins, versions pinned exactly |
| `bots/common.mjs` | Connection (experimental server only), RCON, block parsing, `walkTo` with stall workarounds |
| `bots/live-builder.mjs` | Mode 2: `--mode hand\|hybrid --type chalet --seed … [--limit N] [--fly]` |
| `bots/wild.mjs` | Mode 3: scenario for two bots (not run; removed later, see the update below) |
| `bots/load-test.mjs` | Load of N bots: MSPT, TPS, chunks, RSS and CPU of java and node (not run) |
| `bots/walk-test.mjs`, `bots/probe.mjs` | Walking test and terrain scouting |
| `.dev/wild-server/` | Experimental Paper 1.21.11 (25567 / RCON 25577), `start-server.cmd` |

## Update: mode 2 shipped (25.10.2026)

Mode 2 is now the "realistic" Builders mode (README, "Builders: fast or realistic"; code in `bridge/builders/` and `bots/runner.mjs`, `bots/worker.mjs`, `bots/place.mjs`). Findings that change this spike:

- **Physics desync: root cause found and fixed.** It is not the step-up rule. prismarine-physics stops the hit box exactly at a wall; the server builds the player box from the float `0.6F` (half width 0.30000001192…), so at the client's position the server box overlaps the wall by ~1e-8 and Paper refuses the move as `CLIPPED_INTO_BLOCK` (no log line), every tick while the bot keeps walking into the far side of a dip. Fix: `bot.physics.playerHalfWidth = 0.3001` (`bots/physics-patch.mjs`). Dip course (`bots/physics-test.mjs`): 0 resets, 8.7 s per run; before: 2–549 resets and 9.5–40 s. No source patch of prismarine-physics needed.
- Speed of a whole house by one bot, roof included: 115–135 blocks/min (townhouse 1794 blocks in 13.3 min, café 1494 in 12.9 min); 150–250/min on ground floors, 40–70/min on high roofs. 98–99 % of the blocks by hand. Final read-back: 0 mismatches on every bot-built house.
- Load: one runner process with 3 bots: 205–230 MB RSS, 10–35 % of one core. Server MSPT on the shared test server rose from 3.7 ms to ~7.5 ms with 3 active bots (TPS 20); bots load chunks within the server's simulation distance, clustered bots share them.
- Vanilla advancements of the bots are granted silently once (the 1.21.11 gamerule is `show_advancement_messages`, not `announce_advancements`).
- `bots/wild.mjs` was removed (the colonists live in `bots/wild/`), together with `mineflayer-pvp`, `-collectblock`, `-auto-eat`, `-armor-manager`.
