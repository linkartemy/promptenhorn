# Promptenhorn roadmap

Status as of 25.10.2026. Legend:

- **done** — verified on the test server and included in presets;
- **behind a flag** — code is written but not fully verified in the world. The feature is marked "experimental", is not part of any preset, and can only be enabled manually (settings page or `node configure.mjs <id> on`);
- **not started**.

The list of verified features is defined in `bridge/features/index.mjs` (`TESTED`). A feature enters presets once its id is added there after verification.

## Milestone 1 (done)

| What | Status | Verification |
|---|---|---|
| Generator versions: archive `bridge/archive/<version>/`, `plot.gen`, `legacy.txt` for old plots | done | 20 of 20 plots of the live `state.json` are reproduced by the `live-2026-10-25` archive (`.dev/check-legacy.mjs`) |
| Renovation instead of demolition (`renovation`): diff of finished houses, squares, the main square; streets are versioned separately | done, in presets | A test town was built with the old generators and renovated with the new ones: 0 mismatches in houses (`.dev/verify.mjs`). On the district square only the seam steps between plots remain, plus grass that turned into dirt under blocks |
| Unfinished houses on generator change: diff of what is already placed instead of demolition | done, always | Hotel and tower were completed after the version change, 0 mismatches |
| Migration of the live `state.json` (no `gen`, with demo sessions) | done | The copy loads, 4 unfinished houses are converted via diff, renovation starts |
| Presets, toggles, parameters; page `http://127.0.0.1:7777/`, `configure.mjs`, live apply | done | API, CSRF (foreign Host/Origin, text/plain, cross-site → 403), re-reading config.json |
| Hook: derived signals only, async, no output | done | Commands, output, messages are not sent; 0.19 s per call |
| `install-hooks.mjs`: new events, async, idempotent, uninstall | done | Run on a copy of settings.json: 13 entries after two runs, other hooks intact |
| Effect queue with a per-tick budget and dedup | done | Used by renovation and features |
| Villagers without AI and a per-district limit (tick load) | done, always | `villagerAI: true` in config.json restores the old behavior |
| Chronicle recording in state (who, when, how long they worked, actions by category) | done, always | Data only, nothing is written to the world |

## Behind a flag (written, awaiting in-world verification)

> Most of this list was verified on 25.10.2026 and moved to `TESTED`: see "Verification round (life agent)" below. Still behind a flag: `townHall`, `locatorBar` (they need a game client).

Next step for each: enable on the test server (`node configure.mjs <id> on` with `ALPS_CONFIG=.dev/test-config.json`), run the `.dev/sim2.mjs` scenario, verify via RCON queries and the map, add the id to `TESTED`.

| id | Idea | What to verify |
|---|---|---|
| `callout`, `idleCallout` | 1 | `sim2 wait c0 8000`, `question`, `idle`: the "!" rides on the builder, the bossbar appears and disappears, construction pauses |
| `status`, `toolInHand` | 23, 7 | The text under the nametag changes only when the text changes; held item matches the tool category |
| `tests`, `commits`, `push`, `pr` | 2, 3, 4, 5 | Flag on the lamppost, a little cloud after 3 failures, the church bell, the bus route along the streets, the canton flag on the square's flagpole |
| `apprentices` | 6 | Mannequins at scale 0.6, no more than 4, disappear on SubagentStop and when the builder moves |
| `realTime`, `windows`, `chimney` | 14, 12, 13 | `advance_time false`, light only in the house being worked on, campfire chimney |
| `advancements` | 18 | The datapack installs itself (verified: it enables), grants on player join |
| `chronicle`, `chronicleWithPrompt` | 22 + chronicle | Lectern by the door, click on the zone by the door, `/trigger chronicle`, the "Town chronicle" section on the page |
| `economy` | chat economy | Small forms on the square and in the park verified (0 mismatches). Not verified: house stages, public works (church/tower/café for the district), forest on slopes, lookout on the summit (needs summit polling) |
| `allay`, `compact`, `storm`, `planMode` | 8, 9, 10, 11 | Allay flight on "transport", smoke break, thunderstorm and lightning on summits only, plan outline |
| `professions`, `scaffolding`, `alphorn`, `quirks` | 16, 17, 27, 30 | Professions and farm animals, scaffolding at the corners and its removal, the horn, TNT/hard hat/dropped tool |
| `townRank`, `francs`, `matterhorn` | 19, 20, 21 | Title and monument, the "Kasse" board, flag and lantern rings on the summit |
| `townHall`, `locatorBar`, `whileAway` | 24, 25, 26 | Dialog with teleports (the pause-menu button appears only after a server restart: dialogs are a static registry), dot color on the locator bar (whether it is visible in creative — check with a client), summary on join |
| `clockBells`, `sbbClock`, `holidays` | 15, 29, 28 | Clock chimes and bear cubs, SBB hands (check the quaternions on all four sides), 1 August / Christmas via `debugClockOffsetMinutes` |

