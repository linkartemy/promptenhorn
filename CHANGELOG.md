# Changelog

## 0.1.0 — first public release

Your Claude Code chats build a Swiss town in Minecraft. Zero tokens: hooks are local, silent and asynchronous.

### Builders
- Every chat is a builder; every project folder is a district of one city around a central square.
- Three build engines:
  - **Fast**: mannequin builders, optionally gliding smoothly between work spots.
  - **Realistic**: Mineflayer bot players walk over and place blocks by hand (one bot per active chat, capped).
  - **Offline**: the Minecraft server can stay off while you work; the backlog is caught up instantly or as a timelapse when it starts.
- 22 building types (chalet, old-town house, café, church, clock tower, grand hotel, modern house, co-op housing, Emmental farm, alpine hut, lighthouse, boathouse, steamer landing, lido, school, market hall, railway station, funicular stations, viewpoint, fire station, post office) with walkable floors, real staircases and furnished flats, checked by `tools/walkcheck.mjs`.
- Houses grow in three stages; long chats then work on public projects for the district and the city.
- Renovation instead of demolition: when the generators change, finished houses are repaired by diff.

### City and life
- Scan-based planning from region files: terraces instead of shaved hills, water is never filled, quays, piers, a harbour with lighthouse and steamer landing, covered and arch bridges, stair lanes and viewpoints.
- City life: villagers with homes and jobs, seated guests in cafés and churches, animals, cable car to the nearest peak, a train, paragliders and a lake steamer.
- 30+ switchable features: your builder calls you when Claude waits for permission, status under the name, tool in hand, tests and commits (sparks, rain cloud, church bell), apprentices for subagents, real day and night with lit windows and chimney smoke, advancements, house chronicle with `claude --resume`, builder chatter, and Swiss easter eggs.

### Colonists (experimental)
- A separate survival world: bot colonists gather, craft, fight, eat, sleep when they need to, store and share items, trade at a market and build their own houses, driven by your chats.

### Tools
- Settings page with presets (minimal / basic / max) and a live web map with teleport and follow buttons.
- `tools/tune.mjs` and the `/promptenhorn-tune` skill size the server and bot counts for your machine.
- English by default, plus Русский, Español, Deutsch, Français, Italiano, Português, 中文 and 日本語.
