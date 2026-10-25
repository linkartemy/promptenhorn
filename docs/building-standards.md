# Promptenhorn Building Standards

Requirements for procedural buildings. Goal: houses look good from the outside and believable on the inside. You can walk through them and "live" in them. Every requirement is either checked automatically (**[auto]**) or is part of the preview review checklist (**[review]**).

## 1. Technical guarantees

| # | Requirement | Check |
|---|---|---|
| 1.1 | All blocks and their properties exist in 1.21.11 | **[auto]** `node tools/validate-blocks.mjs` |
| 1.2 | When built through the bridge, nothing breaks off or disappears | **[auto]** `.dev/ingame-check.mjs`: 0 errors |
| 1.3 | The building stays within the 0..16 plot (except squares) | **[auto]** validate-blocks |
| 1.4 | Glass panes, iron bars, fences and walls connect to their neighbors the same way as if a player had placed them | **[auto]** in-game: state check `execute if block … [east=true…]` |
| 1.5 | Determinism: the same seed produces the same building | **[auto]** blueprint hash is stable |
| 1.6 | Size 700–3500 blocks (5–20 minutes of chat work) | **[auto]** `.dev/stats.mjs` |

## 2. Walkability

Checked by `tools/walkcheck.mjs`: a player BFS starting from the street in front of the plot. The player is 2 blocks tall; walks horizontally, climbs 1 block via stairs, slabs or a jump, drops down up to 3 blocks, climbs ladders; doors are passable.

| # | Requirement | Check |
|---|---|---|
| 2.1 | Every floor of the residential or public part is reachable from the street | **[auto]** 100% of floors |
| 2.2 | ≥ 95% of the interior floor area is reachable (furniture does not block passages) | **[auto]** |
| 2.3 | Entrance: a door reached by a path, with a step or porch in front of it | **[auto]** door reachable + **[review]** |
| 2.4 | A real staircase between floors: stairs with a landing or a straight flight. A ladder is allowed only in towers, attics and utility rooms | **[auto]** transition type + **[review]** |
| 2.5 | Passages ≥ 1 block wide in houses and ≥ 2 in public buildings (hotel, church, café) | **[auto]** |
| 2.6 | Clear room height ≥ 2 blocks everywhere, ≥ 3 in halls (hotel lobby, church nave, café hall) | **[auto]** |

## 3. Livability

The minimum set for every residential building. Blocks are placed meaningfully, next to each other, not scattered.

| # | Room | What it must contain |
|---|---|---|
| 3.1 | Kitchen | Stove (smoker, furnace or a tiled stove built from blocks), sink (cauldron), countertop (barrels or a crafting table), light |
| 3.2 | Dining room / Stube | Table with chairs (stair chairs); in chalets and old houses, a tiled stove (Kachelofen) |
| 3.3 | Bedroom | Two-part bed, nightstand or chest, window, light |
| 3.4 | Bathroom | At least a hint: water cauldron, quartz blocks and trapdoors, light-colored tiles |
| 3.5 | Storage | Chest, barrels or a cupboard |
| 3.6 | Light | A light source in every room, visible from outside through the windows at night |
| 3.7 | Windows | A window in every habitable room except the pantry and bathroom |

Check: **[auto]** presence of key blocks in every "apartment" (kitchen, bedroom and light markers on every residential floor) and **[review]** of the floor-by-floor slices.

## 4. Dimensions and proportions

| # | Requirement | Check |
|---|---|---|
| 4.1 | Usable area of a residential floor ≥ 6×6; a house has ≥ 2 residential floors (except the hut and the farm, which are living quarters plus a barn) | **[auto]** |
| 4.2 | Floor = floor slab + 2–3 blocks of height. The ground floor of public buildings is taller | **[auto]** |
| 4.3 | The roof fully covers the plan, overhangs of 1–2 blocks, roofing without holes | **[auto]** no sky above any floor + **[review]** |
| 4.4 | The chimney sits above a stove or fireplace | **[review]** |
| 4.5 | The building footprint makes use of the plot: the house covers ≥ 35% of the 17×17 area, the rest is yard, garden, terrace | **[auto]** |
| 4.6 | The facade reads clearly: plinth, floors, cornice, roof. Windows follow a grid | **[review]** |

## 5. Typology

| Type | Required elements |
|---|---|
| Chalet | Stone plinth, timber upper floors, Stube with a tiled stove, balcony with geraniums, wide roof overhang |
| Old-town house | Arcades or a shop on the ground floor, stairwell, an apartment on every floor, attic (mansard) |
| Café | Counter, pastry display case, 3+ tables inside plus a terrace, owner's apartment upstairs |
| Church | Nave with pews and a central aisle, altar, tower accessible up to the bell |
| Clock tower | Archway passage, stairs or ladder up to the clock face and the bell |
| Grand hotel | Lobby with a reception desk, stairs to all floors, corridor with guest rooms (a bed in each), restaurant |
| Modern house | Open-plan living room and kitchen, stairs, bedroom upstairs, terrace |
| Cooperative housing block | Stairwell, an apartment on every floor, balconies |
| Farm | Living quarters (kitchen, Stube, bedroom) and a barn with hay and stalls |
| Hut | Common room with long tables, dormitory with bunk beds |

## 6. Beauty

- Palettes vary by seed but stay in a Swiss spirit: wood, plaster, stone, copper, red roof tiles.
- Details: shutters, geranium window boxes, window surrounds, brackets, flags. Identical houses never stand next to each other (mirroring, variants).
- The interior is cozy: wood, carpets, light. Windows glow at night.
- **[review]** The exterior preview and the floor-by-floor slices of every type are inspected by eye before rollout.

## How to check

```bash
node tools/validate-blocks.mjs
node tools/walkcheck.mjs
node .dev/ingame-check.mjs
node .dev/stats.mjs
```

Everything must pass without errors before rollout to the live server.