## Builders: realistic mode (live bots)

Setting `builderMode: realistic` (settings page: Builders). Code: `bridge/builders/` (backend interface, mannequin and bot backends, router), `bots/runner.mjs` + `bots/worker.mjs` + `bots/place.mjs` (the bot runner, forked by the bridge, IPC only). It is a mode, not a feature id (default `fast`), so nothing changes in a city until the mode is switched.

| What | Status | Verification (test server, 25.10.2026) |
|---|---|---|
| Backend interface; fast mode routed through it unchanged | done | Same RCON commands as before (only the mannequin exists/kill selectors gained `type=minecraft:mannequin`); houses finished by the fast mode after a switch: 0 mismatches (`node bots/verify.mjs`) |
| One bot per active chat up to `builderBotsMax`, overflow keeps a mannequin, free-memory guard | done | 1 and 3 bots building at the same time; new chats' bots walk over from the district plaza |
| Building by hand in list order; RCON for NBT blocks, potted plants, filled cauldrons, no support, wrong clicks; final read-back fix | done | 98–99 % of the blocks by hand; church and townhouses built by bots: 0 mismatches |
| Switching modes mid-build, bridge restart mid-build, bot kicked or killed | done | The build continues from the same index every time; a kicked bot is back in ~6 s, a killed one respawns at its site. A mannequin taking over from a bot re-checks the bot's part of the list (free where right) |
| Life: walk from the plaza, block in hand, idle at the door, bob and look at you while the chat waits for permission, sleep (walks to the door, a sleeping mannequin takes over), wake, short chat lines | done | Sneak toggles seen server-side while waiting, "!" and bossbar stay; sleep / wake swap verified |
| Renovation helper (an idle bot walks to the changes and swings while the crew sets them) | done | Staged renovation: helper visits counted |
| Physics desync on Paper (bots freezing in 1-block dips) | fixed | Root cause: the client box stops exactly at a wall, Paper's float-width box then overlaps by ~1e-8 and the move is refused (CLIPPED_INTO_BLOCK). Client half width 0.3001: 0 resets on the dip course (`bots/physics-test.mjs`), against 2–549 per run before |
| Smooth motion for mannequins (feature `smoothBuilders`) | behind a flag | Server side verified (the mannequin rides the display at the right height and turns to the next block); the client-side glide was not checked with a game client |
| Server outage with live bots | done (simulated) | Game port and RCON behind switchable proxies (`bots/rcon-proxy.mjs`), 45 s outage: the bridge reconnects, all 3 bots rejoin (back-off up to 12 tries, ~4 min, then a mannequin) and carry on. A real restart of the shared test server was not done |
| Builders engine "offline" (`builderMode: offline`, `bridge/builders/offline.mjs`) | done | RCON behind a proxy switched off: 2 chats earned 1660 blocks offline, the backlog survived a bridge restart, the map showed it hatched; back online the timelapse placed it in ~60 s (`offlineTimelapseSeconds: 60`); `instant` finished a church and started the next house in one go; `node bots/verify.mjs`: 0 mismatches |
| Offline: writing blocks straight into region files while the server is off | not started | Needs correct heightmaps, light and block entities and must never race a running server; the backlog catch-up covers the need |

## Not started

- **House stages in generators and markers** — on the generator side; the contract is described in `docs/generator-contract.md` (`STAGES`, `generate(type, seed, {stage})`, `bp.mark()/toMarkerList()`). The bridge already requests stages and has a fallback (stage 3 yard).
- ~~**Town life**~~: done, see "Life of the city" below.

