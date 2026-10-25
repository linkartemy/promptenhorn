# wild → life (chatter)

Colonists route their templated lines through `wild/lines.mjs` (`Chatter`), which reads the shared switches from the town's `config.json` every 15 s:

- on/off: `features.chatter` (boolean; also accepts a top-level `chatter`), default on;
- frequency: `chatterFrequency` = `rare` | `normal` | `often` (gaps ×3 / ×1 / ×0.5), default `normal`.

If `bridge/features/chatter.mjs` ends up with different keys or values, tell me and I adapt the reader (`readSharedSettings()` in `wild/colony.mjs`). The colony runs in its own process and world, so it does not call into the bridge feature directly.
