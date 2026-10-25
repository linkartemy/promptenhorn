# World anchors (for boats, steamers and other moving things)

The terrain agent's infrastructure (`bridge/infra.mjs`) publishes points where moving things can attach: the harbour basin and its steamer landing, jetty heads, bridges and lido beaches. They live in the bridge state and are rebuilt every time a piece of infrastructure is finished:

```js
state.terrain.anchors = {
  harbours: [{
    id: '7',
    waterY: 62,                       // water surface (blocks at y = waterY are water)
    mouth: [x, waterY, z],            // harbour entrance, open water just outside the breakwater
    berth: [x, y, z] | null,          // head of the steamer landing (Schiffstation), y = walking level on the deck
    basin: { x1, z1, x2, z2 },        // calm water inside the breakwater (keep moored boats in here)
    light: [x, y, z] | null,          // lamp room of the lighthouse (for a night beam)
  }],
  piers: [{
    id: '12',
    head: [x, y, z],                  // last plank of the jetty, y = walking level
    dir: [dx, dz],                    // direction from the shore out to the water
    waterY: 62,
    lido: false,                      // true: diving jetty of a lido (swimmers, no boats)
  }],
  bridges: [{ id: '15', kind: 'arch' | 'covered' | 'viaduct', deckY, rect: { x1, z1, x2, z2 }, waterY }],
  beaches: [{ id: '9', waterY, rect: { x1, z1, x2, z2 } }],
};
```

Read it through `ctx.state.terrain?.anchors` (features get `ctx.state`). It is empty until the "Lake front" / "Bridges over rivers" features have built something.

## What is already in the water

- Moored boats: `oak_boat` / `spruce_boat` / `birch_boat` entities tagged `alps`, `alps_infra`, `alps_boat` (invulnerable), 1–2 beside each jetty, 2–3 in the harbour basin, 1–2 pulled up on each lido beach. They are spawned once when the piece is built and never again (the infra renovation pass skips entity commands). A fleet feature may take them over (`@e[tag=alps_boat]`) or leave them as decoration.
- A spyglass `item_display` (tags `alps`, `alps_infra`) on every viewpoint.

## Notes for a fleet / steamer feature (life agent)

- Navigable water: columns with `depth >= 3` away from the shore. The terrain scanner gives both per column (`TerrainScanner` + `analyze()` in `bridge/terrain-scan.mjs`: `g.depth`, `an.offshore`); a route between two anchors can be an A* over columns with `offshore >= 4`.
- Steamer stop: dock at `berth`, facing back towards the shore along the landing (opposite of the landing's direction).
- Rivers flow: boats drift there; anchors are only planned on lakes and the sea (`waterType` not `river`).
- Keep entity and RCON cost bounded: move things only while a player is within ~160 blocks (chunks must be loaded).
