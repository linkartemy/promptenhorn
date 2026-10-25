# Generator and Bridge Contract

What the bridge (`bridge/`) expects from the building generators (`bridge/buildings.mjs`, assembled from `.dev/parts/*.mjs` via `node .dev/assemble.mjs`) and what it does with their output. Everything here is backward compatible: a generator that does not know the new fields keeps working, and the bridge substitutes a fallback.

## 1. What already exists and must not break

| Export | What it is |
|---|---|
| `BUILDINGS[type](rng)` | Building generator. Returns a `Blueprint` in the local 0..16 frame (the bridge applies the offset of 2 into the 21×21 plot) |
| `generate(type, seed, options?)` | `BUILDINGS[type](rngFrom(\`${seed}:${type}\`), options)` |
| `square(rng)`, `plaza(rng)` | Main square and district square (the whole plot) |
| `CATALOG[type]` | `{ label, zones: {core, inner, outer, rural}, unique?: 'district'|'city' }` — type selection by zone |
| `Blueprint#toBuildList({turns, size, offset, clipMin, clipMax})` | Ordered list of `{x, y, z, block, decor}` |

Determinism is mandatory: the same `seed` produces the same list. The bridge uses the list's hash to detect that the blueprint has changed.

## 2. Generator versions and renovation

The bridge computes the version as `sha256(buildings.mjs + "\0" + blueprint.mjs)`, first 12 hex characters, and at startup puts a copy of both files into `bridge/archive/<version>/`. Every plot remembers which version it was built with (`plot.gen`).

If the version has changed:

- **unfinished house**: the bridge compares the already placed part of the old list with the new list, removes what is no longer needed and continues building from the new list, skipping blocks that are already correct;
- **finished houses, squares, the main square** (the "Renovation instead of demolition" feature): the renovation crew changes only the difference. First it removes decor that no longer exists or has changed, then surplus structure from top to bottom, then places the new parts in the normal build order. Unchanged blocks are left untouched.

Hence the requirements for generators:

1. The archived copy must load on its own: `buildings.mjs` imports only `./blueprint.mjs` (relative path), no other project modules.
2. Do not remove a type from `BUILDINGS` while the town still has buildings of that type. If a type does disappear anyway, the bridge leaves the old houses as they are.
3. A plot's seed and rotation never change, so it is best when a generator edit changes only what has actually changed. Reordering the random `rng` calls at the start of a generator repaints the whole house, and renovation turns into a rebuild.

`bridge/archive/legacy.txt` points to the version directory that built the plots without a `gen` field (the town from before versioning). Do not delete directories from the archive while plots still reference them (`/status` → `generators.outdatedPlots`).

## 3. House growth stages (new; generators need to implement this)

With the "Chat economy" feature, a chat's house grows in stages instead of being built in full at once:

| Stage | What it is | When (default) |
|---|---|---|
| 1 | Small house: living core (1 floor + roof) | the chat has reached 20 actions |
| 2 | Full house (what the generators build now) | 80 actions |
| 3 | Expansion: annex, garden, flag, greenhouse, terrace | 200 actions |

The bridge performs the transition between stages with the same diff as renovation, so **stage N+1 must contain almost all of stage N**: add, don't rearrange. It is acceptable to remove what gets in the way (the temporary stage-1 roof above the future second floor), but the walls, floor and interior of stage 1 must stay in place.

Contract:

```js
// How many stages a type supports (1..3). Type missing from STAGES, or STAGES not exported = 1 stage.
export const STAGES = { chalet: 3, townhouse: 3, hut: 2 /* … */ };

// options.stage = 1..STAGES[type]; without options the generator builds the last stage.
export function generate(type, seed, options = {}) {
  return BUILDINGS[type](rngFrom(`${seed}:${type}`), options);
}
export function chalet(rng, { stage = 3 } = {}) { /* … */ }
```

- `rng` is consumed identically at every stage. Make all random decisions first, then render according to the stage. Otherwise stage 2 will be a different house rather than a continuation of stage 1.
- The bridge requests `stage = min(plot stage, STAGES[type])`. If a generator does not know about stages, stages 1 and 2 are identical (the full house), and at stage 3 the bridge itself adds a flagpole with a Swiss flag and flower beds to the yard (`yardExtras` in `bridge/smallforms.mjs`) on free lawn cells.
- Public buildings (church, tower, café built "for the district") are requested at the last stage right away.
- `square` and `plaza` have no stages.

## 4. Markers (side-channel; generators need to implement this)

For "Life of the city" (villagers on a daily schedule, seated people, animals, the chronicle by the door) the bridge needs points inside and around the building. They do not change any blocks and are not part of the blueprint hash.

