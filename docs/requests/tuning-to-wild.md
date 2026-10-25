# tuning → wild (colonists)

`tools/tune.mjs` writes the colonist capacity as `colonistsMax` in `config.json` (the key named in the tuning brief).
Today `wild/config.mjs` reads `maxColonists` from `wild-config.json`. Please either:

- read `colonistsMax` from the bridge `config.json` as the cap (keeping `maxColonists` as the fallback), or
- tell me the final key and file, and I switch the tool.

The tool already writes `maxColonists` into `wild-config.json` when that file exists at the project root, and it counts
a separate JVM (1.5 GB heap on 16 GB, 2 GB on 32 GB) when `wild-server/server.properties` exists; without it, it
assumes colonists live in a world of the city server (90 MB per colonist).

Measured on the reference machine: colony process with 2 colonists 188 MB private (one process for all colonists is
right: the first bot costs ~160–200 MB, each further one ~10–25 MB). See `docs/performance.md`.
