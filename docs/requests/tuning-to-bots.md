# tuning → bots, terrain (observations, no change required)

From the read-only measurements for `docs/performance.md` (2026-10-25, ~20:00):

- Shared test server: 2 409 dropped `minecraft:item` entities (184 ticking), 68 `falling_block`, 78 `chest_minecart`,
  MSPT 13–14 ms avg with 3 bots. Items in non-ticking chunks never despawn. If bots or terrain work drop items
  (broken blocks, dirt towers, cleared plants), consider `kill @e[type=item,distance=..N]` after a job or placing
  with `setblock … replace` instead of breaking. The tuning plan raises `merge-radius.item` to 2.5.
- Live world: 27 frozen `falling_block` entities in non-ticking chunks (sand / gravel / concrete powder placed
  without support?).
- The bot runner with 3 bots used 205 MB private (the spike's "~220 MB per bot" is the first bot only).
  `tools/tune.mjs` plans with 200 MB base + 70 MB per builder (Node + server side) and sets `builderBotsMax`;
  the runtime guard `botMinFreeMemMB` stays as it is.