```js
// In Blueprint (blueprint.mjs):
bp.mark(kind, x, y, z, { facing, data })            // in the generator's local frame, like bp.set
bp.toMarkerList({ turns, size, offset, clipMin, clipMax })
// -> [{ kind, x, y, z, facing?, data? }] with the same offset and rotation as toBuildList
//    (facing is rotated the same way as the facing of blocks)
```

| kind | Where to place it | What the bridge does with it |
|---|---|---|
| `door` | the cell in front of the main door, outside | chronicle (lectern nearby, click zone), where the builder arrives |
| `lectern_spot` | a free cell by the entrance for the lectern | the "House chronicle" book |
| `bed` | head of the bed (`data: {owner: 'family'\|'guest'}`) | a sleeping builder "goes home", villagers at night |
| `workstation` | job-site block or a spot for one (`data: {profession}`) | villager's profession |
| `seat` | a cell where someone sits (stair chair, bench), `facing` = where they look | seated people: café by day, church on Sundays, Stube |
| `bell` | bell | commits, clock chimes |
| `clock_spot` | center of the clock face, `facing` = outward | hands of the SBB clock |
| `light` | the cell by a window, inside | lights in the windows while the chat is working |
| `pasture` | center of the pen (`data: {w, d}`) | cows and goats |
| `pet_spot` | spot for a cat or dog | cat, St. Bernard at the hut |
| `sign_spot` | spot for a sign by the entrance | (reserved) |
| `painting_spot` | wall for a painting | (reserved) |

Until markers exist, the bridge infers what it can from the block list itself (`bridge/plotmeta.mjs`): bells, campfire chimneys, doors, cells behind windows for lights, clock faces by the `clockFace` pattern, free lawn cells. Once markers appear, the bridge uses them first.

## 5. Checks

- `node tools/validate-blocks.mjs`: all blocks and properties exist in 1.21.11 (runs all types; with stages, run every stage).
- `.dev/ingame-check.mjs`: build on the test server, nothing breaks off.
- For stages: the stage N+1 list contains ≥ 90% of the stage N positions with the same block (the bridge checks this on the first transition and logs `removed / already right / to place`).

## 6. Markers: what the generators already have (the "livability" round)

Initial implementation of the API from section 4. Markers live separately from blocks (`bp.markers`) and are not included in `toBuildList` or the hash; editing markers does not rebuild houses.

- `Blueprint#mark(kind, x, y, z, { facing, data })` in the generator's local frame.
- `Blueprint#toMarkerList({ turns, size, offset, clipMin, clipMax })`: the same offset, clipping and rotation as `toBuildList`; `facing` is rotated like that of blocks. `mirrorX()` mirrors markers too.
- All exports (`BUILDINGS[type]`, `generate`, `square`, `plaza`) run the blueprint through `autoMarks`, which infers common points from the finished blocks:
  - `door`: the outside cell in front of the frontmost ground-floor door, `facing` outward. Next to it `lectern_spot`, `pet_spot` and `sign_spot` (if there is room);
  - `seat`: single wooden or quartz stairs (chairs, benches, church pews) that are not part of staircases or roofs, `facing` = where the seated person looks;
  - `bed`: head of a bed under a roof, `data.owner` = `guest` in the hotel and the hut, otherwise `family`;
  - `workstation`: smoker → butcher, lectern → librarian, loom → shepherd, water_cauldron → leatherworker, composter → farmer, first barrel → fisherman;
  - `bell`: every bell. On the main square (pedestal at the south edge) and on the district square (under the notice board canopy) bells were added as gathering points.
- Generators place these themselves:
  - `light`: the inside cell behind every window, `facing` outward;
  - `clock_spot`: center of every clock face, `facing` outward;
  - `painting_spot`: a free wall in a living room;
  - `pasture`: the farm's pen, `data: {w, d}`.

Next (not done): interior props (paintings, cuckoo clocks and plates as entities at these points), growth stages (section 3, `STAGES`).

## 7. Terrain variants (requested by terrain)

*Added by the terrain agent (adaptive terrain, `bridge/terrain.mjs`, `bridge/infra.mjs`). Nothing here is required: a generator that ignores it keeps working, and the bridge builds a fallback itself.*

With the feature "Town follows the terrain" (`adaptive-terrain`) a new plot no longer sits on a flattened lot. Its street level comes from a scan of the terrain, and the lot is prepared in one of four modes:

