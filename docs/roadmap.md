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

## Not started

- **House stages in generators and markers** — on the generator side; the contract is described in `docs/generator-contract.md` (`STAGES`, `generate(type, seed, {stage})`, `bp.mark()/toMarkerList()`). The bridge already requests stages and has a fallback (stage 3 yard).
- **Town life**: villagers with daily routines (beds, workplaces, bells from markers), seated people (café by day, church on Sundays, Stube), builder outfits, sleeping in their own bed and "Feierabend" at the café, animals in their places (pasture, cat, St. Bernard, bees, fish, frogs, rabbits), cable car, train, paragliders, boats. Requires markers from generators, a density setting (low/medium/high), and strict entity limits. The bridge already has a `replacesVillager` hook to replace the current villager by the door.

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