## Known minor issues

- Renovation runs while at least one chat is active (2 blocks/s, configurable) or there is an awake idle district builder nearby. At night with no chats it waits.
- Seams between plots of different heights place steps on the first rows of the neighbor's street; if the square generator puts grass there, the blocks diverge from the blueprint. This was already the case before renovation.
- The composter on the main square (`level=7`) switches to `level=8` on its own, and one fence in the townhouse changes its connection after neighboring blocks are placed. These are questions for the generators.
- Paper logs sometimes show "Failed to encode value 'DYING'" for mannequins killed in an unloading chunk. The bridge keeps chunks loaded for 4 s after a kill, but old corpses from previous versions remain.

## Generators (architect round 2, 25.10.2026)

| What | Status | Evidence |
|---|---|---|
| Growth stages for 8 home types (`STAGES`, `generate(type, seed, {stage})`), stage-tagged blueprint log, provisional roofs, stage-3 extensions (Wintergarten, awnings, parasols, greenhouse, pergola, beds, bees, woodpile, outhouse, flag) | done, verified | validate-blocks (every stage, 4000 builds), walkcheck all stages, `.dev/stages.mjs`, test server stages 1 and 3 (0 errors) |
| Interior props: candles, cakes, pots, plants, tapestries, coat hooks; markers `painting_spot` (size), `wall_clock`, `coat_rack`, `food_spot` | done, verified | stage 2 of every old type = old house + props only (0 blocks changed) |
| Terrain variants `TERRAIN_VARIANTS`: walk-out cellar with sunken court, Stadel posts / rubble plinth | done, verified | walkcheck `--terrain` all directions and stages, test server 0 errors; needs `turns` in `options.terrain` (request to terrain) |
| New types: lighthouse, boathouse, Schiffstation, lido (shore); school, market hall, station, funicular valley/mountain stations, viewpoint, fire station, post office (public) | done, verified | walkcheck, validate, test server all rotations (0 errors) |
| Not done | — | `terrace_house`, `vineyard`, `seevilla`/`lake_hotel` (terrain §7.2–7.3); stage 3 is small for townhouse/café/hotel/modern/apartment/farmhouse/hut (cramped yards) |

Fixes: rail `shape` now turns and mirrors with the plot in `blueprint.mjs` (no existing type used rails); the market stalls on the main square and the farm use `composter[level=8]`, which no longer ticks away from the blueprint (one block per affected plot renovates).

## Verification round (life agent, 25.10.2026)

Test server, own bridge (`.dev/test-config-life.json`, port 7784, city at x≈−39000, z≈−575), every feature on (preset max), chats simulated with `.dev/sim2.mjs` (new: `ALPS_PROJECT`, `web`, `notify`, `prompt`, `burst`, deterministic subagent ids), a headless test player (`.dev/life-player.mjs`: join messages, sign and entity clicks, triggers), RCON queries (`.dev/life-rc.mjs`, `.dev/life-watch.mjs`), region renders (`tools/map.mjs`), clock shifts with `debugClockOffsetMinutes`.

