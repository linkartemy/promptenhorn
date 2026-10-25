# Performance and tuning

How much the town costs, what the server settings do, and what to run on a laptop with 8, 16 or 32 GB.
The numbers come from the reference machine below; `node tools/tune.mjs` measures yours and prints a plan
(see [Applying a plan](#applying-a-plan)).

## 1. Measurements (reference machine)

Taken on 2026-10-25 around 20:00 while the town was running and four other agents were developing. Windows 11 Pro,
AMD Ryzen 7 3800X (8 cores / 16 threads), 16 GB RAM (16 314 MB visible), JDK 23.0.2, Paper 1.21.11-132, Node 26.
Sources: RCON (read-only: `tps`, `mspt`, `list`, `forceload query`, `paper chunkinfo`, `paper entity list`,
`execute if entity` counts), `jcmd GC.heap_info` / `VM.flags`, `jstat -gc`, `Get-CimInstance Win32_Process`
(private bytes = committed memory, WS = working set).

### The live server (`server/`, `-Xms1G -Xmx3G`, no other JVM flags)

| What | Value |
|---|---|
| TPS (1 / 5 / 15 min) | 20.0 / 20.0 / 20.0 |
| MSPT (avg / max, last minute) | 2.5–2.8 ms / 26–51 ms; the spikes are autosaves and bursts of RCON commands |
| Players online | 0 (the user was on the wild server at the time) |
| Loaded chunks | 1 181: 956 inactive, 114 full, 82 block-ticking, 24–29 entity-ticking |
| Force-loaded chunks | 24–27 (the bridge's building sites around x≈-1 100, z≈1 000) |
| Entities in loaded chunks | 62–65 ticking-capable; `paper entity list`: 26 ticking + 312 non-ticking |
| Villagers | 18 loaded, all with AI (`villagerAI: true` in `config.json`), all tagged `alps` |
| Our other entities | 4 mannequins, 6 block displays (6 tagged `alps_sbb`: the station clock), 4 text displays, 1 interaction; 33 entities tagged `alps` in total |
| Leftovers worth a look | 27 `falling_block` entities frozen in non-ticking chunks; 87 chickens, 35 sheep, 24 pigs in unloaded/non-ticking chunks (natural spawns from world generation) |
| Heap | committed 1 444 MB of 3 072 MB, used 902 MB; old generation 453 MB (of 578 committed); eden ~860 MB; metaspace 157 MB |
| GC | G1 (default ergonomics, 2 MB regions), 382 young collections in ~3 h (one every ~28 s), 0 full GCs, 6.2 s of GC in total |
| Process | private 1 971 MB, working set 1 669 MB (≈ heap + 500 MB of metaspace, code cache, GC structures, threads) |
| CPU | 2 379 CPU-s in ~3 h ≈ 22 % of one core on average |

A few minutes later the user joined (1 player, view distance 16): 1 397 chunks (1 005 full, 290 entity-ticking),
354 entities, 21 villagers with AI, MSPT 3.9–4.1 ms avg (max 12–17 ms), old generation 417 MB after a young
collection, heap still committed at 1.43 GB.

So the live server is far from its limits: the town needs ~0.5 GB of live heap and 2–4 ms per tick, with or
without a player.
`-Xmx3G` is a ceiling it never reached; the young generation simply grows into whatever it is allowed.

### Everything else on the machine at the same moment

| Process | Private MB | Notes |
|---|---|---|
| Live bridge (`bridge/bridge.mjs`, fast builders) | 103 | WS 69 MB |
| Minecraft client (`javaw`, TLauncher) | 2 725 | WS 1 190 MB |
| TLauncher itself (`java`, no window) | 554 | stays open after the game started |
| Claude desktop + Claude Code | ~2 800 | renderer ~1 GB, CLI ~0.9 GB |
| Shared test server (`-Xmx2G`) | 2 605 | heap fully committed (2 GB), old gen 862 MB; 3 bots + 1 test player; 4 678 chunks, 242 force-loaded; 3 653 entities of which 2 409 dropped items; MSPT 13–14 ms avg, max 63–465 ms; ~94 % of a core |
| Wild server (`-Xms512M -Xmx2G`) | 1 343 | 2 colonists + the user; 675 chunks; MSPT 3.6–4 ms |
| Bot runner, 3 realistic builders in one process | 205 | WS 235 MB |
| Wild colony, 2 colonists in one process | 188 | WS 218 MB |
| A single-bot test process | 161 | WS 175 MB |
| Other Node processes (dev bridges, simulators) | ~1 000 | 8–11 processes |
| **Free** | **1 100–1 464** | the user saw ~450 MB at the worst moment |

Committed memory of all of the above was ~13 GB. The test and wild servers alone were ~4 GB, the client with its
launcher ~3.3 GB, Claude ~2.8 GB, the live town (server + bridge) only ~2.1 GB.

### Cost of one bot

The spike (`docs/live-builders-spike.md`) measured one bot in its own process at 200–223 MB RSS. Bots now share one
process, and that changes the picture:

| | Node side | Server side | CPU |
|---|---|---|---|
| First bot (runner / colony process with `minecraft-data`) | 160–200 MB | — | — |
| Each further realistic builder | +10–25 MB | +20–60 MB of heap (chunks around it at `botViewDistance` 4 overlap the player's in town) | ~5–10 % of a core in Node, ~0.5–1.5 ms MSPT |
| Each further colonist | +10–25 MB | +40–80 MB (colonists spread out and load their own chunks) | same |
| Colonists on their own server | — | +1.3–2.6 GB for that JVM | +1 server |

Planning numbers used by `tools/tune.mjs` (worst case, on purpose): runner base 200 MB, 70 MB per builder,
90 MB per colonist, server process = `-Xmx` + 500 MB. The bridge keeps a runtime guard on top: no new bot below
`botMinFreeMemMB` (600 MB) of free RAM; the colony has `reserveFreeMB` (1 200 MB).

## 2. Settings that matter

Already right and must stay: `difficulty=peaceful` and `spawn-monsters=false` (no monster ticking at all),
`per-player-mob-spawns: true`, `pause-when-empty-seconds=-1` (the bridge builds while nobody is online; a paused
server would stall it), `server-ip=127.0.0.1`, `spark` is installed for profiling (`/spark profiler`).

| Setting | Now | Recommended | Why |
|---|---|---|---|
| `view-distance` | 16 | 12 (16 GB), 6 (8 GB), 16 (32 GB) | Paper loads the server's view distance around every player, whatever the client asks for: (2·16+1)² = 1 089 chunks per player vs 625 at 12. Measured here the heap copes with 16 (old gen ~0.4 GB with the player online), so the gain is mostly elsewhere: chunk loading and generation while flying, chunk sending, and the client, which renders min(its own, the server's) distance and is the second-largest RAM user on the machine. Lock it at 16 if the far view of the Matterhorn matters more. |
| `simulation-distance` | 8 | 6 (4 / 8) | Entity-ticking area: 289 → 169 chunks. Villagers, animals and redstone beyond it freeze, buildings stay visible. |
| `sync-chunk-writes` | true | false | `true` forces a synchronous flush per chunk write; Paper's own IO is safe without it (Aikar's recommendation). |
| `network-compression-threshold` | 256 | -1 (only when `server-ip` is loopback) | Compression costs CPU on both ends and saves nothing on localhost. |
| `max-players` | 8 | ≥ 1 + bots + colonists (same server) + 2 | Every bot is a player. |
| JVM heap | `-Xms1G -Xmx3G` | `-Xms1G -Xmx2560M` (16 GB) | Measured old gen ~0.5 GB idle; 2.5 GB leaves room for a player at view 12 plus 4 bots. A larger heap only lets eden grow and costs RAM the rest of the machine needs. `-Xms` stays low so an idle server does not hold memory. |
| JVM flags | none (G1 defaults) | [Aikar's flags](https://docs.papermc.io/paper/aikars-flags) for heaps < 12 GB, **without** `-XX:+AlwaysPreTouch` | Shorter, more even pauses (young gen 30–40 %, early mixed collections, 8 MB regions). Pre-touch would commit the whole heap at start on a machine that shares its RAM. All flags are accepted by JDK 23 (checked with `java <flags> -version`); `tune.mjs` drops any flag a future JDK rejects. Note: `-XX:+PerfDisableSharedMem` turns off `jstat`; `jcmd` still works. |
| ZGC | — | not needed | Generational ZGC (JDK 21+) is an option for heaps ≥ 8 GB; at 1.5–4 GB G1 is the better fit. |
| `paper-world-defaults.yml` `chunks.max-auto-save-chunks-per-tick` | 24 | 12 (8 / 24) | Spreads autosaves over more ticks: smaller MSPT spikes. |
| `collisions.max-entity-collisions` | 8 | 2 | Crowds of animals on the square cost less. |
| `entities.armor-stands.tick`, `entities.markers.tick` | true | false | The town uses no armor stands or markers (mannequins and display entities instead). |
| `misc.update-pathfinding-on-block-update` | true | false | The bridge places thousands of blocks; with `true` every placed block recomputes the paths of nearby mobs. Mobs still repath on their own. |
| `environment.optimize-explosions` | false | true | Harmless; helps the colony world. |
| `tick-rates.behavior.villager.validatenearbypoi` / `acquirepoi`, `tick-rates.sensor.villager.secondarypoisensor` / `nearestbedsensor` | -1 / – / 40 / – | 60 / 120 / 80 / 80 | Paper's equivalent of "lazy villagers": the expensive POI and bed searches run every 3–6 s instead of every tick. Paper has no `villagers.lobotomize` (that is Purpur); our own "lobotomy" is `villagerAI: false` (NoAI); this installation runs with `villagerAI: true`. |
| `spigot.yml` `entity-activation-range.villagers` / `animals` | 32 / 32 | 24 / 24 (16 / 32) | Beyond this range entities tick only now and then. |
| `entity-activation-range.tick-inactive-villagers` | true | false | Villagers out of everyone's range stop ticking. Nobody sees them there. |
| `wake-up-inactive.villagers-max-per-tick` | 4 | 2 (1 / 4) | Fewer inactive villagers woken up per tick. |
| `entity-tracking-range.players` | 128 | 96 (64 / 128) | Bots are players: every pair of players within range exchanges movement packets. Display entities keep their 128 so the town's signs and clocks stay visible from afar. |
| `merge-radius.item` / `exp` | 0.5 / -1 | 2.5 / 3.0 | Dropped items merge into fewer entities (the test server had 2 409 items lying around). |
| `bukkit.yml` `spawn-limits.ambient` / `water-ambient` | 15 / 20 | 2 / 5 | Bats and fish nobody looks at. The monster and animal limits stay (a colony world needs them, and the town's animals are summoned by the bridge). |
| `chunk-gc.period-in-ticks` | 600 | 400 | Unloads unused chunks a bit sooner. |
| `paper-global.yml` chunk threads | `-1` (auto) | leave | Auto picks half the cores; fine from 4 threads up. |
| Mob spawning with monsters off | — | leave | Peaceful: monster spawn settings cost nothing. |

Bridge (`config.json`):

| Key | Default / now | 8 GB | 16 GB | 32 GB | Notes |
|---|---|---|---|---|---|
| `builderBotsMax` | 3 / unset | 1 | 4 | 7–8 | Capacity. Bot count = active chats, capped by this. Also capped by CPU: bots ≤ threads/2 − 1. Applies live. |
| `colonistsMax` | – / unset | 1 (same server only) | 3 | up to 6 | Capacity; bots + colonists ≤ threads/2. A separate wild server needs its own 1.5–2 GB: on 8 GB it does not fit next to the client. |
| `renovateBlocksPerSecond` | 2 / 12 | 2 | ≤ 6 when the server is busy | 12 | RCON throughput. At MSPT 2.5 ms the current 12 is fine and is kept. |
| `maxBlocksPerTick` | 8 | 6 | 8 | 12 | Upper bound of blocks per 250 ms bridge tick. |
| `lifeDensity` | medium | low | medium | high | Residents / seated people / animals caps (`bridge/features/citylife.mjs`). |
| `villagerAI` | false / true | false | user's choice | user's choice | 18 villagers with AI are cheap; above ~40 turn it off. |
| `botViewDistance` | 4 | 4 | 4 | 4 | Bots need no more. |

## 3. Profiles

| | 8 GB laptop (`low`) | 16 GB (`medium`) | 32 GB (`high`) |
|---|---|---|---|
| Reserved for the OS / client / Claude | 1.5 / 2 / 1 GB | 2.4 / 2.5–3.2 / 1.5–2.8 GB | 3 / 2.5 / 2 GB |
| Server JVM | `-Xms1G -Xmx1536M` | `-Xms1G -Xmx2560M` | `-Xms2G -Xmx4G` |
| `view-distance` / `simulation-distance` | 6 / 4 | 12 / 6 | 16 / 8 |
| Builder mode | fast; at most 1 realistic bot | realistic OK, `builderBotsMax` 4 | `builderBotsMax` 7–8 |
| `colonistsMax` | 1 if colonists share the city server, else 0 | 3 | 4–6 |
| Life, renovation, blocks/tick | low, 2, 6, `villagerAI` off | medium, ≤ 6 (12 kept when healthy), 8 | high, 12, 12 |
| Activation / tracking ranges | 16 / 64 | 24 / 96 | 32 / 128 |
| Client | render distance 6–8, 1.5–2 GB in the launcher, close the launcher after start | render distance ≤ 12, 2–3 GB | as you like, 3–4 GB |
| Worst case for the town | ~2.7 GB | ~4.1 GB | ~5.6 GB (+2.5 GB with a separate wild server) |

General rules: never run dev/test servers next to the town on 8–16 GB; give the client 2–3 GB (more only lengthens
its GC pauses); let TLauncher close itself after the game starts ("hide" keeps ~0.5 GB).

## 4. This machine, right now

Profile `medium` (16 GB). Budget for the town: 16 GB − 2.4 (OS) − 3.2 (client + launcher, measured) − 2.8 (Claude,
measured) ≈ 7.6 GB; the plan needs at most 4.1 GB (server 3.0 incl. JVM overhead, bridge 0.15, 4 builders 0.5,
3 colonists 0.5). It does **not** fit right now only because the shared test server (2.6 GB), the wild server
(1.3 GB) and ~1 GB of dev Node processes are running: ~0.8 GB would be missing at peak.

Apply at the next convenient restart of the live server (all reversible, `node tools/tune.mjs --apply` backs every
file up):

1. `-Xms1G -Xmx2560M` + Aikar's flags (start scripts).
2. `view-distance=12`, `simulation-distance=6`, `sync-chunk-writes=false`, `network-compression-threshold=-1`,
   `max-players=10`.
3. The Paper / Spigot / Bukkit values from section 2 (medium column).
4. `builderBotsMax: 4`, `colonistsMax: 3` in `config.json` (capacities; they only matter once the modes are on).
   `renovateBlocksPerSecond: 12` stays (the server is healthy).
5. Right away and without a restart: close TLauncher after the game starts (−0.55 GB); stop the test and wild servers
   when no agent needs them (−3.9 GB).

Later:

- When colonists ship: if they get their own server under `wild-server/`, `tune.mjs` counts its JVM (1.5 GB heap on
  16 GB) and lowers `colonistsMax` if needed; rerun it then.
- If the live view of the Matterhorn from far away matters more than RAM, lock the view distance:
  `"tuning": { "lock": ["server.view-distance"] }`.
- If the number of villagers with AI grows past ~40, set `villagerAI: false`.
- The 27 frozen `falling_block` entities in the live world and the 2 409 dropped items on the test server point at
  blocks that fall or drop while being placed; worth a look by the terrain / bots owners.
- After the restart, check the server log for config warnings about the new villager tick-rate keys
  (`acquirepoi`, `nearestbedsensor`): Paper ignores unknown names silently, so compare MSPT with ~40 villagers.

## Applying a plan

```
node tools/tune.mjs                 # dry run: measures, prints the plan, writes nothing
node tools/tune.mjs --apply         # writes it; backups in backups/tune/<time>/
node tools/tune.mjs --json          # the same plan as JSON
node tools/tune.mjs --profile low   # force a profile; --set server.view-distance=16 pins one value (profile "custom")
node tools/tune.mjs --no-client     # the Minecraft client runs on another computer
node tools/tune.mjs --no-measure    # don't ask the running server
```

- Deterministic: the same RAM, CPU, files and measurements give the same plan. The profile comes from the total RAM
  (< 12 GB low, < 24 GB medium, else high), then bots, colonists, heap and view distance are lowered until the
  worst case fits next to the OS, the client and Claude (measured when running, defaults otherwise).
- It only talks to the server with read-only commands (`tps`, `mspt`, `list`, `forceload query`, `paper chunkinfo`,
  `execute if entity` counts). A busy server (TPS < 19 or MSPT > 40) gets the gameplay values of the profile below;
  a healthy one keeps faster values the user chose.
- Pin anything by hand in `config.json`: `"tuning": { "lock": ["server.view-distance", "builderBotsMax", "spigot.*"] }`.
  Ids are the ones the plan prints: `jvm.xmx`, `jvm.xms`, `jvm.flags`, `server.<property>`, `paper-world.<path>`,
  `spigot.<path>` (under `world-settings.default`), `bukkit.<path>`, `config.<key>` (or just `<key>`), `start.cmd`,
  `start.sh`, `server/start-server.cmd`.
- Server, Paper and JVM changes take effect after a server restart; `builderBotsMax`, `renovateBlocksPerSecond` and
  `lifeDensity` apply live (the bridge re-reads `config.json`), the rest after a bridge restart.
- Verify afterwards: `tps` and `mspt` in the server console (20 TPS, MSPT well under 50 ms), or run the tool again.
