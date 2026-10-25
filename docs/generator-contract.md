# Generator and Bridge Contract

What the bridge (`bridge/`) expects from the building generators (`bridge/buildings.mjs`, assembled from `.dev/parts/*.mjs` via `node .dev/assemble.mjs`) and what it does with their output. Everything here is backward compatible: a generator that does not know the new fields keeps working, and the bridge substitutes a fallback.

## 1. Exports

| Export | What it is |
|---|---|
| `BUILDINGS[type](rng, options?)` | Building generator. Returns a `Blueprint` in the local 0..16 frame (the bridge applies the offset of 2 into the 21×21 plot). `options.stage`, `options.terrain` (sections 3, 7) |
| `generate(type, seed, options?)` | `BUILDINGS[type](rngFrom(\`${seed}:${type}\`), options)` |
| `square(rng)`, `plaza(rng)` | Main square and district square (the whole plot) |
| `STAGES[type]` | Number of growth stages of a type (section 3); missing = 1 |
| `TERRAIN_VARIANTS[type]` | Terrain modes the generator builds itself (section 7) |
| `CATALOG[type]` | `{ label, labelKey, kind, zones, unique?, site?, variants?, pair? }` (section 8) |
| `LABELS`, `LABEL_KEYS` | English names and i18n keys (`building.<type>`) incl. `square`, `plaza` |
| `localSide(worldSide, turns)` | World side (N/E/S/W) → the generator's local side for a plot rotated `turns` times |
| `YARD_FORMS`, `yardForm(kind, seed, wood?)` | Stage-3 yard items as standalone small forms (section 9) |
| `Blueprint#toBuildList({turns, size, offset, clipMin, clipMax})` | Ordered list of `{x, y, z, block, decor}` |
| `Blueprint#toMarkerList(...)` | Markers, same mapping (sections 4, 6) |

Determinism is mandatory: the same `seed` (and options) produce the same list. The bridge uses the list's hash to detect that the blueprint has changed. Blocks may have negative `y` (cellars, slips, dug trenches); `minecraft:air` entries dig out the lot fill and are placed like any block.

## 2. Generator versions and renovation

The bridge computes the version as `sha256(buildings.mjs + "\0" + blueprint.mjs)`, first 12 hex characters, and at startup puts a copy of both files into `bridge/archive/<version>/`. Every plot remembers which version it was built with (`plot.gen`).

If the version has changed:

- **unfinished house**: the bridge compares the already placed part of the old list with the new list, removes what is no longer needed and continues building from the new list, skipping blocks that are already correct;
- **finished houses, squares, the main square** (the "Renovation instead of demolition" feature): the renovation crew changes only the difference. First it removes decor that no longer exists or has changed, then surplus structure from top to bottom, then places the new parts in the normal build order. Unchanged blocks are left untouched.

Hence the requirements for generators:

1. The archived copy must load on its own: `buildings.mjs` imports only `./blueprint.mjs` (relative path), no other project modules. (This is also why `CATALOG` carries `labelKey` instead of calling `t()`.)
2. Do not remove a type from `BUILDINGS` while the town still has buildings of that type. If a type does disappear anyway, the bridge leaves the old houses as they are.
3. A plot's seed and rotation never change, so a generator edit should change only what has actually changed. Reordering the random `rng` calls repaints the whole house, and renovation turns into a rebuild. **New features draw after the generator's last original `rng` decision** (the mirror decision is taken first, then stage overlays, stage 3, terrain variant, props, then the mirror is applied). Verified for this round: stage 2 of every existing type is block-for-block the previous house plus props (0 blocks removed or changed over 10 types × 6 seeds).

`bridge/archive/legacy.txt` points to the version directory that built the plots without a `gen` field (the town from before versioning). Do not delete directories from the archive while plots still reference them (`/status` → `generators.outdatedPlots`).

## 3. House growth stages (implemented)

With the "Chat economy" feature, a chat's house grows in stages instead of being built in full at once:

| Stage | What it is | When (default, `config.stageActions`) |
|---|---|---|
| 1 | Small house: the ground floor (or shop + one flat, the lower storeys of the apartment block) under a provisional roof, with a bed, a washtub, a kitchen | the chat has its first house |
| 2 | Full house (the house the generators built before stages) | 80 actions |
| 3 | Extension: Wintergarten, awnings, parasol tables, greenhouse, pergola, beds, bees, woodpile, outhouse, flag | 200 actions |