| id | Result | Evidence / fix |
|---|---|---|
| `callout` | ✔ fixed | "!" rides the builder, red bar, bob, build paused (placed count frozen), cleared by the next tool event. **Fix:** stale bars were never removed (`bossbar list` prints names, not ids): bars are tracked in state; a call that expires (30 min) is hidden even when the builder gets no work ticks |
| `idleCallout` | ✔ changed | One combined yellow bar for all waiting chats ("Waiting for a task: A, B and 3 more") instead of one bar per chat |
| `status` | ✔ fixed | Text changes only on change. **Fix:** "API limit" stayed after the next prompt (shown only while the chat is stopped now); localized; new "Feierabend at the café" state |
| `toolInHand` | ✔ | brush / book / pickaxe / compass by tool category |
| `tests`, `commits`, `push`, `pr` | ✔ | flag red → lime on the lamp post, cloud after 3 failures; "+1 commit" text; bus of 3 displays along street lines, removed at the end; canton banner (Bern) on the plaza flagpole |
| `apprentices` | ✔ | scale 0.6, at most 4 shown (6 started), the next ones appear when others stop, all gone after the last SubagentStop |
| `realTime`, `windows`, `chimney` | ✔ fixed | world time = wall clock; light blocks in the house being worked on. **Fix (chimney):** the campfire of most houses is the last block of the list, so it never smoked; now the chat's own finished house smokes while the chat works, wherever its builder is (signal fire verified), guarded by a chunk-load check |
| `advancements` | ✔ | datapack enabled, grants kept in state and re-granted to the test player on join (checked with the `advancements={…}` selector) |
| `chronicle` | ✔ fixed | lectern + book (marker `lectern_spot`), `/trigger chronicle` (nearest building), `GET /api/chronicle`, `POST /api/teleport`. **Fix:** the click box stood in front of the door and swallowed door clicks → a waxed sign at `sign_spot` runs `/trigger chronicle set <n>`; old boxes and lecterns migrate one house at a time; the slope forest is left out of the list |
| `economy` | ✔ fixed | small forms for short chats; house stages 1 → 2 → 3 by diff with the architect's `STAGES` (removed 138 / kept 868 / placed 662, then 31 more); public works; summit; forest. **Fixes:** the forest grew without bound (2 500 trees in an hour of testing) → capped at 60 + 15 per district (≤ 200), and the job search backs off for 20 s when there is nothing to do; lamps capped per district; the clock tower is city-unique for public works too (the test town had 5); public buildings ask for the last stage; a stage that adds nothing is taken silently (no rebuild walk, no fireworks) |
| `allay`, `compact`, `planMode`, `quirks` | ✔ | allay rides a display and is removed; crouch + stew + actionbar; map in hand; TNT, dropped tool (despawns), helmet by model |
| `storm` | ✔ | thunder weather; strikes only on peaks with no villager or builder within 64 blocks (none in the compact test town, by design) |
| `professions`, `scaffolding`, `alphorn` | ✔ fixed | professions by house type; farm animals get `alps_grounded` (gravity sweep, see below). **Fix (scaffolding):** the corners came from the bounding box of everything above the ground floor (lamps, fences, flag poles), so most houses got 0–1 columns; now from the house body (2–4 columns for every type except church and clock tower) |
| `townRank`, `francs`, `matterhorn` | ✔ fixed | "Dorf Lifeproj" nameplate; "Kasse: CHF 10" from a test transcript (dedup by message id); fixed UUID for the board. **Fix (matterhorn):** the flag pole stood on the summit, through the viewpoint shelter's roof and cross; it now stands 4 blocks away, existing flags are moved and the shelter is restored from its own list |
| `clockBells`, `sbbClock`, `holidays` | ✔ fixed | bears circle the clock tower at the hour; 15 hand displays on 5 dials, quaternion math checked for all four faces; dials now also from `clock_spot` markers (plotmeta found 1 of 4 on the new clock tower). 1 August: flags, bonfires on the peaks, fireworks at 21:00; Christmas: rain. **Fix:** the August flags stayed during Christmas |
| `whileAway` | see the report | waiting-chat links verified; the absence summary needs a 10-minute absence |
| `townHall`, `locatorBar` | not verified | need a game client (dialogs, locator bar); fixed the follow-trigger regex (`/has (d+)/`) |

NoAI mobs have no gravity (the floating villagers of the live city): every NoAI animal the bridge places is tagged `alps_grounded`, and a sweep every 10 s moves it down onto the ground (or up out of a block) after renovations and terraces; fish (`alps_fish`) out of water are removed.

## Life of the city (life agent)

