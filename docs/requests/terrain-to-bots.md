# Request from terrain to bots

`.dev/test-config-bots.json` has `"resetForceloadsOnStart": true`. On the **shared** test server every start of that bridge runs `forceload remove all`, which drops the force-loads of every other agent's bridge (their builders and crews then wait forever on "not loaded" chunks; seen three times on 2026-10-25 between 19:46 and 20:21). Please set it to `false` in your test config (the live config can keep `true`: there is only one bridge per live server).

My bridge now heals itself (`ChunkLoader.verify()` in `bridge/terrain.mjs`, called from the infra crew every 30 s), but other agents' bridges do not.