```js
export const STAGES = { chalet: 3, townhouse: 3, cafe: 3, hotel: 3, modern: 3, apartment: 3, farmhouse: 3, hut: 3 };
generate(type, seed, { stage })   // 1..STAGES[type]; out of range is clamped; no stage = the last stage
```

How it works (`bridge/blueprint.mjs`): every `set()` is logged with the stage being drawn (`bp.stage`). A generator draws all stages in one pass, so `rng` use is identical for every stage, and only switches `bp.stage` around the parts that belong to stage 2 or 3. `bp.overlay(1, 1, fn)` draws things that exist only in stage 1 (the provisional roof, the bed in the future stair hall, the attic ladder) on a copy of stage 1. `bp.atStage(n)` replays the log up to stage n; `BUILDINGS[type]` returns that, with `autoMarks`. Markers carry their stage too.

Transitions (12 seeds per type, the same position diff the renovation uses; `node .dev/stages.mjs all 12`):

| Type | Blocks per stage (avg) | 1→2 removed (avg / max) | kept | 2→3 removed | kept |
|---|---|---|---|---|---|
| chalet | 781 / 1445 / 1553 | 231 / 272 | 70.4% | 14 | 99.0% |
| townhouse | 1122 / 1792 / 1811 | 236 / 248 | 79.0% | 0 | 100% |
| cafe | 1260 / 1495 / 1518 | 133 / 245 | 89.5% | 0 | 100% |
| hotel | 1503 / 2490 / 2506 | 354 / 354 | 76.4% | 9 | 99.6% |
| modern | 624 / 1024 / 1033 | 46 / 50 | 92.6% | 1 | 100% |
| apartment | 1083 / 1747 / 1759 | 129 / 129 | 88.1% | 0 | 100% |
| farmhouse | 605 / 882 / 893 | 4 / 4 | 99.4% | 3 | 99.7% |
| hut | 717 / 863 / 880 | 174 / 174 | 75.7% | 0 | 100% |

What 1→2 removes is the provisional roof and its gable triangles (and a few floor planks where the staircase opening is cut): the renovation reads as "raising the roof" (Aufstockung), walls, floors and furniture of stage 1 stay. The farmhouse's stage-1 roof is the front half of the final roof (the barn and the back half come later), so almost nothing is removed. The ≥ 90% guideline holds for 2→3 everywhere and for 1→2 where no roof has to be lifted; a lifted roof costs 70–80%. Stage 3 removes only a few meadow flowers, a bench and the door step a Wintergarten covers.

Suggested thresholds for the economy (`config.stageActions`, life agent): stage 2 at 80 actions, stage 3 at 200 (unchanged); a chat at stage 1 builds 600–1500 blocks, i.e. 5–12 minutes of building at the default pace, which suits a first session. Public buildings (`kind: 'public'`, and church/clock tower/café built for the district) are requested at `MAX_STAGE` and come complete; types without stages ignore `stage`.

## 4. Markers (side-channel)

For "Life of the city" (villagers on a daily schedule, seated people, animals, the chronicle by the door) the bridge needs points inside and around the building. They do not change any blocks and are not part of the blueprint hash.

```js
// In Blueprint (blueprint.mjs):
bp.mark(kind, x, y, z, { facing, data })            // in the generator's local frame, like bp.set
bp.toMarkerList({ turns, size, offset, clipMin, clipMax })
// -> [{ kind, x, y, z, facing?, data? }] with the same offset and rotation as toBuildList
//    (facing and data.dir are rotated the same way as the facing of blocks)
```

