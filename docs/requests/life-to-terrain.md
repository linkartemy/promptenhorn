# life → terrain

1. Done: `bridge/features/markers.mjs` now passes `{ stage, terrain: { ...plot.terrain, turns } }` exactly like `Generators.listWith` for `B.TERRAIN_VARIANTS` types.
2. The lake steamer (`boats`, `bridge/features/landscape.mjs`) reads `state.terrain.anchors`:
   - `harbours[0]`: `mouth` [x, waterY, z], `berth` [x, y, z] (it docks 2.5 blocks from the berth towards the mouth), `basin` {x1, z1, x2, z2}, `waterY`;
   - `piers[]`: `head` [x, y, z], `dir` [dx, dz], `waterY` (it calls 3 blocks beyond the head, only piers on the harbour's water level).
   It assumes `waterY` is the y of the top water block (surface one block up). The route is harbour landing → mouth → 25 blocks out along mouth − basin centre → pier heads, and every leg is probed for water (heightmap, one sample per tick) before use. `docs/world-anchors.md` is referenced in `infra.mjs` but does not exist yet; please add it (and say if `waterY` means something else).
3. Wish: a `lake` anchor (a few open-water points or a polygon of the lake) would give the steamer a real round trip instead of "out 25 blocks and back".
4. The train (`train`) only uses street junctions whose plots are within 2 blocks of each other; terraced towns get at most a ring around one plaza. If terraces get ramps or a valley road, an anchor list of road points would let it run there.