Code: `bridge/features/citylife.mjs` (residents, seated people, the builders' day, animals), `bridge/features/landscape.mjs` (cable car, train, paragliders, lake steamer), `bridge/features/chatter.mjs` (builder chat lines), `bridge/features/markers.mjs` (generator markers in world coordinates, gravity sweep). Settings: `lifeDensity` low / medium / high, `chatterFrequency` rare / normal / often; every system has its own switch (group "Life of the city").

| id | What | Verified (test server) |
|---|---|---|
| `residents` | Villagers with AI live in the houses (one per family bed, at most 2 per house; caps per house/district/city 1/3/12 · 2/6/30 · 2/10/48), replace the door villager (restored when switched off), golem spawning suppressed through their brain memory | 12–15 residents; 8 slept in their own beds at night, 9 claimed homes, 3 job sites; switch-off removed all and brought the door villagers back |
| `seated` | Mannequins riding invisible displays on `seat` markers: café 8–20 h, church on Sunday 9–12 h (hymn books), hotel 12–14 / 18–22 h, family table 18–21 h, a newspaper reader on squares 10–18 h; new guests every hour; caps 6 / 14 / 24 | 14 at medium (the cap), church pews on a Sunday morning, the seat block is re-checked before summoning |
| `builderLife` | hi-vis vest and yellow hard hat (the model helmet wins), cheer on finish (firework in hand, hops), Feierabend at the district café 17–20 h (seated, honey bottle), then home to the own bed (`sleeping_pos`) instead of lying in the street | all of it; work that is not the own house is released while the chat sleeps and picked up again when it wakes |
| `animals` | pasture cows and a goat (AI, free cells inside the fence), hens, cats (tamed, sitting), a St. Bernard at huts, bees over flower beds, fish in fountains, a frog on the fountain rim, rabbits in rural meadows; caps per district/city 2/8 · 4/20 · 6/36 | fish, frogs, cats in the test town; pasture placement checked offline for all four rotations |
| `cableCar` | gondola on a cable from the town edge to the nearest peak, pylons where the slope needs them (upper hull of ground + 9), re-planned when the town grows | 20 displays, the gondola moves every 3 s and waits 15 s at the stations |
| `train` | red train (locomotive + 2 coaches) on a loop of streets between the plazas one street network reaches (junction heights within 2 blocks), else around one plaza's block; hops never cross a corner | a 75-block ring round a plaza, station stops with the horn |
| `paragliders` | now and then from a peak to a meadow at the town edge, 9–19 h, at most 2 in the air: a sitting pilot under a three-panel wing (fx-tagged, swept if lost) | take-off, 5 hops, landing |
| `boats` | lake steamer between the harbour landing, the harbour mouth, the open lake and the pier heads (terrain anchors in `state.terrain.anchors`), every leg probed for water | with anchors injected on a test lake: 4 stops, moves on the water surface |
| `chatter` | builders' chat lines: `say(session, key, params, {priority})`, `registerSpeaker` for bot chat, a `Chatter` class for the wild server; global gap + per-builder + per-kind cooldowns, no repeats, quiet at night with real time | greetings, red tests, starts and finishes seen in chat; limiter unit-checked |

Entity budget at medium density (test town, 40 plots): residents 15, seated 14 (+14 invisible vehicles), animals 16, cable car 20 displays, train 12, steamer 7, gliders up to 10 for a minute: about 110, of which only the villagers have AI. Life entities are created only where a player is near (chunk loaded for 3 s), and switching a system off removes everything it made (unloaded chunks through a short force-load queue).

Open: the sitting height and the look of the glider, train and cable car were checked server-side only (rider offset −0.6 measured), not with a game client; frogs sit on the fountain rim (no pond markers yet); the train cannot ride terraced streets (junctions more than 2 blocks apart), so hilly towns get one plaza ring at most.

## Terrain-adaptive town (terrain agent, October 2026)

Done and verified on the test server (`adaptive-terrain`, `waterfront`, `river-bridges`, `shore-renovation`, all in `TESTED`): scan-driven `nextCell` (never water or cliffs), plot level from the region-file scan without the old clamp, earthwork budget (terraces, retaining walls with a cellar, stilt decks, decks over water), seams by height difference (stairs, Treppengasse, wall), stair lanes and viewpoints on the hillside, quays, jetties, promenade, lido, harbour with lighthouse, covered / arch bridges, scan-based site selection for a new city, additive shore renovation of existing plots with a read-only dry run (`node tools/terrain-report.mjs --migrate`). Details, images and earthwork numbers: `docs/terrain-adaptive-design.md` §11. Anchors for boats and steamers: `docs/world-anchors.md`.

Open: contour blocks / irregular plots; the fleet (life agent); generator lighthouse on the breakwater; PostAuto and residents on stairs and decks; viaduct untested in game.