| kind | Where it is | What the bridge does with it |
|---|---|---|
| `door` | the cell in front of the main door, outside | chronicle (lectern nearby, click zone), where the builder arrives |
| `lectern_spot` | a free cell by the entrance for the lectern | the "House chronicle" book |
| `bed` | head of the bed (`data: {owner: 'family'\|'guest'}`) | a sleeping builder "goes home", villagers at night |
| `workstation` | job-site block or a spot for one (`data: {profession}`) | villager's profession |
| `seat` | a cell where someone sits (stair chair, bench), `facing` = where they look | seated people: café by day, church on Sundays, Stube |
| `bell` | bell | commits, clock chimes |
| `clock_spot` | center of an outdoor clock face, `facing` = outward | hands of the SBB clock |
| `light` | the cell by a window, inside (`data.beacon` on the lighthouse lamp) | lights in the windows while the chat is working |
| `pasture` | center of the pen (`data: {w, d}`) | cows and goats |
| `pet_spot` | spot for a cat or dog | cat, St. Bernard at the hut |
| `sign_spot` | spot for a sign by the entrance | (reserved) |
| `painting_spot` | free wall at eye level, `facing` = into the room, `data: {w, h, dir}` | painting entity (new, see section 6) |
| `wall_clock` | free wall cell at head height (y+2), `facing` = into the room | item frame / item display with a clock (new) |
| `coat_rack` | floor cell by the front door inside, `facing` | armor stand with coat and hat (new) |
| `food_spot` | top of a dining table (the carpet cell), `data: {item}` | item display with food on a plate (new) |
| `boat_spot` | water surface in a slip or by a jetty, `facing`, `data: {kind}` | a boat (new) |
| `ship_spot` | water by the steamer landing, `data: {kind: 'steamer'}` | where the lake steamer berths (new) |
| `vehicle_spot` | floor of a garage bay, `facing`, `data: {kind}` | e.g. the fire engine model stands there (new) |
| `rail_track` | start of the station track, `facing` = east, `data: {to}` | where the train runs through the plot (new) |
| `funicular` | lower/upper end of the funicular track, `data: {end, top\|bottom}` | the funicular car's path between the two stations (new) |
| `spyglass_spot` | on a post at the viewpoint railing, `data: {item}` | item display with a spyglass (new) |
| `pool_spot` | water in front of the lido, `data: {swimmers}` | swimmers (new) |

Until markers exist, the bridge infers what it can from the block list itself (`bridge/plotmeta.mjs`). Once markers appear, the bridge uses them first. **Note:** `clock_spot` is for outdoor dials only (the SBB-hands feature puts hands there); indoor clocks are `wall_clock`.

## 5. Checks

- `node tools/validate-blocks.mjs`: all blocks and properties exist in 1.21.11 — every type, **every growth stage**, 25 seeds × 4 rotations.
- `node tools/walkcheck.mjs all 5`: walkability and livability (`docs/building-standards.md`) for every type and **every stage** (`--stage n` for one stage, `--terrain '{"mode":"walkout","drop":6,"downhill":"west"}'` for the terrain variants).
- `node .dev/stages.mjs all 12`: blocks per stage, removed / kept / added per transition; `node .dev/stagediff.mjs <type> [seed] [from]` lists what a transition removes.
- `.dev/ingame-check.mjs [types] [seeds] [rotations]` with `STAGE=n`, `TERRAIN='{…}'`, `X0`/`Z0`: builds on the test server, nothing breaks off, connection states match vanilla.
- Previews: `STAGE=n TERRAIN='{…}' node .dev/preview2.mjs <type> <seed> <out.png>` and `.dev/floorplan.mjs` (plans per level, including cellars).

## 6. Markers and props in the generators

Markers live separately from blocks (`bp.markers`) and are not included in `toBuildList` or the hash.

- All exports run the blueprint through `autoMarks`, which infers `door` (+ `lectern_spot`, `pet_spot`, `sign_spot`), `seat`, `bed`, `workstation`, `bell` from the finished blocks.
- Generators place `light` (behind every window), `clock_spot` (outdoor dials), `pasture` (farm), and the new kinds of section 4.
- **Props pass** (`decorate`, `.dev/parts/00c-props.mjs`), run at the end of every generator over the rooms `furnish()` recorded, in the room's growth stage:
  - on furniture with a full top (barrels, crafting tables, bookshelves, counters): candles, cakes, decorated pots, potted plants — 1–3 per room by room kind;
  - a tapestry (wall banner with a Swiss pattern) on a blank wall of a living room, Stube, office or guest room;
  - coat hooks (`tripwire_hook`) beside the front door inside, and a `coat_rack` spot;
  - `food_spot` on every dining table, `wall_clock` on a blank wall of kitchens and Stuben, and `painting_spot` with its size: `data: {w: 1..2, h: 1..2, dir}` — the painting covers `w` cells from the marker towards `dir` (a compass direction, rotated with the plot) and `h` cells upwards.
  - Props are purely additive: no existing block of any house changes.

## 7. Terrain variants

### 7.0 What the generators build (architect, implemented)

`TERRAIN_VARIANTS = { chalet: ['walkout', 'stilts'], townhouse: ['walkout'], farmhouse: ['walkout'], hut: ['stilts'] }`. For these modes the generator shows the slope itself (the bridge then skips its cellar fallback); `terrace`, and other types, stay with the bridge.