| `mode` | Lot | Bridge fallback today |
|---|---|---|
| `level` | cut and fill ≤ 3 blocks | nothing special |
| `terrace` | drop of 4–5 blocks: lot behind a stone retaining wall on the downhill side | rubble retaining wall + railing |
| `walkout` | drop of 6–8 blocks | the same wall, plus a vaulted cellar with a door in it (a "Keller") |
| `stilts` | drop of 9–14 blocks | where the ground is deeper than 3 blocks, a plank deck on spruce log posts |

Lots that touch water are never filled: lot columns over water become a deck on waterlogged posts, the lot edge a quay wall.

### 7.1 What the bridge passes

`plot.terrain` (stored on the plot) and, **only for types listed in `TERRAIN_VARIANTS`**, `options.terrain` in `generate(type, seed, options)`:

```js
options.terrain = {
  mode: 'walkout',          // level | terrace | walkout | stilts
  aspect: 'E',              // downhill direction in world coordinates (N, S, E, W)
  drop: 7,                  // blocks from the street level down to the lowest ground of the lot (p2)
  waterSides: ['S'],        // world sides of the cell that touch water
  cls: 'steep',             // terrain class of the cell (flat, gentle, steep, shoreline, forest)
  v: 1,
};
// The building is rotated by plot.turns after generation; turns = 0 means the front faces +z (south).
// Downhill in the generator's own frame: rotate `aspect` back by plot.turns (one turn maps (dx, dz) -> (-dz, dx)).
```

Opt in per type and mode, so plots of types without variants keep the exact list they have today (renovation hashes stay stable):

```js
export const TERRAIN_VARIANTS = { chalet: ['walkout', 'stilts'], farmhouse: ['walkout'], hut: ['stilts'], townhouse: ['terrace', 'walkout'] };
```

When a generator declares the mode, the bridge **skips its own fallback** for that plot (no cellar in the wall) and expects the house to show the slope itself. Negative `y` in the build list is fine (the bridge adds `plot.y`); the lot is still filled to the street level, so a basement storey should be drawn on the downhill side of the footprint (local y = −1 … −drop) as a visible stone storey.

### 7.2 Requested variants

| Type · variant | Mode | What it should look like |
|---|---|---|
| `chalet`, `townhouse`, `farmhouse` · walk-out | `terrace`, `walkout` | A stone basement storey (Sockelgeschoss) on the downhill side: cellar or workshop with a door or a small garage gate, two small windows; balcony above it. Entrance stays on the street side. |
| `chalet`, `hut` · stilts | `stilts` | Floor at street level, spruce log posts or a stone pier under the downhill half (Walliser Stadel: `stone_slab` "mushroom" caps on the posts), a short stair from the street. |
| `terrace_house` (Reihenhaus) | `terrace` | 2–3 narrow units stepping down the slope, each half a storey lower, roofs stepping too. |

### 7.3 Requested new building types (water and harbour)

The infrastructure around them (quays, jetties, breakwater, lido beach, promenade, bridges) is built by the bridge (`bridge/infra.mjs`). These are houses that stand on a normal plot next to it; give them `CATALOG[type].terrain` weights so `pickType` puts them by the water.

| Type | Where | Look |
|---|---|---|
| `boathouse` (Bootshaus) | shore plot | Timber house on posts at the water's edge, open water inside, a boat, a gate to the lake. |
| `lido_cafe` (Badi-Kiosk) | shore plot next to a lido beach | Small kiosk with a striped awning, a counter, tables with parasols. |
| `lighthouse` | (bridge places it on the breakwater head) | Small red-and-white lake lighthouse (Romanshorn / Brunnen), 3×3 to 5×5, lamp room on top. The bridge builds a simple fallback today; if `BUILDINGS.lighthouse` appears, the harbour will use it. |
| `schiffstation` | shore plot at the harbour | Pavilion with an SBB clock, a timetable board ("Abfahrt"), benches, a waiting room. |
| `seevilla`, `lake_hotel` | shore plot | Villa / grand hotel with a garden or terrace facing the water (Montreux, Vitznau). |
| `vineyard` (Rebberg, Lavaux) | `terrace`/`walkout` lots facing south | Rows of vines on terraces with a winegrower's hut. |

### 7.4 Terrain weights for `pickType`

`CATALOG[type].terrain = { waterfront, slope, stilts }` multiplies the zone weight on shore lots, on `terrace`/`walkout` lots and on `stilts` lots. Without it the bridge uses its own defaults (`TERRAIN_WEIGHTS` in `bridge/city.mjs`): chalets and huts ×2–3 on slopes, farms ×0.3–0.5, hotel ×3 and cafe ×2.5 by the water.