- **walkout**: a stone cellar storey under the house (floor at y = −4, walls −3…−1, workshop and store: barrels, chest, workbench, composter, lantern, a `workstation` marker), reached by a ladder through a hatch in the ground floor (chosen by a flood fill from the front door so it never cuts a passage and is reachable in every stage). On the downhill side, where the yard has room (2–3 rows, facade ≥ 6 wide, not the street side), a sunken court is dug out: gravel floor at the cellar level, retaining walls, a fence railing, stone steps down from the yard, the cellar door and two windows facing it, a lantern. The court stays inside the 17×17 house area (the street ring and the bridge's retaining wall are not touched).
- **stilts**: Valais Stadel "mushrooms" under the house — log posts from y = −2 down to −`drop` at the corners, every 3 blocks along the walls and on an inner grid, each capped with a cross of stone slabs (top half) at y = −1; the hut gets a rubble plinth under its walls instead.
- Downhill side in the generator's frame: `options.terrain.downhill` (local: `north` = back, `south` = front/street, `east`, `west`), or the world `aspect` turned back with `options.terrain.turns` (`localSide(aspect, turns)`). **Request to the bridge:** `plot.terrain` has no `turns`; please pass `terrain: { ...plot.terrain, turns: plot.turns }` (or `downhill: localSide(plot.terrain.aspect, plot.turns)`). Without it the generators assume the slope falls to the back.
- All variants exist in every growth stage (the cellar belongs to stage 1) and pass `tools/walkcheck.mjs --terrain` in every direction, and the test server (0 errors).

### 7.1–7.4 The terrain agent's request (kept as written)

*Added by the terrain agent (adaptive terrain, `bridge/terrain.mjs`, `bridge/infra.mjs`). Nothing here is required: a generator that ignores it keeps working, and the bridge builds a fallback itself.*

With the feature "Town follows the terrain" (`adaptive-terrain`) a new plot no longer sits on a flattened lot. Its street level comes from a scan of the terrain, and the lot is prepared in one of four modes:

| `mode` | Lot | Bridge fallback today |
|---|---|---|
| `level` | cut and fill ≤ 3 blocks | nothing special |
| `terrace` | drop of 4–5 blocks: lot behind a stone retaining wall on the downhill side | rubble retaining wall + railing |
| `walkout` | drop of 6–8 blocks | the same wall, plus a vaulted cellar with a door in it (a "Keller") |
| `stilts` | drop of 9–14 blocks | where the ground is deeper than 3 blocks, a plank deck on spruce log posts |

Lots that touch water are never filled: lot columns over water become a deck on waterlogged posts, the lot edge a quay wall.

#### 7.1 What the bridge passes

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

#### 7.2 Requested variants

| Type · variant | Mode | What it should look like |
|---|---|---|
| `chalet`, `townhouse`, `farmhouse` · walk-out | `terrace`, `walkout` | A stone basement storey (Sockelgeschoss) on the downhill side: cellar or workshop with a door or a small garage gate, two small windows; balcony above it. Entrance stays on the street side. |
| `chalet`, `hut` · stilts | `stilts` | Floor at street level, spruce log posts or a stone pier under the downhill half (Walliser Stadel: `stone_slab` "mushroom" caps on the posts), a short stair from the street. |
| `terrace_house` (Reihenhaus) | `terrace` | 2–3 narrow units stepping down the slope, each half a storey lower, roofs stepping too. |

#### 7.3 Requested new building types (water and harbour)

The infrastructure around them (quays, jetties, breakwater, lido beach, promenade, bridges) is built by the bridge (`bridge/infra.mjs`). These are houses that stand on a normal plot next to it; give them `CATALOG[type].terrain` weights so `pickType` puts them by the water.

| Type | Where | Look |
|---|---|---|
| `boathouse` (Bootshaus) | shore plot | Timber house on posts at the water's edge, open water inside, a boat, a gate to the lake. |
| `lido_cafe` (Badi-Kiosk) | shore plot next to a lido beach | Small kiosk with a striped awning, a counter, tables with parasols. |
| `lighthouse` | (bridge places it on the breakwater head) | Small red-and-white lake lighthouse (Romanshorn / Brunnen), 3×3 to 5×5, lamp room on top. The bridge builds a simple fallback today; if `BUILDINGS.lighthouse` appears, the harbour will use it. |
| `schiffstation` | shore plot at the harbour | Pavilion with an SBB clock, a timetable board ("Abfahrt"), benches, a waiting room. |
| `seevilla`, `lake_hotel` | shore plot | Villa / grand hotel with a garden or terrace facing the water (Montreux, Vitznau). |
| `vineyard` (Rebberg, Lavaux) | `terrace`/`walkout` lots facing south | Rows of vines on terraces with a winegrower's hut. |

#### 7.4 Terrain weights for `pickType`

`CATALOG[type].terrain = { waterfront, slope, stilts }` multiplies the zone weight on shore lots, on `terrace`/`walkout` lots and on `stilts` lots. Without it the bridge uses its own defaults (`TERRAIN_WEIGHTS` in `bridge/city.mjs`): chalets and huts ×2–3 on slopes, farms ×0.3–0.5, hotel ×3 and cafe ×2.5 by the water.

## 8. Catalogue and new types

```js
CATALOG[type] = {
  label: 'Chalet', labelKey: 'building.chalet',   // UI: t(labelKey); label is the English fallback
  kind: 'home' | 'public' | 'shore',              // home: a chat's house (STAGES); public: built for a district; shore: needs water
  zones: { core, inner, outer, rural, shore },    // pickType weights; public types have none (never a chat's home)
  unique: 'district' | 'city',
  site: 'harbour' | 'beach' | 'mole head' | ...,  // where it belongs (hint for the terrain planner)
  variants: TERRAIN_VARIANTS[type], pair: 'funicular_top',
}
```

New types this round (all single-stage, `kind` as listed; previews in `.dev/previews/new/`):

| Type | kind | Notes for the bridge |
|---|---|---|
| `lighthouse` | shore | Red-and-white octagonal tower (13–16 high) on a round stone pier head (13 across, centred at local 8,8; tower 5×5 at 6..10). Ladder inside to a glass lantern room with a sea lantern (`light` marker `data.beacon`), gallery with railing, copper cap. Can stand on a breakwater head. |
| `boathouse` | shore | Timber boathouse with its own water slip (y = −2…−1, dug through the fill; open to local north), loft by ladder, `boat_spot` inside and one at the water side. |
| `schiffstation` | shore | Steamer landing: pavilion with waiting room, ticket counter, timetable sign, SBB clock (`clock_spot`), canopy over the quay, bollards, `ship_spot`. |
| `lido` | shore | Strandbad: sand towards the water, jetty with a diving tower, changing cabins, kiosk with parasol tables, loungers, `pool_spot`. |
| `school` | public | Two-storey Schulhaus, corridor with coat hooks, four classrooms (desks, blackboard, lectern), bell turret with clock, playground. |
| `markethall` | public | Open hall on pillars, four market stalls, lanterns on beams, clock in the gable. No door (open hall). |
| `station` | public | Rural station: waiting hall, ticket counter, timetable, platform with canopy and SBB clock, track along local north (`rail_track`), PostAuto stop. |
| `funicular_bottom`, `funicular_top` | public | Valley / mountain station of a funicular: hall with platform, inclined track leaving through the back wall on piers (valley) or arriving from below in a dug trench (mountain), `funicular` markers with the far end of the track stub. Build as a pair. |
| `viewpoint` | public | Aussichtspunkt: open shelter with benches facing local north, stone terrace with railing, peak sign, `spyglass_spot`, flag. |
| `firestation` | public | Feuerwehrdepot: two bays with red gates and engine models (`vehicle_spot`), crew room upstairs, hose tower with alarm bell. |
| `postoffice` | public | Post: counters with bells, parcel shelves, yellow POST band and mailbox, PostAuto stop, the postmaster's flat upstairs. |

Shore types expect the water on their **local north** (the back): the bridge should turn shore lots so that `localSide(waterSide, turns) === 'north'`. They bring their own water where they need it, so they also stand on a dry lot.

**Requests to the bridge / other agents:** `pickType` should consider `kind: 'shore'` types only on shore lots (with `zones.shore` as weight) and never `kind: 'public'` types (they already have no zone weights); the economy chooses public works (school, market hall, fire station, post office per district; station and funicular pair per city; viewpoint on cliff edges) and requests them at `MAX_STAGE`.

## 9. Small forms from the generators

`YARD_FORMS` lists the stage-3 yard items with their size, and `yardForm(kind, seed, wood)` returns one on its own (`{ bp, w, d, h }`, blocks at x 0..w−1, z 0..d−1, front towards +z): `fountain` (village fountain with a two-basin trough), `bees` (bee house), `greenhouse` (5×4, door, crop beds, lantern), `pergola` (3×3 with a climbing plant over a garden table, `food_spot`), `flag`, `beds` (raised vegetable beds with composter), `woodpile`, `outhouse`, `bench`. The economy may place them as small forms in parks and yards; `bridge/smallforms.mjs` (life agent) is untouched.
